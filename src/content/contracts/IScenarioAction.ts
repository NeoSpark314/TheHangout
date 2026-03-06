import type { AppContext } from '../../app/AppContext';
import type { SessionRuntime } from '../../world/session/SessionRuntime';

export type TScenarioActionExecutionSource = 'local_request' | 'remote_request' | 'replicated';
export type TScenarioActionRole = 'guest' | 'moderator' | 'admin';

export interface IScenarioActionQueryContext {
    app: AppContext;
    session: SessionRuntime;
    isHost: boolean;
    localPeerId: string | null;
    callerRole: TScenarioActionRole;
}

export interface IScenarioActionExecutionContext extends IScenarioActionQueryContext {
    source: TScenarioActionExecutionSource;
    senderPeerId: string | null;
}

export interface IScenarioActionDefinition<TPayload = unknown> {
    id: string;
    label: string;
    description?: string;
    requiredRole?: TScenarioActionRole;
    // Legacy compatibility: if true/omitted, maps to requiredRole='admin'.
    // if false, maps to requiredRole='moderator'.
    hostOnly?: boolean;
    dangerous?: boolean;
    replicateToGuests?: boolean;
    isAvailable?(context: IScenarioActionQueryContext): boolean;
    validatePayload?(payload: unknown): payload is TPayload;
}

export interface IScenarioActionExecutionResult {
    ok: boolean;
    reason?: string;
    message?: string;
    replicatedPayload?: unknown;
}

export interface IScenarioActionProvider {
    getActions(context: IScenarioActionQueryContext): IScenarioActionDefinition[];
    executeAction(
        actionId: string,
        payload: unknown,
        context: IScenarioActionExecutionContext
    ): IScenarioActionExecutionResult;
}

export interface IScenarioActionView {
    id: string;
    label: string;
    description?: string;
    requiredRole: TScenarioActionRole;
    callerRole: TScenarioActionRole;
    dangerous: boolean;
    available: boolean;
    disabledReason?: string;
}
