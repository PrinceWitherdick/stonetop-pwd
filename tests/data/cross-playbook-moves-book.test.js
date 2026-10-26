// Level-up audit 2026-10-23 (PBB-4): the seven cross-playbook moves, pinned to the book. Each one's
// list of playbooks, its repeat boxes (counted on the rendered pages), its level and playbook lock,
// and the Initiate's pouch, as printed in Book I:
//   Wild Soul (p.107): "gain a Ranger move of your choice for which you qualify", 2 boxes.
//   Dabbler (p.110): "a move from the Heavy, Marshal, Ranger, or Seeker playbooks", 3 boxes.
//   Seasoned Warrior (p.115): "from the Fox, Marshal, Ranger, or Seeker playbooks", 3 boxes.
//   Arts of War (p.126): "from the Fox, Heavy, Judge, Ranger, or Seeker playbooks", 2 boxes.
//   Worldly (p.131): "from the Blessed, Fox, Heavy, Marshal, or Seeker playbooks", 2 boxes.
//   Initiate of the Secret Arts (p.134): a "Sacred Pouch" and "a Blessed move", 3 boxes.
//   Versatile (p.139): "a move from any other playbook", 4 boxes.

import { describe, it, expect } from "vitest";
import { loadPlaybookMoveDocs } from "../fakes/sourcePack.js";

const BOOK = {
	"Wild Soul":                   { home: "The Blessed",       playbooks: ["The Ranger"], repeat: 2 },
	"Dabbler":                     { home: "The Fox",           playbooks: ["The Heavy", "The Marshal", "The Ranger", "The Seeker"], repeat: 3 },
	"Seasoned Warrior":            { home: "The Heavy",         playbooks: ["The Fox", "The Marshal", "The Ranger", "The Seeker"], repeat: 3 },
	"Arts of War":                 { home: "The Marshal",       playbooks: ["The Fox", "The Heavy", "The Judge", "The Ranger", "The Seeker"], repeat: 2 },
	"Worldly":                     { home: "The Ranger",        playbooks: ["The Blessed", "The Fox", "The Heavy", "The Marshal", "The Seeker"], repeat: 2 },
	"Initiate of the Secret Arts": { home: "The Seeker",        playbooks: ["The Blessed"], repeat: 3, grantsPossession: "sacred-pouch" },
	"Versatile":                   { home: "The Would-Be Hero", playbooks: "any", repeat: 4 },
};

const CROSS = loadPlaybookMoveDocs().filter(d => d.system?.crossPlaybook);

describe("the cross-playbook moves match the book", () => {
	it("there are exactly the seven", () => {
		expect(CROSS.map(d => d.name).sort()).toEqual(Object.keys(BOOK).sort());
	});

	it.each(Object.entries(BOOK))("%s: its playbooks, repeat boxes, level 2 and its own playbook's lock", (name, book) => {
		const doc = CROSS.find(d => d.name === name);
		expect(doc.system.playbook).toBe(book.home);
		const listed = doc.system.crossPlaybook.playbooks;
		expect(listed === "any" ? "any" : [...listed].sort()).toEqual(book.playbooks === "any" ? "any" : [...book.playbooks].sort());
		expect(doc.system.repeatMax).toBe(book.repeat);
		expect(doc.system.requirement).toMatchObject({ level: 2, playbook: book.home });
		expect(doc.system.crossPlaybook.grantsPossession ?? null).toBe(book.grantsPossession ?? null);
	});
});
