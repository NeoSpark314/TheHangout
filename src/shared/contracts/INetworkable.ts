export interface INetworkable<TState> {
    ownerId: string | null;
    getNetworkState(fullSync?: boolean): TState | null;
    applyNetworkState(state: TState): void;
    onAuthorityChanged(isAuthority: boolean): void;
}
