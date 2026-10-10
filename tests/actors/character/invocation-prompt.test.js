import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { invokeWindowNotice, readInvocationState, resolveInvocationEnd } from "../../../module/actors/character/ongoing-invocation.js";
import { auspiciousBirthChoice } from "../../../module/actors/character/invoke-consequences.js";
import { confirmOutcome, askWithButtons } from "../../../module/utils/ask-with-buttons.js";

// Re-consecrating asks first (R5); the answer is the test's to give.
vi.mock("../../../module/utils/ask-with-buttons.js", async (importOriginal) => ({
	...(await importOriginal()),
	confirmOutcome: vi.fn(async () => true),
	// Wielder of the White Flame's Invocation picker (B5).
	askWithButtons: vi.fn(async () => null),
}));

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
	// Whatever the callbacks read out of the window, by field name: `empower` and `burnTwice` are
	// checkboxes, `burnTwicePartner` and `burnTwicePrice` are selects.
	const fakeHtml = (fields = {}) => ({
		find: selector => {
			const name = /name="([^"]+)"/.exec(selector)?.[1];
			const v = fields[name];
			return [{ checked: v === true, value: typeof v === "string" ? v : "" }];
		},
	});
	return {
		press(button, { empowerChecked = false, fields = {} } = {}) {
			opened.buttons[button].callback(fakeHtml({ empower: empowerChecked, ...fields }));
			opened.close();
		},
		dismiss() { opened.close(); },
	};
}

function makeSheet({ moves = [], editable = true, ongoing = "", known = [], debilities = null, background = null, playbook = "The Lightbearer", needsSun = [] } = {}) {
	const builder = new FakeActorBuilder().withItems(moves);
	if (known.length) builder.withFlag("invocations.selected", known);
	const actor = builder.build();
	actor.isOwner = true;
	actor.system.playbook = { ...(actor.system.playbook ?? {}), name: playbook };
	// The holy-light state and the ongoing Invocations are all this path reads out of the character
	// model. The writer mirrors the real one's contract: it reports whether anything actually
	// changed, and the getters answer what was last written.
	let state = readInvocationState(typeof ongoing === "string" ? { primary: ongoing } : ongoing);
	const setupResources = {};
	let sun = [...needsSun];
	actor.typedActor = {
		holyLight: false,
		// The Invoke consequence "bask in sunlight ... before using that Invocation again" (R2).
		get invocationsNeedingSun() { return sun; },
		clearNeedsSun: vi.fn(async slugs => {
			const drop = new Set(slugs);
			const removed = sun.filter(s => drop.has(s));
			sun = sun.filter(s => !drop.has(s));
			return removed;
		}),
		invocationSource: vi.fn(async () => ({ options: INVOCATIONS })),
		get invocationState() { return state; },
		get ongoingInvocation() { return state.primary; },
		get ongoingInvocationSecond() { return state.second; },
		get ongoingInvocationEmpowered() { return state.empowered; },
		endOngoingInvocation: vi.fn(async slug => {
			const out = resolveInvocationEnd({ current: state, ending: slug });
			state = out.state;
			return { changed: out.changed, ended: out.ended, snuffed: false };
		}),
		setHolyLight: vi.fn(async function (lit) { const changed = this.holyLight !== !!lit; this.holyLight = !!lit; return changed; }),
		setInvocationState: vi.fn(async next => {
			const after = readInvocationState(next);
			const changed = JSON.stringify(after) !== JSON.stringify(state);
			state = after;
			return { changed, ended: [], snuffed: false };
		}),
		debilityChoices: debilities ?? [
			{ key: "weakened", name: "Weakened", marked: false },
			{ key: "dazed",    name: "Dazed",    marked: false },
			{ key: "miserable", name: "Miserable", marked: false },
		],
		// As StonetopCharacter#debilityMarkChoices: Auspicious Birth's circle first when that background is taken.
		get debilityMarkChoices() {
			const circle = auspiciousBirthChoice({ playbook, background, setupResources });
			return circle ? [circle, ...this.debilityChoices] : this.debilityChoices;
		},
		markDebility: vi.fn(async () => true),
		background: {
			selectedSlug: background,
			setupResources,
			setSetupResource: vi.fn(async (key, value) => { setupResources[key] = value; }),
		},
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
	{ slug: "dancing-light",     label: "Dancing Light",     ongoing: true,
		description: "<p>Your light takes to the air.</p><p><strong>Empowered:</strong> you can use another Invocation through the Dancing Light while it is ongoing.</p>" },
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
		// A pick context even naming nothing: it is what tells the roll ladder the Invocation was
		// already chosen here, so it does not ask "Which Invocation?" again.
		expect(calls[1].roll).toEqual({ name: "Invoke the Sun God", opts: { shiftKey: false, pickContext: { empowered: false, burnTwice: false } } });
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
		expect(calls[1].roll.opts.shiftKey).toBe(true);
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
		expect(actor.typedActor.setInvocationState).not.toHaveBeenCalled();
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
		expect(actor.typedActor.setInvocationState).not.toHaveBeenCalled();
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
		expect(actor.typedActor.setInvocationState).not.toHaveBeenCalled();
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
		expect(actor.typedActor.setInvocationState).not.toHaveBeenCalled();
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

// ── Lightbearer audit (2026-09-25) ────────────────────────────────────────────────────────
const unlearned = name => ({ type: "move", name, flags: { "stonetop-pwd": { learned: false } } });

describe("the invoke window asks LEARNED moves (B4)", () => {
	it("offers no roll for an un-learned Invoke the Sun God", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [unlearned("Invoke the Sun God")] });
		await tap(sheet, "blinding-flash");
		expect(opened, "switched off, so nothing to ask").toBeNull();
	});

	it("offers no empower box for an un-learned Empowered Invocations", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God"), unlearned("Empowered Invocations")] });
		const posting = tap(sheet, "blinding-flash");
		expect(opened.content).not.toMatch(/name="empower"/);
		opened.close();
		await posting;
	});
});

