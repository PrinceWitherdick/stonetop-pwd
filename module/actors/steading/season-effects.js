import { improvementRequirementCount } from "../../utils/improvement-def.js";

// ── What the steading's improvements do when the Seasons Change ──────────────────
// Ten of the book's improvements end in a "Henceforth…" clause that fires on the turning of a
// season, and until now the Seasons Change window knew about three of them: the Herd of Horses,
// the Standing Watch and the Weapons of War. The other seven were prose on an improvement card
// and nothing else, so a steading that had built a Mill and a Market and won a Township rolled
// the same 1d4 for its harvest as a village with none of them, and consumed the same 1d4 in
// winter behind a stone wall as it had before the wall existed.
//
// They divide into three kinds, and the division is what this module is shaped around, because
// the three want completely different things from the window:
//
//   • MODIFIERS to a roll the season already makes. The autumn harvest and the winter
//     consumption are single rolls whose formula several improvements rewrite. There is nothing
//     for a GM to click here — the button that was already there simply rolls the right dice.
//
//   • YIELDS: Surplus an improvement generates on its own, alongside the season's roll. Each is
//     its own thing to take, so each is its own button and its own once-per-season marker.
//
//   • DUES: an upkeep that costs something if it goes unpaid, which is the Well-Trained Militia
//     and its summer of drills. That is the Standing Watch's shape exactly, so it is wired the
//     Standing Watch's way, right down to the second button naming what happens if you decline.
//
// EVERYTHING HERE IS THE BOOK'S ARITHMETIC, not ours, so each entry carries the printed line it
// implements. A rule this file gets wrong is a rule that is wrong four times a year forever, and
// nobody at the table would have any way of noticing.
//
// Pure — no Actor, no globals, no Roll. It is handed plain numbers and a "has this improvement?"
// predicate and answers with formulas and rows, so every combination is testable without a world
// and the window is left with nothing to do but render and roll.

/** A signed tail for a dice formula: "" for 0, " + 2", " - 1". Foundry's Roll wants the spaces
 *  and will not take "1d4 + -1", which is what a template literal produces if you let it. */
function term(n) {
	const value = Math.trunc(Number(n) || 0);
	if (!value) return "";
	return value > 0 ? ` + ${value}` : ` - ${Math.abs(value)}`;
}

/**
 * The autumn harvest, and everything that changes it.
 *
 *   Base (Book I, Seasons Change, autumn) — "the steading generates 1d4 Surplus".
 *   Greater Harvest — "when the autumn harvest is complete, gain +1d4 Surplus".
 *   Mill            — "when the autumn harvest is complete, the steading generates +1 Surplus".
 *   Additional Housing, and ONLY if the steading took that requirement — "Building on parts of
 *     the fields, resulting in −1 Surplus generated with each autumn's harvest". It is a cost
 *     the steading chose while building, so it is read off the requirement box that records the
 *     choice, not off the improvement being finished.
 *
 * @param {object}  state
 * @param {(slug: string) => boolean} state.has       is this improvement built?
 * @param {boolean} [state.builtOnTheFields=false]    did Additional Housing take the fields?
 * @returns {{formula: string, parts: Array<{label: string, amount: string}>}}
 *   `parts` names each contribution for the button and the notice, so a GM can see WHY the
 *   harvest is 1d4+1d4+1 rather than being handed a formula and asked to trust it.
 */
export function autumnHarvest({ has = () => false, builtOnTheFields = false } = {}) {
	const parts = [{ label: "Harvest", amount: "1d4" }];
	let formula = "1d4";
	if (has("greaterHarvest")) { formula += " + 1d4"; parts.push({ label: "Greater Harvest", amount: "+1d4" }); }
	let flat = 0;
	if (has("mill")) { flat += 1; parts.push({ label: "Mill", amount: "+1" }); }
	// The fields that were built on. Only reachable through Additional Housing, so it is gated on
	// the improvement as well as on the box: an un-built improvement's half-ticked requirements
	// are a plan, not a change to this year's harvest.
	if (has("additionalHousing") && builtOnTheFields) {
		flat -= 1;
		parts.push({ label: "Homes built on the fields", amount: "−1" });
	}
	return { formula: formula + term(flat), parts };
}

