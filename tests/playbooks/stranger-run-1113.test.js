// The 11-13 play-through of the imported Stranger: Witchcraft's prices in place of Stock, Metamorphosis
// putting the Monster Compendium's form on, the Cursed background's Doom filling, a 6-'s "Mark XP" tail,
// a requirement printed in full, and the missing-playbook notice's names.

import { describe, it, expect, afterEach } from "vitest";
import { stockStandInsFrom, trackFillFrom, rollFromWords, rollBendsFrom, movesForActivities, possessionMarkedFrom, possessionMatching, possessionRollHoldFrom, lastDoorInsertsFrom } from "../../module/playbooks/move-words.js";
import { possessionGrantedByMove } from "../../module/actors/character/homebrew-move-possession.js";
import { stockSources, payableStockSources, mustAskStockSource, defaultStockSource, stockSourceChoiceLabel, stockReceipt, purseLeftNote } from "../../module/actors/character/stock-cost.js";
import { homebrewStockStandIns } from "../../module/actors/character/homebrew-roll-bends.js";
import { insertFormRollFor, settleTierEffects, tierEffectsAllowed, HOMEBREW_TIER_EFFECTS } from "../../module/actors/character/tier-effects.js";
import { requirementLabel } from "../../module/actors/character/move-requirement.js";
import { missingPlaybookNames } from "../../module/playbooks/homebrew-missing.js";
import { invalidatePlaybookCatalog } from "../../module/playbooks/playbook-catalog.js";
import { SYSTEM_ID, ITEM_FLAG_SCOPE } from "../../module/system-id.js";

const WITCHCRAFT = "Take a move from the Blessed for which you qualify. In place of Sacred Pouch uses you must mark a debility, lose 5HP, or sacrifice an item of value 1 or more. You can’t pick Improved Stat or Superior Stat.";

describe("Witchcraft: what is paid in place of Stock", () => {
	it("reads each way to pay, and only from words that say so", () => {
		expect(stockStandInsFrom(WITCHCRAFT)).toEqual([
			{ kind: "debility" }, { kind: "hp", amount: 5 }, { kind: "other", text: "sacrifice an item of value 1 or more" },
		]);
		expect(stockStandInsFrom("In lieu of Stock, you may lose 3 HP or mark a debility.")).toEqual([{ kind: "hp", amount: 3 }, { kind: "debility" }]);
		// Rites of the Land's Boon is a purse of its own (stock-cost.js), not a price read here.
		expect(stockStandInsFrom("Spend Boon in lieu of Stock, 1-for-1.")).toBeNull();
		expect(stockStandInsFrom("Mark a debility.")).toBeNull();
	});

	it("offers each as a purse that is chosen, never spent by default, with no count left", () => {
		const standIns = stockStandInsFrom(WITCHCRAFT).map(s => ({ ...s, from: "Witchcraft" }));
		const sources = stockSources({ hasPouch: false, standIns, openDebilities: [{ key: "weakened", name: "Weakened" }, { key: "dazed", name: "Dazed" }], hp: 12 });
		const payable = payableStockSources(sources, 1);
		expect(payable.map(s => stockSourceChoiceLabel(s, 1))).toEqual([
			"Mark Weakened instead (Witchcraft)", "Mark Dazed instead (Witchcraft)", "Lose 5 HP instead (Witchcraft)",
			"Sacrifice an item of value 1 or more instead (Witchcraft)",
		]);
		expect(mustAskStockSource(payable.slice(0, 1))).toBe(true);
		expect(defaultStockSource(sources, 1)).toBeNull();
		expect(stockReceipt(payable[0], 1)).toBe("Marked Weakened in place of 1 Stock");
		expect(stockReceipt(payable[2], 1, 5)).toBe("Lost 5 HP in place of 1 Stock");
		expect(stockReceipt(payable[3], 1)).toBe("In place of 1 Stock: sacrifice an item of value 1 or more");
		expect(purseLeftNote(payable[2], 1)).toBe("");
	});

	it("has no HP to give at 0 HP, and no debility to mark once all three are", () => {
		const standIns = [{ kind: "debility", from: "Witchcraft" }, { kind: "hp", amount: 5, from: "Witchcraft" }];
		expect(payableStockSources(stockSources({ hasPouch: false, standIns, openDebilities: [], hp: 0 }), 1)).toEqual([]);
	});

	it("keeps a real pouch the default, and its count in the receipt", () => {
		const sources = stockSources({ hasPouch: true, pouchMax: 3, pouchStored: 1, standIns: [{ kind: "hp", amount: 5, from: "Witchcraft" }], hp: 9 });
		expect(defaultStockSource(sources, 1).key).toBe("stock");
		expect(purseLeftNote(defaultStockSource(sources, 1), 1)).toBe(" (1 left)");
	});

	it("comes only from a LEARNED homebrew move", () => {
		const move = (name, learned = true) => ({
			type: "move", name, flags: { [SYSTEM_ID]: { homebrewPlaybook: "homebrew-the-stranger" } },
			system: { description: `<p>${WITCHCRAFT}</p>`, ...(learned ? {} : { learned: false }) },
		});
		const actor = { items: [move("Witchcraft")] };
		expect(homebrewStockStandIns(actor).map(s => `${s.kind}:${s.from}`)).toEqual(["debility:Witchcraft", "hp:Witchcraft", "other:Witchcraft"]);
		expect(homebrewStockStandIns({ items: [{ ...move("Witchcraft"), flags: {} }] })).toEqual([]);
	});
});

