// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
vi.mock("../../module/utils/ask-with-buttons.js", async importOriginal => {
	const actual = await importOriginal();
	return { ...actual, confirmOutcome: vi.fn(actual.confirmOutcome) };
});

import { createStonetopArcanumSheetClass } from "../../module/item/StonetopArcanumSheet.js";
import { viewerMaySeeArcanumBack, arcanumHolders, characterHasArcanumBack } from "../../module/item/arcanum-access.js";
import { SYSTEM_ID } from "../../module/system-id.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EN   = JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8"));
const loc  = key => key.split(".").reduce((n, k) => n?.[k], EN) ?? key;

const SLUG = "arc-testtesttesttest";
const realGame = globalThis.game;

let settings;
function setGame({ isGM = false, actors = [], peek = false, user = {} } = {}) {
	settings = { arcanaPlayersSeeBothSides: peek };
	globalThis.game = {
		...realGame,
		user: { id: "u1", isGM, ...user },
		actors,
		items: { get: () => ({}) },
		settings: { get: (_scope, key) => settings[key] },
	};
}

const character = (arcana, { owner = true, name = "Aldric", unlocked = false } = {}) => ({
	name, type: "character",
	flags: { [SYSTEM_ID]: { arcana } },
	testUserPermission: () => owner,
	typedActor: { isArcanumUnlocked: vi.fn(async () => unlocked) },
});

const card = (flags = {}, extra = {}) => ({
	id: "I1", name: "The Card", type: "move", system: { moveType: "arcanum" }, img: null, isOwner: false,
	flags: { stonetop: {
		slug: SLUG,
		front: { title: "The Card", description: "<p>Front text.</p>", unlock: { description: "", requirements: [] } },
		back:  { title: "Secret Power", description: "<p>The secret.</p>" },
		...flags,
	} },
	update: vi.fn(async () => {}),
	...extra,
});

function sheetFor(item, { editable = true } = {}) {
	const Base = class {
		get item() { return item; }
		get isEditable() { return editable; }
		async getData() { return {}; }
		render() {}
	};
	return new (createStonetopArcanumSheetClass(Base))();
}

beforeEach(() => setGame());

describe("HB-1 / A3: the back on the item sheet is gated per viewer", () => {
	it("hides the whole back from a player whose character hasn't earned it", async () => {
		setGame({ actors: [character({ owned: [SLUG], identified: [SLUG] })] });
		const data = await sheetFor(card(), { editable: false }).getData();
		expect(data.backHidden).toBe(true);
		expect(data.back).toEqual({});
		expect(data.front.title).toBe("The Card");
	});

	it("shows it to a GM, with the peek switch on, and to the card's author", async () => {
		setGame({ isGM: true });
		expect((await sheetFor(card()).getData()).backHidden).toBe(false);
		setGame({ peek: true });
		expect((await sheetFor(card()).getData()).back.title).toBe("Secret Power");
		setGame();
		expect((await sheetFor(card({}, { isOwner: true })).getData()).backHidden).toBe(false);
	});

	it("shows it to a player whose own character holds it identified, and revealed or unlocked", async () => {
		const revealed = character({ owned: [SLUG], identified: [SLUG], revealed: [SLUG] });
		expect(await characterHasArcanumBack(revealed, SLUG)).toBe(true);
		const latched = character({ owned: [SLUG], identified: [SLUG], unlockedOnce: [SLUG] });
		expect(await characterHasArcanumBack(latched, SLUG)).toBe(true);
		const unlocked = character({ owned: [SLUG], identified: [SLUG] }, { unlocked: true });
		expect(await characterHasArcanumBack(unlocked, SLUG)).toBe(true);
		// Unlocked but never identified: still a mystery card.
		const unidentified = character({ owned: [SLUG] }, { unlocked: true });
		expect(await characterHasArcanumBack(unidentified, SLUG)).toBe(false);
		// Revealed but never identified: the character sheet shows nothing of it, so neither does this.
		const revealedUnidentified = character({ owned: [SLUG], revealed: [SLUG] });
		expect(await characterHasArcanumBack(revealedUnidentified, SLUG)).toBe(false);

		setGame({ actors: [unlocked] });
		expect((await sheetFor(card(), { editable: false }).getData()).backHidden).toBe(false);
	});

	it("doesn't count another player's character", async () => {
		const theirs = character({ owned: [SLUG], identified: [SLUG], revealed: [SLUG] }, { owner: false });
		expect(await viewerMaySeeArcanumBack(SLUG, { user: { id: "u1" }, actors: [theirs], playersSeeBoth: false })).toBe(false);
		// ...but the user's assigned character counts even without the ownership test.
		expect(await viewerMaySeeArcanumBack(SLUG, { user: { id: "u1", character: theirs }, actors: [], playersSeeBoth: false })).toBe(true);
	});

	it("gates a shipped card the same way", async () => {
		const shipped = card({ slug: "the-key" }, { pack: "stonetop_pwd.stonetop-arcana" });
		expect((await sheetFor(shipped, { editable: false }).getData()).backHidden).toBe(true);
	});

	it("draws the hidden-back line and none of the back, keeping the selectors other rules key on", async () => {
		const hb = Handlebars.create();
		hb.registerHelper("localize", k => loc(k));
		hb.registerHelper("eq", (a, b) => a === b);
		hb.registerHelper("or", (...a) => a.slice(0, -1).some(Boolean));
		hb.registerHelper("format", k => loc(k));
		hb.registerHelper("times", n => [...Array(Number(n) || 0).keys()]);
		const tpl = hb.compile(fs.readFileSync(path.join(ROOT, "templates/item/arcanum-sheet.hbs"), "utf8"));

		const hidden = tpl(await sheetFor(card(), { editable: false }).getData());
		expect(hidden).toContain(loc("stonetop.arcana.homebrew.backHidden"));
		expect(hidden).not.toContain("Secret Power");
		expect(hidden).not.toContain("The secret.");
		expect(hidden).toContain(`data-slug="${SLUG}"`);

		setGame({ isGM: true });
		const shown = tpl(await sheetFor(card({ gmNotes: "<p>Drawback: hungry.</p>" })).getData());
		expect(shown).toContain("Secret Power");
		expect(shown).toMatch(/class="stonetop-arcanum-card stonetop-arcanum-sheet-side stonetop-arcanum-sheet-back"/);
		expect(shown).toContain("Drawback: hungry.");
		expect(shown).not.toContain(loc("stonetop.arcana.homebrew.backHidden"));
	});
});

