import * as THREE from 'three';
import { Skill } from './Skill';
import { LocalPlayer } from '../world/entities/LocalPlayer';
import { IInteractable } from '../shared/contracts/IInteractable';
import { IGrabbable } from '../shared/contracts/IGrabbable';
import { isGrabbable, isInteractable } from '../shared/utils/TypeGuards';
import type { IRuntimeRegistry } from '../app/AppContext';
import eventBus from '../app/events/EventBus';
import { EVENTS } from '../shared/constants/Constants';
import { IHandIntentPayload } from '../shared/contracts/IIntents';

/**
 * Unified skill for picking up and interacting with objects.
 * Works purely on logical handStates (no pointer checks required).
 */
export class GrabSkill extends Skill {
    private grabRadius: number = 0.05;

    private heldObjects: Map<string, { entity: IGrabbable, offsetPos: THREE.Vector3, offsetQuat: THREE.Quaternion }> = new Map();
    private history: Map<string, { pos: THREE.Vector3, time: number }[]> = new Map();
    private highlightedEntities: { left: IInteractable | null, right: IInteractable | null } = { left: null, right: null };

    private _handlers: Array<{ event: string, handler: any }> = [];

    constructor() {
        super('grab', 'Grab', { isAlwaysActive: true });
    }

    public activate(player: LocalPlayer): void {
        super.activate(player);

        const onGrabStart = (payload: IHandIntentPayload) => {
            if (this.heldObjects.has(payload.hand)) return;
            const handState = player.context.runtime.tracking.getState().hands[payload.hand];
            let nearest = this.highlightedEntities[payload.hand];

            // Resolve the actual proximity target at grab time from the current hand pose.
            // Input intents can arrive before this frame's highlight refresh runs, so relying
            // only on the cached highlighted entity can pick a stale target from last frame.
            if (handState.active) {
                const pos = handState.pointerPose.position || handState.pose.position;
                const queryPos = new THREE.Vector3(pos.x, pos.y, pos.z);
                const currentNearest = player.context.runtime.interaction.findNearestInteractable(queryPos, this.grabRadius);
                nearest = currentNearest?.interactable || null;
            }

            if (isGrabbable(nearest)) {

                // Calculate grab offset to prevent jumping
                const pos = handState.pointerPose.position || handState.pose.position;
                const rot = handState.pointerPose.quaternion || handState.pose.quaternion;

                const handPos = new THREE.Vector3(pos.x, pos.y, pos.z);
                const handQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
                const handTransform = new THREE.Matrix4().compose(handPos, handQuat, new THREE.Vector3(1, 1, 1));

                let mesh = (nearest as any).view?.mesh;
                if (!mesh && (nearest as any).mesh) mesh = (nearest as any).mesh;

                const offsetPos = new THREE.Vector3();
                const offsetQuat = new THREE.Quaternion();

                if (mesh) {
                    mesh.updateMatrixWorld(true);
                    const objPos = new THREE.Vector3();
                    const objQuat = new THREE.Quaternion();
                    mesh.getWorldPosition(objPos);
                    mesh.getWorldQuaternion(objQuat);

                    const objTransform = new THREE.Matrix4().compose(objPos, objQuat, new THREE.Vector3(1, 1, 1));
                    const offsetTransform = handTransform.clone().invert().multiply(objTransform);

                    offsetTransform.decompose(offsetPos, offsetQuat, new THREE.Vector3());
                }

                nearest.onGrab(player.id, payload.hand);
                this.heldObjects.set(payload.hand, { entity: nearest, offsetPos, offsetQuat });
                this.history.set(payload.hand, []);
            }
        };

        const onGrabEnd = (payload: IHandIntentPayload) => {
            const held = this.heldObjects.get(payload.hand);
            if (held) {
                const velocity = this._computeThrowVelocity(payload.hand);
                held.entity.onRelease(velocity);
                this.heldObjects.delete(payload.hand);
                this.history.delete(payload.hand);
            }
        };

        const onInteractStart = (payload: IHandIntentPayload) => {
            const held = this.heldObjects.get(payload.hand);
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
            const held = this.heldObjects.get(payload.hand);
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

    public deactivate(player: LocalPlayer): void {
        super.deactivate(player);
        for (const { event, handler } of this._handlers) {
            eventBus.off(event, handler);
        }
        this._handlers = [];
        this.heldObjects.clear();
        this.history.clear();
        this._updateHighlight(player.id, 'left', null);
        this._updateHighlight(player.id, 'right', null);
    }

    public update(delta: number, player: LocalPlayer, runtime: IRuntimeRegistry): void {
        const trackingHands = runtime.tracking.getState().hands;
        for (const hand of ['left', 'right'] as const) {
            const handState = trackingHands[hand];
            const held = this.heldObjects.get(hand);

            if (held) {
                // UPDATE HELD POSE
                const pos = handState.pointerPose.position || handState.pose.position;
                const rot = handState.pointerPose.quaternion || handState.pose.quaternion;

                const handPos = new THREE.Vector3(pos.x, pos.y, pos.z);
                const handQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

                // apply offset calculation
                const targetPos = new THREE.Vector3().copy(held.offsetPos).applyQuaternion(handQuat).add(handPos);
                const targetQuat = new THREE.Quaternion().copy(handQuat).multiply(held.offsetQuat);

                held.entity.updateGrabbedPose({
                    position: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
                    quaternion: { x: targetQuat.x, y: targetQuat.y, z: targetQuat.z, w: targetQuat.w }
                });

                this._recordPosition(hand, handPos);

                // Clear highlight if we are holding something
                this._updateHighlight(player.id, hand, null);
            } else {
                let result: { interactable: IInteractable, distance: number } | null = null;
                const targetPos = new THREE.Vector3(handState.pose.position.x, handState.pose.position.y, handState.pose.position.z);

                // Unified logic: only use proximity check if the hand is active (extended/tracked)
                if (handState.active) {
                    const pos = handState.pointerPose.position || handState.pose.position;
                    const queryPos = new THREE.Vector3(pos.x, pos.y, pos.z);
                    result = runtime.interaction.findNearestInteractable(queryPos, this.grabRadius);
                }

                this._updateHighlight(player.id, hand, result?.interactable || null);
            }
        }
    }

    public isHoldingHand(hand: 'left' | 'right'): boolean {
        return this.heldObjects.has(hand);
    }

    private _updateHighlight(playerId: string, hand: 'left' | 'right', nearest: IInteractable | null): void {
        const current = this.highlightedEntities[hand];
        const hoverSourceId = `${playerId}:${hand}`;
        if (current !== nearest) {
            if (current) current.onHoverExit(hoverSourceId);
            if (nearest) nearest.onHoverEnter(hoverSourceId);
            this.highlightedEntities[hand] = nearest;
        }
    }

    private _recordPosition(id: string, pos: THREE.Vector3): void {
        if (!this.history.has(id)) this.history.set(id, []);
        const h = this.history.get(id)!;
        h.push({ pos: pos.clone(), time: performance.now() });
        if (h.length > 5) h.shift();
    }

    private _computeThrowVelocity(id: string): THREE.Vector3 {
        const h = this.history.get(id);
        if (!h || h.length < 2) return new THREE.Vector3(0, 0, 0);

        const oldest = h[0];
        const newest = h[h.length - 1];
        const dt = (newest.time - oldest.time) / 1000;
        if (dt < 0.001) return new THREE.Vector3(0, 0, 0);

        const velocity = new THREE.Vector3().subVectors(newest.pos, oldest.pos).divideScalar(dt);
        const maxSpeed = 15;
        if (velocity.length() > maxSpeed) velocity.normalize().multiplyScalar(maxSpeed);
        return velocity;
    }
}
