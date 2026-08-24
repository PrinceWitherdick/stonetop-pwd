export { ResourceDef, Resource, ResourceBuilder } from "./Resource.js";
export { StatSnapshot } from "./StatSnapshot.js";
export { ValueMax, VitalsSnapshot, VitalsSnapshotBuilder } from "./VitalsSnapshot.js";
export { DebilitySnapshot, DebilitySnapshotBuilder } from "./DebilitySnapshot.js";
export { WoundSnapshot, WoundSnapshotBuilder } from "./WoundSnapshot.js";
export {
	LoreOptionSnapshot, LoreOptionSnapshotBuilder,
	LoreEntrySnapshot, LoreEntrySnapshotBuilder,
	LoreSection,
	AppearanceOptionSnapshot, AppearanceLineSnapshot, AppearanceSection,
	InstinctOptionSnapshot, InstinctOptionSnapshotBuilder, InstinctSection,
	OriginOptionSnapshot, OriginSection,
	BackgroundChoiceOptionSnapshot,
	BackgroundChoicesSnapshot, BackgroundChoicesSnapshotBuilder,
	BackgroundOptionSnapshot, BackgroundOptionSnapshotBuilder, BackgroundSection,
	PlaybookSnapshot, PlaybookSnapshotBuilder,
} from "./PlaybookSnapshot.js";
export {
	RequirementSnapshot,
	MoveSnapshot, MoveSnapshotBuilder,
	MoveCategorySnapshot, MoveCategorySnapshotBuilder,
	MoveGroupSnapshot,
} from "./MoveSnapshot.js";
export {
	OtherItemSnapshot, OtherItemSnapshotBuilder,
	Movelist, MovelistBuilder,
} from "./Movelist.js";
export {
	LoadSnapshot, LoadSnapshotBuilder,
	InventoryItemSnapshot, InventoryItemSnapshotBuilder,
	InventorySegmentSnapshot,
	OutfitSnapshot, OutfitSnapshotBuilder,
	PossessionsSnapshot,
	PossessionItemSnapshot, PossessionItemSnapshotBuilder,
	InventorySnapshot,
} from "./InventorySnapshot.js";
export {
	PostDeathInsertSnapshot, PostDeathInsertSnapshotBuilder,
	PostDeathSectionSnapshot, PostDeathSectionSnapshotBuilder,
} from "./PostDeathInsertSnapshot.js";
export {
	ArcanaSnapshot, ArcanaSectionSnapshot,
	MinorArcanumSnapshot, MinorArcanumSnapshotBuilder,
	MinorArcanumFrontSnapshot, MinorArcanumFrontSnapshotBuilder,
	MinorArcanumBackSnapshot, MinorArcanumBackSnapshotBuilder,
	ArcanumUnlockSection, ArcanaUnlockTextItem,
	ArcanaUnlockOptionSnapshot, ArcanaUnlockOptionSnapshotBuilder,
	ArcanaBackOptionSnapshot, ArcanaBackOptionSnapshotBuilder,
	ArcanumBackMoveSnapshot,
} from "./ArcanaSnapshot.js";

/**
 * The canonical read-only data object returned by `StonetopCharacter.buildSnapshot()`.
 *
 * External sheets and systems consume this shape directly — no Foundry APIs
 * or Stonetop internals required after the snapshot is built.
 *
 * @property {string} name
 * @property {PlaybookSnapshot|null} playbook
 * @property {DebilitySnapshot[]} debilities - always 3: weakened, dazed, miserable
 * @property {WoundSnapshot[]} wounds - problematic/permanent wounds (may be empty)
 * @property {Object.<string, StatSnapshot>} stats - keys: str dex con int wis cha
 * @property {VitalsSnapshot} vitals
 * @property {MoveCategorySnapshot[]} moves - only categories with ≥1 move included
 * @property {Movelist} movelist
 * @property {InventorySnapshot} inventory
 * @property {ArcanaSnapshot} arcana
 * @property {PostDeathSectionSnapshot} postDeathInsert
 */
export class CharacterSnapshot {
	constructor(b) {
		this.name            = b._name;
		this.playbook        = b._playbook;
		this.debilities      = b._debilities;
		this.wounds          = b._wounds ?? [];
		this.stats           = b._stats;
		this.vitals          = b._vitals;
		this.moves           = b._moves;
		this.movelist        = b._movelist;
		this.inventory       = b._inventory;
		this.arcana          = b._arcana;
		this.postDeathInsert = b._postDeathInsert;
		this.crewBonuses     = b._crewBonuses ?? null;
		// { hp, armor, traitPicks } applied to the Animal Companion card (Beast of
		// Legend "+4 HP/+1 armor", Magnificent Specimen extra trait picks).
		this.companionBonuses = b._companionBonuses ?? null;
		// Who is looking. The gear section already conceals a hidden artifact's tags by this
		// same fact, so the snapshot answers "may this viewer see GM-only affordances" itself
		// rather than leaving each caller to bolt the answer on afterwards — a second caller
		// that passed `viewerIsGM` correctly and forgot the bolt-on would silently lose the
		// controls. Defaults false, the safe way round.
		this.isGM            = !!b._isGM;
	}
}

export class CharacterSnapshotBuilder {
	withName(v)            { this._name            = v; return this; }
	withPlaybook(v)        { this._playbook        = v; return this; }
	withDebilities(v)      { this._debilities      = v; return this; }
	withWounds(v)          { this._wounds          = v; return this; }
	withStats(v)           { this._stats           = v; return this; }
	withVitals(v)          { this._vitals          = v; return this; }
	withMoves(v)           { this._moves           = v; return this; }
	withMovelist(v)        { this._movelist        = v; return this; }
	withInventory(v)       { this._inventory       = v; return this; }
	withArcana(v)          { this._arcana          = v; return this; }
	withPostDeathInsert(v) { this._postDeathInsert = v; return this; }
	withCrewBonuses(v)     { this._crewBonuses     = v; return this; }
	withCompanionBonuses(v) { this._companionBonuses = v; return this; }
	withViewerIsGM(v)      { this._isGM            = v; return this; }
	build()                { return new CharacterSnapshot(this); }
}
