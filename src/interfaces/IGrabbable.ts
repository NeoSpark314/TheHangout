import * as THREE from 'three';
import { IVector3, IQuaternion } from './IMath';

/**
 * Capability interface for objects that can be picked up and moved.
 */
export interface IGrabbable {
    readonly isGrabbable: boolean;
    readonly heldBy: string | null;

    /**
     * If true, grabbing the object ignores relative grip offsets and perfectly snaps 
     * the object's origin to the hand's tracking origin. (Useful for tools like Pens)
     */
    readonly snapToHand?: boolean;

    onGrab(playerId: string, hand: 'left' | 'right'): void;
    onRelease(velocity?: IVector3): void;

    /**
     * Optional method returning specific sub-meshes that act as physical grab zones or 'handles'.
     * If defined, the InteractionSystem will compute distance against these meshes instead of the root.
     */
    getGrabRoots?(): THREE.Object3D[];

    /**
     * Called every frame by the holder to sync the object's pose.
     */
    updateGrabbedPose(position: IVector3, quaternion: IQuaternion): void;
}
