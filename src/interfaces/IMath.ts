export interface IVector3 {
    x: number;
    y: number;
    z: number;
}

export interface IQuaternion {
    x: number;
    y: number;
    z: number;
    w: number;
}

export interface IPose {
    position: IVector3;
    quaternion: IQuaternion;
}
