import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guarantees, read straight off the source. A runtime spy can only prove that
 * nothing fired during the window it watched, and stubbing the transport APIs breaks the
 * test runner itself. Reading the source proves the call is not there to fire.
 */
const SRC = join(import.meta.dirname, '..', 'src');

const sources = readdirSync(SRC)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, code: readFileSync(join(SRC, name), 'utf8') }));

/** Strip comments, so prose mentioning an API is not mistaken for a call to it. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function offenders(pattern: RegExp): string[] {
  return sources
    .filter(({ code }) => pattern.test(codeOnly(code)))
    .map(({ name }) => name);
}

it('reads every source file', () => {
  expect(sources.length).toBeGreaterThan(5);
  expect(sources.map((s) => s.name)).toContain('field.ts');
});

describe('no network', () => {
  it.each([
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['sendBeacon', /\bsendBeacon\b/],
    ['WebSocket', /\bWebSocket\b/],
    ['EventSource', /\bEventSource\b/],
    ['Image loading', /\bnew\s+Image\s*\(/],
    ['dynamic import', /\bimport\s*\(/],
  ])('never calls %s', (_label, pattern) => {
    expect(offenders(pattern)).toEqual([]);
  });
});

describe('no persistence', () => {
  it.each([
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['cookies', /\bdocument\s*\.\s*cookie\b/],
    ['IndexedDB', /\bindexedDB\b/],
  ])('never touches %s', (_label, pattern) => {
    expect(offenders(pattern)).toEqual([]);
  });
});

describe('CSP safe', () => {
  // A strict Content-Security-Policy forbids these outright, and a decoration library is
  // never a good enough reason to make a host page loosen its policy.
  it.each([
    ['eval', /\beval\s*\(/],
    ['new Function', /\bnew\s+Function\s*\(/],
    ['document.write', /\bdocument\s*\.\s*write\b/],
    ['innerHTML', /\binnerHTML\b/],
    ['outerHTML', /\bouterHTML\b/],
    ['inline script injection', /createElement\s*\(\s*['"`]script/],
  ])('never uses %s', (_label, pattern) => {
    expect(offenders(pattern)).toEqual([]);
  });

  it('sets a timer only for the resize debounce', () => {
    // setTimeout with a string body is an eval in disguise; the engine's single timer takes
    // a function. Keeping the count at one also keeps the teardown story simple.
    const timers = sources.filter(({ code }) => /\bsetTimeout\s*\(/.test(codeOnly(code)));
    expect(timers.map((t) => t.name)).toEqual(['field.ts']);
    expect(codeOnly(timers[0].code)).not.toMatch(/setTimeout\s*\(\s*['"`]/);
  });
});

describe('no global side effects at import time', () => {
  it('exports without touching a browser global at module scope', () => {
    // Anything at module scope runs on import, including on a server. Browser globals are
    // only legal inside functions.
    for (const { name, code } of sources) {
      const top = codeOnly(code)
        .split('\n')
        .filter((line) => /^\S/.test(line) && !/^(import|export|type|interface|declare)/.test(line));
      const joined = top.join('\n');
      expect(joined, `${name} touches a browser global at module scope`).not.toMatch(
        /\b(window|document|navigator|location)\s*\./,
      );
    }
  });
});
