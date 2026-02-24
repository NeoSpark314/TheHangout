import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { IInteractable } from '../interfaces/IInteractable';
import { Vector3, Quaternion } from '../interfaces/IMath';
import gameState from '../core/GameState.js';

export class GrabSkill extends Skill {
    private grabRadius: number = 0.3;
    private desktopGrabDist: number = 2.0;
    private held: { left: IInteractable | null, right: IInteractable | null } = { left: null, right: null };
    private desktopHeld: IInteractable | null = null;
    private highlightedEntity: IInteractable | null = null;

    constructor() {
        super('grab', 'Grab', { alwaysActive: false });
    }

    public update(delta: number, player: LocalPlayer): void {
        const managers = (gameState as any).managers;
        const input = managers.input;
        const render = managers.render;
        const interactionSystem = managers.interaction; // Assuming it's added to managers

        if (!input || !render || !interactionSystem) return;

        if (render.isXRPresenting()) {
            this._updateXR(delta, player, interactionSystem);
        } else {
            this._updateDesktop(delta, player, interactionSystem);
        }
    }

    private _updateDesktop(delta: number, player: LocalPlayer, interactionSystem: any): void {
        const input = (gameState as any).managers.input;
        const render = (gameState as any).managers.render;

        if (this.desktopHeld) {
            if (!input.keyboard.e) {
                this.desktopHeld.onRelease({ x: 0, y: 0, z: 0 }); // Simplified velocity
                this.desktopHeld = null;
            } else {
                // Update held position (would be better in a CarrySystem)
                const targetPos = { x: 0, y: 0, z: -1 }; // Placeholder relative to camera
            }
        } else {
            // Find interactable under crosshair
            const ray = { origin: render.camera.position, direction: render.camera.getWorldDirection() };
            const nearest = interactionSystem.findInteractableUnderRay(ray, this.desktopGrabDist);

            if (input.isKeyPressed('e') && nearest) {
                nearest.onGrab(player.id);
                this.desktopHeld = nearest;
            }

            if (this.highlightedEntity !== nearest) {
                if (this.highlightedEntity) this.highlightedEntity.onHoverExit(player.id);
                if (nearest) nearest.onHoverEnter(player.id);
                this.highlightedEntity = nearest;
            }
        }
    }

    private _updateXR(delta: number, player: LocalPlayer, interactionSystem: any): void {
        // XR implementation...
    }
}
