# Coordinate Conventions

This document defines the axis conventions used by TheHangout for WebXR tracking, internal avatar solving, and VRM rendering.

The goal is to keep the system simple:

- keep raw XR and engine data in the native WebXR basis
- keep the canonical avatar rig in the VRM 1.0 basis
- convert between those spaces exactly once at the boundary

## Summary

### WebXR reference spaces

WebXR reference spaces use:

- `+X` = right
- `+Y` = up
- `-Z` = forward

Reference:

- W3C WebXR Device API, section on `XRReferenceSpace`: <https://www.w3.org/TR/webxr/#spaces>
- MDN Reference spaces docs: https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Geometry#reference_spaces

Relevant wording from the spec:

- `+X` is considered "Right"
- `+Y` is considered "Up"
- `-Z` is considered "Forward"

The WebXR input model also uses `-Z` as the pointing direction for `targetRaySpace`:

- <https://www.w3.org/TR/webxr/#xrinputsource-interface>

### VRM 1.0 T-pose / avatar model space

VRM 1.0 T-pose uses:

- `+Y` = up
- `+Z` = avatar forward
- `+X` = avatar left
- `-X` = avatar right

References:

- VRM 1.0 T-pose spec: <https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/tpose.md>
- VRM docs noting the 1.0 forward change from `z- forward` to `z+ forward`: <https://vrm.dev/en/vrm/vrm_features/>
- VRM 1.0 glTF details: <https://vrm.dev/en/vrm/gltf/vrm10_details/>

Important consequence:

- in world/XR space, `+X` means world-right
- in VRM avatar/model space, `+X` means the character's left side

This is expected and not a contradiction. They are different spaces.

## Project Spaces

The codebase uses three practical spaces:

### 1. Raw tracking / engine world space

This is the space used by WebXR and by raw engine transforms coming from Three.js cameras, controllers, and XR poses.

Convention:

- `+X` right
- `+Y` up
- `-Z` forward

Examples:

- raw HMD pose
- raw controller `gripSpace`
- raw controller `targetRaySpace`
- raw `camera` / `cameraGroup` world transforms

### 2. Canonical avatar space

This is the internal avatar-solving space used by the canonical rest rig, motion solver, facing resolver, humanoid pose generation, and renderer-independent avatar logic.

Convention:

- `+X` character-left
- `+Y` up
- `+Z` character-forward

This convention is intentionally aligned with VRM 1.0.

Examples:

- [`AvatarCanonicalRig.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarCanonicalRig.ts)
- [`AvatarMotionSolver.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarMotionSolver.ts)
- [`AvatarFacingResolver.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarFacingResolver.ts)
- [`AvatarHumanoidPose.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarHumanoidPose.ts)

### 3. VRM normalized humanoid space

This is the pose space expected by the VRM humanoid runtime.

Convention:

- same semantic forward basis as canonical avatar space
- `+X` character-left
- `+Y` up
- `+Z` character-forward

Examples:

- [`VrmPoseBuilder.ts`](/C:/programming/TheHangout/src/render/avatar/vrm/VrmPoseBuilder.ts)
- [`VrmAvatarView.ts`](/C:/programming/TheHangout/src/render/avatar/vrm/VrmAvatarView.ts)

## Required Boundary Conversion

The only intentional basis change is between raw tracking space and canonical avatar space.

Because:

- raw XR/engine space is `-Z` forward
- canonical avatar/VRM space is `+Z` forward

the conversion is a 180 degree rotation around the Y axis.

In this project that boundary lives in:

- [`AvatarTrackingSpace.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarTrackingSpace.ts)

Responsibilities of that module:

- convert raw world quaternions into avatar-world quaternions
- convert avatar-world quaternions back into raw world quaternions when needed
- keep the basis remap isolated to one place

This conversion must not be duplicated elsewhere.

## Canonical Rig Rules

The canonical rig must behave as follows:

1. Identity root rotation means the avatar faces `+Z`.
2. Left-side joints have negative local `X`; right-side joints have positive local `X`.
3. Forward-facing rest offsets, such as toes, point toward positive local `Z`.
4. The canonical rig is renderer-independent.
5. VRM renderers should consume canonical humanoid poses directly, without adding an extra hidden 180 degree body flip.

Current canonical rest rig definition:

- [`AvatarCanonicalRig.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarCanonicalRig.ts)

Current tests guarding this:

- [`AvatarCanonicalRig.test.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarCanonicalRig.test.ts)
- [`AvatarTrackingSpace.test.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarTrackingSpace.test.ts)
- [`AvatarMotionSolver.test.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarMotionSolver.test.ts)

## Practical Rules For Future Changes

- Do not reinterpret WebXR itself as `+Z` forward.
- Do not redefine the canonical avatar rig to match raw engine space.
- Do not add renderer-specific 180 degree corrections unless a specific asset importer proves they are required.
- If a pose looks backward, first check whether raw-space and avatar-space transforms were mixed without going through [`AvatarTrackingSpace.ts`](/C:/programming/TheHangout/src/shared/avatar/AvatarTrackingSpace.ts).
- When adding another avatar renderer, treat canonical avatar space as the source of truth.

## Mental Model

Use this quick mapping:

```text
WebXR / raw engine world:
+X right
+Y up
-Z forward

Canonical avatar / VRM 1.0:
+X character-left
+Y up
+Z character-forward
```

Or, equivalently:

```text
avatarSpace = rawSpace rotated 180 degrees around Y
```
