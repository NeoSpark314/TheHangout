import * as THREE from 'three';
import { IInteractable } from '../interfaces/IInteractable';
import { EntityManager } from '../managers/EntityManager';
import gameState from '../core/GameState';

export class InteractionSystem {
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private entityManager: EntityManager;

    constructor(entityManager: EntityManager) {
        this.entityManager = entityManager;
    }

    public findInteractableUnderRay(ray: { origin: THREE.Vector3, direction: THREE.Vector3 }, maxDist: number): IInteractable | null {
        this.raycaster.ray.copy(ray as any);
        
        let nearest: IInteractable | null = null;
        let minDist = maxDist;

        // In a real system, we'd use Three.js raycasting against meshes
        // and then map back to entities. 
        // For now, we'll iterate through interactable entities.
        for (const entity of this.entityManager.entities.values()) {
            if ((entity as any).isGrabbable !== undefined) {
                const interactable = entity as unknown as IInteractable;
                const entityPos = (entity as any).rigidBody ? (entity as any).rigidBody.translation() : null;
                if (!entityPos) continue;

                const pos = new THREE.Vector3(entityPos.x, entityPos.y, entityPos.z);
                const dist = this.raycaster.ray.distanceToPoint(pos);
                
                if (dist < 0.3) {
                    const dToCam = this.raycaster.ray.origin.distanceTo(pos);
                    if (dToCam < minDist) {
                        minDist = dToCam;
                        nearest = interactable;
                    }
                }
            }
        }

        return nearest;
    }
}
