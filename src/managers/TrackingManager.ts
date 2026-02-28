import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { HandState } from '../models/HandState';

export class TrackingManager {
    private activeProvider: ITrackingProvider | null = null;
    private providers: Map<string, ITrackingProvider> = new Map();

    constructor(private context: GameContext) { }

    public registerProvider(provider: ITrackingProvider): void {
        this.providers.set(provider.id, provider);
        provider.init();
    }

    public getActiveProviderId(): string | null {
        return this.activeProvider ? this.activeProvider.id : null;
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
                pose: {
                    position: { x: 0, y: 1.7, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                },
                yaw: 0
            },
            hands: {
                left: new HandState(-0.4),
                right: new HandState(0.4)
            }
        };
    }

    public setHandActive(hand: 'left' | 'right', active: boolean): void {
        if (this.activeProvider && this.activeProvider.setHandActive) {
            this.activeProvider.setHandActive(hand, active);
        }
    }

    public adjustReach(delta: number): void {
        if (this.activeProvider && this.activeProvider.adjustReach) {
            this.activeProvider.adjustReach(delta);
        }
    }

}
