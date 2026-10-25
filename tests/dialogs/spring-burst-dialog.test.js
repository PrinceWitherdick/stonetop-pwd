import { describe, it, expect, vi, beforeEach } from "vitest";

// "Let Spring Burst Forth": what its Done records, how its answers are written, and the presses
// it must not act on twice. The walkthrough's own pieces are mocked; what is under test is the
// dialog's handling of them.

let setting = {};
const writes = [];
vi.mock("../../module/settings.js", () => ({
	getSetting: () => setting,
	setWorldSetting: vi.fn(async (_key, value) => {
		// A slow server: the write lands a tick later, which is what lets two unqueued writes race.
		await new Promise(r => setTimeout(r, 5));
		setting = value;
		writes.push(value);
	}),
}));
const recordSeasonsChange = vi.fn(async () => ({}));
let recorded = false;
vi.mock("../../module/seasons/seasons-chronicle.js", () => ({
	recordSeasonsChange: (...a) => recordSeasonsChange(...a),
	hasRecordedSeason: () => recorded,
}));
const recordCurrentSeason = vi.fn(async () => {});
vi.mock("../../module/seasons/current-season.js", () => ({
	readCurrentSeason: () => null,
	recordCurrentSeason: (...a) => recordCurrentSeason(...a),
	seasonRank: () => 0,
}));
let steading = null;
vi.mock("../../module/utils/world.js", () => ({ getStonetopSteadingActor: () => steading }));
const saveChronicleFromButton = vi.fn(async () => true);
vi.mock("../../module/utils/chronicle.js", () => ({ saveChronicleFromButton: (...a) => saveChronicleFromButton(...a) }));
const postSeasonsRollPrompt = vi.fn();
vi.mock("../../module/utils/roll-engine.js", () => ({
	postSeasonsRollPrompt: (...a) => postSeasonsRollPrompt(...a),
	SPRING_SEASONS_RESULT: { success: { label: "10+" }, partial: { label: "7-9" }, failure: { label: "6-" } },
}));
vi.mock("../../module/seasons/seasons-change-reminders.js", async (orig) => ({ ...(await orig()), postSeasonsChangeReminder: vi.fn() }));
let confirmAnswer = false;
const confirmOutcome = vi.fn(async () => confirmAnswer);
vi.mock("../../module/utils/ask-with-buttons.js", () => ({ confirmOutcome: (...a) => confirmOutcome(...a) }));
vi.mock("../../module/dialogs/walkthrough-resume.js", () => ({
	markWalkthroughDone: vi.fn(),
	getWalkthroughResume: () => ({}),
	patchWalkthroughResume: vi.fn(),
	saveWalkthroughPosition: vi.fn(),
}));

const { SpringBurstDialog } = await import("../../module/dialogs/SpringBurstDialog.js");

/** A steading the first spring's gains can land on, once. */
function steadingActor({ alreadyApplied = false } = {}) {
	const typed = {
		seasonStepApplied: () => alreadyApplied,
		seasonStepFlags: () => ({}),
		getStatValue: () => 0,
		torsBlessingFlags: () => ({}),
		applyChanges: vi.fn(async () => {}),
	};
	return { typedActor: typed };
}

let notices;
beforeEach(() => {
	setting = {};
	writes.length = 0;
	recorded = false;
	steading = null;
	confirmAnswer = false;
	notices = [];
	vi.clearAllMocks();
	globalThis.game = { ...(globalThis.game ?? {}), user: { isGM: true } };
	globalThis.ui = { notifications: { info: m => notices.push(m), warn: m => notices.push(m), error: m => notices.push(m) } };
});

const dialog = () => {
	const d = new SpringBurstDialog();
	d.render = vi.fn();
	d.close = vi.fn(async () => {});
	return d;
};

describe("opening it", () => {
	it("is the GM's alone", () => {
		globalThis.game.user = { isGM: false };
		expect(SpringBurstDialog.open()).toBeNull();
		expect(notices[0]).toMatch(/Only the GM/);
	});
});

describe("ticking gains and writing answers", () => {
	it("keeps both of two quick ticks", async () => {
		const d = dialog();
		await Promise.all([d._saveGain("tor", true), d._saveGain("bounty", true)]);
		expect(setting.gains).toEqual({ tor: true, bounty: true });
	});

	it("keeps a tick and an answer written at the same moment", async () => {
		const d = dialog();
		await Promise.all([d._saveGain("tor", true), d._saveAnswer("hook", "Trouble at the ford."), d._saveAnswer("excites", "Fights", "pc1")]);
		expect(setting).toEqual({ gains: { tor: true }, hook: "Trouble at the ford.", excites: { pc1: "Fights" } });
	});

	// The queue lives on StepperDialog (_updateAnswers): a write that fails reaches its caller and
	// the next one still runs, from a copy, so the failed edit never sits half-made in the stored blob.
	it("goes on after a failed write, without leaving the failed edit in the stored answers", async () => {
		const { setWorldSetting } = await import("../../module/settings.js");
		const d = dialog();
		const before = { gains: {} };
		setting = before;
		setWorldSetting.mockImplementationOnce(async () => { throw new Error("offline"); });
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failed = d._saveGain("tor", true);
		const next = d._saveGain("bounty", true);
		await expect(failed).rejects.toThrow("offline");
		await next;
		expect(before).toEqual({ gains: {} });
		expect(setting.gains).toEqual({ bounty: true });
	});
});

