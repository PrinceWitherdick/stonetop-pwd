import {describe, expect, it, vi} from "vitest";
import {FakeMoveRepository} from "../../fakes/FakeMoveRepository.js";
import {TestCharacterBuilder} from "../../fakes/TestCharacterBuilder.js";
import {BLESSED_PLAYBOOK, HEAVY_PLAYBOOK, FakePlaybookRepository} from "../../fakes/FakePlaybookRepository.js";
import {FakeActorBuilder} from "../../fakes/FakeActorBuilder.js";
import {MoveDefinition} from "../../../module/model/MoveDefinition.js";
import {treasureItemData} from "../../../module/utils/treasure-drops.js";
import {buildInventoryItemData} from "../../../module/utils/inventory-item-data.js";

// -- actor updates ------------------------------------------------------------

describe("StonetopCharacter.updateName", () => {
	it("updates the prototype token name when it still matches the actor name", async () => {
		const actor = new FakeActorBuilder().withName("Brakken").build();
		actor.prototypeToken = { name: "Brakken" };
		const char = new TestCharacterBuilder(actor).build();

		await char.updateName("Arwel");

		expect(actor.update).toHaveBeenCalledWith({
			name: "Arwel",
			"prototypeToken.name": "Arwel",
		});
	});

	it("updates a blank prototype token name with the actor name", async () => {
		const actor = new FakeActorBuilder().withName("Brakken").build();
		actor.prototypeToken = { name: "" };
		const char = new TestCharacterBuilder(actor).build();

		await char.updateName("Arwel");

		expect(actor.update).toHaveBeenCalledWith({
			name: "Arwel",
			"prototypeToken.name": "Arwel",
		});
	});

	it("preserves a custom prototype token name", async () => {
		const actor = new FakeActorBuilder().withName("Brakken").build();
		actor.prototypeToken = { name: "The Masked One" };
		const char = new TestCharacterBuilder(actor).build();

		await char.updateName("Arwel");

		expect(actor.update).toHaveBeenCalledWith({ name: "Arwel" });
	});
});

describe("StonetopCharacter.addDroppedInventoryItem", () => {
	it("creates a rendered custom inventory item from a dropped inventory card", async () => {
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();

		await char.addDroppedInventoryItem({
			name: "Sword, iron",
			type: "move",
			system: { moveType: "inventory" },
			flags: {
				stonetop: {
					inventoryColumn: "regular",
					weight: 1,
					note: "<em>iron</em>, <em>hand</em>, <em>close</em>, +1 damage",
					armor: { modifier: 1 },
					resource: { max: 3, title: "Uses", labels: ["some", "last", "out"] },
				},
			},
		});

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{
			name: "Sword, iron",
			type: "move",
			system: {
				moveType: "inventory-custom",
				inventoryColumn: "regular",
				weight: 1,
				note: "<em>iron</em>, <em>hand</em>, <em>close</em>, +1 damage",
				resource: { max: 3, title: "Uses", labels: ["some", "last", "out"] },
				armor: { modifier: 1 },
			},
		}]);
	});

	it("carries a journal treasure's marker through the re-plant", async () => {
		// This rebuild copies only the fields it names, so the isTreasure marker has to be
		// carried explicitly — without it a dropped treasure is indistinguishable from a
		// hand-written item and can't be grouped under "Treasures" on the gear tab.
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();

		await char.addDroppedInventoryItem(treasureItemData({
			name: "Brass sphere", section: "Ustrina", origin: "Brass sphere",
			column: "regular", weight: 1, note: "magical", value: "2", uses: 3, usesLabel: "hours",
		}));

		const [, [created]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(created.name).toBe("Brass sphere");
		expect(created.system).toMatchObject({ moveType: "inventory-custom", isTreasure: true });
	});

	it("carries a journal treasure's art through the re-plant", async () => {
		// A treasure resolves its illustration at DRAG time (there is no document to point at
		// ahead of time), so the drop payload is the only thing carrying it. Rebuilding the
		// item without img drops the picture for the sheet copy — the drop target that
		// actually matters — leaving the whole art pipeline visible only in the Items sidebar.
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();

		// Only a treasure this world has imported carries an img at all, so stub the
		// world-scoped treasureArt index (slug -> path) the drag-time lookup reads.
		const src = "stonetop-book-art/assets/treasures/ustrina-brass-sphere.webp";
		const prevGame = globalThis.game;
		globalThis.game = { settings: {
			settings: new Map([["stonetop-pwd.treasureArt", {}], ["stonetop-pwd.book2ArtRoot", {}]]),
			get: (_ns, key) => ({
				treasureArt: { "ustrina-brass-sphere": "assets/treasures/ustrina-brass-sphere.webp" },
				book2ArtRoot: "stonetop-book-art",
			}[key]),
		} };
		let dropped;
		try {
			dropped = treasureItemData({
				name: "Brass sphere", section: "Ustrina", origin: "Brass sphere", slug: "ustrina-brass-sphere",
				column: "regular", weight: 1, note: "magical", value: "2", uses: 3, usesLabel: "hours",
			});
		} finally { globalThis.game = prevGame; }
		expect(dropped.img).toBe(src);          // the drag payload has art...
		await char.addDroppedInventoryItem(dropped);

		const [, [created]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(created.img).toBe(src);          // ...and the embedded copy keeps it
	});

	it("leaves img off a drop that has none, so Foundry's default still applies", () => {
		// Pinning img to null/"" would override the document default with an empty path.
		expect(buildInventoryItemData({ name: "Rope" })).not.toHaveProperty("img");
	});

	it("does not mark an ordinary dropped item as a treasure", async () => {
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();

		await char.addDroppedInventoryItem({
			name: "Rope", type: "move", system: { moveType: "inventory" },
			flags: { stonetop: { inventoryColumn: "regular", weight: 1 } },
		});

		const [, [created]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(created.system.isTreasure).toBeUndefined();
	});

	it("creates small dropped inventory items in the small column without load weight", async () => {
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();

		await char.addDroppedInventoryItem({
			name: "Awl",
			type: "move",
			system: { moveType: "inventory" },
			flags: { stonetop: { inventoryColumn: "small", weight: 1 } },
		});

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{
			name: "Awl",
			type: "move",
			system: {
				moveType: "inventory-custom",
				inventoryColumn: "small",
			},
		}]);
	});
});