/**
 * Winter's consumption roll, and everything that changes it.
 *
 *   Base (Book I, Seasons Change, winter) — "rolls 1d4+Population (min 0); the steading consumes
 *     that much Surplus".
 *   Township          — "when winter grips the land, roll 2d6+Population to consume Surplus
 *     instead of 1d4+Population".
 *   Additional Housing — "when you consume Surplus in winter, consider Population to be 1 lower
 *     than it is".
 *   Stone Wall        — "when winter grips the land, the steading consumes 1 less Surplus than
 *     normal".
 *
 * @param {object} state
 * @param {number} state.population
 * @param {(slug: string) => boolean} state.has
 * @param {boolean} [state.second=false]  Is this winter's SECOND bite — the 7-9's "consume
 *   1d4+Population more Surplus before winter ends"?
 *
 *   The dice and the Population adjustment carry over to it, because both are stated as how a
 *   winter consumption is rolled at all. The Stone Wall's flat −1 does NOT: it says the steading
 *   consumes one less than normal over a winter, and charging it against both rolls would let one
 *   wall pay twice for a single winter. That is a ruling rather than a quotation, which is why it
 *   is written down here and surfaced in the window rather than left implicit.
 * @returns {{formula: string, parts: Array<{label: string, amount: string}>}}
 */
export function winterConsumption({ population = 0, has = () => false, second = false } = {}) {
	const dice = has("township") ? "2d6" : "1d4";
	const parts = [{ label: second ? "Winter is not done" : "Winter", amount: dice }];
	if (has("township")) parts.push({ label: "Township", amount: "2d6 in place of 1d4" });

	let pop = Math.trunc(Number(population) || 0);
	if (has("additionalHousing")) {
		pop -= 1;
		parts.push({ label: "Additional Housing", amount: "Population counts 1 lower" });
	}
	let flat = pop;
	if (!second && has("stoneWall")) {
		flat -= 1;
		parts.push({ label: "Stone Wall", amount: "−1 Surplus consumed" });
	}
	return { formula: dice + term(flat), parts };
}

/**
 * Surplus an improvement generates when the season turns — the third of the three kinds.
 *
 * `needsHit` is the fork that keeps two of these from being taken automatically: Raincatching and
 * Harnessing the Stream both pay out only "when you roll a 7+ with Fortunes", and this window
 * cannot read that roll. The +Fortunes roll is posted to chat by the roll engine, or made from
 * the Moves tab, or handed to a player entirely — so, exactly like winter's debt, the tier is a
 * thing the GM tells the window rather than a thing the window works out. Their buttons say the
 * condition out loud instead of pretending to know.
 *
 * `gate` is the other kind of condition: one the window CAN check, so it does, and says why when
 * it fails rather than silently omitting a row a GM is expecting to see.
 */
export const SEASONAL_YIELDS = [
	{
		key:     "marketYield",
		slug:    "market",
		label:   "Market",
		seasons: ["spring", "summer", "autumn"],
		rule:    "When the Seasons Change to spring, summer, or autumn and the market is active, and Population is +1 or better, the Market generates 1 Surplus.",
		gate:    ({ population }) => population >= 1,
		unmet:   "Population is below +1, so the market generates nothing this season.",
		amount:  () => 1,
	},
	{
		key:     "townshipYield",
		slug:    "township",
		label:   "Township",
		seasons: ["spring", "summer"],
		rule:    "When the Seasons Change to spring or summer, the town generates Surplus equal to Population+1.",
		// Floored at 0: a town at Population −1 generates nothing, and a negative yield would be
		// a Surplus the season quietly took away, which no line of this improvement describes.
		amount:  ({ population }) => Math.max(0, population + 1),
	},
	{
		key:      "streamYield",
		slug:     "harnessingStream",
		label:    "Harnessing the Stream",
		seasons:  ["spring"],
		rule:     "When spring breaks forth and you roll a 7+ with Fortunes, the steading generates 1 Surplus.",
		needsHit: true,
		amount:   () => 1,
	},
	{
		key:      "raincatchingYield",
		slug:     "raincatching",
		label:    "Raincatching",
		seasons:  ["summer"],
		rule:     "When summer comes and you roll a 7+ with Fortunes, the steading generates 1 Surplus.",
		needsHit: true,
		amount:   () => 1,
	},
];

