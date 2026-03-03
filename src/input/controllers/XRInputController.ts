import { AppContext } from '../../app/AppContext';

export class XRInputManager {
    public move: { x: number, y: number } = { x: 0, y: 0 };
    public turn: number = 0;

    constructor(private context: AppContext) { }

    public poll(frame?: XRFrame): void {
        this.move = { x: 0, y: 0 };
        this.turn = 0;

        const render = this.context.managers.render;
        if (!render || !render.isXRPresenting()) return;

        const session = render.getXRSession();
        if (!session) return;

        for (const source of session.inputSources) {
            if (source.gamepad) {
                const axes = source.gamepad.axes;
                // Standard mapping: Left stick for move, Right stick for turn
                if (source.handedness === 'left') {
                    // axes[2], axes[3] are often the sticks on many controllers
                    const dx = axes.length >= 4 ? axes[2] : axes[0];
                    const dy = axes.length >= 4 ? axes[3] : axes[1];
                    if (Math.abs(dx) > 0.1) this.move.x += dx;
                    if (Math.abs(dy) > 0.1) this.move.y += dy;
                } else if (source.handedness === 'right') {
                    const dx = axes.length >= 4 ? axes[2] : axes[0];
                    if (Math.abs(dx) > 0.1) this.turn = dx;
                }
            }
        }
    }
}
