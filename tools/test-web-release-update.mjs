import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

const script = readFileSync(
  new URL('../apps/web/public/vite-preload-recovery.js', import.meta.url),
  'utf8',
);
const oldEntry = '/assets/index-Old1234.js';
const newEntry = '/assets/index-New4567.js';

function browser({ loading = false, entry = oldEntry, responseEntry = newEntry } = {}) {
  const listeners = new Map();
  const intervals = [];
  const requestOptions = [];
  const session = new Map();
  let parsed = !loading;
  let now = 100_000;
  let reloads = 0;
  let offline = false;

  function register(target, kind, callback) {
    const key = target + ':' + kind;
    const calls = listeners.get(key) ?? [];
    calls.push(callback);
    listeners.set(key, calls);
  }

  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.attributes = {};
      this.className = '';
      this.textContent = '';
      this.listeners = {};
      this.parent = null;
    }
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      return child;
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    addEventListener(kind, fn) {
      this.listeners[kind] = fn;
    }
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
  }

  const root = new Element('body');
  const document = {
    readyState: loading ? 'loading' : 'complete',
    visibilityState: 'visible',
    body: root,
    querySelector(selector) {
      if (selector !== 'script[type="module"][src]' || !parsed || !entry) return null;
      return { getAttribute: (name) => (name === 'src' ? entry : null) };
    },
    addEventListener: (kind, callback) => register('document', kind, callback),
    createElement: (tag) => new Element(tag),
  };
  const window = {
    addEventListener: (kind, callback) => register('window', kind, callback),
    dispatchEvent: () => true,
    location: { reload: () => (reloads += 1) },
    setInterval(callback, ms) {
      intervals.push({ callback, ms });
      return intervals.length;
    },
  };
  class DOMParser {
    parseFromString(html, mime) {
      assert.equal(mime, 'text/html');
      const match = /<script\s+type="module"\s+src="([^"]+)"/.exec(html);
      return {
        querySelector: (selector) =>
          selector === 'script[type="module"][src]' && match
            ? { getAttribute: () => match[1] }
            : null,
      };
    }
  }
  const fetch = async (path, options) => {
    requestOptions.push({ path, options });
    if (offline) throw new Error('network unavailable');
    return {
      ok: true,
      text: async () => '<html><script type="module" src="' + responseEntry + '"></script></html>',
    };
  };
  const sessionStorage = {
    getItem: (key) => session.get(key) ?? null,
    setItem: (key, value) => session.set(key, value),
  };

  runInNewContext(script, {
    document,
    window,
    fetch,
    DOMParser,
    Date: { now: () => now },
    CustomEvent: class {},
    sessionStorage,
  });

  const dispatch = (target, kind) => {
    for (const listener of listeners.get(target + ':' + kind) ?? []) listener();
  };

  return {
    document,
    intervals,
    requestOptions,
    get reloads() {
      return reloads;
    },
    get notice() {
      return root.children.find((child) => child.className === 'asa-release-update');
    },
    finishParsing() {
      parsed = true;
      document.readyState = 'complete';
      dispatch('document', 'DOMContentLoaded');
    },
    focus() {
      dispatch('window', 'focus');
    },
    advance(ms) {
      now += ms;
    },
    hide() {
      document.visibilityState = 'hidden';
      dispatch('document', 'visibilitychange');
    },
    show() {
      document.visibilityState = 'visible';
      dispatch('document', 'visibilitychange');
    },
    goOffline() {
      offline = true;
    },
    click(buttonText) {
      const actions = this.notice?.children.find((node) => node.className === 'asa-release-update-actions');
      const button = actions?.children.find((node) => node.textContent === buttonText);
      assert.ok(button, 'expected actionable release-notice button');
      button.listeners.click();
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('waits for DOMContentLoaded to discover the hashed module after its own script', async () => {
  const tab = browser({ loading: true });
  assert.equal(tab.requestOptions.length, 0);
  tab.finishParsing();
  await flush();
  assert.equal(tab.requestOptions.length, 1);
  assert.equal(tab.requestOptions[0].path, '/');
  assert.equal(tab.requestOptions[0].options.cache, 'no-store');
  assert.ok(tab.notice);
  assert.equal(tab.reloads, 0, 'a new release must not discard unsaved work');
  assert.equal(tab.intervals[0].ms, 300_000);
});

test('does not prompt when the published release is the already-loaded one', async () => {
  const tab = browser({ responseEntry: oldEntry });
  await flush();
  assert.equal(tab.notice, undefined);
  assert.equal(tab.reloads, 0);
});

test('only an explicit update click reloads; later dismisses without reloading', async () => {
  const tab = browser();
  await flush();
  assert.ok(tab.notice);
  tab.click('Позже');
  assert.equal(tab.notice, undefined);
  assert.equal(tab.reloads, 0);
  tab.advance(300_001);
  tab.focus();
  await flush();
  assert.equal(tab.notice, undefined, 'dismissed release stays dismissed');
  assert.equal(tab.requestOptions.length, 2);

  const anotherTab = browser();
  await flush();
  assert.ok(anotherTab.notice);
  anotherTab.click('Обновить');
  assert.equal(anotherTab.reloads, 1);
});

test('hidden pages and rapid focus events do not cause repeated checks', async () => {
  const tab = browser({ responseEntry: oldEntry });
  await flush();
  tab.focus();
  await flush();
  assert.equal(tab.requestOptions.length, 1);
  tab.hide();
  tab.advance(300_001);
  tab.focus();
  assert.equal(tab.requestOptions.length, 1);
  tab.show();
  await flush();
  assert.equal(tab.requestOptions.length, 2);
});

test('dev entry, invalid release responses and offline network fail safely', async () => {
  const dev = browser({ entry: '/src/main.tsx' });
  await flush();
  assert.equal(dev.requestOptions.length, 0);

  const invalid = browser({ responseEntry: '/src/main.tsx' });
  await flush();
  assert.equal(invalid.notice, undefined);

  const offline = browser({ loading: true });
  offline.goOffline();
  offline.finishParsing();
  await flush();
  assert.equal(offline.notice, undefined);
  assert.equal(offline.reloads, 0);
});
