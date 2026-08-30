import {resolvedFlagProperty, STONETOP_SCOPE} from "../character/StonetopFlags.js";
import {slugify} from "../../utils/strings.js";
import {OCCUPATIONS, TRAITS, HOMES} from "../../data/steading-members.js";
import {resolvePersonRow} from "./steading-people.js";
import {resolvePortrait, documentPortraitFrame} from "../../utils/portrait-frame.js";
import {playbookTitle, characterFullName} from "../../utils/playbook-actors.js";
import {assetTakenTooltip} from "../../utils/requisition-asset.js";
import {
	GRANT_STAT_PATHS,
	statGrantLine,
	alternativeSectionFlags,
	normalizeImprovementGrants,
	normalizeImprovementSections,
	sectionRequiredCount,
} from "../../utils/improvement-def.js";
import {readCurrentSeason, seasonStampKey, seasonStampParts} from "../../seasons/current-season.js";
import {seasonLabel} from "../../seasons/seasons-change-reminders.js";
import {markedDebilities} from "./steading-debilities.js";
import {innGatheringState, INN_SEASON_STEP} from "./inn-gathering.js";
import {steadingHolds} from "./steading-holds.js";
import {MILITIA_SEASON_STEP} from "./season-effects.js";

/** Which season's Weapons of War maintenance has been paid ("each spring, 1 Surplus"). */
export const WEAPONS_SEASON_STEP = "weaponsUpkeep";

/**
 * Which season's standing watch has been fed (or disbanded).
 *
 * NAMED, like its three siblings (WEAPONS_SEASON_STEP here, MILITIA_SEASON_STEP in
 * season-effects.js, INN_SEASON_STEP in inn-gathering.js, RITES_SEASON_STEP in
 * rites-of-the-land.js), because the string is character-identical to the improvement SLUG
 * "standingWatch" a few hundred lines below — two namespaces that look the same at a glance,
 * so a rename of one reads as safe for the other. The slug sites stay literal on purpose:
 * they are not this key, they only spell the same.
 */
export const WATCH_SEASON_STEP = "standingWatch";

/**
 * The three lenses the Improvements tab filters by — the toggle chips beside its
 * search control. Every built-in improvement below carries exactly one `category`.
 *
 * The split follows what an improvement *feeds*, not what it costs to build, which is
 * what a player is actually shopping for when they open the tab:
 *   hearth — the Surplus engine (housing, food, water); every Fortunes grant but the Inn
 *   renown — Prosperity and everything facing outward (trade, guests, reputation)
 *   wall   — exactly the set of improvements that add to the Fortifications list
 * The Inn straddles hearth/renown (it grants Fortunes, but its ongoing rules are all
 * about guests and news from the wider world) and Township is really a capstone; both
 * are filed under renown.
 *
 * Custom improvements — hand-authored, or dropped in from a journal card, which carries
 * no category — may have none, in which case they're immune to the filter and always
 * shown, so nothing a user added can silently vanish behind a chip.
 */
export const IMPROVEMENT_CATEGORIES = [
	{
		key: "hearth",
		label: "Hearth & Harvest",
		icon: "fas fa-wheat-awn",
		hint: "Housing, food, and water: the Fortunes and Surplus engine.",
	},
	{
		key: "renown",
		label: "Trade & Renown",
		icon: "fas fa-coins",
		hint: "Prosperity, trade, and everything facing the wider world.",
	},
	{
		key: "wall",
		label: "Wall & Watch",
		icon: "fas fa-shield-halved",
		hint: "Defenses and the Fortifications list.",
	},
];

/** Valid `category` values, for validating a hand-authored custom improvement. */
export const IMPROVEMENT_CATEGORY_KEYS = new Set(IMPROVEMENT_CATEGORIES.map(c => c.key));

