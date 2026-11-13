import { describe, it, expect } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { FakeMoveRepository } from "../../fakes/FakeMoveRepository.js";
import { MoveDefinition } from "../../../module/model/MoveDefinition.js";
import { normalizeBundle, bundleToItemData } from "../../../module/playbooks/homebrew-bundle.js";
import { plainOption } from "../../../module/actors/character/homebrew-inserts.js";

// A homebrew playbook with an INSERT, end to end on a character (original text only): The Tester's
// Toolbox, opened by Tooled Up, holding gadgets (a weapon, an armor, a trait) and tricks of its own,
// and Unfold, which everyone who opens it has.
const { bundle } = normalizeBundle({
	format: "stonetop-homebrew-playbook", version: 1,
	playbook: {
		name: "The Tester", hp: 16, damage: "d6",
		inserts: [{
			name: "Tester's Toolbox", unlockedBy: "Tooled Up", form: { enabled: true, on: "Unfold", off: "Fold up" },
			lists: [
				{ title: "Gadgets", pick: 1, options: [
					{ description: "Spring Fist: d6+1 (close, forceful)" },
					{ description: "Tin Plate: Armor 1" },
					{ description: "Wind-up wings: allow short hops" },
				] },
				{ title: "Tricks", kind: "moves", pick: 1, perUnlock: 1 },
			],
		}],
	},
	moves: [
		{ name: "Tooled Up", repeatMax: 3 },
		{ name: "Unfold", insert: "tester-s-toolbox", starting: true },
		{ name: "Whirr", insert: "tester-s-toolbox", insertList: "tricks" },
		{ name: "Clank", insert: "tester-s-toolbox", insertList: "tricks" },
	],
});
const SLUG = "homebrew-the-tester";
const items = bundleToItemData(bundle, { slug: SLUG });
const INSERT = items.playbook.flags.stonetop.inserts[0];
const PLAYBOOK = { ...items.playbook.flags.stonetop, slug: SLUG, name: "The Tester", startingMovesNote: "" };
const DOCS = items.moves.map((m, i) => ({ _id: `m${i}`, id: `m${i}`, ...m, toObject() { const { toObject: _t, ...rest } = this; return structuredClone(rest); } }));
const doc = name => DOCS.find(d => d.name === name);
const optSlug = label => INSERT.lists[0].options.find(o => plainOption(o.description).startsWith(label)).slug;

/** A move repository that knows the playbook's own moves and its insert's, as FoundryMoveRepository does. */
class InsertMoveRepository extends FakeMoveRepository {
	constructor() { super(DOCS.filter(d => !d.flags["stonetop-pwd"].homebrewInsert)); }
	getHomebrewInsertMoves(_name, key) {
		return DOCS.filter(d => d.flags["stonetop-pwd"].homebrewInsert?.key === key)
			.map(d => Object.assign(new MoveDefinition(d), { insertList: d.flags["stonetop-pwd"].homebrewInsert.list }));
	}
	async getPlaybookMoveDocument(id) { return DOCS.find(d => d._id === id) ?? null; }
}

const owned = (name, id) => ({ ...doc(name).toObject(), _id: id, id });

function character({ held = ["Tooled Up"], wearing = false, ticked = [] } = {}) {
	const counts = Object.fromEntries(ticked.map(l => [`${INSERT.lists[0].slug}:${optSlug(l)}`, 1]));
	const actor = new FakeActorBuilder()
		.withPlaybook(SLUG, "The Tester")
		.withItems(held.map((n, i) => owned(n, `own${i}`)))
		.withFlag("insertLore", { counts })
		.withFlag("insertForm", { [INSERT.key]: wearing })
		.build();
	return new TestCharacterBuilder(actor).withMoveRepo(new InsertMoveRepository()).addPlaybook(PLAYBOOK).build();
}

