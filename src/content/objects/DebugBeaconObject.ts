import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import { BaseObjectInstance } from '../runtime/BaseObjectInstance';

class DebugBeaconInstance extends BaseObjectInstance {
    private readonly mesh: THREE.Mesh;
    private elapsed = 0;
    private readonly baseY: number;

    constructor(context: IObjectSpawnContext, position: THREE.Vector3, color: number) {
        super(context, 'debug-beacon');
        const geometry = new THREE.SphereGeometry(0.12, 12, 12);
        const material = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.45
        });
        this.addCleanup(() => geometry.dispose());
        this.addCleanup(() => material.dispose());

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        this.mesh.userData.objectInstanceId = this.id;
        this.baseY = position.y;
        this.ownSceneObject(this.mesh);
    }

    public update(delta: number): void {
        this.elapsed += delta;
        this.mesh.rotation.y += delta * 1.5;
        this.mesh.position.y = this.baseY + Math.sin(this.elapsed * 2.2) * 0.04;
    }

    public destroy(): void {
        super.destroy();
    }
}

export class DebugBeaconObject implements IObjectModule {
    public readonly id = 'debug-beacon';
    public readonly displayName = 'Debug Beacon';
    public readonly tags = ['prototype', 'visual'];
    public readonly networked = false;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): DebugBeaconInstance | null {
        if (!context.scene.isRenderingAvailable()) {
            return null;
        }

        const position = config.position
            ? new THREE.Vector3(config.position.x, config.position.y, config.position.z)
            : new THREE.Vector3(0, 1.15, -1.8);
        const colorValue = typeof config.color === 'number' ? config.color : 0x00ffff;

        return new DebugBeaconInstance(context, position, colorValue);
    }
}
