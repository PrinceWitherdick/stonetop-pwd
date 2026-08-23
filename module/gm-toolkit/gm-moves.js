// The GM's move lists, transcribed from the GM playbook's first spread ("GM moves",
// "Exploration", "Homefront") and glossed from Book I "Running the Game" (pp. 178-188),
// "Expeditions" (pp. 317-321) and "Homefront" (pp. 502-507). Both ranges name the pages the
// GLOSSES come from, not just where the bullet list is printed: the per-move descriptions run
// well past the list itself.
//
// Reference only. Nothing here rolls, nothing here is stored on the actor: a GM move is
// something you say, not something the sheet resolves, and the playbook prints these as a
// list you glance at mid-sentence. The one-line gloss under each name is the house shape
// the Expedition dialog's exploration list already uses (module/dialogs/ExpeditionDialog.js).
// The exploration glosses ARE that list, word for word, differing only in the leading capital
// (the dialog's run on from an inline dash; these stand alone). A test pins the two together,
// so the same move cannot come to mean two different things on two screens.
//
// Order is the playbook's, not alphabetical. The book's order is a rough ladder from the
// softest move to the hardest, and a GM scanning for "what now?" reads it top-down.
//
// ── The book's own text ──────────────────────────────────────────────────────────────────
// Beyond the name and our gloss, each move carries what Book I prints under it:
//
//  • `detail`   The book's descriptive paragraphs, in the book's words. An ARRAY, because the
//               longer entries (Hurt someone, Advance towards impending doom) genuinely need
//               three, and a single blob would render as one unreadable slab.
//  • `hardness` The "As a hard move, ..." line where the book gives one, and the soft one where
//               it gives that instead. Twelve of the thirty have one; the other eighteen are
//               silent on it and carry no field rather than an invented guess. One field rather
//               than a soft/hard pair, because the book writes it as one sentence and two of
//               these (Capture someone, Start a conflict or crisis) cover both halves in it.
//  • `examples` The lines of actual GM speech the book prints, VERBATIM. These are the reason
//               this data exists: the randomizer whispers a move mid-sentence, and a name plus
//               a gloss still leaves a GM to invent the sentence, while one example of how the
//               move SOUNDS is something to say in two seconds. They use the book's own sample
//               cast (Rhianna, Caradoc, Blodwen, Vahid, Eira, Lowri...), which is why they are
//               presented as quotations from the book and never as our own text.
//  • `page`     Printed page in Book I, so a GM can go and read the whole entry.
//
// TRANSCRIPTION RULES, so a later edit does not drift from the page:
//  • `detail` and `examples` keep the book's wording and punctuation. Curly quotes and ellipses
//    are normalized to ASCII, and the book's parenthetical cross-references ("see page 243")
//    are dropped where the surrounding sentence still stands without them. Nothing is reworded.
//  • The outer quotation marks are NOT part of an example. The renderers add them, so that one
//    surface can set them as a blockquote and another as an inline quote.
//  • `gloss` is OURS, not the book's, and stays as it was: one line, house voice, the shape the
//    Expedition dialog renders.
//
// The exploration moves are printed TWICE in Book I, once for expeditions (p.317) and again for
// sites (p.352), re-framed for a dungeon rather than a journey. What is transcribed here is the
// EXPEDITION printing, which is the fuller of the two and the only one that carries the hard-move
// notes; `pageAlt` points at the other. Choosing per-context would mean two copies of every
// entry, and the moves themselves are the same seven either way.

/**
 * @typedef {object} GmMove
 * @property {string}   name       The move, worded exactly as the playbook prints it.
 * @property {string}   gloss      One line on what making it looks like at the table. Ours.
 * @property {number}   page       Printed page in Book I where the book's entry begins.
 * @property {number}   [pageAlt]  A second printing of the same move, where the book has one.
 * @property {string[]} detail     The book's own description, paragraph by paragraph.
 * @property {string}   [hardness] The book's soft/hard guidance, where it gives any.
 * @property {string[]} examples   Lines of GM speech, verbatim, without their outer quotes.
 */

