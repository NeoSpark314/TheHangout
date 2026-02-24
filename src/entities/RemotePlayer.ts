import { PlayerEntity } from './PlayerEntity';
import { Vector3, Quaternion } from '../interfaces/IMath';
import { IView } from '../interfaces/IView';
import { PlayerViewState } from '../views/StickFigureView';
import gameState from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

export class RemotePlayer extends PlayerEntity {
    public peerId: string;
    public view: IView<PlayerViewState>;
    public targetPosition: Vector3 = { x: 0, y: 5, z: 0 };
    public targetYaw: number = 0;
    public avatarColor: string | number | undefined;
    private lastNetworkUpdateTime: number = performance.now();

    constructor(peerId: string, view: IView<PlayerViewState>) {
        super(peerId, 'REMOTE_PLAYER', false);
        this.peerId = peerId;
        this.view = view;
        this.name = 'Player'; // Default

        this.onVoiceStream = this.onVoiceStream.bind(this);
        eventBus.on(EVENTS.VOICE_STREAM_RECEIVED, this.onVoiceStream);

        console.log(`[RemotePlayer] Created avatar for ${this.peerId}`);
    }

    private onVoiceStream(data: any): void {
        if (data.peerId === this.peerId) {
            this.view.attachVoiceStream(data.stream);
        }
    }

    public getNetworkState(): any {
        return null;
    }

    public applyNetworkState(data: any): void {
        if (data.name !== undefined && data.name !== this.name) {
            this.name = data.name;
            eventBus.emit(EVENTS.REMOTE_NAME_UPDATED, { peerId: this.peerId, name: this.name });
        }

        if (data.avatarConfig && data.avatarConfig.color !== this.avatarColor) {
            this.avatarColor = data.avatarConfig.color;
        }

        if (data.position) this.targetPosition = { ...data.position };
        if (data.yaw !== undefined) this.targetYaw = data.yaw;
        if (data.headHeight !== undefined) this.headHeight = data.headHeight;

        this.lastNetworkUpdateTime = performance.now();

        if (data.head) {
            if (data.head.position) this.headState.position = { ...data.head.position };
            if (data.head.quaternion) this.headState.quaternion = { ...data.head.quaternion };
        }

        if (data.hands) {
            const deserializeHand = (netHand: any, localHand: any) => {
                localHand.active = !!netHand.active;
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
        if (performance.now() - this.lastNetworkUpdateTime > 5000) {
            console.warn(`[RemotePlayer] Player ${this.peerId} timed out. Destroying.`);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, this.peerId);
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
        eventBus.off(EVENTS.VOICE_STREAM_RECEIVED, this.onVoiceStream);

        const render = gameState.managers.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