describe("StonetopCharacter.createCustomInventoryItem", () => {
	it("creates a regular item with weight, tags, uses/ammo and armor", async () => {
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();

		await char.createCustomInventoryItem({
			name: "Bow & iron arrows",
			column: "regular",
			weight: 1,
			note: "<em>near</em>, x <em>piercing</em>",
			resource: { max: 2, title: null, labels: ["low ammo", "all out"] },
			armor: null,
		});

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{
			name: "Bow & iron arrows",
			type: "move",
			system: {
				moveType: "inventory-custom",
				inventoryColumn: "regular",
				weight: 1,
				note: "<em>near</em>, x <em>piercing</em>",
				resource: { max: 2, title: null, labels: ["low ammo", "all out"] },
			},
		}]);
	});

	it("omits weight, resource and armor for a bare small item", async () => {
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();

		await char.createCustomInventoryItem({ name: "Awl", column: "small" });

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{
			name: "Awl",
			type: "move",
			system: { moveType: "inventory-custom", inventoryColumn: "small" },
		}]);
	});

	it("floors weight at 1 and carries a worn-armor modifier", async () => {
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();

		await char.createCustomInventoryItem({
			name: "Shield", column: "regular", weight: 0, armor: { modifier: 1 },
		});

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{
			name: "Shield",
			type: "move",
			system: {
				moveType: "inventory-custom",
				inventoryColumn: "regular",
				weight: 1,
				armor: { modifier: 1 },
			},
		}]);
	});
});

// -- buildSnapshot (playbook display fields) ----------------------------------

describe("StonetopCharacter.buildSnapshot — playbook display fields", () => {
	it("returns playbook=null with empty movelist when no playbook", async () => {
		const char = new TestCharacterBuilder(new FakeActorBuilder().build()).build();
		const data = await char.buildSnapshot();
		expect(data.playbook).toBeNull();
		expect(data.movelist.playbookMoves).toHaveLength(0);
		expect(data.movelist.basicMoves).toHaveLength(0);
	});

	it("returns movelist with otherMoves even when no playbook", async () => {
		const move = { _id: "m1", type: "move", name: "Custom Move", system: { moveType: "other", rollType: null } };
		const char = new TestCharacterBuilder(new FakeActorBuilder().withItems([move]).build()).build();
		const data = await char.buildSnapshot();
		expect(data.movelist.otherMoves).toHaveLength(1);
		expect(data.movelist.otherMoves[0].name).toBe("Custom Move");
	});

	it("orders otherMoves learned-first, then by name", async () => {
		const other = (id, name, learned = true) => ({
			_id: id, type: "move", name,
			system: { moveType: "other", rollType: null },
			flags: { "stonetop-pwd": { custom: true, ...(learned ? {} : { learned: false }) } },
		});
		// Creation order deliberately fights both sort keys.
		const actor = new FakeActorBuilder()
			.withItems([other("m1", "Zeal"), other("m2", "Dirge", false), other("m3", "Anthem")])
			.build();
		const data = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(data.movelist.otherMoves.map(m => m.name)).toEqual(["Anthem", "Zeal", "Dirge"]);
	});

	// A move dropped on the sheet from another playbook lands in Other Moves keeping its
	// origin in system.playbook. Without a badge it sits there unexplained — the corner
	// label is how the sheet says "this came from the Fox", the way a playbook row says
	// "Starting move".
	describe("otherMoves origin badge", () => {
		const otherMove = (playbook) => ({
			_id: "m1", type: "move", name: "Ambush",
			system: { moveType: "other", rollType: null, playbook },
		});
		const labelFor = async (actorPlaybook, movePlaybook) => {
			const builder = new FakeActorBuilder().withItems([otherMove(movePlaybook)]);
			if (actorPlaybook) builder.withPlaybook("the-would-be-hero", actorPlaybook);
			const snap = await new TestCharacterBuilder(builder.build()).build().buildSnapshot();
			return snap.movelist.otherMoves[0].sourceLabel;
		};

		it("names the origin playbook when it isn't the character's own", async () => {
			expect(await labelFor("The Would-Be Hero", "The Fox")).toBe("The Fox");
		});

		// Their own playbook's name in the corner of their own sheet says nothing.
		it("stays null for a move from the character's own playbook", async () => {
			expect(await labelFor("The Fox", "The Fox")).toBeNull();
		});

		it("stays null for a homegrown move with no playbook at all", async () => {
			expect(await labelFor("The Fox", undefined)).toBeNull();
		});
	});

	it("returns playbook object when playbook present", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-blessed", "The Blessed").build();
		const char = new TestCharacterBuilder(actor).addPlaybook(BLESSED_PLAYBOOK).build();
		const data = await char.buildSnapshot();
		expect(data.playbook).not.toBeNull();
	});

	describe("with no saved selections", () => {
		async function buildCharacterSnapshot() {
			const actor = new FakeActorBuilder().withPlaybook("the-blessed", "The Blessed").build();
			return new TestCharacterBuilder(actor).addPlaybook(BLESSED_PLAYBOOK).build().buildSnapshot();
		}

		it("maps backgrounds, none selected", async () => {
			const data = await buildCharacterSnapshot();
			expect(data.playbook.background.options).toHaveLength(3);
			expect(data.playbook.background.options.every(b => !b.selected)).toBe(true);
		});

		it("maps instincts with value field and none selected", async () => {
			const data = await buildCharacterSnapshot();
			expect(data.playbook.instinct.options).toHaveLength(5);
			expect(data.playbook.instinct.options[0].value).toBe("Delight — To find beauty, in even the ugliest things.");
			expect(data.playbook.instinct.options.every(i => !i.selected)).toBe(true);
		});

		it("maps appearance lines with lineIdx and no selections", async () => {
			const data = await buildCharacterSnapshot();
			expect(data.playbook.appearance.options).toHaveLength(4);
			expect(data.playbook.appearance.options[0].lineIdx).toBe(0);
			expect(data.playbook.appearance.options[0].options.every(o => !o.selected)).toBe(true);
		});

		it("maps origins with none selected", async () => {
			const data = await buildCharacterSnapshot();
			expect(data.playbook.origin.options).toHaveLength(4);
			expect(data.playbook.origin.options.every(o => !o.selected)).toBe(true);
			expect(data.playbook.origin.options[0].region).toBe("Stonetop");
		});
	});

	describe("with saved selections", () => {
		async function buildCtx() {
			const actor = new FakeActorBuilder()
				.withPlaybook("the-blessed", "The Blessed")
				.withFlag("background.selected", "vessel")
				.withFlag("instinct.selected", "Delight — To find beauty, in even the ugliest things.")
				.withFlag("appearance.selected", { 0: "gray & wizened" })
				.withFlag("origin.selected", "Barrier Pass")
				.build();
			return new TestCharacterBuilder(actor).addPlaybook(BLESSED_PLAYBOOK).build().buildSnapshot();
		}

		it("marks the saved background as selected", async () => {
			const data = await buildCtx();
			expect(data.playbook.background.options.find(b => b.slug === "vessel").selected).toBe(true);
			expect(data.playbook.background.options.filter(b => b.selected)).toHaveLength(1);
		});

		it("marks the matching instinct as selected", async () => {
			const data = await buildCtx();
			expect(data.playbook.instinct.selected).toBe("Delight — To find beauty, in even the ugliest things.");
			expect(data.playbook.instinct.options.find(i => i.word === "Delight").selected).toBe(true);
		});

		it("marks saved appearance option as selected", async () => {
			const data = await buildCtx();
			expect(data.playbook.appearance.options[0].options.find(o => o.value === "gray & wizened").selected).toBe(true);
		});

		it("marks the saved origin as selected", async () => {
			const data = await buildCtx();
			expect(data.playbook.origin.options.find(o => o.region === "Barrier Pass").selected).toBe(true);
		});
	});
});

