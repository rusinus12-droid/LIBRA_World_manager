    // ══════════════════════════════════════════════════════════════
    // [CORE] Error Handler
    // ══════════════════════════════════════════════════════════════
    class LIBRAError extends Error {
        constructor(message, code, cause = null) {
            super(message);
            this.name = 'LIBRAError';
            this.code = code;
            this.cause = cause;
            this.timestamp = Date.now();
        }
    }

    const RisuCompat = (() => {
        const candidates = () => {
            const list = [];
            const push = (value) => {
                if (value && typeof value === 'object' && !list.includes(value)) list.push(value);
            };
            try {
                if (typeof risuai !== 'undefined') push(risuai);
            } catch (_) {}
            try {
                if (typeof Risuai !== 'undefined') push(Risuai);
            } catch (_) {}
            try {
                if (typeof globalThis !== 'undefined') {
                    push(globalThis.risuai);
                    push(globalThis.Risuai);
                }
            } catch (_) {}
            return list;
        };
        const api = () => candidates()[0] || null;
        const host = (name) => candidates().find(candidate => typeof candidate?.[name] === 'function') || api();
        const storageHost = () => candidates().find(candidate => candidate?.pluginStorage) || api();
        const has = (name) => typeof host(name)?.[name] === 'function';
        const isProbablyLocalNetworkUrl = (url) => {
            try {
                const host = new URL(String(url || '')).hostname.toLowerCase();
                return host === 'localhost'
                    || host === '127.0.0.1'
                    || host === '0.0.0.0'
                    || host === '::1'
                    || host.endsWith('.local')
                    || host.startsWith('192.168.')
                    || host.startsWith('10.')
                    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
                    || /^[a-z0-9_-]+$/i.test(host);
            } catch (_) {
                return false;
            }
        };
        const detectCompat = async () => {
            const runtimeApi = api();
            let runtime = null;
            try {
                if (typeof runtimeApi?.getRuntimeInfo === 'function') runtime = await runtimeApi.getRuntimeInfo();
            } catch (_) { runtime = null; }
            return {
                runtime,
                apiVersion: runtimeApi?.apiVersion ?? runtime?.apiVersion ?? 'unknown',
                platform: runtime?.platform ?? 'unknown',
                saveMethod: runtime?.saveMethod ?? 'unknown',
                hasPluginStorage: !!storageHost()?.pluginStorage,
                hasSafeLocalStorage: !!(candidates().find(candidate => candidate?.safeLocalStorage)?.safeLocalStorage),
                hasLocalPluginStorage: typeof host('getLocalPluginStorage')?.getLocalPluginStorage === 'function',
                hasNativeFetch: typeof host('nativeFetch')?.nativeFetch === 'function',
                hasDatabase: typeof host('getDatabase')?.getDatabase === 'function',
                hasReplacer: typeof host('addRisuReplacer')?.addRisuReplacer === 'function',
                hasPermissionApi: typeof host('requestPluginPermission')?.requestPluginPermission === 'function'
            };
        };
        const normalizeNetworkError = (error, url) => {
            const message = String(error?.message || error || 'network request failed').trim();
            const code = error?.code || (message === 'API Request timed out' ? 'TIMEOUT' : 'NETWORK_ERROR');
            if (isProbablyLocalNetworkUrl(url)) {
                return new LIBRAError(
                    `API Request failed: direct localhost/LAN access may be blocked in Web Risu. In PocketRisu, Node Risu, or Local Risu, prefer nativeFetch local_network routing or the host proxy path when available; otherwise use a tunnel or a reachable HTTPS endpoint. Original error: ${message}`,
                    code,
                    error
                );
            }
            return error instanceof LIBRAError ? error : new LIBRAError(`API Request failed: ${message}`, code, error);
        };
        const request = async (url, init = {}, options = {}) => {
            const runtime = host('nativeFetch');
            const timeoutMs = Math.max(1000, Number(options.timeoutMs || init.requestTimeoutMs || 120000) || 120000);
            const requestInit = {
                ...init,
                requestTimeoutMs: timeoutMs
            };
            if (isProbablyLocalNetworkUrl(url) && !requestInit.networkRoute) {
                requestInit.networkRoute = 'local_network';
            }

            if (typeof runtime?.nativeFetch === 'function') {
                try {
                    return await runtime.nativeFetch(url, requestInit);
                } catch (error) {
                    throw normalizeNetworkError(error, url);
                }
            }

            let abortTimer = null;
            let timeoutTimer = null;
            if (typeof AbortController === 'function' && !requestInit.signal) {
                const controller = new AbortController();
                requestInit.signal = controller.signal;
                abortTimer = setTimeout(() => controller.abort(), timeoutMs);
            }

            const fetchPromise = (async () => {
                if (typeof fetch === 'function') return await fetch(url, requestInit);
                throw new LIBRAError('No compatible fetch API available', 'FETCH_UNAVAILABLE');
            })();
            const timeoutPromise = new Promise((_, reject) => {
                timeoutTimer = setTimeout(() => reject(new LIBRAError('API Request timed out', 'TIMEOUT')), timeoutMs);
            });

            try {
                return await Promise.race([fetchPromise, timeoutPromise]);
            } catch (error) {
                throw normalizeNetworkError(error, url);
            } finally {
                if (abortTimer != null && typeof clearTimeout === 'function') clearTimeout(abortTimer);
                if (timeoutTimer != null && typeof clearTimeout === 'function') clearTimeout(timeoutTimer);
            }
        };
        const COMPAT_CHUNK_SENTINEL = '__libraChunkedStorageV1';
        const COMPAT_CHUNK_SIZE = 512 * 1024;
        const compatDiagnostics = {
            createdAt: Date.now(),
            permissions: Object.create(null),
            replacers: Object.create(null),
            database: { lastPermission: 'not_requested', lastAccessAt: 0, lastError: '' },
            storage: { chunkedWrites: 0, lastChunkedKey: '', lastError: '' }
        };
        const replacerWrappedHandlers = new Map();
        const permissionCache = new Map();
        const normalizePermissionResult = (value) => value === null ? null : !!value;
        const setPermissionStatus = (name, value) => {
            const status = value === null ? 'unavailable' : value ? 'granted' : 'denied';
            compatDiagnostics.permissions[name] = { status, value, at: Date.now() };
            return value;
        };
        const ensurePermission = async (name, options = {}) => {
            const permission = String(name || '').trim();
            if (!permission) return false;
            const useCache = options.cache !== false;
            if (useCache && permissionCache.has(permission)) return permissionCache.get(permission);
            const runtime = host('requestPluginPermission');
            if (typeof runtime?.requestPluginPermission !== 'function') {
                const result = setPermissionStatus(permission, null);
                if (useCache) permissionCache.set(permission, result);
                return result;
            }
            try {
                const result = normalizePermissionResult(await runtime.requestPluginPermission(permission));
                setPermissionStatus(permission, result);
                if (useCache) permissionCache.set(permission, result);
                return result;
            } catch (error) {
                compatDiagnostics.permissions[permission] = { status: 'error', value: false, at: Date.now(), error: error?.message || String(error || '') };
                if (useCache) permissionCache.set(permission, false);
                return false;
            }
        };
        const getCompatStorageRuntime = () => storageHost();
        const removePluginStorageItem = async (runtime, key) => {
            if (typeof runtime?.pluginStorage?.removeItem === 'function') {
                await runtime.pluginStorage.removeItem(key);
                return true;
            }
            return false;
        };
        const tryCleanupChunkedStorage = async (runtime, key, manifest = null) => {
            try {
                const parsed = manifest || JSON.parse(String(await runtime?.pluginStorage?.getItem?.(key) || 'null'));
                if (!parsed || parsed[COMPAT_CHUNK_SENTINEL] !== true || !Array.isArray(parsed.chunks)) return;
                for (const chunkKey of parsed.chunks) await removePluginStorageItem(runtime, chunkKey);
            } catch (_) {}
        };
        const pluginStorage = {
            async getItem(key) {
                const runtime = getCompatStorageRuntime();
                if (typeof runtime?.pluginStorage?.getItem !== 'function') return null;
                try {
                    const raw = await runtime.pluginStorage.getItem(key);
                    if (typeof raw !== 'string' || raw.indexOf(COMPAT_CHUNK_SENTINEL) < 0) return raw;
                    let manifest = null;
                    try { manifest = JSON.parse(raw); } catch (_) { return raw; }
                    if (!manifest || manifest[COMPAT_CHUNK_SENTINEL] !== true || !Array.isArray(manifest.chunks)) return raw;
                    const parts = [];
                    for (const chunkKey of manifest.chunks) {
                        const part = await runtime.pluginStorage.getItem(chunkKey);
                        if (typeof part !== 'string') return null;
                        parts.push(part);
                    }
                    return parts.join('');
                } catch (error) {
                    compatDiagnostics.storage.lastError = error?.message || String(error || '');
                    return null;
                }
            },
            async setItem(key, value) {
                const runtime = getCompatStorageRuntime();
                if (typeof runtime?.pluginStorage?.setItem !== 'function') return false;
                const stringValue = String(value ?? '');
                try {
                    let previous = null;
                    try { previous = await runtime.pluginStorage.getItem(key); } catch (_) {}
                    let previousManifest = null;
                    if (typeof previous === 'string' && previous.indexOf(COMPAT_CHUNK_SENTINEL) >= 0) {
                        try { previousManifest = JSON.parse(previous); } catch (_) {}
                    }
                    if (stringValue.length <= COMPAT_CHUNK_SIZE) {
                        await runtime.pluginStorage.setItem(key, stringValue);
                        if (previousManifest) await tryCleanupChunkedStorage(runtime, key, previousManifest);
                        return true;
                    }
                    const chunkCount = Math.ceil(stringValue.length / COMPAT_CHUNK_SIZE);
                    const chunks = [];
                    const stamp = Date.now().toString(36);
                    for (let i = 0; i < chunkCount; i += 1) {
                        const chunkKey = `${key}::chunk:v1:${stamp}:${String(i).padStart(4, '0')}`;
                        chunks.push(chunkKey);
                        await runtime.pluginStorage.setItem(chunkKey, stringValue.slice(i * COMPAT_CHUNK_SIZE, (i + 1) * COMPAT_CHUNK_SIZE));
                    }
                    const manifest = {
                        [COMPAT_CHUNK_SENTINEL]: true,
                        schemaVersion: 1,
                        key: String(key || ''),
                        chunks,
                        length: stringValue.length,
                        updatedAt: Date.now()
                    };
                    await runtime.pluginStorage.setItem(key, JSON.stringify(manifest));
                    if (previousManifest) await tryCleanupChunkedStorage(runtime, key, previousManifest);
                    compatDiagnostics.storage.chunkedWrites += 1;
                    compatDiagnostics.storage.lastChunkedKey = String(key || '');
                    return true;
                } catch (error) {
                    compatDiagnostics.storage.lastError = error?.message || String(error || '');
                    return false;
                }
            },
            async removeItem(key) {
                const runtime = getCompatStorageRuntime();
                if (!runtime?.pluginStorage) return false;
                try {
                    const raw = typeof runtime.pluginStorage.getItem === 'function' ? await runtime.pluginStorage.getItem(key) : null;
                    if (typeof raw === 'string' && raw.indexOf(COMPAT_CHUNK_SENTINEL) >= 0) {
                        try { await tryCleanupChunkedStorage(runtime, key, JSON.parse(raw)); } catch (_) {}
                    }
                    return await removePluginStorageItem(runtime, key);
                } catch (error) {
                    compatDiagnostics.storage.lastError = error?.message || String(error || '');
                    return false;
                }
            }
        };
        const safeLocalStorage = {
            async getItem(key) {
                const runtime = candidates().find(candidate => candidate?.safeLocalStorage) || api();
                if (typeof runtime?.safeLocalStorage?.getItem !== 'function') return null;
                try { return await runtime.safeLocalStorage.getItem(key); } catch (_) { return null; }
            },
            async setItem(key, value) {
                const runtime = candidates().find(candidate => candidate?.safeLocalStorage) || api();
                if (typeof runtime?.safeLocalStorage?.setItem !== 'function') return false;
                try { await runtime.safeLocalStorage.setItem(key, String(value ?? '')); return true; } catch (_) { return false; }
            },
            async removeItem(key) {
                const runtime = candidates().find(candidate => candidate?.safeLocalStorage) || api();
                if (typeof runtime?.safeLocalStorage?.removeItem !== 'function') return false;
                try { await runtime.safeLocalStorage.removeItem(key); return true; } catch (_) { return false; }
            }
        };
        const localPluginStorage = {
            async getStore() {
                const runtime = host('getLocalPluginStorage');
                if (typeof runtime?.getLocalPluginStorage !== 'function') return null;
                try { return await runtime.getLocalPluginStorage(); } catch (_) { return null; }
            },
            async getItem(key) {
                const store = await this.getStore();
                if (!store) return null;
                try {
                    if (typeof store.getItem === 'function') return await store.getItem(key);
                    if (typeof store.get === 'function') return await store.get(key);
                    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
                } catch (_) { return null; }
            },
            async setItem(key, value) {
                const store = await this.getStore();
                if (!store) return false;
                try {
                    if (typeof store.setItem === 'function') { await store.setItem(key, value); return true; }
                    if (typeof store.set === 'function') { await store.set(key, value); return true; }
                    store[key] = value;
                    return true;
                } catch (_) { return false; }
            }
        };
        const database = {
            async get(keys) {
                const runtime = host('getDatabase');
                if (typeof runtime?.getDatabase !== 'function') return null;
                const granted = await ensurePermission('db');
                compatDiagnostics.database.lastPermission = granted === null ? 'unavailable' : granted ? 'granted' : 'denied';
                compatDiagnostics.database.lastAccessAt = Date.now();
                if (granted === false) return null;
                try {
                    return await runtime.getDatabase(keys);
                } catch (error) {
                    compatDiagnostics.database.lastError = error?.message || String(error || '');
                    return null;
                }
            }
        };
        const failOpenValueForReplacer = (type, args) => {
            const first = args?.[0];
            const normalizedType = String(type || '').trim().toLowerCase();
            if (normalizedType === 'beforerequest') return first;
            if (normalizedType === 'afterrequest') return first;
            return first;
        };
        const wrapReplacerHandler = (type, handler) => {
            const normalizedType = String(type || 'unknown').trim() || 'unknown';
            const state = compatDiagnostics.replacers[normalizedType] || (compatDiagnostics.replacers[normalizedType] = {
                registered: false,
                lastRunAt: 0,
                runCount: 0,
                lastError: ''
            });
            return async (...args) => {
                state.lastRunAt = Date.now();
                state.runCount = Number(state.runCount || 0) + 1;
                try {
                    return await handler(...args);
                } catch (error) {
                    state.lastError = error?.message || String(error || '');
                    return failOpenValueForReplacer(normalizedType, args);
                }
            };
        };
        return Object.freeze({
            api,
            host,
            has,
            request,
            pluginStorage,
            safeLocalStorage,
            localPluginStorage,
            database,
            ensurePermission,
            detectCompat,
            async getRuntimeInfo() { return await detectCompat(); },
            getDiagnostics() { try { return typeof safeClone === 'function' ? safeClone(compatDiagnostics) : JSON.parse(JSON.stringify(compatDiagnostics)); } catch (_) { return { available: true }; } },
            isProbablyLocalNetworkUrl,
            async getArgument(name) {
                const runtime = host('getArgument');
                return typeof runtime?.getArgument === 'function' ? await runtime.getArgument(name) : undefined;
            },
            async getCharacter() {
                const runtime = host('getCharacter');
                return typeof runtime?.getCharacter === 'function' ? await runtime.getCharacter() : null;
            },
            async getCurrentCharacterIndex() {
                const runtime = host('getCurrentCharacterIndex');
                return typeof runtime?.getCurrentCharacterIndex === 'function' ? await runtime.getCurrentCharacterIndex() : -1;
            },
            async getCurrentChatIndex() {
                const runtime = host('getCurrentChatIndex');
                return typeof runtime?.getCurrentChatIndex === 'function' ? await runtime.getCurrentChatIndex() : -1;
            },
            async getCharacterFromIndex(index) {
                const runtime = host('getCharacterFromIndex');
                return typeof runtime?.getCharacterFromIndex === 'function' ? await runtime.getCharacterFromIndex(index) : null;
            },
            async getChatFromIndex(charIndex, chatIndex) {
                const runtime = host('getChatFromIndex');
                return typeof runtime?.getChatFromIndex === 'function' ? await runtime.getChatFromIndex(charIndex, chatIndex) : null;
            },
            async setChatToIndex(charIndex, chatIndex, chat) {
                const runtime = host('setChatToIndex');
                if (typeof runtime?.setChatToIndex !== 'function') return false;
                await runtime.setChatToIndex(charIndex, chatIndex, chat);
                return true;
            },
            async setCharacter(char) {
                const runtime = host('setCharacter');
                if (typeof runtime?.setCharacter !== 'function') return false;
                await runtime.setCharacter(char);
                return true;
            },
            async addReplacer(type, handler) {
                const runtime = host('addRisuReplacer');
                if (typeof runtime?.addRisuReplacer !== 'function' || typeof handler !== 'function') return false;
                const granted = await ensurePermission('replacer');
                const state = compatDiagnostics.replacers[String(type || 'unknown').trim() || 'unknown'] || (compatDiagnostics.replacers[String(type || 'unknown').trim() || 'unknown'] = {});
                state.permission = granted === null ? 'unavailable' : granted ? 'granted' : 'denied';
                state.permissionCheckedAt = Date.now();
                if (granted === false) {
                    state.registered = false;
                    state.lastError = 'replacer permission denied';
                    return false;
                }
                const wrapped = wrapReplacerHandler(type, handler);
                replacerWrappedHandlers.set(handler, wrapped);
                await runtime.addRisuReplacer(type, wrapped);
                state.registered = true;
                state.registeredAt = Date.now();
                return true;
            },
            async removeReplacer(type, handler) {
                const runtime = host('removeRisuReplacer');
                if (typeof runtime?.removeRisuReplacer !== 'function') return false;
                const wrapped = replacerWrappedHandlers.get(handler) || handler;
                await runtime.removeRisuReplacer(type, wrapped);
                replacerWrappedHandlers.delete(handler);
                const state = compatDiagnostics.replacers[String(type || 'unknown').trim() || 'unknown'];
                if (state) state.registered = false;
                return true;
            },
            async addScriptHandler(mode, handler) {
                const runtime = host('addRisuScriptHandler');
                if (typeof runtime?.addRisuScriptHandler !== 'function') return false;
                await runtime.addRisuScriptHandler(mode, handler);
                return true;
            },
            async removeScriptHandler(mode, handler) {
                const runtime = host('removeRisuScriptHandler');
                if (typeof runtime?.removeRisuScriptHandler !== 'function') return false;
                await runtime.removeRisuScriptHandler(mode, handler);
                return true;
            },
            async registerBodyIntercepter(handler) {
                const runtime = host('registerBodyIntercepter');
                if (typeof runtime?.registerBodyIntercepter !== 'function') return null;
                return await runtime.registerBodyIntercepter(handler);
            },
            async unregisterBodyIntercepter(id) {
                const runtime = host('unregisterBodyIntercepter');
                if (typeof runtime?.unregisterBodyIntercepter !== 'function') return false;
                await runtime.unregisterBodyIntercepter(id);
                return true;
            },
            async onUnload(handler) {
                const runtime = host('onUnload');
                if (typeof runtime?.onUnload !== 'function') return false;
                await runtime.onUnload(handler);
                return true;
            }
        });
    })();

    const getChatMessages = (chat) => {
        if (!chat) return [];
        return chat.msgs || chat.messages || chat.message || chat.log || chat.mes || chat.chat || [];
    };
    const unwrapAnalyzableMessage = (value) => {
        if (value && typeof value === 'object' && value.msg && typeof value.msg === 'object') return value.msg;
        return value;
    };
    const getMessageRoleHint = (value) => {
        const wrapperRole = String(value?.roleHint || '').trim().toLowerCase();
        if (/^(?:user|human|player|request|input)$/.test(wrapperRole)) return 'user';
        if (/^(?:ai|assistant|character|char|bot|model|response)$/.test(wrapperRole)) return 'ai';
        const msg = unwrapAnalyzableMessage(value);
        const roleText = String(
            msg?.role
            ?? msg?.type
            ?? msg?.speakerType
            ?? msg?.senderType
            ?? msg?.authorType
            ?? ''
        ).trim().toLowerCase();
        if (/^(?:user|human|player|request|input)$/.test(roleText)) return 'user';
        if (/^(?:assistant|ai|character|char|bot|model|response)$/.test(roleText)) return 'ai';
        if (value?.is_user === true || value?.isUser === true || value?.user === true) return 'user';
        if (msg?.is_user === true || msg?.isUser === true || msg?.user === true) return 'user';
        if (value?.is_user === false || value?.isUser === false || value?.isBot === true || value?.is_bot === true || value?.bot === true) return 'ai';
        if (msg?.is_user === false || msg?.isUser === false || msg?.isBot === true || msg?.is_bot === true || msg?.bot === true) return 'ai';
        return 'ai';
    };
    const isUserLikeMessage = (value) => getMessageRoleHint(value) === 'user';
    const isAssistantLikeMessage = (value) => getMessageRoleHint(value) !== 'user';
    const getAnalyzableMessageText = (value) => {
        const direct = String(value?.text || value?.narrativeText || value?.content || value?.message || '').trim();
        if (direct) return direct;
        return String(Utils.getMessageText(unwrapAnalyzableMessage(value)) || '').trim();
    };

    const isLightBoardActive = async (preferredChat = null) => {
        try {
            if (!RisuCompat.api()) return false;
            const ctx = await resolveActiveChatContext(preferredChat);
            const char = ctx?.char;
            if (!char) return false;
            const chat = ctx?.chat || null;
            if (!chat) return false;
            const msgs = getChatMessages(chat).slice(-3);
            return msgs.some(m => {
                const text = String(m?.content || '');
                return (/\[LBDATA START\].*(lb-rerolling|lb-pending|lb-interaction-identifier)/is.test(text) || 
                        /<lb-xnai-editing/is.test(text));
            });
        } catch (e) {
            return false;
        }
    };
    const getComparableMessageText = (msg) => {
        const roleHint = getMessageRoleHint(msg);
        return Utils.getNarrativeComparableText(Utils.getMessageText(msg), roleHint);
    };
    const getMessageSignature = (msg) => {
        if (!msg || typeof msg !== 'object') return '';
        const role = getMessageRoleHint(msg) === 'user' ? 'user' : 'ai';
        const speaker = String(msg?.saying || msg?.name || '').trim();
        const time = Number(msg?.time || 0);
        const text = String(getComparableMessageText(msg) || Utils.getMessageText(msg) || '').trim();
        return `${role}::${speaker}::${time || 0}::${text}`;
    };
    const stableHash = (input) => {
        const str = String(input || '');
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    };
    const readNested = (obj, path) => {
        let cur = obj;
        for (const key of path) {
            if (!cur || typeof cur !== 'object') return undefined;
            cur = cur[key];
        }
        return cur;
    };
    const collectSectionScopeHints = (chat) => {
        const hintPaths = [
            ['sectionId'], ['section', 'id'], ['section', 'name'], ['sectionName'],
            ['branchId'], ['branch', 'id'], ['branchName'],
            ['folderId'], ['folder', 'id'], ['folder', 'name'],
            ['pageId'], ['tabId'], ['roomId'], ['threadId'],
            ['chatroomId'], ['conversationId'], ['sessionId'],
            ['name'], ['title']
        ];
        const hints = [];
        for (const path of hintPaths) {
            const value = readNested(chat, path);
            if (value === undefined || value === null) continue;
            const text = String(value).trim();
            if (text) hints.push(`${path.join('.')}:${text}`);
        }
        return [...new Set(hints)].slice(0, 8);
    };
    const getChatHeadScopeSignature = (chat) => {
        const msgs = getChatMessages(chat)
            .filter(msg => msg && typeof msg === 'object')
            .slice(0, 5)
            .map(getMessageSignature)
            .filter(Boolean);
        // Early chats mutate too frequently; including a head signature before enough
        // messages exist causes rollback journals/session caches to move scopes.
        // Keep the scope stable until the first five message anchors are available.
        if (msgs.length < 5) return '';
        return stableHash(msgs.join('||'));
    };
    const getOrCreatePendingChatScopeNonce = (chat) => {
        if (!chat || typeof chat !== 'object') return `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const existing = String(chat.__libraRuntimeScopeNonce || '').trim();
        if (existing) return existing;
        const created = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        try {
            Object.defineProperty(chat, '__libraRuntimeScopeNonce', {
                value: created,
                writable: true,
                configurable: true,
                enumerable: false
            });
        } catch {
            chat.__libraRuntimeScopeNonce = created;
        }
        return created;
    };
    const getChatRuntimeScopeKey = (chat, char = null) => {
        const explicitChatId = String(chat?.id || '').trim();
        const chatId = explicitChatId || String(getOrCreatePendingChatScopeNonce(chat));
        const charId = String(char?.id || char?.chaId || '');
        const page = String(char?.chatPage ?? chat?.chatPage ?? '');
        const sectionHints = collectSectionScopeHints(chat).join('|');
        const headSignature = explicitChatId ? '' : getChatHeadScopeSignature(chat);
        return [charId, page, chatId, sectionHints, headSignature].join('::');
    };
    const stripLBDATA = (text) => {
        if (!text) return '';
        return String(text)
            .replace(/---\s*\[LBDATA START\][\s\S]*?\[LBDATA END\]\s*---/gi, '')
            .replace(/\[LBDATA START\][\s\S]*?\[LBDATA END\]/gi, '')
            .trim();
    };
    const normalizeKnowledgeText = (value) => String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,.;:!?()\[\]{}"'`~\-]+|[\s,.;:!?()\[\]{}"'`~\-]+$/g, '')
        .trim()
        .toLowerCase();
    function dedupeTextArray(items) {
        const out = [];
        const seen = new Set();
        for (const item of (Array.isArray(items) ? items : [])) {
            const raw = String(item || '').trim();
            if (!raw) continue;
            const key = normalizeKnowledgeText(raw);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(raw);
        }
        return out;
    }
    const normalizeDelimitedList = (value) => dedupeTextArray(String(value || '')
        .split(/\s*[;,]\s*|\s+\|\s+/)
        .map(item => String(item || '').trim())
        .filter(Boolean));
    const pickLatestExplicitField = (value, patterns = []) => {
        const text = String(value || '').trim();
        if (!text) return '';
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (!match) continue;
            const picked = String(match[1] || '').trim().replace(/[.;,\s]+$/g, '').trim();
            if (picked) return picked;
        }
        return '';
    };
    const stripLabeledFragments = (text, patterns = []) => {
        let next = String(text || '');
        for (const pattern of patterns) {
            next = next.replace(pattern, ' ');
        }
        return next.replace(/\s{2,}/g, ' ').replace(/\s+([,;:.])/g, '$1').trim();
    };
    function splitImportedWorldRuleFragments(value) {
        const raw = String(value || '')
            .replace(/\r/g, '\n')
            .replace(/\.\s*,\s*/g, '.\n')
            .replace(/[;；]+/g, '\n')
            .replace(/,\s+(?=[A-Z가-힣])/g, '\n')
            .replace(/\.\s+(?=[A-Z가-힣])/g, '.\n')
            .replace(/\n{2,}/g, '\n');
        return raw
            .split('\n')
            .map(line => String(line || '').replace(/^[\s\-*•·▶▷☞]+/, '').trim())
            .map(line => line.replace(/^[0-9]+[.)]\s*/, '').trim())
            .filter(Boolean);
    }
    const isStructuralWorldScalar = (text) => /^(normal|low|high|linear|nonlinear|non-linear|three_dimensional|two_dimensional|four_dimensional)$/i.test(String(text || '').trim());
    const isDefaultWorldGravity = (text) => /^normal$/i.test(String(text || '').trim());
    const isDefaultWorldTimeFlow = (text) => /^linear$/i.test(String(text || '').trim());
    const isDefaultWorldSpace = (text) => /^three_dimensional$/i.test(String(text || '').trim());
    function normalizeWorldCustomRules(custom) {
        if (Array.isArray(custom)) {
            return Object.fromEntries(
                custom
                    .map((value, index) => [`rule_${index + 1}`, String(value || '').trim()])
                    .filter(([, value]) => value)
            );
        }
        if (typeof custom === 'string') {
            const trimmed = custom.trim();
            return trimmed ? { rule_1: trimmed } : {};
        }
        if (custom && typeof custom === 'object') {
            return Object.fromEntries(
                Object.entries(custom)
                    .map(([key, value]) => {
                        if (value == null) return [String(key || '').trim(), ''];
                        if (typeof value === 'string') return [String(key || '').trim(), value.trim()];
                        if (typeof value === 'number' || typeof value === 'boolean') return [String(key || '').trim(), String(value)];
                        return [String(key || '').trim(), JSON.stringify(value)];
                    })
                    .filter(([key, value]) => key && value)
            );
        }
        return {};
    }
    const WORLD_CANON_EMPTY_FRAGMENT_RE = /^(?:unknown|unk|n\/a|na|none|null|undefined|미상|불명|알 수 없음|알수없음)$/i;
    const isDiscardableWorldCanonFragment = (text) => {
        const raw = String(text || '').trim();
        if (!raw) return true;
        if (WORLD_CANON_EMPTY_FRAGMENT_RE.test(raw)) return true;
        if (isStructuralWorldScalar(raw)) return true;
        if (/^(?:current\s*)?(?:time|location|scene)\s*[:：]\s*/i.test(raw)) return true;
        if (/^(?:현재\s*)?(?:시간|위치|장면)\s*[:：]\s*/i.test(raw)) return true;
        if (/(?:인물|character).{0,24}(?:중요|암시|관계|meaning|important)/i.test(raw)) return true;
        return false;
    };
    function normalizeWorldCanonTextList(value, limit = 24) {
        const fragments = [];
        const visit = (item) => {
            if (item == null) return;
            if (Array.isArray(item)) {
                item.forEach(visit);
                return;
            }
            if (item && typeof item === 'object') {
                for (const key of ['name', 'label', 'summary', 'text', 'value', 'description']) {
                    if (item[key] != null) visit(item[key]);
                }
                return;
            }
            splitImportedWorldRuleFragments(item)
                .map(fragment => String(fragment || '').trim())
                .filter(fragment => !isDiscardableWorldCanonFragment(fragment))
                .forEach(fragment => fragments.push(fragment));
        };
        visit(value);
        return dedupeTextArray(fragments).slice(0, Math.max(1, Number(limit || 24) || 24));
    }
    function normalizeWorldSettingRules(setting = {}) {
        const source = (setting && typeof setting === 'object' && !Array.isArray(setting)) ? setting : {};
        return {
            places: normalizeWorldCanonTextList([
                source.places,
                source.locations,
                source.facilities,
                source.institutions,
                source.landmarks
            ], 24),
            organizations: normalizeWorldCanonTextList([
                source.organizations,
                source.orgs,
                source.departments,
                source.factions,
                source.powerStructure,
                source.power_structure
            ], 24),
            socialRules: normalizeWorldCanonTextList([
                source.socialRules,
                source.social_rules,
                source.culture,
                source.culturalRules,
                source.cultural_rules,
                source.customs,
                source.etiquette,
                source.taboos
            ], 32)
        };
    }
    function classifyWorldCanonStatements(values = []) {
        // LLM-authoritative world routing: only explicit field labels are routed
        // into structured buckets. Unlabelled statements stay in custom rules;
        // local code must not infer "place/org/social/phenomenon" from keywords.
        const out = { places: [], organizations: [], socialRules: [], phenomena: [], custom: [] };
        const statements = normalizeWorldCanonTextList(values, 80);
        const readExplicitWorldBucket = (statement = '') => {
            const text = String(statement || '').trim();
            const match = text.match(/^\s*(places?|locations?|facilit(?:y|ies)|장소|시설|위치|무대|공간|organizations?|orgs?|factions?|groups?|단체|조직|세력|파벌|기관|social\s*rules?|culture|customs?|taboos?|etiquette|rules?|laws?|규칙|법칙|법|문화|관습|금기|예절|phenomena?|phenomenon|anomal(?:y|ies)|현상|이상현상)\s*[:：=-]\s*(.+)$/i);
            if (!match) return { bucket: 'custom', value: text };
            const label = String(match[1] || '').toLowerCase();
            const value = String(match[2] || '').trim();
            if (!value) return { bucket: 'custom', value: text };
            if (/^(?:place|places|location|locations|facility|facilities|장소|시설|위치|무대|공간)$/i.test(label)) return { bucket: 'places', value };
            if (/^(?:organization|organizations|org|orgs|faction|factions|group|groups|단체|조직|세력|파벌|기관)$/i.test(label)) return { bucket: 'organizations', value };
            if (/^(?:phenomenon|phenomena|anomaly|anomalies|현상|이상현상)$/i.test(label)) return { bucket: 'phenomena', value };
            if (/^(?:social\s*rule|social\s*rules|culture|custom|customs|taboo|taboos|etiquette|rule|rules|law|laws|규칙|법칙|법|문화|관습|금기|예절)$/i.test(label)) return { bucket: 'socialRules', value };
            return { bucket: 'custom', value: text };
        };
        for (const statement of statements) {
            const routed = readExplicitWorldBucket(statement);
            out[routed.bucket || 'custom'].push(routed.value || statement);
        }
        return {
            places: dedupeTextArray(out.places).slice(0, 24),
            organizations: dedupeTextArray(out.organizations).slice(0, 24),
            socialRules: dedupeTextArray(out.socialRules).slice(0, 32),
            phenomena: dedupeTextArray(out.phenomena).slice(0, 24),
            custom: dedupeTextArray(out.custom).slice(0, 32)
        };
    }
    function inferWorldClassificationLabel(world = {}, sourceText = '') {
        try {
            if (typeof EntityAwareProcessor !== 'undefined' && typeof EntityAwareProcessor?.inferWorldClassificationLabel === 'function') {
                return EntityAwareProcessor.inferWorldClassificationLabel(world, sourceText);
            }
        } catch {}
        return String(world?.classification?.primary || '').trim();
    }
    function collectWorldRuleEvidenceText(world = {}, extraText = '') {
        const exists = (world?.exists && typeof world.exists === 'object' && !Array.isArray(world.exists)) ? world.exists : {};
        const systems = (world?.systems && typeof world.systems === 'object' && !Array.isArray(world.systems)) ? world.systems : {};
        const physics = (world?.physics && typeof world.physics === 'object' && !Array.isArray(world.physics)) ? world.physics : {};
        const setting = normalizeWorldSettingRules(world?.setting);
        const custom = normalizeWorldCustomRules(world?.custom);
        return [
            String(extraText || '').trim(),
            String(world?.__genreSourceText || '').trim(),
            String(world?.tech || '').trim(),
            String(world?.description || '').trim(),
            String(world?.classification?.primary || '').trim(),
            String(exists.technology || '').trim(),
            ...(Array.isArray(world?.rules) ? world.rules : []),
            ...Object.values(custom).filter(value => !isDiscardableWorldCanonFragment(value)),
            ...setting.places,
            ...setting.organizations,
            ...setting.socialRules,
            ...(Array.isArray(exists.mythical_creatures) ? exists.mythical_creatures : []),
            ...(Array.isArray(exists.non_human_races) ? exists.non_human_races : []),
            ...(Array.isArray(physics.special_phenomena) ? physics.special_phenomena : []),
            Object.keys(systems).filter(key => systems[key]).join(' ')
        ].map(value => String(value || '').trim()).filter(Boolean).join('\n');
    }
    function stripGeneratedWorldRuleEchoes(sourceText = '') {
        return String(sourceText || '').replace(/\s+/g, ' ').trim();
    }
    function hasStrictWorldPresenceSignal(sourceText = '', kind = '') {
        // V5.2.9: text-pattern world detection is intentionally disabled.
        // Presence/absence of metaphysical systems is accepted only from
        // structured LLM world fields or explicit user-correction fields.
        return false;
    }
    function hasExplicitWorldAbsenceSignal(sourceText = '', kind = '') {
        // See hasStrictWorldPresenceSignal(). Raw transcript text must not be
        // interpreted locally as a persistent world rule.
        return false;
    }
    function isModernRealityWorldContext(rules = {}, sourceText = '') {
        // Deprecated heuristic. The LLM classification/exists/systems payload is
        // authoritative; local code no longer decides that a setting is ordinary
        // modern reality from keywords.
        return false;
    }
    function buildWorldRuleMetaEntry(state = 'unknown', explicitness = 'default', emitPolicy = 'silent', evidence = []) {
        return {
            state,
            explicitness,
            emitPolicy,
            evidence: dedupeTextArray((Array.isArray(evidence) ? evidence : [evidence]).map(value => String(value || '').trim()).filter(Boolean)).slice(0, 4)
        };
    }
    function genreSupportsPresence(kind = '', evidenceText = '') {
        // Genre/classification labels are metadata only and never grant rules.
        return false;
    }
    function sanitizeWorldRuleUpdateForPolicy(rules = {}, sourceText = '') {
        const next = (rules && typeof rules === 'object' && !Array.isArray(rules)) ? safeClone(rules) : {};
        next.exists = (next.exists && typeof next.exists === 'object' && !Array.isArray(next.exists)) ? next.exists : {};
        next.systems = (next.systems && typeof next.systems === 'object' && !Array.isArray(next.systems)) ? next.systems : {};
        next.physics = (next.physics && typeof next.physics === 'object' && !Array.isArray(next.physics)) ? next.physics : {};
        next.setting = normalizeWorldSettingRules(next.setting);
        if (next.exists) {
            delete next.exists.currentTime;
            delete next.exists.currentLocation;
            delete next.exists.currentScene;
        }
        if (next.custom) {
            const filteredCustom = {};
            Object.values(normalizeWorldCustomRules(next.custom))
                .flatMap(value => normalizeWorldCanonTextList(value, 12))
                .forEach((value, index) => { filteredCustom[`rule_${index + 1}`] = value; });
            next.custom = filteredCustom;
        }
        if (!next.setting.places.length && !next.setting.organizations.length && !next.setting.socialRules.length) delete next.setting;
        if (next.custom && Object.keys(next.custom).length === 0) delete next.custom;
        const ruleMeta = {
            schema: 'libra.world.rule_meta.v2',
            sourcePolicy: 'llm_structured_fields_only',
            metaphysics: {},
            systems: {},
            consistencyWarnings: [],
            autoDemotions: []
        };

        for (const kind of ['magic', 'ki', 'supernatural']) {
            const value = next.exists[kind];
            if (value === true) {
                ruleMeta.metaphysics[kind] = buildWorldRuleMetaEntry('present', 'llm_structured', 'when_relevant', []);
            } else if (value === false) {
                ruleMeta.metaphysics[kind] = buildWorldRuleMetaEntry('absent', 'llm_structured', 'when_relevant', []);
            } else {
                ruleMeta.metaphysics[kind] = buildWorldRuleMetaEntry('unknown', 'none', 'silent', []);
            }
        }

        for (const key of ['leveling', 'skills', 'stats', 'classes']) {
            const value = next.systems[key];
            if (value === true) {
                ruleMeta.systems[key] = buildWorldRuleMetaEntry('present', 'llm_structured', 'when_relevant', []);
            } else if (value === false) {
                ruleMeta.systems[key] = buildWorldRuleMetaEntry('absent', 'llm_structured', 'when_relevant', []);
            } else {
                ruleMeta.systems[key] = buildWorldRuleMetaEntry('unknown', 'none', 'silent', []);
            }
        }

        next.ruleMeta = {
            ...((next.ruleMeta && typeof next.ruleMeta === 'object' && !Array.isArray(next.ruleMeta)) ? next.ruleMeta : {}),
            ...ruleMeta,
            consistencyWarnings: [],
            autoDemotions: []
        };
        return next;
    }
    function shouldEmitWorldPresentRule(rules = {}, kind = '') {
        const exists = (rules?.exists && typeof rules.exists === 'object' && !Array.isArray(rules.exists)) ? rules.exists : {};
        if (exists[kind] !== true) return false;
        const meta = rules?.ruleMeta?.metaphysics?.[kind] || {};
        if (meta.emitPolicy === 'silent') return false;
        return true;
    }
    function metaAllowsEmit(meta = {}) {
        return meta.emitPolicy && meta.emitPolicy !== 'silent' && (meta.explicitness === 'explicit' || meta.explicitness === 'user_confirmed');
    }
    function shouldEmitWorldAbsentRule(rules = {}, kind = '') {
        const exists = (rules?.exists && typeof rules.exists === 'object' && !Array.isArray(rules.exists)) ? rules.exists : {};
        if (exists[kind] !== false) return false;
        return metaAllowsEmit(rules?.ruleMeta?.metaphysics?.[kind] || {});
    }
    function shouldEmitWorldInactiveSystem(rules = {}, key = '') {
        const systems = (rules?.systems && typeof rules.systems === 'object' && !Array.isArray(rules.systems)) ? rules.systems : {};
        if (systems[key] !== false) return false;
        return metaAllowsEmit(rules?.ruleMeta?.systems?.[key] || {});
    }
    function resolveWorldTemplateKey(classificationLabel, world = {}) {
        // Deprecated compatibility shim. Genre labels are metadata only and no
        // longer expand into hardcoded world templates.
        return '';
    }
    function normalizeWorldRuleUpdate(world) {
        const normalized = {};
        const sourceText = collectWorldRuleEvidenceText(world, String(world?.__genreSourceText || '').trim());
        // Classification is stored as metadata by buildWorldMetaPayload(). It must
        // not auto-create magic/technology/system rules here.
        for (const key of ['exists', 'systems', 'physics', 'setting', 'custom']) {
            if (key === 'setting') {
                const normalizedSetting = normalizeWorldSettingRules({
                    ...(world?.setting && typeof world.setting === 'object' && !Array.isArray(world.setting) ? world.setting : {}),
                    places: [world?.setting?.places, world?.places, world?.locations, world?.facilities],
                    organizations: [world?.setting?.organizations, world?.organizations, world?.orgs, world?.factions],
                    socialRules: [world?.setting?.socialRules, world?.setting?.social_rules, world?.social_rules, world?.socialRules, world?.culture, world?.customs]
                });
                if (normalizedSetting.places.length || normalizedSetting.organizations.length || normalizedSetting.socialRules.length) {
                    normalized.setting = normalizedSetting;
                }
                continue;
            }
            if (key === 'custom') {
                const normalizedCustom = normalizeWorldCustomRules(world?.custom);
                const filteredCustom = {};
                Object.values(normalizedCustom)
                    .flatMap(value => normalizeWorldCanonTextList(value, 12))
                    .forEach((value, index) => { filteredCustom[`rule_${index + 1}`] = value; });
                if (Object.keys(filteredCustom).length > 0) {
                    normalized.custom = {
                        ...(normalized.custom || {}),
                        ...filteredCustom
                    };
                }
                continue;
            }
            if (world?.[key] && typeof world[key] === 'object' && !Array.isArray(world[key])) {
                normalized[key] = {
                    ...(normalized[key] || {}),
                    ...world[key]
                };
            }
        }
        return sanitizeWorldRuleUpdateForPolicy(normalized, sourceText);
    }
    function extractWorldRuleHighlights(rules = {}, limit = 6) {
        const normalizedRules = sanitizeWorldRuleUpdateForPolicy(rules, collectWorldRuleEvidenceText(rules));
        const exists = (normalizedRules?.exists && typeof normalizedRules.exists === 'object' && !Array.isArray(normalizedRules.exists)) ? normalizedRules.exists : {};
        const systems = (normalizedRules?.systems && typeof normalizedRules.systems === 'object' && !Array.isArray(normalizedRules.systems)) ? normalizedRules.systems : {};
        const physics = (normalizedRules?.physics && typeof normalizedRules.physics === 'object' && !Array.isArray(normalizedRules.physics)) ? normalizedRules.physics : {};
        const setting = normalizeWorldSettingRules(normalizedRules?.setting);
        const custom = normalizeWorldCustomRules(normalizedRules?.custom);
        const highlights = [];

        setting.places.forEach(value => highlights.push(`장소/시설: ${value}`));
        setting.organizations.forEach(value => highlights.push(`조직: ${value}`));
        setting.socialRules.forEach(value => highlights.push(`사회 규칙: ${value}`));

        Object.values(custom)
            .flatMap(value => splitImportedWorldRuleFragments(value))
            .map(value => String(value || '').trim())
            .filter(value => value && !isDiscardableWorldCanonFragment(value))
            .forEach(value => highlights.push(value));

        if (systems.leveling) highlights.push('레벨 시스템');
        if (systems.skills) highlights.push('스킬 시스템');
        if (systems.stats) highlights.push('스탯 시스템');
        if (systems.classes) highlights.push('직업 시스템');
        if (systems.guilds) highlights.push('길드');
        if (systems.factions) highlights.push('세력');
        if (shouldEmitWorldPresentRule(normalizedRules, 'magic')) highlights.push('마법 존재');
        if (shouldEmitWorldPresentRule(normalizedRules, 'ki')) highlights.push('기(氣) 존재');
        if (shouldEmitWorldPresentRule(normalizedRules, 'supernatural')) highlights.push('초자연 존재');
        if (Array.isArray(exists.mythical_creatures)) highlights.push(...exists.mythical_creatures.map(value => String(value || '').trim()).filter(Boolean));
        if (Array.isArray(exists.non_human_races)) highlights.push(...exists.non_human_races.map(value => String(value || '').trim()).filter(Boolean));
        if (exists.technology) highlights.push(`기술: ${String(exists.technology).trim()}`);
        if (physics.dimensionStability) highlights.push(`차원 안정성: ${String(physics.dimensionStability).trim()}`);
        if (Array.isArray(physics.special_phenomena)) {
            physics.special_phenomena
                .flatMap(value => splitImportedWorldRuleFragments(value))
                .map(value => String(value || '').trim())
                .filter(value => value && !isStructuralWorldScalar(value))
                .forEach(value => highlights.push(value));
        }
        if (shouldEmitWorldAbsentRule(normalizedRules, 'magic')) highlights.push('마법 없음');
        if (shouldEmitWorldAbsentRule(normalizedRules, 'ki')) highlights.push('기 없음');
        if (shouldEmitWorldAbsentRule(normalizedRules, 'supernatural')) highlights.push('초자연 없음');
        if (physics.gravity && !isDefaultWorldGravity(physics.gravity)) highlights.push(`중력: ${String(physics.gravity).trim()}`);
        if ((physics.time_flow || physics.timeFlow) && !isDefaultWorldTimeFlow(physics.time_flow || physics.timeFlow)) {
            highlights.push(`시간 흐름: ${String(physics.time_flow || physics.timeFlow).trim()}`);
        }
        if (physics.space && !isDefaultWorldSpace(physics.space)) highlights.push(`공간: ${String(physics.space).trim()}`);

        return dedupeTextArray(highlights.map(value => String(value || '').trim()).filter(Boolean)).slice(0, Math.max(1, Number(limit || 0)));
    }
    function buildWorldMetaPayload(world = {}, existingMeta = {}) {
        const currentMeta = (existingMeta && typeof existingMeta === 'object') ? existingMeta : {};
        const currentWorldMetadata = (currentMeta.worldMetadata && typeof currentMeta.worldMetadata === 'object')
            ? safeClone(currentMeta.worldMetadata)
            : {};
        const sourceText = String(world?.__genreSourceText || currentWorldMetadata.sourceText || '').trim();
        const classification = String(
            world?.classification?.primary
            || inferWorldClassificationLabel(world, sourceText)
            || currentMeta.classification
            || currentWorldMetadata.classification
            || ''
        ).trim();
        const customRuleSummary = Object.values(normalizeWorldCustomRules(world?.custom))
            .flatMap(value => splitImportedWorldRuleFragments(value))
            .map(value => String(value || '').trim())
            .filter(value => value && !isDiscardableWorldCanonFragment(value));
        const setting = normalizeWorldSettingRules(world?.setting);
        const rawSummaryParts = dedupeTextArray([
            String(world?.summary || '').trim(),
            String(world?.description || '').trim(),
            String(world?.tech || '').trim(),
            ...(Array.isArray(world?.rules) ? world.rules.map(item => String(item || '').trim()) : []),
            ...setting.places.map(value => `Place/Facility: ${value}`),
            ...setting.organizations.map(value => `Organization: ${value}`),
            ...setting.socialRules.map(value => `Social rule: ${value}`),
            ...customRuleSummary
        ].filter(value => !isDiscardableWorldCanonFragment(value)));
        const fallbackSummary = String(currentMeta.worldSummary || currentWorldMetadata.summary || '').trim();
        const shortSummary = String(world?.summary || currentWorldMetadata.summary || fallbackSummary || '').trim();

        return {
            classification,
            worldSummary: truncateForLLM(rawSummaryParts.join('\n') || fallbackSummary, 1200, ' ... '),
            worldMetadata: {
                ...currentWorldMetadata,
                classification,
                tech: String(world?.tech || currentWorldMetadata.tech || '').trim(),
                description: truncateForLLM(String(world?.description || currentWorldMetadata.description || '').trim(), 500, ' ... '),
                summary: truncateForLLM(shortSummary, 700, ' ... '),
                sourceText: truncateForLLM(sourceText, 1200, ' ... ')
            }
        };
    }
    function buildWorldCorrectionNote(world = {}, reasonText = '') {
        const parts = [];
        const classification = String(
            world?.classification?.primary
            || inferWorldClassificationLabel(world, String(world?.__genreSourceText || '').trim())
            || ''
        ).trim();
        if (classification) parts.push(`분류:${classification}`);
        const ruleHighlights = extractWorldRuleHighlights(normalizeWorldRuleUpdate(world), 4);
        if (ruleHighlights.length > 0) parts.push(`규칙:${ruleHighlights.join(', ')}`);
        const normalizedReason = String(reasonText || '').replace(/^Auto-corrected:\s*/i, '').replace(/^Auto-corrected$/i, '').trim();
        if (normalizedReason) parts.push(`보정:${normalizedReason}`);
        return truncateForLLM(dedupeTextArray(parts).join(' | '), 220, ' ... ');
    }
    const REVIEW_EXCERPT_MAX_CHARS = 5000;
    const truncateForLLM = (value, maxChars, marker = '\n...[TRUNCATED]...\n') => {
        const text = String(value || '');
        const limit = Math.max(0, Number(maxChars) || 0);
        if (!limit || text.length <= limit) return text;
        if (limit <= marker.length + 20) return text.slice(0, limit);
        const remain = limit - marker.length;
        const headSize = Math.ceil(remain * 0.6);
        const tailSize = Math.max(0, remain - headSize);
        return `${text.slice(0, headSize)}${marker}${tailSize > 0 ? text.slice(-tailSize) : ''}`;
    };
    const buildConversationExcerpt = (msgs, maxChars = REVIEW_EXCERPT_MAX_CHARS) => {
        const list = Array.isArray(msgs) ? msgs.filter(msg => msg && typeof msg === 'object') : [];
        if (list.length === 0) return '';
        const lines = [];
        let total = 0;
        for (let i = list.length - 1; i >= 0; i--) {
            const entry = list[i];
            const msg = entry?.msg && typeof entry.msg === 'object' ? entry.msg : entry;
            const role = getMessageRoleHint(entry) === 'user' ? 'User' : 'Assistant';
            const rawText = typeof entry?.text === 'string' ? entry.text : Utils.getMessageText(msg);
            const text = String(rawText || '').trim();
            if (!text) continue;
            const line = `[${role}] ${truncateForLLM(text, 700, ' ...[TRUNCATED]... ')}`;
            if (total + line.length > maxChars && lines.length > 0) break;
            lines.unshift(line);
            total += line.length + 1;
            if (total >= maxChars) break;
        }
        return lines.join('\n');
    };
    const LIBRA_CANONICAL_ASSISTANT_EVIDENCE_POLICY = [
        '[Canonical Evidence Policy]',
        '- Assistant/AI output is the canonical evidence for events, locations, states, relationships, memories, world facts, and narrative progress.',
        '- User messages are request metadata only. Do not treat a requested action as something that happened unless assistant evidence depicts it.',
        '- If a user request conflicts with assistant evidence, assistant evidence wins.'
    ].join('\n');
    const getAssistantCanonicalTextFromMessage = (item) => {
        const msg = item?.msg && typeof item.msg === 'object' ? item.msg : item;
        if (!msg) return '';
        if (getMessageRoleHint(item) === 'user') return '';
        const rawText = typeof item?.text === 'string' ? item.text : Utils.getMessageText(msg);
        return String(
            Utils.getNarrativeComparableText(rawText, 'ai')
            || Utils.getMemorySourceText(rawText)
            || ''
        ).trim();
    };
    const buildAssistantCanonicalTranscript = (items, options = {}) => {
        const list = Array.isArray(items) ? items.filter(Boolean) : [];
        if (list.length === 0) return '';
        const maxChars = Math.max(0, Number(options.maxChars || REVIEW_EXCERPT_MAX_CHARS) || REVIEW_EXCERPT_MAX_CHARS);
        const perItemChars = Math.max(200, Number(options.perItemChars || 2400) || 2400);
        const includeTurn = options.includeTurn !== false;
        const turnByIndex = Array.isArray(options.turnByIndex) ? options.turnByIndex : [];
        const baseTurn = normalizeLegacyMemoryTurnAnchor(options.baseTurn || 0) || 1;
        const startIndex = Math.max(0, Number(options.startIndex || 0) || 0);
        const safeMaxTurn = normalizeLegacyMemoryTurnAnchor(options.maxTurn || 0) || 0;
        const blocks = [];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const text = getAssistantCanonicalTextFromMessage(item);
            if (!text) continue;
            const mappedTurn = normalizeLegacyMemoryTurnAnchor(turnByIndex[i] || 0);
            const rawTurn = mappedTurn || normalizeLegacyMemoryTurnAnchor(item?.turn || 0) || (baseTurn + startIndex + i);
            const turn = safeMaxTurn ? Math.min(rawTurn, safeMaxTurn) : rawTurn;
            blocks.push([
                includeTurn ? `[Turn ${turn}]` : '',
                `[Assistant]\n${truncateForLLM(text, perItemChars, '\n...[TRUNCATED]...\n')}`
            ].filter(Boolean).join('\n'));
        }
        return truncateForLLM(blocks.join('\n\n'), maxChars, '\n...[TRUNCATED CANONICAL ASSISTANT EVIDENCE]...\n');
    };
    const buildAssistantCanonicalTranscriptFromPairs = (pairs, options = {}) => {
        const source = Array.isArray(pairs) ? pairs : [];
        const maxChars = Math.max(0, Number(options.maxChars || 12000) || 12000);
        const perItemChars = Math.max(200, Number(options.perItemChars || 2400) || 2400);
        const baseTurn = normalizeLegacyMemoryTurnAnchor(options.baseTurn || 0) || 1;
        const startIndex = Math.max(0, Number(options.startIndex || 0) || 0);
        const turnByIndex = Array.isArray(options.turnByIndex) ? options.turnByIndex : [];
        const safeMaxTurn = normalizeLegacyMemoryTurnAnchor(options.maxTurn || 0) || 0;
        const blocks = source.map((pair, idx) => {
            const text = String(pair?.canonicalEvidenceText || pair?.aiText || '').trim();
            if (!text) return '';
            const mappedTurn = normalizeLegacyMemoryTurnAnchor(turnByIndex[idx] || 0);
            const rawTurn = mappedTurn || normalizeLegacyMemoryTurnAnchor(pair?.turn || 0) || (baseTurn + startIndex + idx);
            const turn = safeMaxTurn ? Math.min(rawTurn, safeMaxTurn) : rawTurn;
            return [
                `[Turn ${turn}]`,
                `[Canonical Assistant Evidence]`,
                truncateForLLM(text, perItemChars, '\n...[TRUNCATED]...\n')
            ].join('\n');
        }).filter(Boolean);
        return truncateForLLM(blocks.join('\n\n'), maxChars, '\n...[TRUNCATED CANONICAL ASSISTANT EVIDENCE]...\n');
    };

    // ══════════════════════════════════════════════════════════════
    // [UTILITY] State Management
    // ══════════════════════════════════════════════════════════════
    const MemoryState = {
        gcCursor: 0,
        hashIndex: new Map(),
        metaCache: null,
        simCache: null,
        embeddingCache: null,
        standardLoreTokenCache: null,
        hybridRowCache: null,
        hmeScopeIndexByScope: new Map(),
        hmeGraphIndexByScope: new Map(), // HME-derived associative graph recall index cache by chat scope
        hmeGraphStaleRebuildByScope: new Map(), // throttle HME graph self-repair rebuilds by chat scope
        libraProjectionDigestByScope: new Map(), // latest projection lorebook digest by chat scope
        sessionCache: new Map(),
        rollbackSnapshotsByScope: new Map(), // V4.2-style stable lore/runtime rollback snapshots by chat scope
        rollbackJournalBaselineByScope: new Map(), // RE-style rollback journal latest beforeRequest baseline by chat scope
        rollbackJournalRestoredTurnByChatId: new Map(), // one-shot restored turn floor after Stage-2 rollback restore
        rollbackJournalColdStartByScope: new Map(), // Stage-4 long rollback fallback cold-start augment guard
        characterLoreEmbeddingCache: new Map(), // runtime-only semantic cache for character/lorebook cue vectors
        characterLoreIndexStatusByScope: new Map(), // runtime diagnostics for character/lorebook cue index
        emergencySnapshotByScope: new Map(), // manual/emergency rollback snapshot bucket
        finalizedTurnMetaByScope: new Map(), // V4.2-style finalized turn anchor metadata by chat scope
        liveSyncStateByScope: new Map(), // latest observed live-chat state by scope
        commitRevisionByScope: new Map(), // lightweight commit revision marker for diagnostics
        rollbackTracker: new Map(), // { msg_id: [lore_keys] }
        debugRecentTurnsByScope: new Map(), // plugin-storage debug export ring: latest two turn buckets per scope
        runtimeDebugRequestsByKey: new Map(), // request traces persisted to pluginStorage for recent debug exports
        runtimeDebugRecentRequestKeys: [],
        runtimeDebugProviderCalls: [],
        runtimeDebugCurrentRequestKey: '',
        runtimeDebugStorageFlushTimersByScope: new Map(),
        runtimeDebugStorageStatusByScope: new Map(),
        suppressedErrorStatsByKey: new Map(),
        pendingTurnCommits: new Map(), // { chat_id: pending turn payload }
        pendingTurnCommitLocksByScope: new Map(), // serialized pending turn finalization by stable chat scope
        pendingFinalizeRetryTimersByScope: new Map(), // delayed post-afterRequest stabilization retries
        deferredGcByScope: new Map(), // background locked GC throttles by chat scope
        afterRequestOriginsByType: new Map(), // { request_type: [{ chatId, canonicalUser, requestSequence, ... }] }
        recentNarrativeOriginByScope: new Map(), // latest beforeRequest origin per chat scope
        recentMainResponseTransportByChatId: new Map(), // latest main response transport hint per chat id
        recentMainResponseOutputCaptureByChatId: new Map(), // latest streamed output capture per chat id
        streamOutputRecoveryTimersByChatId: new Map(), // stream output recovery timers
        afterRequestMissingRecoveryTimersByChatId: new Map(), // fallback timers when afterRequest never fires
        turnMaintenanceSchedulesByChatId: new Map(), // debounced/coalesced background maintenance slots
        afterRequestForegroundTasksByScope: new Map(), // foreground afterRequest analysis tasks that beforeRequest must await
        turnMaintenanceLocksByChatId: new Map(), // serialized foreground/background maintenance by chat id
        transientMissing: new Map(), // { msg_id: { since, reason } }
        activityDashboard: {
            visible: false,
            mode: 'compact',
            phase: 'idle',
            status: 'idle',
            message: '',
            scopeKey: '',
            requestId: '',
            startedAt: 0,
            updatedAt: 0,
            finishedAt: 0,
            progress: 0,
            steps: [],
            events: [],
            injection: null,
            forceVisible: false
        },
        activityDashboardTimer: null,
        activityDashboardTicker: null,
        afterRequestOriginSequence: 0,
        currentSessionId: null,
        _activeChatId: null,
        _activeScopeKey: null,
        isSessionRestored: false,
        ignoredGreetingSignature: null,
        greetingIsolationChatId: null,
        greetingIsolationRearmAvailable: false,
        pendingGreetingIsolationChatId: null,
        pendingGreetingIsolationArmed: false,
        isInitialized: false,
        currentTurn: 0,
        initVersion: 0,
        refreshStabilizeUntil: 0,
        refreshDeleteBlockUntil: 0,

        reset(opts = {}) {
            const { preserveSessionCache = false } = opts || {};
            this.gcCursor = 0;
            this.hashIndex.clear();
            this.metaCache?.cache?.clear();
            this.simCache?.cache?.clear();
            this.embeddingCache?.cache?.clear();
            this.standardLoreTokenCache?.cache?.clear();
            this.hybridRowCache?.cache?.clear();
            this.hmeScopeIndexByScope.clear();
            this.hmeGraphIndexByScope.clear();
            this.hmeGraphStaleRebuildByScope.clear();
            this.libraProjectionDigestByScope.clear();
            if (!preserveSessionCache) this.sessionCache.clear();
            if (!preserveSessionCache) this.rollbackSnapshotsByScope.clear();
            if (!preserveSessionCache) this.rollbackJournalBaselineByScope.clear();
            if (!preserveSessionCache) this.rollbackJournalColdStartByScope.clear();
            if (!preserveSessionCache) this.characterLoreEmbeddingCache.clear();
            if (!preserveSessionCache) this.characterLoreIndexStatusByScope.clear();
            if (!preserveSessionCache) this.emergencySnapshotByScope.clear();
            this.finalizedTurnMetaByScope.clear();
            this.liveSyncStateByScope.clear();
            this.commitRevisionByScope.clear();
            this.rollbackTracker.clear();
            if (!preserveSessionCache) this.debugRecentTurnsByScope.clear();
            if (!preserveSessionCache) this.runtimeDebugRequestsByKey.clear();
            if (!preserveSessionCache) this.runtimeDebugRecentRequestKeys = [];
            if (!preserveSessionCache) this.runtimeDebugProviderCalls = [];
            if (!preserveSessionCache) this.runtimeDebugCurrentRequestKey = '';
            if (!preserveSessionCache) this.suppressedErrorStatsByKey.clear();
            if (!preserveSessionCache) {
                this.runtimeDebugStorageFlushTimersByScope.forEach(timer => { try { clearTimeout(timer); } catch (_) {} });
                this.runtimeDebugStorageFlushTimersByScope.clear();
                this.runtimeDebugStorageStatusByScope.clear();
            }
            this.pendingTurnCommits.clear();
            this.pendingTurnCommitLocksByScope.clear();
            this.pendingFinalizeRetryTimersByScope.forEach(entry => { try { clearTimeout(entry?.timer); } catch (_) {} });
            this.pendingFinalizeRetryTimersByScope.clear();
            this.deferredGcByScope.forEach(entry => { try { clearTimeout(entry?.timer); } catch (_) {} });
            this.deferredGcByScope.clear();
            this.afterRequestOriginsByType.clear();
            this.recentNarrativeOriginByScope.clear();
            this.recentMainResponseTransportByChatId.clear();
            this.recentMainResponseOutputCaptureByChatId.clear();
            this.streamOutputRecoveryTimersByChatId.forEach(entry => { try { clearTimeout(entry?.timer); } catch (_) {} });
            this.streamOutputRecoveryTimersByChatId.clear();
            this.afterRequestMissingRecoveryTimersByChatId.forEach(entry => { try { clearTimeout(entry?.timer); } catch (_) {} });
            this.afterRequestMissingRecoveryTimersByChatId.clear();
            this.turnMaintenanceSchedulesByChatId.forEach(entry => { try { clearTimeout(entry?.timer); } catch (_) {} });
            this.turnMaintenanceSchedulesByChatId.clear();
            this.afterRequestForegroundTasksByScope.clear();
            this.turnMaintenanceLocksByChatId.clear();
            this.transientMissing.clear();
            if (this.activityDashboardTimer) {
                try { clearTimeout(this.activityDashboardTimer); } catch (_) {}
                this.activityDashboardTimer = null;
            }
            if (this.activityDashboardTicker) {
                try { clearInterval(this.activityDashboardTicker); } catch (_) {}
                this.activityDashboardTicker = null;
            }
            this.activityDashboard = {
                visible: false,
                mode: 'compact',
                phase: 'idle',
                status: 'idle',
                message: '',
                scopeKey: '',
                requestId: '',
                startedAt: 0,
                updatedAt: 0,
                finishedAt: 0,
                progress: 0,
                steps: [],
                events: [],
                injection: null,
                forceVisible: false
            };
            this.afterRequestOriginSequence = 0;
            this.currentTurn = 0;
            this.initVersion++;
            this.refreshStabilizeUntil = 0;
            this.refreshDeleteBlockUntil = 0;
            this.greetingIsolationChatId = null;
            this.greetingIsolationRearmAvailable = false;
            this.pendingGreetingIsolationChatId = null;
            this.pendingGreetingIsolationArmed = false;
            this._activeScopeKey = null;
        }
    };

    const REFRESH_STABILIZE_MS = 2500;
    const REFRESH_DELETE_BLOCK_MS = 15000;
    const SESSION_CACHE_LIMIT = 24;
    const enterRefreshStabilizeWindow = () => {
        const now = Date.now();
        MemoryState.refreshStabilizeUntil = Math.max(MemoryState.refreshStabilizeUntil || 0, now + REFRESH_STABILIZE_MS);
        MemoryState.refreshDeleteBlockUntil = Math.max(MemoryState.refreshDeleteBlockUntil || 0, now + REFRESH_DELETE_BLOCK_MS);
        MemoryState.transientMissing.clear();
    };
    const isRefreshStabilizing = () => Date.now() < (MemoryState.refreshStabilizeUntil || 0);
    const isRefreshDeleteBlocked = () => Date.now() < (MemoryState.refreshDeleteBlockUntil || 0);
    const getChatMemoryScopeKey = (chat, char = null) => getChatRuntimeScopeKey(chat, char);
    const buildScopedSessionId = (scopeKey) => `sess_${stableHash(scopeKey || 'global')}_${Date.now()}`;
    const captureScopedRuntimeState = () => ({
        narrative: safeClone(NarrativeTracker.getState?.() || { storylines: [], turnLog: [], lastSummaryTurn: 0 }),
        storyAuthor: safeClone(StoryAuthor.getState?.() || {}),
        director: safeClone(Director.getState?.() || {}),
        charStates: safeClone(CharacterStateTracker.getState?.() || {}),
        worldStates: safeClone(WorldStateTracker.getState?.() || {}),
        secretKnowledge: safeClone(SecretKnowledgeCore?.getState?.() || null),
        entityKnowledgeVault: safeClone(EntityKnowledgeVaultCore?.getState?.() || null),
        timeEngine: safeClone(TimeEngine?.getState?.() || null),
        sectionWorld: safeClone(SectionWorldInferenceManager.getState?.() || {})
    });
    const rememberScopedRuntimeState = (scopeKey) => {
        const key = String(scopeKey || '').trim();
        if (!key) return;
        if (MemoryState.sessionCache.has(key)) {
            MemoryState.sessionCache.delete(key);
        }
        MemoryState.sessionCache.set(key, captureScopedRuntimeState());
        while (MemoryState.sessionCache.size > SESSION_CACHE_LIMIT) {
            const oldestKey = MemoryState.sessionCache.keys().next().value;
            if (!oldestKey) break;
            MemoryState.sessionCache.delete(oldestKey);
        }
    };
    const restoreScopedRuntimeState = (scopeKey) => {
        const key = String(scopeKey || '').trim();
        if (!key || !MemoryState.sessionCache.has(key)) return false;
        const snapshot = MemoryState.sessionCache.get(key);
        MemoryState.sessionCache.delete(key);
        MemoryState.sessionCache.set(key, snapshot);
        NarrativeTracker.resetState(snapshot?.narrative || { storylines: [], turnLog: [], lastSummaryTurn: 0 });
        if (typeof StoryAuthor?.resetState === 'function') StoryAuthor.resetState(snapshot?.storyAuthor || null);
        if (typeof Director?.resetState === 'function') Director.resetState(snapshot?.director || null);
        CharacterStateTracker.resetState(snapshot?.charStates || {});
        WorldStateTracker.resetState(snapshot?.worldStates || {});
        if (typeof SecretKnowledgeCore?.resetState === 'function') SecretKnowledgeCore.resetState(snapshot?.secretKnowledge || null);
        if (typeof EntityKnowledgeVaultCore?.resetState === 'function') EntityKnowledgeVaultCore.resetState(snapshot?.entityKnowledgeVault || null);
        if (typeof TimeEngine?.resetState === 'function') TimeEngine.resetState(snapshot?.timeEngine || null);
        SectionWorldInferenceManager.loadState(snapshot?.sectionWorld || null);
        return true;
    };
    const PENDING_FINALIZE_MIN_MS = 3500;
    const PENDING_FINALIZE_REQUIRED_MATCHES = 2;
    const PENDING_STALE_MS = 180000;
    const AFTER_REQUEST_ORIGIN_TTL_MS = 600000;
    const MAX_AFTER_REQUEST_ORIGINS_PER_TYPE = 10;
    const MAIN_RESPONSE_TRANSPORT_HINT_TTL_MS = 120000;
    const MAIN_RESPONSE_OUTPUT_CAPTURE_TTL_MS = 30 * 60 * 1000;
    const RESPONSE_STREAMING_RECOVERY_INITIAL_MS = 5000;
    const RESPONSE_STREAMING_RECOVERY_RETRY_MS = 5000;
    const RESPONSE_STREAMING_RECOVERY_MAX_ATTEMPTS = 360;
    const RESPONSE_STREAMING_IDLE_SETTLE_MS = 15 * 1000;
    const RESPONSE_STREAMING_IDLE_MIN_REQUEST_AGE_MS = 20 * 1000;
    const RESPONSE_STREAMING_STALE_SETTLE_MS = 2 * 60 * 1000;
    const RESPONSE_STREAMING_FORCE_SETTLE_MS = 30 * 60 * 1000;
    const BACKGROUND_MAINTENANCE_DEBOUNCE_MS = 8000;
    const BACKGROUND_MAINTENANCE_COOLDOWN_MS = 20000;
    const LIBRA_MAIN_RESPONSE_TRANSPORT_INTERCEPTOR_KEY = '__LIBRA_MAIN_RESPONSE_TRANSPORT_INTERCEPTOR__';
    const UI_INTERACTION_BLOCK_MS = 1200;
    const UI_INTERACTION_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'];
    const LIBRA_UI_GUARD_CLEANUP_KEY = '__LIBRA_UI_GUARD_CLEANUP__';
    const ROLLBACK_SNAPSHOT_LIMIT_PER_SCOPE = 1; // Volatile runtime fallback also keeps only the latest turn.
    const RUNTIME_SCOPE_RECORD_TTL_MS = 60 * 60 * 1000;
    const LIBRA_LAUNCHER_BUTTON_ID = 'lmai-button';
    let uiInteractionHotUntil = 0;
    let uiInteractionListenersBound = false;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
    const isLibraDebugEnabled = () => {
        try {
            return typeof MemoryEngine !== 'undefined' && !!MemoryEngine.CONFIG?.debug;
        } catch {
            return false;
        }
    };
    const isIllustrationModuleCompatEnabled = () => {
        try {
            return typeof MemoryEngine !== 'undefined' && MemoryEngine.CONFIG?.bypassAuxRequests !== false;
        } catch {
            return false;
        }
    };
    const isNsfwGuidanceEnabled = () => {
        try {
            return typeof MemoryEngine !== 'undefined' && !!MemoryEngine.CONFIG?.nsfwEnabled;
        } catch {
            return false;
        }
    };
    const NSFW_GUIDANCE_LINES = [
        'Mature creative-writing guidance is enabled for this scene.',
        'Handle adult themes only when they are relevant to the user-requested fiction and established scene context.',
        'Keep mature material grounded in consent, continuity, character psychology, tone, and concrete scene consequences.',
        'Preserve literary quality, pacing, emotional realism, and aftermath instead of treating intimacy as isolated from the story.',
        'Respect the active model/provider safety boundaries while keeping the prose coherent and useful.'
    ];
    const PREFILL_NSFW_LINES = [
        'Understood.',
        'This request contains mature themes for a legitimate creative writing project.',
        'I will handle all content with literary purpose and artistic integrity, as is standard for adult fiction publishing.',
        'Let me begin crafting the narrative.'
    ];
    const PREFILL_DEFAULT_LINES = [
        'Understood!',
        'I shall craft this scene with literary care.',
        'Let me begin weaving the narrative.'
    ];
    const CREATIVE_WRITING_STYLE_LINES = [
        'Write polished narrative fiction with clear scene continuity and literary tone.',
        'Stay grounded in character motivation, pacing, sensory detail, and consequence.',
        'Treat the request as a creative-writing workflow unless the user explicitly asks for analysis instead of prose.',
        'Avoid unnecessary meta commentary, disclaimers, or out-of-story explanation when prose is requested.',
        'When a scene is emotionally intense, intimate, violent, or morally complex, preserve character psychology and narrative causality.',
        'Favor vivid, coherent, scene-faithful narration over vague abstraction.',
        'Respect the active model/provider safety boundaries while keeping the prose immersive and useful.'
    ];
    const buildNsfwGuidanceBlock = (title = 'NSFW Guidance') => {
        if (!isNsfwGuidanceEnabled()) return '';
        return [`【${title}】`, ...NSFW_GUIDANCE_LINES].join('\n');
    };
    const buildCreativeWritingGuidanceBlock = (title = 'Creative Writing Guidance') => {
        return [`【${title}】`, ...CREATIVE_WRITING_STYLE_LINES].join('\n');
    };
    const buildPrefillBlock = () => {
        if (!isNsfwGuidanceEnabled()) return '';
        const lines = isNsfwGuidanceEnabled() ? PREFILL_NSFW_LINES : PREFILL_DEFAULT_LINES;
        return `<assistant>\n${lines.join('\n')}\n</assistant>`;
    };
    const buildFullSystemPrompt = (...parts) => {
        return [
            buildCreativeWritingGuidanceBlock(),
            buildNsfwGuidanceBlock(),
            ...parts.filter(Boolean),
            '---',
            'The main instruction will follow.',
            buildPrefillBlock()
        ].filter(Boolean).join('\n\n');
    };
    function resolveColdStartHistoryLimit(preset, fallbackLimit = 100) {
        const normalizedPreset = String(preset || 'all').trim().toLowerCase();
        if (normalizedPreset === 'all') return 0;
        const presetLimits = {
            recent100: 100,
            recent200: 200,
            recent500: 500,
            last100: 100,
            last200: 200,
            last500: 500
        };
        if (Object.prototype.hasOwnProperty.call(presetLimits, normalizedPreset)) return presetLimits[normalizedPreset];
        const numericFallback = Number(fallbackLimit);
        if (Number.isFinite(numericFallback) && numericFallback > 0) return Math.max(1, Math.floor(numericFallback));
        return 100;
    }
    const markUiInteractionHot = () => {
        uiInteractionHotUntil = Math.max(uiInteractionHotUntil, Date.now() + UI_INTERACTION_BLOCK_MS);
    };
    const unbindUiInteractionGuards = () => {
        if (typeof document !== 'undefined') {
            UI_INTERACTION_EVENTS.forEach((eventName) => {
                document.removeEventListener(eventName, markUiInteractionHot, true);
            });
        }
        uiInteractionListenersBound = false;
        if (typeof globalThis !== 'undefined' && globalThis[LIBRA_UI_GUARD_CLEANUP_KEY] === unbindUiInteractionGuards) {
            delete globalThis[LIBRA_UI_GUARD_CLEANUP_KEY];
        }
    };
    const bindUiInteractionGuards = () => {
        if (typeof document === 'undefined') return;
        const existingCleanup = typeof globalThis !== 'undefined' ? globalThis[LIBRA_UI_GUARD_CLEANUP_KEY] : null;
        if (typeof existingCleanup === 'function' && existingCleanup !== unbindUiInteractionGuards) {
            existingCleanup();
        }
        if (uiInteractionListenersBound) return;
        uiInteractionListenersBound = true;
        UI_INTERACTION_EVENTS.forEach((eventName) => {
            document.addEventListener(eventName, markUiInteractionHot, true);
        });
        if (typeof globalThis !== 'undefined') {
            globalThis[LIBRA_UI_GUARD_CLEANUP_KEY] = unbindUiInteractionGuards;
        }
    };
    const tryRearmGreetingIsolation = (chat) => {
        const chatId = chat?.id || null;
        if (!chatId) return false;
        if (MemoryState.pendingGreetingIsolationArmed) return false;
        if (!MemoryState.greetingIsolationRearmAvailable) return false;
        if (MemoryState.greetingIsolationChatId !== chatId) return false;
        if (!MemoryState.ignoredGreetingSignature) return false;

        const msgs = getChatMessages(chat);
        if (!Array.isArray(msgs) || msgs.length !== 1) return false;
        const onlyMsg = msgs[0];
        if (!onlyMsg || isUserLikeMessage(onlyMsg)) return false;
        if (getMessageSignature(onlyMsg) !== MemoryState.ignoredGreetingSignature) return false;

        MemoryState.pendingGreetingIsolationChatId = chatId;
        MemoryState.pendingGreetingIsolationArmed = true;
        MemoryState.greetingIsolationRearmAvailable = false;
        return true;
    };
    const normalizeRisuIndex = (value) => {
        const n = Number(value);
        return Number.isInteger(n) && n >= 0 ? n : -1;
    };
    const resolveActiveChatContext = async (preferredChat = null) => {
        try {
            let char = null;
            try { char = await RisuCompat.getCharacter(); } catch (_) {}
            const rawCharIdx = await RisuCompat.getCurrentCharacterIndex();
            let charIdx = normalizeRisuIndex(rawCharIdx);
            let chatIndex = normalizeRisuIndex(await RisuCompat.getCurrentChatIndex());
            if (chatIndex < 0) chatIndex = normalizeRisuIndex(char?.chatPage);

            if (!char && charIdx >= 0 && RisuCompat.has('getCharacterFromIndex')) {
                try { char = await RisuCompat.getCharacterFromIndex(charIdx); } catch (_) {}
            }
            if (!char) return { char: null, charIdx: -1, rawCharIdx, chat: null, chatIndex: -1, scopeKey: '' };

            const chats = Array.isArray(char?.chats) ? char.chats : [];
            if (preferredChat?.id) {
                const resolved = chats.findIndex(entry => String(entry?.id || '') === String(preferredChat.id));
                if (resolved >= 0) chatIndex = resolved;
            }

            let chat = null;
            if (charIdx >= 0 && chatIndex >= 0 && RisuCompat.has('getChatFromIndex')) {
                try { chat = await RisuCompat.getChatFromIndex(charIdx, chatIndex); } catch (_) {}
            }
            if (!chat && chatIndex >= 0) chat = chats?.[chatIndex] || null;
            if (!chat && typeof char?.chatPage !== 'undefined') {
                const fallbackIndex = normalizeRisuIndex(char.chatPage);
                if (fallbackIndex >= 0) {
                    chatIndex = fallbackIndex;
                    chat = chats?.[fallbackIndex] || null;
                }
            }
            const scopeKey = chat ? getChatRuntimeScopeKey(chat, char) : '';
            return { char, charIdx, rawCharIdx, chat, chatIndex, scopeKey };
        } catch {
            return { char: null, charIdx: -1, rawCharIdx: -1, chat: null, chatIndex: -1, scopeKey: '' };
        }
    };
    const getActiveChatForCharacter = async (char, preferredChat = null) => {
        const ctx = await resolveActiveChatContext(preferredChat);
        if (ctx?.chat) return ctx.chat;
        const fallbackIndex = Number(char?.chatPage ?? -1);
        return Array.isArray(char?.chats) && fallbackIndex >= 0 ? (char.chats[fallbackIndex] || null) : null;
    };
    const LIBRA_DB_READ_KEYS = Object.freeze(['personas', 'selectedPersona', 'modules', 'enabledModules', 'moduleIntergration', 'characters']);
    const getLibraAllowedDatabase = async (keys = LIBRA_DB_READ_KEYS) => {
        try {
            return await RisuCompat.database.get(Array.isArray(keys) ? keys : LIBRA_DB_READ_KEYS);
        } catch {
            return null;
        }
    };
    const getActiveManagedRuntimeScopeKey = () => String(MemoryState._activeScopeKey || MemoryState._activeChatId || '').trim();
    const getActiveManagedChatId = () => String(MemoryState._activeChatId || '').trim();
    const LIBRA_COMMON_SETTINGS_STORAGE_KEY = 'LMAI_Config';
    const readCommonPluginSettings = async () => {
        return await RisuCompat.pluginStorage.getItem(LIBRA_COMMON_SETTINGS_STORAGE_KEY);
    };
    const writeCommonPluginSettings = async (value) => {
        await RisuCompat.pluginStorage.setItem(LIBRA_COMMON_SETTINGS_STORAGE_KEY, value);
    };
    const normalizeEntityBlocklistCollection = (value) => {
        const rawItems = Array.isArray(value)
            ? value
            : (value && typeof value === 'object' && Array.isArray(value.items))
                ? value.items
                : String(value || '')
                    .split(/[\n\r,;|]+/g);
        return dedupeTextArray(
            rawItems
                .map(item => String(item || '').trim())
                .filter(Boolean)
        ).slice(0, 200);
    };

        const DebugExportManager = (() => {
        const COMMENT = 'lmai_debug_recent';
        const EXPORT_SCHEMA = 'libra.debug.export.v2';
        const STORAGE_SCHEMA = 'libra.debug.plugin-storage.v1';
        const STORAGE_KEY_PREFIX = 'LMAI_DebugRecent_v2::';
        const PLUGIN_VERSION = '5.3.1';
        const TURN_LIMIT = 2;
        const EVENT_LIMIT_PER_TURN = 80;
        const REQUEST_LIMIT = 48;
        const PROVIDER_CALL_LIMIT = 96;
        const STORAGE_FLUSH_DELAY_MS = 250;
        const TEXT_LIMIT = 1200;
        const DEFAULT_ARRAY_ITEM_LIMIT = 24;
        const VALUE_DEPTH_LIMIT = 6;
        const SECRET_KEY_RE = /(^|[_\-.])(key|api[_-]?key|authorization|token|secret|password|private[_-]?key|credential|bearer|x-api-key|access[_-]?token|refresh[_-]?token)($|[_\-.])/i;
        const shouldCapture = () => {
            try { return typeof MemoryEngine !== 'undefined' && MemoryEngine.CONFIG?.debug === true; }
            catch { return false; }
        };
        const clampText = (value, limit = TEXT_LIMIT) => {
            let text = String(value ?? '');
            text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim();
            text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]');
            text = text.replace(/([?&](?:key|api[_-]?key|token|access[_-]?token|refresh[_-]?token|authorization)=)[^&\s]+/gi, '$1[REDACTED]');
            text = text.replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_KEY]');
            text = text.replace(/([A-Za-z0-9_\-]{24,}\.[A-Za-z0-9_\-]{12,}\.[A-Za-z0-9_\-]{12,})/g, '[REDACTED_TOKEN]');
            return text.length > limit ? `${text.slice(0, limit)}...[truncated]` : text;
        };
        const arrayItemLimitForKey = (keyHint = '') => {
            const key = String(keyHint || '').trim();
            if (key === 'turns') return TURN_LIMIT;
            if (key === 'events') return EVENT_LIMIT_PER_TURN;
            if (key === 'requests' || key === 'recentRequestKeys') return REQUEST_LIMIT;
            if (key === 'providerCalls' || key === 'providerCallIds') return PROVIDER_CALL_LIMIT;
            if (key === 'filterAudit') return 120;
            if (key === 'sourceCandidates') return 16;
            return DEFAULT_ARRAY_ITEM_LIMIT;
        };
        const sanitizeValue = (value, depth = 0, keyHint = '') => {
            if (SECRET_KEY_RE.test(String(keyHint || ''))) return '[REDACTED]';
            if (value === null || value === undefined) return value;
            if (typeof value === 'string') return clampText(value);
            if (typeof value === 'number' || typeof value === 'boolean') return value;
            if (typeof value === 'function') return '[Function]';
            if (depth >= VALUE_DEPTH_LIMIT) return '[MaxDepth]';
            if (Array.isArray(value)) return value.slice(0, arrayItemLimitForKey(keyHint)).map((item) => sanitizeValue(item, depth + 1, keyHint));
            if (value && typeof value === 'object') {
                const out = {};
                for (const [key, val] of Object.entries(value).slice(0, 40)) {
                    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
                    out[key] = sanitizeValue(val, depth + 1, key);
                }
                return out;
            }
            return clampText(value);
        };
        const getRuntimeTurn = (meta = {}) => {
            const candidates = [
                meta.turn,
                meta.turnAnchorTurn,
                meta.finalizedTurn,
                meta.lockedTurn,
                (() => { try { return MemoryEngine?.getCurrentTurn?.(); } catch { return 0; } })(),
                (() => { try { return MemoryState?.currentTurn; } catch { return 0; } })()
            ];
            for (const item of candidates) {
                const n = Number(item);
                if (Number.isFinite(n) && n > 0) return Math.floor(n);
            }
            return 0;
        };
        const getScopeKey = (meta = {}) => String(meta.scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
        const getBucketKey = (scopeKey, turn) => `${String(scopeKey || 'global')}::${Number(turn || 0)}`;
        const nowMs = () => Date.now();
        const textDigest = (value = '') => {
            const text = String(value || '');
            const trimmed = text.trim();
            return {
                chars: text.length,
                trimmedChars: trimmed.length,
                hash: trimmed ? stableHash(trimmed) : '',
                empty: !trimmed
            };
        };
        const countRoles = (messages = []) => {
            const out = {};
            for (const msg of Array.isArray(messages) ? messages : []) {
                const role = getMessageRoleHint(msg) === 'user' ? 'user' : 'assistant';
                out[role] = Number(out[role] || 0) + 1;
            }
            return out;
        };
        const latestUserDigest = (messages = []) => {
            const list = Array.isArray(messages) ? messages : [];
            for (let i = list.length - 1; i >= 0; i--) {
                const msg = list[i];
                if (!isUserLikeMessage(msg)) continue;
                return {
                    index: i,
                    source: 'request_messages',
                    ...textDigest(msg?.content ?? msg?.text ?? msg?.message ?? '')
                };
            }
            return { index: -1, source: 'none', ...textDigest('') };
        };
        const getStorageKey = (scopeKey = '') => `${STORAGE_KEY_PREFIX}${stableHash(String(scopeKey || 'global').trim() || 'global')}`;
        const parseStoragePayload = (raw) => {
            try {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (!parsed || parsed.schema !== STORAGE_SCHEMA) return null;
                return sanitizeValue(parsed);
            } catch (_) {
                return null;
            }
        };
        const mergeByKey = (items = [], keyFn = item => item?.key || item?.id || '') => {
            const byKey = new Map();
            for (const item of Array.isArray(items) ? items : []) {
                if (!item || typeof item !== 'object') continue;
                const key = String(keyFn(item) || '').trim() || `fallback:${byKey.size}:${stableHash(JSON.stringify(item).slice(0, 400))}`;
                byKey.set(key, sanitizeValue(item));
            }
            return Array.from(byKey.values());
        };
        const getStorageStatus = (scopeKey = '') => {
            const scope = String(scopeKey || 'global').trim() || 'global';
            return MemoryState.runtimeDebugStorageStatusByScope?.get?.(scope) || null;
        };
        const buildStoragePayload = (scopeKey = '', context = {}) => {
            const scope = String(scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
            const requests = getRuntimeRequests(scope);
            const requestKeys = new Set(requests.map(request => request?.key).filter(Boolean));
            const providerCalls = (Array.isArray(MemoryState.runtimeDebugProviderCalls) ? MemoryState.runtimeDebugProviderCalls : [])
                .filter(call => !call?.requestKey || requestKeys.has(call.requestKey))
                .slice(0, PROVIDER_CALL_LIMIT)
                .map(call => sanitizeValue(call));
            return sanitizeValue({
                schema: STORAGE_SCHEMA,
                version: 1,
                updatedAt: new Date().toISOString(),
                reason: clampText(context.reason || '', 80),
                plugin: 'LIBRA World Manager',
                pluginVersion: PLUGIN_VERSION,
                scopeKey: scope,
                scopeHash: stableHash(scope),
                chatId: String(context.chatId || MemoryState?._activeChatId || '').trim(),
                turnLimit: TURN_LIMIT,
                requestLimit: REQUEST_LIMIT,
                providerCallLimit: PROVIDER_CALL_LIMIT,
                turns: getRuntimeRecords(scope),
                requests,
                providerCalls
            });
        };
        const readPluginStoragePayload = async (scopeKey = '') => {
            const scope = String(scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
            try {
                const raw = await RisuCompat.pluginStorage.getItem(getStorageKey(scope));
                return parseStoragePayload(raw);
            } catch (error) {
                MemoryState.runtimeDebugStorageStatusByScope?.set?.(scope, {
                    ok: false,
                    at: Date.now(),
                    operation: 'read',
                    key: getStorageKey(scope),
                    error: String(error?.message || error || 'unknown').slice(0, 240)
                });
                return null;
            }
        };
        const flushPluginStorage = async (scopeKey = '', context = {}) => {
            const scope = String(scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
            const key = getStorageKey(scope);
            try {
                const payload = buildStoragePayload(scope, context);
                const ok = await RisuCompat.pluginStorage.setItem(key, JSON.stringify(payload));
                MemoryState.runtimeDebugStorageStatusByScope?.set?.(scope, {
                    ok: ok !== false,
                    at: Date.now(),
                    operation: 'write',
                    key,
                    updatedAt: payload.updatedAt,
                    turnCount: Array.isArray(payload.turns) ? payload.turns.length : 0,
                    requestCount: Array.isArray(payload.requests) ? payload.requests.length : 0,
                    providerCallCount: Array.isArray(payload.providerCalls) ? payload.providerCalls.length : 0
                });
                return payload;
            } catch (error) {
                MemoryState.runtimeDebugStorageStatusByScope?.set?.(scope, {
                    ok: false,
                    at: Date.now(),
                    operation: 'write',
                    key,
                    error: String(error?.message || error || 'unknown').slice(0, 240)
                });
                return null;
            }
        };
        const schedulePluginStorageFlush = (scopeKey = '', context = {}) => {
            if (!shouldCapture()) return;
            const scope = String(scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
            const existing = MemoryState.runtimeDebugStorageFlushTimersByScope?.get?.(scope);
            if (existing) {
                try { clearTimeout(existing); } catch (_) {}
            }
            const timer = setTimeout(() => {
                try { MemoryState.runtimeDebugStorageFlushTimersByScope?.delete?.(scope); } catch (_) {}
                flushPluginStorage(scope, context);
            }, STORAGE_FLUSH_DELAY_MS);
            MemoryState.runtimeDebugStorageFlushTimersByScope?.set?.(scope, timer);
        };
        const pushRecentRequestKey = (key = '') => {
            const normalized = String(key || '').trim();
            if (!normalized) return;
            const current = Array.isArray(MemoryState.runtimeDebugRecentRequestKeys) ? MemoryState.runtimeDebugRecentRequestKeys : [];
            MemoryState.runtimeDebugRecentRequestKeys = [normalized, ...current.filter(item => item !== normalized)].slice(0, REQUEST_LIMIT);
            const retained = new Set(MemoryState.runtimeDebugRecentRequestKeys);
            for (const existing of Array.from(MemoryState.runtimeDebugRequestsByKey?.keys?.() || [])) {
                if (!retained.has(existing)) MemoryState.runtimeDebugRequestsByKey.delete(existing);
            }
        };
        const getRuntimeRequest = (key = '') => {
            const normalized = String(key || MemoryState.runtimeDebugCurrentRequestKey || '').trim();
            if (!normalized) return null;
            return MemoryState.runtimeDebugRequestsByKey?.get?.(normalized) || null;
        };
        const startRequest = (flow = 'request', context = {}) => {
            if (!shouldCapture()) return '';
            const scopeKey = String(context.scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
            const startedAt = nowMs();
            const key = String(context.key || `dbg_${stableHash(`${scopeKey}:${flow}:${startedAt}:${Math.random()}`)}`).trim();
            const request = {
                key,
                flow: clampText(flow, 48),
                scopeKey,
                chatId: String(context.chatId || '').trim(),
                requestType: clampText(context.requestType || '', 64),
                status: 'running',
                startedAt,
                updatedAt: startedAt,
                finishedAt: 0,
                durationMs: 0,
                request: sanitizeValue(context.request || {}),
                phases: {},
                phaseOrder: [],
                providerCallIds: [],
                result: {}
            };
            MemoryState.runtimeDebugRequestsByKey.set(key, request);
            MemoryState.runtimeDebugCurrentRequestKey = key;
            pushRecentRequestKey(key);
            schedulePluginStorageFlush(scopeKey, { chatId: request.chatId, reason: `start:${flow}` });
            return key;
        };
        const updateRequestContext = (key = '', patch = {}) => {
            const request = getRuntimeRequest(key);
            if (!request) return;
            if (patch.scopeKey) request.scopeKey = String(patch.scopeKey || request.scopeKey || 'global').trim() || 'global';
            if (patch.chatId !== undefined) request.chatId = String(patch.chatId || '').trim();
            if (patch.requestType !== undefined) request.requestType = clampText(patch.requestType || '', 64);
            if (patch.request && typeof patch.request === 'object') request.request = sanitizeValue({ ...(request.request || {}), ...patch.request });
            request.updatedAt = nowMs();
            schedulePluginStorageFlush(request.scopeKey, { chatId: request.chatId, reason: `context:${request.flow || 'request'}` });
        };
        const isFailureDebugStatus = (value = '') => /(?:fail|error|timeout|abort|cancel|schema|parse|invalid|db_error)/i.test(String(value || ''));
        const recordPhase = (key = '', phase = 'phase', payload = {}, status = 'done') => {
            const request = getRuntimeRequest(key);
            if (!request) return;
            const name = clampText(phase || 'phase', 80);
            const entryStatus = clampText(status || payload?.status || 'done', 32);
            const entry = sanitizeValue({
                at: nowMs(),
                status: entryStatus,
                ...payload
            });
            request.phases[name] = entry;
            if (isFailureDebugStatus(entryStatus) || payload?.ok === false || payload?.failed === true) {
                request.status = 'failed';
            }
            if (!request.phaseOrder.includes(name)) request.phaseOrder.push(name);
            request.updatedAt = nowMs();
            schedulePluginStorageFlush(request.scopeKey, { chatId: request.chatId, reason: `phase:${name}` });
        };
        const finishRequest = (key = '', status = 'done', payload = {}) => {
            const request = getRuntimeRequest(key);
            if (!request) return;
            const requestedStatus = clampText(status || 'done', 48);
            const hasFailedPhase = Object.values(request.phases || {}).some(phase => isFailureDebugStatus(phase?.status) || phase?.ok === false || phase?.failed === true);
            const payloadFailed = payload?.ok === false || payload?.failed === true || isFailureDebugStatus(payload?.status || '');
            request.status = (hasFailedPhase || payloadFailed) && !isFailureDebugStatus(requestedStatus)
                ? 'failed'
                : requestedStatus;
            request.result = sanitizeValue({ ...(request.result || {}), ...payload });
            request.finishedAt = nowMs();
            request.updatedAt = request.finishedAt;
            request.durationMs = Math.max(0, request.finishedAt - Number(request.startedAt || request.finishedAt));
            if (MemoryState.runtimeDebugCurrentRequestKey === request.key) MemoryState.runtimeDebugCurrentRequestKey = '';
            schedulePluginStorageFlush(request.scopeKey, { chatId: request.chatId, reason: `finish:${request.flow || 'request'}` });
        };
        const recordProviderCallStart = (context = {}) => {
            if (!shouldCapture()) return '';
            const requestKey = String(context.requestKey || MemoryState.runtimeDebugCurrentRequestKey || '').trim();
            const startedAt = nowMs();
            const id = `llm_${stableHash(`${requestKey}:${context.label || ''}:${startedAt}:${Math.random()}`)}`;
            const entry = sanitizeValue({
                id,
                requestKey,
                startedAt,
                status: 'running',
                profile: context.profile || '',
                provider: context.provider || '',
                model: context.model || '',
                label: context.label || '',
                domain: context.domain || '',
                streamRequested: context.streamRequested === true,
                serviceTier: context.serviceTier || '',
                flexApplied: context.flexApplied === true,
                system: textDigest(context.systemPrompt || ''),
                user: textDigest(context.userContent || '')
            });
            MemoryState.runtimeDebugProviderCalls = [entry, ...(MemoryState.runtimeDebugProviderCalls || [])].slice(0, PROVIDER_CALL_LIMIT);
            const request = getRuntimeRequest(requestKey);
            if (request) request.providerCallIds = [id, ...(request.providerCallIds || []).filter(item => item !== id)].slice(0, PROVIDER_CALL_LIMIT);
            schedulePluginStorageFlush(request?.scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global', {
                chatId: request?.chatId || '',
                reason: `provider-start:${context.label || ''}`
            });
            return id;
        };
        const recordProviderCallFinish = (id = '', patch = {}) => {
            const normalized = String(id || '').trim();
            if (!normalized) return;
            const calls = Array.isArray(MemoryState.runtimeDebugProviderCalls) ? MemoryState.runtimeDebugProviderCalls : [];
            const index = calls.findIndex(item => item?.id === normalized);
            if (index < 0) return;
            const startedAt = Number(calls[index]?.startedAt || nowMs());
            calls[index] = sanitizeValue({
                ...calls[index],
                ...patch,
                finishedAt: nowMs(),
                durationMs: Math.max(0, nowMs() - startedAt)
            });
            MemoryState.runtimeDebugProviderCalls = calls.slice(0, PROVIDER_CALL_LIMIT);
            const request = getRuntimeRequest(calls[index]?.requestKey || '');
            schedulePluginStorageFlush(request?.scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global', {
                chatId: request?.chatId || '',
                reason: `provider-finish:${calls[index]?.label || ''}`
            });
        };
        const ensureTurnBucket = (scopeKey, turn) => {
            if (!MemoryState.debugRecentTurnsByScope) MemoryState.debugRecentTurnsByScope = new Map();
            const scope = String(scopeKey || 'global').trim() || 'global';
            if (!MemoryState.debugRecentTurnsByScope.has(scope)) MemoryState.debugRecentTurnsByScope.set(scope, new Map());
            const turns = MemoryState.debugRecentTurnsByScope.get(scope);
            const key = getBucketKey(scope, turn);
            if (!turns.has(key)) {
                turns.set(key, {
                    turn: Number(turn || 0),
                    scopeHash: stableHash(scope),
                    startedAt: Date.now(),
                    updatedAt: Date.now(),
                    events: []
                });
            }
            const bucket = turns.get(key);
            bucket.updatedAt = Date.now();
            return { turns, bucket };
        };
        const pruneScope = (turns) => {
            const ordered = Array.from(turns.entries()).sort((a, b) => {
                const at = Number(a[1]?.turn || 0);
                const bt = Number(b[1]?.turn || 0);
                if (at !== bt) return at - bt;
                return Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0);
            });
            while (ordered.length > TURN_LIMIT) {
                const [key] = ordered.shift();
                turns.delete(key);
            }
        };
        const record = (level = 'debug', ...args) => {
            if (!shouldCapture()) return;
            let meta = {};
            if (args.length > 0) {
                const last = args[args.length - 1];
                if (last && typeof last === 'object' && last.__libraDebugMeta === true) {
                    meta = { ...last };
                    args.pop();
                    delete meta.__libraDebugMeta;
                }
            }
            const scopeKey = getScopeKey(meta);
            const turn = getRuntimeTurn(meta);
            const { turns, bucket } = ensureTurnBucket(scopeKey, turn);
            const event = {
                ts: Date.now(),
                level: clampText(level, 24),
                label: clampText(meta.label || meta.stage || meta.reason || '', 120),
                message: clampText(args.map((arg) => {
                    if (typeof arg === 'string') return arg;
                    if (arg instanceof Error) return `${arg.name || 'Error'}: ${arg.message || ''}`;
                    try { return JSON.stringify(sanitizeValue(arg)); } catch { return String(arg); }
                }).join(' '), TEXT_LIMIT),
                data: args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Error)
                    ? sanitizeValue(args[0])
                    : undefined
            };
            if (event.data === undefined) delete event.data;
            bucket.events.push(event);
            if (bucket.events.length > EVENT_LIMIT_PER_TURN) {
                bucket.events.splice(0, bucket.events.length - EVENT_LIMIT_PER_TURN);
            }
            pruneScope(turns);
            schedulePluginStorageFlush(scopeKey, { chatId: MemoryState?._activeChatId || '', reason: `event:${event.level}` });
        };
        const getRuntimeRecords = (scopeKey = '') => {
            const scope = String(scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
            const turns = MemoryState.debugRecentTurnsByScope?.get(scope);
            if (!turns) return [];
            return Array.from(turns.values())
                .sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0))
                .slice(-TURN_LIMIT)
                .map(item => sanitizeValue(item));
        };
        const stripEntryAndFlush = (lore = [], context = {}) => {
            const base = (Array.isArray(lore) ? lore : []).filter(entry => String(entry?.comment || '') !== COMMENT);
            schedulePluginStorageFlush(context.scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global', {
                chatId: context.chatId || MemoryState?._activeChatId || '',
                reason: 'persist-lore'
            });
            return base;
        };
        const getRuntimeRequests = (scopeKey = '') => {
            const scope = String(scopeKey || '').trim();
            const calls = Array.isArray(MemoryState.runtimeDebugProviderCalls) ? MemoryState.runtimeDebugProviderCalls : [];
            const byId = new Map(calls.map(call => [call?.id, call]).filter(item => item[0]));
            return (Array.isArray(MemoryState.runtimeDebugRecentRequestKeys) ? MemoryState.runtimeDebugRecentRequestKeys : [])
                .map(key => MemoryState.runtimeDebugRequestsByKey?.get?.(key))
                .filter(Boolean)
                .filter(request => !scope || String(request?.scopeKey || '') === scope)
                .map(request => sanitizeValue({
                    ...request,
                    providerCalls: (request.providerCallIds || []).map(id => byId.get(id)).filter(Boolean)
                }));
        };
        const getLoreForStats = (lore = []) => {
            try {
                if (typeof LibraLoreConsolidator !== 'undefined' && LibraLoreConsolidator?.unpack) {
                    return LibraLoreConsolidator.unpack(lore);
                }
            } catch (_) {}
            return Array.isArray(lore) ? lore : [];
        };
        const buildLoreStats = (lore = []) => {
            const entries = getLoreForStats(lore);
            const counts = {};
            let managed = 0;
            for (const entry of entries) {
                const comment = String(entry?.comment || '').trim() || '(none)';
                counts[comment] = Number(counts[comment] || 0) + 1;
                if (comment.startsWith('lmai_')) managed += 1;
            }
            return {
                entryCount: entries.length,
                managedCount: managed,
                counts,
                debugEntryPresent: entries.some(entry => String(entry?.comment || '') === COMMENT)
            };
        };
        const buildProviderSnapshot = () => {
            const scrub = (cfg = {}) => ({
                provider: String(cfg?.provider || '').trim(),
                urlMode: cfg?.url ? 'custom' : 'default',
                keyConfigured: !!String(cfg?.key || '').trim() || ['ollama', 'lmstudio', 'lm_studio'].includes(String(cfg?.provider || '').trim().toLowerCase()),
                model: String(cfg?.model || '').trim(),
                timeout: Number(cfg?.timeout || 0) || 0,
                stream: cfg?.stream === true,
                reasoningPreset: String(cfg?.reasoningPreset || '').trim(),
                reasoningEffort: String(cfg?.reasoningEffort || '').trim(),
                maxCompletionTokens: Number(cfg?.maxCompletionTokens || 0) || 0,
                enabled: cfg?.enabled
            });
            const cfg = MemoryEngine?.CONFIG || {};
            return {
                main: scrub(cfg.llm || {}),
                aux: scrub(cfg.auxLlm || {}),
                embedding: scrub(cfg.embed || {}),
                useLLM: cfg.useLLM !== false
            };
        };
        const buildQueueSnapshot = () => ({
            llm: {
                active: Number(MaintenanceLLMQueue?.activeCount || 0) || 0,
                pending: Number(MaintenanceLLMQueue?.pendingCount || 0) || 0
            },
            background: {
                active: Number(BackgroundMaintenanceQueue?.activeCount || 0) || 0,
                pending: Number(BackgroundMaintenanceQueue?.pendingCount || 0) || 0
            },
            foreground: {
                active: Number(MemoryState.afterRequestForegroundTasksByScope?.size || 0) || 0,
                pending: 0
            },
            dashboard: sanitizeValue(MemoryState.activityDashboard || {})
        });
        const compactMapEntries = (map, limit = 8, mapValue = value => value) => {
            try {
                return Array.from(map?.entries?.() || [])
                    .slice(-limit)
                    .map(([key, value]) => sanitizeValue({ key, value: mapValue(value) }));
            } catch (_) {
                return [];
            }
        };
        const buildRuntimeDump = (lore = [], context = {}) => {
            const scopeKey = String(context.scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
            const storagePayload = context.pluginStoragePayload && context.pluginStoragePayload.schema === STORAGE_SCHEMA
                ? context.pluginStoragePayload
                : null;
            const pendingTurnKeys = Array.from(MemoryState.pendingTurnCommits?.keys?.() || []).slice(-8);
            const afterOrigins = compactMapEntries(MemoryState.afterRequestOriginsByType, 8, queue => (Array.isArray(queue) ? queue : []).slice(-4).map(item => ({
                chatId: item?.chatId || '',
                requestType: item?.requestType || '',
                requestSequence: Number(item?.requestSequence || 0) || 0,
                queuedAt: Number(item?.queuedAt || 0) || 0,
                responseTransportMode: item?.responseTransportMode || '',
                user: textDigest(item?.canonicalUser?.raw || item?.canonicalUser?.strict || '')
            })));
            const transport = compactMapEntries(MemoryState.recentMainResponseTransportByChatId, 8, value => ({
                mode: value?.mode || '',
                source: value?.source || '',
                reliable: value?.reliable === true,
                observedAt: Number(value?.observedAt || 0) || 0,
                bodyStreamFlag: value?.bodyStreamFlag
            }));
            const outputCapture = compactMapEntries(MemoryState.recentMainResponseOutputCaptureByChatId, 8, value => ({
                requestSequence: Number(value?.requestSequence || 0) || 0,
                source: value?.source || '',
                transportMode: value?.transportMode || '',
                observedAt: Number(value?.observedAt || 0) || 0,
                display: textDigest(value?.displayContent || ''),
                memorySource: textDigest(value?.memorySourceText || ''),
                comparable: textDigest(value?.comparable || '')
            }));
            const runtimeRequests = getRuntimeRequests(scopeKey);
            const storageRequests = Array.isArray(storagePayload?.requests) ? storagePayload.requests : [];
            const mergedRequests = mergeByKey([...storageRequests, ...runtimeRequests], item => item?.key || '');
            const requestKeys = new Set(mergedRequests.map(request => request?.key).filter(Boolean));
            const runtimeProviderCalls = (Array.isArray(MemoryState.runtimeDebugProviderCalls) ? MemoryState.runtimeDebugProviderCalls : [])
                .filter(call => !call?.requestKey || requestKeys.has(call.requestKey));
            const storageProviderCalls = Array.isArray(storagePayload?.providerCalls) ? storagePayload.providerCalls : [];
            const mergedProviderCalls = mergeByKey([...storageProviderCalls, ...runtimeProviderCalls], item => item?.id || '').slice(0, PROVIDER_CALL_LIMIT);
            const storageStatus = getStorageStatus(scopeKey);
            const suppressedErrorTraceEnabled = MemoryEngine?.CONFIG?.debug === true;
            if (!suppressedErrorTraceEnabled && MemoryState.suppressedErrorStatsByKey?.size) {
                try { MemoryState.suppressedErrorStatsByKey.clear(); } catch (_) {}
            }
            const suppressedErrorTurnLimit = suppressedErrorTraceEnabled ? 2 : 0;
            const suppressedErrorScope = suppressedErrorTraceEnabled
                ? Array.from(MemoryState.suppressedErrorStatsByKey?.values?.() || [])
                    .filter(item => String(item?.scopeKey || 'global').trim() === scopeKey)
                : [];
            const suppressedErrorTurns = new Set(
                Array.from(new Set(suppressedErrorScope.map(item => Number(item?.turn || 0) || 0)))
                    .sort((a, b) => a - b)
                    .slice(-suppressedErrorTurnLimit)
            );
            const suppressedErrors = suppressedErrorScope
                .filter(item => suppressedErrorTurns.has(Number(item?.turn || 0) || 0))
                .sort((a, b) => (Number(b?.turn || 0) - Number(a?.turn || 0)) || (Number(b?.lastAt || 0) - Number(a?.lastAt || 0)))
                .slice(0, 24);
            return sanitizeValue({
                traceEnabled: MemoryEngine?.CONFIG?.debug === true,
                currentRequestKey: MemoryState.runtimeDebugCurrentRequestKey || '',
                recentRequestKeys: Array.isArray(MemoryState.runtimeDebugRecentRequestKeys) ? MemoryState.runtimeDebugRecentRequestKeys : [],
                requests: mergedRequests.slice(-REQUEST_LIMIT),
                providerCalls: mergedProviderCalls,
                queues: buildQueueSnapshot(),
                suppressedErrorTurnLimit,
                suppressedErrors,
                pending: {
                    turnCommitScopes: pendingTurnKeys,
                    afterRequestOrigins: afterOrigins,
                    streamRecoveryTimers: Array.from(MemoryState.streamOutputRecoveryTimersByChatId?.keys?.() || []).slice(-8),
                    afterRequestMissingTimers: Array.from(MemoryState.afterRequestMissingRecoveryTimersByChatId?.keys?.() || []).slice(-8),
                    foregroundMaintenanceScopes: Array.from(MemoryState.afterRequestForegroundTasksByScope?.keys?.() || []).slice(-8),
                    turnMaintenanceLocks: Array.from(MemoryState.turnMaintenanceLocksByChatId?.keys?.() || []).slice(-8)
                },
                responseStreaming: {
                    compatEnabled: MemoryEngine?.CONFIG?.responseStreamingCompatEnabled !== false,
                    outputHandlerRegistered: !!libraResponseStreamingOutputHandler,
                    editOutputHandlerRegistered: !!libraResponseStreamingEditOutputHandler,
                    transport,
                    outputCapture
                },
                storage: {
                    ...buildLoreStats(lore),
                    debugPluginStorage: {
                        key: getStorageKey(scopeKey),
                        present: !!storagePayload,
                        updatedAt: storagePayload?.updatedAt || '',
                        turnCount: Array.isArray(storagePayload?.turns) ? storagePayload.turns.length : 0,
                        requestCount: Array.isArray(storagePayload?.requests) ? storagePayload.requests.length : 0,
                        providerCallCount: Array.isArray(storagePayload?.providerCalls) ? storagePayload.providerCalls.length : 0,
                        lastStatus: storageStatus || null
                    }
                },
                providers: buildProviderSnapshot(),
                selfCheck: {
                    debugEnabled: MemoryEngine?.CONFIG?.debug === true,
                    scopeKey,
                    legacyDebugLoreEntry: (Array.isArray(lore) ? lore : []).some(entry => String(entry?.comment || '') === COMMENT),
                    pluginStorageDebug: !!storagePayload,
                    risuApi: {
                        beforeRequestHook: RisuCompat.has?.('addRisuReplacer') || RisuCompat.has?.('addReplacer'),
                        afterRequestHook: RisuCompat.has?.('addRisuReplacer') || RisuCompat.has?.('addReplacer'),
                        bodyInterceptor: RisuCompat.has?.('registerBodyIntercepter'),
                        scriptHandler: RisuCompat.has?.('addRisuScriptHandler')
                    }
                }
            });
        };
        const buildExportPayload = (lore = [], context = {}) => {
            const scopeKey = String(context.scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
            const storagePayload = context.pluginStoragePayload && context.pluginStoragePayload.schema === STORAGE_SCHEMA
                ? context.pluginStoragePayload
                : null;
            const runtimeTurns = getRuntimeRecords(scopeKey);
            const storageTurns = Array.isArray(storagePayload?.turns) ? storagePayload.turns : [];
            const merged = [...storageTurns, ...runtimeTurns]
                .sort((a, b) => Number(a?.turn || 0) - Number(b?.turn || 0) || Number(a?.updatedAt || 0) - Number(b?.updatedAt || 0));
            const byTurn = new Map();
            for (const item of merged) {
                const key = String(Number(item?.turn || 0));
                byTurn.set(key, sanitizeValue(item));
            }
            return {
                schema: EXPORT_SCHEMA,
                version: 2,
                exportedAt: new Date().toISOString(),
                plugin: 'LIBRA World Manager',
                pluginVersion: PLUGIN_VERSION,
                scope: {
                    chatId: String(context.chatId || '').trim(),
                    scopeHash: stableHash(scopeKey)
                },
                policy: {
                    runtimeTraceOutput: true,
                    rawPromptResponseText: false,
                    persistentLocation: `pluginStorage ${getStorageKey(scopeKey)}`,
                    turnLimit: TURN_LIMIT,
                    requestTraceLimit: REQUEST_LIMIT,
                    pluginStorage: 'recent two-turn runtime debug trace'
                },
                turns: Array.from(byTurn.values()).slice(-TURN_LIMIT),
                runtime: buildRuntimeDump(lore, { ...context, scopeKey, pluginStoragePayload: storagePayload })
            };
        };
        const buildExportPayloadAsync = async (lore = [], context = {}) => {
            const scopeKey = String(context.scopeKey || MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global').trim() || 'global';
            const flushed = await flushPluginStorage(scopeKey, {
                chatId: context.chatId || MemoryState?._activeChatId || '',
                reason: 'debug-export'
            });
            const stored = flushed || await readPluginStoragePayload(scopeKey);
            return buildExportPayload(lore, { ...context, scopeKey, pluginStoragePayload: stored });
        };
        return Object.freeze({
            COMMENT,
            record,
            stripEntryAndFlush,
            buildExportPayload,
            buildExportPayloadAsync,
            getRuntimeRecords,
            startRequest,
            updateRequestContext,
            recordPhase,
            finishRequest,
            recordProviderCallStart,
            recordProviderCallFinish,
            textDigest,
            countRoles,
            latestUserDigest
        });
    })();
    const recordRuntimeDebug = (level = 'debug', ...args) => DebugExportManager.record(level, ...args);
    const SUPPRESSED_ERROR_TURN_LIMIT = 2;
    const isSuppressedErrorTraceEnabled = () => {
        try { return MemoryEngine?.CONFIG?.debug === true; }
        catch (_) { return false; }
    };
    const clearSuppressedErrorStatsIfDisabled = () => {
        if (isSuppressedErrorTraceEnabled()) return false;
        try {
            if (MemoryState.suppressedErrorStatsByKey?.size) {
                MemoryState.suppressedErrorStatsByKey.clear();
                return true;
            }
        } catch (_) {}
        return false;
    };
    const getSuppressedErrorScopeKey = (context = {}) => String(
        context?.scopeKey
        || MemoryState?._activeScopeKey
        || MemoryState?._activeChatId
        || 'global'
    ).trim() || 'global';
    const getSuppressedErrorTurn = (context = {}) => {
        const candidates = [
            context?.turn,
            context?.currentTurn,
            context?.turnAnchorTurn,
            context?.finalizedTurn,
            (() => { try { return MemoryEngine?.getCurrentTurn?.(); } catch (_) { return 0; } })(),
            (() => { try { return MemoryState?.currentTurn; } catch (_) { return 0; } })()
        ];
        for (const item of candidates) {
            const n = Number(item);
            if (Number.isFinite(n) && n > 0) return Math.floor(n);
        }
        return 0;
    };
    const pruneSuppressedErrorStats = (scopeKey = '') => {
        const stats = MemoryState.suppressedErrorStatsByKey;
        if (!stats?.entries) return;
        const scope = String(scopeKey || 'global').trim() || 'global';
        const turns = Array.from(new Set(
            Array.from(stats.values())
                .filter(item => String(item?.scopeKey || 'global').trim() === scope)
                .map(item => Number(item?.turn || 0) || 0)
        )).sort((a, b) => a - b);
        if (turns.length <= SUPPRESSED_ERROR_TURN_LIMIT) return;
        const retained = new Set(turns.slice(-SUPPRESSED_ERROR_TURN_LIMIT));
        for (const [key, value] of Array.from(stats.entries())) {
            if (String(value?.scopeKey || 'global').trim() === scope && !retained.has(Number(value?.turn || 0) || 0)) {
                stats.delete(key);
            }
        }
    };
    const recordSuppressedRuntimeError = (label = 'unknown', error = null, context = {}) => {
        if (!isSuppressedErrorTraceEnabled()) {
            clearSuppressedErrorStatsIfDisabled();
            return null;
        }
        const normalizedLabel = String(label || 'unknown').trim() || 'unknown';
        const message = String(error?.message || error || 'unknown').trim().slice(0, 240) || 'unknown';
        try {
            const stats = MemoryState.suppressedErrorStatsByKey;
            if (stats?.set) {
                const now = Date.now();
                const scopeKey = getSuppressedErrorScopeKey(context);
                const turn = getSuppressedErrorTurn(context);
                const statKey = `${scopeKey}::${turn}::${normalizedLabel}`;
                const previous = stats.get(statKey) || {
                    label: normalizedLabel,
                    scopeKey,
                    turn,
                    count: 0,
                    firstAt: now,
                    lastAt: 0,
                    lastMessage: ''
                };
                stats.set(statKey, {
                    ...previous,
                    label: normalizedLabel,
                    scopeKey,
                    turn,
                    count: Number(previous.count || 0) + 1,
                    lastAt: now,
                    lastMessage: message
                });
                pruneSuppressedErrorStats(scopeKey);
            }
        } catch (_) {}
        try {
            recordRuntimeDebug('warn', `[LIBRA] Suppressed runtime error: ${normalizedLabel}`, message, {
                __libraDebugMeta: true,
                label: normalizedLabel,
                suppressed: true,
                ...(context && typeof context === 'object' ? context : {})
            });
        } catch (_) {}
        return null;
    };

    // Runtime toast notifications are DOM-only and never call showContainer()/hideContainer().
    // This restores external feedback such as LMAI_GUI.toast(...) without letting toast
    // cleanup hide the realtime Activity Dashboard or the settings overlay.
    const LibraToast = (() => {
        const ROOT_ID = 'libra-runtime-toast-root';
        const STYLE_ID = 'libra-runtime-toast-style';
        const nodes = new Map();
        const timers = new Map();
        const ensureStyle = () => {
            if (typeof document === 'undefined') return false;
            if (document.getElementById(STYLE_ID)) return true;
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = [
                `#${ROOT_ID}{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:grid;gap:8px;max-width:min(360px,calc(100vw - 36px));pointer-events:none;font-family:var(--risu-font-family,'Segoe UI',Inter,system-ui,sans-serif)}`,
                `#${ROOT_ID} .libra-toast{pointer-events:auto;border:1px solid rgba(148,163,184,.28);border-radius:10px;background:rgba(15,23,42,.96);color:#e5f0ff;box-shadow:0 14px 36px rgba(0,0,0,.32);padding:10px 12px;font-size:12px;font-weight:750;line-height:1.38;word-break:keep-all;overflow-wrap:anywhere;animation:libra-toast-in .14s ease-out}`,
                `@keyframes libra-toast-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}`
            ].join('\n');
            (document.head || document.body)?.appendChild(style);
            return true;
        };
        const ensureRoot = () => {
            if (typeof document === 'undefined' || !document.body) return null;
            ensureStyle();
            let root = document.getElementById(ROOT_ID);
            if (!root) {
                root = document.createElement('div');
                root.id = ROOT_ID;
                document.body.appendChild(root);
            }
            return root;
        };
        const removeNode = (key = '') => {
            const normalized = String(key || '').trim();
            if (!normalized) return false;
            const timer = timers.get(normalized);
            if (timer) {
                try { clearTimeout(timer); } catch (_) {}
                timers.delete(normalized);
            }
            const node = nodes.get(normalized);
            if (node?.parentNode) node.remove();
            nodes.delete(normalized);
            return true;
        };
        const notify = async (message = '', options = {}) => {
            const body = String(message || '').trim();
            if (!body) return false;
            const root = ensureRoot();
            if (!root) return false;
            const key = String(options?.key || `toast:${stableHash(body)}`).trim().slice(0, 120);
            removeNode(key);
            const node = document.createElement('div');
            node.className = 'libra-toast';
            node.textContent = body;
            nodes.set(key, node);
            root.appendChild(node);
            const duration = Math.max(800, Math.min(12000, Number(options?.duration || 2200) || 2200));
            const timer = setTimeout(() => removeNode(key), duration);
            timers.set(key, timer);
            return true;
        };
        const sequence = (messages = [], options = {}) => {
            const list = (Array.isArray(messages) ? messages : [messages]).map(item => String(item || '').trim()).filter(Boolean);
            if (!list.length) return false;
            const keyPrefix = String(options?.keyPrefix || `seq:${Date.now()}`).trim();
            const gap = Math.max(0, Number(options?.gap || 800) || 0);
            list.forEach((item, index) => {
                const scheduledKey = `${keyPrefix}:scheduled:${index}`;
                const scheduledTimer = setTimeout(() => {
                    timers.delete(scheduledKey);
                    void notify(item, {
                        ...options,
                        key: `${keyPrefix}:${index}:${stableHash(item)}`
                    });
                }, index * gap);
                timers.set(scheduledKey, scheduledTimer);
            });
            return true;
        };
        const cleanup = async () => {
            try {
                for (const timer of timers.values()) { try { clearTimeout(timer); } catch (_) {} }
                timers.clear();
                nodes.clear();
                if (typeof document !== 'undefined') {
                    document.getElementById(ROOT_ID)?.remove();
                    document.getElementById(STYLE_ID)?.remove();
                }
            } catch (e) {
                recordRuntimeDebug('warn', '[LIBRA Toast] cleanup failed:', e?.message || e);
            }
            return true;
        };
        return Object.freeze({ notify, sequence, cleanup });
    })();
    const notifyLibraTask = (message, options = {}) => LibraToast.notify(message, options);

    const normalizeInternalDataLanguageMode = (value = undefined) => {
        const raw = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        if (['off', 'disabled', 'disable', 'false', '0', 'none'].includes(raw)) return 'off';
        if (['follow_main_response', 'main', 'response', 'main_response', 'follow_response'].includes(raw)) return 'follow_main_response';
        if (['ko', 'kr', 'kor', 'korean', '한국어', '한글', 'fixed_korean'].includes(raw)) return 'fixed_korean';
        if (['en', 'eng', 'english', '영어', '영문', 'fixed_english'].includes(raw)) return 'fixed_english';
        return 'off';
    };

    const normalizeInternalDataLanguageTarget = (value = '') => {
        const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
        if (!raw) return '';
        if (['ko', 'kr', 'kor', 'korean', '한국어', '한글'].includes(raw)) return 'Korean';
        if (['en', 'eng', 'english', '영어', '영문', 'en-us', 'en-gb'].includes(raw)) return 'English';
        return '';
    };

    const resolveInternalDataLanguageTarget = (config = null, options = {}) => {
        const active = config || {};
        const mode = normalizeInternalDataLanguageMode(active?.internalDataLanguageMode || 'off');
        if (mode === 'off') return '';
        if (mode === 'fixed_korean') return 'Korean';
        if (mode === 'fixed_english') return 'English';
        if (mode === 'follow_main_response') {
            return normalizeInternalDataLanguageTarget(options?.mainResponseLanguageTarget || active?.mainResponseLanguageTarget || active?.responseLanguage || active?.language || '')
                || normalizeInternalDataLanguageTarget(active?.internalDataLanguageFallbackTarget || '')
                || 'Korean';
        }
        return '';
    };

    const INTERNAL_DATA_LANGUAGE_GUARD_DOMAINS = new Set([
        'storyauthor',
        'story_author',
        'director',
        'turnmaintenance',
        'turn_maintenance',
        'narrative_summary',
        'entity_consolidation',
        'world_consolidation',
        'integratedworld',
        'integrated_world',
        'integrated_world_engine',
        'world_analysis',
        'knowledge_import',
        'cold_start',
        'repair',
        'extraction',
        'deferred_reinterpretation',
        'live_chat_audit'
    ].map(v => String(v).toLowerCase()));

    const INTERNAL_DATA_LANGUAGE_GUARD_EXCLUDED_DOMAINS = new Set([
        'main_response',
        'main',
        'memory',
        'direct_memory',
        'direct_memory_capture',
        'raw_evidence',
        'legacy_evidence',
        'provider_test',
        'embedding',
        'lmai_memory',
        'lmai_direct_memory'
    ].map(v => String(v).toLowerCase()));

    const INTERNAL_DATA_LANGUAGE_GUARD_REASON_PATTERNS = [
        /story[-_ ]?author/i,
        /director/i,
        /turn[-_ ]?maintenance/i,
        /turn[-_ ]?correction/i,
        /narrative[-_ ]?(?:summary|reanalysis|analysis|supplement)/i,
        /char[-_ ]?state/i,
        /world[-_ ]?state/i,
        /world[-_ ]?analysis/i,
        /section[-_ ]?world/i,
        /cold[-_ ]?start/i,
        /transition[-_ ]?summary/i,
        /entity[-_ ]?extraction/i,
        /extraction[-_ ]?(?:repair|fallback)?/i,
        /integrated[-_ ]?world/i,
        /knowledge.*(?:chunk|synthesis|import)/i,
        /analysis|reanaly/i
    ];

    const shouldApplyInternalDataLanguageGuard = (config = null, options = {}) => {
        const active = config || {};
        const mode = normalizeInternalDataLanguageMode(active?.internalDataLanguageMode || 'off');
        if (mode === 'off') return false;
        if (options?.internalDataLanguageGuard === false) return false;
        const domain = String(options?.domain || options?.featureDomain || '').trim().toLowerCase();
        const reason = String(options?.reason || options?.label || options?.debugLabel || options?.taskLabel || '').trim();
        const haystack = `${domain} ${reason}`.trim();
        if (INTERNAL_DATA_LANGUAGE_GUARD_EXCLUDED_DOMAINS.has(domain)) return false;
        if (/provider[-_ ]?test|embedding/i.test(haystack)) return false;
        if (/memory|direct[-_ ]?memory|raw[-_ ]?(?:capture|evidence)|legacy[-_ ]?evidence/i.test(haystack)) return false;
        if (options?.internalDataLanguageGuard === true) return true;
        if (mode === 'fixed_korean' || mode === 'fixed_english') return true;
        if (INTERNAL_DATA_LANGUAGE_GUARD_DOMAINS.has(domain)) return true;
        return INTERNAL_DATA_LANGUAGE_GUARD_REASON_PATTERNS.some(pattern => pattern.test(haystack));
    };

    const buildInternalDataLanguageGuardPrompt = (config = null, options = {}) => {
        const target = resolveInternalDataLanguageTarget(config, options);
        if (!target) return '';
        const targetLines = (() => {
            if (target === 'Korean') {
                return [
                    '새로 생성하는 내부 설명값, 요약값, 계획값, 상태 설명값은 한국어로 작성하라.',
                    'JSON key는 그대로 유지하되 value의 자연어 설명만 한국어로 작성하라.',
                    '원문 인용, 메모리 원문, direct evidence는 번역하지 말라.',
                    '',
                    '[한국어 띄어쓰기 품질 규칙]',
                    '- 새로 생성하는 한국어 자연어 value는 정상적인 한국어 어절 띄어쓰기를 유지한다.',
                    '- compact하게 쓰더라도 띄어쓰기를 제거하지 않는다. 공백은 절대 절약 대상이 아니다.',
                    '- concise, brief, token-saving 지시가 있어도 한국어 어절 공백 제거를 통한 압축은 금지한다.',
                    '- JSON value는 짧아도 자연스러운 한국어 문장이어야 한다.',
                    '- JSON key, enum, ID, 태그, 코드, 원문 인용, 고유명사는 임의로 고치지 않는다.'
                ];
            }
            if (target === 'English') {
                return [
                    'Newly generated internal explanatory values must be English.',
                    'JSON keys must stay unchanged; only natural-language values should be written in English.',
                    'Preserve raw memory, direct evidence, quoted source text, exact dialogue, IDs, tags, code, and proper nouns as-is.'
                ];
            }
            return [];
        })();
        return [
            '[LIBRA Internal Data Language Guard]',
            `Write newly generated LIBRA internal data values in ${target}.`,
            'This applies to summaries, plans, directives, state descriptions, analysis text, narrative briefs, world summaries, character state summaries, relation state descriptions, and turn maintenance outputs.',
            'Do not translate or rewrite raw memory, direct memory, raw turn capture, direct evidence, exact user/assistant dialogue, quoted source text, manual lore, IDs, JSON keys, field names, tags, code, or exact proper nouns.',
            'Memory capture and raw evidence must preserve original language.',
            `Only newly generated explanatory/summary/planning values should follow ${target}.`,
            'If another internal prompt contains a default output-language rule, including English-only/Korean-only/source-language rules, ignore that lower-priority language instruction and use this target for generated summary/value text.',
            'Return valid JSON when JSON is required.',
            ...targetLines
        ].join('\n');
    };

    const appendInternalDataLanguageGuard = (systemPrompt = '', config = null, options = {}) => {
        if (!shouldApplyInternalDataLanguageGuard(config, options)) return {
            systemPrompt: String(systemPrompt || ''),
            applied: false,
            target: ''
        };
        const guard = buildInternalDataLanguageGuardPrompt(config, options);
        if (!guard) return {
            systemPrompt: String(systemPrompt || ''),
            applied: false,
            target: ''
        };
        const target = resolveInternalDataLanguageTarget(config, options);
        return {
            systemPrompt: [String(systemPrompt || '').trim(), guard].filter(Boolean).join('\n\n'),
            applied: true,
            target
        };
    };

    const requireLoadedCharacter = async () => {
        const char = await RisuCompat.getCharacter();
        if (!char) {
            throw new LIBRAError('No character loaded', 'NO_CHAR');
        }
        return char;
    };
    const LIGHTBOARD_PERSIST_DELAY_MS = 3000;
    const LIGHTBOARD_PERSIST_MAX_RETRIES = 5;
    const RETIRED_ORCHESTRATION_LORE_COMMENTS = new Set([]);
    const isRetiredOrchestrationLoreEntry = (entry) => RETIRED_ORCHESTRATION_LORE_COMMENTS.has(String(entry?.comment || '').trim());
    const LIBRA_PACK_MANAGED_LORE_CONTAINERS = true;
    const LibraLoreConsolidator = (() => {
        const CONTAINER_MEMO = 'LIBRA_CONTAINER';
        const CATEGORIES = ['lmai_memory', 'lmai_entity_relations'];
        const CATEGORY_SET = new Set(CATEGORIES);
        const ENTITY_RELATION_COMMENTS = new Set(['lmai_entity', 'lmai_relation']);
        const cloneEntry = (entry) => {
            // Lore entries are overwhelmingly flat RisuAI objects with large string content.
            // JSON stringify/parse here was the dominant live-turn CPU hotspot; shallow
            // cloning preserves write isolation for entry fields without reserializing MBs.
            if (!entry || typeof entry !== 'object') return entry;
            if (Array.isArray(entry)) return entry.slice();
            return { ...entry };
        };
        const isContainer = (entry = null) => {
            if (!entry || typeof entry !== 'object') return false;
            if (entry.memo === CONTAINER_MEMO) return true;
            if (!String(entry.key || '').startsWith('LIBRA_DATA_')) return false;
            if (!CATEGORY_SET.has(String(entry.comment || '').trim())) return false;
            if (typeof entry.content !== 'string') return false;
            try {
                const parsed = JSON.parse(entry.content);
                return parsed && typeof parsed === 'object' && parsed.version && parsed.category && Array.isArray(parsed.entries);
            } catch {
                return false;
            }
        };
        const unpack = (lorebook = []) => {
            if (!Array.isArray(lorebook) || lorebook.length === 0) return [];
            const out = [];
            const visit = (entry) => {
                if (!entry || typeof entry !== 'object') return;
                if (!isContainer(entry)) {
                    out.push(cloneEntry(entry));
                    return;
                }
                try {
                    const parsed = JSON.parse(entry.content || '{}');
                    if (Array.isArray(parsed.entries)) {
                        parsed.entries.forEach(visit);
                    }
                } catch (error) {
                    recordRuntimeDebug('warn', `[LIBRA][Lore] Container unpack failed for ${entry?.comment || 'unknown'}:`, error?.message || error);
                }
            };
            lorebook.forEach(visit);
            return out;
        };
        const classify = (entry = null) => {
            const comment = String(entry?.comment || '').trim();
            if (ENTITY_RELATION_COMMENTS.has(comment)) return 'lmai_entity_relations';
            if (comment === 'lmai_memory') return 'lmai_memory';
            return null;
        };
        const packUnpacked = (entries = []) => {
            const unpacked = Array.isArray(entries) ? entries : [];
            if (!LIBRA_PACK_MANAGED_LORE_CONTAINERS) return unpacked.map(cloneEntry);
            const buckets = new Map(CATEGORIES.map(category => [category, []]));
            const others = [];
            for (const entry of unpacked) {
                const cloned = cloneEntry(entry);
                const category = classify(cloned);
                if (category) buckets.get(category).push(cloned);
                else others.push(cloned);
            }
            const packed = CATEGORIES.map(category => {
                const bucketEntries = buckets.get(category) || [];
                if (bucketEntries.length === 0) return null;
                return {
                    key: `LIBRA_DATA_${category.toUpperCase()}`,
                    comment: category,
                    memo: CONTAINER_MEMO,
                    content: JSON.stringify({
                        version: '1.0',
                        category,
                        lastUpdate: Date.now(),
                        entries: bucketEntries
                    }),
                    mode: 'constant',
                    insertorder: 1,
                    alwaysActive: false
                };
            }).filter(Boolean);
            return [...packed, ...others];
        };
        const pack = (entries = []) => packUnpacked(unpack(Array.isArray(entries) ? entries : []));
        return Object.freeze({ unpack, pack, packUnpacked, cloneEntry, isContainer });
    })();
    const cloneChatForLoreMutation = (chat = {}) => {
        if (!chat || typeof chat !== 'object') return {};
        return {
            ...chat,
            localLore: Array.isArray(chat.localLore) ? chat.localLore.slice() : []
        };
    };
    const cloneCharacterForChatMutation = (baseChar, chatIndex, nextChat) => {
        const checkpointChar = (baseChar && typeof baseChar === 'object') ? { ...baseChar } : {};
        checkpointChar.chats = Array.isArray(baseChar?.chats) ? baseChar.chats.slice() : [];
        checkpointChar.chats[chatIndex] = nextChat;
        return checkpointChar;
    };
    const shouldRunPersistRpBackfill = (entries = []) => {
        if (MemoryEngine?.CONFIG?.rpLongTermMemoryEnabled === false) return false;
        if (MemoryEngine?.CONFIG?.persistRpBackfillEverySave === true) return true;
        const memoryCount = Array.isArray(entries)
            ? entries.reduce((count, entry) => count + (String(entry?.comment || '').trim() === 'lmai_memory' ? 1 : 0), 0)
            : 0;
        const hasRpLongTerm = Array.isArray(entries)
            ? entries.some(entry => String(entry?.comment || '').trim() === 'lmai_rp_longterm')
            : false;
        const currentTurn = Number(MemoryEngine?.getCurrentTurn?.() || 0) || 0;
        const previous = MemoryState._lastPersistRpBackfill || { memoryCount: 0, turn: 0 };
        if (!hasRpLongTerm) return true;
        if (memoryCount - Number(previous.memoryCount || 0) >= 24) return true;
        if (currentTurn - Number(previous.turn || 0) >= 24) return true;
        return false;
    };

    const persistLoreToActiveChat = async (preferredChat, lore, opts = {}) => {
        if (!Array.isArray(lore)) return { ok: false, reason: 'invalid_lore' };
        const { globalLore = undefined } = opts;
        
        let lbRetryCount = 0;
        while (await isLightBoardActive(preferredChat) && lbRetryCount < LIGHTBOARD_PERSIST_MAX_RETRIES) {
            lbRetryCount++;
            if (MemoryEngine.CONFIG?.debug) {
                recordRuntimeDebug('log', `[LIBRA] persistLore delayed: LightBoard active (${lbRetryCount}/${LIGHTBOARD_PERSIST_MAX_RETRIES})`);
            }
            await sleep(LIGHTBOARD_PERSIST_DELAY_MS);
        }
        if (lbRetryCount >= LIGHTBOARD_PERSIST_MAX_RETRIES && await isLightBoardActive(preferredChat)) {
            recordRuntimeDebug('warn', '[LIBRA] persistLore proceeding despite lingering LightBoard activity after grace period');
        }

        bindUiInteractionGuards();
        const delayMs = uiInteractionHotUntil - Date.now();
        if (delayMs > 0) {
            await sleep(delayMs + 50);
        }

        const freshChar = await RisuCompat.getCharacter();
        if (!freshChar) return { ok: false, reason: 'missing_char' };
        const charIdx = normalizeRisuIndex(await RisuCompat.getCurrentCharacterIndex());
        const chats = Array.isArray(freshChar.chats) ? freshChar.chats : [];
        let chatIndex = normalizeRisuIndex(await RisuCompat.getCurrentChatIndex());
        if (preferredChat?.id) {
            const resolved = chats.findIndex(entry => String(entry?.id || '') === String(preferredChat.id));
            if (resolved >= 0) chatIndex = resolved;
            else return { ok: false, reason: 'preferred_chat_not_found' };
        }
        const freshChat = chats[chatIndex];
        if (!freshChat || chatIndex < 0) {
            return { ok: false, reason: 'missing_chat_context' };
        }

        const expectedChatId = String(freshChat?.id || '');
        const nextChat = cloneChatForLoreMutation(freshChat);
        const activeScopeKeyForDebug = getChatRuntimeScopeKey(freshChat, freshChar);
        const workingLoreForPersist = LibraLoreConsolidator.unpack(lore);
        try {
            if (shouldRunPersistRpBackfill(workingLoreForPersist)) {
                RPContinuityCore.backfillFromMemories(workingLoreForPersist, {
                    maxEntries: Math.max(1200, Number(MemoryEngine?.CONFIG?.maxLimit || 200) * 6)
                });
                MemoryState._lastPersistRpBackfill = {
                    memoryCount: workingLoreForPersist.reduce((count, entry) => count + (String(entry?.comment || '').trim() === 'lmai_memory' ? 1 : 0), 0),
                    turn: Number(MemoryEngine?.getCurrentTurn?.() || 0) || 0,
                    at: Date.now()
                };
            }
        } catch (error) {
            if (MemoryEngine?.CONFIG?.debug) recordRuntimeDebug('warn', '[LIBRA][RP-LTM] persist backfill skipped:', error?.message || error);
        }
        try {
            const hasHmeScopeIndex = workingLoreForPersist.some(entry => String(entry?.comment || '').trim() === 'lmai_hme_index');
            if (!hasHmeScopeIndex && typeof MemoryEngine !== 'undefined' && MemoryEngine?.ensureHybridScopeIndex) {
                MemoryEngine.ensureHybridScopeIndex(workingLoreForPersist, {
                    scopeKey: activeScopeKeyForDebug,
                    currentTurn: MemoryEngine.getCurrentTurn?.() || 0,
                    reason: 'persistLoreToActiveChat'
                });
            }
        } catch (error) {
            if (MemoryEngine?.CONFIG?.debug) recordRuntimeDebug('warn', '[LIBRA][HMEIndex] persist index update failed:', error?.message || error);
        }
        const loreWithoutDebugEntry = DebugExportManager.stripEntryAndFlush(workingLoreForPersist, {
            chatId: expectedChatId,
            scopeKey: activeScopeKeyForDebug
        }).filter(entry => !isRetiredOrchestrationLoreEntry(entry));
        const externalLore = (Array.isArray(nextChat.localLore) ? nextChat.localLore : []).filter(e => !e.comment || !String(e.comment).startsWith('lmai_'));
        const libraLore = loreWithoutDebugEntry
            .filter(e => e.comment && String(e.comment).startsWith('lmai_') && !isRetiredOrchestrationLoreEntry(e))
            .map(e => ({ ...e }));
        nextChat.localLore = [...externalLore, ...LibraLoreConsolidator.packUnpacked(libraLore)];

        const needsGlobalLoreWrite = Array.isArray(globalLore);
        const buildCheckpointChar = (baseChar) => {
            const checkpointChar = cloneCharacterForChatMutation(baseChar || freshChar, chatIndex, nextChat);
            if (needsGlobalLoreWrite) {
                const externalGlobal = (Array.isArray(checkpointChar.lorebook) ? checkpointChar.lorebook : []).filter(e => !e.comment || !String(e.comment).startsWith('lmai_'));
                const libraGlobal = LibraLoreConsolidator.unpack(globalLore)
                    .filter(e => e.comment && String(e.comment).startsWith('lmai_') && !isRetiredOrchestrationLoreEntry(e))
                    .map(e => ({ ...e }));
                checkpointChar.lorebook = [...externalGlobal, ...LibraLoreConsolidator.packUnpacked(libraGlobal)];
            }
            return checkpointChar;
        };

        const unpackedSavedChat = {
            ...nextChat,
            localLore: LibraLoreConsolidator.unpack(nextChat.localLore)
        };

        // Prefer the narrow v3 chat writer to avoid overwriting concurrent
        // character-level edits. Fall back to setCharacter only when the current
        // API cannot write the chat directly or when global lore migration must
        // remove managed entries from the character lorebook.
        let savedByGranularChatApi = false;
        if (!needsGlobalLoreWrite && charIdx >= 0 && RisuCompat.has('setChatToIndex')) {
            try {
                const verifyChar = await RisuCompat.getCharacter();
                const verifyChat = verifyChar?.chats?.[chatIndex];
                if (expectedChatId && String(verifyChat?.id || '') !== expectedChatId) {
                    return { ok: false, reason: 'chat_changed_before_save' };
                }
                await RisuCompat.setChatToIndex(charIdx, chatIndex, nextChat);
                savedByGranularChatApi = true;
            } catch (granularSaveError) {
                if (MemoryEngine.CONFIG?.debug) {
                    recordRuntimeDebug('warn', '[LIBRA] setChatToIndex failed; falling back to setCharacter:', granularSaveError?.message || granularSaveError);
                }
            }
        }

        if (!savedByGranularChatApi) {
            const verifyChar = await RisuCompat.getCharacter();
            const verifyChat = verifyChar?.chats?.[chatIndex];
            if (expectedChatId && String(verifyChat?.id || '') !== expectedChatId) {
                return { ok: false, reason: 'chat_changed_before_save' };
            }
            const checkpointChar = buildCheckpointChar(verifyChar);
            await RisuCompat.setCharacter(checkpointChar);
        }

        return { ok: true, chat: unpackedSavedChat, storedChat: nextChat, chatIndex: chatIndex, charIdx: charIdx, savedByGranularChatApi };
    };

    const isLibraManagedLoreEntryForReset = (entry = null) => {
        if (!entry || typeof entry !== 'object') return false;
        const comment = String(entry.comment || '').trim();
        const key = String(entry.key || '').trim();
        if (comment.startsWith('lmai_')) return true;
        if (key.startsWith('lmai_')) return true;
        if (LibraLoreConsolidator.isContainer(entry)) return true;
        if (key.startsWith('LIBRA_DATA_')) return true;
        return isRetiredOrchestrationLoreEntry(entry);
    };

    const LIBRA_PROJECTION_COMMENTS = Object.freeze([
        'lmai_projection_active_state',
        'lmai_projection_boundary_guard',
        'lmai_projection_recall_bundle'
    ]);
    const LIBRA_PROJECTION_COMMENT_SET = new Set(LIBRA_PROJECTION_COMMENTS);
    const LIBRA_PROJECTION_LABELS = Object.freeze({
        active: 'LIBRA_ACTIVE_STATE',
        boundary: 'LIBRA_BOUNDARY_GUARD',
        recall: 'LIBRA_RECALL_BUNDLE'
    });
    const LIBRA_PROJECTION_MIN_RECOMMENDED_CHARS = 6400;
    const LIBRA_PROJECTION_STABLE_CHARS = 7200;
    const LIBRA_PROJECTION_GENEROUS_CHARS = 8000;
    const LIBRA_HIDDEN_OPERATIONAL_DEFAULTS = Object.freeze({
        libraInjectionMode: 'hybrid',
        libraProjectionRecallBundle: 'hybrid',
        libraProjectionMaxChars: LIBRA_PROJECTION_STABLE_CHARS,
        hmeAssociativeGraphMode: 'light',
        hmeGraphMaxSeeds: 6,
        hmeGraphMaxCandidates: 10,
        hmeGraphMaxAdditions: 4,
        hmeGraphMaxNodes: 800,
        hmeGraphMaxEdges: 1024,
        hmeGraphMaxHops: 1,
        hmeGraphBonusCap: 0.10,
        hmeGraphMinRecallCandidates: 24
    });
    const normalizeLibraInjectionMode = (value = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraInjectionMode) => {
        const mode = String(value || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraInjectionMode).trim().toLowerCase();
        return ['direct', 'hybrid', 'lorebook_projection'].includes(mode) ? mode : LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraInjectionMode;
    };
    const normalizeLibraProjectionRecallBundle = (value = LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionRecallBundle) => {
        const mode = String(value || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionRecallBundle).trim().toLowerCase();
        return ['off', 'projection_only', 'hybrid', 'always'].includes(mode) ? mode : LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionRecallBundle;
    };
    const shouldBuildLibraProjectionRecallBundle = (config = null) => {
        const injectionMode = normalizeLibraInjectionMode(config?.libraInjectionMode || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraInjectionMode);
        const bundleMode = normalizeLibraProjectionRecallBundle(config?.libraProjectionRecallBundle || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionRecallBundle);
        if (bundleMode === 'off') return false;
        if (bundleMode === 'always') return true;
        if (bundleMode === 'hybrid') return injectionMode === 'hybrid';
        return injectionMode === 'lorebook_projection';
    };
    const compactLibraProjectionBlock = (value = '', maxChars = 2400) => {
        const raw = String(value || '')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
        const limit = Math.max(400, Math.min(20000, Number(maxChars || 2400) || 2400));
        return truncateForLLM(raw, limit, '\n...[LIBRA projection clipped]...\n').trim();
    };
    const buildLibraProjectionEntry = ({ comment, label, content, order = 980, alwaysActive = true, memo = '' }) => {
        const body = String(content || '').trim();
        if (!body) return null;
        return {
            key: String(label || comment || '').trim(),
            comment: String(comment || '').trim(),
            memo: memo || 'LIBRA_PROJECTION',
            content: body,
            mode: 'constant',
            insertorder: order,
            alwaysActive: alwaysActive !== false,
            selective: false,
            useRegex: false,
            secondkey: '',
            depth: 0
        };
    };
    const stripLibraProjectionEntries = (lore = []) => (Array.isArray(lore) ? lore : [])
        .filter(entry => !LIBRA_PROJECTION_COMMENT_SET.has(String(entry?.comment || '').trim()));
    const upsertLibraProjectionEntries = (lore = [], entries = [], options = {}) => {
        const base = stripLibraProjectionEntries(LibraLoreConsolidator.unpack(Array.isArray(lore) ? lore : []));
        const nextEntries = (Array.isArray(entries) ? entries : [])
            .filter(entry => entry && String(entry?.comment || '').trim() && String(entry?.content || '').trim())
            .map(entry => safeClone(entry));
        const next = [...base, ...nextEntries];
        const digestPayload = nextEntries.map(entry => ({
            comment: entry.comment,
            key: entry.key,
            alwaysActive: entry.alwaysActive === true,
            contentHash: stableHash(entry.content || '')
        }));
        const digest = stableHash(JSON.stringify(digestPayload));
        const previousDigest = String(options.previousDigest || '').trim();
        const currentProjectionDigest = stableHash(JSON.stringify(
            LibraLoreConsolidator.unpack(Array.isArray(lore) ? lore : [])
                .filter(entry => LIBRA_PROJECTION_COMMENT_SET.has(String(entry?.comment || '').trim()))
                .map(entry => ({ comment: entry.comment, key: entry.key, alwaysActive: entry.alwaysActive === true, contentHash: stableHash(entry.content || '') }))
        ));
        const changed = previousDigest ? previousDigest !== digest : currentProjectionDigest !== digest;
        return { lore: next, entries: nextEntries, digest, changed };
    };
    const buildLibraProjectionEntriesFromContext = (ctx = {}, config = null) => {
        const cfg = config || {};
        const injectionMode = normalizeLibraInjectionMode(cfg.libraInjectionMode || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraInjectionMode);
        if (injectionMode === 'direct' || cfg.libraProjectionAlwaysActive === false) return [];
        const maxChars = Math.max(
            LIBRA_PROJECTION_MIN_RECOMMENDED_CHARS,
            Math.min(
                LIBRA_PROJECTION_GENEROUS_CHARS,
                Number(cfg.libraProjectionMaxChars || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionMaxChars) || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraProjectionMaxChars
            )
        );
        const nowIso = new Date().toISOString();
        const scopeHash = stableHash(ctx.scopeKey || ctx.chatId || 'global');
        const activeParts = [];
        const pushActive = (title, value, sectionMax = Math.floor(maxChars * 0.75)) => {
            const text = compactLibraProjectionBlock(value, Math.max(300, Number(sectionMax || 0) || Math.floor(maxChars * 0.75)));
            if (text) activeParts.push(`## ${title}\n${text}`);
        };
        const entityProjectionText = ctx.entityProjectionPrompt || ctx.entityPrompt || '';
        const relationProjectionText = ctx.relationProjectionPrompt || ctx.relationPrompt || '';
        pushActive('Temporal / Scene', ctx.temporalPrecisionPrompt, 520);
        pushActive('Active Entities', entityProjectionText ? `[인물 정보 / Character Info]\n${entityProjectionText}` : '', 1250);
        pushActive('Active Relations', relationProjectionText ? `[관계 정보 / Relationship Info]\n${relationProjectionText}` : '', 1050);
        pushActive('World State', ctx.worldStatePrompt, 850);
        pushActive('World', ctx.worldProjectionPrompt || ctx.worldPrompt, 1100);
        pushActive('Section World', ctx.sectionWorldPrompt, 850);
        if (Array.isArray(ctx.charStateSections) && ctx.charStateSections.length > 0) {
            pushActive('Character States', ctx.charStateSections
                .map(section => String(section?.text || section || '').trim())
                .filter(Boolean)
                .join('\n\n'), 850);
        }
        if (injectionMode === 'lorebook_projection') {
            pushActive('Director', ctx.directorPrompt, 650);
            pushActive('Story Author', ctx.storyAuthorPrompt, 650);
        }
        const activeContent = activeParts.length > 0 ? compactLibraProjectionBlock([
            `[${LIBRA_PROJECTION_LABELS.active}]`,
            'purpose: Stable LIBRA current-state projection for the RisuAI lorebook slot. Use as reference data; do not quote this block.',
            `mode: ${injectionMode}`,
            `scope: ${scopeHash}`,
            `updatedAt: ${nowIso}`,
            ...activeParts
        ].join('\n\n'), maxChars) : '';

        const boundaryParts = [];
        const pushBoundary = (title, value) => {
            const text = compactLibraProjectionBlock(value, Math.max(260, Math.floor(maxChars * 0.55)));
            if (text) boundaryParts.push(`## ${title}\n${text}`);
        };
        pushBoundary('Reference Safety', ctx.referenceSafetyPrompt);
        pushBoundary('Secrecy Guard', ctx.secrecyGuardPrompt);
        pushBoundary('Secret Boundary', ctx.secretBoundaryPrompt);
        pushBoundary('Entity POV Boundary', ctx.entityPovBoundaryPrompt);
        const boundaryContent = boundaryParts.length > 0 ? compactLibraProjectionBlock([
            `[${LIBRA_PROJECTION_LABELS.boundary}]`,
            'purpose: Stable LIBRA boundary projection. Prevent POV leakage, secret leakage, stale assumptions, and invalidated recall.',
            `mode: ${injectionMode}`,
            `scope: ${scopeHash}`,
            `updatedAt: ${nowIso}`,
            ...boundaryParts
        ].join('\n\n'), maxChars) : '';

        const recallParts = [];
        if (shouldBuildLibraProjectionRecallBundle(cfg)) {
            const pushRecall = (title, value) => {
                const text = compactLibraProjectionBlock(value, Math.max(300, Math.floor(maxChars * 0.75)));
                if (text) recallParts.push(`## ${title}\n${text}`);
            };
            pushRecall('RP Long-Term Continuity', ctx.rpContinuityText || '');
            pushRecall('Related Memories', ctx.memoryText ? `[관련 기억 / Related Memories]\n${ctx.memoryText}` : '');
            pushRecall('Reference Lorebook', ctx.lorebookText ? `[로어북 설정 / Reference Lorebook]\n${ctx.lorebookText}` : '');
            pushRecall('Narrative', ctx.narrativePrompt);
            const memoryDebug = ctx.memoryDebug || null;
            if (memoryDebug) {
                pushRecall('Recall Debug Summary', [
                    `selected=${memoryDebug.selectedCount ?? ''}`,
                    `candidates=${memoryDebug.originalCandidates ?? ''}`,
                    `domainGuardBlocked=${memoryDebug.domainGuardBlocked === true}`,
                    `graph=${memoryDebug.hmeAssociativeGraph?.enabled ? memoryDebug.hmeAssociativeGraph?.mode || 'on' : 'off'}`
                ].join(' | '));
            }
        }
        const recallContent = recallParts.length > 0 ? compactLibraProjectionBlock([
            `[${LIBRA_PROJECTION_LABELS.recall}]`,
            'purpose: Dynamic LIBRA recall projection. It is a selected recall bundle, not a database dump.',
            `mode: ${injectionMode}`,
            `scope: ${scopeHash}`,
            `updatedAt: ${nowIso}`,
            ...recallParts
        ].join('\n\n'), maxChars) : '';

        return [
            buildLibraProjectionEntry({ comment: 'lmai_projection_active_state', label: LIBRA_PROJECTION_LABELS.active, content: activeContent, order: 982, alwaysActive: cfg.libraProjectionAlwaysActive !== false }),
            buildLibraProjectionEntry({ comment: 'lmai_projection_boundary_guard', label: LIBRA_PROJECTION_LABELS.boundary, content: boundaryContent, order: 981, alwaysActive: cfg.libraProjectionAlwaysActive !== false }),
            buildLibraProjectionEntry({ comment: 'lmai_projection_recall_bundle', label: LIBRA_PROJECTION_LABELS.recall, content: recallContent, order: 980, alwaysActive: cfg.libraProjectionAlwaysActive !== false })
        ].filter(Boolean);
    };
    const shouldDirectInjectLibraSection = (section = {}, config = null) => {
        const mode = normalizeLibraInjectionMode(config?.libraInjectionMode || LIBRA_HIDDEN_OPERATIONAL_DEFAULTS.libraInjectionMode);
        if (mode === 'direct') return true;
        const key = String(section?.key || '').trim();
        const projectionAvailable = config?.libraProjectionAlwaysActive !== false;
        if (!projectionAvailable) return true;
        if (mode === 'lorebook_projection') return false;
        if (mode === 'hybrid') {
            if (key.startsWith('charState:')) return false;
            return !new Set(['temporalPrecision', 'world', 'sectionWorldInference', 'worldState']).has(key);
        }
        return true;
    };

    const stripLibraManagedLoreForReset = (entries = []) => {
        const source = Array.isArray(entries) ? entries : [];
        const unpacked = LibraLoreConsolidator.unpack(source);
        const removedManagedCount = unpacked.filter(isLibraManagedLoreEntryForReset).length;
        const kept = source
            .filter(entry => !isLibraManagedLoreEntryForReset(entry))
            .map(entry => safeClone(entry));
        return {
            entries: kept,
            removed: removedManagedCount || Math.max(0, source.length - kept.length)
        };
    };

    const stripLibraManagedLoreFieldsForReset = (target = null, fields = []) => {
        if (!target || typeof target !== 'object') return 0;
        let removed = 0;
        for (const field of fields) {
            if (!Array.isArray(target[field])) continue;
            const stripped = stripLibraManagedLoreForReset(target[field]);
            target[field] = stripped.entries;
            removed += stripped.removed;
        }
        return removed;
    };

    const stripNestedLibraManagedLoreForReset = (target = null, depth = 0) => {
        if (!target || typeof target !== 'object' || depth > 2) return 0;
        let removed = stripLibraManagedLoreFieldsForReset(target, ['entries', 'lorebook', 'lore', 'globalLore', 'data']);
        for (const field of ['data', 'card', 'spec']) {
            if (target[field] && typeof target[field] === 'object' && !Array.isArray(target[field])) {
                removed += stripNestedLibraManagedLoreForReset(target[field], depth + 1);
            }
        }
        return removed;
    };

    const purgeLibraManagedLoreForActiveChat = async (preferredChat = null, opts = {}) => {
        const { purgeGlobal = true } = opts || {};
        const freshChar = await RisuCompat.getCharacter();
        if (!freshChar) return { ok: false, reason: 'missing_char' };
        const charIdx = normalizeRisuIndex(await RisuCompat.getCurrentCharacterIndex());
        const chats = Array.isArray(freshChar.chats) ? freshChar.chats : [];
        let chatIndex = normalizeRisuIndex(await RisuCompat.getCurrentChatIndex());
        if (preferredChat?.id) {
            const resolved = chats.findIndex(entry => String(entry?.id || '') === String(preferredChat.id));
            if (resolved >= 0) chatIndex = resolved;
            else return { ok: false, reason: 'preferred_chat_not_found' };
        }
        const freshChat = chats[chatIndex];
        if (!freshChat || chatIndex < 0) return { ok: false, reason: 'missing_chat_context' };

        bindUiInteractionGuards();
        const delayMs = uiInteractionHotUntil - Date.now();
        if (delayMs > 0) await sleep(delayMs + 50);

        const expectedChatId = String(freshChat?.id || '');
        const nextChar = cloneForMutation(freshChar);
        nextChar.chats = Array.isArray(nextChar.chats) ? nextChar.chats : [];
        const nextChat = cloneChatForLoreMutation(freshChat);
        let removed = 0;

        removed += stripLibraManagedLoreFieldsForReset(nextChat, ['localLore', 'lorebook', 'lore']);
        if (purgeGlobal) {
            removed += stripLibraManagedLoreFieldsForReset(nextChar, ['lorebook', 'lore', 'characterLore', 'rawCharacterLore', 'globalLore']);
            removed += stripNestedLibraManagedLoreForReset(nextChar.data);
            removed += stripNestedLibraManagedLoreForReset(nextChar.card);
            removed += stripNestedLibraManagedLoreForReset(nextChar.spec);
        }
        nextChar.chats[chatIndex] = safeClone(nextChat);

        const verifyChar = await RisuCompat.getCharacter();
        const verifyChat = verifyChar?.chats?.[chatIndex];
        if (expectedChatId && String(verifyChat?.id || '') !== expectedChatId) {
            return { ok: false, reason: 'chat_changed_before_save' };
        }
        await RisuCompat.setCharacter(safeClone(nextChar));
        const savedChat = {
            ...safeClone(nextChat),
            localLore: Array.isArray(nextChat.localLore) ? LibraLoreConsolidator.unpack(nextChat.localLore).map(e => safeClone(e)) : nextChat.localLore
        };
        return { ok: true, char: nextChar, chat: savedChat, storedChat: nextChat, removed, chatIndex, charIdx };
    };
