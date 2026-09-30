// Redirects imports of ComfyUI's browser-served scripts/*.js (served by the real
// frontend package at runtime; not files that exist in this backend-only
// checkout) to local stubs, so node --test can load preview modules that import
// them transitively even when the test itself never exercises that code path.
const STUBS = new Map([
    ["app.js", new URL("./_stubs/app.js", import.meta.url).href],
    ["api.js", new URL("./_stubs/api.js", import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
    const match = /\/scripts\/([\w.-]+\.js)$/.exec(specifier.replace(/\\/g, "/"));
    const stubUrl = match && STUBS.get(match[1]);
    if (stubUrl) {
        return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
