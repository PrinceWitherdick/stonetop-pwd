/**
 * A Handlebars instance wired the way the roster windows are wired.
 *
 * The Condemned and Blessed Marks windows are one template shape over three partials, and every
 * suite that renders either of them needs the same four lines of registration first. Four had
 * written them out (one of them twice in the same file), which is four places to remember a new
 * partial and four to get a helper's behaviour subtly different in.
 *
 * The partials are read from the repo rather than stubbed, on purpose: these suites exist to
 * catch a template that stopped emitting a class the wiring or the stylesheet looks for, and a
 * stub would answer for the stub.
 */
import fs from "node:fs";
import Handlebars from "handlebars";
import { readRepo, repoPath } from "./css.js";

const PARTIALS = {
	"stonetop.roster-row": "templates/dialogs/partials/roster-row.hbs",
	"stonetop.roster-add": "templates/dialogs/partials/roster-add.hbs",
	"stonetop.guide-tabs": "templates/dialogs/partials/guide-tabs.hbs",
	"stonetop.section-heading": "templates/actor/partials/section-heading.hbs",
};

/**
 * A fresh instance carrying the roster partials and the two helpers the roster templates call.
 *
 * FRESH EACH TIME, not one shared instance: a suite that registers a partial of its own must not
 * leave it behind for the next file in the run.
 */
export function rosterHandlebars() {
	const hb = Handlebars.create();
	for (const [name, path] of Object.entries(PARTIALS)) hb.registerPartial(name, readRepo(path));
	// `localize` hands the key straight back, so an assertion names the key it means rather than
	// whatever en.json happens to say today.
	hb.registerHelper("localize", k => String(k));
	hb.registerHelper("eq", (a, b) => a === b);
	return hb;
}

/** Compile one roster template's source and render it over `context`. */
export function renderRoster(source, context = {}) {
	return rosterHandlebars().compile(source)(context);
}

let partialMap = null;
/**
 * stonetop.js's partial registration map: "stonetop.name" -> "systems/stonetop-pwd/templates/….hbs".
 * Read once per test file.
 */
