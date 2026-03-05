export interface IVector2 {
    x: number;
    y: number;
}

export interface IMoveIntentPayload {
    direction: IVector2; // Usually normalized gamepad stick or WASD vector
}

export interface ILookIntentPayload {
    yawDeltaRad: number;
    pitchDeltaRad: number;
}

export interface IHandIntentPayload {
    hand: 'left' | 'right';
    value?: number; // E.g., trigger pull amount
}

export interface IVRSnapTurnPayload {
    angle: number;
}
