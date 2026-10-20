import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// resolveSettlementPortraits on a GM's client: what it writes, how often, and in what order it
// answers. The browse, the uploads and the image decode are all stand-ins, so what is pinned here is
// the bookkeeping: every place planned first, the distinct writes out together, a file two places
// share written once, a book picture two places are cut from decoded once, each folder made once,
// and only the settlement folders' listings forgotten afterwards.

vi.mock("../../../module/book2-art/art-root.js", async importOriginal => ({
	...(await importOriginal()),
	book2ArtRoot: () => "stonetop-book-art",
}));
vi.mock("../../../module/book2-art/browse.js", async importOriginal => ({
	...(await importOriginal()),
	browseArtDirs: vi.fn(),
	forgetArtBrowseDirs: vi.fn(),
	clearArtBrowseCache: vi.fn(),
}));
vi.mock("../../../module/utils/foundry-compat.js", async importOriginal => ({
	...(await importOriginal()),
	ensureDataDir: vi.fn(),
	uploadFile: vi.fn(),
}));
vi.mock("../../../module/book2-art/rebuild-crops.js", () => ({
	loadImage: vi.fn(),
	cropToCanvas: vi.fn(() => ({ toBlob: done => done(new Blob(["webp"])) })),
	artImageUrl: src => src,
	WEBP_QUALITY: 0.85,
}));

const { ArtInventory, browseArtDirs, forgetArtBrowseDirs, clearArtBrowseCache } = await import("../../../module/book2-art/browse.js");
const { ensureDataDir, uploadFile } = await import("../../../module/utils/foundry-compat.js");
const { loadImage } = await import("../../../module/book2-art/rebuild-crops.js");
const {
	SETTLEMENT_DEFAULT_IMG, resolveSettlementPortraits, settlementPortraitOut,
} = await import("../../../module/actors/settlement/settlement-portrait.js");

const ART = "stonetop-book-art";
const MANMARCH = `${ART}/assets/locations/north-manmarch-1.webp`;
const LETTERS = "assets/settlements/letters";
const onDisk = (...paths) => browseArtDirs.mockResolvedValue(paths.reduce((inv, p) => inv.add(p), new ArtInventory(ART)));

beforeEach(() => {
	vi.stubGlobal("game", { user: { isGM: true } });
	onDisk();
	ensureDataDir.mockImplementation(async () => {});
	uploadFile.mockImplementation(async (_source, dir, file) => `${dir}/${file.name}`);
	loadImage.mockImplementation(async src => ({ src, naturalWidth: 100, naturalHeight: 100 }));
});
afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("resolveSettlementPortraits", () => {
	it("cuts two places from one book picture after decoding it once", async () => {
		onDisk(MANMARCH);
		const got = await resolveSettlementPortraits([
			{ key: "manmarch-hamlet", name: "Manmarch hamlet" },
			{ key: "manmarch-hillfort", name: "North Manmarch hillfort" },
		]);
		expect(got).toEqual([
			`${ART}/${settlementPortraitOut("manmarch-hamlet")}`,
			`${ART}/${settlementPortraitOut("manmarch-hillfort")}`,
		]);
		expect(loadImage).toHaveBeenCalledTimes(1);
		expect(loadImage).toHaveBeenCalledWith(MANMARCH);
		expect(uploadFile).toHaveBeenCalledTimes(2);
	});

	it("sends the distinct writes out together rather than one after another", async () => {
		const pending = [];
		uploadFile.mockImplementation((_s, dir, file) => new Promise(resolve => pending.push(() => resolve(`${dir}/${file.name}`))));
		const resolving = resolveSettlementPortraits([
			{ key: "", name: "Ashby" },
			{ key: "", name: "Bridgewater" },
			{ key: "", name: "Corran" },
		]);
		await vi.waitFor(() => expect(pending).toHaveLength(3));
		pending.forEach(go => go());
		expect(await resolving).toEqual(["A", "B", "C"].map(c => `${ART}/${LETTERS}/${c}-v1.svg`));
	});

	it("writes a disc two places share once, and hands both of them the one file", async () => {
		const got = await resolveSettlementPortraits([
			{ key: "", name: "Mill bridge" },
			{ key: "", name: "Mammoth band" },
		]);
		expect(got).toEqual([`${ART}/${LETTERS}/MB-v1.svg`, `${ART}/${LETTERS}/MB-v1.svg`]);
		expect(uploadFile).toHaveBeenCalledTimes(1);
	});

	it("asks for each folder once, every parent first, however many files go into them", async () => {
		const order = [], made = new Set();
		// As createDirectory: one folder, never its parents. Nothing is on disk, not even the art root.
		ensureDataDir.mockImplementation(async dir => {
			order.push(dir);
			await new Promise(r => setTimeout(r, 5));
			const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
			if (parent && !made.has(parent)) throw new Error(`${parent} not made yet`);
			made.add(dir);
		});
		uploadFile.mockImplementation(async (_s, dir, file) => {
			if (!made.has(dir)) throw new Error(`${dir} not made yet`);
			return `${dir}/${file.name}`;
		});
		onDisk(MANMARCH);
		await resolveSettlementPortraits([
			{ key: "manmarch-hamlet", name: "Manmarch hamlet" },
			{ key: "", name: "Ashby" },
			{ key: "", name: "Bridgewater" },
		]);
		expect(order).toEqual([ART, `${ART}/assets`, `${ART}/assets/settlements`, `${ART}/${LETTERS}`]);
		// Every upload waited for its folder to be made (the stand-in refuses one that did not).
		expect(await Promise.all(uploadFile.mock.results.map(r => r.value))).toHaveLength(3);
	});

	it("falls back per place, keeping the places in order", async () => {
		onDisk(MANMARCH, `${ART}/${LETTERS}/M-v1.svg`);
		loadImage.mockRejectedValueOnce(new Error("truncated upload"));
		uploadFile.mockImplementation(async (_s, dir, file) => {
			if (file.name.startsWith("B-")) throw new Error("refused");
			return `${dir}/${file.name}`;
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const got = await resolveSettlementPortraits([
			{ key: "manmarch-hamlet", name: "Manmarch hamlet" },   // the decode fails: its initials
			{ key: "", name: "Bridgewater" },                      // the upload fails: the village icon
			{ key: "", name: "1066" },                             // no letter at all: the village icon
			{ key: "", name: "Marshwick" },                        // already on disk: no write
		]);
		expect(got).toEqual([`${ART}/${LETTERS}/MH-v1.svg`, SETTLEMENT_DEFAULT_IMG, SETTLEMENT_DEFAULT_IMG, `${ART}/${LETTERS}/M-v1.svg`]);
		expect(warn).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});

	it("forgets only the settlement folders' listings after a write, and nothing when nothing was written", async () => {
		await resolveSettlementPortraits([{ key: "", name: "Ashby" }]);
		expect(forgetArtBrowseDirs).toHaveBeenCalledTimes(1);
		expect(forgetArtBrowseDirs).toHaveBeenCalledWith(ART, ["assets/settlements", LETTERS]);
		expect(clearArtBrowseCache).not.toHaveBeenCalled();

		vi.clearAllMocks();
		onDisk(`${ART}/${LETTERS}/A-v1.svg`);
		expect(await resolveSettlementPortraits([{ key: "", name: "Ashby" }])).toEqual([`${ART}/${LETTERS}/A-v1.svg`]);
		expect(uploadFile).not.toHaveBeenCalled();
		expect(forgetArtBrowseDirs).not.toHaveBeenCalled();
	});
});
