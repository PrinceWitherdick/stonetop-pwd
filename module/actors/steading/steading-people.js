// Residents & Neighbors of Stonetop are backed by "npc" Actors: each row in the
// steading's `residents`/`neighbors` flag arrays is a {uuid, id, name} pointer to
// an NPC actor, and the row's Occupation / Traits / Relations / Home / Notes cells
// read and write that actor's fields live. This module owns the folders the actors
// live in, the create + resolve helpers the sheet uses, and the load-time sweep that
// converts any plain-text row into an NPC actor.
import { isDefaultImg, stripHtmlToText } from "../../utils/strings.js";
import { resolvePortrait, documentPortraitFrame } from "../../utils/portrait-frame.js";
import { enrichHTML } from "../../utils/foundry-compat.js";
import { npcStatusMeta } from "../../data-models/npc-status.js";
import { getStonetopSteadingActor } from "../../utils/world.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
// The roster's OWN empty-slot face, not the mark the actor wears. These tables are grids of
// 22px avatars, where a column of the actor's dark disc reads as clutter rather than as
// blanks — see utils/person-portrait.js, which owns both and counts either as "no art".
import { PERSON_ROSTER_IMG as EMPTY_MEMBER_AVATAR } from "../../utils/person-portrait.js";
import { SYSTEM_ID } from "../../system-id.js";

// The empty field shape resolvePersonRow returns when a row has no live actor to
// pull from — spread into the no-row and deleted-actor fallbacks so the blank
// template shape lives in one place. `notes` is the plain (stripped) preview text and
// `notesHtml` the enriched rich version the roster cell renders.
const BLANK_PERSON_FIELDS = { occupation: "", traits: "", relations: "", home: "", notes: "", notesHtml: "", resolvedOccupation: "", profileImg: EMPTY_MEMBER_AVATAR, imgStyle: "", status: "", statusLabel: "", statusInactive: false };

// The two Actor folders the people live in. Colours echo the warm parchment palette.
const PEOPLE_FOLDERS = {
	residents: { name: "Residents of Stonetop", color: "#7a5c3e" },
	neighbors: { name: "Neighbors of Stonetop", color: "#5c6b7a" },
};

// Both rosters, in sheet order (residents first) — the order the load-time sweep walks them.
const PEOPLE_LISTS = Object.keys(PEOPLE_FOLDERS);

// Which NPC field each editable column writes to. "name" is the document name; the
// rest are system fields. Home is neighbors-only. "notes" maps to the NPC's rich-text
// `system.notes` — but it is edited through a pop-up ProseMirror editor (see the sheet's
// notes-edit handler / npc-notes-dialog.js), NOT as an inline plain-text cell, so a
// table edit never flattens the field's HTML. Kept here only so legacy (pre-migration)
// plain-text rows, which still use an inline input, stay editable.
const PERSON_FIELD_PATHS = {
	name:       "name",
	occupation: "system.occupation",
	traits:     "system.traits",
	relations:  "system.relations",
	home:       "system.home",
	notes:      "system.notes",
};

const EDITABLE_COLUMNS = {
	residents: ["name", "occupation", "traits", "relations", "notes"],
	neighbors: ["name", "home", "occupation", "traits", "relations", "notes"],
};

/**
 * Where someone lives when their Home says nothing: the village itself. Declared by the module
 * that WRITES the field, so the writers and everything that reads or groups by it agree — a
 * reader with its own copy of the literal is how a Home facet quietly splits into a ""
 * bucket and a "Stonetop" bucket.
 */
export const HOME_STONETOP = "Stonetop";

/** Someone's home for display and grouping — blank means the village itself. */
export function npcHome(npc) {
	return String(npc?.system?.home ?? "").trim() || HOME_STONETOP;
}

/** Update path for a Residents/Neighbors column, or null if the column isn't editable. */
export function personFieldPath(list, field) {
	if (!EDITABLE_COLUMNS[list]?.includes(field)) return null;
	return PERSON_FIELD_PATHS[field] ?? null;
}

/** True when a row points at an NPC actor (post-migration shape) rather than legacy text. */
export function isActorRow(row) {
	return !!(row && (row.uuid || row.id));
}

