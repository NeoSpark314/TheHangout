// managers/RenderManager.js
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

export class RenderManager {
    constructor() {
        this.container = document.getElementById('app');

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
        // In XR, we move the parent of the camera to position the user in the world
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
        // Shadows are disabled for performance and aesthetic reasons in this Phase
        this.renderer.shadowMap.enabled = false;

        // WebXR Enable
        this.renderer.xr.enabled = true;

        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        // Initial Menu Camera (High, dramatic angle)
        this.isMenuMode = true;
        this.menuRotation = 0;

        // Ensure the camera itself has no local rotation/offset so it follows the group perfectly
        this.camera.position.set(0, 0, 0);
        this.camera.rotation.set(0, 0, 0);

        this.cameraGroup.position.set(15, 12, 15);
        this.cameraGroup.lookAt(0, 0, 0);

        this.setupControllers();

        // Add VR Button ONLY if we detect a true HMD (Quest, Vision Pro, or PC desktop)
        // This prevents the button from showing up on iPhones/Android phones that just support generic 'cardboard'
        if (this.isTrueHMD()) {
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

        // Initial calls to ensure correct size after DOM/CSS settling
        this.onWindowResize();
        setTimeout(() => this.onWindowResize(), 10);
        setTimeout(() => this.onWindowResize(), 100);
    }

    switchToPlayerView() {
        this.isMenuMode = false;
        // Reset camera tilt from menu mode
        this.camera.rotation.set(0, 0, 0);
        // Don't reset position here as LocalPlayer.js initialization will snap it to (0, 1.6, 0)
    }

    update(delta) {
        if (!this.isMenuMode) return;

        // Slower, more majestic cinematic rotation
        this.menuRotation += delta * 0.1;
        const radius = 18;
        this.cameraGroup.position.set(
            Math.cos(this.menuRotation) * radius,
            12,
            Math.sin(this.menuRotation) * radius
        );

        // Point the camera at the center of the platform
        this.camera.lookAt(0, 0, 0);
    }

    isTrueHMD() {
        const ua = navigator.userAgent;

        // 1. Explicitly allow known standalone VR headsets
        const isStandaloneXR = /OculusBrowser|PicoBrowser|ViveBrowser|AppleVision/i.test(ua);
        if (isStandaloneXR) return true;

        // 2. Filter out common mobile phones and tablets
        // These browsers technically support WebXR (Cardboard/WebVR legacy) but we want to skip them
        const isMobilePhone = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

        // 3. If it's NOT a mobile phone, we assume it's a Desktop/Laptop (PCVR support)
        // If it IS a mobile phone, we only allow it if it matched the standalone check above
        return !isMobilePhone;
    }



    setupControllers() {
        this.controllers = [];

        for (let i = 0; i < 2; i++) {
            const controller = this.renderer.xr.getController(i);

            this.cameraGroup.add(controller);
            this.controllers.push(controller);

            // Gaze/Select logic can be added here
            controller.addEventListener('selectstart', () => {
                console.log(`Controller ${i} triggered selectstart`);
            });
        }
    }

    add(object3D) {
        this.scene.add(object3D);
    }

    remove(object3D) {
        this.scene.remove(object3D);
    }

    onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    setAnimationLoop(callback) {
        this.renderer.setAnimationLoop(callback);
    }
}
