import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStonetopItemClass } from "../../module/item/StonetopItem.js";
import { shippedArcanumSlugs, resetShippedArcanumSlugs } from "../../module/item/createArcanum.js";
import { resetPackIndexFields } from "../../module/utils/pack-index.js";
import { ARCANA_PACK } from "../../module/actors/character/StonetopFlags.js";

// HB-3 / A13: a shipped card dragged out of the arcana pack into the world kept its pack slug, so
// the pack copy always won: the world copy's edits reached no sheet and the browser hid it.
// HB-7: core's "Import Data" on a world card is an update carrying the whole exported document,
// so importing card B onto card A handed A card B's slug.

let warn;
beforeEach(() => {
	globalThis.foundry = { ...globalThis.foundry, utils: { ...globalThis.foundry.utils, randomID: vi.fn(() => "NEWNEWNEWNEWNEWN") } };
	warn = vi.fn();
	globalThis.ui = { notifications: { warn, info: vi.fn(), error: vi.fn() } };
	resetShippedArcanumSlugs();
	resetPackIndexFields();
	globalThis.game = { items: [] };
});

function withPack(slugs) {
	const index = slugs.map((slug, i) => ({ _id: `id${i}`, flags: { stonetop: { slug } } }));
	const pack = { index, indexFields: [], getIndex: vi.fn(async () => index) };
	globalThis.game.packs = { get: name => (name === ARCANA_PACK ? pack : undefined) };
	return pack;
}

function pending(source) {
	const Base = class {
		constructor(data) { Object.assign(this, data); }
		async _preCreate() { return undefined; }
		async _preUpdate() { return undefined; }
	};
	const item = new (createStonetopItemClass(Base))(source);
	item.updateSource = vi.fn(patch => {
		for (const [path, value] of Object.entries(patch)) {
			const keys = path.split(".");
			let at = item;
			for (const key of keys.slice(0, -1)) at = (at[key] ??= {});
			at[keys.at(-1)] = value;
		}
	});
	return item;
}

const arcanum = (slug, extra = {}) => ({
	name: "Card", type: "move", system: { moveType: "arcanum" }, flags: { stonetop: { slug } }, ...extra,
});

describe("HB-3: a shipped card copied into the world gets a slug of its own", () => {
	it("re-mints a minor's pack slug, read off the arcana pack's index", async () => {
		withPack(["old-scroll-case", "the-key"]);
		const item = pending(arcanum("the-key"));
		await item._preCreate({}, {}, {});
		expect(item.flags.stonetop.slug).toBe("arc-NEWNEWNEWNEWNEWN");
	});

	it("re-mints a shipped major even when the pack can't be read (the registered majors)", async () => {
		const item = pending(arcanum("mindgem"));
		await item._preCreate({}, {}, {});
		expect(item.flags.stonetop.slug).toBe("arc-NEWNEWNEWNEWNEWN");
	});

	it("keeps a homebrew backup's slug", async () => {
		withPack(["the-key"]);
		const item = pending(arcanum("arc-mybackupcard01"));
		await item._preCreate({}, {}, {});
		expect(item.updateSource).not.toHaveBeenCalled();
		expect(item.flags.stonetop.slug).toBe("arc-mybackupcard01");
	});

	it("leaves the pack's own cards, and a card on an actor, alone", async () => {
		withPack(["the-key"]);
		const inPack = pending(arcanum("the-key", { pack: ARCANA_PACK }));
		await inPack._preCreate({}, {}, {});
		expect(inPack.flags.stonetop.slug).toBe("the-key");
		const onActor = pending(arcanum("the-key", { parent: { type: "character" } }));
		await onActor._preCreate({}, {}, {});
		expect(onActor.flags.stonetop.slug).toBe("the-key");
	});

	it("remembers the shipped slugs once the pack has answered", async () => {
		const pack = withPack(["the-key"]);
		await shippedArcanumSlugs();
		await shippedArcanumSlugs();
		expect((await shippedArcanumSlugs()).has("the-key")).toBe(true);
		expect(pack.getIndex.mock.calls.length).toBeLessThanOrEqual(1);
	});
});

describe("HB-7: an update can't hand a card another card's slug", () => {
	beforeEach(() => {
		globalThis.game.items = [
			{ id: "A", flags: { stonetop: { slug: "arc-aaaaaaaaaaaaaaaa" } } },
			{ id: "B", flags: { stonetop: { slug: "arc-bbbbbbbbbbbbbbbb" } } },
		];
	});
	const cardA = () => pending(arcanum("arc-aaaaaaaaaaaaaaaa", { id: "A" }));

	it("Import Data of card B onto card A keeps A's slug, and says so", async () => {
		const changed = { name: "B", flags: { stonetop: { slug: "arc-bbbbbbbbbbbbbbbb", front: { title: "B" } } } };
		await cardA()._preUpdate(changed, { diff: false, recursive: false }, {});
		expect(changed.flags.stonetop.slug).toBe("arc-aaaaaaaaaaaaaaaa");
		expect(changed.flags.stonetop.front.title).toBe("B");
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("refuses a dotted slug change onto a shipped slug", async () => {
		const changed = { "flags.stonetop.slug": "mindgem" };
		await cardA()._preUpdate(changed, {}, {});
		expect(changed["flags.stonetop.slug"]).toBe("arc-aaaaaaaaaaaaaaaa");
	});

	it("lets a card keep its own slug, or move to a free one, quietly", async () => {
		const same = { flags: { stonetop: { slug: "arc-aaaaaaaaaaaaaaaa" } } };
		await cardA()._preUpdate(same, {}, {});
		expect(same.flags.stonetop.slug).toBe("arc-aaaaaaaaaaaaaaaa");
		const free = { flags: { stonetop: { slug: "arc-cccccccccccccccc" } } };
		await cardA()._preUpdate(free, {}, {});
		expect(free.flags.stonetop.slug).toBe("arc-cccccccccccccccc");
		expect(warn).not.toHaveBeenCalled();
	});

	it("never blanks a slug", async () => {
		const changed = { flags: { stonetop: { slug: "" } } };
		await cardA()._preUpdate(changed, {}, {});
		expect(changed.flags.stonetop.slug).toBe("arc-aaaaaaaaaaaaaaaa");
	});

	it("ignores updates that don't touch the slug, and other items", async () => {
		const changed = { name: "Renamed" };
		await cardA()._preUpdate(changed, {}, {});
		expect(changed).toEqual({ name: "Renamed" });
		const rope = pending({ id: "R", type: "move", system: { moveType: "inventory" } });
		const other = { flags: { stonetop: { slug: "arc-bbbbbbbbbbbbbbbb" } } };
		await rope._preUpdate(other, {}, {});
		expect(other.flags.stonetop.slug).toBe("arc-bbbbbbbbbbbbbbbb");
	});

	it("honours a refusal from the class beneath", async () => {
		const Base = class { async _preUpdate() { return false; } };
		const item = new (createStonetopItemClass(Base))();
		Object.assign(item, arcanum("arc-aaaaaaaaaaaaaaaa", { id: "A" }));
		expect(await item._preUpdate({ flags: { stonetop: { slug: "arc-bbbbbbbbbbbbbbbb" } } }, {}, {})).toBe(false);
	});
});
