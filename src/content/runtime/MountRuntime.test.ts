import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ILocalMountBinding } from '../contracts/IMounting';
import { MountRuntime } from './MountRuntime';

function createBinding(
    getSeatYaw: () => number,
    getViewYaw: () => number,
    preserveRelativeViewYaw: boolean
): ILocalMountBinding {
    return {
        ownerInstanceId: 'car-0',
        mountPointId: 'driver',
        getSeatPose: () => ({
            position: new THREE.Vector3(1, 2, 3),
            yaw: getSeatYaw()
        }),
        getViewPose: () => ({
            position: new THREE.Vector3(1, 2, 3),
            yaw: getViewYaw()
        }),
        preserveRelativeViewYaw
    };
}

describe('MountRuntime', () => {
    it('preserves relative view yaw for opted-in mounts while the mount turns', () => {
        let seatYaw = 1.0;
        let viewYaw = 1.0;
        let headYaw = 1.0;
        const teleportTo = vi.fn();
        const moveOriginTo = vi.fn();
        const runtime = new MountRuntime({
            localPlayer: {
                teleportTo,
                moveOriginTo,
                xrOrigin: {
                    position: { x: 0, y: 0, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                }
            },
            runtime: {
                input: { getMovementVector: () => ({ x: 0, y: 0 }) },
                notify: { warn: vi.fn() },
                tracking: { getState: () => ({ head: { yaw: headYaw } }) }
            }
        } as any);

        runtime.grantLocalMount(createBinding(() => seatYaw, () => viewYaw, true));
        expect(teleportTo).toHaveBeenCalledWith(expect.any(THREE.Vector3), 1.0, { targetSpace: 'player' });

        headYaw = 1.25;
        seatYaw = 1.4;
        viewYaw = 1.4;
        runtime.update();

        expect(moveOriginTo).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 1.65);
    });

    it('does not treat XR head turns as mount-relative yaw changes', () => {
        let seatYaw = 1.0;
        let viewYaw = 1.0;
        let headYaw = 1.0;
        const moveOriginTo = vi.fn();
        const runtime = new MountRuntime({
            localPlayer: {
                teleportTo: vi.fn(),
                moveOriginTo,
                xrOrigin: {
                    position: { x: 0, y: 0, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                }
            },
            runtime: {
                input: { getMovementVector: () => ({ x: 0, y: 0 }) },
                notify: { warn: vi.fn() },
                tracking: { getState: () => ({ head: { yaw: headYaw } }) },
                render: { isXRPresenting: () => true }
            }
        } as any);

        runtime.grantLocalMount(createBinding(() => seatYaw, () => viewYaw, true));

        headYaw = 1.4;
        seatYaw = 1.25;
        viewYaw = 1.25;
        runtime.update();

        expect(moveOriginTo).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 1.25);
    });

    it('uses the explicit view yaw anchor directly when relative view preservation is disabled', () => {
        let seatYaw = 0.75;
        let viewYaw = 1.25;
        const moveOriginTo = vi.fn();
        const runtime = new MountRuntime({
            localPlayer: {
                teleportTo: vi.fn(),
                moveOriginTo,
                xrOrigin: {
                    position: { x: 0, y: 0, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                }
            },
            runtime: {
                input: { getMovementVector: () => ({ x: 0, y: 0 }) },
                notify: { warn: vi.fn() },
                tracking: { getState: () => ({ head: { yaw: 2.0 } }) }
            }
        } as any);

        runtime.grantLocalMount(createBinding(() => seatYaw, () => viewYaw, false));
        runtime.update();

        expect(moveOriginTo).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), viewYaw);
    });
});
