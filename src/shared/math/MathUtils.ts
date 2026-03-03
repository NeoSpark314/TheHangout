import { IVector3, IQuaternion } from '../contracts/IMath';

export class MathUtils {
    public static vec3(x = 0, y = 0, z = 0): IVector3 {
        return { x, y, z };
    }

    public static quat(x = 0, y = 0, z = 0, w = 1): IQuaternion {
        return { x, y, z, w };
    }

    public static copyVec3(v: IVector3): IVector3 {
        return { x: v.x, y: v.y, z: v.z };
    }

    public static addVec3(a: IVector3, b: IVector3): IVector3 {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    }

    public static subVec3(a: IVector3, b: IVector3): IVector3 {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    }

    public static mulVec3Scalar(v: IVector3, s: number): IVector3 {
        return { x: v.x * s, y: v.y * s, z: v.z * s };
    }

    public static lengthSqVec3(v: IVector3): number {
        return v.x * v.x + v.y * v.y + v.z * v.z;
    }

    public static normalizeVec3(v: IVector3): IVector3 {
        const l = Math.sqrt(this.lengthSqVec3(v));
        if (l === 0) return { x: 0, y: 0, z: 0 };
        return this.mulVec3Scalar(v, 1 / l);
    }

    public static lerpVec3(a: IVector3, b: IVector3, t: number): IVector3 {
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t
        };
    }

    // Basic rotation logic for movement (Yaw only)
    public static rotateVec3Yaw(v: IVector3, yaw: number): IVector3 {
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        return {
            x: v.x * cos + v.z * sin,
            y: v.y,
            z: -v.x * sin + v.z * cos
        };
    }
}
