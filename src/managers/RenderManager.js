// managers/RenderManager.js
import * as THREE from 'three';

export class RenderManager {
    constructor() {
        this.container = document.getElementById('app');

        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // Sky blue

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        // Move camera back and up slightly to see the floor
        this.camera.position.set(0, 2, 5);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // We will enable WebXR later: this.renderer.xr.enabled = true;

        this.container.appendChild(this.renderer.domElement);

        this.setupLighting();

        // Handle Window Resize
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    setupLighting() {
        // Ambient Light
        const ambientLight = new THREE.AmbientLight(0x404040, 2); // soft white light
        this.scene.add(ambientLight);

        // Directional Light (Sun)
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 50;

        // Expand shadow frustum
        const d = 15;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;

        this.scene.add(dirLight);
    }

    add(object3D) {
        this.scene.add(object3D);
    }

    remove(object3D) {
        this.scene.remove(object3D);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
