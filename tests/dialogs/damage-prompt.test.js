import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { promptDamage } from "../../module/dialogs/RollDialog.js";

// The pre-roll DAMAGE window (module/dialogs/RollDialog.js#promptDamage).
//
// It exists because Stonetop has damage bonuses the sheet cannot know about: the ones the
// FICTION switches on. "When you roil with anger, you do +1 damage until you calm down" (the
// Storm Markings major arcanum), "+1d6 damage, forceful, loud" for a spent point of Fury,
// "+1d4 when you fight to kill without mercy" (a Heavy's Blood-Soaked Past). Without a seam
// like this the only way to bank one is to edit the target's HP by hand afterwards, which
// leaves no record on any card of what actually happened.
//
// Two things this file is guarding in particular:
//
//  · The ANSWER'S SHAPE. Unlike promptRoll — whose answer omits `rollMode` so the sticky
//    selector on the sheet can still decide — a damage roll has no second home for advantage,
//    so the mode its caller handed in must come back out even when no window opened. A monster
//    stat block's "icy touch d6 w/disadvantage" is carried in that field.
//  · What the free-typed dice field ACCEPTS. It reaches an evaluated Roll, so a term that does
//    not parse has to be dropped visibly rather than thrown on. (The grammar itself is
//    covered in tests/utils/damage.test.js; here it is the window's handling of it.)
//
// Layout is verified in a browser, not here. The DOM below carries only what the dialog's own
// render hook and callbacks actually touch — the suite runs in Node with no jsdom.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../..", rel), "utf8");

const ROLL_DIALOG_JS = read("module/dialogs/RollDialog.js");
const SETTINGS_JS = read("module/settings.js");
const ATTACK_FLOW_JS = read("module/combat/attack-flow.js");
const CSS = read("styles/stonetop.css");

function fakeButton(mode, active) {
	const classes = new Set(active ? ["is-active"] : []);
	return {
		dataset: { rollMode: mode },
		classList: {
			toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
			contains: name => classes.has(name),
		},
		attrs: {},
		setAttribute(name, value) { this.attrs[name] = value; },
		listeners: [],
		addEventListener(_type, fn) { this.listeners.push(fn); },
		click() { this.listeners.forEach(fn => fn()); },
		_has: name => classes.has(name),
	};
}

function fakeInput(value = "") {
	const classes = new Set();
	return {
		value: String(value),
		classList: {
			toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
			contains: name => classes.has(name),
		},
		listeners: [],
		addEventListener(_type, fn) { this.listeners.push(fn); },
		input() { this.listeners.forEach(fn => fn()); },
		focus() {}, select() {},
		_has: name => classes.has(name),
	};
}

function fakeRoot({ modifier = "0", extraDice = "", mode = "normal" } = {}) {
	const buttons = ["dis", "normal", "adv"].map(m => fakeButton(m, m === mode));
	const input = fakeInput(modifier);
	const extra = fakeInput(extraDice);
	const preview = { textContent: "" };
	const steps = [];
	return {
		buttons, input, extra, preview, steps,
		querySelector(sel) {
			if (sel === ".stonetop-roll-mode-btn.is-active") return buttons.find(b => b._has("is-active")) ?? null;
			if (sel === '[name="modifier"]')  return input;
			if (sel === '[name="extraDice"]') return extra;
			if (sel === ".stonetop-damage-preview strong") return preview;
			return null;
		},
		querySelectorAll(sel) {
			if (sel === ".stonetop-roll-mode-btn") return buttons;
			if (sel === ".stonetop-roll-modifier-step") return steps;
			return [];
		},
	};
}

/** Open the window, run its render hook against a fake root, and hand back both. */
function open({ ask = true, root: rootOpts, ...opts } = {}) {
	let data, options;
	global.Dialog = vi.fn(function (d, o) { data = d; options = o; this.render = vi.fn(); });
	const pending = promptDamage({ ask, ...opts });
	const root = fakeRoot({ mode: opts.rollMode ?? "normal", ...rootOpts });
	data.render([root]);
	return { pending, data, options, root };
}

