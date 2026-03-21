import {
    AVATAR_SKELETON_JOINTS,
    AvatarSkeletonJointName,
    cloneAvatarSkeletonPose,
    createAvatarSkeletonPose,
    IAvatarSkeletonDelta,
    IAvatarSkeletonPose
} from './AvatarSkeleton';
import { arrayToQuaternion, arrayToVector3, quaternionToArray, vectorToArray } from './AvatarSkeletonUtils';

export class AvatarSkeletonState {
    public readonly pose: IAvatarSkeletonPose = createAvatarSkeletonPose();

    private readonly dirtyJoints = new Set<AvatarSkeletonJointName>();
    private readonly knownJoints = new Set<AvatarSkeletonJointName>(AVATAR_SKELETON_JOINTS);
    private rootDirty = true;
    private poseStateDirty = true;
    private trackedDirty = true;
    private readonly posTolerance = 0.001;
    private readonly quatTolerance = 0.005;

    public setPose(nextPose: IAvatarSkeletonPose): void {
        if (this.needsVectorUpdate(this.pose.rootWorldPosition, nextPose.rootWorldPosition)) {
            this.pose.rootWorldPosition = { ...nextPose.rootWorldPosition };
            this.rootDirty = true;
        }

        if (this.needsQuaternionUpdate(this.pose.rootWorldQuaternion, nextPose.rootWorldQuaternion)) {
            this.pose.rootWorldQuaternion = { ...nextPose.rootWorldQuaternion };
            this.rootDirty = true;
        }

        if (this.pose.poseState !== nextPose.poseState) {
            this.pose.poseState = nextPose.poseState;
            this.poseStateDirty = true;
        }

        for (const jointName of AVATAR_SKELETON_JOINTS) {
            const targetPose = nextPose.joints[jointName];
            const currentPose = this.pose.joints[jointName];
            if (!targetPose || !currentPose) continue;

            let jointDirty = false;
            if (this.needsVectorUpdate(currentPose.position, targetPose.position)) {
                currentPose.position = { ...targetPose.position };
                jointDirty = true;
            }
            if (this.needsQuaternionUpdate(currentPose.quaternion, targetPose.quaternion)) {
                currentPose.quaternion = { ...targetPose.quaternion };
                jointDirty = true;
            }
            if ((this.pose.tracked[jointName] ?? false) !== (nextPose.tracked[jointName] ?? false)) {
                this.pose.tracked[jointName] = nextPose.tracked[jointName] ?? false;
                jointDirty = true;
                this.trackedDirty = true;
            }

            if (jointDirty) {
                this.dirtyJoints.add(jointName);
            }
        }
    }

    public getSnapshot(): IAvatarSkeletonPose {
        return cloneAvatarSkeletonPose(this.pose);
    }

    public setJointLocalPose(
        jointName: AvatarSkeletonJointName,
        nextPose: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } },
        tracked: boolean
    ): void {
        const currentPose = this.pose.joints[jointName];
        if (!currentPose) return;

        let jointDirty = false;
        if (this.needsVectorUpdate(currentPose.position, nextPose.position)) {
            currentPose.position = { ...nextPose.position };
            jointDirty = true;
        }
        if (this.needsQuaternionUpdate(currentPose.quaternion, nextPose.quaternion)) {
            currentPose.quaternion = { ...nextPose.quaternion };
            jointDirty = true;
        }
        if ((this.pose.tracked[jointName] ?? false) !== tracked) {
            this.pose.tracked[jointName] = tracked;
            jointDirty = true;
            this.trackedDirty = true;
        }

        if (jointDirty) {
            this.dirtyJoints.add(jointName);
        }
    }

    public clear(): void {
        const reset = createAvatarSkeletonPose();
        this.pose.rootWorldPosition = reset.rootWorldPosition;
        this.pose.rootWorldQuaternion = reset.rootWorldQuaternion;
        this.pose.poseState = reset.poseState;
        for (const jointName of AVATAR_SKELETON_JOINTS) {
            const nextPose = reset.joints[jointName];
            if (!nextPose) continue;
            this.pose.joints[jointName] = {
                position: { ...nextPose.position },
                quaternion: { ...nextPose.quaternion }
            };
            this.pose.tracked[jointName] = false;
            this.dirtyJoints.add(jointName);
        }
        this.rootDirty = true;
        this.poseStateDirty = true;
        this.trackedDirty = true;
    }

    public consumeNetworkDelta(fullSync: boolean = false): IAvatarSkeletonDelta | null {
        if (!fullSync && !this.rootDirty && !this.poseStateDirty && this.dirtyJoints.size === 0 && !this.trackedDirty) {
            return null;
        }

        const delta: IAvatarSkeletonDelta = {};
        if (fullSync || this.rootDirty) {
            delta.rp = vectorToArray(this.pose.rootWorldPosition);
            delta.rq = quaternionToArray(this.pose.rootWorldQuaternion);
        }
        if (fullSync || this.poseStateDirty) {
            delta.ps = this.pose.poseState;
        }

        const joints = fullSync ? AVATAR_SKELETON_JOINTS : Array.from(this.dirtyJoints);
        if (joints.length > 0) {
            delta.j = {};
            for (const jointName of joints) {
                const pose = this.pose.joints[jointName];
                if (!pose) continue;
                delta.j[jointName] = {
                    p: vectorToArray(pose.position),
                    q: quaternionToArray(pose.quaternion),
                    t: this.pose.tracked[jointName] ? 1 : 0
                };
            }
        }

        this.rootDirty = false;
        this.poseStateDirty = false;
        this.trackedDirty = false;
        this.dirtyJoints.clear();

        return delta;
    }

    public applyNetworkDelta(delta: IAvatarSkeletonDelta | undefined | null): void {
        if (!delta) return;

        if (delta.rp) {
            this.pose.rootWorldPosition = arrayToVector3(delta.rp, this.pose.rootWorldPosition);
        }
        if (delta.rq) {
            this.pose.rootWorldQuaternion = arrayToQuaternion(delta.rq, this.pose.rootWorldQuaternion);
        }
        if (delta.ps) {
            this.pose.poseState = delta.ps;
        }
        if (delta.j) {
            for (const jointName in delta.j) {
                const name = jointName as AvatarSkeletonJointName;
                const data = delta.j[name];
                if (!data) continue;

                const pose = this.pose.joints[name];
                if (!pose) continue;
                pose.position = arrayToVector3(data.p, pose.position);
                pose.quaternion = arrayToQuaternion(data.q, pose.quaternion);
                this.pose.tracked[name] = data.t === 1;
            }
        }
    }

    private needsVectorUpdate(
        current: { x: number; y: number; z: number },
        next: { x: number; y: number; z: number }
    ): boolean {
        return Math.abs(current.x - next.x) > this.posTolerance
            || Math.abs(current.y - next.y) > this.posTolerance
            || Math.abs(current.z - next.z) > this.posTolerance;
    }

    private needsQuaternionUpdate(
        current: { x: number; y: number; z: number; w: number },
        next: { x: number; y: number; z: number; w: number }
    ): boolean {
        return Math.abs(current.x - next.x) > this.quatTolerance
            || Math.abs(current.y - next.y) > this.quatTolerance
            || Math.abs(current.z - next.z) > this.quatTolerance
            || Math.abs(current.w - next.w) > this.quatTolerance;
    }
}
