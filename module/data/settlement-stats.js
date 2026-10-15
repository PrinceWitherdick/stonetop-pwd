// What the books print about other steadings, as a settlement sheet takes it in.
//
// Book I p.508 ("Other steadings"): "Other steadings have stats and details similar to Stonetop's,
// which you can find in Book II. Use those stats should the PCs end up Trading & Bartering in
// another steading, Mustering or Deploying its people, or having them Pull Together." Book II
// prints those stats in a sidebar on each settlement's first page: Size (with a headcount),
// Population, Prosperity, who it trades with and for what, its Resources, and Defenses with the
// list behind them. Never Fortunes, Surplus, improvements or assets: those are Stonetop's alone.
//
// HAND-TRANSCRIBED, NOT PARSED. The Locations compendium carries the same sidebar, but its list
// markup runs each heading into the item before it ("Windmill Defenses +1"), and there are only a
// handful of places. tests/data/settlement-stats.test.js holds every number and list entry here
// against that compendium text, so a slip in either direction fails a test.
//
// Two tables:
//  • BOOK_SETTLEMENT_STATS, keyed by the roster slug in ./settlements.js: the named places with a
//    printed stat block, plus Lygos, which has none but is plainly a city.
//  • SETTLEMENT_TEMPLATES: the "here's a typical band / hamlet / hillfort" blocks Book II prints for
//    making your own. Some give a range ("Population -1 to +1"); the sheet takes the middle and
//    shows the range beside the stat. `setupNote` says what the book asks the GM to pick.
//
// `journalId` is the place's entry in the merged `stonetop-journal` pack (the file under
// packs/src/stonetop-locations or stonetop-lore whose `_id` it is), for the sheet's gazetteer
// link; the world's seeded copy is preferred when there is one (utils/gazetteer-notes.js).
//
// List rows are `{name, detail}`, where `detail` is the book's parenthetical. Trade rows are
// `{partner, goods, slug}`; `slug` names a roster row when the partner is one, so the sheet can
// open that partner's own sheet. `groups` and `leaders` come from each place's People section.

/** Where a stat block's stats come from, for the sheet's "Read in the gazetteer" line. */
const BOOK_II = "Book II";

