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
import {normalizeRollMode, tookOffer} from "../../dialogs/RollDialog.js";
import {deletionEntry} from "../../utils/foundry-compat.js";
import {appendLedgerEntries} from "../../utils/ledger-core.js";
import {statRequirementsUnmet} from "./stat-requirement.js";
import {effectiveRequiredMoves, requiredMovesUnmet, requirementLabel} from "./move-requirement.js";
import {MoveResources, learnedTrack, takeBackHeld} from "./MoveResources.js";
import {debilityData, walkItOffChoice} from "./walk-it-off.js";
import {normalizeWound as _normalizeWound, normalizeWoundList} from "./wound-record.js";
import {moveMarkBudget, markOptionCapNote} from "./move-mark-budget.js";
import {markEntries, filledMarks, filledMarkCount, trimEmptyTail, oncePerLevelCautions, ONCE_PER_LEVEL_MARKS} from "./pfg-marks.js";
import {MARK_STAT_CAPS} from "./stat-rules.js";
import {DEATHS_DOOR_FLAG, DEATHS_DOOR_STATE, FINAL_CONSEQUENCE, UNSTOPPABLE, canFaceDeathsDoor, deathsDoorRollOptions, effectiveDeathsDoorState, lostToTheGm, stateOnTakingInsert, zeroHpMove, zeroHpResolution} from "./deaths-door.js";
import {StonetopFlags, STONETOP_SCOPE, ITEM_FLAG_SCOPE, MIRRORED_HP_PENALTY_FLAG, HP_CEILING_OPTION, resolvedFlags, readableFlags, resolvedFlagProperty} from "./StonetopFlags.js";
import {heroDisplayName, WBH_HERO_FLAG} from "./WouldBeHeroAsterisk.js";
import {tookBackground} from "./took-background.js";
import {ownedNamesOr, ownedLearnedMove, ownsLearnedMoveNamed, moveLearnedIn, switchedOffGranter, ownedMoveNames, ownsMoveNamed, bookMoveName} from "./owns-move.js";
import {ANIMAL_COMPANION_MOVE, RANGER_SLUG, MAGNIFICENT_SPECIMEN_MOVE, COMPANION_TRAIT_PICKS_PER_SPECIMEN, companionTraitAllowance, trimCompanionTraits} from "./animal-companion.js";
import {fineWhiskyOffer as fineWhiskyOfferFrom, isPersuadeMove, FINE_WHISKY_SOURCE} from "./fine-whisky.js";
import {tagLoadGatedMoves} from "./load-gates.js";
import {startOfPlayGear, START_GEAR_FLAG} from "./start-of-play-gear.js";
import {RITES_OF_THE_LAND, SACRED_POUCH_SLUG, NO_POUCH_STOCK_NOTE, BLESSED_PLAYBOOK, isVessel, stockSourcesForFlags, stockCostFromDescription} from "./stock-cost.js";
import {loseHpForStock} from "./provisions.js";
import {SUPPLY_SLUGS, supplyPursesFor, spendablePurseResources as _spendablePurseResources, suppliesUsesOnMark, suppliesGiveBack} from "./supply-cost.js";
import {askWriteInSource, WRITE_IN_SOURCE} from "./write-in-source.js";
import {HOLY_LIGHT_FLAG, canWieldHolyLight, INVOKE_THE_SUN_GOD, holyLightAfterRoll, LUMINOUS_SHIELD} from "./holy-light.js";
import {moveArmor, barkskinMarkedBy} from "./move-armor.js";
import {invocationLabels} from "./ongoing-invocation.js";
import {choiceCountState} from "./initiates.js";
import {ONGOING_INVOCATION_FLAG, ONGOING_SECOND_FLAG, ONGOING_EMPOWERED_FLAG, ONGOING_SNUFF_FLAG, ONGOING_SECOND_SNUFF_FLAG,
	ONGOING_INVOCATION_FLAGS, readOngoing, readInvocationState, runningSlugs, resolveInvocationEnd, invocationEndings,
	NEEDS_SUN_FLAG, readNeedsSun} from "./ongoing-invocation.js";
import {INVOCATIONS_GRANTED_AT_FLAG} from "./invocation-count.js";
import {CONDEMNED_FLAG, CASTIGATE, PROCLAMATION, canCondemn, readCondemned, addCondemned, removeCondemned, noteCondemned} from "./condemn.js";
import {OATHS_FLAG, BINDING_ARBITRATION, canBindOaths, readOaths, addOath, removeOath, noteOath, setOathBroken} from "./oaths.js";
import {BLESSED_MARKS_FLAG, canMarkBlessed, readMarks, addMark, removeMark, noteMark, setMarkLoyalty, setMarkSign} from "./blessed-marks.js";
import {BATTLE_JOY_FLAG, BATTLE_JOY, canEnterBattleJoy, ignoresDebilities} from "./battle-joy.js";
import {CharacterBackgrounds} from "./CharacterBackgrounds.js";
import {CharacterInstincts} from "./CharacterInstincts.js";
import {CharacterAppearance} from "./CharacterAppearance.js";
import {CharacterOrigin} from "./CharacterOrigin.js";
import {CharacterPossessions} from "./CharacterPossessions.js";
import {grantsToCreate, grantSourceMap, grantAdoptionKeys, itemGrantKey, grantOfTaggedItem, grantRepair} from "./possession-grants.js";
import {CharacterInventory} from "./CharacterInventory.js";
import {maybeBeginAttack, maybeCounterOnMiss, maybeMissFx, attackMoveFor, attackFoeAdvantage, recordClashedFoes, rollMoveDamageAt, snapshotTargets} from "../../combat/attack-flow.js";
import {aimPcAskRoll} from "../../pc-asks/pc-ask-flow.js";
import {INTERFERE_MOVE, PERSUADE_PC_MOVE, PC_ASK_FLAG} from "../../pc-asks/pc-ask-rules.js";
import {brokenOaths, oathbreakerAgainst, alphaAgainst, spendAlphaOver, upAgainAgainst, spendUpAgainRoll, toughLoveAgainst, leapInOpen, HERO_MOVES} from "../../fight/hero-moves.js";
import {defendReadinessHold, defendReadinessCap, readinessCount, readinessForTier, READINESS_FLAG, DEFEND_MOVE} from "../../combat/defend-readiness.js";
import {settleReadinessOnAttack} from "../../combat/readiness-loss.js";
import {messageOfRoll, CRITICAL_TOTAL} from "../../utils/roll-engine.js";
import {cardCountedTier, cardTotal, countedTier, outcomeTier, rolledRecord, ROLLED_FLAG} from "../../utils/counted-tier.js";
import {ANGER_IS_A_GIFT, A_FORCE_TO_BE_RECKONED_WITH, SPEAK_TRUTH_TO_POWER, forceTurnedTables, righteousAngerSubtitle, speakTruthRefusedActions} from "./would-be-hero-cards.js";
import {shippedRapportTrack} from "./up-with-people.js";
import {foldModes, layModes} from "../../utils/roll-mode.js";
import {fightStateActive, revealOnAttack, WE_HAPPY_FEW} from "./fight-states.js";
import {spendSurpriseForRoll} from "../../combat/battle-holds.js";
import {settleTierEffects, recordTierEffects, reconcileTierEffects} from "./tier-effects.js";
import {xpToLevelUp, withXpLock} from "../../utils/xp.js";
import {CharacterArcana} from "./CharacterArcana.js";
import {seekerArcanaState, seekerArcanaChosen, seekerCardRoles, majorMarkBoxes, withMinorRole, seekerMajorSwitchPlan, seekerMajorOwed} from "./seeker-collection.js";
import {CharacterLore} from "./CharacterLore.js";
import {CharacterPostDeath, buildLoreSection, insertHpPenalty} from "./CharacterPostDeath.js";
import {isPostDeathMove, planLoreMoveSync, postDeathMoveItemData} from "./post-death-moves.js";
import {effectiveSubgroupMax, sumMoveBonus} from "./dialogs/possession-choice-cap.js";
import {partitionMovesByGroup} from "./dialogs/onboarding-move-groups.js";
import {backgroundMarkOption, hasBackgroundMarkOptions, moveChoiceKey} from "./dialogs/well-versed-topics.js";
import {FoundryRepositoryFactory} from "./repositories/FoundryRepositoryFactory.js";
import {capitalizeFirst, slugify, composeInstinct, escHtml, joinNames, splitNames, stripHtmlToText} from "../../utils/strings.js";
import {splitFillBlank, fillBlank} from "../../utils/fill-blanks.js";
import {localize as _loc, format} from "../../utils/i18n.js";
import {getStonetopSteadingActor, effectiveProsperity, FALLBACK_FOUR_PLUS_PROSPERITY} from "../../utils/world.js";
import {readCurrentSeason} from "../../seasons/current-season.js";
import {seasonLabel} from "../../seasons/seasons-change-reminders.js";
import {moveChatCard, postMoveNote} from "../../utils/chat.js";
import {normalizeRollType} from "../../utils/roll-types.js";
import {buildCustomMoveData, clampInt} from "../../utils/custom-move-data.js";
import {buildInventoryItemData, readInventoryItemData, WRITEUP_EDITED_FLAG} from "../../utils/inventory-item-data.js";
import {ARTIFACT_STATE, concealArtifactFields, isArtifactUpgrade, normalizeArtifactState} from "./artifact-identify.js";
import {isLoveLetter, isResolvedLoveLetter} from "./love-letters.js";
import {deriveLoadLevel, loadLimitsFor} from "../../utils/load.js";
import {maxDie, stepDie, normalizeDamageDie} from "../../utils/damage-die.js";
import {WEAPONS_OF_WAR_COMMON, WEAPONS_OF_WAR_PIERCING, ALL_IN_THE_WRIST} from "../../data/weapons.js";
import {X_PIERCING_MAX} from "../../utils/damage.js";
import {healTo} from "../../camp/camp-rules.js";
import {recoveredHpTo, slowToHeal} from "./deaths-door-actor.js";
import {LEARNED_OPTION} from "../../timeline/timeline-milestones.js";
import {inTurn} from "../../utils/turn-queue.js";
import {isGear} from "../../migration/superseded-values.js";
import {StonetopSteading} from "../steading/StonetopSteading.js";
import {rulesHas} from "../steading/improvement-rules.js";

/**
 * The state a playbook move leaves on a character, and whether anything they hold still makes it:
 * `held(actor, owned)` with the render's `ownedMoveNames` Set. The ONE list, read two ways: a
 * `glyph` is the header glyph that shows the state (headerGlyphOwnership), and once a playbook
 * change leaves nothing that can make it, its `flags` go (clearPlaybookData).
 */
const MOVE_STATE = [
	{ glyph: "holyLight", held: canWieldHolyLight, flags: [HOLY_LIGHT_FLAG] },
	{ glyph: "condemn",   held: canCondemn,        flags: [CONDEMNED_FLAG] },
	{ glyph: "oaths",     held: canBindOaths,      flags: [OATHS_FLAG] },
	{ glyph: "battleJoy", held: canEnterBattleJoy, flags: [BATTLE_JOY_FLAG] },
	{ glyph: "blessed",   held: canMarkBlessed,    flags: [BLESSED_MARKS_FLAG] },
	// "invocations" is the whole bag: the learned list, and the ones waiting on the sun
	// (NEEDS_SUN_FLAG, `invocations.needsSun`) with it.
	{ held: (actor, owned) => ownedNamesOr(actor, owned).has(INVOKE_THE_SUN_GOD), flags: ["invocations", ...ONGOING_INVOCATION_FLAGS] },
];

/**
 * Backgrounds that give advantage on one move, always. The Blessed's Raised by Wolves: "Also,
 * when you Forage, you have advantage." A SOURCE like any other (see foldAdvantage), so the
 * winter's disadvantage on the same Forage cancels it and the roll goes straight.
 */
const BACKGROUND_MOVE_ADVANTAGE = [
	{ background: { playbook: BLESSED_PLAYBOOK, slug: "raised-by-wolves" }, move: "Forage", source: "Raised by Wolves" },
];

/**
 * Seasons that give disadvantage on one move, always. Forage: "In winter, you have disadvantage."
 * Read off the steading's clock (seasons/current-season.js#readCurrentSeason), so the player no
 * longer sets it by hand. A SOURCE like the background's advantage (see foldDisadvantage), so the
 * two cancel, and a Disadvantage the player picked for the same winter does not count twice.
 */
const SEASON_MOVE_DISADVANTAGE = [
	{ season: "winter", move: "Forage" },
];

/**
 * Lines the roll window offers UNTICKED on a move, for a clause only the player can judge: the
 * Heavy's Intimidating ("When you Persuade using violence or threats, you have advantage"), Husbandry
 * tools ("Gain advantage to Persuade domestic beasts (livestock, dogs, etc.)", the Heavy, the Ranger
 * and the Would-Be Hero) and Stone Cold ("When you Defy Danger ... by keeping calm and carrying on,
 * treat a 6- as a 7-9"; its Struggle as One half is struggle/struggle-rules.js's). And the Judge's:
 * Legacy ("When you Know Things about the people or history of Stonetop, you have advantage"), For the
 * Greater Good ("When you Persuade someone to act in defense of their community or civilization at
 * large, you have advantage"), The Tower Eternal ("When you Defy Danger against magic, treat a result
 * of 6- as a 7-9"; its Struggle as One half is struggle-rules.js's too) and the helm set with a dark ice
 * "jewel" ("Grants advantage to resist mind-affecting magic"). And the Lightbearer's: Radiant
 * Countenance ("When you give someone your fond attention, you can then Persuade them with advantage")
 * and Soul on Fire ("When you Persuade a group by preaching charity, mercy, and hope and roll a 7+,
 * aside from the usual effect, choose 1: Your name and your message spread / Someone approaches you,
 * now or later, eager to know more"). And the Ranger's: Naturalist ("When you Know Things about beasts,
 * natural environs, or spirits of the wild, you have advantage"; the arcana identify roll asks it in its
 * own picker, arcana-identify.js#KNOW_THINGS_ADVANTAGE_MOVES, so its window leaves the line out), Home on the
 * Range ("When a journey requires you to Defy Danger or Struggle as One, treat a 6- as a 7-9"), Trailblazer
 * ("When a journey causes you to Defy Danger or Struggle as One, on a 10+ you also learn or discover
 * something interesting and useful"; both Struggle as One halves are struggle-rules.js's) and Constant
 * Vigilance ("Unless you're dazed ... When you intercept a sudden threat (to yourself or an ally), you
 * have advantage on whatever move you make"), on every move roll. And the Seeker's: Let's Make a Deal ("When
 * you Persuade by offering them something that you know they want or need, treat a 7-9 as a 10+"; its
 * Seek Insight question is move-pick-bonuses.js's), Polyglot ("When you Know Things about any script,
 * text, runes or symbols that you encounter, you have advantage"), Proof Against Detection ("When you
 * hold Protection, you ... have advantage to Defy Danger by being stealthy") and Safety First ("When you
 * are affected by harmful magic, spend 1 Protection either to gain advantage on any roll to resist it or
 * to halve its damage/effects"; the halving is the damage card's, fight/defend-spend.js). And the
 * Would-Be Hero's: Speak Truth to Power ("When you demand that someone does what is clearly good and
 * right, you have advantage to Persuade. If they refuse, gain +1 Resolve"; the refusal is a button on the
 * card, would-be-hero-cards.js), Better Part of Valor ("When you are outnumbered or facing a foe bigger
 * than you, you have advantage to hide from, escape from, or sneak past them"), Underestimated ("When you
 * first make your move against an enemy who underestimates you, you have advantage"), on every move roll, and
 * A Force to Be Reckoned With ("When you Defy Danger against something trying to harm or constrain you,
 * on a 12+ you turn the tables on them").
 *
 * A row rides the moves its `moves(name)` answers for, by the name the roll is made under: `() => true`
 * is a row of every move roll (Constant Vigilance, Underestimated), a roll with no move item behind it (a
 * guided move, Improvise: directRollOffers) included, but never a bare stat roll, which is no move.
 *
 * A row applies to a character who has `ownsLearned` LEARNED, took the `background` (took-background.js),
 * holds the special possession `possession`, has picked AND carries (the ◇) the gear choice
 * `possessionChoice`, keyed `possession:choice` as the carry marks are, or has the worn insert's lore
 * option `postDeathLore` marked ("consequences:disturbing"); and never while the debility
 * `unlessDebility` is marked, nor while the learned move `whileHolding` holds nothing on its track
 * (Safety First's Protection). `spendHeld` names that track: taken, the line spends 1 of it after the
 * dice. Taken, a line's `source` is folded in as advantage and named on the card, unless its `effect`
 * says otherwise (see _foldTakenOffers): "missAsPartial" counts a 6- as a 7-9 instead, "partialAsSuccess" a 7-9
 * as a 10+, "hitNote" buys no advantage but prints its `note` on the card's 10+ and 7-9 rows,
 * "successNote" the same on the 10+ row alone, and "criticalNote" on the 10+ row only when the total is
 * 12+ (roll-engine's `criticalActions`), calling its `onCritical(actor, message)` when it does. A row's
 * `tierActions()` adds its own buttons to the card's tier rows once taken, whatever its effect.
 */
const FICTION_ROLL_OFFERS = [
	{ key: "intimidating", moves: isPersuadeMove, ownsLearned: "Intimidating",
		source: "Intimidating", label: "stonetop.rollOffers.intimidating" },
	{ key: "husbandry-tools", moves: name => name === "Persuade (vs. NPCs)", possession: "husbandry-tools",
		source: "Husbandry tools", label: "stonetop.rollOffers.husbandryTools" },
	{ key: "stone-cold", moves: name => name === "Defy Danger", ownsLearned: "Stone Cold",
		source: "Stone Cold", label: "stonetop.rollOffers.stoneCold", effect: "missAsPartial" },
	{ key: "legacy", moves: name => name === "Know Things", background: { playbook: "The Judge", slug: "legacy" },
		source: "Legacy", label: "stonetop.rollOffers.legacy" },
	{ key: "for-the-greater-good", moves: isPersuadeMove, ownsLearned: "For the Greater Good",
		source: "For the Greater Good", label: "stonetop.rollOffers.forTheGreaterGood" },
	{ key: "tower-eternal", moves: name => name === "Defy Danger", ownsLearned: "The Tower Eternal",
		source: "The Tower Eternal", label: "stonetop.rollOffers.towerEternal", effect: "missAsPartial" },
	{ key: "judge-helm", moves: name => name === "Defy Danger", possessionChoice: "symbol-of-authority:helm",
		source: "Helm", label: "stonetop.rollOffers.judgeHelm" },
	{ key: "radiant-countenance", moves: isPersuadeMove, ownsLearned: "Radiant Countenance",
		source: "Radiant Countenance", label: "stonetop.rollOffers.radiantCountenance" },
	{ key: "soul-on-fire", moves: name => name === "Persuade (vs. NPCs)", background: { playbook: "The Lightbearer", slug: "soul-on-fire" },
		source: "Soul on Fire", label: "stonetop.rollOffers.soulOnFire", effect: "hitNote", note: "stonetop.rollOffers.soulOnFireNote" },
	{ key: "naturalist", moves: name => name === "Know Things", ownsLearned: "Naturalist",
		source: "Naturalist", label: "stonetop.rollOffers.naturalist" },
	{ key: "home-on-the-range", moves: name => name === "Defy Danger", ownsLearned: "Home on the Range",
		source: "Home on the Range", label: "stonetop.rollOffers.homeOnTheRange", effect: "missAsPartial" },
	{ key: "trailblazer", moves: name => name === "Defy Danger", ownsLearned: "Trailblazer",
		source: "Trailblazer", label: "stonetop.rollOffers.trailblazer", effect: "successNote", note: "stonetop.rollOffers.trailblazerNote" },
	{ key: "constant-vigilance", moves: () => true, ownsLearned: "Constant Vigilance", unlessDebility: "dazed",
		source: "Constant Vigilance", label: "stonetop.rollOffers.constantVigilance" },
	{ key: "lets-make-a-deal", moves: isPersuadeMove, ownsLearned: "Let's Make a Deal",
		source: "Let's Make a Deal", label: "stonetop.rollOffers.letsMakeADeal", effect: "partialAsSuccess" },
	{ key: "polyglot", moves: name => name === "Know Things", ownsLearned: "Polyglot",
		source: "Polyglot", label: "stonetop.rollOffers.polyglot" },
	{ key: "proof-against-detection", moves: name => name === "Defy Danger", ownsLearned: "Proof Against Detection",
		whileHolding: HERO_MOVES.SAFETY_FIRST, source: "Proof Against Detection", label: "stonetop.rollOffers.proofAgainstDetection" },
	{ key: "safety-first", moves: name => name === "Defy Danger", ownsLearned: HERO_MOVES.SAFETY_FIRST,
		whileHolding: HERO_MOVES.SAFETY_FIRST, spendHeld: HERO_MOVES.SAFETY_FIRST, source: HERO_MOVES.SAFETY_FIRST, label: "stonetop.rollOffers.safetyFirst" },
	{ key: "speak-truth-to-power", moves: isPersuadeMove, ownsLearned: SPEAK_TRUTH_TO_POWER,
		source: SPEAK_TRUTH_TO_POWER, label: "stonetop.rollOffers.speakTruthToPower", tierActions: speakTruthRefusedActions },
	{ key: "better-part-of-valor", moves: name => name === "Defy Danger", ownsLearned: "Better Part of Valor",
		source: "Better Part of Valor", label: "stonetop.rollOffers.betterPartOfValor" },
	{ key: "underestimated", moves: () => true, ownsLearned: "Underestimated",
		source: "Underestimated", label: "stonetop.rollOffers.underestimated" },
	{ key: "force-to-be-reckoned-with", moves: name => name === "Defy Danger", ownsLearned: A_FORCE_TO_BE_RECKONED_WITH,
		source: A_FORCE_TO_BE_RECKONED_WITH, label: "stonetop.rollOffers.forceToBeReckonedWith",
		effect: "criticalNote", note: "stonetop.rollOffers.forceToBeReckonedWithNote", onCritical: forceTurnedTables },
	// Two Consequences of the dead: "When you use intimidation and your disturbing presence to Persuade, you
	// have advantage" (the Ghost's Disturbing) and "...your sinister appearance to Persuade" (the Revenant's
	// Deathly Visage). Asked of the worn insert's marked lore, `postDeathLore`, rather than of a move.
	{ key: "disturbing", moves: isPersuadeMove, postDeathLore: "consequences:disturbing",
		source: "Disturbing", label: "stonetop.rollOffers.disturbing" },
	{ key: "deathly-visage", moves: isPersuadeMove, postDeathLore: "consequences:deathly-visage",
		source: "Deathly Visage", label: "stonetop.rollOffers.deathlyVisage" },
];

/** The Ghost's and the Revenant's UNSTABLE, as its count is keyed in their lore (see _foldStandingNotes). */
const UNSTABLE_LORE = "consequences:unstable";

/** The card rows a taken note-only offer prints on, by its `effect` (see _withHitNote). */
const NOTE_OFFER_TIERS = { hitNote: ["success", "partial"], successNote: ["success"] };

/** Each tier's `html` added after whatever that tier row of the roll already carries. */
function _withTierActions(options, actions) {
	const merged = { ...(options.tierActions ?? {}) };
	for (const [tier, html] of Object.entries(actions ?? {})) if (html) merged[tier] = `${merged[tier] ?? ""}${html}`;
	return { tierActions: merged };
}

/**
 * A taken "criticalNote" roll offer (A Force to Be Reckoned With): no advantage, its `note` printed on the
 * 10+ row of a roll that totals 12+ (roll-engine's `criticalActions`), and the line named on the card.
 */
function _withCriticalNote(options, offer) {
	return {
		criticalActions: `${options.criticalActions ?? ""}<p class="stonetop-roll-offer-note">${offer.note ?? ""}</p>`,
		conditionNotes: [...(options.conditionNotes ?? []), offer.source],
	};
}

/**
 * The roll window's line for Binding Arbitration on a roll aimed at nobody: "If they have broken their
 * word, you gain advantage on all rolls against them". A roll aimed at someone asks the oath itself
 * (onRoll, _foldAimedModes, fight/hero-moves.js#oathbreakerAgainst), so this is offered only when nobody
 * is targeted: on a move roll, and on a bare stat roll too (directRollOffers).
 */
const BINDING_ARBITRATION_OFFER = "binding-arbitration";

/**
 * Advantage from somewhere other than the picker, folded into a roll's options and NAMED on the card.
 *
 * The one shape it takes, whatever bought it: a promise made at a peaceful camp, a grudge a foe owes
 * (Relentless, But I Get Up Again). Advantage and disadvantage cancel (p.230), so a roll that already
 * had disadvantage rolls straight instead; the note is added either way, so a cancellation reads as a
 * trade rather than as a mode that quietly vanished.
 */
function foldAdvantage(options, source) {
	return {
		...layModes(options, ["adv"]),
		conditionNotes: [...(options.conditionNotes ?? []), source],
	};
}

/**
 * A taken "hitNote" roll offer (Soul on Fire): no advantage, but its `note` rides the card's 10+ and 7-9
 * rows (roll-engine's tierActions, which a GM's Shift Up/Down reveals with the tier), and the line is
 * named on the card as every taken offer is. Added to whatever tier rows the roll already carries. A
 * "successNote" (Trailblazer) rides the 10+ row alone.
 */
function _withHitNote(options, offer) {
	const note = `<p class="stonetop-roll-offer-note">${offer.note ?? ""}</p>`;
	const actions = { ...(options.tierActions ?? {}) };
	for (const tier of NOTE_OFFER_TIERS[offer.effect]) actions[tier] = `${actions[tier] ?? ""}${note}`;
	return { tierActions: actions, conditionNotes: [...(options.conditionNotes ?? []), offer.source] };
}

/**
 * The lines the roll window offered that the player left ticked (`takenOffers`, their keys), for both roll
 * paths, onRoll and onDirectStatRoll. `offered` is those lines as the window was handed them, so they are
 * not worked out twice; a caller that passes none has them worked out by `offersOf`. None from a caller
 * that asked no window: a line the player never saw is never spent. Binding Arbitration's line is dropped
 * when the roll's aim has already asked the oath (`oathbreakerNamed`), so it is named once.
 */
async function _takenOffers(takenOffers, offered, offersOf, { oathbreakerNamed = false } = {}) {
	if (!takenOffers?.length) return [];
	return (offered ?? await offersOf()).filter(offer => tookOffer(offer, takenOffers)
		&& !(oathbreakerNamed && offer.key === BINDING_ARBITRATION_OFFER));
}

/**
 * `options` with the taken lines folded in, each as its `effect` says (FICTION_ROLL_OFFERS): a SOURCE of
 * advantage by default, so it nets against a disadvantage; Stone Cold's buys none and counts a 6- as a 7-9,
 * named on the card as Herd of Horses is, and Let's Make a Deal's a 7-9 as a 10+ the same way; a note
 * line prints its note on the tiers it names. And a line's own buttons (Speak Truth to Power's "They
 * refused"), on the tiers it names.
 */
function _foldTakenOffers(options, taken) {
	const folded = { ...options };
	for (const offer of taken) {
		if (NOTE_OFFER_TIERS[offer.effect]) Object.assign(folded, _withHitNote(folded, offer));
		else if (offer.effect === "missAsPartial") folded.missCountsAsPartial = offer.source;
		else if (offer.effect === "partialAsSuccess") folded.partialCountsAsSuccess = offer.source;
		else if (offer.effect === "criticalNote") Object.assign(folded, _withCriticalNote(folded, offer));
		else Object.assign(folded, foldAdvantage(folded, offer.source));
		if (offer.tierActions) Object.assign(folded, _withTierActions(folded, offer.tierActions));
	}
	return folded;
}

/**
 * What the taken lines cost, paid once the dice have landed (a use of whisky marked, a Protection spent),
 * `moveName` being the move the ledger files it under. And a "criticalNote" line whose 12+ came up (A
 * Force to Be Reckoned With turned the tables): its hook, with the card (would-be-hero-cards.js#forceTurnedTables).
 * Nothing for a roll that never happened.
 */
async function _payTakenOffers(taken, roll, moveName) {
	if (!roll) return;
	for (const offer of taken) await offer.spend?.(moveName);
	if (Number(roll.total) >= CRITICAL_TOTAL) {
		for (const offer of taken) if (offer.effect === "criticalNote") await offer.onCritical?.(messageOfRoll(roll));
	}
}

/** The other side of foldAdvantage: disadvantage imposed from outside the picker, named on the card. */
function foldDisadvantage(options, source) {
	return {
		...layModes(options, ["dis"]),
		conditionNotes: [...(options.conditionNotes ?? []), source],
	};
}

/**
 * Run `fn` once every claim already queued for `actor` on this client has settled (turn-queue.js#inTurn,
 * one line per actor; see StonetopCharacter#_claimNextRollOwed), so two rolls started together (a
 * double-click, a second move rolled while the first's dice still animate) read the +forward and the
 * held promises one after the other: the second reads what the first left.
 */
function _inRollTurn(actor, fn) {
	if (!actor || typeof actor !== "object") return fn();
	return inTurn(`roll:${actor.uuid ?? actor.id ?? ""}`, fn);
}

/**
 * The names a held promise was laid under (StonetopCharacter#heldAdvantage), as the list they are
 * stored as: `{sources: ["A peaceful night's rest", "Aeliana's Aid"]}`.
 *
 * A flag written before that holds ONE string, joined for display (`{source: "A peaceful night's rest
 * & Aeliana's Aid"}`), and is cut back into its names here, on read, the one place splitNames is still
 * used. Cut rather than kept whole because a whole "A peaceful night's rest & Dewi's Aid" would read
 * as one Aid (follower-deaths-door.js#aidAdvantageSources) and spend the night's rest with it; an old
 * name with its own ", " or " & " is cut too, which only stops it being taken back by name before the
 * next roll spends it. Every write lays the list.
 */
function heldSources(held) {
	if (!held || typeof held !== "object") return [];
	const parts = Array.isArray(held.sources) ? held.sources : splitNames(held.source);
	return parts.map(part => String(part ?? "").trim()).filter(Boolean);
}

/**
 * More promises laid beside those held, as one list: blanks drop out, and a name promised twice is
 * held once. `added` is one name or several (a camp's peaceful night and fur-lined bedroll, a refund).
 */
function mergeSources(held, added) {
	const parts = [...new Set([...held, ...[added].flat()].map(part => String(part ?? "").trim()).filter(Boolean))];
	return parts.length ? parts : ["a promise"];
}

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
	// The Destined's Omens of Fate rolls the Omens held, not a stat (destined.js).
	omens: "Omens",
	// A love letter can roll the steading's Fortunes (love-letters.js).
	fortunes: "Fortunes",
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

