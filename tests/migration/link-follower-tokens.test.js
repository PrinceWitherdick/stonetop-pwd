import { describe, it, expect, vi } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import { cardBoxHp, unlinkedNpcTokens, linkFollowerTokens } from "../../module/migration/link-follower-tokens.js";

// Audit FOE-2: a one-body follower's NPC placed on an UNLINKED token kept a second copy of their HP that a heal
// written to the NPC never reached. New tokens come out linked now; this links the ones already placed, with
// the card's box (which mirrors every write to any copy) carried onto the NPC first.

const npc = (id, hp, extra = {}) => ({
	id, uuid: `Actor.${id}`, type: "npc", name: id, system: { attributes: { hp: { ...hp } } },
	prototypeToken: { actorLink: false },
	update: vi.fn(async function (data) {
		if ("system.attributes.hp.value" in data) this.system.attributes.hp.value = data["system.attributes.hp.value"];
	}),
	...extra,
});
const token = (base, actorLink = false) => ({ actorLink, baseActor: base, actorId: base.id, update: vi.fn(async () => {}) });
const leader = flags => ({ type: "character", flags: { [SYSTEM_ID]: flags } });

describe("linking a one-body follower's placed tokens", () => {
	it("reads the card's box, or nothing when it holds no number", () => {
		const card = (hpCurrent) => ({ character: leader({ animalCompanion: { hpCurrent } }), ftype: "animal-companion", slug: "" });
		expect(cardBoxHp(card(3))).toBe(3);
		expect(cardBoxHp(card("2"))).toBe(2);
		expect(cardBoxHp(card(-1))).toBe(0);
		expect(cardBoxHp(card(""))).toBeNull();
		expect(cardBoxHp(card(undefined))).toBeNull();
		expect(cardBoxHp({ character: leader({ initiatesHp: { ash: 4 } }), ftype: "initiate", slug: "ash" })).toBe(4);
	});

	it("groups only unlinked tokens of world NPCs", () => {
		const wolf = npc("wolf", { value: 5, max: 8 });
		const pc = { id: "pc", type: "character" };
		const t1 = token(wolf), t2 = token(wolf), linked = token(wolf, true), mine = token(pc);
		const map = unlinkedNpcTokens([{ tokens: [t1, linked, mine] }, { tokens: [t2] }]);
		expect([...map.keys()]).toEqual([wolf]);
		expect(map.get(wolf)).toEqual([t1, t2]);
	});

	it("puts the card's HP on the NPC, then links its prototype and every placed token", async () => {
		const wolf = npc("wolf", { value: 8, max: 8 });
		const t1 = token(wolf), t2 = token(wolf);
		const card = { character: leader({ animalCompanion: { hpCurrent: 3 } }), ftype: "animal-companion", slug: "" };
		const order = [];
		wolf.update.mockImplementation(async data => { order.push(Object.keys(data)[0]); });
		t1.update.mockImplementation(async () => order.push("token"));
		const done = await linkFollowerTokens({ scenes: [{ tokens: [t1] }, { tokens: [t2] }], cardOf: a => (a === wolf ? card : null) });
		expect(done).toEqual({ npcs: 1, tokens: 2 });
		expect(wolf.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 3 }, { stonetopLedger: true });
		expect(wolf.update).toHaveBeenCalledWith({ "prototypeToken.actorLink": true }, { stonetopLedger: true });
		expect(order).toEqual(["system.attributes.hp.value", "prototypeToken.actorLink", "token"]);
		expect(t2.update).toHaveBeenCalledWith({ actorLink: true });
	});

	it("leaves the NPC's HP when the card holds none or the same, caps it at the max, and skips anyone not a one-body follower", async () => {
		const same = npc("same", { value: 4, max: 8 }, { prototypeToken: { actorLink: true } });
		const capped = npc("capped", { value: 1, max: 5 });
		const blank = npc("blank", { value: 2, max: 5 });
		const stranger = npc("stranger", { value: 2, max: 5 });
		const cards = new Map([
			[same, { character: leader({ beastHp: { ox: 4 } }), ftype: "beast", slug: "ox" }],
			[capped, { character: leader({ beastHp: { ox: 9 } }), ftype: "beast", slug: "ox" }],
			[blank, { character: leader({ beastHp: {} }), ftype: "beast", slug: "ox" }],
		]);
		const ts = [token(same), token(capped), token(blank), token(stranger)];
		const done = await linkFollowerTokens({ scenes: [{ tokens: ts }], cardOf: a => cards.get(a) ?? null });
		expect(done).toEqual({ npcs: 3, tokens: 3 });
		expect(same.update).not.toHaveBeenCalled();
		expect(capped.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 5 }, { stonetopLedger: true });
		expect(blank.update).not.toHaveBeenCalledWith(expect.objectContaining({ "system.attributes.hp.value": expect.anything() }), expect.anything());
		expect(ts[3].update).not.toHaveBeenCalled();
	});

	it("a token that cannot be linked does not stop the rest", async () => {
		const wolf = npc("wolf", { value: 3, max: 8 });
		const bad = token(wolf), good = token(wolf);
		bad.update.mockRejectedValue(new Error("refused"));
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const card = { character: leader({ animalCompanion: { hpCurrent: 3 } }), ftype: "animal-companion", slug: "" };
			expect(await linkFollowerTokens({ scenes: [{ tokens: [bad, good] }], cardOf: () => card })).toEqual({ npcs: 1, tokens: 1 });
			expect(good.update).toHaveBeenCalledWith({ actorLink: true });
		} finally {
			spy.mockRestore();
		}
	});
});
