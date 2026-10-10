/**
 * What two Invocations DO, from the Invoke the Sun God card that names them (invoke-consequences.js
 * #cardInvocations): a button on the card for each, once per card.
 *
 *   BATH OF HEALING LIGHT: "Cup your hands around your light and focus it. Your patient... (pick 2):
 *     Regains 5 HP (can pick this twice) / Clears a debility (can pick this twice) / Has one of their
 *     problematic wounds stabilized / Recovers from a minor condition (drunk, etc.).
 *     Reduced: pick only 1 (instead of 2).
 *     Empowered: add these to your possible choices: Regains 10 HP (can pick this twice) / Fully
 *     recovers from a problematic wound / Is cured of a dire affliction, poison, or disease."
 *
 *   GO BACK TO THE SHADOW: "Spirits of darkness in your light take 2d8 damage (ignores armor). Roll
 *     damage for each spirit separately. ... Reduced: affected spirits take only 1d8 damage."
 *
 * WHY THE ROLL CARD and not the Invocation's own card: the reduced effect is one of Invoke's
 * consequences, ticked on the roll card's own list (or the Wielder of the White Flame's "as a 10+"
 * card, which carries the same list), and whether it was empowered is stamped there
 * (CARD_EMPOWERED_FLAG). The Invocation's description card knows neither. A 6- grows no button: nothing
 * says it worked, and the GM says what happens.
 *
 * BATH OF HEALING LIGHT asks who the patient is (a character, follower, NPC or monster the Lightbearer's
 * player has targeted, else the people picker over the party, the Lightbearer too, and the party's
 * followers), then the picks: each marked debility
 * and each open problematic wound is its own box, so "which one?" is never a second question, and the
 * Reduced box opens as the card has it. The HP, the debilities and the wounds go on the patient's sheet
 * in one write (StonetopCharacter#receiveHealing: the computed max HP, and the HP hooks that Death's Door
 * and Unstoppable ride); a minor condition and a dire affliction are the table's, and are said on the
 * card. Another player's character is written by the GM's client (BATH_QUERY), which checks the asker
 * plays the Lightbearer who posted the card and reads Empowered off the card, not off the ask.
 *
 * ANYONE BUT A PLAYER CHARACTER (a follower's NPC, any other NPC, a monster) has HP and nothing else the
 * Invocation can reach: no debilities, no wound list. So only the HP choices act on the sheet, the
 * debility and wound rows are drawn greyed and cannot be ticked, and the minor condition and the dire
 * affliction stay pickable, since for a player character they are lines on the card too. The HP goes on
 * the actor's own `system.attributes.hp`, capped at its `max` (restoreActorHp): the fields the damage
 * card's Apply takes it from and the token bar and the Fight tab read, and for a follower the ones its
 * card keeps the maximum of (follower-actors.js#syncFollowerActors). A follower is found through the
 * links on their character's cards (follower-masters.js#followerMasterIndex).
 *
 * A GROUP IS HEALED ONE MEMBER AT A TIME: "your patient" is one person. A group follower (the crew, a
 * custom group) keeps its members on its character's roster, each with their own HP, and a lone blow
 * lands on one of them there (fight/group-hits.js#applyRosterHit). So when the patient is a group
 * follower's token, targeted or picked from the list (which offers group followers beside the rest),
 * "Which member?" is asked (chooseBathMember), the fallen among them too, and the HP goes on that
 * member's roster row (restoreRosterMemberHp), never on the token's pooled HP. A monster fought as a
 * group has no roster: its hurt member is the harm a lone blow keeps on the token (GROUP_WOUND_FLAG),
 * and that is what the HP heals (restoreGroupWound); with nobody hurt, the card says so. A group
 * follower's token whose roster cannot be found (its card gone, a stale link) is healed the same way,
 * known for a group by its own data (rosterlessGroupInfo): no group's pool is ever raised.
 *
 * A FOLLOWER'S CARD HEALS TOO (user's ruling). A follower keeps an HP box on their character's
 * Followers tab. While they have an NPC its HP is theirs and the box mirrors it (wave 3 audit FOL-1,
 * fight/roster-fate.js#onUpdateActorFollowerHp), so healing that NPC as the patient heals the card, and
 * nothing is written to the box beside it. A follower patient who is not that NPC (the NPC they were
 * recruited from, once their card has an actor of its own) also heals their card by the same amount,
 * never lowering it (restoreFollowerCardHp, through follower-hp.js#setFollowerHp): the box to the max
 * the tab draws (StonetopCharacterSheet#followerCardHp), and raising a fallen custom follower above 0
 * clears their "Dead" mark as the HP box does (follower-fate.js#followerReviveUpdate).
 * When this client cannot write the character whose card (or roster) it is, the whole heal goes to the
 * GM's client (healPatient), which checks the member named against the roster itself.
 *
 * GO BACK TO THE SHADOW rolls at the targeted spirits, one roll each, through the damage window
 * (combat/attack-flow.js#rollInvocationDamage), where Hungry Flames' "+1d6" is a ticked line
 * (fight/hero-moves.js#holyLightOffers). The GM's Apply takes it from there. The empowered text is the
 * GM's to narrate, and stays prose on the card.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { INVOKE_THE_SUN_GOD } from "./holy-light.js";
import { CARD_EMPOWERED_FLAG, TEN_PLUS_FLAG, cardInvocations, invokeActionRow, invokeCardReduced } from "./invoke-consequences.js";
import { holyLightOffers } from "../../fight/hero-moves.js";
import { rollInvocationDamage } from "../../combat/attack-flow.js";
import { GROUP_WOUND_FLAG, groupTokenInfo, groupWound, rosterGroupFor, rosterHpUpdate, rosterMemberHp } from "../../fight/group-hits.js";
import { groupFollowerStanding } from "../../utils/crew.js";
import { healTo } from "../../camp/camp-rules.js";
import { each } from "../../fight/fight-state.js";
import { pickPersonOnMap } from "../../dialogs/RelationshipLinkDialog.js";
import { contentElement } from "../../dialogs/content-picker.js";
import { askWithButtons } from "../../utils/ask-with-buttons.js";
import { canRewriteCard, moveChatCard } from "../../utils/chat.js";
import { belongsToMessage } from "../../utils/picked-option-button.js";
import { withCardLatch } from "../../utils/card-latch.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { partyCharacters } from "../../utils/playbook-actors.js";
import { followerCardFor, followerMasterIndex } from "./follower-masters.js";
import { followerFateHpPath, linkedFollowerNpc } from "./follower-fate.js";
import { setFollowerHp } from "./follower-hp.js";
import { followerActorFromLink } from "./follower-actors.js";
import { readableFlags } from "./StonetopFlags.js";
import { isUnliving } from "./deaths-door-actor.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

const KEY = "stonetop.invocations";

export const BATH_OF_HEALING_LIGHT = "bath-of-healing-light";
export const GO_BACK_TO_THE_SHADOW = "go-back-to-the-shadow";
export const BATH_NAME = "Bath of Healing Light";
export const SHADOW_NAME = "Go Back to the Shadow";

/** Message flag: the card's Bath of Healing Light was used (true while it is being chosen, then the patient's name). */
export const BATH_FLAG = "bathHealed";
/** Message flag: the card's Go Back to the Shadow damage was rolled at its spirits. */
export const SHADOW_FLAG = "shadowRolled";
/** The User query a Lightbearer's player sends to heal a character they do not own. */
export const BATH_QUERY = "stonetop.bathOfHealingLight";

