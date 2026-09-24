import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stubConfirm } from "../../fakes/confirm.js";
import { createStonetopMonsterSheetClass } from "../../../module/actors/monster/StonetopMonsterSheet.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// The People of Stonetop gallery is a real Application subclass, and this suite runs against a
// stub `Application` with no render(). Standing in for it is also what lets the portrait-click
// tests below assert WHICH of the two routes a click took, rather than only that no picture
// window opened. vi.hoisted because the mock factory runs while actor-portrait-picker.js is imported,
// which is before this file's own module body executes.
const gallery = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("../../../module/actors/steading/PeopleGalleryDialog.js", () => ({
	openPeoplePortraitPicker: gallery.open,
}));

// The damage window and the card behind it, stood in for so a click on a damage line can be read off
// the arguments it asked and rolled with. They are two modules: the window is asked by
// combat/attack-flow.js (so a ticked line is paid for) and the card posted by utils/roll-engine.js.
// Everything else in both is the real one.
const rollDialog = vi.hoisted(() => ({ promptDamage: vi.fn(async () => ({ rollMode: "normal", bonus: 0, extraDice: "" })) }));
vi.mock("../../../module/dialogs/RollDialog.js", async importOriginal => ({
	...(await importOriginal()),
	promptDamage: rollDialog.promptDamage,
}));

const rollEngine = vi.hoisted(() => ({ rollDamage: vi.fn(async () => ({ total: 0 })) }));
vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({
	...(await importOriginal()),
	rollDamage: rollEngine.rollDamage,
}));

function makeItems(items) {
	return {
		filter: callback => items.filter(callback),
		get: id => items.find(item => item.id === id),
	};
}

function makeSheet(actor, { editable = true } = {}) {
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return editable; }
		async getData() { return {}; }
		activateListeners() {}
	};
	const Sheet = createStonetopMonsterSheetClass(Base);
	return new Sheet();
}

// The sheet mounts its tab rail in activateListeners, and mountTabRail only lifts a rail off a
// REAL element, checking with instanceof HTMLElement: a global this node test environment does
// not define. The roots handed to activateListeners below are plain doubles, so an empty stand-in
// class makes that check answer "not an element" and the rail step do nothing, which is exactly
// what it does for a sheet with no DOM. Restored afterwards so no other suite inherits it.
let _savedHTMLElement;
beforeEach(() => {
	_savedHTMLElement = globalThis.HTMLElement;
	globalThis.HTMLElement ??= class {};
});
afterEach(() => {
	if (_savedHTMLElement === undefined) delete globalThis.HTMLElement;
	else globalThis.HTMLElement = _savedHTMLElement;
});

