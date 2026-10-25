import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { LevelUpDialog } from "../../../../module/actors/character/dialogs/LevelUpDialog.js";
import { StonetopDialog } from "../../../../module/utils/stonetop-dialog.js";

// The level-up's agreed step asks a world setting whether this user may write a custom move
// (utils/authoring-gates.js); a world always has settings, so the tests give it some, all unset.
let priorSettings;
beforeEach(() => { priorSettings = game.settings; game.settings ??= { get: () => undefined }; });
afterEach(() => { game.settings = priorSettings; });

const TEMPLATE = fs.readFileSync(path.join(process.cwd(), "templates", "dialogs", "level-up.hbs"), "utf8");
// The agreed and cross-playbook steps' card, one partial for both (`family` tells them apart).
const OTHER_CARD = fs.readFileSync(path.join(process.cwd(), "templates", "dialogs", "partials", "level-up-other-card.hbs"), "utf8");
function renderOtherCard(context) {
	const hb = Handlebars.create();
	hb.registerHelper("localize", key => key);
	hb.registerHelper("moveBody", description => description);
	return hb.compile(OTHER_CARD)(context);
}
// Comments stripped: they name these selectors in prose, and a raw scan would read a
// paragraph about the hazard as an instance of the hazard.
const DIALOG_SRC = fs
	.readFileSync(path.join(process.cwd(), "module", "actors", "character", "dialogs", "LevelUpDialog.js"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^\s*\/\/.*$/gm, "");

function makeDialog({ character = {}, data = {} } = {}) {
	const char = {
		applyLevelUp: vi.fn(),
		getForeignMovesForLevelUp: vi.fn().mockResolvedValue([]),
		...character,
	};
	const levelUpData = {
		level: 2, newLevel: 3, cost: 8, xpRemaining: 2, playbookName: "The Fox", needsInvocation: false,
		availableMoves: [], lockedMoves: [], availableInvocations: [], stats: [],
		...data,
	};
	const dlg = new LevelUpDialog(char, levelUpData, vi.fn());
	dlg.close = vi.fn();
	dlg.render = vi.fn();
	return { dlg, char };
}

// Minimal stand-ins for the DOM the filter/chip helpers walk (the suite runs on the `node`
// environment — no jsdom, no jQuery). `find` serves whatever the test registered under that
// exact selector string, which is all these two helpers ask of a jQuery collection.
function fakeEl({ classes = [], data = {} } = {}) {
	const set = new Set(classes);
	return {
		dataset: data,
		attrs: {},
		classList: {
			contains: c => set.has(c),
			toggle:   (c, on) => { if (on) set.add(c); else set.delete(c); return on; },
		},
		setAttribute(k, v) { this.attrs[k] = v; },
		hidden: () => set.has("is-filtered-out"),
	};
}

function fakeHtml(map) {
	return {
		find: sel => {
			const els = map[sel] ?? [];
			return {
				each(fn) { els.forEach((el, i) => fn(i, el)); return this; },
				toggleClass(cls, on) { els.forEach(el => el.classList.toggle(cls, on)); return this; },
			};
		},
	};
}

const crossMove = { compendiumId: "v1", name: "Versatile",      cap: null, crossPlaybook: { playbooks: "any" } };
const statMove  = { compendiumId: "s1", name: "Improved Stat",  cap: 2,    crossPlaybook: null };
const plainMove = { compendiumId: "p1", name: "Harden",         cap: null, crossPlaybook: null };

describe("LevelUpDialog cross-playbook step machine", () => {
	it("_needsForeignMoveChoice reflects the selected move's crossPlaybook (and is disjoint from the stat step)", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [crossMove, statMove, plainMove] } });
		dlg._selectedMoveId = "v1";
		expect(dlg._needsForeignMoveChoice()).toBe(true);
		expect(dlg._needsStatChoice()).toBe(false);
		dlg._selectedMoveId = "s1";
		expect(dlg._needsForeignMoveChoice()).toBe(false);
		expect(dlg._needsStatChoice()).toBe(true);
		dlg._selectedMoveId = "p1";
		expect(dlg._needsForeignMoveChoice()).toBe(false);
		expect(dlg._needsStatChoice()).toBe(false);
	});

	it("_loadForeignMoves fetches once and caches by move id (no re-fetch on a Back→Next round-trip)", async () => {
		const fetch = vi.fn().mockResolvedValue([{ compendiumId: "f1", name: "Smash", playbook: "The Heavy" }]);
		const { dlg } = makeDialog({ data: { availableMoves: [crossMove] }, character: { getForeignMovesForLevelUp: fetch } });
		dlg._selectedMoveId = "v1";
		await dlg._loadForeignMoves();
		dlg._selectedForeignMoveId = "f1";
		await dlg._loadForeignMoves();                 // same move → cached
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(dlg._selectedForeignMoveId).toBe("f1"); // pick preserved
	});

	it("foreignMove step: canContinue needs a pick; an empty list blocks a move that grants nothing else; isLastStep when no invocation follows", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [crossMove] } });
		dlg._selectedMoveId = "v1";
		dlg._step = "foreignMove";
		dlg._foreignMoves = [{ compendiumId: "f1", name: "Smash", playbook: "The Heavy" }];
		const ctx = dlg.getData();
		expect(ctx.isForeignMove).toBe(true);
		expect(ctx.isLastStep).toBe(true);
		expect(ctx.canContinue).toBe(false);           // a move is offered but none picked yet
		dlg._selectedForeignMoveId = "f1";
		expect(dlg.getData().canContinue).toBe(true);
		dlg._foreignMoves = []; dlg._selectedForeignMoveId = null;
		// Versatile with nothing to learn would buy nothing: the level can't be spent on it (J6).
		expect(dlg.getData().canContinue).toBe(false);
		expect(dlg.getData().foreignBlocked).toBe(true);
	});

	it("foreignMove step: an empty list still lets an Initiate finish, for the Sacred Pouch it grants", () => {
		const initiate = { compendiumId: "i1", name: "Initiate of the Secret Arts", cap: null, crossPlaybook: { playbooks: ["The Blessed"], grantsPossession: "sacred-pouch" } };
		const { dlg } = makeDialog({ data: { availableMoves: [initiate] } });
		dlg._selectedMoveId = "i1";
		dlg._step = "foreignMove";
		dlg._foreignMoves = [];
		dlg._grantsNewPossession = true;   // _loadForeignMoves: no Sacred Pouch held yet
		const ctx = dlg.getData();
		expect(ctx.foreignBlocked).toBe(false);
		expect(ctx.canContinue).toBe(true);
	});

	// A second Initiate with nothing to learn brings no new Pouch either, so it buys nothing.
	it("foreignMove step: an empty list blocks an Initiate whose Sacred Pouch is already held", () => {
		const initiate = { compendiumId: "i1", name: "Initiate of the Secret Arts", cap: null, crossPlaybook: { playbooks: ["The Blessed"], grantsPossession: "sacred-pouch" } };
		const { dlg } = makeDialog({ data: { availableMoves: [initiate] } });
		dlg._selectedMoveId = "i1";
		dlg._step = "foreignMove";
		dlg._foreignMoves = [];
		dlg._grantsNewPossession = false;
		const ctx = dlg.getData();
		expect(ctx.foreignBlocked).toBe(true);
		expect(ctx.canContinue).toBe(false);
	});

	it("foreignMove step: playbook chips are the distinct source playbooks, article-stripped, and suppressed below two", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [crossMove] } });
		dlg._selectedMoveId = "v1";
		dlg._step = "foreignMove";
		dlg._foreignMoves = [
			{ compendiumId: "f1", name: "Smash",   playbook: "The Heavy" },
			{ compendiumId: "f2", name: "Danger",  playbook: "The Fox" },
			{ compendiumId: "f3", name: "Ambush",  playbook: "The Fox" },   // same playbook — one chip
			{ compendiumId: "f4", name: "Reserve", playbook: "The Would-Be Hero" },
		];
		expect(dlg.getData().foreignPlaybooks).toEqual([
			{ key: "The Fox",           label: "Fox" },
			{ key: "The Heavy",         label: "Heavy" },
			{ key: "The Would-Be Hero", label: "Would-Be Hero" },
		]);
		dlg._foreignMoves = [{ compendiumId: "f1", name: "Smash", playbook: "The Heavy" }];
		expect(dlg.getData().foreignPlaybooks).toEqual([]); // one playbook needs no filter
	});

	// Source scan: the two chip families share `.stonetop-levelup-move-chip` for its pill
	// styling (including the past-death skin), so the MOVE step's handlers must be scoped by
	// the attribute they read or they also bind to the foreign step's playbook chips. That
	// regression is silent — the filtering still works, because it reads instance state — but
	// a foreign chip click would set `_activeMoveGroup` to undefined (clobbering the move
	// step's own chip on a Back) and light every playbook chip at once, since a bare
	// `undefined === undefined` matches them all.
	it("the move-step selectors exclude the foreign step's cards and chips", () => {
		// Positive assertions first, so a rename can't make either scan trivially pass by
		// leaving nothing for it to match.
		expect(DIALOG_SRC).toContain(".stonetop-levelup-move-chip[data-move-group]");
		expect(DIALOG_SRC).toContain(".stonetop-levelup-move-option:not(.stonetop-levelup-foreign-option)");
		expect(DIALOG_SRC.match(/\.stonetop-levelup-move-chip(?!\[data-move-group\])/g)).toBe(null);
		expect(DIALOG_SRC.match(/\.stonetop-levelup-move-option(?!:not\(\.stonetop-levelup-foreign-option\))/g)).toBe(null);

		const chip = TEMPLATE.match(/<button[^>]*stonetop-levelup-foreign-chip[^>]*>/);
		expect(chip).not.toBeNull();
		expect(chip[0]).toContain('data-playbook="{{key}}"');
		expect(chip[0]).not.toContain("data-move-group");

		// And the cards the chips filter must expose the playbook the filter matches on.
		expect(TEMPLATE).toContain('{{> "stonetop.level-up-other-card" family="foreign"}}');
		const card = renderOtherCard({ family: "foreign", compendiumId: "f1", playbook: "The Heavy", name: "Brawler" })
			.match(/<div[^>]*stonetop-levelup-foreign-option[^>]*>/);
		expect(card).not.toBeNull();
		expect(card[0]).toContain('data-playbook="The Heavy"');
		expect(card[0]).toContain('data-compendium-id="f1"');
	});

	it("both chip rows ship with aria-pressed, and _paintChips keeps it in step with the highlight", () => {
		for (const chip of TEMPLATE.match(/<button[^>]*stonetop-levelup-move-chip[^>]*>/g) ?? []) {
			expect(chip).toContain('aria-pressed="false"');
		}

		const { dlg } = makeDialog();
		const fox   = fakeEl({ data: { playbook: "The Fox" } });
		const heavy = fakeEl({ data: { playbook: "The Heavy" } });
		const html  = fakeHtml({ ".stonetop-levelup-foreign-chip": [fox, heavy] });

		dlg._paintChips(html, ".stonetop-levelup-foreign-chip", "playbook", "The Heavy");
		expect(heavy.attrs["aria-pressed"]).toBe("true");
		expect(fox.attrs["aria-pressed"]).toBe("false");

		dlg._paintChips(html, ".stonetop-levelup-foreign-chip", "playbook", null); // filter cleared
		expect(heavy.attrs["aria-pressed"]).toBe("false");
		expect(fox.attrs["aria-pressed"]).toBe("false");
	});

	it("_applyCardFilter pins the current pick visible and reveals the no-matches line only when nothing shows", () => {
		const { dlg } = makeDialog();
		const picked = fakeEl({ classes: ["is-selected"], data: { playbook: "The Heavy" } });
		const other  = fakeEl({ data: { playbook: "The Fox" } });
		const line   = fakeEl({ classes: ["is-filtered-out"] });
		const html   = fakeHtml({ ".card": [picked, other], ".empty": [line] });

		// A filter that matches NEITHER card still leaves the pick on screen, so the enabled
		// Continue button always has a visible card behind it — and the list isn't "empty".
		dlg._applyCardFilter(html, ".card", ".empty", () => false);
		expect(picked.hidden()).toBe(false);
		expect(other.hidden()).toBe(true);
		expect(line.hidden()).toBe(true);

		// With nothing picked, the same dead filter empties the list and explains itself.
		const a = fakeEl(), b = fakeEl();
		const html2 = fakeHtml({ ".card": [a, b], ".empty": [line] });
		dlg._applyCardFilter(html2, ".card", ".empty", () => false);
		expect(line.hidden()).toBe(false);

		// And a filter that matches hides the line again.
		dlg._applyCardFilter(html2, ".card", ".empty", el => el === a);
		expect(a.hidden()).toBe(false);
		expect(b.hidden()).toBe(true);
		expect(line.hidden()).toBe(true);
	});

	it("_loadForeignMoves clears a stale playbook chip when the source move changes", async () => {
		const fetch = vi.fn().mockResolvedValue([{ compendiumId: "f1", name: "Smash", playbook: "The Heavy" }]);
		const otherCross = { compendiumId: "v2", name: "Worldly", cap: null, crossPlaybook: { playbooks: ["The Ranger"] } };
		const { dlg } = makeDialog({ data: { availableMoves: [crossMove, otherCross] }, character: { getForeignMovesForLevelUp: fetch } });
		dlg._selectedMoveId = "v1";
		await dlg._loadForeignMoves();
		dlg._activeForeignPlaybook = "The Heavy";
		await dlg._loadForeignMoves();                     // same move → cached, chip kept
		expect(dlg._activeForeignPlaybook).toBe("The Heavy");
		dlg._selectedMoveId = "v2";
		await dlg._loadForeignMoves();                     // new source move → fresh list, chip cleared
		expect(dlg._activeForeignPlaybook).toBe(null);
	});

	it("a cross-playbook move that grants no invocation makes the move step NON-terminal (foreignMove follows)", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [crossMove] } });
		dlg._selectedMoveId = "v1";
		dlg._step = "move";
		expect(dlg.getData().isLastStep).toBe(false);
	});

	it("_apply threads cross-playbook choices (foreign move + grantsPossession) to applyLevelUp", async () => {
		const initiate = { compendiumId: "i1", name: "Initiate of the Secret Arts", cap: null, crossPlaybook: { playbooks: ["The Blessed"], grantsPossession: "sacred-pouch" } };
		const { dlg, char } = makeDialog({ data: { availableMoves: [initiate] } });
		dlg._selectedMoveId = "i1";
		dlg._selectedForeignMoveId = "bm1";
		await dlg._apply();
		expect(char.applyLevelUp).toHaveBeenCalledWith("i1", null, { crossPlaybook: true, foreignMoveId: "bm1", grantsPossession: "sacred-pouch" }, { fromLevel: 2, moveName: expect.any(String) });
		expect(dlg.close).toHaveBeenCalled();
	});

	// A Seeker who takes Big Magic through Initiate is owed its remarkable trait, so the sheet
	// has to hear the FOREIGN move's name, not just "Initiate of the Secret Arts".
	it("_apply hands the sheet the foreign move a cross-playbook pick learned", async () => {
		const initiate = { compendiumId: "i1", name: "Initiate of the Secret Arts", cap: null, crossPlaybook: { playbooks: ["The Blessed"], grantsPossession: "sacred-pouch" } };
		const { dlg } = makeDialog({ data: { availableMoves: [initiate] } });
		dlg._foreignMoves = [{ compendiumId: "bm1", name: "Big Magic", playbook: "The Blessed" }];
		dlg._selectedMoveId = "i1";
		dlg._selectedForeignMoveId = "bm1";
		await dlg._apply();
		expect(dlg._onDone).toHaveBeenCalledWith("Initiate of the Secret Arts", { applied: true, foreignMoveName: "Big Magic" });
	});

	// The timeline's "Reached level N" row names the move learned, and this is where it comes from.
	it("_apply hands the chosen move's name on for the timeline", async () => {
		const initiate = { compendiumId: "i1", name: "Initiate of the Secret Arts", cap: null, crossPlaybook: { playbooks: ["The Blessed"], grantsPossession: "sacred-pouch" } };
		const { dlg, char } = makeDialog({ data: { availableMoves: [initiate] } });
		dlg._foreignMoves = [{ compendiumId: "bm1", name: "Big Magic", playbook: "The Blessed" }];
		dlg._selectedMoveId = "i1";
		dlg._selectedForeignMoveId = "bm1";
		await dlg._apply();
		// The timeline row names the foreign move the cross pick learned as well.
		expect(char.applyLevelUp.mock.calls[0][3]).toEqual({ fromLevel: 2, moveName: "Initiate of the Secret Arts (Big Magic)" });
	});

	it("_apply still passes the stat choice for a stat move (no cross-playbook collision)", async () => {
		const { dlg, char } = makeDialog({ data: { availableMoves: [statMove] } });
		dlg._selectedMoveId = "s1";
		dlg._selectedStat = "str";
		await dlg._apply();
		expect(char.applyLevelUp).toHaveBeenCalledWith("s1", null, { stat: "str", cap: 2 }, { fromLevel: 2, moveName: expect.any(String) });
	});
});

