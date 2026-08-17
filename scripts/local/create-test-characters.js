// Test fixture generator for Stonetop (system id "stonetop-pwd").
// Paste this into any Foundry Script macro and run it — assign it to a hotbar slot
// yourself; the script does not claim a slot of its own.
//
// PURPOSE: produce a reproducible set of test characters for exercising the sheet and
// onboarding layout. The characters are DETERMINISTIC (no random rolls — every choice is
// the first option / first N options) so re-running the macro always yields the same
// roster. PRESET (below) sets each playbook's name / instinct / stats.
//
// First run:  prompts (Max Level / Level 1 / cancel), then creates one [TEST] character
//             per playbook (9 total) — preset name/stats/instinct, first background +
//             origin, and a deterministic fill of the rest. "Max Level" additionally
//             climbs each character through the real level-up engine until no move remains
//             (level 20+), taking every reachable move / stat / invocation / mark.
//             Every character (either path) is also seeded with one filled-out player
//             custom "Other" move ("This is a test") and one custom follower, so the Moves
//             tab's custom-move card and the Followers tab's custom card are exercised on
//             every sheet. The four Book I p.569 love letters (Rhianna, Caradoc, Vahid,
//             Blodwen — both structures + the no-XP-on-miss case) are spread across the
//             roster rather than given to everyone: by position a character gets all four,
//             exactly one, or none at all, so the Moves tab's Love Letters section is seen
//             full, holding a single card, and absent entirely.
//             Also creates a "Graveyard" Actor folder holding four more filled-out characters,
//             one per fate past the Last Door — a Revenant, a Ghost, a Thrall (each with the
//             insert's own questions answered: Terrible Purpose and who it is about, a first
//             Consequence, the insert's Instinct, a Ghost's tether, a Thrall's master, Impulse
//             and first Mark) and one who simply died, at 0 HP. They are ALWAYS 1st level, even
//             on the Max Level path — a maxed sheet and a dead one are different things to look
//             at — and they are kept out of the party roster, so nothing sweeps them into the
//             introductions, the steading's players or the example NPC's relationships. The
//             living roster can't cover any of this: SKIP_PLAYBOOKS keeps the three inserts out
//             of it, so without the Graveyard the Death's Door black has no fixture.
//             Also records Introductions answers + one example Expedition and compiles the
//             shared "Chronicle" journal. Seeds the steading "Stonetop" (the world's required
//             singleton) with a thematic set of test Residents, Neighbors, and Players (the
//             created PCs) so the steading sheet's member tables aren't empty — each resident
//             and neighbor is a real `npc` Actor in the system's own people folders, which is
//             the shape the sheet expects and what lets a PC rate them. Also seeds a block of
//             formatted rich-text in its Notes tab (only when that tab is empty), and three
//             demonstration Threats (each its own hidden/revealed JournalEntry) so the GM
//             Threats tab shows the full range of card layouts. Seeds the GM Toolkit's
//             "I wonder..." tab (Book I p.33) with a dozen open questions, six of them carrying
//             a written answer or a hunch and six still blank, plus three more already ticked
//             into the Answered fold, so the tab is seen holding a long list and both of its
//             two sections rather than the empty-state line. Fills in the relationship
//             hearts everywhere they render: each PC rates the rest of the party and a couple
//             of villagers, each resident/neighbor rates the PCs back, and the steading rates
//             the eight Other Settlements — every rating carrying a written "How they feel,
//             why…" note, and the spread deliberately covering all five hearts plus the
//             unrated, note-only, blank-note and hidden-row cases the table and the standings
//             board each render differently. Also creates four reusable
//             world folders — "Moves" and "Items" (Item folders of draggable custom moves and
//             inventory gear), "Monster" (an Actor folder of three stat blocks), and "NPCs" (an
//             Actor folder holding one fully-filled example NPC) — so the sidebar Create-Item,
//             Make-a-Monster, and Create-NPC outputs are exercised without hand authoring, each
//             document filled to show the full range of fields its flow offers. The example NPC
//             (Gethin Iron-Hand) populates every field of the interaction-first `npc` sheet:
//             identity + up to three impressions + instinct, the drives (connections /
//             motivations / GM embodiment note), per-PC relationship hearts + notes, the optional
//             combat stat block, embedded npcMove GM moves, a lifecycle status, and @UUID
//             cross-links to a seeded monster stat block and threat. The roster's Judge (Old
//             Bartholomew) ends the run holding four standing Condemn brands, one per way the
//             feature renders: on an NPC (Gethin), on a fellow PC (Quill), on a monster stat block
//             (the Hillfolk Raiders, a Proclamation widened to the whole war-band), and on a
//             faction nobody has made an Actor for (the Cult of the Black Water) — so the header
//             scales, the roster window and the condemned tag on all three sheet types each have a
//             fixture. The singleton actor itself is
//             never created or deleted — only its test members (each tagged isTest) are added and
//             later removed.
// Re-run:     deletes everything this macro created (characters — the roster and the Graveyard
//             alike, both carry the test flag — the resident/neighbor NPCs,
//             and the test Introductions/Expedition data), strips the steading's test members
//             (including any villager an older run left behind, whose isTest tag the people
//             migration dropped when it rewrote the row),
//             clears the seeded Notes, the seeded Other Settlements ratings and the seeded
//             "I wonder..." questions (each only while
//             it still holds exactly what the macro wrote), deletes the seeded Threats (and
//             their scene pins,
//             pruning an emptied Threats folder), removes the world Moves/Items/Monsters and the
//             example NPC (and their now-empty folders), and prunes the matching Chronicle pages.

