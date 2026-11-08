// SUMMONS FOLLOW THEIR CARD'S MARKED CONSEQUENCES (audit EDG-15, 2026-11-06).
//
// A summon entry (data/arcana-summons.js) may list `consequences`: what each Consequence on its card's reverse
// does to the follower once marked. The Mindgem's Mighty Servant is the one shipped (Book II pp.548-549):
//
//   □ It realizes its potential as a weapon. Replace the slow tag with the warrior tag, and its damage becomes
//     1d10+5 (hand, close, messy, forceful, 3 piercing).
//   □ It becomes aggressive and reckless in battle. Its attacks gain the area and dangerous tags.
//
// These are things the sheet can check (the □ is on the card), so they are imposed: when a holder's boxes on such
// a card change, its summoned follower's card is rewritten to what the marked Consequences say, and back when one
// is unmarked. A damage line or tag someone has typed in by hand is left alone: only a line this file would write
// itself (the printed one, or one of its changed forms) is rewritten, and only the entry's `swapTags` are made to tags.
//
// Each box is found by its printed label (backBoxChecked) on the back the card is read with here, not through
// data/arcana-rules.js: those rules are asked synchronously and need their backs primed, while this is async and
// reads the card anyway.
//
// Written by the client that made the change (its userId), which could write the character, having just done so.

import { SYSTEM_ID } from "../../system-id.js";
import { readableFlags } from "./StonetopFlags.js";
import { backBoxChecked } from "../../utils/glyphs.js";
import { ARCANA_SUMMONS, arcanaSummon } from "../../data/arcana-summons.js";

/** A card's summon entries whose Consequences change them. [] for any other card. */
function changingSummons(slug) {
	return (arcanaSummon(slug)?.followers ?? []).filter(f => f.consequences?.length);
}

/** The cards with such a summon, by slug. */
const CHANGING_SLUGS = new Set(Object.keys(ARCANA_SUMMONS).filter(slug => changingSummons(slug).length));

/** Which of a summon entry's Consequences are marked on its card's back, as their labels. PURE. */
export function markedSummonConsequences(entry, slug, backDescription, boxStates = {}) {
	return new Set((entry?.consequences ?? []).filter(c => backBoxChecked(backDescription, slug, c.label, boxStates)).map(c => c.label));
}

/** The summon's damage line with these Consequences marked (labels): the printed one, or the one a Consequence gives, plus their tags. PURE. */
export function summonDamage(entry, marked = new Set()) {
	const on = (entry?.consequences ?? []).filter(c => marked.has(c.label));
	const base = on.filter(c => c.damage).at(-1)?.damage ?? String(entry?.damage ?? "");
	const tags = on.flatMap(c => c.damageTags ?? []);
	return tags.length ? base.replace(/\)$/, `, ${tags.join(", ")})`) : base;
}

// Every line summonDamage can answer for an entry, lowercased: the ones this file may rewrite.
const _knownLines = new WeakMap();
function knownLines(entry) {
	if (_knownLines.has(entry)) return _knownLines.get(entry);
	const labels = (entry.consequences ?? []).map(c => c.label);
	const lines = new Set();
	for (let mask = 0; mask < 1 << labels.length; mask++) {
		lines.add(summonDamage(entry, new Set(labels.filter((_, i) => mask & (1 << i)))).toLowerCase());
	}
	_knownLines.set(entry, lines);
	return lines;
}

/** The summon's tags with each Consequence's `swapTags` made while it is marked, and undone while it is not. PURE. */
export function summonTags(entry, tags = [], marked = new Set()) {
	let list = Array.isArray(tags) ? [...tags] : [];
	const has = tag => list.some(t => String(t).toLowerCase() === tag);
	const swap = (from, to) => { list = list.map(t => (String(t).toLowerCase() === from ? to : t)); };
	for (const c of entry?.consequences ?? []) {
		for (const [from, to] of Object.entries(c.swapTags ?? {})) {
			if (marked.has(c.label)) { if (has(from) && !has(to)) swap(from, to); }
			else if (has(to) && !has(from)) swap(to, from);
		}
	}
	return list;
}

/**
 * The update that brings this character's cards of one summon in line with its card's marked Consequences, or
 * null when nothing changes. PURE.
 *
 * @param {object} customFollowers  the character's follower cards, by id
 * @param {object} entry            the summon entry (data/arcana-summons.js)
 * @param {Set<string>} marked      the labels of its Consequences marked (markedSummonConsequences)
 */
export function summonUpdate(customFollowers = {}, entry, marked = new Set()) {
	const update = {};
	for (const [id, card] of Object.entries(customFollowers ?? {})) {
		if (!entry?.sourceUuid || card?.sourceUuid !== entry.sourceUuid) continue;
		const base = `flags.${SYSTEM_ID}.customFollowers.${id}`;
		const damage = summonDamage(entry, marked);
		if (knownLines(entry).has(String(card.damage ?? "").trim().toLowerCase()) && card.damage !== damage) update[`${base}.damage`] = damage;
		const tags = summonTags(entry, card.tags, marked);
		if (JSON.stringify(tags) !== JSON.stringify(card.tags ?? [])) update[`${base}.tags`] = tags;
	}
	return Object.keys(update).length ? update : null;
}

/** The cards with a changing summon whose box marks an actor update wrote. PURE. */
function wroteSummonBoxes(changes) {
	const boxes = changes?.flags?.[SYSTEM_ID]?.arcana?.boxes;
	if (!boxes || typeof boxes !== "object") return [];
	return [...new Set(Object.keys(boxes).map(key => key.split(":")[0]))].filter(slug => CHANGING_SLUGS.has(slug));
}

/**
 * Bring a card's summoned followers in line with the holder's marks on it (see the header). Answers whether it wrote.
 *
 * @param {Actor} actor
 * @param {string} slug  the card
 * @param {{card?: (actor: Actor, slug: string) => Promise<object|null>}} [deps]
 */
export async function settleSummons(actor, slug, { card = (a, s) => a?.typedActor?._arcana?.getArcanum?.(s) } = {}) {
	if (actor?.type !== "character") return false;
	const entries = changingSummons(slug);
	const followers = readableFlags(actor)?.customFollowers ?? {};
	const held = entries.filter(e => Object.values(followers).some(f => f?.sourceUuid === e.sourceUuid));
	if (!held.length) return false;
	const item = await card(actor, slug);
	const back = item?.back?.description;
	if (!back) return false;
	const boxes = actor.typedActor?._arcana?.boxStates ?? {};
	const update = Object.assign({}, ...held.map(e => summonUpdate(followers, e, markedSummonConsequences(e, slug, back, boxes)) ?? {}));
	if (!Object.keys(update).length) return false;
	await actor.update(update, { stonetopMove: item.back?.title ?? item.front?.title ?? slug });
	return true;
}

/**
 * Listen. Registered once, from stonetop.js.
 * @returns {() => void} stops listening
 */
export function installSummonConsequenceHooks({ hooks = globalThis.Hooks } = {}) {
	const id = hooks.on("updateActor", (actor, changes, _options, userId) => {
		if (userId && userId !== globalThis.game?.user?.id) return;
		if (actor?.type !== "character") return;
		for (const slug of wroteSummonBoxes(changes)) {
			settleSummons(actor, slug).catch(err => console.error(`Stonetop | the ${slug} card could not change its summoned follower`, err));
		}
	});
	return () => hooks.off("updateActor", id);
}
