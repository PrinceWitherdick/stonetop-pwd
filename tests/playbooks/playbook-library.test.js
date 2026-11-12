import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	libraryFileName, slugOfLibraryFile, libraryEntry, libraryFileData, tombstoneData, sameContent,
	planAdoption, adoptLibraryPlaybooks, removeFromLibrary, registerPlaybookLibrary, forgottenSlugs,
	libraryPlaybooksNotHere, LIBRARY_DIR, FORGOTTEN_LIBRARY_SETTING,
} from "../../module/playbooks/playbook-library.js";
import { saveHomebrewPlaybook, setPlaybookLibrary, readHomebrewBundle } from "../../module/playbooks/homebrew-store.js";
import { normalizeBundle } from "../../module/playbooks/homebrew-bundle.js";
import { invalidatePlaybookCatalog, homebrewPlaybookBySlug } from "../../module/playbooks/playbook-catalog.js";

const SLUG = "homebrew-the-tester";

function tester(name = "The Tester", { published = true, prod = "Poke it." } = {}) {
	return normalizeBundle({
		format: "stonetop-homebrew-playbook", version: 1,
		playbook: { name, hp: 16, damage: "d6", published, possessions: { pickCount: 0, options: [] } },
		moves: [{ name: "Prod", description: prod, starting: true }, { name: "Poke", description: "Gently." }],
	}).bundle;
}

const entry = (slug, savedAt, bundle = tester(), extra = {}) => ({ slug, savedAt, removed: false, bundle, path: `${LIBRARY_DIR}/${slug}.stonetop-playbook.json`, ...extra });

describe("library files", () => {
	it("are named by slug, which a rename never changes", () => {
		expect(libraryFileName(SLUG)).toBe("homebrew-the-tester.stonetop-playbook.json");
		expect(slugOfLibraryFile(`${LIBRARY_DIR}/homebrew-the-tester.stonetop-playbook.json?x=1`)).toBe(SLUG);
		expect(slugOfLibraryFile("https://assets.example/u1/stonetop-playbooks/Homebrew-The-Tester.stonetop-playbook.json")).toBe(SLUG);
		expect(slugOfLibraryFile(`${LIBRARY_DIR}/notes.json`)).toBeNull();
		expect(slugOfLibraryFile(`${LIBRARY_DIR}/homebrew-.stonetop-playbook.json`)).toBeNull();
	});

	it("read back to the bundle, its slug and when it was saved", () => {
		const data = libraryFileData(tester(), SLUG, "2026-11-11T10:00:00.000Z");
		const read = libraryEntry(JSON.parse(JSON.stringify(data)), `${LIBRARY_DIR}/x.json`);
		expect(read.slug).toBe(SLUG);
		expect(read.savedAt).toBe("2026-11-11T10:00:00.000Z");
		expect(read.removed).toBe(false);
		expect(read.bundle.playbook.slug).toBe(SLUG);
		expect(read.bundle.moves.map(m => m.name)).toEqual(["Prod", "Poke"]);
	});

	it("take the slug from the file name when the file has none", () => {
		const data = libraryFileData(tester(), SLUG, "t");
		delete data.slug;
		data.playbook.slug = "";
		expect(libraryEntry(data, `${LIBRARY_DIR}/${libraryFileName(SLUG)}`).slug).toBe(SLUG);
	});

	it("can be a tombstone, and a file that isn't ours is nothing", () => {
		expect(libraryEntry(tombstoneData(SLUG, "t"))).toMatchObject({ slug: SLUG, removed: true, bundle: null });
		expect(libraryEntry({ hello: 1 }, "x")).toBeNull();
		expect(libraryEntry(null, "x")).toBeNull();
	});
});

describe("sameContent", () => {
	it("ignores Show to players, the slug and move order", () => {
		const a = tester("The Tester", { published: true });
		const b = tester("The Tester", { published: false });
		b.playbook.slug = SLUG;
		b.moves.reverse();
		expect(sameContent(a, b)).toBe(true);
	});
	it("sees a reworded move", () => {
		expect(sameContent(tester(), tester("The Tester", { prod: "Shove it." }))).toBe(false);
	});
});

