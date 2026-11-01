// The hit points an actor update wrote, read the one way. Its own module, importing nothing, so a hook on
// the character side (manifest.js) can ask it without pulling in the fight tab's state (fight/out-of-the-fight.js,
// which re-exports it).

/**
 * The hit points a committed diff wrote, or null when it did not touch them. Both spellings: a
 * sheet writes the dotted path, code building an update object writes the nested one. A cleared
 * field (null, "") is not a number written. PURE.
 */
export function writtenHp(changes = {}) {
	const nested = changes?.system?.attributes?.hp;
	const raw = nested && typeof nested === "object" && "value" in nested
		? nested.value
		: changes?.["system.attributes.hp.value"];
	if (raw === undefined || raw === null || raw === "") return null;
	const hp = Number(raw);
	return Number.isFinite(hp) ? hp : null;
}
