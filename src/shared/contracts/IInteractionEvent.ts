import { IVector3 } from './IMath';

export type InteractionType = 'trigger' | 'grip' | 'primary' | 'secondary';
export type InteractionPhase = 'start' | 'update' | 'end';

/**
 * Encapsulates a rich interaction from a player (Desktop or VR).
 */
export interface IInteractionEvent {
    type: InteractionType;
    phase: InteractionPhase;
    value: number; // 0.0 to 1.0
    playerId: string;
    hand?: 'left' | 'right';
    position?: IVector3; // World position of the interaction point
}
