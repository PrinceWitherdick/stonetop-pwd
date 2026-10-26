import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntroductionsDialog } from "../../module/dialogs/IntroductionsDialog.js";
import { StonetopDialog } from "../../module/utils/stonetop-dialog.js";
import {
	withRecordedAnswer, withAnswerEdited, withoutAnswer, prevActiveIndex, lastActiveIndex,
} from "../../module/dialogs/introductions-flow.js";

// ── A running introductions session, from the GM's side and a player's ─────────────────────────
//
// The races and edge cases of a live session zero: a GM reloading mid-step, Next pressed twice,
// a draft write landing after the answer it carries was recorded, a PC deleted mid-turn, Back
// onto somebody already done, a render that outlives close(), a second GM, and the GM's own
// corrections to a record (un-pass, edit, delete). No Foundry here: the dialog is driven through
// stand-ins for the settings store, the users, and the PC actors' flags.

const SCOPE = "stonetop-pwd";
const WORLD = "w";

// A PC whose flag reads and writes the way Foundry's do for the shapes the dialog writes: a dotted
// setFlag, and an update of dotted flag paths with `-=` (or a ForcedDeletion) for removals.
function makePc(id, { slug = "the-blessed", intro = {}, isOwner = true } = {}) {
	const flags = { [SCOPE]: { intro } };
	const walk = (parts, make) => {
		let node = flags[SCOPE];
		for (const part of parts) node = make ? (node[part] ??= {}) : node?.[part];
		return node;
	};
	return {
		id, name: id.toUpperCase(), type: "character", isOwner,
		system: { playbook: { slug, name: slug } },
		flags,
		testUserPermission: () => false,
		getFlag: (scope, key) => key.split(".").reduce((node, part) => node?.[part], flags[scope]),
		setFlag: vi.fn(async (scope, key, value) => {
			const parts = key.split(".");
			const leaf  = parts.pop();
			walk(parts, true)[leaf] = structuredClone(value);
		}),
		update: vi.fn(async (changes) => {
			for (const [path, value] of Object.entries(changes)) {
				const parts = path.replace(`flags.${SCOPE}.`, "").split(".");
				const leaf  = parts.pop();
				if (leaf.startsWith("-=")) { delete walk(parts, false)?.[leaf.slice(2)]; continue; }
				if (value instanceof foundry.data.operators.ForcedDeletion) { delete walk(parts, false)?.[leaf]; continue; }
				walk(parts, true)[leaf] = structuredClone(value);
			}
		}),
	};
}

let store, pcs, base;

function setUser({ id = "gm", isGM = true } = {}) { game.user = { id, isGM }; }

beforeEach(() => {
	base  = globalThis.game;
	store = { introductionsOrder: { ids: [], adopted: "none" }, introCursor: { active: false }, walkthroughResume: {} };
	pcs   = new Map();
	globalThis.game = {
		...base,
		world:    { id: WORLD },
		user:     { id: "gm", isGM: true },
		users:    {
			activeGM: { id: "gm", name: "Gail", isGM: true, active: true },
			find: () => undefined,
			filter: () => [],
			get: () => null,
		},
		actors:   { get: (id) => pcs.get(id) ?? null, get contents() { return [...pcs.values()]; } },
		settings: {
			get: (_ns, key) => store[key],
			set: vi.fn(async (_ns, key, value) => { store[key] = value; return value; }),
		},
	};
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
});

