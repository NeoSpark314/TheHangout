import * as THREE from 'three';
import { GameContext } from '../../app/AppContext';
import { IDrawSegmentPayload } from '../../shared/contracts/IDrawing';
import { IReplicatedFeature } from '../../network/replication/FeatureReplicationService';

/**
 * Manages rendering and syncing of 3D drawings.
 */
export class DrawingManager implements IReplicatedFeature {
    public readonly featureId: string = 'feature:drawing';
    private scene: THREE.Scene | null;
    private lineMaterial: THREE.LineBasicMaterial;
    private lineGroup: THREE.Group | null = null;
    private segments: IDrawSegmentPayload[] = [];
    private maxSegments: number = 10000;

    constructor(scene: THREE.Scene | null, private context: GameContext) {
        this.scene = scene;
        this.lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
        if (this.scene) {
            this.lineGroup = new THREE.Group();
            this.scene.add(this.lineGroup);
        }
        this.context.managers.replication.registerFeature(this);
    }

    /**
     * Feature-local API for pen strokes.
     *
     * We intentionally keep drawing semantics out of the global EventBus.
     * The drawing feature owns both local rendering and network replication so
     * session/item-specific behavior does not leak into app-wide infrastructure.
     */
    public addSegment(segment: IDrawSegmentPayload, replicate: boolean = true): void {
        if (!this.isValidSegment(segment)) return;

        if (replicate) {
            this.context.managers.replication.emitFeatureEvent(this.featureId, 'segment', segment);
            return;
        }

        this.drawLine(segment);
    }

    private drawLine(segment: IDrawSegmentPayload): void {
        this.segments.push(segment);
        if (this.segments.length > this.maxSegments) {
            this.segments.splice(0, this.segments.length - this.maxSegments);
        }

        if (!this.scene) return;

        const points = [];
        points.push(new THREE.Vector3(...segment.startPos));
        points.push(new THREE.Vector3(...segment.endPos));

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const color = new THREE.Color(segment.color as any);
        const colors = new Float32Array([color.r, color.g, color.b, color.r, color.g, color.b]);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const line = new THREE.Line(geometry, this.lineMaterial);
        this.lineGroup?.add(line);
    }

    public onEvent(eventType: string, data: unknown): void {
        if (eventType !== 'segment') return;
        const segment = data as IDrawSegmentPayload;
        if (!this.isValidSegment(segment)) return;
        this.addSegment(segment, false);
    }

    public captureSnapshot(): unknown {
        return {
            segments: this.segments.slice()
        };
    }

    public applySnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const obj = snapshot as { segments?: IDrawSegmentPayload[] };
        if (!Array.isArray(obj.segments)) return;

        this.segments = [];
        this.clearRenderedLines();
        for (const segment of obj.segments) {
            if (!this.isValidSegment(segment)) continue;
            this.drawLine(segment);
        }
    }

    private isValidSegment(segment: IDrawSegmentPayload | undefined): segment is IDrawSegmentPayload {
        if (!segment) return false;
        if (!Array.isArray(segment.startPos) || segment.startPos.length < 3) return false;
        if (!Array.isArray(segment.endPos) || segment.endPos.length < 3) return false;
        return typeof segment.color === 'string' || typeof segment.color === 'number';
    }

    private clearRenderedLines(): void {
        if (!this.lineGroup) return;
        while (this.lineGroup.children.length > 0) {
            const child = this.lineGroup.children.pop();
            if (!child) break;
            const line = child as THREE.Line;
            if (line.geometry) line.geometry.dispose();
        }
    }
}
