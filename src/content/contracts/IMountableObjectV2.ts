import type * as THREE from 'three';

export type TMountPointType = 'seat' | 'driver' | 'passenger' | 'ride';

export interface IMountPointDefinition {
    id: string;
    type?: TMountPointType;
    label?: string;
    getSeatPose(): { position: THREE.Vector3; yaw: number };
    getExitPose?(): { position: THREE.Vector3; yaw: number };
}

export interface IMountRequestContext {
    playerId: string;
    mountPointId: string;
}

export interface IMountReleaseContext {
    playerId: string;
    mountPointId: string;
    reason?: string;
}

export interface IMountRequestResult {
    ok: boolean;
    reason?: string;
}

/**
 * Generic mountable contract for advanced objects (chairs, cars, bikes, moving platforms).
 *
 * This is intentionally content-facing and object-owned:
 * - object defines mount points
 * - object validates/rejects requests
 * - object remains responsible for occupancy replication/state
 */
export interface IMountableObjectV2 {
    getMountPoints(): ReadonlyArray<IMountPointDefinition>;
    requestMount?(context: IMountRequestContext): IMountRequestResult;
    onMountGranted?(context: IMountRequestContext): void;
    onMountReleased?(context: IMountReleaseContext): void;
}

