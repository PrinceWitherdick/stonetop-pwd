// Relationship hearts — the 1-5 affinity rating shared by two sheets:
//   • the NPC sheet's Relationships tab (how this NPC feels about each PC), and
//   • the character sheet's Details tab (how this PC feels about the other PCs).
// Both store the same shape: `system.relationships` is a map of actor id →
// { hearts, notes }. Sparse — an actor with no stored entry reads as the default
// 3 hearts, so a fresh sheet shows everyone at neutral without persisting anything.
// Keys are actor ids (no dots), so `system.relationships.<id>` updates merge cleanly.
// NOTE: this is the LEAF of the relationships modules — it must not import
// relationship-board.js or heart-words.js, both of which import it. A back-import would
// make the cycle resolve into a temporal-dead-zone error depending on which side loaded
// first, since both of those evaluate top-level consts. The hosts wire them together,
// which keeps the dependency one-way.
import { isDefaultImg } from "./strings.js";
import { resolvePortrait, documentPortraitFrame } from "./portrait-frame.js";
import { displayPortraitSrc } from "../book2-art/people-portraits.js";
import { makeColumnsResizable } from "./resizable-columns.js";
import { makeColumnsSortable } from "./sortable-columns.js";
// Leaf module with no imports of its own, so it cannot participate in the cycle above.
import { wireAvatarPreview, removeAvatarPreview } from "./avatar-preview.js";
import { openLinkedActorSheet } from "./actor-link.js";
import { imagePopout } from "./foundry-compat.js";

// One to five, defaulting to three, clamped to 1-5 (a relationship always has at
// least one heart — you can't drop it to zero).
export const HEARTS_MAX     = 5;
export const HEARTS_MIN     = 1;
export const HEARTS_DEFAULT = 3;

/** One entry per heart, `filled` up to the rating: what each hearts strip draws. */
export function heartSlots(hearts) {
	return Array.from({ length: HEARTS_MAX }, (_, i) => ({ position: i + 1, filled: i < hearts }));
}
// Falls back to NEUTRAL, not the minimum, for anything non-numeric: these ratings come
// out of an ObjectField, which validates nothing, so a hand-edited or corrupted value
// would otherwise read as NaN — silently emptying the hearts and indexing the feeling
// table out of range. A garbage value shouldn't be interpreted as "hates", either.
export const clampHearts = n => {
	// Absent reads as neutral (matching the `??` in readRelationship) — note Number(null)
	// and Number("") are both 0, which would otherwise clamp to 1 and assert hatred.
	if (n === null || n === undefined || n === "") return HEARTS_DEFAULT;
	const num = Math.trunc(Number(n));
	// Present but not a number: neutral. Present and out of range: clamp, since that IS
	// a rating, just a bad one.
	if (!Number.isFinite(num)) return HEARTS_DEFAULT;
	return Math.max(HEARTS_MIN, Math.min(HEARTS_MAX, num));
};

// A full-sentence feeling per rating, shown in the heart-row tooltip so hovering
// reads "Vera hates Aldric" rather than a bare "5/5". Each key is a
// {subject}/{object} format string; indexed by (hearts - 1), i.e. 1 heart → hates.
const HEART_FEELING_KEYS = [
	"stonetop.relationships.feels1", // 1 — hates
	"stonetop.relationships.feels2", // 2 — dislikes
	"stonetop.relationships.feels3", // 3 — neutral (default)
	"stonetop.relationships.feels4", // 4 — likes
	"stonetop.relationships.feels5", // 5 — loves
];
export const relationSummary = (hearts, subject, object) =>
	game.i18n.format(HEART_FEELING_KEYS[clampHearts(hearts) - 1], { subject, object });

