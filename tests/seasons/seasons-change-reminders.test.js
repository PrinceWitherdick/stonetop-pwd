import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	collectSeasonalReminders,
	laboratoryNewlySelected,
	naphthaSpentAfter,
	offeringsRestoreUpdate,
	postSeasonsChangeReminder,
	rollForBezoar,
	rollNaphthaYield,
	BENDIS_ROOT_SLUG,
	remindersForActor,
	seasonsReminderCard,
	wireSeasonsReminderResets,
	SEASONAL_REMINDERS,
} from "../../module/seasons/seasons-change-reminders.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// A minimal stand-in for a character actor: `move` names become embedded move
// Items, and `possessions` become the selected special-possession slugs (the
// flags.stonetop-pwd.possessions.selected array the production flag reads).
function fakeCharacter({ name = "Test PC", moves = [], possessions = [], type = "character" } = {}) {
	return {
		name,
		type,
		items: moves.map(name => ({ type: "move", name })),
		getFlag: (scope, key) =>
			scope === "stonetop-pwd" && key === "possessions.selected" ? possessions : undefined,
	};
}

const names = list => list.map(r => r.label ?? r.name);

describe("remindersForActor", () => {
	it("matches a seasonal playbook move by name", () => {
		const actor = fakeCharacter({ moves: ["Rites of the Land", "Consecrated Ground"] });
		expect(names(remindersForActor(actor))).toEqual(["Rites of the Land"]);
	});

	it("matches seasonal possessions by selected slug", () => {
		const actor = fakeCharacter({ possessions: ["collected-offerings", "goat-herd", "apiary"] });
		expect(names(remindersForActor(actor)).sort()).toEqual(["Collected offerings", "Goat herd"]);
	});

	// Holy relics has NO seasonal rule in the book: not in Book I, not in Book II's Helior
	// entry, not on the Lightbearer playbook. Its uses are a one-way pool. It was listed here
	// with an invented "Restore 1 use this season" (and an effect belonging to Piety), so the
	// public card taught the table two rules that do not exist. This is what keeps it out.
	it("does not invent a seasonal refresh for Holy relics", () => {
		const actor = fakeCharacter({ possessions: ["holy-relics"] });
		expect(remindersForActor(actor)).toEqual([]);
	});

	// "Each SPRING, d4 uses of bendis root": the one entry that is not every-season.
	it("matches the spring-only Herb garden in spring, and not otherwise", () => {
		const actor = fakeCharacter({ possessions: ["herb-garden"] });
		expect(names(remindersForActor(actor, "spring"))).toEqual(["Herb garden"]);
		expect(remindersForActor(actor, "autumn")).toEqual([]);
	});

	// A caller that names no season is asking "what does this PC carry?", not "what fires
	// now", so the season-limited entries are all in.
	it("lists season-limited upkeep when no season is given", () => {
		const actor = fakeCharacter({ possessions: ["herb-garden"] });
		expect(names(remindersForActor(actor))).toEqual(["Herb garden"]);
	});

	it("keeps the every-season entries in a season the garden misses", () => {
		const actor = fakeCharacter({ possessions: ["goat-herd", "herb-garden"] });
		expect(names(remindersForActor(actor, "winter"))).toEqual(["Goat herd"]);
	});

	it("combines a move and a possession on the same character", () => {
		const actor = fakeCharacter({ moves: ["Rites of the Land"], possessions: ["goat-herd"] });
		expect(names(remindersForActor(actor)).sort()).toEqual(["Goat herd", "Rites of the Land"]);
	});

	it("returns nothing for a character with no seasonal upkeep", () => {
		const actor = fakeCharacter({ moves: ["Consecrated Ground"], possessions: ["apiary"] });
		expect(remindersForActor(actor)).toEqual([]);
	});

	it("ignores non-character actors", () => {
		const actor = fakeCharacter({ moves: ["Rites of the Land"], type: "stonetop" });
		expect(remindersForActor(actor)).toEqual([]);
	});

	it("tolerates a character with no selected-possessions flag", () => {
		const actor = { type: "character", items: [], getFlag: () => undefined };
		expect(remindersForActor(actor)).toEqual([]);
	});
});

