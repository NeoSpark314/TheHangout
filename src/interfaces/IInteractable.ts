import { Vector3 } from './IMath';

export interface IInteractable {
    isGrabbable: boolean;
    
    onHoverEnter(playerId: string): void;
    onHoverExit(playerId: string): void;
    onGrab(playerId: string): void;
    onRelease(velocity?: Vector3): void;
    onPrimaryAction(playerId: string): void; // e.g., Trigger pulled while holding
}
