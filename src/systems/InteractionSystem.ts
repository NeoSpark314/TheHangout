import * as THREE from 'three';
import { IInteractable } from '../interfaces/IInteractable';
import { EntityManager } from '../managers/EntityManager';
import { isGrabbable, isInteractable } from '../utils/TypeGuards';
import gameState from '../core/GameState';

export class InteractionSystem {
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private entityManager: EntityManager;

    constructor(entityManager: EntityManager) {
        this.entityManager = entityManager;
    }

    /**
     * Finds the first interactable object hit by a ray.
     * Currently disabled.
     */
    public findInteractableUnderRay(ray: { origin: THREE.Vector3, direction: THREE.Vector3 }, maxDist: number): IInteractable | null {
        return null;
    }

    /**
     * Finds the absolute nearest interactable to a world point.
     * Best for VR near-grab.
     */
    public findNearestInteractable(point: THREE.Vector3, maxDist: number): { interactable: IInteractable, distance: number } | null {
        const managers = gameState.managers;
        let nearest: IInteractable | null = null;
        let minDist = maxDist;

        for (const entity of managers.entity.entities.values()) {
            // Check if it's grabbable, interactable and NOT currently held
            if (isGrabbable(entity) && isInteractable(entity) && !entity.heldBy) {
                // Get world position from view if possible
                const view = (entity as any).view;
                if (!view || !view.mesh) continue;

                view.mesh.getWorldPosition(this.tempVec);
                const dist = point.distanceTo(this.tempVec);

                if (dist < minDist) {
                    minDist = dist;
                    nearest = entity;
                }
            }
        }

        return nearest ? { interactable: nearest, distance: minDist } : null;
    }

    private tempVec = new THREE.Vector3();
}
