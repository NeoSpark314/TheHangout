import * as THREE from 'three';
import { IInteractable } from '../interfaces/IInteractable';
import { GameContext } from '../core/GameState';
import { isGrabbable, isInteractable } from '../utils/TypeGuards';

export class InteractionSystem {
    constructor(private context: GameContext) {
    }

    /**
     * Finds the first interactable object hit by a ray.
     * Currently disabled.
     */
    public findInteractableUnderRay(ray: { origin: THREE.Vector3, direction: THREE.Vector3 }, maxDist: number): IInteractable | null {
        if (!this.context.managers.render) return null;

        const hits = this.context.managers.render.raycast(ray.origin, ray.direction, maxDist);
        if (hits.length === 0) return null;

        const entityManager = this.context.managers.entity;

        for (const hit of hits) {
            let hitObj: THREE.Object3D | null = hit.object;
            while (hitObj) {
                const entityId = hitObj.userData.entityId;
                if (entityId) {
                    const entity = entityManager.getEntity(entityId);
                    if (entity && isGrabbable(entity) && isInteractable(entity) && !entity.heldBy) {
                        return entity as unknown as IInteractable;
                    }
                    // We hit a mesh linked to an entity, but it wasn't interactable, so stop climbing the tree
                    break;
                }
                hitObj = hitObj.parent;
            }
        }

        return null;
    }

    /**
     * Finds the absolute nearest interactable to a world point.
     * Best for VR near-grab.
     */
    public findNearestInteractable(point: THREE.Vector3, maxDist: number): { interactable: IInteractable, distance: number } | null {
        let nearest: IInteractable | null = null;
        let minDist = maxDist;

        for (const entity of this.context.managers.entity.entities.values()) {
            // Check if it's grabbable, interactable and NOT currently held
            if (isGrabbable(entity) && isInteractable(entity) && !entity.heldBy) {
                // Check if the entity provides specific grab handles
                const grabRoots = (entity.getGrabRoots && typeof entity.getGrabRoots === 'function')
                    ? entity.getGrabRoots() : null;

                if (grabRoots && grabRoots.length > 0) {
                    for (const grabRoot of grabRoots) {
                        grabRoot.updateMatrixWorld(true);
                        grabRoot.getWorldPosition(this.tempVec);
                        const dist = point.distanceTo(this.tempVec);

                        if (dist < minDist) {
                            minDist = dist;
                            nearest = entity;
                        }
                    }
                } else {
                    // Fallback to standard mesh calculation
                    let mesh = (entity as any).view?.mesh;
                    if (!mesh && (entity as any).mesh) mesh = (entity as any).mesh;
                    if (!mesh) continue;

                    // Ensure the world matrix is up to date for this frame
                    mesh.updateMatrixWorld(true);
                    mesh.getWorldPosition(this.tempVec);
                    const dist = point.distanceTo(this.tempVec);

                    if (dist < minDist) {
                        minDist = dist;
                        nearest = entity;
                    }
                }
            }
        }

        return nearest ? { interactable: nearest, distance: minDist } : null;
    }

    private tempVec = new THREE.Vector3();
}
