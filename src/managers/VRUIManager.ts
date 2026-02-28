import { GameContext } from '../core/GameState';
import { IUpdatable } from '../interfaces/IUpdatable';
import { TabletEntity } from '../entities/TabletEntity';
import { UITabPanel, UIElement, UIButton, UILabel } from '../utils/canvasui';
import { UITheme, getFont } from '../utils/UITheme';
import { RemotePlayer } from '../entities/RemotePlayer';
import { LocalPlayer } from '../entities/LocalPlayer';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { formatPlayerDisplayName } from '../utils/PlayerBadgeUtils';
import * as THREE from 'three';

export class VRUIManager implements IUpdatable {
    public tablet: TabletEntity | null = null;
    private tabPanel: UITabPanel | null = null;
    private overlayContainer: HTMLDivElement | null = null;

    private peersTab: any = null; // Store UITab handle
    private systemTab: any = null;
    private refreshPeersList: (() => void) | null = null;
    private peersTalkingInterval: ReturnType<typeof setInterval> | null = null;
    private onPeerUpdateHandler: (() => void) | null = null;
    private onVoiceStateHandler: (() => void) | null = null;
    private scheduleRenderHandler: (() => void) | null = null;
    private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(private context: GameContext) { }

    public init(): void {
        // Create the Tablet Entity
        this.tablet = new TabletEntity(this.context, 'local-tablet');

        // Add mesh to the scene rendering
        if (this.context.managers.render) {
            this.context.managers.render.scene.add(this.tablet.mesh);
        }

        // Add to Entity Manager so Grab works
        if (this.context.managers.entity) {
            // Because our ECS requires entities in the map to be findable by raycasters/skills
            // But we don't want it synced. We can manually add it with a local prefix:
            this.context.managers.entity.addEntity(this.tablet as any);
        }

        // Setup the Main Layout (1280x800 landscape)
        this.tabPanel = new UITabPanel(0, 0, 1280, 800);
        this.tablet.ui.root.addChild(this.tabPanel);

        // Add default System Tab immediately
        this.addPeersTab();
        this.addSystemTab();
        this.addHelpTab();

        this.setupKeyboardListeners();
    }

