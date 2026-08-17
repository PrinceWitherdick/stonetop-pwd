// Pure helpers for embedding Book II art into journal pages, shared by the runtime
// re-apply (reapply.js) and mirrored inline by the bring-your-own-book macro
// (scripts/local/book2-art/import-book2-art.js). Foundry-free so the embed + match
// logic is unit-testable: callers pass plain strings / arrays; these decide what the
// new content should be and return null when nothing needs to change, so no-op writes
// are skipped and counters stay honest.
//
// Three journal shapes are handled: a "bestiary" codex page keeps its prose in
// system.description, a "location" page in system.sections[].body, and a plain "text"
// page (the Setting Overview's regional-map pages) in text.content. The embed markup +
// `stonetop-journal-art` class match what the macro's compendium pass writes, so the
// idempotency check (does the body already reference this src?) works across paths.

import { escapeRegExp } from "../utils/strings.js";

const ART_CLASS = "stonetop-journal-art";
const MAP_FIGURE_CLASS = "stonetop-map";

function esc(s) {
	return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// The exact <p><img …></p> embed the compendium/world passes write. Kept in one place
// so every path produces identical markup (and so the idempotency + insertion regex
// below stay in lockstep with it).
export function artEmbed(src, name) {
	return `<p><img class="${ART_CLASS}" src="${src}" alt="${esc(name)}"></p>`;
}

// New bestiary-page description with the art embed prepended, or null if this src is
// already embedded and there is nothing stale to clear. Idempotent on the src path (not
// the whole embed), so re-running with a different alt never double-adds.
//
// `retired` names art a PRIOR manifest embedded on this page and this system no longer
// names: where two creatures turned out to be drawn in one picture, they now share the one
// FILE, and the loser's path has to come off the page or the same illustration sits on it
// twice. Keyed on the embed, not on a file, so it still clears after the file is gone. A src
// that is still wanted is never retired.
//
// A null `src` means STRIP ONLY: this row's picture is not on disk, so there is nothing to
// place, but whatever a previous import left on the page has to come off or the reader gets a
// broken image. The caller passes the absent path through `retired`, which is the same
// mechanism and for the same reason — it keys on the embed rather than on a file, so it works
// precisely when the file is the thing that is gone. Nothing is ever inserted in this mode,
// including a `name` the caller may still have passed.
export function bestiaryDescriptionWithArt(description, src, name, retired = []) {
	const desc = String(description ?? "");
	const dead = [];
	for (const r of retired ?? []) if (r && r !== src && !dead.includes(r) && bodyHasSrc(desc, r)) dead.push(r);
	if (!src) {
		if (!dead.length) return null;
		let stripped = desc;
		for (const r of dead) stripped = stripSrcEmbed(stripped, r);
		return stripped;
	}
	// `bodyHasSrc`, not a raw substring: "on the page" has to mean the same thing in both halves
	// of this function. A page can name the path without carrying the picture — a GM's note, an
	// href, an HTML comment — and a substring check reads that as "already embedded" and blocks
	// the art from ever being added, while the retired half above would correctly see no image.
	const has = bodyHasSrc(desc, src);
	if (has && !dead.length) return null;
	let next = desc;
	for (const r of dead) next = stripSrcEmbed(next, r);
	return has ? next : artEmbed(src, name) + next;
}

// A minimal top-of-page prose section, used only as a last-resort home for art when a
// page has no sections left to place it in (see below). Empty heading + the "glance"
// act (which the page sheet renders with no divider and directly under the title), so
// the lifted art reads as a plain banner. Matches LocationPageModel's section schema.
function leadArtSection(body) {
	return { kind: "prose", heading: "", group: "glance", danger: false, body, pairs: [], groups: [] };
}

// A fresh global matcher for our canonical embeds. Fresh each call because a global regex
// carries `lastIndex` state that must never leak between calls. Used only to find the
// insertion point (after the last embed already there); detection + stripping match by
// `src` instead (below), so they survive markup that the wrapper regex no longer fits.
const artEmbedRe = () => new RegExp(`<p><img class="${ART_CLASS}"[^>]*></p>`, "g");


// Managed art is detected and stripped by its exact `src` — the durable-art path this
// system generates — NOT by the surrounding wrapper markup. A GM who opens a location
// page re-saves its sections through ProseMirror, which normalizes each <img> (reorders
// attributes, and can drop our class), so a wrapper-shaped regex would stop recognizing
// art it had already placed and re-insert a duplicate on the next re-apply (while failing
// to strip the old copy during relocation). Keying on `src="<path>"` (quote-delimited, so
// one path is never a prefix of another) stays robust to that. Every path through this module
// asks the question this way — the bestiary page included — so "the page already has this art"
// means one thing everywhere.
const imgTagForSrc = (src) => new RegExp(`<img\\b[^>]*\\ssrc="${escapeRegExp(src)}"[^>]*>`, "gi");

// True if `body` already carries an <img> for exactly this src.
function bodyHasSrc(body, src) {
	return imgTagForSrc(src).test(String(body ?? ""));
}
// `body` with the managed embed(s) for this exact src removed — the <img>, plus its
// wrapping <p> when the <img> is that paragraph's sole content (so relocation leaves no
// empty paragraph behind). Any other art is left intact.
function stripSrcEmbed(body, src) {
	const s = escapeRegExp(src);
	return String(body ?? "")
		.replace(new RegExp(`<p\\b[^>]*>\\s*<img\\b[^>]*\\ssrc="${s}"[^>]*>\\s*</p>`, "gi"), "")
		.replace(imgTagForSrc(src), "");
}

// New location `sections` array that places this row's art in the manifest's target
// section — AUTHORITATIVELY — or null if the page already matches. `srcs` is the ordered
// list of on-disk art paths the manifest assigns to `sectionIndex` (already filtered to
// what exists on disk). Returns a fresh array (the caller's live document data is never
// mutated in place).
//
// The manifest is the source of truth for WHERE each illustration lives: an embed found
// in some OTHER section is RELOCATED into the target section (stripped from where it was,
// re-inserted here), so re-sectioning an image in the picker actually moves it on the page
// instead of being ignored as "already present somewhere". Within the target section, art
// is inserted after the last embed already there, keeping book order; each src appears
// once. An already-correct page (every src in the target section, none lingering
// elsewhere) is a no-op → null, so re-applies don't churn documents.
//
// `retired` is art a PRIOR manifest placed that this system no longer names (e.g. a
// duplicate extraction removed from the manifest). Each retired src is stripped from every
// section and NEVER re-inserted, so removing an image from the manifest actually clears it
// from already-imported worlds on the next pass instead of stranding an orphan the strip
// set no longer covers. A src that is still `wanted` is never treated as retired.
//
// Placement is resilient to a GM reshaping the page:
//   • if the target section was deleted (index out of range, or a falsy hole) the art
//     falls back to the FIRST real section — the top — so it is never silently dropped; and
//   • if every section has been deleted, a minimal prose section is synthesised at the top
//     to hold it (the page sheet lifts a leading embed into a banner; see journal/lead-art.js).
export function locationSectionsWithArt(sections, sectionIndex, srcs, name, retired = []) {
	const list = Array.isArray(sections) ? sections : [];
	const wanted = [];
	for (const s of srcs ?? []) if (s && !wanted.includes(s)) wanted.push(s);
	// Retired srcs to strip-but-never-place; a still-wanted src is never counted retired.
	const dead = [];
	for (const s of retired ?? []) if (s && !wanted.includes(s) && !dead.includes(s)) dead.push(s);
	if (!wanted.length && !dead.length) return null;

	// Target the manifest's section; if it's gone (out of range or a falsy hole) fall back
	// to the first real section. findIndex returns -1 for an empty or all-empty list.
	const requested = sectionIndex ?? 0;
	const targetIdx = list[requested] ? requested : list.findIndex((s) => s);

	// No-op fast path: every wanted src already sits in the target section and nowhere else,
	// and no retired src lingers in any section.
	const targetBody = targetIdx >= 0 ? (list[targetIdx].body ?? "") : "";
	let needsWork = wanted.some((src) => !bodyHasSrc(targetBody, src));
	for (let i = 0; i < list.length && !needsWork; i++) {
		if (!list[i]) continue;
		const body = list[i].body ?? "";
		needsWork = (i !== targetIdx && wanted.some((src) => bodyHasSrc(body, src)))
			|| dead.some((src) => bodyHasSrc(body, src));
	}
	if (!needsWork) return null;

	// Strip every wanted AND retired src out of every section (new objects only where the
	// body changed) so the re-insert below gives each wanted src a single, authoritative
	// home while every retired src is gone for good.
	const next = list.slice();
	for (let i = 0; i < next.length; i++) {
		const sec = next[i];
		if (!sec) continue;
		let body = sec.body ?? "";
		for (const src of wanted) body = stripSrcEmbed(body, src);
		for (const src of dead) body = stripSrcEmbed(body, src);
		if (body !== (sec.body ?? "")) next[i] = { ...sec, body };
	}

	if (!wanted.length) return next; // retired-only cleanup: nothing to re-insert
	const add = wanted.map((src) => artEmbed(src, name)).join("");
	if (targetIdx < 0) return [leadArtSection(add)]; // page had no sections at all

	// Insert into the target section after its last remaining art embed (book order).
	const sec = next[targetIdx];
	const body = sec.body ?? "";
	const re = artEmbedRe();
	let lastEnd = -1, m;
	while ((m = re.exec(body))) lastEnd = m.index + m[0].length;
	next[targetIdx] = { ...sec, body: lastEnd >= 0 ? body.slice(0, lastEnd) + add + body.slice(lastEnd) : add + body };
	return next;
}

// New content for ONE field of a curated bestiary codex page — AUTHORITATIVELY — or null
// if the field already matches. This is what makes "don't show this one" actually remove a
// picture instead of merely failing to add it, which the additive bestiaryDescriptionWithArt
// above can never do (it only ever prepends, and only when the src is absent).
//
// `curation` is one manifest `codex` entry, with its art paths already resolved to page
// srcs by the caller:
//   • `managed` — EVERY src this entry owns (every peer monster row's art), whether or not
//     it is currently placed. This is the strip set: art the user de-selected is only in
//     here, which is exactly how it leaves the page.
//   • `slots`   — [{ slot, images: [{ src, name }] }], the art the user chose to show, in
//     manifest row order. The caller filters these to what exists on disk, so a GM with a
//     partial import never gets a broken <img>; `managed` stays complete regardless, so a
//     missing file can still be stripped.
//
// `field` is the page field being rebuilt, and only two ever host art: bestiary.hbs enriches
// system.description and system.nests (triple-stache), while every other codex field is
// escaped — system.notes is an HTMLField but renders double-stache, and the rest go through
// inlineMarkup, which escapes everything but a **bold** run. An <img> anywhere else would
// render as literal text, so those fields are not slots and this returns null for them.
//
// Placement within a field: `banner` goes to position 0 of system.description, which is
// precisely what journal/lead-art.js hoists into the page banner (its match is ^-anchored),
// so today's look is expressible rather than special-cased. `description` appends after the
// prose, and `nests` appends after the Lair & Habitat prose.
//
// Strip-then-insert with no `includes(src)` fast path: an already-correct field falls out as
// a no-op because the rebuilt string equals the original, and that same rebuild is what
// relocates an image whose slot changed.
export function codexFieldWithArt(body, field, curation) {
	const original = String(body ?? "");
	const imagesFor = (slot) => (curation?.slots ?? []).find((s) => s.slot === slot)?.images ?? [];
	const embeds = (list) => list.map((i) => artEmbed(i.src, i.name)).join("");

	// Strip every src this entry owns, so what goes back is only what the user chose and a
	// de-selected image has no way to survive.
	let stripped = original;
	for (const src of curation?.managed ?? []) if (src) stripped = stripSrcEmbed(stripped, src);

	let next;
	if (field === "description") next = embeds(imagesFor("banner")) + stripped + embeds(imagesFor("description"));
	else if (field === "nests") next = stripped + embeds(imagesFor("nests"));
	else return null;

	return next === original ? null : next;
}

// The <figure> embed for a Setting Overview regional map. Distinct markup from the
// bestiary/location illustrations (a captioned, column-bounded figure rather than a
// framed inline <img>), matching the private project's setting-journal map pages.
export function mapFigureEmbed(src, name) {
	return `<figure class="${MAP_FIGURE_CLASS}"><img src="${src}" alt="${esc(name)}"></figure>`;
}

// `html` with a map figure for exactly this src removed. Matches ANY <figure> wrapping an
// <img> for the src — the class and attribute order are deliberately not part of the match,
// because a GM who opens and saves the page re-writes it through ProseMirror, which
// normalizes attributes and can drop our class. Non-greedy to the first </figure>, so a
// second figure further down the page is never swallowed.
function stripMapFigure(html, src) {
	const s = escapeRegExp(src);
	return String(html ?? "").replace(
		new RegExp(`<figure\\b[^>]*>(?:(?!</figure>)[\\s\\S])*?<img\\b[^>]*\\ssrc="${s}"[^>]*>(?:(?!</figure>)[\\s\\S])*?</figure>`, "gi"),
		"");
}

// Every managed shape this system might have left behind for `src`: the map <figure>, and
// (if ProseMirror unwrapped it) a bare <img> or its sole-content <p>. Keyed on the src path
// only, so it survives markup churn.
function stripManagedMap(html, src) {
	return stripSrcEmbed(stripMapFigure(html, src), src);
}

// New text-page content for a Setting Overview map page: this map figure at the top,
// replacing a map WE previously wrote (any src in `replaceSrcs`) if one is there. Returns
// null when nothing should change. With an empty `replaceSrcs` this is the plain
// "prepend, but never stack a second map" primitive.
//
// `replaceSrcs` exists because the Book II page crop and the user-supplied poster map it
// supersedes live at DIFFERENT paths (the poster map still backs its Scene, so it must not
// be overwritten in place). Without it, a page already showing the poster map would trip the
// any-map rule below and skip the new map FOREVER, on exactly the worlds that had already
// imported.
//
// Ordering is load-bearing: strip ours BEFORE the any-map check, so our own superseded map
// cannot block its replacement, while a `stonetop-map` figure we don't recognise (a GM's own
// labelled variant) still does. The "never stack, never clobber the GM's map" contract is
// unchanged for every file except the exact ones this system put there.
//
// The superseded maps are stripped BEFORE the "already ours" check too, and the no-op is
// decided by comparing the rebuilt string to the original (the same way codexFieldWithArt
// does). An `includes(src)` fast path ahead of the strip would return null on a page that
// carries BOTH this map and a superseded one — which is exactly the page that still needs
// work — leaving the two stacked, permanently, since the fast path would fire on every
// future pass as well.
export function textPageWithManagedMap(content, src, name, replaceSrcs = []) {
	const original = String(content ?? "");
	let html = original;
	for (const old of replaceSrcs ?? []) if (old && old !== src) html = stripManagedMap(html, old);
	// Already carrying this map: whatever the strip left is the final content, so this is a
	// no-op only when nothing was superseded.
	if (html.includes(src)) return html === original ? null : html;
	if (html.includes(`class="${MAP_FIGURE_CLASS}"`)) return html === original ? null : html; // a map we don't own: preserve it
	return mapFigureEmbed(src, name) + html;
}

// Find the page within a world JournalEntry that corresponds to a compendium page.
// Match by id first (stable on a fresh seed, where fromCompendium keeps embedded ids)
// then fall back to name + type: the managed-journal refresh recreates pages with
// fresh ids (SeedCompendiums.js createEmbeddedDocuments … keepId:false), so id-matching
// alone would miss a world whose entry has been refreshed. `pages` may be an array or a
// Foundry EmbeddedCollection. Returns the page doc or null.
export function matchWorldPage(pages, pageId, pageName, pageType) {
	const list = Array.isArray(pages) ? pages : (pages?.contents ?? (pages ? Array.from(pages) : []));
	return list.find((p) => (p.id ?? p._id) === pageId)
		?? (pageName ? list.find((p) => p.name === pageName && p.type === pageType) : null)
		?? null;
}
