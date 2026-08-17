// Cross-reference index for bestiary prose.
//
// Maps creature names (plus a few natural variants — a stripped leading "The",
// a comma-prefix, an optional trailing plural "s") to the UUID + one-line
// `concept` of the monster that best represents them. A world actor wins over
// the compendium copy, so a click opens the user's own copy when they have one.
//
// Built lazily from the `stonetop-bestiary` compendium index + any world
// monster actors, then cached for the session. Call
// invalidateMonsterRefIndex() when bestiary actors are created/updated/deleted.

import { CREATURE_LINK_DENYLIST } from "./creature-link-denylist.js";
import { BESTIARY_PACK } from "../system-id.js";
import { escapeRegExp } from "../utils/strings.js";
import { ensurePackIndex } from "../utils/pack-index.js";

const PACK_ID = BESTIARY_PACK;
const ENTRY_SUFFIX = /\s*\(Bestiary\)\s*$/i;

let _index = null; // Map<normalizedName, { uuid, name, concept, priority }>
let _regex = null; // compiled matcher, or null when the index is empty

const _norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Creature names too generic to auto-link, or that collide with a lore/location
// entry of the same name. A whole creature is excluded by full name (mirroring
// the build-time linkifier), so its stripped variants never register either —
// e.g. "The Guard" would otherwise register the bare word "guard" and link every
// incidental "guard" in prose. Drawn from the shared canonical list (Title-case,
// case-sensitive for the linkifier) and normalized here for case-insensitive lookup.
const _DENYLIST = new Set(CREATURE_LINK_DENYLIST.map(_norm));

/** The creature name without the " (Bestiary)" entry suffix. */
export function creatureDisplayName(name) {
	return String(name ?? "").replace(ENTRY_SUFFIX, "").trim();
}

// Register a name and its natural variants at a priority; higher priority wins ties.
function _register(map, rawName, rec) {
	const base = _norm(rawName);
	if (!base) return;
	const variants = new Set([base]);
	const noThe = base.replace(/^the\s+/, "");
	if (noThe) variants.add(noThe);
	const beforeComma = base.split(",")[0].trim();
	if (beforeComma) variants.add(beforeComma);
	for (const v of variants) {
		const existing = map.get(v);
		if (!existing || rec.priority > existing.priority) map.set(v, rec);
	}
}

function _addActorLike({ name, type, uuid, concept }, map, basePriority) {
	if (type !== "monster") return;
	const display = String(name ?? "").trim();
	if (!display || !uuid) return;
	if (_DENYLIST.has(_norm(display))) return; // generic / colliding name — never auto-link
	_register(map, display, {
		uuid,
		name: display,
		concept: String(concept ?? "").trim(),
		priority: basePriority,
	});
}

function _compileRegex(map) {
	const names = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
	if (!names.length) return null;
	// Word-ish boundaries that treat apostrophes/hyphens as part of a word (so we
	// don't match a name fragment mid-word), plus an optional trailing plural "s".
	return new RegExp(`(?<![\\w'’-])(${names.join("|")})(s)?(?![\\w'’-])`, "gi");
}

/** Build (or return the cached) name index. */
export async function buildMonsterRefIndex() {
	if (_index) return _index;
	const map = new Map();

	try {
		const pack = await ensurePackIndex(PACK_ID, ["type", "system.concept"]);
		if (pack) {
			for (const e of pack.index) {
				const uuid = e.uuid ?? `Compendium.${pack.collection}.Actor.${e._id}`;
				_addActorLike({ name: e.name, type: e.type, uuid, concept: e.system?.concept }, map, 0);
			}
		}
	} catch (_e) { /* pack unavailable — fall back to world actors only */ }

	for (const a of globalThis.game?.actors ?? []) {
		_addActorLike({ name: a.name, type: a.type, uuid: a.uuid, concept: a.system?.concept }, map, 10);
	}

	_index = map;
	_regex = _compileRegex(map);
	return _index;
}

/** The compiled matcher (capture group 1 = the matched name), or null. */
export function getMonsterRefRegex() {
	return _regex;
}

/** Resolve a matched name back to its index record, or null. */
export function lookupMonsterRef(name) {
	return _index?.get(_norm(name)) ?? null;
}

/** Drop the cache so the next lookup rebuilds it. */
export function invalidateMonsterRefIndex() {
	_index = null;
	_regex = null;
}
