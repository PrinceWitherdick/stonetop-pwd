// THE PER-CARD ARCANA RULES THE SHEET CHECKS, by slug, in one place: what each card adds to a blow
// (actors/character/arcana-blow-offers.js), what it does to a blow that lands on its bearer
// (actors/character/arcana-defender.js), the weapons its realised side is carried as (data/weapons.js
// #ARCANA_GRANTED_WEAPONS and the riders), and the back moves it gives over time (PACED_BACK_MOVES).
//
// EVERY BOX IS NAMED BY ITS PRINTED LABEL, never by a bare index: marks are stored by index in document order
// (`slug:back:index`), so an index written here would go stale the day a card's printed boxes move
// (CharacterArcana.js#BOX_LAYOUT_CHANGES). The index is read off the card's own back text instead
// (utils/glyphs.js#boxIndexBefore, #circleRunAfter), the way backBoxChecked reads it.
//
// The riders and defences are asked synchronously (fight/hero-moves.js#blowOffers, the damage window), while
// the cards' text lives in the compendium. So the backs of the cards named here are noted as they load
// (noteArcanumBack, from repositories/FoundryArcanaRepository.js: the cards a character holds are primed at
// `ready` and again as they are gained), and a rule whose
// card has not been read yet reads as unmarked. Shipped cards win a slug over homebrew, so the pack's text is
// the one these rules follow.

import { boxIndexBefore, circleRunAfter, maskGlyphLabels } from "../utils/glyphs.js";

/** The weapons a card's realised side is carried as: the curio's slug, under the name that side gives it. */
export const ARCANA_WEAPONS = Object.freeze({
	flamingSword:   Object.freeze({ slug: "rusty-steel-blade", name: "Flaming Sword" }),
	aetheriumSpear: Object.freeze({ slug: "corroded-spearhead", name: "Aetherium Spear" }),
	thunderboltBow: Object.freeze({ slug: "bow-with-no-string", name: "Thunderbolt Bow" }),
});

const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** Whether a weapon or gear record is `weapon`'s curio, carried under the realised side's name. PURE. */
export function isArcanumWeapon(record, weapon) {
	return !!record && record.slug === weapon.slug && sameName(record.name, weapon.name);
}

/** A rider's or defence's line in the damage window: its words' key, its dice or roll mode, its tags. */
const lines = (...rows) => Object.freeze(rows.map(row => Object.freeze({ ...row, ...(row.tags ? { tags: Object.freeze(row.tags) } : {}) })));

/**
 * What a card adds to its bearer's blow (arcana-blow-offers.js), in the order the window lists them. `label` names
 * the back □ that must be marked, `run` how many □ end at it (the blood-rage's □□□), `track` that the ○ run after
 * the label is a hold track that must hold at least one. `weapon`: only on a blow with the card's own weapon.
 * `on`: only on a Clash ("clash") or on any other blow ("shot"). `strikeBack: false`: never on a strike back.
 * `spend`: what a ticked line costs ("debility", or "track", 1 ○ off the hold track). `lines` are what it adds,
 * keyed under `stonetop.fight.arcanaBlows`; `blaze` is the Flaming Sword's die, read off its track, ticked.
 */
export const ARCANA_RIDERS = Object.freeze({
	flamingSword:  Object.freeze({ ...ARCANA_WEAPONS.flamingSword, weapon: true,
		lines: lines({ key: "blaze", blaze: true, applied: true }) }),
	aetherium:     Object.freeze({ ...ARCANA_WEAPONS.aetheriumSpear, weapon: true, on: "clash", spend: "debility",
		lines: lines({ key: "aetherium", dice: "1d6", tags: ["forceful", "loud"] }) }),
	thunderbolt:   Object.freeze({ ...ARCANA_WEAPONS.thunderboltBow, weapon: true, on: "shot",
		lines: lines({ key: "thunderbolt", dice: "1d4", tags: ["area", "dangerous"] }) }),
	stormsFury:    Object.freeze({ slug: "storm-markings", name: "Storm's Fury", label: "STORM'S FURY", track: true, spend: "track",
		lines: lines({ key: "stormsFury", dice: "1d6", tags: ["forceful", "loud"] }) }),
	promiseOfDoom: Object.freeze({ slug: "twisted-spear", name: "Promise of Doom", label: "PROMISE OF DOOM", strikeBack: false,
		lines: lines({ key: "doomSworn", dice: "2d4" }, { key: "doomOther", dice: "-4" }) }),
	herd:          Object.freeze({ slug: "shield-of-the-wisent-witch", name: "Spirits of the Herd", label: "SPIRITS OF THE HERD", on: "clash",
		lines: lines({ key: "herd", dice: "2d4", tags: ["forceful", "messy", "area", "dangerous"] }) }),
	bloodRage:     Object.freeze({ slug: "blood-quenched-sword", name: "Blood-quenched Sword", label: "You lose yourself in a blood-rage", run: 3,
		lines: lines({ key: "bloodRage", mode: "adv" }) }),
});