export const BATH_PICK = Object.freeze({
	HP5: "hp5", DEBILITY: "debility", STABILIZE: "stabilize", MINOR: "minor",
	HP10: "hp10", RECOVER: "recover", AFFLICTION: "affliction",
});

// The printed choices, in the printed order. `max` is "can pick this twice"; `ref` is a choice that
// names WHICH (a debility, a wound); `empowered` is one the empowered effect adds.
const BATH_OPTIONS = Object.freeze([
	{ key: BATH_PICK.HP5,        max: 2, hp: 5 },
	{ key: BATH_PICK.DEBILITY,   max: 2, ref: true },
	{ key: BATH_PICK.STABILIZE,  max: 1, ref: true },
	{ key: BATH_PICK.MINOR,      max: 1 },
	{ key: BATH_PICK.HP10,       max: 2, hp: 10, empowered: true },
	{ key: BATH_PICK.RECOVER,    max: 1, ref: true, empowered: true },
	{ key: BATH_PICK.AFFLICTION, max: 1, empowered: true },
]);

/** The actor types a Bath can heal: a player character, and anyone else with HP (an NPC, a follower's, a monster). */
const PATIENT_TYPES = new Set(["character", "npc", "monster"]);

/** Whether `actor` can be the patient. */
export function isBathPatient(actor) {
	return PATIENT_TYPES.has(actor?.type);
}

/** Whether only the HP choices reach this patient: anyone who is not a player character. */
export function bathHpOnly(patient) {
	return patient?.type !== "character";
}

/** The choices a patient can be given: the four, and with an empowered Invocation the three it adds. */
export function bathOfHealingChoices({ empowered = false } = {}) {
	return BATH_OPTIONS.filter(opt => empowered || !opt.empowered).map(opt => ({ ...opt }));
}

/** "Pick 2", or "Reduced: pick only 1 (instead of 2)". */
export function bathPickCount({ reduced = false } = {}) {
	return reduced ? 1 : 2;
}

/**
 * Whether a set of picks is one the Invocation allows: at least one and no more than its count, each
 * a choice it offers, none past its own "twice", and no one debility or wound named twice (clearing
 * Weakened twice clears nothing more). Picks are `{key, ref?}`. `hpOnly` (a patient who is not a player
 * character, bathHpOnly) refuses the debility and wound choices, which have nothing there to act on.
 *
 * @returns {{ok: boolean, count: number}}
 */
export function validateBathPicks(picks, { reduced = false, empowered = false, hpOnly = false } = {}) {
	const list = Array.isArray(picks) ? picks : [];
	const choices = new Map(bathOfHealingChoices({ empowered }).map(opt => [opt.key, opt]));
	const per = new Map();
	const refs = new Set();
	for (const pick of list) {
		const opt = choices.get(pick?.key);
		if (!opt) return { ok: false, count: list.length };
		per.set(opt.key, (per.get(opt.key) ?? 0) + 1);
		if (per.get(opt.key) > opt.max) return { ok: false, count: list.length };
		if (opt.ref) {
			if (hpOnly || !pick.ref) return { ok: false, count: list.length };
			const named = `${opt.key}:${pick.ref}`;
			if (refs.has(named)) return { ok: false, count: list.length };
			refs.add(named);
		}
	}
	return { ok: list.length > 0 && list.length <= bathPickCount({ reduced }), count: list.length };
}

/** What a valid set of picks does, as the one write and the lines that are the table's. */
export function bathHealing(picks) {
	const list = Array.isArray(picks) ? picks : [];
	const of = key => list.filter(pick => pick?.key === key);
	return {
		hp: of(BATH_PICK.HP5).length * 5 + of(BATH_PICK.HP10).length * 10,
		clearDebilities: of(BATH_PICK.DEBILITY).map(pick => pick.ref),
		stabilizeWound: of(BATH_PICK.STABILIZE)[0]?.ref ?? null,
		healWound: of(BATH_PICK.RECOVER)[0]?.ref ?? null,
		minor: of(BATH_PICK.MINOR).length > 0,
		affliction: of(BATH_PICK.AFFLICTION).length > 0,
	};
}

/** Go Back to the Shadow's number: 2d8, or "only 1d8" reduced. */
export function shadowDamageFormula({ reduced = false } = {}) {
	return reduced ? "1d8" : "2d8";
}

/** A card title with the Invocation's reduced / empowered state on it. */
function effectTitle(name, { reduced = false, empowered = false } = {}) {
	let title = name;
	if (empowered) title = format(`${KEY}.empoweredTitle`, { name: title });
	if (reduced) title = format(`${KEY}.reducedTitle`, { name: title });
	return title;
}

// -- Which buttons a card grows ---------------------------------------------------------------------

/**
 * The Invocation buttons an Invoke card carries: one per Invocation it names that has one, on a 7+ or
 * the Wielder's "as a 10+" card. `missed` is the caller's reading of the (shifted) roll.
 *
 * @returns {Array<{slug: string, flag: string}>}
 */
export function invocationEffectsFor(message, { missed = false } = {}) {
	if (message?.getFlag?.(SYSTEM_ID, "move") !== INVOKE_THE_SUN_GOD) return [];
	if (missed && !message.getFlag(SYSTEM_ID, TEN_PLUS_FLAG)) return [];
	const flags = { [BATH_OF_HEALING_LIGHT]: BATH_FLAG, [GO_BACK_TO_THE_SHADOW]: SHADOW_FLAG };
	return cardInvocations(message).filter(slug => flags[slug]).map(slug => ({ slug, flag: flags[slug] }));
}

// -- Bath of Healing Light ----------------------------------------------------------------------------

const PICK_FIELD = "stonetop-bath-pick";
const REDUCED_FIELD = "stonetop-bath-reduced";

/** A wound's words as this reader may see them: a GM-only wound stays the GM's. */
function woundText(wound, { isGM = !!globalThis.game?.user?.isGM } = {}) {
	return wound?.gmOnly && !isGM ? localize(`${KEY}.bathHiddenWound`) : String(wound?.text ?? "");
}

/**
 * The patient's marked debilities and their problematic wounds, as the picks window names them.
 * `hpOnly` for anyone but a player character: none of either, whatever their data carries.
 */
export function bathPatientView(patient) {
	const hpOnly = bathHpOnly(patient);
	const debilities = hpOnly ? [] : (patient?.typedActor?.debilityChoices ?? []).filter(d => d?.marked);
	const wounds = hpOnly ? [] : (Array.isArray(patient?.system?.attributes?.wounds) ? patient.system.attributes.wounds : [])
		.filter(w => w?.id && !w.healed && (w.status === "problematic" || w.status === "stabilized"));
	return {
		name: patient?.name ?? "",
		hpOnly,
		debilities: debilities.map(d => ({ key: d.key, name: d.name ?? d.key })),
		// "Has one of their problematic wounds stabilized": one not stabilized already.
		open: wounds.filter(w => w.status === "problematic").map(w => ({ id: w.id, text: woundText(w) })),
		// "Fully recovers from a problematic wound": stabilized or not, but not a permanent injury.
		wounds: wounds.map(w => ({ id: w.id, text: woundText(w) })),
	};
}

