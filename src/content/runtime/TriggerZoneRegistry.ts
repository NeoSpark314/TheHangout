import * as THREE from 'three';
import type { AppContext } from '../../app/AppContext';
import {
    type ITriggerBoxOptions,
    type ITriggerParticipant,
    type ITriggerZoneHandle
} from '../contracts/IObjectRuntimeContext';
import { EntityType } from '../../shared/contracts/IEntityState';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import { SharedPropHandle } from './SharedPropHandle';

interface ITriggerZoneRecord {
    id: string;
    enabled: boolean;
    filter: 'player' | 'shared-prop' | 'any';
    position: THREE.Vector3;
    halfExtents: THREE.Vector3;
    rotation: THREE.Quaternion;
    inverseRotation: THREE.Quaternion;
    activeParticipantIds: Set<string>;
    enterCallbacks: Array<(participant: ITriggerParticipant) => void>;
    exitCallbacks: Array<(participant: ITriggerParticipant) => void>;
}

class TriggerZoneHandle implements ITriggerZoneHandle {
    constructor(
        public readonly id: string,
        private readonly registry: TriggerZoneRegistry
    ) { }

    public setEnabled(enabled: boolean): void {
        this.registry.setEnabled(this.id, enabled);
    }

    public destroy(): void {
        this.registry.remove(this.id);
    }

    public onEnter(callback: (participant: ITriggerParticipant) => void): () => void {
        return this.registry.addEnterListener(this.id, callback);
    }

    public onExit(callback: (participant: ITriggerParticipant) => void): () => void {
        return this.registry.addExitListener(this.id, callback);
    }
}

export class TriggerZoneRegistry {
    private readonly zones = new Map<string, ITriggerZoneRecord>();
    private nextId = 0;
    private readonly point = new THREE.Vector3();
    private readonly localPoint = new THREE.Vector3();

    constructor(private readonly context: AppContext) { }

    public createBox(options: ITriggerBoxOptions): ITriggerZoneHandle | null {
        const position = options.position;
        const halfExtents = options.halfExtents;
        if (!position || !halfExtents) return null;

        const rotation = options.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
        const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
        const id = options.id && options.id.length > 0
            ? options.id
            : `trigger-${(++this.nextId).toString(36)}`;

        this.zones.set(id, {
            id,
            enabled: options.enabled ?? true,
            filter: options.filter ?? 'any',
            position: new THREE.Vector3(position.x, position.y, position.z),
            halfExtents: new THREE.Vector3(halfExtents.x, halfExtents.y, halfExtents.z),
            rotation: quaternion,
            inverseRotation: quaternion.clone().invert(),
            activeParticipantIds: new Set<string>(),
            enterCallbacks: [],
            exitCallbacks: []
        });

        return new TriggerZoneHandle(id, this);
    }

    public update(): void {
        for (const zone of this.zones.values()) {
            if (!zone.enabled) continue;

            const nextParticipants = new Map<string, ITriggerParticipant>();
            this.collectPlayerParticipants(zone, nextParticipants);
            this.collectPropParticipants(zone, nextParticipants);

            for (const [participantId, participant] of nextParticipants.entries()) {
                if (zone.activeParticipantIds.has(participantId)) continue;
                zone.activeParticipantIds.add(participantId);
                for (const callback of zone.enterCallbacks) {
                    callback(participant);
                }
            }

            for (const previousId of Array.from(zone.activeParticipantIds)) {
                if (nextParticipants.has(previousId)) continue;
                zone.activeParticipantIds.delete(previousId);
                const participant = this.resolveParticipant(previousId);
                if (!participant) continue;
                for (const callback of zone.exitCallbacks) {
                    callback(participant);
                }
            }
        }
    }

    public remove(id: string): void {
        const zone = this.zones.get(id);
        if (!zone) return;
        this.emitExitForAll(zone);
        this.zones.delete(id);
    }

    public setEnabled(id: string, enabled: boolean): void {
        const zone = this.zones.get(id);
        if (!zone || zone.enabled === enabled) return;
        zone.enabled = enabled;
        if (!enabled) {
            this.emitExitForAll(zone);
        }
    }

