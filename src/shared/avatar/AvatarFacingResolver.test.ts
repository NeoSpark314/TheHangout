import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AvatarFacingResolver } from './AvatarFacingResolver';
import { IAvatarMotionContext, IAvatarTrackingFrame } from './AvatarSkeleton';

function quaternionFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
}

function createFrame(headYaw: number, rootYaw = 0): IAvatarTrackingFrame {
    return {
        rootWorldPosition: { x: 0, y: 0, z: 0 },
        rootWorldQuaternion: quaternionFromYaw(rootYaw),
        headWorldPose: {
            position: { x: 0, y: 1.68, z: 0 },
            quaternion: quaternionFromYaw(headYaw)
        },
        effectors: {},
        tracked: { head: true },
        seated: false
    };
}

function createContext(mode: IAvatarMotionContext['mode'], overrides: Partial<IAvatarMotionContext> = {}): IAvatarMotionContext {
    return {
        mode,
        locomotionWorldVelocity: { x: 0, y: 0, z: 0 },
        explicitTurnDeltaYaw: 0,
        ...overrides
    };
}

describe('AvatarFacingResolver', () => {
    it('keeps the body stable for small XR idle head turns', () => {
        const resolver = new AvatarFacingResolver();
        const yaw = resolver.resolve(
            createFrame(THREE.MathUtils.degToRad(10)),
            createContext('xr-standing'),
            1 / 60
        );

        expect(yaw).toBeCloseTo(0, 4);
    });

    it('rotates toward locomotion direction when XR movement has a forward component', () => {
        const resolver = new AvatarFacingResolver();
        let yaw = 0;
        for (let i = 0; i < 12; i += 1) {
            yaw = resolver.resolve(
                createFrame(0),
                createContext('xr-standing', {
                    locomotionWorldVelocity: { x: 1, y: 0, z: 1 }
                }),
                1 / 60
            );
        }

        expect(yaw).toBeGreaterThan(0.5);
    });

    it('does not turn the body for pure XR strafing', () => {
        const resolver = new AvatarFacingResolver();
        let yaw = 0;
        for (let i = 0; i < 12; i += 1) {
            yaw = resolver.resolve(
                createFrame(0),
                createContext('xr-standing', {
                    locomotionWorldVelocity: { x: 1, y: 0, z: 0 }
                }),
                1 / 60
            );
        }

        expect(yaw).toBeCloseTo(0, 4);
    });

    it('does not turn the body when XR locomotion is backward relative to view', () => {
        const resolver = new AvatarFacingResolver();
        let yaw = 0;
        for (let i = 0; i < 12; i += 1) {
            yaw = resolver.resolve(
                createFrame(0),
                createContext('xr-standing', {
                    locomotionWorldVelocity: { x: 0, y: 0, z: -1 }
                }),
                1 / 60
            );
        }

        expect(yaw).toBeCloseTo(0, 4);
    });

    it('anchors seated XR body yaw to the seat', () => {
        const resolver = new AvatarFacingResolver();
        const seatYaw = THREE.MathUtils.degToRad(90);
        const yaw = resolver.resolve(
            createFrame(0),
            createContext('xr-seated', { seatWorldYaw: seatYaw }),
            1 / 60
        );

        expect(yaw).toBeCloseTo(seatYaw, 4);
    });

    it('anchors mounted seated body yaw to the mount yaw', () => {
        const resolver = new AvatarFacingResolver();
        const mountYaw = THREE.MathUtils.degToRad(-45);
        const yaw = resolver.resolve(
            createFrame(THREE.MathUtils.degToRad(20)),
            createContext('mounted-seated', { mountWorldYaw: mountYaw }),
            1 / 60
        );

        expect(yaw).toBeCloseTo(mountYaw, 4);
    });
});
