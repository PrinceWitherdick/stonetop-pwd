import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	RETIRE_NPC, RETIRED_PC_FLAG, canRetire, epilogueCardHtml, retireCharacter, returnToPlay,
} from "../../module/campaign/retire-pc.js";
import { RetireCharacterDialog } from "../../module/campaign/RetireCharacterDialog.js";
import { LEFT_PLAY_HOW, hasLeftPlay, leftPlayRecord } from "../../module/campaign/left-play.js";
import { isOutOfPlay } from "../../module/actors/character/deaths-door-actor.js";

// Book I p.584, "Retiring PCs": a PC who retires or leaves Stonetop gets an epilogue, stops being a PC, and one who
// "retires from play but stays in the village or the region" becomes an NPC, marked retired (as Eira is, p.481).

const SCOPE = "stonetop-pwd";

/** A document whose update lands dotted paths (and `-=` deletions) on itself, the way core's does. */
function doc(data) {
	const d = {
		flags: {},
		system: {},
		...data,
		update: vi.fn(async changes => {
			for (const [path, value] of Object.entries(changes)) {
				const parts = path.split(".");
				const last = parts.pop();
				let node = d;
				for (const p of parts) node = node[p] ??= {};
				if (last.startsWith("-=")) delete node[last.slice(2)];
				else node[last] = value;
			}
		}),
	};
	return d;
}

const pc = (extra = {}) => doc({ id: "bram", uuid: "Actor.bram", name: "Bram", img: "bram.webp", type: "character", isOwner: true, ...extra });

let user;
beforeEach(() => {
	user = { isGM: false };
	global.game.user = user;
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
});
afterEach(() => { delete global.game.user; });

describe("who may retire a character", () => {
	it("is its owner or a GM, while it is in play", () => {
		expect(canRetire(pc())).toBe(true);
		expect(canRetire(pc({ isOwner: false }))).toBe(false);
		user.isGM = true;
		expect(canRetire(pc({ isOwner: false }))).toBe(true);
		expect(canRetire(doc({ type: "npc", isOwner: true }))).toBe(false);
		expect(canRetire(pc({ flags: { [SCOPE]: { deathsDoor: "dead" } } }))).toBe(false);
	});
});

describe("retiring a PC who stays", () => {
	it("files a new resident NPC marked Retired, takes the PC out of play, and posts the epilogue", async () => {
		const bram = pc();
		const npc = doc({ id: "n1", uuid: "Actor.n1", name: "Bram", type: "npc" });
		const addPerson = vi.fn(async () => npc);
		const post = vi.fn(async () => {});
		const steading = { id: "st" };

		const result = await retireCharacter(bram, { how: LEFT_PLAY_HOW.RETIRED, epilogue: "He keeps bees now.\n\nAnd regrets nothing.", npc: RETIRE_NPC.RESIDENT },
			{ steading, addPerson, post, now: () => 42 });

		expect(result.npc).toBe(npc);
		expect(addPerson).toHaveBeenCalledWith("residents", expect.objectContaining({ name: "Bram", img: "bram.webp" }), steading);
		expect(addPerson.mock.calls[0][1].notes).toContain("@UUID[Actor.bram]{Bram}");
		expect(npc.system.status).toBe("retired");
		expect(npc.flags[SCOPE][RETIRED_PC_FLAG]).toBe("Actor.bram");
		expect(leftPlayRecord(bram)).toEqual({ how: "retired", at: 42, npcUuid: "Actor.n1" });
		expect(isOutOfPlay(bram)).toBe(true);
		const card = post.mock.calls[0][0];
		expect(card.speaker).toEqual({ actor: "bram", alias: "Bram" });
		expect(card.content).toContain("<p>He keeps bees now.</p><p>And regrets nothing.</p>");
		expect(card.content).toContain("Retires");
	});

	it("links an NPC already on the sheet instead of making one", async () => {
		const eira = doc({ id: "eira", uuid: "Actor.eira", name: "Eira", type: "npc" });
		const addPerson = vi.fn();
		await retireCharacter(pc(), { how: LEFT_PLAY_HOW.RETIRED, npc: "eira" },
			{ steading: {}, actors: new Map([["eira", eira]]), addPerson, post: vi.fn() });
		expect(addPerson).not.toHaveBeenCalled();
		expect(eira.system.status).toBe("retired");
	});
});

describe("a PC who leaves Stonetop", () => {
	it("becomes no NPC, whatever was picked, and still leaves play with an epilogue", async () => {
		const bram = pc();
		const addPerson = vi.fn();
		const post = vi.fn();
		await retireCharacter(bram, { how: LEFT_PLAY_HOW.LEFT, epilogue: "On the road to Lygos.", npc: RETIRE_NPC.RESIDENT }, { steading: {}, addPerson, post });
		expect(addPerson).not.toHaveBeenCalled();
		expect(leftPlayRecord(bram).how).toBe("left");
		expect(post.mock.calls[0][0].content).toContain("Leaves Stonetop");
	});

	it("does nothing for a character already out of play, or an ending it does not know", async () => {
		const post = vi.fn();
		expect(await retireCharacter(pc({ flags: { [SCOPE]: { leftPlay: { how: "left" } } } }), { how: "left" }, { post })).toBeNull();
		expect(await retireCharacter(pc(), { how: "dead" }, { post })).toBeNull();
		expect(post).not.toHaveBeenCalled();
	});
});

describe("back into play", () => {
	it("is the GM's, and clears the record", async () => {
		const bram = pc({ flags: { [SCOPE]: { leftPlay: { how: "retired" } } } });
		expect(await returnToPlay(bram)).toBe(false);
		user.isGM = true;
		expect(await returnToPlay(bram)).toBe(true);
		expect(hasLeftPlay(bram)).toBe(false);
		expect(isOutOfPlay(bram)).toBe(false);
	});
});

describe("the epilogue card", () => {
	it("escapes the player's words and keeps their paragraphs", () => {
		expect(epilogueCardHtml({ name: "Bram", how: "retired", epilogue: "a <b>\nline\n\nnext" })).toContain("<p>a &lt;b&gt;<br>line</p><p>next</p>");
		const html = epilogueCardHtml({ name: "Bram", how: "retired", epilogue: "", npcName: "Bram" });
		expect(html).toContain("Bram retires from adventuring.");
		expect(html).toContain("is now an NPC");
	});
});

describe("the retire window", () => {
	it("offers a new resident, a new neighbor, the steading's people and none, and only for one who stays", () => {
		const dlg = new RetireCharacterDialog(pc(), { people: [{ id: "eira", name: "Eira" }] });
		let data = dlg.getData();
		expect(data.staying).toBe(true);
		expect(data.npcOptions.map(o => o.value)).toEqual(["residents", "neighbors", "eira", "none"]);
		expect(data.prompt).toContain("typical day in their new life");
		dlg._how = LEFT_PLAY_HOW.LEFT;
		data = dlg.getData();
		expect(data.staying).toBe(false);
		expect(data.prompt).toContain("Where are they now?");
	});

	it("hands the words and the pick to the retire flow, with no NPC for one who leaves", async () => {
		const retire = vi.fn(async () => ({ npc: null }));
		const dlg = new RetireCharacterDialog(pc(), { people: [], retire });
		dlg.close = vi.fn();
		dlg._epilogue = "Gone north.";
		dlg._how = LEFT_PLAY_HOW.LEFT;
		await dlg._apply();
		expect(retire).toHaveBeenCalledWith(expect.objectContaining({ id: "bram" }), { how: "left", epilogue: "Gone north.", npc: "none" });
	});
});
