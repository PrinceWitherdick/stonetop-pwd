/**
 * The "Give advantage to..." button at the table (the rules and the button are give-advantage.js's).
 *
 * Only whoever can write the card and the giver presses it (the giver's player, or the GM:
 * chat.js#canRewriteCard). A character this client owns is written here; any other goes to the GM's
 * client (GIVE_ADVANTAGE_QUERY), whose handler checks the asker plays the giver and has the move
 * learned, as Piety's Blessing is given. The card is latched on the press (GIVING_FLAG) and
 * remembers who it gave it to (GIVEN_FLAG), so the button goes once pressed.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { GIVE_ADVANTAGE_MOVES, advantageRecipients, givenSource, mayReceive } from "./give-advantage.js";
import { asteriskMoveUsed } from "./WouldBeHeroAsterisk.js";
import { pickPersonOnMap } from "../../dialogs/RelationshipLinkDialog.js";
import { partyCharacters } from "../../utils/playbook-actors.js";
import { canRewriteCard, stonetopChatCard } from "../../utils/chat.js";
import { HERO_MOVES, commandHeld, orderFocusFire, recordRapierWit, recordTruth, recordSpeakSoftly, foeKey } from "../../fight/hero-moves.js";
import { engagedOpponents, foesInFight } from "../../fight/fight-targets.js";
import { promptForText } from "../../dialogs/content-picker.js";
import { belongsToMessage } from "../../utils/picked-option-button.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { askGMClient, deletionEntry, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { withCardLatch } from "../../utils/card-latch.js";
import { cardCountedTier, outcomeTier } from "../../utils/counted-tier.js";
import { format, localize } from "../../utils/i18n.js";
import { learnedTrack, takeBackHeld } from "./MoveResources.js";
import { escHtml, joinNames } from "../../utils/strings.js";

/** The User query a gift of advantage goes through when this client cannot write the character. */
export const GIVE_ADVANTAGE_QUERY = "stonetop.giveAdvantage";
/**
 * Message flag: who this card gave its advantage to, `{name, move, uuid, source}`: the character's uuid and
 * the name the promise is held under, so a card moved off the tier that gave it can take it back
 * (reconcileGivenAdvantage). A card from before carries `{name, move}` only, and keeps its gift.
 */
export const GIVEN_FLAG = "advantageGiven";
/**
 * Message flag: the user whose press is giving it (card-latch.js#withCardLatch), written before the
 * picker opens, so another client's button goes while they choose.
 */
export const GIVING_FLAG = "advantageGiving";

/** The cards this client is choosing on right now, by message id. */
const _choosing = new Set();

/** The once-only "they did" buttons this client is pressing right now (wireRecordOnce), by `${message id}:${flag}`. */
const _recording = new Set();

/**
 * Hold advantage on `target`'s next roll for `moveName`: written here when this client owns them,
 * otherwise by the GM's client. Whether it was held.
 */
export async function giveAdvantage(giver, target, moveName, {
	gm = globalThis.game?.users?.activeGM ?? null, userId = globalThis.game?.user?.id ?? null,
} = {}) {
	if (target?.type !== "character") return false;
	if (!mayReceive(giver, target, moveName)) return false;
	if (target.isOwner) {
		await target.typedActor?.holdAdvantage?.(givenSource(moveName, giver, target));
		return true;
	}
	return !!(await askGMClient(gm, GIVE_ADVANTAGE_QUERY, {
		giverUuid: giver?.uuid ?? null, targetUuid: target.uuid, moveName, userId,
	}, { fallback: false, what: "give advantage" }));
}

/**
 * The GM's side of GIVE_ADVANTAGE_QUERY, for the primary GM only: the asker must play the giver, the
 * giver hold the move learned, and the target be a character the move allows. Who asked is read as
 * roll-boosts.js reads it (foundry-compat.js#queryAsker). Whether it was held.
 */
export async function handleGiveAdvantageQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync } = deps;
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return false;
	const user = queryAsker(data, context, users);
	const giver = data?.giverUuid ? resolve(data.giverUuid) : null;
	const target = data?.targetUuid ? resolve(data.targetUuid) : null;
	const moveName = data?.moveName;
	if (!user || !GIVE_ADVANTAGE_MOVES[moveName] || !giver?.testUserPermission?.(user, "OWNER")) return false;
	if (!ownsLearnedMoveNamed(giver, moveName) || target?.type !== "character") return false;
	if (!mayReceive(giver, target, moveName)) return false;
	await target.typedActor?.holdAdvantage?.(givenSource(moveName, giver, target));
	return true;
}

