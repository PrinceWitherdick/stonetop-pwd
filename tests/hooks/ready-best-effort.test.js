import { describe, it, expect } from "vitest";
import { readRepo } from "../fakes/css.js";

// Foundry does not await a `ready` callback, so a bare `await` that rejects silently ends onReady
// there for whoever hit it: no game.stonetop, no macros, no Welcome guide. The steps the rest of
// the load does not depend on go through bestEffort (utils/best-effort.js). Pinned against the
// source, since onReady itself needs a whole world to run.
const READY = readRepo("module/hooks/Ready.js");
const body = READY.slice(READY.indexOf("export async function onReady() {"), READY.indexOf("async function _applyCoreSettingDefaultsForNewWorld"));

describe("onReady's step isolation", () => {
	it("catches the steps the rest of the load does not need", () => {
		for (const step of [
			`bestEffort("Setting Overview gate migration", migrateFlatSettingOverviewShown)`,
			`bestEffort("GM-prep single-journal consolidation", _migrateGmPrepPagesToSingleJournal)`,
			`bestEffort("steading singleton", ensureStonetopSingleton)`,
			`bestEffort("player actor-creation grant", _ensurePlayerActorCreationGrant)`,
			`bestEffort("GM Toolkit", _ensureGmToolkit)`,
			`bestEffort("GM Toolkit assignment", _assignGmToolkitToGm)`,
			`bestEffort("world setup", () => seeding)`,
			`bestEffort("player hotbar macro placement", ensurePlayerHotbarMacros)`,
			`bestEffort("startup greeting", _postStartupWelcomeMessageOnce)`,
			`bestEffort("book art reminder", _postBook2ArtReminderOnce)`,
			`bestEffort("Omens of Fate reminder", remindDestinedOmenRoll)`,
			`bestEffort("Setting Overview", _openSettingOverview)`,
			`bestEffort("Introductions rejoin", () => IntroductionsDialog.openForActiveSession())`,
		]) expect(body, step).toContain(step);
		for (const bare of [
			"await migrateFlatSettingOverviewShown();", "await _migrateGmPrepPagesToSingleJournal();",
			"await ensureStonetopSingleton();", "await _openSettingOverview();",
			"await _ensureGmToolkit();", "await _assignGmToolkitToGm();",
			"await stampWorldLayoutBaseline();", "await _applyCoreSettingDefaultsForNewWorld();",
			"await _ensurePlayerActorCreationGrant();", "await seeding;",
			"await _postStartupWelcomeMessageOnce();", "await _postBook2ArtReminderOnce();",
			"await remindDestinedOmenRoll();",
		]) expect(body, bare).not.toContain(bare);
	});

	// Each step of the GM's macro pass, and each macro in it, is caught on its own
	// (tests/hooks/system-macros-gm.test.js runs it); onReady calls the pass bare.
	it("catches the GM's macro pass step by step", () => {
		expect(body).toContain("await _ensureSystemMacros();");
		const pass = READY.slice(READY.indexOf("export async function _ensureSystemMacros() {"));
		const passBody = pass.slice(0, pass.indexOf("\n}\n"));
		for (const step of [
			`bestEffort("Introductions macro retirement", _retireIntroductionsMacro)`,
			`bestEffort("browser macro retirement", _retireMergedBrowserMacros)`,
			`bestEffort("dangling hotbar slot sweep", _clearDanglingHotbarSlots)`,
			"() => _ensureHotbarMacro(macro)",
			`bestEffort("system hotbar re-snap", _reorderSystemMacros)`,
			`bestEffort("test populate macro seed", _ensureTestPopulateMacro)`,
			`bestEffort("Import Book Art macro seed", _ensureBook2ArtMacro)`,
		]) expect(passBody, step).toContain(step);
	});

	// It already isolates its own failures: each character migration is caught and logged on its
	// own (PbtaSheetConfig.js) so the rest still run.
	it("leaves the self-isolating character migrations bare", () => {
		expect(body).toContain("await runStartupMigrations();");
		expect(readRepo("module/hooks/PbtaSheetConfig.js")).toContain("await _ensureAllCharacters(method).catch(error);");
	});

	// The two steps that read `seedingComplete` to tell a fresh world from an established one must
	// finish before the world setup sets it. Caught, the setup is held back when either fails, or
	// the retry would read a fresh world as an established one.
	it("holds the world setup back when the world-age steps fail", () => {
		expect(body).toMatch(/worldAgeSettled = await bestEffort\("world layout baseline", stampWorldLayoutBaseline\)\s*&& await bestEffort\("new-world core defaults", _applyCoreSettingDefaultsForNewWorld\);/);
		expect(body).toContain("if (worldAgeSettled) seeding = runWorldSetup();");
		expect(body).toContain("const wasFreshWorld = isGM && worldAgeSettled && pendingSetupWork().journals;");
		expect(body.indexOf("worldAgeSettled = await")).toBeLessThan(body.indexOf("seeding = runWorldSetup()"));
		expect(body.match(/= runWorldSetup\(\)/g)).toHaveLength(1);
	});

	it("catches the un-awaited resumes rather than leaving their rejections unhandled", () => {
		expect(body).toMatch(/IntroductionsDialog\.resumeRunningSession\(\)\)\s*\.catch\(/);
		expect(body).toContain("reopenOpenBookReaders().catch(");
	});
});
