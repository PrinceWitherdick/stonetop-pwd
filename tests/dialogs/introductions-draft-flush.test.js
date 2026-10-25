import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntroductionsDialog } from "../../module/dialogs/IntroductionsDialog.js";

// ── The capture flush that runs at the top of every re-render ──────────────────
// IntroductionsDialog._render flushes the on-screen capture field into the draft flag
// before AppV1 rebuilds the DOM, so a keystroke that hasn't been written yet survives a
// re-render. That flush used to take the CHOSEN QUESTION from the DOM too — from whichever
// pick still carried .is-selected — and the DOM is a render behind at exactly the moment it
// matters: picking a question writes the flag and THEN re-renders. So the flush wrote the
// old pick straight back, and on "Bonds & ties" / "Asking the others" a second choice did
// nothing at all. Same flush, recording an answer: the field still showed the answer just
// committed, so the flush re-created it as a fresh draft and the next Next recorded it twice.
//
// No DOM in this suite (vitest runs in node), so the dialog is driven through hand-built
// stand-ins for the two things the flush reads: the window root, and the PC actor's flag.

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
		// Only the shape _commitStep writes: one dotted step field plus the draft unset.
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

// A window root that answers the three selectors _flushCaptureFromDom asks for. `pick` is
// the question the LAST RENDER highlighted — deliberately allowed to disagree with the flag.
function makeRoot({ actorId = "actor-1", stepKey = "step6", text = "", pick = null } = {}) {
	const queried = [];
	// One stable element, so a test can make it the focused one by identity.
	const draftEl = { dataset: { actorId, stepKey }, value: text };
	return {
		queried,
		draftEl,
		querySelector: (sel) => {
			queried.push(sel);
			if (sel.includes("stonetop-intros-answer")) return null;
			if (sel.includes("stonetop-intros-draft")) return draftEl;
			if (sel.includes("stonetop-intros-question-pick")) {
				return pick === null ? null : { dataset: { qIndex: String(pick) } };
			}
			return null;
		},
	};
}

// The suite runs in node with no DOM, so `globalThis.document` is absent and nothing reads as
// focused. Install a stand-in for the one test that needs the caret to be in the field.
function withFocus(el, fn) {
	const had = "document" in globalThis;
	const prev = globalThis.document;
	globalThis.document = { activeElement: el };
	return Promise.resolve(fn()).finally(() => {
		if (had) globalThis.document = prev; else delete globalThis.document;
	});
}

function makeDialog(actor, root) {
	const dialog = new IntroductionsDialog();
	dialog.element = [root];
	dialog._actor  = () => actor;
	// Sole editor: the owning player writing their own PC, which is what gates the flush.
	dialog._ownedActor          = () => actor;
	dialog._hasOnlinePlayerOwner = () => false;
	return dialog;
}

describe("IntroductionsDialog — capture flush", () => {
	let actor, root, dialog;

	beforeEach(() => {
		actor  = makeActor({ drafts: { step6: { q: 0, a: "" } } });
		root   = makeRoot({ text: "", pick: 2 });   // flag says q0, last render highlighted q2
		dialog = makeDialog(actor, root);
	});

	it("keeps the pick the flag holds, not the one the last render highlighted", async () => {
		await dialog._flushCaptureFromDom();
		expect(actor.getFlag(SCOPE, `${FLAG}.drafts.step6`).q).toBe(0);
	});

	it("does not consult the highlighted pick at all", async () => {
		await dialog._flushCaptureFromDom();
		expect(root.queried.some(sel => sel.includes("question-pick"))).toBe(false);
	});

	it("still saves text typed since the last write", async () => {
		dialog.element = [makeRoot({ text: "half a sentence", pick: 2 })];
		await dialog._flushCaptureFromDom();
		expect(actor.getFlag(SCOPE, `${FLAG}.drafts.step6`)).toMatchObject({ q: 0, a: "half a sentence" });
	});

	it("leaves a line with no pick unpicked rather than adopting a stale highlight", async () => {
		actor  = makeActor({ drafts: { step6: { q: null, a: "typing" } } });
		dialog = makeDialog(actor, makeRoot({ text: "typing", pick: 3 }));
		await dialog._flushCaptureFromDom();
		expect(actor.getFlag(SCOPE, `${FLAG}.drafts.step6`).q).toBeNull();
	});
});

