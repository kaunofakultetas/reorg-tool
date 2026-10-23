// -----------------------------------------------------------
//  [*] ReorgAttack — useReorgAttack
//
//  The whole backend side of the 51% attack tool: two polling
//  queries (the chain itself and the node status) plus the
//  four actions the control panel triggers.
//
//  Every action is a mutation that INVALIDATES the queries on
//  success instead of guessing a refresh delay — the previous
//  implementation re-fetched via setTimeout(…, 1000/2000) and
//  optimistically flipped the connection switch by hand, which
//  drifted from the backend whenever a call was slow or
//  failed. Here the switch is derived from the status query,
//  so it can only ever show what the backend reported — and
//  says the status is unknown until the backend has told.
//
//  The backend answers { success, message, ... }, and sends
//  its refusals with an error status as well: either way the
//  message becomes the thrown Error's, so failures land in the
//  mutations' onError and reach the student as a toast with
//  the backend's own reason.
//
//  The chain is asked for the blocks mined since the start of
//  the student's own day: the browser's midnight, worked out
//  anew for every poll — the backend cannot know the
//  student's timezone, and the view has to roll over when
//  their day does, not when UTC's does.
//
//  The chain payload is the one place the backend's data
//  enters the page, so its lists are made safe here: anything
//  that is not a list reads as an empty one, and a tracked
//  transaction without a txid is left out.
//
//  Split into (root export last):
//
//    API_BASE          — the blueprint's URL prefix
//    REFRESH_MS        — how often both queries repoll
//    TOAST_SUCCESS_MS / TOAST_ERROR_MS — toast lifetimes
//    unwrap            — { success, … } → payload or throw
//    asList / isTracked — the payload's lists made safe
//    call              — one request, its refusal's reason kept
//    useReorgAttack    — queries + mutations (default export)
// -----------------------------------------------------------

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import axios from 'axios';

import { startOfLocalDay } from './lib/blockTime';


// The reorg-attack blueprint's URL prefix
const API_BASE = '/api/reorgattack';


// Both queries repoll at this cadence — the nodes mine in the
// background, so the view would otherwise go stale
const REFRESH_MS = 10000;


// A confirmation can flash by; a failure carries the reason
// the student needs to read, so it stays up much longer
const TOAST_SUCCESS_MS = 3000;
const TOAST_ERROR_MS = 8000;


// The backend's envelope: { success, message, ...payload }.
// A false success carries the reason in message — raise it so
// TanStack routes it to onError / isError like any failure.
const unwrap = (payload) => {
  if (!payload?.success) {
    throw new Error(payload?.message || 'Operacija nepavyko');
  }
  return payload;
};


// A list as it came, or an empty one for anything else
const asList = (value) => (Array.isArray(value) ? value : []);

// A tracked transaction the panel can show and untrack — one
// without a txid could be neither
const isTracked = (tx) => typeof tx?.txid === 'string' && tx.txid !== '';







// -----------------------------------------------------------
// call
// -----------------------------------------------------------
//
// Runs one request and hands back the unwrapped envelope.
// axios rejects every answer with an error status before its
// body could be read, so a refusal the backend sent that way
// (a 404 for an unknown txid, a 500 naming the node that did
// not answer) is turned back into an Error carrying the
// backend's own message; a failure without one — no answer at
// all, an HTML error page — keeps axios' own.
//
// Used by:
//   - useReorgAttack (below) — every query and mutation
// -----------------------------------------------------------

async function call(request) {
  try {
    return unwrap((await request()).data);
  } catch (error) {
    const message = error.response?.data?.message;
    if (typeof message === 'string' && message) {
      throw new Error(message);
    }
    throw error;
  }
}







// -----------------------------------------------------------
// useReorgAttack (default export)
// -----------------------------------------------------------
//
// Hands the page everything it shows and does: the chain —
// its blocks, both tips, the tracked transactions — the
// private node's status with whether it is attached, and
// whether that status has been read at all (with the read's
// error while it has not), the first load's pending and error
// state, the four actions, and whether any of them is under
// way. Every action reports its outcome as a react-hot-toast
// bubble; the page mounts the <Toaster> they land in.
//
// Used by:
//   - Page.jsx — the single instance behind the whole page
// -----------------------------------------------------------