// -- buildMovelistContext -----------------------------------------------------

function makeEntry(overrides = {}) {
	return new MoveDefinition({
		_id: overrides._id ?? "abc123",
		name: overrides.name ?? "Test Move",
		system: {
			description: overrides.description ?? "A test move.",
			rollType: overrides.rollType ?? null,
			isStartingMove: overrides.isStartingMove ?? false,
			requirement: overrides.requirement ?? null,
		},
	});
}

describe("StonetopCharacter.buildMovelistContext", () => {
	const char = new TestCharacterBuilder(new FakeActorBuilder().build())
		.withPlaybookRepo(undefined)
		.withMoveRepo(undefined)
		.build();

	it("returns empty array for empty entries", () => {
		expect(char.buildMovelistContext([], new Map(), new Set(), 1)).toHaveLength(0);
	});

	it("unowned move with no lock: owned=false, locked=false", () => {
		const [m] = char.buildMovelistContext([makeEntry()], new Map(), new Set(), 1);
		expect(m.owned).toBe(false);
		expect(m.locked).toBe(false);
		expect(m.ownedId).toBeNull();
	});

	it("owned move: owned=true, ownedId set", () => {
		const entry = makeEntry({ name: "Bulwark" });
		const owned = { _id: "item-xyz" };
		const [m] = char.buildMovelistContext([entry], new Map([["Bulwark", [owned]]]), new Set(), 1);
		expect(m.owned).toBe(true);
		expect(m.ownedId).toBe("item-xyz");
	});

	it("isStartingMove: isStarting=true, source=Starting, locked=false", () => {
		const [m] = char.buildMovelistContext([makeEntry({ isStartingMove: true })], new Map(), new Set(), 1);
		expect(m.isStarting).toBe(true);
		expect(m.source).toBe("Starting move");
		expect(m.locked).toBe(false);
	});

	it("background move name in bgMoveNames: isStarting=true, source=Background", () => {
		const entry = makeEntry({ name: "Trackless Step" });
		const [m] = char.buildMovelistContext([entry], new Map(), new Set(["Trackless Step"]), 1);
		expect(m.isStarting).toBe(true);
		expect(m.source).toBe("Background");
		expect(m.locked).toBe(false);
	});

	it("regular move: isStarting=false, source=null", () => {
		const [m] = char.buildMovelistContext([makeEntry({})], new Map(), new Set(), 1);
		expect(m.isStarting).toBe(false);
		expect(m.source).toBeNull();
	});

	it("requires a move not owned: locked=true", () => {
		const entry = makeEntry({ requirement: { moves: ["Glorious Servant"] } });
		const [m] = char.buildMovelistContext([entry], new Map(), new Set(), 1);
		expect(m.locked).toBe(true);
	});

	it("requires a move that IS owned: locked=false", () => {
		const entry = makeEntry({ requirement: { moves: ["Glorious Servant"] } });
		const ownedBy = new Map([["Glorious Servant", [{ _id: "gs-id" }]]]);
		const [m] = char.buildMovelistContext([entry], ownedBy, new Set(), 1);
		expect(m.locked).toBe(false);
	});

	it("minLevel above actor level: locked=true", () => {
		const entry = makeEntry({ requirement: { level: 6 } });
		const [m] = char.buildMovelistContext([entry], new Map(), new Set(), 1);
		expect(m.locked).toBe(true);
	});

	it("minLevel at or below actor level: locked=false", () => {
		const entry = makeEntry({ requirement: { level: 3 } });
		const [m] = char.buildMovelistContext([entry], new Map(), new Set(), 3);
		expect(m.locked).toBe(false);
	});

	it("rollType passes through", () => {
		const [m] = char.buildMovelistContext([makeEntry({ rollType: "con" })], new Map(), new Set(), 1);
		expect(m.rollType).toBe("con");
	});

	it("starting move with requires is NOT locked (isStarting overrides)", () => {
		const entry = makeEntry({ isStartingMove: true, requirement: { moves: ["Some Move"] } });
		const [m] = char.buildMovelistContext([entry], new Map(), new Set(), 1);
		expect(m.isStarting).toBe(true);
		expect(m.locked).toBe(false);
	});

	it("requires playbook not matching: locked=true", () => {
		const entry = makeEntry({ requirement: { playbook: "The Blessed" } });
		const [m] = char.buildMovelistContext([entry], new Map(), new Set(), 1, "The Fox");
		expect(m.locked).toBe(true);
	});

	it("requires playbook matching actor: locked=false", () => {
		const entry = makeEntry({ requirement: { playbook: "The Blessed" } });
		const [m] = char.buildMovelistContext([entry], new Map(), new Set(), 1, "The Blessed");
		expect(m.locked).toBe(false);
	});

	it("requiresLabel joins multiple moves", () => {
		const entry = makeEntry({ requirement: { moves: ["Move A", "Move B"] } });
		const [m] = char.buildMovelistContext([entry], new Map(), new Set(), 1);
		expect(m.requiresLabel).toBe("Move A, Move B");
	});

	it("requiresPlaybook set from requirement.playbook", () => {
		const entry = makeEntry({ requirement: { playbook: "The Blessed" } });
		const [m] = char.buildMovelistContext([entry], new Map(), new Set(), 1, "The Blessed");
		expect(m.requiresPlaybook).toBe("The Blessed");
	});
});

// -- sortPlaybookMoves --------------------------------------------------------

