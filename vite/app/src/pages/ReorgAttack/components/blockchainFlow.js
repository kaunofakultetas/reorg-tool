// -----------------------------------------------------------
//  [*] ReorgAttack — blockchain flow builders
//
//  Pure functions turning the backend's flat block list into
//  the ReactFlow nodes and edges of the fork diagram. No
//  React, no ReactFlow imports — just data in, data out, so
//  the visual component stays render-only.
//
//  The layout tells the attack's story in vertical lanes:
//  newest height on top, each older height one row below, and
//  every branch on a lane of its own, so a fork stays one
//  straight line however long it grows. Which branch goes
//  where follows the two nodes' tips. While the tips differ,
//  the history both nodes hold keeps the centre lane and each
//  node's own blocks run beside it from the very first one —
//  the public node's on the left, the private node's on the
//  right — and a node with no blocks of its own yet leaves
//  its lane empty, so nothing moves when its fork appears.
//  Once both nodes are on the same tip, their chain is the
//  centre lane, and every other fork moves out beside it:
//  honest ones to the left, the attacker's to the right. The
//  winning chain is simply the one with the most accumulated
//  work — the number the whole teaching tool is about — and
//  while two forks are level, both are winning.
//
//  Split into (root export last):
//
//    PUBLIC_COINBASE_MARK   — how an honest block is spotted
//    LEVEL_HEIGHT / FORK_SPACING / LANE_WIDTH — layout geometry
//    CARD_WIDTH             — a card's width before measuring
//    isAttackerBlock        — coinbase test
//    isDrawable             — a block the diagram can place
//    oldestFirst            — the order branches are packed in
//    rangeOf                — the heights a set of blocks spans
//    groupByHeight          — height → blocks at that height
//    findWinningBlockHashes — most accumulated work wins
//    chainBelow             — a tip's chain, as far as in view
//    splitByTips            — the centre and the nodes' forks
//    looseBranches          — every other block, as branches
//    assignLanes            — block → lane, no card overlapping
//    buildNodes             — the positioned block nodes
//    buildEdges             — child → parent links
//    axisCamera             — the opening view, axis centred
//    buildBlockchainFlow    — the three combined (default)
// -----------------------------------------------------------


// The public (honest) miner stamps its coinbase — that mark
// is the only thing separating honest blocks from attacker
// ones in the payload; anything without it counts as the
// attacker's
const PUBLIC_COINBASE_MARK = 'Public Miner';

// Vertical distance between two heights, and the horizontal
// distance two cards at one height need between them (px)
const LEVEL_HEIGHT = 200;
const FORK_SPACING = 500;

// Lanes sit half that apart: the two forks of an attack fit
// on the centre lane's two neighbours, which nothing in the
// centre shares a height with, while a fork beside a chain
// that does keeps one empty lane between them
const LANE_WIDTH = FORK_SPACING / 2;

// A block card's width (BlockNode's minWidth) — where the
// centre lane's axis runs while the cards are unmeasured
const CARD_WIDTH = 450;


// Honest only with the mark in a coinbase that is text — a
// coinbase missing or of any other type is the attacker's
export const isAttackerBlock = (block) => !(typeof block?.coinbase === 'string' && block.coinbase.includes(PUBLIC_COINBASE_MARK));

// A block without a hash can be neither a node nor an edge's
// end — the diagram leaves it out instead of breaking on it
export const isDrawable = (block) => typeof block?.hash === 'string' && block.hash !== '';

// Lower heights first, the hash breaking ties — the one order
// the lanes are handed out in, whatever order the payload had
const oldestFirst = (a, b) => (Number(a.height) || 0) - (Number(b.height) || 0) || a.hash.localeCompare(b.hash);







// -----------------------------------------------------------
// rangeOf
// -----------------------------------------------------------
//
// The lowest and the highest height among some blocks — the
// rows a lane is taken on. Counted in a loop rather than
// spread into Math.min: a day's chain can hold more blocks
// than a call takes arguments.
//
// Used by:
//   - looseBranches, assignLanes (below)
// -----------------------------------------------------------

