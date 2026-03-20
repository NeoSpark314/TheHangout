import type {
    IScenarioActionDefinition,
    IScenarioActionExecutionContext,
    IScenarioActionExecutionResult,
    IScenarioActionProvider,
    IScenarioActionQueryContext
} from '../../contracts/IScenarioAction';
import type { TargetTossScenario } from './TargetTossScenario';

export class TargetTossActionProvider implements IScenarioActionProvider {
    private static readonly ACTION_RESET_GAME = 'reset-game';

    constructor(private readonly scenario: TargetTossScenario) { }

    public getActions(_context: IScenarioActionQueryContext): IScenarioActionDefinition[] {
        return [
            {
                id: TargetTossActionProvider.ACTION_RESET_GAME,
                label: 'Reset Game',
                description: 'Reset scores, reset balls, and start over from the first player.',
                requiredRole: 'moderator',
                dangerous: true,
                replicateToGuests: false
            }
        ];
    }

    public executeAction(
        actionId: string,
        _payload: unknown,
        context: IScenarioActionExecutionContext
    ): IScenarioActionExecutionResult {
        if (actionId !== TargetTossActionProvider.ACTION_RESET_GAME) {
            return { ok: false, reason: `Unsupported action: ${actionId}` };
        }

        if (context.source === 'replicated') {
            return { ok: true };
        }

        this.scenario.resetGame();
        return { ok: true, message: 'Target Toss reset.' };
    }
}
