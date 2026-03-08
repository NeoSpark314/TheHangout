import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';
import { EntityFactory } from '../../world/spawning/EntityFactory';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';

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

export class SimpleSharedInstance extends BaseReplicatedObjectInstance {
    private url: string | null = null;
    private group: THREE.Group;
    private propEntity: PhysicsPropEntity | null = null;
    private loaded = false;
    private _destroyed = false;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        super(context, 'simple-shared-object');

        this.group = new THREE.Group();
        this.group.name = `simple-shared-object:${this.id}`;

        const position = config.position || { x: 0, y: 1.15, z: 0 };
        const ownerId = config.ownerId as string;

        // Only show a loading placeholder if we have a url to load.
        // When spawned via EntityRegistry.discover() the url is absent from the
        // entity state packet, so we defer the placeholder to applyReplicationSnapshot.
        if (config.url && context.app.runtime.render) {
            const { mesh, geo, mat } = createLoadingPlaceholder();
            this.group.add(mesh);
            this.addCleanup(() => { geo.dispose(); mat.dispose(); });
        }

        // Pass this.group as the mesh. EntityFactory wraps it in a PhysicsPropView,
        // which adds it to both render.scene and render.interactionGroup — correctly
        // wiring hover/grab detection and pose tracking via PhysicsPropEntity.present().
        this.propEntity = EntityFactory.createGrabbable(
            context.app,
            `prop_${this.id}`,
            0.5,
            position,
            this.group as any,
            DEFAULT_HALF_EXTENTS,
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

            if (config.url) {
                const urlStr = config.url as string;
                this.loadUrl(urlStr);

                // Only the authoritative peer emits the url sync event.
                // Use propEntity.isAuthority as the single source of truth — it
                // accounts for ownerId-based authority via syncAuthority().
                if (this.propEntity.isAuthority) {
                    setTimeout(() => {
                        if (this._destroyed) return;
                        this.emitSyncEvent('set-url', { url: urlStr });
                    }, 0);
                }
            }
        }
    }

    private updateCollider(halfExtents: { x: number; y: number; z: number }): void {
        if (!this.propEntity) return;
        // Resize the local physics collider to match the loaded asset bounds.
        // Every peer does this independently after their own download completes,
        // so no explicit bounds sync event is needed.
        this.context.app.runtime.physics?.updateGrabbableCollider(
            this.propEntity.id,
            undefined,
            0.5,
            halfExtents
        );
        this.propEntity.halfExtents = halfExtents;
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
                // Compute real bounds from the loaded model and resize the collider.
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const halfExtents = { x: size.x / 2, y: size.y / 2, z: size.z / 2 };
                this.updateCollider(halfExtents);

                // Propagate entityId onto all sub-meshes so hover detection works.
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
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(url, (texture) => {
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

    // Required so EntityRegistry.discover() can return this entity directly
    // instead of falling back to EntityFactory.spawn(), which would create a
    // second PhysicsPropEntity with NullView and overwrite the correct one.
    public getPrimaryEntity(): PhysicsPropEntity | null {
        return this.propEntity;
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

        // Only show loader and start the download if not already in progress.
        // When the instance was created via EntityRegistry.discover() (entity state
        // arrived before the feature snapshot), config.url is already set and
        // this.loaded is already true — adding another placeholder here would
        // create an orphaned mesh that replacePlaceholder can never find.
        if (!this.loaded && payload.url) {
            if (this.context.app.runtime.render) {
                const { mesh, geo, mat } = createLoadingPlaceholder();
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
