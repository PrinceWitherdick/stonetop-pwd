/**
 * Has another module replaced one of the Handlebars helpers this system registers?
 *
 * Handlebars helpers are global, shared by every system and module in the world, and modules load
 * after the system. So a module that registers its own `times`, `format` or `and` silently takes
 * the name from us, and every sheet that calls `{{#each (times n)}}` or `{{format ...}}` gets the
 * module's function instead of ours: at best the text is wrong, at worst the helper throws and the
 * whole sheet fails to open. A sheet that comes up wrong in one GM's world and right in everyone
 * else's is otherwise a very long bug report, so this names the helper.
 *
 * Our templates' DATA names are not at risk: they are all written `{{this.name}}`, which is always
 * a data lookup and never a helper call (tests/templates/foreign-helper-names.test.js holds every
 * template to that). That is how the GM Toolkit stopped opening for a GM running Battle
 * Transitions: a bare `{{when}}` called its `when` helper, which throws with no arguments.
 *
 * Diagnosis only: it changes nothing. Another module's helper is that module's to keep.
 *
 * Console only, never on screen: modules often register their own `eq`, `and`, `or`, `not` or
 * `times` that behave just like ours, and a notice in every such world would be noise. The console
 * line is there for whoever is chasing a sheet that comes up wrong.
 *
 * When: a module can register a helper at any point, in `init`, after an `await` inside its
 * `ready` listener, on `canvasReady` or on first render. So this does not look once; it watches
 * `Handlebars.registerHelper` from the moment ours are in, and looks again once the world is
 * ready for a helper assigned straight onto `Handlebars.helpers`. Nothing is reported before
 * `ready`, while modules are still registering theirs: the ready sweep reports what came before it
 * in one line.
 */

/** Which of `own` (name -> our function) `helpers` no longer holds, sorted for a stable message. */
export function replacedHelpers(helpers, own) {
	return [...own].filter(([name, fn]) => helpers[name] !== fn).map(([name]) => name).sort();
}

/** The console message for these replaced helpers, or null when there are none. */
export function replacedMessage(names) {
	if (!names.length) return null;
	const list = names.map(n => `"${n}"`).join(", ");
	const one = names.length === 1;
	return `A module has replaced Stonetop's template ${one ? "helper" : "helpers"} ${list} with its own. `
		+ `Parts of some sheets may show the wrong text or fail to open. Turning modules off `
		+ `one at a time finds the one responsible; please report it with this message.`;
}

/**
 * Watch the helpers named `names`, as registered right now, for a module replacing them.
 *
 * Call it straight after this system registers its helpers, so the functions it remembers are
 * ours. Returns `check()`, which reports any replacement not reported yet (once the world is
 * ready) and returns the names it reported; the boot calls it once on `ready`.
 */
export function watchOwnHelpers(names, {
	handlebars = globalThis.Handlebars,
	isReady = () => globalThis.game?.ready === true,
	defer = fn => setTimeout(fn, 0),
} = {}) {
	const own = new Map(names.map(name => [name, handlebars.helpers[name]]));
	const reported = new Set();

	const check = () => {
		if (!isReady()) return [];
		const fresh = replacedHelpers(handlebars.helpers, own).filter(name => !reported.has(name));
		const message = replacedMessage(fresh);
		if (!message) return [];
		for (const name of fresh) reported.add(name);
		console.warn(`Stonetop | Handlebars helper replaced: ${fresh.join(", ")}\n${message}`);
		return fresh;
	};

	// One look per burst: a module registering ten helpers in one go gets one message, not ten.
	let pending = false;
	const original = handlebars.registerHelper;
	handlebars.registerHelper = function (...args) {
		const result = original.apply(this, args);
		if (!pending) {
			pending = true;
			defer(() => { pending = false; check(); });
		}
		return result;
	};

	return check;
}
