import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RequisitionDialog } from "../../../module/actors/character/dialogs/RequisitionDialog.js";
import { STEADING_DEFAULTS, HERD_ASSET_NAME } from "../../../module/actors/steading/StonetopSteading.js";
import { fakeForm, stubAsk } from "../../fakes/confirm.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function makeDialog(assets, items = []) {
	const steadingActor = {
		name: "Stonetop",
		system: {},
		flags: { "stonetop-pwd": { steading: { assets } } },
		getFlag: (scope, key) => steadingActor.flags[scope]?.[key],
		setFlag: vi.fn(),
	};
	return new RequisitionDialog(
		{ addCustomInventoryItem: vi.fn() },
		{ id: "hero1", name: "Wren", type: "character", items, getFlag: vi.fn(), update: vi.fn() },
		steadingActor,
		vi.fn()
	);
}

const logistics = (learned = true) => ({ type: "move", name: "Logistics", flags: learned ? {} : { "stonetop-pwd": { learned: false } } });

function makeRoot(elements) {
	return {
		querySelector: selector => elements[selector] ?? null,
	};
}

describe("RequisitionDialog", () => {
	it("resolves an on-hand steading asset selected from the dropdown", () => {
		const dialog = makeDialog([
			{ name: "Horses", checked: true },
			{ name: "Wagon", checked: true },
		]);
		const root = makeRoot({
			".stonetop-requisition-asset-select": { value: "1" },
		});

		expect(dialog._getChosenAsset(root)).toMatchObject({ index: 1, name: "Wagon" });
	});

	it("resolves a trimmed custom requisition entry", () => {
		const dialog = makeDialog([{ name: "Horses", checked: true }]);
		const root = makeRoot({
			".stonetop-requisition-asset-select": { value: "__custom__" },
			".stonetop-requisition-custom-input": { value: "  iron spikes  " },
		});

		expect(dialog._getChosenAsset(root)).toEqual({ name: "iron spikes" });
	});

	it("resolves a default on-hand asset on a steading whose assets flag was never written", () => {
		// The dropdown is built from getAvailableAssets() (which falls back to STEADING_DEFAULTS),
		// so selecting a default asset must resolve its name — not "" — even with no assets flag.
		const dialog = makeDialog(undefined);
		const root = makeRoot({
			".stonetop-requisition-asset-select": { value: "0" },
		});

		expect(dialog._getChosenAsset(root)).toMatchObject({ index: 0, name: STEADING_DEFAULTS.assets[0].name });
	});

	it("gives a seeded asset stored without a beast field its default's back, by name", () => {
		// A world seeded before rows carried `beast`: the plows must not read as horses.
		const stored = STEADING_DEFAULTS.assets.filter(a => a.name).map(({ name, checked }) => ({ name, checked }));
		const dialog = makeDialog(stored);
		const pick = value => dialog._getChosenAsset(makeRoot({ ".stonetop-requisition-asset-select": { value } })).asset;
		expect(pick("0").beast).toEqual({ slug: "horse", count: 2, traits: ["hardy"] });
		expect(pick("1").beast).toBeNull();
		const custom = makeDialog([{ name: "Two old ponies", checked: true }]);
		expect(custom._getChosenAsset(makeRoot({ ".stonetop-requisition-asset-select": { value: "0" } })).asset.beast).toBeUndefined();
	});

	// The Marshal's Logistics: "when you Requisition, you have advantage".
	it("asks the Logistics line for a character who has it learned, and only them", () => {
		expect(makeDialog([], [logistics()]).getData().logistics).toBe("Logistics (Wren): they are the one Requisitioning, advantage");
		expect(makeDialog([], [logistics(false)]).getData().logistics).toBe("");
		expect(makeDialog([], []).getData().logistics).toBe("");
	});

	it("renders the Logistics line pre-ticked, and reads it back as the roll's answer", () => {
		const hbs = fs.readFileSync(path.resolve(HERE, "../../../templates/dialogs/requisition-picker.hbs"), "utf8");
		expect(hbs).toMatch(/name="logistics" checked>/);
		const dialog = makeDialog([]);
		expect(dialog._rollAnswers(makeRoot({ '[name="logistics"]': { checked: true } }))).toEqual({ herdCount: 0, logistics: true });
		expect(dialog._rollAnswers(makeRoot({ '[name="logistics"]': { checked: false } }))).toEqual({ herdCount: 0, logistics: false });
	});

	// Book I p. 157 (Herd of Horses): "When you Requisition half the herd or less, treat a 6- as a
	// 7-9." Asked as a COUNT, capped at the grown horses, and read back for the roll.
	it("asks how many horses come from the herd, and reads the count back for the roll", () => {
		const dialog = makeDialog([]);
		dialog._steadingActor.flags["stonetop-pwd"].steading = { improvements: { herdOfHorses: { completed: true } }, herd: { grown: 9, yearlings: 3, foals: 0 } };
		expect(dialog.getData().herdQuestion).toMatchObject({ max: 9 });
		expect(dialog.getData().herdQuestion.label).toMatch(/of 12/);
		expect(dialog._rollAnswers(makeRoot({ '[name="herdCount"]': { value: "4" } }))).toEqual({ herdCount: 4, logistics: false });
		const hbs = fs.readFileSync(path.resolve(HERE, "../../../templates/dialogs/requisition-picker.hbs"), "utf8");
		expect(hbs).toContain(`name="herdCount"`);
		expect(hbs).not.toContain(`name="herdShare"`);
		expect(makeDialog([]).getData().herdQuestion).toBeNull();
	});

	// The user's ruling: "Ask, take from herd". The herd's row is not lent out whole; so many
	// horses leave the herd, each a follower, and the row stays on hand.
	it("takes the asked number of horses out of the herd as followers, leaving the herd's row home", async () => {
		let n = 0;
		const info = vi.fn();
		vi.stubGlobal("foundry", { ...globalThis.foundry, utils: { ...globalThis.foundry.utils, randomID: () => `id${++n}` } });
		vi.stubGlobal("ui", { notifications: { info, warn: vi.fn() } });
		try {
			const dialog = makeDialog([{ name: HERD_ASSET_NAME, checked: true, beast: { slug: "horse", herd: true } }]);
			const steading = dialog._steadingActor.flags["stonetop-pwd"].steading;
			Object.assign(steading, { improvements: { herdOfHorses: { completed: true } }, herd: { grown: 10, yearlings: 2, foals: 1 } });
			dialog._steadingActor.update = vi.fn(async data => {
				steading.herd = data["flags.stonetop-pwd.steading.herd"];
			});
			dialog.render = vi.fn();
			const asked = stubAsk("take", fakeForm({ horses: { value: "3" } }));

			expect(await dialog._takeFromHerd(makeRoot({ '[name="herdCount"]': { value: "3" } }))).toBe(true);

			// Asked first, defaulting to the count the roll was made for.
			expect(asked.mock.calls[0][0].content).toContain(`value="3"`);
			expect(asked.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Take them from the herd", "Take none"]);
			expect(steading.herd).toEqual({ grown: 7, yearlings: 2, foals: 1 });
			expect(dialog._character.addCustomInventoryItem).toHaveBeenCalledWith("3 horses from the herd", 1);
			const written = Object.values(dialog._characterActor.update.mock.calls[0][0]);
			expect(written.map(f => f.name)).toEqual(["Horse 1", "Horse 2", "Horse 3"]);
			expect(written[0].notes).toMatch(/^Requisitioned from the herd of horses\./);
			// The herd itself is never marked out.
			expect(dialog._steadingActor.setFlag).not.toHaveBeenCalled();
			expect(steading.assets[0].takenBy).toBeUndefined();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("defaults to two horses, and takes none when told so", async () => {
		vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn() } });
		try {
			const dialog = makeDialog([]);
			Object.assign(dialog._steadingActor.flags["stonetop-pwd"].steading, { improvements: { herdOfHorses: { completed: true } }, herd: { grown: 10 } });
			dialog._steadingActor.update = vi.fn();
			const asked = stubAsk("none");
			expect(await dialog._takeFromHerd(makeRoot({}))).toBe(false);
			expect(asked.mock.calls[0][0].content).toContain(`value="2"`);
			expect(dialog._steadingActor.update).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// The steading playbook's "A pair of hardy draft horses, followers (large, powerful,
	// keen-nosed, hardy)": the requisitioned follower is a hardy horse, with no choice left open.
	// "A pair" is two horses: one card each, numbered, in one write, in tab order.
	it("adds the steading's pair of draft horses as two hardy horse followers", async () => {
		let n = 0;
		const info = vi.fn();
		vi.stubGlobal("foundry", { utils: { randomID: () => `id${++n}` } });
		vi.stubGlobal("ui", { notifications: { info } });
		try {
			const dialog = makeDialog([]);
			const assetName = STEADING_DEFAULTS.assets.find(a => /draft horses/.test(a.name)).name;
			const match = (await import("../../../module/data/beasts.js")).beastFollowerForAsset(assetName);
			await dialog._addRequisitionedFollower(match, assetName);
			expect(dialog._characterActor.update).toHaveBeenCalledTimes(1);
			const written = Object.values(dialog._characterActor.update.mock.calls[0][0]);
			expect(written.map(f => f.name)).toEqual(["Horse 1", "Horse 2"]);
			expect(written[1].order).toBe(written[0].order + 1);
			for (const f of written) {
				expect(f.tags).toContain("hardy");
				// The seeded asset line trails a dashed stat block; the note names the asset only.
				expect(f.notes).toBe("Requisitioned from A pair of hardy draft horses.");
			}
			expect(info).toHaveBeenCalledWith("Horse 1 & Horse 2 added to your followers.");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// Book I p.308: "on a 6-, don't mark XP--you can take the asset with you, but if you do, reduce
	// Fortunes by 1". The window's Take reads its last roll's card.
	describe("taking on a 6-", () => {
		const missCard = (flags = {}) => ({
			rolls: [{ total: 5 }],
			getFlag: vi.fn((scope, key) => flags[key]),
			setFlag: vi.fn(async (scope, key, value) => { flags[key] = value; }),
			unsetFlag: vi.fn(async (scope, key) => { delete flags[key]; }),
		});
		const ownedDialog = fortunes => {
			const dialog = makeDialog([{ name: "A wagon", checked: true }]);
			dialog._steadingActor.isOwner = true;
			dialog._steadingActor.system = { stats: { fortunes: { value: fortunes } } };
			dialog._steadingActor.update = vi.fn(async () => {});
			return dialog;
		};

		it("asks, then pays 1 Fortunes and stamps the card so its button cannot charge it again", async () => {
			vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn() } });
			try {
				const dialog = ownedDialog(1);
				const card = missCard();
				dialog._lastRoll = { message: card, herdCount: 0 };
				const ask = vi.fn(async () => "take");
				expect(await dialog._payMissOnTake("A wagon", { ask })).toBe(true);
				expect(ask).toHaveBeenCalledTimes(1);
				const [data, options] = dialog._steadingActor.update.mock.calls[0];
				expect(data["system.stats.fortunes.value"]).toBe(0);
				expect(options).toEqual({ stonetopMove: "Requisition" });
				expect(card.setFlag).toHaveBeenCalledWith("stonetop-pwd", "requisitionMissCostApplied", true);
				// Paid once: a second Take off the same card asks nothing.
				ask.mockClear();
				expect(await dialog._payMissOnTake("A wagon", { ask })).toBe(true);
				expect(ask).not.toHaveBeenCalled();
			} finally {
				vi.unstubAllGlobals();
			}
		});

		// Latched first: a window that could pay but not write the card would leave the card's own button
		// to charge the cost a second time.
		it("stamps the card before it pays, and pays nothing when the card cannot be written", async () => {
			const warn = vi.fn();
			vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn } });
			vi.spyOn(console, "warn").mockImplementation(() => {});
			try {
				const dialog = ownedDialog(1);
				const card = missCard();
				let stampedFirst = null;
				dialog._steadingActor.update = vi.fn(async () => { stampedFirst = card.setFlag.mock.calls.length === 1; });
				dialog._lastRoll = { message: card, herdCount: 0 };
				expect(await dialog._payMissOnTake("A wagon", { ask: async () => "take" })).toBe(true);
				expect(stampedFirst).toBe(true);

				const locked = ownedDialog(1);
				const lockedCard = { ...missCard(), setFlag: vi.fn(async () => { throw new Error("no permission"); }) };
				locked._lastRoll = { message: lockedCard, herdCount: 0 };
				expect(await locked._payMissOnTake("A wagon", { ask: async () => "take" })).toBe(true);
				expect(locked._steadingActor.update).not.toHaveBeenCalled();
				expect(warn.mock.calls[0][0]).toContain("Take it on a miss");
			} finally {
				vi.restoreAllMocks();
				vi.unstubAllGlobals();
			}
		});

		it("takes the card's stamp back when the payment throws", async () => {
			vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn() } });
			try {
				const dialog = ownedDialog(1);
				const card = missCard();
				dialog._steadingActor.update = vi.fn(async () => { throw new Error("write failed"); });
				dialog._lastRoll = { message: card, herdCount: 0 };
				await expect(dialog._payMissOnTake("A wagon", { ask: async () => "take" })).rejects.toThrow("write failed");
				expect(card.unsetFlag).toHaveBeenCalledWith("stonetop-pwd", "requisitionMissCostApplied");
				expect(card.getFlag("stonetop-pwd", "requisitionMissCostApplied")).toBeUndefined();
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it("takes nothing when the player leaves it, and asks nothing after a hit", async () => {
			const dialog = ownedDialog(1);
			dialog._lastRoll = { message: missCard(), herdCount: 0 };
			expect(await dialog._payMissOnTake("A wagon", { ask: async () => null })).toBe(false);
			expect(dialog._steadingActor.update).not.toHaveBeenCalled();
			dialog._lastRoll = { message: { ...missCard(), rolls: [{ total: 8 }] }, herdCount: 0 };
			const ask = vi.fn();
			expect(await dialog._payMissOnTake("A wagon", { ask })).toBe(true);
			expect(ask).not.toHaveBeenCalled();
		});

		// Asked first, paid only once something was taken: a horse count closed, or an asset another
		// window took meanwhile, costs nothing.
		it("pays nothing when the take itself takes nothing", async () => {
			const dialog = ownedDialog(1);
			const card = missCard();
			dialog._lastRoll = { message: card, herdCount: 0 };
			const take = vi.fn(async () => false);
			expect(await dialog._payMissOnTake("A wagon", { ask: async () => "take", take })).toBe(false);
			expect(take).toHaveBeenCalledTimes(1);
			expect(dialog._steadingActor.update).not.toHaveBeenCalled();
			expect(card.setFlag).not.toHaveBeenCalled();
			// Left, it is never taken at all.
			take.mockClear();
			expect(await dialog._payMissOnTake("A wagon", { ask: async () => null, take })).toBe(false);
			expect(take).not.toHaveBeenCalled();
		});

		it("puts the 6- cost button on its own card", () => {
			const src = fs.readFileSync(path.resolve(HERE, "../../../module/actors/character/dialogs/RequisitionDialog.js"), "utf8");
			expect(src).toContain("tierActions: { failure: requisitionMissCostAction() }");
			expect(src).toContain("this._lastRoll = { message: messageOfRoll(roll), herdCount: answers.herdCount }");
		});
	});

	// Marked out on the steading first, so a take another window beat is refused; but an item that
	// then cannot be added hands the asset back rather than leaving it out with nobody.
	it("hands the asset back to the steading when the item cannot be added", async () => {
		vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn() } });
		vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const dialog = makeDialog([{ name: "Plow", checked: true }]);
			dialog.render = vi.fn();
			dialog._steading.setAssetTaken = vi.fn(async () => true);
			dialog._steading.returnAsset = vi.fn(async () => true);
			dialog._character.addCustomInventoryItem = vi.fn(async () => { throw new Error("write failed"); });
			expect(await dialog._takeAsset({ index: 0, name: "Plow" })).toBe(false);
			expect(dialog._steading.returnAsset).toHaveBeenCalledWith(0);

			// Refused on the steading: nothing added, nothing handed back.
			dialog._steading.setAssetTaken = vi.fn(async () => false);
			dialog._steading.returnAsset.mockClear();
			dialog._character.addCustomInventoryItem = vi.fn(async () => {});
			expect(await dialog._takeAsset({ index: 0, name: "Plow" })).toBe(false);
			expect(dialog._character.addCustomInventoryItem).not.toHaveBeenCalled();
			expect(dialog._steading.returnAsset).not.toHaveBeenCalled();
		} finally {
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
		}
	});

	// The herd count the roll was made for is what "half the herd or less" was read against, so the
	// take cannot go past it.
	it("caps the herd take at the count the roll was made for", async () => {
		vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn() } });
		try {
			const dialog = makeDialog([]);
			Object.assign(dialog._steadingActor.flags["stonetop-pwd"].steading, { improvements: { herdOfHorses: { completed: true } }, herd: { grown: 12 } });
			dialog._steadingActor.update = vi.fn();
			dialog._lastRoll = { message: null, herdCount: 4 };
			const asked = stubAsk("none");
			await dialog._takeFromHerd(makeRoot({}));
			expect(asked.mock.calls[0][0].content).toContain(`max="4"`);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("adds a lone animal as one follower under its plain name", async () => {
		vi.stubGlobal("foundry", { utils: { randomID: () => "abc" } });
		vi.stubGlobal("ui", { notifications: { info: vi.fn() } });
		try {
			const dialog = makeDialog([]);
			const match = (await import("../../../module/data/beasts.js")).beastFollowerForAsset("A sturdy mule");
			await dialog._addRequisitionedFollower(match, "A sturdy mule");
			const written = Object.values(dialog._characterActor.update.mock.calls[0][0]);
			expect(written.map(f => f.name)).toEqual(["Mule"]);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
