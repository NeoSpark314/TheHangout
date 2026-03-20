import { IPose } from './IMath';
import { IHoldable } from './IHoldable';

/**
 * Holdable objects that follow the holder's hand pose while held.
 */
export interface IMovableHoldable extends IHoldable {
    updateGrabbedPose(pose: IPose): void;

    /**
     * Optional authored object-in-hand offset for canonical grips.
     * The returned pose is the object's transform relative to the holding hand.
     */
    getCanonicalGrabOffset?(hand: 'left' | 'right'): IPose;

    /**
     * Optional authored preference for which tracked controller orientation
     * should drive the held object. Position still comes from the grip pose.
     */
    getPreferredHeldQuaternionSpace?(): 'grip' | 'pointer';
}


