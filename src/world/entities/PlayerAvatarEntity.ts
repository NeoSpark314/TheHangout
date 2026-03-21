import * as THREE from 'three';
import { ReplicatedEntity } from './ReplicatedEntity';
import { AppContext } from '../../app/AppContext';
import { IPose, IVector3 } from '../../shared/contracts/IMath';
import { IView } from '../../shared/contracts/IView';
import { IPlayerEntityState } from '../../shared/contracts/IEntityState';
import { HumanoidState } from '../../shared/types/HumanoidState';
import type { Skill } from '../../skills/Skill';
import type { IPlayerAvatarControlStrategy } from './strategies/IPlayerAvatarControlStrategy';
import type { IPlayerViewState } from '../../render/avatar/stickfigure/StickFigureView';
import type { ILocalPlayerTeleportOptions } from './strategies/LocalPlayerControlStrategy';
import type { IAudioChunkPayload } from '../../shared/contracts/IVoice';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { IAvatarConfig, normalizeAvatarConfig } from '../../shared/contracts/IAvatar';

export class PlayerAvatarEntity extends ReplicatedEntity {
    public static readonly DEFAULT_HEAD_HEIGHT = 1.7;
    public name: string = '';
    public headHeight: number = PlayerAvatarEntity.DEFAULT_HEAD_HEIGHT;
    public headState: IPose;
    public micEnabled: boolean = true;
    public audioLevel: number = 0;
    public isMuted: boolean = false;
    public view: IView<IPlayerViewState>;
    public humanoid = new HumanoidState();
    public readonly controlMode: 'local' | 'remote';
    public readonly spawnPosition: IVector3;
    public readonly spawnYaw: number;
    public readonly peerId: string;
    public targetPosition: IVector3 = { x: 0, y: 5, z: 0 };
    public targetYaw: number = 0;
    public avatarConfigSnapshot: IAvatarConfig;
    public _lastMoveVector: IVector3 = { x: 0, y: 0, z: 0 };
    public _leftControllerIndex: number = 0;
    public _rightControllerIndex: number = 1;
    private readonly avatarConfigListener?: (config: IAvatarConfig) => void;
    private controlStrategy: IPlayerAvatarControlStrategy | null = null;
    private fallbackOrigin: IPose;

    constructor(
        protected context: AppContext,
        id: string,
        type: string,
        isAuthority: boolean,
        view: IView<IPlayerViewState>,
        options: {
            controlMode: 'local' | 'remote';
            spawnPos?: IVector3;
            spawnYaw?: number;
            avatarConfig?: Partial<IAvatarConfig>;
        }
    ) {
        super(context, id, type, isAuthority);
        this.view = view;
        this.controlMode = options.controlMode;
        this.spawnPosition = options.spawnPos ? { ...options.spawnPos } : { x: 0, y: 0, z: 0 };
        this.spawnYaw = options.spawnYaw ?? 0;
        this.peerId = id;
        this.avatarConfigSnapshot = normalizeAvatarConfig(
            options.avatarConfig || (this.controlMode === 'local' ? this.context.avatarConfig : undefined)
        );

        this.headState = {
            position: { x: 0, y: PlayerAvatarEntity.DEFAULT_HEAD_HEIGHT, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };
        this.fallbackOrigin = {
            position: { ...this.spawnPosition },
            quaternion: { x: 0, y: Math.sin(this.spawnYaw / 2), z: 0, w: Math.cos(this.spawnYaw / 2) }
        };

        this.view.mesh.userData.entityId = this.id;
        this.view.mesh.traverse((child) => {
            child.userData.entityId = this.id;
        });

        if (this.controlMode === 'local') {
            this.avatarConfigListener = (config) => {
                this.setAvatarConfig(config);
            };
            eventBus.on(EVENTS.AVATAR_CONFIG_UPDATED, this.avatarConfigListener);
        }

        this.setAvatarConfig(this.avatarConfigSnapshot);
    }

    public attachControlStrategy(strategy: IPlayerAvatarControlStrategy): void {
        if (this.controlStrategy) {
            this.controlStrategy.detach(this);
        }
        this.controlStrategy = strategy;
        this.controlStrategy.attach(this);
    }

    public get xrOrigin(): IPose {
        return this.controlStrategy?.xrOrigin || this.fallbackOrigin;
    }

    public get appContext(): AppContext {
        return this.context;
    }

    public addSkill(skill: Skill): void {
        this.controlStrategy?.addSkill?.(this, skill);
    }

    public setActiveSkill(id: string): void {
        this.controlStrategy?.setActiveSkill?.(this, id);
    }

    public getSkill(id: string): Skill | undefined {
        return this.controlStrategy?.getSkill?.(id);
    }

    public update(delta: number, frame?: XRFrame): void {
        this.controlStrategy?.update(this, delta, frame);
    }

    public getNetworkState(fullSync: boolean = false): IPlayerEntityState | null {
        return this.controlStrategy?.getNetworkState(this, fullSync) || null;
    }

    public applyNetworkState(state: IPlayerEntityState): void {
        this.controlStrategy?.applyNetworkState?.(this, state);
    }

    public setAvatarConfig(config: Partial<IAvatarConfig>): void {
        this.avatarConfigSnapshot = normalizeAvatarConfig({
            ...this.avatarConfigSnapshot,
            ...config
        });
        this.view.setColor(this.avatarConfigSnapshot.color);
        (this.view as unknown as { setAvatarConfig?: (next: IAvatarConfig) => void }).setAvatarConfig?.(this.avatarConfigSnapshot);
    }

    public moveOriginTo(position: THREE.Vector3, yaw: number): void {
        this.controlStrategy?.moveOriginTo?.(position, yaw);
    }

    public teleportTo(position: THREE.Vector3, yaw: number, options: ILocalPlayerTeleportOptions = {}): void {
        this.controlStrategy?.teleportTo?.(this, position, yaw, options);
    }

    public onAudioChunk(payload: IAudioChunkPayload): void {
        this.controlStrategy?.onAudioChunk?.(this, payload);
    }

    public destroy(): void {
        super.destroy();
        this.controlStrategy?.destroy(this);
        this.controlStrategy = null;

        if (this.avatarConfigListener) {
            eventBus.off(EVENTS.AVATAR_CONFIG_UPDATED, this.avatarConfigListener);
        }

        const render = this.context.runtime.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
