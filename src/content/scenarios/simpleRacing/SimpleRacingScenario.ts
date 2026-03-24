import type { IObjectModule } from '../../contracts/IObjectModule';
import type { IScenarioContext } from '../../contracts/IScenarioContext';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';
import { SimpleRacingCarObject } from './SimpleRacingCarObject';
import { SimpleRacingTrackBuilder } from './SimpleRacingTrackBuilder';
import { computeSimpleRacingSpawn, computeSimpleRacingTrackBounds } from './SimpleRacingTrackData';

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
        const bounds = computeSimpleRacingTrackBounds();
        const ringRadiusX = bounds.halfWidth + 6;
        const ringRadiusZ = bounds.halfDepth + 6;
        const spawnRing = [
            { x: bounds.centerX + ringRadiusX, z: bounds.centerZ + ringRadiusZ * 0.25 },
            { x: bounds.centerX + ringRadiusX * 0.6, z: bounds.centerZ + ringRadiusZ },
            { x: bounds.centerX - ringRadiusX * 0.6, z: bounds.centerZ + ringRadiusZ },
            { x: bounds.centerX - ringRadiusX, z: bounds.centerZ + ringRadiusZ * 0.25 },
            { x: bounds.centerX - ringRadiusX, z: bounds.centerZ - ringRadiusZ * 0.25 },
            { x: bounds.centerX - ringRadiusX * 0.6, z: bounds.centerZ - ringRadiusZ },
            { x: bounds.centerX + ringRadiusX * 0.6, z: bounds.centerZ - ringRadiusZ },
            { x: bounds.centerX + ringRadiusX, z: bounds.centerZ - ringRadiusZ * 0.25 }
        ];
        const spawn = spawnRing[index % spawnRing.length];
        return {
            position: {
                x: spawn.x,
                y: 0.2,
                z: spawn.z
            },
            yaw: Math.atan2(bounds.centerX - spawn.x, bounds.centerZ - spawn.z)
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
