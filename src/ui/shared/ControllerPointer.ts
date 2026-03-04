export class ControllerPointer {
    private element: HTMLDivElement | null;
    private x = window.innerWidth * 0.5;
    private y = window.innerHeight * 0.5;
    private readonly speed: number;
    private readonly padding: number;

    constructor(id: string, speed = 880, padding = 12) {
        this.speed = speed;
        this.padding = padding;
        this.element = this.createElement(id);
    }

    public show(): void {
        if (!this.element) return;
        this.element.classList.remove('is-hidden');
    }

    public hide(): void {
        if (!this.element) return;
        this.element.classList.add('is-hidden');
    }

    public reset(): void {
        this.x = window.innerWidth * 0.5;
        this.y = window.innerHeight * 0.5;
        this.render();
    }

    public move(delta: number, stick: { x: number; y: number }): { x: number; y: number } | null {
        if (!this.element) return null;

        const nextX = this.x + (stick.x * this.speed * delta);
        const nextY = this.y + (stick.y * this.speed * delta);
        this.x = Math.max(this.padding, Math.min(window.innerWidth - this.padding, nextX));
        this.y = Math.max(this.padding, Math.min(window.innerHeight - this.padding, nextY));
        this.render();

        return { x: this.x, y: this.y };
    }

    public destroy(): void {
        if (this.element && this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
        this.element = null;
    }

    private render(): void {
        if (!this.element) return;
        this.element.style.transform = `translate(${this.x}px, ${this.y}px)`;
    }

    private createElement(id: string): HTMLDivElement | null {
        if (typeof document === 'undefined') return null;

        const cursor = document.createElement('div');
        cursor.id = id;
        cursor.className = 'controller-cursor is-hidden';
        document.body.appendChild(cursor);
        return cursor;
    }
}
