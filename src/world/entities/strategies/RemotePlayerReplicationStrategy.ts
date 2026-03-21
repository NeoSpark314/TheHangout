import { HumanoidJointName } from '../../../shared/contracts/IHumanoid';
import type { IPlayerEntityState } from '../../../shared/contracts/IEntityState';
import type { IAudioChunkPayload, IVoiceStreamReceivedEvent, IVoiceStreamReceiver } from '../../../shared/contracts/IVoice';
import eventBus from '../../../app/events/EventBus';
import { EVENTS } from '../../../shared/constants/Constants';
import { formatPlayerDisplayName } from '../../../shared/utils/PlayerBadgeUtils';
import type { PlayerAvatarEntity } from '../PlayerAvatarEntity';
import type { IPlayerAvatarControlStrategy } from './IPlayerAvatarControlStrategy';

export class RemotePlayerReplicationStrategy implements IPlayerAvatarControlStrategy {
    public readonly mode = 'remote';
    private static readonly HAND_FINGER_JOINTS: Record<'left' | 'right', HumanoidJointName[]> = {
        left: [
            'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftThumbTip',
            'leftIndexMetacarpal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftIndexTip',
            'leftMiddleMetacarpal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftMiddleTip',
            'leftRingMetacarpal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftRingTip',
            'leftLittleMetacarpal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftLittleTip'
        ],
        right: [
            'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal', 'rightThumbTip',
            'rightIndexMetacarpal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightIndexTip',
            'rightMiddleMetacarpal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightMiddleTip',
            'rightRingMetacarpal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightRingTip',
            'rightLittleMetacarpal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal', 'rightLittleTip'
        ]
    };

    private lastNetworkUpdateTime = performance.now();
    private onVoiceStream: (data?: IVoiceStreamReceivedEvent) => void = () => { };

    public attach(player: PlayerAvatarEntity): void {
        player.name = 'Player';

        this.onVoiceStream = (data) => {
            const voiceView = player.view as unknown as Partial<IVoiceStreamReceiver>;
            if (data && data.peerId === player.peerId && data.stream && voiceView.attachVoiceStream) {
                console.log(`[RemotePlayer] Attaching voice stream for ${player.peerId}`);
                voiceView.attachVoiceStream(data.stream);
            }
        };
        eventBus.on(EVENTS.VOICE_STREAM_RECEIVED, this.onVoiceStream);

        const cachedStream = player.appContext.runtime.media?.getRemoteStream(player.peerId);
        const voiceView = player.view as unknown as Partial<IVoiceStreamReceiver>;
        if (cachedStream && voiceView.attachVoiceStream) {
            console.log(`[RemotePlayer] Attaching cached voice stream for ${player.peerId}`);
            voiceView.attachVoiceStream(cachedStream);
        }
    }

    public onAudioChunk(player: PlayerAvatarEntity, payload: IAudioChunkPayload): void {
        const { chunk, isHeader } = payload;

        if (isHeader) {
            console.log(`[RemotePlayer] Receiving audio header chunk from ${player.peerId} (${chunk?.length} chars)`);
        }
        this.lastNetworkUpdateTime = performance.now();
        player.view.attachAudioChunk({ chunk, isHeader });
    }

    public getNetworkState(): IPlayerEntityState | null {
        return null;
    }

    public applyNetworkState(player: PlayerAvatarEntity, data: IPlayerEntityState): void {
        let stateChanged = false;

        if (data.n !== undefined && data.n !== player.name) {
            player.name = data.n;
            eventBus.emit(EVENTS.REMOTE_NAME_UPDATED, { peerId: player.peerId, name: player.name });
            stateChanged = true;
        }

        if (data.conf) {
            const incomingRenderMode = data.conf.renderMode ?? 'stick';
            const incomingUrl = data.conf.vrmUrl ?? null;
            const changed = data.conf.color !== player.avatarConfigSnapshot.color
                || incomingRenderMode !== player.avatarConfigSnapshot.renderMode
                || incomingUrl !== (player.avatarConfigSnapshot.vrmUrl ?? null);

            if (changed) {
                player.setAvatarConfig({
                    color: data.conf.color,
                    renderMode: incomingRenderMode,
                    vrmUrl: incomingUrl
                });
                stateChanged = true;
            }
        }

        if (data.mic !== undefined && player.micEnabled !== !!data.mic) {
            player.micEnabled = !!data.mic;
            stateChanged = true;
        }

        if (stateChanged) {
            eventBus.emit(EVENTS.PEER_STATE_UPDATED, player.peerId);
        }

        if (data.p) player.targetPosition = { x: data.p[0], y: data.p[1], z: data.p[2] };
        if (data.y !== undefined) player.targetYaw = data.y;
        if (data.h !== undefined) player.headHeight = data.h;

        this.lastNetworkUpdateTime = performance.now();

        if (data.hq) {
            player.headState.quaternion = { x: data.hq[0], y: data.hq[1], z: data.hq[2], w: data.hq[3] };
        }

        if (data.hm) {
            if (data.hm[0] === 0) this.clearFingerJoints(player, 'left');
            if (data.hm[1] === 0) this.clearFingerJoints(player, 'right');
        }

        if (data.hmd !== undefined) {
            player.humanoid.applyNetworkDelta(data.hmd);
        }
    }

    public update(player: PlayerAvatarEntity, delta: number): void {
        if (performance.now() - this.lastNetworkUpdateTime > 10000) {
            console.warn(`[RemotePlayer] Player ${player.peerId} timed out. Destroying.`);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, player.peerId);
            player.destroy();
            return;
        }

        const lerpFactor = 15 * delta;
        player.audioLevel = player.view.getAudioLevel();

        player.view.applyState({
            position: player.targetPosition,
            yaw: player.targetYaw,
            headHeight: player.headHeight,
            headQuaternion: player.headState.quaternion,
            humanoid: player.humanoid,
            name: formatPlayerDisplayName(
                {
                    name: player.name || 'Player',
                    micEnabled: player.micEnabled,
                    isMuted: player.isMuted
                },
                {
                    includeHost: false,
                    includeTalking: false
                }
            ),
            color: player.avatarConfigSnapshot.color,
            audioLevel: player.audioLevel,
            lerpFactor
        }, delta);
    }

    public detach(_player: PlayerAvatarEntity): void {
        eventBus.off(EVENTS.VOICE_STREAM_RECEIVED, this.onVoiceStream);
    }

    public destroy(player: PlayerAvatarEntity): void {
        this.detach(player);
    }

    private clearFingerJoints(player: PlayerAvatarEntity, hand: 'left' | 'right'): void {
        const joints = RemotePlayerReplicationStrategy.HAND_FINGER_JOINTS[hand];
        for (let index = 0; index < joints.length; index += 1) {
            player.humanoid.clearJoint(joints[index]);
        }
    }
}
