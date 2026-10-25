// @vitest-environment happy-dom
// Love letter drafts: the GM saves a letter without sending it. A draft sits on the recipient's
// sheet where only the GM sees it, never rings the player's arrival notice, and goes out (stamped
// as a new arrival) when the GM sends it. The writing window keeps open on a saved draft and
// lists the drafts to pick back up.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { STONETOP_SCOPE } from "../../module/actors/character/StonetopFlags.js";
import {
	createLoveLetter, sendLoveLetter, isDraftLoveLetter, loveLetterDrafts, buildLoveLetterData,
	LOVE_LETTER_DRAFT_FLAG, LOVE_LETTER_SENT_FLAG, LOVE_LETTER_RESOLVED_FLAG,
} from "../../module/actors/character/love-letters.js";
import { ownedLoveLetters } from "../../module/actors/character/love-letter-notice.js";
import { LoveLetterDialog } from "../../module/dialogs/LoveLetterDialog.js";
import { TestCharacterBuilder } from "../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../fakes/FakeActorBuilder.js";
import { readRepo } from "../fakes/css.js";

beforeAll(() => {
	globalThis.Handlebars ??= {};
	globalThis.Handlebars.helpers ??= {};
	globalThis.Handlebars.helpers.statLabel ??= (k) => String(k);
});

function letterItem(id, { draft = false, sent = null, modified = 0 } = {}) {
	const flags = { [STONETOP_SCOPE]: { loveLetter: true } };
	if (draft) flags[STONETOP_SCOPE][LOVE_LETTER_DRAFT_FLAG] = true;
	if (sent !== null) flags[STONETOP_SCOPE][LOVE_LETTER_SENT_FLAG] = sent;
	return {
		id, _id: id, type: "move", name: `Letter ${id}`, flags,
		system: { moveType: "other", rollType: "" },
		_stats: { createdTime: 1, modifiedTime: modified },
		update: vi.fn(async () => {}),
	};
}

function character(id, items, owners = ["player"]) {
	const actor = {
		id, name: `Hero ${id}`, type: "character", items,
		testUserPermission: (user, level) => level === "OWNER" && owners.includes(user.id),
	};
	actor.items.get = (itemId) => items.find(i => i.id === itemId);
	for (const item of items) item.parent = actor;
	return actor;
}

describe("a draft's data", () => {
	beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(555));
	afterEach(() => vi.restoreAllMocks());

	it("is created flagged as a draft, with no arrival stamp", async () => {
		const actor = { createEmbeddedDocuments: vi.fn(async (_t, docs) => docs) };
		const [doc] = [await createLoveLetter(actor, { name: "Hi" }, { draft: true })];
		const flags = doc.flags[STONETOP_SCOPE];
		expect(flags[LOVE_LETTER_DRAFT_FLAG]).toBe(true);
		expect(flags[LOVE_LETTER_SENT_FLAG]).toBeUndefined();
		expect(isDraftLoveLetter(doc)).toBe(true);
	});

	it("is not in the shape an edit rewrites, so saving a draft again keeps it a draft", () => {
		expect(buildLoveLetterData({ name: "Hi" }).flags[STONETOP_SCOPE][LOVE_LETTER_DRAFT_FLAG]).toBeUndefined();
	});

	it("stops being a draft when sent, and arrives now", async () => {
		const item = letterItem("x", { draft: true });
		await sendLoveLetter(item);
		expect(item.update).toHaveBeenCalledWith({
			[`flags.${STONETOP_SCOPE}.${LOVE_LETTER_DRAFT_FLAG}`]: false,
			[`flags.${STONETOP_SCOPE}.${LOVE_LETTER_RESOLVED_FLAG}`]: false,
			[`flags.${STONETOP_SCOPE}.${LOVE_LETTER_SENT_FLAG}`]: 555,
		});
	});

	it("is listed across every character, newest first, and sent letters are not", () => {
		const a = character("a", [letterItem("old", { draft: true, modified: 1 }), letterItem("sent", { sent: 3 })]);
		const b = character("b", [letterItem("new", { draft: true, modified: 9 })]);
		expect(loveLetterDrafts([a, b]).map(r => r.item.id)).toEqual(["new", "old"]);
	});
});

