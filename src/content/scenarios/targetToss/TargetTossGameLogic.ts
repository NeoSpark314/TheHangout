import type { PhysicsPropEntity } from '../../../world/entities/PhysicsPropEntity';
import { BALL_DEFINITIONS } from './TargetTossConfig';
import type { IScoreFeedbackPayload, ITargetRuntime } from './TargetTossTypes';

export function evaluateSettledScores(params: {
    ballIds: readonly string[];
    scoredBallIds: ReadonlySet<string>;
    targets: readonly ITargetRuntime[];
    getBallEntity: (ballId: string) => PhysicsPropEntity | null;
}): Array<{ ballId: string; feedback: IScoreFeedbackPayload }> {
    const results: Array<{ ballId: string; feedback: IScoreFeedbackPayload }> = [];

    for (const ballId of params.ballIds) {
        if (params.scoredBallIds.has(ballId)) continue;

        const entity = params.getBallEntity(ballId);
        if (!entity) continue;

        const translation = entity.rigidBody.translation();
        const velocity = entity.rigidBody.linvel();
        const planarSpeed = Math.hypot(velocity.x, velocity.z);
        const verticalSpeed = Math.abs(velocity.y);
        const isSettled = entity.rigidBody.isSleeping() || (planarSpeed <= 0.42 && verticalSpeed <= 0.2);
        if (!isSettled) continue;
        if (translation.y > 0.42) continue;

        const feedback = resolveScoreFeedback(entity, params.targets);
        if (!feedback) continue;

        results.push({ ballId, feedback });
    }

    return results;
}

export function evaluateThrowProgress(params: {
    countedBallIds: Set<string>;
    getBallEntity: (ballId: string) => PhysicsPropEntity | null;
}): { changed: boolean; throwsTaken: number } {
    let changed = false;

    for (const ball of BALL_DEFINITIONS) {
        if (params.countedBallIds.has(ball.id)) continue;

        const entity = params.getBallEntity(ball.id);
        if (!entity) continue;

        const translation = entity.rigidBody.translation();
        const movedDistance = Math.hypot(
            translation.x - ball.position.x,
            translation.y - ball.position.y,
            translation.z - ball.position.z
        );
        const leftRackForward = translation.z < (ball.position.z - 1.15);
        if (!leftRackForward && movedDistance < 2.0) continue;

        params.countedBallIds.add(ball.id);
        changed = true;
    }

    return {
        changed,
        throwsTaken: params.countedBallIds.size
    };
}

function resolveScoreFeedback(
    entity: PhysicsPropEntity,
    targets: readonly ITargetRuntime[]
): IScoreFeedbackPayload | null {
    const translation = entity.rigidBody.translation();

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
