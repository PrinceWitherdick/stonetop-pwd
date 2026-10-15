/**
 * We Happy Few's Inspiration at the table: the speech card that hands it out, and the three ways an
 * ally spends it (the rules and the count are inspiration.js's).
 *
 *  - THE SPEECH. A We Happy Few roll card carries a button on every tier (inspiration.js#
 *    speechRollOptions, shown for the tier rolled and moved by a GM's Shift): the people picker asks
 *    who heard it, and each ally picked holds that tier's Inspiration. Written here for a character
 *    this client owns, and by the GM's client for the rest (INSPIRATION_QUERY), as Piety's Blessing is.
 *    The card remembers what it gave (`inspirationShared`), so the button goes once pressed, and comes
 *    back only if a Shift Up makes the speech worth more.
 *  - +1d6 ON A DAMAGE ROLL THEY JUST MADE. A button on the holder's OWN damage card, once per card:
 *    the plain card (no one targeted), whose roll takes the die the way a GM's Shift takes its +1; and
 *    the attack flow's results card, before anyone has pressed Apply, whose every row takes it (the
 *    rows are one blow rolled per target). Pressed by the holder's player, relayed through the GM's
 *    client on a card someone else wrote.
 *  - KEEP 1 HP INSTEAD OF BEING REDUCED TO 0 HP. Asked the moment they drop (the write that makes
 *    them dying), on their own screen, before the Death's Door walkthrough opens; the dying card
 *    carries the same offer for later. Keeping it is Death's Door's own "1 HP" write, which also
 *    tells Unstoppable it is not a heal to trade for a mark. A Heavy whose Battle Joy ended with the
 *    drop has it back, and anyone the drop cost their Defend Readiness holds it again: they never
 *    dropped. Only on that question; the dying card's button comes too late to know either.
 *  - ACT FEARLESSLY is fiction: the header chip spends it and says so in chat (the sheet).
 */

import { SYSTEM_ID } from "../../system-id.js";
import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { BATTLE_JOY_DROPPED_OPTION, BATTLE_JOY_FLAG } from "./battle-joy.js";
import { heldReadiness, readinessCount, READINESS_FLAG } from "../../combat/defend-readiness.js";
import { keepsFightingAtZero } from "./unstoppable.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import {
	WE_HAPPY_FEW, inspirationForTier, inspirationHeld, holdInspiration, spendInspiration, refundInspiration, inBattle,
	canKeepOneHp,
} from "./inspiration.js";
import { actsForHelper } from "./roll-boosts.js";
import { ownerUsers, answersFor, becameDyingInDiff, openZeroHpMove } from "../../hooks/DeathsDoorPrompt.js";
import { pickPersonOnMap } from "../../dialogs/RelationshipLinkDialog.js";
import { contentElement } from "../../utils/dialogv2-content.js";
import { partyCharacters } from "../../utils/playbook-actors.js";
import { canRewriteCard, postMoveNote } from "../../utils/chat.js";
import { belongsToMessage } from "../../utils/picked-option-button.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { inCardTurn } from "../../utils/card-queue.js";
import { rollCardRoute, writeCardRoll } from "../../utils/roll-card-writer.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { holdForEach, shareHold } from "../../utils/share-hold.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";
import { getSetting } from "../../settings.js";
import { escHtml, joinNames } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

const KEY = "stonetop.inspiration";

/** The User query a player's Inspiration goes through when their client cannot write it. */
export const INSPIRATION_QUERY = "stonetop.inspiration";
/** Message flag: what a speech card gave, `{amount, names, given: [{name, amount}]}` (speechGiven). */
export const SPEECH_FLAG = "inspirationShared";
/** Message flag: the Inspiration die a damage card took, `{by, name, amount}`. */
export const DIE_FLAG = "inspirationDie";
/** Message flag: a follower's blow posted under their character's name, which is not the character's roll. */
export const FOLLOWER_BLOW_FLAG = "followerBlow";

