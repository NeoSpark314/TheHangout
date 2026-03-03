import * as THREE from 'three';
import type { AppContext } from '../../app/AppContext';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IReplicatedObjectInstance, IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import type { IDrawSegmentPayload } from '../../shared/contracts/IDrawing';

export interface IDrawingSurfaceInstance extends IReplicatedObjectInstance {
    addSegment(segment: IDrawSegmentPayload, replicate?: boolean): void;
    clear(): void;
}

class DrawingSurfaceInstance implements IDrawingSurfaceInstance {
    public readonly moduleId: string;
    public readonly replicationKey: string;
    private readonly lineMaterial: THREE.LineBasicMaterial;
    private lineGroup: THREE.Group | null = null;
    private readonly segments: IDrawSegmentPayload[] = [];
    private readonly maxSegments = 10000;

    constructor(
        public readonly id: string,
        moduleId: string,
        private context: AppContext
    ) {
        this.moduleId = moduleId;
        this.replicationKey = `object:${moduleId}:${id}`;
        this.lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true });

        const scene = this.context.runtime.render?.scene || null;
        if (scene) {
            this.lineGroup = new THREE.Group();
            this.lineGroup.name = `drawing-surface:${id}`;
            scene.add(this.lineGroup);
        }
    }

    public update(): void { }

    public destroy(): void {
        this.clear();

        if (this.lineGroup) {
            this.context.runtime.render?.scene.remove(this.lineGroup);
            this.lineGroup = null;
        }

        this.lineMaterial.dispose();
    }

    public addSegment(segment: IDrawSegmentPayload, replicate: boolean = true): void {
        if (!this.isValidSegment(segment)) return;

        if (replicate) {
            this.context.runtime.session.emitObjectInstanceEvent(this.id, 'segment', segment);
            return;
        }

        this.drawLine(segment);
    }

    public clear(): void {
        this.segments.length = 0;
        this.clearRenderedLines();
    }

    public onReplicationEvent(eventType: string, data: unknown, _meta: IObjectReplicationMeta): void {
        if (eventType !== 'segment') return;
        const segment = data as IDrawSegmentPayload;
        if (!this.isValidSegment(segment)) return;
        this.addSegment(segment, false);
    }

    public captureReplicationSnapshot(): unknown {
        return {
            segments: this.segments.slice()
        };
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const payload = snapshot as { segments?: IDrawSegmentPayload[] };
        if (!Array.isArray(payload.segments)) return;

        this.clear();
        for (const segment of payload.segments) {
            if (!this.isValidSegment(segment)) continue;
            this.drawLine(segment);
        }
    }

    private drawLine(segment: IDrawSegmentPayload): void {
        this.segments.push(segment);
        if (this.segments.length > this.maxSegments) {
            this.segments.splice(0, this.segments.length - this.maxSegments);
        }

        if (!this.lineGroup) return;

        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...segment.startPos),
            new THREE.Vector3(...segment.endPos)
        ]);
        const color = new THREE.Color(segment.color as any);
        const colors = new Float32Array([color.r, color.g, color.b, color.r, color.g, color.b]);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const line = new THREE.Line(geometry, this.lineMaterial);
        this.lineGroup.add(line);
    }

    private clearRenderedLines(): void {
        if (!this.lineGroup) return;

        while (this.lineGroup.children.length > 0) {
            const child = this.lineGroup.children.pop();
            if (!child) break;
            const line = child as THREE.Line;
            if (line.geometry) {
                line.geometry.dispose();
            }
        }
    }

    private isValidSegment(segment: IDrawSegmentPayload | undefined): segment is IDrawSegmentPayload {
        if (!segment) return false;
        if (!Array.isArray(segment.startPos) || segment.startPos.length < 3) return false;
        if (!Array.isArray(segment.endPos) || segment.endPos.length < 3) return false;
        return typeof segment.color === 'string' || typeof segment.color === 'number';
    }
}

export class DrawingSurfaceObject implements IObjectModule {
    public readonly id = 'drawing-surface';
    public readonly displayName = 'Drawing Surface';
    public readonly tags = ['shared', 'drawing'];
    public readonly networked = true;
    public readonly portable = false;

    public spawn(context: IObjectSpawnContext, _config: IObjectSpawnConfig): DrawingSurfaceInstance {
        return new DrawingSurfaceInstance(context.instanceId, this.id, context.app);
    }
}
