# ComfyUI-Majoor-ImageOps — Correction & Hardening Plan for Codex 5.6 Sol

> **Goal:** bring `ComfyUI-Majoor-ImageOps` to a **minimum 9/10 engineering quality bar** without rewriting the pack and without breaking existing workflows.
>
> **Repository:** `MajoorWaldi/ComfyUI-Majoor-ImageOps`
>
> **Audit baseline:** `main` at `d413ec5bab6cd4cba891a1a71e6fe84870da14b7` (PR #5 merged 2026-08-22).
>
> **Primary constraints:** preserve the 26-node pack, preserve workflow compatibility, keep the live preview experience, keep GPU-first image processing, and migrate cleanly toward current ComfyUI V3 contracts.

---

# 0. Mission for the coding agent

You are the implementation agent responsible for stabilizing and hardening this repository until it reaches a production-grade **9/10 minimum** quality level.

Do **not** treat this as a feature sprint. The priority is correctness, compatibility, tests, CI, runtime safety, V3 schema integrity, preview/backend parity, memory safety, and maintainability.

The repository already contains valuable algorithms and working frontend behavior. **Do not rewrite the pack from scratch.** Refactor only where needed to enforce shared contracts or remove verified architectural debt.

The target outcome is:

```text
26 nodes
  ↓
valid V3 schemas
  ↓
correct runtime contracts
  ↓
strict batch policy
  ↓
strict mask/alpha policy
  ↓
memory preflight
  ↓
backend ↔ preview parity
  ↓
unit + integration tests
  ↓
Quality Gate
  ↓
release-safe repository
```

---

# 1. Mandatory operating rules for Codex 5.6 Sol

## 1.1 Read official ComfyUI sources before changing compatibility code

For any code touching ComfyUI APIs, V3 schemas, video types, frontend node lifecycle, routes, dynamic sockets, subgraphs, lazy execution, node replacement, or extension registration, inspect the current official sources first.

Required references:

- ComfyUI core: https://github.com/Comfy-Org/ComfyUI
- V3 migration: https://docs.comfy.org/custom-nodes/v3_migration
- Server communications: https://docs.comfy.org/development/comfyui-server/comms_overview
- Node replacement: https://docs.comfy.org/custom-nodes/backend/node-replacement
- Subgraphs: https://docs.comfy.org/custom-nodes/js/subgraphs
- Lazy evaluation: https://docs.comfy.org/custom-nodes/backend/lazy_evaluation
- LoadVideo: https://docs.comfy.org/built-in-nodes/LoadVideo
- SaveVideo: https://docs.comfy.org/built-in-nodes/SaveVideo

Do not assume an old API behavior still applies.

## 1.2 Do not change behavior silently

If a change affects:

- batch expansion,
- mask meaning,
- alpha handling,
- resize/crop geometry,
- blend math,
- video timing,
- output type,
- socket ordering,
- widget name,
- output name,
- node ID,

then add a regression test before or together with the change.

## 1.3 Preserve workflow compatibility

Never rename node IDs casually.

Never remove old widget identifiers without a replacement strategy.

If a schema cleanup would break saved workflows, use ComfyUI's official replacement/migration mechanisms where appropriate.

## 1.4 Small PRs only

Do not submit a single giant refactor PR.

Use the PR sequence defined in this document. Every PR must leave the repository in a testable state.

## 1.5 No new major features during stabilization

Do not add the planned Sequencer or unrelated features until all P0 and P1 items in this plan are complete and the Quality Gate is green.

---

# 2. Target quality bar

The repository is considered **9/10 minimum** only if all of the following are true.

## Mandatory release gates

- [ ] All 26 nodes load in a real current ComfyUI checkout.
- [ ] `comfy_entrypoint()` loads successfully.
- [ ] All 26 schemas are valid and have correct input/output types.
- [ ] No known dropdown/enum is exposed as free text unless intentionally designed that way.
- [ ] `/imageops/viewmedia` is registered and integration-tested.
- [ ] Python unit tests are green without requiring a ComfyUI checkout.
- [ ] ComfyUI integration tests are green with a real ComfyUI checkout.
- [ ] Frontend tests are green.
- [ ] TypeScript type-check is green.
- [ ] Generated frontend files are clean after build.
- [ ] Backend/preview golden parity exists for blend modes and critical image operations.
- [ ] Multi-input batch behavior is explicit and tested.
- [ ] Mixed per-frame bypass is correct.
- [ ] Memory preflight protects all large-allocation nodes.
- [ ] IMAGE RGB and MASK/alpha range contracts are documented and tested.
- [ ] `main` is protected by a required Quality Gate.
- [ ] Stable/nightly/registry publication cannot happen from a red commit.
- [ ] Documentation matches shipped nodes and outputs.

---

# 3. Current verified strengths — do not regress

The following improvements already exist and must remain intact:

- 26-node backend registry restored.
- Frontend class registry generated from metadata instead of a hard-coded 17-node set.
- Strict frontend blend golden assertions.
- Native `ComfyExtension` + `comfy_entrypoint` direction.
- Native V3 `io.ComfyNode`, `define_schema`, `execute` in the current migration.
- `io.MultiType.Input(... types=[io.Image, io.Video])` introduced.
- Numeric V3 outputs such as `width`, `height`, and `frame_count` correctly use `io.Int.Output`.
- MemoryBudget wired into several major nodes including Constant and Ramp.
- Crop no-op geometry bug fixed by using `_compute_crop_box` as source of truth.
- Crop mask geometry support.
- Spherize mask projection fix.
- Frontend registry and metadata build validation.
- Package version and MIT license alignment.
- Initial frontend split into `core/` and `ops/` modules.

Any implementation that reintroduces one of these regressions is unacceptable.

---

# 4. P0 — Blockers that must be fixed first

# P0.1 — Restore server route registration

## Problem

The current root `__init__.py` creates the extension and loads the nodes, but does not clearly import/register `server.py`.

`server.py` owns:

```python
@server.PromptServer.instance.routes.get("/imageops/viewmedia")
async def imageops_viewmedia(...):
    ...
```

The frontend still calls `/imageops/viewmedia` for media playback.

This can leave the frontend with a valid URL builder but no backend route.

## Required implementation

Create an explicit, idempotent route registration boundary.

Preferred structure:

```python
# server.py
_routes_registered = False


def register_imageops_routes():
    global _routes_registered
    if _routes_registered:
        return

    # register routes exactly once
    ...

    _routes_registered = True
```

Then call it from the extension/package lifecycle in a way compatible with current ComfyUI.

Do not rely on accidental import side effects if a cleaner supported registration mechanism exists in the current ComfyUI API.

## Files likely affected

- `__init__.py`
- `server.py`
- `tests/integration/test_server_routes.py`

## Tests required

- [ ] Load the extension in a real ComfyUI checkout.
- [ ] Assert `/imageops/viewmedia` exists.
- [ ] Register the extension twice and assert no duplicate-route failure.
- [ ] Validate a normal temp media request.
- [ ] Validate invalid path traversal remains blocked.

## Definition of Done

The route works in a real ComfyUI process and has an integration test.

---

# P0.2 — Fix Python CI architecture

## Problem

The current Python test job runs:

```bash
python -m pytest tests/unit -v
```

but the only current registry test is actually an integration test and imports V3 node code that requires `comfy_api`.

The latest CI run fails with:

```text
ModuleNotFoundError: No module named 'comfy_api'
```

## Required implementation

Split tests into two classes.

### Unit tests

Must run without ComfyUI installed.

Examples:

- batch helpers,
- memory budget,
- crop math,
- blend math,
- mask helpers,
- pure geometry helpers,
- deterministic procedural math.

### Integration tests

Must run with an actual ComfyUI checkout.

Examples:

- extension import,
- registry count,
- schema serialization,
- object info,
- server routes,
- workflow execution smoke tests,
- V3 Video compatibility.

Recommended layout:

```text
tests/
├── unit/
├── integration/
├── frontend/
├── golden/
└── fixtures/
```

## CI jobs

### `python-unit`

- Python 3.11
- CPU PyTorch only
- no ComfyUI checkout
- runs `tests/unit`

### `comfy-integration`

- checkout ComfyUI
- install ImageOps as a custom node
- set `COMFYUI_ROOT`
- run `tests/integration`

## Definition of Done

A pull request can clearly tell whether a failure belongs to pure ImageOps logic or ComfyUI integration.

---

# P0.3 — Make Quality Gate actually block merges

## Problem

The repository has a Quality Gate job but `main` is not protected and red PRs have already been merged.

## Required implementation

Keep a single final job:

```yaml
quality-gate:
  needs:
    - frontend
    - python-unit
    - comfy-integration
    - golden-parity
```

Then configure GitHub branch protection for `main`:

- require PR before merge,
- require branch up to date,
- require `Quality Gate`,
- block force pushes,
- optionally require conversation resolution.

Branch protection may require repository settings outside code. Document the exact manual step in `CONTRIBUTING.md` or `docs/RELEASE.md` if the coding agent cannot enforce it programmatically.

## Definition of Done

A red Quality Gate cannot be merged into `main`.

---

# P0.4 — Repair V3 enum inputs (`String` → `Combo`)

## Problem

The migration converted many legacy enums/dropdowns into `io.String.Input`.

This weakens validation and may break expected frontend UX.

## Required implementation

Audit **every `io.String.Input` in every node**.

For each input, classify it as one of:

```text
FREE TEXT
ENUM / COMBO
JSON INTERNAL STATE
PATH / IDENTIFIER
```

All enums must become `io.Combo.Input`.

## Minimum known nodes to review

### Blur

- `blur_type`

### Merge

- `mode`
- `foreground_fit`
- `blend_space`

### Crop

- `aspect_ratio`

### Constant

- `mode`
- `aspect_ratio`

### Ramp

- `ramp_shape`
- `ramp_mode`

### Transform

- `flip`
- `filter`
- `fill_mode`

### Channel

- channel selector(s)

### CornerPin

- filter
- edge mode

### Distort

- mode
- map source
- filter
- edge mode

### FrameRange

- repeat mode

### Grain

- blend mode already uses Combo — keep it.

### Keyer

- key mode / matte mode / display modes where applicable

### Noise

- basis
- fractal mode

### PadOut

- target format
- fill mode

### Preview

- preview target
- preview mode

### Spherize

- projection mode
- filter
- edge mode
- size mode

### Text

- alignment/style enums where applicable; do not turn actual text content into Combo.

## Tests required

Create a schema contract test that validates selected known enums are `Combo` and free-text fields remain `String`.

## Definition of Done

No user-facing mode selector is an arbitrary text field unless explicitly justified.

---

# P0.5 — Add full 26-node schema contract tests

## Goal

Prevent migrations from silently changing socket types again.

## Add snapshot-style assertions for every node

For each node verify at minimum:

- `node_id`
- display name
- category
- input names
- input types
- optional/required state
- output names
- output types
- hidden values
- `accept_all_inputs` only where justified

For critical nodes also validate:

- Combo option sets
- MultiType accepted types
- socketless/internal widgets
- `search_aliases`

## Rule

A schema change must require an intentional snapshot update in the same PR.

---

# 5. P1 — Engine-wide contracts

# P1.1 — Replace hidden batch cycling with one BatchPolicy

## Problem

`nodes/core/batch.py` exists, but legacy helpers such as `_expand_image_batch` still cycle non-singleton batches.

Example of dangerous implicit behavior:

```text
input = [1,2,3]
target batch = 7
result = [1,2,3,1,2,3,1]
```

That behavior should never happen unless the node explicitly requested a loop policy.

## Required contract

All multi-input nodes must use a shared policy API.

Allowed policies:

```text
strict
broadcast_singleton
hold_last
loop
```

Default for general image compositing should be either:

```text
strict + singleton broadcast
```

or another explicitly documented policy per node.

## Migrate first

- Comp
- Merge
- CropStitch
- Distort displacement map
- any image+mask pairing logic
- any node merging multiple image batches

## Remove / deprecate

- `_expand_image_batch` as a hidden cycling helper
- custom `repeat(ceil(...))` patterns
- arbitrary `min(index, last)` patterns when they represent batch policy rather than parameter fallback

## Tests

For each multi-input node cover:

- 1 ↔ N singleton broadcast
- N ↔ N exact
- N ↔ M mismatch
- explicit hold-last
- explicit loop if supported

---

# P1.2 — Implement correct mixed per-frame bypass

## Problem

Many nodes only detect whether **all** bypass values are true.

For:

```text
bypass = [False, True, False]
```

the middle frame may still be processed.

## Required shared API

Add a helper such as:

```python
def apply_per_frame_bypass(
    source: torch.Tensor,
    processed: torch.Tensor,
    bypass,
) -> torch.Tensor:
    ...
```

Or preferably process only active frames when practical.

## Must cover

- Blur
- Color Correct
- Transform
- Distort
- Spherize
- Grain
- CameraShake where meaningful
- Merge / compositing controls where bypass is frame-batched

## Tests

For every migrated node include at least:

```text
bypass = [False, True, False]
```

and assert frame 2 is bitwise/effectively identical to source.

---

# P1.3 — Make MemoryBudget mandatory

## Current status

MemoryBudget is already used in several nodes. Extend it into a real contract.

## Nodes that must be covered

At minimum:

- Constant
- Ramp
- Blur
- Comp
- PadOut
- Draw
- Noise
- Transform
- CornerPin
- Spherize
- CameraShake
- Grain
- Distort
- Crop
- Preview
- Text if large canvases/batches are generated
- Append when concatenation can create a very large output tensor

## Improve the budget model

Current static MB budget is useful but incomplete.

Add operation-aware estimates:

```text
output allocation
+ temporary working tensors
+ grids
+ masks
+ supersampling
+ batch duplication
+ CPU preview buffers where relevant
```

Where available, consider current ComfyUI memory information through official APIs such as `comfy.model_management.get_free_memory()`, but do not make the code brittle if that API is unavailable.

## Tests

Mock low memory thresholds and assert the node raises **before** allocating huge tensors.

Explicit regression tests:

- Constant 8192×8192×4096
- Ramp 8192×8192×4096
- CameraShake long frame count
- Grain 4K × 256 frames
- CornerPin supersample 4x

---

# P1.4 — Define and enforce the HDR / float contract

## Goal

ImageOps should behave like a compositor, not silently destroy out-of-range float data.

## Recommended contract

```text
IMAGE RGB:
    finite float
    values may be < 0 or > 1

ALPHA:
    clamped to [0,1]

MASK:
    clamped to [0,1]

DISPLAY / PREVIEW:
    tone-map or clamp only at the UI boundary
```

## Add shared helpers

```python
sanitize_finite(image)
clamp_alpha(alpha)
clamp_mask(mask)
to_display_range(image, mode=...)
```

## Remove unjustified image clamps

Audit every:

```python
.clamp(0.0, 1.0)
```

and classify it as:

```text
required by algorithm
required for mask/alpha
required for display
unnecessary / HDR-destructive
```

## Priority files

- `_helpers.py`
- `merge.py`
- `blur.py`
- `transform.py`
- `crop_stitch.py`
- `padout.py`
- `corner_pin.py`
- `distort.py`
- `spherize.py`
- `color_ajust.py`
- `grain.py`
- `comp.py`

## Required tests

Use a fixture containing values such as:

```text
-0.25
0.0
0.5
1.0
2.0
4.25
```

Identity/no-op paths must preserve these values.

Geometry operations should preserve numeric range except where interpolation mathematically changes values.

MASK/alpha must remain `[0,1]`.

---

# P1.5 — Golden parity: Python backend ↔ JS preview

## Problem

Frontend blend goldens exist, but they do not yet prove Python and preview use the same math.

## Required design

A golden fixture must be consumed by both sides:

```text
tests/golden/blend_modes.json
      ├── Python test
      └── JS preview test
```

Do the same over time for critical ops:

- Merge blend modes
- Invert
- Clamp
- Color Correct identity/basic cases
- Transform basic affine
- Crop bbox/resize
- Spherize basic mapping
- Keyer matte values

## Rule

No test may silently skip unsupported modes.

Every golden case must either:

- pass,
- or fail explicitly.

---

# P1.6 — Finish V3 return contracts with `io.NodeOutput`

## Problem

Nodes have V3 schemas and execute methods but many still return legacy tuples or `{ui, result}` dictionaries.

## Required implementation

Migrate outputs to current V3 conventions:

```python
return io.NodeOutput(image, mask)
```

For UI metadata, use the current supported V3 mechanism after checking official ComfyUI source/docs.

Do not assume the exact constructor signature without verifying the current API.

## Compatibility requirement

If old preview behavior depends on legacy UI dictionaries, migrate carefully and add integration tests before deleting the compatibility path.

---

# P1.7 — Limit `accept_all_inputs=True`

## Problem

Dynamic input acceptance weakens validation when used globally.

## Required rule

Use `accept_all_inputs=True` only for nodes that genuinely require unknown/dynamic input names.

Likely candidates:

- Comp
- Append, until migrated to a supported dynamic socket mechanism

Normal fixed-schema nodes should not use it.

---

# 6. P1 — VIDEO and timeline contract

# P1.8 — Decide the public media contract

## Current problem

`ImageOpsMedia` stores:

```text
frames
fps
audio
metadata
```

which is architecturally useful, but some nodes can return `ImageOpsMedia` through a socket declared as `io.Image.Output`.

That is unsafe for interoperability with third-party ComfyUI nodes.

## Required decision

Choose one of these designs.

### Preferred: native ComfyUI VIDEO at public boundaries

Use official `io.Video` for public VIDEO sockets.

Internally, a helper object may wrap decomposed components, but never return a custom media object on an IMAGE socket.

### Alternative

If a custom media type is retained, it must use a real explicit socket type and have adapters to/from native VIDEO. Do not masquerade as IMAGE.

## Definition of Done

A node connected to standard ComfyUI VIDEO nodes works without ImageOps-specific assumptions.

---

# P1.9 — Fix FrameRange timing/audio semantics

Current frame trim modifies frames but can preserve the entire original audio buffer.

Required behavior:

```text
trim frames
→ calculate time interval from fps
→ trim audio to matching time interval
```

For repeat modes define explicit behavior:

- loop audio?
- silence?
- repeat audio?
- hold/freeze semantics?

Document the selected behavior.

Add tests for:

- 24 fps source
- 30 fps source
- trim middle section
- hold frame
- loop
- bounce
- custom frame count

---

# P1.10 — Fix Append timeline semantics

Append must define explicit policies.

## FPS policy

```text
strict_same_fps
conform_to_first
explicit_output_fps
```

Choose a sensible default and test it.

## Audio policy

```text
concat
preserve_first
mute/drop
```

Prefer real concatenation for an editing/sequencing node.

## Trims

Apply trims to both frames and audio.

## Retime

If retiming is added later, keep it out of this stabilization PR unless required to correct current semantics.

---

# 7. P2 — Node-specific algorithm and performance work

# P2.1 — Grain

## Fix RNG placement

Current grain generation uses a CPU generator and CPU `torch.rand` per frame.

Move random generation to the source device where possible.

Requirements:

- deterministic per seed,
- deterministic still grain when `animated=False`,
- deterministic frame-varying grain when `animated=True`,
- no per-frame GPU↔CPU transfer.

## Fix amount being effectively applied twice

Current overlay/soft-light flow applies `amount` to grain amplitude and again to the final blend.

Choose one model.

Preferred:

```text
raw random noise
→ construct blend candidate
→ lerp(source, candidate, amount)
```

or clearly document an alternative.

Add numeric tests at amount:

```text
0.0
0.1
0.5
1.0
```

and verify monotonic, approximately linear response.

## Remove `.item()` synchronization

Do not create a GPU tensor just to immediately call `.item()` for a Python branch.

---

# P2.2 — Distort batching

Current distort behavior has historically processed frames one-by-one with repeated `grid_sample` calls.

Refactor toward:

```text
build [B,H,W,2] grid
→ one batched grid_sample per compatible mode group
```

Group only when needed by differing interpolation/padding modes.

Displacement map inputs should be lazy when not required by the active mode.

---

# P2.3 — Spherize grid reuse

Separate:

```python
build_spherize_grid(...)
apply_spherize_grid(...)
```

Cache/group grids by stable parameter key:

```text
H
W
mode
strength
invert
```

Use bounded LRU cache, not unbounded global caching.

When possible, pack image and mask into one sampling pass.

---

# P2.4 — Blur memory/perf sanity

The large-radius box approximation is good. Keep it.

Add benchmarks and tests around:

- radius 0
- small Gaussian
- large Gaussian
- box
- defocus
- surface
- batched per-frame radius

Ensure temporary float64 accumulation for large prefix sums does not explode working memory without being included in budget estimation.

---

# P2.5 — Transform

The GPU affine batch path is good and should remain.

Two remaining design choices:

### `expand`

Currently a compatibility placeholder.

Either:

- implement a real expanded output canvas, or
- hide it from new workflows while preserving old serialization compatibility.

Do not leave a permanently visible dead control in the final polished UI.

### HDR

Remove display-range clamps from geometry output except alpha/mask boundaries.

---

# P2.6 — Preview memory and CPU path

## Fix strip conversion order

Wrong:

```python
pil_list = _tensor_batch_to_pil_list(images)
frames = pil_list[:16]
```

Correct:

```python
images = images[:16]
pil_list = _tensor_batch_to_pil_list(images)
```

## Add global preview limits

Suggested configurable caps:

```text
max_preview_frames
max_preview_side
max_preview_pixels
max_preview_duration
max_preview_fps
```

## Animated previews

Avoid encoding hundreds of full-resolution frames into GIF/WebP.

Sample temporally when necessary.

## Tests

Spy/mock tensor→PIL conversion and assert only selected frames are converted.

---

# P2.7 — Draw payload safety

Enforce hard limits on:

- base64 payload length,
- decoded byte size,
- layer count,
- decoded image dimensions,
- total decoded pixels,
- total memory estimate.

Reject oversized workflow payloads with a clear error before PIL allocation.

Long term, consider asset references with portable embedded fallback.

---

# P2.8 — Text performance

Review:

- font lookup caching,
- PIL canvas allocations,
- repeated text layout calculations,
- batch generation.

Add MemoryBudget before large multi-frame text renders.

---

# 8. P2 — Frontend architecture cleanup

The frontend split is moving in the right direction, but `ops/implementation.ts` remains a large monolith.

## Target architecture

```text
src/preview/
├── core/
│   ├── graph.ts
│   ├── media.ts
│   ├── renderer.ts
│   ├── scheduler.ts
│   └── video.ts
│
├── ops/
│   ├── blend.ts
│   ├── color.ts
│   ├── geometry.ts
│   ├── masks.ts
│   ├── procedural.ts
│   └── video.ts
│
├── nodes/
└── shared/
```

## Rule

`implementation.ts` should shrink over time until it disappears or becomes a very small facade.

Move code by domain in small PRs while keeping golden tests green.

Do not combine this architectural split with unrelated backend behavior changes.

---

# 9. P2 — Manifest as source of truth

`imageops_nodes.json` should become the authoritative metadata source for both frontend and backend discoverability where practical.

Generate or validate:

- frontend class list,
- UI mode metadata,
- preview sizing,
- aliases,
- backend `search_aliases`,
- possibly node ordering/categories.

Add a CI check ensuring generated files are clean.

Do not create a second independent hand-maintained list of 26 nodes.

---

# 10. P2 — Search aliases in V3 schemas

The manifest already contains useful aliases.

Feed those aliases into:

```python
io.Schema(..., search_aliases=[...])
```

where supported.

Examples:

```text
Crop → crop, resize, reformat, recadrer, taille
CornerPin → perspective, screen replacement
Noise → perlin, procedural, texture
FrameRange → trim, hold, loop, timeline
Append → concat, sequence, clips
```

Add schema tests verifying selected aliases are present.

---

# 11. P2 — Lazy execution

After V3 stability is proven, use official lazy input support for expensive optional branches.

Candidates:

### Merge

If `mix == 0` or bypass, do not evaluate B upstream.

### Distort

If active mode does not need displacement, do not evaluate displacement upstream.

### Comp

Disabled layers should not execute upstream if a supported dynamic/lazy design permits it.

### CropStitch

If bypassed, edited crop may not need execution.

Add integration tests ensuring lazy behavior does not break workflow execution or subgraphs.

---

# 12. P2 — Dynamic sockets: Comp and Append

Do not rush this before core stabilization.

After the integration matrix is green, evaluate official V3 dynamic input mechanisms such as Autogrow.

Requirements before migration:

- confirm current ComfyUI support,
- test saved workflow compatibility,
- test Nodes 2.0 frontend,
- test subgraphs,
- test widget promotion,
- use Node Replacement / widget ID mapping when required.

Keep `accept_all_inputs=True` as a temporary compatibility mechanism only if necessary.

---

# 13. P2 — Server hardening

Keep current good behavior:

- resolved paths,
- `commonpath` containment,
- no `shell=True`,
- stderr drain,
- FileResponse fallback.

Add:

## Input validation

`_force_size_filter` must not throw a 500 on malformed user input.

Handle invalid width/height with a clean 400 or fallback.

## Extension allowlist

Only serve/transcode known media extensions.

## Concurrency limit

Use an asyncio semaphore for ffmpeg transcodes.

## Process result handling

Check ffmpeg return code and log/surface failure clearly.

## Optional cache

Avoid retranscoding the exact same source/force_size repeatedly during UI refresh.

Use bounded cache semantics.

---

# 14. P2 — Release and publishing workflows

Create or refactor to a reusable quality workflow.

Every release path must depend on the same quality checks.

Required release paths:

- pull requests
- push to main
- nightly
- tag release
- Comfy Registry publish

No workflow may publish directly from an unchecked commit.

Suggested structure:

```text
quality.yml
    ↓
PR
main
nightly
release-on-tag
publish-registry
```

---

# 15. P2 — Package metadata and minimum ComfyUI version

Already fixed:

- Python package version: 0.1.5
- npm package version: 0.1.5
- MIT license alignment

Still required:

- replace `WORK IN PROGRESS` npm description,
- determine minimum supported ComfyUI version through integration CI,
- set `requires-comfyui` once proven,
- avoid depending indefinitely on an unstable `comfy_api.latest` surface if a stable numbered API is available.

Recommended compatibility matrix:

```text
ComfyUI minimum supported
ComfyUI current stable/latest tested
```

---

# 16. P2 — Documentation cleanup

Documentation must describe only shipped behavior.

## PadOut Stitch

The previous README documented a PadOut Stitch node that was not registered as a real backend node. The dead frontend files have since been removed.

Ensure the README contains no remaining references to a nonexistent stitcher/output.

## V3 / VIDEO

Document exactly which nodes accept IMAGE and VIDEO and what VIDEO semantics are currently preserved.

Do not claim audio/timing preservation until integration tests prove it.

## HDR

Document the finalized float range contract once implemented.

## Batch behavior

Document multi-frame policy for:

- Merge
- Comp
- CropStitch
- Append
- FrameRange

---

# 17. Node-by-node target state

Use this table as the implementation completion matrix.

| Node | Required before 9/10 |
|---|---|
| Color Correct | correct Combo schemas, HDR contract, mixed bypass, goldens |
| Blur | Combo blur type, mixed bypass, HDR-safe output, memory tests |
| CameraShake | MemoryBudget, explicit frame policy, VIDEO timing contract |
| Channels | Combo selectors, V3 schema test |
| CornerPin | memory test, HDR-safe geometry, supersample regression |
| Comp | strict BatchPolicy, memory, dynamic input contract, lazy candidate, schema test |
| Constant | memory ✅, Combo cleanup, schema/output tests |
| Crop | no-op ✅, aspect Combo, HDR-safe resize, regression tests |
| CropStitch | BatchPolicy, HDR-safe composite, bbox regression |
| Distort | batching, memory, lazy displacement, Combo schemas, HDR |
| Draw | payload limits, memory, integration workflow test |
| FrameRange | native VIDEO contract, audio trim, timing tests |
| Grain | GPU RNG, amount fix, memory, mixed bypass |
| Transform | Combo schemas, HDR, `expand` decision, mixed bypass |
| Invert | V3 NodeOutput, HDR identity/regression |
| Append | public VIDEO type correctness, fps/audio policies, memory, dynamic sockets later |
| Keyer | Combo schemas, backend/preview matte goldens |
| Clamp | arbitrary float tests, V3 NodeOutput |
| Merge | BatchPolicy, Combo schemas, HDR, Python+JS goldens, lazy B |
| MaskConvert | V3 NodeOutput, mask range tests |
| Noise | memory/perf benchmarks, preview limits, deterministic tests |
| PadOut | HDR-safe output, docs alignment, memory tests |
| Preview | server route, conversion limits, encode caps, integration tests |
| Ramp | memory ✅, Combo cleanup, schema tests |
| Spherize | grid caching/grouping, HDR, memory, mask regression |
| Text | Combo cleanup, font/layout caching, memory |

---

# 18. Required test suite before calling the repository 9/10

# 18.1 Python unit tests

At minimum create tests for:

- `core.batch`
- `core.memory`
- crop box/no-op geometry
- mask normalization
- blend math
- HDR identity range preservation
- mixed bypass helper
- Grain deterministic RNG / amount response
- preview frame limiting
- server force-size parsing helper if extracted into pure code

# 18.2 Python integration tests with ComfyUI

At minimum:

- import extension
- call `comfy_entrypoint`
- exactly 26 registered nodes
- all schemas serializable
- required schema types correct
- `/imageops/viewmedia` exists
- smoke execute representative nodes
- VIDEO input through at least one ImageOps node
- standard third-party/native node compatibility around IMAGE/VIDEO boundaries

# 18.3 Frontend tests

Keep and expand:

- registry test
- graph test
- blend golden test
- node module test

Add:

- enum/widget expectations
- media URL generation
- missing route/error fallback UI where appropriate
- dynamic Append/Comp input behavior

# 18.4 Golden tests

Shared fixtures consumed by Python and JS.

At minimum:

- Merge modes
- basic Color Correct
- Clamp
- Invert
- Crop geometry
- Transform simple translations/scales
- Keyer matte samples

# 18.5 Workflow fixtures

Add small JSON workflows that can be loaded/executed in integration tests.

Recommended fixtures:

```text
imageops_basic_image.json
imageops_mask_chain.json
imageops_comp_3_layers.json
imageops_video_frame_range.json
imageops_append_video.json
imageops_crop_stitch.json
```

---

# 19. Performance benchmark suite

Add non-blocking benchmark scripts first; convert regressions into CI thresholds only after baselines are stable.

Benchmark matrix:

```text
resolution:
  1080p
  2K
  4K

frames:
  1
  24
  120
```

Priority nodes:

- Blur
- Transform
- CornerPin
- Distort
- Spherize
- Grain
- Noise
- Comp
- Merge
- Preview

Collect:

- wall time
- peak GPU memory when available
- peak CPU memory where practical
- number of CPU/GPU transfers

---

# 20. Recommended PR sequence

Do not deviate significantly from this order unless a failing test reveals a hard dependency.

## PR 1 — CI and integration split

- create `tests/unit`
- create `tests/integration`
- fix Python unit job
- add ComfyUI integration job
- make Quality Gate depend on both

**Exit condition:** all jobs green.

## PR 2 — Route registration + server integration tests

- explicit route registration
- `/imageops/viewmedia` integration test
- idempotency
- malformed `force_size` handling

**Exit condition:** media route proven in real ComfyUI.

## PR 3 — V3 schema correctness

- String→Combo audit
- schema snapshots/contracts for 26 nodes
- `search_aliases`
- remove unjustified `accept_all_inputs`

**Exit condition:** all schemas intentional and validated.

## PR 4 — V3 output contract

- migrate node returns toward `io.NodeOutput`
- preserve UI metadata behavior
- integration regression tests

## PR 5 — BatchPolicy + mixed bypass

- shared per-frame bypass helper
- remove hidden cycling from core multi-input nodes
- Comp/Merge/CropStitch first

## PR 6 — MemoryBudget completion

- CameraShake
- Grain
- Distort
- Crop
- Preview
- Text/Append where required

## PR 7 — HDR contract

- add range helpers
- audit clamps
- add HDR fixtures/tests
- migrate geometry/compositing paths

## PR 8 — Python/JS golden parity

- shared golden fixtures
- backend parity tests
- key node parity suite

## PR 9 — VIDEO contract

- settle native VIDEO public boundary
- FrameRange audio/timing
- Append fps/audio semantics
- compatibility tests

## PR 10 — Performance fixes

- Grain GPU RNG
- Distort batching
- Spherize grid reuse
- Preview limits
- optional lazy inputs

## PR 11 — Frontend architecture cleanup

- reduce `ops/implementation.ts`
- move code into domain modules
- no behavior change

## PR 12 — Release hardening + docs

- reusable quality workflow
- release gating
- minimum ComfyUI version
- documentation cleanup
- branch protection checklist

---

# 21. Acceptance commands

The following commands must pass locally/CI before a stabilization PR is considered complete.

```bash
python -m compileall nodes __init__.py server.py

python -m pytest tests/unit -v

# With a real ComfyUI checkout:
COMFYUI_ROOT=/path/to/ComfyUI \
python -m pytest tests/integration -v

npm ci
npm run check
npm run build
npm run test:js
npm run test:ts

git diff --exit-code js/
```

Add any repository-specific lint/static commands introduced during the work.

---

# 22. Definition of Done per PR

Every PR must include:

- [ ] concise problem statement
- [ ] exact behavior changed
- [ ] regression test
- [ ] no unrelated refactor
- [ ] frontend generated files committed if required
- [ ] unit tests green
- [ ] integration tests green if ComfyUI-facing
- [ ] frontend tests green if UI-facing
- [ ] no known workflow break
- [ ] docs updated when behavior changed

---

# 23. Anti-regression rules

Do not reintroduce any of these:

- hard-coded frontend list of fewer than 26 nodes
- permissive golden tests that catch/skip errors
- `Custom("IMAGE,VIDEO")`
- numeric outputs mapped to String
- hidden cyclic batch repeat as default behavior
- unbounded Constant/Ramp allocations
- Crop no-op based only on target size
- Spherize image/mask geometry mismatch
- documentation for nonexistent nodes
- release from a red commit

---

# 24. Final 9/10 scorecard

Use this scorecard only after the work is complete.

| Area | Minimum target |
|---|---:|
| Backend correctness | 9.0 |
| Geometry/GPU | 9.0 |
| Alpha/mask | 9.0 |
| Memory safety | 9.0 |
| Batch/animation | 9.0 |
| HDR/float | 8.5+ |
| ComfyUI V3 | 9.0 |
| VIDEO/timeline | 8.5+ |
| Frontend/live preview | 9.0 |
| Tests | 9.0 |
| CI/release | 9.0 |
| Docs/packaging | 9.0 |
| Maintainability | 9.0 |

The global score is not considered 9/10 if any critical category remains below 8.5 or if CI/release safety is below 9.

---

# 25. Final release checklist

Before declaring the stabilization project complete:

## Repository

- [ ] `main` protected
- [ ] Quality Gate required
- [ ] latest PR green
- [ ] current `main` green
- [ ] no stale generated JS

## Nodes

- [ ] 26/26 registered
- [ ] 26/26 schema contracts green
- [ ] all enums use Combo where appropriate
- [ ] all numeric outputs correctly typed
- [ ] no accidental custom object on IMAGE output

## Runtime

- [ ] `/imageops/viewmedia` registered
- [ ] route path security tested
- [ ] MemoryBudget enforced across large-allocation nodes
- [ ] mixed bypass tested
- [ ] BatchPolicy adopted by all multi-input nodes

## Image fidelity

- [ ] masks stay `[0,1]`
- [ ] alpha stays `[0,1]`
- [ ] image HDR values are not destroyed by identity/geometry operations
- [ ] backend/preview golden parity green

## VIDEO

- [ ] public IMAGE/VIDEO socket contracts are type-correct
- [ ] FrameRange timing behavior documented/tested
- [ ] Append fps policy documented/tested
- [ ] Append audio policy documented/tested

## Frontend

- [ ] frontend registry has all 26 nodes
- [ ] live preview smoke tests pass
- [ ] media preview works in real ComfyUI
- [ ] `implementation.ts` no longer a critical single point of failure or has a documented split plan

## Release

- [ ] nightly depends on Quality Gate
- [ ] stable tag release depends on Quality Gate
- [ ] registry publish depends on Quality Gate
- [ ] package metadata consistent
- [ ] minimum ComfyUI version documented

---

# 26. Completion statement expected from the agent

When all work is complete, the coding agent should produce a final engineering report containing:

1. list of PRs/commits,
2. list of fixed audit findings,
3. list of tests added,
4. final CI status,
5. compatibility matrix,
6. remaining known limitations,
7. node-by-node status table,
8. confirmation that no major feature was added during stabilization,
9. final estimated quality score with evidence.

Do not claim 9/10 merely because the code compiles. The score must be justified by green integration tests, contract coverage, release gates, runtime safety, and backend/preview parity.

---

# 27. One-line execution policy

> **Stabilize contracts first, then optimize, then refactor structure, and only after the repository is green and protected resume feature development.**