describe("HB-10: GM notes are for the GM", () => {
	it("are shown to a GM viewing the card and never to a player, even the author", async () => {
		setGame({ isGM: true });
		expect((await sheetFor(card({ gmNotes: "<p>Spirit: a fox.</p>" })).getData()).gmNotes).toContain("a fox");
		setGame();
		expect((await sheetFor(card({ gmNotes: "<p>Spirit: a fox.</p>" }, { isOwner: true })).getData()).gmNotes).toBe("");
	});

	it("are in the editor for a GM only, not for a player given the card to finish", async () => {
		const flags = card({ gmNotes: "<p>Spirit: a fox.</p>" }).flags.stonetop;
		setGame({ isGM: true });
		const gm = await sheetFor(card())._buildEditContext(flags);
		expect(gm).toMatchObject({ showGmNotes: true, gmNotes: "<p>Spirit: a fox.</p>" });
		setGame();
		const player = await sheetFor(card({}, { isOwner: true }))._buildEditContext(flags);
		expect(player).toMatchObject({ showGmNotes: false, gmNotes: "", gmNotesEnriched: "" });
	});
});

describe("HB-11: a stored draft", () => {
	it("is marked on the card, with Finish / Discard for whoever can edit it", async () => {
		setGame({ isGM: true });
		const data = await sheetFor(card({ draft: true })).getData();
		expect(data.draft).toEqual({ isDraft: true, canFinish: true });
		const ro = await sheetFor(card({ draft: true }), { editable: false }).getData();
		expect(ro.draft).toEqual({ isDraft: true, canFinish: false });
	});

	it("is cleared on save", async () => {
		setGame({ isGM: true });
		const item = card({ draft: true });
		const sheet = sheetFor(item);
		await sheet._clearStoredDraft();
		expect(item.update).toHaveBeenCalledWith({ "flags.stonetop.draft": false }, { render: false });
		item.update.mockClear();
		item.flags.stonetop.draft = false;
		await sheet._clearStoredDraft();
		expect(item.update).not.toHaveBeenCalled();
	});

	it("Discard refused by the held-card guard leaves the sheet as it was", async () => {
		setGame({ isGM: true });
		const { confirmOutcome } = await import("../../module/utils/ask-with-buttons.js");
		const item = card({ draft: true }, { delete: vi.fn(async () => undefined) });
		const sheet = sheetFor(item);
		const onSave = vi.fn();
		sheet._arcanumDraft = true;
		sheet._arcanumOnSave = onSave;
		vi.mocked(confirmOutcome).mockResolvedValueOnce(true);
		// The item is still there after the delete: the guard refused it to ask first.
		expect(await sheet._discardDraft()).toBe(false);
		expect(item.delete).toHaveBeenCalledOnce();
		expect(sheet._discarded).toBe(false);
		expect(sheet._arcanumOnSave).toBe(onSave);

		// A delete that lands is a discard.
		globalThis.game.items = { get: vi.fn().mockReturnValueOnce({}).mockReturnValue(undefined) };
		vi.mocked(confirmOutcome).mockResolvedValueOnce(true);
		expect(await sheet._discardDraft()).toBe(true);
		expect(sheet._discarded).toBe(true);
	});

	it("Finish reopens the editor as a pending draft", async () => {
		const sheet = sheetFor(card({ draft: true }));
		sheet.render = vi.fn();
		await sheet._finishStoredDraft();
		expect(sheet._editMode).toBe(true);
		expect(sheet._arcanumDraft).toBe(true);
	});
});

