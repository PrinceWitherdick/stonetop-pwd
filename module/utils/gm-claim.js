// ONE CLIENT SAYS WHO TAKES A THING FIRST.
//
// Some presses may happen only once across the whole table: a level gained, a payout on a chat card, a card's
// once-only button. Each is checked on the client that presses it, against that client's own copy of the
// world, so two clients pressing inside one round trip both read "nobody has it" and both go ahead. Writing a
// claim and reading it back after a pause only narrows that: each client reads its own write until the other's
// arrives, and a slow connection outlasts any pause.
//
// So a claim is decided on ONE client, the active GM's, in turn (utils/turn-queue.js): one claim per key at a
// time, the first asker answered yes and the next one seeing what the first took. A player's client asks the
// GM's with a User query; the GM's own press decides on its own client, in the same turn as the asks. The GM
// grants only what the asker could have taken themselves (each claim's `may`), and a claim that stands for a
// write makes that write ITSELF, so it has landed on the GM's copy before the next asker is answered.
//
// With no GM connected, or no answer from the GM's client in time, `ask` answers null and the caller claims as
// it would alone. The GM's client answers null too when it cannot tell who asked (a v13 claim naming a second
// GM that the named GM's client does not confirm) or cannot find the thing claimed, and when a claim reaches
// its turn so late that the asker has stopped waiting: nothing is written then, since nobody would read the yes.

import { askGMClient, resolveSync } from "./foundry-compat.js";
import { sendVerifiable, verifiedAsker } from "./owner-ask.js";
import { inTurn } from "./turn-queue.js";

/** How long an asker waits for the GM's client (ms). */
export const GM_CLAIM_ASK_MS = 8000;

/** How long the GM's client checks back with a second GM who claims (ms), inside the asker's wait. */
const GM_CLAIM_VERIFY_MS = 4000;

/**
 * A claim that reaches its turn this long after it arrived is answered null with nothing written (ms): the
 * asker's wait began a network hop earlier and ends at GM_CLAIM_ASK_MS, and its fallback may already have run.
 */
const GM_CLAIM_LATE_MS = 6000;

/**
 * Define one kind of claim the GM's client decides. Each is its own User query, registered at init.
 *
 * @param {object} spec
 * @param {string} spec.query  the CONFIG.queries key
 * @param {string} spec.what   what the console says could not be done ("claim the level-up")
 * @param {(data: object) => object|null} spec.subject  the GM's copy of the thing claimed, from the payload
 * @param {(subject: object, data: object) => string} spec.key  the turn a claim waits in; claims that could collide share one
 * @param {(subject: object, asker: User, data: object) => boolean} spec.may  whether an asker could take it themselves
 * @param {(subject: object, data: object, asker: User) => *} spec.grant  the decision, and the write it stands for,
 *   made in turn. Its answer goes back to the asker as it is; null leaves the asker to claim alone.
 * @param {(subject: object, data: object, asker: User) => *} [spec.release]  a claim given back, in turn
 * @param {*} [spec.refused]  the answer when `may` says no (default false)
 */
export function defineGmClaim(spec) {
	const { query, what, subject, key, may, grant, release = null, refused = false } = spec;

	/**
	 * The claim decided on this client, in its turn. `late()` says the asker has stopped waiting. `may` is asked
	 * of an asker, not of this client's own press (`own`), whose own write is the check, as it is with no GM.
	 */
	const decide = (thing, data, asker, { late = () => false, own = false } = {}) => inTurn(`gmClaim|${query}|${key(thing, data)}`, async () => {
		if (late()) return null;
		if (data?.release) {
			await release?.(thing, data, asker);
			return true;
		}
		if (!own && !may(thing, asker, data)) return refused;
		return (await grant(thing, data, asker)) ?? null;
	});

	/**
	 * Ask for the claim (or, with `data.release`, give it back). The GM's own client decides here, on
	 * `local` (this client's copy of the thing claimed, when the caller has it) or what `data` resolves to.
	 *
	 * @param {object} data  plain data naming what is claimed; who asks is added
	 * @param {{game?: object, ask?: Function, local?: object}} [deps]
	 * @returns {Promise<*>}  grant's answer, or null: no GM, no answer, or nobody could tell
	 */
	async function ask(data, { game: g = globalThis.game, ask: send = askGMClient, local = null } = {}) {
		const me = g?.user ?? null;
		const gm = g?.users?.activeGM ?? null;
		if (!me || !gm) return null;
		if (gm.id === me.id) {
			const thing = local ?? subject(data);
			return thing ? decide(thing, data, me, { own: true }) : null;
		}
		// Verifiable, so a second GM's claim is taken as theirs on v13 (handle).
		const answer = await sendVerifiable(askId => send(gm, query, { ...data, userId: me.id, askId },
			{ fallback: null, what: data?.release ? `give back: ${what}` : what, timeout: GM_CLAIM_ASK_MS }));
		return answer ?? null;
	}

	/**
	 * The query's handler on the GM's client. A second GM claims too, but on v13 a payload's GM id is the
	 * sender's own word, so it counts only once that GM's client says it sent the claim (owner-ask.js#
	 * verifiedAsker). An asker that cannot be told, or a thing that cannot be found, is answered null, as
	 * with no GM at all: the claim never lets anyone write what they could not have written alone.
	 *
	 * @param {object} data
	 * @param {object} [context]  core's query context
	 * @param {{users?: object, me?: User, subject?: Function, verify?: Function, now?: () => number}} [deps]
	 */
	async function handle(data, context = {}, deps = {}) {
		const { users = globalThis.game?.users, me = globalThis.game?.user, verify = verifiedAsker, now = Date.now } = deps;
		const resolve = deps.subject ?? subject;
		if (!me?.isGM) return null;
		const arrived = now();
		const asker = await verify(data, context, users, { timeout: GM_CLAIM_VERIFY_MS });
		const thing = asker ? resolve(data) : null;
		if (!asker || !thing) return null;
		return decide(thing, data, asker, { late: () => now() - arrived > GM_CLAIM_LATE_MS });
	}

	return {
		query,
		ask,
		/** Give a claim back (spec.release on the GM's side). Answers as ask does. */
		release: (data, deps) => ask({ ...data, release: true }, deps),
		handle,
		/** Register the GM's side (from stonetop.js, at init, beside the other queries). */
		register(queries = globalThis.CONFIG?.queries) {
			if (!queries) return;
			queries[query] = (data, context) => handle(data, context);
		},
	};
}

/** The GM's copy of a chat card a claim names, for a claim on a card (picked-option-button.js, card-latch.js). */
export function claimedCard(data) {
	return typeof data?.messageUuid === "string" ? resolveSync(data.messageUuid) : null;
}
