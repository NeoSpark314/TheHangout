import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { AppContext } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { IPhysicsDebugBody } from '../../physics/runtime/PhysicsRuntime';
import { EntityType } from '../../shared/contracts/IEntityState';
import { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import { AVATAR_SKELETON_JOINTS, AVATAR_SKELETON_PARENT, AvatarSkeletonJointName } from '../../shared/avatar/AvatarSkeleton';
import { composeAvatarWorldPoses } from '../../shared/avatar/AvatarSkeletonUtils';

interface IDebugVisual {
    root: THREE.Group;
    colliderLines: THREE.LineSegments[];
    axes?: THREE.AxesHelper;
    label?: THREE.Sprite;
    labelText?: string;
}

interface IDebugAvatarVisual {
    root: THREE.Group;
    bones: THREE.LineSegments;
    joints: THREE.Points;
    label?: THREE.Sprite;
    labelText?: string;
}

export interface IDebugRenderSettings {
    enabled: boolean;
    showColliders: boolean;
    showAxes: boolean;
    showAuthorityLabels: boolean;
}

const BODY_COLOR = {
    fixed: new THREE.Color(0xff2d95),
    dynamic: new THREE.Color(0x39ff14),
    kinematic: new THREE.Color(0xff6a00),
    sleepingTint: new THREE.Color(0x6b7280)
};

export class DebugRenderRuntime implements IUpdatable {
    private readonly root = new THREE.Group();
    private readonly visuals: Map<string, IDebugVisual> = new Map();
    private readonly avatarVisuals: Map<string, IDebugAvatarVisual> = new Map();
    private syncTimer = 0;
    private readonly syncInterval = 0.5;
    private readonly avatarBonePairs: Array<[AvatarSkeletonJointName, AvatarSkeletonJointName]> = AVATAR_SKELETON_JOINTS
        .filter((jointName) => !!AVATAR_SKELETON_PARENT[jointName])
        .map((jointName) => [AVATAR_SKELETON_PARENT[jointName]!, jointName]);

    private settings: IDebugRenderSettings = {
        enabled: false,
        showColliders: true,
        showAxes: true,
        showAuthorityLabels: true
    };

    constructor(private context: AppContext) {
        this.root.name = 'DebugRenderLayer';
    }

    public init(): void {
        const scene = this.context.runtime.render?.scene;
        if (scene) {
            scene.add(this.root);
            this.root.visible = false;
        }
    }

    public getSettings(): IDebugRenderSettings {
        return { ...this.settings };
    }

    public setEnabled(enabled: boolean): void {
        this.settings.enabled = enabled;
        this.settings.showColliders = enabled;
        this.settings.showAxes = enabled;
        this.settings.showAuthorityLabels = enabled;
        this.root.visible = enabled;
    }

    public setShowColliders(show: boolean): void {
        this.settings.showColliders = show;
    }

    public setShowAxes(show: boolean): void {
        this.settings.showAxes = show;
    }

    public setShowAuthorityLabels(show: boolean): void {
        this.settings.showAuthorityLabels = show;
    }

    public update(delta: number): void {
        if (!this.settings.enabled) return;

        this.syncTimer += delta;
        if (this.syncTimer >= this.syncInterval) {
            this.syncTimer = 0;
            this.syncVisuals();
        }

        const debugBodies = this.context.runtime.physics?.getDebugBodies() || [];
        for (const body of debugBodies) {
            const visual = this.visuals.get(body.id);
            if (!visual) continue;
            this.updateVisual(body, visual);
        }

        const players = this.getDebugPlayers();
        for (const player of players) {
            const visual = this.avatarVisuals.get(player.id);
            if (!visual) continue;
            this.updateAvatarVisual(player, visual);
        }
    }

    public destroy(): void {
        for (const visual of this.visuals.values()) {
            this.disposeVisual(visual);
        }
        this.visuals.clear();
        for (const visual of this.avatarVisuals.values()) {
            this.disposeAvatarVisual(visual);
        }
        this.avatarVisuals.clear();
        this.root.parent?.remove(this.root);
    }

    private syncVisuals(): void {
        this.syncPhysicsVisuals();
        this.syncAvatarVisuals();
    }

    private syncPhysicsVisuals(): void {
        const debugBodies = this.context.runtime.physics?.getDebugBodies() || [];
        const incomingIds = new Set<string>(debugBodies.map((b) => b.id));

        for (const body of debugBodies) {
            if (!this.visuals.has(body.id)) {
                this.visuals.set(body.id, this.createVisual(body));
            }
        }

        for (const [id, visual] of this.visuals.entries()) {
            if (!incomingIds.has(id)) {
                this.disposeVisual(visual);
                this.visuals.delete(id);
            }
        }
    }

    private syncAvatarVisuals(): void {
        const players = this.getDebugPlayers();
        const incomingIds = new Set<string>(players.map((player) => player.id));

        for (const player of players) {
            if (!this.avatarVisuals.has(player.id)) {
                this.avatarVisuals.set(player.id, this.createAvatarVisual(player));
            }
        }

        for (const [id, visual] of this.avatarVisuals.entries()) {
            if (!incomingIds.has(id)) {
                this.disposeAvatarVisual(visual);
                this.avatarVisuals.delete(id);
            }
        }
    }

    private createVisual(body: IPhysicsDebugBody): IDebugVisual {
        const root = new THREE.Group();
        root.name = `DebugBody:${body.id}`;
        this.root.add(root);

        const colliderLines: THREE.LineSegments[] = [];
        for (let i = 0; i < body.colliders.length; i++) {
            const material = new THREE.LineBasicMaterial({ color: BODY_COLOR.fixed, transparent: true, opacity: 1.0 });
            const collider = body.colliders[i];
            const lines = new THREE.LineSegments(this.createColliderEdges(collider), material);
            lines.name = `ColliderBounds:${i}`;
            root.add(lines);
            colliderLines.push(lines);
        }

        const visual: IDebugVisual = { root, colliderLines };

        if (!this.isFixed(body.rigidBody)) {
            const axes = new THREE.AxesHelper(0.2);
            axes.name = 'BodyAxes';
            root.add(axes);
            visual.axes = axes;
        }

        if (body.hasNetworkState) {
            const label = this.createLabelSprite('');
            label.name = 'AuthorityLabel';
            root.add(label);
            visual.label = label;
            visual.labelText = '';
        }

        return visual;
    }

    private updateVisual(body: IPhysicsDebugBody, visual: IDebugVisual): void {
        const isSleeping = body.rigidBody.isSleeping();
        const bodyColor = this.getBodyColor(body.rigidBody.bodyType(), isSleeping);

        for (let i = 0; i < visual.colliderLines.length; i++) {
            const line = visual.colliderLines[i];
            line.visible = this.settings.showColliders;
            const lineMaterial = line.material as THREE.LineBasicMaterial;
            lineMaterial.color.copy(bodyColor);
            lineMaterial.opacity = isSleeping ? 0.35 : 1.0;

            const collider = body.colliders[i];
            if (!collider) continue;

            const t = collider.translation();
            const r = collider.rotation();
            line.position.set(t.x, t.y, t.z);
            line.quaternion.set(r.x, r.y, r.z, r.w);
            line.scale.set(1, 1, 1);
        }

        if (visual.axes) {
            const t = body.rigidBody.translation();
            const r = body.rigidBody.rotation();
            visual.axes.visible = this.settings.showAxes;
            visual.axes.position.set(t.x, t.y, t.z);
            visual.axes.quaternion.set(r.x, r.y, r.z, r.w);
        }

        if (visual.label) {
            const owner = body.ownerId ?? 'unowned';
            const authority = body.isAuthority ? 'local' : 'remote';
            const sim = this.compactSimMode(body.simMode, body.isAuthority);
            const reason = body.lastAuthorityReason ?? '-';
            const shortId = this.compactId(body.id, 14);
            const shortOwner = this.compactId(owner, 12);
            const sleep = isSleeping ? 'sleep' : 'awake';
            const labelText = `${shortId}\nown:${shortOwner}  a:${authority}\nsim:${sim}  ${sleep}\nwhy:${reason}\nsb:${body.snapshotBufferSize}  seq:${body.lastTransferSeq}  qh:${body.touchQueryHits}`;
            visual.label.visible = this.settings.showAuthorityLabels;

            if (labelText !== visual.labelText) {
                this.updateLabelSprite(visual.label, labelText);
                visual.labelText = labelText;
            }

            const t = body.rigidBody.translation();
            visual.label.position.set(t.x, t.y + 0.35, t.z);

            const camera = this.context.runtime.render?.camera;
            if (camera) {
                visual.label.quaternion.copy(camera.quaternion);
            }
        }
    }

    private createAvatarVisual(player: PlayerAvatarEntity): IDebugAvatarVisual {
        const root = new THREE.Group();
        root.name = `DebugAvatar:${player.id}`;
        this.root.add(root);

        const boneGeometry = new THREE.BufferGeometry();
        boneGeometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(new Float32Array(this.avatarBonePairs.length * 2 * 3), 3)
        );
        const bones = new THREE.LineSegments(
            boneGeometry,
            new THREE.LineBasicMaterial({
                color: player.controlMode === 'local' ? 0x00ffff : 0xffb000,
                transparent: true,
                opacity: 0.9,
                depthWrite: false
            })
        );
        bones.name = 'AvatarBones';
        root.add(bones);

        const jointGeometry = new THREE.BufferGeometry();
        jointGeometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(new Float32Array(AVATAR_SKELETON_JOINTS.length * 3), 3)
        );
        const joints = new THREE.Points(
            jointGeometry,
            new THREE.PointsMaterial({
                color: player.controlMode === 'local' ? 0xffffff : 0xff7a00,
                size: 0.04,
                sizeAttenuation: true,
                depthWrite: false
            })
        );
        joints.name = 'AvatarJoints';
        root.add(joints);

        const visual: IDebugAvatarVisual = { root, bones, joints };
        const label = this.createLabelSprite('');
        label.name = 'AvatarLabel';
        root.add(label);
        visual.label = label;
        visual.labelText = '';

        return visual;
    }

    private updateAvatarVisual(player: PlayerAvatarEntity, visual: IDebugAvatarVisual): void {
        const pose = player.avatarSkeleton.pose;
        const world = composeAvatarWorldPoses(pose);
        const jointPositions = visual.joints.geometry.getAttribute('position') as THREE.BufferAttribute;
        const bonePositions = visual.bones.geometry.getAttribute('position') as THREE.BufferAttribute;

        for (let i = 0; i < AVATAR_SKELETON_JOINTS.length; i += 1) {
            const jointName = AVATAR_SKELETON_JOINTS[i];
            const joint = world[jointName];
            if (joint) {
                jointPositions.setXYZ(i, joint.position.x, joint.position.y, joint.position.z);
            } else {
                jointPositions.setXYZ(i, pose.rootWorldPosition.x, pose.rootWorldPosition.y, pose.rootWorldPosition.z);
            }
        }
        jointPositions.needsUpdate = true;
        visual.joints.visible = true;

        for (let i = 0; i < this.avatarBonePairs.length; i += 1) {
            const [parentName, childName] = this.avatarBonePairs[i];
            const parent = world[parentName];
            const child = world[childName];
            const offset = i * 2;
            if (parent && child) {
                bonePositions.setXYZ(offset, parent.position.x, parent.position.y, parent.position.z);
                bonePositions.setXYZ(offset + 1, child.position.x, child.position.y, child.position.z);
            } else {
                bonePositions.setXYZ(offset, pose.rootWorldPosition.x, pose.rootWorldPosition.y, pose.rootWorldPosition.z);
                bonePositions.setXYZ(offset + 1, pose.rootWorldPosition.x, pose.rootWorldPosition.y, pose.rootWorldPosition.z);
            }
        }
        bonePositions.needsUpdate = true;
        visual.bones.visible = true;

        if (visual.label) {
            const head = world.head;
            const labelText = `${player.name || player.id}\n${player.controlMode} ${pose.poseState}`;
            visual.label.visible = this.settings.showAuthorityLabels;
            if (labelText !== visual.labelText) {
                this.updateLabelSprite(visual.label, labelText);
                visual.labelText = labelText;
            }
            if (head) {
                visual.label.position.set(head.position.x, head.position.y + 0.18, head.position.z);
            } else {
                visual.label.position.set(pose.rootWorldPosition.x, pose.rootWorldPosition.y + 1.7, pose.rootWorldPosition.z);
            }

            const camera = this.context.runtime.render?.camera;
            if (camera) {
                visual.label.quaternion.copy(camera.quaternion);
            }
        }
    }

    private createLabelSprite(text: string): THREE.Sprite {
        const map = new THREE.CanvasTexture(this.buildLabelCanvas(text));
        map.minFilter = THREE.LinearFilter;
        map.magFilter = THREE.LinearFilter;
        const material = new THREE.SpriteMaterial({
            map,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(0.5, 0.3, 1);
        return sprite;
    }

    private updateLabelSprite(sprite: THREE.Sprite, text: string): void {
        const material = sprite.material as THREE.SpriteMaterial;
        if (material.map) {
            material.map.dispose();
        }
        material.map = new THREE.CanvasTexture(this.buildLabelCanvas(text));
        material.map.minFilter = THREE.LinearFilter;
        material.map.magFilter = THREE.LinearFilter;
        material.needsUpdate = true;
    }

    private buildLabelCanvas(text: string): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = 384;
        canvas.height = 230;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(4, 8, 20, 0.75)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);

        ctx.fillStyle = '#e5f8ff';
        ctx.font = 'bold 28px Inter, sans-serif';
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            ctx.fillText(line, 14, 38 + i * 44);
        });

        return canvas;
    }

    private getBodyColor(bodyType: RAPIER.RigidBodyType, isSleeping: boolean): THREE.Color {
        let base = BODY_COLOR.dynamic;
        if (bodyType === RAPIER.RigidBodyType.Fixed) {
            base = BODY_COLOR.fixed;
        } else if (bodyType === RAPIER.RigidBodyType.KinematicPositionBased || bodyType === RAPIER.RigidBodyType.KinematicVelocityBased) {
            base = BODY_COLOR.kinematic;
        }

        if (!isSleeping) return base;
        return base.clone().lerp(BODY_COLOR.sleepingTint, 0.65);
    }

    private createColliderEdges(collider: RAPIER.Collider): THREE.EdgesGeometry {
        const shape = collider.shape as unknown as { type: RAPIER.ShapeType; [key: string]: unknown };
        const type = shape.type;
        let meshGeometry: THREE.BufferGeometry;

        if (type === RAPIER.ShapeType.Cuboid || type === RAPIER.ShapeType.RoundCuboid) {
            const he = shape.halfExtents as { x: number; y: number; z: number } | undefined;
            const hx = he?.x ?? 0.05;
            const hy = he?.y ?? 0.05;
            const hz = he?.z ?? 0.05;
            meshGeometry = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
        } else if (type === RAPIER.ShapeType.Ball) {
            const radius = (shape.radius as number | undefined) ?? 0.05;
            meshGeometry = new THREE.SphereGeometry(radius, 10, 8);
        } else if (type === RAPIER.ShapeType.Cylinder || type === RAPIER.ShapeType.RoundCylinder) {
            const radius = (shape.radius as number | undefined) ?? 0.05;
            const halfHeight = (shape.halfHeight as number | undefined) ?? 0.05;
            meshGeometry = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 12, 1);
        } else if (type === RAPIER.ShapeType.Cone || type === RAPIER.ShapeType.RoundCone) {
            const radius = (shape.radius as number | undefined) ?? 0.05;
            const halfHeight = (shape.halfHeight as number | undefined) ?? 0.05;
            meshGeometry = new THREE.ConeGeometry(radius, halfHeight * 2, 12, 1);
        } else if (type === RAPIER.ShapeType.Capsule) {
            const radius = (shape.radius as number | undefined) ?? 0.05;
            const halfHeight = (shape.halfHeight as number | undefined) ?? 0.05;
            meshGeometry = new THREE.CapsuleGeometry(radius, halfHeight * 2, 4, 8);
        } else {
            meshGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        }

        const edges = new THREE.EdgesGeometry(meshGeometry);
        meshGeometry.dispose();
        return edges;
    }

    private isFixed(body: RAPIER.RigidBody): boolean {
        return body.bodyType() === RAPIER.RigidBodyType.Fixed;
    }

    private compactId(value: string, maxLen: number): string {
        if (value.length <= maxLen) return value;
        const keep = Math.max(3, Math.floor((maxLen - 1) / 2));
        return `${value.slice(0, keep)}~${value.slice(-keep)}`;
    }

    private compactSimMode(simMode: string | null, isAuthority: boolean): string {
        if (!simMode) return isAuthority ? 'auth' : 'proxy';
        if (simMode === 'AuthoritativeDynamic') return 'auth-dyn';
        if (simMode === 'HeldKinematic') return 'held-kin';
        if (simMode === 'PendingReleaseDynamic') return 'pend-dyn';
        if (simMode === 'ProxyKinematic') return 'proxy-kin';
        return simMode.toLowerCase();
    }

    private disposeVisual(visual: IDebugVisual): void {
        for (const line of visual.colliderLines) {
            line.geometry.dispose();
            (line.material as THREE.LineBasicMaterial).dispose();
            line.removeFromParent();
        }

        if (visual.label) {
            const material = visual.label.material as THREE.SpriteMaterial;
            material.map?.dispose();
            material.dispose();
            visual.label.removeFromParent();
        }

        visual.axes?.removeFromParent();
        visual.root.removeFromParent();
    }

    private disposeAvatarVisual(visual: IDebugAvatarVisual): void {
        visual.bones.geometry.dispose();
        (visual.bones.material as THREE.Material).dispose();
        visual.bones.removeFromParent();

        visual.joints.geometry.dispose();
        (visual.joints.material as THREE.Material).dispose();
        visual.joints.removeFromParent();

        if (visual.label) {
            const material = visual.label.material as THREE.SpriteMaterial;
            material.map?.dispose();
            material.dispose();
            visual.label.removeFromParent();
        }

        visual.root.removeFromParent();
    }

    private getDebugPlayers(): PlayerAvatarEntity[] {
        const out: PlayerAvatarEntity[] = [];
        for (const entity of this.context.runtime.entity?.entities.values() || []) {
            if (entity.type === EntityType.PLAYER_AVATAR) {
                out.push(entity as PlayerAvatarEntity);
            }
        }
        return out;
    }
}