describe("LevelUpDialog — one window per character, and a refused level-up", () => {
	const plainMove = { compendiumId: "p1", name: "Berserker", cap: null };

	it("gives each character its own window id, so two open windows never share a frame", () => {
		const spy = vi.spyOn(StonetopDialog, "perDocumentOptions");
		try {
			new LevelUpDialog({ _actor: { id: "actorA" } }, { availableMoves: [], lockedMoves: [], availableInvocations: [] }, vi.fn());
			expect(spy).toHaveBeenCalledWith("stonetop-levelup-dialog", "actorA", {});
			expect(spy.mock.results[0].value.id).toBe("stonetop-levelup-dialog-actorA");
		} finally {
			spy.mockRestore();
		}
	});

	it("idFor names the same per-character id the window takes", () => {
		expect(LevelUpDialog.idFor("actorA")).toBe("stonetop-levelup-dialog-actorA");
		expect(LevelUpDialog.idFor("actorB")).not.toBe(LevelUpDialog.idFor("actorA"));
	});

	it.each([
		["level", "already applied"],
		["xp",    "Not enough XP"],
	])("a refusal (%s) warns, re-renders the sheet with no move, and closes", async (reason, text) => {
		const warn = vi.spyOn(global.ui.notifications, "warn");
		const { dlg } = makeDialog({
			character: { applyLevelUp: vi.fn().mockResolvedValue({ applied: false, reason }) },
			data: { availableMoves: [plainMove] },
		});
		dlg._selectedMoveId = "p1";
		await dlg._apply();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(text));
		expect(dlg._onDone).toHaveBeenCalledWith(null, { applied: false });
		expect(dlg.close).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("closes before telling the sheet, so a next level-up can open under the same id", async () => {
		const order = [];
		const { dlg } = makeDialog({ data: { availableMoves: [plainMove] } });
		dlg.close = vi.fn(async () => { order.push("close"); });
		dlg._onDone = vi.fn(() => order.push("done"));
		dlg._selectedMoveId = "p1";
		await dlg._apply();
		expect(order).toEqual(["close", "done"]);
		expect(dlg._onDone).toHaveBeenCalledWith("Berserker", { applied: true });
	});
});

describe("LevelUpDialog — Beast-Bonded companion step", () => {
	const plainMove = { compendiumId: "p1", name: "Stalker", cap: null };
	const companionActions = {
		label: "Mark 1 action at 1st level, then another at 3rd, 5th, 7th, and 9th.", allowance: 1,
		options: [
			{ slug: "call-back", label: "Call it back to your side", marked: true },
			{ slug: "sense-emotion", label: "Sense its emotional state", marked: false },
		],
	};

	it("follows the move step when an action is owed, and needs the pick to go on", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [plainMove], companionActions } });
		dlg._selectedMoveId = "p1";
		dlg._step = "move";
		expect(dlg._adjacentStep(+1)).toBe("companion");
		dlg._step = "companion";
		let view = dlg.getData();
		expect(view.canContinue).toBe(false);
		expect(view.companionStep.options.find(o => o.slug === "call-back").disabled).toBe(true);
		dlg._selectedCompanionActions = ["sense-emotion"];
		view = dlg.getData();
		expect(view.canContinue).toBe(true);
		expect(view.isLastStep).toBe(true);
	});

	it("is skipped when nothing is owed", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [plainMove] } });
		dlg._selectedMoveId = "p1";
		dlg._step = "move";
		expect(dlg._adjacentStep(+1)).toBeUndefined();
	});

	it("hands the pick to applyLevelUp", async () => {
		const { dlg, char } = makeDialog({ data: { availableMoves: [plainMove], companionActions } });
		dlg._selectedMoveId = "p1";
		dlg._selectedCompanionActions = ["sense-emotion"];
		await dlg._apply();
		expect(char.applyLevelUp).toHaveBeenCalledWith("p1", null, { companionActions: ["sense-emotion"] }, { fromLevel: 2, moveName: expect.any(String) });
	});
});

