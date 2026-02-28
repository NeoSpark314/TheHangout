import { IHandState } from '../entities/PlayerEntity';

export class GestureUtils {
    /**
     * Detects if the hand is performing a "pinch" gesture (thumb tip close to index tip).
     * @param hand The current hand state with skeletal joints
     * @returns true if pinching
     */
    public static isPinching(hand: IHandState): boolean {
        if (!hand.active || !hand.hasJoints || hand.joints.length < 10) return false;

        const thumbTip = hand.joints[4].position;
        const indexTip = hand.joints[9].position;

        const dx = thumbTip.x - indexTip.x;
        const dy = thumbTip.y - indexTip.y;
        const dz = thumbTip.z - indexTip.z;

        const distSq = dx * dx + dy * dy + dz * dz;
        // Threshold: 0.02 meters (2cm)
        return distSq < 0.0004;
    }

    /**
     * Detects if the hand is performing a "fist" gesture (finger tips close to wrist).
     * This can be used to simulate a "squeeze" or "grab" intent.
     * @param hand The current hand state with skeletal joints
     * @returns true if forming a fist
     */
    public static isFist(hand: IHandState): boolean {
        if (!hand.active || !hand.hasJoints || hand.joints.length < 25) return false;

        const wrist = hand.joints[0].position;
        // Check Index, Middle, Ring, Pinky tips
        const tips = [9, 14, 19, 24];

        let closeCount = 0;
        for (const tipIdx of tips) {
            const tip = hand.joints[tipIdx].position;
            const dx = tip.x - wrist.x;
            const dy = tip.y - wrist.y;
            const dz = tip.z - wrist.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            // Threshold: 0.08 meters (8cm) from tip to wrist
            if (distSq < 0.0064) {
                closeCount++;
            }
        }

        // If 3 or more fingers are curled in, it's a fist
        return closeCount >= 3;
    }
}