export function systemPartials() {
	partialMap ??= new Map([...readRepo("stonetop.js")
		.matchAll(/"(stonetop\.[\w-]+)":\s*"(systems\/stonetop-pwd\/[^"]+\.hbs)"/g)].map(m => [m[1], m[2]]));
	return partialMap;
}

/** A fresh Handlebars instance carrying every system partial under its real name, as in Foundry. */
export function systemHandlebars() {
	const hb = Handlebars.create();
	for (const [name, p] of systemPartials()) hb.registerPartial(name, readRepo(p.replace("systems/stonetop-pwd/", "")));
	return hb;
}

let templates = null;
/** Every template under templates/, as `{ rel, source }` in a stable order. Read once per test file. */
export function templateSources() {
	const walk = rel => fs.readdirSync(repoPath(rel), { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap(e => e.isDirectory() ? walk(`${rel}/${e.name}`)
			: e.name.endsWith(".hbs") ? [`${rel}/${e.name}`] : []);
	templates ??= walk("templates").map(rel => ({ rel, source: readRepo(rel) }));
	return templates;
}

/**
 * Every name a template uses in a way Handlebars resolves as a helper FIRST and as data only if no
 * helper of that name exists: `{{name}}`, `{{#name}}…{{/name}}` and `(name)`, each with no
 * arguments, one path segment, no `this.`, no `../`, no `@`. Each comes with the line it is on.
 *
 * Handlebars helpers are global, shared by every system and module in the world, so each of those
 * is a name any module can take over by registering a helper with it. `{{this.name}}` is always a
 * data lookup and is never found.
 *
 * A block parameter (`{{#each rows as |row|}}{{row}}{{/each}}`) is skipped, as Handlebars' own
 * compiler skips it: inside its block it is always the value, never a helper call.
 *
 * The name is `parts[0]`, the key Handlebars looks the helper up by, so `{{[when]}}` is `when`.
 */
export function bareHelperLookups(source) {
	const found = [];
	const blockParams = [];   // a stack: one entry per enclosing program
	const visitor = new Handlebars.Visitor();

	const head = function (node) {
		const p = node.path;
		if (p.type === "PathExpression" && !p.data && Handlebars.AST.helpers.simpleId(p)
			&& !node.params.length && !node.hash && !blockParams.some(scope => scope.includes(p.parts[0]))) {
			found.push({ name: p.parts[0], line: node.loc.start.line });
		}
		return Handlebars.Visitor.prototype[node.type].call(this, node);
	};
	visitor.MustacheStatement = head;
	visitor.BlockStatement = head;
	visitor.SubExpression = head;
	// A block's `as |a b|` lives on the program it opens, so it is in scope for exactly that body.
	visitor.Program = function (node) {
		blockParams.push(node.blockParams ?? []);
		try { return Handlebars.Visitor.prototype.Program.call(this, node); }
		finally { blockParams.pop(); }
	};

	visitor.accept(Handlebars.parse(source));
	return found;
}

/**
 * Every opening tag in a template, read the way a browser would read it once Handlebars had run:
 * `{ name, start, end, attrs: [{ name, raw }] }`, where `raw` is the attribute's value as written
 * (mustaches and all) or undefined for a bare attribute.
 *
 * A regex cannot do this. An attribute value may hold a mustache with quotes of its own
 * (`data-tooltip="{{localize "stonetop.x"}}"`), and a partial call takes hash arguments that LOOK
 * like attributes (`{{> section-heading title="Stats"}}`) and are not: both are skipped whole here,
 * so `title=` on a partial is never mistaken for a native title. A mustache standing between two
 * attributes (`{{#if x}}disabled{{/if}}`) is stepped over and the attributes round it are kept.
 */
export function openingTags(source) {
	const tags = [];
	const n = source.length;
	const pastMustache = j => {
		if (source.startsWith("{{!--", j)) { const e = source.indexOf("--}}", j); return e < 0 ? n : e + 4; }
		const triple = source.startsWith("{{{", j);
		const e = source.indexOf(triple ? "}}}" : "}}", j);
		return e < 0 ? n : e + (triple ? 3 : 2);
	};
	let i = 0;
	while (i < n) {
		if (source.startsWith("{{", i)) { i = pastMustache(i); continue; }
		if (source.startsWith("<!--", i)) { const e = source.indexOf("-->", i); i = e < 0 ? n : e + 3; continue; }
		const open = source[i] === "<" && /^<([a-zA-Z][\w-]*)/.exec(source.slice(i, i + 40));
		if (!open) { i++; continue; }
		const tag = { name: open[1].toLowerCase(), start: i, attrs: [] };
		let j = i + open[0].length;
		while (j < n) {
			if (/\s/.test(source[j])) { j++; continue; }
			if (source.startsWith("{{", j)) { j = pastMustache(j); continue; }
			if (source[j] === ">") { j++; break; }
			if (source[j] === "/" && source[j + 1] === ">") { j += 2; break; }
			const name = /^[^\s=>/{]+/.exec(source.slice(j, j + 80));
			if (!name) { j++; continue; }
			const attr = { name: name[0] };
			j += name[0].length;
			if (source[j] === "=") {
				j++;
				const quote = source[j] === '"' || source[j] === "'" ? source[j++] : null;
				const from = j;
				while (j < n && (quote ? source[j] !== quote : !/[\s>]/.test(source[j]))) {
					j = source.startsWith("{{", j) ? pastMustache(j) : j + 1;
				}
				attr.raw = source.slice(from, j);
				if (quote) j++;
			}
			tag.attrs.push(attr);
		}
		tag.end = j;
		tags.push(tag);
		i = j;
	}
	return tags;
}
