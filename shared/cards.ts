/**
 * Cards are plain integers 0-51 so the equity Monte Carlo can shuffle and compare them
 * without allocating. `card >> 2` is the rank index (0 = deuce .. 12 = ace) and `card & 3`
 * is the suit index. Strings like 'As' or 'Td' are the wire format only - nothing in the
 * engine's hot path parses them.
 */
export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

/** Unicode pips, for the client. Index matches SUITS. */
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];

export const DECK_SIZE = 52;

export function rankIndex(card: Card): number {
  return card >> 2;
}

export function suitIndex(card: Card): number {
  return card & 3;
}

export function cardToString(card: Card): string {
  return RANKS[rankIndex(card)] + SUITS[suitIndex(card)];
}

export function cardFromString(text: string): Card {
  const rank = RANKS.indexOf(text[0].toUpperCase());
  const suit = SUITS.indexOf(text[1].toLowerCase());
  if (rank < 0 || suit < 0) throw new Error(`not a card: ${text}`);
  return (rank << 2) | suit;
}

export function cardsToStrings(cards: readonly Card[]): string[] {
  return cards.map(cardToString);
}
