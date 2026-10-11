import PRECOMPILED from "./precompiled-templates.js";

/**
 * Hand Foundry the release bundle's precompiled templates before anything asks for one.
 *
 * Without this, the first render of each template costs a socket round trip to fetch the file
 * plus a Handlebars compile, and the first character sheet of a session pays for its whole tree of
 * partials at once (about 120 ms in a reload profile). Foundry's `getTemplate` returns whatever
 * `Handlebars.partials` already holds under the id it is asked for, so registering each template
 * under its path, and under every alias `loadTemplates` is about to ask for, skips both.
 *
 * Each id is also recorded in `Handlebars.templateIds`, as `getTemplate` records it, so core's
 * template hot reload still finds every alias of a changed file.
 *
 * A checkout's stand-in holds nothing, so there this registers nothing and Foundry compiles live.
 *
 * @param {Record<string, string>} [aliases]  partial id -> template path, the map handed to loadTemplates
 * @param {object} [deps]
 * @param {object} [deps.Handlebars]
 * @param {Record<string, object>|null} [deps.specs]  template path -> precompiled spec
 * @returns {number} how many ids were registered
 */
export function registerPrecompiledTemplates(aliases = {}, { Handlebars = globalThis.Handlebars, specs = PRECOMPILED } = {}) {
	if (!specs || typeof Handlebars?.template !== "function") return 0;

	// All or nothing. `Handlebars.template` throws on a spec from a different compiler revision,
	// which is what a core update to a newer Handlebars would look like. Then nothing is
	// registered and Foundry fetches and compiles every template itself, as a checkout does.
	const byPath = new Map();
	try {
		for (const [path, spec] of Object.entries(specs)) byPath.set(path, Handlebars.template(spec));
	} catch (err) {
		console.warn("Stonetop | Precompiled templates skipped; Foundry will compile them instead.", err);
		return 0;
	}

	let count = 0;
	const register = (id, path, template) => {
		Handlebars.registerPartial(id, template);
		if (Handlebars.templateIds) (Handlebars.templateIds[path] ??= new Set()).add(id);
		count++;
	};
	for (const [path, template] of byPath) register(path, path, template);
	for (const [id, path] of Object.entries(aliases)) {
		const template = byPath.get(path);
		if (template && id !== path) register(id, path, template);
	}
	return count;
}
