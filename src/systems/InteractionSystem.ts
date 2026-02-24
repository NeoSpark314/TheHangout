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

    /**
     * Finds the first interactable object hit by a ray.
     * Best for desktop crosshair interaction.
     */
    public findInteractableUnderRay(ray: { origin: THREE.Vector3, direction: THREE.Vector3 }, maxDist: number): IInteractable | null {
        const render = gameState.managers.render;
        if (!render) return null;

        this.raycaster.ray.origin.copy(ray.origin);
        this.raycaster.ray.direction.copy(ray.direction);
        this.raycaster.near = 0.1; // Small near plane to avoid self-intersection
        this.raycaster.far = maxDist;

        const intersects = this.raycaster.intersectObjects(render.scene.children, true);
        const localPlayerId = gameState.localPlayer?.id;

        for (const intersect of intersects) {
            let obj: THREE.Object3D | null = intersect.object;
            while (obj) {
                const entityId = obj.userData.entityId;
                if (entityId) {
                    // Skip self
                    if (localPlayerId && entityId === localPlayerId) {
                        break; // Stop climbing this branch, check next intersect
                    }

                    const entity = this.entityManager.getEntity(entityId);
                    if (entity && (entity as any).isGrabbable) {
                        return entity as unknown as IInteractable;
                    }
                }
                obj = obj.parent;
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

        for (const entity of this.entityManager.entities.values()) {
            const interactable = entity as unknown as IInteractable;
            if (interactable.isGrabbable && !(entity as any).heldBy) {
                const rb = (entity as any).rigidBody;
                if (!rb) continue;

                const pos = rb.translation();
                const entVec = new THREE.Vector3(pos.x, pos.y, pos.z);
                const dist = point.distanceTo(entVec);

                if (dist < minDist) {
                    minDist = dist;
                    nearest = interactable;
                }
            }
        }

        return nearest ? { interactable: nearest, distance: minDist } : null;
    }
}
