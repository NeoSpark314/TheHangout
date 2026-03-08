import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta, IObjectReplicationPolicy } from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';
import { EntityFactory } from '../../world/spawning/EntityFactory';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';

export class DynamicImageInstance extends BaseReplicatedObjectInstance {
    public readonly replicationPolicy: IObjectReplicationPolicy = {
        relayIncomingFromPeer: 'others',
        includeInSnapshot: true,
        defaultLocalEcho: true
    };

    private url: string | null = null;
    private mesh: THREE.Mesh;
    private propEntity: PhysicsPropEntity | null = null;
    private loaded = false;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        super(context, 'dynamic-image');

        const halfExtents = config.halfExtents as { x: number, y: number, z: number } | undefined;
        const width = halfExtents ? halfExtents.x * 2 : 0.5;
        const height = halfExtents ? halfExtents.y * 2 : 0.5;

        // Create the plane according to pre-calculated bounds (or default)
        const geometry = new THREE.PlaneGeometry(width, height);
        // Make it double-sided so it can be viewed from the back; start transparent until texture loads
        const material = new THREE.MeshStandardMaterial({ color: 0x444444, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.name = `dynamic-image:${this.id}`;

        // Wrap the mesh in a grabbable prop entity.
        const position = config.position || { x: 0, y: 1.15, z: 0 };
        const isAuthority = config.isAuthority !== undefined ? config.isAuthority : context.app.isHost;
        this.propEntity = EntityFactory.createGrabbable(context.app, `prop_${this.id}`, 1, position, this.mesh, halfExtents || { x: 0.25, y: 0.25, z: 0.05 }, 'dynamic-image', config.ownerId as string, config.url as string);

        if (this.propEntity) {
            this.addCleanup(() => {
                if (this.propEntity) {
                    this.context.app.runtime.entity?.removeEntity(this.propEntity.id);
                }
            });
        }

        this.addCleanup(() => {
            geometry.dispose();
            if (this.mesh.material instanceof THREE.Material) {
                this.mesh.material.dispose();
            }
        });

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
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(this.url,
                (texture) => {
                    // Update material with the texture
                    const mat = new THREE.MeshStandardMaterial({
                        map: texture,
                        side: THREE.DoubleSide,
                        roughness: 0.8,
                        transparent: false,
                        opacity: 1.0
                    });

                    if (this.mesh.material instanceof THREE.Material) {
                        this.mesh.material.dispose();
                    }
                    this.mesh.material = mat;
                },
                undefined,
                (err) => {
                    console.error('[DynamicImageInstance] Failed to load image:', this.url, err);
                }
            );
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

export class DynamicImageObject implements IObjectModule {
    public readonly id = 'dynamic-image';
    public readonly displayName = 'Dynamic Image';
    public readonly tags = ['dynamic', 'shared', 'prop'];
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): DynamicImageInstance {
        return new DynamicImageInstance(context, config);
    }
}