function pickBox(key, { ref = "", max = 1, label, none = false }) {
	const value = ref ? `${key}:${ref}` : key;
	return `<input type="checkbox" class="stonetop-check" name="${PICK_FIELD}" value="${escHtml(value)}"`
		+ ` data-group="${escHtml(key)}" data-max="${max}"${none ? ` data-none="1" disabled` : ""} aria-label="${escHtml(label)}">`;
}

function pickRow(opt, rows) {
	const twice = opt.max > 1 ? ` <em>${escHtml(localize(`${KEY}.bathTwice`))}</em>` : "";
	return rows.map(row => {
		const boxes = Array.from({ length: row.boxes ?? 1 }, () => pickBox(opt.key, { ...row, max: opt.max })).join(" ");
		// The words in ONE span: a flex label makes each loose piece of text an item of its own.
		return `<li class="stonetop-bath-option${row.none ? " is-none" : ""}"><label>${boxes}<span>${escHtml(row.label)}${row.boxes > 1 ? twice : ""}</span></label></li>`;
	}).join("");
}

// The choices only a player character's sheet can take, and what their greyed row says for anyone else.
const PC_ONLY_ROWS = Object.freeze({
	[BATH_PICK.DEBILITY]: "bathDebilityPcOnly",
	[BATH_PICK.STABILIZE]: "bathStabilizePcOnly",
	[BATH_PICK.RECOVER]: "bathRecoverPcOnly",
});

/**
 * One option's rows: a box per debility or wound it could name, or one row saying there is none. For a
 * patient who is not a player character, the debility and wound choices are one greyed row each.
 */
function optionRows(opt, view) {
	if (view.hpOnly && PC_ONLY_ROWS[opt.key]) return [{ none: true, label: localize(`${KEY}.${PC_ONLY_ROWS[opt.key]}`) }];
	const ofKey = {
		[BATH_PICK.HP5]:  () => [{ label: localize(`${KEY}.bathHp5`), boxes: 2 }],
		[BATH_PICK.HP10]: () => [{ label: localize(`${KEY}.bathHp10`), boxes: 2 }],
		[BATH_PICK.DEBILITY]: () => view.debilities.length
			? view.debilities.map(d => ({ ref: d.key, label: format(`${KEY}.bathDebility`, { debility: d.name }) }))
			: [{ none: true, label: localize(`${KEY}.bathDebilityNone`) }],
		[BATH_PICK.STABILIZE]: () => view.open.length
			? view.open.map(w => ({ ref: w.id, label: format(`${KEY}.bathStabilize`, { wound: w.text }) }))
			: [{ none: true, label: localize(`${KEY}.bathStabilizeNone`) }],
		[BATH_PICK.RECOVER]: () => view.wounds.length
			? view.wounds.map(w => ({ ref: w.id, label: format(`${KEY}.bathRecover`, { wound: w.text }) }))
			: [{ none: true, label: localize(`${KEY}.bathRecoverNone`) }],
		[BATH_PICK.MINOR]: () => [{ label: localize(`${KEY}.bathMinor`) }],
		[BATH_PICK.AFFLICTION]: () => [{ label: localize(`${KEY}.bathAffliction`) }],
	};
	return ofKey[opt.key]?.() ?? [];
}

/** The picks window's markup, for `view` (bathPatientView). */
export function bathWindowContent(view, { reduced = false, empowered = false } = {}) {
	const choices = bathOfHealingChoices({ empowered });
	const list = items => `<ul class="stonetop-bath-options">${items.map(opt => pickRow(opt, optionRows(opt, view))).join("")}</ul>`;
	const plain = choices.filter(opt => !opt.empowered);
	const extra = choices.filter(opt => opt.empowered);
	return `<div class="stonetop-bath">`
		+ `<p class="stonetop-bath-lead">${escHtml(localize(`${KEY}.bathLead`))} `
		+ `<span class="stonetop-bath-count">${escHtml(format(`${KEY}.bathCount`, { max: bathPickCount({ reduced }), count: 0 }))}</span></p>`
		+ list(plain)
		+ (extra.length ? `<p class="stonetop-bath-empowered"><strong>${escHtml(localize(`${KEY}.bathEmpowered`))}</strong></p>${list(extra)}` : "")
		+ `<label class="stonetop-bath-reduced"><input type="checkbox" class="stonetop-check" name="${REDUCED_FIELD}"${reduced ? " checked" : ""}>`
		+ `<span>${escHtml(localize(`${KEY}.bathReduced`))}</span></label>`
		+ `</div>`;
}

/** The window's answer off its form: `{reduced, picks}`. */
export function readBathForm(form) {
	const picks = [...(form?.querySelectorAll?.(`input[name="${PICK_FIELD}"]`) ?? [])]
		.filter(box => box.checked && !box.disabled)
		.map(box => {
			const value = String(box.value ?? "");
			const at = value.indexOf(":");
			return at < 0 ? { key: value } : { key: value.slice(0, at), ref: value.slice(at + 1) };
		});
	return { reduced: !!form?.querySelector?.(`input[name="${REDUCED_FIELD}"]`)?.checked, picks };
}

/**
 * The live caps: no more boxes than the count (which the Reduced box moves), no choice past its own
 * "twice", the count said as it stands, and the heal button only for a set the Invocation allows.
 */
export function squareBathForm(root) {
	const form = root?.querySelector?.("form") ?? root;
	const boxes = [...(form?.querySelectorAll?.(`input[name="${PICK_FIELD}"]`) ?? [])];
	const max = bathPickCount({ reduced: !!form?.querySelector?.(`input[name="${REDUCED_FIELD}"]`)?.checked });
	const ticked = boxes.filter(box => box.checked);
	const per = {};
	for (const box of ticked) per[box.dataset.group] = (per[box.dataset.group] ?? 0) + 1;
	for (const box of boxes) {
		if (box.checked || box.dataset.none) continue;
		box.disabled = ticked.length >= max || (per[box.dataset.group] ?? 0) >= Number(box.dataset.max || 1);
	}
	const count = form?.querySelector?.(".stonetop-bath-count");
	if (count) count.textContent = format(`${KEY}.bathCount`, { max, count: ticked.length });
	const heal = root?.querySelector?.('button[data-action="heal"]');
	if (heal) heal.disabled = ticked.length === 0 || ticked.length > max;
}

/**
 * Ask the picks for `patient`. Resolves `{reduced, picks}`, or null when the window was closed.
 * `name` is who the window names, for a group's member ("Bryn of the crew", chooseBathMember).
 */