/**
 * What a card does to a blow that lands on its bearer (arcana-defender.js). A Consequence's □ is printed right
 * before its words (`label`), and `line` is what it adds to the damage window once marked, keyed under
 * `stonetop.fight.arcanaDefence.<i18n>`. The Demonhide Cloak's `armor` holds against demons (demonhideFloor).
 */
export const ARCANA_DEFENCES = Object.freeze({
	iceSphere: Object.freeze({ slug: "norubas-ice-sphere", label: "When you take damage from fire, roll twice and take the higher result", adjacent: true,
		line: Object.freeze({ key: "arcana-ice-sphere", i18n: "iceSphere", mode: "adv" }) }),
	redwood:   Object.freeze({ slug: "redwood-effigy", label: "The effigy becomes both fragile and highly flammable", adjacent: true,
		line: Object.freeze({ key: "arcana-redwood-fire", i18n: "redwood", dice: "1d6" }) }),
	demonhide: Object.freeze({ slug: "demonhide-cloak", armor: 1 }),
});


/**
 * Major arcana whose back moves come over time (Book II, Appendix D), by slug. `rule` quotes the card;
 * `earn` says how many moves it has given: `{ consequences: { per } }` one per `per` Consequences
 * marked, `{ consequences: { atLeast } }` one once that many are, `{ tasks: { from } }` one at `from`
 * front tasks and one more per task after, `{ cycles: true }` one per completed unlock track (these
 * cards erase their marks, so the count is kept: CharacterArcana#completionCount). `choices` are the
 * back □ the moves are ticked in, found by their printed LABEL (boxIndexBefore), as backBoxChecked is.
 * A move the card gives outright at unlock (Mindwalking, Siphon) is in `choices` only where the card
 * counts it among the moves it gives over time (the Hungering Maw's Siphon is its first).
 */
