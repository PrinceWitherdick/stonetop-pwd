/**
 * What Invoke the Sun God's consequences DO once they are ticked on its card.
 *
 *   "on a 10+, it works as described but you must choose 1 consequence from the list below; on a
 *    7-9, it works as described, but you and the GM each choose 1.
 *     - The Invocation has its reduced effect
 *     - The effort taxes you; mark a debility
 *     - The light is snuffed out when the Invocation is complete, its fuel consumed
 *     - You must bask in sunlight for an hour or so before using that Invocation again"
 *
 * The list is the move's own printed bullets, made tickable where they are printed (the same list,
 * cap and tally every move gets; item/StonetopItem.js#roll). Three of the four write to the sheet,
 * so ticking one does it here, keyed by the bullet's own words the way attack-flow.js#PICK_EFFECTS
 * keys an attack's bullets. The reduced effect is fiction, and ticks and counts like any bullet.
 *
 *  - THE DEBILITY is a choice, so the tick grows buttons, one per debility not already marked (the
 *    Battle Joy card's pattern), plus the Auspicious Birth circle for a Lightbearer of that
 *    background whose circle is clear: "you may mark this background's circle instead, to no ill
 *    effect". One mark per bullet, latched on the message.
 *  - THE SNUFFING is paid when the Invocation is complete. An ongoing one is stamped, so however it
 *    ends (End it, replaced, interrupted) the light goes out with it (StonetopCharacter
 *    #markInvocationSnuff); an instant one is complete already, so the light goes out now. Unticked
 *    before it fired, the stamp is taken back; a light already out stays out.
 *  - THE SUN is a cue on the Invocation (StonetopCharacter#markNeedsSun), never a block, shown on
 *    the Invocations tab and in the invoke window until the player clears it. Unticked, the
 *    Invocations this tick put on the list come back off it.
 *
 * WHICH INVOCATION is stamped on the card (`invocations`, a list of slugs: two under Burn Twice as
 * Bright, whose "apply any consequences to both" is why every effect here takes a list). Every roll
 * of the move names one: a roll from the Moves tab, the hotbar or the fight ring asks which Invocation
 * first (the sheet's _invokeWhichInvocation). Only a character who knows NO Invocations rolls one that
 * names none, so its snuffing and its sun have nothing to act on and say so; its debility still marks.
 *
 * And Wielder of the White Flame's 10+, "you may Invoke the Sun God right now as if you rolled a
 * 10+": a button on its roll card, once per card, that opens the sheet's own invoke path with no
 * roll, which posts the Invocation and a card of these same consequences to choose 1 from.
 *
 * EMPOWERED INVOCATIONS: "you can choose an extra consequence before you roll. If you do, the
 * Invocation has its empowered effect." The invoke window asks which, the roll's pick context carries
 * it, and the card is stamped with it (EMPOWERED_CONSEQUENCE_FLAG). It is taken on EVERY result, a 6-
 * included, so it is not a box on the list (hidden on a 6-) but a fixed line of its own
 * (move-pick-bonuses.js takes it off the list), wired here with the same settles a ticked bullet uses
 * under its own record key (PRE_PICK_RECORD). Burn Twice as Bright's pair takes it on both.
 *
 * HOLY RELICS: "mark a use in lieu of choosing a consequence", once for each consequence the PLAYER
 * owes on the card (holyRelicOffers): their pick from the list, and the Empowered one. A relic marked
 * for the Empowered one cancels it; the Invocation is still empowered.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { INVOKE_THE_SUN_GOD, WIELDER_OF_THE_WHITE_FLAME } from "./holy-light.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { tookBackground } from "./took-background.js";
import { REDUCED_GM_CHOICE, invocationLabels, readNeedsSun, reducedEndings } from "./ongoing-invocation.js";
import { withMovePickBonuses } from "./move-pick-bonuses.js";
import { canRewriteCard, firstOptionList, optionKey, pickListItem, pickListStampAttrs, postMoveNote } from "../../utils/chat.js";
import { belongsToMessage } from "../../utils/picked-option-button.js";
import { inCardTurn } from "../../utils/card-queue.js";
import { withCardLatch } from "../../utils/card-latch.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

/** Message flag: the slugs of the Invocation(s) an Invoke card is for. */
export const CARD_INVOCATIONS_FLAG = "invocations";
/** Message flag: what each consequence bullet did, keyed by its `data-index`. */
export const CONSEQUENCES_FLAG = "invokeConsequences";
/** Message flag: a Wielder of the White Flame card's "Invoke now" was used. */
export const WIELDER_INVOKED_FLAG = "wielderInvoked";
/** Message flag: the Invocation(s) an Invoke card is for were empowered before the roll. */
export const CARD_EMPOWERED_FLAG = "invokeEmpowered";
/** Message flag: the card is Wielder of the White Flame's "as if you rolled a 10+", with no roll. */
export const TEN_PLUS_FLAG = "invokeTenPlus";
/** Message flag: the consequence an Empowered Invocation took before the roll (a CONSEQUENCE kind). */
export const EMPOWERED_CONSEQUENCE_FLAG = "invokeEmpoweredConsequence";
/** The CONSEQUENCES_FLAG key the Empowered consequence's record lives under (a bullet's is its index). */
export const PRE_PICK_RECORD = "empowered";
/** Message flag: what the reduced effect did to each short-lived Invocation, `{slug: "ended"|"kept"}`. */
export const REDUCED_FLAG = "invokeReduced";
/** Message flag: how many holy relic uses this card has had (a legacy `true` is one). */
export const HOLY_RELIC_FLAG = "holyRelicSpent";

