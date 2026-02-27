import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { IHandState } from '../entities/PlayerEntity';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

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

    private pitch = 0;
    private turnSpeed = 0.002;
    private headHeight = 1.7;

    private _lookHandler = (payload: any) => {
        // We only care about Y (pitch) here. 
        // Horizontal look (yaw) is handled by MovementSkill rotating the origin.
        if (this.context.managers.render.isXRPresenting()) return;
        this.pitch -= payload.delta.y * this.turnSpeed * 15;
        this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
    };

    private _boundKeyDown = this.onKeyDown.bind(this);
    private _boundKeyUp = this.onKeyUp.bind(this);
    private _boundWheel = this.onWheel.bind(this);

    constructor(private context: GameContext) {
        this.state = this.createInitialState();
    }

    public init(): void { }

    public activate(): void {
        window.addEventListener('keydown', this._boundKeyDown);
        window.addEventListener('keyup', this._boundKeyUp);
        window.addEventListener('wheel', this._boundWheel, { passive: false });

        eventBus.on(EVENTS.INTENT_LOOK, this._lookHandler);
    }

    public deactivate(): void {
        window.removeEventListener('keydown', this._boundKeyDown);
        window.removeEventListener('keyup', this._boundKeyUp);
        window.removeEventListener('wheel', this._boundWheel);

        eventBus.off(EVENTS.INTENT_LOOK, this._lookHandler);

        // Reset all hand states and stretches
        this.activeHand = null;
        this.targetLeftStretch.set(0, 0, 0);
        this.targetRightStretch.set(0, 0, 0);
        this.leftStretch.set(0, 0, 0);
        this.rightStretch.set(0, 0, 0);
        this.state.hands.left.active = false;
        this.state.hands.right.active = false;
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
            hasJoints: false,
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

        const rawLp = this.context.localPlayer;
        if (!rawLp || rawLp.type !== 'LOCAL_PLAYER') return;
        const lp = rawLp as any; // Cast to access LocalPlayer properties (xrOrigin)

        // 1. Source of Truth: Origin and Orientation
        const originPos = new THREE.Vector3(lp.xrOrigin.position.x, lp.xrOrigin.position.y, lp.xrOrigin.position.z);
        const originQuat = new THREE.Quaternion(lp.xrOrigin.quaternion.x, lp.xrOrigin.quaternion.y, lp.xrOrigin.quaternion.z, lp.xrOrigin.quaternion.w);

        // Calculate Head-Local Pose (height + pitch)
        const localHeadPos = new THREE.Vector3(0, this.headHeight, 0);
        const localHeadQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, 0, 0, 'YXZ'));

        // Combine to World Space
        const worldHeadPos = localHeadPos.clone().applyQuaternion(originQuat).add(originPos);
        const worldHeadQuat = originQuat.clone().multiply(localHeadQuat);

        this.state.head = {
            position: { x: worldHeadPos.x, y: worldHeadPos.y, z: worldHeadPos.z },
            quaternion: { x: worldHeadQuat.x, y: worldHeadQuat.y, z: worldHeadQuat.z, w: worldHeadQuat.w },
            yaw: new THREE.Euler().setFromQuaternion(worldHeadQuat, 'YXZ').y
        };

        // 2. Update Arm Stretching (Lerp for smoothness)
        const lerpSpeed = 15;
        this.leftStretch.lerp(this.targetLeftStretch, delta * lerpSpeed);
        this.rightStretch.lerp(this.targetRightStretch, delta * lerpSpeed);

        // 3. Update Hand Poses relative to physical body (Origin)
        // Base hand positions (Lowered Y relative to head-local)
        // Note: we apply origin rotation to these offsets
        const leftBaseOffset = new THREE.Vector3(-0.2, this.headHeight - 0.5, -0.2);
        const rightBaseOffset = new THREE.Vector3(0.2, this.headHeight - 0.5, -0.2);

        const leftBaseWorld = leftBaseOffset.clone().applyQuaternion(originQuat).add(originPos);
        const rightBaseWorld = rightBaseOffset.clone().applyQuaternion(originQuat).add(originPos);

        // Apply stretch in the direction the HEAD is looking (worldHeadQuat)
        const leftTargetWorld = leftBaseWorld.clone().add(this.leftStretch.clone().applyQuaternion(worldHeadQuat));
        const rightTargetWorld = rightBaseWorld.clone().add(this.rightStretch.clone().applyQuaternion(worldHeadQuat));

        this.state.hands.left.position = { x: leftTargetWorld.x, y: leftTargetWorld.y, z: leftTargetWorld.z };
        this.state.hands.left.quaternion = { x: worldHeadQuat.x, y: worldHeadQuat.y, z: worldHeadQuat.z, w: worldHeadQuat.w };
        this.state.hands.left.joints.forEach(j => {
            j.position = { ...this.state.hands.left.position };
            j.quaternion = { ...this.state.hands.left.quaternion };
        });

        this.state.hands.right.position = { x: rightTargetWorld.x, y: rightTargetWorld.y, z: rightTargetWorld.z };
        this.state.hands.right.quaternion = { x: worldHeadQuat.x, y: worldHeadQuat.y, z: worldHeadQuat.z, w: worldHeadQuat.w };
        this.state.hands.right.joints.forEach(j => {
            j.position = { ...this.state.hands.right.position };
            j.quaternion = { ...this.state.hands.right.quaternion };
        });
    }

    public getState(): ITrackingState {
        return this.state;
    }

    public destroy(): void {
        this.deactivate();
    }
}
