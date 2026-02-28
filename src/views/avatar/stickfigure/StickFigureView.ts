import * as THREE from 'three';
import { EntityView } from '../../EntityView';
import { IVector3, IPose } from '../../../interfaces/IMath';
import { GameContext } from '../../../core/GameState';
import { HumanoidState } from '../../../models/HumanoidState';
import { NameTagComponent } from '../components/NameTagComponent';
import { VoiceAudioComponent } from '../components/VoiceAudioComponent';
import { StickFigureRig, StickFigureBones, StickFigureRigVisuals } from './StickFigureRig';
import { StickFigureHands } from './StickFigureHands';

export interface IPlayerViewState {
    position: IVector3;
    yaw: number;
    headHeight: number;
    headQuaternion: IPose['quaternion'];
    humanoid?: HumanoidState;
    name: string;
    color?: string | number;
    isLocal?: boolean;
    audioLevel?: number;
    lerpFactor?: number;
}

export class StickFigureView extends EntityView<IPlayerViewState> {
    public color: string | number;
    public isLocal: boolean;
    public headMesh!: THREE.Mesh;
    private currentHeadHeight: number = 1.7;

    private accentMaterial!: THREE.MeshBasicMaterial;
    private cyberMaterial!: THREE.MeshBasicMaterial;
    private darkMaterial!: THREE.MeshBasicMaterial;
    private featureMaterial!: THREE.MeshBasicMaterial;
    private headOutline!: THREE.LineSegments;
    private leftEye!: THREE.Mesh;
    private rightEye!: THREE.Mesh;
    private mouth!: THREE.Mesh;
    private torso!: THREE.Mesh;
    private neckJoint!: THREE.Mesh;
    private waistJoint!: THREE.Mesh;
    private leftKnee!: THREE.Mesh;
    private rightKnee!: THREE.Mesh;
    private leftShoulderJoint!: THREE.Mesh;
    private rightShoulderJoint!: THREE.Mesh;
    private leftElbowJoint!: THREE.Mesh;
    private rightElbowJoint!: THREE.Mesh;
    private leftLeg!: THREE.Mesh;
    private rightLeg!: THREE.Mesh;
    private leftLowerLegMesh!: THREE.Mesh;
    private rightLowerLegMesh!: THREE.Mesh;
    private shoulders!: THREE.Mesh;
    private pelvis!: THREE.Mesh;
    private leftUpperArm!: THREE.Mesh;
    private leftForearm!: THREE.Mesh;
    private rightUpperArm!: THREE.Mesh;
    private rightForearm!: THREE.Mesh;

    // Bone Hierarchy
    private skeleton!: THREE.Skeleton;
    private bones: Record<string, THREE.Bone> = {};

    private handMeshes: { left: THREE.Mesh[], right: THREE.Mesh[] } = { left: [], right: [] };
    private handCylinders: { left: THREE.Mesh[], right: THREE.Mesh[] } = { left: [], right: [] };
    private wristMeshes: { left: THREE.Mesh, right: THREE.Mesh };
    private nameTagComponent!: NameTagComponent;

    private voiceAudio!: VoiceAudioComponent;
    private rig!: StickFigureRig;
    private hands!: StickFigureHands;
    private readonly tmpTargetPos = new THREE.Vector3();
    private readonly tmpYawEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    private readonly tmpYawQuat = new THREE.Quaternion();
    private readonly tmpWorldHeadQuat = new THREE.Quaternion();
    private readonly tmpParentWorldQuat = new THREE.Quaternion();
    private readonly tmpLeftHandLocal = new THREE.Vector3();
    private readonly tmpRightHandLocal = new THREE.Vector3();
    private readonly defaultLeftTrackedTarget = new THREE.Vector3(-0.35, 0.95, 0.1);
    private readonly defaultRightTrackedTarget = new THREE.Vector3(0.35, 0.95, 0.1);
    private readonly defaultLeftRestTarget = new THREE.Vector3(-0.3, 0.9, 0);
    private readonly defaultRightRestTarget = new THREE.Vector3(0.3, 0.9, 0);

