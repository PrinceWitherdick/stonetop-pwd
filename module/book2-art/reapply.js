import { getSetting, setSetting } from "../settings.js";
import { info, error } from "../utils/logger.js";
import { BOOK2_ART_APPLY_MANIFEST } from "./manifest.js";
import { bestiaryDescriptionWithArt, codexFieldWithArt, locationSectionsWithArt, textPageWithManagedMap, matchWorldPage } from "./world-journal-art.js";
import { managedHash } from "../hooks/journal-sync-core.js";
import { compendiumSourceOf } from "../utils/foundry-compat.js";
import { openApplications } from "../utils/open-windows.js";
import { book2ArtRoot, book2ArtSrcWith } from "./art-root.js";
import { browseArtDirs, servedPath } from "./browse.js";
import { STEADING_ACTOR_TYPE, isSteadingPlaceholderImg } from "../actors/steading/steading-portrait.js";
import { isBestiaryPlaceholderImg } from "../bestiary/monster-portrait.js";
import { creatureTypeIcon } from "../bestiary/creature-types.js";
import { isOurCompendiumRef } from "../migration/compat.js";
import { SYSTEM_ID, packId } from "../system-id.js";

// Re-apply the Book II illustrations to the compendia, the world journals, and the
// world actors, WITHOUT the source PDF.
//
// The "Import Book Art" macro extracts the art from a GM-owned PDF into a DURABLE
// folder outside the system (CONFIG.ROOT / the `book2ArtRoot` setting), then points
// documents at it. A system update replaces the whole `systems/stonetop-pwd` folder,
// so it wipes the compendium edits (the shipped packs overwrite them) but NOT the
// durable image files. This pass re-points documents at those surviving files, so the
// GM only ever runs the macro once. It ships no pixels: the file paths and document ids
// come from the generated manifest (module/book2-art/manifest.js).
//
// Byte-compatible with the macro's own apply pass (shared markup via world-journal-art.js),
// so a re-apply never double-adds art the macro already embedded. Two deliberate
// differences from the macro: `available` is read from disk rather than extraction, and
// the world-actor pass is conservative — it only re-points a portrait that is ALREADY
// one of ours (never a GM's custom art), because unlike the compendium these survive
// the update. World journals are handled like the macro: art is additive + idempotent,
// and a pristine entry's managed-journal baseline is re-stamped so the journal channel
// keeps treating it as pristine (edited entries keep their edited signal).
//
// FOUR triggers, all funnelling through the one idempotent worker `reapplyBook2Art`:
//   1. `reapplyBook2ArtOnVersionChange` (hooks/Ready.js) — the full pass, GM-only, ONCE
//      per system version (guarded by `book2ArtSyncVersion`), only when the durable art
//      is on disk, and BEFORE the journal sync. Re-points the wiped compendium.
//   2. `handleImportedJournalArt` (a debounced createJournalEntry hook, stonetop.js) —
//      when a GM drags a single journal in from the compendium mid-version, add its art
//      right away. Scoped to the imported entries; skips the compendium/actor re-point.
//   3. an every-GM-load self-heal (Ready.js) with { worldOnly, cheapWorldSkip } — adds
//      any durable art still MISSING from world journals (e.g. art that landed on disk
//      AFTER a journal was imported). Cheap: it reads a world entry's own pages first and
//      only touches the compendium for a row whose art is actually absent.
//   4. `game.stonetop.reapplyBook2Art()` (Ready.js API) — a manual, un-gated re-run for
//      the dev loop after re-assigning art in the picker + regenerating the manifest.

const BES_PACK = packId("stonetop-bestiary");
const JRN_PACK = packId("stonetop-journal");
const TOKEN_FIT = "cover"; // matches the macro's CONFIG.TOKEN_FIT
// Only for BUILDING a uuid, which must always name the active id. Recognising an existing
// stamp goes through isOurCompendiumRef, which tolerates a pre-rename spelling.
const JRN_SOURCE_PREFIX = `Compendium.${JRN_PACK}.`;

const jrnSource = (entryId) => `${JRN_SOURCE_PREFIX}JournalEntry.${entryId}`;

// Fully-qualified paths of the durable art currently on disk, across every directory the
// importer writes. A missing directory just means nothing to apply from there (the GM
// hasn't imported yet). The walk itself lives in browse.js, shared with the crop rebuild.
const browseDurableArt = (root) => browseArtDirs(root);

// Whether the GM has already imported book art: any durable illustration present on disk
// in the art folder. This is the very signal reapplyBook2Art uses to decide there is
// document art to wire (`present.size` below). Exported so the ready flow can nudge a GM
// who is past the first-session Welcome guide but never imported (hooks/Ready.js). Cheap
// (a few FilePicker.browse calls against the durable folder) and best-effort — a failed
// browse reads as "nothing on disk", the safe default for the nudge. GM-only, since only
// a GM can browse the data files.
export async function hasImportedBook2Art() {
	const present = await browseDurableArt(book2ArtRoot());
	return present.size > 0;
}

// The most art a world can be missing and still read as "an import that fell short" rather than
// "a book that was never supplied". Book I is 64% of the illustrations and Book II is 36%, and a
// GM who skipped one is not someone to nudge about a handful of failures — they need the plain
// import, which the Ready-flow reminder already offers. A run that merely lost some pages comes
// in far under this: the printing change that could not be matched by size cost 12 of 473, or
// 2.5%. Well clear of both edges, deliberately, because the useful signal is the ORDER of
// magnitude and not the exact figure.
const PARTIAL_IMPORT_MAX_MISSING = 0.10;

/**
 * The shell the "would this world gain anything?" detectors share.
 *
 * Browses the durable art folder once and hands `read` the only two things such a detector
 * needs: the set of files present, and the `srcOf` that maps a manifest output to the path it
 * would occupy. Answers null before calling it when NOTHING is imported — the plain import
 * reminder owns that GM, and every detector here agrees on that.
 *
 * Best-effort by construction: a browse that threw reads as "say nothing", which is the safe
 * default for something that only ever offers. GM-only, since only a GM can browse data files.
 *
 * @param {string} failure  What to log if the browse throws.
 * @param {(ctx: {present: Set<string>, srcOf: (out: any) => string}) => any} read
 */
async function withPresentArt(failure, read) {
	try {
		const root = book2ArtRoot();
		const present = await browseDurableArt(root);
		if (!present.size) return null;                     // never imported; not our nudge to make
		return read({ present, srcOf: (out) => book2ArtSrcWith(root, out) });
	} catch (e) {
		error(failure, e);
		return null;
	}
}

/**
 * The ordered list of files that could serve one Setting Overview page, best first.
 *
 * A row states `prefer` when more than one PDF prints the same picture and they are not equally
 * good — the GM playbook's 300 dpi Vicinity map beats Book II's ~700px crop of it, which in turn
 * beats the poster map an early release embedded there. `out` is the row's own picture and
 * `replaces` is whatever it superseded, which is the older implicit way of saying the same thing.
 *
 * ONE chain assembled from whatever the row states, rather than two encodings with one winning.
 * `prefer` used to be read INSTEAD of `out`/`replaces`, so a row carrying both had a half that
 * could never run and a row where the two disagreed would silently lose links — and every
 * consumer had to know which half to read. Ordered, deduped, falsy dropped: for a row that
 * states only `out`/`replaces` this is exactly the old implicit shape, and for today's rows
 * (whose `prefer` already covers both) it is exactly `prefer`.
 *
 * Every consumer must ask this same question the same way. Which file the page SHOWS and which
 * files get stripped off it are the two halves of one decision, and a caller that computed the
 * chain differently would strip the very art another caller had just placed.
 */
export function pageChain(row) {
	return [...new Set([
		...(Array.isArray(row?.prefer) ? row.prefer : []),
		row?.out,
		...(row?.replaces ?? []),
	])].filter(Boolean);
}