export const BOOK_SETTLEMENT_STATS = {
	"marshedge": {
		journalId: "uXlyry9CpXUz4ooR",
		page: `${BOOK_II} p.274`,
		kind: "Town",
		size: "town",
		headcount: "~800 to 900 souls",
		population: 0,
		prosperity: 2,
		defenses: 1,
		region: "On the Highway, on a rise above Ferrier's Fen",
		government: "The Council: the head of each Old Family, the master of each Guild, the eldest of the fen-walkers, and Brennan (who has no vote, but pushes them around).",
		tradeWith: [
			{ partner: "Lygos", goods: "fine goods, spices, etc.", slug: "lygos" },
			{ partner: "Manmarch", goods: "timber, salt, amber", slug: "north-manmarch" },
			{ partner: "Gordin's Delve", goods: "metal, tools", slug: "gordins-delve" },
			{ partner: "Stonetop", goods: "whisky, fur", slug: "" },
		],
		resources: [
			{ name: "Farming", detail: "wheat, hemp, wild rice, herbs" },
			{ name: "Trades", detail: "textiles, pottery, glass, rope, medicine" },
			{ name: "Forage", detail: "herbs, peat, clay" },
			{ name: "Marketplace", detail: "" },
			{ name: "Windmill", detail: "" },
		],
		fortifications: [
			{ name: "The Guard", detail: "" },
			{ name: "Wooden palisade", detail: "" },
			{ name: "Bendis root braziers", detail: "" },
		],
		groups: [
			{ name: "The Guard", count: "~40", notes: "The town's well-drilled standing watch." },
			{ name: "The Old Families", count: "~30, and ~40 servants", notes: "Stone manor houses of High Town; a piece of every pie." },
			{ name: "The Guilds", count: "~125", notes: "Weavers, potters, glassblowers, herbalists, and their families." },
			{ name: "The lesser trades", count: "~40", notes: "Smiths, bakers, carpenters, thatchers, the miller." },
			{ name: "Fen-walkers", count: "~20", notes: "Herbs, game, peat and clay from the Fen." },
			{ name: "Merchants", count: "~40", notes: "" },
			{ name: "Beggars & thieves", count: "~20-40", notes: "Varies by day." },
			{ name: "Farmers & laborers", count: "~500", notes: "Tenant farmers, homemakers, muscle for hire." },
			{ name: "Travelers", count: "~25-100", notes: "Depending on the season." },
		],
		leaders: [
			{ name: "Brennan", role: "Onetime bandit leader of the Claws, now the town's marshal", instinct: "" },
			{ name: "Ianthe", role: "Matriarch of the Ferriers", instinct: "To maintain her family's dignity" },
			{ name: "Muiris", role: "Patriarch of the Hawtreys", instinct: "To put his family's fortunes above all else" },
			{ name: "Caineach", role: "Leads the Tricklebanks", instinct: "To seize any opportunity" },
			{ name: "Ailbe", role: "Young head of the Eldershaws", instinct: "To put off decisions" },
		],
	},
	"gordins-delve": {
		journalId: "HesP5wBhjA0l9Ffk",
		page: `${BOOK_II} p.190`,
		kind: "Mining town",
		size: "town",
		headcount: "~700 to 800 souls",
		population: 2,
		prosperity: 0,
		defenses: -1,
		region: "The Huffel Peaks, at the end of the West Road",
		government: "No town council, not even a militia. Five Bosses run big parts of the local economy.",
		tradeWith: [
			{ partner: "Marshedge", goods: "wheat, flax, rope, textiles, herbs, glass", slug: "marshedge" },
			{ partner: "Stonetop", goods: "barley, potatoes, furs, whisky", slug: "" },
		],
		resources: [
			{ name: "Mining", detail: "iron, copper, lead, tin, silver" },
			{ name: "Trades", detail: "smithing, tinkering" },
			{ name: "Timber", detail: "" },
			{ name: "Goats", detail: "" },
			{ name: "Aqueduct", detail: "" },
		],
		fortifications: [
			{ name: "Maker-ramparts", detail: "" },
			{ name: "Unassailable position", detail: "" },
		],
		groups: [
			{ name: "The Bosses", count: "5, each with 10-15 family, servants and retainers", notes: "" },
			{ name: "Merchants", count: "~25", notes: "About 10 operations, most backed by a Boss." },
			{ name: "The Keeps", count: "~50", notes: "Trades, shops, inns, boarding houses, dens of vice." },
			{ name: "Miners", count: "~250", notes: "" },
			{ name: "Prospectors", count: "~5-10", notes: "" },
			{ name: "Smelters", count: "~50", notes: "Work Foundry in shifts." },
			{ name: "Loggers", count: "~50", notes: "" },
			{ name: "The desperate", count: "~100-200", notes: "Always in flux." },
			{ name: "Odd jobs", count: "~100-150", notes: "Herding, butchering, hauling water, staff and muscle." },
		],
		leaders: [
			{ name: "Mutra the Teeth", role: "Boss: mines, timber", instinct: "" },
			{ name: "Odo Thriceborn", role: "Boss: mines, housing", instinct: "" },
			{ name: "Honest Draigh", role: "Boss: trade with Marshedge, food", instinct: "" },
			{ name: "Jahalim of the Keys", role: "Boss: Foundry", instinct: "" },
			{ name: "Smiling Ffransis", role: "Boss: water, booze", instinct: "" },
		],
	},
	"barrier-pass": {
		journalId: "VZ3YkXn70E1C7TEO",
		page: `${BOOK_II} p.26`,
		kind: "Fortress-monastery",
		size: "village",
		headcount: "~200 souls",
		population: 0,
		prosperity: 0,
		defenses: 2,
		region: "The Whitefang Mountains, five days north",
		government: "The Three Honorable Sages, powerful adepts who each lead one of the three sects.",
		tradeWith: [
			{ partner: "Mammoth herders", goods: "ivory, wool, meat", slug: "" },
			{ partner: "Other fortress-monasteries", goods: "", slug: "" },
		],
		resources: [
			{ name: "Taxes from nearby farm valleys", detail: "" },
			{ name: "Farming", detail: "terraced gardens, barley" },
			{ name: "Livestock", detail: "goats, sheep, milk, fine wool, meat" },
			{ name: "Timber", detail: "from the Foothills" },
			{ name: "Parchment, vellum, ink", detail: "" },
			{ name: "Trades", detail: "smithing, weaving, tanning, scribing" },
		],
		fortifications: [
			{ name: "A score of guardians", detail: "" },
			{ name: "A handful of adepts", detail: "" },
			{ name: "A number of tulpas", detail: "" },
			{ name: "Blunt weapons, nets, bolas, bronze shields and mail", detail: "" },
			{ name: "Exceptional fortifications", detail: "" },
		],
		groups: [
			{ name: "Monks", count: "~40", notes: "Of all three sects, novices included." },
			{ name: "The Guardians", count: "~20", notes: "Sworn to defend Barrier Pass; no edged weapons." },
			{ name: "Lay folk", count: "~140", notes: "Garden, herd, cook, clean." },
		],
		leaders: [
			{ name: "Gar Torjeng", role: "Leads the Empty Sky sect", instinct: "To avoid disruption and distraction" },
			{ name: "Preshi Kav", role: "Leads the Unmoved Mountain sect", instinct: "To drive her students towards perfection" },
			{ name: "Oparma Div", role: "Leads the White Crystal sect", instinct: "To tame chaos" },
		],
		setupNote: "When the PCs Trade & Barter here, acquiring or selling a bladed weapon is at disadvantage. Its improvement, Trade with Barrier Pass, goes on Stonetop's sheet.",
	},
	"lygos": {
		journalId: "DPUvs6Ss8UHXEsCJ",
		page: `${BOOK_II} p.256`,
		kind: "City",
		size: "city",
		headcount: "",
		population: 0,
		prosperity: 0,
		defenses: 0,
		region: "The arid south, beyond the South Manmarch",
		government: "",
		tradeWith: [],
		resources: [],
		fortifications: [],
		groups: [],
		leaders: [],
		statRanges: { population: "not printed", prosperity: "not printed", defenses: "not printed" },
		setupNote: "Book II prints no stat block for Lygos, only that it is a great city. Set its stats to suit your table.",
	},
};

