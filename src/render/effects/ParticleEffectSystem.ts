import * as THREE from 'three';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import type {
    IParticleBurstOptions,
    IParticleCurveKeyframe,
    IParticleEmissionOptions,
    IParticleEmitterHandle,
    IParticleEmitterOptions,
    IParticleRange
} from '../../content/contracts/IObjectRuntimeContext';

class NullParticleEmitterHandle implements IParticleEmitterHandle {
    public emit(_options: IParticleEmissionOptions): void { }
    public dispose(): void { }
}

interface ISpriteParticle {
    sprite: THREE.Sprite;
    material: THREE.SpriteMaterial;
    velocity: THREE.Vector3;
    life: number;
    maxLife: number;
    initialSize: number;
}

class SpriteParticleEmitter implements IParticleEmitterHandle {
    private readonly root = new THREE.Group();
    private readonly particles: ISpriteParticle[] = [];
    private cursor = 0;
    private disposed = false;
    private readonly gravity: THREE.Vector3;
    private readonly drag: number;
    private readonly defaultColor: THREE.Color;
    private readonly alphaOverLife: IParticleCurveKeyframe[];
    private readonly sizeOverLife: IParticleCurveKeyframe[];
    private readonly defaultSize: IParticleRange;
    private readonly defaultLifetime: IParticleRange;

    constructor(
        scene: THREE.Scene,
        texture: THREE.Texture | null,
        options: IParticleEmitterOptions
    ) {
        this.root.name = 'SpriteParticleEmitter';
        this.root.frustumCulled = false;
        scene.add(this.root);

        this.gravity = new THREE.Vector3(
            options.gravity?.x ?? 0,
            options.gravity?.y ?? 0,
            options.gravity?.z ?? 0
        );
        this.drag = THREE.MathUtils.clamp(options.drag ?? 0.98, 0, 1);
        this.defaultColor = new THREE.Color(options.color ?? 0xffffff);
        this.alphaOverLife = normalizeCurve(options.alphaOverLife, [
            { t: 0, value: 1 },
            { t: 1, value: 0 }
        ]);
        this.sizeOverLife = normalizeCurve(options.sizeOverLife, [
            { t: 0, value: 1 },
            { t: 1, value: 1 }
        ]);
        this.defaultSize = options.size ?? { min: 0.1, max: 0.2 };
        this.defaultLifetime = options.lifetime ?? { min: 0.2, max: 0.4 };

        const capacity = Math.max(1, Math.floor(options.capacity ?? 32));
        const blending = options.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
        for (let i = 0; i < capacity; i += 1) {
            const material = new THREE.SpriteMaterial({
                map: texture ?? null,
                color: this.defaultColor.clone(),
                transparent: true,
                depthWrite: options.depthWrite ?? false,
                opacity: 0,
                blending
            });
            const sprite = new THREE.Sprite(material);
            sprite.visible = false;
            this.root.add(sprite);
            this.particles.push({
                sprite,
                material,
                velocity: new THREE.Vector3(),
                life: 0,
                maxLife: 0,
                initialSize: 0
            });
        }
    }

    public emit(options: IParticleEmissionOptions): void {
        if (this.disposed) return;

        const count = Math.max(1, Math.floor(options.count ?? 1));
        const velocityMin = options.velocityMin ?? { x: 0, y: 0, z: 0 };
        const velocityMax = options.velocityMax ?? velocityMin;
        const sizeRange = options.size ?? this.defaultSize;
        const lifetimeRange = options.lifetime ?? this.defaultLifetime;
        const jitter = options.positionJitter ?? { x: 0, y: 0, z: 0 };
        const color = new THREE.Color(options.color ?? this.defaultColor);

        for (let n = 0; n < count; n += 1) {
            const particle = this.alloc();
            if (!particle) return;

            particle.sprite.position.set(
                options.position.x + randomRange(-jitter.x, jitter.x),
                options.position.y + randomRange(-jitter.y, jitter.y),
                options.position.z + randomRange(-jitter.z, jitter.z)
            );
            particle.velocity.set(
                randomRange(velocityMin.x, velocityMax.x),
                randomRange(velocityMin.y, velocityMax.y),
                randomRange(velocityMin.z, velocityMax.z)
            );
            particle.initialSize = randomRange(sizeRange.min, sizeRange.max);
            particle.maxLife = randomRange(lifetimeRange.min, lifetimeRange.max);
            particle.life = particle.maxLife;
            particle.sprite.scale.setScalar(particle.initialSize * evaluateCurve(this.sizeOverLife, 0));
            particle.material.color.copy(color);
            particle.material.opacity = evaluateCurve(this.alphaOverLife, 0);
            particle.sprite.visible = true;
        }
    }

