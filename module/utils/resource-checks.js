/**
 * The circles of a resource track (a move's uses, an arcanum's charges, a pouch's Stock), as the
 * `resourceChecks` and `resourceGroups` Handlebars helpers hand them to the templates. PURE.
 *
 * Each circle is an empty `<button>`: nothing inside it for a screen reader to read, and the
 * label printed beside some of them ("low ammo") is not tied to it. So each carries its own
 * `name` ("Uses 2 of 3: low ammo"), which the templates print as its aria-label.
 * tests/utils/resource-checks.test.js; tests/templates/icon-conventions.test.js keeps every empty
 * control named.
 */

/** A circle's spoken name: the track's title (or "Mark"), which one of how many, and its label. */
export function resourceCheckName(title, index, max, label = null) {
	const what = String(title ?? "").trim() || "Mark";
	return `${what} ${index + 1} of ${max}${label ? `: ${label}` : ""}`;
}

/** Every circle of `resource`, in order: `{ checked, label, index, name }`. */
export function resourceCheckItems(resource) {
	if (!resource) return [];
	const { current, max, title } = resource;
	const labels = resource.labels || [];
	return Array.from({ length: max }, (_, i) => ({
		checked: i < current,
		label: labels[i] || null,
		index: i,
		name: resourceCheckName(title, i, max, labels[i] || null),
	}));
}

/**
 * The same circles chunked into fixed-size groups (default 5), so a long track reads in fives.
 * Each keeps its absolute index; groups stay atomic so they never split across a wrapped row.
 */
export function resourceCheckGroups(resource, size) {
	const items = resourceCheckItems(resource);
	const n = Number(size) > 0 ? Number(size) : 5;
	const groups = [];
	for (let i = 0; i < items.length; i += n) groups.push(items.slice(i, i + n));
	return groups;
}