const rangeOf = (blocks) => {
  let lo = Infinity;
  let hi = -Infinity;

  blocks.forEach((block) => {
    const height = Number(block.height);
    if (height < lo) lo = height;
    if (height > hi) hi = height;
  });

  return { lo, hi };
};







// -----------------------------------------------------------
// groupByHeight
// -----------------------------------------------------------
//
// height → the blocks mined at it. More than one entry means
// a fork at that height; the rows of the diagram are these
// heights, newest on top.
//
// Used by:
//   - buildNodes (below)
// -----------------------------------------------------------

export const groupByHeight = (blocks) => {
  const byHeight = new Map();

  blocks.forEach((block) => {
    const atHeight = byHeight.get(block.height) ?? [];
    atHeight.push(block);
    byHeight.set(block.height, atHeight);
  });

  return byHeight;
};







// -----------------------------------------------------------
// findWinningBlockHashes
// -----------------------------------------------------------
//
// The hashes of the blocks with the most accumulated work —
// the consensus rule the attack exploits. Two forks that have
// done the same work, as forks of the same length usually
// have, tie on exactly the same number, and then both their
// tips win: the network could still go either way. Work that
// cannot be read as a number counts as none. An empty chain
// has no winner.
//
// Used by:
//   - buildBlockchainFlow (below) — flags the winning blocks
// -----------------------------------------------------------

export const findWinningBlockHashes = (blocks) => {
  let winners = new Set();
  let bestWork = -1;

  blocks.forEach((block) => {
    const work = Number(block.chainWork) || 0;
    if (work > bestWork) {
      bestWork = work;
      winners = new Set([block.hash]);
    } else if (work === bestWork) {
      winners.add(block.hash);
    }
  });

  return winners;
};







// -----------------------------------------------------------
// chainBelow
// -----------------------------------------------------------
//
// The hashes of one block and of its parents down through
// the view, until a parent is missing: a node's chain as far
// as the diagram sees it, walked from the node's tip — none
// at all for a tip not in view. A block met twice ends the
// walk, so a payload whose blocks point at themselves or in
// a circle cannot hang the page.
//
// Used by:
//   - splitByTips (below)
// -----------------------------------------------------------

const chainBelow = (hash, byHash) => {
  const chain = new Set();
  let block = byHash.get(hash);

  while (block && !chain.has(block.hash)) {
    chain.add(block.hash);
    block = byHash.get(block.prevHash);
  }

  return chain;
};







// -----------------------------------------------------------
// splitByTips
// -----------------------------------------------------------
//
// What the two nodes' chains decide: the blocks of the centre
// lane, and each node's own fork. Whenever the two tips
// differ, the blocks both chains hold are the history the
// nodes share, for the centre, and the rest of each chain is
// that node's fork — the public node's for the left, the
// private node's for the right. A node merely behind the
// other has no fork of its own: its side stays empty, held
// for the blocks it mines next. On one tip there is one
// chain, the centre, with no fork beside it; so is a lone
// chain when only one tip is in view. With no tip in view
// nothing is decided here.
//
// Used by:
//   - assignLanes (below)
// -----------------------------------------------------------

const splitByTips = (byHash, chainTips) => {

  const publicChain = chainBelow(chainTips?.public, byHash);
  const privateChain = chainBelow(chainTips?.private, byHash);


  if (publicChain.size === 0 || privateChain.size === 0 || chainTips.public === chainTips.private) {
    // One chain: both tips on one block, or only one in view
    return { centre: privateChain.size ? privateChain : publicChain, left: new Set(), right: new Set() };
  }

  return {
    centre: new Set([...publicChain].filter((hash) => privateChain.has(hash))),
    left: new Set([...publicChain].filter((hash) => !privateChain.has(hash))),
    right: new Set([...privateChain].filter((hash) => !publicChain.has(hash))),
  };
};







// -----------------------------------------------------------
// looseBranches
// -----------------------------------------------------------
//
// The blocks the tips left unplaced — forks neither node is
// on any more, the older part of a chain cut off by a gap in
// the stored blocks — cut into branches. A branch climbs
// from its first block for as long as each block has exactly
// one child among them; where one has more, every child
// starts a branch of its own. Each branch carries its blocks,
// the heights it spans, its side — left when its first block
// is honest, right when it is the attacker's — and whether
// its first block hangs off a block in view at all. Oldest
// branches come first.
//
// Used by:
//   - assignLanes (below)
// -----------------------------------------------------------

