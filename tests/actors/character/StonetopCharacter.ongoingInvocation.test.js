import { describe, expect, it } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

// The one slot that says which Invocation a Lightbearer is holding open. The rules it has to
// keep are in ongoing-invocation.js; what is asserted here is the STORAGE — the flag scope, the
// no-op contract, and the one rule the model owns outright: the light going out takes the
// Invocation with it, wherever the light was put out from.
//
// FakeActorBuilder aliases both flag scopes ("stonetop-pwd" and the legacy "stonetop") to ONE
// object, so reading a flag back can never prove which scope it was written under. The scope is
// therefore asserted through the spy's literal arguments.
function makeChar({ ongoing = "", lit = false } = {}) {
	const builder = new FakeActorBuilder();
	if (lit) builder.withFlag("holyLight", true);
	if (ongoing) builder.withFlag("ongoingInvocation", ongoing);
	const actor = builder.build();
	return { char: new TestCharacterBuilder(actor).build(), actor };
}

describe("StonetopCharacter ongoing Invocation", () => {
	it("is nothing until one is invoked", () => {
		expect(makeChar().char.ongoingInvocation).toBe("");
	});

	it("reads the running Invocation back off the flag", () => {
		expect(makeChar({ ongoing: "warmth-of-the-sun" }).char.ongoingInvocation).toBe("warmth-of-the-sun");
	});

	it("stores it under the system's own flag scope", async () => {
		const { char, actor } = makeChar();
		await expect(char.setOngoingInvocation("warmth-of-the-sun")).resolves.toBe(true);
		expect(actor.setFlag).toHaveBeenCalledWith("stonetop-pwd", "ongoingInvocation", "warmth-of-the-sun");
		expect(char.ongoingInvocation).toBe("warmth-of-the-sun");
	});

	// UNSET, not `setFlag(..., "")`: an Invocation that has ended should leave no trace on the
	// actor, the same way a snuffed light doesn't.
	it("ends it by dropping the flag", async () => {
		const { char, actor } = makeChar({ ongoing: "warmth-of-the-sun" });
		await expect(char.setOngoingInvocation("")).resolves.toBe(true);
		expect(actor.unsetFlag).toHaveBeenCalledWith("stonetop-pwd", "ongoingInvocation");
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(char.ongoingInvocation).toBe("");
	});

	// Renewing the Invocation already running is the common case at the table — a Lightbearer
	// re-invokes to keep it up — and writing anyway would broadcast a document update to every
	// connected client for no change at all.
	it("writes nothing when the Invocation asked for is already the one running", async () => {
		const { char, actor } = makeChar({ ongoing: "warmth-of-the-sun" });
		await expect(char.setOngoingInvocation("warmth-of-the-sun")).resolves.toBe(false);
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(actor.unsetFlag).not.toHaveBeenCalled();
	});

	it("writes nothing when nothing was running and nothing was asked for", async () => {
		const { char, actor } = makeChar();
		await expect(char.setOngoingInvocation("")).resolves.toBe(false);
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(actor.unsetFlag).not.toHaveBeenCalled();
	});

	// "It will end immediately if your holy light is extinguished." Enforced by the model rather
	// than by the button that snuffs the flame, so no other way of putting a light out can leave
	// a Lightbearer concentrating on an Invocation that has no light to run on.
	it("drops the Invocation when the light is snuffed", async () => {
		const { char, actor } = makeChar({ ongoing: "warmth-of-the-sun", lit: true });
		await expect(char.setHolyLight(false)).resolves.toBe(true);
		expect(char.ongoingInvocation).toBe("");
		expect(char.holyLight).toBe(false);
		expect(actor.unsetFlag).toHaveBeenCalledWith("stonetop-pwd", "ongoingInvocation");
	});

	// Reported as a change even though the light itself didn't move, so the sheet repaints: a
	// stranded Invocation on a sheet with no light is exactly the state this feature exists to
	// stop, and it must not survive a click that was meant to clear it.
	it("clears a stranded Invocation even when the light was already out", async () => {
		const { char } = makeChar({ ongoing: "warmth-of-the-sun" });
		await expect(char.setHolyLight(false)).resolves.toBe(true);
		expect(char.ongoingInvocation).toBe("");
	});

	it("leaves the Invocation alone when a light is lit", async () => {
		const { char } = makeChar({ ongoing: "warmth-of-the-sun" });
		await expect(char.setHolyLight(true)).resolves.toBe(true);
		expect(char.ongoingInvocation).toBe("warmth-of-the-sun");
	});
});
