import { IVector3, IQuaternion } from './IMath';

export interface IHandJointState {
    position: IVector3;
    quaternion: IQuaternion;
}

export interface IHandState {
    active: boolean;
    hasJoints: boolean;
    position: IVector3;
    quaternion: IQuaternion;
    joints: IHandJointState[];
    pointerPosition: IVector3;
    pointerQuaternion: IQuaternion;
}

export interface ITrackingState {
    head: {
        position: IVector3;
        quaternion: IQuaternion;
        yaw: number;
    };
    hands: {
        left: IHandState;
        right: IHandState;
    };
}

export interface INetworkHandJointState {
    position?: IVector3;
    p?: IVector3;
    quaternion?: IQuaternion;
    q?: IQuaternion;
}

export interface INetworkHandState {
    active?: boolean;
    hasJoints?: boolean;
    position?: IVector3;
    quaternion?: IQuaternion;
    pointerPosition?: IVector3;
    pointerQuaternion?: IQuaternion;
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