// "Empowered: the invocation is ongoing" (B2).
describe("an empowered Cleansing Light", () => {
	it("is held open when empowered, and not otherwise", async () => {
		const dialog = installDialogStub();
		const { sheet, actor } = makeSheet({ moves: BOTH_MOVES });
		const posting = tap(sheet, "cleansing-light");
		dialog.press("roll", { empowerChecked: true });
		await posting;
		expect(actor.typedActor.ongoingInvocation).toBe("cleansing-light");

		const plain = makeSheet({ moves: BOTH_MOVES });
		const again = tap(plain.sheet, "cleansing-light");
		dialog.press("roll");
		await again;
		expect(plain.actor.typedActor.ongoingInvocation).toBe("");
	});
});

// The empower choice reaches the roll card's consequence cap (B3).
describe("the roll carries the empower choice", () => {
	it("hands the roll a pick context when empowered", async () => {
		const dialog = installDialogStub();
		const { sheet, calls } = makeSheet({ moves: BOTH_MOVES });
		const posting = tap(sheet, "blinding-flash");
		dialog.press("roll", { empowerChecked: true });
		await posting;
		expect(calls[1].roll.opts).toEqual({ shiftKey: false, pickContext: { empowered: true, burnTwice: false, invocations: ["blinding-flash"] } });
	});
});

// "you can use another Invocation through the Dancing Light while it is ongoing" (R1).
describe("through an empowered Dancing Light", () => {
	it("keeps the Dancing Light and holds the other beside it", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: BOTH_MOVES, ongoing: { primary: "dancing-light", empowered: true } });
		const posting = tap(sheet, "warmth-of-the-sun");
		expect(opened.content).toMatch(/keeps burning: this one goes through it/);
		dialog.press("roll");
		await posting;
		expect(actor.typedActor.invocationState).toMatchObject({ primary: "dancing-light", second: "warmth-of-the-sun" });
		expect(calls[0].card.body).not.toMatch(/ends/);
	});

	it("records that the Dancing Light was empowered", async () => {
		const dialog = installDialogStub();
		const { sheet, actor } = makeSheet({ moves: BOTH_MOVES });
		const posting = sheet._postInvocationCard("Dancing Light", INVOCATIONS[3].description, { slug: "dancing-light", ongoing: true });
		dialog.press("roll", { empowerChecked: true });
		await posting;
		expect(actor.typedActor.invocationState).toMatchObject({ primary: "dancing-light", empowered: true });
	});
});

