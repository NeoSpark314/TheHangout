import * as THREE from 'three';
import { Skill } from './Skill';
import { PlayerAvatarEntity } from '../world/entities/PlayerAvatarEntity';
import { IInteractable } from '../shared/contracts/IInteractable';
import { IHoldable } from '../shared/contracts/IHoldable';
import { isHoldable, isInteractable, isMovableHoldable } from '../shared/utils/TypeGuards';
import type { IRuntimeRegistry } from '../app/AppContext';
import type { IEntity } from '../shared/contracts/IEntity';
import eventBus from '../app/events/EventBus';
import { EVENTS } from '../shared/constants/Constants';
import { IHandIntentPayload } from '../shared/contracts/IIntents';

type HandId = 'left' | 'right';

interface IHeldHandState {
    objectKey: string;
    entity: IHoldable;
    offsetPos: THREE.Vector3;
    offsetQuat: THREE.Quaternion;
    movable: boolean;
    holdPose: THREE.Object3D | null;
    releaseDistance: number;
}

interface IObjectHoldState {
    entity: IHoldable;
    movable: boolean;
    primaryHand: HandId;
    secondaryHand: HandId | null;
    dualOffsetPos: THREE.Vector3 | null;
    dualOffsetQuat: THREE.Quaternion | null;
    dualBaseDistance: number;
    dualBaseScale: number;
}

type IDualGrabScalable = IHoldable & {
    supportsDualGrabScale?: () => boolean;
    getUniformScale?: () => number;
    setUniformScale?: (scale: number) => void;
    getDualGrabScaleLimits?: () => { min: number; max: number };
};

/**
 * Unified skill for picking up and interacting with objects.
 * Works purely on logical handStates (no pointer checks required).
 */
export class GrabSkill extends Skill {
    private grabRadius: number = 0.05;
    private fixedHoldReleaseDistance = 0.22;
    private vrThrowVelocityMultiplier = 2.0;

    private heldObjects: Map<HandId, IHeldHandState> = new Map();
    private objectHolds: Map<string, IObjectHoldState> = new Map();
    private history: Map<HandId, { pos: THREE.Vector3, time: number }[]> = new Map();
    private highlightedEntities: { left: IInteractable | null, right: IInteractable | null } = { left: null, right: null };
    private objectKeys = new WeakMap<object, string>();
    private nextObjectKey = 1;

    private _handlers: Array<{ event: string, handler: any }> = [];

    constructor() {
        super('grab', 'Grab', { isAlwaysActive: true });
    }

