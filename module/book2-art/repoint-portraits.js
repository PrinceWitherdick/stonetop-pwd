import { basenameOf as basename, portraitRectOf } from "./people-portraits.js";
import { book2ArtPrefix, book2ArtRoot, book2ArtServedWith } from "./art-root.js";
import { isValidFrame, sameSrc } from "../utils/portrait-frame.js";
import { SYSTEM_ID } from "../system-id.js";
import { getObjectSetting } from "../settings.js";
import { isDefaultImg } from "../utils/strings.js";
import { updatePlacedTokens } from "../utils/placed-tokens.js";

/**
 * Put a person's portrait on the WHOLE illustration and make the hand-chosen square a frame over
 * it — the layout a bestiary creature has always used, now shared.
 *
 * WHAT CHANGED AND WHY. The square face was originally cut to its own file and `actor.img` pointed
 * at it, because every surface that shows a person is small and round and they all already read
 * `.img`: zero per-surface work. The cost only showed up on the map. A module that reads
 * `actor.img` — Image Hover and friends — has no way to know a square is a crop of something, so
 * hovering a token gave back the same small face instead of the artist's standing figure, while
 * the very same hover on a MONSTER gave the whole composition. Same gesture, two answers.
 *
 * The square is no longer needed as a FILE to get a face onto those small surfaces: the portrait
 * frame (utils/portrait-frame.js) crops with CSS from a rect, every one of those surfaces already
 * renders `resolvePortrait`, and the rect this pipeline chose by hand is sitting in the square's
 * own filename. So the three writes below are one move, not three:
 *
 *     img                        -> the whole person illustration      (what a module sees)
 *     flags.<system>.portraitFrame -> { src: <that>, rect: <the -q rect> }  (what a surface crops to)
 *     prototypeToken.texture.src -> the square file                    (what the map draws)
 *
 * Nothing on screen moves. The sheet header, the roster circle, the relationship heart and the
 * follower card all painted the square before and paint the same square now, through CSS instead
 * of through a filename; the token keeps the very file it already had. What changes is that the
 * whole picture is finally reachable from the document, by anyone, without the manifest.
 *
 * THE TOKEN KEEPS THE FILE rather than becoming a frame too, exactly as monster-tokens.js explains:
 * the canvas draws a token straight from `texture.src` and Foundry's token texture carries no crop
 * rect, so a square that has to be seen on the map has to exist as a file. Which also means the
 * pass cannot stop at `prototypeToken`: a token already standing on a scene carries its own copy,
 * so the villagers already placed are followed too (see repointPlacedPortraitTokens).
 *
 * NPCs and follower cards, and nothing else: see FLIPS_OWN_PORTRAIT below for who is left out and
 * why. The pass rewrites documents the GM owns, so its reach is stated rather than implied.
 *
 * Idempotent by construction, which is this codebase's convention for a migration (see the
 * `_migrate*` passes in hooks/Ready.js): every write is computed from the resolved art rather than
 * from the input, so a portrait already in the target layout produces an empty update and drops
 * out of the plan. No version flag, and a world that lands here from EITHER direction — a portrait
 * still on the whole illustration, or one an earlier build already moved onto the square —
 * converges on the same three values.
 */

// The package id, from the one module that owns it. These are not just a settings namespace:
// the flag UPDATE PATHS below are built from it, so a hand-written copy is a place the rename
// codemod would have to know about by name. Same use, same import, as poster-maps.js.
const SYSTEM = SYSTEM_ID;