describe("the Cursed background's Doom", () => {
	const CURSED = "When you reveal your darkest self and transform you may add +1 to any roll and mark Doom. At 3 Doom, the GM advances a dark plot relating to your cursed lineage and resets the Doom track.";

	it("says what happens when the track fills, and whether it empties", () => {
		expect(trackFillFrom(CURSED, "Doom")).toEqual({ at: 3, resets: true, text: "At 3 Doom, the GM advances a dark plot relating to your cursed lineage and resets the Doom track." });
		expect(trackFillFrom("When you mark 4 Rot, you die.", "Rot")).toEqual({ at: 4, resets: false, text: "When you mark 4 Rot, you die." });
		expect(trackFillFrom(CURSED, "Fear")).toBeNull();
	});

	it("offers its +1 only in the form it names", () => {
		const [b] = rollBendsFrom(CURSED).map(({ text, ...rest }) => rest);
		expect(b).toEqual({ kind: "modifier", value: 1, moves: null, marks: "Doom", whileTransformed: true });
		expect(rollBendsFrom("You may add +1 to any roll and mark Doom.")[0].whileTransformed).toBeUndefined();
	});
});

describe("a 6- whose \"Mark XP\" is said after it", () => {
	it("is the 6-'s, not the move's", () => {
		const r = rollFromWords("When you do roll +CHA: on a 10+, it answers three questions; on a 7-9, it answers if you do a favor; on a 6-, death has changed it, the GM will tell you how. Mark XP.");
		expect(r.results.failure).toBe("Death has changed it, the GM will tell you how. Mark XP.");
		const m = rollFromWords("When you reveal the monster within roll +CON: on a 7+, take on its traits; on a 10+, you needn’t revert; on a 6-, as a 7+ but you lose yourself. Mark XP and the GM will indulge it for you soon.");
		expect(m.results.failure).toBe("As a 7+ but you lose yourself. Mark XP and the GM will indulge it for you soon.");
		// Said already, or not after the 6-: left as it was.
		expect(rollFromWords("Roll +CHA: on a 10+, yes; on a 7-9, maybe; on a 6-, no, and mark XP. Mark XP.").results.failure).toMatch(/^No, and mark XP\.?$/i);
		expect(rollFromWords("Roll +CHA: on a 10+, yes; on a 7-9, maybe. Then rest.").results.failure).toBe("");
	});
});

