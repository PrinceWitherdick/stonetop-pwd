/**
 * The Would-Be Hero's UP WITH PEOPLE:
 *
 *   "When you converse with someone (PC or NPC) you can hold 2 Rapport with them. If you do, they hold
 *    1 Rapport with you. During the conversation, either of you can spend 1 Rapport to ask the other
 *    player one of the following and get an honest answer.
 *     - What weighs you down or holds you back?
 *     - What drives you forward?
 *     - What lesson would you have me learn?
 *     - What do you think of me, truly?"
 *
 * TWO HOLDS, STORED APART (the user's ruling). The hero's 2 Rapport are the move's own pips (a hold
 * track: a ticked pip is held, MoveResources#setUses). The partner's 1 is not a third pip on that
 * track, where spending one of the hero's could clear it:
 *  - a PC partner holds it on THEIR OWN character (flag `rapport`, keyed by the hero's actor id), shown
 *    as a chip in their sheet's header and spent there, as Piety's Blessing and We Happy Few's
 *    Inspiration are held (roll-boosts.js, inspiration.js). Written here for a PC this client owns, and
 *    by the GM's client for the rest (UP_WITH_PEOPLE_QUERY).
 *  - an NPC partner's is a "theirs" pip on the hero's own card (the `theirs` of the conversation
 *    record), for the GM to tick off when the NPC asks.
 *
 * THE CONVERSATION is recorded on the hero (flag `upWithPeople`): who with, and whether they are a PC.
 * A new one replaces it, both sides: the hero holds 2 again, and a PC partner of the last one lets go
 * of theirs. Every spend posts the four questions, named for who asks whom.
 *
 * KEPT UNTIL SPENT, as Blessing and Inspiration are: nothing clears a hold at the end of a session. It
 * goes when it is spent, or when the hero starts another conversation.
 *
 * Kept free of Foundry globals apart from ChatMessage and the actors collection, so it tests with plain
 * objects.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { heldOnTrack } from "./MoveResources.js";
import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { isActingPrimaryGM } from "../../utils/primary-gm.js";
import { moveChatCard } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

const KEY = "stonetop.upWithPeople";

export const UP_WITH_PEOPLE = "Up With People";

/** "You can hold 2 Rapport with them": the hero's own track, whatever an older copy of the move says. */
export const RAPPORT_MAX = 2;

/** The hero's flag naming who they are talking with: `{id, uuid, name, pc, theirs}`. */
export const CONVERSATION_FLAG = "upWithPeople";

/** A PC partner's flag: the Rapport they hold with each hero, `{[heroId]: {name, uuid}}`. */
export const RAPPORT_FLAG = "rapport";

/** The User query a hero's player sends to write a PC partner's Rapport they do not own. */
export const UP_WITH_PEOPLE_QUERY = "stonetop.upWithPeople";

/** The picker's row for somebody with no sheet (the stranger at the inn), named afterwards. */
export const SOMEONE_ELSE = "__someone-else__";

/** The four questions' keys under `stonetop.upWithPeople.questions`, in the book's order. */
export const RAPPORT_QUESTION_KEYS = Object.freeze(["weighs", "drives", "lesson", "truly"]);

/** The four questions, in the book's words (languages/en.json) and order. */
export function rapportQuestions() {
	return RAPPORT_QUESTION_KEYS.map(key => localize(`${KEY}.questions.${key}`));
}

/**
 * A held copy's track as the move now prints it. A copy taken while the pack printed a third "theirs"
 * pip keeps `max: 3` (migration/move-refresh.js only fills what is missing), so it is read as 2 here. PURE.
 */
export function shippedRapportTrack(name, resource) {
	if (name !== UP_WITH_PEOPLE || !(Number(resource?.max) > RAPPORT_MAX)) return resource;
	const labels = Array.isArray(resource.labels) ? resource.labels.slice(0, RAPPORT_MAX) : resource.labels;
	return { ...resource, max: RAPPORT_MAX, labels };
}

/** How much Rapport the hero holds: 0..2, a stale 3 read as 2. */
export function rapportHeld(hero) {
	return heldOnTrack(hero?.typedActor?.moveResources, UP_WITH_PEOPLE, RAPPORT_MAX);
}

