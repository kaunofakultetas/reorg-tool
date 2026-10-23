# Frontend tests

The vitest suite of the 51% attack tool's SPA: the page, its components
and its hook rendered in jsdom against a fake backend (msw), with no real
backend, fullnode, browser or network anywhere.

## Running

```sh
../runTests.sh                      # the whole suite, in a throwaway container
../runTests.sh tests/pages          # a folder, a file, or -t "test name"
```

`runTests.sh` builds the builder stage of the production Dockerfile
(so `npm run build` must pass first) and runs vitest in it — the host
needs no node. While developing, the running dev container is quicker:

```sh
sudo docker exec -it -w /app reorg-vite npx vitest run tests/pages/reorg-attack/control-panel.test.jsx
```

The dev container installs the test dependencies when it starts, so
restart it once after they change in `package.json`. `npx eslint tests`
lints the suite like the app.

## Layout

| Folder | What lives there |
|---|---|
| `support/` | The harness: `setup.js` (polyfills — ReactFlow's measuring stand-ins among them — the backend double's lifecycle, the per-test slate, the console and unhandled-request guards), `render.jsx` (`renderPage`, `renderApp`), `location.js`, `backend/` (the msw server with `given.*`, the default `handlers.js`, `fixtures.js` — the middle of an attack — and the `contract.js` matrix), `shell/` (App.jsx's route table read from source, request watchers, the location probe), `reorg-attack/page.jsx` (how a test reaches the diagram, the panel and the toasts) |
| `core/` | The app as a whole: the harness smoke test, structural rules (every backend call has a handler, the route table, the files in `public/` …), App routing and StrictMode |
| `components/` | The shell's components: Navbar, Footer |
| `hooks/` | `useReorgAttack` on its own |
| `pages/reorg-attack/` | The tool, one file per part: the page, the fork diagram, the block details, the control panel, the pure flow builders, the block times — behaviour plus the backend contract of every endpoint the part uses |
| `contract/` | The route sweep: every route under every backend failure mode |

## Rules

- **Nothing real.** Every request goes to the msw double. A request no
  handler answers fails the test — add a default handler in
  `support/backend/handlers.js` (a new endpoint in `src/`) or answer it
  in the test with `given.*`. `core/structural.test.js` checks every
  call in `src/` has a default handler, and that the double answers
  nothing the SPA never calls.
- **Declare only the deviation.** Default handlers answer the happy
  path from `fixtures.js`; a test overrides one endpoint with
  `given.json / error / html / empty / networkError / hang / slow /
  capture / sequence`. Fixtures are shared: build a variant from the
  pieces (`f.chainData({ transactions: [] })`, `f.statusAnswer({
  connected: true })`), never mutate them.
- **Globals through `vi.stubGlobal`.** Timers, mocks and stubbed
  globals are undone after each test by `setup.js`, storage is cleared,
  and every toast is removed (react-hot-toast keeps its store per
  module, not per `<Toaster>`).
- **No bug fixed from here.** A test that finds a defect in `src/` does
  not change `src/`: it pins the defect with `it.fails` (the contract
  matrix's `pins`) and a one-line description, so the suite stays green
  while the bug is on record.
- **Assert what a student sees.** Roles, labels and the Lithuanian texts
  verbatim; no snapshots, no class names, no implementation internals
  unless the behaviour lives there — a block's colour, an edge's colour,
  a card's place on the diagram and whether the panel is slid in are
  read from the computed style, the way the browser shows them.
- **Console discipline.** React's bug reports (a missing key, a hook
  order change …) fail the test; a test that provokes one on purpose
  declares it with `allowConsoleErrors(/…/)`.

## Known bugs on record

None open: the bugs the first review pinned are fixed, and their tests
are regular tests now. A bug found from here on is pinned as the rules
above say, and listed here until it is fixed.

## Practical notes

What the suite learned the hard way:

- **ReactFlow needs measuring.** It shows a block only after measuring
  it: `setup.js` gives jsdom a `ResizeObserver` that reports at once,
  element sizes and a `DOMMatrixReadOnly` (ReactFlow's own testing
  recipe). Without them every block stays hidden and no edge is drawn.
- **Clicking inside the diagram.** d3-zoom reads `event.view.document`
  on every mousedown there; user-event leaves `view` null and fixes it
  per event. Click blocks with `clickInDiagram` (`support/reorg-attack/
  page.jsx`), which dispatches the press, the release and the click with
  the window as their view.
- **Styles.** Emotion's (MUI's) styles reach jsdom's `getComputedStyle`;
  Tailwind's do not (`css: false`) — a look that only Tailwind draws
  (the navbar's name pill) is asserted by its classes.
- **Fake timers.** Fake only `setInterval` / `clearInterval` (the two
  polls). Testing Library's `waitFor` polls on `setInterval` too, so with
  it faked `waitFor` re-checks only on DOM changes — fine for a page, not
  for a hook; and `vi.waitFor` moves a faked clock itself. Poll on the
  real `setTimeout` (`settle`) there (see `hooks/use-reorg-attack.test.jsx`).
- **Time zone.** The backend sends every block's time as its header's
  timestamp, and the page shows it in the browser's timezone. The suite
  pins that zone to Europe/Vilnius (`test.env.TZ` in `vite.config.js`,
  guarded by the smoke test), so the local times the tests assert hold
  on any machine; `block-time.test.js` names other zones explicitly.
  To pin the browser's clock as well, fake only `Date` and set it
  (`vi.useFakeTimers({ toFake: ['Date'] })`, `vi.setSystemTime`).
- **Duplicate keys.** The contract matrix's huge-list and hostile-string
  variants repeat entries with equal keys, so React's "two children with
  the same key" warning there is expected — that warning is deliberately
  not fatal.
- **Reading the log.** The hostile-string variant writes a NUL byte to
  stderr: grep the output with `grep -a`, or the summary seems missing.
- **Speed.** A warm page render costs ~0.3 s; the action matrices draw a
  one-block chain (the actions never read it) and paste txids rather than
  typing 64 characters.

## Style

The house style of the app: a file header banner saying what the file
covers, a banner per `describe` group, seven blank lines between
sections, two between tests; test names are sentences about behaviour
("a refused toggle says why, and leaves the switch and the chain as
they were"), not method names.
