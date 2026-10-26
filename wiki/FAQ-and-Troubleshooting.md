# FAQ and Troubleshooting

Answers to the questions that come up most, and what to do when something looks wrong.

## Getting started

**Do I need any modules?**
No. Everything is built in. A few optional modules add 3D dice, attack animations and sounds, weather on the map, and round tokens. See [Installing and Recommended Modules](Installing-and-Recommended-Modules).

**Why are there no pictures of the monsters or villagers?**
The book illustrations are not open-licensed, so they don't ship with the system. If you own the PDFs, run [Import Book Art](Import-Book-Art) once and they appear everywhere.

**I'm new to Foundry. Where do I start?**
The GM's Welcome guide has a **New to Foundry?** link that opens a short primer on compendiums, journals and getting monsters onto the table. Then follow [Your First Session](Your-First-Session).

## Editing content

**I can't edit a journal, monster or item. Why?**
Bundled content lives in compendium packs, which belong to the system and are replaced on every update. An edit there would fail, or be lost at the next update. When you try, the system explains this and tells you how to make your own copy: import the document into your world (the **Import** button in its window header), then edit the copy in the Journal, Actors or Items sidebar.

**Will a system update overwrite my world?**
No. Updates replace the system's own files and compendiums. Your world's actors, journals, items and settings stay as they are, and your imported book art lives outside the system folder, so it survives too.

**My players can't create NPCs for the Residents and Neighbors lists.**
The system grants players Foundry's Create Actor permission once per world. If you removed it later in **Configure Settings > Permissions**, grant it again.

## Players and sheets

**Can players see each other's characters?**
By default, yes: every player can open every character sheet, read-only. Turn off **Players See Every Character Sheet** in the world settings to make sheets owner-only. See [World Settings Reference](World-Settings-Reference).

**A player's sheet looks different from mine.**
Layout, fonts, dark mode, font size and many other things are per-browser preferences, set on the **Preferences** tab of each player's own sheet. See [Preferences and Accessibility](Preferences-and-Accessibility).

**A roll keeps asking questions before it rolls. Can I skip them?**
Hold `Shift` while you click to skip every prompt for that roll. To stop the prompts for good, turn off **Ask How to Roll Each Time**, **Prompt for Roll Modifier** or **Adjust Damage Before Rolling** on your Preferences tab. See [Rolling Moves and Chat Cards](Rolling-Moves-and-Chat-Cards).

**Where did the Combat tracker go?**
Stonetop has no initiative, so the system replaces Foundry's Combat tab with a **Fight** tab that shows who is fighting whom. The GM can switch back in the world settings (it needs a reload). See [Running Fights](Running-Fights).

## Something looks broken

**A red notification says Stonetop "did not finish starting up".**
Part of the system failed to load, usually because of a conflict with another module. Try disabling other modules to find the one that clashes. When reporting it, open the browser console (`F12`), run `game.stonetop.bootReport()`, and paste the result into your report.

**A sheet or window looks wrong only in one world, or with a particular module on.**
Modules share one set of Handlebars helpers, so a module's helper can clash with Stonetop's. If a module replaces one of Stonetop's own helpers, the browser console (`F12`) shows a warning from Stonetop naming it. Try that world with the module disabled, and mention the warning when you report it. (The GM Toolkit failing to open with **Battle Transitions** active was a clash of this kind, and is fixed.)

**Portraits or tokens are cropped wrong, or missing after an update.**
Use **Build N more portraits from art you already have** in the Welcome guide (it shows only when there is something to rebuild), or run `game.stonetop.rebuildPortraits()` in the console. See [Import Book Art](Import-Book-Art).

**Windows I had open come back every time I reload.**
That is **Restore Open Windows on Reload**, a per-browser setting on your Preferences tab.

## Moving from the old package

If your world was made with the older release installed from `PrinceWitherdick/stonetop`, follow [MIGRATION.md](https://github.com/PrinceWitherdick/stonetop-pwd/blob/main/MIGRATION.md). A one-button migration assistant opens by itself in worlds that still need it.

## Reporting a problem

Open an issue at [github.com/PrinceWitherdick/stonetop-pwd/issues](https://github.com/PrinceWitherdick/stonetop-pwd/issues). Include your Foundry version, the system version, other active modules, and the output of `game.stonetop.bootReport()` if the system failed to start.

## See also
- [Hidden Tricks](Hidden-Tricks)
- [World Settings Reference](World-Settings-Reference)
- [Macros and Console Commands](Macros-and-Console-Commands)
