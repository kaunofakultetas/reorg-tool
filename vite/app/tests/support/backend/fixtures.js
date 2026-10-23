// -----------------------------------------------------------
//  [*] Test support — canonical backend answers
//
//  One realistic body per endpoint the SPA calls, in the exact
//  shape the backend answers with. The story they tell is the
//  middle of an attack: the private node was detached after
//  block 6400, the public network mined two more blocks
//  (6401–6402), the students' private node mined three
//  (6401–6403) — so the private fork has the most work and
//  will win the moment it is re-attached.
//
//  The shared history and the public branch are the live
//  backend's own blocks (heights 6398–6402 of the KNF Coin
//  chain, as /blockchain/data served them); the private
//  branch, the txids and the raw transaction are made up in
//  the same shapes. The answers agree with each other: the
//  status names the same two tips the chain payload does, and
//  every tracked transaction's blocks are blocks of the
//  chain. The action answers (connect, send, track …) follow
//  the backend code's return statements.
//
//  Every block's time is its header's timestamp: the scene
//  plays out between 02:12 and 02:21 UTC on 19 October 2026 —
//  between 05:12 and 05:21 in Vilnius, the timezone the suite
//  runs in (vite.config.js).
//
//  handlers.js serves these by default; a test that needs a
//  variation builds its own from the pieces exported here
//  (chainData, statusAnswer) rather than changing a fixture
//  other tests share.
//
//  Used by:
//    - handlers.js — the default handlers
//    - page and component tests — the values they assert on
// -----------------------------------------------------------

// The coinbase messages. The public network's miner stamps
// PUBLIC_MINER — the one mark blockchainFlow.js counts as
// honest; every other coinbase is the attacker's: a student's
// named attack, or the stack's own private stratum (its
// COINBASE_MESSAGE in docker-compose.yml)
export const PUBLIC_MINER = '/Public Miner/';
export const ATTACKER = '/Vardenis Pavardenis ATAKA (2026-10-15)/';
export const STRATUM = '/VU KNF/';







// -----------------------------------------------------------
// The blocks
// -----------------------------------------------------------
//
// B holds every block of the chain payload by name: s* the
// history both nodes share, u* the public branch, p* the
// private (attacker) branch, each with its height in the name.
// The oldest block's parent (6397) is not in the payload — as
// with the live backend, whose window always starts somewhere.
// -----------------------------------------------------------

export const B = {
  s6398: { chainWork: 47.5409801084977, coinbase: PUBLIC_MINER, hash: '14d49983440ca4e971421436a49b804fcde683782077cdfe1f2e930d3e8d46fd', height: 6398, prevHash: '9b673c051d4d6f8ec1eed78cf39d2756e737076ea0b7a18c1f4c07f8dd6a6585', scryptHash: '000000000ae0930efaa2d5d3857d77fb315ff86d658df946dfeb1de8310950ac', timestamp: 1792375967 },
  s6399: { chainWork: 47.5414403225712, coinbase: PUBLIC_MINER, hash: '3dbfb7d433415a12a5f53e2ff4fcb0c348178563521ebeca7bdb1e372380c4f3', height: 6399, prevHash: '14d49983440ca4e971421436a49b804fcde683782077cdfe1f2e930d3e8d46fd', scryptHash: '0000000005c443d41c2c2e94f5f736e1c4f96c8850912a27346725aa2c7a9755', timestamp: 1792375981 },
  s6400: { chainWork: 47.541900389885, coinbase: PUBLIC_MINER, hash: '14c04aaa31ab52a83fc2e3ede911ab6e554f14b4d8825a1393e4abee284e60bf', height: 6400, prevHash: '3dbfb7d433415a12a5f53e2ff4fcb0c348178563521ebeca7bdb1e372380c4f3', scryptHash: '00000000093809cd8df0ab7e9e609b37ab845257fb3be54dcb195c54b029add4', timestamp: 1792376002 },

  u6401: { chainWork: 47.5423603105327, coinbase: PUBLIC_MINER, hash: '0385c335b4a3418ab0ec4d2f037c5d08c894e346421e673bc3044c50019f7673', height: 6401, prevHash: '14c04aaa31ab52a83fc2e3ede911ab6e554f14b4d8825a1393e4abee284e60bf', scryptHash: '0000000007be1d0e24a41db89d60806e06834112bacb409c9f21360e618a1970', timestamp: 1792376128 },
  u6402: { chainWork: 47.5428200846078, coinbase: PUBLIC_MINER, hash: 'f18c0b6876b46c84853f04b68bbaa9fc488df8d60888f457d180fe85d6b06811', height: 6402, prevHash: '0385c335b4a3418ab0ec4d2f037c5d08c894e346421e673bc3044c50019f7673', scryptHash: '000000000f2d042c9357a593aced2df216f6657ec06ebd4efb9676039359facb', timestamp: 1792376433 },

  p6401: { chainWork: 47.5423603105327, coinbase: ATTACKER, hash: '69c61dc2412746b412fe70898a7c271f78b4f9cace89f585c4b12ef450b46541', height: 6401, prevHash: '14c04aaa31ab52a83fc2e3ede911ab6e554f14b4d8825a1393e4abee284e60bf', scryptHash: '000000000141cf70ae800b02b44731ef391ace7bdb8342120a8694f6dade67ae', timestamp: 1792376050 },
  p6402: { chainWork: 47.5428200846078, coinbase: ATTACKER, hash: '01e28991140abfbbaccce06ac01c85eb5d7e6307dc9c0687bfd12178914a6d6d', height: 6402, prevHash: '69c61dc2412746b412fe70898a7c271f78b4f9cace89f585c4b12ef450b46541', scryptHash: '0000000097e2c7250637d7d29bdd3bf5c995853f79ebb7528b77542f1f222326', timestamp: 1792376205 },
  p6403: { chainWork: 47.5432797122037, coinbase: ATTACKER, hash: 'e1bdefb3bcc440a2d741a92e3ec10d8770db7195dea7d24ed131e394ab599e1c', height: 6403, prevHash: '01e28991140abfbbaccce06ac01c85eb5d7e6307dc9c0687bfd12178914a6d6d', scryptHash: '00000000b6996c51e475a30f937dde217a51804e11893720c2f2d9de84da4d8f', timestamp: 1792376342 },
};