/** "When you Invoke the Sun God and roll a 10+, you need not choose a consequence; on a 7-9, you choose a consequence but the GM does not." */
export const GLORIOUS_SERVANT = "Glorious Servant";

export const CONSEQUENCE = Object.freeze({ REDUCED: "reduced", DEBILITY: "debility", SNUFF: "snuff", SUN: "sun" });

/**
 * The move's four bullets, word for word and in printed order, each with what it is. Pinned against
 * the shipped move by tests/actors/character/invoke-consequences.test.js. The invoke window offers
 * them as the Empowered consequence; the card matches its bullets against them.
 */
export const INVOKE_CONSEQUENCE_BULLETS = Object.freeze([
	{ kind: CONSEQUENCE.REDUCED,  text: "The Invocation has its reduced effect" },
	{ kind: CONSEQUENCE.DEBILITY, text: "The effort taxes you; mark a debility" },
	{ kind: CONSEQUENCE.SNUFF,    text: "The light is snuffed out when the Invocation is complete, its fuel consumed" },
	{ kind: CONSEQUENCE.SUN,      text: "You must bask in sunlight for an hour or so before using that Invocation again" },
].map(Object.freeze));

/** The printed bullet for a CONSEQUENCE kind, or null. */
export function consequenceBullet(kind) {
	return INVOKE_CONSEQUENCE_BULLETS.find(b => b.kind === kind)?.text ?? null;
}

/** Which consequence a bullet's text is, the reduced effect included; null for none of them. */
export function consequenceKindOf(text) {
	const key = optionKey(text);
	return INVOKE_CONSEQUENCE_BULLETS.find(b => optionKey(b.text) === key)?.kind ?? null;
}

/** The Lightbearer's background whose circle can be marked instead of a debility. */
export const AUSPICIOUS_BIRTH = Object.freeze({ playbook: "The Lightbearer", slug: "auspicious-birth" });
/** The debility choice that marks that circle instead. */
export const CIRCLE_CHOICE = "auspicious-birth";

// Keyed by the bullet, word for word, through the card's one text normaliser (utils/chat.js#optionKey).
// The tests hold each key against the shipped move, so a reword in the pack fails there.
/** Which consequence a bullet's text is, or null for one that writes nothing (the reduced effect). */
export function invokeConsequenceKind(text) {
	const kind = consequenceKindOf(text);
	return kind === CONSEQUENCE.REDUCED ? null : kind;
}

/** Whether a bullet's text is "The Invocation has its reduced effect". */
export function isReducedBullet(text) {
	return consequenceKindOf(text) === CONSEQUENCE.REDUCED;
}

/**
 * The message flags an Invoke card is stamped with from its roll's pick context: which Invocation(s),
 * whether they were empowered, and the consequence Empowered took before the roll (the context holds
 * its printed bullet, the flag its kind). Empty for a context that names none of it.
 */
export function invokeCardFlags(context = null) {
	const invocations = Array.isArray(context?.invocations) ? context.invocations.filter(Boolean) : [];
	const kind = context?.empowered ? consequenceKindOf(context.empoweredConsequence ?? "") : null;
	return {
		...(invocations.length ? { [CARD_INVOCATIONS_FLAG]: [...invocations] } : {}),
		...(invocations.length && context?.empowered ? { [CARD_EMPOWERED_FLAG]: true } : {}),
		...(kind ? { [EMPOWERED_CONSEQUENCE_FLAG]: kind } : {}),
	};
}

/** The consequence an Empowered Invocation took before the roll (a CONSEQUENCE kind), or null. */
export function cardEmpoweredConsequence(message) {
	const kind = message?.getFlag?.(SYSTEM_ID, EMPOWERED_CONSEQUENCE_FLAG);
	return Object.values(CONSEQUENCE).includes(kind) ? kind : null;
}

/** Whether a holy relic was marked in place of the Empowered consequence, which cancels it. */
export function prePickReplaced(message) {
	return !!recordFor(message, PRE_PICK_RECORD).relic;
}

/** Whether the reduced effect was the Empowered consequence chosen before the roll, and no holy relic replaced it. */
function reducedBeforeRoll(message) {
	return cardEmpoweredConsequence(message) === CONSEQUENCE.REDUCED && !prePickReplaced(message);
}

/**
 * Whether the Empowered consequence is still to be paid: there is one, no relic took its place, and
 * nothing it writes has been written (a debility marked, the light stamped or snuffed, the sun cue set).
 * The reduced effect writes nothing, so it stays open to a relic for as long as the card lasts.
 */
export function prePickPending(message) {
	if (!cardEmpoweredConsequence(message)) return false;
	const record = recordFor(message, PRE_PICK_RECORD);
	return !record.relic && !record.marked && !record.snuffed && !("stamped" in record) && !("added" in record);
}

/**
 * Whether the reduced effect is ticked on this card, read off its boxes as they stand (the picks pass
 * restores each tick from the message before any of this is wired, so the DOM is the card's state), or
 * was the Empowered consequence chosen before the roll and not replaced by a holy relic.
 */
export function invokeCardReduced(root, message) {
	if (reducedBeforeRoll(message)) return true;
	return [...(root?.querySelectorAll?.(".stonetop-picklist-item") ?? [])]
		.filter(item => belongsToMessage(item, message))
		.some(item => isReducedBullet((item.querySelector("label") ?? item).textContent ?? "")
			&& !!item.querySelector(".stonetop-picklist-check")?.checked);
}

