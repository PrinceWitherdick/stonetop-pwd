// THE HOMEFRONT PAGE of the GM playbook, transcribed.
//
// One printed page, four columns, and they are four different KINDS of thing, which is why this
// file exports six tables rather than one:
//
//  1. "Life in Stonetop" — the village's facts, the ones a GM is asked for mid-scene and cannot
//     invent twice the same way (how many people, where the water comes from, who decides).
//  2. The year's work — what folk are actually doing, season by season, plus the chores that
//     never stop. This is the answer to "what is your character doing when I frame this scene?".
//  3. Aftermath and Downtime — the two procedures that bracket every expedition.
//  4. Make a Plan, and the list of requirements a GM answers it with.
//  5. Relative Value — what a trade Value is worth, for the moment somebody offers something.
//
// Reference only, like the rest of this sheet. Nothing here rolls and nothing here is stored.
//
// ── Where it comes from ──────────────────────────────────────────────────────────────────────
// The playbook prints this page without citations, and the two halves come from different books:
// the village's facts and its seasons are Book II's "The village of Stonetop" entry (pp.12-21),
// while the procedures and the Value tiers are Book I's "Homefront" chapter (pp.483-547). Both
// are cited per section, which is the whole use of a reference page — the playbook's line is the
// reminder, and the page is where you go when the reminder is not enough.
//
// TRANSCRIPTION RULES, the same as gm-moves.js, so a later edit does not drift:
//  • The playbook's wording and punctuation. Curly quotes and ellipses normalized to ASCII.
//  • Nothing reworded, nothing added. Where the playbook abbreviates ("~a dozen ply the Great
//    Wood"), the abbreviation stands.
//  • A `name` plus its `detail` read as ONE of the playbook's sentences with the first clause
//    bolded — the template joins them with a space and adds nothing. That is why several details
//    below begin mid-sentence, in lower case: they are the rest of the line, not a gloss on it.
//
// ── What is deliberately NOT here ────────────────────────────────────────────────────────────
// The seasonal lists are ALSO in the Village of Stonetop location journal, in a fuller form that
// carries the Impressions and the per-season questions with them. That is not a duplicate to be
// collapsed: the journal page is the entry you read before a session, and this is the column you
// glance at during one. What each says is the same because both are transcribed from the same
// Book II page, and neither is derived from the other.
//
// Likewise RELATIVE_VALUE against module/data/value-tiers.js. Those are the same table said two
// ways for two jobs: value-tiers.js prints one flowing sentence per tier for the hover tooltip on
// every "Value N" in the journals, and this is the playbook's bullet column. Deriving either from
// the other would mean splitting or joining on commas that appear inside the entries themselves
// ("A good, trained horse or mule"), so both are transcribed and the pair is pinned by a test.

/**
 * @typedef {object} HomefrontGroup
 * @property {string}   key    Stable id, for the fold state and the template.
 * @property {string}   name   The playbook's own sub-heading.
 * @property {number}   book   Which rulebook the fuller entry is in. 1 or 2.
 * @property {number}   page   Printed page in that book.
 * @property {string[]} items  The playbook's bullets, in its order.
 */

/**
 * "Life in Stonetop" — the village in four groups of facts (Book II pp.16-19).
 *
 * Each group carries its OWN page rather than the entry's first, because the four are four
 * separate spreads in Book II and a GM chasing one of them wants the right one. The playbook
 * prints all four in a single column with no citation at all.
 *
 * @type {HomefrontGroup[]}
 */
export const LIFE_IN_STONETOP = [
	{
		key:  "people",
		name: "People",
		book: 2,
		page: 16,
		items: [
			"~300 people live in Stonetop (~50 families)",
			"Most adults work the fields or keep a home; ~a dozen ply the Great Wood",
			"Few tradesfolk: a smith, tanner, potter, publican, midwife (plus apprentices)",
			"Other crafts (carpentry, weaving, sewing, distilling, etc.) done on the side",
		],
	},
	{
		key:  "home",
		name: "Home & hearth",
		book: 2,
		page: 17,
		items: [
			"Homes are squat, stone (from the Old Wall), thatched roofs; 1-3 buildings per family",
			"Each family keeps a garden and livestock",
			"No mill; folks grind grain with quern-stones",
			"Most families keep a whisky still",
			"Water comes from cistern; fill with rain/snow",
			"Folks wash at the Stream, but rarely go alone",
		],
	},
	{
		key:  "trade",
		name: "Trade & commerce",
		book: 2,
		page: 18,
		items: [
			"Most crops go to the granary for public use",
			"Mostly barter; coin comes from outsiders",
			"Merchants come at least once a season (except winter)",
			"Gordin's Delve brings metal & tools",
			"Marshedge brings textiles, herbs, glass, finer goods from the south",
			"By compact with the Forest Folk, no one fells living trees in the Great Wood (but the Forest Folk haven't been seen in a decade)",
		],
	},
	{
		key:  "governance",
		name: "Protection & governance",
		book: 2,
		page: 19,
		items: [
			"Every able body drills with the militia, keeps a spear handy, takes a turn at the watchtowers",
			"No nobles, no elected officials; decisions made by the wise, the cunning, the brave",
		],
	},
];

