import * as THREE from 'three';

export interface IWaterOptions {
    uTime: THREE.IUniform;
    color?: string;
    foamColor?: string;
    opacity?: number;
}

/**
 * Creates a stylized cartoon water material for the nature park.
 */
export function createWaterMaterial(options: IWaterOptions): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: options.uTime,
            uColor: { value: new THREE.Color(options.color ?? '#1ca3ec') },
            uFoamColor: { value: new THREE.Color(options.foamColor ?? '#ffffff') },
            uOpacity: { value: options.opacity ?? 0.7 }
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            uniform float uTime;
            
            void main() {
                vUv = uv;
                vec3 pos = position;
                
                // Subtle wavy displacement
                float wave = sin(pos.x * 2.0 + uTime * 1.5) * 0.05;
                wave += cos(pos.y * 2.0 + uTime * 1.2) * 0.05;
                pos.z += wave;
                
                vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            uniform float uTime;
            uniform vec3 uColor;
            uniform vec3 uFoamColor;
            uniform float uOpacity;
            
            // Simple hash for noise
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }
            
            // Voronoi / Cellular Noise for "Toon" foam
            float voronoi(vec2 x) {
                vec2 n = floor(x);
                vec2 f = fract(x);
                float m = 8.0;
                for(int j=-1; j<=1; j++)
                for(int i=-1; i<=1; i++) {
                    vec2 g = vec2(float(i),float(j));
                    vec2 o = vec2(hash(n + g));
                    o = 0.5 + 0.5*sin(uTime + 6.2831*o);
                    float d = distance(g + o, f);
                    if(d < m) m = d;
                }
                return m;
            }

            void main() {
                // Domain warping: distort UVs over time
                vec2 uv = vWorldPosition.xz * 0.2;
                uv.x += sin(uv.y + uTime * 0.5) * 0.1;
                uv.y += cos(uv.x + uTime * 0.4) * 0.1;

                // Layered Voronoi for the "Toon" cells
                float v1 = voronoi(uv * 2.5 + uTime * 0.2);
                float v2 = voronoi(uv * 4.0 - uTime * 0.1);
                
                // Foam is the thin lines between cells
                float foam = step(0.9, 1.0 - v1) + step(0.92, 1.0 - v2);
                foam = min(1.0, foam);

                // Add a simple secondary specular shimmer
                float shimmer = step(0.98, sin(vWorldPosition.x * 5.0 + uTime * 2.0) * sin(vWorldPosition.z * 5.0 - uTime * 1.5) * 0.5 + 0.5);
                
                vec3 finalColor = mix(uColor, uFoamColor, max(foam * 0.3, shimmer * 0.6));
                
                gl_FragColor = vec4(finalColor, uOpacity);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false // Avoid sorting issues with the terrain
    });
}
