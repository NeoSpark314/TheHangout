import * as THREE from 'three';
import type { AppContext } from '../../../app/AppContext';
import eventBus from '../../../app/events/EventBus';
import { EVENTS } from '../../../shared/constants/Constants';
import { EntityType } from '../../../shared/contracts/IEntityState';
import type { IObjectModule } from '../../contracts/IObjectModule';
import type {
    IReplicatedScenarioModule,
    IScenarioReplicationEmitOptions,
    IScenarioReplicationMeta,
    IScenarioReplicationPolicy
} from '../../contracts/IReplicatedScenarioModule';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';
import type { IScenarioLoadOptions, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type {
    IScenarioActionDefinition,
    IScenarioActionExecutionContext,
    IScenarioActionExecutionResult,
    IScenarioActionProvider,
    IScenarioActionQueryContext
} from '../../contracts/IScenarioAction';
import { ThrowableBallObject } from '../../objects/ThrowableBallObject';
import type { SessionRuntime } from '../../../world/session/SessionRuntime';
import type { PhysicsPropEntity } from '../../../world/entities/PhysicsPropEntity';
import type { IPhysicsColliderHandle } from '../../contracts/IObjectRuntimeContext';
import type { PlayerAvatarEntity } from '../../../world/entities/PlayerAvatarEntity';

interface ITargetRingDefinition {
    radius: number;
    points: number;
    color: number;
}

interface ITargetDefinition {
    id: string;
    position: { x: number; y: number; z: number };
    size: { x: number; y: number; z: number };
    rings: ITargetRingDefinition[];
}

interface ITargetRuntime extends ITargetDefinition {
    collider: IPhysicsColliderHandle | null;
}

interface ITargetTossState {
    playerOrder: string[];
    currentTurnIndex: number;
    throwsTaken: number;
    scores: Record<string, number>;
    resetPending: boolean;
}

interface ITargetTossStateSyncPayload {
    state: ITargetTossState;
}

class TargetTossActionProvider implements IScenarioActionProvider {
    private static readonly ACTION_RESET_GAME = 'reset-game';

    constructor(private readonly scenario: TargetTossScenario) { }

    public getActions(_context: IScenarioActionQueryContext): IScenarioActionDefinition[] {
        return [
            {
                id: TargetTossActionProvider.ACTION_RESET_GAME,
                label: 'Reset Game',
                description: 'Reset scores, reset balls, and start over from the first player.',
                requiredRole: 'moderator',
                dangerous: true,
                replicateToGuests: false
            }
        ];
    }

    public executeAction(
        actionId: string,
        _payload: unknown,
        context: IScenarioActionExecutionContext
    ): IScenarioActionExecutionResult {
        if (actionId !== TargetTossActionProvider.ACTION_RESET_GAME) {
            return { ok: false, reason: `Unsupported action: ${actionId}` };
        }

        if (context.source === 'replicated') {
            return { ok: true };
        }

        this.scenario.resetGame();
        return { ok: true, message: 'Target Toss reset.' };
    }
}

class TargetTossScoreboardVisual {
    public readonly root = new THREE.Group();
    private readonly screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    private readonly canvas: HTMLCanvasElement;
    private readonly texture: THREE.CanvasTexture;
    private lastText = '';
    private readonly tmpRootWorld = new THREE.Vector3();
    private readonly tmpLookTarget = new THREE.Vector3();

    constructor(position: THREE.Vector3) {
        this.root.name = 'target-toss-scoreboard';
        this.root.position.copy(position);

        const postMaterial = new THREE.MeshStandardMaterial({
            color: 0x0b315f,
            emissive: 0x082348,
            emissiveIntensity: 0.22,
            metalness: 0.35,
            roughness: 0.58
        });
        const postLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), postMaterial);
        const postRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), postMaterial);
        postLeft.position.set(-0.95, 1.05, 0);
        postRight.position.set(0.95, 1.05, 0);

        const header = new THREE.Mesh(
            new THREE.BoxGeometry(2.15, 1.5, 0.08),
            new THREE.MeshStandardMaterial({
                color: 0x144d8f,
                emissive: 0x0d3564,
                emissiveIntensity: 0.25,
                metalness: 0.2,
                roughness: 0.45
            })
        );
        header.position.set(0, 2.0, -0.03);

        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = 768;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.generateMipmaps = false;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;

        this.screen = new THREE.Mesh(
            new THREE.PlaneGeometry(1.95, 1.38),
            new THREE.MeshBasicMaterial({
                map: this.texture,
                transparent: false
            })
        );
        this.screen.position.set(0, 2.0, 0.02);

        const base = new THREE.Mesh(
            new THREE.BoxGeometry(2.6, 0.16, 0.75),
            new THREE.MeshStandardMaterial({
                color: 0x184b7a,
                emissive: 0x0b2944,
                emissiveIntensity: 0.16,
                metalness: 0.16,
                roughness: 0.68
            })
        );
        base.position.set(0, 0.08, 0);

        this.root.add(postLeft, postRight, header, this.screen, base);
    }

    public update(state: ITargetTossState, getPlayerLabel: (playerId: string) => string): void {
        const currentPlayerId = state.playerOrder[state.currentTurnIndex] || null;
        const currentPlayerLabel = currentPlayerId ? getPlayerLabel(currentPlayerId) : 'Waiting For Players';
        const lines = state.playerOrder.length === 0
            ? ['No active players yet.']
            : state.playerOrder.map((playerId, index) => {
                const prefix = index === state.currentTurnIndex ? '> ' : '  ';
                const score = state.scores[playerId] ?? 0;
                return `${prefix}${getPlayerLabel(playerId)}  ${score} pts`;
            });

        const text = [
            'TARGET TOSS',
            `Turn: ${currentPlayerLabel}`,
            `Throws: ${state.throwsTaken}/3${state.resetPending ? '  |  Resetting...' : ''}`,
            '',
            ...lines
        ].join('\n');

        if (text === this.lastText) {
            return;
        }
        this.lastText = text;

        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const gradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, '#0d2d54');
        gradient.addColorStop(1, '#08182e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.strokeStyle = '#7be7ff';
        ctx.lineWidth = 10;
        ctx.strokeRect(12, 12, this.canvas.width - 24, this.canvas.height - 24);

        ctx.fillStyle = '#e8fbff';
        ctx.font = '700 76px "Segoe UI", Arial, sans-serif';
        ctx.fillText('TARGET TOSS', 56, 110);

        ctx.fillStyle = '#9fe8ff';
        ctx.font = '600 46px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`Turn: ${currentPlayerLabel}`, 56, 190);
        ctx.fillText(`Throws: ${state.throwsTaken}/3`, 56, 250);
        if (state.resetPending) {
            ctx.fillStyle = '#ffd166';
            ctx.fillText('Resetting...', 540, 250);
        }

        ctx.fillStyle = '#d9f8ff';
        ctx.font = '600 42px "Segoe UI", Arial, sans-serif';
        let y = 340;
        if (state.playerOrder.length === 0) {
            ctx.fillText('No active players yet.', 56, y);
        } else {
            for (const line of lines) {
                ctx.fillText(line, 56, y);
                y += 64;
            }
        }

        this.texture.needsUpdate = true;
    }

    public faceCamera(camera: THREE.Camera | null | undefined): void {
        if (!camera) return;
        this.root.getWorldPosition(this.tmpRootWorld);
        this.tmpLookTarget.set(camera.position.x, this.tmpRootWorld.y, camera.position.z);
        this.root.lookAt(this.tmpLookTarget);
    }

    public dispose(): void {
        this.root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach((material) => material.dispose());
            } else {
                mesh.material.dispose();
            }
        });
        this.texture.dispose();
        this.root.removeFromParent();
    }
}

