import { HandState } from '../entities/PlayerEntity';

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

export interface BaseEntityState {
    id: string;
    type: EntityType;
    ownerId: string | null;
}

/**
 * State for Player entities (Local and Remote)
 */
export interface PlayerEntityState extends BaseEntityState {
    type: EntityType.LOCAL_PLAYER | EntityType.REMOTE_PLAYER;
    n: string; // name
    p: Vec3Arr; // body position
    y: number; // body yaw
    h: number; // head height
    hq: QuatArr; // local head quaternion
    hands: {
        left: HandState;
        right: HandState;
    };
    conf: {
        color: string | number;
    };
}

/**
 * State for Physics-driven props
 */
export interface PhysicsEntityState extends BaseEntityState {
    type: EntityType.PHYSICS_PROP;
    p: Vec3Arr; // position
    q: QuatArr; // quaternion
    v: Vec3Arr; // velocity
    b: string | null; // heldBy (playerId)
}

/**
 * State for the Drawing Pen
 */
export interface PenEntityState extends BaseEntityState {
    type: EntityType.PEN;
    p: Vec3Arr; // position
    q: QuatArr; // quaternion
    b: string | null; // heldBy (playerId)
    draw: boolean; // isDrawing
    c: string | number; // color
}

/**
 * Discriminated Union for all networkable entity states.
 * Use the 'type' field to safely narrow the state in logic.
 */
export type EntityState = PlayerEntityState | PhysicsEntityState | PenEntityState;

/**
 * Packet structure for batch state updates
 */
export interface StateUpdatePacket {
    id: string;
    type: EntityType;
    state: EntityState;
}