// -- The speech ------------------------------------------------------------------------------------

/**
 * "Each ally holds N Inspiration": each of `targets` holds `amount` (or keeps more, inspiration.js#
 * heldAfterSpeech). Written here for a character this client owns; the rest go to the GM's client in one
 * query, since a Marshal's player cannot write another player's character. The Marshal is not their own
 * ally and is skipped.
 *
 * @returns {Promise<{given: Actor[], missed: Actor[]}>}  who holds it now, and who could not be reached
 */
export async function shareInspiration(marshal, targets, amount, {
	scope = SYSTEM_ID, gm = globalThis.game?.users?.activeGM ?? null, userId = globalThis.game?.user?.id ?? null,
} = {}) {
	return shareHold(marshal, targets, {
		hold: target => holdInspiration(target, amount, scope),
		relay: relayed => askGM(gm, {
			action: "hold", marshalUuid: marshal?.uuid ?? null, targetUuids: relayed.map(t => t.uuid), amount, userId,
		}, []),
	});
}

/** One query to the GM's client, answering `fallback` when it cannot. */
function askGM(gm, data, fallback) {
	return askGMClient(gm, INSPIRATION_QUERY, data, { fallback, what: "write the Inspiration" });
}

/** The amount a speech button gives: its tier's, read off the tier row it stands in. */
function buttonAmount(btn) {
	const tier = btn?.closest?.("[data-tier]")?.dataset?.tier;
	return inspirationForTier(tier) || Math.max(0, Math.trunc(Number(btn?.dataset?.amount) || 0));
}

/**
 * Ask who heard the speech and give them `amount` each. Closing the picker gives nobody anything. What
 * the card gave is written on it, so the button goes. Whether anyone was given any.
 */
export async function inspireAllies(message, marshal, amount, {
	pick = pickPersonOnMap, party = partyCharacters, share = shareInspiration, scope = SYSTEM_ID,
} = {}) {
	const allies = (party({ exclude: marshal?.id }) ?? []).filter(a => a?.type === "character" && a.id !== marshal?.id);
	if (!allies.length) {
		globalThis.ui?.notifications?.info?.(localize(`${KEY}.noAllies`));
		return false;
	}
	const ids = await pick({
		options: allies.map(actor => ({ id: actor.id, name: actor.name, actor })),
		multiple: true,
		title: localize(`${KEY}.pickTitle`),
		hint: format(`${KEY}.pickHint`, { amount }),
		icon: "fa-bullhorn",
		buttonLabel: localize(`${KEY}.pickChoose`),
		formatLabel: name => format(`${KEY}.pickNamed`, { name, amount }),
		formatManyLabel: count => format(`${KEY}.pickNamedCount`, { count, amount }),
	});
	const chosen = allies.filter(actor => Array.isArray(ids) && ids.includes(actor.id));
	if (!chosen.length) return false;
	const { given, missed } = await share(marshal, chosen, amount, { scope });
	const names = list => joinNames(list.map(actor => actor.name));
	if (given.length) {
		// A Shift Up's second press adds to who heard the first: they hold what it gave them still.
		const before = speechGiven(message.getFlag(scope, SPEECH_FLAG));
		const now = given.map(actor => ({ name: actor.name, amount }));
		const all = [...before.filter(b => !now.some(n => n.name === b.name)), ...now];
		await message.setFlag(scope, SPEECH_FLAG, {
			amount: Math.max(amount, ...before.map(b => b.amount)), names: all.map(g => g.name), given: all,
		});
		globalThis.ui?.notifications?.info?.(format(`${KEY}.given`, { names: names(given), amount }));
	}
	if (missed.length) globalThis.ui?.notifications?.warn?.(format(`${KEY}.missed`, { names: names(missed) }));
	return given.length > 0;
}

/**
 * Who a speech card inspired, and how much each: `given` on the flag, or, on a card written before a
 * second press could add to it, everyone in `names` at the one `amount`. PURE.
 *
 * @returns {{name: string, amount: number}[]}
 */
