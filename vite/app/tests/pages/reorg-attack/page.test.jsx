// -----------------------------------------------------------
//  [*] Tests — 51% attack page (route /reorgattack)
//
//  The page as a whole against the backend double:
//    - loading: the spinner until the chain's first answer;
//      the status never holds the page up
//    - a chain that cannot be read: the error card with the
//      backend's reason — whatever status it came with — and
//      what to do, in place of the page; a failed re-read
//      keeping the last chain on screen
//    - a malformed chain: a block without a hash and a tracked
//      transaction without a txid left out, the rest shown
//    - the scoreboard under the title: both tips' heights,
//      only the tips the status names, "N/A" for a height
//      nobody knows
//    - following the attack: both polls re-read every ten
//      seconds, a new block and a new height appearing
//      without a reload
//  and the backend contract of the two polls — GET
//  blockchain/data and GET status — as the page consumes
//  them. (The diagram, the details, the panel and the hook
//  have their own files.)
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { describeEndpointContract, settle } from '../../support/backend/contract';
import {
  COLORS, FAILURE_HEADLINE, blockCard, blockCards, cardColor, chainShown, failureShown, headerBadges, loadingShown,
  pageTitle, renderReorgPage,
} from '../../support/reorg-attack/page';
import * as f from '../../support/backend/fixtures';


const { B } = f;

const CHAIN = '/api/reorgattack/blockchain/data';
const STATUS = '/api/reorgattack/status';

const WHAT_TO_DO = 'Patikrinkite ryšį ir bandykite perkrauti puslapį.';

// The private node's next block, on top of its tip
const P6404 = { ...B.p6403, chainWork: 47.5437393, hash: 'a3f1c2d4e5b60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00', height: 6404, prevHash: B.p6403.hash, timestamp: 1792376620 };

const gear = () => screen.queryByRole('button', { name: 'Valdymo skydas' });







// -----------------------------------------------------------
// Loading
// -----------------------------------------------------------

describe('ReorgAttack page — loading', () => {

  it('shows a spinner and says the chain is loading until the first answer — nothing else yet', async () => {
    given.hang('get', CHAIN);
    renderReorgPage();
    await settle(50);
    expect(loadingShown()).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(pageTitle()).toBeNull();
    expect(gear()).toBeNull();
  });


  it('does not wait for the status: the chain shows, the scoreboard stays empty until the status lands', async () => {
    given.hang('get', STATUS);
    renderReorgPage();
    await chainShown();
    expect(pageTitle()).toBeInTheDocument();
    expect(headerBadges()).toEqual([]);
  });
});







// -----------------------------------------------------------
// A chain that cannot be read
// -----------------------------------------------------------

describe('ReorgAttack page — a chain that cannot be read', () => {

  it('says so with the backend\'s reason and what to do, in place of the page', async () => {
    given.json('get', CHAIN, { message: 'RPC Connection Error: Read timed out. (read timeout=3)', success: false });
    renderReorgPage();
    expect(await failureShown()).toHaveTextContent(`${FAILURE_HEADLINE} RPC Connection Error: Read timed out. (read timeout=3)`);
    expect(screen.getByText(WHAT_TO_DO)).toBeInTheDocument();
    expect(pageTitle()).toBeNull();
    expect(gear()).toBeNull();
  });


  it('falls back to "Operacija nepavyko" when the refusal gives no reason', async () => {
    given.json('get', CHAIN, { success: false });
    renderReorgPage();
    expect(await failureShown()).toHaveTextContent(`${FAILURE_HEADLINE} Operacija nepavyko`);
  });


  it('shows the backend\'s reason also when it refuses with an error status', async () => {
    given.error('get', CHAIN, 'RPC Connection Error: Read timed out. (read timeout=3)', 500);
    renderReorgPage();
    expect(await failureShown()).toHaveTextContent(`${FAILURE_HEADLINE} RPC Connection Error: Read timed out. (read timeout=3)`);
  });


  it('keeps the last chain on screen when a re-read fails — no error card over a chain it already has', async () => {
    const { queryClient } = renderReorgPage();
    await chainShown();
    given.html('get', CHAIN);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['reorg-blockchain'] });
    });
    await settle(50);
    expect(blockCards()).toHaveLength(8);
    expect(screen.queryByText((_, element) => element?.getAttribute('role') === 'alert' && element.textContent.startsWith(FAILURE_HEADLINE))).toBeNull();
  });
});







// -----------------------------------------------------------
// A malformed chain
// -----------------------------------------------------------
//
// What the page cannot place it leaves out, and shows the
// rest: a block without a hash is no node, a tracked
// transaction without a txid could not be untracked.
// -----------------------------------------------------------

