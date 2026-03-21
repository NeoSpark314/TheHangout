import type { ISharedPropHandle } from '../../contracts/IObjectRuntimeContext';
import {
    BALL_DEFINITIONS,
    TARGET_TOSS_RESET_REST_PLANAR_SPEED_MAX,
    TARGET_TOSS_RESET_REST_VERTICAL_SPEED_MAX,
    TARGET_TOSS_SCORE_SETTLED_MAX_HEIGHT,
    TARGET_TOSS_SCORE_SETTLED_PLANAR_SPEED_MAX,
    TARGET_TOSS_SCORE_SETTLED_VERTICAL_SPEED_MAX,
    TARGET_TOSS_THROW_COUNT_FORWARD_OFFSET,
    TARGET_TOSS_THROW_COUNT_MIN_DISTANCE
} from './TargetTossConfig';
import type { IScoreFeedbackPayload, ITargetRuntime } from './TargetTossTypes';

export function evaluateSettledScores(params: {
    ballIds: readonly string[];
    scoredBallIds: ReadonlySet<string>;
    targets: readonly ITargetRuntime[];
    getBall: (ballId: string) => ISharedPropHandle | null;
}): Array<{ ballId: string; feedback: IScoreFeedbackPayload }> {
    const results: Array<{ ballId: string; feedback: IScoreFeedbackPayload }> = [];

    for (const ballId of params.ballIds) {
        if (params.scoredBallIds.has(ballId)) continue;

        const ball = params.getBall(ballId);
        const translation = ball?.getPosition();
        const velocity = ball?.getLinearVelocity();
        if (!ball || !translation || !velocity) continue;
        const planarSpeed = Math.hypot(velocity.x, velocity.z);
        const verticalSpeed = Math.abs(velocity.y);
        const isSettled = ball.isSleeping()
            || (planarSpeed <= TARGET_TOSS_SCORE_SETTLED_PLANAR_SPEED_MAX
                && verticalSpeed <= TARGET_TOSS_SCORE_SETTLED_VERTICAL_SPEED_MAX);
        if (!isSettled) continue;
        if (translation.y > TARGET_TOSS_SCORE_SETTLED_MAX_HEIGHT) continue;

        const feedback = resolveScoreFeedback(ball, params.targets);
        if (!feedback) continue;

        results.push({ ballId, feedback });
    }

    return results;
}

export function evaluateThrowProgress(params: {
    countedBallIds: Set<string>;
    getBall: (ballId: string) => ISharedPropHandle | null;
}): { changed: boolean; throwsTaken: number } {
    let changed = false;

    for (const ball of BALL_DEFINITIONS) {
        if (params.countedBallIds.has(ball.id)) continue;

        const ballHandle = params.getBall(ball.id);
        const translation = ballHandle?.getPosition();
        if (!translation) continue;
        const movedDistance = Math.hypot(
            translation.x - ball.position.x,
            translation.y - ball.position.y,
            translation.z - ball.position.z
        );
        const leftRackForward = translation.z < (ball.position.z - TARGET_TOSS_THROW_COUNT_FORWARD_OFFSET);
        if (!leftRackForward && movedDistance < TARGET_TOSS_THROW_COUNT_MIN_DISTANCE) continue;

        params.countedBallIds.add(ball.id);
        changed = true;
    }

    return {
        changed,
        throwsTaken: params.countedBallIds.size
    };
}

export function areAllCountedBallsAtRest(params: {
    countedBallIds: ReadonlySet<string>;
    getBall: (ballId: string) => ISharedPropHandle | null;
}): boolean {
    if (params.countedBallIds.size === 0) return false;

    for (const ballId of params.countedBallIds) {
        const ball = params.getBall(ballId);
        const velocity = ball?.getLinearVelocity();
        if (!ball || !velocity) return false;
        const planarSpeed = Math.hypot(velocity.x, velocity.z);
        const verticalSpeed = Math.abs(velocity.y);
        if (!ball.isSleeping()
            && (planarSpeed > TARGET_TOSS_RESET_REST_PLANAR_SPEED_MAX
                || verticalSpeed > TARGET_TOSS_RESET_REST_VERTICAL_SPEED_MAX)) {
            return false;
        }
    }

    return true;
}

function resolveScoreFeedback(
    ball: ISharedPropHandle,
    targets: readonly ITargetRuntime[]
): IScoreFeedbackPayload | null {
    const translation = ball.getPosition();
    if (!translation) return null;

    for (const target of targets) {
        const dx = translation.x - target.position.x;
        const dz = translation.z - target.position.z;
        const radialDistance = Math.hypot(dx, dz);

        for (const ring of target.rings) {
            if (radialDistance <= ring.radius) {
                return {
                    points: ring.points,
                    color: ring.color,
                    position: { x: translation.x, y: Math.max(translation.y, 0.08), z: translation.z }
                };
            }
        }
    }

    return null;
}
