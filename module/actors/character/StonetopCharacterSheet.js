import {MoveResourceButton} from "./elements/move-resource-button.js";
import {BackgroundInputChoice} from "./elements/background-input-choice.js";
import {PossessionUseButton} from "./elements/possession-use-button.js";
import {OutfitMoveDialog} from "./dialogs/OutfitMoveDialog.js";
import {RequisitionDialog} from "./dialogs/RequisitionDialog.js";
import {CustomMoveDialog, characterMoveSaver} from "./dialogs/CustomMoveDialog.js";
import {AddInventoryItemDialog, characterInventoryItemSaver} from "./dialogs/AddInventoryItemDialog.js";
import {LoveLetterDialog} from "../../dialogs/LoveLetterDialog.js";
import {LoveLetterReadDialog} from "../../dialogs/LoveLetterReadDialog.js";
import {LevelUpDialog} from "./dialogs/LevelUpDialog.js";
import {PossessionChoicesDialog} from "./dialogs/PossessionChoicesDialog.js";
import {DeathsDoorDialog} from "./dialogs/DeathsDoorDialog.js";
import {UndeathDialog} from "./dialogs/UndeathDialog.js";
import {buildPostDeathChoices, choiceWriteIns} from "./post-death-choices.js";
import {DEATHS_DOOR_STATE, PAST_DEATH_KINDS, POST_DEATH_INSERT_SLUGS, pastDeathClasses, pastDeathKind, resolvedHp, zeroHpMove} from "./deaths-door.js";
import {WoundDialog} from "./dialogs/WoundDialog.js";
import {WOUND_STATUS_GLYPH, WOUND_STATUS_LABEL} from "./wound-display.js";
import {PlaybookPickerDialog} from "./dialogs/PlaybookPickerDialog.js";
import {ANIMAL_COMPANION_TRAIT_GLOSSARY, CharacterOnboardingDialog} from "./dialogs/CharacterOnboardingDialog.js";
import {CreateFollowerDialog} from "./dialogs/CreateFollowerDialog.js";
import {MonsterToFollowerDialog} from "./dialogs/MonsterToFollowerDialog.js";
import {NpcToFollowerDialog} from "./dialogs/NpcToFollowerDialog.js";
import {OrderFollowersDialog} from "./dialogs/OrderFollowersDialog.js";
import {FollowerFateDialog} from "./dialogs/FollowerFateDialog.js";
import {CallUpDeepOnesDialog} from "./dialogs/CallUpDeepOnesDialog.js";
import {RING_SOURCE_UUID, SERVANT_SOURCE_UUID, buildServantFollower} from "../../data/servant-of-daagon.js";
import {grantedWeaponForMove, weaponTraitText} from "../../data/weapons.js";
import {grantedWeaponAttackFor} from "../../combat/attack-flow.js";
import {ALT_STAT_GRANTS} from "../../data/alt-stat-grants.js";
import {readOnboardingResume, writeOnboardingResume, clearOnboardingResume} from "./onboarding-resume.js";
import {trackCreationFlow} from "./creation-flow.js";
import {CharacterLedger} from "./CharacterLedger.js";
import {wireTabSearch} from "../../utils/tab-search.js";
import {createPacker, fitColumns, makeColumns, packShortest, wireMasonry} from "../../utils/masonry.js";
import {mountTabRail} from "../../utils/tab-rail.js";
import {buildPreferenceGroups} from "../../utils/sheet-preferences.js";
import {showsPreferencesTab, withPreferencesTab} from "../../utils/preferences-tab.js";
import {injectHeaderToggle} from "../../utils/sheet-chrome.js";
import {mountScrollFrost} from "../../utils/scroll-frost.js";
import {withSheetSizeMemory} from "../../utils/sheet-size.js";
import { crewExists, effectiveCrewSize, customGroupSize, crewAnonMemberLabel, crewIndividualLabel, CREW_SIZE_MAX } from "../../utils/crew.js";
import {resolvedFlags, resolvedFlagProperty, STONETOP_SCOPE, ITEM_FLAG_SCOPE} from "./StonetopFlags.js";
import {createArcanumItem} from "../../item/createArcanum.js";
import {rollStat, sign, classifyResult} from "../../utils/roll-engine.js";
import {defendReadinessHold} from "../../combat/defend-readiness.js";
import {dieFromDamage} from "../../utils/damage.js";
import {normalizeDamageDie} from "../../utils/damage-die.js";
import {normalizeRollType} from "../../utils/roll-types.js";
import {escHtml, isDefaultImg, normalizePlaybookGlyphs, composeInstinct} from "../../utils/strings.js";
import {playbookIconPath, partyCharacters} from "../../utils/playbook-actors.js";
import {postMoveToChat, moveChatCard, pickableMoveDescription} from "../../utils/chat.js";
import {moveBodyHtml, moveCardBody} from "../../utils/move-tiers.js";
import {statApproaches} from "../../utils/stat-approaches.js";
import {wirePickTally} from "../../utils/pick-tally.js";
import {stockSourcesForFlags, canPayStock, defaultStockSource, stockCostFromDescription, SACRED_POUCH_SLUG, RITES_OF_THE_LAND} from "./stock-cost.js";
import {supplyPursesFor, defaultSupplyPurse, spendSupplies, campUsesNeeded, SUPPLY_PURPOSE} from "./supply-cost.js";
import {rollProvisions, ON_THE_HOOF} from "./provisions.js";
import {buildMoveTierResults} from "../../utils/move-results.js";
import {knowThingsRollChoices, withAdvantage, KNOW_THINGS_STAT} from "./arcana-identify.js";
import {ARTIFACT_STATE, artifactStateForTier, knowThingsArtifactResults, seekInsightArtifactResults,
	ARTIFACT_INSIGHT_QUESTIONS, ARTIFACT_LEAD_SUGGESTIONS} from "./artifact-identify.js";
import {knowThingsRollOptions} from "./know-things.js";
import {getStonetopSteadingActor} from "../../utils/world.js";
import {openChroniclePageForActor} from "../../utils/chronicle.js";
import {getDragEventData, deletionEntry, enrichHTML, imagePopout, renderTemplate} from "../../utils/foundry-compat.js";
import {STEADING_DEFAULTS, StonetopSteading} from "../steading/StonetopSteading.js";
import {readCurrentSeason, readCurrentYear} from "../../seasons/current-season.js";
import {openRitesOfTheLand} from "./rites-of-the-land.js";
import {peopleNames, steadingPeopleActors, usedPersonPortraits, createPersonNpc, isActorRow, personRowActor, personRowKey, personRowIdentity, rebasePersonRows, addCharacterToSteadingPlayers} from "../steading/steading-people.js";
import {openPeoplePortraitPicker} from "../steading/PeopleGalleryDialog.js";
import {getHoverDescriptionSetting, getRollStatChipsSetting, getCrewSectionsOpen, setCrewSectionsOpen, getMovesSectionsCollapsed, setMovesSectionsCollapsed, getArcanaSectionsCollapsed, setArcanaSectionsCollapsed, getArcanaContentExpanded, setArcanaContentExpanded, getArcanaCardsCollapsed, setArcanaCardsCollapsed, getInventoryLoreExpanded, setInventoryLoreExpanded, getSidebarCollapsed, setSidebarCollapsed, getOpenSheetsInEditMode, getAskRollModeEachRollSetting, isClassicLayout, layoutClasses, stampLayoutClass} from "../../settings.js";
import {bringDialogToFront} from "../../utils/front-on-open.js";
import {wireSidebarToggle} from "../../utils/sidebar-toggle.js";
import {openLedgerDialog} from "../../utils/ledger-dialog.js";
import {promptRoll, rollDamagePrompted, UNPROMPTED_ROLL} from "../../dialogs/RollDialog.js";
import {withSectionEditing} from "../../utils/section-editing.js";
import {applyLabelTooltips} from "../../utils/label-tooltips.js";
import {annotateInvocationEffects, splitEmpoweredEffect} from "./invocation-effects.js";
import {CONSECRATED_FLAME, INVOKE_THE_SUN_GOD, EMPOWERED_INVOCATIONS, ownsMoveNamed, showHolyLight} from "./holy-light.js";
import {ownedMoveNames, ownedMove} from "./owns-move.js";
import {invocationLabel, invokeNotice, readOngoing, resolveInvocationUse} from "./ongoing-invocation.js";
import {showJudgeMarks, condemnedContext, CONDEMN, CENSURE} from "./condemn.js";
import {readyRulebookIcon, openSharedRulebook} from "../../books/rulebook-icons.js";

/**
 * The one book a PLAYER's sheet offers. Book I is the rules they play by; Book II is the
 * gazetteer, which is the GM's side of the screen and stays on the GM Toolkit.
 */
const PLAYER_BOOK = 1;
import {BINDING_ARBITRATION} from "./oaths.js";
import {CondemnedDialog} from "./dialogs/CondemnedDialog.js";
import {showBattleJoy, BATTLE_JOY} from "./battle-joy.js";
import {
	showBlessedMarks, BARKSKIN, TRACKLESS_STEP, SHARED_SOULS, AMULETS_TALISMANS, WARDS_BINDINGS,
} from "./blessed-marks.js";
import {BlessedMarksDialog} from "./dialogs/BlessedMarksDialog.js";
import {wrapGlyphTextContainers, wrapStonetopGlyphsInEl} from "../../utils/glyphs.js";
import {prepareMoveHoverBody} from "../../utils/move-hover.js";
import {StonetopAutocomplete} from "../../utils/autocomplete.js";
import {canAuthorCustomMoves, canCreateArcana} from "../../utils/authoring-gates.js";
import {enrichMoveRefsInEl, fetchMoveRef} from "../../utils/move-refs.js";
import {buildRelationshipRows, wireRelationshipTable, wireRelationshipLinks, relationshipDropResult, relationshipDropNotice, wireRelationshipDropHighlight} from "../../utils/relationship-hearts.js";
import {wireAvatarPreview, removeAvatarPreview} from "../../utils/avatar-preview.js";
import {relationshipViewContext, wireRelationshipBoard} from "../../utils/relationship-board.js";
import {BEAST_CATALOG, BEAST_ORDER} from "../../data/beasts.js";
import {parseFollowerArmor, buildCustomFollower, readinessCap, READINESS_SHIELD_BONUS, READINESS_SHIELD_WALL_BONUS, SHIELD_WALL_MOVE, outnumberBonus, nextFollowerOrder} from "../../data/follower-build.js";
import {arcanaSummonFollowers} from "../../data/arcana-summons.js";
import {joinNames} from "../../utils/strings.js";
import {availablePossessionFollowers} from "../../data/possession-followers.js";
import {FOLLOWER_MOVES} from "../../data/follower-moves.js";
import {FOLLOWER_DRAG_TYPE} from "../../data/follower-actor.js";
import {CREW_INDIVIDUAL_NAMES, CREW_INDIVIDUAL_TAGS, CREW_INDIVIDUAL_TRAITS} from "../../data/steading-members.js";
import {resolvePortrait, portraitActionLabel} from "../../utils/portrait-frame.js";
import {displayPortraitSrc} from "../../book2-art/people-portraits.js";
import {followerFrameHandle, rosterMemberFrameHandle, followerPortraitPickUpdate, followerPortraitClearUpdate} from "../../utils/portrait-frame-handles.js";
import {clearRosterPortrait, readRosterPortrait, rosterAvatarContext, rosterPortraitList, rosterPortraitListPath, writeRosterPortrait} from "./roster-portraits.js";
import {openPortraitFrameEditor} from "../../utils/PortraitFrameDialog.js";
import {headerPortraitContext, usedActorPortraits, wirePortraitPopout, pointImagePopoutAt} from "../../utils/actor-portrait-picker.js";
import {addPopoutHeaderControl, addPortraitFrameControl, addTokenizerControl} from "../../utils/popout-header-control.js";
import {canOpenTokenizer, openTokenizer} from "../../utils/portrait-tokenizer.js";
import {ensureFollowerActors, followerActorFromLink, syncFollowerActors} from "./follower-actors.js";
import {localize, format} from "../../utils/i18n.js";
import {promptRaiseFromDead} from "../../hooks/DeathsDoorPrompt.js";

const _STAT_KEYS = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const _STAT_CHOICES = [..._STAT_KEYS].map(k => [k, k.toUpperCase()]);

const STAT_TOOLTIPS = {
	str: "Your physical power and ability to use it. Roll +STR to Clash, or to Defy Danger with raw might or power.",
	dex: "Your grace and fine motor control. Roll +DEX to Let Fly, or to Defy Danger with speed, agility, finesse.",
	int: "Your memory, learning, and quick thinking. Roll +INT to Know Things, or to Defy Danger via expertise or a clever plan.",
	wis: "Your intuition, self-control, and awareness. Roll +WIS to Seek Insight, or when you rely on your willpower or senses to Defy Danger.",
	con: "Your stamina, grit, determination, and endurance. Roll +CON to Defend, or to Defy Danger by holding steady or enduring hardship.",
	cha: "Your ability to charm and connect with others, and to get a read on what others want. Roll +CHA to Persuade, or to Defy Danger socially.",
};

// Hover tooltips for the vitals row (Damage/HP/Armor/XP/Level), keyed by the
// label's data-vital attribute. Gated by hoverDescriptionsVitals.
const VITAL_TOOLTIPS = {
	damage: "Your damage die. Roll it when you deal damage; moves, gear, and tags can raise or lower it.",
	hp:     "Hit points. Lose them when you take damage; at 0 HP you're dying and must face Death's Door. Your max is set by your playbook and CON.",
	armor:  "Reduces the damage you take: subtract it from each hit. Computed from the gear you're wearing.",
	xp:     "Experience. Mark 1 XP on a miss (roll 6-) and from some moves; when the track fills, spend it to level up.",
	level:  "Your character level. Higher levels let you learn advanced moves and raise the XP needed to advance.",
};

// Suggested "where their armor comes from" values for the follower armor row.
// Free-type: these are autocomplete hints only — a player can pick one, combine
// them, type their own, or leave it blank (no source is a perfectly valid state).
const FOLLOWER_ARMOR_SOURCES = [
	"Leather armor",
	"Padded armor",
	"Thick hides",
	"Scale armor",
	"Chainmail",
	"Brigandine",
	"Shield",
	"Helm",
	"Natural (tough hide)",
];

const _esc = escHtml;

/**
 * Every move in a snapshot's movelist, flattened — basic, expedition, playbook, learned, the
 * "other" moves both flat and in their custom groups, post-death, and love letters.
 *
 * One enumeration because two callers need the same one and would drift apart: the wound
 * reminder's name list, and `_printedMoveSource`, which has to find a row's SOURCE text whether
 * or not that row is an owned item. A section added to the sheet and missed here goes quiet in
 * both — no reminder to attach a wound to, and a card that falls back to scraping the DOM.
 */
function* _movelistMoves(movelist) {
	if (!movelist) return;
	yield* movelist.basicMoves ?? [];
	yield* movelist.expeditionMoves ?? [];
	yield* movelist.playbookMoves ?? [];
	yield* movelist.learnedMoves ?? [];
	yield* movelist.otherMoves ?? [];
	for (const group of movelist.otherGroups ?? []) yield* group?.moves ?? [];
	yield* movelist.postDeathGroup?.moves ?? [];
	yield* movelist.loveLetters ?? [];
}

function _formatResultLine(text) {
	return _esc(text).replace(/^(7\+|10\+|7-9|6-):/, "<strong>$1:</strong>");
}

// Whether a guided move has anything to open a dialog FOR. A move that only rolls opens one to
// ask how; a move that neither rolls nor is rollable has nothing to decide, so its name-click
// posts its text to chat instead.
function _guidedCharacterMoveHasAction(guide, rollable = null) {
	return Boolean(rollable || guide?.roll);
}

/**
 * The moves that open a dialog before they roll, keyed by move name.
 *
 * THREE entries, and that is the whole reachable population. A guide is found either by
 * _guidedMoveForRollable — which needs the move to have a rollType, since a move without one
 * has no `.rollable` on its title (see tab-moves.hbs) — or by a caller that names it outright, which only
 * Recover's own button does.
 *
 * The table used to carry 24 more: every playbook and expedition move with a "pick 1" list in
 * its text. Not one of them could ever be reached, because none of them rolls. They were a
 * second, abbreviated copy of prose that already ships in the compendium, behind a door with no
 * handle — and they had already drifted from it (A Safe Place's three separate "reveal" options
 * are one sentence in the printed move).
 *
 * Their lists were not lost with them, and are not wired up here either. A move that never rolls
 * now offers its choices on the card its text is posted to (chat.js#pickableMoveDescription):
 * the move's OWN printed list, made tickable, persisted on the message like a roll card's. That
 * covers every such move rather than the 24 someone got to, needs no second click, and has no
 * copy to drift.
 *
 * A guide is REFERENCE plus, at most, what has to be answered before the dice: `trigger`,
 * `results` and `note` are read, and `roll` is a stat key ("wis") or "ask" to pick one in the
 * dialog. No free-text boxes — nothing stored what was typed into them (the homefront dialogs on
 * the steading sheet lost theirs for the same reason) — and no pre-roll tick lists: Forage's
 * "10+ pick 2, 7-9 pick 1" cannot be chosen before the dice have said which, and its four
 * options are printed on the result card with the tier's count above them, so ticking them in
 * the dialog only asked for a guess. (To make those a real checklist on the card, give the
 * Forage ITEM a `system.pickOptions` — the roll engine renders and persists one from that.)
 */
/**
 * The moves that CHARGE before they roll — `cost` makes the dialog say the price, show what is
 * in the purse, and refuse the dice when it cannot be paid (see _stockCostView).
 *
 * Only a move whose ONE trigger both spends and rolls belongs here. Nine shipped moves cost
 * Stock and five of those roll, but three of the five spend at one moment and roll at quite
 * another: Amulets & Talismans and Wards & Bindings pay when the charm is crafted or the
 * boundary marked, and roll later — when that harm actually comes, when those wards are tested —
 * and Veil pays at the veiling and rolls when the deception is scrutinised. Gating THOSE rolls
 * on Stock would refuse a Blessed the roll for a charm they already paid for, possibly sessions
 * ago. The remaining four Stock moves (Call the Spirits, Healer's Arts, Potent Workings,
 * Trackless Step) never roll at all, so there is no dialog and no moment at which to charge;
 * they stay paid by hand on the pouch, as the Blessed's marks deliberately do.
 */
export const GUIDED_CHARACTER_MOVES = {
	"Danu's Grasp": {
		trigger: "When you call on the world itself to bind a spirit or a perversion of nature, spend 1 Stock and roll +WIS.",
		results: [
			"10+: as 7-9, but both apply.",
			"7-9: roots, vines, and earth pull at them, and they pick 1.",
			"6-: the GM makes a move.",
		],
		cost: { amount: 1, label: "Stock" },
		note: "The Stock is spent when you roll. If this brings them to 0 HP, they are pulled into the earth and bound in rune-etched stone.",
		roll: "wis",
	},
	"Suck the Poison Out": {
		trigger: "When you draw a malady from a patient's body, mind, or soul, spend 1 Stock and roll +WIS.",
		results: [
			"10+: you remove the malady and can discard it or store it in your pouch (taking the space of 1 Stock).",
			"7-9: you remove it, but choose 1: lingering harm to your patient; you suffer some of its effects; or it is dangerous to discard.",
			"6-: the GM makes a move.",
		],
		cost: { amount: 1, label: "Stock" },
		note: "The Stock is spent when you roll. Storing the drawn malady costs the space of a second Stock; mark that on the pouch yourself.",
		roll: "wis",
	},
	"Forage": {
		trigger: "When you spend a few hours seeking food in the wild, roll +WIS. In winter, you have disadvantage.",
		results: ["10+: pick 2.", "7-9: pick 1.", "6-: you find nothing, and there is danger or risk."],
		note: "Provisions can substitute for supplies when you Make Camp, 1-for-1. The four options are on the result card; take as many as the roll allows.",
		roll: "wis",
	},
	"Recover": {
		trigger: "When you take time to catch your breath and tend to what ails you, expend 1 use of supplies and regain HP equal to 4 + Prosperity.",
		results: ["You can't gain this benefit again until you take more damage."],
		note: "When you tend to a debility or problematic wound, say how. The GM will say it's taken care of, or tell you what else is required.",
	},
	"Struggle as One": {
		trigger: "When you Defy Danger as a group, establish the party's approach and each roll +STAT (per Defy Danger).",
		results: [
			"10+: you do well enough to get someone else out of a spot, if you can tell us how.",
			"7-9: you pull your weight.",
			"6-: you find yourself in a spot — the GM will describe it or ask you to.",
		],
		note: "If you roll a 6- but someone saves you, don't mark XP.",
		roll: "ask",
	},
};

// Expedition moves that open their own bespoke dialog instead of the generic
// guided modal. Keyed by move name so the click handler stays a single lookup.
const EXPEDITION_MOVE_HANDLERS = {
	Requisition: sheet => sheet._onRequisition(),
	Outfit:      sheet => sheet._onOutfitOpen(),
	"Make Camp": sheet => sheet._onMakeCampOpen(),
};

// Description-only moves whose USE does something beyond posting their text. These have no
// rollType, so they fall through every roll path to the "post it to chat" tail — and posting
// the text IS using them. Keyed by move name so both tails (the move-name click and the hotbar
// macro) stay one lookup, and so a fourth playbook adds a row here rather than another method
// plus a call at each site, where the two can silently drift apart.
//
// Matched on the resolved ITEM, never the row's text: an un-owned playbook row posts its text
// with no item id at all, and a player-authored custom move can carry any name. Each handler
// does its own gating (editable, owns the move that grants the effect).
const MOVE_USE_EFFECTS = {
	[CONSECRATED_FLAME]:  sheet => sheet._consecrateFlame(),
	[CONDEMN]:            sheet => sheet._openCondemnedIfJudge(),
	[CENSURE]:            sheet => sheet._openCondemnedIfJudge(),
	[BINDING_ARBITRATION]: sheet => sheet._openCondemnedIfJudge(),
	// The Blessed's three description-only marking moves. Using one IS laying a mark, and a
	// Blessed handed no way to write it down is back to keeping the list in their head.
	[BARKSKIN]:           sheet => sheet._openBlessedMarksIfBlessed(),
	[TRACKLESS_STEP]:     sheet => sheet._openBlessedMarksIfBlessed(),
	[SHARED_SOULS]:       sheet => sheet._openBlessedMarksIfBlessed(),
	// Rites of the Land holds Favor on the character, may spend a Surplus and clear a debility
	// on the steading, and can promise advantage on a Fortunes roll nobody has made yet. Three
	// documents and a fourth thing to remember next season — so it gets a walkthrough.
	[RITES_OF_THE_LAND]:  sheet => sheet._openRitesOfTheLand(),
	// A Ranger On the Hoof procures the day's food while the party walks. There is no roll tier
	// to it, so using the move IS collecting: the prompt asks the one question its text asks
	// (winter or barren terrain?) and rolls the 1d6 accordingly.
	[ON_THE_HOOF]:        sheet => sheet._onTheHoof(),
};

// The same idea for moves that ROLL: their use does not fall through to the post-it-to-chat tail,
// so MOVE_USE_EFFECTS never sees them. Only the Blessed's two +INT marking moves are here — both
// lay something that stands afterwards, and both are ordinary fixed-stat rolls, so consulting this
// once the roll has resolved catches every way of making them. BOTH roll entry points do it: the
// Moves tab's click and rollMoveById, which is where a move on the hotbar arrives.
const MOVE_ROLL_EFFECTS = {
	[AMULETS_TALISMANS]: sheet => sheet._openBlessedMarksIfBlessed(),
	[WARDS_BINDINGS]:    sheet => sheet._openBlessedMarksIfBlessed(),
};

/** Which sentence the scales' tooltip says, given what the Judge is actually holding. */
function _judgeMarksTooltipKey(brands, oaths) {
	if (brands && oaths) return "stonetop.condemn.bothTooltip";
	if (brands) return "stonetop.condemn.someTooltip";
	if (oaths) return "stonetop.condemn.oathsTooltip";
	return "stonetop.condemn.noneTooltip";
}

/**
 * What the two TOGGLE glyphs in the header say, per state. The candle and the Battle Joy are the
 * same control twice — one state, flipped, with a read-only face for a viewer who cannot write —
 * and the only thing that differs between them is these six strings.
 *
 * Spelled out per glyph rather than derived from a stem because the two key families are not
 * symmetric (`litLabel` against `onLabel`, `readOnlyLit` against `readOnlyOn`). Naming them once
 * here is what lets the markup be shared; renaming the keys to match would be a bigger change to
 * make in the language files than it saves.
 */
const HOLY_LIGHT_GLYPH = {
	label:    { on: "stonetop.holyLight.litLabel",    off: "stonetop.holyLight.unlitLabel" },
	tooltip:  { on: "stonetop.holyLight.litTooltip",  off: "stonetop.holyLight.unlitTooltip" },
	readOnly: { on: "stonetop.holyLight.readOnlyLit", off: "stonetop.holyLight.readOnlyUnlit" },
};
const BATTLE_JOY_GLYPH = {
	label:    { on: "stonetop.battleJoy.onLabel",     off: "stonetop.battleJoy.offLabel" },
	tooltip:  { on: "stonetop.battleJoy.onTooltip",   off: "stonetop.battleJoy.offTooltip" },
	readOnly: { on: "stonetop.battleJoy.readOnlyOn",  off: "stonetop.battleJoy.readOnlyOff" },
};

/**
 * Which of a toggle glyph's sentences apply right now.
 *
 * Picked here rather than branched in the template: it is a FOUR-way choice — on or off, crossed
 * with writable or read-only — and four nested `{{#if}}`s inside an HTML attribute is exactly how
 * these two glyphs came to be written out in full twice over.
 */
function _toggleGlyphKeys(keys, on, editable) {
	const state = on ? "on" : "off";
	return { labelKey: keys.label[state], tooltipKey: (editable ? keys.tooltip : keys.readOnly)[state] };
}

/**
 * The "pay with…" field shared by every dialog that spends a use of supplies.
 *
 * A single eligible purse renders as a sentence, not a radio: there is nothing to choose, and a
 * lone radio button that cannot be unpicked is a control pretending to be one. Two or more render
 * as radios, defaulting to the first (supply-cost.js#defaultSupplyPurse drains the printed rows
 * before a larder or a vial).
 *
 * Whatever is being carried but CANNOT pay is listed underneath with the reason, because that is
 * the question the field actually raises: a player with four uses of provisions looking at a
 * Recover dialog wants to know why they are not on the list, and "they are not on the list" is
 * not an answer. See supply-cost.js for both directions of that rule.
 */
function _supplyPurseFieldHtml(purses, legend) {
	const { eligible, ineligible } = purses;
	const body = eligible.length === 1
		? `<p class="stonetop-supply-purse-only">${_esc(eligible[0].label)} <span class="stonetop-supply-purse-left">(${eligible[0].remaining} left)</span></p>`
		: eligible.map((p, i) => `<label class="stonetop-supply-purse">
				<input type="radio" name="supplyPurse" value="${_esc(p.slug)}"${i === 0 ? " checked" : ""}>
				<span>${_esc(p.label)} <span class="stonetop-supply-purse-left">(${p.remaining} left)</span></span>
			</label>`).join("");
	const refused = ineligible.map(p => `<li><strong>${_esc(p.label)}</strong> (${p.remaining}): ${_esc(p.reason)}</li>`).join("");
	return `<div class="stonetop-supply-purses">
		<p class="stonetop-homestead-subhead">${_esc(legend)}</p>
		${body}
		${refused ? `<ul class="stonetop-supply-purse-refused">${refused}</ul>` : ""}
	</div>`;
}

/** Which purse the player picked in that field, or null when the field offered no choice. */
function _chosenSupplyPurse(html, purses) {
	const slug = html?.find?.('input[name="supplyPurse"]:checked')?.val();
	return purses.eligible.find(p => p.slug === slug) ?? null;
}

/**
 * Keep the camp's bill under the head count as the player changes it. Written live rather than
 * left to the confirm step because "we're five, we have a mess kit" is arithmetic the table would
 * otherwise do out loud, and because seeing the bill go red is what prompts someone to Forage
 * before the night rather than after it.
 */
function _wireCampBill(html, purses) {
	const root  = html[0] ?? html;
	const out   = root.querySelector("[data-camp-bill]");
	const stock = purses.eligible.reduce((sum, p) => sum + p.remaining, 0);
	if (!out) return;
	const paint = () => {
		const people  = root.querySelector('[name="people"]')?.value;
		const messKit = !!root.querySelector('[name="messKit"]')?.checked;
		const needed  = campUsesNeeded(people, messKit);
		const short   = Math.max(0, needed - stock);
		out.textContent = short
			? `Needs ${needed}; you have ${stock}. ${short} short: someone goes hungry.`
			: `Needs ${needed} of the ${stock} you can spend.`;
		out.classList.toggle("is-short", short > 0);
	};
	root.querySelector('[name="people"]')?.addEventListener("input", paint);
	root.querySelector('[name="messKit"]')?.addEventListener("change", paint);
	paint();
}

// The GM's artifact control (_onArtifactGmControl). The rungs in ladder order, weakest first,
// and the three text fields in the order p.430-431 introduces them — the hint that stands in
// for the tags, the write-up a 10+ hands over, the lead a miss leaves. `key` is both the
// knowledge field read out and the form control's name, so the harvest needs no second table.
const ARTIFACT_GM_TEMPLATE = "systems/stonetop-pwd/templates/dialogs/artifact-gm.hbs";
const ARTIFACT_GM_STATES = [
	ARTIFACT_STATE.NONE, ARTIFACT_STATE.UNKNOWN, ARTIFACT_STATE.PARTIAL, ARTIFACT_STATE.KNOWN,
];
const ARTIFACT_GM_FIELDS = [
	{ key: "hint", labelKey: "stonetop.artifact.fieldHint", hintKey: "stonetop.artifact.fieldHintNote" },
	{ key: "lore", labelKey: "stonetop.artifact.fieldLore", hintKey: "stonetop.artifact.fieldLoreNote", rich: true },
	{ key: "lead", labelKey: "stonetop.artifact.fieldLead", hintKey: "stonetop.artifact.fieldLeadNote" },
];

// What the invoke window says about the Invocation already running, keyed by the kinds
// invokeNotice reports. The whole point of the window growing this line: the rule that one
// Invocation ends another is enforced silently a beat later, and a player who has forgotten what
// they were holding would only find out by noticing it stopped working in the fiction.
//
// Only "start" is a plain statement; the other three name a cost that is about to be paid, so
// each says WHICH Invocation is at stake rather than "your ongoing Invocation" — hence the
// {name} placeholder in three of the four.
//
// Localised, unlike this file's roll-card flavor: nothing persists these sentences and nothing
// parses them back (the reason the tier text is an English literal is that a settled roll card's
// flavor is stored and re-read by the GM's Shift Up/Down — see roll-engine `_shiftRollCardFlavor`).
// A window that explains what a chip means has to speak the same language as the chip.
const INVOCATION_NOTICE_KEYS = {
	start:     "stonetop.invocations.noticeStart",
	renew:     "stonetop.invocations.noticeRenew",
	replace:   "stonetop.invocations.noticeReplace",
	interrupt: "stonetop.invocations.noticeInterrupt",
};

// Why an Invocation stopped, said in the chat card that reports it. The Invocation ending is a
// thing that happens in the fiction — a wall of light drops, a blinding glare gutters — so unlike
// the candle (a tracker correction, which posts nothing) every ending is spoken aloud. The two
// reasons are whole sentences rather than a stem plus a suffix, so a translator can put the
// because-clause wherever their language wants it.
const INVOCATION_ENDED_KEYS = {
	byHand: "stonetop.invocations.endedByHand",
	light:  "stonetop.invocations.endedLight",
};

// Rides an Invocation's chat card when the player bought the empowered effect, so the
// table can see the price was paid rather than inferring it from the stronger text.
const EMPOWERED_NOTE_HTML =
	`<p class="stonetop-chat-empowered-note"><i class="fas fa-sun" aria-hidden="true"></i> `
	+ `Empowered: an <strong>extra consequence</strong>, chosen before the roll and taken `
	+ `whatever it comes up.</p>`;

function _addToLeadingNumber(value, delta) {
	const match = String(value ?? "").match(/^(-?\d+)(.*)$/);
	if (!match) return value;
	return `${Number(match[1]) + delta}${match[2]}`;
}

function _addToDamage(value, delta) {
	const text = String(value ?? "");
	const match = text.match(/^([^(\s]+)(.*)$/);
	if (!match) return value;
	const formula = match[1].replace(/([+-]\d+)?$/, current => {
		const next = (current ? Number(current) : 0) + delta;
		return next > 0 ? `+${next}` : next < 0 ? String(next) : "";
	});
	return `${formula}${match[2]}`;
}

function _applyAnimalCompanionTraits(typeData, traits) {
	const traitText = traits.join(" ");
	const hpBonus     = [...traitText.matchAll(/[+](\d+)\s*HP/gi)]
		.reduce((sum, m) => sum + Number(m[1]), 0);
	const armorBonus  = [...traitText.matchAll(/[+](\d+)\s*armor/gi)]
		.reduce((sum, m) => sum + Number(m[1]), 0);
	const damageBonus = [...traitText.matchAll(/(?:Damage\s*)?[+](\d+)\s*damage/gi)]
		.reduce((sum, m) => sum + Number(m[1]), 0);
	return {
		hp:     typeData?.hp !== undefined ? Number(typeData.hp) + hpBonus : undefined,
		armor:  armorBonus  ? _addToLeadingNumber(typeData?.armor,  armorBonus)  : typeData?.armor,
		damage: damageBonus ? _addToDamage(typeData?.damage, damageBonus) : typeData?.damage,
	};
}

function _titleCase(value) {
	return String(value ?? "").toLowerCase().replace(/\b\p{L}/gu, char => char.toUpperCase());
}

function _animalCompanionTraitTooltip(trait) {
	const key = String(trait ?? "").trim().toLowerCase();
	return ANIMAL_COMPANION_TRAIT_GLOSSARY[key]
		?? ANIMAL_COMPANION_TRAIT_GLOSSARY[key.replace(/\s*\(.*/, "")]
		?? null;
}

function _makeLoyaltyPips(val, max = 3) {
	return Array.from({ length: max }, (_, i) => ({ index: i, filled: i < val }));
}

// The Ring of Daagon and its Servants share one Loyalty pool (Book II). Find the Ring
// follower in a customFollowers map so a Servant batch's pips + Spend button act on the
// Ring's track. Callers pass an in-hand map (getData) or a freshly-read flag.
function findRingFollower(map = {}) {
	const entry = Object.entries(map).find(([, f]) => f?.sourceUuid === RING_SOURCE_UUID);
	return {
		id:      entry?.[0] ?? null,
		name:    entry?.[1]?.name || "the Ring of Daagon",
		loyalty: Math.max(0, Number(entry?.[1]?.loyalty) || 0),
		hasRing: !!entry,
	};
}

// Readiness circles (Defend, p.216 / followers p.469). The Defend move holds up
// to 3 (10+) or 1 (7-9); a borne shield adds +1 to either, so the cap is 4 with
// a shield, 3 without. Never render fewer circles than are held, so an over-held
// pool (e.g. shield dropped mid-fight) stays spendable.
function _makeReadinessPips(val, max = 3) {
	const count = Math.max(max, val);
	return Array.from({ length: count }, (_, i) => ({ index: i, filled: i < val }));
}

// A follower "bears a shield" (+1 Readiness on a 7+ Defend) if any checked gear
// entry names a shield. Gear labels are free text on every follower type, so a
// simple name match covers animal companions, initiates, beasts and customs; the
// crew detects its shield from its structured inventory instead (see below).
function _followerBearsShield(gear) {
	return (gear ?? []).some(g => g?.checked && /shield/i.test(g?.label ?? ""));
}

// Followers that can gain the "exceptional" tag, and the playbook move that
// grants it (Book I p.462: the crew "requires Heroes to the Last"; the Ranger's
// animal companion gets it from Beast of Legend). Other follower types have no
// such option in the rulebook, so they never show the exceptional control.
const FOLLOWER_EXCEPTIONAL = {
	"crew":             { move: "Heroes to the Last", noun: "crew" },
	"animal-companion": { move: "Beast of Legend",    noun: "animal companion" },
};

// Per-follower-type presentation constants, spread into each card builder in
// _buildFollowersData so a type's icon / damage-type tag / capability flags /
// default damage pronoun live in one place instead of being re-typed across the
// four builders. Only genuinely constant fields go here; per-instance values (a
// named companion's pronoun, a beast's follower-vs-livestock icon and label) are
// set after the spread and override these. A type omits a key when it has no
// constant for it — crew has static HP so no `hpFollower`; the beast's icon is
// per-instance so it sets `portraitIcon` itself.
const FOLLOWER_FTYPE_DEFAULTS = {
	"animal-companion": { ftype: "animal-companion", portraitIcon: "fas fa-paw",      damageType: "animal",   hpFollower: "animal-companion", showGear: true,  nameEditable: true, namePlaceholder: "Animal Companion" },
	"crew":             { ftype: "crew",             portraitIcon: "fas fa-users",    damageType: "crew",     damagePronoun: "they",          showGear: false, nameEditable: true, namePlaceholder: "Crew" },
	"initiate":         { ftype: "initiate",         portraitIcon: "fas fa-seedling", damageType: "initiate", hpFollower: "initiate",         showGear: true },
	"beast":            { ftype: "beast",            damageType: "beast",             damagePronoun: "it",    hpFollower: "beast",            showGear: true },
	"custom":           { ftype: "custom",           portraitIcon: "fas fa-user",     damageType: "custom",   damagePronoun: "they",  hpFollower: "custom",   showGear: true,  nameEditable: true, pronounEditable: true, namePlaceholder: "Follower" },
};

// Common, hand-editable follower fields shared by every card type on the
// Followers tab (matching the rulebook's blank Follower card): the exceptional
// toggle, free-text Moves and Notes, and a diamond Gear checklist. Each follower
// stores these under its own flag namespace (see _followerDetailBase); `d` is
// that raw object (may be undefined).
function _followerExtras(d = {}) {
	const moves   = String(d?.moves ?? "");
	const gearArr = Array.isArray(d?.gear) ? d.gear : [];
	const storedImg = String(d?.img ?? "").trim();
	const portrait  = resolvePortrait(storedImg, d?.portraitFrame);
	return {
		exceptional: !!d?.exceptional,
		moves,
		movesLines:  moves.split("\n").map(s => s.trim()).filter(Boolean),
		gear:        gearArr.map((g, i) => ({ index: i, label: g?.label ?? "", checked: !!g?.checked })),
		notes:       String(d?.notes ?? ""),
		// The card's portrait, chosen from the People of Stonetop gallery (or carried over
		// from the actor a follower was recruited from — see buildCustomFollower). It rides
		// with the other hand-edited extras because it is stored and written exactly like
		// them: read out of this same `.details` object, written back through
		// _followerDetailBase, so every follower type gains a portrait in one place.
		// Empty means "no portrait" and the card falls back to the type's glyph.
		//
		// `img` is what the card RENDERS, which differs from the stored path in exactly one
		// case: a shipped square framed against its higher-resolution illustration, which is the
		// picture the rect was measured on and therefore the one it must be applied to.
		img:         portrait.src,
		imgStyle:    portrait.style,
		// The path on the flag, for anything that must hand a PATH on rather than paint it —
		// the drag snapshot, which seeds a token.
		storedImg,
		// The raw rect, so a follower dragged onto the map carries its frame across.
		portraitFrame: d?.portraitFrame ?? null,
		// The Actor this follower has already been placed on the map as, if any (written by
		// the canvas-drop hook the first time the card is dragged onto a scene — see
		// module/hooks/FollowerDrop.js). Stored beside the portrait because it is stored
		// exactly like it: one value on the follower's own `.details` object, so every
		// follower type gains the link in one place. Empty is the normal state.
		actorUuid:   String(d?.actorUuid ?? "").trim(),
	};
}

// Per-follower-type flag layout — the single source of truth both the read side
// (_buildFollowersData) and the write side (activateListeners) resolve paths
// through, so the two can't drift and a new follower type is one row:
//   detailBase  – `.details` namespace for hand-edited extras (moves / notes /
//                 gear) and the Damage / Instinct / Cost overrides. The `.details`
//                 sub-key on the singular types keeps these clear of the
//                 structural flags (name, loyalty, the crew's gear-pip inventory
//                 at `crew.gear`, tags…). `{slug}` is filled per instance for the
//                 repeatable types.
//   loyalty     – the (older) Loyalty store: scalar for the singular animal
//                 companion / crew, per-slug for initiates / beasts.
//   structural  – type-root fields the player edits directly. name / pronoun,
//                 plus instinct / cost on the types that carry them from
//                 onboarding. Editing one writes here, NOT to the override layer,
//                 so it can be cleared — an empty override would otherwise fall
//                 back to the onboarding value (see withStatOverrides).
const _FOLLOWER_FLAGS = {
	"animal-companion": { detailBase: "animalCompanion.details", loyalty: "animalCompanion.loyalty", readiness: "animalCompanion.readiness", ammo: "animalCompanion.ammo",
		structural: { name: "animalCompanion.name", pronoun: "animalCompanion.pronoun", instinct: "animalCompanion.instinct", cost: "animalCompanion.cost" } },
	"crew":             { detailBase: "crew.details",            loyalty: "crew.loyalty",            readiness: "crew.readiness",            ammo: "crew.ammo",
		structural: { name: "crew.name", instinct: "crew.instinct", cost: "crew.cost" } },
	"initiate":         { detailBase: "initiateDetails.{slug}",  loyalty: "initiatesLoyalty.{slug}", readiness: "initiatesReadiness.{slug}", ammo: "initiatesAmmo.{slug}", structural: {} },
	"beast":            { detailBase: "beastDetails.{slug}",     loyalty: "beastLoyalty.{slug}",     readiness: "beastReadiness.{slug}",     ammo: "beastAmmo.{slug}",     structural: {} },
	// Custom followers (the walkthrough / monster conversion) store everything —
	// structural stats, the hand-edited overrides, Loyalty and current HP — in one
	// object keyed by the follower's id. detailBase points at that whole object, so
	// the shared override (damage/instinct/cost) and extras (moves/notes/gear)
	// handlers read and write it directly; name/pronoun fall through to it too
	// (structural is empty, so the name-field change handler uses the detail path).
	"custom":           { detailBase: "customFollowers.{slug}",  loyalty: "customFollowers.{slug}.loyalty", readiness: "customFollowers.{slug}.readiness", ammo: "customFollowers.{slug}.ammo", structural: {} },
};
const _fillSlug = (tpl, slug) => tpl == null ? null : tpl.replaceAll("{slug}", slug ?? "");

// `.details` namespace for a follower's hand-edited extras + stat overrides, or null.
function _followerDetailBase(ftype, slug) { return _fillSlug(_FOLLOWER_FLAGS[ftype]?.detailBase, slug); }

// Who a follower already IS, and what making them an actor means, both live in
// actors/character/follower-actors.js — one place, because the sweep that makes them and the
// pips that act on them have to agree about it.

// Type-root path for a structurally-stored field (name / pronoun / instinct / cost), or null.
function _followerStructuralPath(ftype, field) { return _FOLLOWER_FLAGS[ftype]?.structural?.[field] ?? null; }

/**
 * What a follower card carries with it when it's dragged onto the canvas: everything the
 * drop hook needs to find — or build — the Actor it becomes (module/hooks/FollowerDrop.js).
 *
 * Read off the FINISHED card, after the override / exceptional / order passes, so the token
 * gets the numbers the player is looking at rather than the raw stored ones. `detailBase`
 * rides along so the hook can write the new actor's uuid back onto this same follower
 * without having to know this file's flag layout.
 *
 * @param {object} card    a finalized follower card
 * @param {Actor} actor    the character whose follower it is
 */
function _followerDragSnapshot(card, actor) {
	if (!card?.ftype) return null;
	// The crew and a custom group both fight as one combatant with a pooled HP track
	// (p.470), so that pool — not one member's HP — is what their token carries.
	const isGroup = !!card.isGroup || card.groupHpMax != null;
	const hp = isGroup
		? { value: card.groupHpCurrent, max: card.groupHpMax }
		: { value: card.hpCurrent, max: card.hpMax ?? (Number(card.hpStaticValue) || 0) };
	return {
		type:          FOLLOWER_DRAG_TYPE,
		characterUuid: actor?.uuid ?? null,
		characterName: actor?.name ?? null,
		ftype:         card.ftype,
		slug:          card.slug ?? "",
		detailBase:    _followerDetailBase(card.ftype, card.slug),
		follower: {
			// withOrderData already settled the display name (an initiate carries theirs as
			// an epithet, an unnamed card falls back to its type), so reuse it rather than
			// restating that fallback.
			name:        card.orderName,
			// `storedImg`, not `img`: the card RENDERS the illustration when a shipped square has
			// been framed against it, and a token wants the path on the flag rather than the one
			// being painted. The frame rides along so the NPC this becomes keeps the same face.
			img:           card.storedImg ?? card.img ?? "",
			portraitFrame: card.portraitFrame ?? null,
			// The glyph the card falls back to when it has no portrait (a paw, a sprout, a
			// crowd). Carried so the Actor can wear the matching mark instead of Foundry's
			// mystery-man — see followerMarkerImg.
			portraitIcon: card.portraitIcon ?? "",
			pronoun:     card.pronoun ?? "",
			typeLabel:   card.typeLabel ?? "",
			tags:        (card.tags ?? []).map(t => (typeof t === "string" ? t : t?.label)).filter(Boolean),
			hp,
			armor:       card.armor,
			armorSource: card.armorSource ?? "",
			damage:      card.damage ?? "",
			damageRoll:  card.damageRoll ?? "",
			instinct:    card.instinct ?? "",
			moves:       card.movesLines ?? [],
			notes:       card.notes ?? "",
			cost:        card.cost ?? "",
			gear:        card.gear ?? [],
			isGroup,
			// Where this follower came from, and where they've already been placed: an
			// actorUuid means the card has been dropped before and that actor IS them.
			sourceUuid:  card.sourceUuid ?? null,
			actorUuid:   card.actorUuid ?? "",
		},
	};
}

// Effective crew headcount: the stored size, else the rulebook's default
// half-dozen (Crew insert, p.144), but never fewer than the named individuals.
// Only a genuinely unset (null/undefined/non-numeric) size defaults to 6 — an
// explicit 0 is honoured, so emptying the roster doesn't spring back to six.
// Shared by the read side (_buildFollowersData) and the resize/delete handlers.

// Flag path where a follower type stores its Loyalty value, driving the single
// shared loyalty-pip click handler (see _FOLLOWER_FLAGS).
function _followerLoyaltyPath(ftype, slug) { return _fillSlug(_FOLLOWER_FLAGS[ftype]?.loyalty, slug); }

// Flag path where a follower type holds Readiness (held when it Defends, p.469).
// One card-body row drives every type: the crew's entry is the group's common
// pool (p.473) rather than one member's, but it reads and writes the same way.
function _followerReadinessPath(ftype, slug) { return _fillSlug(_FOLLOWER_FLAGS[ftype]?.readiness, slug); }

// Flag path for a follower's ammo track (0 = full, 1 = low ammo, 2 = all out) — the
// ◇ low ammo / ◇ all out marks a ranged follower carries (Moves & Gear).
function _followerAmmoPath(ftype, slug) { return _fillSlug(_FOLLOWER_FLAGS[ftype]?.ammo, slug); }

// Current HP against a max, with the shared "unset → full" default: a missing or
// non-numeric stored value means the follower is at full HP.
function _clampHp(raw, max) {
	const n = Number(raw);
	return raw != null && Number.isFinite(n) ? Math.min(Math.max(0, n), max) : max;
}

// A hand-edited stat override (follower armor / max HP, or a crew's per-member
// stats): a non-negative integer, or null when blank/non-numeric so callers can
// fall back to the rules-derived value.
function _intOverrideOrNull(value) {
	// Treat blank/empty/null as "no override" → null. (Number("") and Number(null)
	// are both 0, so without this guard a cleared field would read as an explicit 0,
	// zeroing crew armor or collapsing per-member HP instead of reverting to derived.)
	if (value == null || String(value).trim() === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

// Pull the rollable die and parenthetical "form" (e.g. "forceful") out of a
// free-text damage string like "d8 (forceful)". `band`→`hand` repairs a common
// OCR slip from the transcribed stat blocks.
function _parseFollowerDamage(str) {
	const s = String(str ?? "");
	return {
		damageRoll: dieFromDamage(s),
		damageForm: (s.match(/\(([^)]+)\)/)?.[1] ?? "").replace(/\bband\b/gi, "hand") || null,
	};
}

export function createStonetopCharacterSheetClass(Base) {
	// Details-tab sections (Background, Instinct, Appearance, Origin, Lore) each
	// carry their own edit pencil via the shared section-editing mixin, tracked
	// independently of the global header-wrench `_editMode`.
	//
	// withSheetSizeMemory: reopen at the size this user last left this character's sheet. Both
	// dimensions are restored independently — a sheet carried over from when only width was
	// remembered has no stored height, and keeps the default one.
	//
	// withPreferencesTab: the Preferences tab's three delegated handlers, shared with the GM
	// Toolkit sheet, which carries the same tab. The tab's rows and values come from
	// module/utils/sheet-preferences.js either way; the mixin is only the wiring.
	return class StonetopCharacterSheet extends withPreferencesTab(withSectionEditing(withSheetSizeMemory(Base))) {
		_stonetopCharacter;
		_editMode = false;
		// The playbook's Invocation list as of the last render, so a click can name one without
		// re-reading the playbook document. Empty until then, and for everyone but a Lightbearer.
		_invocationOptions = [];

		constructor(...args) {
			super(...args);
			this._stonetopCharacter = this.actor.typedActor;

			// Honor the "Open Sheets in Edit Mode" client setting on first open; the
			// header wrench still toggles modes per-sheet afterward.
			this._editMode = getOpenSheetsInEditMode();

			// Reopen the collapsible crew sections (Inventory / Roster / Group Fight)
			// in the state this user last left them — persisted per-actor, per-user.
			this._openCrewSections = new Set(getCrewSectionsOpen(this.actor?.id));

			// Likewise the sidebar move groups (Basic / Expedition), which default to
			// expanded, so we track the ones left collapsed.
			this._collapsedMoveSections = new Set(getMovesSectionsCollapsed(this.actor?.id));

			// And the Arcana sections (Major / Minor arcanum), which also default to
			// expanded; we track the ones left collapsed.
			this._collapsedArcanaSections = new Set(getArcanaSectionsCollapsed(this.actor?.id));

			// Reverse-side arcanum content folds (the "Consequences" section on major
			// arcana). Unlike the sections above these default to COLLAPSED, so we track
			// the ones left EXPANDED (absence = collapsed).
			this._expandedArcanaContent = new Set(getArcanaContentExpanded(this.actor?.id));

			// And the individual arcanum cards (clamped to their title bar). Like the
			// sections they default to expanded; we track the slugs left collapsed.
			this._collapsedArcanaCards = new Set(getArcanaCardsCollapsed(this.actor?.id));

			// And the write-ups on the gear rows (a treasure's printed sidebar, a GM's artifact
			// notes). Unlike everything above these default to FOLDED — prose that long belongs
			// behind a caret in a one-line-per-row column — so we track the item ids left open.
			this._expandedItemLore = new Set(getInventoryLoreExpanded(this.actor?.id));
		}

		// Persist the current crew-section open state so it survives a sheet reopen.
		_persistCrewSections() {
			setCrewSectionsOpen(this.actor?.id, [...(this._openCrewSections ?? [])]);
		}

		// Persist which sidebar move groups are collapsed so it survives a reopen.
		_persistMoveSections() {
			setMovesSectionsCollapsed(this.actor?.id, [...(this._collapsedMoveSections ?? [])]);
		}

		// Persist which Arcana sections are collapsed so it survives a reopen.
		_persistArcanaSections() {
			setArcanaSectionsCollapsed(this.actor?.id, [...(this._collapsedArcanaSections ?? [])]);
		}

		// Persist which reverse-side arcanum content folds (Consequences) are expanded.
		_persistArcanaContent() {
			setArcanaContentExpanded(this.actor?.id, [...(this._expandedArcanaContent ?? [])]);
		}

		// Persist which individual arcanum cards are collapsed so it survives a reopen.
		_persistArcanaCards() {
			setArcanaCardsCollapsed(this.actor?.id, [...(this._collapsedArcanaCards ?? [])]);
		}

		// Persist which gear rows have their write-up unfolded (these default folded).
		_persistItemLore() {
			setInventoryLoreExpanded(this.actor?.id, [...(this._expandedItemLore ?? [])]);
		}

		// Wire a custom collapse/expand toggle for a set of collapsible sections. Used
		// by both the sidebar move groups and the Arcana sections — both use a custom
		// toggle (not <details>) so the content keeps contributing layout, and both
		// track COLLAPSED ids (default expanded). `getSet` returns the live Set to
		// mutate; `persist` writes it back. (Crew sections use <details>.open instead,
		// so they keep their own handler.)
		//
		// `tracksExpanded` flips which half of the state the Set holds, for a fold that defaults
		// SHUT rather than open (the gear rows' write-ups): the id goes in when the fold is
		// OPENED, so absence means folded. Nothing else changes — the state a render STARTS in
		// comes from the template either way, and this only decides what gets remembered.
		_wireCollapsible(html, { summarySel, collapsibleSel, getSet, persist, onToggle, tracksExpanded = false }) {
			const toggle = el => {
				const wrap = el.closest(collapsibleSel);
				const id   = wrap?.dataset.section;
				if (!id) return;
				const collapsed = wrap.classList.toggle("is-collapsed");
				el.setAttribute("aria-expanded", String(!collapsed));
				const set = getSet();
				if (tracksExpanded ? !collapsed : collapsed) set.add(id);
				else                                         set.delete(id);
				persist();
				onToggle?.(wrap, collapsed);
			};
			html.find(summarySel).on("click", ev => toggle(ev.currentTarget));
			html.find(summarySel).on("keydown", ev => {
				if (ev.key !== "Enter" && ev.key !== " ") return;
				ev.preventDefault();
				toggle(ev.currentTarget);
			});
		}

		static get defaultOptions() {
			return foundry.utils.mergeObject(super.defaultOptions, {
				// `stonetop-layout-classic` when this user reads character sheets in the
				// classic layout. Set here so the FIRST paint already has it (defaultOptions is
				// read at construction), and re-stamped in _render below — `_replaceHTML` only
				// swaps `.window-content`, so a live flip would otherwise leave the old mode's
				// class on the frame forever. Every classic rule COMPOUNDS this with the four
				// classes beside it; none descends from it.
				classes: ["pbta", "stonetop", "sheet", "actor", "character", ...layoutClasses("character")],
				width: 960,
				minWidth: 800,
				height: 1050,
				// Mirrors the CSS floor in stonetop.css. Core clamps a resize against the
				// COMPUTED min-height, never this option, so the CSS is what actually stops
				// the drag — this copy exists for sheet-size.js's save guard, which reads it.
				minHeight: 620,
				tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "moves" }],
				// `:not(.move-unlearned)` because an un-learned custom move must not leave the
				// sheet: core's DragDrop#bind runs this selector through querySelectorAll and only
				// the matches get `draggable="true"`, so an inactive move simply never starts a
				// drag — rather than starting one that a listener elsewhere has to cancel. The row
				// keeps its `.item` class, and so its card styling and its click handlers.
				dragDrop: [{ dragSelector: ".items-list .item:not(.move-unlearned)" }],
				// Each tab is its own scrollport and the moves sidebar has another. Register
				// both so Foundry saves/restores scrollTop across re-renders — otherwise
				// adding an item / arcanum / follower (which re-renders the sheet) snaps the
				// user back to the top.
				//
				// These selectors must resolve from INSIDE the form: on a re-render Foundry
				// hands _restoreScrollPositions the freshly rendered inner form, not the outer
				// frame, so a `.window-content` entry (which lives above the form) saves fine
				// and then silently restores nothing.
				scrollY: [".sheet-body > .tab.active", ".stonetop-sidebar-body"],
			});
		}

		get template() {
			return "systems/stonetop-pwd/templates/actor/character.hbs";
		}

		async _render(force, options) {
			// Foundry replaces the whole window content on every render, so a fresh
			// <img> portrait is built and the browser must re-fetch/decode it before
			// it paints — a visible flicker on each data-only re-render (toggling
			// supplies pips, rapport "hold" circles, etc.). Carry the already-decoded
			// portrait element forward when its src has not changed, so it never reloads.
			//
			// Reuse keeps the listener bound to the OLD node and discards the one this render
			// just wired to the new one. That used to make an edit-mode flip unsafe, and the
			// check guarded it by comparing `data-edit` — but the click handler now reads
			// `this._editMode` when it fires rather than being wired per mode, and the attribute
			// is gone (see actor-header.hbs).
			//
			// Found through the SLOT, not `img.stonetop-portrait`: a framed portrait moves that
			// class onto the clipping span around the image, so the old selector matched nothing
			// there and every re-render made a cropped face reload.
			//
			// The STYLE has to match as well as the src, and this is not belt-and-braces: a
			// re-frame changes only the style — same picture, new rect — so comparing the src
			// alone would carry the old node forward and pin the previous crop on screen until
			// something else forced a full render.
			const portraitOf = (root) => root?.querySelector(".stonetop-portrait-slot img");
			const oldImg = portraitOf(this.element?.[0]);
			const oldSrc = oldImg?.getAttribute("src");
			const oldStyle = oldImg?.getAttribute("style") ?? "";
			// The art hover preview is a document.body singleton, so a re-render while the
			// cursor is over a card's art tears out the anchor without firing mouseleave —
			// clear it up front so no orphaned floating preview is left stuck on screen.
			removeAvatarPreview();
			await super._render(force, options);
			const newImg = portraitOf(this.element?.[0]);
			if (oldImg && newImg
				&& oldSrc === newImg.getAttribute("src")
				&& oldStyle === (newImg.getAttribute("style") ?? "")) {
				oldImg.title = newImg.title;
				oldImg.alt = newImg.alt;
				newImg.replaceWith(oldImg);
			}
			this._injectHeaderToggle();
			this.element[0]?.classList.toggle("stonetop-edit-mode", this._editMode);
			stampLayoutClass(this, "character");
			this._stampPastDeath();
			// Deferred one-shot: switch to a named tab after the re-render that puts it there — a
			// dropped card's Arcana tab (_onDropItemCreate), the Post-Death tab a fate is about to
			// be chosen on (_onPostDeathTabOpen). Instance-scoped so a sibling sheet's render can't
			// consume it, and cleared BEFORE the activate so a throw can't leave it armed.
			if (this._activateTabOnRender) {
				const tab = this._activateTabOnRender;
				this._activateTabOnRender = null;
				this._tabs?.[0]?.activate?.(tab);
			}
		}

		/**
		 * A sheet past the Last Door wears the Death's Door black — see "the sheet of someone who
		 * came back" in stonetop.css. All four kinds: the three inserts, which say every session
		 * that this isn't the person it used to be, and a plain death, which takes the base grey
		 * with no wash over it because nothing brought them back.
		 *
		 * Read off the flags rather than the render context so it survives a re-render that
		 * doesn't rebuild the context, and stamped on the ROOT so the frame and title bar turn
		 * over with the body — same reasoning as the dialog's moods. Read THROUGH the character
		 * rather than off the actor's flags directly, so the flag paths stay named in one place.
		 */
		_stampPastDeath() {
			const root = this.element?.[0];
			if (!root) return;
			// The class PAIR comes from pastDeathClasses, which owns the naming so the sheet frame
			// and the dialogs opened from it (_pastDeathWindowClasses) can never disagree about
			// which tint the paper takes. Rebuilding `stonetop-past-death--${kind}` here made that
			// one decision two.
			// Every kind is cleared and only what this character is now goes back on, so one raised
			// out of `dead` (or handed an insert) doesn't keep the modifier of what they used to be.
			root.classList.remove("stonetop-past-death",
				...PAST_DEATH_KINDS.map(k => `stonetop-past-death--${k}`));
			root.classList.add(...pastDeathClasses(this._pastDeathKind()));
		}

		/** What this character is past the Door: an insert slug, "dead", or null. */
		_pastDeathKind() {
			return pastDeathKind({
				state:      this._stonetopCharacter.deathsDoorState,
				insertSlug: this._stonetopCharacter.postDeathSlug,
			});
		}

		/**
		 * Window classes for a dialog opened FROM this sheet, carrying the same black if the
		 * character came back wearing an insert. A move played out of a black sheet used to open a
		 * bone-parchment window on top of it, which read as someone else's move: the sheet, the
		 * dialog and the chat card it posts are one action and should be one surface.
		 *
		 * Takes the window's own classes rather than being spread onto them by the caller, because
		 * AppV1 REPLACES an array option instead of merging it — a dialog handed `classes` loses the
		 * ones its defaultOptions declared, and for our windows that includes the bare `stonetop`
		 * that draws all of the chrome.
		 */
		_pastDeathWindowClasses(base = []) {
			return [...base, ...pastDeathClasses(this._pastDeathKind())];
		}

		/**
		 * Pack every grid matching `selector` and keep it packed, registering the wiring so one
		 * teardown covers every grid (a new grid can't leak an observer by being forgotten here).
		 * Returns the on-demand repack for the callers that have to invalidate the width guard.
		 */
		_wireMasonry(pack, selector, html) {
			const wiring = wireMasonry(pack, html[0].querySelectorAll(selector));
			this._masonries.push(wiring);
			return wiring.repack;
		}

		async close(options) {
			this._masonries?.forEach(m => m.disconnect());
			this._movePanel?.remove();
			this._movePanel = null;
			// The art hover preview lives on document.body, so it survives the sheet's DOM
			// being torn down — clear it or it orphans if the sheet closes (e.g. Escape) while
			// the cursor is still over a card's art and no mouseleave ever fires.
			removeAvatarPreview();
			return super.close(options);
		}

		_injectHeaderToggle() {
			// Shared with the steading, NPC and monster sheets — see utils/sheet-chrome.js. The
			// hand-rolled copy this replaced bailed on `!this.isEditable`, so a character opened
			// from a compendium showed no toggle and no reason why; the shared one draws a lock
			// that explains it.
			injectHeaderToggle(this, "Character", { lockLabel: "Lock Sheet" });
		}

		/**
		 * Repaint once `work` settles, and surface a failed write instead of dropping it.
		 *
		 * A dozen handlers below share the shape "write to the actor, then re-render". Written
		 * as a bare `.then(() => this.render(false))` the rejection went nowhere: the repaint
		 * never ran, so the sheet kept showing the state the player had been told they were in —
		 * the arcanum they just "revealed", the insert they just "chose" — with nothing in the
		 * console and nothing on screen to say otherwise.
		 *
		 * The render runs on the failure path TOO, deliberately: falling back to what actually
		 * stored is the whole point, and it is what makes the optimistic DOM honest again.
		 */
		_renderAfter(work) {
			return Promise.resolve(work)
				.catch(err => {
					console.error("Stonetop | character sheet write failed", err);
					ui.notifications?.error("That change could not be saved. The sheet has been refreshed.");
				})
				.finally(() => this.render(false));
		}

		// Jump to this character's page in the shared "Player Introductions" Chronicle
		// journal (see utils/chronicle.js for the seeding/notice behaviour).
		_openChroniclePage() {
			return openChroniclePageForActor(this.actor);
		}

		_openLedgerDialog() {
			openLedgerDialog(this.actor, CharacterLedger);
		}

		_getHeaderButtons() {
			const buttons  = super._getHeaderButtons().filter(b => b.class !== "configure-sheet");
			const steading = this._stonetopCharacter?.getSteadingActor();
			buttons.unshift({
				label:   steading?.name ?? "",
				class:   "stonetop-open-steading" + (steading ? "" : " stonetop-open-steading--unset"),
				icon:    "fas fa-map-marker-alt",
				onclick: () => {
					if (steading) steading.sheet.render(true, { focus: true });
					else ui.notifications.warn(game.i18n.localize("stonetop.steading.notLinked"));
				},
			});
			buttons.unshift({
				label:   game.i18n.localize("stonetop.newCharacter.buttonLabel"),
				class:   "stonetop-new-character",
				icon:    "fas fa-user-plus",
				onclick: () => this._onNewCharacter(),
			});
			const steadingIdx = buttons.findIndex(b => b.class?.startsWith("stonetop-open-steading"));
			buttons.splice(steadingIdx + 1, 0,
				{
					label:   "Ledger",
					class:   "stonetop-ledger-button",
					icon:    "fas fa-scroll",
					onclick: () => this._openLedgerDialog(),
				},
				{
					label:   "Chronicle",
					class:   "stonetop-chronicle-button",
					icon:    "fas fa-book",
					onclick: () => this._openChroniclePage(),
				},
			);
			return buttons;
		}

		/**
		 * Every move name this character owns, built ONCE per render.
		 *
		 * Three places in a single repaint ask the same question of the same items — the header
		 * glyphs, the crew's Shield-Wall check, and the per-card "exceptional" gate — from three
		 * different methods, and each answering for itself was three full walks of the collection.
		 * The cache is dropped at the top of getData rather than kept on the sheet, so a move
		 * added between renders is seen: it is a within-one-pass memo, not a lifetime one.
		 */
		_ownedMoveNames() {
			return (this._ownedMoveNameCache ??= ownedMoveNames(this.actor));
		}

		async getData() {
			this._ownedMoveNameCache = null;
			const context = await super.getData();
			context.system ??= this.actor.system;
			context.isCharacter = this.actor.type === "character";
			// The viewer reaches the snapshot because a hidden artifact's tags are concealed
			// while it's built, not while it's rendered (Book I p.430) — the GM sees what they
			// wrote, nobody else does, and the withheld text never enters the DOM.
			// `isGM` comes back ON the snapshot (it drives the GM-only artifact control on each
			// gear row), from the same `viewerIsGM` the concealment reads — one fact, told once.
			context.stonetop = await this._stonetopCharacter.buildSnapshot({ viewerIsGM: game.user.isGM });
			// Notes tab: raw source (for the editor to serialize) + enriched HTML (for
			// the read-only preview, resolving @UUID links, inline rolls, etc.).
			context.stonetop.notes = this.actor.system?.notes ?? "";
			context.stonetop.enrichedNotes = context.stonetop.notes
				? await foundry.applications.ux.TextEditor.enrichHTML(context.stonetop.notes)
				: "";
			context.stonetop.movelist ??= {};
			// Kept for the name-click, which needs a move's SOURCE text to build its card and
			// cannot read it off an item: a playbook move you have not taken is rendered from
			// this list and owns no document. Held from the render that drew the rows, so what
			// the card is built from is exactly what the reader clicked on.
			this._renderedMovelist = context.stonetop.movelist;
			const overageKey = context.stonetop.movelist.levelMovesOverageKey ?? null;
			const dismissedOverageKey = this.actor.getFlag(STONETOP_SCOPE, "moves.dismissedLevelOverage");
			context.stonetop.movelist.showLevelMovesOverLimit =
				!!context.stonetop.movelist.levelMovesOverLimit && overageKey !== dismissedOverageKey;
			// Per-section edit flags: a section is editable when the global wrench is
			// on OR its own pencil is toggled.
			const sectionEdit = section => this.isSectionEditable(section);
			context.stonetop.statsNoteDisplay = sectionEdit("stats") ? context.stonetop.playbook?.statsNote ?? null : null;
			context.stonetop.movelist.startingMovesNoteDisplay = sectionEdit("moves") ? context.stonetop.movelist.startingMovesNote ?? null : null;
			// Sidebar move groups default to expanded; a group is open unless this
			// user collapsed it (persisted per-actor in _collapsedMoveSections).
			const collapsedMoves = this._collapsedMoveSections ?? new Set();
			context.stonetop.movesOpen = {
				basicMoves:      !collapsedMoves.has("basicMoves"),
				expeditionMoves: !collapsedMoves.has("expeditionMoves"),
			};
			// Arcana sections (Major / Minor arcanum) default to expanded; a section is
			// open unless this user collapsed it (persisted in _collapsedArcanaSections).
			const collapsedArcana = this._collapsedArcanaSections ?? new Set();
			context.stonetop.arcanaOpen = {
				major: !collapsedArcana.has("arcanaMajor"),
				minor: !collapsedArcana.has("arcanaMinor"),
			};
			// The write-up on a gear row folds, and unlike the sections above it defaults SHUT
			// (a treasure carries the book's whole sidebar, several paragraphs down a column of
			// one-line rows), so we stamp the rows this user has OPENED. Every list the two row
			// partials draw from is here; the rows the equipment tab writes out by hand (the
			// two-column grid, possession gear) render no write-up, so they have none to fold.
			const openLore = this._expandedItemLore ?? new Set();
			const outfit   = context.stonetop.inventory?.outfit ?? {};
			const loreRows = [
				...(outfit.regularItems ?? []),
				...(outfit.smallItems ?? []),
				...(outfit.treasureRegular ?? []),
				...(outfit.treasureSmall ?? []),
				...(outfit.regularSegments ?? []).flatMap(seg => seg.items ?? []),
			];
			for (const row of loreRows) {
				if (row?.artifact?.lore) row.artifact.loreExpanded = openLore.has(row.ownedId);
			}
			// Whether the whole moves sidebar is collapsed (defaults to expanded),
			// persisted per-actor, per-user.
			context.stonetop.sidebarCollapsed = getSidebarCollapsed(this.actor?.id);
			// Which layout this user reads this sheet in: the pre-rail one (stat block pinned
			// above a horizontal tab strip) or today's. Client-scoped and per sheet type — see
			// isClassicLayout in module/settings.js. The nav-item partial reads this same key
			// off whichever sheet's context it lands in, which is why all three sheets name it
			// `stonetop.classicLayout` with no sheet suffix.
			context.stonetop.classicLayout = isClassicLayout("character");
			context.stonetop.hideUnselected = this.actor.getFlag(STONETOP_SCOPE, "hideUnselected") ?? true;
			// "Organize by category": whether the Playbook Moves section heads each of the
			// playbook's three onboarding clusters, or draws one flat owned / un-owned list.
			// Defaults to ON — the clusters are how the section has always read, and the
			// toggle exists to get back to the flat list, not to opt into the split.
			context.stonetop.groupMovesByCategory =
				this.actor.getFlag(STONETOP_SCOPE, "groupMovesByCategory") ?? true;
			context.stonetop.editMode = this._editMode;
			context.stonetop.canEdit = this.isEditable;
			// The header portrait and the two pips over it, answered once for all three sheets
			// that draw them (utils/actor-portrait-picker.js). Framed if this character's face has
			// been cropped — the same square the steading roster, the relationship rows and the
			// token now show, just larger. Without this, framing your own PC changed every surface
			// in the system EXCEPT the sheet you framed it on. `framed` picks the markup: an
			// unframed portrait stays the bare <img> it has always been, so nothing about the
			// common case moves. The whole picture is still one click away, in the portrait window.
			// The stored img rather than a stripped one, so an art-less character still draws the
			// placeholder it is wearing.
			Object.assign(context.stonetop, headerPortraitContext(this, this.actor.img));
			context.stonetop.detailsEdit = {
				background: sectionEdit("background"),
				instinct:   sectionEdit("instinct"),
				appearance: sectionEdit("appearance"),
				origin:     sectionEdit("origin"),
				lore:       sectionEdit("lore"),
				relationships: sectionEdit("relationships"),
			};
			// Play mode is a fair copy of the sheet: a Details section the player never
			// filled in would be a bare heading and a pencil, so drop it entirely. Edit
			// mode (the wrench, or the section's own pencil) always shows it — that's how
			// an empty section gets filled in, and the wrench is the way back to a hidden one.
			const pb = context.stonetop.playbook;
			const detailsFilled = {
				lore:       !!pb?.lore?.hasReadonlyContent,
				background: !!(pb?.background?.selected && pb.background.options?.some(o => o.selected)),
				// An insert's Instinct replaces the playbook's, and it is what this section reads
				// out — so it counts as filled even for a character whose playbook Instinct was
				// never set, who would otherwise choose one at Death's Door and see no sign of it.
				instinct:   !!pb?.instinct?.hasSelection
				         || !!context.stonetop.postDeathInsert?.activeInsert?.instinct?.selected,
				appearance: !!pb?.appearance?.summary,
				origin:     !!(pb?.origin?.selected && pb.origin.selectedOption),
			};
			context.stonetop.detailsShow = Object.fromEntries(Object.entries(detailsFilled)
				.map(([section, filled]) => [section, filled || context.stonetop.detailsEdit[section]]));
			const relRows = this._buildRelationshipRows();
			const relEditing = context.stonetop.detailsEdit.relationships;
			context.stonetop.relationships    = relEditing ? relRows : relRows.filter(r => r.shown);
			context.stonetop.hasRelationships = context.stonetop.relationships.length > 0;
			// Everyone is unticked: say so, and point at the pencil — otherwise a section
			// with candidates reads identically to a world with nobody in it.
			context.stonetop.relationshipsAllHidden = !context.stonetop.hasRelationships && relRows.length > 0;
			// Table or standings board, remembered per table in localStorage beside the
			// column widths — a reading preference, not world data.
			context.stonetop.rel = relationshipViewContext("characterRelationships", context.stonetop.relationships);
			context.stonetop.statsEdit       = sectionEdit("stats");
			context.stonetop.movesEdit       = sectionEdit("moves");
			context.stonetop.possessionsEdit = sectionEdit("possessions");
			context.stonetop.invocationsEdit = sectionEdit("invocations");
			// The two Arcana sections (Major / Minor) each get their own pencil, like every
			// other section. The per-tier "Create arcanum" buttons live at the foot of their
			// own section (gated on canCreateArcana, in and out of edit mode) — see tab-arcana.hbs.
			context.stonetop.arcanaEdit = {
				major: sectionEdit("arcanaMajor"),
				minor: sectionEdit("arcanaMinor"),
			};
			context.stonetop.followersEdit   = sectionEdit("followers");
			context.stonetop.showRollStatChips = getRollStatChipsSetting();
			// Whether the sidebar draws the sticky Roll Modifier selector at all. Off means the
			// pre-roll window is asking instead (RollDialog.js), and two controls answering one
			// question is how a player ends up rolling with an Advantage they cannot see.
			context.stonetop.showRollModeControl = !getAskRollModeEachRollSetting();
			// The Preferences tab: this PLAYER's client settings, grouped, with each row's label,
			// hint and control shape read off its registration rather than restated. Built fresh
			// every render so a value changed in Foundry's settings menu (or on another sheet's
			// copy of this tab) is what the tab draws. Not gated on `editable`: none of it is
			// actor data, so a player reading a locked sheet still owns their own font size.
			//
			// It IS gated on whose character this is (`showsPreferencesTab`). The settings behind
			// it are the reader's own wherever they are changed from, so the tab belongs on the
			// one sheet that is theirs: a GM opening a player's character found their OWN font
			// size sitting on it, reading as the player's. A GM's copy is wherever their own
			// `user.character` points — the GM Toolkit for a full GM, and this very sheet for an
			// assistant gamemaster who also plays a character at the table.
			//
			// Nothing is built for a reader who is not being offered the tab: the rows come from
			// `game.settings` on every render, and this sheet re-renders often.
			context.stonetop.showPreferences = showsPreferencesTab(this.actor);
			context.stonetop.preferences = context.stonetop.showPreferences ? buildPreferenceGroups() : [];
			// The tab carries the active insert — and, when there isn't one, the "Choose Your Fate"
			// picker, which is the manual route for a table who resolved Death's Door away from the
			// sheet. Edit mode is NOT reason enough to draw it: a tab about being dead would open on
			// every living character whose player touches the wrench. So the empty tab needs a
			// reason, and there are three, all meaning "a fate is being decided for this character":
			//
			//   · they had an insert and it was just removed (setPostDeathInsert requests the tab,
			//     since the picker is the whole point of removing one), until Remove Post-Death Tab
			//     takes it back;
			//   · the Death's Door card's own "Choose Your Fate" asks for it — which is what makes
			//     the picker reachable AT ALL for the case its hint text describes, a table who
			//     resolved the Door in conversation and left no state behind for the rule below to
			//     fire on. Same flag, so the tab's foot still takes it away again; and
			//   · they are through the Last Door or owe a fate for it right now.
			//
			// A worn insert answers on its own and outranks all three.
			const pdState = this._stonetopCharacter.deathsDoorState;
			const pdFateOwed = pdState === DEATHS_DOOR_STATE.FATE_PENDING || pdState === DEATHS_DOOR_STATE.DEAD;
			// Stepped through the Last Door and took no insert. The header says so in a tag beside
			// the playbook, because the black paper alone can't tell that apart from the three
			// returns — and "The Heavy" with nothing else on the line is exactly what a character
			// who is still being played looks like.
			context.stonetop.isDead = pdState === DEATHS_DOOR_STATE.DEAD;
			context.stonetop.showPostDeath = !!context.stonetop.postDeathInsert?.activeSlug
				|| (context.stonetop.editMode && (!!this._stonetopCharacter.postDeathTabRequested || pdFateOwed));
			// Whether the tab's foot offers to send it away. Only while the REQUEST is the only thing
			// holding it open: a character who is through the Last Door or owes a fate for it has a
			// tab that pdFateOwed re-draws on the next render, so the button wrote nothing (the flag
			// it clears is already unset) and the tab came straight back — a control that could never
			// do what it says for the very characters most likely to press it.
			context.stonetop.canHidePostDeathTab = !pdFateOwed;
			// Built for its write-in rows alone. The tab used to carry a button into the chooser,
			// labelled with what was still outstanding; that went, and the label / count / flag it
			// needed went with it. The full view model is still what the rows are derived from, so
			// this stays a build rather than a narrower query.
			//
			// Who the Terrible Purpose is about, what a Revenant with STRANGE APPETITES eats: free
			// text hung off a pick, with no box on the printed insert, so it would otherwise live
			// only inside the window that collected it.
			//
			// `open` decides ask-or-print, on exactly the rule postDeathInstinctOpen uses below:
			// edit mode, or an answer that has never been given. Death's Door's chooser is a
			// one-shot step and three routes to an insert (its own advice to finish on this tab,
			// the Choose Your Fate buttons, an Item drop) never pass through it, so a question left
			// unanswered has to stay askable here or it can never be answered at all.
			// Gated on the tab actually being drawn. This is the most expensive thing in getData for
			// an undead character — four steps' worth of sectionOptions plus the Instinct list, each
			// reaching the insert repository — and it was being paid on EVERY render: every hit point,
			// every checkbox, every flag write, every follower-sweep re-render, whether or not the one
			// template that reads it was on screen. `showPostDeath` is the same condition character.hbs
			// puts on both the tab button and the panel, so nothing can consume this when it is false.
			const pdChoices = context.stonetop.showPostDeath
				? await buildPostDeathChoices(this._stonetopCharacter)
				: null;
			context.stonetop.postDeathChoices = pdChoices ? {
				writeIns: choiceWriteIns(pdChoices).map(row => ({
					...row,
					open: !!context.stonetop.editMode || !String(row.value ?? "").trim(),
				})),
			} : null;
			// Suffix for the tab's radio `name`s. Radio grouping is document-global, so two undead
			// PCs' sheets open at once would otherwise share one group and a click on either would
			// clear the other's answer — the same reason the chooser partial carries `choices.group`.
			context.stonetop.postDeathRadioGroup = this.actor?.id ?? "";
			// Whether the tab prints the Instinct as a QUESTION rather than as an answer. Open in
			// edit mode, as it always was — and open, in ordinary play, while it has never been
			// answered at all. That second case used to be a dead end: the tab said "turn on edit
			// mode to choose one" and the chooser button beside it was the way nobody had to. With
			// the button gone, a character whose Death's Door was resolved away from the sheet had
			// no route to their own Instinct.
			//
			// Deliberately NOT open once an answer exists: changing one is an edit, and the
			// playbook Instinct on the Details tab has always drawn the line in the same place.
			context.stonetop.postDeathInstinctOpen = !!context.stonetop.editMode
				|| !context.stonetop.postDeathInsert?.activeInsert?.instinct?.selected;
			// The heading is the same heading either way — same title, same fold id — so it is
			// printed once and only its note changes. Resolved here because Handlebars can't pick
			// between two partial arguments without printing the whole call twice, and the two
			// copies then drift (a retitled section that folds under two different ids).
			context.stonetop.postDeathInstinctNote = context.stonetop.postDeathInstinctOpen
				? game.i18n.localize("stonetop.character.selection.chooseOne") : "";
			// Mirror computed vitals back onto system attributes for the sheet's inputs.
			// HP-max is playbook-derived, so it only applies with a playbook — keeps
			// onboarding-built characters from showing the stale template default. Damage
			// mirrors whenever there is a die to show, since a hand-set override stands
			// without a playbook behind it.
			const v = context.stonetop.vitals;
			const vitalsToSystem = {
				"attributes.armor.value": v.armor,
				"attributes.xp.max":      v.xp.max,
				...(context.stonetop.playbook ? { "attributes.hp.max": v.hp.max } : {}),
				...(v.damage ? { "attributes.damage.value": v.damage } : {}),
			};
			for (const [path, value] of Object.entries(vitalsToSystem)) {
				foundry.utils.setProperty(context.system, path, value);
			}
			// Kept for the post-render mirror (_syncStoredMaxHp). That write needs the computed max
			// and this is the one place it has already been worked out — asking for it again would
			// rebuild the whole snapshot on every render. 0 means "no playbook, nothing to mirror".
			this._computedMaxHp = context.stonetop.playbook ? v.hp.max : 0;
			// A permanent max-HP change (an arcanum's soul-wound, a Mark's boon) is otherwise
			// invisible once applied — the field just shows a number that disagrees with the
			// playbook. Marked and spelled out here so a GM reading the sheet months later can
			// see there IS one and how big it is, rather than suspecting a stale value.
			const hpAdjust = context.stonetop.playbook ? v.hp.max - v.hpBase : 0;
			context.stonetop.hpMaxAdjusted = hpAdjust !== 0;
			context.stonetop.hpMaxNote = hpAdjust
				? `Max HP ${hpAdjust > 0 ? "+" : "−"}${Math.abs(hpAdjust)} permanently (your playbook gives ${v.hpBase}). Type a new max to change it, or ${v.hpBase} to clear it.`
				: (context.stonetop.editMode ? "Type a new max to change it permanently. The difference is kept as you level." : "");
			// Followers tab — build data from flags + playbook definition.
			// Pass smallItemLimit from the already-computed snapshot so crew gear
			// uses the exact same prosperity value as outfit inventory items.
			const playbookDoc = await this._stonetopCharacter.playbook();
			// Moves that grant a possession sub-choice (Big Magic → sacred-pouch trait):
			// move name → possession slug, so those move cards show an "edit" affordance.
			context.stonetop.possessionTriggerMoves = this._stonetopCharacter.possessionTriggerMoves(playbookDoc);
			const selections = playbookDoc ? this._readSelectionsFromActor(playbookDoc) : null;
			context.stonetop.hasIncompleteBackgroundQuestions = playbookDoc
				? CharacterOnboardingDialog.hasIncompleteQuestions(playbookDoc, selections)
				: false;
			if (CONFIG.debug?.stonetop) {
				this._logOnboardingQuestionDiagnostics(
					CharacterOnboardingDialog.questionCompletionDiagnostics(playbookDoc, selections),
				);
			}
			const crewStats               = context.stonetop.crewBonuses ?? { memberHp: 6, armor: 0, damageDie: "d6", rollMod: 1 };
			const companionBonuses        = context.stonetop.companionBonuses ?? { hp: 0, armor: 0, traitPicks: 0 };
			context.stonetop.followers    = this._buildFollowersData(playbookDoc, context.stonetop.inventory?.smallItemLimit ?? null, crewStats, companionBonuses);
			context.stonetop.hasFollowers = !!(
				context.stonetop.followers.animalCompanion ||
				context.stonetop.followers.crew ||
				context.stonetop.followers.initiates?.length ||
				context.stonetop.followers.beasts?.length ||
				context.stonetop.followers.custom?.length
			);
			// Owners can always reach the tab (even with no followers yet) so they can
			// run the Create-a-Follower walkthrough or drop a monster to convert it;
			// non-owners only see it once the character actually has followers. The
			// add/convert controls themselves are gated on editability.
			context.stonetop.showFollowersTab = context.stonetop.hasFollowers || this.isEditable;
			context.stonetop.canAddFollower   = this.isEditable;
			// Universal "Follower Special Moves" (same for every character), rendered
			// read-only from the follower-moves items via their build export.
			context.stonetop.followerSpecialMoves = FOLLOWER_MOVES;
			// The Ranger's Animal Companion insert carries its own special move (Loyal
			// to the End, p.143) — not universal, so it shows only when a beast-bonded
			// Ranger actually has a companion.
			context.stonetop.animalCompanionMoves = context.stonetop.followers.animalCompanion
				? (playbookDoc?.animalCompanion?.moves ?? [])
				: [];
			context.stonetop.hasArcana = !!(
				context.stonetop.arcana?.minor?.hasOwned ||
				context.stonetop.arcana?.major?.hasOwned
			);
			// Decorate summoning arcana (those whose reverse "Treats it/them as a
			// follower") with what the "Add as follower" button needs: its label and
			// whether the creature(s) are already on the Followers tab (matched by the
			// stable sourceUuid marker). See module/data/arcana-summons.js.
			const summonedUuids = new Set(
				Object.values(this.actor.getFlag(STONETOP_SCOPE, "customFollowers") ?? {})
					.map(f => f?.sourceUuid).filter(Boolean)
			);
			// Per-card arcana back visibility. Two independent things gate whether the back
			// panel renders beside the front: PERMISSION (may this viewer see the back at
			// all) and the per-card "show both" toggle (a view preference, default off, so
			// cards read front-only until spread). Permission: the GM always may. The card's
			// OWNER may once it's UNLOCKED — filling every unlock spot earns the back, no
			// setting required. The world setting arcanaPlayersSeeBothSides is a separate
			// "peek" switch: when on, players may open the back of a card they HAVEN'T unlocked
			// yet (an open table that lets you read the whole card); when off, an un-earned
			// back stays hidden until the GM reveals that specific card. The toggle is an
			// edit-mode, PER-USER preference — stored on the viewing user (not the actor), so
			// the GM's spread choices are independent of the owning player's and each client
			// renders its own. It persists so a spread stays open while reading in play mode,
			// and can never expose a back the viewer isn't permitted to see. canReveal drives
			// the GM-only reveal toggle, meaningful only in secretive mode for a still-LOCKED
			// card. isSpread marks a card that renders both sides, laid out full-width by the
			// masonry. See settings.js and tab-arcana.hbs.
			const playersSeeBothArcana = game.settings.get(STONETOP_SCOPE, "arcanaPlayersSeeBothSides");
			const viewerIsGM           = game.user.isGM;
			// True when the viewing user owns this actor (GMs own everything, but they're
			// already covered by viewerIsGM). An unlocked back is the owner's earned reward,
			// so it's shown to the owner regardless of the world setting.
			const viewerOwnsActor      = this.actor.isOwner;
			const revealedArcana       = this._stonetopCharacter.revealedArcanaSlugs;
			// Keyed by actor id since one user (esp. the GM) may view several character sheets.
			const showBothArcana       = new Set(
				(game.user.getFlag(STONETOP_SCOPE, "arcanaShowBoth") ?? {})[this.actor.id] ?? []
			);
			// The single-side flip (front ⇄ back) is a second, independent per-user view
			// preference, stored the same way. It only takes effect when the card isn't
			// already laid open as a spread (show-both wins), and never on a card whose back
			// this viewer isn't permitted to see.
			const showBackArcana       = new Set(
				(game.user.getFlag(STONETOP_SCOPE, "arcanaShowBack") ?? {})[this.actor.id] ?? []
			);
			for (const [section, sectionEditable] of [
				[context.stonetop.arcana?.major, context.stonetop.arcanaEdit.major],
				[context.stonetop.arcana?.minor, context.stonetop.arcanaEdit.minor],
			]) {
				const collapsedCards = this._collapsedArcanaCards ?? new Set();
				for (const item of (section?.items ?? [])) {
					// Card footers (Remove / reveal / show-both) show when this card's section
					// is editable — via the global wrench or that section's own pencil.
					item.sectionEditable   = sectionEditable;
					// Whether this user left this card clamped (persisted).
					item.collapsed         = collapsedCards.has(item.slug);
					// Collapsed preview: the front description's lead — its first paragraph
					// (the flavor text before the mechanics). Shown in place of the full body
					// when the card is collapsed, on every view including a back-only flip
					// (where the front panel isn't otherwise rendered). Strip any injected
					// track inputs so the preview stays a clean, read-only snippet.
					const frontLead        = item.front?.description?.match(/<p\b[^>]*>[\s\S]*?<\/p>/i);
					item.frontLead         = frontLead ? frontLead[0].replace(/<input\b[^>]*>/gi, "") : "";
					const revealed         = revealedArcana.has(item.slug);
					// Owner sees a back they've unlocked (earned, no setting needed) or one the GM
					// has revealed to them; both are owner-scoped, so a non-owning viewer (e.g. an
					// Observer-permission player) never sees another character's hidden back. The
					// world setting is the separate peek switch: on → any player may open the back
					// without unlocking it. Otherwise a locked back waits on the GM's reveal.
					const permittedBack    = viewerIsGM || playersSeeBothArcana
						|| (viewerOwnsActor && (revealed || item.unlocked));
					item.showBoth          = showBothArcana.has(item.slug);
					item.showBack          = showBackArcana.has(item.slug);
					const spread           = permittedBack && item.showBoth;
					// Back-only: the viewer flipped this card to its reverse. Suppressed while
					// spread (both already shown). Front hides only in this single-side view.
					const backOnly         = permittedBack && !spread && item.showBack;
					item.frontVisible      = !backOnly;
					item.backVisible       = spread || backOnly;
					item.isSpread          = item.identified && spread;
					// Surface the back's Consequences onto the front (Hec'tumel / Redwood) only
					// when the front is the sole visible side — in a spread or a back-only flip the
					// back panel already carries the section, so we don't want a second copy. The
					// snapshot only sets item.consequences for the front-referencing cards.
					item.showFrontConsequences = !!item.consequences && item.frontVisible && !item.backVisible;
					item.revealedToPlayers = revealed;
					// The GM's reveal toggle only matters in secretive mode (setting off) for a
					// still-LOCKED back: an unlocked back is already seen by its owner, and with
					// the setting on every player can peek anyway.
					item.canReveal         = viewerIsGM && !playersSeeBothArcana && !item.unlocked;
					// The show-both toggle is only meaningful when the viewer may see the back.
					item.canToggleBoth     = permittedBack;
					// The flip button shows whenever the back is permitted and the card isn't
					// already a spread (nothing to flip when both sides are open).
					item.canFlip           = permittedBack && !spread;
					// Book I p.440: handing a card over without a roll is the GM's move ("just
					// give the player(s) the card and have them read it, front and back"). The
					// player's own route to a face-down card is the Know Things roll.
					item.canGiveCard       = viewerIsGM;
					// The 7-9 debt ("show them the back when they have some time to study it or
					// learn more"). Each side sees the half of it they can act on:
					//
					//  · the OWNER, while the back is still withheld from them. Scoped to the owner
					//    and not merely to "may not see the back", because a non-owning viewer (an
					//    Observer-permission player on somebody else's sheet) fails permittedBack
					//    too — and the strip addresses its reader in the second person over a
					//    "Study it" button that _onArcanumStudyBack drops on the spot (!isEditable).
					//  · the GM, while the back is still theirs to hand over — which is a question
					//    about the OWNER's access, not the viewer's, so it can't reuse permittedBack.
					//    An unlocked or already-revealed back is the owner's for keeps and owes them
					//    nothing. Pointedly NOT narrowed to canReveal, though: that carries a
					//    `!playersSeeBothArcana` term, and revealArcanum is the only thing that ever
					//    clears backOwed — so with the world's peek switch on the debt was stranded
					//    with nobody able to settle it, to resurface the day the switch went off as a
					//    claim about a back the player read sessions ago. Granting it is a real write
					//    even while everyone can already peek: it is what closes the record.
					item.showBackOwed      = item.backOwed && !permittedBack && viewerOwnsActor;
					item.gmBackOwed        = item.backOwed && viewerIsGM && !revealed && !item.unlocked;

					// The plain "Add as follower" button manifests only the directly-summoned
					// followers. `viaCallUp` followers (the Ring of Daagon's Servants) are rolled
					// and shaped through the Call Up the Deep Ones dialog on the Ring's follower
					// card instead, so they're excluded here — the Ring's button adds just the Ring.
					const followers = (item.summonFollowers ?? []).filter(f => !f.viaCallUp);
					if (!followers.length) continue;
					const names   = joinNames(followers.map(f => f.name));
					const plural  = followers.length > 1;
					// A repeatable follower (the Ring's Servants) can always be summoned
					// again, so the button never reads "added" / disables while one exists.
					const hasRepeatable = followers.some(f => f.repeatable);
					const addedAll = !hasRepeatable && followers.every(f => summonedUuids.has(f.sourceUuid));
					item.summon = {
						added: addedAll,
						label: addedAll
							? `${names} ${plural ? "are" : "is"} in your Followers`
							: `Add ${names} as ${plural ? "followers" : "a follower"}`,
					};
				}
			}
			context.stonetop.invocations          = this._buildInvocationsData(playbookDoc);
			// Only when there's something in it — an empty group renders as a bare heading over
			// an empty list, which no other move group does (they all hide themselves when
			// empty). Creating a move doesn't need the section standing by: the "Create a move"
			// button sits outside it, and saving re-renders the sheet with the section present.
			context.stonetop.showOtherMovesSection = !!(context.stonetop.movelist?.otherMoves?.length);
			// Authoring custom moves can be restricted to the GM (world setting). When
			// restricted, players still see/roll existing custom moves but get no "+"
			// button or edit pencils. Existing moves always render regardless.
			context.stonetop.canAuthorCustomMoves = canAuthorCustomMoves();
			// Love letters are GM prep (Book I p.568): only the GM gets the edit/delete
			// affordances on a letter's card. Players read and resolve their own letters.
			context.stonetop.canAuthorLoveLetters = game.user.isGM;
			// Creating homebrew arcana can be restricted to the GM independently of
			// custom moves (arcanaCreationGmOnly). When restricted, players don't see
			// the per-tier "Create arcanum" buttons, but still edit cards they own.
			context.stonetop.canCreateArcana = canCreateArcana();
			const { xp } = context.stonetop.vitals;
			context.stonetop.canLevelUp = xp.value >= xp.max;
			context.stonetop.deathsDoor = this._buildDeathsDoorData(context.stonetop);
			context.stonetop.recover = this._buildRecoverData(context.stonetop);
			context.stonetop.convalesce = this._buildConvalesceData(context.stonetop);
			context.stonetop.woundsView = this._buildWoundsView(context.stonetop.wounds, context.editable);
			// Which of the header glyphs this character has EARNED, all five from one walk of the
			// items — asking each one separately is five to seven traversals of the collection per
			// render, and most sheets own none of these moves and so pay every one in full.
			const ownsGlyph = this._stonetopCharacter.headerGlyphOwnership(this._ownedMoveNames());
			// The header candle. `show` is not just "is a Lightbearer": a LIT light is shown on
			// any sheet, so one stranded by a playbook swap can still be snuffed.
			const holyLit = this._stonetopCharacter.holyLight;
			context.stonetop.holyLight = {
				show: showHolyLight({ owns: ownsGlyph.holyLight, lit: holyLit }),
				lit:  holyLit,
				..._toggleGlyphKeys(HOLY_LIGHT_GLYPH, holyLit, context.editable),
			};
			// And what that light is currently shaped into. In the HEADER, not only on the
			// Invocations tab: the tab is one of nine, an ongoing Invocation lasts until something
			// ends it, and the player who most needs to see it is the one whose sheet is sitting on
			// Moves reaching for the next thing to do.
			context.stonetop.ongoingInvocation = this._ongoingInvocationContext();
			// The header scales, on the same terms: shown once the Judge owns Condemn or Binding
			// Arbitration, and kept on a sheet that no longer does while rows are still standing, so
			// they can be lifted. The two lists are read fresh by the dialog rather than carried
			// through here, since it is the dialog that re-renders when they change.
			//
			// The BADGE is the total of both, because it answers "how much am I holding" at a
			// glance; the tooltip breaks it down. Only the brands turn the glyph red — a brand is a
			// public mark of chaos, an oath is a promise somebody made, and colouring them alike
			// would say the Judge had condemned everyone who ever swore anything.
			const brands = this._stonetopCharacter.condemned;
			const oaths  = this._stonetopCharacter.oaths;
			context.stonetop.condemn = {
				show: showJudgeMarks({
					ownsCondemn: ownsGlyph.condemn, brandCount: brands.length,
					ownsOaths:   ownsGlyph.oaths,   oathCount: oaths.length,
				}),
				count:  brands.length + oaths.length,
				brands: brands.length,
				oaths:  oaths.length,
				// Picked here rather than branched in the template: "2 branded, 0 sworn" is a worse
				// sentence than "2 bearing your brand", and four nested {{#if}}s in an attribute is
				// a worse template. The key is resolved by the `localize` helper, which formats
				// with the hash arguments beside it.
				tooltipKey: _judgeMarksTooltipKey(brands.length, oaths.length),
			};
			// The Heavy's Battle Joy. `raging` is not only a glyph state: it is what greys the three
			// debility boxes out on the Moves tab and what stops them biting in the roll path, so
			// the same read feeds both (see StonetopCharacter#ignoresDebilities).
			const raging = this._stonetopCharacter.battleJoy;
			context.stonetop.battleJoy = {
				show:   showBattleJoy({ owns: ownsGlyph.battleJoy, raging }),
				raging,
				..._toggleGlyphKeys(BATTLE_JOY_GLYPH, raging, context.editable),
			};
			// And the Blessed's marks, on the candle's and the scales' terms exactly.
			const marks = this._stonetopCharacter.blessedMarks;
			context.stonetop.blessedMarks = {
				show:  showBlessedMarks({ owns: ownsGlyph.blessed, count: marks.length }),
				count: marks.length,
				// Picked here for the reason the scales' is, and so that the two COUNT glyphs answer
				// the question the same way — this one had kept an inline template ladder while the
				// scales resolved theirs in JS, which is how the pair drifted apart.
				tooltipKey: marks.length ? "stonetop.blessedMarks.someTooltip" : "stonetop.blessedMarks.noneTooltip",
			};
			// And the other side of it: a brand this character is WEARING. A PC is as Censurable as
			// anyone — Aratis does not exempt the party — and condemnersOf already skips self, so a
			// Judge cannot brand themself into their own header.
			context.stonetop.condemned = condemnedContext(this.actor);
			// Book I, at the end of the playbook row, but ONLY once the GM has pointed this world
			// at a copy. `readyRulebookIcon` answers null until then and the row draws nothing:
			// a player cannot add the file, so the dimmed "press me to fix this" state the GM
			// Toolkit wears would be an icon offering them a window their account refuses. It
			// appears for the whole table the moment the GM sets one.
			//
			// Book I only. Book II is the gazetteer, which is the GM's side of the screen.
			context.stonetop.book = readyRulebookIcon(PLAYER_BOOK);
			return context;
		}

		/**
		 * The Death's Door card's state (Book I p.245). Being at 0 HP is not the whole story:
		 * a 7-9 leaves the character at 0 HP and expressly no longer dying, and once they carry
		 * a post-death insert the move they trigger at 0 HP is their insert's, not this one —
		 * so the card names that move instead of offering a roll the rules don't allow.
		 */
		_buildDeathsDoorData(snapshot) {
			const hp    = snapshot.vitals.hp.value;
			const state = this._stonetopCharacter?.deathsDoorState ?? null;
			// zeroHpMove()'s own fallback is Death's Door, which is also the right answer for a
			// character model that predates these accessors.
			const move  = this._stonetopCharacter?.zeroHpMove ?? zeroHpMove(null);
			const isDeathsDoor = move.dialog;
			const isOutOfAction = state === DEATHS_DOOR_STATE.OUT_OF_ACTION;
			const isDead        = state === DEATHS_DOOR_STATE.DEAD;
			const isFatePending = state === DEATHS_DOOR_STATE.FATE_PENDING;
			const canFace       = isDeathsDoor && !!this._stonetopCharacter?.canFaceDeathsDoor;
			// A dispersed Ghost doesn't merely wake up — they reform at their tether with half
			// their max HP, so the "clear" control is really a reform and says so. The snapshot's
			// max is the computed one (move bonuses, a Thrall's Marks); the persisted attribute is
			// the level-1 number and would understate the reform.
			const reform = isOutOfAction
				? resolvedHp(this._stonetopCharacter?.zeroHpResolution?.disperses, snapshot.vitals.hp.max)
				: null;

			// What's true right now, in the order the card says it: the state they're in wins,
			// and the "which move do I trigger" hint only matters while they're up. Built here
			// rather than as a conditional ladder in the template, like every other special-move
			// card's hint, so a new state is one row rather than two Handlebars chains.
			const l = (key, data) => (data
				? game.i18n.format(`stonetop.specialMoves.deathsDoor.${key}`, data)
				: game.i18n.localize(`stonetop.specialMoves.deathsDoor.${key}`));
			let hint = null;
			if (isDead)             hint = { icon: "fa-door-closed",    text: l("deadHint"),        isState: true };
			else if (isFatePending) hint = { icon: "fa-hourglass-half", text: l("fatePendingHint"), isState: true };
			else if (isOutOfAction) hint = { icon: "fa-bed",            isState: true,
				text: reform ? l("dispersedHint", { hp: reform }) : l("outOfActionHint") };
			else if (!isDeathsDoor) hint = { icon: "fa-skull",          text: l("supersededHint", { move: move.name }) };
			else if (!canFace)      hint = { icon: "fa-lock",           text: l("lockedHint") };

			// The one control the card carries, in the same order. "Choose fate" reopens the
			// dialog on the three fates (the roll is spent); clearing a lingering state is the
			// reform for a Ghost; an insert's own 0-HP move is rolled from the sheet instead.
			let action;
			if (isFatePending)             action = { cls: "stonetop-deathsdoor-open-btn",  icon: "fa-scale-unbalanced", label: l("chooseFate") };
			else if (isOutOfAction || isDead) action = { cls: "stonetop-deathsdoor-clear-btn", icon: "fa-rotate-left",   label: l(reform ? "reform" : "clear") };
			else if (!isDeathsDoor)        action = { cls: "stonetop-deathsdoor-open-btn",  icon: "fa-skull",     label: move.name, disabled: hp > 0 };
			else                           action = { cls: "stonetop-deathsdoor-open-btn",  icon: "fa-door-open", label: l("button"), disabled: !canFace };

			return {
				hint,
				action,
				// Only Death's Door opens the walkthrough, and only while it's actually theirs to
				// face; a 6- awaiting its fate is the other way the card is live, since the roll
				// is spent but the choice isn't made.
				canFace,
				isFatePending,
				// A way OFF `fate-pending` for a table who settled the 6- away from this window —
				// played the fate out in conversation, or retconned the roll entirely. Nothing else
				// walks that state back: nextDeathsDoorState returns it unchanged for every HP
				// change thereafter, so the character is healed, plays on, and is never recognised
				// as dying again, while the card's only control goes on offering "Choose fate".
				// Choosing one is still the ordinary way out, which is why this sits BESIDE that
				// button rather than replacing it, and only in edit mode — the same terms as the
				// Post-Death route below, and for the same reason: whoever is holding the wrench has
				// already said they are changing the sheet.
				clearFate: isFatePending && !!snapshot.editMode,
				// The way to the Post-Death tab for a table who resolved the Door in conversation.
				// That tab is opt-in (showPostDeath), and until this control existed the only thing
				// that ever opted in was REMOVING an insert — so the "Choose Your Fate" picker, whose
				// own hint text advertises it for exactly this case, could not be reached by a
				// character who had never worn one. Offered in edit mode, where whoever is holding
				// the wrench has already said they're changing the sheet, and only while the tab
				// isn't already there.
				openPostDeath: !!snapshot.editMode && !snapshot.showPostDeath,
			};
		}

		// Recover (special move): expend 1 use of supplies, regain HP equal to
		// 4+Prosperity. The benefit is locked after use until the character takes
		// damage again (cleared by the preUpdateActor hook in stonetop.js).
		_buildRecoverData(snapshot) {
			const locked      = !!this.actor.getFlag(STONETOP_SCOPE, "recover.spent");
			const resources   = this.actor.getFlag(STONETOP_SCOPE, "inventory.resources") ?? {};
			// Only what may actually pay for a Recover is counted: a pack full of provisions is
			// not an answer to "can you Recover?" (supply-cost.js, Book I p.89), and counting it
			// here would light the button and then have the dialog refuse it.
			const suppliesLeft = supplyPursesFor(resources, SUPPLY_PURPOSE.RECOVER).total;
			const healAmount  = snapshot.inventory?.smallItemLimit ?? 4;
			const hp          = snapshot.vitals.hp;
			const atFullHp    = hp.value >= hp.max;

			let hint = null;
			if (locked)                 hint = { icon: "fa-lock",                text: game.i18n.localize("stonetop.specialMoves.recover.lockedHint") };
			else if (suppliesLeft <= 0) hint = { icon: "fa-triangle-exclamation", text: game.i18n.localize("stonetop.specialMoves.recover.noSuppliesHint") };
			else if (atFullHp)          hint = { icon: "fa-heart",               text: game.i18n.localize("stonetop.specialMoves.recover.fullHpHint") };

			return {
				locked,
				suppliesLeft,
				healAmount,
				atFullHp,
				hint,
				canRecover: !locked && suppliesLeft > 0 && !atFullHp,
			};
		}

		// Convalesce (homefront move): rest a few days in safety and comfort to
		// recover ALL HP and clear ALL debilities. Unlike Recover there's no supply
		// cost and no once-per-damage lock — it's a downtime move, available whenever
		// there's something to restore (HP below max or any debility marked).
		_buildConvalesceData(snapshot) {
			const hp               = snapshot.vitals.hp;
			const atFullHp         = hp.value >= hp.max;
			const activeDebilities = (snapshot.debilities ?? []).filter(d => d.active);
			const hasDebility      = activeDebilities.length > 0;
			// Convalesce also heals wounds that can heal, and is where permanent injuries
			// get a Make-a-Plan note — so it's available when either is outstanding, even
			// at full HP with no debilities.
			const openWounds       = (snapshot.wounds ?? []).filter(w => !w.healed);
			const canConvalesce    = !atFullHp || hasDebility || openWounds.length > 0;
			return {
				atFullHp,
				hasDebility,
				activeDebilities,
				canConvalesce,
				hint: canConvalesce ? null : { icon: "fa-heart", text: game.i18n.localize("stonetop.specialMoves.convalesce.nothingHint") },
			};
		}

		// Shape the wound snapshot for the sheet block: split the active list from healed
		// "scars", and precompute each row's glyph/label. `show` keeps the whole block out
		// of the DOM when there's nothing to show and no way to add.
		_buildWoundsView(wounds = [], editable = false) {
			const isGM = game.user.isGM;
			const decorate = (w) => {
				// The inline chip shows only the wound text; fold its detail
				// (requirement / plan / lasting tag) into one hover tooltip so
				// nothing is lost in the compact presentation. The template reads
				// only the fields returned below — the folded-in detail lives solely
				// in `tooltip`, so it isn't duplicated onto the view model.
				const planProgress = w.planProgress ?? { done: 0, total: 0 };
				const tip = [];
				if (w.text)            tip.push(w.text);
				if (w.requirementNote) tip.push(`Needs: ${w.requirementNote}`);
				if (w.planNote || planProgress.total) {
					let s = w.planNote ? `Plan: ${w.planNote}` : "Plan";
					if (planProgress.total) s += ` (${planProgress.done}/${planProgress.total} done)`;
					tip.push(s);
				}
				if (w.mechanicalTag)   tip.push(w.mechanicalTag);
				return {
					id: w.id,
					text: w.text,
					status: w.status,
					isDeathsDoor: w.origin === "deaths-door",
					statusLabel: WOUND_STATUS_LABEL[w.status] ?? WOUND_STATUS_LABEL.problematic,
					glyph: WOUND_STATUS_GLYPH[w.status] ?? WOUND_STATUS_GLYPH.problematic,
					tooltip: tip.join(" • ") || w.text || "",
				};
			};
			const visible = wounds ?? [];
			const active = visible.filter(w => !w.healed).map(decorate);
			const scars  = visible.filter(w =>  w.healed).map(decorate);
			return {
				canEdit: editable,
				isGM,
				active,
				scars,
				scarCount: scars.length,
				// The wounds block only renders when there's a wound to show; the
				// "add wound" affordance lives by the HP label (gated by canEdit),
				// so an editable-but-woundless sheet shows no block under the vitals.
				show: active.length > 0 || scars.length > 0,
			};
		}

		/** Opening a card's editor queues its name input to grab focus on the next
		 *  render (see activateListeners). Opening a crew collapsible's editor (or the
		 *  whole Followers tab) also expands that <details> so the controls being
		 *  edited are visible. This expansion is in-memory only (for the current
		 *  render); it is NOT persisted, so entering edit mode never overwrites the
		 *  user's saved collapse preference — only an explicit <details> toggle does. */
		_onSectionEditOpened(section) {
			section ??= "";
			const m = /^follower-card:([^:]*):(.*)$/.exec(section);
			if (m) this._pendingFollowerFocus = `follower-name:${m[1]}:${m[2]}`;
			this._openCrewSections ??= new Set();
			if (section === "followers") this._openCrewSections.add("inventory").add("roster").add("groupFight");
			else if (/^follower-individuals:crew:/.test(section)) this._openCrewSections.add("roster");
		}

		_buildFollowersData(playbookDoc, smallItemLimit = null, crewStats = { memberHp: 6, armor: 0, damageDie: "d6", rollMod: 1 }, companionBonuses = { hp: 0, armor: 0, traitPicks: 0 }) {
			const sf = resolvedFlags(this.actor);
			// Which collapsible crew sections are expanded. Seeded from the persisted
			// per-actor setting in the constructor (so it survives a sheet reopen);
			// the ??= is just a defensive fallback.
			this._openCrewSections ??= new Set();
			// Per-member HP / armor derive from the Marshal's crew bonuses, but a
			// hand-edited override (crew.details.hpMax / .armor — the same flags the
			// shared stat-override layer reads) wins, so the player can adjust the
			// crew as it grows (Updating followers, p.480).
			const _crewOverride = (field) => _intOverrideOrNull(sf.crew?.details?.[field]);
			const crewMaxHp = (_crewOverride("hpMax") ?? crewStats.memberHp ?? 6) || 1;
			// Stash the per-member HP max so the resize/delete handlers can re-clamp
			// the abstracted group-fight pool (crewSize × memberHp) when it shrinks.
			this._crewMemberHpMax = crewMaxHp;
			const crewArmor = _crewOverride("armor") ?? crewStats.armor ?? 0;
			const crewDamageDie = crewStats.damageDie ?? "d6";
			const crewRollMod = crewStats.rollMod ?? 1;
			// Edit state for follower cards. One card-level pencil (top-right of the
			// card) makes the whole body — name, stats, moves, notes, gear — editable
			// at once; it is on when the whole Followers tab is in edit mode (global
			// wrench or the tab's pencil) or that card's own pencil has been opened,
			// tracked as `follower-card:<ftype>:<slug>` in the section-editing mixin.
			// The crew's Roster keeps its own separate pencil (`follower-individuals:…`).
			const followersEditing = this.isSectionEditable("followers");
			const cardEditing = (ftype, slug) =>
				followersEditing || this._editingSections.has(`follower-card:${ftype}:${slug}`);
			const withSectionEdits = (card) => {
				if (!card) return card;
				const { ftype, slug } = card;
				const cardOn = cardEditing(ftype, slug);
				card.edit = {
					card:  cardOn,
					name:  cardOn,
					stats: cardOn,
					moves: cardOn,
					notes: cardOn,
					gear:  cardOn,
					// Roster: governed by its own pencil (or the whole-tab edit), not the card button.
					individuals: followersEditing || this._editingSections.has(`follower-individuals:${ftype}:${slug}`),
				};
				// A face is never behind the card's pencil. It is chosen from a gallery rather
				// than typed, so no stray keystroke can disturb it, and it stays as editable
				// while READING the card as the sheet's own header portrait is while reading
				// the sheet (utils/actor-portrait-picker.js, openActorPortraitFromSheet).
				//
				// What the pencil changes is only what a TAP means, the same split every other
				// portrait in the system makes: with the pencil open — the mode you are in to
				// change things — a tap goes straight to the gallery; reading the card, it
				// ENLARGES the picture instead, because most taps on a face are someone wanting
				// to see it. The window that opens carries "Edit Photo" and "Frame Face" of its
				// own (see _onFollowerPortraitView), so nothing is out of reach either way.
				//
				// A follower with no face yet has nothing to enlarge, so their tap opens the
				// gallery in both modes: an avatar that does nothing when clicked is exactly
				// the state someone most needs it from.
				const canWritePortrait = this.isEditable;
				card.portraitEditable = canWritePortrait && (cardOn || !card.img);
				card.portraitViewable = !!card.img && !card.portraitEditable;
				// The crop pip, drawn in BOTH modes on the terms the header's pips use: real art
				// to frame, and a viewer who may write it. Framing is not an edit-mode act — it
				// is a reading choice about a picture that already exists.
				card.portraitFrameable = canWritePortrait && !!card.img;
				// Its neighbour, for the TOKEN — the same pair, in the same order, a sheet header
				// carries. A follower has a token to make once they exist as an Actor, which is
				// normally the moment they were added (ensureFollowerActors below). Never offered
				// where clicking it would have to CREATE that actor: a card whose actor has been
				// deliberately deleted keeps its stale link and is left alone, and a 20px pip is
				// not the place to quietly overrule that.
				card.portraitTokenizable = card.portraitFrameable && canOpenTokenizer(followerActorFromLink(card));
				// One class drives the cursor and the hover ring for both jobs; the handler
				// decides which by mode. A card with no portrait that nobody may change does
				// nothing, so it gets neither.
				card.portraitInteractive = card.portraitEditable || card.portraitViewable;
				return card;
			};
			// The stat-block editor lets the player override Damage / Instinct / Cost with
			// free text, stored on the same per-follower detail flags as moves/notes (see
			// followerDetailPath). An empty override keeps the rules-derived default; a set
			// Damage override also re-derives its rollable die + parenthetical form.
			// Instinct / Cost are skipped for types that store them structurally (animal
			// companion / crew): those edit the type-root value directly so it can be
			// cleared, instead of layering an override that an empty value can't unset.
			const detailFlagsFor = (ftype, slug) => {
				const base = _followerDetailBase(ftype, slug);
				return base ? (foundry.utils.getProperty(sf, base) ?? {}) : {};
			};
			const withStatOverrides = (card) => {
				if (!card) return card;
				const d = detailFlagsFor(card.ftype, card.slug);
				const has = (v) => v != null && String(v).trim() !== "";
				if (!_followerStructuralPath(card.ftype, "instinct") && has(d.instinct)) card.instinct = d.instinct;
				if (!_followerStructuralPath(card.ftype, "cost")     && has(d.cost))     card.cost     = d.cost;
				if (has(d.damage)) {
					card.damage = String(d.damage).trim();
					const parsed = _parseFollowerDamage(card.damage);
					card.damageForm = parsed.damageForm;
					// Keep the rules-derived rollable die if the override has no die of
					// its own (e.g. a free-text "special"), so the damage roll button —
					// and the crew Group Fight roll — never goes empty.
					if (parsed.damageRoll) card.damageRoll = parsed.damageRoll;
				}
				// Hand-edited Armor / Max HP overrides (Updating followers, p.480: a
				// follower can grow more resilient or better armored). The crew also
				// re-derives crewMaxHp / crewArmor from the same flags up top so its
				// roster + group-fight pool stay in step; here we just apply to the
				// card so every type's stat block + HP box reflect the override.
				if (has(d.armor)) {
					const a = _intOverrideOrNull(d.armor);
					if (a !== null) card.armor = a;
				}
				if (has(d.hpMax)) {
					const m = _intOverrideOrNull(d.hpMax);
					if (m !== null && m > 0) {
						card.hpMax = m;
						if (typeof card.hpCurrent === "number") card.hpCurrent = Math.min(card.hpCurrent, m);
						// Crew shows its per-member HP in the static octagon slot.
						if (card.hpStaticValue != null) card.hpStaticValue = m;
					}
				}
				// The `armor` field can be a placeholder ("—") or, on legacy/converted
				// data, a book-format string ("2 (0 vs. iron)") — fine for the read-only
				// value span, but it must never reach the <input type="number">. Give the
				// number input its own always-numeric value.
				card.armorInput = parseFollowerArmor(card.armor);
				// Optional free-text "where their armor comes from" note (leather, shield,
				// hides…). Purely descriptive — never feeds the numeric armor value.
				card.armorSource = has(d.armorSource) ? String(d.armorSource).trim() : "";
				return card;
			};

			// -- Animal Companion (Ranger) ------------------------------
			let animalCompanion = null;
			const acSlug = sf.animalCompanion?.type;
			if (acSlug) {
				const typeData = (playbookDoc?.animalCompanion?.types ?? []).find(t => t.slug === acSlug);
				const traits = sf.animalCompanion?.traits ?? [];
				// The type's mandatory trait (Bird/Critter "tiny", etc.) is auto-included
				// and free; it's stat-neutral, so it doesn't affect derived stats, but it
				// must still show as a locked chip and never count toward the pick budget.
				const mandatoryTrait = typeData?.mandatoryTrait ?? null;
				const displayTraits  = (mandatoryTrait && !traits.includes(mandatoryTrait))
					? [mandatoryTrait, ...traits] : traits;
				const stats = _applyAnimalCompanionTraits(typeData, traits);
				const kind = sf.animalCompanion?.kind ?? "";
				const typeLabel = typeData?.label ?? acSlug;
				const loyaltyVal = sf.animalCompanion?.loyalty ?? 0;
				// Trait-derived base stats, then Beast of Legend's marked "+4 HP / +1 armor"
				// (companionBonuses) layered onto the leading number of the base armor string
				// (e.g. "1 (size)" → "2 (size)"), matching _applyAnimalCompanionTraits.
				const hpMax = (Number(stats.hp) || 0) + (companionBonuses.hp ?? 0);
				const acArmor = companionBonuses.armor
					? _addToLeadingNumber(stats.armor, companionBonuses.armor)
					: (stats.armor ?? "—");
				const hpRaw = sf.animalCompanion?.hpCurrent;
				const showTraitHover = getHoverDescriptionSetting("hoverDescriptionsTraits");
				const acName = sf.animalCompanion?.name ?? "";
				const acPronoun = sf.animalCompanion?.pronoun ?? "";
				// Edit mode: the type's trait list as a pick-up-to-pickCount picker
				// (the rulebook's animal-companion build). Traits drive HP / armor /
				// damage via _applyAnimalCompanionTraits, so toggling one re-derives the
				// card's stats. Only built when editing; view mode shows the trait chips.
				let acTraitChoices = null;
				if (cardEditing("animal-companion", "")) {
					const acTypeTraits = typeData?.traits ?? [];
					// Base trait allowance + Magnificent Specimen's "+2 options" per owned copy.
					const pickCount    = (Number(typeData?.pickCount) || 0) + (companionBonuses.traitPicks ?? 0);
					const selectedSet  = new Set(traits);
					// The mandatory trait is locked on and free, so exclude it from the count.
					const extraCount   = [...selectedSet].filter(t => t !== mandatoryTrait).length;
					const atLimit      = pickCount > 0 && extraCount >= pickCount;
					// The insert's blank write-in trait: a selected trait that isn't one of
					// the type's listed options (nor the mandatory one). Surfaced as an
					// editable field so it survives — and stays editable — after creation.
					const customTrait  = [...selectedSet].find(t => t !== mandatoryTrait && !acTypeTraits.includes(t)) ?? "";
					if (acTypeTraits.length) acTraitChoices = {
						limit:   pickCount,
						customTrait,
						customTraitDisabled: !customTrait && atLimit,
						options: acTypeTraits.map(value => {
							const isMandatory = value === mandatoryTrait;
							const selected    = isMandatory || selectedSet.has(value);
							return { value, selected, mandatory: isMandatory, disabled: isMandatory || (!selected && atLimit) };
						}),
					};
				}
				animalCompanion = {
					...FOLLOWER_FTYPE_DEFAULTS["animal-companion"],
					slug:         "",
					name:         acName,
					pronoun:      acPronoun,
					pronounEditable: true,
					typeLabel:    kind ? `${_titleCase(kind)} (${String(typeLabel).toLowerCase()})` : String(typeLabel),
					tags:         displayTraits.map(label => ({ label, tooltip: showTraitHover ? _animalCompanionTraitTooltip(label) : null })),
					traitChoices: acTraitChoices,
					hpSlug:       "",
					hpMax,
					hpCurrent:    _clampHp(hpRaw, hpMax),
					armor:        acArmor,
					damage:       stats.damage             ?? "—",
					..._parseFollowerDamage(stats.damage),
					damageKind:   kind || String(typeLabel).toLowerCase(),
					damageName:   acName,
					damagePronoun: acPronoun,
					instinct:     sf.animalCompanion?.instinct ?? "",
					cost:         sf.animalCompanion?.cost     ?? "",
					loyalty:      _makeLoyaltyPips(loyaltyVal),
					loyaltySlug:  "",
					..._followerExtras(sf.animalCompanion?.details),
				};
			}

			// Owned move names for the crew's Shield-Wall check (below) and the per-card
			// "exceptional" gate (further down). The render's own copy — the header glyphs
			// resolve from the same one, so the whole repaint walks the items once.
			const ownedMoves = this._ownedMoveNames();

			// -- Crew (Marshal) -----------------------------------------
			// Hardcoded fallback until LevelDB pack is rebuilt with the marshal.json inventory changes.
			const CREW_INVENTORY_FALLBACK = [
				{ slug: "hatchet",     label: "<strong>Hatchet</strong>, iron (<em>hand, thrown</em>, x <em>piercing</em>)",                       weight: 1 },
				{ slug: "spear",       label: "<strong>Spear</strong>, iron (<em>close</em>, x <em>piercing</em>)",                                weight: 1 },
				{ slug: "bow-arrows",  label: "<strong>Bow &amp; iron arrows</strong> (<em>near</em>, x <em>piercing</em>)", weight: 1 },
				{ slug: "shield",      label: "<strong>Shield</strong> (+1 armor, +1 Readiness on 7+ to Defend)",                         weight: 2 },
				{ slug: "thick-hides", label: "<strong>Thick hides</strong> (1 armor, <em>warm</em>)",                                    weight: 2 },
				{ slug: "cloak",       label: "<strong>Cloak</strong> (<em>warm</em>)",                                                   weight: 1 },
			];
			let crew = null;
			if (crewExists(sf.crew)) {
				const loyaltyVal      = sf.crew?.loyalty ?? 0;
				const gearFlags       = sf.crew?.gear ?? {};
				const inventoryDef    = playbookDoc?.crew?.inventory?.length ? playbookDoc.crew.inventory : CREW_INVENTORY_FALLBACK;
				// Supplies: 6 independent sets, each with (4+Prosperity) circles.
				// smallItemLimit comes from buildSnapshot() — same value driving outfit inventory.
				const pipsPerSet      = smallItemLimit ?? 5;
				const prosperity      = smallItemLimit !== null ? smallItemLimit - 4 : null;
				const suppliesRaw     = sf.crew?.supplies;
				const suppliesArr     = Array.isArray(suppliesRaw) ? suppliesRaw : Array(6).fill(0);
				// Same piercing substitution used for outfit items on the character sheet.
				// Crew gear labels use plain "x piercing"; outfit item notes use "x <em>piercing</em>".
				const applyPiercing   = (label) => {
					if (!label?.includes('x piercing')) return label;
					if (prosperity === null) return label;
					const html      = label.includes('x <em>piercing</em>');
					const token     = html ? 'x <em>piercing</em>' : 'x piercing';
					const removalRe = html ? /(, )?x <em>piercing<\/em>(, )?/ : /(, )?x piercing(, )?/;
					if (prosperity <= -1) return label.replace(token, html ? '<em>crude</em>' : 'crude');
					if (prosperity === 0)  return label.replace(removalRe, (_, pre, post) => post ? (pre ?? '') : '').trim();
					const val = Math.min(prosperity, 2);
					return label.replace(token, html ? `${val} <em>piercing</em>` : `${val} piercing`);
				};
				// Whether the Roster's own pencil is open, computed here rather than read off
				// card.edit.individuals: withSectionEdits runs on the finished card, and the rows
				// inside it are built first. Same expression, one source — see withSectionEdits.
				const crewRosterEditing = followersEditing || this._editingSections.has("follower-individuals:crew:");
				const crewIndividuals = (sf.crew?.individuals ?? []).map((ind, idx) => {
					const indHpRaw = (sf.crew?.individualsHp ?? {})[idx];
					return {
						...ind, index: idx, hpMax: crewMaxHp, hpCurrent: _clampHp(indHpRaw, crewMaxHp),
						// A named individual keeps their face on their own row, beside their name
						// and traits (see roster-portraits.js), so it rides the splice when the
						// crew shrinks instead of needing the index re-key individualsHp does.
						...rosterAvatarContext(ind, { name: ind?.name, canWrite: this.isEditable, rosterEditing: crewRosterEditing }),
					};
				});
				// Roster: the crew is "a half-dozen strong by default" (Crew insert,
				// p.144). Named individuals are the members who've "stood out"; the
				// rest are tracked as anonymous members. Every member has their own
				// current HP against the one shared max (NPCs & Followers, p.470/472).
				const crewNamedCount = crewIndividuals.length;
				const crewSize       = effectiveCrewSize(sf.crew?.size, crewNamedCount);
				const crewAnonCount  = Math.max(0, crewSize - crewNamedCount);
				const crewMemberHp   = Array.isArray(sf.crew?.memberHp) ? sf.crew.memberHp : [];
				// An anonymous member has no row of their own to hang a face on, so their portrait
				// is its own array slot, parallel to memberHp and moved with it.
				const crewMemberImg  = Array.isArray(sf.crew?.memberPortrait) ? sf.crew.memberPortrait : [];
				const crewAnonMembers = this._anonRosterMembers(crewAnonCount, {
					hp: crewMemberHp, img: crewMemberImg, hpMax: crewMaxHp,
					editing: crewRosterEditing,
					labelFor: (i) => crewAnonMemberLabel(crewNamedCount, i),
				});
				const crewAliveCount = crewIndividuals.filter(m => m.hpCurrent > 0).length
				                     + crewAnonMembers.filter(m => m.hpCurrent > 0).length;
				// Abstracted "treat the whole group as one combatant" pool, tracked
				// independently of per-member HP (Followers in Fights, p.409/473).
				const crewGroupHpMax     = crewSize * crewMaxHp;
				const crewGroupHpRaw     = Number(sf.crew?.groupHp);
				const crewGroupHpCurrent = _clampHp(crewGroupHpRaw, crewGroupHpMax);
				// Readiness held when the crew Defends (common pool, p.473). A shield in
				// the crew's kit raises the cap from 3 to 4 (+1 Readiness on a 7+ Defend,
				// p.216); the shield is "equipped" when all its load pips are filled.
				const crewReadiness  = Math.max(0, Number(sf.crew?.readiness) || 0);
				const crewShieldDef  = inventoryDef.find(i => i.slug === "shield");
				const crewShieldWeight = Number(crewShieldDef?.weight) || 1;
				// A non-number gear flag is already the "fully equipped" boolean; a
				// number is filled load pips and counts as equipped once it meets weight.
				const crewHasShield  = !!crewShieldDef && (typeof gearFlags.shield === "number"
					? gearFlags.shield >= crewShieldWeight
					: !!gearFlags.shield);
				// "Shield Wall" (Marshal) upgrades the shield's Readiness bonus from +1 to
				// +2, so a Shield-Wall crew with shields can hold up to 5.
				const crewHasShieldWall = ownedMoves.has(SHIELD_WALL_MOVE);
				const crewShieldBonus = crewHasShieldWall ? READINESS_SHIELD_WALL_BONUS : READINESS_SHIELD_BONUS;
				const crewReadinessPips = _makeReadinessPips(crewReadiness, readinessCap(crewHasShield, crewShieldBonus));
				// Crew shares the common card body but supplies its own gear (the
				// inventory section below), so spread the shared extras then override
				// `gear`. Details live under crew.details so they don't collide with the
				// inventory pip map stored at crew.gear (see _followerDetailBase).
				const crewExtras = _followerExtras(sf.crew?.details);
				// Playbook-defined tag / instinct / cost options (the lists printed on
				// the Crew sheet), surfaced as pickers in edit mode. Tags store the raw
				// option string (one auto tag from the chosen background is locked on);
				// instinct/cost store the glyph-normalized text, matching onboarding.
				// Only the edit-mode pickers consume these, and each entry runs the
				// glyph normalizer, so skip the whole build outside edit mode.
				// The background-granted "auto" tag is DERIVED from the active background,
				// never baked into crew.tags — so changing background swaps it cleanly
				// instead of leaving the old one stranded in storage. crew.tags holds
				// only the player's chosen tags.
				const crewBgTag = (playbookDoc?.crew?.backgroundTags ?? {})[sf.background?.selected ?? ""] ?? null;
				const crewChosenTags = (sf.crew.tags ?? []).filter(t => t !== crewBgTag);
				let crewTagOptions = null, crewInstinctOptions = null, crewCostOptions = null;
				let crewTagLimit = 2;
				// Write-in values (the Crew insert's blank rows): a tag / instinct / cost the
				// player typed rather than picked from the list. Surfaced as editable fields.
				let crewTagCustom = "", crewTagCustomDisabled = false, crewInstinctCustom = "", crewCostCustom = "";
				if (cardEditing("crew", "")) {
					const crewOpts     = playbookDoc?.crew ?? {};
					// Base allowance (playbook data) + extra tags unlocked by Veteran Crew's
					// "Select 2 new tags" picks (tagBonus, from the marked-move bonuses).
					crewTagLimit       = (Number.isFinite(crewOpts.additionalTagCount) ? crewOpts.additionalTagCount : 2) + (crewStats.tagBonus ?? 0);
					const crewTagSet   = new Set(sf.crew.tags ?? []);
					const crewTagsAtLimit = [...crewTagSet].filter(t => t !== crewBgTag).length >= crewTagLimit;
					crewTagOptions = (crewOpts.availableTags ?? []).map(tag => {
						const isAuto     = tag === crewBgTag;
						const isSelected = isAuto || crewTagSet.has(tag);
						return { value: tag, label: normalizePlaybookGlyphs(tag), isAuto, isSelected, disabled: isAuto || (!isSelected && crewTagsAtLimit) };
					});
					crewInstinctOptions = (crewOpts.instincts ?? []).map(v => {
						const value = normalizePlaybookGlyphs(v);
						return { value, selected: (sf.crew.instinct ?? "") === value };
					});
					crewCostOptions = (crewOpts.costs ?? []).map(v => {
						const value = normalizePlaybookGlyphs(v);
						return { value, selected: (sf.crew.cost ?? "") === value };
					});
					const knownTags = new Set(crewOpts.availableTags ?? []);
					crewTagCustom = [...crewTagSet].find(t => t !== crewBgTag && !knownTags.has(t)) ?? "";
					crewTagCustomDisabled = !crewTagCustom && crewTagsAtLimit;
					crewInstinctCustom = crewInstinctOptions.some(o => o.selected) ? "" : (sf.crew.instinct ?? "");
					crewCostCustom     = crewCostOptions.some(o => o.selected)     ? "" : (sf.crew.cost ?? "");
				}
				crew = {
					...FOLLOWER_FTYPE_DEFAULTS["crew"],
					slug:      "",
					name:      sf.crew.name     ?? "",
					typeLabel: "group follower",
					tags:      (crewBgTag ? [crewBgTag, ...crewChosenTags] : crewChosenTags).map(t => ({ label: normalizePlaybookGlyphs(t) })),
					tagOptions: crewTagOptions?.length ? crewTagOptions : null,
					tagLimit:   crewTagLimit,
					tagAutoLabel: crewBgTag ? normalizePlaybookGlyphs(crewBgTag) : null,
					tagCustom:  crewTagCustom,
					tagCustomDisabled: crewTagCustomDisabled,
					instinct:  sf.crew.instinct ?? "",
					instinctOptions: crewInstinctOptions?.length ? crewInstinctOptions : null,
					instinctCustom: crewInstinctCustom,
					cost:      sf.crew.cost     ?? "",
					costOptions: crewCostOptions?.length ? crewCostOptions : null,
					costCustom: crewCostCustom,
					loyalty:   _makeLoyaltyPips(loyaltyVal),
					loyaltySlug: "",
					hpStaticValue: crewMaxHp,
					hpStaticSuffix: "each",
					damage:    crewDamageDie,
					damageRoll: crewDamageDie,
					damageKind: "",
					damageName: sf.crew.name || "Crew",
					damageForm: "",
					...crewExtras,        // exceptional / moves / movesLines / notes (gear overridden below)
					gear:      inventoryDef.map(item => {
						// A weightless entry still gets one pip, so it's toggleable (matches
						// the data-weight `|| 1` fallback in the gear-check handler).
						const weight      = Number(item.weight) || 1;
						const flagVal     = gearFlags[item.slug];
						// backward-compat: old boolean true ? all pips filled
						const filledCount = typeof flagVal === "number" ? flagVal : (flagVal ? weight : 0);
						return {
							...item,
							weight,
							label:   applyPiercing(item.label),
							checked: filledCount >= weight,
							pips:    Array.from({ length: weight }, (_, i) => ({ index: i, filled: i < filledCount })),
						};
					}),
					supplySets: Array.from({ length: 6 }, (_, setIdx) => {
						const filled = suppliesArr[setIdx] ?? 0;
						return {
							index: setIdx,
							pips:  Array.from({ length: pipsPerSet }, (_, pipIdx) => ({
								setIndex: setIdx,
								pipIndex: pipIdx,
								filled:   pipIdx < filled,
							})),
						};
					}),
					individuals:       crewIndividuals,
					individualOptions: playbookDoc?.crew?.individualOptions ?? {},
					namedCount:        crewNamedCount,
					size:              crewSize,
					anonMembers:       crewAnonMembers,
					memberCount:       crewAliveCount,
					groupHpCurrent:    crewGroupHpCurrent,
					groupHpMax:        crewGroupHpMax,
					readinessPips:     crewReadinessPips,
					readinessValue:    crewReadiness,
					readinessHasShield: crewHasShield,
					readinessShieldWall: crewHasShieldWall,
					sectionsOpen:      {
						inventory:  this._openCrewSections.has("inventory"),
						roster:     this._openCrewSections.has("roster"),
						groupFight: this._openCrewSections.has("groupFight"),
					},
					memberHp:          crewMaxHp,
					armor:             crewArmor,
					rollMod:           crewRollMod,
				};
			}

			// -- Initiates of Danu (Blessed + Initiate background) ------
			let initiates = null;
			const bgChoices        = sf.background?.choices ?? {};
			const initiatesLoyalty = sf.initiatesLoyalty  ?? {};
			const initiatesHp      = sf.initiatesHp       ?? {};
			const sfInitiateDetails = sf.initiateDetails  ?? {};
			const initiateBg       = (playbookDoc?.backgrounds ?? []).find(b => b.slug === "initiate");
			if (initiateBg?.choices?.options?.length) {
				const selected = initiateBg.choices.options.filter(opt => bgChoices[opt.slug]);
				if (selected.length) {
					initiates = selected.map(opt => {
						const det = sfInitiateDetails[opt.slug] ?? {};
						// Collect non-pronoun row selections as display tags
						const choiceDetails = (opt.choiceRows ?? [])
							.map((row, rowIdx) => row.type !== "pronoun" ? det.rows?.[rowIdx] : null)
							.filter(Boolean);
						const initHpMax = Number(opt.hp) || 0;
						const initHpRaw = initiatesHp[opt.slug];
						// Break the comma-separated epithet name onto one line per
						// segment (keeping the trailing comma); the pronoun rides
						// on the final line.
						const labelParts = String(opt.label ?? "").split(",").map(s => s.trim()).filter(Boolean);
						const labelLines = (labelParts.length ? labelParts : [String(opt.label ?? "")])
							.map((text, i, arr) => ({
								text:    i < arr.length - 1 ? `${text},` : text,
								pronoun: i === arr.length - 1 ? (det.pronoun ?? null) : null,
							}));
						const subtitleTags = (opt.subtitle ?? "").split(", ").map(t => t.trim()).filter(Boolean);
						// Edit mode: the rulebook's "pick 1 on each line". One radio row
						// per non-pronoun choiceRow (the pronoun line is edited up in the
						// name section). Selections persist to initiateDetails.<slug>.rows,
						// the same store onboarding writes — see the trait-option handler.
						let initTraitRows = null;
						if (cardEditing("initiate", opt.slug)) {
							initTraitRows = (opt.choiceRows ?? [])
								.map((row, rowIdx) => row.type === "pronoun" ? null : {
									slug:    opt.slug,
									rowIdx,
									label:   row.label ?? null,
									options: (row.options ?? []).map(value => ({ value, selected: (det.rows?.[rowIdx] ?? "") === value })),
								})
								.filter(Boolean);
							if (!initTraitRows.length) initTraitRows = null;
						}
						return {
							...FOLLOWER_FTYPE_DEFAULTS["initiate"],
							slug:          opt.slug,
							label:         opt.label,
							nameLines:     labelLines,
							typeLabel:     "initiate of Danu",
							// subtitle tags plus any non-pronoun choice rows, flagged so the
							// card can tint the chosen details differently.
							tags:          [
								...subtitleTags.map(label => ({ label })),
								...choiceDetails.map(label => ({ label, cls: "stonetop-follower-tag--detail" })),
							],
							subtitleTags:  subtitleTags.map(label => ({ label })),
							traitRows:     initTraitRows,
							hpSlug:        opt.slug,
							hpMax:         initHpMax,
							hpCurrent:     _clampHp(initHpRaw, initHpMax),
							armor:         opt.armor   ?? "—",
							damage:        opt.damage  ?? "—",
							..._parseFollowerDamage(opt.damage),
							damageKind:    "",
							damageName:    opt.label,
							damagePronoun: det.pronoun ?? "",
							instinct:      opt.instinct ?? null,
							cost:          opt.cost    ?? null,
							pronoun:       det.pronoun ?? null,
							choiceDetails,
							loyalty:       _makeLoyaltyPips(initiatesLoyalty[opt.slug] ?? 0),
							loyaltySlug:   opt.slug,
							..._followerExtras(det),
						};
					});
				}
			}

			// -- Livestock & Beasts (any playbook; from added special items) --
			// A character "owns" a beast when its slug is in inventory.addedSpecial
			// (the Add Special Item picker). HP and Loyalty track per-slug, mirroring
			// the initiate flags. Follower beasts (dog/mule/horse) earn Loyalty and
			// pay a Cost; the rest are livestock (butcher note, no Loyalty).
			const ownedSlugs      = sf.inventory?.addedSpecial ?? [];
			const beastHpFlags      = sf.beastHp      ?? {};
			const beastLoyaltyFlags = sf.beastLoyalty ?? {};
			const beastDetailFlags  = sf.beastDetails ?? {};
			const beasts = BEAST_ORDER
				.filter(slug => ownedSlugs.includes(slug))
				.map(slug => {
					const b     = BEAST_CATALOG[slug];
					const hpMax = Number(b.hp) || 0;
					const hpRaw = beastHpFlags[slug];
					const card  = {
						...FOLLOWER_FTYPE_DEFAULTS["beast"],
						slug,
						portraitIcon: b.follower ? "fas fa-dog" : "fas fa-wheat-awn",
						name:         b.name,
						typeLabel:    b.follower ? "beast follower" : "livestock",
						isFollower:   !!b.follower,
						hpSlug:       slug,
						hpMax,
						hpCurrent:    _clampHp(hpRaw, hpMax),
						armor:        b.armor ?? 0,
						damage:       b.damage + (b.damageForm ? ` (${b.damageForm})` : ""),
						damageRoll:   b.damage ?? null,
						damageForm:   b.damageForm ?? null,
						damageKind:   "",
						damageName:   b.name,
						tags:         (b.traits ?? []).map(label => ({ label })),
						traitsNote:   b.traitsNote ?? null,
						instinct:     b.instinct ?? "",
						cost:         b.cost ?? "",
						butcher:      b.butcher ?? null,
						..._followerExtras(beastDetailFlags[slug]),
					};
					if (b.follower) {
						card.loyalty = _makeLoyaltyPips(beastLoyaltyFlags[slug] ?? 0);
						card.loyaltySlug = slug;
					}
					return card;
				});

			// -- Custom followers (any playbook; built via the Create-a-Follower
			// walkthrough or by converting a dropped monster) -----------------
			// Each is a self-contained card stored under customFollowers.<id>. Its
			// structural stats (tags, max HP, armor) live alongside the hand-edited
			// fields (name, damage, instinct, cost, moves, gear, notes), Loyalty and
			// current HP in that one object — the same object the shared detail /
			// override / loyalty / HP handlers resolve through _FOLLOWER_FLAGS["custom"].
			// Ordered by their stored `order` (creation time) so the list is stable.
			const customMap = sf.customFollowers ?? {};
			// The Ring of Daagon and its Servants share one Loyalty pool (Book II: "sharing a
			// pool of Loyalty with the Ring itself"), so a Servant batch's Loyalty pips + Spend
			// button act on the Ring's track, not its own.
			const { id: ringId, loyalty: ringLoyaltyVal } = findRingFollower(customMap);
			const customFollowers = Object.entries(customMap)
				.sort((a, b) => (Number(a[1]?.order) || 0) - (Number(b[1]?.order) || 0))
				.map(([id, c]) => {
					const hpMax  = Number(c?.hpMax) || 0;
					const damage = String(c?.damage ?? "");
					const card = {
						...FOLLOWER_FTYPE_DEFAULTS["custom"],
						slug:         id,
						hpSlug:       id,
						portraitIcon: c?.portraitIcon || "fas fa-user",
						name:         c?.name ?? "",
						pronoun:      c?.pronoun ?? "",
						typeLabel:    c?.typeLabel || (c?.isGroup ? "group follower" : "follower"),
						isFollower:   true,
						removable:    true,
						party:        !!c?.party,
						// A follower marked "Dead" from the 0-HP fate dialog keeps its card as a
						// record (greyed out, with a Remove button), until the player clears it or
						// revives them. See _resolveFollowerFate / the HP-change revival clear.
						dead:         !!c?.dead,
						hpMax,
						hpCurrent:    _clampHp(c?.hpCurrent, hpMax),
						armor:        parseFollowerArmor(c?.armor),
						damage,
						..._parseFollowerDamage(damage),
						damageKind:   "",
						damageName:   c?.name || "follower",
						tags:         (Array.isArray(c?.tags) ? c.tags : []).map(label => ({ label })),
						instinct:     c?.instinct ?? "",
						cost:         c?.cost ?? "",
						butcher:      c?.butcher ?? null,
						loyalty:      _makeLoyaltyPips(c?.loyalty ?? 0),
						loyaltySlug:  id,
						..._followerExtras(c),
					};
					// Ring of Daagon identity — drives the card's Call Up / Send Them Back actions
					// (templates/actor/partials/tab-followers.hbs) and the shared-Loyalty link.
					card.sourceUuid = c?.sourceUuid ?? null;
					card.isRing     = card.sourceUuid === RING_SOURCE_UUID;
					card.isServant  = card.sourceUuid === SERVANT_SOURCE_UUID;
					card.brokenFree = !!c?.brokenFree;   // a Servant batch that broke free (Send Them Back 6-)
					// A Servant batch holds no Loyalty of its own — it draws on the Ring's pool
					// (Book II: "sharing a pool of Loyalty with the Ring itself"). Point its pips +
					// Spend button at the Ring's track so spending a Servant's Loyalty decrements the
					// Ring, and Call Up pays from the same pool. Readiness/ammo stay on the batch's own
					// id (they key off card.slug), so only Loyalty is shared.
					if (card.isServant && ringId) {
						card.sharedLoyalty = true;
						card.loyalty       = _makeLoyaltyPips(ringLoyaltyVal);
						card.loyaltySlug   = ringId;
					}
					// Group follower (NPCs & Followers p.470): the same shared stats as a
					// single follower, plus a roster where every member tracks their own
					// current HP against the shared max, an abstracted "one combatant"
					// group-HP pool (size × per-member HP), and the outnumber calculator.
					// The crew is the built-in example; this brings the same tools to a
					// hired warband, an arcana-summoned group, or a converted group monster.
					if (c?.isGroup) {
						const memberHpMax = hpMax || 1;
						const size = customGroupSize(c);
						const memberHpRaw  = Array.isArray(c?.memberHp) ? c.memberHp : [];
						// Faces, on the crew roster's terms: an array parallel to memberHp, trimmed
						// with it by the size stepper. This roster has no named individuals, so
						// every row is an anonymous slot.
						const memberImgRaw = Array.isArray(c?.memberPortrait) ? c.memberPortrait : [];
						const groupEditing = cardEditing("custom", id);
						const anonMembers = this._anonRosterMembers(size, {
							hp: memberHpRaw, img: memberImgRaw, hpMax: memberHpMax,
							editing: groupEditing,
							labelFor: (i) => `Member ${i + 1}`,
						});
						const groupHpMax     = size * memberHpMax;
						const groupHpCurrent = _clampHp(Number(c?.groupHp), groupHpMax);
						card.isGroup        = true;
						card.groupSize      = size;
						card.groupMembers   = anonMembers;
						card.groupHpCurrent = groupHpCurrent;
						card.groupHpMax     = groupHpMax;
						card.groupMemberHp  = memberHpMax;
						card.memberCount    = anonMembers.filter(m => m.hpCurrent > 0).length;
						card.groupSectionsOpen = {
							roster:     this._openCrewSections.has(`roster:custom:${id}`),
							groupFight: this._openCrewSections.has(`groupFight:custom:${id}`),
						};
					}
					return card;
				});

			// "exceptional" is a gated tag (see FOLLOWER_EXCEPTIONAL): the chip only
			// shows for follower types whose playbook grants it, and can be switched
			// on only once that move is owned. Surfaced per-card so the tags-row chip
			// and its click handler can warn when the requirement isn't met.
			// (ownedMoves is built once above, shared with the crew Shield-Wall check.)
			const withExceptional = (card) => {
				if (!card) return card;
				const def = FOLLOWER_EXCEPTIONAL[card.ftype];
				if (def) {
					card.exceptionalAvailable = true;
					card.exceptionalMoveName = def.move;
					card.exceptionalMet      = ownedMoves.has(def.move);
					card.exceptionalHint     = `Your ${def.noun} can become exceptional only after you take the move “${def.move}.”`;
					return card;
				}
				// Book I (p.462) lets the GM declare any truly outstanding follower
				// exceptional. The crew and animal companion earn it through a move
				// (above); every other true follower can simply be toggled — no gate.
				// Livestock (a beast that isn't a follower) can't be ordered, so it never
				// shows the chip.
				const ungated = card.ftype === "custom" || card.ftype === "initiate"
					|| (card.ftype === "beast" && card.isFollower);
				card.exceptionalAvailable = ungated;
				card.exceptionalMet        = ungated;   // no move requirement → always met
				return card;
			};
			// Stash the data the Order button (and its dialog) needs as plain values:
			// a clean tag list (pipe-joined — no follower tag contains a pipe), the
			// exceptional flag, and a display name. Initiates carry their epithet in
			// `label`, not `name`, so fall through to it. Also derives the Loyalty
			// total for the Spend button.
			const withOrderData = (card) => {
				if (!card) return card;
				const tags = (card.tags ?? [])
					.map(t => (typeof t === "string" ? t : t?.label))
					.filter(Boolean);
				card.orderTagsCsv = tags.join("|");
				// A follower's moves earn the same +1/+2 as a tag ("at least one
				// appropriate tag or move", p.462), so the Order dialog chips them
				// alongside the tags. Pipe-joined like the tags — a move line is free
				// text, so strip any pipe rather than let it split into two chips.
				const moves = (card.movesLines ?? []).map(m => String(m).replace(/\|/g, "/"));
				card.orderMovesCsv = moves.join("|");
				card.orderName    = card.name || card.label || card.namePlaceholder || card.typeLabel || "Follower";
				// Worded by the shared labeller, so the card and the roster row cannot end up
				// describing the same act two ways (see portraitActionLabel).
				card.portraitLabel = portraitActionLabel(card.orderName,
					{ editable: card.portraitEditable, hasPortrait: !!card.img });
				card.portraitFrameLabel = `Frame ${card.orderName}'s face`;
				if (Array.isArray(card.loyalty) && card.loyalty.length) {
					card.loyaltyValue = card.loyalty.filter(p => p.filled).length;
					// A Loyalty track marks a true follower (every orderable type has one;
					// livestock doesn't), so it gates the Order button the same way it
					// gates the readiness stepper below — no Order action on a butcher beast.
					card.canOrder = true;
					// "Have what they need" (p.472) adds an item to a follower's gear on the
					// fly. Non-crew followers carry a free-text gear checklist to append to;
					// the crew Outfits/restocks from its Supplies section instead.
					card.canHaveNeed = card.ftype !== "crew";
					// Readiness circles. Only true followers — which is exactly the set
					// that has a Loyalty track — so livestock is excluded. A borne shield
					// raises the cap from 3 to 4 (+1 Readiness on a 7+ Defend, p.216).
					// The crew's Readiness is a COMMON POOL for the whole group (p.473)
					// rather than a per-follower track, and its pips/cap (shields, Shield
					// Wall) are built in the crew block above — so here it only gets wired
					// to the same row, with readinessIsPool switching the wording.
					if (card.ftype === "crew") {
						card.showReadiness     = true;
						card.readinessFollower = "crew";
						card.readinessSlug     = "";
						card.readinessIsPool   = true;
					} else if (card.ftype) {
						// Readiness lives on the follower's OWN id (card.slug), never the (possibly
						// shared) loyaltySlug — a Servant of Daagon shares the Ring's Loyalty but
						// holds its own Readiness. For every other type card.slug === loyaltySlug, so
						// this is behaviour-preserving; the singular types ignore {slug} entirely.
						const rSlug = card.slug ?? "";
						card.showReadiness     = true;
						card.readinessFollower = card.ftype;
						card.readinessSlug     = rSlug;
						card.readinessValue    = Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, _followerReadinessPath(card.ftype, rSlug))) || 0);
						card.readinessHasShield = _followerBearsShield(card.gear);
						card.readinessPips      = _makeReadinessPips(card.readinessValue, readinessCap(card.readinessHasShield));
					}
					// The two pip tracks reserve the same number of slots so their Spend
					// buttons start at the same x, however many circles each row draws (a
					// borne shield gives Readiness a 4th, and an over-held pool more still,
					// while Loyalty is always 3). The card's widest count wins; the CSS
					// turns it into a fixed grid column. See --st-follower-pip-slots.
					card.pipSlots = Math.max(card.loyalty.length, card.readinessPips?.length ?? 0);
					// Ammo track (◇ low ammo, ◇ all out) — opt-in per follower via the
					// "uses ammo" toggle in the Damage section (a ranged weapon: bow,
					// sling, thrown — Moves & Gear). canUseAmmo shows that toggle (every
					// true follower, the crew included, may carry one — the crew bow tracks
					// ammo too, p.144); usesAmmo gates the ◇ low ammo / ◇ all out circles.
					// Two cumulative checks: 0 full → 1 low → 2 out.
					const aSlug = card.slug ?? "";   // ammo keys off the follower's own id, not the shared loyaltySlug
					card.canUseAmmo = true;
					card.usesAmmo   = !!detailFlagsFor(card.ftype, card.slug).usesAmmo;
					if (card.usesAmmo) {
						const ammoVal = Math.max(0, Math.min(2, Number(this.actor.getFlag(STONETOP_SCOPE, _followerAmmoPath(card.ftype, aSlug))) || 0));
						card.ammoFollower = card.ftype;
						card.ammoSlug     = aSlug;
						card.ammoValue    = ammoVal;
						card.ammoChecks   = [
							{ index: 0, label: "low ammo", checked: ammoVal >= 1 },
							{ index: 1, label: "all out",  checked: ammoVal >= 2 },
						];
					}
				}
				// A named crew member can be directed on their own — their unique tag +
				// traits apply on top of the group's shared tags (NPCs & Followers p.471).
				// Build each member's Order data from the crew's tags plus their own.
				if (card.ftype === "crew" && Array.isArray(card.individuals)) {
					card.individuals = card.individuals.map(ind => {
						const own = [ind.tag, ...(Array.isArray(ind.traits) ? ind.traits : [])].filter(Boolean);
						return {
							...ind,
							orderName:    ind.name || crewIndividualLabel(ind.index),
							orderTagsCsv: [...tags, ...own].join("|"),
							// The crew's moves belong to every member of it, so a member
							// ordered on their own can still lean on one.
							orderMovesCsv: card.orderMovesCsv,
							exceptional:  !!card.exceptional,
						};
					});
				}
				return card;
			};
			const finalize = (card) => withOrderData(withExceptional(withSectionEdits(withStatOverrides(card))));
			// Playbook possession-followers (the Would-be Hero's dog, the Ranger's Hounds,
			// the Blessed's Mastiffs) ship as gear text; offer to materialize any the PC
			// holds but hasn't added yet as a follower card (deduped by sourceUuid, like
			// arcana summons). Selected = preselected free gear + the player's picks.
			const ownedPossessions = [
				...(playbookDoc?.specialPossessions?.preselected ?? []),
				...(sf.possessions?.selected ?? []),
			];
			const presentSources = new Set(Object.values(customMap).map(f => f?.sourceUuid).filter(Boolean));
			const possessionFollowerOffers = availablePossessionFollowers(ownedPossessions, presentSources)
				.map(f => ({ slug: f.slug, name: f.name, isGroup: !!f.isGroup }));
			const groups = {
				animalCompanion: finalize(animalCompanion),
				crew:            finalize(crew),
				initiates:       initiates?.map(finalize) ?? null,
				beasts:          beasts.map(finalize),
				custom:          customFollowers.map(finalize),
			};
			// Flat index of the faces this character's own followers wear, for the People
			// gallery's "already assigned" marking (_followerPortraitsInUse). Stamped here
			// because this is where a card's portrait and its display name are both settled;
			// deriving it later would mean re-walking five flag stores and restating
			// withOrderData's name fallback.
			this._followerPortraits = Object.values(groups).flat()
				.filter(card => card?.img)
				// storedImg: this index answers "is this portrait already taken", which is a
				// question about the stored path, not about what is currently painted.
				.map(card => ({ ftype: card.ftype, slug: card.slug ?? "", img: card.storedImg ?? card.img, name: card.orderName }));
			// The payload each card hands to the canvas when it's dragged there, keyed by the
			// (ftype, slug) pair the card wrapper carries in its dataset. Built here for the
			// same reason the portrait index is: this is where a card is finished, and the
			// dragstart handler must be able to answer synchronously.
			this._followerDragData = new Map(Object.values(groups).flat()
				.filter(card => card?.ftype)
				.map(card => [`${card.ftype}:${card.slug ?? ""}`, _followerDragSnapshot(card, this.actor)]));
			return { ...groups, possessionFollowerOffers };
		}

		_buildInvocationsData(playbookDoc) {
			const raw = playbookDoc?.invocations;
			// The playbook's own option list, kept for the paths that need to name an Invocation
			// without rebuilding the tab: the click handler, the header chip, and the chat line
			// that says which one just ended. Stashed BEFORE the early return, so a sheet whose
			// playbook no longer has Invocations still gets an (empty) list rather than a stale one
			// left over from the playbook it used to have.
			this._invocationOptions = raw?.options ?? [];
			if (!raw?.options?.length) return null;
			const selected = new Set(this.actor.getFlag(STONETOP_SCOPE, "invocations.selected") ?? []);
			const showEffectTips = getHoverDescriptionSetting("hoverDescriptionsInvocations");
			const ongoingSlug = this._stonetopCharacter.ongoingInvocation;
			const options = raw.options.map(opt => {
				const description = opt.description ?? "";
				return {
					slug:        opt.slug,
					label:       opt.label,
					description: showEffectTips ? annotateInvocationEffects(description) : description,
					known:       selected.has(opt.slug),
					ongoing:     !!opt.ongoing,
					// `ongoing` is what this Invocation IS; `active` is what it is DOING. Only one
					// card can carry `active`, and it replaces the type badge there — a card that is
					// visibly running does not also need telling that it is the running kind.
					active:      !!ongoingSlug && opt.slug === ongoingSlug,
				};
			});
			// Known first, then alphabetically — mirrors the moves tab's owned-first order. The one
			// order the tab has: an A–Z alternative used to be offered here as a dropdown, but the
			// list is ten cards long and the hide-un-learned toggle already answers "just show me
			// mine", so the choice bought nothing the toolbar didn't already do.
			options.sort((a, b) => {
				if (a.known !== b.known) return a.known ? -1 : 1;
				return a.label.localeCompare(b.label);
			});
			return {
				startingCount: raw.startingCount ?? 2,
				hideUnknown:   this.actor.getFlag(STONETOP_SCOPE, "hideUnknownInvocations") ?? false,
				// The banner over the grid. Named here as well as on its own card because the
				// hide-un-learned toggle and the search can both push that card out of sight, and
				// the rule the banner restates is the one that costs you an Invocation.
				concentrating: this._ongoingInvocationContext(),
				options,
			};
		}

		/** The Invocation being held open, for the header chip and the tab's banner. */
		_ongoingInvocationContext() {
			const slug = readOngoing(this._stonetopCharacter.ongoingInvocation);
			return { active: !!slug, slug, label: this._invocationLabel(slug) };
		}

		/** An Invocation's printed name, from whichever playbook the last render read. */
		_invocationLabel(slug) {
			return invocationLabel(slug, this._invocationOptions);
		}

		// Every candidate row for the Details tab's Relationships section, in display
		// order. Shared by getData (which filters to the shown ones in play mode) and the
		// drop handler (which needs to know whether a dropped actor is already a row).
		//
		// Three sources, differing only in whether a row starts visible:
		//  • the other player characters — your party, so they start shown. Prefer the
		//    player-owned ones when any exist, but fall back to all of them so the section
		//    still populates while a GM preps before players are assigned.
		//  • everyone on the steading sheet — the whole roster would swamp the section, so
		//    they start hidden until someone picks the ones this character has feelings about.
		//  • anyone already stored in system.relationships who isn't covered above — that's
		//    how a dropped stranger becomes a row and stays one.
		// Self is always excluded; you don't rate yourself.
		_buildRelationshipRows() {
			return buildRelationshipRows(this.actor, [
				{ actors: partyCharacters({ exclude: this.actor.id }), defaultShown: true },
				{ actors: steadingPeopleActors(getStonetopSteadingActor()), defaultShown: false },
			]);
		}

		activateListeners(html) {
			super.activateListeners(html);

			// Hang the tab rail off the window's right edge. Done first so everything below —
			// notably _activateTabDragDrop — sees it in its final home rather than wiring the
			// copy that is about to move. See module/utils/tab-rail.js.
			mountTabRail(this, html);

			// Frost the seam under the pinned header while the tab is scrolled. After the rail
			// mount: the tab-change watcher binds to the rail in its final home on the frame.
			mountScrollFrost(this, html);

			// Notes tab: the core <prose-mirror> element fires a bubbling `change` on
			// save/blur carrying the serialized HTML on ev.target.value. Persist it to
			// the character's system.notes field. Stop propagation so the sheet's own
			// form-submit change handling doesn't double-process it.
			html[0].addEventListener("change", ev => {
				const pm = ev.target.closest("prose-mirror.character-notes-editor");
				if (!pm) return;
				ev.stopPropagation();
				const value = pm.value ?? "";
				if (value === (this.actor.system?.notes ?? "")) return;
				// Caught, not dropped: a failed persist here left the editor showing text the
				// player believed was saved, with nothing logged.
				this.actor.update({ "system.notes": value }).catch(err => {
					console.error("Stonetop | could not save the character's notes", err);
					ui.notifications?.error("Those notes could not be saved.");
				});
			}, true);

			html.find(".stonetop-create-character-btn").on("click", () => this._onNewCharacter());
			html.find("[data-onboarding-start]").on("click", ev => {
				this._openEditCharacterOnboarding({ startAtStep: ev.currentTarget.dataset.onboardingStart });
			});
			html.find(".stonetop-moves-level-notice-dismiss").on("click", async ev => {
				const key = ev.currentTarget.dataset.overageKey;
				if (key) await this.actor.setFlag(STONETOP_SCOPE, "moves.dismissedLevelOverage", key);
				this.render(false);
			});

			// Reveal the "Drop a playbook here" hint only while a drag is actually
			// over the sheet — a blank sheet shouldn't show a confusing dashed box,
			// but the player can still drop a playbook anywhere on it. dragenter and
			// dragleave bubble up from every child, so track the nesting depth and
			// only clear the hint once the drag has truly left the form.
			let dragDepth = 0;
			// Drop affordance for the Relationships section. Its clear() is folded into
			// clearDropHint because the sheet-wide drop handler runs in the capture phase and
			// stops propagation before a listener on the section would ever see the drop.
			const clearRelHighlight = wireRelationshipDropHighlight(
				html[0].querySelector(".stonetop-character-relationships"));
			const clearDropHint = () => {
				dragDepth = 0;
				html[0].classList.remove("stonetop-dragging-playbook");
				clearRelHighlight();
			};
			html[0].addEventListener("dragenter", () => {
				dragDepth++;
				html[0].classList.add("stonetop-dragging-playbook");
			});
			html[0].addEventListener("dragleave", () => { if (--dragDepth <= 0) clearDropHint(); });

			html[0].addEventListener("dragover", (ev) => ev.preventDefault());
			html[0].addEventListener("drop", async (ev) => {
				clearDropHint();
				if (ev.target.closest(".sheet-tabs")) return;
				// Cancel the browser's own drop action for everything this handler consumes.
				// stopImmediatePropagation() below cuts off core's DragDrop._handleDrop, which
				// is what would otherwise do this — so without it a drop landing on a text
				// field pastes the raw drag payload (`{"type":"JournalEntry","uuid":…}`) into
				// it, and on the relationships table the change handler saves that as a note.
				// Gecko gates only on the DROP event, so the dragover cancel above is not
				// enough there. Must be SYNCHRONOUS: after an `await` the default has already
				// run, and it has to cover every payload type, not just the ones we route.
				ev.preventDefault();
				ev.stopImmediatePropagation();
				const data = this._getDragEventData(ev);
				if (!data) return;
				if (data?.type === "Actor") {
					const doc = await fromUuid(data.uuid);
					// Dropped ON the Relationships section: put them on the list. Checked first
					// and always consumed, because this same handler turns any NPC dropped
					// elsewhere on the sheet into a follower — landing on the relationships
					// table should never start that conversion instead.
					if (ev.target.closest(".stonetop-character-relationships")) {
						const result = await relationshipDropResult(this.actor, doc, this._buildRelationshipRows(), {
							editable: this.isEditable,
						});
						const [level, message] = relationshipDropNotice(result, this.actor, doc);
						ui.notifications?.[level]?.(message);
						return;
					}
					if (doc?.system?.customType === "stonetop") {
						await this.actor.setFlag(STONETOP_SCOPE, "steadingId", doc.id);
						this.render(false);
					} else if (doc?.type === "monster") {
						// Dropping a monster offers to convert it to a follower (NPCs &
						// Followers, p.475): keep its stats, add tags, choose a cost.
						this._onMonsterDropConvert(doc);
					} else if (doc?.type === "npc") {
						// Dropping an NPC offers to make it this PC's follower (p.475: a
						// follower "is first an NPC") — carrying its identity over and
						// linking the card back to the actor via sourceUuid.
						this._onNpcDropConvert(doc);
					}
					return;
				}
				if (data?.type === "Item") {
					if (data.uuid) {
						const doc = await fromUuid(data.uuid);
						if (doc?.type === "playbook") {
							await this._onDropPlaybook(doc);
							return;
						}
					}
					// Resolve the dropped item and route it through our own creation
					// handler. We can't rely on the inherited _onDropItem → _onDropItemCreate
					// chain (deprecated AppV1 plumbing), so call _onDropItemCreate directly;
					// fall back to the base handler only for re-ordering an item already on
					// this actor.
					const item = await Item.implementation.fromDropData(data);
					if (!item) return;
					if (item.parent?.uuid === this.actor.uuid) {
						await this._onDropItem(ev, data);
						return;
					}
					await this._onDropItemCreate(item.toObject());
				}
			}, true);

			const dropZone = html[0].querySelector(".stonetop-playbook-drop-zone");
			if (dropZone) {
				dropZone.addEventListener("dragenter", () => dropZone.classList.add("drag-over"));
				dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
				dropZone.addEventListener("drop", () => dropZone.classList.remove("drag-over"));
			}

			html.find(".cell--stats .stat-value").each((_, el) => {
				el.value = el.value.replace(/^\+/, "");
			});
			applyLabelTooltips(html, {
				selector: ".cell--stats .stat[data-stat]", datasetKey: "stat",
				table: STAT_TOOLTIPS, settingKey: "hoverDescriptionsStats", direction: "DOWN",
			});
			applyLabelTooltips(html, {
				selector: ".cell__title[data-vital]", datasetKey: "vital",
				table: VITAL_TOOLTIPS, settingKey: "hoverDescriptionsVitals", direction: "DOWN",
			});

			html.find(".stonetop-hide-unselected-check").on("change", async (ev) => {
				await this.actor.setFlag(STONETOP_SCOPE, "hideUnselected", ev.currentTarget.checked);
			});

			html.find(".stonetop-group-by-category-check").on("change", async (ev) => {
				await this.actor.setFlag(STONETOP_SCOPE, "groupMovesByCategory", ev.currentTarget.checked);
			});

			html.find(".stonetop-hide-unknown-invocations-check").on("change", async (ev) => {
				await this.actor.setFlag(STONETOP_SCOPE, "hideUnknownInvocations", ev.currentTarget.checked);
			});

			// Live text filters (shared wireTabSearch): a round magnifying-glass button beside a
			// header that expands into a filter box (tab-search-control.hbs). Each call is scoped
			// to the container that holds both the box and the items it hides, so scoping to a
			// whole tab filters the tab and scoping to one column filters just that column.
			wireTabSearch(html[0].querySelector(".tab.moves"), {
				itemSel: ".stonetop-item",
				textFor: li => li.textContent,
				// Hiding / revealing cards changes the column balance, so re-pack the masonry
				// for the new visible set (defined further down, with the packer itself).
				onFilter: () => this._repackMoves?.(),
			});
			// Invocations tab (Lightbearer): one filter over the whole tab, matched on each card's
			// name and description. Scoped to the tab element, which is also the one carrying
			// `hide-unknown-invocations` — so an active term flags it `.is-searching` and suspends
			// that hide, surfacing a matching invocation whether or not it's learned.
			wireTabSearch(html[0].querySelector(".tab.stonetop-invocations"), {
				itemSel: ".stonetop-invocation-card",
				textFor: card => [".stonetop-invocation-name", ".stonetop-invocation-desc"]
					.map(sel => card.querySelector(sel)?.textContent ?? "").join(" "),
			});
			// Arcana tab: the Major and Minor sections each get their own filter, scoped to that
			// section, so each search only hides its own cards. An active term flags the section
			// `.is-searching`, which force-opens it if collapsed (see stonetop.css) so a match is
			// never hidden. Match on title(s) + front/back body only, skipping the footer button
			// labels (Remove / Reveal / Flip) so a term like "remove" doesn't match every card.
			const arcanaCardText = card => [...card.querySelectorAll(".stonetop-arcanum-title, .stonetop-arcanum-body")]
				.map(el => el.textContent).join(" ");
			for (const section of ["arcanaMajor", "arcanaMinor"]) {
				wireTabSearch(html[0].querySelector(`.stonetop-arcana-section[data-section="${section}"]`), {
					itemSel: ".stonetop-arcanum-card",
					textFor: arcanaCardText,
				});
			}
			// Inventory tab: each gear column gets its OWN filter, scoped to that column, so the
			// Items search never touches Small Items and vice-versa. Match on the row's name AND
			// its note/tags (the tags live in a sibling `.stonetop-inv-note`, so matching the label
			// span alone would miss a search for a visible gear tag like "near" or "piercing").
			const invLabelText = el => [".stonetop-inv-label", ".stonetop-inv-note"]
				.map(sel => el.querySelector(sel)?.textContent ?? "")
				.join(" ").trim() || el.textContent;
			for (const col of [".stonetop-inventory-regular", ".stonetop-inventory-small"]) {
				wireTabSearch(html[0].querySelector(col), {
					itemSel: ".stonetop-inv-item",
					textFor: invLabelText,
				});
			}
			// Followers tab: one filter over the follower cards, matched by name / type / tags.
			// The shared reference cards ("… Moves") are excluded so they always stay visible.
			wireTabSearch(html[0].querySelector(".tab.followers"), {
				itemSel: ".stonetop-follower-card:not(.stonetop-follower-card--rules)",
				textFor: card => {
					const text = [...card.querySelectorAll(
						".stonetop-follower-name, .stonetop-follower-name-line, .stonetop-follower-type, .stonetop-follower-tag"
					)].map(el => el.textContent).join(" ");
					const inputs = [...card.querySelectorAll(".stonetop-follower-name-field")].map(el => el.value).join(" ");
					return `${text} ${inputs}`;
				},
			});

			// The sticky Roll Modifier selector in the Moves sidebar (roll-mode-radios.hbs). A real
			// radio group, so `change` rather than a delegated click: the browser owns the
			// deselection, and change only fires on the one that became checked. Nothing renders
			// explicitly — setFlag is a document update, and `updateActor` re-renders this sheet.
			//
			// Bound unconditionally. The control is only DRAWN when "Ask How to Roll Each Time" is
			// off (see `showRollModeControl`), so with the window doing the asking this simply
			// matches nothing; a guard here would be a second place for the same setting to be
			// read and to disagree with the first.
			html.find(".stonetop-roll-mode-input").on("change", async (ev) => {
				await this._stonetopCharacter.setRollMode(ev.currentTarget.value);
			});

			// The header portrait's own click and the two pips over it, wired the same way the
			// stat-block sheets wire theirs — one header, one behaviour. A PC's face appears in
			// the steading roster and in everyone else's relationship rows, so it wants framing
			// for the same reason an NPC's does, and this is the entry point a non-GM routinely
			// uses on their own document, which is the check that this feature never needs isGM.
			wirePortraitPopout(this, html[0]);

			html[0].addEventListener("click", async ev => {
				const nameEl = ev.target.closest(".stonetop-item-name");
				if (!nameEl) return;
				// Move names stay "play-like" (open guided move / roll / post to chat) even in
				// edit mode — only moves live inside a `.stonetop-move-group`. Other item names
				// (equipment, details) keep the edit-mode guard so a stray click there doesn't
				// fire a chat post while you're editing the sheet.
				if (this._editMode && !nameEl.closest(".stonetop-move-group")) return;
				// A love letter is single-use: it resolves (and self-consumes) only via its own
				// Read & Resolve / Roll button, never a name-click that would post it to chat
				// without removing it. Its edit/delete pencils have their own handlers.
				if (nameEl.closest(".stonetop-love-letter")) return;
				// An un-learned custom move is inactive — its title does not roll, bonuses off — but its TEXT
				// is still readable, so a name-click posts it to chat like any other move. That
				// matches an un-owned playbook move, which posts to chat without being owned;
				// the roll is what's gated, not the reading.
				ev.preventDefault();
				const li = nameEl.closest("li");
				const name = nameEl.textContent.trim();
				// A player-authored move (moveType "other") that happens to share a guided
				// move's name acts as itself, never the built-in dialog — the same rule the
				// dice path applies in _guidedMoveForRollable.
				// The row's own item, when it has one — an un-owned playbook row has none. Read
				// once here: the moveType check below and _maybeConsecrateFlame both want it.
				const item = li?.dataset.itemId ? this.actor.items.get(li.dataset.itemId) : null;
				const isOtherMove = item?.system?.moveType === "other";
				const guide = isOtherMove ? null : GUIDED_CHARACTER_MOVES[name];
				// A ROLLABLE MOVE NEVER REACHES HERE. Its name element IS the `.rollable` now
				// (see move-group.hbs), and the rollable handler below runs in the CAPTURE phase
				// on this same root — it takes the click and stops it before this bubble-phase
				// listener is ever asked. So what this handler answers is exactly the rows that
				// do not roll: a description-only move, an un-owned row, an un-learned custom
				// move — and any row at all for an observer, whose clicks the rollable handler
				// declines on `isEditable`, leaving them the move's text and no dice.
				//
				// There used to be a forwarding branch here, dispatching a synthetic click at
				// the dice icon when the "Hide Rollable Icon" setting had hidden it. Nothing to
				// forward to any more: the die is gone from every move row, the name does the
				// rolling itself, and the Shift state is the real click's rather than one copied
				// onto a MouseEvent by hand.
				const rollable = li?.querySelector(".rollable");
				if (guide && _guidedCharacterMoveHasAction(guide, rollable)) {
					this._openGuidedCharacterMove({ name, guide }, rollable);
					return;
				}
				// A move whose whole offer is "this counts as a weapon" (Purifying Flames) has no
				// roll of its own, so using it IS the attack it grants — run below, after the tail,
				// with the weapon already in hand.
				//
				// AFTER, not INSTEAD. Having no rollType means the title does not roll, so this
				// name-click is the move's ONLY surface: a shortcut that took the click would be
				// the one move on the sheet its owner cannot show the table. So it does both, in
				// the order they read — here is what Purifying Flames says, and here is the Clash
				// at +WIS it turns into. Answered here rather than at the call itself so the
				// editability gate sits with the decision it gates: an observer gets the card and
				// no roll, which is the same tail every other move gives them.
				const grantedAttack = this.isEditable ? grantedWeaponAttackFor(this.actor, item) : null;
				// BUILT FROM THE SOURCE, NOT FROM THE ROW. The row's `.stonetop-item-description`
				// has already been through `moveBody`, so scraping it composed the card in the
				// opposite order from every other surface: the ladder had lifted "on a 10+, pick
				// 2; on a 7-9, pick 1:" out before the ticks were added, and that sentence is
				// where the cap is read from. Fourteen shipped moves posted an option list with
				// no limit at all (Forage, Let Fly, Muster, Ambush, Burgle…) and ten more got one
				// flat cap where the move gives a different count per tier (Seek Insight offers
				// 3 on a 10+ and 1 on a 7-9; the card said 3 either way).
				const source = this._printedMoveSource(name, item);
				const playbookName = html[0].querySelector(".stonetop-playbook-drop-zone:not(.empty)")?.textContent?.trim() ?? "";
				const speaker = ChatMessage.getSpeaker({ actor: this.actor });
				speaker.alias = playbookName ? `${this.actor.name} ${playbookName}` : this.actor.name;
				// A description-only move has no result card to choose on, so the options it
				// prints become ticks on THIS card (persisted to the message, like a roll card's).
				// Mighty Thews' "pick 1", Keep Company's questions, Censure's four reactions —
				// the move's own list, tickable where the table can see it. `moveCardBody` ticks
				// and lays the ladder in the one order those can happen in.
				//
				// A row whose name is in neither the actor's items nor the render's movelist
				// falls back to the rendered text: that card keeps the layout it always had
				// rather than losing its body over a lookup that came back empty.
				const stockBody = source?.description ?? li.querySelector(".stonetop-item-description")?.innerHTML ?? "";
				const printed = source
					? moveCardBody(source.description, source.moveResults)
					: pickableMoveDescription(stockBody);
				ChatMessage.create({
					content: moveChatCard(name, printed, { actions: this._stockSpendButtonHtml(stockBody) }),
					speaker,
				});
				// A description-only move has no rollType, so it falls all the way through to
				// here — and posting its text IS using it. MOVE_USE_EFFECTS is what "using it"
				// then means (lighting a holy light, opening the Judge's roster).
				await this._onDescriptionMoveUsed(item);
				// …and for the handful whose text is an offer of a weapon, using it is also that
				// weapon's attack. See grantedAttack above.
				if (grantedAttack) await this._rollGrantedWeaponAttack(item, grantedAttack, { shiftKey: ev.shiftKey });
			});

			// THE ROLLABLE CLICK HANDLER — replaces PbtA's built-in listener, and the one place a
			// move roll starts from a click on the sheet.
			//
			// A move's TITLE is its `.rollable` now — no move row draws a dice icon any more — so
			// this is what a click on a move's name reaches. CAPTURE phase, and it stops the click
			// it takes: that is what keeps the name handler above off a rollable move while leaving
			// it every row that does not roll (a description-only move, an un-owned row, an
			// un-learned custom move), which it posts to chat.
			// Restricted to owners/GMs (isEditable) so observers cannot roll on others' actors —
			// their click falls through to that handler and gets the move's text instead.
			html[0].addEventListener("click", async ev => {
				// Don't intercept clicks on enabled inputs (e.g. editing a stat value).
				if (ev.target.tagName === "INPUT" && !ev.target.disabled && !ev.target.readOnly) return;
				// The "+STAT" chip beside a title rolls the move too: it reads as part of the same
				// label, so it answers like one.
				const chip = ev.target.closest(".stonetop-move-roll-chip");
				const rollable = ev.target.closest(".rollable")
					?? chip?.closest("li")?.querySelector(".rollable");
				if (!rollable || !this.isEditable) return;
				ev.stopPropagation();
				// AN EXPEDITION MOVE OPENS ITS OWN DOOR FIRST — Requisition's assets, Outfit's
				// load, Forage's guided step. That used to belong to the row handler below,
				// because the row's NAME was not the rollable: the die rolled and the name did
				// this, and the two were different answers to the same move. One door now, so it
				// has to be this one, or Requisition would open the stat picker its icon opened
				// and never the dialog its name did.
				if (this._openExpeditionMoveDoor(rollable.closest("li"))) return;
				// Guided move, the two stat pickers, then the roll prompt — the same ladder the
				// hotbar path walks. See _resolveMoveRollPrompts.
				const prompted = await this._resolveMoveRollPrompts(rollable, { shiftKey: ev.shiftKey });
				if (prompted === "handled" || prompted === "cancel") return;
				const handled = await this._stonetopCharacter.onRoll({ currentTarget: rollable }, prompted);
				// What rolling this move DOES beyond the roll — see MOVE_ROLL_EFFECTS. Only after
				// the roll actually happened, so a cancelled weapon/target prompt opens nothing:
				// that is the `"cancel"` half of onRoll's answer, which is truthy (nothing else may
				// run for this rollable) but is not a roll.
				if (handled && handled !== "cancel") await this._onRollableRolled(rollable);
				if (!handled) {
					const roll = rollable.dataset.roll;
					if (!roll) return;
					if (_STAT_KEYS.has(roll)) {
						// Stat roll (STR, DEX, etc.)
						await this._stonetopCharacter.onDirectStatRoll(roll, prompted);
					} else {
						// Raw formula roll (e.g. damage die "d8")
						let label;
						if (rollable.classList.contains("stonetop-follower-damage-roll")) {
							const followerType   = rollable.dataset.followerType ?? "";
							const followerName   = (rollable.dataset.followerName   ?? "").trim();
							const followerKind   = (rollable.dataset.followerKind   ?? "").trim();
							const followerPronoun = (rollable.dataset.followerPronoun ?? "").trim().toLowerCase().split(/[\s/]/)[0];
							const damageForm     = (rollable.dataset.damageForm     ?? "").trim();
							const possessive = { he: "his", she: "her", they: "their" }[followerPronoun] ?? "its";
							if (followerType === "animal") {
								const subject  = followerName || followerKind || "animal companion";
								const formPart = damageForm ? ` with ${possessive} ${damageForm}` : "";
								label = `${subject} attacks${formPart}`;
							} else if (followerType === "initiate") {
								const formPart = damageForm ? ` with ${possessive} ${damageForm}` : "";
								label = `${this.actor.name}'s ${followerName || "initiate"} attacks${formPart}`;
							} else if (followerType === "beast") {
								const formPart = damageForm ? ` with ${possessive} ${damageForm}` : "";
								label = `${this.actor.name}'s ${followerName || "beast"} attacks${formPart}`;
							} else if (followerType === "custom") {
								const formPart = damageForm ? ` with ${possessive} ${damageForm}` : "";
								label = `${this.actor.name}'s ${followerName || "follower"} attacks${formPart}`;
							} else {
								const formPart = damageForm ? ` with ${possessive} ${damageForm}` : "";
								label = `${this.actor.name}'s ${followerName || "crew"} attacks${formPart}`;
							}
						} else {
							label = rollable.dataset.label ?? roll;
						}
						// A raw formula IS a damage roll — the character's own die, a follower's
						// attack — so it gets the damage window rather than the move prompt, which
						// asked it nothing upstream (see _resolveMoveRollPrompts). Shift on the
						// originating click skips it, exactly as it skips the move prompt.
						await rollDamagePrompted(roll, this.actor, { label, shiftKey: ev.shiftKey });
					}
				}
			}, true);

			// The whole basic/expedition row is tappable, not just its title.
			// The title and the "+stat" chip roll via the capture handler above
			// (which stopPropagation()s), so a click only reaches here when it lands
			// on empty row space, or on a row whose move does not roll.
			html.find(".stonetop-move-item").on("click", async ev => {
				if (!this.isEditable) return;
				// A tap on Defend's Readiness circles adjusts held Readiness — it must never
				// fall through to rolling the move (its own handler adjusts the pool).
				if (ev.target.closest(".stonetop-move-readiness")) return;
				const li     = ev.currentTarget;
				const nameEl = li.querySelector(".stonetop-move-name");
				if (!nameEl) return;

				// Expedition moves each do something on click: a bespoke dialog
				// (Requisition assets, Outfit), a guided step/roll modal, a direct
				// roll, or — failing those — posting the move text to chat. Shared with the
				// rollable handler above, which is where the same click lands when it is the
				// TITLE that was tapped rather than the empty space beside it.
				if (this._openExpeditionMoveDoor(li)) return;

				const rollable = li.querySelector(".rollable");
				// Re-dispatched with the Shift state rather than a bare `.click()`, which reports
				// `shiftKey: false` however the row was clicked — see the Moves tab's own
				// name-click above. Shift-clicking a move here is meant to skip the roll prompt.
				if (rollable) {
					rollable.dispatchEvent(new MouseEvent("click", {
						bubbles: true, cancelable: true, shiftKey: ev.shiftKey,
					}));
					return;
				}
				const { compendiumId } = nameEl.dataset;
				if (!compendiumId) return;
				const doc = await this._stonetopCharacter._moveRepo.getBasicMoveDocument(compendiumId);
				if (!doc) return;
				// Tickable for the same reason the Moves tab's name-click is: this is the move's
				// printed text, and a move that never rolls has nowhere else to record a choice.
				this._postPrintedMove(doc);
			});

			// Defend's Readiness circles (p.216). Clicking a circle sets held Readiness to
			// its position; clicking the highest filled one clears back to it (matching the
			// follower Loyalty/Readiness pips). stopPropagation so the tap doesn't bubble to
			// the row handler above and fire a Defend roll.
			html.find("button.stonetop-move-readiness-pip").on("click", async ev => {
				ev.preventDefault();
				ev.stopPropagation();
				if (!this.isEditable) return;
				const idx     = Number(ev.currentTarget.dataset.index);
				const current = this._stonetopCharacter.defendReadiness;
				await this._stonetopCharacter.setDefendReadiness(current === idx + 1 ? idx : idx + 1);
				this.render(false);
			});

			// -- Basic move hover panel --------------------------------------------
			// Runs for all users (not gated by isEditable).
			// We use a custom fixed panel rather than data-tooltip because the move
			// descriptions are rich HTML and Foundry's TooltipManager escapes content.

			// One floating panel per sheet instance; replace stale one on re-render.
			this._movePanel?.remove();
			if (getHoverDescriptionSetting("hoverDescriptionsBasicMoves")) {
				const panel = document.createElement("div");
				this._movePanel = panel;
				panel.className = "stonetop-basic-move-panel";
				panel.hidden = true;
				document.body.appendChild(panel);

				html.find(".stonetop-move-item").on("mouseenter", ev => {
					const li = ev.currentTarget;
					const descEl = li.querySelector(".stonetop-basic-move-desc");
					if (!descEl) return;
					const nameText = li.querySelector(".stonetop-move-name")?.textContent?.trim() ?? "";
					// Use DOM manipulation so nameText is never treated as HTML.
					const nameEl = document.createElement("strong");
					nameEl.className = "stonetop-basic-move-panel-name";
					nameEl.textContent = nameText;
					const descClone = descEl.cloneNode(true);
					panel.replaceChildren(nameEl, ...Array.from(descClone.childNodes));
					// The shared hover-panel pass: drop the collapsibles this panel can't open,
					// redraw the ◇/□ a move like Outfit is written with. Run on the PANEL rather
					// than on the clone because the spread above keeps the clone's children and
					// discards its `.stonetop-basic-move-desc` wrapper.
					prepareMoveHoverBody(panel);
					panel.hidden = false;
					const rect = li.getBoundingClientRect();
					panel.style.top   = `${Math.max(4, Math.min(rect.top, window.innerHeight - panel.offsetHeight - 8))}px`;
					panel.style.right = `${window.innerWidth - rect.left + 8}px`;
				}).on("mouseleave", () => {
					panel.hidden = true;
				});
			}

			// -- Move cross-reference tooltips ---------------------------------
			this._moveRefPanel?.remove();
			const showMoveRefHover = getHoverDescriptionSetting("hoverDescriptionsPlaybookMoves");
			let moveRefPanel = null;
			if (showMoveRefHover) {
				moveRefPanel = document.createElement("div");
				this._moveRefPanel = moveRefPanel;
				moveRefPanel.className = "stonetop-word-tooltip";
				moveRefPanel.hidden = true;
				document.body.appendChild(moveRefPanel);
			}

			// Link move names inside move prose. Sheet-only, and it runs before the glyph pass
			// below so a wrapped glyph can never land inside a freshly-made move-ref link.
			html.find(".stonetop-item-description").each((_, el) => {
				if (el.dataset.moveRefsEnriched) return;
				el.dataset.moveRefsEnriched = "1";
				enrichMoveRefsInEl(el);
			});
			// Render inline glyphs (◇ Conduit tracks, ○ marks, □ boxes, ▶ arrows) as SVG across
			// every read-only container. The list is shared with onboarding, chat and the item
			// sheets — see GLYPH_TEXT_CONTAINERS, which is also where the display-only rule that
			// keeps a <textarea>'s value safe is written down.
			wrapGlyphTextContainers(html[0]);

			// Fold the long, secondary "Consequences" section behind a collapsible heading
			// (like the basic-moves sidebar groups), defaulting to collapsed. It lives inside
			// the card's authored back HTML, so we wrap it at render time: the
			// <h3>Consequences</h3> becomes a clickable summary and everything after it (until
			// the next heading) folds into the body. Expanded state is per-user/per-actor and
			// persisted, so marking a consequence — which re-renders the sheet — doesn't refold
			// it. This runs on the BACK body, and also on the FRONT body of the cards that
			// surface their Consequences there (Hec'tumel / Redwood — see showFrontConsequences);
			// the front-only view and the spread's back panel are mutually exclusive, so the same
			// `${slug}:consequences` fold id is never in the DOM twice at once. Runs before the
			// masonry below so cards are measured at their folded height.
			html[0].querySelectorAll(".stonetop-arcanum-side--back .stonetop-arcanum-body, .stonetop-arcanum-side--front .stonetop-arcanum-body").forEach(body => {
				const slug = body.closest(".stonetop-arcanum-card")?.dataset.slug;
				if (!slug) return;
				const isFront = !!body.closest(".stonetop-arcanum-side--front");
				// Fold stops at the next heading or at template-appended siblings (the back
				// move trigger / "Add as follower" button that follow the authored HTML),
				// so folding the last section never swallows them.
				const isFoldBoundary = n => n.nodeType === 1 && (
					n.tagName === "H3" ||
					n.classList.contains("stonetop-arcanum-move-trigger") ||
					n.classList.contains("stonetop-arcanum-summon")
				);
				let foldedConsequences = false;
				for (const heading of [...body.children].filter(n => n.tagName === "H3")) {
					if (heading.textContent.trim().toLowerCase() !== "consequences") continue;

					// Everything from just after the heading up to the next boundary is the fold body.
					const bodyNodes = [];
					for (let n = heading.nextSibling; n && !isFoldBoundary(n); ) {
						const next = n.nextSibling;
						bodyNodes.push(n);
						n = next;
					}

					const id = `${slug}:consequences`;
					const expanded = this._expandedArcanaContent?.has(id);
					const fold = document.createElement("div");
					fold.className = `stonetop-arcanum-foldable${expanded ? "" : " is-collapsed"}`;
					fold.dataset.section = id;
					const summary = document.createElement("div");
					summary.className = "stonetop-arcanum-foldable-summary";
					summary.setAttribute("role", "button");
					summary.setAttribute("tabindex", "0");
					summary.setAttribute("aria-expanded", String(!!expanded));
					const foldBody = document.createElement("div");
					foldBody.className = "stonetop-arcanum-foldable-body";

					heading.replaceWith(fold);
					summary.appendChild(heading);      // move the heading into the summary
					bodyNodes.forEach(n => foldBody.appendChild(n));
					fold.append(summary, foldBody);
					foldedConsequences = true;
				}

				// With the section now surfaced below the front text, the front's own pointer
				// "mark a consequence (see reverse)" should read "(see below)". Only rewrite when
				// the fold is actually present (front-only view); in a spread the front keeps
				// "(see reverse)" pointing at the visible back panel. Scoped to the description
				// prose so the unlock's "(see reverse)" pointers (to spells / named moves) are
				// left alone.
				if (isFront && foldedConsequences) {
					const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
					for (let node = walker.nextNode(); node; node = walker.nextNode()) {
						if (!node.nodeValue.includes("(see reverse)")) continue;
						if (node.parentElement?.closest(".stonetop-arcanum-unlock-lead, .stonetop-arcanum-unlock-list, .stonetop-arcanum-foldable")) continue;
						node.nodeValue = node.nodeValue.replace(/\(see reverse\)/g, "(see below)");
					}
				}
			});

			// Toggle a "Consequences" fold (see above). Tracks EXPANDED ids since these
			// default collapsed; persisted per-user/per-actor.
			const toggleArcanaFold = summary => {
				const fold = summary.closest(".stonetop-arcanum-foldable");
				const id   = fold?.dataset.section;
				if (!id) return;
				const collapsed = fold.classList.toggle("is-collapsed");
				summary.setAttribute("aria-expanded", String(!collapsed));
				const set = (this._expandedArcanaContent ??= new Set());
				if (collapsed) set.delete(id); else set.add(id);
				this._persistArcanaContent();
			};
			html[0].addEventListener("click", ev => {
				const summary = ev.target.closest(".stonetop-arcanum-foldable-summary");
				if (!summary) return;
				ev.stopPropagation();
				toggleArcanaFold(summary);
			}, true);
			html[0].addEventListener("keydown", ev => {
				if (ev.key !== "Enter" && ev.key !== " ") return;
				const summary = ev.target.closest(".stonetop-arcanum-foldable-summary");
				if (!summary) return;
				ev.preventDefault();
				toggleArcanaFold(summary);
			}, true);

			// Three card grids, all packed by the shared masonry helper (utils/masonry.js): it
			// owns the card capture, the per-width guard, the ResizeObserver and the teardown,
			// so only the placement itself is written per grid.
			(this._masonries ??= []).forEach(m => m.disconnect());
			this._masonries = [];

			// Arcana: lay cards out by measured height, preserving authored order. A both-sides
			// "spread" card (front | back) spans the full grid width; the narrower front-only
			// cards pack two-up. The cards are walked into ordered segments — each spread its own
			// full-width segment, and each run of consecutive narrow cards into a two-column
			// block. A short card never leaves a big row-gap beside a tall one.
			//
			// No layoutKey: the wide-promotion below judges each card against the width it
			// actually rendered at, so this grid's layout varies continuously with width.
			const packArcanaMasonry = createPacker({
				cards: ".stonetop-arcanum-card",
				// Reset to a flat grid (narrow cards fall back to one track) and clear any
				// prior width-promotion, so every front-only card measures at its narrow,
				// one-column width — the width the "too tall" test below judges it at.
				reset: (grid, cards) => {
					for (const card of cards) card.classList.remove("stonetop-arcanum-card--wide");
					grid.replaceChildren(...cards);
				},
				place: (cards) => {
					if (!cards[0].offsetHeight) return null; // not measurable yet (tab still hidden)

					// Measure every card at its narrow width in one pass (reads before any style
					// write, so no per-card reflow), then promote any front-only card that renders
					// more than twice as tall as it is wide to span the full grid width: an
					// over-long arcanum reads better as one short, wide card than a skinny
					// sliver. Genuine both-sides spreads are already full-width and left alone.
					// Skip the promotion when the normal masonry column is already comfortably
					// wide; at that point the card should stay in the balanced column flow.
					const WIDE_PROMOTION_MAX_COLUMN_PX = 460;
					const measured = cards.map(card => ({ card, h: card.offsetHeight, w: card.offsetWidth }));
					const heights = new Map();
					for (const { card, h, w } of measured) {
						heights.set(card, h);
						if (card.classList.contains("stonetop-arcanum-card--spread")) continue;
						if (h > w * 2 && w < WIDE_PROMOTION_MAX_COLUMN_PX) card.classList.add("stonetop-arcanum-card--wide");
					}

					// Walk cards into ordered segments: a full-width card (a spread, or one
					// promoted wide above) stands alone; consecutive narrow cards accumulate into
					// a two-column array to balance.
					// A collapsed card is clamped to a header + lead, so it always packs as a
					// narrow one-column card — even a spread, whose full-width span is dropped
					// (both in CSS and here) while collapsed.
					const isFullWidth = card =>
						!card.classList.contains("is-collapsed") &&
						(card.classList.contains("stonetop-arcanum-card--spread") ||
						 card.classList.contains("stonetop-arcanum-card--wide"));
					const segments = [];
					let run = null;
					for (const card of cards) {
						if (isFullWidth(card)) {
							run = null;
							segments.push(card);
						} else {
							if (!run) segments.push(run = []);
							run.push(card);
						}
					}

					return segments.map(seg => {
						if (!Array.isArray(seg)) return seg; // a full-width card (spread or promoted)
						const block = document.createElement("div");
						block.className = "stonetop-arcana-masonry";
						const cols = makeColumns(2, "stonetop-arcana-col");
						packShortest(seg, cols, card => heights.get(card) ?? card.offsetHeight);
						block.append(...cols);
						return block;
					});
				},
			});
			// Collapsing / expanding a card changes its height but not the grid width, so the
			// width-guarded observer won't re-balance the two columns on its own.
			this._repackArcana = this._wireMasonry(packArcanaMasonry, ".stonetop-arcana-grid", html);

			// Special moves: distribute the few, variable-height cards ROW-MAJOR into as many
			// equal-width column tracks as the tab is wide enough to hold (card i → column i % N).
			// Unlike CSS multi-column — which balances by height and, with only a handful of
			// cards, can leave a right-hand column holding more rows than one to its left — this
			// keeps the fill strictly left-weighted while each track stays a tight,
			// natural-height stack.
			const SPECIAL_MOVE_COLS = { minPx: 280, gapPx: 12 };
			const packSpecialMoves = createPacker({
				cards: ".stonetop-special-move-card",
				layoutKey: width => fitColumns(width, SPECIAL_MOVE_COLS),
				place: (cards, width) => {
					const cols = makeColumns(
						Math.min(cards.length, fitColumns(width, SPECIAL_MOVE_COLS)),
						"stonetop-special-move-col");
					cards.forEach((card, i) => cols[i % cols.length].appendChild(card));
					return cols;
				},
			});
			this._wireMasonry(packSpecialMoves, ".stonetop-special-move-grid", html);

			// Moves: the same problem the arcana grid has, and the same answer. CSS multi-column
			// never bin-packs, so a card taller than the balanced column height starts the next
			// column and everything after it stacks BELOW it there — leaving the column to its
			// left half empty (the Lightbearer's "Invoke the Sun God" starting column 2, so
			// "Purifying Flames" lands under it while "Consecrated Flame" sits alone on the left).
			// Width numbers match `column-width` / `column-gap` / `column-count` on
			// .stonetop-move-group .items-list; keep them in step.
			const MOVE_COLS = { minPx: 240, gapPx: 16, max: 4 };
			const packMoveMasonry = createPacker({
				cards: ".stonetop-item",
				layoutKey: width => fitColumns(width, MOVE_COLS),
				// Back to the flat CSS-column list first, so every card measures at one
				// column's width — the width it will have in a packed track, so the heights
				// we balance on are the heights it will actually render at.
				reset: (list, cards) => {
					list.classList.remove("is-packed");
					list.replaceChildren(...cards);
				},
				place: (cards, width, list) => {
					// A card hidden by "Hide un-learned moves" or by an active search measures 0.
					// Those are kept OUT of the balance (they take no room) but stay in the tree,
					// parked at the end, so the next pack still sees them — the search re-runs
					// this whenever the visible set changes.
					const heights = new Map(cards.map(card => [card, card.offsetHeight]));
					const visible = cards.filter(card => heights.get(card) > 0);
					if (!visible.length) return null; // nothing measurable yet (tab still hidden, or all filtered out)

					const colCount = Math.min(visible.length, fitColumns(width, MOVE_COLS));
					// One column is what the flat list already is; leave it in CSS's hands rather
					// than wrapping a single track around it.
					if (colCount < 2) return cards;

					const tracks = makeColumns(colCount, "stonetop-move-col", "li").map(track => {
						const inner = document.createElement("ul");
						inner.className = "stonetop-move-col-list";
						track.appendChild(inner);
						return track;
					});
					packShortest(visible, tracks, card => heights.get(card),
						(track, card) => track.firstChild.appendChild(card));
					tracks.at(-1).firstChild.append(...cards.filter(card => !heights.get(card)));
					list.classList.add("is-packed");
					return tracks;
				},
			});
			// Filtering the tab (typing in the Moves search, clearing it, Escape) changes which
			// cards have height without changing any list's width, so the width guard would hold
			// the stale packing; the search's onFilter calls this back. Wired here rather than at
			// the wireTabSearch call above because that runs before this packer exists; the
			// callback only ever fires on user input, long after both.
			this._repackMoves = this._wireMasonry(
				packMoveMasonry, ".tab.moves .stonetop-move-group .items-list", html);

			if (showMoveRefHover) {
				let _moveRefHovered = null;
				html.find(".stonetop-move-ref").on("mouseenter", async ev => {
					const anchor = ev.currentTarget;
					_moveRefHovered = anchor;
					const name = anchor.dataset.moveName;
					const desc = await fetchMoveRef(name);
					if (_moveRefHovered !== anchor || !desc) return;
					moveRefPanel.innerHTML =
						`<p class="stonetop-word-tooltip-name">${name}</p>` +
						`<div class="stonetop-word-tooltip-desc">${desc}</div>`;
					// The same hover-panel pass the basic-move panel gets: collapsibles this
					// tooltip can't open go, and the glyphs are redrawn. This body is written
					// straight from a compendium description, so it never went past the sheet's
					// own pass below.
					prepareMoveHoverBody(moveRefPanel);
					moveRefPanel.hidden = false;
					const ar = anchor.getBoundingClientRect();
					const pr = moveRefPanel.getBoundingClientRect();
					let top  = ar.top - pr.height - 6;
					let left = ar.left;
					if (top < 8) top = ar.bottom + 6;
					left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
					moveRefPanel.style.top  = `${top}px`;
					moveRefPanel.style.left = `${left}px`;
				}).on("mouseleave", () => {
					_moveRefHovered = null;
					moveRefPanel.hidden = true;
				});
			}

			// Details-tab Relationships: hearts + notes stay interactive in normal view
			// (a live affinity tracker, adjusted during play, not an authoring step).
			// Wired ABOVE the editability gate because the helper's column drag-resize and
			// click-to-sort are VIEW features — a non-owner reading someone else's sheet
			// still gets them, exactly as they do on the NPC and steading sheets. The
			// `editable` flag is what gates the writes.
			wireRelationshipTable(html[0], this.actor, { editable: this.isEditable });
			// Same split for the board: the Table/Board toggle is a view feature and wires
			// for everyone; only the lane controls are gated on `editable`.
			wireRelationshipBoard(html[0], this.actor, { editable: this.isEditable });
			// Click a name to open that actor's sheet, hover a portrait for a full-size
			// preview. Ungated: neither writes anything, and both serve a player reading a
			// sheet they can't edit. Covers whichever of the two views is rendered.
			wireRelationshipLinks(html[0]);

			// Followers tab, a follower card's face: hovering a real portrait pops the
			// enlarged copy, and clicking opens the People of Stonetop gallery to (re)assign
			// one. Wired here, ABOVE the editability gate below, because the preview belongs
			// to every viewer for the same reason the relationship portraits' does — looking
			// at a face is not an edit, and a player reading a sheet they can't edit is
			// exactly who most wants a better look at it.
			//
			// The --editable class marks a portrait that DOES something on a tap, in either
			// mode; which of the two it does is data-portrait-mode, and the writing routes
			// (the gallery, the framer) carry their own isEditable check in getData, where the
			// class and the tabindex are decided together. So the pointer path and the keyboard
			// path are gated by one fact, in one place, and this call site needs no second check.
			wireAvatarPreview(html[0], ".stonetop-follower-portrait-img");
			const pickFollowerPortrait = ev => {
				// Cheap test first: this is bound in capture phase on the whole sheet, so every
				// keystroke into every field on it lands here. Deciding on `ev.key` before
				// walking ancestors keeps typing free.
				if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
				const portrait = ev.target.closest?.(".stonetop-follower-portrait--editable");
				if (!portrait) return;
				// preventDefault covers the keydown too: Space would otherwise scroll the tab
				// out from under the card while the gallery opens over it.
				ev.preventDefault();
				ev.stopPropagation();
				// The two pips sit inside the portrait and do their own job instead of the
				// gallery's. Checked after the portrait lookup so they inherit the same guards,
				// and each carries tabindex="-1" so neither takes the card's tab stop.
				if (ev.target.closest?.(".stonetop-follower-portrait-frame")) {
					this._onFollowerPortraitFrame(portrait);
					return;
				}
				if (ev.target.closest?.(".stonetop-follower-portrait-tokenize")) {
					this._onFollowerTokenize(portrait);
					return;
				}
				// Reading the card, a tap enlarges the face; editing it — or with no face yet to
				// enlarge — it opens the gallery. Stated as an attribute rather than inferred
				// from what else is on the card: the crop pip is now drawn in both modes, so
				// nothing in the DOM distinguishes them any more.
				if (portrait.dataset.portraitMode === "pick") this._onFollowerPortraitPick(portrait);
				else this._onFollowerPortraitView(portrait);
			};
			html[0].addEventListener("click", pickFollowerPortrait, true);
			html[0].addEventListener("keydown", pickFollowerPortrait, true);

			// The same two things, for the faces on a group follower's ROSTER — the crew's named
			// individuals and anonymous members, and a custom group's members. A separate wiring
			// rather than a widened selector because a roster row resolves its store from
			// (roster kind, slug, index) where a card resolves its from (ftype, slug); pooling
			// them would mean one handler branching on which dataset it found. The hover preview
			// IS pooled, though — wireAvatarPreview joins selectors into one listener pair.
			wireAvatarPreview(html[0], ".stonetop-roster-avatar-img");
			const pickRosterAvatar = ev => {
				if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
				const avatar = ev.target.closest?.(".stonetop-roster-avatar--editable");
				if (!avatar) return;
				// Space would otherwise scroll the roster out from under the row while the
				// gallery opens over it.
				ev.preventDefault();
				ev.stopPropagation();
				if (avatar.dataset.portraitMode === "pick") this._onRosterAvatarPick(avatar);
				else this._onRosterAvatarView(avatar);
			};
			html[0].addEventListener("click", pickRosterAvatar, true);
			html[0].addEventListener("keydown", pickRosterAvatar, true);

			// Every follower on this sheet becomes an `npc` Actor, made here rather than at each of
			// the dozen places a follower can arrive from (the walkthrough, a converted monster or
			// NPC, a possession, an arcana summon, the onboarding dialog's animal companion, crew
			// and initiates). All of them end in a render of this sheet, and this is the first
			// point at which a card is finished enough to become an actor: its numbers come from
			// the playbook and the override passes, not from the raw flags.
			//
			// Fired and forgotten. Nothing on screen waits for it — the cards are already drawn —
			// and the write it makes at the end re-renders the sheet with the links in place. It
			// does nothing at all once every follower has one, which is the state after the first
			// pass; see ensureFollowerActors for the rest of the guards.
			//
			// Its companion keeps that actor MATCHING the card afterwards. Making it once was not
			// enough: a follower renamed or given a portrait later kept the name and the stand-in
			// disc on their NPC and on the token dropped onto a scene. Same call site for the same
			// reason — a card can be edited from a dozen places, and all of them end here.
			//
			// Both carry their own guards, and both get a `.catch` here as well: a fire-and-forget
			// promise with nothing attached turns any throw they ever grow into an unhandled
			// rejection on every render of this sheet, which is a console warning nobody connects
			// to the sheet in front of them.
			const followerSnapshots = [...(this._followerDragData?.values() ?? [])];
			ensureFollowerActors(this.actor, followerSnapshots)
				.catch(err => console.error("Stonetop | follower actor creation failed", err));
			syncFollowerActors(this.actor, followerSnapshots)
				.catch(err => console.error("Stonetop | follower actor sync failed", err));

			// The token's HP bar reads the PERSISTED max, which the sheet itself never does. Same
			// call site and the same fire-and-forget shape as the follower sweeps above, for the
			// same reason: every route that can move a character's max HP (a level, a Marshal's
			// marked move, a Thrall's Marks, an insert's penalty) ends in a render of this sheet.
			this._syncStoredMaxHp()
				.catch(err => console.error("Stonetop | max HP mirror failed", err));

			// Followers tab: drag a card onto the canvas to put that follower on the map as a
			// token (module/hooks/FollowerDrop.js turns the payload below into an Actor).
			// Ungated, like the steading's NPC-row drag: dragging writes nothing here, and what
			// a drop is allowed to do is gated at the far end by the core token/actor
			// permissions — not by whether this viewer may edit the sheet.
			html[0].addEventListener("dragstart", (ev) => {
				const card = ev.target.closest?.(".stonetop-follower-card[data-ftype]");
				if (!card || !ev.dataTransfer) return;
				// A drag that begins inside a control is that control's own: dragging a value out
				// of a number field, or selected text out of a textarea, must not be hijacked into
				// dropping a token. The grip and the rest of the card body still start the drag.
				if (ev.target.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
				const payload = this._followerDragData?.get(`${card.dataset.ftype}:${card.dataset.slug ?? ""}`);
				if (!payload) { ev.preventDefault(); return; }
				ev.stopPropagation();
				ev.dataTransfer.setData("text/plain", JSON.stringify(payload));
				ev.dataTransfer.effectAllowed = "copy";
			});

			// The fold caret on every section heading. Two shapes count as a heading
			// here: the row that pairs a title with its edit pencil, and a bare title
			// (Inventory's columns, the Moves tab's groups) where the caret sits inside
			// the title itself. Listing both lets one wiring serve them — `closest`
			// resolves nearest-first, so a caret beside a pencil finds its row while one
			// inside a title finds the title. Above the isEditable guard on purpose:
			// folding is a reading preference, and a player reading another PC's sheet
			// (or their own in play mode) wants it just as much.
			// `.stonetop-moves-collapsible` is in the list as a STOP, not an anchor: a
			// sidebar move group has no caret of its own (clicking its title already
			// folds it), but the sidebar lays Roll Modifier and those groups out as one
			// flat run, so without it the Roll Modifier fold would swallow them all.
			this._wireSectionCollapse(html,
				".stonetop-details-heading-row, .stonetop-move-group-title, .stonetop-moves-collapsible");

			// The Preferences tab. Above the isEditable guard with the fold carets and for the same
			// reason: nothing on that tab is actor data, so a player looking at a locked sheet - or
			// at somebody else's - still gets to set their own font size from it.
			this._wirePreferences(html);

			if (!this.isEditable) return;

			// Details-tab per-section edit pencils: toggle just that section's edit
			// state, independent of the global header-wrench edit mode.
			this._wireSectionEditToggle(html, ".stonetop-details-section-edit-toggle");

			// Arcana-tab per-section edit pencils (Major / Minor). Same mechanism; the
			// pencil sits in the collapsible section's summary, so its capture-phase
			// handler stops the click before the collapse toggle sees it.
			this._wireSectionEditToggle(html, ".stonetop-arcana-section-edit-toggle");

			// The "needs your input" hand on a move card (shown when a budgeted move still
			// has unspent picks) is a one-tap shortcut into moves-edit — same as hitting the
			// section pencil — so the player can make the pending pick immediately. Open-only:
			// it never toggles edit OFF (the hand only shows while a choice is outstanding).
			const openMovesEditFromHand = ev => {
				const hand = ev.target.closest(".stonetop-move-choice-needed");
				if (!hand) return;
				if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
				ev.preventDefault();
				ev.stopPropagation();
				if (this.isSectionEditable("moves")) return; // already editable — nothing to do
				this._editingSections.add("moves");
				this._onSectionEditOpened("moves");
				this.render(false);
			};
			html[0].addEventListener("click", openMovesEditFromHand, true);
			html[0].addEventListener("keydown", openMovesEditFromHand, true);

			// The stat-choice hand on an Improved/Superior Stat card whose stat was never
			// chosen: open the +1 picker straight away for the first unfilled owned instance
			// (a repeatable move can have several). Distinct from the budgeted-move hand above
			// because there's no on-card control to pick a stat — it needs the dialog.
			const fillStatChoiceFromHand = async ev => {
				const hand = ev.target.closest(".stonetop-move-stat-choice-needed");
				if (!hand) return;
				if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
				ev.preventDefault();
				ev.stopPropagation();
				const itemId = hand.closest("[data-item-id]")?.dataset.itemId;
				const item = itemId ? this.actor.items.get(itemId) : null;
				if (!item) return;
				const choices = this.actor.getFlag(STONETOP_SCOPE, "improvedStatChoices") ?? {};
				const unfilled = this.actor.items.find(i =>
					i.type === "move" && i.name === item.name && i.system?.cap != null && !choices[i.id]);
				if (unfilled) await this._promptFillStatIncrease(unfilled);
			};
			html[0].addEventListener("click", fillStatChoiceFromHand, true);
			html[0].addEventListener("keydown", fillStatChoiceFromHand, true);

			// Followers tab: per-card, per-section edit pencils. Same per-section toggle
			// mechanism, keyed on `follower-<section>:<ftype>:<slug>`; opening a text
			// section (name/moves/notes) focuses its input.
			this._wireSectionEditToggle(html, ".stonetop-follower-edit, .stonetop-follower-done");
			if (this._pendingFollowerFocus) {
				const m = /^follower-(\w+):([^:]*):(.*)$/.exec(this._pendingFollowerFocus);
				this._pendingFollowerFocus = null;
				if (m) {
					const [, field, ftype, slug] = m;
					const el = html.find(`[data-field="${field}"][data-ftype="${ftype}"][data-slug="${slug}"]`)[0];
					if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) { el.focus(); el.select(); }
				}
			}

			// The Details-tab change handlers below are wired whenever any section is
			// editable — either the global wrench or an individual section pencil.
			if (this.hasActiveEdits) {
				html.find("[name=stonetop-background]").on("change", this._onBackgroundChange.bind(this));
				html.find("[name=stonetop-instinct]").on("change", ev => {
					html.find(".stonetop-instinct-custom-word, .stonetop-instinct-custom-desc").val("");
					this._stonetopCharacter.instinct.select(ev.currentTarget.value);
				});
				// Keep the word field to a single token, then save the composed
				// "Word — Description" so custom instincts match the suggestions.
				html.find(".stonetop-instinct-custom-word").on("input", ev => {
					ev.currentTarget.value = ev.currentTarget.value.replace(/\s+/g, "");
				});
				html.find(".stonetop-instinct-custom-word, .stonetop-instinct-custom-desc").on("change", () => {
					html.find("[name=stonetop-instinct]").prop("checked", false);
					const word = html.find(".stonetop-instinct-custom-word").val();
					const desc = html.find(".stonetop-instinct-custom-desc").val();
					this._stonetopCharacter.instinct.select(composeInstinct(word, desc));
				});
				html.find(".stonetop-appearance-radio").on("change", this._onAppearanceChange.bind(this));
				// Written-in appearance lines, the same trade the Instinct pair makes just above:
				// each line holds ONE value, so ticking a suggestion empties that row's write-in
				// box and typing in it unticks the row's radios. Scoped to the row (data-line),
				// since all four rows are on screen together.
				html.find(".stonetop-appearance-custom").on("change", this._onAppearanceCustomChange.bind(this));
				html.find("[name=stonetop-origin]").on("change", ev =>
					this._stonetopCharacter.origin.select(ev.currentTarget.value)
				);
				html.find(".stonetop-origin-name-check").on("change", this._onOriginNameClick.bind(this));
				// A regular move check and a repeatable-move check run the identical
				// add/remove-plus-prompts flow, so both bind to the one handler.
				html.find(".stonetop-move-check, .stonetop-repeat-check").on("change", this._onMoveCheck.bind(this));
				html.find(".stonetop-bg-choice").on("change", this._onBgChoiceChange.bind(this));
			}
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-item-resource-check");
				if (!btn) return;
				ev.stopPropagation();
				ev.stopImmediatePropagation();
				if (btn.classList.contains("stonetop-bg-resource-check")) {
					this._onBackgroundResourceChange({ currentTarget: btn });
				} else if (btn.dataset.moveName !== undefined) {
					this._onMoveResourceChange({ currentTarget: btn });
				} else {
					this._onPossessionUseChange({ currentTarget: btn });
				}
			}, true);
			// Beast-Bonded markable actions stay interactive in normal view (marked
			// during play as levels unlock more), not just under the edit pencil.
			html.find(".stonetop-bg-action-check").on("change", this._onBackgroundActionCheck.bind(this));
			html.find(".stonetop-inventory-item-check").on("change", this._onInventoryItemCheck.bind(this));
			html.find(".stonetop-regular-pool-btn, .stonetop-small-pool-display").on("change", this._onInventoryPoolEdit.bind(this));
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-inventory-resource-btn");
				if (!btn) return;
				this._onInventoryResource({ currentTarget: btn });
			}, true);
			html.find(".stonetop-inv-add-btn").on("click", this._onAddInventoryItem.bind(this));
			html.find(".stonetop-inv-delete").on("click", this._onDeleteCustomInventoryItem.bind(this));
			html.find(".stonetop-inv-remove-special").on("click", this._onRemoveSpecialItem.bind(this));
			html.find(".stonetop-inv-harvest").on("click", this._onHarvestProvisions.bind(this));
			// Identifying artifacts (Book I pp.430-431): the player's magnifier rolls, the GM's
			// mask hands the thing over (or hides it in the first place).
			html.find(".stonetop-inv-artifact-identify").on("click", ev =>
				this._onArtifactIdentify(ev.currentTarget.dataset.ownedId, { shiftKey: ev.shiftKey }));
			html.find(".stonetop-inv-artifact-gm").on("click", ev =>
				this._onArtifactGmControl(ev.currentTarget.dataset.ownedId));
			// And the caret that unfolds a row's write-up. Tracks the rows left OPEN, since
			// these fold shut by default; persisted per user, per actor.
			this._wireCollapsible(html, {
				summarySel:     ".stonetop-inv-lore-toggle",
				collapsibleSel: ".stonetop-inv-artifact-fold",
				getSet:         () => (this._expandedItemLore ??= new Set()),
				persist:        () => this._persistItemLore(),
				tracksExpanded: true,
			});
			html.find(".stonetop-possession-check").on("change", this._onPossessionCheck.bind(this));
			html.find(".stonetop-possession-custom-remove").on("click", this._onRemoveCustomPossession.bind(this));
			html.find(".stonetop-possession-sub-check").on("change", this._onPossessionSubCheck.bind(this));
			// Weapons-of-war ◇/□ rows: ticking a diamond picks the weapon (a sub-choice) and
			// marks it carried in one move — the pick IS the load mark.
			html.find(".stonetop-possession-choice-gear-check").on("change", this._onPossessionChoiceGearCheck.bind(this));
			// The inline ammo track ("○ low ammo, ○ all out") has to live INSIDE the row's
			// label span so it flows and wraps with the weapon's line — but that means its
			// status WORDS are non-interactive content inside a <label>, so clicking one
			// forwards to the label's first labelable descendant: the ◇ carry mark. Reading
			// the ammo status would silently change the character's load. The circles are
			// <button>s (interactive content, never forwarded), so cancelling the label's
			// activation here leaves the track working and only makes its words inert.
			html[0].addEventListener("click", ev => {
				if (ev.target.closest(".stonetop-choice-gear-statuses")) ev.preventDefault();
			}, true);
			// Fill-in blank inside a bundle sub-option (the Would-Be Hero's personal token):
			// saved on blur, keyed possession:choice, mirroring the onboarding write-in.
			html.find(".stonetop-possession-sub-fill").on("change", ev => {
				const { possessionSlug, choiceSlug } = ev.currentTarget.dataset;
				this._stonetopCharacter.setPossessionChoiceText(possessionSlug, choiceSlug, ev.currentTarget.value.trim());
			});
			// "Edit sacred pouch" affordances (Big Magic move card + gear-tab pencil):
			// open the standalone choiceGroups editor for the named possession.
			html.find("[data-possession-choices]").on("click", ev => {
				ev.preventDefault();
				ev.stopPropagation();
				this._openPossessionChoices(ev.currentTarget.dataset.possessionChoices);
			});
			html.find(".stonetop-levelup-open-btn").on("click", this._onLevelUpOpen.bind(this));
			html.find(".stonetop-levelup-icon").on("click", this._onLevelUpOpen.bind(this));
			html.find(".stonetop-deathsdoor-open-btn").on("click", this._onDeathsDoorOpen.bind(this));
			html.find(".stonetop-deathsdoor-clear-btn").on("click", this._onDeathsDoorClear.bind(this));
			html.find(".stonetop-deathsdoor-postdeath-btn").on("click", this._onPostDeathTabOpen.bind(this));
			// The `Dead` tag in the header. The other way into the raise question is putting hit
			// points on a dead sheet, and a table that plays the resurrection out in the fiction
			// first has no reason to have touched HP yet.
			html.find(".stonetop-dead-tag").on("click", this._onDeadTagClick.bind(this));
			// Book I at the end of the playbook row. Wired for READERS as well as owners, like
			// the scales below and unlike the candle: opening the rules is looking, not writing.
			// Only ever drawn once the GM has pointed the world at a copy (see getData).
			html.find(".stonetop-open-book").on("click", () => openSharedRulebook(PLAYER_BOOK));
			// The header candle. `button.` on purpose: the read-only copy is a <span> and must
			// not be wired, so nothing offers a click that would do nothing.
			html.find("button.stonetop-holy-light").on("click", this._onHolyLightToggle.bind(this));
			// "End it" — one class, wired once, wherever it is drawn: the header chip beside the
			// candle and the banner over the Invocations grid are the same control in two places a
			// player might look for it. Only ever rendered where the sheet is editable.
			html.find("button.stonetop-invocation-end").on("click", this._onEndOngoingInvocation.bind(this));
			// The header scales. Unlike the candle this is wired for READERS too — the span/button
			// split is about who may WRITE, and opening a list of who has been branded is looking,
			// not writing. The dialog itself withholds its add and dismiss controls (see
			// CondemnedDialog), so a player reading a GM's Judge gets the roster and nothing else.
			html.find(".stonetop-condemn").on("click", this._onCondemnOpen.bind(this));
			// The Blessed's triquetra, on the same terms as the scales: a reader may open the
			// roster, and the dialog withholds the writing.
			html.find(".stonetop-blessed-marks").on("click", this._onBlessedMarksOpen.bind(this));
			// The Heavy's Battle Joy, on the CANDLE's terms: `button.` on purpose, since the
			// read-only copy is a <span> and must not be wired.
			html.find("button.stonetop-battle-joy").on("click", this._onBattleJoyToggle.bind(this));
			html.find(".stonetop-recover-open-btn").on("click", this._onRecoverOpen.bind(this));
			html.find(".stonetop-convalesce-open-btn").on("click", this._onConvalesceOpen.bind(this));

			// Wounds (4th harm track): add / edit / remove. Status transitions are otherwise
			// move-gated (Recover stabilizes, Convalesce heals); the edit dialog is the manual
			// override. The row's data-wound-id resolves which record an action targets.
			html.find(".stonetop-wound-add").on("click", this._onWoundAdd.bind(this));
			html.find(".stonetop-wound-tend").on("click", ev => this._onWoundTend(this._woundIdFromEvent(ev)));
			html.find(".stonetop-wound-edit").on("click", ev => this._onWoundEdit(this._woundIdFromEvent(ev)));
			html.find(".stonetop-wound-remove").on("click", ev => this._onWoundRemove(this._woundIdFromEvent(ev)));

			// Damage die, typed by hand in edit mode. Saved as an override rather than through
			// the form, since the field's rendered value is the computed die (see actor-vitals.hbs).
			html.find("[data-damage-die]").on("change", this._onDamageDieEdit.bind(this));

			// Max HP, same story: the rendered number is computed, so a hand-typed one is banked
			// as a permanent adjustment instead of being written straight to the stale field.
			html.find("[data-hp-max]").on("change", this._onMaxHpEdit.bind(this));

			// -- Followers tab: shared follower-card fields ----------------
			// Common, hand-editable fields on every follower card (name,
			// exceptional/group toggles, free-text Moves/Notes, diamond Gear
			// checklist). The flag path per (ftype, slug, field) is resolved here;
			// see _followerExtras / _buildFollowersData for how they are read back.
			const followerDetailPath = (ftype, slug, field) => {
				const base = _followerDetailBase(ftype, slug);
				return base ? `${base}.${field}` : null;
			};
			// Name / pronoun and free-text Moves / Notes / stat fields. Structural
			// fields (name, pronoun, and instinct/cost on the types that store them)
			// write to the type root so they can be cleared; everything else is a
			// `.details` override field. _followerStructuralPath decides which.
			html.find(".stonetop-follower-name-field, .stonetop-follower-text, .stonetop-follower-stat-input").on("change", async ev => {
				const el   = ev.currentTarget;
				const path = _followerStructuralPath(el.dataset.ftype, el.dataset.field)
					?? followerDetailPath(el.dataset.ftype, el.dataset.slug, el.dataset.field);
				if (!path) return;
				await this.actor.setFlag(STONETOP_SCOPE, path, el.value.trim());
				this.render(false);
			});
			// Armor-source field: a free-type input with a suggestion dropdown (leather,
			// shield, hides…). Picking a suggestion fires `change`, saved by the handler
			// above; the field stays free-type, so "type your own" and "leave blank" both
			// just work. Uses our custom popup (native <datalist> has no scrollbar).
			html.find(".stonetop-follower-armor-source-input").each((_, input) =>
				StonetopAutocomplete.attach(input, FOLLOWER_ARMOR_SOURCES));
			// Exceptional tag chip (edit mode). A gated tag: only follower types whose
			// playbook grants it show the chip (see FOLLOWER_EXCEPTIONAL), and it can
			// be switched on only once that move is owned. Turning it off is always
			// allowed; trying to turn it on without the move warns instead of toggling.
			html.find(".stonetop-exceptional-toggle").on("click", async ev => {
				const el   = ev.currentTarget;
				const path = followerDetailPath(el.dataset.ftype, el.dataset.slug, "exceptional");
				if (!path) return;
				const turnOn = !el.classList.contains("is-selected");
				if (turnOn && el.dataset.met !== "true") {
					ui.notifications.warn(el.dataset.hint || "This follower can't be marked exceptional yet.");
					return;
				}
				await this.actor.setFlag(STONETOP_SCOPE, path, turnOn);
				this.render(false);
			});
			// Crew tag picker + its custom write-in row: store only the player's chosen tags
			// plus the write-in. The background-auto tag is the disabled option, so
			// `:not(:disabled)` excludes it — it's re-derived from the active background at
			// render, never persisted, so a later background change can't strand a stale auto
			// tag in crew.tags. The pick limit is enforced on render by disabling the unchecked
			// options once full. Rebuilding from all checked boxes plus the write-in means
			// editing either never drops the other.
			html.find(".stonetop-crew-tag-option, .stonetop-crew-tag-custom").on("change", async () => {
				const tags = html.find(".stonetop-crew-tag-option:checked:not(:disabled)").toArray().map(el => el.value);
				const custom = html.find(".stonetop-crew-tag-custom").val()?.trim();
				if (custom) tags.push(custom);
				await this.actor.setFlag(STONETOP_SCOPE, "crew.tags", tags);
				this.render(false);
			});
			// Animal-companion trait picker + its custom write-in row: pick up to the type's
			// pickCount. Same "checked, not disabled" gather as the crew tags; the limit is
			// enforced on render by disabling unchecked options once full. Traits drive the
			// companion's HP / armor / damage, so a re-render re-derives those stats.
			html.find(".stonetop-ac-trait-option, .stonetop-ac-trait-custom").on("change", async () => {
				const traits = html.find(".stonetop-ac-trait-option:checked:not(:disabled)").toArray().map(el => el.value);
				const custom = html.find(".stonetop-ac-trait-custom").val()?.trim();
				if (custom) traits.push(custom);
				await this.actor.setFlag(STONETOP_SCOPE, "animalCompanion.traits", traits);
				this.render(false);
			});
			// Initiate of Danu trait lines: "pick 1 on each line". Each radio row writes
			// its choice to initiateDetails.<slug>.rows[rowIdx] — the same object store
			// onboarding fills — so the two stay in sync (the pronoun line is edited up
			// in the name section, never here).
			html.find(".stonetop-initiate-trait-option").on("change", async ev => {
				const el     = ev.currentTarget;
				const slug   = el.dataset.slug;
				const rowIdx = Number(el.dataset.rowIdx);
				if (!slug || !Number.isInteger(rowIdx)) return;
				const path = `initiateDetails.${slug}.rows`;
				const rows = foundry.utils.deepClone(this.actor.getFlag(STONETOP_SCOPE, path) ?? {});
				rows[rowIdx] = el.value;
				await this.actor.setFlag(STONETOP_SCOPE, path, rows);
				this.render(false);
			});
			// Crew instinct / cost pickers (pick one from the playbook list)
			html.find(".stonetop-crew-instinct-option").on("change", async ev => {
				await this.actor.setFlag(STONETOP_SCOPE, "crew.instinct", ev.currentTarget.value);
				this.render(false);
			});
			html.find(".stonetop-crew-cost-option").on("change", async ev => {
				await this.actor.setFlag(STONETOP_SCOPE, "crew.cost", ev.currentTarget.value);
				this.render(false);
			});
			// Crew instinct / cost write-ins (the insert's blank rows): save the typed value
			// verbatim; picking a radio above overwrites it, matching onboarding.
			html.find(".stonetop-crew-instinct-custom").on("change", async ev => {
				await this.actor.setFlag(STONETOP_SCOPE, "crew.instinct", ev.currentTarget.value.trim());
				this.render(false);
			});
			html.find(".stonetop-crew-cost-custom").on("change", async ev => {
				await this.actor.setFlag(STONETOP_SCOPE, "crew.cost", ev.currentTarget.value.trim());
				this.render(false);
			});
			// Gear checklist: toggle carried, rename, add, remove
			const readFollowerGear = (ftype, slug) => {
				const path = followerDetailPath(ftype, slug, "gear");
				const cur  = path ? this.actor.getFlag(STONETOP_SCOPE, path) : null;
				return { path, list: Array.isArray(cur) ? foundry.utils.deepClone(cur) : [] };
			};
			html.find(".stonetop-follower-gear-check").on("change", async ev => {
				const el = ev.currentTarget;
				const { path, list } = readFollowerGear(el.dataset.ftype, el.dataset.slug);
				const i = Number(el.dataset.index);
				if (!path || !list[i]) return;
				list[i].checked = el.checked;
				await this.actor.setFlag(STONETOP_SCOPE, path, list);
				this.render(false);
			});
			html.find(".stonetop-follower-gear-label").on("change", async ev => {
				const el = ev.currentTarget;
				const { path, list } = readFollowerGear(el.dataset.ftype, el.dataset.slug);
				const i = Number(el.dataset.index);
				if (!path || !list[i]) return;
				list[i].label = el.value.trim();
				await this.actor.setFlag(STONETOP_SCOPE, path, list);
				// no re-render: the typed value already shows; avoids a focus jump
			});
			html.find(".stonetop-follower-gear-add").on("click", async ev => {
				const el = ev.currentTarget;
				const { path, list } = readFollowerGear(el.dataset.ftype, el.dataset.slug);
				if (!path) return;
				list.push({ label: "", checked: false });
				await this.actor.setFlag(STONETOP_SCOPE, path, list);
				this.render(false);
			});
			html.find(".stonetop-follower-gear-remove").on("click", async ev => {
				const el = ev.currentTarget;
				const { path, list } = readFollowerGear(el.dataset.ftype, el.dataset.slug);
				const i = Number(el.dataset.index);
				if (!path) return;
				list.splice(i, 1);
				await this.actor.setFlag(STONETOP_SCOPE, path, list);
				this.render(false);
			});

			// Tapping one of a follower's own moves posts it to chat, spoken with the
			// follower's name (mirrors how basic moves / Invocations post to chat). Only
			// the read-only list is clickable; edit mode shows a textarea instead.
			html.find(".stonetop-follower-moves-list li").on("click", ev => {
				const moveText = ev.currentTarget.textContent.trim();
				if (!moveText) return;
				const card   = ev.currentTarget.closest(".stonetop-follower-card");
				// Read the name without its pronoun span so the type label doesn't
				// double up the parentheses (e.g. "Brindle (follower)", not "(she) (follower)").
				const nameEl = card?.querySelector(".stonetop-follower-name")?.cloneNode(true);
				nameEl?.querySelectorAll(".stonetop-follower-pronoun").forEach(n => n.remove());
				const name = (nameEl?.textContent.trim().replace(/\s+/g, " ")) || "Follower";
				const type = card?.querySelector(".stonetop-follower-type")?.textContent.trim();
				const title = type ? `${name} (${type})` : name;
				this._postMoveCard(title, `<p>${escHtml(moveText)}</p>`);
			});

			// Create a follower via the Book I walkthrough (NPCs & Followers, p.474).
			html.find(".stonetop-create-follower-btn").on("click", () => this._onCreateFollowerOpen());
			// Materialize a playbook possession-follower (dog / Hounds / Mastiffs) as a card.
			html.find(".stonetop-add-possession-follower").on("click", ev =>
				this._onAddPossessionFollower(ev.currentTarget.dataset.slug));
			// Expand/collapse-all caret on a rules card header (Animal Companion Moves /
			// Follower Special Moves): open every move's <details> when any is collapsed,
			// otherwise close them all. Open state is ephemeral (resets on re-render), like
			// the individual summaries, so nothing is persisted.
			html.find(".stonetop-follower-rules-toggle").on("click", ev => {
				ev.preventDefault();
				const btn   = ev.currentTarget;
				const rules = [...(btn.closest(".stonetop-follower-card--rules")?.querySelectorAll(".stonetop-follower-rule") ?? [])];
				if (!rules.length) return;
				const expand = rules.some(d => !d.open);
				rules.forEach(d => { d.open = expand; });
				btn.setAttribute("aria-expanded", String(expand));
				btn.classList.toggle("is-expanded", expand);
			});
			// Remove a custom follower (built by the walkthrough or converted from a
			// monster) entirely — drops its whole customFollowers.<id> object.
			html.find(".stonetop-follower-remove").on("click", ev => {
				const slug = ev.currentTarget.dataset.slug;
				if (!slug) return;
				const name = this.actor.getFlag(STONETOP_SCOPE, `customFollowers.${slug}.name`) || "this follower";
				Dialog.confirm({
					title:   "Remove follower",
					content: `<p>Remove <strong>${escHtml(name)}</strong> from your followers? This can't be undone.</p>`,
					yes:     () => this._removeCustomFollower(slug),
					render:  bringDialogToFront,
					options: { classes: ["dialog", "stonetop"] },
				});
			});
			// Hand a custom follower off to another PC (p.480).
			html.find(".stonetop-follower-handoff").on("click", ev => {
				const slug = ev.currentTarget.dataset.slug;
				if (!slug) return;
				const name = ev.currentTarget.dataset.followerName
					|| this.actor.getFlag(STONETOP_SCOPE, `customFollowers.${slug}.name`) || "this follower";
				this._onHandOffFollower(slug, name);
			});
			// Party-wide follower toggle (advisory): any PC may pay its cost / spend its
			// Loyalty (p.464). The data still lives on this PC — it's a shared-table note.
			html.find(".stonetop-follower-party-check").on("change", async ev => {
				const slug = ev.currentTarget.dataset.slug;
				if (!slug) return;
				await this.actor.update({ [`flags.stonetop-pwd.customFollowers.${slug}.party`]: ev.currentTarget.checked });
				this.render(false);
			});

			// -- Followers tab: crew interactions --------------------------
			// Loyalty pips (all follower types). The pip's data-loyalty carries its
			// ftype; clicking a filled pip clears up to it, an empty one fills up to it.
			html.find("button.stonetop-loyalty-pip").on("click", async ev => {
				const { loyalty: ftype, slug } = ev.currentTarget.dataset;
				const path = _followerLoyaltyPath(ftype, slug);
				if (!path) return;
				const idx     = Number(ev.currentTarget.dataset.index);
				const current = Number(this.actor.getFlag(STONETOP_SCOPE, path)) || 0;
				await this.actor.setFlag(STONETOP_SCOPE, path, current === idx + 1 ? idx : idx + 1);
				this.render(false);
			});
			// Spend Loyalty / Readiness (p.464 / p.469): open a small chooser for the
			// rulebook's spend options, decrement the track, and post a chat note.
			html.find(".stonetop-spend-loyalty").on("click", ev => {
				const { ftype, slug, followerName } = ev.currentTarget.dataset;
				this._onSpendLoyalty(ftype, slug ?? "", followerName);
			});
			html.find(".stonetop-spend-readiness").on("click", ev => {
				const { ftype, slug, followerName } = ev.currentTarget.dataset;
				this._onSpendReadiness(ftype, slug ?? "", followerName);
			});
			// Ring of Daagon — Call Up the Deep Ones (roll & shape a fresh Servant batch)
			// and Send Them Back (+CHA to dismiss a batch). See the Daagon actions in
			// tab-followers.hbs; both live on the Ring's / Servant's custom-follower card.
			html.find(".stonetop-callup-deep-ones").on("click", () => this._onCallUpDeepOnes());
			html.find(".stonetop-send-back").on("click", ev => {
				const { slug, followerName } = ev.currentTarget.dataset;
				this._onSendServantsBack(slug, followerName);
			});
			// Have What They Need (add gear to a follower) / Outfit the crew (restock).
			html.find(".stonetop-follower-have-need").on("click", ev => {
				const { ftype, slug, followerName } = ev.currentTarget.dataset;
				this._onHaveWhatTheyNeed(ftype, slug ?? "", followerName);
			});
			html.find(".stonetop-crew-outfit").on("click", () => this._onOutfitCrew());

			// Crew gear pip circles. An inventory item is carried as a unit — its
			// pips just show its load weight — so a multi-pip ("double diamond")
			// item like the Shield or Thick hides is either fully equipped or not
			// at all. Toggling any pip fills or clears all of that item's pips
			// together (data-weight is the item's pip count).
			html.find(".stonetop-crew-gear-check").on("change", async ev => {
				const { slug, weight } = ev.currentTarget.dataset;
				const checked = ev.currentTarget.checked;
				// Flip every pip of this item (and its label styling) in the same
				// frame as the clicked one, so a double-diamond item reads as a
				// single toggle instead of one pip lagging behind the async persist.
				const pips = ev.currentTarget.closest(".stonetop-crew-gear-pips");
				if (pips) pips.querySelectorAll(".stonetop-crew-gear-check").forEach(cb => { cb.checked = checked; });
				ev.currentTarget.closest(".stonetop-crew-gear-item")?.classList.toggle("is-checked", checked);
				const gear    = foundry.utils.deepClone(this.actor.getFlag(STONETOP_SCOPE, "crew.gear") ?? {});
				gear[slug]    = checked ? (Number(weight) || 1) : 0;
				await this.actor.setFlag(STONETOP_SCOPE, "crew.gear", gear);
				this.render(false);
			});
			// Crew supplies pip circles — 6 independent sets stored as an array of counts
			html.find(".stonetop-crew-supplies-pip").on("change", async ev => {
				const setIdx = Number(ev.currentTarget.dataset.set);
				const pipIdx = Number(ev.currentTarget.dataset.pip);
				const newVal = ev.currentTarget.checked ? pipIdx + 1 : pipIdx;
				const current = this.actor.getFlag(STONETOP_SCOPE, "crew.supplies");
				const arr = Array.isArray(current) ? [...current] : Array(6).fill(0);
				while (arr.length < 6) arr.push(0);
				arr[setIdx] = newVal;
				await this.actor.setFlag(STONETOP_SCOPE, "crew.supplies", arr);
				this.render(false);
			});
			// Add a group-fight pool clamp to a pending update when the roster shrinks:
			// the pool maxes at crewSize × per-member HP, so a smaller crew must not
			// leave a stale over-max value stored. Only an explicitly-set value is
			// touched — an unset groupHp tracks the full max on its own.
			const clampStoredGroupHp = (update, crewSize) => {
				const raw = Number(this.actor.getFlag(STONETOP_SCOPE, "crew.groupHp"));
				if (!Number.isFinite(raw)) return;
				const max = Math.max(0, crewSize) * (this._crewMemberHpMax ?? 6);
				if (raw > max) update["flags.stonetop-pwd.crew.groupHp"] = max;
			};
			// Delete individual crew member
			html.find(".stonetop-crew-delete-individual").on("click", ev => {
				const idx = Number(ev.currentTarget.dataset.index);
				const individuals = [...(this.actor.getFlag(STONETOP_SCOPE, "crew.individuals") ?? [])];
				if (idx < 0 || idx >= individuals.length) return;
				const name = individuals[idx]?.name || "this crew member";
				individuals.splice(idx, 1);
				// Re-key per-individual HP to stay aligned with the spliced array:
				// the removed entry is dropped and every entry above it shifts down
				// one. (individualsHp is an index-keyed map, not part of the array.)
				const oldHp = this.actor.getFlag(STONETOP_SCOPE, "crew.individualsHp") ?? {};
				const newHp = {};
				for (const [k, v] of Object.entries(oldHp)) {
					const i = Number(k);
					if (i < idx)      newHp[i]     = v;
					else if (i > idx) newHp[i - 1] = v;
				}
				// Write the re-keyed entries and per-key delete any stale indices the
				// shift left behind, in one update. (Foundry recursively merges
				// object-valued flags, so without the key deletes the dropped/old
				// trailing entries would persist.)
				const survivors = new Set(Object.keys(newHp));
				const update = { "flags.stonetop-pwd.crew.individuals": individuals };
				for (const k of Object.keys(oldHp))
					if (!survivors.has(k)) {
						const [updKey, val] = deletionEntry(`flags.${STONETOP_SCOPE}.crew.individualsHp.${k}`);
						update[updKey] = val;
					}
				for (const [k, v] of Object.entries(newHp))
					update[`flags.stonetop-pwd.crew.individualsHp.${k}`] = v;
				// Shrink the roster by one: "Remove" takes the member out of the crew
				// entirely. Without this the freed slot reappears as a fresh full-HP
				// anonymous member (`size` would still imply the old headcount).
				const sizeBefore = effectiveCrewSize(this.actor.getFlag(STONETOP_SCOPE, "crew.size"), individuals.length + 1);
				const newSize = Math.max(individuals.length, sizeBefore - 1);
				update["flags.stonetop-pwd.crew.size"] = newSize;
				clampStoredGroupHp(update, newSize);
				Dialog.confirm({
					title:   "Remove crew member",
					content: `<p>Remove <strong>${escHtml(name)}</strong> from the crew? This can't be undone.</p>`,
					yes:     async () => { await this.actor.update(update); this.render(false); },
					render:  bringDialogToFront,
					options: { classes: ["dialog", "stonetop"] },
				});
			});

			// Crew roster size — total headcount; never below the number of named
			// individuals. Trims trailing anonymous-member HP entries when shrinking.
			const setCrewSize = async (size) => {
				const namedCount = (this.actor.getFlag(STONETOP_SCOPE, "crew.individuals") ?? []).length;
				const clamped    = Math.min(CREW_SIZE_MAX, Math.max(namedCount, Math.max(0, size)));
				const anonCount  = Math.max(0, clamped - namedCount);
				const memberHp   = (this.actor.getFlag(STONETOP_SCOPE, "crew.memberHp") ?? []).slice(0, anonCount);
				const update = {
					"flags.stonetop-pwd.crew.size":     clamped,
					"flags.stonetop-pwd.crew.memberHp": memberHp,
				};
				// The anonymous members' faces are an array parallel to their HP, so they are trimmed
				// by the same cut. Only written when there is something to trim: an untouched roster
				// has no portrait store at all, and seeding an empty array here would leave one
				// behind on every crew that never picked a face.
				const memberPortrait = rosterPortraitList(this.actor, "crew-member");
				if (memberPortrait.length > anonCount) {
					update["flags.stonetop-pwd.crew.memberPortrait"] = memberPortrait.slice(0, anonCount);
				}
				clampStoredGroupHp(update, clamped);
				await this.actor.update(update);
				this.render(false);
			};
			html.find(".stonetop-crew-size-step").on("click", ev => {
				const delta = Number(ev.currentTarget.dataset.delta) || 0;
				const input = ev.currentTarget.parentElement.querySelector(".stonetop-crew-size-input");
				setCrewSize((parseInt(input?.value, 10) || 0) + delta);
			});
			html.find(".stonetop-crew-size-input").on("change", ev => {
				const v = parseInt(ev.currentTarget.value, 10);
				// Blank/non-numeric input: revert to the current size rather than
				// collapsing the roster to the named count (which would drop every
				// anonymous member's tracked HP).
				if (!Number.isFinite(v)) return this.render(false);
				setCrewSize(v);
			});

			// Readiness circles (crew Defend pool + each non-crew follower — p.469:
			// held when they Defend; spend to suffer an attack for a ward, halve it,
			// draw all attention, or strike back). The crew's pips carry ftype "crew",
			// so the same handler resolves both via _followerReadinessPath. Clicking a
			// circle sets Readiness to its position; clicking the highest filled one
			// clears back to it (matching the Loyalty-pip toggle).
			html.find("button.stonetop-readiness-pip").on("click", async ev => {
				const { ftype, slug } = ev.currentTarget.dataset;
				const path = _followerReadinessPath(ftype, slug);
				if (!path) return;
				const idx     = Number(ev.currentTarget.dataset.index);
				const current = Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, path)) || 0);
				await this.actor.update({ [`flags.stonetop-pwd.${path}`]: current === idx + 1 ? idx : idx + 1 });
				this.render(false);
			});
			// "Uses ammo" toggle (Damage section, edit mode): opts a ranged follower
			// into the ◇ low ammo / ◇ all out track. Turning it off clears any marked
			// ammo, so a later re-enable starts fresh at full.
			html.find(".stonetop-follower-uses-ammo-input").on("change", async ev => {
				const { ftype, slug } = ev.currentTarget.dataset;
				const path = followerDetailPath(ftype, slug ?? "", "usesAmmo");
				if (!path) return;
				const on = ev.currentTarget.checked;
				const update = { [`flags.stonetop-pwd.${path}`]: on };
				if (!on) {
					const ammoPath = _followerAmmoPath(ftype, slug ?? "");
					if (ammoPath) update[`flags.stonetop-pwd.${ammoPath}`] = 0;
				}
				await this.actor.update(update);
				this.render(false);
			});
			// Follower ammo checks (◇ low ammo, ◇ all out): a cumulative 0→1→2 track, so
			// checking "all out" implies "low ammo" and clearing "low" resets to full.
			html.find(".stonetop-follower-ammo-input").on("change", async ev => {
				const { ftype, slug, index } = ev.currentTarget.dataset;
				const path = _followerAmmoPath(ftype, slug ?? "");
				if (!path) return;
				const idx    = Number(index);
				const newVal = ev.currentTarget.checked ? idx + 1 : idx;
				await this.actor.update({ [`flags.stonetop-pwd.${path}`]: newVal });
				this.render(false);
			});

			// Restore the abstracted group-fight pool to full (clears the override).
			// A data-slug marks a custom group's pool; without one it's the crew's.
			html.find(".stonetop-group-hp-reset").on("click", async ev => {
				const slug = ev.currentTarget.dataset.slug;
				if (slug) await this.actor.update({ [`flags.stonetop-pwd.customFollowers.${slug}.groupHp`]: null });
				else      await this.actor.unsetFlag(STONETOP_SCOPE, "crew.groupHp");
				this.render(false);
			});

			// Custom group roster size (mirrors the crew size stepper). Clamps the
			// abstracted group-HP pool down when the group shrinks, and drops any
			// per-member HP entries beyond the new size, so nothing stale is left.
			const setCustomGroupSize = async (slug, next) => {
				const c = this.actor.getFlag(STONETOP_SCOPE, `customFollowers.${slug}`);
				if (!c) return;
				const size = customGroupSize({ size: next });
				const memberHpMax = Math.max(1, Math.trunc(Number(c.hpMax) || 0) || 1);
				const update = { [`flags.stonetop-pwd.customFollowers.${slug}.size`]: size };
				// Trim per-member HP to the new roster length.
				if (Array.isArray(c.memberHp) && c.memberHp.length > size) {
					update[`flags.stonetop-pwd.customFollowers.${slug}.memberHp`] = c.memberHp.slice(0, size);
				}
				// And their faces, which are an array parallel to that HP (roster-portraits.js).
				if (Array.isArray(c.memberPortrait) && c.memberPortrait.length > size) {
					update[`flags.stonetop-pwd.customFollowers.${slug}.memberPortrait`] = c.memberPortrait.slice(0, size);
				}
				// Clamp an explicitly-set group pool to the new max (unset tracks full).
				const rawPool = Number(c.groupHp);
				if (Number.isFinite(rawPool)) {
					const max = size * memberHpMax;
					if (rawPool > max) update[`flags.stonetop-pwd.customFollowers.${slug}.groupHp`] = max;
				}
				await this.actor.update(update);
				this.render(false);
			};
			html.find(".stonetop-custom-group-size-step").on("click", ev => {
				const { slug, delta } = ev.currentTarget.dataset;
				const cur = customGroupSize({ size: this.actor.getFlag(STONETOP_SCOPE, `customFollowers.${slug}.size`) });
				setCustomGroupSize(slug, cur + Number(delta));
			});
			html.find(".stonetop-custom-group-size-input").on("change", ev =>
				setCustomGroupSize(ev.currentTarget.dataset.slug, ev.currentTarget.value));

			// Remember which collapsible crew sections are open across re-renders and,
			// via the persisted per-actor setting, across sheet reopens. Native
			// <details> already updates the DOM, so we only record the state (no
			// re-render) for the next render to honour.
			html.find(".stonetop-crew-collapsible").on("toggle", ev => {
				const id = ev.currentTarget.dataset.section;
				if (!id) return;
				this._openCrewSections ??= new Set();
				if (ev.currentTarget.open) this._openCrewSections.add(id);
				else                       this._openCrewSections.delete(id);
				this._persistCrewSections();
			});

			// Collapse / expand the sidebar move groups (Basic / Expedition). A custom
			// toggle rather than <details> keeps the move list in normal flow and
			// contributing its width, so the sidebar doesn't reflow (jitter) when a
			// group collapses. Collapsed ids are persisted (default expanded).
			this._wireCollapsible(html, {
				summarySel:     ".stonetop-moves-summary",
				collapsibleSel: ".stonetop-moves-collapsible",
				getSet:         () => (this._collapsedMoveSections ??= new Set()),
				persist:        () => this._persistMoveSections(),
			});

			// Collapse / expand the Arcana sections (Major / Minor arcanum). Same custom-
			// toggle approach as the move groups: the heading is the summary and the card
			// grid below clamps to zero height (keeping its masonry packing intact).
			this._wireCollapsible(html, {
				summarySel:     ".stonetop-arcana-summary",
				collapsibleSel: ".stonetop-arcana-collapsible",
				getSet:         () => (this._collapsedArcanaSections ??= new Set()),
				persist:        () => this._persistArcanaSections(),
			});

			// Collapse / expand an individual arcanum card down to its title bar. The
			// corner chevron is the summary; the card body/footer clamp away. Re-pack the
			// masonry after each toggle so the two columns re-balance for the card's new
			// height. Collapsed card slugs persist per actor (default expanded).
			this._wireCollapsible(html, {
				summarySel:     ".stonetop-arcanum-collapse-btn",
				collapsibleSel: ".stonetop-arcanum-card",
				getSet:         () => (this._collapsedArcanaCards ??= new Set()),
				persist:        () => this._persistArcanaCards(),
				onToggle:       () => this._repackArcana?.(),
			});

			// Collapse / expand the whole moves sidebar. Shared with the steading sheet and the
			// expedition walkthrough's rail (utils/sidebar-toggle.js); the state is persisted
			// per actor, so the sidebar reopens the way it was left.
			wireSidebarToggle(html, {
				expandLabel:   "Expand moves sidebar",
				collapseLabel: "Collapse moves sidebar",
				persist:       collapsed => setSidebarCollapsed(this.actor?.id, collapsed),
			});

			// Name an (anonymous) crew member: promote them to a named individual,
			// carrying their current HP across. Opened from each member's "Name them"
			// button in edit mode, which targets that specific roster slot.
			const openNameMemberDialog = async (anonIndex) => {
				// Fall back to the shared crew suggestion lists (module/data/steading-members.js)
				// when the playbook pack doesn't carry its own crew.individualOptions.
				const playbookDoc = await this._stonetopCharacter.playbook();
				const indOpts     = playbookDoc?.flags?.stonetop?.crew?.individualOptions ?? {};
				const names  = indOpts.names?.length  ? indOpts.names  : CREW_INDIVIDUAL_NAMES;
				const tags   = indOpts.tags?.length   ? indOpts.tags   : CREW_INDIVIDUAL_TAGS;
				const traits = indOpts.traits?.length ? indOpts.traits : CREW_INDIVIDUAL_TRAITS;

				const namesHtml = names.map(n => `<option value="${n}">`).join("");
				const tagsHtml  = tags.map(t => `<option value="${t}"></option>`).join("");

				// -- Trait tokenizer ---------------------------------------
				// Splits a trait into: text | standalone __ | slash-option group
				// e.g. "missing eye/finger/hand/__" ?
				//   [text:"missing "], [opts:["eye","finger","hand","__"]]
				// e.g. "__'s kid/sibling/parent/cousin/__" ?
				//   [blank], [text:"'s "], [opts:["kid","sibling","parent","cousin","__"]]
				const tokenize = str => {
					const tokens = [];
					// Greedy: standalone __, then slash-group, then whitespace, then word
					const re = /__|(?:[^\s/]+(?:\/[^\s/]+)+)|[^\s/]+|\s+/g;
					let m;
					while ((m = re.exec(str)) !== null) {
						if (m[0] === "__")         tokens.push({ type: "blank" });
						else if (m[0].includes("/")) tokens.push({ type: "opts", opts: m[0].split("/") });
						else                         tokens.push({ type: "text", text: m[0] });
					}
					return tokens;
				};

				// Build one chip's inner HTML from its tokens, tracking slot indices.
				// Slash-option slots are free-type combos: the slash choices become
				// <datalist> suggestions, but you can type anything (replacing the old
				// "___ (type your own)" select option). traitIndex keeps datalist ids unique.
				const buildChipInner = (tokens, safeVal, traitIndex) => {
					let html    = `<input type="checkbox" class="stonetop-check" name="traits" value="${safeVal}">`;
					let slotIdx = 0;
					for (const tok of tokens) {
						if (tok.type === "text") {
							html += `<span class="stonetop-trait-text">${tok.text}</span>`;
						} else if (tok.type === "blank") {
							const s = slotIdx++;
							html += `<span class="stonetop-trait-blank">___</span>`;
							html += `<input type="text" class="stonetop-trait-fill" data-slot="${s}" style="display:none" placeholder="…">`;
						} else { // opts
							const s        = slotIdx++;
							const realOpts = tok.opts.filter(o => o !== "__");
							const display  = tok.opts.map(o => o === "__" ? "___" : o).join("/");
							const listId   = `trait-opts-${traitIndex}-${s}`;
							const optHtml  = realOpts.map(o => `<option value="${o.replace(/"/g, "&quot;")}"></option>`).join("");
							html += `<span class="stonetop-trait-blank">${display}</span>`;
							html += `<input type="text" class="stonetop-trait-select" data-slot="${s}" list="${listId}" style="display:none" placeholder="…" autocomplete="off">`;
							html += `<datalist id="${listId}">${optHtml}</datalist>`;
						}
					}
					return html;
				};

				const traitsHtml = traits.map((t, ti) => {
					const safeVal = t.replace(/"/g, "&quot;");
					const tokens  = tokenize(t);
					const simple  = tokens.every(tok => tok.type === "text");
					if (simple) {
						return `<span class="stonetop-trait-chip-group">
							<label class="stonetop-individual-trait-chip">
								<input type="checkbox" class="stonetop-check" name="traits" value="${safeVal}"> ${t}
							</label>
						</span>`;
					}
					return `<span class="stonetop-trait-chip-group" data-trait="${safeVal}">
						<label class="stonetop-individual-trait-chip">
							${buildChipInner(tokens, safeVal, ti)}
						</label>
					</span>`;
				}).join("");

				const content = `
					<form class="stonetop-individual-form">
						<div class="form-group">
							<label>Name</label>
							<input type="text" name="ind-name" list="ind-names" placeholder="Enter a name…">
							<datalist id="ind-names">${namesHtml}</datalist>
						</div>
						<div class="form-group">
							<label>Tag</label>
							<input type="text" name="ind-tag" list="ind-tags" placeholder="Choose or type a tag…" autocomplete="off">
							<datalist id="ind-tags">${tagsHtml}</datalist>
						</div>
						<div class="form-group stonetop-individual-traits-group">
							<label>Traits <em>(choose one or more)</em></label>
							<div class="stonetop-individual-traits-grid">${traitsHtml}</div>
						</div>
					</form>`;

				new Dialog({
					title:   "Name this Crew Member",
					content,
					// One button, keyed `save`. NOT `add`: that key is in the global affirmative list
					// (`.vtt .dialog .dialog-buttons [data-button="add"]`), which pushes its button to
					// the far LEFT with `margin-right: auto` so a Cancel can sit opposite it. With
					// nothing to sit opposite, that rule would strand the lone button on the left.
					// Closing the window is the cancel — the titlebar ✕ already does it.
					buttons: {
						save: {
							icon:  "<i class='fas fa-user-pen'></i>",
							label: "Save",
							callback: async (dlgHtml) => {
								const name = dlgHtml.find("[name='ind-name']").val().trim();
								if (!name) return;
								const tag    = dlgHtml.find("[name='ind-tag']").val().trim();
								const traits = [];
								dlgHtml.find("[name='traits']:checked").each((_, cb) => {
									const group  = cb.closest(".stonetop-trait-chip-group");
									const tokens = tokenize(cb.value);
									let slotIdx  = 0;
									let result   = "";
									for (const tok of tokens) {
										if (tok.type === "text") {
											result += tok.text;
										} else if (tok.type === "blank") {
											const s  = slotIdx++;
											const el = group.querySelector(`.stonetop-trait-fill[data-slot="${s}"]`);
											result  += el?.value.trim() || "__";
										} else { // opts
											const s   = slotIdx++;
											const sel = group.querySelector(`.stonetop-trait-select[data-slot="${s}"]`);
											const val = sel?.value.trim();
											result += val || tok.opts.find(o => o !== "__") || tok.opts[0];
										}
									}
									traits.push(result);
								});
								// Promote the targeted anonymous member: append the named
								// individual, carry its current HP over, and drop it from
								// the anonymous-member HP list.
								const individuals   = [...(this.actor.getFlag(STONETOP_SCOPE, "crew.individuals") ?? [])];
								const newIndex      = individuals.length;
								const memberHp      = [...(this.actor.getFlag(STONETOP_SCOPE, "crew.memberHp") ?? [])];
								const carriedHp     = memberHp[anonIndex];
								const individualsHp = { ...(this.actor.getFlag(STONETOP_SCOPE, "crew.individualsHp") ?? {}) };
								if (carriedHp != null) individualsHp[newIndex] = carriedHp;
								memberHp.splice(anonIndex, 1);
								// The face comes with them. Standing out is the moment a body on the
								// roster becomes a person, so losing the portrait here would be the
								// one point in the crew's life where a chosen face is thrown away.
								// It moves OUT of the parallel array and ONTO the new row, which is
								// where a named individual keeps theirs (roster-portraits.js).
								const memberPortrait = rosterPortraitList(this.actor, "crew-member");
								const [carriedFace]  = memberPortrait.splice(anonIndex, 1);
								const named = { name, tag, traits };
								if (carriedFace?.img)           named.img           = carriedFace.img;
								if (carriedFace?.portraitFrame) named.portraitFrame = carriedFace.portraitFrame;
								const update = {
									"flags.stonetop-pwd.crew.individuals":   [...individuals, named],
									"flags.stonetop-pwd.crew.individualsHp": individualsHp,
									"flags.stonetop-pwd.crew.memberHp":      memberHp,
								};
								// Only when the store exists: a crew that has never picked a face
								// should not gain an empty array the first time it names somebody.
								if (memberPortrait.length || carriedFace !== undefined) {
									update["flags.stonetop-pwd.crew.memberPortrait"] = memberPortrait;
								}
								await this.actor.update(update);
								this.render(false);
							},
						},
					},
					default: "save",
					render: (dlgHtml) => {
						bringDialogToFront(dlgHtml);
						// Swap the name/tag/trait combos' native <datalist> popups (which
						// lose their scrollbar when long, crbug.com/375637) for our
						// scrollable one. See utils/autocomplete.js.
						StonetopAutocomplete.upgradeAll(dlgHtml);
						// Checkbox toggle: expand/collapse the chip
						dlgHtml.find("[name='traits']").on("change", ev => {
							const group   = ev.currentTarget.closest(".stonetop-trait-chip-group");
							const checked = ev.currentTarget.checked;
							group?.classList.toggle("is-selected", checked);
							group?.querySelectorAll(".stonetop-trait-blank").forEach(el =>
								el.style.display = checked ? "none" : ""
							);
							group?.querySelectorAll(".stonetop-trait-fill, .stonetop-trait-select").forEach(el => {
								el.style.display = checked ? "inline-block" : "none";
								if (!checked) el.value = "";
							});
						});
					},
					// "stonetop" is what carries our window CHROME — the header bar, the content
					// parchment, the focus glow — all of which is scoped to that class so it cannot
					// bleed onto core or another module's windows. Without it this dialog kept
					// Foundry's default dark header and textured body while still picking up its own
					// `.stonetop-individual-dialog` form and button rules, which is why it looked
					// half-styled rather than plainly unstyled.
					// height "auto", not a fixed 580: this dialog is three short fields and a chip
					// list, so a fixed height left ~226px of dead air between the traits and the
					// footer. The trait grid caps itself at 340px and scrolls, so "auto" cannot run
					// away on a crew with a long trait list. Resizing the window taller still keeps
					// Save in the bottom-right corner — that is what the footer's margin-top:auto is
					// for, and it now only does work when there IS slack to take up.
				}, { width: 540, height: "auto", classes: ["dialog", "stonetop", "stonetop-individual-dialog"] }).render(true);
			};
			html.find(".stonetop-crew-name-member").on("click", ev => {
				openNameMemberDialog(Number(ev.currentTarget.dataset.index));
			});
			html.find(".stonetop-inventory-reset-btn").on("click", this._onInventoryReset.bind(this));

			// -- Followers: group fight outnumber calculator --
			html[0].addEventListener("input", ev => {
				const inp = ev.target;
				if (!inp.classList.contains("stonetop-outnumber-yours") && !inp.classList.contains("stonetop-outnumber-theirs")) return;
				const row    = inp.closest(".stonetop-group-fight-outnumber-row");
				if (!row) return;
				const { label, rollFor } = outnumberBonus(
					row.querySelector(".stonetop-outnumber-yours")?.value,
					row.querySelector(".stonetop-outnumber-theirs")?.value,
				);
				const resultEl = row.querySelector(".stonetop-outnumber-result");
				if (resultEl) resultEl.textContent = label;
				const section  = row.closest(".stonetop-group-fight-section");
				const dmgBtn   = section?.querySelector(".stonetop-group-fight-dmg-roll");
				const dmgLabel = section?.querySelector(".stonetop-group-fight-dmg-label");
				// Build on the crew's actual damage die (carried in data-base-roll,
				// which honours any Damage override), not a hardcoded d6.
				const roll     = rollFor(dmgBtn?.dataset.baseRoll);
				if (dmgBtn)   dmgBtn.dataset.roll     = roll;
				if (dmgLabel) dmgLabel.textContent    = roll;
			}, true);

			// -- Followers: Order (direct any follower to make a move, p.462) --
			// Every way in comes through here: the per-card Order button, a named crew
			// member's own button, and both groups' Clash / Let Fly. The crew's
			// group-fight buttons used to shortcut straight to a roll on the pre-baked
			// `rollMod` the card shows, which meant a group could never come out with
			// disadvantage even when a shared tag was plainly in the way — and that
			// modifier is only ever "+1 if a tag applies, +2 if exceptional", which is
			// exactly what the dialog derives anyway.
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-follower-order");
				if (!btn) return;
				ev.stopPropagation();
				const pipeList = (raw) => (raw || "").split("|").map(s => s.trim()).filter(Boolean);
				const follower = {
					name:        btn.dataset.followerName || "Follower",
					tags:        pipeList(btn.dataset.tags),
					// Their moves count toward the same bonus as their tags (p.462).
					moves:       pipeList(btn.dataset.moves),
					exceptional: btn.dataset.exceptional === "true",
					// A group-fight Clash/Let Fly button pre-selects that move; the plain
					// Order button leaves it at the default (Defy Danger).
					moveKey:     btn.dataset.moveKey || null,
				};
				const ftype = btn.dataset.ftype, slug = btn.dataset.slug ?? "";
				new OrderFollowersDialog(this.actor, follower,
					async (result) => {
						const roll = await this._stonetopCharacter.onOrderFollowersRoll(result);
						await this._maybeHoldReadinessOnDefend(ftype, slug, result, roll);
					},
					{ classes: this._pastDeathWindowClasses(OrderFollowersDialog.defaultOptions.classes) },
				).render(true);
			}, true);

			html.find(".stonetop-invocation-check").on("change", async ev => {
				const { slug } = ev.currentTarget.dataset;
				const current = this.actor.getFlag(STONETOP_SCOPE, "invocations.selected") ?? [];
				const updated = ev.currentTarget.checked
					? [...current, slug]
					: current.filter(s => s !== slug);
				await this.actor.setFlag(STONETOP_SCOPE, "invocations.selected", updated);
				this.render(false);
			});
			// Tapping an Invocation's title uses it: the window asks whether to Invoke the Sun
			// God (+WIS) and whether to empower it, then posts the card and rolls.
			html.find(".stonetop-invocation-name").on("click", ev => {
				const card = ev.currentTarget.closest(".stonetop-invocation-card");
				if (!card) return;
				const name = ev.currentTarget.textContent.trim();
				const description = card.querySelector(".stonetop-invocation-desc")?.innerHTML ?? "";
				// The whole list is on the tab, learned or not — a 1st-level Lightbearer knows 2
				// of 10 — and Invoke the Sun God is "choose an Invocation YOU KNOW and roll +WIS".
				// So an un-learned one is still readable (tap it, get the text) but is not
				// offered the roll: the same line this sheet draws for moves, where the roll is
				// what's gated and the reading is not.
				const known = !card.classList.contains("is-unknown");
				// Which Invocation this is, and whether it is one of the six that keep running —
				// read off the card rather than matched by name, since the name in the DOM is the
				// printed label and the state is keyed by slug.
				const { slug = "", ongoing } = card.dataset;
				// Shift is "skip the roll prompt" everywhere a roll starts; carry it through so
				// the Invocation's roll honours it too.
				this._postInvocationCard(name, description, {
					shiftKey: ev.shiftKey, known, slug, ongoing: ongoing === "1",
				});
			});
			html.find(".stonetop-other-move-delete").on("click", ev => {
				const { itemId } = ev.currentTarget.dataset;
				const item = this.actor.items.get(itemId);
				// Custom moves are read-only for players when authoring is GM-only — don't
				// let them delete a GM-authored custom move either (matches the hidden +/pencil).
				if (item?.flags?.[STONETOP_SCOPE]?.custom && !canAuthorCustomMoves()) return;
				const name = item?.name || "this move";
				Dialog.confirm({
					title:   "Remove move",
					content: `<p>Remove <strong>${escHtml(name)}</strong> from your moves? This can't be undone.</p>`,
					yes:     () => this._stonetopCharacter.removeMove(itemId),
					render:  bringDialogToFront,
					options: { classes: ["dialog", "stonetop"] },
				});
			});

			const openCustomMove = (item = null) => {
				if (!this.isEditable || !canAuthorCustomMoves()) return;
				new CustomMoveDialog(characterMoveSaver(this._stonetopCharacter), {
					item,
					onSaved: () => this.render(false),
				}).render(true);
			};
			// Learned toggle on an Other Moves row: un-checking keeps it on the sheet but
			// inactive (not rollable, bonuses off); re-checking re-learns it. The authoring gate
			// applies to CUSTOM moves only — it exists so a player can't alter a GM-authored
			// homebrew when authoring is GM-only. A shipped move that landed here (a foreign
			// playbook move dropped on the sheet) isn't anyone's homebrew, so it answers to
			// isEditable alone — the same rule the delete affordance beside it already uses.
			html.find(".stonetop-other-move-learned").on("change", async ev => {
				if (!this.isEditable) return;
				const itemId = ev.currentTarget.dataset.itemId;
				const item   = this.actor.items.get(itemId);
				if (item?.flags?.[STONETOP_SCOPE]?.custom && !canAuthorCustomMoves()) return;
				await this._stonetopCharacter.setMoveLearned(itemId, ev.currentTarget.checked);
				this.render(false);
			});
			html.find(".stonetop-add-custom-move").on("click", () => openCustomMove());
			html.find(".stonetop-custom-move-edit").on("click", ev => {
				const item = this.actor.items.get(ev.currentTarget.dataset.itemId);
				if (item) openCustomMove(item);
			});

			// Love letters (Book I p.568). "Read letter" opens the letter in a reader modal;
			// resolving from there rolls/posts it like any move, then consumes it (single-use)
			// — the last one takes its section with it. Edit and delete are GM-only affordances
			// (canAuthorLoveLetters gates the markup too).
			html.find(".stonetop-love-letter-read").on("click", ev => {
				const itemId = ev.currentTarget.dataset.itemId;
				const item = this.actor.items.get(itemId);
				if (!item) return void ui.notifications.warn("That love letter is no longer on this character.");
				new LoveLetterReadDialog({
					item,
					actor: this.actor,
					onResolve: () => this._onResolveLoveLetter(itemId),
				}).render(true);
			});
			html.find(".stonetop-love-letter-edit").on("click", ev => {
				if (!game.user.isGM) return;
				const item = this.actor.items.get(ev.currentTarget.dataset.itemId);
				if (item) new LoveLetterDialog({ item, actor: this.actor, onSaved: () => this.render(false) }).render(true);
			});
			html.find(".stonetop-love-letter-delete").on("click", ev => {
				if (!game.user.isGM) return;
				const item = this.actor.items.get(ev.currentTarget.dataset.itemId);
				if (!item) return;
				Dialog.confirm({
					title:   game.i18n.localize("stonetop.character.moves.loveLetter.deleteMove"),
					content: `<p>${game.i18n.format("stonetop.character.moves.loveLetter.deleteConfirm", { name: escHtml(item.name) })}</p>`,
					yes:     () => item.delete(),
					render:  bringDialogToFront,
					options: { classes: ["dialog", "stonetop"] },
				});
			});

			html[0].addEventListener("click", ev => {
				const title = ev.target.closest(".stonetop-arcanum-title--clickable");
				if (!title) return;
				ev.stopPropagation();
				const { slug, flipped } = title.dataset;
				this._stonetopCharacter.getArcanumChatContent(slug, flipped === "true").then(content => {
					if (!content) return;
					// applyRollMode sets whisper/blind from the configured roll mode; passing
					// rollMode as a create-data key alone does nothing, so a "Private GM Roll"
					// setting would still broadcast a referenced card back to every player.
					const messageData = {
						content,
						speaker: ChatMessage.getSpeaker({ actor: this.actor }),
					};
					ChatMessage.applyRollMode(messageData, game.settings.get("core", "rollMode"));
					return ChatMessage.create(messageData);
				}).catch(err => console.error("Stonetop | could not post the arcanum card", err));
			}, true);

			// A mystery on a card's back is a move, so its NAME behaves like a move's name on the
			// moves tab: click it to open the move (options to tick, dice when it rolls), or to
			// post it to chat when there is nothing to choose. The handles are wrapped into the
			// card's own prose at snapshot time — see data/arcana-moves.js.
			html[0].addEventListener("click", ev => {
				const handle = ev.target.closest(".stonetop-arcanum-move-name");
				if (!handle) return;
				ev.stopPropagation();
				this._onArcanumMoveName(handle.dataset.arcanumSlug, handle.dataset.moveSlug);
			}, true);
			html[0].addEventListener("keydown", ev => {
				if (ev.key !== "Enter" && ev.key !== " ") return;
				const handle = ev.target.closest?.(".stonetop-arcanum-move-name");
				if (!handle) return;
				ev.preventDefault();
				ev.stopPropagation();
				this._onArcanumMoveName(handle.dataset.arcanumSlug, handle.dataset.moveSlug);
			}, true);

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-identify-btn");
				if (!btn) return;
				ev.stopPropagation();
				this._onArcanumKnowThings(btn.dataset.slug, { shiftKey: ev.shiftKey });
			}, true);

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-givecard-btn");
				if (!btn) return;
				ev.stopPropagation();
				this._onArcanumGiveCard(btn.dataset.slug);
			}, true);

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-backowed-btn");
				if (!btn) return;
				ev.stopPropagation();
				this._onArcanumStudyBack(btn.dataset.slug);
			}, true);

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-discover-btn");
				if (!btn) return;
				ev.stopPropagation();
				const { slug } = btn.dataset;
				Dialog.confirm({
					title: game.i18n.localize("stonetop.arcana.discoverTitle"),
					content: `<p>${game.i18n.localize("stonetop.arcana.discoverConfirm")}</p>`,
					yes: () => this._stonetopCharacter.discoverArcanum(slug).then(() => this.render(false)),
					render: bringDialogToFront,
					options: { classes: ["dialog", "stonetop"] },
				});
			}, true);

			html[0].addEventListener("click", ev => {
				const thumb = ev.target.closest(".stonetop-arcanum-thumb, .stonetop-lore-arcana-img");
				if (!thumb) return;
				ev.stopPropagation();
				imagePopout({ src: thumb.src, title: thumb.dataset.name })?.render(true);
			}, true);

			// Hovering a card's art pops a larger preview beside it (click still opens the
			// full ImagePopout, above), through the same shared util the relationship and
			// steading portraits use — placed to the RIGHT because the thumb sits at the far
			// left of each card, where there is room beside it.
			wireAvatarPreview(html[0], ".stonetop-arcanum-thumb, .stonetop-lore-arcana-img",
				{ placement: "right", variant: "stonetop-avatar-preview--art" });

			// "Show both sides" ⇄ "show front only" toggle (available in and out of edit
			// mode). Persists a PER-USER display preference so the card renders as a front|back
			// spread while reading in play mode. Stored on the viewing user, so the GM's and the
			// owning player's choices are independent. It never overrides back permission — the
			// button is only rendered for cards whose back this viewer may already see.
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-showboth-btn");
				if (!btn) return;
				ev.stopPropagation();
				const { slug, show } = btn.dataset;
				this._renderAfter(this._toggleArcanumShowBoth(slug, show !== "true"));
			}, true);

			// "Show back" ⇄ "Show front" single-side flip. A sibling PER-USER preference to
			// show-both; it swaps which lone side renders while the card isn't spread. Same
			// permission guard — only ever offered for a back this viewer may already see.
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-flip-btn");
				if (!btn) return;
				ev.stopPropagation();
				const { slug, show } = btn.dataset;
				this._renderAfter(this._toggleArcanumShowBack(slug, show !== "true"));
			}, true);

			// GM-only: in secretive mode (setting off), toggle whether the owning player can
			// peek at a still-LOCKED card's back (the button is hidden once unlocked — the
			// owner sees it then — and hidden entirely when the peek setting is on). Writing
			// the actor flag propagates to the player's open sheet, which re-renders.
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-reveal-btn");
				if (!btn || !game.user.isGM) return;
				ev.stopPropagation();
				const { slug, revealed } = btn.dataset;
				const action = revealed === "true"
					? this._stonetopCharacter.hideArcanum(slug)
					: this._stonetopCharacter.revealArcanum(slug);
				this._renderAfter(action);
			}, true);

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-summon-btn");
				if (!btn || btn.disabled) return;
				ev.stopPropagation();
				this._onArcanaSummon(btn.dataset.slug);
			}, true);

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-resource-btn");
				if (!btn) return;
				ev.stopPropagation();
				const { slug, index, resourceKind } = btn.dataset;
				const isChecked = btn.classList.contains("is-checked");
				const newVal = isChecked ? Number(index) : Number(index) + 1;
				// Reflect the new fill in place and persist WITHOUT a re-render. An arcana
				// resource track is self-contained — nothing else on the sheet derives from its
				// count — and a full re-render repacks the arcana masonry, which jumps the tab's
				// scroll position on every click. Toggle the track's own buttons directly (a
				// button at index i is filled when i < count, matching the resourceChecks helper).
				btn.parentElement.querySelectorAll(".stonetop-arcanum-resource-btn").forEach(b =>
					b.classList.toggle("is-checked", Number(b.dataset.index) < newVal));
				// A card's back-ITEM resource is keyed `${slug}:item` so it never shares storage
				// with the back-power resource on the same card (see CharacterArcana buildSnapshot).
				const key = resourceKind === "item" ? `${slug}:item` : slug;
				this._stonetopCharacter.setArcanumResource(key, newVal, { render: false });
			}, true);

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcanum-delete");
				if (!btn) return;
				ev.stopPropagation();
				const { slug } = btn.dataset;
				const title = btn.closest(".stonetop-arcanum-card")
					?.querySelector(".stonetop-arcanum-title")?.textContent?.trim() || "this arcanum";
				Dialog.confirm({
					title:   "Remove arcanum",
					content: `<p>Remove <strong>${escHtml(title)}</strong> from your arcana? This can't be undone.</p>`,
					// render(false) via _renderAfter, not render(true): every sibling handler
					// repaints in place, while force re-opens the window and resets its position.
					// The catch matters more — a failed removal used to leave the card the user
					// was just told was gone sitting on the sheet with nothing logged.
					yes:     () => this._renderAfter(
						this._pruneArcanumUserPrefs(slug)
							.then(() => this._stonetopCharacter.removeArcanum(slug))),
					render:  bringDialogToFront,
					options: { classes: ["dialog", "stonetop", "stonetop-remove-arcanum-dialog"] },
				});
			}, true);

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-arcana-create");
				if (!btn) return;
				ev.stopPropagation();
				this._onArcanaCreate(btn.dataset.major === "true");
			}, true);

			html[0].addEventListener("change", ev => {
				const cb = ev.target.closest(".stonetop-arcanum-unlock-check");
				if (!cb) return;
				const { arcanumSlug, optionSlug, index } = cb.dataset;
				const newCount = cb.checked ? Number(index) + 1 : Number(index);
				this._stonetopCharacter.setArcanumUnlockCount(arcanumSlug, optionSlug, newCount);
			}, true);

			html[0].addEventListener("change", ev => {
				const cb = ev.target.closest(".stonetop-arcanum-box, .stonetop-arcanum-circle, .stonetop-arcanum-diamond");
				if (!cb) return;
				ev.stopPropagation();
				const { arcanumSlug, context, index } = cb.dataset;
				this._stonetopCharacter.setArcanumBoxChecked(arcanumSlug, context, Number(index), cb.checked);
			}, true);

			html[0].addEventListener("change", ev => {
				const cb = ev.target.closest(".stonetop-lore-option-check");
				if (!cb || ev.target.closest("[data-pdi='lore']")) return;
				const { loreSlug, optionSlug, idx } = cb.dataset;
				const newCount = cb.checked ? Number(idx) + 1 : Number(idx);
				this._stonetopCharacter.setLoreOptionCount(loreSlug, optionSlug, newCount);
			}, true);

			html[0].addEventListener("change", ev => {
				const ta = ev.target.closest(".stonetop-lore-option-text");
				if (!ta || ev.target.closest("[data-pdi='lore']")) return;
				const { loreSlug, optionSlug } = ta.dataset;
				this._stonetopCharacter.setLoreOptionText(loreSlug, optionSlug, ta.value);
			}, true);

			html[0].addEventListener("change", ev => {
				const sel = ev.target.closest(".stonetop-lore-arcana-select");
				if (!sel) return;
				this._stonetopCharacter.setMinorArcanumRole(sel.dataset.role, sel.value);
			}, true);

			html[0].addEventListener("change", ev => {
				const cb = ev.target.closest(".stonetop-move-mark-check");
				if (cb) {
					const { moveName, markSlug, idx } = cb.dataset;
					this._stonetopCharacter.setCountMark(moveName, markSlug, cb.checked ? Number(idx) + 1 : Number(idx));
					return;
				}
				const sel = ev.target.closest(".stonetop-move-mark-stat");
				if (sel) {
					const { moveName, markSlug, idx } = sel.dataset;
					this._stonetopCharacter.setStatSlot(moveName, markSlug, Number(idx), sel.value);
					return;
				}
				const lvl = ev.target.closest(".stonetop-move-mark-level");
				if (lvl) {
					const { moveName, markSlug, idx } = lvl.dataset;
					this._stonetopCharacter.setMarkLevel(moveName, markSlug, Number(idx), parseInt(lvl.value, 10));
				}
			}, true);

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-pdi-activate");
				if (!btn) return;
				ev.stopPropagation();
				this._renderAfter(this._stonetopCharacter.setPostDeathInsert(btn.dataset.slug));
			}, true);

			// The Ghost's tether. Saved on blur (not per keystroke) so naming it doesn't re-render
			// the sheet out from under the cursor.
			html.find(".stonetop-pdi-tether-input").on("change", ev => {
				this._renderAfter(this._stonetopCharacter.setTether(ev.currentTarget.value));
			});

			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-pdi-remove");
				if (!btn) return;
				ev.stopPropagation();
				this._renderAfter(this._stonetopCharacter.setPostDeathInsert(null));
			}, true);

			// Send the whole tab away. The tab it is drawn on goes with it, so the re-render lands
			// on another one — core's Tabs#activate falls back to the first when the stored tab is
			// no longer in the nav.
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".stonetop-pdi-hide-tab");
				if (!btn) return;
				ev.stopPropagation();
				if (!this.isEditable) return;
				this._renderAfter(this._stonetopCharacter.setPostDeathTabRequested(false));
			}, true);

			// These radios now render in ordinary play too, not just edit mode (an unanswered
			// Instinct — see postDeathInstinctOpen), so the write needs the editability guard the
			// edit-mode-only version got for free from the tab never drawing them.
			html[0].addEventListener("change", ev => {
				const radio = ev.target.closest(".stonetop-pdi-instinct");
				if (!radio) return;
				if (!this.isEditable) return;
				this._stonetopCharacter.setPostDeathInstinct(radio.value);
			}, true);

			// The write-in answers hung off a post-death pick: who the Terrible Purpose is about,
			// what a Revenant with STRANGE APPETITES eats. Live outside edit mode while unanswered,
			// for the same reason the Instinct above is — Death's Door's chooser is a one-shot step
			// and there are three routes to an insert that never pass through it. Text saves on
			// blur, not per keystroke, so naming your Purpose doesn't re-render out from under the
			// cursor; the radios re-render to move the tick.
			html[0].addEventListener("change", ev => {
				const el = ev.target.closest(".stonetop-pdi-writein, .stonetop-pdi-writein-pick");
				if (!el) return;
				if (!this.isEditable) return;
				this._renderAfter(this._stonetopCharacter
					.setPostDeathLoreText(el.dataset.section, el.dataset.option, el.value));
			}, true);

			html[0].addEventListener("change", ev => {
				if (!ev.target.closest("[data-pdi='lore']")) return;
				const cb = ev.target.closest(".stonetop-lore-option-check");
				if (!cb) return;
				const { loreSlug, optionSlug, idx } = cb.dataset;
				const newCount = cb.checked ? Number(idx) + 1 : Number(idx);
				this._stonetopCharacter.setPostDeathLoreCount(loreSlug, optionSlug, newCount);
			}, true);

			html[0].addEventListener("change", ev => {
				if (!ev.target.closest("[data-pdi='lore']")) return;
				const ta = ev.target.closest(".stonetop-lore-option-text");
				if (!ta) return;
				const { loreSlug, optionSlug } = ta.dataset;
				this._stonetopCharacter.setPostDeathLoreText(loreSlug, optionSlug, ta.value);
			}, true);

			// (Pronoun is a structural field routed through the shared
			// .stonetop-follower-name-field change handler above.)

			// -- Followers tab: HP tracking --------------------------------
			html[0].addEventListener("change", async ev => {
				const input = ev.target.closest(".stonetop-follower-hp-input");
				if (!input) return;
				const max = Number(input.max);
				// Clamp to the field's max on write, not just on the next render's
				// display — otherwise a typed over-max value (the max= attribute is
				// advisory) would persist and resurface if the max later grows.
				let val = Math.max(0, parseInt(input.value, 10) || 0);
				if (Number.isFinite(max) && max > 0) val = Math.min(val, max);
				const { follower, slug, index } = input.dataset;
				// Watch for a named single follower (animal companion / initiate / beast /
				// custom — not the crew, not livestock) crossing from alive to 0 HP, so we
				// can prompt for its fate (p.469 + Loyal to the End) after the write.
				const fateTypes = new Set(["animal-companion", "initiate", "beast", "custom"]);
				const fateHpPaths = {
					"animal-companion": "animalCompanion.hpCurrent",
					"initiate":         `initiatesHp.${slug}`,
					"beast":            `beastHp.${slug}`,
					"custom":           `customFollowers.${slug}.hpCurrent`,
				};
				const fateEligible = val === 0
					&& fateTypes.has(follower)
					&& !input.closest(".stonetop-follower-card--livestock");
				// "unset" HP means full (see _clampHp) — so an undefined previous value
				// counts as alive; only an explicit 0 means they were already down.
				const wasAlive = fateEligible
					&& Number(this.actor.getFlag(STONETOP_SCOPE, fateHpPaths[follower])) !== 0;
				await this._setFollowerHp(follower, slug, index, val);
				// Reviving a fallen custom follower (HP back above 0) clears its "dead" mark so
				// the card returns to normal — a mirror of the fate dialog's "Dead" outcome.
				if (follower === "custom" && slug && val > 0
					&& this.actor.getFlag(STONETOP_SCOPE, `customFollowers.${slug}.dead`)) {
					await this.actor.update({ [`flags.stonetop-pwd.customFollowers.${slug}.dead`]: false });
				}
				// Capture the follower's display name off the live card BEFORE the
				// re-render detaches this input from the DOM.
				const fateName = wasAlive
					? (input.closest(".stonetop-follower-card")?.querySelector(".stonetop-follower-order")?.dataset.followerName
						|| input.closest(".stonetop-follower-card")?.querySelector(".stonetop-spend-loyalty")?.dataset.followerName
						|| "Your follower")
					: null;
				this.render(false);
				// Now that the 0 is committed, offer the fate choice (Loyal to the End /
				// Death's Door / dying / dead) for a follower who just went down.
				if (wasAlive) {
					const loyaltyPath = _followerLoyaltyPath(follower, slug);
					const loyalty = Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, loyaltyPath)) || 0);
					// Loyal to the End is the Ranger's animal-companion move (p.469 → p.143):
					// it replaces the standard fate choice, and only the companion gets it.
					new FollowerFateDialog(this.actor, { name: fateName, loyalty, isAnimalCompanion: follower === "animal-companion" },
						(action) => this._resolveFollowerFate(action, { name: fateName, loyalty, follower, slug }),
					).render(true);
				}
			}, true);

			this._activateTabDragDrop(html);
		}

		_activateTabDragDrop(html) {
			// Scope to the window FRAME rather than the form: mountTabRail has moved the rail
			// out of the form and onto the frame, which still contains `.window-content` (and so
			// `.sheet-body`), making it the one root that resolves BOTH halves of a reorder.
			const root = this.element?.[0] ?? html[0];
			const nav = root.querySelector(".sheet-tabs");
			if (!nav) return;

			this._applyTabOrder(root);

			let dragSource = null;

			nav.querySelectorAll(".item[data-tab]").forEach(tab => { tab.draggable = true; });

			nav.addEventListener("dragstart", ev => {
				dragSource = ev.target.closest(".item[data-tab]");
				if (!dragSource) return;
				ev.dataTransfer.setData("text/plain", dragSource.dataset.tab);
				ev.dataTransfer.effectAllowed = "move";
				dragSource.classList.add("stonetop-tab-dragging");
			});

			nav.addEventListener("dragover", ev => {
				ev.preventDefault();
				ev.dataTransfer.dropEffect = "move";
				const target = ev.target.closest(".item[data-tab]");
				if (!target || target === dragSource) return;
				nav.querySelectorAll(".item[data-tab]").forEach(t => t.classList.remove("stonetop-tab-drag-over"));
				target.classList.add("stonetop-tab-drag-over");
			});

			nav.addEventListener("dragleave", ev => {
				if (!nav.contains(ev.relatedTarget)) {
					nav.querySelectorAll(".item[data-tab]").forEach(t => t.classList.remove("stonetop-tab-drag-over"));
				}
			});

			nav.addEventListener("drop", async ev => {
				ev.preventDefault();
				const target = ev.target.closest(".item[data-tab]");
				nav.querySelectorAll(".item[data-tab]").forEach(t => t.classList.remove("stonetop-tab-drag-over", "stonetop-tab-dragging"));
				if (!target || target === dragSource || !dragSource) return;
				const tabs = [...nav.querySelectorAll(".item[data-tab]")];
				if (tabs.indexOf(dragSource) < tabs.indexOf(target)) target.after(dragSource);
				else target.before(dragSource);
				const newOrder = [...nav.querySelectorAll(".item[data-tab]")].map(t => t.dataset.tab);
				this._applyTabOrder(root, newOrder);
				await this.actor.setFlag(STONETOP_SCOPE, "tabOrder", newOrder);
				this.render(false);
				dragSource = null;
			});

			nav.addEventListener("dragend", () => {
				nav.querySelectorAll(".item[data-tab]").forEach(t => t.classList.remove("stonetop-tab-dragging", "stonetop-tab-drag-over"));
				dragSource = null;
			});
		}

		_applyTabOrder(root, order = null) {
			const nav = root.querySelector(".sheet-tabs");
			const body = root.querySelector(".sheet-body");
			if (!nav) return;
			const savedOrder = order ?? this.actor.getFlag(STONETOP_SCOPE, "tabOrder");
			if (!savedOrder?.length) return;
			const tabs = [...nav.querySelectorAll(".item[data-tab]")];
			const tabMap = new Map(tabs.map(t => [t.dataset.tab, t]));
			const panels = body ? [...body.children].filter(el => el.matches?.(".tab[data-tab]")) : [];
			const panelMap = new Map(panels.map(panel => [panel.dataset.tab, panel]));
			for (const key of this._mergeTabOrder(savedOrder, tabs.map(t => t.dataset.tab))) {
				const tab = tabMap.get(key);
				if (tab) nav.appendChild(tab);
				const panel = panelMap.get(key);
				if (panel) body.appendChild(panel);
			}
		}

		/**
		 * Fold the tabs a player has never seen into the order they saved.
		 *
		 * A saved order is a snapshot of the rail as it stood the day it was dragged, so any
		 * tab added since is missing from it. Appending those at the end (what this used to do)
		 * quietly buries a new page at the bottom of the rail for exactly the players who use
		 * it most — the ones who reorder. Instead each unknown tab keeps its TEMPLATE position
		 * relative to the tabs around it: it lands just after the nearest tab above it in the
		 * template that the player did place, or first if there is none. A page written first
		 * in character.hbs therefore arrives first for everyone; drag it and that choice sticks
		 * from then on.
		 *
		 * Conditional tabs (Arcana, Followers, Post-Death) drop in and out of the template
		 * freely — a key in `savedOrder` with no tab rendered is simply skipped by the caller.
		 *
		 * @param {string[]} savedOrder   tab keys in the order the player last dragged them
		 * @param {string[]} templateOrder tab keys as the template rendered them, in DOM order
		 * @returns {string[]} the merged order
		 */
		_mergeTabOrder(savedOrder, templateOrder) {
			const merged = savedOrder.filter(key => templateOrder.includes(key));
			for (let i = 0; i < templateOrder.length; i++) {
				const key = templateOrder[i];
				if (merged.includes(key)) continue;
				// Nearest template sibling ABOVE this one that already has a place.
				let at = 0;
				for (let j = i - 1; j >= 0; j--) {
					const found = merged.indexOf(templateOrder[j]);
					if (found >= 0) { at = found + 1; break; }
				}
				merged.splice(at, 0, key);
			}
			return merged;
		}

		_getDragEventData(ev) {
			return getDragEventData(ev);
		}

		// Initial HP for a newly-assigned playbook (full HP). max is also synced in
		// getData, but the current value must be seeded here or it stays at the default.
		_playbookHpInit(playbookDoc) {
			const hp = playbookDoc.flags?.stonetop?.hp;
			return hp ? { "system.attributes.hp.max": hp, "system.attributes.hp.value": hp } : {};
		}

		async _onDropPlaybook(playbookDoc) {
			if (!this.isEditable) return;
			// The three post-death inserts are `type: "playbook"` Items too, so this one handler
			// receives both and has to tell them apart. It used to ask "does it carry lore?" —
			// which is true of EVERY shipped playbook (the Heavy has four lore sections of its
			// own), so dropping a playbook set the character's post-death insert to their
			// playbook: no playbook was assigned, the Post-Death tab appeared, and the prune
			// below measured their recorded answers against the Heavy's lore keys and deleted
			// the lot. Ask the only question that actually separates them instead.
			const slug = playbookDoc.system?.slug;
			// Through the same redirect every other drop uses: on a legacy UNLINKED token's sheet
			// `this.actor` is the token's own copy, so an insert dropped there wrote the slug and
			// the three granted move Items onto that one token — the player's own sheet showed no
			// insert, no Post-Death tab and no black paper. A playbook drop had it too.
			const { character: target, unlinkedFrom, redirectedTo } = this._dropTarget();
			const actor = redirectedTo ?? this.actor;
			if (unlinkedFrom) {
				ui.notifications?.info?.(`Dropped onto ${unlinkedFrom}'s unlinked token: written to the character instead.`);
			}
			if (POST_DEATH_INSERT_SLUGS.includes(slug)) {
				await target.setPostDeathInsert(slug);
				(redirectedTo?.sheet ?? this).render(false);
				return;
			}
			await actor.update({
				"system.playbook": {
					uuid: playbookDoc.uuid,
					name: playbookDoc.name,
					slug: slug ?? "",
				},
				...this._playbookHpInit(playbookDoc),
			});
			await target.ensureStartingMoves();
			(redirectedTo?.sheet ?? this).render(false);
		}

		/**
		 * The character a drop should be written to, and the name to blame if that isn't the
		 * one whose sheet is on screen.
		 *
		 * A sheet opened by double-clicking a token is backed by the TOKEN's actor. When the
		 * token is unlinked that actor is a private copy living in the token's ActorDelta, so
		 * everything dropped here saves to that one token and nowhere else — the player opens
		 * their character from the sidebar and finds nothing. Characters created from now on
		 * link their prototype token (StonetopActor._preCreate), but tokens already placed in
		 * an existing world stay unlinked forever, so the drop has to resolve its own target.
		 *
		 * Redirect rather than refuse: a `character` actor is somebody's PC, and a GM dropping
		 * gear on one always means "give this to that character", never "give this to this one
		 * copy of them". The toast names where it landed, so nothing moves silently.
		 *
		 * `isToken` is true ONLY for the synthetic case — a linked token hands back the world
		 * actor itself — so this costs nothing on the sheet opened from the sidebar.
		 */
		_dropTarget() {
			const base = this.actor?.isToken ? this.actor.token?.baseActor : null;
			const character = base?.typedActor;
			if (!character || character === this._stonetopCharacter) {
				return { character: this._stonetopCharacter, unlinkedFrom: null, redirectedTo: null };
			}
			// The Actor document as well as the character: the write lands on THAT one, so it is
			// also the one with a sheet worth re-drawing afterwards.
			return { character, unlinkedFrom: base.name, redirectedTo: base };
		}

		async _onDropItemCreate(itemData) {
			const items     = Array.isArray(itemData) ? itemData : [itemData];
			const arcana    = items.filter(i => i.type === "move" && i.system?.moveType === "arcanum");
			const inventory = items.filter(i => i.type === "move" && i.system?.moveType === "inventory");
			const moves     = items.filter(i => i.type === "move" && !["arcanum", "inventory"].includes(i.system?.moveType));
			const others    = items.filter(i => i.type !== "move");
			// Everything below writes through `target`, not `this._stonetopCharacter`, so a drop
			// onto an unlinked token's sheet still reaches the character the player opens.
			const { character: target, unlinkedFrom, redirectedTo } = this._dropTarget();
			let anyAdded = false;
			// A dropped arcanum is added UNIDENTIFIED — a face-down "mystery" card the player
			// Knows Things about in play (drop is the only path that plants a mystery;
			// onboarding, level-up, and the homebrew creator all identify on add). Because that
			// card shows only its name, no art and none of its text, and can land on a tab you
			// aren't looking at, a silent add reads as "nothing happened". So collect the freshly
			// added ones (skip arcana already owned — a re-drop is a no-op) to toast and reveal
			// the Arcana tab.
			const ownedArcana = target.ownedArcanaSlugs;
			const addedArcana = [];
			for (const item of arcana) {
				const slug = item.flags?.stonetop?.slug;
				if (slug && !ownedArcana.has(slug)) {
					await target.addArcanum(slug);
					addedArcana.push(item.name || item.flags?.stonetop?.front?.title || "an arcanum");
					anyAdded = true;
				}
			}
			// onDropMove refuses a move the character already owns by NAME and returns false.
			// That refusal used to be entirely silent — no card, no toast, no console error —
			// which reads exactly like the drop was ignored, and sends you hunting for a bug in
			// the drop handler when the answer is "it's already on this sheet somewhere". A
			// foreign move makes that worse: the owned copy ALSO hides its name from the
			// cross-playbook picker (which skips owned names), so it looks missing from both
			// places at once while in fact being present.
			const skippedMoves = [];
			for (const item of moves) {
				if (await target.onDropMove(item)) anyAdded = true;
				else skippedMoves.push(item.name || "that move");
			}
			// Gear lands on a tab the GM usually isn't looking at (they drop from a journal or the
			// Items sidebar, onto whichever tab happens to be open), and a treasure joins a
			// "Treasures" heading partway down a long column. So a silent add reads as "nothing
			// happened" — the same reason the arcana branch above toasts. Naming the character is
			// what makes a drop onto the wrong actor, or onto a token copy, visible immediately.
			const addedInventory = [];
			// "When the PCs find an artifact, describe it! Tell them what they've found, and
			// what's obvious at a glance" (Book I p.430). A world that turns this on has every
			// dropped Book II treasure land with its tags and Value withheld, ready for a Know
			// Things; off (the default) a drop reads exactly as it always has, and the GM hides
			// individual artifacts by hand from the row's own control.
			const hideArtifact = game.settings.get(STONETOP_SCOPE, "artifactsStartUnidentified");
			for (const item of inventory) {
				await target.addDroppedInventoryItem(item, { hideArtifact });
				addedInventory.push(item.name || "an item");
				anyAdded = true;
			}
			// `others` (non-move documents) stays with the base handler, which writes to
			// this.actor — so on an unlinked token it lands on the token copy. Nothing on a
			// character sheet drops down that branch today; revisit it if something ever does.
			if (others.length) await super._onDropItemCreate(others);
			if (addedInventory.length) {
				const names = joinNames(addedInventory.map(n => `"${n}"`));
				ui.notifications?.info?.(unlinkedFrom
					? format("stonetop.inventory.dropAddedUnlinked", { names, actor: unlinkedFrom })
					: format("stonetop.inventory.dropAdded", { names, actor: this.actor?.name ?? "this character" }));
			}
			if (skippedMoves.length) {
				const names = joinNames(skippedMoves.map(n => `"${n}"`));
				ui.notifications?.warn?.(
					`${names} ${skippedMoves.length === 1 ? "is" : "are"} already on ${unlinkedFrom ?? this.actor?.name ?? "this character"}: nothing was added. Check the Moves tab, including Learned Moves and Other Moves.`);
			}
			// Where the write actually LANDED, which on a redirect is NOT this sheet: this one is
			// backed by the token's ActorDelta copy, which the drop deliberately did not touch. Both
			// the re-render and the Arcana-tab reveal below belong to that sheet — re-drawing this
			// one shows a sheet still visibly missing what the toast has just said was added, on the
			// one path where the redirect most needs to read clearly. `render(false)` refreshes the
			// base actor's sheet if it happens to be open and does nothing if it isn't, which is
			// what "don't open windows nobody asked for" wants.
			const landedOn = redirectedTo ? redirectedTo.sheet : this;
			if (addedArcana.length) {
				const one = addedArcana.length === 1;
				ui.notifications?.info?.(
					`Added ${joinNames(addedArcana)} to the Arcana tab, face-down: Know Things about ${one ? "it" : "them"} to learn what ${one ? "it is" : "they are"}.`,
				);
				// Reveal the Arcana tab so the new (face-down) card is visible — but do it AFTER
				// the re-render lands, as a cheap DOM toggle, not by presetting active before a
				// render. The flag write above schedules its own auto-render, which races the
				// explicit render(false) below; presetting active lost that race intermittently,
				// leaving the card on a hidden tab until the sheet was reopened. An instance flag
				// consumed by _render makes the switch deterministic regardless of which render
				// wins — and, unlike a global Hooks.once(render…), can't be swallowed by another
				// open character sheet that happens to re-render first.
				if (landedOn) landedOn._activateTabOnRender = "arcana";
			}
			if (anyAdded) landedOn?.render(false);
		}

		// Roll one of this character's owned moves by its embedded item id, running the
		// exact same dispatch a click on the move's title would — guided-move dialog,
		// "ask"/alt-stat picker, and the pre-roll prompt all included.
		// This is the entry point used by the hotbar move-macros (drag a move onto the
		// hotbar): it works whether or not the sheet is currently rendered, because it
		// builds a detached stand-in for the row's rollable (see _makeSyntheticRollable)
		// and feeds it to the same helpers the inline click handler uses — literally the same
		// ladder, via _resolveMoveRollPrompts, so the two can no longer fall out of step.
		async rollMoveById(itemId, { shiftKey = false } = {}) {
			const item = this.actor?.items?.get(itemId);
			if (!item) return void ui.notifications.warn("That move is no longer on this character.");
			if (!this.isEditable) return;

			// A weapon-granting move (Purifying Flames) has no rollType of its own, so it belongs
			// in the description branch — and it is steered there rather than merely landing there,
			// so that a granting move which one day DOES carry a rollType still acts as the weapon
			// it offers, exactly as the Moves tab's name-click has it.
			const grantedAttack = grantedWeaponAttackFor(this.actor, item);

			const rollable = grantedAttack ? null : this._makeSyntheticRollable(item);
			if (!rollable) {                     // description-only move → post to chat
				const posted = await item.roll();
				// The other half: a move dragged to the hotbar is used from there just as truly
				// as from the sheet, so it gets the same effects.
				await this._onDescriptionMoveUsed(item);
				// And the third, for a move whose text is an offer of a weapon: its card, then the
				// attack it grants. Both halves, in the same order the sheet does them, so a move
				// on the hotbar and the same move on the tab do the same thing.
				if (grantedAttack) await this._rollGrantedWeaponAttack(item, grantedAttack, { shiftKey });
				return posted;
			}

			// The same ladder the Moves tab's own dice click walks, which is the point: a move on
			// the hotbar must ask what the sheet asks. See _resolveMoveRollPrompts.
			const prompted = await this._resolveMoveRollPrompts(rollable, { shiftKey });
			if (prompted === "handled" || prompted === "cancel") return;
			const handled = await this._stonetopCharacter.onRoll({ currentTarget: rollable }, prompted);
			// What rolling this move DOES beyond the roll — the same effects the Moves tab's own
			// click fires, and gated the same way, so a weapon/target prompt backed out of here
			// fires nothing either. A move dragged to the hotbar is rolled from there just as truly
			// as from the sheet, and this path had been getting the roll without them: a Blessed who
			// put Amulets & Talismans on their bar laid a charm the roster never heard about. The
			// description-only branch above already reasons this way for MOVE_USE_EFFECTS.
			if (handled !== "cancel") await this._onMoveRolled(item);
		}

		// Resolve a love letter (Book I p.568): post it like any move, then consume it.
		// A fixed-stat letter rolls through the standard engine (same chat card, XP-on-miss);
		// a no-roll letter posts its body as a description card. We call onRoll directly (not
		// rollMoveById) so there's no pre-roll prompt whose cancel could leave a single-use
		// letter half-spent — the letter is only deleted once its card has posted.
		async _onResolveLoveLetter(itemId) {
			const item = this.actor?.items?.get(itemId);
			if (!item) return void ui.notifications.warn("That love letter is no longer on this character.");
			if (!this.isEditable) return;

			try {
				const rollable = this._makeSyntheticRollable(item);   // null when there's no roll
				if (rollable) await this._stonetopCharacter.onRoll({ currentTarget: rollable }, {});
				else await item.roll({ descriptionOnly: true });
			} catch (err) {
				console.error("Stonetop | Error resolving love letter:", err);
				ui.notifications.error("Could not resolve that love letter: see the console for details.");
				// Rethrow so the reader dialog keeps itself open and re-enables its button; the
				// letter is left in place (delete below is skipped) so it isn't silently consumed.
				throw err;
			}

			await item.delete();   // single-use — the section vanishes with the last letter
		}

		// Build a detached DOM element that stands in for a move row's rollable title,
		// carrying just the structure the rollable-dispatch helpers read: an ancestor
		// `.item.stonetop-item` with the item id, a `.stonetop-item-name`, and the stat on
		// the rollable's data-roll. Returns null for a move with no rollType (nothing to
		// roll). Using a real (unattached) element means the helpers need no DOM-vs-object
		// special-casing — they closest()/querySelector() over it exactly as on the sheet.
		_makeSyntheticRollable(item) {
			const stat = normalizeRollType(item.system?.rollType);
			if (!stat) return null;
			const li = document.createElement("li");
			li.className = "item stonetop-item";
			li.dataset.itemId = item.id;
			const name = document.createElement("strong");
			name.className = "stonetop-item-name";
			name.textContent = item.name;
			const rollable = document.createElement("span");
			rollable.className = "rollable move-rollable";
			rollable.dataset.roll = stat;
			li.append(name, rollable);
			return rollable;
		}

		/**
		 * Use a move that grants a weapon: roll the attack it rides on, with that weapon already
		 * in hand. Purifying Flames is the whole case today — the Lightbearer's holy light
		 * "counts as a weapon (d10 damage, hand, close, area, 2 piercing) and you can choose to
		 * roll +WIS to Clash" — so clicking it Clashes with the light at +WIS, which is exactly
		 * the state a player used to reach by clicking Clash, picking +WIS, and then picking the
		 * light out of the weapon prompt.
		 *
		 * The other combination the move allows (the light in hand while rolling +STR) is still
		 * reachable the old way, since the weapon prompt offers the light whichever stat was
		 * chosen — so this shortcut costs nothing to leave un-asked.
		 *
		 * `moveItem` is the move the player CLICKED; `attack.item` is the Clash it becomes. The
		 * roll prompt is titled with the former (it's what they asked for), while the roll,
		 * its card, and the effects of having rolled all belong to the latter.
		 *
		 * BOTH CALLERS POST THE MOVE'S TEXT FIRST and then call this. A granting move has no
		 * rollType, so its title never rolls and a name-click is its only surface; taking that
		 * click for the attack alone would leave it the one move on the sheet its owner cannot show
		 * the table. The card then reads as the reason for the roll under it.
		 *
		 * THE CALLER OWNS THE EDITABILITY GATE, and deliberately: rollMoveById has already returned
		 * for a read-only sheet, while the Moves tab resolves the attack only when editable, so an
		 * observer gets the move's text and no roll. A guard here would swallow the difference.
		 */
		async _rollGrantedWeaponAttack(moveItem, attack, { shiftKey = false } = {}) {
			const rollable = this._makeSyntheticRollable(attack.item);
			if (!rollable) return;              // the attack move has no rollType — nothing to roll
			// Said, not enforced: whether the granted weapon is ready — a holy light actually
			// burning — and whether the foe is a creature of darkness are the table's call, the
			// same call the weapon picker already leaves them. WHICH state to look at and what to
			// say both come from the weapon's own row (data/weapons.js, via grantedWeaponAttackFor),
			// so the second granted weapon is a table entry rather than a branch here.
			if (attack.readyWhen && !this._stonetopCharacter?.[attack.readyWhen]) {
				ui.notifications?.info(game.i18n.localize(attack.unreadyNotice));
			}
			const prompted = await this._promptRollOptions({ shiftKey, title: moveItem.name });
			if (!prompted) return;              // player cancelled the roll prompt
			const handled = await this._stonetopCharacter.onRoll({ currentTarget: rollable }, {
				statOverride: attack.stat, ...prompted, weaponSlug: attack.weaponSlug,
			});
			// The same guard both other roll paths use. The weapon is pre-answered here, but the
			// TARGET prompt is not, and backing out of it is a roll that never happened — an
			// effect fired on one would be a mark laid, or a roster opened, for nothing.
			if (handled !== "cancel") await this._onMoveRolled(attack.item);
		}

		/**
		 * Everything a move roll has to ASK before the dice are thrown: the guided-move dialog,
		 * the "ask" stat picker, the alt-stat picker, then the pre-roll prompt (how to roll it,
		 * and any one-off modifier).
		 *
		 * One ladder, because it has to BE one — dragging a move to the hotbar must ask exactly
		 * what clicking its title on the sheet asks. It used to be written out twice, with a
		 * comment on the second copy telling the reader to keep the branch order in step with the
		 * first by hand; that instruction is what this replaces.
		 *
		 * Returns:
		 *   "handled"    a dialog took the roll over and owns it from here — the caller stops;
		 *   "cancel"     the player backed out of the roll prompt;
		 *   an object    { rollMode, situational } — spread straight into the roll call.
		 *
		 * The roll prompt is only for 2d6 move/stat rolls, never a raw formula (a damage die, a
		 * follower's attack) — so this answers correctly for ANY rollable on the sheet, which is
		 * what lets the general rollable handler share it with the move-only hotbar path.
		 */
		async _resolveMoveRollPrompts(rollable, { shiftKey = false } = {}) {
			const guided = this._guidedMoveForRollable(rollable);
			if (guided) { this._openGuidedCharacterMove(guided, rollable); return "handled"; }

			const askItem = this._statChoiceMoveForRollable(rollable);
			if (askItem) { this._promptStatChoice(askItem, rollable, undefined, { shiftKey }); return "handled"; }

			const altChoice = this._altStatChoiceForRollable(rollable);
			if (altChoice) {
				this._promptStatChoice(altChoice.item, rollable, altChoice.stats, { shiftKey, grants: altChoice.grants });
				return "handled";
			}

			// A raw formula rollable is not a 2d6 move roll: there is nothing to ask about, so
			// nothing is asked and it goes out on the defaults.
			if (!rollable.classList.contains("move-rollable") && !_STAT_KEYS.has(rollable.dataset.roll)) {
				return { ...UNPROMPTED_ROLL };
			}
			return (await this._promptRollOptions({ shiftKey, rollable })) ?? "cancel";
		}

		_statChoiceMoveForRollable(rollable) {
			const itemId = rollable.closest(".item")?.dataset.itemId;
			if (!itemId) return null;
			const item = this.actor.items.get(itemId);
			if (!item || normalizeRollType(item.system?.rollType) !== "ask") return null;
			return item;
		}

		// A fixed-stat move (e.g. Clash +STR) becomes a stat choice when the actor owns a
		// move that grants an alternate stat for it (e.g. Skill at Arms → +DEX). Returns
		// { item, stats: [default, ...alts], grants: [grantingMove, …] } or null — the
		// granting moves come back so the picker can show the rule that earned the extra
		// stat (their own text carries the fictional trigger). See ALT_STAT_GRANTS.
		_altStatChoiceForRollable(rollable) {
			const itemId = rollable.closest(".item")?.dataset.itemId;
			if (!itemId) return null;
			const item = this.actor.items.get(itemId);
			if (!item || item.type !== "move") return null;
			const defaultStat = normalizeRollType(item.system?.rollType);
			if (!defaultStat || !_STAT_KEYS.has(defaultStat)) return null; // skip "ask"/formula moves
			const owned = new Map(this.actor.items.filter(i => i.type === "move").map(i => [i.name, i]));
			const alts = [];
			const grants = [];
			for (const g of ALT_STAT_GRANTS) {
				const matches = (g.whenMove && g.whenMove === item.name)
					|| (g.whenDefaultStat && g.whenDefaultStat === defaultStat);
				if (matches && owned.has(g.ownsMove) && g.altStat !== defaultStat && !alts.includes(g.altStat)) {
					alts.push(g.altStat);
					grants.push(owned.get(g.ownsMove));
				}
			}
			if (!alts.length) return null;
			return { item, stats: [defaultStat, ...alts], grants };
		}

		// The pre-roll prompt (RollDialog.js), titled with whatever this sheet knows the roll by.
		// Returns an object to spread straight into a roll — `{ situational }`, plus `rollMode`
		// only when the window actually asked for one — or null when the player cancels so the
		// caller can abort. Shift skips the window. Pass a `rollable` to derive the title from
		// its move/stat, or an explicit `title`.
		//
		// TITLE DERIVATION IS ALL THIS ADDS. The window, the Shift shortcut, the two client
		// settings that decide which halves it asks and whether it opens at all, and the shape of
		// the answer all belong to promptRoll, which the steading sheet and the Requisition dialog
		// call for themselves — this is not a second front door to them.
		_promptRollOptions({ shiftKey = false, rollable = null, title = null } = {}) {
			const moveName = rollable?.closest(".stonetop-item")?.querySelector(".stonetop-item-name")?.textContent?.trim();
			const statKey  = rollable?.dataset?.roll;
			return promptRoll({
				shiftKey,
				title: title
					|| moveName
					|| (statKey && _STAT_KEYS.has(statKey) ? `Roll +${statKey.toUpperCase()}` : "Roll"),
			});
		}

		// `grants` are the moves that opened this choice up (empty for a move whose own
		// rollType is "ask"). Their text is quoted under the question so the player can
		// see the rule — and its fictional trigger, which we don't enforce — before picking.
		_promptStatChoice(item, rollable, statKeys = _STAT_KEYS, { shiftKey = false, grants = [] } = {}) {
			const stats = this.actor.system?.stats ?? {};
			const buttons = {};
			for (const key of statKeys) {
				const value = stats[key]?.value ?? 0;
				const label = Handlebars.helpers.statLabel(key);
				buttons[key] = {
					// Offer the roll prompt once the stat is chosen, mirroring the inline roll
					// path; Shift on the original click skips it, a cancel aborts the roll.
					callback: async () => {
						const prompted = await this._promptRollOptions({ shiftKey, title: item.name });
						if (!prompted) return;
						await this._stonetopCharacter.onRoll({ currentTarget: rollable }, { statOverride: key, ...prompted });
					},
					label: `${label} (${sign(value)})`,
				};
			}
			const whyHtml = grants.filter(Boolean).map(grant => {
				// A move that also turns something into a weapon (Purifying Flames' holy light)
				// changes the damage, not just the stat — spell that out here, since the damage
				// die is the part that's easy to miss in the move's prose.
				const granted = grantedWeaponForMove(grant.name);
				const weaponNote = granted
					? `<p class="stonetop-stat-picker-weapon"><i class="fas fa-dice-d10"></i>
						Choosing ${_esc(Handlebars.helpers.statLabel(granted.whenStat))} means the
						<strong>${_esc(granted.meta.name)}</strong> is your weapon: 
						<strong>${_esc(weaponTraitText(granted.meta))}</strong>, in place of your own damage die.</p>`
					: "";
				return `<div class="stonetop-stat-picker-why">
					<strong>${_esc(grant.name)}</strong>
					${grant.system?.description ?? ""}
					${weaponNote}
				</div>`;
			}).join("");
			// What the move itself says each stat means here — Defy Danger's and Interfere's six
			// printed approaches, read off the move rather than restated (see statApproaches).
			// Without them this window asks "which stat?" and shows six abbreviations, when the
			// answer the player needs is on the move in front of them.
			const approaches = statApproaches(item.system?.description);
			const listed = [...statKeys].filter(key => approaches[key]);
			const approachHtml = listed.length
				? `<ul class="stonetop-stat-picker-approaches">${listed.map(key =>
					`<li><strong>${_esc(Handlebars.helpers.statLabel(key))}</strong> ${_esc(approaches[key])}</li>`).join("")}</ul>`
				: "";
			new Dialog({
				title: `${item.name}: Choose a Stat`,
				content: `<p>Which stat are you rolling with?</p>${approachHtml}${whyHtml}`,
				buttons,
				render: bringDialogToFront,
			}, { width: 480, classes: ["dialog", "stonetop", "stonetop-stat-picker-dialog"] }).render(true);
		}

		/**
		 * What an EXPEDITION move opens before any dice, given the row's name element: its own
		 * bespoke dialog (Requisition's assets, Outfit's load) or its guided step. Answers true
		 * when it took the click, false when the move has neither and the ordinary roll should
		 * go ahead.
		 *
		 * ONE COPY, TWO CALLERS, and they are two halves of the same click. The row's title is a
		 * `.rollable` now, so tapping it lands in the rollable handler while tapping the empty
		 * space beside it lands in the row handler — and both have to give the same answer, or
		 * Requisition means the assets dialog or the stat picker depending on which pixel was
		 * hit. That is exactly the split this replaced: the old dice icon rolled and the old
		 * name opened the dialog, and which one a player got was which one they aimed at.
		 *
		 * Guarded on the class rather than the name table alone: `stonetop-expedition-move-open`
		 * is only on the sidebar's expedition rows (character.hbs), so a playbook move that
		 * happens to share a name with one of these cannot borrow its door.
		 */
		_openExpeditionMoveDoor(li) {
			// Takes the ROW, because the row is what both callers already hold and what this
			// needs anyway: it reads the name off it and then the rollable beside it. Handed the
			// name element instead, the rollable path had to walk li → name → li to get back
			// here, which on the sidebar rows means starting from the element it ended at.
			const nameEl = li?.querySelector?.(".stonetop-move-name");
			if (!nameEl?.classList?.contains("stonetop-expedition-move-open")) return false;
			const moveName = nameEl.textContent.trim();
			const handler = EXPEDITION_MOVE_HANDLERS[moveName];
			if (handler) { handler(this); return true; }
			const guide = GUIDED_CHARACTER_MOVES[moveName];
			const rollable = li.querySelector(".rollable");
			if (guide && _guidedCharacterMoveHasAction(guide, rollable)) {
				this._openGuidedCharacterMove({ name: moveName, guide }, rollable);
				return true;
			}
			return false;
		}

		_guidedMoveForRollable(rollable) {
			const li = rollable.closest(".stonetop-item");
			const name = li?.querySelector(".stonetop-item-name")?.textContent?.trim()
				?? rollable.dataset.label?.trim();
			const guide = GUIDED_CHARACTER_MOVES[name];
			if (!guide) return null;
			// A player-authored custom move (moveType "other") that happens to share a
			// guided move's name should roll as itself, not hijack the built-in dialog.
			const item = li?.dataset.itemId ? this.actor.items.get(li.dataset.itemId) : null;
			if (item?.system?.moveType === "other") return null;
			return { name, guide };
		}

		/**
		 * The guide behind an arcanum's back-side move, so a mystery opens the same dialog a
		 * playbook move does. `bodyHtml` carries the move's own authored prose (a playbook guide
		 * carries a hand-written `trigger` line instead), the card's options become the tickable
		 * list, and `card` is what a "Send to chat" or a roll posts. Rolling is gated on the
		 * move's □ being marked — an unlearned mystery reads, it does not yet act.
		 */
		_arcanumMoveGuide(move) {
			// The options list renders as ticks below, so drop the printed copy of it from the
			// body rather than showing the same list twice.
			const body = move.picks.length && move.listHtml
				? move.description.replace(move.listHtml, "")
				: move.description;
			return {
				bodyHtml:   body,
				card:       move.description,
				picks:      move.picks,
				picksLabel: move.picksLabel,
				// How many of that list the mystery allows, read off its own lead-in — the
				// denominator in the tally over the boxes (see _openGuidedCharacterMove).
				pickMax:    move.pickMax,
				roll:       (move.learned && this.isEditable) ? move.roll : null,
				post:       "Send to chat",
			};
		}

		/**
		 * A guided move's dialog: what the move says, its result tiers, whatever it asks you to
		 * choose from, and the button that rolls it. Deliberately holds no free-text boxes —
		 * nothing would store what was typed into them, so they only stood between the move and
		 * its roll (the homefront dialogs on the steading sheet lost theirs for the same reason).
		 */
		_openGuidedCharacterMove({ name, guide }, rollable) {
			const resultsHtml = guide.results?.length
				? `<div class="stonetop-homestead-reference">
					<strong>Results</strong>
					<ul>${guide.results.map(result => `<li>${_formatResultLine(result)}</li>`).join("")}</ul>
				</div>`
				: "";
			const picksHtml = guide.picks?.length
				? `<div class="stonetop-homestead-reference">
					<strong>${_esc(guide.picksLabel ?? "Choose")}</strong>
					<div class="stonetop-homestead-choice-list">
						${guide.picks.map((pick, index) => `<label class="stonetop-homestead-choice">
							<input type="checkbox" class="stonetop-check" name="pick.${index}" value="${_esc(pick)}">
							<span>${_esc(pick)}</span>
						</label>`).join("")}
					</div>
				</div>`
				: "";

			// A guide may roll without an owned item (e.g. expedition moves): `guide.roll`
			// is a stat key, or "ask" to let the player pick a stat in the dialog.
			const askStat = !rollable && guide.roll === "ask";
			const statPickerHtml = askStat
				? `<label class="stonetop-homestead-field stonetop-guided-stat-pick">
					<span>Roll with</span>
					<select name="guidedRollStat">${_STAT_CHOICES.map(([key, label]) => `<option value="${key}">+${label}</option>`).join("")}</select>
				</label>`
				: "";

			// A move that CHARGES before it rolls (Danu's Grasp: "spend 1 Stock and roll +WIS").
			// `cost` is null for every other guide, and then none of this applies.
			const cost = guide.cost ? this._stockCostView(guide.cost) : null;

			const buttons = {
				cancel: { label: "Cancel" },
			};
			if (rollable && (!cost || cost.affordable)) {
				buttons.roll = {
					label: `Roll +${(rollable.dataset.roll ?? "").toUpperCase()}`,
					// Ask how to roll it before posting, so cancelling is a clean abort (nothing
					// hits the chat). Title comes from the rollable's move/stat.
					//
					// The cost is paid AFTER the prompt and BEFORE the dice: backing out of the
					// prompt spends nothing, and any roll that happens has been paid for.
					callback: async html => {
						const prompted = await this._promptRollOptions({ rollable });
						if (!prompted) return;
						if (cost && !(await this._spendStockCost(cost, html, name))) return;
						await this._postGuidedCharacterMove(name, guide, html);
						await this._stonetopCharacter.onRoll({ currentTarget: rollable }, prompted);
					},
				};
			} else if (guide.roll && !cost) {
				const fixedStat = askStat ? null : guide.roll;
				buttons.roll = {
					label: fixedStat ? `Roll +${fixedStat.toUpperCase()}` : "Roll",
					callback: async html => {
						const stat = fixedStat ?? html[0]?.querySelector('[name="guidedRollStat"]')?.value ?? "wis";
						const prompted = await this._promptRollOptions({ title: name });
						if (!prompted) return;
						await this._postGuidedCharacterMove(name, guide, html);
						// "roll +nothing" (the Demonhide Cloak's The Flesh Remembers) is a flat 2d6:
						// no stat stands behind it, so the value is spelled out rather than looked up.
						const flat = stat === "nothing" ? { statValue: 0 } : {};
						await this._stonetopCharacter.onDirectStatRoll(stat, { moveName: name, ...flat, ...prompted });
					},
				};
			}

			// Declared after the roll so it sits to its right (the shared dialog-button rules
			// order affirmatives by source, cancel last). An arcanum move with options but no
			// dice would otherwise offer nothing but Cancel; one that DOES roll still wants a
			// way to read itself out to the table without spending the roll.
			if (guide.post) {
				buttons.post = {
					label: guide.post,
					callback: html => this._postGuidedCharacterMove(name, guide, html),
				};
			}

			new Dialog({
				title: name,
				content: `<form class="stonetop-homestead-dialog stonetop-character-move-dialog">
					${guide.bodyHtml
						? `<div class="stonetop-arcanum-move-body">${guide.bodyHtml}</div>`
						: `<p class="stonetop-homestead-trigger"><em>${_esc(guide.trigger)}</em></p>`}
					${cost ? this._stockCostHtml(cost) : ""}
					${statPickerHtml ? `<div class="stonetop-homestead-fields">${statPickerHtml}</div>` : ""}
					${resultsHtml}
					${picksHtml}
					${guide.note ? `<p class="stonetop-homestead-note">${_esc(guide.note)}</p>` : ""}
				</form>`,
				buttons,
				default: (rollable || guide.roll) ? "roll" : (guide.post ? "post" : "cancel"),
				// An arcanum move's body is the card's own prose, so its ◇/○/□ want the same
				// styled glyphs the card gives them. A playbook guide's text is plain and has none.
				render: html => {
					bringDialogToFront(html);
					if (guide.bodyHtml) wrapStonetopGlyphsInEl(html[0]);
					// The same tally a chat card's pick list carries. A mystery makes its choice
					// HERE rather than in chat — it is the one move surface where the list is not
					// on a card — so without this it is the one place a player still has to count
					// their own ticks. Its cap comes off the mystery's own lead-in (arcana-moves.js
					// reads it), and is 0 for a guide that never had a count to read.
					// `enforce`, because these boxes have no handler of their own: a chat card's pick
					// list releases an over-cap tick from the handler that persists it, and a
					// mystery that says "choose 2" must not quietly submit three.
					wirePickTally(html[0]?.querySelector(".stonetop-homestead-choice-list"), guide.pickMax, { enforce: true });
				},
			}, { width: 520, classes: ["dialog", "stonetop", "stonetop-character-move-dialog"] }).render(true);
		}

		/**
		 * Rites of the Land. Reaches the steading because two of the move's three effects land
		 * there; opens anyway without one, so a Blessed in a world with no steading yet can still
		 * hold their Favor (the walkthrough simply offers nothing that needs a steading).
		 */
		_openRitesOfTheLand() {
			if (!this.isEditable) return;
			const steadingActor = this._stonetopCharacter.getSteadingActor();
			const steading = steadingActor ? new StonetopSteading(steadingActor) : null;
			openRitesOfTheLand({
				character: this._stonetopCharacter,
				steading,
				year: steadingActor ? readCurrentYear(steadingActor) : 1,
				seasonId: steadingActor ? (readCurrentSeason(steadingActor)?.season ?? "") : "",
				onApplied: () => {
					this.render(false);
					for (const sheet of Object.values(steadingActor?.apps ?? {})) sheet.render(false);
				},
			});
		}

		/**
		 * What this character can pay a Stock cost out of, right now.
		 *
		 * Both tracks store checks SPENT, not held (see stock-cost.js), so what is left is
		 * `max - spent` in each. Favor only appears for a Blessed who owns Rites of the Land,
		 * whose last line is "Spend Favor in lieu of Stock, 1-for-1" — without it, a Blessed
		 * holding Favor and an empty pouch would be refused a move the book grants them.
		 */
		_stockCostView({ amount = 1, label = "Stock" } = {}) {
			// THROUGH stockSourcesForFlags, not stockSources: its whole reason for existing is
			// that this dialog and the chat card's Spend button must never disagree about what
			// the purse holds, and it was doing that job for one of the two callers it names.
			const sources = stockSourcesForFlags({
				possessions: this._stonetopCharacter.possessions,
				moveResources: this._stonetopCharacter.moveResources.getMoveResources(),
				ritesMax: ownedMove(this.actor, RITES_OF_THE_LAND)?.system?.resource?.max ?? null,
			});
			return {
				amount, label, sources,
				affordable: canPayStock(sources, amount),
				payable: sources.filter(s => s.remaining >= amount),
			};
		}

		/**
		 * The price, the purse, and — when the pouch is empty — why there is no Roll button.
		 * A purse the character has but cannot pay from is still SHOWN: "Stock 0 of 3" is the
		 * sentence that explains the missing button, where hiding it would read as a bug.
		 */
		_stockCostHtml(cost) {
			const purses = cost.sources.map(s =>
				`<span class="stonetop-move-cost-purse${s.remaining >= cost.amount ? "" : " is-empty"}">`
				+ `${_esc(s.label)} <strong>${s.remaining}</strong> of ${s.max}</span>`).join("");
			// Only asked when there is genuinely a choice; one payable purse is spent silently.
			const picker = cost.payable.length > 1
				? `<label class="stonetop-homestead-field stonetop-move-cost-pick"><span>Spend from</span>
					<select name="stockCostSource">${cost.payable
						.map(s => `<option value="${_esc(s.key)}">${_esc(s.label)} (${s.remaining} left)</option>`).join("")}</select>
				</label>`
				: "";
			return `<div class="stonetop-move-cost${cost.affordable ? "" : " is-unaffordable"}">
				<p class="stonetop-move-cost-line"><strong>Costs ${cost.amount} ${_esc(cost.label)}.</strong> ${purses}</p>
				${cost.affordable
					? picker
					: `<p class="stonetop-move-cost-warn">No ${_esc(cost.label)} left to spend, so this move cannot be made. Replenish the pouch first.</p>`}
			</div>`;
		}

		/**
		 * Pay the cost. Returns false — and rolls nothing — if the purse emptied between the
		 * dialog opening and the button being pressed, which a non-modal dialog left open beside
		 * the sheet makes perfectly possible.
		 *
		 * Spending INCREMENTS both tracks, because both count checks spent.
		 */
		async _spendStockCost(cost, html, moveName) {
			const chosen = html?.[0]?.querySelector('[name="stockCostSource"]')?.value ?? null;
			const live = this._stockCostView(cost);
			const source = live.payable.find(s => s.key === chosen) ?? defaultStockSource(live.sources, cost.amount);
			if (!source) {
				ui.notifications?.warn(`No ${cost.label} left to spend on ${moveName}.`);
				return false;
			}
			// Ask the purse: the pouch counts up as it empties, Favor counts down.
			const next = source.after(cost.amount);
			if (source.key === "favor") {
				await this._stonetopCharacter.moveResources.setUses(RITES_OF_THE_LAND, next, { stonetopMove: moveName });
			} else {
				await this._stonetopCharacter.setPossessionUses(SACRED_POUCH_SLUG, next);
			}
			ui.notifications?.info(`${moveName}: spent 1 ${source.label} (${source.remaining - cost.amount} left).`);
			this.render(false);
			return true;
		}

		/**
		 * A clicked move name on an arcanum's back. Resolves the move off the card, then takes
		 * the same fork a playbook move's name-click takes: a move with something to decide (a
		 * roll, a list to pick from) opens its dialog; one that is pure text posts straight to
		 * chat. Reading is never gated — an unlearned mystery posts like an un-owned playbook
		 * move — only the dice are (see _arcanumMoveGuide).
		 */
		async _onArcanumMoveName(arcanumSlug, moveSlug) {
			const move = await this._stonetopCharacter.getArcanumMove(arcanumSlug, moveSlug);
			if (!move) return void ui.notifications.warn("That move is no longer on this arcanum.");
			const guide = this._arcanumMoveGuide(move);
			if (guide.roll || guide.picks.length) {
				this._openGuidedCharacterMove({ name: move.name, guide }, null);
				return;
			}
			// A move read off an arcanum's back has no `system.moveResults` to draw on: it is prose
			// parsed out of the card (data/arcana-moves), so its outcomes are only ever in the
			// sentence. `moveBodyHtml` reads them back out of it, which is the same ladder the
			// arcana tab prints for the same move.
			await ChatMessage.create({
				content: moveChatCard(move.name, moveBodyHtml(move.description, null)),
				speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			});
		}

		async _postGuidedCharacterMove(name, guide, html) {
			const form = html[0]?.querySelector(".stonetop-character-move-dialog");
			if (!form) return;
			const data = Object.fromEntries(new FormData(form));
			const selected = Object.entries(data)
				.filter(([key]) => key.startsWith("pick."))
				.map(([, value]) => String(value ?? "").trim())
				.filter(Boolean);
			// An arcanum move posts as a move card — its printed text, plus whatever was ticked —
			// so it reads in chat exactly like the playbook move whose name-click it mirrors. A
			// playbook guide has no card of its own and posts what was ticked on its own.
			if (guide.card) {
				const picked = selected.length
					? `<ul class="stonetop-arcanum-move-picks">${selected.map(pick => `<li>${_esc(pick)}</li>`).join("")}</ul>`
					: "";
				await ChatMessage.create({
					content: moveChatCard(name, guide.card + picked),
					speaker: ChatMessage.getSpeaker({ actor: this.actor }),
				});
				return;
			}
			postMoveToChat(this.actor, name, selected.length ? [{ label: "Selected", value: selected.join("\n") }] : []);
		}

		async _onBackgroundChange(ev) {
			const slug = ev.currentTarget.value;
			await this._stonetopCharacter.background.selectBackground(slug);
			await this._stonetopCharacter.ensureStartingMoves();
		}

		async _onAppearanceChange(ev) {
			const el   = ev.currentTarget;
			const line = Number(el.dataset.line);
			// A suggestion wins the line: clear the row's write-in box so the two can't both
			// look chosen until the next render settles it.
			const custom = this._appearanceRow(el)?.querySelector(".stonetop-appearance-custom");
			if (custom) custom.value = "";
			await this._stonetopCharacter.appearance.select(line, el.value);
		}

		// A written-in appearance line. Stored exactly like a ticked suggestion (the line holds
		// one string either way), so an emptied box clears the line rather than saving "".
		async _onAppearanceCustomChange(ev) {
			const el    = ev.currentTarget;
			const line  = Number(el.dataset.line);
			const value = el.value.trim();
			el.value = value;
			this._appearanceRow(el)?.querySelectorAll(".stonetop-appearance-radio")
				.forEach(r => { r.checked = false; });
			await this._stonetopCharacter.appearance.select(line, value);
		}

		/**
		 * The one appearance line an input belongs to — its suggestions and its write-in box.
		 * Optional-called: the saving half of both handlers is what matters, and a detached
		 * element (or a unit test's plain-object event) simply has no row to tidy.
		 */
		_appearanceRow(el) {
			return el?.closest?.(".stonetop-appearance-row") ?? null;
		}

		async _onOriginNameClick(ev) {
			await this._stonetopCharacter.updateName(ev.currentTarget.value);
		}

		async _onMoveCheck(ev) {
			const el = ev.currentTarget;
			if (el.checked) {
				const added = await this._stonetopCharacter.addMove(el.dataset.compendiumId);
				await this._maybePromptStatIncrease(added);
				await this._maybePromptForeignMove(added);
				await this._maybeOpenPossessionChoicesForMove(el.dataset.moveName);
			} else {
				await this._stonetopCharacter.removeMove(el.dataset.ownedId);
			}
		}

		// Ticking an Improved/Superior Stat box on the moves tab has to collect the same
		// "+1 to which stat?" choice the level-up flow does — otherwise the box just reads as
		// mysteriously checked with no stat bumped. Offer the stats still below the move's cap;
		// picking one records + applies it (the "+1 STR" chip then renders). Closing without a
		// pick un-ticks the box (removeMove), since a stat move with no choice does nothing.
		// Fill in the stat for an ALREADY-OWNED Improved/Superior Stat instance that never
		// had one chosen (a character imported/created before onboarding collected it — the
		// move-card "needs your input" hand routes here). Reuses the picker but must NOT
		// delete the move on cancel: the player already owns it, they're just completing it.
		async _promptFillStatIncrease(item) {
			return this._maybePromptStatIncrease(item, { removeOnCancel: false });
		}

		async _maybePromptStatIncrease(addedItem, { removeOnCancel = true } = {}) {
			if (!addedItem) return;
			const cap = addedItem.system?.cap ?? null;
			if (cap == null) return; // not a stat-increase move
			const stats    = this.actor.system?.stats ?? {};
			const eligible = _STAT_CHOICES.filter(([key]) => (stats[key]?.value ?? 0) < cap);
			if (!eligible.length) {
				ui.notifications?.warn(`${addedItem.name}: every stat is already at the maximum (+${cap}).`);
				if (removeOnCancel) await this._stonetopCharacter.removeMove(addedItem.id);
				return;
			}
			const maxed = _STAT_CHOICES
				.filter(([key]) => (stats[key]?.value ?? 0) >= cap)
				.map(([, label]) => label);
			const note = maxed.length
				? `<p class="notes">Already at the max (+${cap}): ${maxed.join(", ")}.</p>`
				: "";
			let picked = false;
			const buttons = {};
			for (const [key, label] of eligible) {
				const value = stats[key]?.value ?? 0;
				buttons[key] = {
					label: `${label} (${sign(value)} → ${sign(value + 1)})`,
					callback: async () => {
						picked = true;
						await this._stonetopCharacter._applyStatIncreaseChoice(addedItem, key, cap);
					},
				};
			}
			new Dialog({
				title:   `${addedItem.name}: Increase a Stat`,
				content: `<p>Choose one stat to raise by +1 (max +${cap}).</p>${note}`,
				buttons,
				render:  bringDialogToFront,
				// Closed without choosing (window ✕): for a freshly-ticked box, treat it as never
				// ticked (remove); for an existing owned move being filled in, just leave it be.
				close:   async () => { if (!picked && removeOnCancel) await this._stonetopCharacter.removeMove(addedItem.id); },
			}, { width: 480, classes: ["dialog", "stonetop", "stonetop-stat-picker-dialog"] }).render(true);
		}

		// Ticking a cross-playbook move (Versatile / Worldly / Dabbler / Wild Soul / Seasoned
		// Warrior / Arts of War / Initiate of the Secret Arts) on the moves tab has to collect
		// the same "which move from another playbook?" pick the level-up flow does — otherwise
		// the box just reads as checked while granting nothing (and, for Initiate, without its
		// Sacred Pouch). Offer the qualifying foreign moves; picking one grants it (tagged
		// "Granted by …" under Learned Moves) plus any bundled possession. Closing without a
		// pick un-ticks the box; dropping the move later cascades the grant away (removeMove).
		async _maybePromptForeignMove(addedItem) {
			if (!addedItem) return;
			const crossPlaybook = addedItem.system?.crossPlaybook ?? null;
			if (!crossPlaybook) return; // not a cross-playbook move
			const grantsPossession = crossPlaybook.grantsPossession ?? null;
			const level   = this.actor.system?.attributes?.level?.value ?? 1;
			const foreign = await this._stonetopCharacter.getForeignMovesForLevelUp(crossPlaybook, level);
			// Nothing new qualifies (e.g. a repeat take that already scooped every eligible move).
			if (!foreign.length) {
				if (grantsPossession) {
					// Still worth taking for its bundled possession (Initiate's Sacred Pouch) —
					// grant that (idempotent) and keep the move.
					await this._stonetopCharacter._applyForeignMoveChoice(addedItem, null, grantsPossession);
					ui.notifications?.info(`${addedItem.name}: no Blessed move qualifies right now, but its Sacred Pouch is granted.`);
				} else {
					// Pure foreign-move grant with nothing to grant → un-tick the box.
					ui.notifications?.warn(`${addedItem.name}: no qualifying moves to learn right now.`);
					await this._stonetopCharacter.removeMove(addedItem.id);
				}
				return;
			}
			// The list arrives sorted playbook-then-name; fold it into an <optgroup> per playbook.
			let optionsHtml = "", lastPb = null;
			for (const m of foreign) {
				if (m.playbook !== lastPb) {
					if (lastPb !== null) optionsHtml += "</optgroup>";
					optionsHtml += `<optgroup label="${_esc(m.playbook)}">`;
					lastPb = m.playbook;
				}
				optionsHtml += `<option value="${_esc(m.compendiumId)}">${_esc(m.name)}</option>`;
			}
			if (lastPb !== null) optionsHtml += "</optgroup>";
			const descFor = id => {
				const m = foreign.find(x => x.compendiumId === id);
				if (!m) return "";
				const req = m.requiresLabel ? `<p class="stonetop-move-note">Requires: ${_esc(m.requiresLabel)}</p>` : "";
				return `${m.description ?? ""}${req}`;
			};
			const pouchNote = grantsPossession
				? `<p class="notes">${_esc(addedItem.name)} also grants a Sacred Pouch.</p>`
				: "";
			const content = `
				<form class="stonetop-foreign-move-picker">
					<p>Choose a move to learn from another playbook.</p>
					${pouchNote}
					<select class="stonetop-foreign-move-select">${optionsHtml}</select>
					<div class="stonetop-foreign-move-desc">${descFor(foreign[0].compendiumId)}</div>
				</form>`;
			let picked = false;
			new Dialog({
				title:   `${addedItem.name}: Learn a Move`,
				content,
				buttons: {
					learn: {
						icon:  "<i class='fas fa-book'></i>",
						label: "Learn",
						callback: async html => {
							const id = html.find(".stonetop-foreign-move-select").val();
							if (!id) return;
							picked = true;
							await this._stonetopCharacter._applyForeignMoveChoice(addedItem, id, grantsPossession);
						},
					},
					cancel: { label: "Cancel" },
				},
				default: "learn",
				render: html => {
					bringDialogToFront(html);
					// Live-preview the highlighted move's text as the selection changes.
					const sel  = html.find(".stonetop-foreign-move-select");
					const desc = html.find(".stonetop-foreign-move-desc");
					sel.on("change", () => desc.html(descFor(sel.val())));
				},
				// Closed without learning anything (Cancel / window ✕) → un-tick the box.
				close: async () => { if (!picked) await this._stonetopCharacter.removeMove(addedItem.id); },
			}, { width: 520, classes: ["dialog", "stonetop", "stonetop-foreign-move-dialog"] }).render(true);
		}

		async _onMoveResourceChange(ev) {
			const button = new MoveResourceButton(ev);
			await this._stonetopCharacter.moveResources.add(button);
		}

		async _onBackgroundResourceChange(ev) {
			const { key, index } = ev.currentTarget.dataset;
			if (!key) return;
			const value = ev.currentTarget.classList.contains("is-checked") ? Number(index) : Number(index) + 1;
			await this._stonetopCharacter.background.setSetupResource(key, value);
		}

		async _onBgChoiceChange(ev) {
			const choice = new BackgroundInputChoice(ev);
			await this._stonetopCharacter.background.addChoice(choice);
		}

		async _onBackgroundActionCheck(ev) {
			const cb = ev.currentTarget;
			const { slug } = cb.dataset;
			if (!slug) return;
			if (cb.checked) {
				// Enforce the level-gated limit directly, not just via the rendered disabled
				// attribute — otherwise rapid clicks before the re-render lands could mark
				// more than allowed. Revert the checkbox if the limit is already reached.
				const allowed = await this._stonetopCharacter.allowedMarkedActions();
				const marked  = this._stonetopCharacter.background.markedActions;
				if (!marked.includes(slug) && marked.length >= allowed) {
					cb.checked = false;
					return;
				}
				await this._stonetopCharacter.background.markAction(slug);
			} else {
				await this._stonetopCharacter.background.unmarkAction(slug);
			}
		}

		async _onPossessionCheck(ev) {
			const { slug } = ev.currentTarget.dataset;
			if (ev.currentTarget.checked) {
				await this._stonetopCharacter.selectPossession(slug);
			} else {
				await this._stonetopCharacter.deselectPossession(slug);
			}
		}

		async _onRemoveCustomPossession(ev) {
			await this._stonetopCharacter.removeCustomPossession(ev.currentTarget.dataset.slug);
		}

		async _onPossessionUseChange(ev) {
			const btn = new PossessionUseButton(ev);
			const newVal = btn.isChecked() ? btn.index : btn.index + 1;
			if (btn.choiceSlug) {
				await this._stonetopCharacter.setSubChoiceUses(btn.possessionSlug, btn.choiceSlug, newVal);
			} else {
				await this._stonetopCharacter.setPossessionUses(btn.possessionSlug, newVal);
			}
		}

		async _onPossessionSubCheck(ev) {
			const { possessionSlug, choiceSlug } = ev.currentTarget.dataset;
			if (ev.currentTarget.checked) {
				await this._stonetopCharacter.selectSubChoice(possessionSlug, choiceSlug);
			} else {
				await this._stonetopCharacter.deselectSubChoice(possessionSlug, choiceSlug);
			}
		}

		// Weapons-of-war style gear (see tab-equipment.hbs): the options a possession's `choices`
		// bundle has already had chosen, rendered as ◇/□ rows. Ticking a diamond marks that
		// weapon as carried — the pick itself lives on the edit-mode checklist — and load
		// re-derives on the re-render.
		async _onPossessionChoiceGearCheck(ev) {
			const el = ev.currentTarget;
			const { possessionSlug, choiceSlug } = el.dataset;
			// A ◇◇ weapon renders one diamond per point of weight, all bound to one carried/not
			// state; the browser only flips the clicked box, so mirror it onto its siblings and
			// the wrapper now — otherwise the rest visibly lags until the async re-render lands.
			const group = el.closest(".stonetop-inv-diamonds");
			if (group) for (const box of group.querySelectorAll(".stonetop-inv-diamond")) box.checked = el.checked;
			el.closest(".stonetop-inv-item")?.classList.toggle("is-checked", el.checked);
			await this._stonetopCharacter.setChoiceGearCarried(possessionSlug, choiceSlug, el.checked);
			this.render(false);
		}

		async _onInventoryItemCheck(ev) {
			// Have What You Need: marking an item spends marks from the undefined pool
			// (its weight, or 1 for a small item); any shortfall adds to your load as
			// loot. Un-marking returns the marks. The derived load updates on re-render.
			const el = ev.currentTarget;
			if (!el.dataset.slug) return; // ignore the slug-less undefined-pool diamonds
			// A multi-weight item renders one diamond per point of weight, all bound to the
			// single carried/not-carried state. The browser only toggles the clicked diamond,
			// so mirror its state onto the sibling diamonds and the wrapper now — otherwise the
			// rest of the track visibly lags until the async re-render below lands.
			const group = el.closest(".stonetop-inv-diamonds");
			if (group) for (const box of group.querySelectorAll(".stonetop-inv-diamond")) box.checked = el.checked;
			el.closest(".stonetop-inv-item")?.classList.toggle("is-checked", el.checked);
			// Small items in the columns sit inside `.stonetop-inventory-small`; the same
			// items rendered inside a possession card carry `data-small` instead (they're
			// outside that column but must still draw from the small pool).
			const smallColumn = el.closest(".stonetop-inventory-small");
			const small = el.dataset.small === "true" || !!smallColumn;
			if (small && el.checked && smallColumn) this._warnIfOverSmallAllotment(smallColumn);
			await this._stonetopCharacter.toggleCarriedItem(el.dataset.slug, el.checked, {
				small,
				weight: Number(el.dataset.weight ?? 1),
			});
			this.render(false);
		}

		// Small items don't count toward load and have no hard limit (Book I p.84/326),
		// so marking past the 4+Prosperity Outfit allotment is allowed — but flag it, so
		// the player remembers to expend supplies or square it with the GM. Only warns
		// when a steading is linked (otherwise Prosperity, and the allotment, is unknown).
		_warnIfOverSmallAllotment(smallColumn) {
			const raw = smallColumn.dataset.smallAllotment;
			if (raw == null || raw === "") return;
			const allotment = Number(raw);
			if (!Number.isFinite(allotment)) return;
			// The clicked box is already checked, so the live count includes it.
			const checkedSmall = smallColumn.querySelectorAll(
				".stonetop-inventory-item-check[data-slug]:checked").length;
			if (checkedSmall > allotment) {
				ui.notifications.warn(game.i18n.format("stonetop.inventory.smallOverAllotment", { limit: allotment }));
			}
		}

		async _onInventoryResource(ev) {
			const { slug, index } = ev.currentTarget.dataset;
			const isChecked = ev.currentTarget.classList.contains("is-checked");
			const newVal = isChecked ? Number(index) : Number(index) + 1;
			await this._stonetopCharacter.setInventoryResource(slug, newVal);
			this.render(false);
		}

		async _onAddInventoryItem(ev) {
			const column = ev.currentTarget.dataset.column === "small" ? "small" : "regular";
			new AddInventoryItemDialog(characterInventoryItemSaver(this._stonetopCharacter), {
				column,
				onSaved: () => this.render(false),
			}).render(true);
		}


		async _onDeleteCustomInventoryItem(ev) {
			await this._stonetopCharacter.removeCustomInventoryItem(ev.currentTarget.dataset.ownedId);
		}

		async _onRemoveSpecialItem(ev) {
			await this._stonetopCharacter.removeSpecialItem(ev.currentTarget.dataset.slug);
		}

		/**
		 * ON THE HOOF (the Ranger): 1d6 uses of provisions for a day's travel, "with disadvantage
		 * in winter or barren terrain". Disadvantage on a single d6 is the lower of two, which is
		 * what `2d6kl` rolls — the same shape the roll dialog's adv/dis uses on 2d6, applied to
		 * this move's one die.
		 *
		 * Gated on owning the move, like every other MOVE_USE_EFFECTS handler: the row posts its
		 * text for anyone reading another playbook's page, and only a Ranger actually procures.
		 */
		async _onTheHoof() {
			if (!this.isEditable || !ownedMove(this.actor, ON_THE_HOOF)) return;
			new Dialog({
				title: ON_THE_HOOF,
				content: `<form class="stonetop-homestead-dialog">
					<p class="stonetop-homestead-trigger"><em>When you travel through the wilderness, you can procure 1d6 uses of provisions each day.</em></p>
					<label class="stonetop-camp-extra"><input type="checkbox" name="lean">
						<span>Winter, or barren terrain: roll with <strong>disadvantage</strong></span></label>
				</form>`,
				buttons: {
					cancel:  { label: "Cancel" },
					procure: {
						label: "Procure the day's food",
						callback: (html) => this._procureProvisions(html.find('[name="lean"]').is(":checked")),
					},
				},
				default: "procure",
				render: bringDialogToFront,
			}, { width: 460, classes: this._pastDeathWindowClasses(["dialog", "stonetop"]) }).render(true);
		}

		async _procureProvisions(lean) {
			const { uses, larder } = await rollProvisions(this.actor, {
				formula: lean ? "2d6kl" : "1d6",
				carry:   true,
				flavor:  lean ? `${ON_THE_HOOF}: provisions (1d6, disadvantage)` : `${ON_THE_HOOF}: provisions (1d6)`,
			});
			if (larder) ui.notifications.info(`Procured ${uses} uses of provisions (${larder.held} in the pack).`);
			this.render(false);
		}

		/**
		 * Butcher the goat, harvest the brightberries: turn a carried thing into uses of
		 * provisions. One handler for every such row, because what is on offer is read off the
		 * row's own printed note rather than a list of slugs kept somewhere else.
		 *
		 * The source is deliberately NOT consumed. A goat butchered is a goat gone, but a
		 * brightberry bush is not, snowembers are picked "with a few hours' effort" and the note
		 * says nothing about the shrub, and guessing wrong either way silently destroys a
		 * player's gear or silently duplicates food. The ◇ is one click away on the same row.
		 */
		async _onHarvestProvisions(ev) {
			ev.preventDefault();
			const btn = ev.currentTarget;
			const { formula, roll: isRoll, name } = btn.dataset;
			if (!formula) return;
			btn.disabled = true;
			try {
				// Always claims the ◇: this food is going into the pack as its own load, which is
				// what "◇ Provisions" in every one of these notes means.
				const { uses, larder } = await rollProvisions(this.actor, {
					formula,
					announce: isRoll === "1",
					carry:    true,
				});
				if (larder) {
					postMoveToChat(this.actor, "Provisions", [
						{ label: name || "Harvested",
						  value: `+${uses} ${uses === 1 ? "use" : "uses"} (${larder.held} in the pack)` },
					]);
				}
				this.render(false);
			} catch (err) {
				console.error("Stonetop | Error harvesting provisions:", err);
				btn.disabled = false;
			}
		}

		async _onInventoryReset() {
			Dialog.confirm({
				title: game.i18n.localize("stonetop.inventory.resetTitle"),
				content: `<p>${game.i18n.localize("stonetop.inventory.resetConfirm")}</p>`,
				yes: async () => {
					await this._stonetopCharacter.resetInventorySelections();
					this.render(false);
				},
				render: bringDialogToFront,
				options: { classes: ["dialog", "stonetop"] },
			});
		}

		async _onInventoryPoolEdit(ev) {
			// The undefined ◇/□ pools are freely editable tracks: clicking a diamond
			// sets the reserve count (click a filled one to clear back to it).
			const el = ev.currentTarget;
			const index    = Number(el.dataset.index);
			const isSmall  = el.classList.contains("stonetop-small-pool-display");
			const track    = el.closest(".stonetop-supplies-pool-diamonds");
			// Cap = room left under the load limit after the items already marked. The track
			// always shows the full capacity, so it includes empty slots past the cap; a
			// click that would reserve beyond it is clamped to the cap. filledBefore = the
			// reserve already showing (the .is-checked diamonds — that class is render-time,
			// so the just-clicked box isn't counted yet), which tells us if there was room.
			const cap = Number(track?.dataset.poolCap ?? Infinity);
			const filledBefore = track?.querySelectorAll(".is-checked").length ?? 0;
			let newCount = el.checked ? index + 1 : index;
			if (el.checked && newCount > cap) {
				newCount = cap;
				// Only warn when the reserve was already maxed (truly no room); otherwise
				// the click just filled the remaining room up to the cap.
				if (filledBefore >= cap) {
					ui.notifications.warn(game.i18n.localize(
						isSmall ? "stonetop.inventory.smallPoolAtLimit" : "stonetop.inventory.regularPoolAtLimit"));
				}
			}
			if (isSmall) {
				await this._stonetopCharacter.setInventorySmallPool(newCount);
			} else {
				await this._stonetopCharacter.setInventoryRegularPool(newCount);
			}
			this.render(false);
		}

		_onRequisition() {
			const steading = this._stonetopCharacter?.getSteadingActor();
			if (!steading) {
				ui.notifications.warn("This character isn't linked to a steading.");
				return;
			}
			new RequisitionDialog(
				this._stonetopCharacter,
				this.actor,
				steading,
				() => this.render(false),
				{ classes: this._pastDeathWindowClasses(RequisitionDialog.defaultOptions.classes) },
			).render(true);
		}

		async _onOutfitOpen() {
			const snapshot = await this._stonetopCharacter.buildSnapshot();
			new OutfitMoveDialog(
				this._stonetopCharacter,
				snapshot.inventory.outfit,
				() => this.render(false),
				{ classes: this._pastDeathWindowClasses(OutfitMoveDialog.defaultOptions.classes) },
			).render(true);
		}

		async _onLevelUpOpen() {
			const levelUpData = await this._stonetopCharacter.getLevelUpData();
			new LevelUpDialog(
				this._stonetopCharacter,
				levelUpData,
				(addedMoveName) => {
					this.render(false);
					// Levelling into Big Magic frees an additional remarkable trait — open
					// the sacred-pouch editor so the player picks it right away.
					if (addedMoveName) this._maybeOpenPossessionChoicesForMove(addedMoveName);
				},
				{ classes: this._pastDeathWindowClasses(LevelUpDialog.defaultOptions.classes) },
			).render(true);
		}

		/**
		 * Open the Death's Door walkthrough — but only when Death's Door is the move this
		 * character actually triggers. A PC carrying a post-death insert has their own 0-HP
		 * move (Undying / Tethered / Dark Succor), so they get pointed at it instead of a
		 * dialog that would walk them through the wrong rules.
		 */
		async _onDeathsDoorOpen() {
			const move = this._stonetopCharacter.zeroHpMove;
			// A character with an insert faces their insert's 0-HP move, which has its own
			// walkthrough — it marks consequences, gains and crosses off Marks, and resets Favor.
			// Gated the same way the card's own button is (_buildDeathsDoorData): a dying chat
			// card stays in the log forever and comes through here too, so without this an old
			// one re-opens the move — and hands out half their max HP again — for a Revenant who
			// is back on their feet, or a second time for a Ghost still dispersed.
			if (!move.dialog) {
				const state = this._stonetopCharacter.deathsDoorState;
				const settled = state === DEATHS_DOOR_STATE.OUT_OF_ACTION || state === DEATHS_DOOR_STATE.DEAD;
				if (this._stonetopCharacter.hp > 0 || settled) return;
				return this._onUndeathOpen();
			}
			// A spent 6- still opens the dialog — not to roll again, but to choose the fate it
			// left hanging; the dialog resumes on that step.
			const pending = this._stonetopCharacter.deathsDoorState === DEATHS_DOOR_STATE.FATE_PENDING;
			if (!pending && !this._stonetopCharacter.canFaceDeathsDoor) return;
			new DeathsDoorDialog(
				this._stonetopCharacter,
				() => this.render(false),
			).render(true);
		}

		/**
		 * Open the walkthrough for an insert's 0-HP move (Undying / Tethered / Dark Succor).
		 * Falls back to simply rolling the move for a homebrew insert we have no spec for, so an
		 * unrecognised insert still gets its move rather than a dead button.
		 */
		async _onUndeathOpen() {
			const move = this._stonetopCharacter.zeroHpMove;
			if (!this._stonetopCharacter.zeroHpResolution) return this.rollMoveByName(move.name);
			await UndeathDialog.open(this._stonetopCharacter, () => this.render(false));
		}

		/**
		 * Roll (or post) one of the character's own moves by name — the entry point the dying
		 * chat card uses to hand an undead PC their insert's 0-HP move. Falls back to a notice
		 * rather than silence when the move isn't on the sheet, since that means the insert's
		 * moves failed to embed.
		 */
		async rollMoveByName(name, opts = {}) {
			const item = this.actor?.items?.find(i => i.type === "move" && i.name === name);
			if (!item) return void ui.notifications.warn(`${name} isn't on this character's sheet.`);
			return this.rollMoveById(item.id, opts);
		}

		/**
		 * Clear a lingering death state. The 7-9 leaves the character out of the action "until
		 * you say otherwise" (p.245) — this is the GM (or the player) saying otherwise. Also
		 * un-does a mistaken "stepped through the Last Door", which nothing else reverses.
		 */
		async _onDeathsDoorClear() {
			if (!this.isEditable) return;
			// A dispersed Ghost doesn't just wake up: "you reform near your tether with half your
			// max HP". Clearing the state IS the reforming, so it brings the hit points with it,
			// in the one write.
			const disperses = this._stonetopCharacter.zeroHpResolution?.disperses;
			const reformHp = disperses && this._stonetopCharacter.deathsDoorState === DEATHS_DOOR_STATE.OUT_OF_ACTION
				? resolvedHp(disperses, await this._stonetopCharacter.computedMaxHp())
				: null;
			if (reformHp !== null) await this._stonetopCharacter.restoreHp(reformHp, "Tethered", { clearsDeathsDoor: true });
			else await this._stonetopCharacter.setDeathsDoorState(null);
			this.render(false);
		}

		/**
		 * Put the Post-Death tab on this sheet, and go to it.
		 *
		 * The manual counterpart to Death's Door granting an insert on its 6-: a table that played
		 * the Last Door out in conversation leaves no state behind, so nothing else on the sheet
		 * ever asks for the tab, and the "Choose Your Fate" picker its own hint text advertises for
		 * exactly that case could not be reached. Writes the same request flag that removing an
		 * insert writes, so the tab's foot still takes it away again.
		 *
		 * Deliberately does NOT touch deathsDoorState: whether this character owes a fate is the
		 * table's account of what happened, and asking to see the picker is not a claim about it.
		 */
		async _onPostDeathTabOpen() {
			if (!this.isEditable) return;
			await this._stonetopCharacter.setPostDeathTabRequested(true);
			// Consumed by _render, for the reason the dropped-arcanum switch is: the flag write
			// schedules its own auto-render, which races the explicit one below, and presetting the
			// active tab loses that race intermittently.
			this._activateTabOnRender = "post-death";
			this.render(false);
		}

		/**
		 * The `Dead` tag in the header: ask whether they're being brought back.
		 *
		 * The same question the hit-point route asks, from the same place, so the two can't come to
		 * disagree about what a raise does — it is the prompt's own module that owns both the wording
		 * and the write. Nothing happens here if they say no, and the sheet re-renders either way
		 * because the answer decides whether this tag and the black paper are still true.
		 */
		async _onDeadTagClick() {
			if (!this.isEditable) return;
			await promptRaiseFromDead(this.actor);
			if (this.rendered) this.render(false);
		}

		/**
		 * The header candle: snuff the light, or light it by hand. A manual toggle is the
		 * player correcting the tracker (the flame guttered out, the GM says it's out), so it
		 * posts nothing to chat — the same convention Defend's Readiness pips follow.
		 */
		async _onHolyLightToggle(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			if (!this.isEditable) return;
			const lit = this._stonetopCharacter.holyLight;
			// "An Invocation will end immediately if your holy light is extinguished." Read its name
			// FIRST, because by the time the write returns there is nothing left to tell the table
			// what went out — and then END IT HERE, so the chat card is gated on the write that
			// actually did it. The model drops it too, and must (no future way of putting a light
			// out may strand a Lightbearer concentrating on nothing), but its own boolean conflates
			// "the light changed" with "an Invocation went with it" and only the second is news.
			// Dropping it first makes the model's own drop a no-op, so this is still two writes.
			const ending = lit ? this._invocationLabel(this._stonetopCharacter.ongoingInvocation) : "";
			const ended  = !!ending && await this._stonetopCharacter.setOngoingInvocation("");
			const snuffed = await this._stonetopCharacter.setHolyLight(!lit);
			if (snuffed || ended) this.render(false);
			// The candle itself still posts nothing — snuffing it is the player correcting the
			// tracker. The Invocation it took with it is a different thing: that one was affecting
			// the fiction, and its ending is news. Said ONCE: a second click that found the
			// Invocation already gone wrote nothing, so it has nothing to announce.
			if (ended) await this._postInvocationEnded(ending, "light");
		}

		/**
		 * End the Invocation being held open — the "End it" control on the tab banner and on the
		 * header chip. "You can end an Invocation whenever you wish", so there is nothing to
		 * confirm and nothing to roll; it is one click, and re-invoking is one more.
		 *
		 * The card is posted only when the write actually ended something. There are two controls
		 * for the one act (the header chip and the tab banner) plus however many clients have this
		 * sheet open, so "it was running when I read it" is not the same question as "I am the one
		 * who stopped it" — and the table should hear it stop once.
		 */
		async _onEndOngoingInvocation(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			if (!this.isEditable) return;
			const ending = this._invocationLabel(this._stonetopCharacter.ongoingInvocation);
			if (!ending) return;
			if (!await this._stonetopCharacter.setOngoingInvocation("")) return;
			this.render(false);
			await this._postInvocationEnded(ending, "byHand");
		}

		/** Tell the table an Invocation stopped, and why. */
		_postInvocationEnded(label, reason) {
			const key = INVOCATION_ENDED_KEYS[reason] ?? INVOCATION_ENDED_KEYS.byHand;
			return this._postMoveCard(
				game.i18n.localize("stonetop.invocations.endedTitle"),
				`<p>${game.i18n.format(key, { name: escHtml(label) })}</p>`);
		}

		/**
		 * The header scales: open the roster of everyone this Judge has branded.
		 *
		 * A window rather than a tab. Condemn is not a thing the Judge does every session, the list
		 * is usually three or four names, and a whole tab standing empty on every Judge who has not
		 * taken the move yet (or has dismissed everybody) is worse than a button that appears when
		 * there is something to see — the same call the post-death walkthrough made when its tab
		 * button was cut.
		 *
		 * One window PER CHARACTER (perDocumentOptions): two Judges at one table is an ordinary
		 * evening, and two dialogs sharing one AppV1 id paint into each other's frame.
		 */
		async _onCondemnOpen(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			await this._openCondemned();
		}

		_openCondemned() {
			return new CondemnedDialog(this.actor, this._stonetopCharacter, { editable: this.isEditable }).render(true);
		}

		/**
		 * Using the move opens the roster — the Judge's half of the Consecrated Flame hook above.
		 * Neither move has a rollType, so posting its text IS using it and both fall through to
		 * the description-only path that calls this.
		 *
		 * BOTH moves, not just Condemn. Condemn is passive — it never fires on its own, it amends
		 * what Censure does ("When you Censure someone, they ARE marked"). So the moment a brand is
		 * actually laid is a Censure, and a Judge who denounced somebody and was handed no way to
		 * write it down would be back to keeping the list in their head, which is the thing this
		 * feature exists to stop. Reading Condemn itself opens it too, since that is where a player
		 * goes looking for what the move is doing.
		 *
		 * Gated on OWNING Condemn: a Judge who has not taken it brands nobody when they Censure, so
		 * the roster is not theirs to open.
		 */
		async _openCondemnedIfJudge() {
			// Either move is enough. Condemn and Censure open the brands; Binding Arbitration opens
			// the same window for its own half, which is the whole reason the two lists share one.
			if (!this._stonetopCharacter.canCondemn && !this._stonetopCharacter.canBindOaths) return;
			await this._openCondemned();
		}

		/**
		 * The Blessed's roster of standing marks, from the header glyph.
		 *
		 * A window rather than a tab, for the reason the Judge's is: five moves that a Blessed uses
		 * a handful of times a session, usually two or three rows, and a permanent tab standing
		 * empty on every Blessed who has taken none of the five is worse than a glyph that appears
		 * when there is something to see.
		 *
		 * One window PER CHARACTER (perDocumentOptions): two Blessed at one table is unusual but
		 * legal, and two dialogs sharing one AppV1 id paint into each other's frame.
		 */
		async _onBlessedMarksOpen(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			await this._openBlessedMarks();
		}

		_openBlessedMarks() {
			return new BlessedMarksDialog(this.actor, this._stonetopCharacter, { editable: this.isEditable }).render(true);
		}

		/**
		 * Using any of the five marking moves opens the roster — the Blessed's half of the
		 * Consecrated Flame and Condemn hooks above. Three of the five are description-only and
		 * arrive through MOVE_USE_EFFECTS; the other two roll +INT and arrive through
		 * MOVE_ROLL_EFFECTS. Both land here.
		 *
		 * Gated on OWNING one of them, so reading an un-owned move's text off the playbook list
		 * opens nothing.
		 */
		async _openBlessedMarksIfBlessed() {
			if (!this._stonetopCharacter.canMarkBlessed) return;
			await this._openBlessedMarks();
		}

		/**
		 * What rolling a move does beyond rolling it. Resolved from the ITEM rather than the row's
		 * text, for the reason MOVE_USE_EFFECTS is: an un-owned playbook row carries no item id at
		 * all, and a player-authored custom move can be called anything.
		 */
		async _onMoveRolled(item) {
			const effect = item?.name ? MOVE_ROLL_EFFECTS[item.name] : null;
			if (effect) await effect(this);
		}

		/** The same, for a caller that has only the clicked row. */
		async _onRollableRolled(rollable) {
			const itemId = rollable?.closest(".item")?.dataset?.itemId;
			return this._onMoveRolled(itemId ? this.actor.items.get(itemId) : null);
		}

		/**
		 * The header's Battle Joy glyph: lose yourself in the fight, or come out of it.
		 *
		 * TURNING IT ON writes nothing else. It is a fictional state the player declares, exactly
		 * as consecrating a flame is, and it posts nothing to chat for the same reason the candle
		 * doesn't.
		 *
		 * TURNING IT OFF is a different thing, because the move attaches a roll to that moment:
		 * "when the action stops, roll +CON". So this asks rather than assuming — a Heavy who
		 * ticked the glyph by mistake, or whose GM has already resolved it in the fiction, must be
		 * able to simply stop. Answering yes rolls Battle Joy itself, which is also the path a
		 * player gets by clicking the move on the Moves tab; both go through the model, which drops
		 * the state before building the roll so their debilities are back in play for it.
		 */
		async _onBattleJoyToggle(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			if (!this.isEditable) return;
			const raging = this._stonetopCharacter.battleJoy;
			if (!raging) {
				if (await this._stonetopCharacter.setBattleJoy(true)) this.render(false);
				return;
			}
			const item = this.actor.items.find(i => i.type === "move" && i.name === BATTLE_JOY);
			// No move on the sheet means this state was stranded by a playbook swap: there is
			// nothing to roll, so the only thing left to offer is putting it out.
			const rolled = item && await Dialog.confirm({
				title:   game.i18n.localize("stonetop.battleJoy.endTitle"),
				content: `<p>${game.i18n.localize("stonetop.battleJoy.endPrompt")}</p>`,
				yes:     () => true,
				no:      () => false,
				defaultYes: true,
				render:  bringDialogToFront,
				options: { classes: ["dialog", "stonetop"] },
			});
			// Cancelled with Escape or the X — leave the Heavy exactly as they were, still raging.
			if (rolled === null) return;
			if (rolled) {
				// Rolling it IS leaving it: the model clears the state on the way into the roll.
				// Through the shared stand-in builder, so the header drives the same roll path the
				// Moves tab does.
				const rollable = this._makeSyntheticRollable(item);
				if (rollable) {
					// …and through the same pre-roll ladder, so the header asks what the Moves tab
					// asks. Without it this was the one 2d6 move on the sheet that could never be
					// rolled with advantage, disadvantage, or a one-off modifier — the sticky sheet
					// control that used to carry those is gone, and this window is where they live
					// now. Shift on the glyph skips it, exactly as it does on a move's title.
					const prompted = await this._resolveMoveRollPrompts(rollable, { shiftKey: ev.shiftKey });
					// "handled" — a dialog owns the roll from here and will run it through the same
					// model call, which drops the raging state itself. "cancel" — they backed out of
					// the roll prompt, so the roll never happened and neither did the leaving: still
					// raging, the same answer Escape on the confirm above gives.
					if (prompted === "handled" || prompted === "cancel") return;
					await this._stonetopCharacter.onRoll({ currentTarget: rollable }, prompted);
					this.render(false);
					return;
				}
				// Null for a Battle Joy carrying no rollType — a hand-edited, imported or homebrew
				// one; the packaged move has `rollType: "con"`. `onRoll` declines that too, so
				// there is genuinely nothing to roll. But the player answered "end it", and simply
				// repainting an unchanged raging state is a click that did nothing and said
				// nothing, leaving the only way out a second click and a "No". So: honour the half
				// that can be honoured, and say why the other half did not happen.
				ui.notifications?.warn(game.i18n.localize("stonetop.battleJoy.noRollType"));
				if (await this._stonetopCharacter.setBattleJoy(false)) this.render(false);
				return;
			}
			if (await this._stonetopCharacter.setBattleJoy(false)) this.render(false);
		}

		/**
		 * Consecrating a flame lights the holy light. Called on both paths by which a
		 * description-only owned move is used — the move-name click and the hotbar macro — and
		 * matched on the resolved ITEM, never on the row's text: an un-owned playbook row posts
		 * its text with no item id at all, and a player-authored custom move can carry any name.
		 *
		 * One slot, so re-consecrating writes nothing (setHolyLight returns false) and the sheet
		 * doesn't re-render. No chat card either: the move's own card has already posted.
		 */
		async _consecrateFlame() {
			if (!this.isEditable) return;
			if (await this._stonetopCharacter.setHolyLight(true)) this.render(false);
		}

		/**
		 * Run whatever using this description-only move does beyond posting its text — see
		 * MOVE_USE_EFFECTS. One lookup, called from both tails that post a move to chat.
		 */
		async _onDescriptionMoveUsed(item) {
			if (item?.type !== "move") return;
			await MOVE_USE_EFFECTS[item.name]?.(this);
		}

		// Open the Create-a-Follower walkthrough (Book I, NPCs & Followers, p.474).
		// On finish it hands back buildCustomFollower() data, which we persist.
		async _onCreateFollowerOpen() {
			if (!this.isEditable) return;
			new CreateFollowerDialog(
				this.actor,
				(data) => this._applyCustomFollower(data),
				// Recruit a villager: offer the linked steading's residents as name
				// suggestions on the walkthrough's first step (NPCs & Followers p.474).
				{ residentNames: this._steadingResidentNames() },
			).render(true);
		}

		// Names of the linked steading's residents (+ neighbors), for the Create-a-Follower
		// name datalist. Best-effort — a missing/unlinked steading just yields no hints.
		// steading-people.js owns where the people rows live, so the storage path stays there.
		_steadingResidentNames() {
			return peopleNames(this._stonetopCharacter?.getSteadingActor?.());
		}

		// Offer to convert a dropped monster into a follower (keep its stats, add
		// tags, choose a cost — p.475). Cancelling the modal does nothing.
		_onMonsterDropConvert(monsterDoc) {
			if (!this.isEditable || !monsterDoc) return;
			new MonsterToFollowerDialog(
				this.actor,
				monsterDoc,
				(data) => this._applyCustomFollower(data),
			).render(true);
		}

		// Offer to make a dropped NPC this PC's follower (carry its identity + stats,
		// add tags, choose a cost — p.475). The built card links back to the NPC actor
		// via sourceUuid. Cancelling the modal does nothing.
		_onNpcDropConvert(npcDoc) {
			if (!this.isEditable || !npcDoc) return;
			new NpcToFollowerDialog(
				this.actor,
				npcDoc,
				(data) => this._applyCustomFollower(data),
			).render(true);
		}

		// Toggle the viewing user's "show both sides" preference for one arcanum. Kept as a
		// User flag (not on the actor) so the GM's spread choices stay independent of the
		// owning player's — each client renders its own. Keyed by actor id, since one user
		// may view several character sheets. Writing only this actor's key lets Foundry's
		// mergeObject preserve preferences for the user's other sheets.
		async _toggleArcanumShowBoth(slug, show) {
			const set = new Set((game.user.getFlag(STONETOP_SCOPE, "arcanaShowBoth") ?? {})[this.actor.id] ?? []);
			if (show) set.add(slug); else set.delete(slug);
			await game.user.setFlag(STONETOP_SCOPE, "arcanaShowBoth", { [this.actor.id]: [...set] });
			// Collapsing a spread ("Show front only") returns to the front, so clear any lingering
			// back-only flip on this card — otherwise it would land on the back, belying the label.
			if (!show) await this._toggleArcanumShowBack(slug, false);
		}

		// Toggle the viewing user's single-side "show back" preference for one arcanum. Stored
		// exactly like show-both (a per-user, per-actor User flag) so each client renders its own
		// flip state and the GM's choices stay independent of the owning player's.
		async _toggleArcanumShowBack(slug, show) {
			const set = new Set((game.user.getFlag(STONETOP_SCOPE, "arcanaShowBack") ?? {})[this.actor.id] ?? []);
			if (show) set.add(slug); else set.delete(slug);
			await game.user.setFlag(STONETOP_SCOPE, "arcanaShowBack", { [this.actor.id]: [...set] });
		}

		// Drop a removed arcanum's slug from this user's per-actor show-both / show-back view
		// preferences, so a re-acquired card doesn't re-open as a spread the user never requested
		// and the flag arrays don't accumulate dead slugs. Per-user by nature — only the acting
		// user's prefs are reachable here (others prune their own on their next removal/toggle).
		async _pruneArcanumUserPrefs(slug) {
			// The two prefs are independent flags, so prune them concurrently.
			await Promise.all(["arcanaShowBoth", "arcanaShowBack"].map(flag => {
				const all = game.user.getFlag(STONETOP_SCOPE, flag);
				const forActor = all?.[this.actor.id];
				if (!Array.isArray(forActor) || !forActor.includes(slug)) return null;
				return game.user.setFlag(STONETOP_SCOPE, flag, { ...all, [this.actor.id]: forActor.filter(s => s !== slug) });
			}));
		}

		// Manifest an arcanum's bound creature(s) as followers (the arcana whose reverse
		// says "Treat it/them as a follower" — see ARCANA_SUMMONS). Triggered by the
		// "Add as follower" button on the arcanum's back side. Confirm first (it adds
		// cards to the Followers tab), then add any not already present — matched by their
		// stable sourceUuid marker so re-summoning never piles up duplicate cards.
		async _onArcanaSummon(slug) {
			if (!this.isEditable) return;
			const arcanum = await this._stonetopCharacter.getArcanum(slug);
			// `viaCallUp` followers (the Ring of Daagon's Servants) aren't manifested by this
			// button — they're rolled through the Call Up the Deep Ones dialog. The Ring's
			// button adds just the Ring itself.
			const followers = arcanaSummonFollowers(arcanum)?.filter(f => !f.viaCallUp);
			if (!followers?.length) return;
			const names = joinNames(followers.map(f => f.name));
			const plural = followers.length > 1;
			const confirmed = await Dialog.confirm({
				title:      "Manifest follower",
				content:    `<p>Manifest <strong>${escHtml(names)}</strong> and add ${plural ? "them" : "it"} to your Followers tab?</p>`,
				yes:        () => true,
				no:         () => false,
				defaultYes: false,
				render:     bringDialogToFront,
				options:    { classes: ["dialog", "stonetop"] },
			});
			if (!confirmed) return;

			const existing = this.actor.getFlag(STONETOP_SCOPE, "customFollowers") ?? {};
			const present  = new Set(Object.values(existing).map(f => f?.sourceUuid).filter(Boolean));
			const update   = {};
			let order = this._nextFollowerOrder();
			for (const input of followers) {
				// `repeatable` followers (e.g. the Ring of Daagon's Servants) can be
				// summoned again and again, so they're never deduped by sourceUuid.
				if (!input.repeatable && present.has(input.sourceUuid)) continue;
				const id = foundry.utils.randomID(16);
				update[`flags.stonetop-pwd.customFollowers.${id}`] = { ...buildCustomFollower(input), order: order++ };
			}
			if (Object.keys(update).length) await this.actor.update(update);
			this.render(false);
		}

		// ── Ring of Daagon: Call Up the Deep Ones / Send Them Back ───────────────────
		// The Ring's Servants aren't a fixed summon — each Call Up rolls five d4s and
		// shapes a fresh batch (see servant-of-daagon.js / CallUpDeepOnesDialog). The
		// batch shares the Ring's Loyalty pool, so both live as linked custom followers.

		// The Ring-of-Daagon follower on this sheet (or a null-ish stub), for the shared
		// Loyalty pool that Call Up spends and a Servant's Spend button draws on.
		_ringFollowerEntry() {
			return findRingFollower(this.actor.getFlag(STONETOP_SCOPE, "customFollowers") ?? {});
		}

		// Open the Call Up the Deep Ones roller. Requires the Ring itself to be a follower
		// (its mysteries unlocked) — the Servants share its Loyalty pool.
		async _onCallUpDeepOnes() {
			if (!this.isEditable) return;
			const ring = this._ringFollowerEntry();
			if (!ring.hasRing) {
				ui.notifications?.warn?.("Add the Ring of Daagon as a follower first, then Call Up the Deep Ones.");
				return;
			}
			new CallUpDeepOnesDialog(this.actor, ring, ({ input, cost }) => this._applyCallUp(input, cost)).render(true);
		}

		// Manifest a rolled Servant batch as a fresh custom follower and pay Call Up's cost
		// (spend 1 of the Ring's Loyalty, or mark a consequence). Re-reads the Ring live —
		// the roller is non-modal, so its Loyalty may have moved since it opened.
		async _applyCallUp(input, cost) {
			const ring   = this._ringFollowerEntry();
			const id     = foundry.utils.randomID(16);
			const update = {
				[`flags.stonetop-pwd.customFollowers.${id}`]: { ...buildServantFollower(input), order: this._nextFollowerOrder() },
			};
			let costLine;
			if (cost?.kind === "loyalty" && ring.id && ring.loyalty > 0) {
				update[`flags.stonetop-pwd.customFollowers.${ring.id}.loyalty`] = ring.loyalty - 1;
				costLine = `<p>You spend <strong>1 Loyalty</strong> from ${escHtml(ring.name)} (now ${ring.loyalty - 1}).</p>`;
			} else if (cost?.kind === "loyalty") {
				costLine = `<p>${escHtml(ring.name)} holds no Loyalty, so you <strong>mark a consequence</strong> to call them up.</p>`;
			} else {
				costLine = `<p>You <strong>mark a consequence</strong> to call them up.</p>`;
			}
			await this.actor.update(update, { stonetopMove: "Call Up the Deep Ones" });

			const diceStr = Array.isArray(cost?.dice) && cost.dice.length
				? ` <span class="stonetop-callup-dice">(5d4: ${cost.dice.join(", ")})</span>` : "";
			const tagLine = [...input.tags, ...(input.exceptional ? ["exceptional"] : [])].join(", ");
			const body =
				`<p>From heavy fog and deep water you call up <strong>${escHtml(input.name)}</strong>${diceStr}: <em>${escHtml(tagLine)}</em>.</p>`
				+ `<p>HP ${input.hp}${input.isGroup ? ` each &middot; ${input.size} strong` : ""}, Armor ${input.armor}, damage ${escHtml(input.damage)}.</p>`
				+ (input.moves ? `<p><strong>Moves:</strong> ${escHtml(input.moves.replace(/\n/g, "; "))}</p>` : "")
				+ costLine;
			await this._postMoveCard("Call Up the Deep Ones", body);
			this.render(false);
		}

		// Send Them Back (roll +CHA): 10+ they go now; 7-9 they go but do some harm; 6-
		// they resist — spend their (shared) Loyalty / mark a consequence, or they break free.
		async _onSendServantsBack(slug, name) {
			if (!this.isEditable || !slug) return;
			const who = name
				|| this.actor.getFlag(STONETOP_SCOPE, `customFollowers.${slug}.name`)
				|| "the servants of Daagon";
			const roll = await rollStat("cha", this.actor, {
				moveName:        "Send Them Back",
				moveDescription: `<p>When you <strong><em>send them back whence they came</em></strong>, roll +CHA.</p>`,
				moveResults: {
					success: { value: "They go, now." },
					partial: { value: "They go, but take their time and likely do some harm on the way out." },
					failure: { value: "Spend their Loyalty or mark a consequence and they'll eventually go, otherwise this batch breaks free of your control." },
				},
			});
			const total = Number(roll?.total) || 0;
			if (total >= 10) return this._confirmServantDeparture(slug, who, "They return to the deep at once.");
			if (total >= 7)  return this._confirmServantDeparture(slug, who, "They go, but take their time and likely do some harm on the way out.");
			return this._onServantsResist(slug, who);
		}

		// Offer to clear a departing batch from the Followers tab.
		_confirmServantDeparture(slug, who, note) {
			Dialog.confirm({
				title:      "Send them back",
				content:    `<p>${note}</p><p>Remove <strong>${escHtml(who)}</strong> from your Followers?</p>`,
				yes:        () => this._removeCustomFollower(slug),
				no:         () => {},
				defaultYes: true,
				render:     bringDialogToFront,
				options:    { classes: ["dialog", "stonetop"] },
			});
		}

		_removeCustomFollower(slug) {
			const [key, val] = deletionEntry(`flags.${STONETOP_SCOPE}.customFollowers.${slug}`);
			return this.actor.update({ [key]: val }).then(() => this.render(false));
		}

		/**
		 * Post a RECEIPT to chat, spoken by this actor: one thing that already happened, as a
		 * hand-built `<p>` ("Readiness lost", "Follower Down", "Send Them Back"). Returns the
		 * create promise.
		 *
		 * No ticks and no tier ladder, because a receipt has neither a choice left to make nor
		 * rungs to lay out. A move's PRINTED TEXT goes through `_postPrintedMove` instead — the
		 * two were one method wearing three flags that only ever moved together, which read as
		 * three independent features and left seventeen callers carrying options they never used.
		 */
		_postMoveCard(title, body, { stockSpend = false } = {}) {
			return ChatMessage.create({
				content: moveChatCard(title, body, { actions: stockSpend ? this._stockSpendButtonHtml(body) : "" }),
				speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			});
		}

		/**
		 * A move's SOURCE text and stored outcomes, by the name its row shows.
		 *
		 * An owned move answers from its own document. A playbook move you have not taken owns
		 * no document at all — its row is drawn from the render's movelist — so that list is
		 * where the question is really asked, and it holds both kinds.
		 *
		 * Returns null for a name in neither, which is the caller's cue to fall back.
		 */
		_printedMoveSource(name, item = null) {
			if (item?.system?.description) {
				return { description: item.system.description, moveResults: item.system?.moveResults ?? null };
			}
			for (const m of _movelistMoves(this._renderedMovelist)) {
				if (m?.name === name && typeof m.description === "string") {
					return { description: m.description, moveResults: m.moveResults ?? null };
				}
			}
			return null;
		}

		/**
		 * Post a move document's PRINTED TEXT, composed the one way it is composed everywhere:
		 * its options made tickable, then its outcomes re-laid as the tier ladder. `moveCardBody`
		 * (utils/move-tiers.js) does both, in the order they have to happen in.
		 *
		 * Takes the DOCUMENT rather than a handful of loose fields, so the next thing a printed
		 * card needs from it is read here instead of destructured at the call site.
		 *
		 * The Stock button reads the ORIGINAL description, not the composed body: it is looking
		 * for the move's cost, and should not have to care how the outcomes were laid out around
		 * it.
		 */
		_postPrintedMove(doc) {
			const description = doc?.system?.description ?? "";
			return ChatMessage.create({
				content: moveChatCard(doc?.name ?? "", moveCardBody(description, doc?.system?.moveResults ?? null),
					{ actions: this._stockSpendButtonHtml(description) }),
				speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			});
		}

		/**
		 * The "Spend 1 Stock" button a Stock-costing move's card carries, or "" for every move
		 * that costs nothing.
		 *
		 * WHY THE CARD and not the sheet: Stock is the one cost with no home on the move itself.
		 * Nerve, Command, Resolve, Blessing, Precaution, Protection, Presence, Rapport and Favor
		 * each have a track of their own, so the pips sit right there on the move and the player
		 * ticks them. Stock lives on the sacred POUCH, several tabs away, so a Blessed making
		 * Call the Spirits had the move in front of them and the purse nowhere in sight. The
		 * card is the record that the move was made, which makes it the honest place to pay.
		 *
		 * The two moves that spend AND roll on one trigger (Danu's Grasp, Suck the Poison Out)
		 * never reach here: their name-click opens the guided dialog and returns, so there is no
		 * card to double-charge.
		 */
		_stockSpendButtonHtml(description) {
			const cost = stockCostFromDescription(description);
			if (!cost) return "";
			return `<div class="card-buttons stonetop-roll-actions">
				<button type="button" class="stonetop-spend-stock" data-action="spendStock" data-amount="${cost.amount}">
					<i class="fas fa-mortar-pestle"></i> Spend ${cost.amount} ${_esc(cost.label)}
				</button>
			</div>`;
		}

		/**
		 * Identify a face-down arcanum by Knowing Things about it (Book I, Discoveries p.440):
		 * "prompt them to Know Things about the arcanum: on a 10+, give them the card and have
		 * them read both sides; on a 7-9, have them read the front, and show them the back when
		 * they have some time to study it or learn more; on a 6-, either have them read the
		 * front and then have something bad happen, or hint at the arcanum's power and tell them
		 * how they could learn more."
		 *
		 * The two hit tiers write themselves — the book is emphatic that you should be generous
		 * with arcana info — while the miss deliberately writes nothing: both of its branches are
		 * GM calls, and the GM's own "Give the card" button covers the first of them. The roll
		 * goes through onDirectStatRoll rather than rollStat so the character's forward, ongoing,
		 * debility downgrade and global advantage toggle all apply, and so a miss marks XP.
		 */
		async _onArcanumKnowThings(slug, { shiftKey = false } = {}) {
			if (!this.isEditable || !slug) return;
			return this._underIdentifyLatch(`arcanum:${slug}`,
				() => this._knowThingsAboutArcanum(slug, { shiftKey }));
		}

		/**
		 * Run a one-shot identify action under an in-flight latch, keyed by the thing being
		 * identified.
		 *
		 * Every identify path's first await is a DIALOG, and nothing before it does more than stop
		 * the event — so without this, two quick clicks on an identify button opened two stat
		 * pickers, posted two roll cards and wrote the same flags twice, in whichever order the two
		 * rolls happened to land. Keyed rather than global because identifying a DIFFERENT thing
		 * meanwhile is a real second action; the key carries its kind so an arcanum slug and an item
		 * id can never be taken for each other.
		 */
		async _underIdentifyLatch(key, fn) {
			this._identifyLatch ??= new Set();
			if (this._identifyLatch.has(key)) return;
			this._identifyLatch.add(key);
			try {
				return await fn();
			} finally {
				this._identifyLatch.delete(key);
			}
		}

		/**
		 * Roll Know Things about a particular thing, and hand back what the dice said.
		 *
		 * Both identify paths make the SAME roll — an arcanum's card (p.440) and an artifact's item
		 * (p.430): the same stat/advantage picker over the character's Know Things moves, the same
		 * Never at a Loss / Logbook plumbing, and onDirectStatRoll rather than rollStat so forward,
		 * ongoing, the debility downgrade and the global advantage toggle all apply and a miss marks
		 * XP. They differ only in what the tiers SAY and what they settle, so that is all a caller
		 * passes, and the settling stays with the caller.
		 *
		 * `subject` is stamped on the message and is what makes the tier RE-APPLIABLE: the outcome
		 * commits at roll time, but the Logbook ("treat the result as a 10+") and a GM Shift both
		 * rewrite the card's tier afterwards, and without it there is nothing left to tell them which
		 * thing the new tier is about. See _resyncIdentification in stonetop.js.
		 *
		 * Resolves `{ roll }`, or null when the player backed out of one of the prompts — which is
		 * NOT the same as a roll that came back empty, and the callers settle only the latter.
		 */
		async _rollKnowThingsAbout({ subject, results, shiftKey }) {
			// The character's own Know Things move carries the text the "?" toggle shows. Every
			// character owns it (ensureStartingMoves grants all basic moves), but fall back to
			// the trigger sentence rather than an empty card if a sheet somehow lacks it.
			const moves = this.actor.items.filter(i => i.type === "move");
			const owned = moves.find(i => i.name === "Know Things");

			// A character with a move that bends this roll (Well-Read's +WIS, Polyglot's and
			// Naturalist's advantage) gets asked which apply, since every one of those triggers
			// is fiction the system can't see. Everyone else rolls straight through, so the
			// ordinary case stays a single click.
			const choices = knowThingsRollChoices(moves.map(i => i.name));
			const picked  = choices.hasChoice
				? await this._promptIdentifyRoll(choices, moves)
				: { stat: KNOW_THINGS_STAT, advantage: false };
			if (!picked) return null;               // player closed the picker

			const prompted = await this._promptRollOptions({ shiftKey, title: "Know Things" });
			if (!prompted) return null;             // player cancelled the roll prompt

			const roll = await this._stonetopCharacter.onDirectStatRoll(picked.stat, {
				situational: prompted.situational,
				// The move's own advantage (Polyglot, Naturalist) stacks on top of whatever the
				// roll was already going to be, which is what withAdvantage is for: it lifts
				// Disadvantage to Normal and Normal to Advantage rather than overwriting either.
				// What it lifts is the prompt's answer when the prompt asked for a mode, and the
				// sheet's sticky selector when it did not — this roll passes an explicit mode, so
				// the fallback onDirectStatRoll would have applied has to be spelled out here.
				rollMode: withAdvantage(prompted.rollMode ?? this._stonetopCharacter.rollMode, picked.advantage),
				// This roll bypasses StonetopItem.roll, so it has to stamp the move identity and
				// pick up Never at a Loss / the Logbook itself — otherwise the card's post-roll
				// buttons would work from the Moves tab but not from here.
				messageFlags: { [STONETOP_SCOPE]: { move: "Know Things", ...subject } },
				...(knowThingsRollOptions(this.actor) ?? {}),
				moveName:        "Know Things",
				moveDescription: owned?.system?.description
					?? `<p>When you <strong><em>consult your accumulated knowledge</em></strong>, roll +INT.</p>`,
				moveResults: buildMoveTierResults(results),
			});
			return { roll };
		}

		/** The body of the roll above, so the latch is a plain try/finally around one call. */
		async _knowThingsAboutArcanum(slug, { shiftKey }) {
			const outcome = await this._rollKnowThingsAbout({
				subject: { arcanum: slug },
				// Arcana-specific outcomes, not the generic Know Things ones: p.440 spells out
				// what each tier means for a card. English literals, because the flavor string is
				// persisted and re-parsed by the GM's Shift Up/Down (see roll-engine.js).
				results: {
					success: "You read the card, front and back.",
					partial: "You read the front. The GM will show you the back when you've had time to study it or learn more.",
					failure: "The GM makes a move: read the front and something bad happens, or you get only a hint of its power and how you could learn more.",
				},
				shiftKey,
			});
			if (!outcome) return;

			const opts = { stonetopMove: "Know Things" };
			const tier = classifyResult(Number(outcome.roll?.total) || 0).key;
			if (tier === "success")      await this._stonetopCharacter.identifyAndRevealArcanum(slug, opts);
			else if (tier === "partial") await this._stonetopCharacter.identifyFrontOwedArcanum(slug, opts);
			this.render(false);
		}

		/**
		 * Ask which of the character's Know Things moves apply to this arcanum: the stat (a
		 * button per option, +INT first) and any advantage grants (a checkbox, since Polyglot and
		 * Naturalist can both be in play at once). Each contributing move is quoted so the player
		 * can read its fictional trigger before deciding, exactly as the inline stat picker does.
		 *
		 * Resolves `{ stat, advantage }`, or null if the player closes the dialog. Only the first
		 * settle counts, so the close handler can safely cancel after a button already answered.
		 */
		_promptIdentifyRoll(choices, moves) {
			const byName = new Map(moves.map(i => [i.name, i]));
			const stats  = this.actor.system?.stats ?? {};
			const quote  = name => {
				const move = byName.get(name);
				if (!move) return "";
				return `<div class="stonetop-stat-picker-why"><strong>${_esc(name)}</strong>${move.system?.description ?? ""}</div>`;
			};
			const advRow = choices.advantageMoves.length
				? `<label class="stonetop-identify-adv-row">
						<input type="checkbox" class="stonetop-identify-adv">
						<span>${_esc(game.i18n.localize("stonetop.arcana.identifyAdvantage"))}</span>
					</label>`
				: "";
			const content = `<p>${_esc(game.i18n.localize("stonetop.arcana.identifyPrompt"))}</p>`
				+ advRow
				+ [...choices.statGrants, ...choices.advantageMoves].map(quote).join("");

			return new Promise(resolve => {
				const answer = html => {
					const root = html?.[0] ?? html;
					return !!root?.querySelector?.(".stonetop-identify-adv")?.checked;
				};
				const buttons = {};
				for (const key of choices.stats) {
					buttons[key] = {
						label: `${Handlebars.helpers.statLabel(key)} (${sign(stats[key]?.value ?? 0)})`,
						callback: html => resolve({ stat: key, advantage: answer(html) }),
					};
				}
				buttons.cancel = { label: "Cancel", callback: () => resolve(null) };
				new Dialog({
					title:   `${game.i18n.localize("stonetop.arcana.identify")}: ${this.actor.name}`,
					content,
					buttons,
					default: choices.stats[0],
					close:   () => resolve(null),
					render:  bringDialogToFront,
				}, { width: 480, classes: ["dialog", "stonetop", "stonetop-stat-picker-dialog"] }).render(true);
			});
		}

		/**
		 * The GM's no-roll hand-over (p.440: "just give the player(s) the card and have them read
		 * it, front and back"). Front-only is the same bullet's lesser form, and the reachable
		 * shape of a 6-'s "have them read the front and then have something bad happen".
		 */
		_onArcanumGiveCard(slug) {
			if (!game.user.isGM || !slug) return;
			const give = async both => {
				const opts = { stonetopMove: "Give the card" };
				if (both) await this._stonetopCharacter.identifyAndRevealArcanum(slug, opts);
				else      await this._stonetopCharacter.identifyArcanum(slug, opts);
				this.render(false);
			};
			new Dialog({
				title:   game.i18n.localize("stonetop.arcana.giveCardTitle"),
				content: `<p>${game.i18n.localize("stonetop.arcana.giveCardPrompt")}</p>`,
				buttons: {
					both:   { label: game.i18n.localize("stonetop.arcana.giveCardBoth"),  callback: () => give(true) },
					front:  { label: game.i18n.localize("stonetop.arcana.giveCardFront"), callback: () => give(false) },
					cancel: { label: "Cancel" },
				},
				default: "both",
				render:  bringDialogToFront,
			}, { width: 420, classes: ["dialog", "stonetop"] }).render(true);
		}

		/**
		 * Settle a 7-9's outstanding back. The GM's copy of the button reveals the back outright;
		 * the owner's copy posts the request to chat, since the reveal is the GM's to make and
		 * this system has no player-to-GM socket.
		 */
		async _onArcanumStudyBack(slug) {
			if (!this.isEditable || !slug) return;
			// The GM path neither reads the arcanum nor posts a card, so it must not pay for the
			// document fetch below — every GM click would load a document only to discard it.
			if (game.user.isGM) {
				await this._stonetopCharacter.revealArcanum(slug, { stonetopMove: "Study it" });
				this.render(false);
				return;
			}
			const item = await this._stonetopCharacter.getArcanum(slug);
			const name = item?.front?.title ?? slug;
			await this._postMoveCard(game.i18n.localize("stonetop.arcana.backOwedTitle"),
				`<p><strong>${escHtml(this.actor.name)}</strong> takes the time to study <strong>${escHtml(name)}</strong>, and is owed its reverse.</p>`);
		}

		// ── Identifying artifacts (Book I, Discoveries pp.430-431) ─────────────────
		// The arcana ladder above is p.440's; this is its sibling for ordinary treasure. The
		// two are deliberately separate: an arcanum is a pack card with a front and a back and
		// per-character flags, an artifact is an inventory Item whose own fields carry the
		// state, and neither's controls should ever appear on the other.

		/**
		 * The player's magnifier: pick a move, roll it, settle what it tells them.
		 *
		 * p.430 names two moves, and they do different jobs. Know Things settles the ladder —
		 * "on a 7+, tell them some combo of what it is, what it does, what it's worth" — so its
		 * tier writes the item. Seek Insight buys questions and answers, which are the GM's to
		 * give at the table, so it rolls, posts the question list scoped to this artifact, and
		 * deliberately writes nothing: the GM settles it with their own control if the answers
		 * amounted to figuring the thing out.
		 */
		async _onArtifactIdentify(ownedId, { shiftKey = false } = {}) {
			if (!this.isEditable || !ownedId) return;
			return this._underIdentifyLatch(`artifact:${ownedId}`, async () => {
				const knowledge = this._stonetopCharacter.artifactKnowledge(ownedId);
				if (!knowledge) return;
				const move = await this._promptArtifactMove(knowledge);
				if (!move) return;
				if (move === "know")  await this._knowThingsAboutArtifact(knowledge, { shiftKey });
				if (move === "seek")  await this._seekInsightAboutArtifact(knowledge, { shiftKey });
			});
		}

		/**
		 * Which move the player is making about this artifact. Each is quoted from the book's own
		 * paragraph so the choice is made on what the move will actually do, not on its name.
		 * Resolves "know" | "seek", or null if the dialog is closed.
		 */
		_promptArtifactMove(knowledge) {
			const owed = knowledge.state === ARTIFACT_STATE.PARTIAL;
			const content =
				`<p>${_esc(game.i18n.format("stonetop.artifact.promptIntro", { name: knowledge.name }))}</p>`
				+ (owed ? `<p class="stonetop-artifact-owed">${_esc(game.i18n.localize("stonetop.artifact.promptOwed"))}</p>` : "")
				+ `<div class="stonetop-stat-picker-why"><strong>${_esc(game.i18n.localize("stonetop.artifact.knowThings"))}</strong>`
				+ `<p>${_esc(game.i18n.localize("stonetop.artifact.knowThingsWhy"))}</p></div>`
				+ `<div class="stonetop-stat-picker-why"><strong>${_esc(game.i18n.localize("stonetop.artifact.seekInsight"))}</strong>`
				+ `<p>${_esc(game.i18n.localize("stonetop.artifact.seekInsightWhy"))}</p></div>`;
			return new Promise(resolve => {
				new Dialog({
					title:   `${game.i18n.localize("stonetop.artifact.identify")}: ${knowledge.name}`,
					content,
					buttons: {
						know:   { label: game.i18n.localize("stonetop.artifact.knowThings"),  callback: () => resolve("know") },
						seek:   { label: game.i18n.localize("stonetop.artifact.seekInsight"), callback: () => resolve("seek") },
						cancel: { label: "Cancel", callback: () => resolve(null) },
					},
					default: "know",
					close:   () => resolve(null),
					render:  bringDialogToFront,
				}, { width: 520, classes: ["dialog", "stonetop", "stonetop-stat-picker-dialog"] }).render(true);
			});
		}

		/**
		 * Know Things about an artifact (p.430). The roll is the arcanum identify's twin — same
		 * stat/advantage picker, same Never at a Loss / Logbook plumbing, same onDirectStatRoll so
		 * forward, ongoing, debilities and the global advantage toggle all apply — and differs
		 * only in what the tiers say and what they settle.
		 */
		async _knowThingsAboutArtifact(knowledge, { shiftKey }) {
			const outcome = await this._rollKnowThingsAbout({
				subject: { artifact: knowledge.id },
				results: knowThingsArtifactResults(),
				shiftKey,
			});
			if (!outcome) return;

			const tier  = classifyResult(Number(outcome.roll?.total) || 0).key;
			const state = artifactStateForTier(tier);
			if (state) {
				await this._stonetopCharacter.setArtifactState(knowledge.id, state, { upgradeOnly: true });
			}
			// A miss leaves the item alone — both of p.430's answers there are the GM's to make —
			// but it must not leave the table with nothing, so the lead the GM already wrote (or a
			// reminder that they owe one) goes to chat where the roll card can be read beside it.
			else await this._postArtifactLeadCard(knowledge);
			this.render(false);
		}

		/**
		 * Seek Insight about an artifact (p.430: "resolve the move! On a 7+, answer their
		 * question(s) honestly and helpfully"). Rolls +WIS and posts the question list alongside,
		 * scoped to this thing. It never writes the ladder: the answers are the GM's, and how much
		 * of the artifact they gave away is the GM's call to record with their own control.
		 */
		async _seekInsightAboutArtifact(knowledge, { shiftKey }) {
			const owned = this.actor.items.find(i => i.type === "move" && i.name === "Seek Insight");
			const prompted = await this._promptRollOptions({ shiftKey, title: "Seek Insight" });
			if (!prompted) return;
			const roll = await this._stonetopCharacter.onDirectStatRoll("wis", {
				...prompted,
				messageFlags: { [STONETOP_SCOPE]: { move: "Seek Insight", artifact: knowledge.id } },
				moveName:        "Seek Insight",
				moveDescription: owned?.system?.description
					?? `<p>When you <strong><em>study a situation or person, looking to the GM for insight</em></strong>, roll +WIS.</p>`,
				moveResults: buildMoveTierResults(seekInsightArtifactResults()),
			});
			if (classifyResult(Number(roll?.total) || 0).key === "failure") return;
			await this._postMoveCard(
				game.i18n.format("stonetop.artifact.insightTitle", { name: knowledge.name }),
				`<ul>${ARTIFACT_INSIGHT_QUESTIONS.map(q => `<li>${escHtml(q)}</li>`).join("")}</ul>`);
		}

		/** What a 6- leaves behind: the GM's written lead, or a nudge that p.431 wants one. */
		async _postArtifactLeadCard(knowledge) {
			const body = knowledge.lead
				? `<p>${escHtml(knowledge.lead)}</p>`
				: `<p><em>${escHtml(game.i18n.localize("stonetop.artifact.leadMissing"))}</em></p>`
					+ `<ul>${ARTIFACT_LEAD_SUGGESTIONS.map(s => `<li>${escHtml(s)}</li>`).join("")}</ul>`;
			await this._postMoveCard(
				game.i18n.format("stonetop.artifact.leadTitle", { name: knowledge.name }), body);
		}

		/**
		 * The GM's control. Two jobs in one window, because they're the same decision seen from
		 * either end: how much of this artifact the player may read, and what there is to read.
		 *
		 * The state select is p.430's ladder run by hand — "Once a PC figures an artifact out,
		 * give the player its tags, write-up, and any custom moves" is a thing the GM does at the
		 * table as often as a roll settles it, and hiding a thing in the first place has no roll
		 * at all. The three text fields are the artifact's own copy of p.430-431: the hint that
		 * stands in for its tags, the write-up a 10+ hands over, and the lead a miss leaves.
		 *
		 * The rungs are a SELECT rather than one button each: four states plus a cancel is five
		 * buttons crammed into one dialog row, and the choice reads better as "how much may they
		 * read?" answered once than as five verbs to pick between.
		 *
		 * The body is a TEMPLATE (templates/dialogs/artifact-gm.hbs), like every other GM editor in
		 * the system. It was thirty-odd lines of HTML built here with a local string helper, which
		 * is how the one value that isn't escaped came to be un-escaped by accident rather than on
		 * purpose: in a template escaping is the default, and the single raw field says why.
		 */
		async _onArtifactGmControl(ownedId) {
			if (!game.user.isGM || !ownedId) return;
			const knowledge = this._stonetopCharacter.artifactKnowledge(ownedId);
			if (!knowledge) return;
			const loc = key => game.i18n.localize(`stonetop.artifact.${key}`);
			const content = await renderTemplate(ARTIFACT_GM_TEMPLATE, {
				note:   knowledge.note,
				states: ARTIFACT_GM_STATES.map(state => ({
					value:    state,
					labelKey: `stonetop.artifact.state.${state || "none"}`,
					selected: state === knowledge.state,
				})),
				// The write-up opens in a live editor, so it is handed BOTH forms: the raw HTML
				// the element edits, and the enriched copy it paints until the custom element
				// upgrades. Every other field is a one-line string and needs neither.
				fields: await Promise.all(ARTIFACT_GM_FIELDS.map(async field => ({
					...field,
					value:    knowledge[field.key],
					enriched: field.rich ? await enrichHTML(knowledge[field.key] ?? "") : "",
				}))),
			});

			// Every declared DialogV1 button closes the window, so the fields have to be
			// harvested by the Save button rather than written as they're edited. Read off the
			// same table the template was built from, so a fourth field is one entry, not three.
			//
			// The write-up needs no special case here even though it is a <prose-mirror> rather
			// than a textarea: the element is form-associated and answers `.value` with the
			// SERIALIZED LIVE DOCUMENT while its editor is active (elements/prosemirror-editor.mjs
			// _getValue), and DialogV1 runs a button callback while the content is still in the
			// DOM. So the same one-line read gets what the GM has typed, unsaved keystrokes and
			// all, with no dependency on the editor firing its own change first.
			const save = async html => {
				const root = html?.[0] ?? html;
				const read = name => root?.querySelector?.(`[name="${name}"]`)?.value ?? "";
				await this._stonetopCharacter.updateArtifactKnowledge(ownedId, {
					state: read("state"),
					...Object.fromEntries(ARTIFACT_GM_FIELDS.map(f => [f.key, read(f.key)])),
				});
				this.render(false);
			};
			new Dialog({
				title:   `${loc("gmTitle")}: ${knowledge.name}`,
				content,
				buttons: {
					save:   { label: loc("saveOnly"), callback: save },
					cancel: { label: "Cancel" },
				},
				default: "save",
				render:  bringDialogToFront,
			}, { width: 560, height: 620, classes: ["dialog", "stonetop", "stonetop-artifact-dialog"], resizable: true }).render(true);
		}

		/**
		 * Use an Invocation (the tap on its title). Every Lightbearer starts with Invoke the Sun
		 * God, so using one is a MOVE — imbue your holy light with Helior's power, roll +WIS,
		 * take a consequence — and not just a card. The window asks the two questions the rules
		 * put before the roll, together:
		 *
		 *  • roll +WIS or not (some tables narrate an Invocation without a roll, and the "just
		 *    show it" path is also how anyone reads the text out to the table)
		 *  • empower it or not, for a Lightbearer who has Empowered Invocations
		 *
		 * The empowered effect is left OFF the card unless it was bought: it isn't part of what
		 * the Invocation does, it's what it does IF you pay an extra consequence for it, and
		 * printed alongside the normal effect it just muddies what actually happened.
		 *
		 * It is also where the ongoing Invocation is picked up and put down. That happens on the
		 * AFFIRMATIVE button only — "Invoke the Sun God" / "Use it" is the player saying they use
		 * this, where "Just show it" is reading the text out to the table, and reading an
		 * Invocation aloud must not silently drop the one they are holding.
		 *
		 * When there is nothing to ask, the window is skipped and the use is simply taken as read.
		 * The bookkeeping is NOT skipped with it: owning Invoke the Sun God is what earns the roll,
		 * not what makes an Invocation take hold, so a character who has Invocations without that
		 * move (a cross-playbook pick through Versatile, a Lightbearer whose starting move was
		 * dropped) has to be tracked like any other — otherwise the header chip, the banner and the
		 * "you can't use another while one is ongoing" rule are dead for them forever.
		 */
		async _postInvocationCard(name, description, { shiftKey = false, known = true, slug = "", ongoing = false } = {}) {
			const { base, empowered } = splitEmpoweredEffect(description);
			// `known` first: an Invocation this character hasn't learned can be read but not
			// invoked, so neither question is worth asking about one. rollMoveById also bails
			// silently when the sheet isn't editable, so an observer must never be offered a
			// roll button that would do nothing.
			const canInvoke  = known && this.isEditable && ownsMoveNamed(this.actor, INVOKE_THE_SUN_GOD);
			const canEmpower = known && !!empowered && ownsMoveNamed(this.actor, EMPOWERED_INVOCATIONS);
			// Whether this tap is a USE at all, which is the narrower question the two gates above
			// answer for the roll and the empower checkbox. An un-learned Invocation is being read
			// out; a sheet nobody can write is being looked at; anything else is being used.
			const canUse = known && this.isEditable;

			const used = { slug, ongoing };
			// Nothing to decide — no window, and the affirmative is assumed, because a tap with no
			// question attached to it is still the player saying they use this.
			let answer = { roll: false, used: canUse, empower: false };
			if (canInvoke || canEmpower) {
				answer = await this._promptInvokeInvocation({
					name, empoweredHtml: empowered, canInvoke, canEmpower,
					lit:    this._stonetopCharacter.holyLight,
					notice: invokeNotice({ current: this._stonetopCharacter.ongoingInvocation, used, options: this._invocationOptions }),
				});
				if (answer === null) return null;   // dismissed — the Invocation isn't used at all
			}

			// What using it does to the Invocation already running. Worked out BEFORE the card is
			// built, because the one it displaces is named on that card: the ending belongs in the
			// same post as the thing that caused it, not in a second card the table has to pair up
			// with the first.
			const use = answer.used
				? resolveInvocationUse({ current: this._stonetopCharacter.ongoingInvocation, used })
				: null;
			const lead = use?.ended
				? `<p class="stonetop-chat-invocation-ended"><em>${escHtml(this._invocationLabel(use.ended))} ends.</em></p>`
				: "";

			// Card first, roll second: the card is the statement and the roll is how it goes.
			// It also means a cancelled roll prompt (which fires INSIDE rollMoveById) leaves
			// the Invocation posted rather than losing everything.
			const card = answer.empower
				? await this._postMoveCard(`${name} (Empowered)`, lead + base + EMPOWERED_NOTE_HTML + empowered)
				: await this._postMoveCard(name, lead + base);
			// Written before the roll, deliberately. A 6- is the GM's to narrate — it may or may not
			// mean the Invocation failed to take hold — so the sheet records what the player did and
			// leaves "it didn't work" to one click on End it, rather than guessing from a die.
			if (use?.changed) await this._stonetopCharacter.setOngoingInvocation(use.next);
			if (answer.roll) await this.rollMoveByName(INVOKE_THE_SUN_GOD, { shiftKey });
			// The banner, the header chip and the card's badge are all read at render time, so the
			// flag write above shows up only once the sheet repaints. Left until AFTER the roll —
			// re-rendering mid-roll would pull the roll prompt out from under it — and guarded
			// on the sheet still being open, since the roll is an await and it may have been closed.
			if (use?.changed && this.rendered) this.render(false);
			return card;
		}

		/**
		 * The Invocation window. Resolves {roll, empower}, or null if it was dismissed — the
		 * choices are made BEFORE the roll, so backing out means the Invocation was never used
		 * and nothing is posted.
		 *
		 * TWO FIXED BUTTONS, always the same two. Empowering is a modifier of invoking, not a
		 * third alternative, so it rides a checkbox: this window now opens on every single
		 * Invocation use, and a button set that grows at 6th level would break the muscle memory
		 * of every use before it. It also folds what would otherwise be two sequential dialogs
		 * into one.
		 */
		_promptInvokeInvocation({ name, empoweredHtml, canInvoke, canEmpower, lit, notice = null }) {
			return new Promise(resolve => {
				let answer = null;
				const read = (html, roll, used) => ({
					roll,
					used,
					empower: !!html.find('[name="empower"]')[0]?.checked,
				});
				let content = "";
				if (canInvoke) {
					content += `<p><em>Invoke the Sun God:</em> imbue your holy light with Helior's power `
						+ `and roll +WIS. On a 10+ it works, and you choose 1 consequence; on a 7-9 it works, `
						+ `and you and the GM each choose 1.</p>`;
					// Not a block: whether a light is at hand is the table's call, and the sheet's
					// candle is only ever as current as someone kept it. Say it and move on.
					if (!lit) content += `<p class="stonetop-invoke-nolight">`
						+ `<i class="fas fa-triangle-exclamation" aria-hidden="true"></i> `
						+ `No holy light is lit on this sheet: consecrate a flame, or check with your GM.</p>`;
				}
				// What this does to the Invocation already running — OUTSIDE the canInvoke block,
				// because the affirmative button takes hold of the Invocation either way and the
				// window must never change that state without having said so. Also not a block:
				// ending one Invocation to use another is a legal, ordinary thing to do, it just
				// has to be a decision rather than a discovery.
				{
					const key  = notice && INVOCATION_NOTICE_KEYS[notice.kind];
					const line = key ? game.i18n.format(key, { name: escHtml(notice.ending) }) : "";
					if (line) content += `<p class="stonetop-invoke-ongoing${notice.kind === "start" ? "" : " is-ending"}">`
						+ `<i class="fas fa-sun" aria-hidden="true"></i> ${line}</p>`;
				}
				if (canEmpower) {
					content += `<label class="stonetop-invoke-empower"><input type="checkbox" name="empower"> `
						+ `<span>Empower it: choose an extra consequence before you roll.</span></label>`
						+ `<div class="stonetop-empower-effect">${empoweredHtml}</div>`
						+ `<p class="stonetop-empower-cost">The extra consequence is the price of asking, not a `
						+ `penalty for failing: you take it however the roll turns out, even on a 10+.</p>`;
				}
				new Dialog({
					title:   canInvoke ? `${name}: Invoke the Sun God?` : `${name}: Empower it?`,
					content,
					buttons: {
						// The affirmative key is declared first and is in the shared left-side list,
						// so it sits opposite "Just show it".
						roll: {
							icon:     '<i class="fas fa-sun"></i>',
							label:    canInvoke ? "Invoke the Sun God (+WIS)" : "Use it",
							callback: html => { answer = read(html, canInvoke, true); },
						},
						no: {
							icon:     '<i class="fas fa-comment"></i>',
							label:    "Just show it",
							// `used: false` is the load-bearing half of this button. Showing an
							// Invocation's text is not using it, so it must not take hold of a new one
							// or let go of the one already running.
							callback: html => { answer = read(html, false, false); },
						},
					},
					default: "roll",
					render:  bringDialogToFront,
					// Runs on every path out, button or ✕, so it is the one place that answers.
					// A promise resolved only from the button callbacks would hang on a dismiss.
					close:   () => resolve(answer),
				}, { width: 460, classes: this._pastDeathWindowClasses(["dialog", "stonetop", "stonetop-empower-dialog", "stonetop-invoke-dialog"]) }).render(true);
			});
		}

		// The 6- branch: pay to make them leave (spend the Ring's shared Loyalty, or mark a
		// consequence) or let them break free of your control.
		_onServantsResist(slug, who) {
			const ring       = this._ringFollowerEntry();
			const canLoyalty = ring.hasRing && ring.loyalty > 0;
			const buttons    = {};
			if (canLoyalty) buttons.loyalty = {
				icon:     '<i class="fas fa-hand-holding-heart"></i>',
				label:    `Spend 1 Loyalty (${ring.loyalty})`,
				callback: () => this._payServantExit(slug, who, "loyalty"),
			};
			buttons.consequence = {
				icon:     '<i class="fas fa-triangle-exclamation"></i>',
				label:    "Mark a consequence",
				callback: () => this._payServantExit(slug, who, "consequence"),
			};
			buttons.free = {
				icon:     '<i class="fas fa-skull-crossbones"></i>',
				label:    "Let them break free",
				callback: () => this._servantsBreakLoose(slug, who),
			};
			new Dialog({
				title:   "They won't go quietly",
				content: `<p><strong>${escHtml(who)}</strong> resist. Spend their Loyalty or mark a consequence and they'll eventually go &mdash; otherwise they break free of your control.</p>`,
				buttons,
				default: canLoyalty ? "loyalty" : "consequence",
				render:  bringDialogToFront,
			}, { classes: ["dialog", "stonetop"] }).render(true);
		}

		async _payServantExit(slug, who, kind) {
			const ring = this._ringFollowerEntry();
			let line;
			if (kind === "loyalty" && ring.id && ring.loyalty > 0) {
				await this.actor.setFlag(STONETOP_SCOPE, `customFollowers.${ring.id}.loyalty`, ring.loyalty - 1);
				line = `<p>You spend <strong>1 Loyalty</strong> from ${escHtml(ring.name)} (now ${ring.loyalty - 1}). <strong>${escHtml(who)}</strong> will eventually go.</p>`;
			} else {
				line = `<p>You <strong>mark a consequence</strong>. <strong>${escHtml(who)}</strong> will eventually go.</p>`;
			}
			await this._postMoveCard("Send Them Back", line);
			this._confirmServantDeparture(slug, who, "They'll eventually go.");
		}

		async _servantsBreakLoose(slug, who) {
			// No longer yours to command. Flag the batch (the card shows a "broke free" badge)
			// and note it; it stays on the tab until removed.
			await this.actor.setFlag(STONETOP_SCOPE, `customFollowers.${slug}.brokenFree`, true);
			await this._postMoveCard("Send Them Back",
				`<p><strong>${escHtml(who)}</strong> break free of your control. They are no longer yours to command.</p>`);
			this.render(false);
		}

		// Materialize a playbook possession-follower (the Would-be Hero's dog, the
		// Ranger's Hounds, the Blessed's Mastiffs) as an editable follower card. Mirrors
		// the arcana "Add as follower" flow: build from the catalog and dedupe by
		// sourceUuid so it can't be added twice. Groups (Hounds/Mastiffs) land as a group.
		async _onAddPossessionFollower(slug) {
			if (!this.isEditable || !slug) return;
			const { possessionFollower } = await import("../../data/possession-followers.js");
			const input = possessionFollower(slug);
			if (!input) return;
			const existing = this.actor.getFlag(STONETOP_SCOPE, "customFollowers") ?? {};
			if (Object.values(existing).some(f => f?.sourceUuid === input.sourceUuid)) return;
			const id = foundry.utils.randomID(16);
			await this.actor.update({
				[`flags.stonetop-pwd.customFollowers.${id}`]: { ...buildCustomFollower(input), order: this._nextFollowerOrder() },
			});
			this.render(false);
		}

		// Open a blank homebrew arcanum (minor or major) in the editor as a draft. It's added
		// to this character only when the author clicks Save & Done (see _createAndAddArcanum).
		async _onArcanaCreate(major = false) {
			if (!this.isEditable || !canCreateArcana()) return;
			await this._createAndAddArcanum({ name: major ? "New Arcanum" : "New Minor Arcanum", major });
		}

		// Create a homebrew arcanum world Item (optionally pre-filled) and open its editor as a
		// DRAFT — it is NOT added to this character until the author clicks Save & Done in the
		// editor, at which point `attach` runs: adds it by slug, marks it identified (the author
		// made it — no mystery to solve), and re-renders so the arcana tab shows the finished
		// card (resolved via the world-item path of FoundryArcanaRepository). Closing the editor
		// without saving offers to discard the draft. Returns the created Item.
		async _createAndAddArcanum({ name, major = false, front } = {}) {
			const attach = async (item) => {
				const slug = item?.flags?.[ITEM_FLAG_SCOPE]?.slug;
				if (!slug) return;
				await this._stonetopCharacter.addArcanum(slug);
				await this._stonetopCharacter.identifyArcanum(slug);
				if (this.rendered) this.render(false);
			};
			return createArcanumItem({ name, major, front, onSave: attach });
		}

		/**
		 * Portraits already spoken for, as `{ src -> who wears it }`, for the People gallery's
		 * "already assigned" marking and its unused-only filter.
		 *
		 * Two rosters feed it. The steading's residents and neighbors are the bigger pool by
		 * far and the more useful answer — a follower is usually somebody the village already
		 * knows — and the other follower cards on this very sheet cover the near miss of
		 * handing two of a character's own people the same face.
		 *
		 * Reads the index `_buildFollowersData` stamps as it finalizes the cards, so the answer
		 * comes from the same place the cards themselves do — including `orderName`, whose
		 * fallback chain (name → label → placeholder → type) lives there and is not worth
		 * restating. Not scraped back off the rendered markup: a collapsed section, a renamed
		 * class or a lazily-drawn tab would silently empty the map and the "Unused" filter
		 * would quietly lie.
		 *
		 * `exclude` is the card being edited (`{ftype, slug}`, straight off its dataset): its
		 * own portrait is this follower's, not somebody else's.
		 *
		 * The steading is merged last so a face a named resident wears reads as theirs.
		 */
		_followerPortraitsInUse({ ftype, slug, own } = {}) {
			const used = {};
			for (const p of this._followerPortraits ?? []) {
				if (p.ftype === ftype && p.slug === (slug ?? "")) continue;
				used[p.img] ??= p.name || "another follower";
			}
			// Three scans, nearest first: this character's other followers, then every actor in
			// the world (which reaches player characters and any NPC, both of which can now pick
			// from this gallery on their own sheet), then the steading's roster last so a named
			// resident wins the label over the same person's bare actor entry. A follower
			// recruited from an NPC shares that NPC's portrait on purpose, and the gallery does
			// not read a person's own current face as taken from them.
			const all = { ...used, ...usedActorPortraits(), ...usedPersonPortraits(getStonetopSteadingActor()) };
			// `own` is the same "this one is already mine" the (ftype, slug) skip above expresses,
			// for a caller that cannot express it that way. A ROSTER member has no such pair, and
			// their face is claimed by the world scan (usedActorPortraits reaches it through
			// claimRosterPortraits) — so without this the gallery told a crew member the picture
			// they are wearing belongs to somebody else and dropped it out of "Unused".
			if (own) delete all[own];
			return all;
		}

		/**
		 * Give a follower a face: open the People of Stonetop gallery on their card's portrait
		 * and store the pick. `portrait` is the card's .stonetop-follower-portrait element,
		 * whose data-ftype / data-slug resolve the same per-follower flag namespace the card's
		 * other hand-edited fields write to — so a portrait is saved exactly like a note is,
		 * and every follower type works through this one path.
		 *
		 * "Use default" writes "" rather than deleting the key: an empty string is already the
		 * card's "no portrait" state (see _followerExtras), so clearing needs no `-=` dance and
		 * cannot leave a half-removed flag behind.
		 */
		/**
		 * Choose which square of a follower's portrait the 75px card circle shows.
		 *
		 * Stored beside the portrait as a rect rather than cut to a file, which is what lets a
		 * PLAYER do this on their own follower: cutting a file needs FILES_UPLOAD, and most
		 * worlds do not grant it. See module/utils/portrait-frame.js.
		 */
		/**
		 * Enlarge a follower's portrait, the way tapping any other face in the system does.
		 *
		 * Opens the WHOLE illustration when the stored path is a People-of-Stonetop square, for
		 * the same reason the NPC header and the hover preview do: the square is a small face cut
		 * out of a standing figure, so popping it out would answer "show me this bigger" with a
		 * picture smaller than the one just tapped.
		 *
		 * The window carries the same two controls a sheet's own portrait window does — "Edit
		 * Photo", which opens the People of Stonetop gallery, and "Frame Face" — so a follower's
		 * face can be changed or re-framed while READING the card, without first opening its
		 * pencil. That is the whole reason a tap here enlarges rather than picks: the picker is
		 * one control away, so making the common intent (see it) the default costs nothing.
		 */
		_onFollowerPortraitView(portrait) {
			if (!portrait) return;
			const imgEl = portrait.querySelector(".stonetop-follower-portrait-img");
			const stored = imgEl?.getAttribute("src");
			if (!stored) return;
			// The popup is portaled to <body> and would otherwise hang over the popout.
			removeAvatarPreview();
			const name = imgEl.dataset.name || "Follower";
			const popout = imagePopout({ src: displayPortraitSrc(stored), title: name });
			if (!popout) return;
			popout.render(true);

			this._hangFollowerPortraitControls(popout, portrait, name);
		}

		/**
		 * The two controls a follower's portrait window carries, hung as a unit so a window that
		 * had to re-render — which builds a fresh header and drops what was on the old one — can
		 * have them put back with one call.
		 *
		 * `card` is the .stonetop-follower-portrait element the window was opened from; it is only
		 * read for the (ftype, slug) pair, since the live element is re-looked-up per click.
		 */
		_hangFollowerPortraitControls(popout, card, name) {
			if (!popout || !card) return;
			const { ftype, slug } = card.dataset;
			// The element is re-looked-up per click rather than captured: picking a new face
			// re-renders the sheet under this window, and the one in the closure is by then a
			// detached copy still carrying the OLD portrait — so a second Edit Photo would open
			// the gallery with the previous face marked as the one in use. The captured element
			// remains the fallback for when the sheet itself has been closed behind the window;
			// its ftype/slug are all the picker needs to write.
			const liveCard = () => this._followerPortraitEl(ftype, slug) ?? card;

			// The same "Edit Photo" the sheet headers and the steading roster put on a photo,
			// opening the same gallery, so the control means one thing wherever it is met.
			//
			// A follower's face is a flag on this character rather than a document's own `img`, so
			// there is no updateActor/img change for the window to follow (what
			// bindImagePopoutToActor gives a sheet header's). It is pointed at the new picture from
			// the pick itself, and re-hung when that patch had to fall back to a re-render. A
			// CLEARED portrait leaves nothing to show, so the window closes rather than sit there
			// displaying a face nobody wears any more.
			if (this.isEditable) {
				addPopoutHeaderControl(popout, {
					key: "stonetop-edit-follower-photo",
					icon: "fa-camera",
					label: localize("stonetop.portraitPicker.popout"),
					onClick: () => this._onFollowerPortraitPick(liveCard(), {
						onPicked: (src) => {
							if (!pointImagePopoutAt(popout, displayPortraitSrc(src))) {
								this._hangFollowerPortraitControls(popout, card, name);
							}
						},
						onCleared: () => popout.close(),
					}),
				});
			}
			// Tokenizer, for the TOKEN — the same control the sheet headers' window carries, on
			// the same terms as this card's own Tokenizer pip. TWO handles rather than one,
			// because a follower's two portraits are genuinely two things: the face on the card
			// is a flag on this character (what the framer edits), while the token is made for
			// the Actor they were placed on the map as. addTokenizerControl reads only these two
			// fields and gates itself on both. Registered BEFORE the framing control so it lands
			// to its left, matching the order of the pips.
			addTokenizerControl(popout, {
				canWrite: this.isEditable,
				actor: this._followerLinkedActor(ftype, slug),
			});
			// Which square of this portrait the small round surfaces show. The handle answers both
			// "is there anything to frame" and "may this viewer write it", so the control gates
			// itself; a follower type with no flag namespace yields none and gets nothing.
			const base = _followerDetailBase(ftype, slug);
			const handle = base ? followerFrameHandle(this.actor, base, { editable: this.isEditable }) : null;
			addPortraitFrameControl(popout, handle, {
				name,
				// A frame write touches neither `img` nor anything the sheet watches, so nothing
				// re-renders on its own.
				onSaved: () => this.render(false),
			});
		}

		/**
		 * The Actor a follower card has already become, if any — what its Tokenizer pip and the
		 * matching control on its portrait window both act on. Reads the card's stored link out
		 * of the flags rather than the DOM, so it is right after a re-render and after a drop
		 * that wrote the link while the sheet was open.
		 */
		_followerLinkedActor(ftype, slug) {
			const base = _followerDetailBase(ftype, slug);
			if (!base) return null;
			const detail = foundry.utils.getProperty(resolvedFlags(this.actor), base) ?? {};
			return followerActorFromLink(detail);
		}

		/**
		 * Open Tokenizer on the Actor this follower already is. Never creates one — the pip is
		 * rendered only where that Actor exists (see withSectionEdits), so a missing one here is
		 * a card whose link went stale (the actor deleted) rather than a case to make it up.
		 */
		_onFollowerTokenize(portrait) {
			if (!this.isEditable || !portrait) return;
			const actor = this._followerLinkedActor(portrait.dataset.ftype, portrait.dataset.slug);
			if (!actor) {
				ui.notifications?.warn?.(localize("stonetop.portraitFrame.noTokenizeTarget"));
				return;
			}
			openTokenizer(actor);
		}

		/**
		 * The live element for a follower card's portrait, by the same (ftype, slug) pair every
		 * other follower handler resolves its flag paths through. Null once the sheet is closed.
		 */
		_followerPortraitEl(ftype, slug) {
			const root = this.element?.[0] ?? this.element;
			if (!root?.querySelector || !ftype) return null;
			const esc = globalThis.CSS?.escape ?? (s => s);
			return root.querySelector(`.stonetop-follower-portrait[data-ftype="${esc(ftype)}"][data-slug="${esc(slug ?? "")}"]`);
		}

		_onFollowerPortraitFrame(portrait) {
			if (!this.isEditable || !portrait) return;
			const base = _followerDetailBase(portrait.dataset.ftype, portrait.dataset.slug);
			if (!base) {
				console.warn("stonetop | no follower flag namespace for", portrait.dataset.ftype, portrait.dataset.slug);
				return;
			}
			// No early return on a null handle: openPortraitFrameEditor reports why it cannot
			// open, which is the difference between a diagnosable message and a dead button.
			const handle = followerFrameHandle(this.actor, base, { editable: this.isEditable });
			// The same title the framer carries everywhere else (addPortraitFrameControl builds
			// it for the window control this card's portrait ALSO offers), so the two routes to
			// framing one follower cannot come to disagree about what the window is called.
			const name = portrait.querySelector(".stonetop-follower-portrait-img")?.dataset.name || "Follower";
			openPortraitFrameEditor({
				handle,
				img: handle?.img,
				title: format("stonetop.portraitFrame.title", { name }),
				// A frame write touches neither `img` nor anything the sheet watches, so nothing
				// re-renders on its own.
				onSaved: () => this.render(false)
			});
		}

		/**
		 * `onPicked` / `onCleared` are for a caller with something of its own to keep in step —
		 * the portrait window this same face can be edited from, which sits open across the pick
		 * and would otherwise go on showing the picture that has just been replaced.
		 */
		_onFollowerPortraitPick(portrait, { onPicked, onCleared } = {}) {
			if (!this.isEditable || !portrait) return;
			const base = _followerDetailBase(portrait.dataset.ftype, portrait.dataset.slug);
			if (!base) return;
			// getAttribute, not `.src`: the DOM resolves that to an absolute URL, which would
			// match none of the gallery's relative tile paths, so the portrait already in use
			// would not read as selected.
			const current = portrait.querySelector(".stonetop-follower-portrait-img")?.getAttribute("src") ?? "";

			// The gallery opens over the sheet; a preview raised by the hover that led to the
			// click would be left floating on top of it with nothing to anchor to.
			removeAvatarPreview();
			// Picture and frame in ONE update, both ways — see followerPortraitPickUpdate and its
			// clear, which own where a card keeps its face and why the two move together.
			const apply = async (src, { frame = null } = {}) => {
				await this.actor.update(followerPortraitPickUpdate(base, src, { frame }));
				this.render(false);
				onPicked?.(src ?? "");
			};
			openPeoplePortraitPicker({
				current,
				used: this._followerPortraitsInUse(portrait.dataset),
				onPick: apply,
				onClear: async () => {
					await this.actor.update(followerPortraitClearUpdate(base));
					this.render(false);
					onCleared?.();
				},
				// A browsed file is exactly the case with no sensible default framing, so offer
				// the framer the moment one is chosen.
				onFrame: () => this._onFollowerPortraitFrame(portrait),
			});
		}

		/**
		 * Which roster member an avatar belongs to, straight off its dataset: the store `kind`, the
		 * custom follower's `slug` where there is one, and the row `index`. One reader, so the four
		 * handlers below cannot come to disagree about how a roster row names itself.
		 */
		_rosterAvatarRef(avatar) {
			const kind  = avatar?.dataset?.roster;
			const slug  = avatar?.dataset?.slug ?? "";
			const index = Number(avatar?.dataset?.index);
			if (!kind || !Number.isInteger(index) || index < 0) return null;
			// rosterPortraitListPath is the whitelist: an unknown kind, or a custom member with no
			// follower id, resolves to no store and so to no ref at all.
			return rosterPortraitListPath(kind, slug) ? { kind, slug, index } : null;
		}

		/**
		 * The anonymous rows of a group roster — the crew's unnamed tail, and every member of a
		 * custom group (which names none of its own).
		 *
		 * Both rosters are the same row: an index, a label, HP clamped against the shared max, and
		 * the avatar context that gives it a face. Built in one place so a field added to the row
		 * cannot land on one roster and be forgotten on the other.
		 *
		 * `labelFor` is the only real difference — the crew counts past its named members, a custom
		 * group counts from one.
		 */
		_anonRosterMembers(count, { hp = [], img = [], hpMax, editing, labelFor }) {
			return Array.from({ length: count }, (_, i) => {
				const label = labelFor(i);
				return {
					index:     i,
					label,
					hpMax,
					hpCurrent: _clampHp(hp[i], hpMax),
					...rosterAvatarContext(img[i], {
						name: label, canWrite: this.isEditable, rosterEditing: editing,
					}),
				};
			});
		}

		/** The name a roster row's avatar captions its windows with. */
		_rosterAvatarName(avatar) {
			return avatar?.querySelector?.(".stonetop-roster-avatar-img")?.dataset.name || "this member";
		}

		/**
		 * DOM adapter for the in-sheet click path. Everything below works from the `ref` alone —
		 * see _pickRosterPortrait for why.
		 */
		_onRosterAvatarPick(avatar) {
			const ref = this._rosterAvatarRef(avatar);
			if (ref) this._pickRosterPortrait(ref, this._rosterAvatarName(avatar));
		}

		/**
		 * Give a roster member a face: the same People of Stonetop gallery every other portrait in
		 * the system opens, writing to that member's own slot (see roster-portraits.js).
		 *
		 * Keyed on the REF — `{kind, slug, index}` — and never on an element, which is the whole
		 * reason this is split from the click handler above. The follower card's equivalent has to
		 * re-look-up its portrait element per click (a pick re-renders the sheet, leaving the
		 * captured node detached and still showing the old face) and then fall back to the stale
		 * node for when the sheet has been CLOSED behind the portrait window. A ref needs neither
		 * dance: it does not go stale, it survives the sheet closing, and the store read below is
		 * always current. Without this split, "Edit Photo" on a roster member's portrait window
		 * died silently the moment the sheet behind it was closed, while "Frame Face" beside it —
		 * which already worked from the ref — kept working.
		 *
		 * `onPicked` / `onCleared` are for a caller with something of its own to keep in step: that
		 * same window, which would otherwise go on showing the picture just replaced.
		 */
		_pickRosterPortrait(ref, name, { onPicked, onCleared } = {}) {
			if (!this.isEditable || !ref) return;
			// Asked of the STORE rather than read back off the image on screen: a member wearing
			// only the drawn placeholder has no stored path at all, and reading `src` would hand the
			// gallery a placeholder to mark as the face in use. (It is also why this needs none of
			// the follower card's getAttribute care — nothing here has been through the DOM's URL
			// resolution.)
			const current = readRosterPortrait(this.actor, ref.kind, ref.slug, ref.index).img;

			// The gallery opens over the sheet; a preview raised by the hover that led to the click
			// would be left floating on top of it with nothing to anchor to.
			removeAvatarPreview();
			openPeoplePortraitPicker({
				current,
				// The roster's own faces are in this scan (usedActorPortraits sweeps them through
				// claimRosterPortraits), so two crew members cannot be handed one face without the
				// gallery saying so — and `own` takes THIS member's back out again, since the same
				// sweep is what would otherwise report their current face as another person's.
				used: this._followerPortraitsInUse({ own: current }),
				// Both branches follow through only on a write that LANDED. The store refuses,
				// silently, a ref that has fallen off the end of its roster — the reachable case
				// being this very window, kept open across a crew shrinking beneath it (see
				// roster-portraits.js). Telling the window about a face that was never stored is
				// the one outcome worse than the refusal: it would show the new picture, and the
				// sheet behind it would still be showing the old one.
				onPick: async (src, { frame = null } = {}) => {
					// Picture and frame in the one array rewrite, for the reason the follower card
					// above spells out: the 26px disc crops to the frame, and a picture stored
					// without one falls back to a blind top slice. `undefined` is the store's own
					// delete signal, which is exactly what a browsed file (no square) should leave.
					if (!await writeRosterPortrait(this.actor, ref.kind, ref.slug, ref.index,
						{ img: src ?? "", portraitFrame: frame ?? undefined })) return;
					this.render(false);
					onPicked?.(src ?? "");
				},
				// Drops the frame with the picture, in one write, for the reason the follower card's
				// clear spells out: an orphan rect would otherwise sit there forever with nothing
				// left to ever clear it.
				onClear: async () => {
					if (!await clearRosterPortrait(this.actor, ref.kind, ref.slug, ref.index)) return;
					this.render(false);
					onCleared?.();
				},
				// A browsed file is exactly the case with no hand-cut square behind it, so offer the
				// framer the moment one is chosen. Carries the ref, not the element, so the chain
				// survives the same closed-sheet case the pick itself does.
				onFrame: () => this._frameRosterPortrait(ref, name),
			});
		}

		/** Which square of a roster member's portrait the small round avatar shows. Ref-keyed too. */
		_frameRosterPortrait(ref, name) {
			if (!this.isEditable || !ref) return;
			// No early return on a null handle: openPortraitFrameEditor reports why it cannot open,
			// which is the difference between a diagnosable message and a dead control.
			openPortraitFrameEditor({
				handle: rosterMemberFrameHandle(this.actor, ref, { editable: this.isEditable }),
				title:  format("stonetop.portraitFrame.title", { name }),
				// A frame write touches nothing the sheet watches, so nothing re-renders on its own.
				onSaved: () => this.render(false),
			});
		}

		/**
		 * Enlarge a roster member's portrait, the way tapping any other face in the system does —
		 * carrying the same "Edit Photo" and "Frame Face", so the face can be changed or re-framed
		 * while READING the roster, without first opening its pencil. That is the whole reason a tap
		 * here enlarges rather than picks.
		 */
		_onRosterAvatarView(avatar) {
			const ref = this._rosterAvatarRef(avatar);
			if (!ref) return;
			const stored = readRosterPortrait(this.actor, ref.kind, ref.slug, ref.index).img;
			if (!stored) return;
			// The popup is portaled to <body> and would otherwise hang over the popout.
			removeAvatarPreview();
			const name = this._rosterAvatarName(avatar);
			// displayPortraitSrc: a People-of-Stonetop square is a small face cut out of a standing
			// figure, so popping the square itself would answer "show me this bigger" with a picture
			// smaller than the one just tapped.
			const popout = imagePopout({ src: displayPortraitSrc(stored), title: name });
			if (!popout) return;
			popout.render(true);
			this._hangRosterAvatarControls(popout, ref, name);
		}

		/**
		 * The two controls a roster member's portrait window carries, hung as a unit so a window
		 * that had to re-render — which builds a fresh header and drops what was on the old one —
		 * can have them put back with one call. No Tokenizer, unlike a follower card's: a roster
		 * member is a row in a flag array and never an Actor, so there is nothing to token.
		 *
		 * BOTH controls are built from the `ref` and touch no DOM, so this window keeps working
		 * after the sheet behind it is closed — which is the normal way to look at a face
		 * unobstructed, and used to leave "Edit Photo" dead beside a live "Frame Face".
		 */
		_hangRosterAvatarControls(popout, ref, name) {
			if (!popout || !ref || !this.isEditable) return;
			addPopoutHeaderControl(popout, {
				key:   "stonetop-edit-roster-photo",
				icon:  "fa-camera",
				label: localize("stonetop.portraitPicker.popout"),
				onClick: () => this._pickRosterPortrait(ref, name, {
					onPicked: (src) => {
						if (!pointImagePopoutAt(popout, displayPortraitSrc(src))) {
							this._hangRosterAvatarControls(popout, ref, name);
						}
					},
					// A cleared portrait leaves nothing to show, so the window closes rather than
					// sit there displaying a face nobody wears any more.
					onCleared: () => popout.close(),
				}),
			});
			addPortraitFrameControl(popout, rosterMemberFrameHandle(this.actor, ref, { editable: this.isEditable }), {
				name,
				onSaved: () => this.render(false),
			});
		}

		// Persist a built custom follower under a fresh id and re-render. `data` is
		// the buildCustomFollower() shape; we stamp a creation-order key for stable
		// ordering on the Followers tab.
		async _applyCustomFollower(data) {
			if (!data) return;
			const id = foundry.utils.randomID(16);
			await this.actor.update({
				[`flags.stonetop-pwd.customFollowers.${id}`]: { ...data, order: this._nextFollowerOrder() },
			});
			this.render(false);
		}

		// Next creation-order stamp for a custom follower: one past the largest existing
		// `order`, so two followers added in the same millisecond still sort by insertion
		// (Date.now() alone can tie). Date.now() is the floor for the first follower.
		_nextFollowerOrder() {
			return nextFollowerOrder(this.actor.getFlag(STONETOP_SCOPE, "customFollowers") ?? {});
		}

		// Apply the fate chosen for a follower that hit 0 HP (FollowerFateDialog).
		// "roll" is the Ranger's animal-companion move Loyal to the End (p.143): roll +0
		// (advantage if it holds Loyalty) and the result card carries the 10+/7-9/6-
		// outcome. Every other follower's "action" just posts a note recording the GM's
		// call.
		async _resolveFollowerFate(action, { name, loyalty, follower, slug } = {}) {
			const plainWho = name || "Your follower";
			const who = escHtml(plainWho);
			if (action === "roll") {
				await rollStat("", this.actor, {
					statValue:   0,
					moveName:    "Loyal to the End",
					rollMode:    loyalty > 0 ? "adv" : "normal",
					noXpOnMiss:  true,
					moveDescription: `<p>When your <strong><em>companion is at 0 HP</em></strong>, roll +0, with advantage if it holds Loyalty.</p>`,
					// Plain text, and the unescaped name: the card escapes these itself (and
					// persists them into a data-outcome-* attribute), so tags would print as
					// literal markup and a pre-escaped "&" would come out as "&amp;".
					moveResults: {
						success: { label: "10+", value: `${plainWho} will be fine once it regains any HP.` },
						partial: { label: "7–9", value: `${plainWho} survives but takes the "injured" tag.` },
						failure: { label: "6–", value: `${plainWho} is injured and will die soon unless someone saves it.` },
					},
				});
				this.render(false);
				return;
			}
			let body;
			if (action === "deathsdoor") {
				body = `<p><strong>${who}</strong> triggers <strong>Death's Door</strong>: ${escHtml(this.actor.name)} rolls for them.</p>`;
			} else if (action === "dying") {
				body = `<p><strong>${who}</strong> is dying: out of the action; they'll die or hit Death's Door soon if no one intervenes.</p>`;
			} else if (action === "dead") {
				body = `<p><strong>${who}</strong> is dead.</p>`;
				// Mark a custom follower fallen so its card stays on the sheet as a record —
				// greyed out with a Remove button — rather than either vanishing or lingering
				// as if nothing happened. Reviving them (HP back above 0) clears the mark. The
				// built-in followers (animal companion / initiate / beast) aren't removable and
				// have no per-record store, so they keep the chat-card record only.
				if (follower === "custom" && slug) {
					await this.actor.update({ [`flags.stonetop-pwd.customFollowers.${slug}.dead`]: true });
				}
			} else {
				return;
			}
			await this._postMoveCard("Follower Down", body);
			this.render(false);
		}

		// Write a follower's current HP to `val`. The per-slug / per-index HP stores are
		// object-valued flags; write the single changed key with a dotted path (Foundry
		// merges it) instead of cloning the whole map.
		async _setFollowerHp(follower, slug, index, val) {
			if (follower === "animal-companion") {
				await this.actor.setFlag(STONETOP_SCOPE, "animalCompanion.hpCurrent", val);
			} else if (follower === "initiate") {
				await this.actor.update({ [`flags.stonetop-pwd.initiatesHp.${slug}`]: val });
			} else if (follower === "crew-individual") {
				await this.actor.update({ [`flags.stonetop-pwd.crew.individualsHp.${Number(index)}`]: val });
			} else if (follower === "crew-member") {
				const arr = [...(this.actor.getFlag(STONETOP_SCOPE, "crew.memberHp") ?? [])];
				arr[Number(index)] = val;
				await this.actor.setFlag(STONETOP_SCOPE, "crew.memberHp", arr);
			} else if (follower === "crew-group") {
				await this.actor.setFlag(STONETOP_SCOPE, "crew.groupHp", val);
			} else if (follower === "beast") {
				await this.actor.update({ [`flags.stonetop-pwd.beastHp.${slug}`]: val });
			} else if (follower === "custom") {
				await this.actor.update({ [`flags.stonetop-pwd.customFollowers.${slug}.hpCurrent`]: val });
			} else if (follower === "custom-group") {
				await this.actor.update({ [`flags.stonetop-pwd.customFollowers.${slug}.groupHp`]: val });
			} else if (follower === "custom-member") {
				const arr = [...(this.actor.getFlag(STONETOP_SCOPE, `customFollowers.${slug}.memberHp`) ?? [])];
				arr[Number(index)] = val;
				await this.actor.update({ [`flags.stonetop-pwd.customFollowers.${slug}.memberHp`]: arr });
			}
		}

		// Have What They Need (p.472): a follower produces a needed item. Prompt for it
		// and append it (checked) to their free-text gear checklist.
		_onHaveWhatTheyNeed(ftype, slug, name) {
			const base = _followerDetailBase(ftype, slug);
			const gearPath = base ? `${base}.gear` : null;
			if (!gearPath) return;
			new Dialog({
				title:   `${name || "Follower"}: Have What They Need`,
				content: `<form class="stonetop-spend-form"><p>What does <strong>${escHtml(name || "they")}</strong> produce?</p>`
					+ `<input type="text" class="stonetop-hwtn-item stonetop-cf-input" placeholder="an item, some supplies…" style="width:100%"></form>`,
				buttons: {
					add: { icon: '<i class="fas fa-sack"></i>', label: "Add to their gear",
						callback: async html => {
							const item = String(html?.[0]?.querySelector(".stonetop-hwtn-item")?.value ?? "").trim();
							if (!item) return;
							const cur = foundry.utils.deepClone(this.actor.getFlag(STONETOP_SCOPE, gearPath) ?? []);
							cur.push({ label: item, checked: true });
							await this.actor.setFlag(STONETOP_SCOPE, gearPath, cur);
							await this._postMoveCard("Have What They Need",
								`<p><strong>${escHtml(name || "Your follower")}</strong> produces <em>${escHtml(item)}</em>: added to their gear.</p>`);
							this.render(false);
						} },
					cancel: { label: "Cancel" },
				},
				default: "add",
				render:  bringDialogToFront,
			}, { classes: this._pastDeathWindowClasses(["dialog", "stonetop"]) }).render(true);
		}

		// Outfit the crew (p.472): the group Outfits with the same gear, restocking
		// every member's Supplies to full.
		async _onOutfitCrew() {
			// The Supplies-per-set count is "4 + Prosperity" — a synchronous read; no need
			// to build the whole sheet snapshot just to pull one scalar off it.
			const pipsPerSet = this._stonetopCharacter.getSmallItemLimit() ?? 5;
			await this.actor.setFlag(STONETOP_SCOPE, "crew.supplies", Array(6).fill(pipsPerSet));
			await this._postMoveCard("Outfit",
				`<p>The crew Outfits: every member's Supplies restocked to full (${pipsPerSet} uses each).</p>`);
			this.render(false);
		}


		// Whether a follower bears a shield (+1 Readiness on a 7+ Defend). Gear-based types
		// match a "shield" gear label; the crew reads the shield pip of its structured kit.
		_followerHasShield(ftype, slug) {
			if (ftype === "crew") {
				const gearFlags = this.actor.getFlag(STONETOP_SCOPE, "crew.gear") ?? {};
				// A number is filled load pips (equipped once ≥ its weight, default 1); a
				// non-number flag is already the "fully equipped" boolean.
				return typeof gearFlags.shield === "number" ? gearFlags.shield >= 1 : !!gearFlags.shield;
			}
			const detail = this.actor.getFlag(STONETOP_SCOPE, _followerDetailBase(ftype, slug));
			return _followerBearsShield(detail?.gear);
		}

		// When a follower is Ordered to Defend and rolls 7+, they hold Readiness (p.469):
		// 1 on a 7–9, 3 on a 10+ (a shield adds +1 — the player can click one more). We
		// set the base hold automatically off the Order Followers result and post a note.
		async _maybeHoldReadinessOnDefend(ftype, slug, result, roll) {
			const total = Number(roll?.total);
			if (!Number.isFinite(total) || total < 7) return;
			// The dialog reports the chosen move + follower name structurally, so we don't
			// have to sniff "defend" out of (or split ":" from) the flattened moveName.
			if (result?.moveKey !== "defend") return;
			const path = _followerReadinessPath(ftype, slug ?? "");
			if (!path) return;
			// Base hold via the shared, unit-tested tier→hold table (defend-readiness.js), so PC
			// and follower Defend holds can't drift. The follower path leaves the shield's +1 as a
			// manual pip (advertised in shieldNote below), so we don't pass hasShield; the total ≥ 7
			// guard above guarantees a success/partial tier here.
			const held = defendReadinessHold(classifyResult(total).key);
			// Never REDUCE an already-held pool: a follower who held 3 (or clicked a 4th pip
			// for their shield) and then Defends again at 7–9 keeps the higher pool rather
			// than being silently knocked down to 1.
			const existing = Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, path)) || 0);
			const next = Math.max(existing, held);
			// Only advertise the shield's +1 when the follower actually bears one, and only
			// when this Defend set the (fresh) base hold — not when we kept a higher pool.
			const bearsShield = this._followerHasShield(ftype, slug ?? "");
			const shieldNote = (bearsShield && next === held) ? ` (${held + 1} with their shield)` : "";
			if (next !== existing) {
				await this.actor.update({ [`flags.stonetop-pwd.${path}`]: next }, { stonetopMove: "Defend" });
			}
			const who = result?.followerName || "Your follower";
			await this._postMoveCard("Defend: Readiness held",
				`<p><strong>${escHtml(who)}</strong> holds <strong>${next}</strong> Readiness${shieldNote}.</p>`
				+ `<p>Spend it to suffer the damage/effects of an attack for a ward, or to draw all attention to themselves.</p>`);
			if (next !== existing) this.render(false);
		}

		// Radio-option markup shared by the Spend Loyalty / Spend Readiness choosers:
		// one <label> per reason, the first pre-checked, keyed by the given input name.
		_spendRadioOptions(name, reasons) {
			return reasons.map((r, i) =>
				`<label class="stonetop-spend-choice"><input type="radio" class="stonetop-spend-radio" name="${name}" value="${r.key}"${i === 0 ? " checked" : ""}> <span>${escHtml(r.label)}</span></label>`
			).join("");
		}

		// Spend 1 Loyalty (Strengthen Your Bond, p.464): a follower overcomes fear,
		// resists their instinct, or does something they'd rather not. Decrements the
		// Loyalty track by one (attributed so the ledger reads "via Spend Loyalty") and
		// posts a chat note naming what it bought.
		_onSpendLoyalty(ftype, slug, name) {
			const path = _followerLoyaltyPath(ftype, slug);
			if (!path) return;
			const current = Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, path)) || 0);
			if (current <= 0) { ui.notifications?.warn?.(`${name || "This follower"} holds no Loyalty to spend.`); return; }
			const reasons = [
				{ key: "fear",      label: "Overcome their fear to do as you say" },
				{ key: "instinct",  label: "Resist acting on their instinct / tags / traits" },
				{ key: "unwilling", label: "Do something they don't want to do" },
			];
			const opts = this._spendRadioOptions("spend-loyalty", reasons);
			new Dialog({
				title:   `Spend ${name || "follower"}'s Loyalty`,
				content: `<form class="stonetop-spend-form"><p>Spend <strong>1 Loyalty</strong> (${current} held) to have <strong>${escHtml(name || "them")}</strong>:</p>${opts}</form>`,
				buttons: {
					spend:  { icon: '<i class="fas fa-hand-holding-heart"></i>', label: "Spend 1 Loyalty",
						callback: html => this._applySpendLoyalty(path, name, reasons, html) },
					cancel: { label: "Cancel" },
				},
				default: "spend",
				render:  bringDialogToFront,
			}, { classes: this._pastDeathWindowClasses(["dialog", "stonetop"]) }).render(true);
		}

		async _applySpendLoyalty(path, name, reasons, html) {
			const key    = html?.[0]?.querySelector('input[name="spend-loyalty"]:checked')?.value ?? reasons[0].key;
			const reason = reasons.find(r => r.key === key)?.label ?? "";
			// Decrement the LIVE value, not the count captured when this (non-modal) dialog
			// opened — the track may have changed since, and writing captured−1 would clobber it.
			const live = Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, path)) || 0);
			if (live <= 0) { ui.notifications?.warn?.(`${name || "This follower"} no longer holds any Loyalty to spend.`); return; }
			await this.actor.update({ [`flags.stonetop-pwd.${path}`]: live - 1 }, { stonetopMove: "Spend Loyalty" });
			await this._postMoveCard("Spend Loyalty",
				`<p>You spend <strong>1 Loyalty</strong> to have <strong>${escHtml(name || "them")}</strong> <em>${escHtml(reason.toLowerCase())}</em>.</p>`
				+ `<p>They now hold <strong>${live - 1}</strong> Loyalty.</p>`);
			this.render(false);
		}

		// Spend 1 Readiness (Followers in Fights, p.469/473): a follower holding
		// Readiness suffers an attack for a ward or draws all attention. If they wouldn't
		// want to, the player must also spend 1 Loyalty (p.547) — surfaced as a checkbox.
		_onSpendReadiness(ftype, slug, name) {
			const rPath = _followerReadinessPath(ftype, slug);
			if (!rPath) return;
			const readiness = Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, rPath)) || 0);
			if (readiness <= 0) { ui.notifications?.warn?.(`${name || "This follower"} holds no Readiness to spend.`); return; }
			const lPath   = _followerLoyaltyPath(ftype, slug);
			const loyalty = Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, lPath)) || 0);
			const reasons = [
				{ key: "suffer",    label: "Suffer the damage/effects of an attack for a ward" },
				{ key: "attention", label: "Draw all attention from a ward to themselves" },
			];
			const opts = this._spendRadioOptions("spend-readiness", reasons);
			const unwilling = loyalty > 0
				? `<label class="stonetop-spend-choice stonetop-spend-choice--unwilling"><input type="checkbox" class="stonetop-spend-unwilling"> <span>…and they wouldn't want to (also spend <strong>1 Loyalty</strong>)</span></label>`
				: `<p class="stonetop-spend-note"><em>If they wouldn't want to, you'd also spend 1 Loyalty: but they hold none.</em></p>`;
			new Dialog({
				title:   `Spend ${name || "follower"}'s Readiness`,
				content: `<form class="stonetop-spend-form"><p>Spend <strong>1 Readiness</strong> (${readiness} held) to have <strong>${escHtml(name || "them")}</strong>:</p>${opts}${unwilling}</form>`,
				buttons: {
					spend:  { icon: '<i class="fas fa-shield"></i>', label: "Spend Readiness",
						callback: html => this._applySpendReadiness({ rPath, readiness, lPath, loyalty, name, reasons, html }) },
					cancel: { label: "Cancel" },
				},
				default: "spend",
				render:  bringDialogToFront,
			}, { classes: this._pastDeathWindowClasses(["dialog", "stonetop"]) }).render(true);
		}

		async _applySpendReadiness({ rPath, lPath, name, reasons, html }) {
			const key       = html?.[0]?.querySelector('input[name="spend-readiness"]:checked')?.value ?? reasons[0].key;
			const reason    = reasons.find(r => r.key === key)?.label ?? "";
			// Decrement the LIVE tracks, not the counts captured when this (non-modal) dialog
			// opened — either may have changed since, and writing captured−1 would clobber it.
			const liveReadiness = Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, rPath)) || 0);
			if (liveReadiness <= 0) { ui.notifications?.warn?.(`${name || "This follower"} no longer holds any Readiness to spend.`); return; }
			const wantsUnwilling = !!html?.[0]?.querySelector(".stonetop-spend-unwilling")?.checked;
			const liveLoyalty = lPath ? Math.max(0, Number(this.actor.getFlag(STONETOP_SCOPE, lPath)) || 0) : 0;
			// Only charge the "wouldn't want to" Loyalty if they still hold some to pay it.
			const unwilling = wantsUnwilling && !!lPath && liveLoyalty > 0;
			const update = { [`flags.stonetop-pwd.${rPath}`]: liveReadiness - 1 };
			if (unwilling) update[`flags.stonetop-pwd.${lPath}`] = liveLoyalty - 1;
			await this.actor.update(update, { stonetopMove: "Spend Readiness" });
			const costLine = unwilling
				? `<p>They didn't want to, so you also spent <strong>1 Loyalty</strong> (${liveLoyalty - 1} left).</p>`
				: wantsUnwilling
					? `<p>They didn't want to, but hold no Loyalty left to spend.</p>`
					: "";
			await this._postMoveCard("Spend Readiness",
				`<p>You spend <strong>1 Readiness</strong> to have <strong>${escHtml(name || "them")}</strong> <em>${escHtml(reason.toLowerCase())}</em>.</p>`
				+ `<p>They now hold <strong>${liveReadiness - 1}</strong> Readiness.</p>${costLine}`);
			this.render(false);
		}

		// Hand a custom follower off to another PC (NPCs & Followers p.480: a follower
		// can shift from one PC's lead to another's). Only custom followers transfer —
		// the built-in ones are tied to a playbook / background / inventory item.
		_onHandOffFollower(slug, name) {
			const targets = game.actors.filter(a => a.type === "character" && a.id !== this.actor.id && a.isOwner);
			if (!targets.length) {
				ui.notifications?.warn?.("No other character is available to take this follower.");
				return;
			}
			const opts = targets.map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`).join("");
			new Dialog({
				title:   `Hand off ${name}`,
				content: `<p>Move <strong>${escHtml(name)}</strong>, with their Loyalty, current HP, and notes, to another character:</p>
					<div class="form-group stonetop-handoff-row"><label>Character</label>
						<select class="stonetop-handoff-target">${opts}</select></div>`,
				buttons: {
					handoff: { icon: '<i class="fas fa-people-arrows"></i>', label: "Hand off",
						callback: html => this._handOffFollower(slug, html.find(".stonetop-handoff-target").val()) },
					cancel:  { label: "Cancel" },
				},
				default: "handoff",
				render:  bringDialogToFront,
			}, { classes: ["dialog", "stonetop"] }).render(true);
		}

		async _handOffFollower(slug, targetId) {
			const data   = this.actor.getFlag(STONETOP_SCOPE, `customFollowers.${slug}`);
			const target = game.actors.get(targetId);
			if (!data || !target) return;
			// Fresh id + order on the destination so it can't collide with one of theirs.
			const targetMap = target.getFlag(STONETOP_SCOPE, "customFollowers") ?? {};
			const maxOrder  = Object.values(targetMap).reduce((m, f) => Math.max(m, Number(f?.order) || 0), 0);
			const newId     = foundry.utils.randomID(16);
			await target.update({
				[`flags.stonetop-pwd.customFollowers.${newId}`]: { ...data, order: Math.max(maxOrder + 1, Date.now()) },
			});
			await this._removeCustomFollower(slug);
			await this._postMoveCard("Follower Handed Off",
				`<p><strong>${escHtml(data.name || "A follower")}</strong> now follows <strong>${escHtml(target.name)}</strong>.</p>`);
		}

		async _onRecoverOpen() {
			const snapshot = await this._stonetopCharacter.buildSnapshot();
			const hp = snapshot.vitals.hp;
			if (this.actor.getFlag(STONETOP_SCOPE, "recover.spent")) return;
			if (hp.value >= hp.max) return;

			const resources = this.actor.getFlag(STONETOP_SCOPE, "inventory.resources") ?? {};
			const purses    = supplyPursesFor(resources, SUPPLY_PURPOSE.RECOVER);
			const fallback  = defaultSupplyPurse(purses);
			if (!fallback) return;

			const healAmount = snapshot.inventory?.smallItemLimit ?? 4;
			const newHp      = Math.min(hp.value + healAmount, hp.max);
			const guide      = GUIDED_CHARACTER_MOVES.Recover;

			new Dialog({
				title: "Recover",
				content: `<form class="stonetop-homestead-dialog stonetop-recover-dialog">
					<p class="stonetop-homestead-trigger"><em>${_esc(guide.trigger)}</em></p>
					<div class="stonetop-homestead-reference">
						<ul>
							<li>Expend <strong>1 use of supplies</strong>.</li>
							<li>Regain HP: <strong>${hp.value} &rarr; ${newHp}</strong> (4+Prosperity = ${healAmount}).</li>
						</ul>
					</div>
					${_supplyPurseFieldHtml(purses, "Pay with")}
					<p class="stonetop-homestead-note">${_esc(guide.note)} You can't gain this benefit again until you take more damage.</p>
				</form>`,
				buttons: {
					cancel:  { label: "Cancel" },
					recover: {
						label: `Recover (+${newHp - hp.value} HP)`,
						callback: (html) => this._applyRecover({
							purse:  _chosenSupplyPurse(html, purses) ?? fallback,
							oldHp:  hp.value,
							newHp,
						}),
					},
				},
				default: "recover",
				render: bringDialogToFront,
			}, { width: 480, classes: this._pastDeathWindowClasses(["dialog", "stonetop", "stonetop-recover-dialog"]) }).render(true);
		}

		async _applyRecover({ purse, oldHp, newHp }) {
			await this._stonetopCharacter.setInventoryResource(purse.slug, Math.max(0, purse.remaining - 1));
			await this.actor.update({
				"system.attributes.hp.value": newHp,
				"flags.stonetop-pwd.recover.spent": true,
			});

			const rows = [
				{ label: purse.label, value: `Expended 1 use (${purse.remaining - 1} left)` },
				{ label: "HP", value: `${oldHp} → ${newHp} (+${newHp - oldHp})` },
			];
			postMoveToChat(this.actor, "Recover", rows);

			this.render(false);
		}

		async _onConvalesceOpen() {
			const snapshot = await this._stonetopCharacter.buildSnapshot();
			const hp = snapshot.vitals.hp;
			const activeDebilities = (snapshot.debilities ?? []).filter(d => d.active);
			const openWounds = (snapshot.wounds ?? []).filter(w => !w.healed);
			const healable   = openWounds.filter(w => w.status !== "permanent");
			const permanent  = openWounds.filter(w => w.status === "permanent");
			if (hp.value >= hp.max && activeDebilities.length === 0 && openWounds.length === 0) return;

			const hpRow = hp.value < hp.max
				? `<li>Recover all HP: <strong>${hp.value} &rarr; ${hp.max}</strong>.</li>`
				: `<li>HP already full.</li>`;
			const debilityRow = activeDebilities.length
				? `<li>Clear ${activeDebilities.length === 1 ? "debility" : "debilities"}: <strong>${_esc(activeDebilities.map(d => d.name).join(", "))}</strong>.</li>`
				: `<li>No debilities marked.</li>`;

			// Wounds that can heal → an OPT-IN checklist (unchecked by default): healing them
			// is Convalesce's stricter "few weeks under a healer" tier, distinct from the "few
			// days" HP/debility reset above, so the player asserts it deliberately rather than
			// having it ride along on every reset. Healing keeps a wound as a scar, not deletion.
			const healSection = healable.length
				? `<div class="stonetop-convalesce-wounds">
						<p class="stonetop-homestead-subhead">Heal wounds that can heal (weeks under a healer):</p>
						<ul class="stonetop-convalesce-wound-list">
							${healable.map(w => `<li><label class="stonetop-convalesce-wound"><input type="checkbox" name="heal" value="${_esc(w.id)}"> <span>${_esc(w.text || "(unnamed wound)")}</span></label></li>`).join("")}
						</ul>
					</div>`
				: "";
			// Permanent injuries can't heal. Split them by origin so each gets the right framing:
			// a real impairment (lost limb, shattered knee) prompts "retire or Make a Plan"; a
			// purely narrative Death's-Door mark is just carried and never gets the retire framing.
			const permRow = (w) => `<li class="stonetop-convalesce-permanent-row">
					<span class="stonetop-convalesce-permanent-text"><i class="fas fa-lock"></i> ${_esc(w.text || "(unnamed injury)")}</span>
					<input type="text" name="plan-${_esc(w.id)}" value="${_esc(w.planNote ?? "")}" placeholder="Make a Plan to adapt (a prosthetic, learn to compensate…)">
				</li>`;
			const permBlock = (title, list) => list.length
				? `<div class="stonetop-convalesce-permanent">
						<p class="stonetop-homestead-subhead">${title}</p>
						<ul class="stonetop-convalesce-wound-list">${list.map(permRow).join("")}</ul>
					</div>`
				: "";
			// The goal input here is a quick capture; the full plan (tick-box requirements +
			// any interim penalty like "Let Fly at disadvantage until practiced") lives on the
			// wound's own edit form, so point there rather than duplicating that editor.
			const permHint = permanent.length
				? `<p class="stonetop-homestead-note">Add tick-box requirements and any interim penalty via the wound's <i class="fas fa-pen"></i> edit on the sheet.</p>`
				: "";
			const permSection =
				permBlock("Permanent injury: retire or Make a Plan to adapt:", permanent.filter(w => w.origin !== "deaths-door")) +
				permBlock("A lasting mark: Make a Plan to carry it, or just bring it up in play:", permanent.filter(w => w.origin === "deaths-door")) +
				permHint;

			new Dialog({
				title: "Convalesce",
				content: `<form class="stonetop-homestead-dialog stonetop-convalesce-dialog">
					<p class="stonetop-homestead-trigger"><em>When you rest for a few days, in safety and comfort…</em></p>
					<div class="stonetop-homestead-reference">
						<ul>${hpRow}${debilityRow}</ul>
					</div>
					<p class="stonetop-homestead-note"><em>When you rest for a few weeks under the care of a healer,</em> heal any problematic wounds that can heal. If you have suffered a permanent injury or impairment, either retire or Make a Plan to adapt to it.</p>
					${healSection}
					${permSection}
				</form>`,
				buttons: {
					convalesce: {
						label: "Convalesce",
						callback: (html) => {
							const healIds = html.find('input[name="heal"]:checked').map((_i, el) => el.value).get();
							// Only carry a plan note when it actually changed — the inputs are
							// pre-filled with the stored note, so an untouched permanent wound would
							// otherwise trigger a redundant wound write (and a spurious "via
							// Convalesce" ledger entry) every time HP/debilities are the real point.
							const planNotes = {};
							for (const w of permanent) {
								const next = (html.find(`[name="plan-${w.id}"]`).val() ?? "").trim();
								if (next !== (w.planNote ?? "")) planNotes[w.id] = next;
							}
							this._applyConvalesce({ oldHp: hp.value, newHp: hp.max, debilities: activeDebilities, healable, healIds, planNotes });
						},
					},
					cancel: { label: "Cancel" },
				},
				default: "convalesce",
				render: bringDialogToFront,
			}, { width: 480, classes: this._pastDeathWindowClasses(["dialog", "stonetop", "stonetop-convalesce-dialog"]) }).render(true);
		}

		async _applyConvalesce({ oldHp, newHp, debilities, healable = [], healIds = [], planNotes = {} }) {
			const update = { "system.attributes.hp.value": newHp };
			for (const d of debilities) update[`system.attributes.debilities.options.${d.key}.value`] = false;
			await this.actor.update(update, { stonetopMove: "Convalesce" });

			// Heal checked wounds (→ scars) and stamp any Make-a-Plan notes, in one write.
			const hasPlanNotes = Object.keys(planNotes).length > 0;
			if (healIds.length || hasPlanNotes) {
				await this._stonetopCharacter.convalesceWounds({ healIds, planNotes });
			}
			const healedNames = healIds.map(id => {
				const w = healable.find(x => x.id === id);
				return w?.text || "a wound";
			});

			const rows = [];
			if (newHp > oldHp)       rows.push({ label: "HP", value: `${oldHp} → ${newHp} (+${newHp - oldHp})` });
			if (debilities.length)   rows.push({ label: "Debilities cleared", value: debilities.map(d => d.name).join(", ") });
			if (healedNames.length)  rows.push({ label: healedNames.length === 1 ? "Wound healed" : "Wounds healed", value: healedNames.join(", ") });
			if (!rows.length)        rows.push({ label: "Convalesce", value: "Rested in safety and comfort." });
			postMoveToChat(this.actor, "Convalesce", rows);

			this.render(false);
		}

		/**
		 * MAKE CAMP (expedition move, Book I p.334) — the move provisions exist for.
		 *
		 * "Each member of the party must consume 1 use of supplies or provisions; if you use a
		 * mess kit (requires fire & water), then 1 use can provide for up to four people." So the
		 * bill is people ÷ (mess kit ? 4 : 1), rounded up, and it may be paid out of any mix of
		 * the printed supplies rows and the larder (supply-cost.js#spendSupplies spills across
		 * them). Only the character running the dialog pays: the move is written per-PC, and one
		 * player reaching into another's pack is not something a sheet should do quietly.
		 *
		 * Then "pick 1: regain HP equal to ½ your max, or clear a debility" — offered only when
		 * the camp was actually fed, because deprivation's first cost is exactly that you get no
		 * choice (p.335). A carried bedroll adds its printed 1d6, and a peaceful night can set the
		 * sheet's advantage toggle.
		 */
		async _onMakeCampOpen() {
			const snapshot = await this._stonetopCharacter.buildSnapshot();
			const hp        = snapshot.vitals.hp;
			const resources = this.actor.getFlag(STONETOP_SCOPE, "inventory.resources") ?? {};
			const purses    = supplyPursesFor(resources, SUPPLY_PURPOSE.CAMP);
			const carried   = slug => !!(snapshot.inventory?.outfit?.regularItems ?? []).find(i => i.slug === slug)?.checked;
			const hasMessKit = carried("mess-kit");
			const hasBedroll = carried("bedroll");
			const debilities = (snapshot.debilities ?? []).filter(d => d.active);
			// Halves round UP throughout Stonetop, so a 15 HP character regains 8, not 7.
			const halfMax    = Math.ceil(hp.max / 2);

			const messKitRow = hasMessKit
				? `<label class="stonetop-camp-messkit"><input type="checkbox" name="messKit" checked>
						<span>Use the mess kit: 1 use feeds up to 4 <em>(requires fire &amp; water)</em></span></label>`
				: `<p class="stonetop-homestead-note">No mess kit carried, so 1 use feeds 1 person.</p>`;
			const benefitRows = [
				`<label class="stonetop-camp-benefit"><input type="radio" name="benefit" value="hp" checked>
					<span>Regain HP equal to ½ your max: <strong>${hp.value} &rarr; ${Math.min(hp.value + halfMax, hp.max)}</strong> (+${halfMax})</span></label>`,
				debilities.length
					? `<label class="stonetop-camp-benefit"><input type="radio" name="benefit" value="debility">
							<span>Clear a debility:</span>
							<select name="debility">${debilities.map(d => `<option value="${_esc(d.key)}">${_esc(d.name)}</option>`).join("")}</select>
						</label>`
					: `<p class="stonetop-homestead-note">No debilities marked.</p>`,
			].join("");

			new Dialog({
				title: "Make Camp",
				content: `<form class="stonetop-homestead-dialog stonetop-camp-dialog">
					<p class="stonetop-homestead-trigger"><em>When you settle in to rest in an unsafe area, answer the GM's questions about your campsite.</em></p>
					<div class="stonetop-camp-feed">
						<p class="stonetop-homestead-subhead">Feed the camp</p>
						<label class="stonetop-camp-people">People fed from your pack
							<input type="number" name="people" value="1" min="0" max="20" step="1"></label>
						${messKitRow}
						<p class="stonetop-camp-bill" data-camp-bill></p>
					</div>
					${_supplyPurseFieldHtml(purses, "Pay with")}
					<div class="stonetop-camp-benefits">
						<p class="stonetop-homestead-subhead">Eat and drink your fill, get a few hours' sleep, then pick 1</p>
						${benefitRows}
						${hasBedroll ? `<label class="stonetop-camp-extra"><input type="checkbox" name="bedroll" checked>
							<span>Bedroll: regain <strong>1d6</strong> extra HP</span></label>` : ""}
						<label class="stonetop-camp-extra"><input type="checkbox" name="peaceful">
							<span>The rest was peaceful, comfortable or enjoyable: take <strong>advantage</strong> on your next roll</span></label>
					</div>
					<p class="stonetop-homestead-note">If the camp goes unfed, take no benefit: deprivation's first cost is that you get no choice here (Book I p.335).</p>
				</form>`,
				buttons: {
					cancel: { label: "Cancel" },
					camp:   {
						// Read the form here and hand _applyMakeCamp plain values, the way
						// _applyConvalesce is called: what the move DOES is then a function of
						// numbers and choices rather than of a live dialog, and can be tested
						// as one.
						label: "Make Camp",
						callback: (html) => this._applyMakeCamp({
							purses, hp, halfMax, debilities,
							people:    html.find('[name="people"]').val(),
							messKit:   html.find('[name="messKit"]').is(":checked"),
							preferred: _chosenSupplyPurse(html, purses)?.slug ?? null,
							benefit:   html.find('[name="benefit"]:checked').val() ?? "hp",
							debility:  html.find('[name="debility"]').val() ?? null,
							bedroll:   html.find('[name="bedroll"]').is(":checked"),
							peaceful:  html.find('[name="peaceful"]').is(":checked"),
						}),
					},
				},
				default: "camp",
				render: (html) => { bringDialogToFront(html); _wireCampBill(html, purses); },
			}, { width: 500, classes: this._pastDeathWindowClasses(["dialog", "stonetop", "stonetop-camp-dialog"]) }).render(true);
		}

		async _applyMakeCamp({ purses, hp, halfMax, debilities = [], people, messKit = false,
		                       preferred = null, benefit = "hp", debility = null,
		                       bedroll = false, peaceful = false }) {
			const needed = campUsesNeeded(people, messKit);
			const { spends, short } = spendSupplies(purses, needed, preferred);

			// Everything this move changes goes into ONE update at the bottom: a meal spilling
			// across three purses, the HP or the cleared debility, and the peaceful night's
			// advantage are one act at the table, and writing them one at a time is a document
			// write and a full sheet rebuild apiece.
			const update = {};
			for (const s of spends) Object.assign(update, this._stonetopCharacter.inventoryResourceData(s.slug, s.left));

			const rows = spends.length
				? spends.map(s => ({ label: s.label, value: `Expended ${s.spend} ${s.spend === 1 ? "use" : "uses"} (${s.left} left)` }))
				: [{ label: "Rations", value: "Nothing consumed" }];
			if (short > 0) rows.push({ label: "Short", value: `${short} ${short === 1 ? "use" : "uses"}; someone goes hungry (deprivation, p.335)` });

			// Fed means fed: the benefit is what eating and sleeping buys, so a camp that came up
			// short of its own bill takes none of it. `needed` of 0 (nobody eating from this pack)
			// is not the same as going short, and still rests.
			const fed = short === 0;
			let newHp = hp.value;
			if (fed) {
				if (benefit === "debility") {
					const cleared = debilities.find(d => d.key === debility);
					if (cleared) {
						update[`system.attributes.debilities.options.${cleared.key}.value`] = false;
						rows.push({ label: "Debility", value: `Cleared ${cleared.name}` });
					}
				} else {
					newHp = Math.min(hp.value + halfMax, hp.max);
					rows.push({ label: "HP", value: `${hp.value} → ${newHp} (+${newHp - hp.value}, ½ max)` });
				}
				// The bedroll's own 1d6 is rolled to chat: it is a die the table can see, and it
				// stacks on whichever benefit was taken (its text says "extra HP when you Make
				// Camp", not "instead of").
				if (bedroll) {
					const roll = await new Roll("1d6").evaluate();
					await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor: "Bedroll (1d6 extra HP)" });
					const before = newHp;
					newHp = Math.min(newHp + Math.max(0, roll.total), hp.max);
					rows.push({ label: "Bedroll", value: `${before} → ${newHp} (+${newHp - before})` });
				}
				if (newHp !== hp.value) update["system.attributes.hp.value"] = newHp;

				if (peaceful) {
					Object.assign(update, this._stonetopCharacter.rollModeData("adv"));
					rows.push({ label: "Advantage", value: "A peaceful night; set on the sheet until you spend it" });
				}
			}

			if (Object.keys(update).length) await this.actor.update(update, { stonetopMove: "Make Camp" });
			postMoveToChat(this.actor, "Make Camp", rows);
			this.render(false);
		}

		// ── Damage die ─────────────────────────────────────────────────────────────
		// Hand-editing the Damage field. It has to end up as a "d#" the roller can use, so
		// loose spellings are tidied ("8", "D8", "1d8" → "d8") and anything that isn't a
		// single die is refused with the old value put back rather than half-saved. Typing
		// the playbook's own die, or clearing the field, drops the override so the die
		// follows the playbook (and its move bonuses) again.
		async _onDamageDieEdit(ev) {
			const el = ev.currentTarget;
			if (!this.isEditable) return;
			const typed = String(el.value ?? "").trim();
			const base  = el.dataset.damageBase || null;
			if (typed) {
				const die = normalizeDamageDie(typed);
				if (!die) {
					ui.notifications?.warn(`"${typed}" isn't a damage die: write a single die, like d8.`);
					el.value = this.actor.system?.attributes?.damage?.value ?? base ?? "";
					return;
				}
				await this._stonetopCharacter.setDamageDieOverride(die === base ? "" : die, { base });
			} else {
				await this._stonetopCharacter.setDamageDieOverride("", { base });
			}
			this.render(false);
		}

		// ── Max HP ─────────────────────────────────────────────────────────────────
		// Hand-editing the max-HP field. The number in the box is derived (playbook + move
		// bonuses - a Thrall's Marks), so the difference between it and what was typed is what
		// gets stored: that way a soul-wound taken at level 3 is still the same wound at level
		// 8, instead of pinning max HP to a number the character has since outgrown. Typing the
		// derived number back in clears the adjustment. Blank or nonsense puts the old value
		// back rather than half-saving.
		async _onMaxHpEdit(ev) {
			const el = ev.currentTarget;
			if (!this.isEditable) return;
			const typed = Number(String(el.value ?? "").trim());
			const base  = Number(el.dataset.hpBase) || 0;
			if (!Number.isFinite(typed) || String(el.value ?? "").trim() === "" || typed < 1) {
				if (String(el.value ?? "").trim() !== "") {
					ui.notifications?.warn("Max HP has to be a whole number of 1 or more.");
				}
				// Back to the number this field was RENDERED with, which `defaultValue` still holds
				// however much has been typed over it since. NOT `system.attributes.hp.max`: getData
				// mirrors the computed max into the render context, so the box shows the real number
				// while the persisted field is the stale one — reverting to that showed a Heavy with
				// move bonuses their level-1 max and then left it there, since this branch returns
				// without a re-render to put it right.
				el.value = el.defaultValue || String(base || "");
				return;
			}
			await this._stonetopCharacter.setMaxHp(typed, { base });
			this.render(false);
		}

		/**
		 * Mirror the computed max HP onto the persisted `hp.max`.
		 *
		 * The stored field is stale by design (StonetopCharacter#computedMaxHp sets out why) and
		 * this sheet never reads it — getData mirrors the computed number into the render context
		 * instead. The TOKEN reads it: `system.json` names `attributes.hp` as the primary token
		 * attribute and this system links PC prototype tokens, so the bar over a character's head
		 * is drawn from the stored max and nothing else. A Heavy whose marked moves took them to 24
		 * had a bar that showed full at 20; a Thrall whose Marks cut them to 16 had one that could
		 * never fill.
		 *
		 * Until this release the blanket form submit pushed the mirrored value back on any sheet
		 * edit, so the field converged by accident. Dropping `name` from the max input — so typing
		 * there banks a permanent adjustment rather than pinning the number — took that away and
		 * put nothing in its place.
		 *
		 * Ledger-silenced: the real change was the level or the Mark, which the ledger already
		 * files. Writes only on a genuine difference, so it settles in one pass and costs a
		 * comparison on every render after that.
		 */
		async _syncStoredMaxHp() {
			const computed = Number(this._computedMaxHp) || 0;
			if (computed <= 0) return;
			// `isEditable` as well as ownership. Ownership alone is true in two places this must
			// not write: a character previewed inside a LOCKED compendium, where the update throws
			// and leaves one console error per render forever; and an unlinked token's sheet,
			// where it would push a stored max into that token's ActorDelta — override data for a
			// field the token was reading off the actor perfectly well. isEditable is the sheet's
			// own answer to "may this be written", and it already accounts for both.
			if (!this.actor?.isOwner || !this.isEditable) return;
			if (Number(this.actor.system?.attributes?.hp?.max) === computed) return;
			await this.actor.update({ "system.attributes.hp.max": computed }, { stonetopLedger: true });
		}

		// ── Wounds (4th harm track) ────────────────────────────────────────────────
		_woundIdFromEvent(ev) {
			return ev.currentTarget.closest("[data-wound-id]")?.dataset.woundId ?? null;
		}

		// The current raw wound record (freshest source) for prefilling the edit dialog.
		_woundRecord(id) {
			return (this.actor.system?.attributes?.wounds ?? []).find(w => w.id === id) ?? null;
		}

		// Every move name the character can roll — basic, expedition, playbook,
		// cross-playbook, "other" (both the flat list and any custom category groups),
		// love letters, post-death. A superset of actor.items, since basic/expedition
		// moves aren't embedded documents. Sourced from the same snapshot the sheet
		// renders, so a stored reminderMove matches the moveName that rollStat passes when
		// that move is rolled (that's what the echo keys on).
		_woundReminderMoveNames(snapshot) {
			const names = new Set();
			for (const m of _movelistMoves(snapshot?.movelist)) if (m?.name) names.add(m.name);
			return [...names].sort((a, b) => a.localeCompare(b));
		}

		async _onWoundAdd() {
			const snapshot = await this._stonetopCharacter.buildSnapshot();
			return this._openWoundDialog({ isNew: true, moveNames: this._woundReminderMoveNames(snapshot) });
		}

		async _onWoundEdit(id) {
			if (!id) return;
			const snapshot = await this._stonetopCharacter.buildSnapshot();
			return this._openWoundDialog({ isNew: false, wound: this._woundRecord(id), moveNames: this._woundReminderMoveNames(snapshot) });
		}

		// Recover, applied to one wound: "say how you tend to it," then stabilize it —
		// Recover only ever *stabilizes* (clearing any stored requirement); healing is
		// Convalesce. If the GM says it isn't handled yet, cancel and note what's still
		// required on the wound via Edit.
		_onWoundTend(id) {
			if (!id) return;
			const wound = this._woundRecord(id);
			if (!wound) return;
			const label = wound.text || "(unnamed wound)";
			const chatLabel = label;
			// No inputs: "say how" is table narration (said out loud; the trigger line
			// prompts it), and nothing here would persist a typed value. The action is a
			// single confirm — the GM says it's handled, and the wound stabilizes.
			const content = `<form class="stonetop-homestead-dialog stonetop-wound-tend-form">
				<p class="stonetop-homestead-trigger"><em>When you tend to a problematic wound, say how.</em></p>
				<p class="stonetop-wound-tend-target"><i class="fas fa-droplet"></i> <strong>${_esc(label)}</strong></p>
				<p class="stonetop-homestead-note">The GM will say it's taken care of, or tell you what's still required. Stabilizing isn't healing — that takes Convalesce.</p>
			</form>`;

			const stabilize = async () => {
				await this._stonetopCharacter.updateWound(id, { status: "stabilized", requirementNote: "" }, { moveName: "Recover" });
				postMoveToChat(this.actor, "Recover", [{ label: "Wound stabilized", value: chatLabel }]);
				this.render(false);
			};

			new Dialog({
				title: "Recover: tend to a wound",
				content,
				buttons: {
					stabilize: { label: "It's taken care of", callback: stabilize },
					cancel:    { label: "Cancel" },
				},
				default: "stabilize",
				render: bringDialogToFront,
			}, { width: 460, classes: ["dialog", "stonetop", "stonetop-wound-tend-dialog"] }).render(true);
		}

		async _onWoundRemove(id) {
			if (!id) return;
			const wound = this._woundRecord(id);
			const label = wound?.text ? `“${wound.text}”` : "this wound";
			const ok = await Dialog.confirm({
				title: "Remove Wound",
				content: `<p>Remove ${_esc(label)} from the sheet? This deletes it entirely: to keep its fiction as a healed scar instead, edit it and tick “Healed, move to Scars.”</p>`,
				render:  bringDialogToFront,
				options: { classes: ["dialog", "stonetop", "stonetop-remove-wound-dialog"] },
			});
			if (!ok) return;
			await this._stonetopCharacter.removeWound(id);
			this.render(false);
		}

		// Shared add/edit form — the left-rail wound editor (WoundDialog), which groups the
		// record's eight fields into four panels: the wound, its treatment, its lasting
		// effects, and the Make-a-Plan tick boxes. Status/healed are settable there as a
		// manual override; the normal path is move-gated (Recover stabilizes, Convalesce
		// heals → scar). The "Healed, move to Scars" toggle is the manual heal path (the
		// Remove dialog points here to keep a wound's fiction as a scar).
		async _openWoundDialog({ isNew, wound = null, moveNames = [] }) {
			const data = await new WoundDialog({ isNew, wound, moveNames }).promise();
			if (!data) return;
			if (isNew) await this._stonetopCharacter.addWound(data);
			else if (wound?.id) await this._stonetopCharacter.updateWound(wound.id, data);
			this.render(false);
		}

		// Stamp the character with where the player is in creation, so the GM's
		// first-session Welcome roster can show their progress. `state` is one of
		// "picker" (choosing a playbook), "onboarding" (with 1-based step + total),
		// or "exited" (closed mid-creation). Fire-and-forget — a failed write must
		// never interrupt the player's creation flow.
		_setOnboardingState(state, extra = {}) {
			this.actor.setFlag(STONETOP_SCOPE, "onboardingProgress", { state, ...extra })
				.catch(err => console.error("Stonetop | failed to record onboarding progress", err));
		}

		// Drop the progress flag once creation is finished, so the roster stops
		// showing progress for a completed character.
		_clearOnboardingProgress() {
			return this.actor.unsetFlag(STONETOP_SCOPE, "onboardingProgress").catch(() => {});
		}

		async _onNewCharacter(options = {}) {
			// Launched from the player's first-session intro (CharacterCreationDialog),
			// the sheet is still closed — `openSheetWhenDone` asks us to pop it open once
			// the player lands at the end of the flow, so they never face an empty sheet.
			// The in-sheet button leaves it false: the sheet is already on screen.
			const openSheetWhenDone = options.openSheetWhenDone ?? false;
			let sheetOpened = false;
			const openSheetOnce = () => {
				if (!openSheetWhenDone || sheetOpened) return;
				sheetOpened = true;
				this.render(true);
			};

			const openPicker = () => {
				// Did this picker hand off to onboarding? Closing it without a pick means
				// the player backed all the way out, so fall back to opening their sheet.
				let picked = false;
				this._setOnboardingState("picker");
				// Tracked against the character being built: it isn't a document sheet, so
				// nothing else would close it if that character were deleted out from under
				// the player mid-creation. See creation-flow.js.
				trackCreationFlow(new PlaybookPickerDialog(
					async (playbookDoc) => {
						picked = true;
						this._launchOnboarding(playbookDoc, { openSheetOnce, openPicker });
					},
					// Closing the picker without picking is leaving creation entirely.
					{ onClose: () => { if (!picked) { this._setOnboardingState("exited"); openSheetOnce(); } } },
				), this.actor.id).render(true);
			};

			const existingPlaybook = this.actor.system?.playbook?.slug;

			// Resume an interrupted creation straight into onboarding at the saved page.
			// The picked playbook + selections live in client-local storage (not
			// system.playbook) because creation isn't committed until the player
			// finishes — so the character still "has no playbook" until then, which is
			// what the reload sweep in hooks/Ready.js keys off to re-offer creation.
			// We also resume when re-entered from the sheet's own button (no explicit
			// `resume`) for a still-uncommitted character that has saved progress, so a
			// player who closed the walkthrough and clicked "Create Character" again
			// continues where they left off instead of starting over and losing answers.
			if (options.resume || !existingPlaybook) {
				const snap = readOnboardingResume(this.actor);
				const playbookDoc = snap?.playbookUuid ? await fromUuid(snap.playbookUuid) : null;
				if (playbookDoc && snap?.selections) {
					this._launchOnboarding(playbookDoc, {
						openSheetOnce, openPicker,
						initialSelections: snap.selections,
						startAtStep:       snap.stepType ?? null,
					});
					return;
				}
				// A snapshot that can't be used (playbook deleted / re-imported, or no
				// selections) — drop it so a stale entry can't shadow a fresh start, then
				// fall through to a normal pick.
				if (snap) clearOnboardingResume(this.actor);
			}

			if (existingPlaybook) {
				new Dialog({
					title:   game.i18n.localize("stonetop.newCharacter.confirmTitle"),
					content: `<p>${game.i18n.localize("stonetop.newCharacter.confirmContent")}</p>`,
					buttons: {
						cancel: {
							icon:     '<i class="fas fa-times"></i>',
							label:    "Cancel",
						},
						edit: {
							icon:     '<i class="fas fa-edit"></i>',
							label:    "Edit",
							callback: () => this._openEditCharacterOnboarding(),
						},
						reset: {
							icon:     '<i class="fas fa-undo"></i>',
							label:    "New",
							callback: openPicker,
						},
					},
					default: "cancel",
					render: bringDialogToFront,
				}, { classes: ["dialog", "stonetop", "stonetop-new-character-confirm"] }).render(true);
			} else {
				openPicker();
			}
		}

		// Open the guided onboarding for a chosen playbook, wired into the full
		// creation flow: commit on finish, step back to the picker, land on the sheet
		// when done, and keep a resume snapshot so a reload can reopen this page (see
		// _onNewCharacter's `resume`). The heavy snapshot (playbook + selections) goes
		// to cheap client-local storage; only the small page number reaches the actor
		// flag (and only on page change, not per keystroke) for the GM's roster.
		// `initialSelections` / `startAtStep` resume an interrupted creation.
		// Move name → count owned by the actor. Threaded into onboarding so a sub-choice
		// cap that grows with a move (the Blessed's sacred-pouch remarkable traits, +1 per
		// Big Magic) is correct when re-opening onboarding after taking that move.
		_ownedMoveCounts() {
			return this._stonetopCharacter.ownedMoveCounts();
		}

		// Open the standalone sacred-pouch (possession choiceGroups) editor. `addOnly`
		// restricts it to the just-freed remarkable-trait slot (the level-up surface);
		// the default full editor (gear-tab pencil) exposes flavor + all traits.
		_openPossessionChoices(possessionSlug, { addOnly = false } = {}) {
			if (!possessionSlug) return;
			new PossessionChoicesDialog(
				this._stonetopCharacter,
				possessionSlug,
				{ onDone: () => this.render(false), addOnly },
			).render(true);
		}

		// After gaining a move, auto-open the possession editor if that move just freed a
		// sub-choice slot (a Blessed taking Big Magic → an additional remarkable trait).
		// Add-only: the player adds just the new trait, not re-edit the whole pouch.
		async _maybeOpenPossessionChoicesForMove(moveName) {
			const slug = await this._stonetopCharacter.possessionWithOpenChoiceFor(moveName);
			if (slug) this._openPossessionChoices(slug, { addOnly: true });
		}

		_launchOnboarding(playbookDoc, { openSheetOnce, openPicker, initialSelections = null, startAtStep = null } = {}) {
			const saveResume = info => writeOnboardingResume(this.actor, {
				playbookUuid: playbookDoc.uuid,
				stepType:     info.stepType,
				selections:   info.selections,
			});
			// Tracked against the character being built (see openPicker, and creation-flow.js).
			trackCreationFlow(new CharacterOnboardingDialog(
				playbookDoc,
				async (selections) => {
					await this._applyPlaybookSelections(playbookDoc, selections);
					await this._clearOnboardingProgress();
					clearOnboardingResume(this.actor);
					// A finished character belongs on the village roster, however they were
					// made — the first-session guide, the sidebar picker, or this sheet's own
					// "Create Character" button. Last, after the character is committed, so
					// the row points at a sheet that is actually filled in. Only the
					// completion callback files them: re-opening onboarding to EDIT a
					// finished character runs a different path (_openEditCharacterOnboarding),
					// so a GM who takes a departed player off the roster keeps them off.
					await this._addToSteadingRoster();
				},
				{
					initialSelections,
					startAtStep,
					ownedMoveCounts: this._ownedMoveCounts(),
					onBack: openPicker,
					onSave: async (selections) => {
						await this._applyPlaybookSelections(playbookDoc, selections);
					},
					// Finishing, saving-and-closing, or closing onboarding all land the
					// player on their now-populated sheet. Back-navigation to the picker
					// suppresses this (see CharacterOnboardingDialog._goBack).
					onClose: openSheetOnce,
					// Page change: update the GM's "page X of Y" (small flag) and snapshot.
					// Stamp the chosen playbook onto the flag too — it lives only in the
					// player's local resume snapshot otherwise, which the GM can't read, so
					// the Welcome roster has no other way to name the in-progress playbook.
					onProgress: info => {
						this._setOnboardingState("onboarding", { step: info.step + 1, total: info.total, playbook: playbookDoc.name });
						saveResume(info);
					},
					// Every edit (debounced): just the local snapshot — no network — so a
					// dropped connection mid-page still leaves the writing recoverable.
					onLiveSave: saveResume,
					// Closing mid-creation keeps the snapshot so a reload can resume here.
					onExit: info => {
						this._setOnboardingState("exited", { playbook: playbookDoc.name });
						saveResume(info);
					},
				},
			), this.actor.id).render(true);
		}

		// File the freshly-finished character on the steading's Player Characters roster
		// and say so, since the roster is on the steading sheet rather than in front of the
		// player who just finished. Silent when there's nothing to report: already listed
		// (a re-run of creation), no steading in the world yet, or a world where the player
		// can't write it. Never throws — the helper reports its own failures to the console.
		async _addToSteadingRoster() {
			const added = await addCharacterToSteadingPlayers(this.actor);
			if (!added) return;
			const steading = getStonetopSteadingActor();
			ui.notifications?.info?.(`${this.actor.name} joins the people of ${steading?.name || "Stonetop"}.`);
		}

		async _openEditCharacterOnboarding(options = {}) {
			const playbookUuid = this.actor.system?.playbook?.uuid;
			if (!playbookUuid) return;
			const playbookDoc = await fromUuid(playbookUuid);
			if (!playbookDoc) return;

			// Track live progress for the GM's Welcome roster only while creation is
			// still unfinished — re-opening onboarding to tweak a completed character
			// shouldn't make the roster claim they're mid-creation again.
			const selections = this._readSelectionsFromActor(playbookDoc);
			const trackProgress = CharacterOnboardingDialog.hasIncompleteQuestions(playbookDoc, selections);

			// Note: _applyPlaybookSelections updates the prototype token image but not
			// any already-placed tokens; those are left for the GM to sync manually.
			new CharacterOnboardingDialog(
				playbookDoc,
				async (sel) => {
					await this._applyPlaybookSelections(playbookDoc, sel);
					if (trackProgress) await this._clearOnboardingProgress();
				},
				{
					initialSelections: selections,
					startAtStep: options.startAtStep ?? null,
					ownedMoveCounts: this._ownedMoveCounts(),
					onSave: async (sel) => {
						await this._applyPlaybookSelections(playbookDoc, sel);
					},
					...(trackProgress
						? {
							onProgress: info => this._setOnboardingState("onboarding", { step: info.step + 1, total: info.total }),
							onExit: () => this._setOnboardingState("exited"),
						}
						: {}),
				},
				// no onBack ? back button is hidden
			).render(true);
		}

		_logOnboardingQuestionDiagnostics(diagnostics = null) {
			if (!diagnostics || !console?.groupCollapsed) return;
			const actorName = this.actor?.name ?? "(unknown actor)";
			const incomplete = diagnostics.incomplete;
			console.groupCollapsed(
				`[Stonetop] Background question diagnostics: ${actorName} (${incomplete.length} incomplete)`,
			);
			console.info("Playbook:", diagnostics.playbook);
			console.info("First incomplete:", diagnostics.firstIncomplete ?? "none");
			if (incomplete.length) {
				console.table(incomplete.map(step => ({
					index: step.index,
					stepType: step.stepType,
					label: step.label,
					details: JSON.stringify(step.details),
				})));
			} else {
				console.info("All resume/question steps are complete.");
			}
			console.debug("All question steps:", diagnostics.steps);
			console.groupEnd();
		}

		// Restore each "either X OR Y" starting-move pick (e.g. the Heavy's Armored OR
		// Uncanny Reflexes) by the owned move's NAME — its compendium id isn't knowable
		// from the actor alone. The onboarding dialog swaps the name for the id once its
		// move list loads, so the moves step shows the choice already made rather than
		// forcing a re-pick. Keyed by choice-group index.
		_restoreOwnedMoveChoices(playbookDoc) {
			const groups = playbookDoc?.flags?.stonetop?.moves?.choices ?? [];
			// Its own walk, not the render memo: this runs from the onboarding restore rather
			// than from getData, so there may be no current render to share one with.
			const ownedNames = ownedMoveNames(this.actor);
			const picks = {};
			groups.forEach((group, i) => {
				const owned = (group.options ?? []).find(name => ownedNames.has(name));
				if (owned) picks[i] = owned;
			});
			return picks;
		}

		_readSelectionsFromActor(playbookDoc = null) {
			const f  = resolvedFlags(this.actor);

			// Major arcanum: use the saved flag if present, otherwise infer from owned arcana
			// cross-referenced with the background's allowed list.
			const bgSlug       = f.background?.selected ?? "";
			const backgrounds  = playbookDoc?.flags?.stonetop?.backgrounds ?? [];
			const bg           = backgrounds.find(b => b.slug === bgSlug);
			const allowedMajors = new Set(bg?.majorArcana ?? []);
			let majorArcanum   = f.arcana?.major ?? "";
			if (!majorArcanum && allowedMajors.size) {
				const ownedSlugs = f.arcana?.owned ?? [];
				majorArcanum = ownedSlugs.find(s => allowedMajors.has(s)) ?? "";
			}

			// Ranger animal companion: the type's mandatory trait (Bird/Critter "tiny",
			// Brute "tough", Predator "fierce", Steed "large") is auto-included and never
			// counts toward "pick N more", so keep it out of the editable selection — it's
			// re-added for display and is stat-neutral. Stripping here also self-heals any
			// legacy character that stored it as one of its picks.
			const acType      = f.animalCompanion?.type ?? "";
			const acTypes     = playbookDoc?.flags?.stonetop?.animalCompanion?.types ?? [];
			const acMandatory = acTypes.find(t => t.slug === acType)?.mandatoryTrait ?? null;
			const acTraits    = [...(f.animalCompanion?.traits ?? [])]
				.filter(t => !acMandatory || t !== acMandatory);

			return {
				backgroundSlug:  f.background?.selected ?? "",
				instinctValue:   f.instinct?.selected ?? "",
				appearance:      foundry.utils.deepClone(f.appearance?.selected ?? {}),
				originRegion:    f.origin?.selected ?? "",
				name:            this.actor.name ?? "",
				stats: (s => Object.fromEntries(
					["str","dex","con","int","wis","cha"].map(k => [k, k in s ? s[k] : null])
				))(f.onboardingStats ?? {}),
				possessions:     [...(f.possessions?.selected ?? [])],
				possessionChoices: foundry.utils.deepClone(f.possessions?.subChoices ?? {}),
				possessionChoiceTexts: foundry.utils.deepClone(f.possessions?.choiceTexts ?? {}),
				customPossession: f.possessions?.custom?.[0]?.label ?? "",
				moves:           [], // compendium IDs are hard to recover; player re-picks
				moveChoices:     this._restoreOwnedMoveChoices(playbookDoc),
				invocations:     [...(f.invocations?.selected ?? [])],
				initiates:       Object.entries(f.background?.choices ?? {})
				                       .filter(([, v]) => v === true)
				                       .map(([k]) => k),
				initiateDetails: foundry.utils.deepClone(f.initiateDetails ?? {}),
				crew: {
					name:     f.crew?.name ?? "",
					tags:     [...(f.crew?.tags ?? [])],
					instinct: f.crew?.instinct ?? "",
					cost:     f.crew?.cost ?? "",
				},
				animalCompanion: {
					type:     acType,
					kind:     f.animalCompanion?.kind ?? "",
					traits:   acTraits,
					name:     f.animalCompanion?.name ?? "",
					instinct: f.animalCompanion?.instinct ?? "",
					cost:     f.animalCompanion?.cost ?? "",
				},
				backgroundChoices: foundry.utils.deepClone(f.moves?.backgroundAnswers ?? {}),
				backgroundSetup: {
					choices:        foundry.utils.deepClone(f.background?.setupChoices ?? {}),
					texts:          foundry.utils.deepClone(f.background?.setupTexts ?? {}),
					neighborTraits: foundry.utils.deepClone(f.background?.neighborTraits ?? {}),
					neighborPicks:  foundry.utils.deepClone(f.background?.neighborPicks ?? {}),
				},
				markedActions:  [...(f.background?.markedActions ?? [])],
				lore: {
					picks: foundry.utils.deepClone(f.lore?.counts ?? {}),
					texts: foundry.utils.deepClone(f.lore?.texts ?? {}),
				},
				arcana: {
					major:      majorArcanum,
					minorDraw:  [...(f.arcana?.minorDraw ?? [])],
					minorRoles: foundry.utils.deepClone(
						f.arcana?.minorRoles ?? { mastered: "", found: "", lead: "" }
					),
					// Stamp majorMarksFor to the restored major so getData keeps these marks
					// instead of re-defaulting them (it only resets when the major changes).
					majorMarks:    [...(f.arcana?.majorMarks ?? [])],
					majorMarksFor: majorArcanum,
				},
			};
		}

		_backgroundSetupNeighbors(backgroundSetup, selections) {
			const out = [];
			// Playbook backgrounds author a neighbor's place of origin as `origin` and
			// their trait as `trait`; the steading's Neighbors table stores these under
			// `home` and `traits` (see _onNeighborChange / the neighbors partial), so map
			// them across — the location belongs in the Home column, not Occupation.
			for (const neighbor of (backgroundSetup?.neighbors ?? [])) {
				if (!neighbor.name) continue;
				out.push({
					name: neighbor.name,
					home: neighbor.origin ?? "",
					traits: neighbor.traitKey
						? selections.backgroundSetup?.neighborTraits?.[neighbor.traitKey]?.trim() ?? ""
						: neighbor.trait ?? "",
					checked: true,
				});
			}
			for (const choice of (backgroundSetup?.neighborChoices ?? [])) {
				const selected = new Set(selections.backgroundSetup?.neighborPicks?.[choice.key] ?? []);
				for (const option of (choice.options ?? [])) {
					if (!selected.has(option.value)) continue;
					out.push({
						name: option.name ?? option.value,
						home: option.origin ?? "",
						traits: option.trait ?? "",
						checked: true,
					});
				}
			}
			return out;
		}

		/**
		 * Where a neighbor this background names already sits on the roster, or -1.
		 *
		 * An exact name-and-Home match first; failing that, someone of the same name with no
		 * Home recorded at all — a hand-added "Ennis" with an empty Home is the Ennis of
		 * Marshedge the background means, and the fill below is what finally writes his
		 * origin down. Two Ennises with two different Homes stay two people.
		 *
		 * A pointer row whose NPC has since been deleted is passed over, and that is not an
		 * oversight: it keys off its cached name with no Home ("ennis|"), so it would win the
		 * name-only match — but there is nothing left to fill in. Its Home and Traits live on
		 * an actor that is gone, and the roster renders it as unresolved either way, so
		 * matching it would quietly swallow the neighbor. Better to list a live one beside it.
		 */
		_findBackgroundNeighbor(neighbors, addition) {
			const fillable = neighbor => !isActorRow(neighbor) || !!personRowActor(neighbor);
			const key = personRowKey(addition);
			const exact = neighbors.findIndex(n => fillable(n) && personRowKey(n) === key);
			if (exact >= 0) return exact;
			const nameOnly = `${addition.name.trim().toLowerCase()}|`;
			return neighbors.findIndex(n => fillable(n) && personRowKey(n) === nameOnly);
		}

		/**
		 * A neighbor this background names is already on the roster: don't add them twice,
		 * just fill in whatever the roster left blank and tick them as known. Actor-backed
		 * rows keep Home and Traits on the NPC, so the fill has to go there — writing them
		 * onto the pointer row would store fields nothing ever reads back. Skipped without
		 * complaint when the current user can't update that NPC (a player has OBSERVER on
		 * roster NPCs, not OWNER): the person is already listed, which is the part that
		 * matters.
		 *
		 * Mutates `neighbors[idx]` in place — the caller rebases the whole array once.
		 */
		async _fillExistingBackgroundNeighbor(neighbors, idx, addition) {
			const row = neighbors[idx];
			const actor = personRowActor(row);
			if (!actor) {
				// Legacy plain-text row: its own fields are what the roster renders. Only ever a
				// row with no actor pointer at all — _findBackgroundNeighbor refuses to match a
				// pointer row whose NPC was deleted, which would land here and write fields the
				// unresolved branch of resolvePersonRow never reads back.
				neighbors[idx] = {
					...row,
					home: addition.home || row.home || "",
					traits: addition.traits || row.traits || "",
					checked: true,
				};
				return;
			}
			const update = {};
			if (addition.home   && !String(actor.system?.home   ?? "").trim()) update["system.home"]   = addition.home;
			if (addition.traits && !String(actor.system?.traits ?? "").trim()) update["system.traits"] = addition.traits;
			if (Object.keys(update).length && actor.isOwner) {
				try { await actor.update(update); }
				catch (err) { console.warn("Stonetop | Could not fill in background details for", actor.name, err); }
			}
			neighbors[idx] = { ...row, checked: true };
		}

		/**
		 * File the neighbors a background names (the Ranger's Wide Wanderer names five) on the
		 * steading's roster, as the NPC actors every other roster row is backed by.
		 *
		 * Gated on the ACTOR_CREATE permission rather than on isGM: this system grants that to
		 * players once per world (Ready.js#_ensurePlayerActorCreationGrant) precisely so the
		 * actor-backed roster works for them, so whoever is at the keyboard normally creates
		 * the NPCs right here. The plain-text fallback is for a world whose GM has since
		 * revoked the permission — the row still renders (resolvePersonRow has a legacy branch)
		 * and a GM's client converts it, live on the next steading write or at their next load.
		 * See steading-people.js#onSteadingPeopleUpdate / #migrateSteadingPeople.
		 */
		async _applyBackgroundNeighbors(backgroundSetup, selections) {
			const additions = this._backgroundSetupNeighbors(backgroundSetup, selections);
			if (!additions.length) return;
			const steadingActor = getStonetopSteadingActor();
			if (!steadingActor) {
				ui.notifications?.warn?.("No Stonetop steading actor was found, so background neighbors were not added.");
				return;
			}
			const stonetopSteading = steadingActor.typedActor ?? new StonetopSteading(steadingActor);
			const liveNeighbors = () => {
				const rows = (resolvedFlagProperty(steadingActor, "steading") ?? {}).neighbors;
				return Array.isArray(rows) ? rows : STEADING_DEFAULTS.neighbors;
			};
			const neighbors = foundry.utils.deepClone(liveNeighbors());
			const canCreateActors = Actor.canUserCreate?.(game.user) ?? !!game.user?.isGM;
			// What this pass changed, addressed by WHO each row is rather than by where it sat:
			// see rebasePersonRows. Every branch below awaits, and onboarding is exactly when a
			// second player is likely to be doing the same thing to the same roster.
			const filled = new Map();
			const added = [];

			for (const addition of additions) {
				if (!addition.name?.trim()) continue;
				const idx = this._findBackgroundNeighbor(neighbors, addition);
				if (idx >= 0) {
					const identity = personRowIdentity(neighbors[idx]);
					await this._fillExistingBackgroundNeighbor(neighbors, idx, addition);
					// A one-entry queue (see rebasePersonRows), overwritten rather than appended:
					// two additions naming the same person both resolve to that one roster row, so
					// the later fill is the whole of what that row becomes.
					filled.set(identity, [neighbors[idx]]);
					continue;
				}
				if (!canCreateActors) { neighbors.push(addition); added.push(addition); continue; }
				const actor = await createPersonNpc("neighbors", addition).catch(err => {
					console.error("Stonetop | Could not create the NPC for background neighbor", addition.name, err);
					return null;
				});
				// Creation failed: fall back to the text row so the neighbor still reaches the
				// roster, and let the load-time sweep retry the conversion.
				const row = actor
					? { uuid: actor.uuid, id: actor.id, name: actor.name, checked: true }
					: addition;
				// Kept on the working copy too, so a later addition of the same name matches this
				// one instead of making a second NPC for them.
				neighbors.push(row);
				added.push(row);
			}
			await stonetopSteading.setFlags({ neighbors: rebasePersonRows(liveNeighbors(), filled, added) });
		}

		async _applyPlaybookSelections(playbookDoc, selections) {
			const slug = playbookDoc.system?.slug ?? "";
			const updates = {
				"system.playbook": { uuid: playbookDoc.uuid, name: playbookDoc.name, slug },
				...this._playbookHpInit(playbookDoc),
			};
			if (slug && isDefaultImg(this.actor.img)) {
				const icon = playbookIconPath(slug);
				updates.img = icon;
				updates["prototypeToken.texture.src"] = icon;
			}
			const statFlagObj = {};
			for (const [key, value] of Object.entries(selections.stats ?? {})) {
				if (value !== null && value !== undefined) {
					updates[`system.stats.${key}.value`] = Number(value);
					statFlagObj[key] = Number(value);
				}
			}
			updates[`flags.${STONETOP_SCOPE}.onboardingStats`] = statFlagObj;
			await this.actor.update(updates);

			// Background must be saved before ensureStartingMoves reads it.
			if (selections.backgroundSlug) {
				await this._stonetopCharacter.background.selectBackground(selections.backgroundSlug);
			}
			await this._stonetopCharacter.ensureStartingMoves();

			const { flagUpd, selectedBackground, backgroundSetup } =
				await this._applyCommonSelections(playbookDoc, selections);

			// Apply-specific: create owned possession items, add moves, bg extras.
			const rawPossessions = playbookDoc.flags?.stonetop?.specialPossessions;
			if (rawPossessions) {
				const slugsToSelect = [
					...(rawPossessions.preselected ?? []),
					...(selections.possessions ?? []),
				];
				for (const slug of slugsToSelect) {
					await this._stonetopCharacter.selectPossession(slug);
				}
				// "Pick N" bundles (Weapons of war, Symbol of authority…): replace the
				// chosen sub-options wholesale, but only for possessions actually selected.
				// Replacing (not adding) drops picks the player deselected on a re-run.
				const selectedSet = new Set(slugsToSelect);
				for (const [possessionSlug, choiceSlugs] of Object.entries(selections.possessionChoices ?? {})) {
					if (!selectedSet.has(possessionSlug)) continue;
					await this._stonetopCharacter.setPossessionSubChoices(possessionSlug, choiceSlugs);
				}
				// Fill-in blanks written into a sub-option (the Would-Be Hero's personal token),
				// persisted for the selected possessions the same way as their picks above.
				for (const [key, value] of Object.entries(selections.possessionChoiceTexts ?? {})) {
					const [possessionSlug, choiceSlug] = key.split(":");
					if (!selectedSet.has(possessionSlug)) continue;
					if (value?.trim()) await this._stonetopCharacter.setPossessionChoiceText(possessionSlug, choiceSlug, value.trim());
				}
				// Write-in "something else (discuss with GM)" possession. Replace rather
				// than append so re-running onboarding doesn't duplicate it.
				await this._stonetopCharacter.setCustomPossessions(
					selections.customPossession?.trim() ? [selections.customPossession] : [],
				);
			}
			for (const compendiumId of (selections.moves ?? [])) {
				await this._stonetopCharacter.addMove(compendiumId, { skipIfOwned: true });
				// A stat-increase move picked at creation (the Would-Be Hero's Improved Stat)
				// carries a "+1 to which stat?" choice made in onboarding — apply it against the
				// owned instance (freshly added or already present), bumping the chosen stat and
				// recording the pick exactly as the level-up path does. This must NOT gate on
				// addMove's return: on a re-run the move is already owned (addMove returns null)
				// and the base-stat write above just reset the stat, so gating there would drop
				// the +1. applyCreationStatChoice is idempotent (base reset first, +1 capped).
				await this._stonetopCharacter.applyCreationStatChoice(
					compendiumId, selections.moveStatChoices?.[compendiumId],
				);
			}
			// "Either X OR Y" starting-move choices (e.g. the Heavy's Armored OR
			// Uncanny Reflexes) — ensureStartingMoves skips these, so add the picks and
			// drop any previously-chosen alternative so re-running doesn't leave both.
			await this._stonetopCharacter.applyStartingMoveChoices(
				playbookDoc.flags?.stonetop?.moves?.choices ?? [],
				selections.moveChoices ?? {},
			);
			for (const slug of (selectedBackground?.extraPossessions ?? [])) {
				await this._stonetopCharacter.selectPossession(slug);
			}
			for (const choice of (backgroundSetup?.choices ?? [])) {
				const value = selections.backgroundSetup?.choices?.[choice.key];
				if (!value) continue;
				if (choice.apply === "move") {
					await this._stonetopCharacter.addPlaybookMoveByName(playbookDoc.name, value);
				} else if (choice.apply === "possession") {
					await this._stonetopCharacter.selectPossession(value);
				}
			}
			for (const arcanum of (backgroundSetup?.arcana ?? [])) {
				if (!arcanum.slug) continue;
				await this._stonetopCharacter.addArcanum(arcanum.slug);
				if (arcanum.identify) await this._stonetopCharacter.identifyArcanum(arcanum.slug);
				for (const box of (arcanum.boxes ?? [])) {
					await this._stonetopCharacter.setArcanumBoxChecked(
						arcanum.slug, box.context ?? "front", Number(box.index ?? 0), true,
					);
				}
			}
			const existingSetupResources = resolvedFlagProperty(this.actor, "background.setupResources") ?? {};
			const backgroundSetupResources = {};
			for (const resource of (backgroundSetup?.resources ?? [])) {
				if (!resource.key) continue;
				backgroundSetupResources[resource.key] = existingSetupResources[resource.key] ?? resource.value ?? 0;
			}
			if (Object.keys(backgroundSetupResources).length) {
				flagUpd[`flags.${STONETOP_SCOPE}.background.setupResources`] = backgroundSetupResources;
			}

			// Seeker arcana
			const masteredMinor = selections.arcana?.minorRoles?.mastered ?? null;
			const foundMinor    = selections.arcana?.minorRoles?.found    ?? null;
			const leadMinor     = selections.arcana?.minorRoles?.lead     ?? null;
			for (const slug of [selections.arcana?.major, masteredMinor, foundMinor].filter(Boolean)) {
				await this._stonetopCharacter.addArcanum(slug);
				await this._stonetopCharacter.identifyArcanum(slug);
			}
			// "You've begun to unlock the mysteries of your major arcanum" — mark the ○
			// circles / □ tasks the player ticked in onboarding onto the actual card
			// (majorMarks holds "<context>:<index>" keys matching the sheet's boxes).
			if (selections.arcana?.major) {
				for (const key of (selections.arcana.majorMarks ?? [])) {
					const [context, indexStr] = String(key).split(":");
					const index = Number(indexStr);
					if (context && Number.isInteger(index)) {
						await this._stonetopCharacter.setArcanumBoxChecked(selections.arcana.major, context, index, true);
					}
				}
			}
			// The Seeker's mastered minor begins play already realized: fully unlock it so it
			// carries its back item and shows its back to the owner. The carried side and back
			// visibility now follow the unlock state (the manual flip was retired), so identify
			// alone would leave a mastered card reading as a locked, front-only curio.
			if (masteredMinor) await this._stonetopCharacter.masterArcanum(masteredMinor);
			// The Lead minor isn't in hand yet: add it as a lead card (owned but un-identified)
			// so it shows on the arcana tab as a placeholder the player can later mark discovered.
			if (leadMinor) await this._stonetopCharacter.addLead(leadMinor);

			if (Object.keys(flagUpd).length) await this.actor.update(flagUpd);
			await this._applyBackgroundNeighbors(backgroundSetup, selections);
			this.render(false);
		}

		// Core of _applyPlaybookSelections (used for both "Save" and final apply).
		// Handles character-method calls (instinct, appearance, origin, name),
		// background-setup flag writes, initiates, and lore.
		// Returns { flagUpd, selectedBackground, backgroundSetup } for callers to extend.
		async _applyCommonSelections(playbookDoc, selections) {
			if (selections.instinctValue) {
				await this._stonetopCharacter.instinct.select(selections.instinctValue);
			}
			for (const [lineIdx, value] of Object.entries(selections.appearance ?? {})) {
				if (value?.trim()) await this._stonetopCharacter.appearance.select(Number(lineIdx), value.trim());
			}
			if (selections.originRegion) {
				await this._stonetopCharacter.origin.select(selections.originRegion);
			}
			if (selections.name?.trim()) {
				await this._stonetopCharacter.updateName(selections.name.trim());
			}

			const selectedBackground = (playbookDoc.flags?.stonetop?.backgrounds ?? [])
				.find(bg => bg.slug === selections.backgroundSlug);
			const backgroundSetup = selectedBackground?.setup ?? null;
			if (selectedBackground) {
				const backgroundSetupTexts    = {};
				const backgroundSetupChoices  = {};
				const backgroundNeighborTraits = {};
				const backgroundNeighborPicks  = {};
				for (const text of (backgroundSetup?.texts ?? [])) {
					const value = selections.backgroundSetup?.texts?.[text.key]?.trim();
					if (value) backgroundSetupTexts[text.key] = value;
				}
				for (const choice of (backgroundSetup?.choices ?? [])) {
					const value = selections.backgroundSetup?.choices?.[choice.key];
					if (value) backgroundSetupChoices[choice.key] = value;
				}
				for (const neighbor of (backgroundSetup?.neighbors ?? [])) {
					const value = selections.backgroundSetup?.neighborTraits?.[neighbor.traitKey]?.trim();
					if (neighbor.traitKey && value) backgroundNeighborTraits[neighbor.traitKey] = value;
				}
				for (const choice of (backgroundSetup?.neighborChoices ?? [])) {
					const values = selections.backgroundSetup?.neighborPicks?.[choice.key] ?? [];
					if (values.length) backgroundNeighborPicks[choice.key] = values;
				}
				// Beast-Bonded marked actions, filtered to the selected background's list.
				const markableSlugs = new Set((selectedBackground.markableActions?.options ?? []).map(o => o.slug));
				const backgroundMarkedActions = (selections.markedActions ?? []).filter(s => markableSlugs.has(s));
				await this._batchFlagSetOrUnset({
					"background.setupChoices":   backgroundSetupChoices,
					"background.setupTexts":     backgroundSetupTexts,
					"background.neighborTraits": backgroundNeighborTraits,
					"background.neighborPicks":  backgroundNeighborPicks,
					"background.markedActions":  backgroundMarkedActions,
				});
			}

			const backgroundAnswers = {};
			for (const choice of (selectedBackground?.moveChoices ?? [])) {
				const key = choice.move ?? choice.slug ?? choice.label ?? "";
				if (!key) continue;
				const answer = selections.backgroundChoices?.[key];
				if (answer?.value) backgroundAnswers[key] = answer;
			}

			for (const slug of (selections.initiates ?? [])) {
				await this._stonetopCharacter.background.addChoice({ slug, isChecked: true });
			}
			for (const [key, count] of Object.entries(selections.lore?.picks ?? {})) {
				const [sectionSlug, optionSlug] = key.split(":");
				if (count > 0) await this._stonetopCharacter.setLoreOptionCount(sectionSlug, optionSlug, count);
			}
			for (const [key, value] of Object.entries(selections.lore?.texts ?? {})) {
				const [sectionSlug, optionSlug] = key.split(":");
				if (value?.trim()) await this._stonetopCharacter.setLoreOptionText(sectionSlug, optionSlug, value.trim());
			}

			const flagUpd = {};
			const f = key => `flags.${STONETOP_SCOPE}.${key}`;
			if (Object.keys(backgroundAnswers).length)                flagUpd[f("moves.backgroundAnswers")] = backgroundAnswers;
			if (selections.invocations?.length)                       flagUpd[f("invocations.selected")]    = selections.invocations;
			// Initiate onboarding owns only each initiate's pronoun + per-row choices.
			// Write those with dotted paths (Foundry merges, leaving sibling keys intact)
			// so a hand-edit of the same initiate's moves / notes / gear / stat overrides
			// — which share the initiateDetails.<slug> namespace — is never clobbered.
			for (const [slug, det] of Object.entries(selections.initiateDetails ?? {})) {
				if (det?.pronoun != null) flagUpd[f(`initiateDetails.${slug}.pronoun`)] = det.pronoun;
				if (det?.rows)            flagUpd[f(`initiateDetails.${slug}.rows`)]    = det.rows;
			}
			if (selections.crew?.instinct || selections.crew?.cost || selections.crew?.tags?.length || selections.crew?.name) {
				flagUpd[f("crew.name")]     = selections.crew.name?.trim() ?? "";
				// Store only the chosen tags; the background-auto tag is derived from the
				// active background at render (see _buildFollowersData), so baking it in
				// here would strand a stale copy if the background later changes.
				flagUpd[f("crew.tags")]     = [...selections.crew.tags];
				flagUpd[f("crew.instinct")] = selections.crew.instinct ?? "";
				flagUpd[f("crew.cost")]     = selections.crew.cost     ?? "";
			}
			if (selections.animalCompanion?.type) {
				const ac = selections.animalCompanion;
				flagUpd[f("animalCompanion.type")]     = ac.type;
				flagUpd[f("animalCompanion.kind")]     = ac.kind?.trim() ?? "";
				flagUpd[f("animalCompanion.traits")]   = ac.traits;
				flagUpd[f("animalCompanion.instinct")] = ac.instinct ?? "";
				flagUpd[f("animalCompanion.cost")]     = ac.cost     ?? "";
				if (ac.name?.trim()) flagUpd[f("animalCompanion.name")] = ac.name.trim();
			}
			if (selections.arcana?.major)            flagUpd[f("arcana.major")]      = selections.arcana.major;
			if (selections.arcana?.minorDraw?.length) flagUpd[f("arcana.minorDraw")] = selections.arcana.minorDraw;
			if (selections.arcana?.minorRoles)        flagUpd[f("arcana.minorRoles")] = selections.arcana.minorRoles;
			if (selections.arcana?.majorMarks?.length) flagUpd[f("arcana.majorMarks")] = selections.arcana.majorMarks;

			return { flagUpd, selectedBackground, backgroundSetup };
		}

		// Builds a single actor.update() from a {flagKey: valueObj} map.
		// Each entry is set when the object is non-empty, unset otherwise.
		async _batchFlagSetOrUnset(entries) {
			const upd = {};
			for (const [key, obj] of Object.entries(entries)) {
				if (Object.keys(obj).length) {
					upd[`flags.${STONETOP_SCOPE}.${key}`] = obj;
				} else {
					const [updKey, val] = deletionEntry(`flags.${STONETOP_SCOPE}.${key}`);
					upd[updKey] = val;
				}
			}
			if (Object.keys(upd).length) await this.actor.update(upd);
		}
	};
}
