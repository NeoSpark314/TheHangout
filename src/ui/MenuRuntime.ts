import { AppContext } from '../app/AppContext';

export class MenuRuntime {
    constructor(private readonly context: AppContext) { }

    public open(options: { recenter?: boolean } = {}): void {
        const vrUi = this.context.runtime.vrUi;
        if (vrUi?.isReady?.()) {
            vrUi.openMenu(options);
            return;
        }

        this.context.runtime.flatUi?.openMenu?.();
    }

    public close(): void {
        this.context.runtime.vrUi?.closeMenu?.();
        this.context.runtime.flatUi?.closeMenu?.();
        this.context.isMenuOpen = false;
    }

    public toggle(): void {
        const vrUi = this.context.runtime.vrUi;
        if (vrUi?.isReady?.()) {
            vrUi.toggleMenu();
            return;
        }

        this.context.runtime.flatUi?.toggleMenu?.();
    }
}
