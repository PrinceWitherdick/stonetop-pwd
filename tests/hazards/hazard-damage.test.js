import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { hazardDamageRoll, buildHazardCardVM } from "../../module/hazards/hazard-view.js";
import { hazardCandidates, rollHazardFromCard, hazardCertainDeath, wireHazardDamage } from "../../module/hazards/hazard-damage.js";
import { gmPrepCardWiring } from "../../module/journal/gm-prep-page.js";

// Book I, Dangers p.383: "Damage from hazards" and "Certain death". p.385's crinwin-nest climb is the
// book's own worked example: "1d10+2 (ignores armor, forceful)".
const CLIMB = { damageDie: "d10", damageEffects: ["big", "ignoresArmor", "forceful"] };

describe("hazardDamageRoll: what a hazard's line rolls (p.383)", () => {
	it("rolls the book's worked example with its armor clause and its tags", () => {
		expect(hazardDamageRoll(CLIMB)).toEqual({
			formula: "1d10+2", ignoresArmor: true, piercing: 0, tags: ["ignores armor", "forceful"],
		});
	});

	it("takes the larger piercing only, and keeps messy as a tag", () => {
		const roll = hazardDamageRoll({ damageDie: "d8", damageEffects: ["pierce1", "pierce3"] });
		expect(roll).toMatchObject({ formula: "1d8", ignoresArmor: false, piercing: 3 });
		expect(roll.tags).toEqual(["3 piercing", "messy"]);
	});

	it("reads a typed extra the same way as a pick", () => {
		expect(hazardDamageRoll({ damageDie: "d6", damageEffects: ["pierce1"], damageExtra: "2 piercing, area" }))
			.toMatchObject({ piercing: 2, tags: ["2 piercing", "messy", "area"] });
	});

	it("rolls nothing for certain death or a hazard with no die", () => {
		// "it shouldn't deal damage to the PCs--it should immediately reduce them to 0 HP"
		expect(hazardDamageRoll({ ...CLIMB, certainDeath: true })).toBeNull();
		expect(hazardDamageRoll({ damageDie: "" })).toBeNull();
	});
});

// -- The card's buttons -------------------------------------------------------------------------

const page = (system, name = "The great redwood") => ({
	id: "h1", uuid: "JournalEntry.e.JournalEntryPage.h1", name, isOwner: true, system,
});

describe("the hazard card's GM buttons", () => {
	afterEach(() => { delete globalThis.game.user; });

	it("offers Roll damage to the GM on a rolling hazard, and Certain death on a certain one", async () => {
		globalThis.game.user = { isGM: true };
		const rolling = await buildHazardCardVM(page(CLIMB));
		expect(rolling).toMatchObject({ canRollDamage: true, canCertainDeath: false });
		const fatal = await buildHazardCardVM(page({ ...CLIMB, certainDeath: true }));
		expect(fatal).toMatchObject({ canRollDamage: false, canCertainDeath: true });
	});

	it("offers neither to a player", async () => {
		globalThis.game.user = { isGM: false };
		const vm = await buildHazardCardVM(page({ ...CLIMB, certainDeath: true }));
		expect(vm).toMatchObject({ canRollDamage: false, canCertainDeath: false });
	});

	it("draws them on the damage line", () => {
		const hb = Handlebars.create();
		hb.registerHelper("localize", key => globalThis.game.i18n.localize(key));
		for (const name of ["stonetop.card-head", "stonetop.card-doom-track", "stonetop.card-gm-moves", "stonetop.card-player-moves"]) {
			hb.registerPartial(name, "");
		}
		const card = hb.compile(fs.readFileSync(path.resolve("templates/journal/partials/hazard-card.hbs"), "utf8"));
		const html = card({ hasDamage: true, damage: "1d10+2", canRollDamage: true });
		expect(html).toContain("hazard-damage-roll");
		expect(html).toContain("Roll damage");
		expect(html).not.toContain("hazard-certain-death");
		expect(card({ hasDamage: true, damage: "certain death", canCertainDeath: true })).toContain("Certain death");
	});

	it("is wired on every host through the per-kind table", () => {
		// The page sheet, the GM Toolkit's prep tab and the canvas board all wire from this one column.
		expect(gmPrepCardWiring("hazard")).toBe(wireHazardDamage);
	});
});

