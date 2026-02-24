import { Vector3, Quaternion } from './IMath';

/**
 * An abstraction for any input that can interact with the world.
 * Could be a mouse-ray, a VR controller, or hand-tracking.
 */
export interface InteractionPointer {
    id: string;
    origin: Vector3;
    direction: Vector3;
    quaternion: Quaternion;
    isProximity: boolean; // true = 30cm radius, false = forward raycast
    isSqueezing: boolean; // Main grab button (Grip or E-key)
    isInteracting: boolean; // Main action button (Trigger or Mouse-click)
    triggerValue: number; // Analog value for triggers
    hand?: 'left' | 'right';
}
