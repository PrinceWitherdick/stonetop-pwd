import { StonetopSteading, IMPROVEMENT_CATEGORIES, STEADING_DEFAULTS, improvementRequirementsMet, HERD_SURPLUS_PER, WEAPONS_SEASON_STEP, IMPROVEMENT_DEFINITIONS } from "./StonetopSteading.js";
import { improvementRequirementCount } from "../../utils/improvement-def.js";
import {rollStat, sign, postSeasonsRollPrompt, resultsLegendHtml} from "../../utils/roll-engine.js";
import {SteadingLedger} from "./SteadingLedger.js";
import {TIER_KEYS} from "../../utils/move-results.js";
import {prepareMoveHoverBody} from "../../utils/move-hover.js";
import {openLedgerDialog} from "../../utils/ledger-dialog.js";
import {wireTabSearch} from "../../utils/tab-search.js";
import {injectHeaderToggle} from "../../utils/sheet-chrome.js";
import {escHtml} from "../../utils/strings.js";
import {CUSTOM_ASSET_VALUE, wireCustomAssetSelect} from "../../utils/requisition-asset.js";
import {postMoveToChat} from "../../utils/chat.js";
import {AddSteadingMemberDialog} from "../../dialogs/AddSteadingMemberDialog.js";
import {addPersonToSteading, personFieldPath, isActorRow, personRowActor, usedPersonPortraits, HOME_STONETOP} from "./steading-people.js";
import {PERSON_DEFAULT_IMG} from "../../utils/person-portrait.js";
import {openNpcNotesDialog} from "./npc-notes-dialog.js";
import {openReturnTriumphant} from "./return-triumphant.js";
import {openInnGathering} from "./inn-gathering.js";
import {openWinterDebtDialog, winterConsequencesHtml, applyWinterShortfall} from "./winter-debt.js";
import {autumnHarvest, winterConsumption, seasonalYields, militiaTactics, builtOnTheFields, MILITIA_SEASON_STEP} from "./season-effects.js";
import {openPeoplePortraitPicker} from "./PeopleGalleryDialog.js";
import {STONETOP_SCOPE, StonetopFlags} from "../character/StonetopFlags.js";
import {SpecialItemPickerDialog} from "../character/dialogs/SpecialItemPickerDialog.js";
import {CharacterInventory} from "../character/CharacterInventory.js";
import {SPECIAL_ITEM_CATALOG} from "../../data/special-items.js";
import {getRollStatChipsSetting, getOpenSheetsInEditMode, getHoverDescriptionSetting, getSidebarCollapsed, setSidebarCollapsed, getAskRollModeEachRollSetting, isClassicLayout, layoutClasses, stampLayoutClass} from "../../settings.js";
import {applyLabelTooltips} from "../../utils/label-tooltips.js";
import {wireSidebarToggle} from "../../utils/sidebar-toggle.js";
import {promptRoll, normalizeRollMode} from "../../dialogs/RollDialog.js";
import {wrapStonetopGlyphsInEl} from "../../utils/glyphs.js";
import {mountTabRail} from "../../utils/tab-rail.js";
import {mountScrollFrost} from "../../utils/scroll-frost.js";
import {withSheetSizeMemory} from "../../utils/sheet-size.js";
import {StonetopAutocomplete} from "../../utils/autocomplete.js";
import {makeColumnsResizable} from "../../utils/resizable-columns.js";
import {makeColumnsSortable} from "../../utils/sortable-columns.js";
import {withSectionEditing} from "../../utils/section-editing.js";
import {STEADING_IMPROVEMENT_DRAG_TYPE} from "../../journal/steading-improvement-cards.js";
import {ImprovementBuilderDialog, steadingImprovementSaver} from "../../dialogs/ImprovementBuilderDialog.js";
import {PLACE_OF_INTEREST_DRAG_TYPE} from "../../hooks/PlaceOfInterestDrop.js";
import {getDragEventData, imagePopout, imagePopoutTitle} from "../../utils/foundry-compat.js";
import {wireCardDropZone} from "../../utils/card-drop-zone.js";
import {postSeasonsChangeReminder, seasonIconSrc, seasonLabel} from "../../seasons/seasons-change-reminders.js";
import {recordSeasonsChange, yearLabel} from "../../seasons/seasons-chronicle.js";
import {readCurrentSeason, recordCurrentSeason, currentSeasonView, readCurrentYear, seasonStampParts} from "../../seasons/current-season.js";
import {readCurrentWeather, currentWeatherView} from "../../seasons/current-weather.js";
import {openSeasonPicker} from "../../seasons/season-picker.js";
import {SEASONAL_GAINS} from "../../dialogs/spring-burst-data.js";
import {addStonetopSteadingButton} from "../../utils/world.js";
import {SETTLEMENTS} from "../../data/settlements.js";
import {relationshipRow, wireRelationshipTable} from "../../utils/relationship-hearts.js";
import {wireAvatarPreview, removeAvatarPreview} from "../../utils/avatar-preview.js";
import {ACTOR_LINK_MISSING, openLinkedActorSheet, withLinkedActor} from "../../utils/actor-link.js";
import {relationshipViewContext, wireRelationshipBoard} from "../../utils/relationship-board.js";
import {displayPortraitSrc} from "../../book2-art/people-portraits.js";
import {addPopoutHeaderControl, addPortraitFrameControl, addTokenizerControl} from "../../utils/popout-header-control.js";
import {personFrameHandle, actorPortraitPickUpdate, saveLegacyPersonRow} from "../../utils/portrait-frame-handles.js";
import {normalizeFrame} from "../../utils/portrait-frame.js";
import {bindImagePopoutToActor, pointImagePopoutAt, usedActorPortraits} from "../../utils/actor-portrait-picker.js";
import {openPortraitFrameEditor} from "../../utils/PortraitFrameDialog.js";
import {localize} from "../../utils/i18n.js";

/**
 * What the member-photo WINDOW shows, given the path a member actually wears.
 *
 * A People-of-Stonetop portrait is stored as the SQUARE face, because every roster circle, heart
 * row and token needs one. This window is the opposite case — it exists so somebody can look at
 * the picture — so it shows the whole illustration the square was cut from, the same swap the NPC
 * sheet header and the hover preview make. Anything else (a browsed file, a default) resolves to
 * null and is shown as itself.
 *
 * Display only: the STORED path is what `_stonetopMemberImageEdit.current` keeps and what the
 * gallery is handed back, so re-opening Edit Photo still highlights the portrait the member wears.
 */
const memberPhotoDisplaySrc = displayPortraitSrc;

const _STEADING_MOVES_RAW = [
	{
		slug: "seasonsChange",
		label: "Seasons Change",
		stat: "fortunes",
		statLabel: "Fortunes",
		rollable: false,
		interactive: true,
		description: `<div class="stonetop-seasons-grid">
  <img src="systems/stonetop-pwd/assets/icons/seasons/spring_icon.svg" class="stonetop-season-row-icon" alt="Spring">
  <div><strong>Spring</strong>: The <em>most hopeful</em> rolls +Fortunes. <strong>10+:</strong> pick 1 seasonal gain. <strong>7–9:</strong> pick 1 gain, but a threat makes itself known. <strong>6−:</strong> threats abound; don't mark XP. Reset Fortunes to +1.</div>

  <img src="systems/stonetop-pwd/assets/icons/seasons/summer_icon.svg" class="stonetop-season-row-icon" alt="Summer">
  <div><strong>Summer</strong>: The <em>most content</em> rolls +Fortunes. <strong>10+:</strong> pick 2 seasonal gains. <strong>7–9:</strong> pick 1. <strong>6−:</strong> a threat makes itself known; don't mark XP. The steading generates 1d4−1 Surplus. Reset Fortunes to +1.</div>

  <img src="systems/stonetop-pwd/assets/icons/seasons/fall_icon.svg" class="stonetop-season-row-icon" alt="Autumn">
  <div><strong>Autumn</strong>: The <em>most determined</em> rolls +Fortunes. <strong>10+:</strong> pick 1 seasonal gain. <strong>7–9:</strong> pick 1 gain, but a threat makes itself known. <strong>6−:</strong> threats abound; don't mark XP. The steading generates 1d4 Surplus at harvest. Reset Fortunes to +1.</div>

  <img src="systems/stonetop-pwd/assets/icons/seasons/winter_icon.svg" class="stonetop-season-row-icon" alt="Winter">
  <div><strong>Winter</strong> — The <em>weariest</em> rolls 1d4+Population (min 0); the steading consumes that much Surplus. If there isn't enough: Surplus → 0, Fortunes −1, pick 1 consequence. Then roll +Fortunes. Reset Fortunes to +1.</div>
</div>
<p class="stonetop-seasons-cta">Click <strong>Seasons Change</strong> above to walk through the current season step by step.</p>`,
	},
	{
		slug: "pullTogether",
		label: "Pull Together",
		stat: "population",
		statLabel: "Population",
		rollable: true,
		interactive: true,
		description: `<p>When you <strong>set a community to work on improvements, to secure new resources, or to make major repairs</strong>, spend whatever the GM says is required and roll <strong>+Population</strong>.</p>
<p><strong>On a 10+:</strong> the job gets done.</p>
<p><strong>On a 7-9:</strong> pick 1: other work does not get done; the work is shoddy or crude; there is a consequence; or there is an unforeseen cost, requirement, or challenge.</p>
<p><em>Diminished debility: disadvantage on this roll.</em></p>`,
	},
	{
		slug: "muster",
		label: "Muster",
		stat: "population",
		statLabel: "Population",
		rollable: true,
		interactive: true,
		description: `<p>When <strong>Stonetop needs mustering against a threat</strong>, reduce Fortunes by 1 and roll <strong>+Population</strong>.</p>
<p><strong>On a 7+:</strong> the steading is alert and ready for action until the threat passes, the Seasons Change, or you cease to oversee the muster. On a 10+, also pick 2; on a 7-9, also pick 1.</p>
<ul>
  <li>Increase Defenses by 1 as long as the muster holds</li>
  <li>Everyone's willing to pitch in; don't reduce Fortunes after all</li>
  <li>The muster holds together even without your presence</li>
  <li>1 or 2 individuals show real potential; ask the GM who and how</li>
</ul>
<p><em>Diminished debility: disadvantage on this roll.</em></p>`,
	},
	{
		slug: "deploy",
		label: "Deploy",
		stat: "defenses",
		statLabel: "Defenses",
		rollable: true,
		interactive: true,
		description: `<p>When <strong>Stonetop's militia goes into action</strong>, say what they're doing and roll <strong>+Defenses</strong>.</p>
<p><strong>On a 7+:</strong> it gets done. On a 10+, choose 2; on a 7-9, choose 1.</p>
<ul>
  <li>It's more effective than expected</li>
  <li>It's quick, over soon</li>
  <li>It causes little collateral damage, expense, or blowback</li>
  <li>Someone involved distinguishes themselves</li>
</ul>
<p><strong>On a 6-:</strong> don't mark XP, and the GM chooses 2: it's less effective than expected; injuries abound and the steading marks diminished; or a named NPC involved dies.</p>
<p><em>Diminished debility: disadvantage on this roll.</em></p>`,
	},
	{
		slug: "tradeBarter",
		label: "Trade & Barter",
		stat: "prosperity",
		statLabel: "Prosperity",
		rollable: true,
		interactive: true,
		description: `<p>When you <strong>wish to acquire or sell a commonly available item</strong>, you can. When you seek to acquire or sell a special item, roll <strong>+Prosperity</strong> and subtract the item's Value. In winter, you have disadvantage.</p>
<p><strong>On a 10+:</strong> you can get it or sell it for a fair price.</p>
<p><strong>On a 7-9 when buying:</strong> the GM picks 1 complication.</p>`,
	},
	{
		slug: "meetWithDisaster",
		label: "Meet with Disaster",
		stat: null,
		statLabel: null,
		rollable: false,
		interactive: true,
		description: `<p>When <strong><em>calamity befalls the steading or panic spreads</em></strong>, reduce Fortunes by 1 (min -1).</p><p>When <strong><em>Fortunes would drop below -1 for any reason</em></strong> (not just calamity or panic), then the GM picks 1 instead:</p><ul><li>The steading marks <em>diminished</em> from injuries/sickness/doubt (disadvantage to Deploy, Muster, Pull Together)</li><li>The steading marks <em>lacking</em> due to shortages/hoarding/distrust (treat Prosperity as 1 lower)</li><li>The steading marks <em>malcontent</em> from fear/anger/despair (Fortunes reset to +0 each season, not +1; folks need Persuading more often than usual)</li><li>Folks start to leave; reduce Population by 1</li></ul>`,
	},
	{
		slug: "requisition",
		label: "Requisition",
		stat: "fortunes",
		statLabel: "Fortunes",
		rollable: false,
		interactive: true,
		description: `<p>When you <strong>borrow some of the steading's assets for an expedition</strong> or otherwise put them at risk, roll <strong>+Fortunes</strong>.</p>
<p><strong>On a 10+:</strong> go ahead, but bring it back safely.</p>
<p><strong>On a 7-9:</strong> you'll need to do some convincing.</p>
<p><strong>On a 6-:</strong> don't mark XP; you can take the asset with you if you want, but if you do, reduce Fortunes by 1.</p>`,
	},
	{
		slug: "returnTriumphant",
		label: "Return Triumphant",
		// No dice: Return Triumphant clears a steading debility (or raises Fortunes
		// if none are marked), so it's a non-rollable interactive walkthrough like
		// Meet with Disaster. `stat`/`statLabel` stay null so no "+Fortunes" roll chip
		// renders. A player makes this move, but its effects land on the steading —
		// hence its home on the steading sheet, not the character sheet's expedition list.
		stat: null,
		statLabel: null,
		rollable: false,
		interactive: true,
		description: `<p>When you <strong>return home in triumph</strong> — having saved your fellows, put down the threat, seized the opportunity, etc. — clear one of the steading's debilities (<em>diminished</em>, <em>lacking</em>, or <em>malcontent</em>).</p>
<p>If the steading has no debilities marked, then increase Fortunes by 1.</p>`,
	},
	{
		slug: "persuade",
		label: "Persuade",
		stat: "fortunes",
		statLabel: "Fortunes",
		rollable: true,
		interactive: true,
		description: `<p>When you need to <strong>convince the residents of Stonetop to do something costly, dangerous, or against their interests</strong>, roll <strong>+Fortunes</strong>.</p>
<p><strong>On a 10+:</strong> they go along with it, at least for now.</p>
<p><strong>On a 7–9:</strong> they need something in return, or they'll only go partway.</p>
<p><strong>On a miss:</strong> they refuse outright, and may resent being asked.</p>
<p><em>Malcontent debility: folks need Persuading more often than usual.</em></p>`,
	},
];
const STEADING_MOVES = [..._STEADING_MOVES_RAW].sort((a, b) => a.label.localeCompare(b.label));
const DIMINISHED_MOVES = new Set(["Deploy", "Muster", "Pull Together"]);
const STEADING_STAT_CHIP_LABELS = {
	Defenses: "DEF",
	Fortunes: "FOR",
	Population: "POP",
	Prosperity: "PRO",
};

// Hover tooltips for the steading stat labels, keyed by data-steading-stat
// (Book I "Homefront"). Gated by hoverDescriptionsSteadingStats.
const STEADING_STAT_TOOLTIPS = {
	surplus:    "Stores of food and trade goods. A resource you accumulate, spend, and consume, not rolled. Generated in summer and autumn, eaten through in winter.",
	fortunes:   "The steading's morale, social cohesion, and the favor of the gods: “how things are going.” Roll +Fortunes to Requisition and when the Seasons Change; resets to +1 each season.",
	size:       "How big the steading is: hamlet (under 50 people), village (150–350), town (500–1500), city (2500+). Mostly descriptive, but it affects winter Surplus consumption and the Muster, Pull Together, and Trade & Barter moves.",
	population: "The number of able bodies living here, relative to its Size. Roll +Population to Muster or Pull Together; higher Population also eats more Surplus each winter.",
	prosperity: "The goods in circulation, the variety of tradesfolk, and merchant traffic. Roll +Prosperity to Trade & Barter; it also sets the value of “x piercing” and what gear is available.",
	defenses:   "The steading's martial readiness: trained, armed residents and veteran warriors. Roll +Defenses to Deploy its people against a threat.",
	debilities: "Ongoing afflictions that drag the steading down: diminished (injury, sickness, or doubt), lacking (shortages, hoarding, or distrust), and malcontent (fear, anger, or despair). Check any that apply; each imposes its own penalty until it's cleared.",
};
const _esc = escHtml;

// A steading move's result table is an ordered list of rows. Each row declares which PbtA
// tier(s) its line feeds — success (10+), partial (7-9), both (a 7+ line), failure (6-/Miss),
// or none (an informational row shown in the legend only) — plus a display label and line.
// The legend renders every row; the roll card's per-tier text buckets each row's line into
// its tiers. Data-driven, so the copy can be reworded freely without a regex silently
// re-bucketing it or failing to bold its prefix (the old string round-trip's failure mode).
const RESULT = {
	strong: (line, label = "10+") => ({ tiers: ["success"],            label, line }),
	weak:   (line, label = "7-9") => ({ tiers: ["partial"],            label, line }),
	hit:    (line, label = "7+")  => ({ tiers: ["success", "partial"], label, line }),
	miss:   (line, label = "6-")  => ({ tiers: ["failure"],            label, line }),
	info:   (label, line)         => ({ tiers: [],                     label, line }),
};

function _resultsLegendHtml(rows) {
	return resultsLegendHtml((rows ?? []).map(row =>
		// Real result tiers get a bold label; informational rows (e.g. "Commonly available
		// item") stay unbolded, matching the old prefix-only bolding.
		row.tiers?.length
			? `<strong>${_esc(row.label)}:</strong> ${_esc(row.line)}`
			: `${_esc(row.label)}: ${_esc(row.line)}`
	));
}

function _moveResultsFromRows(rows) {
	const collect = tier => (rows ?? [])
		.filter(row => row.tiers?.includes(tier))
		.map(row => row.line)
		.join(" ");
	return Object.fromEntries(TIER_KEYS.map(key => [key, { value: collect(key) }]));
}

function _seasonFortunesResultRows(seasonId) {
	switch (seasonId) {
		case "summer":
			return [
				RESULT.strong("pick 2 seasonal gains."),
				RESULT.weak("pick 1 seasonal gain."),
				RESULT.miss("a threat makes itself known or gets worse; don't mark XP."),
			];
		case "winter":
			return [
				RESULT.strong("winter is relatively mild; each player names a local NPC with whom their relationship improves."),
				RESULT.weak("the steading must consume 1d4+Population more Surplus before winter ends, or suffer the consequences again."),
				RESULT.miss("as 7-9, plus threats abound; don't mark XP."),
			];
		case "spring":
		case "autumn":
		default:
			return [
				RESULT.strong("pick 1 seasonal gain."),
				RESULT.weak("pick 1 seasonal gain, but a threat makes itself known or gets worse."),
				RESULT.miss("threats abound; don't mark XP."),
			];
	}
}

function _seasonRollOptions(seasonId) {
	const results = _seasonFortunesResultRows(seasonId);
	return {
		moveResults: _moveResultsFromRows(results),
		resultLegend: _resultsLegendHtml(results),
	};
}

// Deploy reads from two lists, not one: its 10+/7-9 outcome is chosen from the good column,
// its 6- consequences from the bad one. Named up here because `pickPools` hangs each off its
// own tier below, and the roll card renders whichever the dice landed on.
const DEPLOY_CHOICES = [
	"It is more effective than expected.",
	"It is quick, over soon.",
	"It causes little collateral damage, expense, or blowback.",
	"Someone involved distinguishes themselves.",
];
const DEPLOY_CONSEQUENCES = [
	"It is less effective than expected.",
	"Injuries abound; the steading marks diminished.",
	"The GM picks a named NPC involved in the action; they die.",
];
const MUSTER_CHOICES = [
	"Increase Defenses by 1 as long as the muster holds.",
	"Everyone is willing to pitch in; do not reduce Fortunes after all.",
	"The muster holds together even without your presence.",
	"1 or 2 individuals show real potential; ask the GM who and how.",
];

// A 7+ leaves the steading "alert and ready for action until the threat passes, the Seasons
// Change, or you cease to oversee the muster" — a STATE, not a one-off, and the only steading
// move that leaves one behind. Raising it from the card rather than the pre-roll dialog for the
// reason Deploy's diminished button is there too: on a 6- there is no muster to raise, and
// offering it before the dice were read asks about an outcome nobody has yet.
//
// Two buttons because "Increase Defenses by 1 as long as the muster holds" is one of the picks
// above, and it is the half that MUST be given back when the muster ends. A +1 nobody remembers
// to remove is worse than one nobody remembers to add: it is invisible on the sheet either way,
// but the stale one is wrong. Taking it here is what lets standing down undo it.
const MUSTER_RAISE_ACTIONS = `<button type="button" class="stonetop-muster-raise" data-action="muster-raise">
		<i class="fas fa-tower-observation"></i> Raise the muster
	</button>
	<button type="button" class="stonetop-muster-raise" data-action="muster-raise" data-defenses="1">
		<i class="fas fa-shield-halved"></i> Raise it, +1 Defenses while it holds
	</button>`;