describe("planAdoption", () => {
	const here = (slug, librarySavedAt, bundle = tester(), name = bundle.playbook.name) => ({ slug, name, librarySavedAt, bundle });

	it("adds what the world lacks, but not what it deleted, a tombstone, or a name it already has", () => {
		const plan = planAdoption({
			library: [
				entry(SLUG, "2026-11-11T10:00:00Z"),
				entry("homebrew-gone", "2026-11-11T10:00:00Z", tester("Gone")),
				entry("homebrew-out", "2026-11-11T10:00:00Z", null, { removed: true }),
				entry("homebrew-twin", "2026-11-11T10:00:00Z", tester("Local Twin")),
			],
			world: [here("homebrew-local", "", tester("Local Twin"))],
			forgotten: { "homebrew-gone": true },
		});
		expect(plan.add.map(e => e.slug)).toEqual([SLUG]);
		expect(plan.offer).toEqual([]);
	});

	it("offers a newer, different version and only that", () => {
		const plan = planAdoption({
			library: [
				entry(SLUG, "2026-11-11T12:00:00Z", tester("The Tester", { prod: "Shove it." })),
				entry("homebrew-older", "2026-11-11T09:00:00Z", tester("Older", { prod: "Shove it." })),
				entry("homebrew-same", "2026-11-11T09:00:00Z", tester("Same")),
				entry("homebrew-equal", "2026-11-11T09:00:00Z", tester("Equal", { prod: "Shove it." })),
			],
			world: [
				here(SLUG, "2026-11-11T10:00:00Z"),
				here("homebrew-older", "2026-11-11T10:00:00Z", tester("Older")),
				here("homebrew-same", "", tester("Same", { published: false })),
				here("homebrew-equal", "2026-11-11T09:00:00Z", tester("Equal")),
			],
		});
		expect(plan.offer.map(o => o.entry.slug)).toEqual([SLUG]);
		expect(plan.settle.map(o => o.entry.slug)).toEqual(["homebrew-same"]);
		expect(plan.add).toEqual([]);
		expect(plan.backfill).toEqual([]);
	});

	it("backfills the world's playbooks the library has no file for", () => {
		const plan = planAdoption({ library: [], world: [here(SLUG, "")] });
		expect(plan.backfill.map(w => w.slug)).toEqual([SLUG]);
	});

	it("never backfills one whose library file is there but couldn't be read", () => {
		const plan = planAdoption({ library: [], world: [here(SLUG, "")], unreadable: [SLUG] });
		expect(plan.backfill).toEqual([]);
	});

	it("reads one file listed twice (a host's two spellings) once, the latest", () => {
		const plan = planAdoption({
			library: [entry(SLUG, "2026-11-11T09:00:00Z", tester("Old Name")), entry(SLUG, "2026-11-11T10:00:00Z")],
			world: [],
		});
		expect(plan.add).toHaveLength(1);
		expect(plan.add[0].bundle.playbook.name).toBe("The Tester");
	});
});

// ---- Against a fake world and a fake server -------------------------------------------------

function setPath(obj, path, value) {
	const keys = path.split(".");
	const last = keys.pop();
	let o = obj;
	for (const k of keys) o = o[k] ??= {};
	o[last] = value;
}

function world() {
	const items = [];
	let n = 0;
	const make = data => {
		const item = { ...structuredClone(data), id: `i${++n}`, _id: `i${n}`, uuid: `Item.i${n}`, parent: null };
		item.update = vi.fn(async patch => {
			for (const [k, v] of Object.entries(patch)) {
				if (k.includes(".")) setPath(item, k, v);
				else if (v && typeof v === "object" && !Array.isArray(v) && item[k] && typeof item[k] === "object") item[k] = foundryMerge(item[k], v);
				else item[k] = v;
			}
			invalidatePlaybookCatalog();
		});
		item.delete = vi.fn(async () => { items.splice(items.indexOf(item), 1); invalidatePlaybookCatalog(); });
		items.push(item);
		return item;
	};
	items.get = id => items.find(i => i.id === id) ?? null;
	vi.stubGlobal("Item", {
		create: vi.fn(async data => { const i = make(data); invalidatePlaybookCatalog(); return i; }),
		createDocuments: vi.fn(async list => list.map(make)),
		updateDocuments: vi.fn(async list => list.map(u => { const i = items.get(u._id); Object.assign(i, structuredClone(u)); return i; })),
		deleteDocuments: vi.fn(async ids => ids.forEach(id => items.splice(items.findIndex(i => i.id === id), 1))),
	});
	vi.stubGlobal("Folder", { create: vi.fn(async data => ({ ...data, id: `f${n}`, type: "Item" })) });
	return items;
}
/** Foundry's update merges nested objects; enough of that for the store's own update. */
function foundryMerge(a, b) {
	const out = { ...a };
	for (const [k, v] of Object.entries(b)) {
		out[k] = v && typeof v === "object" && !Array.isArray(v) && a?.[k] && typeof a[k] === "object" ? foundryMerge(a[k], v) : v;
	}
	return out;
}

