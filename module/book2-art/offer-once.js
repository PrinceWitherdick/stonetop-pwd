import { getSetting, setSetting } from "../settings.js";
import { isPrimaryGM } from "../utils/primary-gm.js";

/**
 * Make a once-per-world offer about art the GM already has on disk.
 *
 * The durable art folder outlives the world it was imported into, so a GM who imported once
 * and then started a fresh campaign has material sitting right there with nothing pointing at
 * it. Each of those gaps gets an offer — rebuild the portrait details from the parents you
 * already have; build the poster-map Scenes from the maps you already have — and every one of
 * them has the same three-part shape, including one rule that is easy to get backwards:
 *
 *   • ASKED ALREADY? Never ask twice. Declining is an answer, and re-asking every load is
 *     nagging;
 *   • ANYTHING TO OFFER? `findWork` returns falsy when there is nothing worth asking about —
 *     what counts as "worth" is the caller's to decide (any rebuildable crop; any map without
 *     its Scene). Nothing to offer means say nothing AND LEAVE THE FLAG UNSET, so a GM who
 *     imports their art next month still gets asked. Latching here is the mistake this helper
 *     exists to make unrepeatable: it is silent, and it costs the GM the offer forever; and
 *   • COULD WE ACTUALLY ASK? `offer` returns false when it could not present at all (chat not
 *     ready this early in the load). That is not an answer either, so it does not latch.
 *
 * The flag is set once `offer` resolves, BEFORE any work the caller does with the answer — so
 * a GM who says yes and then hits an error is not asked the whole question again.
 *
 * Most of these offers are one whispered chat card, so `card` is the shorthand for that shape:
 * hand it a function from the work to the card's HTML and this does the not-ready guard and the
 * GM whisper. Three callers in Ready.js had that same closure written out longhand, differing
 * only in which `_build…Content` they called, which put the not-ready return value and the
 * whisper recipients in three places — the same asymmetry across call sites this helper exists
 * to remove. `offer` remains for anything that is not a chat card (WorldSetup asks a dialog).
 *
 * @param {object} spec
 * @param {string} spec.setting                 The once-per-world latch.
 * @param {() => Promise<any>} spec.findWork
 * @param {(work: any) => string} [spec.card]   Build the whispered card's HTML.
 * @param {(work: any) => Promise<any>} [spec.offer]  Present it some other way.
 */
export async function offerDurableArtOnce({ setting, findWork, card, offer }) {
	// The chat-card shape, stated once. Returning false when chat is not up yet is what keeps
	// the latch unset so the offer is made on a later load instead of being lost.
	offer ??= async work => {
		if (!globalThis.ChatMessage?.create) return false;
		await ChatMessage.create({
			content: card(work),
			whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
			speaker: { alias: "Stonetop" },
		});
	};
	// ONE GM asks. The latch is world-scoped but it is only written at the END, after findWork
	// and offer have both awaited — so two GMs joining together both pass the check below and
	// both whisper the same card to the GM group. The gate belongs here rather than at each call
	// site: WorldSetup's caller had it and both of Ready.js's did not, which is precisely the
	// asymmetry a shared helper exists to remove.
	//
	// Paired with isGM because isPrimaryGM() alone is true when NO GM is connected, which would
	// let a lone player run it — the same pairing every other world-writing sweep uses.
	if (!game.user?.isGM || !isPrimaryGM()) return;
	if (getSetting(setting)) return;
	const work = await findWork();
	if (!work) return;
	if (await offer(work) === false) return;
	await setSetting(setting, true);
}