export const IMPROVEMENT_DEFINITIONS = [
	// ── Page 2 ──────────────────────────────────────────────────
	{
		slug: "additionalHousing",
		label: "Additional Housing",
		category: "hearth",
		flavor: "It's getting crowded! We need more room to live.",
		sections: [
			{
				heading: "Requires either one of these:",
				min: 1,
				items: [
					"An exceptional engineer/foreman, to design much roomier houses on the current land",
					"Building on parts of the fields, resulting in −1 Surplus generated with each autumn's harvest",
				],
			},
			{
				heading: "And then — <em>Pulling Together</em> 5 times, each requiring 1 season, 1 Surplus, and a wagonload of timber and other supplies (Value 2), to (re)build homes:",
				items: [
					"<em>Pull Together</em> (1st)",
					"<em>Pull Together</em> (2nd)",
					"<em>Pull Together</em> (3rd)",
					"<em>Pull Together</em> (4th)",
					"<em>Pull Together</em> (5th)",
				],
			},
		],
		effect: "Increase Fortunes by 1 and add any new homes to the map. Henceforth, when you consume Surplus in winter, consider Population to be 1 lower than it is.",
	},
	{
		slug: "aurochsHunting",
		label: "Aurochs Hunting",
		category: "hearth",
		flavor: "Large herds form on the Flats in spring. The Hillfolk hunt them, but Stonetop has never learned to do so.",
		sections: [
			{
				heading: "Requires 2 of the following:",
				min: 2,
				items: [
					"A Herd of Horses (and hunters to ride them)",
					"Cooperating with the Hillfolk",
					"A cunning plan",
				],
			},
			{
				heading: "And then:",
				items: ["A successful first hunt (played out in detail)"],
			},
		],
		effect: "Add \"Aurochs hunting (meat, hide, horn)\" to the Resources list. Henceforth, when you lead the aurochs hunt in spring, roll +Defenses: on a 10+, gain 1d4 Surplus; on a 7–9, gain 1d4 Surplus but pick 1 from the list below; on a 6–, pick 1 from the list below, or pick 2 and gain 1d4 Surplus. The list: 1d4 of the town's horses are lamed or killed; a number of locals are injured and the steading marks <em>diminished</em> (disadvantage to <em>Deploy</em>, <em>Muster</em>, or <em>Pull Together</em>); the GM picks an NPC present for the hunt — they are killed; the Hillfolk are somehow offended; the herd is weak and if you hunt next year they'll be wiped out.",
	},
	{
		slug: "expandedTrades",
		label: "Expanded Trades",
		category: "renown",
		flavor: "Specialization is the key to prosperity!",
		sections: [
			{
				heading: "Requires one of the following improvements, to free up enough time to support more tradesfolk:",
				min: 1,
				items: [
					"Harnessing the Stream",
					"Raincatching",
					"Mill",
				],
			},
			{
				heading: "And establishing at least 3 of the following:",
				min: 3,
				items: [
					"A chandler with extensive tools and supplies (Value 3)",
					"A glassblower with a full glassworks (Value 3)",
					"An exceptional weaver with good tools (Value 2) and a reliable supply of Whitefang wool",
					"An exceptional potter with good tools (Value 2) and a reliable source of excellent clay",
					"An exceptional smith with a newer, hotter forge (Value 3)",
					"Some other exceptional tradesperson, with the appropriate tools and supplies (Value 2 or 3)",
				],
			},
		],
		effect: "Increase Prosperity by 1. If you cease to meet the requirements, decrease Prosperity by 1.",
	},
	{
		slug: "greaterHarvest",
		label: "Greater Harvest",
		category: "hearth",
		flavor: "Beyond the Old Wall, the prairie grass of the Flats chokes out any crops we try to grow.",
		sections: [
			{
				heading: "Requires 1 of the following:",
				min: 1,
				items: [
					"Doubling the yield of crops inside the Old Wall",
					"Clearing/taming new fields beyond the Old Wall",
				],
			},
		],
		effect: "Increase Fortunes by 1. Henceforth, when the autumn harvest is complete, gain +1d4 Surplus.",
	},
	{
		slug: "harnessingStream",
		label: "Harnessing the Stream",
		category: "hearth",
		flavor: "A shallow creek flows just below the town. If only it could be harnessed!",
		sections: [
			{
				heading: "Requires 2 of the following:",
				items: [
					"A reservoir for the Stream to pool in, and some way for water to flow uphill",
					"A series of aqueducts, from the Stream's source to Stonetop",
				],
			},
		],
		effect: "Add them to the Resources list and increase Fortunes by 1. Henceforth, when spring breaks forth and you roll a 7+ with Fortunes, the steading generates 1 Surplus.",
	},
	{
		slug: "herdOfHorses",
		label: "Herd of Horses",
		category: "hearth",
		flavor: "Imagine what we could do with a dozen fine steeds.",
		sections: [
			{
				heading: "Requires all of the following:",
				items: [
					"A site for a proper stable and corral",
					"<em>Pulling Together</em> to build the stable and corral, which requires a month and a wagonload of timber (Value 2). Add them to the map.",
					"Someone skilled in riding and training horses",
					"Acquiring a small herd of horses, about a dozen (through trade or by catching wild ones)",
					"Training/breaking them to the saddle and plow",
					"Additional saddles, harness, plows, etc. (Value 2)",
					"<em>Pulling Together</em> to have a couple dozen villagers learn to ride, requiring a season and 1 Surplus.",
					"Someone to mind the herd and stable, full time",
				],
			},
		],
		effect: "Increase Fortunes by 1 and replace \"a pair of sturdy draft horses\" with \"a herd of horses\" on the Assets list. Make a note of its size. Henceforth: When you leverage the horses to <em>Pull Together</em>, it takes half as long and costs half as much. When you <em>Requisition</em> half the herd or less, treat a 6– as a 7–9. When the <em>Seasons Change</em> to summer, any yearlings become horses (Value 3 once trained), any foals become yearlings (Value 2), and the herd gains foals (Value 1) equal to 1d4+Fortunes (min 0). When winter grips the land, the herd consumes 1 Surplus per 6 grown or yearling horses. For every Surplus not consumed, 1d6 horses are lost.",
	},
	{
		slug: "heroicReputation",
		label: "Heroic Reputation",
		category: "renown",
		flavor: "Few have heard of Stonetop's heroes. Yet.",
		sections: [
			{
				heading: "Requires any 3 of the following:",
				min: 3,
				items: [
					"Impressing a band of Hillfolk",
					"Braving a lake and coming back with proof",
					"Saving many Marshedge residents' lives",
					"Saving many Gordin's Delve residents' lives",
					"Saving someone from beyond Marshedge",
					"Hiring a minstrel to tell your tales (Value 2)",
				],
			},
		],
		effect: "When you first meet someone from beyond Stonetop, roll +Fortunes: on a 10+, say what they've heard about you or Stonetop, and gain advantage on your next move against them; on a 7–9, say what they've heard; on a 6–, the GM decides what they've heard.",
	},
	// ── Page 3 ──────────────────────────────────────────────────
	{
		slug: "inn",
		label: "Inn",
		category: "renown",
		flavor: "The public house offers a common room and shelter for a few horses, but it's hardly a proper inn.",
		sections: [
			{
				heading: "Requires all of the following, in order:",
				items: [
					"A designated building site",
					"A competent engineer/foreman",
					"Furnishings, equipment, and material (Value 3)",
					"<em>Pulling Together</em> (1st — 1 season, 1 Surplus, and timber/supplies, Value 2)",
					"<em>Pulling Together</em> (2nd — 1 season, 1 Surplus, and timber/supplies, Value 2)",
					"A small, devoted staff (innkeep, cook, ostler, etc.)",
				],
			},
		],
		effect: "Increase Fortunes by 1. Name the inn, add it to both the Resources list and map. Henceforth, when the <em>Seasons Change</em>, whoever is friendliest rolls +Fortunes: on a 10+, ask the GM 3 questions about the wider world; on a 7–9, ask 1 question; on a 6–, ask 1 question, but the GM describes some trouble that stems from the inn or its guests. Once per season, when you expend 1 Surplus and bring folks together at the inn (to talk, to celebrate, to recuperate), clear one of the steading's debilities.",
	},
	{
		slug: "market",
		label: "Market",
		category: "renown",
		flavor: "Stonetop is at most an afterthought for traders in the region. We need to change that.",
		sections: [
			{
				heading: "Requires 1 of the following:",
				min: 1,
				items: [
					"A compelling good/service, exclusive to Stonetop",
					"Establishing some other reason to visit Stonetop (place of pilgrimage, etc.)",
				],
			},
			{
				heading: "And these:",
				items: [
					"A dedicated market site (add it to the map)",
					"A trusted arbiter, able to enforce their own rulings on matters of trade",
					"Four seasons in operation without notable incidents of violence, banditry, theft, etc.",
				],
			},
		],
		effect: "Increase Prosperity by 1. If you cease to meet the requirements, decrease Prosperity by 1. When the <em>Seasons Change</em> to spring, summer, or autumn and the market is active, and Population is +1 or better, the Market generates 1 Surplus.",
	},
	{
		slug: "mill",
		label: "Mill",
		category: "hearth",
		flavor: "We've got our pick of millstones. With a mill, we'd have better bread and more time for other crafts.",
		sections: [
			{
				heading: "Requires all of the following:",
				items: [
					"An exceptional engineer/foreman",
					"A convenient, consistent power source (wind on a hill, a waterwheel, a Herd of Horses, magic, etc.)",
					"A building site able to harness that power source",
					"<em>Pulling Together</em> (1st — a season, 1 Surplus, a wagonload of timber, Value 2, and a bunch of rope and supplies, Value 2)",
					"<em>Pulling Together</em> (2nd — a season, 1 Surplus, a wagonload of timber, Value 2, and a bunch of rope and supplies, Value 2)",
					"A full-time miller",
				],
			},
		],
		effect: "Increase Fortunes by 1, add \"Mill\" to the Resources list and draw it on the map. Henceforth, when the autumn harvest is complete, the steading generates +1 Surplus. Also, when you <em>Outfit</em> from Stonetop or <em>Have What You Need</em> after doing so, each ◆ of supplies has 1 extra use.",
	},
	{
		slug: "palisade",
		label: "Palisade",
		category: "wall",
		flavor: "A wall of sharpened logs, 10' tall, to keep evil at bay.",
		sections: [
			{
				heading: "Requires all of the following, in order:",
				items: [
					"Lots of timber (~20–25 wagonloads, Value 3)",
					"A competent engineer/foreman",
					"Lots of rope, nails, pitch, etc. (Value 2)",
					"<em>Pulling Together</em>, costing a month and 1 Surplus",
				],
			},
		],
		effect: "Increase Fortunes by 1, add \"Palisade\" to the Fortifications list and draw it on the map. Henceforth, when you take advantage of the palisade, you have advantage to <em>Deploy</em>.",
	},
	{
		slug: "raincatching",
		label: "Raincatching",
		category: "hearth",
		flavor: "Filling the cistern takes so much work. Surely, we can do better!",
		sections: [
			{
				heading: "Requires all of the following, in order:",
				items: [
					"An exceptional engineer/foreman, to design a cunning system of roofs, gutters, and conduits",
					"Enough slate/terracotta to roof all the buildings and construct the gutters and conduits (Value 3)",
					"<em>Pulling Together</em> (1st — 1 season and 1 Surplus)",
					"<em>Pulling Together</em> (2nd — 1 season and 1 Surplus)",
					"<em>Pulling Together</em> (3rd — 1 season and 1 Surplus)",
				],
			},
		],
		effect: "Increase Fortunes by 1, add \"Raincatching\" to the Resources list. Henceforth, when summer comes and you roll a 7+ with Fortunes, the steading generates 1 Surplus.",
	},
	{
		slug: "standingWatch",
		label: "Standing Watch",
		category: "wall",
		flavor: "Some full-time warriors would make us all safer, no?",
		sections: [
			{
				heading: "Requires all of the following:",
				items: [
					"A veteran warrior, able to command a crowd",
					"At least 6 warriors, well-equipped and willing",
					"The village leaders agreeing to support warriors who train and keep watch full-time",
				],
			},
		],
		effect: "Add \"standing watch\" to the Fortifications list. At the start of each season, the watch consumes 1 Surplus or it disbands. When you specifically involve the watch in a move, treat Defenses as 1 higher than they are.",
	},
	{
		slug: "stoneWall",
		label: "Stone Wall",
		category: "wall",
		flavor: "No mere palisade of wood, but a mighty rampart. We have the stone, after all...",
		sections: [
			{
				heading: "Requires all of the following, in order:",
				items: [
					"An exceptional engineer/foreman",
					"A stonecutter with an able crew",
					"Equipment, tools, and material (Value 3)",
					"<em>Pulling Together</em> (1st — 1 season, 1 Surplus, and supplies, Value 2)",
					"<em>Pulling Together</em> (2nd — 1 season, 1 Surplus, and supplies, Value 2)",
					"<em>Pulling Together</em> (3rd — 1 season, 1 Surplus, and supplies, Value 2)",
					"<em>Pulling Together</em> (4th — 1 season, 1 Surplus, and supplies, Value 2)",
				],
			},
		],
		effect: "Add \"Stone Wall\" to the Fortifications list (erase \"Palisade\" if you had it) and draw it on the map. Henceforth: When you take advantage of the stone wall, you have advantage to <em>Deploy</em>. When winter grips the land, the steading consumes 1 less Surplus than normal.",
	},
	{
		slug: "township",
		label: "Township",
		category: "renown",
		flavor: "Will this ever be more than a backwater village?",
		sections: [
			{
				heading: "Requires all of the following:",
				items: [
					"Population +3 for 4 consecutive seasons (1st season)",
					"Population +3 for 4 consecutive seasons (2nd season)",
					"Population +3 for 4 consecutive seasons (3rd season)",
					"Population +3 for 4 consecutive seasons (4th season)",
					"Additional Housing",
					"Raincatching OR Harnessing the Stream",
					"At least 4 other improvements (1st)",
					"At least 4 other improvements (2nd)",
					"At least 4 other improvements (3rd)",
					"At least 4 other improvements (4th)",
					"A formal government of some sort",
				],
			},
		],
		effect: "Change Size to town and its Population to +0. Henceforth: When you <em>Muster</em>, <em>Pull Together</em>, or <em>Trade & Barter</em>, you have advantage. When the <em>Seasons Change</em> to spring or summer, the town generates Surplus equal to Population+1. But, when winter grips the land, roll 2d6+Population to consume Surplus instead of 1d4+Population.",
	},
	{
		slug: "weaponsOfWar",
		label: "Weapons of War",
		category: "wall",
		flavor: "Spears are great, but how about axes, picks, swords?",
		sections: [
			{
				heading: "Requires either this:",
				group: "weapons-source",
				items: [
					"Acquiring a few dozen good swords, battleaxes, maces, flails, warhammers, etc. (Value 3)",
				],
			},
			{
				heading: "Or all of these:",
				group: "weapons-source",
				items: [
					"A smith, with a full staff and upgraded tools (Value 2)",
					"A cartload of good iron ore (Value 2)",
					"4 seasons of work by the smith (1st season)",
					"4 seasons of work by the smith (2nd season)",
					"4 seasons of work by the smith (3rd season)",
					"4 seasons of work by the smith (4th season)",
				],
			},
			{
				heading: "And then:",
				items: [
					"A veteran warrior, able to command a crowd",
					"<em>Pulling Together</em> to train the militia with these new weapons, requiring a season and 1 Surplus",
				],
			},
		],
		effect: "Increase Defenses by 1 and add \"Weapons of War\" to the Fortifications list. Each spring, the village must expend 1 Surplus to maintain and replace the town's weapons. Henceforth, when you <em>Outfit</em> from Stonetop or <em>Have What You Need</em> after doing so, you can treat maces, flails, battleaxes, warhammers, and all types of swords as common items, as if they were already on the inventory inserts. Battleaxes and swords have \"x piercing,\" where x is the steading's current Prosperity.",
	},
	{
		slug: "wellTrainedMilitia",
		label: "Well-Trained Militia",
		category: "wall",
		flavor: "Everyone can use a spear and shield, but some hard drilling could make us a force to be reckoned with.",
		sections: [
			{
				heading: "Requires 1 of the following:",
				items: ["A veteran warrior, able to command a crowd"],
			},
			{
				heading: "For each tactic below, you must then <em>Pull Together</em>, requiring a season of drills and 1 Surplus:",
				min: 1,
				items: [
					"Archery: barrages, ranged ambushes, sniping, etc.",
					"Cavalry (requires a Herd of Horses): fighting from horseback, charges",
					"Formations: shield walls, wedges, phalanx, etc.",
					"Readiness: patrolling, reacting quickly to alarms",
					"Skirmishing: ambushes, harassing, hit-and-run",
				],
			},
		],
		effect: "When you <em>Deploy</em> using one of the militia's trained tactics, you are likely acting from a position of strength (you pick the consequence on a 7–9, not the GM). When the militia has trained in 2+ tactics, increase Defenses by 1. Each summer, the militia must spend 1 Surplus and a week or so practicing or else lose its training in 1 tactic.",
	},
];

