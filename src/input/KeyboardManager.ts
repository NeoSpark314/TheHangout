export class KeyboardManager {
    private keyboard: Record<string, boolean> = {};
    private justPressed: Set<string> = new Set();

    constructor() {
        this.init();
    }

    private init(): void {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (!this.keyboard[key]) this.justPressed.add(key);
            this.keyboard[key] = true;
        });
        window.addEventListener('keyup', (e) => {
            this.keyboard[e.key.toLowerCase()] = false;
        });

        window.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.keyboard['primary_action'] = true;
                this.justPressed.add('primary_action');
            } else if (e.button === 2) {
                this.keyboard['secondary_action'] = true;
                this.justPressed.add('secondary_action');
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.keyboard['primary_action'] = false;
            } else if (e.button === 2) {
                this.keyboard['secondary_action'] = false;
            }
        });
        window.addEventListener('contextmenu', (e) => {
            // Prevent default right-click menu since we use it for interactions
            e.preventDefault();
        });
    }

    public isKeyPressed(key: string): boolean {
        return this.justPressed.has(key);
    }

    public isKeyDown(key: string): boolean {
        return !!this.keyboard[key];
    }

    public clearJustPressed(): void {
        this.justPressed.clear();
    }
}
