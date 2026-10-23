// ASKING ANOTHER PLAYER TO SPEND WHAT IS THEIRS. Two moves let one character's player spend from
// another character's purse: Healer's Arts' Stock, the CARER's (actors/character/healers-arts.js), and
// the use of supplies "someone else must expend ... on their behalf" (Book I p.246), the PAYER's
// (actors/character/supply-payer.js). Both follow one rule: the purse is its owner's, and so is the
// choice to spend it. When this user is the one who would be asked anyway (healers-arts.js#
// carerStockAnswerer) it is spent right here; otherwise a User query goes to whoever decides, who sees
// who is asking and what it costs, and pays out of the owner's own purse. Nothing is spent for a "no",
// a closed window or an answer that never comes.
//
// This file is the half the two share: the ask, its timeout and what a missing answer means on the
// asking side; the primary-GM guard, the asker and the late-answer check on the answering side. Each
// move keeps its own wording, its own checks and its own spend.

import { isPrimaryGM } from "./primary-gm.js";
import { queryAsker } from "./foundry-compat.js";
import { confirmOutcome } from "./ask-with-buttons.js";
import { escHtml } from "./strings.js";

/**
 * How long the asker waits for the answer. A person is reading a question, so it is minutes, not the
 * seconds a GM's relay gets; and it has to be SOMETHING, because core's server never answers a query
 * whose recipient has left. No answer in time is read as a no.
 */
export const OWNER_ASK_MS = 120000;

/**
 * The answering side stops spending this long before the asker stops waiting, so a yes pressed at the
 * last moment can never pay for a move that has already gone ahead without it.
 */
const LATE_MARGIN_MS = 10000;

/**
 * The query a v13 answerer sends back to a GM named only by the ask's payload, asking whether that GM's
 * client really sent it (handleOwnerAskVerify). v13 names no sender in a query's context, so a payload's
 * GM id is the sender's own word; the ask's one-off id, held only by the client that sent it, is the proof.
 */
export const OWNER_ASK_VERIFY_QUERY = "stonetop.ownerAskVerify";

/** The asks this client has sent and is still waiting on, by their one-off id. */
const _outstanding = new Set();

const newAskId = () => globalThis.foundry?.utils?.randomID?.(16) ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** OWNER_ASK_VERIFY_QUERY's answer, on the claimed asker's client: whether it sent the ask `askId` and still waits on it. */
export function handleOwnerAskVerify(data) {
	return typeof data?.askId === "string" && _outstanding.has(data.askId);
}

/** Whether `gm`'s client sent the ask `data` carries (OWNER_ASK_VERIFY_QUERY). No answer is a no. */
async function sentBy(gm, data) {
	if (typeof data?.askId !== "string" || typeof gm?.query !== "function") return false;
	try {
		return (await gm.query(OWNER_ASK_VERIFY_QUERY, { askId: data.askId }, { timeout: 10000 })) === true;
	} catch {
		return false;
	}
}

/**
 * Spend out of `owner`'s purse, or ask whoever decides for them (see the header).
 *
 * @param {object} o
 * @param {Actor} o.owner          whose purse it is
 * @param {User|null} o.answerer   who decides on it (healers-arts.js#carerStockAnswerer); null: nobody can
 * @param {Function} o.spend       `() => Promise<receipt|null>`: the spend, made here when this user decides
 * @param {string} o.query         the CONFIG.queries key the answerer's client handles
 * @param {object} [o.data]        the query's payload; who asked is added (v13 names nobody in the context)
 * @param {string} o.whether       the notice's question, after "Asking X whether "
 * @param {string} [o.what]        what the console says no answer came about
 * @returns {Promise<object|null>}  the receipt when spent; `{declined: true}` when the owner's side said no
 *   or closed the window, plus `unanswered: true` when no answer came; null when it could not be spent
 */
export async function spendOrAskOwner({ owner, answerer, spend, query, data = {}, whether, what = "a spend" }) {
	if (!owner || !answerer) return null;
	const user = globalThis.game?.user ?? null;
	// The one who decides is this user: spent here, by a user who can write the owner, or not at all.
	if (answerer.id === user?.id) return owner.isOwner ? spend() : null;
	globalThis.ui?.notifications?.info?.(`Asking ${answerer.isGM ? "the GM" : answerer.name} whether ${whether}`);
	const askId = newAskId();
	_outstanding.add(askId);
	try {
		return (await answerer.query(query, { ...data, userId: user?.id ?? null, askId }, { timeout: OWNER_ASK_MS })) ?? null;
	} catch (err) {
		// Out of time, or they left: nobody said yes, so nothing was spent.
		console.warn(`Stonetop | no answer came about ${what}`, err);
		return { declined: true, unanswered: true };
	} finally {
		_outstanding.delete(askId);
	}
}

/**
 * The answering side of a spendOrAskOwner query, on the owner's player's client (or the GM's, when none of
 * them is online). A GM answers only as the primary GM, so two GMs are never both asked. WHO ASKED is
 * foundry-compat.js#queryAsker's business, which here, unlike the GM relays, takes a GM's claimed id (see there),
 * once that GM's client has said the ask is theirs (OWNER_ASK_VERIFY_QUERY).
 *
 * @param {object} data     the query's payload
 * @param {object} context  core's query context
 * @param {object} o
 * @param {object} [o.users]
 * @param {Function} [o.confirm]  confirmOutcome, for the tests
 * @param {Function} o.question   `(asker, me) => spec|null`: the move's own checks, then confirmOutcome's
 *   `{title, content, yes, no}`; null refuses the ask
 * @param {Function} o.settle     `(late) => Promise<object|null>`: after a yes, the spend; `late()` says the
 *   asker has stopped waiting (answer with tooLate then)
 * @returns {Promise<object|null>}  as spendOrAskOwner
 */
export async function answerOwnerAsk(data, context, { users = globalThis.game?.users, confirm = confirmOutcome, question, settle }) {
	const me = globalThis.game?.user;
	if (me?.isGM && !isPrimaryGM()) return null;
	const asker = queryAsker(data, context, users, { allowGm: true });
	if (!asker) return null;
	// A GM named only by the payload (v13): their client is asked whether the ask is theirs, since a player could
	// name the GM to get past the move's ownership checks, which a GM always passes.
	if (asker.isGM && !context?.user && !(await sentBy(asker, data))) return null;
	const spec = await question(asker, me);
	if (!spec) return null;
	const asked = Date.now();
	if (!(await confirm(spec))) return { declined: true };
	return settle(() => Date.now() - asked > OWNER_ASK_MS - LATE_MARGIN_MS);
}

/** A yes that came after the asker stopped waiting: said, and answered as a no, so nothing is spent. */
export function tooLate(message) {
	globalThis.ui?.notifications?.warn?.(message);
	return { declined: true };
}

/** The line a GM's copy of the question carries, so they know why it came to them. */
export function gmAnswersNote(me, ownerName) {
	return me?.isGM ? `<p>None of ${escHtml(ownerName)}'s players is here, so the GM answers.</p>` : "";
}
