import { LOAD_LEVEL_LIMITS, loadBandLabels, loadBonusLabel } from "../utils/load.js";

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Load is a derived readout — the count of ◇ actually marked (checked item
 * weights plus the undefined regular pool), bucketed into a load level. The
 * player never picks it directly; marking items or editing the pool re-derives it.
 *
 * @property {string} instruction
 * @property {string|null} selected
 * @property {boolean} loadLevelLight
 * @property {boolean} loadLevelNormal
 * @property {boolean} loadLevelHeavy
 * @property {boolean} loadLevelOverloaded - 10+ ◇ (heavy and then some): risk exhaustion/injury
 * @property {number} totalMarks           - Total ◇ marked (checked weights + undefined pool)
 */
export class LoadSnapshot {
	constructor(b) {
		this.instruction        = b._instruction;
		this.selected           = b._selected;
		this.loadLevelLight     = b._loadLevelLight;
		this.loadLevelNormal    = b._loadLevelNormal;
		this.loadLevelHeavy     = b._loadLevelHeavy;
		this.loadLevelOverloaded = b._loadLevelOverloaded ?? false;
		this.totalMarks         = b._totalMarks ?? 0;
	}
}

export class LoadSnapshotBuilder {
	withInstruction(v)        { this._instruction        = v; return this; }
	withSelected(v)           { this._selected           = v; return this; }
	withLoadLevelLight(v)     { this._loadLevelLight     = v; return this; }
	withLoadLevelNormal(v)    { this._loadLevelNormal    = v; return this; }
	withLoadLevelHeavy(v)     { this._loadLevelHeavy     = v; return this; }
	withLoadLevelOverloaded(v){ this._loadLevelOverloaded = v; return this; }
	withTotalMarks(v)         { this._totalMarks         = v; return this; }
	build()                   { return new LoadSnapshot(this); }
}

// ── Inventory item ────────────────────────────────────────────────────────────

/**
 * @property {string} slug
 * @property {string} name
 * @property {string|null} note
 * @property {number} weight
 * @property {boolean} checked
 * @property {Resource|null} resource
 * @property {boolean} resourceFirst - Render the ○ track BEFORE the note inside the
 *           parenthetical, so light items read the book's way: "Oil lamp (○○○ hours, close,
 *           area, crude)". Default false keeps the note-first order (weapons trail their
 *           "low ammo / all out" ammo track).
 * @property {string|null} resourceSuffix - Text rendered inside the parenthetical, after the
 *           ○ track, so an item reads "Skins of fine whisky (○○ uses, grants advantage to
 *           Persuade)" — the book's own phrasing, with the uses track sitting mid-sentence.
 * @property {boolean} isCustom
 * @property {string|null} ownedId
 * @property {boolean} twoCol
 * @property {boolean} breakBefore
 * @property {ArtifactView} artifact - What this row shows of an artifact's identification ladder
 *           (Book I pp.430-431). Kept as the ONE object concealArtifactFields hands over rather
 *           than exploded into seven siblings: the seven are only meaningful together, and split
 *           apart they could be set half from a concealed view and half from a revealed one. On
 *           ordinary gear it is EMPTY_ARTIFACT, whose `state` is "".
 *
 *           `note` and `resource` above are ALREADY concealed to match — the row's hidden tags
 *           never reach the snapshot, let alone the DOM. See actors/character/artifact-identify.js.
 *
 * @typedef {object} ArtifactView
 * @property {string} state     "" on ordinary gear; "unknown" / "partial" / "known" on a hidden one
 * @property {boolean} isArtifact Does this row have artifact state at all? `state !== ""` said as
 *           a flag, because that is the question a template asks and `{{#if artifact.state}}`
 *           only answers it by accident of "" being falsy.
 * @property {boolean} concealed Something is still hidden from the player, so the row draws its
 *           "?" chip and offers the identify affordance.
 * @property {boolean} gmPeeking The viewer is the GM and is seeing more than the owner does; the
 *           row is tinted to say so.
 * @property {boolean} loreOwed  A 7-9 settled: the write-up is still owed.
 * @property {string} hint      The GM's "more than meets the eye" line, or "".
 * @property {string} lore      The full write-up, or "" while it is still owed.
 * @property {string} lead      "How they could learn more", or "".
 */

