import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../module/struggle/struggle-store.js", async (importOriginal) => ({
	...(await importOriginal()), liveStruggle: vi.fn(() => null), askOf: vi.fn(() => null),
}));
vi.mock("../../module/struggle/struggle-flow.js", () => ({ answerNextAsk: vi.fn() }));
vi.mock("../../module/utils/open-or-focus.js", () => ({ openOrFocus: (_id, open) => open() }));

const store = await import("../../module/struggle/struggle-store.js");
const { answerNextAsk } = await import("../../module/struggle/struggle-flow.js");
const { StruggleSetupDialog } = await import("../../module/struggle/StruggleSetupDialog.js");
const { newSetupDraft } = await import("../../module/struggle/struggle-setup.js");
const { STRUGGLE_SETUP_WINDOW_CLASS, reopenStruggleSetup } = await import("../../module/struggle/struggle-setup-restore.js");

// A reload brings the GM's Struggle as One setup back (struggle-setup-restore.js, by way of
// utils/window-restore.js) with the draft as left; calling writes the struggle itself, so nothing
// else needs rebuilding. An ask's setup comes back only while its ask is up.

const roster = [
	{ actorId: "rhianna", name: "Rhianna", img: "", owns: [], followers: [{ fkey: "rhianna:f:wren", party: false }] },
	{ actorId: "garet", name: "Garet", img: "", owns: [], followers: [] },
];
const asker = { uuid: "Actor.rhianna", id: "rhianna", name: "Rhianna" };
const ask = { id: "ask1", danger: "The mire", approach: "", userId: "u", at: 1 };

beforeEach(() => {
	vi.stubGlobal("game", { user: { isGM: true } });
	store.liveStruggle.mockReturnValue(null);
	store.askOf.mockReturnValue(null);
});
afterEach(() => vi.unstubAllGlobals());

function leftWith(opts = {}) {
	const left = new StruggleSetupDialog(opts);
	left._roster = roster;
	left._draft = newSetupDraft(roster, { danger: opts.ask?.danger ?? "" });
	return left;
}

describe("the struggle setup across a reload", () => {
	it("is restored under the class name its hooks are built from, keyed by who asked", () => {
		expect(StruggleSetupDialog.name).toBe(STRUGGLE_SETUP_WINDOW_CLASS);
		expect(new StruggleSetupDialog().restoreKey).toBe("struggleSetup:gm");
		const answering = new StruggleSetupDialog({ ask, askActor: asker });
		expect(answering.restoreKey).toBe("struggleSetup:Actor.rhianna");
		// The asker is let go of in close(), before the close hook reads the key: it must not move.
		answering._askActor = null;
		expect(answering.restoreKey).toBe("struggleSetup:Actor.rhianna");
	});

	it("comes back with the draft as typed, laid over the roster as it now stands", async () => {
		const left = leftWith();
		Object.assign(left._draft, { danger: "Night falls", approach: "Rope together", journey: true });
		Object.assign(left._draft.pcs.rhianna, { stats: ["str"], aidOther: "Lowri", aidAdv: false });
		left._draft.pcs.garet.include = false;
		left._draft.pcs.gone = { include: true };
		left._draft.followers["rhianna:f:wren"].include = true;
		const view = JSON.parse(JSON.stringify(left.restoreView));

		const back = await reopenStruggleSetup("struggleSetup:gm");
		expect(back._onClosed).toBe(answerNextAsk);
		back._takeRestoredView(view);
		back._roster = roster;
		back._draft = newSetupDraft(roster);
		back._layRestoredDraft();
		expect(back._draft).toMatchObject({ danger: "Night falls", approach: "Rope together", journey: true });
		expect(back._draft.pcs.rhianna).toMatchObject({ stats: ["str"], aidOther: "Lowri", aidAdv: false, include: true });
		expect(back._draft.pcs.garet.include).toBe(false);
		expect(back._draft.pcs.gone).toBeUndefined();
		expect(back._draft.followers["rhianna:f:wren"].include).toBe(true);
	});

	it("lands on a setup the reload already opened for the same ask, unless the GM has typed in it", async () => {
		const opened = leftWith({ ask, askActor: asker });
		opened._takeRestoredView({ askId: "ask1", draft: { danger: "The mire, at dusk" } });
		expect(opened._draft.danger).toBe("The mire, at dusk");

		const other = leftWith({ ask, askActor: asker });
		other._takeRestoredView({ askId: "another", draft: { danger: "x" } });
		expect(other._draft.danger).toBe("The mire");

		const typed = leftWith({ ask, askActor: asker });
		typed._touched = true;
		const base = Object.getPrototypeOf(StruggleSetupDialog.prototype);
		const render = vi.spyOn(base, "_render").mockResolvedValue();
		await typed._render(true, { view: { askId: "ask1", draft: { danger: "x" } } });
		expect(typed._draft.danger).toBe("The mire");
		render.mockRestore();
	});

	it("ignores a draft that isn't one", () => {
		const back = leftWith();
		back._takeRestoredView({ draft: "nonsense" });
		back._takeRestoredView({ draft: { danger: 4, journey: "yes", pcs: { rhianna: { stats: "str", mode: 3 } } } });
		expect(back._draft.danger).toBe("");
		expect(back._draft.journey).toBe(false);
		expect(back._draft.pcs.rhianna).toMatchObject({ stats: [], mode: "normal" });
	});

	it("brings an ask's setup back only while the ask is up", async () => {
		vi.stubGlobal("fromUuid", async () => asker);
		expect(await reopenStruggleSetup("struggleSetup:Actor.rhianna")).toBeNull();
		store.askOf.mockReturnValue(ask);
		const back = await reopenStruggleSetup("struggleSetup:Actor.rhianna");
		expect(back._ask).toBe(ask);
		expect(back._askActor).toBe(asker);
	});

	it("stays shut once a struggle is under way, and for a player", async () => {
		store.liveStruggle.mockReturnValue({ id: "s1" });
		expect(await reopenStruggleSetup("struggleSetup:gm")).toBeNull();
		store.liveStruggle.mockReturnValue(null);
		game.user.isGM = false;
		expect(await reopenStruggleSetup("struggleSetup:gm")).toBeNull();
		expect(await reopenStruggleSetup("camp:gm")).toBeNull();
	});
});
