// Data model for the "timeline" JournalEntryPage subtype, the 7th custom page type after
// bestiary / location / chronicle / threat / hazard / site (see stonetop.js).
//
// ONE PAGE IS ONE TRACK, not one entry. A track is a thread of the campaign's story -- Stonetop
// itself, or one player character -- and its whole run of dated entries lives in this page's
// `entries` array. The other way round, a page per entry, was refused for the reason the
// relationship map hides its own pages from the sidebar: a campaign's worth of entries would bury
// every other journal in the world under a list nobody reads that way.
//
// These pages ARE meant to be read in the sidebar, unlike the GM-prep families. The timeline the
// sheet draws is the good version, but a journal page is what a table can share, print, and read on
// a phone, and keeping the record legible outside our own UI is half of what makes it a chronicle.
//
// Storage/visibility: one "Timeline" JournalEntry in The Chronicle folder, created OWNER by default
// so a player can write their own thread. See timeline-store.js for why that is the same bargain
// the relationship map strikes rather than a new one.
const fields = foundry.data.fields;

export class TimelinePageModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			// Which thread this page is. `trackKind` is "steading" or "character"; `trackId` is the
			// steading marker or an actor id. Stored as well as being recoverable from the page's
			// `chronicleKey` flag, because a data model should be readable without reaching for a
			// flag on the document that holds it, and the aggregate view groups on it.
			trackKind: new fields.StringField({ required: true, blank: true, initial: "" }),
			trackId:   new fields.StringField({ required: true, blank: true, initial: "" }),

			// The entries, in no guaranteed stored order: `timeline-core.js#sortEntries` puts them in
			// reading order off the date fields, and the array's own positions carry no meaning.
			entries: new fields.ArrayField(new fields.SchemaField({
				// This entry's own handle. ⚠ Must not contain a dot -- see normalizeEntry.
				id: new fields.StringField({ required: true, blank: true }),

				// The date: the campaign clock's own pair, plus where this sits among the other
				// entries in that same season. No day number, deliberately -- the book gives Stonetop
				// seasons and years and nothing finer.
				year:   new fields.NumberField({ required: true, integer: true, min: 1, initial: 1 }),
				season: new fields.StringField({ required: true, blank: true, initial: "" }),
				order:  new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),

				// What happened. `title` is the line the timeline prints; `place` is free text with a
				// datalist of the places this world already knows, because a party names places the
				// book never did. `body` is the freeform account, and is HTML so it can carry the
				// content links that tie an entry back to an NPC, a site or a location.
				title: new fields.StringField({ required: true, blank: true, initial: "" }),
				place: new fields.StringField({ required: true, blank: true, initial: "" }),
				// The document the place IS, when one was dropped on the field. Optional: most
				// places a party names are nowhere in the world as a document, and typing stays
				// free. A COMPENDIUM uuid is welcome here (unlike on the character rosters, which
				// refuse one) because this is only ever a link to follow, never a document to
				// match against something in the world.
				placeUuid: new fields.StringField({ required: true, blank: true, initial: "" }),
				body:  new fields.HTMLField({ required: true, blank: true, initial: "" }),

				// "hand" for an entry somebody typed, "season" for the one a Seasons Change records.
				// Rows derived from the ledger are never stored and so never carry a source: they are
				// computed at render time, which is what makes them free to toggle off.
				source: new fields.StringField({ required: true, blank: true, initial: "hand" }),

				// Provenance. `createdAt` is also the last tie-break in the sort, so two entries
				// added to one season in the same click cannot swap places on a repaint.
				createdAt: new fields.NumberField({ required: true, integer: true, initial: 0 }),
				authorId:  new fields.StringField({ required: true, blank: true, initial: "" }),
			})),
		};
	}
}
