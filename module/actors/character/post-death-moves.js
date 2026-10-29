// ── The moves of a post-death insert's Consequences and Marks ──────────────
// Most Consequences and Marks are prose: a Ghost who takes QUARRY has nothing to press. A few of them
// ROLL or HOLD something, and those are moves in all but name: Poltergeist's Fury, spent on a +DEX or
// +INT roll; Bodysnatcher's +CHA; a Thrall's Red Wrath and Torment's Blessing, rolled +Favor spent.
// Each of those ships as a real move Item beside the insert's own (packs/src/stonetop-items/
// post-death-moves/<insert>/), naming the lore option it belongs to in `system.loreOption`, and the
// character owns it exactly while that option is marked. It then lands in the Post-Death tab's move
// group like the insert's own moves, with the same card, dice, track and hotbar drag.
//
// WHO KEEPS IT IN STEP. A Consequence is marked from half a dozen places: Death's Door's choices step,
// the Undeath walkthrough's one folded write, the tab's edit-mode boxes, the Purpose buttons. Rather than
// teach each of them, a lore write is watched (registerPostDeathMoveHooks) and the moves re-synced on the
// ONE client that made it, as vitals-mirror.js keeps the stored armor: that client had the right to make
// the change, so it has the right to follow it. The sync itself is StonetopCharacter#syncPostDeathLoreMoves,
// queued behind any insert swap, and it is idempotent: however often it runs, one copy per marked option.
//
// And two lore options that are not moves at all but followers: Home to Vermin's "Treat them as
// followers", which marking offers to put on the Followers tab (offerLoreFollowers), once; and Child of
// the Deeps' tentacle, which its own Favor spend calls forth (post-death-outcomes.js#callTentacle). When
// either option is no longer held, its owner is asked whether the card goes too.
//
// One move is made by a press rather than by the sync: the Ravenous maw (data/weapons.js#HORRID_MAW),
// out "for as long as you wish". It names the option it needs in `flags.<system>.heldWhile` instead of
// `system.loreOption`, so the sync leaves it alone, and it goes when that option is no longer held
// (dropStrayHeldMoves).

import { SYSTEM_ID } from "../../system-id.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";
import { localize, format } from "../../utils/i18n.js";
import { escHtml } from "../../utils/strings.js";
import { deletionEntry } from "../../utils/foundry-compat.js";
import { buildCustomFollower, nextFollowerOrder } from "../../data/follower-build.js";
import { readableFlags } from "./StonetopFlags.js";
import { onPreUpdateActorManifest } from "./manifest.js";

/** Whether an Item is a post-death move: an insert's own, or a Consequence's or Mark's. PURE. */
export const isPostDeathMove = item => item?.type === "move" && item.system?.moveType === "post-death";

/**
 * What to create and delete so a character owns the move of every marked Consequence or Mark of their
 * insert and no other. PURE.
 *
 * @param {object} p
 * @param {Array<{name: string, loreOption?: string|null}>} p.entries  the worn insert's moves
 *   (MoveDefinition), the insert's own among them; only those naming a `loreOption` are this sync's
 * @param {Array<{_id: string, system?: object}>} p.owned  the character's post-death move Items
 * @param {(key: string) => boolean} p.isMarked  whether a lore option ("consequences:poltergeist") is marked
 * @returns {{create: object[], remove: string[]}}  Item data to create, Item ids to delete
 */
export function planLoreMoveSync({ entries = [], owned = [], isMarked }) {
	const wanted = entries.filter(m => m?.loreOption && isMarked(m.loreOption));
	const wantedKeys = new Set(wanted.map(m => m.loreOption));
	const remove = [];
	const held = new Set();
	for (const item of owned) {
		const key = item?.system?.loreOption;
		// The insert's own moves (Unliving, Tethered) carry no lore option and are not this sync's to touch.
		if (!key) continue;
		// A second copy of one option goes too: two clients that marked it a moment apart both synced.
		if (!wantedKeys.has(key) || held.has(key)) remove.push(item._id ?? item.id);
		else held.add(key);
	}
	const create = wanted.filter(m => !held.has(m.loreOption)).map(loreMoveItemData);
	return { create, remove };
}

