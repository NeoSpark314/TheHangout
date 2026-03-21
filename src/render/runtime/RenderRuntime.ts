import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { isTrueHMD } from '../../shared/utils/DeviceUtils.ts';
import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { EnvironmentBuilder } from '../../assets/procedural/EnvironmentBuilder';

export class RenderRuntime {
    public container: HTMLElement;
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public cameraGroup: THREE.Group;
    public interactionGroup: THREE.Group;
    public audioListener: THREE.AudioListener;
    public renderer: THREE.WebGLRenderer;
    public isMenuMode: boolean = true;
    private menuRotation: number = 0;
    public controllers: THREE.Group[] = [];
    public controllerGrips: THREE.Group[] = [];
    public hands: THREE.Group[] = [];
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private xrPresentationMode: 'none' | 'vr' | 'mr' = 'none';
    private savedSceneBackground: THREE.Scene['background'] | null = null;
    private savedSceneFog: THREE.Scene['fog'] | null = null;
    private xrButtonRow: HTMLDivElement | null = null;
    private vrEntryButton: HTMLElement | null = null;
    private mrEntryButton: HTMLElement | null = null;
    private readonly xrButtonLabelObservers = new WeakMap<HTMLElement, MutationObserver>();

    constructor(private context: AppContext) {
        this.container = document.getElementById('app')!;

        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a041c); // Deep retro purple

