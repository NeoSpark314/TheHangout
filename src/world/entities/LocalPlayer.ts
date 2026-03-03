import * as THREE from 'three';
import { PlayerAvatarEntity } from './PlayerAvatarEntity';
import { IView } from '../../shared/contracts/IView';
import { AppContext } from '../../app/AppContext';
import { IVector3, IPose } from '../../shared/contracts/IMath';
import { StickFigureView, IPlayerViewState } from '../../render/avatar/stickfigure/StickFigureView';
import { IPlayerEntityState, EntityType } from '../../shared/contracts/IEntityState';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { HumanoidState } from '../../shared/types/HumanoidState';
import { LocalPlayerControlStrategy, ILocalPlayerTeleportOptions } from './strategies/LocalPlayerControlStrategy';
import type { Skill } from '../../skills/Skill';

/**
 * Source of Truth: This entity owns the local player's spatial state (poses, origin, skills).
 * The RenderRuntime and Views must follow this state, never modify it directly.
 */
export class LocalPlayer extends PlayerAvatarEntity {
    public view: IView<IPlayerViewState>;
    public humanoid = new HumanoidState();
    public readonly spawnPosition: IVector3;
    public readonly spawnYaw: number;

    public _lastMoveVector: IVector3 = { x: 0, y: 0, z: 0 };
    public _leftControllerIndex: number = 0;
    public _rightControllerIndex: number = 1;
    private readonly controlStrategy: LocalPlayerControlStrategy;

    constructor(public context: AppContext, id: string, spawnPos: IVector3, spawnYaw: number, view: IView<IPlayerViewState>) {
        super(context, id || 'local-player-id-temp', EntityType.LOCAL_PLAYER, true);
        this.isAuthority = true;
        this.view = view;
        this.spawnPosition = { ...spawnPos };
        this.spawnYaw = spawnYaw;

        this.view.mesh.userData.entityId = this.id;
        this.view.mesh.traverse(child => {
            child.userData.entityId = this.id;
        });

        eventBus.on(EVENTS.AVATAR_CONFIG_UPDATED, (config) => {
            if (this.view) {
                this.view.setColor(config.color);
            }
        });

        this.controlStrategy = new LocalPlayerControlStrategy();
        this.controlStrategy.attach(this);
    }

    public get xrOrigin(): IPose {
        return this.controlStrategy.xrOrigin;
    }

    public addSkill(skill: Skill): void {
        this.controlStrategy.addSkill(this, skill);
    }

    public setActiveSkill(id: string): void {
        this.controlStrategy.setActiveSkill(this, id);
    }

    public getSkill(id: string): Skill | undefined {
        return this.controlStrategy.getSkill(id);
    }

    public update(delta: number, frame?: XRFrame): void {
        this.controlStrategy.update(this, delta, frame);
    }

    public getNetworkState(fullSync: boolean = false): IPlayerEntityState {
        return this.controlStrategy.getNetworkState(this, fullSync);
    }

    public applyNetworkState(state: IPlayerEntityState): void {
        // LocalPlayer state is driven by input, not network updates.
    }

    public moveOriginTo(position: THREE.Vector3, yaw: number): void {
        this.controlStrategy.moveOriginTo(position, yaw);
    }

    public teleportTo(position: THREE.Vector3, yaw: number, options: ILocalPlayerTeleportOptions = {}): void {
        this.controlStrategy.teleportTo(this, position, yaw, options);
    }

    public destroy(): void {
        super.destroy();
        this.controlStrategy.destroy(this);

        const render = this.context.runtime.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