/** The Invocations a card is for, as slugs (empty for a roll that named none). */
export function cardInvocations(message) {
	return readNeedsSun(message?.getFlag?.(SYSTEM_ID, CARD_INVOCATIONS_FLAG));
}

/**
 * Whether an Invoke card has a consequence for the player to choose, which is when the holy relics'
 * "mark a use in lieu of choosing a consequence" belongs on it: a roll card on a 7+ (a 6- has no list;
 * the GM says what happens), and Wielder of the White Flame's "as if you rolled a 10+", which has no
 * roll at all but a 10+'s list to choose 1 from.
 *
 * @param {ChatMessage} message
 * @param {{total?: number|null}} [roll]  the card's (shifted) total, when it has one
 */
export function invokeCardChoosesConsequence(message, { total = null } = {}) {
	if (message?.getFlag?.(SYSTEM_ID, "move") !== INVOKE_THE_SUN_GOD) return false;
	if (message.getFlag(SYSTEM_ID, TEN_PLUS_FLAG)) return true;
	return Number.isFinite(total) && total >= 7;
}

/** How many holy relic uses a card has had: a count, or the old one-per-card `true` as one. */
export function holyRelicsSpent(message) {
	const spent = message?.getFlag?.(SYSTEM_ID, HOLY_RELIC_FLAG);
	return spent === true ? 1 : Math.max(0, Math.trunc(Number(spent)) || 0);
}

/**
 * What a holy relic can still stand in for on an Invoke card: `list`, how many of the player's own
 * picks from the list are left to replace, and `prePick`, whether the Empowered consequence is still
 * there to replace. The player owes 1 pick on a 10+ (the Wielder's card included) and 1 on a 7-9 (the
 * GM's is the GM's); a Glorious Servant's 10+ owes none ("you need not choose a consequence"), and a
 * 6- has no list. The Empowered consequence is owed on every result.
 *
 * @param {ChatMessage} message
 * @param {Actor} actor  the card's speaker, asked whether Glorious Servant is learned
 * @param {{total?: number|null}} [roll]  the card's (shifted) total, when it has one
 * @returns {{list: number, prePick: boolean}}
 */
export function holyRelicOffers(message, actor, { total = null } = {}) {
	if (message?.getFlag?.(SYSTEM_ID, "move") !== INVOKE_THE_SUN_GOD) return { list: 0, prePick: false };
	const tenPlus = !!message.getFlag(SYSTEM_ID, TEN_PLUS_FLAG) || (Number.isFinite(total) && total >= 10);
	const hit = tenPlus || (Number.isFinite(total) && total >= 7);
	const owed = !hit ? 0 : tenPlus && ownsLearnedMoveNamed(actor, GLORIOUS_SERVANT) ? 0 : 1;
	// The spent count covers both kinds; the one on the Empowered consequence is told by its record.
	const onList = Math.max(0, holyRelicsSpent(message) - (prePickReplaced(message) ? 1 : 0));
	return { list: Math.max(0, owed - onList), prePick: prePickPending(message) };
}

/**
 * Mark one holy relic use on an Invoke card, for one of the player's picks from the list or (with
 * `prePick`) for the Empowered consequence, which it cancels. One at a time per card, re-reading
 * holyRelicOffers when its turn comes, and latched on the message FIRST (the count raised, and the
 * Empowered record marked), so a second click or another client cannot spend the same one twice.
 * `spend()` marks the use on the character and answers falsy when there was none left, which gives
 * the card back, as a throw does. Answers whether a use was marked.
 */
export function settleHolyRelic(message, actor, { prePick = false, total = null, spend } = {}) {
	return inCardTurn(message, async () => {
		const offers = holyRelicOffers(message, actor, { total });
		if (prePick ? !offers.prePick : offers.list <= 0) return false;
		const before = holyRelicsSpent(message);
		const giveBack = async () => {
			await message.setFlag(SYSTEM_ID, HOLY_RELIC_FLAG, before);
			// Written as `false`, not as an empty record: a flag write merges, and {} would keep the `true`.
			if (prePick) await writeRecord(message, PRE_PICK_RECORD, { relic: false });
		};
		await message.setFlag(SYSTEM_ID, HOLY_RELIC_FLAG, before + 1);
		if (prePick) await writeRecord(message, PRE_PICK_RECORD, { relic: true });
		try {
			if (await spend?.()) return true;
		} catch (err) {
			await giveBack().catch(e => console.error("Stonetop | could not give back the holy relic latch", e));
			throw err;
		}
		await giveBack();
		return false;
	});
}

/**
 * The row an Invoke card's own buttons go in: the ten-plus card's, or a rolled card's
 * `.stonetop-roll-actions` (roll-engine.js#_rollCard), made when the card has none. NOT the shared
 * `.stonetop-card-buttons` row on a card with no roll behind it: roll-shifting and Burn Brightly find
 * that row by its class, and would offer themselves on a card with nothing to shift.
 *
 * @param {HTMLElement} root  the rendered message
 * @returns {HTMLElement|null}
 */
export function invokeActionRow(root) {
	if (!root?.querySelector) return null;
	const card = root.querySelector(".stonetop-roll-card .cell--chat") ?? root.querySelector(".stonetop-roll-card")
		?? root.querySelector(".stonetop-chat-move");
	if (!card) return null;
	const found = card.querySelector(".stonetop-roll-actions");
	if (found) return found;
	const doc = root.ownerDocument ?? globalThis.document;
	const row = doc.createElement("div");
	row.className = "card-buttons stonetop-roll-actions";
	const shared = card.querySelector(":scope > .stonetop-card-buttons");
	if (shared) card.insertBefore(row, shared);
	else card.appendChild(row);
	return row;
}