/**
 * "Questions to ask" (Book II p.13).
 *
 * Twelve, printed under the village's facts and pointing the other way: the facts are what the GM
 * knows, and these are what the GM does not and is asking the table to decide. The book's own
 * principle for them is "ask questions and build on the answers" — an answer given here is true
 * of the village from then on.
 */
export const HOMEFRONT_QUESTIONS = {
	book: 2,
	page: 13,
	items: [
		"What task or chore are you working on?",
		"What's the best/worst thing about this chore?",
		"What's cooking on the hearthfire?",
		"What here makes the place feel like home?",
		"What about your home would you change if you could?",
		"How does Stonetop mark or celebrate the coming of spring/summer/autumn/winter?",
		"What's your (least) favorite thing about this season?",
		"What's your favorite tale of Stonetop's history?",
		"What's the scariest story that the elders tell?",
		"How do the villagers mark or celebrate a birth?",
		"How do the villagers mark one's coming of age?",
		"What do the villagers do with their dead?",
	],
};

/**
 * The year's work (Book II p.14), season by season, and then the chores that never stop.
 *
 * `key` is a SEASON_IDS value for the four seasons (module/seasons/seasons-change-reminders.js),
 * which is what lets the tab mark the one the campaign is actually in — the steading's clock
 * stores the same key. "Always" is deliberately NOT a season key: it matches no clock, so it is
 * never the marked block, which is correct, because it is true in all four.
 *
 * @type {{book: number, page: number, seasons: Array<{key: string, name: string, items: string[]}>}}
 */
export const THE_YEARS_WORK = {
	book: 2,
	page: 14,
	seasons: [
		{
			key:  "spring",
			name: "Spring",
			items: [
				"Harvesting winter potatoes",
				"Spreading seed, planting beans/potatoes",
				"Harrowing soil (to cover seeds, plantings)",
				"Chasing birds from the fields (child's work)",
				"Spreading manure & plowing fallow fields",
				"Kidding goats, sheep",
				"Picking spring vegetables",
				"Clearing and planting gardens",
				"Harvesting/cutting deadfall for firewood",
				"Fur trapping, light hunting (for meat)",
			],
		},
		{
			key:  "summer",
			name: "Summer",
			items: [
				"Haymaking (from Flats-grass, fallow fields)",
				"Weeding crops/gardens",
				"Spreading manure & replowing fallow fields",
				"Weaning goat kids & lambs",
				"Milking goats, shearing sheep",
				"Picking summer vegetables",
				"Berry-picking from gardens and the Wood",
				"Light hunting/trapping (for meat, not fur)",
			],
		},
		{
			key:  "autumn",
			name: "Autumn",
			items: [
				"Harvesting beans, barley, oats, potatoes",
				"Gleaning fallen seed from fields (child's work)",
				"Threshing, winnowing, sieving, storing crops",
				"Plowing fallows & planting winter potatoes",
				"Picking & preserving autumn vegetables",
				"Breeding goats, sheep",
				"Foraging for nuts, fruits in the Wood",
				"Heavy hunting/trapping (fur & meat)",
				"(If able): harvesting timber from Foothills",
			],
		},
		{
			key:  "winter",
			name: "Winter",
			items: [
				"Collecting snow for the cistern",
				"Distilling & aging whisky",
				"Tending to livestock, stockpiling manure",
				"Heavy trapping (for fur)",
				"Hunting as able (for meat)",
				"Slaughtering/butchering livestock as needed",
			],
		},
		{
			key:  "always",
			name: "Always",
			items: [
				"Cooking, grinding grain, baking",
				"Rendering fat, making oil & rushlights",
				"Cleaning pens, coops, homes, clothes",
				"Collecting & hauling water, to & from cistern",
				"Spinning, weaving, sewing, hand-crafts",
				"Smithing, tanning, pottery, midwifery",
				"Maintenance (buildings, clothes, tools, etc.)",
				"Manning the watchtowers at night; drilling",
			],
		},
	],
};

/**
 * @typedef {object} HomefrontStep
 * @property {string}   name      The step, as the playbook prints its opening clause.
 * @property {string}   [detail]  The REST of that same sentence, joined to the name by a space.
 * @property {string[]} [items]   Sub-bullets, where the playbook indents any.
 * @property {number}   [page]    Printed page in Book I, where a step names its own chapter.
 */

