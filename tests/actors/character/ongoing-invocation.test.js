import { describe, expect, it } from "vitest";
import {
	ONGOING_INVOCATION_FLAG, readOngoing, prettifySlug, invocationLabel,
	resolveInvocationUse, resolveInvocationEnd, invokeNotice, readInvocationState, usesOngoing,
	ONGOING_INVOCATION_FLAGS, EMPOWERED_MAKES_ONGOING, REDUCED_IS_BRIEF, REDUCED_GM_CHOICE, reducedEndings,
} from "../../../module/actors/character/ongoing-invocation.js";
import { expectedInvocationCount, invocationCountCue } from "../../../module/actors/character/invocation-count.js";
import { loadPlaybookDefs } from "../../fakes/sourcePack.js";

// The rules the Invocations tab has always printed and nothing ever enforced: one Invocation at
// a time, using another ends the first, and the light going out ends it too. These cover the
// decision table on its own, with no Foundry and no sheet in sight.

const OPTIONS = [
	{ slug: "warmth-of-the-sun",     label: "Warmth of the Sun",     ongoing: true },
	{ slug: "blinding-light",        label: "Blinding Light",        ongoing: true },
	{ slug: "bath-of-healing-light", label: "Bath of Healing Light", ongoing: false },
];

const use = (slug, ongoing) => ({ slug, ongoing });

describe("the ongoing-Invocation flag", () => {
	it("is keyed on ongoingInvocation", () => {
		expect(ONGOING_INVOCATION_FLAG).toBe("ongoingInvocation");
	});

	// getFlag answers null on a miss, and a hand-edited world can put anything in there.
	it("reads nothing as no Invocation at all", () => {
		for (const raw of [null, undefined, "", "   ", 0, false, {}, ["warmth-of-the-sun"]]) {
			expect(readOngoing(raw)).toBe("");
		}
		expect(readOngoing("  warmth-of-the-sun  ")).toBe("warmth-of-the-sun");
	});
});

describe("naming an Invocation", () => {
	it("takes the printed label from the playbook's own list", () => {
		expect(invocationLabel("warmth-of-the-sun", OPTIONS)).toBe("Warmth of the Sun");
	});

	it("is empty when nothing is running, so the label doubles as the test", () => {
		expect(invocationLabel("", OPTIONS)).toBe("");
		expect(invocationLabel(null, OPTIONS)).toBe("");
	});

	// The stranded case: a playbook swapped away mid-Invocation leaves a slug with no list to
	// look it up in, and the player still has to be able to READ what they are holding to end it.
	it("falls back to the slug when the playbook is gone", () => {
		expect(invocationLabel("hold-back-the-darkness", null)).toBe("Hold Back the Darkness");
		expect(invocationLabel("hold-back-the-darkness", [])).toBe("Hold Back the Darkness");
	});

	// Which is only worth anything if the fallback actually reproduces the printed names — so it
	// is checked against the real content rather than against a hand-written example.
	it("reproduces every real Invocation's name from its slug alone", () => {
		const { byName } = loadPlaybookDefs();
		const options = byName.get("The Lightbearer")?.invocations?.options ?? [];
		expect(options.length, "the Lightbearer's Invocations are gone").toBeGreaterThan(0);
		for (const opt of options) expect(prettifySlug(opt.slug)).toBe(opt.label);
	});
});

describe("what using an Invocation does to the one already running", () => {
	it("starts concentrating on an ongoing one", () => {
		expect(resolveInvocationUse({ current: "", used: use("warmth-of-the-sun", true) }))
			.toMatchObject({ next: "warmth-of-the-sun", second: "", ended: [], changed: true });
	});

	it("holds nothing after an instant one", () => {
		expect(resolveInvocationUse({ current: "", used: use("bath-of-healing-light", false) }))
			.toMatchObject({ next: "", ended: [], changed: false });
	});

	it("swaps one ongoing Invocation for another", () => {
		expect(resolveInvocationUse({ current: "warmth-of-the-sun", used: use("blinding-light", true) }))
			.toMatchObject({ next: "blinding-light", ended: ["warmth-of-the-sun"], changed: true });
	});

	// "While one Invocation is ongoing, you can't use another" bars ALL of them, not just the
	// other ongoing ones — so an instant Invocation costs you the one you were holding.
	it("spends the ongoing one on an instant Invocation", () => {
		expect(resolveInvocationUse({ current: "warmth-of-the-sun", used: use("bath-of-healing-light", false) }))
			.toMatchObject({ next: "", ended: ["warmth-of-the-sun"], changed: true });
	});

	// Renewing must not report an ending: the chat card would say it stopped in the same breath
	// as its own card saying it started, and the flag write would be a no-op broadcast.
	it("renews the one already running without ending anything", () => {
		expect(resolveInvocationUse({ current: "warmth-of-the-sun", used: use("warmth-of-the-sun", true) }))
			.toMatchObject({ next: "warmth-of-the-sun", ended: [], changed: false });
	});

	it("survives being asked about nothing at all", () => {
		expect(resolveInvocationUse()).toMatchObject({ next: "", second: "", ended: [], changed: false });
	});
});

