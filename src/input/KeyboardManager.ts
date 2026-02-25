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
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.keyboard['primary_action'] = false;
            }
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