/** The record one bullet left on the card, or an empty one. */
function recordFor(message, index) {
	return message?.getFlag?.(SYSTEM_ID, CONSEQUENCES_FLAG)?.[index] ?? {};
}

function writeRecord(message, index, record) {
	return message.setFlag(SYSTEM_ID, `${CONSEQUENCES_FLAG}.${index}`, record);
}

/** Printed names, looked up without the playbook: every Invocation's slug prettifies to its name. */
function labelsOf(slugs) {
	return invocationLabels(slugs, []);
}

/**
 * Auspicious Birth's circle as a stand-in for a debility: "When one of your moves has you mark a debility, you
 * may mark this background's circle instead, to no ill effect. Clear it when you Make Camp or Convalesce."
 * (Lightbearer playbook.) In the shape of StonetopCharacter#debilityChoices' entries, `circle` set, or null
 * when the background is not taken. PURE, over the playbook's NAME, the background slug and its setup tracks.
 * Offered only where a MOVE marks the debility (StonetopCharacter#debilityMarkChoices), never on a hand tick,
 * and never cleared as a debility is: only camp and Convalesce clear it (background-tracks.js).
 */
export function auspiciousBirthChoice({ playbook = null, background = null, setupResources = {} } = {}) {
	if (!tookBackground({ playbook, background }, AUSPICIOUS_BIRTH)) return null;
	return {
		key: CIRCLE_CHOICE, circle: true, standIn: true,
		name: localize("stonetop.invocations.consequenceCircleName"),
		description: localize("stonetop.invocations.consequenceCircle"),
		marked: Number(setupResources?.[AUSPICIOUS_BIRTH.slug]) > 0,
	};
}

/**
 * What a move that has you "mark a debility" can be paid with (Invoke the Sun God's consequence,
 * Burn Twice as Bright's price): StonetopCharacter#debilityMarkChoices still unmarked, so the Auspicious
 * Birth circle first when that background is taken and its circle is clear ("you may mark this
 * background's circle instead, to no ill effect", so it costs nothing), then each debility not already
 * marked. `[{key, circle, name}]`, `name` the debility's.
 */
export function debilityPayments(actor) {
	return (actor?.typedActor?.debilityMarkChoices ?? [])
		.filter(d => d?.key && !d.marked)
		.map(d => ({ key: d.key, circle: !!d.circle, name: d.circle ? "" : (d.name ?? d.key) }));
}

/**
 * Pay one of debilityPayments' keys for `moveName`: mark the circle, or the debility. Answers the
 * payment made, or null when it is no longer on offer (marked since it was offered).
 */
export async function payDebility(actor, key, moveName) {
	const paid = debilityPayments(actor).find(p => p.key === key);
	if (!paid) return null;
	const model = actor.typedActor;
	if (paid.circle) await model.background.setSetupResource(AUSPICIOUS_BIRTH.slug, 1);
	else if (!(await model.markDebility?.(key, { moveName }))) return null;
	return paid;
}

/** debilityPayments, labelled for the Invoke card's "effort taxes you" bullet. `[{key, label, name}]`. */
export function invokeDebilityChoices(actor) {
	return debilityPayments(actor).map(p => p.circle
		? { key: p.key, label: localize("stonetop.invocations.consequenceCircle"), name: localize("stonetop.invocations.consequenceCircleName") }
		: { key: p.key, label: format("stonetop.invocations.consequenceDebility", { debility: p.name }), name: p.name });
}

/**
 * Mark what the "effort taxes you" bullet was paid with, once per bullet. Latched on the message
 * FIRST, so a second click, a re-render or a reload cannot mark twice; a choice that turns out to be
 * taken already gives the latch back. Returns whether anything was marked.
 */
export async function settleInvokeDebility(message, actor, index, choice, { buttons = [] } = {}) {
	if (!choice || !actor?.typedActor || recordFor(message, index).marked) return false;
	// The latch is this bullet's record (writeRecord's path).
	return withCardLatch(message, `${CONSEQUENCES_FLAG}.${index}`, { marked: choice }, buttons, async () => {
		const paid = await payDebility(actor, choice, INVOKE_THE_SUN_GOD);
		if (!paid) {
			globalThis.ui?.notifications?.warn?.(localize("stonetop.invocations.consequenceTaken"));
			return false;
		}
		const text = paid.circle
			? format("stonetop.invocations.consequenceCircleMarked", { name: actor.name })
			: format("stonetop.invocations.consequenceDebilityMarked", { name: actor.name, debility: paid.name });
		await postMoveNote(actor, INVOKE_THE_SUN_GOD, text);
		return true;
	});
}

/**
 * The snuffing and the sun, on a tick or an untick of their bullet. Reads what the bullet already
 * did off the card, so a tick that has fired never fires again. Returns whether anything changed.
 */
