import { describe, it, expect, vi } from "vitest";
import { CharacterArcana } from "../../../module/actors/character/CharacterArcana.js";
import {
	ArcanaSnapshot, ArcanaSectionSnapshot,
	ArcanaUnlockTextItem, ArcanaUnlockOptionSnapshot,
	ArcanaBackOptionSnapshot,
	MinorArcanumSnapshot, MinorArcanumFrontSnapshot, MinorArcanumBackSnapshot,
	ArcanumUnlockSection,
} from "../../../module/model/CharacterSnapshot.js";
import {FakeArcanaRepository} from "../../fakes/FakeArcanaRepository.js";

// -- Helpers ------------------------------------------------------------------

function makeFlags(store = {}) {
	return {
		_store: store,
		getFlag: (key) => store[key] ?? null,
		// Model Foundry's setFlag (mergeObject): plain objects deep-merge, so keys missing from
		// the written value SURVIVE; arrays and primitives replace wholesale. This faithfully
		// reproduces why dropping keys from a flag object needs an unsetFlag first.
		setFlag: vi.fn(async (key, val) => {
			const cur = store[key];
			const mergeable = v => v && typeof v === "object" && !Array.isArray(v);
			store[key] = mergeable(cur) && mergeable(val) ? { ...cur, ...val } : val;
		}),
		unsetFlag: vi.fn(async (key) => { delete store[key]; }),
		// Model StonetopFlags.batch: `sets` replace a flag wholesale (via actor.update, which
		// treats arrays/primitives atomically); `deletes` remove sub-keys (the "-=key" syntax).
		batch: vi.fn(async ({ sets = {}, deletes = {} } = {}) => {
			for (const [key, value] of Object.entries(sets)) store[key] = value;
			for (const [key, subKeys] of Object.entries(deletes)) {
				if (store[key] && typeof store[key] === "object") {
					for (const sub of subKeys) delete store[key][sub];
				}
			}
		}),
	};
}


// -- Fixture ------------------------------------------------------------------

const FFYRNIG_SPHERE = {
	slug: "huge-wooden-sphere",
	front: {
		title: "A Huge Wooden Sphere",
		item: { name: "A Huge Wooden Sphere", weight: null, note: "immobile", inventoryColumn: null },
		description: "<p>Half-buried and largely overgrown.</p>",
		unlock: {
			description: "The pictograms depict some sort of recipe, which you can learn but you must…",
			requirements: [
				{ type: "text",   content: "Some context text." },
				{ type: "option", slug: "dig-sphere",   description: "… first dig up and clean the sphere." },
				{ type: "option", slug: "study-glyphs", description: "… spend weeks studying the glyphs." },
				{ type: "text",   content: "And then…" },
				{ type: "option", slug: "risk-recipe",  description: "… risk getting the recipe wrong.", max: 3 },
			],
		},
	},
	back: {
		title: "Ffyrnig Tonic",
		item: { name: "Ffyrnig Tonic", weight: 1, note: "magical", inventoryColumn: "regular" },
		description: "<p>When you pickle fresh ffyrnig root…</p>",
		resource: { max: 3, maxStat: null, title: "Ffyrnig Tonic", labels: [] },
		move: {
			name: "When you take a draught of ffyrnig tonic",
			rollType: null,
			description: "<p>pick 1: regain HP or clear a debility.</p>",
		},
		options: [],
	},
};

const ARCANUM_WITH_BACK_OPTS = {
	slug: "test-arcanum",
	front: {
		title: "Test Arcanum (front)",
		item: null,
		description: "<p>Test.</p>",
		unlock: { description: "Unlock by…", requirements: [] },
	},
	back: {
		title: "Test Arcanum (back)",
		item: null,
		description: "<p>Test.</p>",
		resource: null,
		move: null,
		options: [
			{ slug: "opt-a", description: "<p>Option A.</p>", max: 1 },
			{ slug: "opt-b", description: "<p>Option B.</p>", max: 2 },
		],
	},
};

// -- Build helper -------------------------------------------------------------

function makeArcana(flagStore = {}, arcana = [FFYRNIG_SPHERE]) {
	return new CharacterArcana(makeFlags(flagStore), new FakeArcanaRepository(arcana));
}

// -- Tests --------------------------------------------------------------------

