import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { reapplyBook2ArtOnVersionChange, reapplyBook2Art, handleImportedJournalArt } from "../../module/book2-art/reapply.js";
import { BOOK2_ART_APPLY_MANIFEST } from "../../module/book2-art/manifest.js";
import { clearArtBrowseCache, DURABLE_ART_DIRS } from "../../module/book2-art/browse.js";
import { managedHash } from "../../module/hooks/journal-sync-core.js";

const JRN_SOURCE = (entryId) => `Compendium.stonetop-pwd.stonetop-journal.JournalEntry.${entryId}`;

// Runtime re-apply of Book II art after a system update, driven WITHOUT the PDF from
// the durable art on disk + the generated manifest. These drive the real function
// against fake packs / actors / FilePicker so the apply logic and its guards are
// exercised end to end.

const VERSION = "9.9.9";
const ROOT = "stonetop-book-art";
const { monsters, locations, settingOverviewMaps = [], gmDiagrams = [], treasures = [], steadings = [], people = [] } = BOOK2_ART_APPLY_MANIFEST;

// `utils/logger.js` captures the console writer when it is first evaluated, so a later spy on
// `console.warn` would never see the call. Mock the seam the code actually uses.
vi.mock("../../module/utils/logger.js", async importOriginal => ({
	...(await importOriginal()),
	warn: vi.fn(),
}));
import { warn as logWarn } from "../../module/utils/logger.js";
const DEFAULT_ICON = "icons/svg/mystery-man.svg";

function setDotted(obj, path, value) {
	const parts = path.split(".");
	let node = obj;
	for (let i = 0; i < parts.length - 1; i++) node = (node[parts[i]] ??= {});
	node[parts.at(-1)] = value;
}
function applyUpdate(doc, upd) {
	for (const [k, v] of Object.entries(upd)) setDotted(doc, k, v);
}

const uuidOf = (m) => `Compendium.${m.actorPack}.Actor.${m.actorId}`;
const durableOf = (out) => `${ROOT}/${out}`;
// What this creature's prototype token should end up showing: its hand-framed square when the
// manifest names one, else the whole illustration. DERIVED rather than pinned, because whether any
// given creature has a token square is authoring data that changes with every picker batch — these
// assertions are about the wiring rule, not about which creatures happen to be framed today.
const tokenSrcFor = (m) => durableOf(m.tokenOut ?? m.out);

function makeWorldActor({ source, img, tokenSrc = img, legacy = false, fit = "cover" }) {
	const actor = {
		img,
		prototypeToken: { texture: { src: tokenSrc, fit } },
		_stats: legacy ? {} : { compendiumSource: source },
		getFlag: (scope, key) => (legacy && scope === "core" && key === "sourceId" ? source : undefined),
		_writes: 0,
	};
	actor.update = async (upd) => { applyUpdate(actor, upd); actor._writes++; };
	return actor;
}

function makeWorldPage({ id, name, type, system }) {
	const page = { id, _id: id, name, type, system, _writes: 0 };
	page.update = async (upd) => { applyUpdate(page, upd); page._writes++; };
	return page;
}

// A world JournalEntry seeded from our compendium. `pages` are makeWorldPage docs.
// If `stamp` is true its journalSync baseline is set to the hash of its CURRENT content
// (i.e. it reads as pristine); pass an explicit `syncHash` to simulate a GM-edited entry.
function makeWorldJournal({ source, name = "World Entry", pages, stamp = false, syncHash, version = VERSION }) {
	const flags = {};
	const entry = {
		name,
		pages,
		_stats: { compendiumSource: source },
		_flagWrites: 0,
		getFlag: (scope, key) => flags?.[scope]?.[key],
		setFlag: async (scope, key, val) => { (flags[scope] ??= {})[key] = val; entry._flagWrites++; },
		toObject: () => ({ pages: pages.map((p) => ({ _id: p.id, name: p.name, type: p.type, system: p.system, text: p.text })) }),
	};
	entry._flags = flags;
	if (stamp) flags["stonetop-pwd"] = { journalSync: { hash: managedHash(entry.toObject()), version } };
	else if (syncHash) flags["stonetop-pwd"] = { journalSync: { hash: syncHash, version } };
	return entry;
}

// `present`: "all" | "none" | array of out-paths that exist on disk.
// `hostPrefix` makes the browse answer the way a host that keeps user files somewhere else does
// (The Forge's Assets Library, an S3 bucket): absolute URLs rather than the data-relative paths
// the caller built. Empty by default, which is every self-hosted world.
function makeHarness({ isGM = true, syncVersion = "", present = "all", worldActors = [], worldJournals = [], hostPrefix = "" } = {}) {
	const store = { book2ArtSyncVersion: syncVersion, book2ArtRoot: ROOT };
	const besDocs = new Map();
	const pageDocs = new Map();
	const updates = [];

	const besPack = {
		locked: true,
		configure: vi.fn(async ({ locked }) => { besPack.locked = locked; }),
		getDocument: vi.fn(async (id) => {
			if (!besDocs.has(id)) {
				const doc = {
					id, img: DEFAULT_ICON,
					prototypeToken: { texture: { src: DEFAULT_ICON, fit: "contain" } },
				};
				doc.update = async (upd) => { applyUpdate(doc, upd); updates.push({ kind: "actor", id }); };
				besDocs.set(id, doc);
			}
			return besDocs.get(id);
		}),
	};

	const jrnPack = {
		locked: true,
		configure: vi.fn(async ({ locked }) => { jrnPack.locked = locked; }),
		getDocument: vi.fn(async (entryId) => ({
			pages: {
				get: (pageId) => {
					const key = `${entryId}::${pageId}`;
					if (!pageDocs.has(key)) {
						const page = {
							id: pageId, _id: pageId, name: `cmp:${pageId}`, type: "location",
							system: {
								description: "<p>prose</p>",
								sections: Array.from({ length: 64 }, () => ({ body: "<p>loc prose</p>" })),
							},
						};
						page.update = async (upd) => { applyUpdate(page, upd); updates.push({ kind: "page", key }); };
						pageDocs.set(key, page);
					}
					return pageDocs.get(key);
				},
			},
		})),
	};

	// Every out-path the manifest can put on disk, routed to the directory it lives in — so a
	// test can name ANY of them in `present`, including the links in a Setting Overview row's
	// preference chain that are not that row's own `out`: the poster map it superseded, and the
	// GM playbook's sharper crop of the same map, which is a different row's extraction.
	const wanted = Array.isArray(present) ? new Set(present) : null;
	const allOuts = [
		// A creature's token square is a file of its own with its own presence, exactly as the
		// runtime treats it — a world can hold every illustration and none of the squares.
		...monsters.flatMap((m) => (m.tokenOut ? [m.out, m.tokenOut] : [m.out])),
		...locations.flatMap((l) => l.images).map((im) => im.out),
		...settingOverviewMaps.flatMap((s) => [s.out, ...(s.replaces ?? []), ...(s.prefer ?? [])]),
		...treasures.map((t) => t.out),
		...gmDiagrams.map((d) => d.out),
		...steadings.map((s) => s.out),
		// A person's square face is its own file with its own presence, like a creature's token.
		...people.flatMap((p) => (p.portraitOut ? [p.out, p.portraitOut] : [p.out])),
	];
	const onDisk = present === "none" ? [] : [...new Set(allOuts.filter((o) => !wanted || wanted.has(o)))];
	const filesIn = (dir) => onDisk.filter((o) => o.startsWith(`${dir}/`)).map((o) => `${hostPrefix}${durableOf(o)}`);

	// The real directory list, imported. A hand-copy that misses a directory added to browse.js
	// answers "no files in that folder", so every test over the new directory passes vacuously
	// against a browse that returns nothing. (The chain rule further down IS hand-copied, on
	// purpose and for the opposite reason; see its own note.)
	const browse = vi.fn(async (source, path) => {
		for (const dir of DURABLE_ART_DIRS) {
			if (path.endsWith(`/${dir}`)) return { files: filesIn(dir) };
		}
		return { files: [] };
	});

	const infoSpy = vi.fn();
	global.FilePicker = { browse };
	// Each harness stands up a different set of files under the same art root, and
	// browseArtDirs caches its listings for the session — so from its point of view the disk
	// just changed underneath it. Exactly what a production writer does, and it clears the
	// cache for the same reason.
	clearArtBrowseCache();
	global.game = {
		user: { isGM },
		system: { version: VERSION },
		settings: {
			get: (ns, key) => store[key],
			set: async (ns, key, val) => { store[key] = val; },
		},
		packs: { get: (id) => (id === "stonetop-pwd.stonetop-bestiary" ? besPack : id === "stonetop-pwd.stonetop-journal" ? jrnPack : null) },
		actors: worldActors,
			journal: worldJournals,
	};
	global.ui = { notifications: { info: infoSpy, warn: vi.fn(), error: vi.fn() } };

	return { store, besPack, jrnPack, besDocs, pageDocs, updates, browse, infoSpy };
}