export async function askBathPicks(patient, { reduced = false, empowered = false, name = "" } = {}) {
	const view = { ...bathPatientView(patient), ...(name ? { name } : {}) };
	return askWithButtons({
		title: format(`${KEY}.bathTitle`, { name: view.name }),
		content: contentElement(bathWindowContent(view, { reduced, empowered }), globalThis.document),
		buttons: [
			{ key: "heal", label: format(`${KEY}.bathHeal`, { name: view.name }), icon: "fa-hand-holding-heart", value: readBathForm },
			{ key: "cancel", label: localize(`${KEY}.bathNotNow`), value: null },
		],
		render: root => {
			squareBathForm(root);
			root?.addEventListener?.("change", () => squareBathForm(root));
		},
	});
}

/** A group follower (the crew, a custom group): several people on a roster, not one patient. */
function isGroupFollower(card) {
	if (card?.ftype === "crew") return true;
	return card?.ftype === "custom" && !!readableFlags(card.character)?.customFollowers?.[card.slug]?.isGroup;
}

/**
 * The followers of `characters` who can be a patient: the NPC actors their cards link to
 * (followerMasterIndex, which leaves out a dormant initiate), each with whose follower they are. A
 * group follower is among them: picking one asks which member (chooseBathMember). In the order the
 * actors come.
 *
 * @returns {Array<{actor: Actor, master: Actor}>}
 */
export function partyFollowers(characters, { actors = globalThis.game?.actors ?? [] } = {}) {
	const all = each(actors);
	const masters = followerMasterIndex({ characters, actors: all });
	return all
		.filter(actor => masters.has(actor.id))
		.map(actor => ({ actor, master: masters.get(actor.id) }));
}

/**
 * Who the patient is: the one character, follower, NPC or monster this player has targeted, else a
 * pick from those they have targeted, else from the party (the Lightbearer too: the light can heal
 * its bearer) and the party's followers.
 *
 * Targets are told apart by uuid, not id: two tokens of one unlinked monster share the id of the
 * Actor they were made from, and are two patients.
 */
export async function chooseBathPatient(lightbearer, {
	targets = globalThis.game?.user?.targets ?? [], party = () => partyCharacters(), followers = partyFollowers, pick = pickPersonOnMap,
} = {}) {
	const seen = new Set();
	const key = actor => actor.uuid ?? actor.id;
	const targeted = [...targets].map(t => t?.actor).filter(a => isBathPatient(a) && !seen.has(key(a)) && seen.add(key(a)));
	if (targeted.length === 1) return targeted[0];
	let pool = targeted.map(actor => ({ actor }));
	if (!pool.length) {
		let characters = party();
		if (lightbearer && !characters.some(a => a.id === lightbearer.id)) characters = [lightbearer, ...characters];
		pool = [
			...characters.map(actor => ({ actor })),
			...followers(characters).map(({ actor, master }) => ({ actor, hint: format(`${KEY}.bathPatientFollowerOf`, { name: master?.name ?? "" }) })),
		];
	}
	if (!pool.length) {
		globalThis.ui?.notifications?.info?.(localize(`${KEY}.bathNobody`));
		return null;
	}
	const id = await pick({
		options: pool.map(({ actor, hint }) => ({ id: key(actor), name: actor.name, actor, ...(hint ? { hint } : {}) })),
		title: localize(`${KEY}.bathPatientTitle`),
		hint: localize(`${KEY}.bathPatientHint`),
		icon: "fa-hand-holding-heart",
		buttonLabel: localize(`${KEY}.bathPatientChoose`),
		formatLabel: name => format(`${KEY}.bathPatientNamed`, { name }),
	});
	if (id == null) return null;
	return pool.find(({ actor }) => key(actor) === id)?.actor ?? null;
}

/**
 * Give a patient who is not a player character back `amount` HP, never past their maximum and never
 * lowering it: the mirror of utils/damage.js#applyDamageToActor, on the same stored fields (the token
 * bar's, the Fight tab's). Answers `{gain, from, to}` as receiveHealing does, or null with no HP at all.
 */
export async function restoreActorHp(actor, amount, { moveName = BATH_NAME } = {}) {
	const hp = actor?.system?.attributes?.hp;
	if (!hp) return null;
	const gain = Math.max(0, Math.round(Number(amount) || 0));
	const max = Math.max(0, Math.trunc(Number(hp.max) || 0));
	const from = Math.max(0, Math.trunc(Number(hp.value) || 0));
	const to = healTo(from, gain, max);
	if (to !== from) await actor.update({ "system.attributes.hp.value": to }, { stonetopMove: moveName });
	return { gain, from, to };
}

// The follower kinds whose card keeps ONE HP box, the one the tab's HP input writes
// (follower-fate.js#followerFateHpPath). The crew's card holds a roster and a pool instead, and so
// does a custom group (isGroupFollower); a crew member has no NPC of their own to be the patient.
const CARD_HP_TYPES = new Set(["animal-companion", "initiate", "beast", "custom"]);

/** The card a follower patient's HP box sits on (follower-masters.js#followerCardFor), or null. */
function healableCard(patient, cardFor = followerCardFor) {
	if (!bathHpOnly(patient)) return null;
	const card = cardFor(patient);
	return card?.character && CARD_HP_TYPES.has(card.ftype) && !isGroupFollower(card) ? card : null;
}

/** A card's HP box as the Followers tab draws it (StonetopCharacterSheet#followerCardHp). */
async function sheetCardHp(character, ftype, slug) {
	return (await character?.sheet?.followerCardHp?.(ftype, slug)) ?? null;
}

/** The NPC whose HP is the card's (follower-fate.js#linkedFollowerNpc), or null. */
function cardNpc(card, link = followerActorFromLink) {
	return linkedFollowerNpc(readableFlags(card?.character), card?.ftype, card?.slug ?? "", link);
}

/** Whether `patient` is the card's NPC, or an unlinked token of it: healing it heals the card. */
function patientIsCardNpc(patient, card) {
	const uuid = cardNpc(card)?.uuid;
	return !!uuid && (patient?.uuid === uuid || patient?.token?.baseActor?.uuid === uuid);
}

/**
 * Give a follower's CARD back `amount` HP, never past its max and never lowering it, through the one HP
 * writer (follower-hp.js#setFollowerHp). `card` is followerCardFor's `{character, ftype, slug}`.
 *
 * While the follower has an NPC, ITS HP is theirs: the NPC is raised, to its own max, and the box
 * follows it (fight/roster-fate.js#onUpdateActorFollowerHp). Otherwise the box on their character's
 * Followers tab is, to the card's own max, in one update with the revive the HP input's handler makes: a
 * fallen custom follower raised above 0 is no longer marked Dead (followerReviveUpdate). A heal only
 * raises, so the 0-HP fate dialog has nothing to do here. Answers `{gain, from, to}`, or null for a card
 * with no single HP box, or an NPC nobody here could write.
 */