describe("the player never sees a draft", () => {
	it("doesn't ring the arrival notice", () => {
		const a = character("a", [letterItem("d", { draft: true }), letterItem("s", { sent: 2 })]);
		expect(ownedLoveLetters([a], { id: "player", isGM: false }).map(r => r.item.id)).toEqual(["s"]);
	});

	it("is left out of a player's snapshot, and kept, marked, in the GM's", async () => {
		const draft = { ...letterItem("d", { draft: true }) };
		const sent = { ...letterItem("s", { sent: 2 }) };
		const build = async (isGM) => {
			globalThis.game = { ...(globalThis.game ?? {}), user: { id: isGM ? "gm" : "player", isGM } };
			const actor = new FakeActorBuilder().withItems([draft, sent]).build();
			return (await new TestCharacterBuilder(actor).build().buildSnapshot()).movelist.loveLetters;
		};
		const prior = globalThis.game;
		try {
			expect((await build(false)).map(l => l.id)).toEqual(["s"]);
			const gmRows = await build(true);
			expect(gmRows.map(l => [l.id, l.draft])).toEqual([["d", true], ["s", false]]);
		} finally {
			globalThis.game = prior;
		}
	});

	it("is filtered on the sheet too, and gets Send rather than Read on the GM's card", () => {
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toMatch(/!letter\.resolved && !letter\.draft/);
		const hbs = readRepo("templates/actor/partials/tab-moves.hbs");
		expect(hbs.indexOf("stonetop-love-letter-send")).toBeGreaterThan(-1);
		expect(hbs.indexOf("{{#if draft}}")).toBeLessThan(hbs.indexOf("stonetop-love-letter-read\""));
	});
});

// The writing window, driven with a stand-in form.
function formRoot(values) {
	const root = document.createElement("form");
	for (const [name, value] of Object.entries(values)) {
		const input = document.createElement("input");
		input.name = name;
		input.value = value;
		root.append(input);
	}
	const markXp = document.createElement("input");
	markXp.type = "checkbox";
	markXp.name = "markXp";
	markXp.checked = true;
	root.append(markXp);
	return root;
}

function dialogFor({ item = null, actor = null } = {}) {
	const dlg = new LoveLetterDialog({ item, actor });
	dlg.render = vi.fn();
	dlg.close = vi.fn();
	return dlg;
}

describe("the writing window", () => {
	let recipient;
	let notes;
	beforeEach(() => {
		recipient = character("hero", []);
		recipient.createEmbeddedDocuments = vi.fn(async (_t, docs) => docs.map((d, i) => ({ ...d, id: `new${i}`, parent: recipient, update: vi.fn(async () => {}) })));
		notes = { info: vi.fn(), warn: vi.fn() };
		globalThis.ui = { notifications: notes };
		globalThis.game = {
			...(globalThis.game ?? {}),
			user: { id: "gm", isGM: true },
			actors: Object.assign([recipient], { get: id => (id === recipient.id ? recipient : null) }),
			i18n: { localize: k => k, format: k => k },
		};
	});

	it("saves a draft unsent, even untitled, and stays open on it", async () => {
		const dlg = dialogFor();
		await dlg._save(formRoot({ recipient: "hero", name: "", description: "Dear you" }), { draft: true });
		const doc = recipient.createEmbeddedDocuments.mock.calls[0][1][0];
		expect(doc.flags[STONETOP_SCOPE][LOVE_LETTER_DRAFT_FLAG]).toBe(true);
		expect(dlg.close).not.toHaveBeenCalled();
		expect(dlg.render).toHaveBeenCalled();
		expect(dlg._isDraft()).toBe(true);
		expect(notes.warn).not.toHaveBeenCalled();
	});

	it("still asks for a title before sending", async () => {
		const dlg = dialogFor();
		await dlg._save(formRoot({ recipient: "hero", name: "" }));
		expect(notes.warn).toHaveBeenCalled();
		expect(recipient.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("sends a draft from its window, then closes", async () => {
		const item = letterItem("d", { draft: true });
		item.parent = recipient;
		const dlg = dialogFor({ item, actor: recipient });
		await dlg._save(formRoot({ name: "A Quiet Winter" }));
		const calls = item.update.mock.calls.map(c => c[0]);
		expect(calls[0].name).toBe("A Quiet Winter");
		expect(calls[1][`flags.${STONETOP_SCOPE}.${LOVE_LETTER_DRAFT_FLAG}`]).toBe(false);
		expect(dlg.close).toHaveBeenCalled();
	});

	it("edits a sent letter without re-sending it", async () => {
		const item = letterItem("s", { sent: 4 });
		item.parent = recipient;
		const dlg = dialogFor({ item, actor: recipient });
		expect(dlg.getData()).toMatchObject({ isDraft: false, canDraft: false });
		await dlg._save(formRoot({ name: "Fixed typo" }));
		expect(item.update).toHaveBeenCalledTimes(1);
	});

	it("offers drafts to pick up in a blank window, and Save as draft until sent", () => {
		recipient.items.push(letterItem("d", { draft: true }));
		recipient.items[0].parent = recipient;
		const data = dialogFor().getData();
		expect(data.canDraft).toBe(true);
		expect(data.drafts).toEqual([{ actorId: "hero", itemId: "d", name: "Letter d", recipient: "Hero hero" }]);
	});
});