/**
 * Actor flag key (under the system scope): an insert swap or take is under way, its new moves not yet made.
 * Set by StonetopCharacter#setPostDeathInsert before the old moves go and lifted once the new ones are made;
 * the load-time repair (syncPostDeathInsertMoves) acts only while it stands (review VG-3, 2026-10-28).
 */
export const INSERT_MOVES_PENDING_FLAG = "insertMovesPending";

/**
 * Whether this client makes the load-time repair of a cut-short swap. The marker names the user who started
 * the swap (`true` on one from before it did). Theirs to finish while they are connected, since a swap still
 * under way on their client would make the same moves a second time; otherwise the primary GM's. PURE.
 *
 * @param {string|boolean|null|undefined} marker  the INSERT_MOVES_PENDING_FLAG value
 * @param {{userId?: string|null, primaryGM?: boolean, activeUserIds?: Set<string>}} here
 */
export function repairsInsertMovesHere(marker, { userId = null, primaryGM = false, activeUserIds = new Set() } = {}) {
	if (marker == null || marker === false) return false;
	const swapper = typeof marker === "string" ? marker : null;
	if (swapper && swapper === userId) return true;
	return primaryGM && !(swapper && activeUserIds.has(swapper));
}

/**
 * The worn insert's OWN moves (no lore option: Unliving, Undying, Tethered...) the character has no copy
 * of, by name: what a swap a reload cut short never got to make (StonetopCharacter#syncPostDeathInsertMoves,
 * audit RV-6, asked only while INSERT_MOVES_PENDING_FLAG stands). Only ever creates: a copy held is the
 * character's, edited or not. PURE.
 *
 * @param {object} p
 * @param {Array<{name: string, loreOption?: string|null}>} p.entries  the worn insert's moves
 * @param {Array<{name: string, system?: object}>} p.owned  the character's post-death move Items
 * @returns {object[]}  the MoveDefinitions to make
 */
export function planMissingInsertMoves({ entries = [], owned = [] }) {
	const held = new Set(owned.filter(item => !item?.system?.loreOption).map(item => item?.name));
	return entries.filter(m => m?.name && !m.loreOption && !held.has(m.name));
}

/**
 * The Item a lore option's move is created as: the pack move whole (its roll, its outcomes, its track),
 * as the post-death move it is, with the lore option it belongs to so the sync can find it again.
 */
export function loreMoveItemData(def) {
	const data = postDeathMoveItemData(def);
	data.system.loreOption = def.loreOption;
	return data;
}

/**
 * The Item a post-death pack move is created as: the move whole (its roll, its outcomes, its track),
 * as a post-death move. An insert's own moves (Undying, Urges) are made this way, and a lore option's
 * move is this plus its lore option (loreMoveItemData).
 */
export function postDeathMoveItemData(def) {
	const res = def.resource;
	return {
		name: def.name,
		type: "move",
		system: {
			moveType:    "post-death",
			rollType:    def.rollType ?? "",
			description: def.description ?? "",
			...(def.moveResults ? { moveResults: def.moveResults } : {}),
			// Written back out of the ResourceDef as the plain record a pack move stores, so the owned
			// copy's track is the pack's (Poltergeist's Fury, uncapped, and its "Spend 1 to" hover).
			...(res?.max ? { resource: {
				max: res.max,
				...(res.title ? { title: res.title } : {}),
				...(res.labels?.length ? { labels: [...res.labels] } : {}),
				...(res.spendOptions?.length ? { spendOptions: [...res.spendOptions] } : {}),
				...(res.uncapped ? { uncapped: true } : {}),
			} } : {}),
		},
	};
}

// ── Lore followers: Home to Vermin, Child of the Deeps ─────────────────────

/**
 * The follower cards lore options describe, keyed by the lore option that grants them. `sourceUuid` is
 * how a card already made is found again, as an arcanum's summons are (data/arcana-summons.js); every
 * one starts "post-death:", which is also how follower-party.js#followerFeedsItself knows them. `i18n`
 * is the block their windows' words live in.
 *
 *   HOME TO VERMIN     "Bugs, moths, and other vermin have taken up residence in your corpse. They will do
 *                      you favors if you ask. Treat them as followers: group, tiny, gross, meek, stealthy;
 *                      HP 1 each; Instinct to get distracted; Cost: genuine affection." (Revenant, Book I
 *                      p.151.) Offered when the Consequence is marked.
 *   CHILD OF THE DEEPS "While near a body of water, you can spend 1 Favor to call forth a slimy tentacle to
 *                      do your bidding. Treat it as a follower: stealthy, relentless; HP 6; Damage d10
 *                      (reach, forceful, grabby); Instinct to squeeze the life from things; Cost: lives
 *                      drowned." (Thrall, Book I p.153.) `summoned`: never offered on marking, only made
 *                      by its Favor spend (callLoreFollowerUpdate).
 */
