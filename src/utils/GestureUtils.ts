import { IHandState } from '../interfaces/ITrackingProvider';

export class GestureUtils {
    // WebXR hand-joint indices used by the gesture helpers.
    private static readonly WRIST = 0;
    private static readonly THUMB_TIP = 4;
    private static readonly INDEX_TIP = 9;
    private static readonly FINGER_TIPS = [9, 14, 19, 24] as const;

    /**
     * Returns thumb-index tip distance in meters, or null if hand data is invalid/unavailable.
     */
    public static getPinchDistance(hand: IHandState): number | null {
        if (!hand.active || !hand.hasJoints || hand.joints.length < 10) return null;
        const thumbTip = hand.joints[this.THUMB_TIP].pose.position;
        const indexTip = hand.joints[this.INDEX_TIP].pose.position;

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
     * Counts curled fingers (index/middle/ring/pinky) based on tip-to-wrist distance.
     */
    public static getFistCurlCount(hand: IHandState, threshold: number = 0.095): number {
        if (!hand.active || !hand.hasJoints || hand.joints.length < 25) return 0;
        const wrist = hand.joints[this.WRIST].pose.position;
        if (wrist.x === 0 && wrist.y === 0 && wrist.z === 0) return 0;

        let closeCount = 0;
        const thresholdSq = threshold * threshold;
        for (const tipIdx of this.FINGER_TIPS) {
            const tip = hand.joints[tipIdx].pose.position;
            const dx = tip.x - wrist.x;
            const dy = tip.y - wrist.y;
            const dz = tip.z - wrist.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < thresholdSq) closeCount++;
        }
        return closeCount;
    }
}
