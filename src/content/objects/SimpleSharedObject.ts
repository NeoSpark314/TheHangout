import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedPhysicsPropObjectInstance } from '../runtime/BaseReplicatedPhysicsPropObjectInstance';

function isModel(url: string): boolean {
    const ext = url.split('.').pop()?.toLowerCase();
    return ext === 'glb' || ext === 'gltf';
}

/** Default collider half-extents used before the real asset bounds are known. */
const DEFAULT_HALF_EXTENTS = { x: 0.15, y: 0.15, z: 0.15 };

function createLoadingPlaceholder(): { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.Material } {
    const geo = new THREE.SphereGeometry(0.15, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00aaff, wireframe: true, transparent: true, opacity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'placeholder';
    return { mesh, geo, mat };
}

export class SimpleSharedInstance extends BaseReplicatedPhysicsPropObjectInstance {
    private url: string | null = null;
    private group: THREE.Group;
    private loaded = false;
    private _destroyed = false;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        const group = new THREE.Group();
        const position = config.position || { x: 0, y: 1.15, z: 0 };
        const ownerId = (typeof config.ownerId === 'string' || config.ownerId === null)
            ? config.ownerId
            : undefined;
        const entityId = (typeof config.entityId === 'string' && config.entityId.length > 0)
            ? config.entityId
            : (typeof config.id === 'string' ? config.id : undefined);

        super(context, 'simple-shared-object', {
            shape: 'box',
            size: 0.5,
            position,
            mesh: group as any,
            halfExtents: DEFAULT_HALF_EXTENTS,
            ownerId,
            url: typeof config.url === 'string' ? config.url : undefined,
            entityId,
            scale: typeof config.scale === 'number' ? config.scale : undefined,
            dualGrabScalable: true,
            replicationProfileId: 'default-prop'
        });

        this.group = group;
        this.group.name = `simple-shared-object:${this.id}`;
        if (this.propEntity?.id) {
            this.group.userData.entityId = this.propEntity.id;
        }

        // Only show a loading placeholder if we have a url to load.
        // When spawned via EntityRegistry.discover() the url is absent from the
        // entity state packet, so we defer the placeholder to applyReplicationSnapshot.
        if (config.url && context.scene.isRenderingAvailable()) {
            const { mesh, geo, mat } = createLoadingPlaceholder();
            this.group.add(mesh);
            this.addCleanup(() => { geo.dispose(); mat.dispose(); });
        }

        if (this.propEntity && config.url) {
            const urlStr = config.url as string;
            this.loadUrl(urlStr);

            // Only the authoritative peer emits the url sync event.
            // Use propEntity.isAuthority as the single source of truth.
            if (this.propEntity.isAuthority) {
                setTimeout(() => {
                    if (this._destroyed) return;
                    this.emitSyncEvent('set-url', { url: urlStr });
                }, 0);
            }
        }
    }

    private updateCollider(halfExtents: { x: number; y: number; z: number }): void {
        if (!this.propEntity) return;
        this.propEntity.setBaseHalfExtents(halfExtents);
    }

    private loadUrl(newUrl: string): void {
        this.url = newUrl;
        if (!this.url || this.loaded) return;
        this.loaded = true;

        if (!this.context.scene.isRenderingAvailable()) return;

        if (isModel(this.url)) {
            this.loadAsModel(this.url);
        } else {
            this.loadAsImage(this.url);
        }
    }

    private loadAsModel(url: string): void {
        this.context.assets.getNormalizedModel(url, 0.5)
            .then(model => {
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const halfExtents = { x: size.x / 2, y: size.y / 2, z: size.z / 2 };
                this.updateCollider(halfExtents);

                if (this.propEntity?.id) {
                    model.traverse(child => { child.userData.entityId = this.propEntity!.id; });
                }

                this.replacePlaceholder(model);
            })
            .catch(err => {
                console.error('[SimpleSharedInstance] Failed to load model:', url, err);
            });
    }

    private loadAsImage(url: string): void {
        this.context.assets.loadTexture(url).then((texture) => {
            const image = texture.image as HTMLImageElement;
            const aspect = image.width / image.height;
            const height = 0.5;
            const width = height * aspect;
            const halfExtents = { x: width / 2, y: height / 2, z: 0.05 };
            this.updateCollider(halfExtents);

            const geometry = new THREE.PlaneGeometry(width, height);
            const material = new THREE.MeshStandardMaterial({
                map: texture,
                side: THREE.DoubleSide,
                roughness: 0.8
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = 'image-content';
            if (this.propEntity?.id) {
                mesh.userData.entityId = this.propEntity.id;
            }

            this.replacePlaceholder(mesh);

            this.addCleanup(() => {
                geometry.dispose();
                material.dispose();
            });
        }).catch((err) => {
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
        const baseHalfExtents = this.propEntity?.getBaseHalfExtents?.() || this.propEntity?.halfExtents;
        return {
            url: this.url,
            halfExtents: baseHalfExtents
        };
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const payload = snapshot as { url?: string; halfExtents?: { x?: number; y?: number; z?: number } };

        const he = payload.halfExtents;
        if (he && typeof he.x === 'number' && typeof he.y === 'number' && typeof he.z === 'number') {
            this.updateCollider({ x: he.x, y: he.y, z: he.z });
        }

        // Only show loader and start the download if not already in progress.
        if (!this.loaded && payload.url) {
            if (this.context.scene.isRenderingAvailable()) {
                const { mesh, geo, mat } = createLoadingPlaceholder();
                if (this.propEntity?.id) {
                    mesh.userData.entityId = this.propEntity.id;
                }
                this.group.add(mesh);
                this.addCleanup(() => { geo.dispose(); mat.dispose(); });
            }
            this.loadUrl(payload.url);
        }
    }


    public destroy(): void {
        this._destroyed = true;
        super.destroy();
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
