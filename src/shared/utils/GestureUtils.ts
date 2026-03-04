import { IHandState } from '../contracts/ITrackingProvider';
import { INPUT_CONFIG } from '../constants/Constants';

export interface IGestureLatchThresholds {
    on: number;
    off: number;
}

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

        return this.getDistance3D(thumbTip, indexTip);
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

    public static getDistance3D(a: { x: number, y: number, z: number }, b: { x: number, y: number, z: number }): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    public static updateDistanceLatch(
        latched: boolean,
        distance: number | null,
        thresholds: IGestureLatchThresholds = {
            on: INPUT_CONFIG.GESTURE.PINCH_ON_DISTANCE,
            off: INPUT_CONFIG.GESTURE.PINCH_OFF_DISTANCE
        }
    ): boolean {
        const isOn = distance !== null && distance < thresholds.on;
        const isOff = distance === null || distance > thresholds.off;

        if (latched) {
            return isOff ? false : true;
        }

        return isOn;
    }

    public static updateCountLatch(
        latched: boolean,
        count: number,
        onCount: number,
        offCount: number
    ): boolean {
        if (latched) {
            return count <= offCount ? false : true;
        }

        return count >= onCount;
    }
}
