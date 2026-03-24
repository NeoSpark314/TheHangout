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
    it('preserves the aligned local head yaw baseline while the mount turns', () => {
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
                tracking: {
                    getState: () => ({
                        head: {
                            localPose: {
                                position: { x: 0.15, y: 1.7, z: 0.35 },
                                quaternion: {
                                    x: 0,
                                    y: Math.sin(0.2 / 2),
                                    z: 0,
                                    w: Math.cos(0.2 / 2)
                                }
                            }
                        }
                    })
                }
            }
        } as any);

        runtime.grantLocalMount(createBinding(() => seatYaw, () => viewYaw));
        expect(teleportTo).toHaveBeenCalledWith(expect.any(THREE.Vector3), 1.0, { targetSpace: 'head' });

        seatYaw = 1.4;
        viewYaw = 1.4;
        runtime.update();

        const movedPosition = moveOriginTo.mock.calls.at(-1)?.[0] as THREE.Vector3;
        const movedYaw = moveOriginTo.mock.calls.at(-1)?.[1] as number;
        const expectedPosition = new THREE.Vector3(1, 2, 3).sub(
            new THREE.Vector3(0.15, 1.7, 0.35).applyAxisAngle(THREE.Object3D.DEFAULT_UP, 1.2)
        );

        expect(movedYaw).toBeCloseTo(1.2, 5);
        expect(movedPosition.x).toBeCloseTo(expectedPosition.x, 5);
        expect(movedPosition.y).toBeCloseTo(expectedPosition.y, 5);
        expect(movedPosition.z).toBeCloseTo(expectedPosition.z, 5);
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
                tracking: {
                    getState: () => ({
                        head: {
                            localPose: {
                                position: { x: 0, y: 1.7, z: 0 },
                                quaternion: { x: 0, y: 0, z: 0, w: 1 }
                            }
                        }
                    })
                }
            }
        } as any);

        runtime.grantLocalMount(createBinding(() => seatYaw, () => viewYaw));
        runtime.update();

        expect(moveOriginTo).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), viewYaw);
    });
});
