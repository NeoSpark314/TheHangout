import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GameContext } from '../core/GameState';
import { IUpdatable } from '../interfaces/IUpdatable';
import { IPhysicsDebugBody } from './PhysicsManager';

interface IDebugVisual {
    root: THREE.Group;
    colliderLines: THREE.LineSegments[];
    axes?: THREE.AxesHelper;
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
    fixed: new THREE.Color(0x6b7280),
    dynamic: new THREE.Color(0x00ffff),
    kinematic: new THREE.Color(0xffaa00)
};

export class DebugRenderManager implements IUpdatable {
    private readonly root = new THREE.Group();
    private readonly visuals: Map<string, IDebugVisual> = new Map();
    private syncTimer = 0;
    private readonly syncInterval = 0.5;

    private settings: IDebugRenderSettings = {
        enabled: false,
        showColliders: true,
        showAxes: true,
        showAuthorityLabels: true
    };

    constructor(private context: GameContext) {
        this.root.name = 'DebugRenderLayer';
    }

    public init(): void {
        const scene = this.context.managers.render?.scene;
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

        const debugBodies = this.context.managers.physics?.getDebugBodies() || [];
        for (const body of debugBodies) {
            const visual = this.visuals.get(body.id);
            if (!visual) continue;
            this.updateVisual(body, visual);
        }
    }

    public destroy(): void {
        for (const visual of this.visuals.values()) {
            this.disposeVisual(visual);
        }
        this.visuals.clear();
        this.root.parent?.remove(this.root);
    }

    private syncVisuals(): void {
        const debugBodies = this.context.managers.physics?.getDebugBodies() || [];
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

    private createVisual(body: IPhysicsDebugBody): IDebugVisual {
        const root = new THREE.Group();
        root.name = `DebugBody:${body.id}`;
        this.root.add(root);

        const colliderLines: THREE.LineSegments[] = [];
        for (let i = 0; i < body.colliders.length; i++) {
            const material = new THREE.LineBasicMaterial({ color: BODY_COLOR.fixed });
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
        const bodyColor = this.getBodyColor(body.rigidBody.bodyType());

        for (let i = 0; i < visual.colliderLines.length; i++) {
            const line = visual.colliderLines[i];
            line.visible = this.settings.showColliders;
            (line.material as THREE.LineBasicMaterial).color.copy(bodyColor);

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
            const owner = body.ownerId || 'host';
            const authority = body.isAuthority ? 'local' : 'remote';
            const labelText = `${body.id}\nowner: ${owner}\nauth: ${authority}`;
            visual.label.visible = this.settings.showAuthorityLabels;

            if (labelText !== visual.labelText) {
                this.updateLabelSprite(visual.label, labelText);
                visual.labelText = labelText;
            }

            const t = body.rigidBody.translation();
            visual.label.position.set(t.x, t.y + 0.35, t.z);

            const camera = this.context.managers.render?.camera;
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
        sprite.scale.set(0.5, 0.24, 1);
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
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(4, 8, 20, 0.75)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);

        ctx.fillStyle = '#e5f8ff';
        ctx.font = 'bold 38px Inter, sans-serif';
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            ctx.fillText(line, 20, 62 + i * 62);
        });

        return canvas;
    }

    private getBodyColor(bodyType: RAPIER.RigidBodyType): THREE.Color {
        if (bodyType === RAPIER.RigidBodyType.Fixed) return BODY_COLOR.fixed;
        if (bodyType === RAPIER.RigidBodyType.KinematicPositionBased || bodyType === RAPIER.RigidBodyType.KinematicVelocityBased) {
            return BODY_COLOR.kinematic;
        }
        return BODY_COLOR.dynamic;
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
}