describe("collectSeasonalReminders", () => {
	it("tags each matched reminder with its owning character", () => {
		const reminders = collectSeasonalReminders([
			fakeCharacter({ name: "Brother Hale", moves: ["Rites of the Land"], possessions: ["collected-offerings"] }),
			fakeCharacter({ name: "Mira", possessions: ["goat-herd"] }),
		]);
		expect(reminders).toEqual([
			expect.objectContaining({ character: "Brother Hale", name: "Rites of the Land" }),
			expect.objectContaining({ character: "Brother Hale", name: "Collected offerings" }),
			expect.objectContaining({ character: "Mira", name: "Goat herd" }),
		]);
	});

	it("skips characters with no seasonal upkeep", () => {
		const reminders = collectSeasonalReminders([
			fakeCharacter({ name: "Eaglewise", moves: ["Consecrated Ground"], possessions: ["apiary"] }),
		]);
		expect(reminders).toEqual([]);
	});
});

// Code review 10-22 (HC-9): the table's card is for the characters still in play, not the dead or retired.
describe("postSeasonsChangeReminder", () => {
	it("posts upkeep only for the characters still in play", () => {
		const pc = (id, flags = {}) => ({
			id, name: id, type: "character", items: [], system: { playbook: { slug: "the-blessed" } },
			flags: { "stonetop-pwd": { "possessions": { selected: ["collected-offerings"] }, ...flags } },
			getFlag: (scope, key) => (scope === "stonetop-pwd" && key === "possessions.selected" ? ["collected-offerings"] : undefined),
		});
		const saved = { actors: globalThis.game.actors, ChatMessage: globalThis.ChatMessage };
		globalThis.game.actors = { contents: [pc("Hale"), pc("Gone", { deathsDoor: "dead" }), pc("Away", { leftPlay: { how: "retired" } })] };
		globalThis.ChatMessage = { create: vi.fn() };
		try {
			postSeasonsChangeReminder("spring");
			const content = globalThis.ChatMessage.create.mock.calls[0][0].content;
			expect(content).toContain("Hale");
			expect(content).not.toContain("Gone");
			expect(content).not.toContain("Away");
		} finally {
			globalThis.game.actors = saved.actors;
			globalThis.ChatMessage = saved.ChatMessage;
		}
	});
});

describe("seasonsReminderCard", () => {
	it("renders the season hero and one item per reminder", () => {
		const html = seasonsReminderCard("autumn", collectSeasonalReminders([
			fakeCharacter({ name: "Brother Hale", possessions: ["collected-offerings"] }),
		]));
		expect(html).toContain("The Seasons Change");
		expect(html).toContain("Autumn");
		expect(html).toContain("fall_icon.svg"); // autumn maps to the "fall" art
		expect(html).toContain("Brother Hale");
		expect(html).toContain("Collected offerings");
		expect(html).toContain("Restore 1 use this season");
	});
});

