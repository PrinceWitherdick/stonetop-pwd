/**
 * The Seeker's moves that act on the arcana tab itself, rather than on a roll of their own.
 *
 *  - MIND OVER MAGIC: "When you roll to study or use an arcanum, you can roll +INT instead of the
 *    stat you'd normally roll." A mystery's dialog offers a second roll button, +INT, beside the
 *    printed stat (mindOverMagicRoll). Studying an arcanum is Know Things, which is +INT already.
 *    A mystery that rolls no stat ("roll +nothing") has nothing to swap.
 *
 *  - IMPROVISE: "When you wish to use an arcanum's move or option without having unlocked it, ask the
 *    GM what fool risk(s) it requires and/or what consequence(s) you'll incur. If you go for it, roll
 *    +INT: on a 7+, you get it to work this once--trigger the move or use the option as if you'd
 *    unlocked it; and on a 10+, also mark one step towards unlocking the arcanum's mysteries."
 *    An un-learned mystery's dialog offers "Improvise" (improviseOffer), which rolls the move of that
 *    name +INT with its own card. Its 7+ carries "Use it this once", which reopens the mystery as if
 *    learned; its 10+ adds "Mark a step towards unlocking", which ticks the card's next unlock ○
 *    (CharacterArcana#markNextUnlockStep), or, on a card whose steps are □ tasks on its front (the
 *    Mindgem, the Twisted Spear), asks which task to tick. Each is spent once per card. Rolling Improvise from the
 *    Moves tab is untouched: it has no mystery behind it, so it carries neither button.
 *
 *  - CONDUIT OF POWER and OVERCHANNEL: "When you would mark a Consequence from a major arcanum, you
 *    can mark 1 box here instead, with no negative effect" and "... you may mark a debility instead."
 *    Ticking a □ in a MAJOR arcanum's Consequences section asks which (settleArcanumBoxTick), when
 *    there is a choice to make; a diverted mark leaves the consequence box clear. Unticking never asks.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { isMajorArcanumItem } from "../../arcana-icons.js";
import { consequenceBoxRange, consequenceLabel } from "./CharacterArcana.js";
import { frontTaskTrack } from "./seeker-collection.js";
import { ownedLearnedMove, ownsLearnedMoveNamed } from "./owns-move.js";
import { learnedTrack } from "./MoveResources.js";
import { debilityPayments, payDebility } from "./invoke-consequences.js";
import { askWithButtons } from "../../utils/ask-with-buttons.js";
import { postMoveNote } from "../../utils/chat.js";
import { withCardLatch, wireLatchedButtons } from "../../utils/card-latch.js";
import { escHtml } from "../../utils/strings.js";
import { localize } from "../../utils/i18n.js";
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
	if (!move || move.learned || !editable || !arcanumSlug) return null;
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
 * Improvise's 10+ step: tick the card's next unlock ○. A card with no ○ whose steps are □ tasks
 * on its front (the Mindgem, the Twisted Spear) asks which unmarked task to tick instead. A card
 * whose ○ are all marked says so and marks nothing: a □ on its front is some other track, not an
 * unlock step. Answers whether a step was marked.
 */
export async function markImproviseStep(actor, arcanumSlug, { ask = askImproviseTask } = {}) {
	const character = actor?.typedActor;
	const step = await character?.markNextArcanumUnlockStep?.(arcanumSlug, { stonetopMove: IMPROVISE });
	if (!step) return false;
	if (step.index === null && step.count) {
		globalThis.ui?.notifications?.info?.(`Every unlock circle on ${step.title} is marked already.`);
		return false;
	}
	if (step.index === null) return markImproviseTask(actor, arcanumSlug, step, ask);
	const last = step.index + 1 >= step.count;
	await postMoveNote(actor, IMPROVISE,
		`${actor.name} marks a step towards unlocking ${step.title} (${step.index + 1} of ${step.count}).`
		+ (last ? " That was the last mark: see the card for what unlocking it brings." : ""));
	return true;
}

