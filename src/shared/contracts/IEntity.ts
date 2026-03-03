export interface IEntity {
    id: string;
    readonly type: string;
    isAuthority: boolean;
    isDestroyed: boolean;
    
    initialize?(config: any): void;
    update(delta: number, frame?: any): void;
    destroy(): void;
}
