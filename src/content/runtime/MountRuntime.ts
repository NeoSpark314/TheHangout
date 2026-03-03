import * as THREE from 'three';
import type { AppContext } from '../../app/AppContext';
import type { IUpdatable } from '../../shared/contracts/IUpdatable';

interface ILocalMountBinding {
    ownerInstanceId: string;
    getSeatPose: () => { position: THREE.Vector3; yaw: number };
    getExitPose?: () => { position: THREE.Vector3; yaw: number };
}

export class MountRuntime implements IUpdatable {
    private localMount: ILocalMountBinding | null = null;

    constructor(private context: AppContext) { }

    public update(): void {
        if (!this.localMount) return;

        const localPlayer = this.context.localPlayer;
        if (!localPlayer) return;

        const move = this.context.runtime.input?.getMovementVector?.();
        if (move && Math.hypot(move.x, move.y) > 0.1) {
            this.unmountLocal(this.localMount.ownerInstanceId);
            return;
        }

        const seat = this.localMount.getSeatPose();
        localPlayer.moveOriginTo(seat.position, seat.yaw);
    }

    public mountLocal(binding: ILocalMountBinding): boolean {
        const localPlayer = this.context.localPlayer;
        if (!localPlayer) return false;

        if (this.localMount && this.localMount.ownerInstanceId !== binding.ownerInstanceId) {
            this.unmountLocal(this.localMount.ownerInstanceId);
        }

        this.localMount = binding;
        const seat = binding.getSeatPose();
        localPlayer.teleportTo(seat.position, seat.yaw, { targetSpace: 'player' });
        return true;
    }

    public unmountLocal(ownerInstanceId?: string): void {
        if (!this.localMount) return;
        if (ownerInstanceId && this.localMount.ownerInstanceId !== ownerInstanceId) return;

        const binding = this.localMount;
        this.localMount = null;

        const localPlayer = this.context.localPlayer;
        if (!localPlayer) return;

        const exitPose = binding.getExitPose?.();
        if (exitPose) {
            localPlayer.teleportTo(exitPose.position, exitPose.yaw, { targetSpace: 'player' });
        }
    }

    public isMountedLocal(ownerInstanceId?: string): boolean {
        if (!this.localMount) return false;
        if (!ownerInstanceId) return true;
        return this.localMount.ownerInstanceId === ownerInstanceId;
    }

    public getMountedInstanceId(): string | null {
        return this.localMount?.ownerInstanceId ?? null;
    }
}
