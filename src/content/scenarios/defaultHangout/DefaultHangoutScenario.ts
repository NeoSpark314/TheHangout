import { DebugBeaconObject } from '../../objects/DebugBeaconObject';
import { ChairObject } from '../../objects/ChairObject';
import { DrawingSurfaceObject } from '../../objects/DrawingSurfaceObject';
import { DrumPadArcObject } from '../../objects/DrumPadArcObject';
import { GrabbableCubeObject } from '../../objects/GrabbableCubeObject';
import { PenToolObject } from '../../objects/PenToolObject';
import { PewPewGunObject } from '../../objects/PewPewGunObject';
import { SimpleSharedObject } from '../../objects/SimpleSharedObject';
import type { IObjectModule } from '../../contracts/IObjectModule';
import type { IScenarioConfig } from '../../../app/AppContext';
import type { IDesktopScreenLayout } from '../../../shared/contracts/IDesktopScreenLayout';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';
import type { IScenarioContext } from '../../contracts/IScenarioContext';
import type { IHangoutScenario } from '../../contracts/IHangoutScenario';
import { DefaultHangoutWorld } from './DefaultHangoutWorld';
import type {
    IScenarioActionDefinition,
    IScenarioActionExecutionContext,
    IScenarioActionExecutionResult,
    IScenarioActionProvider,
    IScenarioActionQueryContext
} from '../../contracts/IScenarioAction';

interface ISeatAssignment {
    p: [number, number, number];
    y: number;
}

interface ISeatAllReplicatedPayload {
    seats: Record<string, ISeatAssignment>;
}

class DefaultHangoutActionProvider implements IScenarioActionProvider {
    private static readonly ACTION_SEAT_ALL = 'seat-all';
    private static readonly ACTION_RESET_ROOM = 'reset-room';

    public getActions(_context: IScenarioActionQueryContext): IScenarioActionDefinition[] {
        return [
            {
                id: DefaultHangoutActionProvider.ACTION_SEAT_ALL,
                label: 'Seat All',
                description: 'Teleport all connected players into meeting seats around the table.',
                requiredRole: 'moderator',
                replicateToGuests: true
            },
            {
                id: DefaultHangoutActionProvider.ACTION_RESET_ROOM,
                label: 'Reset Room',
                description: 'Reload this scenario and reset scenario-owned objects (drawing, props, instruments).',
                requiredRole: 'moderator',
                dangerous: true,
                replicateToGuests: false
            }
        ];
    }

    public executeAction(
        actionId: string,
        payload: unknown,
        context: IScenarioActionExecutionContext
    ): IScenarioActionExecutionResult {
        if (actionId === DefaultHangoutActionProvider.ACTION_SEAT_ALL) {
            if (context.source === 'replicated') {
                return this.applyReplicatedSeatAssignment(payload, context);
            }
            return this.executeSeatAll(context);
        }

        if (actionId === DefaultHangoutActionProvider.ACTION_RESET_ROOM) {
            if (context.source === 'replicated') {
                return { ok: true };
            }
            const nextSeed = this.nextSeed(0);
            context.scenario.actions.setSessionConfig({ seed: nextSeed });
            return { ok: true, message: 'Room reset triggered.' };
        }

        return { ok: false, reason: `Unsupported action: ${actionId}` };
    }

    private executeSeatAll(context: IScenarioActionExecutionContext): IScenarioActionExecutionResult {
        const players = context.scenario.players.getAll()
            .map((player) => player.id)
            .sort((a, b) => a.localeCompare(b));

        if (players.length === 0) {
            return { ok: false, reason: 'No active players to seat.' };
        }

        const seats: Record<string, ISeatAssignment> = {};
        const radius = 1.9;
        for (let i = 0; i < players.length; i++) {
            const angle = (i / players.length) * Math.PI * 2 + Math.PI;
            seats[players[i]] = {
                p: [Math.sin(angle) * radius, 0.2, Math.cos(angle) * radius],
                y: angle
            };
        }

        this.teleportLocalPlayerIfAssigned(context, seats);

        return {
            ok: true,
            message: `Seated ${players.length} player${players.length === 1 ? '' : 's'}.`,
            replicatedPayload: { seats } satisfies ISeatAllReplicatedPayload
        };
    }

