import { NetworkEntity } from './NetworkEntity';
import { IView } from '../interfaces/IView';
import { Vector3 } from '../interfaces/IMath';
import { SpectatorViewState } from '../views/SpectatorView';
import gameState from '../core/GameState';

export class SpectatorEntity extends NetworkEntity {
    public view: IView<SpectatorViewState>;
    public targetPosition: Vector3 = { x: 0, y: 8, z: 10 };
    
    // Authority-only
    private moveSpeed: number = 8;
    private lookSpeed: number = 0.002;
    private pitch: number = 0;
    private yaw: number = 0;

    constructor(id: string, isAuthority: boolean = false, view: IView<SpectatorViewState>) {
        super(id, 'SPECTATOR', isAuthority);
        this.view = view;

        if (this.isAuthority) {
            this.initControls();
        }
    }

    private initControls(): void {
        const managers = gameState.managers;
        const render = managers.render;

        const canvas = render.renderer.domElement;
        canvas.addEventListener('click', () => {
            if (document.pointerLockElement !== canvas) {
                canvas.requestPointerLock();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement !== canvas) return;
            this.yaw -= e.movementX * this.lookSpeed;
            this.pitch -= e.movementY * this.lookSpeed;
            this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
        });
    }

    public update(delta: number, _frame?: XRFrame): void {
        if (this.isAuthority) {
            this.updateAuthority(delta);
        } else {
            this.updateRemote(delta);
        }

        this.view.applyState({
            position: this.targetPosition,
            lerpFactor: this.isAuthority ? 1.0 : 8 * delta
        }, delta);
    }

    private updateAuthority(delta: number): void {
        const managers = gameState.managers;
        const render = managers.render;
        const input = managers.input;
        if (!render || !input) return;

        const moveVec = input.getMovementVector();
        
        // Simplified movement math
        const forward = {
            x: -Math.sin(this.yaw),
            z: -Math.cos(this.yaw)
        };
        const right = {
            x: Math.cos(this.yaw),
            z: -Math.sin(this.yaw)
        };

        const velocity = { x: 0, y: 0, z: 0 };
        velocity.x += forward.x * -moveVec.y * this.moveSpeed * delta;
        velocity.z += forward.z * -moveVec.y * this.moveSpeed * delta;
        velocity.x += right.x * moveVec.x * this.moveSpeed * delta;
        velocity.z += right.z * moveVec.x * this.moveSpeed * delta;

        if (input.isKeyPressed('e')) velocity.y += this.moveSpeed * delta;
        if (input.isKeyPressed('q')) velocity.y -= this.moveSpeed * delta;

        render.cameraGroup.position.x += velocity.x;
        render.cameraGroup.position.y += velocity.y;
        render.cameraGroup.position.z += velocity.z;
        render.cameraGroup.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // Sync targetPosition to camera for networking
        this.targetPosition = {
            x: render.cameraGroup.position.x,
            y: render.cameraGroup.position.y,
            z: render.cameraGroup.position.z
        };
    }

    private updateRemote(delta: number): void {
        // Position is handled by view lerp
    }

    public getNetworkState(): any {
        return {
            p: [this.targetPosition.x, this.targetPosition.y, this.targetPosition.z],
            name: 'Host'
        };
    }

    public applyNetworkState(state: any): void {
        if (state.p) {
            this.targetPosition = { x: state.p[0], y: state.p[1], z: state.p[2] };
        }
    }

    public destroy(): void {
        super.destroy();
        const render = gameState.managers.render;
        if (render && this.view) {
            (this.view as any).removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