describe("reapplyBook2ArtOnVersionChange", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	it("does nothing for a non-GM", async () => {
		const h = makeHarness({ isGM: false });
		await reapplyBook2ArtOnVersionChange();
		expect(h.browse).not.toHaveBeenCalled();
		expect(h.updates).toHaveLength(0);
		expect(h.store.book2ArtSyncVersion).toBe("");
	});

	it("early-returns (no browse) when the version was already synced", async () => {
		const h = makeHarness({ syncVersion: VERSION });
		await reapplyBook2ArtOnVersionChange();
		expect(h.browse).not.toHaveBeenCalled();
		expect(h.besPack.getDocument).not.toHaveBeenCalled();
		expect(h.updates).toHaveLength(0);
	});

	it("does not stamp the version when no durable art is on disk (self-heals next load)", async () => {
		const h = makeHarness({ present: "none" });
		await reapplyBook2ArtOnVersionChange();
		expect(h.browse).toHaveBeenCalled();
		expect(h.besPack.getDocument).not.toHaveBeenCalled();
		expect(h.updates).toHaveLength(0);
		expect(h.store.book2ArtSyncVersion).toBe(""); // unstamped -> retries
	});

	// A treasure is not a document: its Item is built the instant a player drags the line off
	// the journal, so instead of writing art onto something we publish which treasure images
	// are on disk (slug -> manifest `out`) to the world-scoped `treasureArt` index, which
	// treasure-drops.js reads synchronously when building the drop.
	describe("the treasure art index", () => {
		it("publishes each on-disk treasure as slug -> the manifest's own out path", async () => {
			const h = makeHarness({});
			await reapplyBook2ArtOnVersionChange();
			expect(h.store.treasureArt).toEqual(Object.fromEntries(treasures.map((t) => [t.slug, t.out])));
		});

		it("indexes only the treasures whose file is actually on disk", async () => {
			const h = makeHarness({ present: [treasures[0].out] });
			await reapplyBook2ArtOnVersionChange();
			expect(h.store.treasureArt).toEqual({ [treasures[0].slug]: treasures[0].out });
		});

		// The index is AUTHORITATIVE, so this is the case that most needs to run rather than the
		// one to skip: an early return on "nothing on disk" leaves a stale index behind, and every
		// subsequent drag bakes `img` to a file that is gone.
		it("clears the index when the art folder is empty or gone", async () => {
			const h = makeHarness({ present: "none" });
			h.store.treasureArt = { "the-fae-the-red-pennant": "assets/treasures/the-fae-the-red-pennant.webp" };
			await reapplyBook2Art();
			expect(h.store.treasureArt).toEqual({});
		});

		it("drops just the treasures whose art was removed, keeping the rest", async () => {
			const h = makeHarness({ present: [treasures[0].out] });
			h.store.treasureArt = Object.fromEntries(treasures.map((t) => [t.slug, t.out]));
			await reapplyBook2Art();
			expect(h.store.treasureArt).toEqual({ [treasures[0].slug]: treasures[0].out });
		});

		it("does not rewrite an index that already matches (runs on every GM load)", async () => {
			const h = makeHarness({});
			h.store.treasureArt = Object.fromEntries(treasures.map((t) => [t.slug, t.out]));
			const set = vi.spyOn(global.game.settings, "set");
			await reapplyBook2Art();
			expect(set.mock.calls.filter(([, key]) => key === "treasureArt")).toHaveLength(0);
		});

		it("stays a non-GM no-op", async () => {
			const h = makeHarness({ isGM: false });
			h.store.treasureArt = { stale: "assets/treasures/stale.webp" };
			await reapplyBook2Art();
			expect(h.store.treasureArt).toEqual({ stale: "assets/treasures/stale.webp" });
		});

		// The index is what the People gallery and the treasure drop read, so an index that quietly
		// loses most of its entries is a gallery that quietly goes blank. Warning only on a wipe to
		// ZERO missed the shape a partly-answered browse actually produces.
		it("says so in the console when the index SHRINKS, not only when it empties", async () => {
			logWarn.mockClear();
			const h = makeHarness({ present: [treasures[0].out] });
			h.store.treasureArt = Object.fromEntries(treasures.map((t) => [t.slug, t.out]));
			await reapplyBook2Art();
			expect(logWarn.mock.calls.flat().join(" ")).toContain("treasure art index shrank from 5 to 1");
		});

		it("keeps quiet about an index that GREW", async () => {
			logWarn.mockClear();
			const h = makeHarness({});
			h.store.treasureArt = { [treasures[0].slug]: treasures[0].out };
			await reapplyBook2Art();
			expect(logWarn.mock.calls.flat().join(" ")).not.toContain("art index shrank");
		});

		// `prev` is whatever the world setting holds. A value that came back a STRING used to have
		// its CHARACTER count reported as an entry count, in the one message whose job is to report
		// a real number honestly.
		it("does not invent a previous entry count from a setting that is not an object", async () => {
			logWarn.mockClear();
			const h = makeHarness({ present: "none" });
			h.store.treasureArt = '{"a":1}';
			await reapplyBook2Art();
			expect(h.store.treasureArt).toEqual({});
			expect(logWarn.mock.calls.flat().join(" ")).not.toContain("art index shrank");
		});
	});

	// The GM playbook's two flowcharts are document-less for the same reason a treasure is, and
	// the GM Toolkit's Core Loop tab reads this index to tell "imported" from "not imported".
	// A system update wipes compendium edits but not the durable folder, so without a refresh
	// here a world that HAD the diagrams would keep whatever the macro published — which is
	// right until the GM moves or clears the art folder, and silently wrong after.
	describe("the GM playbook diagram index", () => {
		it("publishes each on-disk diagram as slug -> the manifest's own out path", async () => {
			const h = makeHarness({});
			await reapplyBook2ArtOnVersionChange();
			expect(h.store.gmDiagramArt).toEqual(Object.fromEntries(gmDiagrams.map((d) => [d.slug, d.out])));
		});

		// The half-imported world the tab is written for: one figure, one placeholder.
		it("indexes only the diagrams whose file is actually on disk", async () => {
			const h = makeHarness({ present: [gmDiagrams[0].out] });
			await reapplyBook2ArtOnVersionChange();
			expect(h.store.gmDiagramArt).toEqual({ [gmDiagrams[0].slug]: gmDiagrams[0].out });
		});

		// Authoritative, like the treasures': a GM who cleared the art folder must get a tab that
		// offers the import again, not two broken images.
		it("clears the index when the art folder is empty or gone", async () => {
			const h = makeHarness({ present: "none" });
			h.store.gmDiagramArt = { "core-loop": "assets/diagrams/core-loop.webp" };
			await reapplyBook2Art();
			expect(h.store.gmDiagramArt).toEqual({});
		});

		it("stays a non-GM no-op", async () => {
			const h = makeHarness({ isGM: false });
			h.store.gmDiagramArt = { stale: "assets/diagrams/stale.webp" };
			await reapplyBook2Art();
			expect(h.store.gmDiagramArt).toEqual({ stale: "assets/diagrams/stale.webp" });
		});
	});

	it("re-points every compendium actor + journal page and stamps the version", async () => {
		const mon0 = monsters[0];
		const worldActors = [
			// our own broken in-system pointer -> re-pointed to the durable path
			makeWorldActor({ source: uuidOf(mon0), img: `systems/stonetop-pwd/${mon0.out}` }),
			// same monster via the legacy core.sourceId flag -> re-pointed
			makeWorldActor({ source: uuidOf(mon0), img: `systems/stonetop-pwd/${mon0.out}`, legacy: true }),
			// a GM's custom portrait -> left untouched
			makeWorldActor({ source: uuidOf(mon0), img: "worlds/mine/custom-crinwin.png" }),
			// not one of ours -> ignored
			makeWorldActor({ source: "Compendium.other.Actor.zzz", img: "whatever.png" }),
		];
		const h = makeHarness({ worldActors });

		await reapplyBook2ArtOnVersionChange();

		// compendium actors: all present -> all re-pointed to durable portrait + token
		expect(h.besDocs.size).toBe(monsters.length);
		for (const m of monsters) {
			const doc = h.besDocs.get(m.actorId);
			expect(doc.img).toBe(durableOf(m.out));
			expect(doc.prototypeToken.texture.src).toBe(tokenSrcFor(m));
			expect(doc.prototypeToken.texture.fit).toBe("cover");
		}
		// bestiary journal pages: art prepended once
		const besPage = h.pageDocs.get(`${mon0.journalEntryId}::${mon0.journalPageId}`);
		expect(besPage.system.description).toContain(`src="${durableOf(mon0.out)}"`);
		expect(besPage.system.description.indexOf("<img")).toBeLessThan(besPage.system.description.indexOf("<p>prose"));
		// location journal pages: art appended into the section body
		const loc0 = locations[0];
		const locPage = h.pageDocs.get(`${loc0.journalEntryId}::${loc0.journalPageId}`);
		expect(locPage.system.sections[loc0.sectionIndex].body).toContain(`src="${durableOf(loc0.images[0].out)}"`);

		// world actors: only OUR pointers fixed, custom/unrelated left alone
		expect(worldActors[0].img).toBe(durableOf(mon0.out));
		expect(worldActors[1].img).toBe(durableOf(mon0.out));
		expect(worldActors[2].img).toBe("worlds/mine/custom-crinwin.png");
		expect(worldActors[2]._writes).toBe(0);
		expect(worldActors[3]._writes).toBe(0);

		// packs unlocked then relocked; version stamped; GM notified
		expect(h.besPack.locked).toBe(true);
		expect(h.jrnPack.locked).toBe(true);
		expect(h.store.book2ArtSyncVersion).toBe(VERSION);
		expect(h.infoSpy).toHaveBeenCalled();
	});

	it("gives every image of a multi-section page its own section (no row clobbers another)", async () => {
		// Regression guard for the Forge Lords bug: a journal page assigned art in several
		// sections is processed as one manifest row PER section, each doing its own
		// getDocument -> update on the same page. If a later row rebuilt from a stale read
		// it would drop an earlier row's placement. Assert every image lands in its assigned
		// section and appears nowhere else on the page.
		const byPage = new Map();
		for (const l of locations) {
			const key = `${l.journalEntryId}::${l.journalPageId}`;
			if (!byPage.has(key)) byPage.set(key, []);
			byPage.get(key).push(l);
		}
		const multi = [...byPage.entries()].find(([, rows]) => {
			const secs = new Set(rows.map((r) => r.sectionIndex ?? 0));
			return secs.size > 1 && rows.every((r) => r.images?.length) && Math.max(...secs) < 64;
		});
		expect(multi).toBeTruthy(); // the manifest must still carry a multi-section location page

		const [key, rows] = multi;
		const h = makeHarness();
		await reapplyBook2ArtOnVersionChange();

		const sections = h.pageDocs.get(key).system.sections;
		for (const r of rows) {
			const idx = r.sectionIndex ?? 0;
			for (const im of r.images) {
				const ref = `src="${durableOf(im.out)}"`;
				expect(sections[idx].body).toContain(ref);                                              // in its assigned section
				const strays = sections.filter((_, i) => i !== idx).filter((s) => (s?.body ?? "").includes(ref));
				expect(strays).toHaveLength(0);                                                          // and nowhere else
			}
		}
	});

	it("is idempotent: a second pass at the same version makes no further writes", async () => {
		const worldActors = [makeWorldActor({ source: uuidOf(monsters[0]), img: `systems/stonetop-pwd/${monsters[0].out}` })];
		const h = makeHarness({ worldActors });

		await reapplyBook2ArtOnVersionChange();
		const writesAfterFirst = h.updates.length;
		const worldWritesAfterFirst = worldActors[0]._writes;

		// force it to run again (as a new version bump would) against already-correct docs
		h.store.book2ArtSyncVersion = "";
		await reapplyBook2ArtOnVersionChange();

		expect(h.updates.length).toBe(writesAfterFirst); // no new doc writes
		expect(worldActors[0]._writes).toBe(worldWritesAfterFirst);
		expect(h.store.book2ArtSyncVersion).toBe(VERSION);
	});

	it("only wires art that is actually on disk (partial import)", async () => {
		const mon0 = monsters[0];
		const worldActors = [makeWorldActor({ source: uuidOf(mon0), img: `systems/stonetop-pwd/${mon0.out}` })];
		const h = makeHarness({ present: [mon0.out], worldActors }); // only crinwin's bestiary art present

		await reapplyBook2ArtOnVersionChange();

		const actorWrites = h.updates.filter((u) => u.kind === "actor").length;
		const pageWrites = h.updates.filter((u) => u.kind === "page").length;
		expect(actorWrites).toBe(1); // just crinwin
		expect(pageWrites).toBe(1); // just crinwin's bestiary page; no location pages (none present)
		expect(worldActors[0].img).toBe(durableOf(mon0.out));
		expect(h.store.book2ArtSyncVersion).toBe(VERSION);
	});

	it("embeds art into pristine world journals and re-stamps their baseline", async () => {
		const mon0 = monsters[0];
		const loc0 = locations[0];
		const secIdx = loc0.sectionIndex ?? 0;

		const besPage = makeWorldPage({ id: mon0.journalPageId, name: `cmp:${mon0.journalPageId}`, type: "bestiary", system: { description: "<p>world bestiary prose</p>" } });
		const worldBes = makeWorldJournal({ source: JRN_SOURCE(mon0.journalEntryId), name: mon0.name, pages: [besPage], stamp: true });

		const locPage = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>world loc prose</p>" })) } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [locPage], stamp: true });

		// A world journal seeded from a DIFFERENT compendium -> never touched.
		const foreignPage = makeWorldPage({ id: "foreign", name: "Foreign", type: "location", system: { sections: [{ kind: "prose", body: "<p>x</p>" }] } });
		const foreign = makeWorldJournal({ source: "Compendium.other.pack.JournalEntry.zzz", pages: [foreignPage], stamp: true });

		const preBesHash = worldBes._flags["stonetop-pwd"].journalSync.hash;
		const preLocHash = worldLoc._flags["stonetop-pwd"].journalSync.hash;

		const h = makeHarness({ worldJournals: [worldBes, worldLoc, foreign] });
		await reapplyBook2ArtOnVersionChange();

		// art embedded into the world copies
		expect(besPage.system.description).toContain(`src="${durableOf(mon0.out)}"`);
		expect(locPage.system.sections[secIdx].body).toContain(`src="${durableOf(loc0.images[0].out)}"`);

		// pristine entries re-stamped to the NEW (art-bearing) fingerprint
		expect(worldBes._flags["stonetop-pwd"].journalSync.hash).toBe(managedHash(worldBes.toObject()));
		expect(worldBes._flags["stonetop-pwd"].journalSync.hash).not.toBe(preBesHash);
		expect(worldLoc._flags["stonetop-pwd"].journalSync.hash).toBe(managedHash(worldLoc.toObject()));
		expect(worldLoc._flags["stonetop-pwd"].journalSync.hash).not.toBe(preLocHash);

		// unrelated journal untouched
		expect(foreignPage._writes).toBe(0);
		expect(foreign._flagWrites).toBe(0);
		expect(h.store.book2ArtSyncVersion).toBe(VERSION);
	});

	it("self-heals EVERY retired (de-duplicated) src out of already-imported world location pages", async () => {
		// The upgrade path for a world that imported an older manifest, over every location the
		// manifest retires art on — not just a sample. Each page is seeded the way the old
		// import left it: the retired name embedded in the target section.
		const affected = locations.filter((l) => l.retired?.length);
		expect(affected.length).toBeGreaterThan(0);

		const pages = affected.map((l) => {
			const secIdx = l.sectionIndex ?? 0;
			const emb = (src) => `<p><img class="stonetop-journal-art" src="${src}" alt="${l.name}"></p>`;
			const sections = Array.from({ length: secIdx + 1 }, () => ({ kind: "prose", body: "<p>world loc prose</p>" }));
			sections[secIdx] = { kind: "prose", body: `${l.retired.map((r) => emb(durableOf(r))).join("")}<p>prose</p>` };
			const page = makeWorldPage({ id: l.journalPageId, name: `cmp:${l.journalPageId}`, type: "location", system: { sections } });
			return { l, secIdx, page, journal: makeWorldJournal({ source: JRN_SOURCE(l.journalEntryId), name: l.name, pages: [page], stamp: true }) };
		});

		makeHarness({ worldJournals: pages.map((p) => p.journal) });
		// The every-load self-heal path (no version bump), which is what clears existing worlds.
		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		for (const { l, secIdx, page } of pages) {
			const whole = page.system.sections.map((s) => s.body ?? "").join("");
			for (const r of l.retired) expect(whole, `${l.slug} kept a retired src`).not.toContain(`src="${durableOf(r)}"`);
			for (const im of l.images) expect(page.system.sections[secIdx].body, `${l.slug} lost ${im.out}`).toContain(`src="${durableOf(im.out)}"`);
			// Exactly one embed per image: a strip that missed would show as a doubled picture.
			for (const im of l.images) {
				const hits = whole.split(`src="${durableOf(im.out)}"`).length - 1;
				expect(hits, `${l.slug} embeds ${im.out} ${hits} times`).toBe(1);
			}
			expect(page.system.sections[secIdx].body).toContain("prose"); // the page's own text survives
		}
	});

	it("strips a retired peer's src off the SHIPPED curated codex pages", async () => {
		// The other half of the de-duplication: where the two creatures sharing a picture also
		// share a curated codex page, the per-monster pass skips it and `managed` does the
		// stripping — which is why the collapsed name has to stay in `managed` even though it
		// is no longer any row's art. Drives the real shipped codex entries, not a synthetic one.
		const entries = (BOOK2_ART_APPLY_MANIFEST.codex ?? []).map((c) => {
			const shown = new Set((c.slots ?? []).flatMap((s) => (s.images ?? []).map((i) => i.out)));
			return { c, shown: [...shown], hidden: c.managed.filter((out) => !shown.has(out)) };
		}).filter((e) => e.hidden.length && e.shown.length);
		expect(entries.length, "no shipped codex page has a hidden/retired managed path").toBeGreaterThan(0);

		const pages = entries.map(({ c, shown, hidden }) => {
			const emb = (out) => `<p><img class="stonetop-journal-art" src="${durableOf(out)}" alt="${c.name}"></p>`;
			const page = makeWorldPage({ id: c.journalPageId, name: c.name, type: "bestiary", system: { description: `${hidden.map(emb).join("")}<p>codex prose</p>`, nests: "" } });
			return { c, shown, hidden, page, journal: makeWorldJournal({ source: JRN_SOURCE(c.journalEntryId), name: c.name, pages: [page], stamp: true }) };
		});

		makeHarness({ worldJournals: pages.map((p) => p.journal) });
		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		for (const { c, shown, hidden, page } of pages) {
			const whole = `${page.system.description ?? ""}${page.system.nests ?? ""}`;
			for (const out of hidden) expect(whole, `codex "${c.name}" kept ${out}`).not.toContain(`src="${durableOf(out)}"`);
			for (const out of shown) expect(whole, `codex "${c.name}" lost ${out}`).toContain(`src="${durableOf(out)}"`);
			expect(whole).toContain("codex prose");
		}
	});

	it("leaves a retired src alone while the art that replaced it is off disk", async () => {
		// The dangerous shape: a world that imported an OLDER manifest, so it has the retired
		// file but not the one the row now names. Stripping there would take the picture off the
		// page and put nothing back — so the leftover embed stays until they import its
		// replacement, which is strictly better than an art-less page.
		const locR = locations.find((l) => l.retired?.length);
		const secIdx = locR.sectionIndex ?? 0;
		const retiredSrc = durableOf(locR.retired[0]);
		const emb = (src) => `<p><img class="stonetop-journal-art" src="${src}" alt="${locR.name}"></p>`;

		const sections = Array.from({ length: secIdx + 1 }, () => ({ kind: "prose", body: "<p>world loc prose</p>" }));
		sections[secIdx] = { kind: "prose", body: `${emb(retiredSrc)}<p>prose</p>` };
		const locPage = makeWorldPage({ id: locR.journalPageId, name: `cmp:${locR.journalPageId}`, type: "location", system: { sections } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(locR.journalEntryId), name: locR.name, pages: [locPage], stamp: true });

		// Only ONE unrelated file on disk, so this row's own images are all missing.
		makeHarness({ worldJournals: [worldLoc], present: [monsters[0].out] });
		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		expect(locPage.system.sections[secIdx].body).toContain(`src="${retiredSrc}"`);
		expect(locPage._writes).toBe(0);
	});

	it("self-heals EVERY retired (de-duplicated) src out of already-imported world bestiary pages", async () => {
		// Two creatures the book draws in ONE picture (the Adventurer and the Assassin) now
		// share the one FILE, so the loser's page has to lose the old path or the same
		// illustration sits on it twice. A curated codex page is owned by the codex pass, which
		// strips through `managed` instead — these are the ordinary per-monster pages.
		const curated = new Set((BOOK2_ART_APPLY_MANIFEST.codex ?? []).map((c) => c.journalEntryId));
		const affected = monsters.filter((m) => m.retired?.length && !curated.has(m.journalEntryId));
		expect(affected.length).toBeGreaterThan(0);

		const pages = affected.map((m) => {
			const emb = (src) => `<p><img class="stonetop-journal-art" src="${src}" alt="${m.name}"></p>`;
			// A world copy imported under the OLD manifest: the page carries only the old path.
			const page = makeWorldPage({ id: m.journalPageId, name: `cmp:${m.journalPageId}`, type: "bestiary", system: { description: `${m.retired.map((r) => emb(durableOf(r))).join("")}<p>world bestiary prose</p>` } });
			return { m, page, journal: makeWorldJournal({ source: JRN_SOURCE(m.journalEntryId), name: m.name, pages: [page], stamp: true }) };
		});

		makeHarness({ worldJournals: pages.map((p) => p.journal) });
		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		for (const { m, page } of pages) {
			const desc = page.system.description;
			expect(desc, `${m.slug} lost its art`).toContain(`src="${durableOf(m.out)}"`);
			for (const r of m.retired) expect(desc, `${m.slug} kept a retired src`).not.toContain(`src="${durableOf(r)}"`);
			expect(desc.split(`src="${durableOf(m.out)}"`).length - 1, `${m.slug} doubled`).toBe(1);
			expect(desc, `${m.slug} lost its prose`).toContain("world bestiary prose");
		}
	});

	it("does not rewrite a bestiary page that has the shared art and no stale duplicate", async () => {
		// cheapWorldSkip has to keep seeing "nothing to do" for a de-duplicated monster, or the
		// every-load self-heal rewrites the same page forever.
		const curated = new Set((BOOK2_ART_APPLY_MANIFEST.codex ?? []).map((c) => c.journalEntryId));
		const monR = monsters.find((m) => m.retired?.length && !curated.has(m.journalEntryId)) ?? monsters[0];
		const besPage = makeWorldPage({ id: monR.journalPageId, name: `cmp:${monR.journalPageId}`, type: "bestiary", system: { description: `<p><img class="stonetop-journal-art" src="${durableOf(monR.out)}" alt="${monR.name}"></p><p>prose</p>` } });
		const worldBes = makeWorldJournal({ source: JRN_SOURCE(monR.journalEntryId), name: monR.name, pages: [besPage], stamp: true });

		const h = makeHarness({ worldJournals: [worldBes] });
		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		expect(besPage._writes).toBe(0);
		expect(h.jrnPack.getDocument).not.toHaveBeenCalledWith(monR.journalEntryId);
	});

	it("drops art at the top when the GM deleted the target section (never silently skips)", async () => {
		const loc0 = locations[0];
		// A world copy whose sections the GM has cleared out entirely, so the manifest's
		// target section no longer exists.
		const locPage = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: [] } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [locPage], stamp: true });

		const h = makeHarness({ worldJournals: [worldLoc] });
		await reapplyBook2ArtOnVersionChange();

		// A prose section is synthesised at the top of the page to hold the art, rather
		// than the image being dropped.
		expect(locPage.system.sections).toHaveLength(1);
		expect(locPage.system.sections[0]).toMatchObject({ kind: "prose", heading: "", group: "glance", danger: false });
		expect(locPage.system.sections[0].body).toContain(`src="${durableOf(loc0.images[0].out)}"`);
		// pristine entry re-stamped to the new (art-bearing) fingerprint
		expect(worldLoc._flags["stonetop-pwd"].journalSync.hash).toBe(managedHash(worldLoc.toObject()));

		// idempotent: a second pass (as a version bump would trigger) adds no second copy
		const writesAfterFirst = locPage._writes;
		h.store.book2ArtSyncVersion = "";
		await reapplyBook2ArtOnVersionChange();
		expect(locPage._writes).toBe(writesAfterFirst);
		expect(locPage.system.sections).toHaveLength(1);
	});

	// A Setting Overview page's files, best first. The same rule reapply itself applies: the row's
	// stated `prefer` where it has one (a page whose map is printed in more than one PDF at more
	// than one resolution), else the older implicit "this row's picture, then what it superseded".
	// Spelled out here rather than imported so a change to the shipped rule has to be MADE here
	// too, deliberately, instead of both sides drifting together and the tests staying green.
	const chainOf = (s) => (s.prefer?.length ? s.prefer : [s.out, ...(s.replaces ?? [])]);
	// The row the chain tests below drive: the one with the most links, so the walk down the chain
	// is exercised at full length rather than on a two-link row that cannot show ordering.
	const soChained = settingOverviewMaps.slice().sort((a, b) => chainOf(b).length - chainOf(a).length)[0];

	it("re-embeds Setting Overview regional maps into the setting journal's text pages", async () => {
		const so0 = settingOverviewMaps[0];
		expect(so0).toBeTruthy(); // guard: the apply manifest ships the SO maps

		// A world "Setting Overview" journal seeded from the compendium, with the plain
		// text page the map belongs on.
		const soPage = makeWorldPage({ id: so0.journalPageId, name: `cmp:${so0.journalPageId}`, type: "text", system: {} });
		soPage.text = { content: "<p>world setting prose</p>" };
		const worldSO = makeWorldJournal({ source: JRN_SOURCE(so0.journalEntryId), name: "Setting Overview", pages: [soPage], stamp: true });
		const preHash = worldSO._flags["stonetop-pwd"].journalSync.hash;

		const h = makeHarness({ worldJournals: [worldSO] });
		await reapplyBook2ArtOnVersionChange();

		// The best link on disk, which with everything present is the head of the chain.
		const durable = durableOf(chainOf(so0)[0]);
		// compendium page: map figure prepended to text.content
		const cmpPage = h.pageDocs.get(`${so0.journalEntryId}::${so0.journalPageId}`);
		expect(cmpPage.text.content).toContain(`<figure class="stonetop-map"><img src="${durable}"`);
		// world copy: same figure, original prose preserved beneath it
		expect(soPage.text.content).toContain(`<figure class="stonetop-map"><img src="${durable}"`);
		expect(soPage.text.content).toContain("world setting prose");
		// pristine entry re-stamped to the new (map-bearing) fingerprint
		expect(worldSO._flags["stonetop-pwd"].journalSync.hash).toBe(managedHash(worldSO.toObject()));
		expect(worldSO._flags["stonetop-pwd"].journalSync.hash).not.toBe(preHash);
		expect(h.store.book2ArtSyncVersion).toBe(VERSION);
	});

	// The upgrade path, end to end: a world that imported an earlier release still shows the
	// user-supplied poster map on this page. Because the labelled printed crop lives at a
	// DIFFERENT path (the poster map still backs its Scene, so it can't be overwritten in
	// place), the old "never stack any map" rule would have skipped the new map forever on
	// exactly the worlds that had already imported. The chain is what makes it swap.
	it("replaces a superseded poster map on the setting page with the best printed crop", async () => {
		const so0 = soChained;
		expect(chainOf(so0).length).toBeGreaterThan(1); // guard: at least one SO map supersedes something
		const oldSrc = durableOf(chainOf(so0).at(-1));

		const soPage = makeWorldPage({ id: so0.journalPageId, name: `cmp:${so0.journalPageId}`, type: "text", system: {} });
		soPage.text = { content: `<figure class="stonetop-map"><img src="${oldSrc}" alt="${so0.name}"></figure><p>world setting prose</p>` };
		const worldSO = makeWorldJournal({ source: JRN_SOURCE(so0.journalEntryId), name: "Setting Overview", pages: [soPage], stamp: true });
		const preHash = worldSO._flags["stonetop-pwd"].journalSync.hash;

		const h = makeHarness({ worldJournals: [worldSO] });
		await reapplyBook2ArtOnVersionChange();

		const durable = durableOf(chainOf(so0)[0]);
		expect(soPage.text.content).toContain(`<figure class="stonetop-map"><img src="${durable}"`);
		expect(soPage.text.content).not.toContain(oldSrc);          // the poster map figure is gone
		expect(soPage.text.content).toContain("world setting prose"); // the prose is not
		expect(soPage.text.content.match(/class="stonetop-map"/g)).toHaveLength(1);
		// pristine entry re-stamped, so the managed channel keeps delivering prose updates
		expect(worldSO._flags["stonetop-pwd"].journalSync.hash).toBe(managedHash(worldSO.toObject()));
		expect(worldSO._flags["stonetop-pwd"].journalSync.hash).not.toBe(preHash);

		// the compendium copy upgrades the same way
		const cmpPage = h.pageDocs.get(`${so0.journalEntryId}::${so0.journalPageId}`);
		expect(cmpPage.text.content).toContain(durable);
	});

	// The regression this guards: an update resets the compendium SO page to the shipped,
	// art-less version and re-seeds pristine world copies from it, so pass 2.5 is the only
	// thing that puts a map back. A GM who supplied poster maps but has not re-run the macro
	// (or has none of the PDFs at all) has ONLY the poster map on disk — skipping the row for
	// want of a printed crop would leave them staring at a blank page where their map was.
	it("falls back to the last link in the chain when nothing better is on disk", async () => {
		const so0 = soChained;
		const fallback = chainOf(so0).at(-1);

		const soPage = makeWorldPage({ id: so0.journalPageId, name: `cmp:${so0.journalPageId}`, type: "text", system: {} });
		soPage.text = { content: "<p>world setting prose</p>" };
		const worldSO = makeWorldJournal({ source: JRN_SOURCE(so0.journalEntryId), name: "Setting Overview", pages: [soPage], stamp: true });

		// on disk: the poster map only, none of the printed crops
		makeHarness({ worldJournals: [worldSO], present: [fallback] });
		await reapplyBook2ArtOnVersionChange();

		expect(soPage.text.content).toContain(`<figure class="stonetop-map"><img src="${durableOf(fallback)}"`);
		for (const better of chainOf(so0).slice(0, -1)) {
			expect(soPage.text.content).not.toContain(durableOf(better));
		}
		expect(soPage.text.content).toContain("world setting prose");
	});

	// Walks the chain one link at a time. Each round puts exactly one more link on disk, starting
	// from the worst, and asserts the page moves up to it: that is the whole ordering contract,
	// and it holds however many PDFs a GM happens to own. A test that only compared the first and
	// last links would pass on a chain whose middle was ignored entirely — which is precisely the
	// bug a third source (the GM playbook's sharper map, ahead of the Book II crop) can introduce.
	it("shows the best link on disk, at every depth of the chain", async () => {
		const chain = chainOf(soChained);
		expect(chain.length).toBeGreaterThanOrEqual(3); // guard: a two-link chain proves no ordering

		for (let i = chain.length - 1; i >= 0; i--) {
			const onDisk = chain.slice(i);
			const soPage = makeWorldPage({ id: soChained.journalPageId, name: `cmp:${soChained.journalPageId}`, type: "text", system: {} });
			soPage.text = { content: "<p>prose</p>" };
			const worldSO = makeWorldJournal({ source: JRN_SOURCE(soChained.journalEntryId), name: "Setting Overview", pages: [soPage], stamp: true });

			makeHarness({ worldJournals: [worldSO], present: onDisk });
			await reapplyBook2ArtOnVersionChange();

			expect(soPage.text.content, `best of ${onDisk.join(", ")}`).toContain(durableOf(chain[i]));
			for (const worse of chain.slice(i + 1)) {
				expect(soPage.text.content, `${worse} should have been superseded`).not.toContain(durableOf(worse));
			}
		}
	});

	it("does not stack a second map when the setting page already carries one", async () => {
		const so0 = settingOverviewMaps[0];
		const soPage = makeWorldPage({ id: so0.journalPageId, name: `cmp:${so0.journalPageId}`, type: "text", system: {} });
		// a GM's own map figure already on the page -> left entirely alone
		soPage.text = { content: `<figure class="stonetop-map"><img src="worlds/mine/my-map.png" alt="mine"></figure><p>prose</p>` };
		const worldSO = makeWorldJournal({ source: JRN_SOURCE(so0.journalEntryId), name: "Setting Overview", pages: [soPage], stamp: true });

		makeHarness({ worldJournals: [worldSO] });
		await reapplyBook2ArtOnVersionChange();

		expect(soPage.text.content).toContain("worlds/mine/my-map.png");
		expect(soPage.text.content).not.toContain(durableOf(so0.out));
		expect(soPage._writes).toBe(0);
	});

	it("adds art to an EDITED world journal but leaves its edited baseline intact", async () => {
		const loc0 = locations[0];
		const secIdx = loc0.sectionIndex ?? 0;
		const locPage = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>GM edited prose</p>" })) } });
		// baseline hash that does NOT match current content -> reads as GM-edited
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [locPage], syncHash: "EDITED-HASH" });

		makeHarness({ worldJournals: [worldLoc] });
		await reapplyBook2ArtOnVersionChange();

		// art still applied (additive, never clobbers prose)
		expect(locPage.system.sections[secIdx].body).toContain(`src="${durableOf(loc0.images[0].out)}"`);
		expect(locPage.system.sections[secIdx].body).toContain("GM edited prose");
		// edited baseline left untouched: the managed channel keeps hands off future prose
		expect(worldLoc._flags["stonetop-pwd"].journalSync.hash).toBe("EDITED-HASH");
		expect(worldLoc._flagWrites).toBe(0);
	});

	it("matches a refreshed world page by name+type when its id no longer matches", async () => {
		const loc0 = locations[0];
		const secIdx = loc0.sectionIndex ?? 0;
		// A managed refresh recreated the page with a fresh id, so id-matching misses it;
		// name+type still line up with the compendium page (harness name `cmp:<pageId>`).
		const locPage = makeWorldPage({ id: "regenerated-id", name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>world loc prose</p>" })) } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [locPage], stamp: true });

		makeHarness({ worldJournals: [worldLoc] });
		await reapplyBook2ArtOnVersionChange();

		expect(locPage.system.sections[secIdx].body).toContain(`src="${durableOf(loc0.images[0].out)}"`);
	});

	it("is idempotent on world journals: a second pass makes no further writes", async () => {
		const loc0 = locations[0];
		const locPage = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>world loc prose</p>" })) } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [locPage], stamp: true });

		const h = makeHarness({ worldJournals: [worldLoc] });
		await reapplyBook2ArtOnVersionChange();
		const pageWritesAfterFirst = locPage._writes;

		h.store.book2ArtSyncVersion = ""; // force another run as a version bump would
		await reapplyBook2ArtOnVersionChange();

		expect(locPage._writes).toBe(pageWritesAfterFirst); // art already present -> no new write
	});

	it("re-points world-actor art/token conservatively and never reverts the GM's token fit", async () => {
		const mon0 = monsters[0];
		const stale = `systems/stonetop-pwd/${mon0.out}`; // the pre-durable path an update broke
		const durable = durableOf(mon0.out);
		const mk = ({ img, tokenSrc, tokenFit }) => {
			const a = {
				img,
				prototypeToken: { texture: { src: tokenSrc, fit: tokenFit } },
				_stats: { compendiumSource: uuidOf(mon0) },
				getFlag: () => undefined,
			};
			a.update = async (upd) => { applyUpdate(a, upd); };
			return a;
		};
		const a1 = mk({ img: stale, tokenSrc: stale, tokenFit: "contain" }); // our art, GM chose contain
		const a2 = mk({ img: stale, tokenSrc: "worlds/mine/tok.png", tokenFit: "cover" }); // custom token src
		const a3 = mk({ img: "worlds/mine/portrait.png", tokenSrc: stale, tokenFit: "cover" }); // custom portrait

		makeHarness({ worldActors: [a1, a2, a3] });
		await reapplyBook2ArtOnVersionChange();

		// a1: both our stale paths re-pointed; the GM's fit:"contain" is preserved. The token lands
		// on this creature's SQUARE where one is framed — that is the whole point of the square —
		// and is DERIVED rather than pinned, so this stays a test of the wiring rule rather than of
		// which creatures a given picker batch happens to have framed.
		expect(a1.img).toBe(durable);
		expect(a1.prototypeToken.texture.src).toBe(tokenSrcFor(mon0));
		expect(a1.prototypeToken.texture.fit).toBe("contain");
		// a2: portrait fixed, custom token src left alone
		expect(a2.img).toBe(durable);
		expect(a2.prototypeToken.texture.src).toBe("worlds/mine/tok.png");
		// a3: token fixed, custom portrait left alone
		expect(a3.img).toBe("worlds/mine/portrait.png");
		expect(a3.prototypeToken.texture.src).toBe(tokenSrcFor(mon0));
	});

	it("does not stamp the version if an item write throws (retries next load, other docs still applied)", async () => {
		const mon0 = monsters[0];
		const boom = {
			img: `systems/stonetop-pwd/${mon0.out}`,
			prototypeToken: { texture: { src: `systems/stonetop-pwd/${mon0.out}`, fit: "cover" } },
			_stats: { compendiumSource: uuidOf(mon0) },
			getFlag: () => undefined,
			update: async () => { throw new Error("actor locked out"); },
		};
		const h = makeHarness({ worldActors: [boom] });
		await reapplyBook2ArtOnVersionChange();

		// the throwing world actor does NOT abort the pass: compendium art still applied
		expect(h.besDocs.get(mon0.actorId).img).toBe(durableOf(mon0.out));
		// but the version is left unstamped so the next load retries
		expect(h.store.book2ArtSyncVersion).toBe("");
	});

	// Art that has gone the other way: the actor still points at one of ours and the file is no
	// longer on disk. A run that failed on some illustrations is the ordinary way in, as is
	// re-importing into a fresh art folder. Nothing else clears it — the compendium is reset by
	// any system update, but a world actor survives updates, and every other pass only ever wires
	// art that IS present — so the broken image would sit on the sheet and token indefinitely.
	describe("art that has vanished from disk", () => {
		// Every monster's art present EXCEPT the first, so "this one is missing" is a statement
		// about one file rather than about a folder that could not be read.
		const allButFirst = () => monsters.slice(1).map((m) => m.out)
			.concat(locations.flatMap((l) => l.images).map((im) => im.out));

		const staleActor = (mon, { creatureType } = {}) => {
			const durable = durableOf(mon.out);
			const a = {
				img: durable,
				system: creatureType ? { creatureType } : {},
				prototypeToken: { texture: { src: durable, fit: "cover" } },
				_stats: { compendiumSource: uuidOf(mon) },
				getFlag: () => undefined,
			};
			a.update = async (upd) => { applyUpdate(a, upd); };
			return a;
		};

		it("reverts a world actor to its creature-type icon", async () => {
			// The same shipped placeholder SeedActors gave it, so isBestiaryPlaceholderImg reads it
			// as adoptable again and a later re-import picks the picture straight back up.
			const a = staleActor(monsters[0], { creatureType: "natural-beast" });
			makeHarness({ worldActors: [a], present: allButFirst() });
			await reapplyBook2ArtOnVersionChange();

			expect(a.img).toBe("systems/stonetop-pwd/assets/icons/bestiary/natural-beast.svg");
			expect(a.prototypeToken.texture.src).toBe("systems/stonetop-pwd/assets/icons/bestiary/natural-beast.svg");
		});

		it("falls back to Foundry's default when the actor has no creature type", async () => {
			const a = staleActor(monsters[0]);
			makeHarness({ worldActors: [a], present: allButFirst() });
			await reapplyBook2ArtOnVersionChange();

			expect(a.img).toBe(DEFAULT_ICON);
		});

		it("never touches a portrait the group chose", async () => {
			// The same `tails` test the re-point uses: only paths that are already ours.
			const a = staleActor(monsters[0], { creatureType: "natural-beast" });
			a.img = "worlds/mine/portrait.png";
			makeHarness({ worldActors: [a], present: allButFirst() });
			await reapplyBook2ArtOnVersionChange();

			expect(a.img).toBe("worlds/mine/portrait.png");
		});

		it("clears nothing when NO monster art is on disk", async () => {
			// The guard against a browse that came back empty. Without it a transient FilePicker
			// failure would strip all 73 portraits at once; the next load would re-adopt them, but
			// the churn is exactly the alarm a self-heal must never raise.
			const a = staleActor(monsters[0], { creatureType: "natural-beast" });
			const durable = durableOf(monsters[0].out);
			// Location images that are NOT also a monster's file. Several are: where the book draws
			// a creature as its region's plate, the collapse gives both rows the one bestiary path,
			// so handing over every location image would put monster art on disk after all and this
			// case would silently stop testing the guard.
			const monsterOuts = new Set(monsters.map((m) => m.out));
			const locOnly = locations.flatMap((l) => l.images).map((im) => im.out).filter((o) => !monsterOuts.has(o));
			expect(locOnly.length).toBeGreaterThan(0);
			makeHarness({ worldActors: [a], present: locOnly });
			await reapplyBook2ArtOnVersionChange();

			expect(a.img).toBe(durable);
		});

		it("leaves an actor alone when its art IS on disk", async () => {
			const a = staleActor(monsters[0], { creatureType: "natural-beast" });
			makeHarness({ worldActors: [a] });
			await reapplyBook2ArtOnVersionChange();

			expect(a.img).toBe(durableOf(monsters[0].out));
		});

		// The page half of the same problem: an embed a previous import left behind renders as a
		// broken image once the file is gone, and every pass only ever places art that IS present,
		// so nothing removed it.
		// The harness builds a compendium page on first access, so seeding one means asking for it
		// exactly as the code under test will.
		const cmpPage = async (h, entryId, pageId) => (await h.jrnPack.getDocument(entryId)).pages.get(pageId);

		it("strips a vanished creature's embed off its bestiary page", async () => {
			const mon0 = monsters[0];
			const embed = `<p><img class="stonetop-journal-art" src="${durableOf(mon0.out)}" alt="${mon0.name}"></p>`;
			const h = makeHarness({ present: allButFirst() });
			const page = await cmpPage(h, mon0.journalEntryId, mon0.journalPageId);
			page.system.description = `${embed}<p>prose</p>`;
			await reapplyBook2ArtOnVersionChange();

			// Assert the vanished path is gone rather than the whole body, because a bestiary page
			// can be shared: crinwin and crinwin-broodfather are drawn on one page, so the peer
			// whose art IS on disk legitimately places its own embed here in the same pass.
			expect(page.system.description).not.toContain(durableOf(mon0.out));
			expect(page.system.description).toContain("<p>prose</p>");
		});

		it("strips the same embed from a seeded world copy", async () => {
			const mon0 = monsters[0];
			const embed = `<p><img class="stonetop-journal-art" src="${durableOf(mon0.out)}" alt="${mon0.name}"></p>`;
			const worldPage = makeWorldPage({
				id: mon0.journalPageId, name: `cmp:${mon0.journalPageId}`, type: "bestiary",
				system: { description: `${embed}<p>world prose</p>` },
			});
			const worldEntry = makeWorldJournal({ source: JRN_SOURCE(mon0.journalEntryId), pages: [worldPage] });
			makeHarness({ present: allButFirst(), worldJournals: [worldEntry] });
			await reapplyBook2ArtOnVersionChange();

			expect(worldPage.system.description).not.toContain(durableOf(mon0.out));
			expect(worldPage.system.description).toContain("<p>world prose</p>");
		});

		it("strips nothing off a page when NO monster art is on disk", async () => {
			// Same guard as the actor reset: a browse that came back empty must not be read as
			// "every illustration in the book has been deleted".
			const mon0 = monsters[0];
			const embed = `<p><img class="stonetop-journal-art" src="${durableOf(mon0.out)}" alt="${mon0.name}"></p>`;
			const monsterOuts = new Set(monsters.map((m) => m.out));
			const locOnly = locations.flatMap((l) => l.images).map((im) => im.out).filter((o) => !monsterOuts.has(o));
			const h = makeHarness({ present: locOnly });
			const page = await cmpPage(h, mon0.journalEntryId, mon0.journalPageId);
			page.system.description = `${embed}<p>prose</p>`;
			await reapplyBook2ArtOnVersionChange();

			expect(page.system.description).toBe(`${embed}<p>prose</p>`);
		});

		it("strips a vanished plate off its location page", async () => {
			// A location row places into a section body rather than a description, so it travels a
			// different helper and needs its own cover.
			const loc = locations.find((l) => l.images.length === 1 && l.images[0].out.startsWith("assets/locations/"));
			expect(loc, "expected a single-image location plate").toBeTruthy();
			const embed = `<p><img class="stonetop-journal-art" src="${durableOf(loc.images[0].out)}" alt="${loc.name}"></p>`;
			const keep = locations.flatMap((l) => l.images).map((im) => im.out).filter((o) => o !== loc.images[0].out);
			const h = makeHarness({ present: keep.concat(monsters.map((m) => m.out)) });
			const page = await cmpPage(h, loc.journalEntryId, loc.journalPageId);
			const idx = loc.sectionIndex ?? 0;
			page.system.sections[idx] = { kind: "prose", heading: "At a Glance", body: `${embed}<p>glance</p>`, pairs: [], groups: [] };
			await reapplyBook2ArtOnVersionChange();

			expect(page.system.sections[idx].body).toBe("<p>glance</p>");
		});
	});
});

