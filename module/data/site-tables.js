// The Book II site-generation tables, plus the Book I prompts that drive the
// Create-a-Site walkthrough ("Creating sites", Book I pp. 355-370).
//
// Book I tells you to decide what MANNER of site you're making, then go to the "Sites"
// section of the matching Book II entry and use the procedures and tables there. Every
// one of those entries is a short stack of pick-or-roll tables in the same shape, so they
// are all encoded here as one list of "manners", each carrying its own ordered tables.
//
// A few manners branch: a Green Lord site is either lingering signs OR a ruin, and a
// Barrow Builder site is a cave, a battlefield, a reclaimed Maker-ruin, or a barrow. The
// row that picks the branch carries `branch`, and the tables that only apply inside that
// branch carry the same `branch`, so `visibleTables()` can show just the ones that matter.
//
// Kept free of Foundry/DOM so the tables and helpers are unit-testable; the wizard wires
// them to controls and folds the picks into a site page. Same shape and intent as
// things-below-tables.js, whose corrupted-site tables this file reuses rather than copies.

import { rollOnTable } from "./artifact-creation-tables.js";
import { SITE_FEATURES, SITE_CAUSES, SITE_SEVERITIES, THEMES as THINGS_BELOW_THEMES } from "./things-below-tables.js";

/**
 * Build a table's rows from compact specs. A plain string takes the next single roll;
 * a `[min, max, text]` tuple takes a span (so a weighted roll reproduces the book's odds)
 * and moves the cursor past it. A 4th tuple element merges extra keys (e.g. `branch`).
 */
function build(specs) {
	let next = 1;
	return specs.map(spec => {
		if (typeof spec === "string") {
			const n = next++;
			return { min: n, max: n, text: spec };
		}
		const [min, max, text, extra] = spec;
		next = max + 1;
		return { min, max, text, ...(extra ?? {}) };
	});
}

/** One pick-or-roll table: `key` identifies the pick, `die` is the book's die. */
const table = (key, label, die, specs, opts = {}) => ({ key, label, die, rows: build(specs), ...opts });

// ── Shared table text ─────────────────────────────────────────────────────────
// Four of the five Maker entries print the same condition ladder; the Tempest Lords
// print it on a d12 with the same wording. Authored once so a fix lands everywhere.
const MAKER_CONDITION_D6 = [
	[1, 2, "Shattered and laid waste by time, war, or vandalism; mostly buried, overgrown, collapsed; its purpose unrecognizable"],
	[3, 4, "Crumbling, largely buried, overgrown, or hidden away"],
	[5, 5, "Buried, overgrown, or hidden, but mostly intact"],
	[6, 6, "Fully visible and strangely well-preserved"],
];
const MAKER_CONDITION_D12 = [
	[1, 4, "Shattered and laid waste by time, disaster, or vandalism; mostly buried, overgrown, collapsed; its purpose unrecognizable"],
	[5, 8, "Crumbling, largely buried, overgrown, or hidden away"],
	[9, 10, "Buried, overgrown, or hidden, but mostly intact"],
	[11, 12, "Fully visible and strangely well-preserved"],
];

// Every Maker entry closes its theme table the same way, and every Maker ruin carries the
// same note about scale.
const GIANT_SIZED = [9, 12, "Sized for giants, and roll 1d8 again"];
export const MAKER_SCALE_NOTE =
	"Most Maker-ruins are sized for giants, people two or even three times as tall as humans, but often with smaller-scale rooms, passages and so forth for their servants.";

// The two-branch site table every Maker entry opens with. Only the odds differ (the Green
// Lords lean towards lingering signs), so the rows are built per entry from this shape.
const makerSiteTable = (signsMax) => table("site", "What kind of site?", "1d6", [
	[1, signsMax, "Lingering signs of their presence and influence", { branch: "signs" }],
	[signsMax + 1, 6, "A ruin", { branch: "ruin" }],
]);

// ── Green Lords (Book II pp. 211-214) ─────────────────────────────────────────
const GREEN_LORDS = {
	id: "greenLord",
	label: "Green Lord site",
	hint: "Tombs, chimerae, grown architecture. Most lie in the Great Wood, Ferrier's Fen and the Foothills.",
	page: "Book II p. 212",
	tables: [
		table("theme", "Theme", "1d12", [
			"Beasts or vermin: bred, changed, or harnessed",
			"Plants and growing things: grandiose and/or unusual",
			"Adaptation/growth/expansion/vitality",
			"Chimerae: creatures with disparate parts, features of other organisms",
			"Tombs, mummification, constructed afterlives",
			"The spirits of the wild, or that which they embody, bound or put to use",
			"Fae servants/rebellion",
			"Corruption by the Things Below, and roll again",
			GIANT_SIZED,
		], { combine: true }),
		makerSiteTable(4),
		table("sign", "Lingering sign", "1d6", [
			"An entity, imprisoned in a strange tree, rune-carved stone, or natural feature",
			"Strange plants",
			"A section of the Broken Roads, unearthed or still barely visible",
			"A spirit of the wild, bound to some useful purpose",
			"Useful or valuable flora growing in abundance",
			"A waystone",
		], { branch: "signs" }),
		table("structure", "Structure", "1d6", [
			"Sprawling compound of \"smaller\" buildings",
			"Single, smaller building",
			"Earth-covered mound",
			"Ancient trees, rooms and structures built into hollows and on crooks",
			"Underground vault(s)",
			"Ziggurat/pyramid/dome",
		], { branch: "ruin" }),
		table("purpose", "Purpose", "1d6", [
			"Dwelling (home, barracks, dormitory, etc.)",
			"Containment (fortress, prison, kennel, menagerie, etc.)",
			"Storage (cellar, vault, warehouse, library, collection, etc.)",
			"Production (workshop, nursery, factory, kitchen, abattoir, etc.)",
			"Esoteric (laboratory, shrine, surgery, etc.)",
			"Tomb (of a Green Lord, their ancestors, their servants, their creations, etc.)",
		], { branch: "ruin" }),
		table("elements", "Architectural elements", "1d6", [
			"Huge slabs of smooth stone (white marble, granite, serpentine) carved with scrollwork and bas reliefs",
			"Moss and lichen, of striking colors, growing in decorative patterns",
			"Amber, agate, geodes, even unworked boulders of interesting shape",
			"Ivory, bone, horn, antler, fur, silk, sometimes fused with or growing from wood or stone",
			"Pillars, arches, or even walls of petrified wood, seemingly grown into shape",
			"Vines and tendrils (often petrified or metal-infused) clinging to surfaces in branching whorls, sigils, and runes",
		], { branch: "ruin", note: MAKER_SCALE_NOTE }),
		table("condition", "Condition", "1d6", [
			[1, 2, "Shattered and laid waste by time, war, or vandalism; mostly buried, submerged, and/or overgrown; its purpose unrecognizable"],
			[3, 4, "Crumbling, largely buried, submerged, and/or overgrown"],
			[5, 5, "Buried, submerged, and/or overgrown, but mostly intact"],
			[6, 6, "Fully visible and strangely well-preserved"],
		], { branch: "ruin" }),
	],
};

