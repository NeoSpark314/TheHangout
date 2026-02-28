import * as THREE from 'three';
import { IUpdatable } from '../interfaces/IUpdatable';

export interface IParticleBurstOptions {
    position: { x: number; y: number; z: number };
    color?: number | string;
    count?: number;
    speed?: number;
    lifetime?: number;
    size?: number; // point size scalar in world-like units
}

export class ParticleSystemManager implements IUpdatable {
    private readonly capacity = 1200;
    private readonly gravity = 2.3;
    private readonly drag = 0.985;
    private readonly defaultColor = new THREE.Color(0x00ffff);

    private root: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private geometry: THREE.BufferGeometry;
    private material: THREE.ShaderMaterial;

    private positions: Float32Array;
    private colors: Float32Array;
    private sizes: Float32Array;
    private alphas: Float32Array;
    private velocities: Float32Array;
    private life: Float32Array;
    private maxLife: Float32Array;
    private active: Uint8Array;
    private cursor = 0;

    constructor(private scene: THREE.Scene) {
        this.positions = new Float32Array(this.capacity * 3);
        this.colors = new Float32Array(this.capacity * 3);
        this.sizes = new Float32Array(this.capacity);
        this.alphas = new Float32Array(this.capacity);
        this.velocities = new Float32Array(this.capacity * 3);
        this.life = new Float32Array(this.capacity);
        this.maxLife = new Float32Array(this.capacity);
        this.active = new Uint8Array(this.capacity);

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
        this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
        this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
        this.geometry.setDrawRange(0, this.capacity);

        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
            uniforms: {
                uScale: { value: 310.0 }
            },
            vertexShader: `
                attribute float aSize;
                attribute float aAlpha;
                varying vec3 vColor;
                varying float vAlpha;
                uniform float uScale;
                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    gl_PointSize = max(1.0, aSize * (uScale / max(0.0001, -mvPosition.z)));
                    vColor = color;
                    vAlpha = aAlpha;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                void main() {
                    vec2 uv = gl_PointCoord * 2.0 - 1.0;
                    float r2 = dot(uv, uv);
                    if (r2 > 1.0) discard;
                    float falloff = exp(-2.2 * r2);
                    gl_FragColor = vec4(vColor, vAlpha * falloff);
                }
            `
        });

        this.root = new THREE.Points(this.geometry, this.material);
        this.root.name = 'ParticlePoints';
        this.root.frustumCulled = false;
        this.scene.add(this.root);
    }

    public update(delta: number): void {
        if (delta <= 0) return;

        let dirty = false;
        for (let i = 0; i < this.capacity; i++) {
            if (this.active[i] === 0) continue;

            this.life[i] -= delta;
            if (this.life[i] <= 0) {
                this.active[i] = 0;
                this.alphas[i] = 0;
                this.sizes[i] = 0;
                dirty = true;
                continue;
            }

            const base = i * 3;
            this.velocities[base + 1] -= this.gravity * delta;
            this.velocities[base] *= this.drag;
            this.velocities[base + 1] *= this.drag;
            this.velocities[base + 2] *= this.drag;

            this.positions[base] += this.velocities[base] * delta;
            this.positions[base + 1] += this.velocities[base + 1] * delta;
            this.positions[base + 2] += this.velocities[base + 2] * delta;

            const t = this.life[i] / Math.max(0.0001, this.maxLife[i]);
            this.alphas[i] = Math.max(0, t);
            this.sizes[i] *= (0.91 + t * 0.09);
            dirty = true;
        }

        if (!dirty) return;
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.aAlpha.needsUpdate = true;
        this.geometry.attributes.aSize.needsUpdate = true;
    }

    public spawnBurst(options: IParticleBurstOptions): void {
        const count = Math.max(4, Math.min(72, Math.floor(options.count ?? 22)));
        const baseSpeed = Math.max(0.12, options.speed ?? 0.8);
        const lifeBase = Math.max(0.06, options.lifetime ?? 0.2);
        const sizeBase = Math.max(0.004, options.size ?? 0.013);
        const color = new THREE.Color(options.color ?? this.defaultColor);

        let wrote = false;
        for (let n = 0; n < count; n++) {
            const i = this.alloc();
            if (i < 0) break;

            const base = i * 3;
            this.active[i] = 1;
            this.positions[base] = options.position.x + (Math.random() - 0.5) * 0.008;
            this.positions[base + 1] = options.position.y + (Math.random() - 0.5) * 0.008;
            this.positions[base + 2] = options.position.z + (Math.random() - 0.5) * 0.008;

            let dx = Math.random() * 2 - 1;
            let dy = Math.random() * 2 - 1;
            let dz = Math.random() * 2 - 1;
            const len = Math.hypot(dx, dy, dz) || 1;
            dx /= len;
            dy /= len;
            dz /= len;

            const speed = baseSpeed * (0.75 + Math.random() * 0.55);
            this.velocities[base] = dx * speed;
            this.velocities[base + 1] = dy * speed;
            this.velocities[base + 2] = dz * speed;

            this.colors[base] = color.r;
            this.colors[base + 1] = color.g;
            this.colors[base + 2] = color.b;

            const life = lifeBase * (0.75 + Math.random() * 0.5);
            this.life[i] = life;
            this.maxLife[i] = life;
            this.alphas[i] = 1.0;
            this.sizes[i] = sizeBase * (0.75 + Math.random() * 0.5);
            wrote = true;
        }

        if (!wrote) return;
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        this.geometry.attributes.aAlpha.needsUpdate = true;
        this.geometry.attributes.aSize.needsUpdate = true;
    }

    private alloc(): number {
        for (let pass = 0; pass < this.capacity; pass++) {
            const i = this.cursor;
            this.cursor = (this.cursor + 1) % this.capacity;
            if (this.active[i] === 0) return i;
        }
        return -1;
    }
}
