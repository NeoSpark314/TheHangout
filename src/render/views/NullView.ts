import * as THREE from 'three';
import { IView } from '../../shared/contracts/IView';

/**
 * A headless, non-rendering view used by the authoritative server.
 * Skips memory allocation for Three.js geometries, DOM canvas creations, and WebAudio elements.
 */
export class NullView implements IView<any> {
    public mesh: THREE.Object3D;

    constructor(private entityId: string) {
        this.mesh = new THREE.Object3D();
        this.mesh.userData.entityId = this.entityId;
    }

    public applyState(state: any, delta: number): void { }
    public setHighlight(active: boolean): void { }
    public setColor(color: string | number): void { }
    public setName(name: string): void { }
    public attachVoiceStream(stream: MediaStream): void { }
    public attachAudioChunk(base64Chunk: string): void { }
    public getAudioLevel(): number { return 0; }
    public addToScene(scene: THREE.Scene): void { }
    public addToInteractionGroup(group: THREE.Group): void { }
    public removeFromScene(scene: THREE.Scene): void { }
    public destroy(): void { }
}
