// -----------------------------------------------------------
//  [*] Tests — structural rules of the SPA
//
//  Rules about the code base as a whole rather than one
//  component, read from the source text:
//    - every backend call in src/ (axios.<method>, its URL a
//      literal or a template — a constant of the file such as
//      API_BASE put in, a choice between two literals such as
//      connect / disconnect counted as both calls) has a
//      default handler in the test double, every one is a
//      relative /api path, and nothing else talks to the
//      network; the other way round, the double answers no
//      endpoint the SPA never calls
//    - the route table: "/" a replacing redirect onto the
//      tool, the tool routed, every page directory statically
//      imported and routed, every page module default-exporting
//      its component
//    - index.html: Lithuanian, titled for the tool
//    - every file src/ points at under the site's root (the
//      navbar's logo …) ships in public/
//    - the double's answers agree with each other
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultHandlers } from '../support/backend/handlers';
import * as f from '../support/backend/fixtures';
import { APP_ROOT, SRC, appRoutes, pageImports, readSource, sourceFiles, withoutComments } from '../support/shell/source';


// The code of every source file, comments blanked out
const CODE = sourceFiles().map(({ file, code }) => ({ file, code: withoutComments(code) }));







// -----------------------------------------------------------
// callArguments
// -----------------------------------------------------------
//
// The argument list of the call whose "(" sits at `open`, as
// top-level arguments — strings, templates and nested
// brackets respected.
//
// Used by:
//   - networkCalls (below)
// -----------------------------------------------------------

function callArguments(code, open) {

  const args = [];
  let depth = 0;
  let quote = null;
  let start = open + 1;

  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) {
      depth -= 1;
      if (depth === 0) {
        args.push(code.slice(start, i).trim());
        return args.filter(Boolean);
      }
    } else if (c === ',' && depth === 1) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error(`unclosed call at ${open}`);
}







// -----------------------------------------------------------
// expandTemplate
// -----------------------------------------------------------
//
// A template URL's every concrete form: each placeholder
// becomes the literal of a constant the file declares
// (API_BASE), both literals of a condition choosing between
// two quoted words (connect or disconnect), or ":param" for
// anything else (a txid). The query string is dropped.
//
// Used by:
//   - networkCalls (below)
// -----------------------------------------------------------

function expandTemplate(raw, code) {

  const parts = raw.split(/(\$\{[^}]*\})/);
  let forms = [''];

  for (const part of parts) {
    const expression = part.match(/^\$\{([^}]*)\}$/)?.[1]?.trim();
    let options = [part];

    if (expression !== undefined) {
      const constant = /^[\w$]+$/.test(expression) && code.match(new RegExp(`const ${expression} = '([^']*)';`));
      const choice = expression.match(/^[^?]+\?\s*'([^']*)'\s*:\s*'([^']*)'$/);
      if (constant) options = [constant[1]];
      else if (choice) options = [choice[1], choice[2]];
      else options = [':param'];
    }

    forms = forms.flatMap((form) => options.map((option) => form + option));
  }

  return forms.map((form) => form.split('?')[0]);
}







// -----------------------------------------------------------
// networkCalls
// -----------------------------------------------------------
//
// Every axios call in src/, each with its file, its HTTP
// method and its URL — a literal or template URL in every
// concrete form it can take (see expandTemplate); any other
// URL is kept as the expression it comes from.
//
// Used by:
//   - the backend-call rules (below)
// -----------------------------------------------------------

