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

export interface ITrackingProvider {
    id: string;
    init(): void;
    activate(): void;
    deactivate(): void;
    update(delta: number, frame?: XRFrame): void;
    getState(): ITrackingState;
    destroy(): void;
}