// A relationship entry is { hearts, notes, shown? }. Early builds stored a bare
// number, so read either shape and normalize. An absent entry defaults to 3 hearts,
// no notes. `shown` stays undefined when never set, so the caller's per-kind default
// applies (see relationshipRow) — that's what lets other PCs default to visible while
// the steading's NPCs default to hidden without writing an entry for everyone.
// Whether an entry records an actual RATING, as opposed to existing only because someone
// ticked its visibility box or typed a note. That distinction is invisible in the read
// shape — readRelationship defaults a missing rating to 3, exactly like a missing entry —
// so it has to be asked of the RAW value.
//
// ONLY RELIABLE FOR ENTRIES WRITTEN SINCE updateRelationship STOPPED PADDING THEM. Earlier
// builds always wrote the whole { hearts, notes } object, so in a world that predates that
// change every entry that exists carries `hearts` — including ones created purely by ticking
// a show box or saving a note, which will read as rated here. There is no migration that can
// fix it: a legacy `hearts: 3` is byte-identical whether someone judged the person neutral or
// never judged them at all. The consequence is confined to presentation (the board's
// rated-before-unrated sort key and its dimmed unrated cards), so an upgraded world sees a
// board that is merely less sorted than a fresh one, never a wrong rating.
export function hasStoredRating(raw) {
	if (typeof raw === "number") return true; // legacy bare-number shape: the number IS the rating
	return !!raw && typeof raw === "object" && raw.hearts !== undefined;
}

// Where this row sits in its board lane, once someone has arranged that lane by hand.
// Sparse like everything else here: null means "nobody has placed this one", which the
// board reads as "sort by the default rule, after whoever HAS been placed".
//
// null is a STORED sentinel, not merely an absent key, and that is deliberate. Clearing a
// position has to survive `actor.update`, which MERGES into an ObjectField — an omitted key
// keeps whatever was there, so "unordered" could otherwise only be expressed by the `-=`
// delete prefix. That prefix is reliable as a dotted leaf path but not as a key inside an
// object value (see foundry-compat.js on nested ForcedDeletion), and the same write also
// carries the new rating, so the two would have to share one path. A plain null needs none
// of that and means the same thing on every core generation.
//
// Non-integers, negatives and null all read as unordered: these come out of an ObjectField,
// which validates nothing, so a hand-edited value must not be able to wedge a lane.
export function readOrder(raw) {
	return Number.isInteger(raw) && raw >= 0 ? raw : null;
}

export function readRelationship(raw) {
	const obj = (raw && typeof raw === "object") ? raw : { hearts: raw };
	return {
		hearts: clampHearts(obj.hearts ?? HEARTS_DEFAULT),
		notes:  obj.notes ?? "",
		shown:  typeof obj.shown === "boolean" ? obj.shown : undefined,
		order:  readOrder(obj.order),
	};
}

// One template row: who they are, how `actor` regards them, and the per-slot heart
// states so the template needs no math helper. `defaultShown` is this row's visibility
// before anyone has ticked its box.
//
// `rated` is the one thing the sparse storage cannot otherwise express: an absent entry
// and a deliberate 3 both read as 3 hearts, which is fine for a table sorted by rating
// but not for the board, where an untouched roster would pile every card into Neutral and
// drown the handful anyone has actually judged. It is derived, never stored.
//
// It asks whether a RATING was stored, not whether an ENTRY exists: an entry is also
// created by ticking someone's visibility box or typing a note, neither of which is a
// judgment about them. See hasStoredRating, and updateRelationship, which is what keeps
// those two writes from persisting a rating nobody made.
export function relationshipRow(actor, other, { defaultShown = true } = {}) {
	const stored = actor.system?.relationships?.[other.id];
	const { hearts, notes, shown, order } = readRelationship(stored);
	// Resolve the rendered src and its frame together, so a frame can never be measured against
	// a picture this row does not render. `other` may be a bare {id, name, img} object (a
	// steading passes its settlements that way), which documentPortraitFrame reads as null.
	const portrait = resolvePortrait(
		isDefaultImg(other.img) ? null : other.img,
		documentPortraitFrame(other)
	);
	return {
		id:   other.id,
		name: other.name,
		// What makes the name a link. Present on an Actor, and on a plain {id, name} row that
		// carries one (a steading's settlement row with a settlement sheet behind it, which this
		// user can see); absent on a row with no sheet to open, which therefore reads as plain
		// text. Kept beside `id`, which is the fallback lookup when a uuid stops resolving (a
		// compendium re-import, say).
		uuid: other.uuid ?? null,
		img:      portrait.src,
		imgStyle: portrait.style,
		hearts,
		notes,
		rated:      hasStoredRating(stored),
		shown:      shown ?? defaultShown,
		// Only the board reads this; the table has its own click-to-sort columns and ignores
		// it entirely. Carried on every row regardless, because the row builder is shared and
		// the board is one localStorage flip away on any of the three sheets.
		order,
		feeling:    relationSummary(hearts, actor.name, other.name),
		heartSlots: heartSlots(hearts),
	};
}