function mv(name, { requires = null, minLevel = null } = {}) { return { name, requires, minLevel }; }
function names(moves) { return moves.map(m => m.name); }

describe("StonetopCharacter.sortPlaybookMoves", () => {
	const char = new TestCharacterBuilder(new FakeActorBuilder().build())
		.withPlaybookRepo(undefined)
		.withMoveRepo(undefined)
		.build();

	it("returns empty array for empty input", () => {
		expect(char.sortPlaybookMoves([])).toEqual([]);
	});

	it("single move with no requires is returned as-is", () => {
		expect(names(char.sortPlaybookMoves([mv("Alpha")]))).toEqual(["Alpha"]);
	});

	it("multiple independent moves are sorted alphabetically", () => {
		expect(names(char.sortPlaybookMoves([mv("Charlie"), mv("Alpha"), mv("Bravo")]))).toEqual(["Alpha", "Bravo", "Charlie"]);
	});

	it("a move that requires another follows it immediately", () => {
		const result = names(char.sortPlaybookMoves([mv("Child", { requires: "Parent" }), mv("Parent"), mv("Alpha")]));
		expect(result).toEqual(["Alpha", "Parent", "Child"]);
	});

	it("multiple moves requiring the same parent are sorted alphabetically after it", () => {
		const moves = [mv("Zeta", { requires: "Parent" }), mv("Alpha", { requires: "Parent" }), mv("Parent"), mv("Root")];
		expect(names(char.sortPlaybookMoves(moves))).toEqual(["Parent", "Alpha", "Zeta", "Root"]);
	});

	it("chains: grandchild follows child follows parent", () => {
		const moves = [mv("Grandchild", { requires: "Child" }), mv("Child", { requires: "Parent" }), mv("Parent")];
		expect(names(char.sortPlaybookMoves(moves))).toEqual(["Parent", "Child", "Grandchild"]);
	});

	it("root moves stay alphabetical while dependents follow their parents", () => {
		const moves = [
			mv("Zeal"), mv("Zeal-Child", { requires: "Zeal" }),
			mv("Armor"), mv("Armor-Child-B", { requires: "Armor" }), mv("Armor-Child-A", { requires: "Armor" }),
		];
		expect(names(char.sortPlaybookMoves(moves))).toEqual(["Armor", "Armor-Child-A", "Armor-Child-B", "Zeal", "Zeal-Child"]);
	});

	it("move requiring a non-existent parent is treated as a root", () => {
		expect(names(char.sortPlaybookMoves([mv("Orphan", { requires: "Missing Parent" }), mv("Alpha")]))).toEqual(["Alpha", "Orphan"]);
	});

	it("circular dependency does not infinite-loop", () => {
		const moves = [mv("A", { requires: "B" }), mv("B", { requires: "A" })];
		expect(() => char.sortPlaybookMoves(moves)).not.toThrow();
		expect(char.sortPlaybookMoves(moves)).toHaveLength(2);
	});

	it("level-6 moves come after all level-0 moves", () => {
		expect(names(char.sortPlaybookMoves([mv("Bravo", { minLevel: 6 }), mv("Alpha"), mv("Charlie", { minLevel: 6 })]))).toEqual(["Alpha", "Bravo", "Charlie"]);
	});

	it("level groups are sorted ascending: 0, 2, 6", () => {
		expect(names(char.sortPlaybookMoves([mv("L6", { minLevel: 6 }), mv("L2", { minLevel: 2 }), mv("L0")]))).toEqual(["L0", "L2", "L6"]);
	});

	it("within a level group, dependency chaining still applies", () => {
		const moves = [mv("Child", { minLevel: 6, requires: "Parent" }), mv("Parent", { minLevel: 6 }), mv("Alpha", { minLevel: 6 })];
		expect(names(char.sortPlaybookMoves(moves))).toEqual(["Alpha", "Parent", "Child"]);
	});

	it("cross-level dependency is ignored: level-6 move requiring level-0 move stays in level-6 group", () => {
		const moves = [mv("Root"), mv("Lv6-Child", { minLevel: 6, requires: "Root" }), mv("Alpha")];
		expect(names(char.sortPlaybookMoves(moves))).toEqual(["Alpha", "Root", "Lv6-Child"]);
	});
});

// -- ensureStartingMoves ------------------------------------------------------

describe("StonetopCharacter.ensureStartingMoves", () => {
	function makeMoveEntry(name, isStartingMove, id) {
		return { _id: id, name, system: { isStartingMove, playbook: "The Blessed" }, toObject: () => ({ name }) };
	}

	it("does nothing when no playbook set", async () => {
		const actor = new FakeActorBuilder().build();
		const char = new TestCharacterBuilder(actor).build();
		await char.ensureStartingMoves();
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("adds missing starting moves", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-blessed", "The Blessed").build();
		const char = new TestCharacterBuilder(actor)
			.addPlaybook(BLESSED_PLAYBOOK)
			.addPlaybookMove(makeMoveEntry("Rites of the Land", true, "id1"))
			.build();
		await char.ensureStartingMoves();
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{ name: "Rites of the Land" }]);
	});

	it("does not add moves the actor already owns", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-blessed", "The Blessed")
			.withItems([{ type: "move", name: "Rites of the Land" }])
			.build();
		const entries = [makeMoveEntry("Rites of the Land", true, "id1")];
		const char = new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(BLESSED_PLAYBOOK))
			.withMoveRepo(new FakeMoveRepository(entries, []))
			.build();
		await char.ensureStartingMoves();
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("does not auto-grant 'either X OR Y' starting-move choices", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-heavy", "The Heavy").build();
		const char = new TestCharacterBuilder(actor)
			.addPlaybook(HEAVY_PLAYBOOK)
			.addPlaybookMove(makeMoveEntry("Dangerous", true, "d1"))
			.addPlaybookMove(makeMoveEntry("Hard to Kill", true, "h1"))
			.addPlaybookMove(makeMoveEntry("Armored", true, "a1"))
			.addPlaybookMove(makeMoveEntry("Uncanny Reflexes", true, "u1"))
			.build();
		await char.ensureStartingMoves();
		// Dangerous + Hard to Kill are granted; the Armored/Uncanny Reflexes choice is not.
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
			{ name: "Dangerous" },
			{ name: "Hard to Kill" },
		]);
	});

	it("adds background-specific moves based on selected background", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-blessed", "The Blessed")
			.withFlag("background.selected", "initiate")
			.build();
		const entries = [makeMoveEntry("Rites of the Land", false, "id1")];
		const char = new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(BLESSED_PLAYBOOK))
			.withMoveRepo(new FakeMoveRepository(entries, []))
			.build();
		await char.ensureStartingMoves();
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{ name: "Rites of the Land" }]);
	});
});