// The reusable worker behind the manual-import + self-heal triggers. These exercise the
// scoped / world-only / cheap-skip modes that the once-per-version pass above does not.
describe("reapplyBook2Art (scoped + self-heal modes)", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	it("scoped to `entries`: applies art to only those world journals, never the compendium/actors, never stamps the version", async () => {
		const mon0 = monsters[0];
		const loc0 = locations[0];
		const besPage = makeWorldPage({ id: mon0.journalPageId, name: `cmp:${mon0.journalPageId}`, type: "bestiary", system: { description: "<p>world bestiary prose</p>" } });
		const worldBes = makeWorldJournal({ source: JRN_SOURCE(mon0.journalEntryId), name: mon0.name, pages: [besPage], stamp: true });
		// Another journal that IS one of ours but is NOT in the scoped list -> left alone.
		const otherPage = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>loc prose</p>" })) } });
		const otherLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [otherPage], stamp: true });

		const h = makeHarness({ worldJournals: [worldBes, otherLoc] });
		const preHash = worldBes._flags["stonetop-pwd"].journalSync.hash;

		const result = await reapplyBook2Art({ entries: [worldBes] });

		// the scoped entry got its art and a fresh baseline
		expect(besPage.system.description).toContain(`src="${durableOf(mon0.out)}"`);
		expect(worldBes._flags["stonetop-pwd"].journalSync.hash).not.toBe(preHash);
		// the unscoped-but-ours journal is untouched
		expect(otherPage._writes).toBe(0);
		expect(otherLoc._flagWrites).toBe(0);
		// no compendium actor re-point, no world-actor pass, no version stamp
		expect(h.besPack.getDocument).not.toHaveBeenCalled();
		expect(h.store.book2ArtSyncVersion).toBe("");
		expect(result.total).toBeGreaterThan(0);
	});

	it("world-only self-heal adds MISSING art to a world journal without writing the compendium page", async () => {
		const loc0 = locations[0];
		const secIdx = loc0.sectionIndex ?? 0;
		const locPage = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>loc prose</p>" })) } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [locPage], stamp: true });

		const h = makeHarness({ worldJournals: [worldLoc] });
		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		// world copy got the art...
		expect(locPage.system.sections[secIdx].body).toContain(`src="${durableOf(loc0.images[0].out)}"`);
		expect(locPage._writes).toBeGreaterThan(0);
		// ...but neither the compendium page nor any actor was written, and no version stamp
		expect(h.updates.filter((u) => u.kind === "page")).toHaveLength(0);
		expect(h.updates.filter((u) => u.kind === "actor")).toHaveLength(0);
		expect(h.store.book2ArtSyncVersion).toBe("");
	});

	it("cheapWorldSkip does not even read the compendium when the world journal already has its art", async () => {
		const loc0 = locations[0];
		const secIdx = loc0.sectionIndex ?? 0;
		// A single location journal ENTRY can be the target of several manifest rows (its
		// pages / sections). The cheap-skip check is per-entry, so to avoid ANY read every
		// durable src of every row that shares this entry id must already be embedded.
		const allSrcs = locations
			.filter((l) => l.journalEntryId === loc0.journalEntryId)
			.flatMap((l) => l.images.map((im) => durableOf(im.out)));
		const sections = Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>loc prose</p>" }));
		sections[secIdx] = { kind: "prose", body: allSrcs.map((src) => `<p><img class="stonetop-journal-art" src="${src}"></p>`).join("") + "<p>loc prose</p>" };
		const locPage = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [locPage], stamp: true });

		const h = makeHarness({ worldJournals: [worldLoc] });
		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		expect(h.jrnPack.getDocument).not.toHaveBeenCalled(); // no compendium read
		expect(locPage._writes).toBe(0);
	});
});

