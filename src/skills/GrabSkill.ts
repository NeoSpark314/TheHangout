import * as THREE from 'three';
import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { IInteractable } from '../interfaces/IInteractable';
import { IGrabbable } from '../interfaces/IGrabbable';
import { isGrabbable, isInteractable } from '../utils/TypeGuards';
import type { IManagers } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IHandIntentPayload } from '../interfaces/IIntents';

/**
 * Unified skill for picking up and interacting with objects.
 * Works purely on logical handStates (no pointer checks required).
 */
export class GrabSkill extends Skill {
    private grabRadius: number = 0.5;

    // Track held objects per hand ('left' | 'right')
    private heldObjects: Map<string, IGrabbable> = new Map();
    private history: Map<string, { pos: THREE.Vector3, time: number }[]> = new Map();
    private highlightedEntities: { left: IInteractable | null, right: IInteractable | null } = { left: null, right: null };

    private _handlers: Array<{ event: string, handler: any }> = [];

    constructor() {
        super('grab', 'Grab', { isAlwaysActive: true });
    }

    public activate(player: LocalPlayer): void {
        super.activate(player);

        const onGrabStart = (payload: IHandIntentPayload) => {
            const nearest = this.highlightedEntities[payload.hand];
            if (isGrabbable(nearest)) {
                nearest.onGrab(player.id, payload.hand);
                this.heldObjects.set(payload.hand, nearest);
                this.history.set(payload.hand, []);
            }
        };

        const onGrabEnd = (payload: IHandIntentPayload) => {
            const held = this.heldObjects.get(payload.hand);
            if (held) {
                const velocity = this._computeThrowVelocity(payload.hand);
                held.onRelease(velocity);
                this.heldObjects.delete(payload.hand);
                this.history.delete(payload.hand);
            }
        };

        const onInteractStart = (payload: IHandIntentPayload) => {
            const held = this.heldObjects.get(payload.hand);
            if (held && isInteractable(held)) {
                held.onInteraction({
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
            if (held && isInteractable(held)) {
                held.onInteraction({
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

    public update(delta: number, player: LocalPlayer, managers: IManagers): void {
        for (const hand of ['left', 'right'] as const) {
            const handState = player.handStates[hand];
            const held = this.heldObjects.get(hand);

            if (held) {
                // UPDATE HELD POSE
                const targetPos = new THREE.Vector3(handState.position.x, handState.position.y, handState.position.z);

                held.updateGrabbedPose(
                    { x: targetPos.x, y: targetPos.y, z: targetPos.z },
                    handState.quaternion
                );

                this._recordPosition(hand, targetPos);

                // Clear highlight if we are holding something
                this._updateHighlight(player.id, hand, null);
            } else {
                let result: { interactable: IInteractable, distance: number } | null = null;
                const targetPos = new THREE.Vector3(handState.position.x, handState.position.y, handState.position.z);

                // Unified logic: only use proximity check if the hand is active (extended/tracked)
                if (handState.active) {
                    result = managers.interaction.findNearestInteractable(targetPos, this.grabRadius);
                }

                this._updateHighlight(player.id, hand, result?.interactable || null);
            }
        }
    }

    private _updateHighlight(playerId: string, hand: 'left' | 'right', nearest: IInteractable | null): void {
        const current = this.highlightedEntities[hand];
        if (current !== nearest) {
            if (current) current.onHoverExit(playerId);
            if (nearest) nearest.onHoverEnter(playerId);
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
