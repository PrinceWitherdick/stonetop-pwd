// RETIRING A PC (Book I p.584).
//
// "If a PC retires from play but stays in the village or the region, then turn them into an NPC. By default,
// their portrayal falls to you." And "Epilogues": "When a PC retires or passes away, give them an epilogue: a
// scene or two to send them off and say goodbye. ... If the PC leaves Stonetop, then have the player narrate
// their departure, as well as a glimpse of their future ... If the PC retires, play out their decision to do
// so. Then, now or later, have the player describe a typical day in their new life." And: "Epilogues should
// skip game mechanics." So this asks for nothing but the words and posts them, takes the character out of
// play (campaign/left-play.js), and for one who stays, files the NPC they become on the steading's people
// with status Retired (data-models/npc-status.js), the book's own "I add 'retired' to her entry on the
// steading playbook" (p.481).
//
// Reached from the character sheet (its owner or the GM), the Actors sidebar, and Winter's shortfall
// "A PC dies, leaves, or retires" (p.518; actors/steading/winter-debt.js).

import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { isOutOfPlay } from "../actors/character/deaths-door-actor.js";
import { addPersonToSteading } from "../actors/steading/steading-people.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { escHtml } from "../utils/strings.js";
import { actorLinkHtml } from "../utils/actor-link.js";
import { stonetopChatCard } from "../utils/chat.js";
import { plainTextToHtml } from "../journal/card-vm.js";
import { deletionEntry } from "../utils/foundry-compat.js";
import { LEFT_PLAY_FLAG, LEFT_PLAY_HOW, leftPlayRecord } from "./left-play.js";

/** The NPC a retiring PC becomes: a new one on either roster, one already on the sheet, or none. */
export const RETIRE_NPC = Object.freeze({ RESIDENT: "residents", NEIGHBOR: "neighbors", NONE: "none" });

/** The NPC flag naming the character it was (STONETOP_SCOPE), so the two can be found from each other. */
export const RETIRED_PC_FLAG = "retiredPcUuid";

/** The two endings this flow writes, with the book's prompts for each epilogue (p.584). */
export const RETIRE_CHOICES = Object.freeze([
	{
		how: LEFT_PLAY_HOW.RETIRED,
		label: "Retires, and stays in the village or the region",
		prompt: "Play out their decision to retire. Then, now or later, describe a typical day in their new life. Who are they with and what are they up to? How do they seem to be getting on? What do they seem to be enjoying? What regrets weigh them down?",
	},
	{
		how: LEFT_PLAY_HOW.LEFT,
		label: "Leaves Stonetop",
		prompt: "Narrate their departure, and a glimpse of their future: a \"Where are they now?\" moment. On the road to Lygos, wandering among the Hillfolk, stepping on the Fae paths to never be seen again...",
	},
]);

/** Who may retire this character: its owner or a GM, while it is still in play. */
export function canRetire(actor, user = globalThis.game?.user) {
	if (actor?.type !== "character" || isOutOfPlay(actor)) return false;
	return !!user?.isGM || !!actor.isOwner;
}

/**
 * The epilogue card (p.584). PURE.
 *
 * @param {object} o
 * @param {string} o.name      the character
 * @param {string} o.how       LEFT_PLAY_HOW.RETIRED or .LEFT
 * @param {string} [o.epilogue] what the player said
 * @param {string} [o.npcName]  the NPC they now are, when they stay
 */
export function epilogueCardHtml({ name, how, epilogue = "", npcName = "" }) {
	const sub = how === LEFT_PLAY_HOW.LEFT ? "Leaves Stonetop" : "Retires";
	const body = plainTextToHtml(epilogue)
		|| `<p class="stonetop-epilogue-empty">${escHtml(how === LEFT_PLAY_HOW.LEFT ? `${name} leaves Stonetop.` : `${name} retires from adventuring.`)}</p>`;
	const npc = npcName
		? `<p class="stonetop-epilogue-npc"><em>${escHtml(name)} is now an NPC: ${escHtml(npcName)}, among the people of the steading.</em></p>`
		: "";
	return stonetopChatCard([`${name}: an epilogue`, sub], `<div class="card-content stonetop-epilogue">${body}${npc}</div>`, "stonetop-epilogue-card");
}

