// views/PhysicsPropView.js

import * as THREE from 'three';
import { EntityView } from './EntityView.js';

/**
 * Visual wrapper for physics props (grabbable cubes, etc.).
 *
 * Unlike StickFigureView and SpectatorView, this view does NOT create
 * its own geometry — it wraps an externally-provided mesh. This is because
 * physics props come in many shapes and are created by the room builder.
 *
 * Adds highlight support for grab-proximity feedback.
 *
 * State contract (passed to update()):
 *   position   - THREE.Vector3    world position
 *   quaternion - THREE.Quaternion world rotation
 *   lerpFactor - number           interpolation weight (1.0 = snap)
 */
export class PhysicsPropView extends EntityView {
    /**
     * @param {THREE.Mesh} mesh - The pre-built Three.js mesh for this prop
     */
    constructor(mesh) {
        super();
        this.mesh = mesh;

        // Store original emissive for highlight restoration
        this._originalEmissive = (mesh?.material?.emissive)
            ? mesh.material.emissive.clone()
            : new THREE.Color(0x000000);
    }

    /**
     * Toggle highlight effect (for grab proximity feedback).
     * @param {boolean} on
     */
    setHighlight(on) {
        if (!this.mesh?.material?.emissive) return;
        if (on) {
            this.mesh.material.emissive.set(0xffffff);
            this.mesh.material.emissiveIntensity = 0.5;
        } else {
            this.mesh.material.emissive.copy(this._originalEmissive);
            this.mesh.material.emissiveIntensity = 1.0;
        }
    }

    update(state, delta) {
        // Physics props are positioned by PhysicsEntity.update() directly,
        // so this is intentionally minimal. The view just provides the mesh
        // and highlight capability.
    }

    destroy() {
        if (!this.mesh) return;
        this.mesh.traverse((object) => {
            if (object.isMesh || object.isLine || object.isLineSegments) {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(mat => mat.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            }
        });
    }
}
