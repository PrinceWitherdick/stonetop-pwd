/**
 * Permanent tolerance for content that still names an older system id.
 *
 * After the rename, a world carries three kinds of stale reference that the migration
 * either cannot reach or should not rewrite:
 *   - `Compendium.<oldId>.<pack>…` UUIDs pasted into the GM's own prose, and already
 *     serialized into ProseMirror anchors where they are invisible until clicked.
 *   - `systems/<oldId>/…` asset paths on documents, some of which the system uses to
 *     RECOGNISE its own content (map-pin labels, bestiary placeholder portraits).
 *   - `compendiumSource` stamps that four runtime sync channels gate on by prefix.
 *
 * The UUID case is solved outright by Foundry's own redirect table. The others need
 * matchers that accept any historical id, which is what this module provides. Keeping
 * them permanently costs nothing and means a world that is only half migrated, or never
 * migrated, still behaves.
 */

import { SYSTEM_ID, LEGACY_FLAG_SCOPES, ITEM_FLAG_SCOPE, PACK_NAMES } from "../system-id.js";
import { compendiumSourceOf } from "../utils/foundry-compat.js";
import { escapeRegExp } from "../utils/strings.js";

/**
 * Every system id this package has ever shipped under, newest first.
 *
 * Note LEGACY_FLAG_SCOPES also contains "stonetop", which is both a former system id AND
 * the deliberate scope for shipped item content. That overlap is harmless here: this list
 * is only ever used for READ-side matching of pack ids and asset paths.
 */
export const ALL_SYSTEM_IDS = Object.freeze([SYSTEM_ID, ...LEGACY_FLAG_SCOPES]);

/** Historical ids only, i.e. everything except the one currently active. */
export const PRIOR_SYSTEM_IDS = Object.freeze(ALL_SYSTEM_IDS.filter((id) => id !== SYSTEM_ID));

/**
 * Prior ids whose whole flag bag may be COPIED into the active scope.
 *
 * The read-side lists above can afford to be permissive; this one cannot, because it names
 * the scopes something is allowed to WRITE from. ITEM_FLAG_SCOPE is dropped for exactly the
 * reason the note above says is harmless for reading: "stonetop" is both a former system id
 * AND the live scope for shipped compendium content, journal checkbox progress and hover
 * summaries. Copying it wholesale would duplicate pack content onto every item and journal
 * page in the world, so a repair that walked PRIOR_SYSTEM_IDS blindly would damage the very
 * worlds it exists to fix.
 *
 * Actors do still pick that rung up, folded in UNDERNEATH the source bag rather than copied
 * on its own. That is what world-scan's ACTOR_FLAG_OPTIONS is for, and it is safe there
 * because actors are the only documents read through StonetopFlags/resolvedFlags.
 *
 * Empty in the bridge, where the only prior id IS "stonetop", which is the correct answer:
 * there is nothing the bridge can safely copy forward on its own.
 */
export const RESCUABLE_SOURCE_IDS = Object.freeze(PRIOR_SYSTEM_IDS.filter((id) => id !== ITEM_FLAG_SCOPE));

/**
 * Prefix redirects so every stale compendium UUID resolves without rewriting a single
 * stored string. Consumed inside Foundry's parseUuid, so it covers fromUuid, enrichment,
 * embeds and content-link clicks alike.
 */
export function buildUuidRedirects(systemId = SYSTEM_ID, priorIds = PRIOR_SYSTEM_IDS) {
	const redirects = {};
	for (const oldId of priorIds) {
		if (oldId === systemId) continue;
		for (const pack of PACK_NAMES) {
			redirects[`Compendium.${oldId}.${pack}`] = `Compendium.${systemId}.${pack}`;
		}
	}
	return redirects;
}

/** Install the redirects. Call from the init hook, before anything resolves a UUID. */
export function registerUuidRedirects(config = globalThis.CONFIG) {
	if (!config?.compendium) return 0;
	const redirects = buildUuidRedirects();
	Object.assign(config.compendium.uuidRedirects ??= {}, redirects);
	return Object.keys(redirects).length;
}

/**
 * Does a compendium UUID or compendiumSource stamp point at one of OUR packs, under any
 * id this system has used? Compares the tail (`<pack>.<Type>.<id>`) rather than the whole
 * string, so a document seeded before the rename still matches.
 */
export function isOurCompendiumRef(ref, { systemIds = ALL_SYSTEM_IDS, packs = PACK_NAMES } = {}) {
	if (typeof ref !== "string" || !ref.startsWith("Compendium.")) return false;
	const [, packageId, packName] = ref.split(".");
	return systemIds.includes(packageId) && packs.includes(packName);
}

/**
 * The identity of a compendium reference with the package id stripped off, so two stamps
 * that differ only by system id compare equal. This is what stops a seeder re-importing
 * ~180 monsters and ~168 treasures it already imported under the old id.
 */
export function compendiumRefTail(ref) {
	if (typeof ref !== "string" || !ref.startsWith("Compendium.")) return null;
	const parts = ref.split(".");
	// Compendium.<packageId>.<pack>.<DocType>.<id>
	return parts.length >= 5 ? parts.slice(2).join(".") : null;
}

/**
 * The set of package-id-free identities already carried into a world, for a seeder's
 * "did I import this already?" test. Pairs with `compendiumRefTail(packDoc.uuid)` on the
 * pack side; keying on the tail is what stops a re-import of ~180 monsters and ~168
 * treasures in a world seeded under an older id.
 */
export function seededSourceKeys(docs) {
	const keys = new Set();
	for (const doc of docs ?? []) {
		const tail = compendiumRefTail(compendiumSourceOf(doc));
		if (tail) keys.add(tail);
	}
	return keys;
}

/**
 * The world's own copy of each seeded document, by package-id-free identity.
 *
 * `seededSourceKeys` next door answers "has this been imported?"; this answers "and WHICH document
 * is it?", off the same walk and the same key. Built ONCE and asked many times, because the
 * alternative is a `.find()` over `game.actors` per question and this world seeds ~180 monsters
 * and ~168 treasures: an eight-monster encounter deployed that way read ~1,400 compendium sources.
 *
 * The first copy of a tail wins, which is the document a `.find()` would have returned.
 */
export function worldCopiesBySource(docs) {
	const byTail = new Map();
	for (const doc of docs ?? []) {
		const tail = compendiumRefTail(compendiumSourceOf(doc));
		if (tail && !byTail.has(tail)) byTail.set(tail, doc);
	}
	return byTail;
}

/** Matches `@UUID[Compendium.<anyOfOurIds>.…]` in stored prose. */
export function systemLinkPattern(systemIds = ALL_SYSTEM_IDS) {
	const ids = systemIds.map(escapeRegExp).join("|");
	return new RegExp(`@UUID\\[(Compendium\\.(?:${ids})\\.[^\\]]+)\\]`, "g");
}

/** All historical spellings of a system-owned asset path, for building match lists. */
export function systemAssetVariants(suffix, { systemIds = ALL_SYSTEM_IDS } = {}) {
	return systemIds.map((id) => `systems/${id}/${suffix}`);
}
