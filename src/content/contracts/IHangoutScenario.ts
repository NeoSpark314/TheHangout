import type { IScenarioModule } from './IScenarioModule';

export interface IHangoutScenario extends IScenarioModule {
    setHologramVisible(visible: boolean): void;
}

export function isHangoutScenario(scenario: IScenarioModule): scenario is IHangoutScenario {
    return typeof (scenario as IHangoutScenario).setHologramVisible === 'function';
}