/**
 * A roll card's total has moved (a Shift, a +1, Burn Brightly): a gift its tier gave is taken back once the
 * card no longer stands on a tier that gives it (Everything Burns' 10+, Work With What You've Got's 7+,
 * Resourceful's 6-), as the other things a tier holds are (tier-effects.js). The card forgets it gave
 * anything, so its button is back should the card return to such a tier (unless the gift was already spent,
 * below). Run where every rewrite's tier
 * effects run (tier-effects.js#reconcileTierEffects), on the client that rewrote the card.
 *
 * Left as it is when this client cannot write the character who holds it, and for a card from before the
 * gift's uuid was kept: a card that forgot a gift it could not take back would let it be given twice. For
 * the same reason a gift already SPENT (used on a roll since) is not forgotten: the card marks it `spent`
 * and keeps its readout, and its button never comes back.
 * Whether it was taken back.
 *
 * @param {ChatMessage} message
 * @param {number} total  the card's new total
 */
export async function reconcileGivenAdvantage(message, total, { scope = SYSTEM_ID, resolve = resolveSync } = {}) {
	const given = message?.getFlag?.(scope, GIVEN_FLAG);
	const tiers = GIVE_ADVANTAGE_MOVES[given?.move]?.tiers;
	if (!given?.uuid || given.spent || !tiers?.length || !Number.isFinite(Number(total))) return false;
	if (tiers.includes(outcomeTier(cardCountedTier(message, Number(total), scope)))) return false;
	const target = resolve(given.uuid);
	if (target && target.isOwner === false) {
		console.warn(`Stonetop | this client cannot write ${target.name}, so the advantage their moved roll card gave was not taken back`);
		return false;
	}
	const released = await target?.typedActor?.releaseHeldAdvantage?.(given.source ?? given.move);
	// Nothing held to take back (spent on a roll since, or the character gone): the card keeps its record,
	// marked spent, so a card brought back onto the tier does not give the same roll's advantage twice.
	if (!released) {
		await message.setFlag(scope, GIVEN_FLAG, { ...given, spent: true });
		return false;
	}
	const update = Object.fromEntries([GIVEN_FLAG, GIVING_FLAG]
		.filter(key => message.getFlag(scope, key) !== undefined && message.getFlag(scope, key) !== null)
		.map(key => deletionEntry(`flags.${scope}.${key}`)));
	if (Object.keys(update).length) await message.update(update);
	return true;
}

/**
 * Ask who, give it, and write it on the card. Whether it was given. `stillMine`, from the card's
 * button, answers whether this client still holds the card's latch once someone is picked: when
 * another client pressed it too, the later press holds the card, and this one gives nothing and
 * answers true, so the latch it lost is not taken back from the other.
 *
 * A `selfOnly` move (Resourceful, Inquiring Minds) asks nobody: the giver is the one who holds it.
 */
