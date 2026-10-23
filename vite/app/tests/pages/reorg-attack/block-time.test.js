// -----------------------------------------------------------
//  [*] Tests — 51% attack: block times (lib/blockTime.js)
//
//  The two pure helpers that put the backend's timestamps on
//  the student's clock, called directly:
//    - localBlockTime: a header timestamp as the date and time
//      in the browser's timezone — Vilnius, where the suite
//      runs — with the zone's name and its offset from UTC;
//      the same instant in zones east and west, off by whole
//      hours and by parts of one; summer time moving the
//      offset, and the hour repeated when it ends told apart
//      by it; the hour after midnight as 00; anything but a
//      number of seconds that makes a date read as unknown
//    - startOfLocalDay: the timestamp of the student's
//      midnight — the evening before in UTC, the next day's
//      once UTC's evening is late enough, turning at the very
//      second, on the days summer time shortens and
//      lengthens, and for the clock's own now
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import * as f from '../../support/backend/fixtures';
import { localBlockTime, startOfLocalDay } from '@/pages/ReorgAttack/lib/blockTime';


const { B } = f;

// An instant written out in UTC, in the backend's whole
// seconds
const seconds = (iso) => Date.parse(iso) / 1000;







// -----------------------------------------------------------
// localBlockTime
// -----------------------------------------------------------
//
// The private tip, p6403, was mined at 02:19:02 UTC on 19
// October 2026.
// -----------------------------------------------------------

describe('localBlockTime — a header timestamp on the student\'s clock', () => {

  it('reads the time in the browser\'s timezone — Vilnius in this suite — naming the zone and its offset', () => {
    expect(localBlockTime(B.p6403.timestamp)).toEqual({ local: '2026-10-19 05:19:02', zone: 'Europe/Vilnius', offset: 'UTC+3' });
  });


  // Only the date, time and offset are compared: which name
  // the browser gives back for a zone renamed over the years
  // (Kolkata, Kathmandu) depends on its version
  it.each([
    ['UTC', '2026-10-19 02:19:02', 'UTC+0'],
    ['America/New_York', '2026-10-18 22:19:02', 'UTC-4'],
    ['America/St_Johns', '2026-10-18 23:49:02', 'UTC-2:30'],
    ['Asia/Kolkata', '2026-10-19 07:49:02', 'UTC+5:30'],
    ['Asia/Kathmandu', '2026-10-19 08:04:02', 'UTC+5:45'],
    ['Pacific/Kiritimati', '2026-10-19 16:19:02', 'UTC+14'],
  ])('shows the same instant on the clocks of %s', (zone, local, offset) => {
    expect(localBlockTime(B.p6403.timestamp, zone)).toMatchObject({ local, offset });
  });


  it('moves the offset with summer time', () => {
    expect(localBlockTime(seconds('2026-01-15T12:00:00Z'))).toEqual({ local: '2026-01-15 14:00:00', zone: 'Europe/Vilnius', offset: 'UTC+2' });
    expect(localBlockTime(seconds('2026-07-15T12:00:00Z'))).toEqual({ local: '2026-07-15 15:00:00', zone: 'Europe/Vilnius', offset: 'UTC+3' });
  });


  // At 01:00 UTC on 25 October 2026 Vilnius turns its clocks
  // back from 04:00 to 03:00, so 03:30 comes twice
  it('tells the two runs of the hour repeated when summer time ends apart by their offsets', () => {
    expect(localBlockTime(seconds('2026-10-25T00:30:00Z'))).toMatchObject({ local: '2026-10-25 03:30:00', offset: 'UTC+3' });
    expect(localBlockTime(seconds('2026-10-25T01:30:00Z'))).toMatchObject({ local: '2026-10-25 03:30:00', offset: 'UTC+2' });
  });


  it('writes the hour after midnight as 00', () => {
    expect(localBlockTime(seconds('2026-10-18T21:00:00Z')).local).toBe('2026-10-19 00:00:00');
  });


  it.each([
    ['nothing', undefined],
    ['a null', null],
    ['the time as text', '1792376342'],
    ['not a number', NaN],
    ['an infinity', Infinity],
    ['a number no date can hold', 1e20],
    ['a list', [1792376342]],
    ['a truth value', true],
  ])('reads %s as an unknown time', (_, timestamp) => {
    expect(localBlockTime(timestamp)).toBeNull();
  });
});







// -----------------------------------------------------------
// startOfLocalDay
// -----------------------------------------------------------
//
// Vilnius is three hours ahead of UTC in summer time, two in
// winter: its midnight is 21:00 or 22:00 UTC the evening
// before.
// -----------------------------------------------------------

describe('startOfLocalDay — the student\'s midnight', () => {

  it('is 21:00 UTC the evening before, while Vilnius keeps summer time', () => {
    expect(startOfLocalDay(new Date('2026-10-19T02:19:02Z'))).toBe(seconds('2026-10-18T21:00:00Z'));
  });


  it('is the next day\'s once the UTC evening is late enough', () => {
    expect(startOfLocalDay(new Date('2026-10-19T22:30:00Z'))).toBe(seconds('2026-10-19T21:00:00Z'));
  });


  it('turns at the very second of midnight', () => {
    expect(startOfLocalDay(new Date('2026-10-19T20:59:59Z'))).toBe(seconds('2026-10-18T21:00:00Z'));
    expect(startOfLocalDay(new Date('2026-10-19T21:00:00Z'))).toBe(seconds('2026-10-19T21:00:00Z'));
  });


  it.each([
    ['the 23-hour day summer time begins on', '2026-03-29T12:00:00Z', '2026-03-28T22:00:00Z'],
    ['the 25-hour day summer time ends on', '2026-10-25T12:00:00Z', '2026-10-24T21:00:00Z'],
  ])('finds the midnight of %s', (_, now, midnight) => {
    expect(startOfLocalDay(new Date(now))).toBe(seconds(midnight));
  });


  it('without an instant, takes the day the clock is on', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T22:30:00Z'));
    expect(startOfLocalDay()).toBe(seconds('2026-10-19T21:00:00Z'));
  });
});
