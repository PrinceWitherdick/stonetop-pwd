# Stonetop for Foundry VTT

An unofficial [Foundry VTT](https://foundryvtt.com) system for playing [Stonetop](https://plusoneexp.com/collections/stonetop) by Jeremy Strandberg.

## 🤖 Created in collaboration with AI to facilitate rapid development. Absolutely no image generation was or will be used.

## Features

Everything below is built into the system. No extra modules required.

### For Players

#### Guided Character Creation

A multi-step onboarding wizard handles everything from playbook selection to the final starting move. Each playbook's unique setup is fully supported: backgrounds with conditional forms, appearance builders, stat allocation, starting moves and invocations, crew and animal companion configuration, lore questions, and Seeker arcana. Progress is saved so players can pause and return without losing their work.

![Guided character creation, choosing a playbook](.github/screenshots/character_creation.webp)

#### Level-Up Wizard

Clicking Level Up opens a step-by-step wizard. It shows the XP cost, presents every move the character is eligible for (locking moves whose prerequisites aren't met), and, on even levels, surfaces available Invocations. Picking a move that grants a choice (a stat increase, a move borrowed from another playbook, an extra Sacred Pouch trait) opens the matching chooser inline, and the wizard flags when you still have picks left to spend. Confirming applies the new level, deducts XP, and adds the chosen move to the sheet in one click.

#### Outfit & Inventory Management

The Outfit Move dialog lets players check off items and see their load level update in real time. The system calculates armor automatically from equipped items (base plus modifiers) and tracks pool slots, small-item limits (tied to steading prosperity), and per-item resources like rations and ammo.

#### Followers

Build a follower from scratch with a guided builder, or turn any bestiary monster into a follower in one step. Each follower lives on a single card with per-section editing for instinct, moves, cost, and tags. During play the card handles the follower moves for you: Order rolls, Strengthen Bond, ammo and supply tracks, and a follower's fate at 0 HP. Group warbands, hirelings, and companions to keep the tab tidy.

![The Marshal's Followers tab, with a group follower and a single companion](.github/screenshots/followers_example.webp)

#### Seeker Arcana

The Seeker's arcana ship as a browsable deck. Cards track their marks, unlocks, and resource tracks interactively, the GM can reveal a whole card (or just its front) to a player once it's discovered, and a per-card ledger records every change so the table can see an arcanum's history at a glance.

![The Seeker's Arcana tab, showing a major arcanum's front face](.github/screenshots/arcana_example.webp)

### For Game Masters

#### Guided First Session

The GM gets a **Welcome** guide and a **Let Spring Burst Forth** walkthrough that frames the village's opening scene step by step, with one-click sharing of the right journals to the table. Players see a guided creation intro and a **resumable** onboarding flow, while the GM watches a live roster fill in as each character is finished. A **New to Foundry?** primer helps first-time Foundry users find their feet.

#### GM Toolkit

Every world gets one **GM Toolkit**, the screen-side companion to the GM playbook, opened straight from the GM's own character slot. Its **GM Moves** tab lays out the full move lists, basic, exploration, and homefront, each one expandable to what the book says about it, with a "draw one at random" whisper for when nothing comes to mind.

![The GM Toolkit's GM Moves tab](.github/screenshots/gm_toolkit_moves.webp)

**Homefront** collects life in Stonetop, the year's work, and the Aftermath and Downtime procedures that bracket every expedition. **Threats & Dangers** and **Sites** hold the GM's prep. **Core Loop** reproduces the two flowcharts, the exchange-by-exchange loop and the campaign's flow between adventure and home, in a window you can zoom and pan.

![The Core Loop tab's two flowcharts](.github/screenshots/gm_toolkit_flowcharts.webp)

**I Wonder...** is the one page on the sheet a GM writes rather than reads: a running list of open questions, the things you don't know the answer to yet or want to leave for play to answer. Answer one and it drops to the **Answered** list below, so the top of the page stays the questions still open.

![The I Wonder tab's list of open questions](.github/screenshots/gm_toolkit_i_wonder.webp)

#### GM Result Controls

After any roll, the GM can shift the result up or down by one tier directly from the chat card (Strong Hit to Weak Hit to Miss, and back) without re-rolling. Characters with the Burn Brightly feature can spend 2 XP from the chat card to bump a recent roll by +1.

#### Steading Sheet & Seasonal Automation

The Stonetop steading sheet tracks Fortunes, Prosperity, Population, and Defense alongside the debility system (Diminished, Lacking, Malcontent). Steading moves are wired up: **Meet with Disaster** auto-applies the Fortunes penalty and picks a consequence; **Seasons Change** steps through the full seasonal checklist with automatic resource updates and nudges each player with a personal upkeep reminder; **Muster** deducts Fortunes before the roll. Completing an improvement automatically applies its one-time effect (reversible if you undo it), Places of Interest can be dragged onto a scene to drop a lettered map note, and a seasonal **Weather** oracle plus an **Expedition** GM walkthrough round out the homefront tools.

#### Homebrew Content Creation

A **Create Content** picker mints your own material as reusable world items: homebrew Arcana, custom Moves players can roll, Inventory Items, Steading Improvements, and Threats. Each one is saved once and then dragged onto the sheet or tab where it belongs, so a table can grow its own deck of moves, gear, and dangers alongside the bundled content.

![The Create Stonetop Content picker](.github/screenshots/homebrew_content_creation.webp)

### Bundled Content

#### Bestiary

The system ships with the full bestiary of Books I and II: around 180 creatures, each with an illustrated codex entry and a ready-to-drop stat block, sorted into 38 regions and tagged by creature type. Monster and codex content stays hidden from players until you reveal it, so it doubles as a spoiler-safe GM reference.

![A bestiary stat block, with the creature's illustration imported from Book II](.github/screenshots/monster_example.webp)

#### Locations & Lore

A bundled **Stonetop** journal compendium covers the wider world: all 30 Book II locations plus the setting's gods and factions, cross-linked to one another and to the bestiary so a click carries you from a region to the creatures that haunt it. Hover any link for a one-line summary. Seeded entries refresh automatically when the system updates, unless you've edited them, in which case your version is left untouched.

#### Browse Stonetop

One **Browse Stonetop** window, on the magnifying-glass hotbar macro, answers "what have we got?" across the bundled content: every arcanum, every creature, and the world's own NPCs, each in its own tab. Filter arcana by tier, by what they grant, and by curse; creatures by section, type, and the numbers they come in; people by status and home. It reads the GM-hidden compendia, so it is seeded GM-only.

![The Browse Stonetop window, filtering the arcana catalog](.github/screenshots/browse_stonetop.webp)

### Art from Your Own Books

Lucie Arnoux's illustrations are not open-licensed, so none of them ship with this system. If you own the PDFs, though, the art is already yours, and an **Import Book Art** wizard pulls it out of your own copies and into your own world.

![The Import Book Art wizard asking for the rulebook PDFs](.github/screenshots/import_book_art.webp)

Five steps, each one optional: point it at **Book I** and **Book II** (the "spreads" editions, 308 and 302 pages), at the **GM playbook**, which is a free download and adds five more pictures, and at the **poster maps**. Skip any of them and that part is simply left out; come back for the rest another time and nothing already imported is touched, unless you tick **Force update**.

What lands is every monster portrait, every location illustration, the villagers' faces, treasure and steading art, the GM playbook's flowcharts, and the poster maps as ready-made scenes. Bestiary entries, location journals, and the People gallery pick the pictures up on their own once they are on disk.

The extraction runs locally, in your browser, on the file you chose. Nothing is uploaded, and the images are written into your own Foundry data under `stonetop-book-art/`, never into the system folder and never into a release. If you do not own the books, everything else in this system still works; the illustrated slots just stay empty.

## Screenshots

![A character sheet, the Stonetop steading sheet, and a bestiary stat block side by side](.github/screenshots/sheets-overview.webp)

---

## Prerequisites

- Foundry VTT v13 or v14

## Installation

In Foundry VTT, go to **Game Systems -> Install System** and paste this manifest URL:

```
https://github.com/PrinceWitherdick/stonetop-pwd/releases/latest/download/system.json
```

That is all you need. Install it and start a world.

### Already playing on the older release?

If your world was created with the earlier version of this system, the one installed from
`PrinceWitherdick/stonetop`, it is pointed at a package ID that has since changed and it
will not move across on its own. Install this system alongside the old one and follow
[MIGRATION.md](MIGRATION.md); your world, its name, its folder and everything inside it
stay exactly where they are. Nothing is copied and no world is recreated.

This does not apply to anyone installing for the first time.

## Recommended Modules

- **[Dice So Nice!](https://foundryvtt.com/packages/dice-so-nice)** renders 3D dice rolls on the tabletop. Every move, damage, and steading roll in this system uses Foundry's dice, so Dice So Nice adds a tactile sense of immersion to the table without any extra setup.

## Development

```bash
npm install        # install dev dependencies
npm run pack       # compile JSON source into LevelDB compendium packs
npm run unpack     # extract packs back to JSON source
npm test           # run tests
```

## Credits & Attribution

Stonetop is the work of many hands. Per the credits page in the rulebooks, this system builds on:

- **Written by** Jeremy Strandberg
- **Illustrated by** Lucie Arnoux
- **Arranged (design & layout) by** Jason Lutes
- **Proofread by** Angel Green, Rob Rendell, Matt Wetherbee, John Pham, Steven Quillen, and Dennis Taylor
- **and a legion of volunteers** from the Stonetop community
- **Published by** [Lampblack & Brimstone](https://lampblackandbrimstone.com)

Some concepts and procedures are derived from *Dungeon World* by Sage LaTorra & Adam Koebel, used under a Creative Commons Attribution (CC BY) license.

All of the game's artwork is © Lucie Arnoux. That artwork is **not** open-licensed and is **not** redistributed by this system: the illustrations from Stonetop's books do not ship here. Any art bundled with this system is either our own work or separately licensed (see below).

## License

This system reuses the CC BY-SA 4.0 text and evokes the visual presentation (trade dress) of Stonetop. In keeping with the ShareAlike terms, the game-content portions of this project are released under the same license, with attribution to the creators above.

- **Code** (JavaScript, templates, styles, build tooling) is licensed under the [MIT License](LICENSE).
- **Game content** derived from [Stonetop](https://plusoneexp.com/collections/stonetop) by Jeremy Strandberg, together with any part of this system that reproduces the game's text or evokes its trade dress, is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Icon assets** sourced from [game-icons.net](https://github.com/game-icons/icons) are used under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), with per-icon artist credits in the [playbook](assets/playbooks/ATTRIBUTION.md), [macro](assets/icons/macros/ATTRIBUTION.md), and [interface](assets/icons/ATTRIBUTION.md) attribution files.

This is an unofficial, fan-made system, not affiliated with or endorsed by Jeremy Strandberg or Lampblack & Brimstone. Stonetop, its artwork, and its trade dress remain the property of their respective owners.

## AI Training and Data Mining

Rights are reserved for text and data mining, machine learning, and AI training. This project and its release artifacts may not be used to train, fine-tune, or evaluate AI models, or be included in datasets built for those purposes. See the [AI Training and Data-Mining Notice](AI-TRAINING-NOTICE.md), with machine-readable signals in [`ai.txt`](ai.txt), [`.well-known/tdmrep.json`](.well-known/tdmrep.json), and [`robots.txt`](robots.txt).
