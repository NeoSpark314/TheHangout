import * as THREE from 'three';

interface ISynthBlockMaterialOptions {
    topColor?: number;
    bottomColor?: number;
    edgeColor?: number;
    edgeThicknessWorld?: number;
    edgeFeatherWorld?: number;
    edgeIntensity?: number;
    rimIntensity?: number;
}

/**
 * Dedicated block-prop shader: explicit edge accent + synth gradient + cheap fake lighting.
 * Works with instanced meshes and does not rely on MeshStandardMaterial lighting behavior.
 */
export function createSynthBlockMaterial(options: ISynthBlockMaterialOptions = {}): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTopColor: { value: new THREE.Color(options.topColor ?? 0x2db6ff) },
            uBottomColor: { value: new THREE.Color(options.bottomColor ?? 0x09142f) },
            uEdgeColor: { value: new THREE.Color(options.edgeColor ?? 0xe0ffff) },
            uEdgeThicknessWorld: { value: options.edgeThicknessWorld ?? 0.02 },
            uEdgeFeatherWorld: { value: options.edgeFeatherWorld ?? 0.01 },
            uEdgeIntensity: { value: options.edgeIntensity ?? 0.95 },
            uRimIntensity: { value: options.rimIntensity ?? 0.2 }
        },
        vertexShader: `
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec3 vAxisWorldScale;

void main() {
    vec4 localPos = vec4(position, 1.0);
    mat4 localToWorld = modelMatrix;

    #ifdef USE_INSTANCING
    localToWorld = modelMatrix * instanceMatrix;
    #endif

    vec4 worldPos = localToWorld * localPos;
    vLocalPos = position;
    vWorldPos = worldPos.xyz;
    mat3 normalMatrixLocalToWorld = mat3(transpose(inverse(localToWorld)));
    vWorldNormal = normalize(normalMatrixLocalToWorld * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vAxisWorldScale = vec3(
        length(localToWorld[0].xyz),
        length(localToWorld[1].xyz),
        length(localToWorld[2].xyz)
    );

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
        `.trim(),
        fragmentShader: `
uniform vec3 uTopColor;
uniform vec3 uBottomColor;
uniform vec3 uEdgeColor;
uniform float uEdgeThicknessWorld;
uniform float uEdgeFeatherWorld;
uniform float uEdgeIntensity;
uniform float uRimIntensity;

varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec3 vAxisWorldScale;

float secondSmallest(vec3 v) {
    float mn = min(v.x, min(v.y, v.z));
    float mx = max(v.x, max(v.y, v.z));
    return v.x + v.y + v.z - mn - mx;
}

void main() {
    // BoxGeometry(1,1,1) local range: [-0.5, 0.5]
    vec3 distToFaceLocal = vec3(0.5) - abs(vLocalPos);
    vec3 distToFaceWorld = max(distToFaceLocal, vec3(0.0)) * max(vAxisWorldScale, vec3(0.0001));
    float edgeDist = secondSmallest(distToFaceWorld);
    float edgeMask = 1.0 - smoothstep(
        uEdgeThicknessWorld,
        uEdgeThicknessWorld + uEdgeFeatherWorld,
        edgeDist
    );

    float yT = clamp(vLocalPos.y + 0.5, 0.0, 1.0);
    vec3 base = mix(uBottomColor, uTopColor, yT);

    // Cheap synth variation by world-space position.
    float wave = sin(vWorldPos.x * 0.8 + vWorldPos.z * 0.6) * 0.5 + 0.5;
    base *= mix(0.9, 1.1, wave);

    vec3 lightDir = normalize(vec3(0.25, 1.0, 0.15));
    float ndotl = max(dot(normalize(vWorldNormal), lightDir), 0.0);
    float diffuse = 0.55 + ndotl * 0.45;
    vec3 color = base * diffuse;

    float rim = pow(1.0 - max(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0), 2.5);
    color += uEdgeColor * (rim * uRimIntensity);
    color = mix(color, max(color, uEdgeColor), clamp(edgeMask * uEdgeIntensity, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
        `.trim(),
        depthWrite: true,
        depthTest: true
    });
}
