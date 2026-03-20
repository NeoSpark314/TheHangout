import * as THREE from 'three';

export class TargetTossScorePopup {
    public readonly root = new THREE.Group();
    private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    private readonly texture: THREE.CanvasTexture;
    private readonly lifetimeSec = 0.95;
    private readonly riseSpeed = 0.8;
    private elapsedSec = 0;
    private readonly tmpWorld = new THREE.Vector3();
    private readonly tmpLookTarget = new THREE.Vector3();

    constructor(points: number, color: number, position: { x: number; y: number; z: number }) {
        this.root.name = 'target-toss-score-popup';
        this.root.position.set(position.x, position.y + 0.22, position.z);

        const canvas = document.createElement('canvas');
        canvas.width = 384;
        canvas.height = 192;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Unable to create score popup canvas context.');
        }

        const label = '+' + points.toString();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 26;
        ctx.strokeStyle = 'rgba(10, 24, 40, 0.82)';
        ctx.font = '700 118px "Segoe UI", Arial, sans-serif';
        ctx.strokeText(label, canvas.width * 0.5, canvas.height * 0.52);
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.fillText(label, canvas.width * 0.5, canvas.height * 0.52);

        this.texture = new THREE.CanvasTexture(canvas);
        this.texture.generateMipmaps = false;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;

        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(0.72, 0.36),
            new THREE.MeshBasicMaterial({
                map: this.texture,
                transparent: true,
                depthWrite: false
            })
        );
        this.root.add(this.mesh);
    }

    public update(deltaSec: number, camera: THREE.Camera | null | undefined): boolean {
        this.elapsedSec += deltaSec;
        if (this.elapsedSec >= this.lifetimeSec) {
            return false;
        }

        const t = this.elapsedSec / this.lifetimeSec;
        this.root.position.y += deltaSec * this.riseSpeed;
        this.root.scale.setScalar(1 + t * 0.18);
        this.mesh.material.opacity = 1 - t;

        if (camera) {
            this.root.getWorldPosition(this.tmpWorld);
            this.tmpLookTarget.set(camera.position.x, this.tmpWorld.y, camera.position.z);
            this.root.lookAt(this.tmpLookTarget);
        }

        return true;
    }

    public dispose(): void {
        this.texture.dispose();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.root.removeFromParent();
    }
}
