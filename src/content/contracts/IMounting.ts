import type * as THREE from 'three';

export type TLocalMountState = 'idle' | 'requesting' | 'mounted' | 'releasing' | 'rejected';

export type TLocalMountStateReason =
    | 'request'
    | 'granted'
    | 'rejected'
    | 'timeout'
    | 'released'
    | 'movement'
    | 'replaced'
    | 'external'
    | 'unknown';

export interface ILocalMountBinding {
    ownerInstanceId: string;
    mountPointId?: string;
    getSeatPose: () => { position: THREE.Vector3; yaw: number };
    getExitPose?: () => { position: THREE.Vector3; yaw: number };
    canUnmountNow?: (reason: 'movement' | 'released' | 'external') => boolean;
}

export interface ILocalMountStatus {
    state: TLocalMountState;
    ownerInstanceId: string | null;
    mountPointId: string | null;
    reason: TLocalMountStateReason;
    sinceMs: number;
}