export const LORE_FOLLOWERS = {
	"consequences:home-to-vermin": {
		sourceUuid: "post-death:home-to-vermin",
		nameKey:    "stonetop.postDeathMoves.vermin.name",
		i18n:       "stonetop.postDeathMoves.vermin",
		follower: {
			typeLabel:    "vermin",
			portraitIcon: "fas fa-bug",
			isGroup:      true,
			tags:         ["tiny", "gross", "meek", "stealthy"],
			hp:           1,
			instinct:     "to get distracted",
			cost:         "genuine affection",
		},
	},
	"marks:child-of-the-deeps": {
		sourceUuid: "post-death:child-of-the-deeps",
		nameKey:    "stonetop.postDeathMoves.tentacle.name",
		i18n:       "stonetop.postDeathMoves.tentacle",
		summoned:   true,
		follower: {
			typeLabel:    "tentacle",
			portraitIcon: "fas fa-water",
			tags:         ["stealthy", "relentless"],
			hp:           6,
			damage:       "d10 (reach, forceful, grabby)",
			instinct:     "to squeeze the life from things",
			cost:         "lives drowned",
		},
	},
};

/** The key in the insert's flags recording which lore followers have been offered (or made) already. */
const OFFERED_FLAG = "postDeathInsert.offered";

/** The lore options already offered (or made) a follower, as stored. */
function offeredKeys(actor) {
	const stored = readableFlags(actor).postDeathInsert?.offered;
	return new Set(Array.isArray(stored) ? stored : []);
}

/** The ids of this character's follower cards made from `sourceUuid`. */
function loreFollowerIds(actor, sourceUuid) {
	return Object.entries(readableFlags(actor).customFollowers ?? {})
		.filter(([, f]) => f?.sourceUuid === sourceUuid).map(([id]) => id);
}

/** Whether this character already has the follower card `sourceUuid` names. */
function hasLoreFollower(actor, sourceUuid) {
	return loreFollowerIds(actor, sourceUuid).length > 0;
}

/**
 * The write that puts the follower `key` names on the Followers tab, as an `actor.update()` fragment, so a
 * caller can land it with what paid for it (the tentacle's 1 Favor). Records the key as made, so taking
 * the option away later asks whether the card goes too. Null, and nothing to write, when the card is
 * already on the tab (a tentacle called forth again is the one already there).
 */
export function callLoreFollowerUpdate(actor, key) {
	const spec = LORE_FOLLOWERS[key];
	if (!spec || hasLoreFollower(actor, spec.sourceUuid)) return null;
	const offered = offeredKeys(actor);
	offered.add(key);
	const id = globalThis.foundry?.utils?.randomID?.(16) ?? `lore${Date.now()}`;
	return {
		[`flags.${SYSTEM_ID}.customFollowers.${id}`]: {
			...buildCustomFollower({ ...spec.follower, name: localize(spec.nameKey), sourceUuid: spec.sourceUuid }),
			order: nextFollowerOrder(readableFlags(actor).customFollowers ?? {}),
		},
		[`flags.${SYSTEM_ID}.${OFFERED_FLAG}`]: [...offered],
	};
}

/** Take one follower card off the Followers tab, through the sheet's own removal when there is a sheet. */
async function removeLoreFollower(actor, id) {
	const sheet = actor?.sheet;
	if (typeof sheet?._removeCustomFollower === "function") return sheet._removeCustomFollower(id);
	const [key, val] = deletionEntry(`flags.${SYSTEM_ID}.customFollowers.${id}`);
	return actor.update({ [key]: val });
}

