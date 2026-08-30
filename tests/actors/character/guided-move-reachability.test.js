import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readRepo } from "../../fakes/css.js";
import { GUIDED_CHARACTER_MOVES } from "../../../module/actors/character/StonetopCharacterSheet.js";

// A guided move opens a dialog before it rolls. There is exactly ONE way in for the table:
// _guidedMoveForRollable, off a move row's `.rollable` — and tab-moves.hbs only draws that
// `{{#if rollType}}`. So a guide whose move has no rollType and no `roll` of its own can never
// be opened by anything, and a name-click posts the move's printed text to chat instead.
//
// The table used to hold 24 such entries: a whole second, abbreviated copy of every "pick 1"
// list in the playbook moves, unreachable and already drifting from the printed text nobody
// could compare it against. This is the guard that would have caught them. It fails loudly for
// a new entry rather than letting it sit there looking implemented.
//
// Those lists are not gone from the game — a non-rolling move's options are tickable on the card
// its text posts to (chat.js#pickableMoveDescription, tests/utils/pickable-move-card.test.js).
// So a new guide entry for a move that does not roll is not "the only way to offer a choice";
// it is a copy of one the move already makes.
//
// A guide reached by NAME rather than by a rollable is fine, and says so in the source: Recover
// has its own button, which builds its dialog from GUIDED_CHARACTER_MOVES.Recover.

const SHEET_JS = readRepo("module/actors/character/StonetopCharacterSheet.js");
const PACK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packs/src/stonetop-items");

function packMoves(dir = PACK_ROOT, out = new Map()) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { packMoves(full, out); continue; }
		if (!entry.name.endsWith(".json")) continue;
		try {
			const doc = JSON.parse(fs.readFileSync(full, "utf8"));
			if (doc?.name) out.set(doc.name, doc);
		} catch { /* not a document */ }
	}
	return out;
}

const MOVES = packMoves();

describe("every guided character move can actually be opened", () => {
	const names = Object.keys(GUIDED_CHARACTER_MOVES);

	it("finds the moves it guides in the shipped packs", () => {
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) expect(MOVES.has(name), `${name} is not a shipped move`).toBe(true);
	});

	it.each(Object.entries(GUIDED_CHARACTER_MOVES))("%s is reachable", (name, guide) => {
		const rollType = MOVES.get(name)?.system?.rollType ?? "";
		// Named outright by a caller — the only other door in. Both spellings, because a move
		// name with a space in it can only be reached through the bracket form.
		const byName = SHEET_JS.includes(`GUIDED_CHARACTER_MOVES.${name}`)
			|| SHEET_JS.includes(`GUIDED_CHARACTER_MOVES["${name}"]`);
		expect(
			Boolean(guide.roll) || Boolean(rollType) || byName,
			`"${name}" has no rollType (so no dice icon, so no .rollable), no \`roll\` of its own, `
			+ "and nothing names it — nothing can open its dialog. Either give it a way in or drop it: "
			+ "clicking the move posts its printed text, which is where its options already live.",
		).toBe(true);
	});

	// The dialog is reference plus what has to be answered before the dice. Two things it must
	// not hold: a write-in box (nothing stored what was typed into one), and a tier-gated tick
	// list (Forage's "10+ pick 2, 7-9 pick 1" cannot be chosen until the dice have said which).
	it("asks for nothing the sheet would throw away", () => {
		for (const [name, guide] of Object.entries(GUIDED_CHARACTER_MOVES)) {
			expect(guide.fields, `${name} declares fields`).toBeUndefined();
			expect(guide.picks, `${name} declares a pre-roll pick list`).toBeUndefined();
		}
	});
});