describe("the second slot and the flags behind it", () => {
	it("keeps each slot in its own scalar flag, all five listed for clearing", () => {
		expect(ONGOING_INVOCATION_FLAGS).toEqual([
			"ongoingInvocation", "ongoingInvocationSecond", "ongoingInvocationEmpowered",
			"ongoingInvocationSnuff", "ongoingInvocationSecondSnuff",
		]);
	});

	it("promotes a lone second slot into the first, and drops a second that repeats the first", () => {
		expect(readInvocationState({ second: "warmth-of-the-sun", secondSnuff: true }))
			.toEqual({ primary: "warmth-of-the-sun", second: "", empowered: false, snuff: true, secondSnuff: false });
		expect(readInvocationState({ primary: "blinding-light", second: "blinding-light" }).second).toBe("");
		expect(readInvocationState("  blinding-light ").primary).toBe("blinding-light");
	});
});

// Burn Twice as Bright: "you may mark a debility to use 2 Invocations at once. Roll once, and apply
// any consequences to both Invocations."
describe("Burn Twice as Bright", () => {
	const both = (a, aOn, b, bOn, extra = {}) => ({ slug: a, ongoing: aOn, also: { slug: b, ongoing: bOn }, ...extra });

	it("fills both slots at once when both are ongoing", () => {
		expect(resolveInvocationUse({ current: "", used: both("warmth-of-the-sun", true, "blinding-light", true) }))
			.toMatchObject({ next: "warmth-of-the-sun", second: "blinding-light", ended: [], changed: true });
	});

	it("holds only the ongoing half when the other is instant", () => {
		expect(resolveInvocationUse({ current: "", used: both("bath-of-healing-light", false, "blinding-light", true) }))
			.toMatchObject({ next: "blinding-light", second: "" });
	});

	it("ends whatever was running that is not one of the pair", () => {
		const out = resolveInvocationUse({ current: { primary: "moth-to-a-flame", second: "blinding-light" },
			used: both("warmth-of-the-sun", true, "blinding-light", true) });
		expect(out).toMatchObject({ next: "warmth-of-the-sun", second: "blinding-light", ended: ["moth-to-a-flame"] });
	});

	// "Apply any consequences to both": empowering is a consequence, so an empowered Cleansing Light
	// paired with anything is ongoing too.
	it("empowers both halves", () => {
		const out = resolveInvocationUse({ current: "",
			used: both("warmth-of-the-sun", true, "cleansing-light", false, { empowered: true }) });
		expect(out).toMatchObject({ next: "warmth-of-the-sun", second: "cleansing-light", empowered: true });
	});
});

// Dancing Light, empowered: "you can use another Invocation through the Dancing Light while it is
// ongoing".
describe("an empowered Dancing Light", () => {
	const dancing = { primary: "dancing-light", empowered: true };

	it("keeps itself and holds the other in the second slot", () => {
		expect(resolveInvocationUse({ current: dancing, used: use("blinding-light", true) }))
			.toMatchObject({ next: "dancing-light", second: "blinding-light", empowered: true, ended: [], changed: true });
	});

	it("replaces only the second slot on the next use through it", () => {
		expect(resolveInvocationUse({ current: { ...dancing, second: "blinding-light" }, used: use("warmth-of-the-sun", true) }))
			.toMatchObject({ next: "dancing-light", second: "warmth-of-the-sun", ended: ["blinding-light"] });
	});

	it("lets an instant one through without ending itself", () => {
		expect(resolveInvocationUse({ current: { ...dancing, second: "blinding-light" }, used: use("bath-of-healing-light", false) }))
			.toMatchObject({ next: "dancing-light", second: "", ended: ["blinding-light"] });
	});

	it("is only a carrier when it was empowered", () => {
		expect(resolveInvocationUse({ current: "dancing-light", used: use("blinding-light", true) }))
			.toMatchObject({ next: "blinding-light", second: "", ended: ["dancing-light"] });
	});

	it("says so in the window, naming what the second slot loses", () => {
		expect(invokeNotice({ current: dancing, used: use("blinding-light", true), options: OPTIONS }))
			.toMatchObject({ kind: "through", ending: "" });
		expect(invokeNotice({ current: { ...dancing, second: "warmth-of-the-sun" }, used: use("blinding-light", true), options: OPTIONS }))
			.toMatchObject({ kind: "through", ending: "Warmth of the Sun" });
	});

	// End it on the Dancing Light: what was going through it goes out with it.
	it("takes the one going through it when it is ended", () => {
		expect(resolveInvocationEnd({ current: { ...dancing, second: "blinding-light" }, ending: "dancing-light" }))
			.toMatchObject({ ended: ["dancing-light", "blinding-light"], changed: true });
	});
});