/**
 * Every illustration the importer writes, as manifest `out` paths. Deduped: rows legitimately
 * share a picture (two creatures drawn in one figure, a region's plate that is also its monster's
 * portrait), and counting one file twice would misreport both halves of the ratio below.
 *
 * A Setting Overview map is satisfied by ANY link in its preference chain (`pageChain`), since the
 * lesser links name art an earlier release — or a GM without the GM playbook — legitimately has
 * there instead. Counting the chain as one entry is what stops a GM who is on the older map from
 * reading as incomplete forever.
 *
 * `gmDiagrams` is deliberately absent, for the same reason the token squares below are: this ratio
 * decides whether to tell a GM their import fell short, and the diagrams come from an OPTIONAL
 * twelve-page PDF. A world with both rulebooks fully imported and no GM playbook has not fallen
 * short of anything, and counting them would say so on every load, forever.
 */
function everyDurableArtPath({ monsters = [], locations = [], settingOverviewMaps = [], treasures = [], people = [], steadings = [] }) {
	const chains = [];
	const one = (out) => { if (out) chains.push([out]); };
	// The creature ILLUSTRATION only. A token square is deliberately NOT counted, even though it is
	// a manifest `out` like any other: this ratio decides whether to say "your import fell short",
	// and the remedy it offers is re-running the PDF import. A token square does not come from a
	// PDF — it is cut locally from the illustration by the rebuild — so a world whose import is
	// perfect but which has simply not run the rebuild yet is not a world that fell short. Counting
	// them would also move the ratio by more than the threshold the moment the manifest gains token
	// rects (73 of 571 = 12.8% against a 10% cap), silently switching the nudge off for everyone.
	for (const m of monsters) one(m.out);
	for (const l of locations) for (const im of l.images ?? []) one(im.out);
	for (const t of treasures) one(t.out);
	for (const s of steadings) one(s.out);
	for (const p of people) { one(p.out); one(p.portraitOut); }
	for (const s of settingOverviewMaps) {
		const chain = pageChain(s).filter(Boolean);
		if (chain.length) chains.push(chain);
	}
	// Dedupe on the chain's own identity, so a shared picture is one unit of work either way.
	return [...new Map(chains.map((c) => [c.join("|"), c])).values()];
}

/**
 * Whether this world looks like an import that fell short, and by how much.
 *
 * A GM whose import failed on some illustrations has no way to know: the failures scroll past in
 * the console during a run that otherwise reports success, and what they see afterwards is a
 * handful of entries that never got their picture. This is the detector behind the once-only
 * offer to finish the job (hooks/Ready.js), and it deliberately describes the SHAPE of the
 * problem rather than any particular cause. The printing change that prompted it is one way to
 * get here; a page that timed out, a PDF that stopped being readable part way, and a run the GM
 * closed early all land in the same place and all have the same remedy.
 *
 * Returns null when there is nothing to say: nothing imported at all (the plain import reminder
 * owns that GM), nothing missing, or so much missing that a whole book is clearly absent.
 *
 * @returns {Promise<{missing: number, total: number} | null>}
 */
export async function countMissingDurableArt() {
	return withPresentArt("Book II art: could not check whether the import is complete", ({ present, srcOf }) => {
		const chains = everyDurableArtPath(BOOK2_ART_APPLY_MANIFEST);
		const missing = chains.filter((chain) => !chain.some((out) => present.has(srcOf(out)))).length;
		if (!missing) return null;
		if (missing > chains.length * PARTIAL_IMPORT_MAX_MISSING) return null;   // a whole book is absent
		return { missing, total: chains.length };
	});
}

/**
 * What this world would gain by also supplying the GM playbook, or null if nothing.
 *
 * The GM playbook joined the importer as a third source after worlds had already imported, and it
 * is the one addition a GM cannot discover for themselves: nothing looks broken to them. Their map
 * pages carry a map — just not the sharpest one printed — and the two flowcharts live on a sheet
 * tab whose placeholder they may never scroll to. So the offer behind this (hooks/Ready.js
 * `_offerGmPlaybookArtOnce`) has to arrive on its own.
 *
 * `maps` counts Setting Overview pages showing a LESSER link than the head of their chain. Both
 * halves of that are load-bearing. A page whose best link is already on disk has nothing to gain;
 * a page with NO link on disk is a partial import rather than a world that would benefit from a
 * new source, and `countMissingDurableArt` above owns that GM — telling someone whose maps are
 * missing entirely that their maps could be sharper is nonsense.
 *
 * Returns null when nothing is imported at all (the plain import reminder owns that GM, and the
 * playbook is a field on the very dialog its button opens), and when there is nothing to add.
 *
 * @returns {Promise<{maps: number, diagrams: number} | null>}
 */
export async function countGmPlaybookGains() {
	return withPresentArt("Book II art: could not check what the GM playbook would add", ({ present, srcOf }) => {
		const { settingOverviewMaps = [], gmDiagrams = [] } = BOOK2_ART_APPLY_MANIFEST;
		const maps = settingOverviewMaps.filter((s) => {
			const chain = pageChain(s).filter(Boolean);
			return chain.length > 1 && !present.has(srcOf(chain[0])) && chain.some((o) => present.has(srcOf(o)));
		}).length;
		const diagrams = gmDiagrams.filter((d) => !present.has(srcOf(d.out))).length;
		return (maps || diagrams) ? { maps, diagrams } : null;
	});
}

// Publish which document-less art rows have their illustration on disk into a world-scoped
// index `setting`. Treasures and "People of Stonetop" portraits are not documents: a treasure's
// Item is built at drag time (treasure-drops.js reads this index instead), and the steading
// sheet's portrait gallery reads it rather than browsing files (so even players get it broadcast).
// `entryOf(row)` returns the `[key, value]` pair to record, keyed the way each consumer looks it
// up: treasures map catalog slug -> manifest `out` path; portraits map `out` -> display name.
// Recording the manifest's own path means the consumer resolves the file we actually checked for,
// instead of re-deriving it from the naming convention and drifting when a row's `out` changes.
// Authoritative (not additive): a row whose file is gone is dropped, so nothing ever points at a
// missing image. Only writes when the index actually changed, since this runs on every GM load.
// No `!rows.length` fast path: an empty manifest list is a real state that must still clear a
// previously-published index, and the changed-only check already makes the steady-state call a
// single setting read.
//
// `pathOf(row)` is the file whose presence decides whether the row is indexed at all. It is the
// row's own `out` for every index but one: the square-portrait index is keyed by the
// illustration but gated on the SQUARE being present, since that is the file it hands out.
async function refreshArtIndex(setting, rows, present, srcOf, entryOf, label, pathOf = (r) => r.out) {
	try {
		const have = {};
		for (const row of rows.filter((r) => present.has(srcOf(pathOf(r))))) {
			const [key, value] = entryOf(row);
			have[key] = value;
		}
		const prev = getSetting(setting);
		// Key order is the manifest's on both sides, so a plain stringify compares faithfully.
		if (JSON.stringify(prev ?? {}) === JSON.stringify(have)) return;
		await setSetting(setting, have);
		const count = Object.keys(have).length;
		info(`Book II art: ${label} art index updated (${count} of ${rows.length} on disk)`);
	} catch (e) {
		error(`Book II art: could not update the ${label} art index`, e);
	}
}

/**
 * Publish what this host puts in front of the art root, so clients that cannot browse can still
 * resolve a picture (art-root.js `book2ArtPrefix`). Empty on a self-hosted Foundry; the Assets
 * Library origin on The Forge.
 *
 * Only ever published from a listing that actually returned something. A browse that came back
 * empty cannot distinguish "no art here" from "that call failed", and while an empty index is a
 * harmless (self-healing) answer to the first, an empty PREFIX is not: it would re-point every
 * document at a path that does not resolve on this host, which is the failure this whole
 * mechanism exists to undo.
 */
