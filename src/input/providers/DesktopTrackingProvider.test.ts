import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { DesktopTrackingProvider } from './DesktopTrackingProvider';
import { estimateStandingEyeHeightM } from '../../shared/avatar/AvatarMetrics';

function createTestContext(yaw = 0, playerHeightM = 1.8): AppContext {
    const context = new AppContext();
    context.avatarConfig = {
        ...context.avatarConfig,
        playerHeightM
    };
    context.setRuntime('render', {
        isXRPresenting: () => false,
        camera: new THREE.PerspectiveCamera()
    } as any);
    context.localPlayer = {
        controlMode: 'local',
        xrOrigin: {
            position: { x: 0, y: 0, z: 0 },
            quaternion: {
                x: 0,
                y: Math.sin(yaw / 2),
                z: 0,
                w: Math.cos(yaw / 2)
            }
        }
    } as any;
    return context;
}

afterEach(() => {
    eventBus.reset();
});

describe('DesktopTrackingProvider', () => {
    it('treats positive pitch intent as looking down in the raw desktop head pose', () => {
        const context = createTestContext();
        const provider = new DesktopTrackingProvider(context);
        provider.activate();

        eventBus.emit(EVENTS.INTENT_LOOK, {
            yawDeltaRad: 0,
            pitchDeltaRad: 0.25
        });
        provider.update(1 / 60);

        const quaternion = provider.getState().head.pose.quaternion;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
            new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
        );

        expect(forward.y).toBeLessThan(0);
    });

    it('treats yaw intent as local head rotation without changing the simulated root basis', () => {
        const context = createTestContext(0.35);
        const provider = new DesktopTrackingProvider(context);
        provider.activate();

        eventBus.emit(EVENTS.INTENT_LOOK, {
            yawDeltaRad: -0.4,
            pitchDeltaRad: 0
        });
        provider.update(1 / 60);

        expect(provider.getState().head.yaw).toBeCloseTo(0.75, 5);
        expect(context.localPlayer!.xrOrigin.quaternion.y).toBeCloseTo(Math.sin(0.35 / 2), 5);
    });

    it('builds avatar tracking quaternions in the canonical +Z-forward avatar basis', () => {
        const context = createTestContext(0.7);
        const provider = new DesktopTrackingProvider(context);
        provider.activate();

        eventBus.emit(EVENTS.INTENT_LOOK, {
            yawDeltaRad: 0,
            pitchDeltaRad: -0.2
        });
        provider.update(1 / 60);

        const state = provider.getState();
        const rawHead = state.head.pose.quaternion;
        const avatarHead = state.avatarTrackingFrame!.headWorldPose.quaternion;

        const rawForward = new THREE.Vector3(0, 0, -1).applyQuaternion(
            new THREE.Quaternion(rawHead.x, rawHead.y, rawHead.z, rawHead.w)
        );
        const avatarForward = new THREE.Vector3(0, 0, 1).applyQuaternion(
            new THREE.Quaternion(avatarHead.x, avatarHead.y, avatarHead.z, avatarHead.w)
        );

        expect(avatarForward.distanceTo(rawForward)).toBeLessThan(1e-6);
    });

    it('anchors desktop hands to the simulated headset frame', () => {
        const context = createTestContext();
        const provider = new DesktopTrackingProvider(context);
        provider.activate();

        provider.update(1 / 60);
        const beforeLeft = { ...provider.getState().hands.left.pose.position };
        const beforeRight = { ...provider.getState().hands.right.pose.position };

        eventBus.emit(EVENTS.INTENT_LOOK, {
            yawDeltaRad: -Math.PI / 2,
            pitchDeltaRad: 0
        });
        provider.update(1 / 60);

        const leftHand = provider.getState().hands.left.pose.position;
        const rightHand = provider.getState().hands.right.pose.position;

        expect(Math.abs(leftHand.z)).toBeGreaterThan(0.15);
        expect(Math.abs(rightHand.z)).toBeGreaterThan(0.15);
        expect(leftHand.z).toBeGreaterThan(0);
        expect(rightHand.z).toBeLessThan(0);
        expect(Math.abs(leftHand.z - beforeLeft.z)).toBeGreaterThan(0.2);
    });

    it('keeps default desktop hands level when only head pitch changes', () => {
        const context = createTestContext();
        const provider = new DesktopTrackingProvider(context);
        provider.activate();

        provider.update(1 / 60);
        const beforeLeft = { ...provider.getState().hands.left.pose.position };

        eventBus.emit(EVENTS.INTENT_LOOK, {
            yawDeltaRad: 0,
            pitchDeltaRad: -0.35
        });
        provider.update(1 / 60);

        const afterLeft = provider.getState().hands.left.pose.position;
        const handQuat = provider.getState().hands.left.pose.quaternion;
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
            new THREE.Quaternion(handQuat.x, handQuat.y, handQuat.z, handQuat.w)
        );

        expect(afterLeft.y - beforeLeft.y).toBeCloseTo(0, 5);
        expect(up.y).toBeCloseTo(1, 5);
    });

    it('uses estimated standing eye height from the configured player height', () => {
        const context = createTestContext(0, 1.6);
        const provider = new DesktopTrackingProvider(context);

        provider.update(1 / 60);

        expect(provider.getState().head.pose.position.y).toBeCloseTo(estimateStandingEyeHeightM(1.6));
    });
});
