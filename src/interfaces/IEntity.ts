export interface IEntity {
    id: string;
    readonly type: string;
    isAuthority: boolean;
    destroyed: boolean;
    
    update(delta: number, frame?: any): void;
    destroy(): void;
}
