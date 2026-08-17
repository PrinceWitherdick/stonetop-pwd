import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { describe, it, expect } from "vitest";

// A control must never be gated on the thing it sets. Put a checkbox for X inside
// `{{#if X}}` and it works exactly once: the reader unticks it, the next render drops the
// checkbox with it, and the setting is stuck off with nothing left on screen to turn it
// back on. `{{#unless X}}` is the same trap mirrored — it can be turned on and never off.
//
// It never looks wrong while you're writing it, because the render you're looking at is
// the one where the flag is still set. So it is checked here instead, over every template.
//
// The test is about REACHABILITY, not about the gate being unrelated. A control may sit
// under a condition its own flag contributes to, as long as something else can bring it
// back: `{{#if (or editMode X)}}` is fine — edit mode is the way in with X off. What is
// flagged is X being NECESSARY, i.e. a bare `{{#if X}}` or a conjunct of an `and`.
//
// Read with Handlebars' OWN parser rather than a hand-rolled scanner. The question here is
// entirely about template structure — which blocks enclose a control, what an `and` was
// applied to, which scope a bare name resolves in — and every one of those comes off the AST
// typed and already correct. A regex reading of the same source has to re-derive them, and
// gets a vote on things it should not: a `{{#if}}` inside a `{{!-- comment --}}` is a node
// the parser drops and a scanner counts, an `and`'s arguments need paren-aware splitting to
// separate, and the enclosing blocks need an open/close stack that recursion gives for free.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.resolve(HERE, "../../templates");

const hbsFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
	e.isDirectory() ? hbsFiles(path.join(dir, e.name))
		: e.name.endsWith(".hbs") ? [path.join(dir, e.name)] : []);

/** `@root.stonetop.x` — scope-free, so it means the same thing anywhere in the template. */
const isAnchored = p => !!p.data && p.original.startsWith("@root.");
/** `../x` names a path in an enclosing frame; resolving that properly means tracking what each
 *  frame holds, which is more machinery than this earns. Skipped, not guessed. */
const isRelative = p => p.depth > 0;
const keyOf = p => p.parts.join(".");

/**
 * The paths that MUST be truthy for a condition to pass. Every conjunct of an `and` qualifies,
 * recursively; a disjunct of an `or` does not, and neither does anything under a `not` — in both
 * of those the body is still reachable with the path falsy. Anything else (a helper call, a
 * literal) contributes nothing we can reason about.
 */
function necessaryPaths(node) {
	if (!node) return [];
	if (node.type === "PathExpression") return [node];
	if (node.type === "SubExpression" && node.path?.original === "and") return node.params.flatMap(necessaryPaths);
	return [];
}

/** The literal text a block's body renders, or null if it renders anything but text. */
function literalText(program) {
	const body = program?.body ?? [];
	if (!body.length || body.some(n => n.type !== "ContentStatement")) return null;
	return body.map(n => n.value).join("");
}

const RENDERS_CHECKED = /^\s*checked\s*$/;

/**
 * Follow an `<input …>` tag across the statement stream.
 *
 * The tag is not a node and cannot be: it OPENS inside one ContentStatement, its `checked`
 * binding is a BlockStatement sibling, and it closes in a later ContentStatement. The walk below
 * is depth-first in document order, so one mutable cursor tracks it across siblings and into
 * nested blocks alike. `tag` accumulates the tag's literal text so a finding can name the control
 * by its class no matter which side of the binding that class sits on — which is why findings are
 * held pending until the `>` arrives.
 */
function trackTagText(cursor, text, found) {
	let rest = text;
	while (rest) {
		if (!cursor.open) {
			const at = rest.search(/<input\b/i);
			if (at < 0) return;
			cursor.open = true;
			cursor.tag = "";
			rest = rest.slice(at);
		}
		const end = rest.indexOf(">");
		if (end < 0) { cursor.tag += rest; return; }
		cursor.tag += rest.slice(0, end);
		closeTag(cursor, found);
		rest = rest.slice(end + 1);
	}
}

function closeTag(cursor, found) {
	const control = (cursor.tag.match(/class="([^"]+)"/)?.[1] ?? "input").split(" ")[0];
	for (const pending of cursor.pending) found.push({ ...pending, control });
	cursor.pending = [];
	cursor.open = false;
	cursor.tag = "";
}

/**
 * Every `<input>` in `src` carrying a plain `{{#if PATH}} checked{{/if}}` binding, with the
 * conditions that had to hold for it to render at all.
 *
 * `gates` are the enclosing `if`/`unless` blocks, each tagged with the `each`/`with` depth it was
 * written at — because those rebind what a bare name MEANS. That is how a `checked` inside
 * `{{#each choices.options}}` can sit under a gate reading the possession's own `checked` without
 * either having anything to do with the other.
 */
