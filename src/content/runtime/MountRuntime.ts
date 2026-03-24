import * as THREE from 'three';
import type { AppContext } from '../../app/AppContext';
import type { IUpdatable } from '../../shared/contracts/IUpdatable';
import type {
    ILocalMountBinding,
    ILocalMountStatus,
    TLocalMountState,
    TLocalMountStateReason
} from '../contracts/IMounting';

export class MountRuntime implements IUpdatable {
    private static readonly REQUEST_TIMEOUT_MS = 3000;
    private static readonly MOVEMENT_UNMOUNT_THRESHOLD = 0.45;
    private static readonly MOVEMENT_UNMOUNT_HOLD_MS = 220;

    private localMount: ILocalMountBinding | null = null;
    private pendingMount: ILocalMountBinding | null = null;
    private localState: TLocalMountState = 'idle';
    private localStateReason: TLocalMountStateReason = 'unknown';
    private localStateSinceMs: number = this.nowMs();
    private readonly localStateListeners = new Set<(status: ILocalMountStatus) => void>();
    private lastStateSignature = '';
    private movementUnmountStartMs: number | null = null;

    constructor(private context: AppContext) { }

    public update(): void {
        if (this.localState === 'requesting' && (this.nowMs() - this.localStateSinceMs) > MountRuntime.REQUEST_TIMEOUT_MS) {
            this.pendingMount = null;
            this.setLocalState('rejected', 'timeout');
            this.context.runtime.notify.warn('Mount request timed out.', {
                source: 'mount',
                durationMs: 2600,
                dedupeKey: 'mount:timeout',
                code: 'mount.request.timeout'
            });
        }

        if (!this.localMount) return;

        const localPlayer = this.context.localPlayer;
        if (!localPlayer) return;

        const move = this.context.runtime.input?.getMovementVector?.();
        if (move) {
            const mag = Math.hypot(move.x, move.y);
            if (mag >= MountRuntime.MOVEMENT_UNMOUNT_THRESHOLD) {
                if (this.movementUnmountStartMs === null) {
                    this.movementUnmountStartMs = this.nowMs();
                }
                const heldMs = this.nowMs() - this.movementUnmountStartMs;
                if (heldMs >= MountRuntime.MOVEMENT_UNMOUNT_HOLD_MS) {
                    const canUnmount = this.localMount.canUnmountNow?.('movement') ?? true;
                    if (canUnmount) {
                        this.unmountLocal(this.localMount.ownerInstanceId, 'movement');
                        return;
                    }
                }
            } else {
                this.movementUnmountStartMs = null;
            }
        }

        const seat = this.localMount.getSeatPose();
        localPlayer.moveOriginTo(seat.position, seat.yaw);
    }

    public requestLocalMount(binding: ILocalMountBinding): boolean {
        const localPlayer = this.context.localPlayer;
        if (!localPlayer) return false;
        this.pendingMount = binding;
        this.movementUnmountStartMs = null;
        this.setLocalState('requesting', 'request');
        return true;
    }

    public grantLocalMount(binding: ILocalMountBinding): boolean {
        const localPlayer = this.context.localPlayer;
        if (!localPlayer) return false;

        if (this.localMount && this.localMount.ownerInstanceId !== binding.ownerInstanceId) {
            this.unmountLocal(this.localMount.ownerInstanceId, 'replaced');
        }

        this.localMount = binding;
        this.pendingMount = null;
        this.movementUnmountStartMs = null;
        this.setLocalState('mounted', 'granted');
        const seat = binding.getSeatPose();
        localPlayer.teleportTo(seat.position, seat.yaw, { targetSpace: 'player' });
        return true;
    }

    public rejectLocalMount(): void {
        this.pendingMount = null;
        this.movementUnmountStartMs = null;
        this.setLocalState('rejected', 'rejected');
    }

    public releaseLocalMount(ownerInstanceId?: string, reason: TLocalMountStateReason = 'released'): void {
        this.unmountLocal(ownerInstanceId, reason);
    }

    public mountLocal(binding: ILocalMountBinding): boolean {
        return this.grantLocalMount(binding);
    }

    public unmountLocal(ownerInstanceId?: string, reason: TLocalMountStateReason = 'released'): void {
        if (!this.localMount) return;
        if (ownerInstanceId && this.localMount.ownerInstanceId !== ownerInstanceId) return;

        const binding = this.localMount;
        this.setLocalState('releasing', reason);
        this.localMount = null;
        this.pendingMount = null;
        this.movementUnmountStartMs = null;

        const localPlayer = this.context.localPlayer;
        if (!localPlayer) {
            this.setLocalState('idle', reason);
            return;
        }

        const exitPose = binding.getExitPose?.();
        if (exitPose) {
            localPlayer.teleportTo(exitPose.position, exitPose.yaw, { targetSpace: 'player' });
        }
        this.setLocalState('idle', reason);
    }

    public isMountedLocal(ownerInstanceId?: string): boolean {
        if (!this.localMount) return false;
        if (!ownerInstanceId) return true;
        return this.localMount.ownerInstanceId === ownerInstanceId;
    }

    public getMountedInstanceId(): string | null {
        return this.localMount?.ownerInstanceId ?? null;
    }

    public getLocalSeatPose(): { position: THREE.Vector3; yaw: number } | null {
        return this.localMount ? this.localMount.getSeatPose() : null;
    }

    public getLocalBodyYawPose(): { position: THREE.Vector3; yaw: number } | null {
        if (!this.localMount) return null;
        return this.localMount.getBodyYawPose?.() ?? this.localMount.getSeatPose();
    }

    public getLocalViewPose(): { position: THREE.Vector3; yaw: number } | null {
        if (!this.localMount) return null;
        return this.localMount.getViewPose?.() ?? this.localMount.getSeatPose();
    }

    public getLocalMountStatus(): ILocalMountStatus {
        return this.snapshotLocalState();
    }

    public onLocalMountStateChanged(listener: (status: ILocalMountStatus) => void): () => void {
        this.localStateListeners.add(listener);
        listener(this.snapshotLocalState());
        return () => {
            this.localStateListeners.delete(listener);
        };
    }

    private setLocalState(state: TLocalMountState, reason: TLocalMountStateReason): void {
        const owner = this.localMount?.ownerInstanceId ?? this.pendingMount?.ownerInstanceId ?? null;
        const mountPoint = this.localMount?.mountPointId ?? this.pendingMount?.mountPointId ?? null;
        const nextSignature = `${state}|${reason}|${owner ?? ''}|${mountPoint ?? ''}`;
        if (nextSignature === this.lastStateSignature) return;

        this.localState = state;
        this.localStateReason = reason;
        this.localStateSinceMs = this.nowMs();
        this.lastStateSignature = nextSignature;
        const snapshot = this.snapshotLocalState();
        for (const listener of this.localStateListeners) {
            listener(snapshot);
        }
    }

    private snapshotLocalState(): ILocalMountStatus {
        return {
            state: this.localState,
            ownerInstanceId: this.localMount?.ownerInstanceId ?? null,
            mountPointId: this.localMount?.mountPointId ?? this.pendingMount?.mountPointId ?? null,
            reason: this.localStateReason,
            sinceMs: this.localStateSinceMs
        };
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}
