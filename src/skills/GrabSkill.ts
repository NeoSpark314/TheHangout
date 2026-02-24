import * as THREE from 'three';
import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { IInteractable } from '../interfaces/IInteractable';
import { IGrabbable } from '../interfaces/IGrabbable';
import { InteractionEvent } from '../interfaces/IInteractionEvent';
import type { Managers } from '../core/GameState';

export class GrabSkill extends Skill {
    private grabRadius: number = 0.3;
    private desktopGrabDist: number = 2.5;
    private held: { left: IGrabbable | null, right: IGrabbable | null } = { left: null, right: null };
    private desktopHeld: IGrabbable | null = null;
    private highlightedEntity: IInteractable | null = null;
    
    private positionHistory: { left: any[], right: any[], desktop: any[] } = {
        left: [], right: [], desktop: []
    };

    constructor() {
        super('grab', 'Grab', { alwaysActive: false });
    }

    public update(delta: number, player: LocalPlayer, managers: Managers): void {
        const input = managers.input;
        const render = managers.render;
        const interactionSystem = managers.interaction;

        if (render.isXRPresenting()) {
            this._updateXR(delta, player, managers);
        } else {
            this._updateDesktop(delta, player, managers);
        }
    }

    private _updateDesktop(_delta: number, player: LocalPlayer, managers: Managers): void {
        const input = managers.input;
        const render = managers.render;
        const interactionSystem = managers.interaction;

        const camWorldPos = new THREE.Vector3();
        render.camera.getWorldPosition(camWorldPos);
        const camWorldDir = new THREE.Vector3();
        render.camera.getWorldDirection(camWorldDir);

        if (this.desktopHeld) {
            // Update held position: 1.2m in front of camera
            const targetPos = camWorldPos.clone().addScaledVector(camWorldDir, 1.2);
            const camQuat = new THREE.Quaternion();
            render.camera.getWorldQuaternion(camQuat);

            this.desktopHeld.updateGrabbedPose(
                { x: targetPos.x, y: targetPos.y, z: targetPos.z },
                { x: camQuat.x, y: camQuat.y, z: camQuat.z, w: camQuat.w }
            );

            // Handle Interaction Trigger (Left Click or Primary Action)
            // Note: For now we'll use a placeholder for actual mouse button state in InputManager
            if (input.isKeyPressed('primary_action')) {
                (this.desktopHeld as unknown as IInteractable).onInteraction({
                    type: 'trigger',
                    phase: 'start',
                    value: 1.0,
                    playerId: player.id
                });
            }

            // Check if key is RELEASED
            if (!input.isKeyDown('e')) {
                const velocity = this._computeThrowVelocity('desktop');
                this.desktopHeld.onRelease(velocity);
                this.desktopHeld = null;
                this.positionHistory.desktop = [];
            } else {
                this._recordPosition('desktop', targetPos);
            }
        } else {
            const ray = { origin: camWorldPos, direction: camWorldDir };
            const interactable = interactionSystem.findInteractableUnderRay(ray, this.desktopGrabDist);

            if (input.isKeyPressed('e') && interactable) {
                console.log('[GrabSkill] Desktop hit:', (interactable as any).type || 'unknown', 'ID:', (interactable as any).id, 'Grabbable:', (interactable as any).isGrabbable);
                
                if ((interactable as any).isGrabbable) {
                    const grabbable = interactable as unknown as IGrabbable;
                    grabbable.onGrab(player.id, 'right');
                    this.desktopHeld = grabbable;
                    this.positionHistory.desktop = [];
                }
            }

            this._updateHighlight(player.id, interactable);
        }
    }

    private _updateXR(_delta: number, player: any, managers: Managers): void {
        const render = managers.render;
        const xr = managers.xr;
        const interactionSystem = managers.interaction;

        if (!render.isXRPresenting()) return;

        const processHand = (hand: 'left' | 'right', controllerIndex: number) => {
            const pose = xr.getControllerWorldPose(render, controllerIndex);
            const handWorldPos = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
            const handWorldQuat = new THREE.Quaternion(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);

            this._recordPosition(hand, handWorldPos);
            
            const session = render.getXRSession();
            if (!session) return null;
            
            const source = session.inputSources[controllerIndex];
            const triggerBtn = source?.gamepad?.buttons[0]; // Usually trigger
            const gripBtn = source?.gamepad?.buttons[1]; // Usually grip/squeeze

            const squeezing = (gripBtn?.value || 0) > 0.5;
            const triggerValue = triggerBtn?.value || 0;

            const held = this.held[hand];

            if (held) {
                if (!squeezing) {
                    const velocity = this._computeThrowVelocity(hand);
                    held.onRelease(velocity);
                    this.held[hand] = null;
                } else {
                    held.updateGrabbedPose(
                        { x: handWorldPos.x, y: handWorldPos.y, z: handWorldPos.z },
                        { x: handWorldQuat.x, y: handWorldQuat.y, z: handWorldQuat.z, w: handWorldQuat.w }
                    );

                    // Pass rich interaction events while holding
                    if (triggerValue > 0.01) {
                        (held as unknown as IInteractable).onInteraction({
                            type: 'trigger',
                            phase: triggerValue > 0.1 ? 'update' : 'start',
                            value: triggerValue,
                            playerId: player.id,
                            hand: hand
                        });
                    }
                }
            } else {
                // Find nearest grabbable
                const result = interactionSystem.findNearestInteractable(handWorldPos, this.grabRadius);
                
                if (squeezing && result) {
                    console.log(`[GrabSkill] XR ${hand} hit:`, (result.interactable as any).type || 'unknown', 'ID:', (result.interactable as any).id, 'Grabbable:', (result.interactable as any).isGrabbable);
                    
                    if ((result.interactable as any).isGrabbable) {
                        const grabbable = result.interactable as unknown as IGrabbable;
                        grabbable.onGrab(player.id, hand);
                        this.held[hand] = grabbable;
                        this.positionHistory[hand] = [];
                    }
                }

                return result?.interactable || null;
            }
            return null;
        };

        const leftResult = processHand('left', player._leftControllerIndex);
        const rightResult = processHand('right', player._rightControllerIndex);

        this._updateHighlight(player.id, leftResult || rightResult);
    }

    private _updateHighlight(playerId: string, nearest: IInteractable | null): void {
        if (this.highlightedEntity !== nearest) {
            if (this.highlightedEntity) this.highlightedEntity.onHoverExit(playerId);
            if (nearest) nearest.onHoverEnter(playerId);
            this.highlightedEntity = nearest;
        }
    }

    private _recordPosition(key: 'left' | 'right' | 'desktop', pos: THREE.Vector3): void {
        this.positionHistory[key].push({
            pos: pos.clone(),
            time: performance.now()
        });
        if (this.positionHistory[key].length > 5) {
            this.positionHistory[key].shift();
        }
    }

    private _computeThrowVelocity(key: 'left' | 'right' | 'desktop'): THREE.Vector3 {
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
}