async function refreshArtPrefix(present) {
	try {
		if (!present?.size) return;
		const prefix = present.prefix ?? "";
		if (getSetting("book2ArtPrefix") === prefix) return;
		await setSetting("book2ArtPrefix", prefix);
		info(`Book II art: durable art is served from "${prefix || "the data folder"}"`);
	} catch (e) {
		error("Book II art: could not record where the art folder is served from", e);
	}
}

// Every document-less art index this module publishes. Exported because a writer of one of these
// has to bust the browse cache (see browse.js, and the `updateSetting` hook in stonetop.js) — that
// hook used to name them in a regex of its own, so a fourth index could be added here and silently
// never invalidate. One list, one place.
export const ART_INDEX_SETTINGS = ["treasureArt", "peopleArt", "peoplePortraitArt", "gmDiagramArt"];

// The two People-of-Stonetop indexes, published together because they are read together: a
// consumer joins them by the illustration `out`, and a square index describing files whose
// illustration index is stale would hand out a face for a portrait nothing offers.
//
// `peopleArt` is guarded on a populated manifest but `peoplePortraitArt` is not — see the callers'
// note above: the macro co-publishes the former, nobody else publishes the latter.
async function refreshPeopleArtIndexes(people, present, srcOf) {
	if (people.length) await refreshArtIndex("peopleArt", people, present, srcOf, (p) => [p.out, p.name], "people");
	// Gated on the SQUARE being on disk (that is what it hands out), which is why it needs
	// `pathOf`. A world with no squares yet is correctly represented by `{}` — every consumer
	// falls back to the whole illustration.
	await refreshArtIndex("peoplePortraitArt", people.filter((p) => p.portraitOut), present, srcOf,
		(p) => [p.out, p.portraitOut], "people square", (p) => p.portraitOut);
}

/**
 * Republish just the People indexes, from just the people folder.
 *
 * What the portrait rebuild needs after it cuts files: the two settings that say which portraits
 * and squares are on disk. It used to reach for the whole `reapplyBook2Art()` pass to get them,
 * which re-browses all six art directories and then walks ~170 manifest rows doing two awaited
 * compendium document reads apiece — several hundred round trips to publish two settings, none of
 * whose documents reference the files the rebuild just wrote (portraits reach documents through
 * repoint-portraits.js, not through here).
 */
export async function publishPeopleArtIndexes() {
	if (!game.user?.isGM) return;
	const root = book2ArtRoot();
	const present = await browseArtDirs(root, ["assets/people"]);
	// The files this rebuild just wrote are the first listing some worlds ever get back, so record
	// where the host serves them from here too rather than waiting for the next full pass.
	await refreshArtPrefix(present);
	await refreshPeopleArtIndexes(BOOK2_ART_APPLY_MANIFEST.people ?? [], present, (out) => book2ArtSrcWith(root, out));
}

// Embed missing art into every world copy of a compendium journal page. `buildNext(wp)`
// returns the page's new field value, or null when the page already has the art (skip).
// `noteEntry` marks a touched world entry so pristine tracking stays honest. Returns how
// many world pages were updated. Shared by the bestiary / location / setting-map passes,
// which differ only in the build function and the field key.
async function applyWorldPages(worldEntries, page, updateKey, buildNext, noteEntry) {
	let count = 0;
	for (const entry of worldEntries) {
		const wp = matchWorldPage(entry.pages, page.id, page.name, page.type);
		if (!wp) continue;
		const next = buildNext(wp);
		if (next != null) { noteEntry(entry); await wp.update({ [updateKey]: next }); count++; }
	}
	return count;
}

// Minimal portrait + prototype-token update pointing `doc` at `src`, forcing the token
// fit. For COMPENDIUM docs, which an update resets to the shipped defaults every time.
// Returns null when nothing would change, so no-op writes are skipped.
//
// `tokenSrc` defaults to `src` — one picture doing both jobs, which is what everything but a
// hand-framed creature wants. A creature with a token square passes its own smaller file, so the
// token is the square while `img` stays the whole illustration (see monster-tokens.js).
// The update key for a prototype token's picture. Foundry's own dotted-path idiom, spelled the
// same way all over this system — named here alone because this file is the only one that reads
// an update object back after building it (the token counter below), and a counter comparing
// against its own copy of the string would silently report zero if these writers ever moved to a
// nested `prototypeToken: {texture: {…}}` form.
const TOKEN_SRC_KEY = "prototypeToken.texture.src";

function artUpdate(doc, src, tokenSrc = src) {
	const upd = {};
	if (doc.img !== src) upd.img = src;
	const tex = doc.prototypeToken?.texture;
	if (tex && tex.src !== tokenSrc) upd[TOKEN_SRC_KEY] = tokenSrc;
	if (tex && tex.fit !== TOKEN_FIT) upd["prototypeToken.texture.fit"] = TOKEN_FIT;
	return Object.keys(upd).length ? upd : null;
}

// Update for a WORLD bestiary actor, which survives a system update (so a GM's choices must
// be preserved). Two safe cases, per field:
//   • re-point a stale pointer that is ALREADY one of ours (ends with any of this monster's art
//     paths — its current one, which the root change can break, or one it RETIRED when it turned
//     out to share a picture with a peer) — never a custom portrait/token; OR
//   • ADOPT the durable art over a shipped creature-type placeholder the seeded actor still
//     carries. SeedActors copies the compendium's placeholder icon into the world, and nothing
//     ELSE ever replaces it — the runtime self-heal is otherwise conservative — so a monster
//     with book art would stay on its type icon forever. This is the mirror of the steading
//     portrait's adopt-over-placeholder net (§3.5), keyed on isBestiaryPlaceholderImg.
// A portrait/token the group chose is left untouched. The token `fit` is forced ONLY when
// adopting over a placeholder token, so a GM's "contain" on art that was already ours is never
// reverted to "cover" on every load. Null when nothing to change.
//
// `tokenSrc` is the creature's hand-framed square when it has one and that file is on disk, else
// `src` (see monster-tokens.js). It is a THIRD safe case for the token field, not a replacement
// for the two above: a world whose token still points at the whole illustration is pointing at
// one of OUR paths, so `ours` already recognises it and the re-point moves it to the square. The
// reverse also holds — `tails` carries the token path too, so clearing a token square in the
// picker moves an already-wired token back to the illustration rather than stranding it.
function worldMonsterArtUpdate(actor, src, tails, tokenSrc = src) {
	const upd = {};
	const ours = (path) => tails.some((t) => String(path ?? "").endsWith(t));
	const imgPlaceholder = isBestiaryPlaceholderImg(actor.img);
	if ((ours(actor.img) || imgPlaceholder) && actor.img !== src) upd.img = src;
	const tex = actor.prototypeToken?.texture;
	if (tex) {
		const tokPlaceholder = isBestiaryPlaceholderImg(tex.src);
		if ((ours(tex.src) || tokPlaceholder) && tex.src !== tokenSrc) upd[TOKEN_SRC_KEY] = tokenSrc;
		if (tokPlaceholder && tex.fit !== TOKEN_FIT) upd["prototypeToken.texture.fit"] = TOKEN_FIT;
	}
	return Object.keys(upd).length ? upd : null;
}