// Seeker audit (2026-09-26): the user's ruling is a "Reset logbook" button on the Logbook's row, for the
// Seeker's own player (or a GM), writing the Seeker's own track: 0 spent, which is 2 uses left. And a
// Logbook kept on the sheet un-learned has no upkeep at all.
describe("the Logbook's reset button", () => {
	const seeker = (extra = {}) => ({ ...fakeCharacter({ name: "Maelis", moves: ["Logbook"] }), id: "seeker1", ...extra });

	it("lists no upkeep for an un-learned move", () => {
		const actor = { ...seeker(), items: [{ type: "move", name: "Logbook", flags: { "stonetop-pwd": { learned: false } } }] };
		expect(remindersForActor(actor)).toEqual([]);
	});

	it("draws the button on the Logbook's row alone, naming the character", () => {
		const html = seasonsReminderCard("spring", collectSeasonalReminders([
			seeker(), { ...fakeCharacter({ name: "Brother Hale", moves: ["Rites of the Land"] }), id: "hale1" },
		]));
		expect(html.match(/stonetop-seasons-reset-btn/g)).toHaveLength(1);
		expect(html).toContain('data-reset="logbook" data-actor-id="seeker1"');
		expect(html).toContain("Reset logbook (2 uses)");
	});

	function rig({ isOwner = true, resetFrom = null } = {}) {
		const update = vi.fn(async () => {});
		const actor = {
			...seeker(), isOwner, update,
			getFlag: (scope, key) => (key === "logbookResetCard" ? resetFrom : undefined),
			typedActor: { moveResources: { usesUpdate: (move, value) => ({ [`flags.stonetop-pwd.backgroundChoices.${move}`]: value }) } },
		};
		const listeners = {};
		const btn = {
			dataset: { reset: "logbook", actorId: "seeker1" }, disabled: false, innerHTML: "",
			remove: vi.fn(), addEventListener: (type, fn) => { listeners[type] = fn; },
		};
		const html = { querySelectorAll: () => [btn] };
		const actors = { get: id => (id === "seeker1" ? actor : undefined) };
		return { actor, btn, html, actors, update, click: () => listeners.click?.() };
	}

	it("resets the track to 0 spent for the owner, and notes the card so it cannot reset twice", async () => {
		const { btn, html, actors, update, click } = rig();
		wireSeasonsReminderResets({ id: "msg1" }, html, { actors });
		expect(btn.remove).not.toHaveBeenCalled();
		await click();
		expect(update).toHaveBeenCalledWith(
			{ "flags.stonetop-pwd.backgroundChoices.Logbook": 0, "flags.stonetop-pwd.logbookResetCard": "msg1" },
			{ stonetopMove: "Logbook" });
		expect(btn.disabled).toBe(true);
		expect(btn.innerHTML).toContain("Logbook reset");
	});

	it("is taken off the card for anyone who does not own the Seeker", () => {
		const { btn, html, actors } = rig({ isOwner: false });
		wireSeasonsReminderResets({ id: "msg1" }, html, { actors });
		expect(btn.remove).toHaveBeenCalled();
	});

	it("renders spent once this card has reset the logbook", () => {
		const { btn, html, actors, click } = rig({ resetFrom: "msg1" });
		wireSeasonsReminderResets({ id: "msg1" }, html, { actors });
		expect(btn.disabled).toBe(true);
		expect(click()).toBeUndefined();
	});
});

