import {escHtml} from "../utils/strings.js";
import {stonetopChatCard} from "../utils/chat.js";
import {STONETOP_SCOPE, resolvedFlagProperty} from "../actors/character/StonetopFlags.js";
import {isPrimaryGM as _isPrimaryGM} from "../utils/primary-gm.js";
import {STEADING_ACTOR_TYPE, STEADING_DEFAULT_IMG} from "../actors/steading/steading-portrait.js";
import {isGmToolkitData, gmToolkitActors} from "../actors/gmtoolkit/gm-toolkit-actor.js";

const _OMEN_REMINDER_FLAG = "lastOmenReminder";

// Sourced from the shared steading-portrait helper so this bootstrap and the Book art
// re-apply (module/book2-art/reapply.js) can never disagree on the actor type / default img.
const _STEADING_ACTOR_TYPE = STEADING_ACTOR_TYPE;
const _STEADING_ACTOR_NAME = "Stonetop";
const _STEADING_ACTOR_IMG = STEADING_DEFAULT_IMG;
// New worlds get the "S" emblem above as the steading portrait. We deliberately do
// NOT rewrite the image on existing worlds when they upgrade: a group's steading may
// point at their own art, or at the book illustration we used to ship (now removed),
// and silently mutating world data on upgrade is the wrong default. Instead, when the
// stored image is MISSING we swap in the emblem at display time only (see the
// renderActorDirectory hook below): a purely visual fallback that never touches the
// saved actor. An image that still resolves is shown exactly as-is.

export async function ensureStonetopSingleton() {
	if (!game.user.isGM || !_isPrimaryGM()) return;
	const existing = _getStonetopActors().at(0);
	if (existing) {
		await _ensureStartingValues(existing);
		return;
	}

	await Actor.create({
		name: _STEADING_ACTOR_NAME,
		type: _STEADING_ACTOR_TYPE,
		img: _STEADING_ACTOR_IMG,
		// The steading is shared: every player owns it so they can edit it directly
		// (e.g. requisitioning assets, tracking Fortunes) without GM relaying.
		ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
		prototypeToken: {
			texture: { src: _STEADING_ACTOR_IMG },
		},
		system: {
			attributes: {
				surplus: { value: 1 },
			},
		},
	});
}

export function registerStonetopSingletonHooks() {
	Hooks.on("preCreateActor", (actor, data, options) => {
		if (_isStonetopActorData(data ?? actor)) {
			if (!_getStonetopActors().length) return;
			ui.notifications?.warn("This world already has a Stonetop sheet.");
			return false;
		}

		// The GM Toolkit is a singleton for the same reason and by the same mechanism, but on
		// different grounds: the steading is one because the world has one Stonetop, and the
		// toolkit is one because a second would show identical content. Its Moves and Core Loop
		// tabs are reference transcribed from the playbook, its Threats and Sites tabs read their
		// storage off the steading, and its "I wonder..." list is the world's open questions
		// rather than any one GM's — so a second is a second window, not a second sheet, and a
		// second would SPLIT that list. Which toolkit a given GM's "C" key opens is per-user and lives on
		// their User document; that is the thing that actually varies between gamemasters.
		//
		// Vetoed HERE rather than in the Create-Actor picker because this is the only place that
		// catches every path: a macro, a duplicate, a compendium import or a drag-drop all pass
		// through preCreateActor and none of them go near our picker.
		if (isGmToolkitData(data ?? actor)) {
			if (!gmToolkitActors().length) return;
			ui.notifications?.warn("This world already has a GM Toolkit.");
			return false;
		}

		// Players can only ever create their own character. Even if a `monster` type slips
		// past the Create-Actor picker (e.g. a macro), a non-GM must never create a monster
		// stat block (that is GM content), so veto it outright.
		if ((actor?.type ?? data?.type) === "monster" && !game.user?.isGM) {
			ui.notifications?.warn("Only the GM can create monsters.");
			return false;
		}

		// A GM creating a blank Monster from "Create Actor" goes through the guided
		// worksheet instead: veto the empty create and open the builder, which then
		// creates the fully-populated stat block itself.
		if (_shouldGuideMonster(actor, data, options)) {
			_openMonsterBuilder(data);
			return false;
		}
	});

	Hooks.on("preDeleteActor", (actor, options) => {
		if (_isStonetopActorData(actor)) {
			if (_oneWouldRemain(actor, options, _getStonetopActors())) return;
			ui.notifications?.warn("The Stonetop sheet is required and cannot be deleted.");
			return false;
		}

		// Deleting the last toolkit is refused rather than allowed-and-remembered, and that is
		// what keeps the mint gate simple: with deletion impossible, "no toolkit in this world"
		// can only mean "never made one", so the ready hook is a plain find-or-mint with no
		// don't-resurrect-what-somebody-threw-away latch to keep per user. A GM who does not
		// want it on screen can leave it closed; it is not in any player's sidebar (its
		// `ownership.default` is NONE).
		if (isGmToolkitData(actor)) {
			if (_oneWouldRemain(actor, options, gmToolkitActors())) return;
			ui.notifications?.warn("The GM Toolkit is the GM's own sheet and cannot be deleted.");
			return false;
		}
	});

	// Display-only steading portrait fallback for the Actors sidebar. We no longer ship
	// the book illustration older worlds' steading actors point at, and we don't rewrite
	// that world data on upgrade (see the note by _STEADING_ACTOR_IMG). So if a steading's
	// stored image can't load, show the "S" emblem in its directory row instead of a
	// broken thumbnail. Runs for every user (the steading is owned by all).
	Hooks.on("renderActorDirectory", (app, html) => {
		const root = html instanceof HTMLElement
			? html
			: (html?.[0] ?? (app?.element instanceof HTMLElement ? app.element : app?.element?.[0]) ?? null);
		if (!root?.querySelector) return;
		for (const actor of _getStonetopActors()) {
			const row = root.querySelector(`[data-entry-id="${actor.id}"], [data-document-id="${actor.id}"]`);
			_fallBackSteadingImg(row?.querySelector("img"));
		}
	});
}