    public activate(player: PlayerAvatarEntity): void {
        super.activate(player);

        const onGrabStart = (payload: IHandIntentPayload) => {
            const hand = payload.hand as HandId;
            if (this.heldObjects.has(hand)) return;

            const handState = player.appContext.runtime.tracking.getState().hands[hand];
            let nearest = this.highlightedEntities[hand];
            let nearestContactPoint: THREE.Vector3 | null = null;

            if (handState.active) {
                const pos = handState.pointerPose.position || handState.pose.position;
                const queryPos = new THREE.Vector3(pos.x, pos.y, pos.z);
                const currentNearest = player.appContext.runtime.interaction.findNearestInteractable(queryPos, this.grabRadius);
                nearest = currentNearest?.interactable || null;
                nearestContactPoint = currentNearest?.contactPoint || null;
            }

            if (!isHoldable(nearest)) return;

            const objectKey = this._getObjectKey(nearest);
            const existing = this.objectHolds.get(objectKey);
            const alreadyHeldByLocal = !!existing;
            if (nearest.heldBy && !alreadyHeldByLocal) return;

            const offsetPos = new THREE.Vector3();
            const offsetQuat = new THREE.Quaternion();
            const movable = isMovableHoldable(nearest);
            const handPose = movable ? this._getMovableHandPose(handState) : this._getPointerPreferredHandPose(handState);
            const handPos = handPose.position;
            const handQuat = handPose.quaternion;
            const handTransform = new THREE.Matrix4().compose(handPos, handQuat, new THREE.Vector3(1, 1, 1));
            const mesh = this._getEntityMesh(nearest);

            if (mesh && movable) {
                mesh.updateMatrixWorld(true);
                const objPos = new THREE.Vector3();
                const objQuat = new THREE.Quaternion();
                mesh.getWorldPosition(objPos);
                mesh.getWorldQuaternion(objQuat);

                const objTransform = new THREE.Matrix4().compose(objPos, objQuat, new THREE.Vector3(1, 1, 1));
                const offsetTransform = handTransform.clone().invert().multiply(objTransform);
                offsetTransform.decompose(offsetPos, offsetQuat, new THREE.Vector3());
            }

            let holdPose: THREE.Object3D | null = null;
            let releaseDistance = this.fixedHoldReleaseDistance;
            if (!movable) {
                holdPose = new THREE.Object3D();
                const holdPosition = nearestContactPoint || handPos;
                holdPose.position.copy(holdPosition);
                holdPose.quaternion.copy(handQuat);

                const customReleaseDistance = nearest.getHoldReleaseDistance?.();
                if (typeof customReleaseDistance === 'number' && Number.isFinite(customReleaseDistance)) {
                    releaseDistance = Math.max(0.05, customReleaseDistance);
                }
            }

            if (!existing) {
                nearest.onGrab(player.id, hand);
                this.objectHolds.set(objectKey, {
                    entity: nearest,
                    movable,
                    primaryHand: hand,
                    secondaryHand: null,
                    dualOffsetPos: null,
                    dualOffsetQuat: null,
                    dualBaseDistance: 0,
                    dualBaseScale: 1
                });
            } else {
                if (!existing.movable || !movable) return;
                if (existing.secondaryHand) return;
                if (existing.primaryHand === hand) return;
                existing.secondaryHand = hand;
                this._initializeDualGrab(existing, player.appContext.runtime);
            }

            this.heldObjects.set(hand, {
                objectKey,
                entity: nearest,
                offsetPos,
                offsetQuat,
                movable,
                holdPose,
                releaseDistance
            });

            if (movable) {
                this.history.set(hand, []);
            } else {
                this.history.delete(hand);
            }
        };

        const onGrabEnd = (payload: IHandIntentPayload) => {
            const hand = payload.hand as HandId;
            const held = this.heldObjects.get(hand);
            if (!held) return;

            const objectHold = this.objectHolds.get(held.objectKey);
            if (!objectHold) {
                const velocity = held.movable ? this._computeThrowVelocity(hand).multiplyScalar(this._getThrowVelocityMultiplier(player.appContext.runtime)) : undefined;
                held.entity.onRelease(velocity);
                this.heldObjects.delete(hand);
                this.history.delete(hand);
                return;
            }

            if (objectHold.secondaryHand === hand) {
                objectHold.secondaryHand = null;
                objectHold.dualOffsetPos = null;
                objectHold.dualOffsetQuat = null;
                const remaining = this.heldObjects.get(objectHold.primaryHand);
                if (remaining) {
                    this._refreshSingleHandOffsetFromCurrentPose(objectHold.primaryHand, remaining, player.appContext.runtime);
                }
                this.heldObjects.delete(hand);
                this.history.delete(hand);
                return;
            }

            if (objectHold.primaryHand === hand && objectHold.secondaryHand) {
                const nextPrimary = objectHold.secondaryHand;
                objectHold.primaryHand = nextPrimary;
                objectHold.secondaryHand = null;
                objectHold.dualOffsetPos = null;
                objectHold.dualOffsetQuat = null;
                const promoted = this.heldObjects.get(nextPrimary);
                if (promoted) {
                    this._refreshSingleHandOffsetFromCurrentPose(nextPrimary, promoted, player.appContext.runtime);
                }
                this.heldObjects.delete(hand);
                this.history.delete(hand);
                return;
            }

            const velocity = held.movable ? this._computeThrowVelocity(hand).multiplyScalar(this._getThrowVelocityMultiplier(player.appContext.runtime)) : undefined;
            objectHold.entity.onRelease(velocity);
            this.objectHolds.delete(held.objectKey);
            this.heldObjects.delete(hand);
            this.history.delete(hand);
        };

        const onInteractStart = (payload: IHandIntentPayload) => {
            const held = this.heldObjects.get(payload.hand as HandId);
            if (held && isInteractable(held.entity)) {
                held.entity.onInteraction({
                    type: 'trigger',
                    phase: 'start',
                    value: payload.value || 1.0,
                    playerId: player.id,
                    hand: payload.hand
                });
            }
        };

        const onInteractEnd = (payload: IHandIntentPayload) => {
            const held = this.heldObjects.get(payload.hand as HandId);
            if (held && isInteractable(held.entity)) {
                held.entity.onInteraction({
                    type: 'trigger',
                    phase: 'end',
                    value: 0.0,
                    playerId: player.id,
                    hand: payload.hand
                });
            }
        };

        eventBus.on(EVENTS.INTENT_GRAB_START, onGrabStart);
        eventBus.on(EVENTS.INTENT_GRAB_END, onGrabEnd);
        eventBus.on(EVENTS.INTENT_INTERACT_START, onInteractStart);
        eventBus.on(EVENTS.INTENT_INTERACT_END, onInteractEnd);

        this._handlers.push({ event: EVENTS.INTENT_GRAB_START, handler: onGrabStart });
        this._handlers.push({ event: EVENTS.INTENT_GRAB_END, handler: onGrabEnd });
        this._handlers.push({ event: EVENTS.INTENT_INTERACT_START, handler: onInteractStart });
        this._handlers.push({ event: EVENTS.INTENT_INTERACT_END, handler: onInteractEnd });
    }

