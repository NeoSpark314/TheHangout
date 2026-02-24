import * as THREE from 'three';
import { EntityView } from './EntityView';
import { Vector3, Quaternion } from '../interfaces/IMath';

export interface PhysicsPropState {
    position: Vector3;
    quaternion: Quaternion;
    lerpFactor: number;
}

export class PhysicsPropView extends EntityView<PhysicsPropState> {
    private _originalEmissive: THREE.Color = new THREE.Color(0x000000);

    constructor(mesh: THREE.Mesh, entityId: string) {
        super(mesh);
        
        // Essential for InteractionSystem mapping
        this.mesh.userData.entityId = entityId;
        this.mesh.traverse(child => {
            child.userData.entityId = entityId;
        });

        // Store original emissive if available
        if (mesh.material && (mesh.material as any).emissive) {
            this._originalEmissive.copy((mesh.material as any).emissive);
        }
    }

    public setHighlight(on: boolean): void {
        this.mesh.traverse(obj => {
            const mesh = obj as THREE.Mesh;
            if (mesh.isMesh && mesh.material && (mesh.material as any).emissive) {
                const mat = mesh.material as any;
                if (on) {
                    mat.emissive.set(0xffffff);
                    mat.emissiveIntensity = 0.5;
                } else {
                    mat.emissive.copy(this._originalEmissive);
                    mat.emissiveIntensity = (this._originalEmissive.r + this._originalEmissive.g + this._originalEmissive.b) > 0 ? 1.0 : 0.3;
                    // Reset to a sensible default if the original was basically black
                    if (mat.emissiveIntensity === 0.3 && !on) {
                        mat.emissiveIntensity = 0.3; // Match PropManager default
                    }
                }
            }
        });
    }

    public applyState(state: PhysicsPropState, delta: number): void {
        if (state.lerpFactor >= 1.0) {
            this.mesh.position.set(state.position.x, state.position.y, state.position.z);
            this.mesh.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
        } else {
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
