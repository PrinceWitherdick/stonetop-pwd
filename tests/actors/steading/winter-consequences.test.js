import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	followUpWinterConsequence, offerLackingForLostResource, markNpcDeadForWinter, livingNpcs, sufferWinterShortfall,
	offerRetireForWinter, WINTER_NPC_DEAD_QUERY, handleWinterNpcDeadQuery,
} from "../../../module/actors/steading/winter-debt.js";
import { charactersInPlay } from "../../../module/utils/characters-in-play.js";

// Winter's shortfall consequences (Book I pp.517-518): after the GM narrates the one picked, what it leaves on
// the sheet is offered. A lost resource may leave the steading lacking (p.511: "Should Stonetop lose access to
// one or more of these resources for a season or so, then mark the lacking debility"); an important NPC who
// dies is marked dead; a PC who dies, leaves or retires gets a note about the epilogue (p.518).

beforeEach(() => {
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
});

function steading({ lacking = false } = {}) {
	return {
		_actor: { id: "st", name: "Stonetop" },
		getSystemValue: vi.fn((path, fallback) => (path === "attributes.debilities.options.lacking.value" ? lacking : fallback)),
		setSystemValue: vi.fn(async () => {}),
		getStatValue: vi.fn(stat => ({ fortunes: 1, population: 0, surplus: 0 }[stat] ?? 0)),
		applyChanges: vi.fn(async () => {}),
	};
}

const npc = (id, status = "") => ({ id, name: id, type: "npc", system: { status }, update: vi.fn(async () => {}) });

describe("an important resource lost", () => {
	it("marks lacking only when the GM says the loss leaves the steading lacking", async () => {
		const yes = steading();
		expect(await offerLackingForLostResource(yes, { confirm: async () => true })).toBe(true);
		expect(yes.setSystemValue).toHaveBeenCalledWith("attributes.debilities.options.lacking.value", true, { stonetopMove: "Seasons Change" });
		const no = steading();
		expect(await offerLackingForLostResource(no, { confirm: async () => false })).toBe(false);
		expect(no.setSystemValue).not.toHaveBeenCalled();
	});

	it("does not ask when the steading is already lacking", async () => {
		const confirm = vi.fn(async () => true);
		expect(await offerLackingForLostResource(steading({ lacking: true }), { confirm })).toBe(false);
		expect(confirm).not.toHaveBeenCalled();
	});
});

describe("an important NPC dies", () => {
	it("offers only the NPCs still living, and marks the one picked dead", async () => {
		const maeve = npc("Maeve");
		const gone = npc("Garet", "dead");
		const away = npc("Owain", "away");
		expect(livingNpcs([maeve, gone, away, { id: "pc", type: "character" }]).map(a => a.id)).toEqual(["Maeve", "Owain"]);
		const pick = vi.fn(async ({ options }) => {
			expect(options.map(o => o.id)).toEqual(["Maeve", "Owain"]);
			return "Maeve";
		});
		expect(await markNpcDeadForWinter({ actors: [maeve, gone, away], pick })).toBe(maeve);
		expect(maeve.update).toHaveBeenCalledWith({ "system.status": "dead" });
	});

	it("marks nobody when the chooser is closed", async () => {
		const maeve = npc("Maeve");
		expect(await markNpcDeadForWinter({ actors: [maeve], pick: async () => null })).toBeNull();
		expect(maeve.update).not.toHaveBeenCalled();
	});

	// Code review 10-22 (HC-2): a player can run the shortfall. They are offered only the NPCs they can see, and
	// one they cannot write is marked by the GM's client, or they are told who can.
	describe("for a player", () => {
		const player = { id: "p1", isGM: false };
		const seen = (id, { owner = false, visible = true } = {}) => ({
			...npc(id), isOwner: owner, testUserPermission: (_user, level) => (level === "OBSERVER" ? visible : owner),
		});

		it("offers only the NPCs they can see", () => {
			const maeve = seen("Maeve");
			const hidden = seen("Spy", { visible: false });
			expect(livingNpcs([maeve, hidden], player).map(a => a.id)).toEqual(["Maeve"]);
		});

		it("has the GM's client mark one they cannot write", async () => {
			const maeve = seen("Maeve");
			const gm = { id: "gm" };
			const ask = vi.fn(async () => ({ npcId: "Maeve" }));
			expect(await markNpcDeadForWinter({ actors: [maeve], pick: async () => "Maeve", user: player, gm, ask })).toBe(maeve);
			expect(maeve.update).not.toHaveBeenCalled();
			expect(ask).toHaveBeenCalledWith(gm, WINTER_NPC_DEAD_QUERY, { npcId: "Maeve", userId: "p1" }, expect.any(Object));
		});

		it("says who can when no GM is here, and marks nothing", async () => {
			const maeve = seen("Maeve");
			const ask = vi.fn();
			expect(await markNpcDeadForWinter({ actors: [maeve], pick: async () => "Maeve", user: player, gm: null, ask })).toBeNull();
			expect(ask).not.toHaveBeenCalled();
			expect(maeve.update).not.toHaveBeenCalled();
			expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("Only the GM can mark Maeve dead"));
		});

		it("writes one they own themselves", async () => {
			const maeve = seen("Maeve", { owner: true });
			const ask = vi.fn();
			expect(await markNpcDeadForWinter({ actors: [maeve], pick: async () => "Maeve", user: player, gm: { id: "gm" }, ask })).toBe(maeve);
			expect(maeve.update).toHaveBeenCalledWith({ "system.status": "dead" });
			expect(ask).not.toHaveBeenCalled();
		});
	});

	describe("the GM's side of the ask", () => {
		const asker = { id: "p1", isGM: false };
		const users = { get: id => (id === "p1" ? asker : null) };
		let saved;
		beforeEach(() => {
			saved = { user: globalThis.game.user, users: globalThis.game.users };
			globalThis.game.user = { id: "gm", isGM: true };
			globalThis.game.users = { activeGM: globalThis.game.user, get: users.get };
		});
		afterEach(() => { globalThis.game.user = saved.user; globalThis.game.users = saved.users; });

		const target = (status = "", visible = true) => ({
			...npc("Maeve", status), testUserPermission: (_user, level) => (level === "OBSERVER" ? visible : false),
		});
		const steadingOf = owner => ({ testUserPermission: () => owner });

		it("marks the NPC dead for an asker who can see it and runs the steading", async () => {
			const maeve = target();
			const out = await handleWinterNpcDeadQuery({ npcId: "Maeve", userId: "p1" }, {}, { users, actors: { get: () => maeve }, steading: steadingOf(true) });
			expect(out).toEqual({ npcId: "Maeve" });
			expect(maeve.update).toHaveBeenCalledWith({ "system.status": "dead" });
		});

		it("refuses an NPC the asker cannot see, one already gone, or an asker who cannot write the steading", async () => {
			for (const [maeve, owner] of [[target("", false), true], [target("dead"), true], [target(), false]]) {
				expect(await handleWinterNpcDeadQuery({ npcId: "Maeve", userId: "p1" }, {}, { users, actors: { get: () => maeve }, steading: steadingOf(owner) })).toBeNull();
				expect(maeve.update).not.toHaveBeenCalled();
			}
		});
	});
});

