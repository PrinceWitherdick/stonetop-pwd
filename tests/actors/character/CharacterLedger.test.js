import { describe, it, expect } from "vitest";
import { CharacterLedger } from "../../../module/actors/character/CharacterLedger.js";
import { ledgerNoun } from "../../../module/utils/ledger-core.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

function makeActor(system = {}, flags = {}) {
	return {
		type: "character",
		system,
		flags,
	};
}

describe("CharacterLedger", () => {
	it("records a playbook being added", async () => {
		const actor = makeActor({ playbook: { name: "", slug: "" } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"system.playbook": { name: "The Fox", slug: "the-fox", uuid: "Compendium.x" },
		});
		expect(entries.map(e => e.action)).toEqual(["Playbook added: The Fox"]);
	});

	it("records damage changes", async () => {
		const actor = makeActor({ attributes: { damage: { value: "d4" } } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"system.attributes.damage.value": "d6",
		});
		expect(entries.map(e => e.action)).toEqual(["Damage value changed from d4 to d6"]);
	});

	// Max HP is stored twice: `hp.adjustment` is the signed delta the sheet keeps, and `hp.max`
	// is a mirror written beside it so the token bar reads the right number. Both paths are
	// labelled, so one player typing a new max used to file TWO rows for one edit.
	it("files one row when a hand-set max HP writes the delta and its mirror together", async () => {
		const actor = makeActor({ attributes: { hp: { value: 20, max: 20, adjustment: 0 } } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"system.attributes.hp.adjustment": 4,
			"system.attributes.hp.max": 24,
		});
		expect(entries).toHaveLength(1);
		expect(entries[0].action).toContain("Max HP (permanent)");
	});

	// A character with no playbook has no derived base to sit a delta on, so setMaxHp writes the
	// typed number straight to the stored field — and that write is the only record there is.
	it("still records the stored max when it changes on its own", async () => {
		const actor = makeActor({ attributes: { hp: { value: 10, max: 10, adjustment: 0 } } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"system.attributes.hp.max": 14,
		});
		expect(entries).toHaveLength(1);
		expect(entries[0].action).toContain("Max HP");
		expect(entries[0].action).not.toContain("permanent");
	});

	it("records wound additions, status changes, and removals", async () => {
		const actor = makeActor({ attributes: { wounds: [
			{ id: "w1", text: "Twisted ankle", status: "problematic", healed: false },
			{ id: "w2", text: "Cracked rib", status: "problematic", healed: false },
		] } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"system.attributes.wounds": [
				{ id: "w1", text: "Twisted ankle", status: "stabilized", healed: false },
				{ id: "w3", text: "Burn", status: "problematic", healed: false },
			],
		});
		expect(entries.map(e => e.action)).toEqual([
			'Wound stabilized: "Twisted ankle"',
			'Wound recorded: "Burn"',
			'Wound removed: "Cracked rib"',
		]);
	});

	it("records a wound healed to a scar", async () => {
		const actor = makeActor({ attributes: { wounds: [
			{ id: "w1", text: "Gash", status: "stabilized", healed: false },
		] } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"system.attributes.wounds": [
				{ id: "w1", text: "Gash", status: "stabilized", healed: true },
			],
		});
		expect(entries.map(e => e.action)).toEqual(['Wound healed to a scar: "Gash"']);
	});

	it("records inventory selections by item name", async () => {
		const actor = makeActor({}, { stonetop: { inventory: { checked: { "bow-arrows": false } } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				inventory: {
					outfit: {
						regularItems: [{ slug: "bow-arrows", name: "Bow & arrows" }],
					},
				},
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.inventory.checked.bow-arrows": true,
		});
		expect(entries.map(e => e.action)).toEqual(["Bow & arrows selected"]);
	});

	it("records possession selections by item name", async () => {
		const actor = makeActor({}, { stonetop: { possessions: { selected: ["sacred-pouch"] } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				inventory: {
					possessions: {
						items: [{ slug: "sacred-pouch", label: "Sacred pouch" }],
					},
				},
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.possessions.selected": [],
		});
		expect(entries.map(e => e.action)).toEqual(["Sacred pouch deselected"]);
	});

	// A gear bundle's ◇ is the carry mark, not the pick — so it needs its own reading.
	// Without it the change falls through to the generic "Possessions" namespace label and
	// every diamond click writes an unreadable "Possessions changed from … to …" line.
	it("records a chosen weapon being picked up and set down by its label", async () => {
		const weaponsActor = choiceCarried => {
			const actor = makeActor({}, { stonetop: { possessions: { choiceCarried } } });
			actor.typedActor = {
				buildSnapshot: async () => ({
					inventory: {
						possessions: {
							items: [{
								slug: "weapons-of-war", label: "Weapons of war",
								choices: { options: [{ slug: "sword", label: "◇ Sword, iron" }] },
							}],
						},
					},
				}),
			};
			return actor;
		};
		const path = "flags.stonetop-pwd.possessions.choiceCarried.weapons-of-war:sword";

		const carried = await CharacterLedger.entriesForActorUpdate(weaponsActor({}), { [path]: true });
		expect(carried.map(e => e.action)).toEqual(["Weapons of war: ◇ Sword, iron carried"]);

		const setDown = await CharacterLedger.entriesForActorUpdate(
			weaponsActor({ "weapons-of-war:sword": true }), { [path]: false });
		expect(setDown.map(e => e.action)).toEqual(["Weapons of war: ◇ Sword, iron set down"]);
	});

	it("records a write-in possession being added by its label", async () => {
		const actor = makeActor({}, { stonetop: { possessions: { custom: [] } } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.possessions.custom": [{ slug: "custom-1", label: "A locket" }],
		});
		expect(entries.map(e => e.action)).toEqual(["A locket added (write-in possession)"]);
	});

	it("records a write-in possession being removed by its label", async () => {
		const actor = makeActor({}, { stonetop: { possessions: { custom: [{ slug: "custom-1", label: "A locket" }] } } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.possessions.custom": [],
		});
		expect(entries.map(e => e.action)).toEqual(["A locket removed (write-in possession)"]);
	});

	it("records move resource changes by move name and resource title", async () => {
		const actor = makeActor({}, { stonetop: { moves: { backgroundChoices: { "Rites of the Land": 1 } } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				moves: [{ moves: [{ name: "Rites of the Land", resource: { title: "Favor" } }] }],
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.moves.backgroundChoices": { "Rites of the Land": 3 },
		});
		expect(entries.map(e => e.action)).toEqual(["Rites of the Land - Favor changed from 1 to 3"]);
	});

	it("falls back to the move name when a move resource has no title", async () => {
		const actor = makeActor({}, { stonetop: { moves: { backgroundChoices: {} } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				moves: [{ moves: [{ name: "Untitled Track", resource: { title: null } }] }],
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.moves.backgroundChoices": { "Untitled Track": 2 },
		});
		expect(entries.map(e => e.action)).toEqual(["Untitled Track resource set to 2"]);
	});

	it("names titled inventory resource tracks by their title (e.g. arcana charges)", async () => {
		const actor = makeActor({}, { stonetop: { inventory: { resources: { "shell-game-of-souls": 0 } } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				inventory: {
					outfit: { arcanaRegular: [{ slug: "shell-game-of-souls", name: "Shell Game of Souls", resource: { title: "Souls" } }] },
				},
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.inventory.resources.shell-game-of-souls": 2,
		});
		expect(entries.map(e => e.action)).toEqual(["Shell Game of Souls - Souls changed from 0 to 2"]);
	});

	it("falls back to 'resource' for untitled inventory tracks", async () => {
		const actor = makeActor({}, { stonetop: { inventory: { resources: {} } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				inventory: { outfit: { regularItems: [{ slug: "bow-arrows", name: "Bow & arrows", resource: { title: null, labels: ["low", "out"] } }] } },
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.inventory.resources.bow-arrows": 1,
		});
		expect(entries.map(e => e.action)).toEqual(["Bow & arrows resource set to 1"]);
	});

	it("records count-style move marks by move name and option label", async () => {
		const actor = makeActor({}, { stonetop: { moves: { moveMarks: { "Heroes to the Last": { "crew-hp": [] } } } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				moves: [{ moves: [{ name: "Heroes to the Last", markOptions: [{ slug: "crew-hp", label: "Increase their max HP by 4 each" }] }] }],
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.moves.moveMarks": { "Heroes to the Last": { "crew-hp": [{ stat: "", level: 6 }] } },
		});
		expect(entries.map(e => e.action)).toEqual(["Heroes to the Last - Increase their max HP by 4 each marked"]);
	});

	it("records stat-choice move marks with the chosen stat", async () => {
		const actor = makeActor({ stats: { str: { value: 0 } } }, { stonetop: { moves: { moveMarks: { "Potential for Greatness": { stat: [] } } } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				moves: [{ moves: [{ name: "Potential for Greatness", markOptions: [{ slug: "stat", label: "Increase the stat you rolled by 1, to a max of +2", choice: "stat" }] }] }],
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.moves.moveMarks": { "Potential for Greatness": { stat: [{ stat: "str", level: 2 }] } },
		});
		expect(entries.map(e => e.action)).toEqual(["Potential for Greatness - Increase the stat you rolled by 1, to a max of +2: STR marked"]);
	});

	it("records an arcana unlock requirement by card name and requirement text", async () => {
		const actor = makeActor({}, { stonetop: { arcana: { unlock: { "the-key:master-fear": 0 } } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				arcana: {
					minor: { items: [{
						slug: "the-key", major: false,
						front: { title: "The Key", unlock: { requirements: [
							{ type: "option", slug: "master-fear", description: "… master your fear and force yourself to touch it." },
						] } },
						back: { options: [] },
					}] },
					major: { items: [] },
				},
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.arcana.unlock.the-key:master-fear": 1,
		});
		expect(entries.map(e => e.action)).toEqual([
			"Minor Arcana The Key: … master your fear and force yourself to touch it. marked",
		]);
	});

	it("truncates a long unlock requirement to a readable ledger length", async () => {
		const long = "… calm your mind, gaze upon the sigil, and roll +WIS: on a 10+, the sigil becomes clear and you may proceed.";
		const actor = makeActor({}, { stonetop: { arcana: { unlock: { "sunken-tablet:calm": 1 } } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				arcana: {
					minor: { items: [{
						slug: "sunken-tablet", major: false,
						front: { title: "Sunken Tablet", unlock: { requirements: [{ type: "option", slug: "calm", description: long }] } },
						back: { options: [] },
					}] },
					major: { items: [] },
				},
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.arcana.unlock.sunken-tablet:calm": 0,
		});
		expect(entries.map(e => e.action)).toEqual([
			"Minor Arcana Sunken Tablet: … calm your mind, gaze upon the sigil, and roll +WIS: on a 10+,… unmarked",
		]);
	});

	it("records a marked arcana track box by card name, side, kind, and position", async () => {
		const actor = makeActor({}, { stonetop: { arcana: { boxes: { "blood-quenched-sword:unlock:2": false } } } });
		actor.typedActor = {
			buildSnapshot: async () => ({
				arcana: {
					minor: { items: [] },
					major: { items: [{
						slug: "blood-quenched-sword", major: true,
						front: { title: "Blood-quenched Sword", unlock: { requirements: [] } },
						back: { options: [] },
					}] },
				},
			}),
		};

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.arcana.boxes.blood-quenched-sword:unlock:2": true,
		});
		expect(entries.map(e => e.action)).toEqual([
			"Major Arcana Blood-quenched Sword: unlock 3 marked",
		]);
	});

	it("falls back to a prettified slug when the arcanum is not in the snapshot", async () => {
		const actor = makeActor({}, { stonetop: { arcana: { boxes: { "lost-card:frontDiamond:0": true } } } });
		actor.typedActor = { buildSnapshot: async () => ({ arcana: { minor: { items: [] }, major: { items: [] } } }) };

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.arcana.boxes.lost-card:frontDiamond:0": false,
		});
		expect(entries.map(e => e.action)).toEqual([
			"Arcana Lost Card: front diamond 1 unmarked",
		]);
	});

	it("records background choices by choice label", async () => {
		const actor = makeActor({}, { stonetop: { background: { choices: { enfys: false } } } });
		actor.items = [{
			type: "playbook",
			flags: {
				stonetop: {
					backgrounds: [{
						slug: "initiate",
						choices: {
							options: [{ slug: "enfys", label: "Enfys, your acolyte, beloved by birds" }],
						},
					}],
				},
			},
		}];

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.background.choices.enfys": true,
		});
		expect(entries.map(e => e.action)).toEqual(["Enfys, your acolyte, beloved by birds selected"]);
	});

	it("records initiate loyalty by follower name", async () => {
		const actor = makeActor({}, { stonetop: { initiatesLoyalty: { enfys: 1 } } });
		actor.items = [{
			type: "playbook",
			flags: {
				stonetop: {
					backgrounds: [{
						slug: "initiate",
						choices: {
							options: [{ slug: "enfys", label: "Enfys, your acolyte, beloved by birds" }],
						},
					}],
				},
			},
		}];

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.initiatesLoyalty.enfys": 2,
		});
		expect(entries.map(e => e.action)).toEqual(["Enfys loyalty changed from 1 to 2"]);
	});

	it("records named follower stat changes", async () => {
		const actor = makeActor({}, {
			stonetop: {
				animalCompanion: { name: "Bramble", instinct: "to chase rabbits" },
				crew: {
					name: "The Red Shields",
					loyalty: 1,
					individuals: [{ name: "Aled", tag: "eager" }],
				},
			},
		});

		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.animalCompanion.instinct": "to guard the camp",
			"flags.stonetop-pwd.crew.loyalty": 2,
			"flags.stonetop-pwd.crew.individuals.0.tag": "cautious",
		});
		expect(entries.map(e => e.action)).toEqual([
			"Bramble instinct changed from to chase rabbits to to guard the camp",
			"The Red Shields loyalty changed from 1 to 2",
			"Aled tag changed from eager to cautious",
		]);
	});

	// The crew keeps its roster in flag ARRAYS, written back WHOLE because a flag array cannot be
	// updated by dotted path (see actors/character/roster-portraits.js). formatValue joins an array
	// with ", ", so an array of OBJECTS came out as the literal "[object Object]" — one such line
	// for every portrait pick, every "Use default", and every member added or removed.
	describe("the crew's roster", () => {
		const crew = (extra) => makeActor({}, { stonetop: { crew: { name: "The Red Shields", ...extra } } });

		it("says who was named, from the whole-array write behind it", async () => {
			const actor = crew({ individuals: [{ name: "Aled", tag: "eager" }] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individuals": [{ name: "Aled", tag: "eager" }, { name: "Eira" }],
			});
			expect(entries.map(e => e.action)).toEqual(["Eira named to The Red Shields"]);
		});

		it("says who was removed", async () => {
			const actor = crew({ individuals: [{ name: "Aled" }, { name: "Eira" }] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individuals": [{ name: "Eira" }],
			});
			expect(entries.map(e => e.action)).toEqual(["Aled removed from The Red Shields"]);
		});

		// Matched by NAME, not by position: the array is spliced, so a positional diff would report
		// the whole tail as replaced when the member removed was not the last one.
		it("does not report the survivors as replaced when a member in the middle leaves", async () => {
			const actor = crew({ individuals: [{ name: "Aled" }, { name: "Eira" }, { name: "Glaw" }] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individuals": [{ name: "Aled" }, { name: "Glaw" }],
			});
			expect(entries.map(e => e.action)).toEqual(["Eira removed from The Red Shields"]);
		});

		// A portrait pick rewrites this same array with the membership untouched.
		it("stays quiet when the only change to the array is a face", async () => {
			const actor = crew({ individuals: [{ name: "Aled" }] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individuals": [{ name: "Aled", img: "aled.webp" }],
			});
			expect(entries.map(e => e.action)).toEqual([]);
		});

		// The card's own two are covered by the system-wide cosmetic-portrait rule; the anonymous
		// members' array needs a rule of its own, because it is one atomic leaf whose path never
		// mentions `img`.
		it("stays quiet on an anonymous member's face, and on the crew card's own", async () => {
			const actor = crew({ memberPortrait: [{ img: "old.webp" }], details: { img: "card.webp" } });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.memberPortrait": [{ img: "new.webp" }],
				"flags.stonetop-pwd.crew.details.img": "other.webp",
				"flags.stonetop-pwd.crew.details.portraitFrame": { src: "other.webp", rect: [0.1, 0.2, 0.3, 0.4] },
			});
			expect(entries.map(e => e.action)).toEqual([]);
		});

		// A `-=` key is a DELETION, not a value — it used to render as "set to blank".
		it("stays quiet on a deletion key", async () => {
			const actor = crew({ details: { portraitFrame: { src: "x.webp", rect: [0, 0, 1, 1] } } });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.details.-=portraitFrame": null,
			});
			expect(entries.map(e => e.action)).toEqual([]);
		});

		// A custom group follower's roster is silenced by customFollowerEntry's ALLOWLIST rather
		// than by the crew's rules, so it is covered separately: if that allowlist ever grows, this
		// catches the day "[object Object]" comes back on the other roster.
		it("stays quiet on a custom group follower's roster faces too", async () => {
			const actor = makeActor({}, {
				stonetop: {
					customFollowers: { warband: { name: "The Warband", loyalty: 1, memberPortrait: [{ img: "old.webp" }] } },
				},
			});
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.customFollowers.warband.memberPortrait": [{ img: "new.webp" }],
			});
			expect(entries.map(e => e.action)).toEqual([]);
		});

		// HP is the play-relevant track and must survive all of the above — now naming the member
		// the sheet names, instead of printing two lists of numbers to spot the difference between.
		it("names the anonymous member who took the hit", async () => {
			const actor = crew({ individuals: [{ name: "Aled" }], memberHp: [6, 6] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.memberHp": [4, 6],
			});
			// Counts past the one named individual, exactly as the roster labels them.
			expect(entries.map(e => e.action)).toEqual(["Crew member 2 HP changed from 6 to 4"]);
		});

		it("names the individual who took the hit", async () => {
			const actor = crew({ individuals: [{ name: "Aled" }, { name: "Eira" }], individualsHp: { 1: 6 } });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individualsHp.1": 3,
			});
			expect(entries.map(e => e.action)).toEqual(["Eira HP changed from 6 to 3"]);
		});

		// A row that IS an individual but has no name yet numbers from the top of the roster, the
		// way the sheet draws it (crewIndividualLabel) — not from the end of the named block, which
		// is how the ANONYMOUS tail is numbered. Labelled with the anonymous rule, a ledger line
		// pointed at "Crew member 4" for the row the sheet calls "Crew member 1".
		it("numbers an unnamed individual from the top of the roster, as the sheet does", async () => {
			const actor = crew({
				individuals: [{ tag: "eager" }, { name: "Eira" }, { name: "Glaw" }],
				individualsHp: { 0: 6 },
			});
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individualsHp.0": 4,
				"flags.stonetop-pwd.crew.individuals.0.tag": "cautious",
			});
			expect(entries.map(e => e.action)).toEqual([
				"Crew member 1 HP changed from 6 to 4",
				"Crew member 1 tag changed from eager to cautious",
			]);
		});

		// The anonymous tail is numbered from the named block AS THIS UPDATE LEAVES IT. Removing a
		// named member frees a body back into that tail in the same write, and `names` is built
		// from the actor BEFORE it — so numbering off that counted one name too many.
		it("numbers the anonymous tail against the roster the update leaves behind", async () => {
			const actor = crew({ individuals: [{ name: "Aled" }, { name: "Eira" }], size: 6, memberHp: [6, 6, 6, 6] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individuals": [{ name: "Aled" }],
				"flags.stonetop-pwd.crew.memberHp": [6, 6, 6, 4, 6],
			});
			// One name left, so the tail starts at 2 — "Crew member 5", not the pre-update 6.
			expect(entries.map(e => e.action)).toContain("Crew member 5 HP changed from 6 to 4");
		});

		// The HP writer sizes the array up to the member it is writing, so the FIRST hit on a
		// late member grows the array — that is damage, not a resize, and must still log.
		it("still logs the first hit on a member past the end of the stored array", async () => {
			const actor = crew({ memberHp: [6] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.memberHp": [6, 4],
			});
			expect(entries.map(e => e.action)).toEqual(["Crew member 2 HP set to 4"]);
		});

		// Shrinking is a resize or a promotion: the indices no longer line up, so a positional diff
		// would invent hits nobody took. The size line beside it is the real record.
		it("invents no damage when the roster shrinks", async () => {
			const actor = crew({ size: 6, memberHp: [6, 4, 6] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.size": 5,
				"flags.stonetop-pwd.crew.memberHp": [6, 4],
			});
			expect(entries.map(e => e.action)).toEqual(["The Red Shields roster size changed from 6 to 5"]);
		});

		// Two members called Aled is a keystroke away: the naming dialog only requires a non-empty
		// string, and its datalist offers nine names for a crew a half-dozen strong. With a SET
		// diff, removing one of them changed no set and the Chronicle recorded that nobody left.
		it("reports a removal even when two members share a name", async () => {
			const actor = crew({ individuals: [{ name: "Aled" }, { name: "Aled" }, { name: "Eira" }] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individuals": [{ name: "Aled" }, { name: "Eira" }],
			});
			expect(entries.map(e => e.action)).toEqual(["Aled removed from The Red Shields"]);
		});

		// Numbered, so coalesceEntries — which dedupes on the action string — cannot fold two
		// genuinely separate departures into one line.
		it("numbers repeats so two departures do not collapse into one line", async () => {
			const actor = crew({ individuals: [{ name: "Aled" }, { name: "Aled" }] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individuals": [],
			});
			expect(entries.map(e => e.action)).toEqual([
				"Aled (1 of 2) removed from The Red Shields",
				"Aled (2 of 2) removed from The Red Shields",
			]);
		});

		// unsetFlag("crew.groupHp") deletes at the crew's own ROOT, so the key is a bare `-=groupHp`
		// with no dot in front of it — which a dotted-only guard let through as "set to blank".
		it("stays quiet when the group-HP pool is restored to full", async () => {
			const actor = crew({ groupHp: 12 });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.-=groupHp": null,
			});
			expect(entries.map(e => e.action)).toEqual([]);
		});

		// The promote handler always writes the whole individualsHp map, and on a crew whose HP was
		// never touched that map is EMPTY — which Foundry's flattenObject keeps as a leaf.
		it("stays quiet on the whole individualsHp map, even when it is empty", async () => {
			const actor = crew({ individuals: [] });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individuals": [{ name: "Bran" }],
				"flags.stonetop-pwd.crew.individualsHp": {},
				"flags.stonetop-pwd.crew.memberHp": [],
			});
			expect(entries.map(e => e.action)).toEqual(["Bran named to The Red Shields"]);
		});

		// Every one of these collapsed to the field name "details" and read as the bare crew name.
		it("names which card field was edited", async () => {
			const actor = crew({ details: { moves: "", notes: "", armor: 1 } });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.details.moves": "Hold the line",
				"flags.stonetop-pwd.crew.details.notes": "Grumbling",
				"flags.stonetop-pwd.crew.details.armor": 2,
			});
			expect(entries.map(e => e.action)).toEqual([
				"The Red Shields moves set to Hold the line",
				"The Red Shields notes set to Grumbling",
				"The Red Shields armor changed from 1 to 2",
			]);
		});

		it("names the item when a gear pip moves, not just the crew", async () => {
			const actor = crew({ gear: { "bow-arrows": 0 } });
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.gear.bow-arrows": 1,
			});
			expect(entries.map(e => e.action)).toEqual(["The Red Shields Bow Arrows load changed from 0 to 1"]);
		});

		// Removing a member re-keys individualsHp to follow the splice. Read one key at a time
		// those look like every survivor taking the damage of the member below them, under the
		// wrong name — so the membership line speaks and the HP noise beside it is dropped.
		it("reports a removal once, not as phantom damage to everyone above the gap", async () => {
			const actor = crew({
				individuals: [{ name: "Aled" }, { name: "Eira" }, { name: "Glaw" }],
				individualsHp: { 0: 6, 1: 2, 2: 5 },
				size: 6,
			});
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.crew.individuals": [{ name: "Aled" }, { name: "Glaw" }],
				"flags.stonetop-pwd.crew.individualsHp.0": 6,
				"flags.stonetop-pwd.crew.individualsHp.1": 5,
				"flags.stonetop-pwd.crew.individualsHp.-=2": null,
				"flags.stonetop-pwd.crew.size": 5,
			});
			expect(entries.map(e => e.action)).toEqual([
				"Eira removed from The Red Shields",
				"The Red Shields roster size changed from 6 to 5",
			]);
		});
	});

	// One rule for every follower type, so a type added later is quiet by default rather than
	// quietly noisy. Each of these used to emit a raw file path or a bare rect.
	it("never logs a follower's portrait or its crop, whichever follower wears it", async () => {
		const actor = makeActor({}, {
			stonetop: {
				animalCompanion: { name: "Bramble", details: { img: "old.webp" } },
				initiateDetails: { acolyte: { img: "old.webp" } },
				customFollowers: { warband: { name: "The Warband", img: "old.webp" } },
			},
		});
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.animalCompanion.details.img": "bramble.webp",
			"flags.stonetop-pwd.animalCompanion.details.portraitFrame": { src: "bramble.webp", rect: [0.1, 0.2, 0.3, 0.4] },
			"flags.stonetop-pwd.initiateDetails.acolyte.img": "acolyte.webp",
			"flags.stonetop-pwd.customFollowers.warband.img": "warband.webp",
		});
		expect(entries.map(e => e.action)).toEqual([]);
	});

	// The link to the Actor made for a follower is plumbing, not play: it is written by the sweep
	// in follower-actors.js and by a drag onto the canvas, never by a player deciding anything.
	// Falling through, it wrote raw uuids into the Chronicle — and because the sweep links every
	// follower in ONE update, listMerge folded them into a single "Initiate details set to
	// Actor.<id>, Actor.<id>" line.
	it("never logs the Actor link a follower sweep writes back, whichever follower it is for", async () => {
		const actor = makeActor({}, {
			stonetop: {
				animalCompanion: { name: "Bramble", details: {} },
				initiateDetails: { enfys: {}, afon: {} },
				beastDetails: { mule: {} },
				crew: { name: "The Red Shields", details: {} },
			},
		});
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.initiateDetails.enfys.actorUuid": "Actor.E0FGjEd91XwUD7Jc",
			"flags.stonetop-pwd.initiateDetails.afon.actorUuid": "Actor.si3Eu6QXhkPwDnIJ",
			"flags.stonetop-pwd.beastDetails.mule.actorUuid": "Actor.aaaaaaaaaaaaaaaa",
			"flags.stonetop-pwd.animalCompanion.details.actorUuid": "Actor.bbbbbbbbbbbbbbbb",
			"flags.stonetop-pwd.crew.details.actorUuid": "Actor.cccccccccccccccc",
		});
		expect(entries.map(e => e.action)).toEqual([]);
	});

	// Clearing a portrait is TWO writes: the picture away as img:"" and the frame with it as
	// `.-=portraitFrame`. Silencing only the first left every "Use default" writing "set to blank".
	it("stays quiet on both halves of a portrait clear", async () => {
		const actor = makeActor({}, {
			stonetop: {
				animalCompanion: { name: "Bramble", details: { img: "old.webp", portraitFrame: { src: "old.webp", rect: [0, 0, 1, 1] } } },
			},
		});
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.animalCompanion.details.img": "",
			"flags.stonetop-pwd.animalCompanion.details.-=portraitFrame": null,
		});
		expect(entries.map(e => e.action)).toEqual([]);
	});

	// The ◇ checklist is an array of {label, checked} objects rewritten whole on every tick, so it
	// printed "[object Object]" — the very junk the crew rewrite existed to remove, one card over.
	it("reports a follower's gear checklist as a fact, not as stringified objects", async () => {
		const actor = makeActor({}, {
			stonetop: { animalCompanion: { name: "Bramble", details: { gear: [{ label: "Harness", checked: false }] } } },
		});
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.animalCompanion.details.gear": [{ label: "Harness", checked: true }],
		});
		expect(entries.map(e => e.action)).toEqual(["Bramble gear updated"]);
	});

	it("names which of the animal companion's card fields was edited", async () => {
		const actor = makeActor({}, { stonetop: { animalCompanion: { name: "Bramble", details: { notes: "" } } } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.animalCompanion.details.notes": "Limping",
		});
		expect(entries.map(e => e.action)).toEqual(["Bramble notes set to Limping"]);
	});

	// …but the rule is scoped to FLAG paths, so it cannot silence anything on the actor itself.
	it("leaves non-flag paths alone", async () => {
		const actor = makeActor({ attributes: { hp: { value: 10 } } }, {});
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"system.attributes.hp.value": 7,
		});
		expect(entries.map(e => e.action)).toEqual(["HP changed from 10 to 7"]);
	});

	it("records learned and removed moves", () => {
		const item = { name: "Ambush", type: "move", system: { moveType: "playbook" } };
		expect(CharacterLedger.entriesForCreatedItems([item]).map(e => e.action)).toEqual(["Ambush learned"]);
		expect(CharacterLedger.entriesForDeletedItems([item]).map(e => e.action)).toEqual(["Ambush removed"]);
	});

	it("stays quiet when a custom follower is created (whole-record write, not per-field noise)", async () => {
		// A creation writes every field of the record at once; the follower isn't yet in the
		// pre-update name map, so none of those field writes should become ledger lines.
		const actor = makeActor({}, {});
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.customFollowers.new1": {
				name: "Bran", loyalty: 0, hpCurrent: 6, instinct: "flee", cost: "coin", tags: ["brave"],
			},
		});
		expect(entries).toEqual([]);
	});

	it("records a play-track change to an existing custom follower, but not a detail edit", async () => {
		const actor = makeActor({}, { "stonetop-pwd": { customFollowers: { f1: { name: "Bran", loyalty: 2 } } } });
		// Loyalty (a play track) logs, named by the follower…
		const play = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.customFollowers.f1.loyalty": 1,
		});
		expect(play.map(e => e.action)).toEqual(["Bran loyalty changed from 2 to 1"]);
		// …but a detail edit (name / cost / instinct / tags) stays quiet.
		const detail = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.customFollowers.f1.name": "Brandon",
		});
		expect(detail).toEqual([]);
	});
});

