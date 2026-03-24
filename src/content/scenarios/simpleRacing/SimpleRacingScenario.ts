import type { IObjectModule } from '../../contracts/IObjectModule';
import type { IScenarioContext } from '../../contracts/IScenarioContext';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';
import { SimpleRacingCarObject } from './SimpleRacingCarObject';
import { SimpleRacingTrackBuilder } from './SimpleRacingTrackBuilder';
import { computeSimpleRacingSpawn } from './SimpleRacingTrackData';

const SIMPLE_RACING_CAR_INSTANCE_ID = 'simple-racing-car-0';

export class SimpleRacingScenario implements IScenarioModule {
    public readonly id = 'simple-racing';
    public readonly displayName = 'Simple Racing';
    public readonly kind = 'minigame' as const;
    public readonly maxPlayers = 8;

    private readonly objectModules: IObjectModule[] = [new SimpleRacingCarObject()];
    private readonly track = new SimpleRacingTrackBuilder();

    public load(context: IScenarioContext, _options: IScenarioLoadOptions): void {
        const spawn = computeSimpleRacingSpawn();
        this.track.load(context);
        context.objects.spawn('simple-racing-car', {
            id: SIMPLE_RACING_CAR_INSTANCE_ID,
            entityId: `${SIMPLE_RACING_CAR_INSTANCE_ID}:body`,
            position: spawn.position,
            rotationY: spawn.yaw
        });
    }

    public unload(context: IScenarioContext): void {
        this.track.unload(context);
    }

    public update(_delta: number): void { }

    public getSpawnPoint(index: number): IScenarioSpawnPoint {
        const start = computeSimpleRacingSpawn();
        const spawnGrid = [
            { x: -3.2, z: -3.8 },
            { x: 0, z: -3.8 },
            { x: 3.2, z: -3.8 },
            { x: -3.2, z: -6.8 },
            { x: 0, z: -6.8 },
            { x: 3.2, z: -6.8 },
            { x: -3.2, z: -9.8 },
            { x: 3.2, z: -9.8 }
        ];
        const offset = spawnGrid[index % spawnGrid.length];
        return {
            position: {
                x: start.position.x + offset.x,
                y: 0.2,
                z: start.position.z + offset.z
            },
            yaw: start.yaw
        };
    }

    public getObjectModules(): IObjectModule[] {
        return this.objectModules;
    }
}

export const SimpleRacingScenarioPlugin: IScenarioPlugin = {
    id: 'simple-racing',
    displayName: 'Simple Racing',
    kind: 'minigame',
    maxPlayers: 8,
    capabilities: {
        headless: true,
        usesPhysics: true,
        usesAudio: true,
        hasPortableObjects: false
    },
    create() {
        return new SimpleRacingScenario();
    }
};