const BALL_DEFINITIONS = [
    { id: 'target-toss-ball-a', position: { x: -0.45, y: 1.05, z: 2.6 }, color: 0xff8b3d },
    { id: 'target-toss-ball-b', position: { x: 0.0, y: 1.05, z: 2.6 }, color: 0xffc145 },
    { id: 'target-toss-ball-c', position: { x: 0.45, y: 1.05, z: 2.6 }, color: 0xff5f6d }
] as const;

const TARGET_DEFINITIONS: ITargetDefinition[] = [
    {
        id: 'main-target-zone',
        position: { x: 0.0, y: 0.04, z: -5.9 },
        size: { x: 1.65, y: 0.03, z: 1.65 },
        rings: [
            { radius: 0.42, points: 30, color: 0xffcf57 },
            { radius: 0.86, points: 20, color: 0x7cf2a1 },
            { radius: 1.35, points: 10, color: 0x59d7ff }
        ]
    }
];

export class TargetTossScenario implements IReplicatedScenarioModule {
    public readonly id = 'target-toss';
    public readonly displayName = 'Target Toss';
    public readonly kind = 'minigame' as const;
    public readonly maxPlayers = 8;
    public readonly replicationKey = `scenario:${this.id}`;
    public readonly replicationPolicy: IScenarioReplicationPolicy = {
        relayIncomingFromPeer: 'others',
        includeInSnapshot: true,
        defaultLocalEcho: true
    };
    public emitReplicationEvent?: (eventType: string, data: unknown, options?: IScenarioReplicationEmitOptions) => void;

