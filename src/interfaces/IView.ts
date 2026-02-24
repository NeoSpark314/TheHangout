import * as THREE from 'three';

export interface IView<TState> {
    readonly mesh: THREE.Object3D; // Only the view knows about Three.js
    
    applyState(state: TState, delta: number): void;
    setHighlight(active: boolean): void;
    destroy(): void;
}
