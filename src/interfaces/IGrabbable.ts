import { IVector3, IQuaternion } from './IMath';

/**
 * Capability interface for objects that can be picked up and moved.
 */
export interface IGrabbable {
    readonly isGrabbable: boolean;
    readonly heldBy: string | null;

    onGrab(playerId: string, hand: 'left' | 'right'): void;
    onRelease(velocity?: IVector3): void;
    
    /**
     * Called every frame by the holder to sync the object's pose.
     */
    updateGrabbedPose(position: IVector3, quaternion: IQuaternion): void;
}
