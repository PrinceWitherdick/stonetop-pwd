// THE TIMELINE, FOR THE TEST-FIXTURES MACRO.
//
// What scripts/local/create-test-characters.js needs to lay a campaign's worth of history onto the
// timeline, and to take it back off again: the store's one write path, the pure list algebra it runs,
// and the builders the system's own recorders word their rows with, so a seeded Seasons Change,
// expedition or site visit reads exactly as one the table recorded (and carries the same key, so a
// later live record patches it rather than adding a second). And the flag the world's custom tags
// are kept under, so its cleanup never deletes the journal holding them. And the Ages' own cleaner
// and colour walk (timeline-ages.js), so the seeded Ages are stored and coloured exactly as the GM's
// Ages window stores and colours them.
//
// Through `mutateTrack` and not a page update of the macro's own, because the system is writing the
// same pages while the macro runs (a level climbed, a follower named, a death) and those writes take
// turns per track (timeline-store.js#trackTurnKey). A second writer outside that queue would read a
// page mid-burst and write back over what landed in between. Handed over on game.stonetop.macroModules
// (book2-art/macro-modules.js), so a bundled release gives the macro the system's own instances, turn
// queue and all, rather than second copies with a queue of their own.
export { mutateTrack, findTrackPage, trackForActor } from "./timeline-store.js";
export { readEntries, upsertByKey, patchEntry, removeEntry } from "./timeline-core.js";
export { TIMELINE_TAGS_FLAG } from "./timeline-tags.js";
export { agesToStored, nextAgeColour, normalizeAges } from "./timeline-ages.js";
export { seasonLabel } from "../seasons/seasons-change-reminders.js";
export { seasonEntryBody } from "./timeline-season-entry.js";
export { expeditionMilestone } from "./timeline-expedition.js";
export { siteVisitMilestone, SITE_VISITS_FLAG } from "../sites/site-visits-core.js";
