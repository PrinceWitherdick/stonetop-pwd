import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	cascadeRename, staleHeldCopies, refreshHeldCopies, carryPlaybookCopy, carriedPlaybook,
	restoreCarriedPlaybook, saveProblem, saveHomebrewPlaybook,
} from "../../module/playbooks/homebrew-store.js";
import { normalizeBundle, bundleToItemData } from "../../module/playbooks/homebrew-bundle.js";
import { invalidatePlaybookCatalog, homebrewPlaybookBySlug } from "../../module/playbooks/playbook-catalog.js";
import { HOMEBREW_PLAYBOOK_COPY_FLAG as PLAYBOOK_COPY_FLAG } from "../../module/actors/character/StonetopFlags.js";

const SLUG = "homebrew-the-tester";

function setPath(obj, path, value) {
	const keys = path.split(".");
	const last = keys.pop();
	let o = obj;
	for (const k of keys) o = o[k] ??= {};
	o[last] = value;
}
const S = "stonetop-pwd";

function tester(name = "The Tester") {
	return normalizeBundle({
		format: "stonetop-homebrew-playbook", version: 1,
		playbook: { name, hp: 16, damage: "d6", published: true, possessions: { pickCount: 0, options: [] } },
		moves: [{ name: "Prod", description: "Poke it.", starting: true }, { name: "Poke", description: "Gently." }],
	}).bundle;
}

/** A world: Items and Folders as Foundry keeps them, enough for the store to write through. */
function world() {
	const items = [];
	const folders = [];
	let n = 0;
	const make = data => {
		const item = { ...structuredClone(data), id: `i${++n}`, _id: `i${n}`, uuid: `Item.i${n}` };
		item.update = vi.fn(async patch => { for (const [k, v] of Object.entries(patch)) setPath(item, k, v); invalidatePlaybookCatalog(); });
		item.delete = vi.fn(async () => { items.splice(items.indexOf(item), 1); });
		item.asPlaybook = () => ({ name: item.name });
		items.push(item);
		return item;
	};
	items.get = id => items.find(i => i.id === id) ?? null;
	vi.stubGlobal("Item", {
		create: vi.fn(async data => { const i = make(data); invalidatePlaybookCatalog(); return i; }),
		createDocuments: vi.fn(async list => list.map(make)),
		updateDocuments: vi.fn(async list => list.map(u => { const i = items.get(u._id); Object.assign(i, structuredClone(u)); return i; })),
		deleteDocuments: vi.fn(async ids => ids.forEach(id => items.splice(items.findIndex(i => i.id === id), 1))),
	});
	vi.stubGlobal("Folder", { create: vi.fn(async data => { const f = { ...data, id: `f${folders.length + 1}`, type: "Item" }; folders.push(f); return f; }) });
	return { items, folders };
}

/** A character holding the playbook and their own copies of its moves. */
function holder(name, { slug = SLUG, playbookName = "The Tester", moves = [] } = {}) {
	const actor = {
		name, type: "character",
		system: { playbook: { slug, name: playbookName } },
		flags: { [S]: {} },
		items: moves,
		update: vi.fn(async patch => { for (const [k, v] of Object.entries(patch)) setPath(actor, k, v); }),
		updateEmbeddedDocuments: vi.fn(async (_type, list) => list.forEach(u => {
			const item = actor.items.find(i => i.id === u._id);
			for (const [k, v] of Object.entries(u)) if (k !== "_id") setPath(item, k, v);
		})),
	};
	return actor;
}
const heldMove = (id, name, description, { slug = SLUG, playbook = "The Tester" } = {}) =>
	({ id, type: "move", name, system: { playbook, description, moveType: "playbook" }, flags: { [S]: { homebrewPlaybook: slug } } });

beforeEach(() => {
	invalidatePlaybookCatalog();
	const { items, folders } = world();
	vi.stubGlobal("game", { items, folders, actors: [], user: { isGM: true }, system: { version: "test" } });
});
afterEach(() => { vi.unstubAllGlobals(); invalidatePlaybookCatalog(); });

