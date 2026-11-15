import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOnce, findOrCreateFolder } from "../../module/utils/create-once.js";

// Find-or-create with no twins (utils/create-once.js): two writers that overlap, the playbook library
// adopting its files at ready while a GM presses Save, must make one folder between them.

let folders;
beforeEach(() => {
	folders = [];
	let n = 0;
	vi.stubGlobal("game", { folders });
	vi.stubGlobal("Folder", {
		create: vi.fn(async data => {
			await new Promise(resolve => setTimeout(resolve, 5));
			const folder = { ...data, id: `f${++n}` };
			folders.push(folder);
			return folder;
		}),
	});
});
afterEach(() => vi.unstubAllGlobals());

describe("findOrCreateFolder", () => {
	it("makes one folder for two asks at once", async () => {
		const [a, b] = await Promise.all([
			findOrCreateFolder("Item", "Homebrew Playbooks", null, { sorting: "a" }),
			findOrCreateFolder("Item", "Homebrew Playbooks", null, { sorting: "a" }),
		]);
		expect(a).toBe(b);
		expect(Folder.create).toHaveBeenCalledTimes(1);
		expect(a).toMatchObject({ name: "Homebrew Playbooks", type: "Item", folder: null, sorting: "a" });
	});

	it("finds one already there, by type, name and parent", async () => {
		folders.push({ id: "x", type: "Item", name: "Moves", folder: { id: "p" } });
		expect((await findOrCreateFolder("Item", "Moves", "p")).id).toBe("x");
		expect(Folder.create).not.toHaveBeenCalled();
		// The same name elsewhere, or of another type, is another folder.
		await findOrCreateFolder("Item", "Moves", null);
		await findOrCreateFolder("JournalEntry", "Moves", "p");
		expect(Folder.create).toHaveBeenCalledTimes(2);
	});

	it("looks again after a create that finished, rather than making a second", async () => {
		await findOrCreateFolder("Item", "Moves", "p");
		await findOrCreateFolder("Item", "Moves", "p");
		expect(Folder.create).toHaveBeenCalledTimes(1);
	});
});

describe("createOnce", () => {
	it("lets go of its key once the create settles, failed or not", async () => {
		const fail = createOnce("k", async () => { throw new Error("no"); });
		await expect(fail).rejects.toThrow("no");
		expect(await createOnce("k", async () => 2)).toBe(2);
	});
});