    public deactivate(player: PlayerAvatarEntity): void {
        super.deactivate(player);
        const released = new Set<string>();
        for (const [hand, held] of this.heldObjects.entries()) {
            if (released.has(held.objectKey)) {
                this.heldObjects.delete(hand);
                continue;
            }
            held.entity.onRelease();
            released.add(held.objectKey);
        }
        for (const { event, handler } of this._handlers) {
            eventBus.off(event, handler);
        }
        this._handlers = [];
        this.heldObjects.clear();
        this.objectHolds.clear();
        this.history.clear();
        this._updateHighlight(player.id, 'left', null, player.appContext.runtime);
        this._updateHighlight(player.id, 'right', null, player.appContext.runtime);
    }

    public update(delta: number, player: PlayerAvatarEntity, runtime: IRuntimeRegistry): void {
        const trackingHands = runtime.tracking.getState().hands;
        const processedObjects = new Set<string>();

        for (const hand of ['left', 'right'] as const) {
            const handState = trackingHands[hand];
            const held = this.heldObjects.get(hand);

            if (held) {
                if (held.movable && isMovableHoldable(held.entity)) {
                    const objectHold = this.objectHolds.get(held.objectKey);
                    if (objectHold && !processedObjects.has(held.objectKey) && objectHold.primaryHand === hand) {
                        if (objectHold.secondaryHand) {
                            this._updateDualGrabbedPose(objectHold, runtime);
                        } else {
                            this._updateSingleGrabbedPose(hand, held, trackingHands);
                        }
                        processedObjects.add(held.objectKey);
                    }
                } else {
                    const anchor = held.holdPose;
                    if (anchor) {
                        const handJoint = hand === 'left' ? 'leftHand' : 'rightHand';
                        const worldPos = anchor.position;
                        const worldQuat = anchor.quaternion;
                        player.humanoid.setJointPose(
                            handJoint,
                            { x: worldPos.x, y: worldPos.y, z: worldPos.z },
                            { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }
                        );

                        const liveHandPos = handState.pointerPose.position || handState.pose.position;
                        const drift = Math.hypot(
                            liveHandPos.x - worldPos.x,
                            liveHandPos.y - worldPos.y,
                            liveHandPos.z - worldPos.z
                        );

                        if (drift > held.releaseDistance) {
                            held.entity.onRelease();
                            this.heldObjects.delete(hand);
                            this.history.delete(hand);
                            this.objectHolds.delete(held.objectKey);
                        }
                    }
                }

                this._updateHighlight(player.id, hand, null, runtime);
            } else {
                let result: { interactable: IInteractable, distance: number } | null = null;
                if (handState.active) {
                    const pos = handState.pointerPose.position || handState.pose.position;
                    const queryPos = new THREE.Vector3(pos.x, pos.y, pos.z);
                    result = runtime.interaction.findNearestInteractable(queryPos, this.grabRadius);
                }
                this._updateHighlight(player.id, hand, result?.interactable || null, runtime);
            }
        }
    }