// The steading portrait (the world "Stonetop" sheet) is a durable WORLD actor with no
// compendium id, found by type. It ships the "S" emblem and, before this, was wired ONLY by
// the Import Book Art macro's one-shot pass — no re-apply safety net — so a single miss left it
// "S" forever. reapply now re-points it over a shipped placeholder, the same conservative rule
// the macro uses, on the full/manual passes and the every-load self-heal (never a scoped import).
describe("the steading portrait (world Stonetop sheet)", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	const S = steadings[0];
	const PLACEHOLDER = "systems/stonetop-pwd/assets/stonetop_image.svg";
	const makeSteadingActor = (img = PLACEHOLDER) => {
		const a = { type: "stonetop", img, prototypeToken: { texture: { src: img, fit: "cover" } }, _writes: 0 };
		a.update = async (upd) => { applyUpdate(a, upd); a._writes++; };
		return a;
	};

	it("adopts the book art over the shipped 'S' placeholder (portrait + token)", async () => {
		expect(S).toBeTruthy(); // the apply manifest ships the steading row
		const steading = makeSteadingActor();
		makeHarness({ worldActors: [steading] });

		await reapplyBook2ArtOnVersionChange();

		expect(steading.img).toBe(durableOf(S.out));
		expect(steading.prototypeToken.texture.src).toBe(durableOf(S.out));
		expect(steading.prototypeToken.texture.fit).toBe("cover");
	});

	it("leaves a portrait the group chose themselves untouched", async () => {
		const steading = makeSteadingActor("worlds/mine/our-steading.png");
		makeHarness({ worldActors: [steading] });

		await reapplyBook2ArtOnVersionChange();

		expect(steading.img).toBe("worlds/mine/our-steading.png");
		expect(steading._writes).toBe(0);
	});

	it("does nothing when the steading art is not on disk", async () => {
		const steading = makeSteadingActor();
		makeHarness({ worldActors: [steading], present: "none" });

		await reapplyBook2ArtOnVersionChange();

		expect(steading.img).toBe(PLACEHOLDER);
		expect(steading._writes).toBe(0);
	});

	it("self-heals on the every-load world-only pass (a seeded world, no version bump)", async () => {
		// The self-heal reaches the actor pass only once the world has seeded journals of ours,
		// which every real world does; give it one so the pass runs to the steading block.
		const loc0 = locations[0];
		const page = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>loc prose</p>" })) } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [page], stamp: true });
		const steading = makeSteadingActor();
		makeHarness({ worldActors: [steading], worldJournals: [worldLoc] });

		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		expect(steading.img).toBe(durableOf(S.out));
	});

	it("does not touch the steading on a scoped journal import (never touches actors)", async () => {
		const loc0 = locations[0];
		const page = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>loc prose</p>" })) } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [page] });
		worldLoc.id = "imported-loc";
		const steading = makeSteadingActor();
		makeHarness({ worldActors: [steading], worldJournals: [worldLoc] });

		await reapplyBook2Art({ entries: [worldLoc] });

		expect(steading.img).toBe(PLACEHOLDER);
		expect(steading._writes).toBe(0);
	});
});

