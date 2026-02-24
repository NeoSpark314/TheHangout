import * as THREE from 'three';
import { EntityView } from './EntityView';
import { Vector3, Quaternion } from '../interfaces/IMath';

export interface PhysicsPropState {
    position: Vector3;
    quaternion: Quaternion;
    lerpFactor: number;
}

export class PhysicsPropView extends EntityView<PhysicsPropState> {
    private _originalEmissive: THREE.Color;

    constructor(mesh: THREE.Mesh) {
        super(mesh);
        
        const material = mesh.material as THREE.MeshStandardMaterial;
        this._originalEmissive = material.emissive ? material.emissive.clone() : new THREE.Color(0x000000);
    }

    public setHighlight(on: boolean): void {
        const material = (this.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (!material || !material.emissive) return;
        
        if (on) {
            material.emissive.set(0xffffff);
            material.emissiveIntensity = 0.5;
        } else {
            material.emissive.copy(this._originalEmissive);
            material.emissiveIntensity = 1.0;
        }
    }

    public applyState(state: PhysicsPropState, delta: number): void {
        if (state.lerpFactor >= 1.0) {
            this.mesh.position.set(state.position.x, state.position.y, state.position.z);
            this.mesh.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
        } else {
            // Internal Three.js types for lerp
            const targetPos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
            const targetRot = new THREE.Quaternion(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
            
            this.mesh.position.lerp(targetPos, state.lerpFactor);
            this.mesh.quaternion.slerp(targetRot, state.lerpFactor);
        }
    }

    public destroy(): void {
        this.mesh.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.isMesh) {
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach(mat => mat.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                }
            }
        });
    }
}