const looseBranches = (blocks, byHash) => {

  const childCount = new Map();
  blocks.forEach((block) => childCount.set(block.prevHash, (childCount.get(block.prevHash) ?? 0) + 1));


  const branchOf = new Map();
  const branches = [];

  [...blocks].sort(oldestFirst).forEach((block) => {
    const parent = block.prevHash === block.hash ? undefined : byHash.get(block.prevHash);
    let branch = parent && branchOf.get(parent.hash);

    if (branch && branch.blocks.at(-1) === parent && childCount.get(parent.hash) === 1) {
      branch.blocks.push(block);
    } else {
      branch = { blocks: [block], side: isAttackerBlock(block) ? 1 : -1, attached: Boolean(parent) };
      branches.push(branch);
    }
    branchOf.set(block.hash, branch);
  });


  return branches.map((branch) => ({ ...branch, ...rangeOf(branch.blocks) }));
};







// -----------------------------------------------------------
// assignLanes
// -----------------------------------------------------------
//
// The lane of every block, by hash: 0 is the centre,
// negative lanes run left and positive ones right. The tips
// hand out the centre and the two lanes beside it
// (splitByTips); every other branch, oldest first, takes the
// nearest lane on its own side where no card shares a height
// with a card one lane away or on the same lane. A branch
// hanging off nothing in view — the chain's older part beyond
// a gap, or the whole chain when no tip is in view — tries
// the centre first, unless another such branch competes for
// the same heights: then each goes to its side, honest left
// and the attacker's right.
//
// Used by:
//   - buildNodes (below)
// -----------------------------------------------------------

export const assignLanes = (blocks, chainTips) => {

  // The first of any blocks sharing a hash speaks for all
  const byHash = new Map();
  blocks.forEach((block) => {
    if (!byHash.has(block.hash)) byHash.set(block.hash, block);
  });


  const lanes = new Map();
  const taken = [];

  const isFree = (lane, { lo, hi }) => taken.every((other) => (
    Math.abs(other.lane - lane) > 1 || other.hi < lo || hi < other.lo
  ));

  const claim = (lane, hashes) => {
    hashes.forEach((hash) => lanes.set(hash, lane));
    taken.push({ lane, ...rangeOf([...hashes].map((hash) => byHash.get(hash))) });
  };


  const { centre, left, right } = splitByTips(byHash, chainTips);
  if (centre.size) claim(0, centre);
  if (left.size) claim(-1, left);
  if (right.size) claim(1, right);


  const branches = looseBranches([...byHash.values()].filter((block) => !lanes.has(block.hash)), byHash);

  branches.forEach((branch) => {
    const contested = branches.some((other) => (
      other !== branch && !other.attached && other.lo <= branch.hi && branch.lo <= other.hi
    ));
    let lane = !branch.attached && !contested && isFree(0, branch) ? 0 : branch.side;
    while (!isFree(lane, branch)) lane += branch.side;
    claim(lane, branch.blocks.map((block) => block.hash));
  });


  return lanes;
};







// -----------------------------------------------------------
// buildNodes
// -----------------------------------------------------------
//
// One positioned ReactFlow node per block. Newest height sits
// at y=0 and each older height a LEVEL_HEIGHT lower — a gap
// in the heights leaves no empty row — and each block stands
// on its lane (assignLanes), LANE_WIDTH apart, so a fork
// reads as branches running side by side.
//
// Used by:
//   - buildBlockchainFlow (below)
// -----------------------------------------------------------

