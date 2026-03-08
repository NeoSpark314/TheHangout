import * as THREE from 'three';

interface IBoxEdgeGlowOptions {
    edgeColor?: number;
    edgeThicknessWorld?: number;
    edgeFeatherWorld?: number;
    intensity?: number;
    faceContrast?: number;
    rimIntensity?: number;
}

type ShaderWithEdgeUniforms = {
    uniforms: {
        uEdgeColor: { value: THREE.Color };
        uHalfExtents: { value: THREE.Vector3 };
        uEdgeThicknessWorld: { value: number };
        uEdgeFeatherWorld: { value: number };
        uEdgeIntensity: { value: number };
        uWorldScale: { value: number };
        uFaceContrast: { value: number };
        uRimIntensity: { value: number };
    };
    vertexShader: string;
    fragmentShader: string;
};

/**
 * Adds a cheap synth-like edge glow to box meshes using object-space position.
 * This avoids extra line draw calls and keeps edge thickness stable in world space.
 */
export function applyBoxEdgeGlow(
    mesh: THREE.Mesh,
    material: THREE.MeshStandardMaterial,
    halfExtents: { x: number; y: number; z: number },
    options: IBoxEdgeGlowOptions = {}
): void {
    const edgeColor = new THREE.Color(options.edgeColor ?? 0xffffff);
    const edgeThicknessWorld = options.edgeThicknessWorld ?? 0.004;
    const edgeFeatherWorld = options.edgeFeatherWorld ?? 0.002;
    const intensity = options.intensity ?? 0.45;
    const faceContrast = options.faceContrast ?? 0.12;
    const rimIntensity = options.rimIntensity ?? 0.12;

    material.onBeforeCompile = (shader: unknown) => {
        const shaderWithUniforms = shader as ShaderWithEdgeUniforms;
        shaderWithUniforms.uniforms.uEdgeColor = { value: edgeColor };
        shaderWithUniforms.uniforms.uHalfExtents = {
            value: new THREE.Vector3(halfExtents.x, halfExtents.y, halfExtents.z)
        };
        shaderWithUniforms.uniforms.uEdgeThicknessWorld = { value: edgeThicknessWorld };
        shaderWithUniforms.uniforms.uEdgeFeatherWorld = { value: edgeFeatherWorld };
        shaderWithUniforms.uniforms.uEdgeIntensity = { value: intensity };
        shaderWithUniforms.uniforms.uWorldScale = { value: 1.0 };
        shaderWithUniforms.uniforms.uFaceContrast = { value: faceContrast };
        shaderWithUniforms.uniforms.uRimIntensity = { value: rimIntensity };

        shaderWithUniforms.vertexShader = shaderWithUniforms.vertexShader
            .replace(
                '#include <common>',
                `
#include <common>
varying vec3 vLocalPos;
                `.trim()
            )
            .replace(
                '#include <begin_vertex>',
                `
#include <begin_vertex>
vLocalPos = position;
                `.trim()
            );

        shaderWithUniforms.fragmentShader = shaderWithUniforms.fragmentShader
            .replace(
                '#include <common>',
                `
#include <common>
varying vec3 vLocalPos;
uniform vec3 uEdgeColor;
uniform vec3 uHalfExtents;
uniform float uEdgeThicknessWorld;
uniform float uEdgeFeatherWorld;
uniform float uEdgeIntensity;
uniform float uWorldScale;
uniform float uFaceContrast;
uniform float uRimIntensity;

float secondSmallest(vec3 v) {
    float mn = min(v.x, min(v.y, v.z));
    float mx = max(v.x, max(v.y, v.z));
    return v.x + v.y + v.z - mn - mx;
}
                `.trim()
            )
            .replace(
                '#include <output_fragment>',
                `
#include <output_fragment>
float safeScale = max(0.0001, uWorldScale);
float localThickness = uEdgeThicknessWorld / safeScale;
float localFeather = max(0.00001, uEdgeFeatherWorld / safeScale);
vec3 edgeDistances = max(uHalfExtents - abs(vLocalPos), vec3(0.0));
float nearestEdgeDistance = secondSmallest(edgeDistances);
float edgeMask = 1.0 - smoothstep(localThickness, localThickness + localFeather, nearestEdgeDistance);
float edgeBlend = clamp(edgeMask * uEdgeIntensity, 0.0, 1.0);
gl_FragColor.rgb = mix(gl_FragColor.rgb, max(gl_FragColor.rgb, uEdgeColor), edgeBlend);

float yNorm = clamp((vLocalPos.y / max(uHalfExtents.y, 0.0001)) * 0.5 + 0.5, 0.0, 1.0);
float faceShading = mix(1.0 - uFaceContrast, 1.0 + uFaceContrast, yNorm);
gl_FragColor.rgb *= faceShading;

vec3 viewDir = normalize(vViewPosition);
float rim = pow(1.0 - abs(dot(normalize(normal), viewDir)), 2.0);
gl_FragColor.rgb += uEdgeColor * (rim * uRimIntensity);
                `.trim()
            );

        material.userData._boxEdgeShader = shaderWithUniforms;
    };

    material.customProgramCacheKey = () =>
        `box-edge-glow:${halfExtents.x.toFixed(5)},${halfExtents.y.toFixed(5)},${halfExtents.z.toFixed(5)}`;

    const tmpScale = new THREE.Vector3();
    const previousOnBeforeRender = mesh.onBeforeRender;
    mesh.onBeforeRender = (renderer, scene, camera, geometry, mat, group) => {
        previousOnBeforeRender?.(renderer, scene, camera, geometry, mat, group);
        const shader = material.userData._boxEdgeShader as ShaderWithEdgeUniforms | undefined;
        if (!shader) return;
        mesh.getWorldScale(tmpScale);
        shader.uniforms.uWorldScale.value = Math.max(tmpScale.x, tmpScale.y, tmpScale.z);
    };

    material.needsUpdate = true;
}
