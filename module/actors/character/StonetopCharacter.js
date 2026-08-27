import {
	AppearanceLineSnapshot,
	AppearanceOptionSnapshot,
	AppearanceSection,
	BackgroundChoiceOptionSnapshot,
	BackgroundChoicesSnapshotBuilder,
	BackgroundOptionSnapshotBuilder,
	BackgroundSection,
	CharacterSnapshotBuilder,
	DebilitySnapshotBuilder,
	WoundSnapshotBuilder,
	InstinctOptionSnapshotBuilder,
	InstinctSection,
	InventoryItemSnapshotBuilder,
	InventorySegmentSnapshot,
	InventorySnapshot,
	LoadSnapshotBuilder,
	MoveCategorySnapshotBuilder,
	MoveGroupSnapshot,
	MovelistBuilder,
	MoveSnapshotBuilder,
	OriginOptionSnapshot,
	OriginSection,
	OtherItemSnapshotBuilder,
	OutfitSnapshotBuilder,
	PlaybookSnapshotBuilder,
	PossessionItemSnapshotBuilder,
	PossessionsSnapshot,
	RequirementSnapshot,
	ResourceBuilder,
	ResourceDef,
	StatSnapshot,
	ValueMax,
	VitalsSnapshotBuilder,
} from "../../model/CharacterSnapshot.js";
import {PlaybookMoveEntry} from "./PlaybookMoveEntry.js";
import {normalizeRollMode} from "../../dialogs/RollDialog.js";
import {deletionEntry} from "../../utils/foundry-compat.js";
import {statRequirementLabel, statRequirementsUnmet} from "./stat-requirement.js";
import {MoveResources} from "./MoveResources.js";
import {moveMarkBudget} from "./move-mark-budget.js";
import {StonetopFlags, STONETOP_SCOPE, resolvedFlags, resolvedFlagProperty} from "./StonetopFlags.js";
import {DEATHS_DOOR_FLAG, canFaceDeathsDoor, deathsDoorRollOptions, effectiveDeathsDoorState, zeroHpMove, zeroHpResolution} from "./deaths-door.js";
import {heroDisplayName, WBH_HERO_FLAG, ownsAsteriskMove} from "./WouldBeHeroAsterisk.js";
import {ownedNamesOr, ownedMove} from "./owns-move.js";
import {RITES_OF_THE_LAND} from "./stock-cost.js";
import {HOLY_LIGHT_FLAG, canWieldHolyLight} from "./holy-light.js";
import {ONGOING_INVOCATION_FLAG, readOngoing} from "./ongoing-invocation.js";
import {CONDEMNED_FLAG, canCondemn, readCondemned, addCondemned, removeCondemned, noteCondemned} from "./condemn.js";
import {OATHS_FLAG, canBindOaths, readOaths, addOath, removeOath, noteOath, setOathBroken} from "./oaths.js";
import {BLESSED_MARKS_FLAG, canMarkBlessed, readMarks, addMark, removeMark, noteMark, setMarkLoyalty, setMarkSign} from "./blessed-marks.js";
import {BATTLE_JOY_FLAG, BATTLE_JOY, canEnterBattleJoy, ignoresDebilities} from "./battle-joy.js";
import {CharacterBackgrounds} from "./CharacterBackgrounds.js";
import {CharacterInstincts} from "./CharacterInstincts.js";
import {CharacterAppearance} from "./CharacterAppearance.js";
import {CharacterOrigin} from "./CharacterOrigin.js";
import {CharacterPossessions} from "./CharacterPossessions.js";
import {grantsToCreate, grantSourceMap, grantAdoptionKeys, itemGrantKey} from "./possession-grants.js";
import {CharacterInventory} from "./CharacterInventory.js";
import {maybeBeginAttack, attackMoveFor} from "../../combat/attack-flow.js";
import {defendReadinessHold, defendReadinessCap} from "../../combat/defend-readiness.js";
import {classifyResult} from "../../utils/roll-engine.js";
import {xpToLevelUp, withXpLock} from "../../utils/xp.js";
import {CharacterArcana} from "./CharacterArcana.js";
import {CharacterLore} from "./CharacterLore.js";
import {CharacterPostDeath, buildLoreSection, insertHpPenalty} from "./CharacterPostDeath.js";
import {effectiveSubgroupMax, sumMoveBonus} from "./dialogs/possession-choice-cap.js";
import {partitionMovesByGroup} from "./dialogs/onboarding-move-groups.js";
import {FoundryRepositoryFactory} from "./repositories/FoundryRepositoryFactory.js";
import {capitalizeFirst, slugify, composeInstinct, escHtml, stripHtmlToText} from "../../utils/strings.js";
import {splitFillBlank, fillBlank} from "../../utils/fill-blanks.js";
import {localize as _loc} from "../../utils/i18n.js";
import {getStonetopSteadingActor} from "../../utils/world.js";
import {moveChatCard} from "../../utils/chat.js";
import {normalizeRollType} from "../../utils/roll-types.js";
import {buildCustomMoveData, clampInt} from "../../utils/custom-move-data.js";
import {buildInventoryItemData, readInventoryItemData} from "../../utils/inventory-item-data.js";
import {ARTIFACT_STATE, concealArtifactFields, isArtifactUpgrade, normalizeArtifactState} from "./artifact-identify.js";
import {isLoveLetter} from "./love-letters.js";
import {deriveLoadLevel, loadLimitsFor} from "../../utils/load.js";
import {maxDie, stepDie, normalizeDamageDie} from "../../utils/damage-die.js";

const OTHER_MOVE_TYPES = ["background", "special", "follower", "homefront"];
// Expedition moves that operate on the STEADING rather than the individual hero,
// so they are not surfaced as player expedition moves: Requisition rolls +Fortunes
// and Return Triumphant clears a steading debility (or raises Fortunes). Both live
// on the steading sheet's Homefront moves instead (see StonetopSteadingSheet). They
// stay `moveType: "expedition"` in the compendium so the rulebook reference journal
// keeps listing them under Expedition Moves — this filter only governs the character
// sheet (both the sidebar catalog and the auto-embed of universal moves).
const NON_PLAYER_EXPEDITION_MOVES = new Set(["Requisition", "Return Triumphant"]);
const ROLL_LABELS_BY_TYPE = {
	str: "STR",
	dex: "DEX",
	int: "INT",
	wis: "WIS",
	con: "CON",
	cha: "CHA",
};
const HOMEFRONT_ROLL_LABELS_BY_NAME = {
	"Deploy": "Defenses",
	"Muster": "Population",
	"Pull Together": "Population",
	"Seasons Change": "Fortunes",
	"Trade & Barter": "Prosperity",
};
const ORIGIN_DESCRIPTIONS = {
	barrierPass: "<p>Blocked by a massive wall and gate, held by stoic, unfriendly folk who want little to do with strangers. They live on mountain goats and sheep, brook no trespass, and only rarely come down to trade ancient wonders for crops or livestock.</p>",
	gordinsDelve: "<p>A mining town in the Huffel Peaks. Folk make their way there when they are on the run or have nothing left back home, drawn by Maker-made passages that plunge beneath the mountains and by rare trade from the mask-wearing Ustrina.</p>",
	lygos: "<p>The towns of the arid south lie far beyond Marshedge. Trade is steady between them and the South Manmarch, but they are distant from Stonetop, about thirty days from Marshedge by road.</p>",
	manmarch: "<p>The <strong>North Manmarch</strong> is home to aggressive, warlike folk who dwell in wooden longhouses and are caught in an eternal cycle of blood-feud. The <strong>South Manmarch</strong> is more sparsely inhabited, with nomads hunting aurochs herds and trading with Marshedge and Lygos.</p>",
	marshedge: "<p>A proper town, with a wooden palisade, market, and town council. They grow hemp and wheat and gather wild rice and herbs from Ferrier's Fen, though Brennan and his old gang, the Claws, dominate the town watch.</p>",
	steplands: "<p>A rugged wilderness, home to the nomadic Hillfolk: horselords and shepherds, fierce to outsiders. They trade horses, wool, and salt, revile Gordin's Delve for prying sacred metals from the earth, and warn travelers away from ancient burial mounds.</p>",
	stonetop: "<p>A tight-knit village of about three hundred souls, built around a massive standing stone at the edge of the Great Wood. Everyone is expected to pull their weight, take their turn at guard duty, and help protect the community when danger comes.</p>",
	wild: "<p>The area around Stonetop includes the Great Wood, the Flats, and other dangerous places beyond the roads. The Forest Folk have vanished, crinwin grow bolder, and hunters bring back stories of fresh ruins, strange spirits, and twisted things in the trees.</p>",
};

// True for player-authored custom moves (flagged at creation by buildCustomMoveData).
// The flag distinguishes them from foreign playbook moves that also land in "other".
function _isCustomMove(item) {
	return !!item?.flags?.[STONETOP_SCOPE]?.custom;
}

// A custom move can be "un-learned" — kept on the sheet but inactive (not rollable, its
// hp/armor/load bonuses stop applying). An absent flag means learned, so every freshly
// authored move and any authored before this feature reads as learned. Non-custom moves
// are always active, so this returns true for them too.
function _isMoveLearned(item) {
	return item?.flags?.[STONETOP_SCOPE]?.learned !== false;
}

// Total a numeric `system.<field>` across every LEARNED move the actor owns, and name the
// moves that actually contributed, in sheet order. The shared spine of _ownedLoadBonus /
// _ownedShieldLoadReduction (and any future per-move bonus), so the "skip un-learned moves"
// rule lives in exactly one place and can't be forgotten -- and so a note naming the source
// can never disagree with the total it explains, since both come off the same single pass.
function _learnedMoveField(actor, field) {
	let total = 0;
	const names = [];
	for (const i of actor.items) {
		if (i.type !== "move" || !_isMoveLearned(i)) continue;
		const value = Number(i.system?.[field]) || 0;
		if (value === 0) continue;
		total += value;
		if (i.name) names.push(i.name);
	}
	return { total, names };
}

// Resource-track snapshot for an "other" move, in the shape the resourceChecks helper
// consumes ({ title, max, labels, current }), or null when the move has no track. The
// held value lives under flags.stonetop-pwd.moves.backgroundChoices, keyed by the move's
// resourceKey (item id for custom moves, name otherwise — see buildMovelist), so the
// existing .stonetop-item-resource-check handler works for custom moves unchanged.
function _buildOtherMoveResource(resource, current) {
	// Every field comes off ResourceDef, which already defaults max/title/labels and builds the
	// "Spend 1 to: …" hover — so the track is normalized in exactly one place, the same as a
	// playbook move's. A player-authored move never sets spendOptions (the create-a-move dialog
	// doesn't offer them), but a foreign playbook move that lands in Other Moves can carry them
	// — `system.resource` is preserved verbatim — and its hold track should read the way it does
	// on its own playbook.
	const def = new ResourceDef(resource ?? {});
	const max = clampInt(def.max, 0, 20);
	if (!(max > 0)) return null;
	return {
		title: def.title,
		max,
		// ResourceDef coerces both list fields, so `labels` is an array here whatever arrived.
		labels: def.labels,
		current: Math.max(0, Math.min(max, Number(current) || 0)),
		spendTooltip: def.spendTooltip,
	};
}

// Slugs whose resource max equals 4+Prosperity. Matches the `prosperityResource`
// flag in the JSON source; acts as the runtime fallback until the pack is
// recompiled with that flag present in the LevelDB.
const _PROSPERITY_RESOURCE_SLUGS = new Set(["supplies", "more-supplies", "even-more-supplies"]);
const _WEAPONS_OF_WAR_CATEGORY = "Weapons of War";
const _WEAPONS_OF_WAR_IMPROVEMENT = "weaponsOfWar";

// Resolve "x piercing" against the steading's Prosperity for display. With Prosperity
// 1+ it shows the actual value ("2 piercing"); at 0, no steading (null), or negative,
// the literal "x piercing" trait is left in place so it always shows on the sheet.
function _transformPiercingNote(note, prosperity) {
	// Match the variable "x piercing" marker case-insensitively: a free-typed note may
	// capitalize the x (the chip inserts lowercase, and wrapGearNoteTerms normalizes new
	// notes, but this also catches any already-saved capital form).
	const marker = /x <em>piercing<\/em>/i;
	if (!note || !marker.test(note)) return note;
	if (prosperity === null) return note; // no steading → leave literal "x piercing"
	if (prosperity <= -1) return note.replace(marker, '<em>crude</em>');
	return note.replace(marker, `${Math.min(prosperity, 2)} <em>piercing</em>`);
}

// A gear-bearing `choices` option (Weapons of War) leads its label with the run of ◇/◆
// that is its load weight (◇ Sword = 1, ◇◇ Long spear = 2); a weightless keepsake leads
// with none and lands in the small column. Split that run off and return the readable
// remainder so the row can render an interactive ◇ track beside a clean label.
function _parseChoiceGear(rawLabel) {
	const label = String(rawLabel ?? "");
	const m = label.match(/^\s*([◇◆]+)\s*/);
	return { weight: m ? m[1].length : 0, label: (m ? label.slice(m[0].length) : label).trim() };
}

// A weapon's ammo statuses are printed inline in the book — "Crossbow (far, +1 damage,
// reload, x piercing, ○ low ammo, ○ all out)" — so the row's interactive circles stand in
// for those glyphs rather than trailing the line as a bare track. Split the label at the
// first ○ into { before, one status per circle, after }, where `after` is whatever trails
// the last status (the label's closing paren). statuses is empty when there's no run.
function _splitInlineStatuses(label) {
	const text  = String(label ?? "");
	const start = text.indexOf("○");
	if (start < 0) return { before: text, statuses: [], after: "" };
	const parts = text.slice(start).split("○").slice(1);
	// Only the LAST status can be followed by the label's closing punctuation, so peel it
	// off before mapping rather than testing the index on every pass.
	const last  = parts.pop();
	const close = last.indexOf(")");
	const trim  = s => s.replace(/[,\s]+$/, "").trim();
	return {
		before:   text.slice(0, start),
		statuses: [...parts, close >= 0 ? last.slice(0, close) : last].map(trim),
		after:    close >= 0 ? last.slice(close) : "",
	};
}

