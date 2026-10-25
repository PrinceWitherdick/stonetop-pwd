// @vitest-environment happy-dom
// The close-guard (utils/close-guard.js): a walkthrough that keeps its answers only in the window asks
// before Cancel, Escape or the X throws them away, and Make a Site / Make a Hazard can save partway.

import { describe, it, expect, vi, afterEach } from "vitest";
import { stubAsk } from "../fakes/confirm.js";
import { readRepo } from "../fakes/css.js";
import { mayClose, notePristineWork, hasUnsavedWork } from "../../module/utils/close-guard.js";
import { StonetopDialog } from "../../module/utils/stonetop-dialog.js";
import { StepperDialog } from "../../module/dialogs/StepperDialog.js";
import { CreateSiteDialog } from "../../module/sites/create-site-dialog.js";
import { CreateHazardDialog } from "../../module/hazards/create-hazard-dialog.js";
import { CreateThingDialog } from "../../module/things-below/create-thing-dialog.js";
import { CreateCorruptedSiteDialog } from "../../module/things-below/create-corrupted-site-dialog.js";
import { CorruptBeingDialog } from "../../module/things-below/corrupt-being-dialog.js";
import { CreateFollowerDialog } from "../../module/actors/character/dialogs/CreateFollowerDialog.js";
import { CreateMonsterDialog } from "../../module/dialogs/CreateMonsterDialog.js";

afterEach(() => vi.restoreAllMocks());

/** A window whose work is `state.text`, opened untouched. */
function windowWith({ saveForNow = null } = {}) {
	const state = { text: "" };
	const app = { _workState: () => ({ text: state.text }) };
	if (saveForNow) app._saveForNow = saveForNow;
	notePristineWork(app);
	return { app, state };
}