describe("LevelUpDialog — an Invocation for a Would-be Hero who takes Invoke the Sun God", () => {
	const versatile = { compendiumId: "v1", name: "Versatile", cap: null, crossPlaybook: { playbooks: "any" } };
	const evenLevel = { level: 3, newLevel: 4, availableMoves: [versatile], availableInvocations: [{ slug: "bath-of-healing-light", label: "Bath of Healing Light" }] };
	const foreign = [{ compendiumId: "isg", name: "Invoke the Sun God", playbook: "The Lightbearer" },
		{ compendiumId: "smash", name: "Smash", playbook: "The Heavy" }];

	it("opens the Invocation step when the cross-playbook pick is Invoke the Sun God on an even level", () => {
		const { dlg } = makeDialog({ data: evenLevel });
		dlg._selectedMoveId = "v1";
		dlg._foreignMoves = foreign;
		dlg._selectedForeignMoveId = "isg";
		dlg._step = "foreignMove";
		expect(dlg._adjacentStep(+1)).toBe("invocation");
		dlg._selectedForeignMoveId = "smash";
		expect(dlg._adjacentStep(+1)).toBeUndefined();
	});

	it("does not open it on an odd level", () => {
		const { dlg } = makeDialog({ data: { ...evenLevel, newLevel: 3, availableInvocations: [] } });
		dlg._selectedMoveId = "v1";
		dlg._foreignMoves = foreign;
		dlg._selectedForeignMoveId = "isg";
		dlg._step = "foreignMove";
		expect(dlg._adjacentStep(+1)).toBeUndefined();
	});

	it("drops an Invocation chosen before the player went back and picked something else", async () => {
		const { dlg, char } = makeDialog({ data: evenLevel });
		dlg._selectedMoveId = "v1";
		dlg._foreignMoves = foreign;
		dlg._selectedForeignMoveId = "smash";
		dlg._selectedInvocationSlug = "bath-of-healing-light";
		await dlg._apply();
		expect(char.applyLevelUp.mock.calls[0][1]).toBeNull();
	});

	it("passes the Invocation when the step ran", async () => {
		const { dlg, char } = makeDialog({ data: evenLevel });
		dlg._selectedMoveId = "v1";
		dlg._foreignMoves = foreign;
		dlg._selectedForeignMoveId = "isg";
		dlg._selectedInvocationSlug = "bath-of-healing-light";
		await dlg._apply();
		expect(char.applyLevelUp.mock.calls[0][1]).toBe("bath-of-healing-light");
	});
});

