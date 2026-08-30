import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { describe, it, expect } from "vitest";
import { ONBOARDING_MOVE_GROUPS } from "../../../module/actors/character/dialogs/onboarding-move-groups.js";
import { hbsTruthy } from "../../../module/utils/hbs-truthy.js";

// The Moves tab heads each of a playbook's three onboarding clusters (Offense / Defense /
// Grit for the Heavy, and so on) inside the one Playbook Moves section, plus a trailing
// "Other" for the moves no cluster claims. The wiring has three silent failure modes, and
// these guard all three: a sub-heading left unboxed breaks the section's own fold, a bare
// group key as a fold id collides with another section's, and losing the flat fallback
// would leave a homebrew playbook with no move list at all.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");

const MOVES_HBS = read("templates/actor/partials/tab-moves.hbs");
const MOVE_GROUP_HBS = read("templates/actor/partials/move-group.hbs");
const SECTION_EDITING_JS = read("module/utils/section-editing.js");
const SHEET_JS = read("module/actors/character/StonetopCharacterSheet.js");
const CSS = read("styles/stonetop.css");

describe("playbook move sections", () => {
	it("feeds the grouped list to the playbook section only", () => {
		expect(MOVES_HBS).toContain("groups=stonetop.movelist.playbookMoveGroups");
		expect(MOVES_HBS.match(/groups=stonetop\.movelist\.playbookMoveGroups/g)).toHaveLength(1);

		// It must sit in the same partial call as the playbook section's collapse id, since
		// that is what the sub-folds are namespaced under.
		const call = MOVES_HBS.slice(
			MOVES_HBS.indexOf('collapseId="playbookMoves"') - 900,
			MOVES_HBS.indexOf('collapseId="playbookMoves"') + 60);
		expect(call).toContain("groups=stonetop.movelist.playbookMoveGroups");
	});

	// The fold walks a heading's following SIBLINGS and stops at the next heading. The
	// sub-titles are `.stonetop-move-group-title` too, so left as bare siblings they would
	// cut the Playbook Moves fold off at the first one — it would swallow only the first
	// cluster and leave the rest standing. Boxing each group keeps them out of that walk.
	it("boxes each group so the section's own fold still swallows the lot", () => {
		expect(SECTION_EDITING_JS).toContain("nextElementSibling");
		expect(SHEET_JS).toContain(".stonetop-details-heading-row, .stonetop-move-group-title");

		const groupBlock = MOVE_GROUP_HBS.slice(
			MOVE_GROUP_HBS.indexOf("{{#each groups}}"),
			MOVE_GROUP_HBS.indexOf("{{/each}}", MOVE_GROUP_HBS.indexOf("{{#each groups}}")));
		expect(groupBlock).toMatch(/<div class="stonetop-move-subgroup">\s*\{\{>\s*"stonetop\.section-heading"/);
	});

	// One flat per-actor set holds every fold id on the sheet, and "lore" is already the
	// Details tab's Lore section AND the Seeker's / Judge's move group. A bare key would
	// fold one when the reader folded the other. Same reasoning as the `otherMoves:` prefix.
	it("namespaces each sub-fold under the section's own id", () => {
		expect(MOVE_GROUP_HBS).toContain('collapse=(concat ../collapseId ":" key)');

		const groupKeys = new Set(Object.values(ONBOARDING_MOVE_GROUPS).flat().map(g => g.key));
		const sectionIds = [...MOVES_HBS.matchAll(/collapse(?:Id)?="([^"]+)"/g)].map(m => m[1]);
		for (const id of sectionIds) expect(groupKeys.has(id), id).toBe(false);
	});

	// A playbook the group table doesn't know (homebrew, or none picked) gets [], and the
	// section has to fall back to the flat owned-then-un-owned pair rather than render nothing.
	it("keeps the flat owned / un-owned fallback", () => {
		expect(MOVE_GROUP_HBS).toContain("{{else if splitUnowned}}");
		expect(MOVE_GROUP_HBS).toContain('listClass="stonetop-move-list--owned"');
		expect(MOVE_GROUP_HBS).toContain('listClass="stonetop-move-list--unowned"');
	});

	// Both of the tab's filters can empty a cluster out, and each does it by a different
	// means — so each needs its own rule, or a heading is left standing over nothing.
	it("hides a cluster whose cards are all filtered away", () => {
		expect(CSS).toContain(
			".tab.moves.hide-unselected:not(.is-searching)\n\t.stonetop-move-subgroup:not(:has(.stonetop-move-list--owned))");
		expect(CSS).toContain(
			".tab.moves.is-searching\n\t.stonetop-move-subgroup:not(:has(.stonetop-item:not(.stonetop-search-hidden)))");
	});

	// The masonry packer balances every `.items-list` under a move group; the new nested
	// lists have to stay in its reach or each cluster renders as one tall column.
	it("leaves the nested lists inside the masonry packer's selector", () => {
		expect(SHEET_JS).toContain('".tab.moves .stonetop-move-group .items-list"');
	});
});

// "Organize by category" — the reader's own toggle over the split above, beside "Hide
// un-learned moves". Off, the clusters collapse back into the one flat owned / un-owned
// pair. Rendered for real rather than grepped: the branch turns on the `and` helper
// agreeing with `{{#if}}` about an empty list, which no amount of reading the source
// proves. `renderMoveGroup` compiles the partial against stubs for the sub-partials and
// the same helper definitions stonetop.js registers.
describe("organize-by-category toggle", () => {
	const move = name => ({ name, owned: true, ownedId: name });
	const SECTION = {
		title: "Playbook Moves", hideToggle: true, splitUnowned: true, hideUnselected: true,
		editSection: "moves", collapseId: "playbookMoves",
		moves: [move("Barkskin"), move("Veil")],
		ownedMoves: [move("Barkskin")], unownedMoves: [move("Veil")],
	};
	const GROUPS = [
		{ key: "nature", label: "Nature", ownedMoves: [move("Barkskin")], unownedMoves: [] },
		{ key: "wards", label: "Wards", ownedMoves: [], unownedMoves: [move("Veil")] },
	];

	const renderMoveGroup = ctx => {
		const hb = Handlebars.create();
		hb.registerHelper("or", (...a) => a.slice(0, -1).some(hbsTruthy));
		hb.registerHelper("and", (...a) => a.slice(0, -1).every(hbsTruthy));
		hb.registerHelper("not", v => !hbsTruthy(v));
		hb.registerHelper("concat", (...a) => a.slice(0, -1).join(""));
		hb.registerHelper("boldMissText", t => new hb.SafeString(t ?? ""));
		// The real helper (stonetop.js) folds the move's tier ladder in under the description;
		// this suite is about which GROUP a move lands in, so the body passes straight through.
		hb.registerHelper("moveBody", t => new hb.SafeString(t ?? ""));
		hb.registerHelper("repeatChecks", () => []);
		hb.registerHelper("resourceChecks", () => []);
		hb.registerPartial("stonetop.section-heading", "[heading:{{title}}]");
		hb.registerPartial("stonetop.details-section-edit-toggle", "");
		hb.registerPartial("stonetop.move-mark-level", "");
		const tpl = hb.compile(MOVE_GROUP_HBS);
		hb.registerPartial("stonetop.move-group", tpl);
		const html = tpl(ctx);
		return {
			html,
			clusters: (html.match(/stonetop-move-subgroup/g) ?? []).length,
			// Every move card, however the branch drew it. A move rendered TWICE would hand
			// one move two sets of live controls, which is why the split is exclusive.
			cards: (html.match(/data-item-id="/g) ?? []).length,
			flatLists: (html.match(/stonetop-move-list--(?:un)?owned/g) ?? []).length,
			hasCategoryBox: html.includes("stonetop-group-by-category-check"),
			categoryBoxChecked: /stonetop-group-by-category-check" checked/.test(html),
		};
	};

	it("heads each cluster when the toggle is on", () => {
		const { clusters, cards } = renderMoveGroup({ ...SECTION, groups: GROUPS, groupByCategory: true });
		expect(clusters).toBe(2);
		expect(cards).toBe(2);
	});

	// Off is the flat owned / un-owned pair the section has always fallen back to — with
	// every move still on it. Dropping one here would be the quiet failure: the toggle is a
	// view over the list, never a filter of it.
	it("collapses to one flat list when the toggle is off, losing no moves", () => {
		const { clusters, cards, flatLists } = renderMoveGroup({ ...SECTION, groups: GROUPS, groupByCategory: false });
		expect(clusters).toBe(0);
		expect(flatLists).toBe(2);
		expect(cards).toBe(2);
	});

	// The empty-array trap, end to end. A playbook the group table doesn't know partitions
	// to [], and `and` has to call that absent exactly as `{{#if groups}}` would. Built on
	// plain `Boolean` it calls it present, takes the grouped branch, and renders an empty
	// `{{#each}}` — a Playbook Moves heading over no moves at all.
	it("falls back to the flat list for a playbook with no clusters", () => {
		const { clusters, cards, flatLists, hasCategoryBox } =
			renderMoveGroup({ ...SECTION, groups: [], groupByCategory: true });
		expect(clusters).toBe(0);
		expect(flatLists).toBe(2);
		expect(cards).toBe(2);
		// Nothing to organize by, so no toggle to offer.
		expect(hasCategoryBox).toBe(false);
	});

	// The checkbox asks whether the playbook HAS clusters, never whether the toggle is on.
	// Gated on its own state it would vanish the moment it was un-ticked — the reader
	// stranded on the flat list with no control left to switch back.
	it("keeps the checkbox on screen, unticked, once the toggle is off", () => {
		const off = renderMoveGroup({ ...SECTION, groups: GROUPS, groupByCategory: false });
		expect(off.hasCategoryBox).toBe(true);
		expect(off.categoryBoxChecked).toBe(false);

		const on = renderMoveGroup({ ...SECTION, groups: GROUPS, groupByCategory: true });
		expect(on.categoryBoxChecked).toBe(true);
	});

	// The flag drives the branch, so the sheet has to both read it (defaulting ON, which is
	// how the section has always drawn) and write it back on change — and the checkbox needs
	// its own class, or the existing hide-unselected handler fires for it too.
	it("persists the toggle per actor, on by default", () => {
		expect(SHEET_JS).toContain('this.actor.getFlag(STONETOP_SCOPE, "groupMovesByCategory") ?? true');
		expect(SHEET_JS).toContain('.stonetop-group-by-category-check").on("change"');
		expect(SHEET_JS).toContain('setFlag(STONETOP_SCOPE, "groupMovesByCategory", ev.currentTarget.checked)');
		expect(MOVES_HBS).toContain("groupByCategory=stonetop.groupMovesByCategory");
	});

	// Every check control on the sheet is an appearance:none box painted by our SVG
	// background. Miss either half of the master block and the toggle renders as a bare
	// native checkbox, or as one that never visibly ticks.
	it("skins the new checkbox in both halves of the master block", () => {
		expect(CSS).toContain("\n.stonetop-group-by-category-check,\n");
		expect(CSS).toContain("\n.stonetop-group-by-category-check:checked,\n");
	});
});