// Every candidate row for a sheet's relationships table, in display order.
//
// `groups` is an ordered list of { actors, defaultShown } — a sheet decides which
// populations it offers and whether each starts visible. After those, ANY id already
// stored in `system.relationships` that no group covered becomes a row too: that is
// what lets someone dropped onto the table persist as a row (and survive being
// unticked) instead of vanishing on the next render. Self is never a row.
//
// An id whose actor has since been deleted just drops out; the orphan entry is
// harmless and costs nothing. A sheet keyed by slug rather than actor id (the
// steading's settlements) simply finds no actor for its keys, so it adds nothing.
export function buildRelationshipRows(actor, groups, { extraTypes = ["character", "npc"] } = {}) {
	const rows = [];
	const seen = new Set([actor.id]);
	for (const { actors = [], defaultShown = true } of groups) {
		for (const doc of actors) {
			if (!doc || seen.has(doc.id)) continue;
			seen.add(doc.id);
			rows.push(relationshipRow(actor, doc, { defaultShown }));
		}
	}
	for (const id of Object.keys(actor.system?.relationships ?? {})) {
		if (seen.has(id)) continue;
		const doc = game.actors?.get(id);
		if (!doc || !extraTypes.includes(doc.type)) continue;
		seen.add(id);
		rows.push(relationshipRow(actor, doc, { defaultShown: true }));
	}
	return rows;
}

// Drop someone onto a relationships table to put them on the list: a stranger becomes a
// new row, and someone already there but unticked is revealed. Both are the same write —
// `shown: true` — because an absent entry already reads as neutral, so the reveal
// doubles as the add. Always returns a status, so the caller can consume EVERY drop that
// lands on the table rather than letting it fall through to whatever else the sheet does
// with dropped actors.
export async function relationshipDropResult(actor, doc, rows, { editable = true } = {}) {
	if (!doc || !["character", "npc"].includes(doc.type)) return "unsupported";
	// A pack entry's id is only meaningful inside its pack, and buildRelationshipRows
	// resolves stored ids through game.actors — so storing one would write a key that can
	// never become a row, while the notice claimed it worked. Say so instead of pretending.
	if (doc.pack) return "compendium";
	if (doc.id === actor.id) return "self";
	if (!editable) return "readonly";
	const row = rows.find(r => r.id === doc.id);
	if (row?.shown) return "already";
	await setRelationshipShown(actor, doc.id, true);
	return row ? "revealed" : "added";
}

// Status -> [notification level, message]. Shared so both sheets say the same thing.
export function relationshipDropNotice(result, actor, doc) {
	const level = ["added", "revealed", "already"].includes(result) ? "info" : "warn";
	const name = result === "self" ? (actor?.name ?? "") : (doc?.name ?? "");
	return [level, game.i18n.format(`stonetop.relationships.drop.${result}`, { name })];
}

