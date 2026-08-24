// Make the treasures described in Book II journals (the "Artifacts", "Curiosities and
// wonders", "Treasures of the Golden Oak" and flora "Sample specimens" sections)
// draggable onto a character sheet or the Items sidebar as inventory items — and, while
// we're there, restore the ◇ load-weight and ○ uses the rulebook prints beside each
// item (both were dropped when the book was extracted into the journals).
//
// The weights/uses live in a catalog recovered straight from the Book II PDF (see
// module/data/treasure-catalog.js and scripts/local/treasures/). This enhancer matches
// each rendered treasure line back to its catalog entry by the item's name, stamps a
// small ◇/○ badge onto the line, and wires the line (and, for the couple of compound
// entries, per-item chips) to emit a native Foundry `{type:"Item", data}` drop that the
// character sheet's inventory branch and the Items directory both already understand.
import { TREASURE_CATALOG } from "../data/treasure-catalog.js";
import { buildInventoryItemData } from "./inventory-item-data.js";
import { wrapGearNoteTerms, buildUsesResource } from "./gear-note.js";
import { slugify } from "./strings.js";
import { book2ArtSrc } from "../book2-art/art-root.js";
import { isInJournalEditor } from "./journal-editor-guard.js";
import { STONETOP_ITEM_ICONS } from "./item-icon.js";
import { SYSTEM_ID } from "../system-id.js";

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// catalog grouped by section (journal entry name) → origin → entries (usually one; two
// for the split compounds). Built once.
const BY_SECTION = new Map();
for (const e of TREASURE_CATALOG) {
	const sec = norm(e.section);
	if (!BY_SECTION.has(sec)) BY_SECTION.set(sec, new Map());
	const byOrigin = BY_SECTION.get(sec);
	const key = norm(e.origin);
	if (!byOrigin.has(key)) byOrigin.set(key, { origin: e.origin, originNorm: key, items: [] });
	byOrigin.get(key).items.push(e);
}
// origin groups per section, sorted longest-origin-first so a line matches its most
// specific treasure (e.g. prefer "A silver sarcophagus…" over a shorter coincidence).
const GROUPS_FOR = new Map();
for (const [sec, byOrigin] of BY_SECTION) {
	GROUPS_FOR.set(sec, [...byOrigin.values()].sort((a, b) => b.originNorm.length - a.originNorm.length));
}
// Fallback pool (all groups) for when the journal's entry name can't be resolved.
const ALL_GROUPS = [...GROUPS_FOR.values()].flat().sort((a, b) => b.originNorm.length - a.originNorm.length);

/**
 * Origin groups to match a journal against. Scoped strictly to the journal's entry name
 * so treasure-shaped lines in unrelated journals aren't decorated; only when the entry
 * name can't be resolved at all do we fall back to the (specific) global pool.
 */
function groupsFor(entryName) {
	if (entryName == null || entryName === "") return ALL_GROUPS;
	return GROUPS_FOR.get(norm(entryName)) ?? [];
}

/** The catalog origin group whose name begins `text`, longest match first, or null. */
function matchGroup(text, groups) {
	for (const g of groups) {
		if (text === g.originNorm || text.startsWith(g.originNorm + " ")) return g;
	}
	return null;
}

/**
 * The Book II illustration for a treasure, or null when this world hasn't got it.
 *
 * The art is extracted from the GM's own PDF by the "Import Book Art" macro into a durable
 * folder (`book2ArtRoot`). Which of those files actually exist is published to the
 * world-scoped `treasureArt` index by the GM-side passes (the macro, and book2-art/reapply.js
 * on load), each mapped to its path within the folder — a player can't browse the filesystem,
 * so reading the index is both the only way to know AND synchronous, which matters because
 * the drop payload has to be built inside the dragstart handler.
 *
 * Returns null unless the slug is in the index, so an item never points at a missing file
 * (a world that never imported the art just gets Foundry's default item icon, as before).
 */
