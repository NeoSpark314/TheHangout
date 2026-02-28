import type { EntityManager } from '../managers/EntityManager';
import type { PhysicsManager } from '../managers/PhysicsManager';
import type { NetworkManager } from '../network/NetworkManager';
import type { InputManager } from '../input/InputManager';
import type { RenderManager } from '../managers/RenderManager';
import type { PlayerManager } from '../managers/PlayerManager';
import type { RoomManager } from '../managers/RoomManager';
import type { FlatUIManager } from '../managers/FlatUIManager';
import type { HUDManager } from '../managers/HUDManager';
import type { MediaManager } from '../managers/MediaManager';
import type { AudioManager } from '../managers/AudioManager';
import type { InteractionSystem } from '../systems/InteractionSystem';
import type { XRSystem } from '../systems/XRSystem';
import type { AnimationSystem } from '../systems/AnimationSystem';
import type { AssetManager } from '../managers/AssetManager';
import type { DrawingManager } from '../managers/DrawingManager';
import type { TrackingManager } from '../managers/TrackingManager';
import type { VRUIManager } from '../managers/VRUIManager';
import type { LocalPlayer } from '../entities/LocalPlayer';

export interface IAvatarConfig {
    color: string | number;
}

export interface IRoomConfig {
    environment: string;
    skyColor: string;
    fogNear: number;
    fogFar: number;
    seed: number;
}

export interface IManagers {
    entity: EntityManager;
    ui: FlatUIManager;
    network: NetworkManager;
    media: MediaManager;
    render: RenderManager;
    physics: PhysicsManager;
    player: PlayerManager;
    input: InputManager;
    hud: HUDManager;
    room: RoomManager;
    audio: AudioManager;
    interaction: InteractionSystem;
    xr: XRSystem;
    animation: AnimationSystem;
    assets: AssetManager;
    drawing: DrawingManager;
    tracking: TrackingManager;
    vrUi: VRUIManager;
}

/**
 * GameContext acts as the central dependency injection container and state holder.
 * It replaces the legacy global singleton approach, making dependencies explicit
 * and improving testability and modularity across the application.
 */
export class GameContext {
    public isHost: boolean = false;
    public isDedicatedHost: boolean = false;
    public isLocalServer: boolean = false;
    public roomId: string | null = null;
    public playerName: string = 'Player';
    public avatarConfig: IAvatarConfig = {
        color: '#00ffff'
    };
    public voiceEnabled: boolean = true;
    public roomConfig: IRoomConfig = {
        environment: 'cyber-stube',
        skyColor: '#0b0c10',
        fogNear: 5,
        fogFar: 1000,
        seed: Math.floor(Math.random() * 2147483647)
    };

    public localPlayer: LocalPlayer | null = null;
    public isMenuOpen: boolean = false;

    private _managers: Partial<IManagers> = {};

    public get managers(): IManagers {
        return this._managers as IManagers;
    }

    public setManager<K extends keyof IManagers>(key: K, instance: IManagers[K]): void {
        this._managers[key] = instance;
    }

    public deltaTime: number = 0;
}
