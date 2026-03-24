import * as THREE from 'three';
import { IAvatarMotionContext, IAvatarTrackingFrame } from './AvatarSkeleton';

const IDLE_TURN_DEADZONE = THREE.MathUtils.degToRad(25);
const IDLE_TURN_RESIDUAL = THREE.MathUtils.degToRad(10);
const IDLE_TURN_SPEED = THREE.MathUtils.degToRad(180);
const MOVE_TURN_SPEED = THREE.MathUtils.degToRad(360);
const MOVE_SPEED_THRESHOLD = 0.15;
const MOVE_ENGAGE_TIME = 0.12;
const MOVE_RELEASE_TIME = 0.15;
const MOVE_FACING_FORWARD_THRESHOLD = 0.1;

export class AvatarFacingResolver {
    private bodyWorldYaw = 0;
    private lastMoveWorldYaw = 0;
    private moveActiveSeconds = 0;
    private moveIdleSeconds = MOVE_RELEASE_TIME;
    private initialized = false;
    private readonly forward = new THREE.Vector3(0, 0, 1);
    private readonly projectedForward = new THREE.Vector3();
    private readonly projectedMove = new THREE.Vector3();

    public reset(bodyWorldYaw = 0): void {
        this.bodyWorldYaw = this.normalizeAngle(bodyWorldYaw);
        this.lastMoveWorldYaw = this.bodyWorldYaw;
        this.moveActiveSeconds = 0;
        this.moveIdleSeconds = MOVE_RELEASE_TIME;
        this.initialized = true;
    }

    public resolve(frame: IAvatarTrackingFrame, context: IAvatarMotionContext, delta: number): number {
        const rootYaw = this.yawFromQuaternion(frame.rootWorldQuaternion);
        const headYaw = this.yawFromHeadPose(frame);

        if (!this.initialized) {
            const initialYaw = (context.mode === 'xr-seated' || context.mode === 'mounted-seated')
                && typeof (context.mountWorldYaw ?? context.seatWorldYaw) === 'number'
                ? (context.mountWorldYaw ?? context.seatWorldYaw)!
                : rootYaw;
            this.reset(initialYaw);
        }

        if (context.mode === 'desktop') {
            this.bodyWorldYaw = rootYaw;
            this.lastMoveWorldYaw = rootYaw;
            return this.bodyWorldYaw;
        }

        if (context.mode === 'xr-seated' || context.mode === 'mounted-seated') {
            this.bodyWorldYaw = this.normalizeAngle(context.mountWorldYaw ?? context.seatWorldYaw ?? rootYaw);
            this.lastMoveWorldYaw = this.bodyWorldYaw;
            this.moveActiveSeconds = 0;
            this.moveIdleSeconds = MOVE_RELEASE_TIME;
            return this.bodyWorldYaw;
        }

        if (Math.abs(context.explicitTurnDeltaYaw) > 1e-5) {
            this.bodyWorldYaw = this.normalizeAngle(this.bodyWorldYaw + context.explicitTurnDeltaYaw);
            this.lastMoveWorldYaw = this.bodyWorldYaw;
        }

        this.projectedMove.set(
            context.locomotionWorldVelocity.x,
            0,
            context.locomotionWorldVelocity.z
        );
        const speed = this.projectedMove.length();
        const moveForwardDot = speed > 1e-6
            ? this.projectedMove.normalize().dot(this.projectedForward)
            : 0;

        if (speed >= MOVE_SPEED_THRESHOLD && moveForwardDot > MOVE_FACING_FORWARD_THRESHOLD) {
            this.moveActiveSeconds += Math.max(0, delta);
            this.moveIdleSeconds = 0;
            this.lastMoveWorldYaw = Math.atan2(context.locomotionWorldVelocity.x, context.locomotionWorldVelocity.z);
        } else {
            this.moveActiveSeconds = 0;
            this.moveIdleSeconds += Math.max(0, delta);
        }

        const locomotionTargetActive = this.moveActiveSeconds >= MOVE_ENGAGE_TIME || this.moveIdleSeconds < MOVE_RELEASE_TIME;
        if (locomotionTargetActive) {
            this.bodyWorldYaw = this.rotateToward(this.bodyWorldYaw, this.lastMoveWorldYaw, MOVE_TURN_SPEED * Math.max(0, delta));
            return this.bodyWorldYaw;
        }

        const headDelta = this.shortestAngle(headYaw - this.bodyWorldYaw);
        if (Math.abs(headDelta) <= IDLE_TURN_DEADZONE) {
            return this.bodyWorldYaw;
        }

        const desiredBodyYaw = this.normalizeAngle(headYaw - Math.sign(headDelta) * IDLE_TURN_RESIDUAL);
        this.bodyWorldYaw = this.rotateToward(this.bodyWorldYaw, desiredBodyYaw, IDLE_TURN_SPEED * Math.max(0, delta));
        return this.bodyWorldYaw;
    }

    private yawFromHeadPose(frame: IAvatarTrackingFrame): number {
        const headQuaternion = new THREE.Quaternion(
            frame.headWorldPose.quaternion.x,
            frame.headWorldPose.quaternion.y,
            frame.headWorldPose.quaternion.z,
            frame.headWorldPose.quaternion.w
        );
        this.projectedForward.copy(this.forward).applyQuaternion(headQuaternion);
        this.projectedForward.y = 0;
        if (this.projectedForward.lengthSq() < 1e-6) {
            return this.bodyWorldYaw;
        }
        this.projectedForward.normalize();
        return Math.atan2(this.projectedForward.x, this.projectedForward.z);
    }

    private yawFromQuaternion(quaternion: { x: number; y: number; z: number; w: number }): number {
        const quat = new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
        return euler.y;
    }

    private rotateToward(current: number, target: number, maxDelta: number): number {
        const delta = this.shortestAngle(target - current);
        const clamped = THREE.MathUtils.clamp(delta, -maxDelta, maxDelta);
        return this.normalizeAngle(current + clamped);
    }

    private shortestAngle(angle: number): number {
        return Math.atan2(Math.sin(angle), Math.cos(angle));
    }

    private normalizeAngle(angle: number): number {
        return Math.atan2(Math.sin(angle), Math.cos(angle));
    }
}
