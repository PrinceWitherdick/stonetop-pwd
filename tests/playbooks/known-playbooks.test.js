import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex, sha256Bytes } from "../../module/utils/sha256.js";
import {
	KNOWN_PLAYBOOKS, textKey, knownPlaybookFor, glyphTablesFor, settleKnownDraft, draftSettled, finishKnownBundle,
} from "../../module/playbooks/known/known-playbooks.js";

const hex = bytes => Buffer.from(bytes).toString("hex");

describe("sha256", () => {
	it("digests as sha256sum does, worked out here and by the browser's own", async () => {
		for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "x".repeat(1000)]) {
			const bytes = new TextEncoder().encode(s);
			const want = createHash("sha256").update(s).digest("hex");
			expect(hex(sha256Bytes(bytes))).toBe(want);
			expect(await sha256Hex(bytes)).toBe(want);
		}
	});

	it("works it out without crypto.subtle, as on a Foundry served over plain http", async () => {
		const real = Object.getOwnPropertyDescriptor(globalThis, "crypto");
		Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
		try {
			expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(createHash("sha256").update("abc").digest("hex"));
		} finally {
			if (real) Object.defineProperty(globalThis, "crypto", real);
		}
	});
});

describe("known playbooks: what is kept", () => {
	it("names each printing by a whole sha256 digest", () => {
		for (const k of KNOWN_PLAYBOOKS) {
			expect(k.id).toMatch(/^[a-z0-9-]+$/);
			expect(k.sha256.length).toBeGreaterThan(0);
			for (const d of k.sha256) expect(d).toMatch(/^[0-9a-f]{64}$/);
		}
		expect(new Set(KNOWN_PLAYBOOKS.flatMap(k => k.sha256)).size).toBe(KNOWN_PLAYBOOKS.flatMap(k => k.sha256).length);
	});

	it("keeps no words of a playbook: every piece is named by a key, every answer is a key or a kind", () => {
		const KEY = /^[0-9a-z]{6,12}$/;
		const KINDS = ["background", "instinct", "possession", "startingMove", "move", "question", "note", "skip"];
		for (const k of KNOWN_PLAYBOOKS) {
			for (const [key, kind] of Object.entries(k.settle ?? {})) { expect(key).toMatch(KEY); expect(KINDS).toContain(kind); }
			for (const [q, key] of Object.entries(k.answers ?? {})) { expect(q).toMatch(/^[a-z]+:[a-z0-9]+$/); expect(key).toMatch(KEY); }
			for (const [key, fix] of Object.entries(k.backgrounds ?? {})) {
				expect(key).toMatch(KEY);
				for (const m of [...(fix.moves ?? []), ...(fix.possessions ?? [])]) expect(m).toMatch(KEY);
			}
		}
	});

	it("keeps a glyph table of single letters, ligatures, marks and dingbats, never words", () => {
		const tables = glyphTablesFor();
		expect(tables.length).toBeGreaterThan(0);
		for (const t of tables) {
			for (const raw of Object.values(t.glyphs)) {
				if (!raw) continue;
				const [text, face] = raw.split("\t");
				expect(text.length).toBeLessThanOrEqual(3);
				expect(Object.keys(t.fonts)).toContain(face);
			}
			for (const s of t.spaces ?? []) expect(s).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
		}
	});

	it("tries the known playbook's own glyph table first", () => {
		const own = KNOWN_PLAYBOOKS.find(k => k.glyphs);
		expect(glyphTablesFor(own)[0]).toBe(own.glyphs);
		expect(glyphTablesFor(null)).toContain(own.glyphs);
	});

	it("recognises nothing it doesn't know", async () => {
		expect(await knownPlaybookFor(new TextEncoder().encode("%PDF-1.4 not a playbook"))).toBeNull();
	});
});

describe("known playbooks: settling a read", () => {
	it("keys words by their letters and digits alone", () => {
		expect(textKey("I Myself Am... Strange and Unusual")).toBe(textKey("i myself am strange AND unusual"));
		expect(textKey("Lady’s Door")).toBe(textKey("Ladys Door"));
		expect(textKey("Lady's Door")).not.toBe(textKey("Lady's Doors"));
	});

	const known = {
		id: "test",
		sha256: [],
		settle: { [textKey("Opening words")]: "note", [textKey("Blank move")]: "skip" },
		answers: { "insert:i1": textKey("Open the Book") },
		backgrounds: { [textKey("The Heir")]: { moves: [textKey("Open the Book")], possessions: [textKey("Lantern")] } },
	};
	const draft = () => ({
		confirm: [{ key: "insert:i1", value: null }],
		blocks: [
			{ kind: "question", title: "Opening words", unsure: true },
			{ kind: "skip", title: "Blank move", unsure: true },
			{ kind: "move", title: "Open the Book", unsure: false },
		],
	});

	it("settles its unsure pieces and answers its questions, so nothing is left to ask", () => {
		const d = draft();
		expect(draftSettled(d)).toBe(false);
		expect(settleKnownDraft(d, known)).toBe(true);
		expect(d.blocks.map(b => [b.kind, b.unsure])).toEqual([["note", false], ["skip", false], ["move", false]]);
		expect(d.confirm[0].value).toBe("Open the Book");
	});

	it("leaves the review to the GM when a piece it doesn't know is unsure", () => {
		const d = draft();
		d.blocks.push({ kind: "note", title: "Something new in a later printing", unsure: true });
		expect(settleKnownDraft(d, known)).toBe(false);
		expect(d.blocks[0].unsure).toBe(false);
	});

	it("links a background's moves and possessions by the playbook's own names", () => {
		const bundle = {
			playbook: { backgrounds: [{ label: "The Heir", moves: ["Opne the Bok"], possessions: [] }], possessions: { options: [{ label: "Lantern" }] } },
			moves: [{ name: "Open the Book" }],
		};
		finishKnownBundle(bundle, known);
		expect(bundle.playbook.backgrounds[0]).toMatchObject({ moves: ["Open the Book"], possessions: ["Lantern"] });
	});
});