/**
 * Offer the follower each marked lore option describes (Home to Vermin), on this client, and ask about
 * the card of each one no longer held.
 *
 * ONCE PER MARKING. The offer is recorded when it is made, whichever way it is answered, so the lore
 * writes that follow (another Consequence, the Favor track) do not ask again; the record is dropped
 * when the option is unmarked, so a Consequence cleared and later taken again asks afresh. A character
 * who already has the card is never asked. A `summoned` follower (the tentacle) is never offered here:
 * its own Favor spend makes it.
 *
 * NO LONGER HELD (unmarked, cleared, the insert taken away, or a Revenant become a Ghost, whose prune
 * drops it): the vermin live "in your corpse", and the tentacle comes of the Mark, so a card that was
 * offered or made for the option is asked about once, defaulting to dismiss. Kept, it stays the table's.
 *
 * @param {Actor} actor
 * @param {object} [deps]
 * @param {(o: object) => Promise<boolean|null>} [deps.confirm]  confirmOutcome, for a test
 * @returns {Promise<string[]>}  the lore options whose follower was added
 */
export async function offerLoreFollowers(actor, { confirm = confirmOutcome } = {}) {
	if (actor?.type !== "character" || !actor.isOwner) return [];
	const flags = readableFlags(actor);
	const counts = flags.postDeathLore?.counts ?? {};
	const insert = flags.postDeathInsert?.slug ?? null;
	const offered = offeredKeys(actor);
	const before = offered.size;
	const toAsk = [];
	const toDismiss = [];
	for (const [key, spec] of Object.entries(LORE_FOLLOWERS)) {
		const marked = !!insert && Number(counts[key]) > 0;
		if (!marked) {
			if (offered.delete(key) && hasLoreFollower(actor, spec.sourceUuid)) toDismiss.push([key, spec]);
			continue;
		}
		if (spec.summoned || offered.has(key) || hasLoreFollower(actor, spec.sourceUuid)) continue;
		offered.add(key);
		toAsk.push([key, spec]);
	}
	// Recorded BEFORE asking: the window waits on a person, and every lore write in the meantime would
	// otherwise find the offer still unmade (or the dismissal still unasked) and open a second one.
	if (offered.size !== before || toAsk.length) await actor.setFlag(SYSTEM_ID, OFFERED_FLAG, [...offered]);

	for (const [, spec] of toDismiss) {
		const name = localize(spec.nameKey);
		const dismiss = await confirm({
			title:   localize(`${spec.i18n}.title`),
			content: `<p>${escHtml(format(`${spec.i18n}.dismissAsk`, { name: actor.name ?? "", follower: name }))}</p>`,
			yes:     { label: localize(`${spec.i18n}.dismissYes`), icon: "fa-user-minus" },
			no:      { label: localize(`${spec.i18n}.dismissNo`) },
			defaultYes: true,
		});
		if (!dismiss) continue;
		for (const id of loreFollowerIds(actor, spec.sourceUuid)) await removeLoreFollower(actor, id);
	}

	const added = [];
	for (const [key, spec] of toAsk) {
		const yes = await confirm({
			title:   localize(`${spec.i18n}.title`),
			content: `<p>${escHtml(format(`${spec.i18n}.ask`, { name: actor.name ?? "" }))}</p>`,
			yes:     { label: localize(`${spec.i18n}.yes`), icon: "fa-bug" },
			no:      { label: localize(`${spec.i18n}.no`) },
			defaultYes: true,
		});
		if (!yes) continue;
		// The offer is already recorded above, so the record this write carries lists what is stored.
		const card = callLoreFollowerUpdate(actor, key);
		if (!card) continue;
		await actor.update(card);
		added.push(key);
	}
	return added;
}

// ── Moves made by a press: the Ravenous maw ────────────────────────────────

/** Item flag (under the system scope) on a pressed-for move: the lore option ("marks:ravenous") it needs. */
export const HELD_WHILE_FLAG = "heldWhile";

/**
 * Delete each post-death move made by a press whose lore option is no longer held: a maw left out when
 * Ravenous is unmarked, or the insert is taken away. An insert swap deletes every post-death move
 * itself (StonetopCharacter#setPostDeathInsert). Resolves to the ids deleted.
 */
