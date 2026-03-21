import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import { BaseObjectInstance } from '../runtime/BaseObjectInstance';

class ExampleTriggerZoneInstance extends BaseObjectInstance {
    private readonly marker: THREE.Mesh | null;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        super(context, 'example-trigger-zone');

        const position = config.position ?? { x: 0, y: 1.05, z: 0 };
        if (context.scene.isRenderingAvailable()) {
            this.marker = this.ownSceneObject(createMarker(position));
        } else {
            this.marker = null;
        }

        const trigger = context.triggers.createBox({
            position,
            halfExtents: { x: 0.4, y: 0.25, z: 0.4 },
            filter: 'shared-prop'
        });
        if (!trigger) return;

        this.addCleanup(trigger.onEnter((participant) => {
            if (!this.marker) return;
            const tint = participant.kind === 'shared-prop' ? 0x33ff99 : 0xffaa33;
            (this.marker.material as THREE.MeshStandardMaterial).emissive.setHex(tint);
            (this.marker.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.45;
        }));
        this.addCleanup(trigger.onExit(() => {
            if (!this.marker) return;
            (this.marker.material as THREE.MeshStandardMaterial).emissive.setHex(0x114455);
            (this.marker.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12;
        }));
        this.addCleanup(() => trigger.destroy());
    }
}

function createMarker(position: { x: number; y: number; z: number }): THREE.Mesh {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.5, 0.8),
        new THREE.MeshStandardMaterial({
            color: 0x1e2b33,
            emissive: 0x114455,
            emissiveIntensity: 0.12,
            metalness: 0.15,
            roughness: 0.7,
            transparent: true,
            opacity: 0.4
        })
    );
    mesh.position.set(position.x, position.y, position.z);
    return mesh;
}

export class ExampleTriggerZoneObject implements IObjectModule {
    public readonly id = 'example-trigger-zone';
    public readonly displayName = 'Example Trigger Zone';
    public readonly networked = false;
    public readonly portable = false;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): ExampleTriggerZoneInstance {
        return new ExampleTriggerZoneInstance(context, config);
    }
}
