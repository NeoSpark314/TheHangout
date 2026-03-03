import { VirtualJoystick } from './VirtualJoystick';

export class MobileJoystickManager {
    public move: VirtualJoystick | null = null;
    public look: VirtualJoystick | null = null;

    public init(): void {
        const left = document.getElementById('joystick-left');
        const right = document.getElementById('joystick-right');
        if (left) left.innerHTML = '';
        if (right) right.innerHTML = '';

        this.move = new VirtualJoystick('joystick-left');
        this.look = new VirtualJoystick('joystick-right');
    }

    public getMoveVector(): { x: number, y: number } {
        return this.move ? this.move.getVector() : { x: 0, y: 0 };
    }

    public getLookVector(): { x: number, y: number } {
        return this.look ? this.look.getVector() : { x: 0, y: 0 };
    }
}