describe("HB-13: the Item name and the front title stay one name until made different", () => {
	it("renames the other while they match, and leaves them alone once they differ", () => {
		const item = card();
		const sheet = sheetFor(item);
		expect(sheet._pairedNameUpdate("name", "New Name")).toEqual({ "flags.stonetop.front.title": "New Name" });
		expect(sheet._pairedNameUpdate("flags.stonetop.front.title", "New Name")).toEqual({ name: "New Name" });
		item.flags.stonetop.front.title = "Different";
		expect(sheet._pairedNameUpdate("name", "X")).toEqual({});
		expect(sheet._pairedNameUpdate("flags.stonetop.back.title", "X")).toEqual({});
	});
});

describe("HB-9: editing a follower keeps what the form has no field for", () => {
	it("merges each row over the stored follower and stamps its id once", async () => {
		const stored = {
			name: "Wisp", pronoun: "it", typeLabel: "spirit", hp: 3, choices: [{ field: "tags", pick: 1, options: ["a"] }],
			askName: true, portraitIcon: "icons/x.webp", viaCallUp: true, exceptional: true,
		};
		const item = card({ summon: { followers: [stored, { name: "Hand-set", sourceUuid: "keep:me" }] } });
		const sheet = sheetFor(item);
		const root = document.createElement("div");
		root.innerHTML = [0, 1].map(i => `<div class="stonetop-arc-foll-row" data-foll-index="${i}">
			<input data-foll-prop="name" value="${i ? "Hand-set" : "Will o' Wisp"}"><input data-foll-prop="hp" value="4">
			<input data-foll-prop="loyalty" value="1"><input type="checkbox" data-foll-prop="repeatable"></div>`).join("");
		sheet.element = [root];
		await sheet._rebuildSummon();
		const [[update]] = item.update.mock.calls;
		const [first, second] = update["flags.stonetop.summon.followers"];
		expect(first).toMatchObject({ name: "Will o' Wisp", hp: 4, askName: true, portraitIcon: "icons/x.webp", viaCallUp: true, exceptional: true });
		expect(first.choices).toEqual(stored.choices);
		// The id it was summoned under before the rename: derived from the STORED name.
		expect(first.sourceUuid).toBe(`${SLUG}:wisp`);
		expect(second.sourceUuid).toBe("keep:me");
	});

	it("a new follower gets an id at once", async () => {
		const item = card();
		const sheet = sheetFor(item);
		sheet._flushRichEditors = vi.fn();
		await sheet._addFollower();
		const followers = item.update.mock.calls[0][0]["flags.stonetop.summon.followers"];
		expect(followers[0].sourceUuid).toMatch(new RegExp(`^${SLUG}:`));
	});
});

describe("HB-8 / A15: holders", () => {
	it("names every actor holding the card, by list or by keyed marks", () => {
		const a = character({ owned: [SLUG] }, { name: "Aldric" });
		const b = character({ unlock: { [`${SLUG}:option-1`]: 1 } }, { name: "Brina" });
		const c = character({ owned: ["other"] }, { name: "Cael" });
		expect(arcanumHolders(SLUG, [a, b, c]).map(x => x.name)).toEqual(["Aldric", "Brina"]);
	});

	it("puts the holders in the editor's warning and locks the option slugs", async () => {
		setGame({ isGM: true, actors: [character({ owned: [SLUG] }, { name: "Aldric" })] });
		const sheet = sheetFor(card({ front: { title: "T", description: "", unlock: { description: "", requirements: [{ type: "option", slug: "o1", description: "d", max: 1 }] } } }));
		sheet._editMode = true;
		const data = await sheet.getData();
		expect(data.edit.slugLocked).toBe(true);
		expect(data.edit.holderNames).toBe("Aldric");
		const src = fs.readFileSync(path.join(ROOT, "templates/item/arcanum-sheet-edit.hbs"), "utf8");
		expect(src).toMatch(/data-req-prop="slug"[^>]*\{\{#if @root\.edit\.slugLocked\}\} readonly/);
	});
});
