import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { IGrabbable } from '../interfaces/IGrabbable';
import { IInteractable } from '../interfaces/IInteractable';
import { IInteractionEvent } from '../interfaces/IInteractionEvent';
import { IVector3, IQuaternion } from '../interfaces/IMath';
import { CanvasUI } from '../utils/canvasui';

export class TabletEntity implements IGrabbable, IInteractable {
    public id: string;
    public type: string = 'TABLET';
    public isAuthority: boolean = true;
    public ownerId: string | undefined;

    public isGrabbable: boolean = true;
    public heldBy: string | null = null;

    public mesh: THREE.Mesh;
    public ui: CanvasUI;

    public isRelative: boolean = true;
    public relativePosition: THREE.Vector3 = new THREE.Vector3(0, -0.2, -0.4);

    private context: GameContext;
    private position: THREE.Vector3;
    private quaternion: THREE.Quaternion;

    private frames: number = 0;

    constructor(context: GameContext, id: string) {
        this.context = context;
        this.id = id;

        // Initial positions will be overridden by relative tracking in update()
        this.position = new THREE.Vector3();
        this.quaternion = new THREE.Quaternion();

        // Create Canvas UI
        // Resolution 1280x800, physical size 0.48x0.30 meters
        this.ui = new CanvasUI(1280, 800);

        // Set root background
        this.ui.root.backgroundColor = 'rgba(15, 15, 20, 0.95)';
        this.ui.root.cornerRadius = 30;
        this.ui.root.borderWidth = 5;
        this.ui.root.borderColor = '#333';

        const geometry = new THREE.PlaneGeometry(0.480, 0.300);
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
        this.frames++;
        if (this.frames < 5) {
            this.ui.markDirty();
        }

        if (this.isRelative && this.context.localPlayer && 'headState' in this.context.localPlayer) {
            const head = (this.context.localPlayer as any).headState;
            const tracking = this.context.managers.tracking.getState();
            const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tracking.head.yaw);

            this.position.copy(this.relativePosition).applyQuaternion(yawQuat).add({ x: head.position.x, y: head.position.y, z: head.position.z });

            const tiltQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI * 0.15, 0, 0));
            this.quaternion.copy(yawQuat).multiply(tiltQuat);

            this.mesh.position.copy(this.position);
            this.mesh.quaternion.copy(this.quaternion);
        }

        this.ui.update();
    }

    // --- IInteractable ---
    public onHoverEnter(playerId: string): void { }
    public onHoverExit(playerId: string): void { }
    public onInteraction(event: IInteractionEvent): void { }

    // --- IGrabbable ---
    public onGrab(playerId: string, hand: 'left' | 'right'): void {
        this.heldBy = playerId;
        this.isRelative = false;
    }

    public onRelease(velocity?: IVector3): void {
        this.heldBy = null;
        this.isRelative = true;

        if (this.context.localPlayer && 'headState' in this.context.localPlayer) {
            const head = (this.context.localPlayer as any).headState;
            const tracking = this.context.managers.tracking.getState();
            const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tracking.head.yaw);
            const invYawQuat = yawQuat.clone().invert();

            this.relativePosition.copy(this.position).sub({ x: head.position.x, y: head.position.y, z: head.position.z }).applyQuaternion(invYawQuat);
        }
    }

    public updateGrabbedPose(position: IVector3, quaternion: IQuaternion): void {
        this.position.set(position.x, position.y, position.z);
        this.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);
    }
}
