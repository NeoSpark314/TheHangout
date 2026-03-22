import * as THREE from 'three';
import { AppContext } from '../../app/AppContext';
import { IGrabbable } from '../../shared/contracts/IGrabbable';
import { IInteractable } from '../../shared/contracts/IInteractable';
import { IInteractionEvent } from '../../shared/contracts/IInteractionEvent';
import { IVector3, IQuaternion, IPose } from '../../shared/contracts/IMath';
import { IEntity } from '../../shared/contracts/IEntity';
import { CanvasUI } from '../../ui/shared/canvasui';
import { PlayerAvatarEntity } from './PlayerAvatarEntity';

export class TabletSurfaceEntity implements IEntity, IGrabbable, IInteractable {
    // Our canonical avatar/view space is +Z forward, so the default tablet
    // offset in front of the user must also be on +Z.
    private static readonly DEFAULT_RELATIVE_POSITION = new THREE.Vector3(0, -0.1, 0.5);
    private static readonly DEFAULT_RELATIVE_QUATERNION = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI * 0.0, 0, 0));

    public id: string;
    public type: string = 'TABLET';
    public isAuthority: boolean = true;
    public isDestroyed: boolean = false;
    public ownerId: string | null = null;

    public isHoldable: boolean = true;
    public isGrabbable: boolean = true;
    public heldBy: string | null = null;

    public mesh: THREE.Mesh;
    public ui: CanvasUI;

    public isRelative: boolean = true;
    public relativePosition: THREE.Vector3 = TabletSurfaceEntity.DEFAULT_RELATIVE_POSITION.clone();
    public relativeQuaternion: THREE.Quaternion = TabletSurfaceEntity.DEFAULT_RELATIVE_QUATERNION.clone();
    private context: AppContext;
    private position: THREE.Vector3;
    private quaternion: THREE.Quaternion;

    private leftHandle: THREE.Mesh;
    private rightHandle: THREE.Mesh;

    constructor(context: AppContext, id: string) {
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

    public update(_delta: number): void {
        const lp = this.context.localPlayer as PlayerAvatarEntity;
        if (this.isRelative && lp) {
            const xrOriginPos = lp.xrOrigin.position;
            const xrOriginQuat = lp.xrOrigin.quaternion;
            const originQuat = new THREE.Quaternion(xrOriginQuat.x, xrOriginQuat.y, xrOriginQuat.z, xrOriginQuat.w);

            const idealPos = new THREE.Vector3().copy(this.relativePosition).applyQuaternion(originQuat).add({
                x: xrOriginPos.x,
                y: xrOriginPos.y,
                z: xrOriginPos.z
            });
            const idealQuat = new THREE.Quaternion().copy(originQuat).multiply(this.relativeQuaternion);
            this.position.copy(idealPos);
            this.quaternion.copy(idealQuat);
            this.mesh.position.copy(this.position);
            this.mesh.quaternion.copy(this.quaternion);
            this.mesh.updateMatrixWorld(true);
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

        if (this.context.localPlayer) {
            const xrOriginPos = this.context.localPlayer.xrOrigin.position;
            const xrOriginQuat = this.context.localPlayer.xrOrigin.quaternion;
            const originQuat = new THREE.Quaternion(xrOriginQuat.x, xrOriginQuat.y, xrOriginQuat.z, xrOriginQuat.w);
            const invOriginQuat = originQuat.clone().invert();

            this.relativePosition.copy(this.position)
                .sub({ x: xrOriginPos.x, y: xrOriginPos.y, z: xrOriginPos.z })
                .applyQuaternion(invOriginQuat);

            this.relativeQuaternion.copy(invOriginQuat).multiply(this.quaternion);
        }
    }

    public recenterToDefaultPose(): void {
        this.recenterInFrontOfView();
    }

    public recenterInFrontOfView(): void {
        const lp = this.context.localPlayer as PlayerAvatarEntity | null;
        if (!lp) return;

        const xrOriginPos = lp.xrOrigin.position;
        const xrOriginQuat = lp.xrOrigin.quaternion;
        const originPos = new THREE.Vector3(xrOriginPos.x, xrOriginPos.y, xrOriginPos.z);
        const originQuat = new THREE.Quaternion(xrOriginQuat.x, xrOriginQuat.y, xrOriginQuat.z, xrOriginQuat.w);
        const invOriginQuat = originQuat.clone().invert();

        const headPoseData = lp.getAvatarHeadWorldPose();
        if (!headPoseData) return;
        const headPosData = headPoseData.position;
        const headQuatData = headPoseData.quaternion;
        const headPos = new THREE.Vector3(headPosData.x, headPosData.y, headPosData.z);
        const headQuat = new THREE.Quaternion(headQuatData.x, headQuatData.y, headQuatData.z, headQuatData.w);
        const headYaw = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ').y;
        const viewYawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headYaw);

        const worldPos = new THREE.Vector3()
            .copy(TabletSurfaceEntity.DEFAULT_RELATIVE_POSITION)
            .applyQuaternion(viewYawQuat)
            .add(headPos);
        const worldQuat = new THREE.Quaternion()
            .copy(viewYawQuat)
            .multiply(TabletSurfaceEntity.DEFAULT_RELATIVE_QUATERNION);

        this.isRelative = true;
        this.relativePosition.copy(worldPos.sub(originPos).applyQuaternion(invOriginQuat));
        this.relativeQuaternion.copy(invOriginQuat).multiply(worldQuat);
    }

    public getGrabRoots(): THREE.Object3D[] {
        return [this.leftHandle, this.rightHandle];
    }

    public updateGrabbedPose(pose: IPose): void {
        this.position.set(pose.position.x, pose.position.y, pose.position.z);
        this.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);

        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(this.quaternion);
    }

    public setVisible(visible: boolean): void {
        this.mesh.visible = visible;
        this.isHoldable = visible;
        this.isGrabbable = visible;
        // Also hide handles
        this.leftHandle.visible = visible;
        this.rightHandle.visible = visible;
    }

    public destroy(): void {
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        // Cleanup meshes
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();

        this.leftHandle.geometry.dispose();
        (this.leftHandle.material as THREE.Material).dispose();

        this.rightHandle.geometry.dispose();
        (this.rightHandle.material as THREE.Material).dispose();

        this.mesh.removeFromParent();
        this.leftHandle.removeFromParent();
        this.rightHandle.removeFromParent();

        this.ui.destroy();
    }
}