describe("IntroductionsDialog — flush after a commit", () => {
	it("does not re-create the draft a commit just cleared", async () => {
		// Recorded: the answer is in the step list and the draft is gone, but the field on
		// screen still shows it until the render that follows rebuilds it.
		const actor = makeActor({ drafts: { step6: { q: 2, a: "Test" } } });
		const dialog = makeDialog(actor, makeRoot({ text: "Test", pick: 2 }));

		await dialog._commitStep(actor, "step6", "answers", [{ q: 2, a: "Test" }]);
		expect(actor.getFlag(SCOPE, `${FLAG}.drafts.step6`)).toBeUndefined();

		await dialog._flushCaptureFromDom();
		expect(actor.getFlag(SCOPE, `${FLAG}.drafts.step6`)).toBeUndefined();
		expect(actor.getFlag(SCOPE, `${FLAG}.step6.answers`)).toHaveLength(1);
	});

	it("suppresses one flush only — the next one writes normally", async () => {
		const actor  = makeActor({ drafts: { step6: { q: 1, a: "" } } });
		const dialog = makeDialog(actor, makeRoot({ text: "", pick: 1 }));

		await dialog._commitStep(actor, "step6", "passed", true);
		await dialog._flushCaptureFromDom();          // suppressed
		await actor.setFlag(SCOPE, `${FLAG}.drafts.step6`, { q: 3, a: "" });
		dialog.element = [makeRoot({ text: "a new answer", pick: 3 })];

		await dialog._flushCaptureFromDom();
		expect(actor.getFlag(SCOPE, `${FLAG}.drafts.step6`)).toMatchObject({ q: 3, a: "a new answer" });
	});

	// The one-shot lives on the instance that did the committing. Every OTHER open dialog —
	// the player's, when the GM's Next commits their draft — re-renders off the updateActor
	// hook with a field that still shows the recorded answer and no suppression of its own.
	it("does not resurrect the draft on a client that did not do the committing", async () => {
		const actor = makeActor({ step6: { answers: [{ q: 2, a: "Test" }] } }); // draft already cleared
		const watcher = makeDialog(actor, makeRoot({ text: "Test", pick: 2 }));

		await watcher._flushCaptureFromDom();
		expect(actor.getFlag(SCOPE, `${FLAG}.drafts.step6`)).toBeUndefined();
	});

	it("still rescues the first keystroke of a draft the flag has not seen yet", async () => {
		const actor = makeActor();                       // no draft at all
		const root  = makeRoot({ text: "half a sen" });   // typed, debounce still pending
		const dialog = makeDialog(actor, root);

		await withFocus(root.draftEl, () => dialog._flushCaptureFromDom());
		expect(actor.getFlag(SCOPE, `${FLAG}.drafts.step6`)).toMatchObject({ q: null, a: "half a sen" });
	});

	it("consumes the suppression even when there is no window to flush", async () => {
		const actor  = makeActor({ drafts: { step6: { q: 1, a: "" } } });
		const dialog = makeDialog(actor, makeRoot());
		await dialog._commitStep(actor, "step6", "passed", true);

		dialog.element = null;
		await dialog._flushCaptureFromDom();          // nothing to do, but the flag is spent

		await actor.setFlag(SCOPE, `${FLAG}.drafts.step6`, { q: 3, a: "" });
		dialog.element = [makeRoot({ text: "later text", pick: 3 })];
		await dialog._flushCaptureFromDom();
		expect(actor.getFlag(SCOPE, `${FLAG}.drafts.step6`)).toMatchObject({ q: 3, a: "later text" });
	});
});
