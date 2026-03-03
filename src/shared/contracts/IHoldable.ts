import * as THREE from 'three';
import { IPose, IVector3 } from './IMath';

/**
 * Capability interface for objects that can be claimed by a hand.
 * Some holdables stay fixed in the world while held.
 */
export interface IHoldable {
    readonly isHoldable: boolean;
    readonly heldBy: string | null;

    onGrab(playerId: string, hand: 'left' | 'right'): void;
    onRelease(velocity?: IVector3): void;

    /**
     * Optional method returning specific sub-meshes that act as physical grab zones or handles.
     */
    getGrabRoots?(): THREE.Object3D[];

    /**
     * Optional approximate radius (meters) used for near-grab sphere overlap tests.
     */
    getGrabRadius?(): number;

    /**
     * Optional fixed hand pose to use while the object is held without moving.
     */
    getHoldPose?(hand: 'left' | 'right'): IPose;

    /**
     * Optional release distance for fixed holds. If the hand drifts farther away, the hold is released.
     */
    getHoldReleaseDistance?(): number;
}
