import * as THREE from 'three';

export interface ITwoBoneIkChain {
    rigRoot: THREE.Object3D;
    upper: THREE.Object3D;
    targetLocalPosition: THREE.Vector3;
    baseUpperDirection: THREE.Vector3;
    baseLowerDirection: THREE.Vector3;
    upperLength: number;
    lowerLength: number;
    pole: THREE.Vector3;
    allowStretch?: boolean;
}

export interface ITwoBoneIkResult {
    upperQuaternion: THREE.Quaternion;
    lowerQuaternion: THREE.Quaternion;
    upperLength: number;
    lowerLength: number;
}

export class TwoBoneIkSolver {
    private readonly tmpTargetInParent = new THREE.Vector3();
    private readonly tmpParentInverse = new THREE.Matrix4();
    private readonly tmpUpperPos = new THREE.Vector3();
    private readonly tmpToTarget = new THREE.Vector3();
    private readonly tmpDirection = new THREE.Vector3();
    private readonly tmpPlaneNormal = new THREE.Vector3();
    private readonly tmpBendDirection = new THREE.Vector3();
    private readonly tmpElbow = new THREE.Vector3();
    private readonly tmpUpperDirection = new THREE.Vector3();
    private readonly tmpLowerDirection = new THREE.Vector3();
    private readonly tmpInverseUpperQuat = new THREE.Quaternion();
    private readonly tmpLowerLocalDirection = new THREE.Vector3();

    public solve(chain: ITwoBoneIkChain, out: ITwoBoneIkResult): void {
        const parent = chain.upper.parent;
        this.tmpTargetInParent.copy(chain.targetLocalPosition);

        if (parent) {
            this.tmpTargetInParent.applyMatrix4(chain.rigRoot.matrixWorld);
            this.tmpParentInverse.copy(parent.matrixWorld).invert();
            this.tmpTargetInParent.applyMatrix4(this.tmpParentInverse);
        }

        let upperLength = chain.upperLength;
        let lowerLength = chain.lowerLength;

        this.tmpUpperPos.copy(chain.upper.position);
        this.tmpToTarget.subVectors(this.tmpTargetInParent, this.tmpUpperPos);
        const rawDistance = Math.max(0.0001, this.tmpToTarget.length());

        if (chain.allowStretch) {
            const nominalReach = upperLength + lowerLength;
            if (rawDistance > nominalReach) {
                const stretch = rawDistance / nominalReach;
                upperLength *= stretch;
                lowerLength *= stretch;
            }
        }

        const maxReach = upperLength + lowerLength - 0.0001;
        const clampedDistance = Math.min(rawDistance, maxReach);
        this.tmpDirection.copy(this.tmpToTarget).multiplyScalar(1 / rawDistance);

        this.tmpPlaneNormal.crossVectors(this.tmpDirection, chain.pole);
        if (this.tmpPlaneNormal.lengthSq() < 1e-6) {
            this.tmpPlaneNormal.set(0, 0, 1);
        }
        this.tmpPlaneNormal.normalize();
        this.tmpBendDirection.crossVectors(this.tmpPlaneNormal, this.tmpDirection).normalize();

        const elbowDistance = (
            (upperLength * upperLength - lowerLength * lowerLength + clampedDistance * clampedDistance) /
            (2 * clampedDistance)
        );
        const bendHeightSq = Math.max(0, upperLength * upperLength - elbowDistance * elbowDistance);
        const bendHeight = Math.sqrt(bendHeightSq);
        this.tmpElbow.copy(this.tmpUpperPos)
            .addScaledVector(this.tmpDirection, elbowDistance)
            .addScaledVector(this.tmpBendDirection, bendHeight);

        this.tmpUpperDirection.subVectors(this.tmpElbow, this.tmpUpperPos).normalize();
        this.tmpLowerDirection.subVectors(this.tmpTargetInParent, this.tmpElbow).normalize();

        out.upperQuaternion.setFromUnitVectors(chain.baseUpperDirection, this.tmpUpperDirection);
        this.tmpInverseUpperQuat.copy(out.upperQuaternion).invert();
        this.tmpLowerLocalDirection.copy(this.tmpLowerDirection).applyQuaternion(this.tmpInverseUpperQuat);
        out.lowerQuaternion.setFromUnitVectors(chain.baseLowerDirection, this.tmpLowerLocalDirection);
        out.upperLength = upperLength;
        out.lowerLength = lowerLength;
    }
}
