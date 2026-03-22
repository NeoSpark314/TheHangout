import * as THREE from 'three';
import type { IInteractionEvent } from '../../shared/contracts/IInteractionEvent';
import type { IPose, IQuaternion } from '../../shared/contracts/IMath';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IInteractable } from '../../shared/contracts/IInteractable';
import type { IMovableHoldable } from '../../shared/contracts/IMovableHoldable';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';
import type { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import { SharedPropHandle } from '../runtime/SharedPropHandle';

interface IGunFirePayload {
    origin: [number, number, number];
    end: [number, number, number];
    hit: boolean;
}

interface ITracerFx {
    line: THREE.Line;
    material: THREE.LineBasicMaterial;
    life: number;
}

interface IImpactFx {
    mesh: THREE.Mesh;
    material: THREE.MeshStandardMaterial;
    life: number;
}

const GUN_FIRE_EVENT = 'fire';
const GUN_MAX_RANGE = 22;
const GUN_FIRE_COOLDOWN_MS = 120;
const GUN_RECOIL_DISTANCE = 0.035;
const GUN_RECOIL_RECOVER_SPEED = 8.5;
const GUN_IMPULSE_STRENGTH = 0.035;

class PewPewGunInstance extends BaseReplicatedObjectInstance {
    public readonly replicationPolicy = {
        relayIncomingFromPeer: 'others' as const,
        includeInSnapshot: false,
        defaultLocalEcho: false
    };

    private readonly gunEntity: (PhysicsPropEntity & IEntity & IInteractable & IMovableHoldable) | null;
    private readonly gunHandle: SharedPropHandle | null;
    private readonly slideMesh: THREE.Mesh | null;
    private readonly muzzleMarker: THREE.Object3D | null;
    private readonly barrelRearMarker: THREE.Object3D | null;
    private readonly fxRoot: THREE.Group | null;
    private readonly tracerFx: ITracerFx[] = [];
    private readonly impactFx: IImpactFx[] = [];
    private slideRecoil = 0;
    private lastFireAtMs = 0;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        super(context, 'pew-pew-gun');

        const position = config.position ?? { x: 0, y: 1.1, z: 0 };
        const built = createGunVisual();
        this.slideMesh = built.slide;
        this.muzzleMarker = built.muzzle;
        this.barrelRearMarker = built.barrelRear;
        this.fxRoot = context.scene.isRenderingAvailable() ? this.ownSceneObject(new THREE.Group()) : null;
        if (this.fxRoot) {
            this.fxRoot.name = `pew-pew-gun-fx:${this.id}`;
        }

        const handle = context.props.spawnShared({
            shape: 'box',
            size: 0.42,
            position,
            mesh: built.root,
            halfExtents: { x: 0.08, y: 0.07, z: 0.22 },
            ownerId: (typeof config.ownerId === 'string' || config.ownerId === null) ? config.ownerId : undefined,
            profile: 'held-tool',
            interaction: {
                onUse: (event) => this.handleInteraction(event),
                getCanonicalGrabOffset: (hand) => canonicalGunGrip(hand),
                getPreferredHeldQuaternionSpace: () => 'aim'
            }
        }) as SharedPropHandle | null;
        const entity = handle?.getEntity() as (PhysicsPropEntity & IEntity & IInteractable & IMovableHoldable) | null;
        this.gunHandle = handle;
        this.gunEntity = entity;

        if (entity && typeof config.rotationY === 'number') {
            const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), config.rotationY);
            entity.rigidBody.setRotation(rotation as unknown as IQuaternion, true);
        }

    }

    public getPrimaryEntity(): IEntity | null {
        return this.gunEntity;
    }

    public update(delta: number): void {
        if (this.slideMesh) {
            this.slideRecoil = Math.max(0, this.slideRecoil - delta * GUN_RECOIL_RECOVER_SPEED);
            this.slideMesh.position.z = 0.018 + this.slideRecoil * GUN_RECOIL_DISTANCE;
        }

        for (let i = this.tracerFx.length - 1; i >= 0; i -= 1) {
            const fx = this.tracerFx[i];
            fx.life -= delta * 4.5;
            fx.material.opacity = Math.max(0, fx.life);
            if (fx.life > 0) continue;
            fx.line.removeFromParent();
            fx.line.geometry.dispose();
            fx.material.dispose();
            this.tracerFx.splice(i, 1);
        }

        for (let i = this.impactFx.length - 1; i >= 0; i -= 1) {
            const fx = this.impactFx[i];
            fx.life -= delta * 3.2;
            const pulse = Math.max(0, fx.life);
            fx.material.opacity = pulse;
            fx.mesh.scale.setScalar(1 + (1 - pulse) * 1.4);
            if (fx.life > 0) continue;
            fx.mesh.removeFromParent();
            fx.mesh.geometry.dispose();
            fx.material.dispose();
            this.impactFx.splice(i, 1);
        }
    }

    public onReplicationEvent(eventType: string, data: unknown, _meta: IObjectReplicationMeta): void {
        if (eventType !== GUN_FIRE_EVENT) return;
        const payload = data as Partial<IGunFirePayload>;
        if (!isGunFirePayload(payload)) return;
        this.presentShot(payload);
    }

    private handleInteraction(event: IInteractionEvent): void {
        if (!this.gunEntity) return;
        if (event.type !== 'trigger' || event.phase !== 'start') return;
        if (this.gunEntity.heldBy !== event.playerId) return;

        const now = this.nowMs();
        if ((now - this.lastFireAtMs) < GUN_FIRE_COOLDOWN_MS) return;
        this.lastFireAtMs = now;

        const payload = this.computeShotPayload();
        if (!payload) return;

        this.presentShot(payload);
        this.emitSyncEvent(GUN_FIRE_EVENT, payload, { localEcho: false });
    }

    private computeShotPayload(): IGunFirePayload | null {
        const muzzle = this.muzzleMarker;
        const barrelRear = this.barrelRearMarker;
        if (!muzzle || !barrelRear) return null;

        const origin = new THREE.Vector3();
        const rear = new THREE.Vector3();
        const end = new THREE.Vector3();
        muzzle.getWorldPosition(origin);
        barrelRear.getWorldPosition(rear);

        const direction = origin.clone().sub(rear).normalize();
        if (direction.lengthSq() < 0.000001) return null;
        end.copy(origin).addScaledVector(direction, GUN_MAX_RANGE);

        let hit = false;
        const physicsHit = this.context.props.raycast(
            { x: origin.x, y: origin.y, z: origin.z },
            { x: direction.x, y: direction.y, z: direction.z },
            GUN_MAX_RANGE
        );
        if (physicsHit && physicsHit.distance >= 0.12) {
            if (physicsHit.entityId !== this.id && physicsHit.entityId !== this.gunEntity?.id) {
                if (physicsHit.entityId) {
                    end.set(physicsHit.point.x, physicsHit.point.y, physicsHit.point.z);
                    hit = true;

                    if (physicsHit.prop) {
                        this.context.props.applyImpulse(
                            physicsHit.prop,
                            {
                                x: direction.x * GUN_IMPULSE_STRENGTH,
                                y: direction.y * GUN_IMPULSE_STRENGTH,
                                z: direction.z * GUN_IMPULSE_STRENGTH
                            },
                            physicsHit.point,
                            {
                                linearFactor: 1,
                                torqueFactor: 0.18
                            }
                        );
                    }
                } else {
                    end.set(physicsHit.point.x, physicsHit.point.y, physicsHit.point.z);
                    hit = true;
                }
            }
        }

        return {
            origin: [origin.x, origin.y, origin.z],
            end: [end.x, end.y, end.z],
            hit
        };
    }

    private presentShot(payload: IGunFirePayload): void {
        this.slideRecoil = 1;
        this.spawnMuzzleFlash(payload);
        this.spawnTracer(payload);
        if (payload.hit) {
            this.spawnImpact(payload);
        }
        this.playShotSound(payload);
    }

    private spawnMuzzleFlash(payload: IGunFirePayload): void {
        if (!this.fxRoot) return;

        const material = new THREE.MeshStandardMaterial({
            color: 0xfff1a8,
            emissive: 0xffb347,
            emissiveIntensity: 1.7,
            transparent: true,
            opacity: 0.98,
            metalness: 0.02,
            roughness: 0.28,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), material);
        mesh.position.set(payload.origin[0], payload.origin[1], payload.origin[2]);
        mesh.scale.set(2.6, 1.1, 1.1);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.fxRoot.add(mesh);
        this.impactFx.push({ mesh, material, life: 0.22 });
    }

    private spawnTracer(payload: IGunFirePayload): void {
        if (!this.fxRoot) return;

        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(payload.origin[0], payload.origin[1], payload.origin[2]),
            new THREE.Vector3(payload.end[0], payload.end[1], payload.end[2])
        ]);
        const material = new THREE.LineBasicMaterial({
            color: payload.hit ? 0xffd766 : 0x7ce8ff,
            transparent: true,
            opacity: 0.92
        });
        const line = new THREE.Line(geometry, material);
        this.fxRoot.add(line);
        this.tracerFx.push({ line, material, life: 1 });
    }

    private spawnImpact(payload: IGunFirePayload): void {
        if (!this.fxRoot) return;

        const material = new THREE.MeshStandardMaterial({
            color: 0xfff2b3,
            emissive: 0xffcc55,
            emissiveIntensity: 0.85,
            transparent: true,
            opacity: 1,
            metalness: 0.05,
            roughness: 0.45
        });
        const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), material);
        mesh.position.set(payload.end[0], payload.end[1], payload.end[2]);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.fxRoot.add(mesh);
        this.impactFx.push({ mesh, material, life: 1 });
    }

    private playShotSound(payload: IGunFirePayload): void {
        this.context.audio.playFxSweep({ down: true, intensity: 0.5, position: { x: payload.origin[0], y: payload.origin[1], z: payload.origin[2] } });
        this.context.audio.playMelodyNote({ frequency: 420, intensity: 0.34, position: { x: payload.origin[0], y: payload.origin[1], z: payload.origin[2] } });
        this.context.audio.playArpNote({ frequency: 280, intensity: 0.24, brightness: 0.65, position: { x: payload.origin[0], y: payload.origin[1], z: payload.origin[2] } });
        if (payload.hit) {
            this.context.audio.playArpNote({ frequency: 460, intensity: 0.2, brightness: 0.85, position: { x: payload.end[0], y: payload.end[1], z: payload.end[2] } });
        }
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}