// -- Who it catches ------------------------------------------------------------------------------

const hp = value => ({ attributes: { hp: { value, max: 12 } } });
const pc = (id, name, value = 8) => ({ documentName: "Actor", id, uuid: `Actor.${id}`, name, type: "character", system: hp(value) });

describe("hazardCandidates", () => {
	it("offers each token with HP, then every character with no token on the scene", () => {
		const vahid = pc("vahid", "Vahid");
		const blodwen = pc("blodwen", "Blodwen");
		const tokens = [
			{ uuid: "Scene.s.Token.v", name: "Vahid", actor: vahid },
			{ uuid: "Scene.s.Token.w", name: "Wall", actor: { id: "wall", name: "Wall", system: {} } },
		];
		const rows = hazardCandidates({ characters: [vahid, blodwen], tokens });
		expect(rows.map(r => r.id)).toEqual(["Scene.s.Token.v", "Actor.blodwen"]);
		// On nobody's side: the damage row's "(friendly)" warning is about hurting an ally by mistake.
		expect(rows.every(r => r.target.disposition === 0 && r.target.hasActor)).toBe(true);
	});
});

function deps(over = {}) {
	return {
		handTargets: () => [],
		rollHazardDamage: vi.fn(async () => [{ raw: 7 }]),
		pick: vi.fn(async () => null),
		characters: () => [],
		tokens: () => [],
		resolve: async () => null,
		apply: vi.fn(async (actor, amount) => ({ oldHp: actor.system.attributes.hp.value, newHp: Math.max(0, actor.system.attributes.hp.value - amount) })),
		post: vi.fn(async () => ({})),
		notify: vi.fn(),
		...over,
	};
}

describe("Roll damage", () => {
	it("rolls the line at the GM's targets, without asking who", async () => {
		const d = deps({ handTargets: () => [{ uuid: "Scene.s.Token.v", name: "Vahid", actorId: "vahid", disposition: 1, hasActor: true }] });
		await rollHazardFromCard(page(CLIMB), { shiftKey: true }, d);
		expect(d.pick).not.toHaveBeenCalled();
		expect(d.rollHazardDamage).toHaveBeenCalledWith(
			{ name: "The great redwood", formula: "1d10+2", ignoresArmor: true, piercing: 0, tags: ["ignores armor", "forceful"] },
			{ targets: [{ uuid: "Scene.s.Token.v", name: "Vahid", actorId: "vahid", disposition: 0, hasActor: true }], shiftKey: true },
		);
	});

	it("asks who it catches when nobody is targeted, with nobody ticked", async () => {
		const vahid = pc("vahid", "Vahid");
		const d = deps({ characters: () => [vahid], pick: vi.fn(async () => ["Actor.vahid"]) });
		await rollHazardFromCard(page(CLIMB), {}, d);
		const question = d.pick.mock.calls[0][0];
		expect(question).toMatchObject({ multiple: true, selected: [], title: "Who does The great redwood catch?" });
		expect(d.rollHazardDamage.mock.calls[0][1].targets).toEqual([
			{ uuid: "Actor.vahid", name: "Vahid", actorId: "vahid", disposition: 0, hasActor: true },
		]);
	});

	it("rolls nothing when the GM backs out of the pick", async () => {
		const d = deps({ characters: () => [pc("vahid", "Vahid")] });
		expect(await rollHazardFromCard(page(CLIMB), {}, d)).toBeNull();
		expect(d.rollHazardDamage).not.toHaveBeenCalled();
	});

	it("rolls nothing for a certain-death hazard", async () => {
		const d = deps();
		expect(await rollHazardFromCard(page({ ...CLIMB, certainDeath: true }), {}, d)).toBeNull();
		expect(d.rollHazardDamage).not.toHaveBeenCalled();
	});
});