export async function offerAdvantage(message, giver, moveName, {
	pick = pickPersonOnMap, party = partyCharacters, give = giveAdvantage, scope = SYSTEM_ID, stillMine = null,
} = {}) {
	const rule = GIVE_ADVANTAGE_MOVES[moveName];
	const selfOnly = !!rule?.selfOnly;
	// A press paid for off a hold (Stentorian's Command): refused, and nothing asked, with none held.
	if (rule?.spendHeld && !(learnedTrack(giver, rule.spendHeld)?.held > 0)) {
		globalThis.ui?.notifications?.warn?.(format("stonetop.heldAdvantage.noneHeld", { move: rule.spendHeld }));
		return false;
	}
	const recipients = advantageRecipients(giver, moveName, selfOnly ? [] : party({ exclude: giver?.id }));
	if (!recipients.length) {
		globalThis.ui?.notifications?.info?.("There is no other player character to give it to.");
		return false;
	}
	const options = recipients.map(actor => ({ id: actor.id, name: actor.name, actor, hint: actor.id === giver?.id ? "You" : "" }));
	// "PCs get advantage" (Stentorian): whoever heard, ticked in one window.
	const ids = selfOnly ? [giver?.id] : [await pick({
		options,
		multiple: !!rule?.many,
		title: `${moveName}: advantage on the next roll`,
		hint: rule?.many ? localize("stonetop.heldAdvantage.whoHeard") : "Who gains advantage on their next roll?",
		icon: "fa-angles-up",
		buttonLabel: "Choose someone",
		formatLabel: name => `Give ${name} advantage`,
		formatManyLabel: count => `Give ${count} of them advantage`,
	})].flat();
	const targets = recipients.filter(actor => ids.includes(actor.id));
	if (!targets.length) return false;
	if (stillMine && !stillMine()) return true;
	const gave = await Promise.all(targets.map(target => give(giver, target, moveName)));
	const given = targets.filter((target, i) => gave[i]);
	for (const target of targets.filter((target, i) => !gave[i])) {
		globalThis.ui?.notifications?.warn?.(`${target.name} could not be given advantage: no GM is online to write it.`);
	}
	if (!given.length) return false;
	// Paid once the advantage is held, so a press that gave nobody anything costs nothing.
	if (rule?.spendHeld) await takeBackHeld(giver, rule.spendHeld, 1);
	const [target] = given;
	const names = joinNames(given.map(actor => actor.name));
	await message.setFlag(scope, GIVEN_FLAG, {
		name: names, move: moveName, uuid: target.uuid ?? null, source: givenSource(moveName, giver, target),
		...(given.length > 1 ? { several: true } : {}),
	});
	globalThis.ui?.notifications?.info?.(`${names} ${given.length > 1 ? "have" : "has"} advantage on their next roll (${moveName}).`);
	// Voice of Experience's advice given is a use of the starred move: the first crosses off "Would-be"
	// (WouldBeHeroAsterisk.js). Never at the cost of the gift, which is already held and written.
	await asteriskMoveUsed(giver, moveName).catch(err => console.warn(`Stonetop | could not note ${moveName}'s use`, err));
	return true;
}

/**
 * Wire a card's "Give advantage to..." buttons (stonetop.js renderChatMessageHTML). Once given, the
 * button is replaced by who has it; before then, only whoever can write the card and the giver sees
 * it.
 */
export function wireGiveAdvantage(message, html, deps = {}) {
	const root = html?.[0] ?? html;
	const scope = deps.scope ?? SYSTEM_ID;
	const buttons = [...(root?.querySelectorAll?.(".stonetop-give-advantage") ?? [])].filter(btn => belongsToMessage(btn, message));
	if (!buttons.length) return;
	const giver = deps.giver ?? speakerActor(message);
	const given = message?.getFlag?.(scope, GIVEN_FLAG) ?? null;
	const usable = deps.usable ?? canRewriteCard(message, giver);
	const me = deps.userId ?? globalThis.game?.user?.id ?? "";
	// Someone is choosing: another user, or this client already (a re-render mid-choice). A latch of
	// this user's own with nothing in flight (a reload mid-choice) is theirs to press again.
	const giving = message?.getFlag?.(scope, GIVING_FLAG) ?? null;
	const heldElsewhere = (!!giving && giving !== me) || _choosing.has(message?.id);
	for (const btn of buttons) {
		if (given?.name) {
			const doc = root.ownerDocument ?? globalThis.document;
			const note = doc.createElement("span");
			note.className = "stonetop-give-advantage-readout";
			note.textContent = given.spent
				? format("stonetop.heldAdvantage.givenSpent", { name: given.name })
				: `${given.name} ${given.several ? "have" : "has"} advantage on their next roll.`;
			btn.replaceWith(note);
			continue;
		}
		const moveName = btn.dataset?.move;
		const rule = GIVE_ADVANTAGE_MOVES[moveName];
		if (!usable || !giver || !rule) { btn.remove(); continue; }
		// A move whose button waits on its own card (`gate`): Set-Up Strike's Aid, on this Clash's damage being
		// dealt with its disadvantage (give-advantage.js#setUpStrikeGate).
		const gate = rule.gate?.(message, scope) ?? "open";
		btn.disabled = heldElsewhere || gate !== "open";
		showGateHint(btn, gate, rule.gateKey);
		if (btn.dataset.giveWired === "1") continue;
		btn.dataset.giveWired = "1";
		// Latched on the card FIRST (card-latch.js), as every once-per-card button is: the GM and
		// the giver's player can both press it, and a gift is given once.
		btn.addEventListener("click", async () => {
			if (btn.disabled) return;
			const stillMine = () => message.getFlag(scope, GIVING_FLAG) === me;
			_choosing.add(message.id);
			try {
				// This user's own latch (a reload mid-choice) is theirs to take again; another user's is not.
				await withCardLatch(message, GIVING_FLAG, me, buttons,
					() => offerAdvantage(message, giver, moveName, { ...deps, stillMine }),
					{ taken: held => !!held && held !== me });
			} catch (err) {
				console.error(`Stonetop | ${moveName}'s advantage could not be given`, err);
			} finally {
				_choosing.delete(message.id);
			}
		});
	}
}