// Seeker audit C1: the Laboratory's row rolls "d4-1 uses of naphtha" for its owner and ADDS the
// rolled uses to what is left on the naphtha item's track (inventory tracks count SPENT; the user's
// ruling of 2026-10-18), up to its ○○○.
describe("the Laboratory's naphtha button", () => {
	function rig(total, spent) {
		const update = vi.fn(async () => {});
		const base = fakeCharacter({ name: "Maelis", possessions: ["laboratory"] });
		const getFlag = (scope, key) => key === "inventory.resources"
			? (spent === undefined ? undefined : { naphtha: spent })
			: base.getFlag(scope, key);
		const actor = { ...base, getFlag, id: "seeker1", isOwner: true, update };
		const listeners = {};
		const btn = {
			dataset: { reset: "naphtha", actorId: "seeker1" }, disabled: false, innerHTML: "",
			remove: vi.fn(), addEventListener: (type, fn) => { listeners[type] = fn; },
		};
		const toMessage = vi.fn(async () => {});
		globalThis.Roll = class { constructor(f) { this.formula = f; this.total = total; } async evaluate() { return this; } toMessage(d) { return toMessage(this.formula, d); } };
		return { actor, btn, update, toMessage, html: { querySelectorAll: () => [btn] }, actors: { get: () => actor }, click: () => listeners.click?.() };
	}

	it("draws a roll button on the Laboratory's row", () => {
		const html = seasonsReminderCard("spring", collectSeasonalReminders([
			{ ...fakeCharacter({ name: "Maelis", possessions: ["laboratory"] }), id: "seeker1" },
		]));
		expect(html).toContain('data-reset="naphtha" data-actor-id="seeker1"');
		expect(html).toContain("Roll d4-1 naphtha");
	});

	it("rolls d4-1 to chat and adds the rolled uses to what is left", async () => {
		// 1 use left (2 spent), rolls 1: 2 uses, 1 spent.
		const { html, actors, update, toMessage, click, btn } = rig(1, 2);
		wireSeasonsReminderResets({ id: "msg2" }, html, { actors });
		await click();
		expect(toMessage).toHaveBeenCalledWith("1d4-1", expect.anything());
		expect(update).toHaveBeenCalledWith(
			{ "flags.stonetop-pwd.inventory.resources.naphtha": 1, "flags.stonetop-pwd.naphthaRollCard": "msg2" },
			{ stonetopMove: "Laboratory" });
		expect(btn.innerHTML).toContain("Naphtha rolled");
		delete globalThis.Roll;
	});

	it("caps at the printed 3 uses", async () => {
		const { html, actors, update, click } = rig(3, 1);
		wireSeasonsReminderResets({ id: "msg3" }, html, { actors });
		await click();
		expect(update.mock.calls.at(-1)[0]["flags.stonetop-pwd.inventory.resources.naphtha"]).toBe(0);
		delete globalThis.Roll;
	});

	it("a 0 keeps the leftovers as they were", async () => {
		const { html, actors, update, click } = rig(0, 2);
		wireSeasonsReminderResets({ id: "msg3" }, html, { actors });
		await click();
		expect(update.mock.calls.at(-1)[0]["flags.stonetop-pwd.inventory.resources.naphtha"]).toBe(2);
		delete globalThis.Roll;
	});

	it("an all-spent track with a 0 stays all spent", async () => {
		const { html, actors, update, click } = rig(0, 3);
		wireSeasonsReminderResets({ id: "msg3" }, html, { actors });
		await click();
		expect(update.mock.calls.at(-1)[0]["flags.stonetop-pwd.inventory.resources.naphtha"]).toBe(3);
		delete globalThis.Roll;
	});

	it("nothing stored reads as a full track, as the Items column reads it", async () => {
		const { html, actors, update, click } = rig(2);
		wireSeasonsReminderResets({ id: "msg3" }, html, { actors });
		await click();
		expect(update.mock.calls.at(-1)[0]["flags.stonetop-pwd.inventory.resources.naphtha"]).toBe(0);
		delete globalThis.Roll;
	});

	it("notes the card on the character before the dice, so a second press finds it pressed", async () => {
		const { html, actors, update, toMessage, click } = rig(2);
		let notedAtRoll = null;
		toMessage.mockImplementation(async () => { notedAtRoll = update.mock.calls[0]?.[0]; });
		wireSeasonsReminderResets({ id: "msg4" }, html, { actors });
		await click();
		expect(notedAtRoll).toEqual({ "flags.stonetop-pwd.naphthaRollCard": "msg4" });
		await click();
		expect(toMessage).toHaveBeenCalledOnce();
		delete globalThis.Roll;
	});

	it("is on one client only: the character's player, else the GM", () => {
		const { html, actors, btn } = rig(2);
		wireSeasonsReminderResets({ id: "msg5" }, html, { actors, userId: "u-gm", presser: () => "u-player" });
		expect(btn.remove).toHaveBeenCalled();
		const mine = rig(2);
		wireSeasonsReminderResets({ id: "msg5" }, mine.html, { actors: mine.actors, userId: "u-player", presser: () => "u-player" });
		expect(mine.btn.remove).not.toHaveBeenCalled();
		delete globalThis.Roll;
	});

	it("takes the note back and gives the button back when the dice never reached chat", async () => {
		const { html, actors, update, toMessage, click, btn } = rig(2);
		toMessage.mockRejectedValue(new Error("offline"));
		wireSeasonsReminderResets({ id: "msg6" }, html, { actors });
		await click();
		expect(update.mock.calls.at(-1)[0]).toEqual({ "flags.stonetop-pwd.naphthaRollCard": null });
		expect(btn.disabled).toBe(false);
		delete globalThis.Roll;
	});
});

