import { describe, it, expect, vi } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import { HOLD_DEFS } from "../../../module/actors/steading/steading-holds.js";
import { StonetopSteading } from "../../../module/actors/steading/StonetopSteading.js";

// ── The fixture macro's seed, read back through the real reader ──────────────────
// The hold tray is EMPTY on a quiet steading by design, which makes it the one piece of the
// steading header a test world never shows by accident. So scripts/local/create-test-characters.js
// lights every chip at once, and these build the exact flag shape that macro writes and run it
// through holdsView. A seed that drifts out of step with what the reader wants then fails here,
// rather than turning up as a header that is quietly missing a chip nobody can explain.

function seededActor({ season = "spring", year = 1, pickerYear = year, steadingFlags = {} } = {}) {
	const flags = {
		seasonsCurrent: season ? { season, year } : undefined,
		seasonsCurrentYear: pickerYear,
		steading: steadingFlags,
	};
	return {
		type: "stonetop",
		system: {},
		flags: { "stonetop-pwd": flags },
		getFlag: (scope, key) => (scope === "stonetop-pwd" ? flags[key] ?? null : null),
		update: vi.fn(),
	};
}

/** Exactly what create-test-characters.js writes into flags["stonetop-pwd"].steading. */
function fixtureSteadingFlags({ year = 1, season = "spring" } = {}) {
	const built = { completed: true, applied: null, r: Array(16).fill(true) };
	return {
		fortunesAdvantage: { source: "Sacrifice (Rites of the Land)" },
		musterHold: { year, season, defenses: true },
		torsBlessing: `${year}:${season}`,
		// Stamped for WINTER whatever the clock says, because winter is the only season the
		// debt can exist in; the macro hard-codes the season for that reason.
		winterDebt: { stamp: `${year}:winter`, amount: 3 },
		improvements: {
			inn: { ...built }, standingWatch: { ...built },
			weaponsOfWar: { ...built }, herdOfHorses: { ...built },
			wellTrainedMilitia: { ...built },
		},
		system: {
			stats: { defenses: { value: 1 } },
			attributes: {
				surplus: { value: 1 },
				debilities: {
					options: {
						diminished: { value: false },
						lacking: { value: true },
						malcontent: { value: false },
					},
				},
			},
		},
	};
}

const keysFor = actor => new StonetopSteading(actor).holdsView().map(r => r.key);