(async () => {
  // Re-entrancy guard: a double-click on the hotbar — or clicking the macro again while
  // its confirm dialog is still open — would start a second pass that snapshots the same
  // fixtures and fires a duplicate Actor.deleteDocuments, throwing "Actor id … does not
  // exist" once the first pass has already removed them (the body is a fire-and-forget
  // IIFE, so that rejection surfaces as an uncaught-in-promise error). Bail if a run is
  // already in flight; the finally below clears the flag even on early return or error.
  if (globalThis.__stonetopTestFixturesRunning) {
    ui.notifications.warn("[TEST] The fixtures macro is already running — ignoring the repeat click.");
    return;
  }
  globalThis.__stonetopTestFixturesRunning = true;
  try {
  // The active scope is the system id in system.json (module/system-id.js#SYSTEM_ID).
  // Older ids are read-only fallback rungs there (LEGACY_FLAG_SCOPES) — fixtures are
  // always written to the active scope, never to a legacy one.
  const FLAG_SCOPE   = "stonetop-pwd";        // must be a registered system/module ID
  const LEGACY_SCOPES = ["stonetop_pwd", "stonetop"]; // read-only rungs, newest first
  const TEST_FLAG    = "isTestCharacter";     // key within that scope
  const PACK_ID      = "stonetop-pwd.stonetop-items";
  const ARCANA_PACK_ID = "stonetop-pwd.stonetop-arcana";
  // Post-death playbooks we don't want a test character for.
  const SKIP_PLAYBOOKS = new Set(["ghost", "revenant", "thrall"]);
  const MAJOR_FOLDER = "JwVuMk5DtWmttIYY";
  const MINOR_FOLDER = "gkPvaHrx0Y6YiKCP";
  const STAT_KEYS    = ["str", "dex", "con", "int", "wis", "cha"];

  // Per-playbook flavour, keyed by the SHORT playbook slug (slugs are prefixed "the-",
  // which is stripped before the lookup). One record per playbook so a slug rename can't
  // desync stats/name/instinct. Stats are the per-stat modifiers shown on the sheet.
  //
  // Instinct: a character sets its instinct one of two ways, and the roster exercises
  // BOTH. Most presets carry an `instinctWord` naming one of the playbook's built-in
  // instinct suggestions (case-insensitive match against the playbook's `instincts`
  // list) — buildSelections composes the sheet's "Word — Description" value from it, so
  // that character reads as having *picked a suggestion*. The rest carry a one-word
  // `instinct` plus a written `instinctDesc`, composed into the same "Word — Description"
  // value, so that character reads as having *written their own* — the sheet's custom
  // instinct has BOTH a one-word word field and a free-text description field (see
  // composeInstinct in module/utils/strings.js). The custom WORD is ONE WORD (the sheet
  // and onboarding both strip the custom word field to a single token), but its
  // description is a written phrase, matching the book's terse "To …" instinct style.
  const DEFAULT_PRESET = { name: "Test", instinct: "Ambition", instinctDesc: "To rise, to gain, and never to settle for less.", stats: { str: 2, dex: 1, con: 1, int: 0, wis: 0, cha: -1 } };
  const PRESET = {
    blessed:         { name: "Aerin",           instinct: "Devotion",     instinctDesc: "To serve your god faithfully, whatever is asked.",     stats: { str:  0, dex:  1, con:  0, int:  1, wis:  2, cha: -1 } },
    fox:             { name: "Quill",           instinctWord: "Freedom",                                                                        stats: { str:  0, dex:  2, con:  1, int:  1, wis:  0, cha: -1 } },
    heavy:           { name: "Brakkos",         instinct: "Dominance",    instinctDesc: "To bend others to your will, to be strongest in any room.", stats: { str:  2, dex:  1, con:  1, int: -1, wis:  0, cha:  0 } },
    judge:           { name: "Old Bartholomew", instinctWord: "Orthodoxy",                                                                      stats: { str:  1, dex: -1, con:  0, int:  1, wis:  0, cha:  2 } },
    lightbearer:     { name: "Sael",            instinct: "Radiance",     instinctDesc: "To shine so brightly no darkness can stand near you.", stats: { str:  0, dex:  0, con:  1, int:  1, wis: -1, cha:  2 } },
    marshal:         { name: "Coria",           instinctWord: "Caution",                                                                        stats: { str:  1, dex:  0, con:  1, int:  0, wis: -1, cha:  2 } },
    ranger:          { name: "Wren",            instinctWord: "Stewardship",                                                                    stats: { str:  0, dex:  2, con:  1, int:  0, wis:  1, cha: -1 } },
    seeker:          { name: "Maelis",          instinctWord: "Curiosity",                                                                      stats: { str: -1, dex:  1, con:  0, int:  2, wis:  1, cha:  0 } },
    "would-be-hero": { name: "Pim",             instinct: "Glory",        instinctDesc: "To win a name that outlives you, whatever the cost.",  stats: { str:  1, dex:  0, con:  2, int:  0, wis:  1, cha: -1 } },
  };

  // Per-playbook demonstration notes (HTML), keyed by the SHORT playbook slug, seeded
  // into each test character's Notes tab so the tab (and its <prose-mirror> formatting
  // toolbar) is exercised with real content on every fixture. Each entry uses a spread
  // of common blocks — headings, bold/italic, both list kinds, a quote, an inline roll —
  // so the Notes rendering can be eyeballed across the whole roster.
  const TEST_PC_NOTES = {
    blessed: `<h2>Aerin, the Blessed</h2>
<p>Sworn to my god and to the folk of Stonetop both. When those two pull against each other, <strong>the folk come first</strong> — a god can wait; a hungry child cannot.</p>
<h3>Owed &amp; owing</h3>
<ul>
<li>The old herbwife taught me the rites; I owe her a season's labor.</li>
<li>I promised the miller's boy I'd walk him to the shrine at Midsummer.</li>
</ul>
<blockquote><p>"Grace is a debt you pay forward." — something my teacher used to say.</p></blockquote>`,
    fox: `<h2>Quill, the Fox</h2>
<p>Light fingers, lighter feet, and a nose for a locked door that wants opening. <em>Freedom</em> is the only coin I never spend.</p>
<h3>Marks &amp; scores</h3>
<ol>
<li>The reeve's strongbox — still owe myself that one.</li>
<li>A map to the barrow, half-copied before the candle guttered.</li>
</ol>
<p>Never trust a smile that costs the smiler nothing.</p>`,
    heavy: `<h2>Brakkos, the Heavy</h2>
<p>Big enough to end most arguments before they start. <strong>Dominance</strong> isn't cruelty — it's making sure the weak have someone larger standing between them and the dark.</p>
<ul>
<li>Broke my axe on the raider captain's shield. Need it re-hafted.</li>
<li>Owe the smith three days at the bellows for the favor.</li>
</ul>`,
    judge: `<h2>Old Bartholomew, the Judge</h2>
<p>Keeper of the old ways and the older grudges. <em>Orthodoxy</em> is a wall — and a village is only as strong as the folk willing to stand it.</p>
<h3>Matters before me</h3>
<ol>
<li>The dispute over the north field's boundary stones.</li>
<li>Whether young Coria's watch-duty scheme is wisdom or overreach.</li>
</ol>
<blockquote><p>"Mercy is not the abolition of the law. It is the law remembering it has a heart."</p></blockquote>`,
    lightbearer: `<h2>Sael, the Lightbearer</h2>
<p>I carry Helior's flame into the dark places the others fear. <strong>Radiance</strong> — to shine so brightly no darkness can stand near.</p>
<ul>
<li>Oil for the lantern runs low; must trade for more before the deep run.</li>
<li>The hymn for warding is <em>almost</em> memorized — one verse still eludes me.</li>
</ul>`,
    marshal: `<h2>Coria, the Marshal</h2>
<p>Somebody has to keep the watch honest and the wall in good repair. <em>Caution</em> keeps my people alive; glory buries them.</p>
<h3>Duty roster</h3>
<ol>
<li>Double the watch on the Maker's Road until the raiders quiet.</li>
<li>Drill the militia twice a week, not once.</li>
</ol>
<p>Roll the season's readiness: <strong>[[/r 2d6]]</strong>.</p>`,
    ranger: `<h2>Wren, the Ranger</h2>
<p>The wild is not an enemy — it is a neighbor with sharp manners. <em>Stewardship</em> means tending the border so the border tends us back.</p>
<ul>
<li>Fresh sign of something large near the old ford. Not a bear.</li>
<li>The bees are swarming early; a sign of a warm, hungry summer.</li>
</ul>
<blockquote><p>"Leave a place better fed and better warned than you found it."</p></blockquote>`,
    seeker: `<h2>Maelis, the Seeker</h2>
<p>Every ruin is a question the world forgot to answer. <em>Curiosity</em> drags me toward every locked and lettered thing.</p>
<h3>Lines of inquiry</h3>
<ol>
<li>The glyphs on the barrow lintel — a dialect, not a cipher, I think.</li>
<li>Cross-reference the star-charts against the flooded undercroft.</li>
</ol>
<p>See the <a href="https://foundryvtt.com/">references</a> when I next reach Marshedge.</p>`,
    "would-be-hero": `<h2>Pim, the Would-Be Hero</h2>
<p>Small, stubborn, and certain the songs have room for one more name. <strong>Glory</strong> — to win a name that outlives me, whatever the cost.</p>
<ul>
<li>Practice the sword-forms until my arms give out. Then once more.</li>
<li>Ask Brakkos to spar. Do not cry when he wins.</li>
</ul>
<p>This is the year it starts. I can feel it.</p>`,
  };

  // ── Helpers ────────────────────────────────────────────────────────────
  // DETERMINISTIC selection: always take the first option / first N options (in order),
  // so the generated fixtures are reproducible. `rng`/`pick`/`pickN` keep their original
  // signatures so the rest of the macro is unchanged (e.g. `rng(n)` → 0 means "min of a
  // range").
  const rng   = _n => 0;
  const pick  = a  => a?.[0];
  const pickN = (a, n) => [...(a ?? [])].slice(0, Math.min(n, (a ?? []).length));

  const parseMovePickCount = note => {
    const m = (note ?? "").match(/\b(\d+)\s+(?:more\s+|other\s+)?(?:move[s]?\s+)?of\s+your\s+choice/i);
    return m ? parseInt(m[1], 10) : 0;
  };

  // Check the first N markOption boxes on every owned move that declares a repeat-scaling
  // pick budget (system.markBudget = { base, perExtra } + system.markOptions) — e.g. the
  // Seeker's Well Versed ("Mark 1 topic"). Mirrors moveMarkBudget(): picks = base +
  // perExtra·(ownedCount−1). Writes through the typed actor's setCountMark (the same writer
  // the sheet checkboxes use, which independently clamps to the move's total budget), so a
  // freshly built fixture reads complete instead of "needs your input". Moves with
  // markOptions but no markBudget (the Would-Be Hero's Potential for Greatness, marked in
  // play) yield no budget and are left untouched.
  const applyStartingMoveMarks = async (actor) => {
    const typed = actor.typedActor;
    if (!typed?.setCountMark) return;
    const moves      = actor.items.filter(i => i.type === "move");
    const ownedCount = moves.reduce((m, i) => m.set(i.name, (m.get(i.name) ?? 0) + 1), new Map());
    const done       = new Set();
    for (const move of moves) {
      if (done.has(move.name)) continue;          // budget keys off ownedCount, not per-copy
      done.add(move.name);
      const mb   = move.system?.markBudget;
      const opts = move.system?.markOptions ?? [];
      if (!mb || mb.base == null || !opts.length) continue;
      let budget = Math.max(0, mb.base + (mb.perExtra ?? 0) * ((ownedCount.get(move.name) ?? 1) - 1));
      for (const opt of opts) {
        if (budget <= 0) break;
        const marks = opt.marks ?? 1;
        await typed.setCountMark(move.name, opt.slug, marks);
        budget -= marks;
      }
    }
  };

  // Repeat-scaling selection budget for a move's markOptions (inlined from
  // module/actors/character/move-mark-budget.js so the pasted macro stays self-contained):
  // total picks = base + perExtra·(ownedCount−1); null = uncapped, 0 when unowned.
  const moveMarkBudget = (mb, ownedCount = 0) => {
    if (!mb || mb.base == null) return null;
    if (ownedCount < 1) return 0;
    return Math.max(0, mb.base + (mb.perExtra ?? 0) * (ownedCount - 1));
  };

  // Climb a freshly-built character to "max level" by driving the REAL level-up engine
  // (actor.typedActor.getLevelUpData → applyLevelUp), exactly as the LevelUpDialog does.
  // Stonetop has no hard maximum level (Book I, "Playing the Game": "There is no maximum
  // level"), so max = climbing until no pickable move remains (each playbook exhausts in
  // the low-to-mid 20s). DETERMINISTIC, matching the macro's "first option" contract: pick
  // availableMoves[0] each step and supply whatever selection it demands — a stat for
  // Improved/Superior Stat (raise the first stat still under the move's cap), a foreign
  // move for cross-playbook moves, an invocation on even levels, or the mark allowance for
  // a budgeted move (Veteran Crew / Heroes to the Last / Beast of Legend / Well Versed).
  // Mirrors the climb integration test (tests/.../StonetopCharacter.levelToMax.test.js).
  // Returns the number of levels gained.
  const climbToMax = async (actor) => {
    const typed = actor.typedActor;
    if (!typed?.getLevelUpData || !typed?.applyLevelUp) return 0;
    let climbed = 0;
    // Guard against a pathological non-shrinking availableMoves set (no real playbook
    // reaches this; the largest climb is ~30 levels).
    for (let guard = 0; guard < 400; guard++) {
      const data = await typed.getLevelUpData();
      if (!data.availableMoves?.length) break;

      const pick       = data.availableMoves[0];
      const invocation = data.needsInvocation ? (data.availableInvocations[0]?.slug ?? null) : null;

      let choices = null;
      if (pick.cap != null) {
        // Improved/Superior Stat: raise the first stat still below this move's cap.
        const stat = STAT_KEYS.find(k => (actor.system?.stats?.[k]?.value ?? 0) < pick.cap) ?? "str";
        choices = { stat, cap: pick.cap };
      } else if (pick.crossPlaybook) {
        const foreign = await typed.getForeignMovesForLevelUp(pick.crossPlaybook, data.newLevel);
        choices = {
          crossPlaybook:    true,
          foreignMoveId:    foreign[0]?.compendiumId ?? null,
          grantsPossession: pick.crossPlaybook.grantsPossession ?? null,
        };
      } else if (pick.markOptions?.length) {
        // A budgeted count-mark move just picked: spend this take's allowance on the first
        // count options (skip stat-choice options — those belong to the stat picker).
        const countOpts = pick.markOptions.filter(o => o.choice !== "stat");
        const allowance = moveMarkBudget(pick.markBudget, (pick.ownedIds?.length ?? 0) + 1) ?? 0;
        const picks     = countOpts.slice(0, allowance).map(o => ({ slug: o.slug }));
        if (picks.length) choices = { marks: { moveName: pick.name, picks } };
      }

      await typed.applyLevelUp(pick.compendiumId, invocation, choices);
      climbed++;
    }
    return climbed;
  };

  // Returns the minimum pick count from a lore section description.
  const parseLorePickMin = desc => {
    const d = String(desc ?? "").toLowerCase();
    const rangeM = d.match(/(?:choose|pick)\s+(\d+)\s*[–-]\s*\d+/);
    const orM    = d.match(/(?:choose|pick)\s+(\d+)\s+or\s+\d+/);
    const maybeM = d.match(/(?:choose|pick)\s+(\d+)[,\s]+maybe\s+\d+/);
    const singM  = d.match(/(?:choose|pick)\s+(\d+)/);
    if (rangeM) return parseInt(rangeM[1]);
    if (orM)    return parseInt(orM[1]);
    if (maybeM) return parseInt(maybeM[1]);
    if (singM)  return parseInt(singM[1]);
    return 1;
  };

  // ── Free-text answers ──────────────────────────────────────────────────
  // Real, thematic answers for every free-text onboarding question, so test
  // characters exercise the sheet/onboarding layout with believable prose
  // (names, short phrases, and full paragraphs) instead of placeholders.
  // Keys: lore "lore:<sectionSlug>:<optionSlug>", setup text "text:<key>",
  // neighbor trait "neighbor:<traitKey>".
  const TEXT_ANSWERS = {
    // The Heavy — Storm-Marked background
    "text:lightningEvent": "It was the storm that drowned the barley three summers back. I was hauling a stuck ox from the mud when the sky split white — I woke flat on my back, ears ringing, the ox dead beside me and the hair burned clean off my arms. I felt nothing but a warmth in my chest, like a great hand had closed round my heart and squeezed once. I've not been afraid of much since.",

    // The Ranger — Wide-Wanderer neighbor traits (short phrases)
    "neighbor:ennis":  "Steady and slow to anger, but never forgets a slight.",
    "neighbor:shahar": "Sharp-tongued and sharper-eyed; trades in other folk's secrets.",
    "neighbor:yannic": "Restless — always half a step out the door toward the Wood.",
    "neighbor:tovia":  "Warm and open-handed; feeds anyone who knocks after dark.",
    "neighbor:sasca":  "Quiet and watchful, and far braver than she looks.",

    // The Marshal — War Stories (rendered as <textarea>, so multi-sentence)
    "lore:war-stories-questions:when":      "Late in the harvest two winters ago, when the raiders came down out of the high country. We'd just brought in the last of the barley and thought ourselves safe for the season. They hit us in the grey hour before dawn, and the fighting did not stop until the sun was well up.",
    "lore:war-stories-questions:who-died":  "Old Brennan took an arrow in the throat in the first rush, before most of us had even found our feet. His widow Maeve still sets his place at the table every night. I've stopped telling her not to.",
    "lore:war-stories-questions:who-maimed":"Young Pell lost three fingers off his shield hand to a Hillfolk axe. He keeps the hand tucked in his belt now, the way a man hides something he's ashamed of. He still drills with us every morning, though, and I'll not be the one to tell him to stop.",
    "lore:war-stories-questions:saved-day": "I did — I rallied the line at the broken gate and we held it until dawn. There was a moment the whole thing nearly came apart, when Brennan fell and the youngest of them turned to run. I put myself in the gap and shouted until my voice gave out, and somehow that was enough.",
    "lore:war-stories-questions:enemy-away":"Their chieftain slipped into the Wood in the dark, and I still blame the scout who fell asleep at his post. We had him cornered against the treeline with nowhere left to run. By the time we realized the watch had failed, there was nothing left but cold ground and a trail the rain washed out by morning.",
    "lore:war-stories-questions:honor":     "Tobin stood over the wounded and would not give ground, though he bled from a dozen cuts. Three of them came at him at once and still he held. When it was over we had to pry his fingers from the haft of his spear, and he wept — not from the pain, he said, but from relief that the others had lived.",
    "lore:war-stories-questions:bugging":   "We never found where they crossed the river, and that gnaws at me still. Someone must have shown them the ford. I've watched every face in the market since, wondering which one of us it was.",
    "lore:war-stories-questions:worried":   "They were far too well armed for hill raiders, mail and good steel where there should have been hide and flint. Somebody is arming them, and arming them well. I lie awake some nights trying to work out what they're being armed for.",

    // The Seeker — Major Arcanum (rendered as <textarea>, so multi-sentence)
    "lore:arcana-major:where-acquired": "From a flooded barrow beneath the Lygos marsh, half-swallowed by black water. The locals warned me off it for three days running, and on the fourth I went anyway. I have never been able to decide whether that was the bravest thing I ever did or the most foolish.",
    "lore:arcana-major:wrested-from":   "From a dying scholar who begged me to take it before the rot reached his mind. He'd carried it for forty years and it had hollowed him out from the inside. 'Better you than the worms,' he told me, and then he laughed in a way I still hear when I cannot sleep.",
    "lore:arcana-major:who-else-wants": "The Crow-Mother's cult, and a collector in Marshedge who pays in blood-coin. The cult wants it for what it is; the collector only wants it because someone else does. I have learned to fear the second sort far more than the first.",
    "lore:arcana-major:what-cost":      "My right eye, and the trust of the only friend who went down there with me. The eye I can live without — it is the look on her face when she walked away that I cannot. Some prices you only understand the size of after you have already paid them.",
    "lore:arcana-major:when-unlocked":  "On the longest night of the year, when I finally spoke its true name aloud. I had carried that name half a year before I dared, turning it over on my tongue in the dark. The moment it left my lips the cold went out of the room, and I knew there was no putting it back.",

    // The Seeker — Minor Arcana (rendered as <textarea>, so multi-sentence)
    "lore:arcana-minor:mastered-location": "A bone whistle I keep on a cord round my neck. I mastered it during a fever that should have killed me. For three days I heard it singing under the sound of my own heartbeat, and when the fever broke I understood every note.",
    "lore:arcana-minor:found-location":    "A tarnished ring, tucked behind a hollow brick in the cellar of a Marshedge alehouse. I'd gone down for a cask and come up with a great deal more than ale. The brick was loose for a reason, I think, and I have wondered ever since who left it there for me to find.",
    "lore:arcana-minor:sought-notes":      "A mirror said to show the dead. A peddler swore it passed through Gordin's Delve not a year ago, traded for a mule and a sack of salt. I've followed three false trails after it already, and I'll follow a fourth if I must.",

    // The Would-Be Hero — Fear and Anger story (rendered as <textarea>, so multi-sentence)
    "lore:fear-and-anger-story:when-trouble": "Last spring, at the market in the square. It was the first warm day after a long, mean winter, and the whole town had turned out. I should have been glad of it. Instead something in me had been wound tight for weeks, and that was the day it finally snapped.",
    "lore:fear-and-anger-story:what-did":     "A drover struck his mule across the eyes, so I struck him — broke his nose before anyone could pull me off. I don't remember deciding to do it. One moment I was watching, the next I had blood on my knuckles and three men holding my arms. The worst of it is that for a heartbeat I felt nothing but glad.",
    "lore:fear-and-anger-story:how-turned":   "His kin wanted blood-price, and they were within their rights to ask it. My mother paid it in goats — half the herd, gone in an afternoon over my temper. I've not been able to meet her eye since, and she's never once thrown it in my face, which is somehow worse.",
  };

  // Returns a written answer for a free-text question. Falls back to a thematic
  // line (varied by prompt) so any newly added question still lays out with real
  // prose rather than an empty field.
  //
  // Free-text fields render as one of two controls (see character-onboarding.hbs):
  // background-setup `text:` and lore `lore:` answers are <textarea> (multi-line —
  // a full paragraph lays out fine), while neighbor-trait `neighbor:` answers sit
  // in a single-line <input> with room only for a short phrase. Match the fallback
  // pool to the control so we never stuff a paragraph into a one-line field.
  const FALLBACK_ANSWERS_LONG = [
    "Honestly, I'd rather not say — but ask me again over a cup of something strong, and maybe I will. It's the kind of tale that wants the telling done right or not at all. There are pieces of it I've never said aloud to anyone.",
    "It happened a long while back, and I've turned it over in my head more nights than I can count. I keep thinking I'll land on the moment it all went wrong, but it slips away every time. Perhaps there was no single moment — perhaps it was all of them at once.",
    "Folk in Stonetop still whisper about it, though half of them have the details wrong. I've given up trying to set the record straight; a story belongs to the teller, not to the one it happened to. Let them keep their version. Mine is heavy enough to carry alone.",
  ];
  const FALLBACK_ANSWERS_SHORT = [
    "Quiet, and not to be crossed twice.",
    "Quick to laugh, slow to trust.",
    "Carries more than they let on.",
  ];
  const isSingleLineField = key => String(key).startsWith("neighbor:");
  const answerFor = (key, prompt) => {
    if (TEXT_ANSWERS[key]) return TEXT_ANSWERS[key];
    const pool = isSingleLineField(key) ? FALLBACK_ANSWERS_SHORT : FALLBACK_ANSWERS_LONG;
    const idx  = String(prompt ?? key).length % pool.length;
    return pool[idx];
  };

  // ── Introductions answers (so the Chronicle has content to compile) ────────
  // One recorded answer set per PC, matching the introductionsAnswers shape: r1–r3
  // are narration strings; the player-driven answer/ask steps are recorded as
  // step4 / step6 { answers: [{ q, a }], passed }, where q is the chosen question
  // index (0–3) into the playbook's step4 / step6 question set and a is the written
  // answer. We seed ALL FOUR of each step's questions, matching a table that went
  // around until everyone had answered them all (the flow loops until each PC passes
  // or answers all four — see module/dialogs/introductions-flow.js). The Chronicle
  // compiler resolves q back to the question text per the PC's playbook
  // (module/utils/chronicle-core.js), so any valid index reads fine regardless of
  // playbook.
  const INTRO_KIN = [
    "my sister Maeve, who took me in after the fever carried off our parents",
    "old Tobin the smith, who raised me at his forge and never once raised his hand",
    "my brother Pell — though we've not traded a civil word since the spring floods",
    "Bronwen, my mother's sister, the only kin I've left who'll still have me",
  ];
  const INTRO_HEART = [
    "Ennis the cooper. We've an understanding, even if neither of us has yet said the word aloud",
    "Tovia, the baker's daughter, whose laugh I'd cross the whole of the Flats to hear",
    "no one living — I lost them on the road up from Marshedge, and I carry it still",
    "Yannic, who tends the orchard; he doesn't know it, and I mean to keep it that way a while longer",
  ];
  // The third and fourth step-4 questions vary by playbook (an apprentice, a charge,
  // a debt, a forgiveness to earn), but each still asks the PC to name a townsperson,
  // so these are phrased neutrally enough to slot against any of them.
  const INTRO_KIN_MORE = [
    "Tobin the smith, who has stood by me longer than he ever had cause to",
    "young Pell, who looks to me the way I once looked to my own elders",
  ];
  const INTRO_ASKED = [
    "I asked Rhianna whether she still trusted me after the business at the broken gate. She held my eye a long while, then said she did — mostly",
    "I put it to Vahid, who only grinned and changed the subject, which is answer enough if you know the man",
    "I asked Caradoc to his face. He went quiet a moment, then nodded once, the way he does when a thing costs him to admit",
    "I asked Gwendyl outright, and she laughed and said I already knew the answer, and maybe I do",
  ];
  const INTRO_NARRATE = [
    "I was born within sight of Stonetop's old wall and have never strayed far from it for long. Folk know me by my plain wool and the long stride I keep, and by the fact that I'd sooner listen than talk.",
    "I came up hard and came up here, and the village took me in when it had no good reason to. I've a quiet way and a steady hand, and a past I keep folded small and out of sight.",
    "There's not much to look at — weathered, plain-dressed, a touch too watchful for most folk's comfort. But I know every footpath within a day's walk, and I keep my word once I've given it.",
  ];
  const INTRO_CONTRIBUTE = [
    "I keep little of value but what I carry — good tools, a blade kept sharp, a thing or two I'd not part with for coin. I earn my place doing the work others would rather not: the early watches, the long roads, the jobs that want a steady hand and a closed mouth.",
    "My possessions would fit in a single sack, and most have a story I'll tell you when I know you better. I help the village the way I know how — by being where the trouble is before it finds the rest of you.",
    "What I own I've earned or been given, and each piece means something. As for the village: I do the unglamorous work gladly, and I've a knack for noticing what others miss.",
  ];
  const INTRO_PLACE = [
    "Stonetop is the only home I've known, and I mean to see it stand long after I'm gone. I've my own reasons, and in time you'll learn them; for now it's enough that the village and I are bound together, for good or ill.",
    "Some folk here still look at me sideways, and I can't say they're wrong to. But this is my home and these are my people, and there's nothing past the wall I fear more than losing it.",
    "I've a place at the edge of things here — useful, trusted enough, never quite at the centre. It suits me. From the edge you see what's coming before anyone else does.",
  ];
  const buildIntroAnswers = (name) => ({
    r1: `I'm ${name}. ${pick(INTRO_NARRATE)}`,
    r2: pick(INTRO_CONTRIBUTE),
    r3: pick(INTRO_PLACE),
    // The player-driven answer/ask steps, in their { answers: [{ q, a }], passed }
    // shape: all four questions answered (q 0–3), so each PC's card shows a full round
    // rather than the two answers the old r4–r7 seed recorded. passed stays false — the
    // PC is "done" here by having answered them all, not by opting out.
    step4: {
      answers: [
        { q: 0, a: `That would be ${INTRO_KIN[0]}.` },
        { q: 1, a: `It's ${INTRO_HEART[0]}.` },
        { q: 2, a: `That would be ${INTRO_KIN_MORE[0]}.` },
        { q: 3, a: `Without question, ${INTRO_KIN_MORE[1]}.` },
      ],
      passed: false,
    },
    step6: {
      answers: INTRO_ASKED.map((a, q) => ({ q, a: `${a}.` })),
      passed: false,
    },
  });

  // ── Example expedition (so the Expedition log + its Chronicle page show) ───
  // Matches the expeditionAnswers entry shape (chart/home are { checks, notes };
  // outfit/requisition/prep/running are top-level single-text notes). `isTest`
  // marks it so the re-run cleanup can remove just this one.
  const buildExampleExpedition = () => ({
    id:        foundry.utils.randomID(),
    title:     "The Wandering Tower",
    createdAt: Date.now(),
    isTest:    true,
    chart: {
      route:  "North up the Maker's Road to the old ford, then east along the treeline to where the herders swear a stone tower now stands that wasn't there last spring.",
      checks: { guide: true, days: true, bring: true, perilous: true, attention: true },
      notes:  "Branok the herder will guide them as far as the ford but no further — he'll not go near the tower. Reckon four days out, more if the weather turns.",
    },
    outfit:      "Warm cloaks, three days' hard rations apiece, a coil of good rope, and Vahid's lantern. Caradoc insisted on hauling the heavy shield along.",
    requisition: "Rolled a 9 on Requisition — the village can spare dried meat and a sound cart, but the elders want both back in one piece.",
    prep:        "They spent the eve before at the Stranger's Roof trading rumours. An old trapper swore the tower 'sings' at dusk and warned them not to answer.",
    running:     "Lost half a day to a washed-out stretch of road and a tense parley with a Hillfolk scouting party — settled with a gift of salt and no blood drawn.",
    home: {
      checks: { absence: true, townDoings: true, threats: true, triumph: true },
      notes:  "Gone the better part of a week. If they come home with proof of what stands out there, that's a Triumphant return — clear a steading debility.",
    },
  });

  // ── Steading test members (Residents / Neighbors / Players) ────────────
  // Thematic fixtures for the steading "Stonetop" so its member tables aren't empty
  // in a test world. Residents / Neighbors are DETERMINISTIC; the Players rows draw a
  // random Occupation / Relations / Notes each run (see buildTestPlayers). Each carries
  // `isTest: true` so the re-run cleanup can strip just these without touching members
  // the GM added by hand.
  //
  // Residents and Neighbors are PEOPLE DEFINITIONS, not rows: each one becomes a real
  // `npc` Actor in the system's "Residents of Stonetop" / "Neighbors of Stonetop" folders
  // and the steading's flag array holds a `{ uuid, id, name, checked }` POINTER at it —
  // the post-migration shape every add flow produces today (steading-people.js), which the
  // roster reads its Occupation / Traits / Relations / Home / Notes cells live off. Two
  // things follow from getting this right, and both were broken while these were seeded as
  // legacy plain-text rows: a text row has no actor, so it can never appear on a character
  // sheet's Relationships section (that group is built from `steadingPeopleActors`); and
  // the ready-hook migration would have converted them on the next world load, rewriting
  // each row WITHOUT its `isTest` tag and leaving fixtures this macro could no longer clean
  // up. The NPCs themselves carry the test flag, so the re-run's actor sweep deletes them.
  //
  // Occupations / traits / homes are drawn from the suggestion pools in
  // module/data/steading-members.js so they exercise the combo fields cleanly; `instinct`
  // is the NPC sheet's anchor field (blank on fourteen sheets reads unfinished); and `rels`
  // is how this person regards the PCs — hearts 1-5 plus the "How they feel, why…" note,
  // seeded straight into the NPC's `system.relationships` map so their Relationships tab
  // has content. An entry with no `hearts` stores only the note and stays UNRATED (the
  // standings board dims it), matching updateRelationship's rule that a note must never
  // persist a rating nobody made.
  const STEADING_TEST_RESIDENTS = [
    {
      name: "Maeve", occupation: "Homemaker", traits: "widowed; tender-hearted",
      relations: "Pell's mother; still sets a place for her late husband",
      instinct: "to keep a hearth burning for whoever comes home",
      notes: "Keeps the hearth at the heart of the village.",
      rels: [
        { name: "Aerin", hearts: 5, notes: "Sat with her the whole of the night her husband died and has never once mentioned it since." },
        { name: "Coria", hearts: 2, notes: "Her boy went up onto the wall whole and came back down three fingers short. She has been civil about it and nothing more." },
      ],
    },
    {
      name: "Tobin", occupation: "Blacksmith", traits: "gods-fearing; very strong",
      relations: "raised more than one of Stonetop's orphans at his forge",
      instinct: "to make sound work, and to take in whoever needs taking in",
      notes: "Never once raised his hand to those he took in.",
      rels: [
        { name: "Brakkos", hearts: 5, notes: "Broke an axe on a raider's shield and then worked three days at the bellows to pay for the re-hafting, without being asked." },
        { name: "Pim",     hearts: 4, notes: "The lad is at the forge before the smith some mornings. Tobin has started leaving the fire banked for him and saying nothing about it." },
      ],
    },
    {
      name: "Ennis", occupation: "Cooper", traits: "cautious; loyal friend",
      relations: "an understanding with Wren the Ranger",
      instinct: "to make a thing that holds, and to wait for what he wants",
      notes: "Makes the soundest barrels this side of Marshedge.",
      rels: [
        { name: "Wren",  hearts: 5, notes: "Neither of them has said the word aloud, and Ennis is content to let another season go by before either does." },
        { name: "Quill", hearts: 2, notes: "Two of his best hoops walked off the yard the week the Fox came home. He has never accused him and he has never forgotten." },
      ],
    },
    {
      name: "Tovia", occupation: "Baker", traits: "cheery; good with children",
      relations: "the baker's daughter; feeds anyone who knocks after dark",
      instinct: "to feed anyone who knocks, whatever the hour",
      notes: "",
      rels: [
        { name: "Pim",  hearts: 4, notes: "Half the square thinks it is a joke and she has stopped correcting them." },
        { name: "Sael", hearts: 4, notes: "Comes in for bread at first light and leaves the room warmer than he found it." },
      ],
    },
    {
      name: "Pell", occupation: "Watchman", traits: "lame; has lost their nerve",
      relations: "Maeve's son",
      instinct: "to hold the post one more night",
      notes: "Lost three fingers but still drills every morning.",
      rels: [
        { name: "Brakkos", hearts: 5, notes: "Stood over him in the mud until the raiders lost interest. Pell knows exactly how close it was; nobody else does." },
        { name: "Coria",   hearts: 2, notes: "She sent him to the gate and the gate is where the axe found him. He drills every morning and cannot look at her while he does it." },
      ],
    },
    {
      name: "Yannic", occupation: "Forester", traits: "restless; gathers herbs from the Wood",
      relations: "tends the village orchard",
      instinct: "to be off toward the Wood before anyone can ask him to stay",
      notes: "Always half a step out the door toward the Great Wood.",
      rels: [
        { name: "Wren",            hearts: 5, notes: "The only other soul here who treats the Wood as a neighbour rather than a threat." },
        { name: "Old Bartholomew", hearts: 2, notes: "The Judge calls the Wood a debt nobody should be taking on. Yannic has stopped arguing and started leaving earlier." },
      ],
    },
    {
      name: "Bronwen", occupation: "Midwife", traits: "well-read; knows all the gossip",
      relations: "aunt or great-aunt to half the village",
      instinct: "to know a thing before it is common knowledge",
      notes: "",
      rels: [
        { name: "Aerin",  hearts: 4, notes: "Between the two of them they have seen every soul in this village into the world or out of it." },
        { name: "Maelis", hearts: 2, notes: "The girl asks after the old rites the way a magpie asks after a ring. Bronwen answers her less every year." },
      ],
    },
    {
      name: "Vahid", occupation: "Publican", traits: "happy-go-lucky; tells the best jokes",
      relations: "keeps the public house",
      instinct: "to keep the room warm and the talk flowing",
      notes: "Hears every rumor that passes through Stonetop.",
      rels: [
        { name: "Quill", hearts: 5, notes: "Pays for about a third of what he drinks and is worth every cup of the rest for the stories." },
        { name: "Coria", hearts: 3, notes: "Good for the room and bad for the trade: nobody orders a second when the marshal is stood in the doorway." },
      ],
    },
  ];
  const STEADING_TEST_NEIGHBORS = [
    {
      name: "Tierney", home: "Marshedge", occupation: "Merchant", traits: "gets the best deals; has a wandering eye",
      relations: "trades Stonetop's whisky down to the coast",
      instinct: "to get the better end of every bargain, twice if he can",
      notes: "",
      rels: [
        { name: "Quill", hearts: 3, notes: "Sharp, and cheap to buy for an evening. Tierney has not decided yet whether that makes him useful or dangerous." },
        { name: "Coria", hearts: 2, notes: "Asks after his ledgers in a way he does not care for at all." },
      ],
    },
    {
      name: "Brogan", home: "Marshedge", occupation: "Guard", traits: "has a beef with Marshedge",
      relations: "rides with the Claws who run Marshedge's watch",
      instinct: "to be owed a favour by everyone who matters",
      notes: "",
      rels: [
        { name: "Coria",   hearts: 1, notes: "She turned his riders back at the Maker's Road in front of their own men, and he has been telling the story his way ever since." },
        { name: "Brakkos", hearts: 2, notes: "Too big to push and too well liked to buy. Brogan would sooner he stayed on his own side of the Fen." },
      ],
    },
    {
      name: "Gwilm", home: "The Steplands", occupation: "Shepherd", traits: "fearless; has a way with animals",
      relations: "a Hillfolk horselord who trades horn and hide",
      instinct: "to keep the herd fed and the clans out of a war they cannot win",
      notes: "",
      rels: [
        { name: "Wren", hearts: 4, notes: "Reads ground the way a horselord does. Gwilm has offered her a place at his fire twice." },
        { name: "Pim",  hearts: 5, notes: "Asked to hear the whole telling of the Titan Bones, sat through all of it, and asked for it again the next night." },
      ],
    },
    {
      name: "Caradoc", home: "Gordin's Delve", occupation: "Miller", traits: "stoic; well-traveled",
      relations: "supplies Stonetop's metal and tools",
      instinct: "to keep the road between the Delve and Stonetop open",
      notes: "Wary of the mask-wearing Ustrina from the deep.",
      rels: [
        { name: "Old Bartholomew", hearts: 4, notes: "A man who says what a thing will cost and then charges exactly that. Rare in any town, rarer in the Delve." },
        { name: "Maelis",          hearts: 3, notes: "Wants to be taken down into the deep workings. He has said no three times and expects to say it again." },
      ],
    },
    {
      name: "Demetra", home: "Lygos", occupation: "Scribe", traits: "ambitious; well-read",
      relations: "a southern factor eyeing Stonetop's surplus",
      instinct: "to write Stonetop into a ledger somewhere far to the south",
      notes: "",
      rels: [
        { name: "Maelis",          hearts: 4, notes: "The only person north of the Manmarch worth writing a letter to, and she answers every one." },
        { name: "Old Bartholomew", hearts: 2, notes: "Treats a signed contract as a suggestion and the old ways as law. It makes him impossible to file." },
      ],
    },
    {
      name: "Rhys", home: "Barrier Pass", occupation: "Herbalist", traits: "humorless; keeps to themselves",
      relations: "rarely deals with outsiders",
      instinct: "to be left alone behind the great gate",
      notes: "Lives behind the great gate on goats and sheep.",
      rels: [
        { name: "Sael",  hearts: 1, notes: "Came up to the gate at dusk carrying an open flame and singing. They have not opened it to him since." },
        { name: "Aerin", hearts: 3, notes: "Asked after the winter stores before she asked after anything else. They will grant her that much." },
      ],
    },
  ];

  // ── Relationship fixtures (hearts + "How they feel, why…" notes) ───────
  // The same 1-5 hearts component renders on three surfaces (module/utils/
  // relationship-hearts.js + relationship-board.js), and each stores the identical shape:
  // `system.relationships` is a map of key → { hearts?, notes?, shown? }, sparse by design.
  //   • character sheet, foot of Details — this PC's regard for the other PCs and for the
  //     steading's people (keyed by ACTOR ID);
  //   • NPC sheet, Relationships tab — how that villager regards each PC (actor id);
  //   • steading sheet, Other Settlements — how Stonetop stands with the eight communities
  //     in module/data/settlements.js (keyed by settlement SLUG, not an id).
  //
  // The macro is standalone and can't import updateRelationship, so buildRelEntry below
  // reproduces its one non-obvious rule: a field is written only once it has actually been
  // SET. That is what keeps the four storage states distinguishable, and the fixtures below
  // deliberately cover all four so both views can be eyeballed against each:
  //   1. rated + note      — the common case, and what the board sorts warmest-first;
  //   2. rated, no note    — the note field renders as its empty placeholder;
  //   3. note, NO rating   — `hasStoredRating` is false, so the board dims the card and
  //                          marks it unrated; padding it with a neutral 3 here would
  //                          fabricate a verdict nobody made;
  //   4. shown: false      — stored and rated, but filtered out of play mode; the row only
  //                          appears under the section's pencil.
  // Ratings are deliberately ASYMMETRIC (Brakkos is short with Pim; Pim worships him), since
  // each side is its own stored entry and nothing reconciles them.
  const buildRelEntry = ({ hearts, notes, shown } = {}) => {
    const entry = {};
    if (Number.isFinite(hearts)) entry.hearts = Math.max(1, Math.min(5, Math.trunc(hearts)));
    if (notes) entry.notes = String(notes);
    if (shown !== undefined) entry.shown = !!shown;
    return entry;
  };

  // "Is this stored entry still exactly what we seeded?" — the test behind every
  // never-clobber-the-GM decision about a settlement standing. Compares the three fields
  // an entry can hold rather than the objects wholesale: what comes back out of the
  // ObjectField is a plain object whose key ORDER is not guaranteed, so a stringify
  // comparison would report a false difference and quietly strand the seed forever.
  const sameRelEntry = (a, b) => {
    if (!a || typeof a !== "object" || !b || typeof b !== "object") return false;
    return a.hearts === b.hearts && (a.notes ?? "") === (b.notes ?? "") && a.shown === b.shown;
  };

  // How each PC regards the rest of the party and a couple of the steading's people, keyed
  // by the PRESET character name. Targets are resolved by name against the created PCs
  // first, then the seeded villagers; an unresolvable name is skipped, so trimming the
  // roster (SKIP_PLAYBOOKS) or a missing steading can't throw. Villager targets get an
  // explicit `shown: true` because that group starts HIDDEN on the character sheet
  // (defaultShown false in _buildRelationshipRows) — without it a rated villager would only
  // show under the pencil, which is what case 4 above is for and not what these want.
  const PC_RELATIONSHIPS = {
    Aerin: [
      { name: "Pim",             hearts: 5, notes: "She has known the boy since he was small enough to hide behind her skirts, and she would still put herself between him and whatever came." },
      { name: "Brakkos",         hearts: 4, notes: "Carried Maeve's water up the hill every morning of the winter and never mentioned it to a soul." },
      { name: "Old Bartholomew", hearts: 3, notes: "The law and her god ask different things of the same tired people. They are unfailingly courteous about it." },
      { name: "Sael",            hearts: 2, notes: "They serve the same light and cannot agree on what it wants. His certainty frightens her more than any darkness has." },
      // Case 3: a written note with no rating at all — the board dims this card and marks it
      // unrated rather than filing it under Neutral.
      { name: "Quill",                      notes: "She cannot make up her mind about the Fox, and she is honest enough to leave the question open rather than guess at it." },
      { name: "Maeve",           hearts: 5, notes: "The steadiest woman in Stonetop, and the one who least believes it of herself." },
      { name: "Bronwen",         hearts: 4, notes: "Knows every secret in the village and has never once traded one for advantage." },
    ],
    Quill: [
      // A deliberately LONG note: the board's card note is an expandable textarea, so this is
      // the row that overflows one line and grows its chevron.
      { name: "Wren",            hearts: 5, notes: "She found him half-frozen on the Maker's Road at the back end of winter and never once asked what he had been doing out there in the dark. He has never worked out how to say what that was worth, so he has settled for being wherever she happens to need him, which she has never asked for either." },
      { name: "Pim",             hearts: 4, notes: "The lad trails after him like a duckling. It is deeply annoying and he would not have it otherwise." },
      // Case 2: rated, no note — the note field shows its "How they feel, why…" placeholder.
      { name: "Maelis",          hearts: 3 },
      { name: "Old Bartholomew", hearts: 2, notes: "The Judge sees a thief before he sees a man, and has never troubled himself to look twice." },
      { name: "Coria",           hearts: 1, notes: "She has had him in the stocks twice and would put him there a third time before breakfast if the mood took her." },
      { name: "Vahid",           hearts: 5, notes: "Keeps a tab, keeps a secret, and keeps the good chair by the fire empty until he turns up." },
      { name: "Tierney",         hearts: 2, notes: "Buys cheap from people who need the coin that week. Quill has watched him do it and remembers." },
    ],
    Brakkos: [
      { name: "Aerin",           hearts: 5, notes: "Steady as a foundation stone. When she says a thing is worth doing he stops arguing and picks it up." },
      { name: "Coria",           hearts: 4, notes: "Drills the militia twice a week and has never asked anyone to stand where she would not stand herself." },
      { name: "Maelis",          hearts: 3, notes: "Reads too much and looks up too little. Somebody will have to be watching her when it matters." },
      { name: "Pim",             hearts: 2, notes: "The boy will get himself killed proving a point and it will be Brakkos who carries him home. He is short with him for that reason and no other." },
      { name: "Quill",           hearts: 2, notes: "Light fingers make a small village poorer, and he has said so to the Fox's face more than once." },
      { name: "Tobin",           hearts: 5, notes: "Took him in when nobody else would have the size of him in their house." },
      { name: "Pell",            hearts: 4, notes: "Went back onto the wall with three fingers gone. Brakkos will not hear a word said against him." },
    ],
    "Old Bartholomew": [
      { name: "Coria",           hearts: 4, notes: "The one other person in Stonetop who understands that a rule kept only when convenient was never a rule." },
      { name: "Aerin",           hearts: 4, notes: "They disagree on nearly everything, and he would still rather have her beside him at a hard meeting than anyone else." },
      { name: "Maelis",          hearts: 2, notes: "She digs where the old folk had the sense to leave the earth alone, and calls it scholarship." },
      { name: "Pim",             hearts: 2, notes: "All heat and no ballast. The boy would burn the village down to have a song made about him." },
      { name: "Quill",           hearts: 1, notes: "A thief is a thief until the day he makes restitution, and that day has not come." },
      { name: "Caradoc",         hearts: 4, notes: "Says what a thing will cost and then charges exactly that. There is no higher praise in the Judge's vocabulary." },
      { name: "Bronwen",         hearts: 2, notes: "Half of what the square believes about him started at her table, and she knows it." },
    ],
    Sael: [
      { name: "Maelis",          hearts: 5, notes: "The only one who asks what the light IS rather than what it can be made to do. He has told her things he has told nobody." },
      { name: "Aerin",           hearts: 4, notes: "She tends her god the way a farmer tends a field. He envies that more than he lets on." },
      // Case 4: rated and stored, but unticked — visible only under the section's pencil, so
      // the play-mode filter has something to hide.
      { name: "Wren",            hearts: 4, notes: "He has not decided what to make of her yet, and would rather not have the whole table reading his working.", shown: false },
      { name: "Brakkos",         hearts: 3, notes: "Good in the dark. Better than he knows, and Sael has not told him so." },
      { name: "Coria",           hearts: 2, notes: "She would keep every lantern inside the wall and call it prudence." },
      { name: "Tovia",           hearts: 4, notes: "First light, warm bread, and not one question about the lantern. Some mornings that is the whole of it." },
      { name: "Rhys",            hearts: 2, notes: "Shut the great gate in his face and left him on the mountain overnight. He is still deciding how to feel about that." },
    ],
    Coria: [
      { name: "Brakkos",         hearts: 5, notes: "When the line broke at the gate, he was the reason it did not stay broken." },
      { name: "Old Bartholomew", hearts: 4, notes: "Slow, stubborn, and right rather more often than she cares to admit." },
      { name: "Aerin",           hearts: 4, notes: "Walks into the worst room in the village and makes it a quieter one. Coria has never managed that trick." },
      { name: "Pim",             hearts: 3, notes: "Wants the boy nowhere near a real fight until he stops looking forward to one." },
      { name: "Quill",           hearts: 2, notes: "Useful, and a liability, and she has not yet settled which he is more of." },
      { name: "Pell",            hearts: 4, notes: "She sent him to that gate. He came back and went on drilling, and she has never once found the words." },
      { name: "Brogan",          hearts: 1, notes: "Rode up the Maker's Road with eight men and called it an escort. She counted them out loud." },
    ],
    Wren: [
      { name: "Quill",           hearts: 4, notes: "Came home half-frozen and made a joke of it, which is how she knew how bad it had been." },
      { name: "Maelis",          hearts: 4, notes: "Asks the right questions about the wrong places, and listens to the answers." },
      { name: "Pim",             hearts: 4, notes: "Wants the border walked with him every time. She has stopped pretending it is a chore." },
      { name: "Coria",           hearts: 3, notes: "Watches the wall and calls that the border. It is half a border and Wren walks the other half." },
      { name: "Sael",            hearts: 2, notes: "Carries fire into places that have done nothing to deserve it." },
      { name: "Ennis",           hearts: 5, notes: "An understanding, and neither of them has said the word aloud. She is in no hurry either." },
      { name: "Yannic",          hearts: 4, notes: "Reads the Wood nearly as well as she does and takes half the care doing it." },
    ],
    Maelis: [
      { name: "Sael",            hearts: 5, notes: "He answers the question she actually asked, which nobody else in this village has managed." },
      { name: "Wren",            hearts: 4, notes: "Will walk her to a ruin, wait outside it, and never once ask what she wanted with the place." },
      { name: "Pim",             hearts: 3, notes: "Carries her packs up the barrow without being asked and then asks a great many questions." },
      { name: "Brakkos",         hearts: 2, notes: "Calls her work 'the reading'. It is not affectionate." },
      { name: "Old Bartholomew", hearts: 1, notes: "He would have her stop asking and he has the standing to make it stick. She has not forgiven the business at the barrow." },
      { name: "Vahid",           hearts: 4, notes: "Every rumour in the Flats passes through his taproom and he remembers all of them in order." },
      { name: "Demetra",         hearts: 3, notes: "Writes back within the season, which is more than the Delve manages, and wants something for it." },
    ],
    Pim: [
      { name: "Brakkos",         hearts: 5, notes: "The biggest, strongest, bravest man Pim has ever seen, and he sparred with him twice without laughing once." },
      { name: "Aerin",           hearts: 5, notes: "The only grown soul in Stonetop who has never once told him to sit down and wait his turn." },
      { name: "Coria",           hearts: 4, notes: "Said he had good feet. It was one word and he has lived off it for a month." },
      { name: "Quill",           hearts: 4, notes: "Knows every roof in the village and has taught him three of them." },
      { name: "Old Bartholomew", hearts: 1, notes: "Told him in front of the whole square that ambition without ballast drowns a village. He has not stopped hearing it since." },
      { name: "Tobin",           hearts: 4, notes: "Leaves the forge fire banked for him and pretends it was an accident." },
      { name: "Gwilm",           hearts: 5, notes: "Told him the whole telling of the Titan Bones and did not once talk down to him." },
    ],
  };

  // How Stonetop stands with the wider world — the steading sheet's own relations table,
  // keyed by the settlement SLUGS in module/data/settlements.js (the roster is static, so
  // these keys are the storage keys; renaming one there orphans the rating). Same four
  // storage states as the PC table: a spread of 5..1, one note-only unrated entry, and one
  // rated row deliberately unticked so the play-mode filter drops it.
  //
  // The steading is the world's SINGLETON and is never deleted, so unlike everything else
  // this macro writes these entries need their own cleanup — see the delete branch, which
  // removes only the ones still holding exactly what was written here.
  const TEST_SETTLEMENT_RELS = {
    "gordins-delve":  { hearts: 5, notes: "Four days west and worth every one of them: near enough every sound tool in the village came up the West Road from the Delve." },
    "barrier-pass":   { hearts: 4, notes: "Closed, stoic, and dependable. The one trade track in the books that has never yet failed to be there." },
    "marshedge":      { hearts: 3, notes: "The richest neighbour and the most interested in what Stonetop has. The trade is good; the Council's attention is not." },
    // Note only, no rating: nobody here knows enough about the Manmarch to have judged it,
    // and the board says so rather than filing it under Neutral.
    "north-manmarch": {            notes: "Hundreds of hamlets under a half-dozen hillfort chiefs, and nobody here can say which of them speaks for the rest." },
    // Rated but unticked — visible under the Other Settlements pencil, dropped in play mode.
    "lygos":          { hearts: 3, notes: "A rare caravan and a great deal of southern paperwork. Kept off the list until somebody here has met a Lygotian twice.", shown: false },
    "ustrina":        { hearts: 2, notes: "Masked, black-robed, and never quite explaining themselves. Their steel is good and their terms are worse." },
    "the-fae":        { hearts: 2, notes: "Fickle powers of wood and fen. A bargain with them is kept exactly as it was struck and never as it was meant." },
    "hillfolk":       { hearts: 1, notes: "Raiders out of the Steplands took the winter stores and left Brennan dead at the gate. Nobody here is ready to hear about the bands that had no part in it." },
  };

  // Formatted rich-text seeded into the steading's Notes tab (the prose-mirror editor
  // bound to flags["stonetop-pwd"].steading.notes, rendered through TextEditor.enrichHTML).
  // Deliberately exercises the full range of blocks the editor produces — headings,
  // bold/italic, an unordered and an ordered list, a blockquote, a rule, a table, an
  // external link and an inline [[/roll]] enricher — so the Notes tab's styling can be
  // eyeballed on a test world. Seeded only when the field is empty (never clobbers notes
  // the GM wrote); the re-run cleanup clears it only while it still matches this exactly.
  const TEST_STEADING_NOTES = `<h2>The State of Stonetop</h2>
<p>A demonstration of <strong>formatted notes</strong> seeded by the test-fixtures macro. Every common block is here so you can see how the Notes tab renders each one. <em>Delete it (or re-run the macro) whenever you're done looking.</em></p>
<h3>Pressing concerns</h3>
<ul>
<li>The raiders out of the high country have grown bolder since the barley failed.</li>
<li>Something is <strong>arming the Hillfolk</strong> — mail and good steel where there should be hide and flint.</li>
<li>The old ford wants shoring up before the spring melt.</li>
</ul>
<h3>What to do first</h3>
<ol>
<li>Double the watch on the Maker's Road.</li>
<li>Send word to Marshedge asking after the strange trade in weapons.</li>
<li>Lay in a surplus against a hard winter.</li>
</ol>
<blockquote>
<p>"A village is only as strong as the folk willing to stand the wall." — Old Bartholomew, the Judge</p>
</blockquote>
<hr>
<p>See also the <a href="https://foundryvtt.com/">Foundry handbook</a> for the play procedures. When the omens are read this season, roll <strong>[[/r 2d6]]</strong> and consult the table below.</p>
<table>
<thead><tr><th>Roll</th><th>The season's turn</th></tr></thead>
<tbody>
<tr><td>10+</td><td>A bountiful season — gain a surplus.</td></tr>
<tr><td>7–9</td><td>Lean but steady — hold what you have.</td></tr>
<tr><td>6-</td><td>Hardship comes — mark a debility.</td></tr>
</tbody>
</table>`;

  // ── Steading test threats (Book I, "Threats") ──────────────────────────
  // Three demonstration threats seeded into the steading's Threats tab, so the GM Threats
  // tab isn't empty on a test world and every card layout can be eyeballed at once. The
  // three are deliberately STAGGERED so the cards fill out differently:
  //   1. a maximal Villain that exercises every section (rich prose, doom track, stakes,
  //      GM moves, nested lesser threats, and two custom player moves);
  //   2. a doom-heavy Affliction that leans on the grim-portent track + stakes, with no
  //      nested/custom moves;
  //   3. a sparse Magical entity with just an instinct, a little prose and a few GM moves —
  //      the minimal card.
  // Types span the accent palette (villain red / affliction brown / magical-entity violet)
  // and proximity covers all three trackers (nearby / homefront / distant), so the type
  // chips and tracker pips vary too.
  //
  // Storage must match module/threats/threat-store.js, which is what the Threats tab reads:
  // ALL of a steading's threats are `threat` PAGES of ONE journal named "<Steading> Threats",
  // pointed at by the steading's `threatsEntryId` flag. Threats are pure GM prep with no
  // per-threat reveal, so that single entry stays ownership NONE and nothing leaks — hence
  // no `revealed` field here. Each seeded page is flagged isTest so the re-run strips just ours.
  const TEST_THREATS = [
    {
      name: "The Crow-Mother",
      type: "villain",
      proximity: "nearby",
      instinct: "to be given flesh, and to make Stonetop kneel",
      description: `<p>Out in the black water of the Lygos marsh, something old has begun to stir. The folk of Stonetop call her the <strong>Crow-Mother</strong>, and for three generations she has been little more than a tale told to keep children away from the reeds. She is more than a tale now.</p>`
                 + `<p>Her cult grows quietly, one grieving heart at a time: a widow who wants her husband back, a father who cannot feed his children, a young fool who wants to matter. She asks for so little, at first.</p>`,
      grimPortents: [
        { text: "A trusted face in the village starts leaving offerings at the old marsh-shrine.", done: true },
        { text: "Livestock, and then children, begin to go missing on the moonless nights.", done: false },
        { text: "The cult moves openly, and the Judge's word no longer holds the square.", done: false },
      ],
      impendingDoom: { text: "The Crow-Mother is given a body of flesh and walks into Stonetop wearing a neighbor's face.", done: false },
      stakes: [
        "Who in Stonetop has already given themselves to Her, and how far will they go?",
        "What does the Crow-Mother truly want with this village, of all the villages there are?",
        "Which of the heroes will be tempted by what She quietly offers them?",
      ],
      gmMoves: [
        "Gain followers or allies",
        "Make an offer, with strings attached",
        "Reveal preparations made in advance",
        "Sacrifice another to advance a goal",
        "Do the unthinkable",
      ],
      nested: [
        { name: "The Cult of the Black Water", type: "institution", instinct: "to bring Her into the world" },
        { name: "Her Marsh-Ghouls",            type: "beast",       instinct: "to drag the offered down into the dark" },
      ],
      customPlayerMoves: [
        {
          label: "Ward Against the Crow",
          text: "<p>When you <strong>scatter salt and cold iron across a threshold and speak the old ward</strong>, roll +WIS. On a 10+, no servant of the Crow-Mother crosses it tonight. On a 7-9, it holds, but choose one: the effort costs you (mark a debility), or it holds only until you look away. On a 6-, you draw Her eye, and She is patient.</p>",
        },
        {
          label: "Crow-Haunted Rest",
          text: "<p>When you <strong>Recover in a place She has touched</strong>, you cannot clear a debility there. The rest is thin and crow-haunted, and you wake no better than you lay down.</p>",
        },
      ],
    },
    {
      name: "The Withering in the Stores",
      type: "affliction",
      proximity: "homefront",
      instinct: "to spread, to spoil, and to set neighbor against neighbor",
      description: `<p>It began in the barley: a handful of black-spotted grains in the bottom of a store-jar, easy enough to miss. Now it is in the root cellars, and the smell of sweet rot hangs over the square on the still mornings. Nothing green will keep. Nothing dried stays sound.</p>`
                 + `<p>The healers have no name for it and no cure. What they have is a growing fear that this is the hard winter old Bartholomew warned of, come early and come cruel.</p>`,
      grimPortents: [
        { text: "Black spots appear on the last of the stored barley.", done: true },
        { text: "The rot reaches the root cellars, and the smell carries to the square.", done: true },
        { text: "The first families sicken, and the healers cannot say why.", done: false },
        { text: "Neighbors begin to hoard, then to accuse, then to come to blows.", done: false },
      ],
      impendingDoom: { text: "Famine takes hold before the spring planting, and Stonetop empties out or turns upon itself.", done: false },
      stakes: [
        "Is the blight a thing of nature, or was it sown here on purpose?",
        "How many will the village lose before someone finds the cause?",
      ],
      gmMoves: [
        "Worsen or quicken",
        "Spread to others, suck others in",
        "Eat away at something or someone",
        "Trigger shortages, hoarding",
        "Sow panic or despair",
      ],
      nested: [],
      customPlayerMoves: [],
    },
    {
      name: "The Singing Tower",
      type: "magicalEntity",
      proximity: "distant",
      instinct: "to be answered",
      description: `<p>The herders swear a stone tower stands out past the old ford now, east along the treeline, where there was only open heath last spring. At dusk it is said to <em>sing</em>: a low, wordless note that carries for miles and sets the dogs to howling.</p>`
                 + `<p>No one who has gone out to answer it has yet come back to say what it wanted.</p>`,
      grimPortents: [],
      impendingDoom: { text: "", done: false },
      stakes: [],
      gmMoves: [
        "Appear in glimpses, dreams, visions",
        "Offer service, secrets, power",
        "Demand an oath or sacrifice",
      ],
      nested: [],
      customPlayerMoves: [],
    },
  ];

  // Random flavour pools for the seeded Player rows' Occupation / Relations / Notes
  // columns. PCs hold an ordinary village trade alongside their playbook, plus a tie to
  // the townsfolk above. Unlike the rest of the macro (deterministic "first option"),
  // these are drawn at RANDOM so a re-run reshuffles the roster's colour — the same
  // deliberate exception the arcana scatter makes with Math.random. The Players table
  // has no Traits column, so no traits pool.
  const PLAYER_OCCUPATIONS = [
    "Farmer", "Hunter", "Blacksmith", "Forester", "Healer", "Brewer",
    "Trapper", "Shepherd", "Fisherman", "Carpenter", "Cooper", "Herbalist",
    "Woodcutter", "Mason", "Tanner", "Fletcher",
  ];
  const PLAYER_RELATIONS = [
    "sweet on Tovia the baker's daughter",
    "apprenticed under Tobin the smith",
    "old drinking companion of Vahid the publican",
    "sworn to look after Maeve's boy Pell",
    "quarrels often with Bronwen the midwife",
    "kin to the horselords out in the Steplands",
    "owes a debt they'd rather not discuss to the Judge",
    "grew up alongside Ennis the cooper",
    "distrusted by the elders, adored by the young",
    "shares a hearth with Yannic the forester",
  ];
  const PLAYER_NOTES = [
    "Rarely seen without a blade close to hand.",
    "Keeps odd hours and stranger company.",
    "The children trail after them across the square.",
    "Has walked further from Stonetop than most ever will.",
    "Quick to volunteer for the dangerous work.",
    "Carries an old wound that aches before the rain.",
    "Speaks little, but folk lean in when they do.",
    "Trusted to keep a secret; asked to keep too many.",
    "Slips off toward the Wood whenever the mood takes them.",
    "Swears they've seen something out past the wall.",
  ];

  // Build the Players table from the created PCs, mirroring _onDropPlayerCharacter's
  // entry shape (id + uuid + name + img, checked). Each PC is dealt a random Occupation /
  // Relations / Notes: shuffle each pool once, then hand them out round-robin so the nine
  // PCs get distinct values. Traits are omitted — the Players table dropped that column.
  // isTest tags them for cleanup.
  const buildTestPlayers = (actors) => {
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const occs  = shuffle(PLAYER_OCCUPATIONS);
    const rels  = shuffle(PLAYER_RELATIONS);
    const notes = shuffle(PLAYER_NOTES);
    return actors.map((a, i) => ({
      id:        a.id,
      uuid:      a.uuid,
      name:      a.name,
      img:       a.img ?? "",
      checked:   true,
      occupation: occs[i % occs.length],
      relations: rels[i % rels.length],
      notes:     notes[i % notes.length],
      isTest:    true,
    }));
  };

  // Read the steading singleton's resolved flags (active scope first, then each legacy
  // scope newest-first), matching StonetopSteading._flags / StonetopFlags#resolvedFlags.
  // Returns a deep clone safe to mutate, or null when no steading exists.
  const readSteadingFlags = (steading) => {
    if (!steading) return null;
    let bag = steading.flags?.[FLAG_SCOPE]?.steading;
    for (const scope of LEGACY_SCOPES) bag = bag ?? steading.flags?.[scope]?.steading;
    return foundry.utils.deepClone(bag ?? {});
  };

  // Shape one TEST_THREATS seed into the `threat` page's system data. Mirrors
  // threat-store.js _shapeSeed, extended with the stakes / nested / custom-player-move
  // arrays that the full card renders (the macro is standalone and can't import the store).
  const shapeThreatSystem = (seed) => ({
    type:      seed.type ?? "villain",
    instinct:  String(seed.instinct ?? ""),
    proximity: seed.proximity ?? "nearby",
    description: String(seed.description ?? ""),
    grimPortents: (seed.grimPortents ?? []).map(p => ({
      text: String(typeof p === "string" ? p : p?.text ?? ""),
      done: !!(p && typeof p === "object" && p.done),
    })),
    impendingDoom: {
      text: String(seed.impendingDoom?.text ?? seed.impendingDoom ?? ""),
      done: !!seed.impendingDoom?.done,
    },
    stakes:  (seed.stakes ?? []).map(String),
    gmMoves: (seed.gmMoves ?? []).map(String),
    nested:  (seed.nested ?? []).map(n => ({
      name: String(n?.name ?? ""), type: String(n?.type ?? ""), instinct: String(n?.instinct ?? ""),
    })),
    customPlayerMoves: (seed.customPlayerMoves ?? []).map(m => ({
      label: String(m?.label ?? ""), text: String(m?.text ?? ""),
    })),
  });

  // Seed the demonstration threats the way the Threats tab actually stores them: as `threat`
  // PAGES appended to the steading's ONE "<name> Threats" journal, which the steading points at
  // via its `threatsEntryId` flag (module/threats/threat-store.js + journal/gm-prep-page-store.js).
  // Mirrors that store's ensureEntry/create: entry ownership NONE (threats are GM prep), entry
  // flagged threat:true, pages appended after whatever the GM already has filed, each page flagged
  // isTest so only ours are stripped. Returns { entryId, pages }: the entry id to record on the
  // steading pointer flag (or the existing pointer when we're not the GM, since only a GM may
  // create the journal) plus the created PAGE docs, so the example NPC can @UUID-link to one.
  //
  // Getting the shape right is what keeps the NPC's threat cross-link alive: a page uuid
  // (JournalEntry.<entry>.JournalEntryPage.<page>) points at a document the system reads and
  // keeps; the standalone-entry-in-a-folder shape an earlier version of this macro used was
  // invisible to the Threats tab and got swept, leaving the NPC holding a dead entry id.
  const SORT_STEP = 100000;
  const seedTestThreats = async (steadingActor, sf) => {
    if (!game.user?.isGM) return { entryId: sf?.threatsEntryId ?? null, pages: [] };
    const OWN = CONST.DOCUMENT_OWNERSHIP_LEVELS;

    let entry = sf?.threatsEntryId ? game.journal?.get(sf.threatsEntryId) : null;
    if (!entry) {
      entry = await JournalEntry.create({
        name:      `${steadingActor.name} Threats`,
        ownership: { default: OWN.NONE },
        flags:     { [FLAG_SCOPE]: { threat: true } },
      });
    }

    // Strip leftovers so a re-run can't duplicate: our own isTest pages, plus any unflagged
    // page carrying a TEST_THREATS name (worlds seeded before the pages were flagged ended up
    // with one stale copy per run). Threats the GM named something else are left alone.
    const testNames = new Set(TEST_THREATS.map(t => t.name));
    const stale = entry.pages
      .filter(p => p.type === "threat" && (p.getFlag?.(FLAG_SCOPE, TEST_FLAG) || testNames.has(p.name)))
      .map(p => p.id);
    if (stale.length) await entry.deleteEmbeddedDocuments("JournalEntryPage", stale);

    let sort = entry.pages.reduce((m, p) => Math.max(m, p.sort ?? 0), 0);
    const pages = await entry.createEmbeddedDocuments("JournalEntryPage", TEST_THREATS.map(seed => ({
      type:   "threat",
      name:   String(seed.name ?? "").trim() || "New Threat",
      sort:   (sort += SORT_STEP),
      system: shapeThreatSystem(seed),
      flags:  { [FLAG_SCOPE]: { [TEST_FLAG]: true } },
    })));
    return { entryId: entry.id, pages: pages ?? [] };
  };

  // ── GM Toolkit: the "I wonder..." list (Book I p.33) ───────────────────
  // The one surface on the GM Toolkit a GM AUTHORS rather than reads, and the only one with
  // nothing to look at until somebody types into it. Stored as a flat array on the toolkit's
  // own `actor.system.wonders` (module/data-models/fields.js), NOT on the steading and NOT on
  // the User: the Threats and Sites tabs next door resolve the steading first because their
  // storage moved there, this list never did.
  //
  // The spread covers every state the tab renders differently (see
  // templates/actor/partials/gm-toolkit-tab-wonder.hbs):
  //   * a dozen entries on the OPEN list, which is the list a GM reads mid-session;
  //   * six of those carrying an answer, so the always-visible <textarea> is seen holding a
  //     settled fact, a partial answer and a bare hunch, which is what the book asks the box
  //     to hold as much as it asks for a final answer;
  //   * six with an empty answer box, so the placeholder is seen too;
  //   * three already ticked into the collapsed Answered fold, which is a whole section that
  //     simply does not render while nothing is in it, and where the question is a static
  //     span rather than an input and the answer a paragraph rather than a box.
  // Questions are one line (the field caps at 300 characters) and lean on the world the rest
  // of this macro seeds, so a GM reading the tab meets the raiders, the tower and the cult the
  // threats and the example NPC already reference.
  const GM_TOOLKIT_TYPE = "gmToolkit";
  const TEST_WONDERS = [
    { question: "What did happen to the Forest Folk, and why will the Wood not say?",
      answer:   "No answer yet, only a shape: everything that touches them goes quiet rather than hostile. Whatever took them is still being polite about it." },
    { question: "Who is arming the Hillfolk, and what are they being armed for?",
      answer:   "Somebody with mail and good steel to spare, which rules out the hills entirely. Coria thinks Marshedge; I think whoever is paying Marshedge." },
    { question: "What stands out on the Flats that was not there last spring?",
      answer:   "" },
    { question: "Why will Yannic not speak of what he found at the old ford?",
      answer:   "" },
    { question: "What is the Cult of the Black Water actually praying to?",
      answer:   "Not a god. Something that answers like one, and that has been answering for a great deal longer than the cult has been asking." },
    { question: "Who showed the raiders the crossing?",
      answer:   "Someone who knew the watch roster, which is a short list. Half an answer at best, and I would rather it stayed half until the table forces it." },
    { question: "What is under the flooded undercroft at Marshedge, and who else is digging?",
      answer:   "" },
    { question: "Why have the bees swarmed early three years running?",
      answer:   "A hunch and nothing more: the Wood is warmer than it should be, and something in it is awake out of season." },
    { question: "What did Maelis leave behind in the barrow, and does it know her name?",
      answer:   "" },
    { question: "How long has Gordin's Delve been sending its ore somewhere other than here?",
      answer:   "" },
    { question: "What did Helior's flame actually take from Sael in exchange?",
      answer:   "Time, I think. He has not aged a day since he took it up, and neither has anything he loves." },
    { question: "If the Judge is wrong about the old ways, who in Stonetop already knows it?",
      answer:   "" },
    // Answered: ticked off the reading list, kept because the answer is now a decision about
    // the world that the rest of the prep rests on.
    { question: "Why did the herders stop taking the high pasture?",
      answer:   "Because two of them did not come back, and the rest agreed among themselves not to say so out loud.",
      settled:  true },
    { question: "Who has been leaving offerings at the shrine after dark?",
      answer:   "Bronwen, every week since the fever. She is not praying for herself and she does not want it known.",
      settled:  true },
    { question: "Was the winter fever natural?",
      answer:   "Yes. Everything since has not been, which is exactly why the village has decided the fever was the start of it.",
      settled:  true },
  ];

  // Does a stored row still hold EXACTLY what was seeded? The schema has no room for a flag of
  // our own (id / question / answer / settled and nothing else), so the seed IS the tag: same
  // question, same answer, same fold. A row the GM reworded, answered, ticked or reopened stops
  // matching and is theirs from then on. Same rule as the steading's Notes and settlement
  // standings, and for the same reason: these live on a SINGLETON the macro must never delete.
  const sameWonder = (row, seed) =>
    (row?.question ?? "") === seed.question
    && (row?.answer ?? "") === (seed.answer ?? "")
    && !!row?.settled === !!seed.settled;

  // The toolkit, its list, and that list minus anything still matching a seed — which is what
  // BOTH passes need: the seed pass drops stale seeds before adding this run's (so a partial
  // run that failed half way does not stack a second copy), and the delete pass drops them and
  // keeps the rest. Written out twice, the two would answer `sameWonder` differently the first
  // time its contract moved, and the delete pass would start leaving rows the seed pass replaces.
  // Null when there is no toolkit, since neither pass has anything to do without one.
  const unseededWonders = () => {
    const toolkit = game.actors?.find(a => a.type === GM_TOOLKIT_TYPE) ?? null;
    if (!toolkit) return null;
    const rows = Array.isArray(toolkit.system?.wonders) ? toolkit.system.wonders : [];
    return { toolkit, rows, keep: rows.filter(row => !TEST_WONDERS.some(seed => sameWonder(row, seed))) };
  };

  const seedGmToolkitWonders = async () => {
    const found = unseededWonders();
    if (!found) return null;
    const { toolkit, keep } = found;
    const seeded = TEST_WONDERS.map(seed => ({
      id:       foundry.utils.randomID(),
      question: seed.question,
      answer:   seed.answer ?? "",
      settled:  !!seed.settled,
    }));
    // The whole array, not a path into it: Foundry diffs an ArrayField by REPLACEMENT.
    await toolkit.update({ "system.wonders": [...keep, ...seeded] });
    return { toolkit, added: seeded.length, kept: keep.length };
  };

  // ── Toggle: delete existing test fixtures ──────────────────────────────
  // Any actor carrying the test flag — the [TEST] characters, the seeded Monster stat blocks,
  // and the example NPC (as well as any NPC fixtures left by older versions of this macro).
  const existing = game.actors.filter(a => a.getFlag(FLAG_SCOPE, TEST_FLAG));
  if (existing.length) {
    // Confirm before wiping — deletion is permanent and unrecoverable.
    const names = existing.map(a => a.name).sort((x, y) => x.localeCompare(y));
    const list  = names.map(n => `<li>${foundry.utils.escapeHTML(n)}</li>`).join("");
    const ok = await Dialog.confirm({
      title:   "Delete Test Fixtures",
      content: `<p>This will <strong>permanently delete</strong> ${existing.length} test fixture${existing.length === 1 ? "" : "s"}, any seeded test items and steading threats, and the test Introductions/Expedition data, then prune the matching Chronicle pages.</p>`
             + `<ul>${list}</ul>`
             + `<p><strong>This cannot be undone.</strong> Are you sure?</p>`,
      yes: () => true,
      no:  () => false,
      defaultYes: false,
    });
    if (!ok) { ui.notifications.info("[TEST] Deletion cancelled — nothing was removed."); return; }

    // Drop these PCs' recorded Introductions answers.
    const intro = { ...(game.settings.get(FLAG_SCOPE, "introductionsAnswers") ?? {}) };
    let introChanged = false;
    for (const a of existing) if (a.id in intro) { delete intro[a.id]; introChanged = true; }
    if (introChanged) await game.settings.set(FLAG_SCOPE, "introductionsAnswers", intro);

    // Remove the example expedition(s); keep their ids to prune the matching pages.
    const expLog     = game.settings.get(FLAG_SCOPE, "expeditionAnswers") ?? {};
    const expList    = Array.isArray(expLog.list) ? expLog.list : [];
    const testExpIds = expList.filter(e => e?.isTest).map(e => e.id);
    if (testExpIds.length) {
      const list      = expList.filter(e => !e?.isTest);
      const currentId = list.some(e => e.id === expLog.currentId) ? expLog.currentId : (list.at(-1)?.id ?? null);
      await game.settings.set(FLAG_SCOPE, "expeditionAnswers", { currentId, list });
    }

    // Prune the matching Chronicle pages (the test PCs + the example expedition) so the
    // compiled Chronicle keeps no stale test content. Pages carry the stable chronicleKey
    // the compiler stamps: the actor id, or "expedition:<id>". The Chronicle is a "The
    // Chronicle" journal FOLDER holding "Player Introductions" + "Expeditions"; an empty
    // journal (no real pages left) is removed, and an empty folder with it. Real pages
    // (other PCs, Spring Burst) aren't in killKeys, so they're left untouched.
    const killKeys = new Set([...existing.map(a => a.id), ...testExpIds.map(id => `expedition:${id}`)]);
    const pruneJournal = async (journal) => {
      if (!journal) return;
      const pageIds = (journal.pages ?? [])
        .filter(p => killKeys.has(p.getFlag?.(FLAG_SCOPE, "chronicleKey")))
        .map(p => p.id);
      if (pageIds.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", pageIds);
      if (!journal.pages?.size) await journal.delete();
    };
    const folder = game.folders?.find(f => f.type === "JournalEntry" && f.name === "The Chronicle");
    if (folder) {
      for (const journal of [...folder.contents]) await pruneJournal(journal);
      if (!folder.contents.length) await folder.delete();
    }
    // Legacy single "The Chronicle" journal (pre-folder structure), if one lingers.
    for (const j of (game.journal?.contents ?? []).filter(j => !j.folder && j.name === "The Chronicle")) {
      await pruneJournal(j);
    }

    // Delete any seeded test world items — the "Moves"/"Items" folder content this macro
    // creates, plus any NPC/Move/Insert fixtures left by older versions. (The now-empty
    // "Moves"/"Items"/"Monster" folders are pruned in the flagged-folder sweep below.)
    const testItems = game.items.filter(i => i.getFlag(FLAG_SCOPE, TEST_FLAG));
    if (testItems.length) await Item.deleteDocuments(testItems.map(i => i.id));

    // Delete the seeded test threats. They are `threat` PAGES of the steading's single
    // "<name> Threats" journal, so drop just the isTest pages plus any scene Note pins that
    // point at them — pins key on entryId + pageId since siblings share the entry, mirroring
    // threat-store.deleteThreat. Threats the GM wrote by hand are left alone; if ours were the
    // last pages, the emptied journal goes too and the steading's pointer with it (setFlag
    // MERGES and can't drop a key, hence the "-=" deletion syntax).
    const steadingThreats = game.actors.find(a => a.type === "stonetop" || a.system?.customType === "stonetop");
    const threatsEntryId  = readSteadingFlags(steadingThreats)?.threatsEntryId ?? null;
    const threatsEntry    = threatsEntryId ? game.journal?.get(threatsEntryId) : null;
    let testThreatCount   = 0;
    if (threatsEntry) {
      const killPageIds = new Set(threatsEntry.pages
        .filter(p => p.type === "threat" && p.getFlag?.(FLAG_SCOPE, TEST_FLAG))
        .map(p => p.id));
      testThreatCount = killPageIds.size;
      if (killPageIds.size) {
        for (const scene of (game.scenes ?? [])) {
          const noteIds = scene.notes
            .filter(n => n.entryId === threatsEntry.id && killPageIds.has(n.pageId))
            .map(n => n.id);
          if (noteIds.length) await scene.deleteEmbeddedDocuments("Note", noteIds).catch(() => {});
        }
        await threatsEntry.deleteEmbeddedDocuments("JournalEntryPage", [...killPageIds]);
      }
      if (!threatsEntry.pages?.size) {
        await threatsEntry.delete().catch(() => {});
        await steadingThreats?.update({ [`flags.${FLAG_SCOPE}.steading.-=threatsEntryId`]: null });
      }
    }

    // Legacy sweep: an earlier version of this macro filed each threat as its OWN JournalEntry
    // in a "<name> Threats" FOLDER — a shape the Threats tab never read. Remove any that linger
    // (and their pins) so a world seeded by that version comes back clean.
    const legacyThreatEntries = (game.journal?.contents ?? []).filter(
      j => j.id !== threatsEntryId && j.getFlag(FLAG_SCOPE, "threat") && j.getFlag(FLAG_SCOPE, TEST_FLAG));
    if (legacyThreatEntries.length) {
      const killEntryIds = new Set(legacyThreatEntries.map(e => e.id));
      for (const scene of (game.scenes ?? [])) {
        const noteIds = scene.notes.filter(n => killEntryIds.has(n.entryId)).map(n => n.id);
        if (noteIds.length) await scene.deleteEmbeddedDocuments("Note", noteIds).catch(() => {});
      }
      await JournalEntry.deleteDocuments([...killEntryIds]);
      testThreatCount += killEntryIds.size;
    }

    // Defensive: only delete ids that still exist, so a hand-deletion (or any race that
    // slips past the re-entrancy guard) can't throw "Actor id … does not exist".
    const liveIds = existing.map(a => a.id).filter(id => game.actors.has(id));
    if (liveIds.length) await Actor.deleteDocuments(liveIds);

    // Strip the steading's test Residents / Neighbors / Players (anything tagged isTest),
    // leaving members the GM added by hand untouched. The singleton actor is never deleted.
    const steadingDel  = game.actors.find(a => a.type === "stonetop" || a.system?.customType === "stonetop");
    const steadingFlags = readSteadingFlags(steadingDel);
    let strayPeople = 0;
    if (steadingFlags) {
      let memberChanged = false;
      for (const key of ["residents", "neighbors", "players"]) {
        const arr = steadingFlags[key];
        if (!Array.isArray(arr)) continue;
        const next = arr.filter(m => !m?.isTest);
        if (next.length !== arr.length) { steadingFlags[key] = next; memberChanged = true; }
      }
      // Legacy sweep: earlier versions seeded Residents/Neighbors as plain-TEXT rows, and the
      // ready-hook migration (steading-people.js#migrateSteadingPeople) rewrote each of those
      // into an NPC actor + pointer row on the next world load — dropping `isTest` in the
      // process, so neither the row filter above nor the actor sweep can see them and every
      // re-run would stack another copy of the village. Recognise a stray by matching one of
      // our fixtures EXACTLY: same name, sitting in a people folder, and carrying the three
      // columns migration copied verbatim. An NPC the GM wrote would have to match all of
      // that to be caught, at which point it IS one of ours.
      const FIXTURE_PEOPLE  = new Map([...STEADING_TEST_RESIDENTS, ...STEADING_TEST_NEIGHBORS].map(p => [p.name, p]));
      const PEOPLE_FOLDER_NAMES = new Set(["Residents of Stonetop", "Neighbors of Stonetop"]);
      const strayIds = new Set();
      for (const key of ["residents", "neighbors"]) {
        const arr = steadingFlags[key];
        if (!Array.isArray(arr)) continue;
        const next = arr.filter(row => {
          const actor = (row?.id ? game.actors.get(row.id) : null)
            ?? (row?.uuid ? game.actors.find(a => a.uuid === row.uuid) : null);
          const seed  = actor ? FIXTURE_PEOPLE.get(actor.name) : null;
          // No actor (already deleted, or a legacy text row) or a name we never seeded: keep.
          if (!actor || !seed) return true;
          if (actor.getFlag(FLAG_SCOPE, TEST_FLAG)) return true;   // ours, and already handled
          if (!PEOPLE_FOLDER_NAMES.has(actor.folder?.name)) return true;
          const s = actor.system ?? {};
          if ((s.occupation ?? "") !== (seed.occupation ?? "")) return true;
          if ((s.traits ?? "")     !== (seed.traits ?? ""))     return true;
          if ((s.relations ?? "")  !== (seed.relations ?? ""))  return true;
          strayIds.add(actor.id);
          return false;
        });
        if (next.length !== arr.length) { steadingFlags[key] = next; memberChanged = true; }
      }
      if (strayIds.size) await Actor.deleteDocuments([...strayIds]);
      strayPeople = strayIds.size;

      // Clear the seeded formatted Notes only while they still hold this exact test
      // content (leave notes the GM has since edited alone).
      if (steadingFlags.notes === TEST_STEADING_NOTES) { steadingFlags.notes = ""; memberChanged = true; }
      if (memberChanged) await steadingDel.setFlag(FLAG_SCOPE, "steading", steadingFlags);

      // Clear the seeded "Other Settlements" ratings. Everything else this macro writes
      // rides on a document it deletes; these live in the singleton steading's
      // `system.relationships` and would otherwise outlive every cleanup. Same rule as the
      // Notes above: a slug is dropped only while it still holds EXACTLY what was seeded,
      // so a rating the GM has since moved (or a note they extended) is theirs and stays.
      // An update MERGES, so a key is removed with the "-=" deletion syntax rather than by
      // writing the object back without it.
      const relKill = {};
      for (const [slug, seed] of Object.entries(TEST_SETTLEMENT_RELS)) {
        const stored = steadingDel.system?.relationships?.[slug];
        if (stored === undefined) continue;
        if (!sameRelEntry(stored, buildRelEntry(seed))) continue;
        relKill[`system.relationships.-=${slug}`] = null;
      }
      if (Object.keys(relKill).length) await steadingDel.update(relKill);
      // Legacy: the "<name> Threats" FOLDER an older version of this macro created, plus the
      // steading's stale pointer to it. Dropped once it's empty; setFlag MERGES (can't drop a
      // key), so the pointer is cleared with the "-=" deletion syntax. Left intact when the GM
      // has filed something of their own there.
      const threatsFolder = steadingFlags.threatsFolderId ? game.folders?.get(steadingFlags.threatsFolderId) : null;
      if (threatsFolder && !threatsFolder.contents.length) {
        await threatsFolder.delete().catch(() => {});
        await steadingDel.update({ [`flags.${FLAG_SCOPE}.steading.-=threatsFolderId`]: null });
      }
    }

    // Strip the seeded "I wonder..." questions from the GM Toolkit. Like the steading, the
    // toolkit is a SINGLETON the macro never creates or deletes (hooks/StonetopSingleton.js
    // refuses the delete outright), and its list rides on a document nothing else here takes
    // down, so without this pass every re-run would leave the last run's fifteen questions
    // behind and stack fifteen more on top. A row goes only while it still matches its seed
    // exactly (see sameWonder) — one the GM reworded, answered or ticked is theirs and stays.
    const foundDel = unseededWonders();
    let wonderCount = 0;
    if (foundDel) {
      const { toolkit: toolkitDel, rows, keep } = foundDel;
      wonderCount = rows.length - keep.length;
      if (wonderCount) await toolkitDel.update({ "system.wonders": keep });
    }

    // Sweep up the old "Stonetop Test Fixtures" folders if a prior run left them behind and
    // they're now empty. (The "PCs" folder is left alone — it may hold real characters; the
    // steading singleton is never touched.)
    for (const type of ["Actor", "Item"]) {
      const f = game.folders?.find(x => x.type === type && x.name === "Stonetop Test Fixtures");
      if (f && !f.contents.length) await f.delete();
    }
    // Prune our own flagged test folders ("Moves"/"Items" Item folders and the "Monster"
    // Actor folder) now that their contents are gone. Only folders this macro created (isTest)
    // and now empty are removed, so a same-named folder the GM made by hand is left intact.
    for (const type of ["Actor", "Item"]) {
      for (const f of (game.folders?.filter(x => x.type === type && x.getFlag(FLAG_SCOPE, TEST_FLAG)) ?? [])) {
        if (!f.contents.length) await f.delete();
      }
    }
    ui.notifications.info(`[TEST] Deleted ${existing.length} test actor(s), ${testItems.length} item(s), ${testThreatCount} threat(s)${wonderCount ? `, ${wonderCount} "I wonder..." question(s)` : ""}${strayPeople ? `, ${strayPeople} migrated resident/neighbor NPC(s) an older run left behind` : ""}, and their test data.`);
    return;
  }

  // ── Ask: max out the created characters' level? ────────────────────────
  // Only reached on the CREATE path (the delete branch above returns first). Three
  // outcomes: Max Level → climb every character to exhaustion; Level 1 → plain
  // freshly-created characters; dismiss (X) → cancel without creating anything. Defaults
  // to "Level 1" so a stray Enter doesn't kick off the slower climb.
  const maxLevel = await new Promise((resolve) => {
    let choice = null; // stays null if dismissed → treated as cancel
    new Dialog({
      title: "Create Test Characters",
      content: `<p>Create one <strong>[TEST]</strong> character per playbook (9 total).</p>`
             + `<p><strong>Max out their level?</strong> This drives the real level-up engine to climb each character until no move remains (level 20+), taking every reachable move, stat increase, invocation and mark along the way. It takes noticeably longer than a plain build.</p>`
             + `<p>Each character is also dealt a random spread of arcana: the major arcana split evenly across the whole roster, plus 3 random minor arcana each.</p>`
             + `<p>Choose <em>Level 1</em> for plain, freshly-created characters.</p>`
             + `<p style="margin-top:8px; padding:8px 10px; border-left:3px solid #b58a3c; background:rgba(181,138,60,0.14); border-radius:3px;">`
             + `<i class="fas fa-triangle-exclamation" style="margin-right:6px; color:#b58a3c;"></i>`
             + `<strong>Maxing out the level takes a while.</strong> Climbing all nine characters through the level-up engine can run a minute or two, and Foundry may look frozen while it works. Please be patient and don't re-run the macro until it finishes.</p>`,
      buttons: {
        max: { icon: '<i class="fas fa-angles-up"></i>', label: "Max Level", callback: () => { choice = true; } },
        one: { icon: '<i class="fas fa-user"></i>',      label: "Level 1",   callback: () => { choice = false; } },
      },
      default: "one",
      close: () => resolve(choice),
    }).render(true);
  });
  if (maxLevel === null) { ui.notifications.info("[TEST] Creation cancelled — nothing was created."); return; }

  // ── Load pack ──────────────────────────────────────────────────────────
  const pack = game.packs.get(PACK_ID);
  if (!pack) { ui.notifications.error(`Pack not found: ${PACK_ID}`); return; }

  const allDocs      = await pack.getDocuments();
  const playbookDocs = allDocs.filter(d =>
    d.type === "playbook" && !SKIP_PLAYBOOKS.has(d.name?.toLowerCase()));
  const allMoveDocs  = allDocs.filter(d => d.type === "move" && d.system?.playbook);
  // Arcana were split into their own (GM-only) compendium; the Major/Minor
  // folder ids are preserved across the move.
  const arcanaPack   = game.packs.get(ARCANA_PACK_ID);
  const arcanaDocs   = arcanaPack ? await arcanaPack.getDocuments() : [];
  const majorArcana  = arcanaDocs.filter(d => (d.folder?.id ?? d.folder) === MAJOR_FOLDER);
  const minorArcana  = arcanaDocs.filter(d => (d.folder?.id ?? d.folder) === MINOR_FOLDER);

  // ── Build selections object for one playbook ───────────────────────────
  function buildSelections(pbDoc) {
    const f    = pbDoc.flags?.stonetop ?? {};
    const slug = pbDoc.system?.slug ?? "";
    // This fork's slugs are prefixed "the-"; the PRESET table is keyed by the short slug.
    const preset  = PRESET[slug.replace(/^the-/, "")] ?? DEFAULT_PRESET;

    // Background
    const bgs    = f.backgrounds ?? [];
    const selBg  = pick(bgs);
    const bSlug  = selBg?.slug ?? "";
    // The background's move grants: its flat `moves` list plus whichever option a
    // move-applying `setup.choices` entry lands on (A Life of Crime grants Burgle OR
    // Light Fingers). `pick` is deterministic, so recomputing it here matches the value
    // bsChoices settles on further down — this just needs it before the move picks.
    const bgMoveNames = new Set(selBg?.moves ?? []);
    for (const c of ((selBg?.setup?.choices) ?? [])) {
      if (c.apply !== "move" || !c.key) continue;
      const chosen = pick(c.options ?? [])?.value;
      if (chosen) bgMoveNames.add(chosen);
    }

    // Instinct — one of two paths (see PRESET). When the preset names an
    // `instinctWord`, select the matching built-in suggestion from the playbook's
    // `instincts` list and compose the sheet's "Word — Description" value from it
    // (mirroring composeInstinct in module/utils/strings.js), so the character reads
    // as having picked a suggestion. Otherwise the character wrote their own: compose the
    // same "Word — Description" value from the preset's one-word `instinct` (reduced to a
    // single token by oneWord — the sheet/onboarding strip the custom word field to one
    // token) and its written `instinctDesc`, so the custom instinct fills BOTH halves the
    // sheet's custom fields expect. An `instinctWord` that no longer matches any suggestion
    // falls back to that word alone (no description), itself already one token.
    const INSTINCT_SEPARATOR = " — ";
    const oneWord = (s) => String(s ?? "").trim().split(/\s+/)[0] ?? "";
    const wantWord = String(preset.instinctWord ?? "").trim().toLowerCase();
    const matchOpt = wantWord
      ? (f.instincts ?? []).find(o => String(o?.word ?? "").trim().toLowerCase() === wantWord)
      : null;
    const instinctValue = matchOpt
      ? [matchOpt.word, matchOpt.description].map(s => String(s ?? "").trim()).filter(Boolean).join(INSTINCT_SEPARATOR)
      : [oneWord(preset.instinct ?? preset.instinctWord), String(preset.instinctDesc ?? "").trim()].filter(Boolean).join(INSTINCT_SEPARATOR);

    // Appearance — one option per line
    const appearance = {};
    (f.appearance ?? []).forEach((opts, i) => { appearance[String(i)] = pick(opts); });

    // Origin — first region. The character NAME comes from the PRESET, not the origin
    // name list, so each playbook always gets the same, recognizable character name.
    const selOrigin    = pick(f.origin ?? []);
    const originRegion = selOrigin?.region ?? "";
    const charName     = String(preset.name ?? "").trim();

    // Stats — the PRESET's fixed per-stat modifiers, so the same playbook always shows
    // the same stat line.
    const stats = Object.fromEntries(STAT_KEYS.map(k => [k, Number(preset.stats?.[k] ?? 0)]));

    // Possessions — pickCount is already the number to choose beyond the
    // preselected ones (e.g. Blessed: "Pick 2, in addition to your sacred
    // pouch"), and possAvail already excludes preselected slugs, so pick
    // pickCount directly — don't subtract preselected again.
    const rawPoss     = f.specialPossessions ?? {};
    const preselected = new Set(rawPoss.preselected ?? []);
    const possAvail   = (rawPoss.options ?? []).map(o => o.slug).filter(s => !preselected.has(s));
    const possessions = pickN(possAvail, rawPoss.pickCount ?? 0);

    // Possession sub-choices: "pick N" bundles (Weapons of war, Symbol of
    // authority…) and "choose 1 per line" flavor groups (the Blessed's sacred
    // pouch). Fill for every possession we own — selected or preselected — that
    // carries them, so the possession step reads complete and the sub-options
    // exercise the layout. Keyed possessionSlug → chosen sub-slugs.
    const ownedPossSlugs    = new Set([...preselected, ...possessions]);
    const possessionChoices = {};
    for (const opt of (rawPoss.options ?? [])) {
      if (!ownedPossSlugs.has(opt.slug)) continue;
      const subPicks = [];
      if (opt.choices?.options?.length) {
        subPicks.push(...pickN(opt.choices.options, opt.choices.pickCount ?? 0).map(o => o.slug));
      }
      for (const cg of (opt.choiceGroups ?? [])) {
        for (const sg of (cg.subgroups ?? [])) {
          const sgOpts = sg.options ?? [];
          if (!sgOpts.length) continue;
          if (sg.multiSelect) subPicks.push(...pickN(sgOpts, 1 + rng(sgOpts.length)).map(o => o.slug));
          else subPicks.push(pick(sgOpts).slug);
        }
      }
      if (subPicks.length) possessionChoices[opt.slug] = subPicks;
    }

    // Moves
    const movePickCount = parseMovePickCount(f.moves?.startingMovesNote);
    const pbMoves       = allMoveDocs.filter(d => {
      const pb = d.system?.playbook;
      return pb === pbDoc.name || pb?.name === pbDoc.name;
    });
    // "Either X OR Y" starting-move groups (e.g. the Heavy's Armored OR Uncanny
    // Reflexes) are granted separately via moveChoices, so keep them out of the
    // free-pick pool — mirroring the onboarding moves step.
    const choiceMoveNames = new Set((f.moves?.choices ?? []).flatMap(g => g.options ?? []));
    // Only moves the character is GUARANTEED to end up with can satisfy a free pick's
    // `requirement.moves` — an either/or option isn't guaranteed (one per group is taken),
    // so a Fox who picked Ambush must not be handed Parry & Riposte, which needs Skill at
    // Arms. Mirrors the onboarding moves step.
    const grantedNames  = new Set([
      ...pbMoves.filter(d => d.system?.isStartingMove && !choiceMoveNames.has(d.name)).map(d => d.name),
      ...bgMoveNames,
    ]);
    const eligible      = pbMoves.filter(d => {
      if (d.system?.isStartingMove)           return false;
      if (bgMoveNames.has(d.name))            return false;
      if (choiceMoveNames.has(d.name))        return false;
      if ((d.system?.requirement?.level ?? 1) > 1) return false;
      return (d.system?.requirement?.moves ?? []).every(r => grantedNames.has(r));
    });
    const moves = pickN(eligible, movePickCount).map(d => d.id);

    // "Either X OR Y" starting-move picks: choose one name per group, resolved to
    // its compendium id and keyed by group index, as the apply step expects.
    const moveByName  = new Map(pbMoves.map(d => [d.name, d]));
    const moveChoices = {};
    (f.moves?.choices ?? []).forEach((group, i) => {
      const chosenName = pick(group.options ?? []);
      const doc = moveByName.get(chosenName) ?? allMoveDocs.find(d => d.name === chosenName);
      if (doc) moveChoices[i] = doc.id;
    });

    // Lore — pick-type sections get random picks; text-type get placeholder answers
    const lorePicks = {};
    const loreTexts = {};
    for (const section of (f.lore ?? [])) {
      const textOpts = (section.options ?? []).filter(o => o.type === "text");
      const pickOpts = (section.options ?? []).filter(o => o.type !== "text");
      if (textOpts.length) {
        for (const opt of textOpts) {
          const k = `${section.slug}:${opt.slug}`;
          loreTexts[k] = answerFor(`lore:${k}`, opt.description);
        }
      } else if (pickOpts.length) {
        const n = parseLorePickMin(section.description);
        for (const opt of pickN(pickOpts, n)) lorePicks[`${section.slug}:${opt.slug}`] = 1;
      }
    }

    // Background setup (choices, free-text fields, neighbor traits + picks)
    const bsChoices        = {};
    const bsTexts          = {};
    const bsNeighborTraits = {};
    const bsNeighborPicks  = {};
    const setup = selBg?.setup ?? null;
    if (setup) {
      for (const c of (setup.choices ?? []))
        bsChoices[c.key] = pick(c.options ?? [{ value: "" }])?.value ?? "";
      for (const t of (setup.texts ?? []))
        bsTexts[t.key] = answerFor(`text:${t.key}`, t.placeholder ?? t.label);
      // Free-text per-neighbor trait fields (e.g. the Ranger's hometown neighbors).
      for (const n of (setup.neighbors ?? []))
        if (n.traitKey) bsNeighborTraits[n.traitKey] = answerFor(`neighbor:${n.traitKey}`, n.traitLabel);
      for (const nc of (setup.neighborChoices ?? []))
        bsNeighborPicks[nc.key] = pickN(nc.options ?? [], nc.count ?? 2).map(o => o.value);
    }

    // Background move choices (e.g. Seeker "Well Versed in…")
    const backgroundChoices = {};
    for (const choice of (selBg?.moveChoices ?? [])) {
      const key = choice.move ?? choice.slug ?? choice.label ?? "";
      if (!key) continue;
      backgroundChoices[key] = {
        label: choice.label ?? key,
        value: choice.value ?? pick(choice.options ?? [""]),
      };
    }

    // Beast-Bonded markable actions (the Ranger): mark the level-1 allotment so the
    // background step reads complete (allowed = milestone levels reached at 1st).
    const markable = selBg?.markableActions;
    const markedActions = markable?.options?.length
      ? pickN(markable.options, (markable.levels ?? [1]).filter(l => l <= 1).length).map(o => o.slug)
      : [];

    const sel = {
      name: charName, backgroundSlug: bSlug, instinctValue,
      appearance, originRegion, stats, possessions, possessionChoices, moves, moveChoices,
      backgroundSetup: { choices: bsChoices, texts: bsTexts, neighborTraits: bsNeighborTraits, neighborPicks: bsNeighborPicks },
      backgroundChoices,
      markedActions,
      lore: { picks: lorePicks, texts: loreTexts },
      notes: TEST_PC_NOTES[slug.replace(/^the-/, "")] ?? "",
    };

    // ── Playbook-specific fields ─────────────────────────────────────────

    // The Blessed (Initiate background only): choose 2–3 initiates
    if (slug === "the-blessed" && bSlug === "initiate") {
      const initData = bgs.find(b => b.slug === "initiate")?.choices ?? {};
      const [mn, mx] = initData.count?.length ? [Math.min(...initData.count), Math.max(...initData.count)] : [2, 3];
      const cnt = mn + rng(mx - mn + 1);
      const initOpts = initData.options ?? [];
      sel.initiates      = pickN(initOpts, cnt).map(o => o.slug);
      // Each chosen initiate also needs its choiceRows answered (pronoun + the
      // remaining rows), or the initiates step reads as incomplete.
      sel.initiateDetails = {};
      for (const iSlug of sel.initiates) {
        const opt = initOpts.find(o => o.slug === iSlug);
        if (!opt) continue;
        const det = { rows: {} };
        (opt.choiceRows ?? []).forEach((row, rowIdx) => {
          const value = pick(row.options ?? [""]);
          if (row.type === "pronoun") det.pronoun = value;
          else det.rows[rowIdx] = value;
        });
        sel.initiateDetails[iSlug] = det;
      }
    }

    // The Lightbearer: pick startingCount invocations
    if (slug === "the-lightbearer") {
      const inv = f.invocations ?? {};
      sel.invocations = pickN(inv.options ?? [], inv.startingCount ?? 2).map(o => o.slug);
    }

    // The Marshal: build crew with background tag + additionalTagCount more tags
    if (slug === "the-marshal") {
      const crew   = f.crew ?? {};
      const bgTag  = crew.backgroundTags?.[bSlug] ?? null;
      const pool   = (crew.availableTags ?? []).filter(t => t !== bgTag);
      sel.crew = {
        name:    pick(["The Stonetop Irregulars", "The Hearthwatch", "Brennan's Old Company"]),
        tags:    pickN(pool, crew.additionalTagCount ?? 2),
        instinct: pick(crew.instincts ?? [""]),
        cost:     pick(crew.costs ?? [""]),
      };
    }

    // The Ranger: pick animal companion type and traits
    if (slug === "the-ranger") {
      const ac   = f.animalCompanion ?? {};
      const type = pick(ac.types ?? [{ slug: "predator", pickCount: 3, traits: [], examples: "wolf" }]);
      // `kind` is a required free-text field; the sheet seeds suggestions from the
      // type's comma-separated `examples` (trailing punctuation stripped), so pick one.
      const kindOpts = String(type.examples ?? "")
        .replace(/[.…]+$/g, "").split(",").map(s => s.trim()).filter(Boolean);
      sel.animalCompanion = {
        type:    type.slug,
        kind:    kindOpts.length ? pick(kindOpts) : "Wolf",
        name:    pick(["Bramble", "Ash", "Whistle", "Old Greycoat", "Pip"]),
        traits:  pickN(type.traits ?? [], type.pickCount ?? 3),
        instinct: pick(ac.instincts ?? [""]),
        cost:     pick(ac.costs ?? [""]),
      };
    }

    // The Seeker: assign major arcanum + draw 3 minor arcana.
    // On the Max-Level path this is skipped: the post-creation pass below scatters
    // arcana across the WHOLE roster (Seeker included), so applying the Seeker's
    // deterministic onboarding draw here as well would double it up.
    if (slug === "the-seeker" && !maxLevel) {
      const major = pick(majorArcana);
      const drawn = pickN(minorArcana, 3);
      sel.arcana = {
        major:      major?.flags?.stonetop?.slug,
        minorDraw:  drawn.map(d => d.flags?.stonetop?.slug),
        minorRoles: {
          mastered: drawn[0]?.flags?.stonetop?.slug,
          found:    drawn[1]?.flags?.stonetop?.slug,
          lead:     drawn[2]?.flags?.stonetop?.slug,
        },
      };
    }

    return sel;
  }

  // ── Test custom move + follower ────────────────────────────────────────
  // Seed every created character with one player-authored custom "Other" move and
  // one custom follower, both filled out end-to-end, so the Moves tab's custom-move
  // card and the Followers tab's custom-follower card are exercised on every sheet
  // (mirroring how the arcana scatter touches every character). Both live ON the
  // actor — the move is an embedded `move` item (moveType "other", flagged
  // stonetop-pwd.custom), the follower is an actor flag under customFollowers — so the
  // re-run's Actor.deleteDocuments tears them down with the character; no separate
  // cleanup is needed.

  // Raw authoring input for addCustomMove — the same shape CustomMoveDialog._save
  // gathers. buildCustomMoveData forces moveType "other", the custom flag, and the
  // 10+/7-9/6- moveResults sub-object; we only supply raw fields. Every
  // field is populated so all of them render: a +WIS roll with all three result lines,
  // a 3-box resource track, the no-XP-on-miss toggle, and the passive HP/armor/load
  // bonuses.
  const TEST_CUSTOM_MOVE = {
    name: "This is a test",
    description: "A demonstration custom move seeded by the test-fixtures macro. It fills in every field "
               + "the custom-move dialog offers, so you can see how each one renders on a move card.\n\n"
               + "Delete it (or the whole [TEST] roster) whenever you're done looking.",
    rollType: "wis",
    results: {
      success: "You see exactly what a fully filled-out custom move looks like — roll result, outcome lines, resource track, and bonuses all on the card.",
      partial: "You see most of it, but something's a little off. Pick one field you'd tweak and note it.",
      failure: "The example glitches. The GM points out which part looks wrong — and since this move ignores misses, you don't mark XP.",
    },
    noXpOnMiss: true,
    resource: { title: "Test Charges", max: 3, labels: "Spark, Ember, Blaze" },
    hpBonus: "2",
    armorBonus: "1",
    loadBonus: "1",
  };

  // ── Test love letters (Book I p.569) ───────────────────────────────────
  // The four worked love-letter examples from the book, dealt across the roster (see
  // testLoveLettersFor) so the top-of-Moves "Love Letters" section is exercised across
  // everything the feature does:
  //   - Rhianna & Caradoc — shared list + "pick N" (the roll decides how many to pick),
  //     rendered as an interactive checklist on the card
  //   - Vahid & Blodwen  — distinct per-tier 10+/7-9/6- prose, no shared list
  //   - Blodwen also exercises noXpOnMiss (its 6- is the one example that does NOT mark XP)
  // All four carry a "signed" sign-off. Like the custom move they're embedded `move`
  // items living ON the actor — flagged stonetop-pwd.loveLetter (NOT custom, so no
  // player edit UI, and they never land in the "Other Moves" list) — so the re-run's
  // Actor.deleteDocuments tears them down with the character; no separate cleanup.
  //
  // Shaping mirrors buildLoveLetterData (module/actors/character/love-letters.js — this
  // macro is standalone and can't import it): the body is escaped + paragraph-wrapped
  // exactly like formatCustomMoveDescription (escHtml maps ' → &#x27;, so the letter
  // round-trips losslessly through the GM edit dialog), moveType is forced to "other",
  // moveResults follows the { success|partial|failure: { label, value, pick } } shape,
  // and pickOptions / signed / noXpOnMiss carry the newer authoring fields.
  const _LL_HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
  const escLoveLetterBody = (raw) => String(raw ?? "").trim()
    ? String(raw).trim().split(/\n{2,}/)
        .map(p => `<p>${p.replace(/[&<>"']/g, c => _LL_HTML_ESC[c]).replace(/\n/g, "<br>")}</p>`)
        .join("")
    : "";
  const _llPickN = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 0; };
  const buildLoveLetterItem = ({ name, description, rollType, results, options, picks, signed, noXpOnMiss }) => {
    const rt   = String(rollType ?? "").trim().toLowerCase();
    const stat = STAT_KEYS.includes(rt) ? rt : "";
    const s = String(results?.success ?? "").trim();
    const p = String(results?.partial ?? "").trim();
    const f = String(results?.failure ?? "").trim();
    const opts = Array.isArray(options) ? options.map(o => String(o).trim()).filter(Boolean) : [];
    const pS = _llPickN(picks?.success), pP = _llPickN(picks?.partial), pF = _llPickN(picks?.failure);
    const moveResults = (stat && (s || p || f || pS || pP || pF || opts.length))
      ? {
          success: { label: "10+", value: s, pick: pS },
          partial: { label: "7-9", value: p, pick: pP },
          failure: { label: "6-",  value: f, pick: pF },
        }
      : null;
    return {
      name: String(name ?? "").trim() || "Love Letter",
      type: "move",
      system: {
        moveType: "other",
        description: escLoveLetterBody(description),
        rollType: stat,
        moveResults,
        pickOptions: stat ? opts : [],
        noXpOnMiss: !!noXpOnMiss,
        signed: String(signed ?? "").trim(),
      },
      flags: { [FLAG_SCOPE]: { loveLetter: true } },
    };
  };

  // The four worked examples from Book I p.569, reproduced verbatim (book recipient names
  // kept so Blodwen's "read after Rhianna" cross-references still read true). Em dashes are
  // rewritten as commas/periods to match house style. Two structural notes:
  //   - Rhianna's roll is +Fortunes in the book, but Fortunes is a steading stat the love-
  //     letter roll can't take (only the six character stats), so it's mapped to +WIS here.
  //   - The pick counts live on moveResults.<tier>.pick, so the "on a 10+, pick 1; …" lines
  //     are NOT restated in the body — the card renders them from the tiers + option list.
  const buildTestLoveLetters = () => [
    // Rhianna — shared list + "pick N" (worse roll → more trouble), 6- takes all 3 + marks XP.
    {
      name: "Speaking of Worries",
      description: "Dear Rhianna,\n\n"
        + "You got back from a few days hunting to find everyone talking about Caradoc, Vahid, and their "
        + "trip to the Tower. As if you didn't have enough to worry about. Speaking of worries, roll +WIS.",
      rollType: "wis",
      picks: { success: 1, partial: 2, failure: 3 },
      options: [
        "Owain's been calling for folks to \"do something\" about Vahid. Who has been agreeing with him that you would not have expected?",
        "Wini (Cerys's eldest) has been acting out, badly. How so?",
        "Crinwin jumped one of your crew while out hunting (who?); they're home, but badly hurt (how so?).",
      ],
      signed: "XOXO - your GM",
    },
    // Caradoc — shared list + "pick N" (better roll → more picks), 6- picks 1, marks XP, and
    // adds a fixed complication in the failure prose.
    {
      name: "A Deal at the Greenhouse",
      description: "Dear Caradoc,\n\n"
        + "You and Morwenna are still tied up, but you're at the greenhouse. Tell us what unpleasant truth "
        + "you had to reveal to seal the deal, then roll +CHA.",
      rollType: "cha",
      picks: { success: 2, partial: 1, failure: 1 },
      results: {
        success: "",
        partial: "",
        failure: "Your captors clearly know they're being followed. They're laying a trap!",
      },
      options: [
        "You've slyly loosened your bonds",
        "Morwenna's calm & playing along (else, she's freaking right out)",
        "They haven't separated you and Morwenna yet (else, they have)",
      ],
      signed: "XOXO - your GM",
    },
    // Vahid — per-tier results, no shared list. 6- marks XP (the default).
    {
      name: "A Quiet, Cozy Winter",
      description: "Dear Vahid,\n\n"
        + "It's been a quiet, cozy winter, with plenty of time inside. What unlikely aspect of a personality "
        + "has the Mindgem revealed, now that you've spent so much time with it?\n\n"
        + "Now, ask the Mindgem a question about the Makers, their history, or their arts. You've gleaned a "
        + "clear and useful answer, and even a few follow-up questions. But also, roll +WIS.",
      rollType: "wis",
      results: {
        success: "You've not neglected anyone nor anything.",
        partial: "Tell us who you've let down in some little way.",
        failure: "Tell us who you've let down and why they're still upset.",
      },
      signed: "XOXO - your GM",
    },
    // Blodwen — per-tier results, and the one example whose 6- does NOT mark XP: noXpOnMiss
    // exercises the "Mark XP" toggle in the off position. The disadvantage clause is prose
    // (the reader applies it), since a love letter has no conditional-roll-mode mechanic.
    {
      name: "As for Tierny",
      description: "Dear Blodwen (read after Rhianna),\n\n"
        + "Dawn finds you all hiding in a cart, rattling out into the fields after a sleepless night tending "
        + "to Tierny and the others (with Brin's able help). What personal advice did you give Brin before "
        + "you left?\n\n"
        + "As for Tierny, roll +INT. If Rhianna's turn led to casualties, then roll with disadvantage.",
      rollType: "int",
      results: {
        success: "Tierny has made a full recovery and few will know how close she was to death.",
        partial: "She's up and will recover, but your name will spread as a miracle-worker.",
        failure: "Either she dies and becomes a martyr, or lives on as a husk of her former self (your call).",
      },
      noXpOnMiss: true,
      signed: "XOXO - your GM",
    },
  ];

  // Which of those four a character gets, from its slot in the roster. Seeding all four onto
  // everyone only ever showed the section at its fullest, so the roster is split three ways
  // instead — deterministically, like every other choice this macro makes (position decides,
  // nothing is rolled):
  //   slot % 3 === 0 → all four: both structures, the shared-list checklist, and the
  //                    no-XP-on-miss case, all stacked in one section
  //   slot % 3 === 1 → exactly one, so the section is seen holding a single card (and its
  //                    header count reads 1). Which one rotates with the slot, so across a
  //                    full run several different letters are seen standing alone
  //   slot % 3 === 2 → none, so the section is absent entirely and the tab has to lay out
  //                    without it
  // Over the 9-playbook roster that lands 3 characters in each state.
  const testLoveLettersFor = (slot) => {
    const all = buildTestLoveLetters();
    const i   = Number.isFinite(slot) && slot >= 0 ? Math.floor(slot) : 0;
    switch (i % 3) {
      case 1:  return [all[Math.floor(i / 3) % all.length]];
      case 2:  return [];
      default: return all;
    }
  };

  // Stored shape for a custom follower — matches buildCustomFollower()'s output in
  // module/data/follower-build.js (this macro is standalone and can't import it), with
  // every field filled so the whole card shows: tags, HP, armor, damage, an instinct,
  // moves, a cost, gear (one item pre-checked), notes, and a Loyalty of 2. A single
  // (non-group) follower — the simplest case; group tooling has its own toggle.
  const buildTestFollowerData = () => ({
    name:         "Tamsin the Tester",
    pronoun:      "she/her",
    typeLabel:    "test follower",
    portraitIcon: "fas fa-user",
    tags:         ["brave", "observant", "sharp-eyed", "stubborn"],
    hpMax:        8,
    hpCurrent:    8,
    armor:        1,
    damage:       "d6 (near, forceful)",
    instinct:     "To wander off and test whether the danger is real",
    moves:        "Notices the thing everyone else missed\nSays the quiet part out loud at the worst possible moment",
    cost:         "Affection, respect (from you)",
    notes:        "A demonstration follower seeded by the test-fixtures macro — every field filled in so you can see how a custom follower's card renders.",
    gear:         [
      { label: "A well-worn spear",        checked: false },
      { label: "A dented shield",          checked: true  },
      { label: "Three days' hard rations", checked: false },
    ],
    butcher:      null,
    loyalty:      2,
    isGroup:      false,
    size:         0,
    sourceUuid:   null,
  });

  // Add the test custom move (via the typed wrapper's authoring API, which does all the
  // shaping) and the test follower (mirroring StonetopCharacterSheet._applyCustomFollower:
  // a customFollowers.<id> flag with a creation-order stamp) to one character. `slot` is the
  // character's position in the roster being built, which is what decides its love letters.
  const seedTestCustomContent = async (actor, slot) => {
    const typed = actor.typedActor;
    if (typed?.addCustomMove) await typed.addCustomMove(TEST_CUSTOM_MOVE);
    // This character's share of the Book I p.569 love letters (embedded move items flagged
    // loveLetter) — all four, one, or none, per testLoveLettersFor. Created directly rather
    // than via a typed-wrapper method — a love letter is a plain embedded item; the shaping
    // (buildLoveLetterItem) mirrors buildLoveLetterData.
    const letters = testLoveLettersFor(slot);
    if (letters.length) await actor.createEmbeddedDocuments("Item", letters.map(buildLoveLetterItem));
    const existing = actor.getFlag(FLAG_SCOPE, "customFollowers") ?? {};
    const order    = Object.values(existing).reduce((m, f) => Math.max(m, Number(f?.order) || 0), 0) + 1;
    const id       = foundry.utils.randomID(16);
    await actor.update({
      [`flags.${FLAG_SCOPE}.customFollowers.${id}`]: { ...buildTestFollowerData(), order: Math.max(order, Date.now()) },
    });
  };

  // ── Test world content: Moves / Items / Monsters ───────────────────────
  // Reusable, DRAGGABLE world documents (not embedded on any character), grouped into
  // their own folders so a test world shows the sidebar "Create Item" and "Make a Monster"
  // outputs without hand-authoring them. Each fixture fills the full range of fields its
  // authoring flow offers. All shaping is inlined (this macro is pasted standalone and can't
  // import the module), mirroring the shared builders it stands in for. Every document AND
  // folder carries the test flag, so the re-run cleanup (world-item sweep, actor sweep, and
  // the empty-flagged-folder prune) tears them all down.
  const OBSERVER          = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const HOSTILE           = CONST.TOKEN_DISPOSITIONS.HOSTILE;
  const BESTIARY_ICON_DIR = "systems/stonetop-pwd/assets/icons/bestiary";

  // Three custom world moves (moveType "other", flagged custom) spanning the roll types and
  // every Advanced field. Shaping mirrors buildCustomMoveData / worldMoveSaver: the
  // description is escaped + paragraph-wrapped exactly like a custom move (reusing
  // escLoveLetterBody, which equals formatCustomMoveDescription), and moveResults follows the
  // { success|partial|failure: { label, value } } shape rollStat consumes.
  const TEST_WORLD_MOVES = [
    // Stat roll (+WIS) with all three result tiers and a labelled resource track.
    {
      name: "Read the Omens",
      description: "When you take an hour to read the omens, the flights of birds, the set of the wind, the "
        + "guttering of a flame, roll +WIS. On a hit the GM tells you something true and useful about the "
        + "danger ahead. Spend a portent from the track below whenever you want that reading to bear on a "
        + "roll you or an ally are about to make.",
      rollType: "wis",
      results: {
        success: "The signs are clear. Mark two portents and ask the GM one pointed question about what is coming; the answer is honest and helpful.",
        partial: "The signs are muddled. Mark one portent, but the GM also shows you one worrying thing you would rather not have seen.",
        failure: "You read the omens all wrong. The GM tells you what you expected to see, and it is a lie.",
      },
      resource: { title: "Portents", max: 3, labels: ["Whisper", "Sign", "Omen"] },
    },
    // "Ask" roll (choose the stat each time) that never marks XP on a miss.
    {
      name: "Call on the Old Ways",
      description: "When you call on the old ways, the half-remembered rites your grandmother kept, name what "
        + "you mean to accomplish and roll with whichever stat best fits the rite (the GM helps you choose).",
      rollType: "ask",
      results: {
        success: "The old ways answer. It works as you hoped, cleanly and without cost.",
        partial: "The old ways answer, but not for free. It works, and the GM tells you what it stirs up or asks of you in return.",
        failure: "The old ways turn their face from you. It fails, and you have drawn the wrong sort of attention. This move never marks XP on a miss.",
      },
      noXpOnMiss: true,
    },
    // No-roll narrative stance carrying passive HP / armor / load bonuses.
    {
      name: "Bear the Standard",
      description: "While you openly carry Stonetop's standard into danger, those who fight beside you take "
        + "heart from it. This is a stance, not a roll: so long as you bear the standard you stand a little "
        + "sturdier and carry a little more for the weight of what it means.",
      rollType: "",
      hpBonus: 2,
      armorBonus: 1,
      loadBonus: 1,
    },
  ];

  const buildWorldMoveItem = (m) => {
    const rt = STAT_KEYS.includes(String(m.rollType)) || m.rollType === "ask" ? m.rollType : "";
    const s = String(m.results?.success ?? "").trim();
    const p = String(m.results?.partial ?? "").trim();
    const f = String(m.results?.failure ?? "").trim();
    const moveResults = (rt && (s || p || f))
      ? { success: { label: "10+", value: s }, partial: { label: "7-9", value: p }, failure: { label: "6-", value: f } }
      : null;
    const res    = m.resource ?? null;
    const resMax = res ? Math.max(0, Math.min(20, Math.trunc(Number(res.max) || 0))) : 0;
    const resource = resMax > 0
      ? { max: resMax, title: String(res.title ?? "").trim() || null, labels: (res.labels ?? []).map(l => String(l).trim()).filter(Boolean) }
      : null;
    const bonus = (v) => Math.max(0, Math.min(99, Math.trunc(Number(v) || 0)));
    return {
      name: String(m.name ?? "").trim() || "New Move",
      type: "move",
      system: {
        moveType:    "other",
        description: escLoveLetterBody(m.description),
        rollType:    rt,
        moveResults,
        resource,
        noXpOnMiss:  !!m.noXpOnMiss,
        hpBonus:     bonus(m.hpBonus),
        armorBonus:  bonus(m.armorBonus),
        loadBonus:   bonus(m.loadBonus),
      },
      ownership: { default: OBSERVER },
      flags: { [FLAG_SCOPE]: { custom: true, [TEST_FLAG]: true } },
    };
  };

  // Uses/ammo circle track, mirroring buildUsesResource: ammo labels the last two circles
  // "low ammo" / "all out" (or a single circle "all out"); a plain track is unlabelled.
  const buildUses = (n, isAmmo) => {
    const labels = new Array(n).fill("");
    if (isAmmo) {
      if (n >= 2) { labels[n - 2] = "low ammo"; labels[n - 1] = "all out"; }
      else if (n >= 1) { labels[0] = "all out"; }
    }
    return { max: n, title: null, labels };
  };

  // Three regular + three small custom inventory items (moveType "inventory"). Shaping mirrors
  // buildInventoryItemData / worldInventoryItemSaver: regular items carry a weight and (here) a
  // worn-armor value; both columns carry an <em>-wrapped gear-term note (authored pre-wrapped,
  // as the shipped catalog items store it) and an optional uses/ammo track. A drop re-plants
  // each as an "inventory-custom" copy on the character (see addDroppedInventoryItem).
  const TEST_WORLD_ITEMS = [
    { name: "Boar Spear",          column: "regular", weight: 1, note: "<em>close</em>, <em>thrown</em>, +1 damage" },
    { name: "Scout's Buckler",     column: "regular", weight: 1, note: "+1 armor", armor: { modifier: 1 } },
    { name: "Hunter's Bow",        column: "regular", weight: 2, note: "<em>near</em>, <em>far</em>, <em>reload</em>", resource: buildUses(6, true) },
    { name: "Vial of Marsh-Bane",  column: "small",   note: "<em>dangerous</em>, <em>thrown</em>", resource: buildUses(3, false) },
    { name: "Pinch of Salt",       column: "small",   note: "" },
    { name: "Waxed Tinderbox",     column: "small",   note: "<em>slow</em>", resource: buildUses(2, false) },
  ];

  const buildWorldItemItem = (it) => {
    const isRegular = it.column !== "small";
    const system = { moveType: "inventory", inventoryColumn: isRegular ? "regular" : "small" };
    if (isRegular) {
      const w = Number(it.weight);
      system.weight = Math.max(1, Number.isFinite(w) ? w : 1);
    }
    if (it.note) system.note = it.note;
    if (it.resource) system.resource = it.resource;
    if (isRegular && it.armor) system.armor = it.armor;
    return {
      name: String(it.name ?? "").trim() || "New Item",
      type: "move",
      system,
      ownership: { default: OBSERVER },
      flags: { [FLAG_SCOPE]: { [TEST_FLAG]: true } },
    };
  };

  // Three monster stat blocks spanning the three organizations (horde / group / solitary) and
  // sizes (medium / large), each with embedded monsterMove items. Shaping mirrors
  // CreateMonsterDialog._buildActorData; the derived HP/armor/damage/tag values are authored
  // directly (rather than inlining computeMonster) since these are fixed demonstration blocks.
  // `size` stores the size TAG ("" for medium, "large" for large), matching the model.
  const TEST_MONSTERS = [
    {
      name: "Marsh Ghoul",
      creatureType: "undead",
      concept: "The drowned dead of the Lygos marsh, called up out of the black water to drag the living down.",
      organization: "horde", size: "", count: 6,
      hp: 7, armor: { value: 1, source: "waterlogged flesh" },
      damage: { value: "d6 (hand, grabby)", rollFormula: "d6" },
      instinct: "to drag the living down into the black water",
      tags: "horde, undead, grabby",
      qualities: "<p>Feels no pain and no fear. Falls apart when destroyed, only to be knit back together by the marsh come nightfall.</p>",
      moves: [
        { name: "Drag someone under",       description: "It grabs hold and hauls its victim down into the muck and the water." },
        { name: "Rise again from the mire", description: "Come nightfall, the marsh pulls a destroyed ghoul back together." },
      ],
    },
    {
      name: "Hillfolk Raider",
      creatureType: "human-group",
      concept: "War-bands out of the high country, come down to take what Stonetop has stored against the winter.",
      organization: "group", size: "", count: 3,
      hp: 6, armor: { value: 1, source: "hide and horn" },
      damage: { value: "d8+2 (close, forceful)", rollFormula: "d8+2" },
      instinct: "to take what they need and answer to no one",
      tags: "group, cunning, organized",
      qualities: "<p>Fights as a band, not a mob. Better armed than any hill raider has a right to be.</p>",
      moves: [
        { name: "Fight as a war-band",          description: "They coordinate, flank, and cover one another's advance." },
        { name: "Take a hostage",               description: "They seize someone weaker and use them as leverage to withdraw." },
        { name: "Fall back to the high country", description: "When the fight turns, they melt away into ground they know and you don't." },
      ],
    },
    {
      name: "Echo of the Singing Tower",
      creatureType: "emanation",
      concept: "The wordless song of the tower past the old ford, given just enough shape to answer those who come.",
      organization: "solitary", size: "large", count: 1,
      hp: 16, armor: { value: 4, source: "it has no body to wound" },
      damage: { value: "d10+1 (near, area, ignores armor)", rollFormula: "d10+1" },
      instinct: "to be answered, and to draw the curious out past the wall",
      tags: "solitary, large, magical, terrifying",
      qualities: "<p>Has no body, only a sound and a shape half-seen. Physical harm barely troubles it; its true danger is the longing it kindles.</p>",
      moves: [
        { name: "Sing a note that bends the mind",     description: "Its song reaches into the listener and stirs a want they cannot name.", rollFormula: "d10" },
        { name: "Show a vision of what you long for",  description: "It offers a glimpse of the thing you most desire, just past the treeline." },
        { name: "Draw you a step closer",              description: "Before you know it, you have walked closer than you meant to." },
      ],
    },
  ];

  const buildTestMonsterData = (mon) => {
    const img = `${BESTIARY_ICON_DIR}/${mon.creatureType}.svg`;
    return {
      name: mon.name,
      type: "monster",
      img,
      system: {
        attributes: {
          hp:       { value: mon.hp, max: mon.hp },
          armor:    { value: mon.armor?.value ?? 0, source: mon.armor?.source ?? "" },
          damage:   { value: mon.damage?.value ?? "", rollFormula: mon.damage?.rollFormula ?? "" },
          instinct: { value: mon.instinct ?? "" },
        },
        concept:      mon.concept ?? "",
        organization: mon.organization ?? "",
        creatureType: mon.creatureType ?? "",
        size:         mon.size ?? "",
        tags:         mon.tags ?? "",
        qualities:    mon.qualities ?? "",
        notes:        "",
        count:        mon.count ?? 1,
        entry:        "",
      },
      prototypeToken: { name: mon.name, actorLink: false, disposition: HOSTILE, texture: { src: img } },
      items: (mon.moves ?? []).map(mv => ({
        name: mv.name,
        type: "monsterMove",
        system: { description: `<p>${mv.description}</p>`, rollFormula: mv.rollFormula ?? "" },
      })),
      flags: { [FLAG_SCOPE]: { [TEST_FLAG]: true } },
    };
  };

  // Find-or-create a test folder of `type` named `name` that carries our test flag, so a
  // re-run reuses our own folder and we never adopt (or later delete) a same-named folder the
  // GM made by hand. Foundry allows duplicate folder names, so this can't collide.
  const ensureTestFolder = async (type, name) => {
    let f = game.folders?.find(x => x.type === type && x.name === name && x.getFlag(FLAG_SCOPE, TEST_FLAG));
    if (!f) f = await Folder.create({ name, type, flags: { [FLAG_SCOPE]: { [TEST_FLAG]: true } } });
    return f;
  };

  // Create the three folders and their contents. Monsters pass { stonetopMonsterBuilt: true }
  // so the preCreateActor "make a monster" interception treats them as finished stat blocks
  // (they already carry populated system data, so it would pass them through regardless).
  const seedTestWorldContent = async () => {
    const movesFolder = await ensureTestFolder("Item", "Moves");
    await Item.createDocuments(TEST_WORLD_MOVES.map(m => ({ ...buildWorldMoveItem(m), folder: movesFolder.id })));

    const itemsFolder = await ensureTestFolder("Item", "Items");
    await Item.createDocuments(TEST_WORLD_ITEMS.map(it => ({ ...buildWorldItemItem(it), folder: itemsFolder.id })));

    const monsterFolder = await ensureTestFolder("Actor", "Monster");
    const monsters = [];
    for (const mon of TEST_MONSTERS) {
      monsters.push(await Actor.create({ ...buildTestMonsterData(mon), folder: monsterFolder.id }, { stonetopMonsterBuilt: true }));
    }
    console.log(`[TEST] Seeded world content: ${TEST_WORLD_MOVES.length} moves, ${TEST_WORLD_ITEMS.length} items, ${TEST_MONSTERS.length} monsters.`);
    return monsters.filter(Boolean);
  };

  // ── Test world content: one fully-filled example NPC ───────────────────
  // A standalone `npc` Actor with EVERY field of the interaction-first sheet populated, so a
  // test world shows the Create-NPC output without hand authoring. Gethin Iron-Hand is the
  // Hillfolk war-chief the Marshal's onboarding war-stories allude to ("their chieftain slipped
  // into the Wood") — placing him here ties the fixtures together. Shaping mirrors the NpcModel
  // schema (module/data-models/NpcModel.js): identity (pronouns / occupation / traits / home /
  // relations / up to 3 impressions / instinct), a lifecycle `status`, the drives (connections /
  // motivations rich text + the GM-only `embodiment` note), a per-PC `relationships` map (char id
  // → { hearts 1-5, notes }), the optional combat overlay (`hasStats` + attributes hp/armor/
  // damage + tags), the `statBlock` / `threat` @UUID cross-links, free-form `notes`, and embedded
  // `npcMove` GM moves (description + optional rollFormula, same schema as monsterMove). Flagged
  // isTest so the re-run's actor sweep tears it down and the empty-flagged "NPCs" folder prunes.
  //
  // Built from the live fixtures so its cross-links resolve: `pcs` are the created characters (for
  // the relationship hearts + @UUID connections), `statBlockDoc` a seeded Monster, `threatDoc` a
  // seeded `threat` JournalEntryPage (NOT its parent journal — the page is the document the Threats
  // tab reads and keeps, so its uuid is the one that stays live). An `@UUID[<uuid>]{Label}` enricher
  // links each; a null doc degrades to plain label text (or an empty cross-link) rather than a
  // dangling reference, and seedTestNpc has already verified each doc resolves.
  const buildTestNpcData = ({ pcs, statBlockDoc, threatDoc }) => {
    const byName   = (n) => (pcs ?? []).find(a => a?.name === n) ?? null;
    const uuidLink = (doc, label) => doc?.uuid ? `@UUID[${doc.uuid}]{${label ?? doc.name}}` : String(label ?? "");
    const coria = byName("Coria");   // the Marshal — his sworn enemy
    const quill = byName("Quill");   // the Fox — the one Stonetopper he'll deal with
    const wren  = byName("Wren");    // the Ranger — the one he might parley with

    // A spread of hearts (1..5) + notes across a few PCs so the Relationships section shows the
    // full range; every other character defaults to 3 hearts on the sheet without being stored.
    const RELS = [
      { name: "Coria",           hearts: 1, notes: "Her militia broke his line at the broken gate. He has not forgotten, and he does not forgive." },
      { name: "Brakkos",         hearts: 2, notes: "A worthy foe. He would sooner test the Heavy in the open than sit and parley with him." },
      { name: "Old Bartholomew", hearts: 2, notes: "The Judge's law means nothing up in the high country, and Gethin tells him so to his face." },
      { name: "Wren",            hearts: 4, notes: "She knows the wild's manners. She alone among them he might sit and talk with." },
      { name: "Quill",           hearts: 5, notes: "The one Stonetopper who ever cut him an honest deal. He keeps a true account with the Fox." },
    ];
    const relationships = {};
    for (const r of RELS) { const pc = byName(r.name); if (pc) relationships[pc.id] = { hearts: r.hearts, notes: r.notes }; }

    const connections =
        `<p>Sworn enemy of ${uuidLink(coria, "Coria")}, the Stonetop marshal whose militia broke his line at the gate.</p>`
      + `<p>Keeps a true account with ${uuidLink(quill, "Quill")}, the one Stonetopper he will still trade with.</p>`
      + (threatDoc ? `<p>Armed and abetted by ${uuidLink(threatDoc, "a patron out of the black water")} he will not name aloud.</p>` : "");

    const notes =
        `<h3>Running Gethin</h3>`
      + `<p>Gethin is not a monster; he is a man with a monster's patron and a people to keep alive through a hard winter. Play him as reasonable right up until reason fails him.</p>`
      + `<ul>`
      + `<li>He will parley, but only with someone he respects (${uuidLink(wren, "Wren")} sooner than most).</li>`
      + (statBlockDoc ? `<li>He fights as ${uuidLink(statBlockDoc, "the Hillfolk Raiders")} do, only harder; reach for that stat block if it comes to blows.</li>` : "")
      + `<li>If the fight turns against him, he withdraws into the high country rather than lose his war-band.</li>`
      + `</ul>`
      + `<blockquote><p>"You broke my line at your gate. The next gate will be mine." — to the marshal, at the parley</p></blockquote>`;

    return {
      name: "Gethin Iron-Hand",
      type: "npc",
      system: {
        pronouns:   "he/him",
        occupation: "war-chief of the high-country Hillfolk",
        traits:     "proud; scarred; iron-handed; slow to trust and quick to strike",
        home:       "The Steplands",
        relations:  "leads the raids on Stonetop's winter stores; secretly armed by a patron he will not name",
        impressions: [
          "A left hand of blackened iron, cold to the touch",
          "A voice like gravel rolling downhill, and just as patient",
          "The blue spiral-marks of the high clans, inked across his brow",
        ],
        instinct:   "to take what his people need, and answer to no one",
        status:     "away",
        connections,
        motivations:
            `<p><strong>Wants:</strong> grain, good iron, and a winter his people live to see the end of.</p>`
          + `<p><strong>Fears:</strong> that his patron's price will come due long before the thaw.</p>`
          + `<p><strong>Longs for:</strong> the old days, before the clans were driven up into the cold.</p>`,
        embodiment: "Voice: gravel rolling downhill. Picture: a wolf that has learned to wait. Trick: he flexes the iron hand, slow, whenever he is deciding whether to kill you.",
        relationships,
        hasStats:   true,
        attributes: {
          hp:     { value: 9, max: 12 },
          armor:  { value: 2, source: "riveted mail" },
          damage: { value: "d8+2 (close, forceful) — a notched war-axe", rollFormula: "d8+2" },
        },
        tags:       "cunning, well-armed, war-leader, terrifying",
        statBlock:  uuidLink(statBlockDoc),
        threat:     uuidLink(threatDoc),
        notes,
      },
      prototypeToken: { name: "Gethin Iron-Hand", displayName: CONST.TOKEN_DISPLAY_MODES.HOVER, actorLink: true, disposition: HOSTILE },
      items: [
        { name: "Sound the war-horn",         type: "npcMove", system: { description: "<p>He winds the great horn and scattered raiders come loping back to his side, wherever they had strayed.</p>", rollFormula: "" } },
        { name: "Challenge to single combat", type: "npcMove", system: { description: "<p>He calls out the strongest among you by name and offers to settle the whole matter, blade to blade.</p>", rollFormula: "d8+2" } },
        { name: "Melt into the high country", type: "npcMove", system: { description: "<p>When the fight turns against him, he and his war-band withdraw into ground they know and you do not.</p>", rollFormula: "" } },
      ],
      flags: { [FLAG_SCOPE]: { [TEST_FLAG]: true } },
    };
  };

  // Create the example NPC in a flagged "NPCs" Actor folder, cross-linking it to a seeded Monster
  // stat block ("Hillfolk Raider" — his warriors) and Threat page ("The Crow-Mother" — his hidden
  // patron), falling back to the first available of each so the links resolve even if names drift.
  // Each candidate is round-tripped through fromUuid before its uuid is baked into the NPC's prose:
  // an unresolvable target degrades to plain label text rather than a dangling @UUID chip, so the
  // sheet can never ship with a broken link even if a seeding step above quietly failed.
  const seedTestNpc = async ({ pcs, monsters, threats }) => {
    const folder    = await ensureTestFolder("Actor", "NPCs");
    const resolved  = async (doc) => (doc?.uuid && await fromUuid(doc.uuid).catch(() => null)) ? doc : null;
    const statBlockDoc = await resolved((monsters ?? []).find(m => m?.name === "Hillfolk Raider") ?? (monsters ?? [])[0] ?? null);
    const threatDoc    = await resolved((threats  ?? []).find(t => t?.name === "The Crow-Mother") ?? (threats  ?? [])[0] ?? null);
    const npc = await Actor.create({ ...buildTestNpcData({ pcs, statBlockDoc, threatDoc }), folder: folder.id });
    console.log(`[TEST] Seeded example NPC: ${npc?.name} — ${npc?.items?.size ?? 0} GM moves, stat block → ${statBlockDoc?.name ?? "none"}, threat → ${threatDoc?.name ?? "none"}.`);
    return npc;
  };

  // ── The Judge's brand: a few standing Condemnations ────────────────────
  // Condemn is the only Judge move that leaves state behind — "marked with a mystical brand that
  // cannot be removed or hidden UNTIL YOU DISMISS IT" — so it is also the only one with nothing to
  // look at until somebody has actually been branded. An empty roster renders one line of "nobody",
  // which tells you the window opens and nothing else.
  //
  // Four rows, chosen to cover every way the feature draws rather than to be four names:
  //   • an `npc` Actor (Gethin) and a `monster` stat block (the Hillfolk Raiders) and a fellow
  //     `character` (Quill) — the three BRANDABLE types, each of whose sheets wears the condemned
  //     tag, and each of which resolves back to a portrait + openable link in the roster window;
  //   • a faction with no Actor anywhere (the Cult of the Black Water, the Crow-Mother's people from
  //     the seeded threats) — the name-only row a Proclamation always produces, which lists fine and
  //     deliberately tags nobody.
  // The war-band row is that same Proclamation reach in its other form: branded against the stat
  // block rather than the man, which is what "a group or faction … regardless of distance" looks
  // like once it is written down.
  //
  // WORKS ON BOTH PATHS, showing a different half of showCondemn on each. Condemn is a level 2-5
  // move, so the Level-1 Judge does not own it and the scales appear only because the list is
  // non-empty — exactly the stranded-brands case the header keeps the button for. The maxed Judge
  // owns it, so the same fixture reads as an ordinary Judge holding a list.
  //
  // No cleanup of its own: the brands are one flag array on the Judge, and the re-run's actor sweep
  // deletes that character outright.
  const JUDGE_SLUG = "the-judge";
  const TEST_CONDEMNED = [
    { name: "Gethin Iron-Hand",           note: "Denounced from the steps after the raid on the winter stores. He wears the mark up in the high country and laughs about it." },
    { name: "Hillfolk Raider",            note: "Proclaimed against the war-band, not the man: every raider who came down the Maker's Road carries it." },
    { name: "Quill",                      note: "Caught with the reeve's strongbox key in his boot and no answer for it. The brand stands until he makes the village whole." },
    { name: "The Cult of the Black Water", note: "Named aloud before the whole square. Nobody yet knows which faces in Stonetop are under it." },
  ];

  // Brand each row on the roster's Judge, through the real writer (brandCondemned — which mints the
  // row id, refuses a duplicate and writes the whole array back) rather than by setting the flag by
  // hand. A name that matches an actor this run created is stored as a LINK to them; anything else
  // stores as a name, which is a perfectly good roster row that simply tags no sheet.
  const seedCondemned = async (pcs, targets) => {
    // Slug off the character's stored playbook block, falling back to the embedded playbook Item
    // and finally to the preset name — `||` rather than `??` throughout, since both slug fields are
    // blank-initialised strings and a blank must fall through rather than win.
    const pcSlug = (a) => a?.system?.playbook?.slug || a?.items?.find(i => i.type === "playbook")?.system?.slug || "";
    const judge = (pcs ?? []).find(a => pcSlug(a) === JUDGE_SLUG)
      ?? (pcs ?? []).find(a => a?.name === PRESET.judge.name);
    const typed = judge?.typedActor;
    if (!typed?.brandCondemned) {
      console.log("[TEST] No Judge in the roster — skipped the Condemn brands.");
      return 0;
    }
    // First actor wins a shared name; the Judge himself is never a target (condemnersOf skips self,
    // so a self-brand would sit on the roster tagging nothing).
    const byName = new Map();
    for (const a of (targets ?? []).flat().filter(Boolean)) {
      if (a.id !== judge.id && !byName.has(a.name)) byName.set(a.name, a);
    }
    let branded = 0;
    for (const row of TEST_CONDEMNED) {
      const target = byName.get(row.name) ?? null;
      const added = await typed.brandCondemned({
        name: target?.name ?? row.name,
        uuid: target?.uuid ?? "",
        note: row.note,
      });
      if (added) branded++;
    }
    console.log(`[TEST] Condemned by ${judge.name}: ${branded}/${TEST_CONDEMNED.length} — ${TEST_CONDEMNED.map(r => r.name).join(", ")}.`);
    return branded;
  };

  // ── Steading people: the Residents / Neighbors NPC actors ──────────────
  // The two Actor folders the steading's people live in, mirroring PEOPLE_FOLDERS in
  // module/actors/steading/steading-people.js — same names and colours, so the seeded NPCs
  // land in the folders the system itself creates on every load and uses for its own add
  // flows. Deliberately NOT flagged isTest: they are the system's folders, not ours, so the
  // empty-flagged-folder prune must leave them (and ensurePeopleFolders puts them back
  // anyway). Only the NPCs inside carry the flag.
  const PEOPLE_FOLDERS = {
    residents: { name: "Residents of Stonetop", color: "#7a5c3e" },
    neighbors: { name: "Neighbors of Stonetop", color: "#5c6b7a" },
  };
  const ensurePeopleFolder = async (list) => {
    const spec = PEOPLE_FOLDERS[list];
    if (!spec) return null;
    let f = game.folders?.find(x => x.type === "Actor" && x.name === spec.name);
    if (!f) f = await Folder.create({ name: spec.name, type: "Actor", color: spec.color });
    return f;
  };

  // Shape one person definition into `npc` Actor data, mirroring createPersonNpc: the roster
  // columns map to system fields, a resident's Home defaults to "Stonetop" (they live there
  // by definition), and the actor carries OBSERVER by default because Residents/Neighbors
  // show on the often player-visible steading sheet — unlike GM-prep monsters and threats.
  // `notes` is an HTMLField rendered through enrichHTML in the roster's Notes cell, so the
  // plain line is paragraph-wrapped rather than dropped in raw. `rels` become the NPC's own
  // per-PC hearts, resolved by character name against the PCs this run created.
  const buildPersonNpcData = (person, list, pcs, folderId) => {
    const relationships = {};
    for (const r of (person.rels ?? [])) {
      const pc = (pcs ?? []).find(a => a?.name === r.name);
      if (!pc) continue;
      const entry = buildRelEntry(r);
      if (Object.keys(entry).length) relationships[pc.id] = entry;
    }
    return {
      name: person.name,
      type: "npc",
      folder: folderId ?? null,
      ownership: { default: OBSERVER },
      system: {
        occupation: person.occupation ?? "",
        traits:     person.traits ?? "",
        relations:  person.relations ?? "",
        home:       person.home ?? (list === "residents" ? "Stonetop" : ""),
        instinct:   person.instinct ?? "",
        notes:      person.notes ? `<p>${person.notes}</p>` : "",
        relationships,
      },
      flags: { [FLAG_SCOPE]: { [TEST_FLAG]: true } },
    };
  };

  // Create every Resident / Neighbor NPC and return both the steading rows that point at
  // them and the actors themselves (the character sheets rate them next). Row shape matches
  // StonetopSteading#addPersonRow exactly — { uuid, id, name, checked } — plus the isTest tag
  // the row-stripping cleanup keys off.
  const seedSteadingPeople = async (pcs) => {
    const out = { residents: [], neighbors: [], actors: [] };
    for (const [list, people] of [["residents", STEADING_TEST_RESIDENTS], ["neighbors", STEADING_TEST_NEIGHBORS]]) {
      const folder = await ensurePeopleFolder(list);
      const docs = await Actor.createDocuments(people.map(p => buildPersonNpcData(p, list, pcs, folder?.id)));
      for (const actor of (docs ?? [])) {
        out[list].push({ uuid: actor.uuid, id: actor.id, name: actor.name, checked: false, isTest: true });
        out.actors.push(actor);
      }
    }
    return out;
  };

  // Write each PC's outgoing relationships (PC_RELATIONSHIPS) onto the character. Keyed per
  // row rather than as one `system.relationships` object so the write merges with anything
  // already stored, exactly as updateRelationship does. Runs after BOTH the characters and
  // the villagers exist, since every key is a live actor id.
  const seedPcRelationships = async (pcs, villagers) => {
    const byName      = new Map([...(pcs ?? []), ...(villagers ?? [])].map(a => [a.name, a]));
    const villagerIds = new Set((villagers ?? []).map(a => a.id));
    let written = 0;
    for (const pc of (pcs ?? [])) {
      const update = {};
      for (const edge of (PC_RELATIONSHIPS[pc.name] ?? [])) {
        const target = byName.get(edge.name);
        if (!target || target.id === pc.id) continue;
        // Steading people start hidden in this section; a rated villager needs the explicit
        // tick or the row never leaves edit mode. An edge that sets `shown` itself wins.
        const shown = edge.shown ?? (villagerIds.has(target.id) ? true : undefined);
        const entry = buildRelEntry({ ...edge, shown });
        if (!Object.keys(entry).length) continue;
        update[`system.relationships.${target.id}`] = entry;
      }
      const keys = Object.keys(update).length;
      if (!keys) continue;
      await pc.update(update);
      written += keys;
    }
    return written;
  };

  // ── Create one character per playbook ──────────────────────────────────
  ui.notifications.info(maxLevel
    ? "[TEST] Creating test characters and maxing their level — this may take a moment…"
    : "[TEST] Creating test characters…");

  // Find or create the "PCs" actor folder so test characters land there.
  let pcFolder = game.folders.find(f => f.type === "Actor" && f.name === "PCs");
  if (!pcFolder) pcFolder = await Folder.create({ name: "PCs", type: "Actor" });

  const created = [];
  for (const pbDoc of playbookDocs) {
    const sel = buildSelections(pbDoc);

    const actor = await Actor.create({ name: sel.name, type: "character", folder: pcFolder.id });
    await actor.setFlag(FLAG_SCOPE, TEST_FLAG, true);

    const sheet = actor.sheet;
    await sheet._applyPlaybookSelections(pbDoc, sel);

    // Seed the Notes tab with demonstration prose so the tab is exercised on every
    // fixture (onboarding doesn't touch system.notes, so write it directly).
    if (sel.notes) await actor.update({ "system.notes": sel.notes });

    // Mark budgeted starting-move topics (e.g. the Seeker's Well Versed: "Mark 1
    // topic, in addition to the one noted in your Background"). A move carrying both
    // system.markBudget and system.markOptions wants N boxes checked at creation
    // (N = base + perExtra·(ownedCount−1)); onboarding leaves these to the sheet's
    // own checkboxes, so without this the move reads as still needing input. Fill the
    // first N deterministically (matching the macro's "first option" contract) via
    // setCountMark — the same writer the sheet's checkboxes use, which clamps each
    // pick to the move's total budget. Moves with markOptions but NO markBudget (the
    // Would-Be Hero's Potential for Greatness, whose stat slots are marked in play)
    // yield a null budget and are skipped. Keyed by move NAME, so a move owned more
    // than once is processed only once (ownedCount scales the budget instead).
    await applyStartingMoveMarks(actor);

    // Optionally climb this character to max level (the modal above), driving the real
    // level-up engine to exhaustion so the fixture exercises a fully advanced sheet.
    if (maxLevel) {
      const gained = await climbToMax(actor);
      console.log(`[TEST] Created + maxed: ${actor.name} — +${gained} levels → level ${actor.system?.attributes?.level?.value ?? "?"}.`);
    } else {
      console.log(`[TEST] Created: ${actor.name}`);
    }

    // Seed the demonstration custom move + follower (both are torn down with the actor), and
    // this slot's share of the love letters — created.length is the character's index in the
    // roster, read before the push below.
    await seedTestCustomContent(actor, created.length);

    created.push(actor);
  }

  // ── Max Level: scatter arcana across the whole roster ──────────────────
  // Only on the Max-Level path. Deal EVERY major arcanum out evenly and at RANDOM
  // across the created characters (18 majors / 9 PCs ⇒ 2 each, every major used
  // exactly once), and give each character 3 randomly drawn minor arcana. This is a
  // deliberate exception to the macro's deterministic "first option" contract — the
  // point here is to spread the full set of arcana over the fixtures so the Arcana
  // tab is exercised on every sheet. Arcana are stored only as actor flags (owned/
  // identified/major/minorDraw/minorRoles), so the re-run's Actor.deleteDocuments
  // already tears them down — no separate cleanup needed. Uses Math.random directly
  // (this is a Foundry macro, not a workflow script).
  if (maxLevel && created.length) {
    // Fisher–Yates shuffle → a new randomized copy (leaves the source array intact).
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    // Round-robin a shuffled item list across `bins` slots so each slot gets an even
    // share (⌊n/bins⌋ or ⌈n/bins⌉), and every item is dealt exactly once.
    const dealEvenly = (items, bins) => {
      const out = Array.from({ length: bins }, () => []);
      shuffle(items).forEach((it, i) => out[i % bins].push(it));
      return out;
    };
    // A random sample of up to n distinct items.
    const sampleN = (arr, n) => shuffle(arr).slice(0, Math.min(n, arr.length));

    const slugOf     = (d) => d.flags?.stonetop?.slug;
    const majorSlugs = majorArcana.map(slugOf).filter(Boolean);
    const minorSlugs = minorArcana.map(slugOf).filter(Boolean);

    if (!majorSlugs.length && !minorSlugs.length) {
      ui.notifications.warn("[TEST] No arcana found in the arcana pack — skipped the arcana scatter.");
    } else {
      const majorBins = dealEvenly(majorSlugs, created.length);
      for (let i = 0; i < created.length; i++) {
        const actor = created[i];
        const typed = actor.typedActor;
        if (!typed?.addArcanum) continue;
        const majors = majorBins[i] ?? [];
        const minors = sampleN(minorSlugs, 3);
        // Own + identify each dealt card so it shows face-up on the Arcana tab.
        for (const slug of [...majors, ...minors]) {
          await typed.addArcanum(slug);
          await typed.identifyArcanum(slug);
        }
        // The first minor begins play fully realized (mastered), exercising the
        // unlocked-back rendering — mirroring the Seeker's mastered minor.
        if (minors[0]) await typed.masterArcanum(minors[0]);
        // Populate the Seeker-style onboarding arcana flags (major card + minor role
        // assignments) so the arcana lore display reads coherently where it renders
        // (the Seeker); setFlag MERGES, so this leaves owned/identified untouched.
        await actor.setFlag(FLAG_SCOPE, "arcana", {
          major:      majors[0] ?? "",
          minorDraw:  minors,
          minorRoles: { mastered: minors[0] ?? "", found: minors[1] ?? "", lead: minors[2] ?? "" },
        });
        console.log(`[TEST] Arcana → ${actor.name}: ${majors.length} major (${majors.join(", ") || "none"}), ${minors.length} minor.`);
      }
    }
  }

  // ── The Graveyard: four characters past the Last Door ──────────────────
  // The living roster can't exercise any of this. SKIP_PLAYBOOKS keeps the three post-death
  // inserts out of it (they are `playbook` Items, but nobody STARTS as one), so without these
  // four the Death's Door black — the sheet repaint, the chat cards, the Post-Death tab, the
  // header's retired playbook and its `Dead` tag — has no fixture at all.
  //
  // One per fate: the two ways of refusing to go, the one way of being interceded for, and the
  // ending where nobody came back. They live in their own folder because they are not the
  // party: nothing else in this macro should sweep them into the introductions, the steading's
  // player list or the NPC's relationship hearts, and `created` is what all of those read.
  //
  // ALWAYS 1st level, whichever way the modal was answered. A maxed sheet and a dead one are
  // two different things to look at, and stacking them buries the one these fixtures exist for
  // under twenty levels of moves. `climbToMax` is simply never called on them.
  const GRAVEYARD = [
    {
      slug: "the-heavy", fate: "revenant", name: "Duvin Ash-Hand",
      purpose: "Ceri, who is still waiting at the ford",
      notes: `<h2>Duvin Ash-Hand</h2><p>Went down under the crinwin at the ford and <strong>would not go</strong>. Came back in his own body, colder than he left it.</p><blockquote><p>"She is still waiting. That is the whole of it."</p></blockquote>`,
    },
    {
      slug: "the-fox", fate: "ghost", name: "Nesta Fell",
      purpose: "Whoever cut the rope",
      tether: "The broken bridge over the gorge, where she fell",
      notes: `<h2>Nesta Fell</h2><p>The rope did not fray; it was <em>cut</em>. Her body is at the bottom of the gorge and she is not done with the question.</p>`,
    },
    {
      slug: "the-ranger", fate: "thrall", name: "Emrys Tal",
      master: "Kel-Sha-Ba, the Bone-Deep Whisper",
      notes: `<h2>Emrys Tal</h2><p>Called a name he should not have known, and something answered. He recovered. <strong>Something is owed.</strong></p>`,
    },
    {
      slug: "the-judge", fate: "dead", name: "Hafgan the Elder",
      notes: `<h2>Hafgan the Elder</h2><p>Made one last move as though he had rolled a 12+, and stepped through the Last Door. There is no saving him.</p>`,
    },
  ];

  // The Revenant's STRANGE APPETITES asks a question of its own ("Pick 1: still-warm blood /
  // dying breaths / …") and its Consequence reads as unanswered until it is settled. Read out
  // of the printed line rather than listed here, exactly as post-death-choices.js does it, so a
  // reworded option is still honoured; the separator is that module's PICK_SEPARATOR.
  const answerSubPick = async (typed, section, option) => {
    const inner = String(option?.description ?? "").match(/\b(?:pick|choose|select)\s+1\s*:\s*([\s\S]*?)<\/p>/i)?.[1];
    if (!inner) return;
    const first = inner.replace(/<[^>]*>/g, "").split(/\s+\/\s+|\s*;?\s*\bOR\b\s+/)[0]?.trim();
    if (first) await typed.setPostDeathLoreText(section, option.slug, first);
  };

  // Everything the insert asks of them, answered by this macro's usual contract: the first
  // option that can actually be taken. THE FINAL CONSEQUENCE is skipped by name — it is
  // inflicted, never chosen, and handing it to a fixture would end the character.
  const fillPostDeath = async (actor, entry) => {
    const typed = actor.typedActor;
    if (!typed) return;

    if (entry.fate === "dead") {
      // Nothing on the sheet changes but the state and the hit points that got them there:
      // the last move is made in the fiction, at the table, as a 12+.
      await actor.update({ "system.attributes.hp.value": 0 });
      await typed.setDeathsDoorState("dead");
      return;
    }

    // Grants the insert's moves and ends the brush with death, in that one call.
    await typed.setPostDeathInsert(entry.fate);

    const firstTakeable = async (section) => (await typed.sectionOptions(section))
      .find(o => !o.blocked && !o.marked && o.slug !== "final-consequence") ?? null;

    if (entry.fate === "thrall") {
      await typed.setPostDeathLoreText("your-master", "master-name", entry.master);
      const impulse = await firstTakeable("impulse");
      if (impulse) await typed.chooseOneSectionOption("impulse", impulse.slug);
      // Marks ACCUMULATE, so this one is marked rather than chosen — see post-death-choices.js.
      const mark = await firstTakeable("marks");
      if (mark) await typed.markSectionOption("marks", mark.slug);
    } else {
      const purpose = await firstTakeable("terrible-purpose");
      if (purpose) {
        await typed.chooseOneSectionOption("terrible-purpose", purpose.slug);
        // "Name the person or persons you refuse to let go of." The answer hangs off the
        // option that was taken, so it can only be written once the pick is made.
        await typed.setPostDeathLoreText("terrible-purpose", purpose.slug, entry.purpose);
      }
      const consequence = await firstTakeable("consequences");
      if (consequence) {
        await typed.markSectionOption("consequences", consequence.slug);
        await answerSubPick(typed, "consequences", consequence);
      }
    }

    // The insert's Instinct REPLACES the playbook's on the Details tab and in the header.
    const instincts = await typed.postDeathInstinctOptions();
    if (instincts[0]) await typed.setPostDeathInstinct(instincts[0].value);
    if (entry.tether) await typed.setTether(entry.tether);

    // A Thrall's first Mark can take 2 off their max HP, and the playbook fill left them at
    // the old maximum — so the sheet would open reading 20/18. Clamp to what the character
    // actually has now (computedMaxHp, never the stored attribute, which is the level-1
    // number and doesn't know about the insert).
    const max = await typed.computedMaxHp?.();
    const hp  = Number(actor.system?.attributes?.hp?.value) || 0;
    if (Number.isFinite(max) && hp > max) await actor.update({ "system.attributes.hp.value": max });
  };

  const graveFolder = await ensureTestFolder("Actor", "Graveyard");
  const buried = [];
  for (const entry of GRAVEYARD) {
    // A fork that renamed a slug still gets four graves rather than a silent gap.
    const pbDoc = playbookDocs.find(d => d.system?.slug === entry.slug)
      ?? playbookDocs[buried.length % playbookDocs.length];
    if (!pbDoc) break;

    const sel = { ...buildSelections(pbDoc), name: entry.name, notes: entry.notes };
    const actor = await Actor.create({ name: sel.name, type: "character", folder: graveFolder.id });
    await actor.setFlag(FLAG_SCOPE, TEST_FLAG, true);
    await actor.sheet._applyPlaybookSelections(pbDoc, sel);
    if (sel.notes) await actor.update({ "system.notes": sel.notes });
    await applyStartingMoveMarks(actor);
    await fillPostDeath(actor, entry);
    // The custom move, the follower and this slot's love letters again — on black paper this
    // time, which is the one place those cards are never otherwise seen.
    await seedTestCustomContent(actor, buried.length);
    buried.push(actor);
    console.log(`[TEST] Graveyard: ${actor.name} — ${pbDoc.name}, ${entry.fate}.`);
  }

  // ── Seed reusable world Moves / Items / Monsters ───────────────────────
  // Independent of the level choice and of the characters — draggable world content grouped
  // into "Moves" / "Items" (Item folders) and "Monster" (Actor folder). Torn down on re-run
  // by the world-item + actor sweeps and the empty-flagged-folder prune. The created Monster
  // actors come back so the example NPC below can @UUID-link its stat block to one.
  const testMonsters = await seedTestWorldContent();

  // ── Seed the steading "Stonetop" with test members ─────────────────────
  // Create the thematic Residents / Neighbors as `npc` Actors, file a pointer row for each
  // on the steading, and link the created PCs as Players, so the steading sheet's member
  // tables aren't empty. Merge alongside any existing members (each test row carries isTest,
  // so re-runs replace only our own additions: strip prior isTest rows first to stay
  // idempotent if a partial run left some behind).
  let testThreatPages = [];
  let testVillagers   = [];
  const steading = game.actors.find(a => a.type === "stonetop" || a.system?.customType === "stonetop");
  if (steading) {
    const sf = readSteadingFlags(steading);
    const keepReal = (arr) => (Array.isArray(arr) ? arr : []).filter(m => !m?.isTest);
    const people = await seedSteadingPeople(created);
    testVillagers = people.actors;
    sf.residents = [...keepReal(sf.residents), ...people.residents];
    sf.neighbors = [...keepReal(sf.neighbors), ...people.neighbors];
    sf.players   = [...keepReal(sf.players),   ...buildTestPlayers(created)];
    // Seed the demonstration formatted Notes only when the tab is empty (or still holds a
    // prior copy of this exact test content) — never clobber notes the GM wrote by hand.
    const existingNotes = typeof sf.notes === "string" ? sf.notes.trim() : "";
    const notesSeeded   = !existingNotes || sf.notes === TEST_STEADING_NOTES;
    if (notesSeeded) sf.notes = TEST_STEADING_NOTES;
    // Seed the three demonstration threats as pages of the steading's Threats journal,
    // recording the entry pointer on the steading flags (persisted by the setFlag below) so
    // the Threats tab can find them.
    const { entryId: threatsEntryId, pages: threatPages } = await seedTestThreats(steading, sf);
    testThreatPages = threatPages;
    if (threatsEntryId) sf.threatsEntryId = threatsEntryId;
    await steading.setFlag(FLAG_SCOPE, "steading", sf);

    // Other Settlements — the steading's own relations table, keyed by settlement slug (see
    // TEST_SETTLEMENT_RELS). Written to `system.relationships`, NOT to the steading flags.
    // A slug is seeded only while it is untouched or still holds a prior copy of this exact
    // seed, on the same rule as the Notes above: never overwrite a standing the GM set.
    const relUpdate = {};
    let relSkipped  = 0;
    for (const [slug, seed] of Object.entries(TEST_SETTLEMENT_RELS)) {
      const entry  = buildRelEntry(seed);
      const stored = steading.system?.relationships?.[slug];
      if (stored !== undefined && !sameRelEntry(stored, entry)) { relSkipped++; continue; }
      relUpdate[`system.relationships.${slug}`] = entry;
    }
    if (Object.keys(relUpdate).length) await steading.update(relUpdate);

    console.log(`[TEST] Seeded steading "${steading.name}": ${people.residents.length} residents, ${people.neighbors.length} neighbors (as NPC actors), ${created.length} players${notesSeeded ? ", formatted Notes" : " (left existing Notes untouched)"}${threatsEntryId ? `, ${testThreatPages.length} threats` : ""}, ${Object.keys(relUpdate).length}/${Object.keys(TEST_SETTLEMENT_RELS).length} settlement standings${relSkipped ? ` (left ${relSkipped} the GM had already rated)` : ""}.`);
  } else {
    ui.notifications.warn("[TEST] No steading actor found — skipped seeding residents/neighbors/players/notes/threats/settlement standings.");
  }

  // ── Seed the GM Toolkit's "I wonder..." list ───────────────────────────
  // Independent of the characters and of the steading: the list is the world's open questions,
  // stored on the toolkit singleton itself. Absent only when the world has not been relaunched
  // since the `gmToolkit` subtype shipped (a new documentType needs a relaunch, not an F5), in
  // which case the ready hook has not been able to mint one either.
  const wonders = await seedGmToolkitWonders();
  if (wonders) {
    const open = TEST_WONDERS.filter(w => !w.settled).length;
    console.log(`[TEST] Seeded the GM Toolkit "${wonders.toolkit.name}" with ${wonders.added} "I wonder..." questions (${open} open, ${wonders.added - open} answered)${wonders.kept ? `, alongside ${wonders.kept} the GM had already written` : ""}.`);
  } else {
    ui.notifications.warn("[TEST] No GM Toolkit actor found — skipped seeding the \"I wonder...\" questions.");
  }

  // ── Relationship hearts on the character sheets ────────────────────────
  // Last of the actor passes, because every key is a live actor id: the PCs above rate one
  // another AND the villagers just created (a villager row also gets an explicit tick, since
  // the steading's people start hidden in that section). Stored on each character, so the
  // re-run's Actor.deleteDocuments takes them down with the sheet — no cleanup of its own.
  const relCount = await seedPcRelationships(created, testVillagers);
  console.log(`[TEST] Seeded ${relCount} relationship ratings across ${created.length} character sheet(s).`);

  // ── Seed the example NPC ───────────────────────────────────────────────
  // One fully-filled `npc` Actor, cross-linked to a seeded Monster stat block + Threat and to
  // the created PCs (relationship hearts + @UUID connections). Torn down on re-run by the actor
  // sweep (isTest) and the empty-flagged "NPCs" folder prune.
  const exampleNpc = await seedTestNpc({ pcs: created, monsters: testMonsters, threats: testThreatPages });

  // ── The Judge's standing Condemnations ─────────────────────────────────
  // Last of all, because a brand stores a LINK to its target: every actor a row could name — the
  // PCs, the villagers, the monster stat blocks and the example NPC — has to exist before the
  // roster is written, or the row silently degrades to a name-only entry that tags no sheet.
  const brandCount = await seedCondemned(created, [created, testVillagers, testMonsters, [exampleNpc]]);

  // ── Record introductions answers + an example expedition ───────────────
  // So the GM can run game.stonetop.saveChronicle() (or the Introductions dialog's
  // "Save to the Chronicle" button) and open the Expedition walkthrough to immediately
  // see compiled content. Merge alongside any existing/real data rather than clobbering.
  const introAll = { ...(game.settings.get(FLAG_SCOPE, "introductionsAnswers") ?? {}) };
  for (const actor of created) introAll[actor.id] = buildIntroAnswers(actor.name);
  await game.settings.set(FLAG_SCOPE, "introductionsAnswers", introAll);

  const expLog  = game.settings.get(FLAG_SCOPE, "expeditionAnswers") ?? {};
  const keep    = Array.isArray(expLog.list) ? expLog.list.filter(e => !e?.isTest) : [];
  const example = buildExampleExpedition();
  await game.settings.set(FLAG_SCOPE, "expeditionAnswers", { currentId: example.id, list: [...keep, example] });

  // Compile + open the Chronicle straight away, so the recorded answers are visible
  // without running game.stonetop.saveChronicle() by hand. (Guarded in case the macro
  // is somehow run before onReady wires up the API.)
  await game.stonetop?.saveChronicle?.();

  ui.notifications.info(`[TEST] Done — ${playbookDocs.length} characters${maxLevel ? " (maxed to level " + (created[0]?.system?.attributes?.level?.value ?? "?") + "+, arcana scattered)" : ""}, ${buried.length} in the Graveyard (1st level, whatever the roster did), each with a test custom move + follower, ${TEST_WORLD_MOVES.length} world moves, ${TEST_WORLD_ITEMS.length} world items, ${TEST_MONSTERS.length} monsters and one example NPC, ${steading ? `${testVillagers.length} resident/neighbor NPCs, seeded steading members, Notes + 3 threats, settlement standings, ` : ""}${wonders ? `${wonders.added} "I wonder..." questions on the GM Toolkit, ` : ""}${relCount} relationship ratings, ${brandCount} Condemn brands on the Judge, introductions answers, an example expedition, and the compiled Chronicle.`);
  } finally {
    globalThis.__stonetopTestFixturesRunning = false;
  }
})();