export function speechGiven(shared) {
	if (Array.isArray(shared?.given)) return shared.given.filter(g => g?.name);
	const amount = Number(shared?.amount) || 0;
	return (Array.isArray(shared?.names) ? shared.names : []).map(name => ({ name, amount }));
}

/** The card's readout of a speech: one sentence per amount given, the most first. PURE. */
function speechReadout(given) {
	const amounts = [...new Set(given.map(g => g.amount))].sort((a, b) => b - a);
	return amounts.map(amount => format(`${KEY}.inspired`, {
		names: joinNames(given.filter(g => g.amount === amount).map(g => g.name)), amount,
	})).join(" ");
}

/**
 * Wire a We Happy Few card's speech buttons (stonetop.js renderChatMessageHTML). Whoever can write both
 * the card and the Marshal presses (chat.js#canRewriteCard); everyone else sees who was inspired.
 */
export function wireSpeechCard(message, html, deps = {}) {
	const root = html?.[0] ?? html;
	const scope = deps.scope ?? SYSTEM_ID;
	const buttons = [...(root?.querySelectorAll?.(".stonetop-inspire-allies") ?? [])].filter(btn => belongsToMessage(btn, message));
	if (!buttons.length) return;
	const marshal = deps.marshal ?? speakerActor(message);
	const shared = message?.getFlag?.(scope, SPEECH_FLAG) ?? null;
	const usable = deps.usable ?? canRewriteCard(message, marshal);

	const row = buttons[0].closest(".stonetop-roll-tier-actions") ?? buttons[0].parentElement;
	row?.parentElement?.querySelectorAll?.(":scope > .stonetop-inspiration-readout").forEach(el => el.remove());
	const given = speechGiven(shared);
	if (given.length && row) {
		const doc = root.ownerDocument ?? globalThis.document;
		const note = doc.createElement("p");
		note.className = "stonetop-inspiration-readout";
		note.textContent = speechReadout(given);
		row.insertAdjacentElement("afterend", note);
	}

	for (const btn of buttons) {
		const amount = buttonAmount(btn);
		const done = Number(shared?.amount) >= amount;
		btn.classList.toggle("is-chosen", done);
		if (!usable || done || !amount) { btn.disabled = true; continue; }
		if (btn.dataset.inspireWired === "1") continue;
		btn.dataset.inspireWired = "1";
		btn.addEventListener("click", async () => {
			if (btn.disabled) return;
			btn.disabled = true;
			let given = false;
			try {
				given = await inspireAllies(message, marshal, amount, deps);
			} catch (err) {
				console.error("Stonetop | We Happy Few's Inspiration could not be given", err);
			}
			if (!given) btn.disabled = false;
		});
	}
}

// -- +1d6 on a damage roll -------------------------------------------------------------------------

/**
 * Which kind of damage card this is: the attack flow's `results` card (flag `damage`, one row per
 * target, Apply beneath), the `plain` card of a roll with nobody targeted, or null for anything else. PURE.
 */
export function damageCardKind(message, scope = SYSTEM_ID) {
	const damage = message?.getFlag?.(scope, "damage");
	if (Array.isArray(damage?.results)) return "results";
	if (message?.rolls?.length && String(message.flavor ?? "").includes("stonetop-damage-roll-card")) return "plain";
	return null;
}

/**
 * Whether this card offers `user` the Inspiration die, and to whom: its speaker's own damage roll, not yet
 * given one, not a follower's blow nor a blow they took, not yet applied; the speaker holding Inspiration
 * in a fight; and `user` the one who presses for them (roll-boosts.js#actsForHelper: their player, the GM
 * only with none online). PURE apart from reading the actors and combats.
 *
 * @returns {{holder: Actor, held: number, kind: "results"|"plain"}|null}
 */