function createGunVisual(): { root: THREE.Group; slide: THREE.Mesh; muzzle: THREE.Object3D; barrelRear: THREE.Object3D } {
    const root = new THREE.Group();
    root.name = 'pew-pew-gun';

    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0xff5f3a,
        emissive: 0x5a1408,
        emissiveIntensity: 0.08,
        metalness: 0.18,
        roughness: 0.56
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
        color: 0x49b9ff,
        emissive: 0x1260c8,
        emissiveIntensity: 0.22,
        metalness: 0.08,
        roughness: 0.34
    });
    const gripMaterial = new THREE.MeshStandardMaterial({
        color: 0xffeb66,
        emissive: 0x4a4308,
        emissiveIntensity: 0.06,
        metalness: 0.04,
        roughness: 0.88
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.28), frameMaterial);
    body.position.set(0, 0.015, -0.03);
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.05, 0.24), new THREE.MeshStandardMaterial({
        color: 0x2f6dff,
        emissive: 0x17348a,
        emissiveIntensity: 0.12,
        metalness: 0.16,
        roughness: 0.32
    }));
    slide.position.set(0, 0.044, 0.018);
    slide.castShadow = true;
    slide.receiveShadow = true;
    root.add(slide);

    const barrelCore = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.18, 14), frameMaterial);
    barrelCore.rotation.x = Math.PI / 2;
    barrelCore.position.set(0, 0.018, -0.165);
    barrelCore.castShadow = true;
    barrelCore.receiveShadow = true;
    root.add(barrelCore);

    const barrelGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 10), accentMaterial);
    barrelGlow.rotation.x = Math.PI / 2;
    barrelGlow.position.set(0, 0.018, -0.165);
    root.add(barrelGlow);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.055), gripMaterial);
    grip.position.set(0, -0.075, 0.045);
    grip.rotation.x = THREE.MathUtils.degToRad(-18);
    grip.castShadow = true;
    grip.receiveShadow = true;
    root.add(grip);

    const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 8, 16, Math.PI), frameMaterial);
    triggerGuard.rotation.x = Math.PI / 2;
    triggerGuard.position.set(0, -0.022, 0.005);
    triggerGuard.castShadow = true;
    root.add(triggerGuard);

    const energyRailLeft = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.16), accentMaterial);
    energyRailLeft.position.set(-0.02, 0.054, -0.08);
    const energyRailRight = energyRailLeft.clone();
    energyRailRight.position.x = 0.02;
    root.add(energyRailLeft, energyRailRight);

    const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.014), frameMaterial);
    rearSight.position.set(0, 0.07, 0.055);
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.014, 0.012), accentMaterial);
    frontSight.position.set(0, 0.065, -0.235);
    root.add(rearSight, frontSight);

    const barrelRear = new THREE.Object3D();
    barrelRear.position.set(0, 0.018, -0.085);
    root.add(barrelRear);

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.018, -0.255);
    root.add(muzzle);

    root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.userData.entityId = 'pending';
    });

    return { root, slide, muzzle, barrelRear };
}

function canonicalGunGrip(hand: 'left' | 'right'): IPose {
    const x = hand === 'left' ? 0.01 : -0.01;
    const euler = new THREE.Euler(
        THREE.MathUtils.degToRad(6),
        0,
        hand === 'left' ? THREE.MathUtils.degToRad(5) : THREE.MathUtils.degToRad(-5),
        'XYZ'
    );
    const quat = new THREE.Quaternion().setFromEuler(euler);
    return {
        position: { x, y: 0.052, z: -0.1 },
        quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w }
    };
}

function isGunFirePayload(value: Partial<IGunFirePayload> | null | undefined): value is IGunFirePayload {
    return !!value
        && Array.isArray(value.origin)
        && value.origin.length === 3
        && Array.isArray(value.end)
        && value.end.length === 3
        && typeof value.hit === 'boolean';
}

export class PewPewGunObject implements IObjectModule {
    public readonly id = 'pew-pew-gun';
    public readonly displayName = 'Pew Pew Gun';
    public readonly tags = ['prop', 'shared', 'portable', 'toy', 'gun'];
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): PewPewGunInstance {
        return new PewPewGunInstance(context, config);
    }
}


