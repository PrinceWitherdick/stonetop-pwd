import { describe, expect, it } from "vitest";
import { OrderFollowersDialog } from "../../../../module/actors/character/dialogs/OrderFollowersDialog.js";

// Order Followers (Book I, NPCs & Followers p.462). The dialog's job is to turn the
// table's judgment calls — which tags apply, which are in the way, which moves help,
// what else is swinging the roll — into the { bonus, rollMode } pair the roll engine
// takes. These exercise that translation through getData(), which is what the
// template and the readout both read.
function makeDialog(follower = {}) {
	return new OrderFollowersDialog({ name: "Vahid" }, { name: "Andalau", ...follower }, () => {});
}

describe("OrderFollowersDialog", () => {
	it("counts an applicable move toward the bonus, the same as a tag", () => {
		const dialog = makeDialog({ tags: ["stealthy"], moves: ["Ride the wind"] });

		expect(dialog.getData().readout).toBe("Roll 2d6 +0");

		// The move alone earns the +1 — the book says "at least one appropriate tag
		// or move", so a follower whose only relevant asset is a move isn't stuck at +0.
		dialog._moveState["Ride the wind"] = "help";
		expect(dialog.getData().readout).toBe("Roll 2d6 +1");

		// A second applicable thing doesn't stack it any higher.
		dialog._tagState["stealthy"] = "help";
		expect(dialog.getData().readout).toBe("Roll 2d6 +1");
	});

	it("gives the moves two states, since only a tag can get in the way", () => {
		const dialog = makeDialog({ tags: [], moves: ["Ride the wind"] });
		dialog._moveState["Ride the wind"] = "help";
		expect(dialog.getData()).toMatchObject({
			followerMoves: [{ move: "Ride the wind", help: true }],
			readout:       "Roll 2d6 +1",
		});
	});

	it("rolls the book's worked example: +1 from stealthy, disadvantage from mischievous", () => {
		const dialog = makeDialog({ tags: ["stealthy", "mischievous"] });
		dialog._tagState["stealthy"]    = "help";
		dialog._tagState["mischievous"] = "hinder";

		expect(dialog.getData()).toMatchObject({
			readout:  "Roll 3d6 (keep lowest 2) +1, with disadvantage",
			modeNote: "A tag in the way is already imposing disadvantage.",
		});
	});

	it("takes a disadvantage that doesn't come from the follower at all", () => {
		// Interfere (p.329): disadvantage on their next roll, "even if that roll is
		// unrelated". Nothing about the follower is in the way, so no chip can say it.
		const dialog = makeDialog({ tags: ["brave"] });
		dialog._tagState["brave"] = "help";
		dialog._disadvantage = true;

		expect(dialog.getData().readout).toBe("Roll 3d6 (keep lowest 2) +1, with disadvantage");
	});

	it("cancels an outside advantage against a hindering tag instead of dropping it", () => {
		// A Marshal spending Command on Stentorian to order a follower whose tag is in
		// the way rolls straight 2d6 (p.230), and the dialog says why.
		const dialog = makeDialog({ tags: ["fierce", "reckless"] });
		dialog._tagState["fierce"]   = "help";
		dialog._tagState["reckless"] = "hinder";
		dialog._advantage = true;

		expect(dialog.getData()).toMatchObject({
			advantage:    true,
			disadvantage: false,
			readout:      "Roll 2d6 +1",
			modeNote:     "Advantage and disadvantage cancel out: rolling straight (p.230).",
		});
	});

	it("keeps an exceptional follower at +0 until something else applies", () => {
		const dialog = makeDialog({ tags: ["fierce"], exceptional: true });
		expect(dialog.getData().readout).toBe("Roll 2d6 +0");

		dialog._tagState["fierce"] = "help";
		expect(dialog.getData().readout).toBe("Roll 2d6 +2");
	});

	it("hands the caller the resolved roll, the move key, and the follower's name", async () => {
		let handed = null;
		const dialog = new OrderFollowersDialog(
			{ name: "Rhianna" },
			{ name: "The Crew", tags: ["archers"], moveKey: "let-fly" },
			(result) => { handed = result; },
		);
		dialog._tagState["archers"] = "help";
		dialog.close = () => {};

		await dialog._finish();

		expect(handed).toEqual({
			bonus:        1,
			rollMode:     "normal",
			moveName:     "The Crew: Let Fly",
			moveKey:      "let-fly",
			followerName: "The Crew",
			member:       null,
			shieldWall:   false,
		});
	});
});