    public isHoldingHand(hand: HandId): boolean {
        return this.heldObjects.has(hand);
    }

    public isHoldingInteractableHand(hand: HandId): boolean {
        const held = this.heldObjects.get(hand);
        return !!held && isInteractable(held.entity);
    }

    public getSingleInteractableHoldingHand(): HandId | null {
        const left = this.heldObjects.get('left');
        const right = this.heldObjects.get('right');

        if (left && !right && isInteractable(left.entity)) {
            return 'left';
        }

        if (right && !left && isInteractable(right.entity)) {
            return 'right';
        }

        return null;
    }

    private _updateSingleGrabbedPose(
        hand: HandId,
        held: IHeldHandState,
        trackingHands: ReturnType<IRuntimeRegistry['tracking']['getState']>['hands']
    ): void {
        const handState = trackingHands[hand];
        const handPose = this._getMovableHandPose(handState);

        const handPos = handPose.position;
        const handQuat = handPose.quaternion;
        const targetPos = new THREE.Vector3().copy(held.offsetPos).applyQuaternion(handQuat).add(handPos);
        const targetQuat = new THREE.Quaternion().copy(handQuat).multiply(held.offsetQuat);

        const movableEntity = held.entity as IHoldable & { updateGrabbedPose: (pose: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }) => void };
        movableEntity.updateGrabbedPose({
            position: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
            quaternion: { x: targetQuat.x, y: targetQuat.y, z: targetQuat.z, w: targetQuat.w }
        });

