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
    
    private lastDrawPosition: Vector3 | null = null;

    constructor(id: string, isAuthority: boolean, view: IView<any> | null) {
        super(id, 'PEN', isAuthority);
        this.view = view;
    }

    // --- IGrabbable ---
    public onGrab(playerId: string, hand: 'left' | 'right'): void {
        this.heldBy = playerId;
        this.isAuthority = true;
        
        // Use the player's avatar color for drawing
        if (gameState.localPlayer && playerId === gameState.localPlayer.id) {
            this.color = gameState.avatarConfig.color;
        }
    }

    public onRelease(velocity?: Vector3): void {
        this.heldBy = null;
        this.isDrawing = false;
        this.lastDrawPosition = null;
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
                    eventBus.emit(EVENTS.PEN_DRAW_SEGMENT, {
                        start: [this.lastDrawPosition.x, this.lastDrawPosition.y, this.lastDrawPosition.z],
                        end: [tipPos.x, tipPos.y, tipPos.z],
                        color: this.color
                    });
                    this.lastDrawPosition = { x: tipPos.x, y: tipPos.y, z: tipPos.z };
                }
            } else {
                this.lastDrawPosition = { x: tipPos.x, y: tipPos.y, z: tipPos.z };
            }
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
