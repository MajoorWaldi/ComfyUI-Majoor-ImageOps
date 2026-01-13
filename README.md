# 🧩 ComfyUI-ImageOps — *Nuke-ish Image Processing for ComfyUI*  
> Live preview on-node (no queue), batch-safe ops, and interop adapters.  

## ✨ Features
- 🎛️ **KayTool-like sliders** (`display: slider`)
- 🖼️ **Live Preview** on ImageOps nodes (central module)
- 🎞️ **Video-friendly** (treat frames as IMAGE batches)
- 🧠 **Interop mode** (Core + WAS + heuristics) — no forks
- 📶 **Progress bar** on nodes during queued execution
- 🧩 PrimeIcon-prefixed display names (`pi pi-...`)

## 🚀 Install
1. Drop folder into: `ComfyUI/custom_nodes/ComfyUI-ImageOps`
2. Restart ComfyUI
3. Hard refresh browser: **Ctrl+F5**

## 🧰 Nodes
All nodes are in `image/imageops` category:
- `ImageOps ColorCorrect`
- `ImageOps Grade/Levels`
- `ImageOps HueSat`
- `ImageOps Merge`
- `ImageOps Preview (Output)`
…and more.

## 🧩 Live Preview Architecture
- `js/preview/host.js` → inject widget + loop for video
- `js/preview/renderer.js` → recursive render + caching
- `js/preview/registry.js` → adapters (core/WAS/generic/ImageOps)
- `js/preview/ops.js` → single source of truth for preview ops

## ⚠️ Notes
- Some packs use custom video types; best results when upstream provides frames as `IMAGE` batches.
- If ComfyUI logs `[DEPRECATION WARNING]`, an extension is using old frontend APIs.
- Config:
  - Preview canvas size: set `localStorage["imageops.preview.canvasSize"]` (int, default `512`).
  - Large allocation warning (Transform): set env `IMAGEOPS_LARGE_IMAGE_WARN_MB` (int, default `2048`).

## 📄 Docs
- `AGENTS.md` (rules & sources)
- `docs/CHANGES_AUDIT.md`
- `docs/CODEX_TASKLIST.md`
