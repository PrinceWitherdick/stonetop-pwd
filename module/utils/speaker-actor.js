/**
 * The Actor a chat card acts on.
 *
 * Every button the system puts on a card — Burn Brightly, Never at a Loss, the logbook, the
 * Requisition miss cost, the identification re-sync — has to get back from a message to the
 * thing it spends. This is the one place that decides how, so a card that marks XP and a card
 * that spends it can never disagree about whose XP it is.
 *
 * THE TOKEN COMES FIRST, because for a monster or an NPC it is the only correct answer: a
 * scene's six goblins are six creatures sharing one sidebar Actor, and a card that reached for
 * the sidebar copy would spend the wrong goblin's hit points.
 *
 * A CHARACTER IS THE EXCEPTION, and the reason this is not a one-liner. A PC is one person the
 * whole table shares, so their token should be linked to them — but where it is not,
 * `token.actor` is not the character at all. It is a private ActorDelta copy, and a card acting
 * on it writes XP, harm and gear that the sheet the player opens from the sidebar will never
 * show.
 *
 * That split is not hypothetical, and nothing in this system asks for it: core hands the token
 * over unasked. `ChatMessage.getSpeaker({actor})` does not keep the Actor it is given — if that
 * Actor has any token on the canvas it discards it and stamps the speaker with the TOKEN (CASE
 * 2, documents/chat-message.mjs). So a roll marks +1 XP on the character, and the Burn Brightly
 * button on that same card spends 2 out of the token's copy, and the two cards report totals
 * that cannot be reconciled — a miss reading 16 and the spend two seconds later reading 11.
 *
 * `speaker.actor` is the world Actor's id in BOTH cases: an unlinked token's synthetic Actor
 * carries the base Actor's id rather than one of its own (ActorDelta#_initialize checks exactly
 * that). So resolving a character this way needs no token to be reachable at all, which also
 * makes it right for a card whose scene is not the one on screen.
 *
 * migration/link-character-tokens.js is the other half of the fix: this stops the split
 * widening, that closes the ones a world already has.
 *
 * @param {object} message  a ChatMessage (or anything carrying a `speaker`)
 * @returns {object|null}
 */
export function speakerActor(message) {
	const { token: tokenId, actor: actorId } = message?.speaker ?? {};
	const tokenActor = tokenId ? globalThis.canvas?.tokens?.get(tokenId)?.actor : null;
	const worldActor = actorId ? globalThis.game?.actors?.get(actorId) : null;
	// Both sides checked, not just the token's: a `speaker.actor` that no longer resolves (a
	// deleted character, a card from another world) must not turn a perfectly good token actor
	// into null.
	if (tokenActor?.type === "character" && worldActor?.type === "character") return worldActor;
	return tokenActor ?? worldActor ?? null;
}
