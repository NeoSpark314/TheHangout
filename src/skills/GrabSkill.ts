import * as THREE from 'three';
import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { IInteractable } from '../interfaces/IInteractable';
import { IGrabbable } from '../interfaces/IGrabbable';
import { InteractionPointer } from '../interfaces/IPointer';
import { isGrabbable, isInteractable } from '../utils/TypeGuards';
import type { Managers } from '../core/GameState';

/**
 * Unified skill for picking up and interacting with objects.
 * Works for Desktop (Ray) and VR (Proximity) using the Pointer abstraction.
 */
export class GrabSkill extends Skill {
    private grabRadius: number = 0.3;
    private raycastDist: number = 2.0;
    
    // Track held objects per pointer ID
    private heldObjects: Map<string, IGrabbable> = new Map();
    private history: Map<string, { pos: THREE.Vector3, time: number }[]> = new Map();
    private highlightedEntity: IInteractable | null = null;

    constructor() {
        super('grab', 'Grab', { alwaysActive: false });
    }

    public update(delta: number, player: LocalPlayer, managers: Managers): void {
        const pointers = managers.input.getPointers(managers.render, managers.xr);
        
        let bestHighlight: IInteractable | null = null;

        for (const pointer of pointers) {
            const interactable = this.processPointer(pointer, player, managers);
            
            // Only the first pointer that finds something gets the global highlight
            if (!bestHighlight && interactable) {
                bestHighlight = interactable;
            }
        }

        this._updateHighlight(player.id, bestHighlight);
    }

    private processPointer(pointer: InteractionPointer, player: LocalPlayer, managers: Managers): IInteractable | null {
        const held = this.heldObjects.get(pointer.id);

        if (held) {
            if (!pointer.isSqueezing) {
                // RELEASE
                const velocity = this._computeThrowVelocity(pointer.id);
                held.onRelease(velocity);
                this.heldObjects.delete(pointer.id);
                this.history.delete(pointer.id);
                return null;
            } else {
                // UPDATE HELD POSE
                const targetPos = new THREE.Vector3(pointer.origin.x, pointer.origin.y, pointer.origin.z);
                if (!pointer.isProximity) {
                    // Raycast hold (Desktop): Move 1.2m in front of pointer
                    targetPos.add(new THREE.Vector3(pointer.direction.x, pointer.direction.y, pointer.direction.z).multiplyScalar(1.2));
                }

                held.updateGrabbedPose(
                    { x: targetPos.x, y: targetPos.y, z: targetPos.z },
                    pointer.quaternion || { x: 0, y: 0, z: 0, w: 1 } // Note: Need quat in IPointer if we want rotation
                );

                this._recordPosition(pointer.id, targetPos);

                // RICH INTERACTION (Trigger)
                if (pointer.triggerValue > 0.01 && isInteractable(held)) {
                    held.onInteraction({
                        type: 'trigger',
                        phase: pointer.triggerValue > 0.1 ? 'update' : 'start',
                        value: pointer.triggerValue,
                        playerId: player.id,
                        hand: pointer.hand
                    });
                }
                return isInteractable(held) ? held : null;
            }
        } else {
            // FIND NEW INTERACTABLE
            let found: IInteractable | null = null;

            if (pointer.isProximity) {
                const result = managers.interaction.findNearestInteractable(
                    new THREE.Vector3(pointer.origin.x, pointer.origin.y, pointer.origin.z),
                    this.grabRadius
                );
                found = result?.interactable || null;
            }

            if (pointer.isSqueezing && isGrabbable(found)) {
                found.onGrab(player.id, pointer.hand || 'right');
                this.heldObjects.set(pointer.id, found);
                this.history.set(pointer.id, []);
            }

            return found;
        }
    }

    private _updateHighlight(playerId: string, nearest: IInteractable | null): void {
        if (this.highlightedEntity !== nearest) {
            if (this.highlightedEntity) this.highlightedEntity.onHoverExit(playerId);
            if (nearest) nearest.onHoverEnter(playerId);
            this.highlightedEntity = nearest;
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
