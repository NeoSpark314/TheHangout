import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta, IObjectReplicationPolicy } from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';
import { EntityFactory } from '../../world/spawning/EntityFactory';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';

export class DynamicModelInstance extends BaseReplicatedObjectInstance {
    public readonly replicationPolicy: IObjectReplicationPolicy = {
        relayIncomingFromPeer: 'others',
        includeInSnapshot: true,
        defaultLocalEcho: true
    };

    private url: string | null = null;
    private group: THREE.Group;
    private propEntity: PhysicsPropEntity | null = null;
    private loaded = false;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        super(context, 'dynamic-model');

        this.group = new THREE.Group();
        this.group.name = `dynamic-model:${this.id}`;

        // Wrap the group in a standard physical grabbable prop entity.
        // It manages network sync for position/rotation.
        // The URL is synced by this BaseReplicatedObjectInstance.

        const position = config.position || { x: 0, y: 1.15, z: 0 };
        const halfExtents = config.halfExtents as { x: number, y: number, z: number } | undefined;

        if (halfExtents) {
            const hx = halfExtents.x, hy = halfExtents.y, hz = halfExtents.z;
            const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.3 });
            const placeholder = new THREE.Mesh(geo, mat);
            placeholder.name = 'placeholder';
            this.group.add(placeholder);
        }

        const isAuthority = config.isAuthority !== undefined ? config.isAuthority : context.app.isHost;
        this.propEntity = EntityFactory.createGrabbable(context.app, `prop_${this.id}`, 0.5, position, this.group as any, halfExtents, 'dynamic-model', config.ownerId as string, config.url as string);

        if (this.propEntity) {
            this.addCleanup(() => {
                if (this.propEntity) {
                    this.context.app.runtime.entity?.removeEntity(this.propEntity.id);
                }
            });
        }

        // If spawned locally (not from a remote snapshot), we start with the config URL.
        if (config.url) {
            this.loadUrl(config.url as string);
            if (isAuthority) {
                // Defer to ensure we're attached to the replication host
                setTimeout(() => {
                    this.emitSyncEvent('set-url', { url: config.url });
                }, 0);
            }
        }
    }

    private loadUrl(newUrl: string): void {
        this.url = newUrl;
        if (!this.url || this.loaded) return;
        this.loaded = true;

        if (this.context.app.runtime.render) {
            this.context.app.runtime.assets.getNormalizedModel(this.url, 0.5)
                .then(model => {
                    const placeholder = this.group.getObjectByName('placeholder');
                    if (placeholder) {
                        this.group.remove(placeholder);
                        if ((placeholder as THREE.Mesh).geometry) (placeholder as THREE.Mesh).geometry.dispose();
                        if (Array.isArray((placeholder as THREE.Mesh).material)) {
                            ((placeholder as THREE.Mesh).material as THREE.Material[]).forEach(m => m.dispose());
                        } else {
                            ((placeholder as THREE.Mesh).material as THREE.Material).dispose();
                        }
                    }
                    this.group.add(model);
                })
                .catch(err => {
                    console.error('[DynamicModelInstance] Failed to load model:', this.url, err);
                });
        }
    }

    public captureReplicationSnapshot(): unknown {
        return {
            url: this.url,
            halfExtents: this.propEntity?.halfExtents
        };
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const payload = snapshot as { url?: string };
        if (payload.url) {
            this.loadUrl(payload.url);
        }
    }

    public onReplicationEvent(eventType: string, data: unknown, _meta: IObjectReplicationMeta): void {
        if (eventType === 'set-url' && data && typeof data === 'object') {
            const payload = data as { url?: string };
            if (payload.url) {
                this.loadUrl(payload.url);
            }
        }
    }
}

export class DynamicModelObject implements IObjectModule {
    public readonly id = 'dynamic-model';
    public readonly displayName = 'Dynamic 3D Model';
    public readonly tags = ['dynamic', 'shared', 'prop'];
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): DynamicModelInstance {
        return new DynamicModelInstance(context, config);
    }
}
