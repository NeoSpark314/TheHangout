import { HumanoidJointName, IHumanoidState } from '../interfaces/IHumanoid';
import { IPose, IVector3, IQuaternion } from '../interfaces/IMath';
import { Vec3Arr, QuatArr } from '../interfaces/IEntityState';

export type NetworkHumanoidDelta = Record<string, { p?: Vec3Arr, q?: QuatArr } | null>;

export class HumanoidState implements IHumanoidState {
    public joints: Partial<Record<HumanoidJointName, IPose>> = {};
    private dirtyJoints: Set<HumanoidJointName> = new Set();
    // Tracks joints we have ever published so full-sync can send tombstones
    // for joints that were removed (e.g. hand-tracking -> controller switch).
    private knownJoints: Set<HumanoidJointName> = new Set();

    // Configurable tolerance for when a joint is considered "moved" enough to sync
    private posTolerance: number = 0.001;
    private quatTolerance: number = 0.005;

    constructor() { }

    /**
     * Updates a joint's pose. If it has changed beyond the tolerance threshold,
     * it flags the joint as dirty so it will be included in the next network delta.
     */
    public setJointPose(name: HumanoidJointName, position: IVector3, quaternion: IQuaternion): void {
        let joint = this.joints[name];
        let isDirty = false;

        if (!joint) {
            this.joints[name] = {
                position: { ...position },
                quaternion: { ...quaternion }
            };
            this.knownJoints.add(name);
            this.dirtyJoints.add(name);
            return;
        }
        this.knownJoints.add(name);

        // Check if position changed
        if (Math.abs(joint.position.x - position.x) > this.posTolerance ||
            Math.abs(joint.position.y - position.y) > this.posTolerance ||
            Math.abs(joint.position.z - position.z) > this.posTolerance) {

            joint.position.x = position.x;
            joint.position.y = position.y;
            joint.position.z = position.z;
            isDirty = true;
        }

        // Check if rotation changed
        if (Math.abs(joint.quaternion.x - quaternion.x) > this.quatTolerance ||
            Math.abs(joint.quaternion.y - quaternion.y) > this.quatTolerance ||
            Math.abs(joint.quaternion.z - quaternion.z) > this.quatTolerance ||
            Math.abs(joint.quaternion.w - quaternion.w) > this.quatTolerance) {

            joint.quaternion.x = quaternion.x;
            joint.quaternion.y = quaternion.y;
            joint.quaternion.z = quaternion.z;
            joint.quaternion.w = quaternion.w;
            isDirty = true;
        }

        if (isDirty) {
            this.dirtyJoints.add(name);
        }
    }

    public clearJoint(name: HumanoidJointName): void {
        if (this.joints[name]) {
            delete this.joints[name];
            this.dirtyJoints.add(name);
        }
    }

    public clearAll(): void {
        for (const key in this.joints) {
            const name = key as HumanoidJointName;
            this.dirtyJoints.add(name);
        }
        this.joints = {};
    }

    /**
     * Extracts all modified joints into a minified payload for network transmission,
     * and CLEARS the dirty flag so they aren't sent again until modified.
     */
    public consumeNetworkDelta(fullSync: boolean = false): NetworkHumanoidDelta | null {
        if (!fullSync && this.dirtyJoints.size === 0) return null;

        const delta: NetworkHumanoidDelta = {};
        const jointsToSerialize = fullSync
            ? Array.from(new Set<HumanoidJointName>([
                ...(Object.keys(this.joints) as HumanoidJointName[]),
                ...Array.from(this.knownJoints)
            ]))
            : Array.from(this.dirtyJoints);
        let hasData = false;

        for (const jointName of jointsToSerialize) {
            const name = jointName as HumanoidJointName;
            const pose = this.joints[name];
            if (pose) {
                // Short keys for bandwidth compression
                delta[name] = {
                    p: [pose.position.x, pose.position.y, pose.position.z],
                    q: [pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w]
                };
            } else if (!fullSync) {
                // We only explicitly push 'null' deletions during incremental diffs
                delta[name] = null;
            }
            hasData = true;
        }

        this.dirtyJoints.clear();
        return hasData ? delta : null;
    }

    /**
     * Receives a network delta packet and applies it to the local state map.
     */
    public applyNetworkDelta(delta: NetworkHumanoidDelta | undefined | null): void {
        if (!delta) return;

        for (const jointName in delta) {
            const data = delta[jointName];
            const name = jointName as HumanoidJointName;

            if (data === null) {
                delete this.joints[name];
                this.dirtyJoints.add(name);
                continue;
            }

            if (!this.joints[name]) {
                this.joints[name] = {
                    position: { x: 0, y: 0, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                };
            }
            this.knownJoints.add(name);

            const joint = this.joints[name]!;

            if (data.p) {
                joint.position.x = data.p[0];
                joint.position.y = data.p[1];
                joint.position.z = data.p[2];
            }

            if (data.q) {
                joint.quaternion.x = data.q[0];
                joint.quaternion.y = data.q[1];
                joint.quaternion.z = data.q[2];
                joint.quaternion.w = data.q[3];
            }

            this.dirtyJoints.add(name);
        }
    }
}
