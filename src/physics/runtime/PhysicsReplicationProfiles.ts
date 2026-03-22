export type PhysicsReplicationProfileId =
    | 'default-prop'
    | 'throwable'
    | 'held-tool'
    | 'heavy-prop';

export type PhysicsPropShape = 'box' | 'sphere';

export interface IPhysicsBodyTuning {
    linearDamping: number;
    angularDamping: number;
}

export interface IPhysicsMaterialTuning {
    friction: number;
    restitution: number;
    density: number;
}

export interface IPhysicsReplicationProfile {
    id: PhysicsReplicationProfileId;
    interpolationDelayMs: number;
    maxExtrapolationMs: number;
    maxSnapshotAgeMs: number;
    lerpFactor: number;
    heldLerpFactor: number;
    pendingReleaseMinHoldMs: number;
    pendingReleaseMaxHoldMs: number;
    pendingReleaseLinearSpeedThreshold: number;
    pendingReleaseAngularSpeedThreshold: number;
    allowSpeculativeHostClaim: boolean;
    touchLeaseEligible: boolean;
    body?: Partial<IPhysicsBodyTuning>;
    material?: Partial<IPhysicsMaterialTuning>;
}

export interface IResolvedPhysicsReplicationProfile extends IPhysicsReplicationProfile {
    body: IPhysicsBodyTuning;
    material: IPhysicsMaterialTuning;
}

const DEFAULT_PROFILE: IPhysicsReplicationProfile = {
    id: 'default-prop',
    interpolationDelayMs: 120,
    maxExtrapolationMs: 80,
    maxSnapshotAgeMs: 1500,
    lerpFactor: 0.2,
    heldLerpFactor: 0.5,
    pendingReleaseMinHoldMs: 220,
    pendingReleaseMaxHoldMs: 1500,
    pendingReleaseLinearSpeedThreshold: 0.4,
    pendingReleaseAngularSpeedThreshold: 0.9,
    allowSpeculativeHostClaim: true,
    touchLeaseEligible: true
};

const SHAPE_DEFAULTS: Record<PhysicsPropShape, { body: IPhysicsBodyTuning; material: IPhysicsMaterialTuning }> = {
    box: {
        body: {
            linearDamping: 0.5,
            angularDamping: 0.5
        },
        material: {
            friction: 0.7,
            restitution: 0.2,
            density: 280
        }
    },
    sphere: {
        body: {
            linearDamping: 0.72,
            angularDamping: 1.6
        },
        material: {
            friction: 1.15,
            restitution: 0.1,
            density: 170
        }
    }
};

const PROFILES: Record<PhysicsReplicationProfileId, IPhysicsReplicationProfile> = {
    'default-prop': DEFAULT_PROFILE,
    'throwable': {
        ...DEFAULT_PROFILE,
        id: 'throwable',
        interpolationDelayMs: 105,
        maxExtrapolationMs: 95,
        pendingReleaseMinHoldMs: 180,
        pendingReleaseMaxHoldMs: 1800,
        pendingReleaseLinearSpeedThreshold: 0.55,
        pendingReleaseAngularSpeedThreshold: 1.4,
        material: {
            friction: 0.95,
            restitution: 0.16,
            density: 140
        }
    },
    'held-tool': {
        ...DEFAULT_PROFILE,
        id: 'held-tool',
        interpolationDelayMs: 90,
        heldLerpFactor: 0.62,
        pendingReleaseMinHoldMs: 140,
        pendingReleaseMaxHoldMs: 850,
        pendingReleaseLinearSpeedThreshold: 0.25,
        pendingReleaseAngularSpeedThreshold: 0.6,
        touchLeaseEligible: false,
        body: {
            linearDamping: 0.58,
            angularDamping: 0.8
        },
        material: {
            density: 520
        }
    },
    'heavy-prop': {
        ...DEFAULT_PROFILE,
        id: 'heavy-prop',
        interpolationDelayMs: 140,
        maxExtrapolationMs: 60,
        lerpFactor: 0.15,
        heldLerpFactor: 0.42,
        pendingReleaseMinHoldMs: 280,
        pendingReleaseMaxHoldMs: 2200,
        pendingReleaseLinearSpeedThreshold: 0.28,
        pendingReleaseAngularSpeedThreshold: 0.75,
        allowSpeculativeHostClaim: false,
        body: {
            linearDamping: 0.82,
            angularDamping: 1.1
        },
        material: {
            friction: 1.2,
            restitution: 0.02,
            density: 1100
        }
    }
};

export function getPhysicsReplicationProfile(profileId?: PhysicsReplicationProfileId): IPhysicsReplicationProfile {
    return PROFILES[profileId ?? DEFAULT_PROFILE.id];
}

export function resolvePhysicsReplicationProfile(
    profileId: PhysicsReplicationProfileId | undefined,
    shape: PhysicsPropShape
): IResolvedPhysicsReplicationProfile {
    const profile = getPhysicsReplicationProfile(profileId);
    const defaults = SHAPE_DEFAULTS[shape];
    return {
        ...profile,
        body: {
            ...defaults.body,
            ...profile.body
        },
        material: {
            ...defaults.material,
            ...profile.material
        }
    };
}
