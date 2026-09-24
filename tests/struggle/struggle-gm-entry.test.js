import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import { ROW_KIND, STRUGGLE_STATUS, newStruggleRecord, readStruggleRoll, struggleBoard } from "../../module/struggle/struggle-rules.js";
import { struggleCallView } from "../../module/struggle/struggle-view.js";

/**
 * The GM's ways into Struggle as One besides a character's Moves tab: the GM Toolkit's Expeditions
 * tab, and the Run an Expedition walkthrough's journey step, which calls it as part of a journey.
 */

const live = { current: null };
vi.mock("../../module/struggle/struggle-store.js", () => ({
	liveStruggle: () => live.current,
	boardFor: s => struggleBoard(s, () => readStruggleRoll(null, s.id)),
	askForStruggle: vi.fn(), askOf: vi.fn(), askTurnedDown: vi.fn(), currentStruggle: () => live.current,
	owesARoll: vi.fn(), pendingAsks: () => [], struggleHost: () => null, isStruggleHost: () => false, struggleStateChanged: vi.fn(),
	takesPart: () => true,
	touchesFlag: (changes, flag) => Object.keys(changes?.flags?.["stonetop-pwd"] ?? {}).some(k => k.replace(/^-=/, "") === flag),
}));
vi.mock("../../module/struggle/StruggleWindow.js", () => ({
	openStruggleWindow: vi.fn(id => `window:${id}`),
	registerStruggleWindowRestore: vi.fn(),
}));
vi.mock("../../module/struggle/StruggleSetupDialog.js", () => ({
	openStruggleSetup: vi.fn(opts => ({ setup: opts })),
}));

const { answerNextAsk, callStruggleAsOne, gmStruggleCall, onUpdateActorStruggle, openStruggleAsOne, refreshStruggleBars } =
	await import("../../module/struggle/struggle-flow.js");
const { openStruggleWindow } = await import("../../module/struggle/StruggleWindow.js");
const { openStruggleSetup } = await import("../../module/struggle/StruggleSetupDialog.js");

const USER = globalThis.game?.user;
const called = (status = STRUGGLE_STATUS.ROLLING) => ({
	...newStruggleRecord({ id: "s1", rows: [{ kind: ROW_KIND.PC, actorId: "a", name: "A" }, { kind: ROW_KIND.PC, actorId: "b", name: "B" }] }),
	status,
});

beforeEach(() => {
	live.current = null;
	vi.mocked(openStruggleWindow).mockClear();
	vi.mocked(openStruggleSetup).mockClear();
	globalThis.game.user = { id: "gm", isGM: true };
});
afterEach(() => { globalThis.game.user = USER; });

describe("callStruggleAsOne", () => {
	it("opens the setup when nothing is under way, as part of a journey when asked", () => {
		expect(callStruggleAsOne({ journey: true })).toEqual({ setup: { journey: true, onClosed: answerNextAsk } });
		expect(callStruggleAsOne()).toEqual({ setup: { journey: false, onClosed: answerNextAsk } });
	});

	it("opens the struggle under way rather than a second setup", () => {
		live.current = called();
		expect(callStruggleAsOne({ journey: true })).toBe("window:s1");
		expect(openStruggleSetup).not.toHaveBeenCalled();
	});

	it("does nothing for a player, who asks from their sheet instead", () => {
		globalThis.game.user = { id: "p1", isGM: false };
		expect(callStruggleAsOne()).toBeNull();
		expect(openStruggleWindow).not.toHaveBeenCalled();
		expect(openStruggleSetup).not.toHaveBeenCalled();
	});

	it("is what a GM's click on the move from a character's sheet does too", async () => {
		await openStruggleAsOne({ id: "a", name: "A", isOwner: true });
		expect(openStruggleSetup).toHaveBeenCalledWith({ journey: false, onClosed: answerNextAsk });
	});
});

describe("the button's words", () => {
	it("calls one with nothing under way, and says what the move is for", () => {
		expect(gmStruggleCall()).toMatchObject({ live: false, label: "Call for Struggle as One" });
	});

	it("opens the one under way, saying how far it has got", () => {
		live.current = called();
		expect(gmStruggleCall()).toMatchObject({ live: true, label: "Open the Struggle as One", hint: "Under way: 0 of 2 have rolled." });
		const s = called();
		const board = struggleBoard(s, id => readStruggleRoll({ id: "s1", rolls: id === "a" ? { pc_a: { total: 8 } } : {} }, "s1"));
		expect(struggleCallView(s, board).hint).toBe("Under way: 1 of 2 have rolled.");
		expect(struggleCallView(called(STRUGGLE_STATUS.REVEALED), board).hint).toBe("Under way: the results are shared.");
	});
});

