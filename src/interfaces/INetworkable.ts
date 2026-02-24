export interface INetworkable<TState> {
    ownerId: string | null;
    getNetworkState(): TState;
    applyNetworkState(state: TState): void;
    onAuthorityChanged(isAuthority: boolean): void;
}