/**
 * The immediate, mechanical, one-time effects applied automatically when a
 * built-in improvement is marked complete (and reversed when it's un-completed),
 * keyed by improvement slug. Only the parts of an improvement's `effect` prose
 * that map cleanly to sheet state live here; the ongoing "Henceforth…" rules and
 * map/asset bookkeeping stay as prose reminders on the card. Improvements whose
 * only effect is conditional or narrative (heroicReputation, wellTrainedMilitia)
 * are intentionally absent — nothing is auto-applied for them.
 *
 *   stats                — integer deltas to fortunes / defenses / prosperity / population
 *   resources            — names appended to the Resources list (as active/checked)
 *   fortifications       — names appended to the Fortifications list (as active/checked)
 *   removeFortifications — names cleared from the Fortifications list, if present
 *   setSize              — set the steading's Size
 *   setPopulation        — set Population to an exact value
 */
export const IMPROVEMENT_GRANTS = {
	additionalHousing: { stats: { fortunes: 1 } },
	aurochsHunting:    { resources: ["Aurochs hunting (meat, hide, horn)"] },
	expandedTrades:    { stats: { prosperity: 1 } },
	greaterHarvest:    { stats: { fortunes: 1 } },
	harnessingStream:  { stats: { fortunes: 1 }, resources: ["Harnessing the Stream"] },
	herdOfHorses:      { stats: { fortunes: 1 } },
	inn:               { stats: { fortunes: 1 }, resources: ["Inn"] },
	market:            { stats: { prosperity: 1 } },
	mill:              { stats: { fortunes: 1 }, resources: ["Mill"] },
	palisade:          { stats: { fortunes: 1 }, fortifications: ["Palisade"] },
	raincatching:      { stats: { fortunes: 1 }, resources: ["Raincatching"] },
	standingWatch:     { fortifications: ["Standing Watch"] },
	stoneWall:         { fortifications: ["Stone Wall"], removeFortifications: ["Palisade"] },
	township:          { setSize: "town", setPopulation: 0 },
	weaponsOfWar:      { stats: { defenses: 1 }, fortifications: ["Weapons of War"] },
};

/** System-data path (relative to `system.`) for each stat an improvement grant can bump. */
/**
 * The Herd of Horses improvement tracks its herd in three age tiers (Book I). When the
 * Seasons Change to summer, yearlings become grown horses, foals become yearlings, and
 * the herd gains 1d4+Fortunes new foals; in winter the herd eats 1 Surplus per 6 grown
 * or yearling horses, losing 1d6 per Surplus it can't be fed.
 */
export const HERD_TIERS = [
	{ key: "grown",     label: "Grown horses", value: 3 },
	{ key: "yearlings", label: "Yearlings",    value: 2 },
	{ key: "foals",     label: "Foals",        value: 1 },
];
/** Starting herd when the improvement is earned — "a small herd of horses, about a dozen". */
export const HERD_START = { grown: 12, yearlings: 0, foals: 0 };
/** Winter: the herd consumes 1 Surplus for every this-many grown-or-yearling horses. */
export const HERD_SURPLUS_PER = 6;

/** Lower-cased built-in improvement labels, used to reject custom dupes of a book improvement. */
const BUILTIN_IMPROVEMENT_LABELS = new Set(IMPROVEMENT_DEFINITIONS.map(d => d.label.toLowerCase()));

/**
 * Whether every requirement group of an improvement is satisfied by its flat,
 * in-order stored checkbox state `r`. A section's `min` is how many of its items
 * must be checked (defaulting to all of them). Sections that share a `group` id
 * are alternatives (OR) — the group is met if any of them meets its count;
 * ungrouped sections each stand on their own (AND). An improvement with no
 * requirement sections is always met.
 * @param {{sections?: Array}} def
 * @param {Array<boolean>} r
 */
export function improvementRequirementsMet(def, r = []) {
	const groups = new Map();
	let idx = 0;
	(def?.sections ?? []).forEach((section, i) => {
		const items = section?.items ?? [];
		let checked = 0;
		for (let k = 0; k < items.length; k++) if (r[idx++]) checked++;
		const satisfied = checked >= sectionRequiredCount(section);
		const key = section?.group ?? `__${i}`;
		groups.set(key, (groups.get(key) ?? false) || satisfied);
	});
	return [...groups.values()].every(Boolean);
}

export const STEADING_DEFAULTS = {
	resources: [
		{ name: "Farming (beans, potatoes, oats, barley)", checked: true },
		{ name: "Hunting/trapping (fur, meat, hides)", checked: true },
		{ name: "Distilling (whisky)", checked: true },
		{ name: "Stone (collected from the Old Wall)", checked: true },
		{ name: "Cistern (filled with rain, snow)", checked: true },
		{ name: "Tradesfolk (midwife, potter, publican, smith, tanner)", checked: true },
		{ name: "Trade: Gordin's Delve (metal, tools)", checked: true },
		{ name: "Trade: Marshedge (textiles, herbs, glass)", checked: true },
		{ name: "", checked: false },
		{ name: "", checked: false },
		{ name: "", checked: false },
	],
	fortifications: [
		{ name: "Village militia", checked: true },
		{ name: "The Ringwall (low, stone)", checked: true },
		{ name: "3 watchtowers", checked: true },
		{ name: "Spears & shields in every home", checked: true },
		{ name: "Some bows", checked: true },
		{ name: "", checked: false },
		{ name: "", checked: false },
		{ name: "", checked: false },
		{ name: "", checked: false },
	],
	assets: [
		{ name: "A pair of hardy draft horses — HP 10 each; d6+3 dmg (hand, close, forceful); Instinct: to panic; Cost: care & grooming", checked: true },
		{ name: "A pair of horse-drawn plows, iron", checked: true },
		{ name: "A pair of carts (plus horse harness)", checked: true },
		{ name: "A wagon (plus horse harness)", checked: true },
		{ name: "", checked: false },
		{ name: "", checked: false },
		{ name: "", checked: false },
		{ name: "", checked: false },
	],
	// Start empty — residents/neighbors are added on demand via "Add Resident/
	// Neighbor" (or by typing into a row in edit mode). Seeding blank rows here
	// made three empty rows appear whenever a fresh sheet's section was edited.
	residents: [],
	neighbors: [],
	players: [],
	places: [
		{ letter: "A", name: "The Stone" },
		{ letter: "B", name: "The Granary" },
		{ letter: "C", name: "Public House & Stables" },
		{ letter: "D", name: "Cistern" },
		{ letter: "E", name: "Pavilion of the Gods" },
		{ letter: "F", name: "Watchtowers" },
		{ letter: "G", name: "" },
		{ letter: "H", name: "" },
		{ letter: "I", name: "" },
		{ letter: "J", name: "" },
		{ letter: "K", name: "" },
		{ letter: "L", name: "" },
		{ letter: "M", name: "" },
		{ letter: "N", name: "" },
		{ letter: "O", name: "" },
		{ letter: "P", name: "" },
		{ letter: "Q", name: "" },
		{ letter: "R", name: "" },
	],
	notes: "",
	improvements: {},
	size: "village",
	silver: { purses: 0, handfuls: 0, coins: 0 },
	gold:   { purses: 0, handfuls: 0, coins: 0 },
};

const SYSTEM_DEFAULTS = {
	stats: {
		fortunes: { value: 1 },
		defenses: { value: 0 },
	},
	attributes: {
		population: { value: 0 },
		prosperity: { value: 0 },
		surplus: { value: 1 },
		debilities: {
			options: {
				diminished: { value: false },
				lacking: { value: false },
				malcontent: { value: false },
			},
		},
	},
};

function _getProperty(obj, path) {
	return foundry.utils.getProperty(obj, path);
}

function _systemValue(actor, flags, path, defaultValue) {
	const flagValue = _getProperty(flags, `system.${path}`);
	if (flagValue !== undefined) return flagValue;
	const actorValue = _getProperty(actor.system, path);
	return actorValue !== undefined ? actorValue : defaultValue;
}

/**
 * Where `actor` sits on a Players roster, or -1. Uuid/id only.
 *
 * Every player row has carried both since the roster was introduced: the drop handler is
 * the list's only writer (there is no inline "+ Add" for Players the way there is for
 * Residents and Neighbors, and the field-change handler refuses to create a row), and it
 * has stamped id + uuid from its first commit. So the name fallback the resolve path keeps
 * has nothing to catch here, and matching on a name is the worse trade for an IDENTITY
 * check: two characters can share one, and a row left behind by a REPLACED character (the
 * old actor is deleted, its row deliberately kept — see steading-people.js#repaintOpen-
 * SteadingRosters) still carries the name its player is about to reuse. Either way the new
 * character reads as "already listed" and is silently never filed. A duplicate row is
 * visible and has a delete button; a missing one is neither.
 *
 * Blank keys never match, so an actor arriving without either (never a real document) can't
 * be judged the same person as a row that also lacks one.
 *
 * Exported so the roster's two writers (the sheet's drop handler and the automatic filing
 * at the end of character creation) can't drift on what a duplicate is.
 */
export function playerRowIndex(rows, actor) {
	const uuid = actor?.uuid ?? "";
	const id   = actor?.id ?? actor?._id ?? "";
	return (rows ?? []).findIndex(row =>
		(uuid && row?.uuid === uuid) ||
		(id   && row?.id   === id));
}

export class StonetopSteading {
	constructor(actor) {
		this._actor = actor;
		this.type = "stonetop";
	}