/** The hero's conversation, or null: `{id, uuid, name, pc, theirs}`, `theirs` being an NPC's 0 or 1. */
export function conversationOf(hero, scope = SYSTEM_ID) {
	const raw = hero?.getFlag?.(scope, CONVERSATION_FLAG);
	if (!raw || typeof raw !== "object" || !raw.name) return null;
	return {
		id:     raw.id ?? null,
		uuid:   raw.uuid ?? null,
		name:   String(raw.name),
		pc:     raw.pc === true,
		theirs: raw.pc === true ? 0 : (Number(raw.theirs) > 0 ? 1 : 0),
	};
}

/** The Rapport a PC holds, one entry per hero: `{heroId, name, uuid}`. */
export function rapportHeldWith(partner, scope = SYSTEM_ID) {
	const map = partner?.getFlag?.(scope, RAPPORT_FLAG);
	if (!map || typeof map !== "object") return [];
	return Object.entries(map)
		.filter(([heroId, entry]) => heroId && entry && typeof entry === "object")
		.map(([heroId, entry]) => ({ heroId, name: String(entry.name ?? ""), uuid: entry.uuid ?? null }));
}

/** A PC partner holds 1 Rapport with `hero`. Written outright: a second conversation is still 1. */
export async function holdPartnerRapport(partner, hero, scope = SYSTEM_ID) {
	if (partner?.type !== "character" || !hero?.id || partner.id === hero.id) return false;
	await partner.setFlag(scope, `${RAPPORT_FLAG}.${hero.id}`, { name: hero.name ?? "", uuid: hero.uuid ?? null });
	return true;
}

/** The PC lets go of the Rapport they hold with the hero of this id. Whether they held any. */
export async function releasePartnerRapport(partner, heroId, scope = SYSTEM_ID) {
	if (!heroId || !rapportHeldWith(partner, scope).some(entry => entry.heroId === heroId)) return false;
	await partner.unsetFlag(scope, `${RAPPORT_FLAG}.${heroId}`);
	return true;
}

/** One query to the GM's client, answering false when it cannot. */
function askGM(gm, data) {
	return askGMClient(gm, UP_WITH_PEOPLE_QUERY, data, { fallback: false, what: "write the Rapport" });
}

/**
 * Write (`hold`) or clear (`release`) a PC partner's Rapport with the hero: here for a PC this client
 * owns, through the GM's client for the rest. Whether it was written.
 */
async function writePartner(action, hero, partner, { scope, gm, userId }) {
	if (partner?.isOwner) {
		return action === "hold" ? holdPartnerRapport(partner, hero, scope) : releasePartnerRapport(partner, hero.id, scope);
	}
	return !!(await askGM(gm, { action, heroUuid: hero?.uuid ?? null, partnerUuid: partner?.uuid ?? null, userId }));
}

/** The previous conversation's PC, when there was one and they are still in the world. */
function previousPartner(record, { actors, resolve }) {
	if (!record?.pc) return null;
	const actor = (record.id ? actors?.get?.(record.id) : null) ?? (record.uuid ? resolve(record.uuid) : null);
	return actor?.type === "character" ? actor : null;
}

/** The four questions as a list, for a card, in the poster's language. */
function questionsHtml() {
	return `<ul>${rapportQuestions().map(q => `<li>${escHtml(q)}</li>`).join("")}</ul>`;
}

/** Post a card spoken as `speaker`: one line, then the four questions. */
function postQuestions(speaker, line) {
	return globalThis.ChatMessage?.create?.({
		content: moveChatCard(UP_WITH_PEOPLE, `<p>${escHtml(line)}</p>${questionsHtml()}`),
		speaker: speaker ? globalThis.ChatMessage?.getSpeaker?.({ actor: speaker }) : { alias: "Stonetop" },
	});
}