/**
 * The live Actor behind a roster row, or null. Id first — a direct collection hit — with the
 * uuid as the fallback for a row written before ids were stored.
 *
 * One copy of the precedence, because five callers depended on it agreeing (the roster resolve,
 * the people list, the used-portrait scan, the home backfill, and the framing handle, whose doc
 * comment promises "the same id-then-uuid chain the roster's popout binding uses"). Preferring
 * uuid instead — so a compendium-moved NPC resolves — is then one edit rather than five.
 *
 * `fromUuidSync` is tried before the scan because `game.actors.find(a => a.uuid === …)` builds a
 * uuid string for every actor in the world on every miss, and a seeded world holds ~200 bestiary
 * actors before the roster starts. It is guarded on the result being a real world Actor: given a
 * pack uuid it hands back an index row, which is not a document and must not be treated as one.
 * Absent (headless tests), the scan still answers.
 */
export function personRowActor(row) {
	if (!isActorRow(row)) return null;
	if (row.id) {
		const byId = game.actors?.get(row.id);
		if (byId) return byId;
	}
	if (!row.uuid) return null;
	const direct = globalThis.fromUuidSync?.(row.uuid);
	if (direct?.documentName === "Actor" && !direct.pack) return direct;
	return game.actors?.find(a => a.uuid === row.uuid) ?? null;
}

/**
 * Identity key for matching an incoming person against the rows already on a roster:
 * lowercased `name|home`. Actor-backed rows keep Home on the NPC and only cache the name on
 * the row, so each is read the way it stores it — key an actor row off the row alone and
 * every linked neighbor reads as home-less, so a background that names someone already
 * listed would add them a second time.
 *
 * A plain `{name, home}` addition (a background's neighbor, an Add-Member worksheet's
 * fields) keys through the same function via the legacy branch, so both sides of a
 * comparison are built the same way.
 */
export function personRowKey(row) {
	const actor = personRowActor(row);
	const name = String((actor ? actor.name : row?.name) ?? "").trim().toLowerCase();
	const home = String((actor ? actor.system?.home : row?.home) ?? "").trim().toLowerCase();
	return `${name}|${home}`;
}

/**
 * What a roster row IS, stable across a write: the actor it points at, or — for a legacy text
 * row — its name. Deliberately not personRowKey, which reads Home off the live NPC: filling a
 * neighbor's origin in changes their key, so a replacement worked out before that write would
 * no longer find the row it was made for. This one survives both that and the text→pointer
 * conversion of the row NEXT to it.
 */
export function personRowIdentity(row) {
	return String(row?.uuid || row?.id || row?.name || "").trim().toLowerCase();
}

/**
 * Re-apply a batch of row replacements and additions to a roster as it stands NOW.
 *
 * Both the load-time sweep and a background's neighbor list have to create Actors before they
 * can write their rows, and every one of those creates is an await. A steading write landing in
 * that window — a second player finishing onboarding, a GM ticking someone off — is on the
 * document by the time the batch is ready, and writing the array it read BEFORE the first await
 * would silently revert it. So the work is decided against the old rows and applied against the
 * new ones: rows nobody touched are kept exactly as they now stand, and an addition somebody
 * else already made in the meantime is not made twice.
 *
 * Each entry in `replacements` is a QUEUE, taken from in row order, because two people on the
 * roster can share an identity: a steading with two text rows both reading "Ennis" gets two
 * NPCs, and each row must be pointed at its own. A single-element queue is the ordinary case.
 *
 * @param {object[]} live      the rows currently on the steading
 * @param {Map<string, object[]>} replacements  personRowIdentity -> what to put there, in order
 * @param {object[]} [additions]  rows to append, skipped if that person is already listed
 * @returns {object[]} the rows to write
 */
export function rebasePersonRows(live, replacements, additions = []) {
	// shift(), so the queue is consumed: a second row of the same name takes the next entry, and
	// a row with none left is passed through untouched.
	const queued = new Map([...replacements].map(([identity, rows]) => [identity, [...rows]]));
	const out = live.map(row => queued.get(personRowIdentity(row))?.shift() ?? row);
	const seen = new Set(out.map(personRowIdentity));
	for (const row of additions) {
		const identity = personRowIdentity(row);
		if (seen.has(identity)) continue;
		seen.add(identity);
		out.push(row);
	}
	return out;
}