describe("renaming a playbook someone plays", () => {
	it("is no longer refused", () => {
		const existing = { name: "The Tester", system: { slug: SLUG } };
		expect(saveProblem(tester("The Prober"), existing)).toBeNull();
	});

	it("follows onto every holder: their record, an unfinished pick, and their copies of its moves only", async () => {
		const bookProd = { id: "x", type: "move", name: "Prod", system: { playbook: "The Fox" }, flags: {} };
		const ann = holder("Ann", { moves: [heldMove("a1", "Prod", "Poke it."), bookProd] });
		const ben = holder("Ben", { slug: "", playbookName: "" });
		ben.system.playbook = {};
		ben.flags[S].onboardingProgress = { playbook: "The Tester" };
		const cat = holder("Cat", { slug: "homebrew-other", playbookName: "The Other" });
		await cascadeRename(SLUG, "The Tester", "The Prober", [ann, ben, cat]);
		expect(ann.system.playbook.name).toBe("The Prober");
		expect(ann.items[0].system.playbook).toBe("The Prober");
		expect(bookProd.system.playbook).toBe("The Fox");
		expect(ben.flags[S].onboardingProgress.playbook).toBe("The Prober");
		expect(cat.update).not.toHaveBeenCalled();
		// Quiet in the ledger: nothing about the character changed.
		expect(ann.update.mock.calls[0][1]).toEqual({ stonetopLedger: true });
	});
});

describe("characters' older copies of its moves", () => {
	function seed() {
		const { moves } = bundleToItemData(tester(), { slug: SLUG });
		moves.forEach((m, i) => game.items.push({ ...m, id: `w${i}`, _id: `w${i}` }));
		invalidatePlaybookCatalog();
	}

	it("are found by the homebrew flag and the name, never a book move of the same name", () => {
		seed();
		const bookProd = { id: "x", type: "move", name: "Prod", system: { playbook: "The Fox", description: "<p>Different.</p>" }, flags: {} };
		const ann = holder("Ann", { moves: [heldMove("a1", "Prod", "<p>An old wording.</p>"), bookProd] });
		const stale = staleHeldCopies(SLUG, { actors: [ann] });
		expect(stale.map(s => [s.actor.name, s.item.id])).toEqual([["Ann", "a1"]]);
		expect(stale[0].update["system.description"]).toBe("<p>Poke it.</p>");
	});

	it("are brought up to date on request, and then nothing is stale", async () => {
		seed();
		const ann = holder("Ann", { moves: [heldMove("a1", "Prod", "<p>An old wording.</p>")] });
		expect(await refreshHeldCopies(SLUG, { actors: [ann] })).toBe(1);
		expect(ann.items[0].system.description).toBe("<p>Poke it.</p>");
		expect(ann.updateEmbeddedDocuments.mock.calls[0][2]).toEqual({ stonetopLedger: true });
		expect(staleHeldCopies(SLUG, { actors: [ann] })).toEqual([]);
	});
});