    public addEnterListener(id: string, callback: (participant: ITriggerParticipant) => void): () => void {
        const zone = this.zones.get(id);
        if (!zone) return () => undefined;
        zone.enterCallbacks.push(callback);
        return () => {
            const index = zone.enterCallbacks.indexOf(callback);
            if (index >= 0) zone.enterCallbacks.splice(index, 1);
        };
    }

    public addExitListener(id: string, callback: (participant: ITriggerParticipant) => void): () => void {
        const zone = this.zones.get(id);
        if (!zone) return () => undefined;
        zone.exitCallbacks.push(callback);
        return () => {
            const index = zone.exitCallbacks.indexOf(callback);
            if (index >= 0) zone.exitCallbacks.splice(index, 1);
        };
    }

    private collectPlayerParticipants(zone: ITriggerZoneRecord, nextParticipants: Map<string, ITriggerParticipant>): void {
        if (zone.filter === 'shared-prop') return;
        for (const entity of this.context.runtime.entity.entities.values()) {
            if (entity.type !== EntityType.PLAYER_AVATAR) continue;
            const player = entity as PlayerAvatarEntity;
            const position = this.getPlayerPosition(player);
            if (!position || !this.containsPoint(zone, position)) continue;
            nextParticipants.set(player.id, {
                id: player.id,
                kind: 'player',
                entityId: player.id,
                playerId: player.id,
                player
            });
        }
    }

    private collectPropParticipants(zone: ITriggerZoneRecord, nextParticipants: Map<string, ITriggerParticipant>): void {
        if (zone.filter === 'player') return;
        for (const entity of this.context.runtime.entity.entities.values()) {
            if (entity.type !== EntityType.PHYSICS_PROP) continue;
            const prop = entity as PhysicsPropEntity;
            const translation = prop.rigidBody?.translation?.();
            if (!translation) continue;
            if (!this.containsPoint(zone, translation)) continue;
            nextParticipants.set(prop.id, {
                id: prop.id,
                kind: 'shared-prop',
                entityId: prop.id,
                prop: new SharedPropHandle(this.context, prop.id)
            });
        }
    }

    private getPlayerPosition(player: PlayerAvatarEntity): { x: number; y: number; z: number } | null {
        const headPosition = player.getAvatarHeadWorldPose()?.position;
        if (headPosition && Number.isFinite(headPosition.x) && Number.isFinite(headPosition.y) && Number.isFinite(headPosition.z)) {
            return headPosition;
        }

        const meshPosition = player.view?.mesh?.position;
        if (!meshPosition) return null;
        return { x: meshPosition.x, y: meshPosition.y, z: meshPosition.z };
    }

    private containsPoint(zone: ITriggerZoneRecord, position: { x: number; y: number; z: number }): boolean {
        this.point.set(position.x, position.y, position.z);
        this.localPoint.copy(this.point).sub(zone.position).applyQuaternion(zone.inverseRotation);
        return Math.abs(this.localPoint.x) <= zone.halfExtents.x
            && Math.abs(this.localPoint.y) <= zone.halfExtents.y
            && Math.abs(this.localPoint.z) <= zone.halfExtents.z;
    }

    private emitExitForAll(zone: ITriggerZoneRecord): void {
        for (const participantId of Array.from(zone.activeParticipantIds)) {
            const participant = this.resolveParticipant(participantId);
            if (!participant) continue;
            for (const callback of zone.exitCallbacks) {
                callback(participant);
            }
        }
        zone.activeParticipantIds.clear();
    }

    private resolveParticipant(participantId: string): ITriggerParticipant | null {
        const entity = this.context.runtime.entity.getEntity(participantId);
        if (!entity) return null;
        if (entity.type === EntityType.PLAYER_AVATAR) {
            const player = entity as PlayerAvatarEntity;
            return {
                id: player.id,
                kind: 'player',
                entityId: player.id,
                playerId: player.id,
                player
            };
        }
        if (entity.type === EntityType.PHYSICS_PROP) {
            return {
                id: entity.id,
                kind: 'shared-prop',
                entityId: entity.id,
                prop: new SharedPropHandle(this.context, entity.id)
            };
        }
        return null;
    }
}