/**
 * Distinct, non-empty names of a steading's Residents + Neighbors, for name-suggestion
 * datalists (e.g. Create-a-Follower). Reads the nested `stonetop-pwd.steading` flag where
 * the people rows actually live — the flat `getFlag(…, "residents")` path is never written.
 * Best-effort: a missing/unlinked steading (or any read error) just yields [].
 *
 * The optional chaining above already covers "no steading", so the catch only ever fires on
 * something genuinely unexpected — and an empty list is indistinguishable from "this steading
 * has nobody". Log it, or a broken read looks exactly like an empty village.
 */
export function peopleNames(steading) {
	try {
		const flags = steading?.getFlag?.(SYSTEM_ID, "steading") ?? {};
		const rows = Object.keys(PEOPLE_FOLDERS).flatMap(list => Array.isArray(flags[list]) ? flags[list] : []);
		return [...new Set(rows.map(r => String(r?.name ?? "").trim()).filter(Boolean))];
	} catch (err) {
		console.error("Stonetop | could not read the steading's people names", err);
		return [];
	}
}

/**
 * The live NPC Actors behind a steading's Residents + Neighbors rows, in sheet order
 * (residents first), deduped. Skips legacy plain-text rows and rows whose actor was
 * deleted, since both lack an actor to rate. Backs the character sheet's Relationships
 * section, which offers everyone on the steading sheet as a rateable row.
 * Best-effort: a missing/unlinked steading (or any read error) just yields [].
 *
 * Logged for the same reason as peopleNames: this backs the character sheet's Relationships
 * section, where a swallowed failure reads as "this steading has no people" and the player
 * simply loses the section with no clue why.
 */
export function steadingPeopleActors(steading) {
	try {
		const flags = steading?.getFlag?.(SYSTEM_ID, "steading") ?? {};
		const seen = new Set();
		const people = [];
		for (const list of Object.keys(PEOPLE_FOLDERS)) {
			for (const row of Array.isArray(flags[list]) ? flags[list] : []) {
				const actor = personRowActor(row);
				if (!actor || seen.has(actor.id)) continue;
				seen.add(actor.id);
				people.push(actor);
			}
		}
		return people;
	} catch (err) {
		console.error("Stonetop | could not resolve the steading's people actors", err);
		return [];
	}
}

/**
 * Which portraits the steading's people already wear, as `{ src -> the name wearing it }`.
 * Backs the People gallery's "already assigned" marking and its unused-only filter, so a GM
 * outfitting a whole village doesn't hand the same face to three residents without noticing.
 *
 * Actor-backed rows keep their portrait on the NPC actor, legacy text rows on the row itself,
 * so both are read the way each stores it. Default avatars never count: every unportraited
 * member shares one, which is the opposite of taken. `exclude` drops the row being edited, so
 * the member's own portrait is reported as theirs (the gallery's selected state) rather than
 * as taken by somebody else.
 * Best-effort: a missing/unlinked steading (or any read error) just yields {}.
 *
 * @param {Actor} steading
 * @param {{list?: string, index?: number}} [exclude]  the row currently being edited, if any
 * @returns {Record<string, string>}
 */
export function usedPersonPortraits(steading, exclude = {}) {
	try {
		const flags = steading?.getFlag?.(SYSTEM_ID, "steading") ?? {};
		const used = {};
		for (const list of Object.keys(PEOPLE_FOLDERS)) {
			const rows = Array.isArray(flags[list]) ? flags[list] : [];
			rows.forEach((row, index) => {
				if (list === exclude.list && index === exclude.index) return;
				const actor = personRowActor(row);
				const img = (actor ? actor.img : row?.img) ?? "";
				// isDefaultImg covers the people placeholder as well as Foundry's own defaults,
				// so an art-less member never marks a gallery face as taken.
				if (!img || isDefaultImg(img)) return;
				const name = String((actor ? actor.name : row?.name) ?? "").trim();
				// First row in wins the label: when two people share a portrait the gallery only
				// needs to say it is spoken for, and naming one of them is enough to find it.
				used[img] ??= name || "another member";
			});
		}
		return used;
	} catch { return {}; }
}