describe("the copy a character carries", () => {
	it("is a shareable file's worth, read back as the same playbook", async () => {
		const ann = holder("Ann");
		await carryPlaybookCopy(ann, tester());
		expect(ann.flags[S][PLAYBOOK_COPY_FLAG]).toMatchObject({ format: "stonetop-homebrew-playbook" });
		expect(carriedPlaybook(ann).moves.map(m => m.name)).toEqual(["Prod", "Poke"]);
	});

	it("brings the playbook back under its own slug, so the character links to it again", async () => {
		const ann = holder("Ann");
		await carryPlaybookCopy(ann, tester());
		const item = await restoreCarriedPlaybook(ann);
		expect(item.system.slug).toBe(SLUG);
		expect(homebrewPlaybookBySlug(SLUG)?.name).toBe("The Tester");
		expect(game.items.filter(i => i.type === "move").map(m => m.name).sort()).toEqual(["Poke", "Prod"]);
		// Nothing to do once it is here.
		expect(await restoreCarriedPlaybook(ann)).toBeNull();
	});

	it("takes a '(restored)' name when another homebrew playbook has its name, and the character follows", async () => {
		const other = bundleToItemData(tester(), { slug: "homebrew-the-tester-2" }).playbook;
		game.items.push({ ...other, id: "o1", _id: "o1" });
		invalidatePlaybookCatalog();
		const ann = holder("Ann");
		await carryPlaybookCopy(ann, tester());
		const item = await restoreCarriedPlaybook(ann);
		expect(item.name).toBe("The Tester (restored)");
		expect(ann.system.playbook.name).toBe("The Tester (restored)");
	});

	it("renames EVERY character on the restored slug, and none mid-creation on the other playbook of that name", async () => {
		const other = bundleToItemData(tester(), { slug: "homebrew-the-tester-2" }).playbook;
		game.items.push({ ...other, id: "o1", _id: "o1" });
		invalidatePlaybookCatalog();
		const ann = holder("Ann");
		const ben = holder("Ben");
		// Picked the OTHER "The Tester" by name in an unfinished creation.
		const cat = holder("Cat", { slug: "", playbookName: "" });
		cat.flags[S].onboardingProgress = { playbook: "The Tester" };
		game.actors = [ann, ben, cat];
		await carryPlaybookCopy(ann, tester());
		await restoreCarriedPlaybook(ann);
		expect(ben.system.playbook.name).toBe("The Tester (restored)");
		expect(cat.flags[S].onboardingProgress.playbook).toBe("The Tester");
	});

	it("comes back hidden from players, whatever the world it came from showed", async () => {
		const ann = holder("Ann");
		await carryPlaybookCopy(ann, tester());
		const item = await restoreCarriedPlaybook(ann);
		expect(item.flags.stonetop.homebrew.published).toBe(false);
	});
});

describe("a copy of some OTHER playbook", () => {
	it("isn't offered or restored under the playbook the character plays now", async () => {
		const { carriedCopyOf } = await import("../../module/playbooks/homebrew-missing.js");
		const ann = holder("Ann");
		const copyOfA = tester();
		copyOfA.playbook.slug = "homebrew-something-else";
		await carryPlaybookCopy(ann, copyOfA);
		expect(carriedCopyOf(ann)).toBeNull();
		expect(carriedPlaybook(ann)).toBeNull();
		expect(await restoreCarriedPlaybook(ann)).toBeNull();
		expect(homebrewPlaybookBySlug(SLUG)).toBeNull();
	});
});

describe("who sees the playbook Item", () => {
	it("is everyone, draft or not: taking one is what's gated", async () => {
		const draft = tester();
		draft.playbook.published = false;
		const { item } = await saveHomebrewPlaybook(draft);
		expect(item.ownership.default).toBe(2);
		expect(game.items.filter(i => i.type === "move").every(m => m.ownership.default === 2)).toBe(true);
	});
});

describe("a save's copy for the characters who play it", () => {
	it("is the playbook as read back from the world, with its slug, so a second save of the same thing writes nothing", async () => {
		const { item } = await saveHomebrewPlaybook(tester());
		const ann = holder("Ann", { slug: item.system.slug });
		game.actors = [ann];
		await saveHomebrewPlaybook(tester(), { existing: item });
		expect(ann.flags[S][PLAYBOOK_COPY_FLAG].playbook.slug).toBe(item.system.slug);
		ann.update.mockClear();
		await saveHomebrewPlaybook(tester(), { existing: item });
		expect(ann.update).not.toHaveBeenCalled();
	});
});

describe("characters whose homebrew playbook isn't here", () => {
	it("are found by their recorded slug; the book's playbooks and present ones are not", async () => {
		const { charactersMissingPlaybook } = await import("../../module/playbooks/homebrew-missing.js");
		const gone = holder("Ann");
		const fox = holder("Ben", { slug: "the-fox", playbookName: "The Fox" });
		const none = holder("Cat", { slug: "", playbookName: "" });
		expect(charactersMissingPlaybook([gone, fox, none]).map(a => a.name)).toEqual(["Ann"]);
		await carryPlaybookCopy(gone, tester());
		await restoreCarriedPlaybook(gone);
		expect(charactersMissingPlaybook([gone])).toEqual([]);
	});
});
