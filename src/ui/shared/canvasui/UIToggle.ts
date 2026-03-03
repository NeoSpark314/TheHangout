import { UIElement } from './UIElement';
import { UITheme, getFont } from '../UITheme';

export class UIToggle extends UIElement {
    public text: string = '';
    public font: string = getFont(UITheme.typography.sizes.body);
    public textColor: string = UITheme.colors.text;
    public isChecked: boolean = false;

    public checkColor: string = UITheme.colors.primary;

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
        this.hoverColor = 'rgba(255, 255, 255, 0.05)';
        this.borderWidth = 0;
        this.cornerRadius = UITheme.styling.cornerRadius;
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
        const boxSize = Math.min(UITheme.typography.sizes.body, this.height * 0.6);
        const boxY = (this.height - boxSize) / 2;
        const boxX = 5;

        ctx.strokeStyle = UITheme.colors.text;
        ctx.lineWidth = 3;
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