// Dashed-outline affordance while a drag is over a relationships section, so "drop a
// person here" is discoverable rather than found by accident. Returns a clear() the host
// must call from its own drop handling: a sheet-level handler often consumes the drop
// before it would ever reach a listener here, so dragleave alone can't be trusted.
export function wireRelationshipDropHighlight(section) {
	if (!section) return () => {};
	let depth = 0;
	const clear = () => { depth = 0; section.classList.remove("is-drop-target"); };
	section.addEventListener("dragenter", () => { depth++; section.classList.add("is-drop-target"); });
	section.addEventListener("dragleave", () => { if (--depth <= 0) clear(); });
	return clear;
}

// Patch one field of a relationship entry. Writes the entry OBJECT under the row's id
// (never a nested key), so a legacy bare-number value is cleanly replaced by the
// { hearts, notes } shape — and since actor.update merges, a field this write omits keeps
// whatever was already stored there.
//
// Every field is written only once it has actually been set, so an untouched row keeps
// falling back to a default rather than freezing today's default into world data. Nothing
// downstream can tell the difference on READ: readRelationship supplies the same defaults.
//
//  • `shown` — otherwise a row's per-kind default visibility would be baked in.
//  • `hearts` — otherwise merely ticking a visibility box or typing a note would persist
//    the neutral default as though someone had judged this person. That silently turns an
//    unrated row into a rated one (see hasStoredRating), which the board reads as a real
//    3-heart verdict, and it made the NPC ledger log "set to Neutral (3)" for a show-box
//    tick.
//  • `notes` — same rule, for the same reason. Rating someone used to write `notes: ""`
//    beside the rating, which is a change from `undefined` and so logged a phantom "note
//    set to blank" on every first-time rating; the ledger had to recognise and discard it.
//    Keeping the field absent also leaves "has a note" derivable from storage later, the
//    way hasStoredRating derives "has a rating" now.
//  • `order` — same rule again. An untouched row keeps no position at all, so a lane nobody
//    has arranged goes on sorting itself. Note this one is re-emitted from STORAGE whenever
//    the row already has a position, which the three above do not need to be: they are read
//    back and rewritten from `readRelationship` anyway, whereas an omitted `order` would rely
//    on the merge to survive a rating write. Re-emitting it costs one integer and makes the
//    field independent of how deeply core merges an ObjectField.
//
// `options` rides through to actor.update so a caller can attribute the change (the
// `{stonetopMove}` idiom the ledgers read); never pass `{stonetopLedger: true}`, which is
// the ledger's own re-entrancy kill switch.
function relationshipEntry(stored, patch) {
	const { hearts, notes, shown, order } = { ...readRelationship(stored), ...patch };
	const entry = {};
	if (patch.notes !== undefined || stored?.notes !== undefined) entry.notes = notes;
	// Clamped HERE rather than at each call site, which is where it used to live. Every write
	// to a rating goes through this one line now, so no caller can put a 7 or a NaN into world
	// data by forgetting — and a patch that carries no rating at all still passes the stored
	// value through readRelationship, which clamped it on the way in.
	if (patch.hearts !== undefined || hasStoredRating(stored)) entry.hearts = clampHearts(hearts);
	if (shown !== undefined) entry.shown = shown;
	// Written when there IS a position, and when there was one that now has to be cleared.
	// Never when both are absent, so an ordinary rating write on an unarranged lane still
	// stores nothing new.
	if (order !== null || readOrder(stored?.order) !== null) entry.order = order;
	return entry;
}

// Patch SEVERAL relationships in one actor.update, which is what reordering a lane needs:
// dragging one card renumbers its neighbours too, and a write per card would re-render the
// sheet once per card and let the board flicker through every intermediate arrangement.
//
// Each id gets its own top-level `system.relationships.<id>` key, exactly as the single-row
// write does — never a deeper path — so one malformed legacy entry is replaced rather than
// merged into.
export function updateRelationships(actor, patches, options = {}) {
	const update = {};
	for (const [id, patch] of Object.entries(patches ?? {})) {
		update[`system.relationships.${id}`] = relationshipEntry(actor.system?.relationships?.[id], patch);
	}
	// No keys means no write at all. Callers compute the CHANGED rows and hand over an empty
	// map when a gesture turned out to be a no-op; an update with nothing in it would still
	// re-render every sheet showing this actor.
	if (!Object.keys(update).length) return Promise.resolve();
	return actor.update(update, options);
}