function treasureArtSrc(slug) {
	if (!slug) return null;
	const settings = globalThis.game?.settings;
	// guarded: this module is unit-tested outside Foundry, and the setting is absent in a
	// world running an older system version that hasn't registered it yet
	if (!settings?.settings?.has?.(`${SYSTEM_ID}.treasureArt`)) return null;
	try {
		const out = settings.get(SYSTEM_ID, "treasureArt")?.[slug];
		return out ? book2ArtSrc(out) : null;
	} catch (_) {
		return null;
	}
}

/**
 * Build the native Foundry drop data for one catalog entry: a `move`/`inventory` Item
 * whose system + flags carry the recovered column, weight, note (tags + Value) and uses
 * track, plus the book's illustration when this world has imported it. Treasures the book
 * doesn't draw carry no img, so Foundry gives the item its default icon (we never invent
 * one). Immobile treasures (no ◇, can't be carried) are recorded in the small column with
 * their "immobile" tag intact. The character sheet's `_onDropItemCreate` re-plants it as an
 * `inventory-custom` item; the Items sidebar stores it as a world item.
 */
export function treasureItemData(entry) {
	const column = entry.column === "regular" ? "regular" : "small";
	const rawNote = [entry.note, entry.value ? `Value ${entry.value}` : null].filter(Boolean).join(", ");
	const note = wrapGearNoteTerms(rawNote);
	let resource = null;
	if (entry.uses > 0) {
		resource = buildUsesResource(entry.uses, false);
		if (entry.usesLabel) resource.title = entry.usesLabel;
	}
	const data = buildInventoryItemData({
		name: entry.name, column, weight: entry.weight, note, resource, moveType: "inventory", isTreasure: true,
		// The book's own illustration when this world has imported it; otherwise null, so
		// buildInventoryItemData omits it and the item takes Foundry's default icon.
		img: treasureArtSrc(entry.slug),
		// And the book's own text, into the p.430 "fuller write-up" slot. That field rather
		// than `system.description` because it is the one the gear row already prints AND the
		// one the identify ladder already conceals: a treasure the GM lands as an unidentified
		// artifact must not hand over its custom move with the picture. `state` is deliberately
		// left off — the write-up travels with every treasure, and whether this particular find
		// starts hidden is the drop's call (addDroppedInventoryItem reads `hideArtifact`), not
		// the catalog's. Entries the book prints no prose for pass undefined and get no field.
		artifact: entry.writeup ? { lore: entry.writeup } : null,
	});
	// Mirror the gear metadata into flags.stonetop as well, so addDroppedInventoryItem
	// resolves it whichever source it reads first, and a sidebar copy keeps a slug.
	// NB: `flags.stonetop.slug` is the item's own name-slug (what the gear code matches on),
	// NOT the catalog's section-qualified slug that names the art file — art is resolved
	// here, at drag time, and baked into `data.img`, so nothing downstream needs that one.
	data.flags = { stonetop: { slug: slugify(entry.name), inventoryColumn: data.system.inventoryColumn, isTreasure: true } };
	if (data.system.weight != null) data.flags.stonetop.weight = data.system.weight;
	if (data.system.note) data.flags.stonetop.note = data.system.note;
	if (data.system.resource) data.flags.stonetop.resource = data.system.resource;
	return data;
}

function writeDrag(ev, entry) {
	ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", data: treasureItemData(entry) }));
	ev.dataTransfer.effectAllowed = "copy";
}

