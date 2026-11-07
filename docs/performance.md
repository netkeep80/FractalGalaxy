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

## Acceptance target

The performance stage is judged by controlled measurements, not by the original subjective estimate.

The accepted candidate must satisfy all of the following:

- same-run BASE→HEAD Chromium benchmark on one runner, browser, viewport and regional scene;
- HEAD camera-only latency distribution uses at least 20 independently scheduled redraws;
- HEAD median camera-only latency <= 100 ms and p95 <= 150 ms;
- controlled BASE median / HEAD median >= 100×;
- zero regional extraction and zero regional mesh assembly after warmup for camera-only changes;
- requestAnimationFrame coalescing of raw pointer/wheel events;
- optimized painter order equals exhaustive painter order on deterministic adversarial scenes.

BASE is intentionally sampled only a few times because its exact camera path can take many seconds
per frame. HEAD receives the larger N>=20 distribution.

## Dirty-domain rendering

World/proof/mesh build and camera repaint are separate invalidation domains.

Camera-only yaw/pitch/zoom changes cannot invoke:

- material classification;
- regional material discovery;
- regional interface extraction;
- canonical regional mesh assembly.

A view switch must nevertheless repaint the newly visible viewport from the current shared camera,
so a hidden Canvas can never expose an old camera frame.

The expensive Regional path reuses all camera-invariant geometry. Some lightweight Surface /
Diagnostics helper topology can still be regenerated during a camera repaint; that work is not
authoritative B/D/M state and is not counted as regional extraction/mesh assembly. It remains a
secondary optimization target rather than being mis-described as material reconstruction.

## Exact projected broad-phase

Projected triangle AABBs provide a conservative candidate set. Exact projected polygon overlap and
interpolated depth relation remain the narrow phase.

The broad-phase is a two-axis sweep:

- X expiration uses a min-heap by `maxX`;
- active intervals are indexed by a deterministic augmented Y interval tree;
- only Y-overlapping active intervals reach exact narrow-phase.

This removes the former hidden O(N²) active-array scan when all X intervals overlap but Y intervals
are disjoint.

Every pair is normalized by original triangle index before exact `projectedDepthRelation()`.
Therefore broad-phase enumeration order cannot alter floating-point argument order relative to the
exhaustive algorithm.

Normal-suite regressions include:

- the independent large-coordinate two-triangle counterexample;
- 520 deterministic finite-coordinate optimized-vs-exhaustive scenes;
- a 6500-triangle common-X / disjoint-Y scene that requires zero narrow-phase pairs and a
  subquadratic interval-index visit count.

## Painter graph ordering

Kahn ordering uses a priority heap for zero-incoming nodes and keeps deterministic depth/index
fallback behavior. Cycle fallback semantics remain the same as the exhaustive renderer.

## Projection reuse

Each canonical mesh vertex is projected once per frame. Triangle indices reuse those projected
vertices. Stored normals are reused only because current regional mesh assembly computes normals
from the corresponding reference/deformed vertex positions.

## Cached regional proof-gap geometry

Canonical regional unresolved face contours and unresolved-cell topology are generated on a full
geometry build, not on every camera frame. Camera redraw projects and paints those cached world-space
samples.

## Event coalescing

Raw camera pointer/wheel events update camera state immediately but schedule at most one paint for
the next animation frame. The normal Chromium suite also verifies that revealing a previously hidden
viewport triggers a fresh view-only paint rather than a full world rebuild.

## Performance accounting

`globalThis.__fractalGalaxyPerformance` is diagnostic only; acceptance does not trust it by itself.

The counters now separate:

- exhaustive pair count;
- exact narrow-phase candidate pairs;
- broad-phase sort comparisons;
- Y interval-index visits;
- X expiry operations;
- painter graph/order operations.

The standalone CI BASE→HEAD browser benchmark measures event-to-frame latency independently with
`performance.now()` and does not use those counters as its timing source.

## Historical C++ prototype

The historical triangle implementation remains non-authoritative, but several optimization
principles were retained:

- persistent recursive derived geometry between frames;
- view-dependent adaptation rather than unconditional full reconstruction;
- AABB sweep-and-prune before exact tests;
- precomputed triangle boxes/normals;
- dense vertex/index reuse;
- explicit frame/cost instrumentation.

Not copied:

- immediate/fixed-function OpenGL;
- the old triangle topology;
- approximate O(N²) vertex deduplication;
- x86-specific RDTSC timing;
- camera-dependent detail as authoritative material state.

Any future renderer LOD remains derived view state and cannot mutate B, D or M.
