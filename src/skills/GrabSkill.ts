import * as THREE from 'three';
import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { IInteractable } from '../interfaces/IInteractable';
import gameState from '../core/GameState';

export class GrabSkill extends Skill {
    private grabRadius: number = 0.3;
    private desktopGrabDist: number = 2.0;
    private held: { left: IInteractable | null, right: IInteractable | null } = { left: null, right: null };
    private desktopHeld: IInteractable | null = null;
    private highlightedEntity: IInteractable | null = null;
    
    private positionHistory: { left: any[], right: any[], desktop: any[] } = {
        left: [], right: [], desktop: []
    };

    constructor() {
        super('grab', 'Grab', { alwaysActive: false });
    }

    public update(delta: number, player: LocalPlayer): void {
        const managers = gameState.managers;
        const input = managers.input;
        const render = managers.render;
        const interactionSystem = managers.interaction;

        if (!input || !render || !interactionSystem) return;

        if (render.isXRPresenting()) {
            this._updateXR(delta, player, interactionSystem);
        } else {
            this._updateDesktop(delta, player, interactionSystem);
        }
    }

    private _updateDesktop(_delta: number, player: LocalPlayer, interactionSystem: any): void {
        const managers = gameState.managers;
        const input = managers.input!;
        const render = managers.render!;

        if (this.desktopHeld) {
            if (!input.isKeyPressed('e')) {
                const velocity = this._computeThrowVelocity('desktop');
                this.desktopHeld.onRelease(velocity as any);
                this.desktopHeld = null;
            } else {
                const targetPos = new THREE.Vector3();
                const direction = new THREE.Vector3();
                render.camera.getWorldDirection(direction);
                targetPos.copy(render.camera.position).addScaledVector(direction, 1.0);
                
                const rb = (this.desktopHeld as any).rigidBody;
                if (rb) {
                    rb.setNextKinematicTranslation({ x: targetPos.x, y: targetPos.y, z: targetPos.z });
                    rb.setNextKinematicRotation({ 
                        x: render.camera.quaternion.x, 
                        y: render.camera.quaternion.y, 
                        z: render.camera.quaternion.z, 
                        w: render.camera.quaternion.w 
                    });
                }
                this._recordPosition('desktop', targetPos);
            }
        } else {
            const dir = new THREE.Vector3();
            render.camera.getWorldDirection(dir);
            dir.normalize();
            const ray = { origin: render.camera.position, direction: dir };
            const nearest = interactionSystem.findInteractableUnderRay(ray, this.desktopGrabDist);

            if (input.isKeyPressed('e') && nearest) {
                nearest.onGrab(player.id);
                this.desktopHeld = nearest;
                this.positionHistory.desktop = [];
            }

            this._updateHighlight(player.id, nearest);
        }
    }

    private _updateXR(_delta: number, player: LocalPlayer, interactionSystem: any): void {
        const render = gameState.managers.render!;
        const session = render.getXRSession();
        const frame = render.getXRFrame();
        const referenceSpace = render.getXRReferenceSpace();
        if (!session || !frame || !referenceSpace) return;

        let nearestGlobal: IInteractable | null = null;
        let minDistGlobal = this.grabRadius;

        for (const source of session.inputSources) {
            if (!source.gripSpace) continue;
            const hand = source.handedness as 'left' | 'right';
            if (hand !== 'left' && hand !== 'right') continue;

            const pose = frame.getPose(source.gripSpace, referenceSpace);
            if (!pose) continue;

            const handWorldPos = new THREE.Vector3(
                pose.transform.position.x, pose.transform.position.y, pose.transform.position.z
            ).applyMatrix4(render.cameraGroup.matrixWorld);

            const handWorldQuat = new THREE.Quaternion(
                pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w
            ).premultiply(render.cameraGroup.quaternion);

            this._recordPosition(hand, handWorldPos);
            const squeezing = source.gamepad && source.gamepad.buttons.length > 1 && source.gamepad.buttons[1].pressed;

            // Point-based nearest check for VR
            const result = interactionSystem.findNearestInteractable(handWorldPos, this.grabRadius);
            
            if (result && result.distance < minDistGlobal) {
                minDistGlobal = result.distance;
                nearestGlobal = result.interactable;
            }

            if (this.held[hand]) {
                if (!squeezing) {
                    const velocity = this._computeThrowVelocity(hand);
                    this.held[hand]!.onRelease(velocity as any);
                    this.held[hand] = null;
                } else {
                    const rb = (this.held[hand] as any).rigidBody;
                    if (rb) {
                        rb.setNextKinematicTranslation({ x: handWorldPos.x, y: handWorldPos.y, z: handWorldPos.z });
                        rb.setNextKinematicRotation({ x: handWorldQuat.x, y: handWorldQuat.y, z: handWorldQuat.z, w: handWorldQuat.w });
                    }
                }
            } else {
                if (squeezing && result) {
                    result.interactable.onGrab(player.id);
                    this.held[hand] = result.interactable;
                    this.positionHistory[hand] = [];
                }
            }
        }

        this._updateHighlight(player.id, nearestGlobal);
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
