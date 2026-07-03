'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'dist', 'LIBRA World Manager.js'), 'utf8');

class FakeElement {
  constructor(tag, doc) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this._id = '';
    this.className = '';
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this._innerHTML = '';
    this.textContent = '';
  }
  set id(v) { this._id = String(v || ''); if (this.ownerDocument) this.ownerDocument._register(this); }
  get id() { return this._id; }
  set innerHTML(v) {
    this._innerHTML = String(v || '');
    this.children = [];
    const styleId = this._innerHTML.match(/<style[^>]*id=["']([^"']+)["']/i)?.[1];
    if (styleId) {
      const style = new FakeElement('style', this.ownerDocument);
      style.id = styleId;
      style.textContent = this._innerHTML.replace(/^[\s\S]*?<style[^>]*>/i, '').replace(/<\/style>[\s\S]*$/i, '');
      this.appendChild(style);
    }
  }
  get innerHTML() { return this._innerHTML; }
  get firstElementChild() { return this.children[0] || null; }
  appendChild(el) { if (!el) return el; el.parentNode = this; this.children.push(el); if (el.id && this.ownerDocument) this.ownerDocument._register(el); return el; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; if (this.ownerDocument && this.id) delete this.ownerDocument._ids[this.id]; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  querySelector(selector) { const el = new FakeElement('button', this.ownerDocument); el.selector = selector; return el; }
}
class FakeDocument {
  constructor() {
    this._ids = Object.create(null);
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
  }
  _register(el) { if (el && el.id) this._ids[el.id] = el; }
  createElement(tag) { return new FakeElement(tag, this); }
  getElementById(id) { return this._ids[String(id || '')] || null; }
}

async function runCase(name, args = {}) {
  const document = new FakeDocument();
  const calls = { showContainer: 0, hideContainer: 0, registeredButtons: 0, registeredSettings: 0 };
  const store = new Map();
  const Risuai = {
    apiVersion: '3.0',
    async getRuntimeInfo() { return { apiVersion: '3.0', platform: 'unit', saveMethod: 'mock' }; },
    async getArgument(key) { return Object.prototype.hasOwnProperty.call(args, key) ? args[key] : undefined; },
    pluginStorage: {
      async getItem(k) { return store.has(k) ? store.get(k) : null; },
      async setItem(k, v) { store.set(k, String(v)); },
      async removeItem(k) { store.delete(k); }
    },
    async getCharacter() { return null; },
    async registerSetting() { calls.registeredSettings += 1; },
    async registerButton() { calls.registeredButtons += 1; },
    async showContainer() { calls.showContainer += 1; },
    async hideContainer() { calls.hideContainer += 1; },
    async onUnload() {}
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    URL,
    Promise,
    globalThis: null,
    window: null,
    document,
    Risuai,
    risuai: Risuai,
    structuredClone: global.structuredClone,
    fetch: async () => { throw new Error('fetch not expected'); },
    AbortController,
    performance: { now: () => Date.now() }
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(code, context, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 30));
  const api = context.LIBRA_ActivityDashboard;
  const stateBefore = api?.selfCheck?.() || null;
  const showResult = api?.show?.({ stageLabel: `${name} overlay smoke`, progress: 25 }) || null;
  await new Promise(r => setTimeout(r, 10));
  const node = document.getElementById('libra-activity-overlay');
  const style = document.getElementById('libra-activity-overlay-style');
  const stateAfter = api?.selfCheck?.() || null;
  return {
    name,
    hasApi: !!api,
    stateBefore,
    stateAfter,
    showResultMode: showResult?.mode || null,
    overlayNodeCreated: !!node,
    styleCreated: !!style,
    nodeClassName: node?.className || '',
    showContainerCalls: calls.showContainer,
    hideContainerCalls: calls.hideContainer,
    registeredSettings: calls.registeredSettings,
    registeredButtons: calls.registeredButtons,
    innerHtmlHasTitle: typeof node?.innerHTML === 'string' && node.innerHTML.includes('LIBRA Activity')
  };
}

(async () => {
  const results = [];
  results.push(await runCase('default_args'));
  results.push(await runCase('arg_off', { activity_dashboard: 'off' }));
  results.push(await runCase('arg_compact', { activity_dashboard: 'compact' }));
  const assertions = [
    { name: 'default_overlay_enabled', ok: results[0].stateAfter?.enabled === true && results[0].overlayNodeCreated === true },
    { name: 'default_mode_full', ok: results[0].stateAfter?.mode === 'full' || results[0].showResultMode === 'full' },
    { name: 'arg_off_hides_overlay_without_force', ok: results[1].stateAfter?.enabled === false && results[1].overlayNodeCreated === false },
    { name: 'arg_compact_overlay_enabled', ok: results[2].stateAfter?.enabled === true && results[2].overlayNodeCreated === true && results[2].stateAfter?.mode === 'compact' }
  ];
  const output = { ok: assertions.every(a => a.ok), assertions, results };
  const outPath = path.join(ROOT, 'test-output', 'overlay_smoke_result.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.ok ? 0 : 1);
})();
