// -----------------------------------------------------------
//  [*] ReorgAttack — ReactFlowBlockchain
//
//  The fork diagram: the two competing chains drawn as a
//  ReactFlow graph, newest blocks on top, every fork on a
//  vertical lane of its own beside the centre one —
//  blockchainFlow.js decides which goes where. Clicking a
//  block opens its details modal.
//
//  Render-only by design — the node/edge geometry comes from
//  blockchainFlow.js and the blocks come from the page's
//  query. Nodes are fixed in place (no dragging, no
//  connecting), so ReactFlow's own node state is deliberately
//  NOT used: the memoised arrays are passed straight in and
//  there is nothing to keep in sync.
//
//  The camera is aimed once, when the diagram first draws:
//  the centre lane down the middle of the frame, the newest
//  blocks on top. The centre lane never moves in the diagram
//  — forks come and go beside it, and the chain both nodes
//  agree on takes it over when an attack resolves — so it
//  stays in the middle as the attack plays out.
//
//  Split into (root component last):
//
//    NODE_TYPES          — ReactFlow's block → BlockNode map
//    FIT_VIEW_OPTIONS    — instant fit, no animation
//    TOP_MARGIN          — the newest row's gap to the top
//    ReactFlowBlockchain — the diagram (default export)
// -----------------------------------------------------------

import { useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';

import { Box, Typography } from '@mui/material';

import BlockNode from './BlockNode';
import BlockDetailsModal from './BlockDetailsModal';
import buildBlockchainFlow, { axisCamera } from './blockchainFlow';


const NODE_TYPES = { block: BlockNode };


// The first frame fits the whole chain without animating;
// once the cards are measured, onInit aims the camera at the
// centre lane (axisCamera) with the same padding and zoom
// limits
const FIT_VIEW_OPTIONS = {
  padding: 0.1,
  includeHiddenNodes: false,
  minZoom: 0.6,
  maxZoom: 1.0,
  duration: 0,
};

// The newest blocks — the interesting ones — sit at the top
// of the diagram, so the camera starts there, this far below
// the frame's edge (px)
const TOP_MARGIN = 50;







// -----------------------------------------------------------
// ReactFlowBlockchain (default export)
// -----------------------------------------------------------
//
// Draws the blocks it is handed, with both tips and the
// tracked transactions, as the fork diagram — or says the
// chain is empty — and keeps the block a click opened in the
// details modal until it is closed.
//
// Used by:
//   - Page.jsx — the page's main visualization
// -----------------------------------------------------------

export default function ReactFlowBlockchain({ chainBlocks = [], chainTips = {}, transactions = [] }) {

  const [selectedBlock, setSelectedBlock] = useState(null);

  // The box the diagram is drawn in — the camera centres the
  // axis in its width
  const frameRef = useRef(null);

  const { nodes, edges } = useMemo(
    () => buildBlockchainFlow(chainBlocks, {
      chainTips,
      transactions,
      onBlockClick: setSelectedBlock,
    }),
    [chainBlocks, chainTips, transactions]
  );


  return (
    <Box sx={{ width: '100%', border: '1px solid #1976d2', borderRadius: 1 }}>

      <Box ref={frameRef} sx={{ height: 'calc(100vh - 215px)', bgcolor: '#f5f5f5' }}>
        {nodes.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            onInit={(instance) => {
              // Once the cards are measured: the centre lane
              // down the middle of the frame, the newest blocks
              // on top — or, while the frame has no width yet,
              // fitView's framing pulled up to the top
              setTimeout(() => {
                const viewport = instance.getViewport();
                instance.setViewport(
                  axisCamera(instance.getNodes(), frameRef.current?.clientWidth, { ...FIT_VIEW_OPTIONS, top: TOP_MARGIN })
                    ?? { x: viewport.x, y: TOP_MARGIN, zoom: viewport.zoom }
                );
              }, 100);
            }}
            minZoom={0.02}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
          >
            <Background />
            <Controls />
          </ReactFlow>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="h6" color="text.secondary">
              Blokų grandinė tuščia
            </Typography>
          </Box>
        )}
      </Box>

      <BlockDetailsModal
        open={Boolean(selectedBlock)}
        onClose={() => setSelectedBlock(null)}
        blockData={selectedBlock}
        transactions={selectedBlock?.transactions ?? []}
        isAttacker={selectedBlock?.isAttacker ?? false}
      />
    </Box>
  );
}
