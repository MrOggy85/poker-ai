import { MOOD_EMOJI, type SeatView } from '../../../shared/events.ts';
import { ordinal } from '../store.ts';
import ui from '../ui.module.css';
import { Card } from './Card.tsx';

/**
 * Seats sit on an ellipse around the felt. The angle comes from the seat index so the layout
 * works for any table size without a hand-written position table.
 */
function position(seat: number, total: number): { left: string; top: string } {
  // Start at the bottom of the table and go clockwise, so seat 0 faces the viewer.
  const angle = Math.PI / 2 + (seat / total) * Math.PI * 2;
  return {
    left: `${50 + Math.cos(angle) * 44}%`,
    top: `${50 + Math.sin(angle) * 40}%`,
  };
}

export function Seat({ seat, total, isWinner, shownHand }: {
  seat: SeatView;
  total: number;
  isWinner: boolean;
  shownHand: string | undefined;
}) {
  const classes = [ui.seat];
  if (seat.status === 'folded') classes.push(ui.seatFolded);
  if (seat.status === 'out') classes.push(ui.seatOut);

  const plate = [ui.plate];
  if (seat.thinking) plate.push(ui.plateActive);
  if (isWinner) plate.push(ui.plateWinner);

  return (
    <div className={classes.join(' ')} style={position(seat.seat, total)}>
      {seat.thought && <div className={ui.thought}>{seat.thought}</div>}
      {seat.thinking && !seat.thought && <div className={ui.thinking}>thinking</div>}

      <div className={ui.holeCards}>
        {seat.hole?.map((code, index) => <Card key={index} code={code} small />)}
      </div>

      <div className={plate.join(' ')}>
        <span className={ui.avatar}>{seat.avatar}</span>
        <span className={ui.who}>
          <span className={ui.name}>{seat.name}</span>
          <span className={ui.stack}>
            {seat.place !== null ? ordinal(seat.place) : seat.stack.toLocaleString('en-US')}
          </span>
        </span>
      </div>

      {seat.equity !== null && seat.status !== 'folded' && seat.status !== 'out' && (
        <div className={ui.equityBar}>
          <div className={ui.equityFill} style={{ width: `${Math.round(seat.equity * 100)}%` }} />
        </div>
      )}

      <div className={ui.badges}>
        <span className={ui.mood}>{MOOD_EMOJI[seat.mood]} {seat.mood}</span>
        {seat.isButton && <span className={ui.buttonTag}>D</span>}
        {seat.isSmallBlind && <span className={ui.blindTag}>SB</span>}
        {seat.isBigBlind && <span className={ui.blindTag}>BB</span>}
        {seat.streetBet > 0 && <span className={ui.bet}>{seat.streetBet.toLocaleString('en-US')}</span>}
        {shownHand && <span className={ui.blindTag}>{shownHand}</span>}
      </div>
    </div>
  );
}
