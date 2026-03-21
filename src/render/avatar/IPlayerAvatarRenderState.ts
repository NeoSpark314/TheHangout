import { IAvatarSkeletonPose } from '../../shared/avatar/AvatarSkeleton';

export interface IPlayerAvatarRenderState {
    skeleton: IAvatarSkeletonPose;
    name: string;
    color?: string | number;
    isLocal?: boolean;
    audioLevel?: number;
    lerpFactor?: number;
}