export const PACED_BACK_MOVES = Object.freeze({
	"norubas-ice-sphere": Object.freeze({
		page: "Book II p.547", earn: { consequences: { per: 2 } },
		rule: "For every 2 Consequences you mark, gain one of the following moves",
		choices: ["A MIGHTY WILL", "FARWALKER", "TELEPATHY", "THOUGHTCRAFTER"],
	}),
	"redwood-effigy": Object.freeze({
		page: "Book II p.571", earn: { consequences: { per: 2 } },
		rule: "For every 2 Consequences you mark, gain one of the following moves",
		choices: ["GREATER CONDUIT", "THE ROOTS GROW DEEP", "WE ARE AS ONE"],
	}),
	"twisted-spear": Object.freeze({
		page: "Book II p.542", earn: { tasks: { from: 3 } },
		rule: "When you have marked 3 tasks... Choose one of the moves on the reverse... Each time you mark a task thereafter, gain another move from the reverse",
		choices: ["WHISPERS", "PROMISE OF DOOM", "ROOTS OF THE ELDER TREE", "DARKNESS LINGERS"],
	}),
	"demonhide-cloak": Object.freeze({
		page: "Book II p.545", earn: { consequences: { atLeast: 3 } },
		rule: "When you have marked 3 Consequences, you gain the following move",
		choices: ["UNHOLY VISAGE"],
	}),
	"blood-quenched-sword": Object.freeze({
		page: "Book II p.553", earn: { consequences: { atLeast: 3 } },
		rule: "When you have marked 3 consequences, you gain A Flickering Flame",
		choices: ["A FLICKERING FLAME"],
	}),
	"storm-markings": Object.freeze({
		page: "Book II p.567", earn: { consequences: { atLeast: 3 } },
		rule: "When you have marked 3 consequences, you gain Chosen of the Storm-bringer",
		choices: ["CHOSEN OF THE STORM-BRINGER"],
	}),
	"azure-hand": Object.freeze({
		page: "Book II p.574", earn: { cycles: true },
		rule: "When you make the last mark, you unlock the mysteries of the Azure Hand--choose one of the moves on the reverse, and erase all marks above",
		choices: ["BATTERY", "EYE OF THE STORM", "RESONANCE"],
	}),
	"hungering-maw-of-hlad": Object.freeze({
		page: "Book II p.572", earn: { cycles: true },
		rule: "When you make the last mark, you unlock the ring's mysteries. Gain Siphon (see reverse) and erase all the marks. Each time you mark the third circle, gain another move from the reverse",
		choices: ["SIPHON", "INESCAPABLE PULL", "MAELSTROM", "DUST TO DUST"],
	}),
	"rune-laden-scales": Object.freeze({
		page: "Book II p.562", earn: { cycles: true },
		rule: "When you make the last mark, you unlock the mysteries of the armor. Gain a move of your choice (see reverse), but also mark a consequence. Then, erase all marks",
		choices: ["INDOMITABLE", "MAGNET", "POWER SINK", "PROOF AGAINST HARM"],
	}),
	"ineffable-words": Object.freeze({
		page: "Book II p.568", earn: { cycles: true }, name: "Words",
		rule: "Choose 1 Word that you have mastered and erase all marks above. Thereafter, when you make the last mark, choose another Word to master and erase all marks",
		choices: ["Seal.", "Purify.", "Gather.", "Empower."],
	}),
});

/** The cards whose backs the label rules above read (the riders' and defences'). */
export const ARCANA_RULE_SLUGS = Object.freeze([...new Set(
	[...Object.values(ARCANA_RIDERS), ...Object.values(ARCANA_DEFENCES)].filter(r => r.label).map(r => r.slug),
)]);

const _backs = new Map();
const _resolved = new Map();

/** Note a card's back text as it loads, so the rules can find their boxes on it. Only the rules' cards are kept. */
export function noteArcanumBack(slug, html) {
	if (!ARCANA_RULE_SLUGS.includes(slug) || typeof html !== "string" || _backs.get(slug) === html) return;
	_backs.set(slug, html);
	_resolved.clear();
}

function _resolve(rule) {
	const key = `${rule.slug}\u0000${rule.label}`;
	if (_resolved.has(key)) return _resolved.get(key);
	const back = _backs.get(rule.slug);
	let out = { boxes: [], track: null };
	if (back !== undefined) {
		const last = boxIndexBefore(back, rule.label, { adjacent: !!rule.adjacent });
		const run = rule.run ?? 1;
		const boxes = last >= 0 ? Array.from({ length: run }, (_, i) => last - run + 1 + i).filter(i => i >= 0) : [];
		let track = null;
		if (rule.track) {
			const text = maskGlyphLabels(back);
			const at = text.indexOf(rule.label);
			const found = at >= 0 ? circleRunAfter(text, at) : null;
			track = found ? Object.freeze({ from: found.from, length: found.length }) : null;
		}
		out = { boxes: Object.freeze(boxes), track };
		_resolved.set(key, out);
	}
	return out;
}

/** The back □ indices a label rule names (one, or its `run` ending at the label). [] while its card is unread. */
export function ruleBoxes(rule) {
	return rule?.label ? _resolve(rule).boxes : [];
}

/** The ○ hold track after a `track` rule's label, `{from, length}`, or null while its card is unread. */
export function ruleTrack(rule) {
	return rule?.track ? _resolve(rule).track : null;
}

/** Whether any of a label rule's back □ is marked in `boxes` (an arcana box map). */
export function ruleMarked(boxes, rule) {
	return ruleBoxes(rule).some(i => !!boxes?.[`${rule.slug}:back:${i}`]);
}
