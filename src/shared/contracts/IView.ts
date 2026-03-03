import * as THREE from 'three';
import { IAudioChunkPayload } from './IVoice';

export interface IView<TState> {
    readonly mesh: THREE.Object3D; // Only the view knows about Three.js

    applyState(state: TState, delta: number): void;
    setHighlight(active: boolean): void;
    setColor(color: string | number): void;
    setName(name: string): void;
    attachVoiceStream(stream: MediaStream): void;
    attachAudioChunk(data: IAudioChunkPayload | string): void;
    getAudioLevel(): number;
    addToScene(scene: THREE.Scene): void;
    addToInteractionGroup(group: THREE.Group): void;
    removeFromScene(scene: THREE.Scene): void;
    destroy(): void;
}