export function collectCheckedControls(src) {
	const found = [];
	const cursor = { open: false, tag: "", pending: [] };

	const walk = (program, gates, scope) => {
		for (const node of program?.body ?? []) {
			if (node.type === "ContentStatement") { trackTagText(cursor, node.value, found); continue; }
			if (node.type !== "BlockStatement") continue;

			const kind = node.path?.original;
			const cond = node.params[0];

			if (cursor.open && kind === "if" && RENDERS_CHECKED.test(literalText(node.program) ?? "")) {
				// A computed binding (`(or a b)`) names no single flag to be stranded on, and a
				// `../` one is the frame-tracking this deliberately skips.
				if (cond?.type === "PathExpression" && !isRelative(cond)) {
					cursor.pending.push({
						path: keyOf(cond), anchored: isAnchored(cond),
						gates, scope, line: node.loc.start.line,
					});
				}
				continue;   // the body is the word `checked`; nothing inside it to walk
			}

			const isCond = kind === "if" || kind === "unless";
			const rebinds = kind === "each" || kind === "with";
			walk(node.program, isCond ? [...gates, { kind, cond, scope }] : gates, rebinds ? scope + 1 : scope);
			// The `{{else}}` arm renders when this block's condition FAILED, so it carries no
			// requirement from it — an `unless`'s else is the `if` and vice versa, and neither can
			// strand a control. It walks under the ancestors' gates alone.
			if (node.inverse) walk(node.inverse, gates, scope);
		}
	};

	walk(Handlebars.parse(src), [], 0);
	// An unterminated tag at EOF still gets to report what it found.
	if (cursor.pending.length) closeTag(cursor, found);
	return found;
}

/**
 * Every control whose `checked` binding reads a path its own render depends on.
 * @returns {Array<{control: string, path: string, gate: string, line: number}>}
 */
export function findSelfGatedControls(src) {
	return collectCheckedControls(src).filter(c => c.gates.some(g =>
		necessaryPaths(g.cond).some(p => {
			if (isRelative(p)) return false;
			// An anchored path compares anywhere; a bare one only within the scope it was written
			// in, since an intervening `each`/`with` makes the same name a different thing.
			if (isAnchored(p)) return c.anchored && keyOf(p) === c.path;
			return !c.anchored && g.scope === c.scope && keyOf(p) === c.path;
		}))).map(c => ({
		control: c.control,
		path: c.path,
		gate: c.gates.map(g => `${g.kind} ${g.cond?.original ?? "…"}`).join(" > "),
		line: c.line,
	}));
}

// A detector that quietly matches nothing passes the sweep below forever. These pin the
// two answers it has to be able to give before the sweep is worth anything.
describe("the self-gated-control detector", () => {
	const control = binding => `<input type="checkbox" class="x-check"{{#if ${binding}}} checked{{/if}}>`;

	it.each([
		["a bare gate on its own flag", `{{#if organize}}${control("organize")}{{/if}}`],
		["a conjunct of an and", `{{#if (and edit organize)}}${control("organize")}{{/if}}`],
		["a conjunct of a NESTED and", `{{#if (and edit (and shown organize))}}${control("organize")}{{/if}}`],
		["a gate two levels up", `{{#if organize}}<div>{{#if edit}}${control("organize")}{{/if}}</div>{{/if}}`],
		["an unless, which strands it the other way", `{{#unless organize}}${control("organize")}{{/unless}}`],
		["an anchored path across scopes", `{{#if @root.organize}}{{#each rows}}${control("@root.organize")}{{/each}}{{/if}}`],
		["a class written AFTER the binding", `{{#if organize}}<input type="checkbox"{{#if organize}} checked{{/if}} class="x-check">{{/if}}`],
	])("catches %s", (_label, src) => {
		expect(findSelfGatedControls(src)).toHaveLength(1);
	});

	it.each([
		["an or, where the other disjunct is the way back", `{{#if (or edit organize)}}${control("organize")}{{/if}}`],
		["a not, which the body outlives", `{{#if (not organize)}}${control("organize")}{{/if}}`],
		["a gate on a different path", `{{#if groups}}${control("organize")}{{/if}}`],
		["a bare path rebound by an each between gate and control", `{{#if checked}}{{#each options}}${control("checked")}{{/each}}{{/if}}`],
		["no gate at all", control("organize")],
		["a control that sets nothing", `{{#if organize}}<input type="text" name="a">{{/if}}`],
		["a control in the ELSE arm of its own gate", `{{#if organize}}<p>on</p>{{else}}${control("organize")}{{/if}}`],
		// The parser drops a comment outright; a scanner reading the same source counts the
		// `{{#if}}` inside it and reports a gate that never renders anything.
		["a gate that only exists inside a comment", `{{!-- {{#if organize}} --}}${control("organize")}`],
	])("passes %s", (_label, src) => {
		expect(findSelfGatedControls(src)).toEqual([]);
	});

	it("names the control by its class and points at the binding's line", () => {
		const [found] = findSelfGatedControls(`{{#if organize}}\n\n${control("organize")}{{/if}}`);
		expect(found.control).toBe("x-check");
		expect(found.line).toBe(3);
		expect(found.gate).toBe("if organize");
	});
});

describe("templates", () => {
	it("gate no control on the flag it sets", () => {
		const findings = hbsFiles(TEMPLATES).flatMap(file =>
			findSelfGatedControls(fs.readFileSync(file, "utf8"))
				.map(f => `${path.relative(TEMPLATES, file)}:${f.line}  .${f.control} sets "${f.path}", gated on: ${f.gate}`));
		expect(findings).toEqual([]);
	});

	// The sweep is only as good as its reach: if the walk stops finding templates, or the
	// binding stops being recognised, it reports the same clean result as a healthy run.
	it("actually reaches the templates it claims to sweep", () => {
		const files = hbsFiles(TEMPLATES);
		expect(files.length).toBeGreaterThan(50);
		const bound = files.filter(f => collectCheckedControls(fs.readFileSync(f, "utf8")).length > 0);
		expect(bound.length).toBeGreaterThan(10);
	});
});