/**
 * Follower portraits live in flags, not on a document field: a card's art is
 * `flags.stonetop-pwd.customFollowers.<id>.img`, with its frame beside it at `.portraitFrame`
 * (utils/portrait-frame-handles.js owns that pairing). Today that is the ONE store — every
 * follower kind (custom, recruited NPC, monster-derived) lands there. Walking for the `img` key
 * rather than reading that one path is a small bet that a later follower kind nests differently
 * and would otherwise be silently missed; the walk is over our own namespace only, so it cannot
 * wander into another module's data.
 *
 * THREE BOUNDARIES a reader needs, because the walk looks more exhaustive than it is:
 *
 *  • ARRAYS ARE NOT VISITED, deliberately. The steading's `residents`/`neighbors` flags and the
 *    follower ROSTERS (actors/character/roster-portraits.js) are arrays whose rows can carry an
 *    `img`. Legacy steading rows are on their way out — steading-people.js migrates them into real
 *    NPC Actors, which this pass re-points directly. A roster member is a 26px disc that is never
 *    a token and never hovered on a map, so it has nothing to gain here; left alone it keeps
 *    showing the square file it shows today, which `resolvePortrait` renders unframed exactly as
 *    before. Neither is a regression, and descending into arrays would mean rewriting a whole
 *    array per row (they are atomic to mergeObject) for no visible gain.
 *
 *  • A FRAME IS NEVER OVERWRITTEN. `portraitFrame` holds `{src, rect}` and carries no `img` key,
 *    so the walk cannot descend into one and mistake a frame's own fields for a portrait. What it
 *    must also not do is replace a frame somebody CHOSE with the pipeline's default square, which
 *    is why the seed is guarded on the sibling being absent or unusable.
 *
 *  • A CYCLE is the case that bites, which is why `seen` exists rather than depth alone.
 *    Following one does not merely spin, it mints a fresh update path at every lap
 *    (`…self.self.img`), and those are keys Foundry would happily CREATE — so a cyclic flag
 *    object would have this pass write nested junk into the document it was cleaning up.
 *    Visiting each object once is the real guard; the depth cap is a backstop for nesting
 *    that is pathological without being cyclic.
 */
const MAX_FLAG_DEPTH = 6;

function collectFlagImgPaths(node, prefix, resolve, out, depth = 0, seen = new Set()) {
	if (!node || typeof node !== "object" || Array.isArray(node) || depth > MAX_FLAG_DEPTH) return;
	if (seen.has(node)) return;
	seen.add(node);
	for (const [key, value] of Object.entries(node)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (key === "img" && typeof value === "string") {
			const art = resolve(value);
			// The frame is a SIBLING of the img, so its path is this node's, not this key's. It
			// comes back whole rather than as a yes/no: a stale STAMP on an otherwise good frame
			// is repaired below, and that repair has to keep the rect it finds.
			if (art) out.push({ path, from: value, art, framePath: prefix ? `${prefix}.portraitFrame` : "portraitFrame", frame: node.portraitFrame ?? null });
		} else if (value && typeof value === "object") {
			collectFlagImgPaths(value, path, resolve, out, depth + 1, seen);
		}
	}
}

/**
 * WHOSE portrait field this pass is allowed to move, and why it is not everyone's.
 *
 * An NPC is the whole point: it is the actor that wears People-of-Stonetop art and the one that
 * gets dragged onto a scene as a token. A PC's portrait gets a whole sheet panel rather than a
 * small round surface, and a GM who browsed a People file for one has chosen a picture rather than
 * accepted a default — so a PC is left where it is, as it always has been here. Monsters have
 * their own bestiary art (which already lives in this layout) and the steading actor wears the
 * Book I stone, so neither has a stake.
 *
 * FLAGS ARE NOT GATED, deliberately — that is where follower cards live, and they live on the PC.
 * A follower card is exactly the small round surface the square exists for, so the walk below runs
 * on every actor; it is only the actor's OWN portrait that is limited to the type that wants one.
 */
const FLIPS_OWN_PORTRAIT = new Set(["npc"]);

/**
 * Is this token showing the picture its portrait shows, in any of the spellings that can mean it?
 *
 * The token moves onto the square only if it was FOLLOWING — a GM who gave this NPC different
 * token art chose that, and a portrait rearrangement is no reason to overrule it. All three
 * spellings are genuinely reachable: the stored img (whichever of the pair it currently is), the
 * whole illustration, and the square itself, which is both the target and the state a world that
 * has already run this pass is in.
 */
const tokenIsFollowing = (tokenSrc, img, art) =>
	sameSrc(tokenSrc, img) || sameSrc(tokenSrc, art.whole) || sameSrc(tokenSrc, art.square);

/**
 * What the flip would change, without changing any of it. Pure: takes plain objects, so it is
 * testable without Foundry and the caller can count the work before offering to do it.
 *
 * `resolve` maps any stored path — whole illustration OR square — to `{whole, square, rect}`, or
 * null. Inject it so a test can describe a library without a manifest or a settings store.
 */