/** What a row with no artifact state shows: nothing, in the shape the template expects. */
export const EMPTY_ARTIFACT = Object.freeze({
	state: "", isArtifact: false, concealed: false, gmPeeking: false, loreOwed: false,
	hint: "", lore: "", lead: "",
});
export class InventoryItemSnapshot {
	constructor(b) {
		this.slug        = b._slug;
		this.name        = b._name;
		this.note        = b._note;
		this.weight      = b._weight;
		this.checked     = b._checked;
		this.disabled    = b._disabled ?? false;
		this.resource    = b._resource;
		this.resourceFirst = b._resourceFirst ?? false;
		this.resourceSuffix = b._resourceSuffix ?? null;
		this.isCustom    = b._isCustom;
		this.ownedId     = b._ownedId;
		this.twoCol      = b._twoCol;
		this.breakBefore = b._breakBefore;
		this.isAddedSpecial = b._isAddedSpecial ?? false;
		this.artifact       = b._artifact ?? EMPTY_ARTIFACT;
	}
}

export class InventoryItemSnapshotBuilder {
	withSlug(v)        { this._slug        = v; return this; }
	withName(v)        { this._name        = v; return this; }
	withNote(v)        { this._note        = v; return this; }
	withWeight(v)      { this._weight      = v; return this; }
	withChecked(v)     { this._checked     = v; return this; }
	withResource(v)    { this._resource    = v; return this; }
	withResourceFirst(v) { this._resourceFirst = v; return this; }
	withResourceSuffix(v) { this._resourceSuffix = v; return this; }
	withIsCustom(v)    { this._isCustom    = v; return this; }
	withOwnedId(v)     { this._ownedId     = v; return this; }
	withTwoCol(v)      { this._twoCol      = v; return this; }
	withBreakBefore(v) { this._breakBefore = v; return this; }
	withIsAddedSpecial(v) { this._isAddedSpecial = v; return this; }
	/**
	 * Takes the whole concealed view from concealArtifactFields, and KEEPS it whole, so the row
	 * cannot be built with a revealed write-up beside a hidden state by setting one and not the
	 * other. Normalised here rather than trusted, so a caller handing over a partial object still
	 * yields a row the template can render.
	 */
	withArtifact(v) {
		this._artifact = v ? {
			state:      v.state ?? "",
			// Derived rather than copied, so a caller handing over a half-built view can't leave the
			// flag disagreeing with the state it is supposed to be shorthand for.
			isArtifact: !!(v.state ?? ""),
			concealed: !!v.concealed,
			gmPeeking: !!v.gmPeeking,
			loreOwed:  !!v.loreOwed,
			hint:      v.hint ?? "",
			lore:      v.lore ?? "",
			lead:      v.lead ?? "",
		} : EMPTY_ARTIFACT;
		return this;
	}
	build()            { return new InventoryItemSnapshot(this); }
}

/** One contiguous block of grid or list items in OutfitSnapshot.regularSegments. */
export class InventorySegmentSnapshot {
	constructor(isGrid, segmentBreak, items) {
		this.isGrid       = isGrid;
		this.segmentBreak = segmentBreak;
		this.items        = items;
	}
}

// ── Outfit ────────────────────────────────────────────────────────────────────

/**
 * @property {LoadSnapshot} load
 * @property {InventoryItemSnapshot[]} regularItems
 * @property {InventorySegmentSnapshot[]} regularSegments
 * @property {Resource} regularPool
 * @property {InventoryItemSnapshot[]} smallItems
 * @property {InventoryItemSnapshot[]} smallGridItems
 * @property {Resource} smallPool
 * @property {InventoryItemSnapshot[]} arcanaRegular - Owned arcana whose curio carries ◇ load,
 *           under the Arcana heading in the regular column. Markable; counts toward load.
 * @property {InventoryItemSnapshot[]} arcanaSmall   - Owned arcana whose curio is weightless
 *           (◇0), under the matching Arcana heading in the small column. INERT — no checkbox
 *           (`times 0` renders none) and deliberately exempt from the 4+Prosperity allowance,
 *           since these have never cost a player anything.
 * @property {InventoryItemSnapshot[]} treasureRegular - Book II treasures dragged in from a
 *           journal that carry ◇ load, rendered under a "Treasures" heading at the foot of the
 *           regular column rather than among the write-ins. Still real inventory items: marking
 *           one counts toward load like any other ◇ gear.
 * @property {InventoryItemSnapshot[]} treasureSmall   - Pocket-sized journal treasures, under the
 *           same heading in the small column; marking one eats the 4+Prosperity allowance.
 * @property {number|null} smallItemLimit - 4+Prosperity from the linked steading actor, or null if unavailable
 * @property {string|null} steadingName   - Name of the linked steading actor, or null if unavailable
 * @property {number} loadBonus           - Total ◇ the owned moves add to every load cap (0 for most)
 * @property {string[]} loadBonusMoves    - Names of the moves that granted it, in sheet order. The
 *           Ranger's Pack Horse is the printed source, but a custom or world-authored move carrying
 *           a loadBonus counts the same, so the boosted help text names whichever move actually did
 *           it instead of assuming the horse.
 * @property {string} loadBonusFrom       - Those names as one readable phrase, "" when the caps are
 *           the printed 3/6/9. This is what the notes print, and what gates them.
 * @property {{light:number, normal:number, heavy:number}} loadLimits - Per-load weight caps in effect
 * @property {{light:string, normal:string, heavy:string}} loadBands - Those caps as the "3" / "4–6" /
 *           "7–9" captions the load lines print, derived so a bonus shifts every band at once
 */
