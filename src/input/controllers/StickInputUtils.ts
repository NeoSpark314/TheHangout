export interface IStickShapeConfig {
    innerDeadzone: number;
    outerDeadzone: number;
    exponent: number;
}

export function shapeStickRadial(
    x: number,
    y: number,
    config: IStickShapeConfig
): { x: number; y: number } {
    const magnitude = Math.sqrt(x * x + y * y);
    if (magnitude <= config.innerDeadzone) {
        return { x: 0, y: 0 };
    }

    const safeOuter = Math.max(config.innerDeadzone + 0.0001, Math.min(1, config.outerDeadzone));
    const normalized = (Math.min(magnitude, safeOuter) - config.innerDeadzone) / (safeOuter - config.innerDeadzone);
    const curved = Math.pow(Math.max(0, Math.min(1, normalized)), config.exponent);
    const scale = curved / magnitude;

    return {
        x: x * scale,
        y: y * scale
    };
}