export function planPeoplePortraitFlips(actors, resolve = null) {
	const resolver = resolve ?? peopleArtResolver();
	// No resolver means this world has no extracted people art at all (see peopleArtResolver), so
	// every lookup below would be a guaranteed miss. Answered before the walk rather than inside
	// it: this pass runs on every load, and the walk it skips is every actor in the world plus the
	// whole of each one's flag graph.
	if (!resolver) return [];
	const plan = [];
	for (const actor of actors ?? []) {
		const updates = {};
		const notes = [];
		const art = (FLIPS_OWN_PORTRAIT.has(actor?.type) && actor?.img) ? resolver(actor.img) : null;

		// Every portrait field this actor moves, as one list, so the RULE below is written once.
		// They differ only in where the two halves are stored: an actor's own portrait is a
		// document field whose frame lives in flags, while a follower card keeps its `img` and its
		// `portraitFrame` side by side under one flag node. `note` paths stay human-readable — the
		// caller reports them — while `key` paths are what the update is actually keyed on.
		const fields = [];
		if (art) {
			fields.push({
				from: actor.img, art,
				frame: actor.flags?.[SYSTEM]?.portraitFrame ?? null,
				imgKey: "img",                                 imgNote: "img",
				frameKey: `flags.${SYSTEM}.portraitFrame`,     frameNote: "portraitFrame",
			});
		}
		const flagHits = [];
		collectFlagImgPaths(actor?.flags?.[SYSTEM], "", resolver, flagHits);
		for (const hit of flagHits) {
			fields.push({
				from: hit.from, art: hit.art, frame: hit.frame,
				imgKey: `flags.${SYSTEM}.${hit.path}`,         imgNote: hit.path,
				frameKey: `flags.${SYSTEM}.${hit.framePath}`,  frameNote: hit.framePath,
			});
		}

		for (const f of fields) {
			if (!sameSrc(f.from, f.art.whole)) {
				updates[f.imgKey] = f.art.whole;
				notes.push({ path: f.imgNote, from: f.from, to: f.art.whole });
			}
			// Seeded only into a vacancy. A frame somebody chose IS the answer to "which square do
			// the small surfaces show", and the pipeline's default must not silently replace it.
			if (!isValidFrame(f.frame)) {
				const seed = { src: f.art.whole, rect: f.art.rect };
				updates[f.frameKey] = seed;
				notes.push({ path: f.frameNote, from: null, to: seed });
			} else if (basename(f.frame.src) === basename(f.art.whole) && !sameSrc(f.frame.src, f.art.whole)) {
				// KEPT, BUT RE-STAMPED. A frame carries the path it was measured on, and every
				// surface checks that stamp against the picture actually being shown; the two stop
				// agreeing the moment this pass re-spells `img` to the path the host really serves
				// (the Forge repair peopleArtResolver exists for). The rect is still right — same
				// picture — so leaving the old spelling behind would drop a crop somebody authored
				// back to the blind top slice of a standing figure, silently, on every surface at
				// once.
				//
				// A RE-SPELLING ONLY, which is what the basename test buys. A frame stamped with
				// the SQUARE has a rect in the square's own coordinates, and moving that stamp to
				// the whole illustration would not repair it — it would re-aim it at a completely
				// different part of a completely different picture. Those are left alone.
				const restamped = { src: f.art.whole, rect: f.frame.rect };
				updates[f.frameKey] = restamped;
				notes.push({ path: f.frameNote, from: f.frame.src, to: restamped });
			}
		}

		// The token is the actor's alone — a follower card has none — so it stays outside the loop
		// rather than becoming a field every entry has to carry as null.
		if (art) {
			const tokenSrc = actor.prototypeToken?.texture?.src;
			// Ours to point at the square: one of the three spellings of this portrait, or a stock
			// placeholder, which has nothing to lose and would otherwise be the one villager on the
			// map still wearing mystery-man.
			const ours = tokenSrc !== undefined
				&& (tokenIsFollowing(tokenSrc, actor.img, art) || isDefaultImg(tokenSrc));
			if (ours && !sameSrc(tokenSrc, art.square)) {
				updates["prototypeToken.texture.src"] = art.square;
				notes.push({ path: "prototypeToken.texture.src", from: tokenSrc, to: art.square });
			} else if (tokenSrc !== undefined && updates.img !== undefined) {
				// NAMED ANYWAY, at the value it already holds, whenever this update moves `img`.
				// StonetopActor#_syncPrototypeTokenImage fills an UNNAMED token key in from the new
				// portrait whenever the token reads as following the old one — and a token already
				// showing the square is doing exactly that, since the square is what `actor.img`
				// still says. So the state this pass converges ON is the state that would get
				// dragged onto the tall book illustration, which is the one outcome the whole
				// rearrangement exists to prevent. The same goes for a crop a GM baked.
				//
				// Naming the key stands that sync down (it declines to argue with an update that
				// sets the token itself). Re-writing the value already there is otherwise a no-op,
				// and it is deliberately not a `note`: nothing moved, so nothing is reported, and
				// a world already in the target layout still plans no work at all.
				updates["prototypeToken.texture.src"] = tokenSrc;
			}
		}
		if (notes.length) plan.push({ actor, updates, changes: notes });
	}
	return plan;
}