describe("a homebrew insert on a character", () => {
	it("is a tab once its move is held, and not before", async () => {
		expect((await character({ held: [] }).buildSnapshot()).homebrewInserts).toEqual([]);
		const [tab] = (await character().buildSnapshot()).homebrewInserts;
		expect(tab).toMatchObject({ key: INSERT.key, tabKey: `hb-insert-${INSERT.key}`, name: "Tester's Toolbox", attention: true });
		expect(tab.lore.entries.map(e => e.title)).toEqual(["Gadgets"]);
		expect(tab.moveGroups.map(g => [g.title, g.moves.map(m => m.name).sort()])).toEqual([
			["Tester's Toolbox moves", ["Unfold"]],
			["Tricks", ["Clank", "Whirr"]],
		]);
	});

	it("offers its moves on its own tab, never among the playbook's or the learned moves", async () => {
		const snap = await character({ held: ["Tooled Up", "Whirr"] }).buildSnapshot();
		const keys = snap.moves.map(c => c.key);
		expect(keys).toContain(`hb-insert:${INSERT.key}`);
		const playbook = snap.moves.find(c => c.key === "playbook");
		expect(playbook.moves.map(m => m.name)).toEqual(["Tooled Up"]);
		expect(snap.moves.find(c => c.key === "learned")).toBeUndefined();
		// On the Moves tab, the ones held, under the insert's name.
		expect(snap.movelist.insertGroups).toEqual([expect.objectContaining({ label: "Tester's Toolbox", moves: [expect.objectContaining({ name: "Whirr" })] })]);
		expect(snap.movelist.otherGroups.some(g => g.key.startsWith("hb-insert"))).toBe(false);
	});

	it("says when its moves list is over what the opening move allows, without refusing", async () => {
		const [tab] = (await character({ held: ["Tooled Up", "Whirr", "Clank"] }).buildSnapshot()).homebrewInserts;
		const tricks = tab.moveGroups.find(g => g.title === "Tricks");
		expect(tricks.over).toBe(true);
		expect(tricks.note).toMatch(/2 taken, and this list allows 1/);
		// A second Tooled Up: one more trick.
		const [two] = (await character({ held: ["Tooled Up", "Tooled Up", "Whirr", "Clank"] }).buildSnapshot()).homebrewInserts;
		expect(two.moveGroups.find(g => g.title === "Tricks").over).toBe(false);
	});

	it("its picks over the count carry a caution on the tab", async () => {
		const [tab] = (await character({ ticked: ["Spring Fist", "Tin Plate"] }).buildSnapshot()).homebrewInserts;
		const gadgets = tab.lore.entries[0];
		expect(gadgets.options.filter(o => o.caution).length).toBe(2);
	});

	it("its form's weapon and armor are the character's only while worn", async () => {
		const ticked = ["Spring Fist", "Tin Plate", "Wind-up"];
		const off = character({ ticked });
		expect((await off.buildSnapshot()).vitals.armor).toBe(0);
		expect((await off.carriedWeaponGear()).map(g => g.name)).not.toContain("Spring Fist");

		const on = character({ ticked, wearing: true });
		expect((await on.buildSnapshot()).vitals.armor).toBe(1);
		const weapons = await on.carriedWeaponGear();
		expect(weapons.find(g => g.name === "Spring Fist")).toMatchObject({ note: "damage d6+1, close, forceful", catalog: false });
		expect(weapons.map(g => g.name)).not.toContain("Wind-up wings");
		// What the character is while worn: the lists that aren't gear.
		const [tab] = (await on.buildSnapshot()).homebrewInserts;
		expect(tab.form).toMatchObject({ wearing: true, off: "Fold up" });
	});

	it("gives everyone who opens it the move it always gives, once", async () => {
		const char = character();
		expect(await char.syncInsertHeldMoves()).toBe(1);
		const created = char._actor.createEmbeddedDocuments.mock.calls.at(-1)[1];
		expect(created.map(d => d.name)).toEqual(["Unfold"]);
		const holding = character({ held: ["Tooled Up", "Unfold"] });
		expect(await holding.syncInsertHeldMoves()).toBe(0);
		expect(await character({ held: [] }).syncInsertHeldMoves()).toBe(0);
	});

	it("its moves are never onboarding's free picks", () => {
		const char = character({ held: ["Tooled Up", "Whirr"] });
		expect(char.creationPickItems("The Tester").map(i => i.name)).toEqual(["Tooled Up"]);
	});
});

