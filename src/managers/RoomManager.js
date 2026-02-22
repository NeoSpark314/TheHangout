// managers/RoomManager.js
import * as THREE from 'three';
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { PACKET_TYPES } from '../utils/Constants.js';

export class RoomManager {
    constructor() {
        this.scene = null;
        this._seed = 0;
    }

    /**
     * Seeded PRNG (mulberry32). Produces deterministic values 0..1 from this._seed.
     */
    random() {
        this._seed |= 0;
        this._seed = (this._seed + 0x6D2B79F5) | 0;
        let t = Math.imul(this._seed ^ (this._seed >>> 15), 1 | this._seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    init(scene) {
        this.scene = scene;
        this.applyConfig(gameState.roomConfig);
    }

    applyConfig(config) {
        if (!this.scene || !config) return;

        console.log('[RoomManager] Applying Room Config:', config);

        // Update Background
        if (config.skyColor) {
            this.scene.background = new THREE.Color(config.skyColor);
        }

        // Update Fog (Shifted for Distant Horizon)
        if (config.skyColor) {
            const fogNear = config.fogNear || 10;
            const fogFar = config.fogFar || 1000;

            if (!this.scene.fog) {
                this.scene.fog = new THREE.Fog(config.skyColor, fogNear, fogFar);
            } else {
                this.scene.fog.color.set(config.skyColor);
                this.scene.fog.near = fogNear;
                this.scene.fog.far = fogFar;
            }
        }

        // Seed the PRNG from config (host-generated, synced to guests)
        if (config.seed !== undefined) {
            this._seed = config.seed;
        }

        // Create the environment components
        if (!this.table) this.createTable();
        if (!this.hills) this.createDistantHills();
        if (!this.stars) this.createStarfield();
        if (!this.floor) this.createFloor();
        if (!this.hologram) this.createHologram();
        if (!this.podest) this.createPodest();
        if (!this.decorations) this.createDecorations();
        if (!this.grabbablesSpawned) this.createGrabbables();

        // Architectural Centralization: Sun, Lights, and Ground Physics
        if (!this.lights) this.setupLighting();
        if (!this.sun) this.createSynthwaveSun();

        // Ground physics (Authority moved from WorldManager)
        if (gameState.managers.physics && !this.groundPhysics) {
            gameState.managers.physics.createGround(25);
            this.groundPhysics = true;
        }
    }

    update(delta) {
        // Animate Grid
        if (this.gridUniforms) {
            this.gridUniforms.uTime.value += delta;
        }

        // Animate Stars (Very slow rotation)
        if (this.stars) {
            this.stars.rotation.y += delta * 0.01;
            this.stars.rotation.x += delta * 0.005;
        }

        // Animate Hologram
        if (this.hologram) {
            this.hologram.rotation.y += delta * 1.5;
            this.hologram.rotation.z += delta * 0.5;
            // Float up and down
            this.hologram.position.y = 0.5 + Math.sin(Date.now() * 0.002) * 0.05;
        }
    }

    createDistantHills() {
        if (!this.scene) return;

        this.hills = new THREE.Group();
        const hillCount = 36;
        const radius = 400;

        const mountainMat = new THREE.MeshPhongMaterial({
            color: 0x100520,
            emissive: 0x330066,
            shininess: 10,
            flatShading: true
        });

        const wireMat = new THREE.LineBasicMaterial({
            color: 0xbb00ff,
            transparent: true,
            opacity: 0.5
        });

        for (let i = 0; i < hillCount; i++) {
            const angle = (i / hillCount) * Math.PI * 2;

            // Sun is at (0, 60, -600) i.e. angle π. Suppress height near the sun
            // so it's always clearly visible. cos(angle) < -0.5 means roughly behind the sun.
            const zDir = Math.cos(angle); // -1 = directly behind sun
            const sunClearance = zDir < -0.5 ? 0.3 : 1.0;

            const h = (40 + this.random() * 120) * sunClearance;
            const w = 50 + this.random() * 80;

            const geo = new THREE.ConeGeometry(w, h, 4);
            const mountain = new THREE.Mesh(geo, mountainMat);

            mountain.position.set(
                Math.sin(angle) * radius,
                h / 2 - 5,
                Math.cos(angle) * radius
            );
            mountain.rotation.y = this.random() * Math.PI;

            const edges = new THREE.EdgesGeometry(geo);
            const outline = new THREE.LineSegments(edges, wireMat);
            mountain.add(outline);

            this.hills.add(mountain);
        }

        this.scene.add(this.hills);
    }

    createStarfield() {
        if (!this.scene) return;

        const starCount = 5000;
        const starGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const radius = 800;

        for (let i = 0; i < starCount; i++) {
            const theta = 2 * Math.PI * this.random();
            const phi = Math.acos(2 * this.random() - 1);

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = radius * Math.cos(phi);

            const type = this.random();
            if (type > 0.8) {
                colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;
            } else if (type > 0.4) {
                colors[i * 3] = 0.4; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;
            } else {
                colors[i * 3] = 1; colors[i * 3 + 1] = 0.4; colors[i * 3 + 2] = 1;
            }
        }

        starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const starMat = new THREE.PointsMaterial({
            size: 1.8,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            sizeAttenuation: true
        });

        this.stars = new THREE.Points(starGeo, starMat);
        this.scene.add(this.stars);
    }

    createFloor() {
        if (!this.scene) return;

        const floorGeo = new THREE.PlaneGeometry(1000, 1000);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x020205,
            metalness: 0.9,
            roughness: 0.45, // Softened from 0.1
        });
        this.floor = new THREE.Mesh(floorGeo, floorMat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.y = -0.05;
        this.scene.add(this.floor);

        const gridGeo = new THREE.PlaneGeometry(1000, 1000);
        this.gridUniforms = {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0x00ffff) },
            uGridScale: { value: 50.0 }
        };

