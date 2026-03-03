import { ReplicatedEntity } from './ReplicatedEntity';
import { AppContext } from '../../app/AppContext';
import { IPose } from '../../shared/contracts/IMath';

export abstract class PlayerAvatarEntity extends ReplicatedEntity {
    public static readonly DEFAULT_HEAD_HEIGHT = 1.7;
    public name: string = '';
    public headHeight: number = PlayerAvatarEntity.DEFAULT_HEAD_HEIGHT;
    public headState: IPose;
    public micEnabled: boolean = true;
    public audioLevel: number = 0;
    public isMuted: boolean = false;

    constructor(protected context: AppContext, id: string, type: string, isAuthority: boolean) {
        super(context, id, type, isAuthority);

        this.headState = {
            position: { x: 0, y: PlayerAvatarEntity.DEFAULT_HEAD_HEIGHT, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };
    }
}
