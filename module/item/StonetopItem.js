import {StonetopPlaybook} from "./StonetopPlaybook.js";
import {rollFormula, rollStat} from "../utils/roll-engine.js";
import {normalizeRollType} from "../utils/roll-types.js";
import {filterStatOptionLines, escHtml} from "../utils/strings.js";
import {moveCardBody} from "../utils/move-tiers.js";
import {stonetopThumbnail} from "../utils/item-icon.js";
import {STONETOP_SCOPE, ITEM_FLAG_SCOPE} from "../actors/character/StonetopFlags.js";
import {newArcanumSlug, isArcanumData} from "./createArcanum.js";
import {isKnowThings, knowThingsRollOptions} from "../actors/character/know-things.js";

/**
 * Which world item owns each arcanum slug: `slug -> item id`.
 *
 * First writer wins, which is the honest reading — a second item on one slug is the very thing
 * `_arcanumSlugIsSomebodyElses` exists to prevent, so if one is already there the map only has to
 * say that SOMEBODY has it.
 */
function _worldSlugOwners() {
	const owners = new Map();
	for (const item of globalThis.game?.items ?? []) {
		const slug = String(item.flags?.[ITEM_FLAG_SCOPE]?.slug ?? "").trim();
		if (slug && !owners.has(slug)) owners.set(slug, item.id);
	}
	return owners;
}

/**
 * The slug bookkeeping for ONE `createDocuments` call, built on first use and shared by every
 * document in it.
 *
 * TWO THINGS ONE CARD-AT-A-TIME CREATE NEVER NEEDED. `_preCreate` runs per document, against the
 * collection as it stands:
 *
 *   · It cannot see its SIBLINGS. Two cards on one slug inside a single import both looked unique
 *     and both went in -- and two cards on one slug is two cards wearing each other's play state,
 *     which is the whole reason the check is here. `claimed` is what each card puts its slug into
 *     on the way past, so the next one can see it.
 *   · It re-scanned `game.items` per card. Dragging the arcana folder into the sidebar is one
 *     call carrying eighty-odd cards; against a world holding the seeded catalogs that is the
 *     whole item directory walked once per card. `owners` is built once and reused.
 *
 * Keyed off the `options` object core passes to every document in the call, through a WeakMap so
 * nothing is written onto a document-lifecycle object that gets serialized or broadcast, and the
 * whole entry is collected as soon as the call is over.
 */
const _BATCH_SLUGS = new WeakMap();

function _batchSlugs(options) {
	if (!options || typeof options !== "object") return null;
	let batch = _BATCH_SLUGS.get(options);
	if (!batch) {
		batch = { owners: _worldSlugOwners(), claimed: new Set() };
		_BATCH_SLUGS.set(options, batch);
	}
	return batch;
}

