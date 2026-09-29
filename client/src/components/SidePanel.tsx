import { useEffect, useRef } from 'react';
import { ordinal, standings, type View } from '../store.ts';
import ui from '../ui.module.css';

export function SidePanel({ view }: { view: View }) {
  const logBox = useRef<HTMLDivElement>(null);

  // Pin to the newest line, the way a chat log behaves.
  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [view.log.length]);

  return (
    <aside className={ui.panel}>
      <section>
        <h2 className={ui.panelTitle}>Tournament</h2>
        <div className={ui.meta}>
          <span>hand {view.handNo} · level {view.level + 1}</span>
          <span>blinds {view.smallBlind}/{view.bigBlind}</span>
          <span>seed {view.seed}</span>
          {view.finished && <span className={ui.logHand}>finished</span>}
          {!view.connected && <span className={ui.disconnected}>disconnected — reconnecting</span>}
        </div>
      </section>

      <section>
        <h2 className={ui.panelTitle}>Standings</h2>
        {standings(view).map((seat) => (
          <div
            key={seat.id}
            className={[ui.standing, seat.place !== null ? ui.standingOut : ''].filter(Boolean).join(' ')}
          >
            <span>{seat.avatar}</span>
            <span>{seat.name}</span>
            <span>{seat.place !== null ? ordinal(seat.place) : seat.stack.toLocaleString('en-US')}</span>
          </div>
        ))}
      </section>

      <section style={{ display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: 0 }}>
        <h2 className={ui.panelTitle}>Action</h2>
        <div className={ui.logBox} ref={logBox}>
          {view.log.map((line, index) => (
            <div key={index} className={line.text.startsWith('---') ? ui.logHand : undefined}>
              {line.text}
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