// Start-of-session reminder: any Would-Be Hero with the Destined background must
// roll +Omens at the start of each session. Foundry has no session event, so we
// fire on world `ready` (primary GM only) and throttle to once per real-world day
// via a flag on the Stonetop singleton; ending a session clears it so a new
// same-day session reminds again.
export async function remindDestinedOmenRoll() {
	if (!_isPrimaryGM()) return;
	if (!game.settings?.get?.(STONETOP_SCOPE, "startOfSessionReminders")) return;
	const destined = game.actors?.filter(a =>
		a.type === "character" && resolvedFlagProperty(a, "background.selected") === "destined") ?? [];
	if (!destined.length) return;

	const steading = _getStonetopActors().at(0);
	const today = new Date().toDateString();
	if (steading?.getFlag(STONETOP_SCOPE, _OMEN_REMINDER_FLAG) === today) return;

	await ChatMessage.create({
		content: _buildOmenReminderContent(destined),
		speaker: { alias: "Stonetop" },
	});
	if (steading) await steading.setFlag(STONETOP_SCOPE, _OMEN_REMINDER_FLAG, today);
}

// Clear the throttle so the next `ready` re-posts the reminder (called at End of Session).
export async function resetOmenReminder() {
	const steading = _getStonetopActors().at(0);
	if (steading?.getFlag(STONETOP_SCOPE, _OMEN_REMINDER_FLAG)) {
		await steading.unsetFlag(STONETOP_SCOPE, _OMEN_REMINDER_FLAG);
	}
}

function _buildOmenReminderContent(destined) {
	const names = destined.map(a => escHtml(a.name)).join(", ");
	return stonetopChatCard("Start of Session: Omen Roll",
		`<div class="stonetop-roll-card-description">
			<p><strong>Destined:</strong> ${names}, roll <strong>+Omens</strong>.</p>
			<ul>
				<li><strong>7+:</strong> lose all Omens; the GM shares a vision or portent that points toward your fate.</li>
				<li><strong>10+:</strong> also ask the GM a follow-up question and get a clear, helpful answer.</li>
				<li><strong>6-:</strong> don't mark XP, hold +1 Omen, and tell us of your recent nightmares or a troubling vision.</li>
			</ul>
		</div>`);
}

// True when this creation is a GM manually making a *blank* Monster and the guided
// builder is enabled — the one path we redirect. Everything else (the worksheet's
// own populated create, compendium imports, drag-drops, duplicates) passes through:
// each of those carries content (items, stats, tags) or an import marker we detect.
function _shouldGuideMonster(actor, data, options) {
	if ((actor?.type ?? data?.type) !== "monster") return false;
	if (!game.user?.isGM) return false;
	if (options?.stonetopMonsterBuilt) return false; // our own finished create
	if (game.settings?.get?.(STONETOP_SCOPE, "monsterBuilderEnabled") === false) return false;
	if (options?.fromCompendium || options?.keepId) return false; // compendium import / drop
	// Duplicates carry no keepId, but their toObject() data reads as content (see
	// _hasMonsterContent: _stats.duplicateSource + populated stats), so they pass through.
	return !_hasMonsterContent(data);
}