/**
 * Resolve one Residents/Neighbors row to the display shape the template expects.
 * Actor-backed rows pull their fields live off the linked NPC; legacy text rows (or
 * a row whose actor was deleted) fall back to the row's own stored fields so nothing
 * silently vanishes before/without migration. Always returns an object (never drops a
 * slot) so the resolved array stays index-aligned with the stored flag array — the
 * template's @index is what edits/deletes target.
 *
 * Async because the Notes cell shows the NPC's rich `system.notes` enriched (@UUID
 * links etc.); `notes` is the plain stripped text (tooltip / legacy input), `notesHtml`
 * the rendered rich version.
 *
 * @param {object} row   a residents/neighbors flag entry
 * @returns {Promise<object>} display row
 */
export async function resolvePersonRow(row) {
	if (!row) return { ...BLANK_PERSON_FIELDS, name: "" };
	if (isActorRow(row)) {
		const actor = personRowActor(row);
		if (!actor) {
			// Actor deleted out from under the row: show the cached name so the GM can
			// notice and re-link/remove it, rather than an empty row.
			return { ...BLANK_PERSON_FIELDS, uuid: row.uuid ?? "", id: row.id ?? "",
				name: row.name ?? "", unresolved: true, checked: !!row.checked };
		}
		const s = actor.system ?? {};
		const occupation = s.occupation ?? "";
		// Lifecycle status → an at-a-glance badge + dim/strike in the roster name cell.
		const status = npcStatusMeta(s.status);
		const actorPortrait = resolvePortrait(
			isDefaultImg(actor.img) ? EMPTY_MEMBER_AVATAR : actor.img,
			documentPortraitFrame(actor)
		);
		return {
			uuid:       actor.uuid,
			id:         actor.id,
			name:       actor.name,
			occupation,
			traits:     s.traits ?? "",
			relations:  s.relations ?? "",
			home:       s.home ?? "",
			notes:      stripHtmlToText(s.notes),
			notesHtml:  await enrichHTML(s.notes ?? ""),
			resolvedOccupation: occupation,
			// Resolved against what the roster actually RENDERS: an art-less NPC shows the
			// placeholder, and a frame stamped against actor.img must not be applied to that.
			profileImg: actorPortrait.src,
			imgStyle:   actorPortrait.style,
			checked:    !!row.checked,
			unresolved: false,
			status:         status.value,
			statusLabel:    status.label,
			statusInactive: status.inactive,
		};
	}
	// Legacy plain-text row: pass through, filling the shape the template reads.
	const legacyNotes = row.notes ?? row.etc ?? "";
	// Computed here rather than left to the `...row` spread, which would otherwise leak the raw
	// rect object into the template context under `portraitFrame`.
	const rowPortrait = resolvePortrait(
		!isDefaultImg(row.img ?? "") ? row.img : EMPTY_MEMBER_AVATAR,
		row?.portraitFrame
	);
	return {
		...row,
		occupation: row.occupation ?? "",
		traits:     row.traits ?? "",
		relations:  row.relations ?? "",
		home:       row.home ?? "",
		notes:      legacyNotes,
		notesHtml:  await enrichHTML(legacyNotes),
		resolvedOccupation: row.occupation ?? "",
		profileImg: rowPortrait.src,
		imgStyle:   rowPortrait.style,
		legacy:     true,
		status:     "", statusLabel: "", statusInactive: false,
	};
}

/**
 * Find (or, for a GM, create) the Actor folder for a people list. Folder creation is a
 * GM/assistant privilege players lack, so a player who adds the first-ever resident when
 * the folder doesn't exist yet must not throw: return null and let the NPC land at the
 * sidebar root instead. The GM proactively creates both folders on load (see
 * ensurePeopleFolders), so this fallback is rare — the folder is normally already there.
 */
export async function ensurePeopleFolder(list) {
	const spec = PEOPLE_FOLDERS[list];
	return spec ? ensureNamedActorFolder(spec) : null;
}

/**
 * Find-or-create one named Actor folder, returning null rather than throwing when it cannot
 * be made. Shared with the follower drop (hooks/FollowerDrop.js), which files its own folder
 * the same way.
 *
 * The permission gate is the point: a PLAYER has no folder-create right, and the callers here
 * are all things a player does (adding a roster member, dropping a follower on the canvas). An
 * actor that lands unfiled at the sidebar root is a far better outcome than a failed drop, so
 * this never propagates — one copy of that rule, since a fix to it has to reach both callers.
 *
 * @param {{name: string, color?: string}} spec
 * @returns {Promise<Folder|null>}
 */