export async function settleInvokeTick(message, actor, { index, kind, checked }) {
	const model = actor?.typedActor;
	if (!model) return false;
	const slugs = cardInvocations(message);
	const record = recordFor(message, index);

	if (kind === CONSEQUENCE.SNUFF) {
		// The light went out: nothing to take back, and nothing left to do.
		if (record.snuffed) return false;
		if (!checked) {
			if (!record.stamped?.length) return false;
			for (const slug of record.stamped) await model.markInvocationSnuff(slug, false);
			await writeRecord(message, index, { stamped: [] });
			return true;
		}
		if (record.stamped?.length || !slugs.length) return false;
		const running = model.ongoingInvocations ?? [];
		// Every Invocation on the card still running: each ends the light when it ends.
		if (slugs.every(slug => running.includes(slug))) {
			for (const slug of slugs) await model.markInvocationSnuff(slug, true);
			await writeRecord(message, index, { stamped: slugs });
			return true;
		}
		// An instant one (or one already over) is complete: the light goes out now, taking whatever
		// still runs with it. Latched first, so a second tick cannot snuff a relit light.
		await writeRecord(message, index, { snuffed: true });
		const names = labelsOf(running);
		if (await model.setHolyLight(false)) {
			await postMoveNote(actor, INVOKE_THE_SUN_GOD, format(names
				? "stonetop.invocations.consequenceSnuffedEnding" : "stonetop.invocations.consequenceSnuffed",
			{ name: actor.name, invocations: names }));
		}
		return true;
	}

	if (kind === CONSEQUENCE.SUN) {
		if (!checked) {
			if (!record.added?.length) return false;
			await model.clearNeedsSun(record.added);
			await writeRecord(message, index, { added: [] });
			return true;
		}
		if (record.added?.length || !slugs.length) return false;
		const added = await model.markNeedsSun(slugs);
		await writeRecord(message, index, { added });
		return added.length > 0;
	}
	return false;
}

// -- The reduced effect of a short-lived Invocation -------------------------------------------------

/** What the reduced effect did to `slug` on this card: "ended", "kept", or "" for nothing yet. */
export function reducedOutcome(message, slug) {
	const value = message?.getFlag?.(SYSTEM_ID, REDUCED_FLAG)?.[slug];
	return value === "ended" || value === "kept" ? value : "";
}

/**
 * Whether a LATER Invoke card of the same character names `slug`: then what is running is that card's
 * Invocation, not this one's, and an old card's reduced effect must not end it. Reads the chat log in
 * order (core keeps it in creation order); a card not found in it has nothing after it.
 */
export function laterCardNames(message, slug, messages = globalThis.game?.messages?.contents ?? []) {
	const list = [...messages];
	const at = list.findIndex(m => m?.id === message?.id);
	if (at < 0) return false;
	const actorId = message?.speaker?.actor;
	return list.slice(at + 1).some(m => m?.speaker?.actor === actorId
		&& m?.getFlag?.(SYSTEM_ID, "move") === INVOKE_THE_SUN_GOD && cardInvocations(m).includes(slug));
}

/** The card's Invocations its reduced effect can still act on (ongoing-invocation.js#reducedEndings). */
function reducedPending(message, actor) {
	const model = actor?.typedActor;
	if (!model) return { brief: [], ask: [] };
	const slugs = cardInvocations(message).filter(s => !reducedOutcome(message, s) && !laterCardNames(message, s));
	return reducedEndings({ current: model.invocationState, slugs });
}

/**
 * Record what the reduced effect did to one Invocation, latched on the card FIRST so a re-render, a
 * second tick or another client cannot end it twice, and end it when that is the outcome. A "light is
 * snuffed" stamp on it is paid as any ending pays it (StonetopCharacter#setInvocationState), and said.
 */
function settleReducedOutcome(message, actor, slug, outcome, buttons = []) {
	return withCardLatch(message, `${REDUCED_FLAG}.${slug}`, outcome, buttons, async () => {
		if (outcome !== "ended") return true;
		const result = await actor.typedActor.endOngoingInvocation(slug);
		if (result?.snuffed) {
			await postMoveNote(actor, INVOKE_THE_SUN_GOD, format("stonetop.invocations.reducedSnuffed",
				{ name: actor.name, invocations: labelsOf(result.ended?.length ? result.ended : [slug]) }));
		}
		return true;
	});
}

/**
 * The reduced effect, once it lands on a card (its bullet ticked, or the Empowered consequence chosen
 * before the roll). A REDUCED_IS_BRIEF Invocation (Blinding Light, Cold Light of Day) still running
 * from this card is over at once, so its slot is ended now rather than blocking the next Invocation
 * until End it; only its own slot, so the other half of a Burn Twice, or the empowered Dancing Light
 * it went through, keeps going (resolveInvocationEnd). A REDUCED_GM_CHOICE one waits on the card's
 * buttons (settleReducedChoice). Unticking the bullet afterwards does NOT start the Invocation again:
 * it is over, and using it again is a new Invocation. Answers whether anything ended.
 */
export async function settleReducedEffect(message, actor) {
	let ended = false;
	for (const slug of reducedPending(message, actor).brief) {
		ended = (await settleReducedOutcome(message, actor, slug, "ended")) || ended;
	}
	return ended;
}

/**
 * Moth to a Flame's reduced effect as the GM chose it: `end` ("it lasts only briefly") ends it, and
 * otherwise ("only some of the named creatures are affected") it keeps going. Once per Invocation per
 * card. Answers whether the choice was recorded.
 */
export async function settleReducedChoice(message, actor, slug, end, { buttons = [] } = {}) {
	if (!reducedPending(message, actor).ask.includes(slug)) return false;
	return settleReducedOutcome(message, actor, slug, end ? "ended" : "kept", buttons);
}

// The printed brevity of each REDUCED_IS_BRIEF Invocation, for the card's note.
const REDUCED_ENDED_KEYS = Object.freeze({
	"blinding-light": "stonetop.invocations.reducedEndedBlindingLight",
	"cold-light-of-day": "stonetop.invocations.reducedEndedColdLight",
});

