// A HOMEBREW MOVE THAT DRAWS MINOR ARCANA: the Familiar Face's Occult Interest, "Draw three random Minor
// Arcana and choose one; you have unlocked its secrets" (playbooks/move-words.js#occultDrawFrom). The
// Seeker's own creation draw, reused (Book I p.136, "Draw 3 at random", CharacterOnboardingDialog
// #_drawSeekerMinorArcana): from the minors no character in the world holds, the GM's finished homebrew
// minors among them when the GM's switch says so. The one kept is the Seeker's MASTERED card: owned,
// identified, and its unlock requirements met (StonetopCharacter#masterArcanum).
//
// Owed once per move: the move card's hand asks for it until the draw is made, and the card drawn is
// recorded under the move's name (OCCULT_DRAWS_FLAG), so the hand goes.

import { SYSTEM_ID, ARCANA_PACK } from "../../system-id.js";
import { occultDrawFrom } from "../../playbooks/move-words.js";
import { learnedHomebrewMoves } from "./homebrew-roll-bends.js";
import { drawableMinorSlugs } from "./seeker-collection.js";
import { shuffle } from "../../utils/arrays.js";
import { escHtml, stripHtmlToText } from "../../utils/strings.js";

/** `{moveKey: arcanumSlug}`: the card each drawing move kept, under occultDrawKey(its name). */
export const OCCULT_DRAWS_FLAG = "occultDraws";

/**
 * The key a move's kept card is recorded under: its name with every dot made an underscore, since
 * Foundry reads a dot in an update path as a level ("St. Agnes's Interest" would nest). PURE.
 */
export function occultDrawKey(moveName) {
	return String(moveName ?? "").replace(/\./g, "_");
}

// The characters a draw is being made for right now, so a second click doesn't deal a second hand.
const _drawing = new Set();

/**
 * The learned homebrew moves still owed their draw, by name, with how many cards each draws:
 * `Map(name -> count)`. PURE but for reading the actor.
 */
export function occultDrawsOwed(actor) {
	const done = actor?.flags?.[SYSTEM_ID]?.[OCCULT_DRAWS_FLAG] ?? {};
	const owed = new Map();
	for (const { item, words } of learnedHomebrewMoves(actor)) {
		if (done[occultDrawKey(item.name)]) continue;
		const read = occultDrawFrom(words);
		if (read) owed.set(item.name, read.count);
	}
	return owed;
}

/** The Minor Arcana a draw can come from, `[{slug, name, front, back}]`: the pack's, then the world's homebrew ones. */
async function minorDeck() {
	const [{ ensurePackIndex }, { isMajorArcana }, { seekerHomebrewMinors }] = await Promise.all([
		import("../../utils/pack-index.js"),
		import("../../arcana-icons.js"),
		import("./dialogs/CharacterOnboardingDialog.js"),
	]);
	const pack = await ensurePackIndex(ARCANA_PACK, ["system.moveType"]);
	const entries = pack ? pack.index.filter(entry => entry.system?.moveType === "arcanum") : [];
	const packDocs = pack ? await Promise.all(entries.map(entry => pack.getDocument(entry._id))) : [];
	const seen = new Set();
	return [...packDocs.filter(Boolean), ...seekerHomebrewMinors()].flatMap(doc => {
		const flags = doc.flags?.stonetop ?? {};
		const slug = flags.slug;
		if (!slug || seen.has(slug) || isMajorArcana(slug)) return [];
		seen.add(slug);
		const first = html => stripHtmlToText(String(html ?? "").match(/<p\b[^>]*>[\s\S]*?<\/p>/i)?.[0] ?? html ?? "").slice(0, 260);
		return [{ slug, name: String(doc.name ?? flags.front?.title ?? slug), front: first(flags.front?.description), back: first(flags.back?.description) }];
	});
}

/**
 * Draw for `moveName`: `count` cards at random from those no one holds (`held`), the player keeps one,
 * and the character takes it unlocked. Resolves to the kept slug, or null when backed out of or there
 * was nothing to draw.
 *
 * @param {Actor} actor
 * @param {string} moveName
 * @param {object} [opts]
 * @param {number} [opts.count]
 * @param {Iterable<string>} [opts.held]  minors other characters hold (the sheet's _heldMinorArcana)
 */
export async function runOccultDraw(actor, moveName, { count = 3, held = [] } = {}) {
	const character = actor?.typedActor;
	if (!character) return null;
	const key = actor.uuid ?? actor.id;
	if (_drawing.has(key)) return null;
	_drawing.add(key);
	try { return await _draw(actor, character, moveName, count, held); }
	finally { _drawing.delete(key); }
}

async function _draw(actor, character, moveName, count, held) {
	const deck = await minorDeck();
	const ownHeld = new Set([...held, ...(character.ownedArcanaSlugs ?? [])]);
	const drawn = shuffle(drawableMinorSlugs(deck, ownHeld)).slice(0, count).map(slug => deck.find(c => c.slug === slug));
	if (!drawn.length) {
		ui.notifications?.warn?.("There are no Minor Arcana left to draw: every one is held by someone.");
		return null;
	}
	const { askWithButtons } = await import("../../utils/ask-with-buttons.js");
	const kept = await askWithButtons({
		title: `${moveName}: choose one`,
		content: `<p>You drew ${drawn.length === 1 ? "one Minor Arcanum" : `${drawn.length} Minor Arcana`}. Choose one: you have unlocked its secrets.</p>`
			+ drawn.map(c => `<p><strong>${escHtml(c.name)}</strong><br>${escHtml(c.front)}${c.back ? `<br><em>${escHtml(c.back)}</em>` : ""}</p>`).join(""),
		buttons: drawn.map(c => ({ key: c.slug, label: `Keep ${c.name}`, icon: "fa-hand-sparkles", value: c.slug })),
		defaultKey: false,
	});
	if (!kept || !drawn.some(c => c.slug === kept)) return null;
	if (!character.ownedArcanaSlugs?.has?.(kept)) await character.addArcanum(kept);
	await character.identifyArcanum(kept);
	await character.masterArcanum(kept);
	await actor.update({ [`flags.${SYSTEM_ID}.${OCCULT_DRAWS_FLAG}.${occultDrawKey(moveName)}`]: kept });
	ui.notifications?.info?.(`${actor.name} keeps ${drawn.find(c => c.slug === kept)?.name ?? kept}, its secrets unlocked.`);
	return kept;
}
