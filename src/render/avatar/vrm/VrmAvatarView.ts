import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { AppContext } from '../../../app/AppContext';
import { HumanoidJointName } from '../../../shared/contracts/IHumanoid';
import { EntityView } from '../../views/EntityView';
import { NameTagComponent } from '../components/NameTagComponent';
import { VoiceAudioComponent } from '../components/VoiceAudioComponent';
import type { IPlayerViewState } from '../stickfigure/StickFigureView';
import type { IVrmInstance } from '../../../assets/runtime/IVrmAsset';

interface IArmChain {
    upper: THREE.Object3D;
    lower: THREE.Object3D;
    hand: THREE.Object3D;
    baseUpperDir: THREE.Vector3;
    baseLowerDir: THREE.Vector3;
    upperLength: number;
    lowerLength: number;
    pole: THREE.Vector3;
    restUpperQuat: THREE.Quaternion;
    restLowerQuat: THREE.Quaternion;
    restHandQuat: THREE.Quaternion;
}

interface IProxyArmVisuals {
    upper: THREE.Mesh;
    lower: THREE.Mesh;
    wrist: THREE.Mesh;
}

const FINGER_BONE_MAP: Array<{ humanoid: HumanoidJointName; vrm: VRMHumanBoneName }> = [
    { humanoid: 'leftThumbMetacarpal', vrm: VRMHumanBoneName.LeftThumbMetacarpal },
    { humanoid: 'leftThumbProximal', vrm: VRMHumanBoneName.LeftThumbProximal },
    { humanoid: 'leftThumbDistal', vrm: VRMHumanBoneName.LeftThumbDistal },
    { humanoid: 'leftIndexProximal', vrm: VRMHumanBoneName.LeftIndexProximal },
    { humanoid: 'leftIndexIntermediate', vrm: VRMHumanBoneName.LeftIndexIntermediate },
    { humanoid: 'leftIndexDistal', vrm: VRMHumanBoneName.LeftIndexDistal },
    { humanoid: 'leftMiddleProximal', vrm: VRMHumanBoneName.LeftMiddleProximal },
    { humanoid: 'leftMiddleIntermediate', vrm: VRMHumanBoneName.LeftMiddleIntermediate },
    { humanoid: 'leftMiddleDistal', vrm: VRMHumanBoneName.LeftMiddleDistal },
    { humanoid: 'leftRingProximal', vrm: VRMHumanBoneName.LeftRingProximal },
    { humanoid: 'leftRingIntermediate', vrm: VRMHumanBoneName.LeftRingIntermediate },
    { humanoid: 'leftRingDistal', vrm: VRMHumanBoneName.LeftRingDistal },
    { humanoid: 'leftLittleProximal', vrm: VRMHumanBoneName.LeftLittleProximal },
    { humanoid: 'leftLittleIntermediate', vrm: VRMHumanBoneName.LeftLittleIntermediate },
    { humanoid: 'leftLittleDistal', vrm: VRMHumanBoneName.LeftLittleDistal },
    { humanoid: 'rightThumbMetacarpal', vrm: VRMHumanBoneName.RightThumbMetacarpal },
    { humanoid: 'rightThumbProximal', vrm: VRMHumanBoneName.RightThumbProximal },
    { humanoid: 'rightThumbDistal', vrm: VRMHumanBoneName.RightThumbDistal },
    { humanoid: 'rightIndexProximal', vrm: VRMHumanBoneName.RightIndexProximal },
    { humanoid: 'rightIndexIntermediate', vrm: VRMHumanBoneName.RightIndexIntermediate },
    { humanoid: 'rightIndexDistal', vrm: VRMHumanBoneName.RightIndexDistal },
    { humanoid: 'rightMiddleProximal', vrm: VRMHumanBoneName.RightMiddleProximal },
    { humanoid: 'rightMiddleIntermediate', vrm: VRMHumanBoneName.RightMiddleIntermediate },
    { humanoid: 'rightMiddleDistal', vrm: VRMHumanBoneName.RightMiddleDistal },
    { humanoid: 'rightRingProximal', vrm: VRMHumanBoneName.RightRingProximal },
    { humanoid: 'rightRingIntermediate', vrm: VRMHumanBoneName.RightRingIntermediate },
    { humanoid: 'rightRingDistal', vrm: VRMHumanBoneName.RightRingDistal },
    { humanoid: 'rightLittleProximal', vrm: VRMHumanBoneName.RightLittleProximal },
    { humanoid: 'rightLittleIntermediate', vrm: VRMHumanBoneName.RightLittleIntermediate },
    { humanoid: 'rightLittleDistal', vrm: VRMHumanBoneName.RightLittleDistal }
];

