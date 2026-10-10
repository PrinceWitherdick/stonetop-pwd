import {resolvedFlagProperty, STONETOP_SCOPE} from "../character/StonetopFlags.js";
import {slugify, stripHtmlToText} from "../../utils/strings.js";
import {OCCUPATIONS, TRAITS, HOMES} from "../../data/steading-members.js";
import {resolvePersonRow} from "./steading-people.js";
import {improvementRulesFrom, upkeepsDue} from "./improvement-rules.js";
import {resolvePortrait, documentPortraitFrame} from "../../utils/portrait-frame.js";
import {playbookTitle, characterFullName} from "../../utils/playbook-actors.js";
import {assetTakenTooltip} from "../../utils/requisition-asset.js";
import {
	GRANT_STAT_PATHS,
	grantKindsChanged,
	statGrantLines,
	statChangeLine,
	listChangeLine,
	improvementRequirementProgress,
	alternativeSectionFlags,
	flatRequirementItems,
	normalizeImprovementGrants,
	normalizeImprovementSections,
	remapRequirementTicks,
	sanitizeImprovementDef,
	sectionRequiredCount,
} from "../../utils/improvement-def.js";
import {readCurrentSeason, seasonStampKey, seasonStampParts} from "../../seasons/current-season.js";
import {seasonLabel} from "../../seasons/seasons-change-reminders.js";
import {markedDebilities} from "./steading-debilities.js";
import {innGatheringState, INN_SEASON_STEP} from "./inn-gathering.js";
import {steadingHolds} from "./steading-holds.js";
import {MILITIA_SEASON_STEP, militiaTactics} from "./season-effects.js";
import { inTurn } from "../../utils/turn-queue.js";
import { deletionEntry } from "../../utils/foundry-compat.js";
import { improvementCategoryKey } from "../../data/improvement-categories.js";
import { steadingSystemValue } from "./steading-system-value.js";

/** Which season's Inn roll ("whoever is friendliest rolls +Fortunes") has been handed to the table. */
export const INN_ROLL_SEASON_STEP = "innRoll";

/**
 * Which season's standing watch has been fed (or disbanded).
 *
 * NAMED, like its siblings (MILITIA_SEASON_STEP in season-effects.js, INN_SEASON_STEP in
 * inn-gathering.js, RITES_SEASON_STEP in rites-of-the-land.js; the Weapons of War upkeep's
 * "weaponsUpkeep" is improvement-rules.js#upkeepStepKey's), because the string is character-identical to the improvement SLUG
 * "standingWatch" a few hundred lines below — two namespaces that look the same at a glance,
 * so a rename of one reads as safe for the other. The slug sites stay literal on purpose:
 * they are not this key, they only spell the same.
 */
export const WATCH_SEASON_STEP = "standingWatch";

/** Which winter's 7-9 debt has been rolled ("roll what winter still wants"): once a winter. */
export const WINTER_DEBT_STEP = "winterDebtRolled";

/** Which season's Surplus roll has been made: summer's 1d4-1, or autumn's harvest. */
export const SURPLUS_SEASON_STEP = "surplus";

/** Which season's upkeep reminder has been posted to chat: once a season, however often the
 *  Seasons Change window for it is opened. */
export const REMINDER_SEASON_STEP = "reminderPosted";

export { IMPROVEMENT_CATEGORIES, IMPROVEMENT_CATEGORY_KEYS } from "../../data/improvement-categories.js";

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
				heading: "And then, <em>Pulling Together</em> 5 times, each requiring 1 season, 1 Surplus, and a wagonload of timber and other supplies (Value 2), to (re)build homes:",
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
				// `links`: the improvement a box NAMES, one entry per item (null for none, or a
				// list meaning any one of them). Losing that improvement unticks the box (see
				// linkedRequirementSlugs).
				links: ["herdOfHorses", null, null],
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
		effect: "Add \"Aurochs hunting (meat, hide, horn)\" to the Resources list. Henceforth, when you lead the aurochs hunt in spring, roll +Defenses: on a 10+, gain 1d4 Surplus; on a 7–9, gain 1d4 Surplus but pick 1 from the list below; on a 6–, pick 1 from the list below, or pick 2 and gain 1d4 Surplus. The list: 1d4 of the town's horses are lamed or killed; a number of locals are injured and the steading marks <em>diminished</em> (disadvantage to <em>Deploy</em>, <em>Muster</em>, or <em>Pull Together</em>); the GM picks an NPC present for the hunt, and they are killed; the Hillfolk are somehow offended; the herd is weak and if you hunt next year they'll be wiped out.",
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
				links: ["harnessingStream", "raincatching", "mill"],
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
				// EITHER route, not both (errata, first printing): the printed page asked for two
				// of three, and the corrected one asks for one of two. Without `min` a section
				// means ALL of its items, so the number in the heading and the number the tick
				// check enforces have to be set together.
				heading: "Requires 1 of the following:",
				min: 1,
				items: [
					"A reservoir for the Stream to pool in, and some way for the water to flow uphill",
					"A series of aqueducts, from the Stream's source back to Stonetop",
				],
			},
		],
		effect: "Add it to the Resources list and increase Fortunes by 1. Henceforth, when spring breaks forth and you roll a 7+ with Fortunes, the steading generates 1 Surplus.",
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
					"<em>Pulling Together</em> (1st: 1 season, 1 Surplus, and timber/supplies, Value 2)",
					"<em>Pulling Together</em> (2nd: 1 season, 1 Surplus, and timber/supplies, Value 2)",
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
					"<em>Pulling Together</em> (1st: a season, 1 Surplus, a wagonload of timber, Value 2, and a bunch of rope and supplies, Value 2)",
					"<em>Pulling Together</em> (2nd: a season, 1 Surplus, a wagonload of timber, Value 2, and a bunch of rope and supplies, Value 2)",
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
					"<em>Pulling Together</em> (1st: 1 season and 1 Surplus)",
					"<em>Pulling Together</em> (2nd: 1 season and 1 Surplus)",
					"<em>Pulling Together</em> (3rd: 1 season and 1 Surplus)",
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
					"<em>Pulling Together</em> (1st: 1 season, 1 Surplus, and supplies, Value 2)",
					"<em>Pulling Together</em> (2nd: 1 season, 1 Surplus, and supplies, Value 2)",
					"<em>Pulling Together</em> (3rd: 1 season, 1 Surplus, and supplies, Value 2)",
					"<em>Pulling Together</em> (4th: 1 season, 1 Surplus, and supplies, Value 2)",
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
				links: [null, null, null, null, "additionalHousing", ["raincatching", "harnessingStream"], null, null, null, null, null],
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
		effect: "Change Size to town and its Population to +0. Henceforth: When you <em>Muster</em>, <em>Pull Together</em>, or <em>Trade &amp; Barter</em>, you have advantage. When the <em>Seasons Change</em> to spring or summer, the town generates Surplus equal to Population+1. But, when winter grips the land, roll 2d6+Population to consume Surplus instead of 1d4+Population.",
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
				links: [null, "herdOfHorses", null, null, null],
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
 * The improvements that are a move of their own, and the homefront move each opens (the sheet's
 * HOMESTEAD_MOVE_FLOWS key). The move also joins the Homefront list once the improvement is built.
 */
export const IMPROVEMENT_MOVES = Object.freeze({
	aurochsHunting:   { move: "aurochsHunt", label: "Lead the hunt: roll +Defenses", icon: "fa-cow" },
	heroicReputation: { move: "heroicReputation", label: "Meet someone new: roll +Fortunes", icon: "fa-bullhorn" },
});

/** What the Herd of Horses writes onto the Assets list in place of the draft horses. */
export const HERD_ASSET_NAME = "A herd of horses (its size is kept on the Herd of Horses improvement)";

/**
 * The herd row's `beast` (see STEADING_DEFAULTS.assets): horses, how many asked at the take, and
 * taken out of the tracked herd rather than the row going out whole. The draft pair's own
 * `{count: 2, traits: ["hardy"]}` must not ride across onto it, or Requisitioning "a herd of
 * horses" handed out exactly two hardy horses and the herd never shrank.
 */
export const HERD_ASSET_BEAST = Object.freeze({ slug: "horse", herd: true });

/**
 * Whether an asset row is the herd's (by its `beast`, or by name for a row written before it had
 * one). A row whose `beast` is an explicit null is never the herd, whatever it is called: that is a
 * HOMEBREW improvement's swap (a custom `replaceAssets` writes a plain asset), and the herd's tracker
 * and its horses belong to the book's Herd of Horses alone.
 */
export function isHerdAsset(row) {
	return row?.beast?.herd === true || (row?.name === HERD_ASSET_NAME && row?.beast !== null);
}

/**
 * The improvements a requirement box names, flat and aligned with the stored `r` array: one
 * entry per box, each an array of slugs (any one of which satisfies it) or null. Read off the
 * built-in definition's `links`, never matched out of the box's text.
 *
 * A custom improvement carries no `links` (the builder does not author them), so a box of one
 * borrows the link of a built-in box with the SAME text: a copy made through "Start from" keeps
 * the book's "Mill" box word for word, and losing the Mill unticks it as it does the book's.
 * @param {{slug?: string, sections?: Array}} def
 * @returns {Array<string[]|null>}
 */
export function linkedRequirementSlugs(def) {
	const custom = !BUILTIN_IMPROVEMENT_SLUGS.has(def?.slug);
	return (def?.sections ?? []).flatMap(section => (section?.items ?? []).map((item, i) => {
		const link = section?.links?.[i] ?? (custom ? builtInLinkByText().get(requirementText(item)) : null) ?? null;
		if (!link) return null;
		return Array.isArray(link) ? [...link] : [link];
	}));
}

/** A requirement box's text as compared between definitions: plain, trimmed, lower-cased. */
function requirementText(item) {
	return stripHtmlToText(String(item ?? "")).trim().toLowerCase();
}

const BUILTIN_IMPROVEMENT_SLUGS = new Set(IMPROVEMENT_DEFINITIONS.map(d => d.slug));
let _builtInLinkByText = null;
/** Each linked built-in box's text to its link, built once (the definitions are frozen data). */
function builtInLinkByText() {
	if (_builtInLinkByText) return _builtInLinkByText;
	_builtInLinkByText = new Map();
	for (const def of IMPROVEMENT_DEFINITIONS) {
		for (const section of def.sections ?? []) {
			(section?.items ?? []).forEach((item, i) => {
				const link = section?.links?.[i];
				if (link) _builtInLinkByText.set(requirementText(item), link);
			});
		}
	}
	return _builtInLinkByText;
}

