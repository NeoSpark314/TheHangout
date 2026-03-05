export interface IVector2 {
    x: number;
    y: number;
}

export interface IMoveIntentPayload {
    direction: IVector2; // Usually normalized gamepad stick or WASD vector
}

export interface ILookIntentPayload {
    delta: IVector2; // Device-agnostic look delta
}

export interface IHandIntentPayload {
    hand: 'left' | 'right';
    value?: number; // E.g., trigger pull amount
}

export interface IVRSnapTurnPayload {
    angle: number;
}