export async function restoreFollowerCardHp(card, amount, { moveName = BATH_NAME, cardHp = sheetCardHp, link = followerActorFromLink } = {}) {
	const { character, ftype, slug = "" } = card ?? {};
	if (!character || !CARD_HP_TYPES.has(ftype) || isGroupFollower(card)) return null;
	const npc = cardNpc(card, link);
	const hp = npc ? npc.system?.attributes?.hp : null;
	const box = npc ? (hp ? { max: hp.max, current: hp.value } : null)
		: followerFateHpPath(ftype, slug) ? await cardHp(character, ftype, slug) : null;
	if (!box) return null;
	const gain = Math.max(0, Math.round(Number(amount) || 0));
	const max = Math.max(0, Math.trunc(Number(box.max) || 0));
	const from = Math.max(0, Math.trunc(Number(box.current) || 0));
	const to = healTo(from, gain, max);
	if (to !== from && !(await setFollowerHp(character, { follower: ftype, slug }, to, { moveName, raiseOnly: true, link: () => npc }))) return null;
	return { gain, from, to };
}

// -- A group's member ---------------------------------------------------------------------------------

/**
 * Whether the patient is a group token, and which kind (see the note at the top), or null for one
 * person:
 *  - `roster`: a group follower with its roster found on its character (group-hits.js#rosterGroupFor,
 *    the fallen listed too), each member with their HP as the roster reads it (rosterMemberHp);
 *  - `wound`: a monster fought as a group, several standing (group-hits.js#groupTokenInfo), or a group
 *    follower's token with no roster to read (rosterlessGroupInfo): healed off the harm kept on the
 *    token, never its pool.
 * `group` is the token's name, as the windows and the card say it.
 *
 * @returns {null|{kind: "roster", group: string, roster: object, members: Array<{key: string, name: string, hp: number, hpMax: number}>}
 *   |{kind: "wound", group: string, info: object}}
 */
export function bathGroupFor(patient, { resolve } = {}) {
	if (!isBathPatient(patient) || !bathHpOnly(patient)) return null;
	const roster = rosterGroupFor(patient, { resolve, down: true });
	if (roster) {
		const flags = readableFlags(roster.character);
		const card = { ftype: roster.ftype, slug: roster.slug };
		const members = roster.members.map(m => ({ ...m, hp: rosterMemberHp(flags, card, m.key, roster.hpMax), hpMax: roster.hpMax }));
		return { kind: "roster", group: patient.name ?? "", roster, members };
	}
	const info = groupTokenInfo(patient) ?? rosterlessGroupInfo(patient, { resolve });
	return info ? { kind: "wound", group: patient.name ?? "", info } : null;
}

/**
 * A group follower's token with no roster to heal on (rosterGroupFor found none), as a monster group's
 * numbers (groupTokenInfo's `hpMax` and `wound`), or null for anyone else. Whether it is a group is
 * read off the token itself when its card's record cannot be found (a stale link to a card since
 * removed, a character since deleted): made from the crew's card, or from a custom card with an
 * unlinked token, which is what a group's token is made as (follower-actor.js#followerNpcActorData). A
 * record that is found answers for itself: a group with no roster read (no HP to read it against) is
 * still a group; a crew of one, or a custom follower who is not a group, is a single follower. Its hurt member is the harm kept on the token, as for a monster group, so the pool
 * is never raised: that would stand up someone the light never touched.
 */
function rosterlessGroupInfo(patient, { resolve } = {}) {
	if (patient?.type !== "npc") return null;
	const card = followerCardFor(patient, resolve ? { resolve } : {});
	const flags = card ? readableFlags(card.character) : null;
	// The card's own record, if it is still there: a link can name a custom card since removed.
	const record = card?.ftype === "crew" ? flags?.crew : card?.ftype === "custom" ? flags?.customFollowers?.[card.slug] : null;
	let grouped;
	if (record) {
		grouped = card.ftype === "custom" ? !!record.isGroup : (groupFollowerStanding(flags, card)?.size ?? 0) > 1;
	} else {
		const origin = patient.flags?.[SYSTEM_ID]?.followerOrigin;
		const unlinked = (patient.token?.actorLink ?? patient.prototypeToken?.actorLink) === false;
		grouped = origin?.ftype === "crew" || (origin?.ftype === "custom" && unlinked);
	}
	if (!grouped) return null;
	const hpMax = Math.max(0, Math.trunc(Number(patient.system?.attributes?.hp?.max) || 0));
	return { hpMax, wound: Math.min(hpMax, groupWound(patient)) };
}

/** "Bryn of the crew": a roster member, as the windows and the card name them. */
export function bathMemberName(member, group) {
	return format(`${KEY}.bathMemberOf`, { member, group });
}

/** The members as "Which member?" lists them: the hurt (the fallen among them) first, then the unhurt, each in roster order. PURE. */
export function bathMemberOrder(members) {
	const list = Array.isArray(members) ? members : [];
	const hurt = m => m.hp < m.hpMax;
	return [...list.filter(hurt), ...list.filter(m => !hurt(m))];
}

const MEMBER_FIELD = "stonetop-bath-member";

/** Where a member stands, on their row: their HP, and down or unhurt when they are. */
function memberHpLine(member) {
	const key = member.hp <= 0 ? "bathMemberHpDown" : member.hp < member.hpMax ? "bathMemberHp" : "bathMemberHpUnhurt";
	return format(`${KEY}.${key}`, { hp: member.hp, max: member.hpMax });
}

/**
 * "Which member?" as a list, `members` in the order bathMemberOrder gives: a radio row each, the name
 * and where they stand, `chosen` (a key) ticked. A member marked fallen (utils/crew.js
 * #customMemberFallen) is on the list, greyed with the Fallen badge, and cannot be ticked: the dead are
 * past the light's reach. In a box that scrolls, so a crew of twelve does not make a window taller
 * than the screen.
 */
export function bathMemberListContent(group, members, chosen = null) {
	const rows = (Array.isArray(members) ? members : []).map(m => {
		const state = m.dead
			? `<span class="stonetop-follower-dead-badge"><i class="fas fa-skull-crossbones" aria-hidden="true"></i> <span class="stonetop-chip-text">${escHtml(localize(`${KEY}.bathMemberFallen`))}</span></span>`
			: `<span class="stonetop-bath-member-hp">${escHtml(memberHpLine(m))}</span>`;
		return `<li><label class="stonetop-bath-member${m.dead ? " is-dead" : ""}">`
			+ `<input type="radio" name="${MEMBER_FIELD}" value="${escHtml(m.key)}" data-name="${escHtml(m.name)}"`
			+ `${m.key === chosen && !m.dead ? " checked" : ""}${m.dead ? " disabled" : ""}>`
			+ `<span class="stonetop-bath-member-name">${escHtml(m.name)}</span>${state}</label></li>`;
	}).join("");
	return `<p>${escHtml(format(`${KEY}.bathMemberQuestion`, { group }))}</p>`
		+ `<ul class="stonetop-bath-members">${rows}</ul>`;
}

/** The radio ticked in the "Which member?" window: read off each row's `checked`, which is what a tick changes. */
function tickedMember(root) {
	return [...(root?.querySelectorAll?.(`input[name="${MEMBER_FIELD}"]`) ?? [])].find(box => box.checked) ?? null;
}

/** The member ticked in the "Which member?" window, by key, or null. */
export function readBathMember(form) {
	const box = tickedMember(form);
	return box && !box.disabled ? String(box.value ?? "") || null : null;
}