        this._recordPosition(hand, handPos);
    }

    private _refreshSingleHandOffsetFromCurrentPose(hand: HandId, held: IHeldHandState, runtime: IRuntimeRegistry): void {
        if (!held.movable) return;
        const handPose = this._readHandPose(runtime, hand);
        if (!handPose) return;
        const mesh = this._getEntityMesh(held.entity);
        if (!mesh) return;

        mesh.updateMatrixWorld(true);
        const objPos = new THREE.Vector3();
        const objQuat = new THREE.Quaternion();
        mesh.getWorldPosition(objPos);
        mesh.getWorldQuaternion(objQuat);

        const handTransform = new THREE.Matrix4().compose(handPose.position, handPose.quaternion, new THREE.Vector3(1, 1, 1));
        const objTransform = new THREE.Matrix4().compose(objPos, objQuat, new THREE.Vector3(1, 1, 1));
        const offsetTransform = handTransform.clone().invert().multiply(objTransform);
        offsetTransform.decompose(held.offsetPos, held.offsetQuat, new THREE.Vector3());
    }

    private _updateDualGrabbedPose(objectHold: IObjectHoldState, runtime: IRuntimeRegistry): void {
        if (!objectHold.secondaryHand || !isMovableHoldable(objectHold.entity)) return;

        const primaryPose = this._readHandPose(runtime, objectHold.primaryHand);
        const secondaryPose = this._readHandPose(runtime, objectHold.secondaryHand);
        if (!primaryPose || !secondaryPose) return;

        const midpoint = primaryPose.position.clone().add(secondaryPose.position).multiplyScalar(0.5);
        const frameQuat = this._computeDualFrameQuaternion(primaryPose, secondaryPose);

        const localOffsetPos = objectHold.dualOffsetPos || new THREE.Vector3();
        const localOffsetQuat = objectHold.dualOffsetQuat || new THREE.Quaternion();
        const targetPos = localOffsetPos.clone().applyQuaternion(frameQuat).add(midpoint);
        const targetQuat = frameQuat.clone().multiply(localOffsetQuat);

        const movableEntity = objectHold.entity as IHoldable & { updateGrabbedPose: (pose: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }) => void };
        movableEntity.updateGrabbedPose({
            position: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
            quaternion: { x: targetQuat.x, y: targetQuat.y, z: targetQuat.z, w: targetQuat.w }
        });

        this._applyDualGrabScale(objectHold, primaryPose.position, secondaryPose.position);
        this._recordPosition(objectHold.primaryHand, primaryPose.position);
        this._recordPosition(objectHold.secondaryHand, secondaryPose.position);
    }

    private _initializeDualGrab(objectHold: IObjectHoldState, runtime: IRuntimeRegistry): void {
        if (!objectHold.secondaryHand) return;
        const primaryPose = this._readHandPose(runtime, objectHold.primaryHand);
        const secondaryPose = this._readHandPose(runtime, objectHold.secondaryHand);
        if (!primaryPose || !secondaryPose) return;

        const mesh = this._getEntityMesh(objectHold.entity);
        if (!mesh) return;

        mesh.updateMatrixWorld(true);
        const objPos = new THREE.Vector3();
        const objQuat = new THREE.Quaternion();
        mesh.getWorldPosition(objPos);
        mesh.getWorldQuaternion(objQuat);

        const midpoint = primaryPose.position.clone().add(secondaryPose.position).multiplyScalar(0.5);
        const frameQuat = this._computeDualFrameQuaternion(primaryPose, secondaryPose);
        const frameTransform = new THREE.Matrix4().compose(midpoint, frameQuat, new THREE.Vector3(1, 1, 1));
        const objTransform = new THREE.Matrix4().compose(objPos, objQuat, new THREE.Vector3(1, 1, 1));
        const offsetTransform = frameTransform.clone().invert().multiply(objTransform);

        const offsetPos = new THREE.Vector3();
        const offsetQuat = new THREE.Quaternion();
        offsetTransform.decompose(offsetPos, offsetQuat, new THREE.Vector3());
        objectHold.dualOffsetPos = offsetPos;
        objectHold.dualOffsetQuat = offsetQuat;

        objectHold.dualBaseDistance = Math.max(0.01, primaryPose.position.distanceTo(secondaryPose.position));

        const scalable = objectHold.entity as IDualGrabScalable;
        objectHold.dualBaseScale = typeof scalable.getUniformScale === 'function'
            ? scalable.getUniformScale()
            : 1;
    }

    private _applyDualGrabScale(objectHold: IObjectHoldState, a: THREE.Vector3, b: THREE.Vector3): void {
        const scalable = objectHold.entity as IDualGrabScalable;
        if (typeof scalable.setUniformScale !== 'function' || typeof scalable.getUniformScale !== 'function') return;
        if (typeof scalable.supportsDualGrabScale === 'function' && !scalable.supportsDualGrabScale()) return;

        const baseDistance = Math.max(0.01, objectHold.dualBaseDistance);
        const currentDistance = Math.max(0.01, a.distanceTo(b));
        const rawScale = objectHold.dualBaseScale * (currentDistance / baseDistance);

        const limits = scalable.getDualGrabScaleLimits?.();
        const min = limits ? limits.min : 0.25;
        const max = limits ? limits.max : 3.0;
        const clamped = Math.max(min, Math.min(max, rawScale));
        scalable.setUniformScale(clamped);
    }

    private _readHandPose(runtime: IRuntimeRegistry, hand: HandId): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
        const handState = runtime.tracking.getState().hands[hand];
        if (!handState.active) return null;
        return this._getMovableHandPose(handState);
    }

    private _getMovableHandPose(handState: ReturnType<IRuntimeRegistry['tracking']['getState']>['hands'][HandId]): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
        const pos = handState.pose.position;
        const rot = handState.pose.quaternion;
        return {
            position: new THREE.Vector3(pos.x, pos.y, pos.z),
            quaternion: new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
        };
    }

    private _getPointerPreferredHandPose(handState: ReturnType<IRuntimeRegistry['tracking']['getState']>['hands'][HandId]): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
        const pos = handState.pointerPose.position || handState.pose.position;
        const rot = handState.pointerPose.quaternion || handState.pose.quaternion;
        return {
            position: new THREE.Vector3(pos.x, pos.y, pos.z),
            quaternion: new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
        };
    }

    private _computeDualFrameQuaternion(
        primary: { position: THREE.Vector3; quaternion: THREE.Quaternion },
        secondary: { position: THREE.Vector3; quaternion: THREE.Quaternion }
    ): THREE.Quaternion {
        const axis = secondary.position.clone().sub(primary.position);
        if (axis.lengthSq() < 1e-6) return primary.quaternion.clone();
        axis.normalize();

        const up = new THREE.Vector3(0, 1, 0)
            .applyQuaternion(primary.quaternion)
            .add(new THREE.Vector3(0, 1, 0).applyQuaternion(secondary.quaternion));
        if (up.lengthSq() < 1e-6 || Math.abs(axis.dot(up.clone().normalize())) > 0.98) {
            up.set(0, 1, 0);
            if (Math.abs(axis.dot(up)) > 0.98) {
                up.set(0, 0, 1);
            }
        }
        up.normalize();

        const right = axis.clone();
        const forward = new THREE.Vector3().crossVectors(right, up).normalize();
        const correctedUp = new THREE.Vector3().crossVectors(forward, right).normalize();
        const basis = new THREE.Matrix4().makeBasis(right, correctedUp, forward);
        return new THREE.Quaternion().setFromRotationMatrix(basis);
    }

    private _getEntityMesh(entity: IHoldable): THREE.Object3D | null {
        const e = entity as unknown as IEntity;
        return e.view?.mesh ?? e.mesh ?? null;
    }

    private _getObjectKey(entity: IHoldable): string {
        const asEntity = entity as unknown as { id?: string };
        if (typeof asEntity.id === 'string' && asEntity.id.length > 0) {
            return `id:${asEntity.id}`;
        }

        const ref = entity as unknown as object;
        let key = this.objectKeys.get(ref);
        if (!key) {
            key = `ref:${this.nextObjectKey++}`;
            this.objectKeys.set(ref, key);
        }
        return key;
    }

    private _updateHighlight(playerId: string, hand: HandId, nearest: IInteractable | null, runtime: IRuntimeRegistry): void {
        const current = this.highlightedEntities[hand];
        const hoverSourceId = `${playerId}:${hand}`;
        if (current !== nearest) {
            if (current) current.onHoverExit(hoverSourceId);
            if (nearest) {
                nearest.onHoverEnter(hoverSourceId);
                if (isHoldable(nearest)) {
                    runtime.input.pulseGrabHint(hand);
                }
            }
            this.highlightedEntities[hand] = nearest;
        }
    }

    private _recordPosition(id: HandId, pos: THREE.Vector3): void {
        if (!this.history.has(id)) this.history.set(id, []);
        const h = this.history.get(id)!;
        h.push({ pos: pos.clone(), time: performance.now() });
        if (h.length > 10) h.shift();
    }

    private _getThrowVelocityMultiplier(runtime: IRuntimeRegistry): number {
        return runtime.render?.isXRPresenting() ? this.vrThrowVelocityMultiplier : 1;
    }

    private _computeThrowVelocity(id: HandId): THREE.Vector3 {
        const h = this.history.get(id);
        if (!h || h.length < 2) return new THREE.Vector3(0, 0, 0);

        const newestTime = h[h.length - 1].time;
        const recent = h.filter((sample) => (newestTime - sample.time) <= 180);
        const samples = recent.length >= 2 ? recent : h;
        if (samples.length < 2) return new THREE.Vector3(0, 0, 0);

        const velocity = new THREE.Vector3();
        let totalWeight = 0;

        for (let i = 1; i < samples.length; i++) {
            const previous = samples[i - 1];
            const current = samples[i];
            const dt = (current.time - previous.time) / 1000;
            if (dt < 0.001) continue;

            const segmentVelocity = new THREE.Vector3()
                .subVectors(current.pos, previous.pos)
                .divideScalar(dt);
            const recencyWeight = i / (samples.length - 1);
            const weight = 0.35 + recencyWeight * recencyWeight * 1.65;
            velocity.addScaledVector(segmentVelocity, weight);
            totalWeight += weight;
        }

        if (totalWeight <= 0.0001) return new THREE.Vector3(0, 0, 0);

        velocity.divideScalar(totalWeight);
        const maxSpeed = 18;
        if (velocity.length() > maxSpeed) velocity.normalize().multiplyScalar(maxSpeed);
        return velocity;
    }
}