// A budgeted count-mark move (Veteran Crew shape): base 1 pick per take, repeat-scaling.
const veteranCrew = {
	compendiumId: "vc1", name: "Veteran Crew", cap: null, crossPlaybook: null,
	markOptions: [
		{ slug: "tags",    label: "Select 2 new tags", marks: 4 },
		{ slug: "crew-hp", label: "+2 HP each",        marks: 4 },
	],
	markBudget: { base: 1, perExtra: 1 }, ownedIds: [],
};

describe("LevelUpDialog mark step — budgeted moves (Veteran Crew / Well Versed / …)", () => {
	it("a budgeted move needs the mark step (disjoint from stat/foreign) with the budget's allowance", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [veteranCrew], marks: {} } });
		dlg._selectedMoveId = "vc1";
		expect(dlg._needsMarkChoice()).toBe(true);
		expect(dlg._needsStatChoice()).toBe(false);
		expect(dlg._needsForeignMoveChoice()).toBe(false);
		expect(dlg._markStepDescriptor()).toMatchObject({ moveName: "Veteran Crew", allowance: 1 });
	});

	it("the allowance scales with the move's owned count (a 2nd copy of Well Versed grants more)", () => {
		const wellVersed = { ...veteranCrew, name: "Well Versed", markBudget: { base: 1, perExtra: 2 }, ownedIds: ["o1"] };
		const { dlg } = makeDialog({ data: { availableMoves: [{ ...wellVersed, compendiumId: "wv1" }], marks: {} } });
		dlg._selectedMoveId = "wv1";
		// 1 already owned ⇒ this take is the 2nd copy ⇒ budget 1 + 2·(2−1) = 3.
		expect(dlg._markStepDescriptor().allowance).toBe(3);
	});

	// Well Versed: "Mark 1 topic, in addition to the one noted in your Background". The background's
	// topic (the Patriot's Things Below) is shown as the Background's, never pickable, and spends none
	// of the take's allowance.
	it("shows the background's topic as the Background's, not pickable and outside the allowance", () => {
		const wellVersed = {
			compendiumId: "wv1", name: "Well Versed", cap: null, crossPlaybook: null,
			markOptions: [
				{ slug: "fae",          label: "The Fae and their strange ways", marks: 1 },
				{ slug: "things-below", label: "The Things Below", marks: 1 },
				{ slug: "wild",         label: "The wild world and its spirits", marks: 1 },
			],
			markBudget: { base: 1, perExtra: 2 }, ownedIds: ["o1"],
		};
		const { dlg } = makeDialog({ data: {
			availableMoves: [wellVersed], marks: { "Well Versed": { fae: [{ level: 1 }] } },
			backgroundMarks: { "Well Versed": "things-below" },
		} });
		dlg._selectedMoveId = "wv1";
		dlg._step = "marks";
		const desc = dlg._markStepDescriptor();
		// 2nd copy: budget 3, the Fae spent, the background's box not ⇒ 2 more.
		expect(desc.allowance).toBe(2);
		expect(desc.options.find(o => o.slug === "things-below")).toMatchObject({ background: true, capacity: 0, capNote: "From your Background: you already have this one." });
		const step = dlg.getData().markStep;
		const things = step.options.find(o => o.slug === "things-below");
		expect(things).toMatchObject({ disabled: true, existingLabel: "Background" });
		// Only the wild world is left to pick: the Fae is marked, the Things Below is the background's.
		expect(step.allowance).toBe(1);
	});

	it("the move step is non-terminal and Continue is gated until the take's pick is made", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [veteranCrew], marks: {} } });
		dlg._selectedMoveId = "vc1";
		dlg._step = "move";
		expect(dlg.getData().isLastStep).toBe(false);
		dlg._step = "marks";
		expect(dlg.getData().canContinue).toBe(false);
		dlg._selectedMarks = [{ slug: "tags" }];
		const ctx = dlg.getData();
		expect(ctx.canContinue).toBe(true);
		expect(ctx.isLastStep).toBe(true); // no invocation follows
		expect(ctx.markStep.used).toBe(1);
	});

	it("_apply threads the mark picks to applyLevelUp", async () => {
		const { dlg, char } = makeDialog({ data: { availableMoves: [veteranCrew], marks: {} } });
		dlg._selectedMoveId = "vc1";
		dlg._selectedMarks = [{ slug: "tags" }];
		await dlg._apply();
		expect(char.applyLevelUp).toHaveBeenCalledWith("vc1", null, { marks: { moveName: "Veteran Crew", picks: [{ slug: "tags" }] } }, { fromLevel: 2, moveName: expect.any(String) });
	});

	it("clamps the take's required picks to the selectable options so the step can't dead-end", () => {
		// Beast-of-Legend shape: 2 options, 3rd take grants budget 3 — but one pick per
		// option means only 2 are placeable, so the required count clamps to 2 (no hard lock).
		const beast = {
			compendiumId: "bol1", name: "Beast of Legend", cap: null, crossPlaybook: null,
			markOptions: [
				{ slug: "tough",  label: "+4 HP, +1 armor", marks: 3 },
				{ slug: "unique", label: "unique trait",    marks: 3 },
			],
			markBudget: { base: 1, perExtra: 1 }, ownedIds: ["a", "b"], // 2 owned ⇒ 3rd take ⇒ budget 3
		};
		const { dlg } = makeDialog({ data: { availableMoves: [beast], marks: {} } });
		dlg._selectedMoveId = "bol1";
		dlg._step = "marks";
		expect(dlg.getData().markStep.allowance).toBe(2); // clamped from budget 3 → 2 selectable
		dlg._selectedMarks = [{ slug: "tough" }, { slug: "unique" }];
		expect(dlg.getData().canContinue).toBe(true);
	});

	// Heroes to the Last's "Increase their damage die one size (max d10)" buys nothing once the crew's
	// die is d10 already (d6, d8 from Veteran Crew, d10 from a first Heroes pick): greyed, with why.
	it("greys an option whose target is already at its cap, and says why", () => {
		const heroes = {
			compendiumId: "htl1", name: "Heroes to the Last", cap: null, crossPlaybook: null,
			markOptions: [
				{ slug: "inured",      label: "They are inured", marks: 1 },
				{ slug: "crew-damage", label: "Increase their damage die one size (max d10)", marks: 2, crewDamageStep: 1, crewDamageCap: "d10" },
			],
			markBudget: { base: 1, perExtra: 1 }, ownedIds: ["h1"],
		};
		const marks = { "Heroes to the Last": { "crew-damage": [{ stat: "", level: 6 }] } };
		const at = (die) => {
			const { dlg } = makeDialog({ data: { availableMoves: [heroes], marks, markCapState: { crewDamageDie: die } } });
			dlg._selectedMoveId = "htl1";
			dlg._step = "marks";
			return Object.fromEntries(dlg.getData().markStep.options.map(o => [o.slug, o]));
		};
		const capped = at("d10");
		expect(capped["crew-damage"]).toMatchObject({ disabled: true, tooltip: "Their damage die is already d10" });
		expect(capped.inured).toMatchObject({ disabled: false, tooltip: null });
		const room = at("d8");
		expect(room["crew-damage"]).toMatchObject({ disabled: false, tooltip: null });
	});
});

