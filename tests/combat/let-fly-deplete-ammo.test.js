import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SCOPE, installCombatChatFakes, uninstallCombatChatFakes } from "../fakes/combat-chat.js";

const { depleteAmmoAndPost, letFlyAmmoStatuses } = await import("../../module/combat/attack-flow.js");

// Let Fly's 7-9 "Deal your damage, but deplete your ammo (mark the next status by your weapon;
// don't pick this if your weapon lacks such statuses)". The row grows a button when ticked, and
// the Confirm pays it for a player who ticked it and never pressed the button. Both reach the
// one spend below, which is what has to happen exactly once per card.

// A message whose flags live in a plain object, so a latch written by one call is read by the next.
function makeCard() {
	const flags = {};
	return {
		flags,
		getFlag: (scope, key) => (scope === SCOPE ? flags[key] : undefined),
		setFlag: async (scope, key, value) => { flags[key] = value; },
	};
}

// A character carrying a crossbow on its inventory resource track, at `marked` boxes.
function archer(marked = 0) {
	const resources = { crossbow: marked };
	const pc = {
		name: "Aerin", resources, rendered: 0,
		getFlag: (scope, key) => (key === "inventory.resources" ? { ...resources } : undefined),
		update: async (data) => { resources.crossbow = data[`flags.${SCOPE}.inventory.resources.crossbow`]; },
	};
	pc.sheet = { render: () => { pc.rendered++; } };
	return pc;
}

const crossbow = { slug: "crossbow", name: "Crossbow", ammo: true, ammoStore: "inventory", ammoMax: 2, ammoLabels: null };

let posted;
beforeEach(() => { posted = installCombatChatFakes(); });
afterEach(() => uninstallCombatChatFakes());

describe("depleteAmmoAndPost", () => {
	it("marks the next status by the weapon, says so, and records it on the row", async () => {
		const card = makeCard();
		const pc = archer(0);

		const status = await depleteAmmoAndPost(card, pc, { weapon: crossbow }, "0");

		expect(pc.resources.crossbow).toBe(1);
		expect(status).toMatchObject({ index: 1, label: "Low ammo", allOut: false });
		// Keyed by the row's index: that is what the row's readout is drawn from on every client.
		expect(card.flags.ammoDepleted).toEqual({ 0: { label: "Low ammo", allOut: false } });
		expect(posted).toHaveLength(1);
		expect(posted[0].content).toContain("low ammo");
		expect(pc.rendered).toBe(1);
	});

	it("says the weapon is out once the last box is marked", async () => {
		const pc = archer(1);
		const status = await depleteAmmoAndPost(makeCard(), pc, { weapon: crossbow }, "0");
		expect(status.allOut).toBe(true);
		expect(posted[0].content).toContain("out of ammunition");
	});

	it("marks once per card, whether the button or the Confirm gets there second", async () => {
		const card = makeCard();
		const pc = archer(0);

		await depleteAmmoAndPost(card, pc, { weapon: crossbow }, "0");
		expect(await depleteAmmoAndPost(card, pc, { weapon: crossbow }, "0")).toBeNull();

		expect(pc.resources.crossbow).toBe(1);
		expect(posted).toHaveLength(1);
	});

	it("marks once when the button and the Confirm reach it together", async () => {
		const card = makeCard();
		const pc = archer(0);

		const both = await Promise.all([
			depleteAmmoAndPost(card, pc, { weapon: crossbow }, "0"),
			depleteAmmoAndPost(card, pc, { weapon: crossbow }, "0"),
		]);

		expect(both.filter(Boolean)).toHaveLength(1);
		expect(pc.resources.crossbow).toBe(1);
		expect(posted).toHaveLength(1);
	});

	it("takes an older card's latch, which said only that the ammo was marked", async () => {
		const card = makeCard();
		card.flags.attack = { ammoDepleted: true };
		const pc = archer(0);

		expect(await depleteAmmoAndPost(card, pc, { weapon: crossbow }, "0")).toBeNull();
		expect(pc.resources.crossbow).toBe(0);
		expect(posted).toHaveLength(0);
	});

	it("spends nothing for a weapon with no statuses to mark", async () => {
		const card = makeCard();
		const pc = archer(0);
		const spear = { slug: "spear", name: "Spear", ammo: false };

		expect(await depleteAmmoAndPost(card, pc, { weapon: spear }, "0")).toBeNull();
		expect(await depleteAmmoAndPost(card, pc, { weapon: null }, "0")).toBeNull();
		expect(card.flags.ammoDepleted).toBeUndefined();
		expect(posted).toHaveLength(0);
	});

	it("spends nothing when no deplete row is ticked", async () => {
		const pc = archer(0);
		expect(await depleteAmmoAndPost(makeCard(), pc, { weapon: crossbow }, null)).toBeNull();
		expect(pc.resources.crossbow).toBe(0);
	});
});

