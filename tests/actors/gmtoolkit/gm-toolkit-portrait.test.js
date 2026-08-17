import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GM_TOOLKIT_DEFAULT_IMG, createGmToolkit } from "../../../module/actors/gmtoolkit/gm-toolkit-actor.js";
import { _ensureGmToolkit } from "../../../module/hooks/Ready.js";

// The GM Toolkit's portrait, and the two silent ways it breaks.
//
// An Actor's `img` is a PATH, resolved by the browser long after any of our code has run: point it
// at a file that is not there and Foundry logs nothing, the sidebar row simply shows a broken
// image. So the constant and the file on disk are checked against each other here rather than
// trusted to agree.
//
// The drawing is third-party art under CC BY 3.0 (game-icons.net, "read" by Skoll), which makes
// crediting it a licence term rather than a courtesy.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");

// `systems/<id>/...` is how Foundry addresses it at runtime; on disk that prefix is the package
// directory itself. Strip it and the rest must be a real file.
const ON_DISK = GM_TOOLKIT_DEFAULT_IMG.replace(/^systems\/[^/]+\//, "");

describe("the GM Toolkit portrait file", () => {
	it("is where the constant says it is", () => {
		expect(GM_TOOLKIT_DEFAULT_IMG).toMatch(/^systems\/[^/]+\/assets\/icons\/gm-toolkit\.svg$/);
		expect(fs.existsSync(path.join(ROOT, ON_DISK))).toBe(true);
	});

	// The mark is read on Foundry's dark sidebar as well as on the sheet's parchment, and a plain
	// black disc loses its edge against the first. The cream disc showing past the black field as a
	// hairline rim is what prevents that, and it is the same rim the Book I creature marks and the
	// follower marker carry — which is what makes a shelf of these read as one set.
	it("keeps its cream rim outside the black field", () => {
		const svg = read(ON_DISK);
		const radii = [...svg.matchAll(/<circle cx="800" cy="800" r="([\d.]+)" fill="(#[0-9a-f]{3,6})"/g)]
			.map(m => ({ r: Number(m[1]), fill: m[2] }));

		expect(radii).toHaveLength(2);
		const [disc, field] = radii;
		expect(disc.fill).toBe("#f0ece3");
		expect(field.fill).toBe("#000");
		expect(disc.r).toBeGreaterThan(field.r);
		// The 10.85 the Book I marks leave. A rim thinner than about 8 units vanishes at 36px.
		expect(disc.r - field.r).toBeGreaterThanOrEqual(8);
	});

	// The trap the sibling files carry a warning about: an XML comment may not hold two hyphens in
	// a row, and an SVG loaded through <img> is parsed strictly. A stray pair anywhere in the long
	// recipe comment makes the WHOLE file fail to render, as a broken image rather than a warning.
	it("has no double hyphen inside its comment", () => {
		const comments = [...read(ON_DISK).matchAll(/<!--([\s\S]*?)-->/g)].map(m => m[1]);
		expect(comments.length).toBeGreaterThan(0);
		for (const body of comments) expect(body).not.toContain("--");
	});

	it("draws the glyph in cream, not the source's white on a black square", () => {
		const svg = read(ON_DISK);
		expect(svg).toContain('fill="#f0ece3"');
		// The game-icons repo original opens with an unfilled 512 backing square. Ours replaces
		// that ground entirely, so the square must not have come along.
		expect(svg).not.toContain('d="M0 0h512v512H0z"');
	});

	it("credits the artist, as CC BY 3.0 requires", () => {
		const attribution = read("assets/icons/ATTRIBUTION.md");
		expect(attribution).toContain("CC BY 3.0");
		expect(attribution).toMatch(/\|\s*gm-toolkit\.svg\s*\|\s*read\s*\|\s*Skoll\s*\|/);
	});
});

describe("a new toolkit wears it", () => {
	let created, saved;

	beforeEach(() => {
		created = [];
		saved = { game: globalThis.game, getDocumentClass: globalThis.getDocumentClass };
		globalThis.game = { i18n: { localize: () => "GM Toolkit" } };
		globalThis.getDocumentClass = () => ({ create: async data => { created.push(data); return data; } });
	});
	afterEach(() => {
		globalThis.game = saved.game;
		globalThis.getDocumentClass = saved.getDocumentClass;
	});

	it("stamps the portrait on the sidebar row and on the token", async () => {
		await createGmToolkit();
		expect(created[0].img).toBe(GM_TOOLKIT_DEFAULT_IMG);
		// A GM can drag the toolkit onto a scene, and Foundry defaults a token to mystery-man
		// regardless of `img`, so the two would otherwise disagree.
		expect(created[0].prototypeToken.texture.src).toBe(GM_TOOLKIT_DEFAULT_IMG);
	});
});

// The portrait shipped after the subtype did, so worlds already hold toolkits on Foundry's
// mystery-man. That is the absence of a portrait rather than a chosen one, and on this sheet it
// reads as "a person nobody has found a picture for", so it is worth healing. Once.
describe("an existing toolkit is healed, but only over a stock default", () => {
	let saved;

	/** @param {object} opts.img  What the world's toolkit is currently wearing. */
	function world({ img, primary = true }) {
		const toolkit = { id: "t1", type: "gmToolkit", img, update: vi.fn(async () => {}) };
		globalThis.game = {
			actors: [toolkit],
			i18n: { localize: () => "GM Toolkit" },
			// isPrimaryGM(): a named activeGM that is not us makes this client a co-GM.
			...(primary ? {} : { users: { activeGM: { id: "gm2" }, find: () => ({ id: "gm2" }) } }),
			user: { id: "gm1", isGM: true },
		};
		globalThis.CONST = { DEFAULT_TOKEN: "icons/svg/mystery-man.svg" };
		return toolkit;
	}

	beforeEach(() => { saved = { game: globalThis.game, CONST: globalThis.CONST }; });
	afterEach(() => { globalThis.game = saved.game; globalThis.CONST = saved.CONST; });

	it("replaces Foundry's mystery-man", async () => {
		const toolkit = world({ img: "icons/svg/mystery-man.svg" });
		await _ensureGmToolkit();
		expect(toolkit.update).toHaveBeenCalledWith({
			img: GM_TOOLKIT_DEFAULT_IMG,
			"prototypeToken.texture.src": GM_TOOLKIT_DEFAULT_IMG,
		});
	});

	it("replaces a missing image too", async () => {
		const toolkit = world({ img: "" });
		await _ensureGmToolkit();
		expect(toolkit.update).toHaveBeenCalled();
	});

	// The whole point of gating on isDefaultImg. A GM who picked their own picture keeps it, and
	// keeps it on every load after this one.
	it("leaves a portrait the GM chose alone", async () => {
		const toolkit = world({ img: "worlds/mine/my-gm-screen.webp" });
		await _ensureGmToolkit();
		expect(toolkit.update).not.toHaveBeenCalled();
	});

	// Idempotent by construction: once healed the image is no longer a default, so the next load
	// reads it as chosen art and stops. No latch needed, and nothing to jam.
	it("does not run again once it has run", async () => {
		const toolkit = world({ img: GM_TOOLKIT_DEFAULT_IMG });
		await _ensureGmToolkit();
		expect(toolkit.update).not.toHaveBeenCalled();
	});

	// A shared-world write, so it obeys the same rule the mint does.
	it("is left to the primary GM", async () => {
		const toolkit = world({ img: "icons/svg/mystery-man.svg", primary: false });
		await _ensureGmToolkit();
		expect(toolkit.update).not.toHaveBeenCalled();
	});

	// The reason the ready hook asks _ensureGmToolkit directly rather than only through
	// _assignGmToolkitToGm: that one returns on its per-user latch BEFORE reaching the mint, so on
	// any world whose GMs were assigned before this portrait shipped the heal would never run at
	// all. Pinned as a call-order fact because it is invisible from either function alone.
	it("is reachable without the per-user assignment latch", async () => {
		const src = read("module/hooks/Ready.js");
		const readyBody = src.slice(src.indexOf("_ensurePlayerActorCreationGrant()"));
		const mint = readyBody.indexOf("await _ensureGmToolkit()");
		const assign = readyBody.indexOf("await _assignGmToolkitToGm()");
		expect(mint, "onReady never calls _ensureGmToolkit on its own").toBeGreaterThan(-1);
		expect(mint).toBeLessThan(assign);
	});

	// Cosmetic, so a failed write must never cost the GM the toolkit itself.
	it("still hands back the toolkit when the write fails", async () => {
		const toolkit = world({ img: "icons/svg/mystery-man.svg" });
		toolkit.update.mockRejectedValueOnce(new Error("no"));
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await _ensureGmToolkit()).toBe(toolkit);
		spy.mockRestore();
	});
});