export function inspirationDamageOffer(message, {
	user = globalThis.game?.user, holderOf = speakerActor, ownersOf = ownerUsers,
	combats = globalThis.game?.combats, scope = SYSTEM_ID,
} = {}) {
	const kind = damageCardKind(message, scope);
	if (!kind || message.getFlag(scope, DIE_FLAG) || message.getFlag(scope, FOLLOWER_BLOW_FLAG)) return null;
	const holder = holderOf(message);
	if (holder?.type !== "character") return null;
	if (kind === "results") {
		const damage = message.getFlag(scope, "damage");
		if (damage.selfHarm || damage.groupBlow) return null;
		if ((damage.applied ?? []).length || damage.attackerUuid !== holder.uuid) return null;
	}
	const held = inspirationHeld(holder, scope);
	if (held <= 0 || !inBattle(holder, combats)) return null;
	if (!actsForHelper(user, ownersOf(holder))) return null;
	return { holder, held, kind };
}

/** A d6, rolled. */
async function rollInspirationDie() {
	const roll = await new globalThis.Roll("1d6").evaluate();
	return roll.total;
}

/**
 * The die onto a plain card's roll, as a term of its own: the way stonetop.js#_shiftRoll puts a GM's
 * Shift on, so a Shift after this keeps it, and the Roll still adds up to what the card says. Handed the
 * copy utils/roll-card-writer.js#writeCardRoll lifts, so a refused write leaves the card's own roll as it was.
 */
async function addToRoll(roll, amount) {
	const { OperatorTerm, NumericTerm } = globalThis.foundry.dice.terms;
	roll.terms.push(
		new OperatorTerm({ operator: "+", options: { inspiration: true } }),
		new NumericTerm({ number: amount, options: { inspiration: true } }),
	);
	roll.resetFormula();
	await roll._evaluate();
}

/**
 * Add 1d6 to a damage card: 1 Inspiration spent, the die rolled and added (to every row of a results
 * card, or to a plain card's roll and total), and written on the card, so the button goes. In the card's
 * turn, so it cannot land twice or behind an Apply. Whether it was added.
 *
 * The die is rolled before the Inspiration is spent, and the Inspiration given back if the card cannot
 * take the die (deleted since, or the write refused): it is spent only on a die the card shows.
 *
 * @param {object} deps
 * @param {(flavor: string, total: number, formula: string) => string} deps.cardFlavor  stonetop.js#_shiftRollCardFlavor
 */
export function addInspirationDie(message, holder, {
	cardFlavor = f => f, rollDie = rollInspirationDie, addDie = addToRoll, scope = SYSTEM_ID,
} = {}) {
	return inCardTurn(message, async () => {
		const kind = damageCardKind(message, scope);
		if (!kind || !holder || message.getFlag(scope, DIE_FLAG)) return false;
		const damage = kind === "results" ? message.getFlag(scope, "damage") : null;
		if (damage && (damage.applied ?? []).length) return false;
		if (inspirationHeld(holder, scope) <= 0) return false;
		const amount = Math.trunc(Number(await rollDie()) || 0);
		if (!(await spendInspiration(holder, scope))) return false;
		const record = { by: holder.uuid, name: holder.name, amount };
		try {
			if (damage) {
				const results = damage.results.map(r => ({ ...r, raw: (Number(r.raw) || 0) + amount }));
				await message.update({ flags: { [scope]: { damage: { results }, [DIE_FLAG]: record } } });
			} else {
				await writeCardRoll(message, roll => addDie(roll, amount), {
					cardFlavor: (flavor, total, formula) => cardFlavor(flavor, Math.max(0, total), formula),
				}, { flags: { [scope]: { [DIE_FLAG]: record } } });
			}
		} catch (err) {
			await refundInspiration(holder, scope);
			throw err;
		}
		return true;
	});
}

/** The words a card prints for the die it took: "+1d6 Inspiration (Wren): 4". PURE. */
export function inspirationDieNote(record) {
	return format(`${KEY}.damageNote`, { name: record?.name ?? "", amount: record?.amount ?? 0 });
}

