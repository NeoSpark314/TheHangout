import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta, IObjectReplicationPolicy } from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';
import { EntityFactory } from '../../world/spawning/EntityFactory';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';

function isModel(url: string): boolean {
    const ext = url.split('.').pop()?.toLowerCase();
    return ext === 'glb' || ext === 'gltf';
}

export class SimpleSharedInstance extends BaseReplicatedObjectInstance {
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
        super(context, 'simple-shared-object');

        this.group = new THREE.Group();
        this.group.name = `simple-shared-object:${this.id}`;

        const position = config.position || { x: 0, y: 1.15, z: 0 };
        const halfExtents = config.halfExtents as { x: number, y: number, z: number } | undefined;

        // Create a temporary wireframe placeholder if bounds are known
        if (halfExtents) {
            const hx = halfExtents.x, hy = halfExtents.y, hz = halfExtents.z;
            const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.3 });
            const placeholder = new THREE.Mesh(geo, mat);
            placeholder.name = 'placeholder';
            this.group.add(placeholder);
        }

        const isAuthority = config.isAuthority !== undefined ? config.isAuthority : context.app.isHost;
        const ownerId = config.ownerId as string;

        this.propEntity = EntityFactory.createGrabbable(
            context.app,
            `prop_${this.id}`,
            0.5,
            position,
            this.group as any,
            halfExtents || { x: 0.25, y: 0.25, z: 0.05 },
            'simple-shared-object',
            ownerId,
            config.url as string
        );

        if (this.propEntity) {
            this.addCleanup(() => {
                if (this.propEntity) {
                    this.context.app.runtime.entity?.removeEntity(this.propEntity.id);
                }
            });
        }

        if (config.url) {
            this.loadUrl(config.url as string);
            if (isAuthority) {
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

        if (!this.context.app.runtime.render) return;

        if (isModel(this.url)) {
            this.loadAsModel(this.url);
        } else {
            this.loadAsImage(this.url);
        }
    }

    private loadAsModel(url: string): void {
        this.context.app.runtime.assets.getNormalizedModel(url, 0.5)
            .then(model => {
                this.replacePlaceholder(model);
            })
            .catch(err => {
                console.error('[SimpleSharedInstance] Failed to load model:', url, err);
            });
    }

    private loadAsImage(url: string): void {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(url, (texture) => {
            const halfExtents = this.propEntity?.halfExtents || { x: 0.25, y: 0.25, z: 0.05 };
            const width = halfExtents.x * 2;
            const height = halfExtents.y * 2;

            const geometry = new THREE.PlaneGeometry(width, height);
            const material = new THREE.MeshStandardMaterial({
                map: texture,
                side: THREE.DoubleSide,
                roughness: 0.8
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = 'image-content';

            this.replacePlaceholder(mesh);

            this.addCleanup(() => {
                geometry.dispose();
                material.dispose();
            });
        }, undefined, (err) => {
            console.error('[SimpleSharedInstance] Failed to load image:', url, err);
        });
    }

    private replacePlaceholder(content: THREE.Object3D): void {
        const placeholder = this.group.getObjectByName('placeholder');
        if (placeholder) {
            this.group.remove(placeholder);
            if (placeholder instanceof THREE.Mesh) {
                placeholder.geometry.dispose();
                if (Array.isArray(placeholder.material)) {
                    placeholder.material.forEach(m => m.dispose());
                } else {
                    placeholder.material.dispose();
                }
            }
        }
        this.group.add(content);
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

export class SimpleSharedObject implements IObjectModule {
    public readonly id = 'simple-shared-object';
    public readonly displayName = 'Shared Asset';
    public readonly tags = ['dynamic', 'shared', 'prop'];
    public readonly networked = true;
    public readonly portable = true;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): SimpleSharedInstance {
        return new SimpleSharedInstance(context, config);
    }
}
