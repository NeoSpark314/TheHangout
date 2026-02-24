import * as THREE from 'three';
import { IView } from '../interfaces/IView';

/**
 * Architectural Role: Purely visual representation of an entity.
 * Note: Views should never contain business logic or physics; they only
 * represent the state provided by their corresponding Entity.
 */
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

    public addToInteractionGroup(group: THREE.Group): void {
        if (this.mesh) group.add(this.mesh);
    }

    public removeFromScene(scene: THREE.Scene): void {
        if (this.mesh) scene.remove(this.mesh);
    }

    public abstract destroy(): void;

    protected _cleanupMesh(): void {
        if (!this.mesh) return;

        if (this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }
        
        // Ensure it's removed from the interaction group too
        const managers = gameState.managers;
        if (managers && managers.render && managers.render.interactionGroup) {
            managers.render.interactionGroup.remove(this.mesh);
        }
    }
}
