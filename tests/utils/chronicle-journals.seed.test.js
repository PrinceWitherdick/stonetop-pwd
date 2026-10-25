import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	seedChroniclePages,
	ensureChronicleFolder,
	ensureChronicleJournal,
	findChronicleFolder,
	findChronicleJournal,
	withChronicleLock,
	CHRONICLE_QA_FLAG,
	CHRONICLE_NAME_FLAG,
	CHRONICLE_FOLDER_FLAG,
	CHRONICLE_JOURNAL_FLAG,
} from "../../module/utils/chronicle-journals.js";
import { qaSourceKey } from "../../module/utils/chronicle-core.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The seed-and-follow pass against a journal that actually APPLIES what it is sent, so a second
// save reads back what the first one stored: the remembered Q&A pairs, the page names, the order
// new pages land in, and which journals and folder a save finds again.

// Write one update key into plain data the way core does for these: dotted path, with the v13
// "==" (replace) prefix on the last segment.
function applyKey(target, key, value) {
	const parts = key.split(".");
	let node = target;
	for (const part of parts.slice(0, -1)) node = (node[part] ??= {});
	const leaf = parts.at(-1).replace(/^==/, "");
	node[leaf] = value;
}

class FakePage {
	constructor(data, id) { Object.assign(this, structuredClone(data)); this.id = id; }
	getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
	toObject() { return structuredClone({ system: this.system, flags: this.flags }); }
}

function fakeEntry(pages = []) {
	const entry = {
		pages: pages.map((p, i) => new FakePage(p, p._id ?? `old-${i}`)),
		createEmbeddedDocuments: vi.fn(async (_type, docs) => {
			for (const doc of docs) entry.pages.push(new FakePage(doc, `page-${entry.pages.length}`));
		}),
		updateEmbeddedDocuments: vi.fn(async (_type, updates) => {
			for (const { _id, ...change } of updates) {
				const page = entry.pages.find(p => p.id === _id);
				for (const [key, value] of Object.entries(change)) applyKey(page, key, structuredClone(value));
			}
		}),
	};
	return entry;
}

const qa = (heading, rows) => ({
	kind: "qa", heading, group: "glance",
	pairs:    rows.map(([, prompt, answer]) => ({ prompt, answer })),
	pairKeys: rows.map(([q, , answer]) => qaSourceKey(q, answer)),
});
const prose = (heading, body) => ({ kind: "prose", heading, group: "glance", body });

describe("seedChroniclePages: remembered pairs", () => {
	const page = { key: "pc1", name: "Ana", sections: [qa("Bonds & ties", [[0, "Q", "A"], [1, "R", "B"]])] };

	it("stores the written pairs on create, and never the source keys", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [page]);
		const [created] = entry.pages;
		expect(created.system.sections[0]).not.toHaveProperty("pairKeys");
		expect(Object.keys(created.getFlag(SYSTEM_ID, CHRONICLE_QA_FLAG)["Bonds & ties"])).toHaveLength(2);
	});

	it("does not re-add a pair the GM deleted, save after save", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [page]);
		entry.pages[0].system.sections[0].pairs.shift();
		expect(await seedChroniclePages(entry, [page])).toEqual({ created: 0, updated: 0, kept: 0 });
		await seedChroniclePages(entry, [page]);
		expect(entry.pages[0].system.sections[0].pairs).toEqual([{ prompt: "R", answer: "B" }]);
	});

	it("seeds the record on a legacy page without counting it as an update", async () => {
		const entry = fakeEntry([{ name: "Ana", flags: { [SYSTEM_ID]: { chronicleKey: "pc1" } },
			system: { sections: [{ kind: "qa", heading: "Bonds & ties", group: "glance", pairs: [{ prompt: "Old Q", answer: "A" }, { prompt: "R", answer: "B" }] }] } }]);
		expect(await seedChroniclePages(entry, [page])).toEqual({ created: 0, updated: 0, kept: 0 });
		expect(entry.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		// The record now exists, so a GM deletion after this is final.
		entry.pages[0].system.sections[0].pairs = [];
		await seedChroniclePages(entry, [page]);
		expect(entry.pages[0].system.sections[0].pairs).toEqual([]);
	});

	it("replaces the stored record, so a pair we removed leaves it", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [page]);
		await seedChroniclePages(entry, [{ ...page, sections: [qa("Bonds & ties", [[1, "R", "B"]])] }]);
		const sent = entry.updateEmbeddedDocuments.mock.calls[0][1][0];
		expect(Object.keys(sent).some(k => k.endsWith(`==${CHRONICLE_QA_FLAG}`))).toBe(true);
		expect(Object.keys(entry.pages[0].getFlag(SYSTEM_ID, CHRONICLE_QA_FLAG)["Bonds & ties"])).toEqual([qaSourceKey(1, "B")]);
	});

	it("reports sections kept as the GM edited them", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [{ key: "pc1", name: "Ana", sections: [prose("Introduction", "<p>Hi.</p>")] }]);
		entry.pages[0].system.sections[0].body = "<p>The GM's words.</p>";
		const result = await seedChroniclePages(entry, [{ key: "pc1", name: "Ana", sections: [prose("Introduction", "<p>Hello.</p>")] }]);
		expect(result).toEqual({ created: 0, updated: 0, kept: 1 });
	});

	it("never creates a page that has nothing in it, but clears one that exists", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [{ key: "pc2", name: "Bo", sections: [], cleared: ["Introduction"] }]);
		expect(entry.pages).toHaveLength(0);

		await seedChroniclePages(entry, [{ key: "pc1", name: "Ana", sections: [prose("Introduction", "<p>Hi.</p>")] }]);
		const result = await seedChroniclePages(entry, [{ key: "pc1", name: "Ana", sections: [], cleared: ["Introduction"] }]);
		expect(result.updated).toBe(1);
		expect(entry.pages[0].system.sections).toEqual([]);
	});
});