describe("CharacterArcana.buildSnapshot()", () => {
	describe("structure", () => {
		it("returns an ArcanaSnapshot", async () => {
			const snap = await makeArcana().buildSnapshot();
			expect(snap).toBeInstanceOf(ArcanaSnapshot);
		});

		it("minor and major are ArcanaSectionSnapshot instances", async () => {
			const snap = await makeArcana().buildSnapshot();
			expect(snap.minor).toBeInstanceOf(ArcanaSectionSnapshot);
			expect(snap.major).toBeInstanceOf(ArcanaSectionSnapshot);
		});

		it("minor.title is always 'Minor Arcana'", async () => {
			const snap = await makeArcana().buildSnapshot();
			expect(snap.minor.title).toBe("Minor Arcana");
		});

		it("major.title is always 'Major Arcana'", async () => {
			const snap = await makeArcana().buildSnapshot();
			expect(snap.major.title).toBe("Major Arcana");
		});

		it("minor.items is [] when no owned slugs", async () => {
			const snap = await makeArcana().buildSnapshot();
			expect(snap.minor.items).toEqual([]);
		});

		it("major.items is always []", async () => {
			const snap = await makeArcana({ owned: ["huge-wooden-sphere"] }).buildSnapshot();
			expect(snap.major.items).toEqual([]);
		});
	});

	describe("owned arcana", () => {
		it("owned slug present in repo appears in minor.items", async () => {
			const snap = await makeArcana({ owned: ["huge-wooden-sphere"] }).buildSnapshot();
			expect(snap.minor.items).toHaveLength(1);
		});

		it("owned slug missing from repo is omitted silently", async () => {
			const arcana = new CharacterArcana(
				makeFlags({ owned: ["nonexistent-slug"] }),
				new FakeArcanaRepository([FFYRNIG_SPHERE]),
			);
			const snap = await arcana.buildSnapshot();
			expect(snap.minor.items).toHaveLength(0);
		});

		it("every item in minor.items has owned: true", async () => {
			const snap = await makeArcana({ owned: ["huge-wooden-sphere"] }).buildSnapshot();
			expect(snap.minor.items[0].owned).toBe(true);
		});

		it("returns a MinorArcanumSnapshot", async () => {
			const snap = await makeArcana({ owned: ["huge-wooden-sphere"] }).buildSnapshot();
			expect(snap.minor.items[0]).toBeInstanceOf(MinorArcanumSnapshot);
		});

		it("has correct slug", async () => {
			const snap = await makeArcana({ owned: ["huge-wooden-sphere"] }).buildSnapshot();
			expect(snap.minor.items[0].slug).toBe("huge-wooden-sphere");
		});
	});

	describe("lead state", () => {
		it("lead is false for an owned card not in the leads flag", async () => {
			const snap = await makeArcana({ owned: ["huge-wooden-sphere"] }).buildSnapshot();
			expect(snap.minor.items[0].lead).toBe(false);
		});

		it("lead is true for an owned slug in the leads flag", async () => {
			const snap = await makeArcana({ owned: ["huge-wooden-sphere"], leads: ["huge-wooden-sphere"] }).buildSnapshot();
			expect(snap.minor.items[0].lead).toBe(true);
		});

		it("identified wins: a slug that is both a lead and identified is not a lead", async () => {
			const snap = await makeArcana({
				owned: ["huge-wooden-sphere"], leads: ["huge-wooden-sphere"], identified: ["huge-wooden-sphere"],
			}).buildSnapshot();
			expect(snap.minor.items[0].lead).toBe(false);
			expect(snap.minor.items[0].identified).toBe(true);
		});
	});

	describe("unlocked state", () => {
		it("unlocked is true when there are no trackable requirements", async () => {
			const arcanum = { ...FFYRNIG_SPHERE, front: { ...FFYRNIG_SPHERE.front, unlock: { description: "Unlock by…", requirements: [] } } };
			const arcana = new CharacterArcana(makeFlags({ owned: ["huge-wooden-sphere"] }), new FakeArcanaRepository([arcanum]));
			const item = (await arcana.buildSnapshot()).minor.items[0];
			expect(item.unlocked).toBe(true);
		});

		it("unlocked is false when option requirements are not met", async () => {
			const snap = await makeArcana({ owned: ["huge-wooden-sphere"] }).buildSnapshot();
			expect(snap.minor.items[0].unlocked).toBe(false);
		});

		it("unlocked is false when only some requirements are met", async () => {
			const snap = await makeArcana({
				owned:  ["huge-wooden-sphere"],
				unlock: { "huge-wooden-sphere:dig-sphere": 1, "huge-wooden-sphere:study-glyphs": 1 },
			}).buildSnapshot();
			expect(snap.minor.items[0].unlocked).toBe(false);
		});

		it("unlocked is true when all option requirements are fully met", async () => {
			const snap = await makeArcana({
				owned:  ["huge-wooden-sphere"],
				unlock: {
					"huge-wooden-sphere:dig-sphere":   1,
					"huge-wooden-sphere:study-glyphs": 1,
					"huge-wooden-sphere:risk-recipe":  3,
				},
			}).buildSnapshot();
			expect(snap.minor.items[0].unlocked).toBe(true);
		});

		it("unlocked is false when circle marks are not all checked", async () => {
			const circleArcanum = {
				slug: "azure-hand",
				front: {
					title: "Azure Hand", item: null,
					description: "<p>Test.</p>",
					unlock: { description: "○○○○ Fill to unlock.", requirements: [] },
				},
				back: { title: "Mysteries", item: null, description: "<p>Back.</p>", resource: null, move: null, options: [] },
			};
			const arcana = new CharacterArcana(
				makeFlags({ owned: ["azure-hand"], boxes: { "azure-hand:unlock:0": true, "azure-hand:unlock:1": true } }),
				new FakeArcanaRepository([circleArcanum]),
			);
			expect((await arcana.buildSnapshot()).major.items[0].unlocked).toBe(false);
		});

		it("unlocked is true when all circle marks are checked", async () => {
			const circleArcanum = {
				slug: "azure-hand",
				front: {
					title: "Azure Hand", item: null,
					description: "<p>Test.</p>",
					unlock: { description: "○○○○ Fill to unlock.", requirements: [] },
				},
				back: { title: "Mysteries", item: null, description: "<p>Back.</p>", resource: null, move: null, options: [] },
			};
			const arcana = new CharacterArcana(
				makeFlags({ owned: ["azure-hand"], boxes: { "azure-hand:unlock:0": true, "azure-hand:unlock:1": true, "azure-hand:unlock:2": true, "azure-hand:unlock:3": true } }),
				new FakeArcanaRepository([circleArcanum]),
			);
			expect((await arcana.buildSnapshot()).major.items[0].unlocked).toBe(true);
		});
	});

	describe("front snapshot", () => {
		async function getItem(flagStore = {}) {
			return (await makeArcana({ owned: ["huge-wooden-sphere"], ...flagStore }).buildSnapshot()).minor.items[0];
		}

		it("front is a MinorArcanumFrontSnapshot", async () => {
			expect((await getItem()).front).toBeInstanceOf(MinorArcanumFrontSnapshot);
		});

		it("front has correct title, item, description", async () => {
			const { front } = await getItem();
			expect(front.title).toBe("A Huge Wooden Sphere");
			expect(front.item?.weight).toBeNull();
			expect(front.item?.note).toBe("immobile");
			expect(front.description).toContain("Half-buried");
		});

		it("front.unlock is an ArcanumUnlockSection", async () => {
			expect((await getItem()).front.unlock).toBeInstanceOf(ArcanumUnlockSection);
		});

		it("front.unlock.description is set", async () => {
			const { front } = await getItem();
			expect(front.unlock.description).toBe("The pictograms depict some sort of recipe, which you can learn but you must…");
		});

		it("front.unlock.requirements has text and option nodes in order", async () => {
			const { requirements } = (await getItem()).front.unlock;
			expect(requirements).toHaveLength(5);
			expect(requirements[0]).toBeInstanceOf(ArcanaUnlockTextItem);
			expect(requirements[1]).toBeInstanceOf(ArcanaUnlockOptionSnapshot);
			expect(requirements[2]).toBeInstanceOf(ArcanaUnlockOptionSnapshot);
			expect(requirements[3]).toBeInstanceOf(ArcanaUnlockTextItem);
			expect(requirements[4]).toBeInstanceOf(ArcanaUnlockOptionSnapshot);
		});

		it("unlock option has slug and description", async () => {
			const opt = (await getItem()).front.unlock.requirements[1];
			expect(opt.slug).toBe("dig-sphere");
			expect(opt.description).toBe("… first dig up and clean the sphere.");
		});

		it("unlock option defaults to count 0 and selected false", async () => {
			const opt = (await getItem()).front.unlock.requirements[1];
			expect(opt.count).toBe(0);
			expect(opt.selected).toBe(false);
		});

		it("unlock option max defaults to 1", async () => {
			expect((await getItem()).front.unlock.requirements[1].max).toBe(1);
		});

		it("unlock option with explicit max reflects JSON value", async () => {
			expect((await getItem()).front.unlock.requirements[4].max).toBe(3);
		});

		it("unlock option count and selected reflect saved flags", async () => {
			const opt = (await getItem({ unlock: { "huge-wooden-sphere:dig-sphere": 1 } })).front.unlock.requirements[1];
			expect(opt.count).toBe(1);
			expect(opt.selected).toBe(true);
		});
	});

	describe("back snapshot", () => {
		async function getItem(flagStore = {}) {
			return (await makeArcana({ owned: ["huge-wooden-sphere"], ...flagStore }).buildSnapshot()).minor.items[0];
		}

		it("back is a MinorArcanumBackSnapshot", async () => {
			expect((await getItem()).back).toBeInstanceOf(MinorArcanumBackSnapshot);
		});

		it("back has correct title, item, description", async () => {
			const { back } = await getItem();
			expect(back.title).toBe("Ffyrnig Tonic");
			expect(back.item?.weight).toBe(1);
			expect(back.item?.note).toBe("magical");
			expect(back.description).toContain("pickle fresh ffyrnig root");
		});

		it("back.resource is populated and defaults current to 0", async () => {
			expect((await getItem()).back.resource).toMatchObject({ current: 0, max: 3, title: "Ffyrnig Tonic" });
		});

		it("back.resource.current reflects inventoryResources param", async () => {
			const item = await (async () => {
				const arcana = makeArcana({ owned: ["huge-wooden-sphere"] });
				return (await arcana.buildSnapshot({}, {}, { "huge-wooden-sphere": 2 })).minor.items[0];
			})();
			expect(item.back.resource.current).toBe(2);
		});

		it("back.resource is null when absent in JSON", async () => {
			const noResource = { ...FFYRNIG_SPHERE, back: { ...FFYRNIG_SPHERE.back, resource: undefined } };
			const arcana = new CharacterArcana(
				makeFlags({ owned: ["huge-wooden-sphere"] }),
				new FakeArcanaRepository([noResource]),
			);
			expect((await arcana.buildSnapshot()).minor.items[0].back.resource).toBeNull();
		});

		// Regression: a card carrying BOTH a back-power resource and a back-ITEM resource must
		// not share one stored value. The power track keys by bare slug; the item track keys
		// `${slug}:item`. Without the split, ticking one moved the other.
		describe("back power + back item resource don't collide", () => {
			const BOTH_RESOURCES = {
				...FFYRNIG_SPHERE,
				slug: "both-tracks",
				back: {
					...FFYRNIG_SPHERE.back,
					resource: { max: 3, maxStat: null, title: "Power", labels: [] },
					item: { name: "Vessel", weight: 1, note: null, inventoryColumn: "regular",
						resource: { max: 4, maxStat: null, title: "Ammo", labels: [] } },
				},
			};
			const buildBoth = (inventoryResources) =>
				new CharacterArcana(makeFlags({ owned: ["both-tracks"] }), new FakeArcanaRepository([BOTH_RESOURCES]))
					.buildSnapshot({}, {}, inventoryResources);

			it("reads the two tracks from independent keys", async () => {
				const item = (await buildBoth({ "both-tracks": 2, "both-tracks:item": 4 })).minor.items[0];
				expect(item.back.resource.current).toBe(2);       // power → bare slug
				expect(item.back.item.resource.current).toBe(4);  // item  → :item key
			});

			it("item track falls back to the legacy bare-slug value when no :item key exists", async () => {
				const item = (await buildBoth({ "both-tracks": 5 })).minor.items[0];
				expect(item.back.item.resource.current).toBe(5);  // legacy data preserved
			});
		});

		it("back.move is populated with correct name and rollType", async () => {
			expect((await getItem()).back.move).toMatchObject({
				name: "When you take a draught of ffyrnig tonic",
				rollType: null,
			});
		});

		it("back.move is null when absent in JSON", async () => {
			const noMove = { ...FFYRNIG_SPHERE, back: { ...FFYRNIG_SPHERE.back, move: undefined } };
			const arcana = new CharacterArcana(
				makeFlags({ owned: ["huge-wooden-sphere"] }),
				new FakeArcanaRepository([noMove]),
			);
			expect((await arcana.buildSnapshot()).minor.items[0].back.move).toBeNull();
		});

		it("back.options is [] when none defined", async () => {
			expect((await getItem()).back.options).toEqual([]);
		});
	});

	// The back's "Consequences" section is surfaced onto the front for cards whose front text
	// points at it ("mark a consequence (see reverse)") — Hec'tumel Codex, Redwood Effigy — so a
	// player can read/mark it without unlocking the reverse.
	describe("surfaced front consequences", () => {
		// Front references consequences; the back has a "Moves" section (with its own □) BEFORE
		// the "Consequences" section, plus a nested consequence, so we can verify the slice both
		// starts at the heading and keeps the back's own checkbox indices.
		const CONSEQUENCE_CARD = {
			slug: "consequence-card",
			front: {
				title: "Consequence Card",
				item: null,
				description: "<p><strong>on a 6-</strong>, mark a consequence (see reverse) in addition to whatever the GM says.</p>",
				unlock: { description: "○○○ Gain the Big Move (see reverse).", requirements: [] },
			},
			back: {
				title: "Mysteries",
				item: null,
				description: "<h3>Moves</h3><p>□ THE BIG MOVE. Does a thing.</p><h3>Consequences</h3><ul><li>□ Your skin turns blue.</li><li>□ You grow a tail.<ul><li>□ The tail is prehensile.</li></ul></li></ul>",
				resource: null, move: null, options: [],
			},
		};

		const buildItem = (card, flagStore = {}) =>
			new CharacterArcana(makeFlags({ owned: [card.slug], ...flagStore }), new FakeArcanaRepository([card]))
				.buildSnapshot().then(s => s.minor.items[0]);

		it("consequences is the sliced Consequences section, not the preceding Moves section", async () => {
			const { consequences } = await buildItem(CONSEQUENCE_CARD);
			expect(consequences).toContain("<h3>Consequences</h3>");
			expect(consequences).toContain("Your skin turns blue");
			expect(consequences).toContain("The tail is prehensile");   // nested <li> kept
			expect(consequences).not.toContain("THE BIG MOVE");
			expect(consequences).not.toContain("<h3>Moves</h3>");
		});

		it("consequence boxes carry the back's own (context, index) so state is shared", async () => {
			const { consequences, back } = await buildItem(CONSEQUENCE_CARD);
			// The Moves □ is back index 0; the three consequence □ follow as 1, 2, 3.
			expect(back.description).toContain('data-context="back" data-index="0"');   // Moves box
			expect(consequences).toContain('data-context="back" data-index="1"');       // first consequence
			expect(consequences).toContain('data-context="back" data-index="3"');       // nested consequence
			expect(consequences).not.toContain('data-index="0"');                       // Moves box excluded
			expect((consequences.match(/type="checkbox"/g) ?? []).length).toBe(3);
		});

		it("checked consequence state reflects the shared back boxes flag", async () => {
			const { consequences } = await buildItem(CONSEQUENCE_CARD, { boxes: { "consequence-card:back:1": true } });
			expect(consequences).toContain('data-index="1" checked');
			expect(consequences).toContain('data-index="2">');   // untouched box stays unchecked
		});

		it("does not rewrite the front description in the snapshot (the '(see below)' swap is render-time)", async () => {
			const { front } = await buildItem(CONSEQUENCE_CARD);
			expect(front.description).toContain("(see reverse)");
		});

		it("consequences is null when the front does not reference consequences", async () => {
			const noRef = { ...CONSEQUENCE_CARD, slug: "no-ref", front: { ...CONSEQUENCE_CARD.front, description: "<p>Just flavor. On a 6-, mark 1:</p>" } };
			expect((await buildItem(noRef)).consequences).toBeNull();
		});

		it("consequences is null when the back Consequences section is a pointer stub (no list)", async () => {
			const stub = { ...CONSEQUENCE_CARD, slug: "stub", back: { ...CONSEQUENCE_CARD.back, description: "<h3>Moves</h3><p>stuff</p><h3>Consequences</h3>See above." } };
			expect((await buildItem(stub)).consequences).toBeNull();
		});

		it("consequences is null when the back has no Consequences section", async () => {
			const noSection = { ...CONSEQUENCE_CARD, slug: "no-section", back: { ...CONSEQUENCE_CARD.back, description: "<h3>Moves</h3><p>□ THE BIG MOVE.</p>" } };
			expect((await buildItem(noSection)).consequences).toBeNull();
		});
	});

	describe("back options", () => {
		function makeWithOpts(flagStore = {}) {
			return new CharacterArcana(
				makeFlags({ owned: ["test-arcanum"], ...flagStore }),
				new FakeArcanaRepository([ARCANUM_WITH_BACK_OPTS]),
			);
		}

		async function getItem(flagStore = {}) {
			return (await makeWithOpts(flagStore).buildSnapshot()).minor.items[0];
		}

		it("back.options are ArcanaBackOptionSnapshot instances", async () => {
			const { options } = (await getItem()).back;
			expect(options).toHaveLength(2);
			expect(options[0]).toBeInstanceOf(ArcanaBackOptionSnapshot);
		});

		it("back option has correct slug, description, max", async () => {
			const opt = (await getItem()).back.options[0];
			expect(opt.slug).toBe("opt-a");
			expect(opt.description).toBe("<p>Option A.</p>");
			expect(opt.max).toBe(1);
		});

		it("back option max > 1 reflects JSON value", async () => {
			expect((await getItem()).back.options[1].max).toBe(2);
		});

		it("back option count and selected reflect saved flags", async () => {
			const opt = (await getItem({ backOptions: { "test-arcanum:opt-a": 1 } })).back.options[0];
			expect(opt.count).toBe(1);
			expect(opt.selected).toBe(true);
		});
	});

	describe("mutation methods", () => {
		it("addArcanum adds slug to owned flag", async () => {
			const flags = makeFlags();
			const arcana = new CharacterArcana(flags, new FakeArcanaRepository());
			await arcana.addArcanum("some-slug");
			expect(flags.setFlag).toHaveBeenCalledWith("owned", ["some-slug"]);
		});

		it("removeArcanum removes slug from owned flag", async () => {
			const store = { owned: ["some-slug", "other-slug"] };
			const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository());
			await arcana.removeArcanum("some-slug");
			// removeArcanum batches every per-card write into one actor.update (flags.batch);
			// assert the resulting store state rather than a specific setFlag call.
			expect(store.owned).toEqual(["other-slug"]);
		});

		it("removeArcanum clears the reveal flag and every per-card mark (no spoiler leak on re-add)", async () => {
			// Removing a card must leave no trace keyed to its slug — otherwise re-acquiring it
			// later restores a GM-revealed back or a fully-marked/unlocked state with no GM action.
			// Assert the resulting STORE state (with the merge-modelling fake) so this catches the
			// keyed-map case: setFlag merges, so dropping keys requires an unsetFlag first.
			const store = {
				owned:       ["some-slug", "other-slug"],
				identified:  ["some-slug"],
				revealed:    ["some-slug", "other-slug"],
				flipped:     ["some-slug"],
				unlock:      { "some-slug:a": 1, "other-slug:a": 2 },
				boxes:       { "some-slug:back:0": true, "other-slug:back:0": true },
				backOptions: { "some-slug:x": 3, "other-slug:x": 1 },
			};
			const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository());
			await arcana.removeArcanum("some-slug");
			// Only "other-slug"'s state survives; nothing keyed to "some-slug" remains.
			expect(store.owned).toEqual(["other-slug"]);
			expect(store.identified).toEqual([]);
			expect(store.revealed).toEqual(["other-slug"]);
			expect(store.flipped).toEqual([]);
			expect(store.unlock).toEqual({ "other-slug:a": 2 });
			expect(store.boxes).toEqual({ "other-slug:back:0": true });
			expect(store.backOptions).toEqual({ "other-slug:x": 1 });
		});

		it("addLead adds the slug to both owned and leads", async () => {
			const flags = makeFlags();
			const arcana = new CharacterArcana(flags, new FakeArcanaRepository());
			await arcana.addLead("some-slug");
			expect(flags.setFlag).toHaveBeenCalledWith("owned", ["some-slug"]);
			expect(flags.setFlag).toHaveBeenCalledWith("leads", ["some-slug"]);
		});

		it("addLead preserves already-owned slugs", async () => {
			const store = { owned: ["other-slug"] };
			const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository());
			await arcana.addLead("some-slug");
			expect(store.owned).toEqual(["other-slug", "some-slug"]);
			expect(store.leads).toEqual(["some-slug"]);
		});

		it("addLead arms the backfill guard so a later-removed lead isn't resurrected", async () => {
			// Onboarding materializes the lead card via addLead; setting leadBackfilled here means
			// a subsequent removeArcanum + world reload won't have ensureLeadBackfill re-add it.
			const store = {};
			const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository());
			await arcana.addLead("some-slug");
			expect(store.leadBackfilled).toBe(true);
		});

		it("discoverArcanum drops the lead marker and identifies the slug", async () => {
			const store = { owned: ["some-slug"], leads: ["some-slug"] };
			const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository());
			await arcana.discoverArcanum("some-slug");
			expect(store.leads).toEqual([]);
			expect(store.identified).toEqual(["some-slug"]);
			expect(store.owned).toEqual(["some-slug"]);
		});

		it("discoverArcanum is a no-op for a slug that isn't a lead", async () => {
			const flags = makeFlags({ owned: ["some-slug"], identified: ["some-slug"] });
			const arcana = new CharacterArcana(flags, new FakeArcanaRepository());
			await arcana.discoverArcanum("some-slug");
			expect(flags.setFlag).not.toHaveBeenCalled();
		});

		it("removeArcanum clears the leads flag", async () => {
			const store = { owned: ["some-slug", "other-slug"], leads: ["some-slug", "other-slug"] };
			const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository());
			await arcana.removeArcanum("some-slug");
			expect(store.leads).toEqual(["other-slug"]);
		});

		describe("ensureLeadBackfill (one-time Seeker backfill)", () => {
			it("adds the Lead-role slug as a lead card and marks the backfill applied", async () => {
				const store = { minorRoles: { mastered: "m", found: "f", lead: "some-slug" } };
				const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository());
				await arcana.ensureLeadBackfill();
				expect(store.owned).toEqual(["some-slug"]);
				expect(store.leads).toEqual(["some-slug"]);
				expect(store.leadBackfilled).toBe(true);
			});

			it("is a no-op once the backfill flag is set (never resurrects a removed card)", async () => {
				// Player already discovered then removed the lead: not owned, flag already set.
				const store = { minorRoles: { lead: "some-slug" }, leadBackfilled: true };
				const flags = makeFlags(store);
				const arcana = new CharacterArcana(flags, new FakeArcanaRepository());
				await arcana.ensureLeadBackfill();
				expect(store.owned).toBeUndefined();
				expect(store.leads).toBeUndefined();
				expect(flags.setFlag).not.toHaveBeenCalled();
			});

			it("does nothing for a character with no Lead pick (non-Seeker)", async () => {
				const flags = makeFlags({});
				const arcana = new CharacterArcana(flags, new FakeArcanaRepository());
				await arcana.ensureLeadBackfill();
				expect(flags.setFlag).not.toHaveBeenCalled();
			});

			it("marks applied without re-adding when the Lead slug is already owned", async () => {
				// e.g. the player already discovered it (owned + identified) before the backfill runs.
				const store = { minorRoles: { lead: "some-slug" }, owned: ["some-slug"], identified: ["some-slug"] };
				const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository());
				await arcana.ensureLeadBackfill();
				expect(store.owned).toEqual(["some-slug"]);
				expect(store.leads).toBeUndefined();
				expect(store.leadBackfilled).toBe(true);
			});
		});

		// The three rungs of Book I p.440's "Identifying arcana" ladder. `identified` is the
		// front, `revealed` is the back, `backOwed` is the 7-9's promise of the back later.
		describe("identify tiers", () => {
			it("identifyArcanum grants the front only, and owes nothing", async () => {
				const store = {};
				const flags = makeFlags(store);
				await new CharacterArcana(flags, new FakeArcanaRepository()).identifyArcanum("some-slug");
				expect(store.identified).toEqual(["some-slug"]);
				expect(store.revealed).toBeUndefined();
				expect(store.backOwed).toBeUndefined();
			});

			it("identifyArcanum forwards options so the write is attributable", async () => {
				const flags = makeFlags();
				await new CharacterArcana(flags, new FakeArcanaRepository())
					.identifyArcanum("some-slug", { stonetopMove: "Know Things" });
				expect(flags.setFlag).toHaveBeenCalledWith("identified", ["some-slug"], { stonetopMove: "Know Things" });
			});

			it("identifyAndRevealArcanum (10+) grants both sides in ONE batched write", async () => {
				const store = {};
				const flags = makeFlags(store);
				await new CharacterArcana(flags, new FakeArcanaRepository())
					.identifyAndRevealArcanum("some-slug", { stonetopMove: "Know Things" });
				expect(flags.batch).toHaveBeenCalledTimes(1);
				expect(flags.setFlag).not.toHaveBeenCalled();
				expect(flags.batch.mock.calls[0][1]).toEqual({ stonetopMove: "Know Things" });
				expect(store.identified).toEqual(["some-slug"]);
				expect(store.revealed).toEqual(["some-slug"]);
			});

			it("identifyFrontOwedArcanum (7-9) grants the front and owes the back, never revealing it", async () => {
				const store = {};
				const flags = makeFlags(store);
				await new CharacterArcana(flags, new FakeArcanaRepository()).identifyFrontOwedArcanum("some-slug");
				expect(flags.batch).toHaveBeenCalledTimes(1);
				expect(store.identified).toEqual(["some-slug"]);
				expect(store.backOwed).toEqual(["some-slug"]);
				expect(store.revealed).toBeUndefined();
			});

			it("a 10+ after an earlier 7-9 on the same card settles the owed back", async () => {
				const store = { identified: ["some-slug"], backOwed: ["some-slug"] };
				const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository());
				await arcana.identifyAndRevealArcanum("some-slug");
				expect(store.revealed).toEqual(["some-slug"]);
				expect(store.backOwed).toEqual([]);
				expect(store.identified).toEqual(["some-slug"]);   // no duplicate
			});

			it("revealing an owed back settles the debt in the same write", async () => {
				const store = { identified: ["a"], backOwed: ["a", "b"] };
				const flags = makeFlags(store);
				await new CharacterArcana(flags, new FakeArcanaRepository()).revealArcanum("a");
				expect(flags.batch).toHaveBeenCalledTimes(1);
				expect(store.revealed).toEqual(["a"]);
				expect(store.backOwed).toEqual(["b"]);             // other cards' debts untouched
			});

			it("revealing a card that owes nothing stays a plain single write", async () => {
				const flags = makeFlags({ backOwed: ["b"] });
				await new CharacterArcana(flags, new FakeArcanaRepository()).revealArcanum("a");
				expect(flags.batch).not.toHaveBeenCalled();
				expect(flags.setFlag).toHaveBeenCalledWith("revealed", ["a"], undefined);
			});

			it("removeArcanum clears the owed back, so a re-dropped card carries no stale promise", async () => {
				const flags = makeFlags({ owned: ["a"], identified: ["a"], backOwed: ["a"] });
				await new CharacterArcana(flags, new FakeArcanaRepository()).removeArcanum("a");
				const { sets } = flags.batch.mock.calls[0][0];
				expect(sets.backOwed).toEqual([]);
				expect(sets.identified).toEqual([]);
			});

			it("buildSnapshot surfaces backOwed on the owed card only", async () => {
				const snapshot = await makeArcana({
					owned:      ["huge-wooden-sphere", "test-arcanum"],
					identified: ["huge-wooden-sphere", "test-arcanum"],
					backOwed:   ["huge-wooden-sphere"],
				}, [FFYRNIG_SPHERE, ARCANUM_WITH_BACK_OPTS]).buildSnapshot();
				const items = [...snapshot.minor.items, ...snapshot.major.items];
				expect(items.find(i => i.slug === "huge-wooden-sphere").backOwed).toBe(true);
				expect(items.find(i => i.slug === "test-arcanum").backOwed).toBe(false);
			});
		});

		it("revealArcanum adds slug to revealed flag", async () => {
			const flags = makeFlags();
			const arcana = new CharacterArcana(flags, new FakeArcanaRepository());
			await arcana.revealArcanum("some-slug");
			expect(flags.setFlag).toHaveBeenCalledWith("revealed", ["some-slug"], undefined);
		});

		it("hideArcanum removes slug from revealed flag", async () => {
			const flags = makeFlags({ revealed: ["some-slug"] });
			const arcana = new CharacterArcana(flags, new FakeArcanaRepository());
			await arcana.hideArcanum("some-slug");
			expect(flags.setFlag).toHaveBeenCalledWith("revealed", [], undefined);
		});

		it("setUnlockCount stores the count under arcanumSlug:optionSlug key", async () => {
			const flags = makeFlags();
			const arcana = new CharacterArcana(flags, new FakeArcanaRepository());
			await arcana.setUnlockCount("huge-wooden-sphere", "dig-sphere", 1);
			expect(flags.setFlag).toHaveBeenCalledWith("unlock", { "huge-wooden-sphere:dig-sphere": 1 });
		});

	});
});