	get _flags() {
		return resolvedFlagProperty(this._actor, "steading") ?? {};
	}

	/**
	 * Write `system.*` values AND steading flags in ONE actor update.
	 *
	 * The single seam every steading write goes through, because "one update" is what the
	 * ledger reads: each `actor.update` carrying a `stonetopMove` produces its own ledger
	 * append and its own stat-change chat card, so a move that changes three things across a
	 * mix of system fields and flags must present them together or the table gets three cards
	 * for one move. The system values are mirrored into the steading flag copy here too, so a
	 * caller never has to know that mirror exists.
	 */
	async applyChanges({ system = {}, flags = {} } = {}, options = {}) {
		const systemEntries = Object.entries(system);
		const flagEntries = Object.entries(flags);
		if (!systemEntries.length && !flagEntries.length) return;

		// A flag-only change stays on setFlag with the whole steading object, which is the path
		// every flag write has always taken: there is no stat for the ledger to card, so it has
		// nothing to batch WITH, and whole-object replacement is the semantics callers that drop
		// a subkey (an emptied list, a cleared pick) already rely on.
		if (!systemEntries.length) {
			const merged = { ...foundry.utils.deepClone(this._flags), ...flags };
			await this._actor.setFlag(STONETOP_SCOPE, "steading", merged);
			return;
		}

		// A change that moves a stat AND sets a flag — the reason this method exists — goes out
		// as ONE update, so the ledger appends once and cards the stats together. Both halves
		// are written as targeted dotted keys: the whole flag object cannot be replaced here
		// without colliding with the `…steading.system.*` mirrors in the same payload. That
		// makes the flag half a MERGE, so this path sets values and must not be used to drop a
		// key (see setFlags above for that).
		const data = {};
		for (const [path, value] of systemEntries) {
			data[`system.${path}`] = value;
			data[`flags.${STONETOP_SCOPE}.steading.system.${path}`] = value;
		}
		for (const [key, value] of flagEntries) {
			data[`flags.${STONETOP_SCOPE}.steading.${key}`] = value;
		}
		await this._actor.update(data, options);
	}

	async setFlags(updates) {
		await this.applyChanges({ flags: updates });
	}

	getSystemValue(path, defaultValue = 0) {
		return _systemValue(this._actor, this._flags, path, defaultValue);
	}

	async setSystemValue(path, value, options = {}) {
		await this.setSystemValues({ [path]: value }, options);
	}

	/** Write several `system.*` values (and their mirrored steading-flag copies) in a
	 *  single actor update, so move-driven batches (e.g. Seasons Change) produce one
	 *  ledger append and one combined stat-change card rather than one per field.
	 *  See {@link applyChanges}, which also carries flags in that same update. */
	async setSystemValues(updates, options = {}) {
		await this.applyChanges({ system: updates }, options);
	}

	getStatValue(statKey) {
		const attrKeys = { population: 0, prosperity: 0, surplus: 1 };
		if (statKey in attrKeys) {
			return Number(this.getSystemValue(`attributes.${statKey}.value`, attrKeys[statKey]));
		}
		const statDefaults = { fortunes: 1, defenses: 0 };
		return Number(this.getSystemValue(`stats.${statKey}.value`, statDefaults[statKey] ?? 0));
	}

	/** Slug for a journal-sourced custom improvement, namespaced so it never collides
	 *  with the camelCase built-in slugs and so re-dropping the same card is idempotent. */
	_customImprovementSlug(name) {
		return `custom-${slugify(name)}`;
	}

	/**
	 * Append a {uuid, id, name} pointer row for `actor` to a people list — everything the
	 * row displays is read live off that actor (see steading-people.js#resolvePersonRow).
	 * Lives here, with the steading's other roster mutations, rather than being written from
	 * outside: the row's shape and its default are the model's to define.
	 *
	 * @param {"residents"|"neighbors"} list
	 * @returns {Promise<boolean>} whether the row was appended.
	 */
	async addPersonRow(list, actor) {
		if (!actor || !STEADING_DEFAULTS[list]) return false;
		const rows = foundry.utils.deepClone(this._flags[list] ?? STEADING_DEFAULTS[list]);
		rows.push({ uuid: actor.uuid, id: actor.id, name: actor.name, checked: false });
		await this.setFlags({ [list]: rows });
		return true;
	}

	/**
	 * Append `actor` to the Player Characters roster unless they are already on it.
	 * Shared by the drag-drop onto the sheet's Players section and by the automatic
	 * filing a character gets when its player finishes creation (see
	 * steading-people.js#addCharacterToSteadingPlayers), so both write one row shape and
	 * agree on what "already listed" means.
	 *
	 * `checked` starts true — a new character is in the village until someone says
	 * otherwise — and the three editable columns start blank; everything the row
	 * DISPLAYS (name, portrait, playbook) is read live off the character, so only the
	 * GM's own annotations live on the row.
	 *
	 * @param {Actor} actor  a `character` actor
	 * @returns {Promise<boolean>} whether a row was appended
	 */
	async addPlayerRow(actor) {
		if (actor?.type !== "character") return false;
		const rows = foundry.utils.deepClone(this._flags.players ?? STEADING_DEFAULTS.players);
		if (playerRowIndex(rows, actor) >= 0) return false;
		rows.push({
			id:        actor.id ?? actor._id ?? "",
			uuid:      actor.uuid ?? "",
			name:      actor.name,
			img:       actor.img ?? "",
			checked:   true,
			traits:    "",
			relations: "",
			notes:     "",
		});
		await this.setFlags({ players: rows });
		return true;
	}

	/**
	 * Add a journal-sourced steading improvement (dropped from a bestiary-style card)
	 * as a tracked custom improvement. The definition is normalized into the same
	 * shape as IMPROVEMENT_DEFINITIONS so the snapshot/template treat it identically.
	 * No-op (returns `{ ok: false }`) when the name is empty or already present (by
	 * built-in label or existing custom slug), so re-dropping the same card is safe.
	 * `category` is optional and only kept when it names a real one — a journal card
	 * carries none, and an uncategorised improvement is simply immune to the tab's
	 * category filter (see IMPROVEMENT_CATEGORIES).
	 * A section's `min` ("2 of the following") and `group` (alternatives, either/or) and
	 * the improvement's `grants` (what completing it applies by itself) ride through
	 * normalized rather than being dropped: the requirement check and the grant engine
	 * both read them off the definition, so an authored improvement can carry everything
	 * a built-in one does. See utils/improvement-def.js.
	 * @param {{name:string, flavor?:string, effect?:string, category?:string, sections?:Array, grants?:object}} def
	 */
	async addCustomImprovement(def) {
		const name = String(def?.name ?? "").trim();
		if (!name) return { ok: false, reason: "empty" };

		const slug = this._customImprovementSlug(name);
		const existing = this._flags.customImprovements ?? [];
		if (BUILTIN_IMPROVEMENT_LABELS.has(name.toLowerCase()) || existing.some(d => d.slug === slug)) {
			return { ok: false, reason: "duplicate", slug, label: name };
		}

		const normalized = {
			slug,
			label: name,
			category: IMPROVEMENT_CATEGORY_KEYS.has(def.category) ? def.category : "",
			flavor: String(def.flavor ?? ""),
			sections: normalizeImprovementSections(def.sections),
			effect: String(def.effect ?? ""),
			// null rather than absent: a custom improvement with no automatic effects still
			// says so, and setImprovementCompleted reads `?? null` either way.
			grants: normalizeImprovementGrants(def.grants),
		};
		await this.setFlags({ customImprovements: [...existing, normalized] });
		return { ok: true, slug, label: name };
	}

	/** Resolve an improvement definition by slug — built-in first, then custom. */
	improvementDef(slug) {
		return IMPROVEMENT_DEFINITIONS.find(d => d.slug === slug)
			?? (this._flags.customImprovements ?? []).find(d => d.slug === slug)
			?? null;
	}

	/**
	 * An improvement's flat, in-order requirement state — the array its checkboxes write, and
	 * what the two rules that turn on a CHOICE made while building are read from (the militia's
	 * trained tactics, whether Additional Housing went up on the fields).
	 *
	 * HERE rather than on the sheet, where it was: it is derived steading state like every
	 * sibling on this class (`holdsView`, `improvementCompleted`, `_herdView`), the sheet's copy
	 * reached into `_flags` from the view layer, and a macro or a chat handler asking the same
	 * question had nowhere to ask it.
	 */
	improvementRequirements(slug) {
		return this._flags.improvements?.[slug]?.r ?? [];
	}

	/** Remove a custom improvement and clear its tracking state. */
	async removeCustomImprovement(slug) {
		const existing = this._flags.customImprovements ?? [];
		const next = existing.filter(d => d.slug !== slug);
		if (next.length === existing.length) return false;
		const improvements = { ...(this._flags.improvements ?? {}) };
		delete improvements[slug];
		await this.setFlags({ customImprovements: next, improvements });
		return true;
	}

