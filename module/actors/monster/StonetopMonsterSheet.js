import { CREATURE_TYPE_CHOICES, creatureTypeIcon, creatureTypeLabel } from "../../bestiary/creature-types.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";
import { hasText } from "../bestiary/codex.js";
import { rollDamageAt } from "../../combat/attack-flow.js";
import { damageBlows } from "../../utils/damage.js";
import { hideBrokenPortrait, stripHeaderChrome, injectHeaderToggle } from "../../utils/sheet-chrome.js";
import { capitalizeFirst, escHtml, isDefaultImg } from "../../utils/strings.js";
import { headerPortraitContext, wirePortraitPopout } from "../../utils/actor-portrait-picker.js";
import { updateRichTextField, updateMoveField } from "../../utils/stat-block-edit.js";
import { findMonsterTag } from "../../data/monster-tags.js";
import { getHoverDescriptionSetting, getOpenSheetsInEditMode, isFightTabEnabled } from "../../settings.js";
import { parseArmorBoost, armorBoostLabel } from "../../utils/monster-armor-boost.js";
import { outnumberBonus, pileOnBonus, numbersClauses, groupCasualties, casualtyNote, wireFightingInNumbers } from "../../data/follower-build.js";
import { postListCard } from "../../utils/chat.js";
import { localize, format } from "../../utils/i18n.js";
import { deletionEntry, enrichHTML, compendiumSourceOf } from "../../utils/foundry-compat.js";
import { withSheetSizeMemory, sizeOnceOnOpen } from "../../utils/sheet-size.js";
import { mountTabRail } from "../../utils/tab-rail.js";
import { stripJournalArt } from "../../book2-art/world-journal-art.js";
import { condemnedContext } from "../character/condemn.js";
import { SYSTEM_ID } from "../../system-id.js";

// Per-organization combat budget (Book I, "Dangers", pp.396-398).
const ORGANIZATION_DEFAULTS = {
	horde:    { hp: 3,  die: "d6" },
	group:    { hp: 6,  die: "d8" },
	solitary: { hp: 12, die: "d10" },
};

const ORGANIZATION_CHOICES = {
	horde:    "stonetop.monster.organizationHorde",
	group:    "stonetop.monster.organizationGroup",
	solitary: "stonetop.monster.organizationSolitary",
};

const MONSTER_RICH_TEXT_FIELDS = [
	{ key: "qualities", enrichedKey: "enrichedQualities" },
	{ key: "notes",     enrichedKey: "enrichedNotes" },
];

// The only fields an inline stat-block edit may write to a monsterMove item (its
// name and its two schema fields), so a stray data-field can't write anywhere else.
const MONSTER_MOVE_EDITABLE_FIELDS = new Set(["name", "system.description", "system.rollFormula"]);

function _normalizeTag(value) {
	return String(value ?? "").trim().toLocaleLowerCase();
}


/**
 * Split a monster's free-text Damage value into its separate attack modes, each
 * carrying its own dice expression for a roll button.
 *
 * The split itself is the shared one the combat flow asks with (see
 * `parseMonsterAttacks`), so the lines the sheet prints and the attacks a PC can
 * suffer are the same list: comma OR "or" outside the tag lists, and a fragment
 * with no die of its own is another NAME for the next blow rather than a blow.
 * Reading it here from the same rule is what gives the Assassin's garrote — the
 * far side of an "or" — the roll button its dagger already had.
 *
 * Each mode also carries what its damage card says: the attack's name as the
 * title and its tags as the body (`damageCardText`). The whole printed line used
 * to be the title, which repeated the die the card's formula chip already shows.
 *
 * @param {string} value
 * @returns {{ text: string, formula: string, rollMode: string, title: string, keywords: string, weapon: object|null }[]}
 */
function _parseDamageModes(value) {
	// The blows read by the shared reader (utils/damage.js#damageBlows), the one the fight ring reads
	// too. Each mode opens its own line on the sheet, so it opens with a capital, as the damage card's
	// title does: "Antler of jagged bone d10+2 (close, messy, 1 piercing)". Display only.
	return damageBlows(value).map(blow => ({ ...blow, text: capitalizeFirst(blow.text) }));
}

// The creature's flavor/quality tags with the organization and size dropped
// (those get their own header chips), trimmed and de-blanked. Returned as an
// array so callers can join it for display or wrap each tag individually.
function _displayMonsterTags(system) {
	const hidden = new Set([
		_normalizeTag(system?.organization),
		_normalizeTag(system?.size),
	].filter(Boolean));

	return String(system?.tags ?? "")
		.split(",")
		.map(tag => tag.trim())
		.filter(tag => tag && !hidden.has(_normalizeTag(tag)));
}

