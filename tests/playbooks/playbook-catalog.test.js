import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	SHIPPED_PLAYBOOKS, isHomebrewPlaybookItem, homebrewPlaybookBySlug, homebrewPlaybookByName,
	homebrewPlaybookMoves, homebrewMoveById, allPlaybookNames, playbookAvatar, homebrewPickerRows,
	homebrewIntroData, homebrewMoveGroups, mintHomebrewSlug, playbookNameProblem, invalidatePlaybookCatalog,
	HOMEBREW_PLAYBOOK_IMG,
} from "../../module/playbooks/playbook-catalog.js";
import { FoundryMoveRepository } from "../../module/actors/character/repositories/FoundryMoveRepository.js";
import { FoundryPlaybookRepository } from "../../module/actors/character/repositories/FoundryPlaybookRepository.js";
import { isPlayerAuthoredMove, bookMoveName } from "../../module/actors/character/owns-move.js";
import { refreshable } from "../../module/migration/move-refresh.js";
import { resetPackIndexFields } from "../../module/utils/pack-index.js";
import { indexingPack } from "../fakes/indexing-pack.js";

// A homebrew playbook and its moves, as the Playbook Builder writes them: the playbook's content
// under flags.stonetop (where StonetopPlaybook reads it), each move's marker under the system id.
function homebrewPlaybook({ id = "hb1", name = "The Stranger", slug = "homebrew-the-stranger", published = true, img = null, flags = {} } = {}) {
	return {
		id, _id: id, uuid: `Item.${id}`, type: "playbook", name, img,
		system: { slug },
		flags: { stonetop: { homebrew: { v: 1, published }, hp: 16, damage: "d6", ...flags } },
		asPlaybook() { return { name: this.name, slug: this.system.slug, hp: 16 }; },
	};
}
function homebrewMove({ id, name, playbook = "The Stranger", slug = "homebrew-the-stranger" }) {
	return {
		id, _id: id, type: "move", name,
		system: { moveType: "playbook", playbook, description: `<p>${name}</p>`, isStartingMove: false },
		flags: { "stonetop-pwd": { homebrewPlaybook: slug } },
	};
}
function worldItems(list) {
	const items = [...list];
	items.get = id => list.find(i => i.id === id) ?? null;
	return items;
}

const STRANGER   = homebrewPlaybook();
const PARIAH     = homebrewMove({ id: "m1", name: "Pariah" });
const OTHERKIN   = homebrewMove({ id: "m2", name: "Otherkin" });
// An official Fox move a GM dragged into the world: NO homebrew flag, so it joins nothing.
const DRAGGED_AMBUSH = { id: "m3", _id: "m3", type: "move", name: "Ambush", system: { moveType: "playbook", playbook: "The Fox" }, flags: {} };
// A copy of a shipped playbook in the world, wrongly flagged: still not homebrew.
const FAKE_FOX = homebrewPlaybook({ id: "hb2", name: "The Fox", slug: "the-fox" });

beforeEach(() => {
	invalidatePlaybookCatalog();
	vi.stubGlobal("game", { items: worldItems([STRANGER, PARIAH, OTHERKIN, DRAGGED_AMBUSH, FAKE_FOX]), packs: { get: () => null } });
});
afterEach(() => {
	vi.unstubAllGlobals();
	invalidatePlaybookCatalog();
	resetPackIndexFields();
});

