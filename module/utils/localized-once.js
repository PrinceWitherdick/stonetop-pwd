/**
 * Build a localized reference table once, and hand out the same frozen copy thereafter.
 *
 * For the static reference this system reads out of i18n keys and module constants — the GM moves,
 * the Threats tab's guidance — where the finished shape never differs between renders, but the
 * sheet holding it re-renders on every prep-page write in the world.
 *
 * TWO things a bare `_cache ??= build()` gets wrong, and the reasons this exists:
 *
 *  • `localize` (utils/i18n.js) DEGRADES to returning the raw key when `game.i18n` is not up yet.
 *    It does not throw. So an unconditional memo that happened to be built early — a module
 *    rendering a sheet from a setup-time hook, a test that renders before installing the table —
 *    pins `stonetop.gmToolkit.threats.optional` as a visible label for the life of the page, on
 *    every sheet, with nothing logged. Rebuilding until the table is actually there costs a
 *    handful of lookups in the one case where the alternative is unrecoverable.
 *
 *  • What comes out is a process-lifetime singleton published into every render context and every
 *    `renderX` hook. An in-place `sort`, `splice` or property stamp by any consumer — a tab search
 *    filter, a host decorating a section — would corrupt it for every other open sheet until a
 *    page reload. Frozen, so that attempt fails at the write instead of days later.
 *
 * @param {() => any} build  assembles the table; called again on each miss until i18n is ready
 * @returns {() => any}      the reader
 */
export function localizedOnce(build) {
	let cached = null;
	return () => {
		if (cached) return cached;
		const built = deepFreeze(build());
		// Only KEEP it once the answer could have been right.
		if (globalThis.game?.i18n?.localize) cached = built;
		return built;
	};
}

/** Freeze a plain tree of objects and arrays. Cycles are not expected here and are not handled. */
export function deepFreeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