// -- applyStartingMoveChoices -------------------------------------------------

describe("StonetopCharacter.applyStartingMoveChoices", () => {
	const move = (name, id) => ({ _id: id, name, system: {}, toObject: () => ({ name }) });
	const GROUPS = [{ label: "Choose one", options: ["Armored", "Uncanny Reflexes"] }];

	function charWith(items) {
		const actor = new FakeActorBuilder().withPlaybook("the-heavy", "The Heavy").withItems(items).build();
		const char = new TestCharacterBuilder(actor)
			.withMoveRepo(new FakeMoveRepository([move("Armored", "a1"), move("Uncanny Reflexes", "u1")], []))
			.build();
		return { actor, char };
	}

	it("grants the chosen move when nothing in the group is owned", async () => {
		const { actor, char } = charWith([]);
		await char.applyStartingMoveChoices(GROUPS, { 0: "a1" });
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{ name: "Armored" }]);
		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("removes a previously-chosen alternative when the pick changes", async () => {
		const { actor, char } = charWith([{ type: "move", name: "Armored", _id: "owned-a" }]);
		await char.applyStartingMoveChoices(GROUPS, { 0: "u1" });
		expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["owned-a"]);
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{ name: "Uncanny Reflexes" }]);
	});

	it("leaves the already-owned chosen move alone (no duplicate, no removal)", async () => {
		const { actor, char } = charWith([{ type: "move", name: "Armored", _id: "owned-a" }]);
		await char.applyStartingMoveChoices(GROUPS, { 0: "a1" });
		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("does nothing for a group with no pick", async () => {
		const { actor, char } = charWith([]);
		await char.applyStartingMoveChoices(GROUPS, {});
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

// -- computePossessionMaxUses -------------------------------------------------

const SP_BONUS = {
	options: [{
		slug: "sacred-pouch",
		resource: { max: 3, title: "Stock", labels: [] },
		usesBonus: {
			evenLevelBonus: 1,
			moveBonus: [{ moveName: "Big Magic", perInstance: 2 }],
		},
	}],
};

describe("StonetopCharacter.computePossessionMaxUses", () => {
	function makeChar() {
		return new TestCharacterBuilder(new FakeActorBuilder().build())
			.withPlaybookRepo(undefined)
			.withMoveRepo(undefined)
			.build();
	}

	it("no moves owned, level 1 → no entry (base uses unchanged)", () => {
		const result = makeChar().computePossessionMaxUses(SP_BONUS, new Map(), 1);
		expect(result["sacred-pouch"]).toBeUndefined();
	});

	it("level 2 → +1 from even level", () => {
		const result = makeChar().computePossessionMaxUses(SP_BONUS, new Map(), 2);
		expect(result["sacred-pouch"]).toBe(4);
	});

	it("level 4 → +2 from two even levels", () => {
		const result = makeChar().computePossessionMaxUses(SP_BONUS, new Map(), 4);
		expect(result["sacred-pouch"]).toBe(5);
	});

	it("Big Magic owned once → +2", () => {
		const owned = new Map([["Big Magic", [{ _id: "bm1" }]]]);
		const result = makeChar().computePossessionMaxUses(SP_BONUS, owned, 1);
		expect(result["sacred-pouch"]).toBe(5);
	});

	it("Big Magic owned twice → +4", () => {
		const owned = new Map([["Big Magic", [{ _id: "bm1" }, { _id: "bm2" }]]]);
		const result = makeChar().computePossessionMaxUses(SP_BONUS, owned, 1);
		expect(result["sacred-pouch"]).toBe(7);
	});

	it("Big Magic once + level 4 → +2 move + +2 level = base 3 + 4", () => {
		const owned = new Map([["Big Magic", [{ _id: "bm1" }]]]);
		const result = makeChar().computePossessionMaxUses(SP_BONUS, owned, 4);
		expect(result["sacred-pouch"]).toBe(7);
	});

	it("possession without usesBonus is not affected", () => {
		const sp = { options: [{ slug: "apiary" }] };
		const result = makeChar().computePossessionMaxUses(sp, new Map(), 10);
		expect(result["apiary"]).toBeUndefined();
	});
});

// -- applyDebilityRollMode ----------------------------------------------------

function makeDebilityActor({ weakened = false, dazed = false, miserable = false } = {}) {
	return new FakeActorBuilder()
		.withDebility("weakened", weakened)
		.withDebility("dazed", dazed)
		.withDebility("miserable", miserable)
		.build();
}

describe("applyDebilityRollMode", () => {
	it("no debility active — passes rollMode def through unchanged", () => {
		const char = new TestCharacterBuilder(makeDebilityActor()).build();
		expect(char.applyDebilityRollMode("str", { rollMode: "def" })).toEqual({ rollMode: "def" });
	});

	it("no debility active — passes rollMode adv through unchanged", () => {
		const char = new TestCharacterBuilder(makeDebilityActor()).build();
		expect(char.applyDebilityRollMode("str", { rollMode: "adv" })).toEqual({ rollMode: "adv" });
	});

	it("debility active, stat affected, rollMode def → dis", () => {
		const char = new TestCharacterBuilder(makeDebilityActor({weakened: true})).build();
		expect(char.applyDebilityRollMode("str", { rollMode: "def" })).toMatchObject({ rollMode: "dis" });
	});

	it("debility active, stat affected, rollMode adv → def (cancel)", () => {
		const char = new TestCharacterBuilder(makeDebilityActor({weakened: true})).build();
		expect(char.applyDebilityRollMode("str", { rollMode: "adv" })).toMatchObject({ rollMode: "normal" });
	});

	it("debility active, stat affected, rollMode dis → dis (unchanged)", () => {
		const char = new TestCharacterBuilder(makeDebilityActor({weakened: true})).build();
		expect(char.applyDebilityRollMode("str", { rollMode: "dis" })).toMatchObject({ rollMode: "dis" });
	});

	it("debility active but for a different stat — passes through unchanged", () => {
		const char = new TestCharacterBuilder(makeDebilityActor({weakened: true})).build();
		expect(char.applyDebilityRollMode("int", { rollMode: "def" })).toEqual({ rollMode: "def" });
	});

	it("debility value false (unchecked) — passes through unchanged", () => {
		const char = new TestCharacterBuilder(makeDebilityActor({weakened: false})).build();
		expect(char.applyDebilityRollMode("str", { rollMode: "def" })).toEqual({ rollMode: "def" });
	});

	it("two debilities active, one covers stat, rollMode adv → def", () => {
		const char = new TestCharacterBuilder(makeDebilityActor({weakened: true, dazed: true})).build();
		expect(char.applyDebilityRollMode("str", { rollMode: "adv" })).toMatchObject({ rollMode: "normal" });
	});

	it("dazed covers int and wis, rollMode def → dis for int", () => {
		const char = new TestCharacterBuilder(makeDebilityActor({dazed: true})).build();
		expect(char.applyDebilityRollMode("int", { rollMode: "def" })).toMatchObject({ rollMode: "dis" });
		expect(char.applyDebilityRollMode("wis", { rollMode: "def" })).toMatchObject({ rollMode: "dis" });
	});

	it("uses built-in debility stat mapping when migrated actor data has no stat array", () => {
		const actor = makeDebilityActor({weakened: true});
		delete actor.system.attributes.debilities.options.weakened.stat;
		const char = new TestCharacterBuilder(actor).build();
		expect(char.applyDebilityRollMode("str", { rollMode: "def" })).toMatchObject({ rollMode: "dis" });
		expect(char.applyDebilityRollMode("int", { rollMode: "def" })).toEqual({ rollMode: "def" });
	});

	it("preserves other options fields while changing rollMode", () => {
		const char = new TestCharacterBuilder(makeDebilityActor({weakened: true})).build();
		const result = char.applyDebilityRollMode("str", { rollMode: "adv", extra: "value" });
		expect(result).toMatchObject({ rollMode: "normal", extra: "value" });
	});
});

// -- getMoves (otherMoves) ----------------------------------------------------

describe("StonetopCharacter.getMoves otherMoves", () => {
	it("returns otherMoves: [] when no moves have moveType 'other'", async () => {
		const char = new TestCharacterBuilder(new FakeActorBuilder().build()).build();
		const result = await char.getMoves();
		expect(result.otherMoves).toEqual([]);
	});

	it("returns otherMoves populated with items that have moveType 'other'", async () => {
		const move = { _id: "m1", type: "move", name: "Custom Move", system: { moveType: "other", rollType: "str", description: "<p>Do a thing.</p>" } };
		const char = new TestCharacterBuilder(new FakeActorBuilder().withItems([move]).build()).build();
		const result = await char.getMoves();
		expect(result.otherMoves).toEqual([{ name: "Custom Move", ownedId: "m1", rollType: "str", rollLabel: "STR", description: "<p>Do a thing.</p>", custom: false }]);
	});

	it("normalizes object rollType values for homefront moves", async () => {
		const move = {
			_id: "m-homefront",
			type: "move",
			name: "Muster",
			system: { moveType: "homefront", rollType: { value: "ask", label: "Ask" } },
		};
		const char = new TestCharacterBuilder(new FakeActorBuilder().withItems([move]).build()).build();
		const result = await char.getMoves();
		const homefront = result.otherGroups.find(group => group.key === "homefront");

		expect(homefront.moves).toEqual([{ name: "Muster", ownedId: "m-homefront", rollType: "ask", rollLabel: "Population" }]);
	});

	it("labels homefront roll chips with the steading stat from the move", async () => {
		const moves = [
			{ _id: "seasons", type: "move", name: "Seasons Change", system: { moveType: "homefront", rollType: "ask" } },
			{ _id: "trade", type: "move", name: "Trade & Barter", system: { moveType: "homefront", rollType: "ask" } },
			{ _id: "deploy", type: "move", name: "Deploy", system: { moveType: "homefront", rollType: "ask" } },
		];
		const char = new TestCharacterBuilder(new FakeActorBuilder().withItems(moves).build()).build();
		const result = await char.getMoves();
		const labels = Object.fromEntries(result.otherGroups
			.find(group => group.key === "homefront")
			.moves
			.map(move => [move.name, move.rollLabel]));

		expect(labels).toMatchObject({
			"Seasons Change": "Fortunes",
			"Trade & Barter": "Prosperity",
			"Deploy": "Defenses",
		});
	});

	it("does not include items with other moveTypes in otherMoves", async () => {
		const move = { _id: "m2", type: "move", name: "Special Move", system: { moveType: "special", rollType: null } };
		const char = new TestCharacterBuilder(new FakeActorBuilder().withItems([move]).build()).build();
		const result = await char.getMoves();
		expect(result.otherMoves).toEqual([]);
	});

	it("includes cross-playbook moves (name not in current playbook) in otherMoves", async () => {
		const move = { _id: "m4", type: "move", name: "Fox Move", system: { moveType: "playbook", rollType: null, description: null } };
		const actor = new FakeActorBuilder()
			.withPlaybook("the-blessed", "The Blessed")
			.withItems([move])
			.build();
		const char = new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(BLESSED_PLAYBOOK))
			.withMoveRepo(new FakeMoveRepository([], []))
			.build();
		const result = await char.getMoves();
		expect(result.otherMoves).toEqual([{ name: "Fox Move", ownedId: "m4", rollType: null, rollLabel: null, description: null, custom: false }]);
	});

	it("does not include same-playbook moves in otherMoves", async () => {
		const move = { _id: "m5", type: "move", name: "Blessed Move", system: { moveType: "playbook", rollType: null } };
		const playbookEntry = { _id: "pm1", name: "Blessed Move", system: { moveType: "playbook", isStartingMove: false } };
		const actor = new FakeActorBuilder()
			.withPlaybook("the-blessed", "The Blessed")
			.withItems([move])
			.build();
		const char = new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(BLESSED_PLAYBOOK))
			.withMoveRepo(new FakeMoveRepository([playbookEntry], []))
			.build();
		const result = await char.getMoves();
		expect(result.otherMoves).toEqual([]);
	});

	it("includes description: null when item has no description", async () => {
		const move = { _id: "m3", type: "move", name: "Bare Move", system: { moveType: "other", rollType: null } };
		const char = new TestCharacterBuilder(new FakeActorBuilder().withItems([move]).build()).build();
		const result = await char.getMoves();
		expect(result.otherMoves[0].description).toBeNull();
	});

	it("marks player-authored moves (flags.stonetop-pwd.custom) with custom: true", async () => {
		const move = { _id: "m6", type: "move", name: "Homebrew", system: { moveType: "other", rollType: null }, flags: { "stonetop-pwd": { custom: true } } };
		const char = new TestCharacterBuilder(new FakeActorBuilder().withItems([move]).build()).build();
		const result = await char.getMoves();
		expect(result.otherMoves[0].custom).toBe(true);
	});
});

// -- getMoves resourceChecks --------------------------------------------------

describe("StonetopCharacter.getMoves resourceChecks", () => {
	function makeBlessedActor() {
		return new FakeActorBuilder().withPlaybook("the-blessed", "The Blessed").build();
	}

	it("builds resourceChecks with label: null when move has resource with empty labels", async () => {
		const entry = { _id: "rc1", name: "Favor Move", system: { moveType: "playbook", isStartingMove: false, resource: { max: 3, title: null, labels: [] } } };
		const char = new TestCharacterBuilder(makeBlessedActor())
			.withPlaybookRepo(new FakePlaybookRepository(BLESSED_PLAYBOOK))
			.withMoveRepo(new FakeMoveRepository([entry], []))
			.build();
		const result = await char.getMoves();
		const move = result.playbookMoves.find(m => m.name === "Favor Move");
		expect(move.resourceChecks).toEqual([
			{ checked: false, label: null },
			{ checked: false, label: null },
			{ checked: false, label: null },
		]);
	});

	it("builds resourceChecks with labels when move has resource.labels", async () => {
		const entry = { _id: "rc2", name: "Blade Move", system: { moveType: "playbook", isStartingMove: false, resource: { max: 2, title: null, labels: ["a few left", "out"] } } };
		const char = new TestCharacterBuilder(makeBlessedActor())
			.withPlaybookRepo(new FakePlaybookRepository(BLESSED_PLAYBOOK))
			.withMoveRepo(new FakeMoveRepository([entry], []))
			.build();
		const result = await char.getMoves();
		const move = result.playbookMoves.find(m => m.name === "Blade Move");
		expect(move.resourceChecks).toEqual([
			{ checked: false, label: "a few left" },
			{ checked: false, label: "out" },
		]);
	});

	it("resource.max determines resourceChecks length", async () => {
		const entry = { _id: "rc3", name: "State Move", system: { moveType: "playbook", isStartingMove: false, resource: { max: 3, title: null, labels: ["fresh", "spent", "gone"] } } };
		const char = new TestCharacterBuilder(makeBlessedActor())
			.withPlaybookRepo(new FakePlaybookRepository(BLESSED_PLAYBOOK))
			.withMoveRepo(new FakeMoveRepository([entry], []))
			.build();
		const result = await char.getMoves();
		const move = result.playbookMoves.find(m => m.name === "State Move");
		expect(move.resourceChecks).toHaveLength(3);
	});
});

// -- onRoll -------------------------------------------------------------------

function makeRollableItem({ id = "item-1", rollType = "str", type = "move", rollFormula = null } = {}) {
	return {
		_id: id,
		type,
		system: { rollType, rollFormula },
		roll: vi.fn(),
	};
}

function makeItemEvent({ itemId = "item-1", showDescription = false, hasItemEl = true } = {}) {
	return {
		currentTarget: {
			closest: (sel) => sel === ".item" && hasItemEl ? { dataset: { itemId } } : null,
			getAttribute: (attr) => attr === "data-show" && showDescription ? "description" : null,
			classList: { contains: () => false },
			dataset: {},
		},
	};
}

function makeOnRollActor(item, { pbtaRollMode = "def", debilities = {} } = {}) {
	const actor = new FakeActorBuilder()
		.withDebility("weakened",  debilities.weakened  ?? false)
		.withDebility("dazed",     debilities.dazed     ?? false)
		.withDebility("miserable", debilities.miserable ?? false)
		.withRollMode(pbtaRollMode)
		.build();
	const itemsArr = item ? [item] : [];
	itemsArr.get = (id) => itemsArr.find(i => i._id === id) ?? null;
	actor.items = itemsArr;
	return actor;
}

// -- setMoveLearned -----------------------------------------------------------

// The learned toggle used to refuse anything that wasn't player-authored, which left a
// foreign move dropped onto the sheet permanently active with no way to park it. It writes
// the same flag _isMoveLearned reads off ANY item, so there was never a reason to bail.
describe("StonetopCharacter.setMoveLearned", () => {
	const moveActor = (item) => {
		const actor = new FakeActorBuilder().withItems([item]).build();
		actor.items.get = id => actor.items.find(i => i._id === id) ?? null;
		return actor;
	};

	it("un-learns a NON-custom move (a foreign playbook move dropped on the sheet)", async () => {
		const item = { _id: "m1", type: "move", name: "Ambush", system: { moveType: "other", playbook: "The Fox" }, setFlag: vi.fn() };
		await new TestCharacterBuilder(moveActor(item)).build().setMoveLearned("m1", false);
		expect(item.setFlag).toHaveBeenCalledWith("stonetop-pwd", "learned", false);
	});

	it("re-learns a custom move", async () => {
		const item = { _id: "c1", type: "move", name: "Homebrew", system: { moveType: "other" }, flags: { "stonetop-pwd": { custom: true } }, setFlag: vi.fn() };
		await new TestCharacterBuilder(moveActor(item)).build().setMoveLearned("c1", true);
		expect(item.setFlag).toHaveBeenCalledWith("stonetop-pwd", "learned", true);
	});

	it("does nothing for an id that isn't on the actor", async () => {
		const item = { _id: "m1", type: "move", name: "Ambush", system: {}, setFlag: vi.fn() };
		await new TestCharacterBuilder(moveActor(item)).build().setMoveLearned("gone", false);
		expect(item.setFlag).not.toHaveBeenCalled();
	});
});

// -- onDropMove ---------------------------------------------------------------

function makeDropMoveActor({ items = [], playbook = null } = {}) {
	return new FakeActorBuilder()
		.withPlaybook(null, playbook)
		.withItems(items)
		.build();
}

describe("StonetopCharacter.onDropMove", () => {
	it("returns false and skips creation when a move with the same name is already owned", async () => {
		const existing = { type: "move", name: "Barkskin" };
		const actor = makeDropMoveActor({ items: [existing] });
		const char = new TestCharacterBuilder(actor).build();
		const result = await char.onDropMove({ name: "Barkskin", type: "move", system: { moveType: "playbook", playbook: "The Blessed" } });
		expect(result).toBe(false);
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("returns true and creates same-playbook move as-is", async () => {
		const actor = makeDropMoveActor({ playbook: "The Blessed" });
		const char = new TestCharacterBuilder(actor).build();
		const itemData = { name: "Barkskin", type: "move", system: { moveType: "playbook", playbook: "The Blessed" } };
		const result = await char.onDropMove(itemData);
		expect(result).toBe(true);
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
			expect.objectContaining({ system: expect.objectContaining({ moveType: "playbook" }) }),
		]);
	});

	it("returns true and changes moveType to 'other' for cross-playbook moves", async () => {
		const actor = makeDropMoveActor({ playbook: "The Fox" });
		const char = new TestCharacterBuilder(actor).build();
		const itemData = { name: "Barkskin", type: "move", system: { moveType: "playbook", playbook: "The Blessed" } };
		const result = await char.onDropMove(itemData);
		expect(result).toBe(true);
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
			expect.objectContaining({ system: expect.objectContaining({ moveType: "other" }) }),
		]);
	});

	it("returns true and creates other-moveType moves without changing moveType", async () => {
		const actor = makeDropMoveActor({ playbook: "The Fox" });
		const char = new TestCharacterBuilder(actor).build();
		const itemData = { name: "Some Follower Move", type: "move", system: { moveType: "follower", playbook: null } };
		const result = await char.onDropMove(itemData);
		expect(result).toBe(true);
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
			expect.objectContaining({ system: expect.objectContaining({ moveType: "follower" }) }),
		]);
	});
});

