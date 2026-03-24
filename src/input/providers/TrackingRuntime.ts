import { AppContext } from '../../app/AppContext';
import { ITrackingProvider, ITrackingState } from '../../shared/contracts/ITrackingProvider';
import { HandState } from '../../shared/types/HandState';

export class TrackingRuntime {
    private activeProvider: ITrackingProvider | null = null;
    private providers: Map<string, ITrackingProvider> = new Map();

    constructor(private context: AppContext) { }

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
            console.log(`[TrackingRuntime] Switched to provider: ${id}`);
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
                localPose: {
                    position: { x: 0, y: 1.7, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                },
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

    public setAssistedReach(hand: 'left' | 'right', reach: number | null): void {
        if (this.activeProvider && this.activeProvider.setAssistedReach) {
            this.activeProvider.setAssistedReach(hand, reach);
        }
    }

}