// Blessed re-audit (2026-10-18), the season possessions' buttons: Collected offerings "Restore 1 use each
// season", Goat herd "Each season, 1 in 4 chance of having a bezoar", Herb garden "Each spring, d4 uses of
// bendis root" (SET to the roll: the crop replaces what is left).
describe("the Blessed's season possession buttons", () => {
	function rig(reset, { total = 1, flags = {} } = {}) {
		const update = vi.fn(async () => {});
		const getFlag = (scope, key) => (scope === "stonetop-pwd" ? flags[key] : undefined);
		const actor = { name: "Brother Hale", type: "character", items: [], id: "hale1", isOwner: true, update, getFlag };
		const listeners = {};
		const btn = {
			dataset: { reset, actorId: "hale1" }, disabled: false, innerHTML: "",
			remove: vi.fn(), addEventListener: (type, fn) => { listeners[type] = fn; },
		};
		const toMessage = vi.fn(async () => {});
		globalThis.Roll = class { constructor(f) { this.formula = f; this.total = total; } async evaluate() { return this; } toMessage(d) { return toMessage(this.formula, d); } };
		return { btn, update, toMessage, html: { querySelectorAll: () => [btn] }, actors: { get: () => actor }, click: () => listeners.click?.() };
	}

	it("draws one button per possession row, each naming its kind", () => {
		const html = seasonsReminderCard("spring", collectSeasonalReminders([{
			...fakeCharacter({ name: "Brother Hale", possessions: ["collected-offerings", "goat-herd", "herb-garden"] }), id: "hale1",
		}], "spring"));
		expect(html.match(/stonetop-seasons-reset-btn/g)).toHaveLength(3);
		expect(html).toContain('data-reset="offerings" data-actor-id="hale1"');
		expect(html).toContain('data-reset="bezoar" data-actor-id="hale1"');
		expect(html).toContain('data-reset="bendis" data-actor-id="hale1"');
		expect(html).toContain("Restore 1 use");
		expect(html).toContain("Roll for a bezoar (1 in 4)");
		expect(html).toContain("Roll d4 bendis root");
	});

	it("Collected offerings: takes 1 off the spent uses, and notes the card", async () => {
		const { html, actors, update, click, btn } = rig("offerings", { flags: { "possessions.uses": { "collected-offerings": 2 } } });
		wireSeasonsReminderResets({ id: "m1" }, html, { actors });
		await click();
		expect(update).toHaveBeenCalledWith(
			{ "flags.stonetop-pwd.possessions.uses.collected-offerings": 1, "flags.stonetop-pwd.offeringsRestoreCard": "m1" },
			{ stonetopMove: "Collected offerings" });
		expect(btn.innerHTML).toContain("Use restored");
		delete globalThis.Roll;
	});

	it("Collected offerings: a full track stays full (never below 0 spent)", () => {
		expect(offeringsRestoreUpdate({ getFlag: () => undefined })).toEqual({ "flags.stonetop-pwd.possessions.uses.collected-offerings": 0 });
		expect(offeringsRestoreUpdate({ getFlag: () => ({ "collected-offerings": 0 }) })).toEqual({ "flags.stonetop-pwd.possessions.uses.collected-offerings": 0 });
	});

	// Code review 10-22 (HC-5): the GM and the player both get this button, and one's press does not redraw the
	// other's card. Restoring counts down, so a second press from the same card must restore nothing.
	it("Collected offerings: a press after another client restored the use from this card restores nothing", async () => {
		const flags = { "possessions.uses": { "collected-offerings": 2 } };
		const { html, actors, update, click, btn } = rig("offerings", { flags });
		wireSeasonsReminderResets({ id: "m1" }, html, { actors });
		flags.offeringsRestoreCard = "m1";
		await click();
		expect(update).not.toHaveBeenCalled();
		expect(btn.disabled).toBe(true);
		expect(btn.innerHTML).toContain("Use restored");
		delete globalThis.Roll;
	});

	it("Collected offerings: renders done once this card restored the use", () => {
		const { html, actors, btn } = rig("offerings", { flags: { offeringsRestoreCard: "m1" } });
		wireSeasonsReminderResets({ id: "m1" }, html, { actors });
		expect(btn.disabled).toBe(true);
		delete globalThis.Roll;
	});

	it("Goat herd: a 1 on the d4 adds the Bezoar special item", async () => {
		const { html, actors, update, toMessage, click } = rig("bezoar", { total: 1, flags: { "inventory.addedSpecial": ["lantern"] } });
		wireSeasonsReminderResets({ id: "m2" }, html, { actors });
		await click();
		expect(toMessage).toHaveBeenCalledWith("1d4", expect.anything());
		expect(update.mock.calls.at(-1)).toEqual([
			{ "flags.stonetop-pwd.inventory.addedSpecial": ["lantern", "bezoar"], "flags.stonetop-pwd.bezoarRollCard": "m2" },
			{ stonetopMove: "Goat herd" }]);
		delete globalThis.Roll;
	});

	it("Goat herd: a 2-4 adds nothing, but the card's roll is still made", async () => {
		const { html, actors, update, click, btn } = rig("bezoar", { total: 3 });
		wireSeasonsReminderResets({ id: "m3" }, html, { actors });
		await click();
		expect(update.mock.calls.at(-1)[0]).toEqual({ "flags.stonetop-pwd.bezoarRollCard": "m3" });
		expect(btn.innerHTML).toContain("Bezoar rolled");
		delete globalThis.Roll;
	});

	it("Goat herd: one bezoar is had, so a 1 while carrying one adds no second", async () => {
		globalThis.Roll = class { constructor(f) { this.formula = f; this.total = 1; } async evaluate() { return this; } toMessage() {} };
		expect(await rollForBezoar({ getFlag: () => ["bezoar"] })).toEqual({});
		expect(await rollForBezoar({ getFlag: () => undefined })).toEqual({ "flags.stonetop-pwd.inventory.addedSpecial": ["bezoar"] });
		delete globalThis.Roll;
	});

	it("Herb garden: the d4 SETS this spring's bendis root (its size and 0 spent)", async () => {
		const { html, actors, update, toMessage, click } = rig("bendis", { total: 3, flags: { "inventory.resources": { "bendis-root": 1 } } });
		wireSeasonsReminderResets({ id: "m4" }, html, { actors });
		await click();
		expect(toMessage).toHaveBeenCalledWith("1d4", expect.anything());
		expect(update.mock.calls.at(-1)).toEqual([{
			"flags.stonetop-pwd.inventory.resourceMax.bendis-root": 3,
			"flags.stonetop-pwd.inventory.resources.bendis-root":   0,
			"flags.stonetop-pwd.bendisRollCard": "m4",
		}, { stonetopMove: "Herb garden" }]);
		delete globalThis.Roll;
	});

	it("Herb garden: rolls once per card", async () => {
		const { html, actors, toMessage, click } = rig("bendis", { total: 2 });
		wireSeasonsReminderResets({ id: "m5" }, html, { actors });
		await click();
		await click();
		expect(toMessage).toHaveBeenCalledOnce();
		delete globalThis.Roll;
	});

	it("the Herb garden makes bendis root, an item with an acquired uses track (pack data)", () => {
		const blessed = JSON.parse(fs.readFileSync(path.resolve(REPO, "packs/src/stonetop-items/playbooks/the-blessed.json"), "utf8"));
		const garden = blessed.flags.stonetop.specialPossessions.options.find(o => o.slug === "herb-garden");
		expect(garden.specialItems).toEqual([BENDIS_ROOT_SLUG]);
		const item = JSON.parse(fs.readFileSync(path.resolve(REPO, "packs/src/stonetop-items/inventory-items/bendis-root.json"), "utf8"));
		expect(item.name).toBe("Bendis root");
		expect(item.flags.stonetop).toMatchObject({ slug: BENDIS_ROOT_SLUG, inventoryColumn: "small", special: true, resource: { max: 0 } });
		expect(item.flags.stonetop.note).toMatch(/reach.*area.*burns ~1 hr, fumes repel perversions of nature/);
	});
});