// On the gear tab a possession's circle track renders in the component's top-right,
// so the inline "○○○ uses" count baked into the playbook description is redundant.
// Strip it — but only for possessions that actually have a track (onboarding shows
// no track, so it keeps the raw description), and only circle-runs tied to the word
// "use(s)". This leaves ◇ encumbrance markers and other counts ("○○○○○ hours",
// "○○ firkins") untouched. Handles the three authoring shapes seen in the playbooks:
// leading "(○○○ uses) …", leading bare "○○○ uses: …", and mid-text "(○○ uses, …)".
function _stripPossessionUsesAnnotation(desc, resourceDef) {
	if (!desc || !resourceDef) return desc;
	let out = desc;
	let strippedLead = false;
	const lead1 = out.replace(/^\s*\(\s*[○●◯]+\s*uses?\b\s*\)\s*/i, "");
	if (lead1 !== out) { out = lead1; strippedLead = true; }
	const lead2 = out.replace(/^\s*[○●◯]+\s*uses?\b\s*:?\s*/i, "");
	if (lead2 !== out) { out = lead2; strippedLead = true; }
	out = out.replace(/\(\s*[○●◯]+\s*uses?\b\s*,\s*/gi, "(").trim();
	// Re-capitalise the first letter only when a leading clause was removed, so the
	// remaining text reads as its own sentence ("expend a use…" → "Expend a use…").
	if (strippedLead && out) out = out.charAt(0).toUpperCase() + out.slice(1);
	return out;
}

// A move can raise every load cap via its `loadBonus` field (the Ranger's Pack
// Horse sets it to 1). The caps and the count→tier bucketing live in utils/load.js
// so the sheet, snapshot defaults, and dialog can't drift. The granting moves' names
// come back alongside the total, so the notes on the sheet, in the Outfit dialog and in
// the expedition load readout can say which move raised the caps. They used to all say
// "Pack Horse", which is a lie on any character whose bonus came from a custom or
// world-authored move instead.
function _ownedLoadBonus(actor) {
	return _learnedMoveField(actor, "loadBonus");
}

// The standard Shield inventory item (Book I p.86). The Heavy/Judge/Marshal's Armored
// move halves its ◇ load — see _ownedShieldLoadReduction.
const _SHIELD_SLUG = "shield";

// The Defend basic move holds Readiness (p.216) — the only move with the on-sheet
// circle track; the Heavy's Guardian move sweetens each hold by +1 (and so needs no
// circle of its own — it just adds one to Defend's track).
const _DEFEND_MOVE_NAME = "Defend";
const _GUARDIAN_MOVE_NAME = "Guardian";
// Where a character's held Defend Readiness lives (a flag on the actor, mirroring how
// followers store theirs under readiness paths in _FOLLOWER_FLAGS).
const _DEFEND_READINESS_FLAG = "readiness";

// The Armored move ("carry a shield, mark only ◆ instead of ◆◆") drops a carried shield's
// ◇ load by its `shieldLoadReduction`. Like loadBonus, the mechanic lives in the move's data
// so buildSnapshot never hard-codes a move name.
function _ownedShieldLoadReduction(actor) {
	return _learnedMoveField(actor, "shieldLoadReduction").total;
}

// The id seed every standing-list row is minted with (see _rosterWrite). One width, in one place,
// because the rows are addressed by it: three call sites each passing their own length is how two
// of the rosters come to disagree about how unique a row id is.
const newRosterId = () => foundry.utils.randomID(16);

export class StonetopCharacter {
	constructor(actor, repos) {
		this._actor = actor;
		this._playbookRepo        = repos.playbook;
		this._moveRepo            = repos.moves;
		this._inventoryRepo       = repos.inventory;
		this._postDeathInsertRepo = repos.postDeathInsert;
		this._background = new CharacterBackgrounds(new StonetopFlags(actor, "background"));
		this._instinct = new CharacterInstincts(new StonetopFlags(actor, "instinct"));
		this._appearance = new CharacterAppearance(new StonetopFlags(actor, "appearance"));
		this._origin = new CharacterOrigin(new StonetopFlags(actor, "origin"));
		this._moveResources = new MoveResources(new StonetopFlags(actor, "moves"));
		this._possessions = new CharacterPossessions(new StonetopFlags(actor, "possessions"));
		this._inventory = new CharacterInventory(new StonetopFlags(actor, "inventory"));
		this._arcana = new CharacterArcana(new StonetopFlags(actor, "arcana"), repos.arcana);
		this._lore = new CharacterLore(new StonetopFlags(actor, "lore"));
		this._postDeath = new CharacterPostDeath(
			new StonetopFlags(actor, "postDeathInsert"),
			new CharacterInstincts(new StonetopFlags(actor, "postDeathInstinct")),
			new CharacterLore(new StonetopFlags(actor, "postDeathLore")),
			repos.postDeathInsert,
			repos.moves,
		);
	}

	static create(actor) {
		return new StonetopCharacter(actor, new FoundryRepositoryFactory());
	}

	get type() { return this._actor.type; }
	get background() { return this._background; }
	get instinct() { return this._instinct; }
	get appearance() { return this._appearance; }
	get origin() { return this._origin; }
	get moveResources() { return this._moveResources; }
	get possessions() { return this._possessions; }

	get _characterLevel() { return this._actor.system?.attributes?.level?.value ?? 1; }

	// Potential-for-Greatness stat slot: choosing a stat writes +1 to that stored
	// stat (and reverts the previously chosen one), recording the level it was
	// marked on. Newly filled slots auto-fill the current level.
	async setStatSlot(moveName, optionSlug, index, newStat) {
		const entries = _markEntries(this._moveResources.getMarks()[moveName]?.[optionSlug]);
		while (entries.length <= index) entries.push({ stat: "", level: null });
		const oldStat = entries[index].stat ?? "";
		if (oldStat === newStat) return;
		const stats = this._actor.system?.stats ?? {};
		const updates = {};
		if (oldStat && stats[oldStat]) updates[`system.stats.${oldStat}.value`] = (stats[oldStat].value ?? 0) - 1;
		if (newStat && stats[newStat]) updates[`system.stats.${newStat}.value`] = (stats[newStat].value ?? 0) + 1;
		entries[index] = { stat: newStat, level: newStat ? (oldStat ? entries[index].level : this._characterLevel) : null };
		// One document write: the stat deltas and the mark record together.
		await this._actor.update({ ...updates, ...this._moveResources.markUpdate(moveName, optionSlug, entries) });
	}

	// Checkbox mark options (e.g. max HP, damage die): set how many are checked,
	// auto-filling the current level on newly checked marks. When the move declares a
	// `markBudget`, an INCREASE is clamped so the picks across all its options never
	// exceed the repeat-scaling budget — model-side enforcement so the cap holds from
	// any write surface, not just the disabled checkboxes (mirrors the possession
	// remarkable-trait cap in selectSubChoice). Decreases are never clamped, so a
	// grandfathered over-budget mark can always be cleared.
	async setCountMark(moveName, optionSlug, newCount) {
		const allMarks = this._moveResources.getMarks();
		const current  = _markEntries(allMarks[moveName]?.[optionSlug]).length;
		// Clamp an INCREASE to the move's repeat-scaling pick budget (if any); a decrease
		// is left as-is (budget null below), so a grandfathered over-budget mark clears.
		let count = newCount;
		const budget = newCount > current ? await this._moveSelectionBudget(moveName) : null;
		if (budget) {
			const others    = _sumMarkPicks(allMarks[moveName] ?? {}, budget.markOptions, optionSlug);
			const remaining = Math.max(0, budget.max - others);      // picks still free across the move's options
			count = Math.min(newCount, Math.max(current, remaining)); // never below what's already checked
		}
		const entries = _markEntries(allMarks[moveName]?.[optionSlug]);
		while (entries.length < count) entries.push({ stat: "", level: this._characterLevel });
		entries.length = Math.max(0, count);
		await this._actor.update(this._moveResources.markUpdate(moveName, optionSlug, entries));
	}

	// Repeat-scaling pick budget for a move's markOptions, or null when it declares
	// none (uncapped). The definition is read from the compiled pack (fresh
	// markBudget/markOptions, regardless of when the owned copy was created — matching
	// the render path); `ownedCount` is how many copies the actor owns.
	async _moveSelectionBudget(moveName) {
		const owned = this._actor.items.filter(i => i.type === "move" && i.name === moveName);
		if (!owned.length) return null;
		const pbName = owned[0].system?.playbook ?? null;
		const defs   = pbName ? await this._moveRepo.getPlaybookMoves(pbName) : [];
		const def    = defs.find(d => d.name === moveName) ?? null;
		const markBudget  = def?.markBudget  ?? owned[0].system?.markBudget  ?? null;
		const markOptions = def?.markOptions ?? owned[0].system?.markOptions ?? [];
		const max = moveMarkBudget(markBudget, owned.length);
		return max == null ? null : { max, markOptions };
	}

	// Edit-mode override of the level recorded for a given mark slot.
	async setMarkLevel(moveName, optionSlug, index, level) {
		const entries = _markEntries(this._moveResources.getMarks()[moveName]?.[optionSlug]);
		if (!entries[index]) return;
		entries[index] = { ...entries[index], level: Number.isFinite(level) && level > 0 ? level : null };
		await this._actor.update(this._moveResources.markUpdate(moveName, optionSlug, entries));
	}

	async updateName(name) {
		const previousName = this._actor.name ?? "";
		const prototypeTokenName = this._actor.prototypeToken?.name;
		const updates = { name };
		if (!prototypeTokenName || prototypeTokenName === previousName) {
			updates["prototypeToken.name"] = name;
		}
		await this._actor.update(updates);
	}

	async playbook() {
		const slug = this._actor.system?.playbook?.slug;
		if (!slug) return null;
		return this._playbookRepo.findBySlug(slug);
	}

	// The expedition moves shown to players on the character sheet: the full
	// compendium list minus the steading-facing ones (see NON_PLAYER_EXPEDITION_MOVES).
	// Used by both the sidebar catalog and the auto-embed so the two never drift.
	async _playerExpeditionMoves() {
		const entries = await this._moveRepo.getExpeditionMoves();
		return entries.filter(e => !NON_PLAYER_EXPEDITION_MOVES.has(e.name));
	}

	/**
	 * @param {object} [view] Who is looking. Only `viewerIsGM` is read, and only by the gear
	 *        section: a hidden artifact's tags are concealed from everyone else (Book I p.430),
	 *        and concealing them HERE keeps them out of the rendered DOM entirely. This class is
	 *        Foundry-free by design, so the viewer has to be handed in — the sheet supplies it.
	 *        Omitting it conceals, which is the safe way round for a caller that forgot.
	 */
	async buildSnapshot(view = {}) {
		const actor = this._actor;
		const actorLevel = actor.system?.attributes?.level?.value ?? 1;
		const playbookData = await this.playbook();
		const ownedAllByName = this._buildOwnedMovesMap();
		const moves    = await this._buildMovesSection(playbookData, ownedAllByName, actorLevel);
		const inventory = await this._buildInventorySection(playbookData, ownedAllByName, actorLevel, view);
		const allOutfitItems = await this._inventoryRepo.getAll();
		const postDeath = await this._postDeath.buildSnapshot();
		const pdiLabel  = postDeath.activeInsert?.name ?? null;
		const moveBonuses = await this._ownedMoveBonuses(playbookData, ownedAllByName);
		// Armor counts standard items plus any special items the character has added —
		// never an unadded special item whose checked flag happens to linger. A special
		// item the character holds via a same-slug special possession (see
		// _selectedPossessionSlugs) counts too, so a future worn-armor possession is
		// included alongside the picker-added ones.
		const addedSet = new Set(this._inventory.addedSpecial);
		const possessionSpecialSet = this._selectedPossessionSlugs(playbookData);
		const commonSpecialSet = this._earnedCommonSpecialSlugs(this.getSteadingActor(), allOutfitItems);
		const armorItems = allOutfitItems.filter(i =>
			!i.special || addedSet.has(i.slug) || possessionSpecialSet.has(i.slug) || commonSpecialSet.has(i.slug));
		// Possession-granted worn gear (the Tannery's boiled leather cuirass) also
		// counts when checked. Custom items key their checked state by item id, so the
		// armor calc sees them as `{ slug: id, armor }` alongside the outfit items.
		const customArmorItems = this._actor.items
			.filter(i => i.type === "move" && i.system?.moveType === "inventory-custom" && i.system?.armor)
			.map(i => ({ slug: i._id, armor: i.system.armor }));
		// The worn-armor base (leather/mail/etc., excluding shields and move bonuses) gates
		// moves that require being unarmored (Uncanny Reflexes); 0 means unarmored. Same base
		// selection as calculateArmor — CharacterInventory owns the rule. Computed once and
		// handed to calculateArmor so the base filter doesn't run twice per render.
		const allArmorItems = [...armorItems, ...customArmorItems];
		const wornArmorBase = this._inventory.wornArmorBase(allArmorItems);
		const armor = this._inventory.calculateArmor(allArmorItems, wornArmorBase) + moveBonuses.armor;
		const arcanaLore = (playbookData?.lore ?? []).some(e => e.arcanaImage || (e.options ?? []).some(o => o.arcanaRole))
			? await this._arcana.buildLoreDisplay()
			: null;
		return new CharacterSnapshotBuilder()
			.withName(actor.name)
			.withPlaybook(playbookData ? _buildPlaybookSection(playbookData, this._background, this._instinct, this._appearance, this._origin, this._lore, actor.name, arcanaLore, (!!this._actor.getFlag(STONETOP_SCOPE, WBH_HERO_FLAG) || ownsAsteriskMove(this._actor)), actorLevel) : null)
			.withDebilities(_buildDebilitiesSection(actor))
			.withWounds(_buildWoundsSection(actor))
			.withStats(_buildStatsSection(actor))
			// A Thrall's Marks eat into their max HP ("Reduce your max HP by 2"), and they collect
			// more as Dark Succor keeps saving them — so it's derived from the marked options
			// every render, not written once.
			.withVitals(_buildVitalsSection(actor, playbookData, armor, moveBonuses, wornArmorBase, insertHpPenalty(postDeath.activeInsert?.lore)))
			.withMoves(moves)
			.withMovelist(_buildMovelist(moves, inventory.other, pdiLabel, actorLevel, inventory.loveLetters, playbookData?.name ?? null))
			.withInventory(inventory)
			.withArcana(await this._arcana.buildSnapshot(actor.system.stats ?? {}, this._inventory.checked, this._inventory.resources))
			.withPostDeathInsert(postDeath)
			.withRollMode(normalizeRollMode(resolvedFlags(actor).rollMode))
			.withCrewBonuses(_buildCrewStats(playbookData?.crew, moveBonuses))
			.withCompanionBonuses(_buildCompanionBonuses(moveBonuses, ownedAllByName))
			.withViewerIsGM(!!view.viewerIsGM)
			.build();
	}

	// Sum the max-HP and armor bonuses granted by owned playbook moves (e.g. the
	// Heavy's Carved Out of Wood / Cut from Granite). Read from the move definitions
	// so it works regardless of when the owned copy was added.
	async _ownedMoveBonuses(playbookData, ownedAllByName) {
		const totals = { hp: 0, armor: 0, crewHp: 0, damageDie: null, crewDamageSteps: 0, crewDamageCap: "d10", crewRollSteps: 0, crewTags: 0, companionHp: 0, companionArmor: 0 };
		// Player-authored custom moves aren't in the pack, so the name-matched playbook
		// loop below never sees them — read their hp/armor straight off the embedded item.
		// Scoped to _isCustomMove (the stonetop-pwd.custom flag) so a foreign cross-playbook
		// move that happens to be stored as moveType "other" doesn't get its bonus counted
		// here. (loadBonus/shieldLoadReduction are summed across all owned moves elsewhere.)
		for (const i of this._actor.items) {
			if (!_isCustomMove(i) || !_isMoveLearned(i)) continue;
			totals.hp    += Number(i.system?.hpBonus)    || 0;
			totals.armor += Number(i.system?.armorBonus) || 0;
		}
		if (!playbookData) return totals;
		const defs  = await this._moveRepo.getPlaybookMoves(playbookData.name);
		const marks = this._moveResources.getMarks();
		for (const m of defs) {
			// Require a genuine (non-custom) owned move of this name, so a player-authored
			// custom move that merely reuses a playbook move's name can't pull in the def's
			// hp/armor/marks (its own bonus is already counted in the loop above).
			// `ownedAllByName` is a Map(name → owned items[]) in production; some tests pass a
			// Set(name), which has `.has` but no `.get` — fall back to plain membership there.
			const ownedItems = ownedAllByName.get?.(m.name);
			if (ownedItems ? !ownedItems.some(i => !_isCustomMove(i)) : !ownedAllByName.has(m.name)) continue;
			totals.hp    += m.hpBonus    || 0;
			totals.armor += m.armorBonus || 0;
			// Per-option marks (e.g. Potential for Greatness): apply each checked box.
			const moveMarks = marks[m.name] ?? {};
			for (const opt of (m.markOptions ?? [])) {
				// Stat-choice marks (e.g. Potential for Greatness) store an array of
				// chosen stats and are applied directly to the stored stats on change,
				// not derived here — multiplying by the array would yield NaN.
				if (opt.choice === "stat") continue;
				const count = _markEntries(moveMarks[opt.slug]).length;
				if (!count) continue;
				totals.hp     += (opt.hp     || 0) * count;
				totals.armor  += (opt.armor  || 0) * count;
				totals.crewHp += (opt.crewHp || 0) * count;
				if (opt.damageDie) totals.damageDie = maxDie(totals.damageDie, opt.damageDie);
				totals.crewDamageSteps += (opt.crewDamageStep || 0) * count;
				if (opt.crewDamageCap) totals.crewDamageCap = opt.crewDamageCap;
				totals.crewRollSteps += (opt.crewRoll || 0) * count;
				// Veteran Crew's "Select 2 new tags" raises how many tags the player may
				// pick for the Crew (the followers-tab tag picker reads this as tagBonus).
				totals.crewTags += (opt.crewTags || 0) * count;
				// Beast of Legend's "+4 HP and +1 armor" buffs the Animal Companion (the
				// followers-tab companion card reads these as companionBonuses).
				totals.companionHp    += (opt.companionHp    || 0) * count;
				totals.companionArmor += (opt.companionArmor || 0) * count;
			}
		}
		return totals;
	}

	async _buildMovesSection(playbookData, ownedAllByName, actorLevel) {
		const categories = [];

		if (playbookData) {
			const background = this._selectedBackground(playbookData);
			const bgMoveNames = this._backgroundMoveNames(background);
			const bgSlugs = new Set([...bgMoveNames].map(slugify));
			const entries = await this._moveRepo.getPlaybookMoves(playbookData.name);
			if (entries.length > 0) {
				const sorted = this.sortPlaybookMoves(
					this.buildMovelistContext(entries, ownedAllByName, bgMoveNames, actorLevel, playbookData.name)
				);
				const moveResourcesMap = this._moveResources.getMoveResources();
				const moveMarksMap     = this._moveResources.getMarks();
				const moveBackgroundAnswers = resolvedFlags(this._actor).moves?.backgroundAnswers ?? {};
				const improvedStatChoices   = resolvedFlags(this._actor).improvedStatChoices ?? {};
				const actorStats            = _statValueMap(this._actor.system?.stats);
				const source = { type: "playbook", slug: playbookData.slug };
				categories.push(new MoveCategorySnapshotBuilder()
					.withKey("playbook")
					.withTitle(`${playbookData.name} Moves`)
					.withNote(playbookData.startingMovesNote ?? null)
					.withMoves(_sortOwnedFirst(sorted.map(m => _buildMoveEntry(m, source, moveResourcesMap, bgSlugs, moveBackgroundAnswers, improvedStatChoices, moveMarksMap, actorStats))))
					.build()
				);
			}
		}

		// "Learned Moves": moves gained from OTHER playbooks via a cross-playbook pick
		// (Versatile/Worldly/…). They keep their origin playbook in system.playbook (so they
		// don't surface under the actor's own playbook category) and carry a `grantedBy` item
		// flag; group them here, labeled with the move that granted them + their origin.
		//
		// This group is also the CATCH-ALL for any `moveType: "playbook"` item the playbook
		// category above didn't show — a foreign move dropped straight onto the sheet from
		// the compendium (which carries no `grantedBy` flag), or an owned move whose name no
		// longer matches anything in its playbook's pack. Without it such an item renders in
		// NO category at all: silently invisible on the sheet, yet owned — so it also
		// vanishes from the cross-playbook picker, which skips names the actor already owns.
		// Nothing on the actor should be un-seeable; better a card with a plain origin label.
		const shownPlaybookIds = new Set(
			(categories.find(c => c.key === "playbook")?.moves ?? []).flatMap(m => m.ownedIds ?? []));
		const learnedItems = this._actor.items.filter(i =>
			i.type === "move"
			&& (i.flags?.[STONETOP_SCOPE]?.grantedBy || i.system?.moveType === "playbook")
			&& !shownPlaybookIds.has(i._id));
		if (learnedItems.length > 0) {
			const learnedResourcesMap = this._moveResources.getMoveResources();
			const learnedMarksMap     = this._moveResources.getMarks();
			categories.push(new MoveCategorySnapshotBuilder()
				.withKey("learned")
				.withTitle("Learned Moves")
				.withNote("Moves you've gained from outside your own playbook's list.")
				.withMoves(learnedItems.map(i => {
					const grantedBy   = i.flags?.[STONETOP_SCOPE]?.grantedBy ?? {};
					const origin      = i.system?.playbook ?? null;
					// A cross-playbook grant says who granted it; a move added by hand has no
					// granter to name, so it wears its origin playbook alone rather than the
					// old "Granted by —" placeholder, which read like a bug of its own.
					const sourceLabel = grantedBy.move
						? `Granted by ${grantedBy.move}${origin ? ` · ${origin}` : ""}`
						: (origin ?? "Added directly");
					// Full card fidelity: resource track + markOptions, keyed by move NAME (the
					// same store playbook moves use), so e.g. a learned ammo/Marks track works.
					const resourceDef = i.system?.resource ?? null;
					const resource = resourceDef?.max ? new ResourceBuilder()
						.withCurrent(learnedResourcesMap[i.name] ?? 0)
						.withMax(resourceDef.max)
						.withTitle(resourceDef.title ?? null)
						.withLabels(resourceDef.labels ?? [])
						.build() : null;
					const { options: markOptions, budget: markBudget } = _buildMarkOptions(
						{ markOptions: i.system?.markOptions, markBudget: i.system?.markBudget, ownedIds: [i._id], owned: true },
						learnedMarksMap[i.name] ?? {});
					return new MoveSnapshotBuilder()
						.withId(i._id).withCompendiumId(i._id).withOwnedId(i._id)
						.withName(i.name)
						.withDescription(i.system?.description ?? "")
						.withRollType(i.system?.rollType ?? null)
						.withRollLabel(_rollLabelForMove(i.name, i.system?.rollType, i.system))
						.withIsStarting(false)
						.withSource({ type: "learned" })
						.withSourceLabel(sourceLabel)
						.withOwned(true).withOwnedIds([i._id])
						.withLocked(false).withRequirement(null).withRequiresLabel(null)
						.withResource(resource)
						.withMarkOptions(markOptions).withMarkBudget(markBudget)
						.withMaxLoad(i.system?.maxLoad)
						.withRequiresUnarmored(i.system?.requiresUnarmored)
						.withRepeat(null).withRepeatable(false)
						.build();
				}))
				.build()
			);
		}

		const basicEntries = (await this._moveRepo.getBasicMoves()).sort((a, b) => {
			if (a.name === "Aid") return -1;
			if (b.name === "Aid") return 1;
			return a.name.localeCompare(b.name);
		});
		const basicCategory = _buildCompendiumMoveCategory(basicEntries, { key: "basic", title: "Basic Moves" }, ownedAllByName);
		if (basicCategory) {
			const defend = basicCategory.moves.find(m => m.name === _DEFEND_MOVE_NAME);
			if (defend) defend.readiness = this.defendReadinessContext();
			categories.push(basicCategory);
		}

		const expeditionEntries = (await this._playerExpeditionMoves()).sort((a, b) => a.name.localeCompare(b.name));
		const expeditionCategory = _buildCompendiumMoveCategory(expeditionEntries, { key: "expedition", title: "Expedition Moves" }, ownedAllByName);
		if (expeditionCategory) categories.push(expeditionCategory);

		for (const moveType of OTHER_MOVE_TYPES) {
			const items = this._actor.items.filter(i => i.type === "move" && i.system?.moveType === moveType);
			if (items.length > 0) {
				categories.push(new MoveCategorySnapshotBuilder()
					.withKey(moveType)
					.withTitle(capitalizeFirst(moveType) + " Moves")
					.withNote(null)
					.withMoves(items.map(i => _buildOwnedItemMoveSnapshot(i, { sourceType: moveType, isStarting: false })))
					.build()
				);
			}
		}

		const postDeathItems = this._actor.items.filter(i => i.type === "move" && i.system?.moveType === "post-death");
		if (postDeathItems.length > 0) {
			categories.push(new MoveCategorySnapshotBuilder()
				.withKey("post-death")
				.withTitle("Post-Death Moves")
				.withNote(null)
				.withMoves(postDeathItems.map(i => _buildOwnedItemMoveSnapshot(i, { sourceType: "post-death", isStarting: true })))
				.build()
			);
		}

		return categories;
	}

	// Slugs of every special possession the character holds (preselected free gear +
	// player-selected picks). Used to surface a special ("handout") inventory item that
	// shares a possession's slug — the Ranger's composite bow — in the Items column with
	// its ◇ load diamond and ○ ammo track, since such gear is never added through the
	// "Add Special Item" picker. The `i.special` guard at each use site does the actual
	// intersection, so returning the full possession-slug set here is fine. Derived at
	// render, so it covers already-created characters and needs no stored flag/migration.
	_selectedPossessionSlugs(playbookData) {
		return new Set([
			...(playbookData?.specialPossessions?.preselected ?? []),
			...this._possessions.selected,
		]);
	}

	async _buildInventorySection(playbookData, ownedAllByName, actorLevel, view = {}) {
		const viewerIsGM     = !!view.viewerIsGM;
		const checked        = this._inventory.checked;
		const resources      = this._inventory.resources;
		const possessionUses = this._possessions.uses;
		const rPool          = this._inventory.regularPool;
		const sPool          = this._inventory.smallPool;
		const allItems       = await this._inventoryRepo.getAll();
		const steadingActor  = this.getSteadingActor();
		const smallItemLimit = this.getSmallItemLimit(steadingActor);
		const steadingName   = steadingActor?.name ?? null;
		const prosperity     = smallItemLimit !== null ? smallItemLimit - 4 : null;
		const commonSpecialSet = this._earnedCommonSpecialSlugs(steadingActor, allItems);
		// A move's `loadBonus` raises every load cap (the Ranger's Pack Horse → +1).
		// The boosted limits flow into the regular ◇ pool here and into the Outfit
		// dialog via the snapshot; the granting moves' names ride along so the boosted
		// help text can name whichever move did it rather than assuming the horse.
		const bonus          = _ownedLoadBonus(this._actor);
		const loadBonus      = bonus.total;
		const loadBonusMoves = loadBonus > 0 ? bonus.names : [];
		const loadLimits     = loadLimitsFor(loadBonus);
		// The Armored move drops a carried shield to ◆ (1 ◇) instead of ◆◆; floored at 1.
		const shieldLoadReduction = _ownedShieldLoadReduction(this._actor);

		const mapItem = (outfitItem) => {
			const res    = outfitItem.resource;
			const isProsperityResource = outfitItem.prosperityResource
				|| _PROSPERITY_RESOURCE_SLUGS.has(outfitItem.slug);
			const resMax = (isProsperityResource && smallItemLimit !== null)
				? smallItemLimit
				: res?.max;
			// Armored reduces a carried shield's ◇ cost (min 1), so it reads ◆ instead of ◆◆.
			const weight = (outfitItem.slug === _SHIELD_SLUG && shieldLoadReduction > 0)
				? Math.max(1, outfitItem.weight - shieldLoadReduction)
				: outfitItem.weight;
			return new InventoryItemSnapshotBuilder()
				.withSlug(outfitItem.slug)
				.withName(outfitItem.name)
				.withNote(_transformPiercingNote(outfitItem.note, prosperity))
				.withWeight(weight)
				.withChecked(checked[outfitItem.slug] ?? false)
				.withResource(res ? new ResourceBuilder()
					.withCurrent(Math.min(resources[outfitItem.slug] ?? 0, resMax ?? 0))
					.withMax(resMax)
					.withTitle(res.title ?? null)
					.withLabels(res.labels ?? [])
					.build() : null)
				.withResourceFirst(outfitItem.resourceFirst ?? false)
				.withIsCustom(false)
				.withOwnedId(null)
				.withTwoCol(outfitItem.twoCol)
				.withBreakBefore(outfitItem.breakBefore)
				.build();
		};

		const customItems = this._actor.items.filter(i =>
			i.type === "move" && i.system?.moveType === "inventory-custom"
		);
		const mapCustomItem = (item, grant = null, possessionSlug = null) => {
			const res = item.system?.resource ?? grant?.resource ?? null;
			const legacyUsesSlug = grant?.legacyUsesFromPossession ? possessionSlug : null;
			const currentUses = resources[item._id] ?? (legacyUsesSlug ? possessionUses[legacyUsesSlug] : 0);
			const note = item.system?.sourcePossession
				? null
				: (item.system?.sourceLabel
					? `from ${item.system.sourceLabel}`
					// A write-in's "x piercing" tag scales with the steading's Prosperity, same
					// as the shipped catalog gear above (line ~642).
					: _transformPiercingNote(item.system?.note ?? null, prosperity));
			// Identifying artifacts, Book I pp.430-431: an artifact the GM has hidden shows only
			// what's "obvious at a glance" until a PC works it out. The tags/Value parenthetical
			// and the ○ uses track are withheld here — before the snapshot, so they never reach
			// the template — while the ◇ load below is deliberately NOT, since the book has the
			// PCs accounting for an artifact's load the moment they pick it up.
			const artifact = concealArtifactFields({
				state:    item.system?.identifyState,
				note,
				resource: res,
				hint:     item.system?.artifactHint,
				lore:     item.system?.artifactLore,
				lead:     item.system?.artifactLead,
			}, { viewerIsGM });
			const shownRes = artifact.resource;
			return new InventoryItemSnapshotBuilder()
			.withSlug(item._id)
			.withName(grant?.name ?? item.name)
			// Plain write-ins carry no source note. Possession gear now renders inside its
			// possession's card (grouped under the possession label), so it needs no
			// "from <possession>" note either.
			.withNote(artifact.note)
			.withWeight(item.system.weight ?? 1)
			.withChecked(checked[item._id] ?? false)
			.withArtifact(artifact)
			.withResource(shownRes ? new ResourceBuilder()
				.withCurrent(Math.min(currentUses ?? 0, shownRes.max ?? 0))
				.withMax(shownRes.max)
				.withTitle(shownRes.title ?? null)
				.withLabels(shownRes.labels ?? [])
				.build() : null)
			// Trailing text the book prints after the ○ track ("uses, grants advantage to
			// Persuade"), so the whisky reads as one phrase. Only grants carry it; write-ins
			// pass no grant, so it stays null.
			.withResourceSuffix(grant?.resourceSuffix ?? null)
			.withIsCustom(true)
			.withOwnedId(item._id)
			.withTwoCol(false)
			.withBreakBefore(false)
			.build();
		};

		// Plain write-ins (Add Item / Add Small Item) stay in the Items / Small Items
		// columns. Items bundled by a special possession are pulled out and rendered inside
		// that possession's own card instead (see _buildPossessionsSnapshot), grouped ◇ gear
		// then small — so multiple possessions' same-named gear (Carpenter's tools + Distillery
		// both grant firkins) reads under its own heading rather than as a column duplicate.
		// They stay real inventory items, so marking one still feeds load / the small allowance.
		// Only count gear whose possession is actually active (selected or preselected). A tagged
		// item left behind by a deselect that failed to delete it would otherwise add invisible
		// load / eat the small allowance while its possession card is unchecked and shows nothing.
		const activePossessionSlugs = new Set([
			...this._possessions.selected,
			...(playbookData?.specialPossessions?.preselected ?? []),
		]);
		const activePossessionOptions = (playbookData?.specialPossessions?.options ?? [])
			.filter(opt => activePossessionSlugs.has(opt.slug));
		// A TAGGED item names its own possession, so it is matched on slug + name alone — the tag
		// already answers the question the column and the collision guard below exist to answer.
		const grantByPossessionAndKey = new Map();
		const grantKeyFor = (slug, key) => `${slug}:${key}`;
		for (const opt of activePossessionOptions) {
			for (const grant of (opt.grantsItems ?? [])) {
				if (!grant?.name) continue;
				for (const name of [...new Set([grant.name, grant.sourceKey, ...(grant.aliases ?? [])].filter(Boolean))]) {
					grantByPossessionAndKey.set(grantKeyFor(opt.slug, name), grant);
				}
			}
		}
		// UNTAGGED legacy gear is claimed by column + name, and only where exactly one grant
		// answers to that key — the shared rule the select/deselect sync adopts and disowns by
		// (possession-grants.js#grantSourceMap). Shared rather than restated, because a sheet that
		// renders an item inside a possession's card while the teardown declines to claim it — or
		// the reverse — is how a deselect comes to delete a player's hand-written gear.
		const inferredGrantSources = grantSourceMap(activePossessionOptions);
		const grantForTaggedItem = item => {
			const slug = item.system?.sourcePossession;
			if (!slug) return null;
			return grantByPossessionAndKey.get(grantKeyFor(slug, item.system?.sourceKey ?? item.name))
				?? grantByPossessionAndKey.get(grantKeyFor(slug, item.name))
				?? null;
		};
		const inferredGrantFor = item => inferredGrantSources.get(itemGrantKey(item)) ?? null;
		// Which possessions will actually draw a card below. _buildPossessionsSnapshot walks
		// `options` and reads grantedByPossession by slug, so gear tagged to a slug that isn't
		// there has no card to live in — which covers a possession since deselected, a slug
		// left behind by a playbook change, and every slug at all on a character whose
		// playbook resolved to nothing.
		const cardBearingSlugs = new Set(
			(playbookData?.specialPossessions?.options ?? [])
				.map(opt => opt.slug)
				.filter(slug => activePossessionSlugs.has(slug)));
		// Claim for the possession cards FIRST, then let everything else fall through. These
		// two have to be a partition of customItems: written as two independent predicates they
		// left a gap between them — an item tagged to a possession that wasn't active satisfied
		// neither, so it rendered in no section at all while still sitting on the actor,
		// costing no load and no small-item allowance. Deriving the write-ins as "whatever the
		// cards didn't take" makes that unrepresentable rather than merely fixed.
		const possessionItems = customItems.filter(i => {
			const slug = i.system?.sourcePossession;
			return slug ? cardBearingSlugs.has(slug) : !!inferredGrantFor(i);
		});
		const claimedByPossession = new Set(possessionItems);
		// Book II treasures dragged in from a journal are write-ins too, but they get their
		// own "Treasures" heading in each column rather than sitting among the hand-written
		// items — so subtract them from the catch-all here, or they'd render in both places.
		const isWriteIn       = i => !claimedByPossession.has(i);
		const writeInItems    = customItems.filter(i => isWriteIn(i) && !i.system?.isTreasure);
		const treasureItems   = customItems.filter(i => isWriteIn(i) && !!i.system?.isTreasure);
		const grantedByPossession = new Map();
		for (const i of possessionItems) {
			const inferred = inferredGrantFor(i);
			const slug = i.system.sourcePossession ?? inferred?.slug;
			const grant = grantForTaggedItem(i) ?? inferred?.grant ?? null;
			if (!grantedByPossession.has(slug)) grantedByPossession.set(slug, { regular: [], small: [] });
			const bucket = grantedByPossession.get(slug);
			(i.system?.inventoryColumn === "regular" ? bucket.regular : bucket.small).push(mapCustomItem(i, grant, slug));
		}
		// Flattened views for the derived load (◇) and small-item accounting below, so
		// possession gear still counts toward encumbrance / the 4+Prosperity allowance
		// exactly as it did when it lived in the columns.
		const grantedRegularAll = [...grantedByPossession.values()].flatMap(b => b.regular);
		const grantedSmallAll   = [...grantedByPossession.values()].flatMap(b => b.small);

		// Special (handout) items are kept off the default checklist; they appear only
		// once the player adds them via the "Add Special Item" picker — OR when a
		// preselected/selected special possession shares the item's slug (the Ranger's
		// composite bow), in which case the gear belongs in the Items column with its ◇
		// load diamond + ○ ammo track. Possession-derived ones are locked starting gear
		// (the possession itself is non-removable), so they render via plain mapItem —
		// no isAddedSpecial flag, hence no "remove special" ✕. A slug added explicitly
		// through the picker wins (keeps its removable ✕) and is excluded here.
		const addedSpecialSet      = new Set(this._inventory.addedSpecial);
		const possessionSpecialSet = this._selectedPossessionSlugs(playbookData);
		const mapAddedSpecial      = i => { const s = mapItem(i); s.isAddedSpecial = true; return s; };
		const addedSpecial         = allItems.filter(i => i.special && addedSpecialSet.has(i.slug));
		const possessionSpecial    = allItems.filter(i =>
			i.special && possessionSpecialSet.has(i.slug) && !addedSpecialSet.has(i.slug));
		const commonSpecial        = allItems.filter(i =>
			i.special && commonSpecialSet.has(i.slug) && !addedSpecialSet.has(i.slug) && !possessionSpecialSet.has(i.slug));
		const standardItems        = allItems.filter(i => !i.special);

		const allSmall = standardItems.filter(i => i.inventoryColumn === "small");
		const flatRegular = [
			...standardItems.filter(i => i.inventoryColumn === "regular").map(mapItem),
			...addedSpecial.filter(i => i.inventoryColumn === "regular").map(mapAddedSpecial),
			...possessionSpecial.filter(i => i.inventoryColumn === "regular").map(mapItem),
			...commonSpecial.filter(i => i.inventoryColumn === "regular").map(mapItem),
			...writeInItems.filter(i => i.system.inventoryColumn === "regular").map(mapCustomItem),
		];

		// Every arcanum a character owns renders in the Arcana section, split across the
		// columns by WEIGHT rather than by its authored `inventoryColumn`. That field only
		// looks like a placement decision: "arcana" is never authored, it's just the
		// fallback for "the author didn't say" (CharacterArcana.weightedInventoryItems),
		// which today coincides exactly with weight 0. Reading the weight states the rule
		// directly and keeps a homebrew card that pairs a weight with the default column
		// out of the weightless half.
		//   ◇ ones  → left, markable, counted toward load like any carried gear.
		//   ◇0 ones → right, alongside the small items, but INERT: they were never
		//             markable (`times 0` renders no checkbox), so they cost nothing and
		//             must not start eating the 4+Prosperity small allowance.
		const arcanaAll     = await this._arcana.weightedInventoryItems();
		const arcanaRegular = arcanaAll.filter(i => (i.weight ?? 0) > 0).map(mapItem);
		const arcanaSmall   = arcanaAll.filter(i => (i.weight ?? 0) <= 0).map(mapItem);

		// Treasures render under their own heading in whichever column their weight puts
		// them — ◇ ones on the left, pocket-sized ones on the right — so the group reads as
		// one thing while each item stays in its weight-correct column. Kept out of
		// flatRegular / smallItems above; folded back into the load and small-allowance
		// accounting below, exactly like possession gear.
		const treasureRegular = treasureItems
			.filter(i => i.system.inventoryColumn === "regular").map(i => mapCustomItem(i));
		const treasureSmall   = treasureItems
			.filter(i => i.system.inventoryColumn !== "regular").map(i => mapCustomItem(i));

		// Gear-bearing `choices` possessions (the Heavy's / Marshal's Weapons of War): the
		// weapons the player chose render as ◇/□ rows inside the card, and a *carried* one's ◇
		// counts toward load exactly like a column item or a grantsItems bundle. Built here so
		// the possessions snapshot (rendering) and the load/small accounting below share one source.
		const choiceGearByPossession = this._buildChoiceGearByPossession(playbookData, prosperity);
		const choiceGearRegularAll   = [...choiceGearByPossession.values()].flatMap(b => b.regular);
		const choiceGearSmallAll     = [...choiceGearByPossession.values()].flatMap(b => b.small);

		let possessions = null;
		if (playbookData?.specialPossessions) {
			const maxUsesMap = this.computePossessionMaxUses(playbookData.specialPossessions, ownedAllByName, actorLevel);
			possessions = this._buildPossessionsSnapshot(playbookData.specialPossessions, maxUsesMap, prosperity, grantedByPossession, choiceGearByPossession);
		}

		const moveResourceState = this._moveResources.getMoveResources();
		const otherItems = this._actor.items
			.filter(i => i.type === "move" && i.system?.moveType === "other");

		// Love letters are single-use, GM-authored moves (Book I p.568). They share the
		// "other" moveType but render in their own top-of-Moves section and get consumed on
		// resolve — so split them off here in one pass and keep them off the "Other Moves" list.
		const loveLetterItems = [];
		const otherMoveItems = [];
		for (const i of otherItems) (isLoveLetter(i) ? loveLetterItems : otherMoveItems).push(i);

		const loveLetters = loveLetterItems
			.map(i => new OtherItemSnapshotBuilder()
				.withId(i._id)
				.withName(i.name)
				.withDescription(i.system?.description ?? null)
				.withMoveResults(i.system?.moveResults ?? null)
				.withMoveType(i.system?.moveType ?? null)
				.withOwnedId(i._id)
				.withRollType(normalizeRollType(i.system?.rollType))
				.withRollLabel(_rollLabelForMove(i.name, i.system?.rollType, i.system))
				.build());

		const other = otherMoveItems
			.map(i => {
				// Custom moves persist their resource track by stable item id, not by name:
				// player-chosen names aren't unique and can be renamed, which would collide
				// two tracks or orphan a saved count. Shipped/foreign "other" moves keep name
				// keying so their already-stored data is unaffected.
				const resourceKey = _isCustomMove(i) ? i._id : i.name;
				// A move dropped here from another playbook keeps its origin in system.playbook
				// (onDropMove only rewrites the moveType). Say so in the corner badge, the same
				// way a playbook move announces "Starting move" — otherwise the Fox's Ambush sits
				// in a Would-Be Hero's Other Moves with nothing to explain where it came from.
				// Compared against the actor's STORED playbook name, which is the same field
				// onDropMove judged "foreign" by — so the badge appears on exactly the moves that
				// were routed here for being foreign, whether or not the playbook doc resolves.
				const origin = i.system?.playbook ?? null;
				const ownPlaybook = this._actor.system?.playbook?.name ?? playbookData?.name ?? null;
				return new OtherItemSnapshotBuilder()
					.withId(i._id)
					.withName(i.name)
					.withDescription(i.system?.description ?? null)
					.withMoveResults(i.system?.moveResults ?? null)
					.withMoveType(i.system?.moveType ?? null)
					.withOwnedId(i._id)
					.withRollType(normalizeRollType(i.system?.rollType))
					.withRollLabel(_rollLabelForMove(i.name, i.system?.rollType, i.system))
					.withSourceLabel(origin && origin !== ownPlaybook ? origin : null)
					.withCustom(_isCustomMove(i))
					.withLearned(_isMoveLearned(i))
					.withResourceKey(resourceKey)
					.withResource(_buildOtherMoveResource(i.system?.resource, moveResourceState[resourceKey]))
					.build();
			})
			// Learned first, then by name — the same shape _sortOwnedFirst gives the basic
			// moves. Raw item order is creation order, which puts an un-learned move above
			// active ones for no reason a reader can see.
			.sort((a, b) => (b.learned - a.learned) || a.name.localeCompare(b.name));

		// Load is derived from the ◇ actually marked — checked item weights plus the
		// undefined regular pool — never stored. Marking loot or editing the pool
		// directly just re-derives it, matching the book's "count what you've marked."
		// Possession ◇ gear (grantedRegularAll) renders inside the possession cards now, not
		// the Items column, but still counts toward load — so fold it in here alongside the
		// column items and arcana. Treasures (treasureRegular) sit under their own heading
		// for the same reason and count the same way: a marked treasure is still carried.
		const allRegularForLoad    = [...flatRegular, ...arcanaRegular, ...grantedRegularAll, ...choiceGearRegularAll, ...treasureRegular];
		const checkedRegularWeight = allRegularForLoad
			.filter(i => i.checked).reduce((sum, i) => sum + (i.weight ?? 0), 0);
		// The undefined pool can hold whatever's left under the heavy cap; the stored
		// count is clamped to that so the reserve never pushes the load past heavy.
		const regularPoolMax     = Math.max(0, loadLimits.heavy - checkedRegularWeight);
		const regularPoolCurrent = Math.min(rPool, regularPoolMax);
		// The ◇ track always shows the full load capacity, so the diamonds never vanish
		// as you mark items: reserve that no longer fits under the cap simply renders as
		// empty ◇ (clicking one warns you're at your limit — see regularPoolCap). Only a
		// Pack Horse / loadBonus move raises the cap (to 10), so an overloaded carry still
		// tops out at heavy rather than sprouting extra ◇.
		const regularPoolSlots   = loadLimits.heavy;
		const totalRegularMarks  = checkedRegularWeight + regularPoolCurrent;
		const derivedLoadLevel   = deriveLoadLevel(totalRegularMarks, loadLimits);

		const load = new LoadSnapshotBuilder()
			.withInstruction(_loc("stonetop.inventory.outfit.heading"))
			.withSelected(derivedLoadLevel)
			.withLoadLevelLight(derivedLoadLevel === "light")
			.withLoadLevelNormal(derivedLoadLevel === "normal")
			.withLoadLevelHeavy(derivedLoadLevel === "heavy" || derivedLoadLevel === "overloaded")
			.withLoadLevelOverloaded(derivedLoadLevel === "overloaded")
			.withTotalMarks(totalRegularMarks)
			.build();

		const addedSmall = addedSpecial.filter(i => i.inventoryColumn === "small");
		const possessionSmall = possessionSpecial.filter(i => i.inventoryColumn === "small");
		const commonSmall = commonSpecial.filter(i => i.inventoryColumn === "small");
		const smallItems = [
			...allSmall.filter(i => !i.smallGrid).map(mapItem),
			...addedSmall.filter(i => !i.smallGrid).map(mapAddedSpecial),
			...possessionSmall.filter(i => !i.smallGrid).map(mapItem),
			...commonSmall.filter(i => !i.smallGrid).map(mapItem),
			...writeInItems.filter(i => i.system.inventoryColumn === "small").map(mapCustomItem),
		];
		const smallGridItems = allSmall.filter(i => i.smallGrid).map(mapItem);

		// Small marks are likewise derived: the undefined □ pool fills the room left
		// under the 4+Prosperity Outfit allotment after checked small items. Possession
		// small gear (grantedSmallAll) and pocket-sized treasures (treasureSmall) live
		// outside the list but still eat the allowance. Weightless arcana (arcanaSmall)
		// deliberately do NOT: they merely sit in this column, and have never cost a
		// player anything — counting them now would silently shrink the allowance for
		// every card owned.
		const checkedSmallCount = [...smallItems, ...smallGridItems, ...grantedSmallAll, ...choiceGearSmallAll, ...treasureSmall].filter(i => i.checked).length;
		const smallPoolMax     = Math.max(0, (smallItemLimit ?? 9) - checkedSmallCount);
		const smallPoolCurrent = Math.min(sPool, smallPoolMax);
		// Like the ◇ track, the □ track always shows the full 4+Prosperity allotment, so
		// boxes never vanish as small items are marked.
		const smallPoolSlots   = smallItemLimit ?? 9;

		const outfit = new OutfitSnapshotBuilder()
			.withLoad(load)
			.withRegularItems(flatRegular)
			.withRegularSegments(_segmentByTwoCol(flatRegular))
			.withRegularPool(new ResourceBuilder().withCurrent(regularPoolCurrent).withMax(regularPoolSlots).withTitle(null).withLabels([]).build())
			.withRegularPoolCap(regularPoolMax)
			.withSmallItems(smallItems)
			.withSmallGridItems(smallGridItems)
			.withSmallPool(new ResourceBuilder().withCurrent(smallPoolCurrent).withMax(smallPoolSlots).withTitle(null).withLabels([]).build())
			.withSmallPoolCap(smallPoolMax)
			.withArcanaRegular(arcanaRegular)
			.withArcanaSmall(arcanaSmall)
			.withTreasureRegular(treasureRegular)
			.withTreasureSmall(treasureSmall)
			.withSmallItemLimit(smallItemLimit)
			.withSteadingName(steadingName)
			.withLoadBonus(loadBonus)
			.withLoadBonusMoves(loadBonusMoves)
			.withLoadLimits(loadLimits)
			.build();

		return new InventorySnapshot(outfit, possessions, other, loveLetters);
	}

	_buildPossessionsSnapshot(specialPossessions, maxUsesMap, prosperity = null, grantedByPossession = new Map(), choiceGearByPossession = new Map()) {
		const { pickNote, pickCount, preselected = [], options } = specialPossessions;
		const selectedSlugs = this._possessions.selected;
		const usesMap = this._possessions.uses;
		const subChoicesMap = this._possessions.subChoices;
		const preselectedSet = new Set(preselected);

		let chosenCount = 0;
		const items = options
			// Grant-only possessions (the Seeker's Initiate-granted Sacred Pouch) aren't
			// pickable here — surface one only once it's actually been granted (selected).
			.filter(opt => !opt.grantOnly || preselectedSet.has(opt.slug) || selectedSlugs.has(opt.slug))
			.map(opt => {
			const isPre = preselectedSet.has(opt.slug);
			const isSelected = isPre || selectedSlugs.has(opt.slug);
			// A granted possession doesn't consume one of the playbook's normal picks.
			if (isSelected && !isPre && !opt.grantOnly) chosenCount++;
			const maxUses = maxUsesMap[opt.slug] ?? opt.resource?.max ?? null;
			const currentUses = isSelected ? (usesMap[opt.slug] ?? 0) : 0;
			const resourceDef = opt.resource ?? null;
			const grantedGear = grantedByPossession.get(opt.slug) ?? { regular: [], small: [] };
			const hasGrantedGear = grantedGear.regular.length || grantedGear.small.length;
			// A gear-bearing `choices` bundle (the Heavy's / Marshal's Weapons of War) renders its
			// *chosen* options as ◇/□ item-rows (built in _buildChoiceGearByPossession) so the
			// diamond can act as the load mark in play. Choosing them stays on the edit-mode
			// checklist below; only the prose summary is suppressed, since the rows say it better.
			const isGearChoice = !!opt.choices?.gear;
			const choiceGear   = isGearChoice ? (choiceGearByPossession.get(opt.slug) ?? null) : null;
			// `choices` bundle (Judge's symbol of authority, Would-Be Hero's personal token): the
			// picked sub-options, shown as an editable checklist on the gear card in edit mode.
			// Each may carry an inline fill-in blank whose written value comes from the choiceTexts
			// store.
			const choiceOpts    = opt.choices?.options ?? [];
			const choicePicked  = subChoicesMap[opt.slug] ?? [];
			const choiceAtLimit = choicePicked.length >= (opt.choices?.pickCount ?? 0);
			const choicesView   = choiceOpts.length ? {
				pickCount: opt.choices.pickCount ?? 0,
				options: choiceOpts.map(c => {
					const isPicked = choicePicked.includes(c.slug);
					const blank    = splitFillBlank(c.label ?? "");
					return {
						slug:       c.slug,
						label:      c.label ?? "",
						checked:    isPicked,
						disabled:   !isPicked && choiceAtLimit,
						hasBlank:   blank.hasBlank,
						fillBefore: blank.before,
						fillAfter:  blank.after,
						fillValue:  this._possessions.getChoiceText(opt.slug, c.slug),
					};
				}),
			} : null;
			const resource = resourceDef ? new ResourceBuilder()
				.withCurrent(currentUses)
				.withMax(maxUses ?? resourceDef.max)
				// Title is rendered separately as the italic `usesLabel` in the
				// possessions block; leave it off the resource so the shared
				// resource-track partial doesn't render a duplicate label.
				.withTitle(null)
				.withLabels(resourceDef.labels ?? [])
				.build() : null;
			return new PossessionItemSnapshotBuilder()
				.withSlug(opt.slug)
				.withLabel(opt.label)
				// "x piercing" weapons (e.g. the Ranger's composite bow) resolve to the
				// steading's Prosperity for display here, just like outfit items — onboarding
				// keeps the literal "x" since it renders the raw playbook description instead.
				.withDescription(hasGrantedGear ? "" : _transformPiercingNote(_stripPossessionUsesAnnotation(opt.description ?? "", resourceDef), prosperity))
				.withSelected(isSelected)
				.withChecked(isSelected)
				// A granted grant-only possession (the Initiate Sacred Pouch) is locked like
				// preselected gear: it can't be re-added from the sheet (it's filtered out of
				// the picker), so don't let it be accidentally unchecked away either.
				.withDisabled(isPre || (isSelected && !!opt.grantOnly))
				.withPreselected(isPre)
				// Preselected possessions (the Blessed's sacred pouch, Marshal's symbol of
				// authority, etc.) are starting *gear*, not moves — show no source label
				// (the disabled checkbox already signals they're locked in).
				.withPreselectedSource(null)
				.withResource(resource)
				// Untitled circle tracks default to a "Uses" label (mirrors the Blessed's
				// "Stock"), so the top-right circles always read with a heading.
				.withUsesLabel(resourceDef ? (resourceDef.title ?? "Uses") : null)
				.withChoices(isSelected ? choicesView : null)
				.withChoiceGroups(null)
				// Read-only prose of the player's flavor/trait picks (the Blessed's
				// sacred pouch), woven under the description on the gear tab. Gear-bearing
				// bundles show their picks as the ◇ rows instead, so no prose summary.
				.withChoiceSummary(isSelected && !isGearChoice ? this._buildPossessionChoiceSummary(opt, subChoicesMap[opt.slug] ?? []) : null)
				// Has editable choiceGroups → gear tab shows an "edit" pencil (in edit mode).
				.withHasChoiceGroups(isSelected && !!opt.choiceGroups?.length)
				// Bundled gear materialized for this possession (Distillery → firkins, whisky,
				// malt…), split ◇ / small, rendered inside the card. Only present when selected.
				.withGrantedRegular(grantedGear.regular)
				.withGrantedSmall(grantedGear.small)
				// Weapons-of-war style gear: the *chosen* weapons as ◇/□ rows, where the
				// diamond is the load mark. Only present when selected + `gear`.
				.withChoiceGear(choiceGear)
				.build();
		});

		// Player-written "something else (discuss with GM)" possessions live in their own
		// flag (they match no listed option), so append them after the list. Each spends a
		// pick like any other choice, and is removed via the × button rather than a checkbox.
		const customItems = this._possessions.custom.map(c => {
			chosenCount++;
			return new PossessionItemSnapshotBuilder()
				.withSlug(c.slug)
				.withLabel(c.label)
				.withDescription("")
				.withSelected(true)
				.withChecked(true)
				.withDisabled(true)
				.withPreselected(false)
				.withPreselectedSource(null)
				.withResource(null)
				.withUsesLabel(null)
				.withChoices(null)
				.withChoiceGroups(null)
				.withChoiceSummary(null)
				.withCustom(true)
				.build();
		});

		const isIncomplete = pickCount > 0 && chosenCount < pickCount;
		return new PossessionsSnapshot(pickCount, pickNote, [...items, ...customItems], isIncomplete);
	}

	// A gear-bearing `choices` possession (the Heavy's / Marshal's Weapons of War) shows the
	// options the player has *already chosen* as ◇/□ item-rows, like a grantsItems bundle.
	// Choosing which weapons you own stays on the edit-mode checklist (`choices`); the ◇ here
	// is purely the load mark — tick it to say you're carrying that weapon right now. So the
	// unchosen options never clutter the card in play. Returns a Map possessionSlug →
	// { regular, small, pickNote }, populated only for a *selected* possession flagged
	// `choices.gear`. A row carries its resource (the crossbow's ○○ ammo); weight and a clean
	// label are split off the authored "◇ Sword, iron (…)" form. Kept in step with the load /
	// small-item accounting below, which folds carried rows in by their weight.
	_buildChoiceGearByPossession(playbookData, prosperity = null) {
		const out = new Map();
		const sp = playbookData?.specialPossessions;
		if (!sp?.options?.length) return out;
		const selected      = this._selectedPossessionSlugs(playbookData);
		const subChoicesMap = this._possessions.subChoices;
		const choiceUsesMap = this._possessions.choiceUses;
		for (const opt of sp.options) {
			if (!opt.choices?.gear || !opt.choices.options?.length) continue;
			if (!selected.has(opt.slug)) continue;
			const picked  = new Set(subChoicesMap[opt.slug] ?? []);
			const regular = [];
			const small   = [];
			for (const c of opt.choices.options) {
				if (!picked.has(c.slug)) continue; // unchosen weapons aren't yours to carry
				const { weight, label: rawLabel } = _parseChoiceGear(c.label);
				// Resolve the "x piercing" marker up front so both render paths — the plain
				// label and the fill-blank split below — read from the same transformed text
				// (a weapon could carry both a blank and a piercing note).
				const label  = _transformPiercingNote(rawLabel, prosperity);
				const resDef = c.resource ?? null;
				// The book prints the ammo statuses inline ("…, ○ low ammo, ○ all out)"), so when
				// the label carries exactly one ○ per circle the track renders *there*, standing in
				// for those glyphs — otherwise the row showed both, the written statuses and a pair
				// of unexplained circles at the end of the line. Anything else (a track with no
				// inline glyphs, or a count that doesn't line up) keeps the trailing track.
				const inline    = resDef ? _splitInlineStatuses(label) : { before: label, statuses: [], after: "" };
				const useInline = !!resDef && inline.statuses.length === (resDef.max ?? 0)
					&& inline.statuses.every(s => s);
				const rowLabel  = useInline ? inline.before : label;
				// An inline fill-in blank (the Would-Be Hero's "A shield, bearing ___'s crest")
				// splits the load-stripped label around a text input whose value is the
				// per-choice write-in — same store the edit-mode checklist uses.
				const blank = splitFillBlank(rowLabel);
				const row = {
					possessionSlug: opt.slug,
					choiceSlug:     c.slug,
					label:          rowLabel,
					// Re-attached after the inline circles: the label's closing paren.
					labelAfter:     useInline ? inline.after : "",
					resourceInline: useInline,
					weight,
					// Carried, not chosen: a weapon you own but left behind reads as an empty ◇.
					checked:        this._possessions.isChoiceCarried(opt.slug, c.slug),
					hasBlank:       blank.hasBlank,
					fillBefore:     blank.before,
					fillAfter:      blank.after,
					fillValue:      this._possessions.getChoiceText(opt.slug, c.slug),
					resource:       resDef ? new ResourceBuilder()
						.withCurrent(Math.min(choiceUsesMap[`${opt.slug}:${c.slug}`] ?? 0, resDef.max ?? 0))
						.withMax(resDef.max)
						.withTitle(resDef.title ?? null)
						// Inline circles name themselves: each takes the status it replaced.
						.withLabels(resDef.labels?.length ? resDef.labels : (useInline ? inline.statuses : []))
						.build() : null,
				};
				(weight > 0 ? regular : small).push(row);
			}
			// `pickNote` ("Choose up to 3 (now or later)") heads the edit-mode checklist, where
			// the choosing happens; in play it'd just be noise over gear you already own.
			// `hasPicked` keeps the whole block off the card until something is chosen.
			out.set(opt.slug, {
				regular, small,
				pickNote:  opt.choices.pickNote ?? null,
				hasPicked: !!(regular.length || small.length),
			});
		}
		return out;
	}

	// Read-only prose summary of a possession's `choiceGroups` picks (the Blessed's
	// sacred pouch: "Your sacred pouch is..." flavor + "What remarkable trait..."),
	// one entry per group heading with the chosen labels joined in book order. The
	// remarkable-trait group is multi-select, so this naturally lists every trait a
	// Blessed has taken via Big Magic. Returns null when nothing in any group is picked.
	_buildPossessionChoiceSummary(opt, pickedSlugs) {
		const pickedSet = new Set(pickedSlugs ?? []);
		if (!pickedSet.size) return null;
		// choiceGroups (the Blessed's sacred pouch): group heading + the picked labels.
		if (opt?.choiceGroups?.length) {
			const summary = [];
			for (const cg of opt.choiceGroups) {
				const labels = [];
				for (const sg of (cg.subgroups ?? [])) {
					for (const o of (sg.options ?? [])) {
						if (pickedSet.has(o.slug)) labels.push(o.label);
					}
				}
				if (labels.length) summary.push({ heading: cg.heading ?? "", selections: labels.join(", ") });
			}
			return summary.length ? summary : null;
		}
		// choices bundle (Judge's symbol, Heavy's weapons, the Would-Be Hero's token): the
		// picked options, with any fill-in blank resolved and the leading ◇ load markers
		// dropped so it reads as plain prose in the read-only summary.
		if (opt?.choices?.options?.length) {
			const labels = opt.choices.options
				.filter(o => pickedSet.has(o.slug))
				.map(o => {
					const fill  = this._possessions.getChoiceText(opt.slug, o.slug);
					const label = fillBlank(o.label, fill);
					return label.replace(/^[◇◆\s]+/, "").trim();
				})
				.filter(Boolean);
			return labels.length ? [{ heading: "", selections: labels.join(", ") }] : null;
		}
		return null;
	}

	async setPostDeathInsert(slug) {
		// Swapping one insert for another leaves the old one's answers behind in their own flag
		// namespaces. Prune them to what the incoming insert can actually hold — before the slug
		// moves, so the pruning is measured against the new insert and not against itself.
		// Removal (slug = null) deliberately prunes nothing: it's an edit-mode undo, and a
		// mis-click shouldn't cost a character every Consequence they've collected.
		const previous = this._postDeath.activeSlug;
		if (slug && slug !== previous) await this._postDeath.pruneToInsert(slug);

		const toRemove = this._actor.items
			.filter(i => i.type === "move" && i.system?.moveType === "post-death")
			.map(i => i._id);
		if (toRemove.length > 0) {
			await this._actor.deleteEmbeddedDocuments("Item", toRemove);
		}
		// One update, not two: taking an insert is also the END of the brush with death that led
		// to it, and as separate writes a reload landing between them left a character wearing a
		// Ghost and still flagged `fate-pending` — every surface then said Death's Door was owed by
		// someone who had already answered it (see effectiveDeathsDoorState, which heals the sheets
		// this already happened to). Only when an insert is TAKEN: removing one is an edit-mode
		// undo and has no brush with death to end.
		//
		// The tab request rides along in the SAME update for the same reason. Removing an insert
		// holds the tab open (it shows the fate picker, which is the whole point of removing one);
		// taking an insert shows the tab on its own merits, so the request is dropped rather than
		// left to outlive the question. See CharacterPostDeath#tabRequested.
		await this._actor.update({
			...this._postDeath.slugUpdateData(slug),
			...(slug ? this._clearDeathsDoorUpdate : {}),
			...(this._postDeath.tabRequestUpdateData(!slug) ?? {}),
		});
		if (slug) {
			const entries = await this._moveRepo.getPostDeathMoves(slug);
			await this._actor.createEmbeddedDocuments("Item", entries.map(m => ({
				name: m.name,
				type: "move",
				system: { moveType: "post-death", rollType: m.rollType ?? "", description: m.description ?? "" },
			})));
		}
	}

	/**
	 * The Post-Death tab on a sheet with no insert: opt-in, so it doesn't open on every living
	 * character in edit mode. Removing an insert opts in; the tab's own foot opts back out.
	 */
	get postDeathTabRequested()             { return this._postDeath.tabRequested; }
	async setPostDeathTabRequested(open)    { await this._postDeath.setTabRequested(open); }

	async setPostDeathInstinct(value)                    { await this._postDeath.instinct.select(value); }
	async setPostDeathLoreCount(loreSlug, optSlug, n)    { await this._postDeath.lore.setCount(loreSlug, optSlug, n); }
	async setPostDeathLoreText(loreSlug, optSlug, value) { await this._postDeath.lore.setText(loreSlug, optSlug, value); }

	async setInventoryItemChecked(slug, isChecked) { await this._inventory.setItemChecked(slug, isChecked); }
	async setInventoryResource(slug, count)         { await this._inventory.setResource(slug, count); }
	async setInventoryRegularPool(count)            { await this._inventory.setRegularPool(count); }
	async setInventorySmallPool(count)              { await this._inventory.setSmallPool(count); }
	async removeSpecialItem(slug)                   { await this._inventory.removeSpecial(slug); }

	/**
	 * The Blessed's Favor, off Rites of the Land's own track.
	 *
	 * A HOLD track: the stored number is Favor currently held, not Favor spent, because a
	 * Blessed who has never overseen the rites holds none (see stock-cost.js, which pays out of
	 * this and explains why the pouch counts the other way). Zero for a character without the
	 * move at all, which is also the honest answer.
	 */
	ritesFavorHeld() {
		return Math.max(0, Number(this._moveResources.getMoveResources()[RITES_OF_THE_LAND]) || 0);
	}

	/** That track's capacity, read off the owned move so a homebrewed one still works. */
	ritesFavorMax() {
		return Number(ownedMove(this._actor, RITES_OF_THE_LAND)?.system?.resource?.max) || 0;
	}

	/** "Hold N Favor" — the move SETS the track rather than adding to it. */
	async setRitesFavor(held) {
		const max = this.ritesFavorMax();
		const value = Math.max(0, Math.min(max, Math.trunc(Number(held) || 0)));
		await this._moveResources.setUses(RITES_OF_THE_LAND, value, { stonetopMove: RITES_OF_THE_LAND });
	}

	getSteadingActor() {
		const storedSteadingId = resolvedFlagProperty(this._actor, "steadingId");
		return (storedSteadingId ? game.actors?.get(storedSteadingId) : null)
			?? getStonetopSteadingActor();
	}

	_earnedCommonSpecialSlugs(steading, allItems) {
		if (!steading) return new Set();
		const steadingFlags = resolvedFlagProperty(steading, "steading") ?? {};
		const weaponsEarned = !!steadingFlags.improvements?.[_WEAPONS_OF_WAR_IMPROVEMENT]?.completed
			|| (steadingFlags.fortifications ?? []).some(f => String(f?.name ?? f) === _WEAPONS_OF_WAR_CATEGORY);
		if (!weaponsEarned) return new Set();
		return new Set(allItems
			.filter(i => i.special && i.specialCategory === _WEAPONS_OF_WAR_CATEGORY)
			.map(i => i.slug));
	}

	getSmallItemLimit(steading = this.getSteadingActor()) {
		const rawProsperity = (steading ? resolvedFlagProperty(steading, "steading.system.attributes.prosperity.value") : null)
			?? steading?.system?.attributes?.prosperity?.value;
		if (rawProsperity == null) return null;
		const prosperity = Number(rawProsperity);
		return isNaN(prosperity) ? null : 4 + prosperity;
	}

	/**
	 * Have What You Need (one-click): marking a specific item on the Inventory tab
	 * draws marks from the undefined pool (its weight, or 1 for a small item). If
	 * the pool can't cover it, the shortfall just adds to your load — that's loot
	 * you picked up in the field (Book I p.87). We remember how much each mark drew
	 * so un-marking returns exactly that (an item defined at Outfit drew nothing, so
	 * un-marking just drops its weight) — toggling can never invent reserve marks.
	 * The pool is also directly editable, so any state is reachable.
	 *
	 * @param {string}  slug
	 * @param {boolean} isChecked  Whether the item is now carried.
	 * @param {object}  opts
	 * @param {boolean} [opts.small]   Small item (□, costs 1) vs regular item (◇, costs its weight).
	 * @param {number}  [opts.weight]  Regular item weight (◇ to move).
	 */
	async toggleCarriedItem(slug, isChecked, { small = false, weight = 1 } = {}) {
		await this._inventory.setItemChecked(slug, isChecked);
		const cost      = small ? 1 : Math.max(0, weight);
		const pool      = small ? this._inventory.smallPool : this._inventory.regularPool;
		const nextDrawn = { ...this._inventory.drawn };
		let next;
		if (isChecked) {
			const spent = Math.min(cost, pool);
			next = pool - spent;
			if (spent > 0) nextDrawn[slug] = spent; else delete nextDrawn[slug];
		} else {
			next = pool + (nextDrawn[slug] ?? 0);
			delete nextDrawn[slug];
		}
		await this._inventory.setDrawn(nextDrawn);
		if (small) await this._inventory.setSmallPool(next);
		else       await this._inventory.setRegularPool(next);
	}

	// Outfit batch-marks the inventory: it writes the checked items and the two
	// "undefined" ◇/□ reserves. Load itself is derived from the marks, so there's
	// nothing else to store. Outfit redefines the whole loadout, so the per-item
	// draw records are cleared — its checked items are defined load, not drawn from
	// the reserve. The pools and item marks stay freely editable afterwards.
	async applyOutfit(checkedMap, regularPool = 0, smallPool = 0) {
		await Promise.all([
			this._inventory.setAllChecked(checkedMap),
			this._inventory.setRegularPool(regularPool),
			this._inventory.setSmallPool(smallPool),
			this._inventory.setDrawn({}),
		]);
	}

	async resetInventorySelections() {
		await this._inventory.resetSelections();
	}

	async addCustomInventoryItem(name, weight) {
		await this._actor.createEmbeddedDocuments("Item", [{
			name,
			type: "move",
			system: { moveType: "inventory-custom", inventoryColumn: "regular", weight: Math.max(1, weight) },
		}]);
	}

	async addCustomSmallItem(name) {
		await this._actor.createEmbeddedDocuments("Item", [{
			name,
			type: "move",
			system: { moveType: "inventory-custom", inventoryColumn: "small" },
		}]);
	}

	/**
	 * Create a fully-specified custom inventory item — the write path behind the
	 * Add-Item dialog. Unlike addCustomInventoryItem/addCustomSmallItem (name +
	 * weight only), this carries the note (tags), a uses/ammo resource track, and
	 * a worn-armor value, matching the shape shipped catalog items can have.
	 *
	 * @param {object}  data
	 * @param {string}  data.name
	 * @param {string} [data.column="regular"]   "regular" | "small"
	 * @param {number} [data.weight=1]           ◇ load (regular column only)
	 * @param {string} [data.note=""]            freeform tags/notes (already <em>-wrapped)
	 * @param {object|null} [data.resource=null] { max, title, labels } uses/ammo track
	 * @param {object|null} [data.armor=null]    { modifier } worn armor
	 */
	async createCustomInventoryItem(input) {
		const data = buildInventoryItemData({ ...input, moveType: "inventory-custom" });
		await this._actor.createEmbeddedDocuments("Item", [data]);
	}

	/**
	 * Re-plant a dragged inventory Item (from the sidebar, or a Book II journal treasure)
	 * as an actor-embedded "inventory-custom" copy. A drop carries its gear metadata in
	 * `flags.stonetop` or `system` depending on where it came from, so resolve each field
	 * from whichever source has it and hand the result to the one shared builder — that
	 * way a new inventory field only has to be taught to buildInventoryItemData.
	 *
	 * @param {object} [opts]
	 * @param {boolean} [opts.hideArtifact=false] Land this drop unidentified (Book I p.430).
	 *        Read from the world setting by the sheet, because this class never touches
	 *        `game`. Only ever applied to a drop that doesn't already state its own
	 *        identification — a GM handing over an artifact they'd already revealed must not
	 *        have it re-hidden on the way in.
	 */
	async addDroppedInventoryItem(itemData, opts = {}) {
		// Where each field actually lives is readInventoryItemData's problem, not this method's.
		const read = readInventoryItemData(itemData);
		const clone = v => globalThis.foundry?.utils?.deepClone?.(v) ?? v;
		const { column: rawColumn, resource, armor, isTreasure } = read;
		const carriedState = normalizeArtifactState(read.artifact.state);
		// Only a treasure/artifact is ever hidden by default. An ordinary write-in dragged off
		// the sidebar has no tags worth concealing, and hiding it would strand the player with a
		// "?" on their own gear.
		const state = carriedState
			|| (opts.hideArtifact && isTreasure ? ARTIFACT_STATE.UNKNOWN : ARTIFACT_STATE.NONE);
		const data = buildInventoryItemData({
			artifact: { ...read.artifact, state },
			name: itemData?.name,
			// A drop's column is untrusted; anything but an explicit "regular" reads as small.
			column: rawColumn === "regular" ? "regular" : "small",
			weight: read.weight ?? 1,
			note: read.note,
			resource: resource ? clone(resource) : null,
			armor: armor ? clone(armor) : null,
			moveType: "inventory-custom",
			// A Book II treasure keeps its marker through the re-plant, so the gear tab can
			// group it under "Treasures" rather than among the write-ins.
			isTreasure,
			// And its art: a treasure resolves its illustration at drag time (there is no
			// document to point at ahead of time), so the drop payload is the only place
			// that carries it. Rebuilding the item without this drops the picture on the
			// floor for the sheet copy — the drop target that actually matters — and leaves
			// the whole art pipeline visible only in the Items sidebar.
			img: itemData?.img ?? null,
		});
		await this._actor.createEmbeddedDocuments("Item", [data]);
	}

	async removeCustomInventoryItem(itemId) {
		await this._actor.deleteEmbeddedDocuments("Item", [itemId]);
	}

	// --- Identifying artifacts (Book I, Discoveries pp.430-431) -------------
	//
	// State lives on the inventory Item, not in actor flags, because an artifact IS a document
	// the character owns — unlike an arcanum, which is a pack card the actor merely references
	// by slug. One consequence worth knowing: the ledger diffs ACTOR updates only, so these
	// writes are not ledgered and there is no point handing them a `stonetopMove`. The roll card
	// in chat is the durable record of how a thing came to be identified.

	/** The artifact fields of one owned inventory item, or null if there's no such item. */
	artifactKnowledge(itemId) {
		const item = this._actor.items.get(itemId);
		if (!item) return null;
		return {
			id:    item.id,
			name:  item.name,
			state: normalizeArtifactState(item.system?.identifyState),
			note:  item.system?.note ?? "",
			hint:  item.system?.artifactHint ?? "",
			lore:  item.system?.artifactLore ?? "",
			lead:  item.system?.artifactLead ?? "",
		};
	}

	/**
	 * Move an artifact to `state`.
	 *
	 * `upgradeOnly` is what the roll paths pass: a Know Things result may only ever tell the
	 * character MORE than they already knew, so a Logbook spend or a GM Shift that re-lands on a
	 * lower tier writes nothing rather than taking back a write-up already read. The GM's own
	 * hand-over control passes it false, since re-hiding a thing is exactly what that control is
	 * for. Returns whether anything was written.
	 */
	async setArtifactState(itemId, state, { upgradeOnly = false, ...options } = {}) {
		const item = this._actor.items.get(itemId);
		if (!item) return false;
		const next    = normalizeArtifactState(state);
		const current = normalizeArtifactState(item.system?.identifyState);
		if (next === current) return false;
		if (upgradeOnly && !isArtifactUpgrade(current, next)) return false;
		await item.update({ "system.identifyState": next }, options);
		return true;
	}

	/** Save the GM's hint / write-up / lead for an artifact. Absent keys are left alone. */
	async updateArtifactKnowledge(itemId, { hint, lore, lead, state } = {}, options = {}) {
		const item = this._actor.items.get(itemId);
		if (!item) return false;
		const update = {};
		if (hint  !== undefined) update["system.artifactHint"]  = String(hint ?? "");
		if (lore  !== undefined) update["system.artifactLore"]  = String(lore ?? "");
		if (lead  !== undefined) update["system.artifactLead"]  = String(lead ?? "");
		if (state !== undefined) update["system.identifyState"] = normalizeArtifactState(state);
		if (!Object.keys(update).length) return false;
		await item.update(update, options);
		return true;
	}

	// --- Player-authored custom moves -------------------------------------
	// A custom move is a plain embedded `move` item, forced to moveType "other"
	// (so buildMovelist's otherMoves filter surfaces it) and flagged custom so the
	// sheet offers an edit affordance only for player-authored ones (not foreign
	// playbook moves that also land in "other"). It then rolls through the same
	// engine as any move (StonetopItem.roll), no pack involvement, no rebuild.

	async addCustomMove(input) {
		const data = buildCustomMoveData(input);
		data.type = "move";
		const created = await this._actor.createEmbeddedDocuments("Item", [data]);
		return created?.[0] ?? null;
	}

	async updateCustomMove(itemId, input) {
		const item = this._actor.items.get(itemId);
		if (!item) return;
		await item.update(buildCustomMoveData(input));
	}

	// Toggle a move between learned (active — rollable, bonuses apply) and un-learned (kept
	// on the sheet but inactive). Persisted as an item flag; an absent flag means learned, so
	// a fresh move never needs the flag written to default to learned. Applies to ANY owned
	// move, not just player-authored ones: a move dropped onto the sheet from another
	// playbook is exactly as reversible as a homebrew one, and _isMoveLearned (which gates
	// the roll icon and every per-move bonus) has always read the flag off any item.
	async setMoveLearned(itemId, learned) {
		const item = this._actor.items.get(itemId);
		if (!item) return;
		await item.setFlag(STONETOP_SCOPE, "learned", !!learned);
	}

	computePossessionMaxUses(specialPossessions, ownedAllByName, level) {
		const result = { ...this._possessions.maxUses };
		for (const opt of (specialPossessions?.options ?? [])) {
			if (!opt.usesBonus) continue;
			let bonus = 0;
			if (opt.usesBonus.evenLevelBonus) {
				bonus += Math.floor(level / 2) * opt.usesBonus.evenLevelBonus;
			}
			bonus += sumMoveBonus(opt.usesBonus.moveBonus, n => ownedAllByName.get(n)?.length ?? 0);
			if (bonus > 0) result[opt.slug] = (opt.resource?.max ?? 0) + bonus;
		}
		return result;
	}

	// Move name → how many of that move the actor owns. Feeds sub-choice caps that
	// grow with a move (the Blessed's sacred-pouch remarkable traits, +1 per Big Magic).
	ownedMoveCounts() {
		const counts = {};
		for (const [name, items] of this._buildOwnedMovesMap()) counts[name] = items.length;
		return counts;
	}

	// Walk every subgroup of every selected (or preselected) possession that carries
	// `choiceGroups`, yielding `{ opt, sg }`. Shared descent for the two sacred-pouch
	// cap helpers below, which differ only in the innermost predicate.
	*_selectedPossessionSubgroups(specialPossessions) {
		const sp = specialPossessions;
		if (!sp) return;
		const selected = new Set([...(sp.preselected ?? []), ...this._possessions.selected]);
		for (const opt of (sp.options ?? [])) {
			if (!selected.has(opt.slug) || !opt.choiceGroups?.length) continue;
			for (const cg of opt.choiceGroups) {
				for (const sg of (cg.subgroups ?? [])) yield { opt, sg };
			}
		}
	}

	// Map of move name → possession slug for the character's selected possessions whose
	// sub-choice cap grows with that move (sacred pouch ← Big Magic). Drives the "edit
	// sacred pouch" affordance on those move cards and the auto-open on gaining one.
	possessionTriggerMoves(playbookData) {
		const map = {};
		for (const { opt, sg } of this._selectedPossessionSubgroups(playbookData?.specialPossessions)) {
			for (const mb of (sg.maxSelectBonus?.moveBonus ?? [])) {
				if (mb.moveName) map[mb.moveName] = opt.slug;
			}
		}
		return map;
	}

	// The selected possession (slug) whose sub-choice cap grows with `moveName` and
	// currently has an unfilled slot (chosen < cap), or null. Lets the sheet auto-open
	// the choices editor only when gaining the move actually frees a new pick.
	async possessionWithOpenChoiceFor(moveName) {
		if (!moveName) return null;
		const sp = (await this.playbook())?.specialPossessions;
		const moveCounts = this.ownedMoveCounts();
		const subChoices = this._possessions.subChoices;
		for (const { opt, sg } of this._selectedPossessionSubgroups(sp)) {
			if (!sg.multiSelect) continue;
			if (!(sg.maxSelectBonus?.moveBonus ?? []).some(mb => mb.moveName === moveName)) continue;
			const max = effectiveSubgroupMax(sg, moveCounts);
			const picked = new Set(subChoices[opt.slug] ?? []);
			const count = (sg.options ?? []).filter(o => picked.has(o.slug)).length;
			if (max != null && count < max) return opt.slug;
		}
		return null;
	}

	async selectPossession(slug)   { await this._possessions.select(slug); await this._addPossessionGrants(slug); }
	async deselectPossession(slug) { await this._possessions.deselect(slug); await this._removePossessionGrants(slug); }

	// Bundled-gear sync (see possession-grants.js). Materialize a possession's
	// `grantsItems` as inventory items on select; tear them down on deselect.
	//
	// Matches the `sourcePossession` tag first, then falls back to adopting untagged gear by
	// COLUMN + NAME (possession-grants.js#grantAdoptionKeys). That fallback carries the gear of
	// every world older than the day MoveModel learned to declare the tag: until then it was
	// stripped on the way into the document, so those items carry no tag at all and a tag-only
	// match would tear down nothing, stranding the gear on the sheet for good.
	//
	// The adoption rule is SHARED with the gear tab, which renders those same items inside the
	// possession's card (inferredGrantFor, in _buildInventorySection), and with
	// _addPossessionGrants below, which counts an adoptable write-in as this grant already being
	// present and declines to create it. All three have to agree — see that module for what each
	// direction of disagreement costs.
	async _grantedItemsFor(slug) {
		const tagged = [], untagged = [];
		for (const i of this._actor.items) {
			if (i.type !== "move" || i.system?.moveType !== "inventory-custom") continue;
			if (i.system?.sourcePossession === slug) tagged.push(i);
			else if (!i.system?.sourcePossession) untagged.push(i);
		}
		// Nothing untagged to adopt: skip resolving the playbook (a pack lookup) entirely.
		if (!untagged.length) return tagged;
		const adopt = await this._grantAdoptionKeys(slug);
		if (!adopt.size) return tagged;
		return [...tagged, ...untagged.filter(i => adopt.has(itemGrantKey(i)))];
	}

	// Which untagged write-ins possession `slug` may claim, resolved against every possession the
	// character actually holds. `slug` is added explicitly rather than relied on being selected:
	// deselectPossession drops it from the selection BEFORE calling the teardown, and a possession
	// missing from the active set would claim nothing at all.
	async _grantAdoptionKeys(slug) {
		const sp = (await this.playbook())?.specialPossessions;
		const active = new Set([...this._possessions.selected, ...(sp?.preselected ?? []), slug]);
		return grantAdoptionKeys(slug, (sp?.options ?? []).filter(opt => active.has(opt.slug)));
	}

	async _addPossessionGrants(slug) {
		const playbook = await this.playbook();
		const opt = (playbook?.specialPossessions?.options ?? []).find(o => o.slug === slug);
		if (!opt?.grantsItems?.length) return;
		// Dedupe against this possession's already-materialized grants AND any untagged write-in
		// its own grants would ADOPT — so a character who hand-added the bundled items before
		// grants existed isn't handed a duplicate by the ready-time back-fill.
		//
		// Keyed on the GRANT rather than on the item's own name, because an adopted legacy item may
		// be spelled with one of the grant's aliases ("Fine whisky" for "Fine whisky (advantage to
		// Persuade)") while grantsToCreate asks by `sourceKey`. And adoption is asked through the
		// same helper the teardown uses: suppressing a create on a LOOSER rule than the one that
		// later claims the item is what leaves a grant permanently unmaterialized.
		const adopt = await this._grantAdoptionKeys(slug);
		const existing = new Set();
		for (const i of this._actor.items) {
			if (i.type !== "move" || i.system?.moveType !== "inventory-custom") continue;
			if (i.system?.sourcePossession === slug) { existing.add(i.system?.sourceKey ?? i.name); continue; }
			if (i.system?.sourcePossession) continue;
			const grant = adopt.get(itemGrantKey(i));
			if (grant) existing.add(grant.sourceKey ?? grant.name);
		}
		const sourceLabel = stripHtmlToText(opt.label);
		const toCreate    = grantsToCreate(opt.grantsItems, existing, { slug, sourceLabel });
		if (toCreate.length) await this._actor.createEmbeddedDocuments("Item", toCreate);
		// Record that this possession's gear has been materialized, so the ready-time
		// back-fill (ensurePossessionGrants) never re-adds an item the player later deletes.
		await this._markPossessionGrantsApplied(slug);
	}

	async _removePossessionGrants(slug) {
		const ids = (await this._grantedItemsFor(slug)).map(i => i._id);
		if (ids.length) await this._actor.deleteEmbeddedDocuments("Item", ids);
		// Clear the mark so re-selecting the possession re-grants its gear afresh.
		await this._clearPossessionGrantsApplied(slug);
	}

	// Per-actor record of which possessions have had their bundled gear materialized
	// (flags.stonetop-pwd.possessionGrantsApplied[slug] = true). Tracked separately from
	// item presence so a grant the player deliberately deleted is never resurrected.
	_possessionGrantsApplied() {
		return this._actor.getFlag(STONETOP_SCOPE, "possessionGrantsApplied") ?? {};
	}
	async _markPossessionGrantsApplied(slug) {
		const applied = this._possessionGrantsApplied();
		if (applied[slug]) return;
		// Read-merge-write rather than relying on setFlag's merge, so a batch that marks
		// several slugs can't drop each other's keys.
		await this._actor.setFlag(STONETOP_SCOPE, "possessionGrantsApplied", { ...applied, [slug]: true });
	}
	async _clearPossessionGrantsApplied(slug) {
		if (!(slug in this._possessionGrantsApplied())) return;
		// setFlag can't drop keys — delete just this slug's entry, in whichever form the running
		// core applies (deletionEntry: ForcedDeletion on v14+, the legacy `-=` prefix below it).
		await this._actor.update(Object.fromEntries(
			[deletionEntry(`flags.${STONETOP_SCOPE}.possessionGrantsApplied.${slug}`)]));
	}

	// Ready-time back-fill for characters whose grant-bearing possessions were selected
	// before bundled-gear grants existed (or before this first ran): materialize the gear
	// for each selected possession not yet marked applied, then mark it — so it happens
	// once and never fights a later deletion. Idempotent (grantsToCreate skips items
	// already present), so a character already carrying its gear just gains the mark.
	async ensurePossessionGrants() {
		// Bail before resolving the playbook (a pack lookup, run per character on world
		// load) when there's nothing to back-fill: no selected possessions, or every one
		// already marked applied — the steady state after the first run.
		const selected = [...this._possessions.selected];
		if (!selected.length) return;
		const applied = this._possessionGrantsApplied();
		if (selected.every(slug => applied[slug])) return;
		const options = (await this.playbook())?.specialPossessions?.options ?? [];
		if (!options.length) return;
		for (const slug of selected) {
			if (applied[slug]) continue;
			const opt = options.find(o => o.slug === slug);
			if (opt?.grantsItems?.length) {
				await this._addPossessionGrants(slug); // creates any missing items + marks applied
			} else {
				// No bundled gear to materialize (an ability-only possession, or an unknown/
				// foreign slug) — still record it so the pre-playbook bail above can short-circuit
				// next load instead of re-resolving the playbook for this character every time.
				await this._markPossessionGrantsApplied(slug);
			}
		}
	}
	async setCustomPossessions(labels) { await this._possessions.setCustom(labels); }
	async removeCustomPossession(slug) { await this._possessions.removeCustom(slug); }
	async setPossessionUses(slug, count) { await this._possessions.setUses(slug, count); }

	// The choiceGroups subgroup (if any) within `possessionSlug` that contains `choiceSlug`,
	// so a sub-choice write can enforce that subgroup's cap. Null for radios / pick-N choices
	// (which live in `opt.choices`, not `opt.choiceGroups`).
	async _choiceSubgroupFor(possessionSlug, choiceSlug) {
		const opt = (await this.playbook())?.specialPossessions?.options?.find(o => o.slug === possessionSlug);
		for (const cg of (opt?.choiceGroups ?? [])) {
			for (const sg of (cg.subgroups ?? [])) {
				if ((sg.options ?? []).some(o => o.slug === choiceSlug)) return sg;
			}
		}
		return null;
	}

	async selectSubChoice(possessionSlug, choiceSlug) {
		// Enforce a capped multi-select line's limit in the model (the sacred pouch's
		// remarkable traits, 1 + Big Magic): refuse a pick past the effective cap so over-cap
		// is impossible regardless of which surface drove it. The UI `disabled` state is then a
		// convenience, not the only guard. Radios / uncapped / pick-N lines fall straight through.
		const sg = await this._choiceSubgroupFor(possessionSlug, choiceSlug);
		if (sg?.multiSelect) {
			const max = effectiveSubgroupMax(sg, this.ownedMoveCounts());
			const picked = this._possessions.subChoices[possessionSlug] ?? [];
			const atCap = max != null && (sg.options ?? []).filter(o => picked.includes(o.slug)).length >= max;
			if (atCap && !picked.includes(choiceSlug)) return;
		}
		await this._possessions.addSubChoice(possessionSlug, choiceSlug);
	}
	async setPossessionSubChoices(possessionSlug, choiceSlugs) {
		// Onboarding replaces a bundle's picks wholesale, so anything dropped here has to
		// give up its ◇ carry mark too — same reason as deselectSubChoice below.
		const kept = new Set(choiceSlugs ?? []);
		const dropped = (this._possessions.subChoices[possessionSlug] ?? [])
			.filter(s => !kept.has(s) && this._possessions.isChoiceCarried(possessionSlug, s));
		await this._possessions.writeSubChoices(possessionSlug, choiceSlugs ?? [], { uncarry: dropped });
	}
	async deselectSubChoice(possessionSlug, choiceSlug) {
		// Giving up a gear-bundle option drops its ◇ carry mark too, so re-choosing that
		// weapon later can't silently re-add its weight to your load. One write, not two:
		// each actor.update re-runs the ledger's snapshot diff (see writeSubChoices).
		const remaining = (this._possessions.subChoices[possessionSlug] ?? []).filter(s => s !== choiceSlug);
		const uncarry = this._possessions.isChoiceCarried(possessionSlug, choiceSlug) ? [choiceSlug] : [];
		await this._possessions.writeSubChoices(possessionSlug, remaining, { uncarry });
	}
	async selectSubChoiceExclusive(possessionSlug, choiceSlug, exclusiveSlugs) { await this._possessions.selectExclusive(possessionSlug, choiceSlug, exclusiveSlugs); }
	async setSubChoiceUses(possessionSlug, choiceSlug, count) { await this._possessions.setChoiceUses(possessionSlug, choiceSlug, count); }
	// The ◇ on a chosen weapon's row: whether it's on your person right now (counts toward
	// load). Independent of the pick itself — see _buildChoiceGearByPossession.
	async setChoiceGearCarried(possessionSlug, choiceSlug, isCarried) { await this._possessions.setChoiceCarried(possessionSlug, choiceSlug, isCarried); }
	async setPossessionChoiceText(possessionSlug, choiceSlug, value) { await this._possessions.setChoiceText(possessionSlug, choiceSlug, value); }

	// How many of the selected background's markable actions the character may mark at its
	// current level (Beast-Bonded: 1 at 1st, +1 at 3rd/5th/7th/9th). Lets the sheet enforce
	// the limit directly rather than relying solely on the rendered disabled attribute.
	async allowedMarkedActions() {
		const playbookData = await this.playbook();
		const bg = this._selectedBackground(playbookData);
		const level = this._actor.system?.attributes?.level?.value ?? 1;
		return allowedMarkableActions(bg?.markableActions, level);
	}

	async getMoves() {
		const playbookName = this._actor.system?.playbook?.name ?? null;
		const actorLevel = this._actor.system?.attributes?.level?.value ?? 1;
		const ownedAllByName = this._buildOwnedMovesMap();

		const playbookData = await this.playbook();
		const bgMoveNames = this._backgroundMoveNames(this._selectedBackground(playbookData));

		let playbookMoves = [];
		if (playbookName) {
			const entries = await this._moveRepo.getPlaybookMoves(playbookName);
			playbookMoves = this.sortPlaybookMoves(this.buildMovelistContext(entries, ownedAllByName, bgMoveNames, actorLevel, playbookName));

			const moveResourcesMap = this._moveResources.getMoveResources();
			for (const move of playbookMoves) {
				if (!move.resource) continue;
				move.resourceChecks = Array.from({ length: move.resource.max }, (_, i) => ({
					checked: i < (moveResourcesMap[move.name] ?? 0),
					label: move.resource.labels?.[i] ?? null,
				}));
			}
			playbookMoves = _sortOwnedFirst(playbookMoves);
		}

		const basicEntries = await this._moveRepo.getBasicMoves();
		const basicMoves = basicEntries.map(e => {
			const instances = ownedAllByName.get(e.name) ?? [];
			return {
				name: e.name,
				compendiumId: e.id,
				ownedId: instances[0]?._id ?? null,
				rollType: e.rollType,
				rollLabel: _rollLabelForMove(e.name, e.rollType, { moveType: "basic", description: e.description }),
				owned: instances.length > 0,
				description: e.description,
				moveResults: e.moveResults ?? null,
			};
		}).sort((a, b) => {
			if (a.name === "Aid") return -1;
			if (b.name === "Aid") return 1;
			return a.name.localeCompare(b.name);
		});
		const orderedBasicMoves = _sortOwnedFirst(basicMoves);

		const otherGroups = OTHER_MOVE_TYPES.reduce((acc, t) => {
			const items = this._actor.items.filter(i => i.type === "move" && i.system?.moveType === t);
			if (items.length) acc.push({
				key: t,
				label: capitalizeFirst(t) + " Moves",
				moves: items.map(i => ({
					name: i.name,
					ownedId: i._id,
					rollType: normalizeRollType(i.system?.rollType),
					rollLabel: _rollLabelForMove(i.name, i.system?.rollType, i.system),
				})),
			});
			return acc;
		}, []);

		const playbookMoveNameSet = new Set(playbookMoves.map(m => m.name));
		const otherMoves = this._actor.items
			.filter(i => {
				if (i.type !== "move") return false;
				if (i.system?.moveType === "other") return true;
				if (i.system?.moveType === "playbook" && !playbookMoveNameSet.has(i.name)) return true;
				return false;
			})
			.map(i => ({
				name: i.name,
				ownedId: i._id,
				rollType: normalizeRollType(i.system?.rollType),
				rollLabel: _rollLabelForMove(i.name, i.system?.rollType, i.system),
				description: i.system?.description ?? null,
				moveResults: i.system?.moveResults ?? null,
				// Only player-authored moves (not foreign playbook moves that also land
				// in "other") get the edit affordance on the sheet.
				custom: _isCustomMove(i),
			}));

		return { playbookMoves, basicMoves: orderedBasicMoves, otherGroups, otherMoves, startingMovesNote: playbookData?.startingMovesNote ?? null };
	}

	// The background the player picked, out of the ones their playbook offers.
	_selectedBackground(playbookData) {
		return playbookData?.backgrounds?.find(b => b.slug === this._background.selectedSlug) ?? null;
	}

	// The moves that background hands over, with the player's own setup-choice picks
	// folded in (see backgroundMoveNames).
	_backgroundMoveNames(background) {
		return backgroundMoveNames(background, this._background.setupChoices);
	}

	buildMovelistContext(entries, ownedAllByName, bgMoveNames, actorLevel, actorPlaybook) {
		const actorStats = _statValueMap(this._actor.system?.stats);
		return entries.map(e =>
			new PlaybookMoveEntry(e, ownedAllByName.get(e.name) ?? [], bgMoveNames, ownedAllByName, actorLevel, actorPlaybook, actorStats)
		);
	}

	sortPlaybookMoves(moves) {
		const groups = new Map();
		for (const move of moves) {
			const key = move.minLevel ?? 0;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(move);
		}
		const result = [];
		for (const level of [...groups.keys()].sort((a, b) => a - b)) {
			result.push(..._sortGroup(groups.get(level), new Set(groups.get(level).map(m => m.name))));
		}
		return result;
	}

	async ensureStartingMoves() {
		const playbookName = this._actor.system?.playbook?.name;
		if (!playbookName) return;

		const entries = await this._moveRepo.getPlaybookMoves(playbookName);
		const ownedNames = new Set(this._actor.items.filter(i => i.type === "move").map(i => i.name));

		const playbookData = await this.playbook();
		const bgMoveNames = this._backgroundMoveNames(this._selectedBackground(playbookData));

		// "Either X OR Y" starting moves (e.g. the Heavy's Armored OR Uncanny
		// Reflexes) are a player choice, so they're never auto-granted — the chosen
		// one is added by the onboarding flow (or picked by hand on the sheet).
		const choiceMoveNames = startingMoveChoiceNames(
			playbookData?.startingMoveChoices ?? playbookData?.moves?.choices
		);

		const missing = entries.filter(e =>
			((e.isStarting && !choiceMoveNames.has(e.name)) || bgMoveNames.has(e.name)) && !ownedNames.has(e.name)
		);
		if (missing.length) {
			const docs = await Promise.all(missing.map(e => this._moveRepo.getPlaybookMoveDocument(e.id)));
			await this._actor.createEmbeddedDocuments("Item", docs.filter(Boolean).map(d => d.toObject()));
		}

		const [basicEntries, expeditionEntries] = await Promise.all([
			this._moveRepo.getBasicMoves(),
			this._playerExpeditionMoves(),
		]);
		const missingUniversal = [
			...basicEntries.filter(e => !ownedNames.has(e.name)),
			...expeditionEntries.filter(e => !ownedNames.has(e.name)),
		];
		if (missingUniversal.length) {
			const docs = await Promise.all(missingUniversal.map(e => this._moveRepo.getBasicMoveDocument(e.id)));
			await this._actor.createEmbeddedDocuments("Item", docs.filter(Boolean).map(d => d.toObject()));
		}
	}

	async addMove(compendiumId, { skipIfOwned = false } = {}) {
		const doc = await this._moveRepo.getPlaybookMoveDocument(compendiumId);
		if (!doc) return null;
		if (skipIfOwned && this._actor.items.some(i => i.type === "move" && i.name === doc.name)) return null;
		const created = await this._actor.createEmbeddedDocuments("Item", [doc.toObject()]);
		return created?.[0] ?? null;
	}

	async addPlaybookMoveByName(playbookName, moveName) {
		if (!playbookName || !moveName) return;
		const ownedNames = new Set(this._actor.items.filter(i => i.type === "move").map(i => i.name));
		if (ownedNames.has(moveName)) return;
		const entries = await this._moveRepo.getPlaybookMoves(playbookName);
		const entry = entries.find(e => e.name === moveName);
		if (entry) await this.addMove(entry.id);
	}

	async removeMove(ownedId) {
		if (!ownedId) return;
		// Snapshot the doc before it's deleted — an Improved/Superior Stat instance needs its
		// recorded stat pick undone afterwards (see _revertStatIncreaseChoice), which reads
		// the item's id + name.
		const removed = this._actor.items.find(i => i._id === ownedId);
		// Cascade: a cross-playbook move (Versatile/Worldly/…) tags each foreign move it
		// granted with grantedBy.instanceId === its own item id. Removing the cross-playbook
		// move must also remove those granted moves, or they'd linger in "Learned Moves" with
		// a dangling "Granted by <gone move>" label and an ability the player no longer has.
		const orphans = this._actor.items
			.filter(i => i.type === "move" && i.flags?.[STONETOP_SCOPE]?.grantedBy?.instanceId === ownedId)
			.map(i => i._id);
		await this._actor.deleteEmbeddedDocuments("Item", [ownedId, ...orphans]);
		if (removed) await this._revertStatIncreaseChoice(removed);
		// A custom move's resource track is stored under its item id (see buildSnapshot), and
		// ids are never reused — so the count has to go with the move or it sits in the flag
		// forever. Shipped moves key by name and keep theirs on purpose. Only `removed` can be
		// custom: the cascaded orphans are cross-playbook grants, which are always shipped.
		if (_isCustomMove(removed)) await this._moveResources.clear(ownedId);
	}

	// Apply the "either X OR Y" starting-move picks: grant the chosen move in each group
	// and remove any other option from the same group the actor still owns, so switching
	// the choice (on a re-run of onboarding) doesn't leave the character owning both.
	// `choiceGroups` is the playbook's `moves.choices`; `chosenIdByGroup` maps group index
	// → chosen compendium id.
	async applyStartingMoveChoices(choiceGroups, chosenIdByGroup) {
		for (let i = 0; i < (choiceGroups?.length ?? 0); i++) {
			const chosenId = chosenIdByGroup?.[i];
			if (!chosenId) continue;
			const chosenDoc = await this._moveRepo.getPlaybookMoveDocument(chosenId);
			if (!chosenDoc) continue;
			const optionNames = new Set(choiceGroups[i].options ?? []);
			const stale = this._actor.items.filter(it =>
				it.type === "move" && optionNames.has(it.name) && it.name !== chosenDoc.name
			);
			for (const it of stale) await this.removeMove(it._id);
			await this.addMove(chosenId, { skipIfOwned: true });
		}
	}

	async _onCreateDescendantDocuments(documents) {
		const stonetopItem = documents.find(d => d.type === "playbook");
		if (!stonetopItem) return;
		const stonetopPlaybook = stonetopItem.asPlaybook();

		const hp = stonetopPlaybook.hp;
		const damage = stonetopPlaybook.damage;
		if (hp && damage) {
			await this._actor.update({
				"system.attributes.hp.max": hp,
				"system.attributes.hp.value": hp,
				"system.attributes.damage.value": damage,
			});
		}
		await this.ensureStartingMoves();
	}

	// `weaponSlug` pre-answers the attack flow's weapon prompt — set only by the paths where the
	// player has already chosen the weapon by choosing the move (see grantedWeaponAttackFor).
	//
	// RETURNS: `false` when there was nothing here to roll and the caller should try its other
	// paths (a bare stat, a damage formula); `"cancel"` when this WAS a move roll but the player
	// backed out of the weapon or target prompt, so no dice were thrown; `true` otherwise. The two
	// truthy answers both mean "taken, stop looking" — the distinction is only for a caller with
	// something to fire after the roll (see MOVE_ROLL_EFFECTS), which must not fire on a prompt
	// nobody answered.
	async onRoll(event, { statOverride = null, situational = 0, weaponSlug = null, rollMode = null } = {}) {
		const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
		if (!itemId) return false;
		const item = this._actor.items.get(itemId);
		const stat = statOverride ?? normalizeRollType(item?.system?.rollType);
		if (!stat) return false;

		const isDescription = event.currentTarget.getAttribute("data-show") === "description";
		const descriptionOnly = isDescription || (item.type === "npcMove" && !item.system.rollFormula);

		// Battle Joy's only roll is its ENDING ("when the action stops, roll +CON"), so making it is
		// leaving the state. Dropped before the options below are built, which is what puts the
		// character's debilities back in play for this roll and no earlier — see
		// applyDebilityRollMode. Reading the move's text is not rolling it, hence the guard.
		if (!descriptionOnly) await this._endBattleJoyBeforeRoll(item);

		// Clash / Let Fly: capture the targeted foes + chosen weapon and, for a hit, attach
		// the tier-gated Roll-damage action — or resolve a Let Fly "easy shot" with no roll.
		// Returns null for non-attack moves. See module/combat/attack-flow.js.
		let attackExtra = null;
		if (!descriptionOnly) {
			const begun = await maybeBeginAttack(this._actor, item, { stat, weaponSlug });
			// "cancel", not a bare `true`. Both stop the caller looking for another way to roll
			// this rollable, which is all the fall-through needs — but a caller that also has an
			// after-the-roll effect to fire has to be able to tell "the dice landed" from "the
			// player closed the weapon prompt", and while these answered the same the guards
			// written for exactly that (`if (handled) …`) were doing nothing at all.
			if (begun === "cancel") return "cancel";
			// Going on the offense (Clash / Let Fly) sheds any held Defend Readiness (p.216) —
			// but only once the attack is committed, not on a cancelled weapon/target prompt.
			if (attackMoveFor(item)) await this._loseDefendReadinessToOffense(item.name);
			if (begun === "handled") return true;
			attackExtra = begun;
		}

		const forward  = descriptionOnly ? 0 : this._actor.system?.attributes?.forward?.value ?? 0;
		const ongoing  = descriptionOnly ? 0 : this._actor.system?.attributes?.ongoing?.value ?? 0;
		// A one-off situational modifier from the optional pre-roll prompt; the roll
		// engine surfaces it as a "Situational" pill (modifier − forward − ongoing).
		const situ     = descriptionOnly ? 0 : situational;

		const modifier    = forward + ongoing + situ;
		// `rollMode` is the pre-roll prompt's answer when the prompt asked for one (see
		// RollDialog.js), and ABSENT when it did not — which is the ordinary case, because the
		// mode is normally the sticky selector on this sheet. So the sheet's own flag is the
		// fallback rather than "normal": defaulting to normal here would quietly overrule a
		// player who set Advantage on their sheet, on every roll.
		const rollOptions = {
			rollMode: normalizeRollMode(rollMode ?? this.rollMode),
			modifier, forward, ongoing, statOverride: stat, ...(attackExtra ?? {}),
		};

		const roll = await item.roll({ ...this.applyDebilityRollMode(stat, rollOptions), descriptionOnly });

		// Defend: fill the character's Readiness circles from the tier they just rolled
		// (p.216), never lowering a pool they already hold.
		if (!descriptionOnly && item?.name === _DEFEND_MOVE_NAME && Number.isFinite(roll?.total)) {
			await this._maybeHoldDefendReadiness(roll.total);
		}

		if (forward !== 0) {
			await this._actor.update({ "system.attributes.forward.value": 0 }, { stonetopMove: item?.name });
		}
		return true;
	}

	// -- Defend Readiness (Book I, Combat & Boons p.216) ----------------------
	// The Defend move holds Readiness in circles beside it on the Moves sidebar;
	// spend it to weather an attack for a ward, halve it, draw all attention, or
	// strike back. Stored as a scalar flag on the actor (see defend-readiness.js
	// for the pure hold/cap arithmetic).

	/** Whether the character currently bears a shield (its inventory slot is checked). */
	get bearsShield() {
		return !!(this._actor.getFlag(STONETOP_SCOPE, "inventory.checked")?.[_SHIELD_SLUG]);
	}

	/** The Heavy's Guardian move (+1 Readiness on every Defend, incl. a 6-). */
	get hasGuardianMove() {
		return this._actor.items.some(i => i.type === "move" && i.name === _GUARDIAN_MOVE_NAME);
	}

	get defendReadiness() {
		return Math.max(0, Math.trunc(Number(this._actor.getFlag(STONETOP_SCOPE, _DEFEND_READINESS_FLAG)) || 0));
	}

	/** The view model the sheet renders as circles beside the Defend move. */
	defendReadinessContext() {
		const opts  = { hasShield: this.bearsShield, hasGuardian: this.hasGuardianMove };
		const value = this.defendReadiness;
		const cap   = defendReadinessCap(opts);
		// Never render fewer circles than are held, so an over-held pool (e.g. shield
		// dropped mid-fight) stays visible and spendable.
		const count = Math.max(cap, value);
		return {
			value,
			cap,
			hasShield: opts.hasShield,
			hasGuardian: opts.hasGuardian,
			pips: Array.from({ length: count }, (_, i) => ({ index: i, filled: i < value })),
		};
	}

	async setDefendReadiness(n) {
		const next = Math.max(0, Math.trunc(Number(n) || 0));
		if (next === this.defendReadiness) return;
		await this._actor.setFlag(STONETOP_SCOPE, _DEFEND_READINESS_FLAG, next);
	}

	/**
	 * All five header-glyph ownership answers, from ONE walk of the items.
	 *
	 * Each single-answer getter resolves independently, and the character sheet's getData asks
	 * for every one of them on every render — so a sheet owning none of these moves (most sheets)
	 * paid a full traversal per predicate, seven in total once the multi-name ones are counted.
	 *
	 * A METHOD rather than a getter, and it takes the Set, because the sheet has other things
	 * asking the same question of the same items in the same repaint (the crew's Shield-Wall
	 * check, the per-card "exceptional" gate). A zero-argument getter could only ever build its
	 * own, which left the walk halved rather than shared. Builds one when called without.
	 *
	 * @param {Set<string>|null} [owned]  the render's own `ownedMoveNames`, when it has one
	 */
	headerGlyphOwnership(owned = null) {
		owned = ownedNamesOr(this._actor, owned);
		return {
			holyLight: canWieldHolyLight(this._actor, owned),
			condemn:   canCondemn(this._actor, owned),
			oaths:     canBindOaths(this._actor, owned),
			battleJoy: canEnterBattleJoy(this._actor, owned),
			blessed:   canMarkBlessed(this._actor, owned),
		};
	}

	// -- Holy light (the Lightbearer's consecrated flame) ----------------------------

	/** Is a holy light burning? A scalar, never an object: setFlag deep-merges plain
	 *  objects, so a sub-key could only ever be dropped through the `-=` dance, while a
	 *  boolean is replaced wholesale. See holy-light.js for why one slot is enough. */
	get holyLight() {
		return !!this._actor.getFlag(STONETOP_SCOPE, HOLY_LIGHT_FLAG);
	}

	/** Returns true only when the flag actually changed, so a caller can skip a re-render —
	 *  and, more to the point, so re-consecrating an already-lit flame writes no document
	 *  update and broadcasts nothing to the other clients. */
	async setHolyLight(lit) {
		const next = !!lit;
		// The Invocation goes out with the light — "it will end immediately if your holy light is
		// extinguished". Enforced HERE rather than at the one button that snuffs a flame, so no
		// future way of putting a light out can strand a Lightbearer concentrating on nothing.
		// Anyone who wants to SAY what stopped reads `ongoingInvocation` before calling.
		const droppedInvocation = !next && !!this.ongoingInvocation && await this.setOngoingInvocation("");
		if (next === this.holyLight) return droppedInvocation;
		if (next) await this._actor.setFlag(STONETOP_SCOPE, HOLY_LIGHT_FLAG, true);
		else      await this._actor.unsetFlag(STONETOP_SCOPE, HOLY_LIGHT_FLAG);
		return true;
	}

	// -- The ongoing Invocation (what the Lightbearer is concentrating on) -------------

	/** The slug of the Invocation being held open, or "" for none. See ongoing-invocation.js
	 *  for why this is one slug and not a list, and why the label isn't stored beside it. */
	get ongoingInvocation() {
		return readOngoing(this._actor.getFlag(STONETOP_SCOPE, ONGOING_INVOCATION_FLAG));
	}

	/** Start concentrating on an Invocation, or end it with "". Same contract as setHolyLight:
	 *  true only when something actually changed, so renewing the Invocation already running
	 *  writes nothing and broadcasts nothing. */
	async setOngoingInvocation(slug) {
		const next = readOngoing(slug);
		if (next === this.ongoingInvocation) return false;
		// Unset rather than storing "": an Invocation that has ended should leave no trace on the
		// actor, the same way a snuffed light doesn't.
		if (next) await this._actor.setFlag(STONETOP_SCOPE, ONGOING_INVOCATION_FLAG, next);
		else      await this._actor.unsetFlag(STONETOP_SCOPE, ONGOING_INVOCATION_FLAG);
		return true;
	}

	// -- The standing lists (Condemn, oaths, the Blessed's marks) -----------------------
	//
	// Three rosters, one storage contract, so the contract is written once here and each feature's
	// writers below are a single line naming their own flag and their own roster operation. The
	// list algebra itself lives in marked-people.js; these two are only its binding to the actor.

	/** One standing list's raw stored value, for handing to that roster's operations. */
	_rosterRaw(flag) {
		return this._actor.getFlag(STONETOP_SCOPE, flag);
	}

	/**
	 * Commit a roster operation's result and hand back what it did, or null when it did nothing.
	 *
	 * Two rules live here, and ONLY here, for all three lists:
	 *
	 * ⚠ The store is a flag ARRAY, and Foundry's update merge treats an array as an ATOMIC value —
	 * so the write hands over the WHOLE list rather than reaching into a slot. A dotted
	 * `condemned.2.note` does not patch element 2: it expands to `{ condemned: { 2: … } }` and
	 * replaces the array with an object, destroying the roster. Same rule, for the same reason, as
	 * roster-portraits.js — read its header note before changing this.
	 *
	 * And: an operation that changed nothing writes NOTHING. Re-Censuring somebody already branded
	 * would otherwise broadcast an update and re-render every open sheet to store what was already
	 * there.
	 */
	async _rosterWrite(flag, { entries, added, removed, changed }) {
		const result = added ?? removed ?? changed ?? null;
		if (!result) return null;
		await this._actor.setFlag(STONETOP_SCOPE, flag, entries);
		return result;
	}

	// -- Condemn (the Judge's brand) --------------------------------------------------

	/** Everyone this Judge is holding a brand on, normalised. See condemn.js for the shape. */
	get condemned() {
		return readCondemned(this._rosterRaw(CONDEMNED_FLAG));
	}

	/** Whether this character owns Condemn — what earns the scales in the header. */
	get canCondemn() {
		return canCondemn(this._actor);
	}

	/**
	 * Brand somebody. Returns the stored entry, or null when the list was left alone — which is
	 * either a nameless target or one already branded.
	 */
	async brandCondemned(entry) {
		return this._rosterWrite(CONDEMNED_FLAG,
			addCondemned(this._rosterRaw(CONDEMNED_FLAG), entry, newRosterId));
	}

	/** Dismiss one brand — the only way it ever ends. Returns the entry that was lifted, or null. */
	async dismissCondemned(id) {
		return this._rosterWrite(CONDEMNED_FLAG, removeCondemned(this._rosterRaw(CONDEMNED_FLAG), id));
	}

	/** Re-word why somebody is branded. Returns the patched entry, or null when nothing changed. */
	async setCondemnedNote(id, note) {
		return this._rosterWrite(CONDEMNED_FLAG, noteCondemned(this._rosterRaw(CONDEMNED_FLAG), id, note));
	}

	// -- Oaths (the Judge's Binding Arbitration) ---------------------------------------
	// The Judge's SECOND standing list, kept beside the first and shown in the same window.

	/** Every oath this Judge is holding somebody to, normalised. See oaths.js for the shape. */
	get oaths() {
		return readOaths(this._rosterRaw(OATHS_FLAG));
	}

	/** Whether this character owns Binding Arbitration — the other thing that earns the scales. */
	get canBindOaths() {
		return canBindOaths(this._actor);
	}

	/**
	 * Witness an oath. Returns the stored entry, or null when the list was left alone — a nameless
	 * swearer, or one already on the list.
	 */
	async witnessOath(entry) {
		return this._rosterWrite(OATHS_FLAG, addOath(this._rosterRaw(OATHS_FLAG), entry, newRosterId));
	}

	/** Release somebody from an oath — the only way it ends. Returns the entry lifted, or null. */
	async releaseOath(id) {
		return this._rosterWrite(OATHS_FLAG, removeOath(this._rosterRaw(OATHS_FLAG), id));
	}

	/** Re-word what somebody swore. Returns the patched entry, or null when nothing changed. */
	async setOathNote(id, note) {
		return this._rosterWrite(OATHS_FLAG, noteOath(this._rosterRaw(OATHS_FLAG), id, note));
	}

	/** Mark an oath kept or broken — a broken one is advantage on all rolls against them. */
	async setOathBroken(id, broken) {
		return this._rosterWrite(OATHS_FLAG, setOathBroken(this._rosterRaw(OATHS_FLAG), id, broken));
	}

	// -- The Blessed's marks -----------------------------------------------------------
	// Five moves, one list, each row carrying WHICH of the five it is.

	/** Every mark this Blessed has standing, normalised. See blessed-marks.js for the shape. */
	get blessedMarks() {
		return readMarks(this._rosterRaw(BLESSED_MARKS_FLAG));
	}

	/** Whether this character owns any of the five marking moves — what earns the header glyph. */
	get canMarkBlessed() {
		return canMarkBlessed(this._actor);
	}

	/** Lay a mark. Returns the stored entry, or null for a nameless or already-marked subject. */
	async layBlessedMark(entry) {
		return this._rosterWrite(BLESSED_MARKS_FLAG,
			addMark(this._rosterRaw(BLESSED_MARKS_FLAG), entry, newRosterId));
	}

	/** Lift a mark. Returns the entry lifted, or null when the id matched nothing. */
	async liftBlessedMark(id) {
		return this._rosterWrite(BLESSED_MARKS_FLAG, removeMark(this._rosterRaw(BLESSED_MARKS_FLAG), id));
	}

	/** Re-word what a mark is for. Returns the patched entry, or null when nothing changed. */
	async setBlessedMarkNote(id, note) {
		return this._rosterWrite(BLESSED_MARKS_FLAG, noteMark(this._rosterRaw(BLESSED_MARKS_FLAG), id, note));
	}

	/**
	 * Say whether a ward's signs repel or trap — the choice Wards & Bindings asks for at the moment
	 * it is laid, and the one thing that says which of the two a row is. Returns the patched entry,
	 * or null when nothing changed, which is also what the four kinds without the choice get back.
	 */
	async setBlessedMarkSign(id, sign) {
		return this._rosterWrite(BLESSED_MARKS_FLAG, setMarkSign(this._rosterRaw(BLESSED_MARKS_FLAG), id, sign));
	}

	/**
	 * Spend or restore a Shared Souls beast's Loyalty.
	 *
	 * The one writer with something to say beyond the shared contract: it returns `{ changed, ended }`,
	 * where `ended` is the move's own stopping condition — "when you spend its last Loyalty, the
	 * effect ends". Whether the row GOES with it is the caller's to ask for (`liftOnEnd`), so the
	 * announcement still belongs to the dialog; when it does ask, the removal rides the same write
	 * rather than storing and broadcasting an exhausted row first.
	 */
	async setBlessedMarkLoyalty(id, loyalty, options = {}) {
		const result = setMarkLoyalty(this._rosterRaw(BLESSED_MARKS_FLAG), id, loyalty, options);
		const changed = await this._rosterWrite(BLESSED_MARKS_FLAG, result);
		return { changed, ended: changed ? result.ended : false };
	}

	// -- Battle Joy (the Heavy) ---------------------------------------------------------

	/** Is this character lost in their Battle Joy? A scalar, for the reason holyLight is. */
	get battleJoy() {
		return !!this._actor.getFlag(STONETOP_SCOPE, BATTLE_JOY_FLAG);
	}

	/**
	 * Whether the three debility boxes are presently doing nothing — "you ignore … the effects of
	 * debilities as long as you keep fighting". Read by the roll path below and by the sheet, which
	 * greys the boxes out, so the tick and the roll can never disagree about whether it applies.
	 */
	get ignoresDebilities() {
		return ignoresDebilities({ raging: this.battleJoy });
	}

	/** Returns true only when the flag actually changed, so a caller can skip a re-render. */
	async setBattleJoy(raging) {
		const next = !!raging;
		if (next === this.battleJoy) return false;
		if (next) await this._actor.setFlag(STONETOP_SCOPE, BATTLE_JOY_FLAG, true);
		else      await this._actor.unsetFlag(STONETOP_SCOPE, BATTLE_JOY_FLAG);
		return true;
	}

	/**
	 * Matched on the resolved ITEM's name, never on a row's text: an un-owned playbook row posts its
	 * text with no item at all, and a player-authored custom move can carry any name.
	 *
	 * Returns whether it actually ended something, so the sheet knows whether this roll was the end
	 * of a rage (and can repaint the glyph) or an ordinary Battle Joy roll by somebody who never
	 * ticked it on.
	 */
	async _endBattleJoyBeforeRoll(item) {
		if (item?.name !== BATTLE_JOY) return false;
		return this.setBattleJoy(false);
	}

	// Raise the held Readiness to the amount this Defend tier grants, never lowering an
	// existing pool (a fresh 7-9 shouldn't shrink Readiness you're already holding). Posts
	// a chat note when the pool actually grows.
	async _maybeHoldDefendReadiness(total) {
		const tier = classifyResult(total).key;
		const hold = defendReadinessHold(tier, { hasShield: this.bearsShield, hasGuardian: this.hasGuardianMove });
		const existing = this.defendReadiness;
		const next = Math.max(existing, hold);
		if (next === existing) return;
		await this.setDefendReadiness(next);
		// The shield's +1 rides a 7+ hit only, so don't credit it on a 6- miss (where the
		// hold comes solely from Guardian) — that would falsely imply the shield applied.
		const shieldNote = (this.bearsShield && tier !== "failure") ? " (shield)" : "";
		await ChatMessage.create({
			content: moveChatCard("Defend: Readiness held",
				`<p><strong>${escHtml(this._actor.name)}</strong> holds <strong>${next}</strong> Readiness${escHtml(shieldNote)}.</p>`
				+ `<p>Spend it to suffer an attack's damage/effects for a ward, halve it, draw all attention to yourself, or strike back.</p>`),
			speaker: ChatMessage.getSpeaker({ actor: this._actor }),
		});
	}

	// "When you go on the offense … lose any Readiness that you hold" (p.216). Called when
	// the character rolls Clash / Let Fly. Clears the pool and posts a note if any was held.
	async _loseDefendReadinessToOffense(moveName) {
		if (this.defendReadiness <= 0) return;
		await this.setDefendReadiness(0);
		await ChatMessage.create({
			content: moveChatCard("Readiness lost",
				`<p><strong>${escHtml(this._actor.name)}</strong> goes on the offense${moveName ? ` (${escHtml(moveName)})` : ""} and loses all held Readiness.</p>`),
			speaker: ChatMessage.getSpeaker({ actor: this._actor }),
		});
	}

	async onDirectStatRoll(stat, extraOptions = {}) {
		const { rollStat } = await import("../../utils/roll-engine.js");
		// `rollMode` is the pre-roll prompt's answer when the prompt asked for one (RollDialog.js)
		// and absent otherwise, in which case the sheet's sticky selector decides. Destructured
		// rather than left in `rest` so the caller cannot half-set it: Know Things passes a mode
		// it has already lifted through withAdvantage, and that is a value, not an override.
		const { situational = 0, rollMode = null, ...rest } = extraOptions;
		const forward  = this._actor.system?.attributes?.forward?.value ?? 0;
		const ongoing  = this._actor.system?.attributes?.ongoing?.value ?? 0;
		// `situational` is the one-off modifier from the optional pre-roll prompt; the
		// roll engine renders it as a "Situational" pill (modifier − forward − ongoing).
		const modifier = forward + ongoing + situational;

		// Returned so a caller that has to act on the outcome (the arcana Identify roll) can
		// classify the total without re-rolling or re-deriving the tier thresholds.
		const roll = await rollStat(stat, this._actor, this.applyDebilityRollMode(stat, {
			rollMode: normalizeRollMode(rollMode ?? this.rollMode),
			modifier,
			forward,
			ongoing,
			...rest,
		}));

		if (forward !== 0) {
			await this._actor.update({ "system.attributes.forward.value": 0 }, extraOptions.moveName ? { stonetopMove: extraOptions.moveName } : {});
		}
		return roll;
	}

	/**
	 * Order Followers (Book I, NPCs & Followers p.462). A follower doesn't roll
	 * +STAT — it rolls 2d6 plus the bonus the player resolved from its tags (+0/+1/
	 * +2, see orderFollowersBonus), optionally with disadvantage when a tag gets in
	 * the way. We route through rollStat with an explicit statValue so we reuse its
	 * card, its disadvantage handling, and — crucially — its automatic +1 XP on a
	 * 6-, which marks on this PC and is attributed to the move (the player marks XP
	 * when their follower misses). The PC's own forward/ongoing/debility/global roll
	 * mode deliberately do NOT apply: the follower is acting, not the PC.
	 *
	 * @param {object} opts
	 * @param {number} [opts.bonus]     - 0, 1, or 2
	 * @param {string} [opts.rollMode]  - "normal" | "adv" | "dis"
	 * @param {string} [opts.moveName]  - Card header, e.g. "Hari: Defy Danger"
	 */
	async onOrderFollowersRoll({ bonus = 0, rollMode = "normal", moveName } = {}) {
		const { rollStat } = await import("../../utils/roll-engine.js");
		// Return the roll so the caller can react to the result — e.g. auto-holding
		// Readiness when a follower is ordered to Defend and rolls 7+ (p.469).
		return rollStat("follower", this._actor, {
			statValue: Math.trunc(Number(bonus) || 0),
			rollMode:  ["adv", "dis"].includes(rollMode) ? rollMode : "normal",
			moveName:  moveName || "Order Followers",
			modifier:  0,
		});
	}

	async onDropMove(itemData) {
		const alreadyOwned = !!this._actor.items.find(i => i.type === "move" && i.name === itemData.name);
		if (alreadyOwned) return false;

		const actorPlaybook = this._actor.system?.playbook?.name ?? null;
		const itemPlaybook = itemData.system?.playbook ?? null;
		if (itemData.system?.moveType === "playbook" && itemPlaybook && itemPlaybook !== actorPlaybook) {
			itemData = { ...itemData, system: { ...itemData.system, moveType: "other" } };
		}

		await this._actor.createEmbeddedDocuments("Item", [itemData]);
		return true;
	}

	/**
	 * Turn a marked debility into disadvantage on the rolls it touches, and say on the card which
	 * one did it. THE one place a debility affects a roll — which is why the Heavy's Battle Joy is
	 * enforced here rather than at each of the four callers.
	 *
	 * "You ignore fear, pain, mind-control, and the effects of debilities as long as you keep
	 * fighting." So a raging Heavy's boxes stay ticked (they are still weakened; they are simply
	 * past caring) and the roll goes out clean — with a pill saying so, because a player who has
	 * forgotten they are in it would otherwise read the missing disadvantage as a bug.
	 *
	 * The move's OWN roll is exempt by construction: rolling Battle Joy is "when the action stops",
	 * and the sheet drops the state before that roll is built (see _endBattleJoyBeforeRoll), so the
	 * debility applies to it exactly as the rules say.
	 */
	applyDebilityRollMode(stat, options) {
		const debilityOptions = this._actor.system.attributes?.debilities?.options ?? {};
		const activeEntry = Object.entries(debilityOptions).find(
			([key, opt]) => {
				if (!opt.value) return false;
				const affectedStats = Array.isArray(opt.stat) ? opt.stat : _DEBILITY_DEF_BY_KEY[key]?.stats;
				return affectedStats?.includes(stat);
			}
		);
		if (!activeEntry) return options;
		const [key] = activeEntry;
		const def = _DEBILITY_DEF_BY_KEY[key];
		// Battle Joy: the debility is marked and does nothing. Named on the card rather than left
		// silent, and the roll mode is passed through UNTOUCHED — including an advantage the
		// debility would otherwise have cancelled, which is the point of ignoring it.
		if (this.ignoresDebilities) {
			return { ...options, stonetopDebilityIgnored: BATTLE_JOY, stonetopDebilityIgnoredName: def?.name ?? key };
		}
		const base = { ...options, stonetopDebility: def?.name ?? key, stonetopDebilityTooltip: def?.description ?? "" };
		if (options.rollMode === "adv") return { ...base, rollMode: "normal" };
		return { ...base, rollMode: "dis" };
	}

	// The STICKY roll mode: the Roll Modifier selector in the sheet's Moves sidebar
	// (roll-mode-radios.hbs), stored as a flag on the actor so it survives a re-render and is
	// the same for everyone looking at the character. It is what every roll uses UNLESS the
	// caller passed a mode of its own — the pre-roll window's answer, or a rule the move
	// itself forces. Which of the two is asked is the "Ask How to Roll Each Time" client
	// setting; the sheet simply stops drawing this control when the window is doing the asking,
	// and the flag then sits at whatever it was last set to, harmlessly, until it is drawn again.
	get rollMode() {
		return normalizeRollMode(resolvedFlags(this._actor).rollMode);
	}

	async setRollMode(rollMode) {
		await this._actor.setFlag(STONETOP_SCOPE, "rollMode", normalizeRollMode(rollMode));
	}

	// ── Death and dying (Book I, Harm & Healing p.245) ─────────────────────────
	// HP alone can't say whether a character at 0 HP still has their 0-HP move ahead of
	// them: a Death's Door 7-9 leaves them at 0 HP and expressly no longer dying. The
	// state flag carries that; deaths-door.js owns what the transitions are.

	/**
	 * DEATHS_DOOR_STATE value, or null for the ordinary living state.
	 *
	 * Read through `effectiveDeathsDoorState`, which is what stops a `fate-pending` left standing
	 * beside an insert from telling every surface that Death's Door is still owed by someone who
	 * has already answered it. See that function for how the pair used to come about.
	 */
	get deathsDoorState() {
		return effectiveDeathsDoorState({
			state:      resolvedFlagProperty(this._actor, DEATHS_DOOR_FLAG) ?? null,
			insertSlug: this._postDeath.activeSlug,
		});
	}

	async setDeathsDoorState(state) {
		if (state) await this._actor.setFlag(STONETOP_SCOPE, DEATHS_DOOR_FLAG, state);
		else await this._actor.unsetFlag(STONETOP_SCOPE, DEATHS_DOOR_FLAG);
	}

	/**
	 * Clearing the state as part of another write, for the moves where coming back and being
	 * healed are one decision (see restoreHp / markDebility). Written as an explicit null
	 * rather than an unset, which is how the preUpdate hook writes it too — the reader treats
	 * both alike (see deathsDoorState).
	 */
	get _clearDeathsDoorUpdate() {
		return { [`flags.${STONETOP_SCOPE}.${DEATHS_DOOR_FLAG}`]: null };
	}

	get hp() { return Number(this._actor.system?.attributes?.hp?.value) || 0; }

	/** At 0 HP with their 0-HP move still to face. */
	get canFaceDeathsDoor() {
		return canFaceDeathsDoor({ hp: this.hp, state: this.deathsDoorState });
	}

	/** Which move this character triggers at 0 HP — Death's Door only until they take an insert. */
	get zeroHpMove() {
		return zeroHpMove(this._postDeath.activeSlug);
	}

	/**
	 * The Heavy's Death's Door modifiers, read off the character's own moves: Hard to Kill's
	 * "+CON or +nothing (your choice)" and Unstoppable's "-1 penalty for each circle marked".
	 *
	 * The pure rule lives in deaths-door.js and only ever sees move NAMES, so the one thing it
	 * can't hand back is the prose. Fetched here instead, off the character's own copy of the
	 * move, so the dialog can show a player who is being offered +CON where that came from.
	 */
	deathsDoorRollOptions() {
		const moves = this._actor.items.filter(i => i.type === "move");
		const opts  = deathsDoorRollOptions(moves.map(i => i.name), this._moveResources.getMoveResources());
		const owner = opts.statChoiceMove
			? moves.find(i => i.name?.toLowerCase() === opts.statChoiceMove.toLowerCase())
			: null;
		return { ...opts, statChoiceMoveDescription: owner?.system?.description ?? null };
	}

	/**
	 * Death's Door 10+: "return to 1 HP", and with it the end of dying. Written here rather than
	 * left to the player, since the move gives them no choice about it. restoreHp only ever
	 * raises hit points, which is exactly what this wants: a character who was somehow healed
	 * above 1 while the dialog was open keeps the better number.
	 */
	async returnToOneHp() {
		return this.restoreHp(1, "Death's Door", { clearsDeathsDoor: true });
	}

	// ── The inserts' own 0-HP moves (Undying / Tethered / Dark Succor) ─────────
	// Their bookkeeping lives on the insert (consequences, Marks, Favor), so these are thin
	// pass-throughs to CharacterPostDeath; the walkthrough calls them rather than reaching
	// through `_postDeath` itself.

	/** The resolution spec for this character's 0-HP move, or null without an insert. */
	get zeroHpResolution() {
		return zeroHpResolution(this._postDeath.activeSlug);
	}

	/**
	 * The character's real max HP.
	 *
	 * NOT `system.attributes.hp.max`: that field is written once, when the playbook is dropped,
	 * and never again — every later contribution (move bonuses, a Thrall's max-HP Marks, and the
	 * permanent hand-set adjustment; see setMaxHp) lives only in the computed snapshot, which the
	 * sheet mirrors into its inputs without persisting. Anything doing arithmetic on "your max
	 * HP" has to ask for the computed value or it will quietly use the level-1 number.
	 */
	async computedMaxHp() {
		const snapshot = await this.buildSnapshot();
		// 0 is the vitals section's way of saying "there is no computed max": without a playbook it
		// emits `new ValueMax(0, 0)`. That is not nullish, so a bare `??` never reached the fallback
		// below and this handed back a max of 0 — and every caller doing arithmetic on it inherited
		// the zero. UndeathDialog's "reform with half your max HP" floored to 1 HP for a Ghost whose
		// playbook slug no longer resolved in the pack, which is the one moment it most matters.
		const computed = Number(snapshot.vitals?.hp?.max);
		return Number.isFinite(computed) && computed > 0 ? computed : this.storedMaxHp;
	}

	/** The persisted field — stale by design; see computedMaxHp. Only for a last-resort fallback. */
	get storedMaxHp()       { return Number(this._actor.system?.attributes?.hp?.max) || 0; }

	/** The lasting hand-set change to max HP, signed. 0 when max HP is purely derived. */
	get maxHpAdjustment()   { return Math.trunc(Number(this._actor.system?.attributes?.hp?.adjustment) || 0); }

	/**
	 * Set max HP by hand, permanently.
	 *
	 * A dozen arcana and post-death consequences move max HP for good — "the ring wounds your
	 * soul, reducing your max HP by 4", "gain unholy resilience: increase your max HP by 2" —
	 * and typing the new number into the sheet used to last exactly one render, because the
	 * max field mirrors the computed value (see computedMaxHp) and the computation knew nothing
	 * about it. What's stored is the DELTA from the derived number, not the number itself, so
	 * the scar keeps its size when a later level or move raises the base underneath it.
	 *
	 * `base` is the derived max the sheet already rendered into the field's dataset, which
	 * saves rebuilding the snapshot to read one integer back out. A base of 0 means there is
	 * no derived number to sit on top of (no playbook yet), so the typed value is written
	 * straight to the stored max as it always was.
	 *
	 * Lowering the max takes current HP down with it — a soul-wound doesn't leave you standing
	 * at more hit points than you now have. Returns the max HP now in play.
	 */
	async setMaxHp(input, { base: knownBase = null } = {}) {
		// `null` is "I don't know it", NOT zero — Number(null) is 0, which would silently take
		// the no-playbook branch below and write a raw max the next render would overwrite.
		const base = (knownBase !== null && knownBase !== undefined && Number.isFinite(Number(knownBase)))
			? Math.trunc(Number(knownBase))
			: ((await this.buildSnapshot()).vitals?.hpBase ?? 0);
		const typed = Math.trunc(Number(input));
		if (!Number.isFinite(typed)) return base > 0 ? await this.computedMaxHp() : this.storedMaxHp;
		const target = Math.max(1, typed);
		// The adjustment is the delta and stays the delta — that is what keeps a soul-wound the same
		// size when a later level raises the base underneath it. `hp.max` is written ALONGSIDE it as
		// a mirror, never instead of it: `system.json` names `attributes.hp` as the primary token
		// attribute and this system links PC prototype tokens, so the bar over the character's head
		// reads the stored field and nothing else. Left alone it kept the number the playbook drop
		// wrote, and a Heavy who typed 24 here had a token that still filled at 20.
		const update = base > 0
			? { "system.attributes.hp.adjustment": target - base, "system.attributes.hp.max": target }
			: { "system.attributes.hp.max": target };
		if (this.hp > target) update["system.attributes.hp.value"] = target;
		await this._actor.update(update);
		return target;
	}

	/** The hand-set damage die, or null when the die follows the playbook. */
	get damageDieOverride() { return normalizeDamageDie(this._actor.system?.attributes?.damage?.override); }

	/**
	 * The damage die this character actually rolls: the hand-set override if there is one, else the
	 * playbook's die raised by any owned move that raises it ("increase your damage die to a d8").
	 *
	 * The same answer `buildSnapshot().vitals.damage` gives — it shares `_derivedDamageDie`, so the
	 * rule is stated once — for a fraction of the work. A snapshot walks moves, inventory, arcana,
	 * possessions and post-death lore to build a whole sheet; this needs the playbook and the move
	 * bonuses and nothing else. That matters because the damage roller asks per ROLL, including on
	 * the counter-attack and multi-target paths, and `system.attributes.damage.value` cannot answer
	 * on its own: it records what was written when the playbook was dropped or the field edited, so
	 * a mark-raised die would keep rolling at its old size.
	 *
	 * The override is checked first and costs a property read, which is the whole answer for any
	 * character whose die is whatever they typed.
	 */
	async computedDamageDie() {
		const override = this.damageDieOverride;
		if (override) return override;
		const playbookData = await this.playbook();
		if (!playbookData) return null;
		const moveBonuses = await this._ownedMoveBonuses(playbookData, this._buildOwnedMovesMap());
		return _derivedDamageDie(playbookData, moveBonuses);
	}

	/**
	 * Set (or clear, with a blank/unparseable value) the hand-typed damage die.
	 *
	 * `damage.value` is written alongside it because that persisted field is what the damage
	 * roller reads (see combat/attack-flow.js) and what the sheet's Damage input shows. Clearing
	 * puts the derived die back in both places, so nothing keeps rolling the abandoned override —
	 * and blanks them when there's no derived die to fall back on (no playbook), rather than
	 * leaving the cleared override standing in the one field that decides the roll.
	 * Returns the die now in play, or null if there is none (no playbook and nothing typed).
	 *
	 * `base` is the derived (playbook + marks) die when the caller already has it — the sheet
	 * renders it into the field's own dataset — which saves rebuilding the whole snapshot just
	 * to read one string back out of it.
	 */
	async setDamageDieOverride(input, { base: knownBase = null } = {}) {
		const die = normalizeDamageDie(input);
		const base = die ? null : (knownBase ?? (await this.buildSnapshot()).vitals?.damageBase ?? null);
		const effective = die ?? base;
		await this._actor.update({
			"system.attributes.damage.override": die ?? "",
			"system.attributes.damage.value": effective ?? "",
		});
		return effective;
	}
	async setMasterTask(t)  { await this._postDeath.setMasterTask(t); }
	get tether()            { return this._postDeath.tether; }
	async setTether(t)      { await this._postDeath.setTether(t); }
	async crossOffMark(s)   { return this._postDeath.crossOffMark(s); }
	async sectionOptions(s) { return this._postDeath.sectionOptions(s); }
	async markSectionOption(section, option)   { return this._postDeath.markSectionOption(section, option); }
	async unmarkSectionOption(section, option) { return this._postDeath.unmarkSectionOption(section, option); }
	async clearSectionPicks(section)           { return this._postDeath.clearSectionPicks(section); }
	favor()                 { return this._postDeath.favor(); }
	async setFavor(v)       { await this._postDeath.setFavor(v); }

	/**
	 * Which insert is worn, and the two readers a chooser needs that the sheet snapshot doesn't
	 * carry cheaply: the insert's own Instincts, and one written lore value. Together with
	 * sectionOptions above, these are the whole read surface of post-death-choices.js.
	 */
	get postDeathSlug()                 { return this._postDeath.activeSlug; }
	async postDeathInsertName()         { return this._postDeath.insertName(); }
	async postDeathInstinctOptions()    { return this._postDeath.instinctOptions(); }
	postDeathLoreText(section, option)  { return this._postDeath.loreText(section, option); }
	async chooseOneSectionOption(section, option) { return this._postDeath.chooseOneSectionOption(section, option); }

	/**
	 * Set HP to an exact value, for the insert moves that restore a stated amount ("regain half
	 * your max HP", "regain 1 HP"). The caller computes the amount against the real max (see
	 * computedMaxHp), so it's taken as authoritative here — this only refuses to LOWER hit
	 * points, since these moves restore rather than cap.
	 *
	 * `clearsDeathsDoor` rides the state change along in the same write: being restored IS the
	 * end of the brush with death, so it should cost one ledger line and one re-render rather
	 * than two. It still has to happen when the hit points DON'T move (a character healed above
	 * the amount while the dialog was open), so that path writes the state on its own.
	 */
	async restoreHp(value, moveName, { clearsDeathsDoor = false } = {}) {
		const target = Math.max(0, Math.trunc(Number(value) || 0));
		if (target <= this.hp) {
			if (clearsDeathsDoor) await this.setDeathsDoorState(null);
			return false;
		}
		const update = { "system.attributes.hp.value": target };
		if (clearsDeathsDoor) Object.assign(update, this._clearDeathsDoorUpdate);
		await this._actor.update(update, moveName ? { stonetopMove: moveName } : {});
		return true;
	}

	/** The three debilities and whether each is marked — for a move that offers a choice of one. */
	get debilityChoices() {
		const opts = this._actor.system?.attributes?.debilities?.options ?? {};
		return _DEBILITY_DEFS.map(({ key, name, description }) => ({
			key, name, description, marked: !!opts[key]?.value,
		}));
	}

	/**
	 * Mark one debility, optionally in the same write as an HP change and the end of a brush
	 * with death — the Heavy's Hard to Kill trades exactly that on a 7-9 ("mark a debility of
	 * your choice to regain 1 HP", which is also what takes them out of being out of the
	 * action), and one write means one ledger line and one re-render for what is one decision.
	 *
	 * `hp` is a FLOOR, not an assignment, on exactly restoreHp's terms: these moves RESTORE hit
	 * points, so the number is where they must not be below rather than where they must be. The
	 * difference shows when someone else heals a downed character while the walkthrough is still
	 * open — a Heavy healed to 6 who then trades a debility was being set back down to 1.
	 */
	async markDebility(key, { hp = null, moveName, clearsDeathsDoor = false } = {}) {
		if (!_DEBILITY_DEF_BY_KEY[key]) return false;
		if (this.debilityChoices.find(d => d.key === key)?.marked) return false;
		const update = { [`system.attributes.debilities.options.${key}.value`]: true };
		if (hp !== null && hp > this.hp) update["system.attributes.hp.value"] = hp;
		if (clearsDeathsDoor) Object.assign(update, this._clearDeathsDoorUpdate);
		await this._actor.update(update, moveName ? { stonetopMove: moveName } : {});
		return true;
	}

	// ── Problematic / permanent wounds (Book I, Harm & Healing) ────────────────
	// Stored as an array on system.attributes.wounds. Arrays are replaced wholesale
	// on update (unlike object flags, which merge), so every mutation reads the
	// current list, recomputes it, and writes the whole thing back. `moveName`, when
	// given, tags the write so the character ledger attributes it ("via Recover", etc.).

	// A defensive, normalized copy of the current wound list.
	_woundList() {
		const arr = this._actor.system?.attributes?.wounds;
		return Array.isArray(arr) ? arr.map(w => _normalizeWound(w)) : [];
	}

	async _writeWounds(wounds, moveName) {
		await this._actor.update(
			{ "system.attributes.wounds": wounds },
			moveName ? { stonetopMove: moveName } : {},
		);
	}

	// Add a wound. Returns its generated id so callers can immediately open it for editing.
	async addWound(data = {}) {
		const wound  = _normalizeWound(data, { keepId: false });
		await this._writeWounds([...this._woundList(), wound]);
		return wound.id;
	}

	// Patch an existing wound in place (status, text, notes, tag, …).
	async updateWound(id, patch = {}, { moveName } = {}) {
		const wounds = this._woundList();
		const i = wounds.findIndex(w => w.id === id);
		if (i < 0) return;
		wounds[i] = _normalizeWound({ ...wounds[i], ...patch, id }, { keepId: true });
		await this._writeWounds(wounds, moveName);
	}

	async setWoundStatus(id, status) {
		await this.updateWound(id, { status });
	}

	// "Heal" keeps the record as a scar (healed:true) rather than deleting it, so the
	// "it's now true" fiction stays referenceable in the collapsed Scars list.
	async healWound(id) {
		await this.updateWound(id, { healed: true });
	}

	// Hard-remove a wound (the explicit trash affordance, distinct from healing).
	async removeWound(id) {
		await this._writeWounds(this._woundList().filter(w => w.id !== id));
	}

	// Convalesce, applied to wounds in a single write: heal the given ids (→ scars) and
	// stamp Make-a-Plan notes onto permanent injuries. One update so the sheet
	// re-renders once instead of once per wound.
	async convalesceWounds({ healIds = [], planNotes = {} } = {}) {
		const healSet = new Set(healIds);
		const wounds = this._woundList().map(w => {
			let next = w;
			if (healSet.has(w.id)) next = { ...next, healed: true };
			if (Object.prototype.hasOwnProperty.call(planNotes, w.id)) {
				next = { ...next, planNote: String(planNotes[w.id] ?? "").trim() };
			}
			return next;
		});
		await this._writeWounds(wounds, "Convalesce");
	}
	async getArcanum(slug)                           { return this._arcana.getArcanum(slug); }
	async getArcanumMove(slug, moveSlug)             { return this._arcana.getArcanumMove(slug, moveSlug); }
	async addArcanum(slug)                           { await this._arcana.addArcanum(slug); }
	async removeArcanum(slug)                        { await this._arcana.removeArcanum(slug); await this._inventory.clearArcanumResources(slug); }
	async identifyArcanum(slug, options)             { await this._arcana.identifyArcanum(slug, options); }
	async identifyAndRevealArcanum(slug, options)    { await this._arcana.identifyAndRevealArcanum(slug, options); }
	async identifyFrontOwedArcanum(slug, options)    { await this._arcana.identifyFrontOwedArcanum(slug, options); }
	async addLead(slug)                              { await this._arcana.addLead(slug); }
	async discoverArcanum(slug)                      { await this._arcana.discoverArcanum(slug); }
	async ensureSeekerLeadCard()                     { await this._arcana.ensureLeadBackfill(); }
	async masterArcanum(slug)                        { await this._arcana.masterArcanum(slug); }
	async getArcanumChatContent(slug, flipped)       { return this._arcana.getArcanumChatContent(slug, flipped); }
	async setMinorArcanumRole(role, slug) { await this._arcana.setMinorRole(role, slug); }
	async revealArcanum(slug, options) { await this._arcana.revealArcanum(slug, options); }
	async hideArcanum(slug, options)   { await this._arcana.hideArcanum(slug, options); }
	get revealedArcanaSlugs()   { return this._arcana.revealedSlugs; }
	get backOwedArcanaSlugs()   { return this._arcana.backOwedSlugs; }
	// The lower rung of p.440's disclosure ladder, so a caller re-applying a rewritten roll tier
	// can tell "never read" from "front already read" and refuse to walk the ladder backwards
	// (see _syncArcanumIdentification in stonetop.js).
	get identifiedArcanaSlugs() { return this._arcana.identifiedSlugs; }
	get ownedArcanaSlugs()      { return this._arcana.ownedSlugs; }
	async setArcanumUnlockCount(arcanumSlug, optionSlug, count)          { await this._arcana.setUnlockCount(arcanumSlug, optionSlug, count); }
	async setArcanumBackOptionCount(arcanumSlug, optionSlug, count)      { await this._arcana.setBackOptionCount(arcanumSlug, optionSlug, count); }
	async setArcanumBoxChecked(slug, context, index, checked)            { await this._arcana.setArcanumBoxChecked(slug, context, index, checked); }
	async setArcanumResource(slug, count, options)                       { await this._inventory.setResource(slug, count, options); }
	async setLoreOptionCount(loreSlug, optionSlug, count)           { await this._lore.setCount(loreSlug, optionSlug, count); }
	async setLoreOptionText(loreSlug, optionSlug, value)            { await this._lore.setText(loreSlug, optionSlug, value); }

	async getLevelUpData() {
		const actor      = this._actor;
		const level      = actor.system?.attributes?.level?.value ?? 1;
		const xp         = actor.system?.attributes?.xp?.value ?? 0;
		const cost       = xpToLevelUp(level);
		const newLevel   = level + 1;
		const playbookData   = await this.playbook();
		const ownedAllByName = this._buildOwnedMovesMap();

		let availableMoves = [];
		let lockedMoves    = [];
		if (playbookData?.name) {
			const bgMoveNames = this._backgroundMoveNames(this._selectedBackground(playbookData));
			const entries     = await this._moveRepo.getPlaybookMoves(playbookData.name);
			const all = this.sortPlaybookMoves(
				this.buildMovelistContext(entries, ownedAllByName, bgMoveNames, newLevel, playbookData.name)
			).filter(e => !e.owned || (e.repeatable && e.ownedIds.length < e.repeatMax));
			availableMoves = all.filter(e => !e.locked);
			lockedMoves    = all.filter(e => e.locked);
		}

		let needsInvocation     = false;
		let availableInvocations = [];
		if (newLevel % 2 === 0 && playbookData?.invocations?.options?.length) {
			const selected = new Set(actor.getFlag(STONETOP_SCOPE, "invocations.selected") ?? []);
			availableInvocations = playbookData.invocations.options.filter(o => !selected.has(o.slug));
			needsInvocation = availableInvocations.length > 0;
		}

		return {
			level, xp, cost, newLevel,
			xpRemaining: xp - cost,
			playbookName: playbookData?.name ?? null,
			playbookSlug: playbookData?.slug ?? actor.system?.playbook?.slug ?? null,
			availableMoves,
			lockedMoves,
			needsInvocation,
			availableInvocations,
			// Current stat values, so the stat-increase picker can grey out any stat
			// already at the chosen move's cap (+2 / +3).
			stats: Object.entries(_STAT_DEFS).map(([key, { name, abbr }]) => ({
				key, name, abbr, value: actor.system?.stats?.[key]?.value ?? 0,
			})),
			// All current move marks, so the dialog's mark step can show what's already
			// spent on a budgeted move (Veteran Crew / Well Versed / …) and compute the
			// remaining picks for this take.
			marks: this._moveResources.getMarks(),
		};
	}

	// Cross-playbook foreign-move pickers (Versatile/Worldly/Dabbler/Wild Soul/Initiate of
	// the Secret Arts/Seasoned Warrior/Arts of War) let the player learn a move from another
	// playbook "for which they otherwise qualify". Given the picked move's `crossPlaybook`
	// config + the level being gained, returns the qualifying foreign moves
	// ({compendiumId, name, description, playbook}), EXCLUDING: Improved/Superior Stat
	// (cap != null), other cross-playbook moves (no third-playbook chaining), and moves
	// already owned. The foreign move's own `requirement.playbook` is intentionally IGNORED
	// — crossing playbooks is the point — but its level + required-move prereqs are honored.
	async getForeignMovesForLevelUp(crossPlaybook, level) {
		const ownName = (await this.playbook())?.name ?? this._actor.system?.playbook?.name ?? null;
		const allowed = crossPlaybook?.playbooks === "any"
			? _ALL_PLAYBOOK_NAMES.filter(p => p !== ownName)
			: (crossPlaybook?.playbooks ?? []).filter(p => p !== ownName);
		const ownedNames = new Set(this._actor.items.filter(i => i.type === "move").map(i => i.name));
		const actorStats = _statValueMap(this._actor.system?.stats);
		const out = [], seen = new Set();
		// Fetch every allowed playbook's moves concurrently — the reads are independent
		// compendium lookups, so awaiting them one at a time just stacks latency (up to
		// ~8 playbooks for an "any" cross-playbook move).
		const movesPerPlaybook = await Promise.all(allowed.map(pb => this._moveRepo.getPlaybookMoves(pb)));
		for (let i = 0; i < allowed.length; i++) {
			const pb = allowed[i];
			for (const def of movesPerPlaybook[i]) {
				if (def.cap != null) continue;          // no Improved/Superior Stat
				if (def.crossPlaybook) continue;         // no third-playbook chaining
				if (ownedNames.has(def.name) || seen.has(def.name)) continue;
				if (!_foreignMoveQualifies(def, ownedNames, level, actorStats)) continue;
				seen.add(def.name);
				out.push({ compendiumId: def.id, name: def.name, description: def.description ?? "", playbook: pb, requiresLabel: _foreignRequiresLabel(def.requirement) });
			}
		}
		out.sort((a, b) => a.playbook.localeCompare(b.playbook) || a.name.localeCompare(b.name));
		return out;
	}

	// `choices` carries any decision the picked move demands at acquisition. Today that
	// is `{ stat, cap }` for the stat-increase moves (Improved/Superior Stat); the dialog
	// collects it, this commits it. The move is added first so the choice can key off the
	// new item's id, then the choice is applied — a mid-flow failure leaves the move owned
	// (its choice re-collectable from the card) rather than a half-applied stat bump.
	async applyLevelUp(selectedMoveCompendiumId, selectedInvocationSlug, choices = null) {
		// Through the XP lock (utils/xp.js), not adjustXp: the level and the XP it cost move in
		// ONE update, and splitting them would leave a moment where the character has the new
		// level and has not paid for it. Both are therefore read inside the lock, so a mark that
		// landed while the level-up dialog was open is spent from rather than overwritten.
		//
		// Only the write is held: the move additions below reach into compendia, and keeping
		// every other XP change on this client waiting on a pack read would trade one rare bug
		// for a common stall.
		await withXpLock(this._actor, async () => {
			const level = this._actor.system?.attributes?.level?.value ?? 1;
			const xp    = this._actor.system?.attributes?.xp?.value ?? 0;
			await this._actor.update({
				"system.attributes.level.value": level + 1,
				"system.attributes.xp.value":   Math.max(0, xp - xpToLevelUp(level)),
			});
		});
		let addedItem = null;
		if (selectedMoveCompendiumId) {
			addedItem = await this.addMove(selectedMoveCompendiumId);
		}
		if (addedItem && choices?.stat) {
			await this._applyStatIncreaseChoice(addedItem, choices.stat, choices.cap ?? null);
		}
		if (addedItem && choices?.crossPlaybook) {
			await this._applyForeignMoveChoice(addedItem, choices.foreignMoveId ?? null, choices.grantsPossession ?? null);
		}
		// Mark-selection moves (Veteran Crew / Heroes to the Last / Beast of Legend / Well
		// Versed) and the Would-Be Hero's Potential for Greatness collect their marks here.
		// Keyed by move NAME — the same store the sheet writes — so this is NOT gated on
		// `addedItem`: PfG's target is an already-owned move, not the one just picked. A
		// budgeted move WAS added above, so its owned-count (and thus its repeat-scaling
		// cap) already reflects this take when setCountMark clamps below.
		if (choices?.marks?.picks?.length) {
			await this._applyMarkChoices(choices.marks.moveName, choices.marks.picks);
		}
		if (selectedInvocationSlug) {
			const current = this._actor.getFlag(STONETOP_SCOPE, "invocations.selected") ?? [];
			await this._actor.setFlag(STONETOP_SCOPE, "invocations.selected", [...current, selectedInvocationSlug]);
		}
	}

	// Record an Improved/Superior Stat pick: remember which stat this move instance raised
	// (keyed by the new item's id, so a repeatable Improved Stat's instances stay distinct
	// and the "+1 STR" chip renders on the right card), then bump that stat by +1, clamped
	// to the move's cap (+2 / +3). Tagged with the move name so the ledger reads "via …".
	async _applyStatIncreaseChoice(moveItem, statKey, cap) {
		if (!_STAT_DEFS[statKey]) return;
		const choices = { ...(this._actor.getFlag(STONETOP_SCOPE, "improvedStatChoices") ?? {}), [moveItem.id]: statKey };
		await this._actor.setFlag(STONETOP_SCOPE, "improvedStatChoices", choices);
		const current = this._actor.system?.stats?.[statKey]?.value ?? 0;
		const next    = cap != null ? Math.min(current + 1, cap) : current + 1;
		if (next > current) {
			await this._actor.update({ [`system.stats.${statKey}.value`]: next }, { stonetopMove: moveItem.name });
		}
	}

	// Apply (or re-apply) the "+1 to which stat?" pick for a stat-increase move taken at
	// creation, resolving the OWNED instance rather than relying on addMove's return. On an
	// onboarding re-run the move is already owned (addMove returns null) and the base-stat
	// write has just reset the stat, so without this the +1 is silently dropped. Idempotent:
	// base was reset first and the +1 is capped, so it lands exactly once per finalize.
	async applyCreationStatChoice(compendiumId, statKey) {
		if (!statKey) return;
		const doc = await this._moveRepo.getPlaybookMoveDocument(compendiumId);
		if (!doc) return;
		const owned = this._actor.items.find(i => i.type === "move" && i.name === doc.name);
		if (!owned || owned.system?.cap == null) return;
		await this._applyStatIncreaseChoice(owned, statKey, owned.system.cap);
	}

	// Inverse of _applyStatIncreaseChoice, run when an Improved/Superior Stat instance is
	// dropped from the sheet: forget this instance's recorded pick and step the chosen stat
	// back down by 1. The picker only ever offers stats below the cap, so every recorded
	// pick applied exactly +1 — a plain −1 is its exact inverse (floored at the −1 stat
	// minimum). No-ops when this move recorded no pick (any non-stat move, or one added
	// before the pick was collected).
	async _revertStatIncreaseChoice(moveItem) {
		const statKey = (this._actor.getFlag(STONETOP_SCOPE, "improvedStatChoices") ?? {})[moveItem.id];
		if (!statKey) return;
		// setFlag merges (it can't drop keys), so unset just this instance's entry — via
		// deletionEntry, so v14 gets a ForcedDeletion rather than a deprecated `-=` key.
		await this._actor.update(Object.fromEntries(
			[deletionEntry(`flags.${STONETOP_SCOPE}.improvedStatChoices.${moveItem.id}`)]));
		if (!_STAT_DEFS[statKey]) return;
		const current = this._actor.system?.stats?.[statKey]?.value ?? 0;
		await this._actor.update(
			{ [`system.stats.${statKey}.value`]: Math.max(current - 1, -1) },
			{ stonetopMove: moveItem.name },
		);
	}

	// Cross-playbook pick (Versatile/Worldly/…): add the chosen foreign move and tag it
	// "granted by" this cross-playbook move instance, so it renders in the "Learned Moves"
	// category and a repeatable cross-playbook move can track each pick separately. Some
	// cross-playbook moves (Initiate of the Secret Arts) also grant a possession — the
	// Seeker's Sacred Pouch — on first take; the grant is idempotent (skips if already owned).
	async _applyForeignMoveChoice(crossItem, foreignMoveCompendiumId, grantsPossession) {
		if (foreignMoveCompendiumId) {
			const foreign = await this.addMove(foreignMoveCompendiumId);
			if (foreign) {
				await foreign.setFlag(STONETOP_SCOPE, "grantedBy", { move: crossItem.name, instanceId: crossItem.id });
			}
		}
		if (grantsPossession && !this._possessions.selected.has(grantsPossession)) {
			await this.selectPossession(grantsPossession);
		}
	}

	// Apply a level-up mark step's picks (the budgeted moves — Veteran Crew / Heroes to the
	// Last / Beast of Legend / Well Versed) to the move's mark store via setCountMark
	// (budget-clamped, level-stamped; hp/armor/crew/companion effects are derived on render,
	// so we never apply them here). Writes flags.stonetop-pwd.moves.moveMarks keyed by move
	// NAME, the same surface the sheet's own checkboxes use.
	async _applyMarkChoices(moveName, picks) {
		for (const pick of picks) {
			const current = _markEntries(this._moveResources.getMarks()[moveName]?.[pick.slug]).length;
			await this.setCountMark(moveName, pick.slug, current + 1);
		}
	}

	_buildOwnedMovesMap() {
		const map = new Map();
		for (const item of this._actor.items.filter(i => i.type === "move")) {
			if (!map.has(item.name)) map.set(item.name, []);
			map.get(item.name).push(item);
		}
		return map;
	}
}

// ── Snapshot helpers ──────────────────────────────────────────────────────────

// The 9 playbooks by display name (as stored in a move's system.playbook), for the
// Versatile "any other playbook" cross-playbook pick.
const _ALL_PLAYBOOK_NAMES = [
	"The Blessed", "The Fox", "The Heavy", "The Judge", "The Lightbearer",
	"The Marshal", "The Ranger", "The Seeker", "The Would-Be Hero",
];

// A foreign move qualifies for a cross-playbook pick when the actor owns its required
// moves, meets its level, and meets any machine-checkable stat minimum (Musclebound's
// STR +2 — gated here just as it is on its home playbook, so crossing playbooks can't
// dodge the prereq). Its `requirement.playbook` is intentionally ignored (the
// cross-playbook move grants the cross-playbook access); a null requirement always
// qualifies. NOTE: a freeform `requirement.note` (e.g. "All 6 marks in Potential for
// Greatness") is still NOT machine-checked — it can't be without a per-note rule engine —
// so such a move stays pickable; the note is surfaced in the picker for the player to
// self-police, exactly as the sheet shows note-only prerequisites on owned moves.
function _foreignMoveQualifies(def, ownedNames, level, actorStats = {}) {
	const req = def.requirement;
	if (!req) return true;
	if (req.level && level < req.level) return false;
	for (const m of (req.moves ?? [])) if (!ownedNames.has(m)) return false;
	if (statRequirementsUnmet(req.stats, actorStats)) return false;
	return true;
}

// Display string of a foreign move's prerequisites for the picker (required moves + the
// machine-checked stat minimum + the freeform note); the playbook requirement is omitted
// (crossing playbooks is the point) and level is omitted (already enforced). Null when
// there's nothing to show.
function _foreignRequiresLabel(req) {
	if (!req) return null;
	const parts = [];
	if (req.moves?.length) parts.push(req.moves.join(", "));
	const statLabel = statRequirementLabel(req.stats);
	if (statLabel)         parts.push(statLabel);
	if (req.note)          parts.push(req.note);
	return parts.length ? parts.join("; ") : null;
}

const _STAT_DEFS = {
	str: { name: "Strength",     abbr: "STR" },
	dex: { name: "Dexterity",    abbr: "DEX" },
	con: { name: "Constitution", abbr: "CON" },
	int: { name: "Intelligence", abbr: "INT" },
	wis: { name: "Wisdom",       abbr: "WIS" },
	cha: { name: "Charisma",     abbr: "CHA" },
};

const _DEBILITY_DEFS = [
	{ key: "weakened",  name: "Weakened",  stats: ["str", "dex"], description: "Fatigued, tired, sluggish, shaky. Disadvantage on +STR or +DEX rolls." },
	{ key: "dazed",     name: "Dazed",     stats: ["int", "wis"], description: "Out of it, befuddled, not thinking clearly. Disadvantage on +INT or +WIS rolls." },
	{ key: "miserable", name: "Miserable", stats: ["con", "cha"], description: "Greatly distressed, angry, unwell, in pain. Disadvantage on +CON or +CHA rolls." },
];
const _DEBILITY_DEF_BY_KEY = Object.fromEntries(_DEBILITY_DEFS.map(d => [d.key, d]));

function _buildStatsSection(actor) {
	const rawStats = actor.system?.stats ?? {};
	return Object.fromEntries(
		Object.entries(_STAT_DEFS).map(([key, { name, abbr }]) => [
			key,
			new StatSnapshot(rawStats[key]?.value ?? 0, name, abbr),
		])
	);
}

// Flatten the actor's `system.stats` ({ str: { value }, … }) to a plain key→value map
// for the move-list's machine-checkable stat prerequisites (Musclebound's STR +2).
function _statValueMap(rawStats) {
	const stats = rawStats ?? {};
	return Object.fromEntries(Object.keys(_STAT_DEFS).map(key => [key, stats[key]?.value ?? 0]));
}

function _buildDebilitiesSection(actor) {
	const opts = actor.system?.attributes?.debilities?.options ?? {};
	return _DEBILITY_DEFS.map(({ key, name, stats }) =>
		new DebilitySnapshotBuilder()
			.withKey(key)
			.withName(name)
			.withActive(!!(opts[key]?.value))
			.withStats(stats)
			.build()
	);
}

// Valid wound enum values. Kept here (not as StringField `choices`) so the read path
// can coerce anything unexpected — a wound record written by a newer build, or a
// hand-edited world — back to a safe default instead of wedging the sheet.
const _WOUND_STATUSES = ["problematic", "stabilized", "permanent"];
const _WOUND_ORIGINS  = ["wound", "deaths-door"];

// Coerce a stored/partial wound record into the canonical shape the schema and sheet
// expect, filling defaults and normalizing the two enum fields. `keepId` false mints a
// fresh id (used when adding); true preserves whatever id came in (used when editing).
function _normalizeWound(w = {}, { keepId = true } = {}) {
	return {
		id:              (keepId && w.id) ? w.id : foundry.utils.randomID(),
		text:            typeof w.text === "string" ? w.text : "",
		status:          _WOUND_STATUSES.includes(w.status) ? w.status : "problematic",
		origin:          _WOUND_ORIGINS.includes(w.origin) ? w.origin : "wound",
		requirementNote: typeof w.requirementNote === "string" ? w.requirementNote : "",
		planNote:        typeof w.planNote === "string" ? w.planNote : "",
		planRequirements: Array.isArray(w.planRequirements)
			? w.planRequirements
				.map(r => ({ text: typeof r?.text === "string" ? r.text : "", done: !!r?.done }))
				.filter(r => r.text)
			: [],
		mechanicalTag:   typeof w.mechanicalTag === "string" ? w.mechanicalTag : "",
		reminderMove:    typeof w.reminderMove === "string" ? w.reminderMove : "",
		healed:          !!w.healed,
	};
}

function _buildWoundsSection(actor) {
	const arr = actor.system?.attributes?.wounds;
	if (!Array.isArray(arr)) return [];
	return arr.map(w => {
		const n = _normalizeWound(w);
		return new WoundSnapshotBuilder()
			.withId(n.id)
			.withText(n.text)
			.withStatus(n.status)
			.withOrigin(n.origin)
			.withRequirementNote(n.requirementNote)
			.withPlanNote(n.planNote)
			.withPlanRequirements(n.planRequirements)
			.withMechanicalTag(n.mechanicalTag)
			.withReminderMove(n.reminderMove)
			.withHealed(n.healed)
			.build();
	});
}


/**
 * The DERIVED damage die: the playbook's, raised by any owned move that raises it. Null without a
 * playbook, since there is nothing to derive from.
 *
 * Stated here alone because two callers need the same answer at very different prices — the vitals
 * section building a whole sheet, and `computedDamageDie` answering a single damage roll. A second
 * copy is how the roller and the sheet come to disagree about what die a character rolls.
 *
 * Does NOT consider the hand-typed override: that WINS over this, and the two callers apply it at
 * their own layer (the field is what the sheet renders, and it is checked first by the accessor).
 */
function _derivedDamageDie(playbookData, moveBonuses = {}) {
	if (!playbookData) return null;
	return moveBonuses.damageDie ? maxDie(playbookData.damage, moveBonuses.damageDie) : playbookData.damage;
}

function _buildVitalsSection(actor, playbookData, armorValue, moveBonuses = {}, wornArmorBase = 0, insertHpPenalty = 0) {
	const attrs = actor.system?.attributes ?? {};
	const level = attrs.level?.value ?? 1;
	// Floored at 1: a Thrall who collects enough max-HP Marks would otherwise arrive at 0 max HP
	// and be permanently dying, which is Unholy Vessel's job to end, not arithmetic's. The same
	// floor covers a permanent adjustment deep enough to do it the other way round.
	const derivedHp = (playbookData?.hp ?? 0) + (moveBonuses.hp ?? 0) - insertHpPenalty;
	// The lasting hand-set change: arcana that cost or grant max HP outright ("reducing your max
	// HP by 1d4+1", "+4 max HP"). Kept as a delta on top of the derived number so levelling and
	// new move bonuses still land, rather than freezing max HP at whatever was typed.
	const hpAdjust = Math.trunc(Number(attrs.hp?.adjustment) || 0);
	const hpBase = playbookData ? Math.max(1, derivedHp) : 0;
	// Built on hpBase, NOT on the un-floored derivedHp, so the number the sheet shows as the base
	// and the number the adjustment is measured against are the same one. They part company only
	// when the floor fires, and that is exactly when the hand-set round trip broke: the field
	// renders `hpBase` into `data-hp-base`, _onMaxHpEdit stores `typed - base`, and computing the
	// max off derivedHp then landed somewhere else entirely. The floor still holds, since hpBase
	// is already at least 1 wherever a playbook exists.
	const hpMax = Math.max(1, hpBase + hpAdjust);
	const damageBase = _derivedDamageDie(playbookData, moveBonuses);
	// A die typed into the sheet's Damage field wins outright: it is the player saying "this
	// character's die is X", which the playbook has no business overwriting on the next render.
	// Clearing the field drops back to the derived die (see setDamageDieOverride).
	const damage = normalizeDamageDie(attrs.damage?.override) ?? damageBase;
	return new VitalsSnapshotBuilder()
		.withHp(playbookData ? new ValueMax(Math.min(attrs.hp?.value ?? 0, hpMax), hpMax) : new ValueMax(0, 0))
		.withHpBase(hpBase)
		.withDamage(damage)
		.withDamageBase(damageBase)
		.withArmor(armorValue)
		.withWornArmor(wornArmorBase)
		.withLevel(level)
		.withXp(new ValueMax(attrs.xp?.value ?? 0, xpToLevelUp(level)))
		.build();
}

// Magnificent Specimen (Ranger): "each time you take this move, your companion gains 2
// additional options of your choice" → 2 extra trait picks on the companion per copy.
const MAGNIFICENT_SPECIMEN_MOVE = "Magnificent Specimen";
const COMPANION_TRAIT_PICKS_PER_MAGNIFICENT_SPECIMEN = 2;

// Final per-Crew-member stats: the playbook's data-driven base plus the bonuses
// from marked Marshal moves (Heroes to the Last / Veteran Crew).
function _buildCrewStats(crew, moveBonuses) {
	return {
		memberHp:  (crew?.hp ?? 6) + (moveBonuses.crewHp ?? 0),
		armor:     crew?.armor ?? 0,
		damageDie: stepDie(crew?.damageDie ?? "d6", moveBonuses.crewDamageSteps ?? 0, moveBonuses.crewDamageCap),
		rollMod:   (crew?.roll ?? 1) + (moveBonuses.crewRollSteps ?? 0),
		// Extra tags the player may pick (Veteran Crew "Select 2 new tags"), added to the
		// followers-tab crew tag limit on top of the playbook's base allowance.
		tagBonus:  moveBonuses.crewTags ?? 0,
	};
}

// Animal Companion bonuses from owned Ranger moves, layered on top of the trait-derived
// base stats by the followers-tab companion card: Beast of Legend's marked "+4 HP / +1
// armor" pick (via moveBonuses), plus Magnificent Specimen's "+2 options of your choice
// each time you take this move" — i.e. 2 extra companion trait picks per owned copy.
function _buildCompanionBonuses(moveBonuses, ownedAllByName) {
	return {
		hp:         moveBonuses.companionHp    ?? 0,
		armor:      moveBonuses.companionArmor ?? 0,
		traitPicks: COMPANION_TRAIT_PICKS_PER_MAGNIFICENT_SPECIMEN * (ownedAllByName.get?.(MAGNIFICENT_SPECIMEN_MOVE)?.length ?? 0),
	};
}

function _originDescriptionForRegion(region) {
	const key = _normalizeOriginRegion(region);
	if (!key) return "";
	if (key.includes("barrier pass")) return ORIGIN_DESCRIPTIONS.barrierPass;
	if (key.includes("gordin")) return ORIGIN_DESCRIPTIONS.gordinsDelve;
	if (key.includes("lygos") || key.includes("southern") || key.includes("south")) return ORIGIN_DESCRIPTIONS.lygos;
	if (key.includes("manmarch")) return ORIGIN_DESCRIPTIONS.manmarch;
	if (key.includes("marshedge")) return ORIGIN_DESCRIPTIONS.marshedge;
	if (key.includes("steplands") || key.includes("hillfolk")) return ORIGIN_DESCRIPTIONS.steplands;
	if (key.includes("stonetop")) return ORIGIN_DESCRIPTIONS.stonetop;
	if (key.includes("wild")) return ORIGIN_DESCRIPTIONS.wild;
	return "";
}

function _normalizeOriginRegion(region) {
	return String(region ?? "")
		.toLowerCase()
		.replace(/['’]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

// Every playbook move the given background hands the character: its flat `moves` list,
// plus whichever option they took in a `setup.choices` entry that applies a move (the
// Fox's A Life of Crime grants Burgle OR Light Fingers). Both are gifts of the
// background, not advancement picks, so they have to read as background moves
// everywhere — otherwise a setup-choice move eats a slot in the level's move budget and
// the sheet warns the character has more moves than their level allows, and onboarding
// offers the move as a free pick that then silently no-ops against the grant.
// Exported so onboarding shares this rule instead of re-deriving it; `setupChoices` is
// the player's picks keyed by choice key, whatever store the caller reads them from.
export function backgroundMoveNames(background, setupChoices = {}) {
	const names = new Set(background?.moves ?? []);
	for (const choice of (background?.setup?.choices ?? [])) {
		// `apply: "possession"` choices store a possession slug, not a move name.
		if (choice.apply !== "move" || !choice.key) continue;
		const chosen = setupChoices?.[choice.key];
		if (chosen) names.add(chosen);
	}
	return names;
}

// The move names sitting in a playbook's "either X OR Y" starting-move groups (the
// Heavy's Armored OR Uncanny Reflexes). They ARE starting moves — flagged
// `isStartingMove` so they never cost a level's move pick — but only one per group is
// ever taken, so they're neither auto-granted nor safe to treat as moves the character
// is guaranteed to have. Exported so every consumer subtracts the same set.
export function startingMoveChoiceNames(groups) {
	return new Set((groups ?? []).flatMap(group => group.options ?? []));
}

// How many of a background's level-gated markable actions are unlocked at a given
// level: one per milestone level reached (Beast-Bonded marks at 1/3/5/7/9).
// Exported so onboarding (always 1st level) shares this rule instead of re-deriving it.
export function allowedMarkableActions(markable, actorLevel) {
	const levels = markable?.levels ?? [];
	return levels.filter(l => actorLevel >= l).length;
}

function _buildMarkableActions(b, savedMarkedActions, actorLevel) {
	const markable = b.markableActions;
	if (!markable?.options?.length) return null;
	const marked  = new Set(savedMarkedActions);
	const allowed = allowedMarkableActions(markable, actorLevel);
	const markedCount = markable.options.filter(o => marked.has(o.slug)).length;
	const atLimit = markedCount >= allowed;
	return {
		label:       markable.label ?? "",
		allowed,
		markedCount,
		options: markable.options.map(o => {
			const checked = marked.has(o.slug);
			return { slug: o.slug, label: o.label, checked, disabled: !checked && atLimit };
		}),
	};
}

function _buildPlaybookSection(playbookData, background, instinct, appearance, origin, lore, actorName, arcanaDisplay = null, becameHero = false, actorLevel = 1) {
	const savedBg      = background.selectedSlug || null;
	const savedChoices = background.choices;
	const savedSetupTexts = background.setupTexts ?? {};
	const savedSetupResources = background.setupResources ?? {};
	const savedMarkedActions = background.markedActions ?? [];
	const savedInstinct = instinct.selectedValue || null;
	const savedAppearance = appearance.saved;
	const savedOrigin  = origin.selected || null;

	const bgOptions = (playbookData.backgrounds ?? []).map(b => {
		const choices = b.choices ? new BackgroundChoicesSnapshotBuilder()
			.withLabel(b.choices.label)
			.withCount(b.choices.count)
			.withCountLabel(b.choices.count.join(" or "))
			.withOptions(b.choices.options.map(o =>
				new BackgroundChoiceOptionSnapshot(o.slug, o.label, !!(savedChoices?.[o.slug]))
			))
			.withSaved(savedChoices)
			.build() : null;
		return new BackgroundOptionSnapshotBuilder()
			.withSlug(b.slug)
			.withLabel(b.label)
			.withDescription(b.description ?? "")
			.withSelected(b.slug === savedBg)
			.withMoves((b.moves ?? []).map(slugify))
			.withChoices(choices)
			.withSetupTexts((b.setup?.texts ?? []).map(t => ({
				key: t.key,
				label: t.label ?? t.key,
				value: savedSetupTexts[t.key] ?? "",
			})))
			.withSetupResources((b.setup?.resources ?? []).map(r => {
				const max = r.max ?? 1;
				const current = savedSetupResources[r.key] ?? r.value ?? 0;
				return {
					key: r.key,
					label: r.label ?? r.key,
					current,
					max,
					checks: Array.from({ length: max }, (_, i) => ({
						index: i,
						checked: i < current,
					})),
				};
			}))
			.withMarkableActions(_buildMarkableActions(b, savedMarkedActions, actorLevel))
			.build();
	});

	const instinctOptions = (playbookData.instincts ?? []).map(({ word, description }) => {
		const value = composeInstinct(word, description);
		return new InstinctOptionSnapshotBuilder()
			.withWord(word)
			.withDescription(description)
			.withValue(value)
			.withSelected(savedInstinct === value)
			.build();
	});

	// The saved value rides along on each line: it is not always one of `opts` (both the
	// onboarding wizard and the Details tab let a line be written in), and the snapshot is
	// what every reader asks — so a written-in line has to be visible from it.
	const appearanceOptions = (playbookData.appearance ?? []).map((opts, i) =>
		new AppearanceLineSnapshot(i, opts.map(v =>
			new AppearanceOptionSnapshot(v, (savedAppearance?.[i]) === v)
		), savedAppearance?.[i] ?? "")
	);

	const originOptions = (playbookData.origin ?? []).map(({ region, names }) =>
		new OriginOptionSnapshot(
			region,
			names.map(name => ({ name, checked: name === actorName })),
			region === savedOrigin,
			_originDescriptionForRegion(region)
		)
	);

	return new PlaybookSnapshotBuilder()
		.withSlug(playbookData.slug)
		.withName(heroDisplayName(playbookData.name, becameHero))
		.withImg(playbookData.img ?? null)
		.withDescription(playbookData.description ?? null)
		.withStatsNote(playbookData.statsNote ?? null)
		.withLore(buildLoreSection(playbookData.lore ?? [], lore, arcanaDisplay))
		.withBackground(new BackgroundSection(savedBg, bgOptions))
		.withInstinct(new InstinctSection(savedInstinct, instinctOptions))
		.withAppearance(new AppearanceSection(appearanceOptions))
		.withOrigin(new OriginSection(savedOrigin, originOptions))
		.build();
}

// Normalize a stored mark value into an array of { stat, level } entries.
// Handles legacy shapes: a plain count (number) or an array of stat strings.
function _markEntries(stored) {
	if (Array.isArray(stored)) {
		return stored.map(e => (e && typeof e === "object")
			? { stat: e.stat ?? "", level: e.level ?? null }
			: { stat: typeof e === "string" ? e : "", level: null });
	}
	if (typeof stored === "number") return Array.from({ length: stored }, () => ({ stat: "", level: null }));
	return [];
}

// Total checked marks across a move's budgeted (non-stat) options, optionally skipping
// one slug. Drives both the render-side "used" badge and the writer-side "others
// already spent" clamp, so they always count picks the same way.
function _sumMarkPicks(moveMarks, markOptions, skipSlug = null) {
	let n = 0;
	for (const opt of markOptions) {
		if (opt.choice === "stat" || opt.slug === skipSlug) continue;
		n += _markEntries(moveMarks[opt.slug]).length;
	}
	return n;
}

// Build a move's mark options for display: stat-choice options (Potential for
// Greatness) get a stat dropdown per slot; the rest get checkbox arrays. Each
// filled slot / checked mark carries the level it was marked on.
//
// Returns `{ options, budget }`. When the move declares a `markBudget`, picks across
// its (non-stat) options are capped at a repeat-scaling total (`moveMarkBudget`):
// unchecked boxes lock once the budget is spent, and `budget = { used, max, atBudget,
// over }` drives the card's "N / max" badge. Without a markBudget both are uncapped
// (the prior behavior) and `budget` is null.
function _buildMarkOptions(entry, markCounts) {
	if (!entry.markOptions?.length) return { options: null, budget: null };
	const statList = Object.entries(_STAT_DEFS).map(([key, { abbr }]) => ({ key, abbr }));

	// Total checked across budgeted (non-stat) options — the spent picks.
	const ownedCount = entry.ownedIds?.length ?? (entry.owned ? 1 : 0);
	const max = moveMarkBudget(entry.markBudget, ownedCount);
	const used = max != null ? _sumMarkPicks(markCounts, entry.markOptions) : 0;
	const atBudget = max != null && used >= max;

	const options = entry.markOptions.map(opt => {
		const entries = _markEntries(markCounts[opt.slug]);
		const marks = opt.marks ?? 1;
		if (opt.choice === "stat") {
			const statSlots = Array.from({ length: marks }, (_, i) => {
				const sel = entries[i]?.stat ?? "";
				return {
					index: i,
					level: entries[i]?.level ?? null,
					options: [{ key: "", abbr: "—", selected: sel === "" },
						...statList.map(s => ({ key: s.key, abbr: s.abbr, selected: sel === s.key }))],
				};
			});
			return { slug: opt.slug, label: opt.label, choice: "stat", statSlots };
		}
		const count = entries.length;
		return {
			slug:   opt.slug,
			label:  opt.label,
			checks: Array.from({ length: marks }, (_, i) => ({
				index: i,
				checked: i < count,
				level: entries[i]?.level ?? null,
				// Lock an UNchecked box once the budget is spent — checked boxes always
				// stay editable so the player can free up a pick (and any grandfathered
				// over-budget mark from before the cap existed is never force-cleared).
				disabled: atBudget && !(i < count),
			})),
		};
	});

	// needsChoice: the move is owned and still has unspent picks — drives a "needs your
	// input" cue on the card (distinct from the requirements-unmet warning). False when
	// unowned (max 0), fully spent (used == max), or over budget (used > max).
	const budget = max != null
		? { used, max, atBudget, over: used > max, needsChoice: max > 0 && used < max }
		: null;
	return { options, budget };
}

function _buildMoveEntry(entry, source, moveResourcesMap, bgSlugs = new Set(), moveBackgroundAnswers = {}, improvedStatChoices = {}, moveMarksMap = {}, actorStats = {}) {
	const resourceDef = entry.resource;
	const resource = resourceDef ? new ResourceBuilder()
		.withCurrent(moveResourcesMap[entry.name] ?? 0)
		.withMax(resourceDef.max)
		.withTitle(resourceDef.title ?? null)
		.withLabels(resourceDef.labels ?? [])
		.build() : null;
	const repeat = entry.repeatable
		? { max: entry.repeatChecks.length, current: entry.ownedIds.length }
		: null;
	const requirement = entry.requiresLabel
		? new RequirementSnapshot(entry.requiresLabel, !entry.locked)
		: null;
	const sourceLabel = entry.isStarting ? (bgSlugs.has(slugify(entry.name)) ? "Background" : "Starting move") : null;

	const { options: markOptions, budget: markBudget } = _buildMarkOptions(entry, moveMarksMap[entry.name] ?? {});

	const statChoices = (entry.cap != null && entry.ownedIds.length > 0)
		? entry.ownedIds
			.map(ownedId => {
				const statKey = improvedStatChoices[ownedId] ?? null;
				if (!statKey) return null;
				return { ownedId, statKey, statAbbr: _STAT_DEFS[statKey]?.abbr ?? statKey.toUpperCase() };
			})
			.filter(Boolean)
		: null;

	// Owned Improved/Superior Stat instances that were taken but never had a stat chosen
	// (e.g. a character created before onboarding collected it) silently raise nothing.
	// Flag them so the card shows the same "needs your input" cue budgeted moves get — but
	// only when a pick is actually possible (at least one stat still below the cap).
	const unfilledStatChoices = entry.cap != null
		? entry.ownedIds.filter(ownedId => !improvedStatChoices[ownedId]).length
		: 0;
	// Only cue when a pick is actually possible. `unfilled > 0` already implies cap != null,
	// and short-circuits the stat scan when there's nothing to fill.
	const statChoiceNeeded = unfilledStatChoices > 0 && Object.values(actorStats).some(v => v < entry.cap)
		? { count: unfilledStatChoices, cap: entry.cap }
		: null;

	return new MoveSnapshotBuilder()
		.withId(entry.compendiumId)
		.withCompendiumId(entry.compendiumId)
		.withOwnedId(entry.ownedIds[0] ?? null)
		.withName(entry.name)
		.withDescription(entry.description)
		.withMoveResults(entry.moveResults ?? null)
		.withRollType(entry.rollType)
		.withRollLabel(_rollLabelForMove(entry.name, entry.rollType, entry))
		.withIsStarting(entry.isStarting)
		.withSource(source)
		.withSourceLabel(sourceLabel)
		.withOwned(entry.owned)
		.withOwnedIds(entry.ownedIds)
		.withLocked(entry.locked)
		.withRequirementsUnmet(entry.requirementsUnmet)
		.withRequirement(requirement)
		.withRequiresLabel(requirement?.label ?? null)
		.withResource(resource)
		.withRepeat(repeat)
		.withRepeatable(repeat !== null)
		.withBackgroundAnswer(moveBackgroundAnswers[entry.name] ?? null)
		.withStatChoices(statChoices)
		.withStatChoiceNeeded(statChoiceNeeded)
		.withMarkOptions(markOptions)
		.withMarkBudget(markBudget)
		.withMaxLoad(entry.maxLoad)
		.withRequiresUnarmored(entry.requiresUnarmored)
		.build();
}

// ── Snapshot helpers ──────────────────────────────────────────────────────────

/**
 * Builds a move category snapshot for a universal, compendium-sourced move list
 * (e.g. Basic Moves, Expedition Moves) — every entry is shown to every actor,
 * with ownership/roll info layered on from `ownedAllByName`.
 */
// Build a MoveSnapshot for a plain owned move Item — the "other" move-type categories and the
// post-death category, which differ only in their source type and whether the move is a starting
// move. One home for this builder chain so a new MoveSnapshot field is added once, not per copy.
function _buildOwnedItemMoveSnapshot(item, { sourceType, isStarting }) {
	return new MoveSnapshotBuilder()
		.withId(item._id)
		.withCompendiumId(item._id)
		.withOwnedId(item._id)
		.withName(item.name)
		.withDescription(item.system?.description ?? "")
		.withMoveResults(item.system?.moveResults ?? null)
		.withRollType(item.system?.rollType ?? null)
		.withRollLabel(_rollLabelForMove(item.name, item.system?.rollType, item.system))
		.withIsStarting(isStarting)
		.withSource({ type: sourceType })
		.withSourceLabel(null)
		.withOwned(true)
		.withOwnedIds([item._id])
		.withLocked(false)
		.withRequirement(null)
		.withRequiresLabel(null)
		.withResource(null)
		.withRepeat(null)
		.withRepeatable(false)
		.build();
}

function _buildCompendiumMoveCategory(entries, { key, title }, ownedAllByName) {
	if (entries.length === 0) return null;
	return new MoveCategorySnapshotBuilder()
		.withKey(key)
		.withTitle(title)
		.withNote(null)
		.withMoves(_sortOwnedFirst(entries.map(e => {
			const instances = ownedAllByName.get(e.name) ?? [];
			return new MoveSnapshotBuilder()
				.withId(e.id)
				.withCompendiumId(e.id)
				.withOwnedId(instances[0]?._id ?? null)
				.withName(e.name)
				.withDescription(e.description ?? "")
				.withMoveResults(e.moveResults ?? null)
				.withRollType(e.rollType)
				.withRollLabel(_rollLabelForMove(e.name, e.rollType, { moveType: key, description: e.description }))
				.withIsStarting(false)
				.withSource({ type: key })
				.withSourceLabel(null)
				.withOwned(instances.length > 0)
				.withOwnedIds(instances.map(i => i._id))
				.withLocked(false)
				.withRequirement(null)
				.withRequiresLabel(null)
				.withResource(null)
				.withRepeat(null)
				.withRepeatable(false)
				.build();
		})))
		.build();
}

function _rollLabelForMove(name, rollType, data = {}) {
	const normalizedRollType = normalizeRollType(rollType);
	if (!normalizedRollType) return null;
	if (data.moveType === "homefront" && HOMEFRONT_ROLL_LABELS_BY_NAME[name]) {
		return HOMEFRONT_ROLL_LABELS_BY_NAME[name];
	}
	if (data.moveType === "homefront") {
		const match = String(data.description ?? "").match(/roll\s+\+([A-Za-z][A-Za-z ]*)/i);
		if (match) return match[1].trim();
	}
	// "ask" = choose a stat each time → label it "ANY" for every move type (basic,
	// expedition, and player-authored custom "other" moves alike).
	if (normalizedRollType === "ask") return "ANY";
	return ROLL_LABELS_BY_TYPE[normalizedRollType] ?? null;
}

function _buildMovelist(categories, other, pdiLabel = null, actorLevel = 1, loveLetters = [], playbookName = null) {
	const playbookCat   = categories.find(c => c.key === "playbook");
	const basicCat      = categories.find(c => c.key === "basic");
	const expeditionCat = categories.find(c => c.key === "expedition");
	const postDeathCat  = categories.find(c => c.key === "post-death");
	const learnedCat    = categories.find(c => c.key === "learned");
	const otherCats     = categories.filter(c => !["basic", "playbook", "expedition", "post-death", "learned"].includes(c.key));
	const postDeathGroup = postDeathCat && pdiLabel
		? { label: pdiLabel, moves: postDeathCat.moves }
		: null;
	const startingNote = playbookCat?.note ?? null;
	const pickCount    = parseMovePickCount(startingNote);
	const chosenCount    = (playbookCat?.moves ?? []).filter(m => m.sourceLabel === null && m.owned).length;
	const movesIncomplete = pickCount > 0 && chosenCount < pickCount;

	// Advancement budget: every level past 1 grants one move pick, on top of the
	// `pickCount` starting "moves of your choice". Count OWNED INSTANCES of every
	// non-starting playbook move so a repeatable retake (e.g. Improved Stat taken
	// twice) counts each take, and a cross-playbook pick (Versatile) counts once —
	// the foreign move it grants lives in the Learned category and is excluded.
	// Background / auto-granted starting moves are `isStarting` and never counted.
	const chosenInstances = (playbookCat?.moves ?? [])
		.filter(m => !m.isStarting)
		.reduce((n, m) => n + (m.ownedIds?.length ?? 0), 0);
	const expectedPicks = pickCount + Math.max(0, actorLevel - 1);
	const levelMovesShortfall = Math.max(0, expectedPicks - chosenInstances);
	const levelMovesOverage = Math.max(0, chosenInstances - expectedPicks);
	// Hidden while the starting-moves onboarding prompt is still up, so the two cues
	// never stack; it surfaces once starting picks are done but the character is still
	// behind for their level (e.g. a GM-bumped or imported pre-made character). Gated on
	// a chosen playbook so a playbook-less character past level 1 never false-positives.
	const levelMovesIncomplete = !!playbookCat && !movesIncomplete && levelMovesShortfall > 0;
	const levelMovesOverLimit = !!playbookCat && levelMovesOverage > 0;
	const levelMovesOverageKey = levelMovesOverLimit
		? `${actorLevel}:${expectedPicks}:${chosenInstances}`
		: null;

	return new MovelistBuilder()
		.withPlaybookMoves(playbookCat?.moves ?? [])
		// Same moves, bucketed by the playbook's three onboarding groups so the tab can
		// head each cluster. Falls back to [] — one flat list — for a playbook the group
		// table doesn't know (homebrew, or none chosen yet).
		.withPlaybookMoveGroups(partitionMovesByGroup(playbookName, playbookCat?.moves ?? []))
		.withLearnedMoves(learnedCat?.moves ?? [])
		.withBasicMoves(basicCat?.moves ?? [])
		.withExpeditionMoves(expeditionCat?.moves ?? [])
		.withOtherGroups(otherCats.map(cat => new MoveGroupSnapshot(cat.key, cat.title, cat.moves)))
		.withOtherMoves(other)
		.withLoveLetters(loveLetters)
		.withStartingMovesNote(startingNote)
		.withPostDeathGroup(postDeathGroup)
		.withMovesIncomplete(movesIncomplete)
		.withLevelMovesIncomplete(levelMovesIncomplete)
		.withLevelMovesShortfall(levelMovesShortfall)
		.withLevelMovesOverLimit(levelMovesOverLimit)
		.withLevelMovesOverage(levelMovesOverage)
		.withLevelMovesOverageKey(levelMovesOverageKey)
		.withCharacterLevel(actorLevel)
		.build();
}


export function parseMovePickCount(note) {
	const m = (note ?? "").match(/\b(\d+)\s+(?:more\s+|other\s+)?(?:move[s]?\s+)?of\s+your\s+choice/i);
	return m ? parseInt(m[1], 10) : 0;
}

function _segmentByTwoCol(items) {
	const segments = [];
	let current = null;
	let currentType = null;
	for (const item of items) {
		const type = item.twoCol ? "grid" : "list";
		if (!current || currentType !== type) {
			current = new InventorySegmentSnapshot(type === "grid", item.breakBefore ?? false, []);
			segments.push(current);
			currentType = type;
		}
		current.items.push(item);
	}
	return segments;
}

function _sortGroup(moves, groupNames) {
	const dependents = new Map();
	const roots = [];
	for (const move of moves) {
		if (!move.requires || !groupNames.has(move.requires)) {
			roots.push(move);
		} else {
			if (!dependents.has(move.requires)) dependents.set(move.requires, []);
			dependents.get(move.requires).push(move);
		}
	}
	roots.sort((a, b) => a.name.localeCompare(b.name));
	for (const deps of dependents.values()) deps.sort((a, b) => a.name.localeCompare(b.name));
	const result = [];
	const visited = new Set();

	function visit(move) {
		if (visited.has(move.name)) return;
		visited.add(move.name);
		result.push(move);
		for (const child of dependents.get(move.name) ?? []) visit(child);
	}

	for (const root of roots) visit(root);
	moves.filter(m => !visited.has(m.name)).sort((a, b) => a.name.localeCompare(b.name)).forEach(m => result.push(m));
	return result;
}

function _sortOwnedFirst(moves) {
	const tier = m => m.owned ? 0 : m.locked ? 2 : 1;
	return [...moves].sort((a, b) => {
		const tierDiff = tier(a) - tier(b);
		if (tierDiff !== 0) return tierDiff;
		return a.name.localeCompare(b.name);
	});
}
