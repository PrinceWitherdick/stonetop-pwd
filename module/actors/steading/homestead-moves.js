// The homefront moves (Book I), as data: each move's book text and roll chip as the Moves tab
// prints them, and the FLOW its window and its roll card are drawn from. No sheet in here, so
// another steading's sheet (actors/settlement/) reads the same moves without importing Stonetop's.

import { escHtml } from "../../utils/strings.js";
import { resultsLegendHtml } from "../../utils/roll-engine.js";
import { TIER_KEYS } from "../../utils/move-results.js";
import { PULL_TOGETHER_COST_ACTION } from "./steading-card-actions.js";

const _esc = escHtml;

const _STEADING_MOVES_RAW = [
	{
		slug: "seasonsChange",
		label: "Seasons Change",
		stat: "fortunes",
		statLabel: "Fortunes",
		rollable: false,
		interactive: true,
		// "6-: ... don't mark XP": no "Mark XP" button on its miss card (./steading-miss-xp.js).
		noXpOnMiss: true,
		description: `<div class="stonetop-seasons-grid">
  <img src="systems/stonetop-pwd/assets/icons/seasons/spring_icon.svg" class="stonetop-season-row-icon" alt="Spring">
  <div><strong>Spring</strong>: The <em>most hopeful</em> rolls +Fortunes. <strong>10+:</strong> pick 1 seasonal gain. <strong>7–9:</strong> pick 1 gain, but a threat makes itself known. <strong>6−:</strong> threats abound; don't mark XP. Reset Fortunes to +1.</div>

  <img src="systems/stonetop-pwd/assets/icons/seasons/summer_icon.svg" class="stonetop-season-row-icon" alt="Summer">
  <div><strong>Summer</strong>: The <em>most content</em> rolls +Fortunes. <strong>10+:</strong> pick 2 seasonal gains. <strong>7–9:</strong> pick 1. <strong>6−:</strong> a threat makes itself known; don't mark XP. The steading generates 1d4−1 Surplus. Reset Fortunes to +1.</div>

  <img src="systems/stonetop-pwd/assets/icons/seasons/fall_icon.svg" class="stonetop-season-row-icon" alt="Autumn">
  <div><strong>Autumn</strong>: The <em>most determined</em> rolls +Fortunes. <strong>10+:</strong> pick 1 seasonal gain. <strong>7–9:</strong> pick 1 gain, but a threat makes itself known. <strong>6−:</strong> threats abound; don't mark XP. The steading generates 1d4 Surplus at harvest. Reset Fortunes to +1.</div>

  <img src="systems/stonetop-pwd/assets/icons/seasons/winter_icon.svg" class="stonetop-season-row-icon" alt="Winter">
  <div><strong>Winter</strong> — The <em>weariest</em> rolls 1d4+Population (min 0); the steading consumes that much Surplus. If there isn't enough: Surplus → 0, the steading Meets with Disaster, and the weariest picks 1 consequence. Then roll +Fortunes. Reset Fortunes to +1.</div>
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
<p><strong>On a 7-9:</strong> pick 1:</p>
<ul>
  <li>It gets done, but other work doesn't; reduce Fortunes by 1</li>
  <li>It gets done, but the work is shoddy, crude</li>
  <li>It gets done, but there's a consequence (bad blood, an injury, a threat unearthed, etc.)</li>
  <li>There's an unforeseen cost, requirement, or challenge; address it and the job gets done</li>
</ul>
<p><em>Diminished debility: disadvantage on this roll.</em></p>`,
	},
	{
		slug: "muster",
		label: "Muster",
		stat: "population",
		statLabel: "Population",
		rollable: true,
		interactive: true,
		description: `<p>When you <strong>press every able body into the defense of a steading</strong>, reduce Fortunes by 1 and roll <strong>+Population</strong>.</p>
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
		description: `<p>When you <strong>send a steading's people into danger or rally them against an attack</strong>, roll <strong>+Defenses</strong>.</p>
<p><strong>On a 10+:</strong> it goes as well as can be expected.</p>
<p><strong>On a 7-9:</strong> it works, but someone picks 1 from the list below. If the steading is acting from a position of strength, you choose. Otherwise, the GM chooses.</p>
<ul>
  <li>It's less effective than you expected</li>
  <li>Injuries abound; the steading marks diminished</li>
  <li>The GM picks a named NPC involved in the action; they die</li>
</ul>
<p><em>Diminished debility: disadvantage on this roll.</em></p>`,
	},
	{
		slug: "tradeBarter",
		label: "Trade & Barter",
		stat: "prosperity",
		statLabel: "Prosperity",
		rollable: true,
		interactive: true,
		noXpOnMiss: true,
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
		noXpOnMiss: true,
		description: `<p>When you <strong>borrow some of the steading's assets for an expedition</strong> (like the horses or a plow), roll <strong>+Fortunes</strong>.</p>
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
	// A REFERENCE card, not a move the steading makes: Book I has no +Fortunes Persuade. The residents
	// are NPCs, and convincing one is the character's own Persuade (vs. NPCs), +CHA (p.224). Kept on
	// the list because Malcontent's "folks need Persuading more often" points here. `reference` keeps
	// the row from reading as a move this steading cannot make; it carries no slug and no stat, so a
	// click on it rolls nothing and spends nothing.
	{
		slug: "persuade",
		label: "Persuade",
		stat: null,
		statLabel: null,
		rollable: false,
		interactive: false,
		reference: true,
		description: `<p>The residents are NPCs. When you <strong>press or entice an NPC</strong>, make the <strong>Persuade (vs. NPCs)</strong> move from your own character sheet: "say what you want them to do (or not do). If they have reason to resist, roll +CHA" (Book I p.224). The steading rolls nothing for it.</p>
<p><em>Malcontent debility: folks need Persuading more often than usual.</em></p>`,
	},
	// The two improvements that ARE a move. Listed only once built (`requires`), since a
	// steading without them has no such move to make.
	{
		slug: "aurochsHunt",
		label: "Aurochs Hunt",
		stat: "defenses",
		statLabel: "Defenses",
		rollable: true,
		interactive: true,
		requires: "aurochsHunting",
		description: `<p>When you <strong>lead the aurochs hunt in spring</strong>, roll <strong>+Defenses</strong>.</p>
<p><strong>On a 10+:</strong> gain 1d4 Surplus.</p>
<p><strong>On a 7-9:</strong> gain 1d4 Surplus, but pick 1 from the list below.</p>
<p><strong>On a 6-:</strong> pick 1 from the list below, or pick 2 and gain 1d4 Surplus.</p>
<ul>
  <li>1d4 of the town's horses are lamed or killed</li>
  <li>A number of locals are injured; the steading marks diminished</li>
  <li>The GM picks an NPC present for the hunt; they are killed</li>
  <li>The Hillfolk are somehow offended</li>
  <li>The herd is weak; if you hunt next year, they'll be wiped out</li>
</ul>
<p><em>From the Aurochs Hunting improvement.</em></p>`,
	},
	{
		slug: "heroicReputation",
		label: "Heroic Reputation",
		stat: "fortunes",
		statLabel: "Fortunes",
		rollable: true,
		interactive: true,
		requires: "heroicReputation",
		description: `<p>When you <strong>first meet someone from beyond Stonetop</strong>, roll <strong>+Fortunes</strong>.</p>
<p><strong>On a 10+:</strong> say what they've heard about you or Stonetop, and gain advantage on your next move against them.</p>
<p><strong>On a 7-9:</strong> say what they've heard.</p>
<p><strong>On a 6-:</strong> the GM decides what they've heard.</p>
<p><em>From the Heroic Reputation improvement.</em></p>`,
	},
];
export const STEADING_MOVES = [..._STEADING_MOVES_RAW].sort((a, b) => a.label.localeCompare(b.label));

/**
 * Whether a steading roll's miss marks no XP: its move says "don't mark XP" (`noXpOnMiss` on its entry
 * above, as a character move's `noXpOnMiss` does). Every other move earns it, a new one included.
 */
export function steadingMoveNoXpOnMiss(moveName) {
	return !!_STEADING_MOVES_RAW.find(move => move.label === moveName)?.noXpOnMiss;
}
export const STEADING_STAT_CHIP_LABELS = {
	Defenses: "DEF",
	Fortunes: "FOR",
	Population: "POP",
	Prosperity: "PRO",
};

// A steading move's result table is an ordered list of rows. Each row declares which PbtA
// tier(s) its line feeds — success (10+), partial (7-9), both (a 7+ line), failure (6-/Miss),
// or none (an informational row shown in the legend only) — plus a display label and line.
// The legend renders every row; the roll card's per-tier text buckets each row's line into
// its tiers. Data-driven, so the copy can be reworded freely without a regex silently
// re-bucketing it or failing to bold its prefix (the old string round-trip's failure mode).
export const RESULT = {
	strong: (line, label = "10+") => ({ tiers: ["success"],            label, line }),
	weak:   (line, label = "7-9") => ({ tiers: ["partial"],            label, line }),
	hit:    (line, label = "7+")  => ({ tiers: ["success", "partial"], label, line }),
	miss:   (line, label = "6-")  => ({ tiers: ["failure"],            label, line }),
	info:   (label, line)         => ({ tiers: [],                     label, line }),
};

export function resultsLegendFromRows(rows) {
	return resultsLegendHtml((rows ?? []).map(row =>
		// Real result tiers get a bold label; informational rows (e.g. "Commonly available
		// item") stay unbolded, matching the old prefix-only bolding.
		row.tiers?.length
			? `<strong>${_esc(row.label)}:</strong> ${_esc(row.line)}`
			: `${_esc(row.label)}: ${_esc(row.line)}`
	));
}

export function moveResultsFromRows(rows) {
	const collect = tier => (rows ?? [])
		.filter(row => row.tiers?.includes(tier))
		.map(row => row.line)
		.join(" ");
	return Object.fromEntries(TIER_KEYS.map(key => [key, { value: collect(key) }]));
}

// Deploy's one list (Book I): on a 7-9 "it works but someone picks 1 from the list below". Who
// picks is the position-of-strength question the move's window asks (improvement-rolls.js).
const DEPLOY_CONSEQUENCES = [
	"It's less effective than you expected.",
	"Injuries abound; the steading marks diminished.",
	"The GM picks a named NPC involved in the action; they die.",
];

// "Injuries abound; the steading marks diminished", the one consequence with something to write,
// so its button rides the tiers that can call for it: the 7-9 pick, and the 6- where the GM may
// have the militia "suffer heavy losses (mark diminished)". `data-move` names the card it is on
// for the steading's ledger. Wired in stonetop.js.
const markDiminishedAction = move => `<button type="button" class="stonetop-deploy-mark-diminished" data-action="deploy-mark-diminished" data-move="${move}">
				<i class="fas fa-band-aid"></i> Injuries abound: mark diminished
			</button>`;

/**
 * Deploy's result lines. `strength` is the window's answer: true when the steading acts from a
 * position of strength (so the player picks the 7-9 consequence), false when the GM does, and null
 * for a roll nobody was asked about. The 6- line is the book's advice to the GM, since the move
 * itself says nothing past the 7-9.
 */
export function deployResults(strength) {
	const picker = strength === true ? "you pick 1 from the list below (a position of strength)."
		: strength === false ? "the GM picks 1 from the list below."
		: "someone picks 1 from the list below: you, if the steading is acting from a position of strength; otherwise the GM.";
	return [
		RESULT.strong("it goes as well as can be expected."),
		RESULT.weak(`it works, but ${picker}`),
		RESULT.miss("the GM says what happens: the villagers might refuse your orders, get outfought and suffer heavy losses (mark diminished), or be put in a spot."),
	];
}
// The Aurochs Hunting improvement's list, picked from on a 7-9 and a 6-.
const AUROCHS_CONSEQUENCES = [
	"1d4 of the town's horses are lamed or killed.",
	"A number of locals are injured; the steading marks diminished.",
	"The GM picks an NPC present for the hunt; they are killed.",
	"The Hillfolk are somehow offended.",
	"The herd is weak; if you hunt next year, they'll be wiped out.",
];

// The hunt's buttons, one per thing it can write: the Surplus it brings home, and the two
// consequences that change the sheet (the herd's weakness is remembered for next spring's
// warning). Wired in stonetop.js; each settles once per card.
const AUROCHS_SURPLUS_ACTION = `<button type="button" class="stonetop-aurochs-surplus" data-action="aurochs-surplus">
		<i class="fas fa-drumstick-bite"></i> Gain 1d4 Surplus
	</button>`;
const AUROCHS_CONSEQUENCE_ACTIONS = `<button type="button" class="stonetop-aurochs-horses" data-action="aurochs-horses">
		<i class="fas fa-horse"></i> Horses lamed or killed: roll 1d4
	</button>
	${markDiminishedAction("Aurochs Hunt")}
	<button type="button" class="stonetop-aurochs-weak" data-action="aurochs-weak">
		<i class="fas fa-cow"></i> The herd is weak: remember it next spring
	</button>`;

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
				"It gets done, but other work doesn't; reduce Fortunes by 1",
				"It gets done, but the work is shoddy, crude",
				"It gets done, but there's a consequence (bad blood, an injury, a threat unearthed, etc.)",
				"There's an unforeseen cost, requirement, or challenge; address it and the job gets done",
			],
		},
		// The one pick that writes something: its Fortunes, through Meet with Disaster's floor
		// (./steading-card-actions.js), like every "reduce Fortunes by 1".
		tierActions: {
			partial: PULL_TOGETHER_COST_ACTION,
		},
		results: [
			RESULT.strong("the job gets done."),
			RESULT.weak("the job gets done, but pick 1."),
			RESULT.miss("the GM says what happens."),
		],
		note: "Diminished gives disadvantage on this roll.",
	},
	muster: {
		label: "Muster",
		stat: "population",
		statLabel: "Population",
		trigger: "When you press every able body into the defense of a steading, reduce Fortunes by 1 and roll +Population.",
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
			RESULT.miss("the GM says what happens."),
		],
		note: "Diminished gives disadvantage on this roll.",
	},
	deploy: {
		label: "Deploy",
		stat: "defenses",
		statLabel: "Defenses",
		trigger: "When you send a steading's people into danger or rally them against an attack, roll +Defenses. Before the roll, say what a 10+ looks like.",
		pickPools: {
			partial: DEPLOY_CONSEQUENCES,
		},
		tierActions: {
			partial: markDiminishedAction("Deploy"),
			failure: markDiminishedAction("Deploy"),
		},
		// The 7-9 line names who picks once the window has asked (deployResults); read bare, off
		// the Moves tab's roll chip, it says both.
		results: deployResults(null),
		note: "Diminished gives disadvantage on this roll.",
	},
	tradeBarter: {
		label: "Trade & Barter",
		stat: "prosperity",
		statLabel: "Prosperity",
		// BEHAVIOUR FLAGS, not decoration — the same way `beforeRoll: "musterCost"` is read by
		// key rather than by name. Both of these used to be selected by testing `flow.label`
		// against the string "Trade &amp; Barter", so renaming the move on screen (or changing how
		// the ampersand is escaped) silently took away the special-item button and stopped the
		// item's Value being subtracted from the roll — no error, no failing test, the move just
		// rolled wrong.
		specialItems: true,
		rollFields: true,
		trigger: "When you wish to acquire or sell a commonly available item, you can. When you seek to acquire or sell a special item, roll +Prosperity and subtract the item's Value. In winter, you have disadvantage.",
		// The only two controls in any homefront dialog, because these two are the only ones
		// the dice read: Value is subtracted as a modifier, and winter forces disadvantage.
		fields: [
			{ name: "value", label: "Item Value", type: "number", placeholder: "0", min: 0 },
			// Starts ticked while the steading's clock reads winter, as Forage's and On the Hoof's
			// winter do; still the table's to untick.
			{ name: "winter", label: "It is winter", type: "checkbox", checkedInSeason: "winter" },
		],
		results: [
			RESULT.info("Commonly available item", "you can acquire or sell it without rolling."),
			RESULT.strong("you can get it or sell it for a fair price."),
			RESULT.weak("the GM picks 1 (below).", "7-9 when buying"),
			RESULT.weak("you can sell it now, but you won't get its full worth.", "7-9 when selling"),
			RESULT.miss("don't mark XP. If you still want to acquire/sell it, you'll need to travel elsewhere or wait until next season, and then try again.", "6- either way"),
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
	// Aurochs Hunting (an improvement): "when you lead the aurochs hunt in spring, roll +Defenses".
	aurochsHunt: {
		label: "Aurochs Hunt",
		stat: "defenses",
		statLabel: "Defenses",
		requires: "aurochsHunting",
		trigger: "When you lead the aurochs hunt in spring, roll +Defenses.",
		pickPools: {
			partial: AUROCHS_CONSEQUENCES,
			failure: AUROCHS_CONSEQUENCES,
		},
		tierActions: {
			success: AUROCHS_SURPLUS_ACTION,
			partial: `${AUROCHS_SURPLUS_ACTION}${AUROCHS_CONSEQUENCE_ACTIONS}`,
			failure: `${AUROCHS_SURPLUS_ACTION}${AUROCHS_CONSEQUENCE_ACTIONS}`,
		},
		results: [
			RESULT.strong("gain 1d4 Surplus."),
			RESULT.weak("gain 1d4 Surplus, but pick 1 from the list below."),
			RESULT.miss("pick 1 from the list below, or pick 2 and gain 1d4 Surplus."),
		],
		note: "",
	},
	// Heroic Reputation (an improvement). "Advantage on your next move against them" belongs to
	// one person in one scene, so it is said on the card rather than held on anybody's sheet.
	heroicReputation: {
		label: "Heroic Reputation",
		stat: "fortunes",
		statLabel: "Fortunes",
		requires: "heroicReputation",
		trigger: "When you first meet someone from beyond Stonetop, roll +Fortunes.",
		results: [
			RESULT.strong("say what they've heard about you or Stonetop, and gain advantage on your next move against them."),
			RESULT.weak("say what they've heard about you or Stonetop."),
			RESULT.miss("the GM decides what they've heard."),
		],
		note: "",
	},
};

/** A homefront move's flow by slug ("tradeBarter", "muster"…), or null. */
export function homesteadMoveFlow(slug) {
	return HOMESTEAD_MOVE_FLOWS[slug] ?? null;
}

/** A homefront move's "+STAT" chip label, as Stonetop's and a settlement's Moves tabs print it. */
export function steadingStatChipLabel(move) {
	return STEADING_STAT_CHIP_LABELS[move?.statLabel] ?? move?.statLabel;
}

/**
 * A homefront move's book text and its "+STAT" chip label, as the Moves tab's card prints them.
 * Another steading's sheet (actors/settlement/) draws the same cards for the moves it can make.
 */
export function homesteadMoveText(slug) {
	const move = STEADING_MOVES.find(m => m.slug === slug);
	return move ? { description: move.description ?? "", statChipLabel: steadingStatChipLabel(move) } : null;
}

/**
 * A homefront move's own controls (Trade & Barter's Value and winter box), as its window draws
 * them. A checkbox with `checkedInSeason` opens ticked while the clock reads that season.
 * Another steading's sheet (actors/settlement/) asks them the same way.
 */
export function homesteadFieldsHtml(flow, clockSeason = "") {
	return (flow?.fields ?? []).map(field => {
		if (field.type === "checkbox") {
			const checked = !!field.checkedInSeason && field.checkedInSeason === clockSeason;
			return `<label class="stonetop-homestead-field stonetop-homestead-field--check">
				<input type="checkbox" class="stonetop-check" name="${_esc(field.name)}" value="yes"${checked ? " checked" : ""}>
				<span>${_esc(field.label)}</span>
			</label>`;
		}
		return `<label class="stonetop-homestead-field">
			<span>${_esc(field.label)}</span>
			<input type="number" name="${_esc(field.name)}" placeholder="${_esc(field.placeholder)}" min="${field.min ?? 0}" value="${field.value ?? ""}">
		</label>`;
	}).join("");
}

/** A homefront move's flow by its label ("Trade & Barter", "Muster"…), as a roll names it, or null. */
export function homesteadFlowForMove(moveName) {
	return Object.values(HOMESTEAD_MOVE_FLOWS).find(f => f.label === moveName) ?? null;
}

/**
 * What a homefront move's FLOW says on any steading's roll card: the tier text and its legend, and
 * the list each tier chooses from. Empty for a move with no flow.
 *
 * Read off the flow by the move's label, so the bare roll chip on the Moves tab, the move's own
 * window, and another steading's sheet (actors/settlement/) all print the same card. A flow's
 * `tierActions` are NOT on it: they write to STONETOP (a Fortunes cost, a debility), so Stonetop's
 * own roll (StonetopSteadingSheet#_onSteadingRoll) adds them and a roll for anywhere else never has them.
 */
export function homesteadMoveCard(moveName) {
	const flow = homesteadFlowForMove(moveName);
	return flow
		? {
			moveResults: moveResultsFromRows(flow.results),
			resultLegend: resultsLegendFromRows(flow.results),
			...(flow.pickPools ? { pickOptions: flow.pickPools } : {}),
		}
		: {};
}