/**
 * Say on the card why a gated button is greyed out (give-advantage.js's `gate`), in words beside it, not only
 * a tooltip: `${gateKey}.${gate}`.
 */
function showGateHint(btn, gate, gateKey) {
	const next = btn.nextElementSibling;
	if (next?.classList?.contains("stonetop-give-advantage-gate")) next.remove();
	btn.removeAttribute?.("data-tooltip");
	if (gate === "open") return;
	const words = localize(`${gateKey}.${gate}`);
	btn.dataset.tooltip = words;
	const doc = btn.ownerDocument ?? globalThis.document;
	const note = doc.createElement("span");
	note.className = "stonetop-give-advantage-readout stonetop-give-advantage-gate";
	note.textContent = words;
	btn.after(note);
}

/** Message flag: the foe a Focus Fire card's order named, `{foe}`, so its button goes once pressed. */
export const FOCUS_FIRE_CARD_FLAG = "focusFireOrdered";

/** The tokens this user has targeted on the map. */
const userTargets = () => [...(globalThis.game?.user?.targets ?? [])];

/**
 * Wire Focus Fire's button (give-advantage.js#focusFireCardHtml): pressed by whoever can write the card and
 * the Marshal, at the ONE foe they have targeted, it spends 1 Command and gives the order
 * (fight/hero-moves.js#orderFocusFire). The card then says whom, and the button goes. Wired on its own
 * (stonetop.js renderChatMessageHTML), beside the giving moves' buttons on the same posted cards.
 */
export function wireFocusFire(message, html, deps = {}) {
	const order = deps.order ?? orderFocusFire;
	const targets = deps.targets ?? userTargets;
	wireRecordOnce(message, html, deps, {
		selector: ".stonetop-focus-fire",
		flag: FOCUS_FIRE_CARD_FLAG,
		wired: "focusWired",
		readout: ({ foe }) => format("stonetop.fight.heroMoves.focusFire.readout", { foe }),
		failed: "Focus Fire could not be ordered",
		// Checked before the card is claimed: the ONE foe targeted, and a Command to spend.
		ready: marshal => {
			const aimed = targets();
			if (aimed.length !== 1) {
				globalThis.ui?.notifications?.info?.(localize("stonetop.fight.heroMoves.focusFire.targetOne"));
				return null;
			}
			if (!commandHeld(marshal)) {
				globalThis.ui?.notifications?.warn?.(format("stonetop.heldAdvantage.noneHeld", { move: HERO_MOVES.STENTORIAN }));
				return null;
			}
			return aimed[0];
		},
		// The card is claimed BEFORE the Command is spent, so a second press (here or on the GM's screen)
		// finds the claim rather than spending another Command on a second order.
		press: async (msg, marshal, { scope = SYSTEM_ID }, token) => {
			const foe = { uuid: token?.document?.uuid ?? token?.uuid ?? "", name: token?.name ?? token?.document?.name ?? "" };
			const entry = await order(marshal, foe);
			if (!entry) return false;
			// Given: the Command is spent, so the claim stays even if the card cannot say whom.
			try {
				await msg.setFlag(scope, FOCUS_FIRE_CARD_FLAG, { foe: entry.name || foe.name });
				await globalThis.ChatMessage?.create?.({
					content: stonetopChatCard(HERO_MOVES.FOCUS_FIRE, `<div class="card-content"><p>${escHtml(format("stonetop.fight.heroMoves.focusFire.card", { name: marshal.name, foe: entry.name || foe.name }))}</p></div>`, "stonetop-focus-fire-card"),
					speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: marshal }),
				});
			} catch (err) {
				console.error("Stonetop | Focus Fire could not be ordered", err);
			}
			return true;
		},
	});
}

/** Message flag: the foe a Rapier Wit card's "They attack" named, `{foe}`, so its button goes once pressed. */
export const RAPIER_WIT_CARD_FLAG = "rapierWitAttacked";

/** A token this user has targeted, as a foe to name: `{uuid, name}`. */
const targetedFoe = token => ({ uuid: token?.document?.uuid ?? token?.uuid ?? "", name: token?.document?.name ?? token?.name ?? "" });

