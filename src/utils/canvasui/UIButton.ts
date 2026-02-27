import { UIElement } from './UIElement';

export class UIButton extends UIElement {
    public text: string = '';
    public font: string = 'bolt 24px Inter, Arial, sans-serif';
    public textColor: string = '#ffffff';

    private onClickCallback: (() => void) | null = null;

    constructor(
        text: string,
        x: number = 0, y: number = 0,
        width: number = 150, height: number = 50,
        onClick?: () => void
    ) {
        super(x, y, width, height);
        this.text = text;
        this.onClickCallback = onClick || null;
        this.backgroundColor = 'rgba(40, 40, 50, 0.8)';
        this.hoverColor = 'rgba(60, 60, 80, 0.9)';
        this.borderColor = '#00ffff';
        this.borderWidth = 2;
        this.cornerRadius = 8;
    }

    public onClick(cb: () => void): void {
        this.onClickCallback = cb;
    }

    protected handleClick(): boolean {
        if (this.onClickCallback) {
            this.onClickCallback();
            return true;
        }
        return false;
    }

    protected drawSelf(ctx: CanvasRenderingContext2D): void {
        super.drawSelf(ctx);

        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, this.width / 2, this.height / 2, this.width - 10);
    }
}