// "When you Invoke the Sun God, you may mark a debility to use 2 Invocations at once. Roll once, and
// apply any consequences to both Invocations." (R1)
describe("Burn Twice as Bright", () => {
	const BURN = [move("Invoke the Sun God"), move("Burn Twice as Bright")];

	it("is offered only with the move learned and another known Invocation to pair", async () => {
		installDialogStub();
		const none = makeSheet({ moves: [move("Invoke the Sun God")], known: ["warmth-of-the-sun", "blinding-flash"] });
		const a = tap(none.sheet, "blinding-flash");
		expect(opened.content).not.toMatch(/name="burnTwice"/);
		opened.close();
		await a;

		const lonely = makeSheet({ moves: BURN, known: ["blinding-flash"] });
		const b = tap(lonely.sheet, "blinding-flash");
		expect(opened.content).not.toMatch(/name="burnTwice"/);
		opened.close();
		await b;

		const ready = makeSheet({ moves: BURN, known: ["warmth-of-the-sun", "blinding-flash"] });
		const c = tap(ready.sheet, "blinding-flash");
		expect(opened.content).toMatch(/name="burnTwice"/);
		expect(opened.content).toMatch(/<option value="warmth-of-the-sun">Warmth of the Sun<\/option>/);
		expect(opened.content).not.toMatch(/<option value="blinding-flash">/);
		expect(opened.content).toMatch(/<option value="dazed">Mark Dazed<\/option>/);
		opened.close();
		await c;
	});

	it("posts ONE card naming both, marks the debility, rolls once, and fills both slots", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: BURN, known: ["warmth-of-the-sun", "blinding-flash"] });
		const posting = tap(sheet, "blinding-flash");
		dialog.press("roll", { fields: { burnTwice: true, burnTwicePartner: "warmth-of-the-sun", burnTwicePrice: "miserable" } });
		await posting;

		expect(calls.filter(c => c.card)).toHaveLength(1);
		expect(calls[0].card.title).toBe("Blinding Flash + Warmth of the Sun");
		expect(calls[0].card.body).toMatch(/Burn Twice as Bright/);
		expect(calls[0].card.body).toMatch(/You mark Miserable\./);
		expect(actor.typedActor.markDebility).toHaveBeenCalledWith("miserable", { moveName: "Burn Twice as Bright" });
		expect(calls.filter(c => c.roll)).toHaveLength(1);
		expect(calls[1].roll.opts.pickContext).toEqual({ empowered: false, burnTwice: true, invocations: ["blinding-flash", "warmth-of-the-sun"] });
		expect(actor.typedActor.invocationState).toMatchObject({ primary: "blinding-flash", second: "warmth-of-the-sun" });
	});

	it("does nothing twice-over when the box is left unticked", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: BURN, known: ["warmth-of-the-sun", "blinding-flash"] });
		const posting = tap(sheet, "blinding-flash");
		dialog.press("roll", { fields: { burnTwicePartner: "warmth-of-the-sun", burnTwicePrice: "miserable" } });
		await posting;
		expect(calls[0].card.title).toBe("Blinding Flash");
		expect(actor.typedActor.markDebility).not.toHaveBeenCalled();
	});

	it("offers the Auspicious Birth circle first, and marks it instead of a debility", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: BURN, known: ["warmth-of-the-sun", "blinding-flash"], background: "auspicious-birth" });
		const posting = tap(sheet, "blinding-flash");
		expect(opened.content).toMatch(/<select name="burnTwicePrice"><option value="auspicious-birth">/);
		dialog.press("roll", { fields: { burnTwice: true, burnTwicePartner: "warmth-of-the-sun", burnTwicePrice: "auspicious-birth" } });
		await posting;
		expect(actor.typedActor.background.setSetupResource).toHaveBeenCalledWith("auspicious-birth", 1);
		expect(actor.typedActor.markDebility).not.toHaveBeenCalled();
		expect(calls[0].card.body).toMatch(/Auspicious Birth circle/);
	});

	it("says there is nothing to pay with when every debility is marked", async () => {
		installDialogStub();
		const marked = ["weakened", "dazed", "miserable"].map(key => ({ key, name: key, marked: true }));
		const { sheet } = makeSheet({ moves: BURN, known: ["warmth-of-the-sun", "blinding-flash"], debilities: marked });
		const posting = tap(sheet, "blinding-flash");
		expect(opened.content).toMatch(/name="burnTwice" disabled/);
		expect(opened.content).toMatch(/nothing to pay Burn Twice as Bright with/);
		opened.close();
		await posting;
	});
});