describe("the test fixture's seeded tray", () => {
	// NO season lights all nine, and that is the tray's shape rather than a hole in the seed:
	// the weapons' bill is spring-only, the herd's growth is summer-only, and the herd's feed
	// and winter's debt are both winter-only. What the macro seeds is season-INDEPENDENT, so
	// each season below is the full set MINUS the rows that season shuts out. A row that stops
	// being gated on its season should break one of these, not the header in the world.
	const at = season => keysFor(seededActor({ season, steadingFlags: fixtureSteadingFlags({ season }) }));
	const ALL = HOLD_DEFS.map(d => d.key);
	const without = (...keys) => ALL.filter(k => !keys.includes(k));

	it("lights the six spring allows, weapons included", () => {
		expect(at("spring")).toEqual(without("herdAdvance", "militiaTraining", "herdFeed", "winterDebt"));
		expect(at("spring")).toHaveLength(6);
	});

	// Summer trades the weapons' spring bill for two of its own: the herd's growth and the
	// militia's drills, which is why it ties winter for the widest the tray ever gets.
	it("trades the weapons' spring bill for the herd's growth and the militia's drills", () => {
		expect(at("summer")).toEqual(without("weaponsUpkeep", "herdFeed", "winterDebt"));
		expect(at("summer")).toHaveLength(7);
	});

	// Autumn asks nothing seasonal of anybody, so it is the quietest the seeded tray gets.
	it("drops to five in autumn, which shuts out every season-locked row", () => {
		expect(at("autumn")).toEqual(without("herdAdvance", "militiaTraining", "weaponsUpkeep", "herdFeed", "winterDebt"));
		expect(at("autumn")).toHaveLength(5);
	});

	// Seven again, by a different route: the herd's FEED and winter's second consumption fall
	// together where summer had the herd's growth and the militia.
	it("matches summer at seven in winter, on different rows", () => {
		expect(at("winter")).toEqual(without("herdAdvance", "militiaTraining", "weaponsUpkeep"));
		expect(at("winter")).toHaveLength(7);
	});

	// The fixture also builds nine improvements the SEASONS CHANGE WINDOW reads — the Market, the
	// Township, the Mill and the rest. None of them is a due or an unclaimed boon: what they do
	// happens inside that window, like the season's own Surplus roll, which has never worn a
	// glyph either. So the tray must be exactly as wide with them as without, in every season.
	it("takes no chips from the improvements the window reads rather than the tray", () => {
		for (const season of ["spring", "summer", "autumn", "winter"]) {
			const bare = fixtureSteadingFlags({ season });
			const built = fixtureSteadingFlags({ season });
			for (const slug of [
				"market", "township", "harnessingStream", "raincatching",
				"greaterHarvest", "mill", "additionalHousing", "stoneWall", "aurochsHunting",
			]) built.improvements[slug] = { completed: true, applied: null, r: Array(16).fill(true) };
			expect(keysFor(seededActor({ season, steadingFlags: built })), season)
				.toEqual(keysFor(seededActor({ season, steadingFlags: bare })));
		}
	});

	// Every gate the seed has to satisfy, failed one at a time. A chip that stops depending on
	// something the macro writes should break a test here, not the header in the world.
	it("needs a Surplus for the inn's gathering to count as unspent", () => {
		const flags = fixtureSteadingFlags();
		flags.system.attributes.surplus.value = 0;
		expect(keysFor(seededActor({ steadingFlags: flags }))).not.toContain("innGathering");
	});

	it("needs a marked debility for the inn's gathering to have anything to clear", () => {
		const flags = fixtureSteadingFlags();
		flags.system.attributes.debilities.options.lacking.value = false;
		expect(keysFor(seededActor({ steadingFlags: flags }))).not.toContain("innGathering");
	});

	it("needs the improvements built for their upkeep chips to exist at all", () => {
		for (const season of ["spring", "summer", "winter"]) {
			const flags = fixtureSteadingFlags({ season });
			flags.improvements = {};
			const keys = keysFor(seededActor({ season, steadingFlags: flags }));
			for (const k of ["innGathering", "standingWatch", "weaponsUpkeep", "herdAdvance", "herdFeed", "militiaTraining"]) {
				expect(keys, `${k} in ${season}`).not.toContain(k);
			}
		}
	});

	// A paid step is precisely the state that hides a due, which is why the macro clears these
	// for the seeded season through the "-=" deletion syntax rather than off the object. The
	// herd's two read the SAME markers the Seasons Change window disables its buttons from, so
	// a herd already seen to that season cannot also be nagging from the header.
	it("needs this season's step markers clear for the dues to read as unpaid", () => {
		const flags = fixtureSteadingFlags();
		flags.seasonSteps = { innGathering: "1:spring", standingWatch: "1:spring", weaponsUpkeep: "1:spring" };
		const keys = keysFor(seededActor({ steadingFlags: flags }));
		for (const k of ["innGathering", "standingWatch", "weaponsUpkeep"]) expect(keys, k).not.toContain(k);

		const summer = fixtureSteadingFlags({ season: "summer" });
		summer.seasonSteps = { advanceHerd: "1:summer", militiaDrill: "1:summer" };
		const summerKeys = keysFor(seededActor({ season: "summer", steadingFlags: summer }));
		expect(summerKeys).not.toContain("herdAdvance");
		expect(summerKeys).not.toContain("militiaTraining");

		const winter = fixtureSteadingFlags({ season: "winter" });
		winter.seasonSteps = { feedHerd: "1:winter" };
		expect(keysFor(seededActor({ season: "winter", steadingFlags: winter }))).not.toContain("herdFeed");
	});

	// A herd eats 1 Surplus per 6 grown-or-yearling horses, so a small herd eats nothing, and a
	// bill for 0 Surplus is not an obligation. The seed leaves the herd flag absent and lets it
	// fall back on the starting twelve, which cost 2.
	it("needs a herd big enough to actually eat before the feed chip is a due", () => {
		const flags = fixtureSteadingFlags({ season: "winter" });
		flags.herd = { grown: 5, yearlings: 0, foals: 9 };
		expect(keysFor(seededActor({ season: "winter", steadingFlags: flags }))).not.toContain("herdFeed");

		flags.herd = { grown: 3, yearlings: 3, foals: 0 };
		expect(keysFor(seededActor({ season: "winter", steadingFlags: flags }))).toContain("herdFeed");
	});

	// The muster is stored against the season it was raised in, so a stamp from any other
	// season reads as lapsed. The macro dates it to the clock it just stamped for that reason.
	it("dates the muster to the seeded season, or it reads as already lapsed", () => {
		const flags = fixtureSteadingFlags();
		flags.musterHold = { year: 1, season: "winter", defenses: true };
		expect(keysFor(seededActor({ steadingFlags: flags }))).not.toContain("muster");
	});

	it("dates Tor's blessing the same way", () => {
		const flags = fixtureSteadingFlags();
		flags.torsBlessing = "1:winter";
		expect(keysFor(seededActor({ steadingFlags: flags }))).not.toContain("torsBlessing");
	});

	// Before a world's first Seasons Change nothing has turned, so nothing can be overdue.
	it("shows no seasonal dues on a world whose clock was never stamped", () => {
		const keys = keysFor(seededActor({ season: "", steadingFlags: fixtureSteadingFlags() }));
		for (const k of ["standingWatch", "weaponsUpkeep"]) expect(keys, k).not.toContain(k);
	});
});

