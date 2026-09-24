import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createFightTrackerClass, fighterDragType } from "../../module/fight/FightTracker.js";
import { FIGHT_OVER, FIGHT_WINDOW_WIDTH, noteFightWindowClosed, openFightWindow, rememberFightWindowPosition } from "../../module/fight/fight-window.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";
import { stubConfirm } from "../fakes/confirm.js";

// The Fight tab's class, over a stand-in for core's CombatTracker.

// What the window does with a close, a move and a press of "Open in a window" is fight-window.js's
// business, tested there; here only that the class hands each one over.
vi.mock("../../module/fight/fight-window.js", async importOriginal => ({
	...(await importOriginal()),
	noteFightWindowClosed: vi.fn(),
	rememberFightWindowPosition: vi.fn(),
	openFightWindow: vi.fn(),
}));

const ROOT = path.resolve(import.meta.dirname, "../..");

class FakeCombatTracker {
	static DEFAULT_OPTIONS = { actions: { activateCombatant: () => {}, toggleHidden: () => {} } };
	static PARTS = { header: {}, tracker: {}, footer: {} };
	constructor(options = {}) {
		this.options = this._initializeApplicationOptions(options);
		this.position = { ...this.options.position };
		this.minimized = false;
		this.viewed = null; this.combats = []; this.renders = []; this.rendered = true; this.closes = [];
	}
	/** Core's merge, as far as this class reads it: the sidebar tab's own options, framed when popped out. */
	_initializeApplicationOptions(options) {
		return {
			classes: ["tab", "sidebar-tab", "combat-sidebar", ...(options.classes ?? [])],
			window: { frame: false, ...options.window },
			position: { width: "auto", height: "auto", ...options.position },
		};
	}
	get isPopout() { return !!this.options.window.frame; }
	async _getCombatantThumbnail(combatant) { return combatant.img || "icons/svg/mystery-man.svg"; }
	async _preFirstRender() { this.preFirst = true; }
	_attachFrameListeners() {}
	_onPosition() {}
	_updatePosition(position) { return position; }
	_onClose(options) { this.closes.push(options); }
	render(options) { this.renders.push(options); }
}

const FightTracker = createFightTrackerClass(FakeCombatTracker);

/** What marks a Fight window with a height in numbers, which the stylesheet's room-below cap leaves alone. */
const SIZED = "data-stonetop-fight-sized";

/** The pop-out's frame, as far as the position code touches it: its style's custom properties and its attributes. */
function fakeFrame() {
	const vars = new Map();
	const attributes = new Set();
	return {
		vars,
		style: { setProperty: (name, value) => vars.set(name, value) },
		toggleAttribute: (name, on) => { if (on) attributes.add(name); else attributes.delete(name); return on; },
		hasAttribute: name => attributes.has(name),
	};
}

let saved;
let settings;
beforeEach(() => {
	saved = { game: globalThis.game, canvas: globalThis.canvas, foundry: globalThis.foundry };
	settings = new Map();
	globalThis.game = {
		...saved.game,
		user: { id: "gm", isGM: true, hasPermission: () => true },
		users: collection([]),
		combats: collection([]),
		settings: {
			get: (scope, key) => { if (!settings.has(key)) throw new Error("unregistered"); return settings.get(key); },
			set: async (scope, key, value) => { settings.set(key, value); return value; },
		},
	};
});
afterEach(() => {
	globalThis.game = saved.game;
	globalThis.canvas = saved.canvas;
	globalThis.foundry = saved.foundry;
});

function oneFight() {
	const bram = fakeToken({ id: "tBram", col: 0, row: 0, actor: fakeActor({ id: "bram", type: "character" }) });
	const crinwin = fakeToken({ id: "tCrin", col: 1, row: 0, actor: fakeActor({ id: "crinwin", type: "monster" }) });
	const scene = fakeScene({ tokens: [bram, crinwin] });
	const cBram = fakeCombatant({ id: "cBram", token: bram, scene, side: "heroes" });
	const cCrin = fakeCombatant({ id: "cCrin", token: crinwin, scene });
	const combat = fakeCombat({ scene, combatants: [cBram, cCrin] });
	combat.update = vi.fn(async () => combat);
	combat.delete = vi.fn(async () => combat);
	for (const c of [cBram, cCrin]) c.update = vi.fn(async changes => { Object.assign(c, { lastUpdate: changes }); });
	return { scene, combat, cBram, cCrin };
}

