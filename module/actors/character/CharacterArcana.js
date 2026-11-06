import {
	ArcanaBackOptionSnapshotBuilder, ArcanaSnapshot, ArcanaSectionSnapshot,
	ArcanaUnlockOptionSnapshotBuilder, ArcanaUnlockTextItem,
	ArcanumBackMoveSnapshot, ArcanumUnlockSection,
	MinorArcanumBackSnapshotBuilder, MinorArcanumFrontSnapshotBuilder,
	MinorArcanumSnapshotBuilder,
	ResourceBuilder,
} from "../../model/CharacterSnapshot.js";
import { OutfitItemBuilder } from "../../model/OutfitItem.js";
import { majorArcanaImg, isMajorArcanumItem, arcanumCardImg } from "../../arcana-icons.js";
import { arcanaSummonFollowers } from "../../data/arcana-summons.js";
import { isCarriedArcanumItem } from "../../data/arcana-facets.js";
import {
	CONDENSED_MOVE_SLUG, FRONT_MOVE_PREFIX, condensedArcanumMove, findArcanumFrontMove, findArcanumMove,
	isArcanumFrontMoveSlug, markArcanumFrontMoves, markArcanumMoveNames,
} from "../../data/arcana-moves.js";
import { backBoxChecked, centerArcanumTracks, glyphLabelAt, injectGlyphCheckboxes, maskGlyphLabels, unmaskGlyphLabels } from "../../utils/glyphs.js";
import { stonetopChatCard } from "../../utils/chat.js";
import { prettifySlug } from "../../utils/ledger-core.js";
import { clipText, stripHtmlToText } from "../../utils/strings.js";
import { frontTaskTrack } from "./seeker-collection.js";

// Some arcana "items" are a place, structure, or phenomenon rather than carried gear
// (a sealed cave, a giant's dormitory, an arch you could walk through). Book I p.437 gives
// a card the `immobile` tag for exactly this, and where the book prints it, that tag is what
// holds the card back — isImmobileArcanumItem, applied in weightedInventoryItems, so a
// HOMEBREW place needs no entry here and the rule reads as what the book says.
//
// What remains listed are the shipped places the book leaves untagged: it prints them plain
// `magical`, and nothing in their data tells them apart from a portable curio (both carry a
// null weight), so there is nothing to derive and they are named. This gates only the
// WEIGHTLESS side (see weightedInventoryItems): a card whose front is such a place but whose
// unlocked BACK item is real, weighted gear still surfaces that gear once realised.
//
// An IMPLANTED arcanum — Storm Markings up your skin, the Ineffable Words on your soul — is
// kept off by its own printed tag too (isImplantedArcanumItem).
const CONCEPT_ARCANA_SLUGS = new Set([
	"crumbling-arch",
	"giants-dormitory",
	"metal-man",
	"odd-conveyance",
	"patch-of-rainbow-moss",
	"rune-etched-pillars",
	"runes-around-a-ruined-hall",
	"sealed-cave",
	"timeless-vault",
]);

/**
 * Whether a card's unlock requirements are met, `isDone(requirement)` answering for each option.
 *
 * Either/or unlocks ("you need one of the following", Book I p.444: "Maybe this arcanum allows for a
 * choice of requirements"): an option may carry `path: "<id>"`, and options sharing a path form ONE
 * alternative, all of whose options must be done. Met when every option WITHOUT a path is done and,
 * if any option has a path, at least one path is done in full. `type: "text"` rows are prose.
 */
export function unlockRequirementsMet(requirements, isDone) {
	let paths = null;
	for (const r of requirements ?? []) {
		if (r?.type !== "option") continue;
		if (!r.path) {
			if (!isDone(r)) return false;
			continue;
		}
		paths ??= new Map();
		paths.set(r.path, (paths.get(r.path) ?? true) && !!isDone(r));
	}
	return !paths || [...paths.values()].some(Boolean);
}

/**
 * The option requirements that make up the shortest way through: every option without a path,
 * and the options of the FIRST path printed. What mastering a card ticks (masteryGrant).
 */
function _requiredOptions(requirements) {
	const options = (requirements ?? []).filter(r => r?.type === "option" && r.slug);
	const firstPath = options.find(r => r.path)?.path;
	return options.filter(r => !r.path || r.path === firstPath);
}

// How many of one glyph a text prints, one per glyph as _injectMarkers indexes them. Display-only
// glyphs (maskGlyphLabels) don't count.
const _glyphCount = (description, glyph) => maskGlyphLabels(description).split(glyph).length - 1;

/**
 * How many □ the unlock text prints (a homebrew card's typed "□ find the smith"): each is a tick box
 * under the context `unlockBox`, and every one of them is a step towards unlocking.
 */
export function unlockBoxCount(description) {
	return _glyphCount(description, "□");
}

/**
 * A card's steps towards unlocking: whether it has option requirements, how many ○ and □ its unlock
 * text prints, and its front □ tasks (or null). `counts` passes in ○/□ counts already known.
 */
function _unlockSteps(item, counts = {}) {
	const unlock = item?.front?.unlock;
	return {
		options: (unlock?.requirements ?? []).some(r => r?.type === "option"),
		circles: counts.circles ?? unlockCircleCount(unlock?.description),
		boxes:   counts.boxes ?? unlockBoxCount(unlock?.description),
		tasks:   frontTaskTrack(item?.front),
	};
}

const _hasStep = steps => steps.options || steps.circles > 0 || steps.boxes > 0 || !!steps.tasks;

// Every unlock ○ and □ as `{context, index}`, the keys its marks are stored under.
function _unlockMarks({ circles, boxes }) {
	const marks = [];
	for (const [context, count] of [["unlock", circles], ["unlockBox", boxes]]) {
		for (let index = 0; index < count; index++) marks.push({ context, index });
	}
	return marks;
}

/**
 * Whether a card has any step towards unlocking at all: an option requirement, an unlock ○ or □, or
 * front □ tasks. A homebrew card with none stays locked (until revealed) rather than reading as
 * unlocked the moment it is identified. Every shipped card has a step. Takes a card or a card's
 * `flags.stonetop` payload (the editor's check, arcanum-edit.js).
 */
export function arcanumHasUnlockStep(item) {
	return _hasStep(_unlockSteps(item));
}

/**
 * Whether a card's unlock track is complete under these marks: its options (paths honoured), every
 * unlock ○ and □, and its front □ tasks. False for a card with no step.
 */
function _trackComplete(item, unlockCounts, arcanaBoxes, counts) {
	const steps = _unlockSteps(item, counts);
	if (!_hasStep(steps)) return false;
	const reqsMet = unlockRequirementsMet(item.front.unlock?.requirements,
		r => (unlockCounts[`${item.slug}:${r.slug}`] ?? 0) >= (r.max ?? 1));
	if (!reqsMet) return false;
	if (_unlockMarks(steps).some(({ context, index }) => !arcanaBoxes[`${item.slug}:${context}:${index}`])) return false;
	// A card whose track is the □ tasks in its front text (the Mindgem, the Twisted Spear) has no
	// option or ○ for the checks above, so without this it read as unlocked once identified.
	const { tasks } = steps;
	if (tasks) return tasks.markers.filter(m => arcanaBoxes[`${item.slug}:front:${m.index}`]).length >= tasks.needed;
	return true;
}

// The box contexts an unlock track is marked in: its ○, its □, and the front □ tasks.
const _UNLOCK_TRACK_CONTEXTS = new Set(["unlock", "unlockBox", "front"]);

/** Whether anything on a card's back is marked: a □ or ○ there, or a back option counted. */
function _backMarked(slug, boxes, backOptions) {
	const on = (map, prefixes) => Object.entries(map ?? {})
		.some(([key, value]) => prefixes.some(p => key.startsWith(p)) && (typeof value === "number" ? value > 0 : !!value));
	return on(boxes, [`${slug}:back:`, `${slug}:backCircle:`]) || on(backOptions, [`${slug}:`]);
}

/**
 * Whether a card is unlocked: its track is complete now, or was once (`unlockedOnce`, a Set of the
 * slugs latched in the same update that completed them). The latch is what keeps a card unlocked
 * whose back then says "erase all marks" (the Azure Hand, the Hungering Maw, the Rune-laden Scales,
 * the Ineffable Words).
 */
function _isUnlocked(item, unlockCounts, arcanaBoxes, unlockedOnce, counts) {
	return unlockedOnce.has(item.slug) || _trackComplete(item, unlockCounts, arcanaBoxes, counts);
}

/**
 * Whether a card's unlock track is complete under these marks: the timeline's reading of a card
 * before and after one update (timeline-milestones.js#detectArcanaTracks), with nothing but the card
 * and the flags in hand. The same test as isArcanumUnlocked.
 */
export function arcanumUnlockedUnder(item, unlockCounts = {}, arcanaBoxes = {}, unlockedOnce = []) {
	if (!item?.front) return false;
	return _isUnlocked(item, unlockCounts ?? {}, arcanaBoxes ?? {}, new Set(unlockedOnce ?? []));
}

/**
 * Whether the character has realised a card's back: identified, and its unlock track complete.
 * What decides which side's curio is carried, and whether the back's condensed move can be rolled.
 */