    private readonly objectModules: IObjectModule[] = [new ThrowableBallObject()];
    private readonly actionProvider = new TargetTossActionProvider(this);
    private readonly root = new THREE.Group();
    private readonly targets: ITargetRuntime[] = [];
    private readonly ballIds = BALL_DEFINITIONS.map((ball) => ball.id);
    private rackCollider: IPhysicsColliderHandle | null = null;
    private countedBallIds = new Set<string>();
    private scoredBallIds = new Set<string>();
    private resetQueuedAtMs: number | null = null;
    private scoreboard: TargetTossScoreboardVisual | null = null;
    private collisionStartedHandler: ((data: { handleA: number; handleB: number; entityAId: string | null; entityBId: string | null }) => void) | null = null;
    private previousBackground: THREE.Color | THREE.Texture | null = null;
    private previousFog: THREE.Fog | THREE.FogExp2 | null = null;
    private state: ITargetTossState = {
        playerOrder: [],
        currentTurnIndex: 0,
        throwsTaken: 0,
        scores: {},
        resetPending: false
    };

    constructor(
        private readonly session: SessionRuntime,
        private readonly context: AppContext
    ) {
        this.root.name = 'target-toss-scenario';
    }

    public load(context: AppContext, options: IScenarioLoadOptions): void {
        const seed = options.seed ?? context.sessionConfig.seed;
        if (context.sessionConfig.seed !== seed) {
            context.sessionConfig = { ...context.sessionConfig, seed };
        }

        this.session.ensureGroundPhysics();
        this.createTargets();
        this.createRackCollider();
        this.spawnSharedBalls();
        this.createVisuals();

        if (context.isHost) {
            this.reconcilePlayers();
            this.state.throwsTaken = 0;
        }

        this.registerCollisionListener();
        this.refreshScoreboardVisual();
    }

