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
import { CONDENSED_MOVE_SLUG, condensedArcanumMove, findArcanumMove, markArcanumMoveNames } from "../../data/arcana-moves.js";
import { boxIndexBefore, centerArcanumTracks, injectGlyphCheckboxes } from "../../utils/glyphs.js";
import { stonetopChatCard } from "../../utils/chat.js";
import { prettifySlug } from "../../utils/ledger-core.js";
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

function _isUnlocked(item, unlockCounts, arcanaBoxes, circleCount) {
	const reqs = item.front.unlock?.requirements ?? [];
	const reqsMet = reqs.every(r =>
		r.type !== "option" || (unlockCounts[`${item.slug}:${r.slug}`] ?? 0) >= (r.max ?? 1)
	);
	if (!reqsMet) return false;
	for (let i = 0; i < circleCount; i++) {
		if (!arcanaBoxes[`${item.slug}:unlock:${i}`]) return false;
	}
	// A card whose track is the □ tasks in its front text (the Mindgem, the Twisted Spear) has no
	// option or ○ for the checks above, so without this it read as unlocked once identified.
	const tasks = frontTaskTrack(item.front);
	if (tasks) return tasks.markers.filter(m => arcanaBoxes[`${item.slug}:front:${m.index}`]).length >= tasks.needed;
	return true;
}

/**
 * Whether the character has realised a card's back: identified, and its unlock track complete.
 * What decides which side's curio is carried, and whether the back's condensed move can be rolled.
 */
function _backRealised(item, identifiedSlugs, unlockCounts, arcanaBoxes) {
	return identifiedSlugs.has(item.slug)
		&& _isUnlocked(item, unlockCounts, arcanaBoxes, unlockCircleCount(item.front?.unlock?.description));
}

/**
 * Is the □ belonging to the named back-side mystery ticked?
 *
 * A mystery's box is identified by its printed LABEL, not by a hard-coded index: find the label
 * in the back text, take the last □ at or before it (the text reads "□ GREATER CONDUIT"), then
 * index it by counting the □ that precede it. That order matches _injectMarkers, which indexes □
 * in document order — so this survives edits to the back text that a bare index would not.
 *
 * Shared by the Redwood Effigy's Conduit slots and by the armor unlocks (the Rune-laden Scales'
 * PROOF AGAINST HARM); both used to be, or would have been, their own copy of this arithmetic.
 */
export function backBoxChecked(backDescription, slug, label, boxStates) {
	const index = boxIndexBefore(backDescription, label);
	return index >= 0 && !!boxStates[`${slug}:back:${index}`];
}

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
	return (String(description ?? "").match(/○/g) || []).length;
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