// -- Additional fixtures -------------------------------------------------------

const CARVINGS_IN_A_CAVE = {
	slug: "carvings-in-a-cave",
	front: {
		title: "Carvings in a Cave",
		item: null,
		description: "<p>Strange carvings.</p>",
		unlock: { description: "Unlock by…", requirements: [] },
	},
	back: {
		title: "Shell Game of Souls",
		item: null,
		description: "<p>You may contain souls.</p>",
		resource: { max: null, maxStat: "con", title: "Souls", labels: [] },
		move: null,
		options: [],
	},
};

const BOW_WITH_NO_STRING = {
	slug: "bow-with-no-string",
	front: {
		title: "A Bow with No String",
		item: { name: "A Bow with No String", weight: 1, note: null, inventoryColumn: "regular" },
		description: "<p>An ancient bow.</p>",
		unlock: { description: "Unlock by…", requirements: [] },
	},
	back: {
		title: "Thunderbolt Bow",
		item: {
			name: "Thunderbolt Bow",
			weight: 1,
			note: "<em>magical</em>",
			inventoryColumn: "regular",
			resource: { max: 3, maxStat: null, title: "Ammo", labels: ["plenty left", "low ammo", "all out"] },
		},
		description: "<p>The bow crackles with lightning.</p>",
		resource: null,
		move: null,
		options: [],
	},
};

