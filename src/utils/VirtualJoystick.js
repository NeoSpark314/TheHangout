// utils/VirtualJoystick.js

export class VirtualJoystick {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.options = {
            radius: 60,
            innerRadius: 30,
            ...options
        };

        this.active = false;
        this.basePos = { x: 0, y: 0 };
        this.currentPos = { x: 0, y: 0 };
        this.vector = { x: 0, y: 0 }; // Normalized output (-1 to 1)

        this.initDOM();
        this.initEvents();
    }

    initDOM() {
        // Create base (outer circle)
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
        this.container.appendChild(this.base);

        // Position base initially (we'll move it on touchstart if we want dynamic positioning, 
        // but for now let's just make it visible in its corner)
        this.base.style.left = '50%';
        this.base.style.top = '50%';
        this.base.style.transform = 'translate(-50%, -50%)';

        // Create stick (inner circle)
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

        // Center the stick in the base
        this.stick.style.left = '50%';
        this.stick.style.top = '50%';
        this.stick.style.transform = 'translate(-50%, -50%)';
    }

    initEvents() {
        this.container.addEventListener('touchstart', (e) => this.handleStart(e), { passive: false });
        this.container.addEventListener('touchmove', (e) => this.handleMove(e), { passive: false });
        this.container.addEventListener('touchend', (e) => this.handleEnd(e), { passive: false });
        this.container.addEventListener('touchcancel', (e) => this.handleEnd(e), { passive: false });
    }

    handleStart(e) {
        e.preventDefault();
        const touch = e.targetTouches[0];
        const rect = this.container.getBoundingClientRect();

        this.active = true;
        this.basePos = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
        this.currentPos = { x: this.basePos.x, y: this.basePos.y };

        // Position base at touch point
        this.base.style.opacity = '1';
        this.base.style.left = `${this.basePos.x - this.options.radius}px`;
        this.base.style.top = `${this.basePos.y - this.options.radius}px`;

        this.updateVector();
    }

    handleMove(e) {
        if (!this.active) return;
        e.preventDefault();

        const touch = e.targetTouches[0];
        const rect = this.container.getBoundingClientRect();
        this.currentPos = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };

        const dx = this.currentPos.x - this.basePos.x;
        const dy = this.currentPos.y - this.basePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Cap distance to radius
        if (distance > this.options.radius) {
            const angle = Math.atan2(dy, dx);
            this.currentPos.x = this.basePos.x + Math.cos(angle) * this.options.radius;
            this.currentPos.y = this.basePos.y + Math.sin(angle) * this.options.radius;
        }

        // Move stick
        const stickX = this.currentPos.x - this.basePos.x;
        const stickY = this.currentPos.y - this.basePos.y;
        this.stick.style.transform = `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`;

        this.updateVector();
    }

    handleEnd(e) {
        this.active = false;
        this.base.style.opacity = '0.2';
        this.stick.style.transform = 'translate(-50%, -50%)';
        this.vector = { x: 0, y: 0 };
    }

    updateVector() {
        const dx = this.currentPos.x - this.basePos.x;
        const dy = this.currentPos.y - this.basePos.y;

        // Normalize to -1..1
        this.vector.x = dx / this.options.radius;
        this.vector.y = dy / this.options.radius;
    }

    getVector() {
        return this.vector;
    }
}