// R5: consecrating a new flame puts the old one out, and what burns on it ends with it.
describe("re-consecrating a flame", () => {
	afterEach(() => { confirmOutcome.mockReset(); confirmOutcome.mockResolvedValue(true); });

	const lit = opts => {
		const made = makeSheet({ moves: BOTH_MOVES, ...opts });
		made.actor.typedActor.holyLight = true;
		return made;
	};

	it("asks first, naming what ends, with the ending answer first", async () => {
		confirmOutcome.mockResolvedValueOnce(true);
		const { sheet, actor, calls } = lit({ ongoing: "warmth-of-the-sun" });
		await sheet._consecrateFlame();
		expect(confirmOutcome).toHaveBeenCalledTimes(1);
		const ask = confirmOutcome.mock.calls[0][0];
		expect(ask.content).toMatch(/puts out the old flame and ends <strong>Warmth of the Sun<\/strong>/);
		expect(ask.yes.label).toBe("End it and consecrate");
		expect(actor.typedActor.ongoingInvocation).toBe("");
		expect(calls[0].card.body).toMatch(/Warmth of the Sun<\/strong> ends\./);
	});

	it("leaves everything as it was on No", async () => {
		confirmOutcome.mockResolvedValueOnce(false);
		const { sheet, actor, calls } = lit({ ongoing: "warmth-of-the-sun" });
		await sheet._consecrateFlame();
		expect(actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
		expect(calls).toHaveLength(0);
	});

	// "untethered from its fuel", and so is what goes through an empowered one.
	it("does not ask about a Dancing Light, or what goes through an empowered one", async () => {
		const { sheet, actor } = lit({ ongoing: { primary: "dancing-light", empowered: true, second: "warmth-of-the-sun" } });
		await sheet._consecrateFlame();
		expect(confirmOutcome).not.toHaveBeenCalled();
		expect(actor.typedActor.invocationState).toMatchObject({ primary: "dancing-light", second: "warmth-of-the-sun" });
	});

	it("asks nothing when the old flame was out", async () => {
		const { sheet, actor } = makeSheet({ moves: BOTH_MOVES, ongoing: "warmth-of-the-sun" });
		await sheet._consecrateFlame();
		expect(confirmOutcome).not.toHaveBeenCalled();
		expect(actor.typedActor.setHolyLight).toHaveBeenCalledWith(true);
	});
});

// B9: "N of M" on the Invocations tab. Flag, never block.
describe("the Invocations count cue", () => {
	const TEN = Array.from({ length: 10 }, (_, i) => ({ slug: `inv-${i}`, label: `Inv ${i}` }));
	const cueFor = ({ level, known, borrowed = false, grantedAt = null }) => {
		const { sheet, actor } = makeSheet({ known: TEN.slice(0, known).map(o => o.slug) });
		actor.system.attributes = { ...(actor.system.attributes ?? {}), level: { value: level } };
		if (grantedAt != null) actor.flags["stonetop-pwd"] = { ...(actor.flags["stonetop-pwd"] ?? {}), "invocations.grantedAtLevel": grantedAt };
		sheet._stonetopCharacter = actor.typedActor;
		globalThis.game.settings ??= { get: () => false };
		return sheet._buildInvocationsData({ startingCount: 2, options: TEN }, { borrowed }).countCue;
	};

	it("expects 2 + half the level for a Lightbearer: blue when short, gold when over, quiet when right", () => {
		expect(cueFor({ level: 4, known: 3 })).toMatchObject({ expected: 4, shortfall: 1, overage: 0 });
		expect(cueFor({ level: 4, known: 4 })).toBeNull();
		expect(cueFor({ level: 1, known: 3 })).toMatchObject({ expected: 2, overage: 1 });
	});
});

// R2: the roll card names which Invocation(s) it is for, so its consequences act on the right slot.
describe("the roll names its Invocation", () => {
	it("hands a plain roll the Invocation it is for", async () => {
		const dialog = installDialogStub();
		const { sheet, calls } = makeSheet({ moves: [move("Invoke the Sun God")] });
		const posting = tap(sheet, "warmth-of-the-sun");
		dialog.press("roll");
		await posting;
		expect(calls[1].roll.opts.pickContext).toEqual({ empowered: false, burnTwice: false, invocations: ["warmth-of-the-sun"] });
	});
});

// R2: "You must bask in sunlight for an hour or so before using that Invocation again". A cue, never a block.
describe("an Invocation that needs sun", () => {
	it("says so in the window, and still lets it be invoked", async () => {
		const dialog = installDialogStub();
		const { sheet, calls } = makeSheet({ moves: [move("Invoke the Sun God")], needsSun: ["warmth-of-the-sun"] });
		const posting = tap(sheet, "warmth-of-the-sun");
		expect(opened.content).toMatch(/stonetop-invoke-needs-sun/);
		expect(opened.content).toMatch(/<strong>Warmth of the Sun<\/strong> still needs sun/);
		dialog.press("roll");
		await posting;
		expect(calls.filter(c => c.roll)).toHaveLength(1);
	});

	it("says nothing about the sun for an Invocation that is not waiting on it", async () => {
		const dialog = installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God")], needsSun: ["blinding-flash"] });
		const posting = tap(sheet, "warmth-of-the-sun");
		expect(opened.content).not.toMatch(/needs sun/);
		dialog.dismiss();
		await posting;
	});

	it("clears the cue when it is used again, and not when it is only shown", async () => {
		const dialog = installDialogStub();
		const shown = makeSheet({ moves: [move("Invoke the Sun God")], needsSun: ["warmth-of-the-sun"] });
		const a = tap(shown.sheet, "warmth-of-the-sun");
		dialog.press("no");
		await a;
		expect(shown.actor.typedActor.invocationsNeedingSun).toEqual(["warmth-of-the-sun"]);

		const used = makeSheet({ moves: [move("Invoke the Sun God")], needsSun: ["warmth-of-the-sun", "blinding-flash"] });
		const b = tap(used.sheet, "warmth-of-the-sun");
		dialog.press("roll");
		await b;
		expect(used.actor.typedActor.invocationsNeedingSun).toEqual(["blinding-flash"]);
	});

	it("marks a Burn Twice partner that needs sun in the picker", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God"), move("Burn Twice as Bright")],
			known: ["warmth-of-the-sun", "blinding-flash"], needsSun: ["warmth-of-the-sun"] });
		const posting = tap(sheet, "blinding-flash");
		expect(opened.content).toMatch(/<option value="warmth-of-the-sun">Warmth of the Sun \(needs sun\)<\/option>/);
		opened.close();
		await posting;
	});

	it("shows on the tab's card, and Basked clears it", async () => {
		const { sheet, actor } = makeSheet({ known: ["warmth-of-the-sun"], needsSun: ["warmth-of-the-sun"] });
		globalThis.game.settings ??= { get: () => false };
		const data = sheet._buildInvocationsData({ startingCount: 2, options: INVOCATIONS });
		expect(data.options.find(o => o.slug === "warmth-of-the-sun").needsSun).toBe(true);
		expect(data.options.find(o => o.slug === "blinding-flash").needsSun).toBe(false);

		const ev = { preventDefault() {}, stopPropagation() {}, currentTarget: { dataset: { slug: "warmth-of-the-sun" } } };
		await sheet._onInvocationBasked(ev);
		expect(actor.typedActor.clearNeedsSun).toHaveBeenCalledWith(["warmth-of-the-sun"]);
		expect(actor.typedActor.invocationsNeedingSun).toEqual([]);
		expect(sheet.render).toHaveBeenCalled();
	});
});

