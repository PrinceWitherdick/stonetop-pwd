// WHO WRITES THE STEADING'S ASSETS AND HERD (expedition audit PREP-8, 2026-11-03).
//
// A Requisition marks an asset out by rewriting the steading's whole `assets` list, and takes horses out
// of the herd by rewriting the herd's three counts. Each is read and written in the steading's turn
// (StonetopSteading#editList, utils/turn-queue.js), but a turn is ONE CLIENT'S: a player taking the wagon
// from their sheet while the GM ticks the plows on the walkthrough each read the same list, and whichever
// write landed second put the other asset back on hand while its item or trip record said it was out.
//
// So a player's client hands these writes to the GM's (STEADING_ASSETS_QUERY), and the GM's client makes
// them in its own turn, where every take from every door queues on one line. A GM's client writes for
// itself; with no GM connected the player's client writes, as it always did. The GM writes only for a
// player who could have written the steading themselves: the relay orders the writes, it grants nothing.

import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";

/** The query a player's client sends the GM's to make one asset or herd write. */
export const STEADING_ASSETS_QUERY = "stonetop.steadingAssets";

/** The writes the relay carries, each the name of the StonetopSteading method that makes it here. */
export const RELAYED_ASSET_WRITES = Object.freeze({
	take:     "_setAssetTakenHere",
	return:   "_returnAssetHere",
	lose:     "_loseAssetHere",
	fromHerd: "_requisitionFromHerdHere",
	toHerd:   "_returnToHerdHere",
});

/** Where each write's options object sits in its arguments: the GM's side adds `late` there. */
const OPTIONS_AT = Object.freeze({ take: 2, return: 1, lose: 1, fromHerd: 1, toHerd: 1 });

/** How long a player's client waits for the GM's to make a write (ms). */
export const ASSET_RELAY_ASK_MS = 10000;

/**
 * How long, after the GM's answer never came, a player's client still watches for its write to land (ms). The
 * GM's side starts no write after ASSET_RELAY_LATE_MS, but one started in time can finish after the asker's
 * wait ran out (a slow connection), and its player was then told it failed while the steading says it was made.
 */
export const ASSET_RELAY_ECHO_MS = 15000;

/** The update option a relayed write carries, `{id, value}`, so its asker knows it landed (relayEcho). */
export const ASSET_RELAY_OPTION = "stonetopAssetRelay";

/**
 * The update options that tag a relayed write with its request id and what it answers, so the asker sees it
 * land on its own client's updateActor hook (Foundry hands a write's options to every client's). Empty for a
 * write made for this client itself. PURE.
 */
export function relayEcho(relayId, value) {
	return relayId ? { [ASSET_RELAY_OPTION]: { id: relayId, value } } : {};
}

/**
 * Watch the steading `uuid` for the write tagged `id` (relayEcho). `landed()` answers `{value}` once it has,
 * else null; `wait(ms)` resolves with that once it lands or `ms` runs out; `stop()` drops the watch.
 */
function watchEcho(uuid, id, hooks = globalThis.Hooks) {
	let seen = null;
	let wake = null;
	const hookId = hooks?.on?.("updateActor", (actor, _changes, options) => {
		const echo = options?.[ASSET_RELAY_OPTION];
		if (actor?.uuid !== uuid || echo?.id !== id) return;
		seen = { value: echo.value };
		wake?.();
	});
	const stop = () => { if (hookId != null) hooks?.off?.("updateActor", hookId); };
	const wait = ms => (seen || hookId == null ? Promise.resolve(seen) : new Promise(resolve => {
		const timer = setTimeout(() => resolve(seen), ms);
		wake = () => { clearTimeout(timer); resolve(seen); };
	}));
	return { landed: () => seen, wait, stop };
}

/**
 * A write that reaches the steading's turn this long after it arrived is not made (ms): the asker's wait
 * began a network hop earlier and ends at ASSET_RELAY_ASK_MS, and it has already told its player the
 * write failed, so a write made now would leave the steading saying an asset is out that nobody holds.
 */
const ASSET_RELAY_LATE_MS = 7000;

/**
 * The GM a write should go to from this client, or null to write here: no GM connected, or this client
 * is a GM's. PURE but for the game it reads.
 */