describe("Certain death (p.383): straight to 0 HP, no damage roll", () => {
	const FALL = { certainDeath: true };

	it("takes exactly the HP they have, through the HP writer lethal damage uses", async () => {
		const vahid = pc("vahid", "Vahid", 9);
		const d = deps({ characters: () => [vahid], pick: vi.fn(async () => ["Actor.vahid"]), resolve: async () => vahid });
		const lines = await hazardCertainDeath(page(FALL, "The 60-foot drop"), d);
		expect(d.apply).toHaveBeenCalledWith(vahid, 9, { stonetopMove: "The 60-foot drop" });
		expect(lines).toEqual(["Vahid: 9 → 0 HP, no damage roll (certain death, Book I p.383)."]);
		// The shared list card (utils/chat.js#postListCard), spoken by the hazard.
		const [title, rows, options] = d.post.mock.calls[0];
		expect(title).toContain("The 60-foot drop: certain death");
		expect(rows).toBe("<li>Vahid: 9 → 0 HP, no damage roll (certain death, Book I p.383).</li>");
		expect(options).toEqual({ speaker: { alias: "The 60-foot drop" }, sectionClass: "stonetop-attack-applied-card" });
		expect(d.rollHazardDamage).not.toHaveBeenCalled();
	});

	it("leaves someone already at 0 HP alone, and says so", async () => {
		const down = pc("andras", "Andras", 0);
		const d = deps({ handTargets: () => [{ uuid: "Actor.andras", name: "Andras", hasActor: true }], resolve: async () => down });
		expect(await hazardCertainDeath(page(FALL), d)).toEqual(["Andras is already at 0 HP."]);
		expect(d.apply).not.toHaveBeenCalled();
	});

	it("does nothing for a hazard that is not certain death, or when the GM backs out", async () => {
		const d = deps({ characters: () => [pc("vahid", "Vahid")] });
		expect(await hazardCertainDeath(page(CLIMB), d)).toBeNull();
		expect(await hazardCertainDeath(page(FALL), d)).toBeNull();
		expect(d.apply).not.toHaveBeenCalled();
		expect(d.post).not.toHaveBeenCalled();
	});
});

describe("wireHazardDamage", () => {
	let listener;
	const root = { addEventListener: (_type, fn) => { listener = fn; } };
	const click = (cls, extra = {}) => {
		const btn = { disabled: false, classList: { contains: c => c === cls } };
		return { btn, ev: { target: { closest: () => btn }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra } };
	};

	beforeEach(() => { listener = null; });
	afterEach(() => { delete globalThis.game.user; });

	it("rolls the clicked card's hazard for the GM", async () => {
		globalThis.game.user = { isGM: true };
		const d = deps({ handTargets: () => [{ uuid: "Actor.vahid", name: "Vahid", hasActor: true }] });
		wireHazardDamage(root, () => page(CLIMB), d);
		const { btn, ev } = click("hazard-damage-roll", { shiftKey: true });
		await listener(ev);
		expect(d.rollHazardDamage).toHaveBeenCalledTimes(1);
		expect(d.rollHazardDamage.mock.calls[0][1].shiftKey).toBe(true);
		expect(btn.disabled).toBe(false);
	});

	it("does nothing for a player", async () => {
		globalThis.game.user = { isGM: false };
		const d = deps({ handTargets: () => [{ uuid: "Actor.vahid", name: "Vahid", hasActor: true }] });
		wireHazardDamage(root, () => page(CLIMB), d);
		await listener(click("hazard-damage-roll").ev);
		expect(d.rollHazardDamage).not.toHaveBeenCalled();
	});
});
