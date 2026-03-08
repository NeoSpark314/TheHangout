import * as THREE from 'three';

interface ILineCubeActor {
    node: THREE.LineSegments;
    baseAngle: number;
    radius: number;
    baseY: number;
    phase: number;
    spinAxis: THREE.Vector3;
    spinSpeed: number;
    bobAmp: number;
    colorSeed: number;
}

interface IRingActor {
    node: THREE.LineLoop;
    baseScale: number;
    pulseAmp: number;
    pulseSpeed: number;
    phase: number;
    rotSpeed: number;
}

interface IPillarActor {
    node: THREE.LineSegments;
    baseAngle: number;
    radius: number;
    baseHeight: number;
    pulseAmp: number;
    phase: number;
    rotSpeed: number;
}

/**
 * Purely visual "demo scene" layers for WideCircleScenario.
 * Uses wall-clock time + seed phase so peers see similar movement without replication.
 */
export class WideCircleVisuals {
    private readonly root = new THREE.Group();
    private readonly lineCubes: ILineCubeActor[] = [];
    private readonly rings: IRingActor[] = [];
    private readonly pillars: IPillarActor[] = [];
    private readonly materials: THREE.LineBasicMaterial[] = [];
    private readonly baseEpochSec: number;
    private readonly tmpColor = new THREE.Color();
    private readonly palette = [
        new THREE.Color(0x41d8ff),
        new THREE.Color(0xff4de3),
        new THREE.Color(0x7cff8f),
        new THREE.Color(0xffb84d)
    ];

    constructor(private scene: THREE.Scene, seed: number) {
        this.baseEpochSec = (Date.now() * 0.001) + ((seed % 4096) * 0.03125);
        this.root.name = 'wide-circle-demo-visuals';
        this.scene.add(this.root);
        this.build();
    }

    public update(_delta: number): void {
        const t = (Date.now() * 0.001) - this.baseEpochSec;

        this.root.rotation.y = t * 0.045;

        for (const actor of this.lineCubes) {
            const orbit = actor.baseAngle + t * 0.17;
            const yBob = Math.sin(t * 0.9 + actor.phase) * actor.bobAmp;
            actor.node.position.set(
                Math.sin(orbit) * actor.radius,
                actor.baseY + yBob,
                Math.cos(orbit) * actor.radius
            );
            actor.node.rotateOnAxis(actor.spinAxis, actor.spinSpeed);

            const mat = actor.node.material as THREE.LineBasicMaterial;
            const hue = (0.55 + actor.colorSeed * 0.35 + t * 0.03) % 1.0;
            this.tmpColor.setHSL(hue, 0.9, 0.62);
            mat.color.copy(this.tmpColor);
        }

        for (const ring of this.rings) {
            const pulse = 1.0 + Math.sin(t * ring.pulseSpeed + ring.phase) * ring.pulseAmp;
            ring.node.scale.setScalar(ring.baseScale * pulse);
            ring.node.rotation.y += ring.rotSpeed;
        }

        for (const pillar of this.pillars) {
            const angle = pillar.baseAngle + t * pillar.rotSpeed;
            const pulse = 1.0 + Math.sin(t * 1.4 + pillar.phase) * pillar.pulseAmp;
            pillar.node.position.set(
                Math.sin(angle) * pillar.radius,
                0.7,
                Math.cos(angle) * pillar.radius
            );
            pillar.node.scale.y = pulse;
        }
    }

    public destroy(): void {
        this.scene.remove(this.root);
        this.root.traverse((obj) => {
            const asAny = obj as any;
            if (asAny.geometry && typeof asAny.geometry.dispose === 'function') {
                asAny.geometry.dispose();
            }
        });
        for (const mat of this.materials) {
            mat.dispose();
        }
        this.materials.length = 0;
        this.lineCubes.length = 0;
        this.rings.length = 0;
        this.pillars.length = 0;
    }

    private build(): void {
        this.buildOrbitingLineCubes();
        this.buildRotatingRezRings();
        this.buildLightPillars();
    }

    private buildOrbitingLineCubes(): void {
        const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
        const count = 18;
        for (let i = 0; i < count; i++) {
            const color = this.palette[i % this.palette.length].clone();
            const mat = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.68
            });
            this.materials.push(mat);

            const node = new THREE.LineSegments(edgeGeo.clone(), mat);
            node.scale.setScalar(0.6 + ((i % 4) * 0.16));
            this.root.add(node);

            this.lineCubes.push({
                node,
                baseAngle: (i / count) * Math.PI * 2,
                radius: 4.2 + (i % 5) * 0.75,
                baseY: 1.2 + (i % 4) * 0.45,
                phase: i * 0.61,
                spinAxis: new THREE.Vector3(
                    ((i % 3) - 1) * 0.5,
                    1.0,
                    (((i + 1) % 3) - 1) * 0.5
                ).normalize(),
                spinSpeed: 0.004 + (i % 4) * 0.0015,
                bobAmp: 0.14 + (i % 3) * 0.05,
                colorSeed: i / count
            });
        }
    }

    private buildRotatingRezRings(): void {
        const ringDefs = [
            { radius: 5.5, y: 0.45, segments: 84, color: 0x55d6ff, pulseAmp: 0.04, pulseSpeed: 0.8, rotSpeed: 0.0016 },
            { radius: 7.4, y: 1.25, segments: 108, color: 0xff68f0, pulseAmp: 0.06, pulseSpeed: 1.05, rotSpeed: -0.0012 },
            { radius: 9.6, y: 2.1, segments: 132, color: 0x7dffb4, pulseAmp: 0.05, pulseSpeed: 0.72, rotSpeed: 0.0009 }
        ];

        for (let i = 0; i < ringDefs.length; i++) {
            const def = ringDefs[i];
            const points: THREE.Vector3[] = [];
            for (let j = 0; j < def.segments; j++) {
                const a = (j / def.segments) * Math.PI * 2;
                points.push(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
            }
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineBasicMaterial({
                color: def.color,
                transparent: true,
                opacity: 0.45
            });
            this.materials.push(mat);

            const node = new THREE.LineLoop(geo, mat);
            node.position.y = def.y;
            this.root.add(node);

            this.rings.push({
                node,
                baseScale: def.radius,
                pulseAmp: def.pulseAmp,
                pulseSpeed: def.pulseSpeed,
                phase: i * 1.1,
                rotSpeed: def.rotSpeed
            });
        }
    }

    private buildLightPillars(): void {
        const pillarCount = 16;
        const halfHeight = 2.4;
        const pillarGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, -halfHeight, 0),
            new THREE.Vector3(0, halfHeight, 0)
        ]);

        for (let i = 0; i < pillarCount; i++) {
            const mat = new THREE.LineBasicMaterial({
                color: this.palette[(i + 1) % this.palette.length],
                transparent: true,
                opacity: 0.42
            });
            this.materials.push(mat);

            const node = new THREE.LineSegments(pillarGeo.clone(), mat);
            this.root.add(node);

            this.pillars.push({
                node,
                baseAngle: (i / pillarCount) * Math.PI * 2,
                radius: 6.8 + (i % 4) * 0.9,
                baseHeight: halfHeight * 2,
                pulseAmp: 0.26 + (i % 3) * 0.08,
                phase: i * 0.5,
                rotSpeed: 0.06 + (i % 5) * 0.01
            });
        }
    }
}
