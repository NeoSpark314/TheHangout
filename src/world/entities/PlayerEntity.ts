import { NetworkEntity } from './NetworkEntity';
import { GameContext } from '../../app/AppContext';
import { IPose } from '../../shared/contracts/IMath';

export abstract class PlayerEntity extends NetworkEntity {
    public static readonly DEFAULT_HEAD_HEIGHT = 1.7;
    public name: string = '';
    public headHeight: number = PlayerEntity.DEFAULT_HEAD_HEIGHT;
    public headState: IPose;
    public micEnabled: boolean = true;
    public audioLevel: number = 0;
    public isMuted: boolean = false;

    constructor(protected context: GameContext, id: string, type: string, isAuthority: boolean) {
        super(context, id, type, isAuthority);

        this.headState = {
            position: { x: 0, y: PlayerEntity.DEFAULT_HEAD_HEIGHT, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };
    }
}
