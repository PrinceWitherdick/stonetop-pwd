import { describe, it, expect, vi } from "vitest";
import { confirmOutcome, askWithButtons } from "../../module/utils/ask-with-buttons.js";
import { fakeForm, stubAsk, stubConfirm } from "../fakes/confirm.js";

// The house rule for a window that confirms a write: the buttons NAME the outcome ("Remove the
// move" / "Keep it"), never Yes/No, affirmative first. Core's Dialog.confirm hard-wires Yes/No, so
// every confirm goes through this helper instead.

describe("confirmOutcome", () => {
	it("puts the named answers on the buttons, the affirmative first", async () => {
		const asked = stubConfirm(true);
		await confirmOutcome({ title: "Remove move", content: "<p>x</p>", yes: { label: "Remove the move" }, no: { label: "Keep it" } });
		const config = asked.mock.calls[0][0];
		expect(config.buttons.map(b => b.label)).toEqual(["Remove the move", "Keep it"]);
		expect(config.window.title).toBe("Remove move");
		expect(config.classes).toEqual(expect.arrayContaining(["stonetop", "stonetop-ask"]));
	});

	it("lands Enter on the safe answer unless told otherwise", async () => {
		const asked = stubConfirm(true);
		await confirmOutcome({ title: "t", content: "", yes: { label: "Go" }, no: { label: "Stay" } });
		expect(asked.mock.calls[0][0].buttons.find(b => b.default).action).toBe("no");
		await confirmOutcome({ title: "t", content: "", yes: { label: "Go" }, no: { label: "Stay" }, defaultYes: true });
		expect(asked.mock.calls[1][0].buttons.find(b => b.default).action).toBe("yes");
	});

	it("answers true, false, or null for a closed window", async () => {
		const ask = () => confirmOutcome({ title: "t", content: "", yes: { label: "Go" }, no: { label: "Stay" } });
		stubConfirm(true);  expect(await ask()).toBe(true);
		stubConfirm(false); expect(await ask()).toBe(false);
		stubConfirm(null);  expect(await ask()).toBeNull();
	});

	it("puts a button's own class on the answer it belongs to, and on no other", async () => {
		const asked = stubConfirm(false);
		await confirmOutcome({ title: "t", content: "", yes: { label: "Drop it", className: "stonetop-dialog-btn--danger" }, no: { label: "Keep it" } });
		const [yes, no] = asked.mock.calls[0][0].buttons;
		expect(yes.class).toBe("stonetop-dialog-btn--danger");
		expect(no).not.toHaveProperty("class");
	});

	it("keeps a caller's own window class", async () => {
		const asked = stubConfirm(false);
		await askWithButtons({ title: "t", content: "", classes: ["stonetop-camp-ask"], buttons: [{ key: "a", label: "A", value: 1 }] });
		expect(asked.mock.calls[0][0].classes).toEqual(expect.arrayContaining(["stonetop-camp-ask", "stonetop-ask"]));
	});
});

// A tick box or a text field in the window: the pressed button reads it, while the form exists.
describe("an answer read off the window's form", () => {
	const buttons = [
		{ key: "go", label: "Go", value: form => ({ also: !!form?.elements.namedItem("also")?.checked }) },
		{ key: "stay", label: "Stay", value: null },
	];

	it("hands the pressed button the form, and answers with what it read", async () => {
		stubAsk("go", fakeForm({ also: { checked: true } }));
		expect(await askWithButtons({ title: "t", content: "", buttons })).toEqual({ also: true });
		stubAsk("go", fakeForm({ also: { checked: false } }));
		expect(await askWithButtons({ title: "t", content: "", buttons })).toEqual({ also: false });
	});

	it("answers a plain button's value, and null for a closed window", async () => {
		stubAsk("stay");
		expect(await askWithButtons({ title: "t", content: "", buttons })).toBeNull();
		stubAsk(null);
		expect(await askWithButtons({ title: "t", content: "", buttons })).toBeNull();
	});

	// A function-valued button is only ever answered through its callback: its key alone is not an answer.
	it("never mistakes the reading button's bare key for its answer", async () => {
		const wait = vi.fn(async () => "go");
		globalThis.foundry.applications.api.DialogV2 = { wait };
		expect(await askWithButtons({ title: "t", content: "", buttons })).toBeNull();
	});

	it("passes a button's own class and the window's position through", async () => {
		const asked = stubAsk(null);
		await askWithButtons({
			title: "t", content: "", position: { width: 460 },
			buttons: [{ key: "drop", label: "Drop it", value: true, className: "stonetop-dialog-btn--danger" }],
		});
		const config = asked.mock.calls[0][0];
		expect(config.position).toEqual({ width: 460 });
		expect(config.buttons[0].class).toBe("stonetop-dialog-btn--danger");
	});
});
