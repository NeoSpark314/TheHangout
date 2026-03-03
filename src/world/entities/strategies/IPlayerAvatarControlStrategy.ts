import type { IPlayerEntityState } from '../../../shared/contracts/IEntityState';
import type { LocalPlayer } from '../LocalPlayer';

export interface IPlayerAvatarControlStrategy {
    readonly mode: 'local' | 'remote';

    attach(player: LocalPlayer): void;
    detach(player: LocalPlayer): void;
    update(player: LocalPlayer, delta: number, frame?: XRFrame): void;
    getNetworkState(player: LocalPlayer, fullSync?: boolean): IPlayerEntityState | null;
    destroy(player: LocalPlayer): void;
}
