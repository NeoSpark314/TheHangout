import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedPhysicsPropObjectInstance } from '../runtime/BaseReplicatedPhysicsPropObjectInstance';

interface IExampleSharedPropSnapshot {
    tint: number;
}

class ExampleSharedPropInstance extends BaseReplicatedPhysicsPropObjectInstance {
    private readonly mesh: THREE.Mesh | null;
    private tint: number;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        const size = typeof config.size === 'number' ? config.size : 0.14;
        const tint = typeof config.color === 'number' ? config.color : 0x33ddff;
        const mesh = context.scene.isRenderingAvailable()
            ? createMesh(size, tint)
            : null;

        super(context, 'example-shared-prop', {
            shape: 'box',
            size,
            position: config.position ?? { x: 0, y: 1.1, z: 0 },
            mesh: mesh ?? new THREE.Group(),
            halfExtents: { x: size / 2, y: size / 2, z: size / 2 },
            ownerId: typeof config.ownerId === 'string' || config.ownerId === null ? config.ownerId : undefined,
            entityId: config.entityId ?? config.id,
            replicationProfileId: 'default-prop'
        });

        this.mesh = mesh;
        this.tint = tint;
    }

    public onReplicationEvent(eventType: string, data: unknown, _meta: IObjectReplicationMeta): void {
        if (eventType !== 'set-tint' || !data || typeof data !== 'object') return;
        const payload = data as { tint?: number };
        if (typeof payload.tint !== 'number') return;
        this.applyTint(payload.tint);
    }

    public captureReplicationSnapshot(): unknown {
        return { tint: this.tint } satisfies IExampleSharedPropSnapshot;
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const payload = snapshot as Partial<IExampleSharedPropSnapshot>;
        if (typeof payload.tint !== 'number') return;
        this.applyTint(payload.tint);
    }

    private applyTint(tint: number): void {
        this.tint = tint;
        if (!this.mesh) return;
        const material = this.mesh.material as THREE.MeshStandardMaterial;
        material.color.setHex(tint);
        material.emissive.setHex(tint);
    }
}

function createMesh(size: number, tint: number): THREE.Mesh {
    return new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({
            color: tint,
            emissive: tint,
            emissiveIntensity: 0.18,
            metalness: 0.35,
            roughness: 0.45
        })
    );
}

export class ExampleSharedPropObject implements IObjectModule {
    public readonly id = 'example-shared-prop';
    public readonly displayName = 'Example Shared Prop';
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): ExampleSharedPropInstance {
        return new ExampleSharedPropInstance(context, config);
    }
}
