import * as THREE from 'three';

export class NameTagComponent {
    private nameTag: THREE.Sprite | null = null;
    private currentName = '';
    private color: string | number;

    constructor(
        private parent: THREE.Object3D,
        private getAnchorY: () => number,
        initialColor: string | number
    ) {
        this.color = initialColor;
    }

    public setColor(color: string | number): void {
        this.color = color;
        if (this.nameTag && this.currentName) {
            this.setName(this.currentName);
        }
    }

    public setName(name: string): void {
        if (name === this.currentName && this.nameTag) return;
        this.currentName = name || '';

        if (!name) {
            if (this.nameTag) {
                this.parent.remove(this.nameTag);
                if (this.nameTag.material.map) {
                    this.nameTag.material.map.dispose();
                }
                this.nameTag.material.dispose();
                this.nameTag = null;
            }
            return;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = 512;
        canvas.height = 128;

        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        const radius = 30;
        context.beginPath();
        context.moveTo(radius, 0);
        context.lineTo(canvas.width - radius, 0);
        context.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
        context.lineTo(canvas.width, canvas.height - radius);
        context.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
        context.lineTo(radius, canvas.height);
        context.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
        context.lineTo(0, radius);
        context.quadraticCurveTo(0, 0, radius, 0);
        context.closePath();
        context.fill();

        context.font = 'bold 70px Inter, Arial, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        const fillStyle = typeof this.color === 'string' && this.color.startsWith('#')
            ? this.color
            : '#' + (this.color as number).toString(16).padStart(6, '0');

        context.fillStyle = fillStyle;
        context.shadowColor = 'rgba(0, 0, 0, 0.9)';
        context.shadowBlur = 6;
        context.fillText(name.toUpperCase(), canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });

        if (this.nameTag) {
            const oldMap = this.nameTag.material.map;
            this.nameTag.material = spriteMaterial;
            if (oldMap) oldMap.dispose();
        } else {
            this.nameTag = new THREE.Sprite(spriteMaterial);
            this.nameTag.scale.set(1.0, 0.25, 1.0);
            this.parent.add(this.nameTag);
        }

        this.updatePosition();
    }

    public updatePosition(): void {
        if (!this.nameTag) return;
        this.nameTag.position.y = this.getAnchorY() + 0.45;
    }

    public destroy(): void {
        if (!this.nameTag) return;
        if (this.nameTag.material.map) this.nameTag.material.map.dispose();
        this.nameTag.material.dispose();
        this.parent.remove(this.nameTag);
        this.nameTag = null;
    }
}
