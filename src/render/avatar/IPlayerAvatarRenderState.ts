import { IAvatarSkeletonPose } from '../../shared/avatar/AvatarSkeleton';
import { IAvatarHumanoidPose } from '../../shared/avatar/AvatarHumanoidPose';

export interface IPlayerAvatarRenderState {
    skeleton: IAvatarSkeletonPose;
    humanoidPose: IAvatarHumanoidPose;
    name: string;
    color?: string | number;
    isLocal?: boolean;
    audioLevel?: number;
    lerpFactor?: number;
}