// The ◇/○ glyph badge the book prints beside a treasure. Weight = ◇×N (small = one small
// ▫, immobile = a dolly), uses = ○×N with any label ("hours"). The diamonds and circles
// are drawn as this system's SVG/mask glyphs (`stonetop-glyph--diamond`/`--circle`), the
// same ones journal prose uses, rather than the raw ◇/○ font characters — those read far
// too small. The badge CSS sizes them up and paints each in the badge's own colour.
function badgeHtml(entry) {
	const parts = [];
	if (entry.column === "immobile") parts.push(`<span class="st-treasure-weight st-immobile" data-tooltip="Immobile: needs a cart or beast to move, not a personal-load item"><i class="fas fa-dolly"></i></span>`);
	else if (entry.weight > 0) parts.push(`<span class="st-treasure-weight" data-tooltip="Load ${entry.weight}">${diamondGlyphs(Math.min(entry.weight, 6))}</span>`);
	else parts.push(`<span class="st-treasure-weight st-small" data-tooltip="Small item (no load)">▫</span>`);
	if (entry.uses > 0) {
		const label = entry.usesLabel ? ` <em>${entry.usesLabel}</em>` : "";
		parts.push(`<span class="st-treasure-uses" data-tooltip="${entry.uses} use${entry.uses === 1 ? "" : "s"}${entry.usesLabel ? " (" + entry.usesLabel + ")" : ""}">${circleGlyphs(Math.min(entry.uses, 8))}${label}</span>`);
	}
	return parts.join("");
}

// A run of N load-diamonds as this system's masked-SVG glyph. All but the last carry
// `--joined` so consecutive diamonds sit tight, matching the journal-prose load tracks.
function diamondGlyphs(n) {
	let out = "";
	for (let i = 0; i < n; i++) out += `<span class="stonetop-glyph stonetop-glyph--diamond${i < n - 1 ? " stonetop-glyph--joined" : ""}">◇</span>`;
	return out;
}

// A run of N use-circles as this system's CSS-drawn ring glyph — crisp at any size,
// unlike the thin ○ font character. (Unlike diamonds, circles carry no `--joined`, so
// they're just the one glyph repeated.)
function circleGlyphs(n) {
	return `<span class="stonetop-glyph stonetop-glyph--circle">○</span>`.repeat(n);
}

// Short label for a compound sub-item's chip: the parenthetical in its name, else name.
function chipLabel(entry) {
	const m = entry.name.match(/\(([^)]*)\)\s*$/);
	return m ? m[1] : entry.name;
}

// Longest origin we'll lift into a cell's header. Chosen off the catalog's own
// spread: ~80% of origins come in under it as one complete phrase, and the rest
// are runaway paragraphs no header should carry.
const NAME_MAX = 80;

/**
 * The name to head a treasure's cell with, or null if the book doesn't give it
 * one. For most entries the catalog origin IS the item's name — sometimes two
 * words ("Brass sphere"), sometimes a whole descriptive phrase ("A bronze blade
 * from a metal construct's limb, remade into a brutal axe") — with the book's
 * prose running on after it in the same line. But a fifth of the catalog names an
 * item only by describing it at paragraph length, and those get a header-less
 * cell rather than a bolded paragraph. The origin is used WHOLE or not at all:
 * cutting one short lands mid-phrase, since there's no shorter name inside it to
 * find. Display only — the dragged Item always keeps its full `entry.name`.
 * Exported for tests; the cell build is DOM work the node-env suite can't drive.
 */
export function headName(origin) {
	return origin.length <= NAME_MAX ? origin : null;
}