function _backRealised(item, identifiedSlugs, unlockCounts, arcanaBoxes, unlockedOnce) {
	return identifiedSlugs.has(item.slug) && _isUnlocked(item, unlockCounts, arcanaBoxes, unlockedOnce);
}

// backBoxChecked lives in utils/glyphs.js; re-exported for the modules that import it from here.
export { backBoxChecked };

/**
 * The armor a card's curio is worth once its unlocked mysteries are taken into account: the best
 * of the curio's own printed armor and every ticked `armorUnlocks` entry.
 *
 * "The Rune-laden Scales now provide you 3 armor" REPLACES the printed 2 rather than adding to
 * it, which is what taking the best does — and taking the best (rather than last-wins) also keeps
 * the answer stable however the mysteries are ordered or ticked.
 */
export function unlockedArcanumArmor(item, sideItem, boxStates) {
	let best = sideItem?.armor ?? null;
	const rank = a => Number(a?.base ?? a?.modifier ?? 0);
	for (const u of item.armorUnlocks ?? []) {
		if (!u?.armor || !u.label) continue;
		if (!backBoxChecked(item.back?.description, item.slug, u.label, boxStates)) continue;
		if (rank(u.armor) > rank(best)) best = u.armor;
	}
	return best;
}

/**
 * The sheet's own marker injection: {@link injectGlyphCheckboxes} with this card's persisted
 * box states supplying the checked test. Keys are `slug:context:index`, which is how the
 * sheet stores them; the onboarding dialog indexes the same boxes the same way through the
 * same helper, so a mark made there lands on this box when the sheet opens.
 *
 * The two track patterns below require a run of 2+ so a lone glyph stays a display glyph: a
 * single ◇/○ is an inline indicator ("a ◇ jar of butter", "BATTERY ○ ____"), only a run
 * is a markable track (◇◇◇ Conduit, ○○○ Loyalty). The patterns are precompiled module
 * constants so nothing recompiles inside the per-item loop (String.replace resets a
 * global regex's lastIndex, so sharing them across calls is safe).
 */
function _injectMarkers(html, slug, context, boxStates, cssClass, runRe) {
	return injectGlyphCheckboxes(html, runRe, {
		slug, context, cssClass,
		isChecked: i => !!boxStates[`${slug}:${context}:${i}`],
	});
}

const _DIAMOND_TRACK_RE = /◇{2,}/g;
const _CIRCLE_TRACK_RE  = /○{2,}/g;
// Runs, not single glyphs, purely so the wrapper above can hold consecutive boxes on one line —
// every □ / unlock ○ is a checkbox either way, and each still gets its own index in the same
// document order a per-glyph pattern produced.
const _BOX_RE           = /□+/g;
const _UNLOCK_CIRCLE_RE = /○+/g;

/**
 * How many ○ an unlock lead prints: one per GLYPH, as _injectMarkers indexes them (a run of
 * "○○○○" is four boxes, `unlock:0` to `unlock:3`). Counting matches of _UNLOCK_CIRCLE_RE counted
 * RUNS, so a four-circle major read as unlocked after its first mark.
 */
export function unlockCircleCount(description) {
	return _glyphCount(description, "○");
}

// A few cards' FRONT text tells you to "mark a consequence (see reverse)" (Hec'tumel Codex,
// Redwood Effigy). The consequences themselves live in a "Consequences" section on the BACK,
// which a player may not have unlocked. For those cards we surface that section onto the front
// (see buildSnapshot / the sheet's fold pass), so the pointer reads "(see below)".
//
// Detect such a front by the parenthetical "(see reverse)" attached to a "consequence" clause;
// the "consequence" word rules out the other "(see reverse)" pointers (to spells / named moves)
// that live in the unlock text of most cards.
const _FRONT_CONSEQUENCE_REF_RE = /consequences?\b[^.<]*?\(see reverse\)/i;
// Match the "Consequences" heading on its tag (any heading level) rather than the bare word,
// which also appears in body prose ("mark a consequence…", "marked 3 Consequences") before the
// real heading.
const _CONSEQUENCES_HEADING_RE = /<h([1-6])\b[^>]*>\s*Consequences\s*<\/h\1>/i;

/**
 * A back description's "Consequences" section: its `heading` and where it sits (`index`), and the
 * `body` from there to the next heading (or the end), with where that body starts. Null when the
 * card prints no such heading. The card editor (arcanum-edit.js) inserts into the same section.
 */
export function consequencesSection(text) {
	const m = _CONSEQUENCES_HEADING_RE.exec(text);
	if (!m) return null;
	const start = m.index + m[0].length;
	const after = text.slice(start);
	const nextHeading = after.search(/<h[1-6]\b/i);
	return { heading: m[0], index: m.index, start, body: nextHeading >= 0 ? after.slice(0, nextHeading) : after };
}

// Slice the "Consequences" section out of an already-processed BACK description so it can be
// shown on the front. Runs from the heading to the next heading (or the end — the section is
// authored last on every shipped card), which keeps its nested lists and any trailing prose
// intact and sidesteps balanced-tag matching. Because the input is the PROCESSED back HTML,
// the □/○ inside already carry the back's own (slug, "back"/"backCircle", index) checkboxes, so
// marking a consequence from the front writes the exact same state as marking it from the back.
// Returns null when there's no section or only a pointer stub (e.g. Whispering Rocks' "See
// above."), so a contentless fold never renders.
function _extractConsequencesSection(processedBackHtml) {
	const section = processedBackHtml ? consequencesSection(processedBackHtml) : null;
	if (!section || !/<li\b/i.test(section.body)) return null;
	return section.heading + section.body;
}

/**
 * Which of a back side's □ belong to its "Consequences" section, as the half-open index range
 * `{from, to}` those boxes carry under `slug:back:i` (the back's □ are indexed in document order,
 * see _injectMarkers), or null when the card prints no such section or no box in it.
 *
 * Read off the RAW back description: the move-name wrap and the marker pass add no glyphs, so the
 * indices match the processed HTML's, and the front-surfaced fold writes the same keys. Only □
 * count: a ○○○ run inside a consequence (the Blood-quenched Sword's Sustenance) is a track the
 * consequence grants, not a consequence to mark. The section is consequencesSection's.
 */
export function consequenceBoxRange(backDescription) {
	const text = maskGlyphLabels(backDescription);
	const section = consequencesSection(text);
	if (!section) return null;
	const boxes = s => (s.match(/□/g) || []).length;
	const inside = boxes(section.body);
	if (!inside) return null;
	const from = boxes(text.slice(0, section.start));
	return { from, to: from + inside };
}

/**
 * The text a back-side □ marks: what follows its run of □, up to the next □, list or item end,
 * as plain text. "" when the index is past the last □. Read off the RAW back description, whose □
 * are indexed as consequenceBoxRange counts them.
 */
export function consequenceLabel(backDescription, index) {
	const html = String(backDescription ?? "");
	let seen = -1;
	// Display-only □ (maskGlyphLabels) take no index; offsets hold, so the label reads the original.
	for (const match of maskGlyphLabels(html).matchAll(/□/g)) {
		if (++seen < index) continue;
		const rest = html.slice(match.index).replace(/^□+/, "");
		const end  = rest.search(/□|<ul\b|<\/li>/i);
		return stripHtmlToText(end < 0 ? rest : rest.slice(0, end)).trim();
	}
	return "";
}

/**
 * consequenceLabel, cut to fit the timeline's row when a Consequence box is marked ("Lose 1 max HP").
 */
export function consequenceBoxLabel(backDescription, index) {
	const plain = consequenceLabel(backDescription, index);
	return plain.length > 140 ? `${clipText(plain, 139).trimEnd()}…` : plain;
}

