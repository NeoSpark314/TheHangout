import * as THREE from 'three';
import { IVector3, IPose } from './IMath';

/**
 * Capability interface for objects that can be picked up and moved.
 */
export interface IGrabbable {
    readonly isGrabbable: boolean;
    readonly heldBy: string | null;

    onGrab(playerId: string, hand: 'left' | 'right'): void;
    onRelease(velocity?: IVector3): void;

    /**
     * Optional method returning specific sub-meshes that act as physical grab zones or 'handles'.
     * If defined, the InteractionSystem will compute distance against these meshes instead of the root.
     */
    getGrabRoots?(): THREE.Object3D[];

    /**
     * Optional approximate radius (meters) used for near-grab sphere overlap tests.
     */
    getGrabRadius?(): number;

    /**
     * Called every frame by the holder to sync the object's pose.
     */
    updateGrabbedPose(pose: IPose): void;
}
