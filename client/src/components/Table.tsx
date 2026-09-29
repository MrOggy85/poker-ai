import type { View } from '../store.ts';
import ui from '../ui.module.css';
import { Card } from './Card.tsx';
import { Seat } from './Seat.tsx';

export function Table({ view }: { view: View }) {
  return (
    <div className={ui.tableWrap}>
      <div className={ui.felt}>
        <div className={ui.centre}>
          <div className={ui.board}>
            {view.board.map((code, index) => <Card key={`${code}-${index}`} code={code} />)}
          </div>
          <div className={ui.pot}>pot {view.potTotal.toLocaleString('en-US')}</div>
          {view.pots.length > 1 && (
            <div className={ui.sidePot}>
              {view.pots.map((pot, index) => (
                <span key={index}>
                  {index === 0 ? 'main' : `side ${index}`} {pot.amount.toLocaleString('en-US')}
                  {index < view.pots.length - 1 ? ' · ' : ''}
                </span>
              ))}
            </div>
          )}
        </div>

        {view.seats.map((seat) => (
          <Seat
            key={seat.seat}
            seat={seat}
            total={view.seats.length}
            isWinner={view.winners.includes(seat.seat)}
            shownHand={view.shown[seat.seat]}
          />
        ))}
      </div>
    </div>
  );
}
