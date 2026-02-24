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
    entity: EntityManager | null;
    ui: UIManager | null;
    network: NetworkManager | null;
    media: MediaManager | null;
    render: RenderManager | null;
    physics: PhysicsManager | null;
    player: PlayerManager | null;
    input: InputManager | null;
    hud: HUDManager | null;
    room: RoomManager | null;
    audio: AudioManager | null;
    interaction: InteractionSystem | null;
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

    public managers: Managers = {
        entity: null,
        ui: null,
        network: null,
        media: null,
        render: null,
        physics: null,
        player: null,
        input: null,
        hud: null,
        room: null,
        audio: null,
        interaction: null
    };

    public deltaTime: number = 0;
}

const gameState = new GameState();
export default gameState;
