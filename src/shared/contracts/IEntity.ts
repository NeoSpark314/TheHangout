import type * as THREE from 'three';
import type { IView } from './IView';

export interface IEntity {
    id: string;
    readonly type: string;
    isAuthority: boolean;
    isDestroyed: boolean;
    view?: IView<any> | null;
    mesh?: THREE.Object3D | null;

    initialize?(config: unknown): void;
    update(delta: number, frame?: XRFrame): void;
    destroy(): void;
}
