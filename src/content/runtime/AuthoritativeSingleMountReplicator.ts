import type {
    IObjectReplicationEmitOptions,
    IObjectReplicationMeta
} from '../contracts/IReplicatedObjectInstance';
import type { ILocalMountBinding } from '../contracts/IMounting';
import type { ISystemNotificationPayload } from '../../shared/contracts/INotification';
import { ObjectRuntimeContext } from './ObjectRuntimeContext';

export type TMountReleaseReason = 'released' | 'movement' | 'external';

interface IMountRequestPayload {
    mountPointId?: string;
}

interface IMountReleaseRequestPayload {
    mountPointId?: string;
    reason?: string;
}

interface IMountRejectedPayload {
    playerId: string;
    reason: string;
    occupiedById?: string;
    occupiedByName?: string;
}

interface IOccupancyPayload {
    occupiedBy: string | null;
}

export interface IAuthoritativeSingleMountAdapter {
    context: ObjectRuntimeContext;
    ownerInstanceId: string;
    mountPointId: string;
    mountLabel?: string;
    createLocalMountBinding(): ILocalMountBinding;
    canMount?(playerId: string, occupiedBy: string | null): boolean;
    onOccupancyChanged?(occupiedBy: string | null): void;
}

export interface IAuthoritativeSingleMountEventMap {
    occupancy: string;
    mountRequest: string;
    mountReleaseRequest: string;
    mountRejected: string;
}

const DEFAULT_EVENT_MAP: IAuthoritativeSingleMountEventMap = {
    occupancy: 'occupancy',
    mountRequest: 'mount-request',
    mountReleaseRequest: 'mount-release-request',
    mountRejected: 'mount-rejected'
};

export class AuthoritativeSingleMountReplicator {
    private occupiedBy: string | null = null;
    private awaitingMountAuthority = false;
    private awaitingReleaseAuthority = false;

    constructor(
        private readonly adapter: IAuthoritativeSingleMountAdapter,
        private readonly emit: (eventType: string, data: unknown, options?: IObjectReplicationEmitOptions) => void,
        private readonly events: IAuthoritativeSingleMountEventMap = DEFAULT_EVENT_MAP
    ) { }

    public getOccupiedBy(): string | null {
        return this.occupiedBy;
    }

    public isOccupied(): boolean {
        return !!this.occupiedBy;
    }

    public canMount(playerId: string): boolean {
        const evaluator = this.adapter.canMount;
        if (evaluator) return evaluator(playerId, this.occupiedBy);
        return !this.occupiedBy || this.occupiedBy === playerId;
    }

    public mount(playerId: string): boolean {
        if (!this.canMount(playerId)) {
            if (playerId === this.getLocalPlayerId()) {
                this.notify({
                    message: this.getMountRejectedMessage({
                        playerId,
                        reason: 'occupied',
                        occupiedById: this.occupiedBy || undefined,
                        occupiedByName: this.occupiedBy ? this.resolvePlayerName(this.occupiedBy) : undefined
                    }),
                    level: 'warning',
                    source: 'mount',
                    durationMs: 2400,
                    dedupeKey: `${this.adapter.ownerInstanceId}:mount:blocked-local`,
                    code: 'mount.rejected.occupied'
                });
            }
            return false;
        }

        if (this.adapter.context.isHost()) {
            return this.applyAuthoritativeMount(playerId);
        }
        this.awaitingMountAuthority = true;

        if (playerId === this.getLocalPlayerId()) {
            this.adapter.context.requestLocalMount(this.adapter.createLocalMountBinding());
        }

        this.emit(this.events.mountRequest, { mountPointId: this.adapter.mountPointId }, { localEcho: false });
        return true;
    }

    public unmount(playerId: string, reason: TMountReleaseReason = 'released'): void {
        if (this.adapter.context.isHost()) {
            this.applyAuthoritativeRelease(playerId, reason);
            return;
        }
        if (this.occupiedBy !== playerId) return;

        this.awaitingReleaseAuthority = true;
        if (playerId === this.getLocalPlayerId()) {
            this.adapter.context.releaseLocalMount(this.adapter.ownerInstanceId, reason);
        }
        this.emit(this.events.mountReleaseRequest, {
            mountPointId: this.adapter.mountPointId,
            reason
        }, { localEcho: false });
    }