export async function ensureNamedActorFolder({ name, color }) {
	const existing = game.folders?.find(f => f.type === "Actor" && f.name === name);
	if (existing) return existing;
	if (!Folder.canUserCreate(game.user)) return null; // player: no folder-create right
	try {
		return await Folder.create({ name, type: "Actor", color });
	} catch (err) {
		console.warn(`Stonetop | Could not create the "${name}" folder; the actor will land at root.`, err);
		return null;
	}
}

/** Ensure both Residents/Neighbors Actor folders exist. GM-only; run once on load so a
 *  player adding the first member never has to create the folder (which they can't). */
export async function ensurePeopleFolders() {
	if (!game.user?.isGM) return;
	for (const list of Object.keys(PEOPLE_FOLDERS)) {
		try { await ensurePeopleFolder(list); }
		catch (err) { console.error("Stonetop | ensurePeopleFolders failed for", list, err); }
	}
}

/** Name for a person the worksheet left unnamed, per the roster they're joining. */
const DEFAULT_PERSON_NAMES = { residents: "New Resident", neighbors: "New Neighbor" };

/**
 * Create an NPC actor for a person from the Add-Member worksheet's field data and return
 * it. `list` is the steading roster they belong to, or null for someone on neither (the
 * sidebar "Create Actor" picker's "Someone else"). The roster lists carry what being on
 * the — often player-visible — steading sheet implies: the people folder and OBSERVER
 * ownership. A loose NPC is GM prep, so it keeps Foundry's default ownership and lands in
 * whichever sidebar folder was open. Either way its token still shows its name on hover
 * (StonetopActor#_preCreate).
 *
 * @param {"residents"|"neighbors"|null} list
 * @param {object} data  { name, occupation, traits, relations, home, notes, img }
 * @param {object} [options]
 * @param {string|null} [options.folder]  Folder for a loose NPC; roster NPCs use their own.
 */
export async function createPersonNpc(list, data = {}, { folder = null } = {}) {
	const system = {
		occupation: data.occupation ?? "",
		traits:     data.traits ?? "",
		relations:  data.relations ?? "",
		// The roster row's note seeds the NPC's `notes` field. Legacy rows stored it under
		// `notes`/`etc`, so fall back to both so migration carries that text over instead
		// of dropping it.
		notes:      data.notes ?? data.etc ?? "",
		home:       data.home ?? "",
	};
	// Residents live in Stonetop by definition, so seed their Home with "Stonetop"
	// (the NPC sheet shows it; a specific home can still be typed to override). A
	// non-blank home carried in by migration is respected.
	if (list === "residents") system.home = system.home.trim() || HOME_STONETOP;
	const createData = {
		name: data.name?.trim() || DEFAULT_PERSON_NAMES[list] || "New Person",
		type: "npc",
		system,
		folder: (list ? (await ensurePeopleFolder(list))?.id : folder) ?? null,
	};
	// Residents/Neighbors are shown on the (often player-visible) steading sheet, so
	// players should be able to see them — unlike GM-prep monsters/threats. Default
	// OBSERVER keeps the steading rows rendering for players as they did pre-migration.
	if (list) createData.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
	if (data.img && !isDefaultImg(data.img)) {
		createData.img = data.img;
		// Carry a legacy row's chosen frame onto the NPC it becomes. Without this,
		// migrateSteadingPeople would drop it: that runs GM-only and one-shot behind a flag, so
		// the loss would happen silently on the GM's next load with nothing to notice. Only
		// written when there IS one — an explicit null would be a key every read then has to
		// special-case.
		if (data.portraitFrame) createData.flags = { [SYSTEM_ID]: { portraitFrame: data.portraitFrame } };
	}
	return Actor.create(createData);
}

/**
 * Create the NPC for a Residents/Neighbors entry AND file it on the steading's roster,
 * so the row and its actor are always made together. Used by the steading sheet's
 * "+ Add" buttons and by the sidebar "Create Actor" picker, which can add a resident or
 * neighbor without the steading sheet being open.
 *
 * The roster row is a {uuid, id, name} pointer (see resolvePersonRow); everything the
 * row displays is read live off the actor. A steading that can't be found (or can't be
 * written to) still leaves the NPC behind — better an unlisted actor than a lost one, and
 * the row can be re-linked by dragging the actor onto the section.
 *
 * @param {"residents"|"neighbors"} list
 * @param {object} data      { name, occupation, traits, relations, home, notes, img }
 * @param {Actor} [steading] The steading to file the row on; defaults to the world's.
 * @returns {Promise<Actor|null>}  The new NPC.
 */
