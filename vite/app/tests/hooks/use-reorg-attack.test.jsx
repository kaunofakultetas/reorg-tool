// -----------------------------------------------------------
//  [*] Tests — useReorgAttack (the attack page's backend side)
//
//  The hook on its own, against the backend double:
//    - before anything lands: pending, with empty defaults
//      the page can render from
//    - the two polls: the chain asked for since the student's
//      midnight (the browser's, not UTC's, and moving on when
//      their day does); the chain payload and the status
//      handed over as they came — lists that are no lists
//      read as empty, a tracked transaction without a txid is
//      left out — "attached" derived from the status and the
//      status said to be unknown until it has been read, the
//      backend's refusals turned into errors carrying its
//      message whatever status they came with ("Operacija
//      nepavyko" when there is none), a status failure kept
//      out of the page's error state, both polls repeated
//      every ten seconds
//    - the four actions: the endpoint and body each sends —
//      an untracked txid as one URL path segment — both polls
//      re-read after every success and after no failure,
//      isMutating while one is out
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { makeQueryClient } from '../support/render';
import { given, server, url } from '../support/backend/server';
import { settle } from '../support/backend/contract';
import { watchRequests } from '../support/shell/requests';
import * as f from '../support/backend/fixtures';
import useReorgAttack from '@/pages/ReorgAttack/useReorgAttack';


const CHAIN = '/api/reorgattack/blockchain/data';
const STATUS = '/api/reorgattack/status';

function renderAttackHook() {
  const client = makeQueryClient();
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useReorgAttack(), { wrapper });
}

const landed = (result) => waitFor(() => expect(result.current.isPending).toBe(false));

const times = (seen, request) => seen.filter((entry) => entry === request).length;







// -----------------------------------------------------------
// Before anything lands
// -----------------------------------------------------------

describe('useReorgAttack — before anything lands', () => {

  it('is pending, with empty defaults: no blocks, both tips unknown, nothing tracked, the status unknown, idle', () => {
    given.hang('get', CHAIN);
    given.hang('get', STATUS);
    const { result } = renderAttackHook();
    expect(result.current).toMatchObject({
      chainBlocks: [],
      chainTips: { public: null, private: null },
      transactions: [],
      networkStatus: {},
      isConnectedToPublic: false,
      statusKnown: false,
      statusError: null,
      isPending: true,
      isError: false,
      isMutating: false,
    });
  });
});







// -----------------------------------------------------------
// The two polls
// -----------------------------------------------------------