    public unload(_context: AppContext): void {
        if (this.collisionStartedHandler) {
            eventBus.off(EVENTS.PHYSICS_COLLISION_STARTED, this.collisionStartedHandler);
            this.collisionStartedHandler = null;
        }

        this.scoreboard?.dispose();
        this.scoreboard = null;

        this.targets.forEach((target) => {
            if (target.collider?.body) {
                this.context.runtime.physics.removeRigidBody(target.collider.body);
            }
        });
        this.targets.length = 0;
        if (this.rackCollider?.body) {
            this.context.runtime.physics.removeRigidBody(this.rackCollider.body);
        }
        this.rackCollider = null;

        if (this.root.parent) {
            this.root.removeFromParent();
        }
        this.root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach((material) => material.dispose());
            } else {
                mesh.material.dispose();
            }
        });
        this.root.clear();

        const scene = this.context.runtime.render?.scene;
        if (scene) {
            scene.background = this.previousBackground;
            scene.fog = this.previousFog;
        }

        this.previousBackground = null;
        this.previousFog = null;
        this.countedBallIds.clear();
        this.scoredBallIds.clear();
        this.resetQueuedAtMs = null;
    }

    public update(_delta: number): void {
        if (this.context.isHost) {
            this.reconcilePlayers();
            this.updateThrowProgress();
            this.updatePendingReset();
        }

        if (this.scoreboard) {
            this.scoreboard.faceCamera(this.context.runtime.render?.camera);
            this.refreshScoreboardVisual();
        }
    }

    public getSpawnPoint(index: number): IScenarioSpawnPoint {
        const offsets = [
            { x: 0, z: 4.25 },
            { x: -1.0, z: 4.6 },
            { x: 1.0, z: 4.6 },
            { x: -2.0, z: 5.0 },
            { x: 2.0, z: 5.0 },
            { x: -3.0, z: 5.45 },
            { x: 3.0, z: 5.45 },
            { x: 0.0, z: 5.85 }
        ];
        const spawn = offsets[index % offsets.length];
        return {
            position: { x: spawn.x, y: 0.2, z: spawn.z },
            yaw: Math.PI
        };
    }

    public getObjectModules(): IObjectModule[] {
        return this.objectModules;
    }

    public getActionProvider(): IScenarioActionProvider {
        return this.actionProvider;
    }

    public onScenarioReplicationEvent(eventType: string, data: unknown, _meta: IScenarioReplicationMeta): void {
        if (eventType !== 'state-sync') return;
        if (!isStateSyncPayload(data)) return;
        this.applyState(data.state);
    }

    public captureScenarioReplicationSnapshot(): unknown {
        return {
            state: this.cloneState()
        } satisfies ITargetTossStateSyncPayload;
    }

    public applyScenarioReplicationSnapshot(snapshot: unknown): void {
        if (!isStateSyncPayload(snapshot)) return;
        this.applyState(snapshot.state);
    }

    public resetGame(): void {
        if (!this.context.isHost) return;

        const nextScores: Record<string, number> = {};
        for (const playerId of this.collectPlayerOrder()) {
            nextScores[playerId] = 0;
        }

        this.countedBallIds.clear();
        this.scoredBallIds.clear();
        this.resetQueuedAtMs = null;

        this.state = {
            playerOrder: this.collectPlayerOrder(),
            currentTurnIndex: 0,
            throwsTaken: 0,
            scores: nextScores,
            resetPending: false
        };

        this.resetBallsToRack();
        this.broadcastState();
    }

    private spawnSharedBalls(): void {
        for (const ball of BALL_DEFINITIONS) {
            if (this.session.getObjectInstance(ball.id)) continue;
            this.session.spawnObjectModule('throwable-ball', {
                id: ball.id,
                position: ball.position,
                color: ball.color,
                size: 0.18
            });
        }
    }

    private createTargets(): void {
        if (this.targets.length > 0) return;

        for (const definition of TARGET_DEFINITIONS) {
            const collider = this.context.runtime.physics.createStaticCuboidSensor(
                definition.size.x * 0.5,
                definition.size.y * 0.5,
                definition.size.z * 0.5,
                definition.position
            );
            this.targets.push({ ...definition, collider });
        }
    }

    private createRackCollider(): void {
        if (this.rackCollider) return;
        this.rackCollider = this.context.runtime.physics.createStaticCuboidCollider(
            1.45 * 0.5,
            0.22 * 0.5,
            0.55 * 0.5,
            { x: 0, y: 0.76, z: 2.6 }
        );
    }

    private createVisuals(): void {
        const scene = this.context.runtime.render?.scene;
        if (!scene) return;

        this.previousBackground = scene.background as THREE.Color | THREE.Texture | null;
        this.previousFog = scene.fog;
        scene.background = new THREE.Color(0x8edbff);
        scene.fog = new THREE.Fog(0xbfecc8, 36, 115);

        if (!this.root.parent) {
            scene.add(this.root);
        }

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
        this.root.add(floor);

        const lane = new THREE.Mesh(
            new THREE.BoxGeometry(4.5, 0.03, 12.5),
            new THREE.MeshStandardMaterial({
                color: 0x1b7fd1,
                emissive: 0x0f4f8a,
                emissiveIntensity: 0.18,
                metalness: 0.18,
                roughness: 0.48
            })
        );
        lane.position.set(0, 0.015, -1.0);
        this.root.add(lane);

        const throwLine = new THREE.Mesh(
            new THREE.BoxGeometry(4.7, 0.03, 0.14),
            new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: 0xffffff,
                emissiveIntensity: 0.3,
                metalness: 0.12,
                roughness: 0.3
            })
        );
        throwLine.position.set(0, 0.028, 1.95);
        this.root.add(throwLine);

        const rack = new THREE.Mesh(
            new THREE.BoxGeometry(1.45, 0.22, 0.55),
            new THREE.MeshStandardMaterial({
                color: 0x0d4370,
                emissive: 0x082f50,
                emissiveIntensity: 0.18,
                metalness: 0.26,
                roughness: 0.55
            })
        );
        rack.position.set(0, 0.76, 2.6);
        this.root.add(rack);

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
        this.root.add(meadowRing);

        for (const target of TARGET_DEFINITIONS) {
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
            this.root.add(baseDisc);

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
                        emissiveIntensity: 0.16,
                        metalness: 0.08,
                        roughness: 0.72,
                        side: THREE.DoubleSide
                    })
                );
                ring.rotation.x = -Math.PI / 2;
                ring.position.set(target.position.x, 0.036 + (target.rings.length - i) * 0.004, target.position.z);
                this.root.add(ring);
            }
        }

        if (!this.scoreboard) {
            this.scoreboard = new TargetTossScoreboardVisual(new THREE.Vector3(-3.9, 0, 1.8));
            this.root.add(this.scoreboard.root);
        }

        this.addForestBackdrop();
    }

    private addForestBackdrop(): void {
        const treeLayout = [
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
        ];

        for (const tree of treeLayout) {
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
                    emissiveIntensity: 0.11,
                    metalness: 0.03,
                    roughness: 0.92
                })
            );
            foliageBottom.position.y = 1.7;
            treeRoot.add(foliageBottom);

            const foliageTop = new THREE.Mesh(
                new THREE.ConeGeometry(0.58, 1.1, 8),
                new THREE.MeshStandardMaterial({
                    color: 0x4da34f,
                    emissive: 0x28592b,
                    emissiveIntensity: 0.1,
                    metalness: 0.03,
                    roughness: 0.9
                })
            );
            foliageTop.position.y = 2.35;
            treeRoot.add(foliageTop);

            this.root.add(treeRoot);
        }
    }

    private registerCollisionListener(): void {
        if (this.collisionStartedHandler) return;

        this.collisionStartedHandler = (data) => {
            if (!this.context.isHost || this.state.resetPending) return;

            const target = this.targets.find((entry) =>
                entry.collider?.id === data.handleA || entry.collider?.id === data.handleB
            );
            if (!target) return;

            const entityId = this.resolveBallEntityIdFromCollision(data);
            if (!entityId || this.scoredBallIds.has(entityId)) return;

            const points = this.resolvePointsForBall(entityId, target);
            if (points === null) return;

            this.scoredBallIds.add(entityId);
            this.countBallThrow(entityId);
            this.awardPoints(points);
        };

        eventBus.on(EVENTS.PHYSICS_COLLISION_STARTED, this.collisionStartedHandler);
    }

    private resolveBallEntityIdFromCollision(data: { entityAId: string | null; entityBId: string | null }): string | null {
        if (data.entityAId && (this.ballIds as readonly string[]).includes(data.entityAId)) {
            return data.entityAId;
        }
        if (data.entityBId && (this.ballIds as readonly string[]).includes(data.entityBId)) {
            return data.entityBId;
        }
        return null;
    }

    private resolvePointsForBall(ballId: string, target: ITargetRuntime): number | null {
        const entity = this.getBallEntity(ballId);
        if (!entity) return null;

        const translation = entity.rigidBody.translation();
        const dx = translation.x - target.position.x;
        const dz = translation.z - target.position.z;
        const radialDistance = Math.hypot(dx, dz);

        for (const ring of target.rings) {
            if (radialDistance <= ring.radius) {
                return ring.points;
            }
        }

        return null;
    }

    private updateThrowProgress(): void {
        if (this.state.resetPending) return;

        let changed = false;
        for (const ball of BALL_DEFINITIONS) {
            if (this.countedBallIds.has(ball.id)) continue;
            const entity = this.getBallEntity(ball.id);
            if (!entity) continue;

            const translation = entity.rigidBody.translation();
            const movedDistance = Math.hypot(
                translation.x - ball.position.x,
                translation.y - ball.position.y,
                translation.z - ball.position.z
            );
            const leftRackForward = translation.z < (ball.position.z - 1.15);
            if (!leftRackForward && movedDistance < 2.0) continue;

            this.countedBallIds.add(ball.id);
            changed = true;
        }

        if (!changed) return;
        this.state.throwsTaken = this.countedBallIds.size;
        if (this.state.throwsTaken >= 3) {
            this.queueTurnReset();
        }
        this.broadcastState();
    }

    private updatePendingReset(): void {
        if (this.resetQueuedAtMs === null) return;
        if (this.nowMs() < this.resetQueuedAtMs) return;

        this.resetQueuedAtMs = null;
        this.advanceTurnAndResetBalls();
    }

    private countBallThrow(ballId: string): void {
        if (this.countedBallIds.has(ballId)) return;
        this.countedBallIds.add(ballId);
        this.state.throwsTaken = this.countedBallIds.size;
        if (this.state.throwsTaken >= 3) {
            this.queueTurnReset();
        }
    }

    private awardPoints(points: number): void {
        const playerId = this.state.playerOrder[this.state.currentTurnIndex];
        if (!playerId) return;

        this.state.scores[playerId] = (this.state.scores[playerId] ?? 0) + points;
        this.broadcastState();
    }

    private queueTurnReset(): void {
        if (this.state.resetPending) return;
        this.state.resetPending = true;
        this.resetQueuedAtMs = this.nowMs() + 2400;
    }

    private advanceTurnAndResetBalls(): void {
        const playerCount = this.state.playerOrder.length;
        if (playerCount > 0) {
            this.state.currentTurnIndex = (this.state.currentTurnIndex + 1) % playerCount;
        } else {
            this.state.currentTurnIndex = 0;
        }
        this.state.throwsTaken = 0;
        this.state.resetPending = false;
        this.countedBallIds.clear();
        this.scoredBallIds.clear();
        this.resetBallsToRack();
        this.broadcastState();
    }

    private resetBallsToRack(): void {
        for (const ball of BALL_DEFINITIONS) {
            const entity = this.getBallEntity(ball.id);
            if (!entity) continue;
            entity.rigidBody.setTranslation(ball.position, true);
            entity.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
            entity.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            entity.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
            entity.rigidBody.wakeUp();
            entity.ownerId = null;
            entity.syncAuthority();
        }
    }

    private reconcilePlayers(): void {
        const nextOrder = this.collectPlayerOrder();
        if (sameArray(nextOrder, this.state.playerOrder)) return;

        const nextScores: Record<string, number> = {};
        for (const playerId of nextOrder) {
            nextScores[playerId] = this.state.scores[playerId] ?? 0;
        }

        let nextTurnIndex = this.state.currentTurnIndex;
        const currentPlayerId = this.state.playerOrder[this.state.currentTurnIndex] ?? null;
        if (currentPlayerId) {
            const nextIndex = nextOrder.indexOf(currentPlayerId);
            nextTurnIndex = nextIndex >= 0 ? nextIndex : Math.min(nextTurnIndex, Math.max(0, nextOrder.length - 1));
        } else {
            nextTurnIndex = 0;
        }

        this.state = {
            ...this.state,
            playerOrder: nextOrder,
            currentTurnIndex: nextOrder.length > 0 ? nextTurnIndex : 0,
            scores: nextScores
        };
        this.broadcastState();
    }

    private collectPlayerOrder(): string[] {
        const players = Array.from(this.context.runtime.entity.entities.values())
            .filter((entity) => entity.type === EntityType.PLAYER_AVATAR)
            .map((entity) => entity.id);
        return players.sort((a, b) => a.localeCompare(b));
    }

    private getBallEntity(ballId: string): PhysicsPropEntity | null {
        const instance = this.session.getObjectInstance(ballId);
        const primary = instance?.getPrimaryEntity?.() ?? this.context.runtime.entity.getEntity(ballId);
        return (primary as PhysicsPropEntity | undefined) ?? null;
    }

    private applyState(state: ITargetTossState): void {
        this.state = {
            playerOrder: state.playerOrder.slice(),
            currentTurnIndex: state.currentTurnIndex,
            throwsTaken: state.throwsTaken,
            scores: { ...state.scores },
            resetPending: state.resetPending
        };
        this.refreshScoreboardVisual();
    }

    private cloneState(): ITargetTossState {
        return {
            playerOrder: this.state.playerOrder.slice(),
            currentTurnIndex: this.state.currentTurnIndex,
            throwsTaken: this.state.throwsTaken,
            scores: { ...this.state.scores },
            resetPending: this.state.resetPending
        };
    }

    private broadcastState(): void {
        this.refreshScoreboardVisual();
        this.emitReplicationEvent?.('state-sync', { state: this.cloneState() } satisfies ITargetTossStateSyncPayload);
    }

    private refreshScoreboardVisual(): void {
        if (!this.scoreboard) return;
        this.scoreboard.update(this.state, (playerId) => this.resolvePlayerLabel(playerId));
    }

    private resolvePlayerLabel(playerId: string): string {
        const entity = this.context.runtime.entity.getEntity(playerId) as PlayerAvatarEntity | undefined;
        const name = entity?.name?.trim();
        if (name) return name;
        return compactPlayerId(playerId);
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}

function isStateSyncPayload(value: unknown): value is ITargetTossStateSyncPayload {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as { state?: Partial<ITargetTossState> };
    const state = candidate.state;
    return !!state &&
        Array.isArray(state.playerOrder) &&
        typeof state.currentTurnIndex === 'number' &&
        typeof state.throwsTaken === 'number' &&
        typeof state.resetPending === 'boolean' &&
        !!state.scores &&
        typeof state.scores === 'object';
}

function sameArray(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function compactPlayerId(playerId: string): string {
    if (playerId.length <= 10) return playerId;
    return `${playerId.slice(0, 4)}...${playerId.slice(-4)}`;
}

export const TargetTossScenarioPlugin: IScenarioPlugin = {
    id: 'target-toss',
    displayName: 'Target Toss',
    kind: 'minigame',
    maxPlayers: 8,
    capabilities: {
        headless: true,
        usesPhysics: true,
        usesAudio: false,
        hasActions: true,
        hasPortableObjects: true
    },
    create({ app, session }) {
        return new TargetTossScenario(session, app);
    }
};