        const gridMat = new THREE.ShaderMaterial({
            uniforms: this.gridUniforms,
            transparent: true,
            side: THREE.DoubleSide,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform float uTime;
                uniform vec3 uColor;
                uniform float uGridScale;

                void main() {
                    vec2 uv = vUv * uGridScale;
                    // uv.y += uTime * 0.2; // REMOVED scrolling as per user request

                    vec2 grid = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
                    float line = min(grid.x, grid.y);
                    float mask = 1.0 - min(line, 1.0);
                    
                    float dist = distance(vUv, vec2(0.5));
                    float fade = smoothstep(0.5, 0.0, dist);
                    float pulse = 0.8 + 0.2 * sin(uTime * 2.5);
                    
                    gl_FragColor = vec4(uColor * pulse, mask * fade * 0.7);
                }
            `
        });

        this.grid = new THREE.Mesh(gridGeo, gridMat);
        this.grid.rotation.x = -Math.PI / 2;
        this.grid.position.y = 0.01;
        this.scene.add(this.grid);
    }

    createTable() {
        if (!this.scene) return;

        const tableGroup = new THREE.Group();

        const topGeo = new THREE.CylinderGeometry(2, 2, 0.1, 6);
        const topMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            emissive: 0x001133,
            metalness: 0.9,
            roughness: 0.4 // Softened from 0.1
        });
        this.table = new THREE.Mesh(topGeo, topMat);
        this.table.position.y = 1.0;
        tableGroup.add(this.table);

        const edges = new THREE.EdgesGeometry(topGeo);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffff });
        const outline = new THREE.LineSegments(edges, lineMat);
        this.table.add(outline);

        const coreGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 6);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.y = 0.05;
        this.table.add(core);

        const coreEdges = new THREE.EdgesGeometry(coreGeo);
        const coreOutline = new THREE.LineSegments(coreEdges, lineMat);
        core.add(coreOutline);

        const baseGeo = new THREE.CylinderGeometry(0.3, 0.8, 1.0, 6);
        const baseMat = new THREE.MeshBasicMaterial({ color: 0x0a0a1a });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 1.0 / 2;
        tableGroup.add(base);

        this.scene.add(tableGroup);

        if (gameState.managers.physics) {
            // Table top: hexagonal cylinder (2m radius, 0.1m height) at y=1.0
            gameState.managers.physics.createHexagon(2.0, 0.1, { x: 0, y: 1.0, z: 0 }, tableGroup, true);
            // Pedestal: narrow column (0.4m radius, 0.5m half-height) at y=0.5
            gameState.managers.physics.createCuboid(0.4, 0.5, 0.4, { x: 0, y: 0.5, z: 0 }, null, true);
        }
    }

    createHologram() {
        if (!this.table) return;

        const holoGeo = new THREE.IcosahedronGeometry(0.35, 1);
        const holoMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            wireframe: true,
            transparent: true,
            opacity: 0.5
        });

        this.hologram = new THREE.Mesh(holoGeo, holoMat);
        this.hologram.position.y = 0.5;
        this.table.add(this.hologram);
    }

    createPodest() {
        if (!this.scene) return;

        // The Podest: A 10x10 square platform made of block-like segments
        this.podest = new THREE.Group();
        const podestSize = 8; // Platform half-extent (8m x 8m)
        const cubeSize = 1.0;

        const podestMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a20,
            metalness: 0.8,
            roughness: 0.5, // Softened from 0.2
            emissive: 0x000510
        });

        const wireMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3 });

        // We'll create a few slightly different height blocks to give it "texture"
        const blockGeo = new THREE.BoxGeometry(cubeSize, 0.2, cubeSize);
        const segmentCount = 64; // 8x8 grid

        for (let x = -4; x < 4; x++) {
            for (let z = -4; z < 4; z++) {
                const hOffset = this.random() * 0.05;
                const segment = new THREE.Mesh(blockGeo, podestMat);
                segment.position.set(x + 0.5, 0.1 + hOffset, z + 0.5);

                // Edges for each block for that high-detail wireframe look
                const segmentEdges = new THREE.EdgesGeometry(blockGeo);
                const segmentOutline = new THREE.LineSegments(segmentEdges, wireMat);
                segment.add(segmentOutline);

                this.podest.add(segment);
            }
        }

        this.scene.add(this.podest);

        // Physics for the podest (Platform) - Single solid box for stability
        if (gameState.managers.physics) {
            // Half-extents for an 8x0.2x8 platform
            gameState.managers.physics.createCuboid(4.0, 0.1, 4.0, { x: 0, y: 0.1, z: 0 }, this.podest, true);
        }
    }

    createDecorations() {
        if (!this.scene) return;

        this.decorations = new THREE.Group();
        const pillarCount = 12;
        const radius = 6.0;

        const pillarMat = new THREE.MeshStandardMaterial({
            color: 0x050515,
            metalness: 0.9,
            roughness: 0.1,
            emissive: 0x001122
        });
        const wireMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.4 });

        for (let i = 0; i < pillarCount; i++) {
            const angle = (i / pillarCount) * Math.PI * 2;
            const h = 0.5 + this.random() * 2.5;
            const w = 0.4 + this.random() * 0.6;

            const geo = new THREE.BoxGeometry(w, h, w);
            const pillar = new THREE.Mesh(geo, pillarMat);

            pillar.position.set(
                Math.sin(angle) * (radius + this.random() * 2),
                h / 2,
                Math.cos(angle) * (radius + this.random() * 2)
            );

            const edges = new THREE.EdgesGeometry(geo);
            const outline = new THREE.LineSegments(edges, wireMat);
            pillar.add(outline);

            this.decorations.add(pillar);
        }

        this.scene.add(this.decorations);
    }

    setupLighting() {
        if (!this.scene) return;
        this.lights = new THREE.Group();

        // Ambient Light (Soft Magenta cast)
        const ambientLight = new THREE.AmbientLight(0xff00ff, 0.5);
        this.lights.add(ambientLight);

        // Hemisphere Light (Cyan from above, purple from below)
        const hemiLight = new THREE.HemisphereLight(0x00ffff, 0x800080, 1);
        this.lights.add(hemiLight);

        // Directional Light (Aligned with the Synthwave Sun)
        // Sun is at (0, 60, -600), so we place the light at a similar vector
        const dirLight = new THREE.DirectionalLight(0xffaa88, 1.2); // Warm sun-kissed pink/orange
        dirLight.position.set(0, 60, -600);
        this.lights.add(dirLight);

        this.scene.add(this.lights);
    }

    createSynthwaveSun() {
        if (!this.scene) return;

        const sunGeom = new THREE.CircleGeometry(120, 64);
        const sunMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0xff8000) },
                bottomColor: { value: new THREE.Color(0xff0080) }
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
                    vec3 color = mix(bottomColor, topColor, y);
                    float period = 0.08;
                    float gapWidth = 0.04 * (1.0 - y); 
                    if (mod(y, period) < gapWidth) discard;
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide
        });

        this.sun = new THREE.Mesh(sunGeom, sunMat);
        this.sun.position.set(0, 60, -600);
        this.sun.lookAt(0, 60, 0);

        this.scene.add(this.sun);
    }

    getSpawnPoint(index) {
        const radius = 2.5;
        const angle = (index * (Math.PI / 4)) + Math.PI;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;
        const yaw = angle;

        return {
            position: new THREE.Vector3(x, 0.2, z), // Spawn ON TOP of the podest
            yaw: yaw
        };
    }

    createGrabbables() {
        const physics = gameState.managers.physics;
        const render = gameState.managers.render;
        if (!physics || !render || !this.scene) return;

        this.grabbablesSpawned = true;

        const cubeSize = 0.12;
        const cubeCount = 6;
        const tableRadius = 1.0; // Arrange cubes in a circle on the table
        const tableY = 1.85;     // Higher up so they drop to the table

        const colors = [
            0xff0055, // Hot pink
            0x00ff88, // Neon green
            0x5500ff, // Purple
            0xff8800, // Orange
            0x00ccff, // Cyan
            0xffff00  // Yellow
        ];

        for (let i = 0; i < cubeCount; i++) {
            const angle = (i / cubeCount) * Math.PI * 2;
            const x = Math.sin(angle) * tableRadius;
            const z = Math.cos(angle) * tableRadius;
            const position = { x, y: tableY, z };

            const geo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
            const mat = new THREE.MeshStandardMaterial({
                color: colors[i],
                emissive: colors[i],
                emissiveIntensity: 0.3,
                metalness: 0.6,
                roughness: 0.3
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, tableY, z);

            const edges = new THREE.EdgesGeometry(geo);
            const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
            mesh.add(new THREE.LineSegments(edges, lineMat));

            this.scene.add(mesh);

            physics.createGrabbable(cubeSize, position, mesh);
        }
    }

    updateConfig(newConfig) {
        const oldSeed = gameState.roomConfig.seed;
        gameState.roomConfig = { ...gameState.roomConfig, ...newConfig };

        // If the seed changed, tear down procedural elements so they get rebuilt
        if (newConfig.seed !== undefined && newConfig.seed !== oldSeed) {
            this.clearProceduralElements();
        }

        this.applyConfig(gameState.roomConfig);
    }

    /**
     * Removes all seed-dependent procedural scene elements so they can be
     * re-created with a new seed. Deterministic elements (table, floor,
     * hologram, lights, sun, physics) are left untouched.
     */
    clearProceduralElements() {
        const remove = (obj) => {
            if (!obj) return;
            this.scene.remove(obj);
            obj.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        };

        remove(this.hills);
        remove(this.stars);
        remove(this.podest);
        remove(this.decorations);

        this.hills = null;
        this.stars = null;
        this.podest = null;
        this.decorations = null;
    }
}
