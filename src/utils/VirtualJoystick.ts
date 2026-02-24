interface JoystickOptions {
    radius: number;
    innerRadius: number;
}

export class VirtualJoystick {
    private container: HTMLElement | null;
    private options: JoystickOptions;
    private active: boolean = false;
    private basePos: { x: number, y: number } = { x: 0, y: 0 };
    private currentPos: { x: number, y: number } = { x: 0, y: 0 };
    private vector: { x: number, y: number } = { x: 0, y: 0 };

    private base!: HTMLDivElement;
    private stick!: HTMLDivElement;

    constructor(containerId: string, options: Partial<JoystickOptions> = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            radius: 60,
            innerRadius: 30,
            ...options
        };

        if (!this.container) return;

        this.initDOM();
        this.initEvents();
    }

    private initDOM(): void {
        this.base = document.createElement('div');
        this.base.style.position = 'absolute';
        this.base.style.width = `${this.options.radius * 2}px`;
        this.base.style.height = `${this.options.radius * 2}px`;
        this.base.style.borderRadius = '50%';
        this.base.style.border = '2px solid rgba(0, 255, 255, 0.3)';
        this.base.style.background = 'rgba(0, 255, 255, 0.05)';
        this.base.style.pointerEvents = 'none';
        this.base.style.display = 'block';
        this.base.style.opacity = '0.2';
        this.base.style.transition = 'opacity 0.2s';
        this.container!.appendChild(this.base);

        this.base.style.left = '50%';
        this.base.style.top = '50%';
        this.base.style.transform = 'translate(-50%, -50%)';

        this.stick = document.createElement('div');
        this.stick.style.position = 'absolute';
        this.stick.style.width = `${this.options.innerRadius * 2}px`;
        this.stick.style.height = `${this.options.innerRadius * 2}px`;
        this.stick.style.borderRadius = '50%';
        this.stick.style.background = 'cyan';
        this.stick.style.boxShadow = '0 0 10px cyan';
        this.stick.style.pointerEvents = 'none';
        this.stick.style.opacity = '0.7';
        this.base.appendChild(this.stick);

        this.stick.style.left = '50%';
        this.stick.style.top = '50%';
        this.stick.style.transform = 'translate(-50%, -50%)';
    }

    private initEvents(): void {
        if (!this.container) return;
        this.container.addEventListener('touchstart', (e) => this.handleStart(e), { passive: false });
        this.container.addEventListener('touchmove', (e) => this.handleMove(e), { passive: false });
        this.container.addEventListener('touchend', (e) => this.handleEnd(e), { passive: false });
        this.container.addEventListener('touchcancel', (e) => this.handleEnd(e), { passive: false });
    }

    private handleStart(e: TouchEvent): void {
        e.preventDefault();
        const touch = e.targetTouches[0];
        const rect = this.container!.getBoundingClientRect();

        this.active = true;
        this.basePos = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
        this.currentPos = { x: this.basePos.x, y: this.basePos.y };

        this.base.style.opacity = '1';
        this.base.style.left = `${this.basePos.x - this.options.radius}px`;
        this.base.style.top = `${this.basePos.y - this.options.radius}px`;
        this.base.style.transform = 'none';

        this.updateVector();
    }

    private handleMove(e: TouchEvent): void {
        if (!this.active) return;
        e.preventDefault();

        const touch = e.targetTouches[0];
        const rect = this.container!.getBoundingClientRect();
        this.currentPos = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };

        const dx = this.currentPos.x - this.basePos.x;
        const dy = this.currentPos.y - this.basePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > this.options.radius) {
            const angle = Math.atan2(dy, dx);
            this.currentPos.x = this.basePos.x + Math.cos(angle) * this.options.radius;
            this.currentPos.y = this.basePos.y + Math.sin(angle) * this.options.radius;
        }

        const stickX = this.currentPos.x - this.basePos.x;
        const stickY = this.currentPos.y - this.basePos.y;
        this.stick.style.transform = `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`;

        this.updateVector();
    }

    private handleEnd(e: TouchEvent): void {
        this.active = false;
        this.base.style.opacity = '0.2';
        this.base.style.left = '50%';
        this.base.style.top = '50%';
        this.base.style.transform = 'translate(-50%, -50%)';
        this.stick.style.transform = 'translate(-50%, -50%)';
        this.vector = { x: 0, y: 0 };
    }

    private updateVector(): void {
        const dx = this.currentPos.x - this.basePos.x;
        const dy = this.currentPos.y - this.basePos.y;
        this.vector.x = dx / this.options.radius;
        this.vector.y = dy / this.options.radius;
    }

    public getVector(): { x: number, y: number } {
        return this.vector;
    }
}
