import * as THREE from 'three';
import { Skill } from './Skill';
import { PlayerAvatarEntity } from '../world/entities/PlayerAvatarEntity';
import type { IRuntimeRegistry } from '../app/AppContext';
import eventBus from '../app/events/EventBus';
import { EVENTS } from '../shared/constants/Constants';
import { IHandIntentPayload } from '../shared/contracts/IIntents';

export class UIPointerSkill extends Skill {
    private raycaster: THREE.Raycaster;
    private pointerLines: { left: THREE.Line, right: THREE.Line };
    private pointerDots: { left: THREE.Mesh, right: THREE.Mesh };

    // Desktop mouse properties
    private mouseLine: THREE.Line;
    private mouseDot: THREE.Mesh;

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

    public activate(player: PlayerAvatarEntity): void {
        super.activate(player);
        const render = player.appContext.runtime.render;
        if (render) {
            render.scene.add(this.pointerLines.left);
            render.scene.add(this.pointerLines.right);
            render.scene.add(this.pointerDots.left);
            render.scene.add(this.pointerDots.right);

            render.scene.add(this.mouseLine);
            render.scene.add(this.mouseDot);
        }

        const onInteractStart = (payload: IHandIntentPayload) => {
            const render = player.appContext.runtime.render;
            if (!render || !render.isXRPresenting()) {
                return;
            }
            this.handlePointerClick(player, payload.hand);
        };

        eventBus.on(EVENTS.INTENT_INTERACT_START, onInteractStart);

        this._handlers.push({ event: EVENTS.INTENT_INTERACT_START, handler: onInteractStart });
    }

    public deactivate(player: PlayerAvatarEntity): void {
        super.deactivate(player);
        for (const { event, handler } of this._handlers) {
            eventBus.off(event, handler);
        }
        this._handlers = [];

        const render = player.appContext.runtime.render;
        if (render) {
            render.scene.remove(this.pointerLines.left);
            render.scene.remove(this.pointerLines.right);
            render.scene.remove(this.pointerDots.left);
            render.scene.remove(this.pointerDots.right);
            render.scene.remove(this.mouseLine);
            render.scene.remove(this.mouseDot);
        }
    }

    public update(delta: number, player: PlayerAvatarEntity, runtime: IRuntimeRegistry): void {
        const render = runtime.render;
        const vrUi = runtime.vrUi;
        if (!render || !vrUi || !vrUi.tablet) return;

        const isXR = render.isXRPresenting();
        const isTabletInteractive = vrUi.isTabletInteractionActive();
        const tabletMesh = vrUi.tablet.mesh;

        if (isXR) {
            this.mouseLine.visible = false;
            this.mouseDot.visible = false;

            if (!isTabletInteractive) {
                this.pointerLines.left.visible = false;
                this.pointerLines.right.visible = false;
                this.pointerDots.left.visible = false;
                this.pointerDots.right.visible = false;
                vrUi.tablet.ui.onPointerOut();
                return;
            }

            const trackingHands = runtime.tracking.getState().hands;

            for (const hand of ['left', 'right'] as const) {
                const handState = trackingHands[hand];
                const line = this.pointerLines[hand];
                const dot = this.pointerDots[hand];

                if (handState.active) {
                    // Prefer specialized pointer pose (pinch/target ray) over raw joint/grip pose
                    const pos = handState.pointerPose.position || handState.pose.position;
                    const rot = handState.pointerPose.quaternion || handState.pose.quaternion;

                    const origin = new THREE.Vector3(pos.x, pos.y, pos.z);
                    const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
                    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);

                    this.raycaster.set(origin, direction);


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
            // Keep world-space tablet interaction XR-only. Desktop users should use
            // the flat UI instead of sharing the same generic interact intent.
            this.pointerLines.left.visible = false;
            this.pointerLines.right.visible = false;
            this.pointerDots.left.visible = false;
            this.pointerDots.right.visible = false;
            vrUi.tablet.ui.onPointerOut();
            this.mouseDot.visible = false;
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

    private handlePointerClick(player: PlayerAvatarEntity, hand: 'left' | 'right'): void {
        const render = player.appContext.runtime.render;
        const vrUi = player.appContext.runtime.vrUi;
        if (!render || !vrUi || !vrUi.tablet) return;

        const isXR = render.isXRPresenting();
        const tabletMesh = vrUi.tablet.mesh;

        if (!isXR || !vrUi.isTabletInteractionActive()) return;

        const handState = player.appContext.runtime.tracking.getState().hands[hand];
        if (!handState.active) return;

        const pos = handState.pointerPose.position || handState.pose.position;
        const rot = handState.pointerPose.quaternion || handState.pose.quaternion;

        const origin = new THREE.Vector3(pos.x, pos.y, pos.z);
        const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);

        this.raycaster.set(origin, direction);

        const hits = this.raycaster.intersectObject(tabletMesh);
        if (hits.length > 0) {
            const hit = hits[0];
            if (hit.uv) {
                vrUi.tablet.ui.onPointerClick(hit.uv);
            }
        }
    }
}
