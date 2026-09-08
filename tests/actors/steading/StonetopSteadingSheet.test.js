import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStonetopSteadingSheetClass } from "../../../module/actors/steading/StonetopSteadingSheet.js";
import { ImprovementBuilderDialog } from "../../../module/dialogs/ImprovementBuilderDialog.js";

class FakeClassList {
	constructor() { this.set = new Set(); }
	add(...classes) { classes.forEach(c => c && this.set.add(c)); }
	contains(c) { return this.set.has(c); }
}

class FakeEl {
	constructor(tag) {
		this.tagName = (tag || "div").toUpperCase();
		this.children = [];
		this.listeners = [];
		this.attrs = {};
		this.classList = new FakeClassList();
	}
	set className(value) { this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean)); }
	get className() { return [...this.classList.set].join(" "); }
	// `src` is a reflected attribute on a real element: assigning the property updates the
	// attribute and vice versa. Reflect it here too, so production code doesn't need to
	// write both to keep this fake happy.
	set src(value) { this.attrs.src = String(value); }
	get src() { return this.attrs.src ?? null; }
	set innerHTML(value) { this._innerHTML = value; }
	setAttribute(key, value) { this.attrs[key] = String(value); }
	getAttribute(key) { return this.attrs[key] ?? null; }
	addEventListener(type, fn) { this.listeners.push({ type, fn }); }
	click() {
		this.listeners.filter(l => l.type === "click")
			.forEach(l => l.fn({ preventDefault() {}, stopPropagation() {} }));
	}
	appendChild(node) { node.parent = this; this.children.push(node); return node; }
	insertBefore(node, ref) {
		node.parent = this;
		const index = this.children.indexOf(ref);
		if (index < 0) this.children.push(node);
		else this.children.splice(index, 0, node);
		return node;
	}
	_matches(selector) {
		const match = selector.match(/^([a-zA-Z]+)?(?:\.(.+))?$/);
		const tag = match?.[1] ? match[1].toUpperCase() : null;
		const cls = match?.[2] || null;
		if (tag && this.tagName !== tag) return false;
		if (cls && !this.classList.contains(cls)) return false;
		return true;
	}
	querySelector(selector) {
		const selectors = String(selector).split(",").map(s => s.trim()).filter(Boolean);
		if (selectors.length > 1) {
			for (const sel of selectors) {
				const match = this.querySelector(sel);
				if (match) return match;
			}
			return null;
		}
		for (const child of this.children) {
			if (child._matches?.(selector)) return child;
			const descendant = child.querySelector?.(selector);
			if (descendant) return descendant;
		}
		return null;
	}
	// Depth-first, document order — which is what addPopoutHeaderControl relies on to insert a
	// new control ahead of core's own rather than after them.
	querySelectorAll(selector) {
		const out = [];
		for (const child of this.children) {
			if (child._matches?.(selector)) out.push(child);
			out.push(...(child.querySelectorAll?.(selector) ?? []));
		}
		return out;
	}
}

function makeSheet({ players = [], residents = [], neighbors = [], improvements = {}, improvementDef, addResult, removeResult, addPlayerResult = true } = {}) {
	const typedActor = {
		_flags: { players, residents, neighbors, improvements },
		setFlags: vi.fn(async updates => {
			typedActor._flags = { ...typedActor._flags, ...updates };
		}),
		// The row shape and the duplicate check live on the model and are covered there
		// (StonetopSteading.test.js); the sheet's job is to delegate and report.
		addPlayerRow: vi.fn(async () => addPlayerResult),
		improvementDef: vi.fn(() => improvementDef ?? null),
		setImprovementCompleted: vi.fn(async () => ({ label: improvementDef?.label ?? "X", summary: [], reverted: false })),
		addCustomImprovement: vi.fn(async () => addResult ?? { ok: true, slug: "custom-x", label: "X" }),
		removeCustomImprovement: vi.fn(async () => removeResult ?? { label: "ROADBUILDING", reverted: [] }),
		improvementCompleted: vi.fn(() => !!improvements?.completed),
		improvementRequirements: vi.fn(() => improvements?.r ?? []),
		improvementNameTaken: vi.fn(() => false),
		updateCustomImprovement: vi.fn(async () => ({ ok: true, slug: "custom-x", label: "X" })),
	};
	const actor = {
		name: "Stonetop",
		type: "stonetop",
		typedActor,
		getFlag: vi.fn(),
	};
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		render() {}
	};
	const Sheet = createStonetopSteadingSheetClass(Base);
	return { sheet: new Sheet(), typedActor };
}

