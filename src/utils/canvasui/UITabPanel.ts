import { UIElement } from './UIElement';

export class UITabPanel extends UIElement {
    private tabs: { name: string, container: UIElement }[] = [];
    private activeTabIndex: number = 0;

    private tabBarHeight: number = 50;

    // UI elements for rendering
    private tabBar: UIElement;
    private contentArea: UIElement;

    constructor(x: number = 0, y: number = 0, width: number = 500, height: number = 400) {
        super(x, y, width, height);
        this.backgroundColor = 'rgba(20, 20, 25, 0.9)';
        this.borderWidth = 2;
        this.borderColor = '#444';

        this.tabBar = new UIElement(0, 0, width, this.tabBarHeight);
        this.tabBar.backgroundColor = 'rgba(10, 10, 15, 0.95)';
        this.tabBar.borderWidth = 0;
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
            tabBtn.backgroundColor = isSelfActive ? 'rgba(40, 40, 50, 1.0)' : 'rgba(20, 20, 25, 1.0)';
            tabBtn.hoverColor = isSelfActive ? 'rgba(50, 50, 60, 1.0)' : 'rgba(30, 30, 35, 1.0)';
            tabBtn.borderWidth = isSelfActive ? 2 : 1;
            tabBtn.borderColor = isSelfActive ? '#00ffff' : '#333';
            tabBtn.cornerRadius = 0;

            // Add a drawSelf override to the instance to draw the text
            const tabName = this.tabs[i].name;
            const originalDraw = tabBtn['drawSelf'].bind(tabBtn);
            tabBtn['drawSelf'] = (ctx: CanvasRenderingContext2D) => {
                originalDraw(ctx);
                ctx.fillStyle = isSelfActive ? '#ffffff' : '#aaaaaa';
                ctx.font = isSelfActive ? 'bold 20px Inter, Arial, sans-serif' : '20px Inter, Arial, sans-serif';
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
