import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { Vector3 } from '../interfaces/IMath';
import gameState from '../core/GameState';

export class MovementSkill extends Skill {
    public speed: number = 5.0;
    public turnSpeed: number = 0.002;
    public pitch: number = 0;
    public yaw: number = 0;
    private _inputListenersAttached: boolean = false;

    constructor() {
        super('movement', 'Movement', { alwaysActive: true });
    }

    public setYaw(yaw: number): void {
        this.yaw = yaw;
    }

    public activate(player: LocalPlayer): void {
        super.activate(player);
        if (!this._inputListenersAttached) {
            this._attachInputListeners(player);
            this._inputListenersAttached = true;
        }
    }

    private _attachInputListeners(player: LocalPlayer): void {
        const canvas = document.getElementById('app');
        if (!canvas) return;

        canvas.addEventListener('click', () => {
            const render = gameState.managers.render;
            if (render && !render.isXRPresenting()) {
                canvas.requestPointerLock();
            }
        });

        document.addEventListener('mousemove', (e) => {
            const render = gameState.managers.render;
            if (document.pointerLockElement === canvas && render && !render.isXRPresenting()) {
                this.yaw -= e.movementX * this.turnSpeed;
                this.pitch -= e.movementY * this.turnSpeed;
                this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
            }
        });
    }

    public update(delta: number, player: LocalPlayer): void {
        const render = gameState.managers.render;
        const input = gameState.managers.input;
        if (!render || !input) return;

        const isVR = render.isXRPresenting();

        // 1. Orientation
        if (!isVR) {
            player.headPose.quaternion = {
                x: Math.sin(this.pitch / 2),
                y: 0,
                z: 0,
                w: Math.cos(this.pitch / 2)
            };
            player.xrOrigin.quaternion = {
                x: 0,
                y: Math.sin(this.yaw / 2),
                z: 0,
                w: Math.cos(this.yaw / 2)
            };
        }

        // 2. Sync Renderer
        render.cameraGroup.position.set(player.xrOrigin.position.x, player.xrOrigin.position.y, player.xrOrigin.position.z);
        render.cameraGroup.quaternion.set(player.xrOrigin.quaternion.x, player.xrOrigin.quaternion.y, player.xrOrigin.quaternion.z, player.xrOrigin.quaternion.w);

        if (!isVR) {
            render.camera.position.set(player.headPose.position.x, player.headPose.position.y, player.headPose.position.z);
            render.camera.quaternion.set(player.headPose.quaternion.x, player.headPose.quaternion.y, player.headPose.quaternion.z, player.headPose.quaternion.w);
        }

        // 3. Locomotion
        const move = input.getMovementVector();
        const moveVector: Vector3 = { x: move.x, y: 0, z: move.y };

        if (moveVector.x !== 0 || moveVector.z !== 0) {
            const headYaw = isVR ? (render.camera as any).rotation.y : this.yaw;
            const cos = Math.cos(headYaw);
            const sin = Math.sin(headYaw);
            const worldX = moveVector.x * cos + moveVector.z * sin;
            const worldZ = -moveVector.x * sin + moveVector.z * cos;

            player.xrOrigin.position.x += worldX * this.speed * delta;
            player.xrOrigin.position.z += worldZ * this.speed * delta;
        }

        player._lastMoveVector = moveVector;
    }
}
