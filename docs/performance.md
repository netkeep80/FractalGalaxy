# Studio performance architecture

## Problem

After S3 the browser Studio can contain several thousand proven triangles and several thousand
unresolved regional cells. The pre-optimization interaction path performed two expensive classes
of work for every raw camera pointer event:

1. `renderGeometryLab()` rebuilt material classification, regional discovery and regional meshes
   even though camera yaw/pitch/zoom do not change world state.
2. Canvas visibility ordering considered triangle pairs exhaustively and then selected zero-incoming
   nodes by repeatedly scanning the remaining set.

The observed user symptom was approximately one camera frame per ten seconds.

## Target

The first performance stage has a hard camera-interaction target:

- at least 100× improvement from the observed worst case;
- <= 100 ms camera-only redraw on the representative S3 regional Chromium fixture;
- zero regional extraction and zero regional mesh assembly after warmup for camera-only changes;
- requestAnimationFrame coalescing of raw pointer/wheel events.

This target is an interaction contract, not permission to weaken proof or geometry semantics.

## Retained ideas from the historical C++ prototype

The old FractalGalaxy triangle prototype already contained several performance ideas that remain
architecturally sound:

- the recursive `FractalLine` / `FractalTriangle` hierarchy survived across frames and
  `Regenerate()` adapted only descendants whose camera-dependent detail state changed;
- subdivision was controlled by projected scale / distance / view direction rather than by
  rebuilding every possible leaf unconditionally;
- triangle AABBs and normals were precomputed;
- a sweep-and-prune AABB broad-phase was explicitly sketched before exact collision work;
- render data used dense vertex/triangle buffers;
- frame cost was measured continuously (FPS, ticks-per-triangle, triangle count, max level).

The current implementation adopts the general principles — persistent derived state, dirty-domain
invalidation, conservative broad-phase, dense reuse and measurable budgets — without copying the
old triangle topology.

## Deliberately not copied

The following historical techniques are implementation-era artifacts rather than current design:

- immediate-mode `glBegin/glEnd` rendering;
- fixed-function OpenGL material/state management;
- approximate O(N²) vertex deduplication;
- x86 `RDTSC` timing assumptions;
- using the graphics depth buffer as an implicit substitute for the current proof-aware Canvas
  ordering contract.

A future WebGL/WebGPU renderer may replace the Canvas painter, but that is a separate renderer
change and must preserve the material/proof semantics.

## Current optimization layers

### Dirty-domain rendering

World/proof/mesh build and camera projection/paint are separate invalidation domains. Camera-only
changes redraw cached geometry and cannot invoke material discovery or mesh assembly.

### Exact projected broad-phase

Projected triangle AABBs provide a conservative candidate set. Exact projected polygon overlap and
interpolated depth relation remain the narrow phase. A normal-suite adversarial fixture requires the
optimized order to equal exhaustive order.

### Cached proof-gap geometry

Canonical unresolved face contours and unresolved-cell topology are generated on a full geometry
build, not on every camera frame. Camera redraw performs projection and batched Canvas strokes only.

### Event coalescing

Raw camera pointer/wheel events update camera state immediately but schedule at most one paint for
the next animation frame.

## Instrumentation

The demo exposes read-only development counters through `globalThis.__fractalGalaxyPerformance`
for the browser regression suite. They include full builds, regional extraction/assembly counts,
view paints, last view duration and visibility candidate counts.