describe('ReorgAttack page — a malformed chain', () => {

  it('leaves out a block without a hash and draws the rest', async () => {
    given.json('get', CHAIN, f.chainData({ blocks: [...f.CHAIN, { ...B.s6398, hash: null, height: 6397 }, { ...B.s6398, hash: 12345, height: 6396 }] }));
    renderReorgPage();
    await chainShown();
    expect(blockCards()).toHaveLength(f.CHAIN.length);
  });


  it('leaves out a tracked transaction without a txid and lists the rest', async () => {
    given.json('get', CHAIN, f.chainData({ transactions: [...f.TRACKED, { blocks: [], color: 'red', txid: null }, { blocks: [], color: 'red' }] }));
    renderReorgPage();
    await chainShown();
    expect(screen.getByText(`Sekamos Transakcijos (${f.TRACKED.length})`)).toBeInTheDocument();
  });


  it('reads a coinbase that is not text as no coinbase — a red block, not a broken page', async () => {
    given.json('get', CHAIN, f.chainData({ blocks: [{ ...B.u6401, coinbase: 12345 }] }));
    renderReorgPage();
    await chainShown(6401);
    expect(cardColor(blockCard(B.u6401))).toBe(COLORS.attackerCard);
  });
});







// -----------------------------------------------------------
// The scoreboard
// -----------------------------------------------------------

describe('ReorgAttack page — the scoreboard', () => {

  it('titles the page and shows both tips\' heights, public first', async () => {
    renderReorgPage();
    await chainShown();
    expect(pageTitle()).toBeInTheDocument();
    await waitFor(() => expect(headerBadges()).toEqual(['Viešas: 6402', 'Privatus: 6403']));
  });


  it('shows only the tips the status names', async () => {
    const { status } = f.statusAnswer();
    delete status.publicTip;
    given.json('get', STATUS, { status, success: true });
    renderReorgPage();
    await waitFor(() => expect(headerBadges()).toEqual(['Privatus: 6403']));
  });


  it('reads "N/A" for a tip whose height nobody knows — and a height of 0 as 0', async () => {
    given.json('get', STATUS, f.statusAnswer({ publicTip: { available: true, hash: '', height: null }, privateTip: { available: true, hash: '', height: 0 } }));
    renderReorgPage();
    await waitFor(() => expect(headerBadges()).toEqual(['Viešas: N/A', 'Privatus: 0']));
  });
});







// -----------------------------------------------------------
// Following the attack
// -----------------------------------------------------------
//
// Both polls run on setInterval: only the interval clock is
// faked, the requests and React run on real time.
// -----------------------------------------------------------

describe('ReorgAttack page — following the attack', () => {

  it('reads the chain again every ten seconds — the private node\'s new block appears without a reload', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    given.sequence('get', CHAIN, [
      { body: f.chainData() },
      { body: f.chainData({ blocks: [P6404, ...f.CHAIN], tips: { ...f.TIPS, private: P6404.hash } }) },
    ]);
    renderReorgPage();
    await chainShown();
    expect(screen.queryByRole('heading', { level: 6, name: 'Block 6404' })).toBeNull();

    await act(async () => { vi.advanceTimersByTime(9999); });
    await settle(50);
    expect(screen.queryByRole('heading', { level: 6, name: 'Block 6404' })).toBeNull();

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(await screen.findByRole('heading', { level: 6, name: 'Block 6404' })).toBeInTheDocument();
    expect(blockCards()).toHaveLength(9);
  });


  it('reads the status again every ten seconds — the scoreboard follows the private tip', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    given.sequence('get', STATUS, [
      { body: f.statusAnswer() },
      { body: f.statusAnswer({ privateTip: { available: true, hash: P6404.hash, height: 6404 } }) },
    ]);
    renderReorgPage();
    await waitFor(() => expect(headerBadges()).toEqual(['Viešas: 6402', 'Privatus: 6403']));

    await act(async () => { vi.advanceTimersByTime(10000); });
    await waitFor(() => expect(headerBadges()).toEqual(['Viešas: 6402', 'Privatus: 6404']));
  });
});







// -----------------------------------------------------------
// The backend contract of the two polls
// -----------------------------------------------------------


describeEndpointContract({
  path: CHAIN,
  fixture: f.blockchainData(),
  render: () => renderReorgPage(),
  // The page stands in one of its three states
  chrome: () => pageTitle() || screen.queryByRole('alert') || loadingShown(),
  loaded: async () => {
    await chainShown();
    expect(blockCards()).toHaveLength(8);
  },
  failed: async (reason) => {
    const card = await failureShown();
    if (reason) expect(card).toHaveTextContent(`${FAILURE_HEADLINE} ${reason}`);
    else expect(card.textContent.slice(FAILURE_HEADLINE.length)).toMatch(/\S/);
    expect(screen.getByText(WHAT_TO_DO)).toBeInTheDocument();
  },
  loading: loadingShown,
});

describeEndpointContract({
  path: STATUS,
  fixture: f.statusAnswer(),
  render: async () => {
    renderReorgPage();
    await chainShown();
  },
  // Whatever the status does, the chain stays drawn
  chrome: () => pageTitle() && blockCards().length === 8,
  loaded: () => waitFor(() => expect(headerBadges()).toEqual(['Viešas: 6402', 'Privatus: 6403'])),
  // The page has no word for a failed status: the scoreboard
  // simply has no heights to show
  failed: async () => {
    await settle(50);
    expect(headerBadges()).toEqual([]);
  },
  loading: () => headerBadges().length === 0,
});
