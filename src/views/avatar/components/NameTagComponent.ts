import * as THREE from 'three';

export class NameTagComponent {
    private nameTag: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
    private currentName = '';
    private color: string | number;
    private readonly worldUp = new THREE.Vector3(0, 1, 0);
    private readonly tmpCameraPos = new THREE.Vector3();
    private readonly tmpTagPos = new THREE.Vector3();

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

        const displayText = name.trim();
        const paddingX = 56;
        const minCanvasWidth = 384;
        const maxCanvasWidth = 1024;
        const canvasHeight = 128;
        const maxTextWidth = maxCanvasWidth - (paddingX * 2);
        const minFontSize = 30;
        let fontSize = 64;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        context.font = '600 64px "Inter", "Segoe UI", Arial, sans-serif';

        while (fontSize > minFontSize) {
            context.font = `600 ${fontSize}px "Inter", "Segoe UI", Arial, sans-serif`;
            if (context.measureText(displayText).width <= maxTextWidth) break;
            fontSize -= 2;
        }

        const measured = Math.ceil(context.measureText(displayText).width);
        canvas.width = Math.min(maxCanvasWidth, Math.max(minCanvasWidth, measured + (paddingX * 2)));
        canvas.height = canvasHeight;
        context.clearRect(0, 0, canvas.width, canvas.height);

        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        const radius = 28;
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

        context.font = `600 ${fontSize}px "Inter", "Segoe UI", Arial, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        const fillStyle = typeof this.color === 'string' && this.color.startsWith('#')
            ? this.color
            : '#' + (this.color as number).toString(16).padStart(6, '0');

        context.fillStyle = fillStyle;
        context.shadowColor = 'rgba(0, 0, 0, 0.9)';
        context.shadowBlur = 6;
        context.fillText(displayText, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false
        });

        const worldHeight = 0.25;
        const worldWidth = worldHeight * (canvas.width / canvas.height);

        if (this.nameTag) {
            const oldMap = this.nameTag.material.map;
            this.nameTag.material.dispose();
            this.nameTag.material = material;
            this.nameTag.scale.set(worldWidth, worldHeight, 1);
            if (oldMap) oldMap.dispose();
        } else {
            const geometry = new THREE.PlaneGeometry(1, 1);
            this.nameTag = new THREE.Mesh(geometry, material);
            this.nameTag.up.copy(this.worldUp);
            this.nameTag.scale.set(worldWidth, worldHeight, 1);
            this.parent.add(this.nameTag);
        }

        this.updatePosition();
    }

    public updatePosition(): void {
        if (!this.nameTag) return;
        this.nameTag.position.y = this.getAnchorY() + 0.45;
    }

    public faceCamera(camera: THREE.Camera | null | undefined): void {
        if (!this.nameTag || !camera) return;
        camera.getWorldPosition(this.tmpCameraPos);
        this.nameTag.getWorldPosition(this.tmpTagPos);
        this.tmpCameraPos.y = this.tmpTagPos.y;
        this.nameTag.up.copy(this.worldUp);
        this.nameTag.lookAt(this.tmpCameraPos);
    }

    public destroy(): void {
        if (!this.nameTag) return;
        if (this.nameTag.material.map) this.nameTag.material.map.dispose();
        this.nameTag.geometry.dispose();
        this.nameTag.material.dispose();
        this.parent.remove(this.nameTag);
        this.nameTag = null;
    }
}
