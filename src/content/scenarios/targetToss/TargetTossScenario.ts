import * as THREE from 'three';
import type { IObjectModule } from '../../contracts/IObjectModule';
import type {
    IReplicatedScenarioModule,
    IScenarioReplicationMeta,
    IScenarioReplicationPolicy
} from '../../contracts/IReplicatedScenarioModule';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';
import type { IScenarioLoadOptions, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { IScenarioActionProvider } from '../../contracts/IScenarioAction';
import type { IScenarioContext, IScenarioStaticBodyHandle } from '../../contracts/IScenarioContext';
import { ThrowableBallObject } from '../../objects/ThrowableBallObject';
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

const TARGET_TOSS_OBJECT_MODULES: IObjectModule[] = [new ThrowableBallObject()];

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

    private readonly objectModules: IObjectModule[] = TARGET_TOSS_OBJECT_MODULES;
    private readonly actionProvider = new TargetTossActionProvider(this);
    private readonly root = new THREE.Group();
    private readonly targets: ITargetRuntime[] = [];
    private readonly ballIds = BALL_DEFINITIONS.map((ball) => ball.id);
    private rackCollider: IScenarioStaticBodyHandle | null = null;
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
    private context: IScenarioContext | null = null;

    constructor() {
        this.root.name = 'target-toss-scenario';
    }

    public loadWorld(context: IScenarioContext, _options: IScenarioLoadOptions): void {
        this.context = context;
        context.physics.ensureGround();
        this.createTargets();
        this.createRackCollider();
        this.spawnSharedBalls();

        if (context.actions.isHost()) {
            this.reconcilePlayers();
            this.state.throwsTaken = 0;
        }
    }

    public loadVisuals(context: IScenarioContext, _options: IScenarioLoadOptions): void {
        this.context = context;
        this.createVisuals();
        this.refreshScoreboardVisual();
    }

    public unloadVisuals(_context: IScenarioContext): void {
        this.scoreboard?.dispose();
        this.scoreboard = null;
        this.disposeScorePopups();

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

        const scene = this.context?.scene.getRoot() ?? null;
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

        const renderer = this.context?.scene.getRenderer() ?? null;
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
    }

    public unloadWorld(_context: IScenarioContext): void {
        this.targets.forEach((target) => {
            target.collider?.destroy();
        });
        this.targets.length = 0;
        this.rackCollider?.destroy();
        this.rackCollider = null;
        this.countedBallIds.clear();
        this.scoredBallIds.clear();
        this.resetQueuedAtMs = null;
        this.lastScoreAtMs = null;
    }

    public update(_delta: number): void {
        if (this.context?.actions.isHost()) {
            this.reconcilePlayers();
            this.updateThrowProgress();
            this.updateSettledScores();
            this.updateResetReadiness();
            this.updatePendingReset();
        }

        const camera = this.context?.scene.getCamera();
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
        if (!this.context?.actions.isHost()) return;

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
        const context = this.context;
        if (!context) return;
        for (const ball of BALL_DEFINITIONS) {
            if (context.objects.get(ball.id)) continue;
            context.objects.spawn('throwable-ball', {
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
        this.rackCollider = this.context?.physics.createStaticBox({
            position: { x: 0, y: 0.76, z: 2.6 },
            halfExtents: {
                x: 1.45 * 0.5,
                y: 0.22 * 0.5,
                z: 0.55 * 0.5
            }
        }) ?? null;
    }

    private createVisuals(): void {
        const scene = this.context?.scene.getRoot() ?? null;
        if (!scene) return;

        this.previousBackground = scene.background as THREE.Color | THREE.Texture | null;
        this.previousFog = scene.fog;
        scene.background = new THREE.Color(0x8edbff);
        scene.fog = new THREE.Fog(0xbfecc8, 36, 115);

        if (!this.root.parent) {
            scene.add(this.root);
        }

        const renderer = this.context?.scene.getRenderer() ?? null;
        if (renderer) {
            this.previousShadowMapEnabled = renderer.shadowMap.enabled;
            this.previousShadowMapType = renderer.shadowMap.type;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFShadowMap;
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
            getBall: (ballId) => this.getBall(ballId)
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
            getBall: (ballId) => this.getBall(ballId)
        });
        if (!progress.changed) return;

        this.state.throwsTaken = progress.throwsTaken;
        this.broadcastState();
    }

    private updateResetReadiness(): void {
        if (this.state.throwsTaken < this.ballIds.length) return;
        if (!areAllCountedBallsAtRest({
            countedBallIds: this.countedBallIds,
            getBall: (ballId) => this.getBall(ballId)
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
        this.context?.events.emitScenario('score-feedback', payload);
    }

    private presentScoreFeedback(payload: IScoreFeedbackPayload): void {
        this.playScoreFeedbackSound(payload);

        const scene = this.context?.scene.getRoot() ?? null;
        if (!scene || typeof document === 'undefined') return;

        const popup = new TargetTossScorePopup(payload.points, payload.color, payload.position);
        this.scorePopups.push(popup);
        this.root.add(popup.root);
    }

    private playScoreFeedbackSound(payload: IScoreFeedbackPayload): void {
        const frequency = payload.points >= 30
            ? 1046.5
            : payload.points >= 20
                ? 880
                : 698.46;
        const intensity = payload.points >= 30 ? 0.92 : payload.points >= 20 ? 0.8 : 0.68;
        this.context?.audio.playMelodyNote({
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
        const context = this.context;
        if (!context) return;
        for (const ball of BALL_DEFINITIONS) {
            context.props.reset(ball.id, {
                position: ball.position,
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            });
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
        const players = this.context?.players.getAll().map((player) => player.id) ?? [];
        return players.sort((a, b) => a.localeCompare(b));
    }

    private getBall(ballId: string) {
        return this.context?.props.get(ballId) ?? null;
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
        this.context?.events.emitScenario('state-sync', { state: this.cloneState() } satisfies ITargetTossStateSyncPayload);
    }

    private refreshScoreboardVisual(): void {
        if (!this.scoreboard) return;
        this.scoreboard.update(this.state, (playerId) => this.resolvePlayerLabel(playerId));
    }

    private resolvePlayerLabel(playerId: string): string {
        return this.context?.players.getDisplayName(playerId) ?? compactPlayerId(playerId);
    }

    private nowMs(): number {
        return this.context?.timers.nowMs() ?? (
            (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? performance.now()
                : Date.now()
        );
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
    objectModules: TARGET_TOSS_OBJECT_MODULES,
    create() {
        return new TargetTossScenario();
    }
};