// B5: Wielder of the White Flame's 10+, "you may Invoke the Sun God right now as if you rolled a 10+".
describe("Invoking as a 10+", () => {
	const INVOKE_TEXT = "<p>When you imbue a holy light with Helior's power, choose an Invocation you know and roll +WIS: "
		+ "on a 10+, it works as described but you must choose 1 consequence from the list below; on a 7-9, it works as "
		+ "described, but you and the GM each choose 1.</p><ul><li>The Invocation has its reduced effect</li>"
		+ "<li>The effort taxes you; mark a debility</li>"
		+ "<li>The light is snuffed out when the Invocation is complete, its fuel consumed</li>"
		+ "<li>You must bask in sunlight for an hour or so before using that Invocation again</li></ul>";
	const WIELDER = [{ ...move("Invoke the Sun God"), system: { description: INVOKE_TEXT } }, move("Wielder of the White Flame")];

	let posted;
	let savedChat;
	beforeEach(() => {
		posted = [];
		savedChat = globalThis.ChatMessage;
		globalThis.ChatMessage = { create: vi.fn(async data => { posted.push(data); return data; }), getSpeaker: () => ({ alias: "Seren" }) };
	});
	afterEach(() => { globalThis.ChatMessage = savedChat; askWithButtons.mockReset(); askWithButtons.mockResolvedValue(null); });

	it("posts the Invocation, then the 10+ consequence list to choose 1 from, and rolls nothing", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls } = makeSheet({ moves: WIELDER });
		const posting = tap(sheet, "warmth-of-the-sun", { asTenPlus: true });
		expect(opened.title).toBe("Warmth of the Sun: Invoke the Sun God as a 10+?");
		expect(opened.content).toMatch(/as if you rolled a 10\+, with no roll/);
		expect(opened.buttons.roll.label).toBe("Invoke as a 10+");
		dialog.press("roll");
		await expect(posting).resolves.toBeTruthy();

		expect(calls.filter(c => c.roll)).toHaveLength(0);
		expect(calls[0].card.title).toBe("Warmth of the Sun");
		expect(actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
		expect(posted).toHaveLength(1);
		expect(posted[0].content).toMatch(/Invoke the Sun God \(as a 10\+\)/);
		expect(posted[0].content).toMatch(/<ul class="stonetop-picklist" data-pick-max-success="1">/);
		expect(posted[0].content).toMatch(/The effort taxes you; mark a debility/);
		// Stamped like a rolled card, so the consequence wiring acts on its ticks, and as the 10+ it
		// stands for, so the holy relics and an Invocation's own button are offered on it (R7).
		expect(posted[0].flags["stonetop-pwd"]).toEqual({ move: "Invoke the Sun God", invokeTenPlus: true, invocations: ["warmth-of-the-sun"] });
	});

	it("gives an Empowered Invocation its extra consequence on the list", async () => {
		const dialog = installDialogStub();
		const { sheet } = makeSheet({ moves: [...WIELDER, move("Empowered Invocations")] });
		const posting = tap(sheet, "blinding-flash", { asTenPlus: true });
		dialog.press("roll", { empowerChecked: true });
		await posting;
		expect(posted[0].content).toMatch(/data-pick-max-success="2"/);
		expect(posted[0].flags["stonetop-pwd"].invokeEmpowered).toBe(true);
	});

	it("answers null for Just show it, so the Wielder card's button is given back", async () => {
		const dialog = installDialogStub();
		const { sheet } = makeSheet({ moves: WIELDER });
		const posting = tap(sheet, "warmth-of-the-sun", { asTenPlus: true });
		dialog.press("no");
		await expect(posting).resolves.toBeNull();
		expect(posted).toHaveLength(0);
	});

	it("goes straight to the one Invocation known, and asks which of several", async () => {
		const dialog = installDialogStub();
		const one = makeSheet({ moves: WIELDER, known: ["blinding-flash"] });
		const a = one.sheet._invokeAsTenPlus();
		await vi.waitFor(() => expect(opened?.title).toBe("Blinding Flash: Invoke the Sun God as a 10+?"));
		expect(askWithButtons).not.toHaveBeenCalled();
		dialog.press("roll");
		await a;

		askWithButtons.mockResolvedValueOnce("warmth-of-the-sun");
		const several = makeSheet({ moves: WIELDER, known: ["blinding-flash", "warmth-of-the-sun"] });
		const b = several.sheet._invokeAsTenPlus();
		await vi.waitFor(() => expect(opened?.title).toBe("Warmth of the Sun: Invoke the Sun God as a 10+?"));
		expect(askWithButtons.mock.calls[0][0].buttons.map(x => x.value)).toEqual(["warmth-of-the-sun", "blinding-flash"]);
		dialog.press("roll");
		await b;
	});

	it("does nothing when no Invocation is known, or the picker is closed", async () => {
		installDialogStub();
		const none = makeSheet({ moves: WIELDER });
		await expect(none.sheet._invokeAsTenPlus()).resolves.toBeNull();
		const closed = makeSheet({ moves: WIELDER, known: ["blinding-flash", "warmth-of-the-sun"] });
		await expect(closed.sheet._invokeAsTenPlus()).resolves.toBeNull();
		expect(opened).toBeNull();
	});
});

