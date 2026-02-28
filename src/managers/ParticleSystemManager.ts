import * as THREE from 'three';
import { IUpdatable } from '../interfaces/IUpdatable';

export interface IParticleBurstOptions {
    position: { x: number; y: number; z: number };
    color?: number | string;
    count?: number;
    speed?: number;
    lifetime?: number;
    size?: number;
}

interface IParticle {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    life: number;
    maxLife: number;
    active: boolean;
}

export class ParticleSystemManager implements IUpdatable {
    private root: THREE.Group = new THREE.Group();
    private particles: IParticle[] = [];
    private gravity: number = 2.8;
    private defaultColor = new THREE.Color(0x00ffff);
    private rand = new THREE.Vector3();

    constructor(private scene: THREE.Scene) {
        this.root.name = 'ParticleSystem';
        this.scene.add(this.root);
        this.prewarm(220);
    }

    public update(delta: number): void {
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (!p.active) continue;

            p.life -= delta;
            if (p.life <= 0) {
                p.active = false;
                p.mesh.visible = false;
                continue;
            }

            p.velocity.y -= this.gravity * delta;
            p.mesh.position.x += p.velocity.x * delta;
            p.mesh.position.y += p.velocity.y * delta;
            p.mesh.position.z += p.velocity.z * delta;

            const t = p.life / p.maxLife;
            p.mesh.scale.setScalar(Math.max(0.001, t));
            (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t);
        }
    }

    public spawnBurst(options: IParticleBurstOptions): void {
        const count = Math.max(4, Math.min(48, Math.floor(options.count ?? 16)));
        const baseSpeed = Math.max(0.4, options.speed ?? 1.7);
        const lifetime = Math.max(0.08, options.lifetime ?? 0.35);
        const baseSize = Math.max(0.006, options.size ?? 0.018);
        const color = new THREE.Color(options.color ?? this.defaultColor);

        for (let i = 0; i < count; i++) {
            const p = this.allocParticle(baseSize);
            if (!p) return;

            p.active = true;
            p.life = lifetime * (0.75 + Math.random() * 0.45);
            p.maxLife = p.life;
            p.mesh.visible = true;
            p.mesh.position.set(options.position.x, options.position.y, options.position.z);

            this.rand.set(Math.random() - 0.5, Math.random() - 0.15, Math.random() - 0.5).normalize();
            const speed = baseSpeed * (0.65 + Math.random() * 0.75);
            p.velocity.copy(this.rand).multiplyScalar(speed);
            p.mesh.scale.setScalar(baseSize);

            const mat = p.mesh.material as THREE.MeshBasicMaterial;
            mat.color.copy(color);
            mat.opacity = 0.95;
        }
    }

    private prewarm(capacity: number): void {
        for (let i = 0; i < capacity; i++) {
            const geo = new THREE.SphereGeometry(1, 4, 3);
            const mat = new THREE.MeshBasicMaterial({
                color: this.defaultColor,
                transparent: true,
                opacity: 0
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            this.root.add(mesh);
            this.particles.push({
                mesh,
                velocity: new THREE.Vector3(),
                life: 0,
                maxLife: 1,
                active: false
            });
        }
    }

    private allocParticle(size: number): IParticle | null {
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.active) continue;
            p.mesh.scale.setScalar(size);
            return p;
        }
        return null;
    }
}