/** The server's data folder: what's uploaded can be browsed and fetched. */
function server({ refuseUploads = false } = {}) {
	const files = new Map();
	// What the host does wrong, for the tests that ask: a refused browse, a file that won't fetch.
	const faults = { refuseBrowse: false, failFetch: new Set() };
	const FilePicker = {
		browse: vi.fn(async (_src, dir) => {
			if (faults.refuseBrowse) throw new Error("browse refused");
			return { files: [...files.keys()].filter(p => p.startsWith(`${dir}/`)) };
		}),
		upload: vi.fn(async (_src, dir, file) => {
			if (refuseUploads) return false;
			files.set(`${dir}/${file.name}`, await file.text());
			return { path: `${dir}/${file.name}` };
		}),
		createDirectory: vi.fn(async () => {}),
	};
	vi.stubGlobal("FilePicker", FilePicker);
	vi.stubGlobal("fetch", vi.fn(async url => {
		const key = String(url).replace(/^\/+/, "");
		if (faults.failFetch.has(key)) return { ok: false, status: 503, json: async () => null };
		const body = files.get(key);
		return body === undefined ? { ok: false, status: 404, json: async () => null } : { ok: true, status: 200, json: async () => JSON.parse(body) };
	}));
	return { files, faults, FilePicker, read: slug => JSON.parse(files.get(`${LIBRARY_DIR}/${libraryFileName(slug)}`) ?? "null") };
}

let hooks;
function boot({ refuseUploads = false } = {}) {
	invalidatePlaybookCatalog();
	const items = world();
	const disk = server({ refuseUploads });
	const settings = new Map();
	hooks = {};
	vi.stubGlobal("Hooks", { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, once: () => {}, callAll: () => {} });
	vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
	vi.stubGlobal("game", {
		items, folders: [], actors: [], users: [], system: { version: "test" },
		user: { id: "gm1", isGM: true },
		settings: {
			get: (_s, key) => settings.get(key),
			set: vi.fn(async (_s, key, value) => { settings.set(key, value); }),
		},
		i18n: { lang: "en" },
	});
	registerPlaybookLibrary();
	return { items, disk, settings };
}

describe("saving puts a playbook in the library", () => {
	beforeEach(() => boot());
	afterEach(() => { setPlaybookLibrary(null); vi.unstubAllGlobals(); invalidatePlaybookCatalog(); });

	it("writes the file by slug and records which version this world has", async () => {
		const { disk } = boot();
		const { item } = await saveHomebrewPlaybook(tester());
		const file = disk.read(item.system.slug);
		expect(file.format).toBe("stonetop-homebrew-playbook");
		expect(file.slug).toBe(item.system.slug);
		expect(file.playbook.name).toBe("The Tester");
		expect(item.flags.stonetop.homebrew.librarySavedAt).toBe(file.savedAt);
	});

	it("a refused upload still saves the world, and says why the other worlds won't get it", async () => {
		boot({ refuseUploads: true });
		const { item } = await saveHomebrewPlaybook(tester());
		expect(homebrewPlaybookBySlug(item.system.slug)).toBe(item);
		expect(ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("couldn't be copied to your playbook library"));
	});

	it("a playbook taken out of sharing stays out when it's saved again", async () => {
		const { disk } = boot();
		const { item } = await saveHomebrewPlaybook(tester());
		expect(await removeFromLibrary(item)).toBe(true);
		await saveHomebrewPlaybook(tester("The Tester", { prod: "Shove it." }), { existing: item });
		expect(disk.read(item.system.slug).removed).toBe(true);
	});

	it("deleting it here is remembered; saving it here again forgets that", async () => {
		const { item } = await saveHomebrewPlaybook(tester());
		const slug = item.system.slug;
		for (const fn of hooks.deleteItem) fn(item, {}, "gm1");
		await vi.waitFor(() => expect(forgottenSlugs()[slug]).toBe(true));
		// Another user's delete, or a character's own copy, is not this GM's.
		for (const fn of hooks.deleteItem) fn({ ...item, system: { slug: "homebrew-x" }, type: "playbook" }, {}, "someone-else");
		expect(forgottenSlugs()["homebrew-x"]).toBeUndefined();
		await saveHomebrewPlaybook(tester(), { existing: item });
		expect(forgottenSlugs()[slug]).toBeUndefined();
	});
});

