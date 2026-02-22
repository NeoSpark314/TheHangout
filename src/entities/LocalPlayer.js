// entities/LocalPlayer.js

import * as THREE from 'three';
import { PlayerEntity } from './PlayerEntity.js';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';
import { MovementSkill } from '../skills/MovementSkill.js';
import { GrabSkill } from '../skills/GrabSkill.js';

/**
 * The local player entity — driven by local input, camera, and XR tracking.
 * Authority is always true (we own ourselves).
 *
 * Rendering is delegated to this.view (an EntityView subclass, typically StickFigureView).
 * The view is injected via the constructor, keeping entity logic decoupled from visuals.
 */
export class LocalPlayer extends PlayerEntity {
    /**
     * @param {string} id
     * @param {THREE.Vector3} spawnPos
     * @param {number} spawnYaw
     * @param {import('../views/EntityView.js').EntityView} view - Pluggable visual
     */
    constructor(id, spawnPos, spawnYaw, view) {
        super(id || 'local-player-id-temp', 'LOCAL_PLAYER', true);

        // --- Visual ---
        this.view = view;
        this.mesh = view.mesh;

        // --- Skill System ---
        this.skills = [];
        this.activeSkill = null;

        // --- Clean Architecture Transforms ---
        this.xrOrigin = new THREE.Object3D();
        if (spawnPos) this.xrOrigin.position.copy(spawnPos);

        this.headPose = new THREE.Object3D();
        this.leftHandPose = new THREE.Object3D();
        this.rightHandPose = new THREE.Object3D();

        this.xrOrigin.add(this.headPose);
        this.xrOrigin.add(this.leftHandPose);
        this.xrOrigin.add(this.rightHandPose);

        // Initial Static Offsets (Desktop Simulation)
        this.headPose.position.set(0, 1.7, 0);
        this.leftHandPose.position.set(-0.35, 1.1, -0.4);
        this.rightHandPose.position.set(0.35, 1.1, -0.4);

        this.xrOrigin.rotation.y = spawnYaw || 0;

        // Internal: set by MovementSkill so update() can check if movement happened
        this._lastMoveVector = new THREE.Vector3();

        // Listen for live customization updates
        eventBus.on(EVENTS.AVATAR_CONFIG_UPDATED, (config) => {
            if (this.view) {
                this.view.setColor(config.color);
            }
        });

        this.initSkills(spawnYaw);
    }

    // --- Skill Management ---

    initSkills(spawnYaw) {
        const movement = new MovementSkill();
        movement.init(this, spawnYaw);
        this.addSkill(movement);

        const grab = new GrabSkill();
        this.addSkill(grab);
        this.setActiveSkill('grab');
    }

    addSkill(skill) {
        this.skills.push(skill);
        if (skill.alwaysActive) {
            skill.activate(this);
        }
    }

    setActiveSkill(id) {
        if (this.activeSkill && !this.activeSkill.alwaysActive) {
            this.activeSkill.deactivate(this);
        }

        const skill = this.skills.find(s => s.id === id);
        if (skill && !skill.alwaysActive) {
            skill.activate(this);
            this.activeSkill = skill;
        }
    }

    getSkill(id) {
        return this.skills.find(s => s.id === id);
    }

    // --- Main Update ---