describe("a requirement printed in full", () => {
	it("is said once, without its own \"Requires\"", () => {
		expect(requirementLabel({ moves: ["Otherkin"], note: "Requires level 6+ and Otherkin" }, { level: 6 })).toBe("level 6+ and Otherkin");
		expect(requirementLabel({ note: "Requires level 2+ and the Stranger" }, { level: 2 })).toBe("level 2+ and the Stranger");
		expect(requirementLabel({ moves: ["Pariah"], note: "(Requires Pariah)" })).toBe("Pariah");
		// A note that says only part of it keeps the rest beside it, as before.
		expect(requirementLabel({ note: "Sheriff background" }, { level: 6 })).toBe("Sheriff background; level 6+");
		expect(requirementLabel({ moves: ["Pariah"], note: "Only at night" })).toBe("Pariah; Only at night");
	});
});

describe("the missing-playbook notice's names", () => {
	it("says a name played more than once with its count", () => {
		const a = (name, pb) => ({ name, system: { playbook: { name: pb } } });
		expect(missingPlaybookNames([a("Angharad", "The Stranger"), a("Angharad", "The Stranger"), a("Test", "The Familiar Face"), a("Angharad", "The Stranger")]))
			.toBe("Angharad ×3 (The Stranger), Test (The Familiar Face)");
	});
});

describe("Metamorphosis puts the insert's form on", () => {
	const SLUG = "homebrew-the-stranger";
	const results = { success: { value: "Take on its traits, armament, moves." }, partial: { value: "Take on its traits." }, failure: { value: "As a 7+ but you lose yourself to your instinct." } };
	const moveItem = (name, insert, moveResults = results) => ({
		type: "move", name, flags: { [SYSTEM_ID]: { homebrewPlaybook: SLUG, homebrewInsert: insert } },
		system: { moveResults },
	});
	const world = (form = true) => {
		invalidatePlaybookCatalog();
		globalThis.game = { items: [{ type: "playbook", name: "The Stranger", system: { slug: SLUG }, flags: { [ITEM_FLAG_SCOPE]: { homebrew: { v: 1 }, inserts: [{ key: "monster-compendium", form: { enabled: form } }] } } }] };
	};
	const character = (wearing = false) => {
		const state = { wearing };
		const items = [moveItem("Metamorphosis", { key: "monster-compendium" }), moveItem("Formless", { key: "monster-compendium", list: "monster-moves" }, {})];
		const actor = { type: "character", items, system: { playbook: { slug: SLUG } } };
		const inserts = { wearing: () => state.wearing, setWearing: async (_k, on) => { state.wearing = on; } };
		return { actor, state, model: { _homebrewInserts: inserts } };
	};
	afterEach(() => { delete globalThis.game; invalidatePlaybookCatalog(); });

	it("reads which tiers put it on, for the insert's own rolled move only", () => {
		world();
		const { actor } = character();
		expect(insertFormRollFor(actor, "Metamorphosis")).toEqual({ key: "monster-compendium", tiers: { success: true, partial: true, failure: true } });
		expect(insertFormRollFor(actor, "Formless")).toBeNull();
		expect(tierEffectsAllowed(actor, actor.items[0])).toEqual({ moveName: "Metamorphosis", only: HOMEBREW_TIER_EFFECTS });
		world(false);
		expect(insertFormRollFor(actor, "Metamorphosis")).toBeNull();
	});

	it("puts it on at the roll, and a Shift takes off only what this card put on", async () => {
		world();
		const c = character();
		const rec = await settleTierEffects(c.actor, "Metamorphosis", "partial", null, { character: c.model, only: HOMEBREW_TIER_EFFECTS });
		expect(rec.insertForm).toEqual({ key: "monster-compendium", prior: false, set: true });
		expect(c.state.wearing).toBe(true);
		// A form already worn before the roll is the player's, and stays.
		const worn = character(true);
		const r2 = await settleTierEffects(worn.actor, "Metamorphosis", "success", null, { character: worn.model, only: HOMEBREW_TIER_EFFECTS });
		expect(r2.insertForm).toEqual({ key: "monster-compendium", prior: true, set: false });
	});

	it("leaves the form off for a tier whose words don't put it on, and takes back its own on a move off", async () => {
		world();
		const c = character();
		c.actor.items[0].system.moveResults = { ...results, failure: { value: "The GM makes a move." } };
		const rec = await settleTierEffects(c.actor, "Metamorphosis", "partial", null, { character: c.model, only: HOMEBREW_TIER_EFFECTS });
		expect(c.state.wearing).toBe(true);
		const moved = await settleTierEffects(c.actor, "Metamorphosis", "failure", rec, { character: c.model, only: HOMEBREW_TIER_EFFECTS });
		expect(moved.insertForm.set).toBe(false);
		expect(c.state.wearing).toBe(false);
	});
});

