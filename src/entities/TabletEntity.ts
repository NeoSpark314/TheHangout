import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { IGrabbable } from '../interfaces/IGrabbable';
import { IVector3, IQuaternion } from '../interfaces/IMath';
import { CanvasUI } from '../utils/canvasui';

export class TabletEntity implements IGrabbable {
    public id: string;
    public type: string = 'TABLET';
    public isAuthority: boolean = true;
    public ownerId: string | undefined;

    public isGrabbable: boolean = true;
    public heldBy: string | null = null;

    public mesh: THREE.Mesh;
    public ui: CanvasUI;

    private context: GameContext;
    private position: THREE.Vector3;
    private quaternion: THREE.Quaternion;

    constructor(context: GameContext, id: string) {
        this.context = context;
        this.id = id;

        // Spawn slightly in front of the center
        this.position = new THREE.Vector3(0, 1.2, -0.6);
        this.quaternion = new THREE.Quaternion();

        // Tilt slightly upwards
        this.quaternion.setFromEuler(new THREE.Euler(-Math.PI * 0.15, 0, 0));

        // Create Canvas UI
        // Resolution 1024x1024, physical size 0.4x0.4 meters
        this.ui = new CanvasUI(1024, 1024);

        // Set root background
        this.ui.root.backgroundColor = 'rgba(15, 15, 20, 0.95)';
        this.ui.root.cornerRadius = 30;
        this.ui.root.borderWidth = 5;
        this.ui.root.borderColor = '#333';

        const geometry = new THREE.PlaneGeometry(0.4, 0.4);
        const material = new THREE.MeshBasicMaterial({
            map: this.ui.texture,
            transparent: true,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(geometry, material);
        // Link mesh to entity for raycasting
        this.mesh.userData = { entityId: this.id };

        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);

        // Force an initial render
        this.ui.markDirty();
        this.ui.update();
    }

    public update(delta: number): void {
        this.ui.update();
    }

    // --- IGrabbable ---
    public onGrab(playerId: string, hand: 'left' | 'right'): void {
        this.heldBy = playerId;
    }

    public onRelease(velocity?: IVector3): void {
        this.heldBy = null;
    }

    public updateGrabbedPose(position: IVector3, quaternion: IQuaternion): void {
        this.position.set(position.x, position.y, position.z);
        this.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);
    }
}