// A seeded world bestiary actor (SeedActors.js) ships with the compendium's creature-type
// placeholder icon. The conservative self-heal used to refuse to touch it, so a monster WITH
// book art stayed on its type icon forever — the mirror of the old steading-portrait bug.
// reapply now ADOPTS the durable art over that placeholder, the same rule the steading uses,
// on the full pass AND the every-load world-only self-heal, but never a portrait the group set.
describe("world bestiary actor portraits (adopt over the creature-type placeholder)", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	const PLACEHOLDER = "systems/stonetop-pwd/assets/icons/bestiary/natural-beast.svg";

	it("adopts the book art over the shipped creature-type icon (portrait + token + forced fit)", async () => {
		const mon0 = monsters[0];
		const actor = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER, fit: "contain" });
		makeHarness({ worldActors: [actor] });

		await reapplyBook2ArtOnVersionChange();

		expect(actor.img).toBe(durableOf(mon0.out));
		expect(actor.prototypeToken.texture.src).toBe(tokenSrcFor(mon0));
		expect(actor.prototypeToken.texture.fit).toBe("cover"); // forced when adopting over a placeholder token
	});

	it("adopts over the legacy core.sourceId flag too", async () => {
		const mon0 = monsters[0];
		const actor = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER, legacy: true });
		makeHarness({ worldActors: [actor] });

		await reapplyBook2ArtOnVersionChange();

		expect(actor.img).toBe(durableOf(mon0.out));
	});

	it("leaves a portrait the group chose themselves untouched", async () => {
		const mon0 = monsters[0];
		const actor = makeWorldActor({ source: uuidOf(mon0), img: "worlds/mine/my-crinwin.png" });
		makeHarness({ worldActors: [actor] });

		await reapplyBook2ArtOnVersionChange();

		expect(actor.img).toBe("worlds/mine/my-crinwin.png");
		expect(actor._writes).toBe(0);
	});

	it("re-points an actor still on a retired (de-duplicated) path", async () => {
		// A path this creature's art gave up when it turned out to be the same picture as a
		// peer's is still OURS, not a portrait the group chose — so it re-points, and the
		// orphaned file stops being referenced by anything.
		const monR = monsters.find((m) => m.retired?.length);
		expect(monR).toBeTruthy();
		const actor = makeWorldActor({ source: uuidOf(monR), img: durableOf(monR.retired[0]), fit: "contain" });
		actor.prototypeToken.texture.src = durableOf(monR.retired[0]);
		makeHarness({ worldActors: [actor] });

		await reapplyBook2ArtOnVersionChange();

		expect(actor.img).toBe(durableOf(monR.out));
		expect(actor.prototypeToken.texture.src).toBe(tokenSrcFor(monR));
		// Not a placeholder adoption, so the GM's token fit is still left alone.
		expect(actor.prototypeToken.texture.fit).toBe("contain");
	});

	it("adopts onto the token only, keeping a custom portrait, when just the token is a placeholder", async () => {
		// The group set a portrait of their own but left the prototype token on the shipped
		// creature-type icon. The guard is per-FIELD: keep the custom img, adopt the book art
		// onto the placeholder token (and force its fit).
		const mon0 = monsters[0];
		const actor = makeWorldActor({ source: uuidOf(mon0), img: "worlds/mine/my-crinwin.png", tokenSrc: PLACEHOLDER, fit: "contain" });
		makeHarness({ worldActors: [actor] });

		await reapplyBook2ArtOnVersionChange();

		expect(actor.img).toBe("worlds/mine/my-crinwin.png"); // custom portrait untouched
		expect(actor.prototypeToken.texture.src).toBe(tokenSrcFor(mon0)); // placeholder token adopts
		expect(actor.prototypeToken.texture.fit).toBe("cover");
	});

	// -- the hand-framed TOKEN square -----------------------------------------------------
	// A creature's token stands on its own small square while `img` stays the whole
	// illustration — so the sheet, the codex page and an image-hover popup keep showing the
	// artist's whole composition. The shipped manifest carries no tokens yet, so these stitch
	// one onto a real monster row for the length of the block: the wiring has to be right
	// BEFORE the first batch is framed, not discovered to be wrong after it.
	describe("the token square", () => {
		const mon0 = monsters[0];
		const TOKEN_OUT = "assets/bestiary/__test-crinwin-t100-100-900-900.webp";
		const RETIRED_TOKEN = "assets/bestiary/__test-crinwin-t000-000-500-500.webp";

		// Restore rather than delete: this row is the SHIPPED manifest's, shared with every other
		// test in the file, and one of them looks for a monster carrying `retired`. Deleting a key
		// that was really there would break a neighbour in a way that reads as a bug in the code.
		let saved;
		beforeEach(() => {
			vi.restoreAllMocks();
			saved = { token: mon0.token, tokenOut: mon0.tokenOut, retired: mon0.retired };
			mon0.token = [0.1, 0.1, 0.9, 0.9];
			mon0.tokenOut = TOKEN_OUT;
		});
		afterEach(() => {
			for (const k of ["token", "tokenOut", "retired"]) {
				if (saved[k] === undefined) delete mon0[k]; else mon0[k] = saved[k];
			}
		});

		it("points the token at the square and the portrait at the whole illustration", async () => {
			const actor = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER, fit: "contain" });
			makeHarness({ worldActors: [actor] });

			await reapplyBook2ArtOnVersionChange();

			expect(actor.img).toBe(durableOf(mon0.out));
			expect(actor.prototypeToken.texture.src).toBe(durableOf(TOKEN_OUT));
		});

		it("does the same for the compendium actor", async () => {
			const { besDocs } = makeHarness();

			await reapplyBook2ArtOnVersionChange();

			const doc = besDocs.get(mon0.actorId);
			expect(doc.img).toBe(durableOf(mon0.out));
			expect(doc.prototypeToken.texture.src).toBe(durableOf(TOKEN_OUT));
		});

		it("moves a token already wired to the whole illustration onto the square", async () => {
			// The upgrade shape: a world imported before tokens existed has both fields on the
			// illustration. The token pointer is one of OURS, so it may move; the portrait is
			// already right and must not.
			const actor = makeWorldActor({ source: uuidOf(mon0), img: durableOf(mon0.out) });
			makeHarness({ worldActors: [actor] });

			await reapplyBook2ArtOnVersionChange();

			expect(actor.img).toBe(durableOf(mon0.out));
			expect(actor.prototypeToken.texture.src).toBe(durableOf(TOKEN_OUT));
		});

		it("falls back to the illustration when the square is not on disk yet", async () => {
			// The state of every world between shipping a token rect and running the rebuild.
			// Pointing at a file nothing wrote would be a broken image on the battle map, which is
			// strictly worse than the centre-sliced illustration it replaces.
			const actor = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER });
			makeHarness({ worldActors: [actor], present: [mon0.out] });

			await reapplyBook2ArtOnVersionChange();

			expect(actor.img).toBe(durableOf(mon0.out));
			expect(actor.prototypeToken.texture.src).toBe(durableOf(mon0.out));
		});

		it("brings a token back to the illustration when its square was retired", async () => {
			// Clearing a token in the picker drops both keys and retires the old path. The file is
			// still on disk, so nothing LOOKS broken — which is exactly why the pointer has to be
			// recognised as ours and moved, or the creature keeps a square the manifest no longer
			// names for good.
			delete mon0.token;
			delete mon0.tokenOut;
			mon0.retired = [RETIRED_TOKEN];
			const actor = makeWorldActor({ source: uuidOf(mon0), img: durableOf(mon0.out), tokenSrc: durableOf(RETIRED_TOKEN) });
			makeHarness({ worldActors: [actor] });

			await reapplyBook2ArtOnVersionChange();

			expect(actor.prototypeToken.texture.src).toBe(durableOf(mon0.out));
		});

		it("still leaves a token the group chose themselves alone", async () => {
			const actor = makeWorldActor({ source: uuidOf(mon0), img: durableOf(mon0.out), tokenSrc: "worlds/mine/my-token.png" });
			makeHarness({ worldActors: [actor] });

			await reapplyBook2ArtOnVersionChange();

			expect(actor.prototypeToken.texture.src).toBe("worlds/mine/my-token.png");
		});

		it("writes nothing on a second pass over an already-tokened world", async () => {
			const actor = makeWorldActor({ source: uuidOf(mon0), img: durableOf(mon0.out), tokenSrc: durableOf(TOKEN_OUT) });
			makeHarness({ worldActors: [actor] });

			await reapplyBook2ArtOnVersionChange();

			expect(actor._writes).toBe(0);
		});
	});

	it("does nothing when the monster's art is not on disk", async () => {
		const mon0 = monsters[0];
		const actor = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER });
		makeHarness({ worldActors: [actor], present: "none" });

		await reapplyBook2ArtOnVersionChange();

		expect(actor.img).toBe(PLACEHOLDER);
		expect(actor._writes).toBe(0);
	});

	it("self-heals on the every-load world-only pass (version already stamped, actors seeded later)", async () => {
		// The exact stuck world: the version was stamped on a prior load, so the once-per-version
		// full pass never runs again; the bestiary actors were seeded afterwards with placeholder
		// icons. The world-only self-heal must still adopt their art, here alongside a seeded
		// journal of ours (the common case).
		const mon0 = monsters[0];
		const loc0 = locations[0];
		const page = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>loc prose</p>" })) } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [page], stamp: true });
		const actor = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER });
		makeHarness({ worldActors: [actor], worldJournals: [worldLoc] });

		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		expect(actor.img).toBe(durableOf(mon0.out));
	});

	it("self-heals on the world-only pass even with no seeded journals of ours (monster art on disk is enough)", async () => {
		// A world whose only work is a bestiary actor to adopt onto: no seeded gazetteer/codex
		// journals (deleted, or never seeded). The worldOnly early-return must NOT turn it away
		// on `!worldBySource.size` alone — monster art on disk is standalone actor work.
		const mon0 = monsters[0];
		const actor = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER });
		makeHarness({ worldActors: [actor], present: [mon0.out] }); // only this monster's art on disk, no world journals

		await reapplyBook2Art({ worldOnly: true, cheapWorldSkip: true });

		expect(actor.img).toBe(durableOf(mon0.out));
	});

	it("does not touch actors on a scoped journal import", async () => {
		const mon0 = monsters[0];
		const loc0 = locations[0];
		const page = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>loc prose</p>" })) } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [page] });
		worldLoc.id = "imported-loc";
		const actor = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER });
		makeHarness({ worldActors: [actor], worldJournals: [worldLoc] });

		await reapplyBook2Art({ entries: [worldLoc] });

		expect(actor.img).toBe(PLACEHOLDER);
		expect(actor._writes).toBe(0);
	});

	it("adopts only the monster whose art is on disk, leaving the rest on their icons (partial import)", async () => {
		const mon0 = monsters[0];
		const mon1 = monsters[1];
		const a0 = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER });
		const a1 = makeWorldActor({ source: uuidOf(mon1), img: PLACEHOLDER });
		makeHarness({ worldActors: [a0, a1], present: [mon0.out] });

		await reapplyBook2ArtOnVersionChange();

		expect(a0.img).toBe(durableOf(mon0.out));
		expect(a1.img).toBe(PLACEHOLDER);
		expect(a1._writes).toBe(0);
	});

	it("is idempotent: a second pass over an adopted actor makes no further writes", async () => {
		const mon0 = monsters[0];
		const actor = makeWorldActor({ source: uuidOf(mon0), img: PLACEHOLDER });
		const h = makeHarness({ worldActors: [actor] });

		await reapplyBook2ArtOnVersionChange();
		const writesAfterFirst = actor._writes;
		expect(writesAfterFirst).toBeGreaterThan(0);

		h.store.book2ArtSyncVersion = ""; // force another run as a version bump would
		await reapplyBook2ArtOnVersionChange();

		expect(actor._writes).toBe(writesAfterFirst); // already our art -> no new write
	});
});

