import type { AppContext } from '../../app/AppContext';
import type {
    IScenarioActionExecutePayload,
    IScenarioActionRequestPayload,
    IScenarioActionResultPayload
} from '../../shared/contracts/INetworkPacket';
import type {
    IScenarioActionDefinition,
    IScenarioActionExecutionContext,
    IScenarioActionProvider,
    IScenarioActionQueryContext,
    IScenarioActionView,
    TScenarioActionRole
} from '../contracts/IScenarioAction';

interface IScenarioActionHostOutcome {
    ok: boolean;
    resultPayload: IScenarioActionResultPayload;
    executePayload?: IScenarioActionExecutePayload;
}

export class ScenarioActionRuntime {
    constructor(private context: AppContext) { }

    public listActions(): IScenarioActionView[] {
        const scenario = this.context.runtime.session.getActiveScenario();
        const provider = scenario.getActionProvider?.();
        if (!provider) return [];

        const queryContext = this.createQueryContext();
        return provider.getActions(queryContext).map((action) => this.toView(action, queryContext));
    }

    public executeHostRequest(senderPeerId: string | null, request: IScenarioActionRequestPayload): IScenarioActionHostOutcome {
        const activeScenario = this.context.runtime.session.getActiveScenario();
        if (request.scenarioId !== activeScenario.id) {
            return {
                ok: false,
                resultPayload: {
                    scenarioId: request.scenarioId,
                    actionId: request.actionId,
                    ok: false,
                    reason: `Action rejected: scenario mismatch (active=${activeScenario.id}).`,
                    requestId: request.requestId
                }
            };
        }

        const provider = activeScenario.getActionProvider?.();
        if (!provider) {
            return {
                ok: false,
                resultPayload: {
                    scenarioId: request.scenarioId,
                    actionId: request.actionId,
                    ok: false,
                    reason: `Scenario "${activeScenario.displayName}" does not expose actions.`,
                    requestId: request.requestId
                }
            };
        }

        const queryContext = this.createQueryContext(senderPeerId);
        const definition = this.findActionDefinition(provider, request.actionId, queryContext);
        if (!definition) {
            return {
                ok: false,
                resultPayload: {
                    scenarioId: request.scenarioId,
                    actionId: request.actionId,
                    ok: false,
                    reason: `Unknown scenario action: ${request.actionId}`,
                    requestId: request.requestId
                }
            };
        }

        if (definition.validatePayload && !definition.validatePayload(request.payload)) {
            return {
                ok: false,
                resultPayload: {
                    scenarioId: request.scenarioId,
                    actionId: request.actionId,
                    ok: false,
                    reason: 'Action rejected: invalid payload.',
                    requestId: request.requestId
                }
            };
        }

        const requiredRole = definition.requiredRole;
        if (!this.hasRole(queryContext.callerRole, requiredRole)) {
            return {
                ok: false,
                resultPayload: {
                    scenarioId: request.scenarioId,
                    actionId: definition.id,
                    ok: false,
                    reason: `Action requires ${requiredRole} role (caller=${queryContext.callerRole}).`,
                    requestId: request.requestId
                }
            };
        }

        const actionContext: IScenarioActionExecutionContext = {
            ...queryContext,
            source: senderPeerId === this.getLocalPeerId() ? 'local_request' : 'remote_request',
            senderPeerId
        };
        const execution = provider.executeAction(definition.id, request.payload, actionContext);
        if (!execution.ok) {
            return {
                ok: false,
                resultPayload: {
                    scenarioId: request.scenarioId,
                    actionId: definition.id,
                    ok: false,
                    reason: execution.reason || 'Action failed.',
                    requestId: request.requestId
                }
            };
        }

        let executePayload: IScenarioActionExecutePayload | undefined;
        if (definition.replicateToGuests) {
            executePayload = {
                scenarioId: request.scenarioId,
                actionId: definition.id,
                payload: execution.replicatedPayload ?? request.payload,
                initiatedByPeerId: senderPeerId ?? undefined,
                sentAt: this.nowMs()
            };
        }

        return {
            ok: true,
            executePayload,
            resultPayload: {
                scenarioId: request.scenarioId,
                actionId: definition.id,
                ok: true,
                message: execution.message,
                requestId: request.requestId
            }
        };
    }