function updateRelationship(actor, id, patch, options = {}) {
	return updateRelationships(actor, { [id]: patch }, options);
}

// Clicking heart N sets the rating to N; clicking the current rating's last filled
// heart drops it by one, down to the 1-heart minimum — a relationship always keeps
// at least one heart; it can't be zeroed out.
export async function setRelationshipHearts(actor, id, position) {
	const current = readRelationship(actor.system?.relationships?.[id]).hearts;
	const next = position === current ? position - 1 : position;
	await updateRelationship(actor, id, { hearts: clampHearts(next) });
}

// NOTE: there is no setRelationshipHeartsExact any more. It existed so the board could
// assert a value outright without setRelationshipHearts' "clicked the last filled heart"
// branch silently DECREMENTING when the asserted value matched the current one — that hazard
// is real and still worth knowing about, but the board now writes the rating and the card's
// lane position in ONE update (or the sheet re-renders twice and the board visibly settles in
// two stages), so it goes through updateRelationships directly. Anything else needing an
// exact rating should do the same: `updateRelationships(actor, { [id]: { hearts } })`, which
// clamps for you and never toggles.

export async function setRelationshipNote(actor, id, notes) {
	await updateRelationship(actor, id, { notes: notes ?? "" });
}

// Whether this row shows on the sheet in play mode. Always writes an explicit boolean —
// once the box is ticked, that choice outranks the per-kind default from then on.
export async function setRelationshipShown(actor, id, shown) {
	await updateRelationship(actor, id, { shown: !!shown });
}

// Wire a rendered relationships table. Drag-resize + click-to-sort are view features
// (shared utils; preferences persist in localStorage), so they're wired regardless of
// ownership; the hearts and the note field only write when editable. Both column utils are
// idempotent, so a host sheet that already wires every `[data-resize-key]` table
// generically (the steading sheet does) just makes this a no-op.
export function wireRelationshipTable(root, actor, { editable = true } = {}) {
	if (!root) return;
	root.querySelectorAll(".stonetop-rel-table[data-resize-key]").forEach(table => {
		makeColumnsResizable(table, table.dataset.resizeKey);
		makeColumnsSortable(table, table.dataset.resizeKey);
	});
	if (!editable) return;

	root.addEventListener("click", async ev => {
		const heart = ev.target.closest(".stonetop-rel-heart");
		if (!heart) return;
		const id = ev.target.closest("[data-rel-id]")?.dataset?.relId;
		const position = Number(heart.dataset.position);
		if (!id || !position) return;
		await setRelationshipHearts(actor, id, position);
	});

	root.addEventListener("change", async ev => {
		// The show/hide box (edit mode only) — unticked rows drop out of the table in
		// play mode. Unnamed input, so the sheet's form submit ignores it.
		const showBox = ev.target.closest(".stonetop-rel-show-check");
		if (showBox) {
			const id = showBox.dataset?.relId;
			if (id) await setRelationshipShown(actor, id, showBox.checked);
			return;
		}
		const note = ev.target.closest(".stonetop-rel-note-input");
		if (!note) return;
		const id = note.dataset?.relId;
		if (!id) return;
		await setRelationshipNote(actor, id, note.value ?? "");
	});
}

