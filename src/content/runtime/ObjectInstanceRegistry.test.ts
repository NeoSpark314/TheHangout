import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../app/AppContext';
import { ObjectInstanceRegistry } from './ObjectInstanceRegistry';

describe('ObjectInstanceRegistry', () => {
    it('discards the local mount binding before removing a mounted object instance', () => {
        const app = new AppContext();
        const discardLocalMountBinding = vi.fn();
        const removeEntity = vi.fn();
        const entityMap = new Map<string, { id: string; isDestroyed?: boolean }>();
        entityMap.set('car-0:seat', { id: 'car-0:seat', isDestroyed: false });
        entityMap.set('car-0:body', { id: 'car-0:body', isDestroyed: false });

        app.setRuntime('skills', {
            mount: { discardLocalMountBinding },
            drawing: {},
            interaction: {}
        } as any);
        app.setRuntime('entity', {
            addEntity: vi.fn(),
            getEntity: (id: string) => entityMap.get(id),
            removeEntity,
            entities: entityMap
        } as any);
        app.setRuntime('replication', {} as any);

        const registry = new ObjectInstanceRegistry(app);
        const instance = {
            id: 'car-0',
            moduleId: 'simple-racing-car',
            update: () => {},
            destroy: vi.fn(),
            getPrimaryEntity: () => ({ id: 'car-0:seat' }),
            getOwnedEntityIds: () => ['car-0:body']
        };

        registry.add(instance as any);
        registry.remove('car-0');

        expect(discardLocalMountBinding).toHaveBeenCalledWith('car-0', 'external');
        expect(removeEntity).toHaveBeenCalledWith('car-0:seat');
        expect(removeEntity).toHaveBeenCalledWith('car-0:body');
    });
});