describe("seedChroniclePages: names", () => {
	const named = name => [{ key: "pc1", name, sections: [prose("Introduction", "<p>Hi.</p>")] }];

	it("retitles a PC's page when the PC is renamed, while it wears our name", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, named("Ana — The Blessed"), { followNames: true });
		const result = await seedChroniclePages(entry, named("Anwen — The Blessed"), { followNames: true });
		expect(result.updated).toBe(1);
		expect(entry.pages[0].name).toBe("Anwen — The Blessed");
		expect(entry.pages[0].getFlag(SYSTEM_ID, CHRONICLE_NAME_FLAG)).toBe("Anwen — The Blessed");
	});

	it("keeps a title the GM gave the page", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, named("Ana — The Blessed"), { followNames: true });
		entry.pages[0].name = "Ana, who saw the Things Below";
		await seedChroniclePages(entry, named("Anwen — The Blessed"), { followNames: true });
		expect(entry.pages[0].name).toBe("Ana, who saw the Things Below");
	});

	it("stamps an unstamped page wearing our name without counting it as an update", async () => {
		const entry = fakeEntry([{ name: "Ana", flags: { [SYSTEM_ID]: { chronicleKey: "pc1" } }, system: { sections: [prose("Introduction", "<p>Hi.</p>")] } }]);
		const result = await seedChroniclePages(entry, [{ key: "pc1", name: "Ana", sections: [prose("Introduction", "<p>Hi.</p>")] }], { followNames: true });
		expect(result.updated).toBe(0);
		expect(entry.pages[0].getFlag(SYSTEM_ID, CHRONICLE_NAME_FLAG)).toBe("Ana");
	});
});

describe("seedChroniclePages: order", () => {
	const pc = key => ({ key, name: key, sections: [prose("Introduction", `<p>${key}</p>`)] });

	it("puts a page for an earlier PC before the later PCs already there", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [pc("b"), pc("c")]);
		await seedChroniclePages(entry, [pc("a"), pc("b"), pc("c")]);
		const order = [...entry.pages].sort((x, y) => x.sort - y.sort).map(p => p.flags[SYSTEM_ID].chronicleKey);
		expect(order).toEqual(["a", "b", "c"]);
	});

	it("puts a middle PC between its neighbours", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [pc("a"), pc("c")]);
		await seedChroniclePages(entry, [pc("a"), pc("b"), pc("c")]);
		const order = [...entry.pages].sort((x, y) => x.sort - y.sort).map(p => p.flags[SYSTEM_ID].chronicleKey);
		expect(order).toEqual(["a", "b", "c"]);
	});

	it("moves no page the GM has arranged, and appends when there is no room", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [pc("a"), pc("c")]);
		entry.pages[0].sort = 5; entry.pages[1].sort = 6;
		await seedChroniclePages(entry, [pc("a"), pc("b"), pc("c")]);
		expect(entry.pages.map(p => p.sort)).toEqual([5, 6, 16]);
	});

	it("never ties or jumps a page the GM wrote themselves", async () => {
		// The GM's own intro page at 0, then ours at 10 and 20.
		const entry = fakeEntry([{ name: "Read me first", sort: 0, flags: {}, system: {} }]);
		await seedChroniclePages(entry, [pc("b"), pc("c")]);
		expect(entry.pages.map(p => p.sort)).toEqual([0, 10, 20]);
		await seedChroniclePages(entry, [pc("a"), pc("b"), pc("c")]);
		const order = [...entry.pages].sort((x, y) => x.sort - y.sort).map(p => p.flags?.[SYSTEM_ID]?.chronicleKey ?? p.name);
		expect(order).toEqual(["Read me first", "a", "b", "c"]);
		expect(new Set(entry.pages.map(p => p.sort)).size).toBe(entry.pages.length);
	});
});

