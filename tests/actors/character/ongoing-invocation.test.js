import { describe, expect, it } from "vitest";
import {
	ONGOING_INVOCATION_FLAG, readOngoing, prettifySlug, invocationLabel,
	resolveInvocationUse, invokeNotice,
} from "../../../module/actors/character/ongoing-invocation.js";
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
			.toEqual({ next: "warmth-of-the-sun", ended: "", changed: true });
	});

	it("holds nothing after an instant one", () => {
		expect(resolveInvocationUse({ current: "", used: use("bath-of-healing-light", false) }))
			.toEqual({ next: "", ended: "", changed: false });
	});

	it("swaps one ongoing Invocation for another", () => {
		expect(resolveInvocationUse({ current: "warmth-of-the-sun", used: use("blinding-light", true) }))
			.toEqual({ next: "blinding-light", ended: "warmth-of-the-sun", changed: true });
	});

	// "While one Invocation is ongoing, you can't use another" bars ALL of them, not just the
	// other ongoing ones — so an instant Invocation costs you the one you were holding.
	it("spends the ongoing one on an instant Invocation", () => {
		expect(resolveInvocationUse({ current: "warmth-of-the-sun", used: use("bath-of-healing-light", false) }))
			.toEqual({ next: "", ended: "warmth-of-the-sun", changed: true });
	});

	// Renewing must not report an ending: the chat card would say it stopped in the same breath
	// as its own card saying it started, and the flag write would be a no-op broadcast.
	it("renews the one already running without ending anything", () => {
		expect(resolveInvocationUse({ current: "warmth-of-the-sun", used: use("warmth-of-the-sun", true) }))
			.toEqual({ next: "warmth-of-the-sun", ended: "", changed: false });
	});

	it("survives being asked about nothing at all", () => {
		expect(resolveInvocationUse()).toEqual({ next: "", ended: "", changed: false });
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