describe("asking the most hopeful to roll", () => {
	it("posts one card for a double click", async () => {
		const d = dialog();
		await Promise.all([d._askToRoll(), d._askToRoll()]);
		expect(postSeasonsRollPrompt).toHaveBeenCalledTimes(1);
	});

	it("asks before posting a second card for the same spring", async () => {
		const d = dialog();
		await d._askToRoll();
		await d._askToRoll();
		expect(confirmOutcome).toHaveBeenCalledTimes(1);
		expect(postSeasonsRollPrompt).toHaveBeenCalledTimes(1);
		confirmAnswer = true;
		await d._askToRoll();
		expect(postSeasonsRollPrompt).toHaveBeenCalledTimes(2);
	});
});

describe("Done", () => {
	const button = () => ({ disabled: false });

	it("records the gains it granted", async () => {
		steading = steadingActor();
		setting = { gains: { tor: true, news: true }, hook: "A hook." };
		await dialog()._finish(button());
		expect(recordSeasonsChange).toHaveBeenCalledTimes(1);
		expect(recordSeasonsChange.mock.calls[0][0]).toMatchObject({ seasonId: "spring", year: 1, gainNames: ["Tor's blessing", "Interesting news"], notes: "A hook." });
	});

	it("records no gain when there is no steading to grant it to", async () => {
		setting = { gains: { tor: true } };
		await dialog()._finish(button());
		expect(recordSeasonsChange.mock.calls[0][0].gainNames).toEqual([]);
	});

	it("leaves an already-recorded spring alone when it is run again", async () => {
		steading = steadingActor({ alreadyApplied: true });
		recorded = true;
		setting = { gains: { bounty: true } };
		const d = dialog();
		await d._finish(button());
		expect(recordSeasonsChange).not.toHaveBeenCalled();
		expect(notices.some(n => /already in the Seasons Change journal/.test(n))).toBe(true);
		expect(d.close).toHaveBeenCalled();
	});

	it("runs once for a double click, and keeps the button disabled on the way out", async () => {
		saveChronicleFromButton.mockImplementation(async (b, { keepDisabled }) => { b.disabled = true; expect(keepDisabled).toBe(true); return true; });
		const d = dialog();
		const b = button();
		await Promise.all([d._finish(b), d._finish(b)]);
		expect(saveChronicleFromButton).toHaveBeenCalledTimes(1);
		expect(d.close).toHaveBeenCalledTimes(1);
		expect(b.disabled).toBe(true);
	});

	// A first press that granted the gains, then failed to write them down: the retry finds them already
	// granted and must still name them, not record a spring with no gains.
	it("names the gains granted by a failed first press when Done is pressed again", async () => {
		let applied = false;
		steading = steadingActor();
		steading.typedActor.seasonStepApplied = () => applied;
		steading.typedActor.applyChanges = vi.fn(async () => { applied = true; });
		setting = { gains: { tor: true } };
		recordSeasonsChange.mockRejectedValueOnce(new Error("offline"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		const d = dialog();
		await d._finish(button());
		expect(d.close).not.toHaveBeenCalled();
		// The GM unticks a gain before retrying: what the first press granted is what is recorded.
		setting = { gains: { tor: false, news: true } };
		await d._finish(button());
		expect(steading.typedActor.applyChanges).toHaveBeenCalledTimes(1);
		expect(recordSeasonsChange.mock.calls.at(-1)[0].gainNames).toEqual(["Tor's blessing"]);
		// After a reload the window has no memory of it, and the walkthrough's own stamp says the picks were granted.
		recordSeasonsChange.mockClear();
		setting = { gains: { tor: true } };
		await dialog()._finish(button());
		expect(recordSeasonsChange.mock.calls[0][0].gainNames).toEqual(["Tor's blessing"]);
	});

	it("gives the button back when finishing fails after the save", async () => {
		saveChronicleFromButton.mockImplementation(async b => { b.disabled = true; return true; });
		recordCurrentSeason.mockRejectedValueOnce(new Error("no"));
		const d = dialog();
		const b = button();
		vi.spyOn(console, "error").mockImplementation(() => {});
		await d._finish(b);
		expect(b.disabled).toBe(false);
		expect(d.close).not.toHaveBeenCalled();
	});
});
