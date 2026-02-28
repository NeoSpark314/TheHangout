import { IVector3, IQuaternion, IPose } from './IMath';

export interface IHandJointState {
    pose: IPose;
}

export interface IHandState {
    active: boolean;
    hasJoints: boolean;
    pose: IPose;
    pointerPose: IPose;
    joints: IHandJointState[];
}

export interface ITrackingState {
    head: {
        pose: IPose;
        yaw: number;
    };
    hands: {
        left: IHandState;
        right: IHandState;
    };
    humanoidDelta?: import('../models/HumanoidState').NetworkHumanoidDelta;
}

/**
 * Represents the partial hand payload that comes across the network.
 * All properties are optional because network bandwidth optimization may 
 * omit data that hasn't changed or isn't available (e.g., missing joints from generic controllers).
 * The `p` and `q` properties are minified aliases for `position` and `quaternion`.
 */
export interface INetworkHandJointState {
    pose?: IPose;
    p?: IVector3; // Keep shorthand `p` for position in network payload
    q?: IQuaternion; // Keep shorthand `q` for quaternion in network payload
}

/**
 * Partial network packet for a hand's state. 
 * Must be safely merged into a strict `IHandState` using `HandState.applyData()` 
 * because fields will frequently be undefined.
 */
export interface INetworkHandState {
    active?: boolean;
    hasJoints?: boolean;
    pose?: IPose;
    pointerPose?: IPose;
    joints?: INetworkHandJointState[];
}

export interface ITrackingProvider {
    id: string;
    init(): void;
    activate(): void;
    deactivate(): void;
    update(delta: number, frame?: XRFrame): void;
    getState(): ITrackingState;
    destroy(): void;

    // Optional desktop-specific control methods
    setHandActive?(hand: 'left' | 'right', active: boolean): void;
    adjustReach?(delta: number): void;
}
