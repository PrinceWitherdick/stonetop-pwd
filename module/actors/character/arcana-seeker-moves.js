/**
 * The Seeker's moves that act on the arcana tab itself, rather than on a roll of their own.
 *
 *  - MIND OVER MAGIC: "When you roll to study or use an arcanum, you can roll +INT instead of the
 *    stat you'd normally roll." Every arcanum move that rolls a stat offers a second roll button,
 *    +INT, beside the printed stat (mindOverMagicRoll): a mystery on the back, a card's condensed
 *    move, and the rolls printed on a card's FRONT (the Azure Hand's +CON, the Red Scepter's +CHA,
 *    a cracked flute's +CHA practice), which are handles on the tab like a mystery's name
 *    (data/arcana-moves.js#parseArcanumFrontMoves). A move that already rolls +INT (Cast a Codex
 *    Spell) or rolls no stat ("roll +nothing") has nothing to swap. Studying a card to identify it
 *    is the Know Things roll itself, which is +INT as the book prints it.
 *
 *  - IMPROVISE: "When you wish to use an arcanum's move or option without having unlocked it, ask the
 *    GM what fool risk(s) it requires and/or what consequence(s) you'll incur. If you go for it, roll
 *    +INT: on a 7+, you get it to work this once--trigger the move or use the option as if you'd
 *    unlocked it; and on a 10+, also mark one step towards unlocking the arcanum's mysteries."
 *    An un-learned mystery's dialog offers "Improvise" (improviseOffer), which rolls the move of that
 *    name +INT with its own card. Its 7+ carries "Use it this once", which reopens the mystery as if
 *    learned; its 10+ adds "Mark a step towards unlocking", which ticks the card's next unlock ○
 *    (CharacterArcana#markNextUnlockStep), or, on a card whose steps are □ tasks on its front (the
 *    Mindgem, the Twisted Spear), asks which task to tick, and on a card whose steps are its unlock
 *    requirements (every minor arcanum), asks which requirement to mark a step on. □ typed into a
 *    homebrew card's unlock text (unlockBox) are asked about the same way. A card whose ○ are all
 *    marked does what its unlock text says a mark does then (unlockOverflow: the Lidless Orb marks a
 *    new effect, the Storm Markings set Fury to 3). Each is spent once per card. Rolling Improvise from the
 *    Moves tab is untouched: it has no mystery behind it, so it carries neither button.
 *
 *  - CONDUIT OF POWER and OVERCHANNEL: "When you would mark a Consequence from a major arcanum, you
 *    can mark 1 box here instead, with no negative effect" and "... you may mark a debility instead."
 *    Ticking a □ in a MAJOR arcanum's Consequences section asks which (settleArcanumBoxTick), when
 *    there is a choice to make; a diverted mark leaves the consequence box clear. Unticking never asks.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { isMajorArcanumItem } from "../../arcana-icons.js";
import { consequenceBoxRange, consequenceLabel, unlockChoiceState, unlockCircleCount } from "./CharacterArcana.js";
import { frontTaskTrack } from "./seeker-collection.js";
import { bookMoveName, moveLearnedIn, ownedLearnedMove, ownsLearnedMoveNamed } from "./owns-move.js";
import { readableFlags } from "./StonetopFlags.js";
import { altStatGrantsFor } from "../../data/alt-stat-grants.js";
import { learnedTrack } from "./MoveResources.js";
import { debilityPayments, payDebility } from "./invoke-consequences.js";
import { changeFollowerLoyalty } from "./follower-bond.js";
import { followersFromSource } from "../../data/servant-of-daagon.js";
import { askWithButtons } from "../../utils/ask-with-buttons.js";
import { postMoveNote } from "../../utils/chat.js";
import { circleRunAfter, glyphLabelAt, maskGlyphLabels } from "../../utils/glyphs.js";
import { withCardLatch, wireLatchedButtons } from "../../utils/card-latch.js";
import { clipText, escHtml, stripHtmlToText } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";
import { STAT_KEYS } from "../../utils/roll-types.js";

export const MIND_OVER_MAGIC  = "Mind Over Magic";
export const IMPROVISE        = "Improvise";
export const CONDUIT_OF_POWER = "Conduit of Power";
export const OVERCHANNEL      = "Overchannel";

/** Message flags latching an Improvise card's two buttons. */
export const IMPROVISE_USED_FLAG = "improviseUsed";
export const IMPROVISE_STEP_FLAG = "improviseStep";

// -- Mind Over Magic ----------------------------------------------------------------------------------

/**
 * The +INT a mystery's roll may be swapped for, or null: when the character has Mind Over Magic
 * learned and the mystery rolls a real stat other than INT.
 *
 * @param {Actor} actor
 * @param {string|null} stat  the mystery's printed stat ("con"), "nothing", or null
 * @returns {{stat: "int", label: string, source: string}|null}
 */
export function mindOverMagicRoll(actor, stat) {
	const printed = String(stat ?? "").toLowerCase();
	if (!STAT_KEYS.includes(printed) || printed === "int") return null;
	if (!ownsLearnedMoveNamed(actor, MIND_OVER_MAGIC)) return null;
	return { stat: "int", label: `Roll +INT (${MIND_OVER_MAGIC})`, source: MIND_OVER_MAGIC };
}

/**
 * Every stat a mystery's roll may be swapped for, one roll button each, in order: Mind Over Magic's
 * +INT, then the blanket grants keyed to the printed stat (ALT_STAT_GRANTS' `whenDefaultStat` rows),
 * which ask nothing of the move: the Fox's Laugh at Danger, "When you are about to roll +CON and you
 * make a joke about the adversity you face, you can roll +CHA instead." A dozen minor arcana roll
 * +CON, and the joke is the player's to make, so its button is named for the move as Mind Over
 * Magic's is. Never the printed stat, never one stat twice; empty when nothing swaps.
 *
 * @param {Actor} actor
 * @param {string|null} stat  the mystery's printed stat ("con"), "nothing", or null
 * @returns {{stat: string, label: string, source: string}[]}
 */
export function arcanumAltRolls(actor, stat) {
	const printed = String(stat ?? "").toLowerCase();
	if (!STAT_KEYS.includes(printed)) return [];
	const rolls = [];
	const mom = mindOverMagicRoll(actor, printed);
	if (mom) rolls.push(mom);
	// The book's moves only, LEARNED, as the move roll's own picker reads them (StonetopCharacterSheet#_altStatChoiceForRollable).
	const learned = (actor?.items ?? []).filter(i => i.type === "move" && bookMoveName(i) != null && moveLearnedIn(i, actor.items)).map(i => i.name);
	const bag = readableFlags(actor);
	const rows = altStatGrantsFor({ defaultStat: printed }, {
		learnedMoveNames: learned,
		playbook:   actor?.system?.playbook?.name ?? null,
		background: bag?.background?.selected ?? bag?.["background.selected"] ?? null,
	});
	for (const g of rows) {
		if (rolls.some(r => r.stat === g.altStat)) continue;
		const source = g.ownsMove ?? g.background?.label ?? "";
		rolls.push({ stat: g.altStat, label: `Roll +${g.altStat.toUpperCase()} (${source})`, source });
	}
	return rolls;
}