/** The picker's row for someone who is not on the map: the name is asked for next. */
const SOMEONE_ELSE = "__someone-else__";

/**
 * Whom a no-roll move's button is about: the ONE token this user has targeted; else picked from the several
 * targeted, or from the first of `pools` (each asked of `actor` in turn) that finds anyone.
 *
 * With `allowNamed` (Truth or Consequences, Speak Softly: said to people who may have no token at all), the
 * picker carries a row for someone not on the map, and with nobody on the map to point at, a name is typed in.
 * Without it (Rapier Wit), the one foe found is taken unasked, and targets naming no token find nobody.
 * `{uuid, name}` for one on the map, `{name, named: true}` for one only named, or null when there is nobody
 * or the question was put away.
 *
 * @param {Actor} actor
 * @param {object} how
 * @param {Array<(actor: Actor) => Array<{uuid: string, name: string}>>} how.pools
 * @param {boolean} [how.allowNamed]
 * @param {() => {pick: object, someoneElse?: string, name?: object}} how.words  asked only once they are shown:
 *   the picker's title, hint, icon and buttonLabel; the "someone else" row's name; the name prompt's title,
 *   buttonLabel and placeholder
 */
async function pickFoe(actor, { pools, allowNamed = false, words }, {
	targets = userTargets, pick = pickPersonOnMap, askName = promptForText, resolve = resolveSync,
} = {}) {
	const aimed = targets().map(targetedFoe);
	const onMap = aimed.filter(foe => foe.uuid);
	if (onMap.length === 1) return onMap[0];
	let candidates = onMap;
	if (!candidates.length && (allowNamed || !aimed.length)) {
		for (const pool of pools) {
			candidates = pool(actor).filter(foe => foe?.uuid);
			if (candidates.length) break;
		}
	}
	const options = () => candidates.map(foe => ({ id: foe.uuid, name: foe.name, actor: resolve(foe.uuid)?.actor ?? null }));
	if (!allowNamed) {
		if (candidates.length <= 1) return candidates[0] ?? null;
		const [id] = [await pick({ options: options(), ...words().pick })].flat();
		return candidates.find(foe => foe.uuid === id) ?? null;
	}
	if (candidates.length) {
		const said = words();
		const [id] = [await pick({ options: [...options(), { id: SOMEONE_ELSE, name: said.someoneElse, actor: null }], ...said.pick })].flat();
		if (!id) return null;
		if (id !== SOMEONE_ELSE) return candidates.find(foe => foe.uuid === id) ?? null;
	}
	const name = await askName(words().name);
	const said = String(name ?? "").trim();
	return said ? { name: said, named: true } : null;
}

/**
 * Wire a card's once-only "they did" button (Rapier Wit's "They attack", Speak Softly's "They refused"): pressed
 * by whoever can write the card and the one who posted it (their player, or the GM), once per card. Once
 * pressed, the card says whom (`flag`'s `{foe}`, in `readout`'s words), and the button goes. `press` records
 * it and answers whether it did: a press that recorded nothing leaves the button live. `wired` is the button's
 * dataset key, so a re-render wires it once. The card is CLAIMED before `press` runs (card-latch.js#withCardLatch),
 * so a second press on another screen finds the claim rather than recording twice, and a press that recorded
 * nothing gives the claim back. The claim names its user (`{pending, by}`): one of this user's own with nothing
 * in flight here (a reload while the foe picker was open) is theirs to press again, as wireGiveAdvantage's is.
 * `ready(actor)`, when given, is asked first: null stops the press before the claim, anything else is handed
 * to `press` as its fourth argument.
 */
