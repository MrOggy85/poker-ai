import type { PublicAction } from '../engine/types.ts';
import type { OpponentNote } from './view.ts';

/**
 * What a bot remembers about the others.
 *
 * The models have no memory, so this is code-computed from **public information only**: the
 * actions everyone saw and the hands that reached a showdown. Its input type is deliberately
 * `PublicAction[]` and nothing else - there is no parameter through which another player's
 * hole cards, mood or inner monologue could arrive.
 *
 * Only the most relevant couple of notes are ever sent: a paragraph of statistics would bury
 * the hand itself, and the classifier reads the whole state as one block of prose.
 */

interface Record {
  hands: number;
  voluntary: number;
  raises: number;
  folds: number;
  caughtBluffing: number;
  showdowns: number;
}

export class OpponentNotes {
  #records = new Map<string, Record>();

  #get(id: string): Record {
    let record = this.#records.get(id);
    if (!record) {
      record = { hands: 0, voluntary: 0, raises: 0, folds: 0, caughtBluffing: 0, showdowns: 0 };
      this.#records.set(id, record);
    }
    return record;
  }

  /** Called once per finished hand with everything that was publicly visible. */
  observeHand(actions: readonly PublicAction[], seated: readonly string[]): void {
    for (const id of seated) this.#get(id).hands++;

    const acted = new Set<string>();
    for (const action of actions) {
      const record = this.#get(action.id);
      if (action.kind === 'raise' || action.kind === 'bet') record.raises++;
      if (action.kind === 'fold') record.folds++;
      // "Voluntarily put money in" - posting a blind does not count, and a blind never shows
      // up as an action in the history.
      if (action.kind !== 'fold' && action.kind !== 'check' && !acted.has(action.id)) {
        record.voluntary++;
        acted.add(action.id);
      }
    }
  }

  /** A showdown where an aggressive player turned over a weak hand is worth remembering. */
  observeShowdown(id: string, wasBluffing: boolean): void {
    const record = this.#get(id);
    record.showdowns++;
    if (wasBluffing) record.caughtBluffing++;
  }

  /**
   * The one or two things worth telling the model about the opponents still in the hand.
   * Nothing is said at all until there is enough history for it to mean anything.
   */
  notesFor(opponents: { seat: number; name: string; id: string }[], limit = 2): OpponentNote[] {
    const notes: OpponentNote[] = [];

    for (const opponent of opponents) {
      const record = this.#records.get(opponent.id);
      if (!record || record.hands < 6) continue;

      if (record.caughtBluffing > 0) {
        notes.push({ seat: opponent.seat, name: opponent.name, text: `${opponent.name} was caught bluffing` });
        continue;
      }

      const looseness = record.voluntary / record.hands;
      const aggression = record.raises / Math.max(1, record.voluntary);

      if (aggression > 0.7) notes.push({ seat: opponent.seat, name: opponent.name, text: `${opponent.name} raises a lot` });
      else if (looseness < 0.25) notes.push({ seat: opponent.seat, name: opponent.name, text: `${opponent.name} plays very tight` });
      else if (looseness > 0.7) notes.push({ seat: opponent.seat, name: opponent.name, text: `${opponent.name} plays almost every hand` });
    }

    return notes.slice(0, limit);
  }
}
