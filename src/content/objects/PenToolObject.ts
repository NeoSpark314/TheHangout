import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext, IObjectSpawnResult } from '../contracts/IObjectModule';
import { ObjectRuntimeContext } from '../runtime/ObjectRuntimeContext';

export class PenToolObject implements IObjectModule {
    public readonly id = 'pen-tool';
    public readonly displayName = 'Pen Tool';
    public readonly tags = ['tool', 'shared', 'drawing'];
    public readonly networked = true;
    public readonly portable = true;

    // Thin content wrapper over the engine-level PEN entity primitive.
    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): IObjectSpawnResult {
        if (!(context instanceof ObjectRuntimeContext)) {
            return null;
        }

        return context.createPenEntity(context.instanceId, {
            ...config,
            position: config.position ?? { x: 0.5, y: 1.15, z: 0.5 }
        }) as IObjectSpawnResult;
    }
}
