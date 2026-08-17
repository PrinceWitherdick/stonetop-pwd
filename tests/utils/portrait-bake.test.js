import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bakeFrameToFile, bakeFileName } from "../../module/utils/portrait-tokenizer.js";
import { PORTRAIT_FRAME_BAKE_DIR } from "../../module/utils/portrait-frame.js";

// Baking a chosen portrait frame to a real .webp, which is what a token can actually point at.
//
// The half of portrait-tokenizer.js that was never covered, because it is a canvas + upload round
// trip. Both of those are module-boundary calls, so they stub cleanly and everything between them
// — the guards, the destination, and above all what this hands back — is testable without a
// browser. That mattered: the failure it went uncovered through was a REJECTED upload being read
// as "succeeded but did not say where", so the function returned a path to a file that was never
// written and the caller stamped it onto the prototype token as a permanent broken image.

const ART = "worlds/mine/art/bryn.webp";
const RECT = [0.2, 0.05, 0.7, 0.55];
const DIR = `worlds/mine/${PORTRAIT_FRAME_BAKE_DIR}`;
const NAME = bakeFileName("Bryn", "abc");

// The canvas half, stubbed where portrait-tokenizer.js imports it. `artImageUrl` is passed through
// unchanged so a test can assert what the loader was actually asked for.
const art = vi.hoisted(() => ({
	loadImage: vi.fn(),
	cropToCanvas: vi.fn(),
	artImageUrl: vi.fn((s) => `routed:${s}`),
}));
vi.mock("../../module/book2-art/rebuild-crops.js", () => art);

/** An <img> that decoded, or one that did not. */
const image = ({ w = 400, h = 600 } = {}) => ({ naturalWidth: w, naturalHeight: h });
/** A canvas whose encode yields a blob, or nothing. */
const canvas = (blob = new Blob(["webp"], { type: "image/webp" })) => ({ toBlob: (cb) => cb(blob) });

let upload;
let createDirectory;

beforeEach(() => {
	art.loadImage.mockResolvedValue(image());
	art.cropToCanvas.mockReturnValue(canvas());
	art.artImageUrl.mockImplementation((s) => `routed:${s}`);
	upload = vi.fn(async () => ({ status: "success", path: `${DIR}/${NAME}` }));
	createDirectory = vi.fn(async () => ({}));
	globalThis.game = { world: { id: "mine" } };
	// `foundry` (from tests/setup.js) carries no `applications`, so filePicker() falls through to
	// this — the same path a v11/v12 client takes.
	globalThis.FilePicker = { upload, createDirectory };
});

afterEach(() => {
	delete globalThis.game;
	delete globalThis.FilePicker;
	vi.clearAllMocks();
});

describe("bakeFrameToFile", () => {
	it("writes the crop into the world's bake folder and returns where it landed", async () => {
		await expect(bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" })).resolves.toBe(`${DIR}/${NAME}`);
		expect(createDirectory).toHaveBeenCalledWith("data", DIR, {});
		const [source, dir, file] = upload.mock.calls[0];
		expect([source, dir]).toEqual(["data", DIR]);
		expect(file.name).toBe(NAME);
		expect(file.type).toBe("image/webp");
	});

	it("cuts the rect it was given out of the routed image", async () => {
		await bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" });
		expect(art.artImageUrl).toHaveBeenCalledWith(ART);
		expect(art.loadImage).toHaveBeenCalledWith(`routed:${ART}`);
		expect(art.cropToCanvas).toHaveBeenCalledWith(expect.objectContaining({ naturalWidth: 400 }), RECT);
	});

	it("strips a cache-buster off the source before routing it", async () => {
		// Tokenizer rewrites `actor.img` to `<path>?<timestamp>` on every run, and a re-frame
		// stamps one of our own. Neither is part of the file's name.
		await bakeFrameToFile(`${ART}?1699999999#x`, RECT, { name: "Bryn", id: "abc" });
		expect(art.artImageUrl).toHaveBeenCalledWith(ART);
	});

	// -- what it hands back ---------------------------------------------------------------

	it("believes the upload about where the file went", async () => {
		// The hosted case. On The Forge a `data` upload is redirected into the Assets Library and
		// answers with an absolute URL, so the reassembled path names nothing — see
		// project_forge-hosted-art-paths. `result.path` is the only correct answer here.
		const served = "https://assets.forge-vtt.com/abc123/worlds/mine/portrait-frames/Bryn-abc-frame.webp";
		upload.mockResolvedValue({ status: "success", path: served });
		await expect(bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" })).resolves.toBe(served);
	});

	it("returns null when the server REJECTED the upload", async () => {
		// The regression. Foundry's own FilePicker returns false when the server answers with an
		// error, and The Forge's replacement returns false on every failure path it has — neither
		// throws. Read as "no path reported", this used to hand back a rebuilt path to a file that
		// does not exist, and the caller wrote it onto the token.
		upload.mockResolvedValue(false);
		await expect(bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" })).resolves.toBeNull();
	});

	it("returns null when the upload answers without a result at all", async () => {
		// Core's other failure branch: a response carrying no path returns undefined.
		upload.mockResolvedValue(undefined);
		await expect(bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" })).resolves.toBeNull();
	});

	it("still names the file when a picker reports success without saying where", async () => {
		// Not a failure — a result object is the picker's own "this worked". The rebuilt path is
		// right on any host that keeps user files on the data path, which is every self-hosted one.
		upload.mockResolvedValue({ status: "success" });
		await expect(bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" })).resolves.toBe(`${DIR}/${NAME}`);
	});

	// -- the guards, none of which should reach the server -----------------------------------

	it("bakes nothing without a source or a usable rect", async () => {
		for (const [src, rect] of [["", RECT], [null, RECT], [ART, null], [ART, [0.5, 0.5, 0.1, 0.1]], [ART, [0, 0, 0.0001, 0.0001]]]) {
			await expect(bakeFrameToFile(src, rect, { name: "Bryn", id: "abc" })).resolves.toBeNull();
		}
		expect(art.loadImage).not.toHaveBeenCalled();
		expect(upload).not.toHaveBeenCalled();
	});

	it("bakes nothing when the picture never decoded", async () => {
		// An image that 404s, or one a tainted-canvas host refused — `loadImage` resolves an
		// element with no intrinsic size rather than throwing.
		art.loadImage.mockResolvedValue(image({ w: 0, h: 0 }));
		await expect(bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" })).resolves.toBeNull();
		expect(upload).not.toHaveBeenCalled();
	});

	it("bakes nothing when the encode yields no blob", async () => {
		// What a tainted canvas actually does: it fails at toBlob, after all the work.
		art.cropToCanvas.mockReturnValue(canvas(null));
		await expect(bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" })).resolves.toBeNull();
		expect(createDirectory).not.toHaveBeenCalled();
		expect(upload).not.toHaveBeenCalled();
	});

	it("uploads anyway when the folder already exists", async () => {
		// createDirectory throws for an existing folder; that is the normal case, not an error.
		createDirectory.mockRejectedValue(new Error("EEXIST"));
		await expect(bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" })).resolves.toBe(`${DIR}/${NAME}`);
		expect(upload).toHaveBeenCalledTimes(1);
	});

	it("falls back to a stable folder when the world has no id", async () => {
		globalThis.game = {};
		upload.mockResolvedValue({ status: "success" });
		await expect(bakeFrameToFile(ART, RECT, { name: "Bryn", id: "abc" }))
			.resolves.toBe(`worlds/world/${PORTRAIT_FRAME_BAKE_DIR}/${NAME}`);
	});
});