	/**
	 * Mark an improvement complete (or not) and, in the same actor update, auto-apply
	 * (or reverse) its one-time mechanical grants — stat bumps, Resources/Fortifications
	 * additions, size/population changes (see IMPROVEMENT_GRANTS). What was actually
	 * applied is recorded on the improvement's own tracking entry (`applied`) so
	 * un-completing reverses exactly that, and so re-completing never double-applies.
	 * Bundling everything into one update keeps the ledger entries adjacent (e.g.
	 * "Improvement completed: Raincatching", "Fortunes 1 → 2", "Resource added:
	 * Raincatching") and makes the whole thing atomic and undoable.
	 *
	 * @param {string} slug
	 * @param {boolean} checked  Completing (true) or un-completing (false).
	 * @param {{forceR?: Array<boolean>}} [opts]  Overwrite the requirement-tracking array
	 *   (used when the user force-completes an improvement whose steps aren't all met).
	 * @returns {{label: string, summary: string[], reverted: boolean}}  A description of
	 *   the auto-applied (or reversed) changes, for a user-facing notification.
	 */
	async setImprovementCompleted(slug, checked, { forceR } = {}) {
		const def = this.improvementDef(slug);
		// A built-in improvement's grants are keyed by slug; a custom one carries its own
		// on the definition (authored in the builder dialog, or riding in on a dropped
		// card). The table wins, so a custom improvement can never take over a built-in
		// slug's effects by name collision.
		const grants = IMPROVEMENT_GRANTS[slug] ?? def?.grants ?? null;
		const improvements = foundry.utils.deepClone(this._flags.improvements ?? {});
		const entry = improvements[slug] ?? { completed: false, r: [] };
		if (Array.isArray(forceR)) entry.r = forceR;

		// Back-fill for improvements completed under a version BEFORE this grants engine:
		// such an entry is `completed:true` with no `applied` record, and its book effect
		// was applied by hand. Record the grant's full presumed footprint (NOT via
		// _collectGrantEffects, which records only what it would change now and so silently
		// drops resources/fortifications/size already present — orphaning them on revert) so
		// the first toggle reverses/re-applies symmetrically. Normalize an empty reconstruction
		// to null (matching the fresh-apply convention) so nothing is falsely reported reverted.
		// A fresh completion — `entry.completed` still false here — skips this untouched.
		if (grants && entry.completed && entry.applied === undefined) {
			const presumed = this._presumeAppliedGrants(grants);
			entry.applied = Object.keys(presumed).length ? presumed : null;
		}

		const data = {};
		let summary = [];
		let reverted = false;

		if (checked) {
			entry.completed = true;
			// Apply grants once, on the transition into completion. `applied` gates against
			// re-applying if a completed improvement is toggled complete again somehow.
			if (grants && !entry.applied) {
				const applied = this._collectGrantEffects(grants, data);
				entry.applied = Object.keys(applied).length ? applied : null;
				summary = this._summarizeGrantChanges(entry.applied);
			}
		} else {
			entry.completed = false;
			if (entry.applied) {
				this._revertGrantEffects(entry.applied, data);
				summary = this._summarizeGrantChanges(entry.applied);
				reverted = true;
				// Null (not delete): a merged flag write can't drop a sub-key, so overwrite it.
				entry.applied = null;
			}
		}

		// Herd of Horses tracks a herd of horses ("make a note of its size"). Seed a
		// starting herd once, when first earned; never auto-remove it on un-complete, so
		// the counts the table has kept up across seasons aren't wiped by a mistaken
		// toggle. It lives in its own flag (not the reversible grant record) for that reason.
		if (slug === "herdOfHorses" && checked && !this._flags.herd) {
			data[`flags.${STONETOP_SCOPE}.steading.herd`] = { ...HERD_START };
		}

		improvements[slug] = entry;
		data[`flags.${STONETOP_SCOPE}.steading.improvements`] = improvements;
		await this._actor.update(data);

		return { label: def?.label ?? slug, summary, reverted };
	}

	/**
	 * The steading's tracked Herd of Horses, normalized to non-negative integer tiers
	 * with a computed total. Defaults to the starting herd when no counts are stored yet
	 * (e.g. a herd earned before this tracker existed) so the tracker and season math
	 * always have real numbers to work with.
	 */
	getHerd() {
		const h = this._flags.herd;
		const tier = (key) => Math.max(0, Math.trunc(Number(h ? h[key] : HERD_START[key]) || 0));
		const grown = tier("grown"), yearlings = tier("yearlings"), foals = tier("foals");
		return { grown, yearlings, foals, total: grown + yearlings + foals };
	}

	/**
	 * Persist the herd tiers (each clamped ≥ 0). Pass `options.stonetopMove` to attribute
	 * the change to a move (e.g. "Seasons Change") in the ledger.
	 */
	async setHerd(counts, options = {}) {
		const clean = {
			grown: Math.max(0, Math.trunc(Number(counts.grown) || 0)),
			yearlings: Math.max(0, Math.trunc(Number(counts.yearlings) || 0)),
			foals: Math.max(0, Math.trunc(Number(counts.foals) || 0)),
		};
		await this._actor.update({ [`flags.${STONETOP_SCOPE}.steading.herd`]: clean }, options);
		return { ...clean, total: clean.grown + clean.yearlings + clean.foals };
	}

	/**
	 * Whether a once-per-season Seasons-Change step (e.g. "advanceHerd", "feedHerd",
	 * "surplus", "consumption") has already been applied for this year+season. The dialog
	 * persists this because it stays open while only the sheet behind it re-renders, so its
	 * in-DOM `disabled` guard doesn't survive a close+reopen — without a persisted marker a
	 * reopen re-enables the button and applies the step's state mutation a second time.
	 * Keyed by step name; the stored value is the "<year>:<season>" it last ran for.
	 */
	seasonStepApplied(step, year, seasonId) {
		return this._flags.seasonSteps?.[step] === `${year}:${seasonId}`;
	}

	/** The flag a once-per-season marker sets, WITHOUT writing it — so a move that spends a
	 *  stat AND closes its season step (the Inn's gathering, the watch's upkeep) can carry
	 *  both in one update instead of firing a second one the ledger cards on its own. */
	seasonStepFlags(step, year, seasonId) {
		return { seasonSteps: { ...(this._flags.seasonSteps ?? {}), [step]: `${year}:${seasonId}` } };
	}

	/** Record that a once-per-season step ran for this year+season (see seasonStepApplied). */
	async setSeasonStepApplied(step, year, seasonId) {
		await this.setFlags(this.seasonStepFlags(step, year, seasonId));
	}

	/**
	 * Spend Surplus on a seasonal obligation, and close that obligation's season step, in ONE
	 * write. Returns what is left, or null when the steading cannot afford it (nothing written).
	 *
	 * The one place the rule lives. It was written out at each of the Inn's gathering, the
	 * watch's upkeep and the weapons' upkeep, and all three had to agree on the part that is
	 * easy to get wrong: Surplus is re-read LIVE here rather than taken from whatever the
	 * window was built with, because the sheet behind these dialogs stays interactive and a
	 * Surplus spent elsewhere in the meantime would otherwise be handed back by writing a
	 * stale count minus one.
	 *
	 * @param {number} amount               Surplus to spend
	 * @param {object} opts
	 * @param {string} opts.stonetopMove    what the ledger names as the cause
	 * @param {string} [opts.step]          season-step key to close in the same write
	 * @param {number} [opts.year]
	 * @param {string} [opts.seasonId]
	 * @param {object} [opts.also]          further `system.*` paths to set in that same write
	 * @param {object} [opts.alsoFlags]     further steading FLAGS to set in that same write —
	 *                                      what a spend that also closes something the season
	 *                                      steps do not cover needs (winter's second consumption
	 *                                      clears its own debt this way)
	 * @returns {Promise<number|null>} Surplus remaining, or null if it could not be afforded
	 */
	async spendSurplus(amount, { stonetopMove, step = "", year, seasonId, also = {}, alsoFlags = {} } = {}) {
		const live = this.getStatValue("surplus");
		if (live < amount) return null;
		await this.applyChanges({
			system: { "attributes.surplus.value": live - amount, ...also },
			flags: {
				...(step && seasonId ? this.seasonStepFlags(step, year, seasonId) : {}),
				...alsoFlags,
			},
		}, { stonetopMove });
		return live - amount;
	}

	/**
	 * Is advantage being held over the steading's NEXT +Fortunes roll?
	 *
	 * Rites of the Land: "publicly sacrifice something or someone much-loved… either clear a
	 * steading debility or gain advantage when the steading next rolls +Fortunes." That second
	 * half is a promise about a roll nobody has made yet — possibly not this session — so it has
	 * to be written down somewhere the roll will look, and the steading is the only thing both
	 * the sacrificing character and the later roll can see.
	 *
	 * Stored as WHAT PROMISED it, not as a bare `true`: the roll card names the source, so a
	 * player who has forgotten why their Seasons Change is at advantage can read it off the card.
	 */
	fortunesAdvantage() {
		return this._flags.fortunesAdvantage ?? null;
	}

	/** Hold advantage over the next +Fortunes roll, attributed to `source`. */
	async holdFortunesAdvantage(source) {
		await this.setFlags({ fortunesAdvantage: { source: String(source ?? "").trim() || "a sacrifice" } });
	}

	/**
	 * Spend the hold. Called by the roll itself, which is the only thing that may clear it —
	 * a hold that survived the roll it was promised to would apply to every Fortunes roll after.
	 */
	async clearFortunesAdvantage() {
		if (!this.fortunesAdvantage()) return;
		await this.setFlags({ fortunesAdvantage: null });
	}

	/**
	 * Is the muster up, and what did raising it cost?
	 *
	 * "The steading is alert and ready for action UNTIL the threat passes, the Seasons Change,
	 * or you cease to oversee the muster" — a state with three exits, only one of which the
	 * system can see coming (the season). So it is stored with the season it was raised in and
	 * read back against the clock: a muster nobody stood down lapses on its own when the season
	 * turns, which is exactly what the book says happens.
	 *
	 * `defenses` records whether the "+1 Defenses as long as the muster holds" pick was taken,
	 * because that bonus has to be TAKEN BACK when the muster ends. An un-reverted +1 on the
	 * sheet is worse than a missing one: nobody can tell by looking that it is stale.
	 */
	musterHold() {
		const held = this._flags.musterHold ?? null;
		if (!held?.season) return null;
		const now = seasonStampKey(readCurrentSeason(this._actor));
		// Raised in a season the clock has since left: the muster lapsed with it.
		if (now && now !== `${held.year}:${held.season}`) return null;
		return held;
	}

	/** Raise the muster for the current season, optionally taking the +1 Defenses pick. */
	async raiseMuster({ defenses = false } = {}) {
		const { seasonId, year } = seasonStampParts(this._actor);
		// The Defenses bump and the hold itself are one move, so they go out as one update:
		// two would append the muster to the ledger twice and card the stat change on its own.
		await this.applyChanges({
			system: defenses ? { "stats.defenses.value": this.getStatValue("defenses") + 1 } : {},
			flags: { musterHold: { year, season: seasonId, defenses: !!defenses } },
		}, { stonetopMove: "Muster" });
	}

