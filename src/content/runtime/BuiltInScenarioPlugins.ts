import type { IScenarioPlugin } from '../contracts/IScenarioPlugin';

function createLazyScenarioPlugin(
    metadata: Omit<IScenarioPlugin, 'create'>,
    exportName: string,
    loader: () => Promise<unknown>
): IScenarioPlugin {
    return {
        ...metadata,
        async create() {
            const module = await loader() as Record<string, unknown>;
            const plugin = module[exportName];
            if (!plugin || typeof plugin !== 'object' || plugin === null || typeof (plugin as IScenarioPlugin).create !== 'function') {
                throw new Error(`[BuiltInScenarioPlugins] Missing scenario plugin export: ${exportName}`);
            }
            return (plugin as IScenarioPlugin).create();
        }
    };
}

export const BUILT_IN_SCENARIO_PLUGINS: IScenarioPlugin[] = [
    createLazyScenarioPlugin({
        id: 'default-hangout',
        displayName: 'Default Hangout',
        kind: 'social',
        maxPlayers: 16,
        capabilities: {
            headless: true,
            usesPhysics: true,
            usesAudio: true,
            hasActions: true,
            hasPortableObjects: true
        }
    }, 'DefaultHangoutScenarioPlugin', () => import('../scenarios/defaultHangout/DefaultHangoutScenario')),
    createLazyScenarioPlugin({
        id: 'target-toss',
        displayName: 'Target Toss',
        kind: 'minigame',
        maxPlayers: 8,
        capabilities: {
            headless: true,
            usesPhysics: true,
            usesAudio: true,
            hasActions: true,
            hasPortableObjects: false
        }
    }, 'TargetTossScenarioPlugin', () => import('../scenarios/targetToss/TargetTossScenario')),
    createLazyScenarioPlugin({
        id: 'wide-circle',
        displayName: 'Wide Circle',
        kind: 'social',
        maxPlayers: 16,
        capabilities: {
            headless: true,
            usesPhysics: true,
            usesAudio: false,
            hasPortableObjects: false
        }
    }, 'WideCircleScenarioPlugin', () => import('../scenarios/wideCircle/WideCircleScenario')),
    createLazyScenarioPlugin({
        id: 'basic-procedural-nature',
        displayName: 'Nature Park',
        kind: 'exploration',
        maxPlayers: 12,
        capabilities: {
            headless: true,
            usesPhysics: true,
            usesAudio: false,
            hasPortableObjects: false
        }
    }, 'NatureParkScenarioPlugin', () => import('../scenarios/procedural/BasicProceduralScenario')),
    createLazyScenarioPlugin({
        id: 'simple-racing',
        displayName: 'Simple Racing',
        kind: 'minigame',
        maxPlayers: 8,
        capabilities: {
            headless: true,
            usesPhysics: true,
            usesAudio: true,
            hasPortableObjects: false
        }
    }, 'SimpleRacingScenarioPlugin', () => import('../scenarios/simpleRacing/SimpleRacingScenario'))
];

export const DEFAULT_SCENARIO_PLUGIN_ID = 'default-hangout';
