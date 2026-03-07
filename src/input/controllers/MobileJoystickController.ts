import { VirtualJoystick } from './VirtualJoystick';
import { IStickShapeConfig, shapeStickRadial } from './StickInputUtils';

export class MobileJoystickController {
    public move: VirtualJoystick | null = null;
    public look: VirtualJoystick | null = null;
    private readonly moveShape: IStickShapeConfig = { innerDeadzone: 0.1, outerDeadzone: 0.98, exponent: 1.5 };
    private readonly lookShape: IStickShapeConfig = { innerDeadzone: 0.12, outerDeadzone: 0.98, exponent: 2.2 };

    public init(): void {
        const left = document.getElementById('joystick-left');
        const right = document.getElementById('joystick-right');
        if (left) left.innerHTML = '';
        if (right) right.innerHTML = '';

        this.move = new VirtualJoystick('joystick-left');
        this.look = new VirtualJoystick('joystick-right');
    }

    public getMoveVector(): { x: number, y: number } {
        const raw = this.move ? this.move.getVector() : { x: 0, y: 0 };
        return shapeStickRadial(raw.x, raw.y, this.moveShape);
    }

    public getLookVector(): { x: number, y: number } {
        const raw = this.look ? this.look.getVector() : { x: 0, y: 0 };
        return shapeStickRadial(raw.x, raw.y, this.lookShape);
    }
}