/** The basic list, usable at any moment of play (GM playbook p.1; Book I p.178). */
export const BASIC_GM_MOVES = [
	{
		name:  "Announce trouble (future or offscreen)",
		gloss: "Trouble coming, or happening elsewhere. One of your most versatile.",
		page:  180,
		detail: [
			"This is one of your most versatile moves. Trouble almost always provokes a reaction, or at least gets folks worrying and cranks up the tension.",
		],
		hardness: "As a hard move, you can turn a previously peaceful scene into a fight or conflict, or maybe make it clear that the PCs' actions will have consequences later.",
		examples: [
			"WHOOMP WHOOMP WHOOMP! Rhianna, there's a banging at your door, waking you up from that much-needed sleep. Lowri's calling your name and you hear the watch-bells clanging. What do you do?",
			"As Caradoc and Blodwen leave, this nasty piece of work watches them go. He's got a face full of scars, a cruel sneer, and a knife at his hip. He nudges the guy next to him, nods at the door, and they get up and go. What do you do?",
			"Glenys gives you a hard stare for a few moments, then she's like, 'FINE.' And she huffs and stomps off. She's out of your hair for now, but you just know that you're going to have to deal with that later.",
		],
	},
	{
		name:  "Reveal an unwelcome truth",
		gloss: "Establish something as true that they really wish wasn't.",
		page:  180,
		detail: [
			"Establish something as true, something that they really wish wasn't. Maybe it was true all along but you're just revealing it now. Or maybe (especially as a hard move) you're deciding right now that this bad thing is true and letting them know. Both ways work.",
			"This is a great move to use when they Know Things or Seek Insight. On a 7+, you owe them honest answers or interesting (maybe useful) information, but there's no reason they have to be happy about what they learn. And on a 6-, you can really twist the screws.",
		],
		examples: [
			"'Vvvasil? Heavvvens, no. Vvvassil leffft town thhhis past autumn. Back down to Lygos, I heard.' He smiles, and it's like he has too many teeth. 'But ssssurely we can make some sort offff... arrangement?'",
			"What happened here recently? Well, there's like a dozen sets of prints in the mud, all churned up like there was a fight. A few splashes of blood, too, on the foliage. It's pretty clear Lowri got jumped by the crinwin.",
			"Oof, a 6-? Well, you search the hills for the rest of the day and... I guess you don't find her? No, wait. You know what? You do find Cadi. Maybe half a mile from the logging camp, you find her body. Something stabbed her, impaled her right through the gut.",
		],
	},
	{
		name:  "Ask a provocative question",
		gloss: "Spur a decision or a reaction, even if the reaction is only a feeling.",
		page:  181,
		detail: [
			"Ask a question that spurs a decision or response, even if it's just an emotional response or a decision not to act. You can ask the question yourself or put it in the mouth of one of your NPCs. Alternately: ask a question that asserts badness but that gives the player a chance to author it.",
		],
		examples: [
			"Rhianna, Eira's looking grim, and she's like: 'Garet's losing a lot of blood. I don't think he's gonna make it, and he's gonna slow us down something frightful. You want me to do the necessary?'",
			"Caradoc, you come in at the very end of all this, I think. You saw that cloud of smoke billowing out of Vahid's mouth. And there's Vahid, just acting totally normal about everything. What's going through your head right now?",
			"Oof, a 4? Well, I think you manage to offend her, like really hurt her feelings. What do you say or do that does that?",
		],
	},
	{
		name:  "Put someone in a spot",
		gloss: "Announce trouble, but sharper: do something now, or it gets ugly.",
		page:  181,
		detail: [
			"This is a more aggressive version of announcing trouble. They've got to do something, now, or it'll get ugly.",
			"'Someone' can be a PC or an NPC, and you can play with the spotlight. Maybe the person you put in the spot isn't the one that does something about it.",
		],
		examples: [
			"So close! You make the jump, but smack into the bough. You slip, just barely grabbing on. You're hanging from that bough like this, gasping for air, like 80 feet up, and your grip is starting to go. What do you do?",
			"The big guy stands and glares down at you. 'What'd you call me, you skinny little rat?' Rhianna, you see this happen and notice like three other guys, burly miner types, standing up too, not a smile among them. What do you do?",
			"So, it's like you said, the drake calms as you place your hand on its snout, and it's like a mewling kitten. But Caradoc, you're watching from the brush, and as Blodwen's calming that one, you spy another drake, behind her to her right, slinking up. It's about to pounce on her, you're sure of it, what do you do?",
		],
	},
	{
		name:  "Use up their resources",
		gloss: "Whittle away at their gear, supplies, standing, or HP.",
		page:  182,
		detail: [
			"Something happens that whittles away at their stuff, or that takes it away from them entirely. Resources here can be concrete and specific (their shield, their torch, their lamp oil), concrete but abstract (supplies, ammo), intangible (their reputation, someone's trust), and/or entirely mechanical abstractions (HP, Fortunes, Loyalty, etc.).",
			"When they lose something abstract, intangible, or purely mechanical, you should always bring that back to the fiction and show how it manifests. 'He glares a little, then shakes his head, disillusioned. If he held any Loyalty, he's got 1 less now.'",
			"When you use up a specific resource, the loss can be temporary ('he swats the knife out of your hand, it goes flying across the room') or permanent ('the blow shatters your shield'). You'll often find yourself making this move along with other moves, and that's okay.",
		],
		hardness: "As a soft move, use this move to ratchet up the tension. Those 4 HP might not mean much now, but after a couple more blows the player is going to start getting nervous.",
		examples: [
			"It's been like an hour since you came down here. I think your torch is getting low. Like, you've got maybe ten minutes of light left? What do you do?",
			"Yeah, so your grip slips and down you tumble, smacking against branches all the way, WAM WACK WHOOMP. You land flat on your back, and you're pretty sure you felt something break in your pack. Lose 2 uses of supplies and take 1d6 of damage, ignoring armor. What do you do?",
			"Yup, he was totally standing right behind you as you said that last bit. You look back and he's just beet red, on the verge of crying or yelling, you're not sure. But he just turns and stomps off into the fields. I think he just lost any Loyalty he was holding. What do you do?",
		],
	},
	{
		name:  "Turn their move back on them",
		gloss: "Take the move they just made and flip it against them.",
		page:  183,
		detail: [
			"This is a good one to use on a 6-. Take the move they were making, and flip it somehow. Maybe you give the advantage to their foes, maybe you have them come up with something bad for you to work with, maybe their move constrains their options instead of expanding them. Get creative.",
		],
		examples: [
			"Oh, I think you know all about this evil quicksilver, Vahid. Why don't you tell us about the horrible encounter you had with it back down south, and how it's left you shaken to this day.",
			"A miss, huh? Tell you what, ask one of the Seek Insight questions anyhow, but you'll have disadvantage to do anything BUT act on the answer.",
			"Yeah, she's just not buying it. There's no way you're going to convince her to squeal on Mutra. In fact, she starts twisting the conversation around, asking you questions, tripping you up, getting you flustered. What do you think it'd take for her to get you to spill the beans on where Vahid has the Heart hidden?",
		],
	},
	{
		name:  "Demonstrate a downside",
		gloss: "Show the limits of their moves, or the baggage of being who they are.",
		page:  183,
		detail: [
			"Show the limits of their moves, or the baggage that comes with being (e.g.) the Heavy. Show them just how a crude weapon fares against an iron sword or shield. Show them why wearing warm armor in the blazing sun is a bad idea. Show them why it's hard to be short, or tall, or young, or old, or whatever.",
		],
		examples: [
			"Caradoc, Rhianna, as you're watching the crinwin from the brush, you hear this, ka-chunk ka-chunk ka-chunk. Vahid's pack, for sure, and the crinwin hear it too. What do you do?",
			"Caradoc, the second time you try to interject, Brennan's like 'Grown-ups are talking, boy.' And he turns back to Rhianna. 'Now, you were saying...?'",
			"Your spear jabs in, and the aurochs bellows, but then it rears and twists and the spear's shaft snaps off. You're left holding half of a stick.",
		],
	},
	{
		name:  "Hurt someone",
		gloss: "A specific, problematic wound on a PC or on someone they care about.",
		page:  184,
		detail: [
			"Inflict a specific, problematic injury or wound on a PC or an NPC they care about. Something more than just losing HP. Something painful, bloody, consequential, or all three. Using this move definitely means the victim takes damage, and against a PC it might also mean that they mark a debility. It definitely means that they've now got a problematic wound.",
			"How badly you hurt them depends on the fiction, whether the harm came from a 7+ or a 6-, the damage rolled, and the tags on the damage (messy, forceful, etc.). Feel free to describe the general nature of the wound, then have the player roll damage, and modulate the injury based on the damage dealt.",
			"As a rule, only inflict a permanent, disabling injury if you've warned them it's possible (explicitly or by telegraphing or demonstrating the danger), and either they rolled a 6- or they knowingly ignored the danger. Don't spring that stuff on them.",
			"With that said: feel free to hurt NPCs more aggressively and brutally than you hurt the PCs. Taking a follower's arm is a great way to show that this thing's attacks are messy and terrible, raising the stakes without deprotagonizing the PCs.",
		],
		examples: [
			"It like reaches out towards Eira, its hand expanding like mist and clutching her chest, and she just starts moaning and convulsing and you see bits of her skin blackening. She takes 1d12 damage, ignoring armor. Is she still up? No? Okay, well it drops her and she just slumps to the ground. What do you do?",
			"It just SQUEEZES and you can't breathe, can't move, then SNAP you feel a rib go and HOLY CRAP this hurts. Take a d8+3 damage, ignoring armor, and mark weakened. Vahid, you finish lighting the naphtha as this happens, see Caradoc turning blue in its coils. What do you do?",
			"Oh dear. 9 damage? And you're still up? Yeah, um... I think as you try to wrench your arm free, it, um... crap, I think it just chomps down hard and there's just this searing pain and you go staggering back. You're free, but you look down and your right arm is just gone. Blood is spurting, you feel cold, and you think you might faint. What do you do?",
		],
	},
	{
		name:  "Separate them",
		gloss: "Split the party. Put foes, distance, or a long fall between them.",
		page:  186,
		detail: [
			"Split the party. Put foes or obstacles between them. Have someone fall behind. Have a follower or other NPC go missing. Send someone tumbling down the slope, taking them out of the fight. That sort of thing.",
			"This move often pairs well with put them in a spot. Because what's worse than being in a spot? Being alone in a spot.",
		],
		examples: [
			"Blodwen, after maybe twenty minutes of pushing through the tall grass, you all get a little spread out and you realize you can't see anyone else. At first you can hear them so no big deal, but then the sound of them moving through the grass is lost in the constant wind. What do you do?",
			"Oof. Yeah, as you give her your spiel she's kind of stone-faced, no response. Then there's this pause, and she sorta gasps and sobs and then come the waterworks. 'Dammit, Caradoc.' And she turns and slams the door and you can hear her weeping. What do you do?",
			"Okay, cool, so Vahid you're a bit further down the hall, right? With Lowri holding the lantern for you? Well, as you start to make out the runes, something about 'portal' or 'doorway' or maybe 'road', there's this CUH-CLUNK that you feel in your chest, everyone does, and then a screeching metal-on-metal sound and this steel curtain drops from the ceiling, cutting off the hallway. BOOM. Vahid, you and Lowri are on the far side of it, by yourselves, dust billowing all over. What do you do?",
		],
	},
	{
		name:  "Capture someone",
		gloss: "Soft: taken, but still in the scene. Hard: cut to bound and dragged off.",
		page:  186,
		// No separate description in the book: the whole entry IS its soft/hard guidance.
		detail: [],
		hardness: "On a soft version of this move, capture them but stay in the scene, giving them a chance to escape (or others a chance to rescue them). On a hard version, maybe cut straight to the next scene, captured, bound, dragged off who knows where, and just gloss over the details of how they got there.",
		examples: [
			"Brennan whistles and Ragan, calm and quick as anything, he just grabs Blodwen and spins her around, knife to her throat. Brennan sighs, steps back behind them. 'I'd hoped it wouldn't come to this, but you don't leave me much choice. We'll be going, and I'm sure the young lass here would appreciate it if you all kept your hands where I can see them.' They start backing away, what do you do?",
			"Caradoc, you touch the sphere it's like WHOOSH. You're floating in space, looking down over your body. The world is gray and hazy and washed out, and you can't really feel your feet. Vahid, you come home a couple hours later and find Caradoc just slumped over the ice-sphere, his fingers touching it and all blue. He's not responding. What do you do?",
			"Yeah, Vahid, Lowri is like waving the torch around in the dark and you're both peering out, looking for whatever made that noise, and we the audience see this shadowy form loom up behind you with these long, spindly fingers. Those fingers clamp down over your mouth, Vahid, and another shape grabs Lowri. There's a brief struggle and then the camera like pans down to the lantern on the floor, on its side, cracked and flickering. We hear sounds of you two getting dragged away. Rhianna, while this is happening...",
		],
	},
	{
		name:  "Offer an opportunity (with or without a cost)",
		gloss: "An opening to act, free, priced, or maybe priced.",
		page:  187,
		detail: [
			"Give them an opening, a chance to act. The opportunity can be specific ('If you act now, you'll have the drop on them.') or general ('They don't seem to have spotted you, what do you do?'). It can come with a definite cost ('...but it'll make a bunch of noise and raise the alarm.') or a potential cost ('...but you'll have to hurry to make it in time') or no cost at all.",
			"You'll often make this move without realizing it. When you just hand a player the initiative, when there's a tense, active situation and you ask 'What do you do?' without first announcing trouble or putting them in a spot or otherwise making them react, you're offering them an opportunity.",
		],
		examples: [
			"3 damage? With his armor, that's not enough to drop him. I think he jerks back and you just like score a slice down his cheek. But he's on his heels, what do you do?",
			"They're not taking the bait, Rhianna. But if you made a show of heading out of camp and leaving Andras and Blodwen there alone? That'd do it. What do you do?",
			"What here is useful or valuable to you? That glowing blue crystal set in the wall. If you smash it, it'll unleash all sorts of chaos, just the distraction you need.",
		],
	},
	{
		name:  "Tell them the consequences/requirements (then ask)",
		gloss: "Interrupt to set the stakes. \"If you do that, you realize ___, right?\"",
		page:  187,
		detail: [
			"Use this move as an interrupt, as a way to clarify the fiction and set the stakes when they say they want to do a thing. 'If you do that, you realize that ___, right?'",
			"Use this move, also, to give them a path forward when the way is otherwise blocked. Use it to force a meaningful decision. Use it to make them pay (in time, resources, opportunity, etc.) if they want to follow a course of action.",
		],
		examples: [
			"What about Garet's body, Rhianna? If you leave it, the rest of the crew is going to grumble, you know how superstitious they are. You could burn it, but that'll take time and give away your position. What do you do?",
			"If you do that, cool, but you won't have a chance to get clear. You'll be caught in the blast for sure. You do it?",
			"Yeah, no. Your hands are shaking, your mouth is dry, you can't think about anything but that baleful, hateful eye. You want to take a shot, you're going to have to get it together first. What do you do?",
			"Vahid, you can't make heads or tails of these runes, not right now at least. Maybe if you took a rubbing and had time to study them back home, with all your books and notes and everything. But not out here. What do you do?",
		],
	},
	{
		name:  "Advance towards impending doom",
		gloss: "A grim portent of a threat or a hazard comes to pass.",
		page:  188,
		detail: [
			"Threats and hazards might have impending dooms, each with a series of grim portents leading up to them. When you make this move, you decide that one of those grim portents has come to pass, and show it to the characters.",
			"In practice, this move almost always manifests as another move. You announce trouble or reveal an unwelcome truth or put someone in a spot (etc.) in a way that demonstrates that the grim portent has come to pass.",
			"Rarely, you might chuckle evilly and tick a box, and say that they've got a bad feeling or that a cold wind blows, without actually revealing the portent just yet. When you do this, be sure to commit to the portent having come to pass offscreen. If you don't, you haven't really made a move at all.",
		],
		examples: [
			"You find Nia in that collapsed house on the edge of town. You've got to squeeze in there, and your eyes have to adjust to the dark, but when they do, your stomach drops. There're chalk drawings of spiders all over the walls, and... an altar? With this mass of sticks, fur, and web that you realize is an idol of a big spider. Nia's all smiling and like 'Hi Blodwen, do you like my drawings?' What do you do?",
			"So, you're stabbing at it over your shoulder, but stumbling around as you do. And I think, yeah, you kill it, but you end up staggering back into one of the old columns. There's this loud CRACK and some creaking and dust starts to pour down from the ceiling. Vahid, you see this happen, what do you do?",
			"Caradoc, as you drift off to sleep, you find yourself dreaming. A really weird, vivid dream. It's like when you were in that old Maker-tomb and looking up, but... different. More claustrophobic. Like you're buried in dirt, have been forever, and there's this light above, far away. But it's... enough, you know? Something to move towards? And so you stretch, and claw through the dirt, towards the light, and you snap awake and holy crap, everything's shaking and people are screaming and kids are crying, it's an earthquake! What do you do?",
		],
	},
];