// GAP 1: an Invoke the Sun God roll from anywhere but an Invocation's title (the Moves tab, the
// hotbar, the fight ring) named no Invocation, so its card's snuffing and sun had nothing to act on.
// Every such roll now asks "Which Invocation?" first, at the one ladder all of them walk
// (_resolveMoveRollPrompts), and goes the way the tap does.
describe("rolling Invoke the Sun God from anywhere else", () => {
	const INVOKE = { id: "invoke", type: "move", name: "Invoke the Sun God", system: { rollType: "wis" } };
	afterEach(() => { askWithButtons.mockReset(); askWithButtons.mockResolvedValue(null); });

	/** A sheet whose roll path is the real one down to the model's onRoll. */
	function rollingSheet(opts = {}) {
		const made = makeSheet({ moves: [INVOKE], ...opts });
		const { sheet, actor } = made;
		actor.items.get = id => actor.items.find(i => i.id === id);
		// The real door the invoke window rolls through, so a second redirect would show.
		sheet.rollMoveByName = Object.getPrototypeOf(sheet).rollMoveByName;
		// The hotbar's detached stand-in row, without a DOM.
		sheet._makeSyntheticRollable = item => ({
			dataset: { roll: "wis" },
			closest: sel => (sel === ".item" ? { dataset: { itemId: item.id } } : null),
			classList: { contains: c => c === "move-rollable" },
		});
		sheet._guidedMoveForRollable = () => null;
		sheet._altStatChoiceForRollable = async () => null;
		sheet._promptRollOptions = async () => ({});
		sheet._onMoveRolled = vi.fn();
		sheet._stonetopCharacter = actor.typedActor;
		const contexts = [];
		actor.typedActor.onRoll = vi.fn(async () => true);
		actor.typedActor.withPickContext = vi.fn(async (_name, ctx, run) => { contexts.push(ctx); return run(); });
		vi.spyOn(sheet, "_invokeWhichInvocation");
		return { ...made, contexts };
	}

	it("goes straight to the one Invocation known, through its window, and rolls once naming it", async () => {
		const dialog = installDialogStub();
		const { sheet, actor, calls, contexts } = rollingSheet({ known: ["warmth-of-the-sun"] });
		const rolling = sheet.rollMoveById("invoke");
		await vi.waitFor(() => expect(opened?.title).toBe("Warmth of the Sun: Invoke the Sun God?"));
		expect(askWithButtons, "one known, nothing to ask").not.toHaveBeenCalled();
		dialog.press("roll");
		await rolling;

		expect(calls.filter(c => c.card)).toHaveLength(1);
		expect(actor.typedActor.onRoll).toHaveBeenCalledTimes(1);
		expect(contexts).toEqual([{ empowered: false, burnTwice: false, invocations: ["warmth-of-the-sun"] }]);
		// Redirected once: the window's own roll carries a pick context and is not asked again.
		expect(sheet._invokeWhichInvocation).toHaveBeenCalledTimes(1);
		expect(actor.typedActor.ongoingInvocation).toBe("warmth-of-the-sun");
	});

	it("asks which of several, and uses the one picked", async () => {
		const dialog = installDialogStub();
		askWithButtons.mockResolvedValueOnce("blinding-flash");
		const { sheet, actor, calls } = rollingSheet({ known: ["warmth-of-the-sun", "blinding-flash"], needsSun: ["warmth-of-the-sun"] });
		const rolling = sheet.rollMoveById("invoke");
		await vi.waitFor(() => expect(opened?.title).toBe("Blinding Flash: Invoke the Sun God?"));
		const asked = askWithButtons.mock.calls[0][0];
		expect(asked.title).toBe("Invoke the Sun God: which Invocation?");
		expect(asked.buttons.map(b => b.value)).toEqual(["warmth-of-the-sun", "blinding-flash"]);
		expect(asked.buttons[0].label).toBe("Warmth of the Sun (needs sun)");
		dialog.press("roll");
		await rolling;
		expect(calls[0].card.title).toBe("Blinding Flash");
		expect(actor.typedActor.onRoll).toHaveBeenCalledTimes(1);
	});

	it("rolls nothing when the picker is closed, or the invoke window is dismissed", async () => {
		const dialog = installDialogStub();
		const closed = rollingSheet({ known: ["warmth-of-the-sun", "blinding-flash"] });
		await closed.sheet.rollMoveById("invoke");
		expect(opened).toBeNull();
		expect(closed.calls).toHaveLength(0);
		expect(closed.actor.typedActor.onRoll).not.toHaveBeenCalled();

		const dismissed = rollingSheet({ known: ["warmth-of-the-sun"] });
		const rolling = dismissed.sheet.rollMoveById("invoke");
		await vi.waitFor(() => expect(opened).not.toBeNull());
		dialog.dismiss();
		await rolling;
		expect(dismissed.calls).toHaveLength(0);
		expect(dismissed.actor.typedActor.onRoll).not.toHaveBeenCalled();
	});

	it("rolls as before for a character who knows no Invocations", async () => {
		installDialogStub();
		const { sheet, actor, contexts } = rollingSheet();
		await sheet.rollMoveById("invoke");
		expect(opened, "nothing to pick, no window").toBeNull();
		expect(askWithButtons).not.toHaveBeenCalled();
		expect(actor.typedActor.onRoll).toHaveBeenCalledTimes(1);
		expect(contexts, "a plain roll, whose card says to settle it at the table").toEqual([]);
	});

	it("asks on the ladder the Moves tab walks, and not of a roll that already names its Invocation", async () => {
		installDialogStub();
		const { sheet } = rollingSheet({ known: ["warmth-of-the-sun"] });
		const rollable = sheet._makeSyntheticRollable(INVOKE);
		// The Moves tab's click hands the ladder no pick context.
		const tab = sheet._resolveMoveRollPrompts(rollable, { shiftKey: false });
		await vi.waitFor(() => expect(opened?.title).toBe("Warmth of the Sun: Invoke the Sun God?"));
		opened.close();
		await expect(tab).resolves.toBe("handled");

		opened = null;
		await expect(sheet._resolveMoveRollPrompts(rollable, { pickContext: { empowered: false, burnTwice: false } }))
			.resolves.toEqual({});
		expect(opened).toBeNull();
	});

	it("asks from the fight ring too", async () => {
		const dialog = installDialogStub();
		const { runRingButton } = await import("../../../module/fight/fight-ring.js");
		const { sheet, actor } = rollingSheet({ known: ["warmth-of-the-sun"] });
		actor.sheet = sheet;
		const pressing = runRingButton({ run: "move", itemId: "invoke" }, actor);
		await vi.waitFor(() => expect(opened?.title).toBe("Warmth of the Sun: Invoke the Sun God?"));
		dialog.press("roll");
		await pressing;
		expect(actor.typedActor.onRoll).toHaveBeenCalledTimes(1);
		expect(sheet._invokeWhichInvocation).toHaveBeenCalledTimes(1);
	});
});