/**
 * Aftermath, the three steps (Book I p.490).
 *
 * Also the first three bullets of the Core Loop tab's flow-of-play chart, and deliberately so:
 * the chart says WHERE aftermath sits in a campaign, and this says what running one consists of.
 * A GM on the chart is orienting; a GM here has just got the party home.
 *
 * NUMBERED, and the playbook numbers them: unlike downtime's five, these three are a sequence.
 *
 * @type {{page: number, steps: HomefrontStep[]}}
 */
export const AFTERMATH = {
	page: 490,
	steps: [
		{
			name:   "Determine what's happened",
			detail: "while the PCs were gone or during the crisis. How will you reveal this? Make a to-do list!",
		},
		{
			name:   "Play out their return",
			detail: "or the immediate aftermath of the crisis. Start working through your to-do list. Return Triumphant or Meet With Disaster, if appropriate.",
		},
		{
			name:   "See what follows.",
			detail: "Play out any obvious or urgent scenes. Give each PC a scene with family or important NPCs. Do any other scenes you all want to play out.",
		},
	],
};

/**
 * Downtime, the five things it consists of (Book I p.496).
 *
 * Not numbered in the playbook and not numbered here: unlike Aftermath's three, these are not a
 * sequence. Logistics and goals come first, but the scenes and the passing of time interleave for
 * as long as downtime lasts.
 *
 * `ends` is printed under the list and belongs with it: a procedure with no end condition is one
 * a GM can find themselves still inside three sessions later.
 *
 * @type {{page: number, steps: HomefrontStep[], ends: string}}
 */
export const DOWNTIME = {
	page: 496,
	steps: [
		{ name: "Take care of logistics" },
		{ name: "Establish goals and intentions" },
		{
			name:  "Frame scenes/situations as needed, to...",
			items: [
				"... resolve a player's move/actions;",
				"... make a GM move/resolve stakes; or",
				"... play out a desired scene.",
			],
		},
		{ name: "Describe time passing" },
		// The one step that is a MOVE rather than a thing the GM does, so it carries the move's own
		// page. Seasons Change is its own chapter and its own procedure; downtime only ends in it.
		{ name: "Eventually, the Seasons Change", page: 516 },
	],
	ends: "Downtime ends when the PCs head off on an expedition (to pursue a goal, or in response to a threat or opportunity) or a crisis erupts in town.",
};

/**
 * MAKE A PLAN (Book I p.530), the one PLAYER move printed on this page.
 *
 * It is here because it is the move a GM has to answer, and answering it is a GM procedure: the
 * player says what they hope to achieve, and the requirements below are what the GM builds the
 * answer out of. The playbook prints the trigger and the list together for exactly that reason,
 * and the list is useless without the trigger that summons it.
 */
export const MAKE_A_PLAN = {
	page: 530,
	trigger:  "When you wish to accomplish some project but aren't sure how to go about it, tell the GM what you hope to achieve. They'll say what's required. If you're stumped on how to accomplish one of the requirements, tell the GM and Make a Plan for that.",
	guidance: "Clarify exactly what they hope to achieve and how they plan to go about it. Then tell them as many of the following as makes sense, connected with \"and\" and \"or\" as you see fit.",
	requirements: [
		"You must learn/know/decipher ___",
		"You must find/locate/obtain ___",
		"You must create/design/fix ___",
		"You'll need the help/support/approval of ___",
		"You must wait until/for ___",
		"You must travel to ___",
		"It'll take days/weeks/months/years (which means ___ will go undone)",
		"The best you can get/do is ___",
		"It will cost ___",
		"You'll risk ___",
		"The steading must Pull Together ___ times, each requiring ___",
	],
};

/**
 * Relative Value (Book I p.542) — what a trade Value is generally worth.
 *
 * TWO SOURCES, and the difference matters if anyone ever checks this against a book. The intro,
 * the tiers and the notes are the GM PLAYBOOK's Homefront page, transcribed as printed: the
 * playbook says "Exchange rates are not standard, but..." where Book I says "anything but
 * standard", and the last note ("trade is based more on barter, debts, and honor") is printed on
 * the playbook page and nowhere in Book I's own version. Neither is a slip to be tidied up.
 *
 * `lead` is the exception and comes from Book I p.542, which is the page this section cites. The
 * playbook's condensation DROPS it, and it is the one genuinely counterintuitive thing about
 * Stonetop's economy: the Values are tiers rather than a scale, so three Value 1 items do not add
 * up to a Value 3, and a table that assumes they do will haggle its way into nonsense. A GM who
 * only ever reads this tab would otherwise never meet it.
 *
 * The trailing `*` on two of the entries is the playbook's own footnote mark, kept as printed and
 * answered by the first of the notes below.
 */