describe("CharacterArcana.buildSnapshot() — inventoryResources param", () => {
	it("back.resource uses inventoryResources current for back.resource arcana", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([FFYRNIG_SPHERE]),
		);
		const item = (await arcana.buildSnapshot({}, {}, { "huge-wooden-sphere": 2 })).minor.items[0];
		expect(item.back.resource.current).toBe(2);
	});

	it("back.resource defaults to current 0 when not in inventoryResources", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([FFYRNIG_SPHERE]),
		);
		const item = (await arcana.buildSnapshot()).minor.items[0];
		expect(item.back.resource.current).toBe(0);
	});

	it("back.item.resource is a resolved Resource on the OutfitItem snapshot", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["bow-with-no-string"] }),
			new FakeArcanaRepository([BOW_WITH_NO_STRING]),
		);
		const item = (await arcana.buildSnapshot({}, {}, { "bow-with-no-string": 1 })).minor.items[0];
		expect(item.back.item.resource).not.toBeNull();
		expect(item.back.item.resource.current).toBe(1);
		expect(item.back.item.resource.max).toBe(3);
		expect(item.back.item.resource.title).toBe("Ammo");
	});

	it("back.item.resource defaults to current 0 when not in inventoryResources", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["bow-with-no-string"] }),
			new FakeArcanaRepository([BOW_WITH_NO_STRING]),
		);
		const item = (await arcana.buildSnapshot()).minor.items[0];
		expect(item.back.item.resource.current).toBe(0);
	});

	it("back.resource is null for arcana whose resource lives on the item", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["bow-with-no-string"] }),
			new FakeArcanaRepository([BOW_WITH_NO_STRING]),
		);
		expect((await arcana.buildSnapshot()).minor.items[0].back.resource).toBeNull();
	});

	it("back.item.resource is null for arcana with a standalone resource", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([FFYRNIG_SPHERE]),
		);
		expect((await arcana.buildSnapshot()).minor.items[0].back.item.resource).toBeNull();
	});

	it("back.resource is null when neither back.resource nor back.item.resource defined", async () => {
		const noResource = { ...FFYRNIG_SPHERE, back: { ...FFYRNIG_SPHERE.back, resource: null } };
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([noResource]),
		);
		expect((await arcana.buildSnapshot()).minor.items[0].back.resource).toBeNull();
	});
});

