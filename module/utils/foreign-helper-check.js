import { TEMPLATE_BARE_NAMES } from "./template-bare-names.js";

/**
 * Has another module registered a Handlebars helper under a name our templates print bare?
 *
 * Handlebars helpers are global, shared by every system and module in the world, and a bare
 * `{{when}}` asks for a helper called `when` BEFORE it reads `when` off the data. So the moment a
 * module registers a helper with that name, our template stops printing the value and calls the
 * module's function instead: at best the text goes blank, at worst the helper throws and the whole
 * sheet fails to open. That is how the GM Toolkit stopped opening for a GM running Battle
 * Transitions, whose `when` helper throws when given no arguments.
 *
 * The templates that clash in the wild are fixed (`{{this.when}}` is always data), and
 * tests/templates/foreign-helper-names.test.js keeps the known names out. But there are hundreds of
 * bare names and any module can take any of them, so this checks the live world too and names the
 * clash. A sheet that comes up wrong in one GM's world and right in everyone else's is otherwise a
 * very long bug report.
 *
 * Diagnosis only: it changes nothing. Another module's helper is that module's to keep.
 *
 * The list is generated from the templates (`npm run gen:template-names`), since the sources are
 * not to hand at runtime. It names no helper our system or core registers on purpose: the test
 * holds both lists against it.
 */

/** The bare template names that some registered helper now answers to, sorted. */
export function clashingHelpers(helpers = globalThis.Handlebars?.helpers ?? {}, names = TEMPLATE_BARE_NAMES) {
	return names.filter(name => Object.hasOwn(helpers, name)).sort();
}

/** The GM-facing message for a clash, or null when there is none. */
export function clashMessage(clashes) {
	if (!clashes.length) return null;
	const list = clashes.map(n => `"${n}"`).join(", ");
	const one = clashes.length === 1;
	return `A module has added ${one ? "a template helper" : "template helpers"} named ${list}, `
		+ `${one ? "a name" : "names"} Stonetop's sheets also use for their own text. Parts of some sheets may show the wrong text or fail to open. Turning modules off `
		+ `one at a time finds the one responsible; please report it with this message.`;
}

/**
 * Warn about any clash. GM-only on screen (a player cannot act on it), console for everyone.
 * Run once all modules have loaded, so their helpers are there to be found.
 */
export function reportForeignHelperClashes({
	helpers = globalThis.Handlebars?.helpers ?? {},
	notifications = globalThis.ui?.notifications,
	user = globalThis.game?.user,
} = {}) {
	const clashes = clashingHelpers(helpers);
	const message = clashMessage(clashes);
	if (!message) return clashes;
	console.warn(`Stonetop | Handlebars helper clash: ${clashes.join(", ")}\n${message}`);
	// Permanent, like the boot report: a world that loads while the GM is away would otherwise
	// dismiss the only explanation for a sheet that will not open.
	if (user?.isGM) notifications?.warn?.(`Stonetop: ${message}`, { permanent: true });
	return clashes;
}
