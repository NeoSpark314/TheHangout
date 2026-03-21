import * as THREE from 'three';
import type { IObjectRuntimeContext } from '../contracts/IObjectRuntimeContext';
import type { ISpawnedObjectInstance } from '../contracts/ISpawnedObjectInstance';
import { ObjectRuntimeContext } from './ObjectRuntimeContext';

export class BaseObjectInstance implements ISpawnedObjectInstance {
    private readonly cleanupCallbacks: Array<() => void> = [];
    private readonly ownedSceneObjects: THREE.Object3D[] = [];
    private readonly ownedPhysicsBodies: any[] = [];

    constructor(
        protected context: IObjectRuntimeContext,
        public readonly moduleId: string
    ) { }

    public get id(): string {
        return this.context.instanceId;
    }

    public update(_delta: number): void { }

    public destroy(): void {
        while (this.cleanupCallbacks.length > 0) {
            const cleanup = this.cleanupCallbacks.pop();
            if (!cleanup) break;
            cleanup();
        }

        while (this.ownedPhysicsBodies.length > 0) {
            const body = this.ownedPhysicsBodies.pop();
            if (body && this.context instanceof ObjectRuntimeContext) {
                this.context.removePhysicsBody(body);
            }
        }

        while (this.ownedSceneObjects.length > 0) {
            const object = this.ownedSceneObjects.pop();
            if (!object) break;

            this.context.scene.remove(object);
            object.traverse((node) => {
                const mesh = node as THREE.Mesh;
                if (mesh.geometry) {
                    mesh.geometry.dispose();
                }
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) mesh.material.forEach((mat) => mat.dispose());
                    else mesh.material.dispose();
                }
            });
        }

        if (this.context instanceof ObjectRuntimeContext) {
            this.context.runCleanupCallbacks();
        }
    }

    protected ownSceneObject<T extends THREE.Object3D>(object: T): T {
        this.ownedSceneObjects.push(object);
        this.context.scene.add(object);
        return object;
    }

    protected ownPhysicsBody<T>(body: T): T {
        if (body) {
            this.ownedPhysicsBodies.push(body);
        }
        return body;
    }

    protected addCleanup(cleanup: () => void): void {
        this.cleanupCallbacks.push(cleanup);
    }
}
