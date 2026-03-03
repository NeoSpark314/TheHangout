import { PlayerEntity } from './PlayerEntity';
import { IVector3, IQuaternion } from '../../shared/contracts/IMath';
import { IView } from '../../shared/contracts/IView';
import { StickFigureView, IPlayerViewState } from '../../render/avatar/stickfigure/StickFigureView';
import { IPlayerEntityState, EntityType } from '../../shared/contracts/IEntityState';
import { HumanoidState } from '../../shared/types/HumanoidState';
import { HumanoidJointName } from '../../shared/contracts/IHumanoid';
import { IAudioChunkPayload, IVoiceStreamReceivedEvent, IVoiceStreamReceiver } from '../../shared/contracts/IVoice';
import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { formatPlayerDisplayName } from '../../shared/utils/PlayerBadgeUtils';

export class RemotePlayer extends PlayerEntity {
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
    public peerId: string;
    public view: IView<IPlayerViewState>;
    public targetPosition: IVector3 = { x: 0, y: 5, z: 0 };
    public targetYaw: number = 0;
    public avatarColor: string | number | undefined;
    public humanoid = new HumanoidState();
    private lastNetworkUpdateTime: number = performance.now();
    private _onVoiceStream: (data?: IVoiceStreamReceivedEvent) => void;

    constructor(protected context: AppContext, peerId: string, view: IView<IPlayerViewState>) {
        super(context, peerId, EntityType.REMOTE_PLAYER, false);
        this.peerId = peerId;
        this.view = view;
        this.name = 'Player'; // Default

        this._onVoiceStream = (data) => {
            const voiceView = this.view as unknown as Partial<IVoiceStreamReceiver>;
            if (data && data.peerId === this.peerId && data.stream && voiceView.attachVoiceStream) {
                console.log(`[RemotePlayer] Attaching voice stream for ${this.peerId}`);
                voiceView.attachVoiceStream(data.stream);
            }
        };
        eventBus.on(EVENTS.VOICE_STREAM_RECEIVED, this._onVoiceStream);

        const cachedStream = this.context.runtime.media?.getRemoteStream(this.peerId);
        const voiceView = this.view as unknown as Partial<IVoiceStreamReceiver>;
        if (cachedStream && voiceView.attachVoiceStream) {
            console.log(`[RemotePlayer] Attaching cached voice stream for ${this.peerId}`);
            voiceView.attachVoiceStream(cachedStream);
        }
    }

    public onAudioChunk(payload: IAudioChunkPayload): void {
        const { chunk, isHeader } = payload;

        if (isHeader) {
            console.log(`[RemotePlayer] Receiving audio header chunk from ${this.peerId} (${chunk?.length} chars)`);
        }
        this.lastNetworkUpdateTime = performance.now(); // Audio activity counts as presence
        this.view.attachAudioChunk({ chunk, isHeader });
    }

    public getNetworkState(): IPlayerEntityState | null {
        return null; // Remote players don't broadcast their own state from here
    }

    public applyNetworkState(data: IPlayerEntityState): void {
        let stateChanged = false;

        if (data.n !== undefined && data.n !== this.name) {
            this.name = data.n;
            eventBus.emit(EVENTS.REMOTE_NAME_UPDATED, { peerId: this.peerId, name: this.name });
            stateChanged = true;
        }

        if (data.conf && data.conf.color !== this.avatarColor) {
            this.avatarColor = data.conf.color;
            stateChanged = true;
        }

        if (data.mic !== undefined && this.micEnabled !== !!data.mic) {
            this.micEnabled = !!data.mic;
            stateChanged = true;
        }

        if (stateChanged) {
            eventBus.emit(EVENTS.PEER_STATE_UPDATED, this.peerId);
        }

        if (data.p) this.targetPosition = { x: data.p[0], y: data.p[1], z: data.p[2] };
        if (data.y !== undefined) this.targetYaw = data.y;
        if (data.h !== undefined) this.headHeight = data.h;

        this.lastNetworkUpdateTime = performance.now();

        if (data.hq) {
            this.headState.quaternion = { x: data.hq[0], y: data.hq[1], z: data.hq[2], w: data.hq[3] };
        }

        if (data.hm) {
            if (data.hm[0] === 0) this.clearFingerJoints('left');
            if (data.hm[1] === 0) this.clearFingerJoints('right');
        }

        if (data.hmd !== undefined) {
            this.humanoid.applyNetworkDelta(data.hmd);
        }
    }

    private clearFingerJoints(hand: 'left' | 'right'): void {
        const joints = RemotePlayer.HAND_FINGER_JOINTS[hand];
        for (let i = 0; i < joints.length; i++) {
            this.humanoid.clearJoint(joints[i]);
        }
    }

    public update(delta: number, _frame?: XRFrame): void {
        if (performance.now() - this.lastNetworkUpdateTime > 10000) {
            console.warn(`[RemotePlayer] Player ${this.peerId} timed out. Destroying.`);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, this.peerId);
            this.destroy();
            return;
        }

        const lerpFactor = 15 * delta;
        this.audioLevel = this.view.getAudioLevel();

        this.view.applyState({
            position: this.targetPosition,
            yaw: this.targetYaw,
            headHeight: this.headHeight,
            headQuaternion: this.headState.quaternion,
            humanoid: this.humanoid,
            name: formatPlayerDisplayName(
                {
                    name: this.name || 'Player',
                    micEnabled: this.micEnabled,
                    isMuted: this.isMuted
                },
                {
                    includeHost: false,
                    includeTalking: false
                }
            ),
            color: this.avatarColor,
            audioLevel: this.audioLevel,
            lerpFactor: lerpFactor
        }, delta);
    }

    public destroy(): void {
        super.destroy();
        eventBus.off(EVENTS.VOICE_STREAM_RECEIVED, this._onVoiceStream);

        const render = this.context.runtime.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