describe("asking before a close", () => {
	it("doesn't ask for a window with nothing written, or one that keeps no work", async () => {
		const asked = stubAsk("discard");
		const { app } = windowWith();
		expect(await mayClose(app)).toBe(true);
		expect(await mayClose({})).toBe(true);
		expect(asked).not.toHaveBeenCalled();
	});

	it("asks once something is written: Discard, then Keep writing, with Enter on Keep writing", async () => {
		const asked = stubAsk("keep");
		const { app, state } = windowWith();
		state.text = "The old mill";
		expect(hasUnsavedWork(app)).toBe(true);
		expect(await mayClose(app)).toBe(false);
		const config = asked.mock.calls[0][0];
		expect(config.buttons.map(b => b.label)).toEqual(["Discard what I wrote", "Keep writing"]);
		expect(config.buttons.find(b => b.default)?.action).toBe("keep");
	});

	it("closes on Discard, and stays open when the question is closed unanswered", async () => {
		const { app, state } = windowWith();
		state.text = "x";
		stubAsk("discard");
		expect(await mayClose(app)).toBe(true);
		stubAsk(null);
		expect(await mayClose(app)).toBe(false);
	});

	it("offers Save for now first to a window that can save partway, and saves on it", async () => {
		const save = vi.fn(async () => {});
		const asked = stubAsk("save");
		const { app, state } = windowWith({ saveForNow: save });
		state.text = "x";
		// The save closes the window itself, so this close doesn't go ahead.
		expect(await mayClose(app)).toBe(false);
		expect(save).toHaveBeenCalledTimes(1);
		expect(asked.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Save for now", "Discard what I wrote", "Keep writing"]);
	});

	it("never asks for a close that finishes", async () => {
		const asked = stubAsk("keep");
		const { app, state } = windowWith();
		state.text = "x";
		expect(await mayClose(app, { discard: true })).toBe(true);
		expect(asked).not.toHaveBeenCalled();
	});

	it("doesn't stack a second question when Escape is pressed again while it's up", async () => {
		let answer;
		const wait = vi.fn(() => new Promise(resolve => { answer = resolve; }));
		globalThis.foundry.applications.api.DialogV2 = { wait };
		const { app, state } = windowWith();
		state.text = "x";
		const first = mayClose(app);
		expect(await mayClose(app)).toBe(false);
		answer("keep");
		expect(await first).toBe(false);
		expect(wait).toHaveBeenCalledTimes(1);
	});

	it("does nothing more when the window was finished while the question was up", async () => {
		const save = vi.fn();
		stubAsk("save");
		const { app, state } = windowWith({ saveForNow: save });
		state.text = "x";
		const asking = mayClose(app);
		app.rendered = false;
		expect(await asking).toBe(false);
		expect(save).not.toHaveBeenCalled();
	});
});

describe("the dialog bases", () => {
	it("a stepper that's kept open leaves its promise and its window as they were", async () => {
		stubAsk("keep");
		const d = Object.create(StepperDialog.prototype);
		d._frontOnOpen = { stop: vi.fn() };
		d._resolve = vi.fn();
		const state = { text: "" };
		d._workState = () => state;
		notePristineWork(d);
		state.text = "x";
		await d.close();
		expect(d._frontOnOpen.stop).not.toHaveBeenCalled();
		expect(d._resolve).not.toHaveBeenCalled();
	});

	it("a stepper's finish closes without asking", async () => {
		const asked = stubAsk("keep");
		const d = Object.create(StepperDialog.prototype);
		d._frontOnOpen = { stop: vi.fn() };
		const resolve = vi.fn();
		d._resolve = resolve;
		const state = { text: "" };
		d._workState = () => state;
		notePristineWork(d);
		state.text = "x";
		d._resolveWith("seed");
		await Promise.resolve();
		expect(asked).not.toHaveBeenCalled();
		expect(d._frontOnOpen.stop).toHaveBeenCalled();
		expect(resolve).toHaveBeenCalledWith("seed");
	});

	it("a result dialog's finish closes without asking", async () => {
		const asked = stubAsk("keep");
		const d = Object.create(StonetopDialog.prototype);
		d._frontOnOpen = { stop: vi.fn() };
		d._cancelThrottledRender = () => {};
		const resolve = vi.fn();
		d._resultResolve = resolve;
		const state = { text: "" };
		d._workState = () => state;
		notePristineWork(d);
		state.text = "x";
		await d._resolveWith("done");
		expect(asked).not.toHaveBeenCalled();
		expect(resolve).toHaveBeenCalledWith("done");
	});
});

describe("what each walkthrough counts as written", () => {
	const touched = (app, change) => {
		notePristineWork(app);
		const before = hasUnsavedWork(app);
		change(app);
		return [before, hasUnsavedWork(app)];
	};

	it("Make a Site and Make a Hazard: any answer", () => {
		const site = Object.assign(Object.create(CreateSiteDialog.prototype), { _sel: { name: "", areas: [] } });
		expect(touched(site, a => { a._sel.areas.push({ title: "Gate" }); })).toEqual([false, true]);
		const hazard = Object.assign(Object.create(CreateHazardDialog.prototype), { _sel: { name: "", gmMoves: [] } });
		expect(touched(hazard, a => { a._sel.name = "Rockslide"; })).toEqual([false, true]);
	});

	it("a Thing Below, a corrupted site and a corrupted being: a pick counts as much as words", () => {
		const thing = Object.assign(Object.create(CreateThingDialog.prototype), {
			_preset: "", _name: "", _titlesText: "", _proximity: "distant", _themeIds: new Set(), _aspectIds: new Set(),
			_instinctId: null, _instinctCustom: "", _selectedMoves: new Set(), _customMoves: [""],
		});
		expect(touched(thing, a => { a._themeIds.add(1); })).toEqual([false, true]);
		const site = Object.assign(Object.create(CreateCorruptedSiteDialog.prototype), {
			_name: "", _terrain: "", _featureText: "", _proximity: "nearby", _themeIds: new Set(), _causeText: "",
			_causeIntent: "", _severityKey: "", _cleansingReqs: new Set(), _cleansingBinds: new Set(),
		});
		expect(touched(site, a => { a._terrain = "marsh"; })).toEqual([false, true]);
		const being = Object.assign(Object.create(CorruptBeingDialog.prototype), {
			_sourceId: "", _name: "", _instinct: "", _originText: "", _themeIds: new Set(), _aspectIds: new Set(),
			_giftIds: new Set(), _markIds: new Set(),
		});
		expect(touched(being, a => { a._giftIds.add(3); })).toEqual([false, true]);
	});

	it("Create a Follower: its answers", () => {
		const follower = Object.assign(Object.create(CreateFollowerDialog.prototype), { _sel: { name: "", tags: [] } });
		expect(touched(follower, a => { a._sel.tags.push("stealthy"); })).toEqual([false, true]);
	});

	it("the monster worksheet: what's on the form", () => {
		const form = { matches: () => true };
		const monster = Object.create(CreateMonsterDialog.prototype);
		monster.element = [form];
		let name = "";
		monster._readSelections = () => ({ name });
		expect(touched(monster, () => { name = "Crinwin"; })).toEqual([false, true]);
	});
});

describe("Save for now", () => {
	it("saves a new site from any step and says where to pick it up, unless the caller says so itself", async () => {
		const info = vi.fn();
		globalThis.ui = { notifications: { info } };
		const site = Object.create(CreateSiteDialog.prototype);
		site._page = null;
		site._finish = vi.fn(async () => {});
		await site._saveForNow();
		expect(site._finish).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledTimes(1);
		site._quietSave = true;
		await site._saveForNow();
		expect(info).toHaveBeenCalledTimes(1);
	});

	it("writes an edit straight to its page without the notice", async () => {
		const info = vi.fn();
		globalThis.ui = { notifications: { info } };
		const hazard = Object.create(CreateHazardDialog.prototype);
		hazard._page = { id: "p" };
		hazard._finish = vi.fn(async () => {});
		await hazard._saveForNow();
		expect(hazard._finish).toHaveBeenCalledTimes(1);
		expect(info).not.toHaveBeenCalled();
	});

	it("is on every step but the last, in both walkthroughs, and reads Save when editing", () => {
		for (const file of ["templates/dialogs/create-site.hbs", "templates/dialogs/create-hazard.hbs"]) {
			const hbs = readRepo(file);
			const nav = hbs.slice(hbs.indexOf('class="stonetop-guide-nav"'));
			const lastBranch = nav.slice(nav.indexOf("{{#if isLast}}"), nav.indexOf("{{else}}"));
			const otherSteps = nav.slice(nav.indexOf("{{else}}"), nav.indexOf("{{/if}}\n  </div>"));
			expect(lastBranch).not.toContain("stonetop-guide-save-for-now");
			expect(otherSteps).toContain("stonetop-guide-save-for-now");
			expect(otherSteps).toMatch(/\{\{#if isEdit\}\}Save\{\{else\}\}Save for now\{\{\/if\}\}/);
		}
	});

	it("is wired in both walkthroughs", () => {
		for (const file of ["module/sites/create-site-dialog.js", "module/hazards/create-hazard-dialog.js"]) {
			expect(readRepo(file)).toContain(`html.find(".stonetop-guide-save-for-now").on("click", () => this._saveForNow());`);
		}
	});
});
