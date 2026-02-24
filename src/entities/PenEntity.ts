import { NetworkEntity } from './NetworkEntity';
import { IGrabbable } from '../interfaces/IGrabbable';
import { IInteractable } from '../interfaces/IInteractable';
import { InteractionEvent } from '../interfaces/IInteractionEvent';
import { Vector3, Quaternion } from '../interfaces/IMath';
import { IView } from '../interfaces/IView';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

export interface PenState {
    p: [number, number, number];
    r: [number, number, number, number];
    heldBy: string | null;
    isDrawing: boolean;
    color: string | number;
}

/**
 * A non-physics grabbable object that can draw lines in the world.
 */
export class PenEntity extends NetworkEntity implements IGrabbable, IInteractable {
    public isGrabbable = true;
    public heldBy: string | null = null;
    public view: IView<any> | null = null;
    
    private position: Vector3 = { x: 0, y: 0, z: 0 };
    private quaternion: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
    private isDrawing = false;
    private color: string | number = 0xffffff;

    constructor(id: string, isAuthority: boolean, view: IView<any> | null) {
        super(id, 'PEN', isAuthority);
        this.view = view;
    }

    // --- IGrabbable ---
    public onGrab(playerId: string, hand: 'left' | 'right'): void {
        this.heldBy = playerId;
        this.isAuthority = true; // Authority follows the holder
    }

    public onRelease(velocity?: Vector3): void {
        this.heldBy = null;
        this.isDrawing = false;
    }

    public updateGrabbedPose(position: Vector3, quaternion: Quaternion): void {
        this.position = { ...position };
        this.quaternion = { ...quaternion };
    }

    // --- IInteractable ---
    public onHoverEnter(playerId: string): void {
        if (this.view) this.view.setHighlight(true);
    }

    public onHoverExit(playerId: string): void {
        if (this.view) this.view.setHighlight(false);
    }

    public onInteraction(event: InteractionEvent): void {
        if (event.type === 'trigger') {
            if (event.phase === 'start' && !this.isDrawing) {
                this.isDrawing = true;
                // In a real app, we'd emit a START_DRAWING event here
            } else if (event.phase === 'end') {
                this.isDrawing = false;
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

        // If we are drawing, we might want to emit points to a "DrawingManager"
        if (this.isDrawing && this.isAuthority) {
            // Placeholder for drawing logic:
            // eventBus.emit(EVENTS.PEN_DRAW_POINT, { pos: this.position, color: this.color });
        }
    }

    public getNetworkState(): PenState {
        return {
            p: [this.position.x, this.position.y, this.position.z],
            r: [this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w],
            heldBy: this.heldBy,
            isDrawing: this.isDrawing,
            color: this.color
        };
    }

    public applyNetworkState(state: PenState): void {
        if (this.isAuthority) return;

        this.position = { x: state.p[0], y: state.p[1], z: state.p[2] };
        this.quaternion = { x: state.r[0], y: state.r[1], z: state.r[2], w: state.r[3] };
        this.heldBy = state.heldBy;
        this.isDrawing = state.isDrawing;
        this.color = state.color;
    }
}
