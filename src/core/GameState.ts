import { EntityManager } from '../managers/EntityManager';
import { PhysicsManager } from '../managers/PhysicsManager';
import { NetworkManager } from '../network/NetworkManager';
import { InputManager } from '../input/InputManager';
import { RenderManager } from '../managers/RenderManager';
import { PlayerManager } from '../managers/PlayerManager';
import { RoomManager } from '../managers/RoomManager';
import { UIManager } from '../managers/UIManager';
import { HUDManager } from '../managers/HUDManager';
import { MediaManager } from '../managers/MediaManager';
import { AudioManager } from '../managers/AudioManager';
import { InteractionSystem } from '../systems/InteractionSystem';
import { LocalPlayer } from '../entities/LocalPlayer';
import { SpectatorEntity } from '../entities/SpectatorEntity';

export interface AvatarConfig {
    color: string | number;
}

export interface RoomConfig {
    environment: string;
    skyColor: string;
    fogNear: number;
    fogFar: number;
    seed: number;
}

export interface Managers {
    entity: EntityManager;
    ui: UIManager;
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
}

export class GameState {
    public isHost: boolean = false;
    public isDedicatedHost: boolean = false;
    public isLocalServer: boolean = false;
    public roomId: string | null = null;
    public playerName: string = 'Player';
    public avatarConfig: AvatarConfig = {
        color: '#00ffff'
    };
    public voiceEnabled: boolean = false;
    public roomConfig: RoomConfig = {
        environment: 'cyber-stube',
        skyColor: '#0b0c10',
        fogNear: 5,
        fogFar: 1000,
        seed: Math.floor(Math.random() * 2147483647)
    };

    public localPlayer: LocalPlayer | SpectatorEntity | null = null;

    private _managers: Partial<Managers> = {};

    public get managers(): Managers {
        return this._managers as Managers;
    }

    public setManager<K extends keyof Managers>(key: K, instance: Managers[K]): void {
        this._managers[key] = instance;
    }

    public deltaTime: number = 0;
}

const gameState = new GameState();
export default gameState;