    update(delta) {
        const { render } = gameState.managers;
        if (!render) return;

        // 1. Update all active skills (movement, etc.)
        for (const skill of this.skills) {
            if (skill.alwaysActive || skill === this.activeSkill) {
                skill.update(delta, this);
            }
        }

        // 2. Map VR Hands
        this.updateVRHands();

        // 3. Compute visual state and push to view
        const headWorldPos = new THREE.Vector3();
        render.camera.getWorldPosition(headWorldPos);
        const finalHeadQuat = new THREE.Quaternion();
        render.camera.getWorldQuaternion(finalHeadQuat);
        const finalHeadEuler = new THREE.Euler().setFromQuaternion(finalHeadQuat, 'YXZ');

        // Body heading follows head world yaw
        const bodyYaw = finalHeadEuler.y;

        // Neck rotation (head orientation relative to body yaw)
        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.invert().multiply(finalHeadQuat);

        // SYNC FIX [PHASE 2]: 
        // We must update the mesh position and rotation BEFORE transforming hands to avatar space.
        // Otherwise, the hands use the "previous" frame's body position for the transformation.
        this.mesh.position.set(headWorldPos.x, 0, headWorldPos.z);
        this.mesh.rotation.y = bodyYaw;
        this.mesh.updateMatrixWorld(true);

        // Transform VR hands to avatar-local space
        this.transformHandsToAvatarSpace();

        // Sync name
        this.syncName();

        // Push complete state to view
        this.view.update({
            position: this.mesh.position,
            yaw: bodyYaw,
            headHeight: headWorldPos.y,
            headQuaternion: localHeadQuat,
            handStates: this.handStates,
            name: this.name,
            color: gameState.avatarConfig.color,
            isLocal: true,
            lerpFactor: 1.0
        }, delta);

        // 4. Network
        if (this._lastMoveVector.lengthSq() > 0 || Math.abs(delta) > 0) {
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, this.getNetworkState());
        }
    }

    syncName() {
        if (gameState.playerName && this.name !== gameState.playerName) {
            this.name = gameState.playerName;
        }
    }

    // --- VR Hand Tracking ---

    updateVRHands() {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.isPresenting) {
            this.handStates.left.active = false;
            this.handStates.right.active = false;
            return;
        }

        const session = render.renderer.xr.getSession();
        if (!session) return;

        this.handStates.left.active = false;
        this.handStates.right.active = false;

        const frame = render.renderer.xr.getFrame();
        const referenceSpace = render.renderer.xr.getReferenceSpace();

        if (!frame || !referenceSpace) return;

        for (const source of session.inputSources) {
            if (source.hand) {
                const handState = source.handedness === 'left' ? this.handStates.left : this.handStates.right;
                handState.active = true;

                if (source.gripSpace) {
                    const wristPose = frame.getPose(source.gripSpace, referenceSpace);
                    if (wristPose) {
                        const handPoseObj = source.handedness === 'left' ? this.leftHandPose : this.rightHandPose;
                        handPoseObj.position.copy(wristPose.transform.position);
                        handPoseObj.quaternion.copy(wristPose.transform.orientation);
                    }
                }

                let i = 0;
                for (const joint of source.hand.values()) {
                    if (i >= 25) break;
                    const jointPose = frame.getJointPose(joint, referenceSpace);
                    if (jointPose) {
                        handState.joints[i].position.copy(jointPose.transform.position);
                        handState.joints[i].quaternion.copy(jointPose.transform.orientation);
                    }
                    i++;
                }

            } else if (source.gripSpace) {
                const pose = frame.getPose(source.gripSpace, referenceSpace);
                if (pose) {
                    const handState = source.handedness === 'left' ? this.handStates.left : this.handStates.right;
                    const handPoseObj = source.handedness === 'left' ? this.leftHandPose : this.rightHandPose;

                    handState.active = true;
                    for (let i = 0; i < 25; i++) {
                        handState.joints[i].position.set(0, 0, 0);
                    }

                    handPoseObj.position.copy(pose.transform.position);
                    handPoseObj.quaternion.copy(pose.transform.orientation);
                }
            }
        }
    }

    transformHandsToAvatarSpace() {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.isPresenting) return;

        this.mesh.updateMatrixWorld(true);
        this.xrOrigin.updateMatrixWorld(true);

        const convertPose = (sourcePos, sourceQuat, targetPos, targetQuat) => {
            const worldPos = sourcePos.clone();
            worldPos.applyMatrix4(this.xrOrigin.matrixWorld);

            const worldQuat = sourceQuat.clone();
            const xrOriginQuat = new THREE.Quaternion();
            this.xrOrigin.getWorldQuaternion(xrOriginQuat);
            worldQuat.premultiply(xrOriginQuat);

            const localPos = this.mesh.worldToLocal(worldPos);

            const invMeshQuat = new THREE.Quaternion();
            this.mesh.getWorldQuaternion(invMeshQuat);
            invMeshQuat.invert();
            const localQuat = worldQuat.clone().premultiply(invMeshQuat);

            targetPos.copy(localPos);
            targetQuat.copy(localQuat);
        };

        if (this.handStates.left.active) {
            convertPose(this.leftHandPose.position, this.leftHandPose.quaternion, this.handStates.left.position, this.handStates.left.quaternion);
            for (let i = 0; i < 25; i++) {
                if (this.handStates.left.joints[i].position.lengthSq() > 0) {
                    const rawPos = this.handStates.left.joints[i].position.clone();
                    const rawQuat = this.handStates.left.joints[i].quaternion.clone();
                    convertPose(rawPos, rawQuat, this.handStates.left.joints[i].position, this.handStates.left.joints[i].quaternion);
                }
            }
        }

        if (this.handStates.right.active) {
            convertPose(this.rightHandPose.position, this.rightHandPose.quaternion, this.handStates.right.position, this.handStates.right.quaternion);
            for (let i = 0; i < 25; i++) {
                if (this.handStates.right.joints[i].position.lengthSq() > 0) {
                    const rawPos = this.handStates.right.joints[i].position.clone();
                    const rawQuat = this.handStates.right.joints[i].quaternion.clone();
                    convertPose(rawPos, rawQuat, this.handStates.right.joints[i].position, this.handStates.right.joints[i].quaternion);
                }
            }
        }
    }

    // --- Network ---

    getNetworkState() {
        const headWorldPos = new THREE.Vector3();
        const headWorldQuat = new THREE.Quaternion();
        const { render } = gameState.managers;
        if (!render) return {};

        render.camera.getWorldPosition(headWorldPos);
        render.camera.getWorldQuaternion(headWorldQuat);

        const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');
        const bodyYaw = headEuler.y;

        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.invert().multiply(headWorldQuat);

        const serializeHand = (handState) => {
            const data = {
                active: handState.active,
                position: { x: handState.position.x, y: handState.position.y, z: handState.position.z },
                quaternion: { x: handState.quaternion.x, y: handState.quaternion.y, z: handState.quaternion.z, w: handState.quaternion.w },
                joints: []
            };

            if (handState.active && handState.joints[0].position.lengthSq() > 0) {
                for (let i = 0; i < 25; i++) {
                    const j = handState.joints[i];
                    data.joints.push({
                        p: { x: j.position.x, y: j.position.y, z: j.position.z },
                        q: { x: j.quaternion.x, y: j.quaternion.y, z: j.quaternion.z, w: j.quaternion.w }
                    });
                }
            }
            return data;
        };

        return {
            id: this.id,
            type: this.type,
            name: this.name,
            position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
            yaw: bodyYaw,
            headHeight: headWorldPos.y,
            head: {
                position: { x: headWorldPos.x, y: headWorldPos.y, z: headWorldPos.z },
                quaternion: { x: localHeadQuat.x, y: localHeadQuat.y, z: localHeadQuat.z, w: localHeadQuat.w }
            },
            hands: {
                left: serializeHand(this.handStates.left),
                right: serializeHand(this.handStates.right)
            },
            avatarConfig: gameState.avatarConfig
        };
    }

    // --- Cleanup ---

    destroy() {
        super.destroy();

        for (const skill of this.skills) {
            skill.destroy();
        }
        this.skills = [];
        this.activeSkill = null;

        const { render } = gameState.managers;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