export const RELATIVE_VALUE = {
	page:  542,
	lead:  "Any given item has a Value from 0 to 4 (or rarely higher). Values are not linear; they are tiers. A single Value 2 item is worth about a dozen Value 1 items. Three individual Value 1 items don't add up to Value 3; they're just three Value 1 items.",
	intro: "Exchange rates are not standard, but...",
	tiers: [
		{
			value: 0,
			items: [
				"A purse of copper coins",
				"A single silver coin",
				"A favor",
				"A few days of unskilled labor",
				"A common, mundane item",
			],
		},
		{
			value: 1,
			items: [
				"A handful of silver coins",
				"A season (or so) of unskilled labor",
				"A few days of skilled labor",
				"A unit of trade goods* (a sack of grain, a pouch of salt, a stack of pelts, etc.)",
				"A bit of finery (a richly embroidered cloak, a silk scarf, a silver comb, etc.)",
			],
		},
		{
			value: 2,
			items: [
				"A purse of silver coins",
				"A single gold coin",
				"A Surplus",
				"A year (or so) of unskilled labor",
				"A season (or so) of skilled labor",
				"A cartload of common trade goods*",
				"An item of luxury or status (a gold ring, an artful silver torc, a gemstone, etc.)",
			],
		},
		{
			value: 3,
			items: [
				"A handful of gold coins",
				"A year (or so) of skilled labor",
				"A good, trained horse or mule",
				"A precious item (ruby ring, gold torc, etc.)",
			],
		},
		{
			value: 4,
			items: [
				"A purse of gold coins",
				"A dozen or so horses",
				"A \"priceless\" item (huge flawless gemstone, gold statuette, bejeweled scepter, etc.)",
			],
		},
	],
	notes: [
		"*Exotic trade goods are +1 Value.",
		"A purse of coins contains ~10 handfuls of coins. A handful is ~10 individual coins, and so a purse has ~100 coins in it.",
		"Remember, trade is based more on barter, debts, and honor than standard currency.",
	],
};

/**
 * The Homefront tab, section by section, in the order the playbook prints them down and then
 * across its four columns.
 *
 * Each section is its own BOX in the template, for the reason gm-moves.js gives for the move
 * groups: the fold walk claims a heading's following siblings until it meets the next heading
 * (utils/section-editing.js), so several headings in one flat run would let the first caret
 * swallow the rest.
 *
 * `kind` is what the template switches its body markup on, because the six sections genuinely
 * differ in shape (grouped bullets, a question list, seasons, steps, a move, a value table) and
 * one generic renderer for all six would be a longer `{{#if}}` chain than six partials' worth of
 * markup. Everything ELSE about a section — its heading, its note, its fold — is the same, and
 * that part is shared.
 *
 * A frozen module constant rather than a per-call literal, for the same reason GM_MOVE_SECTIONS
 * is one: every field is either a constant above or an i18n KEY, so nothing about it varies per
 * render, and freezing means a caller that treats a shared table as scratch fails loudly.
 *
 * @type {ReadonlyArray<{key: string, kind: string, titleKey: string, noteKey: string, collapseId: string}>}
 */
export const HOMEFRONT_SECTIONS = Object.freeze([
	{
		key:        "life",
		kind:       "groups",
		titleKey:   "stonetop.gmToolkit.homefront.life",
		noteKey:    "stonetop.gmToolkit.homefront.lifeNote",
		collapseId: "gmHomefrontLife",
	},
	{
		key:        "questions",
		kind:       "questions",
		titleKey:   "stonetop.gmToolkit.homefront.questions",
		noteKey:    "stonetop.gmToolkit.homefront.questionsNote",
		collapseId: "gmHomefrontQuestions",
	},
	{
		key:        "year",
		kind:       "seasons",
		titleKey:   "stonetop.gmToolkit.homefront.year",
		noteKey:    "stonetop.gmToolkit.homefront.yearNote",
		collapseId: "gmHomefrontYear",
	},
	{
		key:        "aftermath",
		kind:       "steps",
		titleKey:   "stonetop.gmToolkit.homefront.aftermath",
		noteKey:    "stonetop.gmToolkit.homefront.aftermathNote",
		collapseId: "gmHomefrontAftermath",
	},
	{
		key:        "downtime",
		kind:       "steps",
		titleKey:   "stonetop.gmToolkit.homefront.downtime",
		noteKey:    "stonetop.gmToolkit.homefront.downtimeNote",
		collapseId: "gmHomefrontDowntime",
	},
	{
		key:        "plan",
		kind:       "plan",
		titleKey:   "stonetop.gmToolkit.homefront.plan",
		noteKey:    "stonetop.gmToolkit.homefront.planNote",
		collapseId: "gmHomefrontPlan",
	},
	{
		key:        "value",
		kind:       "value",
		titleKey:   "stonetop.gmToolkit.homefront.value",
		noteKey:    "stonetop.gmToolkit.homefront.valueNote",
		collapseId: "gmHomefrontValue",
	},
]);
