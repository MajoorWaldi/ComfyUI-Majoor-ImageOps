IN DEVELOPPEMENT  !!! 
# ComfyUI-Majoor-ImageOps
Essential Nodes Pack  for Images Processing for ComfyUI, with a **live embedded preview** inside the node (**no queue**) for supported chains.

## Nodes (category: `image/imageops`)
- **ImageOps Load Image** – uses the same upload UI as core Load Image
- **ImageOps ColorCorrect (Live)**
- **ImageOps Blur (Live)**
- **ImageOps Transform (Live)**
- **ImageOps Roto Mask (Live)** – draw a mask (paint or bezier) and use it as an effect/merge mask

## Live preview
- Backend nodes only compute when you **queue/execute**.
- Live preview is done in the **frontend** with a canvas.
- Chain preview works when the chain starts from **ImageOps Load Image** OR core **Load Image**.

## Install
Unzip into `ComfyUI/custom_nodes/` then restart ComfyUI.

## v4 note
- Live preview now supports **video sources** (e.g. VideoHelperSuite / VHS loaders) and other custom loaders (best-effort).
- Loader nodes are NOT visually modified; only ImageOps nodes show a preview canvas.


## Added nodes (v5)

- Grade / Levels
- Hue / Sat
- Invert
- Clamp
- Sharpen
- Edge Detect
- Merge (basic blend modes)
- Dilate / Erode (Mask)
- Glow
- Crop / Reformat (fit/fill/stretch)
- LumaKey (outputs MASK)
- Preview (Output) — images / animated webp / animated gif

### Progress bar

During queue execution, ImageOps nodes display a lightweight progress bar (based on ComfyUI websocket events).

## v5.1
- Fixed live preview + added interop (core + WAS best-effort).
- ImageOps Preview node now also has embedded live preview.
- External nodes are never visually modified.
