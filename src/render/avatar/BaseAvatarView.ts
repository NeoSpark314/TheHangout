import * as THREE from 'three';
import { AppContext } from '../../app/AppContext';
import { EntityView } from '../views/EntityView';
import { NameTagComponent } from './components/NameTagComponent';
import { VoiceAudioComponent } from './components/VoiceAudioComponent';
import { IPlayerAvatarRenderState } from './IPlayerAvatarRenderState';

export abstract class BaseAvatarView extends EntityView<IPlayerAvatarRenderState> {
    public color: string | number;
    protected readonly nameTagComponent: NameTagComponent;
    protected readonly voiceAudio: VoiceAudioComponent;
    protected readonly tmpTargetPos = new THREE.Vector3();
    protected readonly tmpTargetQuat = new THREE.Quaternion();
    protected currentHeadAnchorY = 1.6;

    constructor(
        protected readonly context: AppContext,
        mesh: THREE.Object3D,
        headAnchor: THREE.Object3D,
        {
            color = 0x00ffff,
            isLocal = false
        }: {
            color?: string | number;
            isLocal?: boolean;
        } = {}
    ) {
        super(mesh);
        this.color = color;
        this.nameTagComponent = new NameTagComponent(this.mesh, () => this.currentHeadAnchorY, this.color);
        this.voiceAudio = new VoiceAudioComponent(headAnchor, this.context.runtime.render?.audioListener, isLocal);
    }

    public applyState(state: IPlayerAvatarRenderState, delta: number): void {
        const lerpFactor = state.lerpFactor ?? 1.0;
        const skeleton = state.skeleton;

        this.tmpTargetPos.set(
            skeleton.rootWorldPosition.x,
            skeleton.rootWorldPosition.y,
            skeleton.rootWorldPosition.z
        );
        this.tmpTargetQuat.set(
            skeleton.rootWorldQuaternion.x,
            skeleton.rootWorldQuaternion.y,
            skeleton.rootWorldQuaternion.z,
            skeleton.rootWorldQuaternion.w
        );

        if (lerpFactor < 1.0) {
            this.mesh.position.lerp(this.tmpTargetPos, lerpFactor);
            this.mesh.quaternion.slerp(this.tmpTargetQuat, lerpFactor);
        } else {
            this.mesh.position.copy(this.tmpTargetPos);
            this.mesh.quaternion.copy(this.tmpTargetQuat);
        }

        if (state.name !== undefined) {
            this.setName(state.name);
        }

        if (state.color !== undefined && state.color !== this.color) {
            this.setColor(state.color);
        }

        this.nameTagComponent.faceCamera(this.context.runtime.render?.camera);
        this.nameTagComponent.updatePosition();
    }

    public setColor(color: string | number): void {
        this.color = color;
        this.nameTagComponent.setColor(color);
    }

    public setName(name: string): void {
        this.nameTagComponent.setName(name);
    }

    public attachVoiceStream(stream: MediaStream): void {
        this.voiceAudio.attachVoiceStream(stream);
    }

    public attachAudioChunk(data: { chunk: string; isHeader: boolean } | string): void {
        this.voiceAudio.attachAudioChunk(data);
    }

    public setMuted(muted: boolean): void {
        this.voiceAudio.setMuted(muted);
    }

    public getAudioLevel(): number {
        return this.voiceAudio.getAudioLevel();
    }

    public destroy(): void {
        this._cleanupMesh();
        this.voiceAudio.destroy();
        this.nameTagComponent.destroy();
    }
}