	/**
	 * Stand the muster down, giving back the Defenses it borrowed.
	 *
	 * Reads the RAW flag rather than `musterHold()`: a muster that has already lapsed by the
	 * clock still has a +1 on the sheet if it took one, and that is precisely the case where
	 * the bonus would otherwise be stranded.
	 */
	async standDownMuster() {
		const lapse = this.musterLapseChanges();
		if (!lapse) return null;
		await this.applyChanges({ system: lapse.system, flags: lapse.flags },
			{ stonetopMove: "Muster" });
		return lapse.held;
	}

	/**
	 * What standing the muster down would change, WITHOUT writing it.
	 *
	 * Exists so the Seasons Change — which lapses the muster as one of several things it does
	 * at once — can fold the give-back into its own single update rather than firing a second
	 * one, which would card the Defenses change separately and credit it to the wrong move.
	 * Returns null when no muster is held.
	 */
	musterLapseChanges() {
		const held = this._flags.musterHold ?? null;
		if (!held) return null;
		return {
			held,
			system: held.defenses
				? { "stats.defenses.value": this.getStatValue("defenses") - 1 }
				: {},
			flags: { musterHold: null },
		};
	}

	/**
	 * Tor's blessing: "+1 to Pull Together this season, and when you roll the Die of Fate for
	 * weather, roll twice and take your pick."
	 *
	 * Stored as the "<year>:<season>" it was granted for, exactly like the once-per-season step
	 * markers, so it expires by simply ceasing to match the clock. Nothing has to remember to
	 * sweep it up when the season turns.
	 */
	torsBlessingActive() {
		const held = this._flags.torsBlessing ?? null;
		if (!held) return false;
		const now = seasonStampKey(readCurrentSeason(this._actor));
		return !!now && held === now;
	}

	/** The flag a Tor's-blessing grant sets, WITHOUT writing it — so the Seasons Change, which
	 *  hands the blessing out alongside its Fortunes reset and any ticked gains, can carry it
	 *  in the same update as the rest. Empty when there is no season to stamp it against. */
	torsBlessingFlags(year, seasonId) {
		return seasonId ? { torsBlessing: `${year}:${seasonId}` } : {};
	}

	/** Grant Tor's blessing for a year+season (the Seasons Change gain that hands it out). */
	async setTorsBlessing(year, seasonId) {
		await this.setFlags(this.torsBlessingFlags(year, seasonId));
	}

	/**
	 * Winter's second bite: "the steading must consume 1d4+Population more Surplus before winter
	 * ends, or suffer the consequences again" (the Seasons Change 7-9 in winter, and the 6- that
	 * repeats it).
	 *
	 * The ONE thing in the seasonal flow the steading never used to remember. It is said once, in
	 * a chat card, and then the table has to carry it across however many sessions winter takes.
	 * So unlike the other holds this one is stored rather than derived: `{ stamp, amount }`, where
	 * the stamp is the "<year>:<season>" it was rolled for, exactly like Tor's blessing.
	 *
	 * That stamp is also its expiry, and it expires by ceasing to match the clock rather than by
	 * being swept up. "Before winter ends" is the deadline, so when the clock leaves that winter
	 * the debt stops being collectable and the glyph goes out. What an unpaid winter cost is the
	 * GM's to narrate: the book says "suffer the consequences again", and a system that quietly
	 * charged a steading for it on the way into spring would be inventing a ruling.
	 */
	winterDebt() {
		const held = this._flags.winterDebt ?? null;
		const amount = Math.max(0, Math.trunc(Number(held?.amount) || 0));
		if (!amount) return null;
		const now = seasonStampKey(readCurrentSeason(this._actor));
		if (!now || held.stamp !== now) return null;
		return { amount, surplus: this.getStatValue("surplus") };
	}

	/** Record what winter still wants, for the year+season it was rolled in. Writes nothing at
	 *  all with no season to stamp against: a debt rolled before any Seasons Change has nothing
	 *  to expire against, and a stamp it could never match would neither show nor clear. */
	async setWinterDebt(amount, year, seasonId) {
		if (!seasonId) return;
		await this.setFlags({ winterDebt: { stamp: `${year}:${seasonId}`, amount } });
	}

	/** Settle it. Null rather than a "-=" deletion: the tray reads the AMOUNT, so a zeroed debt
	 *  is already invisible, and a null leaves the flag readable by anything auditing the year. */
	async clearWinterDebt() {
		await this.setFlags({ winterDebt: null });
	}

	/** Has this improvement been built? What gates every improvement-fed seasonal obligation. */
	improvementCompleted(slug) {
		return !!this._flags.improvements?.[slug]?.completed;
	}

	/**
	 * The header's hold tray: everything the steading is still owed or still owes.
	 *
	 * The seasonal DUES are gated on the clock having been stamped at all. Before a world's
	 * first Seasons Change nothing has turned, so an upkeep cannot yet be overdue — without
	 * that gate a fresh steading would open wearing obligations it has had no season to meet.
	 */
	holdsView() {
		const { seasonId, year } = seasonStampParts(this._actor);
		const inn = this.improvementCompleted("inn") ? this._innGatheringView() : null;
		// The herd's two seasonal steps read exactly like the watch's and the weapons': built,
		// in the right season, and not yet stamped. They are the SAME markers the Seasons Change
		// dialog disables its buttons from (advanceHerd, feedHerd), so the tray and that dialog
		// can never disagree about whether the herd has been seen to.
		const herd = this.improvementCompleted("herdOfHorses");
		const herdCost = herd ? StonetopSteading.herdWinterCost(this.getHerd()) : 0;
		return steadingHolds({
			fortunesAdvantage: this.fortunesAdvantage(),
			muster: this.musterHold(),
			torsBlessing: this.torsBlessingActive(),
			herdAdvance: seasonId === "summer" && herd
				&& !this.seasonStepApplied("advanceHerd", year, seasonId),
			// Only when it would actually do something: an inn with no debility to clear, or
			// no Surplus to spend, is not an unspent opportunity, it is just an inn.
			innGathering: !!inn?.canGather,
			standingWatch: !!seasonId
				&& this.improvementCompleted("standingWatch")
				&& !this.seasonStepApplied(WATCH_SEASON_STEP, year, seasonId),
			weaponsUpkeep: seasonId === "spring"
				&& this.improvementCompleted("weaponsOfWar")
				&& !this.seasonStepApplied(WEAPONS_SEASON_STEP, year, seasonId),
			// Summer's drills, read exactly like the weapons' spring bill. The improvements'
			// seasonal YIELDS are deliberately not here beside it: what the Market and the
			// Township generate is collected inside the Seasons Change window, like the season's
			// own Surplus roll, which has never worn a glyph either. A due that costs you
			// something if you skip it does; Surplus waiting to be picked up does not.
			militiaTraining: seasonId === "summer"
				&& this.improvementCompleted("wellTrainedMilitia")
				&& !this.seasonStepApplied(MILITIA_SEASON_STEP, year, seasonId),
			// A herd under HERD_SURPLUS_PER head eats nothing, and a bill for 0 Surplus is not
			// an obligation, so `herdCost` gates the row as well as filling in its number.
			herdFeed: seasonId === "winter" && herd && herdCost > 0
				&& !this.seasonStepApplied("feedHerd", year, seasonId)
				? { needed: herdCost, surplus: this.getStatValue("surplus") }
				: null,
			winterDebt: this.winterDebt(),
		});
	}

	/** Herd shaped for the improvement card: the three tiers (with labels/Values) plus total. */
	_herdView() {
		const herd = this.getHerd();
		return { ...herd, tiers: HERD_TIERS.map((t) => ({ ...t, count: herd[t.key] })) };
	}

	/**
	 * The Inn's once-per-season gathering, as the improvement card renders it.
	 *
	 * Reads the season clock off this same actor, so a card drawn before any Seasons Change
	 * has been recorded (no stamp yet) reports `done: false` and lets the gathering happen —
	 * the alternative is an inn that cannot be used until someone runs the seasonal flow.
	 */
	_innGatheringView() {
		const { seasonId, year } = seasonStampParts(this._actor);
		const state = innGatheringState({
			surplus: this.getStatValue("surplus"),
			done: !!(seasonId && this.seasonStepApplied(INN_SEASON_STEP, year, seasonId)),
			debilities: markedDebilities(this).map(d => d.id),
		});
		return { ...state, seasonLabel: seasonId ? seasonLabel(seasonId) : "this season" };
	}

	/**
	 * The summer herd advancement (pure): yearlings→grown, foals→yearlings, and
	 * `newFoals` (already rolled = max(0, 1d4+Fortunes)) become the new foals. Returns
	 * the next tiers so the caller can persist + report.
	 */
	static advanceHerdForSummer(herd, newFoals) {
		return {
			grown: (herd.grown || 0) + (herd.yearlings || 0),
			yearlings: herd.foals || 0,
			foals: Math.max(0, Math.trunc(Number(newFoals) || 0)),
		};
	}

	/** Winter Surplus needed to feed the herd (pure): 1 per HERD_SURPLUS_PER grown-or-yearling
	 *  horses. Shared by feedHerdForWinter and the sheet's pre-roll shortfall/dice-count check. */
	static herdWinterCost(herd) {
		return Math.floor(((herd?.grown || 0) + (herd?.yearlings || 0)) / HERD_SURPLUS_PER);
	}

	/**
	 * The winter herd feeding (pure): the herd needs 1 Surplus per HERD_SURPLUS_PER
	 * grown-or-yearling horses. `availableSurplus` is fed first; `losses` (already rolled
	 * = sum of 1d6 per unfed Surplus) horses are then removed, taking from the oldest
	 * tiers first (grown → yearlings → foals). Returns what to write and a breakdown.
	 */
	static feedHerdForWinter(herd, availableSurplus, losses = 0) {
		const cost = StonetopSteading.herdWinterCost(herd);
		const paid = Math.max(0, Math.min(cost, Math.max(0, availableSurplus)));
		const shortfall = cost - paid;
		let toRemove = Math.max(0, Math.trunc(Number(losses) || 0));
		const next = { grown: herd.grown || 0, yearlings: herd.yearlings || 0, foals: herd.foals || 0 };
		for (const key of ["grown", "yearlings", "foals"]) {
			const take = Math.min(next[key], toRemove);
			next[key] -= take;
			toRemove -= take;
		}
		return { cost, paid, shortfall, herd: next, lost: (herd.grown + herd.yearlings + herd.foals) - (next.grown + next.yearlings + next.foals) };
	}