export class OutfitSnapshot {
	constructor(b) {
		this.load            = b._load;
		this.regularItems    = b._regularItems;
		this.regularSegments = b._regularSegments;
		this.regularPool      = b._regularPool;
		// True reservable ceiling for the undefined pool (room left under the load cap
		// after marked items). The track itself (regularPool.max) always shows the full
		// load capacity, so this smaller cap is what drives the "at your limit" toast when
		// a player clicks an empty slot past the room they actually have.
		this.regularPoolCap   = b._regularPoolCap ?? 0;
		this.smallItems       = b._smallItems;
		this.smallGridItems   = b._smallGridItems;
		this.smallPool        = b._smallPool;
		this.smallPoolCap     = b._smallPoolCap ?? 0;
		this.arcanaRegular   = b._arcanaRegular ?? [];
		this.arcanaSmall     = b._arcanaSmall ?? [];
		this.treasureRegular = b._treasureRegular ?? [];
		this.treasureSmall   = b._treasureSmall ?? [];
		this.smallItemLimit  = b._smallItemLimit ?? null;
		this.steadingName    = b._steadingName ?? null;
		this.loadBonus       = b._loadBonus ?? 0;
		this.loadBonusMoves  = b._loadBonusMoves ?? [];
		this.loadBonusFrom   = loadBonusLabel(this.loadBonusMoves);
		this.loadLimits      = b._loadLimits ?? LOAD_LEVEL_LIMITS;
		this.loadBands       = loadBandLabels(this.loadLimits);
	}
}

export class OutfitSnapshotBuilder {
	withLoad(v)            { this._load            = v; return this; }
	withRegularItems(v)    { this._regularItems    = v; return this; }
	withRegularSegments(v) { this._regularSegments = v; return this; }
	withRegularPool(v)     { this._regularPool     = v; return this; }
	withRegularPoolCap(v)  { this._regularPoolCap  = v; return this; }
	withSmallItems(v)      { this._smallItems      = v; return this; }
	withSmallGridItems(v)  { this._smallGridItems  = v; return this; }
	withSmallPool(v)       { this._smallPool       = v; return this; }
	withSmallPoolCap(v)    { this._smallPoolCap    = v; return this; }
	withArcanaRegular(v)   { this._arcanaRegular   = v; return this; }
	withArcanaSmall(v)     { this._arcanaSmall     = v; return this; }
	withTreasureRegular(v) { this._treasureRegular = v; return this; }
	withTreasureSmall(v)   { this._treasureSmall   = v; return this; }
	withSmallItemLimit(v)  { this._smallItemLimit  = v; return this; }
	withSteadingName(v)    { this._steadingName    = v; return this; }
	withLoadBonus(v)       { this._loadBonus       = v; return this; }
	withLoadBonusMoves(v)  { this._loadBonusMoves  = v; return this; }
	withLoadLimits(v)      { this._loadLimits      = v; return this; }
	build()                { return new OutfitSnapshot(this); }
}

// ── Possessions ───────────────────────────────────────────────────────────────

/**
 * @property {number} pickCount
 * @property {string} pickNote
 * @property {PossessionItemSnapshot[]} items
 */
export class PossessionsSnapshot {
	constructor(pickCount, pickNote, items, isIncomplete = false) {
		this.pickCount    = pickCount;
		this.pickNote     = pickNote;
		this.items        = items;
		this.isIncomplete = isIncomplete;
	}
}

