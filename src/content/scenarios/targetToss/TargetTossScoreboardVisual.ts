import * as THREE from 'three';
import type { ITargetTossState } from './TargetTossTypes';

export class TargetTossScoreboardVisual {
    public readonly root = new THREE.Group();
    private readonly screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    private readonly canvas: HTMLCanvasElement;
    private readonly texture: THREE.CanvasTexture;
    private lastText = '';
    private readonly tmpRootWorld = new THREE.Vector3();
    private readonly tmpLookTarget = new THREE.Vector3();

    constructor(position: THREE.Vector3) {
        this.root.name = 'target-toss-scoreboard';
        this.root.position.copy(position);

        const postMaterial = new THREE.MeshStandardMaterial({
            color: 0x0b315f,
            emissive: 0x082348,
            emissiveIntensity: 0.22,
            metalness: 0.35,
            roughness: 0.58
        });
        const postLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), postMaterial);
        const postRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), postMaterial);
        postLeft.position.set(-0.95, 1.05, 0);
        postRight.position.set(0.95, 1.05, 0);

        const header = new THREE.Mesh(
            new THREE.BoxGeometry(2.15, 1.5, 0.08),
            new THREE.MeshStandardMaterial({
                color: 0x144d8f,
                emissive: 0x0d3564,
                emissiveIntensity: 0.25,
                metalness: 0.2,
                roughness: 0.45
            })
        );
        header.position.set(0, 2.0, -0.03);

        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = 768;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.generateMipmaps = false;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;

        this.screen = new THREE.Mesh(
            new THREE.PlaneGeometry(1.95, 1.38),
            new THREE.MeshBasicMaterial({
                map: this.texture,
                transparent: false
            })
        );
        this.screen.position.set(0, 2.0, 0.02);

        const base = new THREE.Mesh(
            new THREE.BoxGeometry(2.6, 0.16, 0.75),
            new THREE.MeshStandardMaterial({
                color: 0x184b7a,
                emissive: 0x0b2944,
                emissiveIntensity: 0.16,
                metalness: 0.16,
                roughness: 0.68
            })
        );
        base.position.set(0, 0.08, 0);

        this.root.add(postLeft, postRight, header, this.screen, base);
    }

    public update(state: ITargetTossState, getPlayerLabel: (playerId: string) => string): void {
        const currentPlayerId = state.playerOrder[state.currentTurnIndex] || null;
        const currentPlayerLabel = currentPlayerId ? getPlayerLabel(currentPlayerId) : 'Waiting For Players';
        const lines = state.playerOrder.length === 0
            ? ['No active players yet.']
            : state.playerOrder.map((playerId, index) => {
                const prefix = index === state.currentTurnIndex ? '> ' : '  ';
                const score = state.scores[playerId] ?? 0;
                return `${prefix}${getPlayerLabel(playerId)}  ${score} pts`;
            });

        const text = [
            'TARGET TOSS',
            `Turn: ${currentPlayerLabel}`,
            `Throws: ${state.throwsTaken}/3${state.resetPending ? '  |  Resetting...' : ''}`,
            '',
            ...lines
        ].join('\n');

        if (text === this.lastText) {
            return;
        }
        this.lastText = text;

        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const gradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, '#0d2d54');
        gradient.addColorStop(1, '#08182e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.strokeStyle = '#7be7ff';
        ctx.lineWidth = 10;
        ctx.strokeRect(12, 12, this.canvas.width - 24, this.canvas.height - 24);

        ctx.fillStyle = '#e8fbff';
        ctx.font = '700 76px "Segoe UI", Arial, sans-serif';
        ctx.fillText('TARGET TOSS', 56, 110);

        ctx.fillStyle = '#9fe8ff';
        ctx.font = '600 46px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`Turn: ${currentPlayerLabel}`, 56, 190);
        ctx.fillText(`Throws: ${state.throwsTaken}/3`, 56, 250);
        if (state.resetPending) {
            ctx.fillStyle = '#ffd166';
            ctx.fillText('Resetting...', 540, 250);
        }

        ctx.fillStyle = '#d9f8ff';
        ctx.font = '600 42px "Segoe UI", Arial, sans-serif';
        let y = 340;
        if (state.playerOrder.length === 0) {
            ctx.fillText('No active players yet.', 56, y);
        } else {
            for (const line of lines) {
                ctx.fillText(line, 56, y);
                y += 64;
            }
        }

        this.texture.needsUpdate = true;
    }

    public faceCamera(camera: THREE.Camera | null | undefined): void {
        if (!camera) return;
        this.root.getWorldPosition(this.tmpRootWorld);
        this.tmpLookTarget.set(camera.position.x, this.tmpRootWorld.y, camera.position.z);
        this.root.lookAt(this.tmpLookTarget);
    }

    public dispose(): void {
        this.root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach((material) => material.dispose());
            } else {
                mesh.material.dispose();
            }
        });
        this.texture.dispose();
        this.root.removeFromParent();
    }
}