/**
 * A resolver that only ever names files THAT ARE ON DISK, at the paths this host serves them from.
 *
 * The manifest knows every square that has been authored; the `peoplePortraitArt` index knows
 * which of them the GM has actually extracted. Working from the manifest alone would leave a
 * broken image on any world that has not run the rebuild — the one thing worse than a portrait
 * cropped badly is a portrait that does not load. A person whose square was never cut resolves to
 * nothing and is left exactly as it is: there is no square to put on the token and no rect to
 * frame with, so there is nothing this pass could honestly do for them.
 *
 * It answers for THREE shapes of stored path, because on a hosted setup they are the same repair:
 *
 *  • an ILLUSTRATION, which gains a frame and a square token — the move this pass exists for;
 *  • a SQUARE, which an earlier build put on `img` and which now goes back to being the token and
 *    the frame's rect; and
 *  • either of those in a spelling that no longer resolves. A world that wired its art before it
 *    knew where the host actually served it from holds bare `stonetop-book-art/…` paths that 404
 *    on The Forge, and nothing else would ever move them: the gallery only writes a portrait when
 *    someone picks a face again.
 *
 * Idempotent either way, which is what lets this stay a flagless migration: the answer is built
 * from the index rather than from the input, so a portrait already on the served illustration
 * resolves to the string it already holds and the planner reports nothing to do.
 *
 * NULL, not an always-missing resolver, when the index names nothing this pass can act on — an
 * empty `peoplePortraitArt` (every world whose GM has not run the art rebuild) or rows whose
 * square names carry no rect. That is a load-bearing distinction rather than a nicety: this pass
 * runs on every startup, and the caller reads null as "no work is possible here" and skips walking
 * every actor and every flag on them to reach the same answer one lookup at a time.
 */
export function peopleArtResolver() {
	const index = getObjectSetting("peoplePortraitArt");
	// Hoisted alongside the index, and for the same reason: the resolver runs once per `img` on
	// every world actor plus every follower flag, and neither the root nor the host prefix can
	// change while it does. Read inside, `book2ArtSrc` would be two `game.settings.get` calls per
	// match — the convention reapply.js states for its own per-row loop.
	const root = book2ArtRoot();
	const prefix = book2ArtPrefix();
	// basename -> the row reachable from either end of the pair. Keying on the file rather than the
	// path is what keeps this root- AND host-agnostic, exactly as people-portraits.js does; slugs
	// are unique, so a basename identifies a row on its own.
	const rowOf = new Map();
	for (const [out, portraitOut] of Object.entries(index ?? {})) {
		if (!out || !portraitOut) continue;
		// The rect lives ONLY in the square's filename, so a row whose name does not carry one is
		// not a row this pass can act on — better to leave that portrait alone than to frame it
		// with a guess.
		const rect = portraitRectOf(portraitOut);
		if (!rect) continue;
		rowOf.set(basename(out), [out, out, portraitOut, rect]);                     // from the illustration
		rowOf.set(basename(portraitOut), [portraitOut, out, portraitOut, rect]);     // from the square
	}
	if (!rowOf.size) return null;
	return (src) => {
		if (!src) return null;
		const hit = rowOf.get(basename(src));
		if (!hit) return null;
		const [matched, out, portraitOut, rect] = hit;
		// The basename found a CANDIDATE row; this confirms the file is actually the book art that
		// row names, by requiring the row's whole in-root path (`assets/people/x.webp`) to be a tail
		// of the source. Root- and host-agnostic exactly as the basename key is — every root and
		// every host prefix sits in FRONT of that tail — but it no longer answers for a file that
		// merely shares a name. A GM's own `worlds/mine/art/aeronwen.webp` would otherwise be
		// bulk-rewritten to a different picture in a different directory, with no undo.
		const s = String(src);
		if (s !== matched && !s.endsWith(`/${matched}`)) return null;
		return {
			whole: book2ArtServedWith(root, out, prefix),
			square: book2ArtServedWith(root, portraitOut, prefix),
			rect,
		};
	};
}

