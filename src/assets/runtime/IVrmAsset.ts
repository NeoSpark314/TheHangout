import * as THREE from 'three';
import type { VRMFirstPerson, VRMHumanoid } from '@pixiv/three-vrm';

export interface IVrmInstance {
    readonly scene: THREE.Group;
    readonly humanoid: VRMHumanoid;
    readonly firstPerson: VRMFirstPerson | null;
    readonly metaVersion: string | null;
    update(delta: number): void;
    dispose(): void;
}

export interface IVrmTemplate {
    createInstance(): IVrmInstance;
}