export class VrmAvatarView extends EntityView<IPlayerViewState> {
    public color: string | number;

    private readonly modelRoot: THREE.Group;
    private readonly nameTagComponent: NameTagComponent;
    private readonly voiceAudio: VoiceAudioComponent;
    private readonly fingerBones = new Map<HumanoidJointName, THREE.Object3D>();
    private readonly leftChain: IArmChain | null;
    private readonly rightChain: IArmChain | null;
    private readonly localProxyGroup = new THREE.Group();
    private readonly proxyMaterial: THREE.MeshBasicMaterial;
    private readonly leftProxy: IProxyArmVisuals;
    private readonly rightProxy: IProxyArmVisuals;
    private readonly tmpTargetPos = new THREE.Vector3();
    private readonly tmpYawEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    private readonly tmpYawQuat = new THREE.Quaternion();
    private readonly tmpWorldQuat = new THREE.Quaternion();
    private readonly tmpParentWorldQuat = new THREE.Quaternion();
    private readonly tmpWorldPosA = new THREE.Vector3();
    private readonly tmpWorldPosB = new THREE.Vector3();
    private readonly tmpWorldPosC = new THREE.Vector3();
    private readonly tmpWorldPosD = new THREE.Vector3();
    private readonly tmpLocalPos = new THREE.Vector3();
    private readonly tmpInvParentQuat = new THREE.Quaternion();
    private readonly tmpToTarget = new THREE.Vector3();
    private readonly tmpDir = new THREE.Vector3();
    private readonly tmpPlaneNormal = new THREE.Vector3();
    private readonly tmpBendDir = new THREE.Vector3();
    private readonly tmpElbow = new THREE.Vector3();
    private readonly tmpUpperDir = new THREE.Vector3();
    private readonly tmpLowerDir = new THREE.Vector3();
    private readonly tmpLowerLocalDir = new THREE.Vector3();
    private readonly tmpUpperQuat = new THREE.Quaternion();
    private readonly tmpLowerQuat = new THREE.Quaternion();
    private readonly tmpInvUpperQuat = new THREE.Quaternion();
    private readonly tmpCylinderStart = new THREE.Vector3();
    private readonly tmpCylinderEnd = new THREE.Vector3();
    private readonly tmpCylinderDir = new THREE.Vector3();
    private restHeadHeight = 1.6;
    private currentHeadHeight = 1.6;
    private currentHeadAnchorY = 1.6;
    private usingLocalProxy = false;