// A back description's "Consequences" section: its heading, and the body from there to the next
// heading (or the end), with where that body starts. Null when the card prints no such heading.
function _consequencesSection(text) {
	const m = _CONSEQUENCES_HEADING_RE.exec(text);
	if (!m) return null;
	const start = m.index + m[0].length;
	const after = text.slice(start);
	const nextHeading = after.search(/<h[1-6]\b/i);
	return { heading: m[0], start, body: nextHeading >= 0 ? after.slice(0, nextHeading) : after };
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
	const section = processedBackHtml ? _consequencesSection(processedBackHtml) : null;
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
 * consequence grants, not a consequence to mark. The section is _consequencesSection's.
 */
export function consequenceBoxRange(backDescription) {
	const text = String(backDescription ?? "");
	const section = _consequencesSection(text);
	if (!section) return null;
	const boxes = s => (s.match(/□/g) || []).length;
	const inside = boxes(section.body);
	if (!inside) return null;
	const from = boxes(text.slice(0, section.start));
	return { from, to: from + inside };
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

		const fetchedItems = await this._arcanaRepo.findBySlugs([...ownedSlugs]);

		const allItems = fetchedItems.map(item => {
			const unlockItems = (item.front.unlock?.requirements ?? []).map(li => {
				if (li.type === "text") return new ArcanaUnlockTextItem(li.content);
				const count = unlockCounts[`${item.slug}:${li.slug}`] ?? 0;
				return new ArcanaUnlockOptionSnapshotBuilder()
					.withSlug(li.slug)
					.withDescription(li.description)
					.withCount(count)
					.withMax(li.max ?? 1)
					.build();
			});

			const frontDesc = _processSideDescription(item.front.description, item.slug, "front", arcanaBoxes);
			const { html: unlockDesc, count: circleCount } = _injectMarkers(centerArcanumTracks(item.front.unlock?.description ?? ""), item.slug, "unlock", arcanaBoxes, "stonetop-arcanum-circle", _UNLOCK_CIRCLE_RE);
			const unlocked = _isUnlocked(item, unlockCounts, arcanaBoxes, circleCount);

			const front = new MinorArcanumFrontSnapshotBuilder()
				.withTitle(item.front.title)
				.withItem(_buildOutfitItem(item.slug, item.front.item))
				.withDescription(frontDesc)
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
			// A card can carry BOTH a back-power resource (above, keyed by bare slug) and a
			// back-ITEM resource. They'd otherwise share `resources[slug]` and clobber each
			// other, so the item track is keyed `${slug}:item`. Fall back to the bare slug so
			// shipped item-only cards (e.g. "A bow with no string") keep their saved counts.
			const backItemResource = backItemResourceDef
				? new ResourceBuilder()
					.withCurrent(inventoryResources[`${item.slug}:item`] ?? inventoryResources[item.slug] ?? 0)
					.withMax(backItemResourceDef.maxStat
						? (stats[backItemResourceDef.maxStat]?.value ?? 0)
						: backItemResourceDef.max)
					.withMaxStat(backItemResourceDef.maxStat ?? null)
					.withTitle(backItemResourceDef.title ?? null)
					.withLabels(backItemResourceDef.labels ?? [])
					.build()
				: null;

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
				.build();
		});

		// A held slug no pack or world arcanum answers to any more (a homebrew card the GM deleted)
		// becomes a stub with Remove instead of silently vanishing: left out, its slug and marks
		// stayed on the character with nothing on the sheet that could clear them, and a later card
		// minted with the same slug came back already marked. Its tier is unknown, so it is listed
		// with the minors; its title is the slug, the only name left for it.
		const resolved = new Set(fetchedItems.map(item => item.slug));
		const missing = [...ownedSlugs].filter(slug => slug && !resolved.has(slug)).map(slug =>
			new MinorArcanumSnapshotBuilder()
				.withSlug(slug)
				.withFront({ title: prettifySlug(slug), description: "", item: null, unlock: null })
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
			const learned = _backRealised(item, this.identifiedSlugs, this.unlockCounts, this._flags.getFlag("boxes") ?? {});
			return { ...move, name: String(item.back?.title ?? "").trim() || move.name, cardTitle, learned };
		}
		const move = findArcanumMove(item.back?.description ?? "", moveSlug);
		if (!move) return null;
		const boxes = this._flags.getFlag("boxes") ?? {};
		return {
			...move,
			cardTitle: item.back?.title ?? item.front?.title ?? "",
			learned:   move.boxIndex == null || !!boxes[`${slug}:back:${move.boxIndex}`],
		};
	}

	/** The resolved {@link MinorArcanum} for a slug (pack or world), or null. */
	async getArcanum(slug) {
		const [item] = await this._arcanaRepo.findBySlugs([slug]);
		return item ?? null;
	}

	/** Whether a card's unlock track is complete: its front's options, its ○ run and its □ tasks. */
	async isArcanumUnlocked(slug) {
		const item = await this.getArcanum(slug);
		if (!item?.front) return false;
		return _isUnlocked(item, this.unlockCounts, this.boxStates, unlockCircleCount(item.front.unlock?.description));
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

	async removeArcanum(slug) {
		// Clear every per-card trace of this slug, not just owned/identified. Leaving the reveal
		// flag or the unlock/mark maps behind means re-acquiring the same arcanum later (a fresh
		// drop or level-up pick) silently restores a GM-revealed back, or a fully-unlocked/marked
		// state, with no GM action — a spoiler leak plus stale marks.
		//
		// Batched into ONE actor.update so removing a card is a single document write / sheet
		// re-render, not ~10 sequential setFlag/unsetFlag calls each re-rendering the open sheet.
		const prefix = `${slug}:`;
		const sets = {}, deletes = {};
		// Slug arrays: writing the filtered array replaces it wholesale (mergeObject doesn't
		// deep-merge arrays), dropping the slug.
		for (const key of ["owned", "identified", "backOwed", "leads", "revealed", "flipped"]) {
			const cur = this._flags.getFlag(key) ?? [];
			if (cur.includes(slug)) sets[key] = cur.filter(s => s !== slug);
		}
		// Keyed maps ("<slug>:…" keys): an update MERGES, so it can't drop a key — delete each
		// removed sub-key with the "-=key" syntax (see setArcanumBoxChecked's mergeObject note).
		for (const key of ["unlock", "boxes", "backOptions", "boxLayouts"]) {
			const cur = this._flags.getFlag(key) ?? {};
			const drop = Object.keys(cur).filter(k => k === slug || k.startsWith(prefix));
			if (drop.length) deletes[key] = drop;
		}
		await this._flags.batch({ sets, deletes });
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
		await Promise.all([
			this._flags.setFlag("owned", [...owned]),
			this._flags.setFlag("leads", [...leads]),
			// Materializing the lead card (here or via onboarding) also arms the one-time
			// backfill guard, so a card the player later removes isn't resurrected on the next
			// world load. Without this the onboarding path leaves the flag unset and
			// ensureLeadBackfill can't tell "never had a card" from "had one and deleted it".
			this._flags.setFlag("leadBackfilled", true),
		]);
	}

	// Discover a lead: the owner has recovered the arcanum, so drop the lead marker and
	// identify it — it now renders as a normal (found) minor arcanum, exactly like a card
	// acquired through the Found role.
	async discoverArcanum(slug) {
		const leads = this.leadSlugs;
		if (!leads.has(slug)) return;
		leads.delete(slug);
		const identified = this.identifiedSlugs;
		identified.add(slug);
		await Promise.all([
			this._flags.setFlag("leads", [...leads]),
			this._flags.setFlag("identified", [...identified]),
		]);
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
		for (const [option, count] of Object.entries(grant.unlock)) unlock[`${slug}:${option}`] = count;
		const boxes = { ...(this._flags.getFlag("boxes") ?? {}) };
		for (const box of grant.boxes) boxes[`${slug}:${box.context}:${box.index}`] = true;
		await Promise.all([
			this._flags.setFlag("unlock", unlock),
			this._flags.setFlag("boxes", boxes),
		]);
	}

	/**
	 * What masterArcanum writes for a card, as an isAsGranted row's `unlock` and `boxes`: every
	 * option requirement at its max, and every ○ of the unlock lead (one box per glyph). Null when
	 * the card can't be resolved.
	 */
	async masteryGrant(slug) {
		const item = await this.getArcanum(slug);
		if (!item) return null;
		const unlock = {};
		for (const req of item.front?.unlock?.requirements ?? []) {
			if (req?.type === "option" && req.slug) unlock[req.slug] = req.max ?? 1;
		}
		const boxes = Array.from({ length: unlockCircleCount(item.front?.unlock?.description) }, (_, index) => ({ context: "unlock", index }));
		// A front-task card is mastered by its tasks, every one of them.
		for (const { context, index } of frontTaskTrack(item.front)?.markers ?? []) boxes.push({ context, index });
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

	async setUnlockCount(arcanumSlug, optionSlug, count) {
		const key = `${arcanumSlug}:${optionSlug}`;
		await this._flags.setFlag("unlock", { ...this.unlockCounts, [key]: count });
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
		// Unticked is stored false, not deleted, as setArcanumBoxChecked does.
		if (Object.keys(changed).length) await this._flags.batch({ sets: { boxes: { ...boxes, ...changed } } });
	}

	async setArcanumBoxChecked(slug, context, index, checked) {
		await this.settleBoxLayouts({ slug, stamp: true });
		const boxes = this._flags.getFlag("boxes") ?? {};
		const key = `${slug}:${context}:${index}`;
		if (!!boxes[key] === !!checked) return;
		// Store false explicitly rather than deleting the key — Foundry's setFlag uses
		// mergeObject internally, which preserves keys missing from the update object.
		await this._flags.setFlag("boxes", { ...boxes, [key]: !!checked });
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
		await this._flags.setFlag("boxes", { ...boxes, [`${slug}:unlock:${index}`]: true }, options);
		return { index, count, title };
	}

	async setBackOptionCount(arcanumSlug, optionSlug, count) {
		const key = `${arcanumSlug}:${optionSlug}`;
		await this._flags.setFlag("backOptions", { ...this.backOptionCounts, [key]: count });
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
			const unlocked = _backRealised(item, identified, unlockCounts, arcanaBoxes);
			const sideItem = (unlocked && item.back.item) ? item.back.item : item.front.item;
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
			})];
		});
	}
}