        // Interaction Group (isolated for performance and precision)
        this.interactionGroup = new THREE.Group();
        this.scene.add(this.interactionGroup);

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );

        // XR Camera Group (The "Dolly")
        this.cameraGroup = new THREE.Group();
        this.cameraGroup.add(this.camera);
        this.scene.add(this.cameraGroup);

        // Disable Layer 1 on the main camera so we don't see our own head
        this.camera.layers.disable(1);

        // Move camera group back and up slightly to see the floor initially
        this.cameraGroup.position.set(0, 0, 0);

        // Audio Listener
        this.audioListener = new THREE.AudioListener();
        this.camera.add(this.audioListener);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = false;
        this.renderer.setClearColor(0x000000, 1);

        // WebXR Enable
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local-floor');
        this.renderer.xr.addEventListener('sessionstart', () => {
            void this.promoteReferenceSpaceToRoomScale();
            this.xrPresentationMode = this.detectXrPresentationMode();
            this.applyXrVisualMode();
            this.refreshXrButtonLabels();
            console.log('[RenderRuntime] XR Session Started');
            eventBus.emit(EVENTS.XR_SESSION_STARTED);
        });
        this.renderer.xr.addEventListener('sessionend', () => {
            this.xrPresentationMode = 'none';
            this.applyXrVisualMode();
            this.refreshXrButtonLabels();
            console.log('[RenderRuntime] XR Session Ended');
            eventBus.emit(EVENTS.XR_SESSION_ENDED);
        });

        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        // Ensure the camera itself has no local rotation/offset so it follows the group perfectly
        this.camera.position.set(0, 0, 0);
        this.camera.rotation.set(0, 0, 0);

        this.cameraGroup.position.set(0, 0, 0);

        this.setupControllers();

        // Add VR Button ONLY if we detect a true HMD
        if (isTrueHMD) {
            const vrButton = VRButton.createButton(this.renderer, {
                requiredFeatures: ['local-floor'],
                optionalFeatures: ['bounded-floor', 'hand-tracking']
            });
            if (vrButton instanceof HTMLButtonElement) {
                vrButton.textContent = 'VR';
            }

            const row = this.ensureXrButtonRow();
            this.prepareXrEntryButton(vrButton);
            row.appendChild(vrButton);
            this.vrEntryButton = vrButton;
            this.setXrButtonLabel(vrButton, 'VR');
            void this.attachMixedRealityButton(row);
        }

        // Handle Window Resize and Orientation Change
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.onWindowResize(), 100);
        }, false);

        this.onWindowResize();
    }

    public switchToPlayerView(): void {
        this.isMenuMode = false;
    }

    public update(delta: number, possessedPlayer: any): void {
        if (this.isMenuMode) {
            this.menuRotation += delta * 0.1;
            const radius = 18;
            this.cameraGroup.position.set(
                Math.cos(this.menuRotation) * radius,
                12,
                Math.sin(this.menuRotation) * radius
            );
            this.camera.lookAt(0, 0, 0);
            return;
        }

        if (!possessedPlayer) return;

        // Camera following logic
        if (possessedPlayer.controlMode === 'local') {
            const lp = possessedPlayer;
            this.cameraGroup.position.set(lp.xrOrigin.position.x, lp.xrOrigin.position.y, lp.xrOrigin.position.z);
            this.cameraGroup.quaternion.set(lp.xrOrigin.quaternion.x, lp.xrOrigin.quaternion.y, lp.xrOrigin.quaternion.z, lp.xrOrigin.quaternion.w);

            if (!this.isXRPresenting()) {
                const headPose = lp.getAvatarHeadWorldPose?.();
                if (!headPose) return;
                const worldPos = new THREE.Vector3(headPose.position.x, headPose.position.y, headPose.position.z);
                const worldQuat = new THREE.Quaternion(headPose.quaternion.x, headPose.quaternion.y, headPose.quaternion.z, headPose.quaternion.w);

                // Convert world pose to be local to cameraGroup
                this.camera.position.copy(this.cameraGroup.worldToLocal(worldPos));

                // For rotation, we need to handle the world-to-local quat as well
                const groupWorldQuat = new THREE.Quaternion();
                this.cameraGroup.getWorldQuaternion(groupWorldQuat);
                this.camera.quaternion.copy(groupWorldQuat.invert().multiply(worldQuat));
            }
        }
    }

    public setupControllers(): void {
        this.controllers = [];
        this.controllerGrips = [];
        this.hands = [];

        // Support up to 4 input sources (typical for VR: HandL, HandR, ControllerL, ControllerR)
        for (let i = 0; i < 4; i++) {
            // 1. Target Ray (for pointers)
            const controller = this.renderer.xr.getController(i);
            this.cameraGroup.add(controller);
            this.controllers.push(controller);

            // 2. Grip (for grab/carry)
            const grip = this.renderer.xr.getControllerGrip(i);
            this.cameraGroup.add(grip);
            this.controllerGrips.push(grip);

            // 3. Hand (for skeletal tracking)
            const hand = this.renderer.xr.getHand(i);
            this.cameraGroup.add(hand);
            this.hands.push(hand);

            controller.addEventListener('selectstart', () => {
                console.log(`Controller ${i} triggered selectstart`);
            });
        }
    }

    public add(object3D: THREE.Object3D): void {
        this.scene.add(object3D);
    }

    public remove(object3D: THREE.Object3D): void {
        this.scene.remove(object3D);
    }

    public isXRPresenting(): boolean {
        return this.renderer.xr.isPresenting;
    }

    public isMixedRealityPresenting(): boolean {
        return this.isXRPresenting() && this.xrPresentationMode === 'mr';
    }

    public getXRSession(): XRSession | null {
        return this.renderer.xr.getSession();
    }

    public getXRFrame(): any {
        return this.renderer.xr.getFrame();
    }

    public getXRReferenceSpace(): any {
        return this.renderer.xr.getReferenceSpace();
    }

    public getXRController(index: number): THREE.Group {
        return this.controllers[index];
    }

    public getXRControllerGrip(index: number): THREE.Group {
        return this.controllerGrips[index];
    }

    public getXRHand(index: number): THREE.Group {
        return this.hands[index];
    }

    public onWindowResize(): void {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    public render(): void {
        if (this.xrPresentationMode === 'mr') {
            this.scene.background = null;
            this.scene.fog = null;
        }
        this.renderer.render(this.scene, this.camera);
    }

    public setAnimationLoop(callback: (time: number, frame?: XRFrame) => void): void {
        this.renderer.setAnimationLoop(callback);
    }

    public raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDist: number): THREE.Intersection[] {
        this.raycaster.set(origin, direction);
        this.raycaster.far = maxDist;
        this.raycaster.camera = this.camera;
        return this.raycaster.intersectObjects(this.interactionGroup.children, true);
    }

    private detectXrPresentationMode(): 'vr' | 'mr' {
        const session = this.getXRSession();
        const blendMode = session?.environmentBlendMode;
        if (blendMode === 'alpha-blend' || blendMode === 'additive') {
            return 'mr';
        }
        return 'vr';
    }

    private applyXrVisualMode(): void {
        const mixedReality = this.xrPresentationMode === 'mr';

        if (mixedReality) {
            this.savedSceneBackground = this.scene.background;
            this.savedSceneFog = this.scene.fog;
            this.scene.background = null;
            this.scene.fog = null;
            this.renderer.setClearColor(0x000000, 0);
        } else {
            this.renderer.setClearColor(0x000000, 1);
            if (this.savedSceneBackground !== null || this.savedSceneFog !== null) {
                this.scene.background = this.savedSceneBackground;
                this.scene.fog = this.savedSceneFog;
                this.savedSceneBackground = null;
                this.savedSceneFog = null;
            }
        }

        EnvironmentBuilder.setDecorationsVisible(!mixedReality);
    }

    private async attachMixedRealityButton(row: HTMLElement): Promise<void> {
        if (!navigator.xr?.isSessionSupported) return;

        try {
            const supportsMr = await navigator.xr.isSessionSupported('immersive-ar');
            if (!supportsMr) return;

            const mrButton = ARButton.createButton(this.renderer, {
                requiredFeatures: ['local-floor'],
                optionalFeatures: ['bounded-floor', 'hand-tracking']
            });

            if (mrButton instanceof HTMLButtonElement) {
                mrButton.textContent = 'MR';
            }

            this.prepareXrEntryButton(mrButton);
            row.appendChild(mrButton);
            this.mrEntryButton = mrButton;
            this.setXrButtonLabel(mrButton, 'MR');
        } catch (error) {
            console.warn('[RenderRuntime] Could not determine immersive-ar support:', error);
        }
    }

    private ensureXrButtonRow(): HTMLDivElement {
        if (this.xrButtonRow) return this.xrButtonRow;

        const row = document.createElement('div');
        row.className = 'xr-entry-row';
        this.container.appendChild(row);
        this.xrButtonRow = row;
        return row;
    }

    private prepareXrEntryButton(button: HTMLElement): void {
        button.classList.add('xr-entry-btn');
        // Neutralize default absolute positioning from THREE helper buttons.
        this.forceXrButtonLayout(button);
    }

    private refreshXrButtonLabels(): void {
        if (this.vrEntryButton) this.setXrButtonLabel(this.vrEntryButton, 'VR');
        if (this.mrEntryButton) this.setXrButtonLabel(this.mrEntryButton, 'MR');
    }

    private async promoteReferenceSpaceToRoomScale(): Promise<void> {
        const session = this.getXRSession();
        if (!session) return;

        try {
            const boundedFloor = await session.requestReferenceSpace('bounded-floor');
            this.renderer.xr.setReferenceSpace(boundedFloor);
            console.log('[RenderRuntime] Using bounded-floor (room-scale) reference space.');
        } catch {
            // Keep local-floor as baseline fallback when bounded-floor is unavailable.
            console.log('[RenderRuntime] bounded-floor unavailable; staying on local-floor.');
        }
    }

    private setXrButtonLabel(button: HTMLElement, label: string): void {
        button.setAttribute('data-short-label', label);
        button.textContent = label;
        button.setAttribute('aria-label', label);

        if (!this.xrButtonLabelObservers.has(button)) {
            const observer = new MutationObserver(() => {
                const desired = button.getAttribute('data-short-label') || label;
                if (button.textContent !== desired) {
                    button.textContent = desired;
                }
            });
            observer.observe(button, { childList: true, subtree: true, characterData: true });
            this.xrButtonLabelObservers.set(button, observer);
        }
    }

    private forceXrButtonLayout(button: HTMLElement): void {
        button.style.setProperty('position', 'static', 'important');
        button.style.setProperty('left', 'auto', 'important');
        button.style.setProperty('right', 'auto', 'important');
        button.style.setProperty('bottom', 'auto', 'important');
        button.style.setProperty('transform', 'none', 'important');
        button.style.setProperty('width', '72px', 'important');
        button.style.setProperty('height', '40px', 'important');
        button.style.setProperty('margin', '0', 'important');
        button.style.setProperty('padding', '0', 'important');
        button.style.setProperty('line-height', '40px', 'important');
    }
}