describe("CharacterArcana.weightedInventoryItems() — carried side follows unlock state", () => {
	// Which side's item you carry follows unlock state, not the old manual flip: a locked card
	// carries its FRONT item; once every requirement is met AND the card is identified it unlocks
	// and carries the BACK item. The identified gate keeps an unidentified, face-down card showing
	// its front item even with unlock marks set, so a card's realised item can't leak before it's
	// identified. FFYRNIG_SPHERE's own front is a weightless, immobile place (filtered off the
	// inventory — see the last test), so the side-selection cases use a weighted-front variant to
	// observe the front item directly.
	const WEIGHTED_FRONT_SPHERE = {
		...FFYRNIG_SPHERE,
		front: {
			...FFYRNIG_SPHERE.front,
			item: { name: "A Carved Charm", weight: 1, note: null, inventoryColumn: "regular" },
		},
	};
	const LOCKED = { owned: ["huge-wooden-sphere"] };
	const UNLOCKED = {
		owned: ["huge-wooden-sphere"],
		identified: ["huge-wooden-sphere"],
		unlock: {
			"huge-wooden-sphere:dig-sphere": 1,
			"huge-wooden-sphere:study-glyphs": 1,
			"huge-wooden-sphere:risk-recipe": 3,
		},
	};

	it("carries the FRONT item while the card is still locked", async () => {
		const arcana = new CharacterArcana(makeFlags(LOCKED), new FakeArcanaRepository([WEIGHTED_FRONT_SPHERE]));
		const items = await arcana.weightedInventoryItems();
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe("A Carved Charm");
	});

	it("carries the BACK item once the card is unlocked", async () => {
		const arcana = new CharacterArcana(makeFlags(UNLOCKED), new FakeArcanaRepository([FFYRNIG_SPHERE]));
		const items = await arcana.weightedInventoryItems();
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe("Ffyrnig Tonic");
	});

	it("keeps the FRONT item when unlock marks are set but the card isn't identified", async () => {
		// Unlock marks without identification (a face-down mystery) must never surface the back
		// item — guards a homebrew card whose unlock is vacuously satisfied from leaking its back.
		const { identified, ...unidentified } = UNLOCKED;
		const arcana = new CharacterArcana(makeFlags(unidentified), new FakeArcanaRepository([WEIGHTED_FRONT_SPHERE]));
		const items = await arcana.weightedInventoryItems();
		expect(items[0].name).toBe("A Carved Charm");
	});

	it("ignores the legacy flipped flag entirely", async () => {
		// A leftover flipped flag must not flip the carried side anymore.
		const arcana = new CharacterArcana(
			makeFlags({ ...LOCKED, flipped: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([WEIGHTED_FRONT_SPHERE]),
		);
		const items = await arcana.weightedInventoryItems();
		expect(items[0].name).toBe("A Carved Charm");
	});

	it("omits the weightless side of a concept/place arcanum from the inventory", async () => {
		// huge-wooden-sphere is a non-carriable place (CONCEPT_ARCANA_SLUGS); its weightless
		// front is a huge, immobile, half-buried sphere and contributes nothing to inventory.
		const arcana = new CharacterArcana(makeFlags(LOCKED), new FakeArcanaRepository([FFYRNIG_SPHERE]));
		const items = await arcana.weightedInventoryItems();
		expect(items).toHaveLength(0);
	});

	it("excludes an un-recovered lead card's curio from the inventory", async () => {
		// A lead is owned (so it renders on the arcana tab) but not yet recovered, so its curio
		// isn't in the party's packs — it must not leak into the Inventory/Outfit list or count
		// toward load. Once discovered (dropped from leads) it flows through normally.
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["huge-wooden-sphere"], leads: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([WEIGHTED_FRONT_SPHERE]),
		);
		const items = await arcana.weightedInventoryItems();
		expect(items).toHaveLength(0);
	});

	it("still renders a weightless CURIO (a non-concept card) at ◇0", async () => {
		// Most arcana curios ship with no explicit weight; a null weight alone must NOT hide
		// them — only cards in the concept list are held back. "A gold ring" is carried gear.
		const RING = {
			...FFYRNIG_SPHERE,
			slug: "gold-ring",
			front: {
				...FFYRNIG_SPHERE.front,
				item: { name: "A gold ring", weight: null, note: "<em>magical</em>", inventoryColumn: null },
			},
		};
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["gold-ring"] }),
			new FakeArcanaRepository([RING]),
		);
		const items = await arcana.weightedInventoryItems();
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe("A gold ring");
		expect(items[0].weight).toBe(0);
	});
});