// ── Stone Lords (Book II pp. 383-386) ─────────────────────────────────────────
const STONE_LORDS = {
	id: "stoneLord",
	label: "Stone Lord site",
	hint: "Shaped rock, makerglass, things sealed in stone. Most lie in the Steplands, the South Manmarch and the Huffel Peaks.",
	page: "Book II p. 384",
	tables: [
		table("theme", "Theme", "1d12", [
			"Rock and stone: excavated and shaped into grandiose structures",
			"Crystals/gems/makerglass: decorative, practical, or thrumming with power",
			"Songs/resonance/vibrations/echoes: to empower, shape, transform, or destroy",
			"Seals/bindings/things trapped in stone: creatures/spirits/ideas/memories/free will",
			"Constructs/stone given life, or an approximation thereof",
			"Authority/order/hierarchy/tradition",
			"Human servants (slaves?): their corruption by the Things Below, their revolt, the Barrow Builders they became",
			"Bonds broken/seals opened/collapse and chaos/the Things Below set loose",
			GIANT_SIZED,
		], { combine: true }),
		makerSiteTable(3),
		table("sign", "Lingering sign", "1d6", [
			[1, 1, "Something trapped in stone, crystal, or makerglass"],
			[2, 2, "Strange geologies"],
			[3, 4, "Fragments of old construction (stairs, walls, foundations, chimneys), all that's left of once-grand structures"],
			[5, 5, "A stretch of the Makers' Roads, intact or broken but unearthed/barely visible"],
			[6, 6, "A monument, marker, or enigma"],
		], { branch: "signs" }),
		table("structure", "Structure", "1d6", [
			"Tightly packed, human-sized structures/rooms",
			"Single, bunker-like building",
			"Large, open space",
			"Tower, rising/jutting out from a hill/mountain",
			"Chambers/tunnels dug into the sides of cliffs/hills/mountains",
			"Grandiose building of impossible construction",
		], { branch: "ruin" }),
		table("purpose", "Purpose", "1d6", [
			"Dwelling (home, barracks, dormitory, prison, etc.)",
			"Infrastructure (aqueduct, rampart, road, bridge, etc.)",
			"Storage (vault, warehouse, library, museum, etc.)",
			"Production (workshop, factory, mine, farm, etc.)",
			"Esoteric (laboratory, experiment, power source, etc.)",
			"Civic life (agora, theater, shrine, monument, tomb, etc.)",
		], { branch: "ruin" }),
		table("elements", "Architectural elements", "1d6", [
			"Great slabs of marble/granite/limestone/etc., far too big for humans to lift",
			"Seamless stone structures/tunnels, like they were poured or molded that way",
			"Runes carved into stone and shaped out of walls, roads, tunnels, etc.",
			"Crystals/makerglass: catching light/wind, humming/glowing, chiming/gonging",
			"Stones/crystals that emanate emotion/mood/thoughts/memories",
			"Grandiosity of scale, big enough to humble even the Makers",
		], { branch: "ruin", note: MAKER_SCALE_NOTE }),
		table("condition", "Condition", "1d6", MAKER_CONDITION_D6, {
			branch: "ruin",
			note: "Many Stone Lord ruins were reclaimed by the Barrow Builders at some point.",
		}),
	],
};

// ── Forge Lords (Book II pp. 157-161) ─────────────────────────────────────────
const FORGE_LORDS = {
	id: "forgeLord",
	label: "Forge Lord site",
	hint: "Fire, industry and artistry. Most lie in the Huffel Peaks, Gordin's Delve and the western Flats.",
	page: "Book II p. 158",
	tables: [
		table("theme", "Theme", "1d12", [
			"Fire and heat, lava, smoke and embers, ash and cinders",
			"Industry: forges and furnaces, crucibles and kilns, foundries and fuel, mills and mines, and all that they consume/produce",
			"Artistry: inspiration, invention, the pursuit of excellence/beauty/truth",
			"Metal given life: clockwork constructs, spirit-vessels, prosthetics fused to flesh",
			"Weakness burnt away: to create, to transform, to destroy, to purify",
			"Ustrina servants/factions/rivalries/secrets/plots/loyalty/betrayal",
			"Passions enflamed: hunger, lust, envy, greed, obsession, paranoia, and wrath",
			"Cataclysm: eruptions, terror, slaughter, societal collapse, the descent into chaos",
			GIANT_SIZED,
		], { combine: true }),
		makerSiteTable(3),
		table("sign", "Lingering sign", "1d6", [
			"Aftermath of destruction, a scar on the world",
			"Traces of industry from long ago",
			"A fiery spirit, bound to some useful purpose",
			"A monument or marker",
			"A stretch of the Makers' Roads, intact, broken, and/or buried in tuff",
			"A hidden hoard, filled with various treasures",
		], { branch: "signs" }),
		table("structure", "Structure", "1d6", [
			"A cluster of smaller buildings",
			"A single larger building, built around an open courtyard/garden/pool",
			"Large open space",
			"Warren-like structure, many connected rooms/buildings",
			"Tunnel(s)/vault(s) carved into mountain/bedrock",
			"Fortified complex containing a number of the above",
		], { branch: "ruin" }),
		table("purpose", "Purpose", "1d6", [
			"Dwelling (home, manor, barracks, apartments, etc.)",
			"Infrastructure (aqueduct, cistern, bridge, tunnel, fortification, etc.)",
			"Storage (vault, warehouse, treasury, granary, etc.)",
			"Production (smithy, studio, mine, etc.)",
			"Civic life (baths, market, gardens, monument, governance, etc.)",
			"Pleasure (gallery, restaurant, theater, arena, etc.)",
		], { branch: "ruin" }),
		table("elements", "Architectural elements", "1d6", [
			"Domes/arches/columns/arcades",
			"Ceramics and glasswork: mosaics, tile, urns, stained glass, mirrors",
			"Enamel/glaze/gilding/flowing runes",
			"Bricks/marble slabs/carved porphyry",
			"Statues/reliefs (bronze or marble)",
			"Furnaces/crucibles/chimneys/chains/gears",
		], { branch: "ruin", note: MAKER_SCALE_NOTE }),
		table("condition", "Condition", "1d6", [
			[1, 1, "Shattered and laid waste by time, war, or vandalism; mostly buried, overgrown, collapsed; its purpose unrecognizable"],
			[2, 2, "Crumbling, largely buried, overgrown, or hidden away"],
			[3, 4, "Buried, submerged, and/or overgrown, but mostly intact"],
			[5, 6, "Fully visible and strangely well-preserved"],
		], { branch: "ruin" }),
		table("ustrina", "Ustrina presence", "1d6", [
			"A settlement, actively inhabited",
			"Two or more groups, in conflict",
			"Pilgrims/scavengers/wardens/etc.",
			"A settlement, unoccupied/abandoned",
			"Offerings/vandalism/excavations/etc.",
			"None to speak of",
		], { branch: "ruin", note: "If Ustrina are present, or have been, consider rolling 1d6 for a sense of their numbers." }),
	],
};

