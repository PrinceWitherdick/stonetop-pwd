import { describe, it, expect, vi, beforeEach } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";

// writeChronicle end to end against a fake world: which journals a save makes, what it tells the
// GM, and that two saves at once make one of everything.

let settings = {};
vi.mock("../../module/settings.js", () => ({ getSetting: key => settings[key] }));
vi.mock("../../module/utils/places-chronicle.js", () => ({ writePlacesOfInterest: vi.fn(async () => null) }));
let roster = [];
vi.mock("../../module/utils/introductions-order.js", () => ({ introductionsRoster: () => roster }));
vi.mock("../../module/utils/playbook-actors.js", () => ({ playbookSlug: a => a.slug ?? "" }));

const { writeChronicle } = await import("../../module/utils/chronicle.js");

let folders, journals, notices;
function doc(data) {
	return {
		...data,
		id: `id-${Math.random().toString(36).slice(2)}`,
		getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
		async setFlag(scope, key, value) { ((this.flags ??= {})[scope] ??= {})[key] = value; },
	};
}
function journal(data) {
	const j = doc({ ...data, folder: data.folder ? { id: data.folder } : null, pages: [] });
	j.createEmbeddedDocuments = vi.fn(async (_t, docs) => {
		// A slow server, so overlapping saves really overlap.
		await new Promise(r => setTimeout(r, 5));
		for (const d of docs) j.pages.push(doc({ ...d, toObject() { return structuredClone({ system: this.system, flags: this.flags }); } }));
	});
	j.updateEmbeddedDocuments = vi.fn(async () => {});
	return j;
}

beforeEach(() => {
	settings = {};
	roster = [];
	folders = [];
	journals = [];
	notices = [];
	globalThis.CONST = { ...(globalThis.CONST ?? {}), DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
	globalThis.game = {
		user: { isGM: true },
		folders: { get contents() { return folders; } },
		journal: { get contents() { return journals; } },
	};
	globalThis.ui = { notifications: { info: m => notices.push(m), warn: m => notices.push(m) } };
	globalThis.Folder = { create: vi.fn(async data => {
		await new Promise(r => setTimeout(r, 5));
		const f = doc(data); folders.push(f); return f;
	}) };
	globalThis.JournalEntry = { create: vi.fn(async data => {
		await new Promise(r => setTimeout(r, 5));
		const j = journal(data); journals.push(j); return j;
	}) };
});

const named = name => journals.filter(j => j.name === name);

describe("writeChronicle", () => {
	it("makes no Player Introductions journal for a save with only trips in it", async () => {
		settings.expeditionAnswers = { list: [{ id: "t1", title: "North", running: "Cold." }] };
		const result = await writeChronicle();
		expect(named("Player Introductions")).toHaveLength(0);
		expect(named("Expeditions")).toHaveLength(1);
		expect(result).toBe(named("Expeditions")[0]);
	});

	it("makes one folder, one journal and one page for two saves at once", async () => {
		roster = [{ id: "pc1", name: "Ana", system: { playbook: { name: "The Blessed" } } }];
		settings.introductionsAnswers = { pc1: { r1: "Hi." } };
		await Promise.all([writeChronicle({ silent: true }), writeChronicle()]);
		expect(folders).toHaveLength(1);
		expect(named("Player Introductions")).toHaveLength(1);
		expect(named("Player Introductions")[0].pages).toHaveLength(1);
	});

	it("says what it kept as edited rather than that everything is up to date", async () => {
		roster = [{ id: "pc1", name: "Ana", system: { playbook: { name: "" } } }];
		settings.introductionsAnswers = { pc1: { r1: "Hi." } };
		await writeChronicle({ silent: true });
		const page = named("Player Introductions")[0].pages[0];
		page.system.sections[0].body = "<p>The GM's words.</p>";
		settings.introductionsAnswers = { pc1: { r1: "Hello." } };
		await writeChronicle();
		expect(notices.at(-1)).toBe("Chronicle: nothing new to add; 1 section was left as edited in the journal.");
	});

	it("keeps writing to a journal the GM renamed, closed to players and moved", async () => {
		roster = [{ id: "pc1", name: "Ana", system: { playbook: { name: "" } } }];
		settings.introductionsAnswers = { pc1: { r1: "Hi." } };
		await writeChronicle({ silent: true });
		const [intro] = named("Player Introductions");
		expect(intro.flags[SYSTEM_ID].chronicleJournal).toBe("Player Introductions");
		intro.name = "Who we are";
		intro.folder = null;
		intro.ownership = { default: 0 };
		roster.push({ id: "pc2", name: "Bo", system: { playbook: { name: "" } } });
		settings.introductionsAnswers.pc2 = { r1: "Yo." };
		await writeChronicle();
		expect(journals).toHaveLength(1);
		expect(intro.pages).toHaveLength(2);
		expect(intro.ownership.default).toBe(0);
	});

	it("stamps a journal and folder seeded before the stamp existed, so renaming them after the save makes no copy", async () => {
		const folder = doc({ name: "The Chronicle", type: "JournalEntry" });
		folders.push(folder);
		const legacy = journal({ name: "Player Introductions", folder: folder.id });
		journals.push(legacy);
		roster = [{ id: "pc1", name: "Ana", system: { playbook: { name: "" } } }];
		settings.introductionsAnswers = { pc1: { r1: "Hi." } };
		await writeChronicle();
		expect(legacy.flags?.[SYSTEM_ID]?.chronicleJournal).toBe("Player Introductions");
		expect(folder.flags?.[SYSTEM_ID]?.chronicleFolder).toBe(true);
		folder.name = "Our Campaign";
		legacy.name = "Who we are";
		await writeChronicle();
		expect(folders).toHaveLength(1);
		expect(journals).toHaveLength(1);
	});
});
