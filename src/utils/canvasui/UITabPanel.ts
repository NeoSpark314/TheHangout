import { UIElement } from './UIElement';
import { UITheme, getFont } from '../UITheme';

export class UITabPanel extends UIElement {
    public tabs: { name: string, container: UIElement }[] = [];
    private activeTabIndex: number = 0;

    private tabBarHeight: number = 80;

    // UI elements for rendering
    private tabBar: UIElement;
    private contentArea: UIElement;

    constructor(x: number = 0, y: number = 0, width: number = 500, height: number = 400) {
        super(x, y, width, height);
        this.backgroundColor = UITheme.colors.background;
        this.borderWidth = 0;
        this.borderColor = 'transparent';

        this.tabBar = new UIElement(0, 0, width, this.tabBarHeight);
        this.tabBar.backgroundColor = UITheme.colors.panelBg;
        this.tabBar.borderWidth = 0;
        this.tabBar.borderColor = UITheme.colors.primary;
        this.tabBar.borderWidth = 0; // The bottom border will be on the active tab
        this.tabBar.cornerRadius = 0;
        super.addChild(this.tabBar);

        this.contentArea = new UIElement(0, this.tabBarHeight, width, height - this.tabBarHeight);
        this.contentArea.backgroundColor = 'transparent';
        this.contentArea.borderWidth = 0;
        super.addChild(this.contentArea);
    }

    public addTab(name: string): UIElement {
        const container = new UIElement(0, 0, this.width, this.height - this.tabBarHeight);
        container.backgroundColor = 'transparent';
        container.borderWidth = 0;
        container.isVisible = this.tabs.length === 0; // First tab is visible by default

        this.tabs.push({ name, container });
        this.contentArea.addChild(container);

        this.rebuildTabBar();
        return container;
    }

    public setActiveTab(index: number): void {
        if (index >= 0 && index < this.tabs.length) {
            this.activeTabIndex = index;
            for (let i = 0; i < this.tabs.length; i++) {
                this.tabs[i].container.isVisible = (i === index);
            }
            this.rebuildTabBar();
        }
    }

    private rebuildTabBar(): void {
        this.tabBar.clearChildren();
        if (this.tabs.length === 0) return;

        const tabWidth = this.width / this.tabs.length;

        for (let i = 0; i < this.tabs.length; i++) {
            const tabBtn = new UIElement(i * tabWidth, 0, tabWidth, this.tabBarHeight);

            // Override handle click directly on the element
            const isSelfActive = (i === this.activeTabIndex);
            tabBtn.backgroundColor = isSelfActive ? UITheme.colors.panelBgHover : 'transparent';
            tabBtn.hoverColor = isSelfActive ? UITheme.colors.panelBgHover : 'rgba(255,255,255,0.05)';
            tabBtn.borderWidth = isSelfActive ? UITheme.styling.borderWidth : 0;
            tabBtn.borderColor = isSelfActive ? UITheme.colors.primary : 'transparent';
            tabBtn.cornerRadius = 0;

            // Add a drawSelf override to the instance to draw the text
            const tabName = this.tabs[i].name;
            const originalDraw = tabBtn['drawSelf'].bind(tabBtn);
            tabBtn['drawSelf'] = (ctx: CanvasRenderingContext2D) => {
                originalDraw(ctx);
                ctx.fillStyle = isSelfActive ? UITheme.colors.text : UITheme.colors.textMuted;
                ctx.font = getFont(UITheme.typography.sizes.body, isSelfActive ? 'bold' : 'normal');
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(tabName, tabWidth / 2, this.tabBarHeight / 2, tabWidth - 10);
            };

            // Hacky override for click event to avoid creating a whole specific class
            tabBtn['handleClick'] = () => {
                this.setActiveTab(i);
                return true;
            };

            this.tabBar.addChild(tabBtn);
        }
    }

    // Block adding children directly to the tab panel, redirect to content area if they try
    public addChild(child: UIElement): void {
        console.warn('UITabPanel: Use addTab() to add content to tabs instead of adding directly.');
    }
}