export async function dropStrayHeldMoves(actor) {
	const flags = readableFlags(actor);
	const counts = flags.postDeathLore?.counts ?? {};
	const insert = flags.postDeathInsert?.slug ?? null;
	const stray = (actor?.items ?? [])
		.filter(i => isPostDeathMove(i) && i.flags?.[SYSTEM_ID]?.[HELD_WHILE_FLAG])
		.filter(i => !insert || !(Number(counts[i.flags[SYSTEM_ID][HELD_WHILE_FLAG]]) > 0))
		.map(i => i._id ?? i.id);
	if (stray.length) await actor.deleteEmbeddedDocuments("Item", stray);
	return stray;
}

// ── The hooks ──────────────────────────────────────────────────────────────

// The insert's own flags and its lore: the slug a swap moves, and the counts a mark or an unmark writes.
const LORE_INPUT = /^flags\.[^.]+\.(postDeathLore|postDeathInsert)(\.|$)/;
const SETTLE_MS = 250;
const pending = new Map();

/** Whether an actor update could change which lore moves a character should own. */
export function mayMoveLoreMoves(changed) {
	const flat = globalThis.foundry?.utils?.flattenObject?.(changed ?? {}) ?? {};
	return Object.keys(flat).some(key => LORE_INPUT.test(key));
}

function isWorldCharacter(actor) {
	return actor?.type === "character" && !actor.pack && !actor.isToken;
}

async function settle(actor, { offer = true } = {}) {
	try {
		await actor.typedActor?.syncPostDeathLoreMoves?.();
		await dropStrayHeldMoves(actor);
		if (offer) await offerLoreFollowers(actor);
	} catch (err) {
		console.error(`Stonetop | could not bring ${actor.name}'s post-death moves into step`, err);
	}
}

/** Re-sync once the lore writes arriving now have settled (a swap is a prune, a delete and a slug). */
function schedule(actor) {
	clearTimeout(pending.get(actor.id));
	pending.set(actor.id, setTimeout(() => {
		pending.delete(actor.id);
		settle(actor);
	}, SETTLE_MS));
}

function onUpdateActor(actor, changed, _options, userId) {
	if (!isWorldCharacter(actor) || userId !== globalThis.game?.user?.id || !actor.isOwner) return;
	if (mayMoveLoreMoves(changed)) schedule(actor);
}

/** Registered once, at module scope in stonetop.js. */
export function registerPostDeathMoveHooks() {
	Hooks.on("updateActor", onUpdateActor);
	// A character who marked one of these before the moves shipped: the primary GM settles every
	// character wearing an insert once on load, one at a time. Most need nothing, which costs a pack read
	// (cached per insert) and no write. No follower offers here: a load is nobody's marking.
	// A swap a reload cut short is repaired by whoever started it, if connected, or else by the primary GM
	// (repairsInsertMovesHere), so a swap still under way is never repaired beside itself.
	Hooks.once("ready", async () => {
		const primaryGM = isPrimaryGM();
		const userId = globalThis.game?.user?.id ?? null;
		const activeUserIds = new Set([...(globalThis.game?.users ?? [])].filter(u => u.active && u.id !== userId).map(u => u.id));
		for (const actor of globalThis.game?.actors ?? []) {
			if (!isWorldCharacter(actor) || !actor.isOwner) continue;
			const flags = readableFlags(actor);
			if (!flags.postDeathInsert?.slug) continue;
			if (repairsInsertMovesHere(flags[INSERT_MOVES_PENDING_FLAG], { userId, primaryGM, activeUserIds })) await repairInsertMoves(actor);
			if (primaryGM) await settle(actor, { offer: false });
		}
	});
	// A Ghost's manifestation ends with a drop to 0 HP or a dispersal, in that same write (manifest.js).
	Hooks.on("preUpdateActor", onPreUpdateActorManifest);
}

/**
 * The load-time repair of a swap a reload cut short (audit RV-6): the worn insert's own moves, made where
 * they are missing. Exported for the tests. Never throws, so one sheet cannot stop the pass.
 */
export async function repairInsertMoves(actor) {
	try {
		return (await actor.typedActor?.syncPostDeathInsertMoves?.()) ?? 0;
	} catch (err) {
		console.error(`Stonetop | could not make ${actor.name}'s missing insert moves`, err);
		return 0;
	}
}