const CALL_RE = /\baxios\.(get|post|put|patch|delete|head|options)\(/g;

function networkCalls() {

  const calls = [];

  for (const { file, code } of CODE) {
    for (const match of code.matchAll(CALL_RE)) {
      const [first = ''] = callArguments(code, match.index + match[0].length - 1);
      const method = match[1].toUpperCase();
      const literal = first.match(/^(?:"([^"]*)"|'([^']*)'|`([^`]*)`)$/);

      if (literal) {
        for (const url of expandTemplate(literal[1] ?? literal[2] ?? literal[3], code)) calls.push({ file, method, url });
      } else {
        calls.push({ file, method, expression: first });
      }
    }
  }

  return calls;
}

// A handler's path (absolute, msw params) against a call's
// path: segment-wise, a ":param" on either side matching
// anything
const handlerMatches = (handler, method, url) => {
  if (handler.info.method.toUpperCase() !== method) return false;
  const handlerPath = String(handler.info.path).replace(/^http:\/\/localhost:3000/, '');
  const hs = handlerPath.split('/');
  const cs = url.split('/');
  if (hs.length !== cs.length) return false;
  return hs.every((segment, i) => segment.startsWith(':') || cs[i].startsWith(':') || segment === cs[i]);
};







// -----------------------------------------------------------
// The backend calls
// -----------------------------------------------------------

describe('structural rules — the backend calls', () => {

  const calls = networkCalls();


  it('finds the SPA\'s calls — the two polls and the four actions, connect and disconnect apart', () => {
    expect(calls.map(({ method, url }) => `${method} ${url}`).sort()).toEqual([
      'DELETE /api/reorgattack/transactions/:param',
      'GET /api/reorgattack/blockchain/data',
      'GET /api/reorgattack/connect',
      'GET /api/reorgattack/disconnect',
      'GET /api/reorgattack/status',
      'POST /api/reorgattack/transactions',
      'POST /api/reorgattack/transactions/send',
    ]);
    expect(new Set(calls.map((call) => call.file))).toEqual(new Set(['src/pages/ReorgAttack/useReorgAttack.jsx']));
  });


  it('every backend call in src/ has a default handler in the test double', () => {
    const unhandled = calls
      .filter((call) => call.url && !defaultHandlers.some((handler) => handlerMatches(handler, call.method, call.url)))
      .map((call) => `${call.method} ${call.url} (${call.file})`);
    expect(unhandled).toEqual([]);
  });


  it('the double answers nothing the SPA never calls', () => {
    const dead = defaultHandlers
      .filter((handler) => !calls.some((call) => call.url && handlerMatches(handler, call.method, call.url)))
      .map((handler) => `${handler.info.method} ${handler.info.path}`);
    expect(dead).toEqual([]);
  });


  it('every URL is a relative /api path — no hardcoded host, no computed URL', () => {
    expect(calls.filter((call) => call.expression).map((call) => `${call.expression} (${call.file})`)).toEqual([]);
    expect(calls.filter((call) => !call.url.startsWith('/api/')).map((call) => `${call.url} (${call.file})`)).toEqual([]);
  });


  it('nothing else talks to the network — no fetch, XMLHttpRequest, WebSocket, EventSource, beacon or bare axios call', () => {
    const offenders = CODE.filter(({ code }) => (
      /(?<![\w.$])fetch\(|\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b|\bsendBeacon\(|\baxios\(|\baxios\.(create|request)\(/.test(code)
    )).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});







// -----------------------------------------------------------
// The route table
// -----------------------------------------------------------

describe('structural rules — the route table', () => {

  it('reads App.jsx\'s routes: "/" redirects to the tool, the tool is routed', () => {
    expect(appRoutes()).toEqual([
      { path: '/', index: true, element: 'Navigate', redirectTo: '/reorgattack', replace: true },
      { path: '/reorgattack', index: false, element: 'ReorgAttackPage', redirectTo: null, replace: null },
    ]);
  });


  it('every redirect replaces the history entry and lands on a routed page', () => {
    const routes = appRoutes();
    for (const redirect of routes.filter((route) => route.element === 'Navigate')) {
      expect(redirect.replace, redirect.path).toBe(true);
      expect(routes.some((route) => route.path === redirect.redirectTo && route.element && route.element !== 'Navigate'), redirect.path).toBe(true);
    }
  });


  it('imports every page directory under src/pages statically, and routes it', () => {
    const directories = readdirSync(join(SRC, 'pages')).filter((name) => statSync(join(SRC, 'pages', name)).isDirectory());
    const imports = pageImports();
    const routed = new Set(appRoutes().map((route) => route.element));

    for (const directory of directories) {
      expect(existsSync(join(SRC, 'pages', directory, 'Page.jsx')), `${directory}/Page.jsx`).toBe(true);
      const imported = imports.filter((entry) => entry.dir === directory);
      expect(imported, `${directory} imported once by App.jsx`).toHaveLength(1);
      expect(routed.has(imported[0].name), `${directory} (${imported[0].name}) is a route's element`).toBe(true);
    }
    expect(imports).toHaveLength(directories.length);
  });


  it('every page module default-exports its component', () => {
    for (const { dir } of pageImports()) {
      expect(readSource(`src/pages/${dir}/Page.jsx`), dir).toMatch(/^export default function \w+\(/m);
    }
  });
});







// -----------------------------------------------------------
// index.html and the files the SPA points at
// -----------------------------------------------------------

describe('structural rules — index.html and public/', () => {

  it('declares the page Lithuanian and titles it for the tool', () => {
    const html = readSource('index.html');
    expect(html).toMatch(/<html lang="lt">/);
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe('VU KnF — 51% Atakos Įrankis');
  });


  it('ships every file src/ and index.html point at under the site\'s root — the navbar\'s logo among them', () => {
    const pointed = [...CODE, { file: 'index.html', code: readSource('index.html') }].flatMap(({ file, code }) => (
      [...code.matchAll(/(?:src|href)=["'](\/[^"'?#]+\.(?:png|svg|jpe?g|webp|ico|gif))["']/g)].map((match) => ({ file, path: match[1] }))
    ));
    expect(pointed.map(({ path }) => path)).toEqual(expect.arrayContaining(['/img/logo_knf.png', '/favicon.svg']));

    const missing = pointed.filter(({ path }) => !existsSync(join(APP_ROOT, 'public', path))).map(({ file, path }) => `${path} (${file})`);
    expect(missing).toEqual([]);
  });
});







// -----------------------------------------------------------
// The double agrees with itself
// -----------------------------------------------------------

describe('structural rules — the double\'s answers agree', () => {

  it('the status names the chain\'s two tips, at their heights', () => {
    const { status } = f.statusAnswer();
    const byHash = Object.fromEntries(f.CHAIN.map((block) => [block.hash, block]));
    expect(status.publicTip.hash).toBe(f.TIPS.public);
    expect(status.privateTip.hash).toBe(f.TIPS.private);
    expect(status.publicTip.height).toBe(byHash[f.TIPS.public].height);
    expect(status.privateTip.height).toBe(byHash[f.TIPS.private].height);
  });


  it('every tracked transaction sits in blocks of the chain, and every block but the oldest has its parent in it', () => {
    const hashes = new Set(f.CHAIN.map((block) => block.hash));
    for (const tx of f.TRACKED) for (const block of tx.blocks) expect(hashes.has(block), tx.txid).toBe(true);
    const oldest = [...f.CHAIN].sort((a, b) => a.height - b.height)[0];
    for (const block of f.CHAIN.filter((b) => b !== oldest)) expect(hashes.has(block.prevHash), `block ${block.height}`).toBe(true);
  });


  it('the honest blocks carry "Public Miner", the private branch does not', () => {
    for (const block of [f.B.s6398, f.B.s6399, f.B.s6400, f.B.u6401, f.B.u6402]) expect(block.coinbase).toContain('Public Miner');
    for (const block of [f.B.p6401, f.B.p6402, f.B.p6403]) expect(block.coinbase).not.toContain('Public Miner');
  });
});
