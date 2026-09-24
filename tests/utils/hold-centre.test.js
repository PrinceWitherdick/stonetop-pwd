import { afterEach, describe, expect, it, vi } from "vitest";
import { holdCentre } from "../../module/utils/hold-centre.js";
import { LevelUpDialog } from "../../module/actors/character/dialogs/LevelUpDialog.js";
import { StonetopArcanaInspireDialog } from "../../module/item/StonetopArcanaInspireDialog.js";

/**
 * A wizard that changes size between steps stays centred over where the last step stood
 * (module/utils/hold-centre.js), rather than growing down from its top edge or being snapped to the
 * middle of the viewport. StepperDialog's use of it is pinned in tests/dialogs/stepper-render-queue.test.js.
 */

/** A window the way AppV1 keeps one: a `position`, and a setPosition that writes into it. */
function windowAt(position) {
	const app = { position: { ...position } };
	app.setPosition = vi.fn(pos => { Object.assign(app.position, pos); });
	return app;
}

afterEach(() => vi.restoreAllMocks());

describe("holdCentre", () => {
	it("puts a window that grew back over the centre it had", () => {
		const app = windowAt({ left: 400, top: 300, width: 400, height: 300 });   // centre (600, 450)
		const recentre = holdCentre(app);
		app.setPosition({ width: 600, height: 500 });
		recentre();
		expect(app.position).toEqual({ left: 300, top: 200, width: 600, height: 500 });
	});

	it("and one that shrank", () => {
		const app = windowAt({ left: 400, top: 300, width: 400, height: 300 });
		const recentre = holdCentre(app);
		app.setPosition({ width: 200, height: 100 });
		recentre();
		expect(app.position).toEqual({ left: 500, top: 400, width: 200, height: 100 });
	});

	it("moves only the corner, and leaves the size the fit chose", () => {
		const app = windowAt({ left: 400, top: 300, width: 400, height: 300 });
		const recentre = holdCentre(app);
		recentre();
		expect(app.setPosition).toHaveBeenCalledExactlyOnceWith({ left: 400, top: 300 });
	});

	// What it re-centres is the size the window has once it is called, so a caller holds before the
	// redraw and re-centres after the fit. A `position` swapped wholesale in between is read afresh.
	it("reads the new size when it re-centres, not when it holds", () => {
		const app = windowAt({ left: 400, top: 300, width: 400, height: 300 });
		const recentre = holdCentre(app);
		app.position = { left: 400, top: 300, width: 800, height: 100 };
		recentre();
		expect(app.position).toMatchObject({ left: 200, top: 400 });
	});

	// A window that has not been drawn yet has nulls where its corner will go. Foundry centres it in the
	// viewport as it opens, and a centre made up out of those nulls would drag it to the top-left.
	it("holds nothing for a window never placed, so Foundry centres it", () => {
		for (const position of [undefined, {}, { left: null, top: null, width: 520, height: null }, { left: 10, top: 10, width: 400, height: NaN }]) {
			const app = { position, setPosition: vi.fn() };
			holdCentre(app)();
			expect(app.setPosition).not.toHaveBeenCalled();
		}
	});
});

describe("the level-up wizard", () => {
	/** A dialog on `from`, having been sized for it, about to draw `to`. An auto fit lands on `fitHeight`. */
	function levelUpAt(position, { from, to, fitHeight = 700 }) {
		const dlg = new LevelUpDialog({}, { availableMoves: [], lockedMoves: [], availableInvocations: [] }, vi.fn());
		dlg._sizedStep = from;
		dlg._step = to;
		dlg.position = { ...position };
		dlg.setPosition = vi.fn(pos => {
			if (pos.height === "auto") Object.assign(dlg.position, { width: pos.width, height: fitHeight });
			else Object.assign(dlg.position, pos);
		});
		return dlg;
	}

	it("centres the resized step over where the last one stood", async () => {
		const dlg = levelUpAt({ left: 400, top: 300, width: 520, height: 300 }, { from: "overview", to: "move" });   // centre (660, 450)
		await dlg._render(false, {});
		expect(dlg.position).toEqual({ left: 230, top: 100, width: 860, height: 700 });
	});

	// A move click redraws the same step. A window the reader resized by hand stays as they left it.
	it("leaves a redraw of the same step where the reader put it", async () => {
		const dlg = levelUpAt({ left: 400, top: 300, width: 700, height: 600 }, { from: "move", to: "move" });
		await dlg._render(false, {});
		expect(dlg.setPosition).not.toHaveBeenCalled();
	});

	it("sizes its first step without moving it, where Foundry centres it", async () => {
		const dlg = levelUpAt({ left: null, top: null, width: 520, height: null }, { from: undefined, to: "overview" });
		await dlg._render(true, {});
		expect(dlg.setPosition).toHaveBeenCalledExactlyOnceWith({ width: 520, height: "auto" });
	});
});

describe("the arcana inspiration wizard", () => {
	function inspireAt(position, fitHeight = 500) {
		const dlg = new StonetopArcanaInspireDialog({ onCreate: vi.fn() });
		dlg.position = { ...position };
		dlg.setPosition = vi.fn(pos => {
			if (pos.height === "auto") dlg.position.height = fitHeight;
			else Object.assign(dlg.position, pos);
		});
		return dlg;
	}

	it("re-centres after its auto-height fit", async () => {
		const dlg = inspireAt({ left: 400, top: 300, width: 620, height: 300 });   // centre (710, 450)
		await dlg._render(false, {});
		expect(dlg.setPosition.mock.calls).toEqual([[{ height: "auto" }], [{ left: 400, top: 200 }]]);
		expect(dlg.position).toEqual({ left: 400, top: 200, width: 620, height: 500 });
	});

	it("only fits on its first render", async () => {
		const dlg = inspireAt({ left: null, top: null, width: 620, height: null });
		await dlg._render(true, {});
		expect(dlg.setPosition).toHaveBeenCalledExactlyOnceWith({ height: "auto" });
	});
});