function wireRecordOnce(message, html, deps, { selector, flag, wired, readout, press, failed, ready = null }) {
	const root = html?.[0] ?? html;
	const buttons = [...(root?.querySelectorAll?.(selector) ?? [])].filter(btn => belongsToMessage(btn, message));
	if (!buttons.length) return;
	const scope = deps.scope ?? SYSTEM_ID;
	const actor = deps.giver ?? speakerActor(message);
	const recorded = message?.getFlag?.(scope, flag) ?? null;
	const usable = deps.usable ?? canRewriteCard(message, actor);
	const me = deps.userId ?? globalThis.game?.user?.id ?? "";
	const inFlight = `${message?.id}:${flag}`;
	// Claimed by another user, or by this client still pressing: theirs. This user's own stale claim: not.
	const claimedElsewhere = held => !!held?.pending && (held.by !== me || _recording.has(inFlight));
	for (const btn of buttons) {
		if (recorded?.foe) {
			const doc = root.ownerDocument ?? globalThis.document;
			const note = doc.createElement("span");
			note.className = "stonetop-give-advantage-readout";
			note.textContent = readout(recorded);
			btn.replaceWith(note);
			continue;
		}
		if (!usable || !actor) { btn.remove(); continue; }
		// Claimed on another screen, nothing recorded yet: nothing to press here meanwhile.
		btn.disabled = claimedElsewhere(recorded);
		if (btn.dataset[wired] === "1") continue;
		btn.dataset[wired] = "1";
		btn.addEventListener("click", async () => {
			if (btn.disabled || _recording.has(inFlight)) return;
			const readied = ready ? ready(actor) : true;
			if (!readied) return;
			// Given back only while nothing was recorded: a press that wrote its `{foe}` and then failed on
			// its chat card has still recorded it.
			const wrote = () => !!message.getFlag?.(scope, flag)?.foe;
			_recording.add(inFlight);
			try {
				await withCardLatch(message, flag, { pending: true, by: me }, [btn], async () => {
					try {
						return !!await press(message, actor, deps, readied) || wrote();
					} catch (err) {
						if (!wrote()) throw err;
						console.error(`Stonetop | ${failed}`, err);
						return true;
					}
				}, { scope, taken: held => !!held && (!!held.foe || held.by !== me) });
			} catch (err) {
				console.error(`Stonetop | ${failed}`, err);
			} finally {
				_recording.delete(inFlight);
			}
		});
	}
}

/**
 * Which NPC answered the quip by attacking: the one this user has targeted, else the one the Fox is fighting
 * (fight/fight-targets.js#engagedOpponents), asked among several either way. Null when there is nobody to
 * name, or the question was put away. `{uuid, name}`.
 */
function rapierWitFoe(fox, deps = {}) {
	return pickFoe(fox, {
		pools: [deps.engaged ?? engagedOpponents],
		words: () => ({
			pick: {
				title: format("stonetop.fight.heroMoves.rapierWit.pickTitle", { name: fox.name }),
				hint: localize("stonetop.fight.heroMoves.rapierWit.pickHint"),
				icon: "fa-face-angry",
				buttonLabel: localize("stonetop.fight.heroMoves.rapierWit.pickButton"),
			},
		}),
	}, deps);
}

/**
 * Rapier Wit's "Attack" choice, pressed: remember the NPC on the Fox, both halves owed (fight/hero-moves.js#
 * recordRapierWit), write who on the card so its button goes, and tell the table. Whether it was recorded.
 */
export async function rapierWitAttack(message, fox, deps = {}) {
	const scope = deps.scope ?? SYSTEM_ID;
	const record = deps.record ?? recordRapierWit;
	const foe = await rapierWitFoe(fox, deps);
	if (!foe) {
		globalThis.ui?.notifications?.info?.(localize("stonetop.fight.heroMoves.rapierWit.targetOne"));
		return false;
	}
	if (!await record(fox, [{ key: foeKey(foe), name: foe.name }])) return false;
	await message.setFlag(scope, RAPIER_WIT_CARD_FLAG, { foe: foe.name });
	await globalThis.ChatMessage?.create?.({
		content: stonetopChatCard(HERO_MOVES.RAPIER_WIT, `<div class="card-content"><p>${escHtml(format("stonetop.fight.heroMoves.rapierWit.card", { name: fox.name, foe: foe.name }))}</p></div>`, "stonetop-rapier-wit-card"),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: fox }),
	});
	return true;
}

/**
 * Wire Rapier Wit's "They attack" button (give-advantage.js#rapierWitCardHtml): pressed by whoever can write
 * the card and the Fox (the Fox's player, or the GM), once per card. Once pressed, the card says who
 * attacked, and the button goes. Wired on its own (stonetop.js renderChatMessageHTML).
 */
export function wireRapierWit(message, html, deps = {}) {
	wireRecordOnce(message, html, deps, {
		selector: ".stonetop-rapier-wit", flag: RAPIER_WIT_CARD_FLAG, wired: "rapierWired",
		readout: attacked => format("stonetop.fight.heroMoves.rapierWit.readout", { foe: attacked.foe }),
		press: rapierWitAttack, failed: "Rapier Wit's attack could not be recorded",
	});
}

/** Message flag: who a Truth or Consequences card's buttons named, `[{mode, foe}]`, read back as its readout. */
export const TRUTH_CARD_FLAG = "truthRecorded";