describe("LevelUpDialog mark step — no step when not applicable", () => {
	it("no mark step for a plain (non-budgeted) move", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [plainMove] } });
		dlg._selectedMoveId = "p1";
		dlg._step = "move";
		expect(dlg._needsMarkChoice()).toBe(false);
		expect(dlg.getData().isLastStep).toBe(true); // nothing follows → move is terminal
	});
});

// A Blessed who takes Beast of Legend through Wild Soul picks its option as a Ranger would (Ranger
// audit M12): the step is built from the chosen FOREIGN move's mark options and the copies held.
describe("LevelUpDialog mark step: a foreign budgeted move", () => {
	const wildSoul = { compendiumId: "ws1", name: "Wild Soul", cap: null, crossPlaybook: { playbooks: ["The Ranger"] } };
	const foreignBeast = {
		compendiumId: "bol1", name: "Beast of Legend", playbook: "The Ranger",
		markOptions: [
			{ slug: "exceptional", label: "They are exceptional", marks: 1 },
			{ slug: "tough",       label: "+4 HP and +1 armor",   marks: 1 },
			{ slug: "unique",      label: "A unique trait",       marks: 1 },
		],
		markBudget: { base: 1, perExtra: 1 }, ownedIds: [],
	};

	it("the chosen foreign move's marks follow the foreign-move step", () => {
		const { dlg } = makeDialog({ data: { availableMoves: [wildSoul], marks: {} } });
		dlg._selectedMoveId = "ws1";
		dlg._foreignMoves = [foreignBeast, { compendiumId: "wh1", name: "Wild Speech", playbook: "The Ranger" }];
		dlg._selectedForeignMoveId = "wh1";
		expect(dlg._needsMarkChoice()).toBe(false);
		dlg._selectedForeignMoveId = "bol1";
		expect(dlg._markStepDescriptor()).toMatchObject({ moveName: "Beast of Legend", allowance: 1 });
		dlg._step = "foreignMove";
		expect(dlg._adjacentStep(+1)).toBe("marks");
	});

	it("_apply threads the foreign move and its pick together", async () => {
		const { dlg, char } = makeDialog({ data: { availableMoves: [wildSoul], marks: {} } });
		dlg._selectedMoveId = "ws1";
		dlg._foreignMoves = [foreignBeast];
		dlg._selectedForeignMoveId = "bol1";
		dlg._selectedMarks = [{ slug: "tough" }];
		await dlg._apply();
		expect(char.applyLevelUp).toHaveBeenCalledWith("ws1", null, {
			crossPlaybook: true, foreignMoveId: "bol1", grantsPossession: null,
			marks: { moveName: "Beast of Legend", picks: [{ slug: "tough" }] },
		}, { fromLevel: 2, moveName: expect.any(String) });
	});
});
