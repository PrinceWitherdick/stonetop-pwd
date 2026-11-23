// A whole number held to a range. Its own module, importing nothing, so the pure geometry and rules
// modules can share it without pulling in anything heavier. Guarded by tests/utils/custom-move-data.test.js.

// Coerce a value to an integer clamped to [lo, hi]; non-numeric / out-of-range → nearest bound.
// With a `fallback`, a value that is no finite number at all (missing, "abc", Infinity) is that
// instead (an imported playbook's unreadable count keeps its default).
export function clampInt(value, lo, hi, fallback) {
	const n = Math.trunc(Number(value));
	if (!Number.isFinite(n) && fallback !== undefined) return fallback;
	return Math.max(lo, Math.min(hi, n || 0));
}
