import { describe, it, expect } from "vitest";
import { RelationshipLinkDialog } from "../../module/dialogs/RelationshipLinkDialog.js";
import {
	RELMAP_KINS, RELMAP_KIN_CHILD, RELMAP_KIN_DEFAULT, RELMAP_KIN_NONE, RELMAP_KIN_PARENT,
	RELMAP_KIN_PARTNER,
} from "../../module/utils/relmap-kin.js";

// The link editor's one piece of behaviour that is not a form field: the family tie following the
// words as they are typed.
//
// It is a suggestion made IN FRONT OF THE READER, on a control they can watch move, and the whole
// value of it rests on two things being true at once — it keeps up with what they are writing, and
// it never overrules an answer they gave themselves. Both are easy to lose, and neither fails
// loudly: a tie set the wrong way round leaves no trace in the caption at all.
//
// The suite runs in node, so the DOM is a hand-rolled stand-in for the handful of calls this path
// makes. The markup itself is pinned by the template suite.

/**
 * A REAL RADIO GROUP, which matters here rather than being scenery: checking one unchecks its
 * siblings, so "the checked one" is a single answer. A set of independent booleans would let a
 * guess that never fired read as the answer that was already there.
 */
function groupOf(startAt) {
	let current = startAt;
	return RELMAP_KINS.map(value => {
		const radio = {
			value,
			listeners: {},
			addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); },
			/** What a READER clicking this radio does, which is what fires `change`. */
			pick() {
				current = value;
				for (const fn of this.listeners.change ?? []) fn();
			},
		};
		Object.defineProperty(radio, "checked", {
			get: () => current === value,
			set: on => { if (on) current = value; else if (current === value) current = null; },
		});
		return radio;
	});
}

/**
 * A wired-up dialog root, and a `type` that plays one edit of the label field.
 *
 * `startAt` is what the tie was set to when the dialog opened: the default for a new line, or a
 * stored answer for one being edited.
 *
 * `edge` is the LINE the dialog was opened on, where it was opened on one, and it is not the same
 * question as `startAt`: a stored "not a family tie" and a line nobody has ever been asked about
 * both open with the same radio checked, and only the edge can tell them apart.
 */
function wiredTo(startAt = RELMAP_KIN_DEFAULT, edge = null) {
	const radios = groupOf(startAt);
	const field = {
		value: "",
		listeners: {},
		addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); },
	};
	const root = {
		querySelector: sel => (sel === "#relmap-link-label" ? field : null),
		querySelectorAll: sel => (sel === "input[name='kin']" ? radios : []),
	};
	const app = Object.create(RelationshipLinkDialog.prototype);
	app._edge = edge;
	app._followLabel(root);

	return {
		byValue: value => radios.find(r => r.value === value),
		type(words) {
			field.value = words;
			for (const fn of field.listeners.input ?? []) fn();
		},
		get chosen() { return radios.find(r => r.checked)?.value ?? null; },
	};
}

describe("the family tie following the words", () => {
	it("marks a tie the caption plainly names", () => {
		const form = wiredTo();
		form.type("her mother");
		expect(form.chosen).toBe(RELMAP_KIN_PARENT);
	});

	// ⚠ THE FAULT THIS EXISTS TO CATCH. Setting `checked` from script fires no `change`, so the
	// guess cannot tell its own last answer from the reader's by that alone — and the check that
	// stood down on a non-default answer used to stand down on ITS OWN. The guess fired once per
	// dialog and then went quiet: somebody who typed "her mother", thought better of it and retyped
	// "his wife" saved a PARENT tie for a spouse, which is exactly the backwards tie the feature
	// warns about, made silently on a control they never touched.
	it("keeps following after it has already guessed once", () => {
		const form = wiredTo();
		form.type("her mother");
		expect(form.chosen).toBe(RELMAP_KIN_PARENT);
		form.type("his wife");
		expect(form.chosen).toBe(RELMAP_KIN_PARTNER);
		form.type("her son");
		expect(form.chosen).toBe(RELMAP_KIN_CHILD);
	});

	// And back to nothing when the words stop naming a tie, rather than leaving the last guess
	// standing over a caption that no longer says it.
	it("takes its own guess back when the words stop saying family", () => {
		const form = wiredTo();
		form.type("her mother");
		form.type("drinks with him at the Wolf");
		expect(form.chosen).toBe(RELMAP_KIN_NONE);
	});

	// THE OTHER HALF OF THE BARGAIN. A reader who has touched the control has answered, and an
	// answer is never overruled — including "not a family tie", which is the answer somebody gives
	// precisely when the caption is misleading.
	it("stops for good the moment the reader touches the control", () => {
		const form = wiredTo();
		form.byValue(RELMAP_KIN_PARTNER).pick();
		form.type("her mother");
		expect(form.chosen).toBe(RELMAP_KIN_PARTNER);
		form.type("his daughter");
		expect(form.chosen).toBe(RELMAP_KIN_PARTNER);
	});

	it("does not go back to guessing when the reader's answer IS the default", () => {
		const form = wiredTo();
		form.byValue(RELMAP_KIN_NONE).pick();
		form.type("her mother");
		expect(form.chosen).toBe(RELMAP_KIN_NONE);
	});

	// A line being edited arrives with its tie already set. That is somebody's answer from an
	// earlier sitting, and rewording the caption does not withdraw it.
	it("leaves a tie the line was opened with alone", () => {
		const form = wiredTo(RELMAP_KIN_PARTNER);
		form.type("her mother");
		expect(form.chosen).toBe(RELMAP_KIN_PARTNER);
	});

	// ⚠ AND "NOT A FAMILY TIE" IS SUCH AN ANSWER, which is the half the radios cannot show. It
	// stores as `none` — the same value a line nobody has been asked about opens on — so a guard
	// that could only see which radio was checked read the two alike and re-guessed at the one that
	// had been answered. This is the exact line the feature warns about: a caption that reads like
	// family, deliberately marked as not, and then reopened to fix a word in it.
	it("leaves a stored 'not a family tie' alone, though it looks like the default", () => {
		const form = wiredTo(RELMAP_KIN_NONE, { kin: RELMAP_KIN_NONE, label: "smothered her at the mill" });
		form.type("her mother took her in");
		expect(form.chosen).toBe(RELMAP_KIN_NONE);
	});

	// The other side of that: a line drawn before ties were asked about carries NO answer, so it is
	// one the guess may help with — which is the whole reason `readKin` keeps absent apart from
	// `none` in the first place.
	it("still follows the words on a line nobody has ever been asked about", () => {
		const form = wiredTo(RELMAP_KIN_NONE, { label: "her mother" });
		form.type("her mother");
		expect(form.chosen).toBe(RELMAP_KIN_PARENT);
	});

	it("does nothing at all when the field is not there", () => {
		const app = Object.create(RelationshipLinkDialog.prototype);
		expect(() => app._followLabel({ querySelector: () => null, querySelectorAll: () => [] }))
			.not.toThrow();
	});
});