// The payload's order: newest first, as the backend's
// json_group_array hands them out
export const CHAIN = [B.p6403, B.u6402, B.p6402, B.u6401, B.p6401, B.s6400, B.s6399, B.s6398];

export const TIPS = { private: B.p6403.hash, public: B.u6402.hash };







// -----------------------------------------------------------
// The tracked transactions
// -----------------------------------------------------------
//
// The double-spend the attack is about: the attacker paid a
// merchant on the public chain (spend, in u6401) and paid the
// same coins back to themself on the private fork (double, in
// p6402). One ordinary transaction made it into both branches
// (both), one is in no block yet (pending).
// -----------------------------------------------------------

export const T = {
  spend: '71b9c0a942dcb8cae972ea5bb1a3c6ef6955aecac5efac8dbb57813795189c51',
  double: '8807772a48607d85b05cbfa63c06b6c5a5e898db57ce4a268abbcbbaa6e8242c',
  both: '19cde07d6de7a4906dcdfeed0e475ebf860a1af2c42895c25d4b66237849b053',
  pending: 'ce5aafdca291ec613efe6c3ba56b2d0aa97ad1473b8bcd3e60c40625459f0af7',
};

export const TRACKED = [
  { blocks: [B.u6401.hash], color: 'red', txid: T.spend },
  { blocks: [B.p6402.hash], color: 'blue', txid: T.double },
  { blocks: [B.u6402.hash, B.p6401.hash], color: 'green', txid: T.both },
  { blocks: [], color: 'orange', txid: T.pending },
];

// What the student pastes into the raw-transaction form —
// shaped like a serialized segwit transaction (the frontend
// never parses it, it only forwards it) — and the txid the
// private node answers for it; a txid typed into the tracker
export const RAW_TX = '020000000001087a8321cc6c7dce3633660a699c37aafb410c4d49336b046802dd934cf8ab782e12a7d772d3f2bf92b7e959c88ad0467535d7d5a3a28ff0465b511fd8e4de6a43bd9ca2d02b2b3eb8f609f101da9164500720d3dcb29bbdd8';
export const SENT_TXID = 'd6aabb9f3330c65395e3652fc2a7c28dc5f7f59d77bd6612c651a39f1827fbc7';
export const NEW_TXID = 'c9ce37f41ec66b80c2322ec322d21995efdf5d4ef0971d90f061589cca391b95';







// -----------------------------------------------------------
// GET /api/reorgattack/blockchain/data
// -----------------------------------------------------------
//
// chainData builds the envelope around any blocks, tips and
// tracked list (a fresh copy every call); blockchainData is
// the default answer.
// -----------------------------------------------------------

export const chainData = ({ blocks = CHAIN, tips = TIPS, transactions = TRACKED } = {}) => structuredClone({
  data: { chainBlocks: blocks, chainTips: tips, transactions },
  success: true,
});

export const blockchainData = () => chainData();







// -----------------------------------------------------------
// GET /api/reorgattack/status
// -----------------------------------------------------------
//
// The private node's connection state with both tips and the
// stored-block summary. Detached by default (the attack is
// running): no peers. Attached, its one peer is the public
// node, as the status hands a peer out — its address and how
// it is connected, nothing else of getpeerinfo.
// -----------------------------------------------------------

export const PUBLIC_PEER = {
  addr: 'reorg-knfcoind-public:49333',
  connection_type: 'manual',
  inbound: false,
};

export const statusAnswer = ({ connected = false, privateTip, publicTip } = {}) => structuredClone({
  status: {
    blocksSummary: {
      by_coinbase: {
        [PUBLIC_MINER]: { count: 5, height_range: '6398-6402' },
        [ATTACKER]: { count: 3, height_range: '6401-6403' },
      },
      total: { count: 8, earliest_timestamp: B.s6398.timestamp, height_range: '6398-6403', latest_timestamp: B.u6402.timestamp },
    },
    connection: { peers: connected ? [PUBLIC_PEER] : [] },
    isConnectedToPublic: connected,
    privateTip: privateTip ?? { available: true, hash: B.p6403.hash, height: 6403 },
    publicTip: publicTip ?? { available: true, hash: B.u6402.hash, height: 6402 },
  },
  success: true,
});







// -----------------------------------------------------------
// The four actions
// -----------------------------------------------------------
//
// GET  connect / disconnect — the attack switch
// POST transactions/send    — a raw transaction into the
//                             private node (answers its txid)
// POST transactions         — start tracking a txid (the
//                             backend answers 201, echoing it)
// DELETE transactions/<id>  — stop tracking it
// -----------------------------------------------------------

export const connectAnswer = () => ({ message: 'Network activity enabled', result: true, success: true });

export const disconnectAnswer = () => ({ message: 'Network activity disabled and peers disconnected', success: true });

export const sendAnswer = (txid = SENT_TXID) => ({ message: 'Transaction sent successfully', success: true, txid });

export const trackAnswer = (txid = NEW_TXID, color = 'green') => ({ success: true, transaction: { blocks: [], color, txid } });

export const untrackAnswer = () => ({ message: 'Transaction tracking removed successfully', success: true });
