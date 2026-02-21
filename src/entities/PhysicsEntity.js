import { NetworkEntity } from './NetworkEntity.js';

export class PhysicsEntity extends NetworkEntity {
    constructor(id, isAuthority, mesh, rigidBody) {
        super(id, 'PHYSICS_PROP', isAuthority);
        this.mesh = mesh;
        this.rigidBody = rigidBody;
    }

    update(delta) {
        // PhysicsManager handles stepping the actual Rapier simulation for authoritative entities.
        // For non-authoritative entities, PhysicsManager state syncing snaps the rigid body,
        // and below we snap the visual mesh to the rigid body.

        if (this.rigidBody && this.mesh) {
            const position = this.rigidBody.translation();
            const rotation = this.rigidBody.rotation();

            this.mesh.position.set(position.x, position.y, position.z);
            this.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        }
    }

    getNetworkState() {
        if (!this.rigidBody) return null;

        const pos = this.rigidBody.translation();
        const rot = this.rigidBody.rotation();

        return {
            p: [pos.x, pos.y, pos.z],
            r: [rot.x, rot.y, rot.z, rot.w]
        };
    }

    setNetworkState(state) {
        if (!this.rigidBody || !this.mesh) return;

        // Snap the visual mesh
        this.mesh.position.set(state.p[0], state.p[1], state.p[2]);
        this.mesh.quaternion.set(state.r[0], state.r[1], state.r[2], state.r[3]);

        // Snap the local rigid body
        this.rigidBody.setTranslation({ x: state.p[0], y: state.p[1], z: state.p[2] }, true);
        this.rigidBody.setRotation({ x: state.r[0], y: state.r[1], z: state.r[2], w: state.r[3] }, true);
    }
}
