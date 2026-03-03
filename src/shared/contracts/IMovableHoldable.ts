import { IPose } from './IMath';
import { IHoldable } from './IHoldable';

/**
 * Holdable objects that follow the holder's hand pose while held.
 */
export interface IMovableHoldable extends IHoldable {
    updateGrabbedPose(pose: IPose): void;
}
