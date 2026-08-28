import { SYSTEM_ID } from "../system-id.js";

/**
 * Did this system's own startup actually finish, and if not, say so out loud.
 *
 * WHY THIS EXISTS. Foundry wraps every hook callback in a try/catch of its own: a hook that throws
 * is logged to the console and the load carries on with the next listener. That is the right call
 * for Foundry and a trap for us, because our `init` does one long run of registrations. A throw
 * a third of the way down leaves a world where the sheets are registered and the settings after
 * the throw point are not, and NOTHING says so. The world opens, the sidebar looks right, actors
 * open, and the only symptom is that a handful of features are quietly inert.
 *
 * That is not hypothetical. A GM reported an empty People gallery on a world holding a full art
 * import; every art setting read back as "not a registered game setting", which can only happen if
 * `registerSettings()` never reached them. The import macro had faithfully written 500-odd files
 * and then skipped publishing the indexes, because writing to an unregistered setting throws and
 * it guards against that. Two silences stacked on top of each other, and the GM was left with a
 * world that looked fine and art that nothing could see.
 *
 * So the load now checks itself. Everything here is diagnosis only: it registers nothing, repairs
 * nothing, and changes no behaviour. Its whole job is to turn a silent partial boot into a message
 * that names what is missing.
 */

/**
 * Settings spread across the length of `registerSettings`, in the order that function registers
 * them, used as depth markers rather than for what they hold.
 *
 * The point is WHERE the registration stopped. Asking about one setting only answers "did it run";
 * asking along the whole span answers "how far did it get", which is what turns a bug report into
 * a line number. `book2ArtRoot` is in the list because it is the one the reported failure was seen
 * through, and `sheetSize` because it is near the end.
 *
 * These are read by name only, never written, so a key that is retired simply reports as missing
 * on a world where it genuinely is missing. Keep them in registration order.
 */
export const BOOT_SENTINELS = Object.freeze([
	"seedingComplete",
	"bestiaryActorFoldersCollapsed",
	"journalSyncVersion",
	"artifactsStartUnidentified",
	"book2ArtRoot",
	"peopleArt",
	"sessionZeroDone",
	"sheetFontScale",
	"editPencilRevealDelay",
	"arcanaSectionsCollapsed",
]);

// What the boot recorded about itself. Module-scoped rather than on `game`, because the whole
// point is to survive a failure that may stop `game.stonetop` from ever being built.
const state = { failures: [], completed: [] };

/** Note that a startup phase ran all the way through. */
export function recordBootPhase(phase) {
	if (!state.completed.includes(phase)) state.completed.push(phase);
}

/**
 * Note that a startup phase threw.
 *
 * The stack is kept because it is the answer: it names the function that failed, which is the one
 * thing a report of "my settings are missing" can never tell us on its own.
 */
function recordBootFailure(phase, err) {
	state.failures.push({ phase, message: String(err?.message ?? err), stack: String(err?.stack ?? "") });
}

/**
 * Run one startup step, recording whether it got through, and RE-THROW if it did not.
 *
 * Re-throwing is the point: this changes nothing about what happens, only about what is known
 * afterwards. Foundry still catches the error at the hook boundary and still logs it, the rest of
 * `init` is still skipped exactly as it was, and the only difference is that the failure now has a
 * name and a stack attached to it that `reportBootHealth` can put in front of a GM.
 *
 * Applied to the few calls whose failure is both plausible and catastrophic rather than to every
 * line of `init`: a step that registers nothing can fail without anybody needing a report about
 * it, and the sentinel check below catches whatever this does not.
 */
export function bootStep(phase, fn) {
	try {
		const result = fn();
		recordBootPhase(phase);
		return result;
	} catch (err) {
		recordBootFailure(phase, err);
		throw err;
	}
}

/**
 * Which sentinel settings this world actually registered, in order.
 *
 * `game.settings.settings` is a Map keyed `"<namespace>.<key>"`. Asked rather than `get`, because
 * `get` THROWS for an unregistered setting and this has to report on exactly that case without
 * becoming the next thing that fails.
 */