describe("the insert's tab, as the templates draw it", async () => {
	const Handlebars = (await import("handlebars")).default;
	const { Window } = await import("happy-dom");
	const { readRepo } = await import("../../fakes/css.js");

	function hb() {
		const h = Handlebars.create();
		h.registerHelper("eq", (a, b) => a === b);
		h.registerHelper("or", (...args) => args.slice(0, -1).find(Boolean) ?? args.at(-2));
		h.registerHelper("and", (...args) => args.slice(0, -1).every(Boolean));
		h.registerHelper("concat", (...args) => args.slice(0, -1).join(""));
		h.registerPartial("stonetop.section-heading", "<h3>{{title}}</h3>");
		h.registerPartial("stonetop.lore-arcana-image", "");
		h.registerPartial("stonetop.move-group", `<div class="mg" data-title="{{title}}" data-note="{{note}}">{{#each moves}}<b>{{this.name}}</b>{{/each}}</div>`);
		for (const name of ["lore-section", "lore-options-edit", "lore-options-readonly", "tab-homebrew-insert", "tab-nav-item", "tab-rail-item"]) {
			h.registerPartial(`stonetop.${name}`, readRepo(`templates/actor/partials/${name}.hbs`));
		}
		return h;
	}
	const dom = html => { const d = new Window().document; d.body.innerHTML = html; return d.body; };
	// As Foundry renders: the snapshot's getters (a lore section's `hasEntries`) are read.
	const PROTO = { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true };
	// The rail line exactly as character.hbs writes it.
	const NAV = readRepo("templates/actor/character.hbs").split("\n").find(l => l.includes("{{#each stonetop.homebrewInserts}}{{> \"stonetop.tab-nav-item\"")).trim();

	it("puts a tab in the rail for each open insert, in either layout", async () => {
		const stonetop = await character().buildSnapshot();
		for (const classicLayout of [false, true]) {
			const root = dom(hb().compile(NAV)({ stonetop: { ...stonetop, classicLayout } }, PROTO));
			const tab = root.querySelector(`[data-tab="hb-insert-${INSERT.key}"]`);
			expect(tab).toBeTruthy();
			expect(tab.classList.contains("stonetop-tab-rail-item")).toBe(!classicLayout);
			expect(tab.getAttribute("aria-label")).toMatch(/^Tester's Toolbox\W+2 picks still to make/);
		}
	});

	it("draws its lists to tick under the insert's own hook, its form switch and its moves", async () => {
		const stonetop = await character({ wearing: true, ticked: ["Spring Fist"] }).buildSnapshot();
		const root = dom(hb().compile(`{{#each stonetop.homebrewInserts}}{{> "stonetop.tab-homebrew-insert"}}{{/each}}`)({ stonetop, editable: true }, PROTO));
		const tab = root.querySelector(`.tab[data-tab="hb-insert-${INSERT.key}"]`);
		const checks = tab.querySelectorAll("[data-hb-insert] .stonetop-lore-option-check");
		expect(checks.length).toBe(3);
		expect(checks[0].dataset.loreSlug).toBe(INSERT.lists[0].slug);
		const btn = tab.querySelector("[data-hb-insert-form]");
		expect(btn.textContent.trim()).toBe("Fold up");
		expect(btn.dataset.on).toBe("false");
		expect([...tab.querySelectorAll(".mg")].map(g => g.dataset.title)).toEqual(["Tester's Toolbox moves", "Tricks"]);
		expect(tab.querySelector(".stonetop-hb-insert-allowance").textContent).toBe("Picked 1 of 1.");
	});
});
