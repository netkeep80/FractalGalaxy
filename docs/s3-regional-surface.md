# S3 — Regional proof-aware surface

S3 extends the accepted S2 local proof-aware surface into a finite regional composition.

## Authority

Authoritative matter remains `M = Resolve(B,D)`. Regional extraction is derived and read-only. A face may become geometry only when the material classifications on its two sides prove `PRESENT`. `REFINE` remains an unresolved proof gap and `NONE` produces no surface.

## S3-A — regional extraction core

The first bounded slice accepts a finite set of unique same-depth octree cell paths.

It must:

1. enumerate each internal face between selected neighboring cells exactly once;
2. include global-domain exterior faces as `pathB = null`;
3. never treat a missing selected neighbor that still exists inside the global domain as exterior/EMPTY;
4. compose the existing local `extractMaterialInterface` proof for each enumerated face;
5. return deterministic canonical face identities and aggregate proven/unresolved records;
6. be invariant to input cell traversal order;
7. reject duplicate cells and mixed input depths;
8. perform no write to material, WorldStore or FractalRing state.

The complete depth-1 E0 domain is the primary topology fixture: eight cells contain 12 unique internal face pairs and 24 global exterior faces.

## S3-B — adaptive coarse/fine stitching

A coarse proven surface boundary adjacent to four finer boundaries must use canonical subdivision so all shared reference points map to one deformed position. Nonzero base deformation, deterministic RND, smoothing and persisted offsets must not introduce cracks or T-junction holes.

## S3-C — regional Studio view

Studio will display a finite regional surface, explicit unresolved proof gaps and counts that allow accidental duplicate/fabricated geometry to be detected. Camera and render LOD remain derived state.

## S3-D — canonical deformed topology

Any displayed topological grid line under nonlinear deformation must be sampled through shared canonical subdivided vertices. Intersecting reference topology lines that meet at one canonical point must use the same canonical vertex key and exactly the same deformed intersection coordinate.

The current endpoint-only support-grid chord rendering is therefore a falsification target, not the desired behavior.

## Non-goals

S3 does not add a GPU depth buffer, collision solver, production Fuse, arbitrary self-intersection repair or unbounded world extraction.


## Implemented completion candidate

S3-B extends the same-depth S3-A extractor with an adaptive mixed-depth leaf-region path. Coarse/fine face ownership is normalized to equal-depth incident proof cells before invoking the existing material-interface extractor. Regional geometry then promotes proven patches to one canonical target depth and globally deduplicates canonical vertices. The current bounded strategy prefers deterministic promotion over optimized transition triangles: correctness first, triangle-count optimization later.

S3-C Studio adds a Regional surface mode over a finite depth-2 region, refined by material proof through E0 depth 5. It shows the regional proven mesh and unresolved proof contours with explicit regional face/unresolved counters. This view remains derived and does not write M, D or WorldStore.

S3-D replaces endpoint-only nonlinear support-grid chords. The displayed root topology grid is now sampled through canonical intermediate vertices; intersecting lines reuse a shared canonical vertex identity and evaluate deformation at that point.


### Regional rendering cost

Regional Canvas rendering keeps the S2 overlap-correct visibility ordering. A projected triangle bounding-box broad phase now rejects obviously disjoint triangle pairs before polygon overlap/depth analysis. This is a rendering-cost optimization only: it does not change material proof, mesh topology or painter ordering for triangles whose projected bounds overlap.
