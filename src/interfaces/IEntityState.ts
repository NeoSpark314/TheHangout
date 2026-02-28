import { IHandState } from '../entities/PlayerEntity';

/**
 * High-performance spatial types using flat arrays to minimize 
 * JSON overhead and memory allocation during network synchronization.
 */

/** [x, y, z] */
export type Vec3Arr = [number, number, number];
/** [x, y, z, w] */
export type QuatArr = [number, number, number, number];

export enum EntityType {
    LOCAL_PLAYER = 'LOCAL_PLAYER',
    REMOTE_PLAYER = 'REMOTE_PLAYER',
    PHYSICS_PROP = 'PHYSICS_PROP',
    PEN = 'PEN'
}

export interface IBaseEntityState {
    id: string;
    type: EntityType;
    ownerId: string | null;
}

/**
 * State for Player entities (Local and Remote)
 */
export interface IPlayerEntityState extends IBaseEntityState {
    type: EntityType.LOCAL_PLAYER | EntityType.REMOTE_PLAYER;
    n: string; // name
    p: Vec3Arr; // body position
    y: number; // body yaw
    h: number; // head height
    hq: QuatArr; // local head quaternion
    hands: {
        left: IHandState;
        right: IHandState;
    };
    conf: {
        color: string | number;
    };
    mic?: boolean; // self-mute state
}

/**
 * State for Physics-driven props
 */
export interface IPhysicsEntityState extends IBaseEntityState {
    type: EntityType.PHYSICS_PROP;
    p: Vec3Arr; // position
    q: QuatArr; // quaternion
    v: Vec3Arr; // velocity
    b: string | null; // heldBy (playerId)
}

/**
 * State for the Drawing Pen
 */
export interface IPenEntityState extends IBaseEntityState {
    type: EntityType.PEN;
    p: Vec3Arr; // position
    q: QuatArr; // quaternion
    b: string | null; // heldBy (playerId)
    isDrawing: boolean; // isDrawing
    c: string | number; // color
}

/**
 * Discriminated Union for all networkable entity states.
 * Use the 'type' field to safely narrow the state in logic.
 */
export type IEntityState = IPlayerEntityState | IPhysicsEntityState | IPenEntityState;

/**
 * Packet structure for batch state updates
 */
export interface IStateUpdatePacket {
    id: string;
    type: EntityType;
    state: IEntityState;
}
