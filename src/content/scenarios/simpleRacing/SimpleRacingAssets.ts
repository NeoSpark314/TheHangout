export const SIMPLE_RACING_ASSETS = {
    models: {
        trackStraight: 'scenarios/simpleRacing/models/track-straight.glb',
        trackCorner: 'scenarios/simpleRacing/models/track-corner.glb',
        trackFinish: 'scenarios/simpleRacing/models/track-finish.glb',
        trackBump: 'scenarios/simpleRacing/models/track-bump.glb',
        decorationEmpty: 'scenarios/simpleRacing/models/decoration-empty.glb',
        decorationForest: 'scenarios/simpleRacing/models/decoration-forest.glb',
        decorationTents: 'scenarios/simpleRacing/models/decoration-tents.glb',
        carRed: 'scenarios/simpleRacing/models/vehicle-truck-red.glb',
        carGreen: 'scenarios/simpleRacing/models/vehicle-truck-green.glb',
        carPurple: 'scenarios/simpleRacing/models/vehicle-truck-purple.glb',
        carYellow: 'scenarios/simpleRacing/models/vehicle-truck-yellow.glb'
    },
    audio: {
        engine: 'scenarios/simpleRacing/audio/engine.ogg',
        impact: 'scenarios/simpleRacing/audio/impact.ogg',
        skid: 'scenarios/simpleRacing/audio/skid.ogg'
    },
    sprites: {
        smoke: 'scenarios/simpleRacing/sprites/smoke.png'
    }
} as const;

export type TSimpleRacingModelKey = keyof typeof SIMPLE_RACING_ASSETS.models;
export const SIMPLE_RACING_CAR_MODEL_URLS = [
    SIMPLE_RACING_ASSETS.models.carRed,
    SIMPLE_RACING_ASSETS.models.carGreen,
    SIMPLE_RACING_ASSETS.models.carPurple,
    SIMPLE_RACING_ASSETS.models.carYellow
] as const;
