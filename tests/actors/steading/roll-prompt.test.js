import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { promptRoll, DEFAULT_ROLL_MODE } from "../../../module/dialogs/RollDialog.js";

// Advantage and disadvantage used to live on the sheets, and they STAYED where they were put:
// a stacked radio list in the character sheet's Moves sidebar and in the steading's classic
// sidebar, a segmented pill on the modern steading's Homefront Moves heading. All three wrote
// one `rollMode` flag that outlived the roll it was set for, so a player who took Advantage
// once kept it for every roll afterwards and nobody at the table noticed until the dice had
// been going wrong for an hour.
//
// They are gone. How a roll is made is asked when it is made — module/dialogs/RollDialog.js,
// which opens on every 2d6 move/stat roll, always starts at Normal, and takes the one-off
// modifier prompt over with it. Shift-clicking the roll skips the window entirely.
//
// These guard that window and the absence of the controls it replaced. Layout is verified in a
// browser, not here.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");

const CHARACTER_HBS = read("templates/actor/character.hbs");
const SIDEBAR_HBS = read("templates/actor/partials/steading-moves-sidebar.hbs");
const MOVES_HBS = read("templates/actor/partials/steading-tab-moves.hbs");
const STEADING_JS = read("module/actors/steading/StonetopSteadingSheet.js");
const CHARACTER_SHEET_JS = read("module/actors/character/StonetopCharacterSheet.js");
const CHARACTER_JS = read("module/actors/character/StonetopCharacter.js");
const SETTINGS_JS = read("module/settings.js");
const STONETOP_JS = read("stonetop.js");
const CSS = read("styles/stonetop.css");
const EN = JSON.parse(read("languages/en.json"));

/** Markup only — these files' comments still discuss the controls this replaced. */
const stripComments = hbs => hbs.replace(/\{\{!--[\s\S]*?--\}\}/g, "");

// ── A DOM thin enough to run the dialog's own render/callbacks against ───────
// The suite runs in Node with no jsdom, and what is worth testing here is exactly the part
// that touches elements: the pill moves `.is-active` itself, because it has no document write
// to re-render off. So the fakes carry only what the dialog actually calls.

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

function fakeRoot({ modifier = "0" } = {}) {
	const buttons = ["dis", "normal", "adv"].map(m => fakeButton(m, m === DEFAULT_ROLL_MODE));
	const input = { value: String(modifier), focus() {}, select() {} };
	const readout = { textContent: "" };
	const steps = [];
	const root = {
		buttons, input, readout, steps,
		querySelector(sel) {
			if (sel === ".stonetop-roll-mode-btn.is-active") return buttons.find(b => b._has("is-active")) ?? null;
			if (sel === '[name="modifier"]') return input;
			if (sel === ".stonetop-roll-dice") return readout;
			return null;
		},
		querySelectorAll(sel) {
			if (sel === ".stonetop-roll-mode-btn") return buttons;
			if (sel === ".stonetop-roll-modifier-step") return steps;
			return [];
		},
	};
	return root;
}

/** Open the dialog, run its render hook against a fake root, and hand back both. */
function open(opts) {
	let data, options;
	global.Dialog = vi.fn(function (d, o) { data = d; options = o; this.render = vi.fn(); });
	const pending = promptRoll(opts);
	const root = fakeRoot();
	data.render([root]);
	return { pending, data, options, root };
}

// No i18n stubbing here on purpose. The dialog's labels and dice lines are `stonetop.rollMode.*`
// in languages/en.json with no English copies in the code behind them, and tests/setup.js loads
// that table for real — so the assertions below read the strings a player reads.

