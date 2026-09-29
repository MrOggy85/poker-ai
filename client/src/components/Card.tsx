import type { Card as CardCode } from '../../../shared/cards.ts';
import { RANKS, SUIT_SYMBOLS } from '../../../shared/cards.ts';
import ui from '../ui.module.css';

/** A single card face. Suits render as pips so the table reads at a glance. */
export function Card({ code, small }: { code: CardCode; small?: boolean }) {
  const rank = RANKS[code >> 2];
  const suit = code & 3;
  const red = suit === 1 || suit === 2; // diamonds and hearts
  const className = [ui.card, small ? ui.cardSmall : '', red ? ui.cardRed : ''].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <span>{rank}</span>
      <span className={ui.pip}>{SUIT_SYMBOLS[suit]}</span>
    </div>
  );
}