// ── Running it, turning the season, running it again ────────────────────────────
// The macro is re-runnable, and re-running is the only way to fill the tray in a season it did
// not seed: three of the held states expire by ceasing to match the clock. The guards are
// pinned against the macro's own source below; this models what they DO, so the stale-stamp
// bug they exist to prevent fails here as a dark chip rather than in a world.
// ── The two halves of the clock, disagreeing ────────────────────────────────────
// Every fixture above sets the picker's year to the stamped one, which is true for three
// seasons in four and false for the whole of a winter: Done on a winter stamps `{winter, Y}`
// and advances the picker to Y+1, because it has closed the year out.
//
// The tray reads its markers back with the STAMP's year for that reason. Asking the picker
// instead made a settled winter re-light: the window wrote `Y:winter` on its way through and
// the tray then asked for `Y+1:winter`, so the watch and the herd both came back due, on a
// steading that had just fed them.
describe("a winter the Seasons Change has already closed", () => {
	const built = { completed: true, applied: null, r: Array(16).fill(true) };
	const settled = {
		improvements: { standingWatch: { ...built }, herdOfHorses: { ...built } },
		herd: { grown: 12, yearlings: 0, foals: 0 },
		seasonSteps: { standingWatch: "1:winter", feedHerd: "1:winter" },
		system: { attributes: { surplus: { value: 4 } } },
	};
	const keys = () => keysFor(seededActor({ season: "winter", year: 1, pickerYear: 2, steadingFlags: settled }));

	it("leaves the upkeep it settled settled", () => {
		expect(keys()).not.toContain("standingWatch");
		expect(keys()).not.toContain("herdFeed");
	});

	// The same read, unsettled, still dues them — so the test above is not passing because the
	// rows have simply stopped being reachable.
	it("still dues them when they were never settled", () => {
		const unpaid = { ...settled, seasonSteps: {} };
		const k = keysFor(seededActor({ season: "winter", year: 1, pickerYear: 2, steadingFlags: unpaid }));
		expect(k).toContain("standingWatch");
		expect(k).toContain("herdFeed");
	});
});

