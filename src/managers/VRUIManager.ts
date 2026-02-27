import { GameContext } from '../core/GameState';
import { IUpdatable } from '../interfaces/IUpdatable';
import { TabletEntity } from '../entities/TabletEntity';
import { UITabPanel, UIElement } from '../utils/canvasui';
import { UITheme, getFont } from '../utils/UITheme';

export class VRUIManager implements IUpdatable {
    public tablet: TabletEntity | null = null;
    private tabPanel: UITabPanel | null = null;

    constructor(private context: GameContext) { }

    public init(): void {
        // Create the Tablet Entity
        this.tablet = new TabletEntity(this.context, 'local-tablet');

        // Add mesh to the scene rendering
        if (this.context.managers.render) {
            this.context.managers.render.scene.add(this.tablet.mesh);
        }

        // Add to Entity Manager so Grab works
        if (this.context.managers.entity) {
            // Because our ECS requires entities in the map to be findable by raycasters/skills
            // But we don't want it synced. We can manually add it with a local prefix:
            this.context.managers.entity.addEntity(this.tablet as any);
        }

        // Setup the Main Layout (1280x800 landscape)
        this.tabPanel = new UITabPanel(0, 0, 1280, 800);
        this.tablet.ui.root.addChild(this.tabPanel);

        // Add default System Tab immediately
        this.addSystemTab();
    }

    private addSystemTab() {
        if (!this.tabPanel) return;

        const systemContainer = this.tabPanel.addTab('System Menu');

        // Can inject basic buttons for toggling voice or leaving
        import('../utils/canvasui').then(({ UIButton, UILabel }) => {
            const title = new UILabel("System Control", 50, 50, 1180, 80);
            title.font = getFont(UITheme.typography.sizes.title, 'bold');
            title.textColor = UITheme.colors.primary;
            title.textAlign = 'center';
            systemContainer.addChild(title);

            const voiceBtn = new UIButton("Toggle Voice", 220, 200, 400, 100, () => {
                this.context.voiceEnabled = !this.context.voiceEnabled;
                console.log("Voice toggled from VR UI:", this.context.voiceEnabled);
                voiceBtn.text = this.context.voiceEnabled ? "Voice: ON" : "Voice: OFF";
                voiceBtn.backgroundColor = this.context.voiceEnabled ? UITheme.colors.panelBgHover : UITheme.colors.panelBg;
                voiceBtn.borderColor = this.context.voiceEnabled ? UITheme.colors.primary : UITheme.colors.textMuted;
                this.tablet?.ui.markDirty();
            });
            systemContainer.addChild(voiceBtn);

            const leaveBtn = new UIButton("Leave Room", 660, 200, 400, 100, () => {
                const render = this.context.managers.render;
                if (render && render.isXRPresenting()) {
                    render.getXRSession()?.end().then(() => {
                        location.reload();
                    }).catch(() => {
                        location.reload();
                    });
                } else {
                    location.reload(); // Simple approach for now
                }
            });
            leaveBtn.backgroundColor = 'rgba(200, 40, 40, 0.4)';
            leaveBtn.borderColor = UITheme.colors.secondary;
            leaveBtn.textColor = UITheme.colors.secondary;
            leaveBtn.hoverColor = 'rgba(255, 0, 255, 0.6)';
            systemContainer.addChild(leaveBtn);
        });
    }

    /**
     * Expose a public API for Skills/Managers to add their own Tabs to the Tablet.
     * @param title Title of the tab
     * @param buildCallback Callback providing the container element to append UI components to
     */
    public addTab(title: string, buildCallback: (container: UIElement) => void): void {
        if (!this.tabPanel) return;
        const container = this.tabPanel.addTab(title);
        buildCallback(container);
        this.tablet?.ui.markDirty();
    }

    public update(delta: number): void {
        if (this.tablet) {
            this.tablet.update(delta);
        }
    }
}