// A compendium document update does not live-refresh an open pack browser or a sheet opened
// from it (Foundry caches the pack), so a GM who re-points the compendium with it open used to
// need an F5. reapply now re-renders those open views itself, so it "just works" for a GM who
// never touches the console.
describe("compendium live-refresh after re-pointing (no F5 needed)", () => {
	beforeEach(() => { vi.restoreAllMocks(); });
	afterEach(() => { delete global.foundry.applications; });

	it("re-renders an open pack browser and a sheet opened from the compendium", async () => {
		const h = makeHarness({});
		const browser = { render: vi.fn() };            // an open Monsters compendium window
		h.besPack.apps = [browser];
		h.besPack.collection = "stonetop-pwd.stonetop-bestiary";
		const sheet = { rendered: true, document: { pack: "stonetop-pwd.stonetop-bestiary" }, render: vi.fn() }; // a monster sheet opened from it
		global.foundry.applications = { instances: new Map([["a", sheet]]) };

		await reapplyBook2ArtOnVersionChange();

		expect(browser.render).toHaveBeenCalled();
		expect(sheet.render).toHaveBeenCalled();
	});

	it("leaves an unrelated open sheet (not from our compendium) alone", async () => {
		const h = makeHarness({});
		h.besPack.collection = "stonetop-pwd.stonetop-bestiary";
		const foreign = { rendered: true, document: { pack: "some.other.pack" }, render: vi.fn() };
		global.foundry.applications = { instances: new Map([["a", foreign]]) };

		await reapplyBook2ArtOnVersionChange();

		expect(foreign.render).not.toHaveBeenCalled();
	});

	it("does not touch any compendium view when nothing was written (no art on disk)", async () => {
		const h = makeHarness({ present: "none" });
		const browser = { render: vi.fn() };
		h.besPack.apps = [browser];
		h.besPack.collection = "stonetop-pwd.stonetop-bestiary";

		await reapplyBook2ArtOnVersionChange();

		expect(browser.render).not.toHaveBeenCalled();
	});
});