/**
 * "When you converse with someone": the hero holds 2 Rapport and the partner 1. `partner` is `{name,
 * actor}`, the actor absent for somebody with no sheet. A PC partner holds theirs on their own sheet; an
 * NPC's is the "theirs" pip on the hero's card. Replaces the last conversation on both sides, and posts
 * a card naming both with the four questions.
 *
 * @returns {Promise<{name: string, pc: boolean, missed: boolean, releaseMissed: boolean}|null>}  null when
 *   nothing was done; `missed` when a PC partner's Rapport could not be written (no GM online), and
 *   `releaseMissed` when the last conversation's PC could not be made to let go of theirs
 */
export async function converse(hero, partner, {
	scope = SYSTEM_ID, gm = globalThis.game?.users?.activeGM ?? null, userId = globalThis.game?.user?.id ?? null,
	actors = globalThis.game?.actors, resolve = resolveSync,
} = {}) {
	const name = String(partner?.actor?.name ?? partner?.name ?? "").trim();
	if (!ownsLearnedMoveNamed(hero, UP_WITH_PEOPLE) || !name) return null;
	const actor = partner?.actor ?? null;
	if (actor?.id && actor.id === hero.id) return null;
	const resources = hero.typedActor?.moveResources;
	if (!resources) return null;
	const pc = actor?.type === "character";

	// The last conversation's PC lets go first, unless it is the same PC, whose hold is written again.
	// A release that answers false may only mean they had already spent it, so what says it missed is the
	// hold still standing on their sheet afterwards.
	const before = previousPartner(conversationOf(hero, scope), { actors, resolve });
	let releaseMissed = false;
	if (before && before.id !== actor?.id) {
		await writePartner("release", hero, before, { scope, gm, userId });
		releaseMissed = rapportHeldWith(before, scope).some(entry => entry.heroId === hero.id);
		if (releaseMissed) globalThis.ui?.notifications?.warn?.(format(`${KEY}.releaseMissed`, { name: before.name ?? "", hero: hero.name ?? "" }));
	}

	// The hero's Rapport and the conversation, in one write.
	await hero.update({
		...resources.usesUpdate(UP_WITH_PEOPLE, RAPPORT_MAX),
		[`flags.${scope}.${CONVERSATION_FLAG}`]: { id: actor?.id ?? null, uuid: actor?.uuid ?? null, name, pc, theirs: pc ? 0 : 1 },
	}, { stonetopMove: UP_WITH_PEOPLE });

	const missed = pc ? !(await writePartner("hold", hero, actor, { scope, gm, userId })) : false;
	if (missed) globalThis.ui?.notifications?.warn?.(format(`${KEY}.missed`, { name }));
	await postQuestions(hero, format(`${KEY}.conversed`, { hero: hero.name ?? "", partner: name }));
	return { name, pc, missed, releaseMissed };
}

/**
 * After a click on one of the hero's own pips (the sheet's track handler): a pip unticked is a Rapport
 * spent, so the four questions go to chat, asked of whoever the hero is talking with. `before` is what
 * they held before the click (rapportHeld). Whether a card was posted.
 */
export async function afterHeroPip(hero, before, scope = SYSTEM_ID) {
	const left = rapportHeld(hero);
	if (left >= before) return false;
	const partner = conversationOf(hero, scope)?.name || localize(`${KEY}.them`);
	await postQuestions(hero, format(`${KEY}.heroSpends`, { hero: hero.name ?? "", partner, left }));
	return true;
}

/**
 * A PC partner spends the Rapport they hold with the hero of this id, from their own sheet: it goes,
 * and the four questions go to chat, asked of the hero. Whether one was spent.
 */
export async function spendPartnerRapport(partner, heroId, scope = SYSTEM_ID) {
	const held = rapportHeldWith(partner, scope).find(entry => entry.heroId === heroId);
	if (!held || !(await releasePartnerRapport(partner, heroId, scope))) return false;
	await postQuestions(partner, format(`${KEY}.partnerSpends`, { partner: partner.name ?? "", hero: held.name }));
	return true;
}

/**
 * The NPC's "theirs" pip on the hero's card, pressed: held, it is spent and the four questions go to
 * chat, asked of the hero; spent, it is ticked again (a press made by mistake). What happened: "spent",
 * "restored", or null for a hero talking with nobody, or with a PC (whose Rapport is on their own sheet).
 */
