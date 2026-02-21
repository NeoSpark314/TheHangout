// managers/RenderManager.js
import * as THREE from 'three';

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
        // Move camera back and up slightly to see the floor
        this.camera.position.set(0, 2, 5);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        // Shadows are disabled for performance and aesthetic reasons in this Phase
        this.renderer.shadowMap.enabled = false;
        // We will enable WebXR later: this.renderer.xr.enabled = true;

        this.container.appendChild(this.renderer.domElement);

        this.setupLighting();
        this.createSynthwaveSun();

        // Handle Window Resize
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    setupLighting() {
        // Ambient Light (Soft Magenta cast)
        const ambientLight = new THREE.AmbientLight(0xff00ff, 0.5);
        this.scene.add(ambientLight);

        // Hemisphere Light (Cyan from above, purple from below)
        const hemiLight = new THREE.HemisphereLight(0x00ffff, 0x800080, 1);
        this.scene.add(hemiLight);

        // Directional Light (Replacing Sun with a distant neon source)
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = false; // explicitly disable
        this.scene.add(dirLight);
    }

    createSynthwaveSun() {
        // Large distant circle for the synthwave sun
        const sunGeom = new THREE.CircleGeometry(40, 64);
        const sunMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0xff8000) }, // Orange
                bottomColor: { value: new THREE.Color(0xff0080) } // Pink/Magenta
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                void main() {
                    float y = vUv.y;
                    // Classic 80s gradient: Pink at the bottom, Orange at the top
                    vec3 color = mix(bottomColor, topColor, y);
                    
                    // Retro Striped Effect
                    // Stripes get thicker towards the bottom (y=0)
                    float period = 0.08;
                    float gapWidth = 0.04 * (1.0 - y); 
                    if (mod(y, period) < gapWidth) discard;
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide
        });

        const sun = new THREE.Mesh(sunGeom, sunMat);

        // Place it far in the distance, slightly above the horizon
        sun.position.set(0, 15, -150);
        // Make sure it faces the camera area
        sun.lookAt(0, 15, 0);

        this.scene.add(sun);
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
