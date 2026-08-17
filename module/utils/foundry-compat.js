// Version shims for Foundry APIs that moved or changed across v12–v14. Keeping the
// branching in one place means new call sites pick the right form automatically and
// a future "drop v12" cleanup is a single edit rather than a hunt.

/**
 * Resolve a drag event's payload. V13 moved TextEditor under
 * `foundry.applications.ux` and deprecated the bare global; prefer the namespaced
 * implementation, fall back to the global on older cores.
 * @param {DragEvent} ev
 */
export function getDragEventData(ev) {
	const textEditor = foundry?.applications?.ux?.TextEditor?.implementation;
	return textEditor?.getDragEventData?.(ev) ?? globalThis.TextEditor?.getDragEventData?.(ev);
}

/**
 * Does this path point at a video rather than a still image? V13 moved VideoHelper under
 * `foundry.helpers.media`; fall back to the global, then to the extension list core itself
 * uses (which also covers a headless test with no Foundry globals at all).
 * @param {string} path
 * @returns {boolean}
 */
export function hasVideoExtension(path) {
	const helper = globalThis.foundry?.helpers?.media?.VideoHelper ?? globalThis.VideoHelper;
	if (typeof helper?.hasVideoExtension === "function") return !!helper.hasVideoExtension(path);
	return /\.(webm|mp4|m4v|ogv)(\?|#|$)/i.test(String(path));
}

/**
 * The configured FilePicker class. V13 moved it under `foundry.applications.apps` and routes
 * subclassing through `.implementation`; older cores expose the bare global. Returns undefined
 * in a headless test with no Foundry globals, so callers can guard.
 * @returns {typeof FilePicker|undefined}
 */
export function filePicker() {
	const moved = globalThis.foundry?.applications?.apps?.FilePicker;
	return moved?.implementation ?? moved ?? globalThis.FilePicker;
}

/**
 * Write one file and answer with the path it can be fetched from, or null if it was not written.
 *
 * Here, with the other host-and-version shims, because BOTH of the awkward parts are the host's
 * doing and neither is discoverable from the call site:
 *
 * A REJECTED upload does not throw. Foundry's own FilePicker returns false when the server answers
 * with an error and undefined when it answers without a path, and The Forge's replacement returns
 * false on every failure path it has (a quota, a bad response, an asset the API refused to
 * create). A caller that reads the result as a path gets a falsy value and, if it papers over that
 * with a rebuilt path, hands back the name of a file nobody wrote — which is how a run reports
 * "rebuilt 143 pictures" having saved none, and how a token ends up stamped with a permanently
 * broken image. Null is the one answer that cannot be mistaken for success.
 *
 * And where the file LANDS is the server's call, not ours. Off the data path (The Forge's Assets
 * Library) `result.path` is the only thing that names it correctly, so it is believed whenever it
 * is given; the rebuilt path is for a FilePicker that reports success without one.
 *
 * `notify: false` throughout: every caller reports its own outcome, and a per-file core toast in a
 * 140-file batch is a wall of them.
 *
 * @returns {Promise<string|null>} the fetchable path, or null if the upload was refused.
 */
export async function uploadFile(source, dir, file, options = { overwrite: true }) {
	const FP = filePicker();
	const result = await FP.upload(source, dir, file, options, { notify: false });
	if (!result) return null;
	return result.path || `${dir}/${file.name}`;
}

/**
 * Repoint one key of a rendered Application's `options`. ApplicationV2 hands out a frozen
 * options object (`this.options = Object.freeze(...)`), so assigning a key through it throws
 * under strict mode — but the field holding it is a plain writable property, so swap in a
 * fresh frozen copy. AppV1 windows keep a mutable object and are written in place. Needed
 * because a re-render reads its state back off `options`, so a change that skips it is lost.
 * @param {Application} app
 * @param {string} key
 * @param {*} value
 */
export function setAppOption(app, key, value) {
	const options = app?.options;
	if (!options) return;
	if (Object.isFrozen(options)) app.options = Object.freeze({ ...options, [key]: value });
	else options[key] = value;
}

/**
 * Build an ImagePopout, in the shape v13 wants.
 *
 * v13 made ImagePopout an ApplicationV2 and moved both of its inputs: the path from the first
 * positional argument to `options.src`, and the window title to `options.window.title`. The old
 * `new ImagePopout(src, {title})` still opens the window — it just logs two deprecation warnings
 * every time it does, and the shim is scheduled for removal in v15. This system is v13+ only, so
 * there is no older shape to keep.
 *
 * NO width/height, deliberately. ImagePopout's `_preFirstRender` assigns over `options.position`
 * wholesale with dimensions measured from the image itself (falling back to 480x480), so a size
 * passed in here is discarded before the window is ever drawn. Offering the parameter would only
 * invite callers to keep setting one that does nothing — the old call sites all did.
 *
 * Returns null where the global is absent (a test env, a core that renamed it), so callers can
 * hand the result on and let a missing window be a missing window rather than a throw.
 *
 * @param {{src: string, title?: string}} opts
 */
export function imagePopout({ src, title } = {}) {
	const Popout = globalThis.ImagePopout;
	if (!Popout) return null;
	return new Popout(title == null ? { src } : { src, window: { title } });
}

/** An open ImagePopout's window title, across the same move. */
export function imagePopoutTitle(popout) {
	return popout?.options?.window?.title ?? popout?.options?.title ?? "";
}

/**
 * Render a Handlebars template file to HTML. V13 moved `renderTemplate` under
 * `foundry.applications.handlebars` and deprecated the bare global; prefer the namespaced
 * implementation and fall back to the global on older cores.
 * @param {string} path  System-relative template path (as passed to loadTemplates).
 * @param {object} data  The template's context.
 * @returns {Promise<string>}
 */
export function renderTemplate(path, data) {
	const handlebars = globalThis.foundry?.applications?.handlebars;
	if (typeof handlebars?.renderTemplate === "function") return handlebars.renderTemplate(path, data);
	return globalThis.renderTemplate(path, data);
}

/**
 * Enrich stored HTML for display (resolves `@UUID` links, inline rolls, etc.).
 * V13 moved TextEditor under `foundry.applications.ux`; on older cores (or before
 * it's ready) fall back to the raw value so callers always get a usable string.
 * @param {string} value
 * @param {object} [options]  Passed through to TextEditor.enrichHTML (e.g. `{ secrets: false }`).
 * @returns {Promise<string>}
 */
export async function enrichHTML(value, options) {
	const textEditor = foundry?.applications?.ux?.TextEditor;
	if (!textEditor?.enrichHTML) return value ?? "";
	return textEditor.enrichHTML(value ?? "", options);
}

/**
 * Build the `document.update()` entry that deletes `keyPath`. Only **v14+** removes a
 * key when the update value is a fresh `new ForcedDeletion()` INSTANCE (the core deletes
 * a key only when its value is `instanceof ForcedDeletion`), and only v14+ warns on the
 * legacy `-=` syntax. v13 exposes the same operator class, but a nested ForcedDeletion
 * value passed to `Document#update` for an object-typed flag is NOT applied there — the
 * key silently survives with no error (this is why followers wouldn't delete/hand off on
 * v13). v13 and earlier delete reliably via the `-=` leaf-key prefix, which the codebase
 * already uses directly elsewhere. So reach for the operator only on v14+ (gated on the
 * running generation, not merely the class's existence) and use `-=` below it. Returns
 * `[updateKey, value]` for whichever form this core actually applies.
 * @param {string} keyPath  Dotted path to the key to delete (e.g. "flags.stonetop.checks.c1").
 * @returns {[string, *]}
 */
export function deletionEntry(keyPath) {
	const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
	const generation = Number(globalThis.game?.release?.generation) || 0;
	if (ForcedDeletion && generation >= 14) return [keyPath, new ForcedDeletion()];
	const i = keyPath.lastIndexOf(".");
	return [`${keyPath.slice(0, i + 1)}-=${keyPath.slice(i + 1)}`, null];
}

/**
 * The compendium-source uuid a world document was imported from: v14 stamps
 * `_stats.compendiumSource` at import time; older cores used the legacy `flags.core.sourceId`
 * flag. Returns null for a hand-made world document that never came from a compendium.
 * Works on real Documents and on plain index rows (reads properties, never calls the doc).
 * @param {object} doc
 * @returns {string|null}
 */
export function compendiumSourceOf(doc) {
	return doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? null;
}
