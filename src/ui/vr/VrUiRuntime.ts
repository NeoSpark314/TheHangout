import { AppContext } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { TabletSurfaceEntity } from '../../world/entities/TabletSurfaceEntity';
import { UITabPanel, UIElement, UIButton, UILabel, UIToggle } from '../shared/canvasui';
import { UITheme, getFont } from '../shared/UITheme';
import { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import { EntityType } from '../../shared/contracts/IEntityState';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { formatPlayerDisplayName } from '../../shared/utils/PlayerBadgeUtils';
import { ControllerPointer } from '../shared/ControllerPointer';
import * as THREE from 'three';

export class VrUiRuntime implements IUpdatable {
    public tablet: TabletSurfaceEntity | null = null;
    private tabPanel: UITabPanel | null = null;
    private overlayContainer: HTMLDivElement | null = null;
    private controllerCursor: ControllerPointer;
    private handLocomotionIndicator: THREE.Group | null = null;
    private handLocomotionShell: THREE.Mesh | null = null;
    private handLocomotionAnchor: THREE.Mesh | null = null;
    private handLocomotionCurrent: THREE.Mesh | null = null;
    private handLocomotionLine: THREE.Line | null = null;

    private peersTab: any = null; // Store UITab handle
    private sessionTab: any = null;
    private systemTab: any = null;
    private refreshPeersList: (() => void) | null = null;
    private peersTalkingInterval: ReturnType<typeof setInterval> | null = null;
    private onPeerUpdateHandler: (() => void) | null = null;
    private onVoiceStateHandler: (() => void) | null = null;
    private scheduleRenderHandler: (() => void) | null = null;
    private onDesktopUpdateHandler: (() => void) | null = null;
    private onDesktopResubscribeHandler: (() => void) | null = null;
    private menuIntentHandler: (() => void) | null = null;
    private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
    private canvasMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
    private canvasClickHandler: ((e: MouseEvent) => void) | null = null;
    private debugStatsInterval: ReturnType<typeof setInterval> | null = null;

    constructor(private context: AppContext) {
        this.controllerCursor = new ControllerPointer('vr-menu-controller-cursor');
    }

    public init(): void {
        this.initHandLocomotionIndicator();

        // Create the Tablet Entity
        this.tablet = new TabletSurfaceEntity(this.context, 'local-tablet');

        // Add mesh to the scene rendering
        if (this.context.runtime.render) {
            this.context.runtime.render.scene.add(this.tablet.mesh);
        }

        // Add to the entity registry so grab interactions can find it.
        if (this.context.runtime.entity) {
            // Because our ECS requires entities in the map to be findable by raycasters/skills
            // But we don't want it synced. We can manually add it with a local prefix:
            this.context.runtime.entity.addEntity(this.tablet as any);
        }

        // Setup the Main Layout (1280x800 landscape)
        this.tabPanel = new UITabPanel(0, 0, 1280, 800);
        this.tablet.ui.root.addChild(this.tabPanel);

        // Add default System Tab immediately
        this.addPeersTab();
        if (this.context.isLocalServer) {
            this.addSessionTab();
        }
        this.addSystemTab();
        this.addDebugTab();
        this.addHelpTab();

        this.setupMenuIntentHandler();
        this.setupKeyboardListeners();
    }

    private initHandLocomotionIndicator(): void {
        const render = this.context.runtime.render;
        if (!render || this.handLocomotionIndicator) return;

        const group = new THREE.Group();
        group.visible = false;

        const shell = new THREE.Mesh(
            new THREE.SphereGeometry(1, 24, 24),
            new THREE.MeshBasicMaterial({
                color: 0x66ffff,
                transparent: true,
                opacity: 0.12,
                depthWrite: false
            })
        );

        const anchor = new THREE.Mesh(
            new THREE.SphereGeometry(0.008, 16, 16),
            new THREE.MeshBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.9,
                depthWrite: false
            })
        );
        anchor.visible = false;

        const current = new THREE.Mesh(
            new THREE.SphereGeometry(0.012, 16, 16),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.95,
                depthWrite: false
            })
        );

        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
        const line = new THREE.Line(
            lineGeometry,
            new THREE.LineBasicMaterial({
                color: 0x99ffff,
                transparent: true,
                opacity: 0.55,
                depthWrite: false
            })
        );
        line.visible = false;

        group.add(shell);
        group.add(line);
        group.add(anchor);
        group.add(current);

        render.scene.add(group);

        this.handLocomotionIndicator = group;
        this.handLocomotionShell = shell;
        this.handLocomotionAnchor = anchor;
        this.handLocomotionCurrent = current;
        this.handLocomotionLine = line;
    }

    private updateHandLocomotionIndicator(): void {
        const indicator = this.handLocomotionIndicator;
        const shell = this.handLocomotionShell;
        const anchor = this.handLocomotionAnchor;
        const current = this.handLocomotionCurrent;
        const line = this.handLocomotionLine;
        const render = this.context.runtime.render;
        const state = this.context.runtime.input?.xrInput.getLeftHandLocomotionIndicatorState() || null;

        if (!indicator || !shell || !anchor || !current || !line || !render || !render.isXRPresenting() || !state?.visible) {
            if (indicator) indicator.visible = false;
            return;
        }

        const headPosition = new THREE.Vector3();
        const headQuaternion = new THREE.Quaternion();
        const headEuler = new THREE.Euler();
        const chestOffset = new THREE.Vector3(0, -0.28, -0.18);
        render.camera.getWorldPosition(headPosition);
        render.camera.getWorldQuaternion(headQuaternion);
        headEuler.setFromQuaternion(headQuaternion, 'YXZ');
        chestOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), headEuler.y);

        indicator.visible = true;
        indicator.position.copy(headPosition).add(chestOffset);
        indicator.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.frameYaw);
        shell.scale.setScalar(state.radius * 0.45);
        (shell.material as THREE.MeshBasicMaterial).opacity = state.isActive ? 0.08 : 0.12;

        current.position.set(state.deflectionLocal.x, state.deflectionLocal.y, state.deflectionLocal.z);

        anchor.visible = state.isActive;
        current.visible = state.isActive;
        line.visible = state.isActive;

        if (state.isActive) {
            anchor.position.set(0, 0, 0);
            const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
            positions.setXYZ(0, 0, 0, 0);
            positions.setXYZ(1, current.position.x, current.position.y, current.position.z);
            positions.needsUpdate = true;
            line.geometry.computeBoundingSphere();
        }
    }

    private setupMenuIntentHandler(): void {
        if (this.menuIntentHandler) {
            eventBus.off(EVENTS.INTENT_MENU_TOGGLE, this.menuIntentHandler);
        }

        this.menuIntentHandler = () => {
            const render = this.context.runtime.render;
            if (render && !render.isXRPresenting()) {
                this.toggle2DMenu();
            }
        };

        eventBus.on(EVENTS.INTENT_MENU_TOGGLE, this.menuIntentHandler);
    }

    private setupKeyboardListeners(): void {
        if (this.keyboardHandler) {
            window.removeEventListener('keydown', this.keyboardHandler);
        }

        this.keyboardHandler = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'm') {
                eventBus.emit(EVENTS.INTENT_MENU_TOGGLE);
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
            eventBus.off(EVENTS.PEER_JOINED_SESSION, this.onPeerUpdateHandler);
            eventBus.off(EVENTS.PEER_DISCONNECTED, this.onPeerUpdateHandler);
            this.onPeerUpdateHandler = null;
        }

        if (this.onVoiceStateHandler) {
            eventBus.off(EVENTS.VOICE_STATE_UPDATED, this.onVoiceStateHandler);
            this.onVoiceStateHandler = null;
        }

        if (this.scheduleRenderHandler) {
            eventBus.off(EVENTS.ENTITY_DISCOVERED, this.scheduleRenderHandler);
            eventBus.off(EVENTS.PEER_DISCONNECTED, this.scheduleRenderHandler);
            eventBus.off(EVENTS.REMOTE_NAME_UPDATED, this.scheduleRenderHandler);
            this.scheduleRenderHandler = null;
        }

        if (this.onDesktopUpdateHandler) {
            eventBus.off(EVENTS.DESKTOP_SCREENS_UPDATED, this.onDesktopUpdateHandler);
            this.onDesktopUpdateHandler = null;
        }

        if (this.onDesktopResubscribeHandler) {
            eventBus.off(EVENTS.SESSION_CONNECTED, this.onDesktopResubscribeHandler);
            eventBus.off(EVENTS.PEER_JOINED_SESSION, this.onDesktopResubscribeHandler);
            this.onDesktopResubscribeHandler = null;
        }
    }

    public toggle2DMenu(): void {
        this.context.isMenuOpen = !this.context.isMenuOpen;
        if (this.context.isMenuOpen) {
            this.show2DMenu();
        } else {
            this.hide2DMenu();
        }
    }

    private show2DMenu(): void {
        if (!this.tablet) return;
        this.controllerCursor.reset();

        // Create container if it doesn't exist
        if (!this.overlayContainer) {
            this.overlayContainer = document.createElement('div');
            this.overlayContainer.id = 'menu-2d-overlay';

            const canvas = this.tablet.ui.canvas;
            this.overlayContainer.appendChild(canvas);

            // Add events
            this.canvasMouseMoveHandler = (e: MouseEvent) => {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (this.tablet!.ui.width / rect.width);
                const y = (e.clientY - rect.top) * (this.tablet!.ui.height / rect.height);
                this.tablet!.ui.onMouseMove(x, y);
            };
            canvas.addEventListener('mousemove', this.canvasMouseMoveHandler);

            this.canvasClickHandler = (e: MouseEvent) => {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (this.tablet!.ui.width / rect.width);
                const y = (e.clientY - rect.top) * (this.tablet!.ui.height / rect.height);
                this.tablet!.ui.onMouseClick(x, y);
            };
            canvas.addEventListener('click', this.canvasClickHandler);
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
        this.controllerCursor.hide();
        if (this.overlayContainer && this.overlayContainer.parentElement) {
            this.overlayContainer.parentElement.removeChild(this.overlayContainer);
        }

        if (this.tablet) {
            const isVR = this.context.runtime.render?.isXRPresenting();
            this.tablet.setVisible(!!isVR);
        }

        // Restore desktop controls if not in VR
        const controls = document.getElementById('desktop-controls');
        if (controls && !this.context.runtime.render?.isXRPresenting()) {
            controls.style.display = 'block';
        }
    }

    public handleControllerCursor(
        delta: number,
        stick: { x: number; y: number },
        confirmPressed: boolean,
        controllerConnected: boolean
    ): void {
        if (!this.overlayContainer || !this.overlayContainer.parentElement || !this.tablet) {
            this.controllerCursor.hide();
            return;
        }

        const render = this.context.runtime.render;
        if (!controllerConnected || !render || render.isXRPresenting()) {
            this.controllerCursor.hide();
            return;
        }

        this.controllerCursor.show();
        const position = this.controllerCursor.move(delta, stick);
        if (!position) return;

        const canvas = this.tablet.ui.canvas;
        const rect = canvas.getBoundingClientRect();
        const withinCanvas = rect.width > 0
            && rect.height > 0
            && position.x >= rect.left
            && position.x <= rect.right
            && position.y >= rect.top
            && position.y <= rect.bottom;

        if (withinCanvas) {
            const x = (position.x - rect.left) * (this.tablet.ui.width / rect.width);
            const y = (position.y - rect.top) * (this.tablet.ui.height / rect.height);
            this.tablet.ui.onMouseMove(x, y);

            if (confirmPressed) {
                this.tablet.ui.onMouseClick(x, y);
            }
            return;
        }

        this.tablet.ui.onPointerOut();
    }

    private addPeersTab() {
        if (!this.tabPanel) return;
        this.teardownPeersTabSubscriptions();

        this.peersTab = this.tabPanel.addTab('Peers');
        const sessionContainer = this.peersTab.container;
        let currentPage = 0;
        const playersPerPage = 4;

        // 1. Header Row (for actions like Copy Invite)
        const headerContainer = new UIElement(0, 20, 1280, 80);
        sessionContainer.addChild(headerContainer);

        // 2. List Container (shifted down)
        const listContainer = new UIElement(0, 110, 1280, 500);
        sessionContainer.addChild(listContainer);

        const pageLabel = new UILabel("Page 1/1", 540, 640, 200, 60);
        pageLabel.font = getFont(UITheme.typography.sizes.small);
        pageLabel.textColor = UITheme.colors.textMuted;
        pageLabel.textAlign = 'center';

        const renderList = () => {
            if (this.peersTab && !this.peersTab.container.children.includes(listContainer)) {
                // If the list is no longer in the container (tab switched), skip
                return;
            }
            listContainer.clearChildren();

            // Gather all players (Local + Remote)
            interface IPeerRow {
                id: string;
                name: string;
                avatarColor: string | number;
                isLocal: boolean;
                audioLevel: number;
                isMuted?: boolean;
                micEnabled?: boolean;
                player?: PlayerAvatarEntity;
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
                audioLevel: this.context.runtime.media ? this.context.runtime.media.getLocalVolume() : 0,
                micEnabled: this.context.voiceEnabled
            });

            // 2. Add Remote Players
            for (const entity of this.context.runtime.entity.entities.values()) {
                if (entity.type === EntityType.PLAYER_AVATAR && (entity as PlayerAvatarEntity).controlMode === 'remote') {
                    const rp = entity as PlayerAvatarEntity;
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
                const isHost = peer.id === this.context.sessionId || (peer.isLocal && this.context.isHost);
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
                        const localPlayer = this.context.localPlayer as PlayerAvatarEntity;
                        if (localPlayer && localPlayer.teleportTo && peer.targetPos && peer.targetYaw !== undefined) {
                            const targetPos = new THREE.Vector3(peer.targetPos.x, peer.targetPos.y, peer.targetPos.z);
                            const targetYaw = peer.targetYaw;
                            const offset = new THREE.Vector3(0, 0, 1.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
                            const finalPos = targetPos.clone().add(offset);
                            const finalYaw = targetYaw;
                            localPlayer.teleportTo(finalPos, finalYaw, { targetSpace: 'player' });

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
            const isVR = this.context.runtime.render?.isXRPresenting();
            if (this.context.isMenuOpen || isVR) {
                renderList();
            }
        };

        eventBus.on(EVENTS.VOICE_STATE_UPDATED, this.onPeerUpdateHandler);
        eventBus.on(EVENTS.PEER_STATE_UPDATED, this.onPeerUpdateHandler);
        eventBus.on(EVENTS.PEER_JOINED_SESSION, this.onPeerUpdateHandler);
        eventBus.on(EVENTS.PEER_DISCONNECTED, this.onPeerUpdateHandler);

        // Periodically refresh for Talking indicators if menu is visible
        this.peersTalkingInterval = setInterval(() => {
            const isVR = this.context.runtime.render?.isXRPresenting();
            if (this.context.isMenuOpen || isVR) {
                renderList();
            }
        }, 500);

        // 3. Header Controls
        const micBtn = new UIButton("Mic: ON", 240, 10, 380, 60, () => {
            const nextPreference = !this.context.voiceAutoEnable;
            this.context.voiceAutoEnable = nextPreference;
            localStorage.setItem('hangout_voiceEnabled', String(nextPreference));
            this.context.runtime.media.setMicrophoneEnabled(nextPreference).then((actualState) => {
                this.context.voiceEnabled = actualState;
            });
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
            const url = window.location.origin + window.location.pathname + "?session=" + this.context.sessionId;
            navigator.clipboard.writeText(url).then(() => {
                copyBtn.text = "Copied!";
                this.tablet?.ui.markDirty();
                setTimeout(() => {
                    copyBtn.text = "Copy Invite Link";
                    this.tablet?.ui.markDirty();
                }, 2000);
            }).catch(() => {
                copyBtn.text = "Copy Failed";
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
            for (const entity of this.context.runtime.entity.entities.values()) {
                if (entity.type === EntityType.PLAYER_AVATAR && (entity as PlayerAvatarEntity).controlMode === 'remote') totalPeers++;
            }
            const totalPages = Math.max(1, Math.ceil(totalPeers / playersPerPage));
            if (currentPage < totalPages - 1) {
                currentPage++;
                renderList();
            }
        });

        sessionContainer.addChild(prevBtn);
        sessionContainer.addChild(pageLabel);
        sessionContainer.addChild(nextBtn);

        // Hook up auto-refresh events.
        this.scheduleRenderHandler = () => { setTimeout(renderList, 100); };
        eventBus.on(EVENTS.ENTITY_DISCOVERED, this.scheduleRenderHandler);
        eventBus.on(EVENTS.PEER_DISCONNECTED, this.scheduleRenderHandler);
        eventBus.on(EVENTS.REMOTE_NAME_UPDATED, this.scheduleRenderHandler);

        // Initial render
        renderList();
    }

    private addSystemTab() {
        if (!this.tabPanel) return;

        this.systemTab = this.tabPanel.addTab('System');
        const systemContainer = this.systemTab.container;

        const title = new UILabel("System", 50, 50, 1180, 80);
        title.font = getFont(UITheme.typography.sizes.title, 'bold');
        title.textColor = UITheme.colors.primary;
        title.textAlign = 'center';
        systemContainer.addChild(title);

        const leaveBtn = new UIButton("Leave Session", 440, 630, 400, 80, () => {
            const render = this.context.runtime.render;
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
    }

    private addSessionTab() {
        if (!this.tabPanel) return;

        this.sessionTab = this.tabPanel.addTab('Session');
        const sessionContainer = this.sessionTab.container;

        const desktop = this.context.runtime.remoteDesktop;

        const title = new UILabel('Remote Screens', 50, 30, 1180, 70);
        title.font = getFont(UITheme.typography.sizes.title, 'bold');
        title.textColor = UITheme.colors.primary;
        title.textAlign = 'center';
        sessionContainer.addChild(title);

        const subtitle = new UILabel('Manage your pre-configured global desktop sources', 70, 90, 1140, 40);
        subtitle.font = getFont(UITheme.typography.sizes.small);
        subtitle.textColor = UITheme.colors.textMuted;
        subtitle.textAlign = 'center';
        sessionContainer.addChild(subtitle);

        const refreshBtn = new UIButton('Refresh Status', 420, 140, 440, 70, () => {
            desktop.requestSourceStatus();
        });
        refreshBtn.cornerRadius = 10;
        sessionContainer.addChild(refreshBtn);

        const listContainer = new UIElement(40, 240, 1200, 500);
        sessionContainer.addChild(listContainer);

        const renderList = () => {
            listContainer.clearChildren();
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
            renderList();
        };
        this.onDesktopResubscribeHandler = () => {
            desktop.requestSourceStatus();
            renderList();
        };

        eventBus.on(EVENTS.DESKTOP_SCREENS_UPDATED, this.onDesktopUpdateHandler);
        eventBus.on(EVENTS.SESSION_CONNECTED, this.onDesktopResubscribeHandler);
        eventBus.on(EVENTS.PEER_JOINED_SESSION, this.onDesktopResubscribeHandler);
        desktop.requestSourceStatus();
        renderList();
    }

    private addDebugTab() {
        if (!this.tabPanel) return;

        const debugTab = this.tabPanel.addTab('Debug');
        const debugContainer = debugTab.container;

        if (this.debugStatsInterval) {
            clearInterval(this.debugStatsInterval);
            this.debugStatsInterval = null;
        }

        const debugManager = this.context.runtime.debugRender;
        const debugSettings = debugManager?.getSettings();

        const overlayToggle = new UIToggle(
            "Enable Debug Overlay",
            debugSettings?.enabled ?? false,
            90, 70, 620, 52,
            (checked) => {
                debugManager?.setEnabled(checked);
                this.tablet?.ui.markDirty();
            }
        );
        debugContainer.addChild(overlayToggle);

        const collidersToggle = new UIToggle(
            "Show Colliders",
            debugSettings?.showColliders ?? true,
            760, 70, 420, 52,
            (checked) => {
                debugManager?.setShowColliders(checked);
                this.tablet?.ui.markDirty();
            }
        );
        debugContainer.addChild(collidersToggle);

        const axesToggle = new UIToggle(
            "Show Axes",
            debugSettings?.showAxes ?? true,
            760, 126, 420, 52,
            (checked) => {
                debugManager?.setShowAxes(checked);
                this.tablet?.ui.markDirty();
            }
        );
        debugContainer.addChild(axesToggle);

        const authorityToggle = new UIToggle(
            "Show Authority Labels",
            debugSettings?.showAuthorityLabels ?? true,
            90, 126, 620, 52,
            (checked) => {
                debugManager?.setShowAuthorityLabels(checked);
                this.tablet?.ui.markDirty();
            }
        );
        debugContainer.addChild(authorityToggle);

        const physics = this.context.runtime.physics;
        const diagnostics = this.context.runtime.diagnostics;

        const formatBytes = (bytes: number): string => {
            if (bytes >= 1024 * 1024) {
                return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
            }
            if (bytes >= 1024) {
                return `${(bytes / 1024).toFixed(1)} KB`;
            }
            return `${Math.round(bytes)} B`;
        };

        const truncate = (text: string, maxLen: number): string => {
            if (text.length <= maxLen) return text;
            return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
        };

        const networkLabel = new UILabel("Network", 90, 220, 300, 42);
        networkLabel.font = getFont(UITheme.typography.sizes.body, 'bold');
        networkLabel.textColor = UITheme.colors.accent;
        networkLabel.textAlign = 'left';
        debugContainer.addChild(networkLabel);

        const networkLineOne = new UILabel("", 90, 260, 1080, 38);
        networkLineOne.font = getFont(UITheme.typography.sizes.small, 'bold');
        networkLineOne.textColor = UITheme.colors.text;
        networkLineOne.textAlign = 'left';
        debugContainer.addChild(networkLineOne);

        const networkLineTwo = new UILabel("", 90, 298, 1080, 38);
        networkLineTwo.font = getFont(UITheme.typography.sizes.small, 'bold');
        networkLineTwo.textColor = UITheme.colors.text;
        networkLineTwo.textAlign = 'left';
        debugContainer.addChild(networkLineTwo);

        const networkLatencyLine = new UILabel("", 90, 336, 1080, 38);
        networkLatencyLine.font = getFont(UITheme.typography.sizes.small, 'bold');
        networkLatencyLine.textColor = UITheme.colors.text;
        networkLatencyLine.textAlign = 'left';
        debugContainer.addChild(networkLatencyLine);

        const networkEventLine = new UILabel("", 90, 374, 1080, 38);
        networkEventLine.font = getFont(UITheme.typography.sizes.small);
        networkEventLine.textColor = UITheme.colors.textMuted;
        networkEventLine.textAlign = 'left';
        debugContainer.addChild(networkEventLine);

        const scenarioLabel = new UILabel("Scenarios", 90, 438, 300, 42);
        scenarioLabel.font = getFont(UITheme.typography.sizes.body, 'bold');
        scenarioLabel.textColor = UITheme.colors.accent;
        scenarioLabel.textAlign = 'left';
        debugContainer.addChild(scenarioLabel);

        const scenarios = this.context.runtime.session.getAvailableScenarios().slice(0, 3);
        scenarios.forEach((scenario, index) => {
            const button = new UIButton(scenario.displayName, 90 + (index * 340), 478, 320, 58, () => {
                this.context.runtime.network.requestSessionConfigUpdate({
                    activeScenarioId: scenario.id
                });
                this.tablet?.ui.markDirty();
            });
            button.cornerRadius = 10;
            button.borderColor = UITheme.colors.secondary;
            debugContainer.addChild(button);
        });

        const spawnBeaconBtn = new UIButton("Spawn Debug Beacon", 90, 578, 360, 60, () => {
            const localPlayer = this.context.localPlayer;
            const targetPosition = localPlayer
                ? {
                    x: localPlayer.headState.position.x,
                    y: localPlayer.headState.position.y - 0.2,
                    z: localPlayer.headState.position.z
                }
                : { x: 0, y: 1.2, z: -1.8 };

            if (localPlayer) {
                const forward = new THREE.Vector3(0, 0, -1);
                const headQuat = new THREE.Quaternion(
                    localPlayer.headState.quaternion.x,
                    localPlayer.headState.quaternion.y,
                    localPlayer.headState.quaternion.z,
                    localPlayer.headState.quaternion.w
                );
                forward.applyQuaternion(headQuat).multiplyScalar(1.1);
                targetPosition.x += forward.x;
                targetPosition.y += Math.max(-0.1, forward.y);
                targetPosition.z += forward.z;
            }

            this.context.runtime.session.spawnObjectModule('debug-beacon', {
                position: targetPosition
            });
            this.tablet?.ui.markDirty();
        });
        spawnBeaconBtn.cornerRadius = 10;
        spawnBeaconBtn.borderColor = UITheme.colors.secondary;
        debugContainer.addChild(spawnBeaconBtn);

        const statsLabel = new UILabel("", 90, 678, 1080, 42);
        statsLabel.font = getFont(UITheme.typography.sizes.small, 'bold');
        statsLabel.textColor = UITheme.colors.accent;
        statsLabel.textAlign = 'left';
        debugContainer.addChild(statsLabel);

        const updateStats = () => {
            const network = this.context.runtime.network.getDebugStatus();
            const recentEntry = diagnostics.getRecentEntries(1)[0];
            const avg = physics.getTouchQueryAverageHitsPerFrame();
            networkLineOne.text = `Role: ${network.role}  Transport: ${network.transport}  Peers: ${network.peers}`;
            networkLineTwo.text = `TX: ${formatBytes(network.txBps)}/s (${formatBytes(network.txTotal)})  RX: ${formatBytes(network.rxBps)}/s (${formatBytes(network.rxTotal)})`;
            networkLatencyLine.text = network.lastRttMs !== null
                ? `Latency: RTT ${network.lastRttMs.toFixed(0)} ms  Avg ${network.avgRttMs?.toFixed(0) ?? '-'} ms  Jitter ${network.jitterMs?.toFixed(0) ?? '-'} ms  Samples ${network.latencySamples}`
                : 'Latency: waiting for probe data';
            networkEventLine.text = recentEntry
                ? truncate(`Last ${recentEntry.category}/${recentEntry.level}: ${recentEntry.message}`, 110)
                : 'Last: no recent events';
            statsLabel.text = `Touch Query Hits/frame (avg 1s): ${avg.toFixed(2)}`;
            this.tablet?.ui.markDirty();
        };

        updateStats();
        this.debugStatsInterval = setInterval(updateStats, 500);
    }

    private addHelpTab() {
        if (!this.tabPanel) return;

        const helpTab = this.tabPanel.addTab('Help');
        const container = helpTab.container;
        let currentMode: 'VR' | 'Desktop' | 'Touch' = 'VR';

        const contentArea = new UIElement(50, 150, 1180, 600);
        container.addChild(contentArea);

        const navButtons: UIButton[] = [];

        const renderHelp = () => {
            contentArea.clearChildren();

            const panel = new UIElement(40, 10, 1100, 520);
            panel.cornerRadius = 18;
            panel.backgroundColor = UITheme.colors.panelBg;
            panel.borderColor = UITheme.colors.primary;
            panel.borderWidth = 3;
            contentArea.addChild(panel);

            const help = this.getHelpContentForMode(currentMode);
            const title = new UILabel(`${currentMode} Controls`, 0, 18, 1100, 54);
            title.font = getFont(UITheme.typography.sizes.title, 'bold');
            title.textColor = UITheme.colors.primary;
            title.textAlign = 'center';
            panel.addChild(title);

            const divider = new UIElement(548, 92, 4, 310);
            divider.backgroundColor = UITheme.colors.panelBgHover;
            divider.borderWidth = 0;
            divider.cornerRadius = 2;
            panel.addChild(divider);

            const leftTitle = new UILabel(help.leftTitle, 50, 96, 430, 40);
            leftTitle.font = getFont(UITheme.typography.sizes.body, 'bold');
            leftTitle.textColor = UITheme.colors.accent;
            leftTitle.textAlign = 'left';
            panel.addChild(leftTitle);

            const rightTitle = new UILabel(help.rightTitle, 620, 96, 430, 40);
            rightTitle.font = getFont(UITheme.typography.sizes.body, 'bold');
            rightTitle.textColor = UITheme.colors.accent;
            rightTitle.textAlign = 'left';
            panel.addChild(rightTitle);
            help.leftItems.forEach((item, index) => {
                const text = item;
                const line = new UILabel(text, 50, 144 + index * 38, 430, 34);
                line.font = getFont(UITheme.typography.sizes.small);
                line.textColor = UITheme.colors.text;
                panel.addChild(line);
            });

            help.rightItems.forEach((item, index) => {
                const line = new UILabel(item, 620, 144 + index * 38, 430, 34);
                line.font = getFont(UITheme.typography.sizes.small);
                line.textColor = UITheme.colors.text;
                panel.addChild(line);
            });

            const footer = new UILabel(help.footer, 60, 448, 980, 42);
            footer.font = getFont(UITheme.typography.sizes.small, 'bold');
            footer.textColor = UITheme.colors.textMuted;
            footer.textAlign = 'center';
            panel.addChild(footer);

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
    }

    private getHelpContentForMode(mode: 'VR' | 'Desktop' | 'Touch'): {
        leftTitle: string;
        leftItems: string[];
        rightTitle: string;
        rightItems: string[];
        footer: string;
    } {
        switch (mode) {
            case 'VR':
                return {
                    leftTitle: 'Controllers',
                    leftItems: [
                        'Move: Left thumbstick',
                        'Turn: Right thumbstick',
                        'Grab / Hold: Left or right grip',
                        'Use / Select: Left or right trigger',
                        'Menu: Left controller menu button'
                    ],
                    rightTitle: 'Hand Tracking',
                    rightItems: [
                        'Select / Click: Pinch thumb + index',
                        'Grab / Hold: Close fist (grasp)',
                        'Aim: Point with open hand',
                        'Release: Open hand again'
                    ],
                    footer: 'VR is the best mode to experience The Hangout.'
                };
            case 'Desktop':
                return {
                    leftTitle: 'Movement',
                    leftItems: [
                        'Move: W, A, S, D | Left Analog Stick',
                        'Look: Mouse | Right Analog Stick',
                        'Menu: M',
                        'Reach Distance: Mouse wheel'
                    ],
                    rightTitle: 'Hands / Actions',
                    rightItems: [
                        'Grab: Left click | Left Trigger',
                        'Interact: Right click | Right Trigger',
                        'Left Hand Active: Q',
                        'Right Hand Active: E'
                    ],
                    footer: 'Desktop mode allows you to use The Hangout with a keyboard and mouse or a game controller.'
                };
            case 'Touch':
                return {
                    leftTitle: 'Movement',
                    leftItems: [
                        'Move: Left virtual joystick',
                        'Look: Right virtual joystick',
                        'Menu: HUD toggle button'
                    ],
                    rightTitle: 'Interaction',
                    rightItems: [
                        'Tap grab button to reach',
                        'Tap interact to use a hold object',
                        'Use two thumbs for dual-stick control',
                    ],
                    footer: 'For a quick hangout join with mobile.'
                };
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
        this.updateHandLocomotionIndicator();

        if (this.tablet) {
            // Update 3D visibility based on VR state vs Desktop Menu
            const isVR = this.context.runtime.render?.isXRPresenting();
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
        this.hide2DMenu();
        if (this.debugStatsInterval) {
            clearInterval(this.debugStatsInterval);
            this.debugStatsInterval = null;
        }
        if (this.keyboardHandler) {
            window.removeEventListener('keydown', this.keyboardHandler);
            this.keyboardHandler = null;
        }
        if (this.menuIntentHandler) {
            eventBus.off(EVENTS.INTENT_MENU_TOGGLE, this.menuIntentHandler);
            this.menuIntentHandler = null;
        }
        this.controllerCursor.destroy();
        if (this.handLocomotionLine) {
            this.handLocomotionLine.geometry.dispose();
            (this.handLocomotionLine.material as THREE.Material).dispose();
            this.handLocomotionLine.removeFromParent();
            this.handLocomotionLine = null;
        }
        if (this.handLocomotionShell) {
            this.handLocomotionShell.geometry.dispose();
            (this.handLocomotionShell.material as THREE.Material).dispose();
            this.handLocomotionShell.removeFromParent();
            this.handLocomotionShell = null;
        }
        if (this.handLocomotionAnchor) {
            this.handLocomotionAnchor.geometry.dispose();
            (this.handLocomotionAnchor.material as THREE.Material).dispose();
            this.handLocomotionAnchor.removeFromParent();
            this.handLocomotionAnchor = null;
        }
        if (this.handLocomotionCurrent) {
            this.handLocomotionCurrent.geometry.dispose();
            (this.handLocomotionCurrent.material as THREE.Material).dispose();
            this.handLocomotionCurrent.removeFromParent();
            this.handLocomotionCurrent = null;
        }
        if (this.handLocomotionIndicator) {
            this.handLocomotionIndicator.removeFromParent();
            this.handLocomotionIndicator.clear();
            this.handLocomotionIndicator = null;
        }
        if (this.tablet) {
            const canvas = this.tablet.ui.canvas;
            if (this.canvasMouseMoveHandler) {
                canvas.removeEventListener('mousemove', this.canvasMouseMoveHandler);
                this.canvasMouseMoveHandler = null;
            }
            if (this.canvasClickHandler) {
                canvas.removeEventListener('click', this.canvasClickHandler);
                this.canvasClickHandler = null;
            }

            this.context.runtime.render?.scene.remove(this.tablet.mesh);
            this.context.runtime.entity?.removeEntity(this.tablet.id);
            this.tablet.destroy();
            this.tablet = null;
        }
        this.tabPanel = null;
        this.overlayContainer = null;
    }

}
