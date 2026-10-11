// THE BOOK'S AGES, ADDED ONCE (user, 2026-10-11: "it'd be cool if we auto added those ages the book
// mentions - just give them the super vague dates the book gives them"). Book II's Appendix A names
// the world's Ages; every world gets them on the timeline the first time a GM loads it, placed and
// worded as timeline-ages.js#BOOK_AGES says.
//
// ONCE PER WORLD (`timelineBookAgesAdded`), so an Age of the book's the GM deletes stays deleted, and
// renaming or recolouring one is never undone. Added beside the GM's own Ages, never over them.
// The primary GM writes it: two GMs loading together would otherwise both add the six.

import { localize } from "../utils/i18n.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import {
	getTimelineAgeColourSeq, getTimelineAges, getTimelineBookAgesAdded,
	setTimelineAgeColourSeq, setTimelineAges, setTimelineBookAgesAdded,
} from "../settings.js";
import { bookAgesToAdd } from "./timeline-ages.js";

/** One book Age's name and words, in the table's language. */
function bookAgeText(key) {
	return {
		name: localize(`stonetop.timeline.ages.book.${key}.name`),
		when: localize(`stonetop.timeline.ages.book.${key}.when`),
	};
}

/** Add the book's Ages to this world, if they never have been. Call once the world is ready. */
export async function addBookAgesOnce() {
	if (!game.user?.isGM || !isPrimaryGM() || getTimelineBookAgesAdded()) return;
	try {
		const ages = getTimelineAges();
		const { added, seq } = bookAgesToAdd({ ages, seq: getTimelineAgeColourSeq(), text: bookAgeText });
		if (added.length) {
			await setTimelineAges([...ages, ...added]);
			await setTimelineAgeColourSeq(seq);
		}
		await setTimelineBookAgesAdded();
	} catch (err) {
		console.error("Stonetop | could not add the book's Ages to the timeline", err);
	}
}
