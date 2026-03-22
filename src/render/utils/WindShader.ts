import * as THREE from 'three';

export interface IWindOptions {
    uTime: THREE.IUniform;
    speed?: number;
    amplitude?: number;
    frequency?: number;
}

/**
 * Injects wind sway logic into a Three.js material using onBeforeCompile.
 * Works best with nature assets (trees, grass) where position.y represents height.
 */
export function applyWindSway(material: THREE.Material, options: IWindOptions): void {
    material.onBeforeCompile = (shader) => {
        // Add uniforms
        shader.uniforms.uTime = options.uTime;
        shader.uniforms.uWindSpeed = { value: options.speed ?? 1.2 };
        shader.uniforms.uWindAmplitude = { value: options.amplitude ?? 0.05 };
        shader.uniforms.uWindFrequency = { value: options.frequency ?? 0.5 };

        // Inject uniform declarations
        shader.vertexShader = `
            uniform float uTime;
            uniform float uWindSpeed;
            uniform float uWindAmplitude;
            uniform float uWindFrequency;
        ` + shader.vertexShader;

        // Modify vertex position
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            
            // Per-instance variation if using instancing
            vec3 variationPos = vec3(0.0);
            #ifdef USE_INSTANCING
                variationPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            #endif

            // Sway force increases with height (position.y).
            // We assume objects are roughly centered at origin y=0 at base.
            // We scale by 0.1 so that 10m height = 1.0 sway mult.
            float swayForce = max(0.0, position.y) * 0.1;
            
            float time = uTime * uWindSpeed;
            
            // Add some per-vertex noise to make the mesh look less rigid
            float vertexNoise = sin(position.x * 2.1 + position.z * 1.5 + time * 0.5) * 0.05;
            
            // Dual-axis movement
            float swayX = sin(time + variationPos.x * uWindFrequency + variationPos.z * 0.2) * uWindAmplitude * (swayForce + vertexNoise);
            float swayZ = cos(time * 0.73 + variationPos.z * uWindFrequency + variationPos.x * 0.31) * uWindAmplitude * (swayForce + vertexNoise);
            
            transformed.x += swayX;
            transformed.z += swayZ;
            `
        );
    };
    
    // Ensure material refreshes if this is called after initial compile (though usually called before)
    material.needsUpdate = true;
}