export function assetRelayTarget(g = globalThis.game) {
	const gm = g?.users?.activeGM ?? null;
	if (!gm || g?.user?.isGM || gm.id === g?.user?.id) return null;
	return gm;
}

/**
 * Make one relayed write: on the GM's client when this one should hand it over, else here, through the
 * same RELAYED_ASSET_WRITES method the GM's side calls.
 *
 * A refusal or no answer from the GM's side throws, so a caller's "could not write the steading" path
 * runs exactly as it does for a write refused here. With no answer, the write is first watched for a while
 * longer (ASSET_RELAY_ECHO_MS): one the GM's client made late counts as made, with what it answered.
 *
 * @param {object} steading  the StonetopSteading
 * @param {string} op        a key of RELAYED_ASSET_WRITES
 * @param {Array} args       the method's arguments, plain data
 */
export async function relayAssetWrite(steading, op, args, {
	target = assetRelayTarget, hooks = globalThis.Hooks, echoMs = ASSET_RELAY_ECHO_MS,
	newId = () => globalThis.foundry?.utils?.randomID?.() ?? `${Date.now()}-${Math.random()}`,
} = {}) {
	const gm = target();
	const actor = steading?._actor ?? null;
	if (!gm || !actor?.uuid) return steading[RELAYED_ASSET_WRITES[op]](...args);
	const relayId = newId();
	// Watched from before the ask, so an echo that beats the answer home is not missed.
	const echo = watchEcho(actor.uuid, relayId, hooks);
	try {
		const answer = await askGMClient(gm, STEADING_ASSETS_QUERY, {
			steadingUuid: actor.uuid, op, args, relayId, userId: globalThis.game?.user?.id ?? null,
		}, { fallback: { unanswered: true }, what: "write the steading's assets", timeout: ASSET_RELAY_ASK_MS });
		if (answer?.refused) throw new Error(`The GM's client refused to ${op} a steading asset for this user.`);
		// The GM's client answered that its write threw: it failed, and no echo is coming.
		if (answer?.error) throw new Error(`The GM's client couldn't ${op} a steading asset.`);
		if (answer && !answer.unanswered) return answer.value;
		// Only a missing answer is watched for a late write.
		const landed = echo.landed() ?? await echo.wait(echoMs);
		if (landed) return landed.value;
		throw new Error(`No answer from the GM's client to ${op} a steading asset.`);
	} finally {
		echo.stop();
	}
}

/**
 * The GM's side: the asker must be able to write the steading themselves, and the write is one of the
 * relayed ones. Answers `{value}`, `{refused: true}`, or `{error: true}` when the write threw.
 *
 * The write is handed a `late()` check in its options, asked again in the steading's turn: one that
 * waited there past ASSET_RELAY_LATE_MS writes nothing, as a late claim does (utils/gm-claim.js).
 */
export async function handleSteadingAssetsQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync, wrap = actor => actor?.typedActor ?? null, now = Date.now } = deps;
	const arrived = now();
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return { refused: true };
	const asker = queryAsker(data, context, users);
	const actor = data?.steadingUuid ? resolve(data.steadingUuid) : null;
	const method = RELAYED_ASSET_WRITES[data?.op];
	if (!asker || !actor || !method || !actor.testUserPermission?.(asker, "OWNER")) return { refused: true };
	const steading = wrap(actor);
	if (typeof steading?.[method] !== "function") return { refused: true };
	const args = Array.isArray(data.args) ? [...data.args] : [];
	const at = OPTIONS_AT[data.op];
	const given = args[at];
	const relayId = typeof data.relayId === "string" && data.relayId ? data.relayId : null;
	args[at] = { ...(given && typeof given === "object" ? given : {}), late: () => now() - arrived > ASSET_RELAY_LATE_MS, relayId };
	try {
		return { value: await steading[method](...args) };
	} catch (err) {
		console.error("Stonetop | could not make a relayed steading asset write", err);
		return { error: true };
	}
}

/** Register the GM's side (from stonetop.js, at init, beside the other queries). */
export function registerSteadingAssetsQuery(queries = globalThis.CONFIG?.queries) {
	if (!queries) return;
	queries[STEADING_ASSETS_QUERY] = (data, context) => handleSteadingAssetsQuery(data, context);
}
