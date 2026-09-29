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
  parts.push(`You are ${self.personality.playStyle}, and you ${self.personality.bluffTendency}.`);
  parts.push(`Your mood is ${self.mood}.`);

  const hole = self.hole.map(cardToString).join(' and ');
  parts.push(`${streetWords(table.street)} You hold ${hole}.`);
  const board = boardWords(table.board);
  if (board) parts.push(board);

  parts.push(`Your hand is ${equityWords(view.equity.share)}.`);
  parts.push(`${fieldWords(table.live)}, and ${positionWords(view)}.`);
  parts.push(`${potOddsWords(table.toCall, table.pot)}, and ${stackWords(self.stack, table.bigBlind)}.`);

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
export function buildMonologuePrompt(view: BotView, actionText: string, reason: string): string {
  const { self } = view;
  return [
    `${self.name} is ${self.personality.playStyle}. ${self.personality.description}`,
    `Their voice is ${self.personality.voice}. Right now they feel ${self.mood}.`,
    `They just ${actionText}, because ${reason}.`,
    'Write their single inner thought, in first person, in at most 20 words.',
    'Do not mention odds, percentages or probabilities.',
  ].join(' ');
}