/**
 * The yields on offer this season: built, in season, with the amount worked out.
 *
 * A row whose `gate` fails is still RETURNED, carrying `blocked` and the sentence saying why. A
 * steading that has built a Market and sees no Market row cannot tell whether the rule is
 * satisfied elsewhere, was forgotten, or does not apply this season — so the row stays and
 * explains itself, and only the button goes.
 *
 * @returns {Array<{key, label, rule, amount, needsHit, blocked, unmet}>}
 */
export function seasonalYields({ seasonId = "", population = 0, has = () => false } = {}) {
	return SEASONAL_YIELDS
		.filter(y => y.seasons.includes(seasonId) && has(y.slug))
		.map(y => {
			const blocked = y.gate ? !y.gate({ population }) : false;
			return {
				key: y.key,
				label: y.label,
				rule: y.rule,
				needsHit: !!y.needsHit,
				blocked,
				unmet: blocked ? y.unmet : "",
				amount: blocked ? 0 : Math.max(0, Math.trunc(y.amount({ population }))),
			};
		});
}

/** The once-per-season marker key for a yield. Same shape as the other season steps. */
export const MILITIA_SEASON_STEP = "militiaDrill";

/**
 * The Well-Trained Militia's trained tactics, as rows the window can offer for the losing.
 *
 * "Each summer, the militia must spend 1 Surplus and a week or so practicing or else lose its
 * training in 1 tactic." Which tactic is not the book's to say and not ours either, so the window
 * lists what the militia knows and the table picks.
 *
 * The tactics are the improvement's LAST requirement section — the one you tick once per tactic
 * drilled — and the index returned is the FLAT index into the stored `r` array, which is what
 * writes a requirement box. Derived from the definition rather than hard-coded, so a reworded
 * requirement moves the offsets and this moves with it; a test pins the shape it expects.
 *
 * @param {{sections?: Array<{items?: string[]}>}} def  the wellTrainedMilitia definition
 * @param {Array<boolean>} r                            its stored requirement state
 * @returns {Array<{index: number, label: string}>}  the tactics currently trained
 */
export function militiaTactics(def, r = []) {
	const sections = def?.sections ?? [];
	if (!sections.length) return [];
	const last = sections[sections.length - 1];
	const offset = improvementRequirementCount({ sections: sections.slice(0, -1) });
	return (last.items ?? [])
		.map((label, i) => ({ index: offset + i, label }))
		.filter(t => r[t.index] === true);
}

/**
 * Whether Additional Housing was built the way that costs the harvest.
 *
 * Its penalty is not a consequence of the improvement, it is the consequence of one of the two
 * ways it could be BUILT - "Building on parts of the fields, resulting in -1 Surplus generated
 * with each autumn's harvest" - so it is read off the requirement box that recorded which way the
 * steading went, the same as the militia's tactics above.
 *
 * Found by its text rather than by a bare index so a reordered section cannot silently point this
 * at the engineer instead; the test pins it against the real definition, which is what keeps the
 * wording it looks for honest. A reword that loses the match reads as "not on the fields", which
 * is the harmless direction: the harvest is simply not docked.
 *
 * @param {{sections?: Array<{items?: string[]}>}} def  the additionalHousing definition
 * @param {Array<boolean>} r                            its stored requirement state
 * @returns {boolean}
 */
export function builtOnTheFields(def, r = []) {
	const items = (def?.sections ?? []).flatMap(s => s.items ?? []);
	const at = items.findIndex(t => /parts of the fields/i.test(t));
	return at >= 0 && r[at] === true;
}