/** The heal button names the member ticked, as the ticking changes. */
function nameHealButton(root) {
	const box = tickedMember(root);
	const label = root?.querySelector?.('button[data-action="heal"] span');
	if (box && label) label.textContent = format(`${KEY}.bathHeal`, { name: box.dataset?.name ?? "" });
}

/**
 * Which member of a group follower is the patient: a radio row each, the hurt first (bathMemberOrder),
 * the first who can be healed ticked, and ONE heal button naming them (renamed as the tick moves), and
 * Not now. Resolves `{key, name}` (`name` as bathMemberName says it), null when the window was closed or
 * every member is fallen (said, and nothing asked), and undefined, with nothing asked, for a patient who
 * is not a group with a roster.
 */
export async function chooseBathMember(patient, { group = bathGroupFor(patient), ask = askWithButtons } = {}) {
	if (group?.kind !== "roster") return undefined;
	const members = bathMemberOrder(group.members);
	const first = members.find(m => !m.dead);
	if (!first) {
		globalThis.ui?.notifications?.info?.(format(`${KEY}.bathMemberAllFallen`, { group: group.group }));
		return null;
	}
	const key = await ask({
		title: format(`${KEY}.bathMemberTitle`, { group: group.group }),
		content: contentElement(bathMemberListContent(group.group, members, first.key), globalThis.document),
		buttons: [
			{ key: "heal", label: format(`${KEY}.bathHeal`, { name: first.name }), icon: "fa-hand-holding-heart", value: readBathMember },
			{ key: "cancel", label: localize(`${KEY}.bathNotNow`), value: null },
		],
		render: root => {
			nameHealButton(root);
			root?.addEventListener?.("change", () => nameHealButton(root));
		},
	});
	const member = members.find(m => m.key === key && !m.dead);
	return member ? { key: member.key, name: bathMemberName(member.name, group.group) } : null;
}

/**
 * Give one roster member back `amount` HP, never past one member's maximum and never lowering it,
 * written where the sheet's roster HP boxes and a lone blow write it (group-hits.js#rosterHpUpdate, the
 * store applyRosterHit writes). A member raised above 0 is standing again, as one raised by the HP box
 * is, and the fight counts the group's bodies off the roster (fight-sides.js#bodiesFor). The dead are
 * not: the fate dialog's "Dead" strikes them off the roster, or at a custom group's two-member floor
 * marks them fallen (`dead`), and a fallen member is refused. The token is not written, as
 * applyRosterHit writes none of it: its HP is the pool, for group exchanges.
 * Answers `{gain, from, to}`, or null for a key that is not on the roster or is a fallen member's.
 */
export async function restoreRosterMemberHp(group, memberKey, amount, { moveName = BATH_NAME } = {}) {
	const member = group?.kind === "roster" ? group.members.find(m => m.key === memberKey) : null;
	if (!member || member.dead) return null;
	const gain = Math.max(0, Math.round(Number(amount) || 0));
	const from = Math.max(0, Math.trunc(Number(member.hp) || 0));
	const to = healTo(from, gain, member.hpMax);
	if (to !== from) {
		const { character, ftype, slug } = group.roster;
		await character.update(rosterHpUpdate(readableFlags(character), { ftype, slug }, { [member.key]: to }), { stonetopMove: moveName });
	}
	return { gain, from, to };
}

/**
 * Give a monster group's hurt member back `amount` HP: the harm a lone blow keeps on the token
 * (GROUP_WOUND_FLAG, written as group-hits.js#applyMemberHit writes it) goes down by it, never below 0.
 * The pool, whose losses are casualties, is not raised: that would stand up someone the light never
 * touched. Answers `{gain, from, to}` as that member's HP.
 */
export async function restoreGroupWound(actor, info, amount, { moveName = BATH_NAME } = {}) {
	const gain = Math.max(0, Math.round(Number(amount) || 0));
	const wound = Math.max(0, Math.trunc(Number(info?.wound) || 0));
	const left = Math.max(0, wound - gain);
	if (left !== wound) await actor.update({ [`flags.${SYSTEM_ID}.${GROUP_WOUND_FLAG}`]: left }, { stonetopMove: moveName });
	return { gain, from: info.hpMax - wound, to: info.hpMax - left };
}

/**
 * applyBath for a group token: the member `memberKey` names on its roster (none named, nobody healed:
 * the patient is one person), or a monster group's hurt member, and `nobodyHurt` for the card when the
 * HP found no one to heal.
 */
async function applyBathToGroup(patient, group, plan, memberKey) {
	const table = { cleared: [], stabilized: null, healed: null, minor: plan.minor, affliction: plan.affliction };
	if (group.kind === "roster") {
		const member = group.members.find(m => m.key === memberKey);
		// A fallen member is past the light's reach, whatever the picks.
		if (!member || member.dead) return null;
		const hp = plan.hp ? await restoreRosterMemberHp(group, member.key, plan.hp) : null;
		return { patient: bathMemberName(member.name, group.group), hp, ...table, member: { key: member.key, name: member.name } };
	}
	if (!(group.info.wound > 0)) return { patient: group.group, hp: null, ...table, ...(plan.hp ? { nobodyHurt: true } : {}) };
	const hp = plan.hp ? await restoreGroupWound(patient, group.info, plan.hp) : null;
	return { patient: format(`${KEY}.bathGroupHurtMember`, { group: group.group }), hp, ...table };
}

/**
 * Heal `patient` with `picks`, on this client. Answers what happened, plain data (it crosses the GM
 * relay): `{patient, hp, cleared, stabilized, healed, minor, affliction}`. Anyone but a player
 * character takes the HP alone (restoreActorHp); the debility and wound picks are never theirs. A
 * follower's card takes the same HP (restoreFollowerCardHp), said as `card`, unless the patient is the
 * card's own NPC, whose HP the box mirrors; the card's one HP line is the NPC's, unless only the card's
 * box moved. A group token heals one member (applyBathToGroup), the
 * one `memberKey` names on a roster.
 */
