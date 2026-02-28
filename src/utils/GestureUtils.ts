import { IHandState } from '../interfaces/ITrackingProvider';

export class GestureUtils {
    public static getPinchDistance(hand: IHandState): number | null {
        if (!hand.active || !hand.hasJoints || hand.joints.length < 10) return null;
        const thumbTip = hand.joints[4].pose.position;
        const indexTip = hand.joints[9].pose.position;

        // Treat all-zero placeholders as invalid.
        if (thumbTip.x === 0 && thumbTip.y === 0 && thumbTip.z === 0 &&
            indexTip.x === 0 && indexTip.y === 0 && indexTip.z === 0) {
            return null;
        }

        const dx = thumbTip.x - indexTip.x;
        const dy = thumbTip.y - indexTip.y;
        const dz = thumbTip.z - indexTip.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Detects if the hand is performing a "pinch" gesture (thumb tip close to index tip).
     * @param hand The current hand state with skeletal joints
     * @returns true if pinching
     */
    public static isPinching(hand: IHandState): boolean {
        const pinchDist = this.getPinchDistance(hand);
        if (pinchDist === null) return false;
        if (pinchDist < 0.03) return true;

        // Fallback ratio check against wrist distance to adapt across hand sizes.
        const thumbTip = hand.joints[4].pose.position;
        const indexTip = hand.joints[9].pose.position;
        const wrist = hand.joints[0]?.pose.position;
        if (!wrist) return false;
        const twx = thumbTip.x - wrist.x;
        const twy = thumbTip.y - wrist.y;
        const twz = thumbTip.z - wrist.z;
        const iwx = indexTip.x - wrist.x;
        const iwy = indexTip.y - wrist.y;
        const iwz = indexTip.z - wrist.z;
        const thumbWrist = Math.sqrt(twx * twx + twy * twy + twz * twz);
        const indexWrist = Math.sqrt(iwx * iwx + iwy * iwy + iwz * iwz);
        const avgReach = (thumbWrist + indexWrist) * 0.5;

        // Pinch if tips are close relative to current hand scale.
        return avgReach > 0.0001 && pinchDist < avgReach * 0.35;
    }

    public static getFistCurlCount(hand: IHandState, threshold: number = 0.095): number {
        if (!hand.active || !hand.hasJoints || hand.joints.length < 25) return 0;
        const wrist = hand.joints[0].pose.position;
        if (wrist.x === 0 && wrist.y === 0 && wrist.z === 0) return 0;

        // Index, middle, ring, pinky tips
        const tips = [9, 14, 19, 24];
        let closeCount = 0;
        const thresholdSq = threshold * threshold;
        for (const tipIdx of tips) {
            const tip = hand.joints[tipIdx].pose.position;
            const dx = tip.x - wrist.x;
            const dy = tip.y - wrist.y;
            const dz = tip.z - wrist.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < thresholdSq) closeCount++;
        }
        return closeCount;
    }

    /**
     * Detects if the hand is performing a "fist" gesture (finger tips close to wrist).
     * This can be used to simulate a "squeeze" or "grab" intent.
     * @param hand The current hand state with skeletal joints
     * @returns true if forming a fist
     */
    public static isFist(hand: IHandState): boolean {
        return this.getFistCurlCount(hand) >= 3;
    }
}