// -- Improvise ----------------------------------------------------------------------------------------

/**
 * What an un-learned mystery's dialog needs to offer Improvise, or null when it has nothing to
 * offer: the mystery is learned already, the viewer cannot roll for this sheet, or Improvise is
 * not learned.
 *
 * @param {Actor} actor
 * @param {{slug: string, name: string, learned: boolean, cardTitle?: string}} move  CharacterArcana#getArcanumMove
 * @param {string} arcanumSlug
 * @param {{editable?: boolean}} [o]
 */
export function improviseOffer(actor, move, arcanumSlug, { editable = true } = {}) {
	// A move printed on the front is never locked ("without having unlocked it" does not apply): it
	// is unusable only while the card is unread, and Improvise does not read cards.
	if (!move || move.learned || move.front || !editable || !arcanumSlug) return null;
	if (!ownsLearnedMoveNamed(actor, IMPROVISE)) return null;
	return { arcanumSlug, moveSlug: move.slug, moveName: move.name, cardTitle: move.cardTitle ?? "" };
}

/**
 * The buttons an Improvise card carries (roll-engine's tierActions): the 7+'s "use it this once",
 * and the 10+'s "mark a step towards unlocking" beside it.
 */
export function improviseTierActions({ arcanumSlug, moveSlug, moveName }) {
	const slugAttr = `data-arcanum-slug="${escHtml(arcanumSlug)}"`;
	const use = `<button type="button" class="stonetop-improvise-use" ${slugAttr} data-move-slug="${escHtml(moveSlug)}">`
		+ `<i class="fas fa-wand-sparkles"></i> ${escHtml(`Use ${moveName} this once`)}</button>`;
	const step = `<button type="button" class="stonetop-improvise-step" ${slugAttr}>`
		+ `<i class="fas fa-circle-check"></i> Mark a step towards unlocking</button>`;
	return { success: use + step, partial: use };
}

/**
 * The options an Improvise roll made from a mystery's dialog hands the roll (onDirectStatRoll):
 * the owned move's own text and tiers, a line naming the mystery it is for, and the two buttons.
 *
 * @param {Actor} actor
 * @param {ReturnType<typeof improviseOffer>} offer
 */
export function improviseRollOptions(actor, offer) {
	const item = ownedLearnedMove(actor, IMPROVISE);
	const lead = `<p class="stonetop-improvise-target"><em>${escHtml(`Improvising ${offer.moveName}`)}`
		+ `${offer.cardTitle ? ` (${escHtml(offer.cardTitle)})` : ""}.</em></p>`;
	return {
		moveName:        IMPROVISE,
		moveDescription: lead + (item?.system?.description ?? ""),
		moveResults:     item?.system?.moveResults ?? null,
		tierActions:     improviseTierActions(offer),
	};
}

/** The sheet's own way into a mystery, as if learned (StonetopCharacterSheet#_onArcanumMoveName). */
function openImprovised(actor, arcanumSlug, moveSlug) {
	return actor?.sheet?._onArcanumMoveName?.(arcanumSlug, moveSlug, { improvised: true });
}

/**
 * The □ tasks on a card's front still unmarked (the Mindgem's and the Twisted Spear's unlock
 * steps), as `{ index, label }` with `index` the "front" box index setArcanumBoxChecked takes.
 * None on a card whose front □ are not its unlock track (seeker-collection.js#frontTaskTrack).
 *
 * @param {{description?: string, unlock?: object}} front  the card's front
 * @param {Record<string, boolean>} boxes  the character's box marks ("slug:context:index")
 * @param {string} slug
 */
export function unmarkedFrontTasks(front, boxes = {}, slug) {
	return (frontTaskTrack(front)?.markers ?? [])
		.filter(m => !boxes[`${slug}:front:${m.index}`])
		.map(m => ({ index: m.index, label: m.label }));
}

/** Ask which □ task Improvise's step marks. Answers the task picked, or null for none. */
export function askImproviseTask({ title, tasks }, { ask = askWithButtons } = {}) {
	return ask({
		title:   `${IMPROVISE}: ${title}`,
		content: `<p>Mark one step towards unlocking <strong>${escHtml(title)}</strong>: which task?</p>`,
		buttons: [
			...tasks.map(task => ({ key: `task-${task.index}`, label: task.label || `Task ${task.index + 1}`, icon: "fa-square-check", value: task })),
			{ key: "none", label: "Mark nothing yet", icon: "fa-xmark", value: null },
		],
	});
}

/**
 * The unlock requirements a card's options still want, in the order the card prints them, as
 * `{ slug, count, max, path, text, label }`: `count` of `max` marked, `text` the requirement's own words,
 * `label` those words as the ask's button reads them.
 *
 * Options may carry a `path` (the 2026-11-04 ruling A1): options sharing one are ONE way to unlock the
 * card, and any one way done is enough, beside every option with no path. So once a way is done the
 * other ways' options are no longer wanted and are left out; while none is, each pathed option is
 * labelled with its way ("Way 1: ...") when the card prints more than one.
 *
 * @param {{unlock?: {requirements?: object[]}}} front
 * @param {Record<string, number>} unlockCounts  the character's `slug:option` counts
 * @param {string} slug
 */
export function unmetUnlockOptions(front, unlockCounts = {}, slug) {
	const options = (front?.unlock?.requirements ?? []).filter(r => r?.type === "option" && r.slug);
	const counted = r => Math.max(0, Math.trunc(Number(unlockCounts?.[`${slug}:${r.slug}`]) || 0));
	const max = r => Math.max(1, Math.trunc(Number(r.max) || 1));
	const done = r => counted(r) >= max(r);
	const paths = [...new Set(options.filter(r => r.path).map(r => String(r.path)))];
	const wayDone = paths.some(p => options.filter(r => String(r.path) === p).every(done));
	return options.filter(r => !done(r) && (!r.path || !wayDone)).map(r => {
		const text = stripHtmlToText(r.description ?? "").replace(/^[\s….]+/, "").replace(/[\s;,.]+$/, "");
		const way = r.path && paths.length > 1 ? `Way ${paths.indexOf(String(r.path)) + 1}: ` : "";
		const of = max(r) > 1 ? ` (${counted(r) + 1} of ${max(r)})` : "";
		return { slug: r.slug, count: counted(r), max: max(r), path: r.path ? String(r.path) : null, text: text || r.slug, label: `${way}${text || r.slug}${of}` };
	});
}