// ── Rime Lords (Book II pp. 317-320) ──────────────────────────────────────────
const RIME_LORDS = {
	id: "rimeLord",
	label: "Rime Lord site",
	hint: "Ice, stasis and ascetic practice. Most lie in the Whitefang Mountains and the Foothills.",
	page: "Book II p. 318",
	tables: [
		table("theme", "Theme", "1d12", [
			"Ice: shaped into grand and intricate designs",
			"The all-pervasive cold: bone-chilling, shivering, numbing, desperate",
			"Stasis/stillness/silence/permanence/preservation",
			"Ascetic practice: the ruthless perfection of mind/body/will",
			"Chants/gestures/rituals: to focus the will, to tame reality/chaos/entropy",
			"The mind set free: spirit-sight, spirit-walking, thought-crafting",
			"Writing and records: the preservation of the past",
			"Mortal servants/disciples, with their sects, schisms, and rivalries",
			GIANT_SIZED,
		], { combine: true }),
		makerSiteTable(3),
		table("sign", "Lingering sign", "1d6", [
			"Something preserved in ice/cold/stasis",
			"An entity, pacified by the Rime Lords or their disciples",
			"Fragments of old construction (roads, stairs, walls, foundations, chimneys, etc.), built by their disciples, barely visible after centuries of wind, snow, and ice",
			"A thoughtform: an object, sensation, or vignette of manifest will",
			"A monument, or marker",
			"A formation of dark ice",
		], { branch: "signs" }),
		table("structure", "Structure", "1d6", [
			"Terraced compound of smaller buildings",
			"Single, block-like building",
			"Large, open space",
			"Natural cavern(s), partially worked/carved",
			"Chambers dug into the stone itself",
			"Dome/hall/tower",
		], { branch: "ruin" }),
		table("purpose", "Purpose", "1d6", [
			"Dwelling (home, dormitory, barracks, etc.)",
			"Infrastructure (stepwell, aqueduct, road, bridge, etc.)",
			"Storage (cellar, vault, library, granary, cemetery, etc.)",
			"Production (workshop, kitchen, farm, abattoir, mine, etc.)",
			"Fortification (wall, rampart, gatehouse, tower, etc.)",
			"Study/practice (shrine, meditation chamber, prayer hall, training hall, etc.)",
		], { branch: "ruin" }),
		table("elements", "Architectural elements", "1d6", [
			"Trapezoidal building(s), prominent eaves, windows on upper stories",
			"Elaborate decorations: geometric/crystalline patterns, glyphs, carvings of spirits/monsters/teachers",
			"Walls/floors/ceilings of dark ice, perhaps in impossible shapes",
			"Statues formed of ice/snow/sand/gravel, held in stasis",
			"Large, empty, spacious places",
			"Sound and light behaving strangely (endlessly echoing/reflecting, emanating from nowhere, strangely muffled/dimmed, changing/warping, etc.)",
		], { branch: "ruin", note: MAKER_SCALE_NOTE }),
		table("condition", "Condition", "1d6", MAKER_CONDITION_D6, { branch: "ruin" }),
	],
};

// ── Tempest Lords (Book II pp. 399-402) ───────────────────────────────────────
const TEMPEST_LORDS = {
	id: "tempestLord",
	label: "Tempest Lord site",
	hint: "Storms, sky-islands and aetherium. Most lie along the Dread River and the Flats, but their sky-islands flew far and wide.",
	page: "Book II p. 400",
	tables: [
		table("theme", "Theme", "1d12", [
			"Elemental forces and primordial power: wielded and harnessed, perhaps imperfectly",
			"Storms: thunder and lightning, wrath and fury, power unleashed",
			"The heavens: weather and clouds, sky-islands, stars and celestial bodies",
			"Sailing: seas and ships, navigation and exploration",
			"Machines and devices, aetherium and stored energy",
			"Curiosity/experimentation/invention/hubris",
			"Loss of control: unexpected consequences/berserk rage/cataclysmic failure/experiments run amok",
			"An empire collapsed: conquering armies, colonies, plunder, lost glory, resentment",
			GIANT_SIZED,
		], { combine: true }),
		makerSiteTable(3),
		table("sign", "Lingering sign", "1d6", [
			[1, 1, "A place bearing scars of unchecked power"],
			[2, 2, "Fragments of a ship or sky-island"],
			[3, 4, "Enigmatic structures"],
			[5, 5, "An elemental spirit of sky, storm, weather, etc.; bound and tethered"],
			[6, 6, "Ruins of other Makers or the Barrow Builders: blasted, shattered, vitrified"],
		], { branch: "signs" }),
		table("structure", "Structure", "1d12", [
			[1, 2, "Cluster of smaller buildings around some central feature"],
			[3, 3, "Single, larger building (block, dome, ziggurat, etc.)"],
			[4, 4, "Bunker/vault carved into the stone"],
			[5, 5, "Platform/amphitheater/terrace(s)"],
			[6, 6, "Tower/spire"],
			[7, 9, "Sky-island, crashed/grounded (and roll 1d6 again)"],
			[10, 11, "Sky-island, afloat but anchored/fixed over a particular place (and roll 1d6 again)"],
			[12, 12, "Sky-island, free-floating across the landscape (and roll 1d6 again)"],
		], { branch: "ruin" }),
		table("purpose", "Purpose", "1d12", [
			[1, 2, "Dwelling (home, barracks, dormitory, etc.)"],
			[3, 4, "Infrastructure (cistern, sewer, lighthouse, harbor, etc.)"],
			[5, 6, "Storage (vault, batteries, warehouse, library, museum, etc.)"],
			[7, 8, "Production (generator, workshop, shipworks, factory, farm, etc.)"],
			[9, 10, "Study/experimentation (laboratory, observatory, orrery, etc.)"],
			[11, 12, "Enigma (magical device, artistic endeavor, etc.)"],
		], { branch: "ruin" }),
		table("elements", "Architectural elements", "1d12", [
			[1, 2, "Metal beams/cables/lattices/trusses"],
			[3, 4, "Open spaces: shafts, atriums, vaulted ceilings, overlooks, windows, skylights"],
			[5, 6, "Lines of power: aetherium inlays, runes, conduits, nodes, currents"],
			[7, 8, "Stylized mosaics/statuary: geometric patterns, fractals, celestial bodies, angelic beings, ships"],
			[9, 10, "Brass fixtures, pipes and pumps, water and steam, gears and flywheels"],
			[11, 12, "Verticality: standing stones, menhirs, obelisks, towers, spires, masts"],
		], { branch: "ruin", note: MAKER_SCALE_NOTE }),
		table("condition", "Condition", "1d12", MAKER_CONDITION_D12, { branch: "ruin" }),
	],
};

// ── The Makers, in general (Book II p. 266) ───────────────────────────────────
// Not a site generator of its own: it tells you WHICH Makers left the ruin, based on
// where it sits. Roll here first when a Maker-ruin's builders are still open.
const MAKERS = {
	id: "makers",
	label: "A Maker-ruin (unsure whose)",
	hint: "Roll for which Makers left it, based on where it sits, then build it from that entry's tables.",
	page: "Book II p. 266",
	tables: [
		table("makers", "Makers & site locations", "1d6", [
			"The Forge Lords: the Huffel Peaks, Gordin's Delve, the western edge of the Flats",
			"The Green Lords: the Great Wood, Ferrier's Fen, the Foothills",
			"The Rime Lords: the Whitefang Mountains, the Foothills",
			"The Stone Lords: the Steplands, the South Manmarch, the south arm of the Huffel Peaks, the southern edge of the Flats",
			"The Tempest Lords: along the Dread River, the Flats, the Ruined Tower, anywhere you want (their sky-islands flew far and wide)",
			"Multiple Makers: along the Makers' Roads, along the Dread River, along borders between regions",
		]),
	],
};

