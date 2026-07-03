    // ══════════════════════════════════════════════════════════════
    // [MANAGER] Internal Data Translation / Migration
    // ══════════════════════════════════════════════════════════════
    const InternalDataTranslationManager = (() => {
        const ALLOWED_COMMENTS = new Set([
            'lmai_entity',
            'lmai_relation',
            'lmai_narrative',
            'lmai_char_states',
            'lmai_world_states',
            'lmai_secret_knowledge',
            'lmai_entity_knowledge_vault',
            'lmai_time_engine',
            'lmai_user_identity'
        ]);
        const SKIP_KEY_EXACT = new Set([
            'id', '_id', 'uuid', 'key', 'secondkey', 'comment', 'mode', 'insertorder', 'alwaysactive',
            'version', 'schema', 'type', 'kind', 'role', 'sex', 'gender', 'biologicalsex', 'biological_sex',
            'name', 'displayname', 'labelkey', 'entity', 'entitya', 'entityb', 'namea', 'nameb', 'alias',
            'aliases', 'parent', 'children', 'rootid', 'activepath', 'path', 'turn', 'uptoturn', 'timestamp',
            'created', 'createdat', 'updated', 'updatedat', 'reflectedat', 'lastsummaryturn',
            'lastconsolidationturn', 'scopekey', 'chatid', 'sessionid', 'sourceid', 'messageid', 'messageids',
            'sourcemessageid', 'sourcemessageids', 'hash', 'sourcehash', 'signature', 'fingerprint',
            'useraction', 'airesponse', 'assistantresponse', 'response', 'message', 'messages', 'dialogue',
            'confidence', 'score', 'weight', 'level', 'enabled', 'disabled', 'isactive', 'isprimary',
            'manuallocked', 'ttl', 'imp', 'importance'
        ]);
        const NAME_LIST_KEYS = new Set(['entities', 'characters', 'participants', 'actors', 'speakers', 'targets']);
        const SKIP_KEY_PATTERN = /(?:^|[_-])(?:raw|original|verbatim|quote|quoted|evidence|direct|source|transcript|prompt|input|output|hash|signature|fingerprint)(?:$|[_-])/i;
        const STRUCTURAL_VALUES = new Set([
            'normal', 'always', 'manual', 'auto', 'baseline', 'default', 'unknown', 'none',
            'true', 'false', 'null', 'periodic', 'critical', 'dimension', 'realm', 'layer',
            'extend', 'override', 'isolate', 'male', 'female'
        ]);
        const MAX_BATCH_ITEMS = 24;
        const MAX_BATCH_CHARS = 7000;

        const normalizeTarget = (target) => {
            const raw = String(target || '').trim().toLowerCase();
            if (raw === 'ko' || raw === 'kor' || raw === 'korean' || raw === '한국어') return 'Korean';
            if (raw === 'en' || raw === 'eng' || raw === 'english' || raw === '영어') return 'English';
            return '';
        };
        const makePathLabel = (path = []) => path.map(part => String(part)).join('.');
        const isNumericPathPart = (value) => /^\d+$/.test(String(value || ''));
        const normalizeKey = (value = '') => String(value || '').replace(/[\s.-]+/g, '_').toLowerCase();
        const lastNamedKey = (path = []) => {
            for (let i = path.length - 1; i >= 0; i--) {
                const part = String(path[i] || '');
                if (!isNumericPathPart(part)) return normalizeKey(part);
            }
            return '';
        };
        const shouldSkipKey = (key = '') => {
            const normalized = normalizeKey(key);
            if (!normalized) return false;
            return SKIP_KEY_EXACT.has(normalized) || SKIP_KEY_PATTERN.test(normalized);
        };
        const hasSkippedPathSegment = (path = []) => path
            .map(part => String(part || ''))
            .filter(part => !isNumericPathPart(part))
            .some(shouldSkipKey);
        const isProbablyStructuralText = (text = '') => {
            const raw = String(text || '').trim();
            if (!raw) return true;
            if (STRUCTURAL_VALUES.has(raw.toLowerCase())) return true;
            if (/^[\s\d.,:;!?()[\]{}'"`~_+\-*/\\|<>=$#@%&]+$/.test(raw)) return true;
            if (/^<[^>]+>$/.test(raw) || /^\{\{[^}]+\}\}$/.test(raw)) return true;
            if (/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(raw) && /[_:.\d-]/.test(raw)) return true;
            return false;
        };
        const shouldTranslateString = (value, path = [], targetLanguage = '') => {
            const text = String(value || '').trim();
            if (!text || text.length > 6000) return false;
            if (hasSkippedPathSegment(path)) return false;
            const key = lastNamedKey(path);
            if (shouldSkipKey(key)) return false;
            if (NAME_LIST_KEYS.has(key)) return false;
            if (isProbablyStructuralText(text)) return false;
            const hasHangul = /[\u3131-\u318E\uAC00-\uD7A3]/.test(text);
            const hasLatin = /[A-Za-z]/.test(text);
            const hasCjkKana = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(text);
            if (targetLanguage === 'Korean' && hasHangul && !hasLatin && !hasCjkKana) return false;
            if (targetLanguage === 'English' && hasLatin && !hasHangul && !hasCjkKana) return false;
            return /[A-Za-z\u3131-\u318E\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(text);
        };
        const collectStringLeaves = (node, targetLanguage, path = [], out = []) => {
            if (typeof node === 'string') {
                if (shouldTranslateString(node, path, targetLanguage)) {
                    out.push({ id: `t${out.length + 1}`, path: path.slice(), pathLabel: makePathLabel(path), text: node });
                }
                return out;
            }
            if (!node || typeof node !== 'object') return out;
            if (Array.isArray(node)) {
                node.forEach((value, index) => collectStringLeaves(value, targetLanguage, [...path, index], out));
                return out;
            }
            for (const [key, value] of Object.entries(node)) {
                if (shouldSkipKey(key)) continue;
                collectStringLeaves(value, targetLanguage, [...path, key], out);
            }
            return out;
        };
        const setPathValue = (root, path = [], value) => {
            let cursor = root;
            for (let i = 0; i < path.length - 1; i++) {
                if (!cursor || typeof cursor !== 'object') return false;
                cursor = cursor[path[i]];
            }
            if (!cursor || typeof cursor !== 'object') return false;
            cursor[path[path.length - 1]] = value;
            return true;
        };
        const makeBatches = (items = []) => {
            const batches = [];
            let current = [];
            let chars = 0;
            for (const item of items) {
                const itemChars = String(item?.text || '').length + String(item?.id || '').length + 64;
                if (current.length && (current.length >= MAX_BATCH_ITEMS || chars + itemChars > MAX_BATCH_CHARS)) {
                    batches.push(current);
                    current = [];
                    chars = 0;
                }
                current.push(item);
                chars += itemChars;
            }
            if (current.length) batches.push(current);
            return batches;
        };
        const buildTranslationSystemPrompt = (targetLanguage) => [
            'You translate LIBRA internal structured data values.',
            `Target language: ${targetLanguage}.`,
            'Return JSON only. No markdown. No commentary.',
            'Input shape: {"items":[{"id":"t1","text":"..."}]}.',
            'Output shape: {"translations":[{"id":"t1","text":"translated text"}]}.',
            'Translate only the text values. Preserve each id exactly.',
            'Preserve character names, proper nouns, IDs, placeholders like {{user}}, XML/HTML tags, markdown markers, and numeric values.',
            'Do not invent, summarize, omit, censor, or add facts.',
            'Keep line breaks and list formatting as close as possible.'
        ].join('\n');
        const parseTranslationRows = (rawText = '') => {
            const cleaned = Utils.stripLLMThinkingTags(String(rawText || '').trim())
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
            const candidates = [];
            const parseErrors = [];
            try { candidates.push(JSON.parse(cleaned)); } catch (error) {
                parseErrors.push(error?.message || String(error || 'direct_parse_failed'));
            }
            const extracted = extractStructuredJson(cleaned);
            if (extracted) candidates.push(extracted);
            const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                try { candidates.push(JSON.parse(arrayMatch[0])); } catch (error) {
                    parseErrors.push(error?.message || String(error || 'array_parse_failed'));
                }
            }
            for (const candidate of candidates) {
                const rows = Array.isArray(candidate)
                    ? candidate
                    : Array.isArray(candidate?.translations)
                        ? candidate.translations
                        : Array.isArray(candidate?.items)
                            ? candidate.items
                            : [];
                if (rows.length) {
                    return rows
                        .map(row => ({
                            id: String(row?.id || '').trim(),
                            text: typeof row?.text === 'string'
                                ? row.text
                                : typeof row?.translation === 'string'
                                    ? row.translation
                                    : ''
                        }))
                        .filter(row => row.id && row.text);
                }
            }
            if (!candidates.length && cleaned) {
                recordSuppressedRuntimeError('internal_translation.parse_rows_failed', new Error(parseErrors[0] || 'no_json_candidate'), {
                    domain: 'internal_data_translation',
                    rawChars: cleaned.length
                });
            }
            return [];
        };
        const callTranslator = async (config, batch, targetLanguage, options = {}) => {
            const profile = resolveAnalysisProfile(config);
            const payload = {
                targetLanguage,
                items: batch.map(item => ({ id: item.id, text: item.text }))
            };
            const callOptions = {
                maxTokens: Math.max(1200, Math.min(6000, Math.ceil(JSON.stringify(payload).length * 0.8) + 800)),
                profile,
                label: `internal-data-translation-${targetLanguage.toLowerCase()}`,
                domain: 'internal_data_translation',
                reason: 'internal-data-language-migration',
                internalDataLanguageGuard: false,
                jsonMode: true,
                forceJsonMode: true
            };
            const result = await LLMProvider.call(
                config,
                buildTranslationSystemPrompt(targetLanguage),
                JSON.stringify(payload, null, 2),
                callOptions
            );
            let rows = parseTranslationRows(result?.content || '');
            if (rows.length < batch.length) {
                const repair = await LLMProvider.call(
                    config,
                    [
                        'Repair the translation result into valid JSON only.',
                        `Target language remains ${targetLanguage}.`,
                        'Return exactly {"translations":[{"id":"...","text":"..."}]}.',
                        'Use the original id values and preserve missing items by translating their original text.'
                    ].join('\n'),
                    JSON.stringify({
                        requiredItems: payload.items,
                        previousOutput: String(result?.content || '')
                    }, null, 2),
                    { ...callOptions, label: `internal-data-translation-repair-${targetLanguage.toLowerCase()}` }
                );
                rows = parseTranslationRows(repair?.content || '');
            }
            const map = new Map(rows.map(row => [row.id, row.text]));
            return map;
        };
        const translateEntryContent = async (entry, config, targetLanguage, options = {}) => {
            if (!entry || !ALLOWED_COMMENTS.has(String(entry.comment || ''))) return { changed: false, scanned: 0, translated: 0, batches: 0 };
            let parsed;
            try { parsed = JSON.parse(String(entry.content || '{}')); }
            catch (_) { return { changed: false, scanned: 0, translated: 0, batches: 0, skipped: 'invalid_json' }; }
            const items = collectStringLeaves(parsed, targetLanguage);
            if (!items.length) return { changed: false, scanned: 0, translated: 0, batches: 0 };
            let translated = 0;
            let changed = false;
            const batches = makeBatches(items);
            for (let i = 0; i < batches.length; i++) {
                options.onProgress?.({
                    entry,
                    batchIndex: i + 1,
                    batchCount: batches.length,
                    itemCount: items.length,
                    translated
                });
                const translatedMap = await callTranslator(config, batches[i], targetLanguage, options);
                for (const item of batches[i]) {
                    const nextText = translatedMap.get(item.id);
                    if (typeof nextText !== 'string' || !nextText.trim()) continue;
                    translated += 1;
                    if (nextText !== item.text && setPathValue(parsed, item.path, nextText)) changed = true;
                }
            }
            if (changed) entry.content = JSON.stringify(parsed, null, 2);
            return { changed, scanned: items.length, translated, batches: batches.length };
        };
        const migrateLorebook = async (lorebook, config, targetLanguage, options = {}) => {
            const target = normalizeTarget(targetLanguage);
            if (!target) throw new Error('내부 데이터 번역 대상 언어가 지정되지 않았습니다.');
            if (!(LLMProvider.isConfigured(config, 'primary') || LLMProvider.isConfigured(config, 'aux'))) {
                throw new Error('내부 데이터 번역에 사용할 LLM이 설정되어 있지 않습니다.');
            }
            const workingLore = LibraLoreConsolidator.unpack(Array.isArray(lorebook) ? lorebook : []).map(entry => safeClone(entry));
            const stats = { targetLanguage: target, entriesScanned: 0, entriesChanged: 0, stringsScanned: 0, stringsTranslated: 0, batches: 0 };
            const targets = workingLore.filter(entry => ALLOWED_COMMENTS.has(String(entry?.comment || '')));
            for (let i = 0; i < targets.length; i++) {
                const entry = targets[i];
                stats.entriesScanned += 1;
                options.onProgress?.({ entry, entryIndex: i + 1, entryCount: targets.length, stats: { ...stats } });
                const result = await translateEntryContent(entry, config, target, options);
                stats.stringsScanned += result.scanned || 0;
                stats.stringsTranslated += result.translated || 0;
                stats.batches += result.batches || 0;
                if (result.changed) stats.entriesChanged += 1;
            }
            return { lorebook: workingLore, stats };
        };
        return { migrateLorebook, normalizeTarget, ALLOWED_COMMENTS };
    })();


    // ══════════════════════════════════════════════════════════════
    // [MANAGER] SourceReflectionManager — source data -> visible LIBRA data only
    // ══════════════════════════════════════════════════════════════
    const SourceReflectionManager = (() => {
        const COMMENT = 'lmai_source_reflection_state';
        const VERSION = 1;
        const MAX_TEXTS_PER_SOURCE = 48;
        const MAX_CHARS_PER_TEXT = 2400;
        const MAX_COMBINED_CHARS = 52000;
        const SOURCE_LABELS = Object.freeze({
            character_card: 'Character Card + Character Lorebook',
            persona_binding: 'RisuAI Persona Binding',
            hypa_v3: 'Hypa V3 Modal',
            module_lorebook: 'Selected Module Lorebook'
        });
        const clip = (value = '', max = MAX_CHARS_PER_TEXT) => {
            const text = String(value || '')
                .replace(/\r\n/g, '\n')
                .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, ' ')
                .replace(/[ \t]+/g, ' ')
                .trim();
            const limit = Math.max(120, Number(max || MAX_CHARS_PER_TEXT));
            return text.length > limit ? `${text.slice(0, limit).trim()}...[cut]` : text;
        };
        const normalizeId = (value = '') => String(value || '')
            .normalize('NFKC')
            .trim()
            .toLowerCase()
            .replace(/[\s]+/g, '_');
        const splitIds = (value = '') => {
            if (Array.isArray(value)) return value.map(splitIds).flat().filter(Boolean);
            return String(value || '')
                .split(/[\n\r,|;]+/g)
                .map(normalizeId)
                .filter(Boolean);
        };
        const moduleIdentityKeys = (module = null) => [
            module?.id,
            module?._id,
            module?.key,
            module?.namespace,
            module?.name,
            module?.displayName
        ].map(normalizeId).filter(Boolean);
        const getScopeKey = (chat = null, char = null) => getChatRuntimeScopeKey(chat || {}, char || {});
        const getStateIndex = (lorebook = [], scopeKey = '') => (Array.isArray(lorebook) ? lorebook : []).findIndex(entry => {
            if (entry?.comment !== COMMENT) return false;
            try {
                const parsed = JSON.parse(entry.content || '{}');
                return String(parsed?.scopeKey || '') === String(scopeKey || '');
            } catch {
                return false;
            }
        });
        const loadState = (lorebook = [], scopeKey = '') => {
            const idx = getStateIndex(lorebook, scopeKey);
            if (idx < 0) return { version: VERSION, scopeKey, signatures: {}, counts: {}, reflectedAt: 0, sources: {} };
            try {
                const parsed = JSON.parse(lorebook[idx].content || '{}');
                return {
                    version: VERSION,
                    scopeKey,
                    signatures: parsed?.signatures && typeof parsed.signatures === 'object' ? parsed.signatures : {},
                    counts: parsed?.counts && typeof parsed.counts === 'object' ? parsed.counts : {},
                    reflectedAt: Number(parsed?.reflectedAt || 0),
                    sources: parsed?.sources && typeof parsed.sources === 'object' ? parsed.sources : {}
                };
            } catch {
                return { version: VERSION, scopeKey, signatures: {}, counts: {}, reflectedAt: 0, sources: {} };
            }
        };
        const saveState = (lorebook = [], state = {}, chat = null, char = null) => {
            if (!Array.isArray(lorebook)) return false;
            const normalizedState = {
                ...((state && typeof state === 'object') ? state : {}),
                signatures: state?.signatures && typeof state.signatures === 'object' ? { ...state.signatures } : {},
                counts: state?.counts && typeof state.counts === 'object' ? { ...state.counts } : {},
                sources: state?.sources && typeof state.sources === 'object' ? { ...state.sources } : {}
            };
            const scopeKey = String(normalizedState?.scopeKey || getScopeKey(chat, char) || 'global');
            const payload = {
                version: VERSION,
                scopeKey,
                chatId: String(chat?.id || '').trim(),
                charId: String(char?.chaId || char?.id || '').trim(),
                reflectedAt: Date.now(),
                signatures: normalizedState?.signatures && typeof normalizedState.signatures === 'object' ? normalizedState.signatures : {},
                counts: normalizedState?.counts && typeof normalizedState.counts === 'object' ? normalizedState.counts : {},
                sources: normalizedState?.sources && typeof normalizedState.sources === 'object' ? normalizedState.sources : {}
            };
            const entry = {
                key: `lmai_source_reflection_state::${TokenizerEngine.simpleHash(scopeKey)}`,
                comment: COMMENT,
                content: JSON.stringify(payload, null, 2),
                mode: 'normal',
                insertorder: 89,
                alwaysActive: false
            };
            const idx = getStateIndex(lorebook, scopeKey);
            if (idx >= 0) lorebook[idx] = entry;
            else lorebook.push(entry);
            return true;
        };
        const pushText = (items, label, text, max = MAX_CHARS_PER_TEXT) => {
            const clipped = clip(text, max);
            if (!clipped) return;
            items.push(`[${label}]\n${clipped}`);
        };
        const collectCharacterSourceTexts = (char = null) => {
            const texts = [];
            if (!char || typeof char !== 'object') return texts;
            const fields = [
                ['Character Name', char.name || char.displayName],
                ['Character Description', char.description || char.desc || char.detail || char.details],
                ['Character Personality', char.personality || char.persona || char.traits],
                ['Scenario', char.scenario || char.situation || char.context],
                ['First Message', char.firstMessage || char.first_message || char.greeting],
                ['Creator Notes', char.creatorNotes || char.creator_notes || char.note || char.notes],
                ['Default Variables', char.defaultVariables]
            ];
            for (const [label, value] of fields) pushText(texts, label, value, 3000);
            const lore = MemoryEngine.getEffectiveLorebook(char, null);
            lore
                .filter(entry => !entry?.comment || !String(entry.comment).startsWith('lmai_'))
                .slice(0, MAX_TEXTS_PER_SOURCE)
                .forEach((entry, index) => {
                    const key = [entry?.key, entry?.secondkey].map(v => String(v || '').trim()).filter(Boolean).join(' / ');
                    const title = key || entry?.comment || entry?.id || `entry-${index + 1}`;
                    pushText(texts, `Character Lorebook: ${title}`, entry?.content || '', 2200);
                });
            return texts.slice(0, MAX_TEXTS_PER_SOURCE);
        };
        const extractPersonaPrompt = (persona = null) => {
            if (!persona || typeof persona !== 'object') return '';
            const fields = [
                persona.personaPrompt,
                persona.prompt,
                persona.description,
                persona.desc,
                persona.detail,
                persona.details,
                persona.note,
                persona.notes,
                persona.content
            ];
            return clip(fields.map(v => String(v || '').trim()).filter(Boolean).join('\n\n'), 6000);
        };
        const resolvePersonaBinding = (db = null, chat = null) => {
            const personas = Array.isArray(db?.personas) ? db.personas : [];
            const byId = (id = '') => {
                const needle = String(id || '').trim();
                if (!needle) return null;
                return personas.find(p => String(p?.id || p?._id || p?.key || p?.name || '').trim() === needle) || null;
            };
            const boundId = String(chat?.bindedPersona || chat?.boundPersona || chat?.personaId || chat?.persona || '').trim();
            let persona = byId(boundId);
            let source = persona ? 'chat_binding' : '';
            if (!persona) {
                const selected = Number(db?.selectedPersona);
                if (Number.isInteger(selected) && selected >= 0 && personas[selected]) {
                    persona = personas[selected];
                    source = 'selectedPersona';
                }
            }
            if (!persona) {
                persona = personas.find(p => String(p?.personaPrompt || p?.prompt || p?.description || '').trim()) || personas[0] || null;
                source = persona ? 'fallback_persona' : '';
            }
            if (!persona) return null;
            const name = String(persona.name || persona.displayName || persona.nickname || 'User').trim() || 'User';
            const prompt = extractPersonaPrompt(persona);
            return {
                id: String(persona.id || persona._id || persona.key || '').trim(),
                name,
                source,
                prompt,
                raw: persona
            };
        };
        const buildPersonaAliasCandidates = (value = '') => {
            const raw = String(value || '').trim();
            if (!raw) return [];
            const aliases = new Set([raw]);
            aliases.add(raw.toLowerCase());
            raw.split(/[\s,;|/·・]+/g).map(part => part.trim()).filter(Boolean).forEach(part => {
                aliases.add(part);
                aliases.add(part.toLowerCase());
            });
            const withoutTemplate = raw.replace(/\{\{\s*user\s*\}\}/gi, '').trim();
            if (withoutTemplate) aliases.add(withoutTemplate);
            return [...aliases].filter(Boolean).slice(0, 24);
        };
        const collectPersonaTexts = (db = null, chat = null) => {
            const persona = resolvePersonaBinding(db, chat);
            if (!persona) return [];
            const texts = [];
            pushText(texts, `Persona Binding: ${persona.name} (${persona.source || 'unknown'})`, persona.prompt || persona.name, 4000);
            return texts;
        };
        const syncPersonaIdentity = async (char = null, chat = null, lorebook = [], db = null, options = {}) => {
            if (!Array.isArray(lorebook)) return { changed: false, reason: 'invalid_lore' };
            const persona = resolvePersonaBinding(db, chat);
            if (!persona) return { changed: false, reason: 'no_persona' };
            EntityManager.refreshIdentity(char, db);
            const canonical = persona.name || 'User';
            const aliases = new Set(['user', '사용자', 'you', 'me', '나', '본인', '{{user}}']);
            buildPersonaAliasCandidates(canonical).forEach(alias => aliases.add(alias));
            const promptText = persona.prompt || '';
            const aliasMatches = promptText.match(/(?:alias|aliases|별칭|호칭|이름)\s*[:=]\s*([^\n]+)/gi) || [];
            aliasMatches.forEach(line => String(line).split(/[:=]/).slice(1).join(':').split(/[,/|;·・]/g).forEach(part => {
                const v = part.trim();
                if (v) buildPersonaAliasCandidates(v).forEach(alias => aliases.add(alias));
            }));
            const scopeKey = getScopeKey(chat, char);
            const signature = TokenizerEngine.simpleHash(JSON.stringify({ id: persona.id, name: persona.name, source: persona.source, prompt: promptText }));
            const stateEntry = {
                version: 1,
                scopeKey,
                chatId: String(chat?.id || '').trim(),
                personaId: persona.id,
                personaName: persona.name,
                source: persona.source,
                signature,
                aliases: [...aliases].slice(0, 80),
                updatedAt: Date.now(),
                note: 'Visible sync record only. The persona prompt itself is not directly injected by LIBRA.'
            };
            const entry = {
                key: `lmai_user_identity::${TokenizerEngine.simpleHash(scopeKey || persona.name)}`,
                comment: 'lmai_user_identity',
                content: JSON.stringify(stateEntry, null, 2),
                mode: 'normal',
                insertorder: 88,
                alwaysActive: false
            };
            let changed = false;
            const existingIdx = lorebook.findIndex(item => item?.comment === 'lmai_user_identity');
            const existingSig = existingIdx >= 0 ? (() => { try { return JSON.parse(lorebook[existingIdx].content || '{}')?.signature || ''; } catch { return ''; } })() : '';
            if (existingIdx < 0) { lorebook.push(entry); changed = true; }
            else if (existingSig !== signature) { lorebook[existingIdx] = entry; changed = true; }
            const existingEntity = EntityManager.getOrCreateEntity(canonical, lorebook);
            const beforeEntity = JSON.stringify(existingEntity || {});
            const updates = {
                source: 'persona_binding',
                s_id: 'persona_binding',
                background: { history: promptText ? [`RisuAI persona binding: ${clip(promptText, 420)}`] : [] },
                forceReplace: false
            };
            const entity = EntityManager.updateEntity(canonical, updates, lorebook);
            if (entity) {
                entity.meta = entity.meta || {};
                const aliasList = [...aliases].slice(0, 80);
                entity.meta.role = 'user_persona';
                entity.meta.isUserPersona = true;
                entity.meta.personaId = persona.id || entity.meta.personaId || '';
                entity.meta.personaSource = persona.source || entity.meta.personaSource || '';
                entity.meta.aliases = dedupeTextArray([...(Array.isArray(entity.meta.aliases) ? entity.meta.aliases : []), ...aliasList]);
                entity.meta.hiddenNameKeys = dedupeTextArray([...(Array.isArray(entity.meta.hiddenNameKeys) ? entity.meta.hiddenNameKeys : []), ...aliasList.map(a => String(a || '').toLowerCase())]);
                if (JSON.stringify(entity) !== beforeEntity) changed = true;
            }
            return { changed, persona: stateEntry, signature };
        };
        const getHypaCategoryMap = (hypaData = {}) => {
            const map = new Map();
            const categories = Array.isArray(hypaData?.categories) ? hypaData.categories : [];
            categories.forEach(cat => {
                const id = String(cat?.id || cat?._id || cat?.key || '').trim();
                const name = String(cat?.name || cat?.title || cat?.label || '').trim();
                if (id && name) map.set(id, name);
            });
            return map;
        };
        const collectHypaV3Texts = (chat = null) => {
            const data = chat?.hypaV3Data;
            if (!data || !Array.isArray(data?.summaries)) return [];
            const categoryMap = getHypaCategoryMap(data);
            return data.summaries.slice(0, MAX_TEXTS_PER_SOURCE).map((summary, idx) => {
                const text = String(summary?.text || '').trim();
                if (!text) return '';
                const categoryName = categoryMap.get(String(summary?.categoryId || '')) || '';
                const tags = Array.isArray(summary?.tags) ? summary.tags.map(String).filter(Boolean).join(', ') : '';
                return [`[Hypa V3 #${idx + 1}${categoryName ? ` / ${categoryName}` : ''}${summary?.isImportant ? ' / important' : ''}]`, tags ? `tags: ${tags}` : '', text].filter(Boolean).join('\n');
            }).filter(Boolean);
        };
        const collectModuleLoreTexts = (db = null, selectedIdsRaw = '') => {
            const selected = new Set(splitIds(selectedIdsRaw));
            if (selected.size === 0) return [];
            const modules = Array.isArray(db?.modules) ? db.modules : [];
            const texts = [];
            modules.forEach(module => {
                const keys = moduleIdentityKeys(module);
                if (!keys.some(key => selected.has(key))) return;
                const lore = Array.isArray(module?.lorebook)
                    ? module.lorebook
                    : Array.isArray(module?.data?.lorebook)
                        ? module.data.lorebook
                        : Array.isArray(module?.lore)
                            ? module.lore
                            : [];
                lore
                    .filter(entry => entry && entry.disabled !== true && entry.enabled !== false)
                    .slice(0, MAX_TEXTS_PER_SOURCE)
                    .forEach((entry, idx) => {
                        const title = [module.name || module.namespace || module.id || 'module', entry.comment || entry.key || `entry-${idx + 1}`]
                            .map(v => String(v || '').trim()).filter(Boolean).join(' :: ');
                        const body = [entry.key ? `key: ${entry.key}` : '', entry.secondkey ? `secondkey: ${entry.secondkey}` : '', entry.content || '']
                            .filter(Boolean).join('\n');
                        pushText(texts, `Module Lorebook: ${title}`, body, 2200);
                    });
            });
            return texts.slice(0, MAX_TEXTS_PER_SOURCE);
        };
        const computeSignature = (items = []) => TokenizerEngine.simpleHash(JSON.stringify((Array.isArray(items) ? items : []).map(item => clip(item, 1200))));
        const trimCombined = (items = []) => {
            const out = [];
            let chars = 0;
            for (const item of Array.isArray(items) ? items : []) {
                const text = clip(item, MAX_CHARS_PER_TEXT);
                if (!text) continue;
                const nextLen = chars + text.length + 2;
                if (nextLen > MAX_COMBINED_CHARS) break;
                out.push(text);
                chars = nextLen;
            }
            return out;
        };
        const collectSources = (char = null, chat = null, db = null, config = MemoryEngine.CONFIG) => {
            const sources = {};
            if (config?.characterSourceReflectionEnabled !== false) sources.character_card = collectCharacterSourceTexts(char);
            if (config?.personaBindingSyncEnabled !== false) sources.persona_binding = collectPersonaTexts(db, chat);
            if (config?.hypaV3AutoReflectEnabled === true) sources.hypa_v3 = collectHypaV3Texts(chat);
            if (config?.moduleLorebookReflectionEnabled === true && String(config?.moduleLorebookSelectedIds || '').trim()) {
                sources.module_lorebook = collectModuleLoreTexts(db, config.moduleLorebookSelectedIds);
            }
            return sources;
        };
        const reflectIfNeeded = async (char = null, chat = null, lorebook = [], db = null, options = {}) => {
            if (!Array.isArray(lorebook)) return { ok: false, changed: false, reason: 'invalid_lore' };
            const config = MemoryEngine.CONFIG || {};
            const scopeKey = getScopeKey(chat, char);
            const previous = loadState(lorebook, scopeKey);
            let personaSync = { changed: false };
            if (config.personaBindingSyncEnabled !== false) {
                personaSync = await syncPersonaIdentity(char, chat, lorebook, db, options);
            }
            const sources = collectSources(char, chat, db, config);
            const signatures = { ...(previous.signatures || {}) };
            const counts = {};
            const sourcesSummary = {};
            const changedTypes = [];
            for (const [type, items] of Object.entries(sources)) {
                const normalizedItems = trimCombined(items);
                counts[type] = normalizedItems.length;
                sourcesSummary[type] = { label: SOURCE_LABELS[type] || type, count: normalizedItems.length };
                const sig = computeSignature(normalizedItems);
                if (sig && sig !== previous.signatures?.[type]) changedTypes.push(type);
                signatures[type] = sig;
            }
            const reflectTypes = changedTypes.filter(type => type !== 'persona_binding' && counts[type] > 0);
            let reflected = false;
            let llmSkipped = false;
            if ((options.force === true || reflectTypes.length > 0) && reflectTypes.length > 0) {
                if (!config.useLLM) {
                    llmSkipped = true;
                } else {
                    const combinedTexts = trimCombined(reflectTypes.flatMap(type => sources[type] || []));
                    if (combinedTexts.length > 0) {
                        notifyLibraTask('원천 데이터를 LIBRA 데이터에 반영하고 있습니다.', { key: `libra-source-reflect-${scopeKey}`, duration: 1600 });
                        const label = reflectTypes.map(type => SOURCE_LABELS[type] || type).join(' + ');
                        await ColdStartManager.integrateImportedKnowledge(combinedTexts, label, {
                            sourceId: reflectTypes.length === 1 ? reflectTypes[0] : 'source_reflection',
                            worldNote: `Updated via ${label} source reflection`,
                            updateNarrative: true,
                            targetChar: char,
                            targetChat: chat
                        });
                        reflected = true;
                    }
                }
            }
            if (llmSkipped && !personaSync.changed) {
                return { ok: false, changed: false, reason: 'llm_disabled', changedTypes, counts };
            }
            if (!reflected && !personaSync.changed && changedTypes.length === 0 && options.force !== true) {
                return { ok: true, changed: false, reflected: false, personaSynced: false, changedTypes, counts };
            }
            const latestCtx = await resolveActiveChatContext(chat);
            const expectedChatId = String(chat?.id || '').trim();
            if (expectedChatId && (!latestCtx?.chat || String(latestCtx.chat?.id || '') !== expectedChatId)) {
                throw new Error('원천 데이터 반영 대상 채팅방을 찾을 수 없습니다.');
            }
            const latestChar = latestCtx?.char || char;
            const latestChat = latestCtx?.chat || chat;
            const latestLore = MemoryEngine.getLorebook(latestChar, latestChat) || lorebook;
            if (personaSync.changed && latestLore !== lorebook) {
                personaSync = await syncPersonaIdentity(latestChar, latestChat, latestLore, db, options);
            }
            if (personaSync.changed) {
                await EntityManager.saveToLorebook(latestChar, latestChat, latestLore);
            }
            saveState(latestLore, { scopeKey: getScopeKey(latestChat, latestChar), signatures, counts, sources: sourcesSummary }, latestChat, latestChar);
            await SecretKnowledgeCore.saveState(latestLore, {
                scopeKey: getChatRuntimeScopeKey(latestChat, latestChar),
                chatId: String(latestChat?.id || getActiveManagedChatId() || '').trim()
            });
            await EntityKnowledgeVaultCore.saveState(latestLore, {
                scopeKey: getChatRuntimeScopeKey(latestChat, latestChar),
                chatId: String(latestChat?.id || getActiveManagedChatId() || '').trim()
            });
            await TimeEngine.saveState(latestLore, {
                scopeKey: getChatRuntimeScopeKey(latestChat, latestChar),
                chatId: String(latestChat?.id || getActiveManagedChatId() || '').trim()
            });
            MemoryEngine.setLorebook(latestChar, latestChat, latestLore);
            const persistResult = await persistLoreToActiveChat(latestChat, latestLore);
            if (!persistResult?.ok) {
                throw new Error(`원천 데이터 반영 저장 실패: ${persistResult?.reason || 'unknown'}`);
            }
            if (reflected || personaSync.changed) notifyLibraTask('원천 데이터 반영을 완료했습니다.', { key: `libra-source-reflect-complete-${scopeKey}`, duration: 1500 });
            return { ok: !llmSkipped, changed: reflected || personaSync.changed, reflected, personaSynced: !!personaSync.changed, changedTypes, counts, reason: llmSkipped ? 'llm_disabled' : undefined };
        };
        const getStatus = (lorebook = [], chat = null, char = null) => {
            const scopeKey = getScopeKey(chat, char);
            const state = loadState(lorebook, scopeKey);
            return {
                ok: true,
                scopeKey,
                reflectedAt: state.reflectedAt || 0,
                counts: state.counts || {},
                sources: state.sources || {},
                signatures: state.signatures || {}
            };
        };
        const getSelectedActiveModuleIds = (db = null, chat = null, char = null) => {
            const ids = new Set();
            const add = (value) => splitIds(value).forEach(id => ids.add(id));
            add(db?.enabledModules);
            add(db?.moduleIntergration);
            add(db?.moduleIntegration);
            add(chat?.modules);
            add(char?.modules);
            return [...ids].filter(Boolean);
        };
        return Object.freeze({
            reflectIfNeeded,
            getStatus,
            collectSources,
            collectHypaV3Texts,
            collectModuleLoreTexts,
            collectCharacterSourceTexts,
            resolvePersonaBinding,
            syncPersonaIdentity,
            getHypaCategoryMap,
            getSelectedActiveModuleIds,
            splitIds
        });
    })();
    const getHypaCategoryMap = (hypaData = {}) => SourceReflectionManager.getHypaCategoryMap(hypaData);

    // ══════════════════════════════════════════════════════════════
    // [ENGINE] CBSEngine
    // ══════════════════════════════════════════════════════════════
    const CBSEngine = (() => {
        const R = /^(\w+)\s*(>=|<=|==|!=|>|<)\s*(".*?"|-?\d+\.?\d*)$/;
        const safeTrim = (v) => typeof v === "string" ? v.trim() : "";

        function parseDefaultVariables(raw) {
            return String(raw || "").split(/\r?\n/g).map((line) => line.trim()).filter(Boolean).map((line) => {
                const eq = line.indexOf("=");
                if (eq === -1) return null;
                return [line.slice(0, eq).trim(), line.slice(eq + 1)];
            }).filter((pair) => pair && pair[0]);
        }

        function splitTopLevelCbsByDoubleColon(raw) {
            const src = String(raw || "");
            const result = [];
            let current = "", braceDepth = 0, parenDepth = 0;
            for (let i = 0; i < src.length; i += 1) {
                const two = src.slice(i, i + 2);
                if (two === "{{") { braceDepth += 1; current += two; i += 1; continue; }
                if (two === "}}" && braceDepth > 0) { braceDepth -= 1; current += two; i += 1; continue; }
                if (src[i] === "(") parenDepth += 1;
                if (src[i] === ")" && parenDepth > 0) parenDepth -= 1;
                if (two === "::" && braceDepth === 0 && parenDepth === 0) { result.push(current); current = ""; i += 1; continue; }
                current += src[i];
            }
            result.push(current);
            return result;
        }

        function readCbsTagAt(text, startIndex) {
            if (String(text || "").slice(startIndex, startIndex + 2) !== "{{") return null;
            let depth = 1, i = startIndex + 2;
            while (i < text.length) {
                const two = text.slice(i, i + 2);
                if (two === "{{") { depth += 1; i += 2; continue; }
                if (two === "}}") { depth -= 1; i += 2; if (depth === 0) return { start: startIndex, end: i, raw: text.slice(startIndex, i), inner: text.slice(startIndex + 2, i - 2) }; continue; }
                i += 1;
            }
            return null;
        }

        function findNextCbsTag(text, startIndex) {
            const src = String(text || "");
            for (let i = startIndex; i < src.length - 1; i += 1) { if (src[i] === "{" && src[i + 1] === "{") return readCbsTagAt(src, i); }
            return null;
        }

        function readBracketCbsExprAt(text, startIndex) {
            const src = String(text || "");
            if (src.slice(startIndex, startIndex + 10) !== "[CBS_EXPR:") return null;
            let i = startIndex + 10;
            while (i < src.length) {
                if (src[i] === "]") {
                    return {
                        start: startIndex,
                        end: i + 1,
                        raw: src.slice(startIndex, i + 1),
                        inner: src.slice(startIndex + 10, i)
                    };
                }
                i += 1;
            }
            return null;
        }

        function findNextBracketCbsExpr(text, startIndex) {
            const src = String(text || "");
            for (let i = startIndex; i < src.length - 9; i += 1) {
                if (src[i] === "[" && src.slice(i, i + 10) === "[CBS_EXPR:") return readBracketCbsExprAt(src, i);
            }
            return null;
        }

        function findNextAnyCbsToken(text, startIndex) {
            const curly = findNextCbsTag(text, startIndex);
            const bracket = findNextBracketCbsExpr(text, startIndex);
            if (!curly) return bracket;
            if (!bracket) return curly;
            return curly.start <= bracket.start ? curly : bracket;
        }

        function extractCbsBlock(text, startTag, blockName) {
            let depth = 1, cursor = startTag.end, elseTag = null;
            while (cursor < text.length) {
                const tag = findNextCbsTag(text, cursor);
                if (!tag) break;
                const inner = safeTrim(tag.inner);
                const opensSameBlock = inner.startsWith(`#${blockName} `) || inner.startsWith(`#${blockName}::`);
                const closesSameBlock = inner === `/${blockName}` || inner === "/";
                const isElseTag = inner === "else" || inner === ":else";
                if (opensSameBlock) depth += 1;
                else if (closesSameBlock) { depth -= 1; if (depth === 0) return { body: text.slice(startTag.end, elseTag ? elseTag.start : tag.start), elseBody: elseTag ? text.slice(elseTag.end, tag.start) : "", end: tag.end }; }
                else if (isElseTag && depth === 1 && (blockName === "if" || blockName === "when")) elseTag = tag;
                cursor = tag.end;
            }
            return { body: text.slice(startTag.end), elseBody: "", end: text.length };
        }

        function trimLegacyCbsBlockBody(text) {
            const src = String(text ?? "").replace(/^\n+|\n+$/g, "");
            return src.split(/\r?\n/g).map((line) => line.replace(/^\s+/, "")).join("\n");
        }

        async function evalStandaloneWhenCondition(rawCondition, runtime, args = []) {
            const tokens = splitTopLevelCbsByDoubleColon(String(rawCondition ?? ""));
            let mode = "default";
            if (tokens[0] && safeTrim(tokens[0]).toLowerCase() === "keep") {
                mode = "keep";
                tokens.shift();
            } else if (tokens[0] && safeTrim(tokens[0]).toLowerCase() === "legacy") {
                mode = "legacy";
                tokens.shift();
            }

            async function evalTokens(items) {
                const parts = items.map((item) => safeTrim(String(item ?? ""))).filter((item) => item.length > 0);
                if (parts.length === 0) return false;
                if (parts[0] === "not") return !(await evalTokens(parts.slice(1)));
                if ((parts[0] === "var" || parts[0] === "toggle") && parts.length >= 2) {
                    const value = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args);
                    return isStandaloneCbsTruthy(value);
                }
                if (parts.length === 1) {
                    const value = await renderStandaloneCbsText(parts[0], runtime, args);
                    return isStandaloneCbsTruthy(value);
                }

                const left = await renderStandaloneCbsText(parts[0], runtime, args);
                const op = safeTrim(parts[1]).toLowerCase();
                if (op === "and") return isStandaloneCbsTruthy(left) && (await evalTokens(parts.slice(2)));
                if (op === "or") return isStandaloneCbsTruthy(left) || (await evalTokens(parts.slice(2)));

                const right = await renderStandaloneCbsText(parts[2] || "", runtime, args);
                const leftNum = Number(left), rightNum = Number(right);
                const isNumeric = !Number.isNaN(leftNum) && !Number.isNaN(rightNum);
                switch (op) {
                    case "is":
                    case "vis":
                    case "tis":
                    case "==":
                    case "equal":
                        return left === right;
                    case "isnot":
                    case "visnot":
                    case "tisnot":
                    case "!=":
                    case "notequal":
                    case "not_equal":
                        return left !== right;
                    case ">":
                    case "greater":
                        return isNumeric ? leftNum > rightNum : left > right;
                    case ">=":
                    case "greaterequal":
                    case "greater_equal":
                        return isNumeric ? leftNum >= rightNum : left >= right;
                    case "<":
                    case "less":
                        return isNumeric ? leftNum < rightNum : left < right;
                    case "<=":
                    case "lessequal":
                    case "less_equal":
                        return isNumeric ? leftNum <= rightNum : left <= right;
                    default:
                        return isStandaloneCbsTruthy(await renderStandaloneCbsText(parts.join("::"), runtime, args));
                }
            }

            return {
                truthy: await evalTokens(tokens),
                mode
            };
        }

        async function getStandaloneCbsRuntime() {
            const char = await RisuCompat.getCharacter();
            const chat = await getActiveChatForCharacter(char) || {};
            let db = await getLibraAllowedDatabase(['personas', 'selectedPersona']);
            const vars = Object.create(null);
            for (const [k, v] of parseDefaultVariables(char?.defaultVariables)) vars[k] = String(v ?? "");
            const scriptState = chat?.scriptstate && typeof chat.scriptstate === "object" ? chat.scriptstate : {};
            for (const [rawKey, value] of Object.entries(scriptState)) { const key = String(rawKey || ""); vars[key] = value == null ? "null" : String(value); }
            const globalVars = {};
            const selectedPersonaIndex = Number.isInteger(Number(db?.selectedPersona)) ? Number(db.selectedPersona) : 0;
            const userName = safeTrim(db?.personas?.[selectedPersonaIndex]?.name || "User");
            const chatScopedNote = safeTrim(chat?.note || chat?.globalNote || "");
            const finalDb = { ...db, username: userName, globalNote: chatScopedNote };
            return { char, chat, db: finalDb, vars, globalVars, userName, functions: Object.create(null) };
        }

        function tokenizeStandaloneCbsCalc(src) {
            const tokens = [];
            let i = 0;
            while (i < src.length) {
                const ch = src[i];
                if (/\s/.test(ch)) { i++; continue; }
                if (ch === '"' || ch === "'") {
                    const quote = ch;
                    let value = '';
                    i++;
                    while (i < src.length) {
                        const c = src[i++];
                        if (c === quote) { tokens.push({ type: 'literal', value }); value = null; break; }
                        if (c === '\\') {
                            if (i >= src.length) throw new Error('Invalid escape');
                            const esc = src[i++];
                            value += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === 'r' ? '\r' : esc;
                        } else {
                            value += c;
                        }
                    }
                    if (value !== null) throw new Error('Unterminated string');
                    continue;
                }
                if (/[0-9.]/.test(ch)) {
                    const start = i;
                    let dots = 0;
                    while (i < src.length && /[0-9.]/.test(src[i])) {
                        if (src[i] === '.') dots++;
                        if (dots > 1) throw new Error('Invalid number');
                        i++;
                    }
                    const raw = src.slice(start, i);
                    if (raw === '.' || raw === '') throw new Error('Invalid number');
                    const value = Number(raw);
                    if (!Number.isFinite(value)) throw new Error('Invalid number');
                    tokens.push({ type: 'literal', value });
                    continue;
                }
                if (/[A-Za-z_]/.test(ch)) {
                    const start = i;
                    while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
                    const word = src.slice(start, i).toLowerCase();
                    if (word === 'true') tokens.push({ type: 'literal', value: true });
                    else if (word === 'false') tokens.push({ type: 'literal', value: false });
                    else if (word === 'null') tokens.push({ type: 'literal', value: null });
                    else throw new Error('Unsupported identifier');
                    continue;
                }
                const three = src.slice(i, i + 3);
                if (three === '===' || three === '!==') { tokens.push({ type: 'op', value: three }); i += 3; continue; }
                const two = src.slice(i, i + 2);
                if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) { tokens.push({ type: 'op', value: two }); i += 2; continue; }
                if ('+-*/%()!<>'.includes(ch)) { tokens.push({ type: ch === '(' || ch === ')' ? 'paren' : 'op', value: ch }); i++; continue; }
                throw new Error('Unsupported token');
            }
            return tokens;
        }

        function evaluateStandaloneCbsCalcTokens(tokens) {
            let pos = 0;
            const peek = () => tokens[pos];
            const consume = (value = null) => {
                const token = tokens[pos];
                if (!token || (value !== null && token.value !== value)) return null;
                pos++;
                return token;
            };
            const toNumber = (value) => {
                const n = Number(value);
                if (!Number.isFinite(n)) throw new Error('Expected finite number');
                return n;
            };
            const calcTruthy = (value) => {
                if (typeof value === 'boolean') return value;
                return isStandaloneCbsTruthy(value);
            };

            const parsePrimary = () => {
                const token = peek();
                if (!token) throw new Error('Unexpected end');
                if (token.type === 'literal') { pos++; return token.value; }
                if (consume('(')) {
                    const value = parseLogicalOr();
                    if (!consume(')')) throw new Error('Expected closing parenthesis');
                    return value;
                }
                throw new Error('Expected literal');
            };
            const parseUnary = () => {
                if (consume('!')) return !calcTruthy(parseUnary());
                if (consume('-')) return -toNumber(parseUnary());
                if (consume('+')) return toNumber(parseUnary());
                return parsePrimary();
            };
            const parseMultiplicative = () => {
                let left = parseUnary();
                while (peek() && ['*', '/', '%'].includes(peek().value)) {
                    const op = consume().value;
                    const right = parseUnary();
                    if (op === '*') left = toNumber(left) * toNumber(right);
                    else if (op === '/') left = toNumber(left) / toNumber(right);
                    else left = toNumber(left) % toNumber(right);
                    if (!Number.isFinite(left)) throw new Error('Non-finite result');
                }
                return left;
            };
            const parseAdditive = () => {
                let left = parseMultiplicative();
                while (peek() && ['+', '-'].includes(peek().value)) {
                    const op = consume().value;
                    const right = parseMultiplicative();
                    if (op === '+') {
                        left = (typeof left === 'string' || typeof right === 'string') ? String(left ?? '') + String(right ?? '') : toNumber(left) + toNumber(right);
                    } else {
                        left = toNumber(left) - toNumber(right);
                    }
                }
                return left;
            };
            const parseComparison = () => {
                let left = parseAdditive();
                while (peek() && ['>', '>=', '<', '<='].includes(peek().value)) {
                    const op = consume().value;
                    const right = parseAdditive();
                    const leftNum = Number(left), rightNum = Number(right);
                    const numeric = Number.isFinite(leftNum) && Number.isFinite(rightNum);
                    if (op === '>') left = numeric ? leftNum > rightNum : String(left) > String(right);
                    else if (op === '>=') left = numeric ? leftNum >= rightNum : String(left) >= String(right);
                    else if (op === '<') left = numeric ? leftNum < rightNum : String(left) < String(right);
                    else left = numeric ? leftNum <= rightNum : String(left) <= String(right);
                }
                return left;
            };
            const parseEquality = () => {
                let left = parseComparison();
                while (peek() && ['==', '!=', '===', '!=='].includes(peek().value)) {
                    const op = consume().value;
                    const right = parseComparison();
                    if (op === '===') left = left === right;
                    else if (op === '!==') left = left !== right;
                    else {
                        const leftNum = Number(left), rightNum = Number(right);
                        const numeric = Number.isFinite(leftNum) && Number.isFinite(rightNum);
                        const equal = numeric ? leftNum === rightNum : String(left) === String(right);
                        left = op === '==' ? equal : !equal;
                    }
                }
                return left;
            };
            const parseLogicalAnd = () => {
                let left = parseEquality();
                while (consume('&&')) left = calcTruthy(left) && calcTruthy(parseEquality());
                return left;
            };
            function parseLogicalOr() {
                let left = parseLogicalAnd();
                while (consume('||')) left = calcTruthy(left) || calcTruthy(parseLogicalAnd());
                return left;
            }

            const result = parseLogicalOr();
            if (pos !== tokens.length) throw new Error('Unexpected trailing token');
            return result;
        }

        function evalStandaloneCbsCalc(expression) {
            const src = String(expression || "").replace(/\s+/g, " ").trim();
            if (!src) return "";
            const looksConditional = /[<>=!&|]/.test(src);
            if (src.includes("{{") || src.includes("}}") || src.includes("[CBS_")) return looksConditional ? "0" : src;
            if (src.length > 512) return looksConditional ? "0" : src;
            try {
                const result = evaluateStandaloneCbsCalcTokens(tokenizeStandaloneCbsCalc(src));
                if (typeof result === "boolean") return result ? "1" : "0";
                if (typeof result === "number") return Number.isFinite(result) ? String(result) : (looksConditional ? "0" : src);
                return result == null ? "" : String(result);
            } catch { return looksConditional ? "0" : src; }
        }

        function isStandaloneCbsTruthy(value) {
            const src = safeTrim(String(value ?? ""));
            if (!src || src === "0" || src.toLowerCase() === "false" || src.toLowerCase() === "null") return false;
            return true;
        }

        async function evalStandaloneCbsExpr(inner, runtime, args = []) {
            try {
                let expr = safeTrim(inner); if (!expr) return "";
                if (expr.includes("{{")) { expr = safeTrim(await renderStandaloneCbsText(expr, runtime, args)); if (!expr) return ""; }
                if (expr === "char" || expr === "Char") return safeTrim(runtime?.char?.name || "Char");
                if (expr === "user" || expr === "User") return runtime?.userName || "User";
                const parts = splitTopLevelCbsByDoubleColon(expr).map((s) => String(s ?? ""));
                const head = safeTrim(parts[0] || "");
                if (head === "arg") { const index = Math.max(0, (parseInt(safeTrim(parts[1] || "1"), 10) || 1) - 1); return args[index] ?? "null"; }
                if (head === "getvar") { const keyRaw = parts.slice(1).join("::"); const key = safeTrim(await renderStandaloneCbsText(keyRaw, runtime, args)); if (!key) return "null"; if (Object.prototype.hasOwnProperty.call(runtime.vars, key)) return runtime.vars[key]; if (Object.prototype.hasOwnProperty.call(runtime.globalVars, key)) return runtime.globalVars[key]; return "null"; }
                if (head === "calc") { const expression = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return evalStandaloneCbsCalc(expression); }
                if (head === "call") { runtime._callDepth = (runtime._callDepth || 0) + 1; if (runtime._callDepth > 20) { runtime._callDepth--; return "[ERROR:max recursion]"; } try { const fnName = safeTrim(await renderStandaloneCbsText(parts[1] || "", runtime, args)); const fnBody = runtime.functions[fnName]; if (!fnBody) return ""; const callArgs = []; for (let i = 2; i < parts.length; i += 1) callArgs.push(await renderStandaloneCbsText(parts[i], runtime, args)); return await renderStandaloneCbsText(fnBody, runtime, callArgs); } finally { runtime._callDepth--; } }
                if (head === "none") return "";
                if (head === "char_desc") return safeTrim(runtime?.char?.desc || runtime?.char?.description || "");
                if (head === "ujb") return safeTrim(runtime?.db?.globalNote || "");
                if (head === "system_note") return safeTrim(runtime?.db?.globalNote || "");
                if (head === "random") { const choices = parts.slice(1); if (choices.length === 0) return ""; const randIdx = Math.floor(Math.random() * choices.length); return await renderStandaloneCbsText(choices[randIdx], runtime, args); }
                if (head === "token_count") { const text = await renderStandaloneCbsText(parts.slice(1).join("::"), runtime, args); return String(TokenizerEngine.estimateTokens(text, 'simple')); }
                if (["equal", "not_equal", "greater", "greater_equal", "less", "less_equal"].includes(head)) {
                    const v1 = await renderStandaloneCbsText(parts[1] || "", runtime, args), v2 = await renderStandaloneCbsText(parts[2] || "", runtime, args);
                    const n1 = Number(v1), n2 = Number(v2), isNum = !isNaN(n1) && !isNaN(n2);
                    switch(head) {
                        case "equal": return v1 === v2 ? "1" : "0"; case "not_equal": return v1 !== v2 ? "1" : "0";
                        case "greater": return (isNum ? n1 > n2 : v1 > v2) ? "1" : "0"; case "greater_equal": return (isNum ? n1 >= n2 : v1 >= v2) ? "1" : "0";
                        case "less": return (isNum ? n1 < n2 : v1 < v2) ? "1" : "0"; case "less_equal": return (isNum ? n1 <= n2 : v1 <= v2) ? "1" : "0";
                    }
                }
                if (Object.prototype.hasOwnProperty.call(runtime.vars, expr)) return runtime.vars[expr];
                if (Object.prototype.hasOwnProperty.call(runtime.globalVars, expr)) return runtime.globalVars[expr];
                return expr;
            } catch (e) {
                recordRuntimeDebug('warn', "[LIBRA] CBS Expr Eval Error:", e?.message);
                return "";
            }
        }

        async function evalBracketCbsExpr(inner, runtime, args = []) {
            const parts = splitTopLevelCbsByDoubleColon(inner).map((s) => safeTrim(s));
            const head = parts[0] || "";

            if (!head) return "";
            if (head.toLowerCase() === "annotation") {
                return await renderStandaloneCbsText(parts[1] || "", runtime, args);
            }

            // Fallback: treat payload like a normal CBS expression so unsupported
            // forms degrade into a usable string instead of leaking raw tokens.
            return await evalStandaloneCbsExpr(inner, runtime, args);
        }

        async function renderStandaloneCbsText(text, runtime, args = []) {
            const src = String(text ?? "");
            if (!src || (!src.includes("{{") && !src.includes("[CBS_EXPR:"))) return src;
            let out = "", cursor = 0;
            while (cursor < src.length) {
                const tag = findNextAnyCbsToken(src, cursor);
                if (!tag) { out += src.slice(cursor); break; }
                out += src.slice(cursor, tag.start);
                const inner = safeTrim(tag.inner);
                if (tag.raw.startsWith("[CBS_EXPR:")) {
                    out += await evalBracketCbsExpr(inner, runtime, args);
                    cursor = tag.end;
                    continue;
                }
                if (inner.startsWith("#func ")) { const fnName = safeTrim(inner.slice(6)); const block = extractCbsBlock(src, tag, "func"); if (fnName) runtime.functions[fnName] = block.body; cursor = block.end; continue; }
                if (inner.startsWith("#if_pure ")) { const conditionRaw = inner.slice(9); const block = extractCbsBlock(src, tag, "if_pure"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.body : block.elseBody, runtime, args); cursor = block.end; continue; }
                if (inner.startsWith("#if ")) { const conditionRaw = inner.slice(4); const block = extractCbsBlock(src, tag, "if"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.body : block.elseBody, runtime, args); cursor = block.end; continue; }
                if (inner.startsWith("#unless ")) { const conditionRaw = inner.slice(8); const block = extractCbsBlock(src, tag, "unless"); const condition = await evalStandaloneCbsExpr(conditionRaw, runtime, args); out += await renderStandaloneCbsText(isStandaloneCbsTruthy(condition) ? block.elseBody : block.body, runtime, args); cursor = block.end; continue; }
                if (inner.startsWith("#when ")) {
                    const block = extractCbsBlock(src, tag, "when");
                    const result = await evalStandaloneWhenCondition(inner.slice(6), runtime, args);
                    const selected = result.truthy ? block.body : block.elseBody;
                    const body = result.mode === "legacy" ? trimLegacyCbsBlockBody(selected) : selected;
                    out += await renderStandaloneCbsText(body, runtime, args);
                    cursor = block.end;
                    continue;
                }
                if (inner.startsWith("#when::")) {
                    const block = extractCbsBlock(src, tag, "when");
                    const result = await evalStandaloneWhenCondition(inner.slice(6), runtime, args);
                    const selected = result.truthy ? block.body : block.elseBody;
                    const body = result.mode === "legacy" ? trimLegacyCbsBlockBody(selected) : selected;
                    out += await renderStandaloneCbsText(body, runtime, args);
                    cursor = block.end;
                    continue;
                }
                if (inner === "else" || inner === ":else" || inner === "/if" || inner === "/unless" || inner === "/func" || inner === "/if_pure" || inner === "/when" || inner === "/") { cursor = tag.end; continue; }
                out += await evalStandaloneCbsExpr(inner, runtime, args); cursor = tag.end;
            }
            return out;
        }

        return {
            process: async (text) => {
                if (!MemoryEngine.CONFIG.cbsEnabled) return text;
                const src = String(text ?? ""); if (!src || (!src.includes("{{") && !src.includes("[CBS_EXPR:"))) return src;
                try {
                    const runtime = await getStandaloneCbsRuntime();
                    return await renderStandaloneCbsText(src, runtime, []);
                } catch (e) { recordRuntimeDebug('error', "[LIBRA] CBS Process Error", e); return src; }
            },
            clean: (text) => typeof text === 'string'
                ? text.replace(/\{\{[^}]*\}\}/g, '').replace(/\[CBS_EXPR:[^\]]*\]/g, '').trim()
                : ""
        };
    })();