    constructor(private context: GameContext, { color = 0x00ffff, isLocal = false }: { color?: string | number, isLocal?: boolean } = {}) {
        super(new THREE.Group());
        this.color = color;
        this.isLocal = isLocal;

        // Initializing wrist meshes to avoid 'used before assigned' error, 
        // though _buildGeometry will re-assign them properly.
        const dummyGeom = new THREE.BoxGeometry(0.01, 0.01, 0.01);
        const dummyMat = new THREE.MeshBasicMaterial();
        this.wristMeshes = {
            left: new THREE.Mesh(dummyGeom, dummyMat),
            right: new THREE.Mesh(dummyGeom, dummyMat)
        };

        this._buildGeometry();
        this.nameTagComponent = new NameTagComponent(this.mesh, () => this.headMesh.position.y, this.color);
        this.voiceAudio = new VoiceAudioComponent(this.headMesh, this.context.managers.render?.audioListener, this.isLocal);
        this.rig = new StickFigureRig(
            this.mesh,
            this.bones as unknown as StickFigureBones,
            {
                headMesh: this.headMesh,
                torso: this.torso,
                shoulders: this.shoulders,
                pelvis: this.pelvis,
                leftLeg: this.leftLeg,
                leftLowerLegMesh: this.leftLowerLegMesh,
                rightLeg: this.rightLeg,
                rightLowerLegMesh: this.rightLowerLegMesh,
                leftUpperArm: this.leftUpperArm,
                leftForearm: this.leftForearm,
                rightUpperArm: this.rightUpperArm,
                rightForearm: this.rightForearm
            } as StickFigureRigVisuals,
            () => this._updateNameTagPosition()
        );
        this.hands = new StickFigureHands(this.mesh, this.wristMeshes, this.handMeshes, this.handCylinders);
    }

    public attachVoiceStream(stream: MediaStream): void {
        this.voiceAudio.attachVoiceStream(stream);
    }

    public attachAudioChunk(data: { chunk: string, isHeader: boolean } | string): void {
        this.voiceAudio.attachAudioChunk(data);
    }

    public setMuted(muted: boolean): void {
        this.voiceAudio.setMuted(muted);
    }

    public getAudioLevel(): number {
        return this.voiceAudio.getAudioLevel();
    }

    private _buildGeometry(): void {
        this.accentMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        this.cyberMaterial = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
        this.darkMaterial = new THREE.MeshBasicMaterial({ color: 0x050510 });
        this.featureMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

        const headSize = 0.3;
        const headDepth = 0.12;
        const headGeometry = new THREE.BoxGeometry(headSize, headSize, headDepth);
        headGeometry.translate(0, headSize / 2, 0);

        const faceMaterial = this.accentMaterial;
        const materials = [this.darkMaterial, this.darkMaterial, this.darkMaterial, this.darkMaterial, this.darkMaterial, faceMaterial];

        this.headMesh = new THREE.Mesh(headGeometry, materials);
        const headEdges = new THREE.EdgesGeometry(headGeometry);
        this.headOutline = new THREE.LineSegments(headEdges, new THREE.LineBasicMaterial({ color: this.color }));
        this.headMesh.add(this.headOutline);
        this.headMesh.position.y = 1.5;
        if (this.isLocal) this.headMesh.visible = false;
        this.mesh.add(this.headMesh);

        const eyeGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8);
        eyeGeom.rotateX(Math.PI / 2);
        this.leftEye = new THREE.Mesh(eyeGeom, this.featureMaterial);
        this.leftEye.position.set(-0.07, headSize * 0.7, -(headDepth / 2 + 0.01));
        this.headMesh.add(this.leftEye);
        this.rightEye = new THREE.Mesh(eyeGeom, this.featureMaterial);
        this.rightEye.position.set(0.07, headSize * 0.7, -(headDepth / 2 + 0.01));
        this.headMesh.add(this.rightEye);