// ── Barrow Builders (Book II pp. 35-39) ───────────────────────────────────────
const BARROW_BUILDERS = {
	id: "barrowBuilder",
	label: "Barrow Builder site",
	hint: "Revolt, sorcery and blood magic. Most lie in the Steplands (Blackwater Lake, Three Coven Lake), the Flats, the South Manmarch and along the Dread River.",
	page: "Book II p. 36",
	tables: [
		table("theme", "Theme", "1d12", [
			"Revolution: hunting down the Stone Lords, upending the status quo",
			"The works of the Makers: torn down, vandalized, repurposed, lost",
			"Societal collapse: famine, shortage, hoarding, violence",
			"Sorcerers and necromancers: recklessly wielding power they can't control",
			"Human sacrifice, blood magic, the courting and open worship of the Things Below",
			"The horrors of war: pillaging, looting, slaughter, dislocation",
			"Refugees, desperate and afraid, seeking safety, settling for survival",
			"Sorcerer-kings and petty warlords with their grand, bloody ambitions",
			"Conquest/oppression/enslavement",
			"Intrigue/betrayal/civil war",
			"Rulers clinging to power, even from the grave",
			"Heroism and hope and perseverance, the casting off of tyrants, the slaying of monsters; the forging of a new age",
		], { combine: true }),
		table("site", "What kind of site?", "1d6", [
			[1, 1, "A cave, in which they or their victims lived/hid/died/were interred (combine with 1 or 2 themes)"],
			[2, 2, "An old battlefield or mass grave, likely haunted"],
			[3, 4, "A reclaimed Maker-ruin", { branch: "reclaimed" }],
			[5, 6, "A barrow", { branch: "barrow" }],
		]),
		table("origin", "Reclaimed from", "1d12", [
			[1, 1, "A Green Lord ruin"],
			[2, 2, "A Rime Lord ruin"],
			[3, 4, "A Tempest Lord ruin"],
			[5, 6, "A Forge Lord ruin"],
			[7, 10, "A Stone Lord ruin"],
			[11, 12, "A ruin of multiple groups (roll 1d10 twice)"],
		], {
			branch: "reclaimed",
			note: "Build the ruin from that entry's tables, rolling with advantage for its condition at the time the Barrow Builders claimed it.",
		}),
		table("signs", "Signs of their presence", "1d12", [
			[1, 2, "Ghosts/psychic imprints"],
			[3, 4, "Remains/bones/graves/memorials"],
			[5, 6, "Damage/plunder/vandalism/graffiti"],
			[7, 8, "Distinctive material culture: refuse/pottery/tools/art/statuary/textiles/etc."],
			[9, 10, "Crude, human-sized additions/adaptations/repairs"],
			[11, 11, "Altars/idols/offerings/arcane symbols"],
			[12, 12, "Maker artifacts, repurposed"],
		], { branch: "reclaimed", note: "Pick or roll 1 to 3 signs." }),
		table("reclaimedCondition", "Current condition", "1d12", MAKER_CONDITION_D12, { branch: "reclaimed" }),
		table("size", "Size", "1d12", [
			[1, 4, "Small: just a few paces across, no chambers to speak of"],
			[5, 8, "Medium: big as a house, a few cramped halls/chambers"],
			[9, 12, "Large: a manmade hill, riddled with chambers/passages"],
		], { branch: "barrow" }),
		table("barrowPurpose", "Purpose", "1d12", [
			[1, 3, "To honor the interred"],
			[4, 6, "To bind/torment the interred"],
			[7, 7, "To protect the interred"],
			[8, 9, "To hide something away"],
			[10, 10, "To leverage/maintain fell magic"],
			[11, 12, "Roll 1d10, twice"],
		], { branch: "barrow" }),
		table("barrowElements", "Architectural elements", "1d12", [
			[1, 2, "Megalith(s)/cairn(s)/dolmen(s)"],
			[3, 4, "Obvious entrance (likely sealed)"],
			[5, 6, "Irregular/elaborate/oval shape"],
			[7, 8, "Works of the Makers, recycled"],
			[9, 10, "Walls of dry-stacked stones"],
			[11, 12, "Built around a spring: water bubbling up/pooling/flowing out"],
		], {
			branch: "barrow",
			note: "Even in large barrows, chambers and passages are cramped and claustrophobic, often with packed-dirt floors and lined with large slabs of stone. Pick or roll 1 or 2.",
		}),
		table("barrowCondition", "Condition", "1d12", [
			[1, 4, "Collapsed, torn open, only hints remaining"],
			[5, 6, "Partially collapsed or torn open, but largely intact"],
			[7, 10, "Mostly intact, but overgrown or partly buried; easy to miss"],
			[11, 12, "Strangely intact, fully visible"],
		], { branch: "barrow" }),
		table("feature", "Feature", "1d12", [
			[1, 2, "Haunted, marked by dool trees"],
			[3, 4, "Corrupted by the Things Below"],
			[5, 5, "Protective spirit(s)/construct(s)/demon(s)/spell(s)/trap(s)"],
			[6, 6, "Connects to caves"],
			[7, 7, "Inhabited by local beasts/bandits"],
			[8, 8, "Useful or valuable flora growing on/in/near it"],
			[9, 10, "Treasure (roll 1d6 to inform how much remains)"],
			[11, 12, "Roll again, twice"],
		], { branch: "barrow" }),
	],
};

// ── Haunted sites (Book II pp. 68-73) ─────────────────────────────────────────
const HAUNTED = {
	id: "haunted",
	label: "Haunted site",
	hint: "Where the undead linger, or the Last Door stands ajar. Combine the terrain it sits in with a feature.",
	page: "Book II p. 72",
	tables: [
		table("feature", "Feature", "1d12", [
			[1, 3, "A creepy (un)natural landmark (a dool tree, a skull-shaped rock, etc.)"],
			[4, 5, "A liminal place (a pass, a bridge, a tunnel, a gate, a crossroad, etc.)"],
			[6, 8, "A tomb/barrow/cemetery, left by the locals or their ancestors"],
			[9, 10, "An abandoned home/fort/steading"],
			[11, 12, "A ruin of the Makers or the Barrow Builders, or a lingering sign of their presence"],
		], { note: "Skip this if the site's physical nature is already established." }),
		table("theme", "Theme", "1d12", [
			"Death personified: the Lady of Crows, the Pale Hunter, other gods/spirits of death",
			"The Last Door/brushes with death/the afterlife/things from beyond",
			"Graves/funeral rites/grief/mourning",
			"Death foretold: prophecies, omens, visions, harbingers",
			"Good death: peaceful, dignified, bravely met, an end of suffering",
			"Ignoble death: traumatic, desperate, torturous, terrifying",
			"Untimely death: sudden, surprising, things left unsaid or undone",
			"Violent death: murder, assassination, execution, battle, suicide",
			"Mass death: famine, plague, war, cataclysm, collapse",
			"The fear of death: denial, bargaining, panic, cheating",
			"The curse of undeath: respite denied, eternal hunger/pain/loneliness/regret",
			"Necromancy and death-magic, likely with aid from the Things Below",
		], { combine: true }),
		table("howLong", "How long it's been haunted", "1d12", [
			[1, 1, "Since the days of the Makers, at least"],
			[2, 3, "Since the Time of Cataclysm, when the Makers fell"],
			[4, 5, "Since the Barrow Builders, after the Makers' fall"],
			[6, 7, "For generations, longer than the living remember"],
			[8, 9, "For decades, within living memory"],
			[10, 11, "For the past decade at most"],
			[12, 12, "Not long at all, a recent change"],
		]),
		table("origins", "Origins of the haunting", "1d12", [
			[1, 2, "The death of many, all at once"],
			[3, 3, "The death of many, over time"],
			[4, 4, "The death of a few, intimate and intense"],
			[5, 6, "The death of one, a singular event"],
			[7, 7, "The desecration/violation of a grave"],
			[8, 8, "The arrival of an artifact or tether"],
			[9, 9, "Something about the place itself, attracting/ensnaring dark entities"],
			[10, 10, "A ritual, magic, or artifice: failed or run amok"],
			[11, 11, "A ritual, magic, or artifice: working as intended"],
			[12, 12, "The loss or failure of an artifact/ward/binding that kept the dead in check"],
		]),
		table("causeOfDeath", "Cause of death", "1d12", [
			[1, 1, "Old age/infirmity/malady/disease"],
			[2, 3, "Suicide/despair/apathy/upset"],
			[4, 5, "Exposure/cold/thirst/starvation"],
			[6, 7, "Injury/trauma/wounds/poison"],
			[8, 9, "Burning/drowning/suffocation"],
			[10, 10, "Falling/accident/weather/disaster"],
			[11, 11, "Exertion/exhaustion/shock/fright"],
			[12, 12, "Magic/an entity/a curse"],
		], { note: "Only if the origins involved a death or deaths." }),
	],
};