describe("ledgerNoun", () => {
	it("derives the subject before the change verb", () => {
		expect(ledgerNoun("HP changed from 5 to 3")).toBe("HP");
		expect(ledgerNoun("STR set to +1")).toBe("STR");
		expect(ledgerNoun("Forward cleared")).toBe("Forward");
		expect(ledgerNoun("Bow & arrows selected")).toBe("Bow & arrows");
		expect(ledgerNoun("Bow & arrows deselected")).toBe("Bow & arrows");
		expect(ledgerNoun("Ambush learned")).toBe("Ambush");
		expect(ledgerNoun("Ambush removed")).toBe("Ambush");
		expect(ledgerNoun("Heroes to the Last - Increase their max HP by 4 each marked")).toBe("Heroes to the Last - Increase their max HP by 4 each");
		expect(ledgerNoun("Veteran Crew - Select 2 new tags for your Crew unmarked")).toBe("Veteran Crew - Select 2 new tags for your Crew");
	});

	it("uses the type label as the noun for typed add/remove entries", () => {
		expect(ledgerNoun("Playbook added: The Fox")).toBe("Playbook");
		expect(ledgerNoun("Playbook removed: The Fox")).toBe("Playbook");
		expect(ledgerNoun("Arcanum added: Gold Ring")).toBe("Arcanum");
		expect(ledgerNoun("Asset removed: Wagon")).toBe("Asset");
		expect(ledgerNoun("Neighbor renamed from A to B")).toBe("Neighbor");
	});

	it("keeps the full subject phrase for compound and currency nouns", () => {
		expect(ledgerNoun("Silver purses changed from 1 to 2")).toBe("Silver purses");
		expect(ledgerNoun("The Red Shields loyalty changed from 1 to 2")).toBe("The Red Shields loyalty");
		expect(ledgerNoun("Place A set to The Stone")).toBe("Place A");
	});

	it("ignores a trailing move attribution when deriving the subject", () => {
		// The ledger dialog renders move-caused entries as "<action> via <move>"; the
		// subject filter must still group them by the action's real subject.
		expect(ledgerNoun("XP changed from 4 to 5 via Defy Danger")).toBe("XP");
		expect(ledgerNoun("Forward changed from 1 to 0 via Defy Danger")).toBe("Forward");
		expect(ledgerNoun("Surplus changed from 2 to 3 via Seasons Change")).toBe("Surplus");
	});

	it("falls back to the whole action when no verb is recognised", () => {
		expect(ledgerNoun("Some freeform note")).toBe("Some freeform note");
		expect(ledgerNoun("")).toBe("");
		expect(ledgerNoun(null)).toBe("");
	});
});

