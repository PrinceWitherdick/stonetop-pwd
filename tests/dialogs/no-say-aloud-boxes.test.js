import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A window only asks the table to TYPE something that is kept and shown again (a sheet, the Chronicle, a
// journal page, a name). An answer that would only ever appear on one chat card is said aloud instead, so
// these four boxes were taken out and must not come back.
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("say-it-aloud answers have no text box", () => {
	it.each([
		["the GM's balk window: the order", "module/gm-toolkit/follower-balk.js", 'name="order"'],
		["Use Up Resources: how it shows", "module/actors/character/StonetopCharacterSheet.js", "stonetop-use-up-how"],
		["Order Followers, Custom: what they're doing", "templates/dialogs/order-followers.hbs", "stonetop-of-custom"],
		["the steading's Requisition: a typed asset", "module/actors/steading/StonetopSteadingSheet.js", "stonetop-requisition-custom-input"],
	])("%s", (_what, path, marker) => {
		expect(read(path)).not.toContain(marker);
	});
});