describe("ending one of two", () => {
	it("promotes the other half of a Burn Twice when the first is ended", () => {
		const out = resolveInvocationEnd({ current: { primary: "warmth-of-the-sun", second: "blinding-light", secondSnuff: true },
			ending: "warmth-of-the-sun" });
		expect(out.state).toMatchObject({ primary: "blinding-light", second: "", snuff: true });
		expect(out.ended).toEqual(["warmth-of-the-sun"]);
	});

	it("ends only the second when the second is ended", () => {
		const out = resolveInvocationEnd({ current: { primary: "warmth-of-the-sun", second: "blinding-light" }, ending: "blinding-light" });
		expect(out.state).toMatchObject({ primary: "warmth-of-the-sun", second: "" });
	});

	it("reports a snuff stamp on what ended", () => {
		expect(resolveInvocationEnd({ current: { primary: "warmth-of-the-sun", snuff: true }, ending: "warmth-of-the-sun" }).snuffs).toBe(true);
		expect(resolveInvocationUse({ current: { primary: "warmth-of-the-sun", snuff: true }, used: use("blinding-light", true) }).snuffs).toBe(true);
	});

	it("names both in the window when a third use would end two", () => {
		expect(invokeNotice({ current: { primary: "warmth-of-the-sun", second: "blinding-light" }, used: use("bath-of-healing-light", false), options: OPTIONS }))
			.toEqual({ kind: "interrupt", ending: "Warmth of the Sun and Blinding Light" });
	});
});

// "Empowered: the invocation is ongoing" (Cleansing Light, p.146).
describe("an empowered Cleansing Light", () => {
	it("is the one Invocation that turns ongoing when empowered", () => {
		expect([...EMPOWERED_MAKES_ONGOING]).toEqual(["cleansing-light"]);
		expect(usesOngoing({ slug: "cleansing-light", ongoing: false, empowered: true })).toBe(true);
		expect(usesOngoing({ slug: "cleansing-light", ongoing: false, empowered: false })).toBe(false);
		expect(usesOngoing({ slug: "bath-of-healing-light", ongoing: false, empowered: true })).toBe(false);
	});

	it("takes the slot when used empowered", () => {
		expect(resolveInvocationUse({ current: "", used: { slug: "cleansing-light", ongoing: false, empowered: true } }))
			.toMatchObject({ next: "cleansing-light", empowered: true, changed: true });
	});
});

describe("what the invoke window warns about", () => {
	it("says nothing about an instant Invocation used with nothing running", () => {
		expect(invokeNotice({ current: "", used: use("bath-of-healing-light", false), options: OPTIONS }))
			.toBeNull();
	});

	it("says an ongoing one will be held open", () => {
		expect(invokeNotice({ current: "", used: use("warmth-of-the-sun", true), options: OPTIONS }))
			.toEqual({ kind: "start", ending: "" });
	});

	it("names the Invocation a swap would cost", () => {
		expect(invokeNotice({ current: "warmth-of-the-sun", used: use("blinding-light", true), options: OPTIONS }))
			.toEqual({ kind: "replace", ending: "Warmth of the Sun" });
	});

	// The one people are surprised by: what they lose is not replaced by anything.
	it("marks an instant Invocation as an interruption, not a swap", () => {
		expect(invokeNotice({ current: "warmth-of-the-sun", used: use("bath-of-healing-light", false), options: OPTIONS }))
			.toEqual({ kind: "interrupt", ending: "Warmth of the Sun" });
	});

	it("calls re-invoking the same one a renewal", () => {
		expect(invokeNotice({ current: "warmth-of-the-sun", used: use("warmth-of-the-sun", true), options: OPTIONS }))
			.toEqual({ kind: "renew", ending: "Warmth of the Sun" });
	});

	it("names a stranded Invocation from its slug", () => {
		expect(invokeNotice({ current: "cold-light-of-day", used: use("blinding-light", true), options: [] }))
			.toEqual({ kind: "replace", ending: "Cold Light of Day" });
	});
});