/**
 * @property {string} slug
 * @property {string} label
 * @property {string} description
 * @property {boolean} selected
 * @property {boolean} checked
 * @property {boolean} disabled
 * @property {boolean} preselected
 * @property {string|null} preselectedSource
 * @property {Resource|null} resource
 * @property {string|null} usesLabel
 * @property {Object|null} choices
 * @property {Object|null} choiceGroups
 * @property {Array<{heading: string, selections: string}>|null} choiceSummary
 *           Read-only prose summary of the player's picks from this possession's
 *           `choiceGroups` (e.g. the Blessed's sacred pouch flavor + remarkable
 *           trait), one line per group heading. Null when nothing is chosen.
 * @property {boolean} isCustom  Player-written "something else (discuss with GM)" possession,
 *                               removed via the × button rather than deselected from the list.
 * @property {InventoryItemSnapshot[]} grantedRegular  This possession's bundled ◇ gear
 *           (the Distillery's firkins), rendered inside the card above grantedSmall. Real
 *           inventory items — marking one still counts toward load, like the Items column.
 * @property {InventoryItemSnapshot[]} grantedSmall    This possession's bundled non-◇ gear
 *           (whisky, malt, stills), rendered below grantedRegular; marking one still counts
 *           toward the small-item allowance.
 * @property {{regular: Object[], small: Object[], pickNote: string|null, hasPicked: boolean}|null} choiceGear
 *           A gear-bearing `choices` bundle (the Heavy's / Marshal's Weapons of War): the options
 *           the player has *chosen*, as ◇/□ item-rows. The diamond is the load mark only — you
 *           choose which weapons you own on the edit-mode `choices` checklist, then tick the ones
 *           you're carrying. Each row carries its possession/choice slugs, weight, carried state,
 *           and (for the crossbow) an ammo resource. `pickNote` heads that edit-mode checklist;
 *           `hasPicked` keeps the block off the card until something is chosen. Null unless the
 *           possession is selected and its `choices` object is flagged `gear`.
 */
export class PossessionItemSnapshot {
	constructor(b) {
		this.slug              = b._slug;
		this.label             = b._label;
		this.description       = b._description;
		this.selected          = b._selected;
		this.checked           = b._checked;
		this.disabled          = b._disabled;
		this.preselected       = b._preselected;
		this.preselectedSource = b._preselectedSource;
		this.resource          = b._resource;
		this.usesLabel         = b._usesLabel;
		this.choices           = b._choices;
		this.choiceGroups      = b._choiceGroups;
		this.choiceSummary     = b._choiceSummary ?? null;
		// Whether this possession has editable choiceGroups (the sacred pouch), so the
		// gear tab can show an "edit" pencil that opens the standalone choices editor.
		this.hasChoiceGroups   = b._hasChoiceGroups ?? false;
		this.isCustom          = b._isCustom ?? false;
		this.grantedRegular    = b._grantedRegular ?? [];
		this.grantedSmall      = b._grantedSmall ?? [];
		this.choiceGear        = b._choiceGear ?? null;
	}
}

export class PossessionItemSnapshotBuilder {
	withSlug(v)              { this._slug              = v; return this; }
	withLabel(v)             { this._label             = v; return this; }
	withDescription(v)       { this._description       = v; return this; }
	withSelected(v)          { this._selected          = v; return this; }
	withChecked(v)           { this._checked           = v; return this; }
	withDisabled(v)          { this._disabled          = v; return this; }
	withPreselected(v)       { this._preselected       = v; return this; }
	withPreselectedSource(v) { this._preselectedSource = v; return this; }
	withResource(v)          { this._resource          = v; return this; }
	withUsesLabel(v)         { this._usesLabel         = v; return this; }
	withChoices(v)           { this._choices           = v; return this; }
	withChoiceGroups(v)      { this._choiceGroups      = v; return this; }
	withChoiceSummary(v)     { this._choiceSummary     = v; return this; }
	withHasChoiceGroups(v)   { this._hasChoiceGroups   = v; return this; }
	withCustom(v)            { this._isCustom          = v; return this; }
	withGrantedRegular(v)    { this._grantedRegular    = v; return this; }
	withGrantedSmall(v)      { this._grantedSmall      = v; return this; }
	withChoiceGear(v)        { this._choiceGear        = v; return this; }
	build()                  { return new PossessionItemSnapshot(this); }
}

// ── Inventory ─────────────────────────────────────────────────────────────────

/**
 * @property {OutfitSnapshot} outfit
 * @property {PossessionsSnapshot|null} possessions
 * @property {OtherItemSnapshot[]} other
 */
export class InventorySnapshot {
	constructor(outfit, possessions, other, loveLetters = []) {
		this.outfit      = outfit;
		this.possessions = possessions;
		this.other       = other;
		// Single-use, GM-authored love letters (moveType "other", flagged loveLetter). Held
		// apart from `other` so they render in their own top-of-Moves section, never the
		// "Other Moves" list. See actors/character/love-letters.js.
		this.loveLetters = loveLetters;
	}
}
