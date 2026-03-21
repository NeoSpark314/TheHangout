import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedPhysicsPropObjectInstance } from '../runtime/BaseReplicatedPhysicsPropObjectInstance';

interface ITemplateSnapshot {
    tint: number;
}

/**
 * Starter template for new replicated, grabbable physics-prop objects.
 * Copy this file, rename ids, and register your module in a scenario.
 */
class TemplateReplicatedPhysicsPropInstance extends BaseReplicatedPhysicsPropObjectInstance {
    private readonly mesh: THREE.Mesh | null;
    private tint: number;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        const size = typeof config.size === 'number' ? config.size : 0.16;
        const position = config.position ?? { x: 0, y: 1.15, z: 0 };
        const tint = typeof config.color === 'number' ? config.color : 0x2ee6ff;
        const ownerId = (typeof config.ownerId === 'string' || config.ownerId === null)
            ? config.ownerId
            : undefined;
        const entityId = (typeof config.entityId === 'string' && config.entityId.length > 0)
            ? config.entityId
            : (typeof config.id === 'string' ? config.id : undefined);

        const mesh = context.app.runtime.render
            ? createTemplateMesh(size, tint)
            : null;

        super(context, 'template-replicated-physics-prop', {
            shape: 'box',
            size,
            position,
            mesh: (mesh ?? new THREE.Group()) as any,
            halfExtents: { x: size / 2, y: size / 2, z: size / 2 },
            ownerId,
            entityId,
            replicationProfileId: 'default-prop'
        });

        this.mesh = mesh;
        this.tint = tint;

        if (this.mesh) {
            this.addCleanup(() => disposeMesh(this.mesh!));
        }
    }

    public onReplicationEvent(eventType: string, data: unknown, _meta: IObjectReplicationMeta): void {
        if (eventType !== 'set-tint') return;
        if (!data || typeof data !== 'object') return;
        const payload = data as { tint?: number };
        if (typeof payload.tint !== 'number') return;
        this.applyTint(payload.tint);
    }

    public captureReplicationSnapshot(): unknown {
        return { tint: this.tint } satisfies ITemplateSnapshot;
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const payload = snapshot as Partial<ITemplateSnapshot>;
        if (typeof payload.tint !== 'number') return;
        this.applyTint(payload.tint);
    }

    private applyTint(nextTint: number): void {
        this.tint = nextTint;
        if (!this.mesh) return;
        const material = this.mesh.material as THREE.MeshStandardMaterial;
        material.color.setHex(nextTint);
        material.emissive.setHex(nextTint);
    }
}

function createTemplateMesh(size: number, color: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.22,
        metalness: 0.45,
        roughness: 0.35
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'template-replicated-physics-prop';
    return mesh;
}

function disposeMesh(mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) {
        mat.forEach((m) => m.dispose());
    } else {
        mat.dispose();
    }
}

export class TemplateReplicatedPhysicsPropObject implements IObjectModule {
    public readonly id = 'template-replicated-physics-prop';
    public readonly displayName = 'Template Replicated Physics Prop';
    public readonly tags = ['template', 'shared', 'prop'];
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): TemplateReplicatedPhysicsPropInstance {
        return new TemplateReplicatedPhysicsPropInstance(context, config);
    }
}