// ── Readability regressions ─────────────────────────────────────────────────
// Every phrasing asserted below is one a real world's ledger actually produced.

function withSnapshot(actor, snapshot, playbookFlags) {
	actor.typedActor = { buildSnapshot: async () => snapshot };
	if (playbookFlags) actor.items = [{ type: "playbook", name: "PB", flags: { "stonetop-pwd": playbookFlags } }];
	return actor;
}

describe("CharacterLedger arcana flags", () => {
	it("names the card gained instead of dumping the whole owned slug list", async () => {
		const actor = withSnapshot(
			makeActor({}, { stonetop: { arcana: { owned: ["azure-hand"] } } }),
			{ arcana: { minor: { items: [{ slug: "the-key", front: { title: "The Key" } }] } } },
		);
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.arcana.owned": ["azure-hand", "the-key"],
		});
		expect(entries.map(e => e.action)).toEqual(["Arcanum gained: Minor Arcana The Key"]);
	});

	it("distinguishes identifying a card from owning it", async () => {
		// The owned and identified lists hold the same slugs, so under the old namespace label
		// both rendered the byte-identical "Arcana changed from a to a, b". They arrive as two
		// separate updates, so coalesceEntries could not collapse them and the pair read as a
		// duplicate-write bug.
		const actor = withSnapshot(
			makeActor({}, { stonetop: { arcana: { identified: [] } } }),
			{ arcana: { minor: { items: [{ slug: "the-key", front: { title: "The Key" } }] } } },
		);
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.arcana.identified": ["the-key"],
		});
		expect(entries.map(e => e.action)).toEqual(["Arcanum identified: Minor Arcana The Key"]);
	});

	it("logs both sides of a 10+ identify from the one batched update", async () => {
		// identifyAndRevealArcanum writes identified and revealed together, so the pair has to
		// survive as two distinct lines out of a single actor.update.
		const actor = withSnapshot(
			makeActor({}, { stonetop: { arcana: { identified: [], revealed: [] } } }),
			{ arcana: { minor: { items: [{ slug: "the-key", front: { title: "The Key" } }] } } },
		);
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.arcana.identified": ["the-key"],
			"flags.stonetop-pwd.arcana.revealed":   ["the-key"],
		});
		expect(entries.map(e => e.action)).toEqual([
			"Arcanum identified: Minor Arcana The Key",
			"Arcanum revealed: Minor Arcana The Key",
		]);
	});

	it("names the back a 7-9 owes, and the delivery that settles it", async () => {
		// Without an ARCANA_SLUG_LISTS row, arcanaFlagEntries returns [] for an unknown sub-key
		// and the write vanishes from the ledger silently.
		const snapshot = { arcana: { minor: { items: [{ slug: "the-key", front: { title: "The Key" } }] } } };
		const owed = withSnapshot(makeActor({}, { stonetop: { arcana: { backOwed: [] } } }), snapshot);
		expect((await CharacterLedger.entriesForActorUpdate(owed, {
			"flags.stonetop-pwd.arcana.backOwed": ["the-key"],
		})).map(e => e.action)).toEqual(["Arcanum back owed: Minor Arcana The Key"]);

		const paid = withSnapshot(makeActor({}, { stonetop: { arcana: { backOwed: ["the-key"] } } }), snapshot);
		expect((await CharacterLedger.entriesForActorUpdate(paid, {
			"flags.stonetop-pwd.arcana.backOwed": [],
		})).map(e => e.action)).toEqual(["Arcanum back delivered: Minor Arcana The Key"]);
	});

	it("reports a minor role cleared to null, not just to an empty string", async () => {
		// `typeof null` is "object", so the whole-object guard used to swallow the clear that
		// the same field reported when it arrived as "".
		const actor = withSnapshot(
			makeActor({}, { stonetop: { arcana: { minorRoles: { lead: "the-key" } } } }),
			{ arcana: { minor: { items: [{ slug: "the-key", front: { title: "The Key" } }] } } },
		);
		for (const cleared of [null, ""]) {
			const entries = await CharacterLedger.entriesForActorUpdate(actor, {
				"flags.stonetop-pwd.arcana.minorRoles.lead": cleared,
			});
			expect(entries.map(e => e.action)).toEqual(["Minor arcanum (lead) cleared"]);
		}
	});

	it("stays silent for bookkeeping sub-flags", async () => {
		const actor = makeActor({}, { stonetop: { arcana: { leadBackfilled: false, minorDraw: [] } } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.arcana.leadBackfilled": true,
			"flags.stonetop-pwd.arcana.minorDraw": ["a", "b", "c"],
		});
		expect(entries).toEqual([]);
	});
});