// ── Fae domains (Book II pp. 95, 102-103) ─────────────────────────────────────
const FAE_DOMAIN = {
	id: "faeDomain",
	label: "Fae domain",
	hint: "A hidden reality between the physical and spirit worlds. Start with the real-world terrain it borders or overlaps.",
	page: "Book II p. 102",
	tables: [
		table("entrance", "Entrance", "1d6", [
			"A shimmer, a feeling, little more",
			"Megalith(s)/a waystone",
			"A door/gate/opening, natural or made, literal or just an impression",
			"A ring of toadstools or some other distinctive pattern of flora (perhaps useful or valuable)",
			"A path/a climb/a descent/a fall",
			"Only active at certain times (in moonlight, at sunset, in winter, etc.) and roll again",
		], { note: "An entrance in the Great Wood at least 10 years old is likely marked by Forest Folk glyphs." }),
		table("theme", "Theme", "1d12", [
			"Fluidity of time and space: stasis, distortion, dilation, things where (and when) they oughtn't be",
			"Enchantment, dreams and dream-logic, the odd accepted as normal",
			"Illusion/glamour, often hiding a base or even sordid reality",
			"The intangible made real; metaphor made literal",
			"Promises, deals, and loopholes; debts and insults weighing heavy as iron chains",
			"Opaque etiquette, strange norms, values upended, seeming amorality",
			"Passions, whims, and excess; the autonomy of others ignored",
			"Extremes of beauty/ugliness, blurred lines between them",
			"Malleability of one's looks, one's identity, one's true and secret heart",
			"Liminality: neither spirit nor flesh, here nor there, this nor that, real nor unreal",
			"Deep ties to the natural world and spirits of the wild",
			"Enslavement by the Green Lords, the war against them, the lasting scars left by both",
		], { combine: true }),
		table("purpose", "Original purpose", "1d6", [
			"Containment: to imprison/preserve",
			"Habitat: where Fae live/work/play",
			"Community: a place to gather, trade, gossip, show off, travel",
			"Status: a monument, a place to impose, someone showing off",
			"Creativity: an expression, an exploration, a work of art",
			"Pleasure: a paradise, a retreat, a false afterlife, a playground",
		]),
		table("anchor", "Anchor", "1d6", [
			"The will of a single potent Fae",
			"The instinct or intent of multiple Fae, dwelling (trapped?) within",
			"A shard of power left by a powerful Fae, buried or hidden away",
			"One or more Fae, bound/inert, their essence sunk into the domain",
			"Rune-carved stone infused with Fae power, a work of the Green Lords",
			"Roll again, but it's failing, fickle, unstable, possibly abandoned",
		]),
		table("element", "Element", "1d6", [
			"Exit(s) to Fae paths or far-off place(s) in the world",
			"Surreal landscapes: a forest cave, an underwater kingdom, a castle in the clouds, a tiny place made large, a mundane place made giant, etc.",
			"\"Civilized\" things, out of place: a feast hall in a mire, a house carved from a tree, a library in a cave, etc.",
			"A real place, plucked from the world and the passing of time",
			"A vast and shifting place, easy to get lost in, always something new",
			"Decay/squalor/disorder, perhaps hidden by glamour or illusion",
		], { note: "Pick or roll 1 or 2. Time dilation is a particular concern to mortal visitors." }),
	],
};

// ── Primordial sites (Book II pp. 298, 304) ───────────────────────────────────
const PRIMORDIAL = {
	id: "primordial",
	label: "Site of primordial power",
	hint: "A place marked or marred by primordial power. Combine the terrain it sits in with a marker.",
	page: "Book II p. 304",
	tables: [
		table("marker", "Marker", "1d12", [
			[1, 1, "A veil, hiding it from the world"],
			[2, 3, "Dramatic geology (a peak, a crater, a rift, a geyser, etc.)"],
			[4, 4, "Desolation/radiation"],
			[5, 5, "Remains of a titan"],
			[6, 7, "Megalith(s)/petroglyphs/runes/cave paintings/etc."],
			[8, 9, "Ruin(s) of the Makers, built near or around it"],
			[10, 10, "Mysterious structure(s), placed by primordial entities"],
			[11, 12, "Roll 1d10 twice and combine"],
		]),
		table("theme", "Theme", "1d12", [
			"Vastness, enormity, incomprehensibility, the primordial void",
			"Truth, purity, quintessence, the raw stuff of creation",
			"Fundamental forces: order, chaos, time, space, gravity, light, death, etc.",
			"The spirit world: consciousness, symbols and thought, the connection of all things",
			"True names, words of power, speech that transcends language",
			"Celestial bodies: their movements, their mysteries, their influence on the world",
			"Paradox: destiny and free will, causal loops, infinity, mutually exclusive truths",
			"Natural forces and the shaping of the world: slow and subtle, violent and cataclysmic",
			"The binding of the Things Below",
			"Mythic times and mythic deeds, the birth and death of gods and legends",
			"Long-forgotten peoples/beings, from before the rise of the Makers",
			"Portals, possibilities, other worlds, beings/things out of time and space",
		], { combine: true }),
		table("origin", "Origin", "1d12", [
			[1, 2, "The intent of a (the) great spirit(s)"],
			[3, 4, "A confluence of geomantic/cosmic/celestial forces"],
			[5, 6, "A conflict between mythic beings"],
			[7, 8, "The death of a primordial entity"],
			[9, 10, "The presence of a primordial artifact"],
			[11, 12, "The working (successful or not) of a potent spell or artifice"],
		]),
		table("features", "Feature", "1d12", [
			"An archon, watching over it or what it contains",
			"A trapped primordial entity or emanation",
			"An abundance of certain spirits",
			"The shade of a dead god or primordial entity, easily called up",
			"Anomalies (time loops or fluxes, spatial warps, weird gravity, thoughts projected out loud, etc.)",
			"A thin barrier with the spirit world",
			"A portal, or a place with the potential for one",
			"A font of power; a good place to work particular types of magic",
			"Visions/omens/prophecies/insights, sometimes bestowed on visitors",
			"Useful or valuable flora, something weird, found only here",
			"The raw stuff of creation: black iron, water of life, primordial flame, etc.",
			"One or more artifacts of primordial power",
		], {
			note: "Pick or roll 1 to 3. If the site lies near places that are or were populated, consider the locals' attitude to it (reverence, awe, terror, avoidance) and what signs they left.",
		}),
	],
};