afterEach(() => { delete global.game.settings; });

describe("the pre-roll damage window", () => {
	it("hands back a mode, a flat bonus and extra dice, ready to spread into rollDamage", async () => {
		const { pending, data, root } = open();
		root.input.value = "1";
		root.extra.value = "1d6";
		await data.buttons.roll.callback([root]);
		expect(await pending).toEqual({ rollMode: "normal", bonus: 1, extraDice: "1d6" });
	});

	it("offers the same three modes the roll engine knows, in the same order", () => {
		const { data } = open();
		expect([...data.content.matchAll(/data-roll-mode="(\w+)"/g)].map(m => m[1])).toEqual(["dis", "normal", "adv"]);
	});

	// The window is a chance to adjust the mode, not to erase one the caller already knows —
	// a monster's stat block says "d6 w/disadvantage" and the window must open on it.
	it("opens on the mode it was handed and hands it back untouched", async () => {
		const { pending, data, root } = open({ rollMode: "dis" });
		expect(data.content).toMatch(/data-roll-mode="dis" aria-pressed="true"/);
		await data.buttons.roll.callback([root]);
		expect((await pending).rollMode).toBe("dis");
	});

	it("moves the pill's fill itself on click, one segment at a time", async () => {
		const { pending, data, root } = open();
		const [dis, normal, adv] = root.buttons;
		adv.click();
		expect([dis._has("is-active"), normal._has("is-active"), adv._has("is-active")]).toEqual([false, false, true]);
		expect(adv.attrs["aria-pressed"]).toBe("true");
		await data.buttons.roll.callback([root]);
		expect((await pending).rollMode).toBe("adv");
	});

	// The preview replaces the mode tooltips the move prompt shows. "Roll 3d6 and keep the
	// highest two" is a 2d6 move roll's answer and would be a lie here: advantage on damage
	// doubles the DAMAGE die.
	it("previews the formula it is about to roll, and repaints as the answer changes", () => {
		const { root } = open({ formula: "d10+2" });
		expect(root.preview.textContent).toBe("d10+2");

		root.input.value = "1";
		root.input.input();
		expect(root.preview.textContent).toBe("d10+2+1");

		root.extra.value = "1d6";
		root.extra.input();
		expect(root.preview.textContent).toBe("d10+2+1d6+1");

		root.buttons.find(b => b.dataset.rollMode === "adv").click();
		expect(root.preview.textContent).toBe("2d10kh1+2+1d6+1");
	});

	// Dropped, and SEEN to be dropped: the preview would otherwise look identical to a field
	// that worked, and the player finds out when the damage comes up short.
	it("drops a dice term that does not parse, and marks the field", () => {
		const { root } = open({ formula: "d10" });
		root.extra.value = "1d";
		root.extra.input();
		expect(root.preview.textContent).toBe("d10");
		expect(root.extra._has("is-invalid")).toBe(true);

		root.extra.value = "1d6";
		root.extra.input();
		expect(root.preview.textContent).toBe("d10+1d6");
		expect(root.extra._has("is-invalid")).toBe(false);
	});

	it("never returns a dice term the roll cannot evaluate", async () => {
		const { pending, data, root } = open();
		root.extra.value = "d6; drop table";
		await data.buttons.roll.callback([root]);
		expect((await pending).extraDice).toBe("");
	});

	it("reads a blank or fractional modifier as an integer rather than NaN", async () => {
		const { pending, data } = open();
		await data.buttons.roll.callback([fakeRoot({ modifier: "2.7" })]);
		expect((await pending).bonus).toBe(2);

		const blank = open();
		await blank.data.buttons.roll.callback([fakeRoot({ modifier: "" })]);
		expect((await blank.pending).bonus).toBe(0);
	});

	// Every caller aborts on a null: nothing rolled, nothing posted, and — in the attack flow —
	// no card locked and no ammo spent.
	it("resolves null on cancel and on a dismissed window", async () => {
		const cancelled = open();
		cancelled.data.buttons.cancel.callback();
		expect(await cancelled.pending).toBeNull();

		const closed = open();
		closed.data.close();
		expect(await closed.pending).toBeNull();
	});

	// `close` fires after a button callback too, so without the latch the answer would be
	// overwritten by the dismissal that follows it.
	it("keeps the answer the button gave when the window then closes", async () => {
		const { pending, data, root } = open();
		root.input.value = "2";
		await data.buttons.roll.callback([root]);
		data.close();
		expect((await pending).bonus).toBe(2);
	});

	it("is a Stonetop-skinned window whose default button rolls", () => {
		const { data, options } = open({ title: "Clash: hafted spear" });
		expect(data.title).toBe("Clash: hafted spear");
		expect(data.default).toBe("roll");
		expect(Object.keys(data.buttons)).toEqual(["roll", "cancel"]);
		expect(options.classes).toContain("stonetop");
	});
});

