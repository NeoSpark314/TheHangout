import { Vector3, Quaternion } from './IMath';

/**
 * Capability interface for objects that can be picked up and moved.
 */
export interface IGrabbable {
    readonly isGrabbable: boolean;
    readonly heldBy: string | null;

    onGrab(playerId: string, hand: 'left' | 'right'): void;
    onRelease(velocity?: Vector3): void;
    
    /**
     * Called every frame by the holder to sync the object's pose.
     */
    updateGrabbedPose(position: Vector3, quaternion: Quaternion): void;
}