describe("the Fight tab class", () => {
	it("draws only a header and a tracker, from templates that exist", () => {
		expect(Object.keys(FightTracker.PARTS)).toEqual(["header", "tracker"]);
		for (const part of Object.values(FightTracker.PARTS)) {
			const file = part.template.replace(/^systems\/stonetop-pwd\//, "");
			expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
		}
		expect(FightTracker.PARTS.tracker.scrollable).toEqual([""]);
	});

	it("adds its own actions and leaves core's to the merge", () => {
		expect(Object.keys(FightTracker.DEFAULT_OPTIONS.actions).sort()).toEqual(
			["addToFight", "endFight", "lineUpFight", "openFightWindow", "startFight", "stopRounds"],
		);
		expect(FightTracker.name).toBe("FightTracker");
	});

	it("waits for the partial preload before its first draw", async () => {
		let release;
		globalThis.game.stonetop = { templatesReady: new Promise(resolve => { release = resolve; }) };
		const tab = new FightTracker();
		const drawing = tab._preFirstRender({}, {});
		await Promise.resolve();
		expect(tab.preFirst).toBeUndefined();
		release();
		await drawing;
		expect(tab.preFirst).toBe(true);
	});

	it("builds a header with no initiative, rounds or turn state in it", async () => {
		const { combat } = oneFight();
		const tab = new FightTracker();
		tab.viewed = combat;
		tab.combats = [combat, fakeCombat({ id: "second" })];
		const context = {};
		await tab._prepareCombatContext(context, {});
		expect(context).toMatchObject({ hasCombat: true, isGM: true, isPopout: false, roundsStarted: false });
		expect(context.cycle).toEqual({ text: "Fight 1 of 2", previousId: "", nextId: "second" });
		for (const key of ["turns", "initiativeIcon", "control", "hasDecimals"]) expect(context).not.toHaveProperty(key);
	});

	it("builds the engagements for the tracker, and remembers what it drew", async () => {
		const { combat } = oneFight();
		const tab = new FightTracker();
		tab.viewed = combat;
		const context = {};
		await tab._prepareTrackerContext(context, {});
		expect(context.fight.clusters).toHaveLength(1);
		expect(context.fight.clusters[0].heroes[0]).toMatchObject({ id: "cBram", readout: "fighting crinwin" });
		expect(tab.fightSignature).toContain("cBram");
	});

	it("gives a player a hold on their own character and on any monster, each to send at the other side", async () => {
		const { combat, cBram } = oneFight();
		cBram.isOwner = true;
		globalThis.canvas = { scene: combat.scene, tokens: { controlled: [] } };
		globalThis.game.user = { id: "player", isGM: false, hasPermission: () => true };
		const tab = new FightTracker();
		tab.viewed = combat;
		const context = {};
		await tab._prepareTrackerContext(context, {});
		const [pair] = context.fight.clusters[0].pairs;
		expect(pair.hero).toMatchObject({ id: "cBram", draggable: true, dropTarget: true });
		expect(pair.foes[0]).toMatchObject({ id: "cCrin", draggable: true, dropTarget: true });
	});

	it("has nothing to draw with no fight", async () => {
		const tab = new FightTracker();
		const context = {};
		await tab._prepareTrackerContext(context, {});
		expect(context.fight).toBeNull();
	});

	it("offers GM tools in both context-menu spellings, and nothing about initiative", () => {
		const { combat, cCrin } = oneFight();
		const tab = new FightTracker();
		tab.viewed = combat;
		const entries = tab._getEntryContextOptions();
		expect(entries.map(e => e.label)).toEqual([
			"stonetop.fight.menu.switchSide", "stonetop.fight.menu.headcount", "stonetop.fight.menu.stopShooting",
			"stonetop.fight.scale.menuMerge", "stonetop.fight.scale.menuSplit",
			"stonetop.fight.menu.openSheet", "stonetop.fight.menu.remove",
		]);
		for (const entry of entries) {
			expect(entry.name).toBe(entry.label);
			expect(typeof entry.onClick).toBe("function");
			expect(typeof entry.callback).toBe("function");
			expect(entry.condition).toBe(entry.visible);
		}
		const li = { dataset: { combatantId: "cCrin" } };
		expect(entries[0].visible(li)).toBe(true);
		globalThis.game.user = { id: "player", isGM: false };
		expect(entries[0].visible(li)).toBe(false);
		expect(entries[6].visible(li)).toBe(false);
		// One crinwin, fighting as itself, with no shot on record: nothing to stop, nothing to merge it
		// with, and no group to split.
		globalThis.game.user = { id: "gm", isGM: true };
		globalThis.canvas = { scene: combat.scene, tokens: { controlled: [] } };
		expect(entries[2].visible(li)).toBe(false);
		expect(entries[3].visible(li)).toBe(false);
		expect(entries[4].visible(li)).toBe(false);
		cCrin.flags[SYSTEM_ID].shots = ["cBram"];
		expect(entries[2].visible(li)).toBe(true);
		expect(tab._getCombatContextOptions()).toEqual([]);
		expect(cCrin).toBeTruthy();
	});

	it("moves a combatant to the other side", async () => {
		const { combat, cCrin } = oneFight();
		const tab = new FightTracker();
		tab.viewed = combat;
		const [switchSide] = tab._getEntryContextOptions();
		await switchSide.onClick({}, { dataset: { combatantId: "cCrin" } });
		expect(cCrin.update).toHaveBeenCalledWith({ [`flags.${SYSTEM_ID}.side`]: "heroes" });
	});

	it("hides the headcount from a group monster, whose sheet counts its members", () => {
		const { combat, scene } = oneFight();
		const horde = fakeCombatant({
			id: "cHorde", scene,
			token: fakeToken({ id: "tH", actor: fakeActor({ id: "h", type: "monster", system: { organization: "horde", fightAsGroup: true } }) }),
		});
		combat.combatants = collection([...combat.combatants, horde]);
		const tab = new FightTracker();
		tab.viewed = combat;
		const headcount = tab._getEntryContextOptions()[1];
		expect(headcount.visible({ dataset: { combatantId: "cHorde" } })).toBe(false);
		expect(headcount.visible({ dataset: { combatantId: "cBram" } })).toBe(true);
	});

	it("ends the fight only when the GM confirms", async () => {
		const { combat } = oneFight();
		// A foundry of its own, so the fake window goes with it when afterEach puts the real one back.
		globalThis.foundry = { ...saved.foundry, applications: { api: {} } };
		const kept = stubConfirm(false);
		const hadDocument = "document" in globalThis;
		const previous = globalThis.document;
		globalThis.document = { createElement: tag => ({ tagName: tag.toUpperCase(), innerHTML: "" }) };
		try {
			const tab = new FightTracker();
			tab.viewed = combat;
			await FightTracker.DEFAULT_OPTIONS.actions.endFight.call(tab);
			expect(combat.delete).not.toHaveBeenCalled();
			const asked = kept.mock.calls[0][0];
			expect(asked.buttons.map(b => b.label)).toEqual(["End the fight", "Keep fighting"]);
			expect(asked.classes).toEqual(expect.arrayContaining(["stonetop"]));
			// Enter keeps fighting, as core's confirm had it.
			expect(asked.buttons.find(b => b.default)?.action).toBe("no");
			expect(asked.content.innerHTML).toContain("Tokens stay where they are.");
			stubConfirm(true);
			await FightTracker.DEFAULT_OPTIONS.actions.endFight.call(tab);
			expect(combat.delete).toHaveBeenCalledTimes(1);
		} finally {
			if (hadDocument) globalThis.document = previous;
			else delete globalThis.document;
		}
	});

	it("never lets a player end a fight", async () => {
		const { combat } = oneFight();
		globalThis.foundry = { ...saved.foundry, applications: { api: {} } };
		const asked = stubConfirm(true);
		globalThis.game.user = { id: "player", isGM: false };
		const tab = new FightTracker();
		tab.viewed = combat;
		await FightTracker.DEFAULT_OPTIONS.actions.endFight.call(tab);
		expect(asked).not.toHaveBeenCalled();
		expect(combat.delete).not.toHaveBeenCalled();
	});

	it("stops a combat started in core's tracker from counting rounds", async () => {
		const { combat } = oneFight();
		const tab = new FightTracker();
		tab.viewed = combat;
		await FightTracker.DEFAULT_OPTIONS.actions.stopRounds.call(tab);
		expect(combat.update).toHaveBeenCalledWith({ round: 0, turn: null });
	});

	describe("dragging a fighter onto one on the other side", () => {
		/** A row as far as the handlers read it: both a drag source and a drop target, as the tab's are. */
		const fakeRow = (id, side) => {
			const classes = new Set();
			const row = {
				dataset: { combatantId: id, fightDrag: side, fightDrop: side },
				classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
				contains: node => node === row,
				closest: selector => (["[data-fight-drag]", "[data-fight-drop]"].includes(selector) ? row : null),
			};
			return row;
		};
		const transfer = () => {
			const data = new Map();
			return { setData: (t, v) => data.set(t, v), getData: t => data.get(t) ?? "", get types() { return [...data.keys()]; } };
		};

		/** Drag one row onto another, all the way through, and say what the target did about it. */
		const dragOnto = (tab, from, onto) => {
			const dataTransfer = transfer();
			tab._onFightDragStart({ target: from, dataTransfer });
			const over = { target: onto, dataTransfer, preventDefault: vi.fn() };
			tab._onFightDragOver(over);
			const lit = onto.classList.contains("is-drop-target");
			const drop = { target: onto, dataTransfer, preventDefault: vi.fn() };
			tab._onFightDrop(drop);
			return { dataTransfer, lit, tookIt: over.preventDefault.mock.calls.length > 0 };
		};

		it("carries the dragged row's id, lights the row it is over, and sends it on the drop, either way about", async () => {
			const { combat } = oneFight();
			const sendAgainst = vi.fn();
			globalThis.game.stonetop = { fight: { sendAgainst } };
			const tab = new FightTracker();
			tab.viewed = combat;
			const foe = fakeRow("cCrin", "foes");
			const hero = fakeRow("cBram", "heroes");

			const sent = dragOnto(tab, foe, hero);
			// Under the dragged row's own side, which is the only type a row on the other side reads.
			expect(sent.dataTransfer.getData(fighterDragType("foes"))).toBe("cCrin");
			expect(foe.classList.contains("is-dragging")).toBe(true);
			expect(sent).toMatchObject({ lit: true, tookIt: true });
			expect(hero.classList.contains("is-drop-target")).toBe(false);
			expect(sendAgainst).toHaveBeenLastCalledWith(combat, "cCrin", "cBram");

			// And the other way: the hero picked up is the one that moves.
			expect(dragOnto(tab, hero, foe)).toMatchObject({ lit: true, tookIt: true });
			expect(sendAgainst).toHaveBeenLastCalledWith(combat, "cBram", "cCrin");
		});

		it("takes no drag that is not a fighter's row, and none onto its own side", () => {
			const sendAgainst = vi.fn();
			globalThis.game.stonetop = { fight: { sendAgainst } };
			const tab = new FightTracker();
			const hero = fakeRow("cBram", "heroes");
			const foreign = { target: hero, dataTransfer: { types: ["text/plain"] }, preventDefault: vi.fn() };
			tab._onFightDragOver(foreign);
			expect(foreign.preventDefault).not.toHaveBeenCalled();

			expect(dragOnto(tab, fakeRow("cW1", "foes"), fakeRow("cW2", "foes"))).toMatchObject({ lit: false, tookIt: false });
			expect(dragOnto(tab, hero, fakeRow("cAel", "heroes"))).toMatchObject({ lit: false, tookIt: false });
			expect(sendAgainst).not.toHaveBeenCalled();
		});
	});

	it("hands Start, Add and Line up to the fight's own functions", () => {
		const { combat } = oneFight();
		const openStart = vi.fn();
		const lineUp = vi.fn();
		globalThis.game.stonetop = { fight: { openStart, lineUp } };
		const tab = new FightTracker();
		tab.viewed = combat;
		FightTracker.DEFAULT_OPTIONS.actions.startFight.call(tab);
		FightTracker.DEFAULT_OPTIONS.actions.addToFight.call(tab);
		FightTracker.DEFAULT_OPTIONS.actions.lineUpFight.call(tab);
		expect(openStart.mock.calls).toEqual([[], [{ combat }]]);
		expect(lineUp).toHaveBeenCalledWith(combat);
	});
});

describe("the Fight window, the tab popped out", () => {
	let savedWindow;
	beforeEach(() => {
		savedWindow = { document: globalThis.document, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
		globalThis.innerWidth = 1920;
		globalThis.innerHeight = 1080;
		globalThis.document = { getElementById: id => (id === "sidebar" ? { getBoundingClientRect: () => ({ width: 300, left: 1620 }) } : null) };
		vi.mocked(noteFightWindowClosed).mockClear();
		vi.mocked(rememberFightWindowPosition).mockClear();
		vi.mocked(openFightWindow).mockClear();
	});
	afterEach(() => Object.assign(globalThis, savedWindow));

	/** What core's renderPopout builds from the tab's options, when the Fight tab was the open one. */
	const popOut = () => new FightTracker({
		id: "combat-popout", classes: ["active", "sidebar-popout"], window: { frame: true, positioned: true, minimizable: true },
	});

	it("opens beside the sidebar, resizable, with a swords icon", () => {
		const popout = popOut();
		expect(popout.isPopout).toBe(true);
		expect(popout.options.window).toMatchObject({ frame: true, resizable: true, icon: "fa-solid fa-swords" });
		expect(popout.options.position).toEqual({ width: FIGHT_WINDOW_WIDTH, height: "auto", left: 1620 - FIGHT_WINDOW_WIDTH - 16, top: 16 });
	});

	it("drops the tab's `active` class, which core's CSS gives no height, and adds no stonetop class", () => {
		const classes = popOut().options.classes;
		expect(classes).toContain("sidebar-popout");
		expect(classes).not.toContain("active");
		expect(classes.filter(name => name.startsWith("stonetop"))).toEqual([]);
	});

	it("leaves the sidebar tab's own options as core made them", () => {
		const tab = new FightTracker({ classes: ["active"] });
		expect(tab.options.window).toEqual({ frame: false });
		expect(tab.options.classes).toContain("active");
		expect(tab.options.position).toEqual({ width: "auto", height: "auto" });
	});

	it("remembers where the window is moved, but not where a minimized window or the tab reports", () => {
		const popout = popOut();
		popout.position = { left: 30, top: 40, width: 400, height: "auto" };
		popout._onPosition(popout.position);
		expect(rememberFightWindowPosition).toHaveBeenCalledWith({ left: 30, top: 40, width: 400, height: "auto" });
		popout.minimized = true;
		popout._onPosition(popout.position);
		new FightTracker()._onPosition({});
		expect(rememberFightWindowPosition).toHaveBeenCalledTimes(1);
	});

	it("keeps the window shut for this fight when the reader closes it, but not when the fight ended", () => {
		const popout = popOut();
		popout._onClose({});
		expect(noteFightWindowClosed).toHaveBeenCalledTimes(1);
		popout._onClose({ [FIGHT_OVER]: true });
		expect(noteFightWindowClosed).toHaveBeenCalledTimes(1);
		expect(popout.closes).toEqual([{}, { [FIGHT_OVER]: true }]);
	});

	it("tells the header it is the window, which has no button to open itself", async () => {
		const context = {};
		await popOut()._prepareCombatContext(context, {});
		expect(context.isPopout).toBe(true);
	});

	it("goes back to fitting its content when restored from minimized, unless the reader sized it", async () => {
		/** Core's maximize: the window back at the height it had, in numbers (ApplicationV2#maximize). */
		class Restoring extends FakeCombatTracker {
			async maximize() { this.minimized = false; this.setPosition({ width: 400, height: 512 }); }
			setPosition(position) { this.moves = [...(this.moves ?? []), position]; Object.assign(this.position, position); }
		}
		const Tracker = createFightTrackerClass(Restoring);
		const open = () => Object.assign(new Tracker({ id: "combat-popout", window: { frame: true, positioned: true } }), { minimized: true });
		const fitting = open();
		await fitting.maximize();
		expect(fitting.moves.at(-1)).toEqual({ height: "auto" });
		const sized = open();
		sized.options.position.height = 512;
		await sized.maximize();
		expect(sized.moves).toEqual([{ width: 400, height: 512 }]);
	});

	it("keeps no height for a window fitting its content, though core hands one back when it is restored from minimized", () => {
		const popout = popOut();
		popout.position = { left: 30, top: 40, width: 400, height: 512 };
		popout._onPosition(popout.position);
		expect(rememberFightWindowPosition).toHaveBeenLastCalledWith({ left: 30, top: 40, width: 400, height: "auto" });
		// The reader drags it to a size: core writes the height into the options as the drag starts.
		popout.options.position.height = 512;
		popout._onPosition(popout.position);
		expect(rememberFightWindowPosition).toHaveBeenLastCalledWith({ left: 30, top: 40, width: 400, height: 512 });
	});

	it("holds a window fitting its content to the room below where it stands, and marks one the reader sized", () => {
		const popout = popOut();
		popout.element = fakeFrame();
		expect(popout._updatePosition({ top: 120.4, height: "auto" })).toEqual({ top: 120.4, height: "auto" });
		expect(popout.element.vars.get("--stonetop-fight-top")).toBe("120px");
		expect(popout.element.hasAttribute(SIZED)).toBe(false);
		// A height in numbers the reader never gave it (core's restore from minimized) is not a size.
		popout._updatePosition({ top: 120, height: 600 });
		expect(popout.element.hasAttribute(SIZED)).toBe(false);
		popout.options.position.height = 600;
		popout._updatePosition({ top: 120, height: 600 });
		expect(popout.element.hasAttribute(SIZED)).toBe(true);
		const tab = new FightTracker();
		tab.element = fakeFrame();
		tab._updatePosition({ top: 50, height: 300 });
		expect(tab.element.vars.size).toBe(0);
		expect(tab.element.hasAttribute(SIZED)).toBe(false);
	});

	describe("dragged toward the foot of the screen", () => {
		/**
		 * Core's setPosition and height clamp (ApplicationV2, v13 and v14 alike) on a 1080px screen, with
		 * the stylesheet's room-below cap standing in for getComputedStyle: it applies to a frame not
		 * marked sized, as styles/stonetop.css scopes it.
		 */
		class CoreClamp extends FakeCombatTracker {
			contentHeight = 900;
			setPosition(position) {
				position = Object.assign(this.position, position);
				Object.assign(this.position, this._updatePosition(position));
				this._onPosition(position);
				return position;
			}
			_updatePosition(position) {
				const screen = 1080;
				const standsAt = Number.parseInt(this.element.vars.get("--stonetop-fight-top") ?? "16", 10);
				const cap = this.element.hasAttribute(SIZED) ? screen : Math.max(240, screen - standsAt - 16);
				let { height, top } = position;
				if (height !== "auto") height = Math.min(height, cap);
				const shown = height === "auto" ? Math.min(this.contentHeight, cap) : height;
				top = Math.min(Math.max(0, top), Math.max(0, screen - shown));
				return { ...position, height, top };
			}
		}
		const Clamped = createFightTrackerClass(CoreClamp);
		const clampedPopOut = () => {
			const popout = new Clamped({ id: "combat-popout", classes: ["sidebar-popout"], window: { frame: true, positioned: true } });
			popout.element = fakeFrame();
			return popout;
		};

		it("keeps a height the reader chose, going down and coming back up, and saves that height", () => {
			const popout = clampedPopOut();
			popout.options.position.height = 700;
			popout.setPosition({ top: 16, height: 700 });
			// Each frame of a drag asks for the height the drag started with; core slides the window up to fit.
			popout.setPosition({ top: 616, height: popout.position.height });
			expect(popout.position).toMatchObject({ top: 380, height: 700 });
			popout.setPosition({ top: 16, height: popout.position.height });
			expect(popout.position).toMatchObject({ top: 16, height: 700 });
			expect(rememberFightWindowPosition).toHaveBeenLastCalledWith(expect.objectContaining({ top: 16, height: 700 }));
		});

		it("lets a window fitting its content shrink with the room and grow back, saving no height", () => {
			const popout = clampedPopOut();
			popout.setPosition({ top: 900, height: "auto" });
			expect(popout.position).toMatchObject({ top: 840, height: "auto" });
			popout.setPosition({ top: 16, height: "auto" });
			expect(popout.position).toMatchObject({ top: 16, height: "auto" });
			expect(rememberFightWindowPosition).toHaveBeenLastCalledWith(expect.objectContaining({ top: 16, height: "auto" }));
		});
	});

	it("opens from the tab's button as the reader's own choice", () => {
		FightTracker.DEFAULT_OPTIONS.actions.openFightWindow.call(new FightTracker());
		expect(openFightWindow).toHaveBeenCalledWith({ byHand: true });
	});
});

describe("the Fight tab source", () => {
	it("never puts a stonetop class on the sidebar tab itself", () => {
		const src = fs.readFileSync(path.join(ROOT, "module/fight/FightTracker.js"), "utf8");
		const options = src.slice(src.indexOf("static DEFAULT_OPTIONS"), src.indexOf("static PARTS"));
		expect(options).not.toMatch(/classes/);
	});

	it("holds only a Fight window fitting its content to the room below it", () => {
		const css = fs.readFileSync(path.join(ROOT, "styles/stonetop.css"), "utf8");
		const at = css.indexOf("var(--stonetop-fight-top");
		const selector = css.slice(css.lastIndexOf("*/", at), css.lastIndexOf("{", at));
		expect(selector).toContain(`:not([${SIZED}])`);
	});
});