	/** True when `list` already holds an entry with this name (case-insensitive). */
	_listHasName(list, name) {
		const target = String(name).trim().toLowerCase();
		return list.some(e => String(e?.name ?? "").trim().toLowerCase() === target);
	}

	/** Add a named entry to a steading list, filling the first empty slot or appending. */
	_addNamedToList(list, name, checked = true) {
		const emptyIdx = list.findIndex(e => !String(e?.name ?? "").trim());
		if (emptyIdx >= 0) list[emptyIdx] = { ...list[emptyIdx], name, checked };
		else list.push({ name, checked });
	}

	/** Clear the first entry matching `name` (case-insensitive) in place; return it, or null. */
	_clearNamedInList(list, name) {
		const target = String(name).trim().toLowerCase();
		const idx = list.findIndex(e => String(e?.name ?? "").trim().toLowerCase() === target);
		if (idx < 0) return null;
		const removed = list[idx];
		list[idx] = { ...list[idx], name: "", checked: false };
		return removed;
	}

	/**
	 * Best-effort reconstruction of the `applied` record for an improvement that was completed
	 * under a version before this grants engine (its book effect was applied by hand). Unlike
	 * _collectGrantEffects — which records only what it actually writes and so skips resources /
	 * fortifications / size that are already present — this records the grant's FULL additive
	 * footprint from the definition, so the first un-complete reverses it symmetrically instead
	 * of leaving those entries orphaned. Writes nothing; only produces the record.
	 *
	 * Size/Population transitions are recorded only when the steading still holds a *different*
	 * prior value: once it's already at the grant's target we can't know the original, so we
	 * don't fabricate a reversal (leaving it intact is the honest choice).
	 */
	_presumeAppliedGrants(grants) {
		const applied = {};

		if (grants.stats) {
			const stats = {};
			for (const [key, delta] of Object.entries(grants.stats)) {
				if (GRANT_STAT_PATHS[key] && delta) stats[key] = delta;
			}
			if (Object.keys(stats).length) applied.stats = stats;
		}

		if (grants.resources?.length) applied.resources = [...grants.resources];
		if (grants.fortifications?.length) applied.fortifications = [...grants.fortifications];
		if (grants.removeFortifications?.length) {
			// Presume the cleared fortifications were active when the grant removed them, so
			// reversing restores them as checked.
			applied.removedFortifications = grants.removeFortifications.map(name => ({ name, checked: true }));
		}

		if (grants.setSize) {
			const from = this._flags.size ?? STEADING_DEFAULTS.size;
			if (from !== grants.setSize) applied.setSize = { from, to: grants.setSize };
		}
		if (Number.isFinite(grants.setPopulation)) {
			const from = Number(this.getSystemValue("attributes.population.value", 0));
			if (from !== grants.setPopulation) applied.setPopulation = { from, to: grants.setPopulation };
		}

		return applied;
	}

	/**
	 * Build the `system.*`/flag updates for an improvement's grants into `data` and
	 * return a compact record of exactly what changed, so it can be reversed later.
	 */
	_collectGrantEffects(grants, data) {
		const applied = {};
		const scope = STONETOP_SCOPE;

		if (grants.stats) {
			const stats = {};
			for (const [key, delta] of Object.entries(grants.stats)) {
				const path = GRANT_STAT_PATHS[key];
				if (!path || !delta) continue;
				const next = Number(this.getSystemValue(path, 0)) + delta;
				data[`system.${path}`] = next;
				data[`flags.${scope}.steading.system.${path}`] = next;
				stats[key] = delta;
			}
			if (Object.keys(stats).length) applied.stats = stats;
		}

		// Resources and Fortifications: additions (Fortifications may also remove entries).
		for (const listKey of ["resources", "fortifications"]) {
			const additions = grants[listKey] ?? [];
			const removals = listKey === "fortifications" ? (grants.removeFortifications ?? []) : [];
			if (!additions.length && !removals.length) continue;

			const list = foundry.utils.deepClone(this._flags[listKey] ?? STEADING_DEFAULTS[listKey]);
			let touched = false;

			const added = [];
			for (const name of additions) {
				if (this._listHasName(list, name)) continue; // idempotent — don't duplicate an existing entry
				this._addNamedToList(list, name, true);
				added.push(name);
				touched = true;
			}
			if (added.length) applied[listKey] = added;

			const removed = [];
			for (const name of removals) {
				const gone = this._clearNamedInList(list, name);
				if (gone) { removed.push({ name: gone.name, checked: !!gone.checked }); touched = true; }
			}
			if (removed.length) applied.removedFortifications = removed;

			if (touched) data[`flags.${scope}.steading.${listKey}`] = list;
		}

		if (grants.setSize) {
			const from = this._flags.size ?? STEADING_DEFAULTS.size;
			if (from !== grants.setSize) {
				data[`flags.${scope}.steading.size`] = grants.setSize;
				applied.setSize = { from, to: grants.setSize };
			}
		}

		if (Number.isFinite(grants.setPopulation)) {
			const from = Number(this.getSystemValue("attributes.population.value", 0));
			if (from !== grants.setPopulation) {
				data["system.attributes.population.value"] = grants.setPopulation;
				data[`flags.${scope}.steading.system.attributes.population.value`] = grants.setPopulation;
				applied.setPopulation = { from, to: grants.setPopulation };
			}
		}

		return applied;
	}

	/** Reverse a previously-applied grant record into `data` (negate stats, remove added
	 *  list entries, restore removed ones, roll size/population back). */
	_revertGrantEffects(applied, data) {
		const scope = STONETOP_SCOPE;

		if (applied.stats) {
			for (const [key, delta] of Object.entries(applied.stats)) {
				const path = GRANT_STAT_PATHS[key];
				if (!path) continue;
				const next = Number(this.getSystemValue(path, 0)) - delta;
				data[`system.${path}`] = next;
				data[`flags.${scope}.steading.system.${path}`] = next;
			}
		}

		for (const listKey of ["resources", "fortifications"]) {
			const addedNames = applied[listKey] ?? [];
			const restore = listKey === "fortifications" ? (applied.removedFortifications ?? []) : [];
			if (!addedNames.length && !restore.length) continue;
			const list = foundry.utils.deepClone(this._flags[listKey] ?? STEADING_DEFAULTS[listKey]);
			for (const name of addedNames) this._clearNamedInList(list, name);
			for (const item of restore) this._addNamedToList(list, item.name, item.checked);
			data[`flags.${scope}.steading.${listKey}`] = list;
		}

		if (applied.setSize) data[`flags.${scope}.steading.size`] = applied.setSize.from;

		if (applied.setPopulation) {
			data["system.attributes.population.value"] = applied.setPopulation.from;
			data[`flags.${scope}.steading.system.attributes.population.value`] = applied.setPopulation.from;
		}
	}

	/** Human-readable one-liners describing an `applied` grant record, for a notification. */
	_summarizeGrantChanges(applied) {
		if (!applied) return [];
		const parts = [];
		if (applied.stats) {
			for (const [key, delta] of Object.entries(applied.stats)) {
				parts.push(statGrantLine(key, delta));
			}
		}
		if (applied.resources?.length) parts.push(`Resources +${applied.resources.join(", ")}`);
		if (applied.fortifications?.length) parts.push(`Fortifications +${applied.fortifications.join(", ")}`);
		if (applied.removedFortifications?.length) parts.push(`Fortifications −${applied.removedFortifications.map(e => e.name).join(", ")}`);
		if (applied.setSize) parts.push(`Size → ${applied.setSize.to}`);
		if (applied.setPopulation) parts.push(`Population → ${applied.setPopulation.to}`);
		return parts;
	}

	/** Every named asset, on hand or out, each carrying its index in the stored list. */
	getNamedAssets() {
		const assets = this._flags.assets ?? STEADING_DEFAULTS.assets;
		return assets
			.map((asset, index) => ({ ...asset, index }))
			.filter(asset => asset.name);
	}

	/**
	 * The named assets a given expedition is currently holding.
	 *
	 * The steading is the record of where a communal asset actually IS, so the walkthrough's
	 * Requisition step reads this rather than trusting its own note of what it took: returning
	 * a horse from the steading sheet has to leave the trip's list showing the horse back home.
	 */
	getAssetsOnExpedition(expeditionId) {
		if (!expeditionId) return [];
		return this.getNamedAssets().filter(asset => asset.takenBy?.expedition?.id === expeditionId);
	}

	/** Named assets that are currently on hand (have a name and are not out on requisition). */
	getAvailableAssets() {
		return this.getNamedAssets().filter(asset => !asset.takenBy);
	}

	/**
	 * Mark an asset as requisitioned (taken out on an expedition): uncheck it and
	 * record where it went. Returns false if the index is out of range.
	 *
	 * `takenBy` names a person (the player-facing Requisition move), an expedition (the GM
	 * walkthrough's Requisition step), or both. Whatever it holds, one helper words it for
	 * every reader: see assetTakenLabel in utils/requisition-asset.js.
	 *
	 * @param {number} index
	 * @param {{name?: string, id?: string, expedition?: {id: string, title: string}}} takenBy
	 */
	async setAssetTaken(index, takenBy) {
		const assets = foundry.utils.deepClone(this._flags.assets ?? STEADING_DEFAULTS.assets);
		if (!assets[index]?.name) return false;
		assets[index] = { ...assets[index], checked: false, takenBy };
		await this.setFlags({ assets });
		return true;
	}