// A card whose unlock track buys a choice off its BACK with every mark. The Hec'tumel Codex: "○○○○
// Each time you make a mark, choose one of the Codex Spells (see reverse)", and "you can now cast
// it". The spells are the □ of the back's "Spells of the Codex" section. Read off the text, as the
// consequences are: the unlock line names the list ("choose one of the X (see reverse)") and the
// back section is the one whose heading holds every word of X, so a homebrew card worded the same
// way works with no table.
const _UNLOCK_CHOICE_RE = /\bchoose\s+(?:one|1)\s+of\s+the\s+([^(<.]+?)\s*\(see reverse\)/i;
const _HEADING_RE       = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
const _words = s => new Set(String(s ?? "").toLowerCase().match(/[a-z0-9'’]+/g) ?? []);

/**
 * The back section an unlock line's "choose one of the X (see reverse)" points at: `name` (X as the
 * unlock prints it), `title` and raw `heading` of the section, and its `choices`, one per □, with
 * `index` the back-side box index (`slug:back:i`, document order as _injectMarkers counts) and
 * `label` the words the box marks up to the end of their bold run ("Call Up the Dead"). Null when the
 * unlock prints no such line or the back no such section with a box in it.
 */
export function unlockChoiceSection(unlockDescription, backDescription) {
	const m = _UNLOCK_CHOICE_RE.exec(stripHtmlToText(String(unlockDescription ?? "")));
	if (!m) return null;
	const wanted = [..._words(m[1])];
	if (!wanted.length) return null;
	const text = maskGlyphLabels(backDescription);
	for (const h of text.matchAll(_HEADING_RE)) {
		const title = stripHtmlToText(h[2]).trim();
		const have = _words(title);
		if (!wanted.every(w => have.has(w))) continue;
		const start = h.index + h[0].length;
		const after = text.slice(start);
		const next = after.search(/<h[1-6]\b/i);
		const body = next >= 0 ? after.slice(0, next) : after;
		let index = (text.slice(0, start).match(/□/g) || []).length;
		const choices = [];
		for (const box of body.matchAll(/□/g)) {
			const label = glyphLabelAt(body, box.index + 1, /<\/strong>|<\/p>|<\/li>|<ul\b|□/i).replace(/[.:]$/, "");
			choices.push({ index: index++, label });
		}
		return choices.length ? { name: m[1].trim(), title: unmaskGlyphLabels(title), heading: unmaskGlyphLabels(h[0]), choices } : null;
	}
	return null;
}

/**
 * Where a card's unlock choices stand under these marks: unlockChoiceSection plus `marked` (the
 * unlock ○ ticked), `learned` and `open` (the choices whose □ is ticked, and the rest), and `owed`,
 * how many marks have bought no choice yet (never more than are left to choose). Null for a card
 * with no unlock choice.
 */
export function unlockChoiceState(item, boxes = {}) {
	const section = unlockChoiceSection(item?.front?.unlock?.description, item?.back?.description);
	if (!section) return null;
	const slug = item.slug;
	const circles = unlockCircleCount(item.front?.unlock?.description);
	let marked = 0;
	for (let i = 0; i < circles; i++) if (boxes?.[`${slug}:unlock:${i}`]) marked++;
	const learned = section.choices.filter(c => boxes?.[`${slug}:back:${c.index}`]);
	const open    = section.choices.filter(c => !boxes?.[`${slug}:back:${c.index}`]);
	return { ...section, marked, learned, open, owed: Math.max(0, Math.min(open.length, marked - learned.length)) };
}

// The learned choices' paragraphs (or list items), lifted out of the PROCESSED back so their □ keep
// the back's own checkboxes, under the section's heading: what the front shows a player whose back
// is still hidden ("you can now cast it"). The choices not yet learned stay hidden with the back.
// Null when none is learned.
function _extractLearnedChoices(processedBackHtml, state) {
	const at = processedBackHtml?.indexOf(state.heading) ?? -1;
	if (at < 0 || !state.learned.length) return null;
	const after = processedBackHtml.slice(at + state.heading.length);
	const next = after.search(/<h[1-6]\b/i);
	const body = next >= 0 ? after.slice(0, next) : after;
	const learned = new Set(state.learned.map(c => c.index));
	const kept = [...body.matchAll(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi)]
		.map(([block]) => block)
		.filter(block => [...block.matchAll(/data-context="back" data-index="(\d+)"/g)].some(([, i]) => learned.has(Number(i))));
	return kept.length ? state.heading + kept.join("") : null;
}

// Run a side description through the full marker pipeline: center standalone tracks, then
// make ◇ / ○ tracks and □ boxes selectable. `side` ("front"/"back") keeps each side's
// marker indices in their own context so they never collide. Returns the processed HTML.
function _processSideDescription(description, slug, side, boxStates) {
	let html = centerArcanumTracks(description);
	({ html } = _injectMarkers(html, slug, `${side}Diamond`, boxStates, "stonetop-arcanum-diamond", _DIAMOND_TRACK_RE));
	({ html } = _injectMarkers(html, slug, `${side}Circle`,  boxStates, "stonetop-arcanum-circle",  _CIRCLE_TRACK_RE));
	({ html } = _injectMarkers(html, slug, side,             boxStates, "stonetop-arcanum-box",     _BOX_RE));
	return html;
}

/**
 * The `inventory.resources` key a card's BACK-ITEM track is kept under: the bare slug when the card
 * has no back-power track (`back.resource`), else `<slug>:item`, so the two never share a count.
 * THE one rule: the Arcana tab, the Inventory row, Let Fly's ammo and the migration all ask it.
 */
export function arcanumItemResourceKey(card) {
	const slug = card?.slug ?? "";
	return card?.back?.resource ? `${slug}:item` : slug;
}

/**
 * Marks a card prints but holds shut until a mystery on its back is ticked: the Redwood Effigy's two
 * "potential" Conduit slots (front ◇ 1 and 2) open with GREATER CONDUIT. Found by the mystery's
 * LABEL (backBoxChecked), as the CSS that draws them dotted is keyed by slug and index.
 */
const _LOCKED_SLOTS = Object.freeze({
	"redwood-effigy": Object.freeze({ context: "frontDiamond", indexes: Object.freeze([1, 2]), opensWith: "GREATER CONDUIT" }),
});

/** Whether the mark at `context:index` of this card is a locked slot that may not be ticked now. */
export function arcanumSlotLocked(item, context, index, boxStates = {}) {
	const lock = _LOCKED_SLOTS[item?.slug];
	if (!lock || lock.context !== context || !lock.indexes.includes(Number(index))) return false;
	return !backBoxChecked(item.back?.description, item.slug, lock.opensWith, boxStates ?? {});
}

/** The processed front with each locked slot's checkbox `disabled`, so keyboard ticks are refused too. */
function _disableLockedSlots(item, html, boxStates) {
	const lock = _LOCKED_SLOTS[item.slug];
	if (!lock || !html || !arcanumSlotLocked(item, lock.context, lock.indexes[0], boxStates)) return html;
	return lock.indexes.reduce((out, i) => out.replace(
		`data-context="${lock.context}" data-index="${i}"`,
		`data-context="${lock.context}" data-index="${i}" disabled aria-disabled="true"`), html);
}

/**
 * `resource` with the key its pips write under and, while untouched, its rolled size. Untouched is
 * "nothing stored under the key yet", not "0 marked": a roll of the full 1d4+8 writes 0, and must
 * not offer the roll again.
 */
function _withTrackKey(resource, key, def, stored) {
	resource.key = key;
	if (def?.rollUses && !rolledTrackTouched(stored, key)) resource.rollUses = String(def.rollUses);
	return resource;
}

/** Whether a rolled-size track has been rolled or marked: anything stored under its key, 0 included. */
export function rolledTrackTouched(stored, key) {
	return !!stored && Object.hasOwn(stored, key);
}

/**
 * "Roll 1d4+8": a track whose size is rolled when it is found (`rollUses`) marks the uses it does not
 * have as used, `max - total`, clamped to the track. `total` is the dice result.
 */
export function rolledUsesCount(max, total) {
	const cap = Math.max(0, Math.trunc(Number(max) || 0));
	const got = Math.trunc(Number(total) || 0);
	return Math.min(cap, Math.max(0, cap - got));
}

function _buildOutfitItem(slug, itemData, resolvedResource = undefined) {
	if (!itemData) return null;
	return new OutfitItemBuilder()
		.withSlug(slug)
		.withName(itemData.name)
		.withWeight(itemData.weight ?? null)
		.withNote(itemData.note ?? null)
		.withInventoryColumn(itemData.inventoryColumn ?? null)
		.withResource(resolvedResource !== undefined ? resolvedResource : (itemData.resource ?? null))
		.withArmor(itemData.armor ?? null)
		.withShield(itemData.shield ?? false)
		.withResourceKey(itemData.resourceKey ?? null)
		.withTwoCol(false)
		.withBreakBefore(false)
		.build();
}

/**
 * Cards whose printed boxes moved after marks had been stored against them. Marks are kept by
 * index in document order, so a box inserted into the text shifts every mark after it onto the
 * wrong words. Each entry: `by` boxes inserted at index `from` of `slug`'s `context`, and the
 * `marker` a character's marks carry once they follow the new text (settleBoxLayouts).
 *
 * The beautiful scroll's reverse gained the four boxes its tulpa's optional moves print in the
 * book (Book II p.527) after its three instinct boxes, moving its Cost boxes from 9-11 to 13-15.
 */
export const BOX_LAYOUT_CHANGES = [
	{ slug: "beautiful-scroll", context: "back", from: 9, by: 4, marker: "beautiful-scroll:back:tulpa-moves" },
	// Arcana audit 2026-11-04 (MAJ-2, MAJ-14): the Lidless Orb's reverse gained the five boxes Book II p.541
	// prints (POWER OF THE LIDLESS ORB and its four effects), the Mindgem's the "□ The Mighty Servant" of p.549.
	{ slug: "staff-of-the-lidless-orb", context: "back", from: 0, by: 5, marker: "staff-of-the-lidless-orb:back:power-boxes" },
	{ slug: "mindgem", context: "back", from: 0, by: 1, marker: "mindgem:back:mighty-servant-box" },
];

/**
 * `boxes` with one layout change applied: each mark at `from` or later moved `by` along, the
 * boxes it leaves stored clear. Null when no mark sits at or past `from`.
 */
export function shiftedBoxes(boxes, { slug, context, from, by }) {
	const prefix = `${slug}:${context}:`;
	const marked = new Map();
	for (const [key, value] of Object.entries(boxes ?? {})) {
		if (!key.startsWith(prefix) || !value) continue;
		const i = Number(key.slice(prefix.length));
		if (Number.isInteger(i) && i >= from) marked.set(i, value);
	}
	if (!marked.size) return null;
	const next = { ...boxes };
	for (const i of marked.keys()) next[`${prefix}${i}`] = false;
	for (const [i, value] of marked) next[`${prefix}${i + by}`] = value;
	return next;
}

export class CharacterArcana {
	constructor(flags, arcanaRepo) {
		this._flags = flags;
		this._arcanaRepo = arcanaRepo;
	}

	get ownedSlugs()       { return new Set(this._flags.getFlag("owned") ?? []); }
	get revealedSlugs()    { return new Set(this._flags.getFlag("revealed") ?? []); }
	get identifiedSlugs()  { return new Set(this._flags.getFlag("identified") ?? []); }
	get backOwedSlugs()    { return new Set(this._flags.getFlag("backOwed") ?? []); }
	get leadSlugs()        { return new Set(this._flags.getFlag("leads") ?? []); }
	get unlockCounts()     { return this._flags.getFlag("unlock") ?? {}; }
	get backOptionCounts() { return this._flags.getFlag("backOptions") ?? {}; }
	get boxStates()        { return this._flags.getFlag("boxes") ?? {}; }
	get majorSlug()        { return this._flags.getFlag("major") ?? null; }
	get minorDrawSlugs()   { return this._flags.getFlag("minorDraw") ?? []; }
	get minorRoles()       { return this._flags.getFlag("minorRoles") ?? {}; }
	get majorMarkKeys()    { return this._flags.getFlag("majorMarks") ?? []; }
	// The unlock latch: cards whose track has been completed at least once (see _isUnlocked).
	get unlockedOnceSlugs() { return new Set(this._flags.getFlag("unlockedOnce") ?? []); }
	// The latched cards whose 7-9 back debt the latch settled, so releasing the latch owes it again.
	get owedAtLatchSlugs()  { return new Set(this._flags.getFlag("owedAtLatch") ?? []); }
	// The player's own note per card, by slug.
	get notes()            { return this._flags.getFlag("notes") ?? {}; }

	/**
	 * Display data for a playbook's arcana lore (the Seeker): the chosen major
	 * arcanum (name + icon) and the drawn minor cards with their role assignments.
	 * Minor arcana have no artwork, so they're name-only.
	 */
	async buildLoreDisplay() {
		const majorSlug = this.majorSlug;
		const drawSlugs = this.minorDrawSlugs;
		const slugs     = [...new Set([majorSlug, ...drawSlugs].filter(Boolean))];
		const fetched   = await this._arcanaRepo.findBySlugs(slugs);
		const names     = Object.fromEntries(fetched.map(a => [a.slug, a.front?.title ?? a.slug]));
		return {
			major: majorSlug
				? { slug: majorSlug, name: names[majorSlug] ?? majorSlug, img: majorArcanaImg(majorSlug) }
				: null,
			minorOptions: drawSlugs.map(slug => ({ slug, name: names[slug] ?? slug })),
			roles: this.minorRoles,
		};
	}

	async buildSnapshot(stats = {}, checkedMap = {}, inventoryResources = {}) {
		const ownedSlugs       = this.ownedSlugs;
		const identifiedSlugs  = this.identifiedSlugs;
		const backOwedSlugs    = this.backOwedSlugs;
		const leadSlugs        = this.leadSlugs;
		const unlockCounts     = this.unlockCounts;
		const arcanaBoxes      = this._flags.getFlag("boxes") ?? {};
		const unlockedOnce     = this.unlockedOnceSlugs;
		const notes            = this.notes;

		const fetchedItems = await this._arcanaRepo.findBySlugs([...ownedSlugs]);

		const allItems = fetchedItems.map(item => {
			// The front's own rolling moves get handles too (data/arcana-moves.js#parseArcanumFrontMoves):
			// in its text, its unlock lead and each requirement line. The wrap adds no glyphs.
			const fallbackName = item.front.title ?? "";
			const frontMoves = (html, prefix) => markArcanumFrontMoves(html, item.slug, { prefix, fallbackName });
			// An option on an either/or path (unlockRequirementsMet) is drawn inside its path's group,
			// and the first option of each path after the first is headed "or", so the alternatives
			// read as alternatives.
			let lastPath = null;
			const unlockItems = (item.front.unlock?.requirements ?? []).map(li => {
				if (li.type === "text") { lastPath = null; return new ArcanaUnlockTextItem(li.content); }
				const count = unlockCounts[`${item.slug}:${li.slug}`] ?? 0;
				const path = li.path ? String(li.path) : null;
				const orBefore = !!path && lastPath !== null && lastPath !== path;
				lastPath = path ?? lastPath;
				return new ArcanaUnlockOptionSnapshotBuilder()
					.withSlug(li.slug)
					.withDescription(frontMoves(li.description, `${FRONT_MOVE_PREFIX.req}:${li.slug}`))
					.withCount(count)
					.withMax(li.max ?? 1)
					.withPath(path, orBefore)
					.build();
			});

			const frontDesc = _processSideDescription(frontMoves(item.front.description, FRONT_MOVE_PREFIX.front), item.slug, "front", arcanaBoxes);
			const circleRun = _injectMarkers(centerArcanumTracks(frontMoves(item.front.unlock?.description ?? "", FRONT_MOVE_PREFIX.unlock)), item.slug, "unlock", arcanaBoxes, "stonetop-arcanum-circle", _UNLOCK_CIRCLE_RE);
			// □ typed into the unlock text (a homebrew card's own steps) tick under "unlockBox".
			const boxRun = _injectMarkers(circleRun.html, item.slug, "unlockBox", arcanaBoxes, "stonetop-arcanum-box", _BOX_RE);
			const unlockDesc = boxRun.html;
			// The marker passes counted the unlock ○ and □ already (the move wrap adds no glyphs).
			const unlocked = _isUnlocked(item, unlockCounts, arcanaBoxes, unlockedOnce, { circles: circleRun.count, boxes: boxRun.count });

			const front = new MinorArcanumFrontSnapshotBuilder()
				.withTitle(item.front.title)
				.withItem(_buildOutfitItem(item.slug, item.front.item))
				.withDescription(_disableLockedSlots(item, frontDesc, arcanaBoxes))
				.withUnlock(new ArcanumUnlockSection(unlockDesc, unlockItems))
				.build();

			const backOpts = (item.back.options ?? []).map(o => new ArcanaBackOptionSnapshotBuilder()
				.withSlug(o.slug)
				.withDescription(o.description)
				.build());

			const backResource = item.back.resource
				? new ResourceBuilder()
					.withCurrent(inventoryResources[item.slug] ?? 0)
					.withMax(item.back.resource.maxStat
						? (stats[item.back.resource.maxStat]?.value ?? 0)
						: item.back.resource.max)
					.withMaxStat(item.back.resource.maxStat ?? null)
					.withTitle(item.back.resource.title ?? null)
					.withLabels(item.back.resource.labels ?? [])
					.build()
				: null;

			const backItemResourceDef = item.back.item?.resource ?? null;
			// The back-ITEM track's key is arcanumItemResourceKey's: the bare slug unless the card
			// also has a back-power track, which then keeps the bare slug for itself.
			const itemKey = arcanumItemResourceKey(item);
			const backItemResource = backItemResourceDef
				? new ResourceBuilder()
					.withCurrent(inventoryResources[itemKey] ?? 0)
					.withMax(backItemResourceDef.maxStat
						? (stats[backItemResourceDef.maxStat]?.value ?? 0)
						: backItemResourceDef.max)
					.withMaxStat(backItemResourceDef.maxStat ?? null)
					.withTitle(backItemResourceDef.title ?? null)
					.withLabels(backItemResourceDef.labels ?? [])
					.build()
				: null;
			// Where each track is written (the tab's pips send it back as their data-slug), and a
			// rolled size ("Roll 1d4+8") offered while the track is untouched (rollUsesTrack).
			if (backResource) _withTrackKey(backResource, item.slug, item.back.resource, inventoryResources);
			if (backItemResource) _withTrackKey(backItemResource, itemKey, backItemResourceDef, inventoryResources);

			const backMove = item.back.move
				? new ArcanumBackMoveSnapshot(
					item.back.move.name,
					item.back.move.rollType ?? null,
					item.back.move.description)
				: null;
			// Its trigger is a clickable move handle on the tab, like a mystery's name.
			if (backMove) backMove.slug = CONDENSED_MOVE_SLUG;

			// The card's mysteries are moves, so their NAMES render as clickable handles before the
			// marker pass runs (see data/arcana-moves.js) — the wrap adds no glyphs, so the □/○ each
			// side indexes are untouched by it.
			const backDesc = _processSideDescription(
				markArcanumMoveNames(item.back.description, item.slug), item.slug, "back", arcanaBoxes);

			// Surface the back's "Consequences" section onto the front, but ONLY for cards whose
			// front text points at it ("mark a consequence (see reverse)"). Those cards trigger
			// consequences from a front-side move, so the owner needs the list even with a locked
			// back — and because the front already names consequences, surfacing them leaks nothing.
			// (For every other card, consequences are a back-move payoff and stay hidden with the back.)
			const consequences = _FRONT_CONSEQUENCE_REF_RE.test(item.front.description ?? "")
				? _extractConsequencesSection(backDesc)
				: null;

			// The Hec'tumel Codex's spells, chosen one per unlock mark (unlockChoiceState): the front
			// carries the ones learned, since "you can now cast it" holds with the back still hidden,
			// and how many marks still owe a choice (the tab's "choose" cue, for a mark made where no
			// one could be asked, such as the Seeker's creation mark, or a pick that was closed).
			const choiceState = unlockChoiceState(item, arcanaBoxes);
			const unlockChoice = choiceState
				? { name: choiceState.name, owed: choiceState.owed, html: _extractLearnedChoices(backDesc, choiceState) }
				: null;

			// Redwood Effigy: the two "potential" Conduit slots on the front stay locked until
			// the Greater Conduit mystery (a □ on the back) is checked. Resolved by LABEL through
			// the shared helper, which the armor unlocks use too.
			const greaterConduit = backBoxChecked(item.back.description, item.slug, "GREATER CONDUIT", arcanaBoxes);

			const back = new MinorArcanumBackSnapshotBuilder()
				.withTitle(item.back.title)
				.withItem(_buildOutfitItem(item.slug, item.back.item, backItemResource))
				.withDescription(backDesc)
				.withResource(backResource)
				.withMove(backMove)
				.withOptions(backOpts)
				.build();

			return new MinorArcanumSnapshotBuilder()
				.withSlug(item.slug)
				.withFront(front)
				.withBack(back)
				.withOwned(true)
				.withChecked(checkedMap[item.slug] ?? false)
				.withUnlocked(unlocked)
				.withIdentified(identifiedSlugs.has(item.slug))
				.withBackOwed(backOwedSlugs.has(item.slug))
				.withLead(leadSlugs.has(item.slug) && !identifiedSlugs.has(item.slug))
				.withImg(arcanumCardImg(item))
				.withMajor(isMajorArcanumItem(item))
				.withSummonFollowers(arcanaSummonFollowers(item))
				.withGreaterConduit(greaterConduit)
				.withConsequences(consequences)
				.withUnlockChoice(unlockChoice)
				.withNotes(typeof notes[item.slug] === "string" ? notes[item.slug] : "")
				.build();
		});

		// A held slug no pack or world arcanum answers to any more (a homebrew card the GM deleted)
		// becomes a stub with Remove instead of silently vanishing: left out, its slug and marks
		// stayed on the character with nothing on the sheet that could clear them, and a later card
		// minted with the same slug came back already marked. Its tier is unknown, so it is listed
		// with the minors; its title is the one the delete guard stored on this character
		// (`arcana.titles`, module/hooks/arcana-card-edits.js), else the slug, the only name left.
		const resolved = new Set(fetchedItems.map(item => item.slug));
		const storedTitles = this._flags.getFlag("titles") ?? {};
		const missing = [...ownedSlugs].filter(slug => slug && !resolved.has(slug)).map(slug =>
			new MinorArcanumSnapshotBuilder()
				.withSlug(slug)
				.withFront({ title: String(storedTitles[slug] ?? "").trim() || prettifySlug(slug), description: "", item: null, unlock: null })
				.withBack(null)
				.withOwned(true)
				.withChecked(false)
				.withUnlocked(false)
				.withIdentified(false)
				.withMissing(true)
				.build());

		const major = new ArcanaSectionSnapshot("Major Arcana", allItems.filter(i => i.major));
		const minor = new ArcanaSectionSnapshot("Minor Arcana", [...allItems.filter(i => !i.major), ...missing]);
		return new ArcanaSnapshot(minor, major);
	}

	/**
	 * One move printed on a card's back, by its parsed slug — the record behind a clicked move
	 * name on the arcana tab. `learned` reads the move's own □: an un-marked mystery is still
	 * readable (its name posts it to chat) but is not yet a move this character can roll, which
	 * is the line an un-owned playbook move sits on too.
	 */
	async getArcanumMove(slug, moveSlug) {
		const item = await this.getArcanum(slug);
		if (!item) return null;
		// The card's condensed move has no learned box: it is the back's, so it is learned once the
		// back is realised, as the back's curio is carried. Seeing the back (the peek switch, a GM
		// reveal, a 7-9's owed back) lets the owner read it, not roll it. It goes by the side's
		// title when there is one, since its "name" is a whole trigger.
		if (moveSlug === CONDENSED_MOVE_SLUG) {
			const move = condensedArcanumMove(item.back?.move, { backDescription: item.back?.description ?? "" });
			if (!move) return null;
			const cardTitle = item.back?.title ?? item.front?.title ?? "";
			const learned = this._backRealised(item);
			return { ...move, name: String(item.back?.title ?? "").trim() || move.name, cardTitle, learned };
		}
		// A move printed on the FRONT (parseArcanumFrontMoves) has no learned box: it is the card's to
		// use once its owner can read the front, which is what identifying it gives.
		if (isArcanumFrontMoveSlug(moveSlug)) {
			const move = findArcanumFrontMove(item.front, moveSlug);
			if (!move) return null;
			return { ...move, cardTitle: item.front?.title ?? "", learned: this.identifiedSlugs.has(slug) };
		}
		const move = findArcanumMove(item.back?.description ?? "", moveSlug);
		if (!move) return null;
		const boxes = this._flags.getFlag("boxes") ?? {};
		return {
			...move,
			cardTitle: item.back?.title ?? item.front?.title ?? "",
			// A mystery printed with no box of its own (the Lidless Orb's POWER) is the back's, so it
			// is learned once the back is realised, like the condensed move; not the moment it is read.
			learned:   move.boxIndex == null ? this._backRealised(item) : !!boxes[`${slug}:back:${move.boxIndex}`],
		};
	}

	/** _backRealised under this character's flags. */
	_backRealised(item) {
		return _backRealised(item, this.identifiedSlugs, this.unlockCounts, this.boxStates, this.unlockedOnceSlugs);
	}

	/** The resolved {@link MinorArcanum} for a slug (pack or world), or null. */
	async getArcanum(slug) {
		const [item] = await this._arcanaRepo.findBySlugs([slug]);
		return item ?? null;
	}

	/** Whether a card is unlocked: its track complete (options, ○, □, front tasks), or once completed. */
	async isArcanumUnlocked(slug) {
		const item = await this.getArcanum(slug);
		if (!item?.front) return false;
		return _isUnlocked(item, this.unlockCounts, this.boxStates, this.unlockedOnceSlugs);
	}

	/**
	 * Whether the character's owner may read a card's back on the character's own account: the GM
	 * revealed it, or the card is unlocked (isArcanumUnlocked, latch included). Viewer rules (a GM,
	 * the peek switch, a card's author) are the caller's. Pass `unlocked` when already known (the
	 * snapshot's `unlocked`) to skip the card lookup.
	 */
	async backOpenToOwner(slug, { unlocked } = {}) {
		if (this.revealedSlugs.has(slug)) return true;
		return !!(unlocked ?? await this.isArcanumUnlocked(slug));
	}

	/**
	 * The `inventory.resources` key the carried curio's uses are kept under: the back item's
	 * (arcanumItemResourceKey) once the back is realised and it has one, else the bare slug.
	 */
	async carriedResourceKey(slug) {
		const item = await this.getArcanum(slug);
		if (!item) return slug;
		return this._backRealised(item) && item.back?.item ? arcanumItemResourceKey(item) : slug;
	}

	async addArcanum(slug) {
		const slugsWeHae = this.ownedSlugs;
		slugsWeHae.add(slug);
		await this._flags.setFlag("owned", [...slugsWeHae]);
	}

	/**
	 * Whether a card is still exactly as a background's `setup.arcana` row gave it (see
	 * StonetopCharacter#settleBackgroundArcana): owned, read as far as the row said and no further
	 * (no GM reveal, no owed back, not a lead), marked with the row's boxes and no others, and no
	 * unlock or back option counted. `flipped` is only which face is showing, so it doesn't count.
	 * An unticked box is stored as false (setArcanumBoxChecked), which is the same as never marked.
	 *
	 * The Seeker's creation grants read the same way (StonetopCharacter#settleSeekerArcana), with
	 * what each role gives: `reveal` (the found card, both sides read), `lead` (a lead placeholder)
	 * and `unlock` (the mastered card's unlock requirements, `{ optionSlug: count }`).
	 */
	isAsGranted({ slug, identify = false, reveal = false, lead = false, boxes = [], unlock = {} } = {}) {
		if (!slug || !this.ownedSlugs.has(slug)) return false;
		if (this.identifiedSlugs.has(slug) !== !!identify) return false;
		if (this.revealedSlugs.has(slug) !== !!reveal) return false;
		if (this.leadSlugs.has(slug) !== !!lead) return false;
		if (this.backOwedSlugs.has(slug)) return false;
		const prefix = `${slug}:`;
		const marked = key => Object.entries(this._flags.getFlag(key) ?? {})
			.filter(([k, v]) => k.startsWith(prefix) && (typeof v === "number" ? v > 0 : !!v))
			.map(([k]) => k);
		const granted = new Set(boxes.map(box => `${slug}:${box.context ?? "front"}:${Number(box.index ?? 0)}`));
		const ticked  = marked("boxes");
		if (ticked.length !== granted.size || ticked.some(k => !granted.has(k))) return false;
		const counts   = this.unlockCounts;
		const expected = Object.entries(unlock).filter(([, n]) => Number(n) > 0);
		const counted  = marked("unlock");
		if (counted.length !== expected.length) return false;
		if (expected.some(([option, n]) => Number(counts[`${prefix}${option}`]) !== Number(n))) return false;
		return !marked("backOptions").length;
	}

	async removeArcanum(slug, options = {}) {
		await this._flags.applyUpdateData(await this.removeArcanumData(slug, options));
	}

	/**
	 * The card's marked Consequences, for the Remove confirm: `{ index, label }` per ticked □ of its
	 * back's Consequences section (consequenceBoxRange), in printed order. [] when none is marked.
	 */
	async markedConsequences(slug) {
		const item = await this.getArcanum(slug);
		const range = consequenceBoxRange(item?.back?.description);
		if (!range) return [];
		const boxes = this.boxStates;
		const out = [];
		for (let i = range.from; i < range.to; i++) {
			if (boxes[`${slug}:back:${i}`]) out.push({ index: i, label: consequenceLabel(item.back.description, i) });
		}
		return out;
	}

	/**
	 * Removing a card, as ONE update fragment: every per-card trace of this slug, not just
	 * owned/identified. Leaving the reveal flag or the unlock/mark maps behind means re-acquiring the
	 * same arcanum later (a fresh drop or level-up pick) silently restores a GM-revealed back, or a
	 * fully-unlocked/marked state, with no GM action: a spoiler leak plus stale marks.
	 *
	 * `keepConsequences` keeps the ticked boxes of the card's Consequences section (and the slug's
	 * box-layout markers, so they are never shifted twice), since Book I p.442 says Consequences "stay
	 * marked even if their impact is passing, temporary, or undone": re-adding the card restores them,
	 * and Death's Door reads them while the card is not held. StonetopCharacter#removeArcanum adds the
	 * card's resource tracks and carried mark to the same update.
	 *
	 * @param {string} slug
	 * @param {{keepConsequences?: boolean}} [o]
	 */
	async removeArcanumData(slug, { keepConsequences = false } = {}) {
		const prefix = `${slug}:`;
		const data = {};
		// Slug arrays: the filtered array replaces it wholesale (arrays are not merged).
		for (const key of ["owned", "identified", "backOwed", "leads", "revealed", "flipped", "unlockedOnce", "owedAtLatch"]) {
			const cur = this._flags.getFlag(key) ?? [];
			if (cur.includes(slug)) Object.assign(data, this._flags.updateData(key, cur.filter(s => s !== slug)));
		}
		const kept = new Set();
		if (keepConsequences) {
			for (const { index } of await this.markedConsequences(slug)) kept.add(`${slug}:back:${index}`);
		}
		// Keyed maps ("<slug>:…" keys): an update MERGES, so each sub-key is deleted on its own.
		// `titles` is the stored name a deleted homebrew card's stub goes by (HB-6).
		for (const key of ["unlock", "boxes", "backOptions", "boxLayouts", "notes", "titles"]) {
			if (key === "boxLayouts" && kept.size) continue;
			const cur = this._flags.getFlag(key) ?? {};
			for (const k of Object.keys(cur)) {
				if ((k === slug || k.startsWith(prefix)) && !kept.has(k)) Object.assign(data, this._flags.subKeyDeletionData(key, k));
			}
		}
		return data;
	}

	// The three outcomes of identifying an arcanum (Book I, Discoveries p.440). The book's
	// ladder is a disclosure ladder, and the two flags we already keep are exactly its two
	// rungs: `identified` means the owner may read the FRONT, `revealed` means they may also
	// read the BACK of a still-locked card (it's the only owner-side input to the sheet's
	// permittedBack). So a 10+ writes both, a 7-9 writes only `identified`, and a 6- writes
	// nothing. Each write is batched so one tier is one document update / one re-render, and
	// each takes `options` so the caller can attribute it in the ledger ({stonetopMove: …}).

	/** Read the front, and nothing more. The GM's "front only" hand-over. */
	async identifyArcanum(slug, options) {
		const identified = this.identifiedSlugs;
		identified.add(slug);
		await this._flags.setFlag("identified", [...identified], options);
	}

	/**
	 * "on a 10+, give them the card and have them read both sides" — front and back at once.
	 * Clears any outstanding back debt from an earlier 7-9 on the same card, since the back
	 * has now arrived.
	 */
	async identifyAndRevealArcanum(slug, options) {
		const identified = this.identifiedSlugs;
		const revealed   = this.revealedSlugs;
		const backOwed   = this.backOwedSlugs;
		identified.add(slug);
		revealed.add(slug);
		backOwed.delete(slug);
		await this._flags.batch({ sets: {
			identified: [...identified],
			revealed:   [...revealed],
			backOwed:   [...backOwed],
		} }, options);
	}

	/**
	 * "on a 7-9, have them read the front, and show them the back when they have some time to
	 * study it or learn more" — the front now, the back as a debt the GM settles later. The
	 * debt needs its own flag because `identified && !revealed` is also the resting state of
	 * every card a GM simply hands over front-only; without it the promise would live only in
	 * a chat message that scrolls away.
	 */
	async identifyFrontOwedArcanum(slug, options) {
		const identified = this.identifiedSlugs;
		const backOwed   = this.backOwedSlugs;
		identified.add(slug);
		backOwed.add(slug);
		await this._flags.batch({ sets: {
			identified: [...identified],
			backOwed:   [...backOwed],
		} }, options);
	}

	// Record a "lead": the owner knows this arcanum exists and roughly where it is, but
	// hasn't recovered it yet (the Seeker's Lead role). It shows on the arcana tab as a
	// placeholder card. A lead is owned so it renders, but weightedInventoryItems skips
	// leadSlugs so its curio never leaks to the Inventory tab or the expedition load.
	async addLead(slug) {
		const owned = this.ownedSlugs;
		const leads = this.leadSlugs;
		owned.add(slug);
		leads.add(slug);
		// ONE update: three writes landed in any order, and `owned` arriving before `leads` read on
		// the timeline as a card found rather than a lead.
		await this._flags.batch({ sets: {
			owned: [...owned],
			leads: [...leads],
			// Materializing the lead card (here or via onboarding) also arms the one-time
			// backfill guard, so a card the player later removes isn't resurrected on the next
			// world load. Without this the onboarding path leaves the flag unset and
			// ensureLeadBackfill can't tell "never had a card" from "had one and deleted it".
			leadBackfilled: true,
		} });
	}

	// Discover a lead: the owner has recovered the arcanum, so drop the lead marker and give it
	// as the Found role gives its card (StonetopCharacter#settleSeekerArcana): identified AND
	// revealed, since a found card is one whose both sides the player has reviewed ("Draw 3 at
	// random and review both sides", the 2026-09-27 ruling). Any back a 7-9 owed on it has arrived with it.
	// One batched write, so the card turns over in one render.
	async discoverArcanum(slug) {
		const leads = this.leadSlugs;
		if (!leads.has(slug)) return;
		leads.delete(slug);
		const identified = this.identifiedSlugs;
		const revealed   = this.revealedSlugs;
		const backOwed   = this.backOwedSlugs;
		identified.add(slug);
		revealed.add(slug);
		backOwed.delete(slug);
		await this._flags.batch({ sets: {
			leads:      [...leads],
			identified: [...identified],
			revealed:   [...revealed],
			backOwed:   [...backOwed],
		} });
	}

	// One-time backfill for Seekers created before the lead-card feature. Their onboarding
	// "Lead" pick was stored only as a role (minorRoles.lead) and never shown as a card;
	// surface it as a lead card. Guarded by a per-actor flag so a card the player later
	// discovers (identifies) or removes is never resurrected on the next world load. No-op
	// for non-Seekers, for Seekers with no Lead pick, and once the flag is set.
	async ensureLeadBackfill() {
		const leadSlug = this.minorRoles?.lead;
		if (!leadSlug) return;
		if (this._flags.getFlag("leadBackfilled")) return;
		if (!this.ownedSlugs.has(leadSlug)) await this.addLead(leadSlug);
		await this._flags.setFlag("leadBackfilled", true);
	}

	// Mark a card as fully realized ("mastered"): satisfy every option unlock requirement and
	// fill its unlock circles so _isUnlocked() reports true. Used at onboarding for the Seeker's
	// mastered minor, which begins play already realized — it carries its back item and its back
	// is visible to the owner. No-op if the slug can't be resolved to a pack/world arcanum.
	async masterArcanum(slug) {
		const grant = await this.masteryGrant(slug);
		if (!grant) return;
		const unlock = { ...this.unlockCounts };
		const boxes  = { ...this.boxStates };
		// Each count and box its own sub-key, so nothing else on the character is re-sent from this
		// copy, and the unlock latch in the SAME update.
		const data = {};
		for (const [option, count] of Object.entries(grant.unlock)) {
			unlock[`${slug}:${option}`] = count;
			Object.assign(data, this._flags.subKeyData("unlock", `${slug}:${option}`, count));
		}
		for (const box of grant.boxes) {
			boxes[`${slug}:${box.context}:${box.index}`] = true;
			Object.assign(data, this._flags.subKeyData("boxes", `${slug}:${box.context}:${box.index}`, true));
		}
		Object.assign(data, await this._latchData(slug, { unlock, boxes }));
		await this._flags.applyUpdateData(data);
	}

	/**
	 * What masterArcanum writes for a card, as an isAsGranted row's `unlock` and `boxes`: each option
	 * requirement at its max (on an either/or card, the options of its FIRST path only: one road is
	 * how it was mastered), every ○ and □ of the unlock lead (one box per glyph), and the front tasks.
	 * Null when the card can't be resolved.
	 */
	async masteryGrant(slug) {
		const item = await this.getArcanum(slug);
		if (!item) return null;
		const unlock = {};
		for (const req of _requiredOptions(item.front?.unlock?.requirements)) unlock[req.slug] = req.max ?? 1;
		const steps = _unlockSteps(item);
		const boxes = _unlockMarks(steps);
		// A front-task card is mastered by its tasks, every one of them.
		for (const { context, index } of steps.tasks?.markers ?? []) boxes.push({ context, index });
		return { unlock, boxes };
	}

	/**
	 * Finish the Seeker's mastered card where the old masterArcanum left it short. It counted the
	 * unlock lead's ○ by RUN, so a card printing "○○○" got `unlock:0` alone and has read as locked
	 * since the count went per glyph. Only the card the Seeker's creation mastered is touched: a
	 * part-marked track on any other card is play, not a short grant. Answers whether it wrote.
	 */
	async repairMasteredUnlock() {
		const slug = this.minorRoles?.mastered;
		if (!slug || !this.ownedSlugs.has(slug)) return false;
		const grant = await this.masteryGrant(slug);
		if (!grant || grant.boxes.length < 2) return false;
		const boxes = this._flags.getFlag("boxes") ?? {};
		const key = box => `${slug}:${box.context}:${box.index}`;
		if (!boxes[key(grant.boxes[0])] || grant.boxes.every(box => boxes[key(box)])) return false;
		await this.masterArcanum(slug);
		return true;
	}

	/**
	 * Take back what masterArcanum gave (a Seeker's mastered card re-chosen as the found one): its
	 * unlock requirements and unlock circles. Other play on the card stays.
	 */
	async unmasterArcanum(slug) {
		const grant = await this.masteryGrant(slug);
		if (!grant) return;
		const deletes = {};
		const unlockKeys = Object.keys(grant.unlock).map(option => `${slug}:${option}`).filter(k => k in this.unlockCounts);
		const boxes      = this._flags.getFlag("boxes") ?? {};
		const boxKeys    = grant.boxes.map(box => `${slug}:${box.context}:${box.index}`).filter(k => k in boxes);
		if (unlockKeys.length) deletes.unlock = unlockKeys;
		if (boxKeys.length)    deletes.boxes  = boxKeys;
		if (Object.keys(deletes).length) await this._flags.batch({ deletes });
	}

	/**
	 * Drop the lead marker from a card without identifying it (a Seeker's lead re-chosen as the
	 * mastered or found card, which identifies it its own way). No-op when it is not a lead.
	 */
	async dropLead(slug) {
		const leads = this.leadSlugs;
		if (!leads.delete(slug)) return;
		await this._flags.setFlag("leads", [...leads]);
	}

	/**
	 * Store the Seeker's creation bookkeeping (seeker-collection.js#seekerArcanaState) in ONE
	 * update: the chosen major, the minor draw, its roles and the major's onboarding marks. An empty
	 * field is removed rather than stored, so a change of playbook's clear and a re-run agree.
	 */
	async setSeekerCreation({ major = "", minorDraw = [], minorRoles = {}, majorMarks = [] } = {}) {
		const hasRoles = Object.values(minorRoles).some(Boolean);
		const entries = [
			["major",      major || null],
			["minorDraw",  minorDraw.length ? [...minorDraw] : null],
			["minorRoles", hasRoles ? { ...minorRoles } : null],
			["majorMarks", majorMarks.length ? [...majorMarks] : null],
		];
		const data = {};
		for (const [key, value] of entries) {
			if (value !== null) Object.assign(data, this._flags.updateData(key, value));
			else if (this._flags.getFlag(key) != null) Object.assign(data, this._flags.deletionData(key));
		}
		await this._flags.applyUpdateData(data);
	}

	// GM-only: in secretive mode, expose / hide a still-LOCKED card's back to the owning
	// player (an unlocked back is always visible to its owner, and with the peek setting on
	// players see backs anyway, so the reveal toggle only shows for a locked card while the
	// setting is off). The GM always sees both sides regardless.
	async revealArcanum(slug, options) {
		const revealed = this.revealedSlugs;
		const backOwed = this.backOwedSlugs;
		revealed.add(slug);
		// Handing the back over settles a 7-9's debt, whether the GM does it from the card's
		// footer or from the "back is owed" strip. Batched with the reveal so the strip can't
		// linger for a render after the back arrives. Most reveals owe nothing, so they stay a
		// plain single write rather than a batch of two.
		if (backOwed.delete(slug)) {
			await this._flags.batch({ sets: { revealed: [...revealed], backOwed: [...backOwed] } }, options);
		} else {
			await this._flags.setFlag("revealed", [...revealed], options);
		}
	}

	async hideArcanum(slug, options) {
		const s = this.revealedSlugs;
		s.delete(slug);
		await this._flags.setFlag("revealed", [...s], options);
	}

	/**
	 * Set one unlock option's count: its own sub-key (a second client's tick on another option is
	 * not written back from this copy), with the unlock latch in the same update when it completes
	 * the track.
	 */
	async setUnlockCount(arcanumSlug, optionSlug, count, options) {
		const key = `${arcanumSlug}:${optionSlug}`;
		const unlock = { ...this.unlockCounts, [key]: count };
		await this._flags.applyUpdateData({
			...this._flags.subKeyData("unlock", key, count),
			...await this._latchData(arcanumSlug, { unlock, trackEdit: true }),
		}, options);
	}

	/**
	 * The unlock latch's fragment for a write that leaves a card's marks at `unlock` / `boxes`: the
	 * slug added to `unlockedOnce` when those marks complete its track for the first time, and any
	 * back a 7-9 owed on it settled (the back is the owner's now). Written IN THE SAME update as the
	 * mark, so no client ever sees the track complete without the latch.
	 *
	 * The latch lets go again when a write to the unlock track itself (`trackEdit`) leaves it short
	 * and nothing on the back has been marked yet: that is a misclicked last ○ taken back, not the
	 * "erase all marks" the latch is for, which every such card prints after a move is chosen on the
	 * reverse. Any back debt the latch settled is owed again. {} when nothing changes.
	 */
	async _latchData(slug, { unlock = this.unlockCounts, boxes = this.boxStates, item = null, trackEdit = false } = {}) {
		const latched = this.unlockedOnceSlugs;
		const wasLatched = latched.has(slug);
		if (wasLatched && (!trackEdit || _backMarked(slug, boxes, this.backOptionCounts))) return {};
		const card = item ?? await this.getArcanum(slug);
		if (!card?.front) return {};
		const complete = _trackComplete(card, unlock ?? {}, boxes ?? {});
		if (wasLatched === complete) return {};
		const owed    = this.backOwedSlugs;
		const settled = this.owedAtLatchSlugs;
		if (complete) latched.add(slug); else latched.delete(slug);
		const data = this._flags.updateData("unlockedOnce", [...latched]);
		if (complete && owed.delete(slug)) {
			settled.add(slug);
			Object.assign(data, this._flags.updateData("backOwed", [...owed]), this._flags.updateData("owedAtLatch", [...settled]));
		} else if (!complete && settled.delete(slug)) {
			owed.add(slug);
			Object.assign(data, this._flags.updateData("backOwed", [...owed]), this._flags.updateData("owedAtLatch", [...settled]));
		}
		return data;
	}

	/**
	 * Save the player's note on a card (`arcana.notes[slug]`), its own sub-key; an empty note is
	 * dropped. Answers whether it wrote.
	 */
	async setArcanumNote(slug, text, options) {
		const value = String(text ?? "").replace(/\r\n/g, "\n").slice(0, 4000);
		const had = this.notes[slug];
		if ((had ?? "") === value) return false;
		const data = value.trim()
			? this._flags.subKeyData("notes", slug, value)
			: (slug in this.notes ? this._flags.subKeyDeletionData("notes", slug) : {});
		if (!Object.keys(data).length) return false;
		await this._flags.applyUpdateData(data, options);
		return true;
	}

	/** Which BOX_LAYOUT_CHANGES this character's marks already follow, by `marker`. */
	get boxLayouts() { return this._flags.getFlag("boxLayouts") ?? {}; }

	/**
	 * Bring this character's marks up to cards whose printed boxes have moved (BOX_LAYOUT_CHANGES).
	 * Marks with no marker were stored against the old text, so they are shifted once and the
	 * marker is written IN THE SAME UPDATE: settling again, from any client, in any order, finds
	 * the marker and does nothing. `stamp` also writes the marker when nothing needs moving,
	 * which every write to such a card does first, so a mark made against the new text is never
	 * taken for an old one. Quiet in the ledger: the marks mean what they always meant.
	 *
	 * @param {{slug?: string, stamp?: boolean}} [o]  `slug` limits it to one card's changes
	 * @returns {Promise<boolean>} whether anything was written
	 */
	async settleBoxLayouts({ slug = null, stamp = false } = {}) {
		const done = this.boxLayouts;
		const boxes = this._flags.getFlag("boxes") ?? {};
		let next = null;
		const markers = {};
		for (const change of BOX_LAYOUT_CHANGES) {
			if ((slug && change.slug !== slug) || done[change.marker]) continue;
			const moved = shiftedBoxes(next ?? boxes, change);
			if (moved) next = moved;
			if (moved || stamp) markers[change.marker] = true;
		}
		if (!Object.keys(markers).length) return false;
		const sets = { boxLayouts: { ...done, ...markers } };
		if (next) sets.boxes = next;
		await this._flags.batch({ sets }, { stonetopLedger: true });
		return true;
	}

	/** Several of one card's boxes in one write: `ticks` maps a box index to checked. */
	async setArcanumBoxesChecked(slug, context, ticks) {
		await this.settleBoxLayouts({ slug, stamp: true });
		const boxes = this._flags.getFlag("boxes") ?? {};
		const changed = {};
		for (const [index, checked] of Object.entries(ticks ?? {})) {
			const key = `${slug}:${context}:${index}`;
			if (!!boxes[key] !== !!checked) changed[key] = !!checked;
		}
		await this._writeBoxes(slug, changed);
	}

	/**
	 * Set one box. Refused (answers false, nothing written) for a slot the card holds shut
	 * (arcanumSlotLocked: the Redwood Effigy's potential Conduits before GREATER CONDUIT).
	 */
	async setArcanumBoxChecked(slug, context, index, checked, options) {
		await this.settleBoxLayouts({ slug, stamp: true });
		const boxes = this.boxStates;
		const key = `${slug}:${context}:${index}`;
		if (!!boxes[key] === !!checked) return true;
		const item = await this.getArcanum(slug);
		if (checked && arcanumSlotLocked(item, context, index, boxes)) return false;
		await this._writeBoxes(slug, { [key]: !!checked }, { item, options });
		return true;
	}

	/**
	 * Write changed box states for one card, each its own sub-key (unticked stored false, which
	 * reads as never marked), with the unlock latch in the same update.
	 */
	async _writeBoxes(slug, changed, { item = null, options } = {}) {
		if (!Object.keys(changed ?? {}).length) return;
		const data = {};
		for (const [key, value] of Object.entries(changed)) Object.assign(data, this._flags.subKeyData("boxes", key, value));
		const trackEdit = Object.keys(changed).some(key => _UNLOCK_TRACK_CONTEXTS.has(key.slice(slug.length + 1).split(":")[0]));
		Object.assign(data, await this._latchData(slug, { boxes: { ...this.boxStates, ...changed }, item, trackEdit }));
		await this._flags.applyUpdateData(data, options);
	}

	/**
	 * Tick the first unmarked ○ of a card's unlock track: Improvise's 10+, "mark one step towards
	 * unlocking the arcanum's mysteries". Answers `{index, count, title}`, with `index` null when
	 * there was nothing to tick (a card whose steps are not ○, like the Mindgem's □ tasks, which
	 * arcana-seeker-moves.js#markImproviseStep then asks about, or one whose circles are all
	 * marked), or null when the card is gone.
	 *
	 * Counts GLYPHS, not runs: the marker pass gives every ○ of "○○○○" its own index.
	 */
	async markNextUnlockStep(slug, options) {
		const item = await this.getArcanum(slug);
		if (!item) return null;
		const title = item.front?.title ?? slug;
		const count = unlockCircleCount(item.front?.unlock?.description);
		const boxes = this._flags.getFlag("boxes") ?? {};
		let index = null;
		for (let i = 0; i < count; i++) {
			if (!boxes[`${slug}:unlock:${i}`]) { index = i; break; }
		}
		if (index === null) return { index, count, title };
		await this._writeBoxes(slug, { [`${slug}:unlock:${index}`]: true }, { item, options });
		return { index, count, title };
	}

	async setBackOptionCount(arcanumSlug, optionSlug, count) {
		await this._flags.setSubKey("backOptions", `${arcanumSlug}:${optionSlug}`, count);
	}

	async getArcanumChatContent(slug, flipped) {
		const [item] = await this._arcanaRepo.findBySlugs([slug]);
		if (!item) return null;

		if (flipped) {
			const { title, description, move } = item.back;
			let body = `<div class="card-content">${description ?? ""}`;
			if (move) body += `<p class="stonetop-arcanum-move-trigger"><strong><em>${move.name}</em></strong></p>${move.description ?? ""}`;
			return stonetopChatCard(title, body + `</div>`, "stonetop-arcanum-chat-card");
		} else {
			const { title, description, unlock } = item.front;
			let body = `<div class="card-content">${description ?? ""}`;
			if (unlock?.description) {
				body += `<p class="stonetop-arcanum-unlock-lead">${unlock.description}</p>`;
				const reqs = unlock.requirements ?? [];
				if (reqs.length) {
					const items = reqs.map(r => `<li>${r.type === "text" ? r.content : r.description}</li>`).join("");
					body += `<ul class="stonetop-arcanum-unlock-list">${items}</ul>`;
				}
			}
			return stonetopChatCard(title, body + `</div>`, "stonetop-arcanum-chat-card");
		}
	}

	async weightedInventoryItems() {
		const ownedSlugs   = this.ownedSlugs;
		const identified   = this.identifiedSlugs;
		const leads        = this.leadSlugs;
		const unlockCounts = this.unlockCounts;
		const arcanaBoxes  = this._flags.getFlag("boxes") ?? {};
		const unlockedOnce = this.unlockedOnceSlugs;
		const items = await this._arcanaRepo.findBySlugs([...ownedSlugs]);
		return items.flatMap(item => {
			// A "lead" is owned (so it renders on the arcana tab as a placeholder) but not yet
			// recovered, so its curio isn't in the party's packs — skip it entirely, or the
			// not-yet-found item leaks into the Inventory/Outfit list and its ◇ counts toward
			// load. Discovering the lead clears it from leadSlugs, at which point it flows through.
			if (leads.has(item.slug)) return [];
			// Which side's item you carry follows the card's unlock state, not the old manual
			// flip: a card realises its back-side item once unlocked, otherwise it's the front
			// item. Gate on identified too, so an unidentified face-down mystery always shows its
			// front curio — a homebrew card whose unlock is vacuously satisfied (no options, no
			// circles) can't leak its back item before it's even identified. unlockCircleCount counts
			// each ○, as buildSnapshot's marker pass indexes them, so the two counts can't drift.
			const unlocked = _backRealised(item, identified, unlockCounts, arcanaBoxes, unlockedOnce);
			const onBack   = !!(unlocked && item.back.item);
			const sideItem = onBack ? item.back.item : item.front.item;
			// Skip unnamed sides, and skip a card's weightless side when the card is one of the
			// shipped places the book leaves untagged (CONCEPT_ARCANA_SLUGS). A weightless
			// curio ("A gold ring", "A wolf pelt") still renders — at ◇0 — since most arcana
			// curios ship with no explicit weight; only true places are held back.
			if (sideItem?.weight == null && CONCEPT_ARCANA_SLUGS.has(item.slug)) return [];
			// An IMMOBILE side is too big to carry on your person, and an IMPLANTED one carries
			// an item only so its card can print the book's tag line. Both say so in that tag
			// line, so both are read off it: there is nothing in your hands and nothing in your
			// load. Applied per side, so a place whose realised BACK item is real gear (the vein
			// of milky crystal's Moonstone) still surfaces that gear once unlocked.
			//
			// THROUGH THE SHARED PREDICATE, which is also what gives a card its Relic chip in the
			// browser: the two used to be written out separately and had already come apart, so a
			// GM could read "the arcanum itself is an item in your load" on a chip and find no
			// such row on the sheet. The unnamed-side check is folded into it.
			if (!isCarriedArcanumItem(sideItem)) return [];
			// Through the same builder the card's own item rows go through, so a field added to
			// one reaches the other: this differs from a card row only in the two defaults a
			// carried curio wants (a weightless curio still occupies a ◇, and it lands in the
			// arcana column) and in the armor, which rides the REALISED side — an arcanum whose
			// back-side curio is the armored one only protects you once it's unlocked, and it
			// rises with any ticked mystery that raises it (the Rune-laden Scales' PROOF AGAINST
			// HARM takes 2 armor to 3).
			return [_buildOutfitItem(item.slug, {
				...sideItem,
				weight: sideItem.weight ?? 0,
				inventoryColumn: sideItem.inventoryColumn ?? "arcana",
				armor: unlockedArcanumArmor(item, sideItem, arcanaBoxes),
				// The realised back item's uses live where the Arcana tab keeps them (arcanumItemResourceKey).
				resourceKey: onBack ? arcanumItemResourceKey(item) : null,
			})];
		});
	}
}