describe("CharacterLedger lore", () => {
	it("names the question and answer rather than logging the raw counter", async () => {
		const actor = withSnapshot(
			makeActor({}, { stonetop: { lore: { counts: {} } } }),
			{},
			{ lore: [{ slug: "earth-mother", title: "The Earth Mother", options: [{ slug: "shrine-loved", description: "<p>Loved and well-used.</p>" }] }] },
		);
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.lore.counts.earth-mother:shrine-loved": 1,
		});
		// Was: "Lore set to 1".
		expect(entries.map(e => e.action)).toEqual(["Lore: The Earth Mother: Loved and well-used. marked"]);
	});

	it("previews a written answer instead of pasting the whole paragraph", async () => {
		const long = "A mirror said to show the dead. ".repeat(20);
		const actor = withSnapshot(
			makeActor({}, { stonetop: { lore: { texts: {} } } }),
			{},
			{ lore: [{ slug: "relic", title: "Your Relic" }] },
		);
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.lore.texts.relic:where": "<p>" + long + "</p>",
		});
		expect(entries).toHaveLength(1);
		expect(entries[0].action).toMatch(/^Lore: Your Relic answered: /);
		expect(entries[0].action).toContain("…");
		expect(entries[0].action.length).toBeLessThan(120);
		expect(entries[0].action).not.toContain("<p>");
	});
});