// B9: how many Invocations the level brings (module/actors/character/invocation-count.js).
describe("the Invocations count cue", () => {
	it("expects 2 + half the level for the Lightbearer, never more than the list", () => {
		expect(expectedInvocationCount({ optionCount: 10, startingCount: 2, level: 1 })).toBe(2);
		expect(expectedInvocationCount({ optionCount: 10, startingCount: 2, level: 7 })).toBe(5);
		expect(expectedInvocationCount({ optionCount: 10, startingCount: 2, level: 20 })).toBe(10);
	});

	// A borrower (Invoke the Sun God through Versatile) learns one at each even level from the one
	// they took the move at, inclusive.
	it("counts a borrower's even levels from the grant level through their own", () => {
		expect(expectedInvocationCount({ optionCount: 10, level: 4, borrowed: true, grantedAtLevel: 4 })).toBe(1);
		expect(expectedInvocationCount({ optionCount: 10, level: 7, borrowed: true, grantedAtLevel: 3 })).toBe(2);
		expect(expectedInvocationCount({ optionCount: 10, level: 3, borrowed: true, grantedAtLevel: 3 })).toBe(0);
	});

	it("says nothing for an unstamped borrower, or a list with nothing in it", () => {
		expect(expectedInvocationCount({ optionCount: 10, level: 6, borrowed: true })).toBeNull();
		expect(expectedInvocationCount({ optionCount: 0, startingCount: 2, level: 6 })).toBeNull();
		expect(invocationCountCue({ known: 1, optionCount: 10, level: 6, borrowed: true })).toBeNull();
	});

	it("flags short and over, and is quiet when the count is right", () => {
		expect(invocationCountCue({ known: 2, optionCount: 10, startingCount: 2, level: 4 }))
			.toEqual({ known: 2, expected: 4, shortfall: 2, overage: 0 });
		expect(invocationCountCue({ known: 5, optionCount: 10, startingCount: 2, level: 4 }))
			.toEqual({ known: 5, expected: 4, shortfall: 0, overage: 1 });
		expect(invocationCountCue({ known: 4, optionCount: 10, startingCount: 2, level: 4 })).toBeNull();
	});
});

// Re-audit 10-18: a reduced Blinding Light "flares only for a moment", a reduced Cold Light of Day "lasts
// only a few moments", and a reduced Moth to a Flame "lasts only briefly OR only some of the named
// creatures are affected (GM's choice)". The first two give up their slot at once; the third is asked.
describe("a reduced short-lived Invocation", () => {
	it("names real, ongoing Invocations of the shipped playbook", () => {
		const { byName } = loadPlaybookDefs();
		const options = byName.get("The Lightbearer")?.invocations?.options ?? [];
		for (const slug of [...REDUCED_IS_BRIEF, ...REDUCED_GM_CHOICE]) {
			expect(options.find(o => o.slug === slug)?.ongoing, slug).toBe(true);
		}
		expect([...REDUCED_IS_BRIEF]).toEqual(["blinding-light", "cold-light-of-day"]);
		expect([...REDUCED_GM_CHOICE]).toEqual(["moth-to-a-flame"]);
	});

	it("ends a running brief one, asks of Moth to a Flame, and leaves any other alone", () => {
		expect(reducedEndings({ current: "blinding-light", slugs: ["blinding-light"] })).toEqual({ brief: ["blinding-light"], ask: [] });
		expect(reducedEndings({ current: "moth-to-a-flame", slugs: ["moth-to-a-flame"] })).toEqual({ brief: [], ask: ["moth-to-a-flame"] });
		expect(reducedEndings({ current: "warmth-of-the-sun", slugs: ["warmth-of-the-sun"] })).toEqual({ brief: [], ask: [] });
	});

	it("acts only on what is still running", () => {
		expect(reducedEndings({ current: "", slugs: ["blinding-light"] })).toEqual({ brief: [], ask: [] });
		expect(reducedEndings({ current: "warmth-of-the-sun", slugs: ["cold-light-of-day"] })).toEqual({ brief: [], ask: [] });
	});

	it("takes each half of a Burn Twice pair on its own", () => {
		const current = { primary: "warmth-of-the-sun", second: "cold-light-of-day" };
		expect(reducedEndings({ current, slugs: ["warmth-of-the-sun", "cold-light-of-day"] })).toEqual({ brief: ["cold-light-of-day"], ask: [] });
		expect(reducedEndings({ current: { primary: "blinding-light", second: "moth-to-a-flame" }, slugs: ["blinding-light", "moth-to-a-flame"] }))
			.toEqual({ brief: ["blinding-light"], ask: ["moth-to-a-flame"] });
	});
});
