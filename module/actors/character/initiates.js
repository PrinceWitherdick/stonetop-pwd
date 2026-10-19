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
 * The Gear an initiate starts with, to write onto their card, or null when there is nothing to write.
 * Olwin's insert line reads "Armor 1 (shield)", and the +1 Readiness a shield buys on a 7+ Defend
 * (p.216) is read off a TICKED Gear row naming a shield on every follower card, so the playbook gives
 * her that row rather than teaching each reader to parse her Armor text. Her Armor stays the printed
 * 1: a follower's Gear never adds to their Armor.
 *
 * Seeded the way initiateMoves seeds Moves: only onto a card nobody has written Gear to. A stored
 * list, even an empty one, is the player's (a Gear row removed stays removed).
 *
 * @param {object} det  the initiate's stored details
 * @param {object} opt  the playbook's option for them
 * @returns {Array<{label: string, checked: boolean}>|null}
 */
export function initiateGearSeed(det, opt) {
	if (Array.isArray(det?.gear)) return null;
	const gear = (Array.isArray(opt?.gear) ? opt.gear : [])
		.map(g => ({ label: String(g?.label ?? "").trim(), checked: !!g?.checked }))
		.filter(g => g.label);
	return gear.length ? gear : null;
}

/**
 * initiateGearSeed for the initiates named, as an `actor.update()` fragment (empty when none needs
 * it). The one place a pick, onboarding or the Details tab's tick, and the sweep for characters
 * made before the playbook carried the Gear (migration/follower-refresh.js) all seed it from.
 *
 * @param {object[]} backgrounds  the playbook's backgrounds
 * @param {object} flags          the character's resolved flags
 * @param {Iterable<string>} slugs the initiates to seed
 * @param {string} scope          the flag scope to write under
 */
export function initiateGearSeedData(backgrounds, flags, slugs, scope) {
	const data = {};
	for (const slug of slugs ?? []) {
		const gear = initiateGearSeed(flags?.initiateDetails?.[slug], initiateOption(backgrounds, slug));
		if (gear) data[`flags.${scope}.initiateDetails.${slug}.gear`] = gear;
	}
	return data;
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
	return backgroundChoicePatch(backgrounds, INITIATE_BACKGROUND, picked);
}

/**
 * Any background's "choose N" list as a `background.choices` patch, the way initiateChoicePatch sets the
 * Initiates: true for each of THAT background's options picked, false for the rest of them, and nothing
 * for another background's. `background.choices` is one flat map for every background a playbook has
 * (the Would-Be Hero's Driven and Destined sit beside each other in it), which is why every option slug
 * is unique across a playbook's backgrounds.
 *
 * @param {object[]} backgrounds  the playbook's backgrounds
 * @param {string} slug           the background whose list this is
 * @param {Iterable<string>} picked  the option slugs chosen (others' are ignored)
 * @returns {Object<string, boolean>}  empty when that background has no list
 */
export function backgroundChoicePatch(backgrounds, slug, picked) {
	const chosen = new Set(picked ?? []);
	const background = (Array.isArray(backgrounds) ? backgrounds : []).find(b => b?.slug === slug);
	return Object.fromEntries((background?.choices?.options ?? [])
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