describe("when the damage window does not open", () => {
	// Shift skips the WINDOW, not the mode. A stat block's noted disadvantage still applies.
	it("answers as if it had opened and been left alone, keeping the caller's mode", async () => {
		expect(await promptDamage({ shiftKey: true, rollMode: "dis" }))
			.toEqual({ rollMode: "dis", bonus: 0, extraDice: "" });
		expect(await promptDamage({ ask: false, rollMode: "adv" }))
			.toEqual({ rollMode: "adv", bonus: 0, extraDice: "" });
	});

	it("constructs no Dialog at all, rather than opening and closing one", async () => {
		global.Dialog = vi.fn();
		await promptDamage({ shiftKey: true });
		await promptDamage({ ask: false });
		expect(global.Dialog).not.toHaveBeenCalled();
	});

	it("normalizes a mode it does not recognize instead of passing it through to a Roll", async () => {
		expect((await promptDamage({ ask: false, rollMode: "def" })).rollMode).toBe("normal");
		expect((await promptDamage({ ask: false, rollMode: undefined })).rollMode).toBe("normal");
	});

	it("follows the client setting when the caller does not override it", async () => {
		global.game.settings = { get: vi.fn(() => false) };
		global.Dialog = vi.fn();
		await promptDamage({});
		expect(global.Dialog).not.toHaveBeenCalled();
	});
});

// The window is only worth having if every surface that rolls damage goes through it. These
// read the source because the alternative is standing up four sheets and a chat card.
describe("the damage window's reach", () => {
	const SURFACES = {
		"the attack flow (Clash / Let Fly)": "module/combat/attack-flow.js",
		"the character sheet's damage die":  "module/actors/character/StonetopCharacterSheet.js",
		"the monster stat block":            "module/actors/monster/StonetopMonsterSheet.js",
		"the NPC stat block":                "module/actors/npc/StonetopNpcSheet.js",
	};

	for (const [what, file] of Object.entries(SURFACES)) {
		it(`asks before rolling damage on ${what}`, () => {
			const src = read(file);
			// Either the surface pairs the window with its own cancel guard, or it goes through
			// `rollDamagePrompted`, which IS that pair — asking and aborting are only correct
			// together, so the helper bundles them and the surface cannot get one without the
			// other. What must never appear is a bare `rollDamage` with no window in sight.
			const viaHelper = src.includes("rollDamagePrompted");
			const viaPair = src.includes("promptDamage") && /if \(!adjust\)|if \(!damage\)/.test(src);
			expect(viaHelper || viaPair, `${what} rolls damage without offering the window`).toBe(true);
		});
	}

	// The helper three of those four surfaces lean on has to carry the guard itself, or it
	// hands each of them a cancelled roll instead of no roll.
	it("aborts the roll when the shared helper's window is dismissed", () => {
		const src = read("module/dialogs/RollDialog.js");
		const at = src.indexOf("export async function rollDamagePrompted");
		expect(at, "rollDamagePrompted is gone").toBeGreaterThan(-1);
		const body = src.slice(at, at + 500);
		expect(body).toContain("await promptDamage(");
		expect(body).toContain("if (!adjust) return false;");
	});

	// The attack flow is the one path with irreversible work around the roll: it latches the
	// card resolved and can spend the weapon's ammo. Both must happen AFTER the window has an
	// answer, or a cancel leaves a dead card, a depleted quiver and no damage.
	it("asks before it locks the attack card or spends ammo", () => {
		const body = ATTACK_FLOW_JS.slice(ATTACK_FLOW_JS.indexOf("async function resolveAttackTier"));
		const asked = body.indexOf("askDamageAdjustment");
		const locked = body.indexOf("lockAttackCard(message, root, { pick:");
		const spent = body.indexOf("depleteAmmoAndPost");
		expect(asked).toBeGreaterThan(-1);
		expect(asked).toBeLessThan(locked);
		expect(asked).toBeLessThan(spent);
	});
});

