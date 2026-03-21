import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { DesktopTrackingProvider } from './DesktopTrackingProvider';

function createTestContext(yaw = 0): AppContext {
    const context = new AppContext();
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

    it('builds avatar tracking quaternions in the canonical avatar basis', () => {
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
});
