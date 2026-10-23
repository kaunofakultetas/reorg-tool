// -----------------------------------------------------------
//  [*] Test support — the backend contract matrix
//
//  What the page must survive from its backend. For one
//  endpoint the page consumes, describeEndpointContract()
//  generates a test per response VARIANT — every way the
//  answer can be broken, wrong, late or missing:
//
//    failures (the backend's own refusals — the envelope with
//    success false, under a 500, a 400 or even a 200 — Flask's
//    HTML error page when a route raises, the proxy's empty
//    502 while the backend is down, a dropped connection) —
//    each must reach the screen the way THIS page presents a
//    failure of that endpoint (the `failed` callback: the
//    error card, a toast …), nothing crashing
//
//    modified bodies (an empty body, null, a string, a number;
//    inside a successful envelope: the payload in the wrong
//    container, every field missing, every leaf null, types
//    swapped, extra fields, a huge list, hostile
//    unicode/markup in every string) — the page must not
//    crash: no render error, its chrome still there, and
//    markup in a string rendered as text, never as elements
//
//    timing (a hang, a slow answer) — the loading state must
//    hold, then the data must land
//
//  A page test calls it once per endpoint, with the render and
//  the assertions that page understands; the variants a page
//  cannot meet are pinned with `pins` (it.fails, with a short
//  bug description) so the suite stays green while the defect
//  is on record.
//
//  Used by:
//    - the page tests (tests/pages/reorg-attack/*)
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server, url, apiError, FLASK_500_PAGE } from './server';


// What the hostile-string variant puts in every string field
export const HOSTILE_STRING = '💾 Ąžuolas <script>alert(1)</script> <img src=x onerror=alert(2)> {placeholder} \u0000';

// The reasons the refusal variants carry — the backend's own
// English sentences: what FullNodeRPC raises when a fullnode
// does not answer in time, and a route's refusal of a request
// that lacks its field
export const REFUSAL_500 = "RPC Connection Error: HTTPConnectionPool(host='reorg-knfcoind-private', port=19332): Read timed out. (read timeout=3)";
export const REFUSAL_400 = 'Missing txid in request body';







// -----------------------------------------------------------
// Body mutators
// -----------------------------------------------------------
//
// Pure transforms of a fixture body into a "modified" one.
// They walk arrays and plain objects; leaves are replaced
// according to the variant. inEnvelope applies one to every
// field of the backend's envelope but its success flag — the
// answer still claims success, so the broken payload reaches
// the page instead of being refused at the door.
//
// Used by:
//   - VARIANTS (below)
// -----------------------------------------------------------

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const mapLeaves = (value, fn) => {
  if (Array.isArray(value)) return value.map((v) => mapLeaves(v, fn));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapLeaves(v, fn)]));
  return fn(value);
};

export const nullLeaves = (body) => mapLeaves(body, () => null);

export const swapTypes = (body) => mapLeaves(body, (v) => {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v === '' ? 0 : 12345;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
});

export const hostileStrings = (body) => mapLeaves(body, (v) => (typeof v === 'string' ? HOSTILE_STRING : v));

export const withExtraFields = (body) => {
  if (Array.isArray(body)) return body.map(withExtraFields);
  if (!isPlainObject(body)) return body;
  return {
    ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k, withExtraFields(v)])),
    extra_field: { deep: [1, 2, { x: null }] },
    another: 'unexpected',
  };
};

// Every field of the payload gone: the envelope keeps its
// success flag, a payload object (or list) stays but empty,
// every other field of the envelope is dropped
export const missingFields = (body) => {
  if (Array.isArray(body)) return body.map(() => ({}));
  if (!isPlainObject(body)) return body;
  return Object.fromEntries(Object.entries(body)
    .filter(([key, value]) => key === 'success' || isPlainObject(value) || Array.isArray(value))
    .map(([key, value]) => [key, key === 'success' ? value : missingFields(Array.isArray(value) ? value : {})]));
};

export const wrongContainer = (body) => (Array.isArray(body) ? {} : []);

