import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { IHandState } from '../entities/PlayerEntity';

export class TrackingManager {
    private activeProvider: ITrackingProvider | null = null;
    private providers: Map<string, ITrackingProvider> = new Map();

    constructor(private context: GameContext) { }

    public registerProvider(provider: ITrackingProvider): void {
        this.providers.set(provider.id, provider);
        provider.init();
    }

    public setProvider(id: string): void {
        const provider = this.providers.get(id);
        if (provider) {
            if (this.activeProvider && this.activeProvider !== provider) {
                this.activeProvider.deactivate();
            }
            this.activeProvider = provider;
            this.activeProvider.activate();
            console.log(`[TrackingManager] Switched to provider: ${id}`);
        }
    }

    public update(delta: number, frame?: XRFrame): void {
        if (this.activeProvider) {
            this.activeProvider.update(delta, frame);
        }
    }

    public getState(): ITrackingState {
        if (this.activeProvider) {
            return this.activeProvider.getState();
        }

        // Fallback default state
        return {
            head: {
                position: { x: 0, y: 1.7, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
                yaw: 0
            },
            hands: {
                left: this.createEmptyHandState(-0.4),
                right: this.createEmptyHandState(0.4)
            }
        };
    }

    private createEmptyHandState(offsetX: number): IHandState {
        const state: IHandState = {
            active: false,
            position: { x: offsetX, y: 0.8, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            joints: []
        };
        for (let i = 0; i < 25; i++) {
            state.joints.push({
                position: { x: 0, y: 0, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            });
        }
        return state;
    }
}