export async function applyBath(patient, picks, { cardFor = followerCardFor, cardHp = sheetCardHp, memberKey = null, resolve } = {}) {
	const plan = bathHealing(picks);
	if (bathHpOnly(patient)) {
		if (!isBathPatient(patient)) return null;
		const group = bathGroupFor(patient, { resolve });
		if (group) return applyBathToGroup(patient, group, plan, memberKey);
		const npc = plan.hp ? await restoreActorHp(patient, plan.hp) : null;
		const followed = plan.hp ? healableCard(patient, cardFor) : null;
		// The patient is the card's NPC: that heal is the card's, and the box follows it.
		const box = followed && !patientIsCardNpc(patient, followed) ? await restoreFollowerCardHp(followed, plan.hp, { cardHp }) : null;
		if (plan.hp && !npc && !box) return null;
		const moved = hp => !!hp && hp.to > hp.from;
		const hp = !npc || (!moved(npc) && moved(box)) ? box : npc;
		return {
			patient: patient.name, hp, cleared: [], stabilized: null, healed: null, minor: plan.minor, affliction: plan.affliction,
			...(box ? { card: box } : {}),
		};
	}
	const model = patient?.typedActor;
	if (!model?.receiveHealing) return null;
	// A Ghost or a Revenant: "You gain no benefit from magical healing." The light touches them and
	// nothing changes, which the card says, rather than refusing a patient the Lightbearer can see.
	if (isUnliving(patient)) {
		return { patient: patient.name, hp: null, cleared: [], stabilized: null, healed: null, minor: false, affliction: false, unliving: true };
	}
	const out = await model.receiveHealing({
		hp: plan.hp, clearDebilities: plan.clearDebilities, stabilizeWound: plan.stabilizeWound, healWound: plan.healWound,
		moveName: BATH_NAME,
	});
	// The card is read by the whole table: a GM-only wound is named as a wound, and nothing more.
	const wound = w => (w ? { text: w.gmOnly ? "" : String(w.text ?? "") } : null);
	return {
		patient: patient.name,
		hp: out?.hp ?? null,
		cleared: (out?.cleared ?? []).map(d => d.name),
		stabilized: wound(out?.stabilized),
		healed: wound(out?.healed),
		minor: plan.minor,
		affliction: plan.affliction,
	};
}

/**
 * Heal the patient: here, for a patient this client owns (a player's own character, or their own
 * follower's NPC), and through the GM's client for one it does not (BATH_QUERY): another player's
 * character or follower, a monster, an NPC of the GM's. A follower's heal also writes their card on
 * their character, so it is here only when this client can write that character too; otherwise the
 * GM's client does the whole heal, both boxes. A group follower's member (`memberKey`) is written on
 * their character's roster and nowhere else, so it is here when this client can write that character.
 * Null when there is no GM to ask, or the GM's client refused.
 */
export async function healPatient(message, patient, picks, { reduced = false, memberKey = null } = {}, {
	gm = globalThis.game?.users?.activeGM ?? null, userId = globalThis.game?.user?.id ?? null, cardFor = followerCardFor,
	groupFor = bathGroupFor,
} = {}) {
	if (memberKey) {
		const group = groupFor(patient);
		if (group?.kind === "roster" && group.roster.character?.isOwner) return applyBath(patient, picks, { memberKey });
	} else {
		const card = patient?.isOwner && bathHealing(picks).hp ? healableCard(patient, cardFor) : null;
		if (patient?.isOwner && (!card || card.character.isOwner)) return applyBath(patient, picks, { cardFor: () => card });
	}
	const ask = { messageId: message?.id ?? null, patientUuid: patient?.uuid ?? null, picks, reduced, userId, ...(memberKey ? { memberKey } : {}) };
	const out = await askGMClient(gm, BATH_QUERY, ask, { what: "heal with Bath of Healing Light" });
	return out && typeof out === "object" ? out : null;
}

/**
 * The GM's side of BATH_QUERY. Only the primary GM answers, and only for the player who plays the
 * Lightbearer who posted the card (foundry-compat.js#queryAsker), on a card that names Bath of Healing
 * Light and has not been settled. Empowered is read off the card. The patient is anyone a Bath can
 * heal (isBathPatient); for one who is not a player character, only the HP choices and the table's
 * lines are accepted. For a follower, applyBath heals their card on their character as well, by the
 * same validated picks: the ask carries no amount and no card. For a group follower the ask names the
 * member by key, and that key must be one on the group's roster as this client reads it (bathGroupFor);
 * a key for anyone else, a fallen member's, or none for a group, is refused. Answers applyBath's record, or null.
 */
export async function handleBathQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, messages = globalThis.game?.messages, resolve = resolveSync, apply = applyBath, groupFor = bathGroupFor } = deps;
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return null;
	const user = queryAsker(data, context, users);
	const message = typeof data?.messageId === "string" ? messages?.get?.(data.messageId) : null;
	const lightbearer = message ? speakerActor(message) : null;
	if (!user || !lightbearer?.testUserPermission?.(user, "OWNER")) return null;
	if (!cardInvocations(message).includes(BATH_OF_HEALING_LIGHT)) return null;
	// Latched by the asking client before it asked, and not yet settled with a name.
	if (message.getFlag(SYSTEM_ID, BATH_FLAG) !== true) return null;
	const patient = typeof data?.patientUuid === "string" ? resolve(data.patientUuid) : null;
	if (!isBathPatient(patient)) return null;
	const picks = (Array.isArray(data?.picks) ? data.picks : [])
		.map(pick => ({ key: String(pick?.key ?? ""), ...(pick?.ref ? { ref: String(pick.ref) } : {}) }));
	const empowered = !!message.getFlag(SYSTEM_ID, CARD_EMPOWERED_FLAG);
	// Whether the debility and wound choices can reach the patient is read off the patient, not the ask.
	if (!validateBathPicks(picks, { reduced: !!data?.reduced, empowered, hpOnly: bathHpOnly(patient) }).ok) return null;
	// Which member of a group follower, checked against the roster itself, not taken off the ask; a
	// member marked fallen is on the roster but not the light's to raise.
	const memberKey = typeof data?.memberKey === "string" && data.memberKey ? data.memberKey : null;
	const group = groupFor(patient, { resolve });
	if (group?.kind === "roster" ? !group.members.some(m => m.key === memberKey && !m.dead) : memberKey) return null;
	return memberKey ? apply(patient, picks, { memberKey }) : apply(patient, picks);
}

/** The result card's body: what was put on the sheet, and what is the table's to play out. */
export function bathResultHtml(healer, result) {
	const name = result?.patient ?? "";
	const lines = [];
	const hp = result?.hp;
	if (hp) {
		lines.push(hp.to > hp.from
			? format(`${KEY}.bathCardHp`, { name, from: hp.from, to: hp.to })
			: format(`${KEY}.bathCardHpNone`, { name, hp: hp.to }));
	}
	if (hp?.halved) lines.push(format(`${KEY}.bathCardHalved`, { name }));
	if (result?.unliving) lines.push(format(`${KEY}.bathCardUnliving`, { name }));
	if (result?.nobodyHurt) lines.push(format(`${KEY}.bathCardNobodyHurt`, { name }));
	for (const debility of result?.cleared ?? []) lines.push(format(`${KEY}.bathCardDebility`, { name, debility }));
	if (result?.stabilized) {
		lines.push(result.stabilized.text
			? format(`${KEY}.bathCardStabilized`, { name, wound: result.stabilized.text })
			: format(`${KEY}.bathCardStabilizedHidden`, { name }));
	}
	if (result?.healed) {
		lines.push(result.healed.text
			? format(`${KEY}.bathCardHealed`, { name, wound: result.healed.text })
			: format(`${KEY}.bathCardHealedHidden`, { name }));
	}
	if (result?.minor) lines.push(format(`${KEY}.bathCardMinor`, { name }));
	if (result?.affliction) lines.push(format(`${KEY}.bathCardAffliction`, { name }));
	return `<p>${escHtml(format(`${KEY}.bathCardLead`, { healer: healer?.name ?? "", name }))}</p>`
		+ (lines.length ? `<ul>${lines.map(line => `<li>${escHtml(line)}</li>`).join("")}</ul>` : "");
}

