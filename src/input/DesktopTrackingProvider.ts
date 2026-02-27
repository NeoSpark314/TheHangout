import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { IHandState } from '../entities/PlayerEntity';

export class DesktopTrackingProvider implements ITrackingProvider {
    public id = 'desktop';
    private state: ITrackingState;

    // Arm stretching state
    private leftStretch = new THREE.Vector3(0, 0, 0);
    private rightStretch = new THREE.Vector3(0, 0, 0);
    private targetLeftStretch = new THREE.Vector3(0, 0, 0);
    private targetRightStretch = new THREE.Vector3(0, 0, 0);

    private leftReach = 1.0;
    private rightReach = 1.0;
    private activeHand: 'left' | 'right' | null = null;

    constructor(private context: GameContext) {
        this.state = this.createInitialState();
    }

    public init(): void {
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));
        window.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    }

    private onWheel(e: WheelEvent): void {
        if (!this.activeHand) return;

        e.preventDefault();
        const scrollDelta = -e.deltaY * 0.001;
        if (this.activeHand === 'left') {
            this.leftReach = Math.max(0.2, Math.min(4.0, this.leftReach + scrollDelta));
            this.targetLeftStretch.set(0, 0, -this.leftReach);
        } else {
            this.rightReach = Math.max(0.2, Math.min(4.0, this.rightReach + scrollDelta));
            this.targetRightStretch.set(0, 0, -this.rightReach);
        }
    }

    private createInitialState(): ITrackingState {
        return {
            head: {
                position: { x: 0, y: 1.7, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
                yaw: 0
            },
            hands: {
                left: this.createEmptyHandState(-0.4),
                right: this.createEmptyHandState(0.4)
            }
        };
    }

    private createEmptyHandState(offsetX: number): IHandState {
        const state: IHandState = {
            active: false,
            position: { x: offsetX, y: 0.8, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            joints: []
        };
        for (let i = 0; i < 25; i++) {
            state.joints.push({
                position: { x: 0, y: 0, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            });
        }
        return state;
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (e.key === '1') {
            this.activeHand = 'left';
            this.targetLeftStretch.set(0, 0, -this.leftReach); // Reach forward
            this.state.hands.left.active = true;
        }
        if (e.key === '2') {
            this.activeHand = 'right';
            this.targetRightStretch.set(0, 0, -this.rightReach); // Reach forward
            this.state.hands.right.active = true;
        }
    }

    private onKeyUp(e: KeyboardEvent): void {
        if (e.key === '1') {
            this.targetLeftStretch.set(0, 0, 0);
            this.state.hands.left.active = false;
            if (this.activeHand === 'left') this.activeHand = null;
        }
        if (e.key === '2') {
            this.targetRightStretch.set(0, 0, 0);
            this.state.hands.right.active = false;
            if (this.activeHand === 'right') this.activeHand = null;
        }
    }

    public update(delta: number): void {
        const managers = this.context.managers;
        const render = managers.render;

        if (render.isXRPresenting()) return;

        // 1. Update Head (from origin and local head state if available, but usually driven by Skill)
        // For DesktopTrackingProvider, we assume the camera pose is the source of truth for the head.
        const camPos = new THREE.Vector3();
        const camQuat = new THREE.Quaternion();
        render.camera.getWorldPosition(camPos);
        render.camera.getWorldQuaternion(camQuat);
        const euler = new THREE.Euler().setFromQuaternion(camQuat, 'YXZ');

        this.state.head = {
            position: { x: camPos.x, y: camPos.y, z: camPos.z },
            quaternion: { x: camQuat.x, y: camQuat.y, z: camQuat.z, w: camQuat.w },
            yaw: euler.y
        };

        // 2. Update Arm Stretching (Lerp for smoothness)
        const lerpSpeed = 15;
        this.leftStretch.lerp(this.targetLeftStretch, delta * lerpSpeed);
        this.rightStretch.lerp(this.targetRightStretch, delta * lerpSpeed);

        // 3. Update Hand Poses relative to head/body
        const bodyYaw = euler.y;
        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));

        // Base hand positions (Lowered Y from 1.2 to -0.4 relative to camera)
        const leftBase = new THREE.Vector3(-0.2, -0.4, -0.2).applyQuaternion(bodyQuat).add(camPos);
        const rightBase = new THREE.Vector3(0.2, -0.4, -0.2).applyQuaternion(bodyQuat).add(camPos);

        // Apply stretch in look direction (using camQuat for aiming)
        const leftTarget = leftBase.clone().add(this.leftStretch.clone().applyQuaternion(camQuat));
        const rightTarget = rightBase.clone().add(this.rightStretch.clone().applyQuaternion(camQuat));

        this.state.hands.left.position = { x: leftTarget.x, y: leftTarget.y, z: leftTarget.z };
        this.state.hands.left.quaternion = { x: camQuat.x, y: camQuat.y, z: camQuat.z, w: camQuat.w };

        this.state.hands.right.position = { x: rightTarget.x, y: rightTarget.y, z: rightTarget.z };
        this.state.hands.right.quaternion = { x: camQuat.x, y: camQuat.y, z: camQuat.z, w: camQuat.w };
    }

    public getState(): ITrackingState {
        return this.state;
    }

    public destroy(): void {
        window.removeEventListener('keydown', this.onKeyDown.bind(this));
        window.removeEventListener('keyup', this.onKeyUp.bind(this));
        window.removeEventListener('wheel', this.onWheel.bind(this));
    }
}
