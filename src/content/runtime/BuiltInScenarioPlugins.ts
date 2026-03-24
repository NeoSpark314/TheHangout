import type { IScenarioPlugin } from '../contracts/IScenarioPlugin';
import { DefaultHangoutScenarioPlugin } from '../scenarios/defaultHangout/DefaultHangoutScenario';
import { TargetTossScenarioPlugin } from '../scenarios/targetToss/TargetTossScenario';
import { WideCircleScenarioPlugin } from '../scenarios/wideCircle/WideCircleScenario';
import { NatureParkScenarioPlugin } from '../scenarios/procedural/BasicProceduralScenario';
import { SimpleRacingScenarioPlugin } from '../scenarios/simpleRacing/SimpleRacingScenario';

export const BUILT_IN_SCENARIO_PLUGINS: IScenarioPlugin[] = [
    DefaultHangoutScenarioPlugin,
    TargetTossScenarioPlugin,
    WideCircleScenarioPlugin,
    NatureParkScenarioPlugin,
    SimpleRacingScenarioPlugin
];

export const DEFAULT_SCENARIO_PLUGIN_ID = DefaultHangoutScenarioPlugin.id;
