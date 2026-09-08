import { describe, it, expect, vi } from "vitest";
import { StonetopSteading, improvementRequirementsMet, IMPROVEMENT_DEFINITIONS, IMPROVEMENT_CATEGORIES, IMPROVEMENT_GRANTS } from "../../../module/actors/steading/StonetopSteading.js";
import { improvementRequirementCount, sectionRequiredCount } from "../../../module/utils/improvement-def.js";

function makeSteadingActor({ system = {}, steadingFlags = {} } = {}) {
	return {
		type: "stonetop",
		system,
		flags: { stonetop: { steading: steadingFlags } },
		getFlag: (scope, key) => {
			if (scope !== "stonetop-pwd" || key !== "steading") return null;
			return steadingFlags;
		},
		update: vi.fn(),
	};
}

describe("StonetopSteading", () => {
	it("prefers flag-backed track values when building the sheet snapshot", async () => {
		const actor = makeSteadingActor({
			system: { stats: { fortunes: { value: 1 } } },
			steadingFlags: { system: { stats: { fortunes: { value: 2 } } } },
		});
		const snapshot = await new StonetopSteading(actor).buildSnapshot();
		expect(snapshot.system.stats.fortunes.value).toBe(2);
	});

	it("persists track changes to both system data and the steading flag fallback", async () => {
		const actor = makeSteadingActor();
		await new StonetopSteading(actor).setSystemValue("attributes.prosperity.value", 2);
		expect(actor.update).toHaveBeenCalledWith({
			"system.attributes.prosperity.value": 2,
			"flags.stonetop-pwd.steading.system.attributes.prosperity.value": 2,
		}, {});
	});

	it("marks improvements as earned when completed or requirement progress exists", async () => {
		const actor = makeSteadingActor({
			steadingFlags: {
				improvements: {
					standingWatch: { completed: true, r: [] },
					palisade: { completed: false, r: [true] },
				},
			},
		});
		const snapshot = await new StonetopSteading(actor).buildSnapshot();
		const bySlug = Object.fromEntries(snapshot.improvements.map(imp => [imp.slug, imp]));

		expect(bySlug.standingWatch.earned).toBe(true);
		expect(bySlug.palisade.earned).toBe(true);
		expect(bySlug.weaponsOfWar.earned).toBe(false);
	});

	describe("requirement gating (completeLocked / requirementsMet)", () => {
		const snapshotBySlug = async (improvements) => {
			const actor = makeSteadingActor({ steadingFlags: { improvements } });
			const snapshot = await new StonetopSteading(actor).buildSnapshot();
			return Object.fromEntries(snapshot.improvements.map(imp => [imp.slug, imp]));
		};

		it("locks completion until an 'all of the following' section is fully checked", async () => {
			// palisade: one section, all 4 items required.
			let bySlug = await snapshotBySlug({ palisade: { completed: false, r: [true, true, true] } });
			expect(bySlug.palisade.requirementsMet).toBe(false);
			expect(bySlug.palisade.completeLocked).toBe(true);

			bySlug = await snapshotBySlug({ palisade: { completed: false, r: [true, true, true, true] } });
			expect(bySlug.palisade.requirementsMet).toBe(true);
			expect(bySlug.palisade.completeLocked).toBe(false);
		});

		it("honors a section's 'N of the following' minimum", async () => {
			// heroicReputation: one section, any 3 of 6.
			let bySlug = await snapshotBySlug({ heroicReputation: { r: [true, true, false, false, false, false] } });
			expect(bySlug.heroicReputation.requirementsMet).toBe(false);

			bySlug = await snapshotBySlug({ heroicReputation: { r: [true, true, true, false, false, false] } });
			expect(bySlug.heroicReputation.requirementsMet).toBe(true);
		});

		it("treats grouped sections as alternatives (weaponsOfWar: either-source AND finish)", () => {
			const weaponsOfWar = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "weaponsOfWar");
			// idx 0 = "either this"; 1-6 = "or all of these"; 7-8 = "and then".
			const sourceViaSingle = [true, false, false, false, false, false, false, true, true];
			expect(improvementRequirementsMet(weaponsOfWar, sourceViaSingle)).toBe(true);

			// Source met but the finishing section incomplete → not met.
			const finishIncomplete = [true, false, false, false, false, false, false, true, false];
			expect(improvementRequirementsMet(weaponsOfWar, finishIncomplete)).toBe(false);
		});

		it("leaves an already-completed improvement toggleable even if requirements lapse", async () => {
			const bySlug = await snapshotBySlug({ palisade: { completed: true, r: [] } });
			expect(bySlug.palisade.requirementsMet).toBe(false);
			expect(bySlug.palisade.completeLocked).toBe(false);
		});

		it("counts every requirement checkbox across an improvement's sections", () => {
			// weaponsOfWar has 9 requirement items spread over its three sections; a
			// no-section improvement has zero. This drives the force-complete fill-in.
			const weaponsOfWar = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "weaponsOfWar");
			expect(improvementRequirementCount(weaponsOfWar)).toBe(9);
			expect(improvementRequirementCount({ sections: [] })).toBe(0);
			expect(improvementRequirementCount(null)).toBe(0);
		});
	});

	it("includes dragged player characters in the sheet snapshot", async () => {
		const actor = makeSteadingActor({
			steadingFlags: {
				players: [{ uuid: "Actor.hero", name: "Wren", img: "wren.webp", checked: true }],
			},
		});

		const snapshot = await new StonetopSteading(actor).buildSnapshot();

		expect(snapshot.players).toEqual([
			{ uuid: "Actor.hero", name: "Wren", img: "wren.webp", checked: true,
			  traits: "", relations: "", notes: "", resolvedOccupation: "", playbookName: "",
			  // No playbook resolves either, so the long form is just the name.
			  fullName: "Wren",
			  // No live actor resolves here, so the stored snapshot path stands in and there is
			  // no frame to apply. imgStyle is present-and-empty rather than absent, so the
			  // template's {{#if imgStyle}} has something definite to test.
			  imgStyle: "" },
		]);
	});

	it("names a player by their playbook, but keeps it out of the Occupation column", async () => {
		const hero = {
			id: "hero", type: "character", name: "Wren",
			system: { playbook: { name: "The Blessed", slug: "the-blessed" } },
		};
		const prevActors = game.actors;
		game.actors = { get: (id) => (id === "hero" ? hero : null), filter: (fn) => [hero].filter(fn) };
		try {
			const actor = makeSteadingActor({
				steadingFlags: {
					players: [{ id: "hero", uuid: "Actor.hero", name: "Wren", img: "wren.webp", checked: true }],
				},
			});
			const snapshot = await new StonetopSteading(actor).buildSnapshot();
			expect(snapshot.players[0].playbookName).toBe("The Blessed");
			expect(snapshot.players[0].fullName).toBe("Wren The Blessed");
			// A playbook isn't a job — players may hold any occupation, so the column stays theirs.
			expect(snapshot.players[0].resolvedOccupation).toBe("");
		} finally {
			game.actors = prevActors;
		}
	});

	// The row's stored name is a snapshot from the drop. Renaming the character used to leave
	// the roster showing the old one forever — the name cell isn't editable, so the only cure
	// was to remove the row and re-add them. Residents/Neighbors have always shown the live
	// name; Players now match, on the same terms as the live portrait.
	it("shows a player's live name, not the name stored when they were dropped", async () => {
		const hero = { id: "hero", type: "character", name: "Wren Fairweather", img: "new.webp", system: {} };
		const prevActors = game.actors;
		game.actors = { get: (id) => (id === "hero" ? hero : null), filter: (fn) => [hero].filter(fn) };
		try {
			const actor = makeSteadingActor({
				steadingFlags: { players: [{ id: "hero", uuid: "Actor.hero", name: "Wren", img: "wren.webp", checked: true }] },
			});
			const snapshot = await new StonetopSteading(actor).buildSnapshot();
			expect(snapshot.players[0].name).toBe("Wren Fairweather");
		} finally {
			game.actors = prevActors;
		}
	});

	// ...and the snapshot is still the fallback when the actor is gone, so a row whose
	// character was deleted shows a name the GM can recognise rather than an empty cell
	// (the template drops a nameless row entirely).
	it("falls back to the stored name for a player whose actor has gone", async () => {
		const actor = makeSteadingActor({
			steadingFlags: { players: [{ id: "hero", uuid: "Actor.hero", name: "Wren", img: "wren.webp", checked: true }] },
		});

		const snapshot = await new StonetopSteading(actor).buildSnapshot();

		expect(snapshot.players[0].name).toBe("Wren");
	});

	it("uses a player's manual occupation override when one is set", async () => {
		const actor = makeSteadingActor({
			steadingFlags: {
				players: [{ uuid: "Actor.hero", name: "Wren", img: "wren.webp", checked: true, occupation: "Hawker of Trinkets" }],
			},
		});

		const snapshot = await new StonetopSteading(actor).buildSnapshot();

		expect(snapshot.players[0].resolvedOccupation).toBe("Hawker of Trinkets");
	});

	// The roster's one write path, shared by the drag onto the steading sheet and by the
	// automatic filing a character gets when its player finishes creation. Both must agree
	// on the row shape and on what counts as "already listed", which is why neither builds
	// a row of its own.
	describe("addPlayerRow", () => {
		function makeMutableSteadingActor(steadingFlags = {}) {
			const actor = {
				type: "stonetop",
				system: {},
				flags: { stonetop: { steading: steadingFlags } },
				getFlag: (scope, key) => (key === "steading" ? actor.flags.stonetop.steading : null),
				setFlag: vi.fn((scope, key, value) => { actor.flags.stonetop.steading = value; return Promise.resolve(); }),
				update: vi.fn(),
			};
			return actor;
		}

		const wren = { id: "hero-id", uuid: "Actor.hero", name: "Wren", img: "wren.webp", type: "character" };

		it("appends a full row for a character who isn't listed yet", async () => {
			const actor = makeMutableSteadingActor();

			expect(await new StonetopSteading(actor).addPlayerRow(wren)).toBe(true);
			expect(actor.flags.stonetop.steading.players).toEqual([{
				id: "hero-id", uuid: "Actor.hero", name: "Wren", img: "wren.webp",
				checked: true, traits: "", relations: "", notes: "",
			}]);
		});

		it("leaves the roster alone when they're already on it", async () => {
			const actor = makeMutableSteadingActor({
				players: [{ id: "hero-id", uuid: "Actor.hero", name: "Wren", img: "wren.webp", checked: true }],
			});

			expect(await new StonetopSteading(actor).addPlayerRow(wren)).toBe(false);
			expect(actor.setFlag).not.toHaveBeenCalled();
		});

		it("matches on uuid alone when the row predates stored ids", async () => {
			const actor = makeMutableSteadingActor({ players: [{ uuid: "Actor.hero", name: "Wren" }] });

			expect(await new StonetopSteading(actor).addPlayerRow(wren)).toBe(false);
		});

		// Identity is the id, not the name. A GM re-minting a character for a player who
		// already had one deletes the old actor but keeps its row (the roster shows the
		// cached name so nobody silently vanishes), and the player usually reuses the name.
		// Matching on that would read the replacement as "already listed" and silently never
		// file them — the one failure mode with nothing on screen to notice.
		it("files a replacement character even when a row still carries their old name", async () => {
			const actor = makeMutableSteadingActor({
				players: [{ id: "old-hero", uuid: "Actor.old-hero", name: "Wren" }],
			});

			expect(await new StonetopSteading(actor).addPlayerRow(wren)).toBe(true);
			expect(actor.flags.stonetop.steading.players).toHaveLength(2);
		});

		// Two rows can share a name — two players naming their characters the same is
		// allowed, and both belong on the roster.
		it("files two different characters who share a name", async () => {
			const actor = makeMutableSteadingActor({
				players: [{ id: "other", uuid: "Actor.other", name: "Wren" }],
			});

			expect(await new StonetopSteading(actor).addPlayerRow(wren)).toBe(true);
			expect(actor.flags.stonetop.steading.players.map(r => r.id)).toEqual(["other", "hero-id"]);
		});

		it("ignores anything that isn't a player character", async () => {
			const actor = makeMutableSteadingActor();

			expect(await new StonetopSteading(actor).addPlayerRow({ id: "n1", name: "Marek", type: "npc" })).toBe(false);
			expect(await new StonetopSteading(actor).addPlayerRow(null)).toBe(false);
			expect(actor.setFlag).not.toHaveBeenCalled();
		});
	});

	it("resolves resident avatars from the linked NPC's art; legacy/text rows fall back to the default", async () => {
		// Residents & neighbors are now backed by "npc" actors: an actor-backed row
		// ({uuid, id}) pulls its avatar live from the linked NPC's img, while a legacy
		// plain-text row (pre-migration, no linked actor) shows the default avatar.
		const wren = {
			id: "wren", uuid: "Actor.wren", type: "npc", name: "Wren", img: "wren.webp",
			system: {},
		};
		const prevActors = game.actors;
		game.actors = {
			get: (id) => (id === "wren" ? wren : null),
			find: (fn) => [wren].find(fn) ?? null,
			filter: (fn) => [wren].filter(fn),
		};
		try {
			const actor = makeSteadingActor({
				steadingFlags: {
					residents: [{ uuid: "Actor.wren", id: "wren", name: "Wren" }],
					neighbors: [{ name: "Bala", home: "Marshedge", occupation: "", traits: "", relations: "", notes: "" }],
				},
			});
			const snapshot = await new StonetopSteading(actor).buildSnapshot();

			// Actor-backed row → the linked NPC's real art.
			expect(snapshot.residents[0].profileImg).toBe("wren.webp");
			// Legacy text row with no linked actor → the roster's empty-slot face (not the
			// mark an art-less NPC actor wears, which is people/default_profile.svg).
			expect(snapshot.neighbors[0].profileImg).toBe("systems/stonetop-pwd/assets/icons/people/empty_profile.svg");
		} finally {
			game.actors = prevActors;
		}
	});

	// Both placeholders an un-portraited NPC can be carrying: Foundry's mystery-man (an actor
	// created before the system stamped its own) and the Book I mark it stamps now. Either way
	// the roster draws its own empty-slot face rather than passing the stored one through.
	it.each([
		["Foundry's default", "icons/svg/mystery-man.svg"],
		["the mark the system stamps", "systems/stonetop-pwd/assets/icons/people/default_profile.svg"],
	])("falls back to the roster's empty face when the linked NPC wears %s", async (_label, img) => {
		const bala = {
			id: "bala", uuid: "Actor.bala", type: "npc", name: "Bala", img,
			system: { home: "Marshedge" },
		};
		const prevActors = game.actors;
		game.actors = {
			get: (id) => (id === "bala" ? bala : null),
			find: (fn) => [bala].find(fn) ?? null,
			filter: (fn) => [bala].filter(fn),
		};
		try {
			const actor = makeSteadingActor({
				steadingFlags: { neighbors: [{ uuid: "Actor.bala", id: "bala", name: "Bala" }] },
			});
			const snapshot = await new StonetopSteading(actor).buildSnapshot();

			expect(snapshot.neighbors[0].profileImg).toBe("systems/stonetop-pwd/assets/icons/people/empty_profile.svg");
		} finally {
			game.actors = prevActors;
		}
	});

	describe("improvement categories", () => {
		it("files every built-in under exactly one of the three categories", () => {
			const keys = new Set(IMPROVEMENT_CATEGORIES.map(c => c.key));
			expect([...keys]).toEqual(["hearth", "renown", "wall"]);

			const bucketed = {};
			for (const def of IMPROVEMENT_DEFINITIONS) {
				expect(keys.has(def.category), `${def.slug} has no valid category`).toBe(true);
				(bucketed[def.category] ??= []).push(def.slug);
			}
			expect(bucketed.hearth).toEqual([
				"additionalHousing", "aurochsHunting", "greaterHarvest", "harnessingStream",
				"herdOfHorses", "mill", "raincatching",
			]);
			expect(bucketed.renown).toEqual(["expandedTrades", "heroicReputation", "inn", "market", "township"]);
			expect(bucketed.wall).toEqual([
				"palisade", "standingWatch", "stoneWall", "weaponsOfWar", "wellTrainedMilitia",
			]);
		});

		// The heading is prose and `min` is the rule, and nothing makes them agree. The first
		// printing shipped Harnessing the Stream as "Requires 2 of the following" over three
		// items, and the errata rewrote it to 1 of 2 — a change that is only half made if the
		// heading moves and `min` does not. So the number a heading SAYS is checked against the
		// number the tick check actually enforces, for every built-in that names one.
		it("makes each 'Requires N of the following' heading match what the section enforces", () => {
			const named = [];
			for (const def of IMPROVEMENT_DEFINITIONS) {
				for (const section of def.sections ?? []) {
					const m = /^(?:Requires|And) (\d+) of the following/.exec(section.heading ?? "");
					if (!m) continue;
					named.push(def.slug);
					expect(sectionRequiredCount(section), `${def.slug}: "${section.heading}"`).toBe(Number(m[1]));
				}
			}
			// A guard that matched nothing would pass forever; these are the ones that say a number.
			expect(named).toEqual([
				"aurochsHunting", "greaterHarvest", "harnessingStream", "market", "wellTrainedMilitia",
			]);
		});

		it("puts every Fortifications-granting improvement in wall, and no other", () => {
			// The wall bucket is meant to be exactly the Fortifications list, so a future
			// improvement that adds one can't be quietly filed elsewhere.
			const fortifying = Object.entries(IMPROVEMENT_GRANTS)
				.filter(([, g]) => g.fortifications?.length)
				.map(([slug]) => slug);
			for (const slug of fortifying) {
				expect(IMPROVEMENT_DEFINITIONS.find(d => d.slug === slug).category).toBe("wall");
			}
		});

		it("carries the category through to the snapshot", async () => {
			const snapshot = await new StonetopSteading(makeSteadingActor()).buildSnapshot();
			const bySlug = Object.fromEntries(snapshot.improvements.map(i => [i.slug, i.category]));
			expect(bySlug.raincatching).toBe("hearth");
			expect(bySlug.market).toBe("renown");
			expect(bySlug.stoneWall).toBe("wall");
		});
	});

	describe("custom (journal-sourced) improvements", () => {
		function makeMutableSteadingActor(steadingFlags = {}) {
			const actor = {
				type: "stonetop",
				system: {},
				flags: { stonetop: { steading: steadingFlags } },
				getFlag: (scope, key) => (key === "steading" ? actor.flags.stonetop.steading : null),
				setFlag: vi.fn((scope, key, value) => { actor.flags.stonetop.steading = value; return Promise.resolve(); }),
				update: vi.fn(),
			};
			return actor;
		}

		const roadbuilding = {
			name: "ROADBUILDING",
			flavor: "",
			effect: "When you mark all the requirements, you can repair the Roads.",
			sections: [{ heading: "Requires all of the following:", items: ["Unlock the runes", "Recruit a crew"] }],
		};

		it("adds a dropped improvement and surfaces it in the snapshot as custom", async () => {
			const actor = makeMutableSteadingActor();
			const steading = new StonetopSteading(actor);

			const result = await steading.addCustomImprovement(roadbuilding);
			expect(result).toMatchObject({ ok: true, slug: "custom-roadbuilding", label: "ROADBUILDING" });

			const snapshot = await steading.buildSnapshot();
			const added = snapshot.improvements.find(i => i.slug === "custom-roadbuilding");
			expect(added).toBeTruthy();
			expect(added.custom).toBe(true);
			expect(added.label).toBe("ROADBUILDING");
			expect(added.sections[0].items.map(i => i.label)).toEqual(["Unlock the runes", "Recruit a crew"]);
			// Built-ins are still present and flagged non-custom.
			expect(snapshot.improvements.find(i => i.slug === "palisade").custom).toBe(false);
		});

		it("keeps a valid category and blanks anything else, so a bad one can't hide the card", async () => {
			const add = async (category) => {
				const steading = new StonetopSteading(makeMutableSteadingActor());
				await steading.addCustomImprovement({ ...roadbuilding, category });
				const snapshot = await steading.buildSnapshot();
				return snapshot.improvements.find(i => i.slug === "custom-roadbuilding").category;
			};
			expect(await add("wall")).toBe("wall");
			expect(await add("nonsense")).toBe("");
			// A card dropped from the book's journals carries no category at all.
			expect(await add(undefined)).toBe("");
		});

		it("refuses a duplicate name (existing custom or built-in label) and an empty name", async () => {
			const actor = makeMutableSteadingActor({ customImprovements: [
				{ slug: "custom-roadbuilding", label: "ROADBUILDING", flavor: "", sections: [], effect: "" },
			] });
			const steading = new StonetopSteading(actor);

			expect(await steading.addCustomImprovement(roadbuilding)).toMatchObject({ ok: false, reason: "duplicate" });
			expect(await steading.addCustomImprovement({ name: "Palisade" })).toMatchObject({ ok: false, reason: "duplicate" });
			expect(await steading.addCustomImprovement({ name: "   " })).toMatchObject({ ok: false, reason: "empty" });
		});

		it("tracks requirement/completion state for a custom improvement by its slug", async () => {
			const actor = makeMutableSteadingActor({
				customImprovements: [{ slug: "custom-roadbuilding", label: "ROADBUILDING", flavor: "", effect: "",
					sections: [{ heading: "Requires:", items: ["Unlock the runes", "Recruit a crew"] }] }],
				improvements: { "custom-roadbuilding": { completed: false, r: [true, false] } },
			});
			const snapshot = await new StonetopSteading(actor).buildSnapshot();
			const added = snapshot.improvements.find(i => i.slug === "custom-roadbuilding");
			expect(added.earned).toBe(true);
			expect(added.sections[0].items[0].checked).toBe(true);
			expect(added.sections[0].items[1].checked).toBe(false);
		});

		it("removes a custom improvement and clears its tracking state", async () => {
			const actor = makeMutableSteadingActor({
				customImprovements: [{ slug: "custom-roadbuilding", label: "ROADBUILDING", flavor: "", effect: "", sections: [] }],
				improvements: { "custom-roadbuilding": { completed: true, r: [] }, palisade: { completed: true, r: [] } },
			});
			const steading = new StonetopSteading(actor);

			expect(await steading.removeCustomImprovement("custom-roadbuilding"))
				.toMatchObject({ label: "ROADBUILDING", reverted: [] });
			expect(actor.flags.stonetop.steading.customImprovements).toEqual([]);
			expect(actor.flags.stonetop.steading.improvements).toEqual({ palisade: { completed: true, r: [] } });
			// Removing an unknown slug is a no-op.
			expect(await steading.removeCustomImprovement("custom-nope")).toBe(false);
		});

		// Editing in place, rather than copy-fix-remove: that lost every ticked step and left
		// a moment where the steading held two of the thing.
		describe("editing one in place", () => {
			const roadbuilding = {
				slug: "custom-roadbuilding", label: "Roadbuilding", category: "renown",
				flavor: "The mud takes a wagon a week.", effect: "Increase Prosperity by 1.",
				sections: [{ heading: "Requires all of the following:", items: ["A surveyor", "Gravel"] }],
				grants: { stats: { prosperity: 1 } },
			};
			const edited = { ...roadbuilding, name: "Roadbuilding" };
			const withRoad = (improvements = {}) => makeMutableSteadingActor({
				customImprovements: [foundry.utils.deepClone(roadbuilding)],
				improvements,
			});

			it("rewrites it without minting a new one", async () => {
				const actor = withRoad();
				const result = await new StonetopSteading(actor).updateCustomImprovement("custom-roadbuilding", {
					...edited, flavor: "Two days, in the wet.", effect: "Increase Prosperity by 2.",
				});

				expect(result).toMatchObject({ ok: true, slug: "custom-roadbuilding", label: "Roadbuilding" });
				const stored = actor.flags.stonetop.steading.customImprovements;
				expect(stored).toHaveLength(1);
				expect(stored[0].flavor).toBe("Two days, in the wet.");
			});

			// The slug is an id, not a name: the ticked steps, the applied-grants record and
			// season-effects' own rules are all keyed by it, and none survive being re-keyed.
			it("keeps the slug across a rename, so the ticked steps stay attached", async () => {
				const actor = withRoad({ "custom-roadbuilding": { completed: false, r: [true, false] } });
				const result = await new StonetopSteading(actor).updateCustomImprovement(
					"custom-roadbuilding", { ...edited, name: "The Maker's Roads" });

				expect(result).toMatchObject({ ok: true, slug: "custom-roadbuilding", label: "The Maker's Roads" });
				expect(actor.flags.stonetop.steading.customImprovements[0].slug).toBe("custom-roadbuilding");
				expect(actor.flags.stonetop.steading.improvements["custom-roadbuilding"].r).toEqual([true, false]);
			});

			it("carries a ticked step across an insertion rather than sliding it", async () => {
				const actor = withRoad({ "custom-roadbuilding": { completed: false, r: [false, true] } });
				await new StonetopSteading(actor).updateCustomImprovement("custom-roadbuilding", {
					...edited,
					sections: [{ heading: "Requires all of the following:", items: ["A charter", "A surveyor", "Gravel"] }],
				});

				// Gravel was the ticked one, and still is; the new first step starts unticked.
				expect(actor.flags.stonetop.steading.improvements["custom-roadbuilding"].r)
					.toEqual([false, false, true]);
			});

			it("refuses a rename onto another improvement's name, but not onto its own", async () => {
				const steading = new StonetopSteading(withRoad());
				await expect(steading.updateCustomImprovement("custom-roadbuilding", { ...edited, name: "Palisade" }))
					.resolves.toMatchObject({ ok: false, reason: "duplicate" });
				// Its own name is not a clash with itself, however it is punctuated.
				await expect(steading.updateCustomImprovement("custom-roadbuilding", { ...edited, name: "Roadbuilding!" }))
					.resolves.toMatchObject({ ok: true });
			});

			it("refuses an empty name and an improvement that is no longer there", async () => {
				const steading = new StonetopSteading(withRoad());
				await expect(steading.updateCustomImprovement("custom-roadbuilding", { ...edited, name: "  " }))
					.resolves.toMatchObject({ ok: false, reason: "empty" });
				await expect(steading.updateCustomImprovement("custom-nope", edited))
					.resolves.toMatchObject({ ok: false, reason: "missing" });
			});

			// `applied` records what completing it DID, and un-completing has to reverse that.
			// Editing the grants of a completed improvement must not rewrite history, and must
			// not silently move stats either; the caller is told so it can say as much.
			it("leaves what completion already applied alone when the grants are edited", async () => {
				const actor = withRoad({
					"custom-roadbuilding": { completed: true, r: [true, true], applied: { stats: { prosperity: 1 } } },
				});
				const result = await new StonetopSteading(actor).updateCustomImprovement("custom-roadbuilding", {
					...edited, grants: { stats: { prosperity: 3 } },
				});

				expect(result).toMatchObject({ grantsChanged: true, completed: true, structureChanged: false });
				expect(actor.flags.stonetop.steading.improvements["custom-roadbuilding"].applied)
					.toEqual({ stats: { prosperity: 1 } });
				expect(actor.update).not.toHaveBeenCalled();
			});
		});

		// A completed improvement's grants are recorded so un-completing can reverse them
		// exactly. Removing it used to delete that record WITHOUT reversing anything, so the
		// +1 Fortunes and the Fortifications entry stayed on the steading with nothing left to
		// explain them and no way to take them back.
		it("gives back what completing it applied, rather than orphaning it", async () => {
			const actor = makeMutableSteadingActor({
				customImprovements: [{
					slug: "custom-palisade-homebrew", label: "Palisade (homebrew)", flavor: "", effect: "",
					sections: [], grants: { stats: { fortunes: 1 }, fortifications: ["Palisade (homebrew)"] },
				}],
				improvements: {
					"custom-palisade-homebrew": {
						completed: true,
						r: [],
						applied: { stats: { fortunes: 1 }, fortifications: ["Palisade (homebrew)"] },
					},
				},
				system: { stats: { fortunes: { value: 2 } } },
				fortifications: [{ name: "Palisade (homebrew)", checked: true }],
			});
			const steading = new StonetopSteading(actor);

			const result = await steading.removeCustomImprovement("custom-palisade-homebrew");
			// The summary names what completing it APPLIED (the sheet puts "Reverted:" in front).
			expect(result.reverted).toEqual(["Fortunes +1", "Fortifications +Palisade (homebrew)"]);

			// The reversal itself, read off the update payload: this fake's `update` is a spy
			// that applies nothing, so the stat has to be checked where it is written. Both the
			// system value and its flag mirror, as every grant write does.
			const payload = actor.update.mock.calls.at(-1)[0];
			expect(payload["system.stats.fortunes.value"]).toBe(1);
			expect(payload["flags.stonetop-pwd.steading.system.stats.fortunes.value"]).toBe(1);
			expect(payload["flags.stonetop-pwd.steading.fortifications"])
				.not.toContainEqual(expect.objectContaining({ name: "Palisade (homebrew)" }));

			// And the definition and its tracking entry are gone.
			expect(actor.flags.stonetop.steading.customImprovements).toEqual([]);
			expect(actor.flags.stonetop.steading.improvements).toEqual({});
		});
	});

	describe("improvement grants (auto-applied effects)", () => {
		const lastUpdate = (actor) => actor.update.mock.calls.at(-1)[0];

		it("applies Raincatching's fortunes bump and resource on completion, recording what changed", async () => {
			const actor = makeSteadingActor({
				steadingFlags: {
					system: { stats: { fortunes: { value: 1 } } },
					resources: [{ name: "Farming", checked: true }, { name: "", checked: false }],
				},
			});
			const result = await new StonetopSteading(actor).setImprovementCompleted("raincatching", true);

			const data = lastUpdate(actor);
			expect(data["system.stats.fortunes.value"]).toBe(2);
			expect(data["flags.stonetop-pwd.steading.system.stats.fortunes.value"]).toBe(2);
			expect(data["flags.stonetop-pwd.steading.resources"]).toEqual([
				{ name: "Farming", checked: true },
				{ name: "Raincatching", checked: true },
			]);
			const imps = data["flags.stonetop-pwd.steading.improvements"];
			expect(imps.raincatching.completed).toBe(true);
			expect(imps.raincatching.applied).toEqual({ stats: { fortunes: 1 }, resources: ["Raincatching"] });
			expect(result).toMatchObject({ label: "Raincatching", reverted: false });
			expect(result.summary).toContain("Fortunes +1");
			expect(result.summary).toContain("Resources +Raincatching");
		});

		it("reverses the recorded grant when un-completed: negates the stat and drops the resource", async () => {
			const actor = makeSteadingActor({
				steadingFlags: {
					system: { stats: { fortunes: { value: 2 } } },
					resources: [{ name: "Farming", checked: true }, { name: "Raincatching", checked: true }],
					improvements: { raincatching: { completed: true, r: [true, true, true, true, true],
						applied: { stats: { fortunes: 1 }, resources: ["Raincatching"] } } },
				},
			});
			const result = await new StonetopSteading(actor).setImprovementCompleted("raincatching", false);

			const data = lastUpdate(actor);
			expect(data["system.stats.fortunes.value"]).toBe(1);
			expect(data["flags.stonetop-pwd.steading.resources"]).toEqual([
				{ name: "Farming", checked: true },
				{ name: "", checked: false },
			]);
			const imps = data["flags.stonetop-pwd.steading.improvements"];
			expect(imps.raincatching.completed).toBe(false);
			expect(imps.raincatching.applied).toBeNull();
			expect(result.reverted).toBe(true);
		});

		it("does not double-apply when an already-applied improvement is completed again", async () => {
			const actor = makeSteadingActor({
				steadingFlags: {
					system: { stats: { fortunes: { value: 2 } } },
					resources: [{ name: "Farming", checked: true }, { name: "Raincatching", checked: true }],
					improvements: { raincatching: { completed: true, r: [],
						applied: { stats: { fortunes: 1 }, resources: ["Raincatching"] } } },
				},
			});
			await new StonetopSteading(actor).setImprovementCompleted("raincatching", true);

			// Only the improvements map is rewritten — no fresh stat/list changes.
			expect(Object.keys(lastUpdate(actor))).toEqual(["flags.stonetop-pwd.steading.improvements"]);
		});

		it("does not duplicate a resource that is already present, recording nothing to revert for it", async () => {
			const actor = makeSteadingActor({
				steadingFlags: {
					system: { stats: { fortunes: { value: 1 } } },
					resources: [{ name: "Raincatching", checked: true }, { name: "", checked: false }],
				},
			});
			await new StonetopSteading(actor).setImprovementCompleted("raincatching", true);

			const data = lastUpdate(actor);
			expect(data["system.stats.fortunes.value"]).toBe(2);                                   // fortunes still bumps
			expect(Object.keys(data)).not.toContain("flags.stonetop-pwd.steading.resources");       // list untouched
			expect(data["flags.stonetop-pwd.steading.improvements"].raincatching.applied)
				.toEqual({ stats: { fortunes: 1 } });                                              // no resource recorded
		});

		it("back-fills a pre-engine completion's full grant so un-completing drops an already-present resource", async () => {
			// Legacy world: Raincatching was completed under a version before this engine, so its
			// entry is {completed:true} with NO `applied`, and its book effect (Fortunes +1, the
			// Raincatching resource) was applied by hand. Un-completing must reverse BOTH — not just
			// the stat while orphaning the resource.
			const actor = makeSteadingActor({
				steadingFlags: {
					system: { stats: { fortunes: { value: 2 } } },
					resources: [{ name: "Raincatching", checked: true }, { name: "", checked: false }],
					improvements: { raincatching: { completed: true, r: [] } },
				},
			});
			const result = await new StonetopSteading(actor).setImprovementCompleted("raincatching", false);

			const data = lastUpdate(actor);
			expect(data["system.stats.fortunes.value"]).toBe(1);                       // stat reversed
			expect(data["flags.stonetop-pwd.steading.resources"]).toEqual([
				{ name: "", checked: false },                                          // Raincatching dropped
				{ name: "", checked: false },
			]);
			expect(result.reverted).toBe(true);
			expect(data["flags.stonetop-pwd.steading.improvements"].raincatching.applied).toBeNull();
		});

		it("back-fill claims no reversal for a legacy Township already at its target size", async () => {
			// Size/Population are unknowable once the steading already sits at the grant's target
			// (hand-applied under the old version), so the back-fill records nothing reversible and
			// must not falsely report a reversal or fabricate a prior size.
			const actor = makeSteadingActor({
				steadingFlags: {
					size: "town",
					system: { attributes: { population: { value: 0 } } },
					improvements: { township: { completed: true, r: [] } },
				},
			});
			const result = await new StonetopSteading(actor).setImprovementCompleted("township", false);

			const data = lastUpdate(actor);
			expect(data["flags.stonetop-pwd.steading.size"]).toBeUndefined();          // size left intact
			expect(result.reverted).toBe(false);
			expect(data["flags.stonetop-pwd.steading.improvements"].township.applied).toBeNull();
		});

		it("Township sets Size and Population, recording their prior values for reversal", async () => {
			const actor = makeSteadingActor({
				steadingFlags: { size: "village", system: { attributes: { population: { value: 3 } } } },
			});
			await new StonetopSteading(actor).setImprovementCompleted("township", true);

			const data = lastUpdate(actor);
			expect(data["flags.stonetop-pwd.steading.size"]).toBe("town");
			expect(data["system.attributes.population.value"]).toBe(0);
			expect(data["flags.stonetop-pwd.steading.improvements"].township.applied).toEqual({
				setSize: { from: "village", to: "town" },
				setPopulation: { from: 3, to: 0 },
			});
		});

		it("Stone Wall adds its fortification and erases an existing Palisade, recording it for restoration", async () => {
			const fortifications = [
				{ name: "Village militia", checked: true },
				{ name: "Palisade", checked: true },
				{ name: "", checked: false },
			];
			const actor = makeSteadingActor({ steadingFlags: { fortifications } });
			await new StonetopSteading(actor).setImprovementCompleted("stoneWall", true);

			const data = lastUpdate(actor);
			expect(data["flags.stonetop-pwd.steading.fortifications"]).toEqual([
				{ name: "Village militia", checked: true },
				{ name: "", checked: false },           // Palisade slot cleared
				{ name: "Stone Wall", checked: true },  // filled the trailing empty slot
			]);
			const applied = data["flags.stonetop-pwd.steading.improvements"].stoneWall.applied;
			expect(applied.fortifications).toEqual(["Stone Wall"]);
			expect(applied.removedFortifications).toEqual([{ name: "Palisade", checked: true }]);
		});

		it("leaves an improvement with no defined grants as a plain completion toggle", async () => {
			const actor = makeSteadingActor({});
			const result = await new StonetopSteading(actor).setImprovementCompleted("heroicReputation", true);

			const data = lastUpdate(actor);
			expect(Object.keys(data)).toEqual(["flags.stonetop-pwd.steading.improvements"]);
			expect(data["flags.stonetop-pwd.steading.improvements"].heroicReputation).toEqual({ completed: true, r: [] });
			expect(result.summary).toEqual([]);
		});

		it("force-completes: fills every requirement step and still applies the grant", async () => {
			const actor = makeSteadingActor({
				steadingFlags: { system: { stats: { fortunes: { value: 1 } } }, resources: [{ name: "", checked: false }] },
			});
			await new StonetopSteading(actor)
				.setImprovementCompleted("raincatching", true, { forceR: [true, true, true, true, true] });

			const data = lastUpdate(actor);
			const imp = data["flags.stonetop-pwd.steading.improvements"].raincatching;
			expect(imp.completed).toBe(true);
			expect(imp.r).toEqual([true, true, true, true, true]);
			expect(data["system.stats.fortunes.value"]).toBe(2);
		});
	});

	describe("legacy improvements completed before the grants engine", () => {
		it("back-fills `applied` so an uncheck reverts exactly once instead of double-counting the stat", async () => {
			// A world completed under the pre-grants version stores {completed:true, r:[…]} with
			// no `applied`, and the book's +1 Fortunes was applied by hand (Fortunes sits at 2).
			const actor = makeSteadingActor({ steadingFlags: {
				system: { stats: { fortunes: { value: 2 } } },
				resources: [{ name: "Raincatching", checked: true }, { name: "", checked: false }],
				improvements: { raincatching: { completed: true, r: [] } },
			} });

			const result = await new StonetopSteading(actor).setImprovementCompleted("raincatching", false);

			const data = actor.update.mock.calls.at(-1)[0];
			expect(data["system.stats.fortunes.value"]).toBe(1);   // reverses once — not left at 2, not pushed to 3
			expect(data["flags.stonetop-pwd.steading.improvements"].raincatching.applied).toBeNull();
			expect(result.reverted).toBe(true);
		});

		it("does not disturb a fresh (never-completed) improvement", async () => {
			const actor = makeSteadingActor({ steadingFlags: { system: { stats: { fortunes: { value: 1 } } } } });
			await new StonetopSteading(actor).setImprovementCompleted("raincatching", true);
			const data = actor.update.mock.calls.at(-1)[0];
			// Normal fresh completion still applies the grant and records it.
			expect(data["system.stats.fortunes.value"]).toBe(2);
			expect(data["flags.stonetop-pwd.steading.improvements"].raincatching.applied).toEqual({ stats: { fortunes: 1 }, resources: ["Raincatching"] });
		});
	});

	describe("Herd of Horses tracker", () => {
		const lastUpdate = (actor) => actor.update.mock.calls.at(-1)[0];

		it("defaults an un-tracked herd to the book's starting dozen", () => {
			expect(new StonetopSteading(makeSteadingActor()).getHerd())
				.toEqual({ grown: 12, yearlings: 0, foals: 0, total: 12 });
		});

		it("reads and normalizes stored herd tiers", () => {
			const actor = makeSteadingActor({ steadingFlags: { herd: { grown: 8, yearlings: 3, foals: "2" } } });
			expect(new StonetopSteading(actor).getHerd()).toEqual({ grown: 8, yearlings: 3, foals: 2, total: 13 });
		});

		it("setHerd clamps negatives/decimals and writes the herd flag", async () => {
			const actor = makeSteadingActor();
			const res = await new StonetopSteading(actor).setHerd({ grown: -4, yearlings: 2.9, foals: 1 });
			expect(actor.update).toHaveBeenCalledWith(
				{ "flags.stonetop-pwd.steading.herd": { grown: 0, yearlings: 2, foals: 1 } }, {});
			expect(res).toEqual({ grown: 0, yearlings: 2, foals: 1, total: 3 });
		});

		it("seeds a starting herd when Herd of Horses is first completed, alongside its grant", async () => {
			const actor = makeSteadingActor({ steadingFlags: { system: { stats: { fortunes: { value: 1 } } } } });
			await new StonetopSteading(actor).setImprovementCompleted("herdOfHorses", true);
			const data = lastUpdate(actor);
			expect(data["flags.stonetop-pwd.steading.herd"]).toEqual({ grown: 12, yearlings: 0, foals: 0 });
			expect(data["system.stats.fortunes.value"]).toBe(2);
		});

		it("does not reseed an existing herd on re-completion", async () => {
			const actor = makeSteadingActor({ steadingFlags: {
				herd: { grown: 5, yearlings: 0, foals: 0 },
				system: { stats: { fortunes: { value: 1 } } },
			} });
			await new StonetopSteading(actor).setImprovementCompleted("herdOfHorses", true);
			expect(Object.keys(lastUpdate(actor))).not.toContain("flags.stonetop-pwd.steading.herd");
		});

		it("never removes the herd when the improvement is un-completed", async () => {
			const actor = makeSteadingActor({ steadingFlags: {
				herd: { grown: 5, yearlings: 1, foals: 0 },
				system: { stats: { fortunes: { value: 2 } } },
				improvements: { herdOfHorses: { completed: true, r: [], applied: { stats: { fortunes: 1 } } } },
			} });
			await new StonetopSteading(actor).setImprovementCompleted("herdOfHorses", false);
			expect(Object.keys(lastUpdate(actor))).not.toContain("flags.stonetop-pwd.steading.herd");
		});

		it("exposes the herd view on the Herd of Horses card only once completed", async () => {
			const incomplete = await new StonetopSteading(makeSteadingActor()).buildSnapshot();
			expect(incomplete.improvements.find(i => i.slug === "herdOfHorses").herd).toBeNull();

			const actor = makeSteadingActor({ steadingFlags: {
				improvements: { herdOfHorses: { completed: true, r: [] } },
				herd: { grown: 6, yearlings: 2, foals: 1 },
			} });
			const snap = await new StonetopSteading(actor).buildSnapshot();
			const view = snap.improvements.find(i => i.slug === "herdOfHorses").herd;
			expect(view.total).toBe(9);
			expect(view.tiers.map(t => [t.key, t.count])).toEqual([["grown", 6], ["yearlings", 2], ["foals", 1]]);
		});

		describe("season math (pure)", () => {
			it("summer promotes each tier up and sets the rolled foals", () => {
				expect(StonetopSteading.advanceHerdForSummer({ grown: 10, yearlings: 3, foals: 2 }, 4))
					.toEqual({ grown: 13, yearlings: 2, foals: 4 });
			});

			it("summer floors a negative foal roll to zero", () => {
				expect(StonetopSteading.advanceHerdForSummer({ grown: 0, yearlings: 0, foals: 0 }, -2))
					.toEqual({ grown: 0, yearlings: 0, foals: 0 });
			});

			it("winter feeds off grown+yearlings at 1 Surplus per 6, no loss when Surplus covers it", () => {
				const r = StonetopSteading.feedHerdForWinter({ grown: 12, yearlings: 6, foals: 3 }, 5, 0);
				expect(r).toMatchObject({ cost: 3, paid: 3, shortfall: 0, lost: 0 });
				expect(r.herd).toEqual({ grown: 12, yearlings: 6, foals: 3 });
			});

			it("winter shortfall removes rolled losses oldest-tier-first", () => {
				// cost=2 ((4+8)/6), Surplus 1 → 1 short; losses (pre-rolled) = 5 removed from grown then yearlings.
				const r = StonetopSteading.feedHerdForWinter({ grown: 4, yearlings: 8, foals: 2 }, 1, 5);
				expect(r).toMatchObject({ cost: 2, paid: 1, shortfall: 1, lost: 5 });
				expect(r.herd).toEqual({ grown: 0, yearlings: 7, foals: 2 });
			});

			it("winter costs nothing when there are fewer than 6 grown/yearlings", () => {
				const r = StonetopSteading.feedHerdForWinter({ grown: 5, yearlings: 0, foals: 0 }, 0, 0);
				expect(r).toMatchObject({ cost: 0, paid: 0, lost: 0 });
			});

			it("winter caps losses at the herd size", () => {
				const r = StonetopSteading.feedHerdForWinter({ grown: 6, yearlings: 0, foals: 0 }, 0, 99);
				expect(r.herd).toEqual({ grown: 0, yearlings: 0, foals: 0 });
				expect(r.lost).toBe(6);
			});
		});
	});

	describe("requisition assets", () => {
		function makeAssetActor(assets) {
			const actor = {
				type: "stonetop",
				system: {},
				flags: { stonetop: { steading: { assets } } },
				getFlag: (scope, key) => (key === "steading" ? actor.flags.stonetop.steading : null),
				setFlag: vi.fn((scope, key, value) => { actor.flags.stonetop.steading = value; }),
				update: vi.fn(),
			};
			return actor;
		}

		it("marks an asset taken: unchecks it and records who took it, leaving others untouched", async () => {
			const actor = makeAssetActor([
				{ name: "Horses", checked: true },
				{ name: "Wagon", checked: true },
			]);
			const steading = new StonetopSteading(actor);

			const ok = await steading.setAssetTaken(0, { name: "Wren", id: "hero1" });

			expect(ok).toBe(true);
			expect(actor.flags.stonetop.steading.assets).toEqual([
				{ name: "Horses", checked: false, takenBy: { name: "Wren", id: "hero1" } },
				{ name: "Wagon", checked: true },
			]);
		});

		it("refuses to take an empty (nameless) asset slot", async () => {
			const actor = makeAssetActor([{ name: "", checked: false }]);
			const steading = new StonetopSteading(actor);

			expect(await steading.setAssetTaken(0, { name: "Wren", id: "hero1" })).toBe(false);
			expect(await steading.setAssetTaken(5, { name: "Wren", id: "hero1" })).toBe(false);
			expect(actor.setFlag).not.toHaveBeenCalled();
		});

		it("returns a taken asset: re-checks it and clears the taken-by note", async () => {
			const actor = makeAssetActor([
				{ name: "Horses", checked: false, takenBy: { name: "Wren", id: "hero1" } },
			]);
			const steading = new StonetopSteading(actor);

			const ok = await steading.returnAsset(0);

			expect(ok).toBe(true);
			expect(actor.flags.stonetop.steading.assets).toEqual([{ name: "Horses", checked: true }]);
		});

		it("lists only named, on-hand assets as available", () => {
			const actor = makeAssetActor([
				{ name: "Horses", checked: true },
				{ name: "Wagon", checked: false, takenBy: { name: "Wren", id: "hero1" } },
				{ name: "", checked: false },
			]);

			expect(new StonetopSteading(actor).getAvailableAssets()).toEqual([
				{ name: "Horses", checked: true, index: 0 },
			]);
		});

		// The walkthrough's Requisition step sends assets out in the name of a TRIP rather than a
		// character, so the steading can answer "where did the wagon go?" months later. It reads
		// its own list back off the steading (not off its notes), because the steading is where
		// an asset actually is: returning one from the sheet has to show there as returned.
		it("marks an asset taken by an expedition, not only by a person", async () => {
			const actor = makeAssetActor([{ name: "Wagon", checked: true }]);
			const steading = new StonetopSteading(actor);

			const trip = { id: "trip-1", title: "The Wandering Tower" };
			expect(await steading.setAssetTaken(0, { expedition: trip })).toBe(true);

			expect(actor.flags.stonetop.steading.assets).toEqual([
				{ name: "Wagon", checked: false, takenBy: { expedition: trip } },
			]);
		});

		it("lists what one expedition is holding, and nothing another trip took", () => {
			const actor = makeAssetActor([
				{ name: "Horses", checked: true },
				{ name: "Wagon", checked: false, takenBy: { expedition: { id: "trip-1", title: "A" } } },
				{ name: "Plow",  checked: false, takenBy: { expedition: { id: "trip-2", title: "B" } } },
				{ name: "Cart",  checked: false, takenBy: { name: "Wren", id: "hero1" } },
				{ name: "", checked: false },
			]);
			const steading = new StonetopSteading(actor);

			expect(steading.getAssetsOnExpedition("trip-1").map(a => a.name)).toEqual(["Wagon"]);
			expect(steading.getAssetsOnExpedition("trip-2").map(a => a.name)).toEqual(["Plow"]);
			// No trip id means no claim on anything, NOT "everything out on loan".
			expect(steading.getAssetsOnExpedition(null)).toEqual([]);
			expect(steading.getAssetsOnExpedition("nobodys-trip")).toEqual([]);
		});

		it("lists every named asset with its index, on hand or out", () => {
			const actor = makeAssetActor([
				{ name: "Horses", checked: true },
				{ name: "", checked: false },
				{ name: "Wagon", checked: false, takenBy: { name: "Wren", id: "hero1" } },
			]);

			// The index is the position in the STORED list, so a blank slot in the middle does not
			// shift the index a click on "Wagon" sends back.
			expect(new StonetopSteading(actor).getNamedAssets().map(a => ({ name: a.name, index: a.index })))
				.toEqual([{ name: "Horses", index: 0 }, { name: "Wagon", index: 2 }]);
		});

		// The trip's name is COPIED onto the asset so the steading sheet can name it without
		// reading the walkthrough's world setting. Renaming the trip has to carry across, or the
		// tooltip goes on naming a trip the switcher no longer calls that.
		it("re-labels what a renamed trip is holding, and leaves everything else alone", async () => {
			const actor = makeAssetActor([
				{ name: "Wagon", checked: false, takenBy: { expedition: { id: "trip-1", title: "Expedition 1" } } },
				{ name: "Plow",  checked: false, takenBy: { expedition: { id: "trip-2", title: "Expedition 2" } } },
				{ name: "Cart",  checked: false, takenBy: { name: "Wren", id: "hero1" } },
				{ name: "Horses", checked: true },
			]);
			const steading = new StonetopSteading(actor);

			expect(await steading.reconcileHeldAssets(new Map([
				["trip-1", "The Wandering Tower"], ["trip-2", "Expedition 2"],
			]))).toBe(1);

			expect(actor.flags.stonetop.steading.assets).toEqual([
				{ name: "Wagon", checked: false, takenBy: { expedition: { id: "trip-1", title: "The Wandering Tower" } } },
				{ name: "Plow",  checked: false, takenBy: { expedition: { id: "trip-2", title: "Expedition 2" } } },
				{ name: "Cart",  checked: false, takenBy: { name: "Wren", id: "hero1" } },
				{ name: "Horses", checked: true },
			]);
		});

		// A deleted trip is holding nothing. Left tagged, the wagon sits struck through on the
		// sheet against a trip the switcher cannot show and the walkthrough cannot return it from.
		it("sends home whatever a trip that is no longer in the log was holding", async () => {
			const actor = makeAssetActor([
				{ name: "Wagon", checked: false, takenBy: { expedition: { id: "gone", title: "Expedition 1" } } },
				{ name: "Plow",  checked: false, takenBy: { expedition: { id: "trip-2", title: "Expedition 1" } } },
				{ name: "Cart",  checked: false, takenBy: { name: "Wren", id: "hero1" } },
			]);
			const steading = new StonetopSteading(actor);

			// Deleting the first trip renumbered the second, so this is both cases at once.
			expect(await steading.reconcileHeldAssets(new Map([["trip-2", "Expedition 1"]]))).toBe(1);
			expect(actor.flags.stonetop.steading.assets).toEqual([
				{ name: "Wagon", checked: true },
				{ name: "Plow",  checked: false, takenBy: { expedition: { id: "trip-2", title: "Expedition 1" } } },
				// A person is not a trip: an asset out with a character is never touched here.
				{ name: "Cart",  checked: false, takenBy: { name: "Wren", id: "hero1" } },
			]);
		});

		it("writes nothing when everything already agrees", async () => {
			const actor = makeAssetActor([
				{ name: "Wagon", checked: false, takenBy: { expedition: { id: "trip-1", title: "The Wandering Tower" } } },
				{ name: "Cart",  checked: false, takenBy: { name: "Wren", id: "hero1" } },
				{ name: "Horses", checked: true },
			]);
			const steading = new StonetopSteading(actor);

			expect(await steading.reconcileHeldAssets(new Map([["trip-1", "The Wandering Tower"]]))).toBe(0);
			expect(actor.setFlag).not.toHaveBeenCalled();
		});
	});
});
