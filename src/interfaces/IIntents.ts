import { IVector3, IQuaternion } from './IMath';

export interface IVector2 {
    x: number;
    y: number;
}

export interface IMoveIntentPayload {
    direction: IVector2; // Usually normalized gamepad stick or WASD vector
}

export interface ILookIntentPayload {
    delta: IVector2; // Mouse or thumbstick delta
}

export interface IHandIntentPayload {
    hand: 'left' | 'right';
    value?: number; // E.g., trigger pull amount
}

export interface IXRHandTrackedPayload {
    hand: 'left' | 'right';
    position: IVector3;
    quaternion: IQuaternion;
    isSqueezing: boolean;
    triggerValue: number;
}

export interface IXRHeadTrackedPayload {
    position: IVector3;
    quaternion: IQuaternion;
}

export interface IVRSnapTurnPayload {
    angle: number;
}