export async function addPersonToSteading(list, data = {}, steading = null) {
	const actor = await createPersonNpc(list, data);
	if (!actor) return null;
	await (steading ?? getStonetopSteadingActor())?.typedActor?.addPersonRow(list, actor);
	return actor;
}

/**
 * File a player character on the steading's Player Characters roster, if they aren't
 * already listed.
 *
 * Called when a player finishes character creation (StonetopCharacterSheet#_launchOnboarding),
 * whichever door they came in by — the GM's Welcome guide, the sidebar's Create Actor
 * picker, or the sheet's own "Create Character" button. Before this, the only way onto the
 * roster was for someone to drag the sheet onto the steading, so a character made outside
 * the first-session flow quietly never appeared in the village.
 *
 * Runs on the finishing PLAYER's client, not the GM's: the steading is owned by everyone
 * (hooks/StonetopSingleton.js#_ensureStartingValues), so they can write the row themselves
 * and it lands whether or not a GM is connected. A world whose GM has narrowed that
 * ownership fails the permission check and we simply don't file them — the drag stays
 * available, and a failed write must never be what a player sees at the end of creation.
 *
 * @param {Actor} actor        the finished character
 * @param {Actor} [steading]   the steading to file them on; defaults to the world's
 * @returns {Promise<boolean>} whether a row was added (false if already listed, no
 *                             steading, or not permitted)
 */
export async function addCharacterToSteadingPlayers(actor, steading = null) {
	if (actor?.type !== "character") return false;
	const target = steading ?? getStonetopSteadingActor();
	if (!target?.canUserModify?.(game.user, "update")) return false;
	try {
		return await target.typedActor?.addPlayerRow?.(actor) ?? false;
	} catch (err) {
		console.warn("Stonetop | Could not add", actor?.name, "to the steading's Player Characters roster.", err);
		return false;
	}
}

/**
 * Convert a steading's plain-text Residents/Neighbors rows into NPC actors, rewriting each
 * row as a {uuid, id, name} pointer. Rows that already point at an actor are left alone (so
 * re-running is a no-op) and blank rows are dropped. GM-only — it creates actors and writes
 * the steading flags.
 *
 * Runs on EVERY load, not once. It began as a one-shot schema migration, but plain-text rows
 * can still be written after it by a client that cannot create an Actor — a world whose GM
 * revoked the ACTOR_CREATE permission this system grants players
 * (Ready.js#_ensurePlayerActorCreationGrant) leaves a background's neighbors as text, and
 * they wait here. The old `peopleMigrated` one-shot flag stranded exactly those rows forever
 * — it was set by the first conversion, after which nothing ever converted again — so it is
 * no longer read or written. Worlds still carrying it are unaffected; nothing else reads it.
 *
 * @param {Actor} steading  an Actor of type "stonetop"
 * @returns {Promise<number>} how many rows were converted
 */