// ── The registry against the books it quotes ────────────────────────────────────
// The card is only worth posting if it is COMPLETE: an upkeep it forgets is one the table
// forgets, because the card's presence is exactly what stops anyone checking by hand. The
// registry was hand-written, and it had drifted — it carried all four of the Blessed's seasonal
// rules and neither of the Seeker's, so a Seeker's logbook went unreset and their laboratory
// unrolled for as many seasons as a campaign ran.
//
// So the shipped compendium sources are the authority here, not this list. Every playbook move
// and every special possession whose printed text names a seasonal TRIGGER has to be registered
// or deliberately excused, and a new playbook that ships one fails this until someone decides
// which it is.
describe("every seasonal rule the books print is registered", () => {
	const PLAYBOOKS = "packs/src/stonetop-items/playbooks";
	const MOVES     = "packs/src/stonetop-items/playbook-moves";

	// Deliberately narrow, because it is looking for a trigger rather than for the word: a
	// possession that merely mentions winter in its flavour is not swept in, and neither is a
	// Value tier that prices "a season of unskilled labor".
	const SEASONAL = /(each|every|once per)\s+(season|spring|summer|autumn|winter)|when\s+the\s+seasons\s+change/i;
	// The pack files store their prose as HTML, and the Logbook's trigger is wrapped mid-phrase
	// ("When <strong><em>the Seasons Change</em></strong>"), so the tags come out before the
	// match is attempted or the one entry this test was written for slips straight past it.
	const plain = html => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

	function docsUnder(rel) {
		const out = [];
		const walk = dir => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (entry.name.endsWith(".json")) out.push(full);
			}
		};
		walk(path.resolve(REPO, rel));
		return out.map(f => JSON.parse(fs.readFileSync(f, "utf8")));
	}

	// `specialPossessions` is the whole picker (its note, its count, what comes preselected);
	// the possessions themselves are its `options`.
	const possessions = () => docsUnder(PLAYBOOKS).flatMap(p => p?.flags?.stonetop?.specialPossessions?.options ?? []);

	// Named sets rather than inline skips, so an exception has to be written down as one.
	// Both are empty today: Holy relics is not excused here because it has no seasonal line to
	// match in the first place — see the note on SEASONAL_REMINDERS for why that matters.
	const EXCUSED_MOVES = new Set();
	const EXCUSED_POSSESSIONS = new Set();

	it("registers every playbook move whose printed text names a season", () => {
		const seasonal = docsUnder(MOVES)
			.filter(m => SEASONAL.test(plain(m?.system?.description)))
			.map(m => m.name);
		// The scan finding nothing would pass the assertion below while proving nothing, which is
		// the failure mode of every test that greps a tree.
		expect(seasonal).toContain("Logbook");
		const registered = new Set(SEASONAL_REMINDERS.filter(r => r.kind === "move").map(r => r.name));
		expect(seasonal.filter(n => !registered.has(n) && !EXCUSED_MOVES.has(n))).toEqual([]);
	});

	it("registers every special possession whose printed text names a season", () => {
		const seasonal = possessions()
			.filter(p => SEASONAL.test(plain(p?.description)))
			.map(p => p.slug);
		expect(seasonal).toContain("laboratory");
		const registered = new Set(SEASONAL_REMINDERS.filter(r => r.kind === "possession").map(r => r.slug));
		expect(seasonal.filter(s => !registered.has(s) && !EXCUSED_POSSESSIONS.has(s))).toEqual([]);
	});

	// The other direction. An entry matching nothing shipped is a rule the card would announce
	// that no character could ever carry — which is how the invented Holy relics refresh went
	// out to tables for as long as it did.
	it("registers nothing the compendium does not ship", () => {
		const moveNames = new Set(docsUnder(MOVES).map(m => m.name));
		const slugs = new Set(possessions().map(p => p.slug));
		for (const r of SEASONAL_REMINDERS) {
			if (r.kind === "move") expect([...moveNames], r.name).toContain(r.name);
			else expect([...slugs], r.slug).toContain(r.slug);
		}
	});
});

