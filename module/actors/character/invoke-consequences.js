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
 */

import { SYSTEM_ID } from "../../system-id.js";
import { INVOKE_THE_SUN_GOD, WIELDER_OF_THE_WHITE_FLAME } from "./holy-light.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { tookBackground } from "./took-background.js";
import { invocationLabels, readNeedsSun } from "./ongoing-invocation.js";
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

export const CONSEQUENCE = Object.freeze({ DEBILITY: "debility", SNUFF: "snuff", SUN: "sun" });

/** The Lightbearer's background whose circle can be marked instead of a debility. */
export const AUSPICIOUS_BIRTH = Object.freeze({ playbook: "The Lightbearer", slug: "auspicious-birth" });
/** The debility choice that marks that circle instead. */
export const CIRCLE_CHOICE = "auspicious-birth";

// Keyed by the bullet, word for word, through the card's one text normaliser (utils/chat.js#optionKey).
// The tests hold each key against the shipped move, so a reword in the pack fails there.
const BULLETS = new Map([
	["The effort taxes you; mark a debility", CONSEQUENCE.DEBILITY],
	["The light is snuffed out when the Invocation is complete, its fuel consumed", CONSEQUENCE.SNUFF],
	["You must bask in sunlight for an hour or so before using that Invocation again", CONSEQUENCE.SUN],
].map(([text, kind]) => [optionKey(text), kind]));

/** Which consequence a bullet's text is, or null for one that writes nothing (the reduced effect). */
export function invokeConsequenceKind(text) {
	return BULLETS.get(optionKey(text)) ?? null;
}

/** The one bullet that writes nothing but changes what the Invocation does. */
const REDUCED_BULLET = optionKey("The Invocation has its reduced effect");

/** Whether a bullet's text is "The Invocation has its reduced effect". */
export function isReducedBullet(text) {
	return optionKey(text) === REDUCED_BULLET;
}

/**
 * Whether the reduced effect is ticked on this card, read off its boxes as they stand (the picks pass
 * restores each tick from the message before any of this is wired, so the DOM is the card's state).
 */
export function invokeCardReduced(root, message) {
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
 * Wire an Invoke the Sun God card's consequence bullets (dispatched from stonetop.js
 * renderChatMessageHTML, AFTER the picks pass that restores each box's tick). Whoever can write both
 * the card and the character acts (chat.js#canRewriteCard); everyone else sees what was done.
 */
export function wireInvokeConsequences(message, html) {
	const root = html?.[0] ?? html;
	if (!root?.querySelectorAll || message?.getFlag?.(SYSTEM_ID, "move") !== INVOKE_THE_SUN_GOD) return;
	const rows = consequenceRows(root, message);
	if (!rows.length) return;
	const doc = root.ownerDocument ?? globalThis.document;
	const actor = speakerActor(message);
	const usable = canRewriteCard(message, actor);
	const slugs = cardInvocations(message);

	for (const { item, box, index, kind } of rows) {
		// Ours out first: a re-render patches the same row.
		item.querySelectorAll(".stonetop-invoke-consequence").forEach(el => el.remove());
		const record = recordFor(message, index);
		if (kind === CONSEQUENCE.DEBILITY) {
			if (record.marked) {
				const name = record.marked === CIRCLE_CHOICE
					? localize("stonetop.invocations.consequenceCircleName")
					: actor?.typedActor?.debilityChoices?.find(d => d.key === record.marked)?.name ?? record.marked;
				item.appendChild(readout(doc, format("stonetop.invocations.consequenceMarked", { debility: name })));
				continue;
			}
			const panel = doc.createElement("div");
			panel.className = "stonetop-invoke-consequence stonetop-invoke-debility";
			panel.hidden = !box.checked;
			const buttons = invokeDebilityChoices(actor).map(choice => {
				const btn = doc.createElement("button");
				btn.type = "button";
				btn.className = "stonetop-invoke-debility-btn";
				btn.dataset.choice = choice.key;
				btn.textContent = choice.label;
				btn.disabled = !usable;
				return btn;
			});
			for (const btn of buttons) {
				if (usable) btn.addEventListener("click", () => {
					settleInvokeDebility(message, actor, index, btn.dataset.choice, { buttons })
						.catch(err => console.error("Stonetop | marking the Invoke debility failed", err));
				});
				panel.appendChild(btn);
			}
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
 * choose 1 (the 10+'s count), with whatever the roller brings to that count laid over it (Empowered's
 * extra consequence, when `context.empowered`; move-pick-bonuses.js). `description` is the move's
 * printed text.
 */
export function invokeTenPlusCardBody(description, actor, context = null) {
	const lead = `<p>${escHtml(localize("stonetop.invocations.tenPlusLead"))}</p>`;
	const list = firstOptionList(String(description ?? ""));
	if (!list) return lead;
	const items = list.items.map((inner, i) => pickListItem(inner, i)).join("");
	return withMovePickBonuses(`${lead}<ul class="stonetop-picklist"${pickListStampAttrs({ success: 1 })}>${items}</ul>`,
		actor, INVOKE_THE_SUN_GOD, context);
}