describe("re-running the fixture after the season turns", () => {
	/** The macro's hold seeding, as a function of the flags it finds and the clock it reads. */
	function seedHolds(sf, { season, year }) {
		const stamp = `${year}:${season}`;
		const built = { completed: true, applied: null, r: Array(16).fill(true) };
		if (!sf.musterHold) sf.musterHold = { year, season, defenses: true };
		else if (`${sf.musterHold.year}:${sf.musterHold.season}` !== stamp && sf.musterHold.defenses === true) {
			sf.musterHold = { ...sf.musterHold, year, season };
		}
		if (!sf.fortunesAdvantage) sf.fortunesAdvantage = { source: "Sacrifice (Rites of the Land)" };
		if (sf.torsBlessing !== stamp) sf.torsBlessing = stamp;
		if (sf.winterDebt?.stamp !== `${year}:winter`) sf.winterDebt = { stamp: `${year}:winter`, amount: 3 };
		sf.improvements = { ...(sf.improvements ?? {}) };
		for (const slug of ["inn", "standingWatch", "weaponsOfWar", "herdOfHorses", "wellTrainedMilitia"]) {
			if (!sf.improvements[slug]?.completed) sf.improvements[slug] = { ...built };
		}
		sf.system ??= {
			stats: { defenses: { value: 1 } },
			attributes: {
				surplus: { value: 1 },
				debilities: { options: { diminished: { value: false }, lacking: { value: true }, malcontent: { value: false } } },
			},
		};
		// The seasonal markers are cleared for the season being seeded, so the dues read unpaid.
		for (const step of ["innGathering", "standingWatch", "weaponsUpkeep", "advanceHerd", "feedHerd", "militiaDrill"]) {
			if (sf.seasonSteps) delete sf.seasonSteps[step];
		}
		return sf;
	}

	const expected = {
		spring: ["fortunesAdvantage", "muster", "torsBlessing", "innGathering", "standingWatch", "weaponsUpkeep"],
		summer: ["fortunesAdvantage", "muster", "torsBlessing", "herdAdvance", "innGathering", "standingWatch", "militiaTraining"],
		autumn: ["fortunesAdvantage", "muster", "torsBlessing", "innGathering", "standingWatch"],
		winter: ["fortunesAdvantage", "muster", "torsBlessing", "innGathering", "standingWatch", "herdFeed", "winterDebt"],
	};

	it("fills the tray for whichever season it is re-run in", () => {
		const sf = seedHolds({}, { season: "spring", year: 1 });
		expect(keysFor(seededActor({ season: "spring", steadingFlags: sf }))).toEqual(expected.spring);

		for (const season of ["summer", "autumn", "winter"]) {
			seedHolds(sf, { season, year: 1 });
			expect(keysFor(seededActor({ season, steadingFlags: sf })), season).toEqual(expected[season]);
		}
	});

	// Without the re-stamp, a re-run that only seeded ABSENT flags would find the spring seed
	// present, leave it, and hand back a summer tray with the muster and the blessing dark.
	it("would go dark on a re-run that only seeded what was absent", () => {
		const sf = seedHolds({}, { season: "spring", year: 1 });
		const seedIfAbsent = f => {
			if (!f.musterHold) f.musterHold = { year: 1, season: "summer", defenses: true };
			if (!f.torsBlessing) f.torsBlessing = "1:summer";
			return f;
		};
		const keys = keysFor(seededActor({ season: "summer", steadingFlags: seedIfAbsent(sf) }));
		for (const k of ["muster", "torsBlessing"]) expect(keys, k).not.toContain(k);
	});

	// The debt is the odd one: it is stamped for WINTER whatever season seeded it, so it
	// survives the season turning and goes stale only when the YEAR does. Re-running in a later
	// winter has to re-date it, or the chip is lit exactly once in a campaign's life.
	it("re-dates the winter debt into the year the world has reached", () => {
		const sf = seedHolds({}, { season: "spring", year: 1 });
		expect(sf.winterDebt.stamp).toBe("1:winter");
		expect(keysFor(seededActor({ season: "winter", year: 1, steadingFlags: sf }))).toContain("winterDebt");

		// Year two, before the re-run: the year-one debt no longer matches the clock.
		expect(keysFor(seededActor({ season: "winter", year: 2, steadingFlags: sf }))).not.toContain("winterDebt");

		seedHolds(sf, { season: "winter", year: 2 });
		expect(sf.winterDebt.stamp).toBe("2:winter");
		expect(keysFor(seededActor({ season: "winter", year: 2, steadingFlags: sf }))).toContain("winterDebt");
	});

	// A re-run must not pay for the muster's +1 Defenses twice: a lapsed muster still has the
	// first one on the sheet, since only a stand-down or the Seasons Change gives it back.
	it("keeps the same muster across a re-stamp rather than raising a second", () => {
		const sf = seedHolds({}, { season: "spring", year: 1 });
		const raised = sf.musterHold;
		seedHolds(sf, { season: "summer", year: 1 });
		expect(sf.musterHold.defenses).toBe(true);
		expect(sf.musterHold.season).toBe("summer");
		expect(raised.defenses).toBe(true);
	});

	// Someone else's lapsed muster is theirs. The fixture marks its own with the +1 pick.
	it("leaves a lapsed muster that never took the +1 Defenses alone", () => {
		const sf = seedHolds({}, { season: "spring", year: 1 });
		sf.musterHold = { year: 1, season: "spring", defenses: false };
		seedHolds(sf, { season: "summer", year: 1 });
		expect(sf.musterHold.season).toBe("spring");
		expect(keysFor(seededActor({ season: "summer", steadingFlags: sf }))).not.toContain("muster");
	});
});