    public requestAuthoritativeReleaseForLocal(reason: TMountReleaseReason): void {
        const localPlayerId = this.getLocalPlayerId();
        if (!localPlayerId || this.occupiedBy !== localPlayerId) return;

        if (this.adapter.context.isHost()) {
            this.applyAuthoritativeRelease(localPlayerId, reason);
            return;
        }

        if (this.awaitingReleaseAuthority) return;
        this.awaitingReleaseAuthority = true;
        this.emit(this.events.mountReleaseRequest, {
            mountPointId: this.adapter.mountPointId,
            reason
        }, { localEcho: false });
    }

    public handleReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): boolean {
        if (eventType === this.events.occupancy) {
            this.applyOccupancyPayload(data);
            return true;
        }

        if (eventType === this.events.mountRequest) {
            if (!this.adapter.context.isHost()) return true;
            this.handleMountRequestAsHost(meta.senderId, data);
            return true;
        }

        if (eventType === this.events.mountReleaseRequest) {
            if (!this.adapter.context.isHost()) return true;
            this.handleMountReleaseRequestAsHost(meta.senderId, data);
            return true;
        }

        if (eventType === this.events.mountRejected) {
            this.handleMountRejected(data);
            return true;
        }

        return false;
    }

    public captureSnapshot(): unknown {
        return { occupiedBy: this.occupiedBy };
    }

    public applySnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const payload = snapshot as IOccupancyPayload;
        if (payload.occupiedBy !== null && typeof payload.occupiedBy !== 'string') return;
        this.applyOccupancy(payload.occupiedBy);
    }

    private applyAuthoritativeMount(playerId: string): boolean {
        if (!this.canMount(playerId)) return false;
        this.occupiedBy = playerId;
        const hadPendingMountRequest = this.awaitingMountAuthority;
        this.awaitingMountAuthority = false;
        this.awaitingReleaseAuthority = false;

        if (playerId === this.getLocalPlayerId() && !this.adapter.context.isMountedLocal(this.adapter.ownerInstanceId)) {
            this.adapter.context.grantLocalMount(this.adapter.createLocalMountBinding());
        }

        this.emit(this.events.occupancy, { occupiedBy: playerId }, { localEcho: false });
        this.adapter.onOccupancyChanged?.(this.occupiedBy);
        if (playerId === this.getLocalPlayerId()) {
            this.notify({
                message: `Mounted ${this.getMountLabel()}.`,
                level: 'success',
                source: 'mount',
                durationMs: 1600,
                dedupeKey: hadPendingMountRequest
                    ? `${this.adapter.ownerInstanceId}:mount:granted`
                    : `${this.adapter.ownerInstanceId}:mount:state`
            });
        }
        return true;
    }

    private applyAuthoritativeRelease(playerId: string, reason: TMountReleaseReason): boolean {
        if (this.occupiedBy !== playerId) return false;
        this.occupiedBy = null;
        this.awaitingMountAuthority = false;
        this.awaitingReleaseAuthority = false;

        if (playerId === this.getLocalPlayerId()) {
            this.adapter.context.unmountLocal(this.adapter.ownerInstanceId, reason);
        }

        this.emit(this.events.occupancy, { occupiedBy: null }, { localEcho: false });
        this.adapter.onOccupancyChanged?.(this.occupiedBy);
        return true;
    }

    private applyOccupancyPayload(data: unknown): void {
        const payload = data as IOccupancyPayload;
        if (!payload || (payload.occupiedBy !== null && typeof payload.occupiedBy !== 'string')) return;
        this.applyOccupancy(payload.occupiedBy);
    }

    private applyOccupancy(occupiedBy: string | null): void {
        const previousOccupiedBy = this.occupiedBy;
        this.occupiedBy = occupiedBy;
        const localPlayerId = this.getLocalPlayerId();

        if (this.occupiedBy === localPlayerId) {
            this.awaitingMountAuthority = false;
            this.awaitingReleaseAuthority = false;
            if (!this.adapter.context.isMountedLocal(this.adapter.ownerInstanceId)) {
                this.adapter.context.grantLocalMount(this.adapter.createLocalMountBinding());
            }
            if (previousOccupiedBy !== localPlayerId && localPlayerId) {
                this.notify({
                    message: `Mounted ${this.getMountLabel()}.`,
                    level: 'success',
                    source: 'mount',
                    durationMs: 1600,
                    dedupeKey: `${this.adapter.ownerInstanceId}:mount:granted`,
                    code: 'mount.granted'
                });
            }
        } else if (this.adapter.context.isMountedLocal(this.adapter.ownerInstanceId)) {
            this.adapter.context.unmountLocal(this.adapter.ownerInstanceId, 'external');
            if (this.awaitingMountAuthority && this.occupiedBy !== localPlayerId) {
                this.adapter.context.rejectLocalMount();
            }
            this.awaitingMountAuthority = false;
            if (!this.occupiedBy) this.awaitingReleaseAuthority = false;
        } else {
            if (this.awaitingMountAuthority && this.occupiedBy !== localPlayerId) {
                this.adapter.context.rejectLocalMount();
                this.awaitingMountAuthority = false;
            }
            if (!this.occupiedBy) this.awaitingReleaseAuthority = false;
        }

        this.adapter.onOccupancyChanged?.(this.occupiedBy);
    }

    private handleMountRequestAsHost(senderId: string | null, data: unknown): void {
        if (!senderId) return;
        const payload = data as IMountRequestPayload;
        const mountPointId = payload?.mountPointId ?? this.adapter.mountPointId;
        if (mountPointId !== this.adapter.mountPointId) {
            this.emitMountRejected(senderId, 'invalid_mount_point');
            return;
        }
        if (!this.applyAuthoritativeMount(senderId)) {
            this.emitMountRejected(senderId, 'occupied');
        }
    }

    private handleMountReleaseRequestAsHost(senderId: string | null, data: unknown): void {
        if (!senderId) return;
        const payload = data as IMountReleaseRequestPayload;
        const mountPointId = payload?.mountPointId ?? this.adapter.mountPointId;
        if (mountPointId !== this.adapter.mountPointId) {
            this.emitMountRejected(senderId, 'invalid_mount_point');
            return;
        }
        const reason = payload?.reason === 'movement' ? 'movement' : 'released';
        if (!this.applyAuthoritativeRelease(senderId, reason)) {
            this.emitMountRejected(senderId, 'not_occupant');
        }
    }

    private emitMountRejected(playerId: string, reason: string): void {
        const occupiedById = reason === 'occupied' ? this.occupiedBy : undefined;
        const occupiedByName = occupiedById ? this.resolvePlayerName(occupiedById) : undefined;
        this.emit(this.events.mountRejected, {
            playerId,
            reason,
            occupiedById,
            occupiedByName
        }, { localEcho: false });
    }

    private handleMountRejected(data: unknown): void {
        const payload = data as IMountRejectedPayload;
        if (!payload || typeof payload.playerId !== 'string' || typeof payload.reason !== 'string') return;
        const localPlayerId = this.getLocalPlayerId();
        if (!localPlayerId || payload.playerId !== localPlayerId) return;
        this.awaitingMountAuthority = false;
        this.awaitingReleaseAuthority = false;
        this.adapter.context.rejectLocalMount();
        this.notify({
            message: this.getMountRejectedMessage(payload),
            level: 'warning',
            source: 'mount',
            durationMs: 2600,
            dedupeKey: `${this.adapter.ownerInstanceId}:mount:rejected:${payload.reason}`,
            code: `mount.rejected.${payload.reason}`
        });
    }

    private getLocalPlayerId(): string | null {
        return this.adapter.context.getLocalPlayerId();
    }

    private getMountRejectedMessage(payload: IMountRejectedPayload): string {
        if (payload.reason === 'occupied') {
            const occupant = payload.occupiedByName || payload.occupiedById || 'another player';
            return `Cannot mount ${this.getMountLabel()}: occupied by ${occupant}.`;
        }
        if (payload.reason === 'not_occupant') {
            return `Cannot unmount ${this.getMountLabel()}: you are not the occupant.`;
        }
        if (payload.reason === 'invalid_mount_point') {
            return `Cannot mount ${this.getMountLabel()}: invalid seat.`;
        }
        return `Cannot mount ${this.getMountLabel()} right now.`;
    }

    private getMountLabel(): string {
        return this.adapter.mountLabel || 'object';
    }

    private notify(payload: ISystemNotificationPayload): void {
        this.adapter.context.pushNotification(payload);
    }

    private resolvePlayerName(peerId: string): string | undefined {
        const entity = this.adapter.context.getEntityById(peerId) as { name?: unknown } | undefined;
        if (entity && typeof entity.name === 'string' && entity.name.trim().length > 0) {
            return entity.name;
        }
        return undefined;
    }
}
