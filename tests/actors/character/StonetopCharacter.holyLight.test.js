import { describe, expect, it } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

// FakeActorBuilder aliases both flag scopes ("stonetop-pwd" and the legacy "stonetop") to
// ONE object, so reading a flag back can never prove which scope it was written under. The
// scope is therefore asserted through the spy's literal arguments. Its getFlag also answers
// `null`, not `undefined`, on a miss — hence the boolean coercion in the getter.
function makeChar({ lit = false, items = [] } = {}) {
	const builder = new FakeActorBuilder().withItems(items);
	if (lit) builder.withFlag("holyLight", true);
	const actor = builder.build();
	return { char: new TestCharacterBuilder(actor).build(), actor };
}

const move = name => ({ type: "move", name });

describe("StonetopCharacter holy light", () => {
	it("is out until something lights it", () => {
		expect(makeChar().char.holyLight).toBe(false);
	});

	it("reads a lit light back off the flag", () => {
		expect(makeChar({ lit: true }).char.holyLight).toBe(true);
	});

	it("lights it under the system's own flag scope", async () => {
		const { char, actor } = makeChar();
		await expect(char.setHolyLight(true)).resolves.toBe(true);
		expect(actor.setFlag).toHaveBeenCalledWith("stonetop-pwd", "holyLight", true);
	});

	// UNSET, not `setFlag(..., false)`: a snuffed light should leave no trace on the actor.
	it("snuffs it by dropping the flag", async () => {
		const { char, actor } = makeChar({ lit: true });
		await expect(char.setHolyLight(false)).resolves.toBe(true);
		expect(actor.unsetFlag).toHaveBeenCalledWith("stonetop-pwd", "holyLight");
		expect(actor.setFlag).not.toHaveBeenCalled();
	});

	// One slot: re-consecrating replaces the same light. Writing anyway would broadcast a
	// document update to every connected client for no change at all.
	it("writes nothing when the light is already in the state asked for", async () => {
		const { char: litChar, actor: litActor } = makeChar({ lit: true });
		await expect(litChar.setHolyLight(true)).resolves.toBe(false);
		expect(litActor.setFlag).not.toHaveBeenCalled();
		expect(litActor.unsetFlag).not.toHaveBeenCalled();

		const { char: outChar, actor: outActor } = makeChar();
		await expect(outChar.setHolyLight(false)).resolves.toBe(false);
		expect(outActor.setFlag).not.toHaveBeenCalled();
		expect(outActor.unsetFlag).not.toHaveBeenCalled();
	});

	// Through `headerGlyphOwnership`, which is what the sheet reads. There is no longer a
	// single-answer `canWieldHolyLight` getter beside it: nothing outside these tests called one,
	// and a second spelling kept alive by its own test is a spelling that can quietly disagree.
	it("earns the candle from any move that makes a light, and only from those", () => {
		const owns = (name) => makeChar({ items: [move(name)] }).char.headerGlyphOwnership().holyLight;
		expect(owns("Consecrated Flame")).toBe(true);
		expect(owns("Invoke the Sun God")).toBe(true);
		expect(owns("Wielder of the White Flame")).toBe(true);
		expect(owns("Guardian")).toBe(false);
	});
});
