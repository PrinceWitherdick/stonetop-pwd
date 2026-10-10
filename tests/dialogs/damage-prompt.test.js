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

/** A ticked line's checkbox, which the window reads by name and listens to for changes. */
function fakeBox() {
	const listeners = [];
	return {
		checked: true, disabled: false,
		addEventListener: (_type, fn) => listeners.push(fn),
		change() { listeners.forEach(fn => fn()); },
	};
}

function fakeRoot({ modifier = "0", extraDice = "", mode = "normal", offers = [] } = {}) {
	const buttons = ["dis", "normal", "adv"].map(m => fakeButton(m, m === mode));
	const input = fakeInput(modifier);
	const extra = fakeInput(extraDice);
	const preview = { textContent: "" };
	const steps = [];
	const boxes = new Map(offers.map(key => [key, fakeBox()]));
	return {
		buttons, input, extra, preview, steps,
		box: key => boxes.get(key),
		querySelector(sel) {
			if (sel === ".stonetop-roll-mode-btn.is-active") return buttons.find(b => b._has("is-active")) ?? null;
			if (sel === '[name="modifier"]')  return input;
			if (sel === '[name="extraDice"]') return extra;
			if (sel === ".stonetop-damage-preview strong") return preview;
			const offer = /^\[name="offer-(.+)"\]$/.exec(sel);
			if (offer) return boxes.get(offer[1]) ?? null;
			return null;
		},
		querySelectorAll(sel) {
			if (sel === ".stonetop-roll-mode-btn") return buttons;
			if (sel === ".stonetop-roll-modifier-step") return steps;
			if (sel === '[name^="offer-"]') return [...boxes.values()];
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

	// A line that carries a mode moves the picker with it (Uncanny Reflexes), so nobody is left looking
	// at Disadvantage beside an unticked box. What it must NOT do is overrule the player: the derivation
	// starts from the mode the window opened on, so a hand-picked one has to stop it.
	describe("a line that carries a mode", () => {
		const uncanny = [{ key: "uncanny", mode: "dis", applied: true, label: "Wren's Uncanny Reflexes", pill: "Uncanny Reflexes" }];

		it("moves the picker as it is ticked and unticked", async () => {
			// The window opens on the disadvantage the ticked line brings, which is what the picker is
			// baked with (`untouched`), and unticking the only reason for it takes it away again.
			const { pending, data, root } = open({ offers: uncanny, root: { offers: ["uncanny"], mode: "dis" } });
			root.box("uncanny").checked = false;
			root.box("uncanny").change();
			expect(root.buttons[1]._has("is-active")).toBe(true);
			await data.buttons.roll.callback([root]);
			expect((await pending).rollMode).toBe("normal");
		});

		it("leaves a mode the player picked by hand where they put it", async () => {
			const { pending, data, root } = open({ offers: uncanny, root: { offers: ["uncanny"], mode: "dis" } });
			const [, , adv] = root.buttons;
			adv.click();
			root.box("uncanny").checked = false;
			root.box("uncanny").change();
			expect(adv._has("is-active")).toBe(true);
			await data.buttons.roll.callback([root]);
			expect((await pending).rollMode).toBe("adv");
		});
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
		const { data, options } = open({ attacker: "Kiran" });
		expect(data.default).toBe("roll");
		expect(Object.keys(data.buttons)).toEqual(["roll", "cancel"]);
		expect(options.classes).toContain("stonetop");
	});

	// The header says WHOSE roll this is. Every surface has a label for the CARD, and those
	// labels are the source's own damage line — "d8+2 (close, forceful)" off a stat block —
	// which as a title names nobody and restates the formula the preview already shows.
	it("names the attacker in the header rather than restating the formula", () => {
		expect(open({ attacker: "Ancient Ash-Wolf", formula: "d8+2" }).data.title)
			.toBe("Rolling damage for Ancient Ash-Wolf");
		// A nameless source still gets a header that reads as one, not "undefined".
		expect(open({ formula: "d8+2" }).data.title).toBe("Rolling damage");
	});

	// Composed in the window, not by its callers: the two that ask both have the actor in hand
	// and both used to hand over the card's label, which is how the formula reached the header.
	it("is handed a name by every surface that asks, never a card label", () => {
		for (const [file, src] of [["RollDialog.js", ROLL_DIALOG_JS], ["attack-flow.js", ATTACK_FLOW_JS]]) {
			const calls = src.match(/await promptDamage\(\{[^}]*\}/g) ?? [];
			expect(calls, `${file} asks the window nowhere`).toHaveLength(1);
			expect(calls[0], file).toMatch(/attacker: (attacker \|\| )?actor\?\.name/);
			expect(calls[0], file).not.toContain("title:");
		}
	});

	// A follower rolls off its PC's sheet, so the actor in hand is the PC. The window names the
	// follower who is swinging: "Rolling damage for Rhianna's crew", not "for Rhianna".
	it("names a follower rather than the PC whose sheet it rolled from", () => {
		expect(ROLL_DIALOG_JS).toContain("attacker: attacker || actor?.name");
		const sheet = read("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toMatch(/rollFollowerDamageAt\(this\.actor, \{[\s\S]*?formula: roll, label: blowLabel, attacker,/);
		// The crew's weapon only renames the blow; the name of who swings still starts it.
		expect(sheet).toMatch(/let blowLabel = label;/);
		expect(sheet).toMatch(/label\s*=\s*`\$\{attacker\} attacks\$\{formPart\}`/);
		// Whichever window the follower's roll opens, the name goes with it: the plain card's, the aimed
		// card's, and "Who does this hit?".
		const at = ATTACK_FLOW_JS.indexOf("export async function rollFollowerDamageAt");
		expect(at, "rollFollowerDamageAt is gone").toBeGreaterThan(-1);
		const follower = ATTACK_FLOW_JS.slice(at, ATTACK_FLOW_JS.indexOf("\n}\n", at));
		expect(follower).toContain("striker: { name: attacker, group }");
		const from = ATTACK_FLOW_JS.indexOf("export async function rollDamageAt");
		const body = ATTACK_FLOW_JS.slice(from, ATTACK_FLOW_JS.indexOf("\n}\n", from));
		expect(body).toContain("const attacker = striker?.name");
		// BOTH windows, which are now the same window: the no-target branch asks
		// askDamageAdjustment too, so a ticked line is paid for and can tag the blow.
		const windows = body.match(/askDamageAdjustment\(actor, \{[\s\S]*?\n\t*\}\);/g) ?? [];
		expect(windows).toHaveLength(2);
		for (const call of windows) expect(call).toMatch(/\battacker,/);
		expect(body).toContain("roller: attacker");
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
		"a monster's rolling move":          "module/item/StonetopItem.js",
	};

	for (const [what, file] of Object.entries(SURFACES)) {
		it(`asks before rolling damage on ${what}`, () => {
			const src = read(file);
			// Either the surface pairs the window with its own cancel guard, or it goes through
			// `rollDamagePrompted`, which IS that pair — asking and aborting are only correct
			// together, so the helper bundles them and the surface cannot get one without the
			// other. What must never appear is a bare `rollDamage` with no window in sight.
			// `rollDamageAt` is the third way in: the same pair, aimed at whoever the roller is fighting.
			const viaHelper = src.includes("rollDamagePrompted") || src.includes("rollDamageAt(");
			const viaPair = src.includes("promptDamage") && /if \(!adjust\)|if \(!damage\)/.test(src);
			expect(viaHelper || viaPair, `${what} rolls damage without offering the window`).toBe(true);
		});
	}

	// Both of its branches ask, through the SAME window: the plain card and the targeted one alike.
	// The plain card used to go through rollDamagePrompted, which asks and rolls but never pays for
	// what was ticked - so a no-target Anger is a Gift rolled its +1d4 free and lost its forceful.
	// A dismissed window rolls nothing on either branch.
	it("asks on both branches of a damage roll aimed at whoever the roller is fighting", () => {
		const at = ATTACK_FLOW_JS.indexOf("export async function rollDamageAt");
		expect(at, "rollDamageAt is gone").toBeGreaterThan(-1);
		const body = ATTACK_FLOW_JS.slice(at, ATTACK_FLOW_JS.indexOf("\n}\n", at));
		expect(body).not.toContain("rollDamagePrompted(");
		expect(body.match(/await askDamageAdjustment\(/g) ?? []).toHaveLength(2);
		expect(body.match(/if \(!damage\) return false;/g) ?? []).toHaveLength(2);
		expect(body.indexOf("if (!damage) return false;")).toBeLessThan(body.indexOf("rollAndPostDamage("));
	});

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
		// The lock that ENDS A DAMAGE ROLL, named by the record it writes. Call the Shot's "do no
		// harm" locks earlier and returns, which is not this rule breaking but the tier having no
		// roll to ask about: nothing is spent and no window opens on that path.
		const locked = body.search(/lockAttackCard\(message, root, \{\s*yourCall, targets/);
		const spent = body.indexOf("depleteAmmoAndPost");
		expect(asked).toBeGreaterThan(-1);
		expect(locked).toBeGreaterThan(-1);
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

	// The field is bold at --st-fs-lg, so an unstyled placeholder is typeset exactly like a
	// typed value: the window looked like it was adding a die to every damage roll before the
	// player touched it. Ink from the ramp, so "Sheet Contrast: High" lifts it back — and MUTED
	// rather than faint, which on this field's wash over parchment is about 2.4:1.
	it("typesets the extra-dice placeholder as a hint, not as a value", () => {
		const block = /\.stonetop-damage-extra-dice::placeholder \{([\s\S]*?)\}/.exec(CSS);
		expect(block, ".stonetop-damage-extra-dice::placeholder has no rule").not.toBeNull();
		expect(block[1]).toMatch(/color:\s*var\(--st-text-muted/);
		expect(block[1]).toMatch(/font-weight:\s*normal/);
		// Firefox's own 0.54 default would compound with the faint ink.
		expect(block[1]).toMatch(/opacity:\s*1/);
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
