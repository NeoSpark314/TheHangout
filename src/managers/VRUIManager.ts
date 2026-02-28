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
        this.addRoomTab();
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

        document.body.appendChild(this.overlayContainer);
        document.exitPointerLock?.();

        // Hide 3D tablet
        this.tablet.setVisible(false);
    }

    private hide2DMenu(): void {
        if (this.overlayContainer && this.overlayContainer.parentElement) {
            this.overlayContainer.parentElement.removeChild(this.overlayContainer);
        }

        // Resume 3D tablet visibility if appropriate (will be handled by update() check potentially, but let's be explicit)
        // Actually, we want it hidden in Desktop mode normally anyway based on user request "showing the 3D tablet only in VR"
        if (this.tablet) {
            const isVR = this.context.managers.render?.isXRPresenting();
            this.tablet.setVisible(!!isVR);
        }
    }

    private addRoomTab() {
        if (!this.tabPanel) return;

        const roomContainer = this.tabPanel.addTab('Room');
        let currentPage = 0;
        const playersPerPage = 4;

        import('../utils/canvasui').then(({ UIButton, UILabel }) => {
            const title = new UILabel("Participants", 50, 40, 1180, 60);
            title.font = getFont(UITheme.typography.sizes.title, 'bold');
            title.textColor = UITheme.colors.primary;
            title.textAlign = 'center';
            roomContainer.addChild(title);

            // Container to hold dynamic rows so we can clear them on pagination
            const listContainer = new UIElement(0, 120, 1280, 500);
            roomContainer.addChild(listContainer);

            const pageLabel = new UILabel("Page 1/1", 540, 640, 200, 60);
            pageLabel.font = getFont(UITheme.typography.sizes.small);
            pageLabel.textColor = UITheme.colors.textMuted;
            pageLabel.textAlign = 'center';

            const renderList = () => {
                listContainer.children = []; // Clear current list

                // Gather all remote players
                const remotePlayers: RemotePlayer[] = [];
                for (const entity of this.context.managers.entity.entities.values()) {
                    if (entity.type === 'REMOTE_PLAYER') {
                        remotePlayers.push(entity as RemotePlayer);
                    }
                }

                const totalPages = Math.max(1, Math.ceil(remotePlayers.length / playersPerPage));
                if (currentPage >= totalPages) currentPage = totalPages - 1;

                pageLabel.text = `Page ${currentPage + 1}/${totalPages}`;

                const startIndex = currentPage * playersPerPage;
                const pagePlayers = remotePlayers.slice(startIndex, startIndex + playersPerPage);

                if (remotePlayers.length === 0) {
                    const emptyLabel = new UILabel("You are the only one here.", 0, 200, 1280, 60);
                    emptyLabel.font = getFont(UITheme.typography.sizes.body, 'italic');
                    emptyLabel.textColor = UITheme.colors.textMuted;
                    emptyLabel.textAlign = 'center';
                    listContainer.addChild(emptyLabel);
                } else {
                    pagePlayers.forEach((player, index) => {
                        const rowY = index * 120;

                        // Avatar Color Block
                        const colorBlock = new UIElement(50, rowY + 20, 60, 60);
                        const c = player.avatarColor;
                        colorBlock.backgroundColor = typeof c === 'string' ? c : '#' + (c as number).toString(16).padStart(6, '0');
                        colorBlock.cornerRadius = 8;
                        listContainer.addChild(colorBlock);

                        // Name
                        const nameLabel = new UILabel(player.name || 'Unknown', 140, rowY + 20, 500, 60);
                        nameLabel.font = getFont(UITheme.typography.sizes.body, 'bold');
                        nameLabel.textColor = UITheme.colors.text;
                        nameLabel.textAlign = 'left';
                        listContainer.addChild(nameLabel);

                        // Mute Button
                        const muteBtn = new UIButton(player.isMuted ? "Unmute" : "Mute", 700, rowY + 15, 200, 70, () => {
                            player.isMuted = !player.isMuted;
                            if (player.view && (player.view as any).setMuted) {
                                (player.view as any).setMuted(player.isMuted);
                            }
                            renderList(); // Re-render to update button text
                        });
                        muteBtn.backgroundColor = player.isMuted ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                        muteBtn.borderColor = player.isMuted ? UITheme.colors.secondary : UITheme.colors.primary;
                        muteBtn.textColor = player.isMuted ? UITheme.colors.secondary : UITheme.colors.text;
                        listContainer.addChild(muteBtn);

                        // Go To Button
                        const gotoBtn = new UIButton("Go To", 930, rowY + 15, 200, 70, () => {
                            const localPlayer = this.context.localPlayer as LocalPlayer;
                            if (localPlayer && localPlayer.teleportTo) {
                                // Calculate position 1 meter backward from their face
                                const targetPos = new THREE.Vector3(player.targetPosition.x, player.targetPosition.y, player.targetPosition.z);
                                const targetYaw = player.targetYaw;

                                const offset = new THREE.Vector3(0, 0, 1.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
                                const finalPos = targetPos.clone().add(offset);
                                // Set our yaw to face them perfectly (their yaw + 180 degrees)
                                const finalYaw = targetYaw + Math.PI;

                                localPlayer.teleportTo(finalPos, finalYaw);

                                // Optional: Flash UI or provide feedback
                                gotoBtn.backgroundColor = UITheme.colors.primary;
                                setTimeout(() => {
                                    gotoBtn.backgroundColor = UITheme.colors.panelBgHover;
                                    this.tablet?.ui.markDirty();
                                }, 200);
                            }
                        });
                        gotoBtn.borderColor = UITheme.colors.accent;
                        listContainer.addChild(gotoBtn);
                    });
                }

                this.tablet?.ui.markDirty();
            };

            // Pagination Controls
            const prevBtn = new UIButton("< Prev", 200, 630, 200, 80, () => {
                if (currentPage > 0) {
                    currentPage--;
                    renderList();
                }
            });
            const nextBtn = new UIButton("Next >", 880, 630, 200, 80, () => {
                // Determine max pages again
                let remoteCount = 0;
                for (const entity of this.context.managers.entity.entities.values()) {
                    if (entity.type === 'REMOTE_PLAYER') remoteCount++;
                }
                const totalPages = Math.max(1, Math.ceil(remoteCount / playersPerPage));
                if (currentPage < totalPages - 1) {
                    currentPage++;
                    renderList();
                }
            });

            roomContainer.addChild(prevBtn);
            roomContainer.addChild(pageLabel);
            roomContainer.addChild(nextBtn);

            // Hook up auto-refresh events. We use setTimeout to defer rendering by one tick
            // so EntityManager has time to actually add/remove the entity before we query the list.
            const scheduleRender = () => { setTimeout(renderList, 0); };
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
            leaveBtn.backgroundColor = 'rgba(200, 40, 40, 0.4)';
            leaveBtn.borderColor = UITheme.colors.secondary;
            leaveBtn.textColor = UITheme.colors.secondary;
            leaveBtn.hoverColor = 'rgba(255, 0, 255, 0.6)';
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
