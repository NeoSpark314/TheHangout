import { IGrabbable } from '../interfaces/IGrabbable';
import { IInteractable } from '../interfaces/IInteractable';

export function isGrabbable(obj: any): obj is IGrabbable {
    return obj && 
           typeof obj.isGrabbable === 'boolean' && 
           obj.isGrabbable === true &&
           typeof obj.onGrab === 'function' &&
           typeof obj.onRelease === 'function';
}

export function isInteractable(obj: any): obj is IInteractable {
    return obj && 
           typeof obj.onHoverEnter === 'function' &&
           typeof obj.onHoverExit === 'function' &&
           typeof obj.onInteraction === 'function';
}