describe("the pre-roll prompt", () => {
	// Worst to best, left to right, so the strip reads as a scale rather than a menu.
	it("offers exactly the three modes the roll engine knows, in order", () => {
		const { data } = open();
		const modes = [...data.content.matchAll(/data-roll-mode="(\w+)"/g)].map(m => m[1]);
		expect(modes).toEqual(["dis", "normal", "adv"]);
		// Anything else normalizes to "normal" on the way in, so a typo here would be a segment
		// that silently does nothing but deselect the others.
		expect(read("module/utils/roll-engine.js")).toContain('rollMode === "adv" ? "3d6kh2"');
	});

	// The entire point of the window. A sticky control is what it replaced.
	it("starts every roll at Normal, whatever the last one was", async () => {
		const first = open();
		first.root.buttons.find(b => b.dataset.rollMode === "adv").click();
		await first.data.buttons.roll.callback([first.root]);
		expect(await first.pending).toEqual({ rollMode: "adv", situational: 0 });

		const second = open();
		expect(second.root.buttons.find(b => b._has("is-active")).dataset.rollMode).toBe("normal");
		expect(second.data.content).toMatch(/data-roll-mode="normal" aria-pressed="true"/);
		await second.data.buttons.roll.callback([second.root]);
		expect(await second.pending).toEqual({ rollMode: "normal", situational: 0 });
	});

	// Buttons, not the radios `.stonetop-segmented-picker` is built around: there is no
	// document write behind this pill to re-render off, so it moves `.is-active` itself.
	it("moves the fill itself on click, one segment at a time", () => {
		const { root } = open();
		const [dis, normal, adv] = root.buttons;
		adv.click();
		expect([dis._has("is-active"), normal._has("is-active"), adv._has("is-active")]).toEqual([false, false, true]);
		expect(adv.attrs["aria-pressed"]).toBe("true");
		expect(normal.attrs["aria-pressed"]).toBe("false");
		dis.click();
		expect([dis._has("is-active"), adv._has("is-active")]).toEqual([true, false]);
	});

	// A player who has never met this window should not have to know what "Advantage" throws.
	it("says what the chosen mode actually rolls", () => {
		const { root } = open();
		expect(root.readout.textContent).toBe("");   // untouched until a segment is picked
		root.buttons.find(b => b.dataset.rollMode === "adv").click();
		expect(root.readout.textContent).toMatch(/3d6.*highest two/i);
		root.buttons.find(b => b.dataset.rollMode === "dis").click();
		expect(root.readout.textContent).toMatch(/3d6.*lowest two/i);
		root.buttons.find(b => b.dataset.rollMode === "normal").click();
		expect(root.readout.textContent).toMatch(/2d6/);
	});

	it("hands back the modifier beside the mode, truncated to an integer", async () => {
		const { pending, data } = open();
		await data.buttons.roll.callback([fakeRoot({ modifier: "2.7" })]);
		expect(await pending).toEqual({ rollMode: "normal", situational: 2 });
	});

	it("reads a blank or junk modifier as zero rather than NaN", async () => {
		const { pending, data } = open();
		await data.buttons.roll.callback([fakeRoot({ modifier: "" })]);
		expect(await pending).toEqual({ rollMode: "normal", situational: 0 });
	});

	// Every caller aborts its roll on a null, which is what makes cancelling clean — nothing
	// posted, nothing spent.
	it("resolves null on cancel and on a dismissed window", async () => {
		const cancelled = open();
		cancelled.data.buttons.cancel.callback();
		expect(await cancelled.pending).toBeNull();

		const closed = open();
		closed.data.close();
		expect(await closed.pending).toBeNull();
	});

	// `close` fires after a button callback too, so without the latch the Roll answer would be
	// overwritten by the dismissal that follows it.
	it("keeps the answer the button gave when the window then closes", async () => {
		const { pending, data, root } = open();
		root.buttons.find(b => b.dataset.rollMode === "dis").click();
		await data.buttons.roll.callback([root]);
		data.close();
		expect(await pending).toEqual({ rollMode: "dis", situational: 0 });
	});

	// Affirmative on the left, cancel on the right, and Enter rolls.
	it("is a Stonetop-skinned window whose default button rolls", () => {
		const { data, options } = open({ title: "Defy Danger" });
		expect(data.title).toBe("Defy Danger");
		expect(Object.keys(data.buttons)).toEqual(["roll", "cancel"]);
		expect(data.default).toBe("roll");
		// Omitting `stonetop` from the classes is what leaves a dialog with no chrome at all.
		expect(options.classes).toContain("stonetop");
		expect(options.classes).toContain("stonetop-roll-dialog");
	});

	it("reuses the shared segmented picker rather than a look-alike", () => {
		const { data } = open();
		expect(data.content).toContain("stonetop-segmented-picker");
		expect(data.content).toContain("stonetop-segmented-picker-option");
		expect(data.content).toContain("stonetop-roll-mode-picker");
	});

	// The mode names and the dice lines are the strings the retired sheet controls used, so a
	// translated world keeps its translation.
	it("speaks through the existing rollMode strings when there is an i18n to ask", () => {
		for (const key of ["pickerLabel", "modifierLabel", "adv", "normal", "dis",
			"advTooltip", "normalTooltip", "disTooltip"])
			expect(EN.stonetop.rollMode[key], key).toBeTypeOf("string");

		const real = globalThis.game;
		try {
			globalThis.game = { i18n: { localize: key => (key === "stonetop.rollMode.adv" ? "Vorteil" : key) } };
			expect(open().data.content).toContain("Vorteil");
		} finally {
			globalThis.game = real;   // the table is shared with every test after this one
		}
	});

	// Two clusters of buttons around a number, so each needs its OWN name. They shared one for a
	// while — `rollMode.label`, "Roll modifier" — which named the stepper while sitting on the mode
	// picker, so a screen reader heard the two controls transposed and the stepper (whose buttons
	// say only "Decrease" and "Increase") went unnamed.
	it("names the mode picker and the modifier stepper apart", () => {
		const { data } = open();
		const groups = [...data.content.matchAll(/aria-label="([^"]*)"/g)].map(m => m[1]);
		expect(groups).toContain(EN.stonetop.rollMode.pickerLabel);
		expect(groups).toContain(EN.stonetop.rollMode.modifierLabel);
		expect(EN.stonetop.rollMode.pickerLabel).not.toBe(EN.stonetop.rollMode.modifierLabel);
		// Both clusters are groups, not loose buttons: without the role the label has nothing to
		// attach to and is simply dropped.
		expect(data.content).toMatch(/stonetop-roll-mode-picker[^>]*role="group"/);
		expect(data.content).toMatch(/stonetop-roll-modifier-stepper[^>]*role="group"/);
	});

	// The window's English lives in languages/en.json and NOWHERE ELSE. A copy in the module —
	// which is what a hand-written fallback is — outranks a corrected translation on exactly the
	// lookup it was written for, and the two then disagree with nothing to say which is right.
	// See the standing rule in module/utils/i18n.js.
	it("keeps no English copy of its own beside the table", () => {
		// Comments stripped: the prose above `promptRoll` is entitled to say "Advantage" while
		// explaining what the window is for. What must not appear is a string the CODE would
		// print instead of asking — the dice lines, which no comment has a reason to spell out.
		const code = read("module/dialogs/RollDialog.js").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
		for (const key of ["advTooltip", "normalTooltip", "disTooltip"])
			expect(code, key).not.toContain(EN.stonetop.rollMode[key]);
		// The table decides the icon and the order; the words come from en.json.
		const table = code.match(/const ROLL_MODES = \[([\s\S]*?)\];/)?.[1];
		expect(table, "the mode table is gone").toBeTruthy();
		expect(table).not.toMatch(/\b(?:label|dice)\s*:/);

		// And it renders the table's strings, not the keys.
		const { data } = open();
		expect(data.content).toContain(EN.stonetop.rollMode.adv);
		expect(data.content).not.toContain("stonetop.rollMode.adv");
	});
});

