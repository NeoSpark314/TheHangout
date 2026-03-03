import { IMovableHoldable } from './IMovableHoldable';

/**
 * Legacy alias for movable holdables.
 * Prefer IMovableHoldable for new code.
 */
export interface IGrabbable extends IMovableHoldable {
    readonly isHoldable: boolean;
    readonly isGrabbable: boolean;
}