/**
 * What each of the book's improvements DOES, keyed by slug: the built-in twin of a custom
 * improvement's `def.grants`, in exactly the same shape (utils/improvement-def.js normalizes the
 * custom one, and lists the keys). Two kinds, as that file explains:
 *
 * ONE-TIME, applied when the improvement is completed and recorded on `applied` so un-completing
 * reverses exactly that:
 *   stats                — integer deltas to fortunes / defenses / prosperity / population
 *   resources            — names appended to the Resources list (as active/checked)
 *   fortifications       — names appended to the Fortifications list (as active/checked)
 *   removeFortifications — names cleared from the Fortifications list, if present
 *   setSize              — set the steading's Size
 *   setPopulation        — set Population to an exact value
 *   replaceAssets        — `{match, name}`: replace the Assets entry whose name contains `match`
 *                          with a fresh row named `name`, or add one when none does. Nothing of the
 *                          row it replaced rides across. `beast` is the BUILT-IN herd's alone (the
 *                          normalizer drops it from a custom grant, whose row is a plain asset).
 *   markImprovements     — other improvements to mark complete too (Book II's Golden Sapling)
 *   completionNote       — what the table is told to do the moment it is built ("draw it on the map")
 *
 * LIVE ("Henceforth"), read by improvement-rules.js's readers every time, never written on completion:
 *   seasonalYield  harvestBonus  winterConsumption  winterPopulation  surplusBonus
 *   upkeep         rollAdvantage lapse              condition
 *
 * Still keyed by slug, because no grant can say them: Herd of Horses' tracker, foals, feed,
 * half-cost Pull Together and Requisition count; the Inn's name, gathering and seasonal roll; the
 * militia's tactics (its +1 Defenses at 2+, its summer drills, its position of strength); the
 * watch's "+1 Defenses when involved"; Weapons of War's common weapons and x piercing; the Mill's
 * extra use per supply; Additional Housing's fields; the two improvement-moves (IMPROVEMENT_MOVES).
 */
export const IMPROVEMENT_GRANTS = {
	additionalHousing: { stats: { fortunes: 1 }, winterPopulation: -1, completionNote: "Add the new homes to the map." },
	aurochsHunting:    { resources: ["Aurochs hunting (meat, hide, horn)"] },
	expandedTrades:    { stats: { prosperity: 1 }, lapse: { stats: { prosperity: -1 } } },
	greaterHarvest:    { stats: { fortunes: 1 }, harvestBonus: "1d4" },
	harnessingStream:  { stats: { fortunes: 1 }, resources: ["Harnessing the Stream"], seasonalYield: { seasons: ["spring"], surplus: 1, needsHit: true } },
	herdOfHorses:      { stats: { fortunes: 1 }, replaceAssets: [{ match: "draft horses", name: HERD_ASSET_NAME, beast: HERD_ASSET_BEAST }],
		completionNote: "The herd starts at 12 grown horses. If yours is a different size, change the counts on its card." },
	inn:               { stats: { fortunes: 1 }, resources: ["Inn"], completionNote: "Draw the inn on the map." },
	market:            { stats: { prosperity: 1 }, lapse: { stats: { prosperity: -1 } },
		seasonalYield: { seasons: ["spring", "summer", "autumn"], surplus: 1, minPopulation: 1, whileMet: true } },
	mill:              { stats: { fortunes: 1 }, resources: ["Mill"], harvestBonus: 1, completionNote: "Draw the mill on the map." },
	palisade:          { stats: { fortunes: 1 }, fortifications: ["Palisade"],
		rollAdvantage: { moves: ["Deploy"], ask: "Taking advantage of the palisade" }, completionNote: "Draw the palisade on the map." },
	raincatching:      { stats: { fortunes: 1 }, resources: ["Raincatching"], seasonalYield: { seasons: ["summer"], surplus: 1, needsHit: true } },
	standingWatch:     { fortifications: ["Standing Watch"], upkeep: { seasons: ["spring", "summer", "autumn", "winter"], surplus: 1 } },
	stoneWall:         { fortifications: ["Stone Wall"], removeFortifications: ["Palisade"], winterConsumption: -1,
		rollAdvantage: { moves: ["Deploy"], ask: "Taking advantage of the stone wall" },
		completionNote: "Draw the stone wall on the map, and erase the palisade if there was one." },
	township:          { setSize: "town", setPopulation: 0, rollAdvantage: { moves: ["Muster", "Pull Together", "Trade & Barter"] },
		seasonalYield: { seasons: ["spring", "summer"], surplus: 1, plusPopulation: true } },
	weaponsOfWar:      { stats: { defenses: 1 }, fortifications: ["Weapons of War"], upkeep: { seasons: ["spring"], surplus: 1 } },
};

/**
 * An improvement's grants: the book's table for a built-in, the definition's own for a custom one.
 * The table wins, so a custom improvement can never take over a built-in slug's effects.
 */
export function improvementGrantsFor(slug, def = null) {
	return IMPROVEMENT_GRANTS[slug] ?? def?.grants ?? null;
}

/**
 * The rules list (improvement-rules.js) for a set of built-in slugs taken as completed, with
 * nothing on the lists: what a test, or a caller with no steading to hand, needs to ask the readers.
 * @param {string[]} slugs
 * @param {{requirementsMet?: (slug: string) => boolean}} [opts]
 */
export function builtInImprovementRules(slugs = [], { requirementsMet = () => true } = {}) {
	return improvementRulesFrom({
		defs: IMPROVEMENT_DEFINITIONS,
		grantsFor: def => improvementGrantsFor(def.slug, def),
		improvements: Object.fromEntries(slugs.map(slug => [slug, { completed: true }])),
		requirementsMet: def => requirementsMet(def.slug),
	});
}

/**
 * An improvement's STANDING effect: a stat change that holds only while something about the built
 * improvement stays true, as opposed to its one-time grant. Null when there is none right now.
 *
 *   `lapse`        "If you cease to meet the requirements, decrease Prosperity by 1" (Market,
 *                  Expanded Trades): its stats while the requirements are NOT met, taken back again
 *                  once they are.
 *   `condition`    Book II's Aetherium Crucible, "As long as you trade aetherium to the outside
 *                  world, increase Prosperity by 1": its stats while the table has ticked the
 *                  condition on the improvement's card (`entry.condition`).
 *   wellTrainedMilitia (bespoke) "When the militia has trained in 2+ tactics, increase Defenses by 1."
 *
 * @param {string} slug
 * @param {object} def    the improvement's definition (a custom one carries its grants)
 * @param {{completed?: boolean, r?: boolean[], condition?: boolean}} entry  its tracking entry
 * @returns {{[stat: string]: number}|null}
 */
export function standingGrantFor(slug, def, entry) {
	if (!hasStandingGrant(slug, def) || !entry?.completed || !def) return null;
	if (slug === "wellTrainedMilitia") return militiaTactics(def, entry.r ?? []).length >= 2 ? { defenses: 1 } : null;
	const grants = improvementGrantsFor(slug, def) ?? {};
	const total = {};
	const add = stats => { for (const [k, d] of Object.entries(stats ?? {})) total[k] = (total[k] ?? 0) + d; };
	if (grants.lapse && !improvementRequirementsMet(def, entry.r ?? [])) add(grants.lapse.stats);
	if (grants.condition && entry.condition === true) add(grants.condition.stats);
	for (const k of Object.keys(total)) if (!total[k]) delete total[k];
	return Object.keys(total).length ? total : null;
}

/** Whether an improvement has a standing effect at all, so every other one's entry stays as it was. */
export function hasStandingGrant(slug, def = null) {
	if (slug === "wellTrainedMilitia") return true;
	const grants = improvementGrantsFor(slug, def);
	return !!(grants?.lapse || grants?.condition);
}