// ── Sacred sites (Book II pp. 357, 361) ───────────────────────────────────────
const SACRED = {
	id: "sacred",
	label: "Sacred site",
	hint: "Where spirits of the wild are tethered, or tend to be active. Roll the Die of Fate for the spirits' relative power.",
	page: "Book II p. 361",
	tables: [
		table("theme", "Theme (the spirits' nature)", "1d12", [
			"Trees/plants/flora/growing things",
			"Beasts/vermin/fauna",
			"Air/wind/weather/fire",
			"Spring/birth/fertility/sex/healing",
			"Summer/heat/growth/vitality",
			"Autumn/harvest/sustenance/plenty",
			"Winter/cold/hunger/sleep/death",
			"Savagery/the hunt/dominance",
			"Nurture/shelter/provision",
			"The land/soil/stone/terrain",
			"Blight/decay/reclamation/destruction",
			"Water/streams/ponds/lakes (possibly corrupted by the Things Below)",
		], { combine: true }),
		table("marker", "Marker", "1d12", [
			[1, 1, "Nothing you can put your finger on, just the sense of being watched"],
			[2, 4, "A place that resonates strongly with the spirit's theme"],
			[5, 6, "A remarkable natural feature, particularly large/beautiful/ancient/etc."],
			[7, 8, "An unusual feature, probably natural but strange or out of place"],
			[9, 9, "An idol or altar, ancient and crumbling/buried/submerged"],
			[10, 10, "An idol or altar, made by the locals"],
			[11, 12, "Roll twice with a 1d10, combine"],
		]),
		table("activity", "Activity", "1d12", [
			[1, 1, "Missing, dissipated, greatly weakened"],
			[2, 2, "Imprisoned, probably seeking release"],
			[3, 4, "Slumbering, waiting for something"],
			[5, 6, "Sporadic, often slumbering or away"],
			[7, 9, "Alert, aware, unlikely to manifest"],
			[10, 12, "Alert, aware, manifesting freely"],
		]),
		table("disposition", "Disposition", "1d12", [
			[1, 2, "Dangerous, possibly corrupted by the Things Below"],
			[3, 4, "Vengeful, grumpy, protective, angry at intrusion"],
			[5, 6, "Plaintive, needful, wronged, demanding"],
			[7, 8, "Aloof, shy, dismissive, has their own concerns"],
			[9, 10, "Curious, playful, mischievous, friendly"],
			[11, 12, "Content, pleasant, helpful, beneficent"],
		]),
	],
};

// ── Caves (Book II pp. 380-381) ───────────────────────────────────────────────
// The Steplands entry's cave generator, but caves are caves: use it anywhere.
const CAVE = {
	id: "cave",
	label: "Cave",
	hint: "Carved by the slow patient work of water, or more dramatically by Stone Lord magic. Roll clearance, footing, water and decoration per opening, passage or chamber.",
	page: "Book II p. 380",
	tables: [
		table("structure", "Structure", "1d6", [
			"Small, contained, only a few chambers",
			"Long, narrow, meandering",
			"Twisting, interlaced tunnels; multiple chambers",
			"A few distinct sets of chambers, connected by long twisting tunnels",
			"Few small passages to a larger, massive chamber",
			"Large and open main tunnel, smaller side passages and chambers",
		]),
		table("clearance", "Clearance", "1d6", [
			[1, 1, "Basically a crack, too small for grown humans without excavation"],
			[2, 2, "A squeeze: most folk can wriggle through without gear on"],
			[3, 4, "Small, cramped: might need to duck, crawl, go single file"],
			[5, 5, "Roomy, comfortable to walk through"],
			[6, 6, "Yawning, vast, lots of space"],
		]),
		table("footing", "Footing", "1d6", [
			"Steep slope, vertical ascent/descent",
			"Slippery: water, mud, scree, guano, etc.",
			"Rocky, debris-filled, unstable",
			"Uneven, ridged, potholes, awkward",
			"Rolling, undulating, twisting",
			"Surprisingly smooth, level",
		]),
		table("water", "Water", "1d6", [
			[1, 1, "Submerged"],
			[2, 2, "Partially flooded"],
			[3, 3, "A stream or rivulet, flowing steadily"],
			[4, 6, "Just a trickle, drips, or seepage; maybe not even that"],
		]),
		table("decoration", "Decoration", "1d6", [
			"Stalactite(s) or soda straws, clinging tight to the ceiling",
			"Stalagmite(s), growing from the floor",
			"Column(s), where stalactites and stalagmites have grown together",
			"Crystals, crystalline growths, \"honeycomb\" patterns",
			"Flowstone, rimstone, \"draperies,\" \"shields\"",
			"Fossils",
		]),
		table("inhabitant", "Inhabitants, past or present", "1d6", [
			"Thralls or victims of the Things Below",
			"Barrow Builders or their victims",
			"Truly ancient primordial powers",
			"A natural beast or spirit",
			"Stone Lords or their servants",
			"Hillfolk or those they have cast out",
		], { note: "Pick or roll up to 3 times. What story does this tell?" }),
		table("beast", "Natural beast or spirit", "1d6", [
			"Bats. So many bats",
			"Fish, salamanders, olms, crawfish: pale blind things dwelling in dark waters",
			"Cave bears, a kleztigr, or similar large beast, making its den here",
			"Grochslon, or some other subterranean predator",
			"Spirit, bound to or happily dwelling in this sacred site",
			"A malicious spirit, like a troelloff",
		]),
		table("discovery", "Discovery", "1d6", [
			[1, 1, "Connection to another cave system"],
			[2, 2, "A chance for insight into a threat or danger (tracks that reveal numbers, whereabouts, etc.)"],
			[3, 5, "Signs of a (prior) inhabitant, like a site, artifact(s), or remains"],
			[6, 6, "A relatively good place to rest/hide"],
		]),
	],
};

// ── Forest Folk (Book II p. 152) ──────────────────────────────────────────────
const FOREST_FOLK = {
	id: "forestFolk",
	label: "Forest Folk site",
	hint: "In the Great Wood. Consider combining it with another point of interest from that region.",
	page: "Book II p. 152",
	tables: [
		table("site", "A place where they...", "1d6", [
			"...stood guard over something",
			"...fought/died/interred their dead",
			"...performed rituals/communed with spirits/worked magic",
			"...dwelt/worked/made things/stored things",
			"...gathered/congregated/held festivals",
			"...left signs of what happened to them",
		], { note: "Pick 1 or combine 2." }),
		table("signs", "Signs of their presence", "1d6", [
			"Elaborate glyphs and pictograms",
			"Strips of leather, often dyed, hanging from trees or wrapped around trunks",
			"Tools/weapons of stone, wood, bone: adzes, scrapers, arrowheads, spears, etc.",
			"Containers of carved wood, cured leather, woven plant fiber",
			"Clothes (leather, fur, woven plants), likely in tatters",
			"Bones/remains, of them and/or their prey",
		]),
	],
};

// ── Corrupted sites (Book II p. 422) ──────────────────────────────────────────
// Built from the Things Below tables rather than copied, so the corrupted-site wizard
// and this one can never drift. A corrupted site written up as a threat (with a doom
// track seeded from its severity) is still the Create a Corrupted Site flow.
const CORRUPTED = {
	id: "corrupted",
	label: "Corrupted site",
	hint: "A place the Things Below have taken hold of. To write it up as a threat with an impending doom instead, use Create a Corrupted Site.",
	page: "Book II p. 422",
	tables: [
		{ key: "feature", label: "Feature", die: "1d12", rows: SITE_FEATURES },
		{ key: "theme", label: "Theme of the taint", die: "1d12", combine: true, rows: THINGS_BELOW_THEMES },
		{ key: "cause", label: "Cause of corruption", die: "1d12", rows: SITE_CAUSES },
		{ key: "severity", label: "Severity", die: "1d12", rows: SITE_SEVERITIES },
	],
};

/** Every manner of site, in the order the wizard offers them. */
export const SITE_MANNERS = [
	GREEN_LORDS, STONE_LORDS, FORGE_LORDS, RIME_LORDS, TEMPEST_LORDS, MAKERS,
	BARROW_BUILDERS, HAUNTED, FAE_DOMAIN, PRIMORDIAL, SACRED, CAVE, FOREST_FOLK, CORRUPTED,
];