/** The new NPC's notes: the epilogue, and the way back to the character sheet. PURE. */
export function retiredNpcNotes(actor, epilogue = "") {
	return `<p>Once a player character (${actorLinkHtml(actor)}). Retired from adventuring; see Book I p.584: they may advise and support the PCs, or help meet the requirements of a plan, but they shouldn't act as followers or solve the PCs' problems.</p>${plainTextToHtml(epilogue)}`;
}

/**
 * Make (or find) the NPC a retiring character becomes, and mark them Retired. The NPC, or null when there is
 * none to be had (the player's client cannot write an existing one; a create that failed).
 */
async function _npcFor(actor, { npc, epilogue, steading, actors, addPerson }) {
	if (!npc || npc === RETIRE_NPC.NONE) return null;
	let person;
	if (npc === RETIRE_NPC.RESIDENT || npc === RETIRE_NPC.NEIGHBOR) {
		person = await addPerson(npc, {
			name: actor.name,
			img: actor.img,
			notes: retiredNpcNotes(actor, epilogue),
		}, steading);
	} else {
		person = actors?.get?.(npc) ?? null;
	}
	if (!person) return null;
	if (person.isOwner === false) {
		globalThis.ui?.notifications?.warn?.(`${person.name} is linked, but only the GM can mark them Retired.`);
		return person;
	}
	await person.update({
		"system.status": "retired",
		[`flags.${STONETOP_SCOPE}.${RETIRED_PC_FLAG}`]: actor.uuid,
	});
	return person;
}

/**
 * Take a character out of play as retired or gone, with their epilogue.
 *
 * @param {Actor} actor
 * @param {object} choice
 * @param {string} choice.how        LEFT_PLAY_HOW.RETIRED or .LEFT
 * @param {string} [choice.epilogue] the player's words
 * @param {string} [choice.npc]      RETIRE_NPC.*, or an existing NPC's actor id; only for one who stays
 * @param {object} [deps]            injectable for tests
 * @returns {Promise<{npc: Actor|null}|null>}  null when nothing was done
 */
export async function retireCharacter(actor, { how, epilogue = "", npc = RETIRE_NPC.NONE } = {}, deps = {}) {
	const {
		steading = getStonetopSteadingActor(),
		actors = globalThis.game?.actors,
		addPerson = addPersonToSteading,
		post = data => globalThis.ChatMessage?.create?.(data),
		now = () => Date.now(),
	} = deps;
	if (!canRetire(actor) || ![LEFT_PLAY_HOW.RETIRED, LEFT_PLAY_HOW.LEFT].includes(how)) return null;
	const staying = how === LEFT_PLAY_HOW.RETIRED;
	let person = null;
	try {
		person = staying ? await _npcFor(actor, { npc, epilogue, steading, actors, addPerson }) : null;
	} catch (err) {
		console.error("Stonetop | could not make the retired PC's NPC", err);
		globalThis.ui?.notifications?.warn?.(`${actor.name} retires, but their NPC could not be made. Add them to the Residents by hand.`);
	}
	await actor.update({
		[`flags.${STONETOP_SCOPE}.${LEFT_PLAY_FLAG}`]: { how, at: now(), npcUuid: person?.uuid ?? null },
	}, { stonetopMove: "Retire" });
	await post({
		content: epilogueCardHtml({ name: actor.name, how, epilogue, npcName: person?.name ?? "" }),
		speaker: { actor: actor.id, alias: actor.name },
	});
	return { npc: person };
}

/**
 * Bring a character who left play alive back into it (a mistake undone, or a return the table wants). The
 * NPC they became is left as it is: whether that person still exists is the GM's to say. GM-only.
 */
export async function returnToPlay(actor) {
	if (!globalThis.game?.user?.isGM || !leftPlayRecord(actor)) return false;
	const [key, value] = deletionEntry(`flags.${STONETOP_SCOPE}.${LEFT_PLAY_FLAG}`);
	await actor.update({ [key]: value }, { stonetopMove: "Return to play" });
	return true;
}

/** Open the retire window for `actor`. Resolves to retireCharacter's result, or null if closed. */
export async function openRetireDialog(actor) {
	if (!canRetire(actor)) return null;
	const { RetireCharacterDialog } = await import("./RetireCharacterDialog.js");
	return new RetireCharacterDialog(actor).promise();
}
