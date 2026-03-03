import { IVector3, IQuaternion } from './IMath';

/**
 * An abstraction for any input that can interact with the world.
 * Could be a mouse-ray, a VR controller, or hand-tracking.
 */
export interface IInteractionPointer {
    id: string;
    origin: IVector3;
    direction: IVector3;
    quaternion: IQuaternion;
    isProximity: boolean; // true = 30cm radius, false = forward raycast
    isSqueezing: boolean; // Main grab button (Grip or E-key)
    isInteracting: boolean; // Main action button (Trigger or Mouse-click)
    triggerValue: number; // Analog value for triggers
    hand?: 'left' | 'right';
}