describe("the sticky controls are gone", () => {
	it("leaves no roll-mode control in any sheet template", () => {
		for (const [name, hbs] of [["character", CHARACTER_HBS], ["classic sidebar", SIDEBAR_HBS], ["moves tab", MOVES_HBS]]) {
			const markup = stripComments(hbs);
			expect(markup, name).not.toContain("roll-mode-radios");
			expect(markup, name).not.toContain("roll-mode-picker");
			expect(markup, name).not.toContain("stonetop-roll-mode-input");
			expect(markup, name).not.toContain("Roll Modifier");
		}
	});

	it("unregisters the two partials, and the files are gone with them", () => {
		expect(STONETOP_JS).not.toContain("roll-mode-picker");
		expect(STONETOP_JS).not.toContain("roll-mode-radios");
		for (const f of ["templates/actor/partials/roll-mode-picker.hbs", "templates/actor/partials/roll-mode-radios.hbs"])
			expect(fs.existsSync(path.resolve(HERE, "../../..", f)), f).toBe(false);
	});

	// The flag is what actually carried the bug from one roll to the next. Nothing may write it.
	it("writes no rollMode flag from either sheet", () => {
		for (const [name, js] of [["steading", STEADING_JS], ["character", CHARACTER_SHEET_JS], ["character model", CHARACTER_JS]])
			expect(js, name).not.toMatch(/setFlag\([^)]*["']rollMode["']/);
		expect(CHARACTER_JS).not.toContain("setRollMode");
	});

	// It was opt-in, defaulting OFF, back when all it asked for was a number. The only way to
	// say "with advantage" cannot sit inside a window most tables never turn on.
	it("no longer hides the prompt behind a client setting", () => {
		expect(SETTINGS_JS).not.toContain("promptRollModifier");
		expect(CHARACTER_SHEET_JS).not.toContain("getPromptRollModifierSetting");
		expect(EN.stonetop.settings.promptRollModifier).toBeUndefined();
	});

	it("leaves one move group on the steading's moves tab, and nothing above it", () => {
		expect((MOVES_HBS.match(/class="stonetop-move-group"/g) ?? []).length).toBe(1);
	});
});

describe("what asks before it rolls", () => {
	// Rolling a homefront move is open to a player who cannot edit the steading, so choosing
	// HOW to roll has to be too. The guard sits further down activateListeners.
	it("asks above the steading's isEditable guard, as the roll buttons do", () => {
		const start = STEADING_JS.indexOf("activateListeners(html)");
		const ask = STEADING_JS.indexOf("promptRoll(", start);
		const guard = STEADING_JS.indexOf("if (!this.isEditable) return;", start);
		expect(ask).toBeGreaterThan(start);
		expect(ask).toBeLessThan(guard);
	});

	// Every steading path that rolls a move asks first — the bare roll button, the homefront
	// flow dialogs, Requisition and Seasons Change. A path that forgot would be a move rolled
	// with no way to claim advantage at all.
	it("asks on every steading move-roll path", () => {
		expect((STEADING_JS.match(/await promptRoll\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
		expect(read("module/actors/character/dialogs/RequisitionDialog.js")).toContain("promptRoll(");
	});

	// The two flows post a summary card and spend the move's costs. Asking after either would
	// make "Cancel" mean "the card is out, the cost is paid, and no dice were rolled".
	it("asks before anything is posted or spent", () => {
		for (const post of ["_postHomesteadMoveSummary(flow, html)", "_postHomesteadMoveSummary(requisitionFlow, html)"]) {
			const at = STEADING_JS.indexOf(post);
			expect(at, post).toBeGreaterThan(-1);
			const before = STEADING_JS.slice(STEADING_JS.lastIndexOf("callback: async html => {", at), at);
			expect(before, post).toContain("promptRoll(");
		}
	});

	// Trade & Barter in winter is at disadvantage by the move's own text, so the rule is spread
	// OVER the player's answer rather than under it — and it is absent, not `undefined`, the
	// other three seasons, or the spread would blank their choice every time.
	it("lets a rule-forced disadvantage beat the player's pick, and only when it applies", () => {
		expect(STEADING_JS).toContain("...(data.winter ? { rollMode: \"dis\" } : {})");
		const roll = STEADING_JS.slice(STEADING_JS.indexOf("await this._onSteadingRoll(flow.label"));
		expect(roll.slice(0, 200)).toMatch(/\.\.\.prompted,\s*\.\.\.this\._homesteadRollOptions/);
	});

	// Shift is the escape hatch: the dice and nothing else, at Normal and +0. The rule lives in
	// the prompt, not in each caller — every roll surface passes its `shiftKey` straight through,
	// so a new one gets the shortcut by asking, and there is no copy of the answer to drift.
	it("skips the window on a Shift-click, and decides that in one place", async () => {
		expect(await promptRoll({ shiftKey: true })).toEqual({ rollMode: "normal", situational: 0 });

		// No dialog was constructed at all — a window that opened and closed itself would still
		// steal focus from whatever the player was doing.
		global.Dialog = vi.fn();
		await promptRoll({ shiftKey: true });
		expect(global.Dialog).not.toHaveBeenCalled();

		for (const [name, js] of [["steading", STEADING_JS], ["character", CHARACTER_SHEET_JS]]) {
			expect(js, name).toMatch(/shiftKey/);
			expect(js, `${name} re-implements the shift shortcut`)
				.not.toMatch(/if \(shiftKey\) return \{ rollMode:/);
		}
	});

	// …and a surface that FORWARDS to another one has to carry the Shift with it. A bare
	// `.click()` synthesises an event that reports `shiftKey: false` however the click that
	// caused it was made, so Shift-clicking a move's NAME would sit through the very window
	// Shift exists to skip. Both sheets re-dispatch a MouseEvent instead.
	it("keeps the Shift when a move's name forwards to its dice button", () => {
		for (const [name, js] of [["steading", STEADING_JS], ["character", CHARACTER_SHEET_JS]]) {
			const forwards = [...js.matchAll(/rollable\.dispatchEvent\(new MouseEvent\(\s*"click",\s*\{([^}]*)\}/g)];
			expect(forwards.length, `${name} forwards no click`).toBeGreaterThan(0);
			for (const [, init] of forwards) {
				expect(init, `${name} drops the Shift`).toContain("shiftKey: ev.shiftKey");
				// It has to reach the delegated listener on the sheet root, which is an ancestor.
				expect(init, `${name} forwards a non-bubbling click`).toContain("bubbles: true");
			}
			// And nothing forwards the bare way, which is the bug this replaced.
			expect(js, `${name} still bare-clicks a rollable`).not.toMatch(/\brollable\.click\(\)/);
		}
	});

	// The prompt answers in the shape a roll call takes, so a caller spreads it rather than
	// renaming its fields — the rename is what was being written out once per sheet.
	it("answers in the shape the roll calls take", async () => {
		const { pending, data, root } = open();
		await data.buttons.roll.callback([root]);
		expect(Object.keys(await pending).sort()).toEqual(["rollMode", "situational"]);
	});
});

describe("roll mode picker styling", () => {
	const block = sel => CSS.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1];

	// Core's `body.game .app button` is display:flex/width:100%/min-height:2em — without the
	// undo each segment claims its own row and the pill stacks vertically. The undo is the
	// reset shared with the relationship board's two strips, which this pill joined rather than
	// restated, so assert membership in that grouped selector.
	it("undoes core's block-level button rules, via the shared segmented reset", () => {
		const reset = CSS.match(/\n\.stonetop-rel-viewpicker \.stonetop-rel-view-btn,\n([^{]*)\{([^}]*)\}/);
		expect(reset, "the shared segmented reset is gone").toBeTruthy();
		expect(reset[1], "the pill is not in the shared reset")
			.toContain(".stonetop-roll-mode-picker .stonetop-roll-mode-btn");
		expect(reset[2]).toMatch(/display:\s*inline-flex/);
		expect(reset[2]).toMatch(/width:\s*auto/);
		expect(reset[2]).toMatch(/min-height:\s*0/);
	});

	// Its own block must not restate any of that — a second copy is what drifts.
	it("keeps only its own deltas in its own block", () => {
		const b = block(".stonetop-roll-mode-picker .stonetop-roll-mode-btn");
		expect(b, "the button rule is gone").toBeTruthy();
		for (const prop of ["display", "width", "min-height", "border-radius", "box-shadow"])
			expect(b, prop).not.toMatch(new RegExp(`\\n\\s*${prop}:`));
	});

	// A relative type step would resolve against whatever the pill is mounted in and size it by
	// where it sits rather than by the sheet. Same reason the view toggle pins its size.
	it("pins its type size to the root base, not a relative step", () => {
		const b = block(".stonetop-roll-mode-picker .stonetop-roll-mode-btn");
		expect(b).toMatch(/font-size:\s*calc\(0\.95rem \* var\(--stonetop-font-scale/);
		expect(b).not.toMatch(/font-size:\s*var\(--st-fs-/);
	});

	// Stamped class, not :has(input:checked) — there are no inputs.
	it("fills the chosen segment from .is-active", () => {
		expect(block(".stonetop-roll-mode-picker .stonetop-roll-mode-btn.is-active"))
			.toMatch(/background:\s*var\(--st-btn-primary-bg/);
	});

	it("gives keyboard focus a visible ring, which core strips from buttons", () => {
		expect(block(".stonetop-roll-mode-picker .stonetop-roll-mode-btn:focus-visible"))
			.toMatch(/outline:/);
	});

	// The strip is the window's own control, so it spans the width and its segments share it
	// evenly — and it is sized that way ONCE. It used to be sized for the section heading it
	// rode on and then re-sized by the dialog, which is two rules where the second only ever
	// undid the first; the heading is retired and the dialog is the only mount there is.
	it("grows the strip out to the dialog's width, with equal segments, in one rule", () => {
		expect(block(".stonetop-roll-form .stonetop-roll-mode-picker")).toMatch(/width:\s*100%/);
		expect(block(".stonetop-roll-mode-picker .stonetop-roll-mode-btn")).toMatch(/flex:\s*1 1 0/);
		expect(block(".stonetop-roll-form .stonetop-roll-mode-picker .stonetop-roll-mode-btn"),
			"the segments are sized twice again").toBeFalsy();
	});

	// Nothing renders the radio list or the heading bar any more, and a rule for a shape that
	// nothing renders is the drift that follows from keeping one.
	it("drops the styling for every control that was retired", () => {
		for (const dead of [".stonetop-roll-mode-control", ".stonetop-roll-mode-option", ".stonetop-roll-mode-bar"])
			expect(CSS, dead).not.toContain(dead);
	});
});