const isAlnum = ch => {
	const c = ch.toLowerCase();
	return (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
};

/**
 * Raw index just past the first `count` NORMALIZED characters of `raw` — the
 * inverse of `norm()`'s case-folding and punctuation-collapsing. Origins are only
 * ever matched normalized, so this maps a match back onto the book's real text
 * with its casing and punctuation intact. Exported for tests — an off-by-one here
 * silently eats or duplicates the book's prose.
 */
export function rawEndOfNorm(raw, count) {
	let n = 0, end = 0, gap = false;
	for (let i = 0; i < raw.length && n < count; i++) {
		if (isAlnum(raw[i])) {
			if (gap && n > 0) n++;   // the collapsed run of punctuation → one space
			if (n >= count) break;
			gap = false;
			n++;
			end = i + 1;
		} else gap = true;
	}
	return end;
}

/**
 * How much of `raw` the catalog `origin` covers. `norm()` TRIMS its ends, so an
 * origin closing on punctuation — the book has "A pot of “gold”" and a ring set
 * with a diamond "(?)" — normalizes without it, and the span alone would cut the
 * header mid-quote and strand the closer at the head of the description. Take the
 * normalized span, then re-consume the origin's own trailing punctuation.
 *
 * Matched by IDENTITY, not by count: only characters `raw` and `origin` actually
 * agree on are taken back. Counting instead would let an origin ending in one kind
 * of punctuation eat a different kind out of the line — an origin closing on "."
 * against a line reading "A map, fragile" would lift "A map," and pull the prose
 * separator into the header, which is the very thing this is meant to avoid.
 * Exported for tests.
 */
export function liftLength(raw, origin) {
	let end = rawEndOfNorm(raw, norm(origin).length);
	// The origin's trailing punctuation run, in order (e.g. `(?)` → ["(", "?", ")"]).
	let from = origin.length;
	while (from > 0 && !isAlnum(origin[from - 1])) from--;
	for (const ch of origin.slice(from)) {
		if (end >= raw.length || raw[end] !== ch) break;
		end++;
	}
	return end;
}

/**
 * Cut the first `count` characters of text out of `el` and return them. Markup
 * inside that leading run is dropped (treasure names are plain text in every
 * section), while everything after it — `<em>`, content-links, whatever earlier
 * enrichers added — is left on its original nodes, untouched.
 */
function takeLeadingText(el, count) {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const out = [], spent = [];
	let taken = 0, node;
	while (taken < count && (node = walker.nextNode())) {
		const need = count - taken;
		if (node.data.length <= need) {
			out.push(node.data);
			taken += node.data.length;
			spent.push(node);
		} else {
			out.push(node.data.slice(0, need));
			node.data = node.data.slice(need);
			taken = count;
		}
	}
	// Removing a spent text node can leave its wrapper behind with nothing in it — a name the
	// book emphasised (`<strong>Brass sphere</strong>, magical`) empties the <strong> exactly.
	// Prune those upwards, or the cell keeps a phantom element that still draws the
	// stylesheet's margins and any ::before/::after the journal skin hangs on it. Stop at `el`
	// itself, and at the first ancestor that still holds something.
	for (const n of spent) {
		let node = n, parent = node.parentNode;
		node.remove();
		while (parent && parent !== el && !parent.firstChild) {
			node = parent;
			parent = node.parentNode;
			node.remove();
		}
	}
	return out.join("");
}

/** Drop the separator stranded by lifting the name out ("Brass sphere, magical…"). */
function stripLeadingPunctuation(el) {
	const first = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
	if (first) first.data = first.data.replace(/^[\s,;:.—–-]+/, "");
}

/**
 * The prose element to pull into a name-only cell as its description, if any. A
 * few sections print the treasure's name on its own line and its description on
 * the next — every flora specimen does, as does the Barrow Builders' Three-star
 * Crown — so the cell absorbs that sibling rather than drawing a border around a
 * bare name and stranding its prose outside.
 * @returns {HTMLElement|null}
 */
function absorbableSibling(line, groups) {
	const next = line?.nextElementSibling;
	if (!next || (next.tagName !== "LI" && next.tagName !== "P")) return null;
	if (next.dataset.stTreasureBound) return null;
	// A sibling that is itself a treasure owns its own cell — never swallow it.
	if (matchGroup(norm(next.textContent), groups)) return null;
	return next;
}

/**
 * Rebuild one matched line as a drag-cell. The line the book printed becomes the
 * cell itself: a leading grip, then either the treasure's name and ◇/○ badge on a
 * header row with the prose beneath it, or — where the book names the item only by
 * describing it — the prose alone with the badge running off its end.
 */
function decorate(line, group, groups) {
	const items = group.items;
	// <span>, not <div>: the cell IS the book's own line, and the flora sections print their
	// treasures as <p>. A <div> inside a <p> is invalid nesting that only renders because we
	// build it through the DOM API rather than the parser — the moment that HTML round-trips
	// through a string (a journal export, a ProseMirror pass, an ancestor's innerHTML), the
	// parser auto-closes the <p> before the <div> and splits the cell open. These are laid
	// out entirely by CSS (`display` is set on every one of them), so the tag costs nothing.
	const body = document.createElement("span");
	body.className = "st-treasure-cell-body";
	const head = document.createElement("span");
	head.className = "st-treasure-cell-head";
	const desc = document.createElement("span");
	desc.className = "st-treasure-desc";

	// A treasure line can also be a tickable check-bullet (the book lists some finds as a
	// checklist). The checkbox enhancer runs first and injects its tick control as the
	// line's leading child; lift it out before boxing the prose so it stays at the cell's
	// edge. Swept into `.st-treasure-desc` it is both misplaced and hidden from that
	// enhancer's `:scope > .stonetop-journal-check` idempotency check, which would then add
	// a second control on the next render pass. Re-attached as the line's lead below.
	const check = line.querySelector(":scope > .stonetop-journal-check");
	check?.remove();

	// Nodes are MOVED into the description, never re-serialized from text, so any
	// enrichment already applied to the prose survives being boxed.
	while (line.firstChild) desc.appendChild(line.firstChild);

	const nameText = headName(group.origin);
	if (nameText !== null) {
		const lifted = takeLeadingText(desc, liftLength(desc.textContent, nameText));
		// A name-only line (every flora specimen, the Three-star Crown) keeps its prose
		// next door. Absorb it, or the cell is a bare name with its description stranded
		// outside the border. Only a named cell may do this: a header-less cell already
		// holds all its prose, so anything after it belongs to someone else.
		if (!desc.textContent.trim()) {
			const sibling = absorbableSibling(line, groups);
			if (sibling) {
				// If the absorbed line carried its own tick control, drop it before merging —
				// the sibling is being dissolved into this cell, so its box is orphaned, and
				// sweeping it into `.st-treasure-desc` would both misplace it and hide it from
				// the checkbox enhancer's idempotency check (as the guard above does for this
				// line's own control).
				sibling.querySelector(":scope > .stonetop-journal-check")?.remove();
				while (sibling.firstChild) desc.appendChild(sibling.firstChild);
				sibling.remove();
			}
		}
		stripLeadingPunctuation(desc);
		const name = document.createElement("span");
		name.className = "st-treasure-name";
		name.textContent = lifted;
		head.appendChild(name);
	}

	const badge = document.createElement("span");
	badge.className = "st-treasure-badge";
	if (items.length === 1) {
		const entry = items[0];
		badge.innerHTML = badgeHtml(entry);
		// Whole cell drags the item (the affordance the grip advertises).
		line.setAttribute("draggable", "true");
		line.addEventListener("dragstart", ev => { if (!ev.dataTransfer) return; writeDrag(ev, entry); });
	} else {
		// Compound (e.g. the two mirrors): the cell itself isn't draggable — one
		// chip per real item is, since they're separate inventory items.
		badge.classList.add("st-treasure-compound");
		for (const entry of items) {
			const chip = document.createElement("span");
			chip.className = "st-treasure-chip";
			chip.setAttribute("draggable", "true");
			chip.dataset.tooltip = `Drag "${entry.name}" to a character sheet or the Items sidebar`;
			chip.innerHTML = `<span class="st-chip-label">${chipLabel(entry)}</span>${badgeHtml(entry)}`;
			chip.addEventListener("dragstart", ev => { ev.stopPropagation(); if (!ev.dataTransfer) return; writeDrag(ev, entry); });
			badge.appendChild(chip);
		}
	}
	// The cell's leading slot: the treasure's book illustration when this world has imported
	// it (the same thumbnail the bestiary's stat-block cells use, and the same image the
	// dragged Item carries), else the shared vase marker — a category symbol, never an invented
	// picture of the item. Both occupy the same 40px slot so every row's text lines up whether
	// or not it has art. A compound cell heads with its first item's picture as the representative.
	// A real illustration (`st-treasure-icon`) is cover-cropped behind a photo border like a
	// stat-block portrait; the fallback marker (`st-treasure-grip`) is the same shared
	// vase-in-octagon symbol the Items sidebar falls back to — a category marker (the role the
	// old drag-grip glyph played), not a fabricated picture of any one item, so it stands in
	// for every un-illustrated treasure without inventing what it looks like.
	const iconSrc = treasureArtSrc(items[0].slug);
	const grip = document.createElement("img");
	grip.className = iconSrc ? "st-treasure-icon" : "st-treasure-grip";
	grip.src = iconSrc ?? STONETOP_ITEM_ICONS.object;
	grip.alt = "";
	// An <img> is draggable by default; leave it so and grabbing the thumbnail starts a native
	// image-file drag that carries no Item payload. On a single-item cell the whole line handles
	// dragstart (so it still works), but a compound cell drags only via its chips — there the
	// thumbnail would begin a dead image drag. Turn native dragging off so the cell/chip drag wins.
	grip.draggable = false;
	grip.dataset.tooltip = items.length === 1
		? "Drag to a character sheet or the Items sidebar"
		: "Drag one of the items to a character sheet or the Items sidebar";

	line.classList.add("st-treasure-line");
	if (head.firstChild) {
		// Named cell: the badge leads the header row, sitting to the LEFT of the name
		// (CSS gives it order:-1). It's appended after the name in the DOM so the reading
		// order stays name-first for screen readers; only the visual order swaps.
		head.appendChild(badge);
		body.appendChild(head);
		if (desc.textContent.trim()) body.appendChild(desc);
	} else {
		// Header-less cell: no name to lead with, so the badge leads the prose itself —
		// inserted inline at the very start of the description's first line so it reads
		// left-of-text, matching the left-of-name placement a named cell uses. Slotted
		// INSIDE the leading <p> (not before it) so it flows with the first words rather
		// than sitting as a stray glyph on its own row above the text.
		body.appendChild(desc);
		const lead = desc.querySelector(":scope > p") ?? desc;
		lead.insertBefore(document.createTextNode(" "), lead.firstChild);
		lead.insertBefore(badge, lead.firstChild);
	}
	line.appendChild(grip);
	line.appendChild(body);
	// Put the tick control (if any) back at the very front of the cell, ahead of the grip.
	if (check) line.prepend(check);
}

/**
 * Scan a rendered journal for treasure lines and make them draggable inventory items.
 * @param {HTMLElement|jQuery} root       the journal/page root
 * @param {string} [entryName]            the JournalEntry name, to scope catalog matches
 */
export function applyTreasureDrops(root, entryName) {
	const el = root?.jquery ? root[0] : root;
	if (!el?.querySelectorAll) return;
	const groups = groupsFor(entryName);
	if (!groups.length) return;
	// querySelectorAll yields each node once, and the dataset marker makes re-scans of an
	// already-decorated journal idempotent, so no in-loop "seen" set is needed. The list is
	// static, so skip any line a preceding cell has already absorbed as its description:
	// absorbing removes it, which nulls its parent. (Testing the parent rather than
	// `isConnected` because a sheet may still be rendering detached from the document.)
	for (const line of el.querySelectorAll("li, p")) {
		if (!line.parentNode || line.dataset.stTreasureBound) continue;
		// Skip prose we've already absorbed into a cell earlier in this same pass.
		// `decorate` MOVES the matched line's children into `.st-treasure-desc` rather
		// than removing them, so they stay in this static NodeList. That matters for
		// header-less cells: once a treasure has been edited, ProseMirror wraps the
		// list item's loose text in a `<p>` (`<li>text</li>` → `<li><p>text</p></li>`),
		// and since a header-less cell doesn't lift its name out, that inner `<p>` still
		// begins with the full origin. Without this guard the loop would reach it and
		// decorate it a second time, nesting a treasure-cell inside a treasure-cell.
		if (line.closest(".st-treasure-cell-body")) continue;
		// Never decorate a line inside a live editor: rebuilding it there bakes the
		// drag-cell into the saved source and ProseMirror mangles it (see
		// journal-editor-guard.js). The read view is decorated as before.
		if (isInJournalEditor(line)) continue;
		const text = norm(line.textContent);
		if (text.length < 3) continue;
		const group = matchGroup(text, groups);
		if (!group) continue;
		line.dataset.stTreasureBound = "1";
		decorate(line, group, groups);
	}
}