// The Laboratory's naphtha, by the user's ruling of 2026-10-18: a season's d4-1 is added to what is
// left (3 at most), and a Laboratory taken at creation rolls its first d4-1 once.
describe("the Laboratory's naphtha yield", () => {
	it("adds the roll to the uses left, capped at 3 (the track counts SPENT)", () => {
		expect(naphthaSpentAfter(2, 1)).toBe(1);
		expect(naphthaSpentAfter(1, 3)).toBe(0);
		expect(naphthaSpentAfter(2, 0)).toBe(2);
		expect(naphthaSpentAfter(undefined, 1)).toBe(0);
		expect(naphthaSpentAfter(3, 2)).toBe(1);
	});

	it("at creation the track holds the roll alone", async () => {
		const toMessage = vi.fn(async () => {});
		globalThis.Roll = class { constructor(f) { this.formula = f; this.total = 1; } async evaluate() { return this; } toMessage(d) { return toMessage(this.formula, d); } };
		// Nothing stored (a full track) must not leak into a creation roll.
		const actor = { getFlag: () => undefined };
		expect(await rollNaphthaYield(actor, { addTo: false })).toEqual({ "flags.stonetop-pwd.inventory.resources.naphtha": 2 });
		expect(toMessage).toHaveBeenCalledWith("1d4-1", expect.anything());
		delete globalThis.Roll;
	});

	it("rolls only for a Laboratory this apply takes, never one a re-run kept", () => {
		expect(laboratoryNewlySelected([], ["laboratory"])).toBe(true);
		expect(laboratoryNewlySelected(["laboratory"], ["laboratory"])).toBe(false);
		expect(laboratoryNewlySelected(["laboratory"], [])).toBe(false);
		expect(laboratoryNewlySelected(["workshop"], ["workshop"])).toBe(false);
		expect(laboratoryNewlySelected(new Set(["workshop"]), ["laboratory", "workshop"])).toBe(true);
	});
});