/** Resolve a manner by id, or null. */
export function siteManner(id) {
	return SITE_MANNERS.find(m => m.id === id) ?? null;
}

/**
 * The tables of `manner` that apply given the picks so far. A manner with a branching
 * table (Green Lord signs vs ruin, Barrow Builder barrow vs reclaimed ruin) hides the
 * tables of the branches not taken; with nothing picked yet, only the unbranched tables show.
 * @param {object|string} manner  a manner or its id
 * @param {Record<string,string>} picks  {tableKey: chosen row text}
 */
export function visibleTables(manner, picks = {}) {
	const m = typeof manner === "string" ? siteManner(manner) : manner;
	if (!m) return [];
	// The branch a picked row selects, if any table's chosen row names one.
	let branch = null;
	for (const t of m.tables) {
		const chosen = t.rows.find(r => r.text === picks[t.key]);
		if (chosen?.branch) { branch = chosen.branch; break; }
	}
	return m.tables.filter(t => !t.branch || t.branch === branch);
}

/**
 * The picks as ordered `{key, label, value}` rows for the site page, dropping blanks and
 * anything belonging to a branch that isn't taken. `key` is the table's own id, so the
 * editor can put a stored pick back on its control without matching display labels.
 */
export function pickLines(manner, picks = {}) {
	return visibleTables(manner, picks)
		.map(t => ({ key: t.key, label: t.label, value: String(picks[t.key] ?? "").trim() }))
		.filter(p => p.value);
}

// ── Regional terrain (Book II, each region's "Terrain" table) ─────────────────
// Book I's procedure says to place the site in an appropriate terrain, so every region
// with a terrain table is offered here. Roll or pick 1, or combine 2.
export const REGIONS = [
	{
		id: "greatWood", label: "The Great Wood", page: "Book II p. 202",
		terrain: build([
			"Pond, wetland, or lake",
			"Creek, stream, or river",
			"Rocky outcropping, cave(s)",
			[4, 5, "Clearing, meadow, sparse trees"],
			[6, 7, "Dense thicket"],
			[8, 9, "Swath of one type of tree"],
			[10, 10, "Briars, thorns, nettles"],
			[11, 11, "Slope, hill, ridge, ravine"],
			[12, 12, "Single, notable tree"],
		]),
	},
	{
		id: "steplands", label: "The Steplands", page: "Book II p. 372",
		terrain: build([
			"Creek, gulley, stream, river",
			"Stream, disappearing into cave, sinkhole, or fractured bedrock",
			"Sinkhole, crevasse, gorge",
			"Barren patch (sand, scree, rocks)",
			"Copse of pines, gnarled shrubs",
			"Stretch of Broken Roads",
			"Gentle slope, meadow",
			[8, 9, "Steep slope, treacherous, unstable"],
			[10, 10, "Sheer rock face, bluff, rocky outcrop"],
			[11, 12, "Cave"],
		]),
	},
	{
		id: "foothills", label: "The Foothills", page: "Book II p. 144",
		terrain: build([
			"Large pond/small lake",
			"Creek, stream, gulley",
			"Steep slope: barren, treacherous, unstable",
			"Dense thicket/brush",
			[5, 6, "Swath/copse of one type of tree"],
			[7, 8, "Gentle slope or valley"],
			[9, 9, "Steep slope: forested, overgrown"],
			[10, 10, "Sheer rock face, bluff, rocky outcrop"],
			[11, 11, "Clearing, meadow, burn site"],
			[12, 12, "Cave, cavern, grotto"],
		]),
	},
	{
		id: "ferriersFen", label: "Ferrier's Fen", page: "Book II p. 116",
		terrain: build([
			"Open water, who knows how deep?",
			"Shallow pool, pond, or stream",
			[3, 4, "Mud, muck, sodden soil, standing water"],
			[5, 6, "Peat, sphagnum moss, floating mats"],
			[7, 8, "Grass, reeds, sedges, wildflowers"],
			[9, 9, "Shrubs and scattered pines"],
			[10, 10, "Thicket of trees, or one big tree"],
			[11, 11, "Dead tree(s), fallen log(s)"],
			[12, 12, "Hummock, hill, rocky outcrop"],
		]),
		note: "In winter, water and mud might be frozen.",
	},
	{
		id: "flats", label: "The Flats", page: "Book II p. 126",
		terrain: build([
			"Ash field, burnt stalks, recent wildfire",
			"Barren ground: sand, stone, dust",
			"Burrow, dugout, or warren",
			"Sodden soil, mud, or standing water",
			[5, 6, "Dense thicket of tall (5 to 8 foot), stiff stalks"],
			[7, 8, "Open meadow, grass waist-high or shorter"],
			[9, 9, "Low ridge, embankment, rise"],
			[10, 10, "Tree(s), savanna, shrubs"],
			[11, 11, "Rocky outcropping, boulders, jagged stones"],
			[12, 12, "Gully, sinkhole, crater, fissure (maybe full of water)"],
		]),
	},
	{
		id: "huffelPeaks", label: "The Huffel Peaks", page: "Book II p. 236",
		terrain: build([
			"Lava/hot springs/geysers/mudpots/fumaroles",
			"Crater/caldera/lava tubes/volcanic formations",
			"Stream/river/waterfall/lake/boggy soil",
			"Travertines/basalt columns or terraces/fairy chimneys/arches",
			[5, 7, "Sheer rock face/bluff/summit/peak"],
			[8, 9, "Steep slope/switchback trails/ridgeline"],
			[10, 10, "Ravine/canyon/gorge"],
			[11, 11, "Gentle slope/meadow/valley/pass"],
			[12, 12, "Cave, cavern, grotto"],
		]),
	},
	{
		id: "whitefangs", label: "The Whitefang Mountains", page: "Book II p. 480",
		terrain: build([
			[1, 2, "Glacier/snowfield/snowpack"],
			[3, 3, "Lake/river/stream/waterfall"],
			[4, 4, "Waterlogged soil, frozen or muddy"],
			[5, 5, "Forest/woods/stand of trees/shrubs"],
			[6, 6, "Sheer rock face/bluff/escarpment"],
			[7, 7, "Summit/peak/false peak"],
			[8, 9, "Steep slope/switchback trails/ridgeline"],
			[10, 10, "Ravine/canyon/gorge"],
			[11, 11, "Gentle slope/meadow/valley/pass"],
			[12, 12, "Cave/cavern/grotto"],
		]),
	},
	{
		id: "northManmarch", label: "The North Manmarch", page: "Book II p. 286",
		terrain: build([
			"Spring/pond/creek/stream",
			"Ditch/wash/gully/ravine",
			"Copse/thicket/grove of trees",
			"Steep slope/rocky outcrop/large hill",
			"Gentle slope/low ridge/small hill",
			[6, 7, "Open meadow, grass waist-high or shorter"],
			[8, 8, "Footpath/wagon ruts/trail"],
			[9, 10, "Farmland/pasture"],
			[11, 11, "Fence/low wall/embankment"],
			[12, 12, "Hamlet/hillfort/isolated longhouse"],
		]),
	},
	{
		id: "southManmarch", label: "The South Manmarch", page: "Book II p. 350",
		terrain: build([
			"Ash field/barrens/sand/rocky stretch",
			"Burrow/dugout/warren",
			"Sodden soil/mud/pocket wetland",
			"Spring/pond/creek/stream/river",
			[5, 6, "Open meadow, waist-high grass"],
			[7, 8, "Shortgrass prairie, vast and open"],
			[9, 9, "Footpath/wagon ruts/trail"],
			[10, 10, "Tree(s), savanna, thickets"],
			[11, 11, "Gentle slope/low ridge/small hill"],
			[12, 12, "Steep slope/rocky outcrop/large hill"],
		]),
	},
	{
		id: "dreadRiver", label: "The Dread River", page: "Book II p. 86",
		terrain: build([
			"Open water, who knows how deep?",
			"Rocks/eddies/rapids",
			"Waterfall/smaller stream feeding the river",
			"Swamp/drowned trees/logjam",
			[5, 6, "Shallows/marsh/mud/reeds"],
			[7, 8, "Sandbar/beach/shingle/floodplain"],
			[9, 9, "Slope/hill"],
			[10, 10, "Bluff/promontory/rocky outcrop"],
			[11, 11, "Caves"],
			[12, 12, "Island"],
		]),
	},
	{
		id: "blackwaterLake", label: "Blackwater Lake", page: "Book II p. 50",
		terrain: build([
			"Trees/shrubs/succulents/tall grass",
			[2, 3, "Ridge wall/prominence/overhang"],
			[4, 5, "Scree/rubble/rocks/boulders"],
			[6, 7, "A ruin or barrow"],
			[8, 8, "Very large boulder(s)"],
			[9, 9, "Pool/pond/spring/rivulet"],
			[10, 10, "Peninsula/cove/inlet"],
			[11, 11, "Mud/mire/shingle/shallows"],
			[12, 12, "Drop-off/deep water"],
		]),
	},
	{
		id: "threeCovenBluffs", label: "Three Coven Lake (bluffs)", page: "Book II p. 441",
		terrain: build([
			[1, 2, "Cliff/ledge/cleft/crevice"],
			[3, 4, "Scree/rubble/boulders"],
			[5, 6, "Overhang/plateau/outcrop"],
			[7, 8, "Tree(s)/shrub(s)"],
			[9, 9, "Waterfall/pool/travertine"],
			[10, 10, "Barrow"],
			[11, 11, "Walkway/stairs/balcony, carved into the stone"],
			[12, 12, "A Stone Lord site"],
		]),
	},
	{
		id: "threeCovenShore", label: "Three Coven Lake (shoreline)", page: "Book II p. 441",
		terrain: build([
			[1, 2, "Marsh/mire/mudflat"],
			[3, 4, "Beach/shingle/shallows"],
			[5, 6, "Drop-off/strong current/undertow"],
			[7, 8, "Jumble of boulders/rubble"],
			[9, 9, "Barrow"],
			[10, 10, "A Stone Lord site"],
			[11, 11, "Island/sandbar and roll 1d10 again"],
			[12, 12, "Cove/bay/inlet and roll 1d10 again"],
		]),
	},
	{
		id: "frozenWastes", label: "The Frozen Wastes", page: "Book II p. 250",
		terrain: build([
			[1, 1, "Kettle lake, small but dozens or hundreds of feet deep"],
			[2, 3, "Stretch of shallow standing water/ice"],
			[4, 6, "Wide open expanse, just grass and shrub for miles"],
			[7, 8, "Large patch of mud/frozen mud"],
			[9, 9, "Gentle slope/low ridge/small rise"],
			[10, 10, "Low moraine, a small hill of broken stones and loose soil"],
			[11, 11, "Rocky outcrop, a dozen feet tall at most"],
			[12, 12, "Single, notable tree"],
		]),
	},
	{
		id: "labyrinth", label: "The Labyrinth", page: "Book II p. 242",
		terrain: build([
			[1, 2, "Lava tube or magma worm tunnel"],
			[3, 4, "Braided/branching tunnels"],
			[5, 6, "Chamber, cavern, or alcove"],
			[7, 8, "Steps, terraces, ledges"],
			[9, 10, "Forge Lord construction, worked stone passage, or ruin"],
			[11, 12, "An obstruction, and roll 1d10 again"],
		]),
	},
];