describe("a world loading the library", () => {
	afterEach(() => { setPlaybookLibrary(null); vi.unstubAllGlobals(); invalidatePlaybookCatalog(); });

	/** World A saves a playbook; then the same server is loaded as World B, empty. */
	async function secondWorld(bundle = tester()) {
		const { disk } = boot();
		const { item } = await saveHomebrewPlaybook(bundle);
		const slug = item.system.slug;
		const files = new Map(disk.files);
		const b = boot();
		for (const [k, v] of files) b.disk.files.set(k, v);
		return { slug, ...b };
	}

	it("gets what it lacks under the same slug, without writing it back", async () => {
		const { slug, disk } = await secondWorld();
		const before = disk.read(slug).savedAt;
		const afterAdding = vi.fn();
		const result = await adoptLibraryPlaybooks({ afterAdding });
		expect(result.added).toEqual(["The Tester"]);
		const here = homebrewPlaybookBySlug(slug);
		expect(here).toBeTruthy();
		expect(readHomebrewBundle(here).moves.map(m => m.name).sort()).toEqual(["Poke", "Prod"]);
		expect(here.flags.stonetop.homebrew.librarySavedAt).toBe(before);
		expect(disk.read(slug).savedAt).toBe(before);
		expect(afterAdding).toHaveBeenCalledTimes(1);
		expect(ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("Added The Tester from your playbook library"));
	});

	it("doesn't bring back one deleted here", async () => {
		const { slug, settings } = await secondWorld();
		settings.set(FORGOTTEN_LIBRARY_SETTING, { [slug]: true });
		expect((await adoptLibraryPlaybooks()).added).toEqual([]);
		// ...but Add from my library still lists it.
		expect((await libraryPlaybooksNotHere()).map(e => e.slug)).toEqual([slug]);
	});

	it("puts an older playbook of its own into the library", async () => {
		const { disk } = boot();
		setPlaybookLibrary(null);
		const { item } = await saveHomebrewPlaybook(tester("Before The Library"));
		registerPlaybookLibrary();
		expect(disk.files.size).toBe(0);
		expect((await adoptLibraryPlaybooks()).backfilled).toBe(1);
		expect(disk.read(item.system.slug).playbook.name).toBe("Before The Library");
	});

	it("adds a library playbook HIDDEN from players, whatever the other world showed", async () => {
		const { slug } = await secondWorld(tester("The Tester", { published: true }));
		await adoptLibraryPlaybooks();
		expect(readHomebrewBundle(homebrewPlaybookBySlug(slug)).playbook.published).toBe(false);
		expect(ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("hidden from players' picker"));
	});

	/** This world holds an OLDER copy than the library's, which another world has since saved over. */
	async function olderHere() {
		const { slug, disk } = await secondWorld();
		await adoptLibraryPlaybooks();
		const path = `${LIBRARY_DIR}/${libraryFileName(slug)}`;
		const newer = JSON.parse(disk.files.get(path));
		newer.savedAt = "2099-01-01T00:00:00.000Z";
		newer.playbook.name = "The Tester Revised";
		disk.files.set(path, JSON.stringify(newer));
		return { slug, disk, path };
	}

	it("a library file that won't fetch is never overwritten by this world's older copy", async () => {
		const { slug, disk, path } = await olderHere();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		disk.faults.failFetch.add(path);
		expect((await adoptLibraryPlaybooks()).backfilled).toBe(0);
		expect(disk.read(slug).playbook.name).toBe("The Tester Revised");
		warn.mockRestore();
	});

	it("a refused browse writes nothing over a file that's there, and still backfills one that's truly absent", async () => {
		const { slug, disk } = await olderHere();
		disk.faults.refuseBrowse = true;
		expect((await adoptLibraryPlaybooks()).backfilled).toBe(0);
		expect(disk.read(slug).playbook.name).toBe("The Tester Revised");
		// A playbook made before the library, with no file anywhere: the probe's 404 lets it in.
		setPlaybookLibrary(null);
		const { item } = await saveHomebrewPlaybook(tester("Before The Library"));
		registerPlaybookLibrary();
		expect((await adoptLibraryPlaybooks()).backfilled).toBe(1);
		expect(disk.read(item.system.slug).playbook.name).toBe("Before The Library");
	});

	it("a save writes nothing over a tombstone it can't see through a refused browse", async () => {
		const { disk } = boot();
		const { item } = await saveHomebrewPlaybook(tester());
		expect(await removeFromLibrary(item)).toBe(true);
		disk.faults.refuseBrowse = true;
		await saveHomebrewPlaybook(tester("The Tester", { prod: "Shove it." }), { existing: item });
		expect(disk.read(item.system.slug).removed).toBe(true);
	});

	it("a player's client does nothing", async () => {
		await secondWorld();
		game.user.isGM = false;
		expect((await adoptLibraryPlaybooks()).added).toEqual([]);
	});
});
