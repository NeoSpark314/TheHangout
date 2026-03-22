import type { IPlayerEntityState } from '../../../shared/contracts/IEntityState';
import type { IAudioChunkPayload, IVoiceStreamReceivedEvent, IVoiceStreamReceiver } from '../../../shared/contracts/IVoice';
import eventBus from '../../../app/events/EventBus';
import { EVENTS } from '../../../shared/constants/Constants';
import { formatPlayerDisplayName } from '../../../shared/utils/PlayerBadgeUtils';
import type { PlayerAvatarEntity } from '../PlayerAvatarEntity';
import type { IPlayerAvatarControlStrategy } from './IPlayerAvatarControlStrategy';
import { createAvatarHumanoidPoseFromSkeleton } from '../../../shared/avatar/AvatarHumanoidPose';
import { AVATAR_SKELETON_JOINTS, cloneAvatarSkeletonPose, IAvatarSkeletonPose } from '../../../shared/avatar/AvatarSkeleton';
import * as THREE from 'three';

const REMOTE_SKELETON_LERP_SPEED = 20;
const REMOTE_SKELETON_SNAP_DISTANCE = 2.5;
const REMOTE_SKELETON_SNAP_ANGLE = THREE.MathUtils.degToRad(120);

export class RemotePlayerReplicationStrategy implements IPlayerAvatarControlStrategy {
    public readonly mode = 'remote';
    private lastNetworkUpdateTime = performance.now();
    private onVoiceStream: (data?: IVoiceStreamReceivedEvent) => void = () => { };
    private renderPose: IAvatarSkeletonPose | null = null;

    public attach(player: PlayerAvatarEntity): void {
        player.name = 'Player';
        this.renderPose = cloneAvatarSkeletonPose(player.avatarSkeleton.pose);

        this.onVoiceStream = (data) => {
            const voiceView = player.view as unknown as Partial<IVoiceStreamReceiver>;
            if (data && data.peerId === player.peerId && data.stream && voiceView.attachVoiceStream) {
                console.log(`[RemotePlayer] Attaching voice stream for ${player.peerId}`);
                voiceView.attachVoiceStream(data.stream);
            }
        };
        eventBus.on(EVENTS.VOICE_STREAM_RECEIVED, this.onVoiceStream);

        const cachedStream = player.appContext.runtime.media?.getRemoteStream(player.peerId);
        const voiceView = player.view as unknown as Partial<IVoiceStreamReceiver>;
        if (cachedStream && voiceView.attachVoiceStream) {
            console.log(`[RemotePlayer] Attaching cached voice stream for ${player.peerId}`);
            voiceView.attachVoiceStream(cachedStream);
        }
    }

    public onAudioChunk(player: PlayerAvatarEntity, payload: IAudioChunkPayload): void {
        const { chunk, isHeader } = payload;

        if (isHeader) {
            console.log(`[RemotePlayer] Receiving audio header chunk from ${player.peerId} (${chunk?.length} chars)`);
        }
        this.lastNetworkUpdateTime = performance.now();
        player.view.attachAudioChunk({ chunk, isHeader });
    }

    public getNetworkState(): IPlayerEntityState | null {
        return null;
    }

    public applyNetworkState(player: PlayerAvatarEntity, data: IPlayerEntityState): void {
        let stateChanged = false;

        if (data.n !== undefined && data.n !== player.name) {
            player.name = data.n;
            eventBus.emit(EVENTS.REMOTE_NAME_UPDATED, { peerId: player.peerId, name: player.name });
            stateChanged = true;
        }

        if (data.conf) {
            const incomingRenderMode = data.conf.renderMode ?? 'stick';
            const incomingUrl = data.conf.vrmUrl ?? null;
            const changed = data.conf.color !== player.avatarConfigSnapshot.color
                || incomingRenderMode !== player.avatarConfigSnapshot.renderMode
                || incomingUrl !== (player.avatarConfigSnapshot.vrmUrl ?? null);

            if (changed) {
                player.setAvatarConfig({
                    color: data.conf.color,
                    renderMode: incomingRenderMode,
                    vrmUrl: incomingUrl
                });
                stateChanged = true;
            }
        }

        if (data.mic !== undefined && player.micEnabled !== !!data.mic) {
            player.micEnabled = !!data.mic;
            stateChanged = true;
        }

        if (stateChanged) {
            eventBus.emit(EVENTS.PEER_STATE_UPDATED, player.peerId);
        }

        this.lastNetworkUpdateTime = performance.now();

        if (data.sk) {
            player.avatarSkeleton.applyNetworkDelta(data.sk);
            player.syncLegacyPoseFromSkeleton();
            if (!this.renderPose) {
                this.renderPose = cloneAvatarSkeletonPose(player.avatarSkeleton.pose);
            }
            return;
        }

        if (data.p) player.targetPosition = { x: data.p[0], y: data.p[1], z: data.p[2] };
        if (data.y !== undefined) player.targetYaw = data.y;
        if (data.h !== undefined) player.headHeight = data.h;
        if (data.hq) {
            player.headState.quaternion = { x: data.hq[0], y: data.hq[1], z: data.hq[2], w: data.hq[3] };
        }
    }

    public update(player: PlayerAvatarEntity, delta: number): void {
        if (performance.now() - this.lastNetworkUpdateTime > 10000) {
            console.warn(`[RemotePlayer] Player ${player.peerId} timed out. Destroying.`);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, player.peerId);
            player.destroy();
            return;
        }