/** Ask which unlock requirement Improvise's step advances. Answers the one picked, or null for none. */
export function askImproviseOption({ title, options }, { ask = askWithButtons } = {}) {
	const ways = new Set(options.map(o => o.path).filter(Boolean)).size > 1;
	return ask({
		title:   `${IMPROVISE}: ${title}`,
		content: `<p>Mark one step towards unlocking <strong>${escHtml(title)}</strong>: which requirement?</p>`
			+ (ways ? `<p>The card can be unlocked more than one way: finishing every step of one way is enough.</p>` : ""),
		buttons: [
			...options.map(o => ({ key: `option-${o.slug}`, label: o.label, icon: "fa-circle-check", value: o })),
			{ key: "none", label: "Mark nothing yet", icon: "fa-xmark", value: null },
		],
	});
}

/**
 * Improvise's 10+ step: tick the card's next unlock ○. A card whose steps are its unlock
 * requirements (every minor arcanum) asks which requirement still wanted to mark a step on
 * (unmetUnlockOptions). A card with no ○ whose steps are □ tasks on its front (the Mindgem, the
 * Twisted Spear) asks which unmarked task to tick instead. Once the ○ are done, □ typed into the
 * unlock text (unlockBox) are asked about next. A card whose ○ are all marked then does what its
 * unlock text says (markImproviseOverflow), or says so and marks nothing: a □ on its front is some
 * other track, not an unlock step. Answers whether a step was marked.
 */
export async function markImproviseStep(actor, arcanumSlug, { ask = askImproviseTask, pick = askUnlockChoice, option = askImproviseOption, effect = askImproviseEffect } = {}) {
	const character = actor?.typedActor;
	const card = await character?.getArcanum?.(arcanumSlug);
	if ((card?.front?.unlock?.requirements ?? []).some(r => r?.type === "option")) {
		return markImproviseOption(actor, arcanumSlug, card, option, { pick });
	}
	const step = await character?.markNextArcanumUnlockStep?.(arcanumSlug, { stonetopMove: IMPROVISE });
	if (!step) return false;
	const boxes = unmarkedUnlockBoxes(card?.front, character.arcanaBoxStates, arcanumSlug);
	if (step.index === null) {
		// □ typed into a homebrew card's unlock text (context unlockBox) are steps too, once its ○ are
		// done. The card has no requirement, so the requirement ask offers just them.
		if (boxes.length) return markImproviseOption(actor, arcanumSlug, card, option, { boxes, pick });
		if (step.count) return markImproviseOverflow(actor, arcanumSlug, card, step, effect);
		return markImproviseTask(actor, arcanumSlug, step, ask);
	}
	const last = step.index + 1 >= step.count && !boxes.length;
	await postMoveNote(actor, IMPROVISE,
		`${actor.name} marks a step towards unlocking ${step.title} (${step.index + 1} of ${step.count}).`
		+ (last ? " That was the last mark: see the card for what unlocking it brings." : ""));
	// A mark that buys a choice (the Hec'tumel Codex's spells) asks for it, as a mark ticked by hand does.
	await chooseUnlockChoices(actor, arcanumSlug, { ask: pick });
	return true;
}

/**
 * The other steps a card's unlock track still wants beside its requirements, shaped like
 * unmetUnlockOptions' entries so askImproviseOption offers them together: the next unmarked ○ of the
 * unlock text (`circle`), and each unmarked □ task on the front (`task`, its "front" index). A card
 * can print both requirements and these (the homebrew editor allows it), and every one of them must
 * be done before it unlocks.
 */
export function otherUnlockSteps(front, boxes = {}, slug) {
	const steps = [];
	const circles = unlockCircleCount(front?.unlock?.description);
	let marked = 0;
	while (marked < circles && boxes?.[`${slug}:unlock:${marked}`]) marked++;
	if (marked < circles) {
		const label = `The next ○ on the unlock track (${marked + 1} of ${circles})`;
		steps.push({ slug: "unlock-circle", circle: true, count: marked, max: circles, path: null, text: label, label });
	}
	for (const task of unmarkedFrontTasks(front, boxes, slug)) {
		const label = task.label || `Task ${task.index + 1}`;
		steps.push({ slug: `front-task-${task.index}`, task: task.index, count: 0, max: 1, path: null, text: label, label });
	}
	return steps;
}

/**
 * The requirement half of markImproviseStep: pick a requirement still wanted, another step of the
 * track (otherUnlockSteps: its next ○, a front □ task), or an unticked □ of the unlock text (`boxes`,
 * unmarkedUnlockBoxes), and count one more step on it.
 */
async function markImproviseOption(actor, arcanumSlug, card, ask, { boxes = unmarkedUnlockBoxes(card.front, actor.typedActor.arcanaBoxStates, arcanumSlug), pick } = {}) {
	const character = actor.typedActor;
	const title = card.front?.title ?? arcanumSlug;
	const options = [
		...unmetUnlockOptions(card.front, character.arcanaUnlockCounts, arcanumSlug),
		...otherUnlockSteps(card.front, character.arcanaBoxStates, arcanumSlug),
		...boxes,
	];
	if (!options.length) {
		globalThis.ui?.notifications?.info?.(`Every requirement for unlocking ${title} is met already.`);
		return false;
	}
	const picked = await ask({ title, options });
	if (!picked) return false;
	if (Number.isInteger(picked.box)) return tickImproviseBox(actor, arcanumSlug, title, picked);
	if (picked.circle) return tickImproviseCircle(actor, arcanumSlug, title, pick);
	if (Number.isInteger(picked.task)) return tickImproviseTask(actor, arcanumSlug, title, picked);
	// Read again after the ask, which is not modal: a step marked meanwhile is built on, never written over.
	const now = unmetUnlockOptions(card.front, character.arcanaUnlockCounts, arcanumSlug).find(o => o.slug === picked.slug);
	if (!now) {
		globalThis.ui?.notifications?.info?.(`That requirement for ${title} is met already; nothing was marked.`);
		return false;
	}
	await character.setArcanumUnlockCount(arcanumSlug, now.slug, Math.min(now.max, now.count + 1));
	const unlocked = await character.isArcanumUnlocked?.(arcanumSlug);
	await postMoveNote(actor, IMPROVISE,
		`${actor.name} marks a step towards unlocking ${title}: ${now.text}`
		+ (now.max > 1 ? ` (${now.count + 1} of ${now.max})` : "") + "."
		+ (unlocked ? " That was the last step: see the card for what unlocking it brings." : ""));
	return true;
}

/** Improvise's step on the next unmarked ○, picked beside a card's requirements. Read again: the ask is not modal. */
async function tickImproviseCircle(actor, arcanumSlug, title, pick = askUnlockChoice) {
	const step = await actor.typedActor.markNextArcanumUnlockStep?.(arcanumSlug, { stonetopMove: IMPROVISE });
	if (!step || step.index === null) {
		globalThis.ui?.notifications?.info?.(format("stonetop.arcana.improvise.boxTaken", { title }));
		return false;
	}
	const unlocked = await actor.typedActor.isArcanumUnlocked?.(arcanumSlug);
	await postMoveNote(actor, IMPROVISE,
		`${actor.name} marks a step towards unlocking ${title} (${step.index + 1} of ${step.count}).`
		+ (unlocked ? " That was the last step: see the card for what unlocking it brings." : ""));
	await chooseUnlockChoices(actor, arcanumSlug, { ask: pick });
	return true;
}

