import * as THREE from 'three';
import { TargetTossScoreboardVisual } from './TargetTossScoreboardVisual';
import type { ITargetRuntime } from './TargetTossTypes';

const TREE_LAYOUT = [
    { x: -9.4, z: -7.2, s: 1.18 },
    { x: -7.1, z: -9.5, s: 1.04 },
    { x: -4.1, z: -10.7, s: 1.2 },
    { x: -0.6, z: -11.2, s: 1.14 },
    { x: 3.1, z: -10.6, s: 1.08 },
    { x: 6.3, z: -8.8, s: 1.22 },
    { x: 8.9, z: -6.1, s: 1.05 },
    { x: 9.3, z: -1.5, s: 1.14 },
    { x: 8.7, z: 3.2, s: 1.06 },
    { x: -9.1, z: -2.7, s: 1.0 },
    { x: -8.5, z: 2.2, s: 1.08 }
] as const;

export function buildTargetTossEnvironment(
    root: THREE.Group,
    targets: readonly ITargetRuntime[],
    scoreboard: TargetTossScoreboardVisual | null
): TargetTossScoreboardVisual {
    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(18, 64),
        new THREE.MeshStandardMaterial({
            color: 0xbfe68a,
            emissive: 0x7fba5b,
            emissiveIntensity: 0.06,
            metalness: 0.05,
            roughness: 0.94
        })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    floor.receiveShadow = true;
    root.add(floor);

    const lane = new THREE.Mesh(
        new THREE.BoxGeometry(4.5, 0.03, 12.5),
        new THREE.MeshStandardMaterial({
            color: 0x1b7fd1,
            emissive: 0x0f4f8a,
            emissiveIntensity: 0.05,
            metalness: 0.18,
            roughness: 0.48
        })
    );
    lane.position.set(0, 0.015, -1.0);
    lane.receiveShadow = true;
    root.add(lane);

    const throwLine = new THREE.Mesh(
        new THREE.BoxGeometry(4.7, 0.03, 0.14),
        new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 0.08,
            metalness: 0.12,
            roughness: 0.3
        })
    );
    throwLine.position.set(0, 0.028, 1.95);
    throwLine.receiveShadow = true;
    root.add(throwLine);

    const rack = new THREE.Mesh(
        new THREE.BoxGeometry(1.45, 0.22, 0.55),
        new THREE.MeshStandardMaterial({
            color: 0x0d4370,
            emissive: 0x082f50,
            emissiveIntensity: 0.05,
            metalness: 0.26,
            roughness: 0.55
        })
    );
    rack.position.set(0, 0.76, 2.6);
    rack.castShadow = true;
    rack.receiveShadow = true;
    root.add(rack);

    const meadowRing = new THREE.Mesh(
        new THREE.RingGeometry(6.4, 17.2, 48),
        new THREE.MeshStandardMaterial({
            color: 0xa8d774,
            emissive: 0x6aa447,
            emissiveIntensity: 0.05,
            metalness: 0.02,
            roughness: 0.98,
            side: THREE.DoubleSide
        })
    );
    meadowRing.rotation.x = -Math.PI / 2;
    meadowRing.position.y = 0.007;
    meadowRing.receiveShadow = true;
    root.add(meadowRing);

    for (const target of targets) {
        const outerRing = target.rings[target.rings.length - 1];
        if (!outerRing) continue;

        const baseDisc = new THREE.Mesh(
            new THREE.CircleGeometry(outerRing.radius + 0.12, 48),
            new THREE.MeshStandardMaterial({
                color: 0x1a4f39,
                emissive: 0x133726,
                emissiveIntensity: 0.08,
                metalness: 0.03,
                roughness: 0.94
            })
        );
        baseDisc.rotation.x = -Math.PI / 2;
        baseDisc.position.set(target.position.x, 0.032, target.position.z);
        baseDisc.receiveShadow = true;
        root.add(baseDisc);

        for (let i = target.rings.length - 1; i >= 0; i -= 1) {
            const ringDef = target.rings[i];
            const innerRadius = i > 0 ? target.rings[i - 1].radius : 0;
            const ringGeometry = innerRadius > 0.001
                ? new THREE.RingGeometry(innerRadius + 0.03, ringDef.radius, 48)
                : new THREE.CircleGeometry(ringDef.radius, 48);
            const ring = new THREE.Mesh(
                ringGeometry,
                new THREE.MeshStandardMaterial({
                    color: ringDef.color,
                    emissive: ringDef.color,
                    emissiveIntensity: 0.04,
                    metalness: 0.08,
                    roughness: 0.72,
                    side: THREE.DoubleSide
                })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(target.position.x, 0.036 + (target.rings.length - i) * 0.004, target.position.z);
            ring.receiveShadow = true;
            root.add(ring);
        }
    }

    const finalScoreboard = scoreboard ?? new TargetTossScoreboardVisual(new THREE.Vector3(-3.9, 0, 1.8));
    if (!scoreboard) {
        root.add(finalScoreboard.root);
    }

    addForestBackdrop(root);
    return finalScoreboard;
}

function addForestBackdrop(root: THREE.Group): void {
    for (const tree of TREE_LAYOUT) {
        const treeRoot = new THREE.Group();
        treeRoot.position.set(tree.x, 0, tree.z);
        treeRoot.scale.setScalar(tree.s);

        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.14, 0.2, 1.55, 7),
            new THREE.MeshStandardMaterial({
                color: 0x6e4d2f,
                emissive: 0x3a2414,
                emissiveIntensity: 0.08,
                metalness: 0.02,
                roughness: 0.96
            })
        );
        trunk.position.y = 0.78;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        treeRoot.add(trunk);

        const foliageBottom = new THREE.Mesh(
            new THREE.ConeGeometry(0.82, 1.45, 8),
            new THREE.MeshStandardMaterial({
                color: 0x3d8b41,
                emissive: 0x1f4b22,
                emissiveIntensity: 0.03,
                metalness: 0.03,
                roughness: 0.92
            })
        );
        foliageBottom.position.y = 1.7;
        foliageBottom.castShadow = true;
        foliageBottom.receiveShadow = true;
        treeRoot.add(foliageBottom);

        const foliageTop = new THREE.Mesh(
            new THREE.ConeGeometry(0.58, 1.1, 8),
            new THREE.MeshStandardMaterial({
                color: 0x4da34f,
                emissive: 0x28592b,
                emissiveIntensity: 0.03,
                metalness: 0.03,
                roughness: 0.9
            })
        );
        foliageTop.position.y = 2.35;
        foliageTop.castShadow = true;
        foliageTop.receiveShadow = true;
        treeRoot.add(foliageTop);

        root.add(treeRoot);
    }
}



