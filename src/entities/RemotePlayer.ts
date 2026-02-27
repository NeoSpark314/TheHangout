import { PlayerEntity } from './PlayerEntity';
import { IVector3, IQuaternion } from '../interfaces/IMath';
import { IView } from '../interfaces/IView';
import { StickFigureView, IPlayerViewState } from '../views/StickFigureView';
import { IPlayerEntityState, EntityType } from '../interfaces/IEntityState';
import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

export class RemotePlayer extends PlayerEntity {
    public peerId: string;
    public view: IView<IPlayerViewState>;
    public targetPosition: IVector3 = { x: 0, y: 5, z: 0 };
    public targetYaw: number = 0;
    public avatarColor: string | number | undefined;
    private lastNetworkUpdateTime: number = performance.now();
    private _onVoiceStream: (data: any) => void;

    constructor(protected context: GameContext, peerId: string, view: IView<IPlayerViewState>) {
        super(context, peerId, EntityType.REMOTE_PLAYER, false);
        this.peerId = peerId;
        this.view = view;
        this.name = 'Player'; // Default

        this._onVoiceStream = (data: any) => {
            if (data.peerId === this.peerId && data.stream && (this.view as any).attachVoiceStream) {
                console.log(`[RemotePlayer] Attaching voice stream for ${this.peerId}`);
                (this.view as any).attachVoiceStream(data.stream);
            }
        };
        eventBus.on(EVENTS.VOICE_STREAM_RECEIVED, this._onVoiceStream);
    }

    public onAudioChunk(payload: any): void {
        const chunk = typeof payload === 'string' ? payload : payload.chunk;
        const isHeader = !!payload.isHeader;

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
        if (data.n !== undefined && data.n !== this.name) {
            this.name = data.n;
            eventBus.emit(EVENTS.REMOTE_NAME_UPDATED, { peerId: this.peerId, name: this.name });
        }

        if (data.conf && data.conf.color !== this.avatarColor) {
            this.avatarColor = data.conf.color;
        }

        if (data.p) this.targetPosition = { x: data.p[0], y: data.p[1], z: data.p[2] };
        if (data.y !== undefined) this.targetYaw = data.y;
        if (data.h !== undefined) this.headHeight = data.h;

        this.lastNetworkUpdateTime = performance.now();

        if (data.hq) {
            this.headState.quaternion = { x: data.hq[0], y: data.hq[1], z: data.hq[2], w: data.hq[3] };
        }

        if (data.hands) {
            const deserializeHand = (netHand: any, localHand: any) => {
                localHand.active = !!netHand.active;
                localHand.hasJoints = !!netHand.hasJoints;
                if (netHand.position) localHand.position = { ...netHand.position };
                if (netHand.quaternion) localHand.quaternion = { ...netHand.quaternion };

                if (netHand.joints && netHand.joints.length === 25) {
                    for (let i = 0; i < 25; i++) {
                        const jData = netHand.joints[i];
                        if (jData.position) localHand.joints[i].position = { ...jData.position };
                        else if (jData.p) localHand.joints[i].position = { ...jData.p };

                        if (jData.quaternion) localHand.joints[i].quaternion = { ...jData.quaternion };
                        else if (jData.q) localHand.joints[i].quaternion = { ...jData.q };
                    }
                }
            };

            if (data.hands.left) deserializeHand(data.hands.left, this.handStates.left);
            if (data.hands.right) deserializeHand(data.hands.right, this.handStates.right);
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
        const audioLevel = this.view.getAudioLevel();

        this.view.applyState({
            position: this.targetPosition,
            yaw: this.targetYaw,
            headHeight: this.headHeight,
            headQuaternion: this.headState.quaternion,
            handStates: this.handStates,
            name: this.name || 'Player',
            color: this.avatarColor,
            audioLevel: audioLevel,
            lerpFactor: lerpFactor
        }, delta);
    }

    public destroy(): void {
        super.destroy();
        eventBus.off(EVENTS.VOICE_STREAM_RECEIVED, this._onVoiceStream);

        const render = this.context.managers.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
