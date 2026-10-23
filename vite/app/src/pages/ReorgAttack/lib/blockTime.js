// -----------------------------------------------------------
//  [*] ReorgAttack — block times in the student's timezone
//
//  The backend hands every block's time over as the block
//  header's own timestamp — whole seconds since the Unix
//  epoch, one and the same instant all over the world — and
//  never as a date or a clock time: which day and hour that
//  instant falls on depends on where the student sits, and
//  only the browser knows that. So the browser does all of
//  it, in the timezone its operating system is set to: the
//  date and time each block is shown with, and where the
//  student's "today" begins — the start of the day the chain
//  is asked for.
//
//  Split into:
//
//    TIME_PARTS       — the date and time fields read out
//    utcOffset        — a zone's offset from UTC, as text
//    localBlockTime   — a timestamp as local date and time
//    startOfLocalDay  — the student's midnight, as a timestamp
// -----------------------------------------------------------


// The fields a block's time is read out in. hourCycle h23 —
// not hour12: false — so the hour after midnight is 00, never
// the 24 some engines answer with
const TIME_PARTS = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};







// -----------------------------------------------------------
// utcOffset
// -----------------------------------------------------------
//
// How far a zone's clocks were from UTC at one instant, told
// by the gap between the wall-clock reading there and the
// instant itself: "UTC" and a sign, the hours, and the
// minutes only for the zones that are off by a part of an
// hour. Worked out per block, as summer time moves the
// offset during the year.
//
// Used by:
//   - localBlockTime (below)
// -----------------------------------------------------------

function utcOffset(wallClock, instant) {

  const minutes = Math.round((wallClock - instant) / 60000);
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;

  return `UTC${minutes < 0 ? '-' : '+'}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}







// -----------------------------------------------------------
// localBlockTime
// -----------------------------------------------------------
//
// One block's timestamp as the student reads it: the date and
// time in year-month-day, 24-hour form, the timezone's name
// and its offset from UTC at that moment. The zone is the
// browser's own unless one is named — only the tests name
// one. Anything but a number of seconds that makes a real
// date hands back nothing, and the caller shows the time as
// unknown: a broken payload must not take the diagram down.
//
// Used by:
//   - components/BlockNode.jsx — the time on every card
//   - components/BlockDetailsModal.jsx — the time in full
// -----------------------------------------------------------

export function localBlockTime(timestamp, timeZone) {

  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  const instant = new Date(Math.floor(timestamp) * 1000);
  if (Number.isNaN(instant.getTime())) return null;


  const format = new Intl.DateTimeFormat('en-GB', { ...TIME_PARTS, timeZone });
  const part = Object.fromEntries(format.formatToParts(instant).map(({ type, value }) => [type, value]));
  const wallClock = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);

  return {
    local: `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`,
    zone: format.resolvedOptions().timeZone,
    offset: utcOffset(wallClock, instant.getTime()),
  };
}







// -----------------------------------------------------------
// startOfLocalDay
// -----------------------------------------------------------
//
// The timestamp of the midnight that began the student's
// current day — or the day of the instant handed in — in the
// browser's timezone. The chain is asked for the blocks
// mined since then, so the view follows the student's own
// day and rolls over at their midnight, not at UTC's. A day
// whose midnight summer time skips begins at the first hour
// its clocks show.
//
// Used by:
//   - useReorgAttack.jsx — every poll of the chain
// -----------------------------------------------------------

export function startOfLocalDay(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor(midnight.getTime() / 1000);
}