/**
 * The homefront moves, as their dialog and their roll card between them present them.
 *
 * A flow is REFERENCE plus, at most, the controls that change the roll — `trigger`, `results`
 * and `note` are read before the dice, `fields` is only for something the roll itself needs
 * (Trade & Barter's Value and its winter disadvantage). It deliberately holds no free-text
 * boxes: nothing stored the answers, so all they did was stand between the move and its roll.
 *
 * `pickPools` names, per result tier, the list that tier chooses from. Those render on the
 * ROLL CARD (roll-engine's pickOptions), as a checklist whose ticks persist on the message —
 * so the choice is made once the dice have said which tier, and how many, rather than being
 * guessed at in the dialog beforehand. How many to take is already in each tier's `results`
 * line ("choose 2", "the GM chooses 2 consequences"), so no count is repeated here.
 */
const HOMESTEAD_MOVE_FLOWS = {
	pullTogether: {
		label: "Pull Together",
		stat: "population",
		statLabel: "Population",
		trigger: "When you set a community to work on improvements, to secure new resources, or to make major repairs, spend whatever the GM says is required and roll +Population.",
		pickPools: {
			partial: [
				"It gets done, but other work does not; reduce Fortunes by 1.",
				"It gets done, but the work is shoddy or crude.",
				"It gets done, but there is a consequence.",
				"There is an unforeseen cost, requirement, or challenge; address it and the job gets done.",
			],
		},
		results: [
			RESULT.strong("the job gets done."),
			RESULT.weak("the job gets done, but pick 1."),
			RESULT.miss("the GM says what happens; do not mark XP."),
		],
		note: "Diminished gives disadvantage on this roll.",
	},
	muster: {
		label: "Muster",
		stat: "population",
		statLabel: "Population",
		trigger: "When Stonetop needs mustering against a threat, reduce Fortunes by 1 and roll +Population.",
		beforeRoll: "musterCost",
		pickPools: {
			success: MUSTER_CHOICES,
			partial: MUSTER_CHOICES,
		},
		// Both 7+ tiers, since both leave the steading alert; only the number of picks differs.
		tierActions: {
			success: MUSTER_RAISE_ACTIONS,
			partial: MUSTER_RAISE_ACTIONS,
		},
		results: [
			RESULT.hit("the steading is alert and ready for action until the threat passes, the Seasons Change, or you cease to oversee the muster."),
			RESULT.strong("also pick 2."),
			RESULT.weak("also pick 1."),
			RESULT.miss("the GM says what happens; do not mark XP."),
		],
		note: "Diminished gives disadvantage on this roll.",
	},
	deploy: {
		label: "Deploy",
		stat: "defenses",
		statLabel: "Defenses",
		trigger: "When Stonetop's militia goes into action, say what they're doing and roll +Defenses.",
		pickPools: {
			success: DEPLOY_CHOICES,
			partial: DEPLOY_CHOICES,
			failure: DEPLOY_CONSEQUENCES,
		},
		// "Injuries abound" is one of the consequences above, so the button that applies it
		// rides the miss with them (wired in stonetop.js).
		tierActions: {
			failure: `<button type="button" class="stonetop-deploy-mark-diminished" data-action="deploy-mark-diminished">
				<i class="fas fa-band-aid"></i> Injuries abound: mark diminished
			</button>`,
		},
		results: [
			RESULT.hit("it gets done."),
			RESULT.strong("choose 2."),
			RESULT.weak("choose 1."),
			RESULT.miss("do not mark XP; the GM chooses 2 consequences."),
		],
		note: "Diminished gives disadvantage on this roll.",
	},
	tradeBarter: {
		label: "Trade & Barter",
		stat: "prosperity",
		statLabel: "Prosperity",
		trigger: "When you wish to acquire or sell a commonly available item, you can. When you seek to acquire or sell a special item, roll +Prosperity and subtract the item's Value. In winter, you have disadvantage.",
		// The only two controls in any homefront dialog, because these two are the only ones
		// the dice read: Value is subtracted as a modifier, and winter forces disadvantage.
		fields: [
			{ name: "value", label: "Item Value", type: "number", placeholder: "0", min: 0 },
			{ name: "winter", label: "It is winter", type: "checkbox" },
		],
		results: [
			RESULT.info("Commonly available item", "you can acquire or sell it without rolling."),
			RESULT.strong("you can get it or sell it for a fair price."),
			RESULT.weak("the GM picks 1 (below).", "7-9 when buying"),
			RESULT.weak("you can sell it now, but you won't get its full worth.", "7-9 when selling"),
			RESULT.miss("don't mark XP. If you still want to acquire/sell it, you'll need to travel elsewhere or wait until next season.", "6- either way"),
		],
		pickPools: {
			partial: [
				"You can get it, but it'll cost more than usual",
				"Someone has it, but they aren't keen to give it up",
				"You can get something close, but not quite right",
			],
		},
		note: "For unique or truly exceptional items, don't Trade & Barter — Make a Plan with the GM or wait for a trade opportunity when Seasons Change. Lacking treats Prosperity as 1 lower; subtract the item's Value as a modifier.",
	},
	persuade: {
		label: "Persuade",
		stat: "fortunes",
		statLabel: "Fortunes",
		trigger: "When you need to convince the residents of Stonetop to do something costly, dangerous, or against their interests, roll +Fortunes.",
		results: [
			RESULT.strong("they go along with it, at least for now."),
			RESULT.weak("they need something in return, or they'll only go partway."),
			RESULT.miss("they refuse outright, and may resent being asked.", "Miss"),
		],
		note: "Malcontent means folks need Persuading more often than usual.",
	},
};

// Every editable section carries its own hover edit pencil; each is read-only
// until its pencil (or the global header wrench) turns it on. Keys match the
// `data-section` attributes in the templates.
const STEADING_EDIT_SECTIONS = [
	"surplus", "fortunes", "population", "defenses", "prosperity",
	"size", "fortifications", "currency",
	"resources", "assets", "places",
	// "threats" and "sites" left with their tabs, which moved to the GM Toolkit sheet
	// (module/actors/gmtoolkit/gm-prep-tabs.js declares its own list).
	"players", "residents", "neighbors", "settlements", "improvements",
];

