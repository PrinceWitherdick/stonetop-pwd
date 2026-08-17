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
		});
	});
});