// GAP 2: the window's notice follows what is ticked in it, not just the Invocation tapped.
describe("the invoke window's notice is live", () => {
	/** A window's html whose fields the test sets, with the change handlers the render hook wired. */
	function liveHtml(fields = {}) {
		const holder = { innerHTML: "" };
		const handlers = [];
		const html = {
			find: selector => {
				if (selector === ".stonetop-invoke-notice") return [holder];
				if (selector.includes(",")) return { on: (_type, fn) => handlers.push(fn) };
				const name = /name="([^"]+)"/.exec(selector)?.[1];
				const v = fields[name];
				return [{ checked: v === true, value: typeof v === "string" ? v : "" }];
			},
		};
		return { html, holder, fields, change: () => handlers.forEach(fn => fn()) };
	}

	it("says an empowered Cleansing Light will be concentrated on once Empower is ticked", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: BOTH_MOVES });
		const posting = tap(sheet, "cleansing-light");
		expect(opened.content, "instant as printed: nothing to say").not.toMatch(/concentrating/);
		const live = liveHtml();
		opened.render(live.html);
		live.fields.empower = true;
		live.change();
		expect(live.holder.innerHTML).toMatch(/you'll be concentrating on it/);
		live.fields.empower = false;
		live.change();
		expect(live.holder.innerHTML).toBe("");
		opened.close();
		await posting;
	});

	it("names what a Burn Twice partner ends, and takes it back when unticked", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God"), move("Burn Twice as Bright")],
			known: ["warmth-of-the-sun", "blinding-flash", "cleansing-light"], ongoing: { primary: "dancing-light", empowered: true } });
		const posting = tap(sheet, "blinding-flash");
		expect(opened.content).toMatch(/keeps burning: this one goes through it/);
		const live = liveHtml({ burnTwicePartner: "warmth-of-the-sun", burnTwicePrice: "dazed" });
		opened.render(live.html);
		live.fields.burnTwice = true;
		live.change();
		// Two at once fill both slots, so the Dancing Light that was carrying things goes.
		expect(live.holder.innerHTML).toMatch(/concentrating on <strong>Dancing Light<\/strong>/);
		expect(live.holder.innerHTML).toMatch(/is-ending/);
		live.fields.burnTwice = false;
		live.change();
		expect(live.holder.innerHTML).toMatch(/keeps burning: this one goes through it/);
		opened.close();
		await posting;
	});

	it("names both of a Burn Twice pair that takes hold, or the one of it that is ongoing, never 'this one'", async () => {
		installDialogStub();
		const { sheet } = makeSheet({ moves: [move("Invoke the Sun God"), move("Burn Twice as Bright")],
			known: ["warmth-of-the-sun", "blinding-flash", "cleansing-light"] });
		const posting = tap(sheet, "blinding-flash");
		expect(opened.content).toMatch(/This one is <strong>ongoing<\/strong>/);
		const live = liveHtml({ burnTwicePartner: "warmth-of-the-sun", burnTwicePrice: "dazed" });
		opened.render(live.html);
		live.fields.burnTwice = true;
		live.change();
		expect(live.holder.innerHTML).toMatch(/Both are <strong>ongoing<\/strong>: <strong>Blinding Flash and Warmth of the Sun<\/strong>/);
		expect(live.holder.innerHTML).not.toMatch(/This one|is-ending/);
		live.fields.burnTwicePartner = "cleansing-light";
		live.change();
		expect(live.holder.innerHTML).toMatch(/<strong>Blinding Flash<\/strong> is <strong>ongoing<\/strong>/);
		expect(live.holder.innerHTML).not.toMatch(/This one|Both are/);
		opened.close();
		await posting;
	});
});

