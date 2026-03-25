import * as THREE from 'three';
import { IScenarioConfig } from '../../app/AppContext';
import { createSynthBlockMaterial } from '../../render/materials/SynthBlockMaterial';

export class EnvironmentBuilder {
    private static decorationsVisible: boolean = true;
    private scene: THREE.Scene;
    private random: () => number;

    private decorationRoot: THREE.Group | null = null;
    private hills: THREE.Group | null = null;
    private stars: THREE.Points | null = null;
    private floor: THREE.Mesh | null = null;
    private grid: THREE.Mesh | null = null;
    private gridUniforms: any = null;
    private lights: THREE.Group | null = null;
    private sun: THREE.Mesh | null = null;
    private skyline: THREE.Group | null = null;

    constructor(scene: THREE.Scene, randomFunc: () => number) {
        this.scene = scene;
        this.random = randomFunc;
    }

    public static setDecorationsVisible(visible: boolean): void {
        EnvironmentBuilder.decorationsVisible = visible;
    }

    public applyConfig(config: IScenarioConfig): void {
        if (!config || !this.scene) return;
        this.ensureDecorationRoot();

        if (config.skyColor) {
            this.scene.background = new THREE.Color(config.skyColor);
            const fogNear = config.fogNear || 10;
            const fogFar = config.fogFar || 1000;

            if (!this.scene.fog) {
                this.scene.fog = new THREE.Fog(config.skyColor, fogNear, fogFar);
            } else {
                (this.scene.fog as THREE.Fog).color.set(config.skyColor);
                (this.scene.fog as THREE.Fog).near = fogNear;
                (this.scene.fog as THREE.Fog).far = fogFar;
            }
        }

        if (!this.hills) this.createDistantHills();
        if (!this.stars) this.createStarfield();
        if (!this.floor) this.createFloor();
        if (!this.lights) this.setupLighting();
        if (!this.sun) this.createSynthwaveSun();
        if (!this.skyline) this.createFloatingMegacubeSkyline();
        this.applyDecorationVisibility();
    }

    public update(delta: number): void {
        this.applyDecorationVisibility();

        if (this.gridUniforms) {
            this.gridUniforms.uTime.value += delta;
        }

        if (this.stars) {
            this.stars.rotation.y += delta * 0.01;
            this.stars.rotation.x += delta * 0.005;
        }
    }

    private createDistantHills(): void {
        this.ensureDecorationRoot();
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
            const zDir = Math.cos(angle);
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
        this.decorationRoot?.add(this.hills);
    }

    private createStarfield(): void {
        this.ensureDecorationRoot();
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
        this.decorationRoot?.add(this.stars);
    }

    private createFloor(): void {
        this.ensureDecorationRoot();
        const floorGeo = new THREE.PlaneGeometry(1000, 1000);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x020205,
            metalness: 0.9,
            roughness: 0.45,
        });
        this.floor = new THREE.Mesh(floorGeo, floorMat);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.y = -0.05;
        this.decorationRoot?.add(this.floor);

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

        this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), gridMat);
        this.grid.rotation.x = -Math.PI / 2;
        this.grid.position.y = 0.01;
        this.decorationRoot?.add(this.grid);
    }

    private setupLighting(): void {
        this.lights = new THREE.Group();
        this.lights.add(new THREE.AmbientLight(0xff00ff, 0.5));
        this.lights.add(new THREE.HemisphereLight(0x00ffff, 0x800080, 1));
        const dirLight = new THREE.DirectionalLight(0xffaa88, 1.2);
        dirLight.position.set(0, 60, -600);
        this.lights.add(dirLight);
        this.scene.add(this.lights);
    }

    private createSynthwaveSun(): void {
        this.ensureDecorationRoot();
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
        this.decorationRoot?.add(this.sun);
    }

    private createFloatingMegacubeSkyline(): void {
        this.ensureDecorationRoot();
        this.skyline = new THREE.Group();
        this.skyline.name = 'floating-megacube-skyline';

        const material = createSynthBlockMaterial({
            topColor: 0x7ea7ff,
            bottomColor: 0x140d2b,
            edgeColor: 0xd9e5ff,
            edgeThicknessWorld: 0.75,
            edgeFeatherWorld: 0.35,
            edgeIntensity: 0.3,
            rimIntensity: 0.08
        });
        material.transparent = true;
        material.opacity = 0.82;
        material.depthWrite = true;

        const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
        const towerCount = 10;

        for (let i = 0; i < towerCount; i++) {
            const angle = (i / towerCount) * Math.PI * 2 + this.random() * 0.32;
            const radius = 230 + this.random() * 75;
            const baseX = Math.sin(angle) * radius;
            const baseZ = Math.cos(angle) * radius;
            const stackCount = 2 + Math.floor(this.random() * 3);

            let currentY = 28 + this.random() * 12;
            let topY = currentY;
            for (let j = 0; j < stackCount; j++) {
                const width = 18 + this.random() * 24;
                const height = 10 + this.random() * 22;
                const depth = 18 + this.random() * 24;

                const cube = new THREE.Mesh(cubeGeometry, material);
                cube.position.set(
                    baseX + (this.random() - 0.5) * 8,
                    currentY + height * 0.5,
                    baseZ + (this.random() - 0.5) * 8
                );
                cube.scale.set(width, height, depth);
                cube.rotation.y = this.random() * Math.PI * 2;
                this.skyline.add(cube);

                currentY += height + 8 + this.random() * 14;
                topY = Math.max(topY, cube.position.y + height * 0.5);
            }

            // Add a thin structural spine so towers read as grounded futuristic buildings.
            if (this.random() > 0.25) {
                const pillar = new THREE.Mesh(cubeGeometry, material);
                const pillarWidth = 3.2 + this.random() * 2.0;
                const pillarDepth = 3.2 + this.random() * 2.0;
                const pillarBottom = -26 - this.random() * 14;
                const pillarTop = topY + 16 + this.random() * 18;
                const pillarHeight = pillarTop - pillarBottom;

                pillar.position.set(baseX, pillarBottom + pillarHeight * 0.5, baseZ);
                pillar.scale.set(pillarWidth, pillarHeight, pillarDepth);
                pillar.rotation.y = this.random() * Math.PI * 2;
                this.skyline.add(pillar);
            }
        }

        this.decorationRoot?.add(this.skyline);
    }

    private applyDecorationVisibility(): void {
        if (this.decorationRoot) {
            this.decorationRoot.visible = EnvironmentBuilder.decorationsVisible;
        }
    }

    private ensureDecorationRoot(): void {
        if (this.decorationRoot) return;
        this.decorationRoot = new THREE.Group();
        this.decorationRoot.name = 'environment-decorations';
        this.scene.add(this.decorationRoot);
    }

    public clearProcedural(): void {
        const remove = (obj: THREE.Object3D | null) => {
            if (!obj) return;
            if (this.scene) {
                this.scene.remove(obj);
            }
            obj.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
                    else mesh.material.dispose();
                }
            });
        };
        remove(this.hills);
        remove(this.stars);
        remove(this.floor);
        remove(this.grid);
        remove(this.sun);
        remove(this.skyline);
        remove(this.decorationRoot);
        remove(this.lights);
        this.decorationRoot = null;
        this.hills = null;
        this.stars = null;
        this.floor = null;
        this.grid = null;
        this.lights = null;
        this.sun = null;
        this.skyline = null;
        this.gridUniforms = null;
        if (this.scene) {
            this.scene.background = null;
            this.scene.fog = null;
        }
    }
}