/**
 * Exploration moves, for an expedition or a site (GM playbook p.1; Book I pp. 317, 352).
 *
 * The Expedition walkthrough's right-hand rail READS this list rather than restating it (see
 * ExpeditionDialog's `EXPLORATION_SIDEBAR_MOVES`), so the two surfaces cannot teach the same
 * move in different words. Reword one here and both screens change together. It takes the
 * name and the gloss only; the book's own text below stays here, for the Moves tab.
 */
export const EXPLORATION_GM_MOVES = [
	{
		name:    "Provide a choice of paths",
		gloss:   "A fork with a meaningful difference.",
		page:    317,
		pageAlt: 352,
		detail: [
			"Present the proverbial fork in the road and ask them which way they go. There might be other paths, and they might do something different, but you're presenting the obvious options and prompting them to choose.",
			"Try to give them some indication of how the options are different. Otherwise, their choice isn't meaningful.",
			"The available paths don't have to be literal paths, or they don't both have to be. For example, the choice could be between stopping and exploring this ruin, or pressing on towards their destination.",
		],
		hardness: "As a hard move, provide a choice between paths that they don't want to take.",
		examples: [
			"The cave is maybe 30 or 40 paces off to your right, no sign of movement around it. But, Blodwen, you spot tracks in the snow. Big ones, leading from the cave and off to your left. What do you do?",
			"Okay, the sleds are loaded. Are you going to head back the way you came? The crinwin will almost certainly notice you if you do. Or you could cut deeper into the Woods and try to circle around them, but that'll take longer. What do you do?",
			"As hard as you push yourselves, by the time the sun's almost set, you're still a good half-hour away from town, maybe more. Do you press on, traveling in the dark? Or do you start looking for some place to spend the night out here?",
		],
	},
	{
		name:    "Hint at more than meets the eye",
		gloss:   "Point at something fraught, stay coy.",
		page:    318,
		pageAlt: 352,
		detail: [
			"Drop a hint that there's something interesting here, a discovery to be discovered or a lie to be uncovered. This move often spurs the players to Seek Insight or Know Things or otherwise look closer.",
			"To make this move, point out something out of place or something fraught with meaning, but don't say what it means. Be a little coy about it. It's a hint, not an announcement.",
		],
		examples: [
			"Blodwen, while Rhianna and her crew are butchering the bear, you get this... feeling. Like, sort of a chill, and not just from the cold. You think you're being watched. What do you do?",
			"Vahid, as you watch the crinwin flee, you realize that they all headed for this great big redwood pine, maybe fifty paces away. Just the sort of tree where they'd nest. Everyone else is catching their breath and wiping off crinwin blood. What do you do?",
		],
	},
	{
		name:    "Offer riches at a price",
		gloss:   "Something valuable, but costly or fleeting.",
		page:    318,
		pageAlt: 353,
		detail: [
			"Show them something valuable, but costly or difficult to get. Then sit back and see if they think it's worth it.",
			"Consider 'riches' to be anything the PCs would consider valuable. That could be actual riches, or just some sort of supply or resource they desperately need. And consider 'price' to be any sort of cost: time or safety, effort or attention or retribution.",
		],
		hardness: "As a hard move, offer something that you know one of the PCs (or NPCs) on the journey really wants, but in a way that would derail or jeopardize the overall expedition. Bonus points if the opportunity is fleeting, increasing the pressure to go after it.",
		examples: [
			"Rhianna, while they're butchering the bear by the stream, Lowri calls you over and points out a huge set of hoof prints. 'Ceirwmawr, I'm sure of it. Fresh, too.' His eyes gaze off deeper into the Wood. 'It'd be a feat to sing of, that's for sure. Not to mention a whole lotta meat.' What do you do?",
			"You know, if that is a crinwin nest, and it sure looks like one, there's probably all sorts of stolen stuff up there. Like, all the things they've swiped from people this past year. Maybe even your grandmother's ring, Caradoc. What do you do?",
		],
	},
	{
		name:    "Present a discovery",
		gloss:   "Put an interesting, not-yet-dangerous thing in front of them.",
		page:    319,
		pageAlt: 353,
		detail: [
			"Discoveries are interesting things that the PCs find but that aren't inherently or immediately dangerous. They might be useful or valuable, or just something mysterious that's worth investigating.",
			"When you make this move, you just put the discovery in front of them. Describe it, tell them what they see, hear, smell, feel, what (if anything) it does. Make it clear that this is something of note. What they do next is up to them.",
		],
		examples: [
			"Blodwen, while you and Vahid wait for the others, the wind picks up and starts tossing puffs of snow about. But then you realize that, no, those puffs are a little too intentional, and you hear, no, more like sense, a laughter in the wind. There's a wind spirit flitting about. What do you do?",
			"Yeah, Vahid, now that you're closer, and looking up at it, you can see that it's definitely a nest. A papery thing, like a wasp nest, but way, way bigger. This must be what the crinwin live in. What do you do?",
		],
	},
	{
		name:    "Point to a looming danger",
		gloss:   "The clawprint, the distant howl.",
		page:    319,
		pageAlt: 353,
		detail: [
			"This is the claw-print in the mud, the wolves howling in the distance. This is the piles of sticks, strangely neat and tidy, sure sign that a hagr dwells nearby.",
			"Use this move to foreshadow future dangers, to make the PCs nervous and to prompt them to investigate or take precautions. Or flee. They could also flee.",
			"Here's a good twist on this move: instead of telling them what they find, ask them what they find that tells them ___ is afoot. You can also ask a question that gets them thinking about the danger without revealing any specific sign of it.",
		],
		examples: [
			"Rhianna, you've all been quietly trudging for a couple hours through the snow when the hair on the back of your neck stands on end. What do you see or hear that tells you that you've entered crinwin territory?",
			"Blodwen, as you sniff the air, you catch the unmistakable scent of a predator, one of the bears, you're sure of it. And not coming from the cave... it's coming from the east, towards the Stream. What do you do?",
		],
	},
	{
		name:    "Introduce a danger, person, or faction",
		gloss:   "It's here, not looming.",
		page:    320,
		pageAlt: 354,
		detail: [
			"With this move, you're putting a danger on screen. You're not pointing to it, it's not looming, it's here, what do you do?",
			"Alternately, you're introducing an NPC and giving the PCs a chance to interact with them. Or, you're revealing that there's a subset of creatures or people that they didn't know about before: different strains of crinwin, a cult within the Hillfolk, rivalries and allegiances among the Fae, etc.",
		],
		hardness: "As a hard move, you'll often introduce a danger by jumping straight into a fight or action scene. A stealthy foe or a hidden hazard might even attack and deal damage before the PCs can react!",
		examples: [
			"Okay, so you all creep towards the Stream. You hear the rush of water, and then you see it. It's huge, like a horse but stouter, pacing back and forth at an opening in the ice. Its snout darts into the water and pops up with one of those silvery, scaly slug-things that you sometimes see in the Stream, and it just gobbles it down. Ugh. What do you do?",
			"Crunch crunch squeak. Huff huff huff. Crunch squeak. Rhianna, it takes you a bit to realize it, but you're hearing footsteps in the snow, and heavy breathing, and scrapes of the sleds... from the party, of course, but also coming from up in the trees, all around you. And just as you realize that, Eira pulls back on her bow and shoots. 'Crinwin!' she yells!",
		],
	},
	{
		name:    "Bar the way",
		gloss:   "An obstacle, dead end, or missing piece.",
		page:    321,
		pageAlt: 354,
		detail: [
			"They encounter an obstacle, or hit a dead end, or discover they lack something needed to move ahead. They've got to find a way through, or over, or to backtrack and find a way around.",
			"Describe what's barring the way forward, and maybe give an option or two for what they could do instead.",
		],
		examples: [
			"It's just not going to happen, Caradoc. You can barely scale the bluff yourself, and don't see any way to drag those sleds up here laden with bear meat. And it's not like there's anything up on the Flats for you to tie a rope around, either.",
			"You drag the sleds northeast but, shortly past the Stream, the drifts get much deeper. It'd be grueling to wade through and there's no way you'd get home by dark. Looks like the only path left is back through crinwin territory. What do you do?",
		],
	},
];

