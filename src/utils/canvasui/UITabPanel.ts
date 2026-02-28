import { UIElement } from './UIElement';
import { UILabel } from './UILabel';
import { UITheme, getFont } from '../UITheme';

export interface UITab {
    name: string;
    container: UIElement;
    button: UIElement;
    label: UILabel;
}

export class UITabPanel extends UIElement {
    public tabs: UITab[] = [];
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
        this.tabBar.cornerRadius = 0;
        super.addChild(this.tabBar);

        this.contentArea = new UIElement(0, this.tabBarHeight, width, height - this.tabBarHeight);
        this.contentArea.backgroundColor = 'transparent';
        this.contentArea.borderWidth = 0;
        super.addChild(this.contentArea);
    }

    public addTab(name: string): UITab {
        const container = new UIElement(0, 0, this.width, this.height - this.tabBarHeight);
        container.backgroundColor = 'transparent';
        container.borderWidth = 0;
        container.isVisible = this.tabs.length === 0;

        const button = new UIElement(0, 0, 100, this.tabBarHeight);
        button.cornerRadius = 0;

        const label = new UILabel(name, 0, 0, 100, this.tabBarHeight);
        label.textAlign = 'center';
        label.textBaseline = 'middle';
        button.addChild(label);

        const tab: UITab = { name, container, button, label };
        this.tabs.push(tab);
        this.contentArea.addChild(container);
        this.tabBar.addChild(button);

        const index = this.tabs.length - 1;
        button['handleClick'] = () => {
            this.setActiveTab(index);
            return true;
        };

        this.updateLayout();
        return tab;
    }

    public updateTabName(index: number, name: string): void {
        if (index >= 0 && index < this.tabs.length) {
            const tab = this.tabs[index];
            tab.name = name;
            tab.label.text = name;
            // Mark the label's parent dirty if needed, though CanvasUI.update handles root
        }
    }

    public setActiveTab(index: number): void {
        if (index >= 0 && index < this.tabs.length) {
            this.activeTabIndex = index;
            this.updateLayout();
        }
    }

    private updateLayout(): void {
        if (this.tabs.length === 0) return;

        const tabWidth = this.width / this.tabs.length;

        for (let i = 0; i < this.tabs.length; i++) {
            const tab = this.tabs[i];
            const isSelfActive = (i === this.activeTabIndex);

            // Update Button Position & Style
            tab.button.x = i * tabWidth;
            tab.button.width = tabWidth;
            tab.button.backgroundColor = isSelfActive ? UITheme.colors.panelBgHover : 'transparent';
            tab.button.hoverColor = isSelfActive ? UITheme.colors.panelBgHover : 'rgba(255,255,255,0.05)';
            tab.button.borderWidth = isSelfActive ? UITheme.styling.borderWidth : 0;
            tab.button.borderColor = isSelfActive ? UITheme.colors.primary : 'transparent';

            // Update Label Position & Style
            tab.label.width = tabWidth;
            tab.label.textColor = isSelfActive ? UITheme.colors.text : UITheme.colors.textMuted;
            tab.label.font = getFont(UITheme.typography.sizes.body, isSelfActive ? 'bold' : 'normal');

            // Update Content Visibility
            tab.container.isVisible = isSelfActive;
        }
    }

    public addChild(child: UIElement): void {
        console.warn('UITabPanel: Use addTab() instead of adding directly.');
    }
}
