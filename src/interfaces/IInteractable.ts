import { Vector3 } from './IMath';
import { InteractionEvent } from './IInteractionEvent';

/**
 * Interface for any object that can be interacted with (Hover, Click, Trigger).
 */
export interface IInteractable {
    isGrabbable: boolean;
    onHoverEnter(playerId: string): void;
    onHoverExit(playerId: string): void;
    onInteraction(event: InteractionEvent): void;
}