export function createStonetopSteadingSheetClass(Base) {
	// Sections with their own heading pencil (Residents, Neighbors) track edit
	// state independently of the global header-wrench `_editMode` via the shared
	// section-editing mixin.
	//
	// withSheetSizeMemory: reopen at the size this user last left this steading's sheet.
	return class StonetopSteadingSheet extends withSectionEditing(withSheetSizeMemory(Base)) {
		_stonetopSteading;
		_editMode = false;
		// Sections whose edit mode was just turned off: their "done" check lingers
		// for a beat, fades out, then reverts to the hover pencil. Each has a timer.
		_recentlyEditedSections = new Set();
		_recentlyEditedTimers = new Map();
		// Slugs of improvement cards the user has expanded. Tracked here (not in the
		// DOM) so a card stays open across the re-render that ticking a requirement
		// or completion checkbox triggers — it only collapses when its header/chevron
		// is clicked.
		_openImprovements = new Set();
		// The single lit category chip on the Improvements tab (see IMPROVEMENT_CATEGORIES).
		// One at a time: picking a second chip drops the first. "" means no filter, so the
		// tab opens showing everything, and clicking the lit chip again returns to that.
		// Instance state like _openImprovements, deliberately NOT an actor flag: it's one
		// viewer's lens on the list, not a property of the steading, and a player with
		// read-only access to the actor could not write a flag anyway.
		_improvementCategory = "";
		constructor(...args) {
			super(...args);
			this._stonetopSteading = this.actor.typedActor;
			// Honor the "Open Sheets in Edit Mode" client setting on first open.
			this._editMode = getOpenSheetsInEditMode();
		}

		static get defaultOptions() {
			return foundry.utils.mergeObject(super.defaultOptions, {
				// `stonetop-layout-classic` when this user reads steading sheets in the classic
				// layout — see the character sheet's note for why it is set both here and in
				// _render.
				classes: ["pbta", "stonetop", "sheet", "actor", "steading", ...layoutClasses("steading")],
				width: 1080,
				minWidth: 600,
				height: 840,
				// Mirrors the CSS floor in stonetop.css — see the character sheet's note.
				minHeight: 620,
				tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "overview" }],
			});
		}

		get template() {
			return "systems/stonetop-pwd/templates/actor/steading.hbs";
		}

		async _render(force, options) {
			// The hover preview is a document.body singleton, so a re-render while the cursor is
			// over an avatar tears out the anchor without firing mouseleave — clear it up front so
			// no orphaned floating preview is left stuck on screen.
			removeAvatarPreview();
			await super._render(force, options);
			stampLayoutClass(this, "steading");
			// Strip any PBTA-injected playbook controls and FoundryVTT chrome from the window header
			const header = this.element[0]?.querySelector(".window-header");
			if (header) {
				header.querySelectorAll(".pbta-playbook, .sheet-playbook, [class*='playbook']").forEach(el => el.remove());
				header.querySelectorAll("select, input[name*='playbook']").forEach(el => el.remove());
				header.querySelectorAll(".document-id-link").forEach(el => el.remove());
			}
			this._injectHeaderToggle();
		}

		_injectHeaderToggle() {
			// Master edit toggle: when on, every section is editable. Each section also has its
			// own hover pencil for editing it in isolation. Shared with the character, NPC and
			// monster sheets — see utils/sheet-chrome.js.
			injectHeaderToggle(this, "Steading", {
				// Locking the sheet resets any per-section pencils back to read-only.
				onChange: (on) => {
					if (on) return;
					this._editingSections.clear();
					this._clearAllSectionDoneTimers();
				},
			});
		}

		_getHeaderButtons() {
			const buttons = super._getHeaderButtons().filter(b => b.class !== "configure-sheet");
			const tokenIdx = buttons.findIndex(b => b.class?.includes("token"));
			buttons.splice(tokenIdx >= 0 ? tokenIdx : 0, 0, {
				label:   "Ledger",
				class:   "stonetop-ledger-button",
				icon:    "fas fa-scroll",
				onclick: () => this._openLedgerDialog(),
			});
			return buttons;
		}

		_openLedgerDialog() {
			openLedgerDialog(this.actor, SteadingLedger);
		}

		// Section-editing hooks: entering edit cancels any lingering "done" check;
		// leaving edit starts the fade-out check (see _markSectionDone).
		_onSectionEditOpened(section) { this._clearSectionDone(section); }
		_onSectionEditClosed(section) { this._markSectionDone(section); }

		// Show a section's "done" check for a beat after leaving edit, then fade it
		// out (CSS) and re-render so the section reverts to its hover pencil.
		_markSectionDone(section) {
			this._clearSectionDone(section);
			this._recentlyEditedSections.add(section);
			const timer = setTimeout(() => {
				this._recentlyEditedSections.delete(section);
				this._recentlyEditedTimers.delete(section);
				if (this.rendered) this.render(false);
			}, 1000);
			this._recentlyEditedTimers.set(section, timer);
		}

		_clearSectionDone(section) {
			this._recentlyEditedSections.delete(section);
			const timer = this._recentlyEditedTimers.get(section);
			if (timer) {
				clearTimeout(timer);
				this._recentlyEditedTimers.delete(section);
			}
		}

		_clearAllSectionDoneTimers() {
			for (const timer of this._recentlyEditedTimers.values()) clearTimeout(timer);
			this._recentlyEditedTimers.clear();
			this._recentlyEditedSections.clear();
		}

		async close(options) {
			this._clearAllSectionDoneTimers();
			// The avatar hover preview lives on document.body, so it survives the sheet's own
			// DOM being torn down — clear it here or it orphans if the sheet closes (e.g. Escape)
			// while the cursor is still over an avatar and no mouseleave ever fires.
			removeAvatarPreview();
			// Same for the classic layout's move hover panel, which is also a document.body
			// singleton. activateListeners clears it on each render, but a sheet that is closed
			// rather than re-rendered never reaches that — so it has to be dropped here too.
			this._movePanel?.remove();
			this._movePanel = null;
			return super.close(options);
		}

		async getData() {
			const context = await super.getData();
			context.stonetop = await this._stonetopSteading.buildSnapshot();
			// The click target is resolved HERE, once, rather than branched in each template.
			// The modern card and the classic row differ in their wrapper, their name element and
			// where the description goes, but they agree exactly on what a click means — and the
			// delegated handler below reads one set of `li.dataset` keys from both. Resolving it
			// in the view model is what keeps those two shapes from drifting apart: a move with a
			// walkthrough carries its slug, one that only rolls carries its name and stat, and a
			// move this steading cannot make carries neither (the handler's own guard covers the
			// empty pair, so the templates emit the attributes unconditionally).
			context.stonetop.moves = STEADING_MOVES.map(move => ({
				...move,
				statChipLabel: STEADING_STAT_CHIP_LABELS[move.statLabel] ?? move.statLabel,
				moveSlug: move.interactive ? move.slug : "",
				moveName: !move.interactive && move.rollable ? move.label : "",
				unowned: !move.rollable && !move.interactive,
			}));
			context.stonetop.rollMode = this._sheetRollMode();
			context.stonetop.showRollStatChips = getRollStatChipsSetting();
			// Whether either shape of the sticky Roll Modifier is drawn — the classic sidebar's
			// radios or the modern heading's pill. Off means the pre-roll window is asking instead
			// (RollDialog.js), and a control that answers a question nobody is being asked is a
			// control that quietly changes rolls.
			context.stonetop.showRollModeControl = !getAskRollModeEachRollSetting();
			context.stonetop.enrichedNotes = await foundry.applications.ux.TextEditor.enrichHTML(context.stonetop.notes ?? "");
			context.stonetop.editMode = this._editMode;
			context.stonetop.canEdit = this.isEditable;
			// Which layout this user reads this sheet in: the pre-rail one (stat band above the
			// tabs, Homefront Moves as a right-hand sidebar) or today's. Client-scoped and per
			// sheet type — see isClassicLayout in module/settings.js.
			context.stonetop.classicLayout = isClassicLayout("steading");
			// Whether the classic moves sidebar is collapsed (defaults to expanded), persisted
			// per-actor, per-user. Unread by the modern layout, which has no sidebar. The
			// backing setting is still called `characterSidebarCollapsed`: the name predates the
			// steading sharing it, and renaming the key would drop everyone's stored state.
			context.stonetop.sidebarCollapsed = getSidebarCollapsed(this.actor?.id);
			// Per-section edit flags: a section is editable when the global header
			// wrench is on OR its own pencil is toggled.
			const sectionEdit = section => this.isSectionEditable(section);
			context.stonetop.edit = Object.fromEntries(
				STEADING_EDIT_SECTIONS.map(section => [section, sectionEdit(section)])
			);
			// Other Settlements: how this steading stands with the communities beyond it
			// (module/data/settlements.js), on the same 1-5 hearts the NPC and character
			// sheets use. Rows are the static roster, keyed by slug rather than actor id —
			// the shared row builder only ever reads .id/.name/.img, so a plain object does.
			// Nothing is stored until a heart moves, so the whole roster reads as neutral
			// on a fresh steading. Under the pencil every settlement lists with a show/hide
			// box; in play the unticked ones drop out.
			const settlementsEditing = context.stonetop.edit.settlements;
			const settlementRows = SETTLEMENTS.map(s => ({
				...relationshipRow(this.actor, { id: s.slug, name: s.name, img: null }, { defaultShown: true }),
				icon:    s.icon,
				tooltip: `${s.name}: ${s.blurb}`,
			}));
			context.stonetop.settlements    = settlementsEditing ? settlementRows : settlementRows.filter(r => r.shown);
			context.stonetop.hasSettlements = context.stonetop.settlements.length > 0;
			// Table or standings board, remembered per table in localStorage beside this
			// table's column widths and sort order.
			context.stonetop.settlementsRel = relationshipViewContext("steadingSettlements", context.stonetop.settlements);
			context.stonetop.recentlyEdited = Object.fromEntries(
				STEADING_EDIT_SECTIONS.map(section => [section, this._recentlyEditedSections.has(section)])
			);
			context.stonetop.hideUnearnedImprovements = this.actor.getFlag(STONETOP_SCOPE, "hideUnearnedImprovements") ?? false;
			context.stonetop.improvementCategories = IMPROVEMENT_CATEGORIES.map(cat => ({
				...cat,
				active: this._improvementCategory === cat.key,
			}));
			// Re-apply the user's expanded cards and lit category chips so both survive the
			// re-render that ticking a requirement triggers. `filtered` is stamped here rather
			// than left to the click handler alone so a re-render can't flash the hidden cards
			// back in before the handler re-runs.
			for (const imp of context.stonetop.improvements ?? []) {
				imp.isOpen = this._openImprovements.has(imp.slug);
				imp.filtered = this._isImprovementFiltered(imp.category);
			}
			context.stonetop.isGM = game.user?.isGM ?? false;
			// The clock beside the sheet's title: the season the table is playing in and the
			// year it belongs to, stamped by the Seasons Change move. The un-stamped case falls
			// back to the picker's year so the header still names a year on a world that hasn't
			// turned a season since this shipped (see module/seasons/current-season.js).
			context.stonetop.currentSeason = currentSeasonView(readCurrentSeason(this.actor), this._seasonsCurrentYear());
			// And what the sky is doing, shown as a glyph to the left of that clock. Set by the
			// Weather picker when the GM posts a result; fine weather until they do (see
			// module/seasons/current-weather.js).
			context.stonetop.currentWeather = currentWeatherView(readCurrentWeather(this.actor));
			// And between the title and that clock, what the steading is still owed or still
			// owes: one glyph per unresolved thing, empty when there is nothing outstanding
			// (see module/actors/steading/steading-holds.js for what qualifies and why).
			// A row is a BUTTON only when it has somewhere to go and the viewer may go there;
			// for everyone else it is the same glyph as a plain readout, so a player still sees
			// what the steading owes without being handed a control that would refuse them.
			context.stonetop.holds = this._stonetopSteading.holdsView()
				.map(h => ({ ...h, interactive: !!h.action && context.stonetop.isGM }));
			return context;
		}

		activateListeners(html) {
			super.activateListeners(html);
			// Hang the tab rail off the window's right edge (module/utils/tab-rail.js).
			mountTabRail(this, html);
			// Frost the seam under the pinned header while the tab is scrolled — after the
			// rail is on the frame, since that is where the tab-change watcher binds.
			mountScrollFrost(this, html);
			wrapStonetopGlyphsInEl(html[0]);

			// Residents / Neighbors filters (see utils/tab-search.js). Each is scoped to its own
			// section so it only hides that section's rows; a row matches on the text of every
			// cell input (name, occupation, traits, relations, notes, home).
			const residentRowText = row => [...row.querySelectorAll(".steading-resident-input")].map(i => i.value).join(" ");
			for (const sec of [".steading-residents-section--residents", ".steading-residents-section--neighbors"]) {
				wireTabSearch(html[0].querySelector(sec), {
					itemSel: ".steading-residents-row",
					textFor: residentRowText,
				});
			}

			// Improvements filter. Scoped to the whole `.tab.improvements` so the `.is-searching`
			// class lands on the same element that carries `.hide-unearned-improvements`, letting the
			// CSS reveal matched-but-un-earned cards while a term is active. A card matches on all of
			// its text (title, flavor, requirements, effect), so the collapsed body is searchable too.
			wireTabSearch(html[0].querySelector(".tab.improvements"), {
				itemSel: ".steading-improvement",
				textFor: card => card.textContent,
			});

			// Category chips beside that search box. One lights at a time, and clicking the
			// lit one clears back to showing everything. Filtering happens in place instead of
			// via a re-render so expanded cards stay expanded and the tab keeps its scroll
			// position; getData stamps the same classes so the state also survives a re-render
			// from elsewhere.
			this._wireImprovementCategoryFilter(html[0].querySelector(".tab.improvements"));

			// Drag a Place of Interest's lettered disc onto the canvas to drop a map
			// note (handled by the dropCanvasData hook). Read-only viewers may drag too;
			// note creation is separately gated by the core NOTE_CREATE permission. The
			// name is read live from the sibling input so it's current even mid-edit.
			html[0].addEventListener("dragstart", (ev) => {
				const badge = ev.target.closest?.(".steading-place-letter[draggable='true']");
				if (!badge) return;
				const item = badge.closest(".steading-place-item");
				const letter = item?.dataset.letter ?? badge.textContent.trim();
				const name = item?.querySelector(".steading-place-name")?.value?.trim() ?? "";
				if (!name) { ev.preventDefault(); return; }
				ev.dataTransfer.setData("text/plain", JSON.stringify({
					type: PLACE_OF_INTEREST_DRAG_TYPE,
					letter,
					name,
				}));
				ev.dataTransfer.effectAllowed = "copy";
			});

			// Drag a Player Character / Resident / Neighbor avatar out of the sheet as a
			// standard Actor drop: the rows are backed by actors, so emitting the core
			// {type:"Actor",uuid} payload lets them drop onto a scene (place a token), into
			// the combat tracker, onto another sheet, etc. — exactly like dragging the actor
			// from the sidebar. Read-only viewers may drag too; what a drop is allowed to do
			// is gated by the core permissions on the target (token/combatant creation),
			// not by us.
			html[0].addEventListener("dragstart", (ev) => {
				// The contract is what the handle IS, not which of the row kinds it belongs to: a
				// draggable element carrying an actor pointer. Both the portrait and the name link
				// of every row kind are marked that way (the templates only add `draggable` where
				// there is a uuid to add beside it), so a row can be dragged by grabbing either
				// one, and a fifth kind of actor-backed row is draggable the day it is written
				// rather than the day somebody remembers to extend a list here.
				const handle = ev.target.closest?.("[draggable='true'][data-actor-uuid]");
				if (!handle) return;
				const uuid = handle.dataset.actorUuid;
				if (!uuid) { ev.preventDefault(); return; }
				ev.stopPropagation();
				ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid }));
				ev.dataTransfer.effectAllowed = "copy";
			});

			// Swap the resident/neighbor fields' native <datalist> popups (occupation,
			// traits, home) for our scrollable one — Chromium's native popup has no
			// scrollbar for long lists. See utils/autocomplete.js.
			StonetopAutocomplete.upgradeAll(html);

			applyLabelTooltips(html, {
				selector: ".steading-stat-label[data-steading-stat], .steading-section-label[data-steading-stat]", datasetKey: "steadingStat",
				table: STEADING_STAT_TOOLTIPS, settingKey: "hoverDescriptionsSteadingStats", direction: "UP",
			});

			// Homefront moves — ONE click target per move, in both layouts: its NAME, plus the
			// "+STAT" chip beside it. There is no dice button any more; the name always forwarded
			// to it, so the icon was a second door onto the same room, and both shapes now carry
			// what the move is on the `<li>` instead (see steading-tab-moves.hbs).
			//
			// Which of the two things a move does is the DATA's answer, not the click's: a move
			// with a walkthrough carries `data-move-slug`, a move that only rolls carries
			// `data-move-name`/`data-stat`, and a move that does neither carries nothing and is
			// inert — the `move-unowned` row. Every move the system ships is interactive today,
			// so the roll-only branch is the one that keeps a bare rollable move working.
			//
			// Bound for editable and read-only alike: rolling a homefront move is play, open to a
			// player who cannot edit the steading. Hence the position, above the isEditable guard.
			//
			// The prompt comes BEFORE the roll; WHAT it asks for is the "Ask How to Roll Each
			// Time" setting's business rather than this handler's, and when it has nothing to ask
			// it opens no window at all. A mode it does not answer falls back to the sticky
			// selector wired below. Shift-click rolls straight through either way — which is why
			// the click's own `shiftKey` is read here rather than re-dispatched through anything.
			html[0].addEventListener("click", async ev => {
				const opener = ev.target.closest(".stonetop-steading-move-open, .stonetop-move-roll-chip");
				if (!opener) return;
				const li = opener.closest("li");
				if (!li) return;
				const { moveSlug, moveName, stat } = li.dataset;
				if (!moveSlug && !moveName) return; // a move this steading cannot make
				ev.stopPropagation();

				if (moveSlug) {
					if (moveSlug === "meetWithDisaster") this._onMeetWithDisaster();
					else if (moveSlug === "requisition") this._onRequisitionWalkthrough();
					else if (moveSlug === "returnTriumphant") this._onReturnTriumphant();
					else if (moveSlug === "seasonsChange") this._onSeasonsChange();
					else if (HOMESTEAD_MOVE_FLOWS[moveSlug]) this._onHomesteadMove(moveSlug);
					return;
				}

				const prompted = await promptRoll({ title: moveName || "Roll", shiftKey: ev.shiftKey });
				if (!prompted) return;
				await this._onSteadingRoll(moveName, stat, prompted);
			}, true);

			// The sticky Roll Modifier, in BOTH its shapes — the modern layout's segmented pill on
			// the Homefront Moves heading (buttons, see roll-mode-picker.hbs) and the classic
			// sidebar's stacked radio list (roll-mode-radios.hbs). One layout renders at a time, so
			// only one of these ever has anything to match, but both have to be bound: which one is
			// live is a per-user setting read at render, not something known here. Binding only the
			// pill's is the silent failure the classic layout hit — the radios render, highlight
			// correctly off the server-stamped `checked`, and write nothing at all.
			//
			// Wired here, above the isEditable guard, for the same reason the roll buttons are: a
			// player who can roll the moves has to be able to say how. Unguarded by the setting
			// too — neither shape is DRAWN while the window is asking, so this matches nothing.
			//
			// Neither renders explicitly: setFlag is a document update, and `updateActor` already
			// re-renders every sheet on this actor. A second one here is a whole extra rebuild of
			// six tabs (re-enriched notes, three relationship tables, the rail and frost remounts)
			// and it flickers the tab the user is reading.
			html[0].addEventListener("click", async ev => {
				const btn = ev.target.closest(".stonetop-roll-mode-btn");
				if (!btn) return;
				ev.stopPropagation();
				const mode = normalizeRollMode(btn.dataset.rollMode);
				if (mode === this._sheetRollMode()) return; // already on it — nothing to write
				await this.actor.setFlag(STONETOP_SCOPE, "rollMode", mode);
			}, true);

			// The season/year clock beside the title. Runs the MOVE, the same thing the hotbar
			// macro and the Seasons Change move card run — the clock is the most obvious thing
			// on the sheet to click when the seasons turn, and it used to open the
			// correct-the-clock window instead, which quietly wrote a flag and made no move.
			// Correcting the clock is now a door at the bottom of that window (see
			// _onSeasonsChange's `altAction`), which is the right way round: the move happens
			// four times a year and the correction about once a campaign.
			//
			// Only a GM gets a button here (the template renders a plain div for everyone
			// else), so this binds nothing for players.
			html.find("[data-action='set-current-season']").on("click", () => this._onSeasonsChange());

			// The weather glyph left of the clock opens the Weather picker — the window that
			// decides what that glyph shows, so the readout is the way back to what set it.
			// Through `game.stonetop.openWeather` rather than the class, which is what the hotbar
			// macro and the Expedition dialog's own weather button both call: one entry point, so
			// `openOrFocus` in there can keep it to one window however it was reached.
			//
			// GM-only, like the clock: the template renders a plain span for everyone else, so
			// this binds nothing for a player.
			html.find("[data-action='set-current-weather']").on("click", () => game.stonetop?.openWeather?.());

			// A real radio group, so `change` rather than a delegated click: the browser owns the
			// deselection, and change only fires on the one that became checked.
			html.find(".stonetop-roll-mode-input").on("change", async ev => {
				await this.actor.setFlag(STONETOP_SCOPE, "rollMode", normalizeRollMode(ev.currentTarget.value));
			});

			// Collapse / expand the whole moves sidebar (CLASSIC layout only; the modern layout
			// has no sidebar, so this simply matches nothing). Shared with the character sheet
			// and the expedition walkthrough's rail (utils/sidebar-toggle.js); the state is
			// persisted per actor, so the sidebar reopens the way it was left.
			wireSidebarToggle(html, {
				expandLabel:   "Expand moves sidebar",
				collapseLabel: "Collapse moves sidebar",
				persist:       collapsed => setSidebarCollapsed(this.actor?.id, collapsed),
			});

			// NO SECOND HANDLER FOR THE MOVE NAME. It used to re-dispatch a MouseEvent at the
			// dice icon beside it (carrying the Shift state by hand, because a bare `.click()`
			// reports `shiftKey: false` and would sit through the prompt Shift exists to skip).
			// With the icon gone the name is the handler's own target, above, and the Shift state
			// is the real click's.

			// Hover panel for the CLASSIC sidebar's one-line move rows: the row shows only a
			// name, so its text has to come from somewhere. Gated on the ROWS EXISTING, not on
			// the setting alone — the modern layout renders move cards that carry their own
			// text, and building this on document.body for a layout that never shows it just
			// leaks a div.
			this._movePanel?.remove();
			this._movePanel = null;
			if (html[0].querySelector(".steading-move-row") && getHoverDescriptionSetting("hoverDescriptionsBasicMoves")) {
				const panel = document.createElement("div");
				this._movePanel = panel;
				panel.className = "stonetop-basic-move-panel";
				panel.hidden = true;
				document.body.appendChild(panel);

				html.find(".steading-move-row").on("mouseenter", ev => {
					const li = ev.currentTarget;
					const descEl = li.querySelector(".stonetop-basic-move-desc");
					if (!descEl) return;
					const nameText = li.querySelector(".stonetop-move-name")?.textContent?.trim() ?? "";
					const nameEl = document.createElement("strong");
					nameEl.className = "stonetop-basic-move-panel-name";
					nameEl.textContent = nameText;
					panel.replaceChildren(nameEl, ...Array.from(descEl.cloneNode(true).childNodes));
					// The same hover-panel pass the character sheet's two panels run: drop the
					// collapsibles a panel that closes on mouseleave can't open, redraw the ◇/□
					// a move is written with. This is the fourth surface to show a move's text
					// this way and the only one that had neither.
					prepareMoveHoverBody(panel);
					panel.hidden = false;
					const rect = li.getBoundingClientRect();
					panel.style.top   = `${Math.max(4, Math.min(rect.top, window.innerHeight - panel.offsetHeight - 8))}px`;
					panel.style.right = `${window.innerWidth - rect.left + 8}px`;
				}).on("mouseleave", () => {
					panel.hidden = true;
				});
			}

			// Improvement card expand/collapse. The open state is mirrored into
			// _openImprovements so it persists across re-renders (see getData).
			html[0].addEventListener("click", ev => {
				const hdr = ev.target.closest(".steading-improvement-header");
				if (!hdr) return;
				if (ev.target.closest(".steading-improvement-complete-label")) return;
				if (ev.target.closest(".steading-improvement-remove")) return;
				const card = hdr.closest(".steading-improvement");
				if (!card) return;
				const open = card.classList.toggle("is-open");
				const slug = card.dataset.slug;
				if (slug) open ? this._openImprovements.add(slug) : this._openImprovements.delete(slug);
			}, true);

			html[0].addEventListener("change", ev => {
				const cb = ev.target.closest(".steading-hide-unearned-improvements-check");
				if (!cb) return;
				ev.stopPropagation();
				this.actor.setFlag(STONETOP_SCOPE, "hideUnearnedImprovements", cb.checked)
					.catch(err => console.error("Stonetop | could not save the improvements filter", err));
			}, true);

			// Per-section edit toggle (pencil/check at each section's corner) flips
			// just that section's edit state, independent of the global wrench. The
			// fade-out "done" check is driven by the _onSectionEdit* hooks above.
			this._wireSectionEditToggle(html, ".steading-section-edit-toggle");

			// The fold caret beside that pencil. Each section folds to its own heading:
			// a card's h3, a stat card's label row, or the sidebar's title. A card's
			// caret sits in the corner beside the pencil rather than inside the heading,
			// so the walker looks forward from it to find the heading — see
			// _sectionFoldTargets. Wired before the isEditable guard below: a player who
			// can only read the sheet still gets to tidy it.
			this._wireSectionCollapse(html,
				".steading-list-heading, .steading-residents-heading, .steading-stat-label-row, .stonetop-move-group-title");

			// Add resident / neighbor — allowed even outside edit mode
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".steading-list-add");
				if (!btn) return;
				if (!["residents", "neighbors"].includes(btn.dataset.list)) return;
				ev.stopPropagation();
				this._onListItemAdd(btn.dataset.list);
			}, true);

			// Drag-resizable columns on the player/resident/neighbor tables — useful in both edit and read-only modes.
			// This loop also covers the Other Settlements relations table (it carries the same
			// classes); wireRelationshipTable below would wire it too, but both column utils
			// are idempotent, so whichever gets there first wins and the other is a no-op.
			html[0].querySelectorAll(".steading-residents-table[data-resize-key]").forEach(table => {
				makeColumnsResizable(table, table.dataset.resizeKey);
				makeColumnsSortable(table, table.dataset.resizeKey);
			});

			// Other Settlements: hearts + notes + the show/hide boxes. Interactive in play
			// mode too — a steading's standing shifts at the table, like the sheet's other
			// live trackers.
			wireRelationshipTable(html[0], this.actor, { editable: this.isEditable });
			wireRelationshipBoard(html[0], this.actor, { editable: this.isEditable });
			// No wireRelationshipLinks here: Other Settlements is keyed by slug, so no row
			// carries a uuid or a portrait and neither handler would ever fire. Add the call
			// if this sheet ever grows an actor-backed roster.

			// Residents / Neighbors faces, through the same shared preview the relationships
			// component uses — a face previews identically wherever it appears.
			// The inner image, not the box: the surface class now sits on a clipping span that
			// the art-less placeholder wears too, so only the `-img` class identifies an element
			// that actually has a picture to enlarge.
			wireAvatarPreview(html[0], ".steading-member-avatar-img");
			// Player Characters sit in the same tab, directly above the residents, so their
			// portraits enlarge the same way.
			wireAvatarPreview(html[0], ".steading-player-portrait-img");
			html[0].addEventListener("click", ev => {
				const avatar = ev.target.closest(".steading-member-avatar");
				if (!avatar) return;
				ev.stopPropagation();
				this._openMemberAvatarImage(avatar);
			}, true);

			if (!this.isEditable) return;

			// Stat tracks use custom radio markup, so persist them explicitly.
			html[0].addEventListener("change", ev => {
				const input = ev.target;
				if (input.type !== "radio" || !input.name || !input.closest(".steading-track-option")) return;
				ev.stopPropagation();
				this._onSteadingTrackChange(input.name, Number(input.value));
			}, true);

			// Surplus is in the custom stat bar, so persist it explicitly.
			const onSurplusInput = ev => {
				const input = ev.target.closest(".steading-surplus-input");
				if (!input) return;
				ev.stopPropagation();
				this._onSteadingTrackChange(input.name, Math.max(0, parseInt(input.value, 10) || 0));
			};
			html[0].addEventListener("input", onSurplusInput, true);
			html[0].addEventListener("change", onSurplusInput, true);

			// Debilities live in the same custom bar and need the same legacy-safe persistence.
			html[0].addEventListener("change", ev => {
				const input = ev.target.closest(".steading-debility-check");
				if (!input) return;
				ev.stopPropagation();
				this._onSteadingTrackChange(input.name, input.checked);
			}, true);

			// List item checked toggle (resources, fortifications, assets)
			html[0].addEventListener("change", ev => {
				const cb = ev.target.closest(".steading-list-check");
				if (!cb) return;
				ev.stopPropagation();
				const { list, index } = cb.dataset;
				this._onListItemCheck(list, parseInt(index, 10), cb.checked);
			}, true);

			// Click a requisitioned ("taken") asset to return it to the steading.
			html[0].addEventListener("click", ev => {
				const taken = ev.target.closest(".steading-asset-taken");
				if (!taken) return;
				ev.stopPropagation();
				this._onReturnAsset(parseInt(taken.dataset.index, 10));
			}, true);

			// Add list item (residents/neighbors are handled above, regardless of edit mode)
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".steading-list-add");
				if (!btn) return;
				if (["residents", "neighbors"].includes(btn.dataset.list)) return;
				ev.stopPropagation();
				this._onListItemAdd(btn.dataset.list);
			}, true);

			// Delete list item
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".steading-list-delete");
				if (!btn) return;
				ev.stopPropagation();
				const { list, index } = btn.dataset;
				this._onListItemDelete(list, parseInt(index, 10));
			}, true);

			// Rows that name an actor: the Player Characters table opens a PC, a
			// Resident/Neighbor row opens its NPC, and the notes pencil opens that NPC's
			// notes instead. All three resolve the row's uuid/id the same way — see
			// module/utils/actor-link.js.
			for (const [selector, missing, use] of [
				[".steading-player-open",       ACTOR_LINK_MISSING.character, null],
				[".steading-member-open",       ACTOR_LINK_MISSING.npc,       null],
				// The pop-up and the NPC sheet share system.notes, so a change here shows on
				// the sheet and vice versa (two-way), both keeping rich text + @UUID links.
				[".steading-member-notes-edit", ACTOR_LINK_MISSING.npc,       openNpcNotesDialog],
			]) {
				html[0].addEventListener("click", async ev => {
					const link = ev.target.closest(selector);
					if (!link) return;
					ev.preventDefault();
					ev.stopPropagation();
					if (use) await withLinkedActor(link, use, missing);
					else await openLinkedActorSheet(link, missing);
				}, true);
			}

			// Places of interest names
			html[0].addEventListener("change", ev => {
				const inp = ev.target.closest(".steading-place-name");
				if (!inp) return;
				ev.stopPropagation();
				this._onPlaceChange(parseInt(inp.dataset.index, 10), inp.value);
			}, true);