/** What the reduced effect did on this card, and the GM's two buttons while a choice is open. */
function reducedPanel(doc, message, actor, usable, reduced) {
	const els = [];
	const { ask } = reduced ? reducedPending(message, actor) : { ask: [] };
	const note = (key, invocation) => readout(doc, format(key, { invocation }), "stonetop-invoke-reduced");
	for (const slug of cardInvocations(message)) {
		const invocation = labelsOf([slug]);
		const outcome = reducedOutcome(message, slug);
		if (outcome === "kept") els.push(note("stonetop.invocations.reducedMothKept", invocation));
		else if (outcome === "ended") {
			els.push(note(REDUCED_GM_CHOICE.has(slug) ? "stonetop.invocations.reducedMothEnded"
				: REDUCED_ENDED_KEYS[slug] ?? "stonetop.invocations.reducedEnded", invocation));
		} else if (ask.includes(slug)) {
			els.push(note("stonetop.invocations.reducedMothAsk", invocation));
			// The debility row's skin: a row of small buttons under the line.
			els.push(buttonPanel(doc, "stonetop-invoke-consequence stonetop-invoke-reduced stonetop-invoke-debility",
				[["end", "stonetop.invocations.reducedMothEnd"], ["keep", "stonetop.invocations.reducedMothKeep"]].map(([choice, key]) => ({
					className: "stonetop-invoke-debility-btn stonetop-invoke-reduced-btn", label: localize(key), data: { choice, slug },
				})),
				usable,
				(btn, buttons) => inCardTurn(message, () => settleReducedChoice(message, actor, slug, btn.dataset.choice === "end", { buttons }))
					.catch(err => console.error("Stonetop | settling the reduced Invocation failed", err))));
		}
	}
	return els;
}

/**
 * Draw the reduced effect's notes and buttons: on the Empowered consequence's line when that is what
 * reduced it, else under the list's reduced bullet. Safe to call again on the same card: ours go first.
 */
function drawReduced(root, message, { doc, actor, usable }) {
	const prePick = reducedBeforeRoll(message);
	const lines = [...(root.querySelectorAll?.(".stonetop-pre-pick") ?? [])].filter(el => belongsToMessage(el, message));
	const bullets = [...(root.querySelectorAll?.(".stonetop-picklist-item") ?? [])]
		.filter(item => belongsToMessage(item, message) && isReducedBullet((item.querySelector("label") ?? item).textContent ?? ""));
	for (const el of [...lines, ...bullets]) el.querySelectorAll(".stonetop-invoke-reduced").forEach(r => r.remove());
	const targets = prePick && lines.length ? lines : bullets;
	const reduced = invokeCardReduced(root, message);
	for (const target of targets) {
		for (const el of reducedPanel(doc, message, actor, usable, reduced)) target.appendChild(el);
	}
}

/**
 * The client that pays a reduced effect nobody ticked (the Empowered consequence chosen before the
 * roll) on render: the card's author, the one who rolled it, so the table's other clients that may
 * write the card do not race it. A message that cannot say is its own author.
 */
function authoredHere(message) {
	return typeof message?.isAuthor === "boolean" ? message.isAuthor : true;
}

/** The consequence rows on one card: `{item, box, index, kind}`. */
function consequenceRows(root, message) {
	return [...(root?.querySelectorAll?.(".stonetop-picklist-item") ?? [])]
		.filter(item => belongsToMessage(item, message))
		.map(item => {
			const box = item.querySelector(".stonetop-picklist-check");
			const kind = invokeConsequenceKind((item.querySelector("label") ?? item).textContent ?? "");
			return { item, box, index: box?.dataset?.index, kind };
		})
		.filter(row => row.box && row.kind);
}

function readout(doc, text, extra = "") {
	const el = doc.createElement("p");
	el.className = `stonetop-invoke-consequence stonetop-invoke-consequence-note${extra ? ` ${extra}` : ""}`;
	el.textContent = text;
	return el;
}

/**
 * A row of small buttons in a `panelClass` div, one per `{className, label, data}` spec (`data` goes on
 * its dataset), disabled unless `usable`, and then each click hands `onClick` the button and the row.
 */
function buttonPanel(doc, panelClass, specs, usable, onClick) {
	const panel = doc.createElement("div");
	panel.className = panelClass;
	const buttons = specs.map(({ className, label, data }) => {
		const btn = doc.createElement("button");
		btn.type = "button";
		btn.className = className;
		Object.assign(btn.dataset, data);
		btn.textContent = label;
		btn.disabled = !usable;
		return btn;
	});
	for (const btn of buttons) {
		if (usable) btn.addEventListener("click", () => onClick(btn, buttons));
		panel.appendChild(btn);
	}
	return panel;
}

/** The debility buttons for one record (a ticked bullet's, or the Empowered consequence's). */
function debilityPanel(doc, message, actor, index, usable) {
	return buttonPanel(doc, "stonetop-invoke-consequence stonetop-invoke-debility",
		invokeDebilityChoices(actor).map(choice => ({ className: "stonetop-invoke-debility-btn", label: choice.label, data: { choice: choice.key } })),
		usable,
		(btn, buttons) => settleInvokeDebility(message, actor, index, btn.dataset.choice, { buttons })
			.catch(err => console.error("Stonetop | marking the Invoke debility failed", err)));
}

