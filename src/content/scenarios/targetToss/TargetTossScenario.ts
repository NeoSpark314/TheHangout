import * as THREE from 'three';
import type { AppContext } from '../../../app/AppContext';
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
import type { IScenarioActionProvider } from '../../contracts/IScenarioAction';
import { ThrowableBallObject } from '../../objects/ThrowableBallObject';
import type { SessionRuntime } from '../../../world/session/SessionRuntime';
import type { PhysicsPropEntity } from '../../../world/entities/PhysicsPropEntity';
import type { IPhysicsColliderHandle } from '../../contracts/IObjectRuntimeContext';
import type { PlayerAvatarEntity } from '../../../world/entities/PlayerAvatarEntity';
import { BALL_DEFINITIONS, TARGET_DEFINITIONS, TARGET_TOSS_MIN_SCORE_VIEW_MS, TARGET_TOSS_RESET_DELAY_MS } from './TargetTossConfig';
import { TargetTossActionProvider } from './TargetTossActionProvider';
import { TargetTossScorePopup } from './TargetTossScorePopup';
import { areAllCountedBallsAtRest, evaluateSettledScores, evaluateThrowProgress } from './TargetTossGameLogic';
import { buildTargetTossEnvironment } from './TargetTossEnvironment';
import { TargetTossScoreboardVisual } from './TargetTossScoreboardVisual';
import type {
    IScoreFeedbackPayload,
    ITargetRuntime,
    ITargetTossState,
    ITargetTossStateSyncPayload
} from './TargetTossTypes';

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
    private lastScoreAtMs: number | null = null;
    private scoreboard: TargetTossScoreboardVisual | null = null;
    private readonly scorePopups: TargetTossScorePopup[] = [];
    private sunLight: THREE.DirectionalLight | null = null;
    private hemiLight: THREE.HemisphereLight | null = null;
    private previousShadowMapEnabled: boolean | null = null;
    private previousShadowMapType: THREE.ShadowMapType | null = null;
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

        this.refreshScoreboardVisual();
    }

    public unload(_context: AppContext): void {

        this.scoreboard?.dispose();
        this.scoreboard = null;
        this.disposeScorePopups();

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

        if (this.sunLight?.parent) {
            this.sunLight.removeFromParent();
        }
        if (this.sunLight?.target.parent) {
            this.sunLight.target.removeFromParent();
        }
        if (this.hemiLight?.parent) {
            this.hemiLight.removeFromParent();
        }
        this.sunLight = null;
        this.hemiLight = null;

        const renderer = this.context.runtime.render?.renderer;
        if (renderer && this.previousShadowMapEnabled !== null) {
            renderer.shadowMap.enabled = this.previousShadowMapEnabled;
        }
        if (renderer && this.previousShadowMapType !== null) {
            renderer.shadowMap.type = this.previousShadowMapType;
        }

        this.previousBackground = null;
        this.previousFog = null;
        this.previousShadowMapEnabled = null;
        this.previousShadowMapType = null;
        this.countedBallIds.clear();
        this.scoredBallIds.clear();
        this.resetQueuedAtMs = null;
        this.lastScoreAtMs = null;
    }

    public update(_delta: number): void {
        if (this.context.isHost) {
            this.reconcilePlayers();
            this.updateThrowProgress();
            this.updateSettledScores();
            this.updateResetReadiness();
            this.updatePendingReset();
        }

        const camera = this.context.runtime.render?.camera;
        if (this.scoreboard) {
            this.scoreboard.faceCamera(camera);
            this.refreshScoreboardVisual();
        }
        this.updateScorePopups(_delta, camera);
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
            yaw: 0
        };
    }

    public getObjectModules(): IObjectModule[] {
        return this.objectModules;
    }

    public getActionProvider(): IScenarioActionProvider {
        return this.actionProvider;
    }

    public onScenarioReplicationEvent(eventType: string, data: unknown, _meta: IScenarioReplicationMeta): void {
        if (eventType === 'state-sync') {
            if (!isStateSyncPayload(data)) return;
            this.applyState(data.state);
            return;
        }

        if (eventType === 'score-feedback') {
            if (!isScoreFeedbackPayload(data)) return;
            this.presentScoreFeedback(data);
        }
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
        this.lastScoreAtMs = null;

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
            this.targets.push({ ...definition, collider: null });
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
        const render = this.context.runtime.render;
        const scene = render?.scene;
        if (!scene) return;

        this.previousBackground = scene.background as THREE.Color | THREE.Texture | null;
        this.previousFog = scene.fog;
        scene.background = new THREE.Color(0x8edbff);
        scene.fog = new THREE.Fog(0xbfecc8, 36, 115);

        if (!this.root.parent) {
            scene.add(this.root);
        }

        const renderer = render?.renderer;
        if (renderer) {
            this.previousShadowMapEnabled = renderer.shadowMap.enabled;
            this.previousShadowMapType = renderer.shadowMap.type;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }

        this.hemiLight = new THREE.HemisphereLight(0xdff5ff, 0x7ca35a, 1.1);
        scene.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xfff1cf, 1.75);
        this.sunLight.position.set(10, 18, 8);
        this.sunLight.target.position.set(0, 0, -2);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.set(1024, 1024);
        this.sunLight.shadow.bias = -0.0002;
        this.sunLight.shadow.normalBias = 0.025;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = 48;
        this.sunLight.shadow.camera.left = -14;
        this.sunLight.shadow.camera.right = 14;
        this.sunLight.shadow.camera.top = 14;
        this.sunLight.shadow.camera.bottom = -14;
        scene.add(this.sunLight);
        scene.add(this.sunLight.target);

        this.scoreboard = buildTargetTossEnvironment(this.root, this.targets, this.scoreboard);
        this.scoreboard.root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
        });
    }

    private updateSettledScores(): void {
        const scored = evaluateSettledScores({
            ballIds: this.ballIds,
            scoredBallIds: this.scoredBallIds,
            targets: this.targets,
            getBallEntity: (ballId) => this.getBallEntity(ballId)
        });

        for (const entry of scored) {
            this.lastScoreAtMs = this.nowMs();
            this.scoredBallIds.add(entry.ballId);
            this.countBallThrow(entry.ballId);
            this.awardPoints(entry.feedback.points);
            this.emitScoreFeedback(entry.feedback);
        }
    }

    private updateThrowProgress(): void {
        if (this.state.resetPending) return;

        const progress = evaluateThrowProgress({
            countedBallIds: this.countedBallIds,
            getBallEntity: (ballId) => this.getBallEntity(ballId)
        });
        if (!progress.changed) return;

        this.state.throwsTaken = progress.throwsTaken;
        this.broadcastState();
    }

    private updateResetReadiness(): void {
        if (this.state.throwsTaken < this.ballIds.length) return;
        if (!areAllCountedBallsAtRest({
            countedBallIds: this.countedBallIds,
            getBallEntity: (ballId) => this.getBallEntity(ballId)
        })) {
            return;
        }

        this.queueTurnReset();
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
    }

    private awardPoints(points: number): void {
        const playerId = this.state.playerOrder[this.state.currentTurnIndex];
        if (!playerId) return;

        this.state.scores[playerId] = (this.state.scores[playerId] ?? 0) + points;
        this.broadcastState();
    }

    private emitScoreFeedback(payload: IScoreFeedbackPayload): void {
        this.emitReplicationEvent?.('score-feedback', payload);
    }

    private presentScoreFeedback(payload: IScoreFeedbackPayload): void {
        this.playScoreFeedbackSound(payload);

        const scene = this.context.runtime.render?.scene;
        if (!scene || typeof document === 'undefined') return;

        const popup = new TargetTossScorePopup(payload.points, payload.color, payload.position);
        this.scorePopups.push(popup);
        this.root.add(popup.root);
    }

    private playScoreFeedbackSound(payload: IScoreFeedbackPayload): void {
        const audio = this.context.runtime.audio;
        if (!audio) return;

        const frequency = payload.points >= 30
            ? 1046.5
            : payload.points >= 20
                ? 880
                : 698.46;
        const intensity = payload.points >= 30 ? 0.92 : payload.points >= 20 ? 0.8 : 0.68;
        audio.playMelodyNote({
            frequency,
            intensity,
            position: payload.position
        });
    }

    private updateScorePopups(deltaSec: number, camera: THREE.Camera | null | undefined): void {
        for (let i = this.scorePopups.length - 1; i >= 0; i -= 1) {
            const popup = this.scorePopups[i];
            if (popup.update(deltaSec, camera)) continue;
            popup.dispose();
            this.scorePopups.splice(i, 1);
        }
    }

    private disposeScorePopups(): void {
        for (const popup of this.scorePopups) {
            popup.dispose();
        }
        this.scorePopups.length = 0;
    }

    private queueTurnReset(): void {
        if (this.resetQueuedAtMs !== null) return;

        const now = this.nowMs();
        this.state.resetPending = true;
        const desiredDeadline = Math.max(
            now + TARGET_TOSS_RESET_DELAY_MS,
            this.lastScoreAtMs !== null ? this.lastScoreAtMs + TARGET_TOSS_MIN_SCORE_VIEW_MS : 0
        );
        this.resetQueuedAtMs = desiredDeadline;
        this.broadcastState();
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
        this.lastScoreAtMs = null;
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

function isScoreFeedbackPayload(value: unknown): value is IScoreFeedbackPayload {
    const candidate = value as Partial<IScoreFeedbackPayload> | null;
    const position = candidate?.position as Partial<{ x: number; y: number; z: number }> | undefined;
    return !!candidate
        && typeof candidate.points === 'number'
        && typeof candidate.color === 'number'
        && !!position
        && typeof position.x === 'number'
        && typeof position.y === 'number'
        && typeof position.z === 'number';
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
        usesAudio: true,
        hasActions: true,
        hasPortableObjects: true
    },
    create({ app, session }) {
        return new TargetTossScenario(session, app);
    }
};
