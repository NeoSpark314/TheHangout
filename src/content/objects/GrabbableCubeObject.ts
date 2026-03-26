import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import { applyBoxEdgeGlow } from '../../render/materials/BoxEdgeGlow';
import { BaseReplicatedPhysicsPropObjectInstance } from '../runtime/BaseReplicatedPhysicsPropObjectInstance';

class GrabbableCubeInstance extends BaseReplicatedPhysicsPropObjectInstance {
    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        const size = typeof config.size === 'number' ? config.size : 0.12;
        const position = config.position ?? { x: 0, y: 1.15, z: 0 };
        const hasCustomColor = typeof config.color === 'number';
        const color = hasCustomColor ? config.color as number : 0x00ffff;
        const styleSeed = hashToUnit(context.instanceId);
        const mesh = context.scene.isRenderingAvailable()
            ? createCubeMesh(size, color, styleSeed)
            : new THREE.Group();
        const ownerId = (typeof config.ownerId === 'string' || config.ownerId === null)
            ? config.ownerId
            : undefined;
        const entityId = (typeof config.entityId === 'string' && config.entityId.length > 0)
            ? config.entityId
            : (typeof config.id === 'string' ? config.id : undefined);

        super(context, 'grabbable-cube', {
            shape: 'box',
            size,
            position,
            mesh,
            halfExtents: { x: size / 2, y: size / 2, z: size / 2 },
            ownerId,
            entityId,
            color,
            replicationProfileId: 'heavy-prop'
        });
    }
}

function createCubeMesh(size: number, color: number, styleSeed: number): THREE.Object3D {
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.12 + styleSeed * 0.06,
        metalness: 0.45 + styleSeed * 0.35,
        roughness: 0.26 + (1 - styleSeed) * 0.4
    });
    const mesh = new THREE.Mesh(geo, mat);
    const edgeColor = new THREE.Color(color).multiplyScalar(1.35).getHex();
    applyBoxEdgeGlow(mesh, mat, { x: size / 2, y: size / 2, z: size / 2 }, {
        edgeColor,
        edgeThicknessWorld: 0.0035,
        edgeFeatherWorld: 0.0018,
        intensity: 0.36 + styleSeed * 0.16,
        faceContrast: 0.1 + styleSeed * 0.08,
        rimIntensity: 0.09 + styleSeed * 0.08
    });
    return mesh;
}

function hashToUnit(id: string): number {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 1000) / 999;
}

export class GrabbableCubeObject implements IObjectModule {
    public readonly id = 'grabbable-cube';
    public readonly displayName = 'Grabbable Cube';
    public readonly tags = ['prop', 'physics', 'shared'];
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): GrabbableCubeInstance {
        return new GrabbableCubeInstance(context, config);
    }
}
