import { GameContext } from '../core/GameState';
import { IUpdatable } from '../interfaces/IUpdatable';
import { TabletEntity } from '../entities/TabletEntity';
import { UITabPanel, UIElement } from '../utils/canvasui';
import { UITheme, getFont } from '../utils/UITheme';
import { RemotePlayer } from '../entities/RemotePlayer';
import { LocalPlayer } from '../entities/LocalPlayer';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import * as THREE from 'three';

export class VRUIManager implements IUpdatable {
    public tablet: TabletEntity | null = null;
    private tabPanel: UITabPanel | null = null;
    private overlayContainer: HTMLDivElement | null = null;

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

        this.setupKeyboardListeners();
    }

    private setupKeyboardListeners(): void {
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'm') {
                const render = this.context.managers.render;
                if (render && !render.isXRPresenting()) {
                    this.toggle2DMenu();
                }
            }
        });
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

        const roomContainer = this.tabPanel.addTab('Peers');
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
                listContainer.children = []; // Clear current list

                // Gather all players (Local + Remote)
                interface IPeerRow {
                    id: string;
                    name: string;
                    avatarColor: string | number;
                    isLocal: boolean;
                    audioLevel: number;
                    isMuted?: boolean;
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
                    audioLevel: this.context.managers.media ? this.context.managers.media.getLocalVolume() : 0
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
                            audioLevel: (rp as any).audioLevel || 0,
                            isMuted: rp.isMuted,
                            player: rp,
                            targetPos: rp.targetPosition ? new THREE.Vector3(rp.targetPosition.x, rp.targetPosition.y, rp.targetPosition.z) : undefined,
                            targetYaw: rp.targetYaw
                        });
                    }
                }

                // Update Tab Title with Count
                if (this.tabPanel) {
                    const tabIndex = this.tabPanel.tabs.findIndex(t => t.container === roomContainer);
                    if (tabIndex !== -1) {
                        this.tabPanel.tabs[tabIndex].name = `Peers (${allPeers.length})`;
                    }
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
                    let displayName = peer.name;
                    const isHost = peer.id === this.context.roomId || (peer.isLocal && this.context.isHost);
                    if (isHost) displayName += ' [Host]';
                    if (peer.audioLevel > 0.01) displayName += ' [Talking]';

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

            // Copy Invite Link Button in the header
            const copyBtn = new UIButton("Copy Invite Link", 440, 10, 400, 60, () => {
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
            const scheduleRender = () => { setTimeout(renderList, 100); };
            eventBus.on(EVENTS.PEER_CONNECTED, scheduleRender);
            eventBus.on(EVENTS.PEER_DISCONNECTED, scheduleRender);
            eventBus.on(EVENTS.REMOTE_NAME_UPDATED, scheduleRender);

            // Initial render
            renderList();
        });
    }

    private addSystemTab() {
        if (!this.tabPanel) return;

        const systemContainer = this.tabPanel.addTab('Settings');

        // Can inject basic buttons for toggling voice or leaving
        import('../utils/canvasui').then(({ UIButton, UILabel }) => {
            const title = new UILabel("Settings", 50, 50, 1180, 80);
            title.font = getFont(UITheme.typography.sizes.title, 'bold');
            title.textColor = UITheme.colors.primary;
            title.textAlign = 'center';
            systemContainer.addChild(title);

            const voiceBtn = new UIButton("Toggle Voice", 220, 200, 400, 100, () => {
                this.context.voiceEnabled = !this.context.voiceEnabled;
                console.log("Voice toggled from VR UI:", this.context.voiceEnabled);
                voiceBtn.text = this.context.voiceEnabled ? "Voice: ON" : "Voice: OFF";
                voiceBtn.backgroundColor = this.context.voiceEnabled ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                voiceBtn.borderColor = this.context.voiceEnabled ? UITheme.colors.primary : UITheme.colors.textMuted;
                this.tablet?.ui.markDirty();
            });
            systemContainer.addChild(voiceBtn);

            const leaveBtn = new UIButton("Leave Room", 660, 200, 400, 100, () => {
                const render = this.context.managers.render;
                if (render && render.isXRPresenting()) {
                    render.getXRSession()?.end().then(() => {
                        location.reload();
                    }).catch(() => {
                        location.reload();
                    });
                } else {
                    location.reload(); // Simple approach for now
                }
            });
            leaveBtn.backgroundColor = UITheme.colors.danger;
            leaveBtn.borderColor = UITheme.colors.secondary;
            leaveBtn.textColor = UITheme.colors.text;
            leaveBtn.hoverColor = UITheme.colors.dangerHover;
            systemContainer.addChild(leaveBtn);
        });
    }

    /**
     * Expose a public API for Skills/Managers to add their own Tabs to the Tablet.
     * @param title Title of the tab
     * @param buildCallback Callback providing the container element to append UI components to
     */
    public addTab(title: string, buildCallback: (container: UIElement) => void): void {
        if (!this.tabPanel) return;
        const container = this.tabPanel.addTab(title);
        buildCallback(container);
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
}