describe("handleImportedJournalArt (createJournalEntry hook)", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	it("embeds art into a journal imported from our pack (after the debounce)", async () => {
		vi.useFakeTimers();
		const loc0 = locations[0];
		const secIdx = loc0.sectionIndex ?? 0;
		const locPage = makeWorldPage({ id: loc0.journalPageId, name: `cmp:${loc0.journalPageId}`, type: "location", system: { sections: Array.from({ length: 64 }, () => ({ kind: "prose", body: "<p>imported prose</p>" })) } });
		const worldLoc = makeWorldJournal({ source: JRN_SOURCE(loc0.journalEntryId), name: loc0.name, pages: [locPage] });
		worldLoc.id = "imported-1";

		const h = makeHarness({ worldJournals: [worldLoc] });
		global.game.user.id = "gm-1";
		global.game.journal.get = (id) => (id === "imported-1" ? worldLoc : null);

		handleImportedJournalArt(worldLoc, {}, "gm-1");
		await vi.runAllTimersAsync();
		vi.useRealTimers();

		expect(locPage.system.sections[secIdx].body).toContain(`src="${durableOf(loc0.images[0].out)}"`);
		// scoped: no compendium re-point, no version stamp
		expect(h.besPack.getDocument).not.toHaveBeenCalled();
		expect(h.store.book2ArtSyncVersion).toBe("");
	});

	it("ignores a non-GM caller, a foreign-pack journal, and another user's import", async () => {
		vi.useFakeTimers();
		const h = makeHarness({ worldJournals: [] });
		global.game.user.id = "gm-1";
		global.game.journal.get = () => null;

		const ours = { id: "a", _stats: { compendiumSource: JRN_SOURCE("abc") } };
		global.game.user.isGM = false;
		handleImportedJournalArt(ours, {}, "gm-1");            // not a GM
		global.game.user.isGM = true;
		handleImportedJournalArt({ id: "b", _stats: { compendiumSource: "Compendium.other.pack.JournalEntry.z" } }, {}, "gm-1"); // foreign pack
		handleImportedJournalArt(ours, {}, "someone-else");    // a different user's create

		await vi.runAllTimersAsync();
		vi.useRealTimers();

		// none of the three scheduled real work: the durable folder was never even browsed
		expect(h.browse).not.toHaveBeenCalled();
	});
});

