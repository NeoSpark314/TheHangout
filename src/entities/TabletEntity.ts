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
    public relativePosition: THREE.Vector3 = new THREE.Vector3(0, -0.3, -0.5);
    public relativeQuaternion: THREE.Quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI * 0.1, 0, 0));

    private context: GameContext;
    private position: THREE.Vector3;
    private quaternion: THREE.Quaternion;

    private leftHandle: THREE.Mesh;
    private rightHandle: THREE.Mesh;

    private isRecentering: boolean = false;
    private hasSpawned: boolean = false;

    constructor(context: GameContext, id: string) {
        this.context = context;
        this.id = id;

        // Initial positions will be overridden by relative tracking in update() once localPlayer is initialized
        this.position = new THREE.Vector3();
        this.quaternion = new THREE.Quaternion();

        // Create Canvas UI
        // Resolution 1280x800, physical size 0.384x0.240 meters (scaled down but keeping 16:10 ratio)
        this.ui = new CanvasUI(1280, 800);

        // Set root background
        this.ui.root.backgroundColor = 'rgba(15, 15, 20, 0.95)';
        this.ui.root.cornerRadius = 30;
        this.ui.root.borderWidth = 5;
        this.ui.root.borderColor = '#333';

        const geometry = new THREE.PlaneGeometry(0.384, 0.240);
        const material = new THREE.MeshBasicMaterial({
            map: this.ui.texture,
            transparent: true,
            side: THREE.DoubleSide,
            fog: false
        });

        this.mesh = new THREE.Mesh(geometry, material);
        // Link mesh to entity for raycasting
        this.mesh.userData = { entityId: this.id };

        // --- Create physical grab handles ---
        const handleWidth = 0.02;
        const handleHeight = 0.28;
        const handleDepth = 0.02;

        const handleGeo = new THREE.BoxGeometry(handleWidth, handleHeight, handleDepth);
        // Synthwave Cyan handle material
        const handleMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            roughness: 0.2,
            metalness: 0.8
        });

        this.leftHandle = new THREE.Mesh(handleGeo, handleMat);
        // Position handle on the left edge
        this.leftHandle.position.set(-0.384 / 2 - handleWidth / 2, 0, 0);
        this.leftHandle.userData = { entityId: this.id };
        this.mesh.add(this.leftHandle);

        this.rightHandle = new THREE.Mesh(handleGeo, handleMat);
        // Position handle on the right edge
        this.rightHandle.position.set(0.384 / 2 + handleWidth / 2, 0, 0);
        this.rightHandle.userData = { entityId: this.id };
        this.mesh.add(this.rightHandle);

        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);

        // Force an initial render
        this.ui.markDirty();
        this.ui.update();
    }

    public update(delta: number): void {
        const lp = this.context.localPlayer as any;
        if (this.isRelative && lp && lp.headState) {
            const head = lp.headState;
            const tracking = this.context.managers.tracking.getState();
            const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tracking.head.yaw);

            const idealPos = new THREE.Vector3().copy(this.relativePosition).applyQuaternion(yawQuat).add({ x: head.position.x, y: head.position.y, z: head.position.z });
            const idealQuat = new THREE.Quaternion().copy(yawQuat).multiply(this.relativeQuaternion);

            if (!this.hasSpawned) {
                // **Deterministic Spawn**: No hacks, no heuristics. 
                // We lock to the player's reported world transform on the very first frame they exist.
                this.position.copy(idealPos);
                this.quaternion.copy(idealQuat);

                this.mesh.position.copy(this.position);
                this.mesh.quaternion.copy(this.quaternion);
                this.mesh.updateMatrixWorld(true);

                this.hasSpawned = true;

                console.log(`[TabletEntity] Deterministic Spawn:`);
                console.log(` - Head: [${head.position.x.toFixed(2)}, ${head.position.y.toFixed(2)}, ${head.position.z.toFixed(2)}]`);
                console.log(` - Tablet: [${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}]`);
                return;
            }

            if (!this.isRecentering) {
                const dist = this.position.distanceTo(idealPos);
                const angleDist = this.quaternion.angleTo(idealQuat);
                const deadzoneDist = 0.5; // 0.5 meters
                const deadzoneAngle = Math.PI / 4; // 45 degrees

                if (dist > deadzoneDist || angleDist > deadzoneAngle) {
                    this.isRecentering = true;
                    // Log once when we start moving to follow
                    console.log(`[TabletEntity] Moving to follow player...`);
                }
            }

            if (this.isRecentering) {
                const lerpFactor = 1.0 - Math.exp(-delta * 6.0);
                this.position.lerp(idealPos, lerpFactor);
                this.quaternion.slerp(idealQuat, lerpFactor);

                if (this.position.distanceTo(idealPos) < 0.02 && this.quaternion.angleTo(idealQuat) < 0.05) {
                    this.isRecentering = false;
                }
            }

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

            // Store the dropped transform relative to the user's current head yaw
            const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tracking.head.yaw);
            const invYawQuat = yawQuat.clone().invert();

            this.relativePosition.copy(this.position)
                .sub({ x: head.position.x, y: head.position.y, z: head.position.z })
                .applyQuaternion(invYawQuat);

            this.relativeQuaternion.copy(invYawQuat).multiply(this.quaternion);

            // Prevent immediate snapback, user just placed it here
            this.isRecentering = false;
        }
    }

    public getGrabRoots(): THREE.Object3D[] {
        return [this.leftHandle, this.rightHandle];
    }

    public updateGrabbedPose(position: IVector3, quaternion: IQuaternion): void {
        this.position.set(position.x, position.y, position.z);
        this.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);
    }

    public setVisible(visible: boolean): void {
        this.mesh.visible = visible;
        // Also hide handles
        this.leftHandle.visible = visible;
        this.rightHandle.visible = visible;
    }
}
