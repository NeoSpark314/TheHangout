import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { isTrueHMD } from '../utils/DeviceUtils.js';

export class RenderManager {
    public container: HTMLElement;
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public cameraGroup: THREE.Group;
    public audioListener: THREE.AudioListener;
    public renderer: THREE.WebGLRenderer;
    public isMenuMode: boolean = true;
    private menuRotation: number = 0;
    public controllers: THREE.Group[] = [];

    constructor() {
        this.container = document.getElementById('app')!;

        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a041c); // Deep retro purple

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
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = false;

        // WebXR Enable
        this.renderer.xr.enabled = true;

        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        // Ensure the camera itself has no local rotation/offset so it follows the group perfectly
        this.camera.position.set(0, 0, 0);
        this.camera.rotation.set(0, 0, 0);

        this.cameraGroup.position.set(15, 12, 15);
        this.cameraGroup.lookAt(0, 0, 0);

        this.setupControllers();

        // Add VR Button ONLY if we detect a true HMD
        if (isTrueHMD) {
            const vrButton = VRButton.createButton(this.renderer, {
                optionalFeatures: ['hand-tracking']
            });
            this.container.appendChild(vrButton);
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
        this.camera.rotation.set(0, 0, 0);
    }

    public switchToSpectatorView(): void {
        this.isMenuMode = false;
        this.cameraGroup.rotation.set(0, 0, 0);
        this.camera.rotation.set(0, 0, 0);
        this.cameraGroup.position.set(0, 8, 10);
    }

    public update(delta: number): void {
        if (!this.isMenuMode) return;

        this.menuRotation += delta * 0.1;
        const radius = 18;
        this.cameraGroup.position.set(
            Math.cos(this.menuRotation) * radius,
            12,
            Math.sin(this.menuRotation) * radius
        );

        this.camera.lookAt(0, 0, 0);
    }

    public setupControllers(): void {
        this.controllers = [];
        for (let i = 0; i < 2; i++) {
            const controller = this.renderer.xr.getController(i);
            this.cameraGroup.add(controller);
            this.controllers.push(controller);

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
        return this.renderer.xr.getController(index);
    }

    public onWindowResize(): void {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    public render(): void {
        this.renderer.render(this.scene, this.camera);
    }

    public setAnimationLoop(callback: (time: number, frame?: XRFrame) => void): void {
        this.renderer.setAnimationLoop(callback);
    }
}
