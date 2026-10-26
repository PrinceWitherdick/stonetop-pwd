import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntroductionsDialog } from "../../module/dialogs/IntroductionsDialog.js";

// ── Two people writing one introduction ─────────────────────────────────────────────────────────
//
// On a player's turn the primary GM co-edits the same capture field, and each side saves its WHOLE
// text to the PC's flag. Reported from a table: "if the player and the DM both type into the text
// box, the player overwrites what the DM has written; the player has to close their window so the
// DM's notes save to the Chronicle." Two things did it:
//
//   1. The flush that runs before every re-render saved the field whenever it differed from the
//      flag. The GM's save re-rendered the player's window, and the player's OLD copy differed from
//      the flag precisely because the GM had just added to it, so it went straight back over the
//      GM's words. The player did not have to be typing at all.
//   2. While the player's caret sat in the field the re-render was skipped, so the field went on
//      showing the old text, and their next keystroke or blur saved that.
//
// No DOM here (vitest runs in node): the dialog is driven through hand-built stand-ins for a window
// root, its fields, and the PC actor's flag.

const SCOPE = "stonetop-pwd";
const FLAG  = "intro";

function makeActor(intro = {}) {
	const flags = { [SCOPE]: { [FLAG]: intro } };
	const at = (key) => key.split(".");
	return {
		id: "pc",
		type: "character",
		isOwner: true,
		flags,
		getFlag: (scope, key) => at(key).reduce((node, part) => node?.[part], flags[scope]),
		setFlag: vi.fn(async (scope, key, value) => {
			const parts = at(key);
			const leaf  = parts.pop();
			let node = (flags[scope] ??= {});
			for (const part of parts) node = (node[part] ??= {});
			node[leaf] = value;
		}),
	};
}

// A textarea: the value, and a caret that setSelectionRange moves.
function makeField(dataset, value = "") {
	return {
		dataset, value,
		selectionStart: value.length, selectionEnd: value.length, selectionDirection: "none", scrollTop: 0,
		setSelectionRange(start, end, direction) {
			this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
		},
	};
}

function makePick(index) {
	const classes = new Set();
	return {
		dataset: { qIndex: String(index) },
		classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) },
	};
}

// A window root answering the selectors the dialog asks for, comma lists included.
function makeRoot({ narration = null, draft = null, mirror = null, about = null, picks = [] } = {}) {
	const one = (part) => {
		const sel = part.trim().replace(/^textarea/, "");
		if (sel === ".stonetop-intros-answer:not([readonly])") return narration;
		if (sel === ".stonetop-intros-draft:not([readonly])")  return draft;
		if (sel === ".stonetop-intros-answer[readonly]")       return mirror?.kind === "answer" ? mirror : null;
		if (sel === ".stonetop-intros-draft[readonly]")        return mirror?.kind === "draft" ? mirror : null;
		if (sel === ".stonetop-intros-about-pick")             return about;
		return null;
	};
	return {
		querySelector: (sel) => sel.split(",").map(one).find(Boolean) ?? null,
		querySelectorAll: (sel) => (sel.includes("question-pick") ? picks : []),
	};
}

// A dialog showing the PC on narration round 1 (phase 1) or the answer step (phase 4). Pending
// saves are caught instead of timed, so a test can say when they land.
function makeDialog(actor, root, phase = 1) {
	const dialog = new IntroductionsDialog();
	dialog.element = [root];
	dialog._actor  = () => actor;
	dialog._pcs    = [actor];
	dialog._pcIndex = 0;
	dialog._phase  = phase;
	dialog.saved   = [];
	dialog._scheduleNarration = vi.fn((actorId, roundKey, value) => dialog.saved.push(value));
	dialog._scheduleLiveDraft = vi.fn((actorId, stepKey, q, a, who) => dialog.saved.push({ q, a, who }));
	return dialog;
}

function focus(el) { globalThis.document = { activeElement: el }; }

const had = { document: "document" in globalThis, game: globalThis.game };
beforeEach(() => {
	globalThis.game = { ...had.game, user: { id: "player" } };
	delete globalThis.document;
});
afterEach(() => {
	globalThis.game = had.game;
	if (!had.document) delete globalThis.document;
});

// ── Narration ───────────────────────────────────────────────────────────────────────────────────