// The mirror of worldMonsterArtUpdate, for art that has gone the other way: this actor still
// points at one of OUR durable paths, and that file is no longer on disk. A partial import is the
// ordinary way in (a printing that re-saved an illustration the matcher could not find, a page
// that timed out), as is re-importing into a fresh art folder after moving or clearing the old
// one. Nothing else ever clears it: the compendium is reset to art-less defaults by any system
// update, but a world actor survives updates, and the passes above only ever wire art that IS
// present — so the broken image sits on the sheet, the token and every catalog row indefinitely.
//
// It reverts to the creature-type icon, which is the same shipped placeholder SeedActors gave the
// actor before any import. That matters beyond looking tidy: isBestiaryPlaceholderImg reads it as
// a placeholder again, so the moment the GM does re-import, the adopt-over-placeholder path picks
// the picture straight back up. Nothing is lost and nothing needs undoing.
//
// Only ever touches paths that are ALREADY ours, on exactly the same `tails` test the re-point
// uses, so a portrait the group chose is untouched here as everywhere else. Null when there is
// nothing to change.
function staleMonsterArtReset(actor, tails) {
	const ours = (path) => tails.some((t) => String(path ?? "").endsWith(t));
	// Read at call time, like isBestiaryPlaceholderImg, so it reflects the running Foundry.
	const fallback = creatureTypeIcon(actor.system?.creatureType)
		?? globalThis.CONST?.DEFAULT_TOKEN ?? "icons/svg/mystery-man.svg";
	const upd = {};
	if (ours(actor.img) && actor.img !== fallback) upd.img = fallback;
	const tex = actor.prototypeToken?.texture;
	if (tex && ours(tex.src) && tex.src !== fallback) upd[TOKEN_SRC_KEY] = fallback;
	return Object.keys(upd).length ? upd : null;
}

// True if any page of `entry` already carries this exact art `src` anywhere (bestiary
// description, a location section body, or a plain text page). A cheap, compendium-free
// pre-check: it reads only the world entry's own in-memory pages, so the every-load
// self-heal can decide "this row's art is already here, skip it" without a getDocument.
function entryHasSrc(entry, src) {
	for (const p of entry?.pages ?? []) {
		if (String(p.system?.description ?? "").includes(src)) return true;
		if (String(p.system?.nests ?? "").includes(src)) return true;
		for (const s of p.system?.sections ?? []) if (String(s?.body ?? "").includes(src)) return true;
		if (String(p.text?.content ?? "").includes(src)) return true;
	}
	return false;
}

// True if any bestiary page of this world entry would change under `curation` — the cheap,
// compendium-free precheck for the curated-codex pass below, and the reason that pass stays
// as free as the others on a steady-state load. entryHasSrc cannot answer this: it only asks
// "is this src anywhere on the entry?", which can see neither art sitting in the WRONG slot
// nor art the manifest no longer names (both of which need a write).
function codexEntryNeedsWork(entry, curation) {
	for (const p of entry?.pages ?? []) {
		if (p.type !== "bestiary") continue;
		if (codexFieldWithArt(p.system?.description, "description", curation) != null) return true;
		if (codexFieldWithArt(p.system?.nests, "nests", curation) != null) return true;
	}
	return false;
}

// Re-render the OPEN world-journal sheets among `entries` so freshly-embedded art appears
// without an F5. Targeted (only entries we touched) so an unrelated journal a GM is editing
// is never disturbed, and best-effort (a failed render must not fail the pass). Covers both
// the AppV2 sheet registry (v13+ journals) and the legacy AppV1 windows. Mirrored inline by
// the bring-your-own-book macro (scripts/local/book2-art/import-book2-art.js, section 7c).
// Best-effort re-render every OPEN app (AppV2 sheet registry + legacy AppV1 windows) whose
// bound document matches `pred`. A failed render must never fail the pass.
function rerenderOpenAppsWhere(pred) {
	for (const app of openApplications()) {
		const doc = app?.document ?? app?.object;
		if (doc && app.rendered && pred(doc)) {
			try { app.render(); } catch (_) { /* best-effort refresh */ }
		}
	}
}

function rerenderOpenJournals(entries) {
	const ids = new Set();
	for (const e of entries) if (e?.id) ids.add(e.id);
	if (!ids.size) return;
	rerenderOpenAppsWhere(doc => doc.documentName === "JournalEntry" && ids.has(doc.id));
}

// Re-render any OPEN views of the compendia we just wrote to, so the new art shows without an
// F5. UNLIKE a world document, a compendium document update does NOT live-refresh the pack
// browser window or a sheet opened from it (Foundry keeps the pack in memory), so a GM who
// runs the import — or the once-per-version re-point — with the Monsters/journal compendium
// open would otherwise see the old art until a reload. This closes that gap for non-technical
// GMs. Best-effort: a failed render must never fail the pass. `packs` are the CompendiumCollection
// objects we edited. Mirrored inline by the bring-your-own-book macro.
function rerenderOpenCompendia(packs) {
	const set = new Set((packs ?? []).filter(Boolean));
	if (!set.size) return;
	// The pack browser window(s): a collection re-renders its bound applications.
	for (const pack of set) for (const app of pack.apps ?? []) { try { app.render(false); } catch (_) { /* best-effort */ } }
	// Sheets opened FROM these compendia — a compendium doc's sheet shows its own img/token,
	// which the doc update above does not refresh. Matched by the doc's `pack` id.
	const ids = new Set([...set].map((p) => p.collection ?? p.metadata?.id).filter(Boolean));
	rerenderOpenAppsWhere(doc => doc.pack && ids.has(doc.pack));
}