/** Why a standing effect just moved a stat, for the notification. */
function standingReason(slug, delta, def = null, why = "") {
	if (slug === "wellTrainedMilitia") return delta > 0 ? "the militia trains in 2+ tactics" : "the militia no longer trains in 2+ tactics";
	const condition = improvementGrantsFor(slug, def)?.condition;
	if (why === "condition" && condition) return `${condition.text}: ${delta > 0 ? "yes" : "no longer"}`;
	return delta < 0 ? "its requirements are no longer met" : "its requirements are met again";
}

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
/** The top of the steading's Fortunes and Defenses: they "can range from -1 to +3" (Book I p.508, p.512). */
export const STEADING_STAT_MAX = 3;

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
	// `beast` says what Requisition offers as followers (see beastFollowerForAsset in
	// data/beasts.js): the catalog slug, how many, and the either/or tags already picked.
	// `null` = not an animal, so "horse-drawn" and "horse harness" never read as horses.
	// A row stored before this field existed gets it back by name: see getNamedAssets.
	assets: [
		{ name: "A pair of hardy draft horses — HP 10 each; d6+3 dmg (hand, close, forceful); Instinct: to panic; Cost: care & grooming", checked: true,
			beast: { slug: "horse", count: 2, traits: ["hardy"] } },
		{ name: "A pair of horse-drawn plows, iron", checked: true, beast: null },
		{ name: "A pair of carts (plus horse harness)", checked: true, beast: null },
		{ name: "A wagon (plus horse harness)", checked: true, beast: null },
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

		// A flag-only change writes ONLY the keys it was given, each as its own dotted path.
		//
		// It used to write the whole steading object, rebuilt from the CACHED flags, which are only
		// refreshed when the server echoes a write. So any flag write issued inside the round trip
		// of another (a Resources tick while a Palisade completion was in flight) put back the
		// steading as it was before that other write: the completion, its Fortification and its
		// mirrored stat were reverted, while its `applied` record survived to be reversed again
		// later. A whole-object write never dropped a subkey either: a flag object is MERGED on
		// write (setFlag included), so nothing here relied on replacement that it actually got.
		//
		// Except once: a steading whose flags still live only in a legacy scope (not yet cut over)
		// gets the whole object, so the active scope is seeded complete rather than with one key
		// that would then hide every other.
		if (!systemEntries.length) {
			const seeded = this._actor.flags?.[STONETOP_SCOPE]?.steading !== undefined;
			if (!seeded) {
				const merged = { ...foundry.utils.deepClone(this._flags), ...flags };
				// setFlag takes no options, so a caller's `stonetopMove` goes through update.
				if (Object.keys(options ?? {}).length) {
					await this._actor.update({ [`flags.${STONETOP_SCOPE}.steading`]: merged }, options);
				} else {
					await this._actor.setFlag(STONETOP_SCOPE, "steading", merged);
				}
				return;
			}
			const data = {};
			for (const [key, value] of flagEntries) data[`flags.${STONETOP_SCOPE}.steading.${key}`] = value;
			await this._actor.update(data, options);
			return;
		}

		// A change that moves a stat AND sets a flag — the reason this method exists — goes out
		// as ONE update, so the ledger appends once and cards the stats together. Both halves
		// are written as targeted dotted keys: the whole flag object cannot be replaced here
		// without colliding with the `…steading.system.*` mirrors in the same payload. That
		// makes the flag half a MERGE, so this path sets values and cannot drop a key. Nothing
		// here can: setFlags (below) comes through this same method and merges too. Dropping a
		// key takes an explicit deletion entry in the payload (`-=key`, see deletionEntry in
		// utils/foundry-compat.js), the way removing a custom improvement drops its record.
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

	/**
	 * Read-modify-write one of the steading's lists (Resources, Fortifications, Assets, ...) in the
	 * steading's turn, the same line every improvement write queues on. The list is read INSIDE the
	 * turn: read before it, a tick pressed while a completion was in flight copied the list from
	 * the cache the completion had not refreshed yet, and its write took back the Fortification the
	 * completion had just added.
	 * @param {string} list  the flag key
	 * @param {(arr: object[]) => (void|false)} edit  changes the copy in place; `false` writes nothing
	 * @returns {Promise<boolean>} whether anything was written
	 */
	async editList(list, edit) {
		return inTurn(`steading:${this._actor.id}`, async () => {
			const arr = foundry.utils.deepClone(this._flags[list] ?? STEADING_DEFAULTS[list] ?? []);
			if (edit(arr) === false) return false;
			await this.setFlags({ [list]: arr });
			return true;
		});
	}

	// The mirrored flag copy first, then system (steading-system-value.js). A stored null
	// is this reader's answer, not a gap.
	getSystemValue(path, defaultValue = 0) {
		return steadingSystemValue(this._actor, path, { defaultValue });
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

	/**
	 * A fresh slug for a custom improvement: `custom-<slugified name>`, namespaced so it never
	 * collides with the camelCase built-ins, and made UNIQUE here rather than assumed to be.
	 *
	 * A slug is an id, not a name (the ticks, the `applied` record and the season rules are keyed
	 * by it, and it is kept across a rename), so two improvements must never share one. They
	 * used to whenever their names slugified alike: every all-emoji or non-Latin name slugified to
	 * nothing and minted a bare `custom-`, and a renamed improvement kept its old slug, so its old
	 * name minted a clash. A name that slugifies to nothing gets a random id; a slug in use (by a
	 * custom improvement, or by a tracking entry a removal left behind) gets -2, -3 ...
	 */
	_customImprovementSlug(name) {
		const base = slugify(name) || String(foundry.utils.randomID(8)).toLowerCase();
		const taken = new Set([
			...this.customImprovements.map(d => d.slug),
			...Object.keys(this._flags.improvements ?? {}),
		]);
		let slug = `custom-${base}`;
		for (let n = 2; taken.has(slug); n++) slug = `custom-${base}-${n}`;
		return slug;
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
		// In the steading's turn, like every write that rewrites `improvements`-side state: the
		// list it appends to is read inside, after any write ahead of it has landed.
		return inTurn(`steading:${this._actor.id}`, () => this._addCustomImprovement(def));
	}

	async _addCustomImprovement(def) {
		const name = String(def?.name ?? "").trim();
		if (!name) return { ok: false, reason: "empty" };

		const existing = this._flags.customImprovements ?? [];
		if (this.improvementNameTaken(name)) {
			return { ok: false, reason: "duplicate", label: name };
		}
		const slug = this._customImprovementSlug(name);

		// Heading, requirements and effect are painted unescaped, so a dropped card's are
		// sanitized here (sanitizeImprovementDef): a page edited by hand could carry anything.
		const normalized = sanitizeImprovementDef({
			slug,
			label: name,
			category: improvementCategoryKey(def.category),
			flavor: String(def.flavor ?? ""),
			sections: normalizeImprovementSections(def.sections),
			effect: String(def.effect ?? ""),
			// null rather than absent: a custom improvement with no automatic effects still
			// says so, and setImprovementCompleted reads `?? null` either way.
			grants: normalizeImprovementGrants(def.grants),
		});
		await this.setFlags({ customImprovements: [...existing, normalized] });
		return { ok: true, slug, label: name };
	}

	/**
	 * The improvements added to this steading by hand or by a dropped card, in the same
	 * definition shape as the book's own. Read by the builder dialog, which offers them
	 * alongside IMPROVEMENT_DEFINITIONS as something to start a new one from.
	 */
	get customImprovements() {
		return this._flags.customImprovements ?? [];
	}

	/**
	 * Whether this steading already has an improvement by that name: one of the book's, or
	 * one already added. The ONE rule for it, because two callers ask the same question and
	 * must not disagree — addCustomImprovement, which refuses the write, and the builder's
	 * "Start from", which offers a free name up front rather than letting the author fill in
	 * a whole copy of Palisade and only then be told the steading has a Palisade.
	 *
	 * NAMES, compared as trimmed lower-cased labels, never slugs: what is being prevented is two
	 * cards on one sheet reading alike, and a slug is not a name. Compared by slug, every
	 * all-emoji or non-Latin name clashed with every other (all slugify to nothing), and a
	 * renamed improvement kept its old slug, so its NEW name could be added a second time while
	 * its old one was refused.
	 *
	 * @param {string} name
	 * @param {{except?: string}} [opts] a custom slug whose own label does not count, for an
	 *   EDIT: an improvement keeping its own name is not clashing with itself.
	 */
	improvementNameTaken(name, { except = null } = {}) {
		const target = String(name ?? "").trim().toLowerCase();
		if (!target) return false;
		return BUILTIN_IMPROVEMENT_LABELS.has(target)
			|| this.customImprovements.some(d => d.slug !== except && String(d.label ?? "").trim().toLowerCase() === target);
	}

	/** Resolve an improvement definition by slug — built-in first, then custom. */
	improvementDef(slug) {
		return IMPROVEMENT_DEFINITIONS.find(d => d.slug === slug)
			?? this.customImprovements.find(d => d.slug === slug)
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

	/**
	 * Rewrite an improvement already on this steading, in place.
	 *
	 * The alternative was copy, correct, remove the original, which lost every ticked step and
	 * left a window where the steading held two of the thing.
	 *
	 * Two things are deliberately kept rather than rebuilt:
	 *
	 *   the SLUG, even across a rename. It is an id, not a name: the ticked steps, the record
	 *     of what completing it applied, and the season-effects rules that turn on which box
	 *     was ticked are all keyed by it, and none of them survive being re-keyed.
	 *   the APPLIED record, even when the grants are edited. It says what completing this
	 *     improvement DID, not what the definition now says it would do, and un-completing has
	 *     to reverse the former. Editing grants on a completed improvement therefore does not
	 *     retroactively move stats; the caller is told so it can say as much.
	 *
	 * The ticked steps are carried across by TEXT (remapRequirementTicks), because `r` is a
	 * flat positional array and an inserted step would otherwise slide every tick onto the
	 * wrong requirement.
	 *
	 * @returns {{ok: false, reason: string, label?: string}
	 *   | {ok: true, slug: string, label: string, structureChanged: boolean,
	 *      grantsChanged: boolean, completed: boolean}}
	 */
	async updateCustomImprovement(slug, def) {
		return inTurn(`steading:${this._actor.id}`, () => this._updateCustomImprovement(slug, def));
	}

	async _updateCustomImprovement(slug, def) {
		const existing = this.customImprovements;
		const current = existing.find(d => d.slug === slug);
		if (!current) return { ok: false, reason: "missing" };

		const name = String(def?.name ?? "").trim();
		if (!name) return { ok: false, reason: "empty" };
		if (this.improvementNameTaken(name, { except: slug })) {
			return { ok: false, reason: "duplicate", label: name };
		}

		const sections = normalizeImprovementSections(def.sections);
		const grants = normalizeImprovementGrants(def.grants);
		const updated = sanitizeImprovementDef({
			...current,
			label: name,
			category: improvementCategoryKey(def.category),
			flavor: String(def.flavor ?? ""),
			sections,
			effect: String(def.effect ?? ""),
			grants,
		});
		const oldItems = flatRequirementItems(current);
		const newItems = flatRequirementItems(updated);
		const structureChanged = oldItems.length !== newItems.length
			|| oldItems.some((item, i) => item !== newItems[i]);

		const flagUpdates = { customImprovements: existing.map(d => (d.slug === slug ? updated : d)) };

		const entry = this._flags.improvements?.[slug];
		const kinds = grantKindsChanged(current.grants ?? null, grants);
		const system = {};
		let standingLines = [];
		if (entry && (structureChanged || (entry.completed && kinds.live))) {
			const improvements = foundry.utils.deepClone(this._flags.improvements ?? {});
			const next = { ...improvements[slug] };
			if (structureChanged) next.r = remapRequirementTicks(oldItems, newItems, entry.r ?? []);
			// A LIVE grant edited on a built improvement applies as soon as it is saved, the standing
			// ones included: a `lapse` or `condition` added (or changed) moves its stat now, not at the
			// next tick. What the edit itself did not apply before is not presumed applied.
			if (next.completed) {
				next.standing ??= null;
				const data = {};
				standingLines = this._reconcileStandingGrant(slug, updated, next, data);
				for (const [key, value] of Object.entries(data)) {
					if (key.startsWith("system.")) system[key.slice("system.".length)] = value;
				}
			}
			improvements[slug] = next;
			flagUpdates.improvements = improvements;
		}
		await this.applyChanges({ system, flags: flagUpdates });

		return {
			ok: true,
			slug,
			label: name,
			structureChanged,
			grantsChanged: kinds.oneTime || kinds.live || kinds.note,
			// Which kind moved: a one-time edit is not retroactive on a built improvement, a live one
			// already applies (see editSavedNotice in ImprovementBuilderDialog.js).
			oneTimeChanged: kinds.oneTime,
			liveChanged: kinds.live,
			standingChanged: standingLines,
			completed: !!entry?.completed,
		};
	}

	/**
	 * Remove a custom improvement, giving back anything completing it applied.
	 *
	 * That second half used to be missing, and it was a one-way leak: a completed improvement's
	 * grants are recorded on `improvements[slug].applied` so un-completing can reverse them
	 * exactly, and this method deleted that record without reversing it. Removing a completed
	 * homebrew improvement therefore left its +1 Fortunes on the steading, and its name on the
	 * Fortifications list, with nothing on the sheet left to explain either and no way to take
	 * them back. Reachable from one unconfirmed click on the card's trash button.
	 *
	 * The reversal goes through _setImprovementCompleted rather than being done here, for two
	 * reasons: it owns that arithmetic, and its dotted-key write is a flag MERGE, which cannot
	 * drop `improvements[slug]`. Dropping a key needs an explicit deletion, so these stay two
	 * writes, both inside ONE turn of the steading's queue so nothing lands between them. The
	 * INNER method, not the queued one: queued from inside this turn it would wait on itself.
	 *
	 * @returns {false|{label: string, reverted: string[]}} false when there was no such
	 *   improvement; otherwise its label and a description of what was given back.
	 */
	async removeCustomImprovement(slug) {
		return inTurn(`steading:${this._actor.id}`, () => this._removeCustomImprovement(slug));
	}

	async _removeCustomImprovement(slug) {
		const existing = this.customImprovements;
		const def = existing.find(d => d.slug === slug);
		if (!def) return false;

		const reverted = this.improvementCompleted(slug)
			? (await this._setImprovementCompleted(slug, false))?.summary ?? []
			: [];

		// Re-read: the await above rewrote the flags this is filtering.
		const next = this.customImprovements.filter(d => d.slug !== slug);
		// The list, and an explicit deletion of the slug's tracking entry: nothing else. A flag
		// object is written by MERGING, so leaving the slug out of a rewritten map left it stored,
		// ticks and all, and a card re-added under the same slug came back with them. And the
		// rest of the steading is not written at all: rebuilt from the cached flags, it put back
		// whatever another write had changed inside this one's round trip.
		const [deleteKey, deleteValue] = deletionEntry(`flags.${STONETOP_SCOPE}.steading.improvements.${slug}`);
		await this._actor.update({
			[`flags.${STONETOP_SCOPE}.steading.customImprovements`]: next,
			[deleteKey]: deleteValue,
		});
		return { label: def.label ?? slug, reverted };
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
	 * @param {{forceR?: Array<boolean>, seasonStep?: {step: string, year: number, seasonId: string}}} [opts]
	 *   `forceR` overwrites the requirement-tracking array (used when the user force-completes an
	 *   improvement whose steps aren't all met). `seasonStep` closes a once-per-season step in the
	 *   SAME write (the watch disbanding, the weapons lost for want of upkeep), so a failure can
	 *   never leave the improvement gone and the season's question still open.
	 * @returns {{label: string, summary: string[], reverted: boolean}}  A description of
	 *   the auto-applied (or reversed) changes, for a user-facing notification.
	 */
	async setImprovementCompleted(slug, checked, { forceR, seasonStep } = {}) {
		// The same line as setImprovementRequirement, and the same document: completing an improvement
		// and ticking one of its boxes both rewrite the whole `improvements` flag.
		return inTurn(`steading:${this._actor.id}`, () => this._setImprovementCompleted(slug, checked, { forceR, seasonStep }));
	}

	/**
	 * LOSE an improvement for want of its upkeep (Book I p. 514: "If the PCs fail to pay that cost,
	 * they lose the improvement"): un-complete it, with the season's step closed in the same write,
	 * and take off the lists any entry of its own name still standing there. That last part is for an
	 * improvement in force only BY its entry (improvement-rules.js): a "Standing Watch" written on the
	 * Fortifications list by hand owes the watch's upkeep, so not paying it has to take the entry.
	 * @returns {Promise<{label: string, summary: string[], reverted: boolean}>}
	 */
	async loseImprovement(slug, { seasonStep } = {}) {
		return inTurn(`steading:${this._actor.id}`, () => this._setImprovementCompleted(slug, false, { seasonStep, clearEntries: true }));
	}

	async _setImprovementCompleted(slug, checked, { forceR, seasonStep, clearEntries = false } = {}) {
		const def = this.improvementDef(slug);
		// A built-in improvement's grants are keyed by slug; a custom one carries its own
		// on the definition (authored in the builder dialog, or riding in on a dropped
		// card). The table wins, so a custom improvement can never take over a built-in
		// slug's effects by name collision.
		const builtInGrants = IMPROVEMENT_GRANTS[slug] ?? null;
		const grants = improvementGrantsFor(slug, def);
		const improvements = foundry.utils.deepClone(this._flags.improvements ?? {});
		const entry = improvements[slug] ?? { completed: false, r: [] };
		const wasCompleted = !!entry.completed;
		if (Array.isArray(forceR)) entry.r = forceR;

		// Back-fill for improvements completed under a version BEFORE this grants engine:
		// such an entry is `completed:true` with no `applied` record, and its book effect
		// was applied by hand. Record the grant's full presumed footprint (NOT via
		// _collectGrantEffects, which records only what it would change now and so silently
		// drops resources/fortifications/size already present — orphaning them on revert) so
		// the first toggle reverses/re-applies symmetrically. Normalize an empty reconstruction
		// to null (matching the fresh-apply convention) so nothing is falsely reported reverted.
		// A fresh completion — `entry.completed` still false here — skips this untouched.
		//
		// BUILT-INS ONLY. A custom improvement with no `applied` is one whose definition had no
		// grants when it was completed (completion now always writes the key, null for nothing).
		// If an edit has given it grants since, presuming them applied made un-completing it, or
		// removing it, take back effects it never gave. Nothing was applied, so nothing is.
		if (entry.completed && entry.applied === undefined) {
			const presumed = builtInGrants ? this._presumeAppliedGrants(builtInGrants) : {};
			entry.applied = Object.keys(presumed).length ? presumed : null;
		}
		// The same back-fill for a standing effect (setImprovementRequirement), read while the
		// entry still says what it said before this toggle.
		this._backfillStanding(slug, def, entry);

		const data = {};
		let summary = [];
		let reverted = false;
		// Other improvements this one marks complete too, done AFTER this write (each is its own
		// completion, with its own grants); and the ones it marked, un-marked when it goes.
		let toMark = [];
		let toUnmark = [];

		if (checked) {
			entry.completed = true;
			// Apply grants once, on the transition into completion. `applied` gates against
			// re-applying if a completed improvement is toggled complete again somehow. Written
			// on EVERY completion, `null` when nothing applied, so no completed entry is left
			// looking like one from before the grant engine (see the back-fill above).
			if (!wasCompleted && !entry.applied) {
				const applied = grants ? this._collectGrantEffects(grants, data) : {};
				// "Automatically mark the Greater Harvest improvement" (Book II's Golden Sapling): the
				// ones not already built, recorded so un-completing this one takes back what it marked.
				toMark = this._improvementsToMark(slug, grants);
				if (toMark.length) applied.markedImprovements = [...toMark];
				entry.applied = Object.keys(applied).length ? applied : null;
				summary = this._summarizeGrantChanges(entry.applied, { data });
			}
		} else {
			toUnmark = (entry.applied?.markedImprovements ?? []).filter(other => this.improvementCompleted(other));
			entry.completed = false;
			if (entry.applied) {
				const { done, kept } = this._revertGrantEffects(entry.applied, data);
				summary = [...this._summarizeGrantChanges(done, { data, reverting: true }), ...kept];
				reverted = true;
				// Null (not delete): a merged flag write can't drop a sub-key, so overwrite it.
				entry.applied = null;
			}
			// A box elsewhere that NAMED this improvement ("Mill", "A Herd of Horses") is no longer
			// met, and an improvement standing on it may lose a standing effect (Expanded Trades'
			// "If you cease to meet the requirements, decrease Prosperity by 1").
			improvements[slug] = entry;
			summary = [...summary, ...this._untickLinkedRequirements(slug, improvements, data)];
			// Lost for want of upkeep: an entry of its own name still on a list goes too (loseImprovement).
			if (clearEntries) summary = [...summary, ...this._clearOwnEntries(grants, data)];
		}

		// Herd of Horses tracks a herd of horses ("make a note of its size"). Seed a
		// starting herd once, when first earned; never auto-remove it on un-complete, so
		// the counts the table has kept up across seasons aren't wiped by a mistaken
		// toggle. It lives in its own flag (not the reversible grant record) for that reason.
		if (slug === "herdOfHorses" && checked && !this._flags.herd) {
			data[`flags.${STONETOP_SCOPE}.steading.herd`] = { ...HERD_START };
		}

		// Its standing effects (the militia's +1 Defenses, a lapsed Market's Prosperity) follow
		// completion in the same write, as its one-time grants do.
		summary = [...summary, ...this._reconcileStandingGrant(slug, def, entry, data)];

		improvements[slug] = entry;
		data[`flags.${STONETOP_SCOPE}.steading.improvements`] = improvements;
		this._foldSeasonStep(data, seasonStep);
		await this._actor.update(data);

		// Each improvement it marks (or marked) is its OWN completion, run after this write so it
		// reads the flags this one just wrote: its own grants, its own record, its own revert.
		for (const other of toMark) {
			const done = await this._setImprovementCompleted(other, true);
			summary = [...summary, ...done.summary.map(line => `${done.label}: ${line}`)];
		}
		for (const other of toUnmark) {
			const done = await this._setImprovementCompleted(other, false);
			summary = [...summary, `${done.label} un-marked`, ...done.summary.map(line => `${done.label}: ${line}`)];
		}

		return { label: def?.label ?? slug, summary, reverted };
	}

	/**
	 * The standing record's back-fill for an entry that has none (`standing === undefined`), read
	 * before a change. A BUILT-IN completed before standing effects were tracked had its standing
	 * applied by hand, so whatever its boxes said until now is presumed applied (the way
	 * _presumeAppliedGrants presumes its one-time grant). A CUSTOM one presumes nothing: one without a
	 * record never had a standing grant applied (any it has now came from an edit, which reconciles).
	 */
	_backfillStanding(slug, def, entry) {
		if (!hasStandingGrant(slug, def) || !entry.completed || entry.standing !== undefined) return;
		entry.standing = IMPROVEMENT_GRANTS[slug] || slug === "wellTrainedMilitia" ? standingGrantFor(slug, def, entry) : null;
	}

	/**
	 * Take off the Fortifications and Resources lists every entry an improvement's grants add that is
	 * still there, into `data` (on top of any list the same write already rewrote). Returns the lines.
	 */
	_clearOwnEntries(grants, data) {
		const lines = [];
		for (const listKey of ["fortifications", "resources"]) {
			const names = grants?.[listKey] ?? [];
			if (!names.length) continue;
			const path = `flags.${STONETOP_SCOPE}.steading.${listKey}`;
			const list = foundry.utils.deepClone(data[path] ?? this._flags[listKey] ?? STEADING_DEFAULTS[listKey]);
			const cleared = names.filter(name => this._clearNamedInList(list, name));
			if (!cleared.length) continue;
			data[path] = list;
			lines.push(...cleared.map(name => listChangeLine(name, listKey, false)));
		}
		return lines;
	}

	/** What the book asks the table to do the moment this improvement is built ("draw it on the map"). */
	improvementCompletionNote(slug) {
		return this.improvementGrants(slug)?.completionNote ?? "";
	}

	/** This improvement's grants (IMPROVEMENT_GRANTS for a built-in, the definition's own otherwise). */
	improvementGrants(slug) {
		return improvementGrantsFor(slug, this.improvementDef(slug));
	}

	/**
	 * The improvements completing `slug` marks too ("automatically mark the Greater Harvest
	 * improvement"): the ones that exist here and are not already built. The completion and its
	 * preview both ask this, so the confirm never promises what the write won't do.
	 */
	_improvementsToMark(slug, grants) {
		return (grants?.markImprovements ?? []).filter(other =>
			other !== slug && this.improvementDef(other) && !this.improvementCompleted(other));
	}

	/**
	 * The improvements whose "Henceforth" rules are in force on this steading, with their grants:
	 * THE list every reader asks (see improvement-rules.js for what "in force" means).
	 */
	improvementRules() {
		const f = this._flags;
		const stored = f.improvements ?? {};
		return improvementRulesFrom({
			defs: [...IMPROVEMENT_DEFINITIONS, ...this.customImprovements],
			grantsFor: def => improvementGrantsFor(def.slug, def),
			improvements: stored,
			lists: {
				resources: f.resources ?? STEADING_DEFAULTS.resources,
				fortifications: f.fortifications ?? STEADING_DEFAULTS.fortifications,
			},
			requirementsMet: def => improvementRequirementsMet(def, stored[def.slug]?.r ?? []),
		});
	}

	/**
	 * Tick or untick an improvement's CONDITION (a `condition` grant: Book II's Aetherium Crucible,
	 * "As long as you trade aetherium to the outside world, increase Prosperity by 1"), moving its
	 * stat in the same write.
	 * @returns {Promise<{label: string, summary: string[]}>}
	 */
	async setImprovementCondition(slug, on) {
		return inTurn(`steading:${this._actor.id}`, async () => {
			const def = this.improvementDef(slug);
			const improvements = foundry.utils.deepClone(this._flags.improvements ?? {});
			const entry = improvements[slug] ?? { completed: false, r: [] };
			this._backfillStanding(slug, def, entry);
			entry.condition = !!on;
			const data = {};
			const summary = this._reconcileStandingGrant(slug, def, entry, data, "condition");
			improvements[slug] = entry;
			data[`flags.${STONETOP_SCOPE}.steading.improvements`] = improvements;
			await this._actor.update(data);
			return { label: def?.label ?? slug, summary };
		});
	}

	/** Close a once-per-season step inside `data`, the write already being built (see seasonStepFlags). */
	_foldSeasonStep(data, seasonStep) {
		if (!seasonStep?.step || !seasonStep.seasonId) return;
		const { seasonSteps } = this.seasonStepFlags(seasonStep.step, seasonStep.year, seasonStep.seasonId);
		data[`flags.${STONETOP_SCOPE}.steading.seasonSteps`] = seasonSteps;
	}

	/**
	 * Untick, on every OTHER improvement, the requirement boxes that name `lost` (its definition's
	 * `links`, see linkedRequirementSlugs), unless another improvement the box names still stands
	 * (Township's "Raincatching OR Harnessing the Stream"). Edits `improvements` in place, writes any
	 * standing effect that changes with it into `data`, and returns the notification lines.
	 *
	 * Book I p. 514: an improvement that is lost takes "its benefits" with it, and Expanded Trades
	 * says outright "If you cease to meet the requirements, decrease Prosperity by 1." A box left
	 * ticked for a Mill that has burned down kept that Prosperity standing. Nothing is ticked the
	 * other way when an improvement is BUILT: the book never says building one meets another's
	 * requirement for you, and some of those boxes are a choice (the militia's Cavalry is a tactic
	 * to drill, not a horse to own).
	 */
	_untickLinkedRequirements(lost, improvements, data) {
		const lines = [];
		const stands = slug => slug !== lost && !!improvements[slug]?.completed;
		for (const def of [...IMPROVEMENT_DEFINITIONS, ...this.customImprovements]) {
			if (def.slug === lost) continue;
			const entry = improvements[def.slug];
			if (!Array.isArray(entry?.r)) continue;
			const links = linkedRequirementSlugs(def);
			if (!links.some(slugs => slugs?.includes(lost))) continue;
			// Read what the entry's standing effect was BEFORE the untick, as a requirement tick does.
			this._backfillStanding(def.slug, def, entry);
			const items = flatRequirementItems(def);
			const unticked = [];
			links.forEach((slugs, i) => {
				if (!slugs?.includes(lost) || entry.r[i] !== true || slugs.some(stands)) return;
				entry.r[i] = false;
				unticked.push(stripHtmlToText(items[i] ?? "").split(":")[0].trim());
			});
			if (!unticked.length) continue;
			lines.push(`${def.label}: unticked ${unticked.map(t => `"${t}"`).join(", ")}`);
			lines.push(...this._reconcileStandingGrant(def.slug, def, entry, data));
		}
		return lines;
	}

	/**
	 * What completing this improvement would apply, in words, WITHOUT writing anything: the
	 * force-complete confirm's "What changes" block. The same arithmetic completion runs, into a
	 * throwaway payload, so the window cannot promise something the write would not do.
	 * @param {string} slug
	 * @param {{forceR?: boolean[]}} [opts]  the ticks the completion would write
	 * @returns {string[]}
	 */
	improvementCompletionPreview(slug, { forceR } = {}) {
		const def = this.improvementDef(slug);
		const grants = improvementGrantsFor(slug, def);
		const entry = foundry.utils.deepClone(this._flags.improvements?.[slug] ?? { completed: false, r: [] });
		if (entry.completed) return [];
		if (Array.isArray(forceR)) entry.r = forceR;
		const scratch = {};
		const applied = grants && !entry.applied ? this._collectGrantEffects(grants, scratch) : {};
		const marks = this._improvementsToMark(slug, grants);
		if (marks.length && !entry.applied) applied.markedImprovements = marks;
		const lines = this._summarizeGrantChanges(Object.keys(applied).length ? applied : null, { data: scratch });
		entry.completed = true;
		return [...lines, ...this._reconcileStandingGrant(slug, def, entry, scratch)];
	}

	/**
	 * Tick or untick one requirement box of an improvement, and in the same write apply whatever
	 * that changes about a BUILT improvement's standing effect (standingGrantFor): the militia
	 * reaching or falling below 2 trained tactics, a Market or Expanded Trades ceasing to meet its
	 * requirements, or meeting them again.
	 *
	 * @returns {Promise<{label: string, summary: string[]}>}  what changed, for a notification
	 */
	async setImprovementRequirement(slug, index, checked, { seasonStep } = {}) {
		// IN TURN, because this is a read-modify-write and the control is a checkbox: two boxes pressed
		// inside one round trip both read the same `improvements` and the same stat, and the second
		// write lands on top of the first. Since a standing effect started MOVING A STAT that is no
		// longer a lost tick — Prosperity came off twice for one lapse, and `entry.standing` was left
		// claiming an effect that had already been taken back.
		return inTurn(`steading:${this._actor.id}`, () => this._setImprovementRequirement(slug, index, checked, { seasonStep }));
	}

	async _setImprovementRequirement(slug, index, checked, { seasonStep } = {}) {
		const def = this.improvementDef(slug);
		const improvements = foundry.utils.deepClone(this._flags.improvements ?? {});
		const entry = improvements[slug] ?? { completed: false, r: [] };
		if (!Array.isArray(entry.r)) entry.r = [];
		const data = {};
		// An improvement built before standing effects were tracked: whatever its boxes said
		// until now is presumed already applied by hand, the way _presumeAppliedGrants presumes
		// a one-time grant. Only the change this tick makes is applied.
		this._backfillStanding(slug, def, entry);
		entry.r[index] = !!checked;
		const summary = this._reconcileStandingGrant(slug, def, entry, data);
		improvements[slug] = entry;
		data[`flags.${STONETOP_SCOPE}.steading.improvements`] = improvements;
		// The militia forgetting a tactic for want of drills settles the summer in this same write.
		this._foldSeasonStep(data, seasonStep);
		await this._actor.update(data);
		return { label: def?.label ?? slug, summary };
	}

	/**
	 * Bring an improvement's standing effect in line with its entry, writing the stat change into
	 * `data` and recording what is now applied on `entry.standing`. Returns notification lines.
	 */
	_reconcileStandingGrant(slug, def, entry, data, why = "") {
		// An effect still applied is reconciled even once the definition has none: a `lapse` or
		// `condition` edited off a built custom improvement gives back what it took.
		const granted = hasStandingGrant(slug, def);
		if (!granted && !Object.keys(entry.standing ?? {}).length) return [];
		const want = standingGrantFor(slug, def, entry) ?? {};
		const have = entry.standing ?? {};
		const lines = [];
		for (const key of new Set([...Object.keys(want), ...Object.keys(have)])) {
			const delta = (want[key] ?? 0) - (have[key] ?? 0);
			const path = GRANT_STAT_PATHS[key];
			if (!delta || !path) continue;
			const from = Number(data[`system.${path}`] ?? this.getSystemValue(path, 0));
			data[`system.${path}`] = from + delta;
			data[`flags.${STONETOP_SCOPE}.steading.system.${path}`] = from + delta;
			const reason = granted ? standingReason(slug, delta, def, why) : "its standing effect was removed";
			lines.push(`${statChangeLine(key, from, from + delta)} (${reason})`);
		}
		entry.standing = Object.keys(want).length ? want : null;
		return lines;
	}

	/**
	 * Name the Inn ("Name the inn, add it to both the Resources list and map"): the Resources entry
	 * its completion added reads as the name, and the grant record follows it, so un-completing the
	 * Inn still takes the right entry away.
	 *
	 * @returns {Promise<string|null>} the Resources entry as written, or null when there was nothing to name
	 */
	async nameInn(name) {
		// In the steading's turn: it rewrites `improvements`, which the Inn's own completion (asked
		// just before this) may still be writing.
		return inTurn(`steading:${this._actor.id}`, () => this._nameInn(name));
	}

	async _nameInn(name) {
		const clean = String(name ?? "").trim();
		const improvements = foundry.utils.deepClone(this._flags.improvements ?? {});
		const entry = improvements.inn;
		const was = entry?.applied?.resources?.[0];
		if (!clean || !entry?.completed || !was) return null;
		const label = `${clean} (the inn)`;
		const resources = foundry.utils.deepClone(this._flags.resources ?? STEADING_DEFAULTS.resources);
		const at = resources.findIndex(r => r?.name === was);
		if (at < 0) return null;
		resources[at] = { ...resources[at], name: label };
		entry.applied.resources = [label, ...entry.applied.resources.slice(1)];
		entry.name = clean;
		await this.setFlags({ resources, improvements });
		return label;
	}

	/**
	 * The campaign year an aurochs hunt left the herd weak ("if you hunt next year they'll be
	 * wiped out"), or 0 when no hunt has. Read by the next spring's Aurochs Hunt window.
	 */
	aurochsWeakYear() {
		return Math.max(0, Math.trunc(Number(this._flags.aurochsWeak) || 0));
	}

	/** Remember that this year's hunt left the aurochs herd weak. */
	async markAurochsWeak(year) {
		await this.setFlags({ aurochsWeak: Math.max(1, Math.trunc(Number(year) || 1)) });
	}

	/**
	 * Take `count` horses from the tracked herd, oldest first as winter's losses are, and say how
	 * many actually went. Nothing to take from when the steading has no Herd of Horses: its horses
	 * are the draft pair on the Assets list, which the table settles by hand.
	 *
	 * @returns {Promise<number|null>} horses lost, or null when there is no tracked herd
	 */
	async loseHorses(count, { stonetopMove = "" } = {}) {
		if (!this.improvementCompleted("herdOfHorses")) return null;
		const before = this.getHerd();
		let toRemove = Math.max(0, Math.trunc(Number(count) || 0));
		const next = { grown: before.grown, yearlings: before.yearlings, foals: before.foals };
		for (const key of ["grown", "yearlings", "foals"]) {
			const take = Math.min(next[key], toRemove);
			next[key] -= take;
			toRemove -= take;
		}
		await this.setHerd(next, { stonetopMove });
		return (before.grown + before.yearlings + before.foals) - (next.grown + next.yearlings + next.foals);
	}

	/**
	 * How many horses a Requisition may take from the herd: its GROWN horses (a yearling is Value 2
	 * and untrained, a foal is a foal). 0 when the steading has no Herd of Horses.
	 */
	herdRequisitionCap() {
		return this.improvementCompleted("herdOfHorses") ? this.getHerd().grown : 0;
	}

	/**
	 * Take `count` grown horses out of the tracked herd for a Requisition (ruling: the table is
	 * asked how many, and they leave the herd). Capped at the grown horses. The herd's row on the
	 * Assets list is never marked out itself: the herd stays home, and what comes back is added to
	 * its card again by hand, as a winter's losses are taken off it.
	 * @returns {Promise<number|null>} horses taken, or null when there is no tracked herd
	 */
	async requisitionFromHerd(count, { stonetopMove = "Requisition" } = {}) {
		if (!this.improvementCompleted("herdOfHorses")) return null;
		const herd = this.getHerd();
		const take = Math.min(herd.grown, Math.max(0, Math.trunc(Number(count) || 0)));
		if (!take) return 0;
		await this.setHerd({ ...herd, grown: herd.grown - take }, { stonetopMove });
		return take;
	}

	/**
	 * Put `count` grown horses back in the tracked herd: a requisition from the herd taken back
	 * (the expedition picker's row clicked again).
	 * @returns {Promise<number|null>} horses returned, or null when there is no tracked herd
	 */
	async returnToHerd(count, { stonetopMove = "Requisition" } = {}) {
		if (!this.improvementCompleted("herdOfHorses")) return null;
		const back = Math.max(0, Math.trunc(Number(count) || 0));
		if (!back) return 0;
		const herd = this.getHerd();
		await this.setHerd({ ...herd, grown: herd.grown + back }, { stonetopMove });
		return back;
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

	/** A `{ stamp, ... }` flag, if it was stamped for this year+season; null otherwise. What
	 *  every value the season window has to remember across a reopen is read back through. */
	_stampedFlag(key, year, seasonId) {
		const held = this._flags[key] ?? null;
		return held && seasonId && held.stamp === `${year}:${seasonId}` ? held : null;
	}

	/** The flag that stamps `fields` to this year+season, WITHOUT writing it. Empty with no
	 *  season to stamp against: a stamp that could never match would neither show nor clear. */
	_stampedFlags(key, fields, year, seasonId) {
		return seasonId ? { [key]: { stamp: `${year}:${seasonId}`, ...fields } } : {};
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
		if (!held) return null;
		// A +1 Defenses still on the sheet keeps the muster showing until it is stood down, however
		// the clock has moved: hidden, its give-back had no control left to press.
		if (held.defenses) return held;
		const now = seasonStampKey(readCurrentSeason(this._actor));
		// Raised in a season the clock has since left: the muster lapsed with it. A muster raised
		// before the clock was ever set has no season, and lapses once the clock reads one.
		if (now && now !== (held.season ? `${held.year}:${held.season}` : "")) return null;
		return held;
	}

	/**
	 * Raise the muster for the current season, optionally taking the +1 Defenses pick.
	 *
	 * Folds in a muster already held (one hold, one +1 at most): a +1 an earlier muster put on the
	 * sheet is kept when this one takes the pick too, and given back when it does not, so the record
	 * always says what is on the sheet. And Defenses "can range from -1 to +3" (Book I p.512): at +3
	 * the pick adds nothing, and the hold records that it added nothing, so standing down takes
	 * nothing back.
	 * @returns {Promise<{defenses: boolean, capped: boolean}>} whether the hold carries a +1, and
	 *   whether the pick was asked for but Defenses was already at +3
	 */
	async raiseMuster({ defenses = false } = {}) {
		const { seasonId, year } = seasonStampParts(this._actor);
		const prev = this._flags.musterHold ?? null;
		const current = this.getStatValue("defenses");
		let next = current;
		let holding = false;
		if (prev?.defenses) {
			if (defenses) holding = true;
			else next = current - 1;
		} else if (defenses && current < STEADING_STAT_MAX) {
			next = current + 1;
			holding = true;
		}
		// The Defenses bump and the hold itself are one move, so they go out as one update:
		// two would append the muster to the ledger twice and card the stat change on its own.
		await this.applyChanges({
			system: next !== current ? { "stats.defenses.value": next } : {},
			flags: { musterHold: { year, season: seasonId, defenses: holding } },
		}, { stonetopMove: "Muster" });
		return { defenses: holding, capped: !!defenses && !holding };
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
	 * That stamp is also when the glyph goes out: when the clock leaves that winter. The debt
	 * itself does not lapse with it. "Before winter ends, or suffer the consequences again", so
	 * the next spring's Seasons Change reads it back by its stamp (`winterDebtFor`) and opens on
	 * it, pay or suffer, in the window the GM is already walking.
	 */
	winterDebt() {
		const now = seasonStampKey(readCurrentSeason(this._actor));
		return now ? this.winterDebtFor(now) : null;
	}

	/** The debt rolled for one "<year>:<season>" stamp, whatever the clock says. Spring of year
	 *  Y asks for "<Y-1>:winter", which still finds it if the clock was corrected by hand.
	 *  Carries its `stamp`, so a window settling it can re-read it by that stamp when clicked. */
	winterDebtFor(stamp) {
		const held = this._flags.winterDebt ?? null;
		const amount = Math.max(0, Math.trunc(Number(held?.amount) || 0));
		if (!amount || !stamp || held.stamp !== stamp) return null;
		return { stamp, amount, surplus: this.getStatValue("surplus") };
	}

	/**
	 * Is this autumn's harvest still to be rolled? "When the harvest is complete, roll 1d4": the
	 * end of autumn, not its first day, so it is owed for as long as the clock reads that autumn
	 * and its Surplus roll (SURPLUS_SEASON_STEP, the same marker the season window's button sets)
	 * has not been made.
	 */
	harvestOwed(year, seasonId) {
		return seasonId === "autumn" && !this.seasonStepApplied(SURPLUS_SEASON_STEP, year, seasonId);
	}

	/** The steading's Size: hamlet, village, town or city (the Size radios on the sheet). */
	steadingSize() {
		return this._flags.size ?? STEADING_DEFAULTS.size;
	}

	/** Record what winter still wants, for the year+season it was rolled in. Writes nothing at
	 *  all with no season to stamp against: a debt rolled before any Seasons Change has nothing
	 *  to expire against, and a stamp it could never match would neither show nor clear.
	 *
	 *  Closes the once-per-season WINTER_DEBT_STEP in the same write: a reopened window must not
	 *  roll the debt a second time, nor bring back one already paid by rolling it afresh. */
	async setWinterDebt(amount, year, seasonId) {
		if (!seasonId) return;
		await this.setFlags({
			...this._stampedFlags("winterDebt", { amount }, year, seasonId),
			...this.seasonStepFlags(WINTER_DEBT_STEP, year, seasonId),
		});
	}

	/**
	 * Winter's first consumption as ROLLED, before it is taken: `{ stamp, amount }`.
	 *
	 * Rolling and taking are two clicks with a window between them (enough Surplus: Apply; not
	 * enough: pick a consequence), and the season step only closes on the second. Without this a
	 * GM who closed the window in between reopened it on a fresh roll button, and could roll
	 * winter again until they liked the number. So the roll is kept, and a reopen resumes it.
	 * @returns {number|null} the amount rolled for that year+season (0 is a real roll), or null
	 */
	winterConsumptionRolled(year, seasonId) {
		const held = this._stampedFlag("winterConsumption", year, seasonId);
		return held ? Math.max(0, Math.trunc(Number(held.amount) || 0)) : null;
	}

	/**
	 * The Fortunes a season OPENED with, before its roll's "reset Fortunes to +1".
	 *
	 * The Herd of Horses reads it: "When the Seasons Change to summer … the herd gains foals equal
	 * to 1d4+Fortunes." That fires with the move, off the Fortunes the roll itself was made with,
	 * and the herd's button sits after the reset in the window, where the live figure is always
	 * the reset's +1. So the figure is noted when the window sees the roll made (or handed over),
	 * or failing that with the reset, and never by merely opening the window: one opened early
	 * to look would lock in a mid-play figure. Once noted it is kept.
	 * @returns {number|null} null when nothing was noted for that year+season
	 */
	openingFortunes(year, seasonId) {
		const held = this._stampedFlag("seasonOpeningFortunes", year, seasonId);
		const value = held ? Number(held.value) : NaN;
		return Number.isFinite(value) ? value : null;
	}

	/** The flag that notes {@link openingFortunes}, WITHOUT writing it; empty once noted. */
	openingFortunesFlags(year, seasonId) {
		if (this.openingFortunes(year, seasonId) !== null) return {};
		return this._stampedFlags("seasonOpeningFortunes", { value: this.getStatValue("fortunes") }, year, seasonId);
	}

	/** Keep the consumption just rolled, for {@link winterConsumptionRolled}. */
	async setWinterConsumptionRolled(amount, year, seasonId) {
		if (!seasonId) return;
		await this.setFlags(this._stampedFlags("winterConsumption", { amount }, year, seasonId));
	}

	/**
	 * The improvements map with every completed improvement's one-time Fortunes taken off its
	 * `applied` record, or `{}` when none carries one. WITHOUT writing it.
	 *
	 * Book I p. 514: "'increase Fortunes by 1.' This is a one-time gain; when Seasons Change and
	 * Fortunes reset, this benefit no longer matters." So once Fortunes resets, losing the
	 * improvement takes back only what lasts (Defenses, Prosperity, the lists, Size), and not a
	 * Fortunes the reset already spent. Zeroed rather than deleted: the flag is written by merging,
	 * which cannot drop a key, and a zero delta reverts and reports as nothing.
	 */
	fortunesSpentFlags() {
		const improvements = foundry.utils.deepClone(this._flags.improvements ?? {});
		let changed = false;
		for (const entry of Object.values(improvements)) {
			if (entry?.completed && entry.applied?.stats?.fortunes) {
				entry.applied.stats.fortunes = 0;
				changed = true;
			}
		}
		return changed ? { improvements } : {};
	}

	/**
	 * "Whatever the result, reset Fortunes to +1" (+0 while malcontent): the value, whatever flags
	 * the caller closes with it (built INSIDE the turn by `flags()`, so a season-step map is read
	 * fresh), and the spent one-time Fortunes grants (fortunesSpentFlags), in ONE write and in the
	 * steading's turn, since it rewrites `improvements`.
	 * @param {number} to
	 * @param {{flags?: () => object, options?: object}} [opts]
	 */
	async resetFortunes(to, { flags = () => ({}), options = {} } = {}) {
		return inTurn(`steading:${this._actor.id}`, () => this.applyChanges({
			system: { "stats.fortunes.value": to },
			flags: { ...flags(), ...this.fortunesSpentFlags() },
		}, options));
	}

	/** Has this improvement been built? What gates every improvement-fed seasonal obligation. */
	improvementCompleted(slug) {
		return !!this._flags.improvements?.[slug]?.completed;
	}

	/**
	 * What un-completing or removing this improvement would actually give back, in words.
	 *
	 * ⚠ OFF THE RECORD OF WHAT WAS APPLIED, never off the definition's `grants`. The two are not
	 * the same list and are not meant to be: `_collectGrantEffects` writes down only what it really
	 * changed, so a grant of a Resource the steading already had records nothing and gives nothing
	 * back. A confirm dialog reading the definition promised "Fresh water ... removing it gives
	 * them back" and then handed back nothing at all — and an improvement whose grants were EDITED
	 * after it was completed, which `updateCustomImprovement` allows, would have promised the new
	 * grants and reverted the old ones.
	 */
	improvementGivesBack(slug) {
		const applied = this._flags.improvements?.[slug]?.applied;
		if (!applied) return [];
		// A dry run of the reversal itself, so what it would leave alone (a Size changed since)
		// is said as left alone rather than promised back.
		const scratch = {};
		const { done, kept } = this._revertGrantEffects(applied, scratch);
		return [...this._summarizeGrantChanges(done, { data: scratch, reverting: true }), ...kept];
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
		// Every upkeep owed this season and not yet settled (paid, or the improvement lost), off the
		// improvements' own `upkeep` grants. The watch and the weapons keep their own rows (their
		// own glyphs and words); any other improvement's, a homebrew one's, shares the generic row.
		const owed = seasonId
			? upkeepsDue(this.improvementRules(), seasonId).filter(u => !this.seasonStepApplied(u.key, year, seasonId))
			: [];
		const owes = slug => owed.some(u => u.slug === slug);
		const otherUpkeep = owed.filter(u => u.slug !== "standingWatch" && u.slug !== "weaponsOfWar");
		return steadingHolds({
			fortunesAdvantage: this.fortunesAdvantage(),
			muster: this.musterHold(),
			torsBlessing: this.torsBlessingActive(),
			herdAdvance: seasonId === "summer" && herd
				&& !this.seasonStepApplied("advanceHerd", year, seasonId),
			// All autumn, until the harvest is rolled: its roll comes when the harvest is complete,
			// which is the season's end, so it outlives the window that opened the season.
			harvest: this.harvestOwed(year, seasonId),
			// Only when it would actually do something: an inn with no debility to clear, or
			// no Surplus to spend, is not an unspent opportunity, it is just an inn.
			innGathering: !!inn?.canGather,
			standingWatch: owes("standingWatch"),
			weaponsUpkeep: owes("weaponsOfWar"),
			upkeep: otherUpkeep.length ? { items: otherUpkeep.map(u => ({ label: u.label, surplus: u.surplus })) } : null,
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
			disasterOwed: this.disasterOwed(),
		});
	}

	/**
	 * A Meet with Disaster the steading has met but not yet paid: `{ cause }`, or null.
	 *
	 * At Fortunes −1 the cost is the GM's pick, made in a window that opens AFTER the write that
	 * caused it (a failed harvest's step marker, a winter shortfall's Surplus to 0). That write
	 * carries this flag and the pick clears it, so a window closed unpicked leaves a header glyph
	 * behind rather than nothing at all. Not stamped to a season: the rule does not lapse.
	 */
	disasterOwed() {
		const held = this._flags.disasterOwed ?? null;
		return held ? { cause: String(held.cause ?? "") } : null;
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
		// Rounds DOWN ("1 Surplus per 6": 11 horses eat 1), by the user's ruling of 2026-10-03.
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
				// Not Fortunes: an improvement built before the grant engine has seen a Seasons
				// Change since, and the reset spent its one-time +1 (fortunesSpentFlags).
				if (key === "fortunes") continue;
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

		if (grants.replaceAssets?.length) {
			const assets = foundry.utils.deepClone(this._flags.assets ?? STEADING_DEFAULTS.assets);
			const replaced = [];
			for (const { match, name, beast } of grants.replaceAssets) {
				if (this._listHasName(assets, name)) continue;
				const at = assets.findIndex(a => String(a?.name ?? "").toLowerCase().includes(String(match).toLowerCase()));
				// A FRESH row, not the old one renamed: the draft pair's `beast` (two hardy horses),
				// its `takenBy` and its tick are the pair's, and spread across they made the herd
				// requisition as exactly two horses, or start life already out on an expedition.
				// Only the book's Herd of Horses carries a `beast`; any other swap (a homebrew
				// improvement's) is a plain asset, `beast: null`, so it is never read as animals to
				// requisition, nor as the herd whose tracker lives on that one improvement.
				const row = { name, checked: true, beast: beast ? { ...beast } : null };
				if (at >= 0) {
					// The whole row it replaced, so un-completing puts back exactly that.
					replaced.push({ from: assets[at].name, to: name, fromRow: foundry.utils.deepClone(assets[at]) });
					assets[at] = row;
				} else {
					const empty = assets.findIndex(a => !String(a?.name ?? "").trim());
					if (empty >= 0) assets[empty] = row;
					else assets.push(row);
					replaced.push({ from: null, to: name });
				}
			}
			if (replaced.length) {
				data[`flags.${scope}.steading.assets`] = assets;
				applied.replacedAssets = replaced;
			}
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

	/**
	 * Reverse a previously-applied grant record into `data` (negate stats, remove added list
	 * entries, restore removed ones, roll size/population back).
	 *
	 * A reversal takes back what completing DID, and only while it is still there to take. Two of
	 * these are not deltas but overwrites, and used to put the old value back whatever had happened
	 * since: a Township lost a year later reset Size and Population to what they were the day it
	 * was built. So:
	 *
	 *   Size, Population  restored only while they still hold what completion set (`to`);
	 *   a removed Fortification  put back only while the improvement that grants it is still
	 *                     built (Stone Wall's "erase Palisade": a Palisade un-completed, or never
	 *                     built and only presumed by the legacy back-fill, does not come back),
	 *                     and never twice.
	 *
	 * @returns {{done: object, kept: string[]}} `done` is the part of the record actually reversed,
	 *   in the record's own shape, for _summarizeGrantChanges; `kept` says what was left alone, and why.
	 */
	_revertGrantEffects(applied, data) {
		const scope = STONETOP_SCOPE;
		const done = {};
		const kept = [];

		if (applied.stats) {
			const stats = {};
			for (const [key, delta] of Object.entries(applied.stats)) {
				const path = GRANT_STAT_PATHS[key];
				// A zero is a delta the Fortunes reset already spent (fortunesSpentFlags).
				if (!path || !delta) continue;
				const next = Number(this.getSystemValue(path, 0)) - delta;
				data[`system.${path}`] = next;
				data[`flags.${scope}.steading.system.${path}`] = next;
				stats[key] = delta;
			}
			if (Object.keys(stats).length) done.stats = stats;
		}

		for (const listKey of ["resources", "fortifications"]) {
			const addedNames = applied[listKey] ?? [];
			const restore = listKey === "fortifications" ? (applied.removedFortifications ?? []) : [];
			if (!addedNames.length && !restore.length) continue;
			const list = foundry.utils.deepClone(this._flags[listKey] ?? STEADING_DEFAULTS[listKey]);
			for (const name of addedNames) this._clearNamedInList(list, name);
			if (addedNames.length) done[listKey] = [...addedNames];
			const restored = [];
			for (const item of restore) {
				// Put back while ANY improvement that grants it is built: a homebrew one can grant
				// the same Fortification as the book's.
				const owners = this._fortificationOwners(item.name);
				if (owners.length && !owners.some(o => this.improvementCompleted(o.slug))) {
					kept.push(`${item.name} not put back (${owners.map(o => o.label).join(" or ")} is not built)`);
					continue;
				}
				if (this._listHasName(list, item.name)) continue;
				this._addNamedToList(list, item.name, item.checked);
				restored.push(item);
			}
			if (restored.length) done.removedFortifications = restored;
			data[`flags.${scope}.steading.${listKey}`] = list;
		}

		if (applied.replacedAssets?.length) {
			const assets = foundry.utils.deepClone(this._flags.assets ?? STEADING_DEFAULTS.assets);
			for (const { from, to, fromRow } of applied.replacedAssets) {
				const at = assets.findIndex(a => a?.name === to);
				if (at < 0) continue;
				if (fromRow) assets[at] = foundry.utils.deepClone(fromRow);
				else if (from) {
					// A record from before the whole row was kept: the name back, and none of the
					// herd's own fields (getNamedAssets gives a seeded row its `beast` back by name).
					const { beast, takenBy, ...rest } = assets[at];
					assets[at] = { ...rest, name: from };
				} else this._clearNamedInList(assets, to);
			}
			data[`flags.${scope}.steading.assets`] = assets;
			done.replacedAssets = applied.replacedAssets;
		}

		if (applied.setSize) {
			const now = this._flags.size ?? STEADING_DEFAULTS.size;
			if (now === applied.setSize.to) {
				data[`flags.${scope}.steading.size`] = applied.setSize.from;
				done.setSize = applied.setSize;
			} else {
				kept.push(`Size stays ${now} (it has changed since)`);
			}
		}

		if (applied.setPopulation) {
			const now = Number(this.getSystemValue("attributes.population.value", 0));
			if (now === applied.setPopulation.to) {
				data["system.attributes.population.value"] = applied.setPopulation.from;
				data[`flags.${scope}.steading.system.attributes.population.value`] = applied.setPopulation.from;
				done.setPopulation = applied.setPopulation;
			} else {
				kept.push(`Population stays ${now >= 0 ? "+" : ""}${now} (it has changed since)`);
			}
		}

		return { done, kept };
	}

	/**
	 * Every improvement whose completion adds a Fortification by this name, possibly none: the
	 * book's own first, then the custom ones, read through the same grants lookup as
	 * improvementRules().
	 */
	_fortificationOwners(name) {
		const target = String(name ?? "").trim().toLowerCase();
		return [...IMPROVEMENT_DEFINITIONS, ...this.customImprovements]
			.filter(d => (improvementGrantsFor(d.slug, d)?.fortifications ?? []).some(f => String(f).trim().toLowerCase() === target))
			.map(def => ({ slug: def.slug, label: def.label ?? def.name ?? def.slug }));
	}

	/**
	 * Human-readable one-liners describing an `applied` grant record, for a notification or a
	 * confirm's "What changes" block. Every stat is said as the transition it makes, "Fortunes +1
	 * → +2", read off the live value (before) and the payload the write is about to send (after):
	 * call this BEFORE the update lands, with the `data` the change was collected into. Entries are
	 * said as sentences ("Mill added to Resources"), since "Resources +Mill" after "Reverted" read
	 * as an addition.
	 * @param {object|null} applied  the record (or the part of it a reversal actually did)
	 * @param {{data?: object, reverting?: boolean}} [opts]  `reverting` when the record is being
	 *   taken back, so every list change and overwrite reads the other way round
	 */
	_summarizeGrantChanges(applied, { data = {}, reverting = false } = {}) {
		if (!applied) return [];
		const parts = [];
		const sign = reverting ? -1 : 1;
		if (applied.stats) {
			for (const [key, delta] of Object.entries(applied.stats)) {
				// A zero is a one-time Fortunes the reset already spent: nothing to say.
				const path = GRANT_STAT_PATHS[key];
				if (!delta || !path) continue;
				const from = Number(this.getSystemValue(path, 0)) || 0;
				const to = Number(data[`system.${path}`] ?? from + sign * delta);
				parts.push(statChangeLine(key, from, to));
			}
		}
		for (const listKey of ["resources", "fortifications"]) {
			for (const name of applied[listKey] ?? []) parts.push(listChangeLine(name, listKey, !reverting));
		}
		for (const { name } of applied.removedFortifications ?? []) parts.push(listChangeLine(name, "fortifications", reverting));
		for (const { from, to } of applied.replacedAssets ?? []) {
			const short = String(to).split(" (")[0];
			const was = from ? String(from).split(" — ")[0] : "";
			if (!was) parts.push(listChangeLine(short, "assets", !reverting));
			else parts.push(reverting ? `Assets: ${short} → ${was}` : `Assets: ${was} → ${short}`);
		}
		const size = s => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1);
		if (applied.setSize) {
			const { from, to } = applied.setSize;
			parts.push(reverting ? `Size ${size(to)} → ${size(from)}` : `Size ${size(from)} → ${size(to)}`);
		}
		if (applied.setPopulation) {
			const { from, to } = applied.setPopulation;
			parts.push(reverting ? statChangeLine("population", to, from) : statChangeLine("population", from, to));
		}
		if (applied.markedImprovements?.length && !reverting) {
			parts.push(`Also marked complete: ${applied.markedImprovements.map(s => this.improvementDef(s)?.label ?? s).join(", ")}`);
		}
		return parts;
	}

	/** Every named asset, on hand or out, each carrying its index in the stored list. A
	 *  seeded asset stored before rows carried a `beast` field gets its default's back. */
	getNamedAssets() {
		const assets = this._flags.assets ?? STEADING_DEFAULTS.assets;
		return assets
			.map((asset, index) => {
				const row = { ...asset, index };
				// The herd's row, whatever `beast` an older replacement carried across from the
				// draft pair (see HERD_ASSET_BEAST).
				// Not a row a homebrew swap wrote, whose `beast` is an explicit null (see isHerdAsset).
				if (row.name === HERD_ASSET_NAME && row.beast !== null && row.beast?.herd !== true) row.beast = { ...HERD_ASSET_BEAST };
				if (row.beast === undefined) {
					const seeded = STEADING_DEFAULTS.assets.find(d => d.name && d.name === row.name);
					if (seeded && seeded.beast !== undefined) row.beast = seeded.beast;
				}
				return row;
			})
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
	 * Refused (false) for an asset already out, and for a row that no longer carries `name` when the
	 * caller says which asset it meant: an index is a POSITION, and a row deleted above it since the
	 * window was drawn makes the same index name a different asset. Read and written in the
	 * steading's turn (editList), so two takes of one asset cannot both land.
	 *
	 * @param {number} index
	 * @param {{name?: string, id?: string, expedition?: {id: string, title: string}}} takenBy
	 * @param {{name?: string}} [expect]  the asset the caller meant, checked against the row
	 */
	async setAssetTaken(index, takenBy, { name } = {}) {
		return this.editList("assets", assets => {
			const row = assets[index];
			if (!row?.name || row.takenBy) return false;
			if (name !== undefined && String(row.name).trim() !== String(name).trim()) return false;
			assets[index] = { ...row, checked: false, takenBy };
		});
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
		let changed = 0;
		// In the steading's turn, like every list write (editList): read outside it, a take landing
		// meanwhile was written back over.
		await this.editList("assets", assets => {
			changed = 0;
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
			if (!changed) return false;
		});
		return changed;
	}

	/** Return a requisitioned asset to the steading: re-check it and clear the taken-by note. */
	async returnAsset(index) {
		return this.editList("assets", assets => {
			if (!assets[index]) return false;
			const { takenBy, ...rest } = assets[index];
			assets[index] = { ...rest, checked: true };
		});
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

		const mapImprovement = (rawDef, custom) => {
			// A custom definition stored before its HTML was sanitized on the way IN is sanitized
			// on the way out too: the tab paints heading, requirements and effect unescaped.
			const def = custom ? sanitizeImprovementDef(rawDef) : rawDef;
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
			// A `condition` grant ("As long as you trade aetherium to the outside world, increase
			// Prosperity by 1"): a box on the built improvement's card, ticked while it holds.
			const condition = completed ? improvementGrantsFor(def.slug, def)?.condition ?? null : null;
			// An improvement can only be marked complete once its requirements are
			// met; an already-complete one stays toggleable so it can be undone.
			const requirementsMet = improvementRequirementsMet(def, stored.r ?? []);
			// Where it stands, in words, on the header (closed cards included): the built border
			// and the dimmed box said it only in colour and opacity. Counted the way requirements
			// are MET (improvementRequirementProgress), so an either/or isn't two requirements owed.
			const progress = improvementRequirementProgress(def, stored.r ?? []);
			const status = completed
				? { kind: "built", text: "Built" }
				: requirementsMet
					? { kind: "ready", text: "Ready to mark complete" }
					: { kind: "progress", text: `${progress.ticked} of ${progress.needed} ticked` };
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
				status,
				sections,
				effect: def.effect,
				custom: !!custom,
				// Herd of Horses carries an interactive herd tracker once earned.
				herd: def.slug === "herdOfHorses" && completed ? this._herdView() : null,
				// The Inn carries its once-per-season gathering once built.
				innGathering: def.slug === "inn" && completed ? this._innGatheringView() : null,
				// ...and its name ("Name the inn, add it to both the Resources list and map"): asked
				// when it is built, and answerable from the card at any time after (nameInn), while
				// the Resources entry its completion added is there to carry the name.
				innName: def.slug === "inn" && completed && !custom && stored.applied?.resources?.[0]
					? { name: stored.name ?? "" }
					: null,
				// An improvement that IS a move rolls from its own card too, once built.
				rollsMove: completed ? IMPROVEMENT_MOVES[def.slug] ?? null : null,
				condition: condition ? {
					text: condition.text,
					checked: stored.condition === true,
					effect: statGrantLines(condition.stats),
				} : null,
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
