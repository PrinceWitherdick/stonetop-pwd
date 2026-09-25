// Data-integrity guard for the level-up content itself: validates the playbook-move
// SOURCE (packs/src — what the runtime pack is built from) so that every playbook can
// actually be advanced "all the way up" with no stranded or unreachable moves. These are
// pure checks over the JSON; they catch content mistakes (a typo'd prerequisite, a bad
// cross-playbook target, an impossible stat gate) before they reach a live world.

import { describe, it, expect } from "vitest";
import {
	loadPlaybookMoveDocs, movesByPlaybook, loadPlaybookDefs, loadPlaybookPackDocs,
	PLAYBOOKS, PLAYBOOK_NAMES, STAT_KEYS, CROSS_PLAYBOOK_MOVES,
} from "../fakes/sourcePack.js";

const DOCS    = loadPlaybookMoveDocs();
const BY_NAME = movesByPlaybook(DOCS);
const PB_PACK = loadPlaybookPackDocs();
const { byName: PB_DEFS } = loadPlaybookDefs();

// move name → set of playbooks that offer a move by that name (for prereq reachability).
const NAME_TO_PLAYBOOKS = new Map();
for (const d of DOCS) {
	if (!NAME_TO_PLAYBOOKS.has(d.name)) NAME_TO_PLAYBOOKS.set(d.name, new Set());
	NAME_TO_PLAYBOOKS.get(d.name).add(d.system?.playbook);
}

// The set of playbooks a given playbook can reach via its cross-playbook moves
// ("any" → every other playbook).
function crossReach(playbookName) {
	const reach = new Set();
	for (const d of BY_NAME.get(playbookName) ?? []) {
		const cp = d.system?.crossPlaybook;
		if (!cp) continue;
		if (cp.playbooks === "any") for (const n of PLAYBOOK_NAMES) { if (n !== playbookName) reach.add(n); }
		else for (const n of (cp.playbooks ?? [])) reach.add(n);
	}
	return reach;
}

const advanced = (playbookName) => (BY_NAME.get(playbookName) ?? []).filter(d => !d.system?.isStartingMove);