// Resident / neighbor / player details
		html[0].addEventListener("change", ev => {
			const inp = ev.target.closest(".steading-resident-input");
			if (!inp) return;
			ev.stopPropagation();
			const { index, field } = inp.dataset;
			// Players and neighbors tag their inputs with data-list; residents omit it and
			// are the default, so a missing data-list means "residents" (never undefined,
			// which would make personFieldPath bail and silently drop the edit).
			const list = inp.dataset.list || "residents";
			if (list === "players") {
				this._onPlayerFieldChange(parseInt(index, 10), field, inp.value);
			} else {
				// list is "residents" or "neighbors" — both go through the shared handler.
				this._onPersonFieldChange(list, parseInt(index, 10), field, inp.value);
			}
			}, true);

			// Notes
			html[0].addEventListener("change", ev => {
				const pm = ev.target.closest("prose-mirror.steading-notes-editor");
				if (!pm) return;
				ev.stopPropagation();
				this._onNotesChange(pm.value);
			}, true);

			// Size radio
			html[0].addEventListener("change", ev => {
				const radio = ev.target.closest(".steading-size-radio");
				if (!radio) return;
				ev.stopPropagation();
				this._stonetopSteading.setFlags({ size: radio.value });
			}, true);

			// Currency
			html[0].addEventListener("change", ev => {
				const inp = ev.target.closest(".steading-currency-input");
				if (!inp) return;
				ev.stopPropagation();
				const { currency, field } = inp.dataset;
				this._onCurrencyChange(currency, field, parseInt(inp.value, 10) || 0);
			}, true);

			// Improvement complete checkbox
			html[0].addEventListener("change", ev => {
				const cb = ev.target.closest(".steading-improvement-complete");
				if (!cb) return;
				ev.stopPropagation();
				this._onImprovementComplete(cb.dataset.slug, cb.checked);
			}, true);

			// Improvement requirement checkbox
			html[0].addEventListener("change", ev => {
				const cb = ev.target.closest(".steading-improvement-req");
				if (!cb) return;
				ev.stopPropagation();
				const { slug, index } = cb.dataset;
				this._onImprovementReq(slug, parseInt(index, 10), cb.checked);
			}, true);

			// Herd of Horses tracker: +/- steppers and direct number entry per age tier.
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest(".steading-herd-step");
				if (!btn) return;
				ev.stopPropagation();
				this._onHerdStep(btn.dataset.tier, parseInt(btn.dataset.delta, 10) || 0);
			}, true);
			html[0].addEventListener("change", ev => {
				const inp = ev.target.closest(".steading-herd-input");
				if (!inp) return;
				ev.stopPropagation();
				this._onHerdInput(inp.dataset.tier, inp.value);
			}, true);

			// The Inn's once-per-season gathering, opened from its improvement card OR from the
			// header's hold glyph, which is the same act reached from the other end of the sheet.
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest("[data-action='inn-gathering']");
				if (!btn || btn.disabled) return;
				ev.stopPropagation();
				this._openInnGathering();
			}, true);

			// Standing the muster down from its header glyph, which is the only place the state
			// is visible and so the only sensible place to end it.
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest("[data-action='stand-down-muster']");
				if (!btn || btn.disabled) return;
				ev.stopPropagation();
				this._standDownMuster();
			}, true);

			// Winter's second consumption, settled from its header glyph. Unlike the other
			// seasonal dues this one outlives the Seasons Change window it was rolled in, so the
			// glyph is the only way back to it (see module/actors/steading/winter-debt.js).
			html[0].addEventListener("click", ev => {
				const btn = ev.target.closest("[data-action='settle-winter-debt']");
				if (!btn || btn.disabled) return;
				ev.stopPropagation();
				openWinterDebtDialog(this._stonetopSteading, { onApplied: () => this.render(false) });
			}, true);

			// Drag-and-drop for adding player characters to the Neighbors tab.
			const neighborsTab = html[0].querySelector(".steading-neighbors-tab");
			const playersSection = html[0].querySelector(".steading-players-section");
			if (neighborsTab) {
				neighborsTab.addEventListener("dragover", (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					ev.dataTransfer.dropEffect = "copy";
					playersSection?.classList.add("drag-over");
				}, true);

				neighborsTab.addEventListener("dragleave", (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					if (!neighborsTab.contains(ev.relatedTarget)) playersSection?.classList.remove("drag-over");
				}, true);

				neighborsTab.addEventListener("drop", async (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					playersSection?.classList.remove("drag-over");
					const data = getDragEventData(ev);
					if (data?.type !== "Actor" || !data.uuid) return;
					const actor = await fromUuid(data.uuid);
					if (!actor) return;
					if (actor.type === "character") {
						await this._onDropPlayerCharacter(actor);
					} else if (actor.type === "npc") {
						// Route an NPC to whichever people section it was dropped over
						// (Residents vs Neighbors); default to Residents.
						const list = ev.target.closest(".steading-residents-section--neighbors") ? "neighbors" : "residents";
						await this._onDropPersonNpc(list, actor);
					}
				}, true);
			}

			// Drop a "Steading Improvement" card (dragged from a journal) onto the
			// Improvements tab to add it as a tracked custom improvement.
			wireCardDropZone(html[0].querySelector(".tab.improvements"),
				STEADING_IMPROVEMENT_DRAG_TYPE, (data) => this._onDropSteadingImprovement(data.improvement));

			// Remove a custom (journal-sourced) improvement.
			html[0].addEventListener("click", (ev) => {
				const btn = ev.target.closest(".steading-improvement-remove");
				if (!btn) return;
				ev.stopPropagation();
				this._onRemoveCustomImprovement(btn.dataset.slug);
			}, true);

			// Create a custom improvement from a small form (the button counterpart to
			// dropping a journal card onto the tab).
			html.find(".steading-improvement-add-btn").on("click", () => this._onCreateImprovementOpen());
		}

		// `box` is the clipping span: it carries the row's data-list / data-index / data-name,
		// while the src lives on the image inside it.
		_openMemberAvatarImage(box) {
			removeAvatarPreview();
			// With this list's pencil open, a tap is a request to CHANGE the portrait, so it goes
			// straight to the gallery rather than making the user open the picture and then find
			// "Edit Photo" in its title bar. Reading the roster, the same tap enlarges the face.
			// Same split the follower cards and every sheet portrait use.
			const list = box?.dataset?.list;
			const index = Number.parseInt(box?.dataset?.index ?? "", 10);
			if (this.isEditable && Number.isInteger(index) && this.isSectionEditable(list)) {
				const imgEl = box.querySelector(".steading-member-avatar-img");
				this._onMemberAvatarPickImage({ list, index, current: imgEl?.getAttribute("src") ?? "" });
				return;
			}
			if (!box?.querySelector?.(".steading-member-avatar-img")?.getAttribute("src")) return;
			const popout = this._createEditableMemberImagePopout(box);
			popout?.render(true);
			this._scheduleMemberImageHeaderControl(popout);
		}

		_createEditableMemberImagePopout(box) {
			const anchor = box?.querySelector?.(".steading-member-avatar-img") ?? box;
			const list = box?.dataset?.list;
			const index = Number.parseInt(box?.dataset?.index ?? "", 10);
			const canEdit = this.isEditable && ["residents", "neighbors"].includes(list) && Number.isInteger(index);
			// Read the ATTRIBUTE, not `.src`: the DOM resolves the latter to an absolute URL, which
			// a query string or hash could hide the filename the swap has to recognise.
			const stored  = anchor.getAttribute?.("src") || anchor.src;
			const display = memberPhotoDisplaySrc(stored);
			// No size: this used to ask for 560x620, which core has been discarding since v13 —
			// ImagePopout measures the picture and sizes its own window (see foundry-compat.js).
			const popout = imagePopout({ src: display, title: anchor.dataset.name ?? "" });
			// The window is the same either way; only a row this user may edit gets the Edit Photo
			// bookkeeping and the binding that keeps it in step with its NPC.
			if (popout && canEdit) {
				popout._stonetopMemberImageEdit = { sheet: this, list, index, current: stored };
				this._bindMemberImagePopoutToActor(popout, list, index);
			}
			return popout;
		}

		// One Residents/Neighbors row as it is STORED, falling back to the defaults a world that
		// has never written the list still shows. Reading only the flag looks right and is wrong
		// for exactly that case — see legacyRowFrameHandle, which makes the same fallback.
		_personRow(list, index) {
			const stored = this._stonetopSteading?._flags?.[list];
			const rows = Array.isArray(stored) ? stored : STEADING_DEFAULTS[list];
			return Array.isArray(rows) ? rows[index] ?? null : null;
		}

		// Keep an open member-image window in sync with its backing NPC. The Edit Photo
		// button patches the popout's `<img>` directly, but that only covers changes made
		// through the popout itself. Watching the actor's `img` instead means the window
		// re-syncs no matter how the portrait changed — the popout's Edit Photo, the
		// People gallery, or the GM editing the portrait on the NPC's own sheet while this
		// window is open. The hook is torn down when the popout closes so it doesn't leak.
		//
		// The same binding the sheet headers' portrait window uses (utils/actor-portrait-picker.js
		// bindImagePopoutToActor); the actor is resolved through the roster's own lookup, so this
		// watches the document the row actually renders rather than trusting `row.id`. The roster
		// hands it its own refresh, which additionally keeps the popout's `current` (the STORED
		// path, which the next Edit Photo reads) in step and re-hangs the header controls if the
		// window had to re-render.
		_bindMemberImagePopoutToActor(popout, list, index) {
			const row = this._personRow(list, index);
			if (!row) return;
			bindImagePopoutToActor(popout, personRowActor(row), {
				onChange: (img) => this._refreshMemberImagePopout(popout, img),
			});
		}

		_scheduleMemberImageHeaderControl(popout) {
			const edit = popout?._stonetopMemberImageEdit;
			if (!edit) return;
			addPopoutHeaderControl(popout, {
				key: "stonetop-edit-member-photo",
				icon: "fa-camera",
				// The same string the sheet portraits' own Edit Photo uses, so the control that
				// opens this gallery cannot come to read two ways depending on where it is met.
				label: localize("stonetop.portraitPicker.popout"),
				onClick: () => this._onMemberAvatarPickImage({
					list: edit.list,
					index: edit.index,
					// `current` is the STORED path — what the member actually wears — and is kept
					// in step by _refreshMemberImagePopout on every change, however it was made.
					// `options.src` is the fallback because it is the DISPLAYED path, which for a
					// gallery portrait is the whole illustration rather than the square on the
					// document; the gallery normalises either, but the stored one is the truth.
					current: edit.current ?? popout.options?.src,
					popout,
				}),
			});

			// Framing is gated on the ROW's document, not the steading's editability: roster NPCs
			// are seeded at OBSERVER, so a player who may edit the steading would otherwise be
			// offered a control whose save the server refuses. personFrameHandle answers that for
			// both row kinds, and returns null when there is nothing writable behind the row.
			// Named from the POPOUT's title, not from a document: a legacy roster row is plain
			// text and has no actor to ask.
			const memberHandle = personFrameHandle(this._stonetopSteading, edit.list, edit.index, { editable: this.isEditable });
			// Before the framing control so it lands to its LEFT, matching the pips on a sheet
			// header. Silently absent for a legacy text row, which has no actor to tokenize.
			addTokenizerControl(popout, memberHandle, { key: "stonetop-tokenize-member-photo" });
			addPortraitFrameControl(
				popout,
				memberHandle,
				{
					key: "stonetop-frame-member-photo",
					// Through the compat reader: v13 moved the window title to
					// `options.window.title`, so a bare `options.title` silently yields "Face"
					// for every member instead of naming the one being framed.
					name: imagePopoutTitle(popout) || "Face",
					// A frame write touches neither `img` nor `options.src`, so the popout's own
					// updateActor binding will not fire and nothing re-renders on its own.
					onSaved: () => this.render(false),
				},
			);
		}

		_onMemberAvatarPickImage({ list, index, current, popout }) {
			// Apply a chosen path (a gallery pick, a browsed file, or "" for the default), keep the
			// open photo popout in sync, and re-render the sheet. Shared by all three routes.
			const applyPath = async (path, pick = null) => {
				await this._onMemberAvatarImageChange(list, index, path, pick);
				if (popout) this._refreshMemberImagePopout(popout, path);
				this.render(false);
			};
			// "Use default" removes the custom photo; the member falls back to the default avatar.
			// Close the (now-stale) photo popout rather than refreshing it: there is no image to
			// show, and _refreshMemberImagePopout no-ops on an empty path, so leaving it open would
			// keep displaying the removed portrait AND feed its stale src back as `current` on the
			// next Edit Photo (wrongly highlighting a portrait the member no longer uses).
			const clearToDefault = async () => {
				await this._onMemberAvatarImageChange(list, index, "");
				if (popout) await popout.close?.();
				this.render(false);
			};
			// Primary path: the "People of Stonetop" gallery of imported book portraits. "Browse
			// files…" falls back to the FilePicker for a custom image; "Use default" clears it.
			// Portraits somebody already wears, so the gallery can mark them and offer to hide
			// them. Two scans, because a face can be taken in two kinds of place: every actor in
			// the world (which reaches a player character and an NPC nobody has put on this
			// roster yet — both of which can now pick from this gallery on their own sheet), and
			// this steading's own legacy text rows, which are not documents at all. The steading
			// goes on top so a roster member's name wins the label. Each scan leaves out the row
			// being edited — by index here, by document there — so this member's own portrait
			// reads as selected rather than as taken.
			openPeoplePortraitPicker({
				current,
				used: {
					...usedActorPortraits(personRowActor(this._personRow(list, index))),
					...usedPersonPortraits(this.actor, { list, index }),
				},
				onPick: applyPath,
				onClear: clearToDefault,
				// A browsed file is the one case with no hand-cut square behind it, so offer the
				// framer straight away rather than making the user find it afterwards. Gallery
				// picks are deliberately not chained: that art is already framed.
				onFrame: () => {
					const handle = personFrameHandle(this._stonetopSteading, list, index, { editable: this.isEditable });
					if (!handle?.canWrite) return;
					openPortraitFrameEditor({ handle, img: handle.img, onSaved: () => this.render(false) });
				},
			});
		}

		// Point an open photo window at a newly chosen portrait, patching it in place so the
		// window keeps its position and size rather than re-rendering under the player.
		_refreshMemberImagePopout(popout, path) {
			if (!popout || !path) return;

			// `path` is what the member now WEARS; the window shows the illustration behind it.
			// The patching itself is the shared one (utils/actor-portrait-picker.js), which also
			// keeps `options.src` — what a re-render and the header's Share Image control both
			// read — in step, and reports whether it had to fall back to a re-render.
			const patched = pointImagePopoutAt(popout, memberPhotoDisplaySrc(path));

			// The next Edit Photo pass reads `current` instead of `options.src`, because it wants
			// the STORED path rather than the illustration on screen.
			if (popout._stonetopMemberImageEdit) popout._stonetopMemberImageEdit.current = path;

			// A re-render builds a fresh window header, so the controls have to be hung again.
			if (!patched) this._scheduleMemberImageHeaderControl(popout);
		}

		// `pick` is what the gallery tile carried alongside the path — `{frame, square}` — because
		// the picture, the square it crops to and the file the map draws are one choice. Null for
		// a browsed file and for "Use default", both of which correctly leave no frame behind.
		async _onMemberAvatarImageChange(list, index, value, pick = null) {
			if (!["residents", "neighbors"].includes(list) || !Number.isInteger(index)) return;
			const f = this._stonetopSteading._flags;
			const rows = f[list] ?? STEADING_DEFAULTS[list];
			const row = rows[index];
			// Actor-backed row: the portrait is the NPC actor's own image, and it is a real
			// document with a prototype token — so this is the same three-field write the sheet
			// header's own picker makes. See actorPortraitPickUpdate.
			if (row && isActorRow(row)) {
				const actor = (row.id ? game.actors?.get(row.id) : null)
					|| (row.uuid ? await fromUuid(row.uuid).catch(() => null) : null);
				// Clearing a portrait returns the person to the people silhouette, which is what
				// the roster draws for an un-portraited member anyway — so the cleared row looks
				// the same here as one that never had art, rather than reverting to mystery-man.
				if (actor) {
					await actor.update(actorPortraitPickUpdate(actor, value || PERSON_DEFAULT_IMG, pick ?? {}));
				}
				return;
			}
			// A legacy text row keeps its frame on the row object itself, beside the img — so both
			// move in ONE write, because they are one choice. saveLegacyPersonRow owns how this
			// list is stored (the whole array back, which is what lets a plain `delete` land) and
			// refuses an actor-backed row, which the branch above has already taken anyway.
			await saveLegacyPersonRow(this._stonetopSteading, list, index, (r) => {
				r.img = value;
				const frame = normalizeFrame(pick?.frame);
				if (frame) r.portraitFrame = frame;
				else delete r.portraitFrame;
			});
		}

		/**
		 * A homefront move's dialog: what the move says, what its tiers do, and the button that
		 * rolls it. The only controls it ever shows are the two Trade & Barter's dice actually
		 * read (Value, winter) plus its special-item picker — everything a player would have
		 * typed into it went nowhere, and every list it used to make them tick before the roll
		 * now rides the result card, under the tier that calls for it.
		 */
		_onHomesteadMove(moveSlug) {
			const flow = HOMESTEAD_MOVE_FLOWS[moveSlug];
			if (!flow) return;

			const fieldHtml = (flow.fields ?? []).map(field => {
				if (field.type === "checkbox") {
					return `<label class="stonetop-homestead-field stonetop-homestead-field--check">
						<input type="checkbox" class="stonetop-check" name="${_esc(field.name)}" value="yes">
						<span>${_esc(field.label)}</span>
					</label>`;
				}
				return `<label class="stonetop-homestead-field">
					<span>${_esc(field.label)}</span>
					<input type="number" name="${_esc(field.name)}" placeholder="${_esc(field.placeholder)}" min="${field.min ?? 0}" value="${field.value ?? ""}">
				</label>`;
			}).join("");

			// Trade & Barter is how special items are acquired — let the player pick one from the
			// handout list. The pick fills the Value field for the roll, adds the item to a
			// character's inventory, and names itself in the chip beside the button (which is a
			// readout, not an input: nothing reads it back).
			const specialItemHtml = flow.label === "Trade & Barter"
				? `<div class="stonetop-tb-special">
					<button type="button" class="stonetop-tb-special-btn"><i class="fas fa-gem"></i> Choose a special item…</button>
					<span class="stonetop-tb-special-chosen" data-tb-chosen hidden="hidden"></span>
				</div>`
				: "";

			new Dialog({
				title: flow.label,
				content: `<form class="stonetop-homestead-dialog">
					<p class="stonetop-homestead-trigger"><em>${_esc(flow.trigger)}</em></p>
					${fieldHtml ? `<div class="stonetop-homestead-fields">${fieldHtml}</div>` : ""}
					${specialItemHtml}
					${_resultsLegendHtml(flow.results)}
					<p class="stonetop-homestead-note">${_esc(flow.note)}</p>
				</form>`,
				buttons: {
					cancel: { label: "Cancel" },
					roll: {
						label: `Roll +${flow.statLabel}`,
						// The prompt comes first, ahead of the move's own before-the-roll costs, so
						// backing out of it is a clean abort: nothing spent, nothing posted.
						// `_homesteadRollOptions` spreads AFTER the prompt because the one mode it
						// carries is a rule, not a preference — Trade & Barter in winter is at
						// disadvantage whatever was picked.
						callback: async html => {
							const prompted = await promptRoll({ title: flow.label });
							if (!prompted) return;
							await this._applyHomesteadBeforeRoll(flow);
							await this._onSteadingRoll(flow.label, flow.stat, {
								...prompted, ...this._homesteadRollOptions(flow, html),
							});
						},
					},
				},
				default: "roll",
				render: (html) => {
					html[0].querySelector(".stonetop-tb-special-btn")?.addEventListener("click", () => this._onPickSpecialItem(html));
				},
			}, {
				width: 520,
				classes: ["dialog", "stonetop", "stonetop-homestead-move-dialog"],
			}).render(true);
		}

		// Trade & Barter: open the Special Items picker. Picking an item sets the move's Value
		// (the modifier the roll subtracts), names itself in the chip beside the button, and
		// adds itself to a chosen character's inventory.
		_onPickSpecialItem(dialogHtml) {
			const picker = new SpecialItemPickerDialog(SPECIAL_ITEM_CATALOG, async (slug) => {
				const item = SPECIAL_ITEM_CATALOG.flatMap(g => g.items).find(i => i.slug === slug);
				if (!item) return;
				const valueField = dialogHtml[0].querySelector('[name="value"]');
				if (valueField) valueField.value = parseInt(item.value, 10) || 0;
				const chosen = dialogHtml[0].querySelector("[data-tb-chosen]");
				if (chosen) {
					chosen.textContent = item.traits ? `${item.name} (${item.traits})` : item.name;
					chosen.removeAttribute("hidden");
				}

				const character = await this._promptSpecialItemCharacter();
				if (character) {
					await new CharacterInventory(new StonetopFlags(character, "inventory")).addSpecial(slug);
					ui.notifications.info(`${item.name} added to ${character.name}.`);
				}
				picker.close();
			});
			picker.render(true);
		}

		_promptSpecialItemCharacter() {
			const chars = game.actors.filter(a => a.type === "character" && a.isOwner);
			if (!chars.length) {
				ui.notifications.warn("No editable character to add the item to.");
				return Promise.resolve(null);
			}
			return new Promise(resolve => {
				new Dialog({
					title: "Add to which character?",
					content: `<form class="stonetop-tb-char-pick"><label>Character
						<select name="char">${chars.map(c => `<option value="${c.id}">${_esc(c.name)}</option>`).join("")}</select></label></form>`,
					buttons: {
						cancel: { label: "Cancel", callback: () => resolve(null) },
						add:    { label: "Add", callback: html => resolve(game.actors.get(html[0].querySelector('[name="char"]').value)) },
					},
					default: "add",
					close: () => resolve(null),
				}, { classes: ["dialog", "stonetop", "stonetop-tb-char-pick-dialog"] }).render(true);
			});
		}

		_formDataFromDialog(html) {
			const form = html[0]?.querySelector(".stonetop-homestead-dialog");
			return form ? Object.fromEntries(new FormData(form)) : {};
		}

		async _applyHomesteadBeforeRoll(flow) {
			if (flow.beforeRoll !== "musterCost") return;
			const fortunes = this._stonetopSteading.getStatValue("fortunes");
			await this._stonetopSteading.setSystemValue("stats.fortunes.value", Math.max(fortunes - 1, -1));
			this.render(false);
			ui.notifications.info(`Muster cost applied: Fortunes ${ sign(fortunes) } -> ${ sign(Math.max(fortunes - 1, -1)) }.`);
		}

		// What the dialog adds to the roll. Every flow's tier text, legend, pick pools and tier
		// actions come off the flow itself in _onSteadingRoll — shared with the bare roll button
		// on the Moves tab, which has no dialog to read — so all that is left here is the one
		// move whose dialog holds controls: Trade & Barter's Value and its winter disadvantage.
		_homesteadRollOptions(flow, html) {
			if (flow.label !== "Trade & Barter") return {};
			const data = this._formDataFromDialog(html);
			const value = Math.max(0, parseInt(data.value, 10) || 0);
			return {
				modifier: value ? -value : 0,
				// Only present when it applies. It is spread over the player's prompt answer, so
				// a key that is always there would blank their choice with `undefined` every
				// other season of the year.
				...(data.winter ? { rollMode: "dis" } : {}),
			};
		}

		async _onMeetWithDisaster() {
			const fortunes = this._stonetopSteading.getStatValue("fortunes");
			const wouldDropBelow = fortunes <= -1;

			if (!wouldDropBelow) {
				const newFortunes = fortunes - 1;
				new Dialog({
					title: "Meet with Disaster",
					content: `<div class="stonetop-disaster-dialog">
						<p><em>Calamity befalls the steading or panic spreads.</em></p>
						<p>Fortunes: <strong>${sign(fortunes)}</strong> → <strong>${sign(newFortunes)}</strong></p>
					</div>`,
					buttons: {
						cancel: { label: "Cancel" },
						apply: {
							label: "Apply",
							callback: async () => {
								await this._stonetopSteading.setSystemValue("stats.fortunes.value", newFortunes);
								this.render(false);
							},
						},
					},
					default: "apply",
				}, { classes: ["dialog", "stonetop", "stonetop-disaster-move-dialog"] }).render(true);
				return;
			}

			// Fortunes is at -1 — would drop further; GM picks a consequence instead.
			const choices = [
				{
					id: "diminished",
					label: "Diminished",
					detail: "from injuries/sickness/doubt — disadvantage to Deploy, Muster, Pull Together",
					action: () => this._stonetopSteading.setSystemValue("attributes.debilities.options.diminished.value", true),
				},
				{
					id: "lacking",
					label: "Lacking",
					detail: "due to shortages/hoarding/distrust — treat Prosperity as 1 lower",
					action: () => this._stonetopSteading.setSystemValue("attributes.debilities.options.lacking.value", true),
				},
				{
					id: "malcontent",
					label: "Malcontent",
					detail: "from fear/anger/despair — Fortunes reset to +0 each season; folks need Persuading more often",
					action: () => this._stonetopSteading.setSystemValue("attributes.debilities.options.malcontent.value", true),
				},
				{
					id: "population",
					label: "Folks start to leave",
					detail: "reduce Population by 1 (min −1)",
					action: () => {
						const pop = this._stonetopSteading.getStatValue("population");
						return this._stonetopSteading.setSystemValue("attributes.population.value", Math.max(pop - 1, -1));
					},
				},
			];

			const choicesHtml = choices.map(c => `
				<li class="stonetop-disaster-choice" data-choice="${c.id}">
					<span class="stonetop-disaster-choice-label">${c.label}</span>
					<span class="stonetop-disaster-choice-detail">${c.detail}</span>
				</li>`).join("");

			// `const`, even though the render/button callbacks below refer to `dialog`: they run
			// after this statement completes, so the binding is always initialised by then.
			const dialog = new Dialog({
				title: "Meet with Disaster",
				content: `<div class="stonetop-disaster-dialog">
					<p><em>Fortunes cannot drop below −1.</em> The GM picks 1:</p>
					<ol class="stonetop-disaster-choices">${choicesHtml}</ol>
				</div>`,
				buttons: { cancel: { label: "Cancel" } },
				render: (html) => {
					html[0].querySelectorAll(".stonetop-disaster-choice").forEach(el => {
						el.addEventListener("click", async () => {
							const choice = choices.find(c => c.id === el.dataset.choice);
							if (!choice) return;
							await choice.action();
							this.render(false);
							dialog.close();
						});
					});
				},
			}, { classes: ["dialog", "stonetop", "stonetop-disaster-move-dialog"] });
			dialog.render(true);
		}

		// Return Triumphant: clear one marked steading debility, or raise Fortunes by 1 when
		// none are marked. The walkthrough itself lives in ./return-triumphant.js, because the
		// last step of the Run an Expedition guide offers the same move — that is where a table
		// is when it comes up — and two copies would eventually disagree about what it does.
		async _onReturnTriumphant() {
			openReturnTriumphant(this._stonetopSteading, { onApplied: () => this.render(false) });
		}

		async _onRequisitionWalkthrough() {
			const fortunes = this._stonetopSteading.getStatValue("fortunes");
			const newFortunes = Math.max(fortunes - 1, -1);
			const availableAssets = this._stonetopSteading.getAvailableAssets();
			const assetOptions = availableAssets
				.map(asset => `<option value="${escHtml(asset.name)}">${escHtml(asset.name)}</option>`)
				.join("");
			// Single source for the three outcome lines; both the dialog reference block
			// and the chat card's legend + per-tier text derive from it (see the season flows).
			const requisitionResults = [
				RESULT.strong("go ahead, but bring it back safely."),
				RESULT.weak("you will need to do some convincing."),
				RESULT.miss("do not mark XP; you can take the asset, but if you do, reduce Fortunes by 1."),
			];

			const dialog = new Dialog({
				title: "Requisition",
				content: `<form class="stonetop-homestead-dialog">
					<p class="stonetop-homestead-trigger"><em>When you borrow some of the steading's assets for an expedition or otherwise put them at risk, roll +Fortunes.</em></p>
					<div class="stonetop-homestead-fields">
						<label class="stonetop-homestead-field">
							<span>Asset</span>
							<select class="stonetop-requisition-asset-select" data-requisition-asset-select>
								${assetOptions}
								<option value="${CUSTOM_ASSET_VALUE}">Something else...</option>
							</select>
							<input type="text" class="stonetop-requisition-custom-input" data-requisition-custom-asset placeholder="Enter an asset or item" disabled hidden>
							<input type="hidden" name="asset" data-requisition-asset-value value="${availableAssets[0]?.name ? escHtml(availableAssets[0].name) : ""}">
						</label>
					</div>
					${_resultsLegendHtml(requisitionResults)}
				</form>`,
				buttons: {
					cancel: { label: "Cancel" },
					roll: {
						label: "Roll +Fortunes",
						// The asset is the one thing a homefront dialog still says out loud, because
						// it is the one thing a homefront dialog still chooses — the whole move is
						// "I am borrowing THIS", and the miss-cost button on the card below is about
						// keeping it. Posted after the prompt, so cancelling leaves no card behind.
						callback: async html => {
							const prompted = await promptRoll({ title: "Requisition" });
							if (!prompted) return;
							const asset = String(this._formDataFromDialog(html).asset ?? "").trim();
							if (asset) postMoveToChat(this.actor, "Requisition", [{ label: "Asset", value: asset }]);
							await this._onSteadingRoll("Requisition", "fortunes", {
								...prompted,
								moveResults: _moveResultsFromRows(requisitionResults),
								resultLegend: _resultsLegendHtml(requisitionResults),
								tierActions: {
									failure: `<button type="button" class="stonetop-requisition-miss-cost" data-action="requisition-miss-cost">
										<i class="fas fa-arrow-down"></i> Take it on a miss: Fortunes ${sign(fortunes)} -> ${sign(newFortunes)}
									</button>`,
								},
							});
						},
					},
				},
				default: "roll",
				render: html => {
					const root = html[0];
					wireCustomAssetSelect({
						select: root.querySelector("[data-requisition-asset-select]"),
						customInput: root.querySelector("[data-requisition-custom-asset]"),
						valueInput: root.querySelector("[data-requisition-asset-value]"),
					});
				},
			}, { width: 520, classes: ["dialog", "stonetop", "stonetop-homestead-move-dialog"] });
			dialog.render(true);
		}

		// The campaign year the Seasons Change flow is currently on (a steading flag,
		// starting at 1). Advanced by one each time a Winter is completed (see
		// _saveSeasonChange), so the season picker defaults to the latest year.
		_seasonsCurrentYear() {
			return readCurrentYear(this.actor);
		}

		// Set the header's clock by hand, without running the Seasons Change move — the move
		// applies seasonal gains, resets Fortunes and writes a journal entry, none of which a
		// GM wants when they're only correcting what the header says. Needed by any table that
		// was already mid-campaign when the readout shipped (their clock has never been
		// stamped) and by the mis-clicked season. GM-only; only a GM can reach it at all.
		//
		// NOT what the header's clock opens. Correcting the clock happens about once in a
		// campaign, where the move happens four times a year, and the clock is the most
		// obvious thing on the sheet to click when the seasons turn — so the header runs the
		// MOVE, and this is one click further in, off the door at the bottom of that window.
		//
		// Deliberately the same cards-and-year-field shape as the move's own picker, so the two
		// read as the same question. The clock can be set to any year, including one ahead of
		// anything played — picking it carries `seasonsCurrentYear` along, or the move's picker
		// would still default a year behind.
		//
		// @param {number} [openOn]  The year to open on, handed over by the move's picker so a
		//   GM who has already dialled one in does not type it twice to change which question
		//   they are answering. Falls back to the stamp, then to the campaign's current year.
		async _onSetCurrentSeason(openOn) {
			if (!game.user?.isGM) return;
			const stamped  = readCurrentSeason(this.actor);
			const pickYear = openOn ?? stamped?.year ?? this._seasonsCurrentYear();
			openSeasonPicker({
				title:  "Set the Current Season",
				prompt: "Which season is Stonetop in?",
				note:   "Only changes what the sheet says. It doesn't make the Seasons Change move.",
				selected: stamped?.season ?? null,
				selectedYear: pickYear,
				// The high-water mark, for the picker's hint alone — not a ceiling. Both halves
				// of the clock are candidates because they move independently: `seasonsCurrentYear`
				// runs a year ahead of the stamp for the whole of a completed Winter.
				latestYear: Math.max(this._seasonsCurrentYear(), stamped?.year ?? 1),
				// One write for both halves of the clock. The move's picker defaults to
				// `seasonsCurrentYear`, so setting the clock ahead has to carry it; `pickerYear`
				// defaults to the stamped year, and the never-rewind guard lives in
				// recordCurrentSeason.
				onPick: (season, year) => recordCurrentSeason(this.actor, season, year),
			});
		}

		// The move itself, and what all three ways in reach: the hotbar macro, the Seasons
		// Change move card, and the header's clock. Picks a season and a year, then opens the
		// move's own dialog — the rules, the seasonal gains, the Fortunes roll, Done.
		async _onSeasonsChange() {
			// Opens on the current year (Winter completion bumps it), which is also the
			// high-water mark the picker's hint is measured against — a table catching the
			// sheet up mid-campaign can type past it. The chosen year rides through to
			// recordSeasonsChange, which files the season into that year's Chronicle page.
			const currentYear = this._seasonsCurrentYear();
			openSeasonPicker({
				title:  "Seasons Change",
				prompt: "Which season is beginning?",
				selectedYear: currentYear,
				latestYear:   currentYear,
				// Openable from a hotbar macro, away from the sheet, so this one offers the jump.
				headerShortcut: true,
				// The door to the other flow. This picker is what the header's clock opens, and
				// a GM who clicked it meaning to fix a mis-typed season has to be able to get
				// there from here — the two windows ask nearly the same question and are told
				// apart by intent alone, so the one you land in owes you the other. GM-only,
				// like the flow it opens, and the header only offers the clock to a GM anyway.
				altAction: game.user?.isGM ? {
					ask:   "Only correcting what the sheet says?",
					label: "Set the season without making the move.",
					onRun: (year) => this._onSetCurrentSeason(year),
				} : null,
				onPick: (season, year) => this._showSeasonDialog(season, year),
			});
		}

		// Read the season dialog's ticked gains + notes off the DOM (Done), apply the two
		// gains with a mechanical effect (Population boom, Unexpected bounty), reset Fortunes
		// for the new season, record this season into the chosen `year`'s page of the
		// "Seasons Change" Chronicle journal (with the net Surplus change since the dialog
		// opened), then open it. Completing a Winter advances the steading's current year so
		// the next picker defaults to the new one. GM-only.
		async _saveSeasonChange(seasonId, html, fortunes, resetFortunes = 1, initialSurplus = null, year = this._seasonsCurrentYear()) {
			const root = html?.jquery ? html[0] : (html?.[0] ?? html);
			if (!root) return;
			const checkedKeys = Array.from(root.querySelectorAll(".stonetop-season-gain-check:checked"))
				.map(el => el.dataset.gainKey);
			const gainNames = checkedKeys
				.map(key => SEASONAL_GAINS.find(g => g.key === key)?.name)
				.filter(Boolean);

			// Apply the mechanical gains the GM ticked (the others are narrative-only) and
			// reset Fortunes in one update — all effects of the Seasons Change homefront
			// move, so the ledger names it; batching keeps it to a single ledger append and
			// one combined stat-change card. Notices are queued so they still read in the
			// Population → Bounty → Fortunes order.
			const updates = {};
			const notices = [];
			if (checkedKeys.includes("population")) {
				const newPopulation = Math.min(this._stonetopSteading.getStatValue("population") + 1, 3);
				updates["attributes.population.value"] = newPopulation;
				notices.push(`Population boom: Population increased to ${sign(newPopulation)}.`);
			}

			// Net Surplus change over the whole season flow (the harvest/bounty, or winter
			// consumption): the live value already reflects the season's surplus/consumption
			// buttons, plus the bounty we're about to add. Computed locally so it doesn't
			// depend on reading the value back after the write.
			const finalSurplus = this._stonetopSteading.getStatValue("surplus") + (checkedKeys.includes("bounty") ? 1 : 0);
			if (checkedKeys.includes("bounty")) {
				updates["attributes.surplus.value"] = finalSurplus;
				notices.push(`Unexpected bounty: Surplus increased to ${finalSurplus}.`);
			}

			updates["stats.fortunes.value"] = resetFortunes;
			notices.push(`Fortunes reset to ${sign(resetFortunes)}.`);

			// Tor's blessing is the one gain that leaves something BEHIND: "+1 to Pull Together
			// this season, and when you roll the Die of Fate for weather, roll twice and take
			// your pick." Recorded against this year+season so it expires by simply ceasing to
			// match the clock, and shows in the header while it lasts. The other four ticked
			// gains are either applied above or narrative, and leave nothing to track.
			const flagUpdates = {};
			if (checkedKeys.includes("tor")) {
				Object.assign(flagUpdates, this._stonetopSteading.torsBlessingFlags(year, seasonId));
				notices.push("Tor's blessing holds for the season.");
			}

			// A muster does not survive the turning of the season ("until the threat passes, the
			// Seasons Change, or you cease to oversee it"). It would lapse on its own by the
			// clock, but a muster that took the +1 Defenses has to be stood DOWN rather than
			// simply forgotten, or the bonus is stranded on the sheet with nothing left to
			// explain it. Read raw, since the clock may already have moved past it.
			const lapse = this._stonetopSteading.musterLapseChanges();
			if (lapse) {
				Object.assign(updates, lapse.system);
				Object.assign(flagUpdates, lapse.flags);
				notices.push(lapse.held.defenses
					? "The muster lapses with the season; its +1 Defenses is given back."
					: "The muster lapses with the season.");
			}

			await this._stonetopSteading.applyChanges(
				{ system: updates, flags: flagUpdates }, { stonetopMove: "Seasons Change" });
			for (const notice of notices) ui.notifications.info(notice);

			const surplusChange = Number.isFinite(initialSurplus) ? finalSurplus - initialSurplus : 0;

			const notes   = root.querySelector(".stonetop-season-notes")?.value ?? "";
			const journal = await recordSeasonsChange({ seasonId, year, gainNames, fortunes, surplusChange, notes });

			// This season has begun: stamp it on the steading so the sheet header reads it,
			// and carry the picker's year with it in the same write. Winter closes out the
			// year, so it hands the picker the NEXT one; every other season leaves the count
			// where it is (a `pickerYear` already behind is a no-op).
			//
			// advanceOnly because re-recording an older season to fix its journal entry
			// mustn't rewind the header's clock, and recordCurrentSeason owns the matching
			// guard against an out-of-order older Winter regressing the year.
			await recordCurrentSeason(this.actor, seasonId, year, {
				advanceOnly: true,
				pickerYear:  seasonId === "winter" ? year + 1 : year,
			});

			journal?.sheet?.render(true);
		}

		async _showSeasonDialog(seasonId, year = this._seasonsCurrentYear()) {
			// The seasons have turned: post a chat card reminding the table of any
			// character's seasonal move/possession upkeep (Rites of the Land, Collected
			// offerings, etc.).
			postSeasonsChangeReminder(seasonId);

			const fortunes   = this._stonetopSteading.getStatValue("fortunes");
			const surplus    = this._stonetopSteading.getStatValue("surplus");
			const population = this._stonetopSteading.getStatValue("population");
			const malcontent = this._stonetopSteading.getSystemValue("attributes.debilities.options.malcontent.value", false);
			const resetFortunes = malcontent ? 0 : 1;

			const label   = seasonLabel(seasonId);
			const iconSrc = seasonIconSrc(seasonId);

			// The season beside its icon, and the year in the same stadium chip the steading
			// header's clock wears. NOT in the season's ink: those four colours belong to the
			// header's clock and nowhere else — see the token block in styles/stonetop.css. The
			// season is named by the window title, by this heading and by its glyph already; a
			// colour spent here would be the fourth thing saying it and the second place teaching
			// the eye that a coloured season means something.
			//
			// The icon's `alt` is empty on purpose, as it is on the picker's cards: the <h3> right
			// beside it names the season in text, and a filled alt would say "Spring" twice.
			const header = `<div class="stonetop-season-flow-header">
				<img src="${iconSrc}" alt="" class="stonetop-season-icon-sm">
				<h3 class="stonetop-season-flow-title">${label}</h3>
				<span class="stonetop-season-flow-year stonetop-year-chip">${yearLabel(year)}</span>
			</div>`;

			const statsNote = `<p class="stonetop-season-note">Fortunes: <strong>${sign(fortunes)}</strong> &nbsp;·&nbsp; Surplus: <strong>${surplus}</strong> &nbsp;·&nbsp; Population: <strong>${sign(population)}</strong></p>`;

			// ── What the steading's improvements do to this season ───────────────────────
			// Ten of the book's improvements end in a seasonal "Henceforth…", and the window used
			// to know three of them. The arithmetic lives in season-effects.js, pure; what happens
			// here is only rendering it and hanging the buttons off it.
			const has = slug => this._hasImprovement(slug);

			// Additional Housing's harvest penalty turns on WHICH of the two ways it was built,
			// which is a rule and so lives in season-effects.js beside the militia's — see
			// builtOnTheFields there for why it is read off the requirement box by its text.
			const harvest = autumnHarvest({ has, builtOnTheFields: this._builtOnTheFields() });
			const winterBill = winterConsumption({ population, has });
			// Winter's 7-9 asks for the same roll a second time, so its ladder line names what THIS
			// steading would roll rather than the book's general 1d4+Population — a Township that
			// read "1d4" there and then watched 2d6 come up would have to guess which was right.
			const winterAgain = winterConsumption({ population, has, second: true });
			const yields = seasonalYields({ seasonId, population, has });

			// One line naming every improvement that rewrote a roll, under the button that rolls
			// it. Without it the dice simply change and nothing on screen says why — which is the
			// same complaint as a formula the GM is asked to trust.
			const partsNote = parts => parts.length > 1
				? `<p class="stonetop-season-note">${parts.map(p => `${_esc(p.label)}: <strong>${_esc(p.amount)}</strong>`).join(" &nbsp;·&nbsp; ")}</p>`
				: "";

			// Spring hands the roll to the table (the most hopeful PC rolls in chat), so it
			// shows "Ask the most hopeful…" where the other seasons show "Roll +Fortunes".
			// "Whatever the result, reset Fortunes to +1" is the close-out of every season,
			// so it's folded into Done (see _saveSeasonChange) rather than a separate button.
			const rollOrAskBtn = seasonId === "spring"
				? `<button class="stonetop-season-btn" data-action="ask-hopeful">
					<i class="fas fa-comment-dots"></i> Ask the most hopeful to roll (in chat)
				</button>`
				: `<button class="stonetop-season-btn" data-action="roll-fortunes">
					<i class="fas fa-dice-d6"></i> Roll +Fortunes (current: ${sign(fortunes)})
				</button>`;
			const fortunesBtns = `<div class="stonetop-season-actions">
				${rollOrAskBtn}
			</div>`;

			// Seasonal gains as a checklist the GM ticks (recorded into the Seasons Change
			// journal on Done). The two with a mechanical effect — Population boom (+1
			// Population) and Unexpected bounty (+1 Surplus) — are applied on Done when
			// ticked rather than via their own buttons; the Done button relabels to say so.
			// Gain copy comes from the shared SEASONAL_GAINS so the dialog and Chronicle
			// stay in lockstep.
			const gainsRef = `<div class="stonetop-season-gains">
				<p class="stonetop-season-gains-label">Seasonal gains <span class="stonetop-season-gains-hint">(tick what they pick)</span></p>
				<ul class="stonetop-season-gains-list">
					${SEASONAL_GAINS.map(g => `<li class="stonetop-season-gain">
						<label class="stonetop-season-gain-label">
							<input type="checkbox" class="stonetop-season-gain-check" data-gain-key="${g.key}">
							<span class="stonetop-season-gain-body">
								<span class="stonetop-season-gain-name">${g.name}</span>
								<span class="stonetop-season-gain-text">${g.text}</span>
							</span>
						</label>
					</li>`).join("")}
				</ul>
			</div>`;

			// Free-text notes recorded onto the season's Chronicle page on Done (the omen,
			// the threat that surfaced, the hook it opens).
			const notesBlock = `<div class="stonetop-season-notes-wrap">
				<label class="stonetop-season-notes-label"><i class="fas fa-feather"></i> Notes for the Chronicle</label>
				<textarea class="stonetop-season-notes" rows="2" placeholder="The omen, threat, or hook this season opens…"></textarea>
			</div>`;

			// Standing Watch: "At the start of each season, the watch consumes 1 Surplus or it
			// disbands." EVERY season, unlike the herd's summer/winter steps, so this block is
			// appended to all four. Both outcomes are offered as buttons because the book makes
			// them a genuine choice, not a failure state: a steading that would rather keep the
			// Surplus can let the watch go. Feeding is hidden outright with no Surplus to feed it
			// with, which leaves disbanding as the only thing the season can do.
			const watchBlock = this._hasImprovement("standingWatch") ? `<hr class="stonetop-season-divider">
				<div class="stonetop-season-watch">
					<p class="stonetop-season-note"><i class="fas fa-shield-halved"></i> <strong>Standing Watch</strong> consumes <strong>1 Surplus</strong> at the start of the season, or it disbands. Surplus: <strong>${surplus}</strong>.</p>
					<div class="stonetop-season-actions">
						${surplus >= 1 ? `<button class="stonetop-season-btn" data-action="feed-watch">
							<i class="fas fa-drumstick-bite"></i> Feed the watch (1 Surplus)
						</button>` : ""}
						<button class="stonetop-season-btn stonetop-season-btn--warn" data-action="disband-watch">
							<i class="fas fa-person-walking-arrow-right"></i> Disband the watch
						</button>
					</div>
				</div>` : "";

			// Weapons of War: "Each spring, the village must expend 1 Surplus to maintain and
			// replace the town's weapons." SPRING only, and unlike the watch the book names no
			// penalty for skipping it, so there is one button and no disband twin — what a
			// neglected ballista costs is the GM's to say, not ours to automate.
			const weaponsBlock = (seasonId === "spring" && this._hasImprovement("weaponsOfWar"))
				? `<hr class="stonetop-season-divider">
				<div class="stonetop-season-watch">
					<p class="stonetop-season-note"><i class="fas fa-hammer"></i> <strong>Weapons of War</strong> want <strong>1 Surplus</strong> this spring, to maintain and replace them. Surplus: <strong>${surplus}</strong>.</p>
					${surplus >= 1 ? `<div class="stonetop-season-actions">
						<button class="stonetop-season-btn" data-action="pay-weapons">
							<i class="fas fa-hammer"></i> Pay the upkeep (1 Surplus)
						</button>
					</div>` : `<p class="stonetop-season-note"><em>No Surplus to spend. What the neglect costs is the GM's call.</em></p>`}
				</div>` : "";

			// Well-Trained Militia: "Each summer, the militia must spend 1 Surplus and a week or so
			// practicing or else lose its training in 1 tactic." SUMMER only, and the watch's shape
			// rather than the weapons' — the book prices the neglect here, so both outcomes are
			// offered and taking either settles the season.
			//
			// WHICH tactic is lost is the table's, not ours: the book says "1 tactic" and names no
			// order, so the trained ones are listed and one is clicked, the way winter's four
			// consequences are. They are the improvement's own requirement boxes, so losing one
			// un-ticks the box that recorded the drilling.
			const drillsDue = seasonId === "summer" && this._hasImprovement("wellTrainedMilitia");
			const tactics = drillsDue ? this._militiaTactics() : [];
			const militiaBlock = drillsDue
				? `<hr class="stonetop-season-divider">
				<div class="stonetop-season-watch">
					<p class="stonetop-season-note"><i class="fas fa-bullseye"></i> <strong>Well-Trained Militia</strong> wants <strong>1 Surplus</strong> and a week of drills this summer, or it loses its training in 1 tactic. Surplus: <strong>${surplus}</strong>.</p>
					${surplus >= 1 ? `<div class="stonetop-season-actions">
						<button class="stonetop-season-btn" data-action="drill-militia">
							<i class="fas fa-bullseye"></i> Drill this summer (1 Surplus)
						</button>
					</div>` : ""}
					${tactics.length
						? `<p class="stonetop-season-note"><em>${surplus >= 1 ? "Or skip" : "No Surplus for the drills"}: the militia forgets one of these. Click the one it loses.</em></p>
							<ol class="stonetop-disaster-choices">
								${tactics.map(t => `<li class="stonetop-disaster-choice" data-tactic="${t.index}">
									<span class="stonetop-disaster-choice-label">${_esc(String(t.label).split(":")[0])}</span>
									<span class="stonetop-disaster-choice-detail">${_esc(t.label)}</span>
								</li>`).join("")}
							</ol>`
						: `<p class="stonetop-season-note"><em>The militia has no trained tactics left to lose.</em></p>`}
				</div>` : "";

			// Aurochs Hunting, and the one seasonal improvement that gets a LINE rather than a
			// button. "When you lead the aurochs hunt in spring, roll +Defenses" is a thing the
			// steading DOES at some point during spring, not a thing the turning of the season does
			// to it — the same distinction the Inn's gathering is filed under (see inn-gathering.js,
			// which says outright that a once-per-season thing with a fictional trigger belongs on
			// the improvement card and not in this window). Giving it a roll button here would
			// teach the table that the hunt happens when the Seasons Change, which is not what the
			// book says and would quietly pin a whole expedition to one click in a GM's window.
			//
			// So spring says it is available and where to run it, which closes the only gap that
			// mattered: a GM working through spring had nothing at all to remind them it exists.
			const aurochsNote = (seasonId === "spring" && this._hasImprovement("aurochsHunting"))
				? `<p class="stonetop-season-note"><i class="fas fa-cow"></i> The herds are on the Flats: <strong>Aurochs Hunting</strong> is open this spring. It is led when the group leads it, not when the season turns, so it is rolled from its own card on the Improvements tab.</p>`
				: "";

			// The Inn's own +Fortunes roll — a SECOND roll the season makes, not a variant of the
			// season's. "Henceforth, when the Seasons Change, whoever is friendliest rolls
			// +Fortunes", with no season named, so it is offered in all four.
			//
			// Handed to the table rather than rolled here, for the same reason spring's is: the
			// friendliest is a player. It does NOT spend a held +Fortunes advantage — that hold is
			// Rites of the Land's, promised to the steading's own roll, and which of two rolls in
			// one window counts as "next" is a ruling the table makes, not one to make for them.
			const innRollBlock = this._hasImprovement("inn") ? `<hr class="stonetop-season-divider">
				<div class="stonetop-season-watch">
					<p class="stonetop-season-note"><i class="fas fa-beer-mug-empty"></i> <strong>The Inn</strong>: whoever is friendliest rolls +Fortunes. On a <strong>10+</strong>, ask the GM 3 questions about the wider world; on a <strong>7-9</strong>, ask 1; on a <strong>6-</strong>, ask 1, but the GM describes some trouble that stems from the inn or its guests.</p>
					<div class="stonetop-season-actions">
						<button class="stonetop-season-btn" data-action="ask-friendliest">
							<i class="fas fa-comment-dots"></i> Ask the friendliest to roll (in chat)
						</button>
					</div>
				</div>` : "";

			// What the season's improvements generate, one row each. Separate buttons rather than
			// one "take it all", because they are separate rules with separate conditions and two
			// of them wait on a roll this window cannot read — and because a once-per-season marker
			// per row is what stops a reopen taking any single one of them twice.
			const yieldsBlock = yields.length ? `<hr class="stonetop-season-divider">
				<div class="stonetop-season-yields">
					<p class="stonetop-season-gains-label">What the improvements bring <span class="stonetop-season-gains-hint">(each taken once a season)</span></p>
					<ul class="stonetop-season-yield-list">
						${yields.map(y => `<li class="stonetop-season-yield">
							<div class="stonetop-season-yield-head">
								<span class="stonetop-season-yield-name">${_esc(y.label)}</span>
								<span class="stonetop-season-yield-amount">${y.blocked || !y.amount ? "&mdash;" : `+${y.amount} Surplus`}</span>
							</div>
							<p class="stonetop-season-yield-rule">${_esc(y.rule)}</p>
							${y.blocked
								? `<p class="stonetop-season-note">${_esc(y.unmet)}</p>`
								: !y.amount
									? `<p class="stonetop-season-note">At this Population it generates nothing.</p>`
									: `<div class="stonetop-season-actions">
										<button class="stonetop-season-btn" data-action="take-yield"
											data-yield-key="${y.key}" data-yield-amount="${y.amount}" data-yield-label="${_esc(y.label)}">
											<i class="fas fa-wheat-awn"></i> ${y.needsHit ? `On a 7+: take ${y.amount} Surplus` : `Take ${y.amount} Surplus`}
										</button>
									</div>`}
						</li>`).join("")}
					</ul>
				</div>` : "";

			let content;
			if (seasonId === "spring") {
				content = `<div class="stonetop-season-flow">
					${header}
					<p>Whoever is the <strong>most hopeful</strong> rolls +Fortunes:</p>
					<ul>
						<li><strong>10+:</strong> Pick 1 seasonal gain.</li>
						<li><strong>7–9:</strong> Pick 1 seasonal gain, but a threat makes itself known or gets worse.</li>
						<li><strong>6−:</strong> Threats abound. Don't mark XP.</li>
					</ul>
					<p class="stonetop-season-note">Whatever the result, reset Fortunes to +1.</p>
					${statsNote}${gainsRef}${fortunesBtns}
				`;
			} else if (seasonId === "summer") {
				content = `<div class="stonetop-season-flow">
					${header}
					<p>Whoever is the <strong>most content</strong> rolls +Fortunes:</p>
					<ul>
						<li><strong>10+:</strong> Pick 2 seasonal gains.</li>
						<li><strong>7–9:</strong> Pick 1 seasonal gain.</li>
						<li><strong>6−:</strong> A threat makes itself known or gets worse. Don't mark XP.</li>
					</ul>
					<p class="stonetop-season-note">Whatever the result, the steading generates 1d4−1 Surplus, then Fortunes resets to +1.</p>
					${statsNote}${gainsRef}${fortunesBtns}
					<div class="stonetop-season-actions">
						<button class="stonetop-season-btn" data-action="roll-surplus">
							<i class="fas fa-dice-d4"></i> Roll 1d4−1 Surplus (add to steading)
						</button>
					</div>
					${this._hasImprovement("herdOfHorses") ? `<div class="stonetop-season-actions">
						<button class="stonetop-season-btn" data-action="advance-herd">
							<i class="fas fa-horse"></i> Advance the herd (promote tiers, add foals)
						</button>
					</div>` : ""}
				`;
			} else if (seasonId === "autumn") {
				content = `<div class="stonetop-season-flow">
					${header}
					<p>Whoever is the <strong>most determined</strong> rolls +Fortunes:</p>
					<ul>
						<li><strong>10+:</strong> Pick 1 seasonal gain.</li>
						<li><strong>7–9:</strong> Pick 1 seasonal gain, but a threat makes itself known or gets worse.</li>
						<li><strong>6−:</strong> Threats abound. Don't mark XP.</li>
					</ul>
					<p class="stonetop-season-note">Whatever the result, reset Fortunes to +1. When harvest is complete, the steading generates ${harvest.formula} Surplus.</p>
					${statsNote}${gainsRef}${fortunesBtns}
					<div class="stonetop-season-actions">
						<button class="stonetop-season-btn" data-action="roll-surplus" data-formula="${_esc(harvest.formula)}">
							<i class="fas fa-dice-d4"></i> Roll ${harvest.formula} Surplus (Harvest)
						</button>
					</div>
					${partsNote(harvest.parts)}
				`;
			} else {
				// Winter
				content = `<div class="stonetop-season-flow">
					${header}
					<p>Whoever is the <strong>weariest</strong> rolls ${winterBill.formula} (min 0); the steading consumes that much Surplus.</p>
					${statsNote}${partsNote(winterBill.parts)}
					<div id="stonetop-winter-step1" class="stonetop-season-actions">
						<button class="stonetop-season-btn" data-action="roll-consumption" data-formula="${_esc(winterBill.formula)}">
							<i class="fas fa-dice-d4"></i> Roll ${winterBill.formula} for Surplus Consumption
						</button>
					</div>
					<!-- Stands in for step 1 when the window is REOPENED on a winter whose
					     consumption has already been settled. Winter is the one season that
					     runs in two halves, and the second half used to be reachable only as a
					     side effect of clicking the first: see the render callback. -->
					<p id="stonetop-winter-settled" class="stonetop-season-note" hidden>
						The steading's winter consumption is already settled this season. What is left of winter follows.
					</p>
					<div id="stonetop-winter-step2" hidden>
						<p id="stonetop-winter-result" class="stonetop-season-note"></p>
						<div id="stonetop-winter-ok" hidden>
							<div class="stonetop-season-actions">
								<button class="stonetop-season-btn" data-action="apply-consumption">Apply Surplus Consumption</button>
							</div>
						</div>
						<div id="stonetop-winter-shortfall" hidden>
							<p>⚠️ <strong>Not enough Surplus.</strong> Reduce Surplus to 0 and Fortunes by 1, then the GM picks 1:</p>
							${winterConsequencesHtml()}
						</div>
					</div>
					<div id="stonetop-winter-step3" hidden>
						<hr class="stonetop-season-divider">
						<p>Then, roll +Fortunes:</p>
						<ul>
							<li><strong>10+:</strong> Winter is relatively mild. Each player names a local NPC with whom their relationship improves.</li>
							<li><strong>7–9:</strong> The steading must consume ${winterAgain.formula} more Surplus before winter ends, or suffer the consequences again.</li>
							<li><strong>6−:</strong> As 7–9, plus threats abound. Don't mark XP.</li>
						</ul>
						<p class="stonetop-season-note">Whatever the result, reset Fortunes to +1.</p>
						${fortunesBtns}
						<div class="stonetop-season-actions">
							<button class="stonetop-season-btn stonetop-season-btn--warn" data-action="record-winter-debt">
								<i class="fas fa-hourglass-half"></i> On a 7-9 or 6-: roll what winter still wants
							</button>
						</div>
					</div>
					${this._hasImprovement("herdOfHorses") ? `<hr class="stonetop-season-divider">
					<p class="stonetop-season-note">The herd eats 1 Surplus per ${HERD_SURPLUS_PER} grown-or-yearling horses; each Surplus it goes short costs 1d6 horses.</p>
					<div class="stonetop-season-actions">
						<button class="stonetop-season-btn" data-action="feed-herd">
							<i class="fas fa-horse"></i> Feed the herd (consume Surplus, roll any losses)
						</button>
					</div>` : ""}
				`;
			}

			// Every season closes the same way, so the tail is appended ONCE rather than pasted
			// into each of the four branches, and each block gates on its own season inside its
			// own definition. A ninth seasonal obligation is one edit here, not four.
			//
			// The order is what the GM does in: what the season BRINGS first (the improvements'
			// yields), then what it COSTS (the watch every season, the weapons in spring, the
			// militia in summer), then the Inn's talk, then the notes that close the window. It is
			// deliberately not the order the improvements appear on their own tab, because nobody
			// works through a season alphabetically.
			content += `${aurochsNote}${yieldsBlock}${watchBlock}${weaponsBlock}${militiaBlock}${innRollBlock}${notesBlock}
				</div>`;

			// `const`, even though the render/button callbacks below refer to `dialog`: they run
			// after this statement completes, so the binding is always initialised by then.
			const dialog = new Dialog({
				title: `Seasons Change: ${label}`,
				content,
				// Done resets Fortunes (the season's close-out), applies any ticked mechanical
				// gains, then records this season into the year's "Seasons Change" Chronicle
				// page: the gains, the net Surplus change, the notes. `surplus` (captured at
				// open) is the baseline for that change.
				buttons: { done: { label: "Done", callback: (html) => this._saveSeasonChange(seasonId, html, fortunes, resetFortunes, surplus, year) } },
				render: (html) => {
					addStonetopSteadingButton(html);
					const root = html[0];
					// Every stat change in this walkthrough is an effect of the Seasons Change
					// homefront move, so the ledger attributes them to it.
					const seasonsMove = { stonetopMove: "Seasons Change" };

					root.querySelector("[data-action='roll-fortunes']")?.addEventListener("click", async () => {
						const prompted = await promptRoll({ title: "Seasons Change" });
						if (!prompted) return;
						await this._onSteadingRoll("Seasons Change", "fortunes", {
							...prompted, ..._seasonRollOptions(seasonId),
						});
					});

					// Spring only: hand the roll to the table — post a chat card asking the
					// most hopeful character's player to roll +Fortunes, with a button to do it.
					//
					// The roll's CONDITIONS are settled here, on the GM's machine, and ride across on
					// the card. Handing the roll over is the same act as making it, so the hold that
					// promised advantage is spent at that moment: the player who clicks the button may
					// not own the steading, could not read the flag, and certainly could not clear it.
					//
					// This matters most for the hold that exists: Rites of the Land buys "advantage on
					// the steading's next +Fortunes roll", and spring's Seasons Change is the ONLY roll
					// in the flow with no button of its own — so before this the one roll that names
					// the hold was the one roll that could not spend it. Precedence mirrors
					// `_onSteadingRoll` exactly: the hold beats the sticky selector, because it is a
					// thing the fiction already paid for rather than a preference.
					const askHopefulBtn = root.querySelector("[data-action='ask-hopeful']");
					askHopefulBtn?.addEventListener("click", async () => {
						// Disabled for the duration and then GIVEN BACK, unlike the once-per-season
						// steps around it. Asking the table to roll is not a step that can be done
						// twice by mistake — a card can be scrolled away or missed, and re-posting it
						// has to stay possible. The guard is only against the double-click that would
						// otherwise read the hold twice before the first clear landed and hand out two
						// cards at advantage for one sacrifice.
						if (askHopefulBtn.disabled) return;
						askHopefulBtn.disabled = true;
						try {
							const held = this._stonetopSteading.fortunesAdvantage();
							postSeasonsRollPrompt({
								alias: `Seasons Change: ${label}`,
								fortunes,
								rollMode: held ? "adv" : this._sheetRollMode(),
								why: held?.source ?? "",
							});
							if (held) {
								await this._stonetopSteading.clearFortunesAdvantage();
								this.render(false);
							}
						} finally { askHopefulBtn.disabled = false; }
					});

					// Winter's 7-9 (and the 6- that repeats it): "consume 1d4+Population more
					// Surplus before winter ends". A debt that outlives this window, so it is
					// written onto the steading and becomes a header glyph, which is where it
					// gets settled (module/actors/steading/winter-debt.js).
					//
					// The GM clicks this when the roll lands there rather than the dialog reading
					// the tier: the +Fortunes roll is posted to chat by _onSteadingRoll, which
					// tells this closure nothing, and the same roll can be made from the Moves
					// tab or handed to a player entirely. Every other mechanical effect in this
					// walkthrough is a deliberate GM button for the same reason.
					const winterDebtBtn = root.querySelector("[data-action='record-winter-debt']");
					winterDebtBtn?.addEventListener("click", async () => {
						if (winterDebtBtn.disabled) return;
						winterDebtBtn.disabled = true;
						try {
							// Population read LIVE, like the sibling steps read Surplus: this button
							// sits BELOW the shortfall list in the same window, and taking "Population
							// loss" there is the likeliest reason a winter reaches this roll at all.
							// The value captured when the window opened would bill the steading for a
							// head it had just lost.
							//
							// `second: true` — a Township's 2d6 and Additional Housing's lower
							// Population carry over to this roll, because both say how a winter
							// consumption is ROLLED. A Stone Wall's flat −1 does not; see the note on
							// winterConsumption for why one wall must not pay twice for one winter.
							const pop = this._stonetopSteading.getStatValue("population");
							const { formula } = winterConsumption({ population: pop, has, second: true });
							const roll = await new Roll(formula).evaluate();
							const owed = Math.max(0, roll.total);
							await roll.toMessage({ flavor: "Winter is not done: further Surplus consumption" });
							if (!owed) {
								ui.notifications.info("Winter wants nothing further.");
								return;
							}
							await this._stonetopSteading.setWinterDebt(owed, year, seasonId);
							this.render(false);
							// "Once this window is done": the clock is not stamped for this winter until
							// Done is pressed, and the glyph is read against that stamp — so promising a
							// header row that is not there yet would be the sheet telling a small lie.
							ui.notifications.info(`Winter still wants ${owed} Surplus before it ends. Once this window is done it rides on the steading's header until it is settled.`);
						} catch (err) { winterDebtBtn.disabled = false; throw err; }
					});

					// Done resets Fortunes for the new season (the move's guaranteed close-out)
					// and applies any ticked mechanical gains — Population boom (+1 Population)
					// and Unexpected bounty (+1 Surplus) — instead of those having their own
					// buttons. Relabel Done so the GM knows what the click will write to the
					// steading. The Dialog's footer button lives in `.dialog-buttons`, a SIBLING
					// of `root` (`.dialog-content`), so it's looked up off the dialog's outer
					// element.
					const refreshDoneLabel = () => {
						const appEl = dialog.element?.jquery ? dialog.element[0] : dialog.element;
						const doneBtn = appEl?.querySelector("button[data-button='done']");
						if (!doneBtn) return;
						const willApply = !!root.querySelector(".stonetop-season-gain-check[data-gain-key='population']:checked")
							|| !!root.querySelector(".stonetop-season-gain-check[data-gain-key='bounty']:checked");
						doneBtn.textContent = willApply
							? `Apply those Gains, reset Fortunes to ${sign(resetFortunes)} & Close`
							: `Reset Fortunes to ${sign(resetFortunes)} & Close`;
					};
					root.querySelectorAll(".stonetop-season-gain-check").forEach(cb =>
						cb.addEventListener("change", refreshDoneLabel));
					refreshDoneLabel();

					// Herd of Horses seasonal steps (only present when the herd is earned):
					// summer promotes the tiers + adds foals; winter feeds the herd off Surplus.
					// Disable on click before the (async) apply runs (the Seasons Change dialog stays
					// open and only the sheet behind it re-renders, so a second click would re-read the
					// just-advanced herd / just-spent Surplus and apply the season again), AND persist a
					// per-season marker so a close+reopen in the same season can't re-run it either.
					const advanceHerdBtn = root.querySelector("[data-action='advance-herd']");
					this._disableIfSeasonStepDone(advanceHerdBtn, "advanceHerd", year, seasonId);
					advanceHerdBtn?.addEventListener("click", async () => {
						if (advanceHerdBtn.disabled) return;
						advanceHerdBtn.disabled = true;
						try {
							await this._advanceHerdSummer();
							await this._stonetopSteading.setSeasonStepApplied("advanceHerd", year, seasonId);
						} catch (err) { advanceHerdBtn.disabled = false; throw err; }
					});
					const feedHerdBtn = root.querySelector("[data-action='feed-herd']");
					this._disableIfSeasonStepDone(feedHerdBtn, "feedHerd", year, seasonId);
					feedHerdBtn?.addEventListener("click", async () => {
						if (feedHerdBtn.disabled) return;
						feedHerdBtn.disabled = true;
						try {
							await this._feedHerdWinter();
							await this._stonetopSteading.setSeasonStepApplied("feedHerd", year, seasonId);
						} catch (err) { feedHerdBtn.disabled = false; throw err; }
					});

					// Standing Watch upkeep. Both buttons settle the SAME season step, so taking
					// either one closes the season's question and a close+reopen can't be used to
					// feed the watch twice (or to feed it after disbanding it).
					const feedWatchBtn    = root.querySelector("[data-action='feed-watch']");
					const disbandWatchBtn = root.querySelector("[data-action='disband-watch']");
					const settleWatch = () => {
						if (feedWatchBtn) feedWatchBtn.disabled = true;
						if (disbandWatchBtn) disbandWatchBtn.disabled = true;
					};
					// Asked of the STEADING, not of whether a given button came back from the
					// query: with no Surplus the feed button is never rendered, so keying "already
					// settled" off its return value would read false on a season that is done.
					this._disableIfSeasonStepDone(feedWatchBtn, "standingWatch", year, seasonId);
					this._disableIfSeasonStepDone(disbandWatchBtn, "standingWatch", year, seasonId);
					if (this._stonetopSteading.seasonStepApplied("standingWatch", year, seasonId)) settleWatch();

					feedWatchBtn?.addEventListener("click", async () => {
						if (feedWatchBtn.disabled) return;
						settleWatch();
						try {
							// Spends and closes the step in one write, off a LIVE Surplus read: the
							// herd feed and the surplus roll in this same dialog may have moved it
							// since the window was built. Null means it could not be afforded, and
							// nothing was written — so the choice reverts to disbanding.
							const left = await this._stonetopSteading.spendSurplus(1,
								{ ...seasonsMove, step: "standingWatch", year, seasonId });
							if (left === null) {
								ui.notifications.warn("No Surplus left to feed the watch. It disbands unless you find one.");
								if (feedWatchBtn) feedWatchBtn.disabled = true;
								if (disbandWatchBtn) disbandWatchBtn.disabled = false;
								return;
							}
							this.render(false);
							ui.notifications.info(`The watch is fed: 1 Surplus spent (${left} left).`);
						} catch (err) {
							if (feedWatchBtn) feedWatchBtn.disabled = false;
							if (disbandWatchBtn) disbandWatchBtn.disabled = false;
							throw err;
						}
					});

					disbandWatchBtn?.addEventListener("click", async () => {
						if (disbandWatchBtn.disabled) return;
						settleWatch();
						try {
							// Un-completing runs the improvement's own revert, which is what takes
							// "Standing Watch" back off the Fortifications list. Doing it by hand here
							// would leave the improvement ticked and the grant record stale, so a later
							// re-complete would refuse to re-apply the fortification.
							await this._stonetopSteading.setImprovementCompleted("standingWatch", false);
							await this._stonetopSteading.setSeasonStepApplied("standingWatch", year, seasonId);
							this.render(false);
							ui.notifications.info("The standing watch disbands. Its warriors go back to their trades.");
						} catch (err) {
							if (feedWatchBtn) feedWatchBtn.disabled = false;
							if (disbandWatchBtn) disbandWatchBtn.disabled = false;
							throw err;
						}
					});

					// Weapons of War's spring maintenance. One button, one step key, the same
					// live re-read as the watch's for the same reason.
					const payWeaponsBtn = root.querySelector("[data-action='pay-weapons']");
					this._disableIfSeasonStepDone(payWeaponsBtn, WEAPONS_SEASON_STEP, year, seasonId);
					payWeaponsBtn?.addEventListener("click", async () => {
						if (payWeaponsBtn.disabled) return;
						payWeaponsBtn.disabled = true;
						try {
							const left = await this._stonetopSteading.spendSurplus(1,
								{ ...seasonsMove, step: WEAPONS_SEASON_STEP, year, seasonId });
							if (left === null) {
								ui.notifications.warn("No Surplus left for the weapons' upkeep.");
								return;
							}
							this.render(false);
							ui.notifications.info(`Weapons of War maintained: 1 Surplus spent (${left} left).`);
						} catch (err) { payWeaponsBtn.disabled = false; throw err; }
					});

					// What the improvements bring. One button and one season marker per row, so a
					// reopen cannot take any single one of them twice — and so a GM who took the
					// Market's Surplus, closed the window and came back for the Township's finds
					// the Market's button already spent rather than the whole block gone.
					//
					// Surplus is re-read LIVE at the click, like every other spend and grant in this
					// window: the harvest roll, the herd's feed and the watch's upkeep may all have
					// moved it since the window was built, and `this.render()` refreshes the sheet
					// behind this dialog rather than this closure.
					root.querySelectorAll("[data-action='take-yield']").forEach(btn => {
						const key = btn.dataset.yieldKey;
						const gain = Math.max(0, Number(btn.dataset.yieldAmount) || 0);
						const name = btn.dataset.yieldLabel || "The season";
						this._disableIfSeasonStepDone(btn, key, year, seasonId);
						btn.addEventListener("click", async () => {
							if (btn.disabled) return;
							btn.disabled = true;
							try {
								const now = this._stonetopSteading.getStatValue("surplus");
								await this._stonetopSteading.setSystemValue("attributes.surplus.value", now + gain, seasonsMove);
								await this._stonetopSteading.setSeasonStepApplied(key, year, seasonId);
								this.render(false);
								ui.notifications.info(`${name} generates ${gain} Surplus. New total: ${now + gain}.`);
							} catch (err) { btn.disabled = false; throw err; }
						});
					});

					// The Inn's questions, handed to the table on its own ladder. No season marker:
					// the book caps the inn's GATHERING at once per season and says nothing of the
					// kind about this roll, and a re-post is how a lost card is recovered.
					const askFriendliestBtn = root.querySelector("[data-action='ask-friendliest']");
					askFriendliestBtn?.addEventListener("click", () => {
						postSeasonsRollPrompt({
							alias: `The Inn: ${label}`,
							fortunes,
							table: "inn",
						});
					});

					// The militia's summer. Both outcomes settle the SAME step, exactly as the
					// watch's two do, so a close-and-reopen can neither drill twice nor forget a
					// second tactic after paying.
					const drillMilitiaBtn = root.querySelector("[data-action='drill-militia']");
					const tacticEls = Array.from(root.querySelectorAll("[data-tactic]"));
					const settleMilitia = () => {
						if (drillMilitiaBtn) drillMilitiaBtn.disabled = true;
						tacticEls.forEach(el => el.classList.add("is-disabled"));
					};
					// Asked of the STEADING rather than of the button, for the watch's reason: with
					// no Surplus the drill button is never rendered at all.
					if (this._stonetopSteading.seasonStepApplied(MILITIA_SEASON_STEP, year, seasonId)) {
						this._disableIfSeasonStepDone(drillMilitiaBtn, MILITIA_SEASON_STEP, year, seasonId);
						settleMilitia();
					}
					drillMilitiaBtn?.addEventListener("click", async () => {
						if (drillMilitiaBtn.disabled) return;
						settleMilitia();
						try {
							const left = await this._stonetopSteading.spendSurplus(1,
								{ ...seasonsMove, step: MILITIA_SEASON_STEP, year, seasonId });
							if (left === null) {
								ui.notifications.warn("No Surplus left for the militia's drills. It loses a tactic unless you find one.");
								drillMilitiaBtn.disabled = true;
								tacticEls.forEach(el => el.classList.remove("is-disabled"));
								return;
							}
							this.render(false);
							ui.notifications.info(`The militia drills: 1 Surplus spent (${left} left).`);
						} catch (err) {
							drillMilitiaBtn.disabled = false;
							tacticEls.forEach(el => el.classList.remove("is-disabled"));
							throw err;
						}
					});
					tacticEls.forEach(el => {
						el.addEventListener("click", async () => {
							if (el.classList.contains("is-disabled")) return;
							const before = tacticEls.length;
							settleMilitia();
							try {
								await this._onImprovementReq("wellTrainedMilitia", Number(el.dataset.tactic), false);
								await this._stonetopSteading.setSeasonStepApplied(MILITIA_SEASON_STEP, year, seasonId);
								this.render(false);
								// "When the militia has trained in 2+ tactics, increase Defenses by 1."
								// Nothing auto-applies that (see IMPROVEMENT_GRANTS, where the militia
								// is deliberately absent), so nothing here silently takes it away
								// either — but the one drop that matters is called out, because a
								// Defenses left standing on a militia that no longer earns it is the
								// kind of stale +1 nobody can spot by looking.
								ui.notifications.info(before === 2
									? "The militia forgets a tactic, and is down to one. It no longer trains in 2+, so its +1 Defenses no longer applies."
									: "The militia forgets a tactic.");
							} catch (err) {
								tacticEls.forEach(t => t.classList.remove("is-disabled"));
								if (drillMilitiaBtn) drillMilitiaBtn.disabled = false;
								throw err;
							}
						});
					});

					const rollSurplusBtn = root.querySelector("[data-action='roll-surplus']");
					this._disableIfSeasonStepDone(rollSurplusBtn, "surplus", year, seasonId);
					rollSurplusBtn?.addEventListener("click", async () => {
						if (rollSurplusBtn.disabled) return;
						rollSurplusBtn.disabled = true;
						try {
							// Autumn's is written onto the button, because the harvest is the one
							// generation several improvements rewrite (Greater Harvest, the Mill,
							// and the fields Additional Housing may have built on). Summer's 1d4−1
							// has no modifiers of its own — Raincatching pays separately, as a yield.
							const formula = rollSurplusBtn.dataset.formula || (seasonId === "summer" ? "1d4 - 1" : "1d4");
							const roll = await new Roll(formula).evaluate();
							const gain = Math.max(0, roll.total);
							await roll.toMessage({ flavor: `Surplus Generation (${label})` });
							await this._stonetopSteading.setSystemValue("attributes.surplus.value", surplus + gain, seasonsMove);
							await this._stonetopSteading.setSeasonStepApplied("surplus", year, seasonId);
							this.render(false);
							ui.notifications.info(`Generated ${gain} Surplus. New total: ${surplus + gain}.`);
						} catch (err) { rollSurplusBtn.disabled = false; throw err; }
					});

					// Winter — consumption roll
					const rollConsumptionBtn = root.querySelector("[data-action='roll-consumption']");
					// Winter is the only season that runs in two halves — the consumption, then the
					// +Fortunes roll and the debt it can leave behind — and steps 2 and 3 un-hide
					// only as a SIDE EFFECT of the consumption button being clicked. The consumption
					// is also a once-per-season step, so on a reopen that button comes back disabled
					// and nothing ever un-hides them: a GM who closed the window between winter's two
					// halves could not get back to the second one from anywhere. So when the step is
					// already settled, the window opens on what is left instead of on a dead button.
					if (this._disableIfSeasonStepDone(rollConsumptionBtn, "consumption", year, seasonId)) {
						const hide = sel => { const el = root.querySelector(sel); if (el) el.hidden = true; };
						const show = sel => { const el = root.querySelector(sel); if (el) el.hidden = false; };
						hide("#stonetop-winter-step1");
						show("#stonetop-winter-settled");
						show("#stonetop-winter-step3");
					}
					rollConsumptionBtn?.addEventListener("click", async () => {
						if (rollConsumptionBtn.disabled) return;
						// Close the double-click window synchronously (like the sibling steps): the
						// button stays visible through the whole await below, so without this a second
						// click posts a second roll and double-binds the apply listener, deducting
						// consumption from Surplus twice. Restored on error so a failed roll can retry.
						rollConsumptionBtn.disabled = true;
						let consumption, surplusNow;
						try {
							// Off the button, where the improvements' rewrites were already worked
							// out: a Township rolls 2d6 in place of 1d4, Additional Housing counts
							// Population a point lower, and a Stone Wall takes 1 off the total. No
							// fallback: winter is the only season that draws this button, and it
							// always writes the formula onto it (unlike roll-surplus, which three
							// seasons draw and only some of them price).
							const formula = rollConsumptionBtn.dataset.formula;
							const roll = await new Roll(formula).evaluate();
							consumption = Math.max(0, roll.total);
							await roll.toMessage({ flavor: "Winter Surplus Consumption" });

							// Read Surplus LIVE, not the value captured when the dialog opened: the
							// herd "Feed the herd" step in this same dialog may have already spent some,
							// and this.render() refreshes the sheet, not this Dialog's closure.
							surplusNow = this._stonetopSteading.getStatValue("surplus");
						} catch (err) { rollConsumptionBtn.disabled = false; throw err; }

						root.querySelector("#stonetop-winter-step1").hidden = true;
						root.querySelector("#stonetop-winter-step2").hidden = false;
						root.querySelector("#stonetop-winter-result").textContent =
							`Roll: ${consumption}. Surplus needed: ${consumption}, available: ${surplusNow}.`;

						if (surplusNow >= consumption) {
							root.querySelector("#stonetop-winter-ok").hidden = false;
							root.querySelector("[data-action='apply-consumption']").addEventListener("click", async () => {
								// Re-read at apply time so a herd feed between roll and apply can't be refunded.
								const live = this._stonetopSteading.getStatValue("surplus");
								const remaining = Math.max(0, live - consumption);
								await this._stonetopSteading.setSystemValue("attributes.surplus.value", remaining, seasonsMove);
								await this._stonetopSteading.setSeasonStepApplied("consumption", year, seasonId);
								this.render(false);
								root.querySelector("#stonetop-winter-ok").hidden = true;
								root.querySelector("#stonetop-winter-step3").hidden = false;
								ui.notifications.info(`Consumed ${Math.min(consumption, live)} Surplus. Remaining: ${remaining}.`);
							});
						} else {
							root.querySelector("#stonetop-winter-shortfall").hidden = false;
							root.querySelectorAll("[data-consequence]").forEach(el => {
								el.addEventListener("click", async () => {
									// One write for the three stats it moves, then the season marker.
									// The arithmetic and the choice table are shared with the settle
									// window the header glyph opens (module/actors/steading/
									// winter-debt.js), so a shortfall costs the same either way.
									const { fortunes: newFortunes, population: newPop } =
										await applyWinterShortfall(this._stonetopSteading, el.dataset.consequence, seasonsMove);
									await this._stonetopSteading.setSeasonStepApplied("consumption", year, seasonId);
									ui.notifications.info(newPop === null
										? `Shortfall: Surplus → 0, Fortunes → ${sign(newFortunes)}. Apply the narrative consequence.`
										: `Shortfall: Surplus → 0, Fortunes → ${sign(newFortunes)}, Population → ${sign(newPop)}.`);
									this.render(false);
									root.querySelector("#stonetop-winter-step2").hidden = true;
									root.querySelector("#stonetop-winter-step3").hidden = false;
								});
							});
						}
					});
				},
			// Wider than core's 400px default, which is what this had been taking. It is the
			// densest window in the system: the season's outcome ladder, a live stats line, the
			// five-row gains checklist (each a name over its rule), up to three seasonal upkeep
			// blocks with their own button pairs, winter's three steps, and a notes field. At 400
			// the gains wrapped to three lines apiece and the watch's two buttons — laid out as a
			// row, because they are one question with two answers — stacked and stopped reading as
			// a pair. Wider than the 520 its homestead siblings use, and only because it carries
			// several times what they do; the footer button is the other reason, since Done
			// relabels to name the gains it is about to apply.
			}, { width: 560, classes: ["dialog", "stonetop", "stonetop-season-flow-dialog"] });
			dialog.render(true);
		}

		async _onSteadingRoll(moveName, statKey, rollOptions = {}) {
			if (!statKey) return;
			const diminished = this._stonetopSteading.getSystemValue("attributes.debilities.options.diminished.value", false);
			const lacking = this._stonetopSteading.getSystemValue("attributes.debilities.options.lacking.value", false);
			// Everything the flow itself decides about the card — its tier text and legend, the
			// list each tier chooses from, and any button a tier offers. Read from the flow here
			// rather than passed in, so the bare roll button on the Moves tab produces the same
			// card as the move's dialog does; the dialog only adds what its own controls answered.
			const flow = Object.values(HOMESTEAD_MOVE_FLOWS).find(f => f.label === moveName);
			const defaultRollOptions = flow
				? {
					moveResults: _moveResultsFromRows(flow.results),
					resultLegend: _resultsLegendHtml(flow.results),
					...(flow.pickPools  ? { pickOptions: flow.pickPools }  : {}),
					...(flow.tierActions ? { tierActions: flow.tierActions } : {}),
				}
				: {};
			// `situational` is the one-off modifier from the pre-roll prompt; it lands on top of
			// whatever the move itself already charges (Trade & Barter's declared value), and the
			// roll engine surfaces the sum as a Situational pill.
			const { situational = 0, ...rest } = rollOptions;
			const options = {
				...defaultRollOptions,
				...rest,
				moveName,
				// The mode is the caller's when it has one — the prompt's answer, or a rule the move
				// forces — and the sheet's sticky selector when it does not. `??`, not `||`: the
				// prompt omits the key entirely when it did not ask, while a caller that genuinely
				// means "normal" must not be quietly overruled by a selector left on Advantage.
				rollMode: normalizeRollMode(rest.rollMode ?? this._sheetRollMode()),
				modifier: (rest.modifier ?? 0) + situational,
				statValue: this._stonetopSteading.getStatValue(statKey),
			};
			if (rollOptions.statValue !== undefined) options.statValue = rollOptions.statValue;
			if (diminished && DIMINISHED_MOVES.has(moveName)) {
				options.rollMode = "dis";
				options.stonetopDebility = "Diminished";
				options.stonetopDebilityTooltip = "Disadvantage to Deploy, Muster, or Pull Together.";
			}
			if (lacking && statKey === "prosperity") {
				options.statValue -= 1;
				options.stonetopDebility = "Lacking";
				options.stonetopDebilityTooltip = "Treat Prosperity as 1 lower.";
			}
			// A sacrifice promised advantage on the steading's NEXT +Fortunes roll (Rites of the
			// Land). It is applied LAST, so it beats the sticky selector and the prompt alike —
			// like Trade & Barter's winter, it is a rule the fiction already settled, not a
			// preference — and it is SPENT here, because this is the roll it was promised to.
			const held = statKey === "fortunes" ? this._stonetopSteading.fortunesAdvantage() : null;
			if (held) {
				options.rollMode = "adv";
				options.conditionNotes = [...(rest.conditionNotes ?? []), held.source];
				await this._stonetopSteading.clearFortunesAdvantage();
				this.render(false);
			}
			await rollStat(statKey, this.actor, {
				...options,
			});
		}

		// The sticky mode, off the actor's own flag: the Roll Modifier selector writes it, and
		// every steading roll that was not told otherwise reads it. Shared by both layouts.
		_sheetRollMode() {
			return normalizeRollMode(this.actor.getFlag(STONETOP_SCOPE, "rollMode"));
		}

		async _onSteadingTrackChange(path, value) {
			await this._stonetopSteading.setSystemValue(path.replace(/^system\./, ""), value);
		}

		async _onListItemCheck(list, index, checked) {
			const f = this._stonetopSteading._flags;
			const arr = foundry.utils.deepClone(f[list] ?? STEADING_DEFAULTS[list]);
			if (!arr[index]) return;
			arr[index].checked = checked;
			await this._stonetopSteading.setFlags({ [list]: arr });
		}

		async _onReturnAsset(index) {
			const name = this._stonetopSteading._flags.assets?.[index]?.name ?? "Asset";
			await this._stonetopSteading.returnAsset(index);
			this.render(false);
			ui.notifications.info(`${name} returned to ${this.actor.name}.`);
		}

		async _onListItemAdd(list) {
			if (list === "residents" || list === "neighbors") {
				const kind = list === "neighbors" ? "neighbor" : "resident";
				const data = await new AddSteadingMemberDialog(kind).promise();
				if (!data) return;
				await this._addPersonRow(list, data);
				this.render(false);
				return;
			}
			const labels = { resources: "resource", fortifications: "fortification", assets: "asset" };
			const label = labels[list] ?? list;
			const input = `<div style="margin-bottom:4px"><input type="text" name="entry-name" placeholder="Name…" style="width:100%"></div>`;
			new Dialog({
				title: `Add ${label.charAt(0).toUpperCase() + label.slice(1)}`,
				content: input,
				buttons: {
					add: {
						label: "Add",
						callback: async (html) => {
							const name = html.find("[name=entry-name]").val()?.trim();
							if (!name) return;
							const f = this._stonetopSteading._flags;
							const arr = foundry.utils.deepClone(f[list] ?? STEADING_DEFAULTS[list]);
							arr.push({ name, checked: false });
							await this._stonetopSteading.setFlags({ [list]: arr });
							this.render(false);
						},
					},
					cancel: { label: "Cancel" },
				},
				default: "add",
				render: (html) => html.find("[name=entry-name]").focus(),
			}, { classes: ["dialog", "stonetop", "stonetop-steading-add-dialog"] }).render(true);
		}

		async _onListItemDelete(list, index) {
			const f = this._stonetopSteading._flags;
			const arr = foundry.utils.deepClone(f[list] ?? STEADING_DEFAULTS[list]);
			arr.splice(index, 1);
			await this._stonetopSteading.setFlags({ [list]: arr });
			this.render(false);
		}

		async _onPlaceChange(index, value) {
			const f = this._stonetopSteading._flags;
			const places = foundry.utils.deepClone(f.places ?? STEADING_DEFAULTS.places);
			places[index].name = value;
			await this._stonetopSteading.setFlags({ places });
		}

		/**
		 * Persist an inline Residents/Neighbors cell edit. An actor-backed row (post-
		 * migration) writes straight to its linked NPC actor's field — the actor is the
		 * source of truth; a legacy plain-text row keeps writing to the steading flag
		 * array (until migration converts it). `name` renames the NPC document; the rest
		 * map to NPC system fields via personFieldPath.
		 */
		async _onPersonFieldChange(list, index, field, value) {
			const path = personFieldPath(list, field);
			if (!path) return;
			const f = this._stonetopSteading._flags;
			const rows = f[list] ?? STEADING_DEFAULTS[list];
			const row = rows[index];
			if (row && isActorRow(row)) {
				// The rich `notes` field is edited via the pop-up ProseMirror editor, never
				// as an inline plain-text cell — so a stray inline write can't flatten its
				// HTML. (Actor rows render no notes input; this is belt-and-suspenders.)
				if (field === "notes") return;
				const actor = (row.id ? game.actors?.get(row.id) : null)
					|| (row.uuid ? await fromUuid(row.uuid).catch(() => null) : null);
				if (!actor) return;
				await actor.update({ [path]: value ?? "" });
				// Keep the row's cached name in sync so a deleted-actor fallback stays useful.
				if (field === "name") {
					const arr = foundry.utils.deepClone(rows);
					arr[index] = { ...arr[index], name: value ?? "" };
					await this._stonetopSteading.setFlags({ [list]: arr });
				}
				return;
			}
			// Legacy plain-text row.
			const arr = foundry.utils.deepClone(rows);
			if (!arr[index]) arr[index] = { name: "", home: "", occupation: "", traits: "", relations: "", notes: "", checked: false };
			arr[index][field] = value;
			await this._stonetopSteading.setFlags({ [list]: arr });
		}

		async _onPlayerFieldChange(index, field, value) {
			if (!["occupation", "traits", "relations", "notes"].includes(field)) return;
			const f = this._stonetopSteading._flags;
			const players = foundry.utils.deepClone(f.players ?? STEADING_DEFAULTS.players);
			if (!players[index]) return;
			players[index][field] = value;
			await this._stonetopSteading.setFlags({ players });
		}

		/**
		 * Create a new NPC actor for a Residents/Neighbors entry (from the Add Member
		 * dialog's field data) and append a {uuid, id, name} pointer row. The NPC is the
		 * row's source of truth from here on.
		 */
		async _addPersonRow(list, data) {
			// Shared with the sidebar "Create Actor" picker, which adds residents and
			// neighbors without this sheet being open (see steading-people.js).
			await addPersonToSteading(list, data, this.actor);
		}

		/**
		 * Link an existing NPC actor (dragged onto the Residents/Neighbors section) as a
		 * row, if it isn't already listed. Only "npc" actors link here — characters go to
		 * the Player Characters list via _onDropPlayerCharacter.
		 */
		async _onDropPersonNpc(list, actor) {
			if (actor?.type !== "npc") return;
			const f = this._stonetopSteading._flags;
			const arr = foundry.utils.deepClone(f[list] ?? STEADING_DEFAULTS[list]);
			const uuid = actor.uuid ?? "";
			const id   = actor.id ?? "";
			if (arr.some(r => (uuid && r.uuid === uuid) || (id && r.id === id))) {
				ui.notifications?.info?.(`${actor.name} is already listed.`);
				return;
			}
			arr.push({ uuid, id, name: actor.name, checked: false });
			await this._stonetopSteading.setFlags({ [list]: arr });
			// Residents live in Stonetop — seed a blank Home so the NPC sheet reflects it
			// (a specific home already on the NPC is left untouched).
			if (list === "residents" && !String(actor.system?.home ?? "").trim()) {
				try { await actor.update({ "system.home": HOME_STONETOP }); }
				catch (err) { console.warn("Stonetop | Could not set resident Home for", actor?.name, err); }
			}
			this.render(false);
			ui.notifications?.info?.(`Linked ${actor.name}.`);
		}

		// Link a dragged player character onto the Players roster. The row shape and the
		// duplicate check live on the model (StonetopSteading#addPlayerRow), shared with the
		// automatic filing a character gets at the end of creation, so a drag and a finished
		// creation can't produce two different rows for the same person.
		async _onDropPlayerCharacter(actor) {
			const added = await this._stonetopSteading.addPlayerRow(actor);
			this.render(false);
			ui.notifications?.info?.(added
				? `Added ${actor.name} to players.`
				: `${actor.name} is already in the players list.`);
		}

		async _onNotesChange(value) {
			await this._stonetopSteading.setFlags({ notes: value });
		}

		async _onCurrencyChange(currency, field, value) {
			const f = this._stonetopSteading._flags;
			const cur = foundry.utils.deepClone(f[currency] ?? STEADING_DEFAULTS[currency]);
			cur[field] = value;
			await this._stonetopSteading.setFlags({ [currency]: cur });
		}

		async _onImprovementComplete(slug, checked) {
			// Marking complete while the requirements aren't all met: rather than block
			// it, offer to check off every required step at once and earn the improvement
			// now. Unchecking is always allowed so a mistaken completion can be undone.
			let forceR;
			if (checked) {
				const def = this._stonetopSteading.improvementDef(slug);
				const stored = this._stonetopSteading._flags.improvements?.[slug] ?? {};
				if (def && !improvementRequirementsMet(def, stored.r ?? [])) {
					const confirmed = await this._confirmForceCompleteImprovement(def);
					if (!confirmed) {
						this.render(false); // revert the just-tapped checkbox
						return;
					}
					forceR = Array.from({ length: improvementRequirementCount(def) }, () => true);
				}
			}
			// Toggling completion also auto-applies (or reverses) the improvement's
			// one-time mechanical grants — stat bumps, Resources/Fortifications entries,
			// etc. — in the same actor update. See StonetopSteading.setImprovementCompleted.
			const result = await this._stonetopSteading.setImprovementCompleted(slug, checked, { forceR });
			if (result?.summary?.length) {
				const verb = result.reverted ? "Reverted" : "Applied";
				ui.notifications.info(`${verb} ${result.label}: ${result.summary.join("; ")}.`);
			}
		}

		// Confirm marking every requirement of a not-yet-earned improvement complete so
		// it can be earned immediately. Resolves true when accepted, false/null otherwise.
		_confirmForceCompleteImprovement(def) {
			return Dialog.confirm({
				title: "Earn this improvement?",
				content: `<div class="stonetop-improvement-force-complete">
					<p>Stonetop hasn't met all the requirements for <strong>${_esc(def.label)}</strong> yet.</p>
					<p>Mark them all complete and earn this improvement?</p>
				</div>`,
				options: { classes: ["dialog", "stonetop", "stonetop-improvement-force-complete-dialog"] },
			});
		}

		/**
		 * Pick a category chip: one at a time, so choosing a second drops the first, and
		 * choosing the lit one again clears back to unfiltered. That second behaviour is
		 * what makes "show everything" reachable without a fourth "All" chip.
		 * @returns {string} the category now lit, or "" for unfiltered.
		 */
		_toggleImprovementCategory(key) {
			this._improvementCategory = this._improvementCategory === key ? "" : key;
			return this._improvementCategory;
		}

		/**
		 * Whether a card in `category` is hidden by the current chip. No chip lit is the
		 * unfiltered state, and an improvement with no category at all (a dropped journal
		 * card, or a custom one authored without picking one) is never hidden — a filter
		 * over data that predates the filter should not make that data disappear.
		 */
		_isImprovementFiltered(category) {
			if (!this._improvementCategory) return false;
			if (!category) return false;
			return category !== this._improvementCategory;
		}

		/** Wire the Improvements tab's category chips. See getData for the render side. */
		_wireImprovementCategoryFilter(tab) {
			if (!tab) return;
			const chips = [...tab.querySelectorAll(".steading-improvement-filter")];
			const apply = () => {
				// Every chip is restyled, not just the clicked one: picking a new category has
				// to unlight whichever one was lit before.
				for (const chip of chips) {
					const on = chip.dataset.category === this._improvementCategory;
					chip.classList.toggle("is-active", on);
					chip.setAttribute("aria-pressed", on ? "true" : "false");
				}
				for (const card of tab.querySelectorAll(".steading-improvement")) {
					card.classList.toggle("steading-improvement-filtered",
						this._isImprovementFiltered(card.dataset.category ?? ""));
				}
			};
			tab.addEventListener("click", ev => {
				const btn = ev.target.closest(".steading-improvement-filter");
				if (!btn) return;
				// Stops the BUBBLE-phase handlers above this one, so a chip click is only ever a
				// chip click. It does NOT stop the sheet root's capture-phase expand/collapse
				// handler: that one runs on the way down and has already fired by the time this
				// listener sees the event. What keeps it harmless is its own guard — a chip is not
				// inside a card header, and it bails on anything that isn't. Any capture-phase
				// click handler added to the tab or the sheet root will likewise see chip clicks
				// and needs to exclude them itself; nothing here can do it for them.
				ev.preventDefault();
				ev.stopPropagation();
				if (!btn.dataset.category) return;
				this._toggleImprovementCategory(btn.dataset.category);
				apply();
			});
		}

		async _onImprovementReq(slug, index, checked) {
			const f = this._stonetopSteading._flags;
			const improvements = foundry.utils.deepClone(f.improvements ?? {});
			if (!improvements[slug]) improvements[slug] = { completed: false, r: [] };
			if (!improvements[slug].r) improvements[slug].r = [];
			improvements[slug].r[index] = checked;
			await this._stonetopSteading.setFlags({ improvements });
		}

		/** True once the named improvement is built, which is what gates its seasonal upkeep. */
		_hasImprovement(slug) {
			return this._stonetopSteading.improvementCompleted(slug);
		}

		/** An improvement's flat, in-order requirement state — the array its checkboxes write, and
		 *  what the two rules that turn on a CHOICE made while building are read from. */
		_improvementRequirements(slug) {
			return this._stonetopSteading._flags.improvements?.[slug]?.r ?? [];
		}

		/** The militia's currently-trained tactics, as {index, label} rows the summer window can
		 *  offer for the losing. Index is into the improvement's requirement array. */
		_militiaTactics() {
			const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "wellTrainedMilitia");
			return militiaTactics(def, this._improvementRequirements("wellTrainedMilitia"));
		}

		/** Whether Additional Housing was built on the fields, which is what docks the harvest. */
		_builtOnTheFields() {
			const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "additionalHousing");
			return builtOnTheFields(def, this._improvementRequirements("additionalHousing"));
		}

		/**
		 * Stand the muster down, giving back the Defenses it borrowed.
		 *
		 * Confirmed rather than immediate: the glyph is small, it sits in a header people click
		 * around, and the write is not trivially undoable (it moves a stat).
		 *
		 * NOT `Dialog.confirm`, because its buttons are hard-wired to Yes/No and a bare "Yes"
		 * under a paragraph about horses and Defenses does not say what it is agreeing TO. The
		 * two buttons here name the two outcomes, so the window can be read from its footer up.
		 * The body follows the shape the Inn's and winter's windows use: the quoted trigger
		 * first, then what pressing it does, then a `<before> &rarr; <after>` block for the one
		 * number that moves. That last part used to read "Defenses: +1 to 0", which parses as an
		 * instruction to ADD +1 rather than as a transition away from it.
		 */
		async _standDownMuster() {
			if (!this.isEditable) return;
			const held = this._stonetopSteading.musterHold();
			if (!held) return;
			const defenses = this._stonetopSteading.getStatValue("defenses");
			new Dialog({
				title: "Stand Down the Muster",
				content: `<div class="stonetop-disaster-dialog stonetop-muster-body">
					<p class="stonetop-inn-trigger"><em>A muster holds until the threat passes, the Seasons Change, or whoever called it stops overseeing it.</em></p>
					<p>Standing it down ends it now: folks go back to their own work, and the steading is no longer alert and ready for action.</p>
					<div class="stonetop-muster-change">
						<span class="stonetop-muster-change-head">What changes</span>
						${held.defenses
							? `<span class="stonetop-muster-change-row">Defenses <strong>${sign(defenses)} &rarr; ${sign(defenses - 1)}</strong></span>
								<span class="stonetop-muster-change-why">The muster was worth +1 Defenses while it held. Standing down gives that +1 back.</span>`
							: `<span class="stonetop-muster-change-row">Nothing on the sheet.</span>
								<span class="stonetop-muster-change-why">This muster never took the +1 Defenses, so there is nothing to give back.</span>`}
					</div>
					<!-- Careful not to say the Fortunes comes back OR that it was spent: one of
					     Muster's own 7+ picks is "don't reduce Fortunes after all", so whether it
					     cost anything is not knowable from here. -->
					<p class="stonetop-rites-note">Nothing else is returned; standing down only ends the muster. Raising a fresh one means rolling Muster again.</p>
				</div>`,
				buttons: {
					// Affirmative LEFT, as everywhere else. Both labels name an OUTCOME rather
					// than an answer, so neither depends on having read the paragraph above it.
					yes: {
						icon:  '<i class="fas fa-person-walking-arrow-right"></i>',
						label: "Stand the muster down",
						callback: () => this._applyStandDownMuster(held, defenses),
					},
					no: {
						icon:  '<i class="fas fa-shield-halved"></i>',
						label: "No, keep it mustered",
					},
				},
				default: "yes",
			}, { classes: ["dialog", "stonetop", "stonetop-disaster-move-dialog"] }).render(true);
		}

		/** The write behind the confirm, split out so the button is a one-liner. */
		async _applyStandDownMuster(held, defenses) {
			await this._stonetopSteading.standDownMuster();
			this.render(false);
			ui.notifications.info(held.defenses
				? `The muster stands down. Defenses back to ${sign(defenses - 1)}.`
				: "The muster stands down.");
		}

		/**
		 * The Inn's seasonal gathering. Reads the season clock at OPEN time rather than
		 * trusting the sheet-data snapshot: the card behind this may have been rendered
		 * before a Seasons Change moved the clock on.
		 */
		_openInnGathering() {
			if (!this.isEditable) return;
			// The STAMP's season and year, matching what `_innGatheringView` reads the marker
			// back with — see seasonStampParts.
			const { seasonId, year } = seasonStampParts(this.actor);
			openInnGathering({
				steading: this._stonetopSteading,
				year,
				seasonId,
				onApplied: () => this.render(false),
			});
		}

		async _onHerdStep(tier, delta) {
			if (!["grown", "yearlings", "foals"].includes(tier) || !delta) return;
			const herd = this._stonetopSteading.getHerd();
			await this._stonetopSteading.setHerd({ ...herd, [tier]: Math.max(0, herd[tier] + delta) });
		}

		async _onHerdInput(tier, value) {
			if (!["grown", "yearlings", "foals"].includes(tier)) return;
			const herd = this._stonetopSteading.getHerd();
			await this._stonetopSteading.setHerd({ ...herd, [tier]: Math.max(0, Math.trunc(Number(value) || 0)) });
		}

		/**
		 * Disable a once-per-season Seasons-Change button (and tooltip why) when its step has
		 * already been applied for this year+season, so closing and reopening the dialog can't
		 * re-run it. Returns true when it disabled the button.
		 */
		_disableIfSeasonStepDone(btn, step, year, seasonId) {
			if (!btn || !this._stonetopSteading.seasonStepApplied(step, year, seasonId)) return false;
			btn.disabled = true;
			btn.title = "Already done this season: reopening won't repeat it.";
			return true;
		}

		/**
		 * Summer: yearlings become grown horses, foals become yearlings, and the herd gains
		 * 1d4+Fortunes (min 0) new foals. Rolls the foals to chat, applies, and reports.
		 */
		async _advanceHerdSummer() {
			const before = this._stonetopSteading.getHerd();
			const fortunes = this._stonetopSteading.getStatValue("fortunes");
			// Roll Fortunes INTO the die so the chat card's total is the actual foals added
			// (1d4 + Fortunes), not a bare 1d4 that disagrees with the herd change / notification.
			const formula = fortunes >= 0 ? `1d4 + ${fortunes}` : `1d4 - ${Math.abs(fortunes)}`;
			const roll = await new Roll(formula).evaluate();
			await roll.toMessage({ flavor: `Herd: new foals (1d4 + Fortunes ${sign(fortunes)})` });
			const newFoals = Math.max(0, roll.total);
			const next = StonetopSteading.advanceHerdForSummer(before, newFoals);
			await this._stonetopSteading.setHerd(next, { stonetopMove: "Seasons Change" });
			this.render(false);
			const total = next.grown + next.yearlings + next.foals;
			ui.notifications.info(`Herd advanced: grown ${before.grown}→${next.grown}, yearlings ${before.yearlings}→${next.yearlings}, foals ${before.foals}→${next.foals} (+${newFoals}). Total ${before.total}→${total}.`);
		}

		/**
		 * Winter: the herd needs 1 Surplus per ${HERD_SURPLUS_PER} grown-or-yearling horses.
		 * Feed what Surplus is available; for each Surplus it goes short, roll 1d6 horses lost
		 * (taken from the oldest tiers first). Surplus and herd changes are attributed to
		 * Seasons Change in the ledger.
		 */
		async _feedHerdWinter() {
			const before = this._stonetopSteading.getHerd();
			const surplus = this._stonetopSteading.getStatValue("surplus");
			const cost = StonetopSteading.herdWinterCost(before);
			if (cost <= 0) {
				ui.notifications.info("The herd is small enough to forage: no Surplus needed this winter.");
				return;
			}
			const shortfall = Math.max(0, cost - Math.max(0, surplus));
			let losses = 0;
			if (shortfall > 0) {
				const roll = await new Roll(`${shortfall}d6`).evaluate();
				await roll.toMessage({ flavor: `Herd losses (${shortfall}× 1d6, ${shortfall} Surplus short)` });
				losses = roll.total;
			}
			const result = StonetopSteading.feedHerdForWinter(before, surplus, losses);
			if (result.paid > 0) {
				await this._stonetopSteading.setSystemValue("attributes.surplus.value", surplus - result.paid, { stonetopMove: "Seasons Change" });
			}
			if (result.lost > 0) {
				await this._stonetopSteading.setHerd(result.herd, { stonetopMove: "Seasons Change" });
			}
			this.render(false);
			let msg = `Herd fed: needed ${result.cost} Surplus, paid ${result.paid} (Surplus ${surplus}→${surplus - result.paid}).`;
			if (result.shortfall > 0) {
				const newTotal = result.herd.grown + result.herd.yearlings + result.herd.foals;
				msg += ` ${result.shortfall} short → lost ${result.lost} horse${result.lost === 1 ? "" : "s"} (herd ${before.total}→${newTotal}).`;
			}
			ui.notifications.info(msg);
		}

		async _onDropSteadingImprovement(improvement) {
			if (!improvement?.name) return;
			const result = await this._stonetopSteading.addCustomImprovement(improvement);
			if (result.ok) {
				globalThis.ui?.notifications?.info?.(`Added steading improvement: ${result.label}.`);
				this.render(false);
			} else if (result.reason === "duplicate") {
				globalThis.ui?.notifications?.warn?.(`${result.label} is already a steading improvement.`);
			}
		}

		// Author a custom improvement and add it as a tracked one — the same path a dropped
		// journal card takes, and the same window the reusable-card flow opens
		// (ImprovementBuilderDialog), so an improvement jotted down here can carry the
		// requirement groups and automatic effects the book's own improvements have.
		async _onCreateImprovementOpen() {
			const saver = steadingImprovementSaver(this._stonetopSteading, () => this.render(false));
			new ImprovementBuilderDialog(saver).render(true);
		}

		async _onRemoveCustomImprovement(slug) {
			if (!slug) return;
			const removed = await this._stonetopSteading.removeCustomImprovement(slug);
			if (removed) this.render(false);
		}
	};
}
