import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { Vector3, Quaternion } from '../interfaces/IMath';
import gameState from '../core/GameState';

export class MovementSkill extends Skill {
    public speed: number = 5.0;
    public turnSpeed: number = 0.002;
    public pitch: number = 0;
    public yaw: number = 0;

    constructor() {
        super('movement', 'Movement', { alwaysActive: true });
    }

    public update(delta: number, player: LocalPlayer): void {
        const input = (gameState as any).managers.input;
        if (!input) return;

        const move = input.getMovementVector();
        const moveVector: Vector3 = { x: move.x, y: 0, z: move.y };

        if (moveVector.x !== 0 || moveVector.z !== 0) {
            // Logic to move player.xrOrigin based on moveVector
            // This needs to be yaw-aligned. 
            // Since we're trying to avoid THREE here, we might need some math utils.
            const cos = Math.cos(this.yaw);
            const sin = Math.sin(this.yaw);
            
            const worldX = moveVector.x * cos - moveVector.z * sin;
            const worldZ = moveVector.x * sin + moveVector.z * cos;

            player.xrOrigin.position.x += worldX * this.speed * delta;
            player.xrOrigin.position.z += worldZ * this.speed * delta;
        }

        player._lastMoveVector = moveVector;
    }
}
