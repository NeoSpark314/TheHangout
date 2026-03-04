import { PhysicsPropEntity } from './PhysicsPropEntity';
import { IInteractionEvent } from '../../shared/contracts/IInteractionEvent';
import { IVector3 } from '../../shared/contracts/IMath';
import { IDrawSegmentPayload } from '../../shared/contracts/IDrawing';
import { IView } from '../../shared/contracts/IView';
import { IPenEntityState, IEntityState, EntityType } from '../../shared/contracts/IEntityState';
import { AppContext } from '../../app/AppContext';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * A tool that can draw lines in the world, now backed by a sensor physics rigid body
 * for robust networking grab/release capability identical to standard physical props.
 */
export class PenToolEntity extends PhysicsPropEntity {
    private isDrawing = false;
    private color: string | number = 0xffffff;

    private lastDrawPosition: IVector3 | null = null;
    private lastSyncDrawing: boolean = false;
    private lastSyncColor: string | number | null = null;

    constructor(protected context: AppContext, id: string, isAuthority: boolean, rigidBody: RAPIER.RigidBody, view: IView<any> | null, options: any = {}) {
        super(context, id, isAuthority, rigidBody, {
            ...options,
            type: EntityType.PEN,
            grabbable: true,
            view: view as any,
            grabRadius: 0.1
        });
    }

    // --- IGrabbable overrides ---
    public onGrab(playerId: string, hand: 'left' | 'right'): void {
        super.onGrab(playerId, hand);

        // Use the player's avatar color for drawing
        if (this.context.localPlayer && playerId === this.context.localPlayer.id) {
            this.color = this.context.avatarConfig?.color || 0x00ffff;
        }
    }

    public onRelease(velocity?: IVector3): void {
        super.onRelease(velocity);
        this.isDrawing = false;
        this.lastDrawPosition = null;
    }

    // --- IInteractable overrides ---
    public onInteraction(event: IInteractionEvent): void {
        super.onInteraction?.(event);

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

    public update(delta: number, frame?: XRFrame): void {
        super.update(delta, frame);

        if (this.view) {
            (this.view as any).applyState({
                position: this.presentPos,
                quaternion: this.presentRot,
                isDrawing: this.isDrawing,
                color: this.color
            }, delta);
        }

        // Logic for emitting draw segments
        if (this.isDrawing && this.isAuthority) {
            // Get current pen tip position (approximate)
            const tipOffset = new THREE.Vector3(0, 0, -0.12);
            const quat = new THREE.Quaternion(this.presentRot.x, this.presentRot.y, this.presentRot.z, this.presentRot.w);
            const tipPos = new THREE.Vector3(this.presentPos.x, this.presentPos.y, this.presentPos.z).add(tipOffset.applyQuaternion(quat));

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

    public getNetworkState(fullSync: boolean = false): Partial<IEntityState> | null {
        // Base will return null if asleep/unchanged transforms, but we must also check our properties.
        const base = super.getNetworkState(fullSync) as Partial<IPenEntityState> | null;

        const stateChanged = this.isDrawing !== this.lastSyncDrawing || this.color !== this.lastSyncColor;

        if (!base && !stateChanged && !fullSync) {
            return null;
        }

        const state = {
            // Guarantee base is populated if stateChanged triggered us
            ...(base || super.getNetworkState(true)!),
            type: EntityType.PEN,
            isDrawing: this.isDrawing,
            c: this.color
        } as IPenEntityState;

        this.lastSyncDrawing = this.isDrawing;
        this.lastSyncColor = this.color;

        return state;
    }

    public applyNetworkState(state: Partial<IEntityState>): void {
        super.applyNetworkState(state);
        const penState = state as Partial<IPenEntityState>;
        this.isDrawing = !!penState.isDrawing;
        this.color = penState.c || 0xffffff;
    }
}