export default function useReorgAttack() {

  const queryClient = useQueryClient();


  // The chain: blocks, the two tips and the tracked
  // transactions — one payload, one poll, since the student's
  // midnight as it stands at the moment of each poll
  const blockchain = useQuery({
    queryKey: ['reorg-blockchain'],
    queryFn: async () => (await call(() => axios.get(`${API_BASE}/blockchain/data`, {
      params: { since: startOfLocalDay() },
    }))).data,
    refetchInterval: REFRESH_MS,
  });


  // Node status: peer count, both tips, and whether the
  // private node is currently attached to the public network
  const status = useQuery({
    queryKey: ['reorg-status'],
    queryFn: async () => (await call(() => axios.get(`${API_BASE}/status`))).status ?? {},
    refetchInterval: REFRESH_MS,
  });


  // Every action refreshes both queries on success — the
  // backend is the only source of truth for what actually
  // happened, so nothing is updated optimistically
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['reorg-blockchain'] });
    queryClient.invalidateQueries({ queryKey: ['reorg-status'] });
  };

  // The failure line, then the backend's reason underneath it
  const reportFailure = (headline) => (error) => {
    toast.error(<b>{headline}<br />{error.message}</b>, { duration: TOAST_ERROR_MS });
  };


  // Attach/detach the private node from the public network —
  // the actual 51% attack switch
  const connection = useMutation({
    mutationFn: (connected) =>
      call(() => axios.get(`${API_BASE}/${connected ? 'connect' : 'disconnect'}`)),
    onSuccess: (_data, connected) => {
      toast.success(
        <b>{connected ? 'Prisijungta prie viešo tinklo' : 'Atjungta nuo viešo tinklo'}</b>,
        { duration: TOAST_SUCCESS_MS }
      );
      invalidate();
    },
    onError: reportFailure('Prisijungimo operacija nepavyko'),
  });


  // Broadcast a raw HEX transaction into the private node
  const rawTransaction = useMutation({
    mutationFn: ({ raw, color }) =>
      call(() => axios.post(`${API_BASE}/transactions/send`, {
        raw_transaction: raw,
        color,
      })),
    onSuccess: (data) => {
      toast.success(
        <b>Transakcija sėkmingai išsiųsta!<br />TXID: {data.txid}</b>,
        { duration: TOAST_SUCCESS_MS }
      );
      invalidate();
    },
    onError: reportFailure('Nepavyko išsiųsti transakcijos'),
  });


  // Start colour-tracking a txid across both chains
  const trackTransaction = useMutation({
    mutationFn: ({ txid, color }) =>
      call(() => axios.post(`${API_BASE}/transactions`, { txid, color })),
    onSuccess: () => {
      toast.success(<b>Transakcija pridėta į sekamų sąrašą</b>, { duration: TOAST_SUCCESS_MS });
      invalidate();
    },
    onError: reportFailure('Nepavyko pridėti transakcijos'),
  });


  // The txid goes into the URL as ONE path segment, whatever
  // characters it holds
  const untrackTransaction = useMutation({
    mutationFn: (txid) =>
      call(() => axios.delete(`${API_BASE}/transactions/${encodeURIComponent(txid)}`)),
    onSuccess: () => {
      toast.success(<b>Transakcija pašalinta iš sekamų sąrašo</b>, { duration: TOAST_SUCCESS_MS });
      invalidate();
    },
    onError: reportFailure('Nepavyko pašalinti transakcijos'),
  });


  // The chain payload's parts, made safe once per answer — the
  // diagram memoises on them, so they keep their identity
  // between renders
  const chain = blockchain.data;
  const chainBlocks = useMemo(() => asList(chain?.chainBlocks), [chain]);
  const chainTips = useMemo(() => chain?.chainTips ?? { public: null, private: null }, [chain]);
  const transactions = useMemo(() => asList(chain?.transactions).filter(isTracked), [chain]);


  return {
    chainBlocks,
    chainTips,
    transactions,

    networkStatus: status.data ?? {},
    // Derived, never stored: the switch shows the backend's
    // reality, so a failed toggle needs no manual revert —
    // and until the status has been read (statusKnown) there
    // is no reality to show, only the read's failure, if any
    isConnectedToPublic: Boolean(status.data?.isConnectedToPublic),
    statusKnown: status.data !== undefined,
    statusError: status.data === undefined ? status.error : null,

    isPending: blockchain.isPending,
    isError: blockchain.isError,
    error: blockchain.error,

    toggleConnection: connection.mutate,
    sendRawTransaction: rawTransaction.mutate,
    addTransaction: trackTransaction.mutate,
    removeTransaction: untrackTransaction.mutate,
    isMutating: connection.isPending || rawTransaction.isPending
      || trackTransaction.isPending || untrackTransaction.isPending,
  };
}