describe("curated codex pages", () => {
	// Two creatures share the Crinwin codex page (one journal entry, two ACTORS), so the
	// additive per-monster pass stacks both portraits on it. A `codex` entry makes the
	// manifest authoritative for that page instead: it names every illustration the page
	// owns and exactly which of them show, and where.
	const CRIN = monsters.find((m) => m.slug === "crinwin");
	const BROOD = monsters.find((m) => m.slug === "crinwin-broodfather");
	const ENTRY = CRIN.journalEntryId;
	const PROSE = "<p>Trust not thine ears</p>";
	const NEST_PROSE = "<p>They nest in the high branches.</p>";
	const embed = (m) => `<p><img class="stonetop-journal-art" src="${durableOf(m.out)}" alt="${m.name}"></p>`;
	const img = (m, slot) => ({ slot, images: [{ out: m.out, name: m.name }] });

	const curate = (slots) => {
		BOOK2_ART_APPLY_MANIFEST.codex = [{
			journalEntryId: ENTRY, journalPageId: CRIN.journalPageId, name: "Crinwin",
			managed: [CRIN.out, BROOD.out], slots,
		}];
	};
	// The page as it looks TODAY: both portraits prepended, so in reverse manifest order.
	const stackedPage = () => makeWorldPage({
		id: CRIN.journalPageId, name: "Crinwin", type: "bestiary",
		system: { description: embed(BROOD) + embed(CRIN) + PROSE, nests: NEST_PROSE },
	});

	afterEach(() => { delete BOOK2_ART_APPLY_MANIFEST.codex; });

	it("places each illustration in its chosen slot and normalises the stacked order", async () => {
		curate([img(CRIN, "banner"), img(BROOD, "nests")]);
		const page = stackedPage();
		const world = makeWorldJournal({ source: JRN_SOURCE(ENTRY), pages: [page], stamp: true });
		makeHarness({ worldJournals: [world] });

		await reapplyBook2Art();

		// The banner alone leads the description (lead-art lifts it); the broodfather moved
		// under Lair & Habitat and no longer stacks above the title.
		expect(page.system.description).toBe(embed(CRIN) + PROSE);
		expect(page.system.nests).toBe(NEST_PROSE + embed(BROOD));
	});

	it("strips an illustration the user hid, rather than merely not re-adding it", async () => {
		curate([img(CRIN, "banner")]);
		const page = stackedPage();
		const world = makeWorldJournal({ source: JRN_SOURCE(ENTRY), pages: [page], stamp: true });
		makeHarness({ worldJournals: [world] });

		await reapplyBook2Art();

		expect(page.system.description).toBe(embed(CRIN) + PROSE);
		expect(page.system.description).not.toContain(BROOD.out);
	});

	it("keeps a pristine entry pristine after a removal-only write (the prose channel stays open)", async () => {
		// The sharp edge: hiding art is a REMOVAL. If that write bypassed noteEntry, the
		// entry's hash would stop matching its baseline and the managed-journal channel
		// would treat it as GM-edited FOREVER, silently opting it out of prose updates.
		curate([img(CRIN, "banner")]);
		const page = stackedPage();
		const world = makeWorldJournal({ source: JRN_SOURCE(ENTRY), pages: [page], stamp: true });
		const preHash = world._flags["stonetop-pwd"].journalSync.hash;
		makeHarness({ worldJournals: [world] });

		await reapplyBook2Art();

		expect(world._flags["stonetop-pwd"].journalSync.hash).toBe(managedHash(world.toObject()));
		expect(world._flags["stonetop-pwd"].journalSync.hash).not.toBe(preHash);
		expect(world._flags["stonetop-pwd"].journalSync.version).toBe(VERSION);
	});

	it("leaves a GM-edited entry's edited baseline alone", async () => {
		curate([img(CRIN, "banner")]);
		const page = stackedPage();
		const world = makeWorldJournal({ source: JRN_SOURCE(ENTRY), pages: [page], syncHash: "EDITED-HASH" });
		makeHarness({ worldJournals: [world] });

		await reapplyBook2Art();

		expect(page.system.description).toBe(embed(CRIN) + PROSE);              // art still curated
		expect(world._flags["stonetop-pwd"].journalSync.hash).toBe("EDITED-HASH"); // but hands off
	});

	it("is a no-op on a page that already matches", async () => {
		curate([img(CRIN, "banner"), img(BROOD, "nests")]);
		const page = makeWorldPage({
			id: CRIN.journalPageId, name: "Crinwin", type: "bestiary",
			system: { description: embed(CRIN) + PROSE, nests: NEST_PROSE + embed(BROOD) },
		});
		const world = makeWorldJournal({ source: JRN_SOURCE(ENTRY), pages: [page], stamp: true });
		makeHarness({ worldJournals: [world] });

		await reapplyBook2Art();

		expect(page._writes).toBe(0);
		expect(world._flagWrites).toBe(0);
	});

	it("leaves the page alone when none of its art is on disk", async () => {
		// A GM who never imported these crops must not have art stripped off their page.
		curate([img(CRIN, "banner")]);
		const page = stackedPage();
		const before = page.system.description;
		const world = makeWorldJournal({ source: JRN_SOURCE(ENTRY), pages: [page], stamp: true });
		makeHarness({ worldJournals: [world], present: locations.flatMap((l) => l.images).map((im) => im.out) });

		await reapplyBook2Art();

		expect(page.system.description).toBe(before);
	});

	it("does not curate an entry the manifest says nothing about", async () => {
		// codex: [] is the shipped default — every other codex page keeps the additive path.
		BOOK2_ART_APPLY_MANIFEST.codex = [];
		const page = makeWorldPage({
			id: CRIN.journalPageId, name: "Crinwin", type: "bestiary",
			system: { description: PROSE, nests: NEST_PROSE },
		});
		const world = makeWorldJournal({ source: JRN_SOURCE(ENTRY), pages: [page], stamp: true });
		makeHarness({ worldJournals: [world] });

		await reapplyBook2Art();

		// both portraits still stack, exactly as before this feature existed
		expect(page.system.description).toContain(CRIN.out);
		expect(page.system.description).toContain(BROOD.out);
	});
});

// ── Hosts that serve the art folder from somewhere else ──────────────────────────────
//
// The Forge redirects a `data` upload into its Assets Library, and both browse and upload answer
// with `https://assets.forge-vtt.com/<userId>/<root>/…`. Every presence check in this module is a
// comparison against a path reassembled from the manifest, so before the browse keyed those
// root-relative EVERY row read as absent on such a world: the authoritative art indexes were
// republished empty — the People gallery went blank on a world holding all of its portraits —
// and no document was ever re-pointed.
describe("art served from a host prefix", () => {
	const FORGE = "https://assets.forge-vtt.com/abc123/";
	const served = (out) => `${FORGE}${ROOT}/${out}`;
	const firstPerson = people[0];

	beforeEach(() => { vi.restoreAllMocks(); });

	it("publishes the People gallery index instead of wiping it", async () => {
		const h = makeHarness({ hostPrefix: FORGE });
		await reapplyBook2Art();
		// The regression itself. Keyed by manifest `out`, exactly as on a self-hosted world, so
		// nothing about the setting's shape depends on where the files turned out to live.
		expect(Object.keys(h.store.peopleArt ?? {})).toHaveLength(people.length);
		expect(h.store.peopleArt[firstPerson.out]).toBe(firstPerson.name);
	});

	it("publishes the square-face index too", async () => {
		const h = makeHarness({ hostPrefix: FORGE });
		await reapplyBook2Art();
		expect(h.store.peoplePortraitArt[firstPerson.out]).toBe(firstPerson.portraitOut);
	});

	it("publishes the prefix, which is the only way a player can resolve any of it", async () => {
		const h = makeHarness({ hostPrefix: FORGE });
		await reapplyBook2Art();
		expect(h.store.book2ArtPrefix).toBe(FORGE);
	});

	it("leaves the prefix empty on a self-hosted world", async () => {
		const h = makeHarness();
		await reapplyBook2Art();
		expect(h.store.book2ArtPrefix ?? "").toBe("");
	});

	it("never publishes a prefix from a browse that came back empty", async () => {
		// An empty listing cannot tell "no art here" from "that call failed", and an empty prefix
		// would re-point every document at a path this host does not resolve.
		const h = makeHarness({ hostPrefix: FORGE, present: "none" });
		h.store.book2ArtPrefix = FORGE;
		await reapplyBook2Art();
		expect(h.store.book2ArtPrefix).toBe(FORGE);
	});

	it("never CLEARS a recorded prefix from a listing that observed none", async () => {
		// The sharper version of the test above, and the one `!present.size` does not cover: a
		// listing that DID return files, none of which carried a prefix. That is one stray file at
		// the data-relative path on a hosted world, and publishing "" from it is not cosmetic — the
		// prefix is what browse.js asks its second question with, so clearing it blinds the browse
		// for every directory from the next load on. A prefix is learned here and never unlearned.
		const h = makeHarness(); // bare paths, as a world with a stale data-relative copy lists
		h.store.book2ArtPrefix = FORGE;
		await reapplyBook2Art();
		expect(h.store.book2ArtPrefix).toBe(FORGE);
	});

	it("points a compendium actor at the URL the host served, not the bare path", async () => {
		const m = monsters[0];
		const h = makeHarness({ hostPrefix: FORGE });
		await reapplyBook2Art();
		expect((await h.besPack.getDocument(m.actorId)).img).toBe(served(m.out));
	});

	it("embeds the served URL on a journal page", async () => {
		const l = locations[0];
		const h = makeHarness({ hostPrefix: FORGE });
		await reapplyBook2Art();
		const page = h.pageDocs.get(`${l.journalEntryId}::${l.journalPageId}`);
		expect(page.system.sections[l.sectionIndex].body).toContain(served(l.images[0].out));
	});

	it("takes the stale bare embed off a page an earlier build wrote, rather than stacking on it", async () => {
		// The upgrade path: this world's pages carry `<root>/assets/…` from a build that did not
		// know where its art was served from. Both would render, and one of the two is broken.
		const l = locations[0];
		const bare = durableOf(l.images[0].out);
		const embed = `<p><img class="stonetop-journal-art" src="${bare}" alt=""></p>`;
		const page = makeWorldPage({
			id: l.journalPageId, name: `cmp:${l.journalPageId}`, type: "location",
			system: {
				sections: Array.from({ length: 64 }, (_, i) => ({
					body: i === l.sectionIndex ? `${embed}<p>loc prose</p>` : "<p>loc prose</p>",
				})),
			},
		});
		const world = makeWorldJournal({ source: JRN_SOURCE(l.journalEntryId), pages: [page], stamp: true });
		makeHarness({ hostPrefix: FORGE, worldJournals: [world] });

		await reapplyBook2Art();

		const body = page.system.sections[l.sectionIndex].body;
		expect(body).toContain(served(l.images[0].out));
		expect(body).not.toContain(`src="${bare}"`);
	});

	it("re-points a world actor still holding the bare path", async () => {
		// `tails` match on the manifest `out`, which is a suffix of BOTH spellings — so a world
		// wired by an older build is recognised as ours and moved, not mistaken for custom art.
		const m = monsters[0];
		const actor = makeWorldActor({ source: uuidOf(m), img: durableOf(m.out) });
		makeHarness({ hostPrefix: FORGE, worldActors: [actor] });

		await reapplyBook2Art();

		expect(actor.img).toBe(served(m.out));
	});

	it("leaves a portrait the group chose alone, prefix or no prefix", async () => {
		const m = monsters[0];
		const actor = makeWorldActor({ source: uuidOf(m), img: "worlds/mine/our-own-drawing.webp" });
		makeHarness({ hostPrefix: FORGE, worldActors: [actor] });

		await reapplyBook2Art();

		expect(actor.img).toBe("worlds/mine/our-own-drawing.webp");
		expect(actor._writes).toBe(0);
	});
});