describe("IntroductionsDialog co-editing: narration", () => {
	const BEFORE = "Tamsin, a smith.";
	const GM     = "Tamsin, a smith. GM: owes Olwin.";
	let actor, field, dialog;

	beforeEach(() => {
		actor  = makeActor({ narration: { r1: BEFORE } });
		field  = makeField({ actorId: "pc", roundKey: "r1" }, BEFORE);
		dialog = makeDialog(actor, makeRoot({ narration: field }));
		dialog._noteCaptureShown();
	});

	it("never saves a player's untouched copy back over the GM's words", async () => {
		actor.flags[SCOPE][FLAG].narration.r1 = GM;          // the GM's save lands
		await dialog._flushCaptureFromDom();                  // the re-render it triggers
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(actor.getFlag(SCOPE, `${FLAG}.narration.r1`)).toBe(GM);
	});

	it("shows the GM's words in the player's field the moment they land", () => {
		actor.flags[SCOPE][FLAG].narration.r1 = GM;
		dialog._absorbCaptureWrite(actor, "gm");
		expect(field.value).toBe(GM);
		expect(dialog.saved).toEqual([]);
	});

	it("does so even with the player's caret in the field, and leaves the caret where it was", () => {
		focus(field);
		field.selectionStart = field.selectionEnd = 6;        // just after "Tamsin"
		actor.flags[SCOPE][FLAG].narration.r1 = "Hi. " + GM;
		dialog._absorbCaptureWrite(actor, "gm");
		expect(field.value).toBe("Hi. " + GM);
		expect([field.selectionStart, field.selectionEnd]).toEqual([10, 10]);
	});

	it("keeps the player's unsaved typing and saves both", () => {
		field.value = "Tamsin (she/her), a smith.";                // typed, not saved yet
		actor.flags[SCOPE][FLAG].narration.r1 = GM;
		dialog._absorbCaptureWrite(actor, "gm");
		expect(field.value).toBe("Tamsin (she/her), a smith. GM: owes Olwin.");
		expect(dialog.saved).toEqual(["Tamsin (she/her), a smith. GM: owes Olwin."]);
	});

	it("still flushes the player's own unsaved typing before a re-render, merged", async () => {
		field.value = "Tamsin (she/her), a smith.";
		actor.flags[SCOPE][FLAG].narration.r1 = GM;
		dialog._absorbCaptureWrite(actor, "gm");
		await dialog._flushCaptureFromDom();
		expect(actor.getFlag(SCOPE, `${FLAG}.narration.r1`)).toBe("Tamsin (she/her), a smith. GM: owes Olwin.");
	});

	it("takes its own save coming back without saving it again", () => {
		field.value = "Tamsin, a smith, quiet.";
		actor.flags[SCOPE][FLAG].narration.r1 = "Tamsin, a smith, quiet.";
		dialog._absorbCaptureWrite(actor, "player");
		expect(dialog.saved).toEqual([]);
		expect(dialog._captureDirty(field)).toBe(false);
	});

	it("ignores a change to another PC's introduction", () => {
		const other = { ...makeActor({ narration: { r1: "someone else" } }), id: "other" };
		dialog._absorbCaptureWrite(other, "gm");
		expect(field.value).toBe(BEFORE);
	});

	it("keeps a watcher's readonly mirror current too", () => {
		const mirror = { ...makeField({}, BEFORE), kind: "answer" };
		const watcher = makeDialog(actor, makeRoot({ mirror }));
		actor.flags[SCOPE][FLAG].narration.r1 = GM;
		watcher._absorbCaptureWrite(actor, "player");
		expect(mirror.value).toBe(GM);
	});
});

// ── Answer / ask steps ──────────────────────────────────────────────────────────────────────────

describe("IntroductionsDialog co-editing: the answer step's draft", () => {
	let actor, field, about, picks, dialog;

	beforeEach(() => {
		actor = makeActor({ drafts: { step4: { q: 0, a: "Olwin taught me", who: null } } });
		field = makeField({ actorId: "pc", stepKey: "step4" }, "Olwin taught me");
		about = { dataset: { actorId: "pc", stepKey: "step4" }, value: "" };
		picks = [0, 1, 2, 3].map(makePick);
		dialog = makeDialog(actor, makeRoot({ draft: field, about, picks }), 4);
		dialog._noteCaptureShown();
		focus(field);
	});

	it("merges the GM's words into the draft while the player types", () => {
		field.value = "Olwin taught me to shoe horses";
		actor.flags[SCOPE][FLAG].drafts = { step4: { q: 0, a: "Olwin taught me. GM: she's dying.", who: null } };
		dialog._absorbCaptureWrite(actor, "gm");
		expect(field.value).toBe("Olwin taught me to shoe horses. GM: she's dying.");
		// `who` comes off the select, as a keystroke's would: "" is its "nobody at this table".
		expect(dialog.saved).toEqual([{ q: 0, a: "Olwin taught me to shoe horses. GM: she's dying.", who: "" }]);
	});

	it("lights the question the GM picked, so clicking it doesn't toggle it back off", () => {
		actor.flags[SCOPE][FLAG].drafts = { step4: { q: 2, a: "Olwin taught me", who: null } };
		dialog._absorbCaptureWrite(actor, "gm");
		expect(picks.map(p => p.classList.contains("is-selected"))).toEqual([false, false, true, false]);
	});

	it("shows who the GM said it's about, so the next keystroke doesn't put the old pick back", () => {
		actor.flags[SCOPE][FLAG].drafts = { step4: { q: 0, a: "Olwin taught me", who: "pc-2" } };
		dialog._absorbCaptureWrite(actor, "gm");
		expect(about.value).toBe("pc-2");
	});

	// Recording ENDS the answer. The redraw that would empty the field is skipped while the caret is
	// in it, so the field is emptied here instead: left showing the recorded answer, the next
	// keystroke or flush wrote it back as a new draft with the question just used.
	it("empties the field when the draft is recorded, even with the caret in it, and saves nothing", () => {
		delete actor.flags[SCOPE][FLAG].drafts;
		actor.flags[SCOPE][FLAG].step4 = { answers: [{ q: 0, a: "Olwin taught me" }] };
		expect(dialog._absorbCaptureWrite(actor, "gm")).toBe(true);
		expect(field.value).toBe("");
		expect(dialog.saved).toEqual([]);
		expect(picks.some(p => p.classList.contains("is-selected"))).toBe(false);
	});

	it("keeps the player's draft when the GM edits an older answer", () => {
		actor.flags[SCOPE][FLAG].step4 = { answers: [{ q: 1, a: "Reworded by the GM" }] };
		expect(dialog._absorbCaptureWrite(actor, "gm")).toBe(false);
		expect(field.value).toBe("Olwin taught me");
		// And the flush still counts it as a draft against the record as it now stands.
		expect(dialog._captureSeen.mark).toBe(dialog._commitMark("pc", "step4"));
	});

	it("leaves a field that showed no saved draft alone when the step changes", () => {
		const fresh  = makeActor({});
		const blank  = makeField({ actorId: "pc", stepKey: "step4" }, "");
		const d      = makeDialog(fresh, makeRoot({ draft: blank, picks: [] }), 4);
		d._noteCaptureShown();
		blank.value = "first words";                              // typed, not saved yet
		fresh.flags[SCOPE][FLAG].step4 = { passed: false, answers: [{ q: 2, a: "an older answer" }] };
		expect(d._absorbCaptureWrite(fresh, "gm")).toBe(false);
		expect(blank.value).toBe("first words");
	});
});

