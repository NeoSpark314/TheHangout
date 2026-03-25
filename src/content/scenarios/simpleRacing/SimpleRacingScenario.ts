import type { IObjectModule } from '../../contracts/IObjectModule';
import type { IScenarioContext } from '../../contracts/IScenarioContext';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';
import * as THREE from 'three';
import { SimpleRacingCarObject } from './SimpleRacingCarObject';
import { SIMPLE_RACING_CAR_MODEL_URLS } from './SimpleRacingAssets';
import { SimpleRacingTrackBuilder } from './SimpleRacingTrackBuilder';
import { computeSimpleRacingSpawn } from './SimpleRacingTrackData';

const SIMPLE_RACING_CAR_SPAWNS = [
    { id: 'simple-racing-car-0', rightOffset: -2.4, backOffset: 0.4, modelUrl: SIMPLE_RACING_CAR_MODEL_URLS[0] },
    { id: 'simple-racing-car-1', rightOffset: 2.4, backOffset: 0.4, modelUrl: SIMPLE_RACING_CAR_MODEL_URLS[1] },
    { id: 'simple-racing-car-2', rightOffset: -2.4, backOffset: -3.0, modelUrl: SIMPLE_RACING_CAR_MODEL_URLS[2] },
    { id: 'simple-racing-car-3', rightOffset: 2.4, backOffset: -3.0, modelUrl: SIMPLE_RACING_CAR_MODEL_URLS[3] }
] as const;

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
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spawn.yaw);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spawn.yaw);
        const spawnCenter = new THREE.Vector3(spawn.position.x, spawn.position.y, spawn.position.z);

        for (const car of SIMPLE_RACING_CAR_SPAWNS) {
            const position = spawnCenter.clone()
                .addScaledVector(right, car.rightOffset)
                .addScaledVector(forward, car.backOffset);
            context.objects.spawn('simple-racing-car', {
                id: car.id,
                entityId: `${car.id}:body`,
                position: { x: position.x, y: position.y, z: position.z },
                rotationY: spawn.yaw,
                url: car.modelUrl
            });
        }
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
