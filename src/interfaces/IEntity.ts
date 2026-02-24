export interface IEntity {
    readonly id: string;
    readonly type: string;
    isAuthority: boolean;
    
    update(delta: number, frame?: any): void;
    destroy(): void;
}
