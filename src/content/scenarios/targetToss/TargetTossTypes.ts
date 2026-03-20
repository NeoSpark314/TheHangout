import type { IPhysicsColliderHandle } from '../../contracts/IObjectRuntimeContext';

export interface ITargetRingDefinition {
    radius: number;
    points: number;
    color: number;
}

export interface ITargetDefinition {
    id: string;
    position: { x: number; y: number; z: number };
    size: { x: number; y: number; z: number };
    rings: ITargetRingDefinition[];
}

export interface ITargetRuntime extends ITargetDefinition {
    collider: IPhysicsColliderHandle | null;
}

export interface ITargetTossState {
    playerOrder: string[];
    currentTurnIndex: number;
    throwsTaken: number;
    scores: Record<string, number>;
    resetPending: boolean;
}

export interface ITargetTossStateSyncPayload {
    state: ITargetTossState;
}

export interface IScoreFeedbackPayload {
    points: number;
    color: number;
    position: { x: number; y: number; z: number };
}
