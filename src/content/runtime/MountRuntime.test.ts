import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ILocalMountBinding } from '../contracts/IMounting';
import { MountRuntime } from './MountRuntime';

function createBinding(
    getSeatYaw: () => number,
    getViewYaw: () => number
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
        })
    };
}

describe('MountRuntime', () => {
    it('uses the view yaw anchor while the mount turns', () => {
        let seatYaw = 1.0;
        let viewYaw = 1.0;
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
                tracking: { getState: () => ({ head: { yaw: 0 } }) }
            }
        } as any);

        runtime.grantLocalMount(createBinding(() => seatYaw, () => viewYaw));
        expect(teleportTo).toHaveBeenCalledWith(expect.any(THREE.Vector3), 1.0, { targetSpace: 'player' });

        seatYaw = 1.4;
        viewYaw = 1.4;
        runtime.update();

        expect(moveOriginTo).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 1.4);
    });

    it('uses the explicit view yaw anchor directly', () => {
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

        runtime.grantLocalMount(createBinding(() => seatYaw, () => viewYaw));
        runtime.update();

        expect(moveOriginTo).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), viewYaw);
    });
});