// The first list in the body, however deep (the chain's
// chainBlocks), grown to n entries
export const hugeList = (body, n = 300) => {
  const grow = (list) => Array.from({ length: n }, (_, i) => {
    const row = list[i % list.length];
    return isPlainObject(row) ? { ...row } : row;
  });
  let grown = false;
  const walk = (value) => {
    if (grown) return value;
    if (Array.isArray(value) && value.length) {
      grown = true;
      return grow(value);
    }
    if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };
  return walk(body);
};

export const inEnvelope = (body, mutate) => {
  if (!isPlainObject(body)) return mutate(body);
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, k === 'success' ? v : mutate(v)]));
};







// -----------------------------------------------------------
// VARIANTS
// -----------------------------------------------------------
//
// Every generated test: its name, the msw response it builds
// from a copy of the fixture, and what the page must do with
// that answer — 'failed' (show the failure), 'survives'
// (stand without crashing), 'hostile' (stand, with markup
// rendered as text), 'loading' (hold its loading state) or
// 'loaded' (show the data). A failure variant also names the
// reason the answer carried — the backend's sentence the
// page must pass on — or null when it carried none (an HTML
// page, no body, no answer at all).
//
// Used by:
//   - describeEndpointContract (below)
// -----------------------------------------------------------

const jsonResponse = (body, status = 200) => HttpResponse.json(body, { status });

export const VARIANTS = [
  { name: '500 { success: false, message } → the failure is shown', respond: () => jsonResponse(apiError(REFUSAL_500), 500), expect: 'failed', reason: REFUSAL_500 },
  { name: '400 { success: false, message } → the failure is shown', respond: () => jsonResponse(apiError(REFUSAL_400), 400), expect: 'failed', reason: REFUSAL_400 },
  { name: '200 { success: false, message } → the failure is shown', respond: () => jsonResponse(apiError(REFUSAL_500)), expect: 'failed', reason: REFUSAL_500 },
  { name: '200 { success: false } with no message → the failure is shown', respond: () => jsonResponse({ success: false }), expect: 'failed', reason: null },
  { name: 'Flask\'s HTML error page (500) → the failure is shown', respond: () => new HttpResponse(FLASK_500_PAGE, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }), expect: 'failed', reason: null },
  { name: 'the proxy\'s empty 502 (backend down) → the failure is shown', respond: () => new HttpResponse(null, { status: 502 }), expect: 'failed', reason: null },
  { name: 'connection dropped → the failure is shown', respond: () => HttpResponse.error(), expect: 'failed', reason: null },
  { name: 'empty 200 body → page survives', respond: () => new HttpResponse(null, { status: 200 }), expect: 'survives' },
  { name: 'JSON null → page survives', respond: () => jsonResponse(null), expect: 'survives' },
  { name: 'a JSON string → page survives', respond: () => jsonResponse('unexpected'), expect: 'survives' },
  { name: 'a JSON number → page survives', respond: () => jsonResponse(42), expect: 'survives' },
  { name: 'payload in the wrong container (a list for an object) → page survives', respond: (fx) => jsonResponse(inEnvelope(fx, wrongContainer)), expect: 'survives' },
  { name: 'every payload field missing → page survives', respond: (fx) => jsonResponse(missingFields(fx)), expect: 'survives' },
  { name: 'every leaf null → page survives', respond: (fx) => jsonResponse(inEnvelope(fx, nullLeaves)), expect: 'survives' },
  { name: 'types swapped (numbers as strings, strings as numbers) → page survives', respond: (fx) => jsonResponse(inEnvelope(fx, swapTypes)), expect: 'survives' },
  { name: 'unknown extra fields → page survives and still shows the data', respond: (fx) => jsonResponse(withExtraFields(fx)), expect: 'loaded' },
  { name: 'a huge list (300 entries) → page survives', respond: (fx) => jsonResponse(hugeList(fx)), expect: 'survives' },
  { name: 'hostile strings (unicode + markup) → rendered as text, never as elements', respond: (fx) => jsonResponse(inEnvelope(fx, hostileStrings)), expect: 'hostile' },
  { name: 'a hanging request → the loading state holds, nothing crashes', respond: () => new Promise(() => {}), expect: 'loading' },
  { name: 'a slow answer (200 ms) → the data lands', respond: async (fx) => { await new Promise((r) => setTimeout(r, 200)); return jsonResponse(fx); }, expect: 'loaded' },
];