describe('useReorgAttack — the chain and the status', () => {

  it('hands over the chain payload as it came: the blocks, both tips, the tracked list', async () => {
    const { result } = renderAttackHook();
    await landed(result);
    expect(result.current.chainBlocks).toEqual(f.CHAIN);
    expect(result.current.chainTips).toEqual(f.TIPS);
    expect(result.current.transactions).toEqual(f.TRACKED);
    expect(result.current.isError).toBe(false);
  });


  // Only the clock is faked: 22:30 UTC is already half past one
  // the next night in Vilnius, whose day began at 21:00 UTC
  it('asks for the chain since the student\'s midnight — late in the UTC evening, already the next day\'s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T22:30:00Z'));
    const calls = given.capture('get', CHAIN, f.blockchainData());
    const { result } = renderAttackHook();
    await landed(result);
    expect(calls.map((call) => call.query)).toEqual([{ since: String(Date.parse('2026-10-19T21:00:00Z') / 1000) }]);
  });


  it('moves on to the new day at the student\'s midnight, between two polls', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-19T20:59:55Z'));
    const calls = given.capture('get', CHAIN, f.blockchainData());
    renderAttackHook();
    for (let tries = 0; tries < 100 && calls.length < 1; tries += 1) await settle(20);

    await act(async () => { vi.advanceTimersByTime(10000); });
    for (let tries = 0; tries < 100 && calls.length < 2; tries += 1) await settle(20);
    expect(calls.map((call) => call.query.since)).toEqual([
      String(Date.parse('2026-10-18T21:00:00Z') / 1000),
      String(Date.parse('2026-10-19T21:00:00Z') / 1000),
    ]);
  });


  it('hands over the status as it came, and derives "attached" from it', async () => {
    const { result } = renderAttackHook();
    await waitFor(() => expect(result.current.networkStatus).toEqual(f.statusAnswer().status));
    expect(result.current.isConnectedToPublic).toBe(false);
    expect(result.current.statusKnown).toBe(true);
    expect(result.current.statusError).toBeNull();
  });


  it('keeps a status it could not read unknown, with the reason', async () => {
    given.error('get', STATUS, 'Failed to get network status: RPC Connection Error: Read timed out.', 500);
    const { result } = renderAttackHook();
    await waitFor(() => expect(result.current.statusError).not.toBeNull());
    expect(result.current.statusKnown).toBe(false);
    expect(result.current.statusError.message).toBe('Failed to get network status: RPC Connection Error: Read timed out.');
  });


  it('hands over only lists, and only tracked transactions with a txid', async () => {
    given.json('get', CHAIN, f.chainData({ blocks: 'not a list', transactions: [...f.TRACKED, { txid: null }, { txid: '' }, null, 7] }));
    const { result } = renderAttackHook();
    await landed(result);
    expect(result.current.chainBlocks).toEqual([]);
    expect(result.current.transactions).toEqual(f.TRACKED);
  });


  it('keeps the same lists between renders while the chain stays the same', async () => {
    // The diagram memoises on them
    const { result, rerender } = renderAttackHook();
    await landed(result);
    const { chainBlocks, chainTips, transactions } = result.current;
    rerender();
    expect(result.current.chainBlocks).toBe(chainBlocks);
    expect(result.current.chainTips).toBe(chainTips);
    expect(result.current.transactions).toBe(transactions);
  });


  it('reports attached when the status says so', async () => {
    given.json('get', STATUS, f.statusAnswer({ connected: true }));
    const { result } = renderAttackHook();
    await waitFor(() => expect(result.current.isConnectedToPublic).toBe(true));
  });


  it('takes a status answer without its status object as an empty status', async () => {
    given.json('get', STATUS, { success: true });
    const { result } = renderAttackHook();
    await landed(result);
    await settle(50);
    expect(result.current.networkStatus).toEqual({});
    expect(result.current.isConnectedToPublic).toBe(false);
  });


  it('turns a refusal in the envelope into an error carrying the backend\'s message', async () => {
    given.json('get', CHAIN, { message: 'RPC Connection Error: Read timed out. (read timeout=3)', success: false });
    const { result } = renderAttackHook();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toBe('RPC Connection Error: Read timed out. (read timeout=3)');
    expect(result.current.isPending).toBe(false);
    expect(result.current.chainBlocks).toEqual([]);
  });


  it.each([
    ['a refusal with no message', { success: false }],
    ['a body that is no envelope at all', 'netikėtas atsakymas'],
    ['a JSON null', null],
  ])('falls back to "Operacija nepavyko" for %s', async (_, body) => {
    given.json('get', CHAIN, body);
    const { result } = renderAttackHook();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toBe('Operacija nepavyko');
  });


  it('keeps the backend\'s message also when it refuses with an error status', async () => {
    given.error('get', CHAIN, 'RPC Connection Error: Read timed out. (read timeout=3)', 500);
    const { result } = renderAttackHook();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toBe('RPC Connection Error: Read timed out. (read timeout=3)');
  });


  it('keeps a failed status out of the error state — the page\'s error is the chain\'s alone', async () => {
    given.html('get', STATUS);
    const { result } = renderAttackHook();
    await landed(result);
    await settle(50);
    expect(result.current.isError).toBe(false);
    expect(result.current.chainBlocks).toEqual(f.CHAIN);
    expect(result.current.networkStatus).toEqual({});
  });


  // Only the interval clock is faked. Testing Library's waitFor
  // polls on setInterval too and a hook changes no DOM to wake
  // it, and vitest's vi.waitFor moves the faked clock itself —
  // so the checks here poll on the real setTimeout
  it('polls both every ten seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const seen = watchRequests();
    renderAttackHook();
    const asked = async (count) => {
      const counts = () => [times(seen, `GET ${CHAIN}`), times(seen, `GET ${STATUS}`)];
      for (let tries = 0; tries < 100 && counts().some((n) => n !== count); tries += 1) await settle(20);
      expect(counts()).toEqual([count, count]);
    };

    await asked(1);
    await act(async () => { vi.advanceTimersByTime(9999); });
    await settle(50);
    await asked(1);

    await act(async () => { vi.advanceTimersByTime(1); });
    await asked(2);

    await act(async () => { vi.advanceTimersByTime(10000); });
    await asked(3);
  });
});







// -----------------------------------------------------------
// The four actions
// -----------------------------------------------------------

