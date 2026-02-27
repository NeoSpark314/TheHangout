import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { IHandState, PlayerEntity } from '../entities/PlayerEntity';
import { LocalPlayer } from '../entities/LocalPlayer';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

const LERP_SPEED = 15;
const TURN_SENSITIVITY = 15;
const MIN_REACH = 0.2;
const MAX_REACH = 4.0;
const HAND_Y_OFFSET = 0.5;
const HAND_Z_OFFSET = -0.2;
const HAND_X_SPACING = 0.2;

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

    /** The most recently activated hand that is still held down. Used for reach adjustment. */
    private prioritizedHand: 'left' | 'right' | null = null;

    private pitch = 0;
    private turnSpeed = 0.002;
    private headHeight = PlayerEntity.DEFAULT_HEAD_HEIGHT;

    private _lookHandler = (payload: any) => {
        // We only care about Y (pitch) here. 
        // Horizontal look (yaw) is handled by MovementSkill rotating the origin.
        if (this.context.managers.render.isXRPresenting()) return;
        this.pitch -= payload.delta.y * this.turnSpeed * TURN_SENSITIVITY;
        this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
    };

    constructor(private context: GameContext) {
        this.state = this.createInitialState();
    }

    public init(): void { }

    public activate(): void {
        eventBus.on(EVENTS.INTENT_LOOK, this._lookHandler);
    }

    public deactivate(): void {
        eventBus.off(EVENTS.INTENT_LOOK, this._lookHandler);

        // Reset all hand states and stretches
        this.prioritizedHand = null;
        this.targetLeftStretch.set(0, 0, 0);
        this.targetRightStretch.set(0, 0, 0);
        this.leftStretch.set(0, 0, 0);
        this.rightStretch.set(0, 0, 0);
        this.state.hands.left.active = false;
        this.state.hands.right.active = false;
    }

    public setHandActive(hand: 'left' | 'right', active: boolean): void {
        const handState = this.state.hands[hand];
        if (active) {
            if (!handState.active) {
                // Newly activated hand becomes the prioritized one for scrolling
                this.prioritizedHand = hand;
                handState.active = true;
                this.updateHandTarget(hand);
            }
        } else {
            if (handState.active) {
                handState.active = false;
                if (hand === 'left') this.targetLeftStretch.set(0, 0, 0);
                else this.targetRightStretch.set(0, 0, 0);

                // If we released the prioritized hand, fall back to the other active hand if it exists
                if (this.prioritizedHand === hand) {
                    const otherHand = hand === 'left' ? 'right' : 'left';
                    this.prioritizedHand = this.state.hands[otherHand].active ? otherHand : null;
                }
            }
        }
    }

    private updateHandTarget(hand: 'left' | 'right'): void {
        const reach = hand === 'left' ? this.leftReach : this.rightReach;
        if (hand === 'left') this.targetLeftStretch.set(0, 0, -reach);
        else this.targetRightStretch.set(0, 0, -reach);
    }

    public adjustReach(delta: number): void {
        const hand = this.prioritizedHand;
        if (!hand) return;

        if (hand === 'left') {
            this.leftReach = Math.max(MIN_REACH, Math.min(MAX_REACH, this.leftReach + delta));
            this.updateHandTarget('left');
        } else {
            this.rightReach = Math.max(MIN_REACH, Math.min(MAX_REACH, this.rightReach + delta));
            this.updateHandTarget('right');
        }
    }

    private createInitialState(): ITrackingState {
        return {
            head: {
                position: { x: 0, y: this.headHeight, z: 0 },
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

    public update(delta: number): void {
        const managers = this.context.managers;
        const render = managers.render;

        if (render.isXRPresenting()) return;

        const lp = this.context.localPlayer as LocalPlayer;
        if (!lp || lp.type !== 'LOCAL_PLAYER') return;

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
        this.leftStretch.lerp(this.targetLeftStretch, delta * LERP_SPEED);
        this.rightStretch.lerp(this.targetRightStretch, delta * LERP_SPEED);

        // 3. Update Hand Poses relative to physical body (Origin)
        // Base hand positions (Lowered Y relative to head-local)
        // Note: we apply origin rotation to these offsets
        const leftBaseOffset = new THREE.Vector3(-HAND_X_SPACING, this.headHeight - HAND_Y_OFFSET, HAND_Z_OFFSET);
        const rightBaseOffset = new THREE.Vector3(HAND_X_SPACING, this.headHeight - HAND_Y_OFFSET, HAND_Z_OFFSET);

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