/** A document holding one GM button, as either screen draws it: the two spans the refresh rewrites. */
function fakeDoc() {
	const label = { textContent: "Call for Struggle as One" };
	const hint = { textContent: "" };
	const bar = { querySelector: sel => (sel === "[data-struggle-call-label]" ? label : sel === "[data-struggle-call-hint]" ? hint : null) };
	return { label, hint, doc: { querySelectorAll: sel => (sel === ".stonetop-gm-struggle-bar" ? [bar] : []) } };
}

describe("keeping the buttons current", () => {
	it("rewrites every GM button in place, so the walkthrough stops offering to call one already under way", () => {
		const { label, hint, doc } = fakeDoc();
		live.current = called();
		refreshStruggleBars(doc);
		expect(label.textContent).toBe("Open the Struggle as One");
		expect(hint.textContent).toBe("Under way: 0 of 2 have rolled.");
	});

	it("leaves a player's screen alone", () => {
		globalThis.game.user = { id: "p1", isGM: false };
		const { label, doc } = fakeDoc();
		live.current = called();
		refreshStruggleBars(doc);
		expect(label.textContent).toBe("Call for Struggle as One");
	});

	it("runs when a player's roll lands, which redraws neither screen", () => {
		const doc = globalThis.document;
		const fake = fakeDoc();
		globalThis.document = fake.doc;
		try {
			live.current = called();
			onUpdateActorStruggle({ id: "a", type: "character" }, { flags: { "stonetop-pwd": { struggleRoll: { rolls: {} } } } });
			expect(fake.label.textContent).toBe("Open the Struggle as One");
		} finally {
			globalThis.document = doc;
		}
	});

	it("finds the words to rewrite on both screens", () => {
		for (const rel of ["templates/actor/partials/gm-toolkit-tab-expeditions.hbs", "templates/dialogs/expedition.hbs"]) {
			const markup = read(rel);
			expect(markup).toMatch(/<span data-struggle-call-label>\{\{(stonetop\.)?struggle\.label\}\}<\/span>/);
			expect(markup).toMatch(/data-struggle-call-hint>\{\{(stonetop\.)?struggle\.hint\}\}/);
		}
	});
});

describe("the GM Toolkit's Expeditions tab", () => {
	const TAB = read("templates/actor/partials/gm-toolkit-tab-expeditions.hbs").replace(/\{\{!--[\s\S]*?--\}\}/g, "");
	const SHEET = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");

	it("draws the button only for a GM, in the words the struggle gives it", () => {
		expect(TAB).toMatch(/\{\{#if stonetop\.struggle\}\}[\s\S]*class="stonetop-gm-struggle-call"[\s\S]*\{\{stonetop\.struggle\.label\}\}[\s\S]*\{\{\/if\}\}/);
		expect(SHEET).toContain("context.stonetop.struggle = context.stonetop.isGM ? gmStruggleCall() : null;");
	});

	it("wires the button to the GM's way in", () => {
		expect(SHEET).toMatch(/closest\("\.stonetop-gm-struggle-call"\)\)[\s\S]{0,120}callStruggleAsOne\(\)/);
	});
});

describe("the Run an Expedition walkthrough", () => {
	const DIALOG = read("module/dialogs/ExpeditionDialog.js");
	const HBS = read("templates/dialogs/expedition.hbs").replace(/\{\{!--[\s\S]*?--\}\}/g, "");

	it("offers it on the journey step, after the Die of Fate, under the sentence that reaches for it", () => {
		expect(DIALOG).toMatch(/key:\s+"running"[\s\S]*?bodyAfterFate:[\s\S]*?Struggle as One[\s\S]*?struggle: true/);
		const fate = HBS.indexOf("stonetop-exp-fate-btn");
		const after = HBS.indexOf("step.bodyAfterFate");
		const button = HBS.indexOf("stonetop-exp-struggle-btn");
		expect(fate).toBeGreaterThan(-1);
		expect(after).toBeGreaterThan(fate);
		expect(button).toBeGreaterThan(after);
	});

	it("shows it to a GM only, and calls it as part of a journey", () => {
		expect(DIALOG).toContain("struggle:  step.struggle && game.user?.isGM ? gmStruggleCall() : null,");
		expect(DIALOG).toContain('html.find(".stonetop-exp-struggle-btn").on("click", () => callStruggleAsOne({ journey: true }));');
	});
});
