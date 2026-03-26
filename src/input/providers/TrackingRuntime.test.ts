import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../app/AppContext';
import { TrackingRuntime } from './TrackingRuntime';
import type { ITrackingProvider, ITrackingState } from '../../shared/contracts/ITrackingProvider';

function createProvider(id: string, state?: ITrackingState): ITrackingProvider {
    return {
        id,
        init: vi.fn(),
        activate: vi.fn(),
        deactivate: vi.fn(),
        update: vi.fn(),
        getState: vi.fn(() => state ?? {
            head: {
                pose: {
                    position: { x: 1, y: 2, z: 3 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                },
                yaw: 0.5
            },
            hands: {
                left: {
                    active: true,
                    hasJoints: false,
                    pose: {
                        position: { x: 0, y: 0, z: 0 },
                        quaternion: { x: 0, y: 0, z: 0, w: 1 }
                    },
                    pointerPose: {
                        position: { x: 0, y: 0, z: 0 },
                        quaternion: { x: 0, y: 0, z: 0, w: 1 }
                    },
                    joints: []
                },
                right: {
                    active: false,
                    hasJoints: false,
                    pose: {
                        position: { x: 0, y: 0, z: 0 },
                        quaternion: { x: 0, y: 0, z: 0, w: 1 }
                    },
                    pointerPose: {
                        position: { x: 0, y: 0, z: 0 },
                        quaternion: { x: 0, y: 0, z: 0, w: 1 }
                    },
                    joints: []
                }
            }
        }),
        destroy: vi.fn()
    };
}

describe('TrackingRuntime', () => {
    it('registers providers and initializes them immediately', () => {
        const runtime = new TrackingRuntime(new AppContext());
        const provider = createProvider('desktop');

        runtime.registerProvider(provider);

        expect(provider.init).toHaveBeenCalledTimes(1);
    });

    it('switches active providers and forwards update/state to the active one', () => {
        const runtime = new TrackingRuntime(new AppContext());
        const desktop = createProvider('desktop');
        const xr = createProvider('xr');
        runtime.registerProvider(desktop);
        runtime.registerProvider(xr);

        runtime.setProvider('desktop');
        runtime.setProvider('xr');
        runtime.update(0.016);

        expect(desktop.activate).toHaveBeenCalledTimes(1);
        expect(desktop.deactivate).toHaveBeenCalledTimes(1);
        expect(xr.activate).toHaveBeenCalledTimes(1);
        expect(xr.update).toHaveBeenCalledWith(0.016, undefined);
        expect(runtime.getState()).toBe((xr.getState as any).mock.results[0].value);
        expect(runtime.getActiveProviderId()).toBe('xr');
    });

    it('provides a fallback tracking state when no provider is active', () => {
        const runtime = new TrackingRuntime(new AppContext());

        const state = runtime.getState();

        expect(state.head.pose.position.y).toBe(1.7);
        expect(state.hands.left.active).toBe(false);
        expect(state.hands.right.active).toBe(false);
    });

    it('forwards assisted reach only when the active provider supports it', () => {
        const runtime = new TrackingRuntime(new AppContext());
        const desktop = {
            ...createProvider('desktop'),
            setAssistedReach: vi.fn()
        };
        const xr = createProvider('xr');
        runtime.registerProvider(desktop);
        runtime.registerProvider(xr);

        runtime.setProvider('desktop');
        runtime.setAssistedReach('left', 0.75);
        runtime.setProvider('xr');
        runtime.setAssistedReach('right', null);

        expect(desktop.setAssistedReach).toHaveBeenCalledWith('left', 0.75);
    });
});