describe("CharacterLedger debilities", () => {
	it("reads as marked/cleared rather than on/off", async () => {
		const actor = makeActor({ attributes: { debilities: { options: { dazed: { value: false } } } } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"system.attributes.debilities.options.dazed.value": true,
		});
		expect(entries.map(e => e.action)).toEqual(["Dazed marked"]);
	});
});

// Advantage and disadvantage are asked per roll now (module/dialogs/RollDialog.js) rather than
// held in a flag a sheet control wrote, so there is no longer a change for the ledger to file.
// A world that still carries the old flag is silent about it, which is what the generic
// namespace fallback does with any path the tables do not name.
describe("CharacterLedger roll mode", () => {
	it("no longer files an entry for the retired sticky flag", async () => {
		const actor = makeActor({}, { stonetop: { rollMode: "normal" } });
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.rollMode": "dis",
		});
		expect(entries.map(e => e.action)).not.toContain("Roll mode set to Disadvantage");
	});
});

describe("CharacterLedger possession choices", () => {
	it("resolves choices nested in subgroups", async () => {
		// The Sacred pouch's "choose 1 on each line" groups keep their options under
		// subgroups[].options; only group.options was read, so every such choice missed the
		// lookup and fell back to its prettified slug, giving the stuttering
		// "Sacred pouch: Sacred Pouch Origin Heirloom selected".
		const actor = withSnapshot(
			makeActor({}, { stonetop: { possessions: { subChoices: { "sacred-pouch": [] } } } }),
			{ inventory: { possessions: { items: [{
				slug: "sacred-pouch",
				label: "Sacred pouch",
				choiceGroups: [{ heading: "Your sacred pouch is...", subgroups: [
					{ options: [{ slug: "origin-heirloom", label: "an heirloom made just for you" }] },
				] }],
			}] } } },
		);
		const entries = await CharacterLedger.entriesForActorUpdate(actor, {
			"flags.stonetop-pwd.possessions.subChoices.sacred-pouch": ["origin-heirloom"],
		});
		expect(entries.map(e => e.action)).toEqual([
			"Sacred pouch: an heirloom made just for you selected",
		]);
	});
});

