// -----------------------------------------------------------
//  [*] Test support — default handlers for every UI endpoint
//
//  The happy path of the reorg-attack backend as the SPA sees
//  it: one msw handler per endpoint the code under src/ calls,
//  answering the fixtures. The handlers behave like the
//  backend where a page depends on it: a send without a raw
//  transaction or a track without a txid is the backend's 400
//  refusal with its message, a tracked txid is answered 201
//  and echoed back with the colour it was sent with.
//
//  Keep this in step with the SPA: the structural test
//  (tests/core/structural.test.js) extracts every axios call
//  from src/ and fails when one has no handler here — the
//  double must never fall behind the frontend it stands in
//  for.
//
//  Used by:
//    - server.js — the msw server starts from these handlers
// -----------------------------------------------------------

import { http, HttpResponse } from 'msw';
import * as f from './fixtures';
import { TEST_ORIGIN } from '../location';


const abs = (path) => `${TEST_ORIGIN}/api/reorgattack${path}`;
const json = (body) => () => HttpResponse.json(body());
const refuse = (message, status = 400) => HttpResponse.json({ message, success: false }, { status });

// The JSON body a POST carried — null for none or a broken one,
// which the backend refuses the same way
const sentJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};







// -----------------------------------------------------------
// defaultHandlers
// -----------------------------------------------------------
//
// In the order of the backend's routes.py: the attack switch,
// the raw-transaction send, the chain view, the tracker, the
// status.
//
// Used by:
//   - server.js
//   - core/structural.test.js — every call of the SPA has
//     one, and none answers a call the SPA never makes
// -----------------------------------------------------------

export const defaultHandlers = [

  // The attack switch
  http.get(abs('/connect'), json(f.connectAnswer)),
  http.get(abs('/disconnect'), json(f.disconnectAnswer)),

  // A raw transaction into the private node
  http.post(abs('/transactions/send'), async ({ request }) => {
    const sent = await sentJson(request);
    if (!sent || !('raw_transaction' in sent)) return refuse('Missing raw_transaction in request body');
    return HttpResponse.json(f.sendAnswer());
  }),

  // The chain view — blocks, both tips, the tracked list
  http.get(abs('/blockchain/data'), json(f.blockchainData)),

  // The tracker
  http.post(abs('/transactions'), async ({ request }) => {
    const sent = await sentJson(request);
    if (!sent || !('txid' in sent)) return refuse('Missing txid in request body');
    return HttpResponse.json(f.trackAnswer(sent.txid, sent.color ?? 'blue'), { status: 201 });
  }),
  http.delete(abs('/transactions/:txid'), json(f.untrackAnswer)),

  // The private node's connection state
  http.get(abs('/status'), json(f.statusAnswer)),
];
