import * as THREE from 'three';
import { IInteractable } from '../interfaces/IInteractable';
import { EntityManager } from '../managers/EntityManager';

export class InteractionSystem {
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private entityManager: EntityManager;

    constructor(entityManager: EntityManager) {
        this.entityManager = entityManager;
    }

    public findInteractableUnderRay(ray: { origin: THREE.Vector3, direction: THREE.Vector3 }, maxDist: number): IInteractable | null {
        this.raycaster.ray.origin.copy(ray.origin);
        this.raycaster.ray.direction.copy(ray.direction);
        
        let nearest: IInteractable | null = null;
        let minDist = maxDist;

        for (const entity of this.entityManager.entities.values()) {
            // Check if entity implements IInteractable and is grabbable
            const interactable = entity as unknown as IInteractable;
            if (interactable.isGrabbable === true) {
                const entityPos = (entity as any).rigidBody ? (entity as any).rigidBody.translation() : null;
                if (!entityPos) continue;

                const pos = new THREE.Vector3(entityPos.x, entityPos.y, entityPos.z);
                
                // Using distanceSqToPoint for performance and matching original threshold
                const distToRay = this.raycaster.ray.distanceSqToPoint(pos);
                
                if (distToRay < 0.1) { // ~0.316m radius
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