describe("a PC dies, leaves, or retires", () => {
	it("posts the epilogue note for the table", async () => {
		const post = vi.fn(async () => {});
		await followUpWinterConsequence(steading(), "pc", { post });
		expect(post.mock.calls[0][0].content).toContain("epilogue (page 584)");
	});

	// p.584: "Surplus runs short in winter (page 518), and the weariest PC's player has them die, leave, or retire."
	it("then asks which living PC, and opens the retire window for them", async () => {
		const pb = { playbook: { slug: "the-fox" } };
		const bram = { id: "bram", name: "Bram", type: "character", system: pb, flags: {} };
		const gone = { id: "eira", name: "Eira", type: "character", system: pb, flags: { "stonetop-pwd": { deathsDoor: "dead" } } };
		const savedActors = globalThis.game.actors;
		globalThis.game.actors = { contents: [bram, gone, { id: "n", type: "npc" }] };
		try {
			expect(charactersInPlay()).toEqual([bram]);
		} finally {
			globalThis.game.actors = savedActors;
		}
		const pick = vi.fn(async ({ options }) => options[0].id);
		const retire = vi.fn(async () => {});
		await followUpWinterConsequence(steading(), "pc", { post: vi.fn(), characters: [bram], pick, retire });
		expect(retire).toHaveBeenCalledWith(bram);
	});

	it("offers a player only the characters they may retire, and says so when there are none", async () => {
		const pb = { playbook: { slug: "the-fox" } };
		const mine = { id: "bram", name: "Bram", type: "character", system: pb, flags: {}, isOwner: true };
		const theirs = { id: "eira", name: "Eira", type: "character", system: pb, flags: {}, isOwner: false };
		const saved = { actors: globalThis.game.actors, user: globalThis.game.user };
		globalThis.game.actors = { contents: [mine, theirs] };
		globalThis.game.user = { id: "p1", isGM: false };
		try {
			const pick = vi.fn(async ({ options }) => {
				expect(options.map(o => o.id)).toEqual(["bram"]);
				return null;
			});
			await offerRetireForWinter({ pick, retire: vi.fn() });
			expect(pick).toHaveBeenCalled();
			globalThis.game.actors = { contents: [theirs] };
			const none = vi.fn();
			expect(await offerRetireForWinter({ pick: none, retire: vi.fn() })).toBe(false);
			expect(none).not.toHaveBeenCalled();
			expect(globalThis.ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("yours to retire"));
		} finally {
			globalThis.game.actors = saved.actors;
			globalThis.game.user = saved.user;
		}
	});

	it("retires nobody when the chooser is closed (the PC dies instead), or nobody is in play", async () => {
		const retire = vi.fn();
		expect(await offerRetireForWinter({ characters: [{ id: "bram", name: "Bram" }], pick: async () => null, retire })).toBe(false);
		expect(await offerRetireForWinter({ characters: [], pick: vi.fn(), retire })).toBe(false);
		expect(retire).not.toHaveBeenCalled();
	});
});

describe("the shortfall asks for it", () => {
	it("runs the follow-up for the consequence picked, after the shortfall is written", async () => {
		const s = steading();
		const followUp = vi.fn(async () => {
			expect(s.applyChanges).toHaveBeenCalled();
		});
		await sufferWinterShortfall(s, "npc", { followUp });
		expect(followUp).toHaveBeenCalledWith(s, "npc");
	});

	// The Seasons Change window closes its step when this returns, so a retire dialog left open
	// must not hold the step (and the Fortunes roll after it) hostage.
	it("returns once the shortfall is written, without waiting for the follow-up's windows", async () => {
		const followUp = vi.fn(() => new Promise(() => {}));
		const out = await sufferWinterShortfall(steading(), "pc", { followUp });
		expect(out).toHaveProperty("fortunes");
		expect(followUp).toHaveBeenCalled();
	});

	it("leaves Population loss to the shortfall's own write", async () => {
		expect(await followUpWinterConsequence(steading(), "population", {})).toBeNull();
	});
});