// Total a numeric `system.<field>` across every LEARNED move the actor owns, and name the
// moves that actually contributed, in sheet order. The shared spine of _ownedLoadBonus /
// _ownedShieldLoadReduction (and any future per-move bonus), so the "skip un-learned moves"
// rule lives in exactly one place and can't be forgotten -- and so a note naming the source
// can never disagree with the total it explains, since both come off the same single pass.
function _learnedMoveField(actor, field) {
	let total = 0;
	const names = [];
	for (const i of actor.items) {
		if (i.type !== "move" || !moveLearnedIn(i, actor.items)) continue;
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
// The Mill: "when you Outfit from Stonetop or Have What You Need after doing so, each ◆ of
// supplies has 1 extra use." Completing it also writes "Mill" onto the Resources list, which a
// GM may have done by hand instead, so either counts, the way Weapons of War reads.
const _MILL_IMPROVEMENT = "mill";
const _MILL_RESOURCE = "Mill";

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
	// The Inventory insert's Prosperity table: -1 "Gear is crude", +1 "x = 1 piercing", +2 "x = 2
	// piercing", and no higher row. damage.js#resolvePiercing counts the same way.
	if (prosperity <= -1) return note.replace(marker, '<em>crude</em>');
	return note.replace(marker, `${Math.min(prosperity, X_PIERCING_MAX)} <em>piercing</em>`);
}

// A battleaxe's or sword's note once the steading has Weapons of War: the item's own tags plus the
// improvement's "x piercing", for _transformPiercingNote to resolve against Prosperity.
function _withWeaponsOfWarPiercing(item, weaponsOfWar) {
	const note = item?.note ?? "";
	if (!weaponsOfWar || !WEAPONS_OF_WAR_PIERCING.has(item?.slug) || /piercing/i.test(note)) return note;
	return note ? `${note}, x <em>piercing</em>` : "x <em>piercing</em>";
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

// A gear-choice row (StonetopCharacter#_buildChoiceGearByPossession) as one line of plain text:
// the whole printed label, with what the player wrote into its blank ("A shield, bearing Aratis's
// crest") and the blank left showing when they have written nothing.
function _choiceGearText(row) {
	const text  = stripHtmlToText(row?.fullLabel ?? row?.label ?? "");
	const blank = splitFillBlank(text);
	return blank.hasBlank && row?.fillValue ? `${blank.before}${row.fillValue}${blank.after}` : text;
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

// The Defend basic move holds Readiness (p.216) — the only move with the on-sheet
// circle track; the Heavy's Guardian move sweetens each hold by +1 (and so needs no
// circle of its own — it just adds one to Defend's track).
const _DEFEND_MOVE_NAME = DEFEND_MOVE;
const _GUARDIAN_MOVE_NAME = "Guardian";
// Held Defend Readiness lives in a flag on the actor (READINESS_FLAG, combat/defend-readiness.js),
// mirroring how followers store theirs under readiness paths in _FOLLOWER_FLAGS.

// The playbook slug whose PRESELECTED possessions ensurePossessionGrants last walked. Lets the
// ready-time back-fill bail without the pack lookup once they are done; a playbook change clears it.
const POSSESSION_PRESELECTED_WALKED_FLAG = "possessionGrantsPreselected";

// The Armored move ("carry a shield, mark only ◆ instead of ◆◆") drops a carried shield's
// ◇ load by its `shieldLoadReduction`. Like loadBonus, the mechanic lives in the move's data
// so buildSnapshot never hard-codes a move name.
function _ownedShieldLoadReduction(actor) {
	return _learnedMoveField(actor, "shieldLoadReduction").total;
}

// What a shield's ◇ cost becomes once Armored is applied to it. ONE rule for every shield,
// whichever store it came from: the outfit catalog's, an `inventory-custom` item's (write-ins,
// grantsItems, dropped treasures) and a special possession's gear choice all ask here. Being a shield already means two other things: it carries armor, and it buys "+1
// Readiness on a Defend 7+" — and each of those is answered in exactly one place; the load was the
// odd one out, answered only for outfit items, so a Judge with Armored still paid ◇◇ for their
// Makerglass shield.
function _shieldAdjustedWeight(weight, isShield, reduction) {
	const w = Number(weight) || 0;
	// A weightless shield has no ◇ to give back, and flooring it at 1 would make the move ADD
	// load. Only a shield that actually costs something is reduced.
	if (!isShield || !(reduction > 0) || w <= 0) return w;
	return Math.max(1, w - reduction);
}

// Whether any carried gear is a shield, over _gearSources' `{items, marks}`. Sync, so the armor
// arithmetic (_armorFrom, which A Candle Against the Dark's "otherwise unarmed" reads) and the async
// bearsShield share it.
function _carriesShield(gear) {
	const marks = gear?.marks ?? {};
	return (gear?.items ?? []).some(i => i.shield && marks[i.slug]);
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

	// Whether the character has the 6 + twice-their-level XP that Level Up costs right now.
	get canLevelUp() {
		return (this._actor.system?.attributes?.xp?.value ?? 0) >= xpToLevelUp(this._characterLevel);
	}

	// Potential-for-Greatness stat slot: choosing a stat writes +1 to that stored
	// stat (and reverts the previously chosen one), recording the level it was
	// marked on. Newly filled slots auto-fill the current level. A slot is stored at its index, so
	// the slots before it are padded empty; the empty ones left at the END (the last pick undone)
	// are dropped, so what is stored reads as the marks it holds (pfg-marks.js#filledMarks).
	async setStatSlot(moveName, optionSlug, index, newStat) {
		const entries = markEntries(this._moveResources.getMarks()[moveName]?.[optionSlug]);
		while (entries.length <= index) entries.push({ stat: "", level: null });
		const oldStat = entries[index].stat ?? "";
		if (oldStat === newStat) return;
		const stats = this._actor.system?.stats ?? {};
		const updates = {};
		if (oldStat && stats[oldStat]) updates[`system.stats.${oldStat}.value`] = (stats[oldStat].value ?? 0) - 1;
		if (newStat && stats[newStat]) updates[`system.stats.${newStat}.value`] = (stats[newStat].value ?? 0) + 1;
		entries[index] = { stat: newStat, level: newStat ? (oldStat ? entries[index].level : this._characterLevel) : null };
		// One document write: the stat deltas and the mark record together.
		await this._actor.update({ ...updates, ...this._moveResources.markUpdate(moveName, optionSlug, trimEmptyTail(entries)) });
	}

	// Checkbox mark options (e.g. max HP, damage die): set how many are checked,
	// auto-filling the current level on newly checked marks. When the move declares a
	// `markBudget`, an INCREASE is clamped so the picks across all its options never
	// exceed the repeat-scaling budget — model-side enforcement so the cap holds from
	// any write surface, not just the disabled checkboxes (mirrors the possession
	// remarkable-trait cap in selectSubChoice). Decreases are never clamped, so a
	// grandfathered over-budget mark can always be cleared.
	//
	// An increase is also clamped to the option's own boxes (`marks`), less the box the
	// background fills (the Patriot's Things Below is Well Versed's, outside the budget):
	// that box can't be marked again. A duplicate already stored is kept, never cleared.
	async setCountMark(moveName, optionSlug, newCount) {
		const allMarks = this._moveResources.getMarks();
		const current  = markEntries(allMarks[moveName]?.[optionSlug]).length;
		// Clamp an INCREASE to the move's repeat-scaling pick budget (if any); a decrease
		// is left as-is (budget null below), so a grandfathered over-budget mark clears.
		let count = newCount;
		const def = newCount > current ? await this._moveMarkDefinition(moveName) : null;
		const max = def ? moveMarkBudget(def.markBudget, def.ownedCount) : null;
		if (max != null) {
			const others    = _sumMarkPicks(allMarks[moveName] ?? {}, def.markOptions, optionSlug);
			const remaining = Math.max(0, max - others);             // picks still free across the move's options
			count = Math.min(newCount, Math.max(current, remaining)); // never below what's already checked
		}
		const opt = def?.markOptions.find(o => o.slug === optionSlug);
		if (opt) {
			// Only a move a background can answer with a box reads the playbook for it (Well Versed).
			const fromBackground = hasBackgroundMarkOptions(moveName)
				&& (await this.backgroundMarkOptions())[moveName] === optionSlug ? 1 : 0;
			count = Math.min(count, Math.max(current, (opt.marks ?? 1) - fromBackground));
		}
		const entries = markEntries(allMarks[moveName]?.[optionSlug]);
		while (entries.length < count) entries.push({ stat: "", level: this._characterLevel });
		entries.length = Math.max(0, count);
		await this._actor.update(this._moveResources.markUpdate(moveName, optionSlug, entries));
	}

	/**
	 * The option of `moveName` onboarding marked, or "" when none is: its pick of Well Versed's "1
	 * topic, in addition to the one noted in your Background". That is the entry stored with
	 * `creation`, else (a character made before onboarding stamped it, or one who ticked the topic
	 * by hand at 1st level, which is the same pick) the first entry marked at 1st level. A level-up's
	 * marks carry the level gained (2 and up), so they are never it.
	 */
	creationMarkOption(moveName) {
		return this._creationMarkEntry(moveName)?.slug ?? "";
	}

	// Where creationMarkOption's mark is stored: its option and its index there, or null.
	_creationMarkEntry(moveName) {
		const marks = Object.entries(this._moveResources.getMarks()[moveName] ?? {})
			.map(([slug, stored]) => [slug, markEntries(stored)]);
		for (const test of [e => e.creation, e => e.level === 1]) {
			for (const [slug, entries] of marks) {
				const index = entries.findIndex(test);
				if (index >= 0) return { slug, index };
			}
		}
		return null;
	}

	/**
	 * Make `optionSlug` onboarding's mark of `moveName` (the extra Well Versed topic): the ONE mark
	 * creationMarkOption reads goes, every other mark stays, and the new one goes through
	 * setCountMark, so the budget and the background's box hold. Stored at 1st level with
	 * `creation`, whatever level a re-run happens at, so the next re-run finds it. An empty slug
	 * only clears.
	 */
	async setCreationMark(moveName, optionSlug) {
		const was = this._creationMarkEntry(moveName);
		if (was) {
			const entries = markEntries(this._moveResources.getMarks()[moveName]?.[was.slug]);
			entries.splice(was.index, 1);
			await this._actor.update(this._moveResources.markUpdate(moveName, was.slug, entries));
		}
		if (!optionSlug) return;
		const current = markEntries(this._moveResources.getMarks()[moveName]?.[optionSlug]).length;
		await this.setCountMark(moveName, optionSlug, current + 1);
		const entries = markEntries(this._moveResources.getMarks()[moveName]?.[optionSlug]);
		if (entries.length <= current) return;
		entries[entries.length - 1] = { ...entries[entries.length - 1], level: 1, creation: true };
		await this._actor.update(this._moveResources.markUpdate(moveName, optionSlug, entries));
	}

	// A held move's markBudget and markOptions, off its pack definition first and its owned copy
	// after, with how many copies are held; null when none is.
	async _moveMarkDefinition(moveName) {
		const owned = this._actor.items.filter(i => i.type === "move" && i.name === moveName);
		if (!owned.length) return null;
		const def = await this._packMoveDefinition(owned[0]);
		return {
			markBudget:  def?.markBudget  ?? owned[0].system?.markBudget  ?? null,
			markOptions: def?.markOptions ?? owned[0].system?.markOptions ?? [],
			ownedCount:  owned.length,
		};
	}

	// An owned move's definition in its playbook's pack (by name), or null.
	async _packMoveDefinition(item) {
		const pbName = item.system?.playbook ?? null;
		const defs   = pbName ? await this._moveRepo.getPlaybookMoves(pbName) : [];
		return defs.find(d => d.name === item.name) ?? null;
	}

	/**
	 * The mark box each background answer fills, by move name: the Patriot's "Well Versed in the
	 * Things Below" is Well Versed's `things-below` box. Ticked on the card, outside the budget, and
	 * never markable again (setCountMark, the level-up mark step). The answer stored, or the
	 * background's fixed one when none was ever written (a character from before it was).
	 * @param {object} [playbookData]  the playbook, when the caller already has it
	 * @returns {Promise<Record<string, string>>}
	 */
	async backgroundMarkOptions(playbookData = null) {
		playbookData ??= await this.playbook();
		const answers = this._backgroundAnswers(playbookData);
		const out = {};
		for (const [move, answer] of Object.entries(answers)) {
			const slug = backgroundMarkOption(move, answer?.value);
			if (slug) out[move] = slug;
		}
		return out;
	}

	// The background's answers to moves (moves.backgroundAnswers), with the background's fixed
	// answer filling in where none is stored.
	_backgroundAnswers(playbookData) {
		const answers = { ...(resolvedFlags(this._actor).moves?.backgroundAnswers ?? {}) };
		for (const choice of this._selectedBackground(playbookData)?.moveChoices ?? []) {
			const key = moveChoiceKey(choice);
			if (key && choice.value && !answers[key]?.value) answers[key] = { label: choice.label ?? key, value: choice.value };
		}
		return answers;
	}

	// Edit-mode override of the level recorded for a given mark slot.
	async setMarkLevel(moveName, optionSlug, index, level) {
		const entries = markEntries(this._moveResources.getMarks()[moveName]?.[optionSlug]);
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

	// The Invocations this character draws on ({ options, … }), or null for none. The
	// Lightbearer's come with the playbook. Anyone else who has Invoke the Sun God (a Would-be
	// Hero through Versatile) learns from the same list: Level Up step 5, Book I p.528, "If you
	// are the Lightbearer (or have Invoke the Sun God) and your new level is even, choose a new
	// invocation." The Invocations insert's "you start knowing 2" is addressed to the
	// Lightbearer alone, so such a character starts knowing none and learns them at even levels.
	//
	// `learned`: a RULE asks (Level Up step 5), so Invoke the Sun God must be learned, not merely
	// held switched off. The Invocations tab keeps showing a held-but-unlearned copy's list.
	async invocationSource(playbookData = undefined, { learned = false } = {}) {
		const own = playbookData === undefined ? await this.playbook() : playbookData;
		if (own?.invocations?.options?.length) return own.invocations;
		const owns = learned ? ownsLearnedMoveNamed : ownsMoveNamed;
		if (!owns(this._actor, INVOKE_THE_SUN_GOD)) return null;
		return this.lightbearerInvocations();
	}

	// The Crew insert this character works from ({ availableTags, instincts, costs, inventory, … }),
	// or null for none. The Marshal's comes with the playbook. Anyone else who has LEARNED Crew
	// (a Fox through Dabbler, a Ranger through Worldly, a Heavy through Seasoned Warrior, a
	// Would-be Hero through Versatile) has a crew too (the user's ruling), drawn from the same
	// insert: the move says "See the Crew insert for details", and there is only the one.
	//
	// Learned, not merely held: the crew is the move's, so a Crew switched off hides the card
	// (its flags stay, and come back with it). The Marshal's own is not gated this way, being the
	// playbook's insert rather than a borrowed move's.
	//
	// The playbook repository caches by slug, so the Marshal's lookup costs one pack read a session.
	async crewSource(playbookData = undefined) {
		const own = playbookData === undefined ? await this.playbook() : playbookData;
		if (own?.crew) return own.crew;
		if (!ownsLearnedMoveNamed(this._actor, CREW_MOVE)) return null;
		const marshal = await this._playbookRepo.findBySlug(MARSHAL_SLUG);
		return marshal?.crew ?? null;
	}

	// The Animal Companion insert this character's companion is drawn from ({ types, instincts,
	// costs, moves }), or null for none: crewSource's shape, for the Ranger. The Ranger's comes with
	// the playbook. Anyone else who has LEARNED Animal Companion (a Blessed through Wild Soul, a Fox
	// through Dabbler, a Would-be Hero through Versatile) draws from the same insert, which is where
	// the move sends them ("See the Animal Companion insert").
	//
	// Learned, not merely held, for a borrowed copy: a switched-off one hides the card, its flags kept
	// for its return. The card itself asks the move is held (the panel rule), the Ranger's included.
	async companionSource(playbookData = undefined) {
		const own = playbookData === undefined ? await this.playbook() : playbookData;
		if (own?.animalCompanion?.types?.length) return own.animalCompanion;
		if (!ownsLearnedMoveNamed(this._actor, ANIMAL_COMPANION_MOVE)) return null;
		const ranger = await this._playbookRepo.findBySlug(RANGER_SLUG);
		return ranger?.animalCompanion?.types?.length ? ranger.animalCompanion : null;
	}

	// The Lightbearer playbook's Invocations, whoever is asking, or null if it can't be found.
	async lightbearerInvocations() {
		const lightbearer = await this._playbookRepo.findBySlug(LIGHTBEARER_SLUG);
		return lightbearer?.invocations?.options?.length ? lightbearer.invocations : null;
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
		return (await this.snapshotWithGear(view)).snapshot;
	}

	/**
	 * buildSnapshot, and the gear picture it was built from (`_gearSources`' `{ items, marks }`), from
	 * ONE pass: for a caller that needs both (camp-store.js#campVitalsFor: the sheet's numbers and the
	 * fur-lined bedroll), which otherwise built the gear twice.
	 *
	 * @param {object} [view]  as buildSnapshot
	 * @returns {Promise<{snapshot: object, gear: {items: object[], marks: object}}>}
	 */
	async snapshotWithGear(view = {}) {
		const actor = this._actor;
		const actorLevel = actor.system?.attributes?.level?.value ?? 1;
		const playbookData = await this.playbook();
		const ownedAllByName = this._buildOwnedMovesMap();
		// The carried curios of every owned arcanum, resolved to the side the card has realised.
		// Hoisted out of _buildInventorySection (which is where they render) because the armor
		// calculation below needs the same list, and rebuilding it would walk the arcana repo
		// twice per render.
		const [arcanaCarried, allOutfitItems] = await Promise.all([
			this._arcana.weightedInventoryItems(),
			this._inventoryRepo.getAll(),
		]);
		// Every piece of gear this character could be wearing or bearing, from all four stores,
		// with the marks that say which are actually carried. See _carriedGearSources.
		//
		// Built BEFORE the moves section and handed down to it: Defend's readiness pips ask
		// bearsShield, which otherwise rebuilt this whole picture — a second arcana walk and a
		// second pass over the outfit catalog — on every single render.
		const gear = this._gearSources(playbookData, allOutfitItems, arcanaCarried);
		// Before the moves section, which greys a capped mark option against these (_markCapState).
		const moveBonuses = await this._ownedMoveBonuses(playbookData, ownedAllByName);
		// The Crew insert the crew's numbers start from: the Marshal's own, or the one a learned
		// Crew borrows (crewSource).
		const crewDef  = await this.crewSource(playbookData);
		const crewStats = _buildCrewStats(crewDef, moveBonuses);
		const moves    = await this._buildMovesSection(playbookData, ownedAllByName, actorLevel, gear, this._markCapState(crewStats));
		const inventory = await this._buildInventorySection(playbookData, ownedAllByName, actorLevel, view, arcanaCarried);
		const postDeath = await this._postDeath.buildSnapshot();
		const pdiLabel  = postDeath.activeInsert?.name ?? null;
		// The worn-armor base (leather/mail/etc., excluding shields and move bonuses) gates
		// moves that require being unarmored (Uncanny Reflexes); 0 means unarmored. Same base
		// selection as calculateArmor — CharacterInventory owns the rule. Computed once and
		// handed to calculateArmor so the base filter doesn't run twice per render.
		//
		// Unpierceable armor shrugs off piercing and "ignores armor" outright. Carried separately
		// all the way to the damage math, because it is a FLOOR under the mitigation rather than
		// a bonus.
		//
		// `armorAdjustment` is the GM/player's hand-set delta on top of everything derived — the
		// same shape as hp.adjustment, and for the same reason: a lasting change the sheet can't
		// derive (an arcanum's boon, a curse, a ruling) has to survive the next render.
		//
		// THE DERIVED NUMBER IS KEPT SEPARATELY, exactly as hpBase is, because the total is
		// CLAMPED and a clamped total cannot be worked backwards. Both the sheet's note ("your
		// gear and moves give N") and setArmor's banking of a typed total used to recover the
		// derived number by subtracting the adjustment from the total, which is only true while
		// the clamp is not biting: under an adjustment deep enough to bottom the total out, they
		// read the derived armor as the size of the adjustment instead, and a typed 2 banked a
		// delta that landed back on 0.
		const { worn: wornArmorBase, base: armorBase, armor, unpierceable: unpierceableArmor, conditional: conditionalArmor, conditionalSource } = this._armorFrom(gear, moveBonuses);
		// A load-gated move the load on the sheet has switched off (Catlike's quiet, Free Running) wears
		// a tag saying so on its card, as does one that also needs its owner unarmored (Uncanny
		// Reflexes) while they wear armor. Display only: see load-gates.js.
		tagLoadGatedMoves(moves, inventory?.outfit?.load?.selected ?? null, wornArmorBase);
		const arcanaLore = (playbookData?.lore ?? []).some(e => e.arcanaImage || (e.options ?? []).some(o => o.arcanaRole))
			? await this._arcana.buildLoreDisplay()
			: null;
		const snapshot = new CharacterSnapshotBuilder()
			.withName(actor.name)
			.withPlaybook(playbookData ? _buildPlaybookSection(playbookData, this._background, this._instinct, this._appearance, this._origin, this._lore, actor.name, arcanaLore, !!this._actor.getFlag(STONETOP_SCOPE, WBH_HERO_FLAG), actorLevel) : null)
			.withDebilities(_buildDebilitiesSection(actor, this._moveResources))
			.withWounds(_buildWoundsSection(actor))
			.withStats(_buildStatsSection(actor))
			// A Thrall's Marks eat into their max HP ("Reduce your max HP by 2"), and they collect
			// more as Dark Succor keeps saving them — so it's derived from the marked options
			// every render, not written once.
			.withVitals(_buildVitalsSection(actor, playbookData, armor, moveBonuses, wornArmorBase, insertHpPenalty(postDeath.activeInsert?.lore), unpierceableArmor, armorBase, { value: conditionalArmor, source: conditionalSource }))
			.withMoves(moves)
			.withMovelist(_buildMovelist(moves, inventory.other, pdiLabel, actorLevel, inventory.loveLetters, playbookData?.name ?? null, this._retiredPickCount()))
			.withInventory(inventory)
			.withArcana(await this._arcana.buildSnapshot(actor.system.stats ?? {}, this._inventory.checked, this._inventory.resources))
			.withPostDeathInsert(postDeath)
			.withRollMode(normalizeRollMode(resolvedFlags(actor).rollMode))
			.withCrewBonuses(crewStats)
			.withCrewDef(crewDef)
			.withCompanionBonuses(_buildCompanionBonuses(moveBonuses, ownedAllByName, this._actor.items))
			.withCompanionDef(await this.companionSource(playbookData))
			.withViewerIsGM(!!view.viewerIsGM)
			.build();
		return { snapshot, gear };
	}

	/**
	 * ONE answer to "what gear is this character wearing or bearing, and which of it is actually
	 * on them right now" — `{ items, marks }`, where `items` are `{ slug, armor, shield }` records
	 * and `marks` maps slug → carried.
	 *
	 * It exists because that question has four different answers depending on where the gear came
	 * from, and every feature that asked it for itself got a different subset:
	 *
	 *   1. OUTFIT items          slug            ◇ in inventory.checked
	 *   2. `inventory-custom`    item id         ◇ in inventory.checked   (write-ins, possession
	 *                                            grantsItems, dropped Book II treasures)
	 *   3. ARCANA curios         arcanum slug    ◇ in inventory.checked
	 *   4. GEAR CHOICES          poss:choice     ◇ in possessions.choiceCarried  ← different store
	 *
	 * Armor read 1 and 2 and silently lost 3 and 4. `bearsShield` read a single hard-coded slug
	 * ("shield") out of store 1, so the Judge's Makerglass shield, the Would-Be Hero's shield, the
	 * Shield of the Wisent Witch and the makerglass shield treasure all bought no Readiness —
	 * every one of them printing "+1 Readiness on a Defend 7+" on the sheet while granting none.
	 * Answering it in one place is what stops the next feature losing a different three.
	 *
	 * `marks` is the union of the two stores, which is safe because a gear-choice key contains a
	 * colon and no outfit slug or item id ever does.
	 *
	 * Pure and synchronous: the caller supplies the two lists that need awaiting (the outfit
	 * catalog and the arcana curios), so this can also serve a non-async caller that already has
	 * them. Special outfit items are included only when the character actually holds them —
	 * added through the picker, granted by a selected possession, or earned commonly — never on a
	 * stale `checked` flag for an item they never added.
	 */
	_gearSources(playbookData, allOutfitItems, arcanaCarried) {
		const addedSet             = new Set(this._inventory.addedSpecial);
		const possessionSpecialSet = this._selectedPossessionSlugs(playbookData);
		const commonSpecialSet     = this._earnedCommonSpecialSlugs(this.getSteadingActor(), allOutfitItems);
		// One record shape for all four stores, written once. The stores differ only in where a
		// field is read from and in the two weapon keys, so a new gear property is added here
		// rather than in four parallel object literals that have to be kept in step.
		const rec = (slug, src, over = {}) => ({
			slug, name: src.name ?? null, note: src.note ?? null,
			armor: src.armor ?? null, shield: !!src.shield,
			// Only a catalog or gear-choice weapon is keyed in WEAPON_META; a write-in, an
			// arcanum's curio or a dropped Book II treasure states its mechanics in its own tag
			// line instead (see weaponMetaFromNote), so it carries no slug.
			weaponSlug: null, ammoStore: "inventory", ammo: !!src.resource,
			// `catalog` says this row came from the book's own equipment list, whose weapons ARE
			// the curated table — so a catalog item the table doesn't name is not a weapon, and
			// its tag line is not to be read as one (the torch's "reach, area", the horse's die).
			// Everything else has only its tag line to go on. See carriedAttackWeapons.
			catalog: false,
			// How many boxes the item's uses/ammo track has and what it calls each of them, off
			// the item's own resource definition: javelins are one throw and out, a lantern has
			// five hours of oil, and the bows carry the printed "low ammo / all out" pair.
			ammoMax: Number(src.resource?.max) || null,
			ammoLabels: Array.isArray(src.resource?.labels) ? src.resource.labels : null,
			...over,
		});
		const outfit = allOutfitItems
			.filter(i => !i.special || addedSet.has(i.slug) || possessionSpecialSet.has(i.slug) || commonSpecialSet.has(i.slug))
			.map(i => rec(i.slug, i, { weaponSlug: i.slug, catalog: true }));
		const custom = this._actor.items
			.filter(i => i.type === "move" && i.system?.moveType === "inventory-custom")
			// Where each gear field actually lives — the flag or the system field — is
			// readInventoryItemData's problem, not this method's, exactly as it is on the drop path.
			.map(i => rec(i._id, { ...readInventoryItemData(i), name: i.name }));
		const arcana = arcanaCarried.map(i => rec(i.slug, i));
		// Gear choices are the one store that is NOT inventory.checked, so their marks are
		// collected alongside their items and unioned into `marks` below. Their weapon slug is
		// the WEAPON_META key ("battleaxe"; the Marshal's fine-steel "long-spear" names its own),
		// while their carried mark and ammo track are both keyed by the composite — hence the
		// two slugs on the record.
		const choiceRows = [...this._buildChoiceGearByPossession(playbookData).values()]
			.flatMap(b => [...b.regular, ...b.small])
			.map(r => rec(`${r.possessionSlug}:${r.choiceSlug}`, { ...r, name: r.label, note: r.label }, {
				weaponSlug: r.weaponSlug, ammoStore: "possessions", carried: r.checked,
			}));
		const items = [
			...outfit, ...custom, ...arcana,
			...choiceRows.map(({ carried, ...rest }) => rest),
		];
		const marks = choiceRows.length
			? { ...this._inventory.checked, ...Object.fromEntries(choiceRows.map(r => [r.slug, r.carried])) }
			: this._inventory.checked;
		return { items, marks };
	}

	/**
	 * The carried gear this character could attack WITH, as `{ slug, weaponSlug, name, note,
	 * ammoStore }` records — everything marked as carried, whatever store its mark lives in.
	 *
	 * The attack flow used to read `inventory.checked` on its own, which meant the Heavy's and
	 * Marshal's Weapons of War — their signature gear, and every one of them a real WEAPON_META
	 * entry — were never offered for Clash or Let Fly, because a gear choice records being
	 * carried in possessions.choiceCarried instead. Arcana and treasure weapons were missed for
	 * the second reason: no WEAPON_META entry at all, their mechanics being stated only in their
	 * own tag line (see weaponMetaFromNote).
	 */
	async carriedWeaponGear() {
		const { items, marks } = await this._carriedGearSources();
		return items.filter(i => marks[i.slug]);
	}

	/** The two awaited lists _gearSources needs, for callers outside buildSnapshot. */
	async _carriedGearSources() {
		const [playbookData, allOutfitItems, arcanaCarried] = await Promise.all([
			this.playbook(),
			this._inventoryRepo.getAll(),
			this._arcana.weightedInventoryItems(),
		]);
		return this._gearSources(playbookData, allOutfitItems, arcanaCarried);
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
			if (!_isCustomMove(i) || !moveLearnedIn(i, this._actor.items)) continue;
			totals.hp    += Number(i.system?.hpBonus)    || 0;
			totals.armor += Number(i.system?.armorBonus) || 0;
		}
		// The character's OWN playbook definitions. Resolved before the foreign sweep below so it
		// can tell "a move this playbook defines" (counted from the def, further down) from "a
		// move poached out of someone else's" (counted off the embedded copy).
		const defs = playbookData ? await this._moveRepo.getPlaybookMoves(playbookData.name) : [];
		const ownPlaybookMoveNames = new Set(defs.map(d => d.name));
		// A FOREIGN move — one taken from another playbook via Versatile / Worldly / Dabbler /
		// Wild Soul / Initiate of the Secret Arts / Seasoned Warrior / Arts of War — fell between
		// both loops: the custom sweep above is deliberately scoped to player-authored moves, and
		// the def walk below only ever reads the character's own playbook. So a Judge who poached
		// the Heavy's Cut from Granite ("Gain +1 armor…") got nothing for it. _applyForeignMoveChoice
		// embeds the pack document whole, so the bonus is sitting on the owned copy.
		//
		// Name-gated against the own-playbook defs rather than on moveType, so a Heavy's own copy
		// is counted once — down there, from its definition — and never here as well.
		//
		// Its marks count too (the user's ruling): a Crew, Veteran Crew or Heroes to the Last taken
		// through Dabbler / Worldly / Seasoned Warrior / Versatile works as it does for a Marshal.
		// Marks are keyed by NAME, so they are summed once per name however many copies are held.
		const marks = this._moveResources.getMarks();
		const foreignMarked = new Set();
		for (const i of this._actor.items) {
			if (i.type !== "move" || _isCustomMove(i) || !moveLearnedIn(i, this._actor.items)) continue;
			if (ownPlaybookMoveNames.has(i.name)) continue;
			totals.hp    += Number(i.system?.hpBonus)    || 0;
			totals.armor += Number(i.system?.armorBonus) || 0;
			if (foreignMarked.has(i.name)) continue;
			foreignMarked.add(i.name);
			_addMarkOptionBonuses(totals, i.system?.markOptions, marks[i.name]);
		}
		if (!playbookData) return totals;
		for (const m of defs) {
			// Require a genuine (non-custom) owned move of this name that is still LEARNED (the
			// user's ruling, every playbook): an un-learned move grants nothing, as the custom and
			// foreign loops above already say. Its marks stay stored, so re-learning it brings
			// them back. A player-authored custom move that merely reuses a playbook move's name
			// can't pull in the def's hp/armor/marks (its own bonus is counted in the loop above).
			if (!this._ownsLearnedBookCopy(m.name, ownedAllByName)) continue;
			totals.hp    += m.hpBonus    || 0;
			totals.armor += m.armorBonus || 0;
			// Per-option marks (e.g. Potential for Greatness): apply each checked box.
			_addMarkOptionBonuses(totals, m.markOptions, marks[m.name]);
		}
		return totals;
	}

	// Whether the character holds a learned, non-custom copy of `name`, off `ownedAllByName`
	// (_buildOwnedMovesMap: name → owned items[]).
	_ownsLearnedBookCopy(name, ownedAllByName) {
		return (ownedAllByName.get(name) ?? []).some(i => !_isCustomMove(i) && moveLearnedIn(i, this._actor.items));
	}

	// What a capped mark option is weighed against (move-mark-budget.js#markOptionCapNote): the
	// crew's current damage die, stepped by every marked step, exactly as the crew card shows it.
	// The move card's mark boxes and the level-up mark step both read it.
	// Off the crew's stats (_buildCrewStats: the Crew insert, crewSource, with the move bonuses).
	_markCapState(crewStats) {
		return { crewDamageDie: crewStats.damageDie };
	}

	// The crew's stats for a caller without buildSnapshot's: its insert (crewSource) and the move bonuses.
	async _crewStatsFor(playbookData, ownedAllByName) {
		return _buildCrewStats(await this.crewSource(playbookData), await this._ownedMoveBonuses(playbookData, ownedAllByName));
	}

	// `gear` is the prebuilt gear picture from buildSnapshot, passed through to Defend's
	// readiness pips so bearsShield does not rebuild it. Optional: a caller without one
	// (a test) still gets the correct answer, just at the cost of the rebuild.
	//
	// `capState` is what a capped mark option is weighed against (_markCapState), from
	// buildSnapshot's own move bonuses; a caller without it has it worked out here.
	async _buildMovesSection(playbookData, ownedAllByName, actorLevel, gear = null, capState = null) {
		const categories = [];
		capState ??= this._markCapState(await this._crewStatsFor(playbookData, ownedAllByName));

		if (playbookData) {
			const background = this._selectedBackground(playbookData);
			const bgMoveNames = this._backgroundMoveNames(background);
			const bgSlugs = new Set([...bgMoveNames].map(slugify));
			const entries = await this._moveRepo.getPlaybookMoves(playbookData.name);
			if (entries.length > 0) {
				const sorted = this.sortPlaybookMoves(
					this.buildMovelistContext(entries, ownedAllByName, bgMoveNames, actorLevel, playbookData.name, this._startingChoiceGroups(playbookData))
				);
				const moveResourcesMap = this._moveResources.getMoveResources();
				const moveMarksMap     = this._moveResources.getMarks();
				// The stored answers, with the background's fixed ones filling any never written; the
				// choices the background offers, so an unanswered one cues the card.
				const moveBackgroundAnswers = this._backgroundAnswers(playbookData);
				const backgroundChoices     = new Map((background?.moveChoices ?? []).map(c => [moveChoiceKey(c), c]));
				const improvedStatChoices   = resolvedFlags(this._actor).improvedStatChoices ?? {};
				const actorStats            = _statValueMap(this._actor.system?.stats);
				const source = { type: "playbook", slug: playbookData.slug };
				// A held move's line about this character's own answers: Anger is a Gift's trigger is "burn
				// with righteous anger (see Fear & Anger)", so the angers picked on the Details tab are named
				// under it (would-be-hero-cards.js#righteousAngerSubtitle).
				const subtitles = { [ANGER_IS_A_GIFT]: righteousAngerSubtitle(playbookData.lore, this._lore.counts) };
				categories.push(new MoveCategorySnapshotBuilder()
					.withKey("playbook")
					.withTitle(`${playbookData.name} Moves`)
					.withNote(playbookData.startingMovesNote ?? null)
					.withMoves(_sortOwnedFirst(sorted.map(m => _buildMoveEntry(m, source, moveResourcesMap, bgSlugs, moveBackgroundAnswers, improvedStatChoices, moveMarksMap, actorStats, capState, backgroundChoices, actorLevel, subtitles))))
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
			const learnedActorStats   = _statValueMap(this._actor.system?.stats);
			const learnedFilledMarks  = this._filledMarkCounter([], ownedAllByName);
			// Copies of one move (a Fox who takes Well Versed twice through Dabbler) are ONE card, as
			// on the playbook list: its mark budget scales with every copy, and its marks are shared.
			const learnedGroups = new Map();
			for (const i of learnedItems) {
				const key = `${i.system?.playbook ?? ""}\u0000${i.name}`;
				if (!learnedGroups.has(key)) learnedGroups.set(key, []);
				learnedGroups.get(key).push(i);
			}
			// The pack's markBudget/markOptions come first, as _moveMarkDefinition reads them, so
			// the card and the writer's clamp agree; the owned copy's are the fallback.
			const learnedDefs = await Promise.all([...learnedGroups.values()].map(copies => this._packMoveDefinition(copies[0])));
			categories.push(new MoveCategorySnapshotBuilder()
				.withKey("learned")
				.withTitle("Learned Moves")
				.withNote("Moves you've gained from outside your own playbook's list.")
				.withMoves([...learnedGroups.values()].map((copies, groupIndex) => {
					// The card stands for the copies still on first (owns-move.js#moveLearnedIn), so
					// unticking it takes one of those; a switched-off copy is named in a note below.
					const learned  = copies.filter(c => moveLearnedIn(c, this._actor.items));
					const i        = learned[0] ?? copies[0];
					const ownedIds = copies.map(c => c._id);
					const def      = learnedDefs[groupIndex];
					const origin      = i.system?.playbook ?? null;
					// A cross-playbook grant says who granted it, every granter of every copy; a move
					// added by hand has no granter to name, so it wears its origin playbook alone
					// rather than the old "Granted by —" placeholder, which read like a bug of its own.
					const granters    = [...new Set(copies.map(c => c.flags?.[STONETOP_SCOPE]?.grantedBy?.move).filter(Boolean))];
					const sourceLabel = granters.length
						? `Granted by ${granters.join(", ")}${origin ? ` · ${origin}` : ""}`
						: (origin ?? "Added directly");
					// Full card fidelity: resource track + markOptions, keyed by move NAME (the
					// same store playbook moves use), so e.g. a learned ammo/Marks track works.
					const resourceDef = i.system?.resource ?? null;
					const resource = resourceDef?.max ? new ResourceBuilder()
						.withCurrent(learnedResourcesMap[i.name] ?? 0)
						.withMax(resourceDef.max)
						.withTitle(resourceDef.title ?? null)
						.withLabels(resourceDef.labels ?? [])
						.withSpendTooltip(new ResourceDef(resourceDef).spendTooltip)
						.build() : null;
					const { options: markOptions, budget: markBudget } = _buildMarkOptions(
						{ name: i.name, markOptions: def?.markOptions ?? i.system?.markOptions, markBudget: def?.markBudget ?? i.system?.markBudget, ownedIds, owned: true },
						learnedMarksMap[i.name] ?? {}, capState, null, { actorStats: learnedActorStats, actorLevel });
					// Its prerequisites, read by the same checks a playbook move's are (a required
					// move, a level, a stat): a Heavy who learned Parry & Riposte through Seasoned
					// Warrior and then dropped Skill at Arms is warned, as a playbook move would be.
					// A WARNING only: nothing is locked or taken away. Its playbook requirement is
					// not asked, since a learned move is from another playbook by definition.
					const checked = _learnedMoveRequirement(i, ownedAllByName, actorLevel, learnedActorStats, learnedFilledMarks);
					// Every copy switched off by the cross move that granted it (the user's ruling):
					// the card reads as off and names the granter to switch back on.
					// A card still on through another copy names the switched-off one's granter in a note.
					const offGranter = copies.filter(c => !learned.includes(c))
						.map(c => switchedOffGranter(c, this._actor.items)).find(Boolean)?.name ?? null;
					const granterOff     = learned.length ? null : offGranter;
					const granterOffCopy = learned.length ? offGranter : null;
					return new MoveSnapshotBuilder()
						.withId(i._id).withCompendiumId(i._id).withOwnedId(i._id)
						.withName(i.name)
						.withDescription(i.system?.description ?? "")
						.withRollType(i.system?.rollType ?? null)
						.withRollLabel(_rollLabelForMove(i.name, i.system?.rollType, i.system))
						.withIsStarting(false)
						.withSource({ type: "learned" })
						.withSourceLabel(sourceLabel)
						.withOwned(true).withOwnedIds(ownedIds)
						.withLocked(false).withRequirement(null).withRequiresLabel(checked.requiresLabel)
						.withRequirementsUnmet(checked.requirementsUnmet)
						.withGranterOff(granterOff).withGranterOffCopy(granterOffCopy)
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
			if (defend) defend.readiness = await this.defendReadinessContext(gear);
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

		const postDeathItems = this._actor.items.filter(isPostDeathMove);
		if (postDeathItems.length > 0) {
			// With their tracks: Poltergeist's Fury is a hold on its move, kept by name like a playbook
			// move's (post-death-moves.js).
			const resources = this._moveResources.getMoveResources();
			categories.push(new MoveCategorySnapshotBuilder()
				.withKey("post-death")
				.withTitle("Post-Death Moves")
				.withNote(null)
				.withMoves(postDeathItems.map(i => _buildOwnedItemMoveSnapshot(i, { sourceType: "post-death", isStarting: true, resources })))
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
	// A possession's `specialItems` are catalog special items it makes by other slugs (the
	// Seeker's Laboratory produces naphtha, a ◇ weapon with its own ○○○ track), surfaced the same
	// way while the possession is held.
	_selectedPossessionSlugs(playbookData) {
		const held = new Set([
			...(playbookData?.specialPossessions?.preselected ?? []),
			...this._possessions.selected,
		]);
		for (const opt of playbookData?.specialPossessions?.options ?? []) {
			if (held.has(opt.slug)) for (const slug of opt.specialItems ?? []) held.add(slug);
		}
		return held;
	}

	async _buildInventorySection(playbookData, ownedAllByName, actorLevel, view = {}, arcanaCarried = null) {
		const viewerIsGM     = !!view.viewerIsGM;
		const checked        = this._inventory.checked;
		const resources      = this._inventory.resources;
		const acquiredMaxes  = this._inventory.resourceMax;
		const possessionUses = this._possessions.uses;
		const rPool          = this._inventory.regularPool;
		const sPool          = this._inventory.smallPool;
		const allItems       = await this._inventoryRepo.getAll();
		const steadingActor  = this.getSteadingActor();
		const smallItemLimit = this.getSmallItemLimit(steadingActor);
		const usesPerSupply  = this.getUsesPerSupply(steadingActor);
		const steadingName   = steadingActor?.name ?? null;
		// Null when it can't be read: the "x piercing" captions then keep the literal x.
		const prosperity     = effectiveProsperity(steadingActor);
		const commonSpecialSet = this._earnedCommonSpecialSlugs(steadingActor, allItems);
		// Weapons of War: "Battleaxes and swords have 'x piercing'", resolved below with the rest.
		const weaponsOfWar     = this.weaponsOfWarEarned(steadingActor);
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
			// Three sources of a track's size, most specific first. An ACQUIRED capacity wins
			// outright: provisions have no printed number of uses because the larder is however
			// much the last Forage brought in (CharacterInventory#resourceMax). Then the
			// 4+Prosperity supplies rule (+1 with a Mill), then the number printed on the item.
			const acquiredMax = Number(acquiredMaxes[outfitItem.slug]);
			const resMax = Number.isFinite(acquiredMax) ? acquiredMax
				: isProsperityResource ? usesPerSupply
				: res?.max;
			// Armored reduces a carried shield's ◇ cost (min 1), so it reads ◆ instead of ◆◆.
			const weight = _shieldAdjustedWeight(outfitItem.weight, outfitItem.shield, shieldLoadReduction);
			return new InventoryItemSnapshotBuilder()
				.withSlug(outfitItem.slug)
				.withName(outfitItem.name)
				.withNote(_transformPiercingNote(_withWeaponsOfWarPiercing(outfitItem, weaponsOfWar), prosperity))
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
			// Armored lightens a written-in, granted or dropped shield (the makerglass shield
			// treasure) exactly as it does a catalog one. Whether the item IS a shield is read the
			// way _gearSources reads it for Readiness, so the two can never disagree.
			const read = readInventoryItemData(item);
			const weight = _shieldAdjustedWeight(item.system.weight ?? 1, read.shield, shieldLoadReduction);
			return new InventoryItemSnapshotBuilder()
			.withSlug(item._id)
			.withName(grant?.name ?? item.name)
			// Plain write-ins carry no source note. Possession gear now renders inside its
			// possession's card (grouped under the possession label), so it needs no
			// "from <possession>" note either.
			.withNote(artifact.note)
			.withWeight(weight)
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
			.withResourceFirst(read.resourceFirst)
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
		// Handed in by buildSnapshot, which also needs this list for the armor calculation; the
		// fallback keeps the section standalone for callers (and tests) that build it directly.
		const arcanaAll     = arcanaCarried ?? await this._arcana.weightedInventoryItems();
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

		// The same possession gear as plain Outfit rows, since Outfit lets you "select ... any of
		// your special possessions" and the load above counts it. Without these the Outfit window
		// showed a Fox with the Burglar's kit marked as carrying nothing, then the sheet came back
		// heavy, and the gear could be neither marked nor unmarked there. Each row keeps the key
		// its mark lives under: a granted item's id (inventory.checked) or a gear choice's
		// `poss:choice` (possessions.choiceCarried), which applyOutfit sends back to the right store.
		// Grouped by possession in the playbook's order, each row naming its possession.
		const possessionLabels = new Map((playbookData?.specialPossessions?.options ?? [])
			.map(opt => [opt.slug, stripHtmlToText(opt.label ?? "")]));
		const outfitPossessionRows = column => [...new Set([...possessionLabels.keys(), ...grantedByPossession.keys(), ...choiceGearByPossession.keys()])]
			.flatMap(slug => [
				...(grantedByPossession.get(slug)?.[column] ?? [])
					.map(i => ({ slug: i.slug, name: i.name, weight: i.weight, checked: i.checked })),
				...(choiceGearByPossession.get(slug)?.[column] ?? [])
					.map(r => ({ slug: `${slug}:${r.choiceSlug}`, name: _choiceGearText(r), weight: r.weight, checked: r.checked })),
			].map(row => ({ ...row, note: possessionLabels.get(slug) || null })));
		const outfitPossessionRegular = outfitPossessionRows("regular");
		const outfitPossessionSmall   = outfitPossessionRows("small");

		let possessions = null;
		if (playbookData?.specialPossessions) {
			const maxUsesMap = this.computePossessionMaxUses(playbookData.specialPossessions, ownedAllByName, actorLevel);
			const fromBackground = backgroundPossessionSlugs(this._selectedBackground(playbookData), this._background.setupChoices);
			possessions = this._buildPossessionsSnapshot(playbookData.specialPossessions, maxUsesMap, prosperity, grantedByPossession, choiceGearByPossession, fromBackground);
		}

		const moveResourceState = this._moveResources.getMoveResources();
		const otherItems = this._actor.items
			.filter(i => i.type === "move" && i.system?.moveType === "other");

		// Love letters are single-use, GM-authored moves (Book I p.568). They share the
		// "other" moveType but render in their own top-of-Moves section and hide once
		// resolved — so split them off here in one pass and keep them off the "Other Moves" list.
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
				.withResolved(isResolvedLoveLetter(i))
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
					// What the move printed as its prerequisite, for reading: an Other Move is
					// already learned, so nothing is checked against it here.
					.withRequiresLabel(requirementLabel(i.system?.requirement, { replaces: i.system?.replaces || null }))
					.withCustom(_isCustomMove(i))
					.withLearned(moveLearnedIn(i, this._actor.items))
					.withResourceKey(resourceKey)
					// A copy of Up With People taken while it printed a third pip reads as the two it has now.
					.withResource(_buildOtherMoveResource(shippedRapportTrack(i.name, i.system?.resource), moveResourceState[resourceKey]))
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
		// The undefined ◇ count as STORED, never clamped to the room left under heavy: Outfit and
		// the pool track already keep a reservation under heavy (regularPoolMax is that room, the
		// at-your-limit toast's cap), so the only way past it is weight gained in the field, loot
		// and provisions, which draw nothing from the reserve. A clamp here used to swallow that
		// weight into the reserve, so a character could never read as carrying 10 ◇ or more while
		// any undefined ◇ was left (Book I p.327: "If they want to carry 10 ◇ or more...").
		const regularPoolMax     = Math.max(0, loadLimits.heavy - checkedRegularWeight);
		// The ◇ track always shows the full load capacity, so the diamonds never vanish
		// as you mark items. Only a Pack Horse / loadBonus move raises the cap (to 10), so an
		// overloaded carry still tops out at heavy rather than sprouting extra ◇. The reserve is
		// held to that track's size alone (a Pack Horse given up), never to the room left in it.
		const regularPoolSlots   = loadLimits.heavy;
		const regularPoolCurrent = Math.min(regularPoolSlots, Math.max(0, Math.trunc(Number(rPool) || 0)));
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
		// The small grid is the printed insert's own block of common small items. A SPECIAL small
		// item (a lantern, salt, a handful of silvers) is listed with the rest of the column even
		// when its catalog row is flagged smallGrid: it was dropped from the list by that flag and
		// never put in the grid, which only holds the standard items, so one bought through Trade &
		// Barter vanished from the sheet and the Outfit window alike.
		const smallItems = [
			...allSmall.filter(i => !i.smallGrid).map(mapItem),
			...addedSmall.map(mapAddedSpecial),
			...possessionSmall.map(mapItem),
			...commonSmall.map(mapItem),
			...writeInItems.filter(i => i.system.inventoryColumn === "small").map(mapCustomItem),
		];
		const smallGridItems = allSmall.filter(i => i.smallGrid).map(mapItem);

		// Small marks are likewise derived: the undefined □ pool fills the room left
		// under the 4+Prosperity Outfit allotment after checked small items. Possession
		// small gear (grantedSmallAll) and pocket-sized treasures (treasureSmall) live
		// outside the list but still eat the allowance. Weightless arcana (arcanaSmall)
		// deliberately do NOT: they merely sit in this column, and have never cost a
		// player anything — counting them now would silently shrink the allowance for
		// every card owned. 4+0 when Prosperity can't be read ("+0 by default", p.88; getSmallItemLimit).
		// The stored □ count is shown as it is, like the ◇ one: a small find picked up in the
		// field takes nothing from the reserve.
		const smallAllotment   = smallItemLimit;
		const checkedSmallCount = [...smallItems, ...smallGridItems, ...grantedSmallAll, ...choiceGearSmallAll, ...treasureSmall].filter(i => i.checked).length;
		const smallPoolMax     = Math.max(0, smallAllotment - checkedSmallCount);
		// Like the ◇ track, the □ track always shows the full 4+Prosperity allotment, so
		// boxes never vanish as small items are marked. The reserve is only held to the track's
		// own size, which a fall in Prosperity can take below what was reserved.
		const smallPoolSlots   = smallAllotment;
		const smallPoolCurrent = Math.min(smallPoolSlots, Math.max(0, Math.trunc(Number(sPool) || 0)));

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
			.withPossessionRegular(outfitPossessionRegular)
			.withPossessionSmall(outfitPossessionSmall)
			.withSmallItemLimit(smallItemLimit)
			.withProsperity(prosperity)
			.withUsesPerSupply(usesPerSupply)
			.withSteadingName(steadingName)
			.withLoadBonus(loadBonus)
			.withLoadBonusMoves(loadBonusMoves)
			.withLoadLimits(loadLimits)
			.build();

		return new InventorySnapshot(outfit, possessions, other, loveLetters);
	}

	_buildPossessionsSnapshot(specialPossessions, maxUsesMap, prosperity = null, grantedByPossession = new Map(), choiceGearByPossession = new Map(), fromBackground = new Set()) {
		const { pickNote, pickCount, preselected = [], options } = specialPossessions;
		const selectedSlugs = this._possessions.selected;
		const usesMap = this._possessions.uses;
		const subChoicesMap = this._possessions.subChoices;
		const preselectedSet = new Set(preselected);
		// Owned move counts, scanned once for the whole list and only if a possession has choice groups.
		let moveCounts;
		const ownedMoveCounts = () => (moveCounts ??= this.ownedMoveCounts());

		let chosenCount = 0;
		const items = options
			// Grant-only possessions (the Seeker's Initiate-granted Sacred Pouch) aren't
			// pickable here — surface one only once it's actually been granted (selected).
			.filter(opt => !opt.grantOnly || preselectedSet.has(opt.slug) || selectedSlugs.has(opt.slug))
			.map(opt => {
			const isPre = preselectedSet.has(opt.slug);
			const isSelected = isPre || selectedSlugs.has(opt.slug);
			// A granted possession doesn't consume one of the playbook's normal picks, and
			// neither does one the background handed over ("in addition to your usual choice").
			if (isSelected && !isPre && !opt.grantOnly && !fromBackground.has(opt.slug)) chosenCount++;
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
				// A gear-granting possession's description is just its item list, which the
				// granted rows now say — except for the rule the book prints after it ("Gain
				// advantage to Persuade domestic beasts", Trapping gear's +1 provisions), which
				// lives in `rulesNote` so it doesn't vanish with the list.
				.withDescription(hasGrantedGear ? (opt.rulesNote ?? "") : _transformPiercingNote(_stripPossessionUsesAnnotation(opt.description ?? "", resourceDef), prosperity))
				.withSelected(isSelected)
				.withChecked(isSelected)
				// A granted grant-only possession (the Initiate Sacred Pouch) is locked like
				// preselected gear: it can't be re-added from the sheet (it's filtered out of
				// the picker), so don't let it be accidentally unchecked away either. So is one
				// the background handed over (A Life of Crime's burglar's kit): it goes with the
				// background, not with a click (the user's ruling).
				.withDisabled(isPre || (isSelected && (!!opt.grantOnly || fromBackground.has(opt.slug))))
				.withPreselected(isPre)
				// Preselected possessions (the Blessed's sacred pouch, Marshal's symbol of
				// authority, etc.) are starting *gear*, not moves — show no source label
				// (the disabled checkbox already signals they're locked in). A granted pouch whose
				// granter is switched off says so there: it can't be spent until it is back on.
				.withPreselectedSource(isSelected && this._grantSuspended(opt.slug, { specialPossessions })
					? `Off: ${this._actor.items.find(i => i.type === "move" && i.system?.crossPlaybook?.grantsPossession === opt.slug)?.name ?? ""} is switched off`
					: null)
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
				// Has editable choiceGroups → gear tab shows an "edit" pencil (in edit mode). Not
				// while every line is capped at nothing: the Seeker's pouch has no remarkable
				// trait until Big Magic grants one, so the editor would offer nothing to pick.
				.withHasChoiceGroups(isSelected && !!opt.choiceGroups?.length && _hasEditableChoice(opt.choiceGroups, ownedMoveCounts()))
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
		// Too many is flagged the same way, never refused: a GM may have allowed the extra.
		const overBy = pickCount > 0 ? Math.max(0, chosenCount - pickCount) : 0;
		return new PossessionsSnapshot(pickCount, pickNote, [...items, ...customItems], isIncomplete, overBy);
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
		// Armored reaches a shield among the gear choices exactly as it reaches one in the
		// outfit catalog — the Judge's and the Would-Be Hero's shields are gear choices.
		const shieldLoadReduction = _ownedShieldLoadReduction(this._actor);
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
				const { weight: printedWeight, label: rawLabel } = _parseChoiceGear(c.label);
				const weight = _shieldAdjustedWeight(printedWeight, c.shield ?? false, shieldLoadReduction);
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
					// The WEAPON_META key. Usually the choice slug itself; a choice that shares
					// a slug with a catalog weapon but not its stats names its own (the
					// Marshal's fine-steel long spear is 2 piercing, not the iron spear's x).
					weaponSlug:     c.weaponSlug ?? c.slug,
					label:          rowLabel,
					// Re-attached after the inline circles: the label's closing paren.
					labelAfter:     useInline ? inline.after : "",
					// The whole printed line, inline statuses and all, for a surface that lists the
					// gear as one line of text with no track to stand in for them (the Outfit window).
					fullLabel:      label,
					resourceInline: useInline,
					weight,
					// Worn/borne gear among the choices (the Judge's Makerglass shield) carries the
					// same `{base}`/`{modifier}` shape as an outfit item. buildSnapshot reads it off
					// these rows rather than re-walking the possessions, so "which choices are yours
					// and carried" stays a single rule — this method — and can't drift from what the
					// card renders.
					armor:          c.armor ?? null,
					// And whether that gear is a SHIELD, which also buys "+1 Readiness on a 7+ to
					// Defend" — read off these rows by bearsShield for the same reason armor is.
					shield:         c.shield ?? false,
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

	/**
	 * Take (or, with null, remove) a post-death insert. Queued with the lore-move sync
	 * (syncPostDeathLoreMoves): this deletes and makes the character's post-death moves wholesale, and
	 * a sync running beside it would be deciding what to create from a list this is halfway through
	 * replacing.
	 */
	async setPostDeathInsert(...args) {
		return this._queuePostDeathMoves(() => this._setPostDeathInsert(...args));
	}

	async _setPostDeathInsert(slug) {
		// The insert they already wear, taken again (the same Item dropped a second time, the tab's own
		// button pressed twice): nothing to do. Carrying on used to clear the state below, so a Ghost
		// dispersed out of the action, or one lost to the Final Consequence, was stood back up by a
		// stray drop, and their three moves were deleted and made again. Whether anything was written.
		const previous = this._postDeath.activeSlug;
		if (slug && slug === previous) return false;

		// Swapping one insert for another leaves the old one's answers behind in their own flag
		// namespaces. Prune them to what the incoming insert can actually hold — before the slug
		// moves, so the pruning is measured against the new insert and not against itself.
		// Removal (slug = null) deliberately prunes nothing: it's an edit-mode undo, and a
		// mis-click shouldn't cost a character every Consequence they've collected.
		if (slug) await this._postDeath.pruneToInsert(slug);

		const toRemove = this._actor.items
			.filter(isPostDeathMove)
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
		//
		// Ending the brush with death is not getting up (the user's ruling, 2026-09-27): taken at the
		// Door (dying, owing a fate, or dead), the insert returns them OUT OF THE ACTION at 0 HP, and
		// the Special Moves card's "Back on your feet" brings them up with half their max HP. A
		// Revenant's Undying 6- that gives up the body for a Ghost comes through here too, from dying.
		// See deaths-door.js#stateOnTakingInsert.
		const taken = slug ? stateOnTakingInsert(this.deathsDoorState) : null;
		await this._actor.update({
			...this._postDeath.slugUpdateData(slug),
			...(taken ? this.deathsDoorStateUpdateData(taken.state) : {}),
			...(taken?.atTheDoor && this.hp !== 0 ? { "system.attributes.hp.value": 0 } : {}),
			...(this._postDeath.tabRequestUpdateData(!slug) ?? {}),
		});
		if (slug) {
			// The insert's own moves. A Consequence's or Mark's move (Poltergeist, Red Wrath) is the
			// lore sync's, made below only for what the character has marked and carried over.
			// Made whole, outcomes and track included, as a lore move is: the roll card reads its
			// outcomes off this copy, and one made from the text alone posted Undying with none.
			const entries = (await this._moveRepo.getPostDeathMoves(slug)).filter(m => !m.loreOption);
			await this._actor.createEmbeddedDocuments("Item", entries.map(postDeathMoveItemData));
			await this._syncPostDeathLoreMoves();
		}
		return true;
	}

	/**
	 * Give this character the move of every Consequence or Mark they have marked that rolls or holds
	 * something (Poltergeist, Bodysnatcher, Red Wrath, Torment's Blessing), and take away the move of
	 * any they no longer have: post-death-moves.js, which says why a lore write anywhere ends up here.
	 * Idempotent, and queued behind any insert swap. Resolves to how many were made and removed.
	 */
	async syncPostDeathLoreMoves() {
		return this._queuePostDeathMoves(() => this._syncPostDeathLoreMoves());
	}

	async _syncPostDeathLoreMoves() {
		const slug = this._postDeath.activeSlug;
		const counts = this._postDeath.lore.counts;
		const { create, remove } = planLoreMoveSync({
			entries:  slug ? await this._moveRepo.getPostDeathMoves(slug) : [],
			// Read at the moment of the sync, not handed in: a queued sync runs after whatever went
			// before it has landed, and it is THAT state it has to agree with.
			owned:    this._actor.items.filter(isPostDeathMove),
			isMarked: key => Number(counts[key]) > 0,
		});
		if (remove.length) await this._actor.deleteEmbeddedDocuments("Item", remove);
		if (create.length) await this._actor.createEmbeddedDocuments("Item", create);
		return { created: create.length, removed: remove.length };
	}

	/**
	 * Run `work` after every post-death move change already queued on this character, whether or not
	 * that one succeeded. One queue per character model (StonetopActor#typedActor keeps one).
	 */
	_queuePostDeathMoves(work) {
		const next = (this._postDeathMovesQueue ?? Promise.resolve()).then(work);
		// The queue itself never rejects, so one failed sync does not wedge every one after it; the
		// caller still gets `next`, rejection and all.
		this._postDeathMovesQueue = next.catch(() => {});
		return next;
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
	// `options` reaches the write, so a move spending a use can name itself to the ledger ({stonetopMove}).
	async setInventoryResource(slug, count, options) { await this._inventory.setResource(slug, count, options); }
	// Fragment forms, for a move that changes several things at once and wants one write for the
	// lot of them (see camp/camp-rules.js#campShareUpdate; heldAdvantageData is with the held modes).
	inventoryResourceData(slug, count)              { return this._inventory.resourceData(slug, count); }
	async setInventoryRegularPool(count)            { await this._inventory.setRegularPool(count); }
	async setInventorySmallPool(count)              { await this._inventory.setSmallPool(count); }
	async removeSpecialItem(slug)                   { await this._inventory.removeSpecial(slug); }

	/**
	 * The Blessed's Boon, off Rites of the Land's own track.
	 *
	 * A HOLD track: the stored number is Boon currently held, not Boon spent, because a
	 * Blessed who has never overseen the rites holds none (see stock-cost.js, which pays out of
	 * this and explains why the pouch counts the other way). Zero for a character without the
	 * move at all, which is also the honest answer.
	 */
	ritesBoonHeld() {
		return Math.max(0, Number(this._moveResources.getMoveResources()[RITES_OF_THE_LAND]) || 0);
	}

	/**
	 * That track's capacity, read off the owned move so a homebrewed one still works. Only a
	 * LEARNED Rites of the Land has one: an un-learned move is kept on the sheet switched off.
	 */
	ritesBoonMax() {
		return Number(ownedLearnedMove(this._actor, RITES_OF_THE_LAND)?.system?.resource?.max) || 0;
	}

	/** Is this character a Vessel (the Blessed's background that can pay Stock in HP)? */
	get isVessel() {
		return isVessel({ playbookName: this._actor.system?.playbook?.name ?? null, backgroundSlug: this._background.selectedSlug });
	}

	/**
	 * The name of the background that gives this character advantage on `moveName`, or null
	 * (see BACKGROUND_MOVE_ADVANTAGE). Asked by both roll paths, onRoll and onDirectStatRoll.
	 */
	backgroundMoveAdvantage(moveName) {
		if (!moveName) return null;
		const who = { playbook: this._actor.system?.playbook?.name ?? null, background: this._background.selectedSlug };
		return BACKGROUND_MOVE_ADVANTAGE.find(g => g.move === moveName && tookBackground(who, g.background))?.source ?? null;
	}

	/**
	 * The skin of fine whisky this character could share on a Persuade, or null (see fine-whisky.js):
	 * carried, and with a use left. Read live, for the roll window and for onRoll both.
	 */
	async fineWhiskyOffer() {
		const { items, marks } = await this._carriedGearSources();
		const byId = new Map(this._actor.items.filter(i => i.type === "move").map(i => [i._id, i]));
		const possessionUses = this._possessions.uses;
		const gear = items.map(g => {
			const doc = byId.get(g.slug);
			if (!doc) return g;
			// A granted skin keeps its grant's key, and a skin made before its grant carried a track of
			// its own counts off its possession's (mapCustomItem reads it the same way).
			const from = doc.system?.sourcePossession ?? null;
			return { ...g, sourceKey: doc.system?.sourceKey ?? null, legacyUsed: from ? possessionUses[from] ?? null : null };
		});
		return fineWhiskyOfferFrom({ gear, marks, resources: this._inventory.resources });
	}

	/**
	 * The lines the roll window offers before `item` is rolled (dialogs/RollDialog.js #promptRoll):
	 * what the character carries that this roll could spend (a skin of fine whisky, ticked), and the
	 * FICTION_ROLL_OFFERS their moves and possessions bring to it (unticked).
	 *
	 * Each line carries what taking it does, so onRoll settles every line the same way: `source`, named
	 * on the card; `effect`, what it does to the roll (advantage unless it says "missAsPartial",
	 * "partialAsSuccess" or a note); and
	 * `spend(moveName)`, its price if it has one, paid after the dice.
	 */
	async rollOffers(item) {
		return this._rollOffersNamed(item?.name);
	}

	/**
	 * The lines the roll window offers a roll with no move item behind it (onDirectStatRoll), by the name
	 * it is rolled under: a guided move, Improvise, Know Things or Seek Insight about an arcanum or an
	 * artifact. Each of those is a move roll, so it is offered what a move of that name is (rollOffers):
	 * the rows of every move roll (Constant Vigilance, Underestimated) and Binding Arbitration's line, and a
	 * row that names its move only when the name is that move's (a guided "Defy Danger" would get Stone
	 * Cold's). A bare stat roll (no `moveName`) is no move: it is offered Binding Arbitration's line alone,
	 * which is "all rolls against them", as its targeted half already is (_foldAimedModes).
	 *
	 * `except` drops the lines whose `source` the caller's own picker has already asked (the identify roll's
	 * Polyglot and Naturalist, arcana-identify.js#KNOW_THINGS_ADVANTAGE_MOVES), so neither is offered twice.
	 */
	async directRollOffers(moveName, { except = [] } = {}) {
		if (!moveName) {
			const oathbreaker = this._oathbreakerOffer(null);
			return oathbreaker ? [oathbreaker] : [];
		}
		const asked = new Set(except);
		return (await this._rollOffersNamed(moveName)).filter(offer => !asked.has(offer.source));
	}

	/** rollOffers and directRollOffers: the lines a roll made under `moveName` is offered. */
	async _rollOffersNamed(moveName) {
		if (!moveName) return [];
		const offers = [];
		const whisky = isPersuadeMove(moveName) ? await this.fineWhiskyOffer() : null;
		if (whisky) {
			offers.push({
				...whisky,
				source: FINE_WHISKY_SOURCE,
				// 1 use marked (an inventory track counts what is spent). Re-read, so a use marked by hand
				// while the window was open is not undone.
				spend: async name => {
					const used = Number(this._inventory.resources[whisky.slug] ?? whisky.used) || 0;
					await this._inventory.setResource(whisky.slug, Math.min(whisky.max, used + 1), { stonetopMove: name });
				},
			});
		}
		for (const row of FICTION_ROLL_OFFERS) {
			if (!row.moves(moveName)) continue;
			if (row.unlessDebility && this._actor.system?.attributes?.debilities?.options?.[row.unlessDebility]?.value) continue;
			if (row.whileHolding && !(learnedTrack(this._actor, row.whileHolding)?.held > 0)) continue;
			if (!await this._earnsRollOffer(row)) continue;
			offers.push({
				key: row.key, label: _loc(row.label), applied: false, source: row.source,
				...(row.effect ? { effect: row.effect } : {}), ...(row.note ? { note: _loc(row.note) } : {}),
				...(row.tierActions ? { tierActions: row.tierActions() } : {}),
				...(row.onCritical ? { onCritical: message => row.onCritical(this._actor, message) } : {}),
				// 1 held off the track (a hold pool counts what is HELD). Re-read, so a pip spent by hand
				// while the window was open is not given back.
				...(row.spendHeld ? { spend: () => takeBackHeld(this._actor, row.spendHeld, 1) } : {}),
			});
		}
		const oathbreaker = this._oathbreakerOffer(moveName);
		if (oathbreaker) offers.push(oathbreaker);
		return offers;
	}

	/** Whether this character has what a FICTION_ROLL_OFFERS row asks for (see there). */
	async _earnsRollOffer(row) {
		if (row.ownsLearned) return ownsLearnedMoveNamed(this._actor, row.ownsLearned);
		// Marked on the insert they WEAR (CharacterPostDeath#wornMarked).
		if (row.postDeathLore) return this._postDeath.wornMarked(row.postDeathLore);
		if (row.background) {
			return tookBackground({ playbook: this._actor.system?.playbook?.name ?? null, background: this._background.selectedSlug }, row.background);
		}
		if (row.possessionChoice) return this.carriesPossessionChoice(row.possessionChoice);
		return this.holdsPossession(row.possession);
	}

	/**
	 * Whether this character has picked the gear choice `key` ("symbol-of-authority:helm", keyed as the
	 * carry marks are) of a special possession they hold, and carries it (its ◇ marked): the rule
	 * _buildChoiceGearByPossession draws the gear by, so a helm left at home grants nothing.
	 */
	async carriesPossessionChoice(key) {
		const [possession, choice] = String(key ?? "").split(":");
		if (!possession || !choice) return false;
		if (!(this._possessions.subChoices[possession] ?? []).includes(choice)) return false;
		if (!this._possessions.isChoiceCarried(possession, choice)) return false;
		return this.holdsPossession(possession);
	}

	/**
	 * Binding Arbitration's line (see BINDING_ARBITRATION_OFFER), or null: a roll aimed at nobody, by a
	 * character holding at least one oath ticked broken. Interfere and Persuade (vs. PCs) ask whom they
	 * are aimed at once the window closes, and onRoll asks that character's oath itself.
	 */
	_oathbreakerOffer(moveName) {
		if (moveName === INTERFERE_MOVE || moveName === PERSUADE_PC_MOVE) return null;
		if (globalThis.game?.user?.targets?.size) return null;
		const broken = brokenOaths(this._actor);
		if (!broken.length) return null;
		const names = joinNames([...new Set(broken.map(oath => String(oath.name ?? "").trim()).filter(Boolean))]);
		return {
			key: BINDING_ARBITRATION_OFFER, applied: false, source: BINDING_ARBITRATION,
			label: names
				? format("stonetop.rollOffers.bindingArbitrationNamed", { names })
				: _loc("stonetop.rollOffers.bindingArbitration"),
		};
	}

	/**
	 * Who a roll that is not an attack is aimed at, for Binding Arbitration: the player character an
	 * Interfere or a Persuade (vs. PCs) was just aimed at (`aimed`, pc-asks/pc-ask-flow.js#aimPcAskRoll),
	 * else the tokens this user has targeted. In the shape an attack's targets take (attack-flow.js).
	 */
	_rollTargets(aimed) {
		const ask = aimed?.messageFlags?.[STONETOP_SCOPE]?.[PC_ASK_FLAG] ?? null;
		if (ask?.targetId) return [{ uuid: `Actor.${ask.targetId}`, name: ask.targetName ?? "", actorId: ask.targetId }];
		return globalThis.game?.user?.targets ? snapshotTargets() : [];
	}

	/**
	 * The name of the season that gives this character disadvantage on `moveName` ("Winter"), or
	 * null (see SEASON_MOVE_DISADVANTAGE). The season is the steading's stamped clock; with no
	 * steading, or no Seasons Change recorded on it, nothing is imposed. Asked beside
	 * backgroundMoveAdvantage by both roll paths.
	 */
	seasonMoveDisadvantage(moveName) {
		if (!moveName || !SEASON_MOVE_DISADVANTAGE.some(g => g.move === moveName)) return null;
		const season = readCurrentSeason(this.getSteadingActor())?.season ?? null;
		const hit = SEASON_MOVE_DISADVANTAGE.find(g => g.move === moveName && g.season === season);
		return hit ? seasonLabel(hit.season) : null;
	}

	/**
	 * What a roll aimed at `targets` owes, for both roll paths (onRoll, and onDirectStatRoll: a guided
	 * move, Improvise, a stat): Binding Arbitration's advantage on an oathbreaker, else But I Get Up
	 * Again's on whoever knocked this character down, else Alpha's on the foes its 10+ cowed (they do not
	 * stack, so only the one that bought it is named), then Tough Love's disadvantage on a roll at the hero
	 * who called this character on it, so the two sides cancel. Never a damage roll's: those do not come
	 * through here. `grudged` is an attack, whose advantage onRoll has already folded as the foe's grudge
	 * (combat/attack-flow.js#attackFoeAdvantage), so only Tough Love's disadvantage is folded here.
	 *
	 * Resolves `options` folded, and `spend`, which uses up the "next roll against them" advantages once the
	 * dice have landed, named or not: this was the next roll against them. And `oathbreaker`, whether the
	 * oath was asked and named here, so Binding Arbitration's line is not named twice.
	 */
	_foldAimedModes(options, targets, { grudged = false } = {}) {
		if (!targets?.length) return { options, spend: async () => {}, oathbreaker: false };
		const oathbreaker = grudged ? null : oathbreakerAgainst(this._actor, targets);
		const upAgain = upAgainAgainst(this._actor, targets);
		const alpha = alphaAgainst(this._actor, targets);
		const toughLove = toughLoveAgainst(this._actor, targets);
		const advantage = grudged ? null : oathbreaker ?? upAgain ?? alpha;
		let folded = advantage ? foldAdvantage(options, advantage) : options;
		if (toughLove) folded = foldDisadvantage(folded, toughLove);
		const spend = async () => {
			if (alpha) await spendAlphaOver(this._actor, targets);
			if (upAgain) await spendUpAgainRoll(this._actor, targets);
		};
		return { options: folded, spend, oathbreaker: !!oathbreaker };
	}

	/**
	 * `options` with the standing modes on `moveName` folded in, for both roll paths: a background's
	 * advantage (Raised by Wolves on Forage), then a season's disadvantage (winter on Forage), so the
	 * two cancel.
	 */
	_foldStandingModes(options, moveName) {
		const upbringing = this.backgroundMoveAdvantage(moveName);
		const season = this.seasonMoveDisadvantage(moveName);
		let folded = upbringing ? foldAdvantage(options, upbringing) : options;
		if (season) folded = foldDisadvantage(folded, season);
		return folded;
	}

	/**
	 * What every roll card of this character's says on a row, whatever the move: a Ghost's or Revenant's
	 * UNSTABLE, "When you roll a 6-, the GM can choose to have you enter such a rage (as per Breakdown)",
	 * on the 6- row (roll-engine's tierActions, so a GM's Shift onto or off the miss moves it too). A
	 * reminder for the GM, not an automation: the choice is theirs. On the worn insert only, as the roll
	 * window's post-death lines are (_earnsRollOffer).
	 */
	_foldStandingNotes(options) {
		if (!this._postDeath.wornMarked(UNSTABLE_LORE)) return options;
		const note = `<p class="stonetop-roll-offer-note">${_loc("stonetop.postDeathMoves.unstableNote")}</p>`;
		return { ...options, ..._withTierActions(options, { failure: note }) };
	}

	/**
	 * Every purse this character can pay a Stock cost out of, read LIVE: the pouch (its real max
	 * and whether it is held, preselected included), the Boon of a learned Rites of the Land, and
	 * a Vessel's HP. The ONE reader for both payers, the sheet's dialog and the chat card's Spend
	 * button, so they cannot disagree; and asked rather than read off a snapshot, because a
	 * snapshot exists only once the sheet has rendered.
	 */
	async stockSources() {
		// Resolved once for both questions below: Recover asks this of every carer in the party.
		const playbookData = await this.playbook();
		return stockSourcesForFlags({
			possessions:   this._possessions,
			moveResources: this._moveResources.getMoveResources(),
			ritesMax:      this.ritesBoonMax() || null,
			pouchMax:      await this.sacredPouchMax(playbookData),
			hasPouch:      await this.holdsPossession(SACRED_POUCH_SLUG, playbookData),
			vesselHp:      this.isVessel ? this.hp : null,
		});
	}

	/**
	 * Pay `amount` Stock out of `source` (one of stockSources' purses). The purse knows which way
	 * its track counts (the pouch up as it empties, the Boon down); a Vessel's HP has no track and
	 * is paid by a visible 2d4 roll instead. Returns `{ lost }`, the HP a Vessel lost (0 otherwise).
	 */
	async spendStock(source, amount = 1, { moveName = "", speaker } = {}) {
		if (source?.vessel) {
			const { lost } = await loseHpForStock(this._actor, { amount, moveName, speaker });
			return { lost };
		}
		const next = source.after(amount);
		if (source.key === "boon") {
			await this._moveResources.setUses(RITES_OF_THE_LAND, next, moveName ? { stonetopMove: moveName } : undefined);
		} else {
			await this._possessions.setUses(SACRED_POUCH_SLUG, next);
		}
		return { lost: 0 };
	}

	/** "Hold N Boon" — the move SETS the track rather than adding to it. */
	async setRitesBoon(held) {
		const max = this.ritesBoonMax();
		const value = Math.max(0, Math.min(max, Math.trunc(Number(held) || 0)));
		await this._moveResources.setUses(RITES_OF_THE_LAND, value, { stonetopMove: RITES_OF_THE_LAND });
	}

	getSteadingActor() {
		const storedSteadingId = resolvedFlagProperty(this._actor, "steadingId");
		return (storedSteadingId ? game.actors?.get(storedSteadingId) : null)
			?? getStonetopSteadingActor();
	}

	/**
	 * Whether the steading has earned Weapons of War: the improvement in force by the one rule every
	 * reader asks (improvement-rules.js), so built, or "Weapons of War" ticked on its Fortifications
	 * list (a GM who wrote it there by hand, or a homebrew improvement that adds it), and not
	 * retired by another improvement.
	 */
	weaponsOfWarEarned(steading = this.getSteadingActor()) {
		if (!steading) return false;
		const rules = (steading.typedActor ?? new StonetopSteading(steading)).improvementRules?.() ?? [];
		return rulesHas(rules)(_WEAPONS_OF_WAR_IMPROVEMENT);
	}

	/**
	 * The special items Weapons of War makes common: "maces, flails, battleaxes, warhammers, and all
	 * types of swords". Only those: the Special Items handout's weapons section also holds the
	 * crossbow and the composite bow, which the improvement does not name.
	 */
	_earnedCommonSpecialSlugs(steading, allItems) {
		if (!this.weaponsOfWarEarned(steading)) return new Set();
		return new Set(allItems
			.filter(i => i.special && i.specialCategory === _WEAPONS_OF_WAR_CATEGORY && WEAPONS_OF_WAR_COMMON.has(i.slug))
			.map(i => i.slug));
	}

	// 4+Prosperity, the Prosperity being the one gear works from (effectiveProsperity: 1 lower while
	// the steading is Lacking). FALLBACK_FOUR_PLUS_PROSPERITY (4+0) when it can't be read, so every
	// reader gets a number. The few that must know it was NOT read (the "x piercing" captions, which
	// keep the literal x, and the notes that print the limit) ask effectiveProsperity themselves, or
	// the snapshot's `prosperity` / `prosperityKnown`.
	getSmallItemLimit(steading = this.getSteadingActor()) {
		const prosperity = effectiveProsperity(steading);
		return prosperity === null ? FALLBACK_FOUR_PLUS_PROSPERITY : 4 + prosperity;
	}

	/**
	 * The uses in one ◆ of supplies: 4+Prosperity (Book I p.89), and 1 more once the steading has a
	 * Mill. 4+0 when Prosperity cannot be read ("+0 by default", p.88), and a Mill still adds its 1.
	 *
	 * The Mill's text says "when you Outfit from Stonetop", and nothing records where an Outfit
	 * happened, so an earned Mill always counts: the same reading Weapons of War gets.
	 */
	getUsesPerSupply(steading = this.getSteadingActor()) {
		const limit = this.getSmallItemLimit(steading);
		if (!steading) return limit;
		const steadingFlags = resolvedFlagProperty(steading, "steading") ?? {};
		const mill =!!steadingFlags.improvements?.[_MILL_IMPROVEMENT]?.completed
			// A Resources row is `{name, checked}`: one left unticked is not a Mill the village has.
			|| (steadingFlags.resources ?? []).some(r => String(r?.name ?? r) === _MILL_RESOURCE && r?.checked !== false);
		return limit + (mill ? 1 : 0);
	}

	/**
	 * What this character can spend uses of supplies from (supply-cost.js#spendablePurseResources):
	 * the printed supplies rows they are CARRYING (`inventory.checked`; provisions and sap count
	 * marked or not), every purse capped at the size the sheet draws its
	 * track at. A printed supplies row is 4+Prosperity (+1 with a Mill, getUsesPerSupply) and an
	 * acquired track (provisions) is its `resourceMax`, the same order of precedence as the sheet's
	 * own rows (_buildInventorySection's mapItem). `per` is the uses in one ◆ when the caller already
	 * has it (the snapshot's OutfitSnapshot#usesPerSupply), so a render does not read the steading again.
	 */
	supplyPurseLimits(per = this.getUsesPerSupply()) {
		const max = Object.fromEntries(SUPPLY_SLUGS.map(slug => [slug, per]));
		for (const [slug, acquired] of Object.entries(this._inventory.resourceMax)) {
			if (Number.isFinite(Number(acquired))) max[slug] = Number(acquired);
		}
		return { checked: this._inventory.checked, max };
	}

	/**
	 * `inventory.resources` as a spend sees it (supplyPurseLimits); every non-purse track as stored.
	 * `carriedOnly: false` keeps the cap but not the carrying test, for a write that pays a spend
	 * already agreed: a row set down between the offer and the write must not be zeroed by it.
	 * `per` is the uses in one ◆ when the caller already read it (supplyPurseLimits).
	 */
	spendablePurseResources({ carriedOnly = true, per = undefined } = {}) {
		const { checked, max } = this.supplyPurseLimits(per);
		return _spendablePurseResources(this._inventory.resources, { checked: carriedOnly ? checked : null, max });
	}

	/**
	 * supply-cost.js#supplyPursesFor over what this character can actually reach. `usesPerSupply`
	 * as supplyPurseLimits takes it, when the caller already has the snapshot's.
	 */
	supplyPurses(purpose, { usesPerSupply } = {}) {
		return supplyPursesFor(this._inventory.resources, purpose, this.supplyPurseLimits(usesPerSupply));
	}

	/**
	 * Mark or un-mark an item on the Inventory tab.
	 *
	 * Have What You Need (the default): marking an item draws marks from the undefined pool (its
	 * weight, or 1 for a small item). If the pool can't cover it, the shortfall just adds to your
	 * load. We remember how much each mark drew so un-marking returns exactly that (an item defined
	 * at Outfit drew nothing, so un-marking just drops its weight), so toggling can never invent
	 * reserve marks. The pool is also directly editable, so any state is reachable.
	 *
	 * `loot`: something picked up in the field (a dropped treasure, provisions) is weight on top of
	 * what was Outfitted, not a mark that was there all along, so it draws NOTHING from the reserve
	 * and the load grows by its weight, past heavy if need be (Book I p.327).
	 *
	 * A ◆ of supplies is its food, and the tick moves the ◆, not the food (supply-cost.js#
	 * suppliesUsesOnMark, #suppliesGiveBack): a mark that DRAWS an undefined ◆ packs a fresh, full
	 * one ("one ◆ of supplies contains 4 uses, but you add Stonetop's current Prosperity to that",
	 * Book I p.88), any other mark picks the row up as it is, and un-marking a ◆ some of whose food
	 * is gone hands back no undefined ◆. So un-ticking and re-ticking can never refill a row.
	 *
	 * @param {string}  slug
	 * @param {boolean} isChecked  Whether the item is now carried.
	 * @param {object}  opts
	 * @param {boolean} [opts.small]   Small item (□, costs 1) vs regular item (◇, costs its weight).
	 * @param {number}  [opts.weight]  Regular item weight (◇ to move).
	 * @param {boolean} [opts.loot]    Gained in the field: draws nothing from the undefined pool.
	 * @param {number}  [opts.uses]    The row's uses to write with the mark, when the caller packs it
	 *   to a count of its own (Have What You Need at the fire, camp-store.js#haveWhatYouNeedAtCamp).
	 * @param {string}  [opts.stonetopMove]  The move the ledger names for these writes, when a move made them.
	 *
	 * Every change (the mark, the uses, the draw record, the pool) goes out in ONE actor.update, each
	 * as its own dotted sub-key so a second client's write to a sibling key is left standing. The
	 * ledger still files a line per field, as it did when they were separate writes.
	 */
	async toggleCarriedItem(slug, isChecked, { small = false, weight = 1, loot = false, uses: setUses, stonetopMove } = {}) {
		const writeOptions = stonetopMove ? { stonetopMove } : undefined;
		const wasChecked = !!this._inventory.checked[slug];
		const supplies   = SUPPLY_SLUGS.includes(slug);
		const perSupply  = supplies ? this.getUsesPerSupply() : 0;
		const uses       = supplies ? Number(this._inventory.resources[slug]) || 0 : 0;
		const update = this._inventory.checkedData(slug, isChecked);
		const cost  = small ? 1 : Math.max(0, weight);
		const pool  = small ? this._inventory.smallPool : this._inventory.regularPool;
		const drawn = Number(this._inventory.drawn[slug]) || 0;
		let next;
		let nextDrawn;
		if (isChecked) {
			nextDrawn = loot ? 0 : Math.min(cost, pool);
			next = pool - nextDrawn;
		} else {
			next = pool + (supplies ? suppliesGiveBack({ drawn, uses, perSupply }) : drawn);
			nextDrawn = 0;
		}
		if (setUses !== undefined) {
			Object.assign(update, this._inventory.resourceData(slug, setUses));
		} else if (supplies && isChecked && !wasChecked) {
			const packed = suppliesUsesOnMark({ drew: nextDrawn, uses, perSupply });
			if (packed !== uses) Object.assign(update, this._inventory.resourceData(slug, packed));
		}
		Object.assign(update, this._inventory.drawnData(slug, nextDrawn), this._inventory.poolData(next, { small }));
		await this._actor.update(update, writeOptions);
	}

	/**
	 * Mark a WRITTEN-IN item (or a treasure: one kept from an earlier trip is a possession the PC
	 * can "Have What You Need ... to mark ... once you're in the field", Book I p.89) as carried,
	 * asking where it came from (write-in-source.js): had all
	 * along (Have What You Need, which moves an undefined mark onto it) or found out here (new
	 * weight, which draws nothing). Asked only while the matching undefined pool has a mark the
	 * first answer could use; with none left it can only be new, and is marked as such unasked.
	 *
	 * Resolves to the answer (WRITE_IN_SOURCE), or null when the window was closed, in which case
	 * nothing is written and the item stays unmarked. Un-marking goes through toggleCarriedItem as
	 * ever, handing back exactly what the draw record says.
	 */
	async markWriteInCarried(slug, { name = "", small = false, weight = 1, stonetopMove } = {}) {
		const pool = small ? this._inventory.smallPool : this._inventory.regularPool;
		const cost = small ? 1 : Math.max(0, Number(weight) || 0);
		const answer = pool > 0 && cost > 0
			? await askWriteInSource({ name, small, weight: cost, pool })
			: WRITE_IN_SOURCE.FOUND;
		if (!answer) return null;
		await this.toggleCarriedItem(slug, true, { small, weight, loot: answer === WRITE_IN_SOURCE.FOUND, stonetopMove });
		return answer;
	}

	// Outfit batch-marks the inventory: it writes the checked items and the two
	// "undefined" ◇/□ reserves. Load itself is derived from the marks, so there's
	// nothing else to store. Outfit redefines the whole loadout, so the per-item
	// draw records are cleared — its checked items are defined load, not drawn from
	// the reserve. The pools and item marks stay freely editable afterwards.
	//
	// A special possession's chosen gear (Weapons of War) keeps its carry mark in a store of its
	// own, possessions.choiceCarried, so its `poss:choice` keys are sent there and every other key
	// to inventory.checked. The split is by the colon: a gear-choice key has one and no outfit
	// slug or item id ever does (see _gearSources). Unmarked rows are written as `false`, which is
	// what clears them: both stores merge, so a key left out would keep its old mark. The draw
	// records go by an unset for the same reason: an empty map written over them changed nothing.
	//
	// Outfit packs the food: every supplies row it leaves marked is full, whether or not it was
	// marked before (a second Outfit restocks a row eaten down on the last trip, Book I p.77, p.88),
	// and a row it leaves unmarked holds nothing, food left at home (_suppliesEmptied).
	async applyOutfit(checkedMap, regularPool = 0, smallPool = 0) {
		const itemMarks   = {};
		const choiceMarks = {};
		for (const [key, value] of Object.entries(checkedMap ?? {})) {
			(key.includes(":") ? choiceMarks : itemMarks)[key] = !!value;
		}
		const packed = SUPPLY_SLUGS.filter(slug => itemMarks[slug]);
		const usesPerSupply = packed.length ? this.getUsesPerSupply() : 0;
		const resources = this._inventory.resources;
		const packing = [
			...packed.filter(slug => Number(resources[slug]) !== usesPerSupply).map(slug => [slug, usesPerSupply]),
			...this._suppliesEmptied(SUPPLY_SLUGS.filter(slug => slug in itemMarks && !itemMarks[slug])),
		];
		// ONE update for the lot, every mark and track its own dotted sub-key (see toggleCarriedItem).
		await this._actor.update(Object.assign(
			this._inventory.allCheckedData(itemMarks),
			this._possessions.choicesCarriedData(choiceMarks),
			this._inventory.poolData(regularPool),
			this._inventory.poolData(smallPool, { small: true }),
			this._inventory.clearDrawnData(),
			...packing.map(([slug, count]) => this._inventory.resourceData(slug, count)),
		));
		// All in the Wrist: "Reset your ammo whenever you Outfit." The blades' track is the move's own
		// (data/weapons.js), counting boxes marked, so a reset is a zero. Written only when something is
		// marked, so an Outfit by anyone else costs no extra update. A write of its own, not folded into
		// the one above: it carries the move's name for the ledger, and an update names one move for
		// every line it files.
		if ((Number(this._moveResources.getMoveResources()?.[ALL_IN_THE_WRIST]) || 0) > 0) {
			await this._moveResources.setUses(ALL_IN_THE_WRIST, 0, { stonetopMove: ALL_IN_THE_WRIST });
		}
	}

	// "Clear all item marks", wherever a mark lives: the chosen gear of a special possession (Weapons
	// of War, the Judge's shield) keeps its own in possessions.choiceCarried, and left there it went
	// on counting toward load and armor after the Reset. The supplies rows set down go empty with
	// them ("When you return home, clear the marks from your Inventory insert", Book I p.89): food in
	// the larder is not tracked, and the next trip's ◆ of supplies is packed fresh.
	async resetInventorySelections() {
		await this._actor.update(Object.assign(
			this._inventory.resetSelectionsData(),
			this._possessions.clearCarriedData(),
			...this._suppliesEmptied(SUPPLY_SLUGS).map(([slug, count]) => this._inventory.resourceData(slug, count)),
		));
	}

	/** `[slug, 0]` for each of these supplies rows that still holds a use, so emptying writes only what changes. */
	_suppliesEmptied(slugs) {
		const resources = this._inventory.resources;
		return slugs.filter(slug => (Number(resources[slug]) || 0) > 0).map(slug => [slug, 0]);
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
		const { column: rawColumn, resource, armor, shield, isTreasure } = read;
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
			// And whether it is a shield. Dropped with the armor it rides on: a makerglass shield
			// re-planted without this kept its 2 armor and silently stopped buying "+1 Readiness
			// on a Defend 7+", which is the whole reason the flag exists.
			shield,
			resourceFirst: read.resourceFirst,
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
		// A write-up the GM edited stays theirs on the sheet copy too: the load-time back-fill
		// walks the copies in play as well as the sidebar (see WRITEUP_EDITED_FLAG).
		if (itemData?.flags?.[ITEM_FLAG_SCOPE]?.[WRITEUP_EDITED_FLAG]) {
			data.flags = { [ITEM_FLAG_SCOPE]: { [WRITEUP_EDITED_FLAG]: true } };
		}
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
		await item.update(buildCustomMoveData(input, { requirement: item.system?.requirement }));
	}

	// Toggle a move between learned (active — rollable, bonuses apply) and un-learned (kept
	// on the sheet but inactive). Persisted as an item flag; an absent flag means learned, so
	// a fresh move never needs the flag written to default to learned. Applies to ANY owned
	// move, not just player-authored ones: a move dropped onto the sheet from another
	// playbook is exactly as reversible as a homebrew one, and isMoveLearned (which gates
	// the roll icon and every per-move bonus) has always read the flag off any item.
	async setMoveLearned(itemId, learned) {
		const item = this._actor.items.get(itemId);
		if (!item) return;
		await item.setFlag(STONETOP_SCOPE, "learned", !!learned);
	}

	// A possession's `usesBonus` (playbook data) grows its max: the Blessed's pouch +1 each even level
	// and +2 per Big Magic. The Seeker's, from Initiate of the Secret Arts ("as per the Blessed"),
	// carries `sinceGranted`: Level Up step 4, Book I p.528, "If you are the Blessed (or have a sacred
	// pouch) and your new level is even, increase your max Stock by 1", so it grows only from the
	// level it was granted at. Step 3 (choose the move) comes before step 4, so a pouch taken on an
	// even level-up gains that level's +1 at once. A pouch granted before its level was recorded
	// counts from `earliestGrant`, the first level Initiate can be taken at (it requires level 2);
	// reading such a pouch flat would leave a level-8 Seeker at 3 Stock instead of 7.
	computePossessionMaxUses(specialPossessions, ownedAllByName, level) {
		const result = { ...this._possessions.maxUses };
		for (const opt of (specialPossessions?.options ?? [])) {
			const usesBonus = opt.usesBonus;
			if (!usesBonus) continue;
			let bonus = 0;
			if (usesBonus.evenLevelBonus) {
				// The Blessed has had the pouch since level 1. A pouch granted later counts only
				// the even levels from the one it arrived at (unrecorded: its earliest possible).
				const from = usesBonus.sinceGranted
					? (this._possessions.grantedAtLevel[opt.slug] ?? usesBonus.earliestGrant ?? level + 1)
					: 1;
				bonus += _evenLevelsBetween(from, level) * usesBonus.evenLevelBonus;
			}
			// LEARNED copies only: an un-learned Big Magic stays on the sheet switched off, and
			// its "+2 max Stock" must not keep growing the pouch.
			bonus += sumMoveBonus(usesBonus.moveBonus, n => (ownedAllByName.get(n) ?? []).filter(i => moveLearnedIn(i, this._actor.items)).length);
			if (bonus > 0) result[opt.slug] = (opt.resource?.max ?? 0) + bonus;
		}
		return result;
	}

	// Whether this character has a special possession, picked or preselected, for a caller with
	// no snapshot (a chat card asking about trapping gear or a sacred pouch). `playbookData` for a
	// caller that has already resolved it.
	async holdsPossession(slug, playbookData = undefined) {
		const pb = playbookData === undefined ? await this.playbook() : playbookData;
		return this._selectedPossessionSlugs(pb).has(slug) && !this._grantSuspended(slug, pb);
	}

	// A grant-only possession (the Seeker's Sacred Pouch, from Initiate of the Secret Arts) whose
	// every granting move is switched off: kept, uses and all, but not held for spending until a
	// granter is learned again (the user's ruling). Never one the playbook preselects, and never
	// one no move on the sheet grants (nothing to switch back on). A possession the playbook does
	// not list at all (a Would-be Hero's pouch through a dropped-on Initiate) is held by the grant
	// alone, so it counts as grant-only.
	_grantSuspended(slug, playbookData) {
		const sp  = playbookData?.specialPossessions;
		const opt = sp?.options?.find(o => o.slug === slug);
		if ((opt && !opt.grantOnly) || (sp?.preselected ?? []).includes(slug)) return false;
		const granters = this._actor.items.filter(i => i.type === "move" && i.system?.crossPlaybook?.grantsPossession === slug);
		return granters.length > 0 && !granters.some(i => moveLearnedIn(i, this._actor.items));
	}

	// The sacred pouch's real max Stock, worked out now (for a caller with no snapshot, like
	// the chat card's Spend button): the printed 3 plus even levels and Big Magic. Null when
	// the playbook offers no pouch. `playbookData` for a caller that has already resolved it.
	async sacredPouchMax(playbookData = undefined) {
		const pb = playbookData === undefined ? await this.playbook() : playbookData;
		const options = pb?.specialPossessions?.options ?? [];
		const printed = options.find(o => o.slug === SACRED_POUCH_SLUG)?.resource?.max ?? null;
		if (printed == null) return null;
		const derived = this.computePossessionMaxUses(pb.specialPossessions, this._buildOwnedMovesMap(), this._characterLevel);
		return derived[SACRED_POUCH_SLUG] ?? printed;
	}

	// Move name → how many of that move the actor has LEARNED (an un-learned copy is kept on
	// the sheet switched off, and grants nothing). Feeds sub-choice caps that grow with a move
	// (the Blessed's sacred-pouch remarkable traits, +1 per Big Magic).
	ownedMoveCounts() {
		const counts = {};
		for (const [name, items] of this._buildOwnedMovesMap()) counts[name] = items.filter(i => moveLearnedIn(i, this._actor.items)).length;
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
	// for each held possession not yet marked applied, then mark it, so it happens
	// once and never fights a later deletion. Idempotent (grantsToCreate skips items
	// already present), so a character already carrying its gear just gains the mark.
	//
	// "Held" is the selection AND the playbook's preselected possessions, which the sheet treats
	// as held without their ever being selected: only onboarding selects them, so a Judge whose
	// playbook was dropped on and whose onboarding was closed had Scribe's tools ticked and locked
	// with no Parchment, Ink or Notebook. Also run on a playbook drop, so that gear arrives then.
	async ensurePossessionGrants() {
		// Bail before resolving the playbook (a pack lookup, run per character on world
		// load) when there's nothing to back-fill: every selected possession already marked
		// applied, and the preselected ones already walked for THIS playbook (which ones they
		// are needs the playbook, so the slug they were walked for is recorded instead). The
		// steady state after the first run.
		const selected = [...this._possessions.selected];
		const applied = this._possessionGrantsApplied();
		const playbookSlug = this._actor.system?.playbook?.slug || null;
		const preselectedWalked = !playbookSlug
			|| this._actor.getFlag(STONETOP_SCOPE, POSSESSION_PRESELECTED_WALKED_FLAG) === playbookSlug;
		if (preselectedWalked && selected.every(slug => applied[slug])) return;
		const playbookData = await this.playbook();
		// Unresolved (a missing pack): leave the marker unwritten, so a later load tries again.
		if (!playbookData) return;
		const sp = playbookData.specialPossessions;
		const options = sp?.options ?? [];
		const held = [...new Set([...selected, ...(sp?.preselected ?? [])])];
		for (const slug of held) {
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
		if (this._actor.getFlag(STONETOP_SCOPE, POSSESSION_PRESELECTED_WALKED_FLAG) !== playbookSlug) {
			await this._actor.setFlag(STONETOP_SCOPE, POSSESSION_PRESELECTED_WALKED_FLAG, playbookSlug);
		}
		// The playbook is resolved now anyway, so bring the gear already there up to its grants
		// too. The steady state bails above without reaching this; the once-per-version sweep in
		// Ready (migration/possession-grant-repair.js) is what reaches those characters.
		await this.repairPossessionGrants(playbookData);
	}

	/**
	 * Bring every item a possession granted up to its grant as the playbook authors it NOW, for
	 * the gear made before a grant was corrected: grantsToCreate runs once per item and nothing
	 * revisits it, so the Tannery cuirass made as `{modifier: 1}` (1.3.2 to 1.6.0) went on
	 * stacking on a hauberk, and read as armored by modifier alone, long after the grant said
	 * `{base: 1}`. What is compared and what is left alone is possession-grants.js#grantRepair.
	 *
	 * Only TAGGED items (`sourcePossession`) are touched, and only one whose grant can be named
	 * (grantOfTaggedItem): hand-written gear, and untagged legacy gear adopted by name, are the
	 * player's to shape. The marks are never written. A stored track count is clamped only when
	 * the track it counts on got smaller. Idempotent: a matching item produces no update, so a
	 * second run writes nothing.
	 *
	 * @param {object} [playbookData]  the resolved playbook, when the caller already has it
	 * @returns {Promise<number>} how many items were rewritten
	 */
	async repairPossessionGrants(playbookData = undefined) {
		// Bail before resolving the playbook when there is no tagged gear to compare.
		const tagged = this._actor.items.filter(i => i.type === "move"
			&& i.system?.moveType === "inventory-custom" && i.system?.sourcePossession);
		if (!tagged.length) return 0;
		const pb = playbookData === undefined ? await this.playbook() : playbookData;
		const bySlug = new Map((pb?.specialPossessions?.options ?? []).map(o => [o.slug, o]));
		if (!bySlug.size) return 0;
		const resources = this._inventory.resources;
		const updates = [];
		const clamps  = [];
		for (const item of tagged) {
			const repair = grantRepair(item, grantOfTaggedItem(item, bySlug.get(item.system.sourcePossession)));
			if (!repair) continue;
			updates.push({ _id: item._id, ...repair.update });
			const count = Number(resources[item._id]);
			if (repair.resourceMax != null && count > repair.resourceMax) clamps.push([item._id, repair.resourceMax]);
		}
		// Quiet in the ledger: a repair to match the playbook's text, not an edit anybody made.
		if (updates.length) await this._actor.updateEmbeddedDocuments("Item", updates, { stonetopLedger: true });
		for (const [id, max] of clamps) await this._inventory.setResource(id, max);
		return updates.length;
	}
	/**
	 * The actor.update fragment that keeps no more pips on a track than its new, smaller size, for
	 * held items whose track the pack shrank (migration/move-refresh.js: Unstoppable's six circles
	 * becoming the book's five). A move's track is stored by its name, a piece of gear's by its item
	 * id. Null when nothing stored is over.
	 *
	 * @param {Array<{item: object, max: number}>} shrunk
	 * @returns {object|null}
	 */
	heldTrackClampData(shrunk = []) {
		const moves = this._moveResources.getMoveResources();
		const gear = this._inventory.resources;
		let data = null;
		for (const { item, max } of shrunk) {
			const gearItem = isGear(item);
			const key = gearItem ? item._id : item?.name;
			// A dotted name would write a nested path instead of its own key.
			if (!key || key.includes(".")) continue;
			const stored = Number((gearItem ? gear : moves)[key]);
			if (!(stored > max)) continue;
			data = { ...data, ...(gearItem ? this._inventory.resourceData(key, max) : this._moveResources.usesUpdate(key, max)) };
		}
		return data;
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
	async setSubChoiceUses(possessionSlug, choiceSlug, count, options) { await this._possessions.setChoiceUses(possessionSlug, choiceSlug, count, options); }
	/** The ○○ count on one gear-choice option. The read half of setSubChoiceUses, so the
	 *  `possessions.choiceUses` path and its `possession:choice` key shape stay in the class
	 *  that owns that store rather than being spelled out again by the combat flow. */
	subChoiceUses(possessionSlug, choiceSlug) { return Number(this._possessions.choiceUses[`${possessionSlug}:${choiceSlug}`]) || 0; }
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
			playbookMoves = this.sortPlaybookMoves(this.buildMovelistContext(entries, ownedAllByName, bgMoveNames, actorLevel, playbookName, this._startingChoiceGroups(playbookData)));

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

	// The same, reading the playbook itself.
	async selectedBackground() {
		return this._selectedBackground(await this.playbook());
	}

	// The moves that background hands over, with the player's own setup-choice picks
	// folded in (see backgroundMoveNames).
	_backgroundMoveNames(background) {
		return backgroundMoveNames(background, this._background.setupChoices);
	}

	// The background chosen and the setup picks made under it, as settleBackgroundMoves wants
	// them: read BEFORE a change of background, so what the old one gave can be taken back.
	backgroundState() {
		return { slug: this._background.selectedSlug, setupChoices: { ...this._background.setupChoices } };
	}

	// The owned moves a change of background from `from` to `to` (each a backgroundState) takes
	// back: what the old background gave, less what the new one gives too, less any move the
	// character also holds some other way (see _heldBesidesBackground). Every background shape
	// counts, through backgroundMoveNames: a flat `moves` list (Rites of the Land) and a move taken
	// in a setup choice (A Life of Crime's Burgle OR Light Fingers), so changing only that pick
	// takes back the other. Asked before the change as well as by it, so the Details tab can warn
	// about a move with something held on its track.
	//
	// Only the copy the background gave goes, which ensureStartingMoves stamps (BACKGROUND_GRANT_FLAG):
	// a Scion who took the second Veteran Crew at a level-up keeps that one on becoming Penitent. A
	// copy from before the stamp can't be told from a pick, so at most ONE unstamped copy per name
	// goes (the earliest gained), never every copy of the name.
	async backgroundMovesDropped(from, to) {
		const playbookData = await this.playbook();
		const backgrounds  = playbookData?.backgrounds ?? [];
		const gives = state => backgroundMoveNames(backgrounds.find(b => b.slug === state?.slug), state?.setupChoices);
		const kept  = gives(to);
		const gone  = new Set([...gives(from)].filter(name => !kept.has(name)));
		if (!gone.size) return [];
		const dropped = [];
		for (const name of gone) {
			const copies = this._actor.items.filter(i => i.type === "move" && i.name === name
				&& (!i.system?.playbook || i.system.playbook === playbookData?.name));
			const stamped = copies.filter(_isBackgroundGrant);
			if (stamped.length) { dropped.push(...stamped); continue; }
			const legacy = _earliestFirst(copies.filter(i => !_heldBesidesBackground(i)))[0];
			if (legacy) dropped.push(legacy);
		}
		return dropped;
	}

	// Book I: "You start with Spirit Tongue, Call the Spirits, 1 from your Background, and 1 of
	// your choice." So a change of background takes back the old one's move and grants the new
	// one's; ensureStartingMoves alone only ever added, and the leftover then counted as a pick
	// and tripped the over-budget banner. Run once the new background and its setup picks are
	// stored, with what they were before (backgroundState). The ONE path for the Details tab's
	// dropdown and for onboarding. Through removeMove, so the move's own bookkeeping goes with it;
	// a shipped move's track is keyed by its name and is there again if the move comes back.
	//
	// The moves the new background gives that the old one didn't (`newlyGiven`) are handed to
	// ensureStartingMoves, so a copy the character already held (a Penitent's level-up Veteran
	// Crew) stays their pick and the Scion's own copy is added beside it.
	async settleBackgroundMoves(previous) {
		const current = this.backgroundState();
		for (const item of await this.backgroundMovesDropped(previous, current)) {
			if (this._actor.items.some(i => i._id === item._id)) await this.removeMove(item._id);
		}
		if ((previous?.slug ?? "") !== current.slug) await this._settleBackgroundAnswers(previous?.slug, current.slug);
		const backgrounds = (await this.playbook())?.backgrounds ?? [];
		const gives = state => backgroundMoveNames(backgrounds.find(b => b.slug === state?.slug), state?.setupChoices);
		const before = gives(previous);
		await this.ensureStartingMoves({ newlyGiven: new Set([...gives(current)].filter(name => !before.has(name))) });
	}

	// The possessions half of a change of background (backgroundPossessionSlugs): what the old one
	// handed over goes, with its gear, unless the new one hands it over too or the character holds
	// it some other way (the playbook's own gear, a move's grantsPossession); what the new one hands
	// over is selected. Left alone, a gift outlives its background and turns into an ordinary pick,
	// over the playbook's count. For the Details tab's dropdown; onboarding settles its own.
	async settleBackgroundPossessions(previous) {
		const playbookData = await this.playbook();
		const backgrounds  = playbookData?.backgrounds ?? [];
		const gives = state => backgroundPossessionSlugs(backgrounds.find(b => b.slug === state?.slug), state?.setupChoices);
		const kept  = gives(this.backgroundState());
		const held  = new Set([
			...(playbookData?.specialPossessions?.preselected ?? []),
			...this._actor.items.filter(i => i.type === "move").map(i => i.system?.crossPlaybook?.grantsPossession).filter(Boolean),
		]);
		for (const slug of gives(previous)) {
			if (kept.has(slug) || held.has(slug) || !this._possessions.selected.has(slug)) continue;
			await this.deselectPossession(slug);
		}
		for (const slug of kept) {
			if (!this._possessions.selected.has(slug)) await this.selectPossession(slug);
		}
	}

	// The arcana half of a change of background: a background's `setup.arcana` rows ({ slug,
	// identify, boxes: [{ context, index }] }), the Heavy's Storm-Marked ("You start with the Storm
	// Markings major arcanum. Mark one of the boxes on the front"). The ONE writer of those rows,
	// for the Details tab's dropdown and for onboarding alike. What the new background hands over
	// is added, identified and marked, unless the card is already owned: a re-run of the same
	// background leaves the card as play has left it. What the old one handed over goes only while
	// the card is exactly as it was given (_arcanumAsGranted); a card with play on it stays.
	async settleBackgroundArcana(previous) {
		const backgrounds = (await this.playbook())?.backgrounds ?? [];
		const rowsOf = slug => (backgrounds.find(b => b.slug === slug)?.setup?.arcana ?? []).filter(row => row?.slug);
		const next   = rowsOf(this.backgroundState().slug);
		const kept   = new Set(next.map(row => row.slug));
		for (const row of rowsOf(previous?.slug)) {
			if (kept.has(row.slug) || !this._arcanumAsGranted(row)) continue;
			await this.removeArcanum(row.slug);
		}
		for (const row of next) {
			if (this._arcana.ownedSlugs.has(row.slug)) continue;
			await this.addArcanum(row.slug);
			if (row.identify) await this.identifyArcanum(row.slug);
			for (const box of row.boxes ?? []) {
				await this.setArcanumBoxChecked(row.slug, box.context ?? "front", Number(box.index ?? 0), true);
			}
		}
	}

	// The tracks half of a change of background on the Details tab: the new background's setup tracks
	// start EMPTY. "At the very start of play, hold 3 Enigma" is onboarding's to give (its apply seeds
	// each track's `value`), and so is a character's first background, picked here instead: they are
	// still at the start. A switch from another background is mid-play, so the Itinerant Mystic
	// arrives holding no Enigma, and a return to a background finds its track emptied too.
	async settleBackgroundResources(previous) {
		const slug = this.backgroundState().slug;
		if (!previous?.slug || !slug || previous.slug === slug) return;
		const background = ((await this.playbook())?.backgrounds ?? []).find(b => b.slug === slug);
		for (const resource of background?.setup?.resources ?? []) {
			if (resource?.key) await this._background.setSetupResource(resource.key, 0);
		}
	}

	// A background's arcanum untouched since it was given: the card's own state is the row's
	// (CharacterArcana#isAsGranted) and nothing sits on its tracks (Storm Markings' Fury).
	_arcanumAsGranted(row) {
		const resources = this._inventory.resources;
		const onTrack = key => Number(resources[key]) > 0;
		return this._arcana.isAsGranted(row) && !onTrack(row.slug) && !onTrack(`${row.slug}:item`);
	}

	/** The Seeker's stored creation arcana (seeker-collection.js#seekerArcanaState). */
	seekerCreationState() {
		const arcana = this._arcana;
		return seekerArcanaState({
			major: arcana.majorSlug, minorDraw: arcana.minorDrawSlugs, minorRoles: arcana.minorRoles, majorMarks: arcana.majorMarkKeys,
		});
	}

	// A Seeker's creation card untouched since creation gave it in `role`, as _arcanumAsGranted reads a
	// background's row: the major identified with its onboarding marks, the mastered card at its
	// mastery (CharacterArcana#masteryGrant), the found card identified and revealed (or identified
	// only, as creation gave it before the reveal), the lead a bare lead.
	async _seekerCardAsGranted(slug, role, state) {
		if (role === "major") return this._arcanumAsGranted({ slug, identify: true, boxes: majorMarkBoxes(state.majorMarks) });
		if (role === "lead")  return this._arcanumAsGranted({ slug, lead: true });
		if (role === "found") {
			return this._arcanumAsGranted({ slug, identify: true, reveal: true }) || this._arcanumAsGranted({ slug, identify: true });
		}
		const grant = await this._arcana.masteryGrant(slug);
		return !!grant && this._arcanumAsGranted({ slug, identify: true, boxes: grant.boxes, unlock: grant.unlock });
	}

	/**
	 * The Seeker's Collection, as creation (or a role picked on the sheet) chose it: `previous` is the
	 * bookkeeping stored last time (seekerCreationState), `next` the new choice. The ONE writer of
	 * the Seeker's creation arcana, for onboarding's apply and Save alike.
	 *
	 * A card creation gave and no longer gives goes only while it is as creation gave it
	 * (_seekerCardAsGranted); a card with play on it stays. A card whose role changed is given again
	 * in its new role: taken back first while untouched, and otherwise the old role's grant comes off
	 * only where the new one differs (a played mastered card chosen as the found one is un-mastered;
	 * a played card chosen as the lead stays held, since a card in hand can't be a lead). A card new to
	 * the choice is given: the major identified and marked, the mastered card identified and
	 * mastered, the found card identified and revealed ("review both sides"), the lead added as a lead
	 * unless it is already held. A card kept in its role is left as play has left it, so a lead
	 * discovered or deleted in play is not given again. The kept major's onboarding marks follow the
	 * new ones. Then the bookkeeping is stored.
	 */
	async settleSeekerArcana(previous, next) {
		const was = seekerArcanaState(previous);
		const now = seekerArcanaState(next);
		if (!seekerArcanaChosen(was) && !seekerArcanaChosen(now)) return;
		const wasRoles = seekerCardRoles(was);
		const nowRoles = seekerCardRoles(now);
		const owned = slug => this._arcana.ownedSlugs.has(slug);

		for (const [slug, role] of wasRoles) {
			const to = nowRoles.get(slug);
			if (to === role) continue;
			if (await this._seekerCardAsGranted(slug, role, was)) await this.removeArcanum(slug);
			else if (role === "mastered" && to === "found") await this._arcana.unmasterArcanum(slug);
		}

		const tick = async (slug, marks, checked) => {
			for (const box of majorMarkBoxes(marks)) await this.setArcanumBoxChecked(slug, box.context, box.index, checked);
		};
		for (const [slug, role] of nowRoles) {
			const from = wasRoles.get(slug);
			if (from === role) {
				if (role === "major" && owned(slug)) {
					const kept = new Set(now.majorMarks);
					await tick(slug, was.majorMarks.filter(key => !kept.has(key)), false);
					await tick(slug, now.majorMarks, true);
				}
				continue;
			}
			if (role === "lead") {
				if (!owned(slug)) await this.addLead(slug);
				continue;
			}
			if (!owned(slug)) await this.addArcanum(slug);
			await this._arcana.dropLead(slug);
			if (role === "found") {
				await this.identifyAndRevealArcanum(slug);
				continue;
			}
			if (!this._arcana.identifiedSlugs.has(slug)) await this.identifyArcanum(slug);
			if (role === "mastered") await this.masterArcanum(slug);
			else await tick(slug, now.majorMarks, true);
		}
		await this._arcana.setSeekerCreation(now);
	}

	/**
	 * The major half of a background switch on the Details tab (seekerMajorSwitchPlan): answers the
	 * plan, the new background and its offered majors. A "replace" plan has released the old major
	 * already, so the caller asks for the new one (chooseSeekerMajor).
	 */
	async settleSeekerMajorOnBackground() {
		const state      = this.seekerCreationState();
		const background = await this.selectedBackground();
		const offered    = background?.majorArcana ?? [];
		const held       = !!state.major && this._arcana.ownedSlugs.has(state.major);
		const asGranted  = held && await this._seekerCardAsGranted(state.major, "major", state);
		const plan       = seekerMajorSwitchPlan({ major: state.major, held, offered, asGranted });
		if (plan === "replace") await this.settleSeekerArcana(state, { ...state, major: "", majorMarks: [] });
		return { plan, background, offered, major: state.major };
	}

	/**
	 * Whether the current background still owes its major arcanum (seekerMajorOwed): the Arcana
	 * tab's "Choose your major arcanum" cue, left by "Choose later" on the Details tab's ask.
	 */
	async seekerMajorOwed(playbookData = undefined) {
		if (!this.backgroundState().slug) return false;
		const background = this._selectedBackground(playbookData === undefined ? await this.playbook() : playbookData);
		const offered    = background?.majorArcana ?? [];
		if (!offered.length) return false;
		const leads = this._arcana.leadSlugs;
		const owned = [...this._arcana.ownedSlugs].filter(s => !leads.has(s));
		return seekerMajorOwed({ offered, owned, major: this.seekerCreationState().major });
	}

	/** Give `major` as the Seeker's major arcanum with its 1 mark ("context:index" keys). */
	async chooseSeekerMajor(major, marks = []) {
		const state = this.seekerCreationState();
		await this.settleSeekerArcana(state, { ...state, major, majorMarks: marks });
	}

	// A background's `moveChoices` answer a move's question rather than grant it: the Seeker's
	// "Well Versed in the Things Below" is the Patriot's, stored as Well Versed's answer. On a
	// change of background the NEW one decides: its fixed answer is written (a first background
	// picked on the Details tab included); one that offers a choice keeps the old answer if it is
	// among the offers, and otherwise the answer goes, to be asked for (backgroundAnswerAsks, the
	// sheet's ask) rather than going on naming the old background's topic. An answer the old
	// background gave and the new one doesn't ask for goes too.
	async _settleBackgroundAnswers(fromSlug, toSlug) {
		const backgrounds = (await this.playbook())?.backgrounds ?? [];
		const was  = (backgrounds.find(b => b.slug === fromSlug)?.moveChoices ?? []).map(moveChoiceKey).filter(Boolean);
		const next = new Map((backgrounds.find(b => b.slug === toSlug)?.moveChoices ?? []).map(c => [moveChoiceKey(c), c]));
		next.delete("");
		const answers = resolvedFlags(this._actor).moves?.backgroundAnswers ?? {};
		const update  = {};
		for (const key of new Set([...was, ...next.keys()])) {
			const path   = `flags.${STONETOP_SCOPE}.moves.backgroundAnswers.${key}`;
			const choice = next.get(key);
			if (choice?.value) {
				if (answers[key]?.value !== choice.value) update[path] = { label: choice.label ?? key, value: choice.value };
			} else if (answers[key] && !(choice?.options ?? []).includes(answers[key].value)) {
				const [deleteKey, deleteValue] = deletionEntry(path);
				update[deleteKey] = deleteValue;
			}
		}
		if (Object.keys(update).length) await this._actor.update(update);
	}

	/**
	 * The current background's answers to moves that are the player's to pick (the Witch Hunter's
	 * "Well Versed in (pick 1) the Fae, the Things Below, or the Last Door"), with the answer held
	 * now (`value`, "" when none). The sheet asks these after a change of background, and from the
	 * card's cue while one is unanswered.
	 * @returns {Promise<Array<{key: string, move: string, label: string, options: string[], value: string}>>}
	 */
	async backgroundAnswerAsks() {
		const background = this._selectedBackground(await this.playbook());
		const answers = resolvedFlags(this._actor).moves?.backgroundAnswers ?? {};
		return (background?.moveChoices ?? [])
			.filter(choice => moveChoiceKey(choice) && !choice.value && choice.options?.length)
			.map(choice => {
				const key = moveChoiceKey(choice);
				const held = answers[key]?.value ?? "";
				return {
					key, move: choice.move ?? key, label: choice.label ?? key,
					options: [...choice.options],
					value: choice.options.includes(held) ? held : "",
				};
			});
	}

	/**
	 * Answer the current background's choice `key` with `value`, one of the offers it prints. Any
	 * other value is refused (false).
	 */
	async setBackgroundAnswer(key, value) {
		const choice = (this._selectedBackground(await this.playbook())?.moveChoices ?? [])
			.find(c => moveChoiceKey(c) === key);
		if (!choice?.options?.includes(value)) return false;
		await this._actor.update({ [`flags.${STONETOP_SCOPE}.moves.backgroundAnswers.${key}`]: { label: choice.label ?? key, value } });
		return true;
	}

	/**
	 * The moves the character took as onboarding's free pick ("1 of your choice"; the Would-be
	 * Hero's 2), so a re-run of onboarding can show them picked and replace them rather than add
	 * beside them. Onboarding stamps each with CREATION_PICK_FLAG (markCreationPick).
	 *
	 * A character made before the stamp has none. At 1st level every playbook move it holds that
	 * onboarding could have offered is one: no level-up has happened to add another. Past 1st
	 * level a level-up pick of the same kind of move (Barkskin at 3rd) can't be told from a free
	 * pick, so NONE are claimed, and onboarding never takes away a move a level-up gave. Picking it
	 * again on a re-run stamps it, which settles the question from then on.
	 *
	 * Synchronous, from the playbook as onboarding reads it: `backgrounds` and the "either X OR Y"
	 * `choiceGroups` (moves.choices), whose moves are never a free pick.
	 */
	creationPickItems(playbookName, backgrounds = [], choiceGroups = []) {
		const moves = this._actor.items.filter(i => i.type === "move" && i.system?.moveType === "playbook"
			&& i.system?.playbook === playbookName && !i.flags?.[STONETOP_SCOPE]?.grantedBy);
		const stamped = moves.filter(i => i.flags?.[STONETOP_SCOPE]?.[CREATION_PICK_FLAG]);
		if (stamped.length) return stamped;
		if ((this._actor.system?.attributes?.level?.value ?? 1) > 1) return [];
		const bgNames     = this._backgroundMoveNames((backgrounds ?? []).find(b => b.slug === this._background.selectedSlug));
		const choiceNames = startingMoveChoiceNames(choiceGroups);
		return moves.filter(i => !i.system?.isStartingMove && !bgNames.has(i.name) && !choiceNames.has(i.name)
			&& !(Number(i.system?.requirement?.level) > 1) && !i.system?.requirement?.marks);
	}

	// A re-run of onboarding REPLACES the free pick: each earlier one (creationPickItems) the
	// player didn't pick again is taken back, through removeMove so an Improved Stat's +1 comes off
	// and a pouch trait Big Magic freed goes with it. Before the base stats are written back, so
	// that +1 comes off the stat it was put on.
	async dropCreationPicksExcept(keepNames, playbookName, backgrounds = [], choiceGroups = []) {
		for (const item of this.creationPickItems(playbookName, backgrounds, choiceGroups)) {
			if (keepNames.has(item.name)) continue;
			if (!this._actor.items.some(i => i._id === item._id)) continue;
			await this._releaseStartGear(item);
			await this.removeMove(item._id);
		}
	}

	// Stamp an onboarding free pick (see creationPickItems): the move just added, or the copy
	// already owned when a re-run picked it again, never a copy of the name a cross-playbook pick
	// granted (see addMove's skipIfOwned), nor the copy a background gave (a Scion whose free pick
	// was the second Veteran Crew). One copy per pick. A move taken at the start of
	// play hands over its gear here (start-of-play-gear.js: the Judge's and Marshal's Armored).
	async markCreationPick(moveName) {
		const copy = this._creationPickCopy(moveName);
		if (!copy) return;
		if (!copy.flags?.[STONETOP_SCOPE]?.[CREATION_PICK_FLAG]) await copy.setFlag(STONETOP_SCOPE, CREATION_PICK_FLAG, true);
		await this._grantStartGear(copy);
	}

	// The copy of `moveName` that is (or markCreationPick makes) onboarding's free pick: the one
	// already stamped, else the first copy neither a cross-playbook pick nor the background gave.
	_creationPickCopy(moveName) {
		const owned = this._actor.items.filter(i => i.type === "move" && i.name === moveName
			&& !i.flags?.[STONETOP_SCOPE]?.grantedBy && !_isBackgroundGrant(i));
		return owned.find(i => i.flags?.[STONETOP_SCOPE]?.[CREATION_PICK_FLAG]) ?? owned[0] ?? null;
	}

	// The gear a move gives when taken at the start of play (start-of-play-gear.js), added to the
	// inventory carried, and remembered on the move (START_GEAR_FLAG) so _releaseStartGear takes
	// back that and nothing else. Once per move: a re-run finds it remembered. A hauberk already
	// in the inventory is the player's own, so the move neither adds a second nor claims that one.
	async _grantStartGear(item) {
		const slug = startOfPlayGear(item?.name);
		if (!slug || item.flags?.[STONETOP_SCOPE]?.[START_GEAR_FLAG]) return;
		if (this._inventory.addedSpecial.includes(slug)) return;
		await this._inventory.addSpecial(slug);
		await this._inventory.setItemChecked(slug, true);
		await item.setFlag(STONETOP_SCOPE, START_GEAR_FLAG, slug);
	}

	// A move taken at the start of play takes back the gear it gave (_grantStartGear) when it goes,
	// whether an onboarding re-run drops it or it is un-ticked (removeMove), unless another move
	// still claims that gear. Gear the move never recorded (bought, or there before) is never touched.
	async _releaseStartGear(item) {
		const slug = item?.flags?.[STONETOP_SCOPE]?.[START_GEAR_FLAG];
		if (!slug) return;
		const claimed = this._actor.items.some(i => i._id !== item._id && i.flags?.[STONETOP_SCOPE]?.[START_GEAR_FLAG] === slug);
		if (!claimed) await this._inventory.removeSpecial(slug);
	}

	/**
	 * The "either X OR Y" starting move each of the playbook's `choiceGroups` (moves.choices: the
	 * Fox's Ambush OR Skill at Arms, the Heavy's Armored OR Uncanny Reflexes) was settled with: one
	 * owned item per group, or null while none is. Every option carries isStartingMove, but only
	 * the one taken at creation is the starting move. The other half taken later, at a level-up or
	 * as onboarding's free pick, is a pick like any other. Onboarding stamps the one it grants with
	 * STARTING_CHOICE_FLAG (markStartingChoice).
	 *
	 * A character made before the stamp: the option it holds that wasn't the free pick or a
	 * cross-playbook grant, or, holding both, the one gained first (book order when that can't be
	 * told). Past 1st level that is a guess, so applyStartingMoveChoices takes nothing away on it.
	 */
	startingChoiceItems(choiceGroups = []) {
		const flagsOf = i => i.flags?.[STONETOP_SCOPE] ?? {};
		const created = i => i._stats?.createdTime ?? Infinity;
		return (choiceGroups ?? []).map(group => {
			const options = group.options ?? [];
			const held    = this._actor.items.filter(i => i.type === "move" && options.includes(i.name) && !flagsOf(i).grantedBy);
			const stamped = held.find(i => flagsOf(i)[STARTING_CHOICE_FLAG]);
			if (stamped) return stamped;
			return held.filter(i => !flagsOf(i)[CREATION_PICK_FLAG])
				.sort((a, b) => (created(a) - created(b)) || (options.indexOf(a.name) - options.indexOf(b.name)))[0] ?? null;
		});
	}

	// The either/or options this character did NOT start with (startingChoiceItems), which their
	// isStartingMove no longer describes: the other half of each settled group, held or not. A
	// group not yet settled demotes only what is held (a free pick), and leaves the options still
	// to be chosen between reading as starting moves.
	demotedStartingChoices(choiceGroups = []) {
		const starting = this.startingChoiceItems(choiceGroups);
		const held     = ownedMoveNames(this._actor);
		const demoted  = new Set();
		(choiceGroups ?? []).forEach((group, i) => {
			for (const name of group.options ?? []) {
				if (starting[i] ? name !== starting[i].name : held.has(name)) demoted.add(name);
			}
		});
		return demoted;
	}

	// Stamp the either/or option onboarding granted (see startingChoiceItems). One copy, and not
	// the free pick's copy when there is another. It is taken at the start of play, so it hands over
	// its gear here (start-of-play-gear.js: the Heavy's Armored).
	async markStartingChoice(moveName) {
		const owned = this._actor.items.filter(i => i.type === "move" && i.name === moveName && !i.flags?.[STONETOP_SCOPE]?.grantedBy);
		if (!owned.length) return;
		let item = owned.find(i => i.flags?.[STONETOP_SCOPE]?.[STARTING_CHOICE_FLAG]);
		if (!item) {
			item = owned.find(i => !i.flags?.[STONETOP_SCOPE]?.[CREATION_PICK_FLAG]) ?? owned[0];
			await item.setFlag(STONETOP_SCOPE, STARTING_CHOICE_FLAG, true);
		}
		await this._grantStartGear(item);
	}

	// A playbook's moves by name and by id: onboarding's picks arrive as compendium ids, or as the
	// names a re-run restores them by when the moves step was never opened to swap them.
	async playbookMoveIndex(playbookName) {
		const entries = playbookName ? await this._moveRepo.getPlaybookMoves(playbookName) : [];
		return {
			idByName: new Map(entries.map(e => [e.name, e.id])),
			nameById: new Map(entries.map(e => [e.id, e.name])),
		};
	}

	/**
	 * A change of playbook (a new one dropped on the sheet, or "New" in the creation flow, both
	 * behind a confirm that says what goes) clears what came with the old one. `oldPlaybookName`
	 * is the name its moves carry in `system.playbook`. Run BEFORE the new playbook is written,
	 * because the removals still read the old one (a pouch trait's cap, a grant-only possession).
	 *
	 * Cleared: the old playbook's moves, through removeMove so cascades and reverts run (a move
	 * learned through its Versatile goes with it, an Improved Stat's +1 comes off), and the tracks
	 * and marks those moves kept; its special possessions and the gear they granted; the background,
	 * its picks and the answers it gave; the instinct; the lore; the followers it brought (crew,
	 * animal companion, initiates, a possession's dog), whose NPC actors stay in the sidebar,
	 * unlisted; and the state of moves no longer held (Blessed marks, a Judge's brands and oaths,
	 * the holy light and invocations, Battle Joy, the Would-be Hero's crossed-off "Would-be"); the
	 * Seeker's lead placeholders (a card never found) and the record of what its creation chose
	 * (`arcana.major`, `minorDraw`, `minorRoles`, `majorMarks`). With the roles gone, the lead
	 * backfill (CharacterArcana#ensureLeadBackfill) has no lead to bring back.
	 *
	 * Kept: name, level, XP, stats, appearance, origin, notes, relationships, inventory (beasts
	 * included), the arcana actually held, post-death moves, custom followers, and every move not of
	 * the old playbook.
	 */
	async clearPlaybookData(oldPlaybookName) {
		if (!oldPlaybookName) return;
		const playbookData = await this.playbook();
		// The pack's name as well as the one on the sheet: a Would-be Hero may retitle the field,
		// but their moves still carry the pack's.
		const oldNames = new Set([oldPlaybookName, playbookData?.name].filter(Boolean));
		const before = ownedMoveNames(this._actor);
		// Passes, because taking back a replacing move hands back the one it retired (A Mighty
		// Rampart returns Bulwark), and that one is the old playbook's too.
		for (let pass = 0; pass < 5; pass++) {
			const doomed = this._actor.items.filter(i => i.type === "move" && oldNames.has(i.system?.playbook));
			if (!doomed.length) break;
			for (const item of doomed) {
				// Already gone with the move that granted it.
				if (this._actor.items.some(i => i._id === item._id)) await this.removeMove(item._id);
			}
		}
		const after = ownedMoveNames(this._actor);
		const gone  = [...before].filter(name => !after.has(name));

		const sp = playbookData?.specialPossessions;
		const possessionSlugs = new Set([...(sp?.preselected ?? []), ...this._possessions.selected]);
		for (const slug of possessionSlugs) await this._removePossessionGrants(slug);

		const identified = this._arcana.identifiedSlugs;
		for (const slug of this._arcana.leadSlugs) {
			if (this._arcana.ownedSlugs.has(slug) && !identified.has(slug)) await this.removeArcanum(slug);
		}

		const flags = resolvedFlags(this._actor);
		const keys  = [
			"possessions", "possessionGrantsApplied", POSSESSION_PRESELECTED_WALKED_FLAG, "background", "instinct", "lore",
			"arcana.major", "arcana.minorDraw", "arcana.minorRoles", "arcana.majorMarks", "arcana.majorMarksFor",
			"moves.backgroundAnswers", "moves.dismissedLevelOverage",
			"crew", "animalCompanion",
			"initiateDetails", "initiatesLoyalty", "initiatesHp", "initiatesReadiness", "initiatesAmmo",
			WBH_HERO_FLAG,
			// Each move's track and marks are keyed by its name.
			...gone.map(name => `moves.backgroundChoices.${name}`),
			...gone.map(name => `moves.moveMarks.${name}`),
		];
		// A possession's follower once added as a card (the Would-be Hero's dog) is the old
		// playbook's too. Keyed by id, found by the possession it came from.
		const possessionSources = new Set((sp?.options ?? []).map(o => `possession:${o.slug}`));
		for (const [id, follower] of Object.entries(flags.customFollowers ?? {})) {
			if (possessionSources.has(follower?.sourceUuid)) keys.push(`customFollowers.${id}`);
		}
		// State a move leaves standing, once no move that makes it is held.
		for (const state of MOVE_STATE) if (!state.held(this._actor, after)) keys.push(...state.flags);

		const update = {};
		for (const key of keys) {
			if (foundry.utils.getProperty(flags, key) === undefined) continue;
			const [deleteKey, deleteValue] = deletionEntry(`flags.${STONETOP_SCOPE}.${key}`);
			update[deleteKey] = deleteValue;
		}
		// A stat slot's +1 (Potential for Greatness) sits on the stored stat, and removeMove leaves
		// it there with its record (_trimMoveMarksOnRemoval). The record goes with the move's marks
		// above, so the +1 goes too, in the same write: each slot gave exactly +1, floored at -1 as
		// _revertStatIncreaseChoice is. A new playbook's onboarding writes its base stats after this.
		const stats = this._actor.system?.stats ?? {};
		const drop  = {};
		for (const name of gone) {
			for (const mark of filledMarks(flags.moves?.moveMarks?.[name] ?? {})) {
				if (stats[mark.stat]) drop[mark.stat] = (drop[mark.stat] ?? 0) + 1;
			}
		}
		for (const [key, count] of Object.entries(drop)) {
			update[`system.stats.${key}.value`] = Math.max((stats[key].value ?? 0) - count, -1);
		}
		if (Object.keys(update).length) await this._actor.update(update);
	}

	// `choiceGroups`: the playbook's "either X OR Y" groups (_startingChoiceGroups), so only the
	// option this character started with reads as a starting move (demotedStartingChoices).
	//
	// A move only a background gives (`requirement.background`: the Heavy's Bark an Order, the
	// Sheriff's) is left out for any other background, on the Moves tab and in the level-up's
	// locked list alike: the background is a creation choice, so a faded row would promise a move
	// no one can earn. Held anyway (a GM dropped it on), it shows, with its warning.
	//
	// A row's own copies leave out a move granted through a cross-playbook pick, even one of the
	// same name (Armored is the Heavy's, the Judge's and the Marshal's): a world from before
	// getForeignMovesForLevelUp stopped offering the Marshal's Armored to a Heavy holds such a
	// grant, and it belongs in Learned Moves with its "Granted by", out of the level's picks and
	// out of reach of the Heavy's own Armored box. Requirements still read every move held.
	//
	// The copy a background gave (BACKGROUND_GRANT_FLAG) sits FIRST among a row's copies: box 0 is
	// the locked one, and un-ticking a later box removes the LAST copy, which must be the pick, not
	// the Scion's own Veteran Crew.
	//
	// A background's move held only as picks from before the background (HELD_BEFORE_BACKGROUND_FLAG,
	// no copy of the background's own) reads as the pick it is, not as the background's: a level-3
	// Mighty Hunter whose Stalker was a level-up pick has made that pick.
	buildMovelistContext(entries, ownedAllByName, bgMoveNames, actorLevel, actorPlaybook, choiceGroups = []) {
		const actorStats = _statValueMap(this._actor.system?.stats);
		const demoted    = this.demotedStartingChoices(choiceGroups);
		const background = this._background.selectedSlug;
		const ownCopies  = name => {
			const copies = (ownedAllByName.get(name) ?? []).filter(i => !i.flags?.[STONETOP_SCOPE]?.grantedBy);
			return [...copies.filter(_isBackgroundGrant), ...copies.filter(i => !_isBackgroundGrant(i))];
		};
		const heldAsPick = name => {
			const copies = ownCopies(name);
			return copies.some(_isHeldBeforeBackground) && !copies.some(_isBackgroundGrant);
		};
		bgMoveNames = new Set([...bgMoveNames].filter(name => !heldAsPick(name)));
		// A move an owned move replaced (Bulwark, while A Mighty Rampart is owned) is locked as
		// "Replaced by ...": ticked back, the character would hold both.
		const retiredBy  = this.retiredMoveReplacers();
		// Superior Stat's "all 6 marks in Potential for Greatness", counted off the playbook's own
		// definition of the marked move.
		const filledMarks = this._filledMarkCounter(entries, ownedAllByName);
		return entries
			.filter(e => !e.requirement?.background || e.requirement.background === background || ownedAllByName.has(e.name))
			.map(e => new PlaybookMoveEntry(e, ownCopies(e.name), bgMoveNames, ownedAllByName, actorLevel, actorPlaybook, actorStats, demoted, retiredBy, filledMarks));
	}

	// `name` -> how many of that move's marks are filled (pfg-marks.js#filledMarkCount), off its
	// options in `defs` (the playbook's pack definitions) or else its owned copy, for a requirement
	// of marks (PlaybookMoveEntry, `req.marks`).
	_filledMarkCounter(defs = [], ownedAllByName = this._buildOwnedMovesMap()) {
		const marks = this._moveResources.getMarks();
		return name => filledMarkCount(marks[name] ?? {},
			(defs ?? []).find(d => d.name === name)?.markOptions ?? ownedAllByName.get(name)?.[0]?.system?.markOptions ?? null);
	}

	// A playbook's "either X OR Y" starting-move groups, from the StonetopPlaybook the repository
	// hands back or the raw flags shape.
	_startingChoiceGroups(playbookData) {
		return playbookData?.startingMoveChoices ?? playbookData?.moves?.choices ?? [];
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

	// `newlyGiven`: the background moves a change of background has just started giving
	// (settleBackgroundMoves). A copy already held of one of those predates the background, so it
	// stays the character's pick and the background's copy is added beside it (while the move is
	// repeatable and has room). Any other background move with no stamped copy is a character from
	// before the stamp: the copy it holds IS the background's, and is stamped rather than doubled.
	async ensureStartingMoves({ newlyGiven = new Set() } = {}) {
		const playbookName = this._actor.system?.playbook?.name;
		if (!playbookName) return;

		const entries = await this._moveRepo.getPlaybookMoves(playbookName);
		const ownedNames = new Set(this._actor.items.filter(i => i.type === "move").map(i => i.name));

		const playbookData = await this.playbook();
		const background  = this._selectedBackground(playbookData);
		const bgMoveNames = this._backgroundMoveNames(background);

		// "Either X OR Y" starting moves (e.g. the Heavy's Armored OR Uncanny
		// Reflexes) are a player choice, so they're never auto-granted — the chosen
		// one is added by the onboarding flow (or picked by hand on the sheet).
		const choiceMoveNames = startingMoveChoiceNames(
			playbookData?.startingMoveChoices ?? playbookData?.moves?.choices
		);

		const isStarting = e => e.isStarting && !choiceMoveNames.has(e.name);
		const missing = entries.filter(e => isStarting(e) && !ownedNames.has(e.name));
		// A background's move comes stamped with the background (BACKGROUND_GRANT_FLAG), the copy a
		// later change of background takes back.
		const bgStamp = background?.slug ?? true;
		const fromBackground = [];
		for (const e of entries) {
			if (isStarting(e) || !bgMoveNames.has(e.name)) continue;
			if (!ownedNames.has(e.name)) { fromBackground.push(e); continue; }
			const copies = this._actor.items.filter(i => i.type === "move" && i.name === e.name);
			if (copies.some(_isBackgroundGrant)) continue;
			const repeatMax = e.repeatMax ?? 1;
			// Newly given and already held: a repeatable move with room gets a copy of its own beside
			// the pick. One with no room (any non-repeatable move) gets none, so the copies held are
			// marked as held before the background (HELD_BEFORE_BACKGROUND_FLAG): they stay picks in the
			// level's budget, and leaving the background again takes none of them (a level-up Stalker
			// through Mighty Hunter and back).
			if (newlyGiven.has(e.name)) {
				if (copies.length < repeatMax) fromBackground.push(e);
				else for (const copy of copies) {
					if (!copy.flags?.[STONETOP_SCOPE]?.[HELD_BEFORE_BACKGROUND_FLAG]) await copy.setFlag(STONETOP_SCOPE, HELD_BEFORE_BACKGROUND_FLAG, true);
				}
				continue;
			}
			// A character from before the stamp: a non-repeatable move held already IS the
			// background's, as it always was; a repeatable one stamps its earliest copy that isn't held
			// some other way, or gets a copy of its own.
			if (repeatMax < 2) continue;
			const legacy = _earliestFirst(copies.filter(i => !_heldBesidesBackground(i)))[0];
			if (legacy) await legacy.setFlag(STONETOP_SCOPE, BACKGROUND_GRANT_FLAG, bgStamp);
			else if (copies.length < repeatMax) fromBackground.push(e);
		}
		if (missing.length || fromBackground.length) {
			const docs = await Promise.all([...missing, ...fromBackground].map(e => this._moveRepo.getPlaybookMoveDocument(e.id)));
			const data = docs.map((d, index) => {
				if (!d) return null;
				const obj = d.toObject();
				if (index < missing.length) return obj;
				const flags = obj.flags ?? {};
				return { ...obj, flags: { ...flags, [STONETOP_SCOPE]: { ...(flags[STONETOP_SCOPE] ?? {}), [BACKGROUND_GRANT_FLAG]: bgStamp } } };
			}).filter(Boolean);
			if (data.length) await this._actor.createEmbeddedDocuments("Item", data);
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

	// `skipIfOwned` (onboarding) passes over a copy granted through a cross-playbook pick: a Heavy
	// holding the Marshal's Armored through Seasoned Warrior still gets their own when a re-run
	// picks it (see buildMovelistContext). It passes over the copy a background gave as well
	// (BACKGROUND_GRANT_FLAG): a Scion's free pick may be the second Veteran Crew.
	async addMove(compendiumId, { skipIfOwned = false } = {}) {
		const doc = await this._moveRepo.getPlaybookMoveDocument(compendiumId);
		if (!doc) return null;
		if (skipIfOwned && this._actor.items.some(i => i.type === "move" && i.name === doc.name
			&& !i.flags?.[STONETOP_SCOPE]?.grantedBy && !_isBackgroundGrant(i))) return null;
		const created = await this._actor.createEmbeddedDocuments("Item", [doc.toObject()]);
		const added = created?.[0] ?? null;
		if (added) await this._retireReplacedMove(added);
		return added;
	}

	// Book I p.529: "If a move replaces a different move, then it requires the one it
	// replaces. If a player takes such a move, they lose the original move and any benefits
	// it conferred." Done here rather than in applyLevelUp so every way of gaining a move
	// obeys it: the level-up dialog, the Moves-tab checkboxes, and a cross-playbook pick.
	// Retired through removeMove so the original's own bookkeeping goes with it. The new
	// item remembers what it retired, which is the only move removeMove will hand back if
	// this one is un-ticked; a replacing move ticked in edit mode without its original
	// retires nothing and so restores nothing.
	async _retireReplacedMove(added) {
		const replaced = added.system?.replaces;
		if (!replaced) return;
		const originals = this._actor.items.filter(i => i.type === "move" && i.name === replaced);
		if (!originals.length) return;
		// An original learned through a cross-playbook move keeps its "Granted by" on the way
		// back, so it returns to Learned Moves rather than landing loose.
		const grantedBy = originals.map(i => i.flags?.[STONETOP_SCOPE]?.grantedBy).find(Boolean) ?? null;
		// An original that was onboarding's free pick (CREATION_PICK_FLAG) is remembered as such, so
		// a re-run of onboarding counts that pick as made (retiredCreationPickCount) rather than ask
		// for another, and the original comes back as the free pick it was.
		const wasCreationPick = originals.some(i => i.flags?.[STONETOP_SCOPE]?.[CREATION_PICK_FLAG]);
		for (const it of originals) await this.removeMove(it._id);
		await added.setFlag(STONETOP_SCOPE, "retiredMove", replaced);
		if (grantedBy) await added.setFlag(STONETOP_SCOPE, "retiredGrantedBy", grantedBy);
		if (wasCreationPick) await added.setFlag(STONETOP_SCOPE, RETIRED_CREATION_PICK_FLAG, true);
	}

	// Hand back the move a now-removed replacing move retired (see _retireReplacedMove).
	async _restoreRetiredMove(gone) {
		const flags   = gone?.flags?.[STONETOP_SCOPE];
		const retired = flags?.retiredMove;
		if (!retired) return;
		// An original that came through a cross-playbook move comes back only while that move is
		// still here: un-learning the granter would have taken the original with it, so handing it
		// back now would leave a foreign move on the sheet that nothing grants.
		const grantedBy = flags.retiredGrantedBy;
		if (grantedBy && !this._actor.items.some(i => i._id === grantedBy.instanceId)) return;
		const restored = await this.addPlaybookMoveByName(gone.system?.playbook, retired);
		if (restored && grantedBy) await restored.setFlag(STONETOP_SCOPE, "grantedBy", grantedBy);
		if (restored && flags[RETIRED_CREATION_PICK_FLAG]) await restored.setFlag(STONETOP_SCOPE, CREATION_PICK_FLAG, true);
	}

	// How many of onboarding's free picks were given up to a replacing move (see
	// _retireReplacedMove): a re-run of onboarding asks for that many fewer, since the pick was made
	// and the move it made is gone for good reason (Book I p.529). Its replacement is not a free pick
	// (creationPickItems never lists it), so a re-run neither shows it nor takes it back.
	retiredCreationPickCount() {
		return this._actor.items.filter(i => i.type === "move"
			&& i.flags?.[STONETOP_SCOPE]?.retiredMove
			&& i.flags?.[STONETOP_SCOPE]?.[RETIRED_CREATION_PICK_FLAG]).length;
	}

	// Returns the created move item, or null when nothing was added (already owned, unknown).
	async addPlaybookMoveByName(playbookName, moveName) {
		if (!playbookName || !moveName) return null;
		const ownedNames = new Set(this._actor.items.filter(i => i.type === "move").map(i => i.name));
		if (ownedNames.has(moveName)) return null;
		const entries = await this._moveRepo.getPlaybookMoves(playbookName);
		const entry = entries.find(e => e.name === moveName);
		return entry ? this.addMove(entry.id) : null;
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
		const orphanItems = this._actor.items
			.filter(i => i.type === "move" && i.flags?.[STONETOP_SCOPE]?.grantedBy?.instanceId === ownedId);
		const orphans = orphanItems.map(i => i._id);
		await this._actor.deleteEmbeddedDocuments("Item", [ownedId, ...orphans]);
		if (removed) await this._revertStatIncreaseChoice(removed);
		// A custom move's resource track is stored under its item id (see buildSnapshot), and
		// ids are never reused — so the count has to go with the move or it sits in the flag
		// forever. Shipped moves key by name and keep theirs on purpose. Only `removed` can be
		// custom: the cascaded orphans are cross-playbook grants, which are always shipped.
		if (_isCustomMove(removed)) await this._moveResources.clear(ownedId);
		// Un-ticking a replacing move (A Mighty Rampart) hands back the move it retired
		// (Bulwark), so an undo leaves the character as it was. The cascade counts too: un-
		// learning the Versatile that granted a Rampart undoes the Rampart's swap as well.
		for (const gone of [removed, ...orphanItems]) await this._restoreRetiredMove(gone);
		await this._trimSubChoicesOverCap([removed, ...orphanItems]);
		await this._trimMoveMarksOnRemoval([removed, ...orphanItems]);
		await this._trimCompanionTraitsOnRemoval([removed, ...orphanItems]);
		await this._releaseGrantedPossession(removed);
		// Un-ticking Armored taken at the start of play takes back its hauberk, as an onboarding
		// re-run dropping it does. Read off the snapshots: their startGear flag outlives the delete.
		for (const gone of [removed, ...orphanItems]) await this._releaseStartGear(gone);
		await this._clearUnheldInvocations();
	}

	// A Would-be Hero who un-learns the Versatile that granted Invoke the Sun God (or has it taken
	// off) keeps no Invocations: the learned list and every ongoing slot go, by the same MOVE_STATE
	// test clearPlaybookData asks. Every flag in THAT row, so a slot added to it is cleared too. Never
	// for a playbook with Invocations of its own (the Lightbearer's list is the playbook's, not a
	// move's), and nothing written when there is nothing stored.
	async _clearUnheldInvocations() {
		const row = MOVE_STATE.find(state => state.flags.includes("invocations"));
		if (!row) return;
		const flags = resolvedFlags(this._actor);
		const stored = row.flags.filter(key => foundry.utils.getProperty(flags, key) !== undefined);
		if (!stored.length || row.held(this._actor, ownedMoveNames(this._actor))) return;
		if ((await this.playbook())?.invocations?.options?.length) return;
		const update = {};
		for (const key of stored) {
			const [deleteKey, deleteValue] = deletionEntry(`flags.${STONETOP_SCOPE}.${key}`);
			update[deleteKey] = deleteValue;
		}
		await this._actor.update(update);
	}

	// Un-learning Big Magic takes back the remarkable trait it unlocked ("one per Big
	// Magic"). Each selected possession line whose cap grows with a removed move, and now
	// holds more picks than that cap, drops its most recent picks down to it: sub-choices
	// keep the order they were made in, so the trait the move brought goes first.
	async _trimSubChoicesOverCap(goneMoves) {
		const goneNames = new Set(goneMoves.filter(Boolean).map(i => i.name));
		if (!goneNames.size) return;
		const sp = (await this.playbook())?.specialPossessions;
		const moveCounts = this.ownedMoveCounts();
		for (const { opt, sg } of this._selectedPossessionSubgroups(sp)) {
			if (!sg.multiSelect) continue;
			if (!(sg.maxSelectBonus?.moveBonus ?? []).some(mb => goneNames.has(mb.moveName))) continue;
			const max = effectiveSubgroupMax(sg, moveCounts);
			if (max == null) continue;
			const lineSlugs = new Set((sg.options ?? []).map(o => o.slug));
			const picked = this._possessions.subChoices[opt.slug] ?? [];
			const drop = new Set(picked.filter(s => lineSlugs.has(s)).slice(max));
			if (!drop.size) continue;
			await this.setPossessionSubChoices(opt.slug, picked.filter(s => !drop.has(s)));
		}
	}

	// Removing a copy of a move whose mark options scale with its copies ("pick 1 each time you take
	// this move": Veteran Crew, Heroes to the Last, Beast of Legend, Well Versed) takes back the
	// picks that copy paid for: the move's checked marks are trimmed to the budget the copies left
	// still buy (moveMarkBudget), the latest-level picks first. Removing the last copy clears the
	// move's marks outright, so taking it again asks for a fresh choice rather than restoring the
	// old one. Stat-choice slots (Potential for Greatness) are left alone: their +1 sits on the
	// stored stat, and dropping the record would strand it. Only on removal: a grandfathered
	// over-budget mark on a move still held keeps working (see setCountMark).
	async _trimMoveMarksOnRemoval(goneMoves) {
		const allMarks = this._moveResources.getMarks();
		const marksPath = `flags.${STONETOP_SCOPE}.moves.moveMarks`;
		const update = {};
		const seen = new Set();
		for (const gone of goneMoves.filter(Boolean)) {
			const name = gone.name;
			if (!name || !allMarks[name] || seen.has(name)) continue;
			seen.add(name);
			const pbName  = gone.system?.playbook ?? null;
			const def     = pbName ? (await this._moveRepo.getPlaybookMoves(pbName)).find(d => d.name === name) : null;
			const options = def?.markOptions ?? gone.system?.markOptions ?? [];
			const boxes   = options.filter(o => o.choice !== "stat");
			if (!boxes.length) continue;
			const moveMarks = allMarks[name];
			const remaining = this._actor.items.filter(i => i.type === "move" && i.name === name).length;
			// The last copy gone: the move's marks go whole (a merge can't drop a key, so it is a
			// deletion), unless a stat slot is recorded there.
			if (remaining === 0 && !options.some(o => o.choice === "stat" && moveMarks[o.slug] !== undefined)) {
				const [deleteKey, deleteValue] = deletionEntry(`${marksPath}.${name}`);
				update[deleteKey] = deleteValue;
				continue;
			}
			const max = remaining === 0 ? 0 : moveMarkBudget(def?.markBudget ?? gone.system?.markBudget, remaining);
			if (max == null) continue;
			// Every checked pick across the move's boxes, latest level first (a pick with no level
			// recorded counts as the oldest), a later box before an earlier one within a level.
			const picks = boxes.flatMap(opt => markEntries(moveMarks[opt.slug]).map((entry, index) => ({ slug: opt.slug, index, level: entry.level })));
			const over  = picks.length - max;
			if (over <= 0) continue;
			picks.sort((a, b) => ((b.level ?? 0) - (a.level ?? 0)) || (b.index - a.index));
			const drop = new Set(picks.slice(0, over).map(p => `${p.slug}:${p.index}`));
			for (const opt of boxes) {
				if (moveMarks[opt.slug] === undefined) continue;
				// An array replaces the stored one outright, so each box's list is its own write.
				update[`${marksPath}.${name}.${opt.slug}`] = markEntries(moveMarks[opt.slug]).filter((_, index) => !drop.has(`${opt.slug}:${index}`));
			}
		}
		if (Object.keys(update).length) await this._actor.update(update);
	}

	// Removing a copy of Magnificent Specimen takes back the 2 options it gave the companion: the
	// stored picks are cut to what the type's "Pick N more" and the LEARNED book copies left still
	// allow, the newest first and never the pre-ticked option (animal-companion.js#trimCompanionTraits).
	// Only on removal: un-learning a copy keeps the picks, as un-learning Big Magic keeps its trait
	// (_trimSubChoicesOverCap runs from here too), so re-learning it has them straight back.
	async _trimCompanionTraitsOnRemoval(goneMoves) {
		if (!goneMoves.some(i => i?.name === MAGNIFICENT_SPECIMEN_MOVE && !_isCustomMove(i))) return;
		const companion = resolvedFlags(this._actor)?.animalCompanion;
		if (!companion?.type || !Array.isArray(companion.traits)) return;
		const typeData = ((await this.companionSource())?.types ?? []).find(t => t.slug === companion.type);
		if (!typeData) return;
		const allowance = companionTraitAllowance(typeData, _learnedBookSpecimens(this._buildOwnedMovesMap(), this._actor.items));
		const kept = trimCompanionTraits(typeData, companion.traits, allowance);
		if (kept.length !== companion.traits.length) await this._actor.setFlag(STONETOP_SCOPE, "animalCompanion.traits", kept);
	}

	// Un-learning Initiate of the Secret Arts takes back the Sacred Pouch it brought: "You
	// have a 'Sacred Pouch'" only while you have the move. The pouch is grant-only, so the
	// sheet can't untick it, and it would otherwise outlive the move for good. Kept when
	// another copy of a granting move remains, or when the playbook gives the possession
	// on its own (a Blessed who learned Initiate keeps the pouch they started with).
	async _releaseGrantedPossession(gone) {
		const slug = gone?.system?.crossPlaybook?.grantsPossession;
		if (!slug || !this._possessions.selected.has(slug)) return;
		if (this._actor.items.some(i => i.type === "move" && i.system?.crossPlaybook?.grantsPossession === slug)) return;
		const sp  = (await this.playbook())?.specialPossessions;
		const opt = sp?.options?.find(o => o.slug === slug);
		if (!opt?.grantOnly || (sp.preselected ?? []).includes(slug)) return;
		await this.deselectPossession(slug);
		await this._possessions.forgetGranted(slug);
	}

	// Apply the "either X OR Y" starting-move picks: grant the chosen move in each group and stamp
	// it (markStartingChoice), and take back the option the character STARTED with when that was
	// the other one, so switching the choice on a re-run doesn't leave both. Only that one: the
	// other half taken at a level-up, or as the free pick, is the character's by another right and
	// stays. Past 1st level a character from before the stamp can't say which half it started with
	// (startingChoiceItems only guesses), so nothing is taken back, as creationPickItems claims
	// nothing there; the pick is stamped, which settles it from then on. A starting option that is
	// the free pick too (a re-run that swapped the halves) stays as the free pick, unstamped.
	// `choiceGroups` is the playbook's `moves.choices`; `chosenIdByGroup` maps group index
	// → chosen compendium id.
	async applyStartingMoveChoices(choiceGroups, chosenIdByGroup) {
		const level   = this._actor.system?.attributes?.level?.value ?? 1;
		const settled = this.startingChoiceItems(choiceGroups);
		for (let i = 0; i < (choiceGroups?.length ?? 0); i++) {
			const chosenId = chosenIdByGroup?.[i];
			if (!chosenId) continue;
			const chosenDoc = await this._moveRepo.getPlaybookMoveDocument(chosenId);
			if (!chosenDoc) continue;
			const was   = settled[i];
			const flags = was?.flags?.[STONETOP_SCOPE] ?? {};
			const claimed = !!was && (flags[STARTING_CHOICE_FLAG] || level <= 1);
			if (claimed && was.name !== chosenDoc.name && this._actor.items.some(it => it._id === was._id)) {
				if (flags[CREATION_PICK_FLAG]) await was.unsetFlag(STONETOP_SCOPE, STARTING_CHOICE_FLAG);
				else {
					// Armored's hauberk goes with it (start-of-play-gear.js).
					await this._releaseStartGear(was);
					await this.removeMove(was._id);
				}
			}
			await this.addMove(chosenId, { skipIfOwned: true });
			await this.markStartingChoice(chosenDoc.name);
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
	//
	// `takenOffers` is the roll window's answer about the lines it offered (dialogs/RollDialog.js
	// #promptRoll, from rollOffers below): the keys left ticked. Null from a caller that asked no
	// window, which takes none: a line the player never saw is never spent. `offered` is those lines
	// as the window was handed them (the sheet's _promptRollOptions), so they are not worked out twice.
	async onRoll(event, { statOverride = null, situational = 0, weaponSlug = null, rollMode = null, takenOffers = null, offered = null } = {}) {
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
			// Going on the offense sheds any held Defend Readiness (p.216), but an attack made
			// holding one's ground does not, so the player is asked (combat/readiness-loss.js):
			// only once the attack is committed, not on a cancelled weapon/target prompt.
			// And an unseen Fox or Ranger is seen: "until you ... attack" (actors/character/fight-states.js).
			if (attackMoveFor(item)) {
				await settleReadinessOnAttack(this._actor, item.name);
				await revealOnAttack(this._actor, item.name);
			}
			if (begun === "handled") return true;
			attackExtra = begun;
		}

		// Interfere and Persuade (vs. PCs) are aimed at another player's character, whose player
		// answers on the card: asked whom before the dice, as an attack asks its target, so backing
		// out rolls nothing (pc-asks/pc-ask-flow.js). Null for every other move.
		const aimed = descriptionOnly ? null : await aimPcAskRoll(this._actor, item);
		if (aimed === "cancel") return "cancel";

		// The +forward is not read here: it is claimed with the held promises just before the dice, below.
		const ongoing  = descriptionOnly ? 0 : this._actor.system?.attributes?.ongoing?.value ?? 0;
		// A one-off situational modifier from the optional pre-roll prompt; the roll
		// engine surfaces it as a "Situational" pill (modifier − forward − ongoing).
		const situ     = descriptionOnly ? 0 : situational;

		const modifier    = ongoing + situ;
		// `rollMode` is the pre-roll prompt's answer when the prompt asked for one (see
		// RollDialog.js), and ABSENT when it did not — which is the ordinary case, because the
		// mode is normally the sticky selector on this sheet. So the sheet's own flag is the
		// fallback rather than "normal": defaulting to normal here would quietly overrule a
		// player who set Advantage on their sheet, on every roll.
		const rollOptions = {
			rollMode: normalizeRollMode(rollMode ?? this.rollMode),
			// `forward` from what the roll is owed, added once it is claimed (_foldOwed).
			modifier, forward: 0, ongoing, statOverride: stat, ...(attackExtra ?? {}), ...(aimed ?? {}),
		};

		// A grudge this character is owed against the very foe they are attacking: Relentless on a Clash
		// with someone who survived the last one, But I Get Up Again on whoever knocked them down. Folded
		// in like a held advantage (see _foldOwed), before the debility pass, so a Weakened
		// Heavy's advantage cancels rather than quietly outranking the debility, and NAMED on the card.
		const grudge = attackExtra ? attackFoeAdvantage(this._actor, attackExtra) : null;
		if (grudge) Object.assign(rollOptions, foldAdvantage(rollOptions, grudge));
		// Every other roll aimed at someone owes what _foldAimedModes folds: Binding Arbitration's "advantage
		// on all rolls against them" (the user's ruling), else But I Get Up Again's or Alpha's "advantage on
		// your next roll against them" (a Defy Danger or a Persuade aimed at that foe too; they do not stack),
		// then Tough Love's "disadvantage on any rolls against you" at the Would-Be Hero who called this
		// character on it. Aimed at the tokens targeted, or at the character an Interfere or a Persuade (vs.
		// PCs) was just aimed at. An attack has had its advantage above, as a grudge, so it is folded
		// `grudged`: Tough Love's disadvantage alone, an attack on that hero's token included. The "next roll"
		// advantages are spent after the dice, below, either way, since this was the next roll against them.
		// But I Get Up Again's blow half is the damage window's (fight/hero-moves.js#blowOffers), spent on its own.
		const aimedAt = attackExtra || descriptionOnly ? [] : this._rollTargets(aimed);
		const foesTargeted = attackExtra ? attackExtra.messageFlags?.[STONETOP_SCOPE]?.attack?.targets ?? [] : aimedAt;
		const aimedModes = this._foldAimedModes(rollOptions, foesTargeted, { grudged: !!attackExtra });
		Object.assign(rollOptions, aimedModes.options);
		const oathbreakerNamed = grudge === BINDING_ARBITRATION || aimedModes.oathbreaker;
		// A background's standing advantage and a season's standing disadvantage on one move: the same fold.
		if (!descriptionOnly) Object.assign(rollOptions, this._foldStandingModes(rollOptions, item.name));
		// And what their card says on a miss whatever the move (a Ghost's Unstable).
		if (!descriptionOnly) Object.assign(rollOptions, this._foldStandingNotes(rollOptions));
		// The lines the roll window offered and the player left ticked (rollOffers: a skin of fine
		// whisky shared before a Persuade): the same fold, each paid for after the dice, below (the
		// ONE fold and payment onDirectStatRoll shares, _foldTakenOffers and _payTakenOffers).
		// Binding Arbitration's line is dropped when the oath has already been asked above, so it is
		// named once.
		const taken = descriptionOnly ? [] : await _takenOffers(takenOffers, offered, () => this.rollOffers(item), { oathbreakerNamed });
		Object.assign(rollOptions, _foldTakenOffers(rollOptions, taken));

		// What the next roll is owed (the +forward, a promise made earlier: a peaceful camp, an Interfere) is
		// CLAIMED HERE, after the guards above, so reading a move's text or backing out of the weapon prompt
		// never burns it; and in one write before the dice, so a second roll started while these dice still
		// animate reads what this one left (_claimNextRollOwed). Put back when no dice are thrown.
		const owed = descriptionOnly ? null : await this._claimNextRollOwed(item?.name);
		const promised = owed ? this._foldOwed(rollOptions, owed) : rollOptions;

		let withSurprise = promised;
		let roll;
		try {
			// Prepare a Welcome spends 1 Surprise to roll; the card says so, or that there was none to spend.
			const surprise = descriptionOnly ? null : await spendSurpriseForRoll(this._actor, item);
			if (surprise) withSurprise = { ...promised, conditionNotes: [...(promised.conditionNotes ?? []), surprise] };
			roll = await item.roll({ ...this.applyDebilityRollMode(stat, withSurprise), descriptionOnly });
		} catch (err) {
			await owed?.refund();
			throw err;
		}
		if (!roll) await owed?.refund();

		// What the taken lines cost, paid once the dice have landed, and a 12+'s "criticalNote" hook.
		await _payTakenOffers(taken, roll, item.name);
		// And Alpha's and But I Get Up Again's advantage against these foes, which was for this one roll: the
		// next roll against them has been made, hit or miss. Before the tier effects, so an Alpha rolled again
		// at the same foe spends the old record and its own 10+ lays a fresh one.
		if (roll) await aimedModes.spend();

		// What the tier just rolled does to the character: Defend's Readiness (p.216), We Happy Few's 6-
		// shaking the nerves, Prepare a Welcome's 10+ regaining 1 Surprise, Commune with Aratis's 10+
		// holding 2 Sanction, the holy light lit or snuffed. Stated flatly, so each goes on with the dice.
		// What each did is written on the card, so a later Shift or +1 moving its tier can bring the
		// character along, undoing only what this roll did (actors/character/tier-effects.js).
		if (!descriptionOnly && Number.isFinite(roll?.total)) await this._settleRolledTierEffects(roll, item.name, withSurprise, aimedAt);

		// Clash's 6-: "your maneuver fails and you suffer your enemy's attack". A flat consequence
		// with nothing in the tier to decide, so it fires off the dice rather than off a button —
		// the same after-the-roll shape Defend's Readiness above uses, and for the same reason.
		// After the roll card and its miss XP, which rollStat has already posted, so the chat
		// reads in the order the move does.
		// A ranged 6-, drawn: the shot goes wide on the map (attack-flow.js#maybeMissFx). Not awaited;
		// it is only the picture of what the card already says.
		if (!descriptionOnly) {
			await maybeCounterOnMiss(this._actor, item, roll, attackExtra);
			maybeMissFx(this._actor, item, roll, attackExtra);
		}

		// Nemesis and Relentless both turn on "when you Clash and your foe survives": the foes this Clash
		// was aimed at are written down now, AFTER the dice, so the +1d6 rides the attacks that come after
		// this one rather than this one's own damage (combat/attack-flow.js#recordClashedFoes).
		if (!descriptionOnly && attackExtra) await recordClashedFoes(this._actor, attackExtra);

		return true;
	}

	/**
	 * What the tier just rolled does to the character (tier-effects.js), settled and written on the card.
	 *
	 * Read off the CARD, not the Roll in hand: a Burn Brightly, a +1 or a GM's Shift can land on the card
	 * between the dice and here (the miss XP's relay to the GM's client is in between), and a rewrite only
	 * lifts a copy of the roll (roll-card-writer.js#writeCardRoll). Such a rewrite found no record on the
	 * card to bring along (tier-effects.js#reconcileTierEffects), so one that lands while these are being
	 * settled is caught up from the total the card shows once they are written.
	 *
	 * The tier the roll COUNTS as, as its card reads: a taken line that treats a 7-9 as a 10+ (or a 6- as a
	 * 7-9) settles the effects of the tier it counts as, the same one a later rewrite reads.
	 */
	async _settleRolledTierEffects(roll, moveName, options, targets) {
		const card = messageOfRoll(roll);
		const liveTotal = () => cardTotal(card) ?? roll.total;
		const tierAt = total => outcomeTier(card?.getFlag?.(STONETOP_SCOPE, ROLLED_FLAG)
			? cardCountedTier(card, total, STONETOP_SCOPE)
			: countedTier(total, rolledRecord("", options)));
		const tier = tierAt(liveTotal());
		await recordTierEffects(card, await settleTierEffects(this._actor, moveName, tier, null, { character: this, targets }));
		if (card && tierAt(liveTotal()) !== tier) await reconcileTierEffects(card, liveTotal(), { actor: this._actor });
	}

	// -- Defend Readiness (Book I, Combat & Boons p.216) ----------------------
	// The Defend move holds Readiness in circles beside it on the Moves sidebar;
	// spend it to weather an attack for a ward, halve it, draw all attention, or
	// strike back. Stored as a scalar flag on the actor (see defend-readiness.js
	// for the pure hold/cap arithmetic).

	/** Whether the character currently bears a shield (its inventory slot is checked). */
	/**
	 * Whether the character is bearing a shield, for Defend's "+1 Readiness on a 7+" (p.216).
	 *
	 * Async because the answer spans all four gear stores (see _gearSources) and two of them
	 * need a repository read. It used to be `checked["shield"]` — the ONE catalog slug — which
	 * meant the Judge's Makerglass shield, the Would-Be Hero's shield, the Shield of the Wisent
	 * Witch and the makerglass shield treasure each printed "+1 Readiness on a Defend 7+" beside
	 * a tick box that bought nothing.
	 */
	async bearsShield(gear = null) {
		return _carriesShield(gear ?? await this._carriedGearSources());
	}

	/**
	 * The hand-set armor delta, banked on the actor the way `hp.adjustment` banks a permanent
	 * max-HP change. A DELTA, not an absolute: an arcanum's boon or a GM's ruling keeps its size
	 * when the gear underneath it changes, instead of pinning a number the next equip would fight.
	 */
	get armorAdjustment() {
		return Math.trunc(Number(this._actor.system?.attributes?.armor?.adjustment) || 0);
	}

	/**
	 * The derived vitals everything outside the sheet reads off the STORED fields, `{armor, unpierceable,
	 * maxHp, damage}`: buildSnapshot's arithmetic without building a sheet. `maxHp` is 0 with no playbook,
	 * which is "nothing to say", not a max of 0 (see computedMaxHp). `damage` is the die the character
	 * rolls (computedDamageDie's answer, from the playbook and move bonuses already worked out here), or
	 * null with no override and no playbook.
	 *
	 * The stored armor is what the damage card's Apply takes off (combat/attack-flow.js#wornArmor), so a
	 * shield handed over mid-fight with the sheet closed has to reach it: actors/character/vitals-mirror.js.
	 */
	async computedVitals() {
		const [{ playbookData, gear, moveBonuses }, hpPenalty] = await Promise.all([
			this._derivedInputs(),
			this._postDeath.hpPenalty(),
		]);
		const { armor, unpierceable, conditional, conditionalSource } = this._armorFrom(gear, moveBonuses);
		const damage = this.damageDieOverride ?? _derivedDamageDie(playbookData, moveBonuses);
		return { armor, unpierceable, conditional, conditionalSource, maxHp: playbookData ? _hpFrom(this._actor, playbookData, moveBonuses, hpPenalty).hpMax : 0, hpPenalty, damage };
	}

	/**
	 * The move bonuses the Followers tab builds its cards with, `{crewStats, companionBonuses}`:
	 * buildSnapshot's two, without building a sheet. For a reader that needs a card's numbers with the
	 * sheet closed (StonetopCharacterSheet#followerCardHp), so Beast of Legend's +4 HP is on the
	 * companion's max there too.
	 */
	async followerCardBonuses(playbookData = null, crewDef = null) {
		const playbook = playbookData ?? await this.playbook();
		const ownedAllByName = this._buildOwnedMovesMap();
		const moveBonuses = await this._ownedMoveBonuses(playbook, ownedAllByName);
		return {
			crewStats: _buildCrewStats(crewDef ?? await this.crewSource(playbook), moveBonuses),
			companionBonuses: _buildCompanionBonuses(moveBonuses, ownedAllByName, this._actor.items),
		};
	}

	/** What the derived vitals are worked out from: the playbook, the carried gear and the move bonuses. */
	async _derivedInputs() {
		const playbook = this.playbook();
		const [playbookData, allOutfitItems, arcanaCarried, moveBonuses] = await Promise.all([
			playbook,
			this._inventoryRepo.getAll(),
			this._arcana.weightedInventoryItems(),
			playbook.then(pb => this._ownedMoveBonuses(pb, this._buildOwnedMovesMap())),
		]);
		return { playbookData, gear: this._gearSources(playbookData, allOutfitItems, arcanaCarried), moveBonuses };
	}

	/**
	 * Write the derived vitals onto the stored armor and max HP where they differ, for everything that
	 * reads the stored fields: the token bar, the Fight tab, Apply, the ledger. THE ONE WRITER of them:
	 * actors/character/vitals-mirror.js calls it on a change made with the sheet closed, and the sheet
	 * after each render (StonetopCharacterSheet#_syncStoredDerived), handing in the numbers its snapshot
	 * already worked out rather than working them out again.
	 *
	 * The two armor numbers move together: a floor is part of the total above it, so a disagreement in
	 * either writes both. A non-finite armor (nothing worked out, or a move bonus that is not a number)
	 * writes neither, where 0 is real (unarmored) and must overwrite a stale number. Max HP only with a
	 * playbook to derive it from (0 says there is none). The damage die onto `system.attributes.damage.value`
	 * when the vitals carry one (`damage`, computedVitals'; the sheet hands in none) and the stored one
	 * differs: the character's own rolls ask for the computed die, but another hero's best die in a
	 * pile-on (fight/damage-seed.js#attackerProfile) and a character struck back at as a foe
	 * (utils/damage.js#foeAttacks) read the stored one. Ledger-silenced: the real change was the gear,
	 * the level or the Mark, which the ledger already files; the one exception is HP a falling max takes
	 * down with it, which is filed on its own line. Returns whether it wrote.
	 *
	 * @param {{armor: number|null, unpierceable: number, conditional?: number, conditionalSource?: string, maxHp: number, damage?: string|null}} [vitals]  computedVitals' answer.
	 *   A caller handing in its own numbers must carry the WHOLE armor group: the write is one update
	 *   over all four fields, so an omitted `conditional` writes the default back over a real one.
	 */
	async syncStoredVitals(vitals = null) {
		const worked = vitals ?? await this.computedVitals();
		const { armor, unpierceable, maxHp, conditional = 0, conditionalSource = "" } = worked;
		// Compared against the STORED fields (`_source`), never the live `system`: the sheet's getData used
		// to write the computed numbers into the live DataModel on the client that rendered it, which made
		// every comparison below come out equal there and left the stored armor, max HP and die stale for
		// everyone else (the GM's Apply, the token bar, the Fight tab). The live values are only a fallback
		// for a document with no source (a test double).
		const attrs = this._actor._source?.system?.attributes ?? this._actor.system?.attributes ?? {};
		const update = {};
		const floor = Number(unpierceable) || 0;
		// The fiction-gated part of the total travels with it, for the same reason the floor does: the
		// damage card reads this document, and it offers that armor back (combat/attack-flow.js).
		const gated = Math.max(0, Math.trunc(Number(conditional) || 0));
		const gatedBy = gated > 0 ? String(conditionalSource || "") : "";
		let penaltyBefore, penaltyNow = 0;
		if (armor !== null && Number.isFinite(Number(armor))
			&& (Number(attrs.armor?.value) !== Number(armor) || (Number(attrs.armor?.unpierceable) || 0) !== floor
				|| (Number(attrs.armor?.conditional) || 0) !== gated || (attrs.armor?.conditionalSource ?? "") !== gatedBy)) {
			update["system.attributes.armor.value"] = Number(armor);
			update["system.attributes.armor.unpierceable"] = floor;
			update["system.attributes.armor.conditional"] = gated;
			update["system.attributes.armor.conditionalSource"] = gatedBy;
		}
		const hpMax = Number(maxHp) || 0;
		if (hpMax > 0 && Number(attrs.hp?.max) !== hpMax) {
			update["system.attributes.hp.max"] = hpMax;
			// A max that drops below the HP they have (a Thrall's "Reduce your max HP by 2" Mark) takes
			// the HP down with it, in the same write: nobody holds more HP than their max. Only when the
			// max MOVES, so HP this sync did not cause stays the table's business.
			if ((Number(attrs.hp?.value) || 0) > hpMax) update["system.attributes.hp.value"] = hpMax;
			// The insert penalty this max is built from, kept so the NEXT fall can tell whether the Marks
			// moved (maxHpFallCause). Written only when it differs: a character who never had a Mark
			// carries none, and reads as 0.
			const penalty = Number(worked.hpPenalty ?? await this._postDeath?.hpPenalty?.()) || 0;
			penaltyBefore = readableFlags(this._actor)?.[MIRRORED_HP_PENALTY_FLAG];
			if ((penaltyBefore ?? 0) !== penalty) update[`flags.${STONETOP_SCOPE}.${MIRRORED_HP_PENALTY_FLAG}`] = penalty;
			penaltyNow = penalty;
		}
		const die = String(worked.damage ?? "").trim();
		if (die && die !== String(attrs.damage?.value ?? "").trim()) update["system.attributes.damage.value"] = die;
		if (!Object.keys(update).length) return false;
		const hpBefore = Number(attrs.hp?.value) || 0;
		const written = await this._actor.update(update, {
			stonetopLedger: true,
			// HP a falling max takes with it is not a blow landing (StonetopFlags.js#HP_CEILING_OPTION).
			...(update["system.attributes.hp.value"] !== undefined ? { [HP_CEILING_OPTION]: true } : {}),
		});
		// The mirror stays quiet, but HP taken down with a falling max is HP the character LOST, and
		// nothing else files it. One line for it, naming what lowered the max where that is known.
		//
		// Only from the client whose write actually landed. Every owner with the sheet open runs this
		// sync, and the author's client runs the mirror too, so two can read the old max and both send
		// the clamp; core returns nothing for the one that arrives second and changes nothing.
		const clamped = update["system.attributes.hp.value"];
		if (clamped !== undefined && written) {
			const cause = maxHpFallCause(this, penaltyBefore, penaltyNow);
			await appendLedgerEntries(this._actor, [{
				category: "stats",
				action: `HP changed from ${hpBefore} to ${clamped} (max HP fell to ${hpMax}${cause ? `: ${cause}` : ""})`,
			}]);
		}
		return true;
	}

	/**
	 * The armor arithmetic shared by buildSnapshot, computedVitals and setArmor, so the number Apply
	 * subtracts and the number the sheet shows cannot drift apart. `base` is the derived armor
	 * before the hand-set adjustment, kept apart because the total is clamped (see buildSnapshot).
	 */
	_armorFrom(gear, moveBonuses) {
		const worn = this._inventory.wornArmorBase(gear.items, gear.marks);
		// Barkskin and A Candle Against the Dark say the character HAS 2 armor, which is a worn base and
		// not a bonus: the best base wins and a shield still adds on top (actors/character/move-armor.js).
		// `worn` itself stays the gear's, because "unarmored" is about what you are WEARING — the moves
		// that ask (Uncanny Reflexes) mean armor, not bark.
		const granted = moveArmor({
			actor: this._actor,
			holyLight: this.holyLight,
			// A Candle Against the Dark's "otherwise unarmed": no Candle armor with a shield carried.
			shield: _carriesShield(gear),
			// A THUNK, not a value: the world scan behind it is the expensive part of this function, and a
			// character with Barkskin of their own never needs asking (see moveArmor).
			markedWithBarkskin: () => barkskinMarkedBy(this._actor, globalThis.game?.actors ?? []),
		});
		const base = Math.max(0, this._inventory.calculateArmor(gear.items, Math.max(worn, granted.base), gear.marks) + moveBonuses.armor);
		// How much of the total the move actually bought, which is nothing when the gear was already
		// better: that is what a damage card offers back when the fiction says the clause is not met.
		const conditional = Math.max(0, granted.base - worn);
		return {
			worn,
			base,
			conditional,
			conditionalSource: conditional > 0 ? granted.source : "",
			armor: Math.max(0, base + this.armorAdjustment),
			unpierceable: this._inventory.unpierceableArmor(gear.items, gear.marks),
		};
	}

	/**
	 * Bank a hand-typed armor total as the delta that reaches it. Mirrors setMaxHp: the typed
	 * number is what the player wants to SEE, so the stored adjustment is that minus everything
	 * currently derived. Typing the derived number back in clears the adjustment to 0.
	 * Returns the total that will now render.
	 */
	async setArmor(input) {
		const typed = Math.trunc(Number(input));
		// Null rather than the rendered total: the one caller (_onArmorEdit) has already
		// rejected a blank or nonsense box and discards this, so rebuilding the entire
		// snapshot to answer a question nobody asked was pure cost.
		if (!Number.isFinite(typed)) return null;
		const target  = Math.max(0, typed);
		// `armorBase` and NOT `armor` minus the adjustment: the total is clamped at 0, so once a
		// negative adjustment has bottomed it out the subtraction gives back the adjustment's own
		// size instead of the derived armor, and the delta banked from it lands somewhere else.
		// _derivedInputs, not buildSnapshot: the one number, without building a whole sheet for it.
		const { gear, moveBonuses } = await this._derivedInputs();
		const derived = this._armorFrom(gear, moveBonuses).base;
		await this._actor.update({ "system.attributes.armor.adjustment": target - derived });
		return target;
	}

	/** The Heavy's Guardian move (+1 Readiness on every Defend, incl. a 6-). */
	get hasGuardianMove() {
		return ownsLearnedMoveNamed(this._actor, _GUARDIAN_MOVE_NAME);
	}

	get defendReadiness() {
		return readinessCount(this._actor.getFlag(STONETOP_SCOPE, READINESS_FLAG));
	}

	/** The view model the sheet renders as circles beside the Defend move. Async only because
	 *  bearsShield now spans every gear store rather than one hard-coded slug. */
	async defendReadinessContext(gear = null) {
		const opts  = { hasShield: await this.bearsShield(gear), hasGuardian: this.hasGuardianMove };
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
			// Big Damn Hero's "don't roll to Defend", while it is still there to make in this fight
			// (fight/hero-moves.js#leapInOpen): the row's Leap in button.
			leapIn: leapInOpen(this._actor),
			pips: Array.from({ length: count }, (_, i) => ({ index: i, filled: i < value })),
		};
	}

	async setDefendReadiness(n) {
		const next = readinessCount(n);
		if (next === this.defendReadiness) return;
		await this._actor.setFlag(STONETOP_SCOPE, READINESS_FLAG, next);
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
		return Object.fromEntries(MOVE_STATE.filter(s => s.glyph).map(s => [s.glyph, s.held(this._actor, owned)]));
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
		// The Invocations go out with the light: "it will end immediately if your holy light is
		// extinguished". BOTH slots. Enforced HERE rather than at the one button that snuffs a
		// flame, so no future way of putting a light out can strand a Lightbearer concentrating on
		// nothing. Anyone who wants to SAY what stopped reads `ongoingInvocations` before calling.
		const droppedInvocation = !next && this.ongoingInvocations.length > 0 && await this._writeInvocationState({});
		if (next === this.holyLight) return !!droppedInvocation;
		if (next) await this._actor.setFlag(STONETOP_SCOPE, HOLY_LIGHT_FLAG, true);
		else      await this._actor.unsetFlag(STONETOP_SCOPE, HOLY_LIGHT_FLAG);
		return true;
	}

	/**
	 * After a roll of a move that turns the light on or off (holy-light.js#holyLightAfterRoll): Luminous
	 * Shield's 6- ("your light snuffs out") and Wielder of the White Flame's 7+ ("it ignites with a white
	 * flame that casts a holy light"). Only for the move LEARNED. The snuffing is news, so the chat says
	 * what went out, naming any Invocation it took with it (read before the write, which ends them).
	 * Lighting posts nothing: the roll card already says so. Returns whether anything changed.
	 */
	async _settleHolyLightOnRoll(item, tier) {
		const lit = holyLightAfterRoll(item?.name, tier);
		if (lit === null || !ownsLearnedMoveNamed(this._actor, item.name)) return false;
		if (lit) return this.setHolyLight(true);
		const running = this.ongoingInvocations;
		if (!await this.setHolyLight(false)) return false;
		const names = running.length ? invocationLabels(running, (await this.invocationSource())?.options) : "";
		await postMoveNote(this._actor, item.name, format(names ? "stonetop.holyLight.snuffedEnding" : "stonetop.holyLight.snuffedByRoll",
			{ name: this._actor.name, invocations: names }));
		return true;
	}

	/**
	 * The holy light for a tier of one of the two moves that light or snuff it, at the roll and again when
	 * its card's tier is moved afterwards (actors/character/tier-effects.js). `done` is what the card did so
	 * far: `true` when a Wielder of the White Flame card lit it, `{lit, invocations}` when a Luminous Shield
	 * card snuffed it (whether it was lit, and the Invocations it ended), falsy for nothing. A tier that no
	 * longer asks for it undoes it: the light put out again, or relit with its Invocations back.
	 * Resolves to the card's new record.
	 */
	async settleHolyLightTier(moveName, tier, done = false) {
		const lit = holyLightAfterRoll(moveName, tier);
		const move = { name: moveName };
		if (moveName === LUMINOUS_SHIELD) {
			if (lit === false && !done) {
				const was = { lit: this.holyLight, invocations: this.invocationState };
				return (await this._settleHolyLightOnRoll(move, tier)) ? was : false;
			}
			if (lit !== false && done) {
				if (done.lit) await this.setHolyLight(true);
				await this._writeInvocationState(done.invocations ?? {});
				return false;
			}
			return done || false;
		}
		if (lit === true && !done) return !!(await this._settleHolyLightOnRoll(move, tier));
		if (lit !== true && done) { await this.setHolyLight(false); return false; }
		return !!done;
	}

	// -- The ongoing Invocations (what the Lightbearer is concentrating on) ------------

	/** The slug of the Invocation being held open (the first slot), or "" for none. See
	 *  ongoing-invocation.js for why each slot is one slug, and why the label isn't stored. */
	get ongoingInvocation() {
		return this.invocationState.primary;
	}

	/** The second running Invocation (Burn Twice as Bright, or one used through an empowered
	 *  Dancing Light), or "". */
	get ongoingInvocationSecond() {
		return this.invocationState.second;
	}

	/** Was the first slot's Invocation used empowered? */
	get ongoingInvocationEmpowered() {
		return this.invocationState.empowered;
	}

	/** Every running Invocation's slug, first slot first. */
	get ongoingInvocations() {
		return runningSlugs(this.invocationState);
	}

	/** The whole stored state, normalised (ongoing-invocation.js#readInvocationState). */
	get invocationState() {
		const get = key => this._actor.getFlag(STONETOP_SCOPE, key);
		return readInvocationState({
			primary:     get(ONGOING_INVOCATION_FLAG),
			second:      get(ONGOING_SECOND_FLAG),
			empowered:   get(ONGOING_EMPOWERED_FLAG) === true,
			snuff:       get(ONGOING_SNUFF_FLAG) === true,
			secondSnuff: get(ONGOING_SECOND_SNUFF_FLAG) === true,
		});
	}

	/**
	 * Write the ongoing state in ONE update, touching only the flags that differ, so hooks never see
	 * a half-written state (a first slot with no second). Unset rather than storing "" or false: an
	 * Invocation that has ended should leave no trace on the actor, the same way a snuffed light
	 * doesn't. True when anything was written.
	 */
	async _writeInvocationState(next) {
		const s = readInvocationState(next);
		const wanted = [
			[ONGOING_INVOCATION_FLAG,   s.primary || undefined],
			[ONGOING_SECOND_FLAG,       s.second || undefined],
			[ONGOING_EMPOWERED_FLAG,    s.empowered || undefined],
			[ONGOING_SNUFF_FLAG,        s.snuff || undefined],
			[ONGOING_SECOND_SNUFF_FLAG, s.secondSnuff || undefined],
		];
		const update = {};
		for (const [key, value] of wanted) {
			const raw = this._actor.getFlag(STONETOP_SCOPE, key);
			if (value === undefined ? raw == null : raw === value) continue;
			const path = `flags.${STONETOP_SCOPE}.${key}`;
			if (value === undefined) {
				const [deleteKey, deleteValue] = deletionEntry(path);
				update[deleteKey] = deleteValue;
			} else update[path] = value;
		}
		if (!Object.keys(update).length) return false;
		await this._actor.update(update);
		return true;
	}

	/**
	 * Replace the ongoing state (ongoing-invocation.js#resolveInvocationUse's `state`). Honours the
	 * snuff stamp: when a slot that carried it ends, however it ends, the holy light goes out too,
	 * which ends whatever was left running ("it will end immediately if your holy light is
	 * extinguished").
	 *
	 * @returns {Promise<{changed: boolean, ended: string[], snuffed: boolean}>}  `ended` is every
	 *   slug that stopped, the light's casualties included.
	 */
	async setInvocationState(next) {
		const before = this.invocationState;
		const after  = readInvocationState(next);
		const { ended, snuffs } = invocationEndings(before, after);
		const changed = await this._writeInvocationState(after);
		const snuffed = snuffs && this.holyLight && await this.setHolyLight(false);
		const all = snuffed ? [...new Set([...ended, ...runningSlugs(after)])] : ended;
		return { changed: changed || !!snuffed, ended: all, snuffed: !!snuffed };
	}

	/** Concentrate on this one Invocation alone, or end everything with "". Same contract as
	 *  setHolyLight: true only when something actually changed, so renewing the Invocation
	 *  already running writes nothing and broadcasts nothing. */
	async setOngoingInvocation(slug) {
		const next = readOngoing(slug);
		const now  = this.invocationState;
		if (next === now.primary && !now.second) return false;
		return (await this.setInvocationState({ primary: next, snuff: next === now.primary && now.snuff,
			empowered: next === now.primary && now.empowered })).changed;
	}

	/** End one running Invocation by its slug, or all of them with "" (the End it controls). See
	 *  ongoing-invocation.js#resolveInvocationEnd for what ending the first slot does to the second. */
	async endOngoingInvocation(slug = "") {
		const { state, changed } = resolveInvocationEnd({ current: this.invocationState, ending: slug });
		if (!changed) return { changed: false, ended: [], snuffed: false };
		return this.setInvocationState(state);
	}

	/**
	 * Stamp a running Invocation so that ending it also snuffs the holy light (the Invoke
	 * consequence "the light is snuffed out when the Invocation is complete"). False when that slug
	 * isn't running or already carried the stamp.
	 */
	async markInvocationSnuff(slug, on = true) {
		const now = this.invocationState;
		const want = readOngoing(slug);
		if (!want) return false;
		if (want === now.primary) return this._writeInvocationState({ ...now, snuff: !!on });
		if (want === now.second)  return this._writeInvocationState({ ...now, secondSnuff: !!on });
		return false;
	}

	/** The Invocations waiting on the sun (ongoing-invocation.js#NEEDS_SUN_FLAG), as slugs. */
	get invocationsNeedingSun() {
		return readNeedsSun(this._actor.getFlag(STONETOP_SCOPE, NEEDS_SUN_FLAG));
	}

	/**
	 * The Invoke consequence "You must bask in sunlight for an hour or so before using that
	 * Invocation again": put these Invocations on the list. A cue, never a block. Answers the slugs
	 * this ADDED (not the ones already there), so a caller undoing its own tick takes back only those.
	 */
	async markNeedsSun(slugs) {
		const now = this.invocationsNeedingSun;
		const added = readNeedsSun(slugs).filter(slug => !now.includes(slug));
		if (added.length) await this._actor.setFlag(STONETOP_SCOPE, NEEDS_SUN_FLAG, [...now, ...added]);
		return added;
	}

	/** Take these Invocations off the list (they have basked, or were used again). Answers the slugs
	 *  it removed; the flag goes entirely once the list is empty. */
	async clearNeedsSun(slugs) {
		const now = this.invocationsNeedingSun;
		const drop = new Set(readNeedsSun(slugs));
		const removed = now.filter(slug => drop.has(slug));
		if (!removed.length) return [];
		const kept = now.filter(slug => !drop.has(slug));
		if (kept.length) await this._actor.setFlag(STONETOP_SCOPE, NEEDS_SUN_FLAG, kept);
		else await this._actor.unsetFlag(STONETOP_SCOPE, NEEDS_SUN_FLAG);
		return removed;
	}

	/**
	 * Run `run` (a roll of `moveName`) with `context` held as that roll's pick context: what was
	 * decided before the dice that changes how many options its card allows (`{empowered,
	 * burnTwice}` for Invoke the Sun God; see move-pick-bonuses.js), and which Invocations the roll is
	 * for (`invocations`, stamped on the card for its consequences; invoke-consequences.js). Held in
	 * memory, never written, and let go however the roll ends, so it can reach no other roll. It rides here rather than
	 * through onRoll's options because the roll prompt, the stat ladder and onRoll all sit between
	 * the invoke window that decided it and item/StonetopItem.js#roll that builds the card.
	 */
	async withPickContext(moveName, context, run) {
		this._pickContext = context ? { ...context, move: moveName } : null;
		try { return await run(); }
		finally { this._pickContext = null; }
	}

	/** The pick context held for a roll of `moveName`, or null. */
	pickContextFor(moveName) {
		const ctx = this._pickContext;
		return ctx && ctx.move === moveName ? ctx : null;
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
	 *
	 * `op` is the roster operation itself, `raw => result`, not its result: it is run against the
	 * list as stored AFTER every earlier write to this flag has landed. Writes to one actor's flag
	 * queue behind each other (turn-queue.js#inTurn), because the document only takes a write once the
	 * server answers. Run on the spot, a note blurred and a tick clicked a moment later both read
	 * the list from before the note, and the tick's whole-array write put the old note back.
	 */
	async _rosterWrite(flag, op) {
		return (await this._rosterOp(flag, op)).done;
	}

	/** `_rosterWrite`'s queue, answering `{ result, done }`: the operation's whole result as well. */
	_rosterOp(flag, op) {
		// Keyed by actor uuid, not this wrapper, which is not guaranteed to be the same object twice.
		return inTurn(`roster:${this._actor?.uuid ?? this._actor?.id ?? ""}|${flag}`, async () => {
			const result = op(this._rosterRaw(flag));
			const done = result?.added ?? result?.removed ?? result?.changed ?? null;
			if (done) await this._actor.setFlag(STONETOP_SCOPE, flag, result.entries);
			return { result, done };
		});
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
		// RECORD-KEEPING ONLY. Castigate's 1d4 used to ride this write, which meant a Judge without
		// Condemn (Castigate is level 2+, Condemn level 6+) never dealt it at all, since only Condemn
		// opens the window that lays brands. The blow now lands where the Censure itself is used (the
		// sheet's _censure), and a brand laid from the window afterwards, or added by hand, rolls
		// nothing, so one Censure is never two 1d4s.
		return this._rosterWrite(CONDEMNED_FLAG, raw => addCondemned(raw, entry, newRosterId));
	}

	/** Whether this Judge's Censure hurts: Castigate LEARNED, not merely listed. */
	get canCastigate() {
		return ownsLearnedMoveNamed(this._actor, CASTIGATE);
	}

	/** Whether this Judge may Censure a whole group at once (Proclamation), so every member is hit. */
	get canProclaim() {
		return ownsLearnedMoveNamed(this._actor, PROCLAMATION);
	}

	/**
	 * CASTIGATE: "When you Censure someone, your voice deals 1d4 damage to them (near, loud, ignores
	 * armor)." One card at the person Censured, aimed at them by name rather than at whoever happens
	 * to be targeted (the sheet asks who, see _censure). Null when the move is not learned or there
	 * is nobody to hit.
	 *
	 * @param {Actor|TokenDocument} target
	 */
	async castigate(target) {
		if (!this.canCastigate || !target) return null;
		return rollMoveDamageAt(this._actor, target, {
			move: CASTIGATE, formula: "1d4", ignoresArmor: true, tags: ["loud"],
		}).catch(err => console.warn("Stonetop | Castigate's damage could not be rolled", err));
	}

	/** Dismiss one brand — the only way it ever ends. Returns the entry that was lifted, or null. */
	async dismissCondemned(id) {
		return this._rosterWrite(CONDEMNED_FLAG, raw => removeCondemned(raw, id));
	}

	/** Re-word why somebody is branded. Returns the patched entry, or null when nothing changed. */
	async setCondemnedNote(id, note) {
		return this._rosterWrite(CONDEMNED_FLAG, raw => noteCondemned(raw, id, note));
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
	 * Witness an oath. Returns the stored entry, or null for a nameless swearer. Every oath is its
	 * own row (oaths.js), so somebody already on the list swearing again is a second row.
	 */
	async witnessOath(entry) {
		return this._rosterWrite(OATHS_FLAG, raw => addOath(raw, entry, newRosterId));
	}

	/** Release somebody from an oath — the only way it ends. Returns the entry lifted, or null. */
	async releaseOath(id) {
		return this._rosterWrite(OATHS_FLAG, raw => removeOath(raw, id));
	}

	/** Re-word what somebody swore. Returns the patched entry, or null when nothing changed. */
	async setOathNote(id, note) {
		return this._rosterWrite(OATHS_FLAG, raw => noteOath(raw, id, note));
	}

	/** Mark an oath kept or broken — a broken one is advantage on all rolls against them. */
	async setOathBroken(id, broken) {
		return this._rosterWrite(OATHS_FLAG, raw => setOathBroken(raw, id, broken));
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
		return this._rosterWrite(BLESSED_MARKS_FLAG, raw => addMark(raw, entry, newRosterId));
	}

	/** Lift a mark. Returns the entry lifted, or null when the id matched nothing. */
	async liftBlessedMark(id) {
		return this._rosterWrite(BLESSED_MARKS_FLAG, raw => removeMark(raw, id));
	}

	/** Re-word what a mark is for. Returns the patched entry, or null when nothing changed. */
	async setBlessedMarkNote(id, note) {
		return this._rosterWrite(BLESSED_MARKS_FLAG, raw => noteMark(raw, id, note));
	}

	/**
	 * Say whether a ward's signs repel or trap — the choice Wards & Bindings asks for at the moment
	 * it is laid, and the one thing that says which of the two a row is. Returns the patched entry,
	 * or null when nothing changed, which is also what the four kinds without the choice get back.
	 */
	async setBlessedMarkSign(id, sign) {
		return this._rosterWrite(BLESSED_MARKS_FLAG, raw => setMarkSign(raw, id, sign));
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
		const { result, done } = await this._rosterOp(BLESSED_MARKS_FLAG,
			raw => setMarkLoyalty(raw, id, loyalty, options));
		return { changed: done, ended: done ? result.ended : false };
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
		return ignoresDebilities({ raging: this.battleJoy, learned: ownsLearnedMoveNamed(this._actor, BATTLE_JOY) });
	}

	/**
	 * Returns true only when the flag actually changed, so a caller can skip a re-render. Entering
	 * needs the move LEARNED (canEnterBattleJoy); leaving never needs anything, so a stranded rage
	 * can always be put out.
	 */
	async setBattleJoy(raging) {
		const next = !!raging;
		if (next === this.battleJoy) return false;
		if (next && !canEnterBattleJoy(this._actor)) return false;
		if (next) await this._actor.setFlag(STONETOP_SCOPE, BATTLE_JOY_FLAG, true);
		else      await this._actor.unsetFlag(STONETOP_SCOPE, BATTLE_JOY_FLAG);
		return true;
	}

	/**
	 * Matched on the resolved ITEM's name, never on a row's text: an un-owned playbook row posts its
	 * text with no item at all, and a player-authored custom move can carry any name, so a homebrew
	 * "Battle Joy" ends nothing (owns-move.js#bookMoveName).
	 *
	 * Returns whether it actually ended something, so the sheet knows whether this roll was the end
	 * of a rage (and can repaint the glyph) or an ordinary Battle Joy roll by somebody who never
	 * ticked it on.
	 */
	async _endBattleJoyBeforeRoll(item) {
		if (bookMoveName(item) !== BATTLE_JOY) return false;
		return this.setBattleJoy(false);
	}

	// Raise the held Readiness to the amount this Defend tier grants, never lowering an
	// existing pool (a fresh 7-9 shouldn't shrink Readiness you're already holding). Posts
	// a chat note when the pool actually grows.
	//
	// Also for the tier the card is moved to afterwards (a Shift, a +1 on it): `done` is what the
	// card's earlier tier did, `{prior, set}` (actors/character/tier-effects.js), and the pool moves
	// by the difference, so Readiness spent since stays spent. Absent at the roll itself.
	// Resolves to the card's new record.
	async settleDefendReadinessTier(tier, done = null) {
		// Resolved once: the note below must credit the shield on exactly the rolls the hold did.
		const hasShield = await this.bearsShield();
		const hold = defendReadinessHold(tier, { hasShield, hasGuardian: this.hasGuardianMove });
		const existing = this.defendReadiness;
		const prior = done ? readinessCount(done.prior) : existing;
		const { next, set } = readinessForTier({ prior, set: done ? done.set : prior, current: existing, hold });
		if (next === existing) return { prior, set };
		await this.setDefendReadiness(next);
		if (next < existing) return { prior, set };
		// The shield's +1 rides a 7+ hit only, so don't credit it on a 6- miss (where the
		// hold comes solely from Guardian) — that would falsely imply the shield applied.
		const shieldNote = (hasShield && tier !== "failure") ? " (shield)" : "";
		await ChatMessage.create({
			content: moveChatCard("Defend: Readiness held",
				`<p><strong>${escHtml(this._actor.name)}</strong> holds <strong>${next}</strong> Readiness${escHtml(shieldNote)}.</p>`
				+ `<p>Spend it to suffer an attack's damage/effects for a ward, halve it, draw all attention to yourself, or strike back.</p>`),
			speaker: ChatMessage.getSpeaker({ actor: this._actor }),
		});
		return { prior, set };
	}

	async onDirectStatRoll(stat, extraOptions = {}) {
		const { rollStat } = await import("../../utils/roll-engine.js");
		// `rollMode` is the pre-roll prompt's answer when the prompt asked for one (RollDialog.js)
		// and absent otherwise, in which case the sheet's sticky selector decides. Destructured
		// rather than left in `rest` so the caller cannot half-set it: Know Things passes a mode
		// it has already lifted through advantageRollOptions, and that is a value, not an override.
		// `targets` is whom the roll is aimed at, for a caller that knows better than this user's targets
		// on the map ([] for a roll aimed at nobody: Struggle as One's); absent, those targets decide.
		// `takenOffers` and `offered` are the roll window's answer about the lines it offered, as onRoll's
		// are (directRollOffers); a caller that asked no window (Struggle as One) takes none.
		// A caller that netted sources of its own (Struggle as One's board, Know Things' Polyglot) hands them
		// over as `modeBase` + `modeSources` (roll-mode.js#layModes) beside the mode they fold to, so a
		// cancelled pair stays cancelled when a debility or a held promise is laid on below.
		const { situational = 0, rollMode = null, targets = null, takenOffers = null, offered = null, ...rest } = extraOptions;
		// The +forward is claimed with the held promises just before the dice, below.
		const ongoing  = this._actor.system?.attributes?.ongoing?.value ?? 0;
		// `situational` is the one-off modifier from the optional pre-roll prompt; the
		// roll engine renders it as a "Situational" pill (modifier − forward − ongoing).
		const modifier = ongoing + situational;

		// Returned so a caller that has to act on the outcome (the arcana Identify roll) can
		// classify the total without re-rolling or re-deriving the tier thresholds.
		const base = {
			rollMode: normalizeRollMode(rollMode ?? this.rollMode),
			modifier,
			// Added once claimed (_foldOwed).
			forward: 0,
			ongoing,
			...rest,
		};
		// A guided move whose row has no rollable of its own rolls here by name, so the grudges a roll aimed
		// at someone carries (Binding Arbitration, But I Get Up Again, Alpha, Tough Love) and its standing
		// advantage and disadvantage are folded here as well as in onRoll.
		const aimed = this._foldAimedModes(base, targets ?? this._rollTargets(rest));
		const standing = this._foldStandingNotes(this._foldStandingModes(aimed.options, rest.moveName));
		// And the lines the window offered it that the player left ticked (Binding Arbitration's on a roll aimed
		// at nobody, Constant Vigilance's on a guided move), folded and paid for as onRoll's are. Binding
		// Arbitration's is dropped when the aim above has already named the oath.
		const taken = await _takenOffers(takenOffers, offered, () => this.directRollOffers(rest.moveName),
			{ oathbreakerNamed: aimed.oathbreaker });
		// Claimed just before the dice and put back when none are thrown, as onRoll does (_claimNextRollOwed).
		const owed = await this._claimNextRollOwed(rest.moveName);
		let roll;
		try {
			roll = await rollStat(stat, this._actor, this.applyDebilityRollMode(stat,
				this._foldOwed(_foldTakenOffers(standing, taken), owed)));
		} catch (err) {
			await owed.refund();
			throw err;
		}
		if (!roll) await owed.refund();
		await _payTakenOffers(taken, roll, rest.moveName);
		// Alpha's and But I Get Up Again's advantage was for this one roll against them.
		if (roll) await aimed.spend();
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
	 * Shaken nerves DO: We Happy Few's 6- is "disadvantage on ALL rolls until you share your
	 * nerves", the move's own price on the Marshal's rolls, not a weakness of the body the way a
	 * debility is, and giving orders is still the Marshal rolling. Folded, as applyDebilityRollMode
	 * folds it, so it cancels a tag's or Shield Wall's advantage rather than stacking.
	 *
	 * @param {object} opts
	 * @param {number} [opts.bonus]     - 0, 1, or 2
	 * @param {string} [opts.rollMode]  - "normal" | "adv" | "dis"
	 * @param {string[]} [opts.modeSources] - the sides that netted to `rollMode` (data/follower-build.js
	 *   #orderFollowersModeSources), so the nerves are folded with each of them rather than with the net
	 * @param {string} [opts.moveName]  - Card header, e.g. "Hari: Defy Danger"
	 */
	async onOrderFollowersRoll({ bonus = 0, rollMode = "normal", modeSources = null, moveName, shieldWall = false } = {}) {
		const { rollStat } = await import("../../utils/roll-engine.js");
		// Return the roll so the caller can react to the result — e.g. auto-holding
		// Readiness when a follower is ordered to Defend and rolls 7+ (p.469).
		// With the sides handed over, a straight roll reached by cancelling stays straight under the nerves;
		// without them (a caller that hands only the net), the net is the one side.
		const sources = Array.isArray(modeSources) ? modeSources : [rollMode];
		const nerves = fightStateActive(this._actor, "nerves");
		// Where an advantage came from, when the Marshal's Shield Wall gave it, and a disadvantage.
		const conditionNotes = [
			...(shieldWall ? ["Shield Wall"] : []),
			...(nerves ? [format("stonetop.nerves.rollNote", { move: WE_HAPPY_FEW })] : []),
		];
		return rollStat("follower", this._actor, {
			statValue: Math.trunc(Number(bonus) || 0),
			rollMode:  foldModes(nerves ? [...sources, "dis"] : sources, "normal"),
			moveName:  moveName || "Order Followers",
			modifier:  0,
			...(conditionNotes.length ? { conditionNotes } : {}),
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
		const out = this._debilityRollMode(stat, options);
		// We Happy Few's 6-: "disadvantage on ALL rolls until you share your nagging doubts". Folded rather than
		// stepped, so it cancels an advantage the way a debility does and does not stack with one (p.230);
		// and named on the card, since nothing else on it would say why. Not something Battle Joy ignores:
		// it is the move's own price, not a debility.
		if (!fightStateActive(this._actor, "nerves")) return out;
		return {
			...layModes(out, ["dis"]),
			conditionNotes: [...(out.conditionNotes ?? []), format("stonetop.nerves.rollNote", { move: WE_HAPPY_FEW })],
		};
	}

	/** The debility half of {@link applyDebilityRollMode}: what a marked box does to this roll. */
	_debilityRollMode(stat, options) {
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
		// Folded with every source laid before it (layModes), so it cancels an advantage however
		// many stages that advantage came through.
		return { ...layModes(options, ["dis"]), stonetopDebility: def?.name ?? key, stonetopDebilityTooltip: def?.description ?? "" };
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

	/**
	 * A HELD advantage: "take advantage on your next roll", promised by something that has
	 * already happened (Make Camp's peaceful night, p.334). The steading holds the same promise
	 * the same way — see StonetopSteading#fortunesAdvantage — and for the same reason: the roll
	 * it is owed to has not been made yet, possibly not this session, so it has to be written
	 * down somewhere that roll will look.
	 *
	 * NOT the sticky selector. The sticky flag is a PREFERENCE the player sets and unsets, and it
	 * is not even drawn when "Ask How to Roll Each Time" is on — a promise parked there would be
	 * overruled by the pre-roll window on every client that asks, and never spent on the ones
	 * that don't. This is a promise: it outranks both, it names itself on the card, and it is
	 * consumed by the one roll it was owed to.
	 *
	 * Stored as WHAT PROMISED it rather than a bare `true`, so the card can say why: the names, as a
	 * list. Answers `{sources, source}` (`source` is that list joined for display) or null.
	 */
	heldAdvantage() {
		return this._heldMode("heldAdvantage");
	}

	async clearHeldAdvantage() {
		await this._clearHeldMode("heldAdvantage");
	}

	/**
	 * Take back ONE promise of advantage, by the name it was given under (give-advantage.js#givenSource),
	 * leaving any other promise held beside it: "A peaceful night's rest & Aeron's Everything Burns" loses
	 * the second name and keeps the first. For a gift whose roll card was moved off the tier that gave it
	 * (give-advantage-flow.js#reconcileGivenAdvantage). Whether it was still held to take back.
	 */
	async releaseHeldAdvantage(source) {
		return this._releaseHeldSource("heldAdvantage", source);
	}

	/**
	 * {@link releaseHeldAdvantage} for a held disadvantage: an Interfere's answer withdrawn
	 * (pc-asks/pc-ask-flow.js#withdrawDeletedAnswer) takes back its own name and nothing held beside it.
	 */
	async releaseHeldDisadvantage(source) {
		return this._releaseHeldSource("heldDisadvantage", source);
	}

	async _releaseHeldSource(flag, source) {
		const held = this._heldMode(flag);
		const name = String(source ?? "").trim();
		if (!held?.sources.includes(name)) return false;
		const rest = held.sources.filter(part => part !== name);
		if (!rest.length) await this._actor.setFlag(STONETOP_SCOPE, flag, null);
		else await this._actor.update({ [`flags.${STONETOP_SCOPE}.${flag}`]: { sources: rest } });
		return true;
	}

	/**
	 * Take advantage on your next roll: another promise laid beside any already held.
	 *
	 * ONE FLAG, TWO NAMES. Advantage does not stack (p.230), so a second promise before the roll buys
	 * nothing extra, but the card should still say who made each one: "A peaceful night's rest &
	 * Aeliana's Aid". Both are spent by the same roll, which is what both of them were about.
	 */
	async holdAdvantage(source) {
		await this._actor.update(this.heldAdvantageData(source));
	}

	/** {@link holdAdvantage} as an update fragment, for a move that writes several things at once
	 *  (camp/camp-rules.js#campShareUpdate). Laid beside a promise already held, the same way; `source`
	 *  may be one name or several (the camp's two promises in one write). */
	heldAdvantageData(source) {
		return this._heldModeData("heldAdvantage", source);
	}

	/**
	 * The other half of a held promise: DISADVANTAGE on your next roll, owed to something already
	 * settled. Interfere's "do it anyway, but with disadvantage on their (next) roll" is the
	 * one that lays it so far, and the roll it lands on may be made on a different client, a while
	 * later, by someone who has forgotten, so it is written down where that roll will look.
	 *
	 * Kept apart from the advantage rather than folded into one signed flag: the two CANCEL, and
	 * that is decided at the roll, with both of them named on the card, not at the moment the
	 * second one was laid.
	 */
	heldDisadvantage() {
		return this._heldMode("heldDisadvantage");
	}

	async holdDisadvantage(source) {
		await this._actor.update(this.heldDisadvantageData(source));
	}

	/** {@link holdDisadvantage} as an update fragment, as heldAdvantageData is: a Thrall's Quicksilver
	 *  Dreams lays it with the rest of a camp share (camp/camp-rules.js#campShareUpdate). */
	heldDisadvantageData(source) {
		return this._heldModeData("heldDisadvantage", source);
	}

	async clearHeldDisadvantage() {
		await this._clearHeldMode("heldDisadvantage");
	}

	// The two held promises differ only in their flag ("heldAdvantage" / "heldDisadvantage"). Read as
	// the list of names (heldSources, which also reads a flag from before the list) and the one line
	// every surface shows for them, joined as every list of names is (strings.js#joinNames).
	_heldMode(flag) {
		const sources = heldSources(resolvedFlags(this._actor)[flag]);
		return sources.length ? { sources, source: joinNames(sources) } : null;
	}

	_heldModeData(flag, source) {
		return { [`flags.${STONETOP_SCOPE}.${flag}`]: { sources: mergeSources(this._heldMode(flag)?.sources ?? [], source) } };
	}

	async _clearHeldMode(flag) {
		if (!this._heldMode(flag)) return;
		await this._actor.setFlag(STONETOP_SCOPE, flag, null);
	}

	/**
	 * Spend whatever is held over the next roll (an advantage, a disadvantage, or both) into the
	 * options of the roll about to be made.
	 *
	 * A held advantage OUTRANKS the sticky selector and the pre-roll window as a source of
	 * advantage (those are preferences, this is a rule the fiction already settled), but it never
	 * beats a disadvantage, from wherever that came. Advantage and disadvantage CANCEL in Stonetop,
	 * so a promise spent against one leaves a flat roll: a player who picked Disadvantage in the
	 * window because they are doing this in the dark must not be silently upgraded past it, and
	 * nor must a character who camped peacefully and is still Weakened. That second case is why
	 * this runs BEFORE `applyDebilityRollMode`: it hands that method an "adv" to cancel, exactly
	 * as the sticky selector would have. A held disadvantage is the same rule from the other side.
	 *
	 * Folded ALL AT ONCE, with every source the roll has already been handed (layModes), never one
	 * step at a time: a sticky Disadvantage, an Aid and an Interfere is one side each way and a
	 * straight roll, where stepping would cancel the first pair and let the Interfere push the roll
	 * back down. The same holds across stages: a grudge laid before this and a debility after it.
	 *
	 * Either way the pills NAME the promises, so a cancellation reads as a trade rather than as a
	 * mode that quietly vanished, and either way they are SPENT, because they were made about this
	 * roll and this is the roll that happened.
	 *
	 * The +forward rides along: added to the roll's modifier and named on its card (roll-engine.js
	 * #rollStat's Forward pill). PURE: what is folded here was claimed by _claimNextRollOwed.
	 *
	 * @param {object} options  the roll's options so far
	 * @param {{forward: number, held: {adv: object|null, dis: object|null}}} owed
	 */
	_foldOwed(options, { forward = 0, held = {} } = {}) {
		const { adv = null, dis = null } = held ?? {};
		const withForward = forward
			? { ...options, modifier: (options.modifier ?? 0) + forward, forward: (options.forward ?? 0) + forward }
			: options;
		if (!adv && !dis) return withForward;
		return {
			...layModes(withForward, [adv ? "adv" : "", dis ? "dis" : ""]),
			conditionNotes: [...(withForward.conditionNotes ?? []), ...[adv, dis].filter(Boolean).map(promise => promise.source)],
		};
	}

	/**
	 * CLAIM what the next roll is owed: the +forward and whatever is held over it (an advantage, a
	 * disadvantage, or both). Read and cleared in ONE write, before the dice, in this character's roll
	 * turn on this client (_inRollTurn), so two rolls started together cannot both take them: the second
	 * reads what the first left, which is nothing. A roll that throws before its dice, or makes none, puts
	 * them back with `refund()`, so a promise is never lost to a roll that did not happen.
	 *
	 * @param {string|null} [moveName]  the move the ledger files the cleared +forward under
	 * @returns {Promise<{forward: number, held: {adv: object|null, dis: object|null}, refund: () => Promise<void>}>}
	 */
	_claimNextRollOwed(moveName = null) {
		const ledger = moveName ? { stonetopMove: moveName } : {};
		return _inRollTurn(this._actor, async () => {
			const forward = Math.trunc(Number(this._actor.system?.attributes?.forward?.value) || 0);
			const adv = this.heldAdvantage();
			const dis = this.heldDisadvantage();
			const update = {
				...(forward ? { "system.attributes.forward.value": 0 } : {}),
				...(adv ? { [`flags.${STONETOP_SCOPE}.heldAdvantage`]: null } : {}),
				...(dis ? { [`flags.${STONETOP_SCOPE}.heldDisadvantage`]: null } : {}),
			};
			if (Object.keys(update).length) await this._actor.update(update, ledger);
			let refunded = false;
			const refund = () => _inRollTurn(this._actor, async () => {
				if (refunded || !Object.keys(update).length) return;
				refunded = true;
				// Laid back BESIDE whatever was given since (a new +1 forward, another promise), never over it.
				const now = Math.trunc(Number(this._actor.system?.attributes?.forward?.value) || 0);
				await this._actor.update({
					...(forward ? { "system.attributes.forward.value": now + forward } : {}),
					...(adv ? this.heldAdvantageData(adv.sources) : {}),
					...(dis ? this.heldDisadvantageData(dis.sources) : {}),
				}, ledger);
			});
			return { forward, held: { adv, dis }, refund };
		});
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
		return this.deathsDoorStateUpdateData(null);
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
	 *
	 * LEARNED moves only: an un-ticked Hard to Kill offers no +CON and no debility trade, and an
	 * un-ticked Unstoppable charges no penalty for circles it still shows on the sheet.
	 *
	 * The Would-Be Hero's two bends ride along: Never Gonna Keep Me Down's once-a-session 10+ (a
	 * learned move, its circle clear) and the Destined's shifted tier (the background, its "Destiny
	 * fulfilled" box unticked).
	 */
	deathsDoorRollOptions() {
		const moves = this._actor.items.filter(i => i.type === "move" && moveLearnedIn(i, this._actor.items));
		const opts  = deathsDoorRollOptions(moves.map(i => i.name), this._moveResources.getMoveResources(),
			{ backgroundSlug: this._background.selectedSlug, setupResources: this._background.setupResources });
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

	/**
	 * Unstoppable: "If you survive, clear all your circles." Read through deathsDoorRollOptions,
	 * so the circles cleared are exactly the ones the roll was charged for (none for an un-learned
	 * Unstoppable). Returns how many were cleared; 0 writes nothing.
	 */
	async clearUnstoppableCircles() {
		const { unstoppableMarks } = this.deathsDoorRollOptions();
		if (!unstoppableMarks) return 0;
		await this._moveResources.setUses(UNSTOPPABLE, 0, { stonetopMove: UNSTOPPABLE });
		return unstoppableMarks;
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
		// 0 is computedVitals' way of saying "there is no computed max" (no playbook). A bare `??` would
		// hand back a max of 0, and every caller doing arithmetic on it inherited the zero:
		// UndeathDialog's "reform with half your max HP" floored to 1 HP for a Ghost whose playbook slug
		// no longer resolved in the pack, which is the one moment it most matters.
		const { maxHp } = await this.computedVitals();
		return maxHp > 0 ? maxHp : this.storedMaxHp;
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
		// The HP that goes with a lowered max is not damage taken (StonetopFlags.js#HP_CEILING_OPTION).
		if (update["system.attributes.hp.value"] !== undefined) await this._actor.update(update, { [HP_CEILING_OPTION]: true });
		else await this._actor.update(update);
		return target;
	}

	/**
	 * A new playbook starts at full HP: "Start play with your current HP equal to your max HP" (Book I
	 * p.53). The REAL max (computedVitals), not the playbook's printed number the drop seeded: a hand-set
	 * adjustment survives a change of playbook (it records an arcanum's or a post-death insert's lasting
	 * cost or boon, and those stay), and so do move bonuses still held. The stored max is written beside
	 * it, as syncStoredVitals would. Ledger-quiet: the playbook change already filed its HP. Returns the
	 * HP now in play (unchanged with no playbook to work a max from).
	 */
	async startAtFullHp() {
		const { maxHp } = await this.computedVitals();
		if (!(maxHp > 0)) return this.hp;
		const update = {};
		if (this.hp !== maxHp) update["system.attributes.hp.value"] = maxHp;
		if (this.storedMaxHp !== maxHp) update["system.attributes.hp.max"] = maxHp;
		if (!Object.keys(update).length) return maxHp;
		// A negative adjustment takes the seeded number DOWN to the real max, which is not a blow landing.
		await this._actor.update(update, { stonetopLedger: true, [HP_CEILING_OPTION]: true });
		return maxHp;
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
	get masterTask()        { return this._postDeath.masterTask; }
	async clearMasterTask() { return this._postDeath.clearMasterTask(); }
	get tether()            { return this._postDeath.tether; }
	async setTether(t)      { await this._postDeath.setTether(t); }
	async crossOffMark(s)   { return this._postDeath.crossOffMark(s); }
	async restoreCrossedOffMark(s) { return this._postDeath.restoreCrossedOffMark(s); }
	async sectionOptions(s) { return this._postDeath.sectionOptions(s); }
	async markSectionOption(section, option)   { return this._postDeath.markSectionOption(section, option); }
	async unmarkSectionOption(section, option) { return this._postDeath.unmarkSectionOption(section, option); }
	async clearSectionPicks(section)           { return this._postDeath.clearSectionPicks(section); }
	favor()                 { return this._postDeath.favor(); }
	async setFavor(v)       { await this._postDeath.setFavor(v); }

	// The same writes as `actor.update()` fragments, for a 0-HP move that lands its costs, its hit
	// points and its state in ONE write (UndeathDialog#_onApply). Null where the writing twin would
	// refuse (already marked, already crossed off). See CharacterPostDeath.
	markSectionOptionUpdateData(section, option) { return this._postDeath.markSectionOptionUpdateData(section, option); }
	unmarkSectionOptionUpdateData(section, option) { return this._postDeath.unmarkSectionOptionUpdateData(section, option); }
	crossOffMarkUpdateData(s)  { return this._postDeath.crossOffMarkUpdateData(s); }
	masterTaskUpdateData(t)    { return this._postDeath.masterTaskUpdateData(t); }
	tetherUpdateData(t)        { return this._postDeath.tetherUpdateData(t); }
	favorUpdateData(v)         { return this._postDeath.favorUpdateData(v); }
	/** The Death's Door state as a fragment, written as the caller's decision (see DeathsDoorPrompt's preUpdate). */
	deathsDoorStateUpdateData(state) { return { [`flags.${STONETOP_SCOPE}.${DEATHS_DOOR_FLAG}`]: state ?? null }; }
	/**
	 * THE FINAL CONSEQUENCE as a fragment: marked (unless it already is) and out of play, `dead`. It ends
	 * them as a player character, so the two never land apart (UndeathDialog's destroyed tether, and the
	 * tab's edit-mode tick).
	 */
	finalConsequenceUpdateData() {
		return {
			...(this.markSectionOptionUpdateData(FINAL_CONSEQUENCE.section, FINAL_CONSEQUENCE.option) ?? {}),
			...this.deathsDoorStateUpdateData(DEATHS_DOOR_STATE.DEAD),
		};
	}

	/**
	 * finalConsequenceUpdateData taken back, for a tick made by mistake: unmarked, and back in play in the
	 * same write if it left them `dead`, so the character is never unmarked but still out of every party list.
	 */
	finalConsequenceUndoUpdateData() {
		return {
			...(this.unmarkSectionOptionUpdateData(FINAL_CONSEQUENCE.section, FINAL_CONSEQUENCE.option) ?? {}),
			...(this.deathsDoorState === DEATHS_DOOR_STATE.DEAD ? this.deathsDoorStateUpdateData(null) : {}),
		};
	}

	/**
	 * Fragments like these landed as ONE write, attributed to the move for the ledger: a decision that
	 * restores no hit points (restoreHp's no-rise path, the Final Consequence, Unholy Vessel). No-op on
	 * an empty or absent fragment.
	 */
	async applyUpdate(update, moveName) {
		if (update && Object.keys(update).length) await this._actor.update(update, moveName ? { stonetopMove: moveName } : {});
	}

	/**
	 * How this character left play, when it was not through the Last Door: "monster" for a Ghost or
	 * Revenant who marked the Final Consequence, "threat" for a Thrall lost to Unholy Vessel, else null.
	 * The rule is deaths-door.js#lostToTheGm; this reads the state and the Final Consequence's tick for it.
	 */
	get lostToTheGm() {
		const { section, option } = FINAL_CONSEQUENCE;
		return lostToTheGm({
			state:            resolvedFlagProperty(this._actor, DEATHS_DOOR_FLAG) ?? null,
			insertSlug:       this._postDeath.activeSlug,
			finalConsequence: this._postDeath.lore.getCount(section, option) > 0,
		});
	}

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
	// `alsoUpdate`: more of the same decision, in the same write (We Happy Few's Keep 1 HP puts back
	// the Battle Joy and Readiness the drop cost), so hooks see it land as one.
	// Torment's Blessing halves what it restores, rounded up (deaths-door-actor.js#recoveredHpTo): a Thrall's
	// "half your max HP" is a quarter's worth of hit points back. Never below 1 of a gain, so a Death's
	// Door "regain 1 HP" still brings them back. `unhalved` is for a return that is not a heal (back on
	// their feet from out of the action at half max HP, the user's ruling of 2026-09-30), which it skips.
	async restoreHp(value, moveName, { clearsDeathsDoor = false, alsoUpdate = null, unhalved = false } = {}) {
		const target = recoveredHpTo(this.hp, Math.max(0, Math.trunc(Number(value) || 0)), !unhalved && slowToHeal(this._actor));
		if (target <= this.hp) {
			if (clearsDeathsDoor) await this.setDeathsDoorState(null);
			await this.applyUpdate(alsoUpdate, moveName);
			return false;
		}
		const update = { "system.attributes.hp.value": target, ...(alsoUpdate ?? {}) };
		if (clearsDeathsDoor) Object.assign(update, this._clearDeathsDoorUpdate);
		await this._actor.update(update, moveName ? { stonetopMove: moveName } : {});
		return true;
	}

	/**
	 * The three debilities and whether each is marked, for a move that offers a choice of one. And
	 * the Ranger's Walk It Off box after them, which stands in for a debility wherever one is marked
	 * or cleared (walk-it-off.js#walkItOffChoice says when it is listed); its entry has `standIn`.
	 */
	get debilityChoices() {
		const opts = this._actor.system?.attributes?.debilities?.options ?? {};
		const choices = _DEBILITY_DEFS.map(({ key, name, description }) => ({
			key, name, description, marked: !!opts[key]?.value,
		}));
		const walkItOff = walkItOffChoice(this._actor, this._moveResources);
		return walkItOff ? [...choices, walkItOff] : choices;
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
	 *
	 * `key` can be Walk It Off's (walk-it-off.js) while debilityChoices lists it: the move's box is
	 * marked instead, and no debility is.
	 *
	 * `alsoUpdate`: a further fragment for the same write, as restoreHp's (Hard to Kill's trade closes its
	 * latch in it).
	 */
	async markDebility(key, { hp = null, moveName, clearsDeathsDoor = false, alsoUpdate = null } = {}) {
		const choice = this.debilityChoices.find(d => d.key === key);
		if (!choice || choice.marked) return false;
		const update = debilityData(key, true);
		if (hp !== null && hp > this.hp) update["system.attributes.hp.value"] = hp;
		if (clearsDeathsDoor) Object.assign(update, this._clearDeathsDoorUpdate);
		if (alsoUpdate) Object.assign(update, alsoUpdate);
		await this._actor.update(update, moveName ? { stonetopMove: moveName } : {});
		return true;
	}

	/**
	 * Healing somebody's move hands this character, in ONE write tagged with that move: Bath of
	 * Healing Light's "Regains 5 HP", "Clears a debility", "Has one of their problematic wounds
	 * stabilized" and (empowered) "Fully recovers from a problematic wound".
	 *
	 * HP is regained up to the COMPUTED max (computedMaxHp), never lowered. The write goes through the
	 * HP hooks like any other (hooks/DeathsDoorPrompt.js: leaving Death's Door, Unstoppable's "clear one
	 * mark instead"), so the HP it reports is read back AFTER the write rather than assumed. A debility
	 * not marked, or a wound that is not (or no longer) a problematic one, is skipped, not an error.
	 * A Thrall with Torment's Blessing regains half the HP, rounded up, and the answer's `hp.halved`
	 * says so. Whether the Unliving get anything from it is the CALLER's question: this heals whatever
	 * it is handed, and it is magical healing that does them no good (invocation-apply.js#applyBath).
	 *
	 * @param {object} o
	 * @param {number} [o.hp]                 HP to regain
	 * @param {string[]} [o.clearDebilities]  debility keys to clear
	 * @param {string|null} [o.stabilizeWound]  id of an open problematic wound to stabilize
	 * @param {string|null} [o.healWound]     id of a problematic wound (stabilized or not) to heal outright
	 * @param {string} [o.moveName]
	 * @returns {Promise<{hp: {gain: number, from: number, to: number, halved?: boolean}|null, cleared: {key: string, name: string}[],
	 *   stabilized: object|null, healed: object|null}>}
	 */
	async receiveHealing({ hp = 0, clearDebilities = [], stabilizeWound = null, healWound = null, moveName = null } = {}) {
		const update = {};
		const from = this.hp;
		const gain = Math.max(0, Math.trunc(Number(hp) || 0));
		let halved = false;
		if (gain) {
			// Torment's Blessing: half of what it would have healed, rounded up, and the card says why.
			const should = healTo(from, gain, await this.computedMaxHp());
			const to = recoveredHpTo(from, should, slowToHeal(this._actor));
			halved = to < should;
			if (to > from) update["system.attributes.hp.value"] = to;
		}
		const marked = new Map(this.debilityChoices.filter(d => d.marked).map(d => [d.key, d]));
		const cleared = [...new Set(clearDebilities ?? [])].filter(key => marked.has(key))
			.map(key => ({ key, name: marked.get(key).name ?? key }));
		// Walk It Off's box among them, "clear it as you would a debility".
		for (const { key } of cleared) Object.assign(update, debilityData(key, false));

		let stabilized = null;
		let healed = null;
		const wounds = this._woundList();
		const open = w => !w.healed && (w.status === "problematic" || w.status === "stabilized");
		const heal = healWound ? wounds.findIndex(w => w.id === healWound && open(w)) : -1;
		if (heal >= 0) healed = wounds[heal] = { ...wounds[heal], healed: true };
		// The same change tending a wound on Recover makes (stabilizeOpenWoundsUpdate): stabilized, and
		// whatever it was said to need cleared. Not the one just healed outright.
		const steady = stabilizeWound && stabilizeWound !== healWound
			? wounds.findIndex(w => w.id === stabilizeWound && !w.healed && w.status === "problematic") : -1;
		if (steady >= 0) stabilized = wounds[steady] = { ...wounds[steady], status: "stabilized", requirementNote: "" };
		if (healed || stabilized) update["system.attributes.wounds"] = wounds;

		if (Object.keys(update).length) await this._actor.update(update, moveName ? { stonetopMove: moveName } : {});
		return { hp: gain ? { gain, from, to: this.hp, ...(halved ? { halved } : {}) } : null, cleared, stabilized, healed };
	}

	// ── Problematic / permanent wounds (Book I, Harm & Healing) ────────────────
	// Stored as an array on system.attributes.wounds. Arrays are replaced wholesale
	// on update (unlike object flags, which merge), so every mutation reads the
	// current list, recomputes it, and writes the whole thing back. `moveName`, when
	// given, tags the write so the character ledger attributes it ("via Recover", etc.).

	// A defensive, normalized copy of the current wound list. A record stored with no id reads
	// with the same stand-in id every time (wound-record.js#normalizeWoundList), so the ids the
	// sheet renders are the ids the CRUD below finds.
	_woundList() {
		return normalizeWoundList(this._actor.system?.attributes?.wounds);
	}

	/** The current wound records, normalized: what the sheet's wound editor and Tend read. */
	woundRecords() {
		return this._woundList();
	}

	async _writeWounds(wounds, moveName) {
		await this._actor.update(
			{ "system.attributes.wounds": wounds },
			moveName ? { stonetopMove: moveName } : {},
		);
	}

	// Add a wound. Returns its generated id so callers can immediately open it for editing.
	// `moveName` tags the write for the ledger when a move records it (Death's Door's 10+ mark).
	async addWound(data = {}, { moveName } = {}) {
		const { update, id } = this.addWoundUpdate(data);
		await this._actor.update(update, moveName ? { stonetopMove: moveName } : {});
		return id;
	}

	// addWound as an `actor.update()` fragment, for a move landing the wound in one write with the rest
	// of what it does (Undying's maiming, with its hit points and state). `{update, id}`.
	addWoundUpdate(data = {}) {
		const wound = _normalizeWound(data, { keepId: false });
		return { update: { "system.attributes.wounds": [...this._woundList(), wound] }, id: wound.id };
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

	/**
	 * Every open problematic wound, stabilized: Healer's Arts with its Stock, "their wounds/injuries
	 * are stabilized". The same change tending one wound on Recover makes (status stabilized, any
	 * stored requirement cleared); a permanent injury stays permanent and a healed scar is left alone.
	 *
	 * Handed back as an UPDATE rather than written, so the Recover that bought it carries it in its
	 * own write, with the HP. `update` is empty when nothing needed stabilizing.
	 *
	 * @returns {{update: object, stabilized: object[]}}
	 */
	stabilizeOpenWoundsUpdate() {
		const stabilized = [];
		const wounds = this._woundList().map(w => {
			if (w.healed || w.status !== "problematic") return w;
			const next = { ...w, status: "stabilized", requirementNote: "" };
			stabilized.push(next);
			return next;
		});
		return { update: stabilized.length ? { "system.attributes.wounds": wounds } : {}, stabilized };
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
	async isArcanumUnlocked(slug)                    { return this._arcana.isArcanumUnlocked(slug); }
	async getArcanumMove(slug, moveSlug)             { return this._arcana.getArcanumMove(slug, moveSlug); }
	async addArcanum(slug)                           { await this._arcana.addArcanum(slug); }
	// Its tracks AND its carried mark go with it, so a card that comes back (given back, re-found)
	// arrives set down and charged afresh, not already counting toward load.
	async removeArcanum(slug)                        { await this._arcana.removeArcanum(slug); await this._inventory.clearArcanumResources(slug); await this._inventory.clearCarried(slug); }
	async identifyArcanum(slug, options)             { await this._arcana.identifyArcanum(slug, options); }
	async identifyAndRevealArcanum(slug, options)    { await this._arcana.identifyAndRevealArcanum(slug, options); }
	async identifyFrontOwedArcanum(slug, options)    { await this._arcana.identifyFrontOwedArcanum(slug, options); }
	async addLead(slug)                              { await this._arcana.addLead(slug); }
	async discoverArcanum(slug)                      { await this._arcana.discoverArcanum(slug); }
	async ensureSeekerLeadCard()                     { await this._arcana.ensureLeadBackfill(); }
	async masterArcanum(slug)                        { await this._arcana.masterArcanum(slug); }
	async repairMasteredUnlock()                     { return this._arcana.repairMasteredUnlock(); }
	async getArcanumChatContent(slug, flipped)       { return this._arcana.getArcanumChatContent(slug, flipped); }
	// The Seeker's lore role pickers: a role picked on the sheet changes the cards as a re-run of
	// creation would (settleSeekerArcana), the card leaving any other role it held.
	async setMinorArcanumRole(role, slug) {
		const was = this.seekerCreationState();
		await this.settleSeekerArcana(was, { ...was, minorRoles: withMinorRole(was.minorRoles, role, slug) });
	}
	async revealArcanum(slug, options) { await this._arcana.revealArcanum(slug, options); }
	async hideArcanum(slug, options)   { await this._arcana.hideArcanum(slug, options); }
	get revealedArcanaSlugs()   { return this._arcana.revealedSlugs; }
	get backOwedArcanaSlugs()   { return this._arcana.backOwedSlugs; }
	// The lower rung of p.440's disclosure ladder, so a caller re-applying a rewritten roll tier
	// can tell "never read" from "front already read" and refuse to walk the ladder backwards
	// (see _syncArcanumIdentification in stonetop.js).
	get identifiedArcanaSlugs() { return this._arcana.identifiedSlugs; }
	get ownedArcanaSlugs()      { return this._arcana.ownedSlugs; }
	// Every card's □/○/◇ marks, keyed "slug:context:index" (CharacterArcana#boxStates).
	get arcanaBoxStates()       { return this._arcana.boxStates; }
	async setArcanumUnlockCount(arcanumSlug, optionSlug, count)          { await this._arcana.setUnlockCount(arcanumSlug, optionSlug, count); }
	async setArcanumBackOptionCount(arcanumSlug, optionSlug, count)      { await this._arcana.setBackOptionCount(arcanumSlug, optionSlug, count); }
	async setArcanumBoxChecked(slug, context, index, checked)            { await this._arcana.setArcanumBoxChecked(slug, context, index, checked); }
	async settleArcanumBoxLayouts(options)                             { return this._arcana.settleBoxLayouts(options); }
	async setArcanumBoxesChecked(slug, context, ticks)                 { await this._arcana.setArcanumBoxesChecked(slug, context, ticks); }
	async markNextArcanumUnlockStep(slug, options)                       { return this._arcana.markNextUnlockStep(slug, options); }
	async setArcanumResource(slug, count, options)                       { await this._inventory.setResource(slug, count, options); }
	async setLoreOptionCount(loreSlug, optionSlug, count)           { await this._lore.setCount(loreSlug, optionSlug, count); }
	async setLoreOptionText(loreSlug, optionSlug, value)            { await this._lore.setText(loreSlug, optionSlug, value); }
	// One section's counts in one write, zeros included, so a section can be set wholesale.
	async setLoreSectionCounts(loreSlug, counts)                    { await this._lore.setCounts(loreSlug, counts); }
	get loreTexts()                                                 { return this._lore.texts; }

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
			const retired     = this._retiredMoveNames();
			// Held under any right, not only as the row's own copy: a Heavy holding the Marshal's
			// Armored through Seasoned Warrior (see buildMovelistContext) has the move already.
			const all = this.sortPlaybookMoves(
				this.buildMovelistContext(entries, ownedAllByName, bgMoveNames, newLevel, playbookData.name, this._startingChoiceGroups(playbookData))
			).filter(e => (!ownedAllByName.has(e.name) || (e.repeatable && e.ownedIds.length < e.repeatMax)) && !retired.has(e.name));
			availableMoves = all.filter(e => !e.locked);
			lockedMoves    = all.filter(e => e.locked);
		}

		// Level Up step 5: on an even level, the Lightbearer (or anyone with Invoke the Sun God)
		// chooses a new Invocation. The list rides along on every even level even for someone
		// who lacks the move today, because step 3 comes first: a Would-be Hero who takes
		// Invoke the Sun God through Versatile on this very level-up is owed one at once, and
		// the dialog opens that step off `availableInvocations` when they pick it.
		let needsInvocation     = false;
		let availableInvocations = [];
		if (newLevel % 2 === 0) {
			const source = await this.invocationSource(playbookData, { learned: true });
			const list   = source ?? await this.lightbearerInvocations();
			const selected = new Set(actor.getFlag(STONETOP_SCOPE, "invocations.selected") ?? []);
			availableInvocations = (list?.options ?? []).filter(o => !selected.has(o.slug));
			needsInvocation = !!source && availableInvocations.length > 0;
		}

		// A Beast-Bonded Ranger marks another companion action at 3rd, 5th, 7th and 9th level
		// (their background: "Mark 1 action at 1st level, then another at 3rd, 5th, 7th, and
		// 9th"). Whatever the new level allows beyond what's marked is owed now, so a character
		// who skipped one catches up here too.
		const markable = this._selectedBackground(playbookData)?.markableActions;
		let companionActions = null;
		if (markable?.options?.length) {
			const marked = new Set(this._background.markedActions);
			const options = markable.options.map(o => ({ slug: o.slug, label: o.label, marked: marked.has(o.slug) }));
			const owed = allowedMarkableActions(markable, newLevel) - options.filter(o => o.marked).length;
			const open = options.filter(o => !o.marked).length;
			const allowance = Math.min(owed, open);
			if (allowance > 0) companionActions = { label: markable.label ?? "", allowance, options };
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
			companionActions,
			// Current stat values, so the stat-increase picker can grey out any stat
			// already at the chosen move's cap (+2 / +3).
			stats: Object.entries(_STAT_DEFS).map(([key, { name, abbr }]) => ({
				key, name, abbr, value: actor.system?.stats?.[key]?.value ?? 0,
			})),
			// All current move marks, so the dialog's mark step can show what's already
			// spent on a budgeted move (Veteran Crew / Well Versed / …) and compute the
			// remaining picks for this take.
			marks: this._moveResources.getMarks(),
			// The box each background answer fills (the Patriot's Things Below on Well Versed): shown
			// in the mark step as the Background's, never pickable (backgroundMarkOptions).
			backgroundMarks: await this.backgroundMarkOptions(playbookData),
			// What a capped mark option is weighed against, so the mark step greys an option that
			// would buy nothing (the crew's die already at d10): see _markCapState.
			markCapState: this._markCapState(await this._crewStatsFor(playbookData, ownedAllByName)),
		};
	}

	// Cross-playbook foreign-move pickers (Versatile/Worldly/Dabbler/Wild Soul/Initiate of
	// the Secret Arts/Seasoned Warrior/Arts of War) let the player learn a move from another
	// playbook "for which they otherwise qualify". Given the picked move's `crossPlaybook`
	// config + the level being gained, returns the qualifying foreign moves
	// ({compendiumId, name, description, playbook}), EXCLUDING: Improved/Superior Stat
	// (cap != null), other cross-playbook moves (no third-playbook chaining), moves
	// already owned (a repeatable one held fewer times than its repeatMax excepted), playbook-locked moves (Dangerous, Potential for Greatness; see
	// _foreignMoveQualifies), and a move the character's OWN playbook has by the same name.
	// Level, required-move and stat prereqs are honored.
	async getForeignMovesForLevelUp(crossPlaybook, level) {
		const ownName = (await this.playbook())?.name ?? this._actor.system?.playbook?.name ?? null;
		const allowed = crossPlaybook?.playbooks === "any"
			? _ALL_PLAYBOOK_NAMES.filter(p => p !== ownName)
			: (crossPlaybook?.playbooks ?? []).filter(p => p !== ownName);
		// The copies held of each move, by name. A move held is not offered again unless it repeats
		// ("each time you take this move") and fewer copies than it allows are held: Magnificent
		// Specimen or Beast of Legend taken twice through Wild Soul or Versatile.
		const held = this._buildOwnedMovesMap();
		// What a requirement may lean on: only moves still LEARNED. A switched-off move stays
		// "owned" (never offered twice) but opens nothing.
		const learnedNames = new Set(this._actor.items.filter(i => i.type === "move" && moveLearnedIn(i, this._actor.items)).map(i => i.name));
		const retired    = this._retiredMoveNames();
		const actorStats = _statValueMap(this._actor.system?.stats);
		const out = [], seen = new Set();
		// Fetch every allowed playbook's moves concurrently — the reads are independent
		// compendium lookups, so awaiting them one at a time just stacks latency (up to
		// ~8 playbooks for an "any" cross-playbook move).
		const [ownDefs, movesPerPlaybook] = await Promise.all([
			ownName ? this._moveRepo.getPlaybookMoves(ownName) : [],
			Promise.all(allowed.map(pb => this._moveRepo.getPlaybookMoves(pb))),
		]);
		// Armored is the Heavy's, the Judge's and the Marshal's. A move the character's own
		// playbook has is an ordinary pick there, never a foreign one: a Heavy who started with
		// Uncanny Reflexes and took the Marshal's Armored through Seasoned Warrior had it swallowed
		// by their own Armored row, counted against the level's picks and without its "Granted by".
		const ownMoveNames = new Set((ownDefs ?? []).map(d => d.name));
		for (let i = 0; i < allowed.length; i++) {
			const pb = allowed[i];
			for (const def of movesPerPlaybook[i]) {
				if (def.cap != null) continue;          // no Improved/Superior Stat
				if (def.crossPlaybook) continue;         // no third-playbook chaining
				if (ownMoveNames.has(def.name)) continue; // the own playbook's move of that name
				const ownedIds = (held.get(def.name) ?? []).map(i => i.id);
				if (ownedIds.length >= Math.max(1, Number(def.repeatMax) || 1)) continue;
				if (retired.has(def.name) || seen.has(def.name)) continue;
				if (!_foreignMoveQualifies(def, learnedNames, level, actorStats)) continue;
				seen.add(def.name);
				// The mark options ride along with the copies already held, so the level-up's marks step
				// can ask a foreign Beast of Legend's pick as it asks the Ranger's own (LevelUpDialog).
				out.push({
					compendiumId: def.id, name: def.name, description: def.description ?? "", moveResults: def.moveResults ?? null, playbook: pb,
					requiresLabel: requirementLabel(def.requirement, { replaces: def.replaces ?? null }),
					markOptions: def.markOptions ?? null, markBudget: def.markBudget ?? null, ownedIds,
				});
			}
		}
		out.sort((a, b) => a.playbook.localeCompare(b.playbook) || a.name.localeCompare(b.name));
		// A move that costs Stock, offered to someone with no sacred pouch to pay it from, says
		// so on its row (`stockNote`). Said, never filtered: the book lets them take it. Not for a
		// pick that brings its own pouch in the same step (Initiate of the Secret Arts).
		const hasPouch = crossPlaybook?.grantsPossession === SACRED_POUCH_SLUG
			|| await this.holdsPossession(SACRED_POUCH_SLUG);
		for (const m of out) m.stockNote = !hasPouch && stockCostFromDescription(m.description) ? NO_POUCH_STOCK_NOTE : null;
		return out;
	}

	// `choices` carries any decision the picked move demands at acquisition. Today that
	// is `{ stat, cap }` for the stat-increase moves (Improved/Superior Stat); the dialog
	// collects it, this commits it. The move is added first so the choice can key off the
	// new item's id, then the choice is applied — a mid-flow failure leaves the move owned
	// (its choice re-collectable from the card) rather than a half-applied stat bump.
	//
	// Returns `{ applied: true }`, or `{ applied: false, reason }` when nothing was written:
	// `"level"` — the character is no longer at `fromLevel`, the level the caller's choices
	// were built for (the same level-up already applied from another window); `"xp"` — they
	// no longer have the 6 + 2×level XP it costs (Book I p.528: the move needs that much).
	async applyLevelUp(selectedMoveCompendiumId, selectedInvocationSlug, choices = null, { fromLevel = null, moveName = "" } = {}) {
		// Through the XP lock (utils/xp.js), not adjustXp: the level and the XP it cost move in
		// ONE update, and splitting them would leave a moment where the character has the new
		// level and has not paid for it. Both are therefore read inside the lock, so a mark that
		// landed while the level-up dialog was open is spent from rather than overwritten, and
		// the checks below see the values the write replaces.
		//
		// Only the write is held: the move additions below reach into compendia, and keeping
		// every other XP change on this client waiting on a pack read would trade one rare bug
		// for a common stall.
		const refused = await withXpLock(this._actor, async () => {
			const level = this._actor.system?.attributes?.level?.value ?? 1;
			const xp    = this._actor.system?.attributes?.xp?.value ?? 0;
			if (fromLevel != null && level !== fromLevel) return "level";
			if (xp < xpToLevelUp(level)) return "xp";
			const levelUp = {
				"system.attributes.level.value": level + 1,
				"system.attributes.xp.value":   xp - xpToLevelUp(level),
			};
			// The move learned rides on the update so the timeline's level-up row can name it
			// (timeline/timeline-watch.js reads it back off the options), and the ledger names the
			// move that spent the XP, as every other automated write does (`stonetopMove`).
			await this._actor.update(levelUp, { stonetopMove: "Level Up", ...(moveName ? { [LEARNED_OPTION]: moveName } : {}) });
			return null;
		});
		if (refused) return { applied: false, reason: refused };
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
		// The Beast-Bonded Ranger's companion actions for the level just reached.
		if (choices?.companionActions?.length) {
			await this._background.setMarkedActions(new Set([...this._background.markedActions, ...choices.companionActions]));
		}
		// Once only: an Invocation already known (a replayed step, a stale dialog) is not learned twice.
		if (selectedInvocationSlug) {
			const current = this._actor.getFlag(STONETOP_SCOPE, "invocations.selected") ?? [];
			if (!current.includes(selectedInvocationSlug)) {
				await this._actor.setFlag(STONETOP_SCOPE, "invocations.selected", [...current, selectedInvocationSlug]);
			}
		}
		return { applied: true };
	}

	// Record an Improved/Superior Stat pick: bump the stat by +1, clamped to the move's cap
	// (+2 / +3), and remember which stat this move instance raised (keyed by the item's id, so
	// a repeatable Improved Stat's instances stay distinct and the "+1 STR" chip renders on the
	// right card). Tagged with the move name so the ledger reads "via …".
	//
	// Recorded ONLY when the stat actually rose: removing the move steps the recorded stat back
	// down (_revertStatIncreaseChoice), so a pick recorded at the cap (the stat reached it while
	// the picker was open) would cost a point it never gave. Such a pick says so and leaves the
	// move without a stat, which the card's "needs your input" cue then asks for again; a stale
	// record for this instance (an onboarding re-run) goes too. Returns whether the stat rose.
	async _applyStatIncreaseChoice(moveItem, statKey, cap) {
		if (!_STAT_DEFS[statKey]) return false;
		const current = this._actor.system?.stats?.[statKey]?.value ?? 0;
		const next    = cap != null ? Math.min(current + 1, cap) : current + 1;
		if (next <= current) {
			if ((this._actor.getFlag(STONETOP_SCOPE, "improvedStatChoices") ?? {})[moveItem.id]) {
				await this._actor.update(Object.fromEntries(
					[deletionEntry(`flags.${STONETOP_SCOPE}.improvedStatChoices.${moveItem.id}`)]));
			}
			ui.notifications?.warn?.(game.i18n.format("stonetop.character.moves.statIncreaseAtCap",
				{ move: moveItem.name, stat: _STAT_DEFS[statKey].name, cap }));
			return false;
		}
		await this._actor.update({ [`system.stats.${statKey}.value`]: next }, { stonetopMove: moveItem.name });
		const choices = { ...(this._actor.getFlag(STONETOP_SCOPE, "improvedStatChoices") ?? {}), [moveItem.id]: statKey };
		await this._actor.setFlag(STONETOP_SCOPE, "improvedStatChoices", choices);
		return true;
	}

	// Apply (or re-apply) the "+1 to which stat?" pick for a stat-increase move taken at
	// creation, resolving the OWNED instance rather than relying on addMove's return. On an
	// onboarding re-run the move is already owned (addMove returns null) and the base-stat
	// write has just reset the stat, so without this the +1 is silently dropped. Idempotent:
	// base was reset first and the +1 is capped, so it lands exactly once per finalize.
	//
	// On the free pick's own copy (_creationPickCopy, stamped by then), not merely the first of the
	// name: a Would-be Hero holding a level-up Improved Stat beside the free one keeps that one's
	// pick, which restoreEarnedStatBonuses puts back.
	async applyCreationStatChoice(compendiumId, statKey) {
		if (!statKey) return;
		const doc = await this._moveRepo.getPlaybookMoveDocument(compendiumId);
		if (!doc) return;
		const owned = this._creationPickCopy(doc.name);
		if (!owned || owned.system?.cap == null) return;
		await this._applyStatIncreaseChoice(owned, statKey, owned.system.cap);
	}

	/**
	 * The +1s earned since creation, per stat: every Improved / Superior Stat pick recorded on a move
	 * still held that is NOT onboarding's free pick (applyCreationStatChoice puts that one back
	 * itself), and every filled stat slot of a marking move (Potential for Greatness). Each is worth
	 * exactly +1 (stat-rules.js).
	 * @returns {Record<string, number>}
	 */
	earnedStatBonuses() {
		const out = Object.fromEntries(Object.keys(_STAT_DEFS).map(key => [key, 0]));
		const held = new Map(this._actor.items.filter(i => i.type === "move").map(i => [i._id ?? i.id, i]));
		for (const [itemId, statKey] of Object.entries(resolvedFlags(this._actor).improvedStatChoices ?? {})) {
			const item = held.get(itemId);
			if (!(statKey in out) || !item || item.flags?.[STONETOP_SCOPE]?.[CREATION_PICK_FLAG]) continue;
			out[statKey] += 1;
		}
		for (const moveMarks of Object.values(this._moveResources.getMarks())) {
			for (const mark of filledMarks(moveMarks ?? {})) if (mark.stat in out) out[mark.stat] += 1;
		}
		return out;
	}

	/**
	 * A re-run of onboarding writes the base stats back (the sheet's _applyPlaybookSelections), which
	 * wipes every +1 earned since: a level-up's Improved Stat, a Potential for Greatness slot. Their
	 * records stay, so un-marking one later would take a point the stat no longer holds. Put them
	 * back on the stats that were written (`statKeys`), after the free pick's own +1 is applied, as
	 * the character earned them. Tagged with no move: nothing was newly earned.
	 * @param {Iterable<string>} statKeys
	 */
	async restoreEarnedStatBonuses(statKeys) {
		const earned = this.earnedStatBonuses();
		const update = {};
		for (const key of statKeys ?? []) {
			if (!earned[key]) continue;
			update[`system.stats.${key}.value`] = (this._actor.system?.stats?.[key]?.value ?? 0) + earned[key];
		}
		if (Object.keys(update).length) await this._actor.update(update);
	}

	// Inverse of _applyStatIncreaseChoice, run when an Improved/Superior Stat instance is
	// dropped from the sheet: forget this instance's recorded pick and step the chosen stat
	// back down by 1. A pick is recorded only when it raised the stat by exactly +1, so a
	// plain -1 is its exact inverse (floored at the -1 stat minimum). No-ops when this move
	// recorded no pick (any non-stat move, one added before the pick was collected, or one
	// whose pick found the stat already at the cap).
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
				// Invoke the Sun God taken off-playbook: its taker learns an Invocation at each even
				// level from here on (Level Up step 5), so the Invocations tab's "N of M" cue has to
				// know where "here" was (invocation-count.js). The EARLIEST grant stands: re-editing
				// a pick later must not shrink what was earned.
				if (foreign.name === INVOKE_THE_SUN_GOD
					&& this._actor.getFlag(STONETOP_SCOPE, INVOCATIONS_GRANTED_AT_FLAG) == null) {
					await this._actor.setFlag(STONETOP_SCOPE, INVOCATIONS_GRANTED_AT_FLAG, this._characterLevel);
				}
			}
		}
		if (grantsPossession && !this._possessions.selected.has(grantsPossession)) {
			await this.selectPossession(grantsPossession);
			// applyLevelUp has already raised the level, so this is the level being gained.
			await this._possessions.setGrantedAtLevel(grantsPossession, this._characterLevel);
		}
	}

	// Apply a level-up mark step's picks (the budgeted moves — Veteran Crew / Heroes to the
	// Last / Beast of Legend / Well Versed) to the move's mark store via setCountMark
	// (budget-clamped, level-stamped; hp/armor/crew/companion effects are derived on render,
	// so we never apply them here). Writes flags.stonetop-pwd.moves.moveMarks keyed by move
	// NAME, the same surface the sheet's own checkboxes use.
	async _applyMarkChoices(moveName, picks) {
		for (const pick of picks) {
			const current = markEntries(this._moveResources.getMarks()[moveName]?.[pick.slug]).length;
			await this.setCountMark(moveName, pick.slug, current + 1);
		}
	}

	// Each move an owned move replaces, to the move that replaced it (Bulwark -> A Mighty
	// Rampart, while the Rampart is owned). The original was given up for its replacement, so
	// it is not offered again: the level-up list and the cross-playbook picker leave it out,
	// the Moves tab locks it as "Replaced by ..." (buildMovelistContext), and onboarding's free
	// picks skip it (the sheet hands this to CharacterOnboardingDialog).
	retiredMoveReplacers() {
		const out = new Map();
		for (const i of (this._actor.items ?? []).filter(i => i.type === "move" && i.system?.replaces)) {
			if (!out.has(i.system.replaces)) out.set(i.system.replaces, i.name);
		}
		return out;
	}

	// The names alone, for the pickers that only leave them out.
	_retiredMoveNames() {
		return new Set(this.retiredMoveReplacers().keys());
	}

	// How many playbook picks were given up to a replacing move, for the level move budget.
	// A replacement that came through a cross-playbook pick is skipped: it and the move it
	// retired both sit in Learned Moves, which the budget never counted.
	_retiredPickCount() {
		return this._actor.items.filter(i => i.type === "move"
			&& i.flags?.[STONETOP_SCOPE]?.retiredMove
			&& !i.flags?.[STONETOP_SCOPE]?.grantedBy).length;
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

// The playbook whose Invocations anyone with Invoke the Sun God learns from.
const LIGHTBEARER_SLUG = "the-lightbearer";
// The Marshal's Crew move, and the playbook whose insert every crew is drawn from (crewSource).
export const CREW_MOVE = "Crew";
export const MARSHAL_SLUG = "the-marshal";

// Whether a possession's choiceGroups leave anything to pick: any radio line, or a
// multi-select whose effective cap (maxSelect + move bonus) isn't zero.
function _hasEditableChoice(choiceGroups, moveCounts) {
	return (choiceGroups ?? []).some(cg => (cg.subgroups ?? []).some(sg =>
		!sg.multiSelect || effectiveSubgroupMax(sg, moveCounts) !== 0));
}

// How many even levels lie in [from, to], inclusive.
function _evenLevelsBetween(from, to) {
	if (to < from) return 0;
	return Math.floor(to / 2) - Math.floor((from - 1) / 2);
}

// The 9 playbooks by display name (as stored in a move's system.playbook), for the
// Versatile "any other playbook" cross-playbook pick.
const _ALL_PLAYBOOK_NAMES = [
	"The Blessed", "The Fox", "The Heavy", "The Judge", "The Lightbearer",
	"The Marshal", "The Ranger", "The Seeker", "The Would-Be Hero",
];

// A foreign move qualifies for a cross-playbook pick when the actor has its required
// moves LEARNED (`learnedNames`: a switched-off move opens nothing; the one it replaces
// counts too), meets its level, and meets any machine-checkable
// stat minimum (Musclebound's STR +2 — gated here just as it is on its home playbook, so
// crossing playbooks can't dodge the prereq); a null requirement always qualifies.
//
// A move that names a playbook in its requirement never qualifies. Book I p.528: "A move
// that requires a specific playbook is never available to other playbooks. No one but the
// Heavy can take Dangerous, and no one but the Would-be Hero can have Potential for
// Greatness." Every move offered here comes from another playbook, and the cross-playbook
// moves are what grant the access, so the playbook tag marks exactly the moves that access
// does not reach.
//
// NOTE: a freeform `requirement.note` (e.g. "Sheriff background") is still NOT
// machine-checked (it can't be without a per-note rule engine), so such a move stays
// pickable; the note is surfaced in the picker for the player to self-police, exactly as the
// sheet shows note-only prerequisites on owned moves. A requirement of marks (`req.marks`) is
// never met here: the only one is Superior Stat's, which no pick offers (cap != null).
function _foreignMoveQualifies(def, learnedNames, level, actorStats = {}) {
	const req = def.requirement ?? {};
	if (req.playbook || req.marks) return false;
	if (req.level && level < req.level) return false;
	if (requiredMovesUnmet({ ...req, moves: effectiveRequiredMoves(req, def.replaces) }, m => learnedNames.has(m))) return false;
	return !statRequirementsUnmet(req.stats, actorStats);
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

// With Walk It Off's box last when the character has it listed (walk-it-off.js), touching no stat,
// so Convalesce and Make Camp clear it with the debilities.
function _buildDebilitiesSection(actor, moveResources) {
	const opts = actor.system?.attributes?.debilities?.options ?? {};
	const walkItOff = walkItOffChoice(actor, moveResources);
	const rows = [
		..._DEBILITY_DEFS.map(({ key, name, stats }) => ({ key, name, active: !!(opts[key]?.value), stats })),
		...(walkItOff ? [{ key: walkItOff.key, name: walkItOff.name, active: walkItOff.marked, stats: [] }] : []),
	];
	return rows.map(({ key, name, active, stats }) =>
		new DebilitySnapshotBuilder()
			.withKey(key)
			.withName(name)
			.withActive(active)
			.withStats(stats)
			.build()
	);
}

// The wound record's one reading (normalizeWound / normalizeWoundList) lives in wound-record.js,
// shared with the ledger and the roll card.
function _buildWoundsSection(actor) {
	return normalizeWoundList(actor.system?.attributes?.wounds).map(n => {
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
 * Stated here alone because its callers need the same answer at very different prices: the vitals
 * section building a whole sheet, `computedVitals` feeding the stored mirror, and `computedDamageDie`
 * answering a single damage roll. A second copy is how the roller and the sheet come to disagree
 * about what die a character rolls.
 *
 * Does NOT consider the hand-typed override: that WINS over this, and the callers apply it at
 * their own layer (the field is what the sheet renders, and it is checked first by the accessor).
 */
function _derivedDamageDie(playbookData, moveBonuses = {}) {
	if (!playbookData) return null;
	return moveBonuses.damageDie ? maxDie(playbookData.damage, moveBonuses.damageDie) : playbookData.damage;
}

/**
 * What lowered a character's max HP, for the ledger, or null when it is not knowable here. A
 * post-death insert's marked options are the one source this can name: a Thrall's "Reduce your max
 * HP by 2" Mark. Named only when the penalty GREW since the last max was written (`before`, the
 * MIRRORED_HP_PENALTY_FLAG, absent for 0): a Mark taken long ago did not cause today's fall.
 */
function maxHpFallCause(character, before, now) {
	const slug = character?._postDeath?.activeSlug;
	if (!slug) return null;
	return now > (Number(before) || 0) ? `the ${capitalizeFirst(slug)}'s Marks` : null;
}

/**
 * Max HP from the playbook, move bonuses, an insert's Marks and the hand-set delta, `{hpBase, hpMax}`:
 * the one arithmetic behind the sheet's vitals and StonetopCharacter#computedVitals.
 */
function _hpFrom(actor, playbookData, moveBonuses = {}, insertHpPenalty = 0) {
	const attrs = actor.system?.attributes ?? {};
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
	return { hpBase, hpMax };
}

function _buildVitalsSection(actor, playbookData, armorValue, moveBonuses = {}, wornArmorBase = 0, insertHpPenalty = 0, unpierceableArmor = 0, armorBase = null, gatedArmor = { value: 0, source: "" }) {
	const attrs = actor.system?.attributes ?? {};
	const level = attrs.level?.value ?? 1;
	const { hpBase, hpMax } = _hpFrom(actor, playbookData, moveBonuses, insertHpPenalty);
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
		// Defaulted to the total for a caller that hands over no derived number of its own: with
		// no adjustment in play the two ARE the same, which is every character but the handful
		// carrying a hand-set one.
		.withArmorBase(armorBase ?? armorValue)
		.withWornArmor(wornArmorBase)
		.withUnpierceableArmor(unpierceableArmor)
		.withConditionalArmor(gatedArmor?.value ?? 0, gatedArmor?.source ?? "")
		.withLevel(level)
		.withXp(new ValueMax(attrs.xp?.value ?? 0, xpToLevelUp(level)))
		.build();
}

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
// each time you take this move" — i.e. 2 extra companion trait picks per owned copy, counted
// only while LEARNED (an un-learned move grants nothing) and only for the BOOK's move (a
// player's own move of that name is not it, as _ownsLearnedBookCopy says).
function _buildCompanionBonuses(moveBonuses, ownedAllByName, items) {
	const specimens = _learnedBookSpecimens(ownedAllByName, items);
	return {
		hp:         moveBonuses.companionHp    ?? 0,
		armor:      moveBonuses.companionArmor ?? 0,
		traitPicks: COMPANION_TRAIT_PICKS_PER_SPECIMEN * specimens,
	};
}

// How many LEARNED book copies of Magnificent Specimen `ownedAllByName` holds, read against the
// actor's `items` (a copy a switched-off cross move granted is off with it).
function _learnedBookSpecimens(ownedAllByName, items) {
	return (ownedAllByName.get?.(MAGNIFICENT_SPECIMEN_MOVE) ?? []).filter(i => !_isCustomMove(i) && moveLearnedIn(i, items)).length;
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

// The item flag onboarding stamps on a move taken as its free pick ("1 of your choice"), so a
// re-run can tell that pick from a level-up's. See StonetopCharacter#creationPickItems.
export const CREATION_PICK_FLAG = "creationPick";

// The item flag a replacing move carries when the move it retired was onboarding's free pick. See
// StonetopCharacter#retiredCreationPickCount.
export const RETIRED_CREATION_PICK_FLAG = "retiredCreationPick";

// The item flag onboarding stamps on the "either X OR Y" option it granted, the one the character
// STARTED with, so the other half taken later reads as an ordinary pick. See
// StonetopCharacter#startingChoiceItems.
export const STARTING_CHOICE_FLAG = "startingChoice";

// A background's move the character ALSO holds some other way, which a change of background
// must leave where it is: a starting move (an "either X OR Y" pick included, which carries
// isStartingMove too), onboarding's free pick (a Vessel who took Trackless Step, then became
// Raised by Wolves and back), or a move learned through a cross-playbook move. A level-up pick
// carries no such mark (nor does a free pick made before the stamp existed), so one that a later
// background also gives is taken back when that background is left. That needs a pick of the
// very move the next background grants, and ticking it again on the Moves tab restores it. A
// pick a background came to give when it was already held (HELD_BEFORE_BACKGROUND_FLAG) is marked.
function _heldBesidesBackground(item) {
	const flags = item.flags?.[STONETOP_SCOPE];
	return !!(item.system?.isStartingMove || flags?.[CREATION_PICK_FLAG] || flags?.grantedBy || flags?.[HELD_BEFORE_BACKGROUND_FLAG]);
}

// The item flag ensureStartingMoves stamps on a copy the character already held when a change of
// background started giving that move and had no room for a copy of its own (a level-3 Wide
// Wanderer's level-up Stalker on becoming a Mighty Hunter). The copy stays the character's pick:
// counted in the level's budget (buildMovelistContext) and never taken back by a later change of
// background (backgroundMovesDropped, through _heldBesidesBackground).
export const HELD_BEFORE_BACKGROUND_FLAG = "heldBeforeBackground";

function _isHeldBeforeBackground(item) {
	return !!item?.flags?.[STONETOP_SCOPE]?.[HELD_BEFORE_BACKGROUND_FLAG];
}

// The item flag ensureStartingMoves stamps on the copy of a move a background GAVE (its value is
// the background's slug), so a repeatable one (the Scion's Veteran Crew, repeatMax 2) can be told
// from a copy taken at a level-up: a change of background takes back only the stamped copy, and a
// new background gives its own copy beside one the character already picked.
export const BACKGROUND_GRANT_FLAG = "backgroundGrant";

function _isBackgroundGrant(item) {
	return !!item?.flags?.[STONETOP_SCOPE]?.[BACKGROUND_GRANT_FLAG];
}

// Owned items in the order they were gained: Foundry's createdTime, with the collection's own
// order (also creation order) deciding a tie or an item that has none.
function _earliestFirst(items) {
	const created = i => i._stats?.createdTime ?? Infinity;
	return items.map((item, index) => ({ item, index }))
		.sort((a, b) => (created(a.item) - created(b.item)) || (a.index - b.index))
		.map(({ item }) => item);
}

// The special possessions a background hands over on top of the playbook's picks: its fixed
// `extraPossessions` (the Judge's Missionary: "an aviary in addition to your usual choice") and
// any `apply: "possession"` setup pick (the Fox's A Life of Crime: burglar's kit or hidden
// stash). The possessions version of backgroundMoveNames, and for the same reason: a gift must
// not also be taken as a pick, or the pick is silently lost.
export function backgroundPossessionSlugs(background, setupChoices = {}) {
	const slugs = new Set(background?.extraPossessions ?? []);
	for (const choice of (background?.setup?.choices ?? [])) {
		if (choice.apply !== "possession" || !choice.key) continue;
		const chosen = setupChoices?.[choice.key];
		if (chosen) slugs.add(chosen);
	}
	return slugs;
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

// A background's marked actions told apart for a re-run of onboarding, which asks only the 1st
// level's marks: `starting`, the first as many as 1st level allows, and `later`, the rest, marked at
// a level-up (or on the Details tab past 1st level) and kept, shown locked. Onboarding writes its
// marks first and a later mark is only ever appended (CharacterBackgrounds#markAction, applyLevelUp),
// so the list's order is the order they were marked. With no markable list, all are `starting`.
export function splitMarkedActions(markable, marked) {
	const list = [...new Set((Array.isArray(marked) ? marked : []).filter(Boolean))];
	if (!markable?.options?.length) return { starting: list, later: [] };
	const known = new Set(markable.options.map(o => o.slug));
	const own = list.filter(slug => known.has(slug));
	const first = allowedMarkableActions(markable, 1);
	return { starting: own.slice(0, first), later: own.slice(first) };
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
		// "Choose 2 or 3": a full list disables what is left unticked, as a possession's choices do at
		// their cap, and a short one is flagged rather than refused (initiates.js#choiceCountState).
		const countState = b.choices
			? choiceCountState(b.choices.count, b.choices.options.filter(o => savedChoices?.[o.slug]).length)
			: null;
		const choices = b.choices ? new BackgroundChoicesSnapshotBuilder()
			.withLabel(b.choices.label)
			.withCount(b.choices.count)
			.withCountLabel(b.choices.count.join(" or "))
			.withOptions(b.choices.options.map(o => {
				const checked = !!(savedChoices?.[o.slug]);
				return new BackgroundChoiceOptionSnapshot(o.slug, o.label, checked, !checked && countState.atMax);
			}))
			.withSaved(savedChoices)
			.withCountState(countState.checked, countState.underMin)
			.withInline(!!b.choices.inline)
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
					// The moves that empty it (background-tracks.js): Auspicious Birth's circle.
					clearsOn: Array.isArray(r.clearsOn) ? [...r.clearsOn] : [],
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


// Add the bonuses of a move's checked mark options (`moveMarks`, the move's entry in
// moves.moveMarks) into `totals` (see StonetopCharacter#_ownedMoveBonuses). One writer for a
// move of the character's own playbook, read off its definition, and a foreign one, read off
// its embedded copy, so the two can't count an option differently.
function _addMarkOptionBonuses(totals, markOptions, moveMarks = {}) {
	for (const opt of (markOptions ?? [])) {
		// Stat-choice marks (e.g. Potential for Greatness) store an array of chosen stats and
		// are applied directly to the stored stats on change, not derived here: multiplying by
		// the array would yield NaN.
		if (opt.choice === "stat") continue;
		const count = markEntries(moveMarks?.[opt.slug]).length;
		if (!count) continue;
		totals.hp     += (opt.hp     || 0) * count;
		totals.armor  += (opt.armor  || 0) * count;
		totals.crewHp += (opt.crewHp || 0) * count;
		if (opt.damageDie) totals.damageDie = maxDie(totals.damageDie, opt.damageDie);
		totals.crewDamageSteps += (opt.crewDamageStep || 0) * count;
		if (opt.crewDamageCap) totals.crewDamageCap = opt.crewDamageCap;
		totals.crewRollSteps += (opt.crewRoll || 0) * count;
		// Veteran Crew's "Select 2 new tags" raises how many tags the player may pick for the
		// Crew (the followers-tab tag picker reads this as tagBonus).
		totals.crewTags += (opt.crewTags || 0) * count;
		// Beast of Legend's "+4 HP and +1 armor" buffs the Animal Companion (the followers-tab
		// companion card reads these as companionBonuses).
		totals.companionHp    += (opt.companionHp    || 0) * count;
		totals.companionArmor += (opt.companionArmor || 0) * count;
	}
}

// Total checked marks across a move's budgeted (non-stat) options, optionally skipping
// one slug. Drives both the render-side "used" badge and the writer-side "others
// already spent" clamp, so they always count picks the same way.
function _sumMarkPicks(moveMarks, markOptions, skipSlug = null) {
	let n = 0;
	for (const opt of markOptions) {
		if (opt.choice === "stat" || opt.slug === skipSlug) continue;
		n += markEntries(moveMarks[opt.slug]).length;
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
//
// `capState` (StonetopCharacter#_markCapState) greys out the unchecked boxes of an option that would
// buy nothing, its target already at the option's cap (move-mark-budget.js#markOptionCapNote); the
// option carries the reason as `capNote` for a tooltip. A checked box stays editable, as under the
// budget lock, so a pick can still be taken back.
//
// `backgroundSlug` is the option the background fills (StonetopCharacter#backgroundMarkOptions: the
// Patriot's Things Below on Well Versed). On an owned move its first box shows ticked and locked,
// labelled "Background", and is not stored, so it sits outside the budget; the option's own boxes
// are what is left. A mark stored on it anyway (an old character's) stays, editable, and is flagged
// with `duplicateNote`: never taken away.
//
// `actorStats` (key to value) and `actorLevel` are the character's. A stat slot's picker offers only
// the stats still below the move's cap (stat-rules.js#MARK_STAT_CAPS: Potential for Greatness's
// "to a max of +2"), as the Improved Stat picker does, and always the slot's own pick. A move taken
// "Once per level" (pfg-marks.js#ONCE_PER_LEVEL_MARKS) flags, never blocks, a mark noted at the same
// level as another or above the current level: `levelCaution` on the slot or box, the sentence for
// its tooltip.
function _buildMarkOptions(entry, markCounts, capState = {}, backgroundSlug = null, { actorStats = {}, actorLevel = null } = {}) {
	if (!entry.markOptions?.length) return { options: null, budget: null };
	const statList = Object.entries(_STAT_DEFS).map(([key, { abbr }]) => ({ key, abbr }));
	const statCap  = MARK_STAT_CAPS[entry.name] ?? null;
	const cautions = ONCE_PER_LEVEL_MARKS.has(entry.name)
		? oncePerLevelCautions(markCounts, entry.markOptions, actorLevel)
		: new Map();
	const levelCaution = (slug, index) => {
		const why = cautions.get(`${slug}:${index}`);
		if (!why) return null;
		return why === "ahead"
			? format("stonetop.character.moves.markLevelAhead", { level: actorLevel })
			: _loc("stonetop.character.moves.markLevelShared");
	};

	// Total checked across budgeted (non-stat) options — the spent picks.
	const ownedCount = entry.ownedIds?.length ?? (entry.owned ? 1 : 0);
	const max = moveMarkBudget(entry.markBudget, ownedCount);
	const used = max != null ? _sumMarkPicks(markCounts, entry.markOptions) : 0;
	const atBudget = max != null && used >= max;

	const options = entry.markOptions.map(opt => {
		const entries = markEntries(markCounts[opt.slug]);
		const marks = opt.marks ?? 1;
		if (opt.choice === "stat") {
			const statSlots = Array.from({ length: marks }, (_, i) => {
				const sel = entries[i]?.stat ?? "";
				// A stat already at the cap would buy nothing; the slot's own pick stays, so it shows.
				const offered = statList.filter(s => s.key === sel || statCap == null || (actorStats[s.key] ?? 0) < statCap);
				return {
					index: i,
					level: entries[i]?.level ?? null,
					levelCaution: sel ? levelCaution(opt.slug, i) : null,
					options: [{ key: "", abbr: "—", selected: sel === "" },
						...offered.map(s => ({ key: s.key, abbr: s.abbr, selected: sel === s.key }))],
				};
			});
			return { slug: opt.slug, label: opt.label, choice: "stat", statSlots };
		}
		const count = entries.length;
		const capNote = markOptionCapNote(opt, capState);
		const fromBackground = !!entry.owned && !!backgroundSlug && opt.slug === backgroundSlug;
		// The option's own boxes: the background's box is not one of them, but a mark stored on
		// top of it still shows, so it can be seen and unticked.
		const ownBoxes = fromBackground ? Math.max(marks - 1, count) : marks;
		return {
			slug:   opt.slug,
			label:  opt.label,
			// Only while a box is still there to tick: a fully marked option has nothing to grey.
			capNote: capNote && count < ownBoxes ? capNote : null,
			background: fromBackground
				? { label: _loc("stonetop.character.moves.backgroundMark"), tooltip: _loc("stonetop.character.moves.backgroundMarkTooltip") }
				: null,
			duplicateNote: fromBackground && count > marks - 1 ? _loc("stonetop.character.moves.backgroundMarkDuplicate") : null,
			checks: Array.from({ length: ownBoxes }, (_, i) => ({
				index: i,
				checked: i < count,
				level: entries[i]?.level ?? null,
				levelCaution: i < count ? levelCaution(opt.slug, i) : null,
				// Lock an UNchecked box once the budget is spent — checked boxes always
				// stay editable so the player can free up a pick (and any grandfathered
				// over-budget mark from before the cap existed is never force-cleared).
				// Likewise once what the option raises is already at its cap.
				disabled: (atBudget || !!capNote) && !(i < count),
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

/**
 * A LEARNED move's prerequisites, as `{ requiresLabel, requirementsUnmet }`, through PlaybookMoveEntry
 * so the label and the checks (required moves, any-of moves, level, stats, "replaces") are the very
 * ones a playbook move's card gets. Owned, and never a starting move, so an unmet one reads as the
 * same "requirement not met" warning. The requirement's playbook is dropped first: a learned move is
 * from another playbook by definition.
 */
function _learnedMoveRequirement(item, ownedAllByName, actorLevel, actorStats, filledMarks = null) {
	const { playbook: _foreign, ...requirement } = item.system?.requirement ?? {};
	const entry = new PlaybookMoveEntry(
		{ name: item.name, isStarting: false, requirement, replaces: item.system?.replaces || null },
		[item], new Set(), ownedAllByName, actorLevel, null, actorStats, null, null, filledMarks);
	return { requiresLabel: entry.requiresLabel, requirementsUnmet: entry.requirementsUnmet };
}

// `backgroundChoices` (move name → the background's moveChoices entry) marks a card whose background
// answer is the player's to pick and still empty (`backgroundAnswerNeeded`, the card's cue).
function _buildMoveEntry(entry, source, moveResourcesMap, bgSlugs = new Set(), moveBackgroundAnswers = {}, improvedStatChoices = {}, moveMarksMap = {}, actorStats = {}, capState = {}, backgroundChoices = new Map(), actorLevel = null, subtitles = {}) {
	const resourceDef = entry.resource;
	const resource = resourceDef ? new ResourceBuilder()
		.withCurrent(moveResourcesMap[entry.name] ?? 0)
		.withMax(resourceDef.max)
		.withTitle(resourceDef.title ?? null)
		.withLabels(resourceDef.labels ?? [])
		// Silver Tongued's Nerve: "Spend 1 to:" and its menu, off the same ResourceDef an Other
		// move's track reads (see _buildOtherMoveResource).
		.withSpendTooltip(new ResourceDef(resourceDef).spendTooltip)
		.build() : null;
	const repeat = entry.repeatable
		? { max: entry.repeatChecks.length, current: entry.ownedIds.length }
		: null;
	const requirement = entry.requiresLabel
		? new RequirementSnapshot(entry.requiresLabel, !entry.locked)
		: null;
	const sourceLabel = entry.isStarting ? (bgSlugs.has(slugify(entry.name)) ? "Background" : "Starting move") : null;

	const backgroundAnswer = moveBackgroundAnswers[entry.name] ?? null;
	const { options: markOptions, budget: markBudget } = _buildMarkOptions(entry, moveMarksMap[entry.name] ?? {}, capState,
		backgroundMarkOption(entry.name, backgroundAnswer?.value), { actorStats, actorLevel });
	const backgroundChoice = backgroundChoices.get(entry.name);
	const backgroundAnswerNeeded = entry.owned && backgroundChoice?.options?.length && !backgroundAnswer?.value
		? {
			label: backgroundChoice.label ?? entry.name, options: [...backgroundChoice.options],
			tooltip: format("stonetop.character.moves.backgroundAnswerNeeded",
				{ label: backgroundChoice.label ?? entry.name, options: backgroundChoice.options.join(", ") }),
		}
		: null;

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
		.withSubtitle(entry.owned ? subtitles[entry.name] ?? null : null)
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
		.withReplacedBy(entry.replacedBy ?? null)
		.withResource(resource)
		.withRepeat(repeat)
		.withRepeatable(repeat !== null)
		.withBackgroundAnswer(backgroundAnswer)
		.withBackgroundAnswerNeeded(backgroundAnswerNeeded)
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
// `resources` (the move-name-keyed track counts) draws the item's own `system.resource` track; without
// it the card has none, which is how the "other" categories have always been drawn.
function _buildOwnedItemMoveSnapshot(item, { sourceType, isStarting, resources = null }) {
	const resourceDef = resources ? item.system?.resource ?? null : null;
	const resource = resourceDef?.max ? new ResourceBuilder()
		.withCurrent(Math.min(resourceDef.max, Math.max(0, Number(resources[item.name]) || 0)))
		.withMax(resourceDef.max)
		.withTitle(resourceDef.title ?? null)
		.withLabels(resourceDef.labels ?? [])
		.withSpendTooltip(new ResourceDef(resourceDef).spendTooltip)
		.build() : null;
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
		.withResource(resource)
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

function _buildMovelist(categories, other, pdiLabel = null, actorLevel = 1, loveLetters = [], playbookName = null, retiredPicks = 0) {
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
	// A starting or background move counts too once a copy BEYOND the one it came with is held:
	// a Scion whose free pick is the second Veteran Crew (the user's ruling) has made it.
	const chosenCount    = (playbookCat?.moves ?? []).reduce((n, m) => n + (m.sourceLabel === null
		? (m.owned ? 1 : 0)
		: Math.max(0, (m.ownedIds?.length ?? 0) - 1)), 0);
	const movesIncomplete = pickCount > 0 && chosenCount < pickCount;

	// Advancement budget: every level past 1 grants one move pick, on top of the
	// `pickCount` starting "moves of your choice". Count OWNED INSTANCES of every
	// non-starting playbook move so a repeatable retake (e.g. Improved Stat taken
	// twice) counts each take, and a cross-playbook pick (Versatile) counts once —
	// the foreign move it grants lives in the Learned category and is excluded.
	// Background / auto-granted starting moves are `isStarting` and never counted.
	// A replacing move (A Mighty Rampart) gave up an earlier pick (Bulwark) to be taken,
	// so each one it retired still counts: `retiredPicks`.
	// A repeatable starting move taken again (the Seeker's Well Versed) spent a pick on each take
	// past the first.
	const chosenInstances = (playbookCat?.moves ?? [])
		.reduce((n, m) => n + Math.max(0, (m.ownedIds?.length ?? 0) - (m.isStarting ? 1 : 0)), 0) + retiredPicks;
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