describe("playbook catalog: what counts as homebrew", () => {
	it("is a world playbook with the homebrew flag and a slug no shipped playbook or insert owns", () => {
		expect(isHomebrewPlaybookItem(STRANGER)).toBe(true);
		expect(isHomebrewPlaybookItem(FAKE_FOX)).toBe(false);
		expect(isHomebrewPlaybookItem(homebrewPlaybook({ slug: "ghost" }))).toBe(false);
		expect(isHomebrewPlaybookItem({ ...STRANGER, flags: { stonetop: {} } })).toBe(false);
		expect(isHomebrewPlaybookItem(PARIAH)).toBe(false);
	});

	it("finds a homebrew playbook by slug and by name, case-insensitively", () => {
		expect(homebrewPlaybookBySlug("homebrew-the-stranger")).toBe(STRANGER);
		expect(homebrewPlaybookByName("the stranger")).toBe(STRANGER);
		expect(homebrewPlaybookBySlug("the-fox")).toBeNull();
	});

	it("lists only flagged moves, so a dragged-in official move never doubles a list", () => {
		expect(homebrewPlaybookMoves("The Stranger").map(m => m.name)).toEqual(["Pariah", "Otherkin"]);
		expect(homebrewPlaybookMoves("The Fox")).toEqual([]);
		expect(homebrewMoveById("m1")).toBe(PARIAH);
		expect(homebrewMoveById("m3")).toBeNull();
	});

	it("drops a flagged move whose playbook name no longer matches (mid-rename)", () => {
		const stray = homebrewMove({ id: "m9", name: "Stray", playbook: "Old Name" });
		const items = worldItems([STRANGER, PARIAH, stray]);
		expect(homebrewPlaybookMoves("The Stranger", items).map(m => m.name)).toEqual(["Pariah"]);
	});

	it("rebuilds after an Item changes", () => {
		expect(homebrewPlaybookBySlug("homebrew-new")).toBeNull();
		game.items.push(homebrewPlaybook({ id: "hb3", name: "The New One", slug: "homebrew-new" }));
		invalidatePlaybookCatalog();
		expect(homebrewPlaybookBySlug("homebrew-new")?.name).toBe("The New One");
	});
});

describe("playbook catalog: lists and art", () => {
	it("allPlaybookNames is the nine shipped, then the homebrew ones", () => {
		const names = allPlaybookNames();
		expect(names.slice(0, 9)).toEqual(SHIPPED_PLAYBOOKS.map(p => p.name));
		expect(names.slice(9)).toEqual(["The Stranger"]);
		expect(allPlaybookNames({ includeHomebrew: false })).toHaveLength(9);
	});

	it("allPlaybookNames leaves out a draft unless asked, so its moves reach no other playbook's picks", () => {
		const draft = homebrewPlaybook({ id: "hb4", name: "The Draft", slug: "homebrew-draft", published: false });
		const items = worldItems([STRANGER, draft]);
		expect(allPlaybookNames({ items }).slice(9)).toEqual(["The Stranger"]);
		expect(allPlaybookNames({ items, drafts: true }).slice(9)).toEqual(["The Draft", "The Stranger"]);
	});

	it("a shipped slug gets its badge; homebrew gets its own picture or a generic book", () => {
		expect(playbookAvatar("the-fox")).toMatch(/assets\/icons\/playbooks\/the_fox_icon\.webp$/);
		expect(playbookAvatar("homebrew-the-stranger")).toBe(HOMEBREW_PLAYBOOK_IMG);
		expect(playbookAvatar("homebrew-x", { img: "worlds/w/stranger.webp" })).toBe("worlds/w/stranger.webp");
		expect(playbookAvatar("homebrew-x", { img: "icons/svg/item-bag.svg" })).toBe(HOMEBREW_PLAYBOOK_IMG);
		expect(playbookAvatar(null)).toBeNull();
	});

	it("a player's picker shows published homebrew only; the GM sees drafts, marked", () => {
		const draft = homebrewPlaybook({ id: "hb4", name: "The Draft", slug: "homebrew-the-draft", published: false });
		const items = worldItems([STRANGER, draft]);
		expect(homebrewPickerRows({ isGM: false, items }).map(r => r.name)).toEqual(["The Stranger"]);
		const gmRows = homebrewPickerRows({ isGM: true, items });
		expect(gmRows.map(r => [r.name, r.draft])).toEqual([["The Draft", true], ["The Stranger", false]]);
		expect(gmRows[0]).toMatchObject({ homebrew: true, slug: "homebrew-the-draft", uuid: "Item.hb4" });
	});

	it("reads a homebrew playbook's intro questions and move groups, tidied", () => {
		const pb = homebrewPlaybook({ flags: {
			introductions: { step3: "  Tell us of your shame. ", step4: ["Who is your kin?", "", null], step6: ["Who loves the night?"] },
			moveGroups: [{ key: "night", label: "Night", moves: ["Pariah"] }, { label: "empty", moves: [] }],
		} });
		const items = worldItems([pb]);
		expect(homebrewIntroData("homebrew-the-stranger", items)).toEqual({
			step3: "Tell us of your shame.", step4: ["Who is your kin?"], step6: ["Who loves the night?"],
		});
		expect(homebrewMoveGroups("The Stranger", items)).toEqual([{ key: "night", label: "Night", moves: ["Pariah"] }]);
		expect(homebrewIntroData("homebrew-nope", items)).toBeNull();
	});
});