describe("invokeWindowNotice", () => {
	const OPTS = INVOCATIONS;
	it("is invokeNotice for the tapped one alone, with Empower read in", () => {
		const cleansing = { slug: "cleansing-light", ongoing: false };
		expect(invokeWindowNotice({ current: {}, used: cleansing, options: OPTS })).toBeNull();
		expect(invokeWindowNotice({ current: {}, used: cleansing, empower: true, options: OPTS })).toEqual({ kind: "start", ending: "" });
		expect(invokeWindowNotice({ current: "warmth-of-the-sun", used: cleansing, options: OPTS }))
			.toEqual({ kind: "interrupt", ending: "Warmth of the Sun" });
		expect(invokeWindowNotice({ current: "warmth-of-the-sun", used: cleansing, empower: true, options: OPTS }))
			.toEqual({ kind: "replace", ending: "Warmth of the Sun" });
	});

	it("works a Burn Twice pair out from what the pair keeps", () => {
		const flash = { slug: "blinding-flash", ongoing: true };
		const warmth = { slug: "warmth-of-the-sun", ongoing: true };
		const cleansing = { slug: "cleansing-light", ongoing: false };
		// Nothing held: the pair takes hold, and the notice names both ("this one" would read wrong for two).
		expect(invokeWindowNotice({ current: {}, used: flash, partner: warmth, options: OPTS }))
			.toEqual({ kind: "startPair", ending: "Blinding Flash and Warmth of the Sun" });
		// Two instants: nothing to say.
		expect(invokeWindowNotice({ current: {}, used: cleansing, partner: { slug: "other" }, options: OPTS })).toBeNull();
		// Holding one of the pair already: nothing ends, and the other is new.
		expect(invokeWindowNotice({ current: "warmth-of-the-sun", used: flash, partner: warmth, options: OPTS }))
			.toEqual({ kind: "startPair", ending: expect.stringMatching(/^(Blinding Flash and Warmth of the Sun|Warmth of the Sun and Blinding Flash)$/) });
		// Holding both already: renewed.
		expect(invokeWindowNotice({ current: { primary: "blinding-flash", second: "warmth-of-the-sun" }, used: flash, partner: warmth, options: OPTS }))
			.toEqual({ kind: "renew", ending: "Blinding Flash and Warmth of the Sun" });
		// Holding something outside the pair: it ends.
		expect(invokeWindowNotice({ current: "dancing-light", used: flash, partner: cleansing, options: OPTS }))
			.toEqual({ kind: "replace", ending: "Dancing Light" });
		expect(invokeWindowNotice({ current: "dancing-light", used: cleansing, partner: { slug: "other" }, options: OPTS }))
			.toEqual({ kind: "interrupt", ending: "Dancing Light" });
		// An empowered Cleansing Light in the pair is ongoing too, and the only one of the pair that is: named.
		expect(invokeWindowNotice({ current: {}, used: cleansing, partner: { slug: "other" }, empower: true, options: OPTS }))
			.toEqual({ kind: "startOne", ending: "Cleansing Light" });
		expect(invokeWindowNotice({ current: {}, used: cleansing, partner: flash, options: OPTS }))
			.toEqual({ kind: "startOne", ending: "Blinding Flash" });
	});
});
