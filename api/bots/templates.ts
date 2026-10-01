import type { Mood } from '../../shared/events.ts';
import type { Rng } from '../../shared/rng.ts';
import type { OptionKey } from './options.ts';
import type { Personality } from './personalities.ts';

/**
 * Pre-written inner monologues.
 *
 * These are not a stub. The game has to be fully playable and entertaining with the monologue
 * model disabled or unreachable, and on a machine this size that is a normal operating mode,
 * not an emergency - so these lines carry the personalities on their own. The LLM replaces
 * them opportunistically, behind the same interface.
 */

type Bucket = 'fold' | 'passive' | 'aggressive' | 'allin';

function bucketOf(key: OptionKey): Bucket {
  switch (key) {
    case 'F':
      return 'fold';
    case 'X':
    case 'C':
      return 'passive';
    case 'A':
      return 'allin';
    default:
      return 'aggressive';
  }
}

const LINES: Record<string, Record<Bucket, string[]>> = {
  rock: {
    fold: ['Not this one.', 'No.', 'I can wait. I am good at waiting.'],
    passive: ['Fine. I will look.', 'Cheap enough.', 'One card. That is all I am paying for.'],
    aggressive: ['Now I am interested.', 'I have been folding for an hour. Pay attention.', 'This one is worth chips.'],
    allin: ['I do not do this often. Think about that.', 'All of it. I am not bluffing and you know it.'],
  },
  maniac: {
    fold: ['Fine, keep it. I have plenty.', 'Boring hand. Next.', 'Ugh.'],
    passive: ['Sure, I will tag along.', 'Why not.', 'Let us see something.'],
    aggressive: ['Raise. Obviously raise.', 'More chips. Always more chips.', 'Let us make this expensive.'],
    allin: ['EVERYTHING.', 'All in. I want to hear someone gasp.', 'Let us find out right now.'],
  },
  station: {
    fold: ['Oh. That is too much for me.', 'I suppose not.', 'Shame, I liked that hand.'],
    passive: ['I will call. I always call.', 'Sure, I will pay to see it.', 'Curiosity, mostly.'],
    aggressive: ['I think I will put some in.', 'That feels like a raise.', 'Might as well.'],
    allin: ['Well. In for a penny.', 'All of it? All right then.'],
  },
  shark: {
    fold: ['No value here.', 'Wrong price.', 'Not worth the chips.'],
    passive: ['I will take the cheap card.', 'Calling is correct.', 'Fine. Your move again.'],
    aggressive: ['You are weak and I can tell.', 'Pressure. That is all this is.', 'Raise. You will fold.'],
    allin: ['I am ahead. Pay me.', 'Everything. You cannot call.'],
  },
  rookie: {
    fold: ['Sorry, sorry, folding.', 'That is too rich for me.', 'I did not like that bet at all.'],
    passive: ['I think that is a call? That is a call.', 'Just checking. Please do not bet.', 'Okay. Okay. Calling.'],
    aggressive: ['I am raising. Oh no, I am raising.', 'Is this a mistake? Probably.', 'Please fold. Please fold.'],
    allin: ['All in. I cannot believe I did that.', 'Everything. My hands are shaking.'],
  },
  showman: {
    fold: ['The Showman withdraws. Gracefully.', 'A lesser hand than the moment deserved.', 'Not my scene.'],
    passive: ['The Showman stays for the second act.', 'A modest call. For now.', 'Patience is also theatre.'],
    aggressive: ['And now, a raise nobody saw coming.', 'The Showman applies pressure.', 'Watch this.'],
    allin: ['All in. Remember this hand.', 'The Showman risks everything. Naturally.'],
  },
};

const MOOD_PREFIX: Partial<Record<Mood, string>> = {
  tilted: 'Still furious. ',
  desperate: 'It is now or never. ',
  euphoric: 'Untouchable right now. ',
  bored: 'Finally, something. ',
  nervous: 'Hands shaking. ',
  suspicious: 'Something is off here. ',
};

export function templateThought(personality: Personality, mood: Mood, key: OptionKey, rng: Rng): string {
  const lines = LINES[personality.id] ?? LINES.shark;
  const line = rng.pick(lines[bucketOf(key)]);
  // The prefix only fires sometimes, or it stops reading as a thought and starts reading as a
  // status field.
  const prefix = rng.chance(0.3) ? MOOD_PREFIX[mood] ?? '' : '';
  return `${prefix}${line}`;
}

const REACTIONS: Record<string, string[]> = {
  rock: ['Someone is about to learn something.', 'That is a lot of chips for a guess.', 'I would not have.'],
  maniac: ['Oh, now it gets good.', 'Somebody is having my kind of hand.', 'Go on then. Do it.'],
  station: ['Ooh. I would have called that.', 'I want to see how this ends.', 'That is brave.'],
  shark: ['One of them is making a mistake.', 'That bet says more than they think.', 'Interesting.'],
  rookie: ['I am very glad that is not me.', 'That is so much money.', 'How do they do that?'],
  showman: ['The Showman approves of this drama.', 'Finally, someone else performing.', 'A bold scene.'],
};

/** The fallback for a folded player's remark, when the model is slow, off or repeating itself. */
export function templateReaction(personality: Personality, rng: Rng): string {
  return rng.pick(REACTIONS[personality.id] ?? REACTIONS.shark);
}