describe("CharacterLedger item batches", () => {
	it("summarises a bulk move grant instead of one entry per move", () => {
		// Picking a playbook grants every basic move in one create call — 21 for a Blessed.
		const moves = ["Aid", "Clash", "Defend", "Defy Danger", "Interfere", "Know Things"]
			.map(name => ({ type: "move", name, system: {} }));
		expect(CharacterLedger.entriesForCreatedItems(moves).map(e => e.action)).toEqual([
			"Moves learned (6): Aid, Clash, Defend, and 3 more",
		]);
	});

	it("keeps the summary's subject stable regardless of batch size", () => {
		// The count sits after the verb, not at the front, so ledgerNoun derives "Moves" rather
		// than a new subject ("6 moves", "21 moves") for every batch size the dropdown then lists.
		const batch = n => CharacterLedger.entriesForCreatedItems(
			Array.from({ length: n }, (_, i) => ({ type: "move", name: `Move ${i}`, system: {} })),
		)[0].action;
		expect(ledgerNoun(batch(6))).toBe("Moves");
		expect(ledgerNoun(batch(21))).toBe("Moves");
	});

	it("keeps small batches itemised", () => {
		const moves = [{ type: "move", name: "Aid", system: {} }, { type: "move", name: "Clash", system: {} }];
		expect(CharacterLedger.entriesForCreatedItems(moves).map(e => e.action)).toEqual([
			"Aid learned", "Clash learned",
		]);
	});

	it("splits a mixed batch by type so a playbook grant does not swallow the rest", () => {
		const docs = [
			...["Aid", "Clash", "Defend", "Defy Danger", "Interfere"].map(name => ({ type: "move", name, system: {} })),
			{ type: "playbook", name: "The Fox", system: {} },
		];
		expect(CharacterLedger.entriesForCreatedItems(docs).map(e => e.action)).toEqual([
			"Moves learned (5): Aid, Clash, Defend, and 2 more",
			"Playbook added: The Fox",
		]);
	});

	it("files each summarised batch under its own category", () => {
		const docs = [
			...["Aid", "Clash", "Defend", "Defy Danger", "Interfere"].map(name => ({ type: "move", name, system: {} })),
			{ type: "playbook", name: "The Fox", system: {} },
		];
		expect(CharacterLedger.entriesForCreatedItems(docs).map(e => e.category)).toEqual(["moves", "character"]);
	});

	it("only moves are 'learned', and Arcanum pluralises properly", () => {
		// The batch path used to reuse one verb and bolt an `s` on the singular label, so a
		// Seeker's opening draw read "Arcanums learned (5)" — neither word right.
		const cards = Array.from({ length: 5 }, (_, i) =>
			({ type: "move", name: `Card ${i}`, system: { moveType: "arcanum" } }));
		expect(CharacterLedger.entriesForCreatedItems(cards)[0].action).toBe(
			"Arcana added (5): Card 0, Card 1, Card 2, and 2 more",
		);

		const gear = Array.from({ length: 5 }, (_, i) =>
			({ type: "move", name: `Thing ${i}`, system: { moveType: "inventory-custom" } }));
		expect(CharacterLedger.entriesForCreatedItems(gear)[0].action).toBe(
			"Inventory items added (5): Thing 0, Thing 1, Thing 2, and 2 more",
		);
	});

	it("phrases a deleted batch as a loss whatever the type", () => {
		const cards = Array.from({ length: 5 }, (_, i) =>
			({ type: "move", name: `Card ${i}`, system: { moveType: "arcanum" } }));
		expect(CharacterLedger.entriesForDeletedItems(cards)[0].action).toBe(
			"Arcana removed (5): Card 0, Card 1, Card 2, and 2 more",
		);
	});

	// Emptying a written-in appearance line DELETES the sub-key, and the two supported cores
	// send a deletion in different shapes. Neither is a choice the player made, so neither
	// belongs in the ledger — and the v14 shape is an object, which used to stringify into the
	// row as "[object Object]".
	describe("a cleared appearance line", () => {
		const appearancePath = n => `flags.${SYSTEM_ID}.appearance.selected.${n}`;
		const withLine = value => makeActor({}, { [SYSTEM_ID]: { appearance: { selected: { 0: value } } } });

		it("records nothing for the v14 ForcedDeletion shape", async () => {
			const entries = await CharacterLedger.entriesForActorUpdate(
				withLine("built like a barn door"),
				{ [appearancePath(0)]: new foundry.data.operators.ForcedDeletion() },
			);
			expect(entries.map(e => e.action)).toEqual([]);
		});

		it("records nothing for the v13 -= shape", async () => {
			const entries = await CharacterLedger.entriesForActorUpdate(
				withLine("built like a barn door"),
				{ [`flags.${SYSTEM_ID}.appearance.selected.-=0`]: null },
			);
			expect(entries.map(e => e.action)).toEqual([]);
		});

		it("still records a line that was actually set", async () => {
			const entries = await CharacterLedger.entriesForActorUpdate(
				makeActor(),
				{ [appearancePath(0)]: "built like a barn door" },
			);
			expect(entries.map(e => e.action)).toEqual(["Appearance set to built like a barn door"]);
		});
	});
});
