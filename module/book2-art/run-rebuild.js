import { rebuildBookArt, plannedBookArtRebuilds } from "./rebuild-crops.js";
import { publishPeopleArtIndexes, reapplyBook2Art } from "./reapply.js";
import { flipPeoplePortraitsToWhole } from "./repoint-portraits.js";

/**
 * Cut every picture this world could have from the art it already holds, then point what is
 * already in play at it. The one path all three entry points take.
 *
 * Three kinds of cut, all the same operation on different rects: the detail portraits carved out
 * of a multi-figure drawing, the square faces an NPC's token stands on, and the square a
 * creature's prototype token stands on. They share a run because they share a cause — a GM who
 * imported before any of them existed holds every source file and none of the results — and
 * because two chat cards asking the same favour is one too many.
 *
 * There are three because ONE was not enough. The offer is a whispered chat card, and
 * offer-once.js latches its flag the moment that card is POSTED — not when it is clicked, which
 * is deliberate (a GM who says yes and then hits an error must not be re-asked the whole
 * question). The cost of that is a card scrolled past, deleted, or landing on whichever of two
 * GMs happened to be primary is a card gone for good. For the crop rebuild that only ever meant
 * missing a nicety. For squares it means upgrading, seeing nothing change, and having no way to
 * ask again — so the work is also reachable from the Welcome guide's Book Art step and from
 * `game.stonetop.rebuildPortraits()`.
 *
 * Safe to run repeatedly by construction: every stage re-plans against what is on disk, so a
 * second run cuts only what is genuinely missing and re-points only what has not moved yet.
 */
export async function runBookArtRebuild({ onProgress = null } = {}) {
	const art = await rebuildBookArt({ onProgress });
	// Publishes peopleArt AND peoplePortraitArt from what just landed. Has to happen between the
	// two: the re-point reads the square index to know which squares actually exist, and would
	// otherwise point portraits at files this run only just created and has not indexed yet.
	await publishPeopleArtIndexes();
	let repointed = 0;
	try {
		repointed = (await flipPeoplePortraitsToWhole()).changes;
	} catch (err) {
		// Never fails the rebuild. The files are cut and the gallery works either way, and
		// running again retries this half on its own.
		console.error("Stonetop | could not re-point existing portraits:", err);
	}
	let tokens = 0;
	try {
		// The creature half of the re-point, through reapply rather than a dedicated helper: a
		// monster token is a plain document field on an actor seeded from the compendium, and
		// reapply already owns every rule about when it is safe to touch one (ours or a
		// placeholder, never a portrait the group chose).
		//
		// Without it a GM would cut 73 token squares, see nothing change, and only get their tokens
		// on the next world load, when the every-load self-heal would do exactly this.
		//
		// The COMPENDIUM half runs too, but only when this run actually cut creature squares.
		// `worldOnly` skips the compendium, and for the people passes that is right — a person
		// wires to no document. A creature does: its compendium actor is what a GM drags onto the
		// map, and the world copies SeedActors makes are minted from it. Leaving it behind means
		// every token dragged out after a rebuild still gets the whole illustration, until the next
		// system update happens to run the version pass. It is the expensive half (a getDocument
		// per creature plus the journal pages), so it is paid only on the one run that changes what
		// those documents should point at, and never on a people-only rebuild.
		//
		// `worldTokens`, NOT `worldActors`: that pass writes an actor for several reasons (a
		// portrait re-point onto a moved path, a stale reset) and only some of them are a token
		// taking up its square. Counting all of them told a GM whose manifest names no squares at
		// all that 73 creatures now use one. `quiet` because describeRebuild speaks for the run.
		//
		// `cheapWorldSkip` because this is a re-apply, not a first apply: every row whose art is
		// already embedded in every matching world entry is settled, and the pass would otherwise
		// pay a compendium read per row to confirm it. The rows this run actually changed are
		// exactly the ones that are NOT settled, so they are still read and still written.
		const cutTokens = (art?.tokensPlanned ?? 0) > 0;
		tokens = (await reapplyBook2Art({
			worldOnly: !cutTokens, cheapWorldSkip: true, quiet: true,
		}))?.worldTokens ?? 0;
	} catch (err) {
		console.error("Stonetop | could not re-point existing creature tokens:", err);
	}
	return { ...art, repointed, tokens };
}

/** How much there is to do, without doing any of it. Drives whether an entry point offers at all. */
export async function countBookArtRebuilds() {
	try {
		return (await plannedBookArtRebuilds()).length;
	} catch (err) {
		console.error("Stonetop | could not count rebuildable book art:", err);
		return 0;
	}
}

const SPINNER = '<i class="fas fa-spinner fa-spin"></i>';

/**
 * Drive the rebuild from a button, which is how two of the three entry points reach it (the chat
 * card in stonetop.js, the Welcome guide's Book Art step).
 *
 * Owns everything those two agreed on when they were separate copies: disable so an impatient
 * second click cannot start a duplicate pass over the same 140-odd images, swap the label for a
 * spinner that counts, notify with describeRebuild, and put the label back if it threw. Same
 * disable/try/notify/restore contract as chronicle.js's saveChronicleFromButton.
 *
 * On success the button is left DISABLED with the spinner still on it: what a finished run should
 * say differs per caller (the chat card latches to "Rebuilt N", the Welcome guide re-renders the
 * whole step away), so the final word belongs to them.
 *
 * @returns {Promise<object|null>}  the run's result, or null if it threw (already reported).
 */
export async function runBookArtRebuildFromButton(btn) {
	const label = btn?.innerHTML;
	if (btn) { btn.disabled = true; btn.innerHTML = `${SPINNER} Rebuilding…`; }
	try {
		const res = await runBookArtRebuild({
			onProgress: (done, total) => {
				if (btn) btn.innerHTML = `${SPINNER} Rebuilding… ${done}/${total}`;
			},
		});
		ui.notifications?.[res.failed ? "warn" : "info"]?.(describeRebuild(res));
		return res;
	} catch (err) {
		console.error("Stonetop | book art rebuild failed:", err);
		ui.notifications?.error?.("Book art rebuild failed: see the console.");
		if (btn) { btn.disabled = false; btn.innerHTML = label; }
		return null;
	}
}

/**
 * What to tell the GM afterwards. Every entry point says the same thing about the same run.
 *
 * "Pictures", not "portraits": one run now cuts detail portraits, square faces AND creature token
 * squares, and a count of 214 announced as portraits would be wrong about most of them.
 */
export function describeRebuild(res) {
	const n = res?.written ?? 0;
	const bits = [`Rebuilt ${n} picture${n === 1 ? "" : "s"} from art already on disk.`];
	if (res?.repointed) {
		bits.push(res.repointed === 1
			? "1 portrait already in play now uses its close-up."
			: `${res.repointed} portraits already in play now use their close-up.`);
	}
	if (res?.tokens) {
		bits.push(res.tokens === 1
			? "1 creature already in play now uses its token square."
			: `${res.tokens} creatures already in play now use their token square.`);
	}
	if (res?.failed) bits.push(`${res.failed} could not be read (see the console).`);
	return bits.join(" ");
}
