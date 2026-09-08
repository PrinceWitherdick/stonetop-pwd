import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntroductionsDialog } from "../../module/dialogs/IntroductionsDialog.js";

// ── "Who is this about?": the pick that rides along with an introduction answer ────────────────
//
// An introduction answer used to be `{q, a}`: a question index and free prose, with no field
// saying which player character it was about. The relationship map's party board had to read the
// NAME out of the writing to know where to point the arrow, and a table whose answers say "I asked
// her outright and she only laughed" got a board with nobody joined to anybody.
//
// So the step now asks, beside the answer field, and stores the actor id as `who`. What has to
// hold is that the pick survives the writing: the live draft buffer is written WHOLE on every
// keystroke, so a handler that forgets to carry `who` rubs out the person the writer just chose,
// one character later. That is the failure this suite exists for.
//
// No DOM in this suite (vitest runs in node), so the dialog is driven through the same hand-built
// stand-ins the capture-flush suite uses: a window root and a PC actor's flag.

const SCOPE = "stonetop-pwd";
const FLAG  = "intro";

function makeActor(intro = {}) {
	const flags = { [SCOPE]: { [FLAG]: intro } };
	return {
		id: "actor-1",
		isOwner: true,
		flags,
		getFlag: (scope, key) => key.split(".").reduce((node, part) => node?.[part], flags[scope]),
		setFlag: vi.fn(async (scope, key, value) => {
			const parts = key.split(".");
			const leaf  = parts.pop();
			let node = (flags[scope] ??= {});
			for (const part of parts) node = (node[part] ??= {});
			node[leaf] = value;
		}),
		// Only the shape _commitStep writes: one dotted step field plus the `-=live` unset.
		update: vi.fn(async (changes) => {
			for (const [path, value] of Object.entries(changes)) {
				const parts = path.replace(`flags.${SCOPE}.`, "").split(".");
				const leaf  = parts.pop();
				let node = flags[SCOPE];
				for (const part of parts) node = (node[part] ??= {});
				if (leaf.startsWith("-=")) delete node[leaf.slice(2)];
				else node[leaf] = value;
			}
		}),
	};
}

// A window root answering the selectors the flush and the draft handlers ask for.
//
// ⚠ THE ABOUT SELECT IS ON IT, and that is not scenery. Unlike the question pick, that control does
// not re-render: it shows its own state, so its DOM is never a render behind while its FLAG is a
// `setFlag` behind for as long as that write is in the air. `about: null` stands for a step that
// has no such control at all.
function makeRoot({ actorId = "actor-1", stepKey = "step6", text = "", about } = {}) {
	const draftEl = { dataset: { actorId, stepKey }, value: text };
	const aboutEl = about === undefined
		? null
		: { dataset: { actorId, stepKey }, value: about };
	return {
		draftEl,
		aboutEl,
		querySelector: (sel) => {
			if (sel.includes("stonetop-intros-answer")) return null;
			if (sel.includes("stonetop-intros-about-pick")) return aboutEl;
			if (sel.includes("stonetop-intros-draft")) return draftEl;
			return null;
		},
	};
}

function makeDialog(actor, root) {
	const dialog = new IntroductionsDialog();
	dialog.element = [root];
	dialog._actor  = () => actor;
	// Sole editor: the owning player writing their own PC, which is what gates the flush.
	dialog._ownedActor           = () => actor;
	dialog._hasOnlinePlayerOwner = () => false;
	return dialog;
}

const live = actor => actor.getFlag(SCOPE, `${FLAG}.live`);
const recorded = (actor, stepKey = "step6") => actor.getFlag(SCOPE, `${FLAG}.${stepKey}`).answers;

describe("IntroductionsDialog — recording who an answer is about", () => {
	let actor, dialog;

	beforeEach(() => {
		actor  = makeActor({ live: { stepKey: "step6", q: 0, a: "She only laughed.", who: "actor-2" } });
		dialog = makeDialog(actor, makeRoot({ text: "She only laughed." }));
	});

	it("writes the pick onto the answer it was made about", async () => {
		expect(await dialog._recordDraft("actor-1", "step6")).toBe(true);
		expect(recorded(actor)).toEqual([{ q: 0, a: "She only laughed.", who: "actor-2" }]);
	});

	// ⚠ ABSENT, NOT NULL, and it matters beyond tidiness: every answer in every world that ran its
	// introductions before this existed has no such key, so absent has to be the ordinary shape
	// rather than a legacy one. The readers treat the two alike (see _normWho).
	it("leaves the key off entirely when nobody was picked", async () => {
		actor  = makeActor({ live: { stepKey: "step6", q: 1, a: "My sister Maeve." } });
		dialog = makeDialog(actor, makeRoot({ text: "My sister Maeve." }));
		await dialog._recordDraft("actor-1", "step6");
		expect(recorded(actor)).toEqual([{ q: 1, a: "My sister Maeve." }]);
		expect("who" in recorded(actor)[0]).toBe(false);
	});

	// The whole point of the pick: the prose names nobody the board could find.
	it("keeps a pick made about writing that names nobody", async () => {
		actor  = makeActor({ live: { stepKey: "step6", q: 2, a: "I asked, and got a shrug.", who: "actor-3" } });
		dialog = makeDialog(actor, makeRoot({ text: "I asked, and got a shrug." }));
		await dialog._recordDraft("actor-1", "step6");
		expect(recorded(actor)[0].who).toBe("actor-3");
	});

	// Recording ends the draft, pick and all, so the next answer starts from nobody.
	it("clears the live buffer, so the next answer starts unpicked", async () => {
		await dialog._recordDraft("actor-1", "step6");
		expect(live(actor)).toBeUndefined();
		expect(dialog._stepDraft("actor-1", "step6")).toEqual({ q: null, a: "", who: null });
	});
});