// A group ordered one member at a time (Book I p.471): "When a PC directs an individual member of a
// group, they can trigger moves as if they were a follower themselves. The group's tags and moves apply,
// plus any unique tags or moves they have as an individual." That is how Glaw Lets Fly while the rest of
// the crew Clashes.
describe("OrderFollowersDialog, for a group", () => {
	const crew = (extra = {}) => new OrderFollowersDialog(
		{ name: "Rhianna" },
		{
			name: "The Crew", tags: ["archers", "stealthy"], moves: ["Heroes to the Last"],
			members: [
				{ key: "named:0", name: "Glaw", tags: ["small", "too serious"] },
				{ key: "anon:0", name: "Crew member 2", tags: [] },
			],
			...extra,
		},
		() => {},
	);

	it("offers the whole group first, as it usually acts, then each member by name and own tags", () => {
		expect(crew().getData().who).toEqual([
			{ key: "", label: "All of The Crew, acting as one", selected: true },
			{ key: "named:0", label: "Glaw (small, too serious)", selected: false },
			{ key: "anon:0", label: "Crew member 2", selected: false },
		]);
	});

	it("has no Who row for a follower who is one person", () => {
		expect(makeDialog({ tags: ["brave"] }).getData().who).toBeNull();
	});

	it("gives a picked member the group's tags plus their own, under their own name", () => {
		const dialog = crew();
		dialog._who = "named:0";
		const data = dialog.getData();
		expect(data.followerName).toBe("Glaw");
		expect(data.tags.map(t => t.tag)).toEqual(["archers", "stealthy", "small", "too serious"]);
		expect(data.ownNote).toBe("Glaw's own: small, too serious. The rest are The Crew's.");
		// The group's moves are the member's too.
		expect(data.followerMoves.map(m => m.move)).toEqual(["Heroes to the Last"]);
	});

	it("shows a member's tag once when the group has it too, as the group's", () => {
		const dialog = crew({ members: [{ key: "named:0", name: "Glaw", tags: ["stealthy", "small"] }] });
		dialog._who = "named:0";
		expect(dialog.getData().tags.map(t => t.tag)).toEqual(["archers", "stealthy", "small"]);
		expect(dialog.getData().ownNote).toBe("Glaw's own: small. The rest are The Crew's.");
	});

	it("stops counting a member's own tag once the whole group is picked again", () => {
		// "small" is Glaw's alone. Marked in the way for him, it must not put the whole crew at
		// disadvantage, and marked as helping it must not earn the whole crew a +1.
		const dialog = crew();
		dialog._who = "named:0";
		dialog._tagState["small"] = "hinder";
		expect(dialog.getData().readout).toBe("Roll 3d6 (keep lowest 2) +0, with disadvantage");
		dialog._who = "";
		expect(dialog.getData().readout).toBe("Roll 2d6 +0");
		dialog._tagState["small"] = "help";
		expect(dialog.getData().readout).toBe("Roll 2d6 +0");
		// And picking Glaw again brings back what the table said about it.
		dialog._who = "named:0";
		expect(dialog.getData().readout).toBe("Roll 2d6 +1");
	});

	it("rolls a member's order under their name, and hands back which member it was", async () => {
		let handed = null;
		const dialog = new OrderFollowersDialog(
			{ name: "Rhianna" },
			{ name: "The Crew", tags: ["archers"], moveKey: "let-fly", members: [{ key: "named:0", name: "Glaw", tags: ["small"] }] },
			(result) => { handed = result; },
		);
		dialog._who = "named:0";
		dialog._tagState["small"] = "help";
		dialog.close = () => {};
		await dialog._finish();
		expect(handed).toMatchObject({ bonus: 1, moveName: "Glaw: Let Fly", followerName: "Glaw", member: "named:0" });
	});

	it("falls back to the whole group if the member picked is not on offer", () => {
		const dialog = crew();
		dialog._who = "named:9";
		expect(dialog.getData().followerName).toBe("The Crew");
	});
});

// Shield Wall (the Marshal): "When you have your crew form a shield wall, they Defend with advantage and
// on a 7+ they hold +2 Readiness (instead of the usual +1 for shields)." Whether they have formed up is
// the fiction's, so it is a box of its own, ticked, shown only for a Defend by a crew that is offered it.
describe("OrderFollowersDialog, Shield Wall", () => {
	const crew = (extra = {}) => new OrderFollowersDialog({ name: "Maddoc" }, { name: "The Crew", tags: [], shieldWall: true, moveKey: "defend", ...extra }, () => {});

	it("offers the box only on a Defend, and only when the crew is offered it", () => {
		expect(crew().getData()).toMatchObject({ shieldWall: true, inWall: true });
		expect(crew({ moveKey: "clash" }).getData().shieldWall).toBe(false);
		expect(crew({ shieldWall: false }).getData().shieldWall).toBe(false);
	});

	it("Defends with advantage while ticked, and straight once unticked", () => {
		const dialog = crew();
		expect(dialog.getData().readout).toBe("Roll 3d6 (keep highest 2) +0, with advantage");
		dialog._inWall = false;
		expect(dialog.getData().readout).toBe("Roll 2d6 +0");
	});

	it("cancels against a disadvantage like any other advantage, and says so", () => {
		const dialog = crew();
		dialog._disadvantage = true;
		expect(dialog.getData()).toMatchObject({
			readout:  "Roll 2d6 +0",
			modeNote: "Advantage and disadvantage cancel out: rolling straight (p.230).",
		});
	});

	it("tells the caller the wall was up, for the card and the +2 Readiness", async () => {
		let handed = null;
		const dialog = new OrderFollowersDialog({ name: "Maddoc" }, { name: "The Crew", shieldWall: true, moveKey: "defend" }, r => { handed = r; });
		dialog.close = () => {};
		await dialog._finish();
		expect(handed).toMatchObject({ moveKey: "defend", rollMode: "adv", shieldWall: true });
	});
});
