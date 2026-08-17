import { afterEach, describe, expect, it, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

// Using an Invocation is a MOVE, not just a chat post: every Lightbearer starts with Invoke
// the Sun God, so tapping one asks whether to roll +WIS — and, for a 6th-level Lightbearer,
// whether to pay an extra consequence to empower it. These cover the whole decision table,
// plus the contract that makes ✕ safe: dismissing means the Invocation was never used.

const BLINDING_FLASH = "<p>Your light blazes; any in range who look at it are blinded.</p>"
	+ "<p><strong>Reduced:</strong> the light flares only for a moment.</p>"
	+ "<p><strong>Empowered:</strong> if you wish, your allies are unaffected.</p>";
const NO_EMPOWERED = "<p>Your light steadies.</p><p><strong>Reduced:</strong> only briefly.</p>";

const move = name => ({ type: "move", name });

/** The Dialog the sheet opened, plus the two ways out of it. */
let opened = null;

function installDialogStub() {
	global.Dialog = class {
		constructor(config, options) {
			opened = { ...config, options, closed: false };
		}
		render() { return this; }
	};
	// Whatever the callbacks read out of the window. `checked` drives the empower checkbox.
	const fakeHtml = ({ checked = false } = {}) => ({ find: () => [{ checked }] });
	return {
		press(button, { empowerChecked = false } = {}) {
			opened.buttons[button].callback(fakeHtml({ checked: empowerChecked }));
			opened.close();
		},
		dismiss() { opened.close(); },
	};
}

function makeSheet({ moves = [], editable = true, ongoing = "" } = {}) {
	const actor = new FakeActorBuilder().withItems(moves).build();
	actor.isOwner = true;
	// The holy-light state and the ongoing Invocation are all this path reads out of the
	// character model. The setter mirrors the real one's contract: it reports whether anything
	// actually changed, and the getter answers what was last written.
	actor.typedActor = {
		holyLight: false,
		ongoingInvocation: ongoing,
		setOngoingInvocation: vi.fn(async function (slug) {
			const next = String(slug ?? "");
			if (next === this.ongoingInvocation) return false;
			this.ongoingInvocation = next;
			return true;
		}),
	};
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return editable; }
		activateListeners() {}
		// The repaint that shows the new state is guarded on the sheet still being open.
		rendered = true;
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	// One shared log, so the ORDER of card-then-roll can be asserted, not just the calls.
	const calls = [];
	sheet._postMoveCard = vi.fn(async (title, body) => { calls.push({ card: { title, body } }); return { title, body }; });
	sheet.rollMoveByName = vi.fn(async (name, opts) => { calls.push({ roll: { name, opts } }); });
	sheet._pastDeathWindowClasses = classes => classes;
	// What the last render read off the playbook — set by _buildInvocationsData in the real sheet,
	// and the only way any of these paths can turn a slug back into a printed name.
	sheet._invocationOptions = INVOCATIONS;
	return { sheet, actor, calls };
}

const INVOCATIONS = [
	{ slug: "warmth-of-the-sun", label: "Warmth of the Sun", ongoing: true },
	{ slug: "blinding-flash",    label: "Blinding Flash",    ongoing: true },
	{ slug: "cleansing-light",   label: "Cleansing Light",   ongoing: false },
];

const BOTH_MOVES = [move("Invoke the Sun God"), move("Empowered Invocations")];
// The tap on a card's title, as the click handler assembles it.
const tap = (sheet, slug, opts = {}) => {
	const inv = INVOCATIONS.find(i => i.slug === slug);
	return sheet._postInvocationCard(inv.label, BLINDING_FLASH, { slug, ongoing: inv.ongoing, ...opts });
};

afterEach(() => { delete global.Dialog; opened = null; });

