import { cardToString } from '../../shared/cards.ts';
import { boardWords, equityWords, fieldWords, positionWords, potOddsWords, stackWords, streetWords } from './words.ts';
import type { BotView } from './view.ts';

/**
 * The state paragraph the decision model reads.
 *
 * Short and consistent, in that order. It is a classifier reading one block of prose, so the
 * same situation must produce the same phrasing every time - the Jeff README reports that
 * inconsistent wording changes game results measurably, and this is where that consistency is
 * either kept or lost.
 *
 * The bot's own two cards are the only numbers here. Everything else - pot, stack, bet, win
 * chance - is a phrase from words.ts.
 */
export function buildState(view: BotView): string {
  const { self, table } = view;
  const parts: string[] = [];

  parts.push(`You are ${self.name}. ${self.personality.description}`);
  // Two separate sentences: gluing playStyle and bluffTendency together with "and you"
  // produced "you are balanced and you bluffs when...", which is the sort of thing that
  // quietly degrades a classifier reading prose.
  parts.push(`Your style: ${self.personality.playStyle}. You ${self.personality.bluffTendency}.`);
  parts.push(`Your mood is ${self.mood}.`);

  const hole = self.hole.map(cardToString).join(' and ');
  parts.push(`${streetWords(table.street)} You hold ${hole}.`);
  const board = boardWords(table.board);
  if (board) parts.push(board);

  parts.push(`Your hand is ${equityWords(view.equity.share, table.live)}.`);
  parts.push(`${fieldWords(table.live)}, and ${positionWords(view)}.`);
  parts.push(`${potOddsWords(table.toCall, table.pot)}, and ${stackWords(self.stack, table.bigBlind)}.`);
  // Without this the model has no reason to prefer surviving: every hand looks like a
  // one-off bet rather than one hand of a tournament you can be knocked out of.
  parts.push('This is a tournament. If you lose all your chips you are out for good.');

  const last = lastAction(view);
  if (last) parts.push(last);

  for (const note of view.notes) parts.push(`${note.text}.`);

  return parts.join(' ');
}

/** The one or two public actions that actually bear on this decision. */
function lastAction(view: BotView): string | null {
  const meaningful = view.table.recent.filter((action) => action.kind !== 'check');
  const last = meaningful[meaningful.length - 1];
  if (!last) return null;

  const who = view.table.opponents.find((opponent) => opponent.seat === last.seat)?.name;
  if (!who) return null;

  switch (last.kind) {
    case 'fold':
      return `${who} folded.`;
    case 'call':
      return `${who} called.`;
    case 'bet':
      return last.allIn ? `${who} moved all in.` : `${who} bet into the pot.`;
    case 'raise':
      return last.allIn ? `${who} moved all in.` : `${who} raised.`;
    default:
      return null;
  }
}

export function buildInstructions(view: BotView): string {
  return `What does ${view.self.name} do now?`;
}

/**
 * The monologue prompt. It gets the action already chosen, so a thought can never contradict
 * what the bot then does, and it is told in words why - never a probability.
 */
/**
 * The monologue prompt, shaped as a few-shot completion.
 *
 * A 0.5B model given instructions simply restates them: asked in prose for The Maniac's inner
 * thought, it returned "The Maniac is wildly loose and aggressive, always on edge, and I love
 * chaos" - the prompt, back again. A worked pattern with two examples and an open quote gives
 * it something to continue rather than something to obey, which is the only thing that
 * reliably works at this size.
 */
/**
 * Lines used only to show the model the shape of the answer.
 *
 * They deliberately belong to nobody in the cast. The first version used The Rock and The
 * Maniac as examples, and the model handed The Rock's own example line straight back as its
 * answer - at 0.5B, copying the nearest example is a perfectly good way to continue a
 * pattern. Exported so the caller can reject an answer that is merely one of these.
 */
export const MONOLOGUE_EXAMPLES = [
  'Let them have that one.',
  'Someone here is about to make a mistake.',
];

/**
 * The monologue prompt, shaped as a few-shot completion.
 *
 * A 0.5B model given instructions simply restates them: asked in prose for The Maniac's inner
 * thought, it returned "The Maniac is wildly loose and aggressive, always on edge, and I love
 * chaos" - the prompt, back again. A worked pattern ending in an open quote gives it something
 * to continue rather than something to obey, which is the only thing that reliably works at
 * this size.
 */
export function buildMonologuePrompt(view: BotView, actionText: string, reason: string): string {
  const { self } = view;
  return [
    'Short inner thoughts from poker players. First person, in character, one line each.',
    '',
    'Player: a cautious veteran, dry and unimpressed, feeling calm. Just folded a weak hand.',
    `Thought: "${MONOLOGUE_EXAMPLES[0]}"`,
    '',
    'Player: a restless gambler, loud and reckless, feeling confident. Just raised a strong hand.',
    `Thought: "${MONOLOGUE_EXAMPLES[1]}"`,
    '',
    `Player: ${self.name}, ${self.personality.voice}, feeling ${self.mood}. ` +
    `Just ${actionText} with a hand that is ${reason}.`,
    'Thought: "',
  ].join('\n');
}