/**
 * Use the card's Bath of Healing Light, once. Latched on the message FIRST, so a second click, a
 * re-render or another owner's client cannot heal twice; backing out of any window, a refused set
 * of picks or no GM to write another player's sheet gives the card back. A group follower's patient is
 * one member of it, asked between the patient and the picks (chooseBathMember).
 */
export async function settleBathOfHealingLight(message, lightbearer, {
	reduced = false, empowered = false, buttons = [],
	choosePatient = chooseBathPatient, chooseMember = chooseBathMember, askPicks = askBathPicks, heal = healPatient,
} = {}) {
	if (!lightbearer || message?.getFlag?.(SYSTEM_ID, BATH_FLAG)) return false;
	return withCardLatch(message, BATH_FLAG, true, buttons, async () => {
		const patient = await choosePatient(lightbearer);
		if (!patient) return false;
		// Undefined for anyone but a group with a roster, null for a closed window.
		const member = await chooseMember(patient);
		if (member === null) return false;
		const answer = await askPicks(patient, { reduced, empowered, ...(member ? { name: member.name } : {}) });
		if (!answer) return false;
		if (!validateBathPicks(answer.picks, { reduced: answer.reduced, empowered, hpOnly: bathHpOnly(patient) }).ok) {
			globalThis.ui?.notifications?.warn?.(localize(`${KEY}.bathInvalid`));
			return false;
		}
		const result = await heal(message, patient, answer.picks, { reduced: answer.reduced, ...(member ? { memberKey: member.key } : {}) });
		if (!result) {
			globalThis.ui?.notifications?.warn?.(format(`${KEY}.bathNoGm`, { name: patient.name }));
			return false;
		}
		await globalThis.ChatMessage?.create?.({
			content: moveChatCard(effectTitle(BATH_NAME, { reduced: answer.reduced, empowered }), bathResultHtml(lightbearer, result)),
			speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: lightbearer }),
		});
		await message.setFlag(SYSTEM_ID, BATH_FLAG, member?.name ?? patient.name);
		return true;
	});
}

// -- Go Back to the Shadow ----------------------------------------------------------------------------

/**
 * Roll the card's Go Back to the Shadow at the spirits, once: 2d8 (1d8 reduced), ignoring armor, one
 * roll per target, through the damage window with Hungry Flames' ticked line. Latched while it rolls;
 * a cancelled window gives the card back, and so does a roll at nobody (one plain card, one spirit's
 * worth), so the next spirit can be rolled for.
 */
export async function settleShadowDamage(message, actor, { reduced = false, shiftKey = false, buttons = [], roll = rollInvocationDamage } = {}) {
	if (!actor || message?.getFlag?.(SYSTEM_ID, SHADOW_FLAG)) return false;
	return withCardLatch(message, SHADOW_FLAG, true, buttons, async release => {
		const results = await roll(actor, {
			move: effectTitle(SHADOW_NAME, { reduced }), formula: shadowDamageFormula({ reduced }),
			offers: holyLightOffers(actor), shiftKey,
		});
		if (!results) return false;
		if (!results.some(r => r?.uuid)) await release();
		return true;
	});
}

// -- The card -----------------------------------------------------------------------------------------

function effectButton(doc, { icon, label, tooltip, className }) {
	const btn = doc.createElement("button");
	btn.type = "button";
	btn.className = `stonetop-invocation-effect ${className}`;
	btn.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i> ${escHtml(label)}`;
	if (tooltip) {
		btn.dataset.tooltip = tooltip;
		btn.dataset.tooltipDirection = "UP";
	}
	return btn;
}

/**
 * Wire an Invoke card's Invocation buttons (stonetop.js renderChatMessageHTML, after the picks pass
 * that restores the Reduced tick). Whoever can write both the card and the Lightbearer acts
 * (chat.js#canRewriteCard); everyone else sees the button, and what it did once it has.
 */
export function wireInvocationEffects(message, html, { missed = false } = {}) {
	const root = html?.[0] ?? html;
	if (!root?.querySelectorAll) return;
	// Ours out first: a re-render patches the same card.
	for (const el of root.querySelectorAll(".stonetop-invocation-effect")) if (belongsToMessage(el, message)) el.remove();
	const effects = invocationEffectsFor(message, { missed });
	if (!effects.length) return;
	const row = invokeActionRow(root);
	if (!row) return;
	const doc = root.ownerDocument ?? globalThis.document;
	const actor = speakerActor(message);
	const usable = canRewriteCard(message, actor);
	const reducedNow = () => invokeCardReduced(root, message);
	const formula = shadowDamageFormula({ reduced: reducedNow() });

	for (const { slug, flag } of effects) {
		const done = message.getFlag(SYSTEM_ID, flag);
		const bath = slug === BATH_OF_HEALING_LIGHT;
		const btn = effectButton(doc, bath
			? { icon: "fa-hand-holding-heart", className: "stonetop-bath-heal",
				label: done ? format(`${KEY}.bathButtonDone`, { name: typeof done === "string" ? done : "" }).trim() : localize(`${KEY}.bathButton`),
				tooltip: localize(`${KEY}.bathButtonTooltip`) }
			: { icon: "fa-ghost", className: "stonetop-shadow-damage",
				label: done ? localize(`${KEY}.shadowButtonDone`) : format(`${KEY}.shadowButton`, { formula }),
				tooltip: format(`${KEY}.shadowButtonTooltip`, { formula }) });
		btn.classList.toggle("is-chosen", !!done);
		btn.disabled = !!done || !usable;
		if (!btn.disabled) {
			btn.addEventListener("click", ev => {
				const run = bath
					? settleBathOfHealingLight(message, actor, { reduced: reducedNow(), empowered: !!message.getFlag(SYSTEM_ID, CARD_EMPOWERED_FLAG), buttons: [btn] })
					: settleShadowDamage(message, actor, { reduced: reducedNow(), shiftKey: !!ev?.shiftKey, buttons: [btn] });
				run.catch(err => console.error(`Stonetop | ${bath ? BATH_NAME : SHADOW_NAME} failed`, err));
			});
		}
		row.appendChild(btn);
	}

	// Ticking "The Invocation has its reduced effect" changes the damage the button names; the click
	// re-reads it either way, so this is only so the label never says 2d8 about a 1d8.
	const shadow = row.querySelector(".stonetop-shadow-damage:not(.is-chosen)");
	if (shadow && root.dataset && root.dataset.invocationEffectsWired !== "1") {
		root.dataset.invocationEffectsWired = "1";
		root.addEventListener?.("change", () => {
			const now = shadowDamageFormula({ reduced: reducedNow() });
			const btn = root.querySelector(".stonetop-shadow-damage:not(.is-chosen)");
			if (!btn) return;
			btn.innerHTML = `<i class="fas fa-ghost" aria-hidden="true"></i> ${escHtml(format(`${KEY}.shadowButton`, { formula: now }))}`;
			btn.dataset.tooltip = format(`${KEY}.shadowButtonTooltip`, { formula: now });
		});
	}
}
