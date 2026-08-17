import { describe, it, expect } from "vitest";
import { withUnarmedChoice, grantedWeaponAttackFor, maybeBeginAttack } from "../../module/combat/attack-flow.js";
import { grantedWeaponForMove, weaponMeta } from "../../module/data/weapons.js";

// The two shapes carriedAttackWeapons builds: a ticked inventory weapon, and the holy light
// Purifying Flames grants (no inventory item behind it, so it carries `grantedBy`).
function carried(slug) {
	return { slug, meta: weaponMeta(slug), ammoLabel: null };
}

function granted(moveName = "Purifying Flames") {
	const g = grantedWeaponForMove(moveName);
	return { slug: g.slug, meta: g.meta, ammoLabel: null, grantedBy: moveName, whenStat: g.whenStat };
}

describe("withUnarmedChoice", () => {
	it("offers unarmed beside a move-granted weapon that would otherwise be the only one", () => {
		const out = withUnarmedChoice([granted()]);

		// Two rows means promptWeaponChoice asks instead of auto-resolving — the whole point:
		// a Lightbearer Clashing with +STR must not have the holy light imposed on them.
		expect(out).toHaveLength(2);
		expect(out[1].slug).toBe("purifying-flames-holy-light");
	});

	it("puts unarmed first, so a stat that doesn't imply the granted weapon defaults to it", () => {
		const out = withUnarmedChoice([granted()]);

		expect(out[0].unarmed).toBe(true);
		expect(out[0].meta.name).toBe("Unarmed");
		// The dialog pre-checks index 0 unless `preferSlug` matches; the empty slug is what
		// promptWeaponChoice maps back to "no weapon".
		expect(out[0].slug).toBe("");
	});

	it("leaves a carried weapon alone — one ticked weapon is already the player's answer", () => {
		const only = [carried("sword")];
		expect(withUnarmedChoice(only)).toBe(only);
	});

	it("doesn't add unarmed when a carried weapon is on offer alongside the granted one", () => {
		const both = [carried("sword"), granted()];
		expect(withUnarmedChoice(both)).toBe(both);
	});

	it("leaves an empty list empty — nothing that fits the move is already unarmed", () => {
		expect(withUnarmedChoice([])).toEqual([]);
	});
});

// A Lightbearer's owned moves, as the actor exposes them (an array has the .find the
// lookup uses). `move` items only — the type is part of what's matched.
function lightbearer(...moves) {
	return { items: moves.map(m => ({ type: "move", system: { moveType: "playbook" }, ...m })) };
}

const PURIFYING_FLAMES = { name: "Purifying Flames" };
const CLASH = { name: "Clash", system: { moveType: "basic" } };

describe("grantedWeaponAttackFor", () => {
	it("turns Purifying Flames into a Clash with the holy light already in hand", () => {
		const actor = lightbearer(CLASH, PURIFYING_FLAMES);

		const attack = grantedWeaponAttackFor(actor, actor.items[1]);

		// The move it becomes has to be the actor's OWN Clash item: the roll resolves it by id.
		expect(attack.item).toBe(actor.items[0]);
		expect(attack.stat).toBe("wis");
		expect(attack.weaponSlug).toBe("purifying-flames-holy-light");
	});

	it("declines when the Clash it rides on isn't on the character", () => {
		const actor = lightbearer(PURIFYING_FLAMES);

		// Nothing to roll — the caller falls back to posting the move's text, as before.
		expect(grantedWeaponAttackFor(actor, actor.items[0])).toBeNull();
	});

	it("leaves every other move alone", () => {
		const actor = lightbearer(CLASH, { name: "Consecrated Flame" });

		expect(grantedWeaponAttackFor(actor, actor.items[1])).toBeNull();
		// Clash itself grants no weapon — it's the move a grant rides ON, not a granting move.
		expect(grantedWeaponAttackFor(actor, actor.items[0])).toBeNull();
	});

	it("lets a player-authored move of the same name act as itself", () => {
		const actor = lightbearer(CLASH, { name: "Purifying Flames", system: { moveType: "other" } });

		expect(grantedWeaponAttackFor(actor, actor.items[1])).toBeNull();
	});

	it("declines an un-owned playbook row, which carries no item at all", () => {
		expect(grantedWeaponAttackFor(lightbearer(CLASH), null)).toBeNull();
	});
});

describe("maybeBeginAttack with a weapon already chosen", () => {
	// A Lightbearer carrying no melee weapon: the holy light and the unarmed row are both on
	// offer, which is two candidates — enough that promptWeaponChoice would open a Dialog (a
	// global this environment doesn't have), so reaching the prompt is a hard failure here
	// rather than something a passing assertion has to rule out.
	const actor = {
		uuid: "Actor.lightbearer",
		items: [{ type: "move", name: "Purifying Flames", system: { moveType: "playbook" } }],
		getFlag: () => ({}),
	};

	it("skips the prompt and bakes the holy light into the card", async () => {
		const begun = await maybeBeginAttack(actor, { name: "Clash" }, {
			stat: "wis", weaponSlug: "purifying-flames-holy-light",
		});

		const attack = begun.messageFlags["stonetop-pwd"].attack;
		expect(attack.move).toBe("Clash");
		expect(attack.weapon.name).toBe("Holy light");
		// The d10 that replaces the PC's own die, and the piercing the damage card reads back.
		expect(attack.weapon.damageDie).toBe("d10");
		expect(attack.weapon.piercing).toBe(2);
		// Still a Clash: its 10+ pick-one and its counter-attack tiers come along.
		expect(begun.tierActions.success).toContain("Strike hard");
		expect(begun.tierActions.failure).toContain('data-action="suffer"');
	});

	it("falls back to the prompt when the named weapon isn't on offer", async () => {
		// A slug nothing matches must NOT quietly attack with no weapon — it asks, which here
		// means reaching for Dialog and throwing.
		await expect(maybeBeginAttack(actor, { name: "Clash" }, { weaponSlug: "no-such-weapon" }))
			.rejects.toThrow(/Dialog/);
	});
});