        const mouthGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8);
        mouthGeom.rotateZ(Math.PI / 2);
        mouthGeom.rotateX(Math.PI / 2);
        this.mouth = new THREE.Mesh(mouthGeom, this.featureMaterial);
        this.mouth.position.set(0, headSize * 0.3, -(headDepth / 2 + 0.01));
        this.headMesh.add(this.mouth);

        const limbRadius = 0.025;
        const cylinderGeom = new THREE.CylinderGeometry(limbRadius, limbRadius, 1, 6);
        const jointGeom = new THREE.SphereGeometry(0.04, 8, 4);

        // --- BONE HIERARCHY ---
        const hips = new THREE.Bone();
        hips.name = 'hips';
        const spine = new THREE.Bone();
        spine.name = 'spine';
        const chest = new THREE.Bone();
        chest.name = 'chest';
        const neck = new THREE.Bone();
        neck.name = 'neck';
        const headBone = new THREE.Bone(); // We'll attach headMesh here
        headBone.name = 'head';

        const leftShoulder = new THREE.Bone();
        leftShoulder.name = 'leftShoulder';
        const leftUpperArm = new THREE.Bone();
        leftUpperArm.name = 'leftUpperArm';
        const leftLowerArm = new THREE.Bone();
        leftLowerArm.name = 'leftLowerArm';
        const leftHand = new THREE.Bone();
        leftHand.name = 'leftHand';

        const rightShoulder = new THREE.Bone();
        rightShoulder.name = 'rightShoulder';
        const rightUpperArm = new THREE.Bone();
        rightUpperArm.name = 'rightUpperArm';
        const rightLowerArm = new THREE.Bone();
        rightLowerArm.name = 'rightLowerArm';
        const rightHand = new THREE.Bone();
        rightHand.name = 'rightHand';

        const leftUpperLeg = new THREE.Bone();
        leftUpperLeg.name = 'leftUpperLeg';
        const leftLowerLeg = new THREE.Bone();
        leftLowerLeg.name = 'leftLowerLeg';
        const leftFoot = new THREE.Bone();
        leftFoot.name = 'leftFoot';

        const rightUpperLeg = new THREE.Bone();
        rightUpperLeg.name = 'rightUpperLeg';
        const rightLowerLeg = new THREE.Bone();
        rightLowerLeg.name = 'rightLowerLeg';
        const rightFoot = new THREE.Bone();
        rightFoot.name = 'rightFoot';

        // Build the tree
        hips.add(spine);
        hips.add(leftUpperLeg);
        hips.add(rightUpperLeg);

        spine.add(chest);
        chest.add(neck);
        neck.add(headBone);

        chest.add(leftShoulder);
        leftShoulder.add(leftUpperArm);
        leftUpperArm.add(leftLowerArm);
        leftLowerArm.add(leftHand);

        chest.add(rightShoulder);
        rightShoulder.add(rightUpperArm);
        rightUpperArm.add(rightLowerArm);
        rightLowerArm.add(rightHand);

        leftUpperLeg.add(leftLowerLeg);
        leftLowerLeg.add(leftFoot);

        rightUpperLeg.add(rightLowerLeg);
        rightLowerLeg.add(rightFoot);

        this.mesh.add(hips);

        this.bones = {
            hips, spine, chest, neck, head: headBone,
            leftShoulder, leftUpperArm, leftLowerArm, leftHand,
            rightShoulder, rightUpperArm, rightLowerArm, rightHand,
            leftUpperLeg, leftLowerLeg, leftFoot,
            rightUpperLeg, rightLowerLeg, rightFoot
        };

        const boneArray = Object.values(this.bones);
        this.skeleton = new THREE.Skeleton(boneArray);

        // --- ATTACH VISUAL MESHES TO BONES ---
        // Torso mapping
        this.torso = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        spine.add(this.torso);

        this.neckJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        neck.add(this.neckJoint);

        this.waistJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        hips.add(this.waistJoint);

        this.leftKnee = new THREE.Mesh(jointGeom, this.accentMaterial);
        leftLowerLeg.add(this.leftKnee);

        this.rightKnee = new THREE.Mesh(jointGeom, this.accentMaterial);
        rightLowerLeg.add(this.rightKnee);

        this.leftShoulderJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        leftUpperArm.add(this.leftShoulderJoint);

        this.rightShoulderJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        rightUpperArm.add(this.rightShoulderJoint);

        this.leftElbowJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        leftLowerArm.add(this.leftElbowJoint);

        this.rightElbowJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        rightLowerArm.add(this.rightElbowJoint);

        this.leftLeg = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        leftUpperLeg.add(this.leftLeg);

        this.leftLowerLegMesh = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        leftLowerLeg.add(this.leftLowerLegMesh);

        this.rightLeg = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        rightUpperLeg.add(this.rightLeg);

        this.rightLowerLegMesh = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        rightLowerLeg.add(this.rightLowerLegMesh);

        this.shoulders = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        chest.add(this.shoulders);

        this.pelvis = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        hips.add(this.pelvis);

        this.leftUpperArm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        leftUpperArm.add(this.leftUpperArm);

        this.leftForearm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        leftLowerArm.add(this.leftForearm);

        this.rightUpperArm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        rightUpperArm.add(this.rightUpperArm);

        this.rightForearm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        rightLowerArm.add(this.rightForearm);

        /**
         * The head mesh was previously attached to `this.mesh`. 
         * We now attach it directly directly to the root for absolute IK or the `headBone` if driven by forward IK.
         * For now, we will leave it attached to `this.mesh` to preserve the `updatePosture` lerping logic
         * until we fully transition to standard Forward Kinematics.
         */

        const handJointGeom = new THREE.SphereGeometry(0.006, 6, 4);
        const handLimbRadius = 0.003;
        const handCylinderGeom = new THREE.CylinderGeometry(handLimbRadius, handLimbRadius, 1, 4);

        const wristGeom = new THREE.BoxGeometry(0.03, 0.03, 0.03);
        this.wristMeshes = {
            left: new THREE.Mesh(wristGeom, this.accentMaterial),
            right: new THREE.Mesh(wristGeom, this.accentMaterial)
        };
        this.mesh.add(this.wristMeshes.left);
        this.mesh.add(this.wristMeshes.right);
        this.wristMeshes.left.visible = false;
        this.wristMeshes.right.visible = false;

        for (let i = 0; i < 25; i++) {
            const leftJoint = new THREE.Mesh(handJointGeom, this.accentMaterial);
            leftJoint.visible = false;
            this.mesh.add(leftJoint);
            this.handMeshes.left.push(leftJoint);
            const rightJoint = new THREE.Mesh(handJointGeom, this.accentMaterial);
            rightJoint.visible = false;
            this.mesh.add(rightJoint);
            this.handMeshes.right.push(rightJoint);
        }

        for (let i = 0; i < StickFigureHands.HAND_INDICES.length / 2; i++) {
            const leftCyl = new THREE.Mesh(handCylinderGeom, this.cyberMaterial);
            leftCyl.visible = false;
            this.mesh.add(leftCyl);
            this.handCylinders.left.push(leftCyl);
            const rightCyl = new THREE.Mesh(handCylinderGeom, this.cyberMaterial);
            rightCyl.visible = false;
            this.mesh.add(rightCyl);
            this.handCylinders.right.push(rightCyl);
        }
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
            const height = lerpFactor < 1.0
                ? THREE.MathUtils.lerp(this.currentHeadHeight, state.headHeight, lerpFactor)
                : state.headHeight;
            this.currentHeadHeight = height;
            this.rig.updatePosture(height);
        }

        if (state.headQuaternion) {
            // Incoming quaternion is world space. To make the mesh rotate correctly relative to parent:
            this.tmpWorldHeadQuat.set(state.headQuaternion.x, state.headQuaternion.y, state.headQuaternion.z, state.headQuaternion.w);
            this.mesh.getWorldQuaternion(this.tmpParentWorldQuat);
            this.tmpParentWorldQuat.invert().multiply(this.tmpWorldHeadQuat);

            if (lerpFactor < 1.0) {
                this.headMesh.quaternion.slerp(this.tmpParentWorldQuat, lerpFactor);
            } else {
                this.headMesh.quaternion.copy(this.tmpParentWorldQuat);
            }
        }

        // Logic works in WORLD SPACE, but rendering needs LOCAL SPACE relative to this.mesh (the avatar origin)
        // Ensure world matrix is up to date since we just potentially moved this.mesh
        // --- Update Arms & Hands using the HumanoidState ---
        if (state.humanoid && state.humanoid.joints) {
            const leftWrist = state.humanoid.joints['leftHand'];
            const rightWrist = state.humanoid.joints['rightHand'];

            if (leftWrist) {
                this.tmpLeftHandLocal.set(leftWrist.position.x, leftWrist.position.y, leftWrist.position.z);
                this.mesh.worldToLocal(this.tmpLeftHandLocal);
            } else {
                this.tmpLeftHandLocal.copy(this.defaultLeftTrackedTarget);
            }

            if (rightWrist) {
                this.tmpRightHandLocal.set(rightWrist.position.x, rightWrist.position.y, rightWrist.position.z);
                this.mesh.worldToLocal(this.tmpRightHandLocal);
            } else {
                this.tmpRightHandLocal.copy(this.defaultRightTrackedTarget);
            }

            this.rig.updateArms(this.tmpLeftHandLocal, this.tmpRightHandLocal);

            // Update Fingers & Wrist Markers
            this.hands.updateHumanoidHand('left', state.humanoid, lerpFactor);
            this.hands.updateHumanoidHand('right', state.humanoid, lerpFactor);
        } else {
            // Default rest pose
            this.rig.updateArms(this.defaultLeftRestTarget, this.defaultRightRestTarget);
            this.hands.updateHumanoidHand('left', undefined, lerpFactor);
            this.hands.updateHumanoidHand('right', undefined, lerpFactor);
        }
        if (state.audioLevel !== undefined) {
            const targetMouthScale = 1.0 + (state.audioLevel * 10.0);
            const animLerp = 0.5;
            this.mouth.scale.y = THREE.MathUtils.lerp(this.mouth.scale.y, targetMouthScale, animLerp);
            if (state.audioLevel < 0.05) {
                this.mouth.scale.y = 1.0;
            }
        }

        this._billboardNameTag();
        if (state.name !== undefined) {
            this.setName(state.name);
        }

        if (state.color !== undefined && state.color !== this.color) {
            this.setColor(state.color);
        }
    }

    private _billboardNameTag(): void {
        this.nameTagComponent.faceCamera(this.context.managers.render?.camera);
    }

    public setColor(color: string | number): void {
        this.color = color;
        const colorObj = new THREE.Color(color as any);
        this.accentMaterial.color.copy(colorObj);
        if (this.headOutline) (this.headOutline.material as THREE.LineBasicMaterial).color.copy(colorObj);
        this.nameTagComponent.setColor(color);
    }

    public setName(name: string): void {
        this.nameTagComponent.setName(name);
    }

    private _updateNameTagPosition(): void {
        this.nameTagComponent.updatePosition();
    }

    public getLeftWristMarkerPosition(): THREE.Vector3 {
        return this.hands.getWristMarkerPosition('left');
    }

    public getRightWristMarkerPosition(): THREE.Vector3 {
        return this.hands.getWristMarkerPosition('right');
    }

    public destroy(): void {
        this._cleanupMesh();
        this.voiceAudio.destroy();

        this.mesh.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.isMesh || (object as any).isLine || (object as any).isLineSegments) {
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach(mat => mat.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                }
            }
        });
        this.nameTagComponent.destroy();
    }
}
