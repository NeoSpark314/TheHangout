import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { IInteractable } from '../interfaces/IInteractable';
import gameState from '../core/GameState';

export class GrabSkill extends Skill {
    private desktopGrabDist: number = 2.0;
    private desktopHeld: IInteractable | null = null;
    private highlightedEntity: IInteractable | null = null;

    constructor() {
        super('grab', 'Grab', { alwaysActive: false });
    }

    public update(delta: number, player: LocalPlayer): void {
        const managers = (gameState as any).managers;
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
        const input = (gameState as any).managers.input;
        const render = (gameState as any).managers.render;

        if (this.desktopHeld) {
            if (!input.keyboard.e) {
                this.desktopHeld.onRelease({ x: 0, y: 0, z: 0 } as any);
                this.desktopHeld = null;
            } else {
                // Update held position
            }
        } else {
            const ray = { origin: render.camera.position, direction: render.camera.getWorldDirection(new (render.camera as any).constructor.Vector3()) };
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

    private _updateXR(_delta: number, _player: LocalPlayer, _interactionSystem: any): void {
        // XR implementation...
    }
}
