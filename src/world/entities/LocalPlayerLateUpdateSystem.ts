import type { AppContext } from '../../app/AppContext';
import type { IUpdatable } from '../../shared/contracts/IUpdatable';

export class LocalPlayerLateUpdateSystem implements IUpdatable {
    constructor(private readonly context: AppContext) { }

    public update(delta: number, frame?: XRFrame): void {
        this.context.localPlayer?.lateUpdate(delta, frame);
    }
}
