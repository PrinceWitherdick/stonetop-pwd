// THE EXPEDITION, FOR THE TEST-FIXTURES MACRO.
//
// What scripts/local/create-test-characters.js needs to put a trip ON THE ROAD the way the
// walkthrough would have left it: the set-out stamp (when, and who went), the legs travelled
// (`progress`, keyed by `journeyKey` so it reads as the walkthrough's own), and the players' share
// of the way, on the map the Show players button would have picked.
//
// The system's own functions rather than the macro's copies, because each of these is a rule that
// moves: a `journeyKey` spelled differently reads as 0 legs travelled, and a share built off an old
// payload shape is one `isSharedRoute` refuses. Handed over on game.stonetop.macroModules
// (book2-art/macro-modules.js), so a bundled release gives the macro the running instances.
export { journeyKey, journeyRoute } from "../utils/travel-route.js";
export { timelineNow } from "../timeline/timeline-record.js";
export { partySnapshot } from "../timeline/timeline-expedition.js";
export { readSharedRoute, sharedRoutePayload, shareRoute, stopSharingRoute } from "../utils/shared-route.js";
export { shareMapFor } from "./share-map.js";