/** Homefront moves, for time spent in Stonetop or another steading (GM playbook p.1; Book I p.502). */
export const HOMEFRONT_GM_MOVES = [
	{
		name:  "Introduce someone interesting",
		gloss: "A stranger, someone out of a PC's past, or a local we've not met yet.",
		page:  502,
		detail: [
			"Put someone new in front of the PCs. It could be a stranger from out of town, someone out of a PC's past, or just a local we've not yet met in play.",
			"You might just draw attention to the new person and see if the players interact with them. Or you might introduce them such that it'd be weird or rude for the PC(s) to ignore them. You can also use this move to interrupt or end the current scene.",
			"Remember to add the new character to the steading playbook, or wherever you track NPCs.",
		],
		examples: [
			"Before you even finish, there's a bit of a commotion. A small group of strangers is coming down the path from the West Road. Four of them, with a couple wheelbarrows piled with stuff. They've got the look of Delvers... and, gods above, that must be all of their worldly possessions there. Fion's already heading that way, what do you do?",
			"Half an hour later, Cerys comes down to the Stream. She's, like, in her early 30s, dark hair, bags under her eyes. Her dress is tied up and there's mud on the knees. Like she was gardening? Her eyes dart about, worried, looking for Garet you think. Rhianna, what do you do?",
		],
	},
	{
		name:  "Reveal simmering tensions",
		gloss: "Set up a future conflict. Rivalry, attraction and crossed wires all count.",
		page:  503,
		detail: [
			"Use this move to set up a future conflict, either among NPCs or between NPCs and PCs.",
			"'Tensions' don't necessarily mean that people dislike each other. Attraction, rivalry, poor communication, differences of opinion, misaligned expectations... these can all get tensions a-simmering.",
		],
		hardness: "As a hard move, either decide right now that tensions exist, and/or make it clear that the simmer is close to a boil.",
		examples: [
			"Her expression shifts to a forced smile. 'The... Ruined Tower, how... exciting.' And, like, her voice is cold. She is not happy, but she's trying not to show it. Do you think you notice?",
			"Tegwen is just glaring daggers at Seren, y'know? And Seren's just blithely ignoring it, playing it off like she doesn't notice, and you think she's taking longer than she needs to, just to rile Tegwen up. She actually winks at you when she catches you watching. What do you do?",
		],
	},
	{
		name:  "Present a want or need",
		gloss: "Someone asks for help, plainly needs it, or arrives making demands.",
		page:  503,
		detail: [
			"Someone asks for help, or clearly needs it, or makes their wishes known. Someone's in a bad place, but doesn't know how to ask for help. Someone confronts the PCs and makes demands.",
			"Use this move to give your characters life, to reflect steading debilities in the fiction, to bring it home. Use it to reveal what it'll take to Persuade an NPC. Use it to prompt hard choices. Use it to kick off adventures.",
		],
		examples: [
			"'We... we need to get after them! Now! Just let me get my spear.' But when Rheinal tries to stand, he's wobbly and his eyes are unfocused. What do you do?",
			"It's not much warmer inside. Cerys and the kids are all wrapped in blankets, and the hearth is banked low. They've all got that gaunt look, and little Hewyl's got a bad-sounding cough. What do you do?",
			"Nia runs off to play, and Lewela's like, 'Mother stopped by. Which is always fun. She was asking after you. Got me to promise that I'd suggest you stop by and check in on her. So I'm suggesting it.' She shrugs, sips her tea. What do you do?",
		],
	},
	{
		name:  "Show how others really feel",
		gloss: "Reveal an NPC's inner life in a way that provokes a response.",
		page:  504,
		detail: [
			"Reveal the inner lives of your NPCs, in a way that provokes a response or adds tension to a scene. Make it clear that someone is angry, or disappointed, or sad or scared or worried or all the above. Have someone declare their love. Have an NPC show a PC genuine affection, appreciation, or respect.",
		],
		hardness: "As a hard move, make the feelings ugly, strong, intractable. Maybe they're new, or maybe the PCs just never knew about them, but they're a problem.",
		examples: [
			"When you turn back, Andras is like, slack jawed and staring at Blodwen as she goes. Then he realizes you're looking at him and blushes. What do you do?",
			"She doesn't say anything. She's just standing in the doorway, arms folded. She glances at the bandages on your arms, the scratches on your face, and just sighs and shakes her head. Even you can tell she's unhappy. What do you do?",
			"Rheinal waits until you're done, and then he's like, 'I... heard about what you did out there, for my boy.' He pulls out this beautiful ermine fur, holds it out. 'It ain't much, but... I wanted to say thank you.' What do you do?",
			"Lowri's eyes don't waver. 'You're a clever guy, Vahid, and sometimes useful. But you are trouble. And you are not one of us. I ain't dying for you. And if you try anything with Eira, I will slit your throat in your sleep. Got it?'",
		],
	},
	{
		name:  "Draw out their feelings",
		gloss: "An NPC invites a PC to open up, or simply shows them kindness.",
		page:  504,
		detail: [
			"Have an NPC invite or prompt a PC to open up, to talk, to process what they're going through. Or have an NPC show them kindness or concern, and ask what they do. Invite the player to portray a compelling character, and give your characters life by showing that they really do care about the PCs.",
		],
		hardness: "The hard version of this move looks like a confrontation or intervention. An NPC sits them down and draws out their feelings like poison from a wound. Or at least they try to, and we see how the PC reacts.",
		examples: [
			"Eira raises her drinking horn, and slurs, 'Ta Garet, ya poor basstard. We'll missya.' Minutes pass. Then she lolls her head towards you. 'Hey. Rhhhanna. Hey. You know, you know iss not your fault, right? Right? Iss not your fault.' She's staring right at you, waiting. What do you do?",
			"Gwendyl takes one look at your face and drops what she's doing and just wraps you in this great big hug. 'Shh, it's all right. There, there.' What do you do?",
			"A 6? Hmm, okay! Macsen like, stares for a few seconds, and finally he's like, 'I suspect she'll be home soon.' And he steps aside, inviting you in. You go? Cool. Once you're inside, he turns, folds his arms, and gives you that stare again. 'So, Caradoc. What exactly are your intentions towards my daughter?'",
		],
	},
	{
		name:  "Change a relationship",
		gloss: "A friendship lost, a peer turned rival, a couple calling it quits.",
		page:  505,
		detail: [
			"A loved one grows distant. A friendship is lost. A peer becomes a rival. A couple calls it quits. Etc.",
			"The relationships involved can be PC-to-NPC or between NPCs. The change can be big and dramatic, or subtle, or anywhere in between.",
			"If the change means that an NPC will now be a source of ongoing trouble, write them up as a threat.",
		],
		examples: [
			"Actually, Blodwen... over the next few weeks, you notice Tegwen and Elios talking a lot. Well, Tegwen's talking, mostly, but Elios does a lot of nodding. Which is odd, cuz those two never agree on anything.",
			"'I... I can't do this anymore. Can't keep waiting. Waiting for you to come home. Waiting for you to leave. Hoping for you to, gods, for you to get yourself maimed so you can't do this anymore. Because you will keep doing this, as long as you can. We both know it. I can't ask you not to. But... I just can't. I'm sorry, that can't be my life.' And she shoves the bracelet into your hands and runs away, crying.",
		],
	},
	{
		name:  "Oppose their wishes",
		gloss: "NPCs object, get in the way, or have to be talked round.",
		page:  505,
		detail: [
			"Have NPCs object to the PCs' plans, or get in the way, or need to be convinced. Or have them do things on their own, something the PCs don't want them to do, and see how the PCs respond.",
		],
		hardness: "As a hard move, have someone with actual clout put their foot down and be unwilling to change their mind. The PCs can either accept the decision, or try to go around them.",
		examples: [
			"'What in Tor's name do you think you're doing?' It's Glenys, stomping towards you, one of the sanctified stones in her hand. 'I won't have your sorcery just out where anyone can stumble on it!'",
			"'No. I forbid it! You're no hunter, you're just a silly girl who thinks she's special. And who would take care of your goats? Not me! Come on.' And she grabs at your wrist, presumably to drag you home. What do you do?",
			"Fion clears her throat, and everyone turns. 'No matter what else, they walked four days to get here. They don't lack for courage. They asked for hospitality, and a chance to earn their keep. I will not just send them packing cuz you got a bad feeling about them, Rhianna. Let 'em fix up Teagan's old place, I say.' And most of the others are nodding, like it's decided. So, what do you do?",
		],
	},
	{
		name:  "Remind them of their obligations",
		gloss: "Name what is expected of them, and what happens if they duck it.",
		page:  506,
		detail: [
			"Point out something that needs doing or that is expected of them. Have an NPC make explicit demands on their time. Warn them of what might happen if they ignore their responsibilities. Show them the consequences if they do.",
			"Use this move to make sure the PCs earn their keep and remain active in the community. Use it to limit their options and to let things breathe, ensuring that time passes between adventures. Use it to embrace the mundane and portray the richness of the world, by highlighting the concerns of daily life.",
		],
		examples: [
			"Sawyl's got a pile of backed-up work, and he looks tired as hell. 'Oh, good, you're up. Gimme a hand with these, will you?' He hasn't noticed your gear or your traveling clothes. What do you do?",
			"I mean, you can, but harvest is coming and there is so much work to do in the fields. If you spend the next few weeks studying that plaque, you'll be missed. And folks are already grumbling about you. What do you do?",
		],
	},
	{
		name:  "Start a conflict or crisis",
		gloss: "Bring the simmer to a boil, or let the granary collapse.",
		page:  506,
		detail: [
			"Bring simmering tensions to a boil. Have two NPCs start screaming at each other or come to blows. Have someone call out a PC, loudly and in public. Have panic spread.",
			"Or: have a house catch on fire, a monster attack the village, a dead body turn up, the granary collapse, etc.",
		],
		hardness: "As a soft move, show the PCs the start of the conflict or crisis and give them a chance to do something about it. As a hard move, don't let the PCs learn about it or otherwise be able to act until things have gotten bad.",
		examples: [
			"There's a commotion over in the corner. 'Oh you son of a...' and, Rhianna, your crew is like holding Glaw back from Iwan, and Iwan's got his new buddies around him, and he's just sneering back like he wants Glaw to come at him, what do you do?",
			"Vahid, they're just not listening. Too many people have seen Padrig's body, and it's pretty grisly, and there's like a dozen conversations happening at once. Kids are crying and people are panicking and you just can't make yourself heard. I think we just Met with Disaster, folks.",
		],
	},
	{
		name:  "Play them against each other",
		gloss: "A triangle between two PCs and an NPC.",
		page:  507,
		detail: [
			"Set up a triangle between two PCs and an NPC. Have the smith ask the Judge to do something about the Fox. Have the Seeker's wife tell the Blessed what the Seeker is up to. Have the midwife gossip about the Heavy with the Fox.",
			"Or, point out one PC's questionable actions to another PC, and ask what they think or do about it. Give them a chance to interfere (or Interfere) with each other.",
		],
		hardness: "As a hard move, maybe have an NPC make an ultimatum about a PC. Or pick that moment for an NPC to betray one PC's trust to the others.",
		examples: [
			"Blodwen... I know you fancy him. No, stop, I don't mind. I mean, of course I mind a little, but I made my choice. Just, some advice. Tell Caradoc how you feel. That boy is many things, but observant is not one of them.",
			"Elios fixes you with those sad eyes. 'I sure don't want your job, Rhianna. But if you don't do something about Vahid, and Caradoc, and get those boys in line, then folks are going to stop listening to you. Including me.' What do you do?",
		],
	},
];

