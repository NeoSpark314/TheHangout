import * as THREE from 'three';
import { IView } from '../interfaces/IView';

export abstract class EntityView<TState> implements IView<TState> {
    public mesh: THREE.Object3D;

    constructor(mesh: THREE.Object3D) {
        this.mesh = mesh;
    }

    abstract applyState(state: TState, delta: number): void;

    public setHighlight(active: boolean): void {
        // Optional override
    }

    public setColor(color: string | number): void {
        // Optional override
    }

    public setName(name: string): void {
        // Optional override
    }

    public attachVoiceStream(stream: MediaStream): void {
        // Optional override
    }

    public getAudioLevel(): number {
        return 0;
    }

    public addToScene(scene: THREE.Scene): void {
        if (this.mesh) scene.add(this.mesh);
    }

    public removeFromScene(scene: THREE.Scene): void {
        if (this.mesh) scene.remove(this.mesh);
    }

    public abstract destroy(): void;
}
