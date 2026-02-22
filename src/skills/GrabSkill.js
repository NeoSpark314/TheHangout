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
        this.desktopGrabDist = 2.0; // Distant grab ray length for desktop

        // Per-hand state (VR)
        this.held = { left: null, right: null };  // PhysicsEntity or null
        this.wasSqueezing = { left: false, right: false };

        // Desktop state
        this.desktopHeld = null;
        this.raycaster = new THREE.Raycaster();

        // For throw velocity: ring buffer of last N hand world positions
        this.velocityBufferSize = 5;
        this.positionHistory = {
            left: [],
            right: [],
            desktop: []
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
        this._releaseDesktop();
        this._clearHighlight();
        super.deactivate(player);
    }

    update(delta, player) {
        const { render, input } = gameState.managers;
        if (!render || !input) return;

        if (render.isXRPresenting()) {
            this._updateXR(delta, player);
        } else {
            this._updateDesktop(delta, player);
        }
    }

    _updateDesktop(delta, player) {
        const { render, input } = gameState.managers;
        const grabbables = this._getGrabbables();

        // Raycast from camera center
        this.raycaster.setFromCamera({ x: 0, y: 0 }, render.camera);
        const ray = this.raycaster.ray;

        let nearestEntity = null;

        if (this.desktopHeld) {
            // Check if 'E' released
            if (!input.keyboard.e) {
                const velocity = this._computeThrowVelocity('desktop');
                this.desktopHeld.release(velocity);
                this.desktopHeld = null;
            } else {
                // Update held object position
                // Carry it 1.0m in front of camera
                const targetPos = ray.at(1.0, new THREE.Vector3());
                const targetRot = render.camera.quaternion;

                this.desktopHeld.rigidBody.setNextKinematicTranslation(
                    { x: targetPos.x, y: targetPos.y, z: targetPos.z }
                );
                this.desktopHeld.rigidBody.setNextKinematicRotation(
                    { x: targetRot.x, y: targetRot.y, z: targetRot.z, w: targetRot.w }
                );

                // Velocity tracking
                this._recordPosition('desktop', targetPos);
            }
        } else {
            // Find object under crosshair
            let minDistance = this.desktopGrabDist;
            for (const entity of grabbables) {
                if (entity.heldBy) continue;
                
                // Sphere-ray intersection (simplified for performance)
                // Use entity mesh for accurate bounds
                const distToRay = ray.distanceSqToPoint(entity.mesh.position);
                if (distToRay < 0.1) { // within 0.3m of center
                    const distToCam = ray.origin.distanceTo(entity.mesh.position);
                    if (distToCam < minDistance) {
                        minDistance = distToCam;
                        nearestEntity = entity;
                    }
                }
            }

            // Grab on 'E' press
            if (input.isKeyPressed('e') && nearestEntity) {
                console.log(`[GrabSkill] Desktop grab attempt on: ${nearestEntity.id}`);
                nearestEntity.requestOwnership();
                nearestEntity.grab(player.id);
                this.desktopHeld = nearestEntity;
                this.positionHistory.desktop = []; // Reset history for new grab
            }
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

    _updateXR(delta, player) {
        const { render } = gameState.managers;
        const session = render.getXRSession();
        if (!session) return;

        const frame = render.getXRFrame();
        const referenceSpace = render.getXRReferenceSpace();
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
            this._recordPosition(hand, handWorldPos);

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
                    // Update held object position
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
                    const nearest = this._findNearest(grabbables, handWorldPos);
                    if (nearest) {
                        nearest.requestOwnership();
                        nearest.grab(player.id);
                        this.held[hand] = nearest;
                    }
                }

                // Track nearest for highlighting
                for (const entity of grabbables) {
                    if (entity.heldBy) continue;
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

    _recordPosition(key, pos) {
        this.positionHistory[key].push({
            pos: pos.clone(),
            time: performance.now()
        });
        if (this.positionHistory[key].length > this.velocityBufferSize) {
            this.positionHistory[key].shift();
        }
    }

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
            if (entity.heldBy) continue;
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
        return source.gamepad.buttons.length > 1 && source.gamepad.buttons[1].pressed;
    }

    _computeThrowVelocity(key) {
        const history = this.positionHistory[key];
        if (history.length < 2) return new THREE.Vector3(0, 0, 0);

        const oldest = history[0];
        const newest = history[history.length - 1];
        const dt = (newest.time - oldest.time) / 1000;

        if (dt < 0.001) return new THREE.Vector3(0, 0, 0);

        const velocity = new THREE.Vector3()
            .subVectors(newest.pos, oldest.pos)
            .divideScalar(dt);

        const maxSpeed = 15;
        if (velocity.length() > maxSpeed) {
            velocity.normalize().multiplyScalar(maxSpeed);
        }

        return velocity;
    }

    _releaseHand(hand) {
        if (this.held[hand]) {
            const velocity = this._computeThrowVelocity(hand);
            this.held[hand].release(velocity);
            this.held[hand] = null;
        }
    }

    _releaseDesktop() {
        if (this.desktopHeld) {
            const velocity = this._computeThrowVelocity('desktop');
            this.desktopHeld.release(velocity);
            this.desktopHeld = null;
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
        this._releaseDesktop();
        this._clearHighlight();
    }
}