        const lerpFactor = 15 * delta;
        player.audioLevel = player.view.getAudioLevel();
        const renderPose = this.getRenderPose(player, delta);

        player.view.applyState({
            skeleton: renderPose,
            humanoidPose: createAvatarHumanoidPoseFromSkeleton(renderPose),
            name: formatPlayerDisplayName(
                {
                    name: player.name || 'Player',
                    micEnabled: player.micEnabled,
                    isMuted: player.isMuted
                },
                {
                    includeHost: false,
                    includeTalking: false
                }
            ),
            color: player.avatarConfigSnapshot.color,
            audioLevel: player.audioLevel,
            lerpFactor
        }, delta);
    }

    public detach(_player: PlayerAvatarEntity): void {
        eventBus.off(EVENTS.VOICE_STREAM_RECEIVED, this.onVoiceStream);
        this.renderPose = null;
    }

    public destroy(player: PlayerAvatarEntity): void {
        this.detach(player);
    }

    private getRenderPose(player: PlayerAvatarEntity, delta: number): IAvatarSkeletonPose {
        const targetPose = player.avatarSkeleton.pose;
        if (!this.renderPose) {
            this.renderPose = cloneAvatarSkeletonPose(targetPose);
            return this.renderPose;
        }

        if (this.shouldSnapToTarget(this.renderPose, targetPose)) {
            this.renderPose = cloneAvatarSkeletonPose(targetPose);
            return this.renderPose;
        }

        const alpha = THREE.MathUtils.clamp(
            1 - Math.exp(-Math.max(0.0001, delta) * REMOTE_SKELETON_LERP_SPEED),
            0,
            1
        );
        this.interpolatePoseToward(this.renderPose, targetPose, alpha);
        return this.renderPose;
    }

    private shouldSnapToTarget(current: IAvatarSkeletonPose, target: IAvatarSkeletonPose): boolean {
        const rootDelta = new THREE.Vector3(
            current.rootWorldPosition.x - target.rootWorldPosition.x,
            current.rootWorldPosition.y - target.rootWorldPosition.y,
            current.rootWorldPosition.z - target.rootWorldPosition.z
        );
        if (rootDelta.length() > REMOTE_SKELETON_SNAP_DISTANCE) {
            return true;
        }

        const currentRoot = new THREE.Quaternion(
            current.rootWorldQuaternion.x,
            current.rootWorldQuaternion.y,
            current.rootWorldQuaternion.z,
            current.rootWorldQuaternion.w
        );
        const targetRoot = new THREE.Quaternion(
            target.rootWorldQuaternion.x,
            target.rootWorldQuaternion.y,
            target.rootWorldQuaternion.z,
            target.rootWorldQuaternion.w
        );
        return currentRoot.angleTo(targetRoot) > REMOTE_SKELETON_SNAP_ANGLE;
    }

    private interpolatePoseToward(current: IAvatarSkeletonPose, target: IAvatarSkeletonPose, alpha: number): void {
        current.rootWorldPosition = {
            x: THREE.MathUtils.lerp(current.rootWorldPosition.x, target.rootWorldPosition.x, alpha),
            y: THREE.MathUtils.lerp(current.rootWorldPosition.y, target.rootWorldPosition.y, alpha),
            z: THREE.MathUtils.lerp(current.rootWorldPosition.z, target.rootWorldPosition.z, alpha)
        };

        const currentRootQuat = new THREE.Quaternion(
            current.rootWorldQuaternion.x,
            current.rootWorldQuaternion.y,
            current.rootWorldQuaternion.z,
            current.rootWorldQuaternion.w
        );
        const targetRootQuat = new THREE.Quaternion(
            target.rootWorldQuaternion.x,
            target.rootWorldQuaternion.y,
            target.rootWorldQuaternion.z,
            target.rootWorldQuaternion.w
        );
        currentRootQuat.slerp(targetRootQuat, alpha);
        current.rootWorldQuaternion = {
            x: currentRootQuat.x,
            y: currentRootQuat.y,
            z: currentRootQuat.z,
            w: currentRootQuat.w
        };
        current.poseState = target.poseState;

        for (const jointName of AVATAR_SKELETON_JOINTS) {
            const currentJoint = current.joints[jointName];
            const targetJoint = target.joints[jointName];
            if (!currentJoint || !targetJoint) continue;

            currentJoint.position = {
                x: THREE.MathUtils.lerp(currentJoint.position.x, targetJoint.position.x, alpha),
                y: THREE.MathUtils.lerp(currentJoint.position.y, targetJoint.position.y, alpha),
                z: THREE.MathUtils.lerp(currentJoint.position.z, targetJoint.position.z, alpha)
            };

            const currentJointQuat = new THREE.Quaternion(
                currentJoint.quaternion.x,
                currentJoint.quaternion.y,
                currentJoint.quaternion.z,
                currentJoint.quaternion.w
            );
            const targetJointQuat = new THREE.Quaternion(
                targetJoint.quaternion.x,
                targetJoint.quaternion.y,
                targetJoint.quaternion.z,
                targetJoint.quaternion.w
            );
            currentJointQuat.slerp(targetJointQuat, alpha);
            currentJoint.quaternion = {
                x: currentJointQuat.x,
                y: currentJointQuat.y,
                z: currentJointQuat.z,
                w: currentJointQuat.w
            };
            current.tracked[jointName] = target.tracked[jointName];
        }
    }
}