describe("the card's deplete row", () => {
	const SRC = fs.readFileSync(path.resolve("module/combat/attack-flow.js"), "utf8");
	const body = (name) => {
		const at = SRC.indexOf(`function ${name}`);
		expect(at).toBeGreaterThan(-1);
		return SRC.slice(at, SRC.indexOf("\n}", at));
	};

	it("is hidden, and unticked, on a weapon that lacks such statuses", () => {
		const wire = body("wireAttackAmmo");
		expect(wire).toContain("if (!attack.weapon?.ammo)");
		expect(wire).toContain("item.hidden = true");
		expect(wire).toContain("box.checked = false");
	});

	it("grows its button through the shared ticked-option wiring", () => {
		expect(body("wireAttackAmmo")).toContain("wirePickedOptionButton(message, root, {");
		// Wired from the Confirm's own pass, before the Confirm's label reads the ticks.
		const confirm = body("wireAttackConfirm");
		expect(confirm.indexOf("wireAttackAmmo(")).toBeGreaterThan(-1);
		expect(confirm.indexOf("wireAttackAmmo(")).toBeLessThan(confirm.indexOf("wireAttackNoHarm("));
	});

	it("reads a bullet by its label, so the button under it cannot change what it matches", () => {
		expect(body("pickedOptionText")).toContain('querySelector("label")');
	});
});

describe("letFlyAmmoStatuses", () => {
	// A bare actor carrying what `checked` says, on the resource track at `resources`.
	const carrying = (checked, resources = {}) => ({
		items: [],
		getFlag: (scope, key) => (key === "inventory.checked" ? checked : key === "inventory.resources" ? resources : undefined),
	});

	it("names each carried Let Fly weapon with a box marked", async () => {
		const actor = carrying({ crossbow: true, "composite-bow": true, spear: true }, { crossbow: 1, "composite-bow": 2 });
		expect(await letFlyAmmoStatuses(actor)).toEqual({
			weapons: [
				{ name: "Crossbow", label: "Low ammo", allOut: false },
				{ name: "Composite bow", label: "All out", allOut: true },
			],
			allOut: false,
		});
	});

	it("says nothing about a full quiver, or a weapon that has no ammo to run out of", async () => {
		expect(await letFlyAmmoStatuses(carrying({ crossbow: true, spear: true }))).toEqual({ weapons: [], allOut: false });
	});

	it("is all out only when every Let Fly weapon they carry is", async () => {
		expect((await letFlyAmmoStatuses(carrying({ crossbow: true, "composite-bow": true }, { crossbow: 2, "composite-bow": 2 }))).allOut).toBe(true);
		// A full composite bow, left out of the list, still fires.
		const one = await letFlyAmmoStatuses(carrying({ crossbow: true, "composite-bow": true }, { crossbow: 2 }));
		expect(one).toEqual({ weapons: [{ name: "Crossbow", label: "All out", allOut: true }], allOut: false });
		expect((await letFlyAmmoStatuses(carrying({}))).allOut).toBe(false);
	});
});