	/**
	 * Bring every asset held by an expedition back into step with the log.
	 *
	 * The trip's name is COPIED onto the asset at take time rather than looked up, so the
	 * steading sheet can say where the wagon went without reading the walkthrough's world
	 * setting. That is the right trade (the sheet stays independent of the walkthrough) but a
	 * copy goes stale in TWO ways, and both are the same question asked of the whole log:
	 *
	 *   RENAMED. The trip is still there under a new name, so the copy is re-stamped. An unnamed
	 *   trip is "Expedition N" by its POSITION, so deleting one silently renames every unnamed
	 *   trip after it, and an asset tagged "Expedition 3" against a switcher now reading
	 *   "Expedition 2" names no trip at all.
	 *
	 *   GONE. The trip is not in the log any more, so it is holding nothing: the asset comes
	 *   home. Leaving it out would strand the wagon, struck through on the sheet and tagged to a
	 *   trip that no longer exists, which the walkthrough offers no way back from.
	 *
	 * `names` MUST be the whole log, because absence from it is what "deleted" means here. One
	 * write, whatever it finds, and none at all when everything already agrees.
	 *
	 * @param {Map<string,string>} names  every logged trip's id to its display name
	 * @returns {Promise<number>} how many assets were re-labelled or sent home
	 */
	async reconcileHeldAssets(names) {
		const assets = foundry.utils.deepClone(this._flags.assets ?? STEADING_DEFAULTS.assets);
		let changed = 0;
		assets.forEach((asset, i) => {
			const exp = asset?.takenBy?.expedition;
			if (!exp?.id) return;
			if (!names?.has(exp.id)) {
				// Home again. `checked` is the on-hand tick, exactly as `returnAsset` leaves it.
				const { takenBy, ...rest } = asset;
				assets[i] = { ...rest, checked: true };
				changed += 1;
				return;
			}
			const title = names.get(exp.id);
			if (exp.title === title) return;
			assets[i] = { ...asset, takenBy: { ...asset.takenBy, expedition: { ...exp, title } } };
			changed += 1;
		});
		if (changed) await this.setFlags({ assets });
		return changed;
	}

	/** Return a requisitioned asset to the steading: re-check it and clear the taken-by note. */
	async returnAsset(index) {
		const assets = foundry.utils.deepClone(this._flags.assets ?? STEADING_DEFAULTS.assets);
		if (!assets[index]) return false;
		const { takenBy, ...rest } = assets[index];
		assets[index] = { ...rest, checked: true };
		await this.setFlags({ assets });
		return true;
	}

	async buildSnapshot() {
		const f = this._flags;
		const storedImps = f.improvements ?? {};

		const allActors = (typeof game !== "undefined" && game?.actors) ? game.actors : { filter: () => [], get: () => null };
		const allCharacters = allActors.filter(a => a.type === "character");
		// One lowercase-name index reused for every resident/neighbor/player lookup below,
		// rather than a fresh linear scan (with per-name toLowerCase) per entry each render.
		const characterByName = new Map();
		for (const a of allCharacters) {
			const key = a.name?.toLowerCase();
			if (key && !characterByName.has(key)) characterByName.set(key, a);
		}

		// Residents & Neighbors are backed by "npc" actors (see steading-people.js):
		// each row is a {uuid, id} pointer resolved live to its NPC. resolvePersonRow
		// preserves array position (index-aligned with the stored flags, which the
		// template's @index targets for edits/deletes) and falls back to any legacy
		// plain-text fields for a row not yet migrated (e.g. on a non-GM client).
		// resolvePersonRow is async (it enriches each NPC's rich notes for the cell
		// preview), so resolve the rows in parallel while preserving array order.
		const residents = await Promise.all((f.residents ?? STEADING_DEFAULTS.residents).map(r => resolvePersonRow(r)));
		const neighbors = await Promise.all((f.neighbors ?? STEADING_DEFAULTS.neighbors).map(n => resolvePersonRow(n)));

		const rawPlayers = f.players ?? STEADING_DEFAULTS.players;
		const players = rawPlayers.map(p => {
			// Resolve the live character so we can surface their playbook — by stored id
			// first, then name. Every row has carried an id since the roster shipped (see
			// playerRowIndex), so the name lookup is belt-and-braces here: it costs one map
			// hit and can only ever ADD a resolution, which is why this path keeps it while
			// the duplicate check doesn't.
			const actor = (p.id ? allActors.get(p.id) : null)
				|| (p.name ? characterByName.get(p.name.toLowerCase()) : null)
				|| null;
			// A playbook isn't an occupation — players may hold any job — so the
			// Occupation column shows only an explicit occupation; the playbook rides
			// the NAME instead ("Pim The Lightbearer"), and doubles as the portrait
			// hover preview's subtitle (or, for an art-less character, the placeholder's
			// tooltip — see the neighbors tab).
			//
			// playbookTitle, not the raw stored name, so a Would-Be Hero who has crossed
			// off "Would-be" is "The Hero" here exactly as on their own sheet header.
			const playbookName = playbookTitle(actor);
			const resolvedOccupation = p.occupation || "";
			// The LIVE portrait, not the stored one. `p.img` is a snapshot taken when the player
			// was dropped onto the roster, while a frame is authored against the character's own
			// actor.img — so the two stamps would disagree by construction and this would be the
			// one surface where framing silently never worked. The snapshot stays as the fallback
			// for a row whose actor has gone. `img` sits after the spread so it wins.
			const portrait = resolvePortrait(actor?.img || p.img, documentPortraitFrame(actor));
			// The LIVE name too, for the same reason and on the same terms as the portrait:
			// `p.name` is a snapshot from the drop, so a renamed character used to keep their
			// old name on the roster forever — the name cell isn't editable, so the only way
			// to correct it was to remove the row and re-add them. Residents/Neighbors have
			// always shown the live name (resolvePersonRow); this brings Players in line. The
			// snapshot stays as the fallback for a row whose actor has gone.
			const name = actor?.name || p.name || "";
			// The whole thing, for the places that need one string rather than two runs of
			// text — the open-sheet label a screen reader announces, and the row's tooltip.
			// Joined by the shared helper, so the sidebar epithet, the chat speaker and this
			// roster can't drift apart on separator or ordering. Falls back to the snapshot
			// name for a row whose actor has gone.
			const fullName = actor ? characterFullName(actor) : name;
			return { traits: "", relations: "", ...p, name, notes: p.notes ?? p.etc ?? "", resolvedOccupation, playbookName, fullName,
				img: portrait.src, imgStyle: portrait.style };
		});

		const mapImprovement = (def, custom) => {
			const stored = storedImps[def.slug] ?? {};
			let idx = 0;
			// A section that continues an either/or (it shares its predecessor's group id)
			// is drawn with an "or" divider above it, so a card offering two ways to meet
			// one requirement doesn't read as two requirements.
			const alternatives = alternativeSectionFlags(def.sections);
			const sections = def.sections.map((section, i) => ({
				heading: section.heading,
				alternative: alternatives[i],
				items: section.items.map(label => {
					const item = { label, index: idx, checked: (stored.r ?? [])[idx] ?? false };
					idx++;
					return item;
				}),
			}));
			const completed = stored.completed ?? false;
			const earned = completed || (stored.r ?? []).some(Boolean);
			// An improvement can only be marked complete once its requirements are
			// met; an already-complete one stays toggleable so it can be undone.
			const requirementsMet = improvementRequirementsMet(def, stored.r ?? []);
			return {
				slug: def.slug,
				label: def.label,
				// "" for a custom improvement that never got one — the sheet's category
				// chips leave those alone rather than filtering them out of existence.
				category: def.category ?? "",
				flavor: def.flavor,
				completed,
				earned,
				requirementsMet,
				completeLocked: !requirementsMet && !completed,
				sections,
				effect: def.effect,
				custom: !!custom,
				// Herd of Horses carries an interactive herd tracker once earned.
				herd: def.slug === "herdOfHorses" && completed ? this._herdView() : null,
				// The Inn carries its once-per-season gathering once built.
				innGathering: def.slug === "inn" && completed ? this._innGatheringView() : null,
			};
		};
		// Built-in improvements first, then any journal-sourced custom ones (dropped
		// onto the sheet); both share the same tracking store keyed by slug.
		const improvements = [
			...IMPROVEMENT_DEFINITIONS.map(def => mapImprovement(def, false)),
			...(f.customImprovements ?? []).map(def => mapImprovement(def, true)),
		];

		return {
			system: {
				stats: {
					fortunes: { value: this.getSystemValue("stats.fortunes.value", SYSTEM_DEFAULTS.stats.fortunes.value) },
					defenses: { value: this.getSystemValue("stats.defenses.value", SYSTEM_DEFAULTS.stats.defenses.value) },
				},
				attributes: {
					population: { value: this.getSystemValue("attributes.population.value", SYSTEM_DEFAULTS.attributes.population.value) },
					prosperity: { value: this.getSystemValue("attributes.prosperity.value", SYSTEM_DEFAULTS.attributes.prosperity.value) },
					surplus: { value: this.getSystemValue("attributes.surplus.value", SYSTEM_DEFAULTS.attributes.surplus.value) },
					debilities: {
						options: {
							diminished: { value: this.getSystemValue("attributes.debilities.options.diminished.value", false) },
							lacking: { value: this.getSystemValue("attributes.debilities.options.lacking.value", false) },
							malcontent: { value: this.getSystemValue("attributes.debilities.options.malcontent.value", false) },
						},
					},
				},
			},
			resources:      f.resources      ?? STEADING_DEFAULTS.resources,
			fortifications: f.fortifications ?? STEADING_DEFAULTS.fortifications,
			// Each asset carries the one line that says where it has gone (assetTakenLabel, which
			// the tooltip wraps), so the sheet, the player-facing picker and the walkthrough all
			// word a struck-through asset the same way. Derived here, never stored.
			assets:         (f.assets ?? STEADING_DEFAULTS.assets)
				.map(a => ({ ...a, takenTooltip: assetTakenTooltip(a) })),
		residents,
			neighbors,
			players,
			// Suggestion pools for the inline combo fields (occupation / traits /
			// home) on the Residents / Neighbors / Players tables — same source as
			// the Add Steading Member dialog.
			suggestions: { occupations: OCCUPATIONS, traits: TRAITS, homes: HOMES },
			places:         f.places         ?? STEADING_DEFAULTS.places,
			notes:          f.notes          ?? STEADING_DEFAULTS.notes,
			size:           f.size           ?? STEADING_DEFAULTS.size,
			silver:         f.silver         ?? STEADING_DEFAULTS.silver,
			gold:           f.gold           ?? STEADING_DEFAULTS.gold,
			improvements,
		};
	}
}