export function sentinelReport(keys = BOOT_SENTINELS, settings = globalThis.game?.settings?.settings) {
	const has = (k) => !!settings?.has?.(`${SYSTEM_ID}.${k}`);
	const registered = keys.filter(has);
	const missing = keys.filter((k) => !has(k));
	return {
		registered, missing,
		// The deepest marker that DID register, which is the closest this can get to naming the
		// line the run stopped on. Null when nothing registered at all, which is a different and
		// much worse story: the module never evaluated.
		lastRegistered: registered.at(-1) ?? null,
		// Everything present is the healthy shape. Anything else is worth a GM's attention.
		ok: missing.length === 0,
	};
}

/**
 * The whole picture, as data. Exposed on `game.stonetop.bootReport()` so a GM can paste it back
 * without being walked through a console session.
 */
export function bootReport() {
	return {
		system: `${globalThis.game?.system?.id ?? "?"} ${globalThis.game?.system?.version ?? "?"}`,
		foundry: String(globalThis.game?.version ?? "?"),
		host: String(globalThis.location?.hostname ?? "?"),
		completed: [...state.completed],
		failures: state.failures.map((f) => ({ ...f })),
		settings: sentinelReport(),
	};
}

/**
 * The one line that says whether this world's Stonetop install is healthy.
 *
 * Deliberately blunt, and deliberately aimed at a GM rather than a developer: the person looking
 * at the screen is the person who has to decide whether to report this, and "12 of 77 settings
 * registered" means nothing to them. What they need is that the system did not start properly,
 * that it is not their art or their world, and where to look.
 */
export function bootHealthMessage(report = bootReport()) {
	const { settings, failures, completed = [] } = report;
	// `init` is recorded on its LAST line, so its absence is a verdict of its own and one the
	// sentinels cannot reach: a throw AFTER registerSettings() got through leaves every checked
	// setting present and the rest of `init` skipped, which is a partial boot that reads as
	// perfectly healthy. That is the exact silence this module exists to break, so the phase
	// record is asked about rather than merely collected.
	const finishedInit = completed.includes("init");
	if (settings.ok && !failures.length && finishedInit) return null;
	const bits = [];
	if (failures.length) {
		const f = failures[0];
		bits.push(`The Stonetop system did not finish starting up: its ${f.phase} step failed with "${f.message}".`);
	} else {
		bits.push("The Stonetop system did not finish starting up.");
	}
	if (!finishedInit && settings.ok) {
		// Settings all present and `init` unfinished: name the half that is actually broken, or a
		// GM reads "did not finish starting up" and goes hunting through settings that are fine.
		bits.push("Its settings all registered, so the failure came later in the startup run: some features are wired and some are not.");
	}
	if (!settings.ok) {
		bits.push(settings.lastRegistered
			? `Its settings stopped registering after "${settings.lastRegistered}" (${settings.missing.length} of the ${settings.registered.length + settings.missing.length} checked are missing).`
			: "None of its settings registered at all.");
		// The consequence, in the words of what a GM will actually notice, because the symptom and
		// the cause look nothing like each other from the table.
		bits.push("Until that is fixed, imported book art will not show up in the People gallery, treasure drops or the GM playbook diagrams, however many files are on disk.");
	}
	bits.push("Press F12, open the Console tab and reload: the first red error is the cause. Please send it with a bug report.");
	return bits.join(" ");
}

/**
 * Report the boot's health once the world is up. Called from the `ready` hook.
 *
 * That hook is registered at module scope, so it still fires when the `init` callback threw, which
 * is the case this exists for. It cannot help when module evaluation ITSELF failed (nothing of
 * ours runs then), and it does not need to: the import macro reports that side, having found the
 * settings it wanted to publish into were never registered.
 *
 * GM-only. A player cannot act on it, and cannot see the console error that explains it.
 */
export function reportBootHealth({
	notifications = globalThis.ui?.notifications,
	user = globalThis.game?.user,
	// Injectable for the same reason every other reader here is: what this does with a report is
	// worth testing on its own, without having to arrange a half-broken boot to produce one.
	report = bootReport(),
} = {}) {
	const message = bootHealthMessage(report);
	if (!message) return null;
	console.error(`Stonetop | STARTUP INCOMPLETE\n${message}`, report);
	for (const f of report.failures) if (f.stack) console.error(`Stonetop | ${f.phase} stack:\n${f.stack}`);
	// Permanent: this is not progress, it is a verdict, and a world that loads while a GM is making
	// coffee would otherwise dismiss the only warning they were going to get.
	if (user?.isGM) notifications?.error?.(`Stonetop: ${message}`, { permanent: true });
	return report;
}