// -----------------------------------------------------------
// describeEndpointContract
// -----------------------------------------------------------
//
// Generates the matrix for one endpoint: a describe block
// named after its method and path, one test per variant. The
// page test names the endpoint by its msw path and method (a
// GET unless it says otherwise) and hands over the happy
// body, of which every variant gets a fresh copy; the rest is
// what this page understands.
//
// `render` mounts the page; it may be async — an endpoint the
// page calls only after a click renders and clicks there, and
// is awaited. `chrome` runs after every variant: the page must
// still show its own frame. `loaded` is awaited for the
// variants that end with data on screen, `failed` for the
// failure variants — handed the reason the answer carried
// (null for none), for the page to show exactly that; and the
// optional `loading` must hold while the request hangs.
// `only` narrows the run to the variants it names; `skip` and
// `pins` map a variant's name to a reason — a skipped variant
// is listed with its reason, a pinned one runs as it.fails
// with the bug in its title.
//
// Used by:
//   - pages/reorg-attack/page.test.jsx — the two polls
//   - pages/reorg-attack/control-panel.test.jsx — the five
//     actions
// -----------------------------------------------------------

export function describeEndpointContract({ path, method = 'get', fixture, render, chrome, loaded, failed, loading, only, skip = {}, pins = {} }) {

  const variants = only ? VARIANTS.filter((v) => only.includes(v.name)) : VARIANTS;

  describe(`backend contract — ${method.toUpperCase()} ${path}`, () => {

    for (const variant of variants) {
      if (variant.name in skip) {
        it.skip(`${variant.name} (skipped: ${skip[variant.name]})`, () => {});
        continue;
      }

      const runner = variant.name in pins ? it.fails : it;
      const title = variant.name in pins ? `${variant.name} — PINNED KNOWN BUG: ${pins[variant.name]}` : variant.name;

      runner(title, async () => {
        let answered = false;
        server.use(http[method](url(path), async () => {
          answered = true;
          return variant.respond(structuredClone(fixture));
        }));

        await render();

        if (variant.expect === 'loading') {
          // The request is in flight and stays so: the page must
          // show its loading state (when it has one) and nothing
          // else
          await waitFor(() => expect(answered).toBe(true));
          await settle();
          if (loading) await waitFor(() => expect(loading()).toBeTruthy());
          expectNoCrash();
          if (chrome) expect(chrome()).toBeTruthy();
          return;
        }

        if (variant.expect === 'failed') {
          await waitFor(() => expect(answered).toBe(true));
          await failed(variant.reason);
          expectNoCrash();
          if (chrome) expect(chrome()).toBeTruthy();
          return;
        }

        if (variant.expect === 'loaded') {
          await loaded();
          expectNoCrash();
          if (chrome) expect(chrome()).toBeTruthy();
          return;
        }

        // 'survives' and 'hostile': wait for the answer to be
        // processed, then the page must simply still stand
        await waitFor(() => expect(answered).toBe(true));
        await settle();
        expectNoCrash();
        if (chrome) expect(chrome()).toBeTruthy();
        if (variant.expect === 'hostile') {
          expect(document.querySelector('script')).toBeNull();
          expect(document.querySelector('img[src="x"]')).toBeNull();
        }
      });
    }
  });
}







// -----------------------------------------------------------
// settle / expectNoCrash
// -----------------------------------------------------------
//
// settle lets React flush the state updates an answered
// request triggers (a wait of a few macrotasks inside act —
// 30 ms unless the caller names another — so the updates are
// not reported as un-acted); expectNoCrash checks that the
// test net of renderPage (data-testid render-crashed) did not
// fire, failing with the message it caught.
//
// Used by:
//   - describeEndpointContract (above), shell/requests.js
//   - the page, hook and core tests and the route sweep —
//     settle; the smoke test and the route sweep —
//     expectNoCrash
// -----------------------------------------------------------

export async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

export function expectNoCrash() {
  const crashed = screen.queryByTestId('render-crashed');
  if (crashed) throw new Error(crashed.textContent);
}
