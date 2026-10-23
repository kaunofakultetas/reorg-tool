// -----------------------------------------------------------
//  [*] Tests — the test harness itself (smoke)
//
//  Proves the foundation before anything is built on it: the
//  page's relative axios requests reach the msw double and its
//  answers reach the screen — the fork diagram drawn by a real
//  ReactFlow on jsdom — a backend refusal becomes the page's
//  own error presentation, the real App boots at "/" through
//  its own BrowserRouter, and the guards work: a request the
//  double does not know fails the test, and so does a React
//  bug report on the console. And the suite runs in the
//  students' timezone, whatever the machine's own is: every
//  local time a test asserts is Vilnius time.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { renderApp } from '../support/render';
import { given } from '../support/backend/server';
import { allowUnhandledRequests, allowConsoleErrors } from '../support/setup';
import { expectNoCrash } from '../support/backend/contract';
import { blockCards, chainShown, failureShown, renderReorgPage } from '../support/reorg-attack/page';
import * as f from '../support/backend/fixtures';







// -----------------------------------------------------------
// harness smoke
// -----------------------------------------------------------
//
// Uses the attack page — two polls (the chain and the node
// status) and the ReactFlow diagram.
// -----------------------------------------------------------

describe('harness smoke', () => {

  it('renders the page whose queries reach the backend double, every block measured and drawn', async () => {
    renderReorgPage();

    await chainShown();
    expect(blockCards()).toHaveLength(f.CHAIN.length);
    expect(screen.getByText('Privatus: 6403')).toBeInTheDocument();
    expectNoCrash();
  });


  it('shows the page\'s own error card when the chain cannot be read', async () => {
    given.json('get', '/api/reorgattack/blockchain/data', { message: 'Vidinė serverio klaida', success: false });
    renderReorgPage();

    expect(await failureShown()).toHaveTextContent('Vidinė serverio klaida');
  });


  it('boots the real App at "/" and lands on the attack tool', async () => {
    renderApp({ route: '/' });

    await waitFor(() => expect(window.location.pathname).toBe('/reorgattack'));
    await chainShown();
  });


  it('records a request no handler answers (the test declares it expects one)', async () => {
    allowUnhandledRequests();
    await expect(axios.get('/api/no-such-endpoint')).rejects.toThrow();
  });


  it('lets a test declare a console error it provokes on purpose', () => {
    allowConsoleErrors(/Maximum update depth exceeded/);
    console.error('Maximum update depth exceeded — on purpose');
  });


  it('runs in the students\' timezone, Europe/Vilnius — the clock the browser reads block times on', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Vilnius');
    expect(new Date('2026-10-19T02:19:02Z').getHours()).toBe(5);
  });
});
