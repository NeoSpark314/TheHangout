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
        const managers = gameState.managers;
        const render = managers.render;

        this.raycaster.ray.origin.copy(ray.origin);
        this.raycaster.ray.direction.copy(ray.direction);
        this.raycaster.near = 0.1;
        this.raycaster.far = maxDist;
        
        // CRITICAL: Three.js Sprites require the camera to be set on the raycaster
        // for billboard intersection calculations.
        if (render.camera) {
            this.raycaster.camera = render.camera;
        }

        const intersects = this.raycaster.intersectObjects(render.scene.children, true);
        const localPlayerId = gameState.localPlayer?.id;

        for (const intersect of intersects) {
            let obj: THREE.Object3D | null = intersect.object;
            while (obj) {
                const entityId = obj.userData.entityId;
                if (entityId) {
                    if (localPlayerId && entityId === localPlayerId) break;

                    const entity = managers.entity.getEntity(entityId);
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
        const managers = gameState.managers;
        let nearest: IInteractable | null = null;
        let minDist = maxDist;

        for (const entity of managers.entity.entities.values()) {
            // Check if it's grabbable and not currently held
            if ((entity as any).isGrabbable && !(entity as any).heldBy) {
                const interactable = entity as unknown as IInteractable;
                
                // Get world position from view if possible, otherwise skip
                const view = (entity as any).view;
                if (!view || !view.mesh) continue;

                view.mesh.getWorldPosition(this.tempVec);
                const dist = point.distanceTo(this.tempVec);

                if (dist < minDist) {
                    minDist = dist;
                    nearest = interactable;
                }
            }
        }

        return nearest ? { interactable: nearest, distance: minDist } : null;
    }

    private tempVec = new THREE.Vector3();
}
