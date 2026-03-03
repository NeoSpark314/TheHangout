import { ReplicatedEntity } from './ReplicatedEntity';
import { IGrabbable } from '../../shared/contracts/IGrabbable';
import { IInteractable } from '../../shared/contracts/IInteractable';
import { IInteractionEvent } from '../../shared/contracts/IInteractionEvent';
import { IVector3, IQuaternion, IPose } from '../../shared/contracts/IMath';
import { IDrawSegmentPayload } from '../../shared/contracts/IDrawing';
import { IView } from '../../shared/contracts/IView';
import { IPenEntityState, EntityType } from '../../shared/contracts/IEntityState';
import { AppContext } from '../../app/AppContext';
import * as THREE from 'three';

/**
 * A non-physics grabbable object that can draw lines in the world.
 */
export class PenToolEntity extends ReplicatedEntity implements IGrabbable, IInteractable {
    public isHoldable = true;
    public isGrabbable = true;
    private hoverSources: Set<string> = new Set();
    public heldBy: string | null = null;
    public view: IView<any> | null = null;

    private position: IVector3 = { x: 0, y: 0, z: 0 };
    private quaternion: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private isDrawing = false;
    private color: string | number = 0xffffff;

    private lastDrawPosition: IVector3 | null = null;

    constructor(protected context: AppContext, id: string, isAuthority: boolean, view: IView<any> | null) {
        super(context, id, EntityType.PEN, isAuthority);
        this.view = view;
    }

    // --- IGrabbable ---
    public onGrab(playerId: string, hand: 'left' | 'right'): void {
        this.heldBy = playerId;
        this.requestOwnership();

        // Use the player's avatar color for drawing
        if (this.context.localPlayer && playerId === this.context.localPlayer.id) {
            this.color = this.context.avatarConfig?.color || 0x00ffff;
        }
    }

    public onRelease(velocity?: IVector3): void {
        this.heldBy = null;
        this.isDrawing = false;
        this.lastDrawPosition = null;
    }

    public updateGrabbedPose(pose: IPose): void {
        this.position = { x: pose.position.x, y: pose.position.y, z: pose.position.z };
        this.quaternion = { x: pose.quaternion.x, y: pose.quaternion.y, z: pose.quaternion.z, w: pose.quaternion.w };
    }

    // --- IInteractable ---
    public onHoverEnter(playerId: string): void {
        this.hoverSources.add(playerId);
        if (this.view) this.view.setHighlight(true);
    }

    public onHoverExit(playerId: string): void {
        this.hoverSources.delete(playerId);
        if (this.view) this.view.setHighlight(this.hoverSources.size > 0);
    }

    public onInteraction(event: IInteractionEvent): void {
        if (event.type === 'trigger') {
            if (event.phase === 'start' && !this.isDrawing) {
                this.isDrawing = true;
                this.lastDrawPosition = null; // Start fresh
            } else if (event.phase === 'end') {
                this.isDrawing = false;
                this.lastDrawPosition = null;
            }
        }
    }

    public update(delta: number): void {
        if (this.view) {
            this.view.applyState({
                position: this.position,
                quaternion: this.quaternion,
                isDrawing: this.isDrawing,
                color: this.color
            }, delta);
        }

        // Logic for emitting draw segments
        if (this.isDrawing && this.isAuthority) {
            // Get current pen tip position (approximate)
            const tipOffset = new THREE.Vector3(0, 0, -0.12);
            const quat = new THREE.Quaternion(this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w);
            const tipPos = new THREE.Vector3(this.position.x, this.position.y, this.position.z).add(tipOffset.applyQuaternion(quat));

            if (this.lastDrawPosition) {
                const distSq = tipPos.distanceToSquared(new THREE.Vector3(this.lastDrawPosition.x, this.lastDrawPosition.y, this.lastDrawPosition.z));

                // Only draw if we've moved enough (1cm) to save bandwidth/performance
                if (distSq > 0.0001) {
                    const segment: IDrawSegmentPayload = {
                        startPos: [this.lastDrawPosition.x, this.lastDrawPosition.y, this.lastDrawPosition.z],
                        endPos: [tipPos.x, tipPos.y, tipPos.z],
                        color: this.color
                    };
                    this.context.runtime.drawing.addSegment(segment);
                    this.lastDrawPosition = { x: tipPos.x, y: tipPos.y, z: tipPos.z };
                }
            } else {
                this.lastDrawPosition = { x: tipPos.x, y: tipPos.y, z: tipPos.z };
            }
        }
    }

    public getNetworkState(fullSync: boolean = false): IPenEntityState {
        return {
            id: this.id,
            type: EntityType.PEN,
            p: [this.position.x, this.position.y, this.position.z],
            q: [this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w],
            b: this.heldBy,
            ownerId: this.ownerId,
            isDrawing: this.isDrawing,
            c: this.color
        };
    }

    public applyNetworkState(state: IPenEntityState): void {
        this.syncNetworkState(state);
        if (this.isAuthority) return;

        if (state.p) this.position = { x: state.p[0], y: state.p[1], z: state.p[2] };
        if (state.q) this.quaternion = { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] };
        this.heldBy = state.b || null;
        this.isDrawing = !!state.isDrawing;
        this.color = state.c || 0xffffff;
    }
}