/** What a debility record says was marked. */
function markedReadout(doc, actor, record) {
	const name = record.marked === CIRCLE_CHOICE
		? localize("stonetop.invocations.consequenceCircleName")
		: actor?.typedActor?.debilityChoices?.find(d => d.key === record.marked)?.name ?? record.marked;
	return readout(doc, format("stonetop.invocations.consequenceMarked", { debility: name }));
}

/**
 * The Empowered consequence's line (move-pick-bonuses.js's `.stonetop-pre-pick`), taken on every
 * result: the debility's buttons, a button for the snuffing and for the sun (the settles a ticked
 * bullet runs, under PRE_PICK_RECORD), the reduced effect said, or what a holy relic left of it.
 */
function wirePrePick(root, message, { doc, actor, usable, slugs }) {
	const kind = cardEmpoweredConsequence(message);
	const lines = [...(root.querySelectorAll?.(".stonetop-pre-pick") ?? [])].filter(el => belongsToMessage(el, message));
	if (!kind || !lines.length) return;
	const record = recordFor(message, PRE_PICK_RECORD);
	for (const line of lines) {
		line.querySelectorAll(".stonetop-invoke-consequence").forEach(el => el.remove());
		if (record.relic) {
			line.appendChild(readout(doc, localize("stonetop.invocations.prePickRelic")));
			continue;
		}
		if (kind === CONSEQUENCE.REDUCED) {
			line.appendChild(readout(doc, slugs.length
				? format("stonetop.invocations.prePickReduced", { invocations: labelsOf(slugs) })
				: localize("stonetop.invocations.prePickReducedUnnamed")));
		} else if (kind === CONSEQUENCE.DEBILITY) {
			line.appendChild(record.marked ? markedReadout(doc, actor, record) : debilityPanel(doc, message, actor, PRE_PICK_RECORD, usable));
		} else if (kind === CONSEQUENCE.SNUFF && (record.snuffed || "stamped" in record)) {
			line.appendChild(readout(doc, record.snuffed ? localize("stonetop.invocations.consequenceSnuffedNote")
				: format("stonetop.invocations.consequenceSnuffStamped", { invocations: labelsOf(record.stamped ?? []) })));
		} else if (kind === CONSEQUENCE.SUN && "added" in record) {
			line.appendChild(readout(doc, format("stonetop.invocations.consequenceNeedsSun", { invocations: labelsOf(slugs) })));
		} else if (!slugs.length) {
			line.appendChild(readout(doc, localize("stonetop.invocations.consequenceUnnamed")));
		} else {
			const btn = doc.createElement("button");
			btn.type = "button";
			btn.className = "stonetop-invoke-consequence stonetop-invoke-pre-pick-btn";
			btn.textContent = localize(kind === CONSEQUENCE.SNUFF ? "stonetop.invocations.prePickSnuffButton" : "stonetop.invocations.prePickSunButton");
			btn.disabled = !usable;
			if (usable) btn.addEventListener("click", () => {
				btn.disabled = true;
				inCardTurn(message, () => settleInvokeTick(message, actor, { index: PRE_PICK_RECORD, kind, checked: true }))
					.catch(err => { btn.disabled = false; console.error("Stonetop | settling the Empowered consequence failed", err); });
			});
			line.appendChild(btn);
		}
	}
}

/**
 * Wire an Invoke the Sun God card's consequence bullets (dispatched from stonetop.js
 * renderChatMessageHTML, AFTER the picks pass that restores each box's tick). Whoever can write both
 * the card and the character acts (chat.js#canRewriteCard); everyone else sees what was done.
 */
export function wireInvokeConsequences(message, html) {
	const root = html?.[0] ?? html;
	if (!root?.querySelectorAll || message?.getFlag?.(SYSTEM_ID, "move") !== INVOKE_THE_SUN_GOD) return;
	const rows = consequenceRows(root, message);
	const doc = root.ownerDocument ?? globalThis.document;
	const actor = speakerActor(message);
	const usable = canRewriteCard(message, actor);
	const slugs = cardInvocations(message);
	wirePrePick(root, message, { doc, actor, usable, slugs });
	const ctx = { doc, actor, usable };
	drawReduced(root, message, ctx);
	// Pay the reduced effect in the card's turn, then redraw its notes and buttons off what it wrote.
	const settleReduced = () => inCardTurn(message, () => settleReducedEffect(message, actor))
		.then(() => drawReduced(root, message, ctx))
		.catch(err => console.error("Stonetop | settling the reduced Invocation failed", err));
	// Reduced before the roll: nothing will be ticked, so the card's author pays it as the card is drawn.
	// The latch (REDUCED_FLAG) makes every later render a no-op.
	if (usable && authoredHere(message) && reducedBeforeRoll(message) && reducedPending(message, actor).brief.length) {
		settleReduced();
	}
	if (!rows.length) return;

	for (const { item, box, index, kind } of rows) {
		// Ours out first: a re-render patches the same row.
		item.querySelectorAll(".stonetop-invoke-consequence").forEach(el => el.remove());
		const record = recordFor(message, index);
		if (kind === CONSEQUENCE.DEBILITY) {
			if (record.marked) {
				item.appendChild(markedReadout(doc, actor, record));
				continue;
			}
			const panel = debilityPanel(doc, message, actor, index, usable);
			panel.hidden = !box.checked;
			item.appendChild(panel);
		} else if (kind === CONSEQUENCE.SNUFF) {
			if (record.snuffed) item.appendChild(readout(doc, localize("stonetop.invocations.consequenceSnuffedNote")));
			else if (record.stamped?.length) item.appendChild(readout(doc, format("stonetop.invocations.consequenceSnuffStamped", { invocations: labelsOf(record.stamped) })));
			else if (box.checked && !slugs.length) item.appendChild(readout(doc, localize("stonetop.invocations.consequenceUnnamed")));
		} else if (kind === CONSEQUENCE.SUN && box.checked) {
			item.appendChild(readout(doc, slugs.length
				? format("stonetop.invocations.consequenceNeedsSun", { invocations: labelsOf(slugs) })
				: localize("stonetop.invocations.consequenceUnnamed")));
		}
	}

	// ONE listener per list, on the list: a tick past the cap releases an earlier box without an event
	// of its own (stonetop.js#_releasePicksOverLimit), so each change squares every consequence row
	// with its box rather than trusting the one clicked.
	for (const list of new Set(rows.map(r => r.item.closest(".stonetop-picklist")).filter(Boolean))) {
		if (list.dataset.invokeWired === "1") continue;
		list.dataset.invokeWired = "1";
		list.addEventListener("change", () => {
			for (const row of consequenceRows(list, message)) {
				const panel = row.item.querySelector(".stonetop-invoke-debility");
				if (panel) panel.hidden = !row.box.checked;
				if (!usable || row.kind === CONSEQUENCE.DEBILITY) continue;
				// One write at a time per card: two quick ticks must not both read the record before either wrote it.
				inCardTurn(message, () => settleInvokeTick(message, actor, { index: row.index, kind: row.kind, checked: row.box.checked }))
					.catch(err => console.error("Stonetop | settling an Invoke consequence failed", err));
			}
			// The reduced effect: a short-lived Invocation ends now, Moth to a Flame's ask shows or hides.
			// Unticked, nothing is undone (settleReducedEffect).
			drawReduced(root, message, ctx);
			if (usable && invokeCardReduced(root, message)) settleReduced();
		});
	}
}

