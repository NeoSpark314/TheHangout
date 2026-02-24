import { Vector3, Quaternion } from './IMath';
import { HandState } from '../entities/PlayerEntity';

export interface BaseEntityState {
    ownerId: string | null;
}

export interface PlayerEntityState extends BaseEntityState {
    id: string;
    type: string;
    name: string;
    position: Vector3;
    yaw: number;
    headHeight: number;
    head: {
        position: Vector3;
        quaternion: Quaternion;
    };
    hands: {
        left: HandState;
        right: HandState;
    };
    avatarConfig: any;
}

export interface PhysicsEntityState extends BaseEntityState {
    position: [number, number, number];
    quaternion: [number, number, number, number];
    velocity: [number, number, number];
    heldBy: string | null;
}

export interface PenEntityState extends BaseEntityState {
    position: [number, number, number];
    quaternion: [number, number, number, number];
    heldBy: string | null;
    isDrawing: boolean;
    color: string | number;
}

export type EntityState = PlayerEntityState | PhysicsEntityState | PenEntityState;
