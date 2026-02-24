import * as THREE from 'three';
import { EntityView } from './EntityView';
import { Vector3 } from '../interfaces/IMath';

export interface SpectatorViewState {
    position: Vector3;
    lerpFactor?: number;
}

export class SpectatorView extends EntityView<SpectatorViewState> {
    private ring: THREE.Mesh | null = null;

    constructor() {
        super(new THREE.Group());
        this._buildGeometry();
    }

    private _buildGeometry(): void {
        const geometry = new THREE.SphereGeometry(0.15, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
            transparent: true,
            opacity: 0.7
        });
        const orb = new THREE.Mesh(geometry, material);
        this.mesh.add(orb);

        const ringGeometry = new THREE.RingGeometry(0.2, 0.25, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });
        this.ring = new THREE.Mesh(ringGeometry, ringMaterial);
        this.mesh.add(this.ring);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = 256;
        canvas.height = 64;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        (ctx as any).roundRect(0, 0, canvas.width, canvas.height, 10);
        ctx.fill();
        ctx.font = 'bold 36px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ff00ff';
        ctx.fillText('HOST', canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const nameSprite = new THREE.Sprite(spriteMaterial);
        nameSprite.scale.set(0.5, 0.125, 1);
        nameSprite.position.y = 0.35;
        this.mesh.add(nameSprite);
    }

    public applyState(state: SpectatorViewState, delta: number): void {
        const lerpFactor = state.lerpFactor ?? 1.0;
        if (state.position) {
            const pos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
            if (lerpFactor < 1.0) {
                this.mesh.position.lerp(pos, lerpFactor);
            } else {
                this.mesh.position.copy(pos);
            }
        }

        if (this.ring) {
            this.ring.rotation.x += delta * 1.5;
            this.ring.rotation.y += delta * 0.8;
        }
    }

    public destroy(): void {
        this.mesh.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                const material = mesh.material as any;
                if (material.map) material.map.dispose();
                material.dispose();
            }
        });
    }
}
