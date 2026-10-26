import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybookPickerDialog, playbookHolders } from "../../../../module/actors/character/dialogs/PlaybookPickerDialog.js";

// The playbook picker. "No doubling up; each player should pick a different playbook" (Book I
// p.49): a playbook someone else holds is FLAGGED on its card, never locked.

const OWNER = 3;
const SCOPE = "stonetop-pwd";
const PLAYBOOKS = [
	{ slug: "the-fox",   name: "The Fox" },
	{ slug: "the-heavy", name: "The Heavy" },
	{ slug: "the-judge", name: "The Judge" },
];

function pc(id, name, { owner = null, playbook = null, progress = null, dead = false } = {}) {
	const flags = dead ? { [SCOPE]: { deathsDoor: "dead" } } : {};
	return {
		id, name, type: "character",
		ownership: owner ? { [owner]: OWNER } : {},
		system: { playbook: playbook ? { slug: playbook } : null },
		flags,
		getFlag: (_scope, key) => (key === "onboardingProgress" ? progress : undefined),
	};
}

const users = [
	{ id: "gm",  name: "The GM", isGM: true },
	{ id: "u1",  name: "Aderyn", isGM: false, character: { id: "wren" } },
	{ id: "u2",  name: "Bryn",   isGM: false, character: null },
	{ id: "u3",  name: "Cai",    isGM: false, character: null },
];

let saved;
beforeEach(() => {
	saved = { CONST: global.CONST };
	global.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER } };
});
afterEach(() => {
	global.CONST = saved.CONST;
	vi.restoreAllMocks();
});

describe("playbookHolders", () => {
	it("names a committed playbook's character and player", () => {
		const holders = playbookHolders({
			actors: [pc("wren", "Wren", { playbook: "the-fox" })],
			users, playbooks: PLAYBOOKS,
		});
		expect(holders.get("the-fox")).toEqual({ taken: ["Wren (Aderyn)"], dead: [] });
	});

	// At the first session nobody has committed yet: the pick still in progress is the one that
	// actually keeps two players off the same playbook.
	it("counts a pick still in progress, by the playbook name the flow stamps", () => {
		const holders = playbookHolders({
			actors: [pc("holt", "Holt", { owner: "u2", progress: { state: "onboarding", step: 2, total: 9, playbook: "The Heavy" } })],
			users, playbooks: PLAYBOOKS,
		});
		expect(holders.get("the-heavy").taken).toEqual(["Holt (Bryn)"]);
	});

	it("leaves out the character being built", () => {
		const holders = playbookHolders({
			actors: [pc("wren", "Wren", { playbook: "the-fox" })],
			users, playbooks: PLAYBOOKS, excludeActorId: "wren",
		});
		expect(holders.has("the-fox")).toBe(false);
	});

	it("leaves out an unassigned or GM-only prep sheet", () => {
		const holders = playbookHolders({
			actors: [pc("prep", "Pregen", { owner: "gm", playbook: "the-judge" }), pc("loose", "Loose", { playbook: "the-judge" })],
			users, playbooks: PLAYBOOKS,
		});
		expect(holders.has("the-judge")).toBe(false);
	});

	it("lists the dead as dead, and does not count them as taken", () => {
		const holders = playbookHolders({
			actors: [pc("ash", "Ash", { owner: "u3", playbook: "the-judge", dead: true })],
			users, playbooks: PLAYBOOKS,
		});
		expect(holders.get("the-judge")).toEqual({ taken: [], dead: ["Ash (dead)"] });
	});
});

describe("the picker's cards", () => {
	it("draws a taken playbook's note, and leaves the card a clickable button", async () => {
		const picker = Object.create(PlaybookPickerDialog.prototype);
		picker._actorId = "new";
		picker._playbooks = PLAYBOOKS.map(p => ({ ...p, uuid: `Compendium.x.${p.slug}`, img: "", complexity: "", description: "" }));
		const savedGame = global.game;
		global.game = { ...savedGame, actors: [pc("wren", "Wren", { playbook: "the-fox" })], users };
		try {
			const data = await picker.getData();
			const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/playbook-picker.hbs", data);
			expect(html).toContain("Taken by Wren (Aderyn)");
			expect(html).toMatch(/<button type="button"\s+class="stonetop-playbook-picker-card stonetop-playbook-picker-card--the-fox is-taken"/);
			expect(data.playbooks.find(p => p.slug === "the-heavy").taken).toBe(false);
		} finally {
			global.game = savedGame;
		}
	});

	// The cards stay live through the picker's fade-out, so a double-click picked twice and
	// opened two walkthroughs sharing one DOM id.
	it("picks once, however many times a card is clicked", async () => {
		const picker = Object.create(PlaybookPickerDialog.prototype);
		picker._onPick = vi.fn(async () => {});
		picker.close = vi.fn();
		global.fromUuid = vi.fn(async uuid => ({ uuid }));

		await Promise.all([picker._pickPlaybook("Compendium.x.fox"), picker._pickPlaybook("Compendium.x.fox")]);

		expect(picker._onPick).toHaveBeenCalledTimes(1);
		delete global.fromUuid;
	});

	it("lets a click try again when the playbook could not be loaded", async () => {
		const picker = Object.create(PlaybookPickerDialog.prototype);
		picker._onPick = vi.fn(async () => {});
		picker.close = vi.fn();
		global.fromUuid = vi.fn(async () => null);
		await picker._pickPlaybook("Compendium.x.gone");
		global.fromUuid = vi.fn(async uuid => ({ uuid }));
		await picker._pickPlaybook("Compendium.x.fox");
		expect(picker._onPick).toHaveBeenCalledTimes(1);
		delete global.fromUuid;
	});
});

// creation-flow.js sets `_suppressOnClose` when the character being built is deleted or replaced.
// The picker ignored it, so its onClose opened the deleted character's sheet: a ghost window.
describe("closing the picker", () => {
	const base = Object.getPrototypeOf(PlaybookPickerDialog.prototype);
	afterEach(() => vi.restoreAllMocks());

	it("skips its exit callback when the flow suppressed it", async () => {
		vi.spyOn(base, "close").mockResolvedValue(undefined);
		const picker = Object.create(PlaybookPickerDialog.prototype);
		picker._onClose = vi.fn();
		picker._suppressOnClose = true;

		await picker.close();

		expect(picker._onClose).not.toHaveBeenCalled();
	});

	it("still runs it on an ordinary close", async () => {
		vi.spyOn(base, "close").mockResolvedValue(undefined);
		const picker = Object.create(PlaybookPickerDialog.prototype);
		picker._onClose = vi.fn();

		await picker.close();

		expect(picker._onClose).toHaveBeenCalledTimes(1);
	});

	it("stops listening for other players' picks once closed", async () => {
		vi.spyOn(base, "close").mockResolvedValue(undefined);
		const off = vi.fn();
		const savedHooks = global.Hooks;
		global.Hooks = { on: vi.fn(() => 7), off };
		try {
			const picker = Object.create(PlaybookPickerDialog.prototype);
			picker._registerHooks();
			expect(global.Hooks.on).toHaveBeenCalledWith("updateActor", expect.any(Function));
			await picker.close();
			expect(off).toHaveBeenCalledWith("updateActor", 7);
		} finally {
			global.Hooks = savedHooks;
		}
	});
});

describe("an empty picker", () => {
	it("says why there is nothing to pick", async () => {
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/playbook-picker.hbs", { playbooks: [] });
		expect(html).toContain("No playbooks to choose from");
	});
});
