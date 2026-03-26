import { AppContext } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { TabletSurfaceEntity } from '../../world/entities/TabletSurfaceEntity';
import { UITabPanel, UIElement, UIButton, UILabel, UIToggle, UITab } from '../shared/canvasui';
import { UITheme, getFont } from '../shared/UITheme';
import { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import { EntityType } from '../../shared/contracts/IEntityState';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { formatPlayerDisplayName } from '../../shared/utils/PlayerBadgeUtils';
import { AppLocalStorage } from '../../shared/storage/AppLocalStorage';
import { ControllerPointer } from '../shared/ControllerPointer';
import * as THREE from 'three';
import { GrabSkill } from '../../skills/GrabSkill';
import { ConfigRegistry } from '../../shared/config/ConfigRegistry';

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
    private menuOrb: THREE.Mesh | null = null;
    private menuOrbCore: THREE.Mesh | null = null;
    private interactOrb: THREE.Mesh | null = null;
    private exitXrButton: UIButton | null = null;

    private peersTab: UITab | null = null;
    private sessionTab: UITab | null = null;
    private systemTab: UITab | null = null;
    private refreshPeersList: (() => void) | null = null;
    private peersRefreshCleanup: (() => void) | null = null;
    private sessionMicRefreshHandler: (() => void) | null = null;
    private desktopRefreshCleanup: (() => void) | null = null;
    private menuIntentHandler: (() => void) | null = null;
    private menuOpenRecenterIntentHandler: (() => void) | null = null;
    private hasInitialVrMenuRecentered = false;
    private spawnerRefreshCleanup: (() => void) | null = null;
    private wasXrPresentingLastFrame = false;
    private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
    private canvasMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
    private canvasClickHandler: ((e: MouseEvent) => void) | null = null;
    private canvasMouseLeaveHandler: ((e: MouseEvent) => void) | null = null;
    private debugStatsInterval: ReturnType<typeof setInterval> | null = null;
    private sessionMicMeterInterval: ReturnType<typeof setInterval> | null = null;
    private scenarioRefreshCleanup: (() => void) | null = null;
    private readonly tabVisibleRefreshWatchers: Array<{
        tabGetter: () => UITab | null;
        refresh: () => void;
        wasVisible: boolean;
    }> = [];
    private readonly tempUpAxis = new THREE.Vector3(0, 1, 0);
    private readonly tempHeadPosition = new THREE.Vector3();
    private readonly tempHeadQuaternion = new THREE.Quaternion();
    private readonly tempHeadEuler = new THREE.Euler();
    private readonly tempCenterOffset = new THREE.Vector3();
    private readonly tempMenuOffsetLocal = new THREE.Vector3();
    private readonly tempMenuOffsetWorld = new THREE.Vector3();
    private readonly tempWristWorld = new THREE.Vector3();
    private readonly tempWristWorldQuat = new THREE.Quaternion();
    private readonly tempOrbLocalOffset = new THREE.Vector3();
    private readonly tempOrbWorld = new THREE.Vector3();
    private readonly tempFreeHandWorld = new THREE.Vector3();
    private readonly menuOrbLongPressThresholdSec = 0.65;
    private readonly menuOrbPressState: Record<'left' | 'right', {
        wasPinchingInside: boolean;
        holdSec: number;
        longFired: boolean;
    }> = {
            left: { wasPinchingInside: false, holdSec: 0, longFired: false },
            right: { wasPinchingInside: false, holdSec: 0, longFired: false }
        };
    private readonly handUiPointerBlocked: Record<'left' | 'right', boolean> = {
        left: false,
        right: false
    };

    constructor(private context: AppContext) {
        this.controllerCursor = new ControllerPointer('vr-menu-controller-cursor');
    }

    private shouldRefreshTabUi(tab: UITab | null): boolean {
        if (!this.tablet || !tab || !this.context.isMenuOpen) {
            return false;
        }

        if (!tab.container.isVisible) {
            return false;
        }

        const isVR = !!this.context.runtime.render?.isXRPresenting();
        if (isVR && !this.tablet.mesh.visible) {
            return false;
        }

        return true;
    }

    private createPlainContainer(x: number, y: number, width: number, height: number): UIElement {
        const container = new UIElement(x, y, width, height);
        container.backgroundColor = 'transparent';
        container.borderWidth = 0;
        return container;
    }

    private createTabTitle(text: string, x: number, y: number, width: number, height: number, align: CanvasTextAlign = 'center'): UILabel {
        const label = new UILabel(text, x, y, width, height);
        label.font = getFont(UITheme.typography.sizes.title, 'bold');
        label.textColor = UITheme.colors.primary;
        label.textAlign = align;
        return label;
    }

    private registerTabRefresh(
        tabGetter: () => UITab | null,
        refresh: () => void,
        options: {
            events?: string[];
            delayedEvents?: string[];
            delayMs?: number;
            intervalMs?: number;
            refreshOnVisible?: boolean;
        } = {}
    ): () => void {
        const handlers: Array<{ event: string; handler: () => void }> = [];
        const timeoutIds = new Set<ReturnType<typeof setTimeout>>();
        let intervalId: ReturnType<typeof setInterval> | null = null;
        let visibleWatcher: {
            tabGetter: () => UITab | null;
            refresh: () => void;
            wasVisible: boolean;
        } | null = null;

        const runIfVisible = () => {
            if (this.shouldRefreshTabUi(tabGetter())) {
                refresh();
            }
        };

        for (const eventName of options.events || []) {
            const handler = () => runIfVisible();
            handlers.push({ event: eventName, handler });
            eventBus.on(eventName as any, handler);
        }

        const delayMs = options.delayMs ?? 100;
        for (const eventName of options.delayedEvents || []) {
            const handler = () => {
                const timeoutId = setTimeout(() => {
                    timeoutIds.delete(timeoutId);
                    runIfVisible();
                }, delayMs);
                timeoutIds.add(timeoutId);
            };
            handlers.push({ event: eventName, handler });
            eventBus.on(eventName as any, handler);
        }

        if (options.intervalMs && options.intervalMs > 0) {
            intervalId = setInterval(() => runIfVisible(), options.intervalMs);
        }

        if (options.refreshOnVisible) {
            visibleWatcher = { tabGetter, refresh, wasVisible: false };
            this.tabVisibleRefreshWatchers.push(visibleWatcher);
        }

        return () => {
            for (const { event, handler } of handlers) {
                eventBus.off(event as any, handler);
            }
            for (const timeoutId of timeoutIds) {
                clearTimeout(timeoutId);
            }
            timeoutIds.clear();
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            if (visibleWatcher) {
                const idx = this.tabVisibleRefreshWatchers.indexOf(visibleWatcher);
                if (idx !== -1) {
                    this.tabVisibleRefreshWatchers.splice(idx, 1);
                }
                visibleWatcher = null;
            }
        };
    }

    public init(): void {
        this.initHandLocomotionIndicator();

        // Create the Tablet Entity
        this.tablet = new TabletSurfaceEntity(this.context, 'local-tablet');
        this.tablet.ui.onActionHandled = () => {
            this.context.runtime.audio?.playUiClick();
        };

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
        this.addScenarioTab();
        this.addDebugTab();
        this.addHelpTab();
        this.addSpawnerTab();

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

        const menuOrb = new THREE.Mesh(
            new THREE.SphereGeometry(0.022, 16, 16),
            new THREE.MeshBasicMaterial({
                color: 0x4a5d6b,
                transparent: true,
                opacity: 0.22,
                depthWrite: false
            })
        );
        const menuOrbCore = new THREE.Mesh(
            new THREE.SphereGeometry(0.011, 16, 16),
            new THREE.MeshBasicMaterial({
                color: 0x9ec9ff,
                transparent: true,
                opacity: 0.0,
                depthWrite: false
            })
        );
        menuOrbCore.scale.setScalar(0.1);
        menuOrb.add(menuOrbCore);
        menuOrb.visible = false;
        render.scene.add(menuOrb);
        this.menuOrb = menuOrb;
        this.menuOrbCore = menuOrbCore;

        const interactOrb = new THREE.Mesh(
            new THREE.SphereGeometry(0.022, 16, 16),
            new THREE.MeshBasicMaterial({
                color: 0x3f8f6b,
                transparent: true,
                opacity: 0.22,
                depthWrite: false
            })
        );
        interactOrb.visible = false;
        render.scene.add(interactOrb);
        this.interactOrb = interactOrb;
    }

    private applyToggleOrbVisual(
        mesh: THREE.Mesh,
        isHovering: boolean,
        isActive: boolean,
        colors: { off: number; hover: number; on: number }
    ): void {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.color.setHex(isActive ? colors.on : (isHovering ? colors.hover : colors.off));
        material.opacity = isActive ? 0.45 : (isHovering ? 0.34 : 0.22);
    }

    private applyMenuOrbVisual(isHovering: boolean, isPressing: boolean, isReady: boolean, progressNorm: number): void {
        const menuOrb = this.menuOrb;
        const menuOrbCore = this.menuOrbCore;
        if (!menuOrb || !menuOrbCore) return;

        const outerMaterial = menuOrb.material as THREE.MeshBasicMaterial;
        if (isReady) {
            outerMaterial.color.setHex(0x64ffd2);
            outerMaterial.opacity = 0.52;
        } else if (isPressing) {
            outerMaterial.color.setHex(0x8de3ff);
            outerMaterial.opacity = 0.44;
        } else if (isHovering) {
            outerMaterial.color.setHex(0xa8d7ff);
            outerMaterial.opacity = 0.34;
        } else {
            outerMaterial.color.setHex(0x4a5d6b);
            outerMaterial.opacity = 0.22;
        }

        const coreMaterial = menuOrbCore.material as THREE.MeshBasicMaterial;
        if (!isPressing && !isReady) {
            coreMaterial.opacity = 0;
            menuOrbCore.scale.setScalar(0.1);
            return;
        }

        const t = Math.max(0, Math.min(1, progressNorm));
        coreMaterial.color.setHex(isReady ? 0x79ffb8 : 0x8fe6ff);
        coreMaterial.opacity = isReady ? 0.95 : (0.28 + 0.52 * t);
        menuOrbCore.scale.setScalar(0.1 + 0.82 * t);
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

        const headPosition = this.tempHeadPosition;
        const headQuaternion = this.tempHeadQuaternion;
        const headEuler = this.tempHeadEuler;
        const centerOffset = this.tempCenterOffset.set(
            state.centerOffsetHeadLocal.x,
            state.centerOffsetHeadLocal.y,
            state.centerOffsetHeadLocal.z
        );
        render.camera.getWorldPosition(headPosition);
        render.camera.getWorldQuaternion(headQuaternion);
        headEuler.setFromQuaternion(headQuaternion, 'YXZ');
        centerOffset.applyAxisAngle(this.tempUpAxis, headEuler.y);

        indicator.visible = true;
        indicator.position.copy(headPosition).add(centerOffset);
        indicator.quaternion.setFromAxisAngle(this.tempUpAxis, state.frameYaw);
        shell.scale.setScalar(state.radius);
        const shellMaterial = shell.material as THREE.MeshBasicMaterial;
        shellMaterial.opacity = state.isActive ? 0.08 : 0.12;
        shellMaterial.color.setHex(state.isHovering ? 0x99ffff : 0x66ffff);

        anchor.position.set(state.anchorLocal.x, state.anchorLocal.y, state.anchorLocal.z);
        current.position.set(state.currentLocal.x, state.currentLocal.y, state.currentLocal.z);

        anchor.visible = state.showMotion;
        current.visible = state.showMotion;
        line.visible = state.showMotion;

        if (state.showMotion) {
            const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
            positions.setXYZ(0, anchor.position.x, anchor.position.y, anchor.position.z);
            positions.setXYZ(1, current.position.x, current.position.y, current.position.z);
            positions.needsUpdate = true;
            line.geometry.computeBoundingSphere();
        }
    }

    private updateMenuOrb(delta: number): void {
        const render = this.context.runtime.render;
        const menuOrb = this.menuOrb;
        const menuOrbCore = this.menuOrbCore;
        const indicatorState = this.context.runtime.input?.xrInput.getLeftHandLocomotionIndicatorState() || null;

        if (!render || !menuOrb || !menuOrbCore || !render.isXRPresenting() || !indicatorState?.visible) {
            if (menuOrb) menuOrb.visible = false;
            if (menuOrbCore) {
                const coreMaterial = menuOrbCore.material as THREE.MeshBasicMaterial;
                coreMaterial.opacity = 0;
                menuOrbCore.scale.setScalar(0.1);
            }
            this.handUiPointerBlocked.left = false;
            this.handUiPointerBlocked.right = false;
            this.resetMenuOrbPressState();
            return;
        }

        const headPosition = this.tempHeadPosition;
        const headQuaternion = this.tempHeadQuaternion;
        const headEuler = this.tempHeadEuler;
        const centerOffset = this.tempCenterOffset.set(
            indicatorState.centerOffsetHeadLocal.x,
            indicatorState.centerOffsetHeadLocal.y,
            indicatorState.centerOffsetHeadLocal.z
        );
        render.camera.getWorldPosition(headPosition);
        render.camera.getWorldQuaternion(headQuaternion);
        headEuler.setFromQuaternion(headQuaternion, 'YXZ');
        centerOffset.applyAxisAngle(this.tempUpAxis, headEuler.y);

        const menuOffsetLocal = this.tempMenuOffsetLocal.set(
            -indicatorState.radius * 1.45,
            indicatorState.radius * 1.45,
            0
        );

        menuOrb.visible = true;
        this.tempMenuOffsetWorld.copy(menuOffsetLocal).applyAxisAngle(this.tempUpAxis, headEuler.y);
        menuOrb.position.copy(headPosition).add(centerOffset).add(this.tempMenuOffsetWorld);

        const menuRadius = indicatorState.radius * 0.33;
        menuOrb.scale.setScalar(menuRadius / 0.022);
        this.handUiPointerBlocked.left = false;
        this.handUiPointerBlocked.right = false;

        let isHovering = false;
        let isPressing = false;
        let isReady = false;
        let maxProgressNorm = 0;
        for (const hand of ['left', 'right'] as const) {
            const probe = this.context.runtime.input?.xrInput.getHandUiProbe(hand);
            const state = this.menuOrbPressState[hand];
            if (!probe?.tracked) {
                state.wasPinchingInside = false;
                state.holdSec = 0;
                state.longFired = false;
                continue;
            }

            const dx = probe.currentLocal.x - menuOffsetLocal.x;
            const dy = probe.currentLocal.y - menuOffsetLocal.y;
            const dz = probe.currentLocal.z - menuOffsetLocal.z;
            const inside = (dx * dx + dy * dy + dz * dz) <= (menuRadius * menuRadius);
            const pinchingInside = inside && probe.pinchActive;
            if (inside) {
                this.handUiPointerBlocked[hand] = true;
            }

            if (inside) {
                isHovering = true;
            }

            if (pinchingInside) {
                isPressing = true;
                if (!state.wasPinchingInside) {
                    state.wasPinchingInside = true;
                    state.holdSec = 0;
                    state.longFired = false;
                } else {
                    state.holdSec += Math.max(0, delta);
                    if (!state.longFired && state.holdSec >= this.menuOrbLongPressThresholdSec) {
                        state.longFired = true;
                        eventBus.emit(EVENTS.INTENT_MENU_OPEN_RECENTER);
                        this.context.runtime.audio?.playUiToggle(true);
                    }
                }
                const progressNorm = Math.max(0, Math.min(1, state.holdSec / this.menuOrbLongPressThresholdSec));
                maxProgressNorm = Math.max(maxProgressNorm, progressNorm);
                if (state.longFired) {
                    isReady = true;
                    maxProgressNorm = 1;
                }
                continue;
            }

            if (state.wasPinchingInside) {
                if (!probe.pinchActive) {
                    if (!state.longFired) {
                        const nextState = !this.context.isMenuOpen;
                        eventBus.emit(EVENTS.INTENT_MENU_TOGGLE);
                        this.context.runtime.audio?.playUiToggle(nextState);
                    }
                    state.wasPinchingInside = false;
                    state.holdSec = 0;
                    state.longFired = false;
                    continue;
                }

                // Gesture moved out of the sphere while still pinching: cancel this press.
                state.wasPinchingInside = false;
                state.holdSec = 0;
                state.longFired = false;
                continue;
            }

            state.holdSec = 0;
            state.longFired = false;
            state.wasPinchingInside = false;
        }
        this.applyMenuOrbVisual(isHovering, isPressing, isReady, maxProgressNorm);
    }

    private resetMenuOrbPressState(): void {
        for (const hand of ['left', 'right'] as const) {
            const state = this.menuOrbPressState[hand];
            state.wasPinchingInside = false;
            state.holdSec = 0;
            state.longFired = false;
        }
    }

    private updateInteractionOrb(): void {
        const render = this.context.runtime.render;
        const interactOrb = this.interactOrb;
        const indicatorState = this.context.runtime.input?.xrInput.getLeftHandLocomotionIndicatorState() || null;
        const grabSkill = this.context.localPlayer?.getSkill('grab');

        if (!render || !interactOrb || !render.isXRPresenting() || !indicatorState || !(grabSkill instanceof GrabSkill)) {
            if (interactOrb) interactOrb.visible = false;
            return;
        }

        const heldHand = grabSkill.getSingleInteractableHoldingHand();
        if (!heldHand) {
            interactOrb.visible = false;
            return;
        }

        const bubbleHand = heldHand === 'left' ? 'right' : 'left';
        const probe = this.context.runtime.input?.xrInput.getHandUiProbe(bubbleHand);
        const heldHandState = this.context.runtime.tracking.getState().hands[heldHand];
        if (!probe?.tracked || !heldHandState.active) {
            interactOrb.visible = false;
            return;
        }

        const wristPos = heldHandState.pose.position;
        const wristQuat = heldHandState.pose.quaternion;
        const wristWorld = this.tempWristWorld.set(wristPos.x, wristPos.y, wristPos.z);
        const wristWorldQuat = this.tempWristWorldQuat.set(wristQuat.x, wristQuat.y, wristQuat.z, wristQuat.w);

        const orbLocalOffset = this.tempOrbLocalOffset.set(
            heldHand === 'left' ? 0.045 : -0.045,
            0.015,
            0
        );
        const orbWorld = this.tempOrbWorld.copy(orbLocalOffset).applyQuaternion(wristWorldQuat).add(wristWorld);

        interactOrb.visible = true;
        interactOrb.position.copy(orbWorld);

        const orbRadius = indicatorState.radius * 0.33;
        interactOrb.scale.setScalar(orbRadius / 0.022);

        const freeHandPos = probe.currentLocal;
        const headPosition = this.tempHeadPosition;
        const headQuaternion = this.tempHeadQuaternion;
        const headEuler = this.tempHeadEuler;
        const centerOffset = this.tempCenterOffset.set(
            indicatorState.centerOffsetHeadLocal.x,
            indicatorState.centerOffsetHeadLocal.y,
            indicatorState.centerOffsetHeadLocal.z
        );
        render.camera.getWorldPosition(headPosition);
        render.camera.getWorldQuaternion(headQuaternion);
        headEuler.setFromQuaternion(headQuaternion, 'YXZ');
        centerOffset.applyAxisAngle(this.tempUpAxis, headEuler.y);
        const freeHandWorld = this.tempFreeHandWorld
            .set(freeHandPos.x, freeHandPos.y, freeHandPos.z)
            .applyAxisAngle(this.tempUpAxis, headEuler.y)
            .add(centerOffset)
            .add(headPosition);

        const isHovering = freeHandWorld.distanceToSquared(orbWorld) <= (orbRadius * orbRadius);

        if (isHovering && probe.pinchStarted) {
            const nextState = !this.context.runtime.input.isXRBubbleInteractionLatched(heldHand);
            this.context.runtime.input?.toggleXRBubbleInteraction(heldHand);
            this.context.runtime.audio?.playUiToggle(!!nextState);
        }

        const isActive = !!this.context.runtime.input?.isXRBubbleInteractionLatched(heldHand);
        this.applyToggleOrbVisual(interactOrb, isHovering, isActive, {
            off: 0x3f8f6b,
            hover: 0x8fe6bf,
            on: 0x79ffb5
        });
    }

    private setupMenuIntentHandler(): void {
        if (this.menuIntentHandler) {
            eventBus.off(EVENTS.INTENT_MENU_TOGGLE, this.menuIntentHandler);
        }
        if (this.menuOpenRecenterIntentHandler) {
            eventBus.off(EVENTS.INTENT_MENU_OPEN_RECENTER, this.menuOpenRecenterIntentHandler);
        }

        this.menuIntentHandler = () => {
            this.toggle2DMenu();
        };
        this.menuOpenRecenterIntentHandler = () => {
            this.openMenuWithRecenter();
        };

        eventBus.on(EVENTS.INTENT_MENU_TOGGLE, this.menuIntentHandler);
        eventBus.on(EVENTS.INTENT_MENU_OPEN_RECENTER, this.menuOpenRecenterIntentHandler);
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
        if (this.peersRefreshCleanup) {
            this.peersRefreshCleanup();
            this.peersRefreshCleanup = null;
        }
    }

    public toggle2DMenu(): void {
        const isVR = !!this.context.runtime.render?.isXRPresenting();
        this.context.isMenuOpen = !this.context.isMenuOpen;

        if (isVR) {
            if (this.context.isMenuOpen && !this.hasInitialVrMenuRecentered) {
                this.tablet?.recenterInFrontOfView();
                this.tablet?.update(0);
                this.hasInitialVrMenuRecentered = true;
            }
            this.tablet?.setVisible(this.context.isMenuOpen);
            return;
        }

        if (this.context.isMenuOpen) {
            this.show2DMenu();
        } else {
            this.hide2DMenu();
        }
    }

    public closeMenu(): void {
        if (!this.context.isMenuOpen) return;

        this.context.isMenuOpen = false;
        this.tablet?.setVisible(false);
        this.hide2DMenu();
        this.tablet?.ui.markDirty();
    }

    private show2DMenu(): void {
        if (!this.tablet) return;
        this.controllerCursor.reset();

        // Create container if it doesn't exist
        if (!this.overlayContainer) {
            this.overlayContainer = document.createElement('div');
            this.overlayContainer.id = 'menu-2d-overlay';
            this.overlayContainer.style.position = 'fixed';
            this.overlayContainer.style.inset = '0';
            this.overlayContainer.style.display = 'flex';
            this.overlayContainer.style.alignItems = 'center';
            this.overlayContainer.style.justifyContent = 'center';
            this.overlayContainer.style.padding = '24px';
            this.overlayContainer.style.background = 'rgba(4, 2, 12, 0.72)';
            this.overlayContainer.style.backdropFilter = 'blur(6px)';
            this.overlayContainer.style.zIndex = '1200';

            const canvas = this.tablet.ui.canvas;
            canvas.style.width = 'min(92vw, 1280px)';
            canvas.style.maxHeight = '88vh';
            canvas.style.height = 'auto';
            canvas.style.borderRadius = '18px';
            canvas.style.boxShadow = '0 24px 80px rgba(0, 0, 0, 0.55)';
            canvas.style.border = '1px solid rgba(0, 255, 255, 0.28)';
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

            this.canvasMouseLeaveHandler = (_e: MouseEvent) => {
                this.tablet?.ui.onPointerOut();
            };
            canvas.addEventListener('mouseleave', this.canvasMouseLeaveHandler);
        }

        // Always re-append to ensure it's in the DOM
        if (this.tablet && !this.overlayContainer.contains(this.tablet.ui.canvas)) {
            this.tablet.ui.canvas.style.width = 'min(92vw, 1280px)';
            this.tablet.ui.canvas.style.maxHeight = '88vh';
            this.tablet.ui.canvas.style.height = 'auto';
            this.overlayContainer.appendChild(this.tablet.ui.canvas);
        }

        document.body.appendChild(this.overlayContainer);
        this.tablet?.ui.markDirty();
        this.tablet?.ui.update(); // Physical render
        document.exitPointerLock?.();

        // Hide 3D tablet
        this.tablet.setVisible(false);

        // Hide desktop controls (use shared class-based visibility like FlatUiRuntime).
        const controls = document.getElementById('desktop-controls');
        if (controls) {
            controls.classList.add('is-hidden');
        }
    }

    private hide2DMenu(): void {
        this.controllerCursor.hide();
        this.tablet?.ui.onPointerOut();
        if (this.overlayContainer && this.overlayContainer.parentElement) {
            this.overlayContainer.parentElement.removeChild(this.overlayContainer);
        }

        if (this.tablet) {
            const isVR = this.context.runtime.render?.isXRPresenting();
            this.tablet.setVisible(!!isVR);
        }

        // Restore desktop controls if not in VR.
        const controls = document.getElementById('desktop-controls');
        if (controls && !this.context.runtime.render?.isXRPresenting()) {
            controls.classList.remove('is-hidden');
        }
    }

    public openMenuWithRecenter(): void {
        const isVR = !!this.context.runtime.render?.isXRPresenting();
        this.context.isMenuOpen = true;

        if (isVR) {
            this.tablet?.recenterInFrontOfView();
            this.tablet?.update(0);
            this.tablet?.setVisible(true);
            this.hasInitialVrMenuRecentered = true;
            return;
        }

        this.show2DMenu();
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
        const headerContainer = this.createPlainContainer(0, 20, 1280, 80);
        sessionContainer.addChild(headerContainer);

        // 2. List Container (shifted down)
        const listContainer = this.createPlainContainer(0, 110, 1280, 500);
        sessionContainer.addChild(listContainer);

        const pageLabel = new UILabel("Page 1/1", 540, 640, 200, 60);
        pageLabel.font = getFont(UITheme.typography.sizes.small);
        pageLabel.textColor = UITheme.colors.textMuted;
        pageLabel.textAlign = 'center';

        const renderList = () => {
            if (!this.shouldRefreshTabUi(this.peersTab)) {
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
                        avatarColor: rp.avatarConfigSnapshot.color as string | number,
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
                } else if (peer.isLocal) {
                    const selfMuteBtn = new UIButton(this.context.voiceEnabled ? "Mute Myself" : "Unmute Myself", 720, rowY + 15, 430, 70, () => {
                        const nextEnabled = !this.context.voiceEnabled;
                        this.context.voiceAutoEnable = nextEnabled;
                        AppLocalStorage.setVoiceAutoEnable(nextEnabled);
                        this.context.runtime.media.setMicrophoneEnabled(nextEnabled).then((actualState) => {
                            this.context.voiceEnabled = actualState;
                            renderList();
                        });
                    });
                    selfMuteBtn.backgroundColor = this.context.voiceEnabled ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                    selfMuteBtn.borderColor = this.context.voiceEnabled ? UITheme.colors.primary : UITheme.colors.secondary;
                    selfMuteBtn.textColor = UITheme.colors.text;
                    selfMuteBtn.cornerRadius = 8;
                    listContainer.addChild(selfMuteBtn);
                }
            });

            this.tablet?.ui.markDirty();
        };

        this.refreshPeersList = renderList;
        this.peersRefreshCleanup = this.registerTabRefresh(
            () => this.peersTab,
            renderList,
            {
                events: [
                    EVENTS.VOICE_STATE_UPDATED,
                    EVENTS.PEER_STATE_UPDATED,
                    EVENTS.PEER_JOINED_SESSION,
                    EVENTS.PEER_DISCONNECTED
                ],
                delayedEvents: [
                    EVENTS.ENTITY_DISCOVERED,
                    EVENTS.PEER_DISCONNECTED,
                    EVENTS.REMOTE_NAME_UPDATED
                ],
                delayMs: 100,
                intervalMs: 500
            }
        );

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

        // Initial render
        renderList();
    }

    private addSystemTab() {
        if (!this.tabPanel) return;

        this.systemTab = this.tabPanel.addTab('Session');
        const systemContainer = this.systemTab.container;
        const media = this.context.runtime.media;

        const micTitle = new UILabel("Microphone", 90, 80, 320, 52);
        micTitle.font = getFont(UITheme.typography.sizes.body, 'bold');
        micTitle.textColor = UITheme.colors.accent;
        micTitle.textAlign = 'left';
        systemContainer.addChild(micTitle);

        const micMeterTrack = new UIElement(360, 90, 200, 28);
        micMeterTrack.backgroundColor = UITheme.colors.panelBg;
        micMeterTrack.borderColor = UITheme.colors.textMuted;
        micMeterTrack.borderWidth = 2;
        micMeterTrack.cornerRadius = 8;
        systemContainer.addChild(micMeterTrack);

        const micMeterFill = new UIElement(0, 0, 0, 28);
        micMeterFill.backgroundColor = UITheme.colors.primary;
        micMeterFill.borderWidth = 0;
        micMeterFill.cornerRadius = 8;
        micMeterTrack.addChild(micMeterFill);

        let micPage = 0;
        const micsPerPage = 6;
        const renderMicSelector = async () => {
            micListContainer.clearChildren();
            const devices = await media.listMicrophoneDevices();
            const preferredId = media.getPreferredMicrophoneDeviceId();
            const currentId = media.getCurrentMicrophoneDeviceId();
            const usingSystemDefault = !preferredId;

            micStatus.text = this.context.voiceEnabled
                ? `Mic active${currentId ? ` (${preferredId ? 'selected device' : 'system default'})` : ''}`
                : 'Mic muted/off';
            useDefaultBtn.text = usingSystemDefault ? "System Default (Selected)" : "Use System Default";
            useDefaultBtn.borderColor = usingSystemDefault ? UITheme.colors.primary : UITheme.colors.textMuted;
            useDefaultBtn.backgroundColor = usingSystemDefault ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
            useDefaultBtn.textColor = usingSystemDefault ? UITheme.colors.primary : UITheme.colors.text;

            if (devices.length === 0) {
                const empty = new UILabel("No microphone devices found.", 0, 10, 900, 40);
                empty.font = getFont(UITheme.typography.sizes.small, 'bold');
                empty.textColor = UITheme.colors.textMuted;
                empty.textAlign = 'left';
                micListContainer.addChild(empty);
                this.tablet?.ui.markDirty();
                return;
            }

            const totalPages = Math.max(1, Math.ceil(devices.length / micsPerPage));
            if (micPage >= totalPages) micPage = totalPages - 1;
            if (micPage < 0) micPage = 0;
            const start = micPage * micsPerPage;
            const pageDevices = devices.slice(start, start + micsPerPage);

            pageDevices.forEach((device, index) => {
                const y = index * 46;
                const isSelected = (!!preferredId && preferredId === device.id) || (!preferredId && currentId === device.id);

                const name = new UILabel(device.label, 0, y + 6, 840, 32);
                name.font = getFont(UITheme.typography.sizes.small);
                name.textColor = isSelected ? UITheme.colors.primary : UITheme.colors.text;
                name.textAlign = 'left';
                micListContainer.addChild(name);

                const useBtn = new UIButton(isSelected ? "Selected" : "Use", 880, y, 180, 36, () => {
                    void media.setPreferredMicrophoneDevice(device.id).then(() => {
                        void renderMicSelector();
                    });
                });
                useBtn.cornerRadius = 8;
                useBtn.font = getFont(UITheme.typography.sizes.small, 'bold');
                useBtn.backgroundColor = isSelected ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                useBtn.borderColor = isSelected ? UITheme.colors.primary : UITheme.colors.textMuted;
                useBtn.textColor = isSelected ? UITheme.colors.primary : UITheme.colors.text;
                micListContainer.addChild(useBtn);
            });

            const pageLabel = new UILabel(`Page ${micPage + 1}/${totalPages}`, 420, 286, 260, 26);
            pageLabel.font = getFont(UITheme.typography.sizes.small);
            pageLabel.textColor = UITheme.colors.textMuted;
            pageLabel.textAlign = 'center';
            micListContainer.addChild(pageLabel);

            const prevBtn = new UIButton("<", 340, 278, 54, 36, () => {
                if (micPage > 0) {
                    micPage--;
                    void renderMicSelector();
                }
            });
            prevBtn.cornerRadius = 8;
            prevBtn.font = getFont(UITheme.typography.sizes.small, 'bold');
            micListContainer.addChild(prevBtn);

            const nextBtn = new UIButton(">", 700, 278, 54, 36, () => {
                if (micPage < totalPages - 1) {
                    micPage++;
                    void renderMicSelector();
                }
            });
            nextBtn.cornerRadius = 8;
            nextBtn.font = getFont(UITheme.typography.sizes.small, 'bold');
            micListContainer.addChild(nextBtn);

            this.tablet?.ui.markDirty();
        };

        const useDefaultBtn = new UIButton("Use System Default", 590, 78, 230, 44, () => {
            void media.setPreferredMicrophoneDevice(null).then(() => {
                void renderMicSelector();
            });
        });
        useDefaultBtn.cornerRadius = 8;
        useDefaultBtn.font = getFont(UITheme.typography.sizes.small, 'bold');
        useDefaultBtn.borderColor = UITheme.colors.textMuted;
        systemContainer.addChild(useDefaultBtn);

        const refreshDevicesBtn = new UIButton("Refresh Devices", 840, 78, 220, 44, () => {
            void renderMicSelector();
        });
        refreshDevicesBtn.cornerRadius = 8;
        refreshDevicesBtn.font = getFont(UITheme.typography.sizes.small, 'bold');
        refreshDevicesBtn.borderColor = UITheme.colors.secondary;
        systemContainer.addChild(refreshDevicesBtn);

        const micStatus = new UILabel("", 90, 128, 1000, 32);
        micStatus.font = getFont(UITheme.typography.sizes.small);
        micStatus.textColor = UITheme.colors.textMuted;
        micStatus.textAlign = 'left';
        systemContainer.addChild(micStatus);

        const micListContainer = this.createPlainContainer(90, 168, 1100, 280);
        systemContainer.addChild(micListContainer);

        const renderLocalAvatarToggle = new UIToggle(
            "Render local avatar",
            this.context.renderLocalAvatar,
            90, 484, 620, 52,
            (checked) => {
                this.context.renderLocalAvatar = checked;
                AppLocalStorage.setRenderLocalAvatar(checked);
                this.tablet?.ui.markDirty();
            }
        );
        systemContainer.addChild(renderLocalAvatarToggle);

        const trackedGhostToggle = new UIToggle(
            "Show tracked ghost hands/controllers",
            this.context.showTrackedInputGhost,
            90, 548, 620, 52,
            (checked) => {
                this.context.showTrackedInputGhost = checked;
                AppLocalStorage.setShowTrackedInputGhost(checked);
                this.tablet?.ui.markDirty();
            }
        );
        systemContainer.addChild(trackedGhostToggle);

        if (this.sessionMicRefreshHandler) {
            eventBus.off(EVENTS.VOICE_STATE_UPDATED, this.sessionMicRefreshHandler);
        }
        this.sessionMicRefreshHandler = () => { void renderMicSelector(); };
        eventBus.on(EVENTS.VOICE_STATE_UPDATED, this.sessionMicRefreshHandler);
        void renderMicSelector();

        if (this.sessionMicMeterInterval) {
            clearInterval(this.sessionMicMeterInterval);
            this.sessionMicMeterInterval = null;
        }
        let smoothedLevel = 0;
        this.sessionMicMeterInterval = setInterval(() => {
            if (!this.shouldRefreshTabUi(this.systemTab)) return;
            const raw = this.context.voiceEnabled ? media.getLocalVolume() : 0;
            const gated = raw < 0.03 ? 0 : raw;
            smoothedLevel = smoothedLevel * 0.7 + gated * 0.3;
            const nextWidth = Math.round(200 * Math.max(0, Math.min(1, smoothedLevel)));
            if (nextWidth !== micMeterFill.width) {
                micMeterFill.width = nextWidth;
                this.tablet?.ui.markDirty();
            }
        }, 80);

        const exitXrBtn = new UIButton("Exit XR", 220, 630, 200, 80, () => {
            const render = this.context.runtime.render;
            if (!render || !render.isXRPresenting()) {
                return;
            }
            render.getXRSession()?.end().catch(() => {
                // Intentionally ignore end errors (session may already be closing).
            });
        });
        exitXrBtn.backgroundColor = UITheme.colors.panelBg;
        exitXrBtn.borderColor = UITheme.colors.secondary;
        exitXrBtn.textColor = UITheme.colors.text;
        exitXrBtn.hoverColor = UITheme.colors.panelBgHover;
        exitXrBtn.cornerRadius = 10;
        exitXrBtn.isVisible = !!this.context.runtime.render?.isXRPresenting();
        systemContainer.addChild(exitXrBtn);
        this.exitXrButton = exitXrBtn;

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

        this.sessionTab = this.tabPanel.addTab('Screens');
        const sessionContainer = this.sessionTab.container;

        const desktop = this.context.runtime.remoteDesktop;

        const title = this.createTabTitle('Remote Screens', 50, 30, 1180, 70);
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

        const listContainer = this.createPlainContainer(40, 240, 1200, 500);
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

        this.desktopRefreshCleanup?.();
        this.desktopRefreshCleanup = this.registerTabRefresh(
            () => this.sessionTab,
            () => {
                desktop.requestSourceStatus();
                renderList();
            },
            {
                events: [
                    EVENTS.DESKTOP_SCREENS_UPDATED
                ],
                delayedEvents: [EVENTS.SESSION_CONNECTED, EVENTS.PEER_JOINED_SESSION],
                delayMs: 0
            }
        );
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

        const debugRenderer = this.context.runtime.debugRender;
        const debugSettings = debugRenderer?.getSettings();

        const overlayToggle = new UIToggle(
            "Physics Debug Overlay",
            debugSettings?.enabled ?? false,
            90, 70, 620, 52,
            (checked) => {
                debugRenderer?.setEnabled(checked);
                this.tablet?.ui.markDirty();
            }
        );
        debugContainer.addChild(overlayToggle);

        const avatarDebugToggle = new UIToggle(
            "Coordinate Avatar Debug",
            this.context.avatarRenderOverride === 'coordinates',
            90, 138, 620, 52,
            (checked) => {
                this.context.avatarRenderOverride = checked ? 'coordinates' : null;
                const active = this.context.avatarRenderOverride ?? 'none';
                this.context.runtime.diagnostics.record('info', 'system', `Avatar render override=${active}`);
                this.tablet?.ui.markDirty();
            }
        );
        debugContainer.addChild(avatarDebugToggle);

        const showFpsToggle = new UIToggle(
            "Show FPS",
            this.context.runtime.hud.getShowPerformanceStats(),
            760, 70, 420, 52,
            (checked) => {
                this.context.runtime.hud.setShowPerformanceStats(checked);
                this.tablet?.ui.markDirty();
            }
        );
        debugContainer.addChild(showFpsToggle);

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

        const scenarios = this.context.runtime.session.getAvailableScenarios();
        let scenarioRows = 0;
        scenarios.forEach((scenario, index) => {
            const row = Math.floor(index / 3);
            const col = index % 3;
            scenarioRows = row + 1;
            const button = new UIButton(scenario.displayName, 90 + (col * 340), 478 + (row * 70), 320, 58, () => {
                this.context.runtime.network.requestSessionConfigUpdate({
                    activeScenarioId: scenario.id
                });
                this.tablet?.ui.markDirty();
            });
            button.cornerRadius = 10;
            button.borderColor = UITheme.colors.secondary;
            debugContainer.addChild(button);
        });

        const nextY = 478 + (scenarioRows * 70) + 30;

        const spawnBeaconBtn = new UIButton("Spawn Debug Beacon", 90, nextY, 360, 60, () => {
            const localPlayer = this.context.localPlayer;
            const headPose = localPlayer?.getAvatarHeadWorldPose?.();
            const targetPosition = localPlayer
                && headPose
                ? {
                    x: headPose.position.x,
                    y: headPose.position.y - 0.2,
                    z: headPose.position.z
                }
                : { x: 0, y: 1.2, z: 1.8 };

            if (localPlayer && headPose) {
                const forward = new THREE.Vector3(0, 0, 1);
                const headQuat = new THREE.Quaternion(
                    headPose.quaternion.x,
                    headPose.quaternion.y,
                    headPose.quaternion.z,
                    headPose.quaternion.w
                );
                forward.applyQuaternion(headQuat).multiplyScalar(1.1);
                targetPosition.x += forward.x;
                targetPosition.y += Math.max(-0.1, forward.y);
                targetPosition.z += forward.z;
            }

            this.context.runtime.session.spawnPortableObjectModule('debug-beacon', {
                position: targetPosition
            });
            this.tablet?.ui.markDirty();
        });
        spawnBeaconBtn.cornerRadius = 10;
        spawnBeaconBtn.borderColor = UITheme.colors.secondary;
        debugContainer.addChild(spawnBeaconBtn);

        const statsLabel = new UILabel("", 90, nextY + 100, 1080, 42);
        statsLabel.font = getFont(UITheme.typography.sizes.small, 'bold');
        statsLabel.textColor = UITheme.colors.accent;
        statsLabel.textAlign = 'left';
        debugContainer.addChild(statsLabel);

        const updateStats = () => {
            if (!this.shouldRefreshTabUi(debugTab)) {
                return;
            }

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

    private addScenarioTab() {
        if (!this.tabPanel) return;

        const scenarioTab = this.tabPanel.addTab('Scenario');
        const container = scenarioTab.container;
        const title = this.createTabTitle('Scenario Actions', 90, 52, 1080, 48, 'left');
        title.textColor = UITheme.colors.accent;
        container.addChild(title);

        const subtitle = new UILabel('', 90, 102, 1080, 36);
        subtitle.font = getFont(UITheme.typography.sizes.small, 'bold');
        subtitle.textColor = UITheme.colors.textMuted;
        subtitle.textAlign = 'left';
        container.addChild(subtitle);

        const listContainer = this.createPlainContainer(90, 160, 1080, 560);
        container.addChild(listContainer);

        const renderActions = () => {
            const activeScenario = this.context.runtime.session.getActiveScenario();
            subtitle.text = `Active Scenario: ${activeScenario.displayName}`;
            listContainer.clearChildren();

            const actions = this.context.runtime.scenarioActions.listActions();
            if (actions.length === 0) {
                const emptyLabel = new UILabel('No scenario actions available.', 0, 0, 900, 42);
                emptyLabel.font = getFont(UITheme.typography.sizes.body, 'bold');
                emptyLabel.textColor = UITheme.colors.textMuted;
                emptyLabel.textAlign = 'left';
                listContainer.addChild(emptyLabel);
                this.tablet?.ui.markDirty();
                return;
            }

            actions.forEach((action, index) => {
                const rowY = index * 120;
                const button = new UIButton(action.label, 0, rowY, 300, 62, () => {
                    if (!action.available) return;
                    this.context.runtime.network.requestScenarioAction(action.id);
                });
                button.cornerRadius = 10;
                button.borderColor = action.available ? UITheme.colors.secondary : UITheme.colors.textMuted;
                button.textColor = action.available ? UITheme.colors.text : UITheme.colors.textMuted;
                button.backgroundColor = action.available ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                listContainer.addChild(button);

                const meta = new UILabel(
                    `Role: ${action.requiredRole}`,
                    330, rowY + 10, 240, 30
                );
                meta.font = getFont(UITheme.typography.sizes.small, 'bold');
                meta.textColor = action.requiredRole === 'admin' ? UITheme.colors.secondary : UITheme.colors.primary;
                meta.textAlign = 'left';
                listContainer.addChild(meta);

                const description = new UILabel(
                    action.description || '',
                    330, rowY + 42, 700, 34
                );
                description.font = getFont(UITheme.typography.sizes.small);
                description.textColor = UITheme.colors.textMuted;
                description.textAlign = 'left';
                listContainer.addChild(description);

                if (!action.available && action.disabledReason) {
                    const disabled = new UILabel(action.disabledReason, 740, rowY + 10, 320, 30);
                    disabled.font = getFont(UITheme.typography.sizes.small, 'bold');
                    disabled.textColor = UITheme.colors.secondary;
                    disabled.textAlign = 'right';
                    listContainer.addChild(disabled);
                }
            });

            this.tablet?.ui.markDirty();
        };

        renderActions();
        this.scenarioRefreshCleanup?.();
        this.scenarioRefreshCleanup = this.registerTabRefresh(
            () => scenarioTab,
            renderActions,
            {
                events: [
                    EVENTS.SESSION_CONFIG_APPLIED,
                    EVENTS.SESSION_CONNECTED,
                    EVENTS.PEER_JOINED_SESSION,
                    EVENTS.PEER_DISCONNECTED
                ],
                refreshOnVisible: true
            }
        );
    }

    private addSpawnerTab() {
        if (!this.tabPanel) return;

        const spawnerTab = this.tabPanel.addTab('My Files');
        const container = spawnerTab.container;
        const title = this.createTabTitle('Spawn Custom Files', 90, 52, 1080, 48, 'left');
        title.textColor = UITheme.colors.accent;
        container.addChild(title);

        const subtitle = new UILabel('Spawn your configured items into the world', 90, 102, 1080, 36);
        subtitle.font = getFont(UITheme.typography.sizes.small, 'bold');
        subtitle.textColor = UITheme.colors.textMuted;
        subtitle.textAlign = 'left';
        container.addChild(subtitle);

        const listContainer = this.createPlainContainer(90, 160, 1080, 560);
        container.addChild(listContainer);

        const renderSpawner = () => {
            listContainer.clearChildren();
            let rowY = 0;

            const items = ConfigRegistry.getKeyValueList('user_items') || [];
            const hasItems = items.length > 0;

            items.forEach((item) => {
                const button = new UIButton(item.name, 0, rowY, 300, 62, () => {
                    const localPlayer = this.context.localPlayer;
                    const headPose = localPlayer?.getAvatarHeadWorldPose?.();
                    const targetPosition = localPlayer
                        && headPose
                        ? {
                            x: headPose.position.x,
                            y: headPose.position.y - 0.2,
                            z: headPose.position.z
                        }
                        : { x: 0, y: 1.2, z: 1.8 };

                    if (localPlayer && headPose) {
                        const forward = new THREE.Vector3(0, 0, 1);
                        const headQuat = new THREE.Quaternion(
                            headPose.quaternion.x,
                            headPose.quaternion.y,
                            headPose.quaternion.z,
                            headPose.quaternion.w
                        );
                        forward.applyQuaternion(headQuat).multiplyScalar(1.0);
                        targetPosition.x += forward.x;
                        targetPosition.y += Math.max(-0.1, forward.y);
                        targetPosition.z += forward.z;
                    }

                    const localId = this.context.localPlayer?.id || 'local';
                    this.context.runtime.session.spawnPortableObjectModule('simple-shared-object', {
                        position: targetPosition,
                        url: item.value,
                        ownerId: this.context.isHost ? null : localId,
                        isAuthority: true
                    });

                    if (this.context.isMenuOpen) {
                        this.toggle2DMenu();
                    }
                });

                button.cornerRadius = 10;
                button.borderColor = UITheme.colors.secondary;
                button.textColor = UITheme.colors.text;
                button.backgroundColor = UITheme.colors.panelBg;
                button.hoverColor = UITheme.colors.panelBgHover;
                listContainer.addChild(button);

                const urlLabel = new UILabel(item.value, 330, rowY + 14, 730, 34);
                urlLabel.font = getFont(UITheme.typography.sizes.small);
                urlLabel.textColor = UITheme.colors.textMuted;
                urlLabel.textAlign = 'left';
                listContainer.addChild(urlLabel);

                rowY += 80;
            });

            if (!hasItems) {
                const emptyLabel = new UILabel('No files configured. Add some in the extension settings (Desktop UI).', 0, 0, 1080, 42);
                emptyLabel.font = getFont(UITheme.typography.sizes.body, 'bold');
                emptyLabel.textColor = UITheme.colors.textMuted;
                emptyLabel.textAlign = 'left';
                listContainer.addChild(emptyLabel);
            }

            this.tablet?.ui.markDirty();
        };

        renderSpawner();
        this.spawnerRefreshCleanup?.();
        this.spawnerRefreshCleanup = this.registerTabRefresh(
            () => spawnerTab,
            renderSpawner,
            {
                refreshOnVisible: true
            }
        );
    }

    private addHelpTab() {
        if (!this.tabPanel) return;

        const helpTab = this.tabPanel.addTab('Help');
        const container = helpTab.container;
        let currentMode: 'VR' | 'Desktop' | 'Touch' = 'VR';

        const contentArea = this.createPlainContainer(50, 150, 1180, 600);
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

    public isTabletInteractionActive(): boolean {
        const render = this.context.runtime.render;
        return !!this.tablet &&
            !!render &&
            render.isXRPresenting() &&
            !!this.context.isMenuOpen &&
            this.tablet.mesh.visible;
    }

    public isHandUiPointerBlocked(hand: 'left' | 'right'): boolean {
        return this.handUiPointerBlocked[hand];
    }

    public update(delta: number): void {
        const isXrPresenting = !!this.context.runtime.render?.isXRPresenting();
        if (this.wasXrPresentingLastFrame && !isXrPresenting) {
            this.hasInitialVrMenuRecentered = false;
        }
        this.wasXrPresentingLastFrame = isXrPresenting;

        this.updateHandLocomotionIndicator();
        this.updateMenuOrb(delta);
        this.updateInteractionOrb();

        if (this.exitXrButton) {
            const shouldShowExitXr = !!this.context.runtime.render?.isXRPresenting();
            if (this.exitXrButton.isVisible !== shouldShowExitXr) {
                this.exitXrButton.isVisible = shouldShowExitXr;
                this.tablet?.ui.markDirty();
            }
        }

        for (const watcher of this.tabVisibleRefreshWatchers) {
            const isVisibleNow = this.shouldRefreshTabUi(watcher.tabGetter());
            if (isVisibleNow && !watcher.wasVisible) {
                watcher.refresh();
            }
            watcher.wasVisible = isVisibleNow;
        }

        if (this.tablet) {
            // Update 3D visibility based on VR state vs Desktop Menu
            const isVR = this.context.runtime.render?.isXRPresenting();
            if (isVR) {
                this.tablet.setVisible(!!this.context.isMenuOpen);
            } else if (!this.context.isMenuOpen) {
                this.tablet.setVisible(false);
            }

            this.tablet.update(delta);
        }
    }

    public destroy(): void {
        this.teardownPeersTabSubscriptions();
        if (this.desktopRefreshCleanup) {
            this.desktopRefreshCleanup();
            this.desktopRefreshCleanup = null;
        }
        if (this.scenarioRefreshCleanup) {
            this.scenarioRefreshCleanup();
            this.scenarioRefreshCleanup = null;
        }
        if (this.spawnerRefreshCleanup) {
            this.spawnerRefreshCleanup();
            this.spawnerRefreshCleanup = null;
        }
        if (this.sessionMicMeterInterval) {
            clearInterval(this.sessionMicMeterInterval);
            this.sessionMicMeterInterval = null;
        }
        if (this.sessionMicRefreshHandler) {
            eventBus.off(EVENTS.VOICE_STATE_UPDATED, this.sessionMicRefreshHandler);
            this.sessionMicRefreshHandler = null;
        }
        this.tabVisibleRefreshWatchers.length = 0;
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
        if (this.menuOpenRecenterIntentHandler) {
            eventBus.off(EVENTS.INTENT_MENU_OPEN_RECENTER, this.menuOpenRecenterIntentHandler);
            this.menuOpenRecenterIntentHandler = null;
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
        if (this.menuOrb) {
            if (this.menuOrbCore) {
                this.menuOrbCore.geometry.dispose();
                (this.menuOrbCore.material as THREE.Material).dispose();
                this.menuOrbCore.removeFromParent();
                this.menuOrbCore = null;
            }
            this.menuOrb.geometry.dispose();
            (this.menuOrb.material as THREE.Material).dispose();
            this.menuOrb.removeFromParent();
            this.menuOrb = null;
        }
        if (this.interactOrb) {
            this.interactOrb.geometry.dispose();
            (this.interactOrb.material as THREE.Material).dispose();
            this.interactOrb.removeFromParent();
            this.interactOrb = null;
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
            if (this.canvasMouseLeaveHandler) {
                canvas.removeEventListener('mouseleave', this.canvasMouseLeaveHandler);
                this.canvasMouseLeaveHandler = null;
            }

            this.context.runtime.render?.scene.remove(this.tablet.mesh);
            this.context.runtime.entity?.removeEntity(this.tablet.id);
            this.tablet.destroy();
            this.tablet = null;
        }
        this.tabPanel = null;
        this.overlayContainer = null;
        this.exitXrButton = null;
    }

}