/**
 * The generic blocks for making your own. `id` is stored on the sheet (`system.sourceSlug`), so
 * it must stay stable. `journalId` is the gazetteer entry the block is printed in, as for the
 * named places above.
 */
export const SETTLEMENT_TEMPLATES = [
	{
		id: "hillfolk-band",
		label: "Hillfolk band",
		icon: "fa-campground",
		hint: "Nomads of the Steplands: horses, sheep, mounted warriors.",
		journalId: "NS2bhYMi23m0eWao",
		page: `${BOOK_II} p.230`,
		kind: "Hillfolk band",
		size: "hamlet",
		headcount: "~25 to 75 souls",
		population: 0,
		prosperity: -1,
		defenses: 0,
		tradeWith: [
			{ partner: "Other bands", goods: "", slug: "hillfolk" },
			{ partner: "Marshedge", goods: "rope, textiles, herbs, pottery", slug: "marshedge" },
			{ partner: "Stonetop", goods: "whisky, potatoes, oats", slug: "" },
			{ partner: "Lygos, etc.", goods: "salt, tools", slug: "lygos" },
		],
		resources: [
			{ name: "Horses, sheep, goats, hounds", detail: "" },
			{ name: "Wool, milk", detail: "" },
			{ name: "Forage", detail: "fruits, nuts, veggies, honey" },
			{ name: "Hunting", detail: "meat, fur, hides" },
			{ name: "Gathering", detail: "timber, sap, flint" },
		],
		fortifications: [
			{ name: "Mounted warriors", detail: "" },
			{ name: "Flint-tipped weapons", detail: "crude" },
		],
		setupNote: "Trades with other bands, and with 1 more: keep one of Marshedge, Stonetop or Lygos and delete the others.",
	},
	{
		id: "manmarch-hamlet",
		label: "North Manmarch hamlet",
		icon: "fa-house-chimney",
		hint: "A cluster of longhouses bound by oath to a hillfort's chief.",
		journalId: "NERZ6p7FNc1pxNWL",
		page: `${BOOK_II} p.284`,
		kind: "Hamlet",
		size: "hamlet",
		headcount: "~25 to 75 souls",
		population: 0,
		prosperity: -1,
		defenses: 1,
		tradeWith: [
			{ partner: "Other hamlets", goods: "", slug: "north-manmarch" },
		],
		resources: [
			{ name: "Livestock", detail: "pigs, goats, sheep, meat, milk, wool" },
			{ name: "Farming", detail: "wheat, barley, oats, honey, mead" },
			{ name: "Timber", detail: "" },
			{ name: "Trapping", detail: "fur, meat" },
			{ name: "Mining", detail: "amber, salt, and/or iron" },
		],
		fortifications: [
			{ name: "Warrior culture", detail: "" },
			{ name: "Iron weapons, wooden shields", detail: "" },
			{ name: "Protection from the local chief", detail: "" },
		],
		setupNote: "Resources: keep 2 or 3 and delete the rest. A hamlet is named for its most notable resident, then \"-hall\" (Dagmarhall, Swanhall).",
	},
	{
		id: "manmarch-hillfort",
		label: "North Manmarch hillfort",
		icon: "fa-chess-rook",
		hint: "A chief's fortified seat, with warriors and ramparts.",
		journalId: "NERZ6p7FNc1pxNWL",
		page: `${BOOK_II} p.284`,
		kind: "Hillfort",
		size: "village",
		headcount: "~150 to 350 souls",
		population: -1,
		prosperity: 0,
		defenses: 2,
		tradeWith: [
			{ partner: "Other hillforts", goods: "", slug: "north-manmarch" },
			{ partner: "Marshedge and/or Lygos", goods: "textile, spices, glass, herbs, finery", slug: "marshedge" },
		],
		resources: [
			{ name: "Taxes from surrounding hamlets", detail: "" },
			{ name: "Trades", detail: "smithing, tanning, pottery" },
			{ name: "Livestock", detail: "pigs, goats, sheep, meat, milk, wool" },
			{ name: "Market", detail: "for surrounding hamlets" },
			{ name: "Timber", detail: "" },
		],
		fortifications: [
			{ name: "A dozen or so professional warriors", detail: "" },
			{ name: "Rotating recruits from the hamlets", detail: "" },
			{ name: "Iron weapons, wooden shields", detail: "" },
			{ name: "Series of earthen ramparts", detail: "" },
			{ name: "Palisades", detail: "" },
		],
		setupNote: "Resources: keep 2 or 3 and delete the rest. Hillfort names: Wulfberg, Rabenberg, Eikelberg, Hokberg, Tiefberg, Baerinberg, Schutberg.",
	},
	{
		id: "mammoth-herders",
		label: "Mammoth-herder band",
		icon: "fa-snowflake",
		hint: "Polite, ritual-bound herders of the Frozen Wastes.",
		journalId: "xg8MEuSbbEt1wqg8",
		page: `${BOOK_II} p.175`,
		kind: "Mammoth-herder band",
		size: "hamlet",
		headcount: "~15-30 souls",
		population: 0,
		prosperity: -1,
		defenses: 0,
		tradeWith: [
			{ partner: "Other mammoth herders", goods: "", slug: "" },
			{ partner: "A farming valley", goods: "", slug: "" },
			{ partner: "A fortress-monastery", goods: "", slug: "" },
		],
		resources: [
			{ name: "Mammoths", detail: "wool, ivory, bone, dung" },
			{ name: "Sleds/sledges of bone, hide, timber", detail: "" },
			{ name: "Hunting", detail: "wild mammoths, caribou, hare, fish" },
			{ name: "Gathering", detail: "timber, ivory, bone, flint, herbs, dark ice" },
		],
		fortifications: [
			{ name: "Mammoth-mounted warriors", detail: "" },
			{ name: "Hounds and hunting drakes", detail: "" },
			{ name: "Spears/javelins tipped with dark ice, flint, bone, or bronze", detail: "crude" },
		],
		setupNote: "Trades with 1 or 2 of the partners listed: delete the others.",
	},
	{
		id: "whitefang-farm-valley",
		label: "Whitefang farm valley",
		icon: "fa-wheat-awn",
		hint: "A mountain steading of terraced fields and fine wool.",
		journalId: "5vFbBIn18TKtCF91",
		page: `${BOOK_II} p.484`,
		kind: "Farm valley",
		size: "hamlet",
		headcount: "~25 to 75 souls (hamlet) or ~150 to 350 (village)",
		population: 0,
		prosperity: 0,
		defenses: -1,
		statRanges: { population: "-1 to +1", prosperity: "-1 to +1", defenses: "-1 for a hamlet, +0 for a village" },
		tradeWith: [
			{ partner: "Other farm valleys", goods: "food, spouses", slug: "" },
			{ partner: "Mammoth herders", goods: "ivory, meat, dark ice", slug: "" },
		],
		resources: [
			{ name: "Farming", detail: "terraced fields, barley, lentils" },
			{ name: "Livestock", detail: "goats, sheep, milk, meat" },
			{ name: "Fine wool", detail: "" },
			{ name: "Timber", detail: "" },
			{ name: "Hunting/fishing", detail: "" },
			{ name: "Trades", detail: "weaving, dyeing, bronzesmithing, etc." },
		],
		fortifications: [
			{ name: "Some spears, slings, bows", detail: "" },
			{ name: "Some bronze tools/weapons", detail: "" },
			{ name: "Protection from a nearby fortress-monastery", detail: "" },
		],
		setupNote: "Pick hamlet or village (a village has Defenses +0). Then pick or roll what the neighbors say they are, up to 2 features, and up to 3 things true of everyone or no one here (the tables on the same page).",
	},
	{
		id: "fortress-monastery",
		label: "Whitefang fortress-monastery",
		icon: "fa-place-of-worship",
		hint: "Keepers of the Rime Lords' teachings, in a ruin of theirs.",
		journalId: "5vFbBIn18TKtCF91",
		page: `${BOOK_II} p.486`,
		kind: "Fortress-monastery",
		size: "hamlet",
		headcount: "~25 to 75 souls",
		population: 0,
		prosperity: 0,
		defenses: 2,
		tradeWith: [
			{ partner: "Nearby farm valleys", goods: "food, livestock, wool", slug: "" },
		],
		resources: [
			{ name: "Tithes from nearby farm valleys", detail: "" },
			{ name: "Terraced gardens", detail: "barley, lentils" },
			{ name: "Livestock", detail: "goats, sheep, milk, meat" },
			{ name: "Fine wool", detail: "" },
			{ name: "Parchment, vellum, ink", detail: "" },
			{ name: "Trades", detail: "bronze-smithing, weaving, dyeing, tanning, scribing, etc." },
			{ name: "Rime Lord artifacts", detail: "" },
		],
		fortifications: [
			{ name: "Guardians", detail: "" },
			{ name: "At least one adept", detail: "" },
			{ name: "One or more tulpas", detail: "" },
			{ name: "Weapons/armor of bronze, maybe dark ice", detail: "" },
			{ name: "Defensible position", detail: "" },
		],
		setupNote: "Create the adept who presides over the monks. Pick or roll what the neighbors say they are, a feature, up to 3 things true of everyone or no one here, and a trait (the tables on pp.484-486).",
	},
	{
		id: "thraulgwyn-band",
		label: "Thraulgwyn tribal band",
		icon: "fa-skull",
		hint: "Pale cannibals of the Labyrinth, each band sworn to a Thing Below.",
		journalId: "v4slCO5mFJLcZO1q",
		page: `${BOOK_II} p.248`,
		kind: "Tribal band",
		size: "hamlet",
		headcount: "~25 to 75 souls",
		population: 0,
		prosperity: -1,
		defenses: 0,
		statRanges: { population: "-1 to +1", prosperity: "not printed; its Trade & Barter uses -1" },
		tradeWith: [],
		resources: [
			{ name: "Gathering", detail: "fungus, fish, water" },
			{ name: "Farming", detail: "fungus, grubs, bugs" },
			{ name: "Scavenging", detail: "Forge Lord sites" },
			{ name: "Raiding", detail: "neighboring tribes" },
			{ name: "Cannibalism", detail: "" },
		],
		fortifications: [
			{ name: "Warlike culture", detail: "" },
			{ name: "Bone clubs/spears tipped with obsidian", detail: "" },
			{ name: "Corrupted gifts", detail: "" },
			{ name: "Magical artifacts", detail: "" },
		],
		setupNote: "Pick the Thing Below they worship, then pick or roll its gift and mark, an asset and a quirk, and 1d6 Barrow Builder artifacts (the tables on the same page).",
	},
];

/** A template by id, or null. */
export function settlementTemplate(id) {
	return SETTLEMENT_TEMPLATES.find(t => t.id === id) ?? null;
}