describe("the QoL round: what a homebrew possession or move's words say", () => {
	it("Night Crawler's advantage rides the moves its rolls are for, not every roll", () => {
		const [b] = rollBendsFrom("When you climb, cling to, or skitter across a sheer surface you cannot fall and you make any rolls to hide, hunt prey, or traverse terrain with advantage.");
		expect(b.moves).toEqual(["Defy Danger", "Forage"]);
		expect(movesForActivities("you make any rolls to navigate the wilds")).toEqual(["Chart a Course"]);
		// Rolls for nothing it knows stay on any roll, as before.
		expect(rollBendsFrom("You make every roll with advantage.")[0].moves).toBeNull();
	});

	it("Poisoner marks the possession its words name, matched by the word's stem", () => {
		const opts = [{ slug: "artist-s-tools", label: "Artist’s tools" }, { slug: "poisoner-s-kit", label: "Poisoner's kit" }, { slug: "herb-garden", label: "Herb garden" }];
		expect(possessionMarkedFrom("Mark the Poisons special possession. You ignore the dangerous tag.")).toBe("Poisons");
		expect(possessionMatching("Poisons", opts)?.slug).toBe("poisoner-s-kit");
		expect(possessionMatching("Herb garden", opts)?.slug).toBe("herb-garden");
		expect(possessionMatching("Tools", [...opts, { slug: "grave", label: "Grave tender’s tools" }])).toBeNull();
		const move = { type: "move", name: "Poisoner", flags: { [SYSTEM_ID]: { homebrewPlaybook: "homebrew-the-stranger" } }, system: { description: "<p>Mark the Poisons special possession.</p>" } };
		expect(possessionGrantedByMove(move, opts, [move])?.slug).toBe("poisoner-s-kit");
		expect(possessionGrantedByMove({ ...move, flags: {} }, opts, [move])).toBeNull();
		expect(possessionGrantedByMove({ ...move, flags: { [SYSTEM_ID]: { homebrewPlaybook: "x", learned: false } } }, opts, [move])).toBeNull();
	});

	it("Ephemera spends a use for a bigger hold on the move it names", () => {
		expect(possessionRollHoldFrom("(○ per session) : Charcoal, bone charms, spider silk, etc. Spend ☐ to hold +1 Fear when you roll the Pariah move, even on a 6-."))
			.toEqual({ hold: 1, track: "Fear", move: "Pariah", evenOnMiss: true });
		expect(possessionRollHoldFrom("Spend a use to hold +2 Nerve when you roll Silver Tongued.")).toEqual({ hold: 2, track: "Nerve", move: "Silver Tongued", evenOnMiss: false });
		expect(possessionRollHoldFrom("paint, brushes, chisels")).toBeNull();
	});

	it("Grave Tender may take the Ghost or Revenant on any result", () => {
		expect(lastDoorInsertsFrom("When you visit the Last Door and return, you may adopt the Ghost or Revenant insert regardless of the result.")).toEqual(["ghost", "revenant"]);
		expect(lastDoorInsertsFrom("When you face the Last Door, you may become a Thrall.")).toEqual(["thrall"]);
		expect(lastDoorInsertsFrom("You fear the Last Door.")).toEqual([]);
	});
});