// Whether the creation data already carries a built-out monster — populated stats,
// tags, embedded moves, or an import/duplicate provenance marker. A bare "Create Actor"
// click submits only { name, type } (no `system`), so it reads as blank; a Duplicate or
// import submits the source document's full toObject(), which always carries these.
// hp.max is compared to null (not truthy-tested) so a real max of 0 still counts as
// present — an existing stat block that a GM duplicates must not read as "blank".
function _hasMonsterContent(data) {
	const get = path => foundry.utils.getProperty(data ?? {}, path);
	return !!(
		data?.items?.length
		|| get("system.attributes.hp.max") != null
		|| get("system.tags")
		|| get("system.concept")
		|| get("_stats.compendiumSource")
		|| get("_stats.duplicateSource")
		|| get("flags.core.sourceId")
	);
}

async function _openMonsterBuilder(data) {
	try {
		const { CreateMonsterDialog } = await import("../dialogs/CreateMonsterDialog.js");
		await new CreateMonsterDialog({ name: data?.name ?? "", folder: data?.folder ?? null }).promise();
	} catch (err) {
		console.error("Stonetop | failed to open the monster builder", err);
	}
}

// Core evaluates every document in a delete batch against the collection as it stands BEFORE any
// of them go (client-backend.mjs, ClientDatabaseBackend##preDeleteDocumentArray), so a plain "is
// there more than one?" answers yes for BOTH halves of a two-document selection and the world ends
// up with none. Every document in one batch is handed the SAME `options` object, so that object is
// the batch's identity: keyed off it we can remember what we have already let go, and refuse only
// the document whose removal would empty the world.
//
// A WeakMap rather than a property ON `options`: core does `Object.assign(operation, options)` once
// the loop is done and sends the operation to the server, so anything we left there would ride along.
const _released = new WeakMap();

/**
 * Would one of this kind still be left once `actor` has gone?
 *
 * Records the ones we allow, so the last survivor of a multi-select is still refused. Only what
 * we ACTUALLY let go is recorded: a document we refuse is not gone, and must not count as such
 * against the rest of its batch.
 *
 * @param {Actor}  actor    The document being deleted.
 * @param {object} options  The batch's shared delete options; its identity IS the batch. A caller
 *   that passes none (a direct hook invocation) falls back to judging this document alone.
 * @param {Array}  all      Every document of this kind currently in the world.
 */
function _oneWouldRemain(actor, options, all) {
	const others = all.filter(a => a.id !== actor.id);
	if (!options || typeof options !== "object") return others.length > 0;

	let released = _released.get(options);
	if (!released) _released.set(options, released = new Set());
	const remains = others.some(a => !released.has(a.id));
	if (remains) released.add(actor.id);
	return remains;
}

function _getStonetopActors() {
	return game.actors?.filter(actor => _isStonetopActorData(actor)) ?? [];
}

function _isStonetopActorData(actor) {
	return actor?.type === _STEADING_ACTOR_TYPE || actor?.system?.customType === _STEADING_ACTOR_TYPE;
}

async function _ensureStartingValues(actor) {
	const updates = {};
	if (actor.system?.attributes?.surplus?.value === undefined || actor.system.attributes.surplus.value === null) {
		updates["system.attributes.surplus.value"] = 1;
	}
	// NB: the steading image is intentionally left alone here; upgrading worlds keep
	// whatever portrait they have; a missing one falls back to the emblem at display
	// time (renderActorDirectory), not by rewriting the actor.
	// Keep the shared steading owned by all players (preserves any per-user overrides).
	if (actor.ownership?.default !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
		updates["ownership.default"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
	}
	if (Object.keys(updates).length) await actor.update(updates);
}

// Swap a MISSING steading portrait for the "S" emblem in the sidebar, at display time
// only. The `error` event fires just when the file actually fails to load, so a still-
// resolving image (a custom portrait, or the old book file still on disk) is left
// showing untouched. Idempotent per <img> via a data flag so repeated directory
// re-renders don't re-bind. Never writes to the actor.
function _fallBackSteadingImg(img) {
	if (!img || img.dataset.stSteadingFallback) return;
	img.dataset.stSteadingFallback = "1";
	const swap = () => { if (img.getAttribute("src") !== _STEADING_ACTOR_IMG) img.src = _STEADING_ACTOR_IMG; };
	if (img.getAttribute("src") && img.complete && img.naturalWidth === 0) swap();
	else img.addEventListener("error", swap, { once: true });
}