export async function migrateSteadingPeople(steading) {
	if (!game.user?.isGM || steading?.type !== "stonetop") return 0;
	// The steading stores its lists nested under flags.stonetop-pwd.steading (see
	// StonetopSteading#_flags / setFlags), so read and rewrite that sub-object rather than the
	// top-level scope. Read through a function, not into a variable: everything below the scan
	// awaits, and the rows have to be re-read once those awaits are done.
	const readRows = list => {
		const rows = steading.flags?.[SYSTEM_ID]?.steading?.[list];
		return Array.isArray(rows) ? rows : [];
	};
	// Cheap scan before anything else: the steady state is "every row already points at an
	// actor", and paying for that answer on every steading write must not cost more than two
	// array walks. A blank slot has no uuid either, so it lands here too and gets pruned below.
	if (!PEOPLE_LISTS.some(list => readRows(list).some(row => !isActorRow(row)))) return 0;

	// Every await lives in this first pass: make the NPCs, remembering which row each was made
	// for. Nothing is written to the steading yet, so there is no snapshot in flight to go stale.
	const conversions = new Map(PEOPLE_LISTS.map(list => [list, new Map()]));
	let converted = 0;
	for (const list of PEOPLE_LISTS) {
		for (const row of readRows(list)) {
			if (isActorRow(row)) continue;
			const name = (row?.name ?? "").trim();
			if (!name) continue; // blank slot: nobody to make, and pruned below
			const actor = await createPersonNpc(list, row).catch(err => {
				console.error("Stonetop | Could not create the NPC for roster row", name, err);
				return null;
			});
			// Creation failed (a full disk, a world going down mid-load): leave the text row
			// alone rather than dropping the person, and let the next sweep try again — which it
			// now will, since this is no longer one-shot.
			if (!actor) continue;
			// Queued, not set: two text rows can carry the same name, and each is owed the NPC
			// made for it rather than both landing on the last one.
			const queue = conversions.get(list);
			const identity = personRowIdentity(row);
			if (!queue.has(identity)) queue.set(identity, []);
			queue.get(identity).push({ uuid: actor.uuid, id: actor.id, name: actor.name, checked: !!row.checked });
			converted++;
		}
	}

	// Second pass, no awaits until the write: rebase onto the rows as they stand now. This runs
	// live on the primary GM's client (onSteadingPeopleUpdate) as well as at load, so a Surplus
	// click or a Notes save landing during those creates is a real possibility — writing back a
	// whole pre-await copy of the steading flags would undo it. Only the two people lists are
	// written, and each is built from what is on the document at this moment.
	const update = {};
	for (const list of PEOPLE_LISTS) {
		const live = readRows(list);
		const rows = rebasePersonRows(live, conversions.get(list))
			.filter(row => isActorRow(row) || (row?.name ?? "").trim());
		// Nothing converted and nothing blank to prune: leave the list out entirely rather than
		// re-writing an identical array, which would broadcast an update for no reason.
		if (rows.length !== live.length || rows.some((row, i) => row !== live[i])) update[list] = rows;
	}
	if (Object.keys(update).length) await steading.setFlag(SYSTEM_ID, "steading", update);
	return converted;
}

/** Sweep every steading in the world (GM ready hook). */
export async function migrateAllSteadingPeople() {
	if (!game.user?.isGM) return;
	const steadings = (game.actors?.contents ?? []).filter(a => a.type === "stonetop");
	for (const s of steadings) {
		try { await migrateSteadingPeople(s); }
		catch (err) { console.error("Stonetop | migrateSteadingPeople failed for", s?.name, err); }
	}
}

// Steadings a sweep is mid-flight on. Two updates landing while the first pass is still
// awaiting its Actor.create calls would both see the same text rows and both convert them,
// leaving the roster with two of everybody — so a second pass stands down and lets the one
// already running finish the job.
const _sweepsInFlight = new Set();

/**
 * Convert a steading's text rows the moment they appear, on the primary GM's client.
 *
 * Normally there is nothing to do: players hold the ACTOR_CREATE permission this system
 * grants them, so whoever fills in a roster row creates its NPC themselves. This is the
 * backstop for a world whose GM revoked that permission, where a background's neighbors (the
 * Ranger's Wide Wanderer names five) land as plain text instead. `updateActor` broadcasts to
 * every connected client, so the GM's sees that write and converts them within a moment — no
 * socket and no reload. The ready-hook sweep is the further catch-up, for rows written while
 * no GM was connected at all.
 *
 * Deliberately unfiltered on WHICH part of the steading changed: the payload's shape depends
 * on how the write was made, and migrateSteadingPeople already opens with a scan of two small
 * arrays and returns without writing when there is nothing to do. Guessing at the diff would
 * buy nothing and could miss a write.
 *
 * Terminates: the conversion's own flag write re-fires this hook, and that pass finds every
 * row already pointing at an actor, so it returns without writing again.
 */
export async function onSteadingPeopleUpdate(actor) {
	if (actor?.type !== "stonetop" || !game.user?.isGM || !isPrimaryGM()) return;
	if (_sweepsInFlight.has(actor.id)) return;
	_sweepsInFlight.add(actor.id);
	try { await migrateSteadingPeople(actor); }
	catch (err) { console.error("Stonetop | Live Residents/Neighbors → NPC conversion failed for", actor?.name, err); }
	finally { _sweepsInFlight.delete(actor.id); }
}