describe("playbook catalog: minting slugs and checking names", () => {
	it("mints homebrew-<slug>, suffixed when taken, never a reserved one", () => {
		expect(mintHomebrewSlug("The Familiar Face")).toBe("homebrew-the-familiar-face");
		expect(mintHomebrewSlug("The Stranger")).toBe("homebrew-the-stranger-2");
		expect(mintHomebrewSlug("!!!")).toBe("homebrew-playbook");
	});

	it("refuses an empty name, a shipped playbook's name, and another homebrew playbook's", () => {
		expect(playbookNameProblem("  ")).toBe("empty");
		expect(playbookNameProblem("the fox")).toBe("shipped");
		expect(playbookNameProblem("The Stranger")).toBe("taken");
		expect(playbookNameProblem("The Stranger", { ownSlug: "homebrew-the-stranger" })).toBeNull();
		expect(playbookNameProblem("The Standout")).toBeNull();
	});
});

describe("repositories read homebrew playbooks and moves", () => {
	const FOX_MOVE = { _id: "fox1", name: "Ambush", system: { moveType: "playbook", playbook: "The Fox" } };

	it("getPlaybookMoves adds a homebrew playbook's flagged moves to the pack's", async () => {
		const pack = indexingPack([FOX_MOVE]);
		game.packs = { get: () => pack };
		const repo = new FoundryMoveRepository();
		expect((await repo.getPlaybookMoves("The Fox")).map(m => m.name)).toEqual(["Ambush"]);
		const stranger = await repo.getPlaybookMoves("The Stranger");
		expect(stranger.map(m => [m.id, m.name, m.playbook])).toEqual([["m1", "Pariah", "The Stranger"], ["m2", "Otherkin", "The Stranger"]]);
	});

	it("getPlaybookMoves reads homebrew fresh, so a new move shows without a reload", async () => {
		game.packs = { get: () => indexingPack([]) };
		const repo = new FoundryMoveRepository();
		expect(await repo.getPlaybookMoves("The Stranger")).toHaveLength(2);
		game.items.push(homebrewMove({ id: "m5", name: "Creeper" }));
		invalidatePlaybookCatalog();
		expect((await repo.getPlaybookMoves("The Stranger")).map(m => m.name)).toContain("Creeper");
	});

	it("getPlaybookMoveDocument falls back to a homebrew world move, never an unflagged one", async () => {
		game.packs = { get: () => indexingPack([FOX_MOVE]) };
		const repo = new FoundryMoveRepository();
		expect((await repo.getPlaybookMoveDocument("fox1"))?.name).toBe("Ambush");
		expect(await repo.getPlaybookMoveDocument("m1")).toBe(PARIAH);
		expect(await repo.getPlaybookMoveDocument("m3")).toBeNull();
	});

	it("findBySlug falls back to a homebrew playbook, uncached", async () => {
		game.packs = { get: () => indexingPack([]) };
		const repo = new FoundryPlaybookRepository();
		expect(await repo.findBySlug("homebrew-the-stranger")).toMatchObject({ name: "The Stranger" });
		STRANGER.name = "The Stranger, Renamed";
		expect(await repo.findBySlug("homebrew-the-stranger")).toMatchObject({ name: "The Stranger, Renamed" });
		STRANGER.name = "The Stranger";
		expect(await repo.findBySlug("the-fox")).toBeNull();
	});
});

describe("a homebrew move is the table's own writing", () => {
	// A homebrew "Ambush" shares the Fox's name. Without the guard the system-update refresh would
	// write the Fox's text over it, and every book table keyed by name would treat it as the Fox's.
	const homebrewAmbush = homebrewMove({ id: "m7", name: "Ambush" });

	it("counts as player-authored, so it borrows none of the book's behaviour", () => {
		expect(isPlayerAuthoredMove(homebrewAmbush)).toBe(true);
		expect(bookMoveName(homebrewAmbush)).toBeNull();
		expect(bookMoveName(DRAGGED_AMBUSH)).toBe("Ambush");
	});

	it("is left alone by the system-update move refresh", () => {
		expect(refreshable(homebrewAmbush)).toBe(false);
		expect(refreshable(DRAGGED_AMBUSH)).toBe(true);
	});
});
