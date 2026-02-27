import { UIElement } from './UIElement';

export class UIToggle extends UIElement {
    public text: string = '';
    public font: string = '24px Inter, Arial, sans-serif';
    public textColor: string = '#ffffff';
    public isChecked: boolean = false;

    public checkColor: string = '#00ffff';

    private onToggleCallback: ((checked: boolean) => void) | null = null;

    constructor(
        text: string,
        checked: boolean = false,
        x: number = 0, y: number = 0,
        width: number = 200, height: number = 40,
        onToggle?: (checked: boolean) => void
    ) {
        super(x, y, width, height);
        this.text = text;
        this.isChecked = checked;
        this.onToggleCallback = onToggle || null;
        this.backgroundColor = 'transparent';
        this.hoverColor = 'rgba(255, 255, 255, 0.1)';
        this.borderWidth = 0;
        this.cornerRadius = 4;
    }

    public onToggle(cb: (checked: boolean) => void): void {
        this.onToggleCallback = cb;
    }

    protected handleClick(): boolean {
        this.isChecked = !this.isChecked;
        if (this.onToggleCallback) {
            this.onToggleCallback(this.isChecked);
        }
        return true;
    }

    protected drawSelf(ctx: CanvasRenderingContext2D): void {
        super.drawSelf(ctx);

        // Draw checkbox box
        const boxSize = Math.min(24, this.height * 0.6);
        const boxY = (this.height - boxSize) / 2;
        const boxX = 5;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxSize, boxSize, 4);
        ctx.stroke();

        // Draw checkmark if checked
        if (this.isChecked) {
            ctx.fillStyle = this.checkColor;
            ctx.beginPath();
            ctx.roundRect(boxX + 4, boxY + 4, boxSize - 8, boxSize - 8, 2);
            ctx.fill();
        }

        // Draw text
        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, boxX + boxSize + 10, this.height / 2, this.width - boxSize - 20);
    }
}
