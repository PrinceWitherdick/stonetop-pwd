import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readOnboardingResume,
	writeOnboardingResume,
	clearOnboardingResume,
	resumeHasUnsavedWork,
	exitedSheetShown,
	markExitedSheetShown,
} from "../../../module/actors/character/onboarding-resume.js";

// The client-local creation snapshot. Keyed by world, user and character, so two people sharing
// one browser can't resume each other's answers; older snapshots (world + character only) are
// picked up once from their old key.

function memoryStorage() {
	const store = new Map();
	return {
		store,
		getItem: k => (store.has(k) ? store.get(k) : null),
		setItem: (k, v) => { store.set(k, String(v)); },
		removeItem: k => { store.delete(k); },
	};
}

const actor = { id: "a1" };
let saved;
beforeEach(() => {
	saved = { game: global.game, localStorage: global.localStorage };
	global.localStorage = memoryStorage();
	global.game = { ...global.game, world: { id: "w" }, user: { id: "u1" } };
});
afterEach(() => {
	global.game = saved.game;
	global.localStorage = saved.localStorage;
});

describe("the snapshot key", () => {
	it("belongs to one user", () => {
		writeOnboardingResume(actor, { playbookUuid: "x", selections: { a: 1 } });
		expect(readOnboardingResume(actor)?.selections).toEqual({ a: 1 });

		game.user = { id: "u2" };
		expect(readOnboardingResume(actor), "another user on the same browser").toBeNull();
	});

	it("reads a snapshot from before the user joined the key, once, and moves it", () => {
		localStorage.setItem("stonetop-pwd.onboarding.w.a1", JSON.stringify({ playbookUuid: "x", selections: { old: true } }));

		expect(readOnboardingResume(actor)?.selections).toEqual({ old: true });
		expect(localStorage.getItem("stonetop-pwd.onboarding.w.a1"), "the old key is dropped").toBeNull();
		expect(localStorage.getItem("stonetop-pwd.onboarding.w.u1.a1")).not.toBeNull();
	});

	it("clears both the new and the old key", () => {
		localStorage.setItem("stonetop-pwd.onboarding.w.a1", "{}");
		writeOnboardingResume(actor, { playbookUuid: "x", selections: {} });
		clearOnboardingResume(actor);
		expect(localStorage.store.size).toBe(0);
	});
});

describe("unsaved work", () => {
	it("counts a snapshot nobody has saved", () => {
		writeOnboardingResume(actor, { playbookUuid: "x", selections: { a: 1 } });
		expect(resumeHasUnsavedWork(readOnboardingResume(actor))).toBe(true);
	});

	it("does not count one the walkthrough's Save just wrote, while its answers stay the same", () => {
		writeOnboardingResume(actor, { playbookUuid: "x", selections: { a: 1 } }, { committed: true });
		expect(resumeHasUnsavedWork(readOnboardingResume(actor))).toBe(false);

		// Turning a page writes the same answers again: still nothing new.
		writeOnboardingResume(actor, { playbookUuid: "x", stepType: "moves", selections: { a: 1 } });
		expect(resumeHasUnsavedWork(readOnboardingResume(actor))).toBe(false);
	});

	it("counts answers changed after that Save", () => {
		writeOnboardingResume(actor, { playbookUuid: "x", selections: { a: 1 } }, { committed: true });
		writeOnboardingResume(actor, { playbookUuid: "x", selections: { a: 2 } });
		expect(resumeHasUnsavedWork(readOnboardingResume(actor))).toBe(true);
	});

	it("counts a snapshot from before the mark existed", () => {
		expect(resumeHasUnsavedWork({ playbookUuid: "x", selections: {} })).toBe(true);
		expect(resumeHasUnsavedWork(null)).toBe(false);
	});
});

describe("the sheet shown after backing out", () => {
	it("is remembered per character until creation is cleared", () => {
		expect(exitedSheetShown(actor)).toBe(false);
		markExitedSheetShown(actor);
		expect(exitedSheetShown(actor)).toBe(true);
		clearOnboardingResume(actor);
		expect(exitedSheetShown(actor)).toBe(false);
	});
});
