const PREFIX = "Stonetop |";

/**
 * A console writer that stamps the Stonetop prefix and hands everything else to the console
 * UNTOUCHED.
 *
 * The untouched part is the whole point. This used to do `args.join(" ")`, which stringifies
 * every argument — so `error("write failed", err)` logged the text "Error: message" and threw
 * the stack, the cause chain, and the expandable object away. That made the one call these
 * helpers exist for the one call they were useless for, and 30 files across `module/` routed
 * around them, 65 of those sites hand-rolling the literal "Stonetop |" prefix this file exists
 * to supply.
 *
 * The `%c` directives consume the two style arguments; everything after is appended by the
 * console the way it appends any argument list — strings space-separated, objects live.
 */
function makeLogger(consoleFn, prefixColor) {
	return (...args) => consoleFn(
		`%c${PREFIX}%c`,
		`font-weight: bold; color: ${prefixColor};`,
		"",
		...args,
	);
}

export const info = makeLogger(console.log, "hsl(210, 60%, 50%)");
export const warn = makeLogger(console.warn, "hsl(40, 80%, 45%)");
export const error = makeLogger(console.error, "hsl(350, 73%, 45%)");