/** Improvise's step on a front □ task, picked beside a card's requirements. Read again: the ask is not modal. */
async function tickImproviseTask(actor, arcanumSlug, title, picked) {
	const character = actor.typedActor;
	if (character.arcanaBoxStates?.[`${arcanumSlug}:front:${picked.task}`]) {
		globalThis.ui?.notifications?.info?.(format("stonetop.arcana.improvise.boxTaken", { title }));
		return false;
	}
	await character.setArcanumBoxChecked(arcanumSlug, "front", picked.task, true);
	const unlocked = await character.isArcanumUnlocked?.(arcanumSlug);
	await postMoveNote(actor, IMPROVISE,
		`${actor.name} marks a step towards unlocking ${title}: ${picked.text}.`
		+ (unlocked ? " That was the last step: see the card for what unlocking it brings." : ""));
	return true;
}

/** The □-task half of markImproviseStep: pick an unmarked front task and tick it. */
async function markImproviseTask(actor, arcanumSlug, step, ask) {
	const character = actor.typedActor;
	const card  = await character.getArcanum?.(arcanumSlug);
	const tasks = unmarkedFrontTasks(card?.front, character.arcanaBoxStates, arcanumSlug);
	if (!tasks.length) {
		globalThis.ui?.notifications?.info?.(`Every step towards unlocking ${step.title} is marked already.`);
		return false;
	}
	const task = await ask({ title: step.title, tasks });
	if (!task) return false;
	await character.setArcanumBoxChecked(arcanumSlug, "front", task.index, true);
	const left = tasks.length - 1;
	await postMoveNote(actor, IMPROVISE,
		`${actor.name} marks a step towards unlocking ${step.title}: ${task.label || `task ${task.index + 1}`}.`
		+ (left ? "" : " That was the last one: see the card for what unlocking it brings."));
	return true;
}

/**
 * The □ typed into a card's unlock text (a homebrew card's own steps, context `unlockBox`) still
 * unticked, shaped like unmetUnlockOptions' entries so askImproviseOption offers them beside any
 * requirements: `box` is the unlockBox index, `label` the words the box marks, up to the next box or
 * the end of the line. None on a shipped card (none prints a □ there).
 *
 * @param {{unlock?: {description?: string}}} front
 * @param {Record<string, boolean>} boxes  the character's box marks ("slug:context:index")
 * @param {string} slug
 */
export function unmarkedUnlockBoxes(front, boxes = {}, slug) {
	const text = maskGlyphLabels(front?.unlock?.description ?? "");
	const steps = [];
	let index = 0;
	for (const m of text.matchAll(/□/g)) {
		const box = index++;
		if (boxes?.[`${slug}:unlockBox:${box}`]) continue;
		const words = glyphLabelAt(text, m.index + 1, /□|<\/p>|<\/li>|<br\b|<ul\b/i).replace(/[\s;,.:]+$/, "");
		const label = clipText(words, 80) || `Step ${box + 1}`;
		steps.push({ slug: `unlockBox-${box}`, box, count: 0, max: 1, path: null, text: label, label });
	}
	return steps;
}

/**
 * Tick one unlockBox the way the sheet does (settleArcanumBoxTick), so the unlock latch is written
 * with the tick that completes the track. Read again first: the ask is not modal.
 */
async function tickImproviseBox(actor, arcanumSlug, title, picked) {
	const character = actor.typedActor;
	if (character.arcanaBoxStates?.[`${arcanumSlug}:unlockBox:${picked.box}`]) {
		globalThis.ui?.notifications?.info?.(format("stonetop.arcana.improvise.boxTaken", { title }));
		return false;
	}
	const result = await settleArcanumBoxTick(actor, { slug: arcanumSlug, context: "unlockBox", index: picked.box, checked: true });
	if (result !== "marked") return false;
	const unlocked = await character.isArcanumUnlocked?.(arcanumSlug);
	await postMoveNote(actor, IMPROVISE,
		`${actor.name} marks a step towards unlocking ${title}: ${picked.text}.`
		+ (unlocked ? " That was the last step: see the card for what unlocking it brings." : ""));
	return true;
}

// -- Improvise with every unlock ○ marked --------------------------------------------------------------

