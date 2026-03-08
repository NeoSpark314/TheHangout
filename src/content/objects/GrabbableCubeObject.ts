import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import { EntityFactory } from '../../world/spawning/EntityFactory';
import { applyBoxEdgeGlow } from '../../render/materials/BoxEdgeGlow';

export class GrabbableCubeObject implements IObjectModule {
    public readonly id = 'grabbable-cube';
    public readonly displayName = 'Grabbable Cube';
    public readonly tags = ['prop', 'physics', 'shared'];
    public readonly networked = true;
    public readonly portable = true;

    // Thin content wrapper over the engine-level grabbable physics spawn path.
    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        const size = typeof config.size === 'number' ? config.size : 0.12;
        const position = config.position ?? { x: 0, y: 1.15, z: 0 };
        const hasCustomColor = typeof config.color === 'number';
        const color = hasCustomColor ? config.color as number : 0x00ffff;
        const styleSeed = this.hashToUnit(context.instanceId);

        let mesh: THREE.Mesh | undefined;
        if (context.app.runtime.render) {
            const geo = new THREE.BoxGeometry(size, size, size);
            const mat = new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 0.12 + styleSeed * 0.06,
                metalness: 0.45 + styleSeed * 0.35,
                roughness: 0.26 + (1 - styleSeed) * 0.4
            });
            mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(position.x, position.y, position.z);
            const edgeColor = new THREE.Color(color).multiplyScalar(1.35).getHex();
            applyBoxEdgeGlow(mesh, mat, { x: size / 2, y: size / 2, z: size / 2 }, {
                edgeColor,
                edgeThicknessWorld: 0.0035,
                edgeFeatherWorld: 0.0018,
                intensity: 0.36 + styleSeed * 0.16,
                faceContrast: 0.1 + styleSeed * 0.08,
                rimIntensity: 0.09 + styleSeed * 0.08
            });
        }

        return EntityFactory.createGrabbable(context.app, context.instanceId, size, position, mesh as any);
    }

    private hashToUnit(id: string): number {
        let hash = 2166136261;
        for (let i = 0; i < id.length; i++) {
            hash ^= id.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return ((hash >>> 0) % 1000) / 999;
    }
}
