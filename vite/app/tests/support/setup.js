// -----------------------------------------------------------
//  [*] Test support — the vitest setup file
//
//  Runs before every test file (test.setupFiles in
//  vite.config.js):
//
//    - jest-dom matchers (toBeInTheDocument, toBeDisabled, …)
//    - the browser APIs jsdom lacks that MUI, ReactFlow and
//      the app's own components touch: ResizeObserver,
//      DOMMatrixReadOnly, element sizes, matchMedia, pointer
//      capture, scrollIntoView / scrollTo, SVG bounding boxes
//    - the msw backend double (backend/server.js): started once
//      per file, handlers reset after every test, and a request
//      that no handler answers FAILS the test — a page calling
//      an endpoint the double does not know is exactly the kind
//      of drift this suite exists to catch
//    - a clean slate per test: DOM, URL (back to "/"), title,
//      the toast store, storage, timers, stubbed globals and
//      environment variables, mocks
//    - a console guard: React's own bug reports (a missing key,
//      a state update on another component while rendering, an
//      unknown DOM prop, a hook-order change) fail the test
//      that caused them; act() warnings are printed but
//      tolerated (an answer landing after the last assertion is
//      not a defect)
//
//  Nothing here reaches a real backend, fullnode, browser or
//  the network — the whole suite is self-contained to
//  vite/app.
// -----------------------------------------------------------

import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import toast from 'react-hot-toast';
import { server, unhandledRequests } from './backend/server';


// Messages console.error may carry that mean the code under
// test has a bug (not a test-timing artefact)
const FATAL_CONSOLE_PATTERNS = [
  /unique "key" prop/,
  /Cannot update a component .* while rendering a different component/,
  /Maximum update depth exceeded/,
  /React does not recognize the .* prop on a DOM element/,
  /Invalid DOM property/,
  /Rendered more hooks than during the previous render/,
  /Rendered fewer hooks than expected/,
  /Invalid hook call/,
  /Objects are not valid as a React child/,
];







// -----------------------------------------------------------
// Browser API polyfills
// -----------------------------------------------------------
//
// Installed once per file, before any component code runs.
// Each stub is the smallest thing that keeps the library that
// needs it from throwing; a test that cares about the real
// behaviour (a scroll position) overrides it.
//
// The fork diagram is a ReactFlow graph, and ReactFlow only
// shows a node once it has MEASURED it: a ResizeObserver
// reports the node, its offsetWidth / offsetHeight give the
// size, and a DOMMatrixReadOnly reads the viewport's zoom.
// jsdom has none of the three — without them every block
// stays visibility:hidden and no edge is drawn. The stand-ins
// are the ones ReactFlow's own testing guide prescribes: an
// observer that reports every element the moment it is
// observed, a matrix that reads the scale out of a CSS
// transform, and element sizes taken from the inline style
// (1 px when there is none — enough to count as measured).
// (A click inside the diagram needs one more thing a browser
// gives — see clickInDiagram in reorg-attack/page.jsx.)
//
// Used by:
//   - every rendered component, implicitly
// -----------------------------------------------------------

class ResizeObserverStub {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.callback([{ target }], this); }
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyStub {
  constructor(transform) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}

// findBy*/waitFor give up after 1 s by default — too little for
// a full page (two queries + MUI + ReactFlow) on a loaded
// machine; nothing in the suite is meant to be timing-sensitive
// at that scale
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverStub;
  globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyStub;
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get() { return parseFloat(this.style.height) || 1; } },
    offsetWidth: { configurable: true, get() { return parseFloat(this.style.width) || 1; } },
  });
  SVGElement.prototype.getBBox ??= () => ({ x: 0, y: 0, width: 0, height: 0 });
  // No media query matches — react-hot-toast asks for reduced
  // motion and animates, as in a browser on default settings
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.scrollTo ??= function () {};
  Element.prototype.setPointerCapture ??= function () {};
  Element.prototype.releasePointerCapture ??= function () {};
  Element.prototype.hasPointerCapture ??= function () { return false; };
});







// -----------------------------------------------------------
// Backend double lifecycle
// -----------------------------------------------------------
//
// One msw server per test file: the default handlers (the
// happy path for every endpoint the SPA calls) come back after
// each test, so a test only ever declares the deviation it is
// about. A request no handler matched is recorded by
// backend/server.js and fails the test in afterEach — unless
// the test declared it expects one (allowUnhandledRequests).
//
// Used by:
//   - every test, implicitly
// -----------------------------------------------------------

let unhandledAllowed = false;

export function allowUnhandledRequests() {
  unhandledAllowed = true;
}

// A test that deliberately provokes one of the FATAL console
// messages declares the pattern(s) it expects — those lines
// are then not counted against it
const allowedConsoleErrors = [];

export function allowConsoleErrors(...patterns) {
  allowedConsoleErrors.push(...patterns);
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterAll(() => {
  server.close();
});







// -----------------------------------------------------------
// Per-test slate
// -----------------------------------------------------------
//
// Before: the URL back at "/", an empty title, the console
// guard armed. After: React trees
// unmounted, every toast removed (react-hot-toast keeps its
// store per MODULE, not per <Toaster>, so a toast would
// otherwise outlive its test and show up in the next one),
// handlers reset, storage wiped, real timers, stubbed
// globals, environment variables and mocks undone — then the
// unhandled-request and console verdicts, which come last so
// the cleanup has happened even when they fail the test.
//
// Used by:
//   - every test, implicitly
// -----------------------------------------------------------

const consoleErrors = [];
let originalConsoleError;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  document.title = '';
  unhandledAllowed = false;
  unhandledRequests.length = 0;
  consoleErrors.length = 0;
  allowedConsoleErrors.length = 0;
  originalConsoleError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    originalConsoleError(...args);
  };
});

afterEach(() => {
  cleanup();
  toast.remove();
  server.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  console.error = originalConsoleError;

  if (unhandledRequests.length && !unhandledAllowed) {
    const list = unhandledRequests.map((r) => `${r.method} ${r.url}`).join('\n  ');
    throw new Error(`request(s) the backend double has no handler for — add one in tests/support/backend/handlers.js or answer it in the test:\n  ${list}`);
  }

  const fatal = consoleErrors.filter((msg) =>
    FATAL_CONSOLE_PATTERNS.some((re) => re.test(msg)) && !allowedConsoleErrors.some((re) => re.test(msg)));
  if (fatal.length) {
    throw new Error(`console.error reported a defect during this test:\n  ${fatal.join('\n  ')}`);
  }
});