describe("finding the Chronicle's folder and journals", () => {
	let folders, journals;
	beforeEach(() => {
		folders = [];
		journals = [];
		globalThis.game = {
			user: { isGM: true },
			folders: { get contents() { return folders; } },
			journal: { get contents() { return journals; } },
		};
		const doc = data => ({
			...data,
			id: `id-${Math.random()}`,
			getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
			async setFlag(scope, key, value) { ((this.flags ??= {})[scope] ??= {})[key] = value; },
			update: vi.fn(),
		});
		globalThis.Folder = { create: vi.fn(async data => { const f = doc(data); folders.push(f); return f; }) };
		globalThis.JournalEntry = { create: vi.fn(async data => { const j = doc({ ...data, folder: { id: data.folder } }); journals.push(j); return j; }) };
	});
	afterEach(() => { delete globalThis.Folder; delete globalThis.JournalEntry; });

	it("stamps the folder it creates, and finds it again after a rename", async () => {
		const folder = await ensureChronicleFolder();
		expect(folder.flags[SYSTEM_ID][CHRONICLE_FOLDER_FLAG]).toBe(true);
		folder.name = "Our Campaign";
		expect(findChronicleFolder()).toBe(folder);
		expect(await ensureChronicleFolder()).toBe(folder);
		expect(Folder.create).toHaveBeenCalledTimes(1);
	});

	it("creates one folder for two asks at once", async () => {
		const [a, b] = await Promise.all([ensureChronicleFolder(), ensureChronicleFolder()]);
		expect(a).toBe(b);
		expect(Folder.create).toHaveBeenCalledTimes(1);
	});

	it("adopts a journal found by name, and then finds it renamed and moved", async () => {
		const folder = await ensureChronicleFolder();
		journals.push({ name: "Player Introductions", folder: { id: folder.id }, ownership: { default: 0 },
			getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
			async setFlag(scope, key, value) { ((this.flags ??= {})[scope] ??= {})[key] = value; } });
		const found = await ensureChronicleJournal("Player Introductions", 2);
		expect(found.flags[SYSTEM_ID][CHRONICLE_JOURNAL_FLAG]).toBe("Player Introductions");
		found.name = "Who we are";
		found.folder = null;
		expect(findChronicleJournal("Player Introductions")).toBe(found);
		expect(JournalEntry.create).not.toHaveBeenCalled();
	});

	it("opens a journal to players when it creates it, and never resets the GM's choice after", async () => {
		const made = await ensureChronicleJournal("Places of Interest", 2);
		expect(JournalEntry.create.mock.calls[0][0].ownership).toEqual({ default: 2 });
		made.ownership = { default: 0 };
		await ensureChronicleJournal("Places of Interest", 2);
		expect(made.update).not.toHaveBeenCalled();
		expect(made.ownership.default).toBe(0);
	});

	// The folder is made only when a journal has to be, and once however many ask at once.
	it("makes the folder for the first journal, and one of each for two asks at once", async () => {
		const [a, b] = await Promise.all([ensureChronicleJournal("Seasons Change", 2), ensureChronicleJournal("Seasons Change", 2)]);
		expect(a).toBe(b);
		expect(Folder.create).toHaveBeenCalledTimes(1);
		expect(JournalEntry.create).toHaveBeenCalledTimes(1);
		expect(a.folder.id).toBe(folders[0].id);
		await ensureChronicleJournal("Timeline", 3);
		expect(Folder.create).toHaveBeenCalledTimes(1);
	});
});

describe("withChronicleLock", () => {
	it("runs one journal's page passes one after another, and survives a failure", async () => {
		const log = [];
		let release;
		const journal = { id: "j1" };
		const first = withChronicleLock(journal, () => new Promise(r => { release = r; }).then(() => log.push("first")));
		const failing = withChronicleLock(journal, async () => { log.push("second"); throw new Error("boom"); });
		const third = withChronicleLock(journal, async () => log.push("third"));
		await new Promise(r => setTimeout(r, 0));
		expect(log).toEqual([]);
		release();
		await first;
		await expect(failing).rejects.toThrow("boom");
		await third;
		expect(log).toEqual(["first", "second", "third"]);
	});
});

describe("seedChroniclePages, twice at once", () => {
	const page = key => ({ key, name: key, sections: [prose("Notes", `<p>${key}</p>`)] });

	it("creates a page once when two passes overlap on a slow journal", async () => {
		const entry = fakeEntry();
		entry.id = "slow";
		const create = entry.createEmbeddedDocuments.getMockImplementation();
		entry.createEmbeddedDocuments.mockImplementation(async (...args) => {
			await new Promise(r => setTimeout(r, 5));
			return create(...args);
		});
		await Promise.all([seedChroniclePages(entry, [page("a")]), seedChroniclePages(entry, [page("a")])]);
		expect(entry.pages).toHaveLength(1);
	});

	it("reads a list given as a function only when its turn comes", async () => {
		const entry = fakeEntry();
		entry.id = "late";
		let release;
		const gate = new Promise(r => { release = r; });
		const held = withChronicleLock(entry, () => gate);
		let source = [page("old")];
		const pass = seedChroniclePages(entry, () => source);
		source = [page("new")];
		release();
		await held;
		await pass;
		expect(entry.pages.map(p => p.flags[SYSTEM_ID].chronicleKey)).toEqual(["new"]);
	});
});
