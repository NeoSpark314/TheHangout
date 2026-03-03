import { UIElement } from './UIElement';
import { UITheme, getFont } from '../UITheme';

export class UILabel extends UIElement {
    public text: string = '';
    public font: string = getFont(UITheme.typography.sizes.body);
    public textColor: string = UITheme.colors.text;
    public textAlign: CanvasTextAlign = 'left';
    public textBaseline: CanvasTextBaseline = 'middle';

    // Labels typically don't need a background unless requested
    constructor(
        text: string,
        x: number = 0, y: number = 0,
        width: number = 100, height: number = 50
    ) {
        super(x, y, width, height);
        this.text = text;
        this.backgroundColor = 'transparent';
        this.hoverColor = 'transparent';
        this.borderWidth = 0;
    }

    protected drawSelf(ctx: CanvasRenderingContext2D): void {
        // Draw background if not transparent
        if (this.backgroundColor !== 'transparent') {
            super.drawSelf(ctx);
        }

        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = this.textAlign;
        ctx.textBaseline = this.textBaseline;

        // Calculate text position
        let tx = 0;
        let ty = this.height / 2; // Middle baseline default

        if (this.textAlign === 'center') {
            tx = this.width / 2;
        } else if (this.textAlign === 'right') {
            tx = this.width;
        } else {
            tx = 5; // Slight padding for left
        }

        ctx.fillText(this.text, tx, ty, this.width - 10);
    }
}
