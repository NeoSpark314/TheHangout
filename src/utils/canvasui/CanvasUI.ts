import * as THREE from 'three';
import { UIElement } from './UIElement';

export class CanvasUI {
    public canvas: HTMLCanvasElement;
    public context: CanvasRenderingContext2D;
    public texture: THREE.CanvasTexture;
    public root: UIElement;

    private isDirty: boolean = true;
    private needsTextureUpdate: boolean = true;

    constructor(public width: number, public height: number) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.context = this.canvas.getContext('2d')!;

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.generateMipmaps = false;

        this.root = new UIElement(0, 0, width, height);
        this.root.backgroundColor = 'transparent'; // Let children draw
        this.root.borderWidth = 0;
    }

    public markDirty(): void {
        this.isDirty = true;
    }

    /**
     * Call this in the render loop. Re-renders canvas if dirty.
     */
    public update(): void {
        if (this.isDirty) {
            this.render();
            this.isDirty = false;
            this.needsTextureUpdate = true;
        }

        if (this.needsTextureUpdate) {
            this.texture.needsUpdate = true;
            this.needsTextureUpdate = false;
        }
    }

    private render(): void {
        this.context.clearRect(0, 0, this.width, this.height);
        this.root.render(this.context);
    }

    /**
     * Handles a raycast UV hit from Three.js
     * @param uv THREE.Vector2 representing UV coordinates of hit on mesh
     */
    public onPointerMove(uv: THREE.Vector2): void {
        const px = uv.x * this.width;
        // UV y is usually inverted relative to canvas
        const py = (1.0 - uv.y) * this.height;

        if (this.root.onPointerMove(px, py)) {
            this.markDirty();
        }
    }

    /**
     * Call this when the pointer stops intersecting the mesh
     */
    public onPointerOut(): void {
        if (this.root.clearHoverState()) {
            this.markDirty();
        }
    }

    /**
     * Handle a click event at the given UV coordinates
     * @param uv THREE.Vector2 representing UV coordinates
     */
    public onPointerClick(uv: THREE.Vector2): boolean {
        const px = uv.x * this.width;
        const py = (1.0 - uv.y) * this.height;

        const handled = this.root.onPointerClick(px, py);
        if (handled) {
            this.markDirty();
        }
        return handled;
    }
}