// What a card's unlock text says a mark does once all its ○ are marked, read off the card's own words
// so a homebrew card worded the same way works with no table:
//  - the Staff of the Lidless Orb (Book II p.540): "When you would mark a circle but have already marked
//    all three, mark a new effect for Power of the Lidless Orb";
//  - the Storm Markings (p.566): "When you would make a mark but have already marked all 3, set your
//    Fury to 3".
// The Redwood Effigy's "If all 3 marks are already marked, then mark a consequence instead" belongs to
// Surrogate Suffering's own mark (the effigy suffering harm), not to every mark, so it is not read here.
const _OVERFLOW_EFFECT_RE = /already marked all\b[^.]*?\bmark a new effect for ([^.]+?)\s*\./i;
const _OVERFLOW_SET_RE    = /already marked all\b[^.]*?\bset your ([^.]+?) to (\d+)\s*\./i;
const _STRONG_RE          = /<strong\b[^>]*>([\s\S]*?)<\/strong>/gi;
const _nameWords = s => String(s ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The first bold run of `text` (masked) holding every word of `name`, as a matchAll match, or null. */
function _boldNamed(text, name) {
	const wanted = _nameWords(name);
	if (!wanted.length) return null;
	for (const m of text.matchAll(_STRONG_RE)) {
		const have = new Set(_nameWords(stripHtmlToText(m[1])));
		if (wanted.every(w => have.has(w))) return m;
	}
	return null;
}

/**
 * What a mark does on this card once every unlock ○ is marked, or null when the card says nothing
 * (or what it names cannot be found on its back):
 *  - `{ kind: "effect", name, effects }`: mark a new effect of the move `name`; `effects` are the □
 *    opening that move's list items, `{ index, label }` with `index` the "back" box index;
 *  - `{ kind: "set", name, value, from, length }`: set the ○○ run printed with `name` on the back to
 *    `value` marked; `from` is the run's first "backCircle" index.
 */
export function unlockOverflow(card) {
	const unlock = stripHtmlToText(card?.front?.unlock?.description ?? "");
	const text = maskGlyphLabels(card?.back?.description ?? "");
	const effect = _OVERFLOW_EFFECT_RE.exec(unlock);
	if (effect) {
		const name = effect[1].trim();
		const bold = _boldNamed(text, name);
		if (!bold) return null;
		const start = bold.index + bold[0].length;
		const after = text.slice(start);
		const next = after.search(/<h[1-6]\b|<p\b[^>]*>\s*<strong\b[^>]*>\s*□/i);
		const body = next >= 0 ? after.slice(0, next) : after;
		const effects = [];
		for (const li of body.matchAll(/<li\b[^>]*>\s*□/g)) {
			const at = start + li.index + li[0].length - 1;
			const words = glyphLabelAt(text, at + 1, /<\/li>|<ul\b/i).split(/[,.;:]/)[0].trim();
			effects.push({ index: (text.slice(0, at).match(/□/g) || []).length, label: clipText(words, 80) || `Effect ${effects.length + 1}` });
		}
		return effects.length ? { kind: "effect", name, effects } : null;
	}
	const set = _OVERFLOW_SET_RE.exec(unlock);
	if (set) {
		const name = set[1].trim();
		const bold = _boldNamed(text, name);
		if (!bold) return null;
		// The ○○ run printed with the name, in the same paragraph or list item.
		const end = text.slice(bold.index).search(/<\/p>|<\/li>/i);
		const run = circleRunAfter(text, bold.index);
		if (!run || (end >= 0 && run.at >= bold.index + end)) return null;
		return { kind: "set", name, value: Math.trunc(Number(set[2])), from: run.from, length: run.length };
	}
	return null;
}

/** Ask which effect Improvise's overflow marks. Answers the effect picked, or null for none. */
export function askImproviseEffect({ title, name, effects }, { ask = askWithButtons } = {}) {
	return ask({
		title:   `${IMPROVISE}: ${title}`,
		content: format("stonetop.arcana.improvise.effectPrompt", { title: escHtml(title), name: escHtml(name) }),
		buttons: [
			...effects.map(e => ({ key: `effect-${e.index}`, label: e.label, icon: "fa-square-check", value: e })),
			{ key: "none", label: localize("stonetop.arcana.improvise.markNothing"), icon: "fa-xmark", value: null },
		],
	});
}

/**
 * Improvise's 10+ on a card whose unlock ○ are all marked: do what the card says a mark does then
 * (unlockOverflow), or say every circle is marked when it says nothing. Answers whether anything was marked.
 */
async function markImproviseOverflow(actor, arcanumSlug, card, step, ask) {
	const character = actor.typedActor;
	const overflow = unlockOverflow(card);
	const title = step.title;
	if (overflow?.kind === "set") {
		const value = Math.min(overflow.length, Math.max(0, overflow.value));
		const ticks = {};
		for (let i = 0; i < overflow.length; i++) ticks[overflow.from + i] = i < value;
		await character.setArcanumBoxesChecked(arcanumSlug, "backCircle", ticks);
		await postMoveNote(actor, IMPROVISE, format("stonetop.arcana.improvise.setTrack",
			{ actor: actor.name, title, name: overflow.name, value }));
		return true;
	}
	if (overflow?.kind === "effect") {
		const open = overflow.effects.filter(e => !character.arcanaBoxStates?.[`${arcanumSlug}:back:${e.index}`]);
		if (!open.length) {
			globalThis.ui?.notifications?.info?.(format("stonetop.arcana.improvise.effectsAllMarked", { title, name: overflow.name }));
			return false;
		}
		const picked = await ask({ title, name: overflow.name, effects: open });
		if (!picked) return false;
		if (character.arcanaBoxStates?.[`${arcanumSlug}:back:${picked.index}`]) {
			globalThis.ui?.notifications?.info?.(format("stonetop.arcana.improvise.effectTaken", { title }));
			return false;
		}
		const result = await settleArcanumBoxTick(actor, { slug: arcanumSlug, context: "back", index: picked.index, checked: true });
		if (result !== "marked") return false;
		await postMoveNote(actor, IMPROVISE, format("stonetop.arcana.improvise.effectMarked",
			{ actor: actor.name, title, name: overflow.name, effect: picked.label }));
		return true;
	}
	globalThis.ui?.notifications?.info?.(`Every unlock circle on ${title} is marked already.`);
	return false;
}

/** Spend a card's "Use it this once", once. Answers whether the mystery was opened. */
export async function settleImproviseUse(message, actor, { arcanumSlug, moveSlug }, { buttons = [], open = openImprovised } = {}) {
	if (!actor || !arcanumSlug || !moveSlug || message?.getFlag?.(SYSTEM_ID, IMPROVISE_USED_FLAG)) return false;
	return withCardLatch(message, IMPROVISE_USED_FLAG, true, buttons, async () => {
		await open(actor, arcanumSlug, moveSlug);
		return true;
	});
}

/** Spend a card's "Mark a step towards unlocking", once. Answers whether a step was marked. */
export async function settleImproviseStep(message, actor, arcanumSlug, { buttons = [], ask = askImproviseTask, option = askImproviseOption } = {}) {
	if (!actor || !arcanumSlug || message?.getFlag?.(SYSTEM_ID, IMPROVISE_STEP_FLAG)) return false;
	return withCardLatch(message, IMPROVISE_STEP_FLAG, true, buttons, () => markImproviseStep(actor, arcanumSlug, { ask, option }));
}

/** Wire an Improvise card's buttons (stonetop.js renderChatMessageHTML). */
export function wireImproviseCard(message, html) {
	wireLatchedButtons(message, html, { selector: ".stonetop-improvise-use", flag: IMPROVISE_USED_FLAG, what: IMPROVISE,
		act: (actor, btn, buttons) => settleImproviseUse(message, actor, btn.dataset, { buttons }) });
	wireLatchedButtons(message, html, { selector: ".stonetop-improvise-step", flag: IMPROVISE_STEP_FLAG, what: IMPROVISE,
		act: (actor, btn, buttons) => settleImproviseStep(message, actor, btn.dataset.arcanumSlug, { buttons }) });
}

// -- A casting penalty marked on the card --------------------------------------------------------------

/**
 * Cards whose front prints a penalty track for one of its own moves: the Hec'tumel Codex's "CAST A CODEX
 * SPELL -- Casting penalty ○○○○○", whose 7-9 may cost "take a -1 penalty to Cast a Codex Spell until you get
 * Hec'tumel to show you what you're doing wrong (the penalty is cumulative)" (Book II p.556). Each ticked ○
 * of the run printed after `label` is -1 on that move's roll. `move` is the move's name, any case.
 */
const CASTING_PENALTIES = Object.freeze([
	Object.freeze({ slug: "hectumel-codex", move: "cast a codex spell", label: "Casting penalty" }),
]);

/**
 * The penalty a card's own track puts on one of its moves, or null for none (no such track, or nothing
 * ticked on it): `{ value, marked, note }`, `value` the negative modifier, `note` the card's pill text.
 *
 * The track is the ○ run printed right after the label in the front text, indexed as the sheet indexes
 * front ○ runs (context "frontCircle", every ○ of each run of 2+, display-only glyphs left out).
 *
 * @param {{slug: string, front?: {title?: string, description?: string}}} card
 * @param {{name?: string}} move
 * @param {Record<string, boolean>} boxes  the character's box marks ("slug:context:index")
 */
export function arcanumCastingPenalty(card, move, boxes = {}) {
	const row = CASTING_PENALTIES.find(p => p.slug === card?.slug && p.move === String(move?.name ?? "").trim().toLowerCase());
	if (!row) return null;
	const html = maskGlyphLabels(card.front?.description ?? "");
	const at = html.indexOf(row.label);
	if (at < 0) return null;
	const run = circleRunAfter(html, at);
	if (!run) return null;
	let marked = 0;
	for (let i = run.from; i < run.from + run.length; i++) if (boxes?.[`${card.slug}:frontCircle:${i}`]) marked++;
	if (!marked) return null;
	const title = card.front?.title ?? card.slug;
	return { value: -marked, marked, note: `${row.label} -${marked} (${title})` };
}

// -- A mark that buys a choice ------------------------------------------------------------------------

/**
 * The Hec'tumel Codex: "○○○○ Each time you make a mark, choose one of the Codex Spells (see
 * reverse)", and "you can now cast it". Not a Seeker move, but it rides the same box-tick seam: a newly
 * marked unlock ○ on such a card (CharacterArcana.js#unlockChoiceState) asks which unchosen spell
 * that mark buys and ticks its □ on the back, for a player who may never see the back. A mark made
 * where no one could be asked (the Seeker's creation mark) or a pick that was closed leaves the
 * card owing the choice, and the tab's cue on the front asks again (chooseUnlockChoices).
 */
export function askUnlockChoice({ title, name, choices }, { ask = askWithButtons } = {}) {
	return ask({
		title:   `${title}: choose one of the ${name}`,
		content: `<p>Your mark on <strong>${escHtml(title)}</strong> lets you choose one of the ${escHtml(name)}. Which do you learn?</p>`,
		buttons: [
			...choices.map((c, n) => ({ key: `choice-${c.index}`, label: c.label || `Choice ${n + 1}`, icon: "fa-book-open", value: c })),
			{ key: "none", label: "Choose later", icon: "fa-xmark", value: null },
		],
	});
}

/**
 * Ask for every choice a card's unlock marks still owe, one at a time, ticking each one picked.
 * Closing the ask (or "Choose later") stops, leaves the marks as they are and says where to choose
 * later. Answers how many were chosen; 0 for a card that owes none.
 *
 * @param {Actor} actor
 * @param {string} slug
 * @param {{ask?: Function}} [o]  askUnlockChoice by default
 */
export async function chooseUnlockChoices(actor, slug, { ask = askUnlockChoice } = {}) {
	const character = actor?.typedActor;
	const card = slug ? await character?.getArcanum?.(slug) : null;
	if (!card) return 0;
	const title = card.front?.title ?? slug;
	let chosen = 0;
	for (;;) {
		const state = unlockChoiceState(card, character.arcanaBoxStates);
		if (!state?.owed) return chosen;
		const picked = await ask({ title, name: state.name, choices: state.open });
		if (!picked) {
			globalThis.ui?.notifications?.info?.(`No ${state.name} chosen yet: the mark stays. `
				+ `Choose one from the card on the Arcana tab when you're ready.`);
			return chosen;
		}
		await character.setArcanumBoxChecked(slug, "back", picked.index, true);
		await postMoveNote(actor, title, `${actor.name} chooses ${picked.label} from the ${state.name} (${title}).`);
		chosen++;
	}
}

// -- Conduit of Power / Overchannel -------------------------------------------------------------------

/** What a diverted Consequence can be marked as instead. */
export const DIVERT = Object.freeze({ CONSEQUENCE: "consequence", CONDUIT: "conduit", DEBILITY: "debility", LOYALTY: "loyalty" });

/**
 * Major arcana whose follower can pay a Consequence in Loyalty: the Demonhide Cloak, "When you would mark a
 * Consequence, you can choose to spend 1 of the Cloak's Loyalty instead" (Book II p.545). By the card's slug,
 * the follower's stable `sourceUuid` (arcana-summons.js).
 */
const LOYALTY_DIVERSIONS = Object.freeze({
	"demonhide-cloak": Object.freeze({ sourceUuid: "demonhide-cloak:the-cloak", name: "the Cloak" }),
});

/**
 * The follower that may pay `slug`'s Consequence in Loyalty, read live off the actor: `{ id, name, loyalty }`
 * when it is on the Followers tab, not fallen, and holds at least 1 Loyalty; else null.
 */
export function loyaltyDiversion(actor, slug) {
	const row = LOYALTY_DIVERSIONS[slug ?? ""];
	if (!row) return null;
	const map = actor?.getFlag?.(SYSTEM_ID, "customFollowers");
	const entry = followersFromSource(map, row.sourceUuid).find(([, f]) => !f.dead);
	if (!entry) return null;
	const loyalty = Math.max(0, Math.trunc(Number(entry[1].loyalty) || 0));
	return loyalty > 0 ? { id: entry[0], name: entry[1].name || row.name, loyalty } : null;
}

/**
 * The card a ticked box belongs to when that box is a Consequence of a MAJOR arcanum, else null.
 * Consequences are □ on the back (the front-surfaced fold writes the same `back` keys).
 */
export async function majorConsequenceCard(character, slug, context, index) {
	if (context !== "back" || !Number.isInteger(index)) return null;
	const item = await character?.getArcanum?.(slug);
	if (!item || !isMajorArcanumItem(item)) return null;
	const range = consequenceBoxRange(item.back?.description);
	return range && index >= range.from && index < range.to ? item : null;
}

/**
 * What this character may mark in place of a major arcanum's Consequence: a free Conduit of Power
 * box (`conduit`, null when the move is not learned or its 3 boxes are full) and, with Overchannel
 * learned, each debility still unmarked (`debilities`, invoke-consequences.js#debilityPayments).
 */
export function consequenceDiversions(actor, slug = null) {
	const track = learnedTrack(actor, CONDUIT_OF_POWER);
	return {
		conduit:    track && track.held < track.max ? { marked: track.held, max: track.max } : null,
		debilities: ownsLearnedMoveNamed(actor, OVERCHANNEL) ? debilityPayments(actor) : [],
		// The card's own follower, when it can pay in Loyalty (the Demonhide Cloak, LOYALTY_DIVERSIONS).
		loyalty:    loyaltyDiversion(actor, slug),
	};
}

/** Whether there is anything to ask: a free Conduit box, a debility Overchannel can mark, or a follower's Loyalty. */
export function hasDiversion(diversions) {
	return !!(diversions?.conduit || diversions?.debilities?.length || diversions?.loyalty);
}

/**
 * Ask what to mark. Answers `{kind}` (`DIVERT`), with `key` the debility for DEBILITY, or null
 * when the window was closed without an answer (then nothing is marked).
 */
export async function askConsequenceDiversion({ title, diversions }, { ask = askWithButtons } = {}) {
	const name = escHtml(title);
	const lines = [`<p><strong>${name}</strong>: you would mark one of its Consequences.</p>`];
	const buttons = [{ key: DIVERT.CONSEQUENCE, label: "Mark the Consequence", icon: "fa-triangle-exclamation", value: { kind: DIVERT.CONSEQUENCE } }];
	if (diversions.conduit) {
		const { marked, max } = diversions.conduit;
		lines.push(`<p><strong>${CONDUIT_OF_POWER}</strong>: mark 1 box there instead, with no negative effect `
			+ `(${marked} of ${max} marked; these marks never clear).</p>`);
		buttons.push({ key: DIVERT.CONDUIT, label: "Mark a Conduit of Power box instead", icon: "fa-bolt", value: { kind: DIVERT.CONDUIT } });
	}
	if (diversions.loyalty) {
		const { name: who, loyalty } = diversions.loyalty;
		lines.push(`<p><strong>${escHtml(who)}</strong>: spend 1 of its Loyalty instead (it holds ${loyalty}).</p>`);
		buttons.push({ key: DIVERT.LOYALTY, label: `Spend 1 of ${who}'s Loyalty instead`, icon: "fa-heart", value: { kind: DIVERT.LOYALTY } });
	}
	if (diversions.debilities?.length) {
		lines.push(`<p><strong>${OVERCHANNEL}</strong>: mark a debility instead.</p>`);
		buttons.push({ key: DIVERT.DEBILITY, label: "Mark a debility instead (Overchannel)", icon: "fa-heart-crack", value: { kind: DIVERT.DEBILITY } });
	}
	const first = await ask({ title: "Mark a Consequence", content: lines.join(""), buttons });
	if (first?.kind !== DIVERT.DEBILITY) return first ?? null;
	const key = await ask({
		title:   OVERCHANNEL,
		content: `<p>Which debility do you mark instead of the Consequence of <strong>${name}</strong>?</p>`,
		buttons: diversions.debilities.map(p => ({
			key:   p.key,
			label: p.circle ? localize("stonetop.invocations.consequenceCircle") : `Mark ${p.name}`,
			icon:  "fa-heart-crack",
			value: p.key,
		})),
	});
	return key ? { kind: DIVERT.DEBILITY, key } : null;
}

/**
 * A change on an arcanum card's □/○/◇, from the sheet. A tick of a major arcanum's Consequence
 * asks first when Conduit of Power or Overchannel gives a choice; a tick of an unlock ○ that buys a
 * choice (the Hec'tumel Codex's spells) asks for it after the mark is written; everything else is
 * written as it stands. Answers "marked", "unticked", "diverted" (something else was marked and the
 * box stays clear), "cancelled" (nothing was marked), or null without a character.
 *
 * @param {Actor} actor
 * @param {{slug: string, context: string, index: number, checked: boolean}} box
 * @param {{ask?: Function, pick?: Function}} [o]  askConsequenceDiversion and askUnlockChoice by default
 */
export async function settleArcanumBoxTick(actor, { slug, context, index, checked }, { ask = askConsequenceDiversion, pick = askUnlockChoice } = {}) {
	const character = actor?.typedActor;
	if (!character) return null;
	const write = async () => {
		// A refused tick (a locked slot, CharacterArcana#arcanumSlotLocked) leaves the box clear.
		if ((await character.setArcanumBoxChecked(slug, context, index, checked)) === false) return "cancelled";
		return checked ? "marked" : "unticked";
	};
	if (!checked) return write();
	if (context === "unlock") {
		const result = await write();
		await chooseUnlockChoices(actor, slug, { ask: pick });
		return result;
	}
	const card = await majorConsequenceCard(character, slug, context, index);
	if (!card) return write();
	const diversions = consequenceDiversions(actor, slug);
	if (!hasDiversion(diversions)) return write();
	const title = card.front?.title ?? slug;
	const answer = await ask({ title, diversions });
	if (answer?.kind === DIVERT.CONSEQUENCE) return write();
	if (answer?.kind === DIVERT.CONDUIT) return (await markConduitInstead(actor, title)) ? "diverted" : "cancelled";
	if (answer?.kind === DIVERT.LOYALTY) return (await spendLoyaltyInstead(actor, slug, title)) ? "diverted" : "cancelled";
	if (answer?.kind === DIVERT.DEBILITY) {
		const paid = await payDebility(actor, answer.key, OVERCHANNEL);
		if (!paid) {
			globalThis.ui?.notifications?.warn?.("That debility is marked already; nothing was marked.");
			return "cancelled";
		}
		const what = paid.circle ? localize("stonetop.invocations.consequenceCircleName") : paid.name;
		await postMoveNote(actor, OVERCHANNEL, `${actor.name} marks ${what} instead of a Consequence of ${title}.`);
		return "diverted";
	}
	return "cancelled";
}

/** Spend 1 of the card's follower's Loyalty, read live (the ask is not modal). Answers whether it was spent. */
async function spendLoyaltyInstead(actor, slug, title) {
	const follower = loyaltyDiversion(actor, slug);
	if (!follower) {
		globalThis.ui?.notifications?.warn?.("That follower holds no Loyalty now; nothing was spent or marked.");
		return false;
	}
	// The follower Loyalty seam: one spend at a time, through the GM for a player who can't write it.
	const step = await changeFollowerLoyalty(actor, { ftype: "custom", slug: follower.id, delta: -1, move: title });
	if (!step) {
		globalThis.ui?.notifications?.warn?.("That follower holds no Loyalty now; nothing was spent or marked.");
		return false;
	}
	await postMoveNote(actor, title,
		`${actor.name} spends 1 of ${follower.name}'s Loyalty (now ${step.to}) instead of marking a Consequence of ${title}.`);
	return true;
}

/** Mark 1 Conduit of Power box, read live (the ask is not modal). Answers whether it was marked. */
async function markConduitInstead(actor, title) {
	const track = learnedTrack(actor, CONDUIT_OF_POWER);
	if (!track || track.held >= track.max) {
		globalThis.ui?.notifications?.warn?.("Conduit of Power has no box left to mark; nothing was marked.");
		return false;
	}
	await track.resources.setUses(CONDUIT_OF_POWER, track.held + 1, { stonetopMove: CONDUIT_OF_POWER });
	await postMoveNote(actor, CONDUIT_OF_POWER,
		`${actor.name} marks Conduit of Power (${track.held + 1} of ${track.max}) instead of a Consequence of ${title}.`);
	return true;
}

// -- "Mark a consequence" as a move's cost ------------------------------------------------------------

/**
 * A card whose move costs "mark a consequence" of an arcanum (the Ring of Daagon's Call Up the Deep
 * Ones and Send Them Back) carries a button that marks it: the player picks which unmarked
 * Consequence, then it goes through settleArcanumBoxTick, so Conduit of Power and Overchannel can take it as they take a box
 * ticked by hand. Once per card (the message flag below).
 */
export const MARK_CONSEQUENCE_FLAG = "arcanumConsequenceMarked";
export const RING_OF_DAAGON = "ring-of-daagon";

// consequenceLabel lives beside consequenceBoxRange (CharacterArcana.js); re-exported for its callers here.
export { consequenceLabel };

/**
 * For each □ printed inside a list item that sits in ANOTHER list item, the □ indices of that
 * enclosing item: the Consequence it follows on from. The Ring's "You can breathe water through
 * your skin" is printed under "Your skin becomes clammy and squamous", and comes after it.
 *
 * @returns {Map<number, number[]>}  back-side □ index -> the enclosing Consequence's □ indices
 */
export function consequenceParents(backDescription) {
	const parents = new Map();
	const stack = [];
	let box = -1;
	for (const [token] of maskGlyphLabels(backDescription).matchAll(/<li\b[^>]*>|<\/li>|□/gi)) {
		if (token === "□") {
			box++;
			stack.at(-1)?.boxes.push(box);
			const outer = stack.at(-2);
			if (outer?.boxes.length) parents.set(box, [...outer.boxes]);
		} else if (token.toLowerCase() === "</li>") {
			stack.pop();
		} else {
			stack.push({ boxes: [] });
		}
	}
	return parents;
}

/**
 * The Consequences a player may mark now, in the order the card prints them: one entry per
 * Consequence, carrying the back-side index of its next unmarked □. A Consequence printed with a
 * run of □ (the Ring's 1d6 sinkholes, □□□) is one entry until every box is marked, labelled with
 * the mark it would be ("1 of 3"). One printed under another (consequenceParents) is offered only
 * once every box of the one above it is marked. [] when the card prints none or none is open.
 *
 * @returns {{index: number, label: string}[]}
 */
export function unmarkedConsequences(backDescription, boxes = {}, slug) {
	const range = consequenceBoxRange(backDescription);
	if (!range) return [];
	const html = String(backDescription ?? "");
	const at = [...maskGlyphLabels(html).matchAll(/□/g)].map(m => m.index);
	const parents = consequenceParents(html);
	const marked = k => !!boxes[`${slug}:back:${k}`];
	const out = [];
	for (let i = range.from; i < range.to;) {
		let end = i + 1;
		while (end < range.to && at[end] === at[end - 1] + 1) end++;
		const next = Array.from({ length: end - i }, (_, k) => i + k).find(k => !marked(k));
		const open = (parents.get(i) ?? []).every(marked);
		if (next !== undefined && open) {
			const text = consequenceLabel(html, next) || `Consequence ${out.length + 1}`;
			out.push({ index: next, label: end - i > 1 ? `${text} (${next - i + 1} of ${end - i})` : text });
		}
		i = end;
	}
	return out;
}

/** Ask which Consequence to mark. Answers the one picked, or null for none. */
export function askConsequencePick({ title, consequences }, { ask = askWithButtons } = {}) {
	return ask({
		title:   `Mark a consequence: ${title}`,
		content: `<p>Which Consequence of <strong>${escHtml(title)}</strong> do you mark?</p>`,
		buttons: [
			...consequences.map(c => ({ key: `consequence-${c.index}`, label: c.label, icon: "fa-triangle-exclamation", value: c })),
			{ key: "none", label: "Mark nothing yet", icon: "fa-xmark", value: null },
		],
	});
}

/** The "Mark a consequence" button for a card's action row. */
export function markConsequenceButton(slug, title) {
	return `<div class="card-buttons stonetop-roll-actions">`
		+ `<button type="button" class="stonetop-mark-consequence" data-arcanum-slug="${escHtml(slug)}">`
		+ `<i class="fas fa-triangle-exclamation"></i> ${escHtml(`Mark a consequence (${title})`)}</button></div>`;
}

/**
 * Followers whose ordered move costs a Consequence of their arcanum on a 6-, by the follower's stable
 * `sourceUuid` (arcana-summons.js): the Mindgem's Mighty Servant, "When the Mighty Servant makes a move
 * at your behest (see Order Followers), on a 6-, in addition to whatever the GM says, mark a consequence"
 * (Book II p.549).
 */
const ORDER_MISS_CONSEQUENCES = Object.freeze({
	"mindgem:mighty-servant": Object.freeze({ slug: "mindgem", title: "Mindgem" }),
});

/** The 6- button an Order Followers card carries for this follower record, or "" for none. */
export function orderMissConsequenceActions(record) {
	const row = ORDER_MISS_CONSEQUENCES[record?.sourceUuid ?? ""];
	return row ? markConsequenceButton(row.slug, row.title) : "";
}

/**
 * Mark a Consequence of `slug`'s card: the player picks which (askConsequencePick), then Conduit
 * of Power and Overchannel may take it in its place. Answers whether something was marked (the
 * Consequence, or a Conduit of Power box or debility in its place). A card not held, or with
 * every Consequence marked, says so and marks nothing; closing the pick marks nothing.
 *
 * @param {Actor} actor
 * @param {string} slug
 * @param {{ask?: Function, pick?: Function}} [o]  settleArcanumBoxTick's ask; the Consequence pick
 */
export async function markArcanumConsequence(actor, slug, { ask = askConsequenceDiversion, pick = askConsequencePick } = {}) {
	const character = actor?.typedActor;
	if (!character || !slug) return false;
	const card = character.ownedArcanaSlugs?.has?.(slug) ? await character.getArcanum?.(slug) : null;
	if (!card) {
		globalThis.ui?.notifications?.warn?.(`${actor.name} doesn't hold that arcanum's card: mark the consequence by hand.`);
		return false;
	}
	const title = card.front?.title ?? slug;
	const consequences = unmarkedConsequences(card.back?.description, character.arcanaBoxStates, slug);
	if (!consequences.length) {
		globalThis.ui?.notifications?.info?.(`Every Consequence on ${title} is marked already.`);
		return false;
	}
	const picked = await pick({ title, consequences });
	if (!picked) return false;
	const index = picked.index;
	const result = await settleArcanumBoxTick(actor, { slug, context: "back", index, checked: true }, { ask });
	if (result === "marked") {
		const what = consequenceLabel(card.back?.description, index);
		await postMoveNote(actor, title, `${actor.name} marks a Consequence of ${title}${what ? `: ${what}` : ""}.`);
	}
	return result === "marked" || result === "diverted";
}

/** Spend a card's "Mark a consequence", once. Answers whether something was marked. */
export async function settleMarkConsequence(message, actor, slug, { buttons = [], ask = askConsequenceDiversion, pick = askConsequencePick } = {}) {
	if (!actor || !slug || message?.getFlag?.(SYSTEM_ID, MARK_CONSEQUENCE_FLAG)) return false;
	return withCardLatch(message, MARK_CONSEQUENCE_FLAG, true, buttons, () => markArcanumConsequence(actor, slug, { ask, pick }));
}

/** Wire a card's "Mark a consequence" button (stonetop.js renderChatMessageHTML). */
export function wireMarkConsequenceCard(message, html) {
	wireLatchedButtons(message, html, { selector: ".stonetop-mark-consequence", flag: MARK_CONSEQUENCE_FLAG, what: "Mark a consequence",
		act: (actor, btn, buttons) => settleMarkConsequence(message, actor, btn.dataset.arcanumSlug, { buttons }) });
}
