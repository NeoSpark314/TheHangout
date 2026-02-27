export class UIElement {
    public x: number = 0;
    public y: number = 0;
    public width: number = 100;
    public height: number = 50;
    public isVisible: boolean = true;
    public isHovered: boolean = false;

    public children: UIElement[] = [];
    public parent: UIElement | null = null;

    // Optional style overrides
    public backgroundColor: string = 'rgba(30, 30, 35, 0.8)';
    public hoverColor: string = 'rgba(50, 50, 60, 0.9)';
    public borderColor: string = '#00ffff';
    public borderWidth: number = 2;
    public cornerRadius: number = 10;
    public layoutConfig: any = {}; // Used by parent layouts

    constructor(
        x: number = 0, y: number = 0,
        width: number = 100, height: number = 50
    ) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    public addChild(child: UIElement): void {
        child.parent = this;
        this.children.push(child);
    }

    public removeChild(child: UIElement): void {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parent = null;
        }
    }

    public clearChildren(): void {
        this.children.forEach(c => c.parent = null);
        this.children = [];
    }

    /**
     * Checks if a point (relative to this element's parent coordinate space) is inside this element.
     */
    public containsPoint(px: number, py: number): boolean {
        return px >= this.x && px <= this.x + this.width &&
            py >= this.y && py <= this.y + this.height;
    }

    /**
     * Propagates a pointer move event down the tree to determine hover states.
     * Returns true if this element or a child handled the event (for dirty checking).
     * @param px X coordinate in parent's local space
     * @param py Y coordinate in parent's local space
     */
    public onPointerMove(px: number, py: number): boolean {
        if (!this.isVisible) return false;

        let dirty = false;
        const inside = this.containsPoint(px, py);

        if (inside !== this.isHovered) {
            this.isHovered = inside;
            dirty = true;
        }

        if (inside) {
            // Transform coordinates to local space for children
            const localX = px - this.x;
            const localY = py - this.y;
            for (let i = this.children.length - 1; i >= 0; i--) {
                const childDirty = this.children[i].onPointerMove(localX, localY);
                if (childDirty) dirty = true;
            }
        } else {
            // Unhover all children if this parent is unhovered
            if (this.clearHoverState()) {
                dirty = true;
            }
        }

        return dirty;
    }

    public clearHoverState(): boolean {
        let dirty = false;
        if (this.isHovered) {
            this.isHovered = false;
            dirty = true;
        }
        for (const child of this.children) {
            if (child.clearHoverState()) dirty = true;
        }
        return dirty;
    }

    /**
     * Propagates a pointer click event down the tree.
     * Returns true if this element or a child handled the event (for dirty checking).
     * @param px X coordinate in parent's local space
     * @param py Y coordinate in parent's local space
     */
    public onPointerClick(px: number, py: number): boolean {
        if (!this.isVisible) return false;

        if (this.containsPoint(px, py)) {
            let handled = false;
            // Transform to local space
            const localX = px - this.x;
            const localY = py - this.y;

            // Check children first (top-down visual order so reverse array iteration if they overlap)
            for (let i = this.children.length - 1; i >= 0; i--) {
                const child = this.children[i];
                if (child.containsPoint(localX, localY)) {
                    if (child.onPointerClick(localX, localY)) {
                        handled = true;
                        break; // Stop propagation to siblings below
                    }
                }
            }

            if (!handled) {
                // Handle it ourselves
                return this.handleClick();
            }
            return handled;
        }
        return false;
    }

    protected handleClick(): boolean {
        // To be overridden by interactable elements like UIButton
        return false;
    }

    /**
     * Renders this element and its children.
     * @param ctx Canvas rendering context
     */
    public render(ctx: CanvasRenderingContext2D): void {
        if (!this.isVisible) return;

        ctx.save();
        ctx.translate(this.x, this.y);

        this.drawSelf(ctx);

        for (const child of this.children) {
            child.render(ctx);
        }

        ctx.restore();
    }

    protected drawSelf(ctx: CanvasRenderingContext2D): void {
        // Base implementation draws a simple background box.
        // Can be overridden or left empty for container elements.
        ctx.fillStyle = this.isHovered ? this.hoverColor : this.backgroundColor;

        if (this.cornerRadius > 0) {
            ctx.beginPath();
            ctx.roundRect(0, 0, this.width, this.height, this.cornerRadius);
            ctx.fill();
            if (this.borderWidth > 0 && this.borderColor) {
                ctx.lineWidth = this.borderWidth;
                ctx.strokeStyle = this.borderColor;
                ctx.stroke();
            }
        } else {
            ctx.fillRect(0, 0, this.width, this.height);
            if (this.borderWidth > 0 && this.borderColor) {
                ctx.lineWidth = this.borderWidth;
                ctx.strokeStyle = this.borderColor;
                ctx.strokeRect(0, 0, this.width, this.height);
            }
        }
    }
}
