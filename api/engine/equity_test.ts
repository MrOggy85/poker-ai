import { assert } from 'jsr:@std/assert@1';
import { cardFromString, type Card } from '../../shared/cards.ts';
import { makeRng } from '../../shared/rng.ts';
import { estimateEquity, potOdds } from './equity.ts';

const hole = (text: string): [Card, Card] => {
  const [a, b] = text.split(' ').map(cardFromString);
  return [a, b];
};
const board = (text: string): Card[] => (text ? text.split(' ').map(cardFromString) : []);

Deno.test('aces against one random hand win about 85%', () => {
  const { share } = estimateEquity(hole('Ac Ad'), [], 1, 4000, makeRng('test', 'equity:aa'));
  assert(share > 0.81 && share < 0.89, `got ${share}`);
});

Deno.test('seven-deuce is the worst hand against one random opponent', () => {
  const { share } = estimateEquity(hole('7c 2d'), [], 1, 4000, makeRng('test', 'equity:72'));
  assert(share > 0.28 && share < 0.40, `got ${share}`);
});

Deno.test('more opponents means less equity', () => {
  const heads = estimateEquity(hole('Kc Kd'), [], 1, 3000, makeRng('test', 'equity:kk1')).share;
  const five = estimateEquity(hole('Kc Kd'), [], 5, 3000, makeRng('test', 'equity:kk5')).share;
  assert(heads > five + 0.2, `${heads} vs ${five}`);
});

Deno.test('a made flush on the river is almost always good', () => {
  const { share } = estimateEquity(hole('Ac Tc'), board('2c 7c Kc 3d 9h'), 2, 3000, makeRng('test', 'equity:flush'));
  assert(share > 0.9, `got ${share}`);
});

Deno.test('the same stream label reproduces the same estimate', () => {
  const a = estimateEquity(hole('Jh Ts'), board('2c 7d Kc'), 3, 500, makeRng('seed', 'equity:p1:h4:flop'));
  const b = estimateEquity(hole('Jh Ts'), board('2c 7d Kc'), 3, 500, makeRng('seed', 'equity:p1:h4:flop'));
  assert(a.share === b.share);
});

Deno.test('pot odds are the share of the pot a call costs', () => {
  assert(Math.abs(potOdds(50, 150) - 0.25) < 1e-9);
  assert(potOdds(0, 100) === 0);
});
