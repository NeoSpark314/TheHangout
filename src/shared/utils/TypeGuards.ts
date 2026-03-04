import { IHoldable } from '../contracts/IHoldable';
import { IGrabbable } from '../contracts/IGrabbable';
import { IMovableHoldable } from '../contracts/IMovableHoldable';
import { IInteractable } from '../contracts/IInteractable';

export function isHoldable(obj: any): obj is IHoldable {
    return obj &&
        ((typeof obj.isHoldable === 'boolean' && obj.isHoldable === true) ||
            (typeof obj.isGrabbable === 'boolean' && obj.isGrabbable === true)) &&
        typeof obj.onGrab === 'function' &&
        typeof obj.onRelease === 'function';
}

export function isMovableHoldable(obj: any): obj is IMovableHoldable {
    return isHoldable(obj) &&
        typeof (obj as any).updateGrabbedPose === 'function';
}

export function isGrabbable(obj: any): obj is IGrabbable {
    return isMovableHoldable(obj) &&
        typeof (obj as any).isGrabbable === 'boolean' &&
        (obj as any).isGrabbable === true;
}

export function isInteractable(obj: any): obj is IInteractable {
    return obj &&
        typeof obj.onHoverEnter === 'function' &&
        typeof obj.onHoverExit === 'function' &&
        typeof obj.onInteraction === 'function';
}