// Render the display tags as HTML, wrapping each recognised tag in a tooltip
// span. Unknown (flavor) tags render as plain text. Returns the escaped plain
// string when `withTooltips` is false.
function _displayTagsHtml(tags, withTooltips) {
	return tags.map(tag => {
		const tip = withTooltips ? findMonsterTag(tag) : null;
		return tip
			? `<span class="stonetop-monster-tag" data-tooltip="${escHtml(tip)}" data-tooltip-direction="UP">${escHtml(tag)}</span>`
			: escHtml(tag);
	}).join(", ");
}

// True when rich text holds real content: any non-whitespace text, or an
// embedded element (img, etc.). Empty editors serialize to markup like
// "<p></p>" or "<p><br></p>", which strip to no text and so read as empty.
function _hasRichContent(value) {
	// Embedded media counts as content even with no surrounding text; otherwise
	// fall back to the shared "strip tags and check for text" predicate.
	if (/<(img|hr|table|iframe|video|audio)\b/i.test(String(value ?? ""))) return true;
	return hasText(value);
}

export function createStonetopMonsterSheetClass(Base) {
	// withSheetSizeMemory: reopen at the size this user last left this monster's sheet.
	return class StonetopMonsterSheet extends withSheetSizeMemory(Base) {
		_editMode = false;
		_initialHeightApplied = false;

		constructor(...args) {
			super(...args);
			// Honor the "Open Sheets in Edit Mode" client setting on first open.
			this._editMode = getOpenSheetsInEditMode();

			// A remembered height retires _applyInitialHeight: that measures the sheet and sizes
			// the window to fit the Stat Block tab, which is a good guess for a sheet
			// nobody has sized and a bad one for a sheet somebody has — left armed it would fire
			// on the next render and overwrite the size the user chose, which is the very thing
			// the restore put back.
			//
			// Load-bearing that the size memory only records a DRAGGED size (see
			// utils/sheet-size.js): this measurement calls setPosition itself, so a memory that
			// recorded programmatic sizing would store this first guess and then read it back
			// here forever, and the monster would still be sized for the content it had the day
			// it was first opened. With the drag latch, an unresized monster re-measures on every
			// open, which is what picks up newly added GM moves or a stat block.
			if (this._restoredSheetSize.height) this._initialHeightApplied = true;
		}

		static get defaultOptions() {
			return foundry.utils.mergeObject(super.defaultOptions, {
				classes: ["stonetop", "sheet", "actor", "monster"],
				width:   760,
				// Numeric height keeps the window drag-resizable. The real opening
				// height is computed per-monster in _applyInitialHeight(), fitted to
				// the Stat Block tab the sheet opens on.
				height:    680,
				// Mirrors the CSS floor in stonetop.css — see the character sheet's note.
				// This frame carries no `pbta` class, so pbta's own actor floor never reached
				// it and core's 50px fallback was all that stood in the way of a drag.
				minHeight: 480,
				resizable: true,
				// Stat Block (the stat block and its moves) is the landing tab; Notes leads with the
				// codex Details, then the GM's own. Both always render. The body is named for this
				// sheet rather than `.sheet-body`,
				// which the other sheets' layout rules are written against.
				tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".stonetop-monster-body", initial: "statblock" }],
			});
		}

		get template() {
			return "systems/stonetop-pwd/templates/actor/monster.hbs";
		}

		async _render(force, options) {
			// A caller that hands over a height has already sized the window: the window restore,
			// reopening a sheet at the size it was left. That outranks the opening measurement
			// exactly as a remembered size does (see the constructor).
			if (Number.isFinite(options?.height)) this._initialHeightApplied = true;
			await super._render(force, options);
			this._injectHeaderToggle();
			this._stripHeaderChrome();
			this.element[0]?.classList.toggle("stonetop-edit-mode", this._editMode);
			this._hideBrokenPortrait();
			this._applyInitialHeight();
		}

		/**
		 * Open the window tall enough to show the whole Stat Block tab, the one the sheet opens on.
		 * Runs once per sheet so it doesn't fight the user's manual resizing on later re-renders,
		 * and never on a tab change: moving between tabs does not resize a sheet
		 * (tests/actors/tabbed-sheet-height.test.js), so a longer Notes tab scrolls.
		 *
		 * Until Notes had a tab of its own this measured down to the Notes heading, so the window
		 * opened with Notes just below the fold. Fitting the panel is that same intent with Notes
		 * gone from it. The panel is found by its class rather than its tab key.
		 *
		 * A frame with no layout box yet leaves the latch open for a later render to try again. A
		 * frame that is showing, but on ANOTHER tab (a window restored onto Notes), closes it
		 * unmeasured: the next render to find the Stat Block showing is whichever one follows the
		 * reader clicking back to it, and sizing then is a tab change resizing the sheet.
		 */
		_applyInitialHeight() {
			// Measured after layout settles (prose-mirror upgrades asynchronously), which is what
			// sizeOnceOnOpen defers for.
			sizeOnceOnOpen(this, "_initialHeightApplied", () => {
				const el = this.element[0];
				const content = el.querySelector(".window-content");
				const panel   = el.querySelector(".stonetop-monster-statblock");
				const header  = el.querySelector(".window-header");
				if (!content || !panel || !el.getClientRects().length) return false;
				if (!panel.getClientRects().length) return;
				const contentTop  = content.getBoundingClientRect().top;
				const panelBottom = panel.getBoundingClientRect().bottom;
				const padBottom   = parseFloat(getComputedStyle(content).paddingBottom) || 0;
				const headerH     = header ? header.getBoundingClientRect().height : 0;
				const height = Math.ceil(headerH + (panelBottom - contentTop) + padBottom);
				if (height <= 0) return false;
				this.setPosition({ height });
			});
		}

		_hideBrokenPortrait() {
			hideBrokenPortrait(this, "stonetop-monster-header");
		}

		_stripHeaderChrome() {
			stripHeaderChrome(this);
		}

		_injectHeaderToggle() {
			injectHeaderToggle(this, "monster");
		}

		_getHeaderButtons() {
			const buttons = super._getHeaderButtons().filter(b => b.class !== "configure-sheet");
			// A "Journal" button (the linked bestiary entry) just before Prototype Token.
			if (this.actor.system?.entry) {
				const journal = {
					label: localize("stonetop.monster.openEntry"),
					class: "stonetop-open-entry",
					icon:  "fas fa-book",
					onclick: () => this._openEntryFromHeader(),
				};
				const tokenIdx = buttons.findIndex(b => b.class === "configure-token");
				if (tokenIdx >= 0) buttons.splice(tokenIdx, 0, journal);
				else buttons.unshift(journal);
			}
			return buttons;
		}

		/**
		 * Resolve `system.entry` and open it. The bestiary is migrating from actors
		 * to journal pages, so it may resolve to a JournalEntryPage (open its journal
		 * scrolled to that page), a whole JournalEntry, or a legacy bestiary actor —
		 * open each in its natural sheet. When the entry has been imported into the
		 * world, open that copy instead of the compendium original.
		 */
		async _openEntryFromHeader() {
			const uuid = this.actor.system?.entry;
			const doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
			if (!doc) return;
			const target = this._preferWorldCopy(doc);
			if (target.documentName === "JournalEntryPage") {
				target.parent?.sheet?.render(true, { pageId: target.id });
				return;
			}
			target.sheet?.render(true);
		}

		/**
		 * Given a (usually compendium) bestiary doc, return the GM's in-world copy if
		 * one has been imported from it, else the original. Edits and links resolve
		 * against the working copy, so the Journal button should land there when it
		 * exists. A JournalEntryPage resolves via its parent entry's world copy, then
		 * re-locates the page inside it (its id differs from the compendium's).
		 */
		_preferWorldCopy(doc) {
			if (!doc.pack) return doc; // already a world document
			const isPage = doc.documentName === "JournalEntryPage";
			const entry  = isPage ? doc.parent : doc;
			if (!entry) return doc;

			const worldEntry = (game.journal ?? []).find(j => compendiumSourceOf(j) === entry.uuid);
			if (!worldEntry) return doc;
			if (!isPage) return worldEntry;

			return worldEntry.pages.find(p => compendiumSourceOf(p) === doc.uuid)
				?? worldEntry.pages.find(p => p.name === doc.name)
				?? worldEntry.pages.contents[0]
				?? worldEntry;
		}

		/**
		 * The creature's codex write-up, for the sheet's Write-up tab.
		 *
		 * READ-ONLY, and deliberately: the page stays the single source of truth, and a
		 * compendium page is immutable by design anyway (StonetopBestiaryPageSheet forces
		 * isEditable false inside a pack whatever the lock says), so the sheet lifts the
		 * prose and the header button remains the way to the page itself.
		 *
		 * Gated on the PARENT JournalEntry's permission rather than the page's. A bestiary
		 * page ships `ownership.default: -1` (INHERIT), so testing the page on its own
		 * inherits nothing and would hand every player the GM's write-up.
		 *
		 * Memoised per entry uuid: this walks the compendium, and the sheet re-renders on
		 * every HP change during a fight. The memo is dropped when a journal it was read from
		 * changes (_onWriteUpSourceChanged), so a GM's edit to the page, or a change to who may
		 * read it, reaches a sheet that is already open.
		 */
		async _resolveWriteUp() {
			const uuid = this.actor.system?.entry;
			if (!uuid) return null;
			if (this._writeUpCache?.uuid === uuid) return this._writeUpCache.value;
			this._watchWriteUpSources();
			const sources = new Set();
			const value = await this._readWriteUp(uuid, sources);
			this._writeUpCache = { uuid, value, sources };
			return value;
		}

		/**
		 * `sources` collects the journal entries the answer depends on: the one `system.entry`
		 * links, and the world copy read in its place. Filled before any early return, so a
		 * write-up withheld or blank today still hears the permission change or the prose that
		 * would change that.
		 */
		async _readWriteUp(uuid, sources = new Set()) {
			const doc = await fromUuid(uuid).catch(() => null);
			if (!doc) return null;
			// `entry` may point at the page itself, at the whole JournalEntry (which is what
			// every shipped stat block holds — the merged journal pack), or at a legacy
			// bestiary actor, which has no pages and so has no write-up to lift.
			const target = this._preferWorldCopy(doc);
			const isPage = target.documentName === "JournalEntryPage";
			const entry  = isPage ? target.parent : target;
			const linked = doc.documentName === "JournalEntryPage" ? doc.parent : doc;
			for (const source of [linked, entry]) if (source?.uuid) sources.add(source.uuid);
			const page   = isPage
				? target
				: (entry?.pages?.find(p => p.type === "bestiary") ?? entry?.pages?.contents?.[0] ?? null);
			if (!page) return null;
			// Absent in a bare test double; only an explicit `false` withholds the page.
			if (entry?.testUserPermission?.(game.user, "OBSERVER") === false) return null;

			// The creature's illustration is already this sheet's portrait, so the embed the
			// Book II art pass puts on the page comes off rather than showing the picture twice.
			// Stripped BEFORE the emptiness test: a page holding only its picture has no write-up.
			const description = stripJournalArt(page.system?.description);
			if (!hasText(description)) return null;
			return {
				html: await enrichHTML(description),
				name: entry?.name ?? page.name ?? "",
			};
		}

		/**
		 * Listen for changes to the journals a write-up is read from, once per open window
		 * (released in close). Creation counts as well as edits: importing the entry into the
		 * world makes the world copy the one to read.
		 */
		_watchWriteUpSources() {
			if (this._writeUpHooks) return;
			this._writeUpHooks = ["JournalEntry", "JournalEntryPage"]
				.flatMap(name => ["create", "update", "delete"].map(verb => `${verb}${name}`))
				.map(hook => [hook, Hooks.on(hook, doc => this._onWriteUpSourceChanged(doc))]);
		}

		_unwatchWriteUpSources() {
			for (const [hook, id] of this._writeUpHooks ?? []) if (id != null) Hooks.off(hook, id);
			this._writeUpHooks = null;
		}

		/** Drop the memo, and repaint, when `doc` belongs to a journal the write-up was read from. */
		_onWriteUpSourceChanged(doc) {
			const sources = this._writeUpCache?.sources;
			if (!sources?.size) return;
			const entry = doc?.documentName === "JournalEntryPage" ? doc.parent : doc;
			if (!entry || !(sources.has(entry.uuid) || sources.has(compendiumSourceOf(entry)))) return;
			this._writeUpCache = null;
			if (this.rendered) this.render(false);
		}

		async getData() {
			const context = await super.getData();
			const system = context.system ??= this.actor.system;
			context.stonetop ??= {};
			const st = context.stonetop;

			st.editMode    = this._editMode;
			// Started now, awaited below: the lookup walks a compendium, and need not wait for the
			// rich-text enrichment in between.
			const writeUp  = this._resolveWriteUp();
			const displayTags = _displayMonsterTags(system);
			st.displayTags = displayTags.join(", ");
			st.damageModes = _parseDamageModes(system?.attributes?.damage?.value);
			st.multiDamage = st.damageModes.length > 1;

			// A Judge's Condemn brand. A stat block is a person often enough for this to matter —
			// a bandit chief, a cultist, a Lodge assassin — and Censure's target only has to be
			// "an individual in your presence". Read from the world; see condemn.js.
			st.condemned = condemnedContext(this.actor);

			// Hover tooltips for the organization / size / quality tags on the
			// header stat line, explaining each term (Book I "Dangers").
			const showTagTips  = getHoverDescriptionSetting("hoverDescriptionsMonsterTags");
			st.displayTagsHtml = _displayTagsHtml(displayTags, showTagTips);
			st.sizeTooltip     = showTagTips ? findMonsterTag(system?.size) : null;

			// Creature type + its icon, which doubles as the default portrait when
			// the stat block has no custom art (Book I "Monster types", p.392).
			st.creatureTypeChoices = CREATURE_TYPE_CHOICES;
			st.creatureTypeLabel   = creatureTypeLabel(system?.creatureType);
			const realImg  = isDefaultImg(this.actor.img) ? null : this.actor.img;
			const typeIcon = creatureTypeIcon(system?.creatureType);
			st.displayImg   = realImg ?? typeIcon ?? null;
			st.hasPortrait  = !!st.displayImg;
			// The header portrait and its two pips, answered once for all three sheets that draw
			// them. Framed if this monster's face has been cropped — the same square every small
			// round surface and the token show. Resolved off `realImg` only: a creature-type mark
			// is decorative and can carry no frame, so it always takes the plain-<img> branch.
			Object.assign(st, headerPortraitContext(this, realImg ?? ""));
			// What the UNFRAMED branch of the header draws, and whether the slot is drawn at all.
			// The framed branch is the same in both modes — a chosen face should not be re-cropped
			// by the lock button — so only these two differ:
			//
			//   edit  the raw stored path, so you can see what is actually ON the actor, and the
			//         slot always, because clicking it is how art gets CHOSEN.
			//   play  the creature-type mark standing in for missing art, and no slot at all when
			//         there is neither.
			st.headerImg    = st.editMode ? this.actor.img : st.displayImg;
			st.showPortrait = st.editMode || st.hasPortrait;

			for (const field of MONSTER_RICH_TEXT_FIELDS) {
				st[field.enrichedKey] = await enrichHTML(system?.[field.key]);
			}

			// Empty rich text round-trips through ProseMirror as "<p></p>" etc.,
			// so check for actual text/embeds rather than a truthy string.
			st.hasQualities = _hasRichContent(system?.qualities);
			// Twenty creatures have no moves and keep everything they do in Notes, which has its own
			// tab; the empty moves line on the landing tab points there. See monster.hbs.
			st.hasNotes = _hasRichContent(system?.notes);

			// The linked codex write-up, for the Details section atop the Notes tab. The section
			// always renders; when there is nothing to lift, it says which of the two reasons it
			// is, because "not linked" and "linked but blank" ask different things of the GM.
			st.writeUp = await writeUp;
			// Copied, never mutated: the memo behind it is shared with the next render.
			if (st.writeUp?.name === this.actor.name) st.writeUp = { ...st.writeUp, name: "" };
			st.writeUpLinked = !!system?.entry;

			// Organization label + choices for the header (organization also drives
			// the HP/damage defaults applied by the reset-defaults button).
			const org = _normalizeTag(system?.organization);
			st.organizationChoices = ORGANIZATION_CHOICES;
			st.organizationLabel   = ORGANIZATION_CHOICES[org] ?? "";
			st.organizationTooltip = showTagTips ? findMonsterTag(org) : null;

			// Fighting-in-numbers tools for a horde/group (Book I, Dangers pp.414-416),
			// hung off the otherwise-dead system.count ("Group size"). TWO rules, one
			// row each, because they answer different questions and only agree when the
			// creatures face a single target — see follower-build.js for both quoted in
			// full. The stat block's own HP/armor/damage are already "as per a single
			// individual member", so nothing here multiplies them.
			//
			// That one HP box is read at two scales, and `fightAsGroup` says which. Off (the
			// default), the sheet is one creature: an unlinked token with its own HP, where a
			// wound is a wound, and neither row is drawn, since both count a group's bodies. On,
			// the GM is running the whole group as one combatant (p.416), the box is the group's
			// pool, and Group size, its casualties and both rows apply.
			//
			// WITH THE FIGHT TAB ON, the switch and both rows are the fight's to do. A token's
			// scale is chosen as it joins a fight ("how many?") and changed from the tab (Merge,
			// Split: fight/group-scale.js), which also settle the pool, the headcount and the other
			// tokens that a bare checkbox left as they were. And the fight adds both rules' bonuses
			// to the ordinary Damage roll from who is actually fighting whom (fight/damage-seed.js),
			// where the rows, typed by hand and rolled unseeded, could only repeat that or disagree
			// with it. So the column keeps just what the tab reads: Group size, and the casualties
			// of a token fighting as a group. With the tab off, nothing else offers any of it, and
			// the switch and rows stay.
			st.isGroupOrg        = org === "horde" || org === "group";
			st.fightAsGroup      = st.isGroupOrg && !!system?.fightAsGroup;
			st.fightTab          = isFightTabEnabled();
			st.numbersRows       = st.fightAsGroup && !st.fightTab;
			st.groupColumn       = st.isGroupOrg && (!st.fightTab || st.editMode || st.fightAsGroup);
			st.count             = Math.max(0, Math.trunc(Number(system?.count) || 0));
			st.baseDamageFormula = String(system?.attributes?.damage?.rollFormula || ORGANIZATION_DEFAULTS[org]?.die || "d6").trim();

			// Both readouts are answered HERE, not left to the first keystroke. Rendering the
			// inputs pre-filled with "6 vs 1" beside an empty result and an unmodified damage
			// line showed the GM a state the sheet did not actually mean: the numbers said +5
			// and the roll button said d6, and only touching a field reconciled them.
			//
			// Only a horde or a group has these tools at all, and the template draws none of
			// them otherwise, so a solitary creature — the common case for a named danger —
			// does not pay for formula rewrites nothing will read.
			if (st.isGroupOrg) {
				// "Damage represents casualties": what the stat block's remaining HP means in
				// bodies, once the GM is running the whole group as one combatant. The stat
				// block's HP is already a single member's, which is exactly the pool this rule
				// reads, so it needs no conversion. Only then, though: read off one creature's
				// token, a crinwin at 1 of 3 HP said "2 of 6 still standing" about a fight it was
				// never part of. Null until a count has been recorded, and null while nobody is
				// down: Group size's own box already gives the headcount, and "all 6 still
				// standing" says nothing it doesn't.
				const pool = {
					hpMax:     system?.attributes?.hp?.max,
					hpCurrent: system?.attributes?.hp?.value,
					count:     st.count,
				};
				const { out, standing, routed } = groupCasualties(pool);
				st.casualtyNote = st.fightAsGroup && (out > 0 || routed) ? casualtyNote(pool) : null;

				// Both rows, only for a group being run as one, and only with the Fight tab off (see
				// above). They open at the bodies still in the fight, as the follower cards do:
				// "adjust the bonuses to damage and armor accordingly!" A member out of the action is
				// not an attacker, nor one of the side's numbers. With no group size recorded they
				// open at one rather than a horde's typical six, since a lone member of a group is in
				// the book too (a lone suarachan); one is also the inputs' own minimum.
				if (st.numbersRows) {
					const swarmCount   = Math.max(1, standing);
					const swarm        = pileOnBonus(swarmCount);
					const exchange     = outnumberBonus(swarmCount, 1);
					st.swarmCount      = swarmCount;
					// Each readout as the template draws it, one span per clause (see numbersClauses).
					st.swarmClauses    = numbersClauses(swarm.label);
					st.swarmFormula    = swarm.rollFor(st.baseDamageFormula);
					st.exchangeClauses = numbersClauses(exchange.label);
					st.exchangeFormula = exchange.rollFor(st.baseDamageFormula);
				}
			}

			// Armor-boost moves (e.g. "Withdraw into its shell (Armor 5)") act as
			// toggles in play mode: clicking sets the stat block's Armor to that
			// value, clicking again reverts. The live boost (if any) is remembered
			// on a flag so it survives re-renders, but only counts while (a) its
			// move still exists — a deleted move shouldn't strand the indicator —
			// and (b) the sheet is editable, since the toggle writes to the actor,
			// so a read-only view (e.g. a compendium preview) shows nothing to click.
			const editable     = this.isEditable;
			const monsterMoves = this.actor.items.filter(i => i.type === "monsterMove");
			const boostFlag    = this.actor.flags?.[SYSTEM_ID]?.armorBoost ?? null;
			const activeMove   = boostFlag?.moveId
				? monsterMoves.find(m => m.id === boostFlag.moveId) : null;
			const boost = activeMove && editable ? boostFlag : null;

			// Preserve the book's move order — don't sort.
			context.monsterMoves = await Promise.all(monsterMoves.map(async i => {
				const armorBoost  = parseArmorBoost(i.name);
				const boostActive = boost?.moveId === i.id;
				// The shield marks a togglable move: any move whose name grants Armor,
				// plus the live boost itself (so a move whose name was since edited to
				// drop "(Armor N)" can still be reverted from its own row). 0 is a real
				// Armor value, so test `!= null`, not falsiness.
				const isBoost = editable && (armorBoost != null || boostActive);
				return {
					id: i.id, name: i.name, system: i.system,
					armorBoost,
					boostActive,
					showBoostIcon: isBoost,
					boostTooltip: !isBoost ? null
						: boostActive
							? localize("stonetop.monster.armorBoostRevert")
							: format("stonetop.monster.armorBoostApply", { value: armorBoost }),
					// The move description is edited inline in edit mode; the prose-mirror
					// shows this enriched HTML until the user toggles it open to edit. Only
					// enriched in edit mode, where the editor is actually rendered.
					enrichedDescription: this._editMode ? await enrichHTML(i.system?.description) : undefined,
				};
			}));

			// Read the label from the move's current name (so a rename shows through
			// instead of the value frozen on the flag). Escape it: Foundry renders
			// data-tooltip as innerHTML, so a name with markup would otherwise inject.
			const boostLabel = boost ? armorBoostLabel(activeMove.name) : "";
			st.armorBoost = boost ? {
				value:     boost.value,
				baseValue: boost.baseValue,
				label:     boostLabel,
				tooltip:   format("stonetop.monster.armorBoostNote",
					{ value: boost.value, base: boost.baseValue, move: escHtml(boostLabel) }),
			} : null;
			return context;
		}

		async close(options) {
			this._writeUpCache = null;
			this._unwatchWriteUpSources();
			return super.close(options);
		}

		activateListeners(html) {
			super.activateListeners(html);

			// Hang the tab rail off the window's right edge (module/utils/tab-rail.js). Never
			// behind a condition: it is also what sweeps a previous render's rail off the frame.
			mountTabRail(this, html);

			// Fighting-in-numbers calculators, one per rule (follower-build.js). The "+N armor"
			// the abstraction pays is a fiction note the GM applies by hand; armor isn't
			// auto-applied to incoming damage anywhere, monster or follower side.
			wireFightingInNumbers(html[0], { rollKey: "rollFormula", baseKey: "baseFormula" });

			// Rolling works even when the sheet is read-only (e.g. viewed from the
			// compendium): roll a move or roll damage on click. Play actions, not edits.
			html[0].addEventListener("click", async ev => {
				const dmgRoll = ev.target.closest(".stonetop-monster-damage-roll");
				if (dmgRoll) {
					const formula = dmgRoll.dataset.rollFormula || this.actor.system?.attributes?.damage?.rollFormula;
					if (!formula) return;
					// Route through the shared roll-engine so the monster's damage posts
					// in the same Stonetop roll-card shell as character/follower damage,
					// not a bare Foundry roll card. The speaker alias names the monster;
					// the card is titled with the attack's name ("Icy touch") and prints its
					// tags beside the total, and a noted dis/advantage applies to the die.
					// The fighting-in-numbers rows carry a title of their own and no keywords.
					const label    = dmgRoll.dataset.rollLabel || "Damage";
					const keywords = dmgRoll.dataset.rollKeywords || "";
					const rollMode = dmgRoll.dataset.rollMode  || "normal";
					// The blow's own armor clause (its piercing, "ignores armor"), for the Apply that takes
					// a character's armor off it. Read from the line this button stands on.
					const mode = "modeIndex" in dmgRoll.dataset
						? _parseDamageModes(this.actor.system?.attributes?.damage?.value)[Number(dmgRoll.dataset.modeIndex)]
						: null;
					// Aimed at whoever this monster is fighting on the map, or at the GM's own targets
					// (fight/fight-targets.js), with a plain card as before when that is nobody.
					//
					// The stat block's own noted advantage SEEDS the damage window rather than
					// being replaced by it: skipping the window (Shift, or the setting off) still
					// has to roll "icy touch d6 w/disadvantage" at disadvantage, as it always did.
					//
					// The fight's +N for several attackers on one target (fight/damage-seed.js). Not on the
					// swarm and group rows, whose formulas already carry their own numbers.
					await rollDamageAt(this.actor, {
						formula, label, keywords, rollMode,
						weapon: mode?.weapon ?? null,
						seeded: !("numbersRoll" in dmgRoll.dataset),
						shiftKey: ev.shiftKey,
					});

				} else if (ev.target.closest(".stonetop-monster-move-roll")) {
					const li   = ev.target.closest("[data-item-id]");
					const item = this.actor.items.get(li?.dataset?.itemId);
					// Shift skips the damage window a rolling move opens, as it does on the Damage line.
					await item?.roll({ shiftKey: ev.shiftKey });

				} else if (!this._editMode && ev.target.closest(".stonetop-monster-move-name")) {
					const li   = ev.target.closest("[data-item-id]");
					const item = this.actor.items.get(li?.dataset?.itemId);
					if (!item) return;
					// A move that bakes an Armor value into its name ("…(Armor 5)")
					// toggles that boost instead of posting to chat — provided the
					// stat block is editable (the toggle writes to the actor). The live
					// boost move also toggles even if its name was since edited to drop
					// the parenthetical, so the boost can always be reverted from its row.
					const boost    = parseArmorBoost(item.name);
					const isActive = this.actor.flags?.[SYSTEM_ID]?.armorBoost?.moveId === item.id;
					if (this.isEditable && (boost != null || isActive)) {
						await this._toggleArmorBoost(item, boost);
					} else {
						// Otherwise, clicking the name posts the move to chat (with its
						// roll if it has one), like move names on the character sheet.
						await item.roll({ shiftKey: ev.shiftKey });
					}
				}
			});

			// Clicking the portrait opens the People of Stonetop gallery in edit mode and
			// enlarges the picture in play mode, plus the crop pip over it. Registered
			// before the isEditable bail so the play-mode window still opens from a
			// read-only view (e.g. a monster opened out of a compendium) — the controls
			// inside it gate themselves on isEditable.
			wirePortraitPopout(this, html[0]);

			if (!this.isEditable) return;

			html[0].addEventListener("click", async ev => {
				if (ev.target.closest(".stonetop-monster-add-move")) {
					if (!this._editMode) return;
					await this.actor.createEmbeddedDocuments("Item", [{
						name: "New Move",
						type: "monsterMove",
					}]);

				} else if (ev.target.closest(".stonetop-monster-delete-move")) {
					if (!this._editMode) return;
					const li   = ev.target.closest("[data-item-id]");
					const item = this.actor.items.get(li?.dataset?.itemId);
					if (!item) return;
					const confirmed = await confirmOutcome({
						title:   "Delete Move",
						// Escaped: a move name is user text, and this is HTML.
						content: `<p>Delete <strong>${escHtml(item.name)}</strong>?</p>`,
						yes:     { label: "Delete the move", icon: "fa-trash" },
						no:      { label: "Keep it" },
					});
					if (!confirmed) return;
					// If the move being deleted is the live armor boost, revert it first
					// so its Armor value isn't stranded on the stat block once it's gone.
					if (this.actor.flags?.[SYSTEM_ID]?.armorBoost?.moveId === item.id) {
						await this._toggleArmorBoost(item, parseArmorBoost(item.name));
					}
					await item.delete();

				} else if (ev.target.closest(".stonetop-monster-reset-defaults")) {
					if (!this._editMode) return;
					await this._resetOrganizationDefaults();
				}
			});

			html[0].addEventListener("change", async ev => {
				// Inline move edits (embedded monsterMove items): the name, roll formula,
				// and description each carry data-field and persist straight to the item.
				// Checked before the rich-text branch since the description editor also
				// carries the shared .stonetop-monster-rich-editor class.
				const moveField = ev.target.closest(".stonetop-monster-move-field");
				if (moveField) {
					if (!this._editMode) return;
					const li = ev.target.closest("[data-item-id]");
					await this._updateMoveField(li?.dataset?.itemId, moveField.dataset?.field, moveField.value);
					return;
				}

				const editor = ev.target.closest(".stonetop-monster-rich-editor");
				if (!editor) return;
				// Notes stays editable in play mode; the other rich fields only in edit mode.
				if (editor.dataset?.field === "notes" || this._editMode) {
					await this._updateRichTextField(editor.dataset?.field, editor.value);
				}
			});
		}

		async _resetOrganizationDefaults() {
			const org = _normalizeTag(this.actor.system?.organization);
			const def = ORGANIZATION_DEFAULTS[org];
			if (!def) return;
			await this.actor.update({
				"system.attributes.hp.value":            def.hp,
				"system.attributes.hp.max":              def.hp,
				"system.attributes.damage.rollFormula":  def.die,
			});
		}

		/**
		 * Toggle an Armor-boost move on the stat block. Clicking the move sets
		 * Armor to the move's value and records a flag holding the pre-boost Armor
		 * (so the green sheet indicator can explain it and a second click reverts).
		 * Clicking a different boost move while one is active switches to it, keeping
		 * the original base — the base is never one boosted value layered on another.
		 * Armor change and flag are written in a single update so the sheet repaints
		 * once. The flag delete goes through `deletionEntry` so it uses whichever
		 * delete form the running core actually applies (ForcedDeletion on v14+, `-=` below).
		 *
		 * @param {Item}   item   the monsterMove being toggled
		 * @param {number} value  the Armor value its name grants
		 */
		async _toggleArmorBoost(item, value) {
			const current   = this.actor.flags?.[SYSTEM_ID]?.armorBoost ?? null;
			const baseArmor = this.actor.system?.attributes?.armor?.value ?? 0;
			const label     = armorBoostLabel(item.name);

			if (current?.moveId === item.id) {
				const base = current.baseValue ?? baseArmor;
				const [boostKey, boostVal] = deletionEntry("flags.stonetop-pwd.armorBoost");
				await this.actor.update({
					"system.attributes.armor.value": base,
					[boostKey]: boostVal,
				});
				this._postArmorBoostNote(label, baseArmor, base, false);
				return;
			}

			// Keep the original pre-boost Armor as the flag's base (never layer one
			// boost's value on another), but report the *current* Armor as the chat
			// "from" so switching boosts reads as the real change (5 → 6, not 3 → 6).
			const baseValue = current ? current.baseValue : baseArmor;
			await this.actor.update({
				"system.attributes.armor.value": value,
				"flags.stonetop-pwd.armorBoost": { moveId: item.id, value, baseValue, label },
			});
			this._postArmorBoostNote(label, baseArmor, value, true);
		}

		/**
		 * Announce an armor-boost toggle in chat so anyone watching the token sees
		 * why the creature's Armor changed (the speaker names the stat block). Posts
		 * a "from → to" row in the same card shell as the system's stat-change notes.
		 *
		 * @param {string}  label  the move's name (boost parenthetical stripped)
		 * @param {number}  from   Armor before this toggle
		 * @param {number}  to     Armor after it
		 * @param {boolean} isOn   true when applying the boost, false when reverting
		 */
		_postArmorBoostNote(label, from, to, isOn) {
			const armorLabel = localize("stonetop.monster.armor");
			const reverted   = isOn ? "" : ` <em>(${localize("stonetop.monster.armorBoostReverted")})</em>`;
			const row = `<li><strong>${escHtml(armorLabel)}:</strong> ${escHtml(String(from))} &rarr; ${escHtml(String(to))}${reverted}</li>`;
			postListCard(this.actor, label, row);
		}

		async _updateRichTextField(field, value) {
			return updateRichTextField(this, MONSTER_RICH_TEXT_FIELDS, field, value);
		}

		/**
		 * Persist an inline edit to one of a move's fields. Whitelisted to the three
		 * fields the stat block edits inline (the move's name and its two schema
		 * fields), so a stray data-field can't write anywhere else on the item.
		 *
		 * @param {string} itemId  the monsterMove being edited
		 * @param {string} field   "name", "system.description", or "system.rollFormula"
		 * @param {string} value   the new value
		 */
		async _updateMoveField(itemId, field, value) {
			return updateMoveField(this, MONSTER_MOVE_EDITABLE_FIELDS, itemId, field, value);
		}
	};
}