describe('useReorgAttack — the actions', () => {

  it.each([
    [true, 'GET /api/reorgattack/connect'],
    [false, 'GET /api/reorgattack/disconnect'],
  ])('toggleConnection(%s) asks %s', async (connected, request) => {
    const seen = watchRequests();
    const { result } = renderAttackHook();
    await landed(result);
    act(() => result.current.toggleConnection(connected));
    await waitFor(() => expect(seen).toContain(request));
    expect(seen.filter((entry) => /connect$/.test(entry))).toEqual([request]);
  });


  it('sendRawTransaction posts the raw hex and its colour', async () => {
    const calls = given.capture('post', '/api/reorgattack/transactions/send', f.sendAnswer());
    const { result } = renderAttackHook();
    await landed(result);
    act(() => result.current.sendRawTransaction({ raw: f.RAW_TX, color: 'cyan' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ raw_transaction: f.RAW_TX, color: 'cyan' });
  });


  it('addTransaction posts the txid and its colour', async () => {
    const calls = given.capture('post', '/api/reorgattack/transactions', f.trackAnswer(), { status: 201 });
    const { result } = renderAttackHook();
    await landed(result);
    act(() => result.current.addTransaction({ txid: f.NEW_TXID, color: 'yellow' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ txid: f.NEW_TXID, color: 'yellow' });
  });


  it('removeTransaction deletes that txid', async () => {
    const calls = given.capture('delete', '/api/reorgattack/transactions/:txid', f.untrackAnswer());
    const { result } = renderAttackHook();
    await landed(result);
    act(() => result.current.removeTransaction(f.T.both));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].params.txid).toBe(f.T.both);
  });


  it('removeTransaction sends the txid as one URL path segment, whatever it holds', async () => {
    const calls = given.capture('delete', '/api/reorgattack/transactions/:txid', f.untrackAnswer());
    const { result } = renderAttackHook();
    await landed(result);
    act(() => result.current.removeTransaction('ab/cd?e#f'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(new URL(calls[0].url).pathname).toBe('/api/reorgattack/transactions/ab%2Fcd%3Fe%23f');
    expect(calls[0].params.txid).toBe('ab/cd?e#f');
  });


  it.each([
    ['toggleConnection', (hook) => hook.toggleConnection(true)],
    ['sendRawTransaction', (hook) => hook.sendRawTransaction({ raw: f.RAW_TX, color: 'red' })],
    ['addTransaction', (hook) => hook.addTransaction({ txid: f.NEW_TXID, color: 'green' })],
    ['removeTransaction', (hook) => hook.removeTransaction(f.T.pending)],
  ])('%s re-reads the chain and the status once it succeeded', async (_, run) => {
    const seen = watchRequests();
    const { result } = renderAttackHook();
    await landed(result);
    await waitFor(() => expect(times(seen, `GET ${STATUS}`)).toBe(1));
    act(() => run(result.current));
    await waitFor(() => expect(times(seen, `GET ${CHAIN}`)).toBe(2));
    await waitFor(() => expect(times(seen, `GET ${STATUS}`)).toBe(2));
  });


  it('re-reads nothing after a refused action', async () => {
    given.json('get', '/api/reorgattack/connect', { message: 'nope', success: false });
    const seen = watchRequests();
    const { result } = renderAttackHook();
    await landed(result);
    await waitFor(() => expect(times(seen, `GET ${STATUS}`)).toBe(1));
    act(() => result.current.toggleConnection(true));
    await waitFor(() => expect(seen).toContain('GET /api/reorgattack/connect'));
    await settle(100);
    expect(times(seen, `GET ${CHAIN}`)).toBe(1);
    expect(times(seen, `GET ${STATUS}`)).toBe(1);
  });


  it('is busy while an action is out, and idle once it is answered', async () => {
    let answer;
    server.use(http.get(url('/api/reorgattack/connect'), async () => {
      await new Promise((resolve) => { answer = resolve; });
      return HttpResponse.json(f.connectAnswer());
    }));
    const { result } = renderAttackHook();
    await landed(result);
    expect(result.current.isMutating).toBe(false);

    act(() => result.current.toggleConnection(true));
    await waitFor(() => expect(result.current.isMutating).toBe(true));
    await waitFor(() => expect(answer).toBeTypeOf('function'));
    answer();
    await waitFor(() => expect(result.current.isMutating).toBe(false));
  });
});