export const buildNodes = (blocks, { chainTips, transactions, winningHashes, onBlockClick }) => {

  const lanes = assignLanes(blocks, chainTips);
  const heights = [...groupByHeight(blocks).keys()].sort((a, b) => b - a);
  const rowOf = new Map(heights.map((height, row) => [height, row]));


  return blocks.map((block) => ({
    id: block.hash,
    type: 'block',
    position: {
      x: lanes.get(block.hash) * LANE_WIDTH,
      y: rowOf.get(block.height) * LEVEL_HEIGHT,
    },
    draggable: false,
    selectable: true,
    data: {
      block,
      transactions: transactions.filter((tx) => Array.isArray(tx?.blocks) && tx.blocks.includes(block.hash)),
      isPublicTip: block.hash === chainTips?.public,
      isPrivateTip: block.hash === chainTips?.private,
      isAttacker: isAttackerBlock(block),
      isWinningChain: Boolean(winningHashes?.has(block.hash)),
      onBlockClick,
    },
  }));
};







// -----------------------------------------------------------
// buildEdges
// -----------------------------------------------------------
//
// One edge per block that has its parent in view, drawn from
// the newer block DOWN to the older one — red along the
// attacker's branch, blue along the honest one. Every edge is
// a plain solid line: running dashes on the edges out of the
// two tips looked to the students as if they meant something,
// and they meant nothing.
//
// Used by:
//   - buildBlockchainFlow (below)
// -----------------------------------------------------------

export const buildEdges = (blocks) => {
  const knownHashes = new Set(blocks.map((block) => block.hash));

  return blocks
    .filter((block) => block.prevHash && knownHashes.has(block.prevHash))
    .map((block) => ({
      id: `${block.hash}-to-${block.prevHash}`,
      source: block.hash,
      target: block.prevHash,
      sourceHandle: 'bottom',
      targetHandle: 'top',
      style: {
        stroke: isAttackerBlock(block) ? '#f44336' : '#2196f3',
        strokeWidth: 3,
      },
    }));
};







// -----------------------------------------------------------
// axisCamera
// -----------------------------------------------------------
//
// The diagram's opening view, as a ReactFlow viewport: the
// centre lane's axis down the very middle of the frame, the
// zoom just wide enough for the lanes furthest out — measured
// on whichever side reaches further, as if the other reached
// as far — kept within the zoom limits handed in, and the
// newest row a top margin below the frame's edge. The cards'
// measured widths are used where ReactFlow has them. Nothing
// for a frame whose width is not known yet, or for an empty
// diagram.
//
// Used by:
//   - ReactFlowBlockchain.jsx — once the cards are measured
// -----------------------------------------------------------

export const axisCamera = (nodes, frameWidth, { padding, minZoom, maxZoom, top }) => {

  if (!(frameWidth > 0) || !nodes.length) return null;

  // The centre lane's cards stand at x=0, so the axis runs
  // half a card in
  const widthOf = (node) => node.width || CARD_WIDTH;
  let widest = 0;
  nodes.forEach((node) => { widest = Math.max(widest, widthOf(node)); });
  const axis = widest / 2;

  let reach = 0;
  nodes.forEach((node) => {
    reach = Math.max(reach, Math.abs(node.position.x - axis), Math.abs(node.position.x + widthOf(node) - axis));
  });


  const zoom = Math.min(maxZoom, Math.max(minZoom, frameWidth / (2 * reach * (1 + padding))));
  return { x: frameWidth / 2 - axis * zoom, y: top, zoom };
};







// -----------------------------------------------------------
// buildBlockchainFlow (default export)
// -----------------------------------------------------------
//
// The whole diagram from the payload: the blocks it can
// place, newest first, as nodes on their lanes, the edges
// between them, and the winning blocks flagged — decided over
// every block in view. An empty chain makes an empty diagram.
//
// Used by:
//   - ReactFlowBlockchain.jsx — inside one useMemo
// -----------------------------------------------------------

export default function buildBlockchainFlow(chainBlocks, { chainTips, transactions, onBlockClick }) {

  // A new list, never the caller's sorted in place —
  // chainBlocks belongs to the query cache, and sorting it
  // would reorder the data other consumers see
  const blocks = chainBlocks.filter(isDrawable).sort((a, b) => b.height - a.height);

  if (!blocks.length) {
    return { nodes: [], edges: [] };
  }

  return {
    nodes: buildNodes(blocks, {
      chainTips,
      transactions,
      winningHashes: findWinningBlockHashes(blocks),
      onBlockClick,
    }),
    edges: buildEdges(blocks),
  };
}