    public handleReplicatedAction(payload: IScenarioActionExecutePayload): void {
        const activeScenario = this.context.runtime.session.getActiveScenario();
        if (payload.scenarioId !== activeScenario.id) return;

        const provider = activeScenario.getActionProvider?.();
        if (!provider) return;

        const queryContext = this.createQueryContext(payload.initiatedByPeerId ?? null);
        const definition = this.findActionDefinition(provider, payload.actionId, queryContext);
        if (!definition) return;

        const actionContext: IScenarioActionExecutionContext = {
            ...queryContext,
            source: 'replicated',
            senderPeerId: payload.initiatedByPeerId ?? null
        };
        const execution = provider.executeAction(definition.id, payload.payload, actionContext);
        if (!execution.ok) {
            console.warn(`[ScenarioActionRuntime] Replicated action failed: ${definition.id} (${execution.reason || 'unknown'})`);
        }
    }

    public handleActionResult(payload: IScenarioActionResultPayload): void {
        if (payload.ok) {
            if (payload.message) {
                this.context.runtime.notify.success(payload.message, {
                    source: 'scenario-action',
                    code: `scenario_action.${payload.actionId}.ok`
                });
            }
            return;
        }

        this.context.runtime.notify.warn(payload.reason || 'Scenario action failed.', {
            source: 'scenario-action',
            code: `scenario_action.${payload.actionId}.failed`
        });
    }

    private createQueryContext(callerPeerId: string | null = this.getLocalPeerId()): IScenarioActionQueryContext {
        return {
            app: this.context,
            session: this.context.runtime.session,
            isHost: this.context.isHost,
            localPeerId: this.getLocalPeerId(),
            callerRole: this.resolveCallerRole(callerPeerId)
        };
    }

    private findActionDefinition(
        provider: IScenarioActionProvider,
        actionId: string,
        queryContext: IScenarioActionQueryContext
    ): IScenarioActionDefinition | undefined {
        return provider.getActions(queryContext).find((action) => action.id === actionId);
    }

    private toView(action: IScenarioActionDefinition, queryContext: IScenarioActionQueryContext): IScenarioActionView {
        const availableByScenario = action.isAvailable ? action.isAvailable(queryContext) : true;
        const requiredRole = action.requiredRole;
        const blockedByRole = !this.hasRole(queryContext.callerRole, requiredRole);
        const available = availableByScenario && !blockedByRole;

        return {
            id: action.id,
            label: action.label,
            description: action.description,
            requiredRole,
            callerRole: queryContext.callerRole,
            dangerous: !!action.dangerous,
            available,
            disabledReason: !availableByScenario
                ? 'Unavailable in current scenario state.'
                : (blockedByRole ? `Requires ${requiredRole} role.` : undefined)
        };
    }

    private resolveCallerRole(callerPeerId: string | null): TScenarioActionRole {
        if (this.context.isDedicatedHost) {
            // Current dedicated-session default policy: all connected participants are moderators.
            if (callerPeerId && callerPeerId !== this.getLocalPeerId()) {
                return 'moderator';
            }
            return 'admin';
        }

        if (this.context.isHost) {
            return 'admin';
        }

        if (this.context.isLocalServer) {
            return 'moderator';
        }

        return 'guest';
    }

    private hasRole(callerRole: TScenarioActionRole, requiredRole: TScenarioActionRole): boolean {
        const rank: Record<TScenarioActionRole, number> = {
            guest: 0,
            moderator: 1,
            admin: 2
        };
        return rank[callerRole] >= rank[requiredRole];
    }

    private getLocalPeerId(): string | null {
        if (this.context.localPlayer?.id) return this.context.localPlayer.id;

        const network = this.context.runtime.network as unknown as {
            localPeerId?: string | null;
            peer?: { id?: string } | null;
        };

        if (network.localPeerId) return network.localPeerId;
        if (network.peer?.id) return network.peer.id;
        return null;
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}
