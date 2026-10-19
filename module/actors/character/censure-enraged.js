/**
 * Censure's enraged reaction, ticked on its posted card (Book I p.118): "When you first denounce an
 * individual in your presence as an agent of chaos or anathema to civilization, they pick 1: ... They are
 * enraged, and lash out predictably (the next roll against them has advantage)". ANYONE's next roll against
 * them (the user's ruling, 2026-10-18). The tick asks who was Censured (the sheet's own question,
 * StonetopCharacterSheet#_whoWasCensured, which Castigate's blow asks too) and remembers them on the Judge
 * (fight/hero-moves.js#recordCensureEnraged); every character's next roll aimed at them reads it and spends
 * it (censureEnragedAgainst). Unticked before anyone used it, the entry this card wrote is let go.
 *
 * Which option is the enraged one is read off its own words, as option-debility.js reads its options, so the
 * card a world reworded still works while it says "enraged".
 */

import { SYSTEM_ID } from "../../system-id.js";
import { canRewriteCard, cardMoveName } from "../../utils/chat.js";
import { wireOptionTicks } from "../../utils/picked-option-button.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { format, localize } from "../../utils/i18n.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { CENSURE } from "./condemn.js";
import { recordCensureEnraged, forgetCensureEnraged } from "../../fight/hero-moves.js";

/** Message flag: the names this card's enraged tick recorded, `{names}`, read back as its readout. */
export const CENSURE_ENRAGED_CARD_FLAG = "censureEnraged";

const READOUT = "stonetop-censure-enraged-readout";

/** The cards whose enraged tick is being answered on this client, so a quick re-tick does not ask twice. */
const _answering = new Set();

/** Whether an option's text is Censure's enraged reaction. */
export function optionIsEnraged(text) {
	return /\benraged\b/i.test(String(text ?? ""));
}

/**
 * Who the Judge Censured, as `{uuid, name}`: the sheet's own question (targets, or the people picker), with
 * every member of the group under Proclamation, as Castigate's blow asks it.
 */
async function whoWasCensured(judge) {
	const sheet = judge?.sheet;
	if (typeof sheet?._whoWasCensured !== "function") return [];
	const docs = await sheet._whoWasCensured({ group: !!sheet._stonetopCharacter?.canProclaim });
	return (docs ?? []).filter(doc => doc?.uuid).map(doc => ({ uuid: doc.uuid, name: doc.name ?? doc.actor?.name ?? "" }));
}

/**
 * The enraged option ticked: ask who, remember them on the Judge under this card, and say so on the card.
 * Whether anything was recorded.
 *
 * @param {ChatMessage} message
 * @param {Actor} judge
 * @param {{who?: Function, record?: Function}} [deps]  injectable for tests
 */
export async function enragedTicked(message, judge, { who = whoWasCensured, record = recordCensureEnraged } = {}) {
	if (!ownsLearnedMoveNamed(judge, CENSURE) || _answering.has(message.id)) return false;
	_answering.add(message.id);
	try {
		const people = await who(judge);
		if (!people.length) {
			globalThis.ui?.notifications?.info?.(localize("stonetop.fight.heroMoves.censureEnraged.nobody"));
			return false;
		}
		if (!await record(judge, people, message.id)) return false;
		await message.setFlag(SYSTEM_ID, CENSURE_ENRAGED_CARD_FLAG, { names: people.map(person => person.name) });
		return true;
	} finally {
		_answering.delete(message.id);
	}
}

/** The enraged option unticked: let go of what this card recorded, if no roll has used it yet. */
export async function enragedUnticked(message, judge, { forget = forgetCensureEnraged } = {}) {
	await forget(judge, { message: message.id });
	if (message?.getFlag?.(SYSTEM_ID, CENSURE_ENRAGED_CARD_FLAG)) await message.unsetFlag(SYSTEM_ID, CENSURE_ENRAGED_CARD_FLAG);
	return true;
}

/**
 * Wire a Censure card's enraged option (stonetop.js renderChatMessageHTML, after the picks pass that restores
 * each box's tick). Whoever can write both the card and the Judge acts on a tick (chat.js#canRewriteCard);
 * everyone sees who was left enraged.
 */
export function wireCensureEnraged(message, html, deps = {}) {
	const root = html?.[0] ?? html;
	if (!root?.querySelectorAll) return;
	if (cardMoveName(message, root) !== CENSURE) return;
	const recorded = message?.getFlag?.(SYSTEM_ID, CENSURE_ENRAGED_CARD_FLAG) ?? null;
	wireOptionTicks(message, root, {
		matches:      optionIsEnraged,
		readoutClass: READOUT,
		wiredKey:     "censureEnragedWired",
		readout:      () => (recorded?.names?.length
			? format("stonetop.fight.heroMoves.censureEnraged.readout", { names: recorded.names.join(", ") }) : null),
		onChange:     async box => {
			const judge = deps.judge ?? speakerActor(message);
			if (!(deps.usable ?? canRewriteCard(message, judge))) return;
			try {
				if (box.checked) await enragedTicked(message, judge, deps);
				else await enragedUnticked(message, judge, deps);
			} catch (err) {
				console.error("Stonetop | Censure's enraged reaction could not be recorded", err);
			}
		},
	});
}
