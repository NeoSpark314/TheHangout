import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import { EntityFactory } from '../../world/spawning/EntityFactory';

export class ThrowableBallObject implements IObjectModule {
    public readonly id = 'throwable-ball';
    public readonly displayName = 'Throwable Ball';
    public readonly tags = ['prop', 'physics', 'shared', 'ball'];
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        const radius = typeof config.size === 'number' ? config.size * 0.5 : 0.09;
        const position = config.position ?? { x: 0, y: 1.05, z: 0 };
        const color = typeof config.color === 'number' ? config.color : 0xff7a1a;

        let mesh: THREE.Mesh | undefined;
        if (context.app.runtime.render) {
            const geometry = new THREE.SphereGeometry(radius, 28, 20);
            const material = new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 0.08,
                metalness: 0.12,
                roughness: 0.55
            });
            mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(position.x, position.y, position.z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
        }

        return EntityFactory.createSphereGrabbable(
            context.app,
            context.instanceId,
            radius,
            position,
            mesh as any,
            this.id,
            (typeof config.ownerId === 'string' || config.ownerId === null) ? config.ownerId : undefined
        );
    }
}

function readSpherePhysicsOverrides(config: IObjectSpawnConfig): {
    linearDamping?: number;
    angularDamping?: number;
    friction?: number;
    restitution?: number;
} | undefined {
    const candidate = (config as IObjectSpawnConfig & {
        physics?: {
            linearDamping?: unknown;
            angularDamping?: unknown;
            friction?: unknown;
            restitution?: unknown;
        };
    }).physics;

    if (!candidate || typeof candidate !== 'object') {
        return undefined;
    }

    const overrides = {
        linearDamping: typeof candidate.linearDamping === 'number' ? candidate.linearDamping : undefined,
        angularDamping: typeof candidate.angularDamping === 'number' ? candidate.angularDamping : undefined,
        friction: typeof candidate.friction === 'number' ? candidate.friction : undefined,
        restitution: typeof candidate.restitution === 'number' ? candidate.restitution : undefined
    };

    return Object.values(overrides).some((value) => value !== undefined) ? overrides : undefined;
}