/**
 * And the villagers ALREADY STANDING ON SCENES.
 *
 * A TokenDocument copies `texture.src` out of the prototype at the moment it is placed and never
 * looks at it again, so a pass that stops at `prototypeToken` fixes the next person dragged out
 * and leaves a laid-out village drawing the tall book illustration inside every square token,
 * forever — with no way back but deleting and re-dragging each one. The two startup sweeps either
 * side of this one (`_migrateTokenNameplates`, `_migrateShootMarker`) and the crop re-point in
 * utils/portrait-token-frame.js all make the same close, through the same helper.
 *
 * Only the actors whose prototype ACTUALLY moved, and only the tokens still showing what it was
 * showing: anything else on that scene is a per-token choice, and a rearrangement of the portrait
 * fields is no reason to overrule one. `sameSrc`, so a token placed under an older cache-buster
 * still matches the picture it was placed from.
 *
 * Best-effort per scene (see utils/placed-tokens.js): the documents are already saved and the
 * whole pass is idempotent, so a scene this user may not write to is picked up on the next load
 * rather than failing the sweep.
 */
async function repointPlacedPortraitTokens(done) {
	const moved = new Map();
	for (const item of done) {
		const note = item.changes.find((c) => c.path === "prototypeToken.texture.src");
		if (note && item.actor?.id) moved.set(item.actor.id, note);
	}
	if (!moved.size) return 0;
	return updatePlacedTokens(
		(t) => {
			const note = moved.get(t.actorId);
			return !!note && sameSrc(t.texture?.src, note.from);
		},
		(t) => ({ "texture.src": moved.get(t.actorId).to }),
		{ what: "move" },
	);
}

/**
 * Do it — in ONE write where possible, falling back to one write per actor.
 *
 * The plan comes from every actor in the world, and on the upgrade this feature exists for (a
 * GM who populated the steading roster before squares existed) that is tens of them. One awaited
 * `update()` apiece is a server round trip AND a world-wide `updateActor` broadcast apiece, each
 * of which re-renders the Actors sidebar and any open sheet on every connected client. The
 * batched form is one of each — the same move, for the same reason, that the journal baseline
 * stamps make in hooks/SeedCompendiums.js.
 *
 * The per-actor loop stays as the FALLBACK, because it is what makes a partial pass honest: a
 * bulk call is all-or-nothing, so if one actor is unwritable (a permission, a locked copy) the
 * batch rejects and this walks them individually to save everything that can be saved. Either
 * way re-running picks up the remainder, since everything already flipped no longer matches.
 */
export async function flipPeoplePortraitsToWhole({ actors = null, resolve = null } = {}) {
	const pool = actors ?? globalThis.game?.actors?.contents ?? [];
	// The planner builds the default resolver itself, and reads a null one as "nothing extracted
	// on this world" — so an empty plan here costs one settings read rather than a world walk.
	const plan = planPeoplePortraitFlips(pool, resolve);
	const result = { updated: 0, failed: 0, changes: 0, total: plan.length, placed: 0 };
	if (!plan.length) return result;

	// Which actors actually landed, so the scene pass below only follows prototypes that really
	// moved — a bulk rejection must not have it repoint tokens whose actors were never written.
	const done = [];
	const bulk = globalThis.Actor?.updateDocuments;
	if (bulk && plan.every((item) => item.actor?.id)) {
		try {
			await bulk.call(Actor, plan.map((item) => ({ _id: item.actor.id, ...item.updates })));
			result.updated = plan.length;
			result.changes = plan.reduce((n, item) => n + item.changes.length, 0);
			done.push(...plan);
		} catch (err) {
			console.warn("Stonetop | bulk portrait flip failed; retrying one actor at a time:", err);
		}
	}

	if (!done.length) {
		for (const item of plan) {
			try {
				await item.actor.update(item.updates);
				result.updated++;
				result.changes += item.changes.length;
				done.push(item);
			} catch (err) {
				result.failed++;
				console.warn(`Stonetop | could not move portraits on ${item.actor?.name}:`, err);
			}
		}
	}

	result.placed = await repointPlacedPortraitTokens(done);
	return result;
}