/** Resolve a region by id, or null. */
export function region(id) {
	return REGIONS.find(r => r.id === id) ?? null;
}

// ── Book I prompts (pp. 348-369) ──────────────────────────────────────────────
// The walkthrough's checklists and placeholder prompts. Data, not template text, so the
// wizard, the site page and the tests all read one copy.

/** "Environmental storytelling" (p. 348): what a site's story should be able to answer. */
export const SITE_STORY_QUESTIONS = [
	"Who built this place?",
	"How did it fall into ruin or disuse?",
	"Who or what dwells here now?",
	"When and why did they arrive?",
	"What are they up to now?",
	"What else has happened here?",
];

/** "Look for connections" (p. 358): what to connect the site's foundation to. */
export const SITE_CONNECTIONS = [
	"The details you've already established, and each other",
	"Other setting elements in Book II",
	"The setting's timeline (ages of the world)",
	"Things the players are interested in",
	"The PCs, their stuff, and their pasts",
	"Established NPCs and threats",
	"Previous events in-game",
	"The questions on your \"I wonder...\" list",
];

/** "Ask yourself questions" (p. 358): the kinds of question to write down and answer. */
export const SITE_QUESTION_PROMPTS = [
	"What do the connections you've made imply?",
	"What explains an apparent contradiction?",
	"What exactly was this place, specifically?",
	"What caused this? Why here?",
	"How has it changed over time? Who came next?",
	"Who dwells here, what do they want, how do they get on?",
	"How long has this been going on?",
];

/** "Identify dangers & discoveries" (p. 362): what the site's story tends to imply. */
export const SITE_DANGER_KINDS = [
	"Hazards the PCs might need to deal with",
	"Monsters, denizens the PCs might fight",
	"Unstable construction, bad footing, deep water",
	"Wards, traps, guardians",
];

export const SITE_DISCOVERY_KINDS = [
	"Clues, especially ones the PCs need to reach their goals",
	"Other, smaller sites",
	"Non-hostile encounters with the site's denizens",
	"Opportunities",
	"Artifacts and arcana found within",
];

/** "Detail each area/room" (p. 368): what a room write-up wants to hold. */
export const AREA_DETAIL_PROMPTS = [
	"A description of the environment",
	"Impressions from various senses",
	"Questions you might ask the PCs",
	"Contents: NPCs, dangers, discoveries, potential events",
	"Lore, backstory, or explanations",
	"Exits and connections to other areas",
];

/** "Arrange areas/rooms" (p. 366): what makes a site dynamic rather than linear. */
export const SITE_LAYOUT_TIPS = [
	"Multiple paths through the site",
	"Loops, where areas connect to each other from multiple directions",
	"Different levels and sub-levels",
	"Multiple entry/exit points",
	"Hidden, difficult, or dangerous paths",
	"Paths that the site's denizens can use but the PCs can't",
];

/** "Review and revise" (p. 369): the questions a finished write-up should survive. */
export const SITE_REVIEW_CHECKS = [
	"What was it built or used for? Would it have served that purpose?",
	"How is it being used now, and does that actually work?",
	"How do the denizens come and go? How do they see?",
	"Where do they sleep, store food, and prepare it?",
	"What do they do with waste?",
	"Do the areas, layout, and contents reflect those answers?",
];

// ── Roll helpers ──────────────────────────────────────────────────────────────
export { rollOnTable };

/** Roll one row off a manner's table by key, or null when there's no such table. */
export function rollMannerTable(manner, key, rng = Math.random) {
	const m = typeof manner === "string" ? siteManner(manner) : manner;
	const t = m?.tables.find(x => x.key === key);
	return t ? rollOnTable(t.rows, rng) : null;
}

/** Roll one terrain row for a region, or null when there's no such region. */
export function rollTerrain(regionId, rng = Math.random) {
	const r = region(regionId);
	return r ? rollOnTable(r.terrain, rng) : null;
}
