# Installing and Recommended Modules

How to install the system, which optional modules make it better, and what each one adds.

## Requirements

- Foundry VTT **v13 or v14**.
- No other modules are required. Everything on this wiki is built into the system.

## Install

In Foundry's setup screen, go to **Game Systems**, then **Install System**, and paste this manifest URL:

```
https://github.com/PrinceWitherdick/stonetop-pwd/releases/latest/download/system.json
```

Create a world with the **Stonetop** system and launch it. The first time a GM loads the world, a **Setting up your world** window imports the journals, monsters and treasures in the background. See [Your First Session](Your-First-Session) for what happens next.

Updates arrive through Foundry's normal **Update** button on the Game Systems tab.

### Already playing on the older release?

If your world was created with the earlier version of this system, installed from `PrinceWitherdick/stonetop`, it is pointed at a package ID that has since changed and will not move across on its own. Install this system alongside the old one and follow [MIGRATION.md](https://github.com/PrinceWitherdick/stonetop-pwd/blob/main/MIGRATION.md). Your world, its name, its folder and everything inside it stay where they are. This does not apply to anyone installing for the first time.

## Recommended modules

None of these are needed. Each one adds something when it is installed and does nothing when it isn't.

| Module | What it adds |
|---|---|
| [Dice So Nice!](https://foundryvtt.com/packages/dice-so-nice) | 3D dice for every move, damage and steading roll. Nothing to set up. |
| [Sequencer](https://foundryvtt.com/packages/sequencer) | Draws attacks on the map: swings, arrows, bites, misses and hits. |
| [JB2A](https://foundryvtt.com/packages/JB2A_DnD5e) | The animations Sequencer plays for attacks. The free edition is enough; the Patreon edition adds a few more (javelins, sling stones, thrown axes). |
| [SoundFx Library](https://foundryvtt.com/packages/soundfxlibrary) | Gives attacks their sound, with or without Sequencer: the hit of a blade, an arrow's fly-by, a shield's clank when armor takes the whole blow. |
| [FXMaster](https://foundryvtt.com/packages/fxmaster) | Puts the rolled weather on the scene your players are on: rain, snow, fog, storm light. |
| [Tokenizer](https://foundryvtt.com/packages/vtta-tokenizer) | Makes round map tokens from portraits, from an **Open Tokenizer** button beside each portrait's crop button. |

### Attack effects

With Sequencer and JB2A (and optionally SoundFx Library) installed, rolling damage at a target plays an animation picked from the weapon or the monster's printed attack: a sword swings, an arrow flies, a thrown spear arcs, a bite snaps. A ranged attack that rolls a 6- flies wide, and pressing **Apply** bursts on every token that loses HP. There is nothing to configure.

It is one world setting, **Attack Effects on the Map**, on by default. Anyone whose computer asks for reduced motion still hears the sounds but sees no animation. See [Running Fights](Running-Fights).

### Weather on the scene

With FXMaster installed, posting a weather roll puts it on the scene your players are viewing. You can pause it from the Weather window or turn it off under the **Weather on the Scene (FXMaster)** setting, and each kind of effect has its own switch. Without FXMaster the weather is still rolled and posted to chat. See [Seasons, Weather and the Year](Seasons-Weather-and-the-Year).

### Tokenizer

The crop button on a portrait frames the face the sheets show; Tokenizer makes the round token for the map. A token you make in Tokenizer is never overwritten when the portrait changes. See [The Character Sheet](The-Character-Sheet).

> **Did you know?**
> - The first time a GM loads a world, a GM-only chat card suggests FXMaster and the attack-effect modules if they are missing. It is posted once.
> - Book art is not a module. If you own the PDFs, the built-in [Import Book Art](Import-Book-Art) macro brings the illustrations into your world.

## See also
- [Import Book Art](Import-Book-Art)
- [Your First Session](Your-First-Session)
- [FAQ and Troubleshooting](FAQ-and-Troubleshooting)
