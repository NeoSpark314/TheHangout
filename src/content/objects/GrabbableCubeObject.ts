import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import { EntityFactory } from '../../world/spawning/EntityFactory';

export class GrabbableCubeObject implements IObjectModule {
    public readonly id = 'grabbable-cube';
    public readonly displayName = 'Grabbable Cube';
    public readonly tags = ['prop', 'physics', 'shared'];
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        const size = typeof config.size === 'number' ? config.size : 0.12;
        const position = config.position ?? { x: 0, y: 1.15, z: 0 };
        const color = typeof config.color === 'number' ? config.color : 0x00ffff;

        let mesh: THREE.Mesh | undefined;
        if (context.app.runtime.render) {
            const geo = new THREE.BoxGeometry(size, size, size);
            const mat = new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 0.3,
                metalness: 0.6,
                roughness: 0.3
            });
            mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(position.x, position.y, position.z);
            mesh.add(new THREE.LineSegments(
                new THREE.EdgesGeometry(geo),
                new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
            ));
        }

        return EntityFactory.createGrabbable(context.app, context.instanceId, size, position, mesh as any);
    }
}
