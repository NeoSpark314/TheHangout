import * as THREE from 'three';
import type { AppContext } from '../../app/AppContext';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IEntity } from '../../shared/contracts/IEntity';

class DebugBeaconEntity implements IEntity {
    public readonly type = 'CONTENT_DEBUG_BEACON';
    public isAuthority = true;
    public isDestroyed = false;
    private readonly mesh: THREE.Mesh;
    private elapsed = 0;
    private readonly baseY: number;

    constructor(
        public id: string,
        private context: AppContext,
        position: THREE.Vector3,
        color: number
    ) {
        const geometry = new THREE.SphereGeometry(0.12, 12, 12);
        const material = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.45
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        this.mesh.userData.entityId = id;
        this.baseY = position.y;

        const render = this.context.runtime.render;
        if (render) {
            render.scene.add(this.mesh);
            render.interactionGroup.add(this.mesh);
        }
    }

    public update(delta: number): void {
        if (this.isDestroyed) return;
        this.elapsed += delta;
        this.mesh.rotation.y += delta * 1.5;
        this.mesh.position.y = this.baseY + Math.sin(this.elapsed * 2.2) * 0.04;
    }

    public destroy(): void {
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        const render = this.context.runtime.render;
        if (render) {
            render.interactionGroup.remove(this.mesh);
            render.scene.remove(this.mesh);
        }

        this.mesh.geometry.dispose();
        const material = this.mesh.material;
        if (Array.isArray(material)) {
            for (const entry of material) {
                entry.dispose();
            }
        } else {
            material.dispose();
        }
    }
}

export class DebugBeaconObject implements IObjectModule {
    public readonly id = 'debug-beacon';
    public readonly displayName = 'Debug Beacon';
    public readonly tags = ['prototype', 'visual'];
    public readonly networked = false;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): IEntity | null {
        if (!context.app.runtime.render) {
            return null;
        }

        const position = config.position
            ? new THREE.Vector3(config.position.x, config.position.y, config.position.z)
            : new THREE.Vector3(0, 1.15, -1.8);
        const colorValue = typeof config.color === 'number' ? config.color : 0x00ffff;

        return new DebugBeaconEntity(
            context.instanceId,
            context.app,
            position,
            colorValue
        );
    }
}
