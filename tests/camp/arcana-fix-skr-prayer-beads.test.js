import { describe, expect, it } from "vitest";
import {
	FASTING_NEEDS, campLedger, eatsTonight, mouthTonight, preparationCardRealised, readCampRecord, restsTonight,
} from "../../module/camp/camp-rules.js";
import { campWindowView } from "../../module/camp/camp-view.js";
import { CAMP_STATE } from "../../module/camp/camp-rules.js";
import { PREPARATION_ARCANA } from "../../module/actors/character/roll-boosts.js";
import { roadLedger } from "../../module/utils/road-rations.js";
import { seat } from "../fakes/camp.js";

// Arcana audit 2026-11-04, MNB-20 (fixer SKR): the length of prayer beads, "While you hold at least 1
// Preparation, you ... need not consume supplies or provisions when traveling or making camp" (Book II p.526).
// Food only: unlike the Unliving they still sleep and take the night's pick.

const host = (over = {}) => seat({ id: "aeliana", name: "Aeliana", isHost: true, joinedAt: 1, carried: { supplies: 4 }, ...over });
const bram = (over = {}) => ({ ...seat({ id: "bram", name: "Bram", joinedAt: 2, carried: {} }), ...over });

describe("MNB-20: the prayer beads' holder is no mouth at the fire", () => {
	it("leaves them out of the meal's bill while they still eat, sleep and take a pick", () => {
		const fed = campLedger([host(), bram()]);
		const fasting = campLedger([host({ choices: { offer: { supplies: 1 } } }), bram({ fasting: true })]);
		expect(fed.mouths).toBe(2);
		expect(fasting.mouths).toBe(1);
		expect(fasting.short).toBe(0);
		const member = fasting.rows.find(m => m.actorId === "bram");
		expect(eatsTonight(member)).toBe(true);
		expect(mouthTonight(member)).toBe(false);
		expect(restsTonight(member, fasting)).toBe(true);
	});

	it("says so on their row, and counts the fire's mouths without them", () => {
		const ledger = campLedger([host(), bram({ fasting: true })]);
		const view = campWindowView({ state: CAMP_STATE.OPEN, ledger, editable: ["bram"] });
		const row = view.rows.find(r => r.actorId === "bram");
		expect(row.unlivingText).toContain(FASTING_NEEDS);
		expect(row.night.show).toBe(true);
		expect(view.meal.mouthsText).toBe("1 to feed.");
	});

	it("keeps the card's state from sitting down on the record's vitals", () => {
		const record = readCampRecord({ id: "camp-1", host: "aeliana", vitals: { maxHp: 10, prayerBeads: true } });
		expect(record.vitals.prayerBeads).toBe(true);
		expect(readCampRecord({ id: "camp-1", host: "aeliana", vitals: {} }).vitals.prayerBeads).toBe(false);
	});

	it("reads the beads as realised only identified, unlocked and in hand", () => {
		const arcana = items => ({ minor: { items }, major: { items: [] } });
		const beads = over => ({ slug: "length-of-prayer-beads", identified: true, unlocked: true, lead: false, ...over });
		expect(preparationCardRealised(arcana([beads()]), PREPARATION_ARCANA)).toBe(true);
		expect(preparationCardRealised(arcana([beads({ unlocked: false })]), PREPARATION_ARCANA)).toBe(false);
		expect(preparationCardRealised(arcana([beads({ identified: false })]), PREPARATION_ARCANA)).toBe(false);
		expect(preparationCardRealised(arcana([beads({ lead: true })]), PREPARATION_ARCANA)).toBe(false);
		expect(preparationCardRealised(arcana([{ ...beads(), slug: "a-folktale" }]), PREPARATION_ARCANA)).toBe(false);
		expect(preparationCardRealised(null, PREPARATION_ARCANA)).toBe(false);
	});

	it("on the road, a holder whose Eats box starts unticked costs no meal", () => {
		const member = (actorId, eats) => ({ actorId, name: actorId, eats, followers: 0, resources: { supplies: 4 } });
		expect(roadLedger([member("a", true), member("b", false)], { days: 2 }).mouths).toBe(1);
	});
});
