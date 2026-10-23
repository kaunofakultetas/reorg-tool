// -----------------------------------------------------------
//  [*] Tests — App.jsx (the shell, "/" and routing)
//
//  The whole application through renderApp — App.jsx's own
//  BrowserRouter, started at a route:
//    - the shell: the navbar (logo, the app's name), the
//      tool, the footer — in that order, each once
//    - "/": a redirect into /reorgattack that replaces the
//      history entry (Back never bounces into it); both navbar
//      links lead back to the tool through it
//    - a path that matches no route: the shell stands, no
//      tool, not one request — and the logo leads out of it
//    - the same App under StrictMode with main.jsx's query
//      policy (one retry, read from main.jsx): it boots, asks
//      each poll once, shows a toast once, and retries a
//      failing chain once before the error card
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderApp, makeQueryClient } from '../support/render';
import { given } from '../support/backend/server';
import { settle } from '../support/backend/contract';
import { navigateTo } from '../support/shell/router';
import { watchRequests } from '../support/shell/requests';
import { readSource } from '../support/shell/source';
import {
  attackSwitch, blockCards, chainShown, failureShown, findToast, openPanel, pageTitle, toasts,
} from '../support/reorg-attack/page';
import App from '@/App';


const CHAIN = '/api/reorgattack/blockchain/data';
const STATUS = '/api/reorgattack/status';

const logo = () => screen.getByRole('link', { name: 'VU Kauno fakultetas' });
const namePill = () => screen.getByRole('link', { name: '51% Atakos Įrankis' });
const footer = () => screen.getByRole('contentinfo');

const landsOn = async (path) => {
  await waitFor(() => expect(window.location.pathname).toBe(path));
};

const times = (seen, request) => seen.filter((entry) => entry === request).length;

// DOM order is reading order: a before b
const precedes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);







// -----------------------------------------------------------
// The shell
// -----------------------------------------------------------

describe('App shell', () => {

  it('frames the tool: the logo and the app\'s name, then the tool, then the footer', async () => {
    renderApp({ route: '/reorgattack' });
    await chainShown();
    expect(precedes(logo(), namePill())).toBe(true);
    expect(precedes(namePill(), pageTitle())).toBe(true);
    expect(precedes(pageTitle(), footer())).toBe(true);
  });


  it('shows each part once', async () => {
    renderApp({ route: '/reorgattack' });
    await chainShown();
    expect(screen.getAllByRole('link', { name: 'VU Kauno fakultetas' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 5, name: '51% Atakos Įrankis' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Valdymo skydas' })).toHaveLength(1);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  });
});







// -----------------------------------------------------------
// "/" — into the tool
// -----------------------------------------------------------

describe('App "/" — into the tool', () => {

  it('sends "/" to the attack tool', async () => {
    renderApp({ route: '/' });
    await landsOn('/reorgattack');
    await chainShown();
  });


  it('is a replace: the redirect adds no history entry, so Back never bounces into it', async () => {
    const before = window.history.length;
    renderApp({ route: '/' });
    await landsOn('/reorgattack');
    expect(window.history.length).toBe(before);
  });


  it.each([
    ['the logo', logo],
    ['the app\'s name', namePill],
  ])('%s leads back to the tool through "/"', async (_, link) => {
    const { user } = renderApp({ route: '/reorgattack' });
    await chainShown();
    await user.click(link());
    await landsOn('/reorgattack');
    await chainShown();
  });
});







// -----------------------------------------------------------
// A path that matches no route
// -----------------------------------------------------------

describe('App — a path that matches no route', () => {

  it('keeps the shell standing, shows no tool and asks the backend nothing', async () => {
    const seen = watchRequests();
    renderApp({ route: '/nieko/nera' });
    await settle(100);
    expect(logo()).toBeInTheDocument();
    expect(footer()).toBeInTheDocument();
    expect(pageTitle()).toBeNull();
    expect(seen).toEqual([]);
  });


  it('the logo leads from there to the tool', async () => {
    const { user } = renderApp({ route: '/nieko/nera' });
    await user.click(logo());
    await landsOn('/reorgattack');
    await chainShown();
  });


  it('typing the tool\'s address from there opens it', async () => {
    renderApp({ route: '/nieko/nera' });
    await navigateTo('/reorgattack');
    await chainShown();
    expect(blockCards()).toHaveLength(8);
  });
});







// -----------------------------------------------------------
// As main.jsx mounts it
// -----------------------------------------------------------
//
// Production wraps the App in StrictMode (every effect runs,
// is cleaned up and runs again) with main.jsx's query policy
// — its retry count is read from main.jsx itself; renderApp
// does neither. The shell must work the same under it.
// -----------------------------------------------------------

const MAIN_RETRY = Number(readSource('src/main.jsx').match(/\bretry:\s*(\d+)/)?.[1]);

function renderStrictApp(route) {
  window.history.replaceState(null, '', route);
  const user = userEvent.setup();
  const view = render(
    <StrictMode>
      <QueryClientProvider client={makeQueryClient({ retry: MAIN_RETRY })}>
        <App />
      </QueryClientProvider>
    </StrictMode>
  );
  return { user, ...view };
}

describe('App under StrictMode, as main.jsx mounts it', () => {

  it('reads main.jsx\'s retry policy: one retry', () => {
    expect(MAIN_RETRY).toBe(1);
  });


  it('boots: "/" lands on the tool and the chain is drawn', async () => {
    renderStrictApp('/');
    await landsOn('/reorgattack');
    await chainShown();
    expect(blockCards()).toHaveLength(8);
  });


  it('asks each poll once, though StrictMode mounts everything twice', async () => {
    const seen = watchRequests();
    renderStrictApp('/reorgattack');
    await chainShown();
    await settle(100);
    expect(times(seen, `GET ${CHAIN}`)).toBe(1);
    expect(times(seen, `GET ${STATUS}`)).toBe(1);
  });


  it('shows an action\'s toast once, though StrictMode runs every effect twice', async () => {
    const { user } = renderStrictApp('/reorgattack');
    await chainShown();
    await screen.findByText('Viešas: 6402');
    await openPanel(user);
    await user.click(attackSwitch());
    await findToast('Prisijungta prie viešo tinklo');
    await settle(100);
    expect(toasts()).toEqual([['Prisijungta prie viešo tinklo']]);
  });


  it('asks a failing chain once more before it shows the error card', async () => {
    given.html('get', CHAIN);
    const seen = watchRequests();
    renderStrictApp('/reorgattack');
    await failureShown();
    expect(times(seen, `GET ${CHAIN}`)).toBe(2);
  });
});
