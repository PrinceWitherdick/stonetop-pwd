import { describe, expect, it } from "vitest";
import { progressLabel, progressFor, isMidCreation } from "../../../module/actors/character/onboarding-progress.js";

// A character as these helpers read one: the progress flag, the committed playbook, and the
// flag a real Finish stamps.
const actorWith = (flag, playbook = null, finished = undefined) => ({
	getFlag: (_scope, key) => (
		key === "onboardingProgress" ? flag :
		key === "creationFinished" ? finished :
		undefined
	),
	system:  { playbook },
});

const BLESSED = { slug: "the-blessed", name: "The Blessed" };

describe("progressLabel", () => {
	it("reads Finished once creation was really finished, whatever the progress flag says", () => {
		const stale = progressLabel({ state: "exited", playbook: "The Judge" }, BLESSED, true);
		expect(stale.status).toBe("finished");
		expect(stale.text).toBe("Finished");
		expect(stale.playbook).toBe("The Blessed");
	});

	// Every character made before the finished flag existed: a playbook and nothing in progress.
	it("reads Finished for a committed playbook with no live progress, flag or no flag", () => {
		expect(progressLabel(undefined, BLESSED).status).toBe("finished");
	});

	// "Save & close" commits the playbook part-way through. That is not a finished character, and
	// the roster and the replace warning must both still see the work a delete would destroy.
	it("reads a saved-and-closed character where it stopped, naming its committed playbook", () => {
		const saved = progressLabel({ state: "onboarding", step: 4, total: 9, playbook: "The Judge" }, BLESSED);
		expect(saved).toMatchObject({ status: "onboarding", text: "on page 4 of 9", playbook: "The Blessed" });
		expect(progressLabel({ state: "exited" }, BLESSED).status).toBe("exited");
	});

	it("reads not-started with no flag and no playbook", () => {
		expect(progressLabel(undefined, null)).toMatchObject({ status: "not-started", playbook: "" });
	});

	it("names the in-progress playbook the flow stamped, which the GM can't read otherwise", () => {
		const p = progressLabel({ state: "onboarding", step: 4, total: 9, playbook: "The Marshal" }, null);
		expect(p.status).toBe("onboarding");
		expect(p.text).toBe("on page 4 of 9");
		expect(p.playbook).toBe("The Marshal");
	});

	it("distinguishes the picker and an explicit exit", () => {
		expect(progressLabel({ state: "picker" }, null).status).toBe("picker");
		expect(progressLabel({ state: "exited" }, null).status).toBe("exited");
	});

	it("still shows a legacy/partial flag as mid-creation rather than dropping the player", () => {
		expect(progressLabel({ step: 2 }, null)).toMatchObject({ status: "onboarding", text: "in character creation" });
		// A legacy flag with a usable count keeps its page reading.
		expect(progressLabel({ step: 2, total: 7 }, null).text).toBe("on page 2 of 7");
	});
});

describe("isMidCreation", () => {
	it("is true for every live creation state — work exists that a delete would destroy", () => {
		for (const flag of [{ state: "picker" }, { state: "onboarding", step: 3, total: 9 }, { state: "exited" }]) {
			expect(isMidCreation(actorWith(flag))).toBe(true);
		}
	});

	it("is false for an untouched character and for a finished one", () => {
		expect(isMidCreation(actorWith(undefined))).toBe(false);
		expect(isMidCreation(actorWith({ state: "onboarding", step: 9, total: 9 }, { slug: "the-heavy", name: "The Heavy" }, true))).toBe(false);
		expect(isMidCreation(actorWith(undefined, { slug: "the-heavy", name: "The Heavy" }))).toBe(false);
	});

	it("is true for a committed playbook that was saved and closed rather than finished", () => {
		expect(isMidCreation(actorWith({ state: "exited", playbook: "The Heavy" }, { slug: "the-heavy", name: "The Heavy" }))).toBe(true);
	});

	it("survives an actor that can't answer (a bare object, a missing document)", () => {
		expect(isMidCreation(undefined)).toBe(false);
		expect(isMidCreation({})).toBe(false);
	});
});

describe("progressFor", () => {
	it("reads the flag straight off the actor", () => {
		expect(progressFor(actorWith({ state: "onboarding", step: 1, total: 5 })).text).toBe("on page 1 of 5");
	});
});

// Closing the picker and leaving the walkthrough both write "exited"; only the walkthrough stamps
// a playbook, so a bare one means the player only got as far as the picker.
describe("the exited note", () => {
	it("says the picker was closed when no playbook was ever chosen", () => {
		expect(progressLabel({ state: "exited" }, null).text).toBe("closed the playbook picker");
	});

	it("says onboarding was exited once a playbook is in play", () => {
		expect(progressLabel({ state: "exited", playbook: "The Fox" }, null).text).toBe("exited onboarding");
	});
});
