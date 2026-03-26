import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../app/AppContext';
import { ScenarioActionRuntime } from './ScenarioActionRuntime';
import type { IScenarioActionProvider } from '../contracts/IScenarioAction';

function createContext() {
    const context = new AppContext();
    const provider: IScenarioActionProvider = {
        getActions: vi.fn(() => [{
            id: 'reset',
            label: 'Reset',
            requiredRole: 'admin' as const,
            replicateToGuests: true,
            validatePayload: (payload: unknown): payload is { lane: number } =>
                !!payload && typeof (payload as { lane?: unknown }).lane === 'number'
        }]),
        executeAction: vi.fn((_actionId, payload) => ({
            ok: true,
            message: 'Reset queued',
            replicatedPayload: { ...(payload as object), normalized: true }
        }))
    };

    context.isHost = true;
    context.localPlayer = { id: 'host-peer' } as any;
    context.setRuntime('session', {
        getActiveScenario: () => ({
            id: 'simple-racing',
            displayName: 'Simple Racing',
            getActionProvider: () => provider
        }),
        getActiveScenarioContext: () => ({ id: 'ctx' })
    } as any);
    context.setRuntime('notify', {
        success: vi.fn(),
        warn: vi.fn()
    } as any);
    context.setRuntime('network', {
        localPeerId: 'host-peer'
    } as any);

    return { context, provider };
}

describe('ScenarioActionRuntime', () => {
    it('returns a replicated execute payload for successful host actions', () => {
        const { context, provider } = createContext();
        const runtime = new ScenarioActionRuntime(context);

        const outcome = runtime.executeHostRequest('host-peer', {
            scenarioId: 'simple-racing',
            actionId: 'reset',
            payload: { lane: 2 },
            requestId: 'req-1'
        });

        expect(outcome.ok).toBe(true);
        expect(outcome.resultPayload).toMatchObject({
            ok: true,
            actionId: 'reset',
            requestId: 'req-1',
            message: 'Reset queued'
        });
        expect(outcome.executePayload).toMatchObject({
            scenarioId: 'simple-racing',
            actionId: 'reset',
            payload: { lane: 2, normalized: true },
            initiatedByPeerId: 'host-peer'
        });
        expect(provider.executeAction).toHaveBeenCalledWith(
            'reset',
            { lane: 2 },
            expect.objectContaining({
                source: 'local_request',
                senderPeerId: 'host-peer',
                callerRole: 'admin'
            })
        );
    });

    it('executes replicated actions only for the active scenario', () => {
        const { context, provider } = createContext();
        const runtime = new ScenarioActionRuntime(context);

        runtime.handleReplicatedAction({
            scenarioId: 'wrong-scenario',
            actionId: 'reset',
            payload: { lane: 1 },
            initiatedByPeerId: 'guest-1'
        });

        expect(provider.executeAction).not.toHaveBeenCalled();

        runtime.handleReplicatedAction({
            scenarioId: 'simple-racing',
            actionId: 'reset',
            payload: { lane: 3 },
            initiatedByPeerId: 'guest-1'
        });

        expect(provider.executeAction).toHaveBeenCalledWith(
            'reset',
            { lane: 3 },
            expect.objectContaining({
                source: 'replicated',
                senderPeerId: 'guest-1'
            })
        );
    });

    it('emits success and warning notifications for action results', () => {
        const { context } = createContext();
        const runtime = new ScenarioActionRuntime(context);

        runtime.handleActionResult({
            scenarioId: 'simple-racing',
            actionId: 'reset',
            ok: true,
            message: 'Race reset'
        });
        runtime.handleActionResult({
            scenarioId: 'simple-racing',
            actionId: 'reset',
            ok: false,
            reason: 'Only host may reset'
        });

        expect(context.runtime.notify.success).toHaveBeenCalledWith('Race reset', {
            source: 'scenario-action',
            code: 'scenario_action.reset.ok'
        });
        expect(context.runtime.notify.warn).toHaveBeenCalledWith('Only host may reset', {
            source: 'scenario-action',
            code: 'scenario_action.reset.failed'
        });
    });
});