// The re-apply worker. Idempotent (every write is a no-op when the target already
// matches), so it is safe to run repeatedly. Options select what it touches:
//   • entries      — an explicit list of world JournalEntry docs to (re)apply art to.
//                    Implies worldOnly: a single imported journal doesn't need the whole
//                    compendium or the world actors re-pointed.
//   • worldOnly    — skip the compendium re-point (actors + compendium journal pages) and
//                    the world-actor pass; only embed art into world journals.
//   • cheapWorldSkip — in the world-journal passes, skip the compendium read for any row
//                    whose art is already present in every matching world entry. Makes the
//                    every-load self-heal near-free once everything is applied.
//   • quiet        — do the work but skip the finishing toast. For a caller that runs this as
//                    one step of a larger job and reports that job's result itself.
// Returns a stats object ({ errors, total, … }) on a completed pass, or null when it could
// not run (not GM / nothing on disk / packs missing) so the caller can decide about stamping.
export async function reapplyBook2Art({ entries = null, worldOnly = false, cheapWorldSkip = false, quiet = false } = {}) {
	if (!game.user?.isGM) return null;
	const version = game.system.version;
	const onlyWorld = worldOnly || Array.isArray(entries);

	const root = book2ArtRoot();
	const present = await browseDurableArt(root);

	// book2ArtSrc with the root hoisted: this runs once per manifest row per pass, and the
	// root cannot change mid-pass, so there's no reason to re-read the setting each time.
	//
	// This is the IDENTITY of a picture — what the browse is asked about and what an art index is
	// keyed by. What a DOCUMENT gets pointed at is `servedOf`: the path the host actually listed
	// the file under, which off a hosted setup is the very same string (see browse.js).
	const srcOf = (out) => book2ArtSrcWith(root, out);
	// `resolve` is asked rather than rebuilt from the published prefix, because it is the listing's
	// own answer for THIS file — no assumption that one prefix fits every directory, and no window
	// where the setting has not caught up with what was just browsed.
	const servedOf = (out) => servedPath(present, srcOf(out));
	// Every spelling of one picture this system could ever have written onto a page: the bare
	// identity (what every build before hosted support embedded), whatever the host is serving it
	// as now, and the identity under the published prefix — which is the one that catches a file
	// that has since been DELETED, where `resolve` has nothing to answer with. Deduped, because on
	// a self-hosted world all three are the same string and a strip set of three copies of one path
	// would just do the same work three times.
	const bothOf = (out) => [...new Set([srcOf(out), servedOf(out), `${present.prefix ?? ""}${srcOf(out)}`])];
	// Those same spellings MINUS the one we are about to place: the stale <img> a previous pass
	// left behind, so it comes off the page instead of sitting beside the new one as a permanent
	// broken image. Empty on a self-hosted world, so this is inert there.
	const renamedOf = (out) => bothOf(out).filter((p) => p !== servedOf(out));
	const { monsters, locations, settingOverviewMaps = [], gmDiagrams = [], treasures = [], people = [], codex = [], steadings = [] } = BOOK2_ART_APPLY_MANIFEST;

	// Before the indexes: they are keyed by identity, but every consumer resolves through the
	// prefix, so publishing it late would leave one load pointing players at unresolvable art.
	await refreshArtPrefix(present);

	// Treasures first, and BEFORE the nothing-on-disk return below. They are not documents,
	// so publishing which of them have a file on disk, and where, is their whole apply step —
	// treasure-drops.js reads the index when a player drags the item off the journal. The
	// index is AUTHORITATIVE, which makes the empty-folder case the one that most needs to
	// run, not the one to skip: a GM who deleted or renamed the art folder must have the
	// index cleared, or every drag keeps baking `img` to a file that is gone. Clearing is
	// also the safe failure mode if a browse fails transiently — a dropped item falls back
	// to its load-class icon, and the next load restores the index.
	await refreshArtIndex("treasureArt", treasures, present, srcOf, (t) => [t.slug, t.out], "treasure");
	// The GM playbook's two flowcharts, for exactly the same reasons as the treasures above: no
	// document points at them, so the index IS the apply step, and it must stay authoritative so a
	// GM who cleared the art folder gets a Core Loop tab that says "not imported" rather than two
	// broken images.
	await refreshArtIndex("gmDiagramArt", gmDiagrams, present, srcOf, (d) => [d.slug, d.out], "GM playbook diagram");
	// People-of-Stonetop portraits are document-less too. But UNLIKE treasures, this reapply is
	// NOT their publisher: a portrait's display name lives only in the Import Book Art macro's
	// manifest (`kind:"person"` rows), so the macro publishes `peopleArt` itself, additively, from
	// the files it just wrote. This system's own `people` manifest is populated in lockstep only
	// when portrait art is authored. So guard on it: while it's empty we have no names to index and
	// must NOT run the authoritative refresh (it would compute `{}` and wipe the macro's index on
	// every load, emptying the steading gallery). Once `people` is populated it matches the macro,
	// and the refresh becomes authoritative again — dropping a portrait whose file is gone.
	await refreshPeopleArtIndexes(people, present, srcOf);

	if (!present.size) return null; // nothing imported yet -> no document art to wire

	// Codex pages the user has CURATED in the picker: they choose which of the page's
	// illustrations show and under which heading, so the additive per-monster embed below
	// must keep its hands off them (it would re-add art they hid, and could never relocate
	// anything). Pass 1.5 owns these pages instead, authoritatively. Every other codex page
	// is untouched by this and keeps the additive behaviour, so `codex: []` — the shipped
	// default — is a literal no-op.
	const curated = new Set(codex.map((c) => c.journalEntryId));

	// Only wire art that is actually on disk (a partial import must not point a
	// document at a file that isn't there).
	const available = new Set();
	for (const m of monsters) {
		if (present.has(srcOf(m.out))) available.add(m.out);
		// The hand-framed token square is a SEPARATE file with its own presence: a GM who
		// imported before tokens existed has every illustration and none of the squares, and
		// must keep a working token rather than a broken image, until the rebuild cuts them.
		if (m.tokenOut && present.has(srcOf(m.tokenOut))) available.add(m.tokenOut);
	}
	for (const l of locations) for (const im of l.images) if (present.has(srcOf(im.out))) available.add(im.out);
	// The picture a creature's TOKEN should show: its square when the manifest names one AND that
	// file is on disk, else the whole illustration. Stated once, because the compendium pass and
	// the world-actor pass have to agree — a token wired to the square in one and the illustration
	// in the other would flip back and forth on every load.
	const tokenSrcOf = (m, src) => (m.tokenOut && available.has(m.tokenOut) ? servedOf(m.tokenOut) : src);

	// Setting Overview maps resolve their preference chain HERE rather than in pass 2.5, so
	// the rule is stated once and the early return below can see their work. `pageChain` is that
	// ordering, best first: the GM playbook's 300 dpi map where the GM imported one, then the
	// Book II page crop, then the user-supplied poster map an early release embedded here. Show
	// the best one on disk and supersede the rest. Walking DOWN the chain is the upgrade (a world
	// still showing the poster map gets a labelled printed map instead); falling back matters just
	// as much, because a GM who has not re-run the macro — or who has none of those PDFs at all —
	// still has only the poster map on disk, and skipping the row outright would leave them
	// staring at a blank page where their map used to be. The poster map file is never
	// touched: it still backs its Scene.
	const mapPicks = settingOverviewMaps.flatMap((s) => {
		const chain = pageChain(s);
		const pick = chain.find((o) => present.has(srcOf(o)));
		// Both the OTHER links in the chain and the stale spellings of the pick itself:
		// superseding the poster map and re-pointing a map this host now serves from somewhere
		// else are the same operation on the page, so one list covers both.
		return pick ? [{
			s,
			src: servedOf(pick),
			replaces: [...chain.filter((o) => o !== pick).flatMap(bothOf), ...renamedOf(pick)],
		}] : [];
	});
	// Nothing of ours on disk at all — not a document image, not a map, not the steading
	// portrait. (Maps count even though they never enter `available`: a GM who only ever
	// supplied poster maps still has work for us to do, and must not be turned away here.
	// The steading portrait is document-less too and lives in its own folder, so check it
	// directly — otherwise a world with only the steading art on disk would be turned away
	// before the safety-net pass below could adopt it. Skipped on a scoped import, which
	// never touches actors.)
	const steadingOnDisk = !Array.isArray(entries) && steadings.some((s) => present.has(srcOf(s.out)));
	// Monster art on disk is actor work for pass 3 (adopt over the creature-type placeholder),
	// independent of whether this world has any seeded journals. Disk-only, like steadingOnDisk:
	// it may let a world through that turns out to have no bestiary actors of ours, which pass 3
	// then no-ops over — the cheap, correct failure mode. Skipped on a scoped import (no actors).
	const monstersOnDisk = !Array.isArray(entries) && monsters.some((m) => present.has(srcOf(m.out)));
	// The same signal for location plates, and used for the same one thing: deciding whether an
	// absent file is really absent, or whether the browse simply came back empty. Not scoped to a
	// scoped import, unlike the flag above, because the page passes DO run on one.
	const locationsOnDisk = locations.some((l) => l.images.some((im) => present.has(srcOf(im.out))));
	if (!available.size && !mapPicks.length && !steadingOnDisk) return null;

	const besPack = game.packs.get(monsters[0]?.actorPack ?? BES_PACK);
	const jrnPack = game.packs.get(JRN_PACK);
	if (!besPack || !jrnPack) return null;

	// World journals seeded/imported from our compendiums, indexed by the compendium
	// source uuid core stamps on import. Scoped to `entries` when given (a single import),
	// otherwise every world journal (empty until the gazetteer / bestiary codex is seeded).
	const worldBySource = new Map();
	for (const j of entries ?? game.journal ?? []) {
		const s = compendiumSourceOf(j);
		if (!isOurCompendiumRef(s)) continue;
		if (!worldBySource.has(s)) worldBySource.set(s, []);
		worldBySource.get(s).push(j);
	}
	// A scoped import over journals that aren't ours (or aren't from our packs) has no
	// world targets and no compendium work to do: bail before touching packs. But a world
	// with the steading portrait OR a bestiary monster's book art on disk still has actor work
	// (pass 3.5 steading / pass 3 monsters) even with no world journals, so let it through here
	// too — otherwise the every-load worldOnly self-heal would turn such a world away before it
	// could adopt art onto actors that were seeded after the version was stamped.
	if (onlyWorld && !worldBySource.size && !steadingOnDisk && !monstersOnDisk) return null;

	// Per-entry pre-injection pristine state, captured the FIRST time we touch an entry
	// (before the embed changes its fingerprint). A pristine entry is re-stamped after;
	// an edited one keeps its edited signal so the managed channel stays hands-off.
	const touchedEntries = new Map();
	const noteEntry = (entry) => {
		if (touchedEntries.has(entry)) return;
		const base = entry.getFlag?.(SYSTEM_ID, "journalSync");
		let pristine = false;
		try { pristine = !!base?.hash && base.hash === managedHash(entry.toObject()); } catch (_) { /* treat as edited */ }
		touchedEntries.set(entry, { base, pristine });
	};

	const relock = [];
	let actors = 0, besPages = 0, codexPages = 0, locPages = 0, soPages = 0, worldActors = 0, worldJournalPages = 0, steadingActors = 0, worldTokens = 0, errors = 0;
	try {
		// Unlock inside the try so the finally relocks whatever we opened even if the
		// second unlock (or any later step) throws. Only the compendium-writing passes
		// need it: a world-only pass reads the (locked) compendium and writes world docs.
		if (!onlyWorld) for (const p of [besPack, jrnPack]) if (p.locked) { await p.configure({ locked: false }); relock.push(p); }

		// 1. Compendium bestiary actors + bestiary journal pages (+ the same pages in any
		//    seeded world journal). Unconditional on the compendium: an update resets it to
		//    the shipped (art-less) defaults every time, so always re-point.
		for (const m of monsters) {
			// This row's picture is NOT on disk. There is nothing to place and no actor art to
			// wire, but a previous import may have embedded it on the page, and that embed now
			// renders as a broken image. Carry on with a null `src`, which puts the page half into
			// strip-only mode, and hand it the absent path as retired — the same mechanism, for
			// the same reason: it keys on the embed rather than on a file, which is exactly what
			// is needed when the file is the thing that has gone.
			//
			// Gated on some OTHER monster's art being present, like the actor reset above: that is
			// what separates "this one picture is missing" from "the browse came back empty", and
			// without it a transient FilePicker failure would strip the art off every bestiary
			// page at once.
			const onDisk = available.has(m.out);
			if (!onDisk && !monstersOnDisk) continue;
			const src = onDisk ? servedOf(m.out) : null;
			// Retired art: a src a PRIOR manifest embedded for this creature and this system no
			// longer names — two entries the book draws in ONE picture now share the one file, so
			// the loser's embed has to come off the page. Resolved regardless of disk presence,
			// like the locations pass: it keys on the embed, not on a file.
			// Every spelling of each, so art retired under a bare path comes off a page whose host
			// has since moved (and vice versa). When the picture is gone, `bothOf` is what strips
			// the embed even though `resolve` has nothing left to answer with.
			const retired = [
				...(m.retired ?? []).flatMap(bothOf),
				...(onDisk ? renamedOf(m.out) : bothOf(m.out)),
			];
			if (!onlyWorld && onDisk) {
				try {
					const actor = await besPack.getDocument(m.actorId);
					const upd = actor && artUpdate(actor, src, tokenSrcOf(m, src));
					if (upd) { await actor.update(upd); actors++; }
				} catch (e) { errors++; error(`Book II art re-apply: actor "${m.slug}"`, e); }
			}
			// The journal half only — the portrait/token above is per-actor and always applies.
			// A curated page is owned by pass 1.5; several actors can share one codex page, so
			// this is what stops their portraits stacking on it.
			if (m.journalEntryId && m.journalPageId && !curated.has(m.journalEntryId)) {
				const worldEntries = worldBySource.get(jrnSource(m.journalEntryId)) ?? [];
				// Skip the compendium read when this is a world-only pass with no world work:
				// no matching world entries, or (in cheap mode) every one already has the art.
				// In strip-only mode there is no art to be missing, so the only work is an embed
				// left behind — and asking `entryHasSrc` about a null src would search the prose
				// for the literal "null" and answer at random.
				const worldNeedsArt = worldEntries.length && (!cheapWorldSkip || worldEntries.some(
					(e) => (src && !entryHasSrc(e, src)) || retired.some((r) => entryHasSrc(e, r))));
				if (onlyWorld && !worldNeedsArt) continue;
				try {
					const page = (await jrnPack.getDocument(m.journalEntryId))?.pages?.get(m.journalPageId);
					if (page) {
						if (!onlyWorld) {
							const nd = bestiaryDescriptionWithArt(page.system?.description, src, m.name, retired);
							if (nd != null) { await page.update({ "system.description": nd }); besPages++; }
						}
						worldJournalPages += await applyWorldPages(worldEntries, page, "system.description",
							(wp) => bestiaryDescriptionWithArt(wp.system?.description, src, m.name, retired), noteEntry);
					}
				} catch (e) { errors++; error(`Book II art re-apply: bestiary journal "${m.slug}"`, e); }
			}
		}

		// 1.5 CURATED codex pages (+ their world copies). Where several creatures share one
		//    codex page, the additive pass above would stack every portrait on it. Here the
		//    manifest is authoritative instead: it names every illustration the page owns
		//    (`managed`) and exactly which of them show, and where (`slots`). Art the user
		//    hid is in `managed` but in no slot, which is how it gets stripped rather than
		//    merely not re-added.
		for (const c of codex) {
			// Nothing of this entry's art on disk: this GM never imported it, so leave the
			// page alone rather than stripping art they do have (mirrors the locations pass).
			if (!(c.managed ?? []).some((out) => available.has(out))) continue;
			try {
				// Resolve to page srcs. `slots` is filtered to what is on disk, so a partial
				// import never embeds a broken <img>; `managed` stays COMPLETE so a missing
				// file can still be stripped off a page that already carries it.
				const curation = {
					// The strip set takes every spelling: this pass is authoritative, so a page still
					// carrying the bare path from an older build has to lose it before the served
					// one goes back, or the reader is shown both.
					managed: (c.managed ?? []).flatMap(bothOf),
					slots: (c.slots ?? []).map((s) => ({
						slot: s.slot,
						images: (s.images ?? []).filter((i) => available.has(i.out))
							.map((i) => ({ src: servedOf(i.out), name: i.name })),
					})),
				};
				const worldEntries = worldBySource.get(jrnSource(c.journalEntryId)) ?? [];
				const worldNeedsArt = worldEntries.length
					&& (!cheapWorldSkip || worldEntries.some((e) => codexEntryNeedsWork(e, curation)));
				if (onlyWorld && !worldNeedsArt) continue;
				const page = (await jrnPack.getDocument(c.journalEntryId))?.pages?.get(c.journalPageId);
				if (!page) continue;
				if (!onlyWorld) {
					// Both fields in ONE update: they are two keys of the same page.
					const upd = {};
					const nd = codexFieldWithArt(page.system?.description, "description", curation);
					if (nd != null) upd["system.description"] = nd;
					const nn = codexFieldWithArt(page.system?.nests, "nests", curation);
					if (nn != null) upd["system.nests"] = nn;
					if (Object.keys(upd).length) { await page.update(upd); codexPages++; }
				}
				// Two applyWorldPages calls rather than one merged write: it takes a single
				// updateKey, and widening its signature would drag the location + map passes
				// into the blast radius for nothing. noteEntry is deduped by touchedEntries, so
				// the pristine baseline is still captured exactly once and BEFORE the first
				// write — which is what keeps a removal-only touch from marking a seeded entry
				// GM-edited and silently opting it out of every future prose update.
				worldJournalPages += await applyWorldPages(worldEntries, page, "system.description",
					(wp) => codexFieldWithArt(wp.system?.description, "description", curation), noteEntry);
				worldJournalPages += await applyWorldPages(worldEntries, page, "system.nests",
					(wp) => codexFieldWithArt(wp.system?.nests, "nests", curation), noteEntry);
			} catch (e) { errors++; error(`Book II art re-apply: curated codex page "${c.name ?? c.journalEntryId}"`, e); }
		}

		// 2. Compendium location journal pages (+ their world copies). Append missing art
		//    into the target section body in book order.
		for (const l of locations) {
			try {
				const srcs = l.images.filter((im) => available.has(im.out)).map((im) => servedOf(im.out));
				// Retired art: a src a PRIOR manifest embedded that this system no longer names
				// (a duplicate extraction we removed, or a plate that turned out to be the same
				// picture as a creature's portrait and now shares that ONE file). Keyed on the
				// embed, not a file, so it clears even after the file is gone.
				//
				// Stripped ONLY when every image this row wants is on disk. A retired path is
				// nearly always the old NAME of a picture the row still places, so stripping it
				// while its replacement is missing would take art off the page and put nothing
				// back — and a GM who imported an older manifest and never re-ran the import has
				// exactly that shape. Nothing is lost by waiting: the leftover embed is cleared
				// the moment they import the art it was renamed to. (The monster pass gets this
				// for free — it already skips any creature whose art is not on disk.)
				//
				// An image this row WANTS but cannot find is a different case, and gets stripped
				// whether or not the rest of the row is complete: there is no replacement to wait
				// for, because the missing path IS the one the manifest names, so an embed of it
				// can only ever render as a broken image. Gated on some OTHER location plate being
				// present, like the bestiary pass, so a browse that failed cannot strip the art off
				// every location page at once.
				const gone = locationsOnDisk
					? l.images.filter((im) => !available.has(im.out)).flatMap((im) => bothOf(im.out))
					: [];
				const retired = [
					...(srcs.length === l.images.length ? (l.retired ?? []).flatMap(bothOf) : []),
					...gone,
					// A picture this row still places, but under a path this host no longer serves it
					// from. NOT gated on the row being complete like the retirees above: this is a
					// rename with its replacement in hand, so there is nothing to wait for, and
					// leaving it would put the same illustration on the page twice — once broken.
					...l.images.filter((im) => available.has(im.out)).flatMap((im) => renamedOf(im.out)),
				];
				if (!srcs.length && !retired.length) continue; // nothing to place and nothing to retire
				const worldEntries = worldBySource.get(jrnSource(l.journalEntryId)) ?? [];
				const worldNeedsArt = worldEntries.length && (!cheapWorldSkip || worldEntries.some(
					(e) => srcs.some((src) => !entryHasSrc(e, src)) || retired.some((r) => entryHasSrc(e, r))));
				if (onlyWorld && !worldNeedsArt) continue;
				const page = (await jrnPack.getDocument(l.journalEntryId))?.pages?.get(l.journalPageId);
				if (!page) continue;
				if (!onlyWorld) {
					const cns = locationSectionsWithArt(page.system?.sections, l.sectionIndex, srcs, l.name, retired);
					if (cns) { await page.update({ "system.sections": cns }); locPages++; }
				}
				worldJournalPages += await applyWorldPages(worldEntries, page, "system.sections",
					(wp) => locationSectionsWithArt(wp.system?.sections, l.sectionIndex, srcs, l.name, retired), noteEntry);
			} catch (e) { errors++; error(`Book II art re-apply: location "${l.slug}"`, e); }
		}

		// 2.5 Setting Overview maps embedded into the setting journal's plain text pages
		//    (+ their world copies). An update resets the compendium to the shipped (art-less)
		//    page and re-seeds pristine world copies from it, so this pass is the ONLY thing
		//    putting the map back. Idempotent, and a no-op on any page showing a map we don't
		//    own (a GM's own labelled variant). Which file each row shows, and which it
		//    supersedes, was resolved once up front (see `mapPicks`).
		for (const { s, src, replaces } of mapPicks) {
			try {
				const worldEntries = worldBySource.get(jrnSource(s.journalEntryId)) ?? [];
				// "Has the map" is not enough to call an entry done: a page carrying this map AND
				// a superseded one still needs the old one stripped, so ask about both. Missing
				// this would re-shadow exactly what textPageWithManagedMap's strip-first order fixes.
				const worldNeedsArt = worldEntries.length && (!cheapWorldSkip || worldEntries.some(
					(e) => !entryHasSrc(e, src) || replaces.some((old) => entryHasSrc(e, old))));
				if (onlyWorld && !worldNeedsArt) continue;
				const page = (await jrnPack.getDocument(s.journalEntryId))?.pages?.get(s.journalPageId);
				if (!page) continue;
				if (!onlyWorld) {
					const nd = textPageWithManagedMap(page.text?.content, src, s.name, replaces);
					if (nd != null) { await page.update({ "text.content": nd }); soPages++; }
				}
				worldJournalPages += await applyWorldPages(worldEntries, page, "text.content",
					(wp) => textPageWithManagedMap(wp.text?.content, src, s.name, replaces), noteEntry);
			} catch (e) { errors++; error(`Book II art re-apply: setting-overview map "${s.slug}"`, e); }
		}

		// 3. World actors imported from the bestiary. Unlike the compendium docs these SURVIVE
		//    an update, so this pass is conservative (worldMonsterArtUpdate): re-point a stale
		//    "already ours" pointer the root change broke, OR adopt the art over a shipped
		//    creature-type placeholder the seeded actor still carries — never a custom portrait.
		//    Runs on the full pass AND the every-load world-only self-heal (like the steading
		//    §3.5, and for the same reason: an established world whose bestiary actors were
		//    seeded AFTER the version was stamped never sees the full pass again, so the
		//    self-heal is the only thing that adopts their art). Skipped only on a scoped
		//    journal import (Array.isArray(entries)), which must not touch actors.
		if (!Array.isArray(entries)) {
			// Index the world actors by their compendium source ONCE, so the per-monster loop is a
			// map lookup instead of a full game.actors rescan per monster. This pass runs on every GM
			// load via the world-only self-heal, so an O(monsters × actors) rescan is real per-load
			// work; the index makes it O(actors + monsters). An actor is filed under BOTH its
			// `_stats.compendiumSource` and its legacy `core.sourceId` (deduped) to match the old
			// OR check exactly, since either can be the pointer at our compendium actor.
			const actorsBySource = new Map();
			for (const a of game.actors) {
				for (const s of new Set([a._stats?.compendiumSource, a.getFlag?.("core", "sourceId")])) {
					if (!s) continue;
					if (!actorsBySource.has(s)) actorsBySource.set(s, []);
					actorsBySource.get(s).push(a);
				}
			}
			for (const m of monsters) {
				const uuid = `Compendium.${m.actorPack ?? BES_PACK}.Actor.${m.actorId}`;
				// The token square counts as one of OUR paths too. Both directions need it: a token
				// still on the whole illustration has to be recognised so it can move ONTO the
				// square, and a token already on a square has to be recognised so clearing that
				// square in the picker moves it back rather than stranding it on a deleted file.
				const ourOuts = [m.out, ...(m.tokenOut ? [m.tokenOut] : []), ...(m.retired ?? [])];
				// Matched as path TAILS, so a stored path resolves whether it was written bare or
				// under a host prefix. Kept alongside the outs they came from rather than sliced
				// back out of, since the absence check below asks about the out.
				const tails = ourOuts.map((o) => `/${o}`);
				const worldOnes = actorsBySource.get(uuid) ?? [];
				// This monster's picture is NOT on disk. Clearing a pointer at it is only honest if
				// we can tell "this one file is missing" from "the browse came back empty", so it is
				// gated on some OTHER monster's art being present: that proves the bestiary folder
				// was read and has content. Without the gate a transient FilePicker failure would
				// strip all 73 portraits at once, and while the next load would re-adopt them, the
				// churn is exactly the kind of alarming that a self-heal must never cause.
				if (!available.has(m.out)) {
					if (!monstersOnDisk) continue;
					// Only the paths that are actually GONE, which is not the same list as `tails`.
					// A creature's token square is stored separately from the illustration it was
					// cut from, so the square can sit happily on disk while that illustration is
					// missing — and the reset is field-by-field, so handing it the whole list would
					// wipe a working token back to the creature-type icon on the strength of the
					// OTHER file's absence. A retired path is never `available`, so it still resets.
					const goneTails = ourOuts.filter((o) => !available.has(o)).map((o) => `/${o}`);
					for (const a of worldOnes) {
						try {
							const upd = staleMonsterArtReset(a, goneTails);
							if (upd) { await a.update(upd); worldActors++; }
						} catch (e) { errors++; error(`Book II art re-apply: world actor "${a.name ?? a.id}"`, e); }
					}
					continue;
				}
				const src = servedOf(m.out);
				const tokSrc = tokenSrcOf(m, src);
				// Is this creature's token being moved onto its own SQUARE, as opposed to the whole
				// illustration it falls back to? Counted apart from `worldActors`, because the two
				// answer different questions: `worldActors` is "how many documents did this pass
				// write", which includes a portrait re-point and a stale reset, while the rebuild
				// reports "N creatures now use their token square" and must not claim ones that did
				// not move — least of all when the manifest names no squares and none could have.
				const toSquare = !!(m.tokenOut && available.has(m.tokenOut));
				for (const a of worldOnes) {
					try {
						const upd = worldMonsterArtUpdate(a, src, tails, tokSrc);
						if (upd) { await a.update(upd); worldActors++; }
						if (toSquare && upd?.[TOKEN_SRC_KEY] === tokSrc) worldTokens++;
					} catch (e) { errors++; error(`Book II art re-apply: world actor "${a.name ?? a.id}"`, e); }
				}
			}
		}

		// 3.5 The steading portrait — the world "Stonetop" sheet. A durable WORLD actor created
		//    at runtime with no compendium id (found by type), and until now the ONE piece of
		//    book art with no re-apply safety net: the Import Book Art macro's one-shot pass was
		//    the only thing that ever wired it, so if that single swap didn't land the portrait
		//    stayed the shipped "S" emblem forever. This is that safety net. The monster world
		//    actors above adopt over their creature-type placeholder the same way (worldMonsterArtUpdate),
		//    but they carry a stable compendium id, so this pass differs by finding its target: the
		//    steading is a document-less singleton with no compendium id, matched by type. The guard is
		//    placeholder-based (isSteadingPlaceholderImg): take the book art over a shipped placeholder
		//    only, never a portrait the group chose.
		//    Idempotent. Runs on the full pass AND the every-load self-heal, but not on a scoped
		//    journal import (Array.isArray(entries)) — that must not touch actors. artUpdate forces
		//    the token fit like the macro does; safe here because we only ever touch a placeholder.
		if (!Array.isArray(entries)) for (const s of steadings) {
			if (!present.has(srcOf(s.out))) continue;
			try {
				const actor = game.actors?.find((a) => a.type === STEADING_ACTOR_TYPE);
				if (!actor || !isSteadingPlaceholderImg(actor.img)) continue;
				const upd = artUpdate(actor, servedOf(s.out));
				if (upd) { await actor.update(upd); steadingActors++; }
			} catch (e) { errors++; error(`Book II art re-apply: steading "${s.slug}"`, e); }
		}

		// 4. Keep the managed-journal baseline in sync for the pristine world journals we
		//    added art to, so the journal channel keeps treating them as pristine and
		//    keeps delivering future prose updates. Edited entries keep their edited hash.
		//    A per-entry failure here isn't counted as a retryable error: the embed already
		//    landed and is idempotent, so a retry would not re-touch the entry to re-stamp it.
		for (const [entry, { base, pristine }] of touchedEntries) {
			if (!pristine) continue;
			try { await entry.setFlag(SYSTEM_ID, "journalSync", { hash: managedHash(entry.toObject()), version: base?.version ?? version }); }
			catch (e) { error(`Book II art re-apply: journal re-stamp "${entry?.name}"`, e); }
		}
	} finally {
		for (const p of relock) { try { await p.configure({ locked: true }); } catch (_) { /* best-effort relock */ } }
	}

	// Re-render any world journals we embedded art into that are OPEN right now, so the art
	// shows without a reload. page.update() only live-refreshes a journal that was already
	// open at the instant of the write; the sidebar is interactive before this pass finishes,
	// so a GM who opens a journal mid-pass would otherwise see its pre-art render until an F5.
	rerenderOpenJournals(touchedEntries.keys());
	// Same for the compendia: if we re-pointed any compendium actor or journal page, refresh
	// its open browser/sheet so the art appears live (the compendium does not auto-refresh).
	if (actors + besPages + codexPages + locPages + soPages > 0) rerenderOpenCompendia([besPack, jrnPack]);

	const total = actors + besPages + codexPages + locPages + soPages + worldActors + worldJournalPages + steadingActors;
	if (total) {
		info(`Book II art applied: ${actors} actors, ${besPages + codexPages + locPages + soPages} compendium journal pages, ${worldJournalPages} world journal pages, ${worldActors} world actors${steadingActors ? ", steading portrait" : ""}.`);
		// The console line always goes out; the TOAST is suppressible. A caller running this as one
		// step of a larger job reports that job's own result, and two unrelated notifications for one
		// button press reads as two things having happened.
		if (!quiet) ui.notifications?.info(`Stonetop: added Book II art to ${total} ${total === 1 ? "entry" : "entries"}.`);
	}
	return { errors, total, actors, besPages, codexPages, locPages, soPages, worldActors, worldJournalPages, steadingActors, worldTokens };
}

