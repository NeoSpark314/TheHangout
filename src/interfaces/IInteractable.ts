import * as THREE from 'three';

export interface IInteractable {
    isGrabbable: boolean;
    
    onHoverEnter(playerId: string): void;
    onHoverExit(playerId: string): void;
    onGrab(playerId: string): void;
    onRelease(velocity?: THREE.Vector3): void;
    onPrimaryAction(playerId: string): void; // e.g., Trigger pulled while holding
}