describe("CharacterArcana.buildSnapshot() — maxStat resolution", () => {
	it("maxStat resolves to stat value from stats param", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["carvings-in-a-cave"] }),
			new FakeArcanaRepository([CARVINGS_IN_A_CAVE]),
		);
		const item = (await arcana.buildSnapshot({ con: { value: 3 } })).minor.items[0];
		expect(item.back.resource.max).toBe(3);
	});

	it("maxStat resolves to 0 when stat is missing", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["carvings-in-a-cave"] }),
			new FakeArcanaRepository([CARVINGS_IN_A_CAVE]),
		);
		const item = (await arcana.buildSnapshot({})).minor.items[0];
		expect(item.back.resource.max).toBe(0);
	});

	it("fixed max is used unchanged when maxStat is null", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([FFYRNIG_SPHERE]),
		);
		const item = (await arcana.buildSnapshot()).minor.items[0];
		expect(item.back.resource.max).toBe(3);
	});
});

describe("CharacterArcana.buildSnapshot() — checked state", () => {
	it("checked defaults to false when not in checkedMap", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([FFYRNIG_SPHERE]),
		);
		const item = (await arcana.buildSnapshot()).minor.items[0];
		expect(item.checked).toBe(false);
	});

	it("checked is true when slug is in checkedMap", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([FFYRNIG_SPHERE]),
		);
		const item = (await arcana.buildSnapshot({}, { "huge-wooden-sphere": true })).minor.items[0];
		expect(item.checked).toBe(true);
	});

	it("checked is false when slug is not in checkedMap", async () => {
		const arcana = new CharacterArcana(
			makeFlags({ owned: ["huge-wooden-sphere"] }),
			new FakeArcanaRepository([FFYRNIG_SPHERE]),
		);
		const item = (await arcana.buildSnapshot({}, { "other-slug": true })).minor.items[0];
		expect(item.checked).toBe(false);
	});
});