export function createStonetopItemClass(BaseItem) {
	return class StonetopItem extends BaseItem {

		/**
		 * Stamp an arcanum card with its slug before it is written.
		 *
		 * The slug is the identity key for everything a character saves about a card -- its marks,
		 * its unlock counts, and the owned/identified/flipped lists -- so "every arcanum has one"
		 * is an invariant of the DOCUMENT, not of any one screen. It used to be repaired by the
		 * editor's `getData`, which made a render responsible for fixing stored data and only
		 * reached cards somebody happened to open: a card built by macro or console and never
		 * edited stayed slug-less while players held marks against it.
		 *
		 * Fills a GAP, and breaks a TIE. Shipped pack arcana carry their own slug and
		 * `createArcanumItem` mints one into its payload, so an import and the creator both pass
		 * straight through -- which matters, because a slug rewritten on import would orphan every
		 * mark in the world that points at the old one. A COPY is the other way a card can arrive
		 * carrying a slug, and there the slug has to be re-minted: see `_arcanumSlugIsSomebodyElses`.
		 *
		 * Same shape as StonetopActor#_preCreate: one `updateSource` on the pending document.
		 * @override
		 */
		async _preCreate(data, options, user) {
			const allowed = await super._preCreate(data, options, user);
			if (allowed === false) return false;
			if (!isArcanumData(this)) return;
			const slug = String(this.flags?.[ITEM_FLAG_SCOPE]?.slug ?? "").trim();
			let mine = slug;
			if (!slug || this._arcanumSlugIsSomebodyElses(slug, options)) {
				mine = newArcanumSlug();
				this.updateSource({ [`flags.${ITEM_FLAG_SCOPE}.slug`]: mine });
			}
			// CLAIMED FOR THE REST OF THIS BATCH. `_preCreate` runs per document against the
			// collection as it stands, which cannot see the siblings arriving in the SAME call --
			// so a folder of arcana dragged into the sidebar carrying two cards on one slug had
			// both of them pass the check that exists to stop exactly that. See `_batchSlugs`.
			_batchSlugs(options)?.claimed.add(mine);
		}

		/**
		 * Is the slug this card arrived with already another card's identity?
		 *
		 * A slug is an IDENTITY, not a name, so two cards may never share one: marks, unlock counts
		 * and the owned/identified/flipped lists are all keyed by it, and two cards on one slug is
		 * two cards wearing each other's play state -- ticking a mark on either shows it on both.
		 * The editor deliberately doesn't show the slug, so there is no screen on which a GM could
		 * see the clash, let alone fix it; the only place it can be prevented is here.
		 *
		 * The sidebar's Duplicate copies the whole document, slug and all, which is exactly this
		 * case. Core stamps a copy with `_stats.duplicateSource` (Document#clone's `addSource`), so
		 * that flag alone settles it -- including for a duplicate made inside a compendium, where
		 * there is no world collection to compare against.
		 *
		 * The sweep of `game.items` behind it catches the copies core doesn't stamp: a macro or
		 * console `Item.create(card.toObject())`, or a module doing the same. Read ONCE PER CREATE
		 * CALL rather than once per card (`_batchSlugs`): a card at a time is the common gesture,
		 * but dragging the arcana folder into the sidebar is one call carrying eighty-odd of them,
		 * and a scan per card over a stocked world is that count times the whole item directory.
		 *
		 * @param {string} slug
		 * @param {object} [options] the shared per-call options `_preCreate` was handed
		 */
		_arcanumSlugIsSomebodyElses(slug, options) {
			if (this._stats?.duplicateSource) return true;
			if (this.pack) return false;
			const batch = _batchSlugs(options);
			// An earlier card in THIS call already took it. Always somebody else's, whoever they
			// are: siblings mid-create have no ids to tell apart.
			if (batch?.claimed.has(slug)) return true;
			const owners = batch?.owners ?? _worldSlugOwners();
			const owner = owners.get(slug);
			return owner !== undefined && owner !== this.id;
		}

		/**
		 * The image the Items sidebar (and anything else reading `thumbnail`) draws for this
		 * item. Core returns `img` verbatim, so every item that never got art of its own shows
		 * Foundry's stock bag glyph and a directory of them reads as one repeated icon. Items
		 * WITH art are untouched; the rest fall back to a marker chosen by what the item is.
		 *
		 * Display only — `img` is never rewritten, so this changes no stored data and an item
		 * that later gains real art picks it up on its own.
		 * @override
		 */
		get thumbnail() {
			return stonetopThumbnail(this);
		}

		/**
		 * Sidebar "Create Item". None of Stonetop's hand-authorable content is a plain Item
		 * sub-type — a custom move saves as a reusable world Move, and steading improvements
		 * and threats aren't Items at all — so instead of Foundry's Item type picker (which
		 * would only offer pack-managed types like playbook/npcMove/monsterMove) we open our
		 * own chooser: Move, Steading Improvement, or Threat, each producing a reusable,
		 * draggable artifact. Callers passing an explicit `types` restriction (internal
		 * tooling), and creates into a compendium (`pack`) — every flow above builds a
		 * WORLD item and would silently ignore the pack — fall through to the stock dialog
		 * unchanged.
		 * @override
		 */
		static async createDialog(data = {}, createOptions = {}, options = {}, renderOptions = {}) {
			if (options.types || createOptions.pack) {
				return super.createDialog(data, createOptions, options, renderOptions);
			}
			const { openCreateStonetopContent } =
				await import("../dialogs/create-stonetop-content-dialog.js");
			await openCreateStonetopContent();
			return null;
		}

		asPlaybook() {
			return new StonetopPlaybook(this);
		}

		/**
		 * Execute this item as a move.
		 * - rollType present  → 2d6+stat via rollStat (stonetop roll card)
		 * - rollFormula only  → evaluate the raw formula and post a plain chat message
		 * - neither (or descriptionOnly) → post description to chat
		 *
		 * @param {object} options
		 * @param {boolean} [options.descriptionOnly]
		 * @param {string}  [options.rollMode]           - "adv" | "dis" | "normal" (see roll-engine;
		 *   never Foundry's core public/gmroll/blind/self rollMode)
		 * @param {string}  [options.stonetopDebility]
		 * @param {string}  [options.stonetopDebilityTooltip]
		 */
		async roll(options = {}) {
			const actor = this.parent;
			if (!actor) return;

			const rollType    = normalizeRollType(this.system?.rollType);
			const stat        = options.statOverride ?? rollType;
			const rawFormula  = this.system?.rollFormula ?? null;
			const descriptionOnly = options.descriptionOnly ?? (!stat && !rawFormula);

			// Optional closing sign-off (love letters end with one, e.g. "XOXO - your GM").
			// Appended to the description in both the read-aloud and rolled paths.
			const signed  = String(this.system?.signed ?? "").trim();
			const signoff = signed ? `<p class="stonetop-move-signoff">${escHtml(signed)}</p>` : "";

			if (descriptionOnly) {
				// Tickable here too, and for the same reason it is everywhere else: ONE rule for
				// every move, wherever its printed list is shown. This is the path a move takes
				// from the HOTBAR (rollMoveById) and from an NPC or monster sheet, and it used to
				// post the same text the Moves tab's name-click posts, minus the boxes — so
				// Mighty Thews dragged to the bar offered a "pick 1" nobody could tick, and no
				// tally above it, while the same move on the tab did both.
				//
				// And the ladder too, which is the same argument again: the sheet re-lays a move's
				// 10+ / 7-9 / 6- as labelled rows (utils/move-tiers.js), so a card that posted the
				// book's run-on paragraph instead was the one surface still leaving the outcomes
				// buried in the sentence.
				return ChatMessage.create({
					content: `<div class="stonetop-chat-move">
						<h3 class="stonetop-chat-move-name">${escHtml(this.name)}</h3>
						<div class="stonetop-chat-move-description">${moveCardBody(this.system?.description ?? "", this.system?.moveResults)}${signoff}</div>
					</div>`,
					speaker: ChatMessage.getSpeaker({ actor }),
				});
			}

			// "ask" moves (Defy Danger/Interfere) carry per-stat option lines to filter.
			const isStatChoice = rollType === "ask" && !!options.statOverride;
			// A fixed-stat move rolled with an alternate stat (e.g. Skill at Arms → Clash
			// with DEX) isn't an "ask" move but should still label the chosen stat.
			const usingAltStat = !!options.statOverride && options.statOverride !== rollType;
			const description = this.system?.description ?? "";
			// The signoff is appended LAST, below the ladder, rather than carried through the
			// rewrite: "XOXO, your GM" closes the letter, and a set of tier rows printed under
			// the signature would read as a postscript nobody wrote.
			const moveDescription = isStatChoice
				? filterStatOptionLines(description, options.statOverride)
				: description;
			const moveName = (isStatChoice || usingAltStat)
				? `${this.name} with ${options.statOverride.toUpperCase()}`
				: this.name;

			// Stamp the move's identity on the message so a chat-card handler can tell WHICH
			// move a roll card came from. The header text can't be trusted for this: an "ask"
			// or alt-stat roll renders as "Know Things with WIS". Stored under the base name.
			// Merged rather than assigned, so an existing producer (the attack flow) keeps its
			// own payload.
			const priorFlags = options.messageFlags ?? {};
			const messageFlags = {
				...priorFlags,
				[STONETOP_SCOPE]: { move: this.name, ...(priorFlags[STONETOP_SCOPE] ?? {}) },
			};

			// Never at a Loss defers the miss XP to a choice on the card, so a Know Things roll by
			// a character who owns it suppresses the automatic mark and carries the two buttons
			// instead. Null for everyone else, leaving the roll exactly as it was.
			const knowThings = isKnowThings(this.name) && actor?.type === "character"
				? knowThingsRollOptions(actor)
				: null;

			// "On a 10+, pick 2" needs something to pick. A move prints its options in its own
			// text, so they are made tickable exactly where they are printed — the same treatment
			// a non-rolling move's posted card gets, and ticks persist on the message either way.
			//
			// In PLACE, not lifted into the card's own checklist below the result: a move's list
			// is usually followed by more of its text (Clash's 7-9 line, Forage's note about
			// provisions), and cutting the list out of the middle leaves the sentence that
			// introduces it — "on a 10+, pick 2; on a 7-9, pick 1:" — pointing straight at
			// whatever came after. Thirteen of the twenty-nine shipped rolling moves with a list
			// read that way.
			//
			// Skipped for a move that names its own pool in `system.pickOptions` (love letters):
			// that pool renders as its own checklist, and a second list in the description would
			// start its data-index at 0 again and scramble the message's saved ticks.
			const declaredPicks = this.system?.pickOptions ?? [];
			const cardDescription = moveCardBody(moveDescription, this.system?.moveResults,
				{ pickable: !declaredPicks.length }) + signoff;

			if (stat) return rollStat(stat, actor, {
				...options,
				messageFlags,
				moveName,
				moveDescription: cardDescription,
				moveResults: this.system?.moveResults ?? null,
				// A love letter's shared pool — the rolled tier's moveResults.<tier>.pick says
				// how many of it to take.
				pickOptions: options.pickOptions ?? declaredPicks,
				// Moves that explicitly override the standard "+1 XP on a miss" (e.g. Danger
				// Sense, Hard to Kill / Death's Door rolls) set system.noXpOnMiss.
				noXpOnMiss:  this.system?.noXpOnMiss ?? false,
				// Last, so Never at a Loss's deferred-XP override beats the item's own default.
				...(knowThings ?? {}),
			});

			// Raw formula path — used by npcMove items. `cardDescription`, not the raw text, so
			// the last way a move can reach chat obeys the same rule as the other three: no
			// shipped NPC or monster move prints a list today, but a homebrew one that does gets
			// tickable options and a tally rather than bullets nobody can act on.
			return rollFormula(rawFormula, actor, { label: this.name, description: cardDescription });
		}
	};
}
