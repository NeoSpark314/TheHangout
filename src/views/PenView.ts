import * as THREE from 'three';
import { EntityView } from './EntityView';
import { IVector3, IQuaternion } from '../interfaces/IMath';

export interface IPenViewState {
    position: IVector3;
    quaternion: IQuaternion;
    isDrawing: boolean;
    color: string | number;
}

export class PenView extends EntityView<IPenViewState> {
    private material: THREE.MeshStandardMaterial;

    constructor(entityId: string) {
        // Create a simple pen-like mesh
        const group = new THREE.Group();
        group.userData.entityId = entityId; // CRITICAL for InteractionSystem

        const bodyGeo = new THREE.CylinderGeometry(0.015, 0.01, 0.2, 8);
        bodyGeo.rotateX(Math.PI / 2);

        const material = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const mesh = new THREE.Mesh(bodyGeo, material);
        mesh.userData.entityId = entityId;
        group.add(mesh);

        // Tip
        const tipGeo = new THREE.ConeGeometry(0.01, 0.04, 8);
        tipGeo.rotateX(-Math.PI / 2);
        const tipMesh = new THREE.Mesh(tipGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
        tipMesh.userData.entityId = entityId;
        tipMesh.position.z = -0.12;
        group.add(tipMesh);

        super(group);
        this.material = material;
    }

    public applyState(state: IPenViewState, delta: number): void {
        this.mesh.position.set(state.position.x, state.position.y, state.position.z);
        this.mesh.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);

        // Visual feedback for drawing (e.g. tip glows)
        const tip = this.mesh.children[1] as THREE.Mesh;
        if (state.isDrawing) {
            (tip.material as THREE.MeshStandardMaterial).emissive.set(state.color as any);
            (tip.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.0;
        } else {
            (tip.material as THREE.MeshStandardMaterial).emissive.set(0x000000);
        }
    }

    public setHighlight(active: boolean): void {
        this.material.emissive.set(active ? 0x444444 : 0x000000);
    }

    public destroy(): void {
        this._cleanupMesh();
        this.mesh.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
    }
}