    constructor(
        private readonly context: AppContext,
        private readonly vrmInstance: IVrmInstance,
        {
            color = 0x00ffff,
            isLocal = false
        }: {
            color?: string | number;
            isLocal?: boolean;
        } = {}
    ) {
        super(new THREE.Group());
        this.color = color;
        this.modelRoot = vrmInstance.scene;
        this.mesh.add(this.modelRoot);

        this.proxyMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        this.leftProxy = this.createProxyArm();
        this.rightProxy = this.createProxyArm();
        this.localProxyGroup.visible = false;
        this.localProxyGroup.add(
            this.leftProxy.upper,
            this.leftProxy.lower,
            this.leftProxy.wrist,
            this.rightProxy.upper,
            this.rightProxy.lower,
            this.rightProxy.wrist
        );
        this.mesh.add(this.localProxyGroup);

        this.leftChain = this.createArmChain('left');
        this.rightChain = this.createArmChain('right');
        this.captureFingerBones();
        this.captureHeadMetrics();

        const headAnchor = this.vrmInstance.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head) || this.mesh;
        this.nameTagComponent = new NameTagComponent(this.mesh, () => this.currentHeadAnchorY, this.color);
        this.voiceAudio = new VoiceAudioComponent(headAnchor, this.context.runtime.render?.audioListener, isLocal);
    }

    public attachVoiceStream(stream: MediaStream): void {
        this.voiceAudio.attachVoiceStream(stream);
    }

    public attachAudioChunk(data: { chunk: string; isHeader: boolean } | string): void {
        this.voiceAudio.attachAudioChunk(data);
    }

    public setMuted(muted: boolean): void {
        this.voiceAudio.setMuted(muted);
    }

    public getAudioLevel(): number {
        return this.voiceAudio.getAudioLevel();
    }

    public applyState(state: IPlayerViewState, delta: number): void {
        const lerpFactor = state.lerpFactor ?? 1.0;

        if (state.position) {
            this.tmpTargetPos.set(state.position.x, state.position.y, state.position.z);
            if (lerpFactor < 1.0) {
                this.mesh.position.lerp(this.tmpTargetPos, lerpFactor);
            } else {
                this.mesh.position.copy(this.tmpTargetPos);
            }
        }

        if (state.yaw !== undefined) {
            if (lerpFactor < 1.0) {
                this.tmpYawEuler.set(0, state.yaw, 0, 'YXZ');
                this.tmpYawQuat.setFromEuler(this.tmpYawEuler);
                this.mesh.quaternion.slerp(this.tmpYawQuat, lerpFactor);
            } else {
                this.mesh.rotation.y = state.yaw;
            }
        }

        if (state.headHeight !== undefined) {
            const nextHeadHeight = lerpFactor < 1.0
                ? THREE.MathUtils.lerp(this.currentHeadHeight, state.headHeight, lerpFactor)
                : state.headHeight;
            this.currentHeadHeight = nextHeadHeight;
            const scale = this.restHeadHeight > 0.001 ? (nextHeadHeight / this.restHeadHeight) : 1;
            this.modelRoot.scale.setScalar(scale);
            this.currentHeadAnchorY = nextHeadHeight;
        }

        if (state.headQuaternion) {
            const headBone = this.vrmInstance.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
            if (headBone) {
                this.tmpWorldQuat.set(
                    state.headQuaternion.x,
                    state.headQuaternion.y,
                    state.headQuaternion.z,
                    state.headQuaternion.w
                );
                (headBone.parent || this.mesh).getWorldQuaternion(this.tmpParentWorldQuat);
                this.tmpParentWorldQuat.invert().multiply(this.tmpWorldQuat);
                if (lerpFactor < 1.0) {
                    headBone.quaternion.slerp(this.tmpParentWorldQuat, lerpFactor);
                } else {
                    headBone.quaternion.copy(this.tmpParentWorldQuat);
                }
            }
        }

        const leftWrist = state.humanoid?.joints['leftHand'];
        const rightWrist = state.humanoid?.joints['rightHand'];

        if (leftWrist && this.leftChain) {
            this.solveArm(this.leftChain, leftWrist.position, true, lerpFactor);
            this.applyWristOrientation(this.leftChain.hand, leftWrist.quaternion, lerpFactor);
        } else if (this.leftChain) {
            this.resetArm(this.leftChain, lerpFactor);
        }

        if (rightWrist && this.rightChain) {
            this.solveArm(this.rightChain, rightWrist.position, false, lerpFactor);
            this.applyWristOrientation(this.rightChain.hand, rightWrist.quaternion, lerpFactor);
        } else if (this.rightChain) {
            this.resetArm(this.rightChain, lerpFactor);
        }

        this.updateFingers(state, lerpFactor);
        this.updateLocalSelfView();

        if (this.usingLocalProxy) {
            this.updateLocalProxyVisuals();
        }

        if (state.audioLevel !== undefined) {
            this.vrmInstance.update(delta);
        }

        this._billboardNameTag();
        if (state.name !== undefined) {
            this.setName(state.name);
        }

        if (state.color !== undefined && state.color !== this.color) {
            this.setColor(state.color);
        }
    }

    public setColor(color: string | number): void {
        this.color = color;
        const colorObj = new THREE.Color(color as THREE.ColorRepresentation);
        this.proxyMaterial.color.copy(colorObj);
        this.nameTagComponent.setColor(color);
    }

    public setName(name: string): void {
        this.nameTagComponent.setName(name);
    }

    public destroy(): void {
        this._cleanupMesh();
        this.voiceAudio.destroy();
        this.nameTagComponent.destroy();
        this.proxyMaterial.dispose();
        this.vrmInstance.dispose();
    }

    private captureFingerBones(): void {
        for (const entry of FINGER_BONE_MAP) {
            const node = this.vrmInstance.humanoid.getNormalizedBoneNode(entry.vrm);
            if (node) {
                this.fingerBones.set(entry.humanoid, node);
                node.userData.vrmRestQuaternion = node.quaternion.clone();
            }
        }
    }

    private captureHeadMetrics(): void {
        const head = this.vrmInstance.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
        if (!head) return;

        this.modelRoot.updateMatrixWorld(true);
        this.mesh.getWorldPosition(this.tmpWorldPosA);
        head.getWorldPosition(this.tmpWorldPosB);
        this.restHeadHeight = Math.max(0.6, this.tmpWorldPosB.y - this.tmpWorldPosA.y);
        this.currentHeadHeight = this.restHeadHeight;
        this.currentHeadAnchorY = this.restHeadHeight;
    }

    private createArmChain(hand: 'left' | 'right'): IArmChain | null {
        const upper = this.vrmInstance.humanoid.getNormalizedBoneNode(
            hand === 'left' ? VRMHumanBoneName.LeftUpperArm : VRMHumanBoneName.RightUpperArm
        );
        const lower = this.vrmInstance.humanoid.getNormalizedBoneNode(
            hand === 'left' ? VRMHumanBoneName.LeftLowerArm : VRMHumanBoneName.RightLowerArm
        );
        const wrist = this.vrmInstance.humanoid.getNormalizedBoneNode(
            hand === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand
        );

        if (!upper || !lower || !wrist) {
            return null;
        }

        return {
            upper,
            lower,
            hand: wrist,
            baseUpperDir: lower.position.clone().normalize(),
            baseLowerDir: wrist.position.clone().normalize(),
            upperLength: Math.max(0.001, lower.position.length()),
            lowerLength: Math.max(0.001, wrist.position.length()),
            pole: new THREE.Vector3(hand === 'left' ? -1 : 1, 0, 0.35).normalize(),
            restUpperQuat: upper.quaternion.clone(),
            restLowerQuat: lower.quaternion.clone(),
            restHandQuat: wrist.quaternion.clone()
        };
    }

    private solveArm(chain: IArmChain, targetWorld: { x: number; y: number; z: number }, isLeft: boolean, lerpFactor: number): void {
        this.tmpTargetPos.set(targetWorld.x, targetWorld.y, targetWorld.z);
        const parentBone = chain.upper.parent;
        if (!parentBone) return;

        this.tmpTargetPos.applyMatrix4(this.mesh.matrixWorld);
        this.tmpInvParentQuat.identity();
        this.tmpTargetPos.applyMatrix4(new THREE.Matrix4().copy(parentBone.matrixWorld).invert());

        this.tmpToTarget.subVectors(this.tmpTargetPos, chain.upper.position);
        const rawDist = Math.max(0.0001, this.tmpToTarget.length());
        const maxReach = chain.upperLength + chain.lowerLength - 0.0001;
        const dist = Math.min(rawDist, maxReach);

        this.tmpDir.copy(this.tmpToTarget).normalize();
        this.tmpPlaneNormal.crossVectors(this.tmpDir, isLeft ? chain.pole : chain.pole);
        if (this.tmpPlaneNormal.lengthSq() < 1e-6) {
            this.tmpPlaneNormal.set(0, 0, 1);
        }
        this.tmpPlaneNormal.normalize();
        this.tmpBendDir.crossVectors(this.tmpPlaneNormal, this.tmpDir).normalize();

        const a = (chain.upperLength * chain.upperLength - chain.lowerLength * chain.lowerLength + dist * dist) / (2 * dist);
        const hSq = Math.max(0, chain.upperLength * chain.upperLength - a * a);
        const h = Math.sqrt(hSq);
        this.tmpElbow.copy(chain.upper.position)
            .addScaledVector(this.tmpDir, a)
            .addScaledVector(this.tmpBendDir, h);

        this.tmpUpperDir.subVectors(this.tmpElbow, chain.upper.position).normalize();
        this.tmpLowerDir.subVectors(this.tmpTargetPos, this.tmpElbow).normalize();

        this.tmpUpperQuat.setFromUnitVectors(chain.baseUpperDir, this.tmpUpperDir);
        this.tmpInvUpperQuat.copy(this.tmpUpperQuat).invert();
        this.tmpLowerLocalDir.copy(this.tmpLowerDir).applyQuaternion(this.tmpInvUpperQuat);
        this.tmpLowerQuat.setFromUnitVectors(chain.baseLowerDir, this.tmpLowerLocalDir);

        if (lerpFactor < 1.0) {
            chain.upper.quaternion.slerp(this.tmpUpperQuat, lerpFactor);
            chain.lower.quaternion.slerp(this.tmpLowerQuat, lerpFactor);
        } else {
            chain.upper.quaternion.copy(this.tmpUpperQuat);
            chain.lower.quaternion.copy(this.tmpLowerQuat);
        }
    }

    private applyWristOrientation(handBone: THREE.Object3D, worldQuat: { x: number; y: number; z: number; w: number }, lerpFactor: number): void {
        this.tmpWorldQuat.set(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w);
        (handBone.parent || this.mesh).getWorldQuaternion(this.tmpParentWorldQuat);
        this.tmpParentWorldQuat.invert().multiply(this.tmpWorldQuat);
        if (lerpFactor < 1.0) {
            handBone.quaternion.slerp(this.tmpParentWorldQuat, lerpFactor);
        } else {
            handBone.quaternion.copy(this.tmpParentWorldQuat);
        }
    }

    private resetArm(chain: IArmChain, lerpFactor: number): void {
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

    private updateFingers(state: IPlayerViewState, lerpFactor: number): void {
        const hasFingerData = !!state.humanoid?.joints.leftIndexTip || !!state.humanoid?.joints.rightIndexTip;

        for (const [humanoidName, bone] of this.fingerBones.entries()) {
            const pose = state.humanoid?.joints[humanoidName];
            if (!hasFingerData || !pose) {
                const rest = bone.userData.vrmRestQuaternion as THREE.Quaternion | undefined;
                if (rest) {
                    if (lerpFactor < 1.0) {
                        bone.quaternion.slerp(rest, lerpFactor);
                    } else {
                        bone.quaternion.copy(rest);
                    }
                }
                continue;
            }

            this.tmpWorldQuat.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
            (bone.parent || this.mesh).getWorldQuaternion(this.tmpParentWorldQuat);
            this.tmpParentWorldQuat.invert().multiply(this.tmpWorldQuat);
            if (lerpFactor < 1.0) {
                bone.quaternion.slerp(this.tmpParentWorldQuat, lerpFactor);
            } else {
                bone.quaternion.copy(this.tmpParentWorldQuat);
            }
        }
    }

    private updateLocalSelfView(): void {
        const shouldUseProxy = !!this.mesh.userData.isLocalAvatar && !!this.context.runtime.render?.isXRPresenting?.();
        if (this.usingLocalProxy === shouldUseProxy) return;

        this.usingLocalProxy = shouldUseProxy;
        this.modelRoot.visible = !shouldUseProxy;
        this.localProxyGroup.visible = shouldUseProxy;
    }

    private createProxyArm(): IProxyArmVisuals {
        const geo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);
        const wristGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);

        return {
            upper: new THREE.Mesh(geo, this.proxyMaterial),
            lower: new THREE.Mesh(geo.clone(), this.proxyMaterial),
            wrist: new THREE.Mesh(wristGeo, this.proxyMaterial)
        };
    }

    private updateLocalProxyVisuals(): void {
        if (this.leftChain) {
            this.leftChain.upper.parent?.getWorldPosition(this.tmpWorldPosA);
            this.leftChain.lower.getWorldPosition(this.tmpWorldPosB);
            this.leftChain.hand.getWorldPosition(this.tmpWorldPosC);
            this.alignProxySegment(this.leftProxy.upper, this.tmpWorldPosA, this.tmpWorldPosB);
            this.alignProxySegment(this.leftProxy.lower, this.tmpWorldPosB, this.tmpWorldPosC);
            this.positionProxyWrist(this.leftProxy.wrist, this.tmpWorldPosC);
        }

        if (this.rightChain) {
            this.rightChain.upper.parent?.getWorldPosition(this.tmpWorldPosA);
            this.rightChain.lower.getWorldPosition(this.tmpWorldPosB);
            this.rightChain.hand.getWorldPosition(this.tmpWorldPosC);
            this.alignProxySegment(this.rightProxy.upper, this.tmpWorldPosA, this.tmpWorldPosB);
            this.alignProxySegment(this.rightProxy.lower, this.tmpWorldPosB, this.tmpWorldPosC);
            this.positionProxyWrist(this.rightProxy.wrist, this.tmpWorldPosC);
        }
    }

    private alignProxySegment(mesh: THREE.Mesh, worldStart: THREE.Vector3, worldEnd: THREE.Vector3): void {
        this.tmpCylinderStart.copy(worldStart);
        this.tmpCylinderEnd.copy(worldEnd);
        this.mesh.worldToLocal(this.tmpCylinderStart);
        this.mesh.worldToLocal(this.tmpCylinderEnd);
        this.tmpCylinderDir.subVectors(this.tmpCylinderEnd, this.tmpCylinderStart);
        const length = this.tmpCylinderDir.length();
        if (length < 0.0001) {
            mesh.visible = false;
            return;
        }

        mesh.visible = true;
        mesh.scale.set(1, length, 1);
        mesh.position.copy(this.tmpCylinderStart).addScaledVector(this.tmpCylinderDir, 0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmpCylinderDir.normalize());
    }

    private positionProxyWrist(mesh: THREE.Mesh, worldPos: THREE.Vector3): void {
        this.tmpLocalPos.copy(worldPos);
        this.mesh.worldToLocal(this.tmpLocalPos);
        mesh.visible = true;
        mesh.position.copy(this.tmpLocalPos);
    }

    private _billboardNameTag(): void {
        this.nameTagComponent.faceCamera(this.context.runtime.render?.camera);
        this.nameTagComponent.updatePosition();
    }
}

