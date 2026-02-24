import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { EVENTS, PACKET_TYPES } from '../utils/Constants';
import gameState from '../core/GameState';

export interface LineSegment {
    start: [number, number, number];
    end: [number, number, number];
    color: string | number;
}

/**
 * Manages rendering and syncing of 3D drawings.
 */
export class DrawingManager {
    private scene: THREE.Scene;
    private lineMaterial: THREE.LineBasicMaterial;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
        
        eventBus.on(EVENTS.PEN_DRAW_SEGMENT, (segment: LineSegment) => {
            this.drawLine(segment);
            
            // Broadcast to others if we are the one drawing
            if (gameState.managers.network) {
                gameState.managers.network.broadcast(PACKET_TYPES.DRAW_LINE_SEGMENT, segment);
            }
        });
    }

    public drawLine(segment: LineSegment): void {
        const points = [];
        points.push(new THREE.Vector3(...segment.start));
        points.push(new THREE.Vector3(...segment.end));

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const color = new THREE.Color(segment.color as any);
        const colors = new Float32Array([color.r, color.g, color.b, color.r, color.g, color.b]);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const line = new THREE.Line(geometry, this.lineMaterial);
        this.scene.add(line);
    }
}
