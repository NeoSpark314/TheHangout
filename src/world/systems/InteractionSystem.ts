import * as THREE from 'three';
import { IInteractable } from '../../shared/contracts/IInteractable';
import { AppContext } from '../../app/AppContext';
import { isGrabbable, isInteractable } from '../../shared/utils/TypeGuards';
import { EntityType } from '../../shared/contracts/IEntityState';

export class InteractionSystem {
    constructor(private context: AppContext) {
    }

    /**
     * Finds the first interactable object hit by a ray, including hit distance/point.
     * Pointer-driven input layers can use this for local focus logic without teaching
     * gameplay systems about non-XR interaction modes.
     */
    public findInteractableHitUnderRay(
        ray: { origin: THREE.Vector3, direction: THREE.Vector3 },
        maxDist: number
    ): { interactable: IInteractable; distance: number; point: THREE.Vector3 } | null {
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
                        return {
                            interactable: entity as unknown as IInteractable,
                            distance: hit.distance,
                            point: hit.point.clone()
                        };
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
     * Convenience wrapper for callers that only need the interactable.
     */
    public findInteractableUnderRay(ray: { origin: THREE.Vector3, direction: THREE.Vector3 }, maxDist: number): IInteractable | null {
        return this.findInteractableHitUnderRay(ray, maxDist)?.interactable || null;
    }

    /**
     * Finds the absolute nearest interactable to a world point.
     * Best for VR near-grab.
     */
    public findNearestInteractable(point: THREE.Vector3, maxDist: number): { interactable: IInteractable, distance: number } | null {
        let nearest: IInteractable | null = null;
        let minDist = maxDist;

        const physicsHit = this.context.managers.physics?.queryNearestPhysicsGrabbable(
            { x: point.x, y: point.y, z: point.z },
            maxDist
        );
        if (physicsHit && isInteractable(physicsHit.entity)) {
            nearest = physicsHit.entity as unknown as IInteractable;
            minDist = physicsHit.distance;
        }

        for (const entity of this.context.managers.entity.entities.values()) {
            if (entity.type === EntityType.PHYSICS_PROP) continue;
            // Check if it's grabbable, interactable and NOT currently held
            if (isGrabbable(entity) && isInteractable(entity) && !entity.heldBy) {
                const entityRadius = this.getEntityGrabRadius(entity as unknown as { getGrabRadius?: () => number });
                // Check if the entity provides specific grab handles
                const grabRoots = (entity.getGrabRoots && typeof entity.getGrabRoots === 'function')
                    ? entity.getGrabRoots() : null;

                if (grabRoots && grabRoots.length > 0) {
                    for (const grabRoot of grabRoots) {
                        grabRoot.updateMatrixWorld(true);
                        grabRoot.getWorldPosition(this.tempVec);
                        const rootRadius = Math.max(entityRadius, this.getObjectGrabRadius(grabRoot));
                        const overlapDist = point.distanceTo(this.tempVec) - rootRadius;

                        if (overlapDist <= maxDist && overlapDist < minDist) {
                            minDist = overlapDist;
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
                    const rootRadius = Math.max(entityRadius, this.getObjectGrabRadius(mesh));
                    const overlapDist = point.distanceTo(this.tempVec) - rootRadius;

                    if (overlapDist <= maxDist && overlapDist < minDist) {
                        minDist = overlapDist;
                        nearest = entity;
                    }
                }
            }
        }

        return nearest ? { interactable: nearest, distance: minDist } : null;
    }

    private tempVec = new THREE.Vector3();
    private tempScale = new THREE.Vector3();
    private tempBox = new THREE.Box3();
    private grabRadiusCache = new Map<string, number>();

    private getEntityGrabRadius(entity: { getGrabRadius?: () => number }): number {
        const r = entity.getGrabRadius?.();
        if (typeof r === 'number' && Number.isFinite(r)) {
            return Math.max(0.01, r);
        }
        return 0.05;
    }

    private getObjectGrabRadius(object: THREE.Object3D): number {
        const cached = this.grabRadiusCache.get(object.uuid);
        if (cached !== undefined) return cached;

        let radius = 0.05;
        const mesh = object as THREE.Mesh;
        if ((mesh as any).isMesh && mesh.geometry) {
            const geo = mesh.geometry as THREE.BufferGeometry;
            if (!geo.boundingSphere) {
                geo.computeBoundingSphere();
            }
            if (geo.boundingSphere) {
                object.getWorldScale(this.tempScale);
                const s = Math.max(Math.abs(this.tempScale.x), Math.abs(this.tempScale.y), Math.abs(this.tempScale.z), 1e-6);
                radius = Math.max(0.01, geo.boundingSphere.radius * s);
            }
        } else {
            this.tempBox.setFromObject(object);
            this.tempBox.getSize(this.tempScale);
            const d = Math.max(this.tempScale.x, this.tempScale.y, this.tempScale.z);
            if (Number.isFinite(d) && d > 0) {
                radius = d * 0.5;
            }
        }

        this.grabRadiusCache.set(object.uuid, radius);
        return radius;
    }
}