describe("the fixture macro itself", () => {
	const MACRO = read("scripts/local/create-test-characters.js");

	it("seeds every piece the tray reads", () => {
		for (const needle of [
			"sf.fortunesAdvantage", "sf.musterHold", "sf.torsBlessing", "sf.winterDebt",
			"TEST_HOLD_IMPROVEMENTS", "TEST_HOLD_STEPS",
		]) expect(MACRO, needle).toContain(needle);
	});

	// The herd feeds two chips, and it is the improvement that must be BUILT for either to
	// exist — a seed that drops it leaves summer and winter a chip short with nothing to say so.
	it("builds the herd, and clears both of its seasonal markers", () => {
		expect(MACRO).toContain('"herdOfHorses"');
		expect(MACRO).toContain('"advanceHerd"');
		expect(MACRO).toContain('"feedHerd"');
	});

	// Stamped for WINTER whatever the seeded clock says: it is the one chip that cannot exist
	// in another season, so a spring stamp would seed a debt that has already expired.
	it("dates the winter debt to winter rather than to the seeded season", () => {
		const at = MACRO.indexOf("const winterStamp");
		expect(at).toBeGreaterThan(-1);
		expect(MACRO.slice(at, at + 300)).toContain(":winter`");
	});

	// The macro is re-runnable, and that is the ONLY way to see another season's tray: three of
	// the held states expire by ceasing to match the clock, so a seed made in spring is dead in
	// summer. A guard that only fires when the flag is ABSENT would find it present, leave the
	// stale stamp, and hand back a tray three chips short with nothing to say why.
	it("re-stamps the clock-scoped holds instead of only seeding them when absent", () => {
		expect(MACRO).toContain("if (sf.torsBlessing !== holdStamp)");
		expect(MACRO).toContain("if (sf.winterDebt?.stamp !== winterStamp)");
		expect(MACRO).toContain("const musterLive");
		// The absent case still raises a muster; the lapsed case re-dates the one it found.
		const at = MACRO.indexOf("const musterLive");
		const block = MACRO.slice(at, at + 2000);
		expect(block).toContain("} else if (musterOurs) {");
		expect(block).toContain("...sf.musterHold, year: holdYearNum, season: holdSeason");
	});

	// A lapsed muster still has its +1 Defenses sitting on the sheet: the point only comes back
	// when the muster is stood down or the Seasons Change folds the lapse into its own write.
	// Re-dating must therefore NOT pay for it a second time, or a later stand-down hands back
	// one point out of two.
	it("re-dates a lapsed muster without applying a second +1 Defenses", () => {
		const at = MACRO.indexOf("const musterLive");
		const block = MACRO.slice(at, at + 2000);
		const reDate = block.indexOf("} else if (musterOurs) {");
		const tail = block.slice(reDate, block.indexOf("} else {", reDate));
		expect(tail).not.toContain("holdDefenses + 1");
	});

	// The fixture's muster is marked by its +1 Defenses pick, the same signature the cleanup
	// uses. A muster the table raised WITHOUT that pick and then let lapse is theirs, and
	// standing it back up would revive something their fiction had finished with.
	it("leaves a lapsed muster alone when it is not the fixture's own", () => {
		expect(MACRO).toContain("const musterOurs = sf.musterHold?.defenses === true");
		expect(MACRO).toContain("The muster chip is dark");
	});

	// Stored rather than derived, so nothing else would ever clear a stale seeded debt.
	it("takes the seeded winter debt back down again on cleanup", () => {
		expect(MACRO).toContain("-=winterDebt");
		expect(MACRO).toContain("steadingFlags.winterDebt?.amount === TEST_HOLD_WINTER_DEBT");
	});

	// setFlag MERGES, so a sub-key dropped off the object it is handed survives untouched in
	// the stored flags. The seasonal dues would then stay hidden on every re-run but the first.
	it("clears the season-step markers with the deletion syntax, not with delete", () => {
		expect(MACRO).toContain("steading.seasonSteps.-=");
		expect(MACRO).not.toMatch(/delete sf\.seasonSteps/);
	});

	// ── The half the tray cannot show ────────────────────────────────────────────
	// Nine more improvements whose seasonal clauses the Seasons Change WINDOW reads: they rewrite
	// the harvest and winter's bill, or hand over Surplus inside the window. None earns a glyph,
	// so nothing about the header would ever reveal that the fixture had stopped seeding them.
	it("builds every improvement the Seasons Change window reads, not just the tray's", () => {
		for (const slug of [
			"market", "township", "harnessingStream", "raincatching",
			"greaterHarvest", "mill", "additionalHousing", "stoneWall", "aurochsHunting",
		]) expect(MACRO, slug).toContain(`"${slug}"`);
		expect(MACRO).toContain("TEST_SEASON_IMPROVEMENTS");
		expect(MACRO).toContain("[...TEST_HOLD_IMPROVEMENTS, ...TEST_SEASON_IMPROVEMENTS]");
	});

	// A GM who ran the move once this season would otherwise re-open it to a window of spent
	// buttons, which reads as broken rather than as already-done.
	it("clears the window's own markers too, not only the tray's", () => {
		expect(MACRO).toContain("TEST_SEASON_STEPS");
		expect(MACRO).toContain("[...TEST_HOLD_STEPS, ...TEST_SEASON_STEPS]");
		for (const step of ["marketYield", "townshipYield", "streamYield", "raincatchingYield", "surplus", "consumption"]) {
			expect(MACRO, step).toContain(`"${step}"`);
		}
	});

	// Two, not five: "when the militia has trained in 2+ tactics, increase Defenses by 1", so
	// forgetting the second is the loss that changes a number and the window says so. Five would
	// take four summers to reach that moment, one tactic per season marker.
	it("trains the militia in exactly two tactics, so the drop below 2+ is one click away", () => {
		expect(MACRO).toContain("const TEST_MILITIA_R = [true, true, true, false, false, false]");
		expect(MACRO).toContain(`r: slug === "wellTrainedMilitia" ? [...TEST_MILITIA_R] : Array(16).fill(true)`);
	});

	// The cleanup identifies its own seed by that requirement array, so the militia's shape must
	// count for the militia and nothing else — an inn that happened to hold six boxes in that
	// pattern is the table's, not ours.
	it("recognises the militia's shape only for the militia", () => {
		const at = MACRO.indexOf("const fixtureR");
		expect(at).toBeGreaterThan(-1);
		const block = MACRO.slice(at, at + 600);
		expect(block).toContain(`slug === "wellTrainedMilitia"`);
		expect(block).toContain("r.length === 16 && r.every(Boolean)");
	});

	// Topped UP, never overwritten, on the same rule as the Notes and the settlement standings.
	// A steading the GM ran down to its last Surplus is telling the truth about its own winter.
	it("tops Surplus and Population up rather than setting them", () => {
		expect(MACRO).toContain("if (holdSurplus < TEST_HOLD_SURPLUS)");
		expect(MACRO).toContain("if (holdPopulation < TEST_HOLD_POPULATION)");
		// Population is the Market's own gate: "and Population is +1 or better".
		expect(MACRO).toContain("const TEST_HOLD_POPULATION   = 1");
	});

	// Recording `defenses: true` without moving the stat would seed a muster whose +1 does not
	// exist, and the first stand-down would then subtract a point never gained.
	// Bounded by the branch it is about (the no-muster case) rather than by a character count,
	// which a comment added above it silently walked past.
	it("actually applies the +1 Defenses its seeded muster claims", () => {
		const at = MACRO.indexOf("if (!sf.musterHold) {");
		expect(at).toBeGreaterThan(-1);
		const block = MACRO.slice(at, MACRO.indexOf("} else if (musterLive)", at));
		expect(block).toContain("holdDefenses + 1");
		expect(block).toContain("defenses: true");
	});

	// An undefined `applied` on a completed improvement means "finished before the grants
	// engine shipped", which back-fills a presumed footprint and would revert grants that were
	// never made. Null says the true thing: this macro granted nothing.
	it("says explicitly that it granted nothing, rather than leaving it undefined", () => {
		const at = MACRO.indexOf("const improvementsSeeded");
		expect(at).toBeGreaterThan(-1);
		const block = MACRO.slice(at, at + 900);
		expect(block).toContain("completed: true,");
		expect(block).toContain("applied: null,");
		// And the cleanup only takes back what carries that signature.
		expect(MACRO).toContain("entry.applied !== null) continue;");
	});

	// The macro must not overwrite a steading that already holds these for real.
	it("seeds each held state only when it is absent", () => {
		expect(MACRO).toContain("if (!sf.musterHold)");
		expect(MACRO).toContain("if (!sf.fortunesAdvantage)");
		expect(MACRO).toContain("if (sf.improvements[slug]?.completed) continue;");
	});
});
