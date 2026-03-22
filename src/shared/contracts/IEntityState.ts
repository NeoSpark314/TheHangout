import { AvatarRenderMode } from './IAvatar';
import { IAvatarSkeletonDelta } from '../avatar/AvatarSkeleton';

/**
 * High-performance spatial types using flat arrays to minimize 
 * JSON overhead and memory allocation during network synchronization.
 */

/** [x, y, z] */
export type Vec3Arr = [number, number, number];
/** [x, y, z, w] */
export type QuatArr = [number, number, number, number];

export enum EntityType {
    PLAYER_AVATAR = 'PLAYER_AVATAR',
    PHYSICS_PROP = 'PHYSICS_PROP',
    PEN = 'PEN'
}

export interface IBaseEntityState {
    id: string;
    type: EntityType;
    ownerId: string | null;
}

/**
 * State for player avatars. Local vs remote control is runtime state, not a type split.
 */
export interface IPlayerEntityState extends IBaseEntityState {
    type: EntityType.PLAYER_AVATAR;
    n: string; // name
    p?: Vec3Arr; // legacy body position
    y?: number; // legacy body yaw
    h?: number; // legacy head height
    hq?: QuatArr; // legacy local head quaternion
    sk?: IAvatarSkeletonDelta; // canonical avatar skeleton delta
    conf: {
        color: string | number;
        renderMode?: AvatarRenderMode;
        vrmUrl?: string | null;
        playerHeightM?: number;
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
    m?: string; // module ID (optional, for spawned objects)
    he?: Vec3Arr; // half extents (optional)
    s?: number; // uniform scale (optional)
}

/**
 * State for the Drawing Pen
 */
export interface IPenEntityState extends IBaseEntityState {
    type: EntityType.PEN;
    p: Vec3Arr; // position
    q: QuatArr; // quaternion
    v: Vec3Arr; // velocity
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
