/**
 * The Initiates of Danu (Book I p.145): "Blessed, if you took the Initiate background, then you chose
 * 2 or 3 of the following as your fellow initiates. Mark those you picked and treat them as followers.
 * Cross off the others."
 *
 * TWO CONDITIONS, AND BOTH ARE THE RULE. An initiate is a follower only while the Initiate background
 * is the one taken AND they were picked. The picks are stored per option slug under
 * `background.choices`, beside the background itself, and they are deliberately left there when the
 * background changes: a Blessed who tries Vessel and comes back to Initiate finds Enfys and Olwin
 * where they left them, with their HP, Loyalty, portrait and NPC intact. So every reader asks here
 * rather than reading the picks alone, which is how a Blessed who became a Vessel kept two followers
 * the book no longer gave them.
 *
 * Kept Foundry-free so the rule can be tested with plain objects.
 */

/** The background the insert belongs to. */
export const INITIATE_BACKGROUND = "initiate";

/**
 * Is this initiate one of the character's followers right now?
 *
 * @param {object} flags  the character's flags, as the sheet reads them (`background.selected`,
 *   `background.choices`)
 * @param {string} slug   the initiate's option slug ("enfys")
 */
export function initiateActive(flags, slug) {
	const background = flags?.background;
	return background?.selected === INITIATE_BACKGROUND && !!slug && !!background?.choices?.[slug];
}

/** The playbook's Initiate background entry, or null. */
export function initiateBackground(backgrounds) {
	return (Array.isArray(backgrounds) ? backgrounds : []).find(b => b?.slug === INITIATE_BACKGROUND) ?? null;
}

/** One initiate as the playbook prints them, or null. */
export function initiateOption(backgrounds, slug) {
	return initiateBackground(backgrounds)?.choices?.options?.find(opt => opt?.slug === slug) ?? null;
}

/**
 * The initiates this character keeps as followers, in the insert's order. Empty for anyone without
 * the Initiate background, whatever picks are stored.
 *
 * @param {object[]} backgrounds  the playbook's backgrounds
 * @param {object} flags          the character's flags
 */
export function activeInitiateOptions(backgrounds, flags) {
	return (initiateBackground(backgrounds)?.choices?.options ?? []).filter(opt => initiateActive(flags, opt?.slug));
}

/**
 * Whether an initiate is exceptional: the player's own toggle when they have set it, else what the
 * insert prints (Seren the Eldest is "Exceptional", so her orders roll +2 rather than +1).
 *
 * `??`, not `||`: a Seren toggled OFF by her player stays off.
 *
 * @param {object} det  the initiate's stored details (`initiateDetails.<slug>`)
 * @param {object} opt  the playbook's option for them
 */
export function initiateExceptional(det, opt) {
	return !!(det?.exceptional ?? opt?.exceptional);
}

/**
 * An initiate's Moves, as the card's one-per-line text: whatever the player saved, else the three the
 * insert prints. A saved "" is the player clearing them and stays empty; only a card nobody has
 * written Moves to is seeded.
 *
 * @param {object} det  the initiate's stored details
 * @param {object} opt  the playbook's option for them
 */
export function initiateMoves(det, opt) {
	if (det?.moves != null) return String(det.moves);
	return (Array.isArray(opt?.moves) ? opt.moves : []).map(m => String(m ?? "").trim()).filter(Boolean).join("\n");
}

/**
 * The whole set of initiate picks, as a `background.choices` patch: true for each one picked and false
 * for every other initiate. The insert is a set, not a list to grow, so re-running onboarding without
 * Enfys crosses her off rather than leaving her ticked beside her replacement.
 *
 * @param {object[]} backgrounds  the playbook's backgrounds
 * @param {Iterable<string>} picked  the slugs chosen
 * @returns {Object<string, boolean>}  empty when the playbook has no initiates
 */
export function initiateChoicePatch(backgrounds, picked) {
	const chosen = new Set(picked ?? []);
	return Object.fromEntries((initiateBackground(backgrounds)?.choices?.options ?? [])
		.filter(opt => opt?.slug)
		.map(opt => [opt.slug, chosen.has(opt.slug)]));
}

/**
 * Where a background's "choose N or M" stands: whether the list is full (so the unticked options can
 * be disabled, as possession choices are at their cap) and whether it is still short.
 *
 * SHORT IS A FLAG, NEVER A BLOCK. A Blessed with one initiate ticked is told so, and nothing refuses
 * the tick or its removal.
 *
 * @param {number[]|number} count  the background's `choices.count` ([2, 3])
 * @param {number} checked         how many are ticked
 */
export function choiceCountState(count, checked) {
	const range = (Array.isArray(count) ? count : [count]).map(Number).filter(Number.isFinite);
	const n = Math.max(0, Number(checked) || 0);
	if (!range.length) return { min: 0, max: Infinity, checked: n, atMax: false, underMin: false };
	const min = Math.min(...range);
	const max = Math.max(...range);
	return { min, max, checked: n, atMax: n >= max, underMin: n < min };
}