afterEach(() => {
	globalThis.game = base;
	delete globalThis.ui;
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function addPcs(...list) { for (const pc of list) pcs.set(pc.id, pc); return list; }

// A dialog on a given phase and turn, rendering into nothing.
function dialogAt(phase, list, index = 0) {
	const d = new IntroductionsDialog();
	d._phase   = phase;
	d._pcs     = list;
	d._pcIndex = index;
	d.render   = vi.fn();
	return d;
}

// ── A2: a GM reload follows the live cursor ─────────────────────────────────────────────────────

describe("reopening on the GM's side (A2)", () => {
	it("follows a live cursor over this browser's stale saved spot", async () => {
		addPcs(makePc("a"), makePc("b"), makePc("c"));
		store.introCursor = { active: true, phase: 4, activeActorId: "b", activeUserId: "", pcOrder: ["a", "b", "c"], nonce: 3 };
		store.walkthroughResume = { [WORLD]: { introductions: { open: true, v: 2, phase: 1, pcIndex: 0 } } };
		const d = await IntroductionsDialog._doOpen();
		expect(d._phase).toBe(4);
		expect(d._pcs[d._pcIndex].id).toBe("b");
	});

	it("uses the saved spot when no session is running", async () => {
		addPcs(makePc("a"), makePc("b"));
		store.walkthroughResume = { [WORLD]: { introductions: { open: true, v: 2, phase: 2, pcIndex: 1 } } };
		const d = await IntroductionsDialog._doOpen();
		expect(d._phase).toBe(2);
		expect(d._pcIndex).toBe(1);
	});
});

// ── A3: a recorded answer never comes back as a draft ───────────────────────────────────────────

describe("a draft write after its answer was recorded (A3)", () => {
	it("drops the pending keystroke write when the answer was recorded meanwhile", async () => {
		vi.useFakeTimers();
		const [a] = addPcs(makePc("a", { intro: { drafts: { step4: { q: 0, a: "Olwin", who: null } } } }));
		const d = dialogAt(4, [a]);
		d._canEditActor = () => true;
		d._scheduleLiveDraft("a", "step4", 0, "Olwin taught me", null);
		// The GM's Next records it, from the other client, inside the 300ms.
		await a.update({ [`flags.${SCOPE}.intro.step4.answers`]: [{ q: 0, a: "Olwin" }], [`flags.${SCOPE}.intro.drafts.-=step4`]: null });
		await vi.advanceTimersByTimeAsync(350);
		expect(a.getFlag(SCOPE, "intro.drafts.step4")).toBeUndefined();
		expect(a.getFlag(SCOPE, "intro.step4.answers")).toHaveLength(1);
	});

	it("still writes it when nothing was recorded", async () => {
		vi.useFakeTimers();
		const [a] = addPcs(makePc("a", { intro: { drafts: { step4: { q: 0, a: "Olwin", who: null } } } }));
		const d = dialogAt(4, [a]);
		d._canEditActor = () => true;
		d._scheduleLiveDraft("a", "step4", 0, "Olwin taught me", null);
		await vi.advanceTimersByTimeAsync(350);
		expect(a.getFlag(SCOPE, "intro.drafts.step4.a")).toBe("Olwin taught me");
	});

	it("does not flush a field drawn before the answer was recorded, even over a new draft", async () => {
		const [a] = addPcs(makePc("a", { intro: { drafts: { step4: { q: 0, a: "Olwin", who: null } } } }));
		const d = dialogAt(4, [a]);
		const field = { dataset: { actorId: "a", stepKey: "step4" }, value: "Olwin taught me" };
		d.element = [{ querySelector: (sel) => (sel.includes("stonetop-intros-draft") ? field : null), querySelectorAll: () => [] }];
		d._captureSeen = { key: "a:step4", text: "Olwin", q: 0, who: null, mark: d._commitMark("a", "step4") };
		// Recorded elsewhere, and a fresh draft already begun for the next question.
		await a.update({ [`flags.${SCOPE}.intro.step4.answers`]: [{ q: 0, a: "Olwin" }] });
		await a.setFlag(SCOPE, "intro.drafts.step4", { q: 1, a: "new", who: null });
		await d._flushCaptureFromDom();
		expect(a.getFlag(SCOPE, "intro.drafts.step4")).toMatchObject({ q: 1, a: "new" });
	});

	it("records a second answer to the same question in place of the first, never beside it", async () => {
		const [a] = addPcs(makePc("a", { intro: {
			step4: { answers: [{ q: 0, a: "Olwin" }], passed: false },
			drafts: { step4: { q: 0, a: "Olwin, my teacher", who: null } },
		} }));
		const d = dialogAt(4, [a]);
		await d._recordDraft("a", "step4");
		expect(a.getFlag(SCOPE, "intro.step4.answers")).toEqual([{ q: 0, a: "Olwin, my teacher" }]);
	});
});

describe("the answer list, rewritten whole", () => {
	it("appends a new question's answer and replaces a repeated one", () => {
		expect(withRecordedAnswer([{ q: 0, a: "x" }], { q: 1, a: "y" })).toEqual([{ q: 0, a: "x" }, { q: 1, a: "y" }]);
		expect(withRecordedAnswer([{ q: 0, a: "x" }], { q: 0, a: "x2" })).toEqual([{ q: 0, a: "x2" }]);
		expect(withRecordedAnswer([{ q: null, a: "x" }], { q: null, a: "y" })).toHaveLength(2);
	});

	it("rewords an answer, keeping its question and who it is about", () => {
		expect(withAnswerEdited([{ q: 2, a: "old", who: "b" }], 0, "  new  ")).toEqual([{ q: 2, a: "new", who: "b" }]);
		expect(withAnswerEdited([{ q: 2, a: "old" }], 0, "   ")).toBeNull();
		expect(withAnswerEdited([{ q: 2, a: "old" }], 3, "new")).toBeNull();
	});

	it("deletes one answer", () => {
		expect(withoutAnswer([{ q: 0, a: "x" }, { q: 1, a: "y" }], 0)).toEqual([{ q: 1, a: "y" }]);
		expect(withoutAnswer([{ q: 0, a: "x" }], -1)).toBeNull();
	});
});

// ── A4: one move per press ──────────────────────────────────────────────────────────────────────

describe("Next pressed twice, or crossing a player's Done (A4)", () => {
	function stepDialog() {
		const list = addPcs(makePc("a"), makePc("b"), makePc("c"));
		const d = dialogAt(4, list);
		d._isPcDone = () => false;
		let release;
		d._commitComposedDraft = vi.fn(() => new Promise(r => { release = r; }));
		return { d, release: () => release(true) };
	}

	it("moves the turn once for a double click", async () => {
		const { d, release } = stepDialog();
		const first = d._advance();
		const second = d._advance();
		release();
		await Promise.all([first, second]);
		expect(d._commitComposedDraft).toHaveBeenCalledTimes(1);
		expect(d._pcIndex).toBe(1);
	});

	it("does not move it again when the player's Done already handed it on", async () => {
		const { d, release } = stepDialog();
		const pressing = d._advance();
		// The player recorded the same answer; the GM's hook hands the turn to B meanwhile.
		expect(d._autoAdvanceOnRemoteStep(d._pcs[0])).toBe(true);
		expect(d._pcIndex).toBe(1);
		release();
		await pressing;
		expect(d._pcIndex).toBe(1);
	});
});

// ── B7: a PC deleted mid-session ────────────────────────────────────────────────────────────────

describe("a PC deleted mid-session (B7)", () => {
	it("hands a step turn to the next PC still answering", () => {
		const list = addPcs(makePc("a"), makePc("b"), makePc("c"));
		const d = dialogAt(4, list, 1);
		d._isPcDone = () => false;
		d._dropFromSession("b");
		expect(d._pcs.map(p => p.id)).toEqual(["a", "c"]);
		expect(d._pcs[d._pcIndex].id).toBe("c");
	});

	it("skips a PC already done when handing it on", () => {
		const list = addPcs(makePc("a"), makePc("b"), makePc("c"));
		const d = dialogAt(4, list, 1);
		d._isPcDone = (pc) => pc.id === "c";
		d._dropFromSession("b");
		expect(d._pcs[d._pcIndex].id).toBe("a");
	});

	it("goes on to the next round when the last narrator is deleted", () => {
		const list = addPcs(makePc("a"), makePc("b"));
		const d = dialogAt(1, list, 1);
		d._dropFromSession("b");
		expect(d._phase).toBe(2);
		expect(d._pcIndex).toBe(0);
	});

	it("keeps the turn on the same PC when somebody earlier is deleted", () => {
		const list = addPcs(makePc("a"), makePc("b"), makePc("c"));
		const d = dialogAt(1, list, 2);
		d._dropFromSession("a");
		expect(d._pcs[d._pcIndex].id).toBe("c");
	});

	it("shows a follower a wait, not the first PC, when the cursor's PC has gone", () => {
		setUser({ id: "player", isGM: false });
		addPcs(makePc("a", { isOwner: false }), makePc("c", { isOwner: false }));
		store.introCursor = { active: true, phase: 4, activeActorId: "gone", activeUserId: "", pcOrder: ["a", "gone", "c"] };
		const d = new IntroductionsDialog();
		d._syncFromCursor();
		expect(d._waitingOnTurn).toBe(true);
		const data = d.getData();
		expect(data.waiting).toBe(true);
		expect(data.currentPc).toBeNull();
		expect(data.capture).toBeNull();
	});

	it("adds a PC that gains its playbook mid-session to the end of the run", () => {
		const list = addPcs(makePc("a"), makePc("b"));
		const d = dialogAt(1, list, 0);
		const late = makePc("late");
		pcs.set("late", late);
		d._addToSession(late);
		expect(d._pcs.map(p => p.id)).toEqual(["a", "b", "late"]);
	});
});

// ── B11 / B15: Back, and nobody's turn on a finished step ───────────────────────────────────────

describe("Back and a finished step (B11, B15)", () => {
	it("Back steps over PCs who are done with the step", () => {
		const list = addPcs(makePc("a"), makePc("b"), makePc("c"));
		const d = dialogAt(4, list, 2);
		d._isPcDone = (pc) => pc.id === "b";
		d._retreat();
		expect(d._pcIndex).toBe(0);
	});

	it("Back off the front of a step lands on the step before's last PC still answering", () => {
		const list = addPcs(makePc("a"), makePc("b"), makePc("c"));
		const d = dialogAt(5, list, 0);
		d._isPcDone = (pc, phase) => phase.stepKey === "step6" ? false : pc.id === "c";
		d._retreat();
		expect(d._phase).toBe(4);
		expect(d._pcs[d._pcIndex].id).toBe("b");
	});

	it("names nobody in the cursor while the PC parked on is done", () => {
		const list = addPcs(makePc("a", { intro: { step4: { answers: [], passed: true } } }));
		const d = dialogAt(4, list, 0);
		d._writeCursor = vi.fn();
		d._syncCursorFromLocal();
		expect(d._writeCursor).toHaveBeenCalledWith(expect.objectContaining({ activeActorId: "", activeUserId: "" }));
	});

	it("names nobody for a PC whose playbook has no questions, and says why if shown", () => {
		const list = addPcs(makePc("odd", { slug: "not-a-playbook" }));
		const d = dialogAt(4, list, 0);
		d._writeCursor = vi.fn();
		d._syncCursorFromLocal();
		expect(d._writeCursor).toHaveBeenCalledWith(expect.objectContaining({ activeActorId: "" }));
		const { capture } = d.getData();
		expect(capture.noQuestions).toBe(true);
		expect(capture.canPass).toBe(false);
		expect(capture.canDone).toBe(false);
	});

	it("walks back and finds the last still-active index", () => {
		const done = (i) => i === 1;
		expect(prevActiveIndex(2, done)).toBe(0);
		expect(prevActiveIndex(0, done)).toBe(-1);
		expect(lastActiveIndex(3, (i) => i === 2)).toBe(1);
		expect(lastActiveIndex(2, () => true)).toBe(-1);
	});
});

// ── B12 / B14 / B18: closing ────────────────────────────────────────────────────────────────────

describe("closing the window (B12, B14, B18)", () => {
	it("a render that outlives close() writes neither the cursor nor the resume record", async () => {
		vi.spyOn(StonetopDialog.prototype, "_render").mockImplementation(async function () {
			this._state = Application.RENDER_STATES.RENDERED;
		});
		const d = dialogAt(1, addPcs(makePc("a")));
		d._syncCursorFromLocal = vi.fn();
		d._saveResume = vi.fn();
		d._flushCaptureFromDom = async () => { d._closing = true; };
		await d._render(false, {});
		expect(d._syncCursorFromLocal).not.toHaveBeenCalled();
		expect(d._saveResume).not.toHaveBeenCalled();
	});

	it("nor does one that core skipped because the window had closed", async () => {
		vi.spyOn(StonetopDialog.prototype, "_render").mockImplementation(async function () {
			this._state = Application.RENDER_STATES.CLOSED;
		});
		const d = dialogAt(1, addPcs(makePc("a")));
		d._syncCursorFromLocal = vi.fn();
		d._saveResume = vi.fn();
		await d._render(false, {});
		expect(d._syncCursorFromLocal).not.toHaveBeenCalled();
	});

	it("an ordinary render still writes both", async () => {
		vi.spyOn(StonetopDialog.prototype, "_render").mockImplementation(async function () {
			this._state = Application.RENDER_STATES.RENDERED;
		});
		const d = dialogAt(1, addPcs(makePc("a")));
		d._syncCursorFromLocal = vi.fn();
		d._saveResume = vi.fn();
		await d._render(false, {});
		expect(d._syncCursorFromLocal).toHaveBeenCalled();
		expect(d._saveResume).toHaveBeenCalled();
	});

	it("keeps a player's last typing when the session ends on them", async () => {
		setUser({ id: "player", isGM: false });
		const [a] = addPcs(makePc("a", { intro: { drafts: { step4: { q: 1, a: "I owe", who: null } } } }));
		const d = dialogAt(4, [a]);
		const field = { dataset: { actorId: "a", stepKey: "step4" }, value: "I owe Olwin" };
		d.element = [{ querySelector: (sel) => (sel.includes("stonetop-intros-draft") ? field : null), querySelectorAll: () => [] }];
		d._captureSeen = { key: "a:step4", text: "I owe", q: 1, who: null, mark: d._commitMark("a", "step4") };
		await d.close();
		expect(a.getFlag(SCOPE, "intro.drafts.step4")).toMatchObject({ q: 1, a: "I owe Olwin" });
	});

	it("cancels a pending live Chronicle sync and compiles it once instead", async () => {
		vi.useFakeTimers();
		const d = dialogAt(1, addPcs(makePc("a")));
		d._syncChronicle = vi.fn(async () => {});
		d._harvestAll = vi.fn(async () => false);
		d._scheduleChronicleSync();
		await d.close();
		expect(d._syncChronicle).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(3000);
		expect(d._syncChronicle).toHaveBeenCalledTimes(1);
	});

	it("does not compile again after Save to Chronicle", async () => {
		vi.useFakeTimers();
		const d = dialogAt(6, addPcs(makePc("a")));
		d._syncChronicle = vi.fn(async () => {});
		d._harvestAll = vi.fn(async () => false);
		d._saveChronicle = vi.fn(async () => true);
		d._scheduleChronicleSync();
		await d._finish(null);
		await vi.advanceTimersByTimeAsync(3000);
		expect(d._saveChronicle).toHaveBeenCalledTimes(1);
		expect(d._syncChronicle).not.toHaveBeenCalled();
	});
});

// ── B10: a second GM ────────────────────────────────────────────────────────────────────────────

describe("a second GM (B10)", () => {
	beforeEach(() => { game.users.activeGM = { id: "other", name: "Olga", isGM: true, active: true }; });

	it("never harvests, saves, or shows the window to players", async () => {
		addPcs(makePc("a", { intro: { narration: { r1: "hello" } } }));
		store.introCursor = { active: true, phase: 1, showNonce: 0 };
		const d = dialogAt(6, [...pcs.values()]);
		d._saveChronicle = vi.fn(async () => true);
		d._writeCursor = vi.fn();
		expect(await d._harvestAll()).toBe(false);
		d._showPlayers();
		await d._finish(null);
		expect(game.settings.set).not.toHaveBeenCalledWith(SCOPE, "introductionsAnswers", expect.anything());
		expect(d._writeCursor).not.toHaveBeenCalled();
		expect(d._saveChronicle).not.toHaveBeenCalled();
	});

	it("is told who is running the table, in place of Back / Next", () => {
		const d = dialogAt(1, addPcs(makePc("a")));
		const data = d.getData();
		expect(data.isDriver).toBe(false);
		expect(data.watchingNote).toBe("Watching: Olga is running the introductions.");
	});
});

// ── B21: the GM's corrections ───────────────────────────────────────────────────────────────────

describe("the GM correcting a record (B21)", () => {
	function withRecord() {
		const [a] = addPcs(makePc("a", { intro: {
			step4: { answers: [{ q: 0, a: "Olwin" }, { q: 2, a: "Maeve", who: "b" }], passed: true },
			drafts: { step4: { q: 1, a: "a draft in progress", who: null } },
		} }));
		return { a, d: dialogAt(4, [a]) };
	}

	it("un-passes a PC", async () => {
		const { a, d } = withRecord();
		await d._unpass("a", "step4");
		expect(a.getFlag(SCOPE, "intro.step4.passed")).toBe(false);
	});

	it("rewords an answer without touching the draft in progress", async () => {
		const { a, d } = withRecord();
		d._startAnswerEdit("a", "step4", 1);
		const field = { value: "Maeve, my sister" };
		d.element = [{ querySelector: (sel) => (sel.includes("recorded-edit-field") ? field : null) }];
		await d._saveAnswerEdit();
		expect(a.getFlag(SCOPE, "intro.step4.answers")).toEqual([{ q: 0, a: "Olwin" }, { q: 2, a: "Maeve, my sister", who: "b" }]);
		expect(a.getFlag(SCOPE, "intro.drafts.step4.a")).toBe("a draft in progress");
		expect(d._editingAnswer).toBeNull();
	});

	it("refuses an edit to an answer that changed while it was open", async () => {
		const { a, d } = withRecord();
		d._startAnswerEdit("a", "step4", 1);
		await d._deleteAnswer("a", "step4", 0, { q: 0, a: "Olwin" });
		d._editingAnswer = { actorId: "a", stepKey: "step4", index: 1, text: "x", original: "Maeve" };
		await d._saveAnswerEdit();
		expect(a.getFlag(SCOPE, "intro.step4.answers")).toEqual([{ q: 2, a: "Maeve", who: "b" }]);
	});

	it("deletes an answer, found again by its content when the list has moved", async () => {
		const { a, d } = withRecord();
		await a.update({ [`flags.${SCOPE}.intro.step4.answers`]: [{ q: 2, a: "Maeve", who: "b" }, { q: 0, a: "Olwin" }] });
		await d._deleteAnswer("a", "step4", 0, { q: 0, a: "Olwin" });
		expect(a.getFlag(SCOPE, "intro.step4.answers")).toEqual([{ q: 2, a: "Maeve", who: "b" }]);
		expect(a.getFlag(SCOPE, "intro.drafts.step4.a")).toBe("a draft in progress");
	});

	it("is the GM running the table's alone", async () => {
		const { a, d } = withRecord();
		game.users.activeGM = { id: "other", name: "Olga" };
		await d._unpass("a", "step4");
		await d._deleteAnswer("a", "step4", 0, { q: 0, a: "Olwin" });
		expect(a.getFlag(SCOPE, "intro.step4.passed")).toBe(true);
		expect(a.getFlag(SCOPE, "intro.step4.answers")).toHaveLength(2);
	});

	it("offers the controls to the GM running the table", () => {
		const { d } = withRecord();
		const { capture } = d.getData();
		expect(capture.canManage).toBe(true);
		expect(capture.recorded.map(r => r.index)).toEqual([0, 1]);
	});
});

// ── B23: two steps' drafts; a reset flag; a new primary ─────────────────────────────────────────

describe("drafts of two steps, a reset, and a new primary GM (B23)", () => {
	it("keeps an unrecorded draft of one step while the other is typed into and recorded", async () => {
		const [a] = addPcs(makePc("a", { intro: { drafts: { step4: { q: 0, a: "never recorded", who: null } } } }));
		const d = dialogAt(5, [a]);
		await d._saveDraft("a", "step6", { q: 1, a: "asking now" });
		expect(a.getFlag(SCOPE, "intro.drafts.step6")).toMatchObject({ a: "asking now" });
		expect(d._stepDraft("a", "step4")).toMatchObject({ q: 0, a: "never recorded" });
		// Recording the ask clears only the ask's draft.
		await d._commitStep(a, "step6", "answers", [{ q: 1, a: "asking now" }]);
		expect(a.getFlag(SCOPE, "intro.drafts.step6")).toBeUndefined();
		expect(d._hasLiveDraft("a", "step4")).toBe(true);
		await d._saveDraft("a", "step4", { a: "never recorded, now finished" });
		expect(a.getFlag(SCOPE, "intro.drafts.step4")).toMatchObject({ q: 0, a: "never recorded, now finished" });
	});

	// A session in progress when the per-step shape shipped: its drafts sit in the old shared
	// buffer and the parked slot, and must neither vanish nor linger once written.
	it("reads drafts in the old live/parked shape and folds each into its own step on the next write", async () => {
		const [a] = addPcs(makePc("a", { intro: {
			live:   { stepKey: "step6", q: 2, a: "asking, old shape", who: null },
			parked: { step4: { stepKey: "step4", q: 0, a: "answer, old shape", who: null } },
		} }));
		const d = dialogAt(5, [a]);
		expect(d._stepDraft("a", "step6")).toMatchObject({ q: 2, a: "asking, old shape" });
		expect(d._stepDraft("a", "step4")).toMatchObject({ q: 0, a: "answer, old shape" });
		expect(d._hasLiveDraft("a", "step4")).toBe(true);
		// The same text still writes: the fold is a change of its own.
		await d._saveDraft("a", "step4", {});
		expect(a.getFlag(SCOPE, "intro.drafts.step4")).toEqual({ q: 0, a: "answer, old shape", who: null });
		expect(a.getFlag(SCOPE, "intro.parked.step4")).toBeUndefined();
		expect(a.getFlag(SCOPE, "intro.live")).toMatchObject({ stepKey: "step6" });
		// Recording the ask clears the old buffer it lived in, and nothing of step 4.
		await d._commitStep(a, "step6", "answers", [{ q: 2, a: "asking, old shape" }]);
		expect(a.getFlag(SCOPE, "intro.live")).toBeUndefined();
		expect(d._hasLiveDraft("a", "step6")).toBe(false);
		expect(d._stepDraft("a", "step4").a).toBe("answer, old shape");
	});

	it("clears what was harvested from a PC whose intro flag was removed", async () => {
		store.introductionsAnswers = { a: { r1: "hi" }, b: { r1: "keep" } };
		const d = dialogAt(1, []);
		await d._clearHarvested({ id: "a" });
		expect(store.introductionsAnswers).toEqual({ b: { r1: "keep" } });
	});

	it("re-reads the answers setting on becoming the primary GM", () => {
		store.introductionsAnswers = { a: { r1: "old" } };
		game.users.activeGM = { id: "other" };
		const d = dialogAt(1, []);
		d._answers();
		expect(d._refreshDraftIfNewPrimary()).toBe(false);
		store.introductionsAnswers = { a: { r1: "newer" } };
		game.users.activeGM = { id: "gm" };
		expect(d._refreshDraftIfNewPrimary()).toBe(true);
		expect(d._answers().a.r1).toBe("newer");
	});
});

// ── B8: a session left running ──────────────────────────────────────────────────────────────────

describe("a session left running (B8)", () => {
	let handlers;
	beforeEach(() => {
		handlers = {};
		IntroductionsDialog._presenceHook = null;
		IntroductionsDialog._heldForGm = false;
		globalThis.Hooks = { ...globalThis.Hooks, on: vi.fn((name, fn) => { handlers[name] = fn; return 7; }) };
	});

	it("holds a player's window until a GM connects", () => {
		setUser({ id: "player", isGM: false });
		game.users.activeGM = null;
		store.introCursor = { active: true, phase: 1, activeActorId: "a", activeUserId: "player" };
		const open = vi.spyOn(IntroductionsDialog, "open").mockResolvedValue(null);
		IntroductionsDialog.openForActiveSession();
		expect(open).not.toHaveBeenCalled();
		handlers.userConnected({ id: "gm", isGM: true }, true);
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("reopens the window for the GM running the table", () => {
		store.introCursor = { active: true, phase: 2 };
		const open = vi.spyOn(IntroductionsDialog, "open").mockResolvedValue(null);
		IntroductionsDialog.resumeRunningSession();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("baselines a GM's show-nonce too, so its first cursor write is not a force-show", () => {
		store.introCursor = { active: true, phase: 2, showNonce: 5 };
		IntroductionsDialog.openForActiveSession();
		expect(IntroductionsDialog._lastShowNonce).toBe(5);
	});
});