// The version-change trigger: run the full re-apply ONCE per system version, then stamp
// the version so it doesn't repeat until the next update. Guards (non-GM, already-synced)
// come before any disk work. A pass that couldn't run (nothing on disk yet) or that hit a
// per-item error leaves the version UNSTAMPED so the next load retries (every write is
// idempotent) instead of poisoning the version with a partial apply.
//
// Returns the pass's stats, or null when it didn't run — which is how the first-load setup
// window (hooks/WorldSetup.js) tells "we found the art you already imported and wired it in"
// from "you have no book art on disk yet" without browsing the folder a second time.
export async function reapplyBook2ArtOnVersionChange() {
	if (!game.user?.isGM) return null;
	const version = game.system.version;
	if (getSetting("book2ArtSyncVersion") === version) return null;

	const result = await reapplyBook2Art();
	if (!result) return null; // nothing on disk yet -> retry next load, version left unstamped
	if (result.errors) {
		error(`Book II art re-apply: ${result.errors} item(s) failed; leaving the version unstamped to retry next load.`);
		return result;
	}
	await setSetting("book2ArtSyncVersion", version);
	return result;
}

// --- Manual-import trigger (a debounced createJournalEntry hook) -----------------------
//
// When a GM drags one (or a folder) of our journals in from the compendium mid-version,
// the once-per-version re-apply above won't fire again, so the fresh world copy would
// come in art-less. This catches it: collect the imported entries, and on a short debounce
// (so a folder-import burst — and our own seed's create storm — collapse to a single pass)
// embed their durable art. cheapWorldSkip keeps it free for entries that already match.
const _pendingImportIds = new Set();
let _importFlushTimer = null;
function _scheduleImportFlush() {
	if (_importFlushTimer) clearTimeout(_importFlushTimer);
	_importFlushTimer = setTimeout(async () => {
		_importFlushTimer = null;
		const entries = [..._pendingImportIds].map((id) => game.journal?.get?.(id)).filter(Boolean);
		_pendingImportIds.clear();
		if (!entries.length) return;
		try { await reapplyBook2Art({ entries, cheapWorldSkip: true }); }
		catch (err) { console.error("Stonetop | Book II art on journal import failed:", err); }
	}, 400);
}

// createJournalEntry hook handler. GM-only, and only for the user who did the import (so a
// second GM's client doesn't redundantly re-run it). No-op unless the new entry is a world
// copy of one of our journal-pack entries.
export function handleImportedJournalArt(entry, _options, userId) {
	if (!game.user?.isGM || game.user.id !== userId) return;
	const src = compendiumSourceOf(entry);
	if (!isOurCompendiumRef(src, { packs: ["stonetop-journal"] })) return;
	if (!entry?.id) return;
	_pendingImportIds.add(entry.id);
	_scheduleImportFlush();
}