describe("playbook advancement data", () => {
	it("every expected playbook is present with starting + advanced moves", () => {
		for (const { name } of PLAYBOOKS) {
			const moves = BY_NAME.get(name) ?? [];
			expect(moves.length, `${name} has no moves`).toBeGreaterThan(0);
			expect(advanced(name).length, `${name} has no advanced moves`).toBeGreaterThanOrEqual(15);
		}
		// No moves attributed to an unknown playbook.
		expect([...BY_NAME.keys()].sort()).toEqual([...PLAYBOOK_NAMES].sort());
	});

	it("every playbook offers Improved Stat (+2, x3) and Superior Stat (+3)", () => {
		for (const { name } of PLAYBOOKS) {
			const improved = (BY_NAME.get(name) ?? []).find(d => d.name === "Improved Stat");
			const superior = (BY_NAME.get(name) ?? []).find(d => d.name === "Superior Stat");
			expect(improved?.system, `${name} missing Improved Stat`).toMatchObject({ cap: 2, repeatMax: 3 });
			expect(superior?.system?.cap, `${name} missing Superior Stat`).toBe(3);
		}
	});

	it("stat-increase moves declare a valid cap, no roll, and a positive repeat", () => {
		for (const d of DOCS) {
			if (d.system?.cap == null) continue;
			expect([2, 3], `${d.name} cap`).toContain(d.system.cap);
			expect(d.system.rollType ?? null, `${d.name} should not roll`).toBeNull();
			expect(d.system.repeatMax ?? 1).toBeGreaterThanOrEqual(1);
		}
	});

	it("level gates are integers ≥ 2 and each playbook has a level-6 'potent' tier", () => {
		for (const d of DOCS) {
			const lvl = d.system?.requirement?.level;
			if (lvl == null) continue;
			expect(Number.isInteger(lvl), `${d.name} level`).toBe(true);
			expect(lvl).toBeGreaterThanOrEqual(2);
		}
		for (const { name } of PLAYBOOKS) {
			const sixes = (BY_NAME.get(name) ?? []).filter(d => d.system?.requirement?.level >= 6);
			expect(sixes.length, `${name} has no level-6 moves`).toBeGreaterThan(0);
		}
	});

	it("stat-gate requirements use real stats with sane minimums", () => {
		for (const d of DOCS) {
			const stats = d.system?.requirement?.stats;
			if (!stats) continue;
			for (const [k, v] of Object.entries(stats)) {
				expect(STAT_KEYS, `${d.name} stat key ${k}`).toContain(k);
				expect(Number.isInteger(v) && v >= 1 && v <= 3, `${d.name} stat ${k}=${v}`).toBe(true);
			}
		}
	});

	it("cross-playbook moves target real, other playbooks (and only known possessions)", () => {
		const KNOWN_POSSESSIONS = new Set(["sacred-pouch"]);
		const found = {};
		for (const d of DOCS) {
			const cp = d.system?.crossPlaybook;
			if (!cp) continue;
			found[d.system.playbook] = d.name;
			if (cp.playbooks !== "any") {
				expect(Array.isArray(cp.playbooks), `${d.name} playbooks`).toBe(true);
				expect(cp.playbooks.length).toBeGreaterThan(0);
				for (const n of cp.playbooks) {
					expect(PLAYBOOK_NAMES, `${d.name} → ${n}`).toContain(n);
					expect(n, `${d.name} can't cross into itself`).not.toBe(d.system.playbook);
				}
			}
			if (cp.grantsPossession != null) {
				expect(KNOWN_POSSESSIONS, `${d.name} grantsPossession`).toContain(cp.grantsPossession);
			}
		}
		// Exactly one cross-playbook move per playbook that has one (the Judge and the
		// Lightbearer have none).
		expect(found).toEqual(CROSS_PLAYBOOK_MOVES);
	});

	it("every required-move prerequisite is obtainable (in-playbook or via a cross-playbook move)", () => {
		const offenders = [];
		for (const d of DOCS) {
			const reqs  = d.system?.requirement?.moves ?? [];
			const anyOf = d.system?.requirement?.anyMoves ?? [];
			if (!reqs.length && !anyOf.length) continue;
			const home = d.system.playbook;
			const reach = crossReach(home);
			const obtainable = r => {
				const offeredBy = NAME_TO_PLAYBOOKS.get(r);
				return !!offeredBy && (offeredBy.has(home) || [...offeredBy].some(pb => reach.has(pb)));
			};
			for (const r of [...reqs, ...anyOf]) {
				if (!NAME_TO_PLAYBOOKS.get(r)) offenders.push(`${home}/${d.name} → unknown move "${r}"`);
			}
			// Every all-of move must be reachable; an any-of list needs just one reachable.
			for (const r of reqs) {
				if (NAME_TO_PLAYBOOKS.get(r) && !obtainable(r)) offenders.push(`${home}/${d.name} → "${r}" not obtainable`);
			}
			if (anyOf.length && !anyOf.some(obtainable)) offenders.push(`${home}/${d.name} → none of "${anyOf.join(" or ")}" obtainable`);
		}
		expect(offenders).toEqual([]);
	});

	it("a book 'X or Y' prerequisite is stored as any-of, never as all-of", () => {
		// Book I, the Ranger's advanced moves: "ALPHA (Requires level 6+, and Wild Speech or Spirit
		// Tongue)". It is the only "or" prerequisite among the playbook moves; Second Intent's
		// "Parry & Riposte, and Ambush" is the only genuine all-of pair.
		const alpha = (BY_NAME.get("The Ranger") ?? []).find(d => d.name === "Alpha");
		expect(alpha.system.requirement).toMatchObject({ level: 6, anyMoves: ["Wild Speech", "Spirit Tongue"] });
		expect(alpha.system.requirement.moves ?? []).toEqual([]);
		const multi = DOCS.filter(d => (d.system?.requirement?.moves ?? []).length > 1).map(d => d.name);
		expect(multi).toEqual(["Second Intent"]);
	});

	it("each playbook has enough advancement capacity to climb well past level 10", () => {
		for (const { name } of PLAYBOOKS) {
			// Total takeable slots = advanced moves counting their repeat ceilings.
			const slots = advanced(name).reduce((n, d) => n + Math.max(1, d.system?.repeatMax ?? 1), 0);
			expect(slots, `${name} advancement slots`).toBeGreaterThanOrEqual(12);
			// At least a few advances are available before the level-6 gate, so you can
			// always reach level 6 in the first place.
			const preSix = advanced(name).filter(d => (d.system?.requirement?.level ?? 0) < 6).length;
			expect(preSix, `${name} pre-level-6 advances`).toBeGreaterThanOrEqual(4);
		}
	});

	it("load-gated moves carry the expected maxLoad / requiresUnarmored, and nothing else does", () => {
		// The complete set of moves whose fiction needs a lighter load (Book I). The
		// expedition Outfit readout reads these fields straight off each move's data.
		const EXPECTED = {
			"Catlike":          { maxLoad: "light",  requiresUnarmored: false },
			"Free Running":     { maxLoad: "light",  requiresUnarmored: false },
			"Stalker":          { maxLoad: "normal", requiresUnarmored: false },
			"Uncanny Reflexes": { maxLoad: "normal", requiresUnarmored: true  },
		};
		const gated = {};
		for (const d of DOCS) {
			const maxLoad = d.system?.maxLoad;
			if (!maxLoad) {
				// A stray requiresUnarmored with no maxLoad gate would never fire.
				expect(d.system?.requiresUnarmored, `${d.name} requiresUnarmored without maxLoad`).toBeFalsy();
				continue;
			}
			expect(["light", "normal", "heavy"], `${d.name} maxLoad`).toContain(maxLoad);
			gated[d.name] = { maxLoad, requiresUnarmored: !!d.system?.requiresUnarmored };
		}
		expect(gated).toEqual(EXPECTED);
	});

	it("flags every 'either X OR Y' starting-move option as isStartingMove", () => {
		// The options in a choice group ARE starting moves — they're just picked rather
		// than auto-granted (ensureStartingMoves deliberately skips anything in a group).
		// Leaving one unflagged makes the sheet count it as a level advancement pick, so a
		// freshly-made character reads as "N more moves than expected for level 1".
		// (That each option resolves to a real move is held by onboarding-move-references.)
		for (const pb of PB_PACK) {
			const groups = pb.flags?.stonetop?.moves?.choices ?? [];
			if (!groups.length) continue;
			const byName = new Map((BY_NAME.get(pb.name) ?? []).map(d => [d.name, d]));
			for (const group of groups) {
				for (const optionName of (group.options ?? [])) {
					expect(byName.get(optionName)?.system?.isStartingMove,
						`${pb.name}: "${optionName}" must be isStartingMove`).toBe(true);
				}
			}
		}
	});

	it("only the Lightbearer carries invocations, with enough options for its starting count", () => {
		for (const { name } of PLAYBOOKS) {
			const inv = PB_DEFS.get(name)?.invocations;
			if (name === "The Lightbearer") {
				expect(inv, "Lightbearer invocations").toBeTruthy();
				expect(inv.startingCount).toBeGreaterThanOrEqual(1);
				expect(inv.options.length).toBeGreaterThanOrEqual(inv.startingCount);
				for (const o of inv.options) expect(o.slug, "invocation slug").toBeTruthy();
			} else {
				expect(inv, `${name} should not have invocations`).toBeFalsy();
			}
		}
	});
});
