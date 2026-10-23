// -----------------------------------------------------------
//  [*] Test support — the msw backend double
//
//  The SPA never talks to a real backend in this suite. msw
//  (Mock Service Worker, node build) intercepts every request
//  the code under test issues — axios with its relative
//  "/api/…" URLs, exactly as in production — and answers from
//  handlers:
//
//    - handlers.js holds the DEFAULT answer for every endpoint
//      the SPA calls (the happy path, bodies shaped like the
//      real backend's, values from fixtures.js)
//    - a test declares deviations through `given` below (a
//      refusal, Flask's HTML error page, an empty body, a
//      wrong shape, a hang, a dropped connection), which take
//      precedence until setup.js resets the handlers after the
//      test
//    - contract.js turns those deviations into a matrix a
//      page test runs against each endpoint it consumes
//
//  Handlers are registered with ABSOLUTE urls on the jsdom
//  origin (TEST_ORIGIN): jsdom resolves the relative requests
//  against it.
//
//  Used by:
//    - setup.js — lifecycle, the unhandled-request verdict
//    - every test that shapes a backend answer (given.*)
// -----------------------------------------------------------

import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { defaultHandlers } from './handlers';
import { TEST_ORIGIN } from '../location';


// Requests no handler answered during the current test —
// setup.js fails the test on them (see allowUnhandledRequests)
export const unhandledRequests = [];


export const server = setupServer(...defaultHandlers);

server.events.on('request:unhandled', ({ request }) => {
  unhandledRequests.push({ method: request.method, url: request.url });
});


// What Flask answers when a route raises (a fullnode that
// does not answer its RPC, say) — its stock 500 page, HTML,
// not the JSON envelope
export const FLASK_500_PAGE = '<!doctype html>\n<html lang=en>\n<title>500 Internal Server Error</title>\n<h1>Internal Server Error</h1>\n<p>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</p>\n';







// -----------------------------------------------------------
// url
// -----------------------------------------------------------
//
// An "/api/…" path made absolute on the jsdom origin
// (TEST_ORIGIN), where the handlers listen. The path may carry
// msw params and wildcards; a URL that is already absolute is
// returned unchanged.
//
// Used by:
//   - given (below), contract.js, shell/requests.js
//   - the control panel and hook tests — handlers of their
//     own, for a request the given.* one-liners cannot shape
// -----------------------------------------------------------

export const url = (path) => (/^https?:\/\//.test(path) ? path : `${TEST_ORIGIN}${path}`);







// -----------------------------------------------------------
// apiError
// -----------------------------------------------------------
//
// The body of every refusal the backend sends itself: the
// envelope with success false and the reason in message
// (English, from the backend's code — "Failed to send
// transaction: RPC Error: …").
//
// Used by:
//   - given.error (below), contract.js — the failure variants
//   - contract/route-sweep.test.jsx — the 500 mode
// -----------------------------------------------------------

export const apiError = (message) => ({ message, success: false });







// -----------------------------------------------------------
// given
// -----------------------------------------------------------
//
// One-liners that override the answer of a single endpoint
// for the rest of the test. Each takes the HTTP method (get,
// post or delete) and an "/api/…" path, msw params allowed.
// Every override goes through server.use and so is dropped by
// the handler reset in setup.js afterEach.
//
// json answers any body, with status 200 unless the test
// names another; error answers the backend's refusal
// envelope carrying the test's message, a 500 unless told
// otherwise (the status every route of this backend refuses
// with); html is Flask's HTML error page, a 500 unless the
// test gives its own status and page; empty an answer with no
// body at all — a 502, the proxy's answer while the backend
// is down, unless told otherwise; networkError is a dropped
// connection, hang a request that never answers, and slow
// answers the body only after the given number of
// milliseconds.
//
// capture answers with a body and hands back the list of
// every request that arrived — its URL, its path params, its
// query (the URL's search params as an object) and its body
// (the parsed JSON or text a POST carried, else null). The
// body may also be a function of the request's path params,
// query and sent body that returns the answer's body; the
// body, or what the function returns, may be a whole msw
// response the test built itself.
//
// sequence answers each call with the next response of a
// list, the last one repeating: a dropped connection, an HTML
// page (a 500 unless it names a status) or a JSON body (an
// empty object with status 200 unless it gives others).
//
// Used by:
//   - the page, hook and core tests
// -----------------------------------------------------------

const respond = (method, path, resolver) => {
  server.use(http[method](url(path), resolver));
};

export const given = {

  json(method, path, body, { status = 200 } = {}) {
    respond(method, path, () => HttpResponse.json(body, { status }));
  },

  error(method, path, message, status = 500) {
    respond(method, path, () => HttpResponse.json(apiError(message), { status }));
  },

  html(method, path, status = 500, text = FLASK_500_PAGE) {
    respond(method, path, () => new HttpResponse(text, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  },

  empty(method, path, status = 502) {
    respond(method, path, () => new HttpResponse(null, { status }));
  },

  networkError(method, path) {
    respond(method, path, () => HttpResponse.error());
  },

  hang(method, path) {
    respond(method, path, () => new Promise(() => {}));
  },

  slow(method, path, ms, body = {}, { status = 200 } = {}) {
    respond(method, path, async () => {
      await delay(ms);
      return HttpResponse.json(body, { status });
    });
  },

  capture(method, path, body = {}, { status = 200 } = {}) {
    const calls = [];
    respond(method, path, async ({ request, params }) => {
      const requested = new URL(request.url);
      const text = await request.text();
      let sent = null;
      if (text) {
        try { sent = JSON.parse(text); } catch { sent = text; }
      }
      calls.push({ url: request.url, params: { ...params }, query: Object.fromEntries(requested.searchParams), body: sent });
      const answer = typeof body === 'function' ? body({ params, query: requested.searchParams, sent }) : body;
      return answer instanceof Response ? answer : HttpResponse.json(answer, { status });
    });
    return calls;
  },

  sequence(method, path, responses) {
    let i = 0;
    respond(method, path, () => {
      const step = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (step.error) return HttpResponse.error();
      if (step.html) return new HttpResponse(step.html, { status: step.status ?? 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return HttpResponse.json(step.body ?? {}, { status: step.status ?? 200 });
    });
  },
};
