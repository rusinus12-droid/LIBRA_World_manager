'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'LIBRA World Manager.js');
function clone(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
async function runCase(mode) {
  let code = fs.readFileSync(DIST, 'utf8');
  const exportSnippet = `\n;globalThis.__LIBRA_COMPAT_TEST__={RisuCompat: typeof RisuCompat!=='undefined'?RisuCompat:null, MemoryEngine: typeof MemoryEngine!=='undefined'?MemoryEngine:null};\n`;
  const idx = code.lastIndexOf('\n})();');
  if (idx >= 0) code = code.slice(0, idx) + exportSnippet + code.slice(idx);
  else code += exportSnippet;
  const replacers = { beforeRequest: [], afterRequest: [] };
  const pluginStorage = new Map();
  const dbCalls = [];
  const permissionCalls = [];
  const chat = { id:'chat-perm', name:'perm', localLore:[], msgs:[], message:[], isStreaming:false };
  const char = { id:'char-perm', name:'Perm Character', chatPage:0, chats:[chat], lorebook:[] };
  const permissionAvailable = mode !== 'permission_unavailable';
  const permissionGrant = mode !== 'permission_denied';
  const risuai = {
    apiVersion:'3.0-test',
    async getRuntimeInfo(){ return { apiVersion:'3.0-test', platform:'node-test', saveMethod:'mock' }; },
    async getArgument(name){
      const args = { debug:'false', llm_key:'dummy-key', llm_url:'http://mock.local/v1/chat/completions', llm_model:'mock', embedding_enabled:'false', aux_llm_enabled:'false' };
      return args[name];
    },
    async getCharacter(){ return clone(char); },
    async getCurrentCharacterIndex(){ return 0; },
    async getCurrentChatIndex(){ return 0; },
    async getCharacterFromIndex(){ return clone(char); },
    async getChatFromIndex(){ return clone(chat); },
    async setChatToIndex(_ci,_ti,next){ Object.assign(chat, clone(next)); return true; },
    async setCharacter(next){ Object.assign(char, clone(next)); return true; },
    async addRisuReplacer(type, handler){ (replacers[type] || (replacers[type]=[])).push(handler); return true; },
    async removeRisuReplacer(type, handler){ replacers[type]=(replacers[type]||[]).filter(h=>h!==handler); return true; },
    async addRisuScriptHandler(){ return true; },
    async removeRisuScriptHandler(){ return true; },
    async registerBodyIntercepter(){ return 'body-1'; },
    async unregisterBodyIntercepter(){ return true; },
    async onUnload(){ return true; },
    async registerSetting(){ return true; },
    async registerButton(){ return true; },
    async showContainer(){ return true; },
    async hideContainer(){ return true; },
    async getDatabase(keys){ dbCalls.push(keys); return { personas:[], selectedPersona:null, modules:[], enabledModules:[], moduleIntergration:[], characters:[clone(char)] }; },
    pluginStorage:{ async getItem(k){ return pluginStorage.has(k)?pluginStorage.get(k):null; }, async setItem(k,v){ pluginStorage.set(k,String(v)); return true; }, async removeItem(k){ pluginStorage.delete(k); return true; } },
    safeLocalStorage:{ async getItem(){ return null; }, async setItem(){ return true; }, async removeItem(){ return true; } },
    async getLocalPluginStorage(){ return { async getItem(){ return null; }, async setItem(){ return true; } }; },
    async nativeFetch(){ throw new Error('not used'); }
  };
  if (permissionAvailable) {
    risuai.requestPluginPermission = async (name) => { permissionCalls.push(name); return permissionGrant; };
  }
  const logs = [];
  const context = {
    console: { log: (...a)=>logs.push(['log',...a.map(String)]), warn: (...a)=>logs.push(['warn',...a.map(String)]), error: (...a)=>logs.push(['error',...a.map(String)]), debug:()=>{} },
    setTimeout, clearTimeout, setInterval, clearInterval, performance, crypto: { randomUUID: crypto.randomUUID }, AbortController, TextEncoder, TextDecoder, URL,
    fetch: async()=>{ throw new Error('fetch should not be called'); }, risuai, Risuai: risuai, globalThis: null, process:{env:{}}, Buffer,
    atob: (s)=>Buffer.from(String(s),'base64').toString('binary'), btoa:(s)=>Buffer.from(String(s),'binary').toString('base64')
  };
  context.globalThis = context;
  vm.createContext(context);
  let evalError = '';
  try { const result = vm.runInContext(code, context, { filename:DIST, timeout:10000 }); if (result && typeof result.then === 'function') await result; }
  catch (e) { evalError = e?.message || String(e); }
  await new Promise(r => setTimeout(r, 100));
  const compat = context.__LIBRA_COMPAT_TEST__?.RisuCompat;
  let info = null;
  let diagnostics = null;
  try { info = await compat?.getRuntimeInfo?.(); } catch (e) { info = { error: e?.message || String(e) }; }
  try { diagnostics = compat?.getDiagnostics?.(); } catch (e) { diagnostics = { error: e?.message || String(e) }; }
  if (compat) {
    // Force DB wrapper path once, so denied permission can be verified without relying on GUI/background code.
    await compat.database.get(['characters']);
  }
  return { mode, evalError, permissionCalls, dbCalls, handlers: { beforeRequest: replacers.beforeRequest.length, afterRequest: replacers.afterRequest.length }, info, diagnostics, logs: logs.slice(-10) };
}
(async()=>{
 const cases=[];
 for (const mode of ['permission_granted','permission_denied','permission_unavailable']) cases.push(await runCase(mode));
 const assertions = [];
 const byMode = Object.fromEntries(cases.map(c=>[c.mode,c]));
 function check(name, ok, details){ assertions.push({name, ok:!!ok, details}); }
 check('permission_granted_registers_hooks', byMode.permission_granted.handlers.beforeRequest >= 1 && byMode.permission_granted.handlers.afterRequest >= 1, byMode.permission_granted.handlers);
 check('permission_denied_fails_open_no_hooks', byMode.permission_denied.evalError === '' && byMode.permission_denied.handlers.beforeRequest === 0 && byMode.permission_denied.handlers.afterRequest === 0, { evalError: byMode.permission_denied.evalError, handlers: byMode.permission_denied.handlers });
 check('permission_denied_db_not_called', byMode.permission_denied.dbCalls.length === 0, { dbCalls: byMode.permission_denied.dbCalls, permissionCalls: byMode.permission_denied.permissionCalls });
 check('permission_unavailable_preserves_legacy_hooks', byMode.permission_unavailable.handlers.beforeRequest >= 1 && byMode.permission_unavailable.handlers.afterRequest >= 1, byMode.permission_unavailable.handlers);
 check('runtime_info_detects_capabilities', byMode.permission_granted.info && byMode.permission_granted.info.hasPluginStorage === true && byMode.permission_granted.info.hasSafeLocalStorage === true && byMode.permission_granted.info.hasLocalPluginStorage === true, byMode.permission_granted.info);
 const out = { ok: assertions.every(a=>a.ok), assertions, cases };
 console.log(JSON.stringify(out, null, 2));
 process.exit(out.ok ? 0 : 1);
})().catch(e=>{ console.error(e); process.exit(1); });
