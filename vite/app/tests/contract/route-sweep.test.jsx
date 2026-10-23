// -----------------------------------------------------------
//  [*] Tests — the route sweep (every route × every backend state)
//
//  Every route of App.jsx — and a path that matches none —
//  rendered through the real App (renderApp) under the
//  conditions every page must tolerate whatever it does
//  inside:
//
//    - the default backend — the route lands where it should
//      ("/" on the tool), renders it, and makes only requests
//      the double knows (setup.js fails the test on any
//      other); its new-tab links carry rel=noopener, its
//      images an alt
//    - every /api GET answering 500 with the backend's
//      refusal body — the tool shows its error card, nothing
//      crashes
//    - every /api GET answering a JSON string — an answer of
//      the wrong shape: the error card again, nothing crashes
//    - every /api GET dropping the connection — the error
//      card, nothing crashes
//
//  In every state the navbar's links and the footer stand.
//  The per-page tests cover behaviour; this file is the safety
//  net no route can be forgotten by — its first test checks it
//  covers every route App.jsx declares.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { renderApp } from '../support/render';
import { apiError } from '../support/backend/server';
import { expectNoCrash, settle } from '../support/backend/contract';
import { backendIdle, everyGet, watchRequests } from '../support/shell/requests';
import { appRoutes } from '../support/shell/source';
import { FAILURE_HEADLINE, chainShown, failureShown, pageTitle } from '../support/reorg-attack/page';


// The sentence every failing GET carries in the 500 mode
const MESSAGE = 'RPC Connection Error: Read timed out. (read timeout=3)';







// -----------------------------------------------------------
// ROUTES
// -----------------------------------------------------------
//
// Every route to sweep:
//
//   path   — where the student starts
//   lands  — where the default backend takes them ("/" goes
//            on to the tool)
//   tool   — the route shows the attack tool (and so reads
//            the backend); without it the route shows the
//            bare shell and reads nothing
// -----------------------------------------------------------

const ROUTES = [
  { path: '/reorgattack', tool: true },
  { path: '/', lands: '/reorgattack', tool: true },
  { path: '/nieko/nera', tool: false },
];

// The route × state combinations that fail today, each with
// what breaks — run as it.fails so the suite stays green
// while the defect is on record. None at the moment
const PINS = {};







// -----------------------------------------------------------
// Assertions shared by the states
// -----------------------------------------------------------

// The chrome around every page: the navbar's two links home
// and the footer
const expectChrome = () => {
  expect(screen.getByRole('link', { name: 'VU Kauno fakultetas' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '51% Atakos Įrankis' })).toBeInTheDocument();
  expect(screen.getByRole('contentinfo')).toBeInTheDocument();
};

// New-tab links cannot reach back into the tool, images say
// what they are
const expectSafeMarkup = () => {
  for (const link of document.querySelectorAll('a[target="_blank"]')) {
    expect(link.getAttribute('rel') ?? '', link.getAttribute('href')).toMatch(/\bnoopener\b/);
  }
  for (const image of document.querySelectorAll('img')) {
    expect(image.hasAttribute('alt'), image.getAttribute('src')).toBe(true);
  }
};

const landsOn = async (path) => {
  await waitFor(() => expect(window.location.pathname).toBe(path));
};

// A failure mode: every GET answers `respond`; the route is
// rendered and the backend let go idle
const renderFailing = async (path, respond) => {
  const gets = everyGet(respond);
  renderApp({ route: path });
  await backendIdle(gets);
  return gets;
};

// What a failed read looks like: the tool's error card in
// place of the tool; a route without the tool asks nothing
const expectFailureShown = async (route, gets) => {
  if (!route.tool) {
    expect(gets.count).toBe(0);
    expect(pageTitle()).toBeNull();
    return;
  }
  const card = await failureShown();
  expect(card.textContent.startsWith(FAILURE_HEADLINE)).toBe(true);
  expect(pageTitle()).toBeNull();
};







// -----------------------------------------------------------
// The sweep
// -----------------------------------------------------------

describe('route sweep', () => {

  it('covers every route App.jsx declares', () => {
    const swept = ROUTES.map((route) => route.path);
    const uncovered = appRoutes()
      .filter((route) => route.element)
      .filter((route) => !swept.some((path) => new RegExp(`^${route.path.replace(/:\w+/g, '[^/]+')}$`).test(path)))
      .map((route) => route.path);
    expect(uncovered).toEqual([]);
  });


  describe.each(ROUTES)('$path', (route) => {

    const runner = (state) => (PINS[`${route.path} × ${state}`] ? it.fails : it);
    const named = (state, name) => (PINS[`${route.path} × ${state}`] ? `${name} — PINNED KNOWN BUG: ${PINS[`${route.path} × ${state}`]}` : name);


    runner('default')(named('default', 'renders under the default backend and asks only what the double knows'), async () => {
      const seen = watchRequests();
      renderApp({ route: route.path });
      await landsOn(route.lands ?? route.path);
      if (route.tool) await chainShown();
      await settle(100);
      expectNoCrash();
      expectChrome();
      expectSafeMarkup();
      if (!route.tool) expect(seen).toEqual([]);
    });


    runner('500')(named('500', 'shows the failure, not a crash, when every GET answers 500 { success: false, message }'), async () => {
      const gets = await renderFailing(route.path, () => HttpResponse.json(apiError(MESSAGE), { status: 500 }));
      await landsOn(route.lands ?? route.path);
      await expectFailureShown(route, gets);
      expectNoCrash();
      expectChrome();
    });


    runner('JSON string')(named('JSON string', 'shows the failure, not a crash, when every GET answers a JSON string'), async () => {
      const gets = await renderFailing(route.path, () => HttpResponse.json('netikėtas atsakymas'));
      await landsOn(route.lands ?? route.path);
      await expectFailureShown(route, gets);
      expectNoCrash();
      expectChrome();
    });


    runner('dropped')(named('dropped', 'shows the failure, not a crash, when every GET drops the connection'), async () => {
      const gets = await renderFailing(route.path, () => HttpResponse.error());
      await landsOn(route.lands ?? route.path);
      await expectFailureShown(route, gets);
      expectNoCrash();
      expectChrome();
    });
  });
});