    public update(delta: number): void {
        if (this.disposed || delta <= 0) return;

        const damping = Math.pow(this.drag, delta * 60);
        for (const particle of this.particles) {
            if (particle.life <= 0) continue;

            particle.life -= delta;
            if (particle.life <= 0) {
                particle.life = 0;
                particle.material.opacity = 0;
                particle.sprite.visible = false;
                continue;
            }

            const baseT = 1 - (particle.life / Math.max(0.0001, particle.maxLife));
            particle.velocity.x = (particle.velocity.x + (this.gravity.x * delta)) * damping;
            particle.velocity.y = (particle.velocity.y + (this.gravity.y * delta)) * damping;
            particle.velocity.z = (particle.velocity.z + (this.gravity.z * delta)) * damping;
            particle.sprite.position.addScaledVector(particle.velocity, delta);
            particle.material.opacity = evaluateCurve(this.alphaOverLife, baseT);
            particle.sprite.scale.setScalar(particle.initialSize * evaluateCurve(this.sizeOverLife, baseT));
        }
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        for (const particle of this.particles) {
            particle.material.dispose();
        }
        this.particles.length = 0;
    }

    private alloc(): ISpriteParticle | null {
        const total = this.particles.length;
        for (let pass = 0; pass < total; pass += 1) {
            const particle = this.particles[this.cursor];
            this.cursor = (this.cursor + 1) % total;
            if (particle.life <= 0) {
                return particle;
            }
        }
        return null;
    }
}

export class ParticleEffectSystem implements IUpdatable {
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
    private readonly textureLoader = new THREE.TextureLoader();
    private readonly textureCache = new Map<string, Promise<THREE.Texture>>();
    private readonly emitters = new Set<SpriteParticleEmitter>();

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
        for (const emitter of this.emitters) {
            emitter.update(delta);
        }

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

    public async createEmitter(options: IParticleEmitterOptions): Promise<IParticleEmitterHandle> {
        if (!this.scene) {
            return new NullParticleEmitterHandle();
        }

        const texture = options.textureUrl
            ? await this.loadTexture(options.textureUrl).catch((error) => {
                console.error('[ParticleEffectSystem] Failed to load particle texture:', error);
                return null;
            })
            : null;

        const emitter = new SpriteParticleEmitter(this.scene, texture, options);
        this.emitters.add(emitter);
        const originalDispose = emitter.dispose.bind(emitter);
        emitter.dispose = () => {
            originalDispose();
            this.emitters.delete(emitter);
        };
        return emitter;
    }

    private alloc(): number {
        for (let pass = 0; pass < this.capacity; pass++) {
            const i = this.cursor;
            this.cursor = (this.cursor + 1) % this.capacity;
            if (this.active[i] === 0) return i;
        }
        return -1;
    }

    private loadTexture(url: string): Promise<THREE.Texture> {
        const cached = this.textureCache.get(url);
        if (cached) {
            return cached;
        }
        const promise = this.textureLoader.loadAsync(url).catch((error) => {
            this.textureCache.delete(url);
            throw error;
        });
        this.textureCache.set(url, promise);
        return promise;
    }
}

function normalizeCurve(curve: IParticleCurveKeyframe[] | undefined, fallback: IParticleCurveKeyframe[]): IParticleCurveKeyframe[] {
    const source = curve && curve.length > 0 ? curve : fallback;
    return [...source].sort((a, b) => a.t - b.t);
}

function evaluateCurve(curve: IParticleCurveKeyframe[], t: number): number {
    if (curve.length === 0) return 1;
    if (t <= curve[0].t) return curve[0].value;
    for (let i = 0; i < curve.length - 1; i += 1) {
        const a = curve[i];
        const b = curve[i + 1];
        if (t > b.t) continue;
        const span = Math.max(0.0001, b.t - a.t);
        const alpha = (t - a.t) / span;
        return THREE.MathUtils.lerp(a.value, b.value, alpha);
    }
    return curve[curve.length - 1].value;
}

function randomRange(min: number, max: number): number {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + ((hi - lo) * Math.random());
}
