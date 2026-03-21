import * as THREE from 'three';
import { ITwoBoneIkResult, TwoBoneIkSolver } from '../shared/TwoBoneIkSolver';
import { composeAvatarWorldPoses } from '../../../shared/avatar/AvatarSkeletonUtils';
import type { IPlayerAvatarRenderState } from '../IPlayerAvatarRenderState';
import { VrmRetargetProfile, IVrmArmChainProfile } from './VrmRetargetProfile';

type AvatarWorldPoseMap = ReturnType<typeof composeAvatarWorldPoses>;

export class VrmHumanoidRetargeter {
    private readonly twoBoneIk = new TwoBoneIkSolver();
    private readonly leftIk: ITwoBoneIkResult = {
        upperQuaternion: new THREE.Quaternion(),
        lowerQuaternion: new THREE.Quaternion(),
        upperLength: 0.32,
        lowerLength: 0.32
    };
    private readonly rightIk: ITwoBoneIkResult = {
        upperQuaternion: new THREE.Quaternion(),
        lowerQuaternion: new THREE.Quaternion(),
        upperLength: 0.32,
        lowerLength: 0.32
    };
    private readonly tmpHeadLocalQuat = new THREE.Quaternion();
    private readonly tmpHeadEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    private readonly tmpPosePosition = new THREE.Vector3();
    private readonly tmpPoseQuat = new THREE.Quaternion();
    private readonly tmpTargetLocal = new THREE.Vector3();
    private readonly tmpPoleWorld = new THREE.Vector3();
    private readonly tmpDirectionWorld = new THREE.Vector3();
    private readonly tmpProjectedPoleWorld = new THREE.Vector3();
    private readonly tmpShoulderWorldPos = new THREE.Vector3();
    private readonly tmpShoulderParentWorldQuat = new THREE.Quaternion();
    private readonly tmpPoleLocal = new THREE.Vector3();

    constructor(private readonly profile: VrmRetargetProfile) { }

    public applySkeleton(state: IPlayerAvatarRenderState['skeleton'], lerpFactor: number): AvatarWorldPoseMap {
        const world = composeAvatarWorldPoses(state);

        this.profile.humanoid.resetNormalizedPose();
        this.applyHips(state, lerpFactor);
        this.applyLocalPose(this.profile.spineBone, state.joints.spine, lerpFactor);
        this.applyLocalPose(this.profile.chestBone, state.joints.chest, lerpFactor);
        this.applyLocalPose(this.profile.upperChestBone, state.joints.upperChest, lerpFactor);
        this.applyLocalPose(this.profile.neckBone, state.joints.neck, lerpFactor);
        this.applyHead(state, lerpFactor);

        this.profile.normalizedRoot.updateMatrixWorld(true);
        this.applyArm(this.profile.leftArm, world, lerpFactor, this.leftIk, 'left');
        this.applyArm(this.profile.rightArm, world, lerpFactor, this.rightIk, 'right');
        this.profile.normalizedRoot.updateMatrixWorld(true);

        return world;
    }

    public getRawHeadBone(): THREE.Object3D | null {
        return this.profile.rawHeadBone;
    }

    public getLeftArmNodes(): { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D } | null {
        if (!this.profile.leftArm) return null;
        return {
            upper: this.profile.leftArm.upper,
            lower: this.profile.leftArm.lower,
            hand: this.profile.leftArm.hand
        };
    }

    public getRightArmNodes(): { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D } | null {
        if (!this.profile.rightArm) return null;
        return {
            upper: this.profile.rightArm.upper,
            lower: this.profile.rightArm.lower,
            hand: this.profile.rightArm.hand
        };
    }

    private applyHips(state: IPlayerAvatarRenderState['skeleton'], lerpFactor: number): void {
        const hipsBone = this.profile.hipsBone;
        const hipsPose = state.joints.hips;
        if (!hipsBone || !hipsPose) return;

        this.tmpPosePosition.set(hipsPose.position.x, hipsPose.position.y, hipsPose.position.z);
        this.tmpPoseQuat.set(hipsPose.quaternion.x, hipsPose.quaternion.y, hipsPose.quaternion.z, hipsPose.quaternion.w);

        if (lerpFactor < 1.0) {
            hipsBone.position.lerp(this.tmpPosePosition, lerpFactor);
            hipsBone.quaternion.slerp(this.tmpPoseQuat, lerpFactor);
        } else {
            hipsBone.position.copy(this.tmpPosePosition);
            hipsBone.quaternion.copy(this.tmpPoseQuat);
        }
    }

    private applyLocalPose(
        node: THREE.Object3D | null,
        pose: IPlayerAvatarRenderState['skeleton']['joints'][keyof IPlayerAvatarRenderState['skeleton']['joints']],
        lerpFactor: number
    ): void {
        if (!node || !pose) return;

        this.tmpPoseQuat.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
        if (lerpFactor < 1.0) {
            node.quaternion.slerp(this.tmpPoseQuat, lerpFactor);
        } else {
            node.quaternion.copy(this.tmpPoseQuat);
        }
    }

