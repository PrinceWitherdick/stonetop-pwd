import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { upsertPosterMapScene } from "../../module/book2-art/poster-maps.js";

// upsertPosterMapScene's two guards against core drawing a Scene while pins are laid on it:
// a new Scene is created inactive and only activated once its pins are down, and a refresh of
// the Scene the GM is looking at waits for the redraw core starts without awaiting. A slug with
// no recorded label positions and no lettered notes, so no pins are laid and the test only sees
// the Scene's own writes.

const MAP = { slug: "test-map", name: "Test Map", navName: "Test", navOrder: 1, sort: 0, width: 1000, notes: [] };
const IMG = { src: "maps/test.webp", w: 1000, h: 500 };

function fakeScene(data, { isView = false } = {}) {
	const scene = {
		...data,
		background: { ...data.background },
		notes: { contents: [] },
		isView,
		update: vi.fn(async changes => {
			for (const [key, value] of Object.entries(changes)) {
				if (key === "background.src") scene.background.src = value;
				else if (!key.includes(".")) scene[key] = value;
			}
		}),
		createThumbnail: vi.fn(async () => ({})),
		activate: vi.fn(async () => {}),
	};
	return scene;
}

function stubWorld({ scenes = [], active = null } = {}) {
	const created = [];
	vi.stubGlobal("Scene", {
		schema: { fields: {} },
		create: vi.fn(async data => {
			const scene = fakeScene(data);
			created.push(scene);
			return scene;
		}),
	});
	vi.stubGlobal("game", { system: { id: "stonetop-pwd" }, scenes: Object.assign([...scenes], { active }), settings: { get: () => ({}) } });
	const canvas = { draw: vi.fn(async () => canvas) };
	vi.stubGlobal("canvas", canvas);
	return { created, canvas };
}

describe("upsertPosterMapScene", () => {
	beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("creates the Scene inactive and activates it last, in a world with no active Scene", async () => {
		const { created } = stubWorld();
		const result = await upsertPosterMapScene(MAP, IMG);
		expect(result.created).toBe(true);
		expect(Scene.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
		const [scene] = created;
		expect(scene.activate).toHaveBeenCalledOnce();
		expect(scene.activate.mock.invocationCallOrder[0])
			.toBeGreaterThan(scene.createThumbnail.mock.invocationCallOrder[0]);
	});

	it("leaves another Scene active", async () => {
		const { created } = stubWorld({ active: { id: "other" } });
		await upsertPosterMapScene(MAP, IMG);
		expect(created[0].activate).not.toHaveBeenCalled();
	});

	it("still activates a new Scene when laying its pins throws", async () => {
		const { created } = stubWorld();
		Scene.create.mockImplementationOnce(async data => {
			const scene = fakeScene(data);
			Object.defineProperty(scene, "notes", { get() { throw new Error("pins failed"); } });
			created.push(scene);
			return scene;
		});
		await expect(upsertPosterMapScene({ ...MAP, notes: [{ key: "a" }] }, IMG)).rejects.toThrow("pins failed");
		expect(created[0].activate).toHaveBeenCalledOnce();
	});

	it("does not activate a Scene it only refreshed", async () => {
		const existing = fakeScene({ name: MAP.name, width: 1000, height: 500, background: { src: IMG.src }, flags: {} });
		stubWorld({ scenes: [existing] });
		const result = await upsertPosterMapScene(MAP, IMG);
		expect(result.created).toBe(false);
		expect(existing.activate).not.toHaveBeenCalled();
	});

	it("waits out the redraw when it changes the artwork of the Scene being viewed", async () => {
		const existing = fakeScene({ name: MAP.name, width: 1000, height: 500, background: { src: "maps/old.webp" }, flags: {} }, { isView: true });
		const { canvas } = stubWorld({ scenes: [existing] });
		await upsertPosterMapScene(MAP, IMG);
		expect(canvas.draw).toHaveBeenCalledWith(existing);
		expect(canvas.draw.mock.invocationCallOrder[0])
			.toBeGreaterThan(existing.update.mock.invocationCallOrder[0]);
	});

	it.each([
		["nothing changed", { isView: true }, { src: IMG.src, height: 500 }],
		["the Scene is not being viewed", { isView: false }, { src: "maps/old.webp", height: 400 }],
	])("does not redraw when %s", async (_, view, was) => {
		const existing = fakeScene({ name: MAP.name, width: 1000, height: was.height, background: { src: was.src }, flags: {} }, view);
		const { canvas } = stubWorld({ scenes: [existing] });
		await upsertPosterMapScene(MAP, IMG);
		expect(canvas.draw).not.toHaveBeenCalled();
	});
});