// -- Wielder of the White Flame's 10+ ---------------------------------------------------------------

/**
 * The button a Wielder of the White Flame roll card carries on its 10+ (roll-engine's tierActions),
 * for a character with it AND Invoke the Sun God learned; null otherwise.
 */
export function wielderRollOptions(actor) {
	if (actor?.type !== "character") return null;
	if (!ownsLearnedMoveNamed(actor, WIELDER_OF_THE_WHITE_FLAME) || !ownsLearnedMoveNamed(actor, INVOKE_THE_SUN_GOD)) return null;
	return {
		tierActions: {
			success: `<button type="button" class="stonetop-wielder-invoke"><i class="fas fa-sun"></i> `
				+ `${escHtml(localize("stonetop.invocations.wielderButton"))}</button>`,
		},
	};
}

/**
 * Use the Wielder card's "Invoke now", once. `invoke` does it (the sheet's `_invokeAsTenPlus`: pick a
 * known Invocation, the invoke window, the Invocation's card and the 10+ consequence card) and
 * answers falsy when it was backed out of, which gives the card back.
 */
export async function settleWielderInvoke(message, actor, { buttons = [], invoke = a => a?.sheet?._invokeAsTenPlus?.() } = {}) {
	if (!actor || message?.getFlag?.(SYSTEM_ID, WIELDER_INVOKED_FLAG)) return false;
	return withCardLatch(message, WIELDER_INVOKED_FLAG, true, buttons, async () => !!(await invoke(actor)));
}

/** Wire a Wielder of the White Flame roll card's "Invoke now" (stonetop.js renderChatMessageHTML). */
export function wireWielderInvoke(message, html) {
	const root = html?.[0] ?? html;
	const buttons = [...(root?.querySelectorAll?.(".stonetop-wielder-invoke") ?? [])]
		.filter(btn => belongsToMessage(btn, message));
	if (!buttons.length) return;
	const actor = speakerActor(message);
	const used = !!message?.getFlag?.(SYSTEM_ID, WIELDER_INVOKED_FLAG);
	const usable = !used && canRewriteCard(message, actor);
	for (const btn of buttons) {
		btn.classList.toggle("is-chosen", used);
		if (!usable) { btn.disabled = true; continue; }
		if (btn.dataset.wielderWired === "1") continue;
		btn.dataset.wielderWired = "1";
		btn.addEventListener("click", () => {
			settleWielderInvoke(message, actor, { buttons })
				.catch(err => console.error("Stonetop | Invoke the Sun God (as a 10+) failed", err));
		});
	}
}

/**
 * The body of the "as if you rolled a 10+" card: Invoke the Sun God's own consequence list, tickable,
 * choose 1 (the 10+'s count), with whatever the roller brings to it laid over it (Glorious Servant's
 * "need not choose", and the Empowered consequence chosen before, `context.empoweredConsequence`, as a
 * fixed line off the list; move-pick-bonuses.js). The lead says the count the card really asks for.
 * `description` is the move's printed text.
 */
export function invokeTenPlusCardBody(description, actor, context = null) {
	const servant = ownsLearnedMoveNamed(actor, GLORIOUS_SERVANT);
	const lead = `<p>${escHtml(localize(servant ? "stonetop.invocations.tenPlusLeadServant" : "stonetop.invocations.tenPlusLead"))}</p>`;
	const list = firstOptionList(String(description ?? ""));
	if (!list) return withMovePickBonuses(lead, actor, INVOKE_THE_SUN_GOD, context);
	const items = list.items.map((inner, i) => pickListItem(inner, i)).join("");
	return withMovePickBonuses(`${lead}<ul class="stonetop-picklist"${pickListStampAttrs({ success: 1 })}>${items}</ul>`,
		actor, INVOKE_THE_SUN_GOD, context);
}