describe("StonetopSteadingSheet", () => {
	beforeEach(() => {
		globalThis.ui = {
			notifications: {
				info: vi.fn(),
				warn: vi.fn(),
			},
		};
	});

	it("files a dropped character through the model's shared roster write", async () => {
		const { sheet, typedActor } = makeSheet();
		const hero = { id: "hero-id", uuid: "Actor.hero", name: "Wren", img: "wren.webp", type: "character" };

		await sheet._onDropPlayerCharacter(hero);

		// Through addPlayerRow, not a hand-built row: a drag and a finished character
		// creation must land the same shape on the roster.
		expect(typedActor.addPlayerRow).toHaveBeenCalledWith(hero);
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith("Added Wren to players.");
	});

	it("says so rather than duplicating when the dropped character is already listed", async () => {
		const { sheet } = makeSheet({
			players: [{ id: "hero-id", uuid: "Actor.hero", name: "Wren", img: "wren.webp", checked: true }],
			addPlayerResult: false,
		});

		await sheet._onDropPlayerCharacter({
			id: "hero-id",
			uuid: "Actor.hero",
			name: "Wren",
			img: "wren.webp",
			type: "character",
		});

		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith("Wren is already in the players list.");
	});

	it("stores a resident portrait override from the image popout picker", async () => {
		const { sheet, typedActor } = makeSheet({
			residents: [{ name: "Wren", img: "" }],
		});

		await sheet._onMemberAvatarImageChange("residents", 0, "worlds/stonetop/wren.webp");

		expect(typedActor.setFlags).toHaveBeenCalledWith({
			residents: [{ name: "Wren", img: "worlds/stonetop/wren.webp" }],
		});
	});

	it("stores a neighbor portrait override from the image popout picker", async () => {
		const { sheet, typedActor } = makeSheet({
			neighbors: [{ name: "Tor", img: "" }],
		});

		await sheet._onMemberAvatarImageChange("neighbors", 0, "worlds/stonetop/tor.webp");

		expect(typedActor.setFlags).toHaveBeenCalledWith({
			neighbors: [{ name: "Tor", img: "worlds/stonetop/tor.webp" }],
		});
	});

	// The injection now lives in the shared addPopoutHeaderControl helper, which schedules itself
	// on a rAF plus two timeouts (core builds the header after render and can rebuild it), so the
	// assertions wait a macrotask. Calling it twice is the point: the guard is per KEY, because a
	// per-window guard silently caps a header at one control and this popout now carries two.
	it("injects a visible edit-photo header control into editable resident image popouts", async () => {
		const { sheet } = makeSheet();
		globalThis.document = { createElement: tag => new FakeEl(tag) };
		// v13's constructor signature: everything arrives in one options object, with the path at
		// `src` and the window title under `window` (see utils/foundry-compat.js#imagePopout).
		class MockImagePopout {
			constructor(options) {
				this.src = options?.src;
				this.options = options;
				const header = new FakeEl("header");
				header.className = "window-header";
				const close = new FakeEl("button");
				close.className = "header-control";
				header.appendChild(close);
				this.element = new FakeEl("div");
				this.element.appendChild(header);
			}
		}
		globalThis.ImagePopout = MockImagePopout;
		const anchor = {
			src: "systems/stonetop-pwd/assets/icons/people/default_profile.svg",
			dataset: { name: "Wren", list: "residents", index: "0" },
		};
		sheet._onMemberAvatarPickImage = vi.fn();

		const popout = sheet._createEditableMemberImagePopout(anchor);
		sheet._scheduleMemberImageHeaderControl(popout);
		sheet._scheduleMemberImageHeaderControl(popout);
		await new Promise(resolve => setTimeout(resolve, 150));
		const header = popout.element.querySelector(".window-header");
		const button = header.querySelector(".stonetop-edit-member-photo");

		expect(button).not.toBeNull();
		expect(button.classList.contains("header-control")).toBe(true);
		expect(button.classList.contains("fa-camera")).toBe(true);
		expect(button.getAttribute("aria-label")).toBe("Edit Photo");
		expect(header.children.filter(c => c.classList.contains("stonetop-edit-member-photo"))).toHaveLength(1);
		expect(header.children[0]).toBe(button);

		button.click();
		expect(sheet._onMemberAvatarPickImage).toHaveBeenCalledWith({
			list: "residents",
			index: 0,
			current: anchor.src,
			popout,
		});

		delete globalThis.ImagePopout;
	});

	// An open photo window showing `src`, as either shape of Application: v13's ImagePopout is
	// ApplicationV2 and freezes its options object, older windows keep a mutable one.
	function makeImagePopout(src, { frozen = false } = {}) {
		const root = new FakeEl("div");
		const img = new FakeEl("img");
		img.src = src;
		root.appendChild(img);
		const options = { src, window: { title: "Wren" } };
		return {
			img,
			popout: {
				options: frozen ? Object.freeze(options) : options,
				element: root,
				render: vi.fn(),
				_stonetopMemberImageEdit: { current: src },
			},
		};
	}

	it("refreshes the already-open member image popout after choosing a new photo", () => {
		const { sheet } = makeSheet();
		const { popout, img } = makeImagePopout("old.webp");

		sheet._refreshMemberImagePopout(popout, "new.webp");

		expect(popout.options.src).toBe("new.webp");
		expect(popout._stonetopMemberImageEdit.current).toBe("new.webp");
		expect(img.src).toBe("new.webp");
		expect(img.getAttribute("src")).toBe("new.webp");
		expect(popout.render).not.toHaveBeenCalled();
	});

	// ApplicationV2 hands out a frozen options object, so writing `options.src` through it
	// throws under strict mode. That used to happen before the <img> was patched, which left
	// the open photo window showing the default portrait while the sheet row updated.
	it("refreshes a member image popout whose options are frozen (ApplicationV2)", () => {
		const { sheet } = makeSheet();
		const { popout, img } = makeImagePopout("systems/stonetop-pwd/assets/icons/people/default_profile.svg", { frozen: true });

		sheet._refreshMemberImagePopout(popout, "new.webp");

		expect(img.src).toBe("new.webp");
		expect(img.getAttribute("src")).toBe("new.webp");
		expect(popout.options.src).toBe("new.webp");
		// The swapped-in copy keeps the rest of the window's configuration.
		expect(popout.options.window.title).toBe("Wren");
		expect(popout._stonetopMemberImageEdit.current).toBe("new.webp");
		expect(popout.render).not.toHaveBeenCalled();
	});

	// An animated portrait needs core's <video>, so the <img> is left alone and the window
	// re-renders off the src stored on the way past.
	it("re-renders rather than patching when the portrait changes kind", () => {
		const { sheet } = makeSheet();
		const { popout, img } = makeImagePopout("wren.webp", { frozen: true });

		sheet._refreshMemberImagePopout(popout, "wren.webm");

		expect(img.src).toBe("wren.webp");
		expect(popout.options.src).toBe("wren.webm");
		expect(popout.render).toHaveBeenCalledWith(false);
	});

	it("adds a dropped steading-improvement card as a tracked improvement", async () => {
		const { sheet, typedActor } = makeSheet({ addResult: { ok: true, slug: "custom-roadbuilding", label: "ROADBUILDING" } });
		const improvement = { name: "ROADBUILDING", sections: [], effect: "..." };

		await sheet._onDropSteadingImprovement(improvement);

		expect(typedActor.addCustomImprovement).toHaveBeenCalledWith(improvement);
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith("Added steading improvement: ROADBUILDING.");
	});

	it("warns instead of adding when the improvement is already present", async () => {
		const { sheet, typedActor } = makeSheet({ addResult: { ok: false, reason: "duplicate", label: "ROADBUILDING" } });

		await sheet._onDropSteadingImprovement({ name: "ROADBUILDING" });

		expect(typedActor.addCustomImprovement).toHaveBeenCalled();
		expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith("ROADBUILDING is already a steading improvement.");
	});

	it("ignores a malformed drop payload", async () => {
		const { sheet, typedActor } = makeSheet();
		await sheet._onDropSteadingImprovement(undefined);
		await sheet._onDropSteadingImprovement({ flavor: "no name" });
		expect(typedActor.addCustomImprovement).not.toHaveBeenCalled();
	});

	// Editing in place, rather than the copy-fix-remove dance that lost every ticked step.
	describe("editing an added improvement", () => {
		const roadbuilding = { slug: "custom-roadbuilding", label: "ROADBUILDING", sections: [], effect: "" };

		let render;
		beforeEach(() => {
			render = vi.spyOn(ImprovementBuilderDialog.prototype, "render").mockImplementation(function () { return this; });
		});
		afterEach(() => render.mockRestore());

		it("opens the builder on that improvement", () => {
			const { sheet, typedActor } = makeSheet({ improvementDef: roadbuilding });
			sheet._onEditCustomImprovement("custom-roadbuilding");

			expect(typedActor.improvementDef).toHaveBeenCalledWith("custom-roadbuilding");
			expect(render).toHaveBeenCalledWith(true);
			// Filled in and titled for the improvement, rather than a blank "create" window.
			const dialog = render.mock.instances[0];
			expect(dialog.title).toBe("Edit ROADBUILDING");
			expect(dialog._saver.editing).toMatchObject({ name: "ROADBUILDING", slug: "custom-roadbuilding" });
		});

		it("does nothing for an unknown slug, since there is nothing to open on", () => {
			const { sheet } = makeSheet();
			sheet._onEditCustomImprovement("custom-nope");
			sheet._onEditCustomImprovement("");
			expect(render).not.toHaveBeenCalled();
		});
	});

	// Removing an added improvement takes the authored definition and its ticked steps with
	// it, and when it was completed the write MOVES STATS (removing it gives back what
	// completing it applied). Confirmed for the same reasons standing down the muster is.
	describe("removing an added improvement", () => {
		const roadbuilding = {
			slug: "custom-roadbuilding",
			label: "ROADBUILDING",
			sections: [{ heading: "Requires:", items: ["A", "B"] }],
			effect: "...",
			grants: { stats: { prosperity: 1 } },
		};

		/** Capture the confirm the sheet raises, so a test can press either button. */
		function captureDialog() {
			let opened = null;
			globalThis.Dialog = class {
				constructor(data, options) { opened = { data, options }; }
				render() {}
			};
			return () => opened;
		}

		it("asks before removing, and names the outcome on both buttons", async () => {
			const dialog = captureDialog();
			const { sheet, typedActor } = makeSheet({ improvementDef: roadbuilding });
			await sheet._onRemoveCustomImprovement("custom-roadbuilding");

			expect(typedActor.removeCustomImprovement).not.toHaveBeenCalled();
			const { data } = dialog();
			expect(data.buttons.yes.label).toBe("Remove ROADBUILDING");
			expect(data.buttons.no.label).toBe("Keep it on the steading");
			// Affirmative is not the default on a destructive, un-undoable write.
			expect(data.default).toBe("no");
		});

		it("says what completing it applied, since removing it gives that back", async () => {
			const dialog = captureDialog();
			const { sheet } = makeSheet({ improvementDef: roadbuilding, improvements: { completed: true, r: [true, true] } });
			await sheet._onRemoveCustomImprovement("custom-roadbuilding");

			expect(dialog().data.content).toContain("Prosperity +1");
			expect(dialog().data.content).toContain("2 ticked requirements will be forgotten");
		});

		it("says nothing is given back when it was never completed", async () => {
			const dialog = captureDialog();
			const { sheet } = makeSheet({ improvementDef: roadbuilding, improvements: { completed: false, r: [] } });
			await sheet._onRemoveCustomImprovement("custom-roadbuilding");

			expect(dialog().data.content).toContain("never completed");
			expect(dialog().data.content).not.toContain("Prosperity +1");
		});

		it("removes it, and reports what was reverted, once the button is pressed", async () => {
			const dialog = captureDialog();
			const { sheet, typedActor } = makeSheet({
				improvementDef: roadbuilding,
				removeResult: { label: "ROADBUILDING", reverted: ["Prosperity +1"] },
			});
			await sheet._onRemoveCustomImprovement("custom-roadbuilding");
			await dialog().data.buttons.yes.callback();

			expect(typedActor.removeCustomImprovement).toHaveBeenCalledWith("custom-roadbuilding");
			// "Reverted", matching what un-completing says: the summary lists what was APPLIED.
			expect(globalThis.ui.notifications.info)
				.toHaveBeenCalledWith("Removed ROADBUILDING. Reverted: Prosperity +1.");
		});

		it("does nothing for an unknown slug", async () => {
			captureDialog();
			const { sheet, typedActor } = makeSheet();
			await sheet._onRemoveCustomImprovement("custom-nope");
			await sheet._onRemoveCustomImprovement("");
			expect(typedActor.removeCustomImprovement).not.toHaveBeenCalled();
		});
	});

	describe("completing an improvement whose requirements aren't all met", () => {
		const lockedDef = {
			slug: "palisade",
			label: "PALISADE",
			sections: [{ heading: "Requires:", items: ["A", "B", "C"] }],
			effect: "...",
		};

		it("offers to mark every requirement complete, then earns it when accepted", async () => {
			const { sheet, typedActor } = makeSheet({ improvementDef: lockedDef });
			globalThis.Dialog = { confirm: vi.fn(async () => true) };
			sheet.render = vi.fn();

			await sheet._onImprovementComplete("palisade", true);

			expect(globalThis.Dialog.confirm).toHaveBeenCalledTimes(1);
			// Force-completing passes the filled requirement array through to the model,
			// which persists completion and auto-applies the improvement's grants.
			expect(typedActor.setImprovementCompleted).toHaveBeenCalledWith("palisade", true, { forceR: [true, true, true] });
		});

		it("does nothing but revert the checkbox when declined", async () => {
			const { sheet, typedActor } = makeSheet({ improvementDef: lockedDef });
			globalThis.Dialog = { confirm: vi.fn(async () => false) };
			sheet.render = vi.fn();

			await sheet._onImprovementComplete("palisade", true);

			expect(typedActor.setImprovementCompleted).not.toHaveBeenCalled();
			expect(sheet.render).toHaveBeenCalledWith(false); // re-render resets the tapped checkbox
		});

		it("marks complete without prompting once the requirements are already met", async () => {
			const { sheet, typedActor } = makeSheet({
				improvementDef: lockedDef,
				improvements: { palisade: { completed: false, r: [true, true, true] } },
			});
			globalThis.Dialog = { confirm: vi.fn(async () => true) };
			sheet.render = vi.fn();

			await sheet._onImprovementComplete("palisade", true);

			expect(globalThis.Dialog.confirm).not.toHaveBeenCalled();
			expect(typedActor.setImprovementCompleted).toHaveBeenCalledWith("palisade", true, { forceR: undefined });
		});

		it("always allows un-completing a finished improvement without prompting", async () => {
			const { sheet, typedActor } = makeSheet({
				improvementDef: lockedDef,
				improvements: { palisade: { completed: true, r: [true, true, true] } },
			});
			globalThis.Dialog = { confirm: vi.fn(async () => true) };
			sheet.render = vi.fn();

			await sheet._onImprovementComplete("palisade", false);

			expect(globalThis.Dialog.confirm).not.toHaveBeenCalled();
			expect(typedActor.setImprovementCompleted).toHaveBeenCalledWith("palisade", false, { forceR: undefined });
		});

		it("surfaces a notification summarizing the auto-applied grants", async () => {
			const { sheet, typedActor } = makeSheet({
				improvementDef: lockedDef,
				improvements: { palisade: { completed: false, r: [true, true, true] } },
			});
			typedActor.setImprovementCompleted.mockResolvedValueOnce({
				label: "Palisade", summary: ["Fortunes +1", "Fortifications +Palisade"], reverted: false,
			});
			sheet.render = vi.fn();

			await sheet._onImprovementComplete("palisade", true);

			expect(globalThis.ui.notifications.info)
				.toHaveBeenCalledWith("Applied Palisade: Fortunes +1; Fortifications +Palisade.");
		});
	});

	describe("improvement category chips", () => {
		it("lights one category at a time, so a second pick drops the first", () => {
			const { sheet } = makeSheet();
			expect(sheet._improvementCategory).toBe("");

			expect(sheet._toggleImprovementCategory("hearth")).toBe("hearth");
			expect(sheet._toggleImprovementCategory("wall")).toBe("wall");
			expect(sheet._improvementCategory).toBe("wall");
		});

		it("clears back to unfiltered when the lit chip is picked again", () => {
			const { sheet } = makeSheet();
			sheet._toggleImprovementCategory("renown");

			expect(sheet._toggleImprovementCategory("renown")).toBe("");
			expect(sheet._improvementCategory).toBe("");
		});

		it("hides only the other categories, and never an uncategorised improvement", () => {
			const { sheet } = makeSheet();
			// Nothing lit: everything shows.
			expect(sheet._isImprovementFiltered("hearth")).toBe(false);
			expect(sheet._isImprovementFiltered("")).toBe(false);

			sheet._toggleImprovementCategory("wall");
			expect(sheet._isImprovementFiltered("wall")).toBe(false);
			expect(sheet._isImprovementFiltered("hearth")).toBe(true);
			expect(sheet._isImprovementFiltered("renown")).toBe(true);
			// A dropped journal card carries no category and stays put under any chip.
			expect(sheet._isImprovementFiltered("")).toBe(false);
		});
	});
});
