import * as THREE from 'three';

export interface IView<TState> {
    readonly mesh: THREE.Object3D; // Only the view knows about Three.js
    
    applyState(state: TState, delta: number): void;
    setHighlight(active: boolean): void;
    setColor(color: string | number): void;
    setName(name: string): void;
    attachVoiceStream(stream: MediaStream): void;
    getAudioLevel(): number;
    addToScene(scene: THREE.Scene): void;
    removeFromScene(scene: THREE.Scene): void;
    destroy(): void;
}