describe("StonetopCharacter.onRoll", () => {
	it("returns false when event has no item element", async () => {
		const char = new TestCharacterBuilder(makeOnRollActor(null)).build();
		expect(await char.onRoll(makeItemEvent({ hasItemEl: false }))).toBe(false);
	});

	it("returns false when item has no rollType", async () => {
		const item = makeRollableItem({ rollType: null });
		const char = new TestCharacterBuilder(makeOnRollActor(item)).build();
		expect(await char.onRoll(makeItemEvent())).toBe(false);
		expect(item.roll).not.toHaveBeenCalled();
	});

	it("returns true and calls item.roll when item has a rollType", async () => {
		const item = makeRollableItem({ rollType: "str" });
		const char = new TestCharacterBuilder(makeOnRollActor(item)).build();
		expect(await char.onRoll(makeItemEvent())).toBe(true);
		expect(item.roll).toHaveBeenCalledOnce();
	});

	// The mode comes from the pre-roll prompt the sheet opened (module/dialogs/RollDialog.js),
	// which is the only place it is chosen now — passed in per roll rather than read off a flag
	// a sidebar control wrote once and nobody remembered to clear.
	it("passes the rollMode it was handed", async () => {
		const item = makeRollableItem({ rollType: "str" });
		const char = new TestCharacterBuilder(makeOnRollActor(item)).build();
		expect(await char.onRoll(makeItemEvent(), { rollMode: "adv" })).toBe(true);
		expect(item.roll).toHaveBeenCalledWith(expect.objectContaining({ rollMode: "adv" }));
	});

	// A caller with nothing to say about the mode gets a normal roll, and so does one that
	// hands over junk — the value arrives from a dialog's DOM, not from a validated flag.
	it("falls back to a normal roll, and normalizes anything unrecognized", async () => {
		const item = makeRollableItem({ rollType: "str" });
		const char = new TestCharacterBuilder(makeOnRollActor(item, {pbtaRollMode: "adv"})).build();
		expect(await char.onRoll(makeItemEvent())).toBe(true);
		expect(item.roll).toHaveBeenCalledWith(expect.objectContaining({ rollMode: "normal" }));

		const other = makeRollableItem({ rollType: "str" });
		const char2 = new TestCharacterBuilder(makeOnRollActor(other)).build();
		await char2.onRoll(makeItemEvent(), { rollMode: "def" });
		expect(other.roll).toHaveBeenCalledWith(expect.objectContaining({ rollMode: "normal" }));
	});

	it("sets descriptionOnly when data-show=description", async () => {
		const item = makeRollableItem({ rollType: "str" });
		const char = new TestCharacterBuilder(makeOnRollActor(item)).build();
		expect(await char.onRoll(makeItemEvent({ showDescription: true }))).toBe(true);
		expect(item.roll).toHaveBeenCalledWith(expect.objectContaining({ descriptionOnly: true }));
	});

	it("sets descriptionOnly for npcMove with no rollFormula", async () => {
		const item = makeRollableItem({ rollType: "str", type: "npcMove", rollFormula: null });
		const char = new TestCharacterBuilder(makeOnRollActor(item)).build();
		expect(await char.onRoll(makeItemEvent())).toBe(true);
		expect(item.roll).toHaveBeenCalledWith(expect.objectContaining({ descriptionOnly: true }));
	});

	it("applies disadvantage when relevant debility is active", async () => {
		const item = makeRollableItem({ rollType: "str" });
		const char = new TestCharacterBuilder(makeOnRollActor(item, {debilities: {weakened: true}})).build();
		expect(await char.onRoll(makeItemEvent())).toBe(true);
		expect(item.roll).toHaveBeenCalledWith(expect.objectContaining({ rollMode: "dis" }));
	});

	it("does not apply disadvantage when debility covers a different stat", async () => {
		const item = makeRollableItem({ rollType: "wis" });
		const char = new TestCharacterBuilder(makeOnRollActor(item, {debilities: {weakened: true}})).build();
		expect(await char.onRoll(makeItemEvent())).toBe(true);
		expect(item.roll).toHaveBeenCalledWith(expect.objectContaining({ rollMode: "normal" }));
	});

	it("defaults to normal rollMode when no actor rollMode is saved", async () => {
		const item = makeRollableItem({ rollType: "str" });
		const char = new TestCharacterBuilder(makeOnRollActor(item, {pbtaRollMode: null})).build();
		expect(await char.onRoll(makeItemEvent())).toBe(true);
		expect(item.roll).toHaveBeenCalledWith({
			descriptionOnly: false,
			forward: 0,
			modifier: 0,
			ongoing: 0,
			rollMode: "normal",
			statOverride: "str",
		});
	});

	// There is no sticky mode to save any more, and nothing may quietly start writing one back:
	// a flag that outlives a roll is the whole bug this replaced.
	it("has no sticky roll mode to read or write", async () => {
		const actor = makeOnRollActor(makeRollableItem());
		const char = new TestCharacterBuilder(actor).build();
		expect(char.setRollMode).toBeUndefined();
		expect(char.rollMode).toBeUndefined();
		await char.onRoll(makeItemEvent(), { rollMode: "dis" });
		expect(actor.setFlag).not.toHaveBeenCalledWith("stonetop-pwd", "rollMode", expect.anything());
	});
});