    private applyHead(state: IPlayerAvatarRenderState['skeleton'], lerpFactor: number): void {
        const headBone = this.profile.headBone;
        const headPose = state.joints.head;
        if (!headBone || !headPose) return;

        this.tmpHeadLocalQuat.set(
            headPose.quaternion.x,
            headPose.quaternion.y,
            headPose.quaternion.z,
            headPose.quaternion.w
        );
        this.tmpHeadEuler.setFromQuaternion(this.tmpHeadLocalQuat, 'YXZ');
        this.tmpHeadEuler.x *= -1;
        this.tmpHeadLocalQuat.setFromEuler(this.tmpHeadEuler);

        if (lerpFactor < 1.0) {
            headBone.quaternion.slerp(this.tmpHeadLocalQuat, lerpFactor);
        } else {
            headBone.quaternion.copy(this.tmpHeadLocalQuat);
        }
    }

    private applyArm(
        chain: IVrmArmChainProfile | null,
        world: AvatarWorldPoseMap,
        lerpFactor: number,
        ikOut: ITwoBoneIkResult,
        side: 'left' | 'right'
    ): void {
        if (!chain) return;

        const shoulder = side === 'left' ? world.leftShoulder : world.rightShoulder;
        const elbow = side === 'left' ? world.leftLowerArm : world.rightLowerArm;
        const hand = side === 'left' ? world.leftHand : world.rightHand;
        if (!shoulder || !elbow || !hand) {
            this.applyArmRestPose(chain, lerpFactor);
            return;
        }

        this.tmpTargetLocal.copy(hand.position);
        this.profile.normalizedRoot.worldToLocal(this.tmpTargetLocal);

        const poleLocal = this.computeArmPoleLocal(chain, shoulder.position, elbow.position, hand.position);

        this.twoBoneIk.solve({
            rigRoot: this.profile.normalizedRoot,
            upper: chain.upper,
            targetLocalPosition: this.tmpTargetLocal,
            baseUpperDirection: chain.baseUpperDir,
            baseLowerDirection: chain.baseLowerDir,
            upperLength: chain.upperLength,
            lowerLength: chain.lowerLength,
            pole: poleLocal,
            allowStretch: true
        }, ikOut);

        if (lerpFactor < 1.0) {
            chain.upper.quaternion.slerp(ikOut.upperQuaternion, lerpFactor);
            chain.lower.quaternion.slerp(ikOut.lowerQuaternion, lerpFactor);
            chain.hand.quaternion.slerp(chain.restHandQuat, lerpFactor);
        } else {
            chain.upper.quaternion.copy(ikOut.upperQuaternion);
            chain.lower.quaternion.copy(ikOut.lowerQuaternion);
            chain.hand.quaternion.copy(chain.restHandQuat);
        }
    }

    private applyArmRestPose(chain: IVrmArmChainProfile, lerpFactor: number): void {
        if (lerpFactor < 1.0) {
            chain.upper.quaternion.slerp(chain.restUpperQuat, lerpFactor);
            chain.lower.quaternion.slerp(chain.restLowerQuat, lerpFactor);
            chain.hand.quaternion.slerp(chain.restHandQuat, lerpFactor);
        } else {
            chain.upper.quaternion.copy(chain.restUpperQuat);
            chain.lower.quaternion.copy(chain.restLowerQuat);
            chain.hand.quaternion.copy(chain.restHandQuat);
        }
    }

    private computeArmPoleLocal(
        chain: IVrmArmChainProfile,
        shoulderWorld: THREE.Vector3,
        elbowWorld: THREE.Vector3,
        handWorld: THREE.Vector3
    ): THREE.Vector3 {
        this.tmpDirectionWorld.subVectors(handWorld, shoulderWorld);
        const handDistanceSq = this.tmpDirectionWorld.lengthSq();
        if (handDistanceSq < 1e-6) {
            return chain.defaultPoleLocal;
        }

        this.tmpDirectionWorld.normalize();
        this.tmpPoleWorld.subVectors(elbowWorld, shoulderWorld);
        this.tmpProjectedPoleWorld.copy(this.tmpDirectionWorld).multiplyScalar(this.tmpPoleWorld.dot(this.tmpDirectionWorld));
        this.tmpPoleWorld.sub(this.tmpProjectedPoleWorld);
        if (this.tmpPoleWorld.lengthSq() < 1e-6) {
            return chain.defaultPoleLocal;
        }

        this.tmpPoleWorld.normalize();
        chain.shoulder.getWorldPosition(this.tmpShoulderWorldPos);
        (chain.upper.parent || this.profile.normalizedRoot).getWorldQuaternion(this.tmpShoulderParentWorldQuat);
        this.tmpPoleLocal.copy(this.tmpPoleWorld).applyQuaternion(this.tmpShoulderParentWorldQuat.invert());
        if (this.tmpPoleLocal.lengthSq() < 1e-6) {
            return chain.defaultPoleLocal;
        }

        return this.tmpPoleLocal.normalize();
    }
}
