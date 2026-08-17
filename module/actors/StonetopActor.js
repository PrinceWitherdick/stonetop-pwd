import {StonetopCharacter} from "./character/StonetopCharacter.js";
import {StonetopSteading} from "./steading/StonetopSteading.js";
import {CharacterLedger} from "./character/CharacterLedger.js";
import {SteadingLedger} from "./steading/SteadingLedger.js";
import {NpcLedger} from "./npc/NpcLedger.js";
import {STAT_CHAT_LABELS, STEADING_STAT_CHAT_LABELS, postStatChangesToChat} from "../utils/chat.js";
import {isDefaultImg} from "../utils/strings.js";
import {PERSON_DEFAULT_IMG, isPersonPlaceholderImg} from "../utils/person-portrait.js";
import {tokenFollowsPortrait} from "../utils/portrait-token-frame.js";
import {GM_TOOLKIT_TYPE, theGmToolkit} from "./gmtoolkit/gm-toolkit-actor.js";

export function createStonetopActorClass(BaseActor) {
	return class StonetopActor extends BaseActor {
		_typedActor;

		/**
		 * Sidebar "Create Actor". Every kind of actor in Stonetop has a guided flow behind
		 * it — a player character walks its owner through the playbook picker and
		 * onboarding, a person is built from the steading's worksheet, a monster from the
		 * Book I "Dangers" worksheet — so instead of Foundry's name-and-type form (which
		 * only ever lands you on a blank sheet) we open our own chooser and hand off. See
		 * dialogs/create-actor-dialog.js.
		 *
		 * Two callers keep the stock dialog, reskinned:
		 * - an explicit `types` restriction (internal tooling), which is asking for a
		 *   specific sub-type rather than a flow; and
		 * - a create into a compendium (`pack`), since every flow above builds a WORLD
		 *   actor and would silently ignore the pack it was asked for.
		 *
		 * The reskin: core titles both window and button "Create Actor"; we reword them to
		 * "Create an Actor", tag the window with `.stonetop-themed` so the scoped core-window
		 * CSS (see window-theme.js / stonetop.css) applies (`classes` is concatenated with
		 * DialogV2's defaults, so this adds the class without dropping "dialog"), and drop
		 * the steading type — it's a world singleton, auto-created on ready and blocked from
		 * a second instance in preCreateActor (StonetopSingleton.js), so offering it in the
		 * dropdown is a dead end that only ever warns.
		 * @override
		 */
		static async createDialog(data = {}, createOptions = {}, options = {}, renderOptions = {}) {
			if (!options.types && !createOptions.pack) {
				const { openCreateActor } = await import("../dialogs/create-actor-dialog.js");
				return openCreateActor({ folder: data.folder ?? null, name: data.name ?? "" });
			}

			const title = game.i18n.localize("stonetop.actorCreate.title");
			options = {
				...options,
				classes: [...(options.classes ?? []), "stonetop-themed"],
				window: { ...(options.window ?? {}), title },
				ok: { ...(options.ok ?? {}), label: title },
			};
			if (!options.types) {
				// Monsters, NPCs and the GM Toolkit are GM content: players (who get Create-Actor
				// on fresh worlds) only ever make their own character, so keep all three out of a
				// non-GM's picker.
				const GM_ONLY_TYPES = new Set(["monster", "npc", GM_TOOLKIT_TYPE]);
				// The toolkit drops out the same way the steading does once the world HAS one:
				// both are singletons blocked in preCreateActor, so offering either is a dead end
				// that only ever warns. The difference is that the steading is auto-created on
				// every world and so is never offerable, while the toolkit can legitimately be
				// missing (a world whose launch predates the subtype), and there the picker is a
				// real way to make it.
				const haveToolkit = !!theGmToolkit();
				options.types = this.TYPES.filter(t =>
					t !== "stonetop"
					&& t !== CONST.BASE_DOCUMENT_TYPE
					&& !(t === GM_TOOLKIT_TYPE && haveToolkit)
					&& (game.user?.isGM || !GM_ONLY_TYPES.has(t)));
			}
			return super.createDialog(data, createOptions, options, renderOptions);
		}

		/**
		 * One default for a new character, two for a new NPC.
		 *
		 * A character's prototype token is LINKED. Foundry leaves `actorLink` false by
		 * default, which for a PC means every token dropped on a scene carries a private
		 * copy of the character in its ActorDelta — and the sheet a GM opens by
		 * double-clicking that token edits the copy, not the character. Gear handed over
		 * that way is real, and saves without complaint, but it exists only on that one
		 * token: the player opening their character from the sidebar sees nothing, so the
		 * whole thing reads as "the GM gave me a treasure and it never arrived". A PC is a
		 * single person the whole table shares, so the link is the only correct default.
		 * Only applied when the creation data didn't specify one, so a duplicate or an
		 * import that carries its own `prototypeToken.actorLink` is preserved.
		 *
		 * The NPC defaults below deliberately keep their tokens unlinked — a scene's
		 * townsfolk are placed many times over and each copy is its own creature.
		 *
		 * EVERY kind of actor reveals its name on hover to anyone. Foundry's own default is
		 * NONE — a nameless token — which leaves a table reading the map by portrait alone
		 * and asking out loud which of the three villagers is which. NPCs got this first
		 * because they are the townsfolk the PCs talk to, but a PC's own token, a follower's
		 * and a creature's all answer the same question for the same reason, and a rule that
		 * held for one kind of token and not the others was a difference nobody at the table
		 * could see a reason for.
		 *
		 * ⚠ A creature's name is a SPOILER a nameplate now gives away — hovering an unknown
		 * horror reads its name off the map. That is the GM's call to make per token, and
		 * Foundry already gives them the controls: hide the token, or set its display mode.
		 * This only moves the default.
		 *
		 * Only applied when the creation data didn't specify a display mode, so a deliberate
		 * choice, a duplicate, or a compendium import that carries its own
		 * `prototypeToken.displayName` is preserved.
		 *
		 * An NPC with no portrait wears the system's people silhouette instead of Foundry's
		 * mystery-man. The steading roster already drew that placeholder for un-portraited
		 * members, but only there: everywhere else the same person showed up — the sidebar
		 * directory, a drag preview, a chat portrait — Foundry's default leaked through.
		 * Storing it on the actor makes every surface agree without each having to know the
		 * rule. It stays a placeholder, not art: isDefaultImg reports it as "no art" (see
		 * utils/person-portrait.js), so nothing starts treating this person as portraited.
		 * Only ever applied over a stock default, so chosen art is never touched.
		 * @override
		 */
		async _preCreate(data, options, user) {
			const allowed = await super._preCreate(data, options, user);
			if (allowed === false) return false;
			// Collected and applied in ONE updateSource at the end. Each call is its own diff and
			// validation pass over the whole document, so a character creating with two of them paid
			// twice for one decision — and a bestiary bulk import pays that per creature, a hundred
			// at a time.
			const patch = {};
			// Not per-type: a character, an NPC, a creature and the steading all get a name on
			// hover. The steading is a place nobody drags onto a scene, so for it this is a no-op
			// rather than an exception worth writing down — and if somebody ever does place it, a
			// nameplate is the right answer.
			if (foundry.utils.getProperty(data, "prototypeToken.displayName") === undefined) {
				patch["prototypeToken.displayName"] = CONST.TOKEN_DISPLAY_MODES.HOVER;
			}
			if (this.type === "character"
				&& foundry.utils.getProperty(data, "prototypeToken.actorLink") === undefined) {
				patch["prototypeToken.actorLink"] = true;
			}
			if (this.type === "npc" && isDefaultImg(this.img) && !isPersonPlaceholderImg(this.img)) {
				patch.img = PERSON_DEFAULT_IMG;
			}
			// The GM Toolkit is the GM's own sheet, so no player should even see that it exists.
			// A world Actor is broadcast to every client and `ownership` is what gates the UI, so
			// this is where "GM only" has to be said. Foundry's own default for a new document is
			// already NONE, but that is a default a later core change or a module could move; the
			// toolkit is not a thing to find out about by accident. Only stamped when the creator
			// said nothing, so a GM who deliberately shares one keeps their choice.
			//
			// No PER-USER ownership entry beside it, deliberately. One would only make sense if
			// "whose toolkit is this" were a question worth asking, and it is not: the toolkit is
			// a world singleton (hooks/StonetopSingleton.js), so every GM shares the one sheet.
			// Recording a creator here would be a field nothing reads, sitting exactly where a
			// later reader would take it for a permission that matters.
			if (this.type === GM_TOOLKIT_TYPE
				&& foundry.utils.getProperty(data, "ownership.default") === undefined) {
				patch["ownership.default"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
			}
			if (Object.keys(patch).length) this.updateSource(patch);
		}

		get typedActor() {
			if (this._typedActor) return this._typedActor;

			const customType = this.system?.customType;
			switch (customType || this.type) {
				case "character":
					this._typedActor = StonetopCharacter.create(this);
					break;
				case "stonetop":
					this._typedActor = new StonetopSteading(this);
					break;
			}

			return this._typedActor;
		}

		// Backward-compat: world actors created with the PBTA module used
		// type="other" with system.customType="stonetop" for the steading.
		// The sheet registry looks up by type, so intercept _getSheetClass
		// to return the steading sheet for these legacy actors.
		_getSheetClass() {
			if (this.system?.customType === "stonetop") {
				const cls = CONFIG.Actor.sheetClasses?.stonetop?.["stonetop.StonetopSteadingSheet"]?.cls;
				if (cls) return cls;
			}
			return super._getSheetClass();
		}

		/**
		 * Keep the prototype token's picture in step with the portrait.
		 *
		 * `actor.img` and `prototypeToken.texture.src` are two separate images, and Foundry only
		 * ever fills the second at creation, from the stock default. So choosing a face on the
		 * sheet gave a person a face everywhere EXCEPT the map: drag them onto a scene and the
		 * mystery-man was back.
		 *
		 * WHICH tokens follow is `tokenFollowsPortrait` (utils/portrait-token-frame.js): a stock
		 * placeholder, the very portrait this update is replacing, or one of our own baked crops.
		 * Anything else is a deliberate choice and is left exactly where it is. That rule is
		 * written down once and shared with the framing side, so the sheet and the map cannot come
		 * to disagree about whose token is ours to move.
		 *
		 * WITHOUT ITS FOURTH STATE, though, and that is the one difference between the two sides.
		 * A token wearing the art pipeline's own hand-framed square is fair game for a re-FRAME,
		 * which puts another square there and remembers the one it displaced; it is not fair game
		 * here, where the replacement would be the uncropped picture and nothing would be
		 * remembered. That is a bestiary creature's normal resting state — portrait the whole
		 * illustration, token a `-t<rect>` square cut from it — so treating it as "following"
		 * would throw the square away on any write that so much as touches `img`.
		 *
		 * Folded into the SAME update rather than written after it, so the two pictures cannot be
		 * seen apart and one write cannot land without the other.
		 *
		 * No `fit`: the default ("contain") never crops a face out of frame, and the common case
		 * — a People of Stonetop square in a square token — looks identical either way. That is a
		 * separate aesthetic call from "the token should be this person".
		 */
		_syncPrototypeTokenImage(changed) {
			// The steading is a place, and nobody drags it onto a scene.
			if (this.type === "stonetop" || this.system?.customType === "stonetop") return;
			const next = changed?.img;
			if (next === undefined) return;
			// Never argue with a token image the same update is setting explicitly, in either
			// shape an update can arrive in.
			if (changed["prototypeToken.texture.src"] !== undefined) return;
			if (foundry.utils.getProperty(changed, "prototypeToken.texture.src") !== undefined) return;
			if (!tokenFollowsPortrait(this, { pipelineSquare: false })) return;
			changed["prototypeToken.texture.src"] = next;
		}

		async _preUpdate(changed, options, user) {
			const result = await super._preUpdate(changed, options, user);
			this._syncPrototypeTokenImage(changed);
			if (!options?.stonetopLedger) {
				if (this.type === "character") {
					options.stonetopLedgerEntries = this._tagLedgerMove(await CharacterLedger.entriesForActorUpdate(this, changed), options);
					options.stonetopStatChanges = this._collectStatChanges(changed, STAT_CHAT_LABELS);
				} else if (this.type === "stonetop" || this.system?.customType === "stonetop") {
					options.stonetopLedgerEntries = this._tagLedgerMove(SteadingLedger.entriesForActorUpdate(this, changed), options);
					options.stonetopStatChanges = this._collectStatChanges(changed, STEADING_STAT_CHAT_LABELS);
				} else if (this.type === "npc") {
					options.stonetopLedgerEntries = this._tagLedgerMove(NpcLedger.entriesForActorUpdate(this, changed), options);
				}
			}
			return result;
		}

		/**
		 * Attribute ledger entries to the move that caused them. When an update is the
		 * automated effect of a move (the caller passes `options.stonetopMove`), stamp
		 * each generated entry with that move's name so the ledger can show "via <move>".
		 */
		_tagLedgerMove(entries, options) {
			const moveName = options?.stonetopMove;
			if (moveName) for (const entry of entries) entry.move = moveName;
			return entries;
		}

		/**
		 * Diff the incoming update against current values for the watched stats.
		 * @param {object} changed  The incoming update (nested or dot-path shape).
		 * @param {Record<string,string>} labels  Stat path → chat label map for this actor type.
		 */
		_collectStatChanges(changed, labels) {
			// Most updates (HP, XP, debilities, flags…) never touch the watched stats,
			// so skip the flatten unless this one could. Covers both update shapes:
			// nested ({system:{stats}}) and dot-path ({"system.stats.str.value"}).
			const groups = [...new Set(Object.keys(labels).map(p => p.split(".").slice(0, 2).join(".")))];
			const couldTouchStats = groups.some(group =>
				foundry.utils.getProperty(changed, group) !== undefined
				|| Object.keys(changed).some(k => k.startsWith(`${group}.`)));
			if (!couldTouchStats) return [];

			const flat = foundry.utils.flattenObject(changed);
			const changes = [];
			for (const [path, label] of Object.entries(labels)) {
				if (!(path in flat)) continue;
				const oldValue = foundry.utils.getProperty(this, path);
				const newValue = flat[path];
				if (oldValue !== newValue) changes.push({ label, oldValue, newValue });
			}
			return changes;
		}

		async _onUpdate(changed, options, userId) {
			await super._onUpdate(changed, options, userId);
			if (options?.stonetopLedger) return;
			// _onUpdate fires on EVERY connected client. The follow-up writes below
			// (ledger append) and the chat posts must run exactly once, on the client
			// of the user who made the change — that user holds the permission to write
			// back. Running on other clients duplicates the ledger entry and throws a
			// "lacks permission to update Actor" error for anyone who doesn't own it.
			if (userId !== globalThis.game?.user?.id) return;
			if (this.type === "character") {
				await CharacterLedger.append(this, options.stonetopLedgerEntries ?? [], { userId });
			} else if (this.type === "stonetop" || this.system?.customType === "stonetop") {
				await SteadingLedger.append(this, options.stonetopLedgerEntries ?? [], { userId });
			} else if (this.type === "npc") {
				// NPCs have no watched stats to echo to chat, so append and stop here.
				await NpcLedger.append(this, options.stonetopLedgerEntries ?? [], { userId });
				return;
			} else {
				return;
			}
			postStatChangesToChat(this, options.stonetopStatChanges ?? []);
		}

		async _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
			await super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
			// Runs on every client; only the author writes back (ledger append + the
			// playbook HP/damage/starting-moves init in the typed actor). Other clients
			// would duplicate the ledger and hit a permission error on a foreign actor.
			if (userId !== globalThis.game?.user?.id) return;
			// The ledger's own kill switch, honoured here as well as in _preUpdate/_onUpdate: an
			// automated write is a real change to the actor but it is not news anybody typed, and
			// a caller that has said so about the fields must be believed about the items too —
			// otherwise a follower card renamed on a character sheet still appends "Move added:"
			// to its NPC. Scoped to the LEDGER alone: the playbook init below is the write itself
			// and must run either way.
			const silent = !!options?.stonetopLedger;
			if (this.typedActor?.type === "character" && collection === "items") {
				await Promise.all([
					silent ? null : CharacterLedger.append(this, CharacterLedger.entriesForCreatedItems(documents), { userId }),
					this.typedActor._onCreateDescendantDocuments(documents),
				]);
			} else if (this.type === "npc" && collection === "items" && !silent) {
				await NpcLedger.append(this, NpcLedger.entriesForCreatedItems(documents), { userId });
			}
		}

		async _onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId) {
			await super._onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId);
			// Only the author appends to the ledger; other clients lack permission on a
			// foreign actor and would duplicate the entry.
			if (userId !== globalThis.game?.user?.id) return;
			// An automated removal is not news anybody typed — see _onCreateDescendantDocuments.
			// A plain return here, since appending is all this hook does.
			if (options?.stonetopLedger) return;
			if (this.type === "character" && collection === "items") {
				await CharacterLedger.append(this, CharacterLedger.entriesForDeletedItems(documents), { userId });
			} else if (this.type === "npc" && collection === "items") {
				await NpcLedger.append(this, NpcLedger.entriesForDeletedItems(documents), { userId });
			}
		}
	};
}
