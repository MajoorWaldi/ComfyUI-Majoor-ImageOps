// Stand-in for ComfyUI's browser-served scripts/api.js (see _stubs/app.js).
// Only the shape actually called at module load time needs to work.
export const api = {
    apiURL: (path) => path,
};
