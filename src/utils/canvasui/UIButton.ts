import { UIElement } from './UIElement';
import { UITheme, getFont } from '../UITheme';

export class UIButton extends UIElement {
    public text: string = '';
    public font: string = getFont(UITheme.typography.sizes.body, 'bold');
    public textColor: string = UITheme.colors.text;

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
        this.backgroundColor = UITheme.colors.panelBg;
        this.hoverColor = UITheme.colors.panelBgHover;
        this.borderColor = UITheme.colors.primary;
        this.borderWidth = UITheme.styling.borderWidth;
        this.cornerRadius = UITheme.styling.cornerRadius;
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
