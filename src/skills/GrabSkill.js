// skills/GrabSkill.js

import * as THREE from 'three';
import { Skill } from './Skill.js';
import gameState from '../core/GameState.js';

/**
 * VR near-grab skill. Detects grabbable objects within reach of either hand,
 * highlights them, and allows grabbing/throwing via the squeeze button.
 * 
 * Architecture ready for distant grab (raycasting) extension later.
 */
export class GrabSkill extends Skill {
    constructor() {
        super('grab', 'Grab', { alwaysActive: false });

        this.grabRadius = 0.3; // Near-grab sphere radius in meters

        // Per-hand state
        this.held = { left: null, right: null };  // PhysicsEntity or null
        this.wasSqueezing = { left: false, right: false };

        // For throw velocity: ring buffer of last N hand world positions
        this.velocityBufferSize = 5;
        this.positionHistory = {
            left: [],
            right: []
        };

        // Currently highlighted entity
        this.highlightedEntity = null;
    }

    activate(player) {
        super.activate(player);
    }

    deactivate(player) {
        // Release any held objects
        this._releaseHand('left');
        this._releaseHand('right');
        this._clearHighlight();
        super.deactivate(player);
    }

    update(delta, player) {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.isPresenting) return;

        const session = render.renderer.xr.getSession();
        if (!session) return;

        const frame = render.renderer.xr.getFrame();
        const referenceSpace = render.renderer.xr.getReferenceSpace();
        if (!frame || !referenceSpace) return;

        // Get all grabbable entities
        const grabbables = this._getGrabbables();

        // Track nearest unheld grabbable for highlighting
        let nearestEntity = null;
        let nearestDist = this.grabRadius;

        for (const source of session.inputSources) {
            if (!source.gripSpace) continue;
            const hand = source.handedness; // 'left' or 'right'
            if (hand !== 'left' && hand !== 'right') continue;

            const pose = frame.getPose(source.gripSpace, referenceSpace);
            if (!pose) continue;

            // Compute hand world position
            const handLocalPos = new THREE.Vector3(
                pose.transform.position.x,
                pose.transform.position.y,
                pose.transform.position.z
            );
            const handWorldPos = handLocalPos.clone().applyMatrix4(render.cameraGroup.matrixWorld);

            const handLocalQuat = new THREE.Quaternion(
                pose.transform.orientation.x,
                pose.transform.orientation.y,
                pose.transform.orientation.z,
                pose.transform.orientation.w
            );
            const cameraGroupQuat = new THREE.Quaternion();
            render.cameraGroup.getWorldQuaternion(cameraGroupQuat);
            const handWorldQuat = cameraGroupQuat.multiply(handLocalQuat);

            // Record position for velocity tracking
            this.positionHistory[hand].push({
                pos: handWorldPos.clone(),
                time: performance.now()
            });
            if (this.positionHistory[hand].length > this.velocityBufferSize) {
                this.positionHistory[hand].shift();
            }

            // Detect squeeze state
            const squeezing = this._isSqueezing(source);

            if (this.held[hand]) {
                // Currently holding something
                if (!squeezing && this.wasSqueezing[hand]) {
                    // Released! Throw it
                    const velocity = this._computeThrowVelocity(hand);
                    this.held[hand].release(velocity);
                    this.held[hand] = null;
                } else {
                    // Update held object position to follow hand
                    this.held[hand].rigidBody.setNextKinematicTranslation(
                        { x: handWorldPos.x, y: handWorldPos.y, z: handWorldPos.z }
                    );
                    this.held[hand].rigidBody.setNextKinematicRotation(
                        { x: handWorldQuat.x, y: handWorldQuat.y, z: handWorldQuat.z, w: handWorldQuat.w }
                    );
                }
            } else {
                // Not holding — check for nearby grabbable
                if (squeezing && !this.wasSqueezing[hand]) {
                    // Squeeze just started — try to grab nearest
                    const nearest = this._findNearest(grabbables, handWorldPos);
                    if (nearest) {
                        nearest.grab(player.id);
                        this.held[hand] = nearest;
                    }
                }

                // Track nearest for highlighting (even when not squeezing)
                for (const entity of grabbables) {
                    if (entity.heldBy) continue; // Skip held objects
                    const entPos = entity.mesh.position;
                    const dist = handWorldPos.distanceTo(entPos);
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        nearestEntity = entity;
                    }
                }
            }

            this.wasSqueezing[hand] = squeezing;
        }

        // Update highlight
        if (this.highlightedEntity !== nearestEntity) {
            this._clearHighlight();
            if (nearestEntity) {
                nearestEntity.setHighlight(true);
                this.highlightedEntity = nearestEntity;
            }
        }
    }

    // --- Private helpers ---

    _getGrabbables() {
        const entityManager = gameState.managers.entity;
        if (!entityManager) return [];

        const result = [];
        for (const entity of entityManager.entities.values()) {
            if (entity.grabbable && !entity.destroyed) {
                result.push(entity);
            }
        }
        return result;
    }

    _findNearest(grabbables, handWorldPos) {
        let nearest = null;
        let nearestDist = this.grabRadius;

        for (const entity of grabbables) {
            if (entity.heldBy) continue; // Already held by someone
            const dist = handWorldPos.distanceTo(entity.mesh.position);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = entity;
            }
        }
        return nearest;
    }

    _isSqueezing(source) {
        if (!source.gamepad) return false;
        // Squeeze/grip is typically button index 1
        return source.gamepad.buttons.length > 1 && source.gamepad.buttons[1].pressed;
    }

    _computeThrowVelocity(hand) {
        const history = this.positionHistory[hand];
        if (history.length < 2) return new THREE.Vector3(0, 0, 0);

        const oldest = history[0];
        const newest = history[history.length - 1];
        const dt = (newest.time - oldest.time) / 1000; // seconds

        if (dt < 0.001) return new THREE.Vector3(0, 0, 0);

        const velocity = new THREE.Vector3()
            .subVectors(newest.pos, oldest.pos)
            .divideScalar(dt);

        // Cap throw speed to prevent extreme launches
        const maxSpeed = 15;
        if (velocity.length() > maxSpeed) {
            velocity.normalize().multiplyScalar(maxSpeed);
        }

        return velocity;
    }

    _releaseHand(hand) {
        if (this.held[hand]) {
            this.held[hand].release(new THREE.Vector3(0, 0, 0));
            this.held[hand] = null;
        }
    }

    _clearHighlight() {
        if (this.highlightedEntity) {
            this.highlightedEntity.setHighlight(false);
            this.highlightedEntity = null;
        }
    }

    destroy() {
        this._releaseHand('left');
        this._releaseHand('right');
        this._clearHighlight();
    }
}