/**
 * Put the Inspiration die button on a damage card, and name the die once taken. Drawn every render from
 * the flag. A results card's totals are redrawn from its rows (the card's own HTML was written before the
 * die); with a fight's +N on the card, attack-flow.js#wireDamageSeed redraws them from the same rows.
 */
export function wireInspirationDamage(message, html, deps = {}, { user = globalThis.game?.user } = {}) {
	const root = html?.[0] ?? html;
	const scope = deps.scope ?? SYSTEM_ID;
	if (!root?.querySelector) return;
	const kind = damageCardKind(message, scope);
	if (!kind) return;
	const row = root.querySelector(kind === "results" ? ".stonetop-attack-actions" : ".stonetop-card-buttons");
	const record = message.getFlag(scope, DIE_FLAG);
	if (record) {
		const damage = kind === "results" ? message.getFlag(scope, "damage") : null;
		if (damage && !damage.seed) {
			for (const rowEl of root.querySelectorAll(".stonetop-damage-row[data-uuid]")) {
				const result = damage.results.find(r => r.uuid === rowEl.dataset.uuid);
				const number = rowEl.querySelector(".stonetop-roll-result-number");
				if (result && number) number.textContent = String(Math.max(0, Number(result.raw) || 0));
			}
		}
		root.querySelectorAll(".stonetop-inspiration-note").forEach(el => el.remove());
		const note = `<p class="stonetop-inspiration-note">${escHtml(inspirationDieNote(record))}</p>`;
		if (row) row.insertAdjacentHTML("beforebegin", note);
		else root.querySelector(".card-content, .cell--chat")?.insertAdjacentHTML("beforeend", note);
		return;
	}
	if (!row) return;
	const offer = inspirationDamageOffer(message, { user, scope, ...(deps.holderOf ? { holderOf: deps.holderOf } : {}) });
	if (!offer) return;
	const route = rollCardRoute(message, user);
	if (!route) return;
	const button = (root.ownerDocument ?? globalThis.document).createElement("button");
	button.type = "button";
	button.className = "stonetop-inspiration-die-btn";
	button.textContent = localize(`${KEY}.damageButton`);
	button.dataset.tooltip = format(`${KEY}.damageTip`, { name: offer.holder.name, held: offer.held });
	button.dataset.tooltipDirection = "UP";
	button.addEventListener("click", async () => {
		if (button.disabled) return;
		button.disabled = true;
		try {
			const added = route === "relay"
				? !!(await askGM(globalThis.game?.users?.activeGM, {
					action: "damage", messageId: message.id, holderUuid: offer.holder.uuid, userId: user?.id ?? null,
				}, false))
				: await addInspirationDie(message, offer.holder, deps);
			if (!added) {
				globalThis.ui?.notifications?.warn?.(localize(`${KEY}.refused`));
				button.disabled = false;
			}
		} catch (err) {
			console.error("Stonetop | adding the Inspiration die failed", err);
			button.disabled = false;
		}
	});
	row.appendChild(button);
	if (kind === "plain") row.style.display = "flex";
}

// -- The GM's side ---------------------------------------------------------------------------------

/**
 * The GM's side of INSPIRATION_QUERY, for the primary GM only. Who asked is read as roll-boosts.js reads
 * it (foundry-compat.js#queryAsker).
 *
 *  - `hold`: each named character holds `amount` (1 or 2), if the asker plays the Marshal and the Marshal
 *    has We Happy Few learned. Answers the uuids given it.
 *  - `damage`: the die on a damage card the asker's client cannot write, if the asker plays the holder and
 *    the card still offers it to them. Answers whether it was added.
 */