/**
 * The Moves tab, section by section, in the order the playbook prints them.
 *
 * Each section is its own box in the template. That is not tidiness: the fold walk claims a
 * heading's FOLLOWING SIBLINGS until it meets the next heading (utils/section-editing.js
 * `_sectionFoldTargets`), so three headings in one flat run would let the first caret swallow
 * the two below it.
 *
 * `collapseId` is what the fold state is remembered under, per user and per sheet.
 *
 * A module-level constant rather than a per-call literal: nothing in it varies (every field is
 * either a constant above or an i18n KEY, localization happens at the sheet boundary), so
 * rebuilding it per render and twice per randomizer click bought nothing. Frozen so a caller
 * that treats a shared table as scratch space fails loudly rather than corrupting every later
 * read.
 *
 * @type {ReadonlyArray<{key: string, titleKey: string, noteKey: string, collapseId: string, moves: GmMove[]}>}
 */
export const GM_MOVE_SECTIONS = Object.freeze([
	{
		key:        "basic",
		titleKey:   "stonetop.gmToolkit.moves.basic",
		noteKey:    "stonetop.gmToolkit.moves.basicNote",
		collapseId: "gmMovesBasic",
		moves:      BASIC_GM_MOVES,
	},
	{
		key:        "exploration",
		titleKey:   "stonetop.gmToolkit.moves.exploration",
		noteKey:    "stonetop.gmToolkit.moves.explorationNote",
		collapseId: "gmMovesExploration",
		moves:      EXPLORATION_GM_MOVES,
	},
	{
		key:        "homefront",
		titleKey:   "stonetop.gmToolkit.moves.homefront",
		noteKey:    "stonetop.gmToolkit.moves.homefrontNote",
		collapseId: "gmMovesHomefront",
		moves:      HOMEFRONT_GM_MOVES,
	},
]);

/** @returns {ReadonlyArray} The sections, in the order the playbook prints them. */
export function gmMoveSections() {
	return GM_MOVE_SECTIONS;
}

/**
 * One section by key, or undefined for an unknown one.
 * @param {string} key  "basic" | "exploration" | "homefront"
 */
export function gmMoveSection(key) {
	return GM_MOVE_SECTIONS.find(s => s.key === key);
}
