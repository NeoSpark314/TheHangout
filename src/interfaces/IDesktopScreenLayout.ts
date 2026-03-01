export interface IDesktopScreenLayout {
    position: [number, number, number];
    rotation?: [number, number, number, number]; // Quaternion
    scale?: [number, number, number];
    billboard?: boolean;
}