export async function toggleNpcRapport(hero, scope = SYSTEM_ID) {
	const record = conversationOf(hero, scope);
	if (!record || record.pc) return null;
	const spending = record.theirs > 0;
	await hero.setFlag(scope, CONVERSATION_FLAG, { ...record, theirs: spending ? 0 : 1 });
	if (!spending) return "restored";
	await postQuestions(hero, format(`${KEY}.partnerSpends`, { partner: record.name, hero: hero.name ?? "" }));
	return "spent";
}

/**
 * Who the hero might converse with, as the people picker takes them (`{id, name, actor}`): the other
 * characters, the people the viewer can see, and a row for somebody with no sheet. PURE apart from the
 * actors read.
 */
export function conversationPartners(hero, { actors = globalThis.game?.actors } = {}) {
	const all = [...(actors?.contents ?? actors ?? [])];
	const rows = all
		.filter(actor => actor?.id !== hero?.id && (actor?.type === "character" || (actor?.type === "npc" && actor.visible !== false)))
		.map(actor => ({ id: actor.id, name: actor.name, actor }));
	rows.push({ id: SOMEONE_ELSE, name: localize(`${KEY}.someoneElse`), hint: localize(`${KEY}.someoneElseHint`), actor: null });
	return rows;
}

/** The hero's card on the Moves tab: the conversation, and the NPC's pip. */
export function upWithPeopleCard(hero, { editable = false, scope = SYSTEM_ID } = {}) {
	const record = conversationOf(hero, scope);
	return {
		partner:  record?.name ?? null,
		pc:       !!record?.pc,
		npc:      !!record && !record.pc,
		theirs:   (record?.theirs ?? 0) > 0,
		editable,
		theirsTooltip: record && !record.pc
			? format(`${KEY}.${record.theirs > 0 ? "theirsHeld" : "theirsSpent"}`, { partner: record.name })
			: "",
	};
}

/** The header chips for a PC holding Rapport with a hero: one per hero, the count in words. */
export function rapportChips(partner, { editable = false, scope = SYSTEM_ID } = {}) {
	return rapportHeldWith(partner, scope).map(entry => ({
		heroId:  entry.heroId,
		label:   format(`${KEY}.chipLabel`, { hero: entry.name }),
		tooltip: format(`${KEY}.${editable ? "chipTooltip" : "chipReadOnly"}`, { hero: entry.name }),
	}));
}

/** The words the partner's spend question uses, for the sheet. */
export function partnerSpendWords(partner, heroId, scope = SYSTEM_ID) {
	const held = rapportHeldWith(partner, scope).find(entry => entry.heroId === heroId);
	const hero = held?.name ?? "";
	return {
		title: UP_WITH_PEOPLE,
		ask:   format(`${KEY}.spendAsk`, { partner: partner?.name ?? "", hero }),
		spend: localize(`${KEY}.spendButton`),
		keep:  localize(`${KEY}.keepButton`),
	};
}

/**
 * The GM's side of UP_WITH_PEOPLE_QUERY, for the primary GM only: `hold` or `release` a PC partner's
 * Rapport with the hero, if the asker plays the hero and the hero has Up With People learned. Who asked
 * is read as roll-boosts.js reads it (foundry-compat.js#queryAsker). Answers whether it was written.
 */
export async function handleUpWithPeopleQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync, scope = SYSTEM_ID } = deps;
	if (!isActingPrimaryGM()) return false;
	const user = queryAsker(data, context, users);
	const hero = data?.heroUuid ? resolve(data.heroUuid) : null;
	const partner = data?.partnerUuid ? resolve(data.partnerUuid) : null;
	if (!user || !hero?.testUserPermission?.(user, "OWNER") || !ownsLearnedMoveNamed(hero, UP_WITH_PEOPLE)) return false;
	if (partner?.type !== "character" || partner.id === hero.id) return false;
	if (data?.action === "hold") return holdPartnerRapport(partner, hero, scope);
	if (data?.action === "release") return releasePartnerRapport(partner, hero.id, scope);
	return false;
}
