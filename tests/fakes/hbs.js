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
import Handlebars from "handlebars";
import { readRepo } from "./css.js";

const PARTIALS = {
	"stonetop.roster-row": "templates/dialogs/partials/roster-row.hbs",
	"stonetop.roster-add": "templates/dialogs/partials/roster-add.hbs",
	"stonetop.guide-tabs": "templates/dialogs/partials/guide-tabs.hbs",
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