/** The □-task half of markImproviseStep: pick an unmarked front task and tick it. */
async function markImproviseTask(actor, arcanumSlug, step, ask) {
	const character = actor.typedActor;
	const card  = await character.getArcanum?.(arcanumSlug);
	const tasks = unmarkedFrontTasks(card?.front, character.arcanaBoxStates ?? {}, arcanumSlug);
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

/** Spend a card's "Use it this once", once. Answers whether the mystery was opened. */
export async function settleImproviseUse(message, actor, { arcanumSlug, moveSlug }, { buttons = [], open = openImprovised } = {}) {
	if (!actor || !arcanumSlug || !moveSlug || message?.getFlag?.(SYSTEM_ID, IMPROVISE_USED_FLAG)) return false;
	return withCardLatch(message, IMPROVISE_USED_FLAG, true, buttons, async () => {
		await open(actor, arcanumSlug, moveSlug);
		return true;
	});
}

/** Spend a card's "Mark a step towards unlocking", once. Answers whether a step was marked. */
export async function settleImproviseStep(message, actor, arcanumSlug, { buttons = [], ask = askImproviseTask } = {}) {
	if (!actor || !arcanumSlug || message?.getFlag?.(SYSTEM_ID, IMPROVISE_STEP_FLAG)) return false;
	return withCardLatch(message, IMPROVISE_STEP_FLAG, true, buttons, () => markImproviseStep(actor, arcanumSlug, { ask }));
}

/** Wire an Improvise card's buttons (stonetop.js renderChatMessageHTML). */
export function wireImproviseCard(message, html) {
	wireLatchedButtons(message, html, { selector: ".stonetop-improvise-use", flag: IMPROVISE_USED_FLAG, what: IMPROVISE,
		act: (actor, btn, buttons) => settleImproviseUse(message, actor, btn.dataset, { buttons }) });
	wireLatchedButtons(message, html, { selector: ".stonetop-improvise-step", flag: IMPROVISE_STEP_FLAG, what: IMPROVISE,
		act: (actor, btn, buttons) => settleImproviseStep(message, actor, btn.dataset.arcanumSlug, { buttons }) });
}

// -- Conduit of Power / Overchannel -------------------------------------------------------------------

/** What a diverted Consequence can be marked as instead. */
export const DIVERT = Object.freeze({ CONSEQUENCE: "consequence", CONDUIT: "conduit", DEBILITY: "debility" });

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
export function consequenceDiversions(actor) {
	const track = learnedTrack(actor, CONDUIT_OF_POWER);
	return {
		conduit:    track && track.held < track.max ? { marked: track.held, max: track.max } : null,
		debilities: ownsLearnedMoveNamed(actor, OVERCHANNEL) ? debilityPayments(actor) : [],
	};
}

/** Whether there is anything to ask: a free Conduit box or a debility Overchannel can mark. */
export function hasDiversion(diversions) {
	return !!(diversions?.conduit || diversions?.debilities?.length);
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
 * asks first when Conduit of Power or Overchannel gives a choice; everything else is written as
 * it stands. Answers "marked", "unticked", "diverted" (something else was marked and the box stays
 * clear), "cancelled" (nothing was marked), or null without a character.
 *
 * @param {Actor} actor
 * @param {{slug: string, context: string, index: number, checked: boolean}} box
 * @param {{ask?: Function}} [o]  askConsequenceDiversion by default
 */
export async function settleArcanumBoxTick(actor, { slug, context, index, checked }, { ask = askConsequenceDiversion } = {}) {
	const character = actor?.typedActor;
	if (!character) return null;
	const write = async () => {
		await character.setArcanumBoxChecked(slug, context, index, checked);
		return checked ? "marked" : "unticked";
	};
	if (!checked) return write();
	const card = await majorConsequenceCard(character, slug, context, index);
	if (!card) return write();
	const diversions = consequenceDiversions(actor);
	if (!hasDiversion(diversions)) return write();
	const title = card.front?.title ?? slug;
	const answer = await ask({ title, diversions });
	if (answer?.kind === DIVERT.CONSEQUENCE) return write();
	if (answer?.kind === DIVERT.CONDUIT) return (await markConduitInstead(actor, title)) ? "diverted" : "cancelled";
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
	for (const [token] of String(backDescription ?? "").matchAll(/<li\b[^>]*>|<\/li>|□/gi)) {
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
	const at = [...html.matchAll(/□/g)].map(m => m.index);
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
	const consequences = unmarkedConsequences(card.back?.description, character.arcanaBoxStates ?? {}, slug);
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