// ── The whole table ─────────────────────────────────────────────────────────────────────────────
// Two windows, one server. Every save goes to the server in order and comes back to BOTH windows,
// the writer's own included, in the order the server applied them, which is what Foundry does.

function table(start) {
	const queue = [];
	const clients = ["gm", "player"].map(userId => {
		const actor  = makeActor({ narration: { r1: start } });
		const field  = makeField({ actorId: "pc", roundKey: "r1" }, start);
		const dialog = makeDialog(actor, makeRoot({ narration: field }));
		globalThis.game.user = { id: userId };
		dialog._noteCaptureShown();
		return { userId, actor, field, dialog };
	});
	const as = (c, fn) => { globalThis.game.user = { id: c.userId }; return fn(); };
	return {
		clients,
		type(c, text) { c.field.value = text; c.dialog.saved.push(text); },
		// Every window sends its latest pending save, if it isn't what it already has from the server.
		send() {
			for (const c of clients) {
				const value = c.dialog.saved.pop();
				c.dialog.saved.length = 0;
				if (value !== undefined && value !== c.actor.flags[SCOPE][FLAG].narration.r1) queue.push({ from: c.userId, value });
			}
		},
		deliver() {
			while (queue.length) {
				const { from, value } = queue.shift();
				for (const c of clients) {
					c.actor.flags[SCOPE][FLAG].narration.r1 = value;
					as(c, () => c.dialog._absorbCaptureWrite(c.actor, from));
				}
			}
		},
		settle() { for (let i = 0; i < 6; i++) { this.send(); if (!queue.length) return; this.deliver(); } },
		get server() { return clients[0].actor.flags[SCOPE][FLAG].narration.r1; },
	};
}

describe("IntroductionsDialog co-editing: a GM and a player at one table", () => {
	it("lets the GM write while the player watches, without the player's window undoing it", () => {
		const t = table("Tamsin, a smith.");
		const [gm, player] = t.clients;
		t.type(gm, "Tamsin, a smith. GM: owes");
		t.settle();
		t.type(gm, "Tamsin, a smith. GM: owes Olwin a debt.");
		t.settle();
		expect(t.server).toBe("Tamsin, a smith. GM: owes Olwin a debt.");
		expect(player.field.value).toBe(t.server);
	});

	it("keeps both when their saves cross in flight", () => {
		const t = table("Tamsin, a smith.");
		const [gm, player] = t.clients;
		t.type(gm, "Tamsin, a smith. GM: owes Olwin.");
		t.type(player, "Tamsin (she/her), a smith.");
		t.settle();
		expect(t.server).toBe("Tamsin (she/her), a smith. GM: owes Olwin.");
		expect(gm.field.value).toBe(t.server);
		expect(player.field.value).toBe(t.server);
	});

	it("keeps both when they add to the end at the same moment", () => {
		const t = table("I grew up");
		const [gm, player] = t.clients;
		t.type(player, "I grew up by the lake.");
		t.type(gm, "I grew up [ask about the lake]");
		t.settle();
		expect(t.server).toContain("by the lake.");
		expect(t.server).toContain("[ask about the lake]");
		expect(gm.field.value).toBe(t.server);
		expect(player.field.value).toBe(t.server);
	});
});
