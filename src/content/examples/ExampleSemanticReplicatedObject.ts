import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';

interface ICounterSnapshot {
    count: number;
}

class ExampleSemanticReplicatedInstance extends BaseReplicatedObjectInstance {
    private readonly marker: THREE.Mesh | null;
    private count = 0;

    constructor(context: IObjectSpawnContext) {
        super(context, 'example-semantic-replicated');
        this.marker = context.scene.isRenderingAvailable()
            ? this.ownSceneObject(createCounterMarker())
            : null;
        this.applyVisuals();
    }

    public update(_delta: number): void { }

    public onReplicationEvent(eventType: string, data: unknown, _meta: IObjectReplicationMeta): void {
        if (eventType !== 'set-count' || !data || typeof data !== 'object') return;
        const payload = data as { count?: number };
        if (typeof payload.count !== 'number') return;
        this.count = payload.count;
        this.applyVisuals();
    }

    public captureReplicationSnapshot(): unknown {
        return { count: this.count } satisfies ICounterSnapshot;
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const payload = snapshot as Partial<ICounterSnapshot>;
        if (typeof payload.count !== 'number') return;
        this.count = payload.count;
        this.applyVisuals();
    }

    public increment(): void {
        this.count += 1;
        this.applyVisuals();
        this.emitSyncEvent('set-count', { count: this.count });
    }

    private applyVisuals(): void {
        if (!this.marker) return;
        const material = this.marker.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.12 + Math.min(0.6, this.count * 0.04);
    }
}

function createCounterMarker(): THREE.Mesh {
    return new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.12, 18),
        new THREE.MeshStandardMaterial({
            color: 0x335577,
            emissive: 0x66ccff,
            emissiveIntensity: 0.12,
            metalness: 0.28,
            roughness: 0.48
        })
    );
}

export class ExampleSemanticReplicatedObject implements IObjectModule {
    public readonly id = 'example-semantic-replicated';
    public readonly displayName = 'Example Semantic Replicated Object';
    public readonly networked = true;
    public readonly portable = false;

    public spawn(context: IObjectSpawnContext, _config: IObjectSpawnConfig): ExampleSemanticReplicatedInstance {
        return new ExampleSemanticReplicatedInstance(context);
    }
}