/**
 * The tokens on the scene this user is looking at, other than `actor`'s own, as targets: who a Judge may have
 * looked in the eye with nobody targeted or fought. Hidden tokens only for a GM.
 */
function sceneTokens(actor) {
	const scene = globalThis.canvas?.scene ?? globalThis.game?.scenes?.viewed ?? null;
	const isGM = !!globalThis.game?.user?.isGM;
	return [...(scene?.tokens ?? [])]
		.filter(doc => doc?.actor && doc.actor.id !== actor?.id && (!doc.hidden || isGM))
		.map(doc => ({ uuid: doc.uuid, name: doc.name ?? doc.actor?.name ?? "" }));
}

/**
 * Whom the Judge's Truth or Consequences is about, as Rapier Wit's foe is found (rapierWitFoe): the ONE this
 * user has targeted; else picked from the several targeted, the ones the Judge is fighting, or anyone on the
 * scene (the move is not only for fights), with a row for someone not on the map; else, with nobody on the map
 * to point at, a name typed in, as Speak Softly's enemy is (speakSoftlyFoe). The move is mostly said across a
 * table or a counter, to someone who may have no token at all. `{uuid, name}` for one on the map,
 * `{name, named: true}` for one only named, or null when the question was put away.
 */
function truthSubject(judge, mode, deps = {}) {
	const key = "stonetop.fight.heroMoves.truth";
	return pickFoe(judge, {
		pools: [deps.engaged ?? engagedOpponents, deps.onScene ?? sceneTokens],
		allowNamed: true,
		words: () => ({
			pick: {
				title: localize(`${key}.${mode}PickTitle`),
				hint: localize(`${key}.${mode}PickHint`),
				icon: mode === "adv" ? "fa-eye" : "fa-masks-theater",
				buttonLabel: localize(`${key}.pickButton`),
			},
			someoneElse: localize(`${key}.someoneElse`),
			name: {
				title: localize(`${key}.${mode}PickTitle`),
				buttonLabel: localize(`${key}.pickButton`),
				placeholder: localize(`${key}.namePlaceholder`),
			},
		}),
	}, deps);
}

/**
 * One of Truth or Consequences' buttons, pressed (`mode` "adv" for "They said Yes", "dis" for "I deceived
 * them"): ask whom, remember them on the Judge for the Judge's next roll against them
 * (fight/hero-moves.js#recordTruth), and write it on the card's readout. Whether it was recorded.
 */
export async function truthRecorded(message, judge, mode, deps = {}) {
	const scope = deps.scope ?? SYSTEM_ID;
	const record = deps.record ?? recordTruth;
	const foe = await truthSubject(judge, mode, deps);
	if (!foe) return false;
	const entry = foe.named ? { name: foe.name, named: true } : { key: foeKey(foe), name: foe.name };
	if (!await record(judge, [entry], mode)) return false;
	const held = message?.getFlag?.(scope, TRUTH_CARD_FLAG);
	const kept = (Array.isArray(held) ? held : []).filter(entry => !(entry?.mode === mode && entry?.foe === foe.name));
	try {
		await message.setFlag(scope, TRUTH_CARD_FLAG, [...kept, { mode, foe: foe.name, ...(foe.named ? { named: true } : {}) }]);
	} catch (err) {
		console.warn("Stonetop | Truth or Consequences was recorded, but the card could not say so", err);
	}
	return true;
}

/**
 * Wire Truth or Consequences' "They said Yes" and "I deceived them" buttons (give-advantage.js#truthCardHtml):
 * pressed by whoever can write the card and the Judge (the Judge's player, or the GM), as often as the
 * fiction calls for. The card lists what each press recorded. Wired on its own (stonetop.js
 * renderChatMessageHTML).
 */