// The two ways a relationship row points back at the person it names: the name opens their
// sheet, and the portrait shows a full-size preview on hover. Both are the steading
// Residents table's affordances, wired the same way, so a name behaves the same wherever
// it is listed.
//
// Deliberately NOT folded into wireRelationshipTable: that one bails early when the viewer
// can't edit, and neither of these is an edit. Looking up who someone is has nothing to do
// with being allowed to rate them, so a player reading a GM's NPC keeps both. It also
// covers BOTH layouts from one call — the table's rows and the board's cards emit the same
// `.stonetop-rel-open` / `.stonetop-rel-portrait` hooks — so hosts wire it once per render
// regardless of which view is showing.
export function wireRelationshipLinks(root) {
	// Bound to the section wrapper rather than the sheet root, the way wireRelationshipBoard
	// is: the hover half has to listen in the capture phase (mouseenter/mouseleave do not
	// bubble), so a sheet-root listener would run a `closest()` walk for every pointer
	// crossing anywhere on the sheet — a thousand nodes on the character sheet — to serve
	// one section. Both partials only ever render inside this wrapper.
	root?.querySelectorAll?.(".stonetop-rel-views").forEach(wireRelationshipLinksIn);
}

function wireRelationshipLinksIn(root) {
	// Same once-per-wrapper guard wireRelationshipBoard puts on this element, for the same
	// reason: nothing here removes a listener, so a second call on a surviving wrapper would
	// stack another capture-phase trio and open the sheet twice per click.
	if (root.dataset.stRelLinks === "1") return;
	root.dataset.stRelLinks = "1";

	// Only the <img> portrait carries data-name; the fallback is a glyph in a <span> with
	// nothing to enlarge, and the selector is what keeps it from raising an empty card.
	// The inner image, not the box: .stonetop-rel-portrait is now the clipping SPAN that both
	// branches wear, so the class alone no longer distinguishes a portrait from a glyph, and the
	// preview needs the element that actually carries a src.
	wireAvatarPreview(root, ".stonetop-rel-portrait-img[data-name]");

	// Tapping a face enlarges it, the same as every other portrait in the system. Hover already
	// previews it, but a preview vanishes the moment you move the pointer, so it cannot be read
	// at leisure or shown to someone else.
	//
	// Bound on click rather than pointerdown so it never competes with the board's lane drag: a
	// press that turns into a drag produces no click, so dragging a card still just moves it.
	root.addEventListener("click", ev => {
		const img = ev.target.closest?.(".stonetop-rel-portrait-img[data-name]");
		if (!img) return;
		const stored = img.getAttribute("src");
		if (!stored) return;
		ev.preventDefault();
		ev.stopPropagation();
		// The preview is portaled to <body> and would otherwise sit over the popout.
		removeAvatarPreview();
		// The whole illustration behind a People-of-Stonetop square: enlarging a face should not
		// answer with a picture smaller than the thumbnail just tapped.
		imagePopout({ src: displayPortraitSrc(stored), title: img.dataset.name || "" })?.render(true);
	});

	const open = async link => {
		// The pointer is by definition over the row, and rendering a sheet does not move it,
		// so no mouseleave is coming to clear the preview once the window covers the name.
		removeAvatarPreview();
		await openLinkedActorSheet(link);
	};

	root.addEventListener("click", async ev => {
		const link = ev.target.closest(".stonetop-rel-open");
		if (!link) return;
		ev.preventDefault();
		ev.stopPropagation();
		await open(link);
	}, true);

	// The link carries no href — one would make it natively draggable and fight the board
	// card's own drag — so the browser gives it neither a tab stop nor Enter/Space activation.
	// The template supplies the tab stop with tabindex; this supplies the keys, or the name
	// would be reachable by keyboard and still do nothing when pressed.
	root.addEventListener("keydown", async ev => {
		if (ev.key !== "Enter" && ev.key !== " ") return;
		const link = ev.target.closest?.(".stonetop-rel-open");
		if (!link) return;
		// Space would scroll the sheet under the newly-raised window. Propagation is stopped
		// for the board's sake: its own keydown handler is delegated off the WRAPPER and only
		// checks `closest(".stonetop-rel-card")`, so a press on a link inside a card reaches it
		// as though the card itself were focused.
		ev.preventDefault();
		ev.stopPropagation();
		await open(link);
	}, true);
}
