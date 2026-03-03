import type * as THREE from 'three';
import type { IPlayerEntityState } from '../../../shared/contracts/IEntityState';
import type { IAudioChunkPayload } from '../../../shared/contracts/IVoice';
import type { PlayerAvatarEntity } from '../PlayerAvatarEntity';
import type { Skill } from '../../../skills/Skill';
import type { IPose } from '../../../shared/contracts/IMath';
import type { ILocalPlayerTeleportOptions } from './LocalPlayerControlStrategy';

export interface IPlayerAvatarControlStrategy {
    readonly mode: 'local' | 'remote';
    xrOrigin?: IPose;

    attach(player: PlayerAvatarEntity): void;
    detach(player: PlayerAvatarEntity): void;
    update(player: PlayerAvatarEntity, delta: number, frame?: XRFrame): void;
    applyNetworkState?(player: PlayerAvatarEntity, state: IPlayerEntityState): void;
    getNetworkState(player: PlayerAvatarEntity, fullSync?: boolean): IPlayerEntityState | null;
    onAudioChunk?(player: PlayerAvatarEntity, payload: IAudioChunkPayload): void;
    addSkill?(player: PlayerAvatarEntity, skill: Skill): void;
    setActiveSkill?(player: PlayerAvatarEntity, id: string): void;
    getSkill?(id: string): Skill | undefined;
    moveOriginTo?(position: THREE.Vector3, yaw: number): void;
    teleportTo?(player: PlayerAvatarEntity, position: THREE.Vector3, yaw: number, options?: ILocalPlayerTeleportOptions): void;
    destroy(player: PlayerAvatarEntity): void;
}
