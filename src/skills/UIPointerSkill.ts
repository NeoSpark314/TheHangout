import * as THREE from 'three';
import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import type { IManagers } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IHandIntentPayload } from '../interfaces/IIntents';

export class UIPointerSkill extends Skill {
    private raycaster: THREE.Raycaster;
    private pointerLines: { left: THREE.Line, right: THREE.Line };
    private pointerDots: { left: THREE.Mesh, right: THREE.Mesh };

    // Desktop mouse properties
    private mouseLine: THREE.Line;
    private mouseDot: THREE.Mesh;

    // Drag state
    private draggingHand: 'left' | 'right' | 'desktop' | null = null;
    private dragDistance: number = 0.5;

    private _handlers: Array<{ event: string, handler: any }> = [];

    constructor() {
        super('ui-pointer', 'UI Pointer', { isAlwaysActive: true });
        this.raycaster = new THREE.Raycaster();

        // Visuals for VR pointers
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 });
        const lineGeoL = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
        const lineGeoR = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);

        this.pointerLines = {
            left: new THREE.Line(lineGeoL, lineMat),
            right: new THREE.Line(lineGeoR, lineMat)
        };

        const dotGeo = new THREE.CircleGeometry(0.005, 16);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide, depthTest: false, depthWrite: false });

        this.pointerDots = {
            left: new THREE.Mesh(dotGeo, dotMat),
            right: new THREE.Mesh(dotGeo, dotMat)
        };

        this.pointerLines.left.visible = false;
        this.pointerLines.right.visible = false;
        this.pointerDots.left.visible = false;
        this.pointerDots.right.visible = false;

        // Ensure rendering order puts dots on top
        this.pointerDots.left.renderOrder = 999;
        this.pointerDots.right.renderOrder = 999;

        // Visuals for Desktop center pointer
        const deskLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
        this.mouseLine = new THREE.Line(deskLineGeo, lineMat);
        this.mouseDot = new THREE.Mesh(dotGeo, dotMat);
        this.mouseLine.visible = false;
        this.mouseDot.visible = false;
        this.mouseDot.renderOrder = 999;
    }

    public activate(player: LocalPlayer): void {
        super.activate(player);
        const render = player.context.managers.render;
        if (render) {
            render.scene.add(this.pointerLines.left);
            render.scene.add(this.pointerLines.right);
            render.scene.add(this.pointerDots.left);
            render.scene.add(this.pointerDots.right);

            render.scene.add(this.mouseLine);
            render.scene.add(this.mouseDot);
        }

        const onInteractStart = (payload: IHandIntentPayload) => {
            this.handlePointerClick(player, payload.hand);
        };

        const onGrabStart = (payload: IHandIntentPayload) => {
            this.handleGrabStart(player, payload.hand);
        };

        const onGrabEnd = (payload: IHandIntentPayload) => {
            this.handleGrabEnd(player, payload.hand);
        };

        eventBus.on(EVENTS.INTENT_INTERACT_START, onInteractStart);
        eventBus.on(EVENTS.INTENT_GRAB_START, onGrabStart);
        eventBus.on(EVENTS.INTENT_GRAB_END, onGrabEnd);

        this._handlers.push({ event: EVENTS.INTENT_INTERACT_START, handler: onInteractStart });
        this._handlers.push({ event: EVENTS.INTENT_GRAB_START, handler: onGrabStart });
        this._handlers.push({ event: EVENTS.INTENT_GRAB_END, handler: onGrabEnd });
    }

    public deactivate(player: LocalPlayer): void {
        super.deactivate(player);
        for (const { event, handler } of this._handlers) {
            eventBus.off(event, handler);
        }
        this._handlers = [];

        const render = player.context.managers.render;
        if (render) {
            render.scene.remove(this.pointerLines.left);
            render.scene.remove(this.pointerLines.right);
            render.scene.remove(this.pointerDots.left);
            render.scene.remove(this.pointerDots.right);
            render.scene.remove(this.mouseLine);
            render.scene.remove(this.mouseDot);
        }
    }

    public update(delta: number, player: LocalPlayer, managers: IManagers): void {
        const render = managers.render;
        const vrUi = managers.vrUi;
        if (!render || !vrUi || !vrUi.tablet) return;

        const isXR = render.isXRPresenting();
        const tabletMesh = vrUi.tablet.mesh;

        if (isXR) {
            this.mouseLine.visible = false;
            this.mouseDot.visible = false;

            for (const hand of ['left', 'right'] as const) {
                const handState = player.handStates[hand];
                const line = this.pointerLines[hand];
                const dot = this.pointerDots[hand];

                if (handState.active) {
                    const origin = new THREE.Vector3(handState.position.x, handState.position.y, handState.position.z);
                    const quat = new THREE.Quaternion(handState.quaternion.x, handState.quaternion.y, handState.quaternion.z, handState.quaternion.w);
                    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);

                    this.raycaster.set(origin, direction);

                    if (this.draggingHand === hand) {
                        // Move tablet with hand
                        const targetPos = origin.clone().add(direction.multiplyScalar(this.dragDistance));
                        vrUi.tablet.updateGrabbedPose(targetPos, vrUi.tablet.mesh.quaternion);
                        line.visible = true;
                        dot.visible = false;
                        line.position.copy(origin);
                        line.quaternion.copy(quat);
                        line.scale.set(1, 1, this.dragDistance);
                        continue;
                    }

                    const hits = this.raycaster.intersectObject(tabletMesh);

                    if (hits.length > 0) {
                        const hit = hits[0];
                        line.visible = true;
                        dot.visible = true;

                        // Update visuals
                        const length = hit.distance;
                        line.position.copy(origin);
                        line.quaternion.copy(quat);
                        line.scale.set(1, 1, length);

                        dot.position.copy(hit.point);
                        // Align dot to tablet normal
                        dot.quaternion.copy(tabletMesh.quaternion);

                        // Trigger Hover Event in CanvasUI
                        if (hit.uv) {
                            vrUi.tablet.ui.onPointerMove(hit.uv);
                        }
                    } else {
                        line.visible = false;
                        dot.visible = false;
                        vrUi.tablet.ui.onPointerOut();
                    }
                } else {
                    line.visible = false;
                    dot.visible = false;
                }
            }
        } else {
            // Desktop fallback: cast from camera center
            this.pointerLines.left.visible = false;
            this.pointerLines.right.visible = false;
            this.pointerDots.left.visible = false;
            this.pointerDots.right.visible = false;

            const origin = new THREE.Vector3();
            const direction = new THREE.Vector3(0, 0, -1);

            render.camera.getWorldPosition(origin);
            render.camera.getWorldDirection(direction);

            this.raycaster.set(origin, direction);

            if (this.draggingHand === 'desktop') {
                const targetPos = origin.clone().add(direction.multiplyScalar(this.dragDistance));
                vrUi.tablet.updateGrabbedPose(targetPos, vrUi.tablet.mesh.quaternion);
                this.mouseDot.visible = true;
                this.mouseDot.position.copy(targetPos);
                return;
            }

            const hits = this.raycaster.intersectObject(tabletMesh);

            if (hits.length > 0) {
                const hit = hits[0];
                this.mouseDot.visible = true;
                this.mouseDot.position.copy(hit.point);
                this.mouseDot.quaternion.copy(tabletMesh.quaternion);

                if (hit.uv) {
                    vrUi.tablet.ui.onPointerMove(hit.uv);
                }
            } else {
                this.mouseDot.visible = false;
                vrUi.tablet.ui.onPointerOut();
            }
        }
    }

    private handlePointerClick(player: LocalPlayer, hand: 'left' | 'right'): void {
        const render = player.context.managers.render;
        const vrUi = player.context.managers.vrUi;
        if (!render || !vrUi || !vrUi.tablet) return;

        const isXR = render.isXRPresenting();
        const tabletMesh = vrUi.tablet.mesh;

        if (isXR) {
            const handState = player.handStates[hand];
            if (!handState.active) return;

            const origin = new THREE.Vector3(handState.position.x, handState.position.y, handState.position.z);
            const quat = new THREE.Quaternion(handState.quaternion.x, handState.quaternion.y, handState.quaternion.z, handState.quaternion.w);
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);

            this.raycaster.set(origin, direction);
        } else {
            const origin = new THREE.Vector3();
            const direction = new THREE.Vector3(0, 0, -1);
            render.camera.getWorldPosition(origin);
            render.camera.getWorldDirection(direction);
            this.raycaster.set(origin, direction);
        }

        const hits = this.raycaster.intersectObject(tabletMesh);
        if (hits.length > 0) {
            const hit = hits[0];
            if (hit.uv) {
                vrUi.tablet.ui.onPointerClick(hit.uv);
            }
        }
    }

    private handleGrabStart(player: LocalPlayer, hand: 'left' | 'right'): void {
        if (this.draggingHand) return; // already dragging

        const render = player.context.managers.render;
        const vrUi = player.context.managers.vrUi;
        if (!render || !vrUi || !vrUi.tablet) return;

        const isXR = render.isXRPresenting();
        const tabletMesh = vrUi.tablet.mesh;

        let h: 'left' | 'right' | 'desktop' = 'desktop';

        if (isXR) {
            const handState = player.handStates[hand];
            if (!handState.active) return;
            h = hand;

            const origin = new THREE.Vector3(handState.position.x, handState.position.y, handState.position.z);
            const quat = new THREE.Quaternion(handState.quaternion.x, handState.quaternion.y, handState.quaternion.z, handState.quaternion.w);
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);

            this.raycaster.set(origin, direction);
        } else {
            const origin = new THREE.Vector3();
            const direction = new THREE.Vector3(0, 0, -1);
            render.camera.getWorldPosition(origin);
            render.camera.getWorldDirection(direction);
            this.raycaster.set(origin, direction);
        }

        const hits = this.raycaster.intersectObject(tabletMesh);
        if (hits.length > 0) {
            this.draggingHand = h;
            this.dragDistance = hits[0].distance;
            vrUi.tablet.onGrab(player.id, hand);
        }
    }

    private handleGrabEnd(player: LocalPlayer, hand: 'left' | 'right'): void {
        const render = player.context.managers.render;
        const vrUi = player.context.managers.vrUi;
        const isXR = render?.isXRPresenting();

        const h = isXR ? hand : 'desktop';
        if (this.draggingHand === h) {
            this.draggingHand = null;
            if (vrUi && vrUi.tablet) {
                vrUi.tablet.onRelease();
            }
        }
    }
}