export function wireTruthOrConsequences(message, html, deps = {}) {
	const root = html?.[0] ?? html;
	const buttons = [...(root?.querySelectorAll?.(".stonetop-truth") ?? [])].filter(btn => belongsToMessage(btn, message));
	if (!buttons.length) return;
	const scope = deps.scope ?? SYSTEM_ID;
	const judge = deps.giver ?? speakerActor(message);
	const usable = deps.usable ?? canRewriteCard(message, judge);
	const doc = root.ownerDocument ?? globalThis.document;
	// The readout: ours out first, since a re-render patches the same row, then one line per press.
	const row = buttons[0].closest(".stonetop-truth-row") ?? buttons[0].parentElement;
	row?.parentElement?.querySelectorAll?.(".stonetop-truth-readout").forEach(el => el.remove());
	const held = message?.getFlag?.(scope, TRUTH_CARD_FLAG);
	// Each laid straight after the buttons, so walked newest first to read oldest first.
	for (const entry of (Array.isArray(held) ? [...held] : []).reverse()) {
		if (entry?.mode !== "adv" && entry?.mode !== "dis") continue;
		const note = doc.createElement("p");
		note.className = "stonetop-give-advantage-readout stonetop-truth-readout";
		note.textContent = format(`stonetop.fight.heroMoves.truth.${entry.mode}Readout${entry.named ? "Named" : ""}`, { foe: entry.foe ?? "" });
		row?.after?.(note);
	}
	for (const btn of buttons) {
		if (!usable || !judge) { btn.remove(); continue; }
		if (btn.dataset.truthWired === "1") continue;
		btn.dataset.truthWired = "1";
		btn.addEventListener("click", async () => {
			if (btn.disabled) return;
			btn.disabled = true;
			try {
				await truthRecorded(message, judge, btn.dataset.truth === "dis" ? "dis" : "adv", deps);
			} catch (err) {
				console.error("Stonetop | Truth or Consequences could not be recorded", err);
			} finally {
				btn.disabled = false;
			}
		});
	}
}

/** Message flag: the enemy a Speak Softly card's "They refused" named, `{foe}`, so its button goes once pressed. */
export const SPEAK_SOFTLY_CARD_FLAG = "speakSoftlyRefused";

/**
 * Who refused the Marshal's peace: the ONE token this user has targeted; else picked from the several
 * targeted, or from the foes in the Marshal's fight (fight/fight-targets.js#foesInFight), with a row for
 * someone not on the map; else, with nobody on the map to point at, a name typed in. `{uuid, name}` for one on
 * the map, `{name, named: true}` for one only named, or null when the question was put away.
 */
function speakSoftlyFoe(marshal, deps = {}) {
	const key = "stonetop.fight.heroMoves.speakSoftly";
	return pickFoe(marshal, {
		pools: [deps.fight ?? foesInFight],
		allowNamed: true,
		words: () => ({
			pick: {
				title: localize(`${key}.pickTitle`),
				hint: localize(`${key}.pickHint`),
				icon: "fa-dove",
				buttonLabel: localize(`${key}.pickButton`),
			},
			someoneElse: localize(`${key}.someoneElse`),
			name: {
				title: localize(`${key}.nameTitle`),
				buttonLabel: localize(`${key}.pickButton`),
				placeholder: localize(`${key}.namePlaceholder`),
			},
		}),
	}, deps);
}

/**
 * Speak Softly's "They refused", pressed: ask who, remember them on the Marshal for the Marshal's next roll
 * against them (fight/hero-moves.js#recordSpeakSoftly), and write who on the card so its button goes.
 * Whether it was recorded.
 */
export async function speakSoftlyRefused(message, marshal, deps = {}) {
	const scope = deps.scope ?? SYSTEM_ID;
	const record = deps.record ?? recordSpeakSoftly;
	const foe = await speakSoftlyFoe(marshal, deps);
	if (!foe) return false;
	const entry = foe.named ? { name: foe.name, named: true } : { key: foeKey(foe), name: foe.name };
	if (!await record(marshal, [entry])) return false;
	await message.setFlag(scope, SPEAK_SOFTLY_CARD_FLAG, { foe: foe.name, ...(foe.named ? { named: true } : {}) });
	return true;
}

/**
 * Wire Speak Softly's "They refused" button (give-advantage.js#speakSoftlyCardHtml): pressed by whoever can
 * write the card and the Marshal (the Marshal's player, or the GM), once per card. Once pressed, the card says
 * who refused, and the button goes. Wired on its own (stonetop.js renderChatMessageHTML).
 */
export function wireSpeakSoftly(message, html, deps = {}) {
	wireRecordOnce(message, html, deps, {
		selector: ".stonetop-speak-softly", flag: SPEAK_SOFTLY_CARD_FLAG, wired: "speakSoftlyWired",
		readout: refused => format(`stonetop.fight.heroMoves.speakSoftly.${refused.named ? "readoutNamed" : "readout"}`, { foe: refused.foe }),
		press: speakSoftlyRefused, failed: "Speak Softly's refusal could not be recorded",
	});
}