    private nextSeed(currentSeed: number): number {
        let candidate = Math.floor(Math.random() * 2147483647);
        if (candidate === currentSeed) {
            candidate = (candidate + 1) % 2147483647;
            if (candidate === 0) candidate = 1;
        }
        return candidate;
    }

    private applyReplicatedSeatAssignment(
        payload: unknown,
        context: IScenarioActionExecutionContext
    ): IScenarioActionExecutionResult {
        if (!isSeatAllReplicatedPayload(payload)) {
            return { ok: false, reason: 'Missing seat assignment payload.' };
        }

        this.teleportLocalPlayerIfAssigned(context, payload.seats);
        return { ok: true };
    }

    private teleportLocalPlayerIfAssigned(
        context: IScenarioActionExecutionContext,
        seats: Record<string, ISeatAssignment>
    ): void {
        const localPeerId = context.localPeerId;
        if (!localPeerId) return;

        const seat = seats[localPeerId];
        if (!seat) return;

        context.scenario.players.teleport(
            localPeerId,
            { x: seat.p[0], y: seat.p[1], z: seat.p[2] },
            seat.y,
            { targetSpace: 'player' }
        );
    }
}

function isSeatAllReplicatedPayload(payload: unknown): payload is ISeatAllReplicatedPayload {
    if (!payload || typeof payload !== 'object') return false;
    const candidate = payload as { seats?: Record<string, ISeatAssignment> };
    if (!candidate.seats || typeof candidate.seats !== 'object') return false;

    for (const seat of Object.values(candidate.seats)) {
        if (!seat || !Array.isArray(seat.p) || seat.p.length !== 3) return false;
        if (typeof seat.y !== 'number') return false;
        if (typeof seat.p[0] !== 'number' || typeof seat.p[1] !== 'number' || typeof seat.p[2] !== 'number') return false;
    }

    return true;
}

const DEFAULT_HANGOUT_OBJECT_MODULES: IObjectModule[] = [
    new DrawingSurfaceObject(),
    new PenToolObject(),
    new PewPewGunObject(),
    new GrabbableCubeObject(),
    new DrumPadArcObject(),
    new ChairObject(),
    new DebugBeaconObject(),
    new SimpleSharedObject()
];

export class DefaultHangoutScenario implements IHangoutScenario {
    public readonly id = 'default-hangout';
    public readonly displayName = 'Default Hangout';
    public readonly kind = 'social' as const;
    public readonly maxPlayers = 16;
    private readonly objectModules: IObjectModule[] = DEFAULT_HANGOUT_OBJECT_MODULES;
    private readonly actionProvider = new DefaultHangoutActionProvider();
    private readonly world = new DefaultHangoutWorld();

    public load(context: IScenarioContext, _options: IScenarioLoadOptions): void {
        this.world.load(context);
        this.world.setHologramVisible(true);
    }

    public unload(_context: IScenarioContext): void {
        this.world.unload();
    }

    public update(delta: number): void {
        this.world.update(delta);
    }

    public getSpawnPoint(index: number): IScenarioSpawnPoint {
        const radius = 2.5;
        const angle = (index * (Math.PI / 4)) + Math.PI;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;

        return {
            position: { x, y: 0.2, z },
            yaw: angle
        };
    }

    public getObjectModules(): IObjectModule[] {
        return this.objectModules;
    }

    public getActionProvider(): IScenarioActionProvider {
        return this.actionProvider;
    }

    public applyConfig(context: IScenarioContext, config: IScenarioConfig): void {
        this.world.applyConfig(context, config);
    }

    public getFeatureLayout(featureId: string, index: number, total: number): IDesktopScreenLayout | null {
        return this.world.getFeatureLayout(featureId, index, total);
    }

    public setHologramVisible(visible: boolean): void {
        this.world.setHologramVisible(visible);
    }
}

export const DefaultHangoutScenarioPlugin: IScenarioPlugin = {
    id: 'default-hangout',
    displayName: 'Default Hangout',
    kind: 'social',
    maxPlayers: 16,
    capabilities: {
        headless: true,
        usesPhysics: true,
        usesAudio: true,
        hasActions: true,
        hasPortableObjects: true
    },
    objectModules: DEFAULT_HANGOUT_OBJECT_MODULES,
    create() {
        return new DefaultHangoutScenario();
    }
};

