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

    constructor(private context: GameContext) {
        this.state = this.createInitialState();
    }

    public init(): void {
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));
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
        // Simple mapping: 
        // 1 + Mouse/Scroll = Left arm stretch
        // 2 + Mouse/Scroll = Right arm stretch
        // (This is just an example, can be refined based on user preference)
        if (e.key === '1') {
            this.targetLeftStretch.set(0, 0, -1.0); // Reach forward
            this.state.hands.left.active = true;
        }
        if (e.key === '2') {
            this.targetRightStretch.set(0, 0, -1.0); // Reach forward
            this.state.hands.right.active = true;
        }
    }

    private onKeyUp(e: KeyboardEvent): void {
        if (e.key === '1') {
            this.targetLeftStretch.set(0, 0, 0);
            this.state.hands.left.active = false;
        }
        if (e.key === '2') {
            this.targetRightStretch.set(0, 0, 0);
            this.state.hands.right.active = false;
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
        const lerpSpeed = 10;
        this.leftStretch.lerp(this.targetLeftStretch, delta * lerpSpeed);
        this.rightStretch.lerp(this.targetRightStretch, delta * lerpSpeed);

        // 3. Update Hand Poses relative to head/body
        const bodyYaw = euler.y;
        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));

        // Base hand positions (relative to body)
        const leftBase = new THREE.Vector3(-0.25, 1.2, -0.2).applyQuaternion(bodyQuat).add(camPos);
        const rightBase = new THREE.Vector3(0.25, 1.2, -0.2).applyQuaternion(bodyQuat).add(camPos);

        // Apply stretch
        const leftTarget = leftBase.clone().add(this.leftStretch.clone().applyQuaternion(bodyQuat));
        const rightTarget = rightBase.clone().add(this.rightStretch.clone().applyQuaternion(bodyQuat));

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
    }
}