describe("using an Invocation", () => {
	it("just posts it for someone with neither move — no window at all", async () => {
		installDialogStub();
		const { sheet, calls } = makeSheet({ moves: [move("Guardian")] });
		await sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		expect(opened).toBeNull();
		expect(calls).toHaveLength(1);
		expect(calls[0].card.title).toBe("Blinding Flash");
		expect(calls[0].card.body).not.toMatch(/Empowered/);
	});

	// Invoke the Sun God is "choose an Invocation YOU KNOW and roll +WIS", and the tab lists
	// all ten whether or not they're learned — a 1st-level Lightbearer knows two. Reading an
	// un-learned one stays free; rolling it must not be on offer.
	it("reads out an un-learned Invocation without offering the roll", async () => {
		installDialogStub();
		const { sheet, calls } = makeSheet({ moves: [move("Invoke the Sun God"), move("Empowered Invocations")] });
		await sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH, { known: false });

		expect(opened, "an un-learned Invocation must not open the invoke window").toBeNull();
		expect(calls).toHaveLength(1);
		expect(calls[0].card.title).toBe("Blinding Flash");
		expect(sheet.rollMoveByName).not.toHaveBeenCalled();
		// ...and the empowered effect is still stripped, exactly as on a learned one.
		expect(calls[0].card.body).not.toMatch(/allies are unaffected/);
	});

	it("offers no roll to a viewer who can't edit the sheet", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God")], editable: false });
		await sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		// rollMoveById bails silently when the sheet isn't editable, so a roll button there
		// would do nothing at all — better to post the card and say nothing.
		expect(opened).toBeNull();
	});

	it("asks a plain Lightbearer to roll, with no empower checkbox", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God")] });
		const posting = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		expect(Object.keys(opened.buttons)).toEqual(["roll", "no"]);
		expect(opened.buttons.roll.label).toBe("Invoke the Sun God (+WIS)");
		expect(opened.content).not.toMatch(/name="empower"/);
		expect(opened.content).not.toMatch(/allies are unaffected/);
		opened.close();
		await posting;
	});

	// The button set must not shuffle as the character levels: this window opens on every
	// single Invocation use, so empowering rides a checkbox rather than a third button.
	it("keeps the same two buttons at 6th level, adding only the checkbox", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God"), move("Empowered Invocations")] });
		const posting = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		expect(Object.keys(opened.buttons)).toEqual(["roll", "no"]);
		expect(opened.content).toMatch(/name="empower"/);
		expect(opened.content).toMatch(/allies are unaffected/);
		opened.close();
		await posting;
	});

	it("offers no empower checkbox for an Invocation that has no empowered effect", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God"), move("Empowered Invocations")] });
		const posting = sheet._postInvocationCard("Steady Light", NO_EMPOWERED);
		expect(opened.content).not.toMatch(/name="empower"/);
		opened.close();
		await posting;
	});

	it("posts the card and then rolls +WIS", async () => {
		const dialog = installDialogStub();
		const { sheet, calls } = makeSheet({ moves: [move("Invoke the Sun God")] });
		const posting = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		dialog.press("roll");
		await posting;

		expect(calls.map(c => Object.keys(c)[0])).toEqual(["card", "roll"]);
		expect(calls[0].card.title).toBe("Blinding Flash");
		expect(calls[0].card.body).not.toMatch(/Empowered/);
		expect(calls[1].roll).toEqual({ name: "Invoke the Sun God", opts: { shiftKey: false } });
	});

	it("marks the card empowered and still rolls when the box is ticked", async () => {
		const dialog = installDialogStub();
		const { sheet, calls } = makeSheet({ moves: [move("Invoke the Sun God"), move("Empowered Invocations")] });
		const posting = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		dialog.press("roll", { empowerChecked: true });
		await posting;

		expect(calls[0].card.title).toBe("Blinding Flash (Empowered)");
		expect(calls[0].card.body).toMatch(/extra consequence/);
		expect(calls[0].card.body).toMatch(/allies are unaffected/);
		expect(calls[1].roll.name).toBe("Invoke the Sun God");
	});

	it("posts without rolling on 'Just show it'", async () => {
		const dialog = installDialogStub();
		const { sheet, calls } = makeSheet({ moves: [move("Invoke the Sun God")] });
		const posting = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		dialog.press("no");
		await posting;

		expect(calls).toHaveLength(1);
		expect(calls[0].card).toBeTruthy();
	});

	// The load-bearing contract: the choices are made BEFORE the roll, so backing out of the
	// window means the Invocation was never used — no card, no roll, nothing.
	it("does nothing at all when the window is dismissed", async () => {
		const dialog = installDialogStub();
		const { sheet, calls } = makeSheet({ moves: [move("Invoke the Sun God")] });
		const posting = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		dialog.dismiss();
		await expect(posting).resolves.toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("carries Shift through to the roll, so the modifier prompt can still be skipped", async () => {
		const dialog = installDialogStub();
		const { sheet, calls } = makeSheet({ moves: [move("Invoke the Sun God")] });
		const posting = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH, { shiftKey: true });
		dialog.press("roll");
		await posting;
		expect(calls[1].roll.opts).toEqual({ shiftKey: true });
	});

	it("says so when no holy light is lit, without blocking the roll", async () => {
		installDialogStub();
		const { sheet, actor } = makeSheet({ moves: [move("Invoke the Sun God")] });
		const unlit = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		expect(opened.content).toMatch(/stonetop-invoke-nolight/);
		expect(Object.keys(opened.buttons)).toContain("roll");
		opened.close();
		await unlit;

		actor.typedActor.holyLight = true;
		const lit = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		expect(opened.content).not.toMatch(/stonetop-invoke-nolight/);
		opened.close();
		await lit;
	});

	// ── The ongoing Invocation ──────────────────────────────────────────────────────────
	// "While one Invocation is ongoing, you can't use another. You can end an Invocation whenever
	// you wish, and it will end immediately if your holy light is extinguished." The sheet now
	// records WHICH one — the half of that rule nothing was tracking.

	it("starts concentrating on an ongoing Invocation when it's used", async () => {
		const dialog = installDialogStub();
		const { sheet, actor } = makeSheet({ moves: BOTH_MOVES });
		const posting = tap(sheet, "warmth-of-the-sun");
		expect(opened.content).toMatch(/you'll be concentrating on it/);
		dialog.press("roll");
		await posting;
		expect(actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
		expect(sheet.render).toHaveBeenCalled();
	});

	it("takes hold of nothing when an instant Invocation is used", async () => {
		const dialog = installDialogStub();
		const { sheet, actor } = makeSheet({ moves: BOTH_MOVES });
		const posting = tap(sheet, "cleansing-light");
		expect(opened.content).not.toMatch(/concentrating/);
		dialog.press("roll");
		await posting;
		expect(actor.typedActor.setOngoingInvocation).not.toHaveBeenCalled();
	});

	it("names the Invocation a swap would cost, before the roll", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: BOTH_MOVES, ongoing: "warmth-of-the-sun" });
		const posting = tap(sheet, "blinding-flash");
		expect(opened.content).toMatch(/concentrating on <strong>Warmth of the Sun<\/strong>/);
		expect(opened.content).toMatch(/Invoking this ends it/);
		dialog.press("roll");
		await posting;

		expect(actor.typedActor.ongoingInvocation).toBe("blinding-flash");
		// One post, not two: what stopped is named at the top of the card that stopped it.
		expect(calls.filter(c => c.card)).toHaveLength(1);
		expect(calls[0].card.body).toMatch(/Warmth of the Sun ends/);
	});

	// The surprising one — an instant Invocation costs the ongoing one and replaces it with
	// nothing, because the bar is on using ANY second Invocation.
	it("lets the ongoing Invocation go when an instant one is used", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: BOTH_MOVES, ongoing: "warmth-of-the-sun" });
		const posting = tap(sheet, "cleansing-light");
		expect(opened.content).toMatch(/so using this one lets it go/);
		dialog.press("roll");
		await posting;

		expect(actor.typedActor.ongoingInvocation).toBe("");
		expect(calls[0].card.body).toMatch(/Warmth of the Sun ends/);
	});

	// Re-invoking to keep it up is the common case at the table. It must not report an ending in
	// the same breath as its own card, and must not write a flag that isn't changing.
	it("renews the Invocation already running without saying anything ended", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: BOTH_MOVES, ongoing: "warmth-of-the-sun" });
		const posting = tap(sheet, "warmth-of-the-sun");
		expect(opened.content).toMatch(/already concentrating on <strong>Warmth of the Sun<\/strong>/);
		dialog.press("roll");
		await posting;

		expect(actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
		expect(actor.typedActor.setOngoingInvocation).not.toHaveBeenCalled();
		expect(calls[0].card.body).not.toMatch(/ends/);
	});

	// The load-bearing half of "Just show it": reading an Invocation's text out to the table is
	// not using it, so it must neither take hold of a new one nor drop the one running.
	it("leaves the ongoing Invocation alone when the text is only shown", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: BOTH_MOVES, ongoing: "warmth-of-the-sun" });
		const posting = tap(sheet, "blinding-flash");
		dialog.press("no");
		await posting;

		expect(actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
		expect(actor.typedActor.setOngoingInvocation).not.toHaveBeenCalled();
		expect(calls[0].card.body).not.toMatch(/Warmth of the Sun ends/);
	});

	it("changes nothing when the window is dismissed", async () => {
		const dialog = installDialogStub();
		const { sheet, actor } = makeSheet({ moves: BOTH_MOVES, ongoing: "warmth-of-the-sun" });
		const posting = tap(sheet, "blinding-flash");
		dialog.dismiss();
		await posting;
		expect(actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
	});

	// The window's affirmative button takes hold of the Invocation whether or not it also rolls,
	// so the warning about what that costs cannot live inside the "can you roll this?" branch.
	it("still warns about the swap when the window is only offering to empower it", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Empowered Invocations")], ongoing: "warmth-of-the-sun" });
		const posting = tap(sheet, "blinding-flash");
		expect(opened.buttons.roll.label, "this is the empower-only window").toBe("Use it");
		expect(opened.content).toMatch(/concentrating on <strong>Warmth of the Sun<\/strong>/);
		opened.close();
		await posting;
	});

	// Owning Invoke the Sun God earns the ROLL; it is not what lets an Invocation take hold. A
	// character with Invocations and not that move (a cross-playbook pick through Versatile, a
	// Lightbearer whose starting move was dropped) opens no window — and used to reach none of the
	// bookkeeping behind it either, leaving the chip, the banner and the one-at-a-time rule dead
	// for that character forever.
	it("still concentrates for a character who lacks Invoke the Sun God", async () => {
		installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: [move("Guardian")] });
		await tap(sheet, "warmth-of-the-sun");

		expect(opened, "nothing to ask, so no window").toBeNull();
		expect(actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
		expect(calls.filter(c => c.roll), "and still no roll they can't make").toHaveLength(0);
	});

	it("names what it displaced even with no window to have warned in", async () => {
		installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: [move("Guardian")], ongoing: "warmth-of-the-sun" });
		await tap(sheet, "blinding-flash");

		expect(actor.typedActor.ongoingInvocation).toBe("blinding-flash");
		expect(calls[0].card.body).toMatch(/Warmth of the Sun ends/);
	});

	// An un-learned Invocation opens no window at all, so it must not reach the state either —
	// the read-out path is exactly the "not using it" case.
	it("doesn't concentrate on an Invocation this character hasn't learned", async () => {
		installDialogStub();
		const { sheet, actor } = makeSheet({ moves: BOTH_MOVES });
		await tap(sheet, "warmth-of-the-sun", { known: false });
		expect(actor.typedActor.setOngoingInvocation).not.toHaveBeenCalled();
	});

	it("keeps the window in the system's chrome", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God")] });
		const posting = sheet._postInvocationCard("Blinding Flash", BLINDING_FLASH);
		// Without "stonetop" the window renders as a bare core dialog; the empower classes are
		// what the sun-tinted effect band hangs off.
		expect(opened.options.classes).toContain("stonetop");
		expect(opened.options.classes).toContain("stonetop-empower-dialog");
		expect(opened.options.classes).toContain("stonetop-invoke-dialog");
		opened.close();
		await posting;
	});
});