describe("StonetopMonsterSheet", () => {
	// deletionEntry only reaches for a ForcedDeletion INSTANCE on v14+ (below that it uses
	// the "-=leaf" key form), so stub the running generation to the target version — the
	// armor-boost delete tests assert the v14 ForcedDeletion form.
	let _savedGame;
	beforeEach(() => { _savedGame = globalThis.game; globalThis.game = { ...(globalThis.game ?? {}), release: { generation: 14 } }; });
	afterEach(() => { globalThis.game = _savedGame; });

	it("returns only monster moves in sheet data", async () => {
		const actor = {
			system: { concept: "tree-dwelling menace" },
			items: makeItems([
				{ id: "move1", type: "monsterMove", name: "Snatch", system: { rollFormula: "1d6" } },
				{ id: "npc1", type: "npcMove", name: "Ignore me", system: {} },
			]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.system).toBe(actor.system);
		expect(data.monsterMoves).toEqual([
			{
				id: "move1", name: "Snatch", system: { rollFormula: "1d6" },
				armorBoost: null, boostActive: false, showBoostIcon: false, boostTooltip: null,
			},
		]);
	});

	it("preserves the book's move order (does not sort)", async () => {
		const actor = {
			system: {},
			items: makeItems([
				{ id: "c", type: "monsterMove", name: "Claw", system: {} },
				{ id: "z", type: "monsterMove", name: "Zap", system: { rollFormula: "1d8" } },
				{ id: "a", type: "monsterMove", name: "Ambush", system: {} },
				{ id: "b", type: "monsterMove", name: "Bite", system: { rollFormula: "1d6" } },
			]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.monsterMoves.map(move => move.name)).toEqual([
			"Claw",
			"Zap",
			"Ambush",
			"Bite",
		]);
	});

	it("filters organization and size out of readonly display tags", async () => {
		const actor = {
			system: {
				organization: "Horde",
				size: "small",
				tags: "horde, small, cautious, stealthy",
			},
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.displayTags).toBe("cautious, stealthy");
	});

	it("derives the organization label for the header chip", async () => {
		const actor = {
			system: { organization: "horde" },
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.organizationLabel).toBe("stonetop.monster.organizationHorde");
	});

	it("wraps recognised display tags with tooltips and resolves org/size tips", async () => {
		const actor = {
			system: { organization: "horde", size: "small", tags: "horde, small, cautious, grumpy" },
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();
		const st = data.stonetop;

		// Known tag gets a tooltip span; the one-off flavor tag stays plain text.
		expect(st.displayTagsHtml).toContain('<span class="stonetop-monster-tag" data-tooltip=');
		expect(st.displayTagsHtml).toMatch(/>cautious<\/span>/);
		expect(st.displayTagsHtml).not.toMatch(/<span[^>]*>grumpy/);
		expect(st.displayTagsHtml).toContain("grumpy");
		// Organization and size resolve their own tooltips.
		expect(st.organizationTooltip).toMatch(/large groups of 6/);
		expect(st.sizeTooltip).toMatch(/human child/);
	});

	// Fighting in numbers: both readouts are answered in getData, not left to the first
	// keystroke. Rendering the inputs pre-filled beside an empty result and an unmodified
	// damage line showed a state the sheet did not mean — the counts said +5 and the roll
	// button said d6, and only touching a field reconciled them.
	describe("fighting-in-numbers tools", () => {
		const horde = (system = {}) => ({
			system: {
				organization: "horde", count: 6,
				attributes: { hp: { value: 3, max: 3 }, damage: { rollFormula: "d6" } },
				...system,
			},
			items: makeItems([]),
		});

		// The same horde, being run as ONE combatant (Book I p.416, "Abstracting groups").
		const asGroup = (system = {}) => horde({ fightAsGroup: true, ...system });
		const hurt    = (value, system = {}) => ({ attributes: { hp: { value, max: 3 }, damage: { rollFormula: "d6" } }, ...system });

		it("answers BOTH rules on the first paint, each with its own die", async () => {
			const st = (await makeSheet(asGroup()).getData()).stonetop;

			expect(st.isGroupOrg).toBe(true);
			expect(st.fightAsGroup).toBe(true);
			// Swarming one foe pays damage only: 6 attackers, +1 per attacker past the first. Each
			// readout is drawn one span per clause, so a narrow row breaks between them and never inside one.
			expect(st.swarmCount).toBe(6);
			expect(st.swarmClauses).toEqual(["+5 damage"]);
			expect(st.swarmFormula).toBe("d6+5");
			// The abstraction pays damage AND armor, off the ratio rather than the headcount.
			expect(st.exchangeClauses).toEqual(["+5 damage,", "+5 armor"]);
			expect(st.exchangeFormula).toBe("d6+5");
		});

		// Off, the sheet is one creature. Both rules count a group's bodies, so neither row is offered.
		it("offers neither row while the sheet is one creature", async () => {
			const st = (await makeSheet(horde()).getData()).stonetop;
			expect(st.fightAsGroup).toBe(false);
			expect(st.swarmCount).toBeUndefined();
			expect(st.swarmFormula).toBeUndefined();
			expect(st.exchangeClauses).toBeUndefined();
			expect(st.exchangeFormula).toBeUndefined();
		});

		// A lone member of a group is in the book (a lone suarachan), so an unrecorded group size is
		// not read as a horde's typical six and a +5 nobody asked for.
		it("opens both rows at one when no group size is recorded", async () => {
			const st = (await makeSheet(asGroup({ count: 0 })).getData()).stonetop;
			expect(st.swarmCount).toBe(1);
			expect(st.swarmClauses).toEqual(["no bonus"]);
			expect(st.exchangeClauses).toEqual(["no bonus"]);
			expect(st.casualtyNote).toBeNull();   // with no count, no bodies to divide
		});

		// Unhurt, Group size is the bare headcount: "all 6 still standing" is just "6", longer.
		it("adds no casualty line while nobody is down", async () => {
			const st = (await makeSheet(asGroup()).getData()).stonetop;
			expect(st.count).toBe(6);
			expect(st.casualtyNote).toBeNull();
		});

		it("reads the group's remaining HP back as casualties", async () => {
			expect((await makeSheet(asGroup(hurt(2))).getData()).stonetop.casualtyNote)
				.toBe("4 of 6 still standing");
			expect((await makeSheet(asGroup(hurt(0))).getData()).stonetop.casualtyNote)
				.toBe("routed, massacred, or otherwise defeated");
		});

		// One crinwin's token at 1 of 3 HP is one hurt crinwin. Read as the group's pool, it said
		// "2 of 6 still standing" about five others who were never in its fight.
		it("reads no casualties off one creature's wounds", async () => {
			const st = (await makeSheet(horde(hurt(1))).getData()).stonetop;
			expect(st.casualtyNote).toBeNull();
			expect(st.swarmCount).toBeUndefined();
		});

		// "Adjust the bonuses to damage and armor accordingly!" A member out of the action is neither
		// an attacker nor one of the side's numbers, so both rows open at those still standing.
		it("opens both rows at the members still standing", async () => {
			const st = (await makeSheet(asGroup(hurt(2))).getData()).stonetop;
			expect(st.swarmCount).toBe(4);
			expect(st.swarmFormula).toBe("d6+3");
			expect(st.exchangeClauses).toEqual(["+3 damage,", "+3 armor"]);

			// Routed leaves nobody standing; the rows floor at their inputs' minimum of one.
			const routed = (await makeSheet(asGroup(hurt(0))).getData()).stonetop;
			expect(routed.swarmCount).toBe(1);
			expect(routed.exchangeClauses).toEqual(["no bonus"]);
		});

		it("offers nothing for a solitary creature", async () => {
			const alone = { system: { organization: "solitary", count: 1, fightAsGroup: true }, items: makeItems([]) };
			const st = (await makeSheet(alone).getData()).stonetop;
			expect(st.isGroupOrg).toBe(false);
			expect(st.fightAsGroup).toBe(false);
			expect(st.groupColumn).toBe(false);
		});

		// With the Fight tab off (a test registers no settings, so it reads as off), nothing else picks a
		// group's scale or pays its numbers, and the sheet's own switch and rows are the table's tools.
		it("keeps the switch's column and both rows while the Fight tab is off", async () => {
			const st = (await makeSheet(asGroup()).getData()).stonetop;
			expect(st.fightTab).toBe(false);
			expect(st.numbersRows).toBe(true);
			expect(st.groupColumn).toBe(true);
			expect((await makeSheet(horde()).getData()).stonetop.groupColumn).toBe(true);
		});

		// With it on, the fight picks a token's scale (the "how many?" window, Merge, Split) and adds both
		// rules' bonuses to the Damage roll (fight/damage-seed.js), so the sheet keeps only what the tab
		// reads: Group size, and a group token's casualties.
		describe("with the Fight tab on", () => {
			let savedGame;
			beforeEach(() => {
				savedGame = globalThis.game;
				const prior = savedGame?.settings;
				globalThis.game = { ...savedGame, settings: { get: (scope, key) => (key === "fightTab" ? true : prior?.get?.(scope, key)) } };
			});
			afterEach(() => { globalThis.game = savedGame; });

			it("draws neither row on a group token, and keeps its Group size and casualties", async () => {
				const st = (await makeSheet(asGroup(hurt(2))).getData()).stonetop;
				expect(st.fightTab).toBe(true);
				expect(st.fightAsGroup).toBe(true);
				expect(st.numbersRows).toBe(false);
				expect(st.swarmCount).toBeUndefined();
				expect(st.swarmFormula).toBeUndefined();
				expect(st.exchangeClauses).toBeUndefined();
				expect(st.groupColumn).toBe(true);
				expect(st.casualtyNote).toBe("4 of 6 still standing");
			});

			// Nothing is left in the column for one creature in play, so it is not drawn and Type, Damage and
			// Instinct take the whole width. Edit mode keeps it, for Group size.
			it("draws no column in play for one creature, and Group size in edit mode", async () => {
				expect((await makeSheet(horde()).getData()).stonetop.groupColumn).toBe(false);
				const editing = makeSheet(horde());
				editing._editMode = true;
				expect((await editing.getData()).stonetop.groupColumn).toBe(true);
			});
		});

		// The switch is a real field, and both rows and the HP box's title follow it.
		it("draws the switch, and hangs both rows and the Group HP title off it", async () => {
			const { readFileSync } = await import("node:fs");
			const hbs = readFileSync(new URL("../../../templates/actor/monster.hbs", import.meta.url), "utf8");
			expect(hbs).toContain('<input class="stonetop-monster-group-toggle-check" type="checkbox" name="system.fightAsGroup" {{checked system.fightAsGroup}}');

			// The column, and the switch with its label sizer, only where getData says: the switch is the
			// Fight tab's to work while it is on, so it sits in an {{#unless}} that closes after the sizer.
			const column = hbs.indexOf('<div class="stonetop-monster-group-fight-section">');
			expect(hbs.lastIndexOf("{{#if stonetop.groupColumn}}", column)).toBeGreaterThan(-1);
			const switchIf = hbs.indexOf("{{#unless stonetop.fightTab}}", column);
			const sizerAt  = hbs.indexOf('<span class="stonetop-monster-group-label-sizer"', column);
			expect(switchIf).toBeGreaterThan(column);
			expect(switchIf).toBeLessThan(hbs.indexOf('<label class="stonetop-monster-group-toggle"'));
			expect(hbs.slice(switchIf, sizerAt)).not.toMatch(/\{\{\/unless\}\}/);
			expect(hbs.indexOf("{{/unless}}", sizerAt)).toBeLessThan(hbs.indexOf(">Group size<"));

			// In play, Group size is a group's number, so one creature's sheet does not draw it.
			// Edit mode always does: it is where the count the group mode reads gets set.
			const toggleAt = hbs.indexOf('<label class="stonetop-monster-group-toggle"');
			const countAt  = hbs.indexOf(">Group size<");
			expect(hbs.slice(toggleAt, countAt)).toContain("{{#if (or stonetop.editMode stonetop.fightAsGroup)}}");

			// And in play it is a box that saves, not a readout: how many are in the group is settled
			// at the table and changes mid-fight (p.416). The casualty line sits beside it.
			const line = hbs.slice(countAt, hbs.indexOf("</div>", countAt));
			const play = line.slice(line.indexOf("{{else}}"));
			expect(play).toMatch(/<input class="stonetop-monster-group-count" type="number" name="system\.count"/);
			expect(play).toContain("{{stonetop.casualtyNote}}");

			// Both rows under ONE condition: it opens after Group size and before the swarm row, and nothing
			// between it and the exchange row closes it. A sheet with Group fight off, or with the Fight tab
			// on, draws neither (numbersRows, from getData).
			const swarmAt    = hbs.indexOf('data-rule="swarm"');
			const exchangeAt = hbs.indexOf('data-rule="exchange"');
			const rowsIf     = hbs.lastIndexOf("{{#if stonetop.numbersRows}}", swarmAt);
			expect(rowsIf).toBeGreaterThan(countAt);
			expect(hbs.slice(rowsIf, exchangeAt)).not.toContain("{{/if}}");
			expect(hbs.slice(rowsIf + 1, exchangeAt)).not.toContain("{{#if stonetop.numbersRows}}");

			const title = hbs.slice(hbs.indexOf('<div class="cell cell--Resource cell--attr-hp">'), hbs.indexOf('name="system.attributes.hp.value"'));
			expect(title).toContain("{{#if stonetop.fightAsGroup}}");
			expect(title).toContain('{{localize "stonetop.monster.groupHitPoints"}}');
		});

		// The stat block's HP, armor and damage are ALREADY "as per a single individual
		// member" — the abstraction's own wording — so nothing here may scale them by the
		// headcount. A horde of six is still a 3 HP, d6 combatant.
		it("never multiplies the stat block by the headcount", async () => {
			const actor = horde();
			const st = (await makeSheet(actor).getData()).stonetop;
			expect(st.baseDamageFormula).toBe("d6");
			expect(actor.system.attributes.hp.max).toBe(3);
		});
	});

	it("renders plain escaped tags and no tooltips when hover info is off", async () => {
		const originalGame = globalThis.game;
		globalThis.game = { ...originalGame, settings: { get: () => false } };
		try {
			const actor = {
				system: { organization: "horde", size: "small", tags: "cautious" },
				items: makeItems([]),
			};

			const data = await makeSheet(actor).getData();

			expect(data.stonetop.displayTagsHtml).toBe("cautious");
			expect(data.stonetop.organizationTooltip).toBeNull();
			expect(data.stonetop.sizeTooltip).toBeNull();
		} finally {
			globalThis.game = originalGame;
		}
	});

	it("keeps a single damage mode whose descriptor has commas as one mode", async () => {
		const actor = {
			system: {
				attributes: { damage: { value: "claws, bite, hug d10+4 (hand, close, messy, 1 piercing)" } },
			},
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.damageModes).toMatchObject([
			{ text: "Claws, bite, hug d10+4 (hand, close, messy, 1 piercing)", formula: "d10+4", rollMode: "" },
		]);
		expect(data.stonetop.multiDamage).toBe(false);
	});

	it("splits multiple damage modes, each carrying its own die", async () => {
		const actor = {
			system: {
				attributes: { damage: { value: "fingers d8 (close), maw d10+2 (hand, messy)" } },
			},
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.damageModes).toMatchObject([
			{ text: "Fingers d8 (close)", formula: "d8", rollMode: "" },
			{ text: "Maw d10+2 (hand, messy)", formula: "d10+2", rollMode: "" },
		]);
		expect(data.stonetop.multiDamage).toBe(true);
	});

	it("gives the far side of an 'or' its own mode, and its own die to roll", async () => {
		// The Assassin, verbatim. The garrote is a second printed attack — a different die, and it
		// ignores armor — but the sheet's own comma-only split read the whole line as ONE mode, so
		// the dagger got the only roll button and the garrote could not be rolled at all.
		const actor = {
			system: {
				attributes: { damage: { value: "dagger d10 (hand, 1 piercing) or garrote d8 (hand, grabby, ignores armor)" } },
			},
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.damageModes).toMatchObject([
			{ text: "Dagger d10 (hand, 1 piercing)", formula: "d10", rollMode: "" },
			{ text: "Garrote d8 (hand, grabby, ignores armor)", formula: "d8", rollMode: "" },
		]);
		expect(data.stonetop.multiDamage).toBe(true);
	});

	it("keeps an 'or' that only names one blow twice as a single mode", async () => {
		// The Bear of Winter: one attack under two names, and the "or" inside the tag list is not a
		// separator either. Splitting here would invent a die-less mode and halve the real one.
		const actor = {
			system: {
				attributes: { damage: { value: "bite or maul d12+5 (close, hand or reach, forceful, messy)" } },
			},
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		// And it prints the book's own wording — "bite or maul", not a reconstructed "bite, maul".
		expect(data.stonetop.damageModes).toMatchObject([
			{ text: "Bite or maul d12+5 (close, hand or reach, forceful, messy)", formula: "d12+5", rollMode: "" },
		]);
		expect(data.stonetop.multiDamage).toBe(false);
	});

	it("lists a printed attack that rolls nothing, with no roll button of its own", async () => {
		// The Thraulgwyn Raider's net: it is thrown, it grabs, and it deals no damage. A blank
		// formula is what drops the die icon in the template, so the line shows without one.
		const actor = {
			system: {
				attributes: { damage: { value: "hair-rope net (thrown, crude, grabby), bite d6 (hand)" } },
			},
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.damageModes).toMatchObject([
			{ text: "Hair-rope net (thrown, crude, grabby)", formula: "", rollMode: "" },
			{ text: "Bite d6 (hand)", formula: "d6", rollMode: "" },
		]);
	});

	it("carries each mode's own advantage, not the first one's", async () => {
		// Mkhalang, verbatim: both blows roll at disadvantage, and each button has to know it.
		const actor = {
			system: {
				attributes: {
					damage: {
						value: "trample d8+3 w/disadvantage (hand, close) or ice-tusks d8+7 w/disadvantage (reach, forceful, messy, crude, 1 piercing)",
					},
				},
			},
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.damageModes.map(mode => `${mode.formula} ${mode.rollMode}`))
			.toEqual(["d8+3 dis", "d8+7 dis"]);
	});

	it("flags a damage mode that notes disadvantage on its die", async () => {
		const actor = {
			system: {
				attributes: { damage: { value: "icy touch d6 w/disadvantage (hand, ignores armor)" } },
			},
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.damageModes).toMatchObject([
			{ text: "Icy touch d6 w/disadvantage (hand, ignores armor)", formula: "d6", rollMode: "dis" },
		]);
	});

	it("titles a damage line's card with the attack's name, its tags as the body", async () => {
		// The Assassin, verbatim. The card's formula chip already prints the die, so the title is
		// the blow's name alone and its tags go beside the total (utils/damage.js#damageCardText).
		const actor = {
			system: {
				attributes: { damage: { value: "dagger d10 (hand, 1 piercing) or garrote d8 (hand, grabby, ignores armor)" } },
			},
			flags: {},
			items: makeItems([]),
		};
		const sheet = makeSheet(actor);
		const garrote = (await sheet.getData()).stonetop.damageModes[1];
		expect(garrote).toMatchObject({ title: "Garrote", keywords: "hand, grabby, ignores armor" });

		// The roll button carries both, under the names the click reads back.
		const { readFileSync } = await import("node:fs");
		const template = readFileSync(new URL("../../../templates/actor/monster.hbs", import.meta.url), "utf8");
		const button = template.match(/<a class="stonetop-monster-damage-roll"[^>]*>/)?.[0] ?? "";
		expect(button).toContain(`data-roll-label="{{title}}"`);
		expect(button).toContain(`data-roll-keywords="{{keywords}}"`);

		const handlers = [];
		const root = {
			addEventListener: (name, handler) => { if (name === "click") handlers.push(handler); },
			querySelector: () => null,
		};
		sheet.activateListeners([root]);
		const rollButton = {
			dataset: { rollFormula: garrote.formula, rollLabel: garrote.title, rollKeywords: garrote.keywords, rollMode: garrote.rollMode },
		};
		const target = { closest: selector => selector === ".stonetop-monster-damage-roll" ? rollButton : null };
		rollDialog.promptDamage.mockClear();
		rollEngine.rollDamage.mockClear();
		await handlers[0]({ target, shiftKey: false });

		// Nobody to hit (no fight, nothing targeted), so the plain card, through the targeted roll's own
		// fallback (combat/attack-flow.js#rollDamageAt) - which still asks the window, so a ticked line
		// is paid for before anything is rolled.
		expect(rollDialog.promptDamage).toHaveBeenCalledWith(expect.objectContaining({
			formula: "d8", rollMode: "normal", shiftKey: false, offers: [],
		}));
		expect(rollEngine.rollDamage).toHaveBeenCalledWith("d8", actor, expect.objectContaining({
			label: "Garrote", keywords: "hand, grabby, ignores armor", description: "", rollMode: "normal",
		}));
	});

	it("enriches the qualities rich-text field for display", async () => {
		const originalFoundry = globalThis.foundry;
		globalThis.foundry = {
			utils: originalFoundry.utils,   // getData also escapes codex text
			applications: {
				ux: {
					TextEditor: {
						enrichHTML: vi.fn(async value => `<p>${value}</p>`),
					},
				},
			},
		};
		const actor = {
			system: { qualities: "Climbs like a squirrel" },
			items: makeItems([]),
		};

		try {
			const data = await makeSheet(actor).getData();
			expect(data.stonetop.enrichedQualities).toBe("<p>Climbs like a squirrel</p>");
		} finally {
			globalThis.foundry = originalFoundry;
		}
	});

	it("flags hasQualities only when the field holds real content", async () => {
		const withText = await makeSheet({
			system: { qualities: "<p>Climbs like a squirrel</p>" },
			items: makeItems([]),
		}).getData();
		expect(withText.stonetop.hasQualities).toBe(true);

		for (const empty of ["", "<p></p>", "<p><br></p>", "<p>&nbsp;</p>"]) {
			const data = await makeSheet({
				system: { qualities: empty },
				items: makeItems([]),
			}).getData();
			expect(data.stonetop.hasQualities, `qualities=${JSON.stringify(empty)}`).toBe(false);
		}
	});

	it("falls back to the creature-type icon as the portrait when there is no custom art", async () => {
		const actor = {
			img: "icons/svg/mystery-man.svg",   // default placeholder, not real art
			system: { creatureType: "natural-beast" },
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.creatureTypeLabel).toBe("Natural / Beast");
		expect(data.stonetop.hasPortrait).toBe(true);
		expect(data.stonetop.displayImg).toBe(
			"systems/stonetop-pwd/assets/icons/bestiary/natural-beast.svg");
	});

	it("prefers real portrait art over the creature-type icon", async () => {
		const actor = {
			img: "worlds/test/crinwin-art.webp",
			system: { creatureType: "natural-beast" },
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.displayImg).toBe("worlds/test/crinwin-art.webp");
	});

	it("has no portrait when there is neither art nor a creature type", async () => {
		const actor = {
			img: "icons/svg/mystery-man.svg",
			system: {},
			items: makeItems([]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.hasPortrait).toBe(false);
		expect(data.stonetop.displayImg).toBeNull();
	});

	// The header used to have a branch of its own for edit mode, drawing the raw illustration where
	// play mode drew the framed face — so the lock button re-cropped a face somebody had chosen.
	it("keeps a framed face framed in edit mode, so the lock button cannot re-crop it", async () => {
		const actor = {
			img: "worlds/test/crinwin-art.webp",
			flags: { [SYSTEM_ID]: { portraitFrame: { src: "worlds/test/crinwin-art.webp", rect: [0.2, 0, 0.6, 0.4] } } },
			system: { creatureType: "natural-beast" },
			items: makeItems([]),
		};
		const sheet = makeSheet(actor);
		sheet._editMode = true;

		const data = await sheet.getData();

		expect(data.stonetop.portraitFramed).toBe(true);
		expect(data.stonetop.portraitImg).toBe("worlds/test/crinwin-art.webp");
		expect(data.stonetop.portraitImgStyle).not.toBe("");
	});

	// What the two modes still differ in, now that the framed branch is shared.
	it("draws the slot in edit mode even with no art, off the raw stored path", async () => {
		const actor = {
			img: "icons/svg/mystery-man.svg",
			system: {},                          // no creature type either
			items: makeItems([]),
		};
		const sheet = makeSheet(actor);
		sheet._editMode = true;

		const data = await sheet.getData();

		expect(data.stonetop.showPortrait).toBe(true);
		expect(data.stonetop.headerImg).toBe("icons/svg/mystery-man.svg");
	});

	it("hides the slot in play mode when there is neither art nor a creature-type mark", async () => {
		const withMark = await makeSheet({
			img: "icons/svg/mystery-man.svg",
			system: { creatureType: "natural-beast" },
			items: makeItems([]),
		}).getData();
		const without = await makeSheet({
			img: "icons/svg/mystery-man.svg",
			system: {},
			items: makeItems([]),
		}).getData();

		expect(withMark.stonetop.showPortrait).toBe(true);
		expect(withMark.stonetop.headerImg).toBe(
			"systems/stonetop-pwd/assets/icons/bestiary/natural-beast.svg");
		expect(without.stonetop.showPortrait).toBe(false);
	});

	it("creates monsterMove items from the add move control", async () => {
		const actor = {
			system: {},
			items: makeItems([]),
			createEmbeddedDocuments: vi.fn(),
		};
		const sheet = makeSheet(actor);
		sheet._editMode = true;
		let clickHandler;
		const root = {
			addEventListener: (eventName, handler) => {
				if (eventName === "click") clickHandler = handler;
			},
			querySelector: () => null,
		};
		const target = {
			closest: selector => selector === ".stonetop-monster-add-move" ? target : null,
		};

		sheet.activateListeners([root]);
		await clickHandler({ target });

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [{
			name: "New Move",
			type: "monsterMove",
		}]);
	});

	it("does not create monsterMove items when edit mode is off", async () => {
		const actor = {
			system: {},
			items: makeItems([]),
			createEmbeddedDocuments: vi.fn(),
		};
		const sheet = makeSheet(actor);
		let clickHandler;
		const root = {
			addEventListener: (eventName, handler) => {
				if (eventName === "click") clickHandler = handler;
			},
			querySelector: () => null,
		};
		const target = {
			closest: selector => selector === ".stonetop-monster-add-move" ? target : null,
		};

		sheet.activateListeners([root]);
		await clickHandler({ target });

		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	// The portrait click has two destinations: the picture window in play mode, the People of
	// Stonetop gallery in edit mode. A helper stands up the sheet with a portrait element the
	// click handler can bind to, plus a mock ImagePopout, so each test can say which one opened.
	function wirePortrait(actor, { editMode }) {
		gallery.open.mockClear();
		const sheet = makeSheet(actor);
		sheet._editMode = editMode;
		let portraitClick;
		const portrait = {
			addEventListener: (eventName, handler) => {
				if (eventName === "click") portraitClick = handler;
			},
		};
		const root = {
			addEventListener: () => {},
			querySelector: selector => selector === ".stonetop-portrait" ? portrait : null,
		};
		const rendered = [];
		// v13's constructor signature: one options object, path at `src`, title under `window`
		// (see utils/foundry-compat.js#imagePopout).
		globalThis.ImagePopout = class {
			constructor(options) { this.options = options; }
			render(force) { rendered.push({ src: this.options?.src, opts: this.options?.window, force }); }
		};
		sheet.activateListeners([root]);
		return { rendered, click: () => portraitClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }) };
	}

	it("enlarges a real portrait in a popout when clicked in play mode", async () => {
		const actor = { name: "Grulk", img: "worlds/test/grulk.webp", system: {}, items: makeItems([]) };
		try {
			const { rendered, click } = wirePortrait(actor, { editMode: false });
			click();
			expect(rendered).toEqual([{ src: "worlds/test/grulk.webp", opts: { title: "Grulk" }, force: true }]);
			expect(gallery.open).not.toHaveBeenCalled();
		} finally {
			delete globalThis.ImagePopout;
		}
	});

	it("goes straight to the People gallery in edit mode, rather than enlarging the picture", async () => {
		// Edit mode is the mode you are in to change things, so the click that changes this one
		// should not need a stop at a picture window to find "Edit Photo" in its title bar. This
		// used to be Foundry's own file picker, bound to data-edit="img" on the image; the
		// gallery reaches that too, through its "Browse files…" button.
		const actor = { name: "Grulk", img: "worlds/test/grulk.webp", system: {}, items: makeItems([]) };
		try {
			const { rendered, click } = wirePortrait(actor, { editMode: true });
			click();
			expect(rendered).toEqual([]);
			expect(gallery.open).toHaveBeenCalledTimes(1);
			expect(gallery.open.mock.calls[0][0]).toMatchObject({ current: "worlds/test/grulk.webp" });
		} finally {
			delete globalThis.ImagePopout;
		}
	});

	it("still opens the window with no portrait art, because that is the route to choosing one", async () => {
		// This click used to be refused on the grounds that a decorative default is not worth
		// enlarging. That was right while the window only showed a picture; it now carries
		// "Edit Photo" (the People of Stonetop gallery) and "Frame Face" in its header, so an
		// art-less monster is precisely the case that needs it — and refusing left the avatar
		// doing nothing when clicked, which is not what the character sheet does with the same
		// click. The window shows whatever the header is drawing, so a creature-type mark is
		// still never swapped for a stock icon behind the reader's back.
		const actor = { name: "Grulk", img: "icons/svg/mystery-man.svg", system: {}, items: makeItems([]) };
		try {
			const { rendered, click } = wirePortrait(actor, { editMode: false });
			click();
			expect(rendered).toEqual([{ src: "icons/svg/mystery-man.svg", opts: { title: "Grulk" }, force: true }]);
		} finally {
			delete globalThis.ImagePopout;
		}
	});

	it("resets HP and damage die to the organization defaults", async () => {
		const actor = {
			system: { organization: "solitary", attributes: {} },
			items: makeItems([]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);

		await sheet._resetOrganizationDefaults();

		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.hp.value":           12,
			"system.attributes.hp.max":             12,
			"system.attributes.damage.rollFormula": "d10",
		});
	});

	it("ignores reset when the organization is unset", async () => {
		const actor = {
			system: { organization: "" },
			items: makeItems([]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);

		await sheet._resetOrganizationDefaults();

		expect(actor.update).not.toHaveBeenCalled();
	});

	it("updates the qualities rich-text field", async () => {
		const actor = {
			system: {},
			items: makeItems([]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);

		await sheet._updateRichTextField("qualities", "<p>Formatted</p>");

		expect(actor.update).toHaveBeenCalledWith({
			"system.qualities": "<p>Formatted</p>",
		});
	});

	it("refuses to update fields that are not rich-text fields", async () => {
		const actor = {
			system: {},
			items: makeItems([]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);

		await sheet._updateRichTextField("concept", "<p>nope</p>");

		expect(actor.update).not.toHaveBeenCalled();
	});

	it("updates notes as a rich-text field (editable outside edit mode)", async () => {
		const actor = {
			system: {},
			items: makeItems([]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);

		await sheet._updateRichTextField("notes", "<p>Spotted near the river.</p>");

		expect(actor.update).toHaveBeenCalledWith({
			"system.notes": "<p>Spotted near the river.</p>",
		});
	});

	// --- Inline move editing (edit mode) -----------------------------------

	it("enriches each move description for inline editing in edit mode", async () => {
		const actor = {
			system: {},
			items: makeItems([
				{ id: "m1", type: "monsterMove", name: "Snatch", system: { description: "<p>Grabs and bolts</p>", rollFormula: "" } },
			]),
		};
		const sheet = makeSheet(actor);
		sheet._editMode = true;

		const data = await sheet.getData();

		// enrichHTML is a passthrough in the test env (no TextEditor), so the enriched
		// description is the raw HTML — the point is that the key is populated.
		expect(data.monsterMoves[0].enrichedDescription).toBe("<p>Grabs and bolts</p>");
	});

	it("does not enrich move descriptions outside edit mode", async () => {
		const actor = {
			system: {},
			items: makeItems([
				{ id: "m1", type: "monsterMove", name: "Snatch", system: { description: "<p>x</p>" } },
			]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.monsterMoves[0].enrichedDescription).toBeUndefined();
	});

	it("persists an inline move edit to the embedded item (allowed field)", async () => {
		const item = { id: "m1", update: vi.fn() };
		const actor = { system: {}, items: makeItems([item]) };
		const sheet = makeSheet(actor);

		await sheet._updateMoveField("m1", "system.rollFormula", "1d8+2");

		expect(item.update).toHaveBeenCalledWith({ "system.rollFormula": "1d8+2" });
	});

	it("refuses to write a move field outside the whitelist", async () => {
		const item = { id: "m1", update: vi.fn() };
		const actor = { system: {}, items: makeItems([item]) };
		const sheet = makeSheet(actor);

		await sheet._updateMoveField("m1", "img", "hack.png");
		await sheet._updateMoveField("m1", "flags.core.sourceId", "spoof");

		expect(item.update).not.toHaveBeenCalled();
	});

	it("no-ops an inline move edit when the item is gone", async () => {
		const actor = { system: {}, items: makeItems([]) };
		const sheet = makeSheet(actor);

		// Resolves without throwing even though the id matches no item.
		await expect(sheet._updateMoveField("missing", "name", "X")).resolves.toBeUndefined();
	});

	it("routes a move-field change to the item in edit mode", async () => {
		const item = { id: "m1", update: vi.fn() };
		const actor = { system: {}, items: makeItems([item]) };
		const sheet = makeSheet(actor);
		sheet._editMode = true;

		let changeHandler;
		const root = {
			addEventListener: (name, handler) => { if (name === "change") changeHandler = handler; },
			querySelector: () => null,
		};
		sheet.activateListeners([root]);

		const field = {
			dataset: { field: "name" },
			value: "Gnash",
			closest: selector => selector === ".stonetop-monster-move-field" ? field
				: selector === "[data-item-id]" ? { dataset: { itemId: "m1" } } : null,
		};
		await changeHandler({ target: field });

		expect(item.update).toHaveBeenCalledWith({ name: "Gnash" });
	});

	it("ignores move-field changes when not in edit mode", async () => {
		const item = { id: "m1", update: vi.fn() };
		const actor = { system: {}, items: makeItems([item]) };
		const sheet = makeSheet(actor);
		sheet._editMode = false;

		let changeHandler;
		const root = {
			addEventListener: (name, handler) => { if (name === "change") changeHandler = handler; },
			querySelector: () => null,
		};
		sheet.activateListeners([root]);

		const field = {
			dataset: { field: "name" },
			value: "Gnash",
			closest: selector => selector === ".stonetop-monster-move-field" ? field
				: selector === "[data-item-id]" ? { dataset: { itemId: "m1" } } : null,
		};
		await changeHandler({ target: field });

		expect(item.update).not.toHaveBeenCalled();
	});

	it("keeps the window title element as a header spacer", () => {
		const title = { removed: false, remove() { this.removed = true; } };
		const idLink = { removed: false, remove() { this.removed = true; } };
		const header = {
			querySelector: selector => selector === ".window-title" ? title : null,
			querySelectorAll: selector => selector === ".document-id-link" ? [idLink] : [],
		};
		const sheet = makeSheet({
			system: {},
			items: makeItems([]),
		});
		sheet.element = [{
			querySelector: selector => selector === ".window-header" ? header : null,
		}];

		sheet._stripHeaderChrome();

		expect(idLink.removed).toBe(true);
		expect(title.removed).toBe(false);
	});

	// --- Armor-boost moves -------------------------------------------------

	it("tags armor-boost moves and reports no active boost when none is set", async () => {
		const actor = {
			system: { attributes: { armor: { value: 3 } } },
			flags: {},
			items: makeItems([
				{ id: "b1", type: "monsterMove", name: "Withdraw into its shell (Armor 5)", system: {} },
			]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.monsterMoves[0].armorBoost).toBe(5);
		expect(data.monsterMoves[0].boostActive).toBe(false);
		expect(data.monsterMoves[0].boostTooltip).toBe("Click to set Armor to 5");
		expect(data.stonetop.armorBoost).toBeNull();
	});

	it("marks the active armor-boost move and exposes the header indicator", async () => {
		const actor = {
			system: { attributes: { armor: { value: 5 } } },
			flags: { "stonetop-pwd": { armorBoost: { moveId: "b1", value: 5, baseValue: 3, label: "Withdraw into its shell" } } },
			items: makeItems([
				{ id: "b1", type: "monsterMove", name: "Withdraw into its shell (Armor 5)", system: {} },
				{ id: "n1", type: "monsterMove", name: "Burrow into soil", system: {} },
			]),
		};

		const data = await makeSheet(actor).getData();
		const [boostMove, plainMove] = data.monsterMoves;

		expect(boostMove.boostActive).toBe(true);
		expect(boostMove.boostTooltip).toBe("Click to revert Armor to normal");
		expect(plainMove.armorBoost).toBeNull();
		expect(plainMove.boostActive).toBe(false);
		expect(data.stonetop.armorBoost).toMatchObject({
			value: 5, baseValue: 3, label: "Withdraw into its shell",
		});
	});

	it("ignores a boost flag whose move no longer exists", async () => {
		const actor = {
			system: { attributes: { armor: { value: 5 } } },
			flags: { "stonetop-pwd": { armorBoost: { moveId: "gone", value: 5, baseValue: 3, label: "X" } } },
			items: makeItems([
				{ id: "b1", type: "monsterMove", name: "Burrow into soil", system: {} },
			]),
		};

		const data = await makeSheet(actor).getData();

		expect(data.stonetop.armorBoost).toBeNull();
		expect(data.monsterMoves[0].boostActive).toBe(false);
	});

	it("toggles an armor boost on, recording the pre-boost armor as the base", async () => {
		const actor = {
			system: { attributes: { armor: { value: 3 } } },
			flags: {},
			items: makeItems([]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);

		await sheet._toggleArmorBoost({ id: "m1", name: "Withdraw into its shell (Armor 5)" }, 5);

		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.armor.value": 5,
			"flags.stonetop-pwd.armorBoost": {
				moveId: "m1", value: 5, baseValue: 3, label: "Withdraw into its shell",
			},
		});
	});

	it("toggles the active armor boost off, restoring the base armor", async () => {
		const actor = {
			system: { attributes: { armor: { value: 5 } } },
			flags: { "stonetop-pwd": { armorBoost: { moveId: "m1", value: 5, baseValue: 3, label: "Withdraw into its shell" } } },
			items: makeItems([]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);

		await sheet._toggleArmorBoost({ id: "m1", name: "Withdraw into its shell (Armor 5)" }, 5);

		// The flag delete goes through deletionEntry; on v14+ (ForcedDeletion applied
		// via update()) that's a fresh instance on the unchanged key path.
		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.armor.value": 3,
			"flags.stonetop-pwd.armorBoost": expect.any(foundry.data.operators.ForcedDeletion),
		});
	});

	it("switching to a different boost move keeps the original base armor", async () => {
		const actor = {
			system: { attributes: { armor: { value: 5 } } }, // already boosted by m1
			flags: { "stonetop-pwd": { armorBoost: { moveId: "m1", value: 5, baseValue: 3, label: "Shell" } } },
			items: makeItems([]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);

		await sheet._toggleArmorBoost({ id: "m2", name: "Hunker down (Armor 6)" }, 6);

		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.armor.value": 6,
			"flags.stonetop-pwd.armorBoost": {
				moveId: "m2", value: 6, baseValue: 3, label: "Hunker down",
			},
		});
	});

	it("clicking an armor-boost move name toggles the boost instead of rolling", async () => {
		const boostItem = { id: "b1", name: "Withdraw into its shell (Armor 5)", roll: vi.fn() };
		const actor = {
			system: { attributes: { armor: { value: 3 } } },
			flags: {},
			items: makeItems([boostItem]),
		};
		const sheet = makeSheet(actor);
		sheet._toggleArmorBoost = vi.fn();

		const handlers = [];
		const root = {
			addEventListener: (name, handler) => { if (name === "click") handlers.push(handler); },
			querySelector: () => null,
		};
		sheet.activateListeners([root]);

		const target = {
			closest: selector => selector === ".stonetop-monster-move-name" ? target
				: selector === "[data-item-id]" ? { dataset: { itemId: "b1" } } : null,
		};
		await handlers[0]({ target });

		expect(sheet._toggleArmorBoost).toHaveBeenCalledWith(boostItem, 5);
		expect(boostItem.roll).not.toHaveBeenCalled();
	});

	it("announces an applied armor boost in chat (base → boosted)", async () => {
		const created = [];
		const originalChat = globalThis.ChatMessage;
		globalThis.ChatMessage = { create: msg => created.push(msg), getSpeaker: () => ({ alias: "Shellback Drake" }) };
		try {
			const actor = {
				name: "Shellback Drake",
				system: { attributes: { armor: { value: 3 } } },
				flags: {},
				items: makeItems([]),
				update: vi.fn(),
			};
			await makeSheet(actor)._toggleArmorBoost({ id: "m1", name: "Withdraw into its shell (Armor 5)" }, 5);

			expect(created).toHaveLength(1);
			expect(created[0].content).toContain("Withdraw into its shell");
			expect(created[0].content).toMatch(/3 &rarr; 5/);
			expect(created[0].content).not.toContain("reverted");
		} finally {
			globalThis.ChatMessage = originalChat;
		}
	});

	it("announces reverting an armor boost in chat (boosted → base)", async () => {
		const created = [];
		const originalChat = globalThis.ChatMessage;
		globalThis.ChatMessage = { create: msg => created.push(msg), getSpeaker: () => ({}) };
		try {
			const actor = {
				name: "Shellback Drake",
				system: { attributes: { armor: { value: 5 } } },
				flags: { "stonetop-pwd": { armorBoost: { moveId: "m1", value: 5, baseValue: 3, label: "Withdraw into its shell" } } },
				items: makeItems([]),
				update: vi.fn(),
			};
			await makeSheet(actor)._toggleArmorBoost({ id: "m1", name: "Withdraw into its shell (Armor 5)" }, 5);

			expect(created[0].content).toMatch(/5 &rarr; 3/);
			expect(created[0].content).toContain("reverted");
		} finally {
			globalThis.ChatMessage = originalChat;
		}
	});

	it("clicking a non-boost move name posts it to chat (rolls)", async () => {
		const plainItem = { id: "n1", name: "Burrow into soil", roll: vi.fn() };
		const actor = { system: {}, flags: {}, items: makeItems([plainItem]) };
		const sheet = makeSheet(actor);

		const handlers = [];
		const root = {
			addEventListener: (name, handler) => { if (name === "click") handlers.push(handler); },
			querySelector: () => null,
		};
		sheet.activateListeners([root]);

		const target = {
			closest: selector => selector === ".stonetop-monster-move-name" ? target
				: selector === "[data-item-id]" ? { dataset: { itemId: "n1" } } : null,
		};
		await handlers[0]({ target });

		expect(plainItem.roll).toHaveBeenCalled();
	});

	it("deleting the active boost move reverts its armor before removing it", async () => {
		const boostItem = { id: "b1", name: "Withdraw into its shell (Armor 5)", delete: vi.fn() };
		const actor = {
			system: { attributes: { armor: { value: 5 } } }, // currently boosted
			flags: { "stonetop-pwd": { armorBoost: { moveId: "b1", value: 5, baseValue: 3, label: "Withdraw into its shell" } } },
			items: makeItems([boostItem]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);
		sheet._editMode = true;

		const originalDialog = globalThis.Dialog;
		stubConfirm(true);
		try {
			const handlers = [];
			const root = {
				addEventListener: (name, handler) => { if (name === "click") handlers.push(handler); },
				querySelector: () => null,
			};
			sheet.activateListeners([root]);

			// The add/delete/edit handler is the second click listener (registered after isEditable).
			const target = {
				closest: selector => selector === ".stonetop-monster-delete-move" ? target
					: selector === "[data-item-id]" ? { dataset: { itemId: "b1" } } : null,
			};
			await handlers[1]({ target });

			expect(actor.update).toHaveBeenCalledWith({
				"system.attributes.armor.value": 3,
				"flags.stonetop-pwd.armorBoost": expect.any(foundry.data.operators.ForcedDeletion),
			});
			expect(boostItem.delete).toHaveBeenCalled();
		} finally {
			globalThis.Dialog = originalDialog;
		}
	});

	it("deleting a non-boost move leaves an active boost untouched", async () => {
		const plainItem = { id: "n1", name: "Burrow into soil", delete: vi.fn() };
		const actor = {
			system: { attributes: { armor: { value: 5 } } },
			flags: { "stonetop-pwd": { armorBoost: { moveId: "b1", value: 5, baseValue: 3, label: "Shell" } } },
			items: makeItems([plainItem]),
			update: vi.fn(),
		};
		const sheet = makeSheet(actor);
		sheet._editMode = true;

		const originalDialog = globalThis.Dialog;
		stubConfirm(true);
		try {
			const handlers = [];
			const root = {
				addEventListener: (name, handler) => { if (name === "click") handlers.push(handler); },
				querySelector: () => null,
			};
			sheet.activateListeners([root]);

			const target = {
				closest: selector => selector === ".stonetop-monster-delete-move" ? target
					: selector === "[data-item-id]" ? { dataset: { itemId: "n1" } } : null,
			};
			await handlers[1]({ target });

			expect(actor.update).not.toHaveBeenCalled();
			expect(plainItem.delete).toHaveBeenCalled();
		} finally {
			globalThis.Dialog = originalDialog;
		}
	});

	it("hides the boost affordance on a read-only sheet (can't write the actor)", async () => {
		const actor = {
			system: { attributes: { armor: { value: 5 } } },
			flags: { "stonetop-pwd": { armorBoost: { moveId: "b1", value: 5, baseValue: 3, label: "Shell" } } },
			items: makeItems([
				{ id: "b1", type: "monsterMove", name: "Withdraw into its shell (Armor 5)", system: {} },
			]),
		};

		const data = await makeSheet(actor, { editable: false }).getData();

		expect(data.stonetop.armorBoost).toBeNull();
		expect(data.monsterMoves[0].armorBoost).toBe(5);   // still parsed…
		expect(data.monsterMoves[0].showBoostIcon).toBe(false); // …but no toggle affordance
		expect(data.monsterMoves[0].boostActive).toBe(false);
		expect(data.monsterMoves[0].boostTooltip).toBeNull();
	});

	it("keeps an active boost revertable after its move is renamed to drop '(Armor N)'", async () => {
		const actor = {
			system: { attributes: { armor: { value: 5 } } },
			flags: { "stonetop-pwd": { armorBoost: { moveId: "b1", value: 5, baseValue: 3, label: "Shell" } } },
			items: makeItems([
				// Name no longer parses as a boost, but the flag still points at it.
				{ id: "b1", type: "monsterMove", name: "Withdraw into its shell", system: {} },
			]),
		};

		const data = await makeSheet(actor).getData();
		const move = data.monsterMoves[0];

		expect(move.armorBoost).toBeNull();        // name no longer advertises a value
		expect(move.boostActive).toBe(true);       // …but it is still the live boost
		expect(move.showBoostIcon).toBe(true);     // so it keeps a shield + revert hint
		expect(move.boostTooltip).toBe("Click to revert Armor to normal");
		// Header label tracks the move's current (renamed) name, not the stale flag.
		expect(data.stonetop.armorBoost.label).toBe("Withdraw into its shell");
	});

	it("clicking the renamed active boost move reverts it instead of rolling", async () => {
		const boostItem = { id: "b1", name: "Withdraw into its shell", roll: vi.fn() };
		const actor = {
			system: { attributes: { armor: { value: 5 } } },
			flags: { "stonetop-pwd": { armorBoost: { moveId: "b1", value: 5, baseValue: 3, label: "Shell" } } },
			items: makeItems([boostItem]),
		};
		const sheet = makeSheet(actor);
		sheet._toggleArmorBoost = vi.fn();

		const handlers = [];
		const root = {
			addEventListener: (name, handler) => { if (name === "click") handlers.push(handler); },
			querySelector: () => null,
		};
		sheet.activateListeners([root]);

		const target = {
			closest: selector => selector === ".stonetop-monster-move-name" ? target
				: selector === "[data-item-id]" ? { dataset: { itemId: "b1" } } : null,
		};
		await handlers[0]({ target });

		expect(sheet._toggleArmorBoost).toHaveBeenCalledWith(boostItem, null);
		expect(boostItem.roll).not.toHaveBeenCalled();
	});

	it("reports the current armor (not the original base) when switching boost moves", async () => {
		const created = [];
		const originalChat = globalThis.ChatMessage;
		globalThis.ChatMessage = { create: msg => created.push(msg), getSpeaker: () => ({}) };
		try {
			const actor = {
				system: { attributes: { armor: { value: 5 } } }, // already boosted to 5 by m1
				flags: { "stonetop-pwd": { armorBoost: { moveId: "m1", value: 5, baseValue: 3, label: "Shell" } } },
				items: makeItems([]),
				update: vi.fn(),
			};
			await makeSheet(actor)._toggleArmorBoost({ id: "m2", name: "Hunker down (Armor 6)" }, 6);

			expect(created[0].content).toMatch(/5 &rarr; 6/); // current 5 → new 6, not 3 → 6
		} finally {
			globalThis.ChatMessage = originalChat;
		}
	});

});
