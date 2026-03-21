import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import { BaseReplicatedPhysicsPropObjectInstance } from '../runtime/BaseReplicatedPhysicsPropObjectInstance';

class ThrowableBallInstance extends BaseReplicatedPhysicsPropObjectInstance {
    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        const radius = typeof config.size === 'number' ? config.size * 0.5 : 0.09;
        const position = config.position ?? { x: 0, y: 1.05, z: 0 };
        const color = typeof config.color === 'number' ? config.color : 0xff7a1a;
        const mesh = context.scene.isRenderingAvailable()
            ? createBallMesh(radius, color)
            : new THREE.Group();
        const ownerId = (typeof config.ownerId === 'string' || config.ownerId === null)
            ? config.ownerId
            : undefined;
        const entityId = (typeof config.entityId === 'string' && config.entityId.length > 0)
            ? config.entityId
            : (typeof config.id === 'string' ? config.id : undefined);

        super(context, 'throwable-ball', {
            shape: 'sphere',
            radius,
            position,
            mesh,
            ownerId,
            entityId,
            replicationProfileId: 'throwable'
        });
    }
}

function createBallMesh(radius: number, color: number): THREE.Object3D {
    const geometry = new THREE.SphereGeometry(radius, 28, 20);
    const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.08,
        metalness: 0.12,
        roughness: 0.55
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

export class ThrowableBallObject implements IObjectModule {
    public readonly id = 'throwable-ball';
    public readonly displayName = 'Throwable Ball';
    public readonly tags = ['prop', 'physics', 'shared', 'ball'];
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): ThrowableBallInstance {
        return new ThrowableBallInstance(context, config);
    }
}