describe("the setting behind the damage window", () => {
	it("ships on, and reads on when it is asked before registration", () => {
		const block = /register\(SYSTEM_ID, "promptDamageModifier", \{([\s\S]*?)\n\t\}\);/.exec(SETTINGS_JS);
		expect(block, "promptDamageModifier is not registered").not.toBeNull();
		expect(block[1]).toMatch(/default:\s*true/);
		expect(block[1]).toMatch(/scope:\s*"client"/);
		expect(SETTINGS_JS).toMatch(/getPromptDamageModifierSetting[\s\S]*?"promptDamageModifier"\) \?\? true/);
	});

	it("is what the window consults, and Shift is what skips one roll", () => {
		expect(ROLL_DIALOG_JS).toContain("getPromptDamageModifierSetting()");
		expect(ROLL_DIALOG_JS).toContain("if (shiftKey || !ask)");
	});
});

describe("the damage window's own chrome", () => {
	// The stepper and the pill are the move prompt's controls, reused; only what damage adds
	// needs rules of its own, and a class with no rule behind it is an unstyled window.
	it("styles every class the window introduces", () => {
		const classes = [...ROLL_DIALOG_JS.matchAll(/class="(stonetop-damage-[a-z-]+)"/g)].map(m => m[1]);
		expect(classes.length).toBeGreaterThan(2);
		for (const cls of new Set(classes)) expect(CSS, cls).toContain(`.${cls}`);
		expect(CSS).toContain(".stonetop-damage-extra-dice.is-invalid");
	});

	// The stepper's buttons take their font size from core in PIXELS while everything around
	// them scales with the sheet font, so any em-matched height lines up at one UI size and
	// drifts at every other (verified offline at 16/20/24px root: 0px / 4px / 7px). The grid
	// row takes the taller of the two and centres both, at every size.
	it("lays the two controls out on grid rows rather than matching their heights", () => {
		const block = /\.stonetop-damage-adjust \{([\s\S]*?)\}/.exec(CSS);
		expect(block, ".stonetop-damage-adjust has no rule").not.toBeNull();
		expect(block[1]).toMatch(/display:\s*grid/);
		expect(block[1]).toMatch(/grid-template-columns:\s*auto auto/);
		// Labels first, then controls: row-major placement is what puts each pair on one line.
		// The stepper is emitted by the shared `stepperHtml` both windows are built from, so it
		// appears here as that call rather than as its own markup.
		const row = ROLL_DIALOG_JS.slice(ROLL_DIALOG_JS.indexOf('class="stonetop-damage-adjust"'));
		const order = [...row.slice(0, row.indexOf("stonetop-damage-preview")).matchAll(/stonetop-damage-field-label|stepperHtml\(|name="extraDice"/g)].map(m => m[0]);
		expect(order).toEqual([
			"stonetop-damage-field-label", "stonetop-damage-field-label",
			"stepperHtml(", 'name="extraDice"',
		]);
		// …and that helper still renders the stepper the CSS rule above is written against.
		expect(ROLL_DIALOG_JS).toMatch(/function stepperHtml[\s\S]*?stonetop-roll-modifier-stepper/);
	});
});
