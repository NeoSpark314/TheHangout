import type { IScenarioPlugin } from '../contracts/IScenarioPlugin';
import { DefaultHangoutScenarioPlugin } from '../scenarios/defaultHangout/DefaultHangoutScenario';
import { WideCircleScenarioPlugin } from '../scenarios/wideCircle/WideCircleScenario';

export const BUILT_IN_SCENARIO_PLUGINS: IScenarioPlugin[] = [
    DefaultHangoutScenarioPlugin,
    WideCircleScenarioPlugin
];

export const DEFAULT_SCENARIO_PLUGIN_ID = DefaultHangoutScenarioPlugin.id;