describe("IntroductionsDialog — a pick surviving the typing", () => {
	// ⚠ THE ONE THAT BITES. `live` is written WHOLE on every keystroke (setFlag deep-merges, so a
	// partial write would leave a stale sub-key behind after a step switch), which means a
	// keystroke handler that does not carry `who` writes the buffer back with the pick missing.
	// The writer chooses a person, types one more character, and the choice is gone with nothing
	// on screen to say so.
	it("does not rub out the pick when the next keystroke is flushed", async () => {
		const actor  = makeActor({ live: { stepKey: "step6", q: 0, a: "She only", who: "actor-2" } });
		const dialog = makeDialog(actor, makeRoot({ text: "She only laughed." }));
		await dialog._flushCaptureFromDom();
		expect(live(actor)).toEqual({ stepKey: "step6", q: 0, a: "She only laughed.", who: "actor-2" });
	});

	// Same buffer, the other two writers: the Next-time flush and a direct save.
	it("carries the pick through the flush the GM's Next runs", async () => {
		const actor  = makeActor({ live: { stepKey: "step6", q: 3, a: "Asked.", who: "actor-4" } });
		const dialog = makeDialog(actor, makeRoot({ text: "Asked outright." }));
		await dialog._flushDraftFromDom(actor, { stepKey: "step6" });
		expect(live(actor)).toMatchObject({ a: "Asked outright.", q: 3, who: "actor-4" });
	});

	it("takes a pick back to nobody when it is cleared", async () => {
		const actor  = makeActor({ live: { stepKey: "step6", q: 0, a: "Asked.", who: "actor-2" } });
		const dialog = makeDialog(actor, makeRoot());
		await dialog._saveDraft("actor-1", "step6", { q: 0, a: "Asked.", who: "" });
		expect(live(actor).who).toBeNull();
	});

	// A draft written before the picker existed reads as nobody picked, rather than as undefined
	// leaking into the record on the next write.
	it("reads a draft from before the pick existed as nobody picked", () => {
		const actor  = makeActor({ live: { stepKey: "step6", q: 0, a: "Sela, of course." } });
		const dialog = makeDialog(actor, makeRoot());
		expect(dialog._stepDraft("actor-1", "step6").who).toBeNull();
	});

	// The no-op guard has to notice the pick too, or choosing somebody while the text and the
	// question stand still would be swallowed as "nothing changed".
	it("writes when only the pick changed", async () => {
		const actor  = makeActor({ live: { stepKey: "step6", q: 0, a: "Asked.", who: "actor-2" } });
		const dialog = makeDialog(actor, makeRoot());
		await dialog._saveDraft("actor-1", "step6", { q: 0, a: "Asked.", who: "actor-3" });
		expect(actor.setFlag).toHaveBeenCalledTimes(1);
		expect(live(actor).who).toBe("actor-3");
	});
});

describe("IntroductionsDialog — reading the pick that is on screen", () => {
	// ⚠ THE RACE THIS CLOSES. The about select writes its pick with an awaited `setFlag` and
	// deliberately does NOT re-render; a keystroke landing while that write is still in the air read
	// the flag, got the OLD pick, and the debounced write 300ms later put it back over the one the
	// writer had just made -- with nothing on screen to say so.
	it("reads the pick off the control rather than the flag it is still being written to", () => {
		// The flag is a write behind: it still says nobody was picked.
		const actor  = makeActor({ live: { stepKey: "step6", q: 0, a: "She only" } });
		const dialog = makeDialog(actor, makeRoot({ text: "She only", about: "actor-2" }));
		expect(dialog._aboutPicked("actor-1", "step6")).toBe("actor-2");
	});

	// "" is a real answer on that control -- "Nobody at this table" -- and not the same as having no
	// control to read, which is why one is a string and the other undefined.
	it("tells a cleared pick apart from a step that has no such control", () => {
		const actor = makeActor({});
		expect(makeDialog(actor, makeRoot({ about: "" }))._aboutPicked("actor-1", "step6")).toBe("");
		expect(makeDialog(actor, makeRoot({}))._aboutPicked("actor-1", "step6")).toBeUndefined();
	});

	// The control left over from another turn answers for nobody: the step it belongs to is on it,
	// and a select for a different PC or a different step is not this step's answer.
	it("refuses a control belonging to another writer or another step", () => {
		const actor  = makeActor({});
		const dialog = makeDialog(actor, makeRoot({ stepKey: "step4", about: "actor-2" }));
		expect(dialog._aboutPicked("actor-1", "step6")).toBeUndefined();
		expect(dialog._aboutPicked("actor-9", "step4")).toBeUndefined();
		expect(dialog._aboutPicked("actor-1", "step4")).toBe("actor-2");
	});
});