/**
 * Repaint any open steading sheet whose roster lists this actor.
 *
 * The roster renders LIVE off the linked actors, not off the snapshot stored in the row:
 * an NPC's name, occupation, traits, relations and rich-notes preview on the Residents /
 * Neighbors lists, and a character's name, portrait and playbook on the Players list.
 * Foundry only auto-re-renders a sheet when ITS OWN document changes, so editing the NPC
 * on its own sheet — or swapping a character's picture — would leave an open steading
 * showing the old values until an F5. Serves both `updateActor` and `deleteActor`; on a
 * deletion the row is still there to match on, and the repaint drops it to its cached
 * fallback rather than leaving a person on the roster who no longer exists.
 *
 * Matching mirrors how each list resolves its actor when the sheet builds its rows:
 * NPC rows strictly by uuid/id (see resolvePersonRow), Player rows by id with a name
 * fallback, since a row added before the drag handler stamped an id carries only a name.
 *
 * Additive only — it never suppresses a render, so it can't fight any other sync path.
 *
 * @param {Actor} actor  the actor that just changed
 */
export function repaintOpenSteadingRosters(actor) {
	if (actor?.type !== "npc" && actor?.type !== "character") return;
	const { uuid, id } = actor;
	const isPlayer = actor.type === "character";
	const lists = isPlayer ? ["players"] : ["residents", "neighbors"];
	const lowerName = isPlayer ? String(actor.name ?? "").toLowerCase().trim() : "";
	// Skipped in the loop rather than filtered into a list of their own: this now serves
	// `character` as well as `npc`, and a character update is the most frequent document write in
	// play (harm, XP, hold, roll mode…), so every one of them would otherwise build a second copy
	// of the actor list before finding the one steading in it.
	for (const steading of (game.actors?.contents ?? [])) {
		if (steading.type !== "stonetop") continue;
		const openApps = Object.values(steading.apps ?? {});
		if (!openApps.length) continue;
		const people = steading.flags?.[SYSTEM_ID]?.steading ?? {};
		const rows = lists.flatMap(list => people[list] ?? []);
		const listed = rows.some(r =>
			(r?.uuid && r.uuid === uuid) ||
			(r?.id && r.id === id) ||
			(lowerName && String(r?.name ?? "").toLowerCase().trim() === lowerName));
		if (!listed) continue;
		for (const app of openApps) app?.render?.(false);
	}
}

/**
 * One-time, idempotent backfill: give every already-linked Resident-of-Stonetop NPC
 * whose Home is blank the value "Stonetop" (residents live there by definition). New
 * residents get this at creation via createPersonNpc; this catches those linked before
 * that default existed. Residents with a specific Home already typed are left alone.
 * GM-only; guarded by its own steading flag so it runs once even on already-migrated
 * worlds. Uses setFlag, which merges — the flag write keeps the residents list intact.
 *
 * @param {Actor} steading  an Actor of type "stonetop"
 * @returns {Promise<number>} how many resident NPCs were updated
 */
export async function backfillResidentHomes(steading) {
	if (!game.user?.isGM || steading?.type !== "stonetop") return 0;
	if (steading.flags?.[SYSTEM_ID]?.steading?.residentHomesBackfilled) return 0;
	const rows = steading.flags?.[SYSTEM_ID]?.steading?.residents;
	let updated = 0;
	for (const row of (Array.isArray(rows) ? rows : [])) {
		const actor = personRowActor(row);
		if (!actor || actor.type !== "npc") continue;
		if (String(actor.system?.home ?? "").trim()) continue;
		try { await actor.update({ "system.home": HOME_STONETOP }); updated++; }
		catch (err) { console.warn("Stonetop | Could not backfill Home for", actor?.name, err); }
	}
	await steading.setFlag(SYSTEM_ID, "steading", { residentHomesBackfilled: true });
	return updated;
}

/** Backfill resident Homes across every steading in the world (GM ready hook). */
export async function backfillAllResidentHomes() {
	if (!game.user?.isGM) return;
	const steadings = (game.actors?.contents ?? []).filter(a => a.type === "stonetop");
	for (const s of steadings) {
		try { await backfillResidentHomes(s); }
		catch (err) { console.error("Stonetop | backfillResidentHomes failed for", s?.name, err); }
	}
}