export async function handleInspirationQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync, messages = globalThis.game?.messages,
		scope = SYSTEM_ID } = deps;
	const hold = data?.action === "hold";
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return hold ? [] : false;
	const user = queryAsker(data, context, users);
	if (!user) return hold ? [] : false;

	if (hold) {
		const marshal = data?.marshalUuid ? resolve(data.marshalUuid) : null;
		const amount = Math.trunc(Number(data?.amount));
		if (!marshal?.testUserPermission?.(user, "OWNER") || !ownsLearnedMoveNamed(marshal, WE_HAPPY_FEW)) return [];
		if (amount !== 1 && amount !== 2) return [];
		return holdForEach(marshal, data?.targetUuids, target => holdInspiration(target, amount, scope), resolve);
	}

	if (data?.action !== "damage") return false;
	const message = messages?.get?.(data?.messageId);
	const holder = data?.holderUuid ? resolve(data.holderUuid) : null;
	if (!message || !holder?.testUserPermission?.(user, "OWNER")) return false;
	const offer = inspirationDamageOffer(message, { ...deps, user, scope });
	if (offer?.holder?.id !== holder.id) return false;
	return addInspirationDie(message, holder, deps);
}

// -- Keep 1 HP instead of being reduced to 0 HP ------------------------------------------------------

/**
 * Keep 1 HP: 1 Inspiration spent and the character back on 1 HP, no longer dying, in one write (the
 * character model's restoreHp, whose `clearsDeathsDoor` is what Unstoppable reads as "not a heal").
 * `battleJoy` puts back a Battle Joy the drop ended, and `readiness` the Readiness held just before it
 * (the GM's client lets it go when they drop, combat/readiness-loss.js), since they never dropped: both
 * in that same write. Said in chat. Whether it was kept.
 */
export async function keepOneHp(actor, {
	battleJoy = false, readiness = 0, scope = SYSTEM_ID, combats = globalThis.game?.combats,
} = {}) {
	if (!canKeepOneHp(actor, { scope, combats })) return false;
	if (!(await spendInspiration(actor, scope))) return false;
	const joy = battleJoy && actor.getFlag?.(scope, BATTLE_JOY_FLAG) !== true;
	// Only ever back up to what they held: a Defend rolled since has already set it again.
	const ready = readinessCount(readiness) > heldReadiness(actor) ? readinessCount(readiness) : 0;
	await actor.typedActor?.restoreHp?.(1, WE_HAPPY_FEW, { clearsDeathsDoor: true, alsoUpdate: {
		...(joy ? { [`flags.${scope}.${BATTLE_JOY_FLAG}`]: true } : {}),
		...(ready ? { [`flags.${scope}.${READINESS_FLAG}`]: ready } : {}),
	} });
	let note = format(`${KEY}.${joy ? "keptOneHpJoy" : "keptOneHp"}`, { name: actor.name, left: inspirationHeld(actor, scope) });
	if (ready) note += ` ${format(`${KEY}.keptReadiness`, { count: ready })}`;
	await postMoveNote(actor, WE_HAPPY_FEW, note);
	return true;
}

/** Ask whether to spend 1 Inspiration to keep 1 HP. True to keep it. */
export async function askKeepOneHp(actor) {
	const answer = await confirmOutcome({
		title: format(`${KEY}.keepTitle`, { name: actor.name }),
		content: contentElement(`<p>${escHtml(format(`${KEY}.keepAsk`, { name: actor.name, held: inspirationHeld(actor) }))}</p>`),
		yes: { label: localize(`${KEY}.keepButton`), icon: "fa-heart-pulse" },
		no:  { label: localize(`${KEY}.fallButton`), icon: "fa-skull" },
		// The default: spending it is why they hold it.
		defaultYes: true,
	});
	return answer === true;
}

/** Whether the Death's Door walkthrough opens on its own, by the table's two settings. */
function walkthroughAutoOpens() {
	try { return !!getSetting("deathsDoorPrompt") && !!getSetting("deathsDoorAutoOpen"); } catch { return false; }
}

