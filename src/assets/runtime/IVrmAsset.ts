import * as THREE from 'three';
import type { VRMExpressionManager, VRMFirstPerson, VRMHumanoid } from '@pixiv/three-vrm';

export interface IVrmInstance {
    readonly scene: THREE.Group;
    readonly humanoid: VRMHumanoid;
    readonly firstPerson: VRMFirstPerson | null;
    readonly metaVersion: string | null;
    readonly expressionManager: VRMExpressionManager | null;
    update(delta: number): void;
    dispose(): void;
}

export interface IVrmTemplate {
    createInstance(): Promise<IVrmInstance>;
}