    private setupKeyboardListeners(): void {
        if (this.keyboardHandler) {
            window.removeEventListener('keydown', this.keyboardHandler);
        }

        this.keyboardHandler = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'm') {
                const render = this.context.managers.render;
                if (render && !render.isXRPresenting()) {
                    this.toggle2DMenu();
                }
            }
        };
        window.addEventListener('keydown', this.keyboardHandler);
    }

    private teardownPeersTabSubscriptions(): void {
        if (this.peersTalkingInterval) {
            clearInterval(this.peersTalkingInterval);
            this.peersTalkingInterval = null;
        }

        if (this.onPeerUpdateHandler) {
            eventBus.off(EVENTS.VOICE_STATE_UPDATED, this.onPeerUpdateHandler);
            eventBus.off(EVENTS.PEER_STATE_UPDATED, this.onPeerUpdateHandler);
            eventBus.off(EVENTS.PEER_JOINED_ROOM, this.onPeerUpdateHandler);
            eventBus.off(EVENTS.PEER_DISCONNECTED, this.onPeerUpdateHandler);
            this.onPeerUpdateHandler = null;
        }

        if (this.onVoiceStateHandler) {
            eventBus.off(EVENTS.VOICE_STATE_UPDATED, this.onVoiceStateHandler);
            this.onVoiceStateHandler = null;
        }

        if (this.scheduleRenderHandler) {
            eventBus.off(EVENTS.PEER_CONNECTED, this.scheduleRenderHandler);
            eventBus.off(EVENTS.PEER_DISCONNECTED, this.scheduleRenderHandler);
            eventBus.off(EVENTS.REMOTE_NAME_UPDATED, this.scheduleRenderHandler);
            this.scheduleRenderHandler = null;
        }
    }

    private toggle2DMenu(): void {
        this.context.isMenuOpen = !this.context.isMenuOpen;
        if (this.context.isMenuOpen) {
            this.show2DMenu();
        } else {
            this.hide2DMenu();
        }
    }

    private show2DMenu(): void {
        if (!this.tablet) return;

        // Create container if it doesn't exist
        if (!this.overlayContainer) {
            this.overlayContainer = document.createElement('div');
            this.overlayContainer.id = 'menu-2d-overlay';

            const canvas = this.tablet.ui.canvas;
            this.overlayContainer.appendChild(canvas);

            // Add events
            canvas.addEventListener('mousemove', (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (this.tablet!.ui.width / rect.width);
                const y = (e.clientY - rect.top) * (this.tablet!.ui.height / rect.height);
                this.tablet!.ui.onMouseMove(x, y);
            });

            canvas.addEventListener('click', (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (this.tablet!.ui.width / rect.width);
                const y = (e.clientY - rect.top) * (this.tablet!.ui.height / rect.height);
                this.tablet!.ui.onMouseClick(x, y);
            });
        }

        // Always re-append to ensure it's in the DOM
        if (this.tablet && !this.overlayContainer.contains(this.tablet.ui.canvas)) {
            this.overlayContainer.appendChild(this.tablet.ui.canvas);
        }

        document.body.appendChild(this.overlayContainer);
        this.tablet?.ui.markDirty();
        this.tablet?.ui.update(); // Physical render
        document.exitPointerLock?.();

        // Hide 3D tablet
        this.tablet.setVisible(false);

        // Hide desktop controls
        const controls = document.getElementById('desktop-controls');
        if (controls) controls.style.display = 'none';
    }

    private hide2DMenu(): void {
        if (this.overlayContainer && this.overlayContainer.parentElement) {
            this.overlayContainer.parentElement.removeChild(this.overlayContainer);
        }

        if (this.tablet) {
            const isVR = this.context.managers.render?.isXRPresenting();
            this.tablet.setVisible(!!isVR);
        }

        // Restore desktop controls if not in VR
        const controls = document.getElementById('desktop-controls');
        if (controls && !this.context.managers.render?.isXRPresenting()) {
            controls.style.display = 'block';
        }
    }

    private addPeersTab() {
        if (!this.tabPanel) return;
        this.teardownPeersTabSubscriptions();

        this.peersTab = this.tabPanel.addTab('Peers');
        const roomContainer = this.peersTab.container;
        let currentPage = 0;
        const playersPerPage = 4;

        import('../utils/canvasui').then(({ UIButton, UILabel }) => {
            // 1. Header Row (for actions like Copy Invite)
            const headerContainer = new UIElement(0, 20, 1280, 80);
            roomContainer.addChild(headerContainer);

            // 2. List Container (shifted down)
            const listContainer = new UIElement(0, 110, 1280, 500);
            roomContainer.addChild(listContainer);

            const pageLabel = new UILabel("Page 1/1", 540, 640, 200, 60);
            pageLabel.font = getFont(UITheme.typography.sizes.small);
            pageLabel.textColor = UITheme.colors.textMuted;
            pageLabel.textAlign = 'center';

            const renderList = () => {
                if (this.peersTab && !this.peersTab.container.children.includes(listContainer)) {
                    // If the list is no longer in the container (tab switched), skip
                    return;
                }
                listContainer.children = []; // Clear current list

                // Gather all players (Local + Remote)
                interface IPeerRow {
                    id: string;
                    name: string;
                    avatarColor: string | number;
                    isLocal: boolean;
                    audioLevel: number;
                    isMuted?: boolean;
                    micEnabled?: boolean;
                    player?: RemotePlayer;
                    targetPos?: THREE.Vector3;
                    targetYaw?: number;
                }

                const allPeers: IPeerRow[] = [];

                // 1. Add Local Player
                allPeers.push({
                    id: this.context.localPlayer?.id || 'local',
                    name: (this.context.playerName || 'You') + ' (You)',
                    avatarColor: this.context.avatarConfig.color,
                    isLocal: true,
                    audioLevel: this.context.managers.media ? this.context.managers.media.getLocalVolume() : 0,
                    micEnabled: this.context.voiceEnabled
                });

                // 2. Add Remote Players
                for (const entity of this.context.managers.entity.entities.values()) {
                    if (entity.type === 'REMOTE_PLAYER') {
                        const rp = entity as RemotePlayer;
                        // Avoid adding duplicates if the same player is discovered multiple times (edge case)
                        if (allPeers.find(p => p.id === rp.id)) continue;

                        allPeers.push({
                            id: rp.id,
                            name: rp.name || 'Unknown',
                            avatarColor: rp.avatarColor as string | number,
                            isLocal: false,
                            audioLevel: rp.audioLevel,
                            isMuted: rp.isMuted,
                            micEnabled: rp.micEnabled,
                            player: rp,
                            targetPos: rp.targetPosition ? new THREE.Vector3(rp.targetPosition.x, rp.targetPosition.y, rp.targetPosition.z) : undefined,
                            targetYaw: rp.targetYaw
                        });
                    }
                }

                // Update Tab Title with Count
                if (this.peersTab) {
                    this.peersTab.label.text = `Peers (${allPeers.length})`;
                }

                const totalPages = Math.max(1, Math.ceil(allPeers.length / playersPerPage));
                if (currentPage >= totalPages) currentPage = totalPages - 1;
                if (currentPage < 0) currentPage = 0;

                pageLabel.text = `Page ${currentPage + 1}/${totalPages}`;

                const startIndex = currentPage * playersPerPage;
                const pagePeers = allPeers.slice(startIndex, startIndex + playersPerPage);

                pagePeers.forEach((peer, index) => {
                    const rowY = index * 125;

                    // Avatar Color Block
                    const colorBlock = new UIElement(50, rowY + 20, 60, 60);
                    const c = peer.avatarColor;
                    colorBlock.backgroundColor = typeof c === 'string' ? c : '#' + (c as number).toString(16).padStart(6, '0');
                    colorBlock.cornerRadius = 8;
                    listContainer.addChild(colorBlock);

                    // Name + Badges
                    const isHost = peer.id === this.context.roomId || (peer.isLocal && this.context.isHost);
                    const displayName = formatPlayerDisplayName({
                        name: peer.name,
                        isHost,
                        micEnabled: peer.micEnabled,
                        isMuted: peer.isMuted,
                        audioLevel: peer.audioLevel
                    });

                    const nameLabel = new UILabel(displayName, 140, rowY + 20, 550, 60);
                    nameLabel.font = getFont(UITheme.typography.sizes.body, peer.isLocal ? 'bold' : 'normal');
                    nameLabel.textColor = peer.isLocal ? UITheme.colors.primary : UITheme.colors.text;
                    nameLabel.textAlign = 'left';
                    listContainer.addChild(nameLabel);

                    if (!peer.isLocal && peer.player) {
                        const remotePeer = peer.player;
                        // Mute Button
                        const muteBtn = new UIButton(peer.isMuted ? "Unmute" : "Mute", 720, rowY + 15, 200, 70, () => {
                            remotePeer.isMuted = !remotePeer.isMuted;
                            if (remotePeer.view && (remotePeer.view as any).setMuted) {
                                (remotePeer.view as any).setMuted(remotePeer.isMuted);
                            }
                            renderList();
                        });
                        muteBtn.backgroundColor = peer.isMuted ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                        muteBtn.borderColor = peer.isMuted ? UITheme.colors.secondary : UITheme.colors.primary;
                        muteBtn.textColor = peer.isMuted ? UITheme.colors.secondary : UITheme.colors.text;
                        muteBtn.cornerRadius = 8;
                        listContainer.addChild(muteBtn);

                        // Go To Button
                        const gotoBtn = new UIButton("Go To", 950, rowY + 15, 200, 70, () => {
                            const localPlayer = this.context.localPlayer as LocalPlayer;
                            if (localPlayer && localPlayer.teleportTo && peer.targetPos && peer.targetYaw !== undefined) {
                                const targetPos = new THREE.Vector3(peer.targetPos.x, peer.targetPos.y, peer.targetPos.z);
                                const targetYaw = peer.targetYaw;
                                const offset = new THREE.Vector3(0, 0, 1.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
                                const finalPos = targetPos.clone().add(offset);
                                const finalYaw = targetYaw + Math.PI;
                                localPlayer.teleportTo(finalPos, finalYaw);

                                gotoBtn.backgroundColor = UITheme.colors.primary;
                                setTimeout(() => {
                                    gotoBtn.backgroundColor = UITheme.colors.panelBgHover;
                                    this.tablet?.ui.markDirty();
                                }, 200);
                            }
                        });
                        gotoBtn.borderColor = UITheme.colors.accent;
                        gotoBtn.cornerRadius = 8;
                        listContainer.addChild(gotoBtn);
                    }
                });

                this.tablet?.ui.markDirty();
            };

            this.refreshPeersList = renderList;

            // Reactive updates
            this.onPeerUpdateHandler = () => {
                const isVR = this.context.managers.render?.isXRPresenting();
                if (this.context.isMenuOpen || isVR) {
                    renderList();
                }
            };

            eventBus.on(EVENTS.VOICE_STATE_UPDATED, this.onPeerUpdateHandler);
            eventBus.on(EVENTS.PEER_STATE_UPDATED, this.onPeerUpdateHandler);
            eventBus.on(EVENTS.PEER_JOINED_ROOM, this.onPeerUpdateHandler);
            eventBus.on(EVENTS.PEER_DISCONNECTED, this.onPeerUpdateHandler);

            // Periodically refresh for Talking indicators if menu is visible
            this.peersTalkingInterval = setInterval(() => {
                const isVR = this.context.managers.render?.isXRPresenting();
                if (this.context.isMenuOpen || isVR) {
                    renderList();
                }
            }, 500);

            // 3. Header Controls
            const micBtn = new UIButton("Mic: ON", 240, 10, 380, 60, () => {
                this.context.voiceEnabled = !this.context.voiceEnabled;
                if (this.context.voiceEnabled) {
                    this.context.managers.media.toggleMicrophone().then(() => {
                        eventBus.emit(EVENTS.VOICE_STATE_UPDATED);
                    });
                } else {
                    this.context.managers.media.stopMicrophone();
                    eventBus.emit(EVENTS.VOICE_STATE_UPDATED);
                }
            });
            micBtn.font = getFont(UITheme.typography.sizes.small, 'bold');
            micBtn.cornerRadius = 10;
            headerContainer.addChild(micBtn);

            const updateMicUI = () => {
                micBtn.text = this.context.voiceEnabled ? "Mic: ON" : "Mic: OFF";
                micBtn.backgroundColor = this.context.voiceEnabled ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                micBtn.borderColor = this.context.voiceEnabled ? UITheme.colors.primary : UITheme.colors.textMuted;
                this.tablet?.ui.markDirty();
            };

            this.onVoiceStateHandler = updateMicUI;
            eventBus.on(EVENTS.VOICE_STATE_UPDATED, this.onVoiceStateHandler);
            updateMicUI(); // Initial state

            const copyBtn = new UIButton("Copy Invite Link", 660, 10, 380, 60, () => {
                const url = window.location.origin + window.location.pathname + "?room=" + this.context.roomId;
                navigator.clipboard.writeText(url).then(() => {
                    copyBtn.text = "Copied!";
                    this.tablet?.ui.markDirty();
                    setTimeout(() => {
                        copyBtn.text = "Copy Invite Link";
                        this.tablet?.ui.markDirty();
                    }, 2000);
                });
            });
            copyBtn.font = getFont(UITheme.typography.sizes.small, 'bold');
            copyBtn.borderColor = UITheme.colors.secondary;
            copyBtn.cornerRadius = 10;
            headerContainer.addChild(copyBtn);

            // Pagination Controls
            const prevBtn = new UIButton("< Prev", 200, 630, 200, 80, () => {
                if (currentPage > 0) {
                    currentPage--;
                    renderList();
                }
            });
            const nextBtn = new UIButton("Next >", 880, 630, 200, 80, () => {
                let totalPeers = 1; // Start with local player
                for (const entity of this.context.managers.entity.entities.values()) {
                    if (entity.type === 'REMOTE_PLAYER') totalPeers++;
                }
                const totalPages = Math.max(1, Math.ceil(totalPeers / playersPerPage));
                if (currentPage < totalPages - 1) {
                    currentPage++;
                    renderList();
                }
            });

            roomContainer.addChild(prevBtn);
            roomContainer.addChild(pageLabel);
            roomContainer.addChild(nextBtn);

            // Hook up auto-refresh events.
            this.scheduleRenderHandler = () => { setTimeout(renderList, 100); };
            eventBus.on(EVENTS.PEER_CONNECTED, this.scheduleRenderHandler);
            eventBus.on(EVENTS.PEER_DISCONNECTED, this.scheduleRenderHandler);
            eventBus.on(EVENTS.REMOTE_NAME_UPDATED, this.scheduleRenderHandler);

            // Initial render
            renderList();
        });
    }

    private addSystemTab() {
        if (!this.tabPanel) return;

        this.systemTab = this.tabPanel.addTab('System');
        const systemContainer = this.systemTab.container;

        import('../utils/canvasui').then(({ UIButton, UILabel }) => {
            const title = new UILabel("System", 50, 50, 1180, 80);
            title.font = getFont(UITheme.typography.sizes.title, 'bold');
            title.textColor = UITheme.colors.primary;
            title.textAlign = 'center';
            systemContainer.addChild(title);

            const leaveBtn = new UIButton("Leave Room", 440, 630, 400, 80, () => {
                const render = this.context.managers.render;
                if (render && render.isXRPresenting()) {
                    render.getXRSession()?.end().then(() => {
                        location.reload();
                    }).catch(() => {
                        location.reload();
                    });
                } else {
                    location.reload();
                }
            });
            leaveBtn.backgroundColor = UITheme.colors.danger;
            leaveBtn.borderColor = UITheme.colors.secondary;
            leaveBtn.textColor = UITheme.colors.text;
            leaveBtn.hoverColor = UITheme.colors.dangerHover;
            leaveBtn.cornerRadius = 10;
            systemContainer.addChild(leaveBtn);
        });
    }

    private addHelpTab() {
        if (!this.tabPanel) return;

        const helpTab = this.tabPanel.addTab('Help');
        const container = helpTab.container;
        let currentMode: 'VR' | 'Desktop' | 'Touch' = 'VR';

        import('../utils/canvasui').then(() => {
            const contentArea = new UIElement(50, 150, 1180, 600);
            container.addChild(contentArea);

            const navButtons: UIButton[] = [];

            const renderHelp = () => {
                contentArea.children = [];

                const title = new UILabel(`${currentMode} CONTROLS`, 0, 0, 1180, 80);
                title.font = getFont(UITheme.typography.sizes.title, 'bold');
                title.textColor = UITheme.colors.primary;
                title.textAlign = 'center';
                contentArea.addChild(title);

                const controls = this.getControlsForMode(currentMode);
                controls.forEach((text, i) => {
                    const isHeader = !text.startsWith('•') && text.trim() !== '';
                    const line = new UILabel(text, 50, 100 + i * 45, 1080, 40);
                    line.font = getFont(isHeader ? UITheme.typography.sizes.body : UITheme.typography.sizes.small, isHeader ? 'bold' : 'normal');
                    line.textColor = isHeader ? UITheme.colors.accent : UITheme.colors.text;
                    contentArea.addChild(line);
                });

                navButtons.forEach(btn => {
                    const isSelected = btn.text === currentMode;
                    btn.backgroundColor = isSelected ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                    btn.borderColor = isSelected ? UITheme.colors.primary : UITheme.colors.textMuted;
                });

                this.tablet?.ui.markDirty();
            };

            const modes: ('VR' | 'Desktop' | 'Touch')[] = ['VR', 'Desktop', 'Touch'];
            modes.forEach((mode, i) => {
                const btn = new UIButton(mode, 50 + i * 390, 40, 360, 80, () => {
                    currentMode = mode;
                    renderHelp();
                });
                btn.cornerRadius = 10;
                btn.font = getFont(UITheme.typography.sizes.body, 'bold');
                container.addChild(btn);
                navButtons.push(btn);
            });

            renderHelp();
        });
    }

    private getControlsForMode(mode: 'VR' | 'Desktop' | 'Touch'): string[] {
        switch (mode) {
            case 'VR':
                return [
                    "• Move: Left Thumbstick",
                    "• Turn: Right Thumbstick (Snap)",
                    "• Grab/Hold: Left or Right Grip",
                    "• Use/Select: Left or Right Trigger",
                    "• Menu: Menu Button (Left Hand)",
                    "",
                    "Hand Tracking Gestures:",
                    "• Select/Click: Pinch index and thumb",
                    "• Grab/Hold: Close fist (Grasp)",
                    "• Menu: Look at left palm then flip up"
                ];
            case 'Desktop':
                return [
                    "• Move: W, A, S, D keys",
                    "• Look: Move Mouse",
                    "• Menu: M key",
                    "• Grab: Left Click",
                    "• Interact: Right Click",
                    "• Hand Active: Q (Left), E (Right)",
                    "• Reach Distance: Mouse Wheel"
                ];
            case 'Touch':
                return [
                    "• Move: Left virtual joystick",
                    "• Look: Right virtual joystick",
                    "• Menu: HUD Toggle button",
                    "• Interaction: Tap on objects",
                    "• Multi-Touch: Supports dual joystick control"
                ];
        }
    }

    /**
     * Expose a public API for Skills/Managers to add their own Tabs to the Tablet.
     * @param title Title of the tab
     * @param buildCallback Callback providing the container element to append UI components to
     */
    public addTab(title: string, buildCallback: (container: UIElement) => void): void {
        if (!this.tabPanel) return;
        const tab = this.tabPanel.addTab(title);
        buildCallback(tab.container);
        this.tablet?.ui.markDirty();
    }

    public update(delta: number): void {
        if (this.tablet) {
            // Update 3D visibility based on VR state vs Desktop Menu
            const isVR = this.context.managers.render?.isXRPresenting();
            if (isVR) {
                this.tablet.setVisible(true);
            } else if (!this.context.isMenuOpen) {
                this.tablet.setVisible(false);
            }

            this.tablet.update(delta);
        }
    }

    public destroy(): void {
        this.teardownPeersTabSubscriptions();
        if (this.keyboardHandler) {
            window.removeEventListener('keydown', this.keyboardHandler);
            this.keyboardHandler = null;
        }
    }
}