/**
 * The question, and what follows either answer. Kept: 1 HP. Declined: the Death's Door walkthrough, which
 * its own hook stood down for while this was asked (DeathsDoorPrompt.js#onUpdateActorDeathsDoorAutoOpen),
 * when the table has it open on its own and Unstoppable is not keeping them fighting.
 */
export async function offerKeepOneHp(actor, {
	battleJoy = false, readiness = 0, ask = askKeepOneHp, keep = keepOneHp, open = openZeroHpMove, autoOpens = walkthroughAutoOpens,
} = {}) {
	if ((await ask(actor)) && (await keep(actor, { battleJoy, readiness }))) return true;
	if (autoOpens() && !keepsFightingAtZero(actor)) await open(actor);
	return false;
}

/**
 * updateActor, on every client: the write that made a character dying, answered on their own screen
 * (DeathsDoorPrompt.js#answersFor) when they hold Inspiration in a fight. The Battle Joy that write ended
 * (BATTLE_JOY_DROPPED_OPTION) comes back if they keep 1 HP, and so does their Defend Readiness: read here,
 * as it stood before the drop, because the GM's client clears it in a write of its own AFTER this one
 * (combat/readiness-loss.js#installReadinessLoss), which no client has seen land yet.
 */
export function onUpdateActorInspirationAtZero(actor, changes, options = {}, _userId = null, deps = {}) {
	if (actor?.type !== "character") return;
	if (!becameDyingInDiff(changes)) return;
	try {
		const answers = deps.answers ?? answersFor;
		if (!answers(actor) || !canKeepOneHp(actor, deps)) return;
		(deps.offer ?? offerKeepOneHp)(actor, { battleJoy: !!options?.[BATTLE_JOY_DROPPED_OPTION], readiness: heldReadiness(actor) })
			.catch(err => console.error("Stonetop | offering to keep 1 HP failed", err));
	} catch (err) {
		console.error("Stonetop | offering to keep 1 HP failed", err);
	}
}

/**
 * The same offer on the dying card, for a player who closed the question or a table that is only told
 * later: a button beside Face Death's Door while it still stands, for whoever presses the character's
 * buttons (their player; the GM with none online).
 */
export function wireKeepOneHp(message, html, { user = globalThis.game?.user } = {}) {
	const root = html?.[0] ?? html;
	const dying = message?.getFlag?.(STONETOP_SCOPE, "dying");
	const row = root?.querySelector?.(".stonetop-dying-actions");
	if (!dying?.actorUuid || !row) return;
	const doc = resolveSync(dying.actorUuid);
	const actor = doc?.actor ?? doc;
	if (!actor?.isOwner || !canKeepOneHp(actor) || !actsForHelper(user, ownerUsers(actor))) return;
	const button = (root.ownerDocument ?? globalThis.document).createElement("button");
	button.type = "button";
	button.className = "stonetop-dying-btn stonetop-inspiration-keep";
	button.innerHTML = `<i class="fas fa-heart-pulse"></i> ${escHtml(localize(`${KEY}.keepCardButton`))}`;
	button.dataset.tooltip = format(`${KEY}.keepAsk`, { name: actor.name, held: inspirationHeld(actor) });
	button.addEventListener("click", async () => {
		if (button.disabled) return;
		button.disabled = true;
		try {
			if (!(await keepOneHp(actor))) button.disabled = false;
		} catch (err) {
			console.error("Stonetop | keeping 1 HP failed", err);
			button.disabled = false;
		}
	});
	row.appendChild(button);
}

// -- Act fearlessly --------------------------------------------------------------------------------

/** Spend 1 Inspiration to act fearlessly, and say so in chat. Whether one was spent. */
export async function actFearlessly(actor, scope = SYSTEM_ID) {
	if (!(await spendInspiration(actor, scope))) return false;
	await postMoveNote(actor, WE_HAPPY_FEW, format(`${KEY}.fearlessDone`, { name: actor.name, left: inspirationHeld(actor, scope) }));
	return true;
}
