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
    private roomTab: any = null;
    private systemTab: any = null;
    private refreshPeersList: (() => void) | null = null;
    private peersTalkingInterval: ReturnType<typeof setInterval> | null = null;
    private onPeerUpdateHandler: (() => void) | null = null;
    private onVoiceStateHandler: (() => void) | null = null;
    private scheduleRenderHandler: (() => void) | null = null;
    private onDesktopUpdateHandler: (() => void) | null = null;
    private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
    private debugStatsInterval: ReturnType<typeof setInterval> | null = null;

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
        this.addRoomTab();
        this.addSystemTab();
        this.addDebugTab();
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

        if (this.onDesktopUpdateHandler) {
            eventBus.off(EVENTS.DESKTOP_SCREENS_UPDATED, this.onDesktopUpdateHandler);
            this.onDesktopUpdateHandler = null;
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

    private addRoomTab() {
        if (!this.tabPanel) return;

        this.roomTab = this.tabPanel.addTab('Room');
        const roomContainer = this.roomTab.container;

        import('../utils/canvasui').then(({ UIButton, UILabel }) => {
            const desktop = this.context.managers.remoteDesktop;

            const title = new UILabel('Remote Screens', 50, 30, 1180, 70);
            title.font = getFont(UITheme.typography.sizes.title, 'bold');
            title.textColor = UITheme.colors.primary;
            title.textAlign = 'center';
            roomContainer.addChild(title);

            const subtitle = new UILabel('Manage your pre-configured global desktop sources', 70, 90, 1140, 40);
            subtitle.font = getFont(UITheme.typography.sizes.small);
            subtitle.textColor = UITheme.colors.textMuted;
            subtitle.textAlign = 'center';
            roomContainer.addChild(subtitle);

            const refreshBtn = new UIButton('Refresh Status', 420, 140, 440, 70, () => {
                desktop.requestSourceStatus();
            });
            refreshBtn.cornerRadius = 10;
            roomContainer.addChild(refreshBtn);

            const listContainer = new UIElement(40, 240, 1200, 500);
            roomContainer.addChild(listContainer);

            const renderList = () => {
                listContainer.children = [];
                const configs = desktop.getConfigs();

                if (configs.length === 0) {
                    const emptyLabel = new UILabel('No screens configured. Add entries in the main menu profile screen.', 40, 20, 1120, 50);
                    emptyLabel.font = getFont(UITheme.typography.sizes.body);
                    emptyLabel.textColor = UITheme.colors.textMuted;
                    emptyLabel.textAlign = 'center';
                    listContainer.addChild(emptyLabel);
                    this.tablet?.ui.markDirty();
                    return;
                }

                configs.slice(0, 5).forEach((cfg, index) => {
                    const rowY = index * 95;
                    const hasKey = cfg.key.trim().length > 0;
                    const online = desktop.isOnline(cfg.key);
                    const active = desktop.isActive(cfg.key);
                    const statusText = !hasKey ? 'Missing Key' : (active ? 'Active' : (online ? 'Online' : 'Offline'));
                    const statusColor = active
                        ? UITheme.colors.accent
                        : (!hasKey ? UITheme.colors.secondary : (online ? UITheme.colors.primary : UITheme.colors.textMuted));

                    const nameLabel = new UILabel(cfg.name, 20, rowY + 8, 360, 40);
                    nameLabel.font = getFont(UITheme.typography.sizes.body, 'bold');
                    nameLabel.textColor = UITheme.colors.text;
                    nameLabel.textAlign = 'left';
                    listContainer.addChild(nameLabel);

                    const keyLabel = new UILabel(cfg.key, 20, rowY + 44, 500, 34);
                    keyLabel.font = getFont(UITheme.typography.sizes.small);
                    keyLabel.textColor = UITheme.colors.textMuted;
                    keyLabel.textAlign = 'left';
                    listContainer.addChild(keyLabel);

                    const statusLabel = new UILabel(statusText, 560, rowY + 26, 180, 40);
                    statusLabel.font = getFont(UITheme.typography.sizes.small, 'bold');
                    statusLabel.textColor = statusColor;
                    statusLabel.textAlign = 'center';
                    listContainer.addChild(statusLabel);

                    const startBtn = new UIButton('Start', 770, rowY + 12, 170, 60, () => {
                        if (!hasKey || active) return;
                        desktop.summonStream(cfg.key, cfg.name);
                    });
                    startBtn.cornerRadius = 8;
                    startBtn.backgroundColor = hasKey && online && !active ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                    startBtn.borderColor = hasKey && online && !active ? UITheme.colors.primary : UITheme.colors.textMuted;
                    startBtn.textColor = hasKey && online && !active ? UITheme.colors.text : UITheme.colors.textMuted;
                    listContainer.addChild(startBtn);

                    const stopBtn = new UIButton('Stop', 965, rowY + 12, 170, 60, () => {
                        if (!active) return;
                        desktop.stopStream(cfg.key);
                    });
                    stopBtn.cornerRadius = 8;
                    stopBtn.backgroundColor = active ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                    stopBtn.borderColor = active ? UITheme.colors.secondary : UITheme.colors.textMuted;
                    stopBtn.textColor = active ? UITheme.colors.text : UITheme.colors.textMuted;
                    listContainer.addChild(stopBtn);
                });

                this.tablet?.ui.markDirty();
            };

            this.onDesktopUpdateHandler = () => {
                const isVR = this.context.managers.render?.isXRPresenting();
                if (this.context.isMenuOpen || isVR) renderList();
            };

            eventBus.on(EVENTS.DESKTOP_SCREENS_UPDATED, this.onDesktopUpdateHandler);
            desktop.requestSourceStatus();
            renderList();
        });
    }

    private addDebugTab() {
        if (!this.tabPanel) return;

        const debugTab = this.tabPanel.addTab('Debug');
        const debugContainer = debugTab.container;

        import('../utils/canvasui').then(({ UIButton, UILabel, UIToggle }) => {
            if (this.debugStatsInterval) {
                clearInterval(this.debugStatsInterval);
                this.debugStatsInterval = null;
            }

            const title = new UILabel("Debug", 50, 30, 1180, 70);
            title.font = getFont(UITheme.typography.sizes.title, 'bold');
            title.textColor = UITheme.colors.primary;
            title.textAlign = 'center';
            debugContainer.addChild(title);

            const debugManager = this.context.managers.debugRender;
            const debugSettings = debugManager?.getSettings();

            const overlayToggle = new UIToggle(
                "Enable Debug Overlay",
                debugSettings?.enabled ?? false,
                90, 120, 620, 52,
                (checked) => {
                    debugManager?.setEnabled(checked);
                    this.tablet?.ui.markDirty();
                }
            );
            debugContainer.addChild(overlayToggle);

            const physics = this.context.managers.physics;
            const makeStepper = (
                label: string,
                y: number,
                getValue: () => string,
                onDec: () => void,
                onInc: () => void
            ) => {
                const rowLabel = new UILabel(label, 90, y, 540, 54);
                rowLabel.font = getFont(UITheme.typography.sizes.body, 'bold');
                rowLabel.textAlign = 'left';
                rowLabel.textColor = UITheme.colors.text;
                debugContainer.addChild(rowLabel);

                const valueLabel = new UILabel(getValue(), 660, y, 220, 54);
                valueLabel.font = getFont(UITheme.typography.sizes.body, 'bold');
                valueLabel.textAlign = 'center';
                valueLabel.textColor = UITheme.colors.accent;
                debugContainer.addChild(valueLabel);

                const decBtn = new UIButton("-", 900, y - 6, 120, 64, () => {
                    onDec();
                    valueLabel.text = getValue();
                    this.tablet?.ui.markDirty();
                });
                decBtn.cornerRadius = 10;
                debugContainer.addChild(decBtn);

                const incBtn = new UIButton("+", 1040, y - 6, 120, 64, () => {
                    onInc();
                    valueLabel.text = getValue();
                    this.tablet?.ui.markDirty();
                });
                incBtn.cornerRadius = 10;
                debugContainer.addChild(incBtn);
            };

            makeStepper(
                "Touch Lease Claim Interval",
                220,
                () => `${physics.getTouchLeaseClaimIntervalMs()} ms`,
                () => physics.setTouchLeaseClaimIntervalMs(physics.getTouchLeaseClaimIntervalMs() - 25),
                () => physics.setTouchLeaseClaimIntervalMs(physics.getTouchLeaseClaimIntervalMs() + 25)
            );

            makeStepper(
                "Touch Lease Proximity",
                300,
                () => `${physics.getTouchLeaseProximityDistance().toFixed(2)} m`,
                () => physics.setTouchLeaseProximityDistance(physics.getTouchLeaseProximityDistance() - 0.05),
                () => physics.setTouchLeaseProximityDistance(physics.getTouchLeaseProximityDistance() + 0.05)
            );

            makeStepper(
                "Release Hold Min",
                380,
                () => `${physics.getPendingReleaseMinHoldMs()} ms`,
                () => physics.setPendingReleaseHoldWindow(physics.getPendingReleaseMinHoldMs() - 20, physics.getPendingReleaseMaxHoldMs()),
                () => physics.setPendingReleaseHoldWindow(physics.getPendingReleaseMinHoldMs() + 20, physics.getPendingReleaseMaxHoldMs())
            );

            makeStepper(
                "Release Hold Max",
                460,
                () => `${physics.getPendingReleaseMaxHoldMs()} ms`,
                () => physics.setPendingReleaseHoldWindow(physics.getPendingReleaseMinHoldMs(), physics.getPendingReleaseMaxHoldMs() - 40),
                () => physics.setPendingReleaseHoldWindow(physics.getPendingReleaseMinHoldMs(), physics.getPendingReleaseMaxHoldMs() + 40)
            );

            const note = new UILabel("Tip: Keep Min below Max for snappy throws without freeze.", 90, 560, 1080, 52);
            note.font = getFont(UITheme.typography.sizes.small);
            note.textColor = UITheme.colors.textMuted;
            note.textAlign = 'left';
            debugContainer.addChild(note);

            const statsLabel = new UILabel("", 90, 620, 1080, 52);
            statsLabel.font = getFont(UITheme.typography.sizes.small, 'bold');
            statsLabel.textColor = UITheme.colors.accent;
            statsLabel.textAlign = 'left';
            debugContainer.addChild(statsLabel);

            const updateStats = () => {
                const avg = physics.getTouchQueryAverageHitsPerFrame();
                statsLabel.text = `Touch Query Hits/frame (avg 1s): ${avg.toFixed(2)}`;
                this.tablet?.ui.markDirty();
            };

            updateStats();
            this.debugStatsInterval = setInterval(updateStats, 500);
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
        if (this.debugStatsInterval) {
            clearInterval(this.debugStatsInterval);
            this.debugStatsInterval = null;
        }
        if (this.keyboardHandler) {
            window.removeEventListener('keydown', this.keyboardHandler);
            this.keyboardHandler = null;
        }
    }
}
