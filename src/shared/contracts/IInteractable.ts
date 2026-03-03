import { IVector3 } from './IMath';
import { IInteractionEvent } from './IInteractionEvent';

/**
 * Interface for any object that can be interacted with (Hover, Click, Trigger).
 */
export interface IInteractable {
    onHoverEnter(playerId: string): void;
    onHoverExit(playerId: string): void;
    onInteraction(event: IInteractionEvent): void;
}
