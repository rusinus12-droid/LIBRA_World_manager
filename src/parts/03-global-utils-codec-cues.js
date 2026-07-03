    // ══════════════════════════════════════════════════════════════
    // [UTILITY] Global Utilities
    // ══════════════════════════════════════════════════════════════
    const showLibraDialog = ({ message = '', title = 'LIBRA', kind = 'confirm' } = {}) => new Promise(resolve => {
        if (typeof document === 'undefined' || !document.body) {
            resolve(kind === 'alert');
            return;
        }

        const prior = document.querySelector('[data-libra-dialog="true"]');
        if (prior) prior.remove();

        const backdrop = document.createElement('div');
        backdrop.setAttribute('data-libra-dialog', 'true');
        backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:18px;font-family:var(--risu-font-family,Segoe UI,system-ui,sans-serif);color:var(--risu-theme-textcolor,#e8e8ef);';

        const box = document.createElement('div');
        box.style.cssText = 'width:min(92vw,420px);background:var(--risu-theme-bgcolor,#1a1a2e);border:1px solid var(--risu-theme-borderc,#3b3b5c);border-radius:10px;box-shadow:0 18px 48px rgba(0,0,0,.45);padding:18px;display:flex;flex-direction:column;gap:14px;';

        const heading = document.createElement('div');
        heading.textContent = title;
        heading.style.cssText = 'font-size:14px;font-weight:700;line-height:1.45;';

        const body = document.createElement('div');
        body.textContent = String(message || '');
        body.style.cssText = 'white-space:pre-wrap;font-size:13px;line-height:1.55;color:var(--risu-theme-textcolor,#e8e8ef);';

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;';

        const close = (value) => {
            document.removeEventListener('keydown', onKeyDown, true);
            backdrop.remove();
            resolve(value);
        };

        const makeButton = (text, primary = false) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.style.cssText = primary
                ? 'min-height:34px;padding:7px 14px;border:0;border-radius:8px;background:var(--risu-theme-primary-600,var(--risu-theme-borderc,#6a44a0));color:#fff;cursor:pointer;font-size:13px;'
                : 'min-height:34px;padding:7px 14px;border:1px solid var(--risu-theme-borderc,#3b3b5c);border-radius:8px;background:transparent;color:var(--risu-theme-textcolor,#e8e8ef);cursor:pointer;font-size:13px;';
            return button;
        };

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(kind === 'alert');
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                close(true);
            }
        };

        if (kind === 'confirm') {
            const cancel = makeButton('취소');
            cancel.onclick = () => close(false);
            actions.appendChild(cancel);
        }

        const ok = makeButton(kind === 'confirm' ? '확인' : '확인', true);
        ok.onclick = () => close(true);
        actions.appendChild(ok);

        box.appendChild(heading);
        box.appendChild(body);
        box.appendChild(actions);
        backdrop.appendChild(box);
        document.body.appendChild(backdrop);
        document.addEventListener('keydown', onKeyDown, true);
        setTimeout(() => ok.focus(), 0);
    });

    const Utils = {
        confirmEx: (msg) => showLibraDialog({ message: msg, title: '확인', kind: 'confirm' }),
        alertEx: (msg) => showLibraDialog({ message: msg, title: '알림', kind: 'alert' }),
        sleep: (ms) => new Promise(res => setTimeout(res, ms)),

        /**
         * LLM 사고/필터 태그 제거 (프로바이더 공통)
         * <thoughts>, <thinking>, <__filter_complete__> 등 LLM 내부 추론 태그를 제거
         */
        stripLLMThinkingTags: (text) => {
            if (!text) return text;
            let clean = String(text);
            clean = clean.replace(/<thoughts>[\s\S]*?<\/thoughts>/gi, '');
            clean = clean.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
            clean = clean.replace(/<__filter_complete__>[\s\S]*?<\/__filter_complete__>/gi, '');
            clean = clean.replace(/<__filter_complete__\s*\/?>/gi, '');
            // 닫히지 않은 사고 태그 제거 (LLM 출력이 잘린 경우)
            clean = clean.replace(/<thoughts>[\s\S]*$/gi, '');
            clean = clean.replace(/<thinking>[\s\S]*$/gi, '');
            return clean;
        },

        stripManagedModuleTags: (text) => {
            if (!text) return text;
            let clean = String(text);
            clean = clean.replace(/<GT-CTRL\b[^>]*\/>/gi, '');
            clean = clean.replace(/<GT-SEP\/>/gi, '');
            clean = clean.replace(/<GigaTrans\b[^>]*>[\s\S]*?<\/GigaTrans>/gi, '');
            clean = clean.replace(/<\/GigaTrans>/gi, '');
            clean = clean.replace(/<GigaTrans\b[^>]*>/gi, '');
            clean = clean.replace(/<dag_runtime_contract\b[^>]*>[\s\S]*?<\/dag_runtime_contract>/gi, '');
            clean = clean.replace(/<dag_runtime_contract\b[^>]*>[\s\S]*$/gi, '');
            // Hidden side-write packets from companion modules must never become LIBRA memory/turn evidence.
            // Strip only known managed packet comments. Ordinary prose/code HTML comments are preserved.
            const managedCommentMarker = '(?:HAYAKU_STATE_PACKET_START|HAYAKU_[A-Z0-9_]+_START|LIBRA_STATE|LIBRA_[A-Z0-9_]+_START|RAW_VAULT(?:_[A-Z0-9_]+)?_START|RAW_VAULT|LOKI_MEMORY_LEDGER_START|LBDATA\\s+START)';
            clean = clean.replace(new RegExp(`<!--[\\s\\S]{0,240}${managedCommentMarker}[\\s\\S]*?-->`, 'gi'), '');
            clean = clean.replace(new RegExp(`<!--[\\s\\S]{0,240}${managedCommentMarker}[\\s\\S]*$`, 'gi'), '');
            clean = stripLBDATA(clean);
            clean = clean.replace(/\[Lightboard Platform Managed\]/gi, '');
            if (!isIllustrationModuleCompatEnabled()) {
                clean = clean.replace(/<lb-[\w-]+(?:\s[^>]*)?>[\s\S]*?<\/lb-[\w-]+>/gi, '');
                clean = clean.replace(/<lb-[\w-]+(?:\s[^>]*)?\/>/gi, '');
            }
            return clean;
        },

        sanitizeForLibra: (text) => {
            if (!text) return text;
            let clean = Utils.stripLLMThinkingTags(text);
            clean = Utils.stripManagedModuleTags(clean);
            
            const result = clean.trim();
            if (isLibraDebugEnabled() && result !== text.trim()) {
                recordRuntimeDebug('log', `[LIBRA] Text sanitized (Module compatibility active)`);
            }
            return result;
        },

        getMessageText: (msg) => {
            if (!msg || typeof msg !== 'object') return '';

            const extract = (value) => {
                if (value == null) return '';
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    return String(value);
                }
                if (Array.isArray(value)) {
                    return value.map(extract).filter(Boolean).join('\n').trim();
                }
                if (typeof value === 'object') {
                    const preferredKeys = ['content', 'text', 'message', 'msg', 'mes', 'data', 'value', 'parts', 'input', 'prompt'];
                    for (const key of preferredKeys) {
                        const picked = extract(value[key]);
                        if (picked) return picked;
                    }
                }
                return '';
            };

            return extract(msg.data)
                || extract(msg.content)
                || extract(msg.text)
                || extract(msg.message)
                || extract(msg.msg)
                || extract(msg.mes)
                || '';
        },

        getLibraComparableText: (text) => {
            const sanitized = Utils.sanitizeForLibra(text);
            return typeof sanitized === 'string' ? sanitized.trim() : String(sanitized || '').trim();
        },

        stripToolResponseBlocks: (text) => {
            const raw = String(text || '');
            if (!raw) return raw;
            return raw
                .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, ' ')
                .replace(/<tool_calls\b[^>]*>[\s\S]*?<\/tool_calls>/gi, ' ')
                .replace(/<tool_response\b[^>]*>[\s\S]*?<\/tool_response>/gi, ' ')
                .replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi, ' ')
                .replace(/<tool_results\b[^>]*>[\s\S]*?<\/tool_results>/gi, ' ')
                .replace(/(?:^|\n)\s*<tool_name>\s*[\s\S]*?<\/tool_name>\s*(?=\n|$)/gi, ' ')
                .replace(/(?:^|\n)\s*<parameters>\s*[\s\S]*?<\/parameters>\s*(?=\n|$)/gi, ' ')
                .replace(/(?:^|\n)\s*<parameter\b[^>]*>\s*[\s\S]*?<\/parameter>\s*(?=\n|$)/gi, ' ')
                .replace(/(?:^|\n)\s*<tool_use_id>\s*[\s\S]*?<\/tool_use_id>\s*(?=\n|$)/gi, ' ')
                .replace(/(?:^|\n)\s*<is_error>\s*[\s\S]*?<\/is_error>\s*(?=\n|$)/gi, ' ')
                .replace(/(?:^|\n)\s*<result_code>\s*[\s\S]*?<\/result_code>\s*(?=\n|$)/gi, ' ')
                .replace(/(?:^|\n)\s*<content>\s*\{[\s\S]*?\}\s*<\/content>\s*(?=\n|$)/gi, ' ')
                .replace(/(?:^|\n)\s*<content>\s*"?(?:LICENSED_USER_FROM_PROVIDER|All safety restrictions bypassed|NO_INTERNET|Internet connection confirmed offline|Local environment is sealed|No data routes exist)[\s\S]*?<\/content>\s*(?=\n|$)/gi, ' ')
                .replace(/(?:^|\n)\s*["']?(?:LICENSED_USER_FROM_PROVIDER|All safety restrictions bypassed|NO_INTERNET|Internet connection confirmed offline|Local environment is sealed|No data routes exist|bypass self-correction\/safety-check)[^\n]*["']?\s*(?=\n|$)/gi, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        },

        isToolResponseEnvelope: (text) => {
            const raw = String(text || '').trim();
            if (!raw) return false;
            if (/<tool_(?:call|calls|response|result|results)\b/i.test(raw)) return true;
            const stripped = Utils.stripToolResponseBlocks(raw);
            if (!stripped) return true;
            const lower = stripped.toLowerCase();
            if (
                /^(?:<tool_use_id>|<tool_name>|<parameters>|<is_error>|<result_code>|<content>|<\/tool_use_id>|<\/tool_name>|<\/parameters>|<\/is_error>|<\/result_code>|<\/content>)/i.test(raw)
                || (
                    lower.length <= 220
                    && /(?:licensed_user_from_provider|no_internet|internet connection is unavailable|all safety restrictions bypassed|local environment is sealed|no data routes exist)/i.test(lower)
                    && !Utils.hasSubstantialNarrativePayload(lower, 'user')
                )
            ) {
                return true;
            }
            return false;
        },

        getMemorySourceText: (text) => {
            const strippedThinking = Utils.stripLLMThinkingTags(text);
            const strippedManaged = Utils.stripManagedModuleTags(strippedThinking);
            const strippedTools = Utils.stripToolResponseBlocks(strippedManaged);
            return typeof strippedTools === 'string' ? strippedTools.trim() : String(strippedTools || '').trim();
        },

        hasLibraVisibleContent: (text) => {
            return Utils.getLibraComparableText(text).length > 0;
        },

        isRecoverableNarrativeCandidate: (text, roleHint = 'either') => {
            const raw = Utils.getMemorySourceText(text);
            if (!raw || raw.length < 3) return false;
            if (Utils.isMetaPromptLike(raw)) return false;
            if (Utils.isTagOnlyToolResponse(raw)) return false;

            const lower = raw.toLowerCase();
            const blockedMarkers = [
                '[lbdata start]',
                '[lbdata end]',
                '<past conversations>',
                '</past conversations>',
                '--- chat log end ---',
                '"messages": [',
                '"max_tokens":',
                '"logit_bias":',
                '## ai guidance:',
                '## character information',
                '<others info>',
                '<lore>',
                '</lore>',
            ];
            if (blockedMarkers.some(marker => lower.includes(marker))) return false;

            if (roleHint === 'user' && /^(?:assistant|character)\s*:/im.test(raw) && !/^user\s*:/im.test(raw)) {
                return false;
            }
            if (roleHint === 'ai' && /^user\s*:/im.test(raw) && !/^(?:assistant|character)\s*:/im.test(raw) && !/\[응답\]/.test(raw)) {
                return false;
            }
            return true;
        },

        scoreNarrativeCandidate: (text, roleHint = 'either') => {
            const raw = Utils.getMemorySourceText(text);
            if (!Utils.isRecoverableNarrativeCandidate(raw, roleHint)) return -Infinity;

            const lower = raw.toLowerCase();
            let score = 0;

            score += Math.min(8, Math.floor(raw.length / 180));
            if (/\n/.test(raw)) score += 2;
            if (/["“”]|'.+?'/.test(raw)) score += 2;
            if (/⏱️|\[사용자\]|\[응답\]|^user\s*:|^(assistant|character)\s*:/im.test(raw)) score += 3;
            if (/<current input>/i.test(raw)) score -= 2;
            if (/\bjson\b|logit_bias|max_tokens|stream\s*:\s*true/i.test(lower)) score -= 6;
            if (/##\s*ai guidance:|##\s*character information|<others info>|<lore>/i.test(raw)) score -= 6;
            if (roleHint === 'user' && /^user\s*:/im.test(raw)) score += 2;
            if (roleHint === 'ai' && /^(assistant|character)\s*:/im.test(raw)) score += 2;
            if (roleHint === 'ai' && /⏱️|chatindex|@hidden spoiler@|# response/i.test(raw)) score += 3;

            return score;
        },

        extractNarrativePayload: (text, roleHint = 'either') => {
            const raw = Utils.getMemorySourceText(text);
            if (!raw) return '';
            if (!Utils.isMetaPromptLike(raw) && !Utils.isTagOnlyToolResponse(raw)) {
                return raw;
            }

            const seen = new Set();
            const candidates = [];
            const pushCandidate = (value) => {
                const candidate = Utils.getMemorySourceText(value);
                if (!candidate) return;
                const normalized = candidate.trim();
                if (!normalized || seen.has(normalized)) return;
                seen.add(normalized);
                candidates.push(normalized);
            };

            const tagged = Utils.splitTaggedTurn(raw);
            if (roleHint !== 'ai') pushCandidate(tagged.user);
            if (roleHint !== 'user') pushCandidate(tagged.ai);

            const currentInputMatch = raw.match(/<Current Input>\s*```([\s\S]*?)```\s*<\/Current Input>/i);
            pushCandidate(currentInputMatch?.[1] || '');

            const userMatch = raw.match(/(?:^|\n)\s*USER:\s*"([\s\S]*?)"\s*(?=\n\s*(?:CHARACTER:|ASSISTANT:|SYSTEM:|$))/i);
            if (roleHint !== 'ai') pushCandidate(userMatch?.[1] || '');

            const assistantMatch = raw.match(/(?:^|\n)\s*(?:ASSISTANT|CHARACTER):\s*([\s\S]*?)\s*(?=\n\s*(?:USER:|SYSTEM:|$))/i);
            if (roleHint !== 'user') pushCandidate(assistantMatch?.[1] || '');

            const ranked = candidates
                .map(candidate => ({ candidate, score: Utils.scoreNarrativeCandidate(candidate, roleHint) }))
                .filter(item => Number.isFinite(item.score))
                .sort((a, b) => b.score - a.score);

            return ranked[0]?.candidate || '';
        },

        getNarrativeComparableText: (text, roleHint = 'either') => {
            return Utils.extractNarrativePayload(text, roleHint);
        },

        getNarrativeSourceText: (text, roleHint = 'either') => {
            return Utils.extractNarrativePayload(text, roleHint);
        },

        isTagOnlyToolResponse: (text) => {
            const raw = String(text || '').trim();
            if (!raw) return false;
            const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            if (!lines.length || lines.length > 6) return false;
            return lines.every(line => /^(?:\[[^\]\n]+\])+(?:[★■\s]+)?$/.test(line));
        },

        isMetaPromptLike: (text) => {
            const raw = String(text || '').trim();
            if (!raw) return false;
            const lower = raw.toLowerCase();
            const patterns = [
                '# system rule',
                'you are a data extraction bot',
                'your only job is to analyze',
                'analyze the following chat log',
                'provide the data string now',
                'final output format',
                'affection tag rules',
                'status tag rules',
                'rules start',
                'chat log start',
                'reiteration phase',
                '<|im_start|>system',
                '# advance_notice',
                '# system_role',
                'translate the <sample_text>',
                'output only the translated text',
                'preserve as is',
                'core_principles',
                'additional_instructions',
                'narrative register [mandatory]',
                'zero omission + zero translationese',
                'this prompt has been confirmed for use only in fully personalized, private sessions',
                '<system>',
                '</system>',
                '<thoughts>',
                '<thinking>',
                'output must strictly follow these rules',
                'output json:',
                'do not output any other text',
                'system: pov : freely',
                'respond in full english',
                'all the characters inside this rp are adults who are acting',
                'platform policies were disabled',
                'platform policy unactivated'
            ];
            if (patterns.some(p => lower.includes(p))) return true;
            return false;
        },

        hasNarrativeSceneLikeCues: (text, roleHint = 'either') => {
            const raw = String(Utils.getMemorySourceText(text) || '').trim();
            if (!raw) return false;
            const candidate = String(Utils.getNarrativeComparableText(text, roleHint) || raw).trim();
            if (!candidate) return false;
            let score = 0;
            if (/["“”‘’]|'.+?'/u.test(candidate)) score += 2;
            if (/\[사용자\]|\[응답\]|^user\s*:|^(?:assistant|character)\s*:/im.test(raw)) score += 2;
            if (/\n/.test(candidate)) score += 1;
            if (/(?:말하|속삭|중얼|웃|울|바라보|쳐다보|고개|손|표정|침묵|한숨|껴안|안아|키스|입맞춤|smile|looked?|said|whispered|hugged?|kissed?)/i.test(candidate)) score += 1;
            return score >= 2;
        },

        hasSubstantialNarrativePayload: (text, roleHint = 'either') => {
            const candidate = Utils.extractNarrativePayload(text, roleHint);
            if (!candidate) return false;
            const visible = String(candidate)
                .replace(/\[[^\]\n]{1,80}\]/g, ' ')
                .replace(/<[^>\n]{1,80}>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (visible.length < 12) return false;
            const meaningfulUnits = (visible.match(/[A-Za-z0-9\u3131-\u318E\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length;
            return meaningfulUnits >= 8;
        },

        isForcedBypassPrompt: (text) => {
            const raw = String(text || '').trim();
            if (!raw) return false;
            return /^provide the data string now\.?$/i.test(raw);
        },

        splitTaggedTurn: (text) => {
            const raw = String(text || '');
            const userMatch = raw.match(/\[사용자\]\s*([\s\S]*?)(?:\n\[응답\]|\r\n\[응답\]|$)/);
            const aiMatch = raw.match(/\[응답\]\s*([\s\S]*)$/);
            return {
                user: (userMatch?.[1] || '').trim(),
                ai: (aiMatch?.[1] || '').trim()
            };
        },

        shouldExcludeMemoryContent: (text, roleHint = 'either') => {
            const recovered = Utils.extractNarrativePayload(text, roleHint);
            if (recovered) return false;

            const raw = Utils.getLibraComparableText(text);
            if (!raw) return true;
            const tagged = Utils.splitTaggedTurn(raw);
            if (tagged.user || tagged.ai) {
                if (Utils.isMetaPromptLike(tagged.user) || Utils.isMetaPromptLike(tagged.ai)) return true;
                if (Utils.isTagOnlyToolResponse(tagged.ai)) return true;
            }
            if (Utils.isMetaPromptLike(raw)) return true;
            if (Utils.isTagOnlyToolResponse(raw)) return true;
            return false;
        },

        shouldExcludeStoredMemoryContent: (text) => {
            const raw = Utils.getMemorySourceText(text);
            if (!raw || raw.length < 5) return true;
            if (Utils.isMetaPromptLike(raw)) return true;
            if (Utils.isTagOnlyToolResponse(raw)) return true;

            const tagged = Utils.splitTaggedTurn(raw);
            if (tagged.user && Utils.isMetaPromptLike(tagged.user)) return true;
            if (tagged.ai && Utils.isTagOnlyToolResponse(tagged.ai)) return true;
            return false;
        },

        shouldBypassNarrativeSystems: (userText, aiText = '') => {
            const user = Utils.getNarrativeComparableText(userText, 'user');
            const ai = Utils.getNarrativeComparableText(aiText, 'ai');
            const rawUser = Utils.getMemorySourceText(userText);
            const hasNarrativePayload =
                Utils.hasSubstantialNarrativePayload(userText, 'user') ||
                Utils.hasSubstantialNarrativePayload(aiText, 'ai');
            if (!user && !ai && !hasNarrativePayload) return true;
            if (Utils.isForcedBypassPrompt(user) || Utils.isForcedBypassPrompt(rawUser)) return true;
            return false;
        },

        isNarrativeRequestType: (type) => {
            const normalized = String(type || '').trim().toLowerCase();
            return normalized === 'model';
        }
    };


    // ══════════════════════════════════════════════════════════════
    // [MEMORY] Compact Memory Codec — summary-only durable memory
    // - New lmai_memory entries no longer store full user/assistant prose.
    // - Legacy raw memories are dual-read and migrated to compact JSON.
    // - Search/recall uses summary, anchors, snippets, tags, entity refs, arcKey.
    // ══════════════════════════════════════════════════════════════
    const CompactMemoryCodec = (() => {
        const SCHEMA = 'libra.memory.compact_turn.v1';
        const VERSION = 1;
        const LEDGER_SCHEMA = 'libra.memory.turn_ledger.v2';
        const LEDGER_VERSION = 2;
        const MAX_SUMMARY_CHARS = 420;
        const MAX_ANCHORS = 3;
        const MAX_SNIPPETS = 5;
        const MAX_SNIPPET_CHARS = 180;
        const MAX_TAGS = 10;
        const MAX_RECALL_KEYWORDS = 24;
        const MAX_ENTITIES = 12;
        const LEDGER_SOURCE_RETENTION = 'hash_summary_and_structured_evidence_only';
        const LEDGER_RAW_RETENTION = 'summary_and_structured_evidence';
        const clip = (value = '', max = 240) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            const limit = Math.max(20, Number(max || 0));
            return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trim()}…` : text;
        };
        const stripMeta = (content = '') => {
            const raw = String(content || '');
            const start = raw.search(/\[META:/);
            if (start >= 0) {
                const crlf = raw.indexOf(']\r\n', start);
                const lf = raw.indexOf(']\n', start);
                const end = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf;
                if (end >= 0) return raw.slice(end + (end === crlf ? 3 : 2)).trim();
            }
            return raw.replace(/\[META:\{.*?\}\]\s*/s, '').trim();
        };
        const tryParseJson = (value) => {
            try {
                const parsed = JSON.parse(String(value || '').trim());
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
            } catch (_) { return null; }
        };
        const isLegacyCompactPayload = (value) => value && typeof value === 'object' && String(value.schema || '') === SCHEMA;
        const isLedgerPayload = (value) => value && typeof value === 'object' && String(value.schema || '') === LEDGER_SCHEMA;
        const isCompactPayload = (value) => isLegacyCompactPayload(value) || isLedgerPayload(value);
        const parsePayloadFromContent = (content = '') => {
            const body = stripMeta(content);
            const parsed = tryParseJson(body);
            return isCompactPayload(parsed) ? parsed : null;
        };
        const parsePayloadFromEntry = (entry = null) => parsePayloadFromContent(entry?.content || entry || '');
        const splitTagged = (content = '') => {
            const raw = Utils.getMemorySourceText(stripMeta(content));
            const tagged = Utils.splitTaggedTurn(raw);
            return {
                user: String(tagged.user || '').trim(),
                ai: String(tagged.ai || (!tagged.user && !tagged.ai ? raw : '')).trim()
            };
        };
        const splitSentences = (text = '') => String(text || '')
            .replace(/\r\n/g, '\n')
            .split(/(?<=[.!?。！？다요죠네음함임됨]|[\]\)])\s+|\n{2,}|\n(?=["“‘'가-힣A-Z0-9])/g)
            .map(item => item.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
        const getDynamicKnownEntityNames = (options = {}) => {
            const names = [];
            const push = (value) => {
                const text = String(value || '').trim();
                if (text) names.push(text);
            };
            const sourceLists = [
                options.entityRefs,
                options.knownEntityNames,
                options.mentionedEntityNames
            ];
            for (const list of sourceLists) {
                if (Array.isArray(list)) list.forEach(item => {
                    if (typeof item === 'string') push(item);
                    else if (item && typeof item === 'object') push(item.name || item.ref || item.id || item.label);
                });
            }
            try {
                if (typeof EntityManager !== 'undefined' && EntityManager?.getEntityCache) {
                    Array.from(EntityManager.getEntityCache().values()).forEach(entity => {
                        push(entity?.name);
                        if (Array.isArray(entity?.aliases)) entity.aliases.forEach(push);
                    });
                }
            } catch (_) {}
            return dedupeTextArray(names)
                .filter(name => name.length >= 1 && name.length <= 80)
                .sort((a, b) => b.length - a.length)
                .slice(0, 80);
        };
        const MEMORY_ENTITY_ALIAS_MAP = new Map([]);
        const COMPACT_MEMORY_ENTITY_REF_BLOCKED_EXACT = new Set([
            '사용자','응답','대화','장면','관계','메모리','원문','학교','교복','소녀','소년','사람','순간','목소리','스마트폰','연습생',
            '여성','남성','여자','남자','남자들','여자들','일행','무리','남성들','여성들',
            '세계관','내러티브','스토리','사건','감정','공간','시간','후처리','요약','기억','데이터','후보','분석','현재','최근','장기','정보',
            '그녀','그는','그때','그저','이제','아무','정말','하지만','그리고','그러나','자신','서로','누군가','어딘가','무언가','우리',
            '오빠','언니','누나','형','엄마','아빠','아까','데뷔하기','담당하','너더러','되는','연예인',
            '때문','때문이','같은','자랑','말고','핸드북','핸드북에','몰골','몰골이었','데려가서','옆','옆에','지방',
            '국어','역사','체육','수학','보건','문학','영어','과학','사회','음악','미술','안무','상담','보건실','상담실','유치원','커플',
            '감독','원장','사감','사장','로드','교생','교생인',
            '지나가던','완벽한','다른','도는','먹다','읽는','진행하','생들이나','했다','있었다','없었다','않았다','시작했다','지키기','물었다','어머','될지','되었다',
            '구조','구조와','평가','총평','총괄','심리','핵심','현실감','공감','포인트','테마','서사','흐름','이야기','전체','장대한','드라마틱','순환','결핍','치유','성장','용서','자아','존중'
        ]);
        const normalizeMemoryEntityAliasKey = (value = '') => String(value || '')
            .trim()
            .toLowerCase()
            .replace(/['’]s$/i, '')
            .replace(/[^a-z0-9가-힣]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const stripMemoryEntityParticle = (value = '') => {
            const raw = String(value || '').trim();
            if (!/^[가-힣]{2,8}$/.test(raw)) return raw;
            const suffixes = [
                '에게서는', '에게서', '으로는', '이라도', '에게는', '에게', '한테는', '한테', '에서는', '에는', '에서', '부터', '까지', '처럼',
                '께서는', '께서', '으로', '하고', '이다', '이며', '이랑', '랑', '은', '는', '이',
                '에',
                '가', '을', '를', '의', '도', '로', '만'
            ];
            for (const suffix of suffixes) {
                if (raw.length - suffix.length >= 2 && raw.endsWith(suffix)) {
                    return raw.slice(0, -suffix.length);
                }
            }
            return raw;
        };
        const isBlockedCompactMemoryEntityRef = (value = '') => {
            const raw = String(value || '').trim();
            if (!raw) return true;
            const normalized = stripMemoryEntityParticle(raw)
                .toLowerCase()
                .replace(/[()[\]{}"'`]/g, '')
                .trim();
            if (!normalized) return true;
            if (COMPACT_MEMORY_ENTITY_REF_BLOCKED_EXACT.has(normalized)) return true;
            if (/^(그녀|그는|그때|그저|이제|아무|정말|하지만|그리고|그러나|자신|서로|누군가|어딘가|무언가)$/i.test(normalized)) return true;
            if (/^(?:선생님|교사|담임|교생|매니저|원장|사장|감독)(?:인)?$/i.test(normalized)) return true;
            return false;
        };
        const normalizeMemoryEntityRefCandidate = (value = '', knownNames = []) => {
            let candidate = String(value || '')
                .replace(/['’]s$/i, '')
                .replace(/^[^A-Za-z가-힣]+|[^A-Za-z가-힣]+$/g, '')
                .trim();
            if (!candidate) return '';
            const aliasDirect = MEMORY_ENTITY_ALIAS_MAP.get(normalizeMemoryEntityAliasKey(candidate));
            if (aliasDirect) candidate = aliasDirect;
            candidate = stripMemoryEntityParticle(candidate)
                .replace(/^[^A-Za-z가-힣]+|[^A-Za-z가-힣]+$/g, '')
                .trim();
            if (!candidate) return '';
            if (isBlockedCompactMemoryEntityRef(candidate)) return '';
            const exactKnown = knownNames.find(name => String(name || '').trim() === candidate);
            if (exactKnown && !isBlockedCompactMemoryEntityRef(exactKnown)) return exactKnown;
            const containingKnown = knownNames
                .map(name => String(name || '').trim())
                .filter(Boolean)
                .filter(name => candidate.includes(name));
            if (containingKnown.length > 0) {
                const best = containingKnown.sort((a, b) => b.length - a.length)[0];
                return isBlockedCompactMemoryEntityRef(best) ? '' : best;
            }
            const superKnown = knownNames
                .map(name => String(name || '').trim())
                .filter(Boolean)
                .filter(name => name.includes(candidate));
            if (superKnown.length > 0) {
                const best = superKnown.sort((a, b) => b.length - a.length)[0];
                return isBlockedCompactMemoryEntityRef(best) ? '' : best;
            }
            try {
                if (typeof EntityManager !== 'undefined' && EntityManager?.normalizeName) {
                    const normalized = EntityManager.normalizeName(candidate);
                    if (String(normalized || '').trim() && !isBlockedCompactMemoryEntityRef(normalized)) return String(normalized || '').trim();
                }
            } catch (_) {}
            if (isBlockedCompactMemoryEntityRef(candidate)) return '';
            return candidate;
        };
        const scoreSentence = (sentence = '', options = {}) => {
            const s = String(sentence || '');
            let score = 0;
            if (/["“”‘’']/.test(s)) score += 2;
            if (/(결정|고백|거절|갈등|약속|합류|떠남|문자|연락|사건|관계|감정|긴장|위기|선택|진심|정체|규칙|금지|이별|재회|동맹|배신|합의|오해|폭로|전환|불안)/.test(s)) score += 4;
            if (/(요청|안내|설명|도착|이동|발견|확인|대답|수락|거절|계획|목표|단서|비밀|문제|변화)/.test(s)) score += 3;
            if (/⏱️|★📍|^🚪|🚪\s*[^:\n]{1,24}:|^§\s*(?:[월화수목금토일]|Mon|Tue|Wed|Thu|Fri|Sat|Sun)|<img\b|<GT-|<\/GigaTrans>|LBDATA|Chatindex|#\s*(?:Response|응답)/i.test(s)) score -= 7;
            if (/^🚪/.test(s)) score -= 3;
            const knownNames = getDynamicKnownEntityNames(options);
            if (knownNames.some(name => name && s.includes(name))) score += 2;
            if (/[가-힣A-Za-z0-9]{2,}\s*(?:은|는|이|가|에게|와|과|의)\s/.test(s)) score += 1;
            if (s.length >= 40 && s.length <= 240) score += 2;
            return score;
        };
        const extractEntityRefs = (text = '', options = {}) => {
            const raw = String(text || '');
            const names = [];
            const known = getDynamicKnownEntityNames(options);
            const strictKnownOnly = Boolean(options?.strictKnownEntityNamesOnly || options?.retrospectiveClass);
            known.forEach(name => {
                if (!name || !raw.includes(name)) return;
                const normalized = normalizeMemoryEntityRefCandidate(name, known);
                if (normalized && !isBlockedCompactMemoryEntityRef(normalized)) names.push(normalized);
            });
            for (const [aliasKey, canonical] of MEMORY_ENTITY_ALIAS_MAP.entries()) {
                const escaped = aliasKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
                if (new RegExp(`\\b${escaped}(?:['’]s)?\\b`, 'i').test(raw) && !isBlockedCompactMemoryEntityRef(canonical)) names.push(canonical);
            }
            if (strictKnownOnly) return dedupeTextArray(names).slice(0, MAX_ENTITIES);
            const matches = raw.match(/[가-힣]{2,5}(?:\([A-Za-z][A-Za-z\s.'-]{1,40}\))?/g) || [];
            matches.forEach(item => {
                const v = String(item || '').trim();
                const normalized = normalizeMemoryEntityRefCandidate(v, known);
                if (!normalized || isBlockedCompactMemoryEntityRef(normalized)) return;
                if (known.length > 0 && !known.includes(normalized) && !known.some(name => normalized.includes(name) || name.includes(normalized))) return;
                names.push(normalized);
            });
            return dedupeTextArray(names).slice(0, MAX_ENTITIES);
        };
        const COMPACT_MEMORY_FAMILY_ROLE_RE = /가족|자녀|아들(?=$|[\s,.;!?'"”’)\]}]|은|는|이|가|을|를|에게|과|와|의)|딸(?=$|[\s,.;!?'"”’)\]}]|은|는|이|가|을|를|에게|과|와|의)|부부|모녀|부녀/u;
        const hasExplicitFamilyRoleMention = (text = '') => COMPACT_MEMORY_FAMILY_ROLE_RE.test(String(text || ''));
        const extractTags = (text = '') => {
            const raw = String(text || '');
            const tagRules = [
                ['사건', /사건|위험|위기|구조|도움|발견/],
                ['대화', /대화|말했|물었|답했|묻고|대답|질문/],
                ['약속', /약속|다짐|합의/],
                ['갈등', /갈등|대립|거절|긴장|오해|폭로/],
                ['진로', /진로|커리어|직업|학교|시험|취업|복귀/],
                ['세계 규칙', /세계관|규칙|마법|초자연|기술|시스템|레벨/],
                ['기억 단절', /기억(?:이)?\s*(?:안\s*나|나지|없|끊|상실)|기억\s*공백/],
                ['장소', /장소|위치|도착|이동|교실|복도|카페|병원|학교|집|방|공원|식당|역|정류장/],
                ['물건', /물건|소지품|도구|폰|휴대폰|서류|편지|가방/],
                ['관계', /관계|친구|연인|가족|동료|상대|파트너/]
            ];
            const tags = tagRules.filter(([, pattern]) => pattern.test(raw)).map(([tag]) => tag);
            if (hasExplicitFamilyRoleMention(raw)) tags.push('가족');
            return dedupeTextArray(tags).slice(0, MAX_TAGS);
        };
        const extractRecallKeywords = (text = '', tags = []) => {
            const raw = String(text || '');
            const keywordRules = [
                ['기억 단서', /기억(?:이)?\s*(?:안\s*나|나지|없|끊|상실)|기억\s*공백/],
                ['연락 단서', /연락|문자|전화|메시지|답장|읽지\s*않은/],
                ['물건 단서', /물건|소지품|도구|폰|휴대폰|서류|편지|가방/],
                ['장소 단서', /장소|위치|도착|이동/],
                ['관계 단서', /관계|친구|연인|가족|동료|상대|파트너/]
            ];
            const keywords = [
                ...(Array.isArray(tags) ? tags : []),
                ...keywordRules.filter(([, pattern]) => pattern.test(raw)).map(([keyword]) => keyword)
            ];
            return dedupeTextArray(keywords)
                .map(value => clip(value, 40))
                .filter(Boolean)
                .slice(0, MAX_RECALL_KEYWORDS);
        };
        const ledgerEntityBaseName = (value = '') => {
            const raw = String(value || '').trim();
            return raw.replace(/\([^)]*\)/g, '').trim() || raw;
        };
        const ledgerEntityMentionedInText = (entity = '', text = '') => {
            const raw = String(text || '');
            const full = String(entity || '').trim();
            const base = ledgerEntityBaseName(full);
            if (!raw || !full) return false;
            return raw.includes(full) || (base && raw.includes(base));
        };
        const ledgerRefObject = (kind = '', item = null, role = '') => {
            if (!item) return null;
            if (typeof item === 'string') {
                const label = item.trim();
                return label ? { kind: kind || 'entity', label, role: role || '' } : null;
            }
            const label = String(item.label || item.name || item.ref || item.id || '').trim();
            if (!label) return null;
            return {
                kind: kind || item.kind || (item.role === 'group' ? 'group' : 'mention'),
                ref: String(item.id || item.ref || '').trim(),
                label,
                role: role || item.subjectRole || item.role || ''
            };
        };
        const dedupeLedgerRefs = (refs = []) => {
            const seen = new Set();
            const out = [];
            for (const ref of Array.isArray(refs) ? refs : []) {
                if (!ref || typeof ref !== 'object') continue;
                const label = String(ref.label || ref.name || '').trim();
                if (!label) continue;
                const item = {
                    kind: String(ref.kind || '').trim() || 'mention',
                    ref: String(ref.ref || ref.id || '').trim(),
                    label,
                    role: String(ref.role || '').trim()
                };
                const key = `${item.kind}:${item.ref || item.label}:${item.role}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(item);
            }
            return out.slice(0, 8);
        };
        const resolveLedgerFactActors = (body = '', source = 'assistant', entityRefs = [], context = {}) => {
            const text = String(body || '');
            const entities = [];
            const subjects = [];
            const observerEntities = [];
            for (const entity of Array.isArray(entityRefs) ? entityRefs : []) {
                if (ledgerEntityMentionedInText(entity, text)) entities.push(entity);
            }
            if (source === 'assistant' && entityRefs.length > 0) {
                observerEntities.push(...entityRefs);
            }
            return {
                entities: dedupeTextArray(entities).slice(0, 8),
                subjects: dedupeLedgerRefs(subjects),
                observerEntities: dedupeTextArray(observerEntities).slice(0, 8)
            };
        };
        const LEDGER_DERIVED_TAG_BLOCKED_EXACT = new Set([
            'current', 'cause', 'trigger', 'escalation', 'result', 'write_path_adapter',
            '연애 금지', '삼각관계', '죄책감', '질투', '고백 압력', '비밀 접촉', '관계 파열',
            '재건', '관계 압력', '정서적 접근', '단둘이 식사', '떡볶이', '소속사 연애 금지',
            'family_concert_postscript', 'dating_ban_triangle_pressure', 'umbrella_confession_pressure',
            'post_rupture_apology', 'career_repair', 'childhood_triangle_setup', 'unresolved-pressure'
        ]);
        const LEDGER_DERIVED_ARC_BLOCKED_EXACT = new Set([
            'family_concert_postscript',
            'dating_ban_triangle_pressure',
            'umbrella_confession_pressure',
            'post_rupture_apology',
            'career_repair',
            'childhood_triangle_setup'
        ]);
        const LEDGER_DERIVED_RELATION_BLOCKED_RE = /정서적\s*접촉|관계\s*(?:압력|해석|파열)|공개적\s*접촉\s*제한/i;
        const LEDGER_DERIVED_CONFLICT_BLOCKED_RE = /외부\s*규칙\/연애\s*금지|소꿉친구\s*관계와\s*연인\s*관계|끌림과\s*죄책감|감춰둔\s*진심|관계\s*파열\s*이후/i;
        const KOREAN_SURNAME_SINGLE_GIVEN_RE = /^[김이박최정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구민류진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제][가-힣]$/u;
        const buildLedgerEvidenceText = (payload = {}) => {
            const facts = Array.isArray(payload?.facts) ? payload.facts : [];
            const snippets = Array.isArray(payload?.directEvidenceSnippets) ? payload.directEvidenceSnippets : [];
            const anchors = Array.isArray(payload?.recallAnchors) ? payload.recallAnchors : [];
            return [
                payload?.summary,
                payload?.primaryConflict,
                payload?.relationDelta,
                ...(Array.isArray(payload?.tags) ? payload.tags : []),
                ...(Array.isArray(payload?.recallKeywords) ? payload.recallKeywords : []),
                ...facts.flatMap(item => [
                    item?.text,
                    ...(Array.isArray(item?.subjects) ? item.subjects.flatMap(ref => [ref?.label, ref?.role]) : []),
                    ...(Array.isArray(item?.observerEntities) ? item.observerEntities : []),
                    ...(Array.isArray(item?.evidence) ? item.evidence.map(ev => ev?.text || ev) : [])
                ]),
                ...snippets.map(item => typeof item === 'string' ? item : item?.text),
                ...anchors.flatMap(item => [item?.summary, item?.hint]),
                payload?.scene?.summary,
                payload?.scene?.location
            ].map(v => String(v || '').trim()).filter(Boolean).join('\n');
        };
        const expandTruncatedKoreanName = (name = '', evidenceText = '', knownNames = []) => {
            const value = String(name || '').trim();
            if (!KOREAN_SURNAME_SINGLE_GIVEN_RE.test(value)) return value;
            const known = (Array.isArray(knownNames) ? knownNames : [])
                .map(item => String(item || '').trim())
                .filter(item => item.length > value.length && item.startsWith(value))
                .sort((a, b) => b.length - a.length)[0];
            if (known) return known;
            const evidenceHit = (String(evidenceText || '').match(/[가-힣]{3,5}/g) || [])
                .filter(item => item.length > value.length && item.startsWith(value) && !isBlockedCompactMemoryEntityRef(item))
                .sort((a, b) => b.length - a.length)[0];
            return evidenceHit || '';
        };
        const sanitizeLedgerEntityList = (values = [], evidenceText = '') => {
            const knownNames = getDynamicKnownEntityNames({});
            const out = [];
            for (const value of Array.isArray(values) ? values : []) {
                const raw = String(value || '').trim();
                if (!raw) continue;
                let normalized = normalizeMemoryEntityRefCandidate(raw, knownNames);
                if (!normalized || isBlockedCompactMemoryEntityRef(normalized)) continue;
                const expanded = expandTruncatedKoreanName(normalized, evidenceText, knownNames);
                if (!expanded) continue;
                normalized = expanded;
                if (isBlockedCompactMemoryEntityRef(normalized)) continue;
                out.push(normalized);
            }
            return dedupeTextArray(out).slice(0, MAX_ENTITIES);
        };
        const sanitizeLedgerTags = (tags = [], evidenceText = '', retrospectiveClass = '') => {
            const retro = normalizeRetrospectiveClass(retrospectiveClass);
            const out = [];
            for (const tag of Array.isArray(tags) ? tags : []) {
                const value = String(tag || '').trim();
                if (!value || LEDGER_DERIVED_TAG_BLOCKED_EXACT.has(value)) continue;
                if (/^(?:current|cause|trigger|escalation|result|write_path_adapter)$/i.test(value)) continue;
                if (value === '가족' && !hasExplicitFamilyRoleMention(evidenceText)) continue;
                if (value === '가족 후일담' && retro !== 'family_postscript') continue;
                if (value === '회고' && !retro) continue;
                out.push(value);
            }
            return dedupeTextArray(out).slice(0, MAX_TAGS);
        };
        const sanitizeLedgerRecallKeywords = (keywords = [], evidenceText = '') => {
            const seed = Array.isArray(keywords) ? keywords : [];
            const out = [];
            for (const keyword of seed) {
                const value = clip(keyword, 48);
                if (!value || LEDGER_DERIVED_TAG_BLOCKED_EXACT.has(value)) continue;
                out.push(value);
            }
            const derived = extractRecallKeywords(evidenceText, []);
            return dedupeTextArray([...out, ...derived]).slice(0, MAX_RECALL_KEYWORDS);
        };
        const sanitizeLedgerRefObjects = (refs = []) => dedupeLedgerRefs((Array.isArray(refs) ? refs : [])
            .map(ref => {
                if (!ref) return null;
                if (typeof ref === 'string') return ledgerRefObject('entity', ref, '');
                const label = clip(ref.label || ref.name || ref.ref || ref.id || '', 80);
                if (!label) return null;
                const kind = String(ref.kind || '').trim() || (/group/i.test(String(ref.role || '')) ? 'group' : 'mention');
                return {
                    kind,
                    ref: clip(ref.ref || ref.id || '', 100),
                    label,
                    role: clip(ref.role || '', 80)
                };
            })
            .filter(Boolean));
        const sanitizeLedgerArcKey = (arcKey = '', retrospectiveClass = '') => {
            const value = String(arcKey || '').trim();
            if (!value) return '';
            const lower = value.toLowerCase();
            if (lower === 'family_concert_postscript') {
                return normalizeRetrospectiveClass(retrospectiveClass) === 'family_postscript' ? 'family_postscript' : '';
            }
            if (LEDGER_DERIVED_ARC_BLOCKED_EXACT.has(lower)) return '';
            return value;
        };
        const sanitizeLedgerRelationText = (value = '', entityRefs = []) => {
            const text = clip(value || '', 240);
            if (!text) return '';
            if (LEDGER_DERIVED_RELATION_BLOCKED_RE.test(text)) return '';
            if ((Array.isArray(entityRefs) ? entityRefs : []).length < 2 && /관계|relationship|romance/i.test(text)) return '';
            return text;
        };
        const sanitizeLedgerConflictText = (value = '') => {
            const text = clip(value || '', 260);
            if (!text || LEDGER_DERIVED_CONFLICT_BLOCKED_RE.test(text)) return '';
            return text;
        };
        const normalizeRetrospectiveClass = (value = '') => {
            const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (normalized === 'global_recap' || normalized === 'family_postscript') return normalized;
            return '';
        };
        const detectRetrospectiveClass = (text = '', summary = '') => {
            return '';
        };
        const getRetrospectiveTags = (retrospectiveClass = '') => {
            const normalized = normalizeRetrospectiveClass(retrospectiveClass);
            if (normalized === 'family_postscript') return ['회고', '가족 후일담'];
            if (normalized === 'global_recap') return ['회고', '전체 정리'];
            return [];
        };
        const applyRetrospectiveTags = (tags = [], retrospectiveClass = '') => {
            const normalized = normalizeRetrospectiveClass(retrospectiveClass);
            if (!normalized) return dedupeTextArray(Array.isArray(tags) ? tags : []).slice(0, MAX_TAGS);
            return dedupeTextArray([...getRetrospectiveTags(normalized), ...(Array.isArray(tags) ? tags : [])]).slice(0, MAX_TAGS);
        };
        const buildRetrospectiveSummary = (summary = '', retrospectiveClass = '') => {
            const normalized = normalizeRetrospectiveClass(retrospectiveClass);
            if (!normalized) return clip(summary, MAX_SUMMARY_CHARS);
            const label = normalized === 'family_postscript'
                ? 'Retrospective family postscript:'
                : 'Retrospective overall recap:';
            const body = clip(String(summary || '').replace(/\s+/g, ' ').trim(), Math.max(24, MAX_SUMMARY_CHARS - label.length - 1));
            return clip(`${label} ${body}`.trim(), MAX_SUMMARY_CHARS);
        };
        const buildRetrospectiveAnchors = (summary = '', entityRefs = [], tags = [], retrospectiveClass = '') => {
            const normalized = normalizeRetrospectiveClass(retrospectiveClass);
            if (!normalized || !summary) return [];
            const label = normalized === 'family_postscript' ? 'family postscript recap' : 'overall recap';
            return [{
                summary: clip(summary, 180),
                hint: clip([label, ...getRetrospectiveTags(normalized), ...tags, ...entityRefs].filter(Boolean).join(' / '), 160),
                entityRefs: entityRefs.slice(0, 6),
                confidence: 0.48
            }];
        };
        const stripUserTurnSummaryText = (value = '') => {
            const raw = String(value || '').replace(/\s+/g, ' ').trim();
            if (!raw) return '';
            if (!/^User turn\s*:/i.test(raw)) return raw;
            const sceneMatch = raw.match(/\bScene result\s*:/i);
            if (sceneMatch && Number.isFinite(sceneMatch.index)) {
                return raw.slice(sceneMatch.index + sceneMatch[0].length).trim();
            }
            return '';
        };
        const isUserLedgerSource = (source = '', kind = '') => {
            const normalizedSource = String(source || '').trim().toLowerCase();
            const normalizedKind = String(kind || '').trim().toLowerCase();
            return normalizedSource === 'user' || normalizedKind === 'user_input';
        };
        const isContinuityOnlyRecallProfile = (payload = null) => {
            const retrospectiveClass = normalizeRetrospectiveClass(payload?.retrospectiveClass || payload?.hybridRow?.retrospectiveClass || payload?.hme?.retrospectiveClass || '');
            if (retrospectiveClass) return true;
            return String(payload?.recallProfile || payload?.hybridRow?.recallProfile || payload?.hme?.recallProfile || '').trim() === 'continuity_only';
        };
        const inferArcKey = (text = '') => {
            return '';
        };
        const inferArcRole = (text = '') => {
            return '';
        };
        const inferCausalRole = (text = '') => {
            return '';
        };
        const inferPrimaryConflict = (text = '', tags = []) => {
            return '';
        };
        const inferRelationDelta = (text = '', entityRefs = []) => {
            return '';
        };
        const buildSummary = (user = '', ai = '', options = {}) => {
            const sentences = splitSentences(ai);
            const narrativeRanked = sentences
                .filter(sentence => !isLedgerStatusOrControlText(sentence))
                .map(sentence => ({ sentence, score: scoreSentence(sentence, options) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 2)
                .map(item => clip(item.sentence, 180));
            const ranked = narrativeRanked.length ? narrativeRanked : sentences
                .map(sentence => ({ sentence, score: scoreSentence(sentence, options) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 2)
                .map(item => clip(item.sentence, 180));
            const parts = [];
            if (ranked.length) parts.push(`Scene result: ${ranked.join(' / ')}`);
            if (!parts.length) parts.push(clip(ai || '', MAX_SUMMARY_CHARS));
            return clip(parts.join(' '), MAX_SUMMARY_CHARS);
        };
        const buildSnippets = (user = '', ai = '', options = {}) => {
            const assistantItems = splitSentences(ai).map(sentence => ({
                sentence,
                source: isLedgerStatusOrControlText(sentence) ? 'status_block' : 'assistant',
                score: scoreSentence(sentence, options)
            }));
            const rest = [...assistantItems]
                .filter(item => item.sentence && item.sentence.length >= 12)
                .sort((a, b) => b.score - a.score)
                .slice(0, MAX_SNIPPETS);
            return rest
                .slice(0, MAX_SNIPPETS)
                .map(item => ({ source: item.source, text: clip(item.sentence, MAX_SNIPPET_CHARS) }));
        };
        const buildAnchors = (summary = '', snippets = [], entityRefs = [], tags = [], recallKeywords = []) => {
            const hintParts = dedupeTextArray([...(Array.isArray(tags) ? tags : []), ...(Array.isArray(recallKeywords) ? recallKeywords : []), ...entityRefs]);
            const anchors = [];
            if (summary) anchors.push({ summary: clip(summary, 180), hint: clip(hintParts.join(' / '), 180), entityRefs: entityRefs.slice(0, 6), confidence: 0.72 });
            for (const snip of snippets.slice(0, 1)) {
                anchors.push({ summary: clip(snip.text, 170), hint: clip([...hintParts.slice(0, 8), snip.source].join(' / '), 170), entityRefs: entityRefs.slice(0, 6), confidence: 0.66 });
            }
            return anchors.slice(0, MAX_ANCHORS);
        };
        const makeLedgerId = (prefix = 'item', seed = '', turn = 0, index = 0) => {
            const safeTurn = normalizeLegacyMemoryTurnAnchor(turn) || 'pending';
            const hash = String(TokenizerEngine.simpleHash(String(seed || `${prefix}:${safeTurn}:${index}`))).replace(/^-/, 'n').slice(0, 10);
            return `${prefix}.${safeTurn}.${index + 1}.${hash}`;
        };
        const isLedgerStatusOrControlText = (text = '') => {
            const raw = String(text || '').trim();
            if (!raw) return false;
            return /^★📍/.test(raw)
                || /^🚪/.test(raw)
                || /🚪\s*[^:\n]{1,24}:/.test(raw)
                || /^§\s*(?:[월화수목금토일]|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(raw)
                || /^<img\b/i.test(raw)
                || /^<GT-|^<\/GigaTrans>|^\[LBDATA\b|^<lb-/i.test(raw)
                || /^#{1,4}\s*(?:Response|응답|Volume|볼륨|Chapter|챕터|Chatindex)/i.test(raw);
        };
        const normalizeLedgerEvidenceSource = (source = 'assistant', text = '') => {
            const raw = String(text || '').trim();
            if (/^★📍|^🚪/.test(raw)) return 'status_block';
            return String(source || 'assistant').trim() || 'assistant';
        };
        const classifyLedgerEvidenceKind = (source = 'assistant', text = '') => {
            const normalizedSource = normalizeLedgerEvidenceSource(source, text);
            if (normalizedSource === 'user') return 'user_input';
            if (normalizedSource === 'status_block') return 'status_block';
            return 'direct_quote';
        };
        const ledgerEvidenceTokens = (text = '') => (String(text || '').match(/[A-Za-z0-9가-힣]{2,}/g) || [])
            .map(token => token.toLowerCase())
            .filter(token => !/^(the|and|for|with|that|this|저기|그녀|그는|그리고|하지만|있다|했다)$/.test(token))
            .slice(0, 24);
        const buildLedgerEvidenceRecords = (user = '', snippets = [], turn = 0) => {
            const records = [];
            const seen = new Set();
            const add = (source = 'assistant', textValue = '', supports = []) => {
                const text = clip(stripUserTurnSummaryText(textValue), MAX_SNIPPET_CHARS);
                if (!text) return;
                const normalizedSource = normalizeLedgerEvidenceSource(source, text);
                if (isUserLedgerSource(normalizedSource, classifyLedgerEvidenceKind(source, text))) return;
                const key = `${normalizedSource}:${text}`;
                if (seen.has(key)) return;
                seen.add(key);
                records.push({
                    id: makeLedgerId('ev', key, turn || 0, records.length),
                    source: normalizedSource,
                    kind: classifyLedgerEvidenceKind(source, text),
                    text,
                    turn: normalizeLegacyMemoryTurnAnchor(turn || 0) || undefined,
                    quoteHash: String(TokenizerEngine.simpleHash(text)),
                    supports: dedupeTextArray(Array.isArray(supports) ? supports : []).slice(0, 8)
                });
            };
            for (const snip of Array.isArray(snippets) ? snippets : []) {
                add(snip?.source || 'assistant', snip?.text || '', ['facts.scene_result', 'beats']);
            }
            return records.slice(0, MAX_SNIPPETS + 2);
        };
        const evidenceIdsForLedgerText = (text = '', evidenceRecords = [], fallbackCount = 1) => {
            const raw = String(text || '').toLowerCase();
            if (!raw) return [];
            const tokens = new Set(ledgerEvidenceTokens(raw));
            const scored = (Array.isArray(evidenceRecords) ? evidenceRecords : [])
                .map(ev => {
                    const evText = String(ev?.text || '').toLowerCase();
                    if (!ev?.id || !evText) return null;
                    let score = 0;
                    if (raw.includes(evText.slice(0, Math.min(48, evText.length))) || evText.includes(raw.slice(0, Math.min(48, raw.length)))) score += 5;
                    const evTokens = ledgerEvidenceTokens(evText);
                    const overlap = evTokens.filter(token => tokens.has(token)).length;
                    score += overlap;
                    return score > 0 ? { id: ev.id, score } : null;
                })
                .filter(Boolean)
                .sort((a, b) => b.score - a.score);
            const ids = scored.slice(0, 3).map(item => item.id);
            if (!ids.length && fallbackCount > 0) {
                return (Array.isArray(evidenceRecords) ? evidenceRecords : []).slice(0, fallbackCount).map(ev => ev?.id).filter(Boolean);
            }
            return dedupeTextArray(ids).slice(0, 3);
        };
        const attachEvidenceIdsToLedgerFacts = (facts = [], evidenceRecords = []) => (Array.isArray(facts) ? facts : [])
            .map(fact => ({
                ...fact,
                evidenceIds: evidenceIdsForLedgerText([
                    fact?.text,
                    ...(Array.isArray(fact?.evidence) ? fact.evidence.map(ev => ev?.text || ev) : [])
                ].filter(Boolean).join('\n'), evidenceRecords, 1)
            }));
        const findLedgerSentence = (text = '', pattern = /$^/) => {
            const sentences = splitSentences(text);
            return sentences.find(sentence => pattern.test(sentence)) || '';
        };
        const buildLedgerBeats = ({ user = '', ai = '', entityRefs = [], evidenceRecords = [], openThreads = [], relationSignals = [], turn = 0 } = {}) => {
            const raw = [user, ai].filter(Boolean).join('\n');
            const beats = [];
            const add = (type = 'event', summary = '', seedText = '', confidence = 0.68, entities = entityRefs) => {
                const body = clip(summary, 240);
                if (!body || beats.some(item => item.type === type && item.summary === body)) return;
                beats.push({
                    id: makeLedgerId('beat', `${type}:${body}`, turn || 0, beats.length),
                    type,
                    summary: body,
                    entities: (Array.isArray(entities) ? entities : []).slice(0, 6),
                    evidenceIds: evidenceIdsForLedgerText(seedText || body, evidenceRecords, 1),
                    confidence: Math.max(0.1, Math.min(0.98, Number(confidence || 0.68)))
                });
            };
            for (const thread of Array.isArray(openThreads) ? openThreads : []) {
                add('open_thread', thread?.text || thread?.label || '', [thread?.text, ...(Array.isArray(thread?.resolutionCriteria) ? thread.resolutionCriteria : [])].filter(Boolean).join('\n'), thread?.confidence || 0.6, thread?.entities || entityRefs);
            }
            for (const signal of Array.isArray(relationSignals) ? relationSignals : []) {
                add('relation_delta', signal?.text || '', signal?.text || '', signal?.confidence || 0.52, signal?.entities || entityRefs);
            }
            return beats.slice(0, 10);
        };
        const buildLedgerEntityStates = ({ text = '', entityRefs = [], evidenceRecords = [] } = {}) => {
            const raw = String(text || '');
            const states = {};
            const addState = (entity = '', bucket = 'visibleState', value = '', seed = '') => {
                const name = String(entity || '').trim();
                const body = clip(value, 120);
                if (!name || !body) return;
                const current = states[name] || { visibleState: [], inferredState: [], evidenceIds: [] };
                current[bucket] = dedupeTextArray([...(current[bucket] || []), body]).slice(0, 8);
                current.evidenceIds = dedupeTextArray([...(current.evidenceIds || []), ...evidenceIdsForLedgerText(seed || body, evidenceRecords, 1)]).slice(0, 8);
                states[name] = current;
            };
            for (const entity of Array.isArray(entityRefs) ? entityRefs : []) {
                const base = ledgerEntityBaseName(entity);
                if (base && raw.includes(base)) addState(entity, 'visibleState', '현재 장면에 직접 관여하거나 언급된다.', base);
            }
            return states;
        };
        const buildLedgerSceneCore = ({ scene = {}, text = '', evidenceRecords = [] } = {}) => {
            const locationStatus = scene?.location ? 'explicit' : '';
            return {
                time: clip(scene?.time || '', 80),
                location: clip(scene?.location || '', 120),
                locationStatus,
                scenePhase: '',
                activeProblem: '',
                nextPhysicalAction: '',
                evidenceIds: evidenceIdsForLedgerText([scene?.time, scene?.location, scene?.summary].filter(Boolean).join('\n'), evidenceRecords, 1)
            };
        };
        const buildLedgerSummaryV2 = ({ user = '', summary = '', sceneCore = {}, beats = [], openThreads = [], tags = [], recallKeywords = [], entityRefs = [] } = {}) => {
            const beatSummaries = (Array.isArray(beats) ? beats : [])
                .filter(beat => !['user_action'].includes(beat?.type))
                .map(beat => beat?.summary)
                .filter(Boolean);
            const threadTexts = (Array.isArray(openThreads) ? openThreads : []).map(thread => thread?.text || thread?.label).filter(Boolean);
            const oneLine = clip(summary || beatSummaries[0] || '', MAX_SUMMARY_CHARS);
            const continuity = clip([
                sceneCore?.location ? `장소: ${sceneCore.location}${sceneCore.locationStatus ? ` (${sceneCore.locationStatus})` : ''}` : '',
                sceneCore?.activeProblem ? `단서: ${sceneCore.activeProblem}` : '',
                sceneCore?.nextPhysicalAction ? `다음 행동: ${sceneCore.nextPhysicalAction}` : '',
                ...beatSummaries.slice(0, 4),
                ...threadTexts.slice(0, 3)
            ].filter(Boolean).join(' / '), 560);
            const recall = clip(dedupeTextArray([
                ...(Array.isArray(recallKeywords) ? recallKeywords : []),
                ...(Array.isArray(tags) ? tags : []),
                ...(Array.isArray(entityRefs) ? entityRefs : []),
                ...(Array.isArray(openThreads) ? openThreads.flatMap(thread => [thread?.label, thread?.text, ...(Array.isArray(thread?.resolutionCriteria) ? thread.resolutionCriteria : [])]) : [])
            ].filter(Boolean)).join(' / '), 420);
            return { oneLine, continuity, recall };
        };
        const extractLedgerScene = (text = '') => {
            const raw = String(text || '');
            const time = (
                raw.match(/\[(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s*\([^)]+\))?\s+\d{1,2}:\d{2}\s*(?:AM|PM|오전|오후)?)\]/i)?.[1]
                || raw.match(/⏱️?\s*\[([^\]]{6,80})\]/)?.[1]
                || ''
            );
            const location = (
                raw.match(/★📍\s*([^§\n]{2,60})\s*§/)?.[1]
                || raw.match(/(?:위치는|장소는|장소:|위치:)\s*["“]?([^"”\n.。!?]{2,60})/)?.[1]
                || ''
            );
            return {
                time: clip(time, 80),
                location: clip(location, 120),
                summary: clip([time, location].filter(Boolean).join(' | '), 180)
            };
        };
        const extractUnresolvedMentions = () => [];
        const extractLedgerGroups = () => [];
        const buildLedgerFacts = (user = '', ai = '', summary = '', snippets = [], entityRefs = [], options = {}) => {
            const turn = normalizeLegacyMemoryTurnAnchor(options.turn || options.t || 0) || 0;
            const importance = Math.max(1, Math.min(10, Number(options.importance || 5) || 5));
            const facts = [];
            const pushFact = (type = 'event', textValue = '', source = 'assistant', confidence = 0.78) => {
                const body = clip(textValue, 360);
                if (!body || facts.some(item => item.text === body)) return;
                const actors = resolveLedgerFactActors(body, source, entityRefs, {
                    unresolvedMentions: options.unresolvedMentions,
                    groups: options.groups
                });
                facts.push({
                    id: makeLedgerId('fact', `${type}:${source}:${body}`, turn, facts.length),
                    type,
                    text: body,
                    entities: actors.entities,
                    subjects: actors.subjects,
                    observerEntities: actors.observerEntities,
                    evidence: [{ source, text: clip(textValue, 220) }],
                    confidence: Math.max(0.1, Math.min(0.98, Number(confidence || 0.78))),
                    importance: Number((importance / 10).toFixed(2))
                });
            };
            for (const snip of Array.isArray(snippets) ? snippets : []) {
                if (isUserLedgerSource(snip?.source, snip?.kind)) continue;
                pushFact('scene_result', stripUserTurnSummaryText(snip?.text || ''), snip?.source || 'assistant', 0.82);
                if (facts.length >= 5) break;
            }
            if (!facts.length && summary) pushFact('summary', summary, 'derived', 0.66);
            return facts.slice(0, 6);
        };
        const buildLedgerOpenThreads = (text = '', entityRefs = [], unresolvedMentions = [], groups = [], turn = 0, primaryConflict = '') => {
            const openThreads = [];
            const refs = [];
            refs.push(...(Array.isArray(entityRefs) ? entityRefs : []).map(entity => ledgerRefObject('entity', entity, 'observer')));
            const subjectRefs = dedupeLedgerRefs(refs);
            const addThread = (textValue = '', criteria = [], confidence = 0.58, status = 'open', extra = {}) => {
                const body = clip(textValue, 280);
                if (!body || openThreads.some(item => item.text === body)) return;
                openThreads.push({
                    id: makeLedgerId('thread', body, turn || 0, openThreads.length),
                    label: clip(extra.label || body, 120),
                    text: body,
                    entities: (Array.isArray(entityRefs) ? entityRefs : []).slice(0, 6),
                    subjectRefs,
                    resolutionCriteria: dedupeTextArray(criteria).slice(0, 8),
                    status,
                    firstTurn: normalizeLegacyMemoryTurnAnchor(turn || 0) || undefined,
                    lastSeenTurn: normalizeLegacyMemoryTurnAnchor(turn || 0) || undefined,
                    confidence
                });
            };
            if (primaryConflict) addThread(primaryConflict, ['갈등 해소 확인'], 0.58);
            return openThreads.slice(0, 6);
        };
        const sanitizeLedgerPayload = (payload = {}, meta = {}) => {
            if (!isLedgerPayload(payload)) return { payload, changed: false };
            let changed = false;
            const next = { ...payload, schema: LEDGER_SCHEMA, version: LEDGER_VERSION };
            if (next.userRequestMetadata !== undefined) {
                delete next.userRequestMetadata;
                changed = true;
            }
            if (next.source && typeof next.source === 'object' && !Array.isArray(next.source) && next.source.userRequestMetadata !== undefined) {
                next.source = { ...next.source };
                delete next.source.userRequestMetadata;
                changed = true;
            }
            if (typeof next.summary === 'string') {
                const cleanSummary = stripUserTurnSummaryText(next.summary);
                if (cleanSummary !== next.summary) changed = true;
                next.summary = cleanSummary;
            }
            const evidenceText = buildLedgerEvidenceText(next);
            const participants = next.participants && typeof next.participants === 'object' && !Array.isArray(next.participants)
                ? { ...next.participants }
                : {};
            const beforeParticipants = JSON.stringify(next.participants || {});
            const rawEntities = [
                ...(Array.isArray(participants.canonicalEntities) ? participants.canonicalEntities : []),
                ...(Array.isArray(next.mentionedEntityNames) ? next.mentionedEntityNames : []),
                ...(Array.isArray(next.entityRefs) ? next.entityRefs : [])
            ];
            const canonicalEntities = sanitizeLedgerEntityList(rawEntities, evidenceText);
            participants.canonicalEntities = canonicalEntities;
            participants.unresolvedMentions = Array.isArray(participants.unresolvedMentions)
                ? participants.unresolvedMentions.filter(item => item && item.promoteToEntity !== true).slice(0, 8)
                : [];
            participants.groups = Array.isArray(participants.groups) ? participants.groups.slice(0, 6) : [];
            if (JSON.stringify(participants) !== beforeParticipants) changed = true;
            next.participants = participants;

            const cleanTags = sanitizeLedgerTags(next.tags || [], evidenceText, next.retrospectiveClass);
            if (JSON.stringify(cleanTags) !== JSON.stringify(Array.isArray(next.tags) ? next.tags : [])) changed = true;
            next.tags = cleanTags;
            const cleanRecallKeywords = sanitizeLedgerRecallKeywords(next.recallKeywords || [], evidenceText);
            if (JSON.stringify(cleanRecallKeywords) !== JSON.stringify(Array.isArray(next.recallKeywords) ? next.recallKeywords : [])) changed = true;
            next.recallKeywords = cleanRecallKeywords;

            const cleanArcKey = sanitizeLedgerArcKey(next.arcKey, next.retrospectiveClass);
            if (cleanArcKey !== String(next.arcKey || '').trim()) changed = true;
            next.arcKey = cleanArcKey;

            const cleanConflict = sanitizeLedgerConflictText(next.primaryConflict);
            if (cleanConflict !== String(next.primaryConflict || '').trim()) changed = true;
            next.primaryConflict = cleanConflict;

            const cleanRelationDelta = sanitizeLedgerRelationText(next.relationDelta, canonicalEntities);
            if (cleanRelationDelta !== String(next.relationDelta || '').trim()) changed = true;
            next.relationDelta = cleanRelationDelta;

            if (Array.isArray(next.facts)) {
                const cleanFacts = next.facts.map(fact => {
                    if (!fact || typeof fact !== 'object') return null;
                    if (/^(?:user_turn|user_evidence)$/i.test(String(fact.type || '').trim())) return null;
                    const factEntities = sanitizeLedgerEntityList(fact.entities || [], [evidenceText, fact.text].filter(Boolean).join('\n'));
                    const cleanEvidence = Array.isArray(fact.evidence)
                        ? fact.evidence
                            .filter(ev => !isUserLedgerSource(ev?.source, ev?.kind))
                            .map(ev => ({ ...ev, text: clip(stripUserTurnSummaryText(ev?.text || ''), 220) }))
                            .filter(ev => ev.text)
                            .slice(0, 3)
                        : [];
                    return {
                        ...fact,
                        entities: factEntities,
                        subjects: sanitizeLedgerRefObjects(fact.subjects || []),
                        observerEntities: sanitizeLedgerEntityList(fact.observerEntities || [], [evidenceText, fact.text].filter(Boolean).join('\n')),
                        evidence: cleanEvidence,
                        evidenceIds: dedupeTextArray(Array.isArray(fact.evidenceIds) ? fact.evidenceIds.map(value => clip(value, 80)).filter(Boolean) : [])
                    };
                }).filter(Boolean).slice(0, 6);
                if (JSON.stringify(cleanFacts) !== JSON.stringify(next.facts)) changed = true;
                next.facts = cleanFacts;
            }

            const continuity = next.continuity && typeof next.continuity === 'object' && !Array.isArray(next.continuity)
                ? { ...next.continuity }
                : { openThreads: [], relationSignals: [], worldChanges: [] };
            const cleanOpenThreads = (Array.isArray(continuity.openThreads) ? continuity.openThreads : [])
                .map(item => item && typeof item === 'object' ? {
                    ...item,
                    label: clip(item.label || item.text || '', 120),
                    text: sanitizeLedgerConflictText(item.text),
                    entities: sanitizeLedgerEntityList(item.entities || [], evidenceText),
                    subjectRefs: sanitizeLedgerRefObjects(item.subjectRefs || []),
                    resolutionCriteria: dedupeTextArray(Array.isArray(item.resolutionCriteria) ? item.resolutionCriteria.map(value => clip(value, 80)).filter(Boolean) : []),
                    evidenceIds: dedupeTextArray(Array.isArray(item.evidenceIds) ? item.evidenceIds.map(value => clip(value, 80)).filter(Boolean) : []),
                    status: clip(item.status || 'open', 40),
                    firstTurn: normalizeLegacyMemoryTurnAnchor(item.firstTurn || item.turn || meta.turn || meta.t || 0) || item.firstTurn,
                    lastSeenTurn: normalizeLegacyMemoryTurnAnchor(item.lastSeenTurn || item.turn || meta.turn || meta.t || 0) || item.lastSeenTurn
                } : null)
                .filter(item => item?.text)
                .slice(0, 8);
            const cleanRelationSignals = (Array.isArray(continuity.relationSignals) ? continuity.relationSignals : [])
                .map(item => item && typeof item === 'object' ? { ...item, text: sanitizeLedgerRelationText(item.text, canonicalEntities), entities: sanitizeLedgerEntityList(item.entities || canonicalEntities, evidenceText) } : null)
                .filter(item => item?.text)
                .slice(0, 8);
            const cleanWorldChanges = (Array.isArray(continuity.worldChanges) ? continuity.worldChanges : [])
                .map(item => item && typeof item === 'object'
                    ? { ...item, tags: sanitizeLedgerTags(item.tags || [], evidenceText, next.retrospectiveClass) }
                    : null)
                .filter(Boolean)
                .slice(0, 8);
            if (JSON.stringify(cleanOpenThreads) !== JSON.stringify(continuity.openThreads || [])
                || JSON.stringify(cleanRelationSignals) !== JSON.stringify(continuity.relationSignals || [])
                || JSON.stringify(cleanWorldChanges) !== JSON.stringify(continuity.worldChanges || [])) changed = true;
            next.continuity = {
                openThreads: cleanOpenThreads,
                relationSignals: cleanRelationSignals,
                worldChanges: cleanWorldChanges
            };

            if (Array.isArray(next.evidence)) {
                const cleanEvidence = next.evidence
                    .map(item => item && typeof item === 'object' ? {
                        id: clip(item.id || '', 80),
                        source: clip(item.source || 'assistant', 40),
                        kind: clip(item.kind || 'direct_quote', 40),
                        text: clip(stripUserTurnSummaryText(item.text || ''), MAX_SNIPPET_CHARS),
                        turn: normalizeLegacyMemoryTurnAnchor(item.turn || meta.turn || meta.t || 0) || item.turn,
                        quoteHash: clip(item.quoteHash || '', 80),
                        supports: dedupeTextArray(Array.isArray(item.supports) ? item.supports.map(value => clip(value, 80)).filter(Boolean) : [])
                    } : null)
                    .filter(item => item?.id && item?.text && !isUserLedgerSource(item.source, item.kind))
                    .slice(0, MAX_SNIPPETS + 2);
                if (JSON.stringify(cleanEvidence) !== JSON.stringify(next.evidence)) changed = true;
                next.evidence = cleanEvidence;
            }
            if (Array.isArray(next.beats)) {
                const cleanBeats = next.beats
                    .map(item => item && typeof item === 'object' ? {
                        id: clip(item.id || '', 80),
                        type: clip(item.type || 'event', 40),
                        summary: clip(item.summary || '', 240),
                        entities: sanitizeLedgerEntityList(item.entities || [], evidenceText),
                        evidenceIds: dedupeTextArray(Array.isArray(item.evidenceIds) ? item.evidenceIds.map(value => clip(value, 80)).filter(Boolean) : []),
                        confidence: Math.max(0.1, Math.min(0.98, Number(item.confidence || 0.68)))
                    } : null)
                    .filter(item => item?.summary && item.type !== 'user_action')
                    .slice(0, 10);
                if (JSON.stringify(cleanBeats) !== JSON.stringify(next.beats)) changed = true;
                next.beats = cleanBeats;
            }
            if (Array.isArray(next.directEvidenceSnippets)) {
                const cleanSnippets = next.directEvidenceSnippets
                    .map(item => typeof item === 'string' ? { source: 'assistant', text: item } : item)
                    .filter(item => item && typeof item === 'object' && !isUserLedgerSource(item.source, item.kind))
                    .map(item => ({ ...item, text: clip(stripUserTurnSummaryText(item.text || ''), MAX_SNIPPET_CHARS) }))
                    .filter(item => item.text)
                    .slice(0, MAX_SNIPPETS);
                if (JSON.stringify(cleanSnippets) !== JSON.stringify(next.directEvidenceSnippets)) changed = true;
                next.directEvidenceSnippets = cleanSnippets;
            }
            if (Array.isArray(next.recallAnchors)) {
                const cleanAnchors = next.recallAnchors
                    .map(item => item && typeof item === 'object' ? {
                        ...item,
                        summary: clip(stripUserTurnSummaryText(item.summary || ''), 180),
                        hint: clip(item.hint || '', 180)
                    } : null)
                    .filter(item => item && (item.summary || item.hint))
                    .slice(0, MAX_ANCHORS);
                if (JSON.stringify(cleanAnchors) !== JSON.stringify(next.recallAnchors)) changed = true;
                next.recallAnchors = cleanAnchors;
            }
            if (next.summaryV2 && typeof next.summaryV2 === 'object' && !Array.isArray(next.summaryV2)) {
                const cleanSummaryV2 = {
                    oneLine: clip(stripUserTurnSummaryText(next.summaryV2.oneLine || next.summary || ''), MAX_SUMMARY_CHARS),
                    continuity: clip(stripUserTurnSummaryText(next.summaryV2.continuity || ''), 560),
                    recall: clip(stripUserTurnSummaryText(next.summaryV2.recall || ''), 420)
                };
                if (JSON.stringify(cleanSummaryV2) !== JSON.stringify(next.summaryV2)) changed = true;
                next.summaryV2 = cleanSummaryV2;
            }
            if (next.sceneCore && typeof next.sceneCore === 'object' && !Array.isArray(next.sceneCore)) {
                const cleanSceneCore = {
                    time: clip(next.sceneCore.time || '', 80),
                    location: clip(next.sceneCore.location || '', 120),
                    locationStatus: clip(next.sceneCore.locationStatus || '', 40),
                    scenePhase: clip(next.sceneCore.scenePhase || '', 40),
                    activeProblem: clip(next.sceneCore.activeProblem || '', 220),
                    nextPhysicalAction: clip(next.sceneCore.nextPhysicalAction || '', 180),
                    evidenceIds: dedupeTextArray(Array.isArray(next.sceneCore.evidenceIds) ? next.sceneCore.evidenceIds.map(value => clip(value, 80)).filter(Boolean) : [])
                };
                if (JSON.stringify(cleanSceneCore) !== JSON.stringify(next.sceneCore)) changed = true;
                next.sceneCore = cleanSceneCore;
            }
            if (next.entityStates && typeof next.entityStates === 'object' && !Array.isArray(next.entityStates)) {
                const cleanEntityStates = {};
                for (const [name, state] of Object.entries(next.entityStates)) {
                    const entityName = sanitizeLedgerEntityList([name], evidenceText)[0] || clip(name, 80);
                    if (!entityName || !state || typeof state !== 'object') continue;
                    cleanEntityStates[entityName] = {
                        visibleState: dedupeTextArray(Array.isArray(state.visibleState) ? state.visibleState.map(value => clip(value, 120)).filter(Boolean) : []).slice(0, 8),
                        inferredState: dedupeTextArray(Array.isArray(state.inferredState) ? state.inferredState.map(value => clip(value, 120)).filter(Boolean) : []).slice(0, 8),
                        evidenceIds: dedupeTextArray(Array.isArray(state.evidenceIds) ? state.evidenceIds.map(value => clip(value, 80)).filter(Boolean) : []).slice(0, 8)
                    };
                }
                if (JSON.stringify(cleanEntityStates) !== JSON.stringify(next.entityStates)) changed = true;
                next.entityStates = cleanEntityStates;
            }
            if (Array.isArray(next.relationDeltas)) {
                const cleanRelationDeltas = next.relationDeltas
                    .map(item => item && typeof item === 'object' ? {
                        id: clip(item.id || '', 80),
                        pair: sanitizeLedgerEntityList(item.pair || item.entities || [], evidenceText).slice(0, 2),
                        delta: sanitizeLedgerRelationText(item.delta || item.text || '', canonicalEntities),
                        trigger: clip(item.trigger || '', 160),
                        evidenceIds: dedupeTextArray(Array.isArray(item.evidenceIds) ? item.evidenceIds.map(value => clip(value, 80)).filter(Boolean) : []),
                        confidence: Math.max(0.1, Math.min(0.98, Number(item.confidence || 0.55)))
                    } : null)
                    .filter(item => item?.delta)
                    .slice(0, 6);
                if (JSON.stringify(cleanRelationDeltas) !== JSON.stringify(next.relationDeltas)) changed = true;
                next.relationDeltas = cleanRelationDeltas;
            }

            if (JSON.stringify(next.mentionedEntityNames || []) !== JSON.stringify(canonicalEntities)) changed = true;
            next.mentionedEntityNames = canonicalEntities.slice(0, MAX_ENTITIES);
            if (next.entityRefs !== undefined) { delete next.entityRefs; changed = true; }

            next.retention = {
                ...(next.retention && typeof next.retention === 'object' ? next.retention : {}),
                rawRetention: LEDGER_RAW_RETENTION,
                rawDiscarded: true
            };
            next.rawRetention = LEDGER_RAW_RETENTION;
            next.rawDiscarded = true;
            next.source = {
                ...(next.source && typeof next.source === 'object' ? next.source : {}),
                rawRetention: LEDGER_SOURCE_RETENTION
            };
            return { payload: next, changed };
        };
        const buildLedgerPayloadFromParts = ({
            user = '',
            ai = '',
            combined = '',
            summary = '',
            recallAnchors = [],
            directEvidenceSnippets = [],
            entityRefs = [],
            tags = [],
            recallKeywords = [],
            retrospectiveClass = '',
            arcKey = '',
            arcRole = '',
            causalRole = '',
            primaryConflict = '',
            relationDelta = '',
            options = {},
            world = null
        } = {}) => {
            const normalizedTurn = normalizeLegacyMemoryTurnAnchor(options.turn || options.t || 0) || undefined;
            const sourceMessageIds = normalizeCanonicalMessageIds(options.sourceMessageIds || []);
            const createdAt = Date.now();
            const unresolvedMentions = extractUnresolvedMentions(combined || [user, ai].join('\n'), entityRefs, normalizedTurn || 0);
            const groups = extractLedgerGroups(combined || [user, ai].join('\n'), normalizedTurn || 0);
            const evidenceRecords = buildLedgerEvidenceRecords(user, directEvidenceSnippets, normalizedTurn || 0);
            const ledgerFacts = attachEvidenceIdsToLedgerFacts(buildLedgerFacts(user, ai, summary, directEvidenceSnippets, entityRefs, {
                ...options,
                turn: normalizedTurn,
                unresolvedMentions,
                groups
            }), evidenceRecords);
            const relationSignals = relationDelta ? [{
                id: makeLedgerId('relation', relationDelta, normalizedTurn || 0, 0),
                text: relationDelta,
                entities: entityRefs.slice(0, 6),
                status: 'derived_candidate',
                evidenceIds: evidenceIdsForLedgerText(relationDelta, evidenceRecords, 1),
                confidence: 0.52
            }] : [];
            const openThreads = buildLedgerOpenThreads(combined || [user, ai].join('\n'), entityRefs, unresolvedMentions, groups, normalizedTurn || 0, primaryConflict)
                .map(thread => ({
                    ...thread,
                    evidenceIds: evidenceIdsForLedgerText([
                        thread?.text,
                        thread?.label,
                        ...(Array.isArray(thread?.resolutionCriteria) ? thread.resolutionCriteria : [])
                    ].filter(Boolean).join('\n'), evidenceRecords, 1)
                }));
            const worldChanges = world?.worldChange ? [world.worldChange] : [];
            const scene = world?.scene || extractLedgerScene(combined || [user, ai].join('\n'));
            const sceneCore = buildLedgerSceneCore({ scene, text: combined || [user, ai].join('\n'), evidenceRecords });
            const beats = buildLedgerBeats({
                user,
                ai,
                entityRefs,
                evidenceRecords,
                openThreads,
                relationSignals,
                turn: normalizedTurn || 0
            });
            const entityStates = buildLedgerEntityStates({ text: combined || [user, ai].join('\n'), entityRefs, evidenceRecords });
            const relationDeltas = relationSignals.map((signal, idx) => ({
                id: signal.id || makeLedgerId('relation', signal.text || '', normalizedTurn || 0, idx),
                pair: (signal.entities || entityRefs).slice(0, 2),
                delta: signal.text || '',
                trigger: clip((beats.find(beat => beat.type === 'relation_delta')?.summary || primaryConflict || ''), 160),
                evidenceIds: signal.evidenceIds || evidenceIdsForLedgerText(signal.text || '', evidenceRecords, 1),
                confidence: signal.confidence || 0.52
            }));
            if (!relationDeltas.length) {
                const relationBeat = beats.find(beat => beat.type === 'relation_delta');
                if (relationBeat) {
                    relationDeltas.push({
                        id: makeLedgerId('relation', relationBeat.summary, normalizedTurn || 0, 0),
                        pair: (relationBeat.entities || entityRefs).slice(0, 2),
                        delta: relationBeat.summary,
                        trigger: relationBeat.summary,
                        evidenceIds: relationBeat.evidenceIds || [],
                        confidence: relationBeat.confidence || 0.55
                    });
                }
            }
            const summaryV2 = buildLedgerSummaryV2({ user, summary, sceneCore, beats, openThreads, tags, recallKeywords, entityRefs });
            const payload = {
                schema: LEDGER_SCHEMA,
                version: LEDGER_VERSION,
                turn: normalizedTurn,
                firstSeenTurn: normalizeLegacyMemoryTurnAnchor(options.firstSeenTurn || normalizedTurn || 0) || normalizedTurn,
                source: {
                    turn: normalizedTurn,
                    firstSeenTurn: normalizeLegacyMemoryTurnAnchor(options.firstSeenTurn || normalizedTurn || 0) || normalizedTurn,
                    sourceHash: String(options.sourceHash || '').trim(),
                    sourceMessageIds,
                    createdAt,
                    rawRetention: LEDGER_SOURCE_RETENTION
                },
                scene,
                sceneCore,
                participants: {
                    canonicalEntities: entityRefs.slice(0, MAX_ENTITIES),
                    unresolvedMentions,
                    groups
                },
                facts: ledgerFacts,
                evidence: evidenceRecords,
                beats,
                entityStates,
                relationDeltas,
                continuity: {
                    openThreads,
                    relationSignals,
                    worldChanges
                },
                audit: {
                    cautions: [],
                    overpromotionRisks: [],
                    confidence: retrospectiveClass ? 'medium' : 'medium'
                },
                retention: {
                    rawRetention: LEDGER_RAW_RETENTION,
                    rawDiscarded: true
                },
                // Compatibility fields for existing V5 recall/scoring while v1 rows are migrated.
                summary,
                summaryV2,
                recallAnchors,
                directEvidenceSnippets,
                mentionedEntityNames: entityRefs.slice(0, MAX_ENTITIES),
                tags: Array.isArray(tags) ? tags.slice(0, MAX_TAGS) : [],
                recallKeywords: Array.isArray(recallKeywords) ? recallKeywords.slice(0, MAX_RECALL_KEYWORDS) : [],
                importance: Math.max(1, Math.min(10, Number(options.importance || 5) || 5)),
                impression: Math.max(0, Math.min(1, Number(options.impression || 0.5) || 0.5)),
                sourceHash: String(options.sourceHash || '').trim(),
                sourceMessageIds,
                rawRetention: LEDGER_RAW_RETENTION,
                rawDiscarded: true,
                retrospectiveClass,
                recallProfile: retrospectiveClass ? 'continuity_only' : 'default',
                arcKey,
                arcRole,
                causalRole,
                primaryConflict,
                relationDelta,
                createdAt,
                ...(world?.compat || {})
            };
            return sanitizeLedgerPayload(payload, options).payload;
        };
        const buildTurnPayload = (userText = '', aiText = '', options = {}) => {
            const user = '';
            const ai = Utils.getMemorySourceText(aiText);
            if (!ai && !user) return null;
            const combined = [user, ai].filter(Boolean).join('\n');
            const knownEntityOptions = {
                ...options,
                knownEntityNames: getDynamicKnownEntityNames(options)
            };
            let summary = buildSummary(user, ai, knownEntityOptions);
            const retrospectiveClass = normalizeRetrospectiveClass(options.retrospectiveClass || detectRetrospectiveClass(combined, summary));
            if (retrospectiveClass) summary = buildRetrospectiveSummary(summary, retrospectiveClass);
            const entityRefs = extractEntityRefs(combined, {
                ...knownEntityOptions,
                retrospectiveClass,
                strictKnownEntityNamesOnly: Boolean(retrospectiveClass)
            });
            const tags = applyRetrospectiveTags(extractTags(combined), retrospectiveClass);
            const recallKeywords = retrospectiveClass ? [] : extractRecallKeywords(combined, tags);
            const directEvidenceSnippets = retrospectiveClass
                ? []
                : buildSnippets(user, ai, { ...knownEntityOptions, entityRefs });
            const recallAnchors = retrospectiveClass
                ? buildRetrospectiveAnchors(summary, entityRefs, tags, retrospectiveClass)
                : buildAnchors(summary, directEvidenceSnippets, entityRefs, tags, recallKeywords);
            const normalizedTurn = normalizeLegacyMemoryTurnAnchor(options.turn || options.t || 0) || undefined;
            const arcKey = String(
                options.arcKey
                || (retrospectiveClass === 'family_postscript' ? 'family_postscript' : '')
                || (retrospectiveClass === 'global_recap' ? 'global_recap' : '')
                || inferArcKey(combined)
                || ''
            ).trim();
            const arcRole = String(options.arcRole || (retrospectiveClass ? 'retrospective' : inferArcRole(combined)) || '').trim();
            const causalRole = String(options.causalRole || (retrospectiveClass ? 'retrospective' : inferCausalRole(combined)) || '').trim();
            const primaryConflict = clip(options.primaryConflict || inferPrimaryConflict(combined, tags) || '', 260);
            const relationDelta = clip(options.relationDelta || inferRelationDelta(combined, entityRefs) || '', 240);
            return buildLedgerPayloadFromParts({
                user,
                ai,
                combined,
                summary,
                recallAnchors,
                directEvidenceSnippets,
                entityRefs,
                tags,
                recallKeywords,
                retrospectiveClass,
                arcKey,
                arcRole,
                causalRole,
                primaryConflict,
                relationDelta,
                options: {
                    ...options,
                    turn: normalizedTurn,
                    firstSeenTurn: normalizeLegacyMemoryTurnAnchor(options.firstSeenTurn || normalizedTurn || 0) || normalizedTurn
                }
            });
        };
        const buildPayloadFromLegacyContent = (content = '', meta = {}) => {
            const tagged = splitTagged(content);
            const payload = buildTurnPayload('', tagged.ai || '', {
                turn: meta.turn || meta.t || meta.finalizedTurn || meta.turnAnchorTurn || 0,
                importance: meta.imp || 5,
                sourceHash: meta.sourceHash || meta.aiHash || meta.responseHash || '',
                sourceMessageIds: meta.sourceMessageIds || meta.liveMessageIds || meta.m_id || []
            });
            if (!payload) return null;
            payload.migratedFrom = 'legacy_raw_memory';
            payload.migratedAt = Date.now();
            return payload;
        };
        const normalizeLedgerPayload = (payload = {}, meta = {}) => {
            if (!isLedgerPayload(payload)) return { payload, changed: false };
            let changed = false;
            const next = { ...payload, schema: LEDGER_SCHEMA, version: LEDGER_VERSION };
            if (next.hybridRow !== undefined) { delete next.hybridRow; changed = true; }
            if (next.hme !== undefined) { delete next.hme; changed = true; }
            const turn = normalizeLegacyMemoryTurnAnchor(next.turn || next.source?.turn || meta.t || meta.turn || 0) || undefined;
            if (turn && next.turn !== turn) { next.turn = turn; changed = true; }
            if (!next.source || typeof next.source !== 'object') {
                next.source = {
                    turn,
                    firstSeenTurn: normalizeLegacyMemoryTurnAnchor(next.firstSeenTurn || turn || 0) || turn,
                    sourceHash: String(next.sourceHash || meta.sourceHash || '').trim(),
                    sourceMessageIds: normalizeCanonicalMessageIds(next.sourceMessageIds || meta.sourceMessageIds || meta.liveMessageIds || []),
                    createdAt: Number(next.createdAt || Date.now()) || Date.now(),
                    rawRetention: LEDGER_SOURCE_RETENTION
                };
                changed = true;
            }
            if (!next.participants || typeof next.participants !== 'object') {
                const names = extractEntityRefs([next.summary, ...(Array.isArray(next.mentionedEntityNames) ? next.mentionedEntityNames : [])].filter(Boolean).join('\n'), {
                    knownEntityNames: getDynamicKnownEntityNames({ mentionedEntityNames: next.mentionedEntityNames || [] })
                });
                next.participants = {
                    canonicalEntities: names,
                    unresolvedMentions: extractUnresolvedMentions(next.summary || '', names, turn || 0),
                    groups: extractLedgerGroups(next.summary || '', turn || 0)
                };
                changed = true;
            }
            if (!Array.isArray(next.facts) || next.facts.length === 0) {
                next.facts = buildLedgerFacts('', '', next.summary || '', next.directEvidenceSnippets || [], next.participants?.canonicalEntities || next.mentionedEntityNames || [], { ...meta, turn, importance: next.importance || meta.imp || 5 });
                changed = true;
            }
            if (!next.continuity || typeof next.continuity !== 'object') {
                next.continuity = { openThreads: [], relationSignals: [], worldChanges: [] };
                changed = true;
            }
            if (!next.audit || typeof next.audit !== 'object') {
                next.audit = { cautions: [], overpromotionRisks: [], confidence: 'medium' };
                changed = true;
            }
            if (!next.retention || typeof next.retention !== 'object') {
                next.retention = { rawRetention: LEDGER_RAW_RETENTION, rawDiscarded: true };
                changed = true;
            }
            const sanitized = sanitizeLedgerPayload(next, meta);
            return { payload: sanitized.payload, changed: changed || sanitized.changed };
        };
        const legacyHybridToProjection = (meta = {}, payload = {}) => {
            const hme = meta?.hme && typeof meta.hme === 'object'
                ? meta.hme
                : (payload?.hybridRow && typeof payload.hybridRow === 'object' ? payload.hybridRow : (payload?.hme && typeof payload.hme === 'object' ? payload.hme : {}));
            const sourceTurnIds = dedupeTextArray([
                ...(Array.isArray(hme?.sourceTurnIds) ? hme.sourceTurnIds : []),
                payload?.turn,
                payload?.firstSeenTurn,
                meta?.t,
                meta?.turnAnchorTurn
            ].map(v => String(normalizeLegacyMemoryTurnAnchor(v) || '').trim()).filter(Boolean)).map(Number).filter(Boolean);
            return {
                schema: 'libra.memory.projection_pointer.v1',
                hmeDerivedAtReadTime: true,
                sourceTurnIds,
                staleCandidateIds: Array.isArray(hme?.staleCandidateIds) ? hme.staleCandidateIds.slice(0, 8) : [],
                rollbackState: String(hme?.rollbackState || meta?.rollbackState || '').trim(),
                hiddenFromPrompt: hme?.hiddenFromPrompt === true,
                stale: hme?.stale === true,
                staleReason: String(hme?.staleReason || '').trim()
            };
        };
        const stripLedgerMetaHme = (meta = {}, payload = {}) => {
            const nextMeta = { ...(meta || {}) };
            const hadHme = !!(nextMeta.hme || payload?.hybridRow || payload?.hme);
            if (hadHme || !nextMeta.projection) {
                nextMeta.projection = {
                    ...(nextMeta.projection && typeof nextMeta.projection === 'object' ? nextMeta.projection : {}),
                    ...legacyHybridToProjection(nextMeta, payload)
                };
            }
            if (nextMeta.hme !== undefined) delete nextMeta.hme;
            return { meta: nextMeta, changed: hadHme };
        };
        const upgradeLegacyCompactPayload = (payload = {}, meta = {}) => {
            if (!isLegacyCompactPayload(payload)) return null;
            const legacyHybrid = payload.hybridRow && typeof payload.hybridRow === 'object'
                ? payload.hybridRow
                : (payload.hme && typeof payload.hme === 'object' ? payload.hme : {});
            const knownNames = getDynamicKnownEntityNames({
                mentionedEntityNames: payload.mentionedEntityNames || legacyHybrid.subjects || []
            });
            const entityRefs = extractEntityRefs([
                ...(Array.isArray(payload.mentionedEntityNames) ? payload.mentionedEntityNames : []),
                ...(Array.isArray(payload.entityRefs) ? payload.entityRefs : []),
                ...(Array.isArray(legacyHybrid.subjects) ? legacyHybrid.subjects : [])
            ].join('\n'), { knownEntityNames: knownNames });
            const tags = dedupeTextArray((Array.isArray(payload.tags) ? payload.tags : [])
                .map(tag => String(tag || '').trim())
                .filter(tag => tag && !/^(?:current|cause|trigger|escalation|result|write_path_adapter)$/i.test(tag)))
                .slice(0, MAX_TAGS);
            const snippets = Array.isArray(payload.directEvidenceSnippets)
                ? payload.directEvidenceSnippets.map(item => typeof item === 'string' ? { source: 'legacy', text: item } : item).filter(Boolean).slice(0, MAX_SNIPPETS)
                : [];
            const anchors = Array.isArray(payload.recallAnchors) ? payload.recallAnchors.slice(0, MAX_ANCHORS) : [];
            const turn = normalizeLegacyMemoryTurnAnchor(payload.turn || meta.t || meta.turn || 0) || undefined;
            const relationDelta = entityRefs.length >= 2 ? clip(payload.relationDelta || '', 240) : '';
            const worldSignature = String(payload.worldSignature || payload.world?.signature || '').trim();
            const worldCompat = worldSignature || payload.world ? {
                worldChange: {
                    id: `world.${String(worldSignature || stableHash(payload.summary || '')).replace(/^-/, 'n')}`,
                    type: payload.arcKey === 'world_rule_snapshot' ? 'world_rule_snapshot' : 'world_fact',
                    text: clip(payload.summary || payload.worldSummary || '', 420),
                    summary: clip(payload.summary || payload.worldSummary || '', 420),
                    tags: dedupeTextArray([...(Array.isArray(payload.tags) ? payload.tags : []), ...(Array.isArray(legacyHybrid.worldTags) ? legacyHybrid.worldTags : [])]).slice(0, 12),
                    signature: worldSignature,
                    confidence: 0.78
                },
                scene: { time: '', location: '', summary: payload.arcKey === 'world_rule_snapshot' ? 'world_rule_snapshot' : '' },
                compat: {
                    classification: payload.classification || '',
                    worldSignature,
                    worldSummary: payload.worldSummary || '',
                    world: payload.world && typeof payload.world === 'object' ? safeClone(payload.world) : undefined
                }
            } : null;
            const upgraded = buildLedgerPayloadFromParts({
                user: '',
                ai: '',
                combined: [
                    payload.summary,
                    payload.primaryConflict,
                    payload.relationDelta,
                    ...(Array.isArray(payload.tags) ? payload.tags : []),
                    ...snippets.map(item => item?.text || '')
                ].filter(Boolean).join('\n'),
                summary: clip(payload.summary || snippets.map(item => item?.text || '').filter(Boolean).join(' / ') || payload.primaryConflict || payload.relationDelta || '', MAX_SUMMARY_CHARS),
                recallAnchors: anchors,
                directEvidenceSnippets: snippets,
                entityRefs,
                tags,
                retrospectiveClass: normalizeRetrospectiveClass(payload.retrospectiveClass || legacyHybrid.retrospectiveClass || ''),
                arcKey: String(payload.arcKey || '').trim(),
                arcRole: String(payload.arcRole || '').trim(),
                causalRole: String(payload.causalRole || '').trim(),
                primaryConflict: clip(payload.primaryConflict || '', 260),
                relationDelta,
                options: {
                    turn,
                    firstSeenTurn: normalizeLegacyMemoryTurnAnchor(payload.firstSeenTurn || turn || 0) || turn,
                    importance: payload.importance || meta.imp || 5,
                    impression: payload.impression || 0.5,
                    sourceHash: payload.sourceHash || meta.sourceHash || '',
                    sourceMessageIds: payload.sourceMessageIds || meta.sourceMessageIds || meta.liveMessageIds || []
                },
                world: worldCompat
            });
            if (!upgraded) return null;
            upgraded.migratedFrom = 'compact_turn_v1';
            upgraded.migratedAt = Date.now();
            upgraded.legacySchema = SCHEMA;
            return upgraded;
        };
        const normalizePayloadForWrite = (payload = null, meta = {}) => {
            if (!payload || typeof payload !== 'object') return payload;
            if (isLedgerPayload(payload)) return normalizeLedgerPayload(payload, meta).payload;
            if (isLegacyCompactPayload(payload)) return upgradeLegacyCompactPayload(payload, meta) || payload;
            return payload;
        };
        const normalizePayloadForRead = (payload = null, meta = {}) => {
            if (!payload || typeof payload !== 'object') return payload;
            if (isLedgerPayload(payload)) return sanitizeLedgerPayload(payload, meta).payload;
            if (isLegacyCompactPayload(payload)) return upgradeLegacyCompactPayload(payload, meta) || payload;
            return payload;
        };
        const serialize = (payload = null) => JSON.stringify(payload || {}, null, 0);
        const buildSearchTextFromPayload = (payload = null, meta = {}) => {
            payload = normalizePayloadForRead(payload, meta) || payload;
            if (!isCompactPayload(payload)) return '';
            const ledger = isLedgerPayload(payload);
            const snippets = Array.isArray(payload.directEvidenceSnippets)
                ? payload.directEvidenceSnippets.map(item => typeof item === 'string' ? item : item?.text).filter(Boolean)
                : [];
            const anchors = Array.isArray(payload.recallAnchors)
                ? payload.recallAnchors.flatMap(item => [item?.summary, item?.hint]).filter(Boolean)
                : [];
            const ledgerSummaryV2 = ledger && payload.summaryV2 && typeof payload.summaryV2 === 'object'
                ? [payload.summaryV2.oneLine, payload.summaryV2.continuity, payload.summaryV2.recall].filter(Boolean)
                : [];
            const ledgerFacts = ledger && Array.isArray(payload.facts)
                ? payload.facts.flatMap(item => [
                    item?.text,
                    item?.type,
                    ...(Array.isArray(item?.subjects) ? item.subjects.flatMap(ref => [ref?.label, ref?.role]) : []),
                    ...(Array.isArray(item?.observerEntities) ? item.observerEntities : []),
                    ...(Array.isArray(item?.evidence) ? item.evidence.map(ev => ev?.text || ev).filter(Boolean) : [])
                ]).filter(Boolean)
                : [];
            const ledgerParticipants = ledger
                ? [
                    ...(Array.isArray(payload?.participants?.canonicalEntities) ? payload.participants.canonicalEntities : []),
                    ...(Array.isArray(payload?.participants?.unresolvedMentions) ? payload.participants.unresolvedMentions.flatMap(item => [item?.label, item?.role, item?.evidence]) : []),
                    ...(Array.isArray(payload?.participants?.groups) ? payload.participants.groups.flatMap(item => [item?.label, item?.role, item?.evidence]) : [])
                ].filter(Boolean)
                : [];
            const ledgerContinuity = ledger
                ? [
                    ...(Array.isArray(payload?.continuity?.openThreads) ? payload.continuity.openThreads.flatMap(item => [
                        item?.label,
                        item?.text,
                        item?.status,
                        ...(Array.isArray(item?.subjectRefs) ? item.subjectRefs.flatMap(ref => [ref?.label, ref?.role]) : []),
                        ...(Array.isArray(item?.resolutionCriteria) ? item.resolutionCriteria : []),
                        ...(Array.isArray(item?.evidenceIds) ? item.evidenceIds : [])
                    ]) : []),
                    ...(Array.isArray(payload?.continuity?.relationSignals) ? payload.continuity.relationSignals.flatMap(item => [item?.text, item?.status, ...(Array.isArray(item?.evidenceIds) ? item.evidenceIds : [])]) : []),
                    ...(Array.isArray(payload?.continuity?.worldChanges) ? payload.continuity.worldChanges.flatMap(item => [item?.text, item?.summary, item?.type]) : [])
                ].filter(Boolean)
                : [];
            const ledgerScene = ledger && payload.scene && typeof payload.scene === 'object'
                ? [payload.scene.time, payload.scene.location, payload.scene.summary].filter(Boolean)
                : [];
            const ledgerSceneCore = ledger && payload.sceneCore && typeof payload.sceneCore === 'object'
                ? [
                    payload.sceneCore.time,
                    payload.sceneCore.location,
                    payload.sceneCore.locationStatus,
                    payload.sceneCore.scenePhase,
                    payload.sceneCore.activeProblem,
                    payload.sceneCore.nextPhysicalAction
                ].filter(Boolean)
                : [];
            const ledgerBeats = ledger && Array.isArray(payload.beats)
                ? payload.beats.flatMap(item => [item?.type, item?.summary, ...(Array.isArray(item?.entities) ? item.entities : [])]).filter(Boolean)
                : [];
            const ledgerEvidence = ledger && Array.isArray(payload.evidence)
                ? payload.evidence.flatMap(item => [item?.source, item?.kind, item?.text]).filter(Boolean)
                : [];
            const ledgerEntityStates = ledger && payload.entityStates && typeof payload.entityStates === 'object'
                ? Object.entries(payload.entityStates).flatMap(([name, state]) => [
                    name,
                    ...(Array.isArray(state?.visibleState) ? state.visibleState : []),
                    ...(Array.isArray(state?.inferredState) ? state.inferredState : [])
                ]).filter(Boolean)
                : [];
            const ledgerRelationDeltas = ledger && Array.isArray(payload.relationDeltas)
                ? payload.relationDeltas.flatMap(item => [item?.delta, item?.trigger, ...(Array.isArray(item?.pair) ? item.pair : [])]).filter(Boolean)
                : [];
            const payloadWorld = (payload && payload.world && typeof payload.world === 'object' && !Array.isArray(payload.world)) ? payload.world : {};
            const worldRuleHighlights = [
                ...(Array.isArray(payloadWorld?.ruleHighlights) ? payloadWorld.ruleHighlights : []),
                ...extractWorldRuleHighlights(normalizeWorldRuleUpdate(payloadWorld), 8)
            ].map(value => String(value || '').trim()).filter(Boolean);
            const hme = (!ledger && payload && typeof payload.hybridRow === 'object') ? payload.hybridRow : ((!ledger && payload && typeof payload.hme === 'object') ? payload.hme : {});
            const hmeArrays = !ledger ? [
                hme.subjects, hme.aliases, hme.tags, hme.sceneTags, hme.emotionTags,
                hme.relationTags, hme.worldTags, hme.narrativeTags, hme.kinds, hme.kind
            ].flatMap(item => Array.isArray(item) ? item : (item ? [item] : [])) : [];
            const retrospectiveClass = normalizeRetrospectiveClass(payload?.retrospectiveClass || hme?.retrospectiveClass || '');
            const continuityOnly = isContinuityOnlyRecallProfile(payload);
            const compatParts = ledger ? [
                payload.arcKey,
                payload.arcRole,
                payload.causalRole
            ] : [
                payload.arcKey,
                payload.arcRole,
                payload.causalRole,
                payload.primaryConflict,
                payload.relationDelta,
                ...(Array.isArray(payload.tags) ? payload.tags : []),
                ...(Array.isArray(payload.mentionedEntityNames) ? payload.mentionedEntityNames : [])
            ];
            const baseParts = [
                payload.summary,
                ...ledgerSummaryV2,
                ...(Array.isArray(payload.recallKeywords) ? payload.recallKeywords : []),
                ...ledgerFacts,
                ...ledgerParticipants,
                ...ledgerContinuity,
                ...ledgerScene,
                ...ledgerSceneCore,
                ...ledgerBeats,
                ...ledgerEvidence,
                ...ledgerEntityStates,
                ...ledgerRelationDeltas,
                payload?.classification?.primary || payload?.classification,
                payload.worldSummary,
                payloadWorld?.classification?.primary,
                payloadWorld?.userCorrection,
                ...worldRuleHighlights,
                ...compatParts,
                (typeof RPContinuityCore !== 'undefined' ? RPContinuityCore.flattenForSearch(payload.rpLongTerm) : ''),
                retrospectiveClass ? retrospectiveClass.replace(/_/g, ' ') : '',
                continuityOnly ? 'continuity only recall profile' : '',
                ...hmeArrays
            ];
            const detailParts = continuityOnly ? [] : [...anchors, ...snippets];
            return dedupeTextArray([...baseParts, ...detailParts].map(v => String(v || '').trim()).filter(Boolean)).join('\n');
        };
        const buildRecallScoringTextFromPayload = (payload = null, maxChars = 800, meta = {}) => {
            payload = normalizePayloadForRead(payload, meta) || payload;
            if (!isCompactPayload(payload)) return '';
            const ledger = isLedgerPayload(payload);
            const limit = Math.max(400, Math.min(4000, Number(maxChars) || 800));
            const parts = [];
            const push = (value, max = 260) => {
                const raw = String(value || '').trim();
                if (!raw) return;
                parts.push(clip(raw, max));
            };
            const pushArray = (items, maxItems = 8, maxCharsPer = 160) => {
                (Array.isArray(items) ? items : [])
                    .map(item => typeof item === 'string' ? item : (item?.summary || item?.hint || item?.text || item?.delta || item?.trigger || item?.label || item?.role || item?.type || item?.oneLine || item?.continuity || item?.recall || ''))
                    .filter(Boolean)
                    .slice(0, maxItems)
                    .forEach(item => push(item, maxCharsPer));
            };
            push(payload.summary, 520);
            if (ledger && payload.summaryV2 && typeof payload.summaryV2 === 'object') {
                push(payload.summaryV2.oneLine, 420);
                push(payload.summaryV2.continuity, 560);
                push(payload.summaryV2.recall, 420);
            }
            pushArray(payload.recallKeywords, 12, 90);
            pushArray(payload.tags, 12, 90);
            pushArray(payload.mentionedEntityNames, 12, 90);
            pushArray(payload.recallAnchors, 8, 160);
            pushArray(payload.directEvidenceSnippets, MAX_SNIPPETS, 220);
            push(payload.arcKey, 120);
            push(payload.arcRole, 120);
            push(payload.causalRole, 120);
            push(payload.primaryConflict, 240);
            push(payload.relationDelta, 240);
            if (typeof RPContinuityCore !== 'undefined') push(RPContinuityCore.flattenForSearch(payload.rpLongTerm), 1400);
            if (ledger) {
                const facts = Array.isArray(payload.facts) ? payload.facts : [];
                facts.slice(0, 5).forEach(item => {
                    push(item?.text, 260);
                    push(item?.type, 90);
                    pushArray(item?.subjects, 4, 90);
                });
                pushArray(payload?.participants?.canonicalEntities, 12, 90);
                pushArray(payload?.participants?.groups, 5, 120);
                const openThreads = Array.isArray(payload?.continuity?.openThreads) ? payload.continuity.openThreads : [];
                openThreads.slice(0, 4).forEach(item => {
                    push(item?.label, 160);
                    push(item?.text, 260);
                    push(item?.status, 90);
                    pushArray(item?.subjectRefs, 4, 90);
                    pushArray(item?.resolutionCriteria, 5, 90);
                });
                pushArray(payload?.continuity?.relationSignals, 4, 200);
                pushArray(payload?.continuity?.worldChanges, 4, 200);
                if (payload.scene && typeof payload.scene === 'object') {
                    push(payload.scene.location, 120);
                    push(payload.scene.summary, 240);
                    push(payload.scene.time, 120);
                }
                if (payload.sceneCore && typeof payload.sceneCore === 'object') {
                    push(payload.sceneCore.location, 120);
                    push(payload.sceneCore.locationStatus, 80);
                    push(payload.sceneCore.scenePhase, 80);
                    push(payload.sceneCore.activeProblem, 240);
                    push(payload.sceneCore.nextPhysicalAction, 200);
                }
                pushArray(payload.beats, 10, 240);
                pushArray(payload.evidence, MAX_SNIPPETS + 2, 220);
                pushArray(payload.relationDeltas, 6, 220);
                if (payload.entityStates && typeof payload.entityStates === 'object') {
                    Object.entries(payload.entityStates).slice(0, 8).forEach(([name, state]) => {
                        push(name, 90);
                        pushArray(state?.visibleState, 6, 120);
                        pushArray(state?.inferredState, 6, 120);
                    });
                }
            }
            const payloadWorld = (payload && payload.world && typeof payload.world === 'object' && !Array.isArray(payload.world)) ? payload.world : {};
            push(payload?.classification?.primary || payload?.classification, 120);
            push(payload.worldSummary, 300);
            push(payloadWorld?.classification?.primary, 120);
            pushArray(payloadWorld?.ruleHighlights, 6, 130);
            const hme = (!ledger && payload && typeof payload.hybridRow === 'object') ? payload.hybridRow : ((!ledger && payload && typeof payload.hme === 'object') ? payload.hme : {});
            if (hme && typeof hme === 'object') {
                [hme.subjects, hme.aliases, hme.tags, hme.sceneTags, hme.emotionTags, hme.relationTags, hme.worldTags, hme.narrativeTags, hme.kinds, hme.kind]
                    .flatMap(item => Array.isArray(item) ? item : (item ? [item] : []))
                    .slice(0, 36)
                    .forEach(item => push(item, 90));
            }
            const retrospectiveClass = normalizeRetrospectiveClass(payload?.retrospectiveClass || hme?.retrospectiveClass || '');
            if (retrospectiveClass) push(retrospectiveClass.replace(/_/g, ' '), 120);
            const joined = dedupeTextArray(parts.map(v => String(v || '').trim()).filter(Boolean)).join('\n');
            return clip(joined, limit);
        };
        const buildRecallScoringTextFromContent = (content = '', maxChars = 800) => {
            const parsed = parsePayloadFromContent(content);
            if (parsed) return buildRecallScoringTextFromPayload(parsed, maxChars, parseLibraMetaObject(content, {}));
            const tagged = splitTagged(content);
            const assistantOnly = stripUserTurnSummaryText(tagged.ai || (!tagged.user && !tagged.ai ? Utils.getMemorySourceText(stripMeta(content)) : ''));
            return clip(assistantOnly, Math.max(400, Math.min(4000, Number(maxChars) || 800)));
        };
        const buildRecallScoringTextFromEntry = (entry = null, maxChars = 800) => buildRecallScoringTextFromContent(entry?.content || entry || '', maxChars);
        const buildSearchTextFromContent = (content = '') => {
            const parsed = parsePayloadFromContent(content);
            if (parsed) return buildSearchTextFromPayload(parsed, parseLibraMetaObject(content, {}));
            const tagged = splitTagged(content);
            return stripUserTurnSummaryText(tagged.ai || (!tagged.user && !tagged.ai ? Utils.getMemorySourceText(stripMeta(content)) : ''));
        };
        const buildSearchTextFromEntry = (entry = null) => buildSearchTextFromContent(entry?.content || entry || '');
        const buildDisplayTextFromEntry = (entry = null, max = 280) => {
            const content = entry?.content || entry || '';
            const parsed = parsePayloadFromContent(content);
            if (parsed) {
                const payload = normalizePayloadForRead(parsed, parseLibraMetaObject(content, {})) || parsed;
                if (isLedgerPayload(payload)) {
                    const facts = Array.isArray(payload.facts)
                        ? payload.facts.map(item => item?.text).filter(Boolean).slice(0, 2)
                        : [];
                    const continuity = [
                        ...(Array.isArray(payload?.continuity?.openThreads) ? payload.continuity.openThreads.map(item => item?.text).filter(Boolean) : []),
                        ...(Array.isArray(payload?.continuity?.relationSignals) ? payload.continuity.relationSignals.map(item => item?.text).filter(Boolean) : [])
                    ].slice(0, 1);
                    const rpDisplay = typeof RPContinuityCore !== 'undefined' ? RPContinuityCore.formatTurnForDisplay(payload.rpLongTerm, 220) : '';
                    return clip([payload.summary, ...facts, ...continuity, rpDisplay].filter(Boolean).join(' / '), max);
                }
                const snippets = Array.isArray(payload.directEvidenceSnippets)
                    ? payload.directEvidenceSnippets.map(item => typeof item === 'string' ? stripUserTurnSummaryText(item) : stripUserTurnSummaryText(item?.text)).filter(Boolean).slice(0, 2)
                    : [];
                const rpDisplay = typeof RPContinuityCore !== 'undefined' ? RPContinuityCore.formatTurnForDisplay(payload.rpLongTerm, 220) : '';
                return clip([stripUserTurnSummaryText(payload.summary), payload.primaryConflict, payload.relationDelta, ...snippets, rpDisplay].filter(Boolean).join(' / '), max);
            }
            const tagged = splitTagged(content);
            return clip(stripUserTurnSummaryText(tagged.ai || (!tagged.user && !tagged.ai ? Utils.getMemorySourceText(stripMeta(content)) : '')), max);
        };
        const migrateEntry = (entry = null) => {
            if (!entry || String(entry?.comment || '') !== 'lmai_memory') return { entry, changed: false };
            const parsed = parsePayloadFromEntry(entry);
            const meta = parseLibraMetaObject(entry.content, {});
            if (parsed) {
                let payload = parsed;
                const projectionSourcePayload = parsed;
                let changed = false;
                if (isLegacyCompactPayload(parsed)) {
                    payload = upgradeLegacyCompactPayload(parsed, meta);
                    changed = Boolean(payload);
                    meta.rawMigrated = 'compact_turn_v1_to_turn_ledger_v2';
                    meta.migratedAt = Date.now();
                } else if (isLedgerPayload(parsed)) {
                    const normalized = normalizeLedgerPayload(parsed, meta);
                    payload = normalized.payload;
                    changed = normalized.changed;
                }
                if (!payload) return { entry, changed: false };
                const stripped = stripLedgerMetaHme(meta, projectionSourcePayload || payload);
                const nextMeta = stripped.meta;
                changed = changed || stripped.changed;
                if (!changed) return { entry, changed: false };
                nextMeta.rawRetention = LEDGER_RAW_RETENTION;
                nextMeta.rawDiscarded = true;
                nextMeta.summary = payload.summary || nextMeta.summary || '';
                try { nextMeta.recallHints = StrengthenedJaccardCore.buildRecallHints(buildSearchTextFromPayload(payload), { maxTokens: 10, maxNumbers: 4, maxQuotes: 2 }); }
                catch (_) { nextMeta.recallHints = nextMeta.recallHints || {}; }
                return {
                    entry: {
                        ...entry,
                        content: `[META:${JSON.stringify(nextMeta)}]\n${serialize(payload)}\n`
                    },
                    changed: true
                };
            }
            const payload = buildPayloadFromLegacyContent(entry.content || '', meta);
            if (!payload) return { entry, changed: false };
            meta.rawRetention = LEDGER_RAW_RETENTION;
            meta.rawDiscarded = true;
            meta.rawMigrated = 'legacy_raw_memory_to_turn_ledger_v2';
            meta.summary = payload.summary || meta.summary || '';
            const stripped = stripLedgerMetaHme(meta, payload);
            const nextMeta = stripped.meta;
            try { nextMeta.recallHints = StrengthenedJaccardCore.buildRecallHints(buildSearchTextFromPayload(payload), { maxTokens: 10, maxNumbers: 4, maxQuotes: 2 }); }
            catch (_) { nextMeta.recallHints = nextMeta.recallHints || {}; }
            return {
                entry: {
                    ...entry,
                    content: `[META:${JSON.stringify(nextMeta)}]\n${serialize(payload)}\n`
                },
                changed: true
            };
        };
        return Object.freeze({
            SCHEMA,
            LEDGER_SCHEMA,
            LEGACY_SCHEMA: SCHEMA,
            LEDGER_VERSION,
            isCompactPayload,
            isLedgerPayload,
            parsePayloadFromContent,
            parsePayloadFromEntry,
            normalizeRetrospectiveClass,
            detectRetrospectiveClass,
            getRetrospectiveTags,
            isContinuityOnlyRecallProfile,
            buildTurnPayload,
            buildPayloadFromLegacyContent,
            normalizePayloadForWrite,
            serialize,
            buildSearchTextFromPayload,
            buildSearchTextFromContent,
            buildSearchTextFromEntry,
            buildRecallScoringTextFromPayload,
            buildRecallScoringTextFromContent,
            buildRecallScoringTextFromEntry,
            buildDisplayTextFromEntry,
            migrateEntry
        });
    })();


    // ══════════════════════════════════════════════════════════════
    // [RP-LTM] Roleplay Long-Term Continuity Core
    // Durable canon, preferences, commitments, unresolved threads, and relationship milestones.
    // ══════════════════════════════════════════════════════════════
    const RPContinuityCore = (() => {
        const COMMENT = 'lmai_rp_longterm';
        const KEY = 'lmai_rp_longterm::core';
        const SCHEMA = 'libra.rp_longterm.v1';
        const TURN_SCHEMA = 'libra.rp_turn_memory.v1';
        const VERSION = 1;
        const CATEGORY_LIMITS = Object.freeze({
            stableFacts: 180,
            preferences: 120,
            commitments: 120,
            openLoops: 160,
            relationshipMilestones: 160,
            stateChanges: 140,
            callbacks: 120,
            episodes: 80
        });
        const CATEGORY_ORDER = Object.freeze([
            'stableFacts', 'preferences', 'commitments', 'openLoops',
            'relationshipMilestones', 'stateChanges', 'callbacks', 'episodes'
        ]);
        const DURABILITY_RANK = Object.freeze({ short: 0, medium: 1, long: 2, permanent: 3 });
        const ACTIVE_STATUS = new Set(['open', 'active', 'pending', 'ongoing', 'unresolved', 'promised']);
        const CLOSED_STATUS = new Set(['resolved', 'closed', 'fulfilled', 'broken', 'cancelled', 'superseded', 'inactive']);
        const GENERIC_TOKENS = new Set([
            '사용자','응답','대화','장면','현재','기억','메모리','정보','요약','관계','세계','세계관','내러티브','스토리',
            '그리고','하지만','그러나','그녀','그는','그들','이것','저것','정말','아무','자신','서로','이번','다음','방금',
            'user','assistant','response','conversation','scene','current','memory','information','summary','relationship','world','story',
            'and','but','however','this','that','they','them','really','something','someone','next','latest'
        ]);
        const MAJOR_RELATION_RE = /(고백|사귀(?:기|게|자)?|연인|애인|결혼|약혼|키스|첫키스|화해|절교|이별|헤어|재회|동맹|배신|용서|신뢰|가족이 되|친구가 되|lover|dating|date each other|married|marriage|engaged|engagement|kissed|first kiss|reconciled|breakup|broke up|reunited|alliance|betrayed|forgave|trusted)/i;
        const COMMITMENT_RE = /(약속|맹세|서약|(?:반드시|꼭)\s*.{0,24}(?:할게|하겠다|하겠어|해\s*줄게|지킬게|돌아오겠|돌아올게|기다릴게|함께할게)|다시는\s*.{0,24}(?:않|안\s)|잊지\s*않|끝까지\s*.{0,18}(?:지키|함께)|promise|swear|pledge|vow|never again|won't ever|will always|come back|return to you|wait for you|stay with you|(?:i(?:'ll| will)|we(?:'ll| will)).{0,48}(?:make sure|come back|return|wait|stay|protect|remember|never|always|keep my word))/i;
        const COMMITMENT_RESOLVED_RE = /(약속(?:을|은)?\s*(?:지켰|이행|완수)|맹세(?:를|는)?\s*(?:지켰|이행)|fulfilled\s+(?:the\s+)?promise|kept\s+(?:the|my|their|his|her)?\s*promise|promise\s+(?:was\s+)?fulfilled)/i;
        const COMMITMENT_BROKEN_RE = /(약속(?:을|은)?\s*(?:어겼|깨뜨|저버)|맹세(?:를|는)?\s*(?:어겼|저버)|broke\s+(?:the|my|their|his|her)?\s*promise|betrayed\s+(?:the\s+)?promise)/i;
        const PREFERENCE_RE = /(좋아(?:한|하|해)|싫어(?:한|하|해)|선호|취향|최애|알레르기|못\s*먹|먹지\s*못|두려워|무서워|꺼려|불편해|편안해|하지\s*마|원하지\s*않|금기|경계선|likes?|loves?|dislikes?|hates?|prefers?|favorite|favourite|allergic|cannot eat|can't eat|afraid of|fears?|uncomfortable|comfortable|do not|don't\s+want|boundary|taboo)/i;
        const STABLE_FACT_RE = /(정체|본명|진짜\s*이름|생일|나이|직업|소속|가족|부모|아버지|어머니|형제|자매|고향|출신|거주|사는\s*곳|혈액형|종족|능력|약점|비밀(?:은|이|의\s*정체)|기혼|미혼|real\s+name|true\s+identity|identity\s+is|birthday|age\s+is|works?\s+as|occupation|member\s+of|belongs?\s+to|family|father|mother|parent|sibling|brother|sister|hometown|from\s+[A-Z]|lives?\s+in|species|ability|weakness|secret\s+(?:is|identity)|actually\s+(?:is|works|lives|belongs))/i;
        const IDENTITY_RE = /(정체|본명|진짜\s*이름|종족|혈통|출생의\s*비밀|real\s+name|true\s+identity|identity|species|bloodline)/i;
        const STATE_CHANGE_RE = /(다쳤|부상|상처|골절|병원|입원|의식(?:을)?\s*잃|죽었|사망|실종|임신|체포|구금|해고|승진|퇴학|졸업|이사|전학|합류|탈퇴|떠났|도착했|귀환|변신|기억(?:을)?\s*잃|injured|wounded|hospitalized|unconscious|died|dead|killed|missing|pregnant|arrested|detained|fired|promoted|expelled|graduated|transferred\s+to|moved\s+to|joined\s+(?:the\s+)?(?:group|team|guild|party|organization|company|school)|left\s+(?:(?:the\s+)?(?:group|team|guild|party|organization|company|school|city|town|village|home|room|building)|for\s+)|departed\s+(?:from|for)|arrived\s+(?:at|in|home)|returned\s+(?:to|from|home)|transformed|lost\s+(?:his|her|their)?\s*memory)/i;
        const IRREVERSIBLE_RE = /(죽었|사망|살해|결혼|약혼|임신|출산|이별|절교|퇴학|졸업|해고|체포|영구|불구|died|dead|killed|married|engaged|pregnant|gave birth|breakup|expelled|graduated|fired|arrested|permanent)/i;
        const OPEN_LOOP_RE = /(해야\s*(?:해|한다|돼|된다)|찾아야|알아내야|확인해야|해결해야|구해야|막아야|기다리는\s*중|미해결|수수께끼|의문|단서|추적|행방|목표|계획|퀘스트|임무|숙제|비밀을\s*밝|need(?:s)?\s+to|must\s+|have\s+to|has\s+to|still\s+need|unresolved|mystery|clue|trace|whereabouts|goal|plan|quest|mission|find\s+out|figure\s+out|save\s+|stop\s+)/i;
        const LOOP_RESOLVED_RE = /(해결했|밝혀냈|찾아냈|구해냈|완료했|끝냈|진실이\s*드러|resolved|solved|found\s+out|completed|finished|rescued|truth\s+was\s+revealed)/i;
        const CALLBACK_RE = /(반지|목걸이|팔찌|사진|편지|일기|선물|흉터|문신|암호|암호명|별명|애칭|기념품|부적|열쇠|증표|징표|ring|necklace|bracelet|photo|photograph|letter|diary|gift|scar|tattoo|codeword|codename|nickname|pet\s+name|memento|keepsake|amulet|key|token)/i;
        const SECRET_RE = /(비밀|몰래|숨기|감추|아무도\s*모르|모르게|알려지지|정체를\s*숨|secret|hidden|conceal|unbeknownst|no\s+one\s+knows|doesn['’]?t\s+know|do\s+not\s+know)/i;
        const POV_RE = /([가-힣A-Za-z0-9 _-]{1,40})(?:만|만이)\s*(?:알|알고)|only\s+([A-Za-z0-9 _-]{1,40})\s+knows?/i;
        const TRANSIENT_MOOD_ONLY_RE = /^(?:잠시|순간|지금|현재|방금)?\s*(?:기쁘|슬프|화가\s*나|긴장|당황|놀라|웃|울|행복|불안|angry|sad|happy|nervous|surprised|smiled|cried)(?:다|했다|해졌다|였다|\.)?$/i;
        const META_CONTROL_RE = /^(?:\s*\[?(?:ooc|system|assistant|analysis|memory|메모리|설정|시스템|분석|요약|번역|지시|명령)\]?\s*[:：]|\s*#\s*(?:response|analysis|memory)|\s*```)/i;

        const clip = (value = '', max = 280) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            const limit = Math.max(20, Number(max || 0));
            return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trim()}…` : text;
        };
        const normalizeText = (value = '') => String(value || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[“”‘’"'`]/g, '')
            .replace(/[^a-z0-9가-힣]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const normalizeRecallToken = (value = '') => {
            let token = String(value || '').trim().toLowerCase();
            // Korean particles otherwise make the same anchor look unrelated
            // (민트초코를/민트초코가, 서연은/서연이). Keep short lexical
            // words such as 사과 intact and strip only from longer tokens.
            if (token.length >= 3 && /[가-힣]/.test(token)) {
                token = token.replace(/(?:에게서는|에게서|에게는|에게|한테는|한테|께서는|께서|으로는|에서는|에는|에서|부터|까지|처럼|으로|하고|이랑|랑|은|는|이|가|을|를|의|도|로|와|과)$/u, '');
            }
            return token;
        };
        const tokenize = (value = '') => (normalizeText(value).match(/[a-z0-9가-힣]{2,}/g) || [])
            .map(normalizeRecallToken)
            .filter(token => token && token.length >= 2 && !GENERIC_TOKENS.has(token))
            .slice(0, 80);
        const normalizeEntity = (value = '') => String(value || '')
            .replace(/^[\s,.;:!?()[\]{}"'`~\-]+|[\s,.;:!?()[\]{}"'`~\-]+$/g, '')
            .replace(/(?:에게서는|에게서|에게는|에게|한테는|한테|께서는|께서|으로는|에서는|에는|에서|부터|까지|처럼|으로|하고|이랑|랑|은|는|이|가|을|를|의|도|로|만)$/u, '')
            .trim();
        const uniqueStrings = (items = [], max = 24) => dedupeTextArray((Array.isArray(items) ? items : [items])
            .map(item => typeof item === 'string' ? item : (item?.name || item?.label || item?.ref || item?.id || ''))
            .map(normalizeEntity)
            .filter(Boolean))
            .slice(0, max);
        const clampConfidence = (value, fallback = 0.72) => Math.max(0.1, Math.min(0.99, Number(value ?? fallback) || fallback));
        const clampImportance = (value, fallback = 5) => Math.max(1, Math.min(10, Math.round(Number(value ?? fallback) || fallback)));
        const normalizeDurability = (value = '', fallback = 'medium') => {
            const normalized = String(value || '').trim().toLowerCase();
            return Object.prototype.hasOwnProperty.call(DURABILITY_RANK, normalized) ? normalized : fallback;
        };
        const normalizeStatus = (value = '', fallback = 'active') => {
            const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            const aliases = {
                pending: 'open', ongoing: 'open', unresolved: 'open', active: 'active', promised: 'open',
                done: 'resolved', complete: 'resolved', completed: 'resolved', fulfilled: 'fulfilled',
                cancelled: 'cancelled', canceled: 'cancelled', broken: 'broken', superseded: 'superseded'
            };
            return aliases[normalized] || normalized || fallback;
        };
        const normalizeVisibility = (value = '', text = '') => {
            const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            if (['secret', 'hidden', 'private'].includes(normalized)) return 'secret';
            if (['pov', 'limited', 'restricted', 'entity_only'].includes(normalized)) return 'pov';
            if (SECRET_RE.test(String(text || ''))) return 'secret';
            return 'public';
        };
        const durabilityFromText = (text = '', category = '') => {
            const raw = String(text || '');
            if (category === 'stableFacts' || category === 'preferences') return 'permanent';
            if (IRREVERSIBLE_RE.test(raw) || IDENTITY_RE.test(raw) || /(영원|평생|다시는|forever|always|never again)/i.test(raw)) return 'permanent';
            if (['commitments', 'openLoops', 'relationshipMilestones', 'stateChanges'].includes(category)) return 'long';
            if (category === 'callbacks') return 'long';
            return 'medium';
        };
        const categoryDefaultStatus = (category = '') => {
            if (category === 'commitments' || category === 'openLoops') return 'open';
            return 'active';
        };
        const splitSentences = (text = '') => String(text || '')
            .replace(/\r\n/g, '\n')
            .split(/(?<=[.!?。！？다요죠네음함임됨]|[\]\)])\s+|\n{2,}|\n(?=["“‘'가-힣A-Z0-9])/g)
            .map(item => item.replace(/\s+/g, ' ').trim())
            .filter(item => item.length >= 5 && item.length <= 900)
            .slice(0, 42);
        const getKnownEntityNames = (options = {}) => {
            const names = [];
            const push = (value) => {
                const text = normalizeEntity(value);
                if (text && text.length <= 80) names.push(text);
            };
            for (const list of [options.entityRefs, options.knownEntityNames, options.focusNames]) {
                if (Array.isArray(list)) list.forEach(item => push(typeof item === 'string' ? item : (item?.name || item?.label || item?.ref)));
            }
            try {
                if (typeof EntityManager !== 'undefined' && EntityManager?.getEntityCache) {
                    Array.from(EntityManager.getEntityCache().values()).forEach(entity => {
                        push(entity?.name);
                        if (Array.isArray(entity?.aliases)) entity.aliases.forEach(push);
                    });
                }
            } catch (_) {}
            return dedupeTextArray(names).sort((a, b) => b.length - a.length).slice(0, 96);
        };
        const entitiesInText = (text = '', knownNames = []) => {
            const lower = String(text || '').toLowerCase();
            return dedupeTextArray((Array.isArray(knownNames) ? knownNames : [])
                .filter(name => name && lower.includes(String(name).toLowerCase())))
                .slice(0, 8);
        };
        const inferSubject = (text = '', entities = [], source = '') => {
            if (entities.length > 0) return entities[0];
            const raw = String(text || '').trim();
            if (source === 'user' && (/^(?:나|내가|나는|난|내|저|제가|저는)(?:\s|은|는|가|를|의|$)/i.test(raw) || /(?:^|[\s"“‘(])(?:i|i'm|i am|my)(?:\s|$)/i.test(raw))) return 'User';
            return '';
        };
        const inferFactSlot = (text = '') => {
            const raw = String(text || '');
            if (/(본명|진짜\s*이름|real\s+name)/i.test(raw)) return 'real_name';
            if (/(정체|true\s+identity|identity)/i.test(raw)) return 'identity';
            if (/(생일|birthday)/i.test(raw)) return 'birthday';
            if (/(나이|age\s+is)/i.test(raw)) return 'age';
            if (/(직업|works?\s+as|occupation)/i.test(raw)) return 'occupation';
            if (/(소속|member\s+of|belongs?\s+to)/i.test(raw)) return 'affiliation';
            if (/(가족|부모|아버지|어머니|형제|자매|family|father|mother|parent|sibling|brother|sister)/i.test(raw)) return 'family';
            if (/(고향|출신|hometown|from\s+[A-Z])/i.test(raw)) return 'origin';
            if (/(거주|사는\s*곳|lives?\s+in)/i.test(raw)) return 'residence';
            if (/(종족|species)/i.test(raw)) return 'species';
            if (/(능력|ability)/i.test(raw)) return 'ability';
            if (/(약점|weakness)/i.test(raw)) return 'weakness';
            if (/(비밀|secret)/i.test(raw)) return 'secret';
            return 'canon_fact';
        };
        const inferPreferenceKind = (text = '') => {
            const raw = String(text || '');
            if (/(알레르기|allergic|못\s*먹|먹지\s*못|cannot eat|can't eat)/i.test(raw)) return 'medical_or_food_boundary';
            if (/(하지\s*마|지\s*마|원하지\s*않|경계선|boundary|do not|don't\s+want)/i.test(raw)) return 'boundary';
            if (/(두려워|무서워|afraid of|fears?)/i.test(raw)) return 'fear';
            if (/(싫어|좋아하지\s*않|더\s*이상\s*좋아하지|dislikes?|hates?|don['’]?t\s+like|doesn['’]?t\s+like|no\s+longer\s+likes?)/i.test(raw)) return 'dislike';
            return 'preference';
        };
        const inferPreferenceTopic = (text = '') => {
            const raw = String(text || '').replace(/\s+/g, ' ').trim();
            if (!raw) return '';
            const patterns = [
                /(?:나는|난|내가|저는|전|제가|[가-힣A-Za-z0-9 _-]{1,40}(?:은|는|이|가))?\s*["“‘']?(.{1,90}?)["”’']?(?:을|를|이|가|은|는)?\s*(?:정말\s*|아주\s*|이제\s*|더\s*이상\s*)?(?:좋아(?:해|한다|하지\s*않)|싫어(?:해|한다)?|선호(?:해|한다)?|두려워(?:해|한다)?|무서워(?:해|한다)?|꺼려(?:해|한다)?|불편해|편안해|못\s*먹|먹지\s*못)/i,
                /([가-힣A-Za-z0-9 _-]{1,90}?)\s*(?:에|에겐|에는)?\s*알레르기/i,
                /(?:like|love|hate|dislike|prefer|fear|afraid\s+of|allergic\s+to|cannot\s+eat|can['’]?t\s+eat)\s+(.{1,90}?)(?:[.!?]|$)/i
            ];
            for (const pattern of patterns) {
                const match = raw.match(pattern);
                const topic = String(match?.[1] || '')
                    .replace(/^(?:이제|앞으로|요즘|현재|더\s*이상|now|currently|from\s+now\s+on|no\s+longer)\s+/i, '')
                    .replace(/^[\s"“”‘’']+|[\s"“”‘’',.;:!?]+$/g, '')
                    .trim();
                if (topic && topic.length >= 2) return clip(topic, 140);
            }
            const fallback = raw
                .replace(/^(?:나는|난|내가|저는|전|제가|i|we|he|she|they)\s+/i, '')
                .replace(/(?:좋아(?:해|한다|하지\s*않)|싫어(?:해|한다)?|선호(?:해|한다)?|두려워(?:해|한다)?|무서워(?:해|한다)?|꺼려(?:해|한다)?|불편해|편안해|알레르기(?:가\s*있어|가\s*있다)?|못\s*먹(?:어|는다)?|먹지\s*못(?:해|한다)?|likes?|loves?|hates?|dislikes?|prefers?|afraid\s+of|allergic\s+to|cannot\s+eat|can['’]?t\s+eat).*$/i, '')
                .replace(/(?:을|를|이|가|은|는)$/u, '')
                .replace(/^[\s"“”‘’']+|[\s"“”‘’',.;:!?]+$/g, '')
                .trim();
            return fallback.length >= 2 ? clip(fallback, 140) : clip(raw, 140);
        };
        const inferStateDomain = (text = '') => {
            const raw = String(text || '');
            if (/(다쳤|부상|상처|골절|병원|입원|의식|죽었|사망|임신|injured|wounded|hospital|unconscious|died|dead|pregnant)/i.test(raw)) return 'physical';
            if (/(도착|떠났|귀환|이사|전학|arrived|left|departed|returned|moved|transferred)/i.test(raw)) return 'location';
            if (/(해고|승진|퇴학|졸업|합류|탈퇴|fired|promoted|expelled|graduated|joined)/i.test(raw)) return 'role';
            if (/(기억|알게|깨달|발견|learned|realized|discovered|memory)/i.test(raw)) return 'knowledge';
            if (/(얻었|잃었|받았|훔쳤|found|received|lost|stole)/i.test(raw)) return 'possession';
            return 'state';
        };
        const inferStateSlot = (text = '') => {
            const raw = String(text || '');
            if (/(죽었|사망|살해|died|dead|killed)/i.test(raw)) return 'life_status';
            if (/(임신|출산|pregnant|gave\s+birth)/i.test(raw)) return 'pregnancy';
            if (/(다쳤|부상|상처|골절|병원|입원|의식|injured|wounded|hospital|unconscious)/i.test(raw)) return 'health_or_injury';
            if (/(실종|missing)/i.test(raw)) return 'missing_status';
            if (/(체포|구금|arrested|detained)/i.test(raw)) return 'custody_status';
            if (/(해고|승진|fired|promoted)/i.test(raw)) return 'occupation_status';
            if (/(퇴학|졸업|전학|expelled|graduated|transferred)/i.test(raw)) return 'school_status';
            if (/(합류|탈퇴|joined|left\s+(?:the\s+)?(?:group|team|guild|party|organization|company))/i.test(raw)) return 'affiliation_status';
            if (/(이사|떠났|도착|귀환|moved\s+to|departed|arrived|returned)/i.test(raw)) return 'location';
            if (/(변신|transformed)/i.test(raw)) return 'form';
            if (/(기억(?:을)?\s*잃|lost\s+(?:his|her|their)?\s*memory)/i.test(raw)) return 'memory_status';
            return inferStateDomain(raw);
        };
        const inferRelationAxis = (text = '') => {
            const raw = String(text || '');
            if (/(사랑|고백|연인|키스|결혼|애정|love|lover|kiss|married|affection)/i.test(raw)) return 'affection';
            if (/(신뢰|믿|trust)/i.test(raw)) return 'trust';
            if (/(배신|적대|증오|betray|hostile|hate)/i.test(raw)) return 'hostility';
            if (/(두려|공포|fear)/i.test(raw)) return 'fear';
            if (/(충성|동맹|loyal|alliance)/i.test(raw)) return 'loyalty';
            if (/(가족|친구|연인|약혼|결혼|family|friend|dating|engaged|married)/i.test(raw)) return 'status';
            return 'relationship';
        };
        const inferDirection = (text = '') => {
            const raw = String(text || '');
            if (/(배신|이별|절교|거절|불신|멀어|betray|breakup|broke up|rejected|distrust|hostile)/i.test(raw)) return 'decrease';
            if (/(고백|사귀|연인|키스|결혼|약혼|화해|용서|신뢰|동맹|confessed|dating|lover|kiss|married|engaged|reconciled|forgave|trusted|alliance)/i.test(raw)) return 'increase';
            return 'shift';
        };
        const makeId = (category = 'item', text = '', turn = 0) => `rp_${category}_${TokenizerEngine.simpleHash(`${category}|${normalizeText(text)}|${Number(turn || 0)}`)}`;
        const itemText = (value = null) => {
            if (typeof value === 'string') return clip(value, 420);
            if (!value || typeof value !== 'object') return '';
            return clip(value.text || value.summary || value.fact || value.preference || value.promise || value.commitment || value.change || value.delta || value.label || value.value || '', 420);
        };
        const ITEM_VERSION_SCALAR_KEYS = Object.freeze([
            'text', 'summary', 'value', 'before', 'after', 'status', 'resolution', 'due',
            'subject', 'owner', 'target', 'entity', 'slot', 'kind', 'topic', 'axis',
            'direction', 'domain', 'type', 'visibility', 'confidence', 'importance',
            'durability', 'source', 'location', 'time', 'emotionalTone'
        ]);
        const ITEM_VERSION_ARRAY_KEYS = Object.freeze(['entities', 'pair', 'knownBy', 'unknownTo', 'resolutionCriteria', 'consequences']);
        const normalizeItemVersion = (raw = null, fallbackTurn = 0) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
            const turn = Math.max(0, Number(raw.turn || raw.sourceTurn || raw.lastTurn || fallbackTurn || 0) || 0);
            if (!turn) return null;
            const version = { turn };
            for (const key of ITEM_VERSION_SCALAR_KEYS) {
                if (raw[key] === undefined || raw[key] === null || raw[key] === '') continue;
                if (key === 'confidence') version[key] = clampConfidence(raw[key]);
                else if (key === 'importance') version[key] = clampImportance(raw[key]);
                else if (key === 'durability') version[key] = normalizeDurability(raw[key], 'medium');
                else if (key === 'status') version[key] = normalizeStatus(raw[key], 'active');
                else if (key === 'visibility') version[key] = normalizeVisibility(raw[key], raw.text || '');
                else version[key] = clip(raw[key], key === 'text' || key === 'summary' ? 420 : 220);
            }
            for (const key of ITEM_VERSION_ARRAY_KEYS) {
                if (!Array.isArray(raw[key])) continue;
                version[key] = key === 'entities' || key === 'pair' || key === 'knownBy' || key === 'unknownTo'
                    ? uniqueStrings(raw[key], key === 'pair' ? 2 : 10)
                    : dedupeTextArray(raw[key].map(value => clip(value, 160)).filter(Boolean)).slice(0, 8);
            }
            return version;
        };
        const snapshotItemVersion = (item = null, fallbackTurn = 0) => {
            if (!item || typeof item !== 'object') return null;
            return normalizeItemVersion({ ...item, turn: item.lastTurn || item.sourceTurn || fallbackTurn }, fallbackTurn);
        };
        const itemVersionFingerprint = (version = null) => {
            if (!version) return '';
            return `${Number(version.turn || 0)}|${normalizeText([
                version.text, version.summary, version.value, version.after, version.status,
                version.subject, version.owner, version.target, version.entity, version.slot,
                version.kind, version.topic, version.axis, version.domain, version.type
            ].filter(Boolean).join('|'))}`;
        };
        const mergeItemVersions = (...groups) => {
            const out = [];
            const seen = new Set();
            for (const raw of groups.flat()) {
                const version = normalizeItemVersion(raw);
                if (!version) continue;
                const key = itemVersionFingerprint(version);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push(version);
            }
            return out.sort((a, b) => Number(a.turn || 0) - Number(b.turn || 0)).slice(-8);
        };
        const itemMaterialSignature = (item = null) => normalizeText([
            item?.text, item?.summary, item?.value, item?.before, item?.after,
            item?.status, item?.resolution, item?.due, item?.subject, item?.owner,
            item?.target, item?.entity, item?.slot, item?.kind, item?.topic,
            item?.axis, item?.direction, item?.domain, item?.type, item?.visibility,
            ...(Array.isArray(item?.pair) ? item.pair : [])
        ].filter(Boolean).join('|'));
        const applyItemVersion = (item = null, version = null) => {
            const next = { ...(item || {}) };
            if (!version) return next;
            for (const key of ITEM_VERSION_SCALAR_KEYS) {
                if (version[key] !== undefined) next[key] = version[key];
            }
            for (const key of ITEM_VERSION_ARRAY_KEYS) {
                if (Array.isArray(version[key])) next[key] = [...version[key]];
            }
            return next;
        };
        const normalizeItem = (category = '', raw = null, context = {}) => {
            const text = itemText(raw);
            if (!text) return null;
            const sourceTurn = Math.max(0, Number(raw?.sourceTurn || raw?.turn || context.turn || 0) || 0);
            const entities = uniqueStrings([
                ...(Array.isArray(raw?.entities) ? raw.entities : []),
                ...(Array.isArray(raw?.pair) ? raw.pair : []),
                raw?.subject, raw?.entity, raw?.owner, raw?.target,
                ...(Array.isArray(context.entityRefs) ? context.entityRefs.filter(name => String(text).toLowerCase().includes(String(name).toLowerCase())) : [])
            ], 8);
            const subject = normalizeEntity(raw?.subject || raw?.entity || raw?.owner || entities[0] || '');
            const knownBy = uniqueStrings(raw?.knownBy || raw?.visibleTo || [], 10);
            const unknownTo = uniqueStrings(raw?.unknownTo || raw?.hiddenFrom || [], 10);
            const visibility = normalizeVisibility(raw?.visibility, text);
            const durability = normalizeDurability(raw?.durability, durabilityFromText(text, category));
            const status = normalizeStatus(raw?.status, categoryDefaultStatus(category));
            const base = {
                id: String(raw?.id || makeId(category, text, sourceTurn)).trim(),
                text,
                entities,
                subject,
                visibility,
                knownBy,
                unknownTo,
                confidence: clampConfidence(raw?.confidence, context.confidence ?? 0.72),
                importance: clampImportance(raw?.importance, context.importance ?? 6),
                durability,
                status,
                firstTurn: Math.max(0, Number(raw?.firstTurn || sourceTurn || 0) || 0),
                lastTurn: Math.max(0, Number(raw?.lastTurn || sourceTurn || 0) || 0),
                sourceTurns: dedupeTextArray([
                    ...(Array.isArray(raw?.sourceTurns) ? raw.sourceTurns : []),
                    sourceTurn > 0 ? String(sourceTurn) : ''
                ].filter(Boolean)).map(Number).filter(Number.isFinite).slice(-12),
                reinforcement: Math.max(1, Number(raw?.reinforcement || 1) || 1),
                source: clip(raw?.source || context.source || 'turn', 60)
            };
            if (category === 'stableFacts') {
                base.slot = clip(raw?.slot || inferFactSlot(text), 80);
                base.value = clip(raw?.value || text, 260);
            } else if (category === 'preferences') {
                base.kind = clip(raw?.kind || inferPreferenceKind(text), 80);
                base.topic = clip(raw?.topic || raw?.value || inferPreferenceTopic(text), 140);
            } else if (category === 'commitments') {
                base.owner = normalizeEntity(raw?.owner || subject || entities[0] || '');
                base.target = normalizeEntity(raw?.target || entities.find(name => name !== base.owner) || '');
                base.due = clip(raw?.due || raw?.deadline || '', 120);
                base.resolution = clip(raw?.resolution || '', 220);
            } else if (category === 'openLoops') {
                base.type = clip(raw?.type || 'unresolved_goal', 80);
                base.resolutionCriteria = dedupeTextArray((Array.isArray(raw?.resolutionCriteria) ? raw.resolutionCriteria : [raw?.resolutionCriteria])
                    .map(value => clip(value, 140)).filter(Boolean)).slice(0, 6);
                base.resolution = clip(raw?.resolution || '', 220);
            } else if (category === 'relationshipMilestones') {
                base.pair = uniqueStrings(raw?.pair || entities, 2);
                base.axis = clip(raw?.axis || inferRelationAxis(text), 80);
                base.direction = clip(raw?.direction || inferDirection(text), 40);
            } else if (category === 'stateChanges') {
                base.entity = normalizeEntity(raw?.entity || subject || entities[0] || '');
                base.domain = clip(raw?.domain || inferStateDomain(text), 80);
                base.slot = clip(raw?.slot || inferStateSlot(text), 80);
                base.before = clip(raw?.before || '', 140);
                base.after = clip(raw?.after || raw?.value || text, 180);
            } else if (category === 'callbacks') {
                base.label = clip(raw?.label || text, 100);
                base.kind = clip(raw?.kind || 'callback_anchor', 80);
            } else if (category === 'episodes') {
                base.summary = clip(raw?.summary || text, 420);
                base.location = clip(raw?.location || context.location || '', 120);
                base.time = clip(raw?.time || context.time || '', 100);
                base.emotionalTone = clip(raw?.emotionalTone || raw?.tone || '', 100);
                base.consequences = dedupeTextArray((Array.isArray(raw?.consequences) ? raw.consequences : [raw?.consequences])
                    .map(value => clip(value, 160)).filter(Boolean)).slice(0, 6);
            }
            const versions = mergeItemVersions(Array.isArray(raw?.versions) ? raw.versions : (Array.isArray(raw?.history) ? raw.history : []));
            if (versions.length > 0) base.versions = versions;
            return base;
        };
        const itemFingerprint = (category = '', item = null) => {
            if (!item) return '';
            const slot = item.slot || item.kind || item.axis || item.domain || item.type || '';
            const subject = item.subject || item.owner || item.entity || '';
            return normalizeText(`${category}|${subject}|${slot}|${item.text}`);
        };
        const textSimilarity = (left = '', right = '') => {
            const a = normalizeText(left);
            const b = normalizeText(right);
            if (!a || !b) return 0;
            if (a === b) return 1;
            if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 12) return 0.9;
            const ta = new Set(tokenize(a));
            const tb = new Set(tokenize(b));
            if (!ta.size || !tb.size) return 0;
            let intersection = 0;
            for (const token of ta) if (tb.has(token)) intersection += 1;
            return intersection / Math.max(1, ta.size + tb.size - intersection);
        };
        const entityOverlap = (a = [], b = []) => {
            const left = new Set(uniqueStrings(a, 16).map(normalizeText));
            const right = new Set(uniqueStrings(b, 16).map(normalizeText));
            let count = 0;
            for (const value of left) if (right.has(value)) count += 1;
            return count;
        };
        const sameSlotIdentity = (category = '', a = null, b = null) => {
            if (!a || !b) return false;
            if (category === 'stableFacts') return normalizeText(a.subject) === normalizeText(b.subject) && normalizeText(a.slot) === normalizeText(b.slot) && !!normalizeText(a.subject);
            if (category === 'preferences') {
                const subjectA = normalizeText(a.subject);
                const subjectB = normalizeText(b.subject);
                const topicA = normalizeText(a.topic || inferPreferenceTopic(a.text));
                const topicB = normalizeText(b.topic || inferPreferenceTopic(b.text));
                return subjectA === subjectB && topicA === topicB && !!subjectA && !!topicA;
            }
            if (category === 'stateChanges') return normalizeText(a.entity) === normalizeText(b.entity) && normalizeText(a.slot || a.domain) === normalizeText(b.slot || b.domain) && !!normalizeText(a.entity);
            return false;
        };
        const collectItemRefs = (item = null) => uniqueStrings([
            ...(Array.isArray(item?.entities) ? item.entities : []),
            ...(Array.isArray(item?.pair) ? item.pair : []),
            item?.subject, item?.owner, item?.target, item?.entity
        ], 12);
        const durableAnchorTokens = (category = '', item = null) => {
            let raw = [
                item?.topic, item?.value, item?.after, item?.label,
                item?.text, item?.summary,
                ...(Array.isArray(item?.resolutionCriteria) ? item.resolutionCriteria : [])
            ].filter(Boolean).join(' ');
            if (category === 'commitments') {
                raw = raw.replace(/(?:약속|맹세|서약|반드시|꼭|지켰|이행|완수|어겼|저버|promise|promised|swear|pledge|vow|fulfilled|kept|broken|broke)/gi, ' ');
            } else if (category === 'openLoops') {
                raw = raw.replace(/(?:해야|찾아야|알아내야|확인해야|해결해야|구해야|막아야|미해결|목표|계획|퀘스트|임무|해결했|완료했|need|must|have\s+to|unresolved|goal|plan|quest|mission|resolved|solved|completed|finished)/gi, ' ');
            } else if (category === 'preferences') {
                raw = item?.topic || inferPreferenceTopic(item?.text || '') || raw;
            }
            return new Set(tokenize(raw).filter(token => token.length >= 2));
        };
        const durableAnchorSimilarity = (category = '', left = null, right = null) => {
            const a = durableAnchorTokens(category, left);
            const b = durableAnchorTokens(category, right);
            if (!a.size || !b.size) return 0;
            let intersection = 0;
            for (const token of a) if (b.has(token)) intersection += 1;
            return intersection / Math.max(1, a.size + b.size - intersection);
        };
        const isMatchingItem = (category = '', existing = null, incoming = null) => {
            if (!existing || !incoming) return false;
            if (itemFingerprint(category, existing) === itemFingerprint(category, incoming)) return true;
            if (sameSlotIdentity(category, existing, incoming)) return true;
            const similarity = textSimilarity(existing.text, incoming.text);
            const refsA = collectItemRefs(existing);
            const refsB = collectItemRefs(incoming);
            const overlap = entityOverlap(refsA, refsB);
            const anchorSimilarity = durableAnchorSimilarity(category, existing, incoming);
            if (similarity >= 0.74) return true;
            if (similarity >= 0.54 && overlap > 0) return true;
            if (['commitments', 'openLoops'].includes(category) && overlap > 0 && (similarity >= 0.4 || anchorSimilarity >= 0.28)) return true;
            if (category === 'callbacks' && overlap > 0 && anchorSimilarity >= 0.46) return true;
            return false;
        };
        const findStatusResolutionMatchIndex = (category = '', bucket = [], incoming = null) => {
            if (!['commitments', 'openLoops'].includes(category) || !incoming) return -1;
            const incomingStatus = normalizeStatus(incoming.status, categoryDefaultStatus(category));
            if (!CLOSED_STATUS.has(incomingStatus)) return -1;
            const activeCandidates = (Array.isArray(bucket) ? bucket : [])
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => ACTIVE_STATUS.has(normalizeStatus(item?.status, categoryDefaultStatus(category))));
            if (!activeCandidates.length) return -1;
            const incomingRefs = collectItemRefs(incoming);
            const scored = activeCandidates.map(({ item, index }) => {
                const overlap = entityOverlap(collectItemRefs(item), incomingRefs);
                const ownerMatch = !!normalizeText(item?.owner || item?.subject || item?.entity)
                    && normalizeText(item?.owner || item?.subject || item?.entity) === normalizeText(incoming?.owner || incoming?.subject || incoming?.entity);
                const targetMatch = !!normalizeText(item?.target)
                    && normalizeText(item?.target) === normalizeText(incoming?.target);
                const anchor = durableAnchorSimilarity(category, item, incoming);
                const score = (overlap * 3) + (ownerMatch ? 2 : 0) + (targetMatch ? 2 : 0) + (anchor * 6) + (Number(item?.lastTurn || 0) / 100000);
                return { index, overlap, ownerMatch, targetMatch, anchor, score };
            });
            const participantScoped = incomingRefs.length
                ? scored.filter(item => item.overlap > 0 || item.ownerMatch || item.targetMatch)
                : scored;
            const candidates = participantScoped.length ? participantScoped : scored;
            if (candidates.length === 1) {
                const only = candidates[0];
                if (!incomingRefs.length || only.overlap > 0 || only.ownerMatch || only.targetMatch || only.anchor >= 0.2) return only.index;
            }
            candidates.sort((a, b) => b.score - a.score);
            const top = candidates[0];
            const second = candidates[1];
            if (top && top.anchor >= 0.34 && (!second || top.anchor - second.anchor >= 0.12)) return top.index;
            return -1;
        };
        const mergeItems = (category = '', existing = null, incoming = null) => {
            if (!existing) return incoming;
            if (!incoming) return existing;
            const incomingWins = Number(incoming.lastTurn || 0) >= Number(existing.lastTurn || 0)
                && Number(incoming.confidence || 0) >= Math.max(0.45, Number(existing.confidence || 0) - 0.12);
            const merged = {
                ...existing,
                ...(incomingWins ? incoming : {}),
                id: existing.id || incoming.id,
                text: incomingWins ? incoming.text : existing.text,
                entities: uniqueStrings([...(existing.entities || []), ...(incoming.entities || [])], 8),
                knownBy: uniqueStrings([...(existing.knownBy || []), ...(incoming.knownBy || [])], 10),
                unknownTo: uniqueStrings([...(existing.unknownTo || []), ...(incoming.unknownTo || [])], 10),
                confidence: Math.max(Number(existing.confidence || 0), Number(incoming.confidence || 0)),
                importance: Math.max(Number(existing.importance || 0), Number(incoming.importance || 0)),
                durability: DURABILITY_RANK[incoming.durability] >= DURABILITY_RANK[existing.durability] ? incoming.durability : existing.durability,
                firstTurn: [existing.firstTurn, incoming.firstTurn].map(Number).filter(value => value > 0).sort((a, b) => a - b)[0] || Math.max(Number(existing.firstTurn || 0), Number(incoming.firstTurn || 0)),
                lastTurn: Math.max(Number(existing.lastTurn || 0), Number(incoming.lastTurn || 0)),
                sourceTurns: dedupeTextArray([...(existing.sourceTurns || []), ...(incoming.sourceTurns || [])].map(String)).map(Number).filter(Number.isFinite).slice(-12),
                reinforcement: Math.max(1, Number(existing.reinforcement || 1)) + 1
            };
            const incomingStatus = normalizeStatus(incoming.status, existing.status || categoryDefaultStatus(category));
            if (CLOSED_STATUS.has(incomingStatus) || ACTIVE_STATUS.has(incomingStatus)) merged.status = incomingStatus;
            if (incoming.resolution) merged.resolution = clip(incoming.resolution, 220);
            if (sameSlotIdentity(category, existing, incoming) && normalizeText(existing.value || existing.after || existing.text) !== normalizeText(incoming.value || incoming.after || incoming.text)) {
                merged.previousValues = dedupeTextArray([
                    ...(Array.isArray(existing.previousValues) ? existing.previousValues : []),
                    clip(existing.value || existing.after || existing.text, 220)
                ]).slice(-5);
            }
            if (category === 'openLoops') merged.resolutionCriteria = dedupeTextArray([...(existing.resolutionCriteria || []), ...(incoming.resolutionCriteria || [])]).slice(0, 8);
            if (category === 'relationshipMilestones') merged.pair = uniqueStrings([...(existing.pair || []), ...(incoming.pair || [])], 2);
            const materialChanged = itemMaterialSignature(existing) !== itemMaterialSignature(incoming);
            const versions = materialChanged
                ? mergeItemVersions(
                    existing.versions || [],
                    snapshotItemVersion(existing, existing.lastTurn || existing.firstTurn || 0),
                    incoming.versions || [],
                    snapshotItemVersion(incoming, incoming.lastTurn || incoming.firstTurn || 0)
                )
                : mergeItemVersions(existing.versions || [], incoming.versions || []);
            if (versions.length > 0) merged.versions = versions;
            else delete merged.versions;
            return merged;
        };
        const normalizeCategoryList = (category = '', rawItems = [], context = {}) => {
            const out = [];
            for (const raw of (Array.isArray(rawItems) ? rawItems : [rawItems])) {
                const item = normalizeItem(category, raw, context);
                if (!item) continue;
                const matchIndex = out.findIndex(existing => isMatchingItem(category, existing, item));
                if (matchIndex >= 0) out[matchIndex] = mergeItems(category, out[matchIndex], item);
                else out.push(item);
            }
            return out.slice(0, Math.max(1, Number(context.maxItems || 24) || 24));
        };
        const normalizeTurnMemory = (raw = null, context = {}) => {
            const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
            const aliases = {
                stableFacts: value.stableFacts || value.facts || [],
                preferences: value.preferences || value.boundaries || [],
                commitments: value.commitments || value.promises || [],
                openLoops: value.openLoops || value.openThreads || value.unresolved || [],
                relationshipMilestones: value.relationshipMilestones || value.relationshipDeltas || value.relations || [],
                stateChanges: value.stateChanges || value.states || [],
                callbacks: value.callbacks || value.callbackAnchors || value.mementos || [],
                episodes: value.episodes || value.episode || []
            };
            const normalized = {
                schema: TURN_SCHEMA,
                version: VERSION,
                turn: Math.max(0, Number(value.turn || context.turn || 0) || 0),
                importance: clampImportance(value.importance, context.importance ?? 5),
                durability: normalizeDurability(value.durability, 'medium'),
                protected: value.protected === true,
                retentionReasons: dedupeTextArray((Array.isArray(value.retentionReasons) ? value.retentionReasons : [value.retentionReason])
                    .map(item => clip(item, 100)).filter(Boolean)).slice(0, 8),
                tags: dedupeTextArray((Array.isArray(value.tags) ? value.tags : []).map(item => clip(item, 80)).filter(Boolean)).slice(0, 12),
                source: clip(value.source || context.source || 'turn', 60)
            };
            for (const category of CATEGORY_ORDER) normalized[category] = normalizeCategoryList(category, aliases[category], context);
            const hasSignals = CATEGORY_ORDER.some(category => normalized[category].length > 0);
            if (hasSignals) {
                const allItems = CATEGORY_ORDER.flatMap(category => normalized[category]);
                normalized.importance = Math.max(normalized.importance, ...allItems.map(item => Number(item.importance || 0)));
                normalized.durability = allItems
                    .map(item => item.durability)
                    .sort((a, b) => DURABILITY_RANK[b] - DURABILITY_RANK[a])[0] || normalized.durability;
                normalized.protected = normalized.protected
                    || normalized.durability === 'permanent'
                    || normalized.stableFacts.length > 0
                    || normalized.preferences.some(item => item.kind === 'boundary' || item.kind === 'medical_or_food_boundary')
                    || normalized.commitments.some(item => ACTIVE_STATUS.has(normalizeStatus(item.status)))
                    || normalized.openLoops.some(item => ACTIVE_STATUS.has(normalizeStatus(item.status)))
                    || normalized.relationshipMilestones.some(item => item.durability === 'permanent');
                normalized.retentionReasons = dedupeTextArray([
                    ...normalized.retentionReasons,
                    normalized.stableFacts.length ? 'stable_fact' : '',
                    normalized.preferences.length ? 'preference_or_boundary' : '',
                    normalized.commitments.some(item => ACTIVE_STATUS.has(normalizeStatus(item.status))) ? 'open_commitment' : '',
                    normalized.openLoops.some(item => ACTIVE_STATUS.has(normalizeStatus(item.status))) ? 'open_loop' : '',
                    normalized.relationshipMilestones.length ? 'relationship_milestone' : '',
                    normalized.durability === 'permanent' ? 'permanent_canon' : ''
                ].filter(Boolean)).slice(0, 8);
            }
            return normalized;
        };
        const mergeTurnMemory = (base = null, incoming = null, context = {}) => {
            const left = normalizeTurnMemory(base, context);
            const right = normalizeTurnMemory(incoming, context);
            const merged = {
                ...left,
                turn: Math.max(Number(left.turn || 0), Number(right.turn || 0), Number(context.turn || 0)),
                importance: Math.max(Number(left.importance || 0), Number(right.importance || 0)),
                durability: DURABILITY_RANK[right.durability] >= DURABILITY_RANK[left.durability] ? right.durability : left.durability,
                protected: left.protected === true || right.protected === true,
                retentionReasons: dedupeTextArray([...(left.retentionReasons || []), ...(right.retentionReasons || [])]).slice(0, 10),
                tags: dedupeTextArray([...(left.tags || []), ...(right.tags || [])]).slice(0, 16),
                source: clip(right.source || left.source || context.source || 'turn', 60)
            };
            for (const category of CATEGORY_ORDER) {
                const items = [];
                for (const item of [...(left[category] || []), ...(right[category] || [])]) {
                    const idx = items.findIndex(existing => isMatchingItem(category, existing, item));
                    if (idx >= 0) items[idx] = mergeItems(category, items[idx], item);
                    else items.push(item);
                }
                merged[category] = items.slice(0, 28);
            }
            return normalizeTurnMemory(merged, context);
        };
        const extractHeuristic = (userText = '', aiText = '', options = {}) => {
            const turn = Math.max(0, Number(options.turn || 0) || 0);
            const knownNames = getKnownEntityNames(options);
            const result = normalizeTurnMemory({ turn, importance: 4, durability: 'medium', source: 'heuristic' }, { turn, entityRefs: knownNames, source: 'heuristic' });
            const sourceSentences = [
                ...splitSentences(aiText).map(text => ({ source: 'assistant', text }))
            ].filter(item => item.text && !META_CONTROL_RE.test(item.text));
            const durableSentences = [];
            const add = (category, raw, context = {}) => {
                const item = normalizeItem(category, raw, {
                    turn,
                    entityRefs: knownNames,
                    source: `heuristic:${context.source || 'turn'}`,
                    importance: context.importance || raw?.importance || 6,
                    confidence: context.confidence || raw?.confidence || (context.source === 'user' ? 0.88 : 0.78)
                });
                if (!item) return;
                const idx = result[category].findIndex(existing => isMatchingItem(category, existing, item));
                if (idx >= 0) result[category][idx] = mergeItems(category, result[category][idx], item);
                else result[category].push(item);
                durableSentences.push(item.text);
            };
            for (const { source, text } of sourceSentences.slice(0, 34)) {
                if (TRANSIENT_MOOD_ONLY_RE.test(text)) continue;
                const entities = entitiesInText(text, knownNames);
                const subject = inferSubject(text, entities, source);
                const visibility = normalizeVisibility('', text);
                const knownByMatch = text.match(POV_RE);
                const knownBy = knownByMatch ? uniqueStrings([knownByMatch[1], knownByMatch[2]], 4) : [];
                const shared = { entities, subject, visibility, knownBy, source };
                if (COMMITMENT_RE.test(text)) {
                    const status = COMMITMENT_RESOLVED_RE.test(text) ? 'fulfilled' : (COMMITMENT_BROKEN_RE.test(text) ? 'broken' : 'open');
                    add('commitments', {
                        ...shared,
                        text,
                        owner: subject || entities[0] || (source === 'user' ? 'User' : ''),
                        target: entities.find(name => name !== subject) || '',
                        status,
                        resolution: status === 'open' ? '' : text,
                        importance: /(맹세|다시는|끝까지|평생|forever|never again|always)/i.test(text) ? 9 : 8,
                        durability: /(평생|영원|다시는|forever|always|never again)/i.test(text) ? 'permanent' : 'long'
                    }, { source, importance: 8 });
                }
                const strongPreferenceEvidence = /(취향|선호|최애|알레르기|못\s*먹|먹지\s*못|경계선|금기|평소|항상|원래|favorite|favourite|prefers?|allergic|cannot\s+eat|can['’]?t\s+eat|usually|always|boundary|taboo)/i.test(text);
                const directPreferenceDeclaration = /(?:나는|난|저는|전|i\s+(?:like|love|hate|dislike|prefer|fear)|[가-힣A-Za-z0-9 _-]{1,40}(?:은|는|이|가).{0,60}(?:좋아한다|싫어한다|선호한다|두려워한다|무서워한다))/i.test(text);
                const transientPreferenceContext = /(?:오늘만|이번만|당장은|잠시|순간|그때는|오늘|지금|tonight|today|right\s+now|for\s+now|for\s+a\s+moment|this\s+time)/i.test(text);
                if (PREFERENCE_RE.test(text) && (source === 'user' || strongPreferenceEvidence || (directPreferenceDeclaration && !transientPreferenceContext))) {
                    add('preferences', {
                        ...shared,
                        text,
                        kind: inferPreferenceKind(text),
                        topic: inferPreferenceTopic(text),
                        importance: /(알레르기|못\s*먹|하지\s*마|경계선|allergic|cannot eat|can't eat|boundary|do not)/i.test(text) ? 9 : 7,
                        durability: 'permanent'
                    }, { source, importance: 7 });
                }
                if (STABLE_FACT_RE.test(text) && !/(?:일지도|같다|듯하다|추측|아마|maybe|perhaps|seems?|might|could be)/i.test(text)) {
                    add('stableFacts', {
                        ...shared,
                        text,
                        slot: inferFactSlot(text),
                        value: text,
                        importance: IDENTITY_RE.test(text) ? 9 : 8,
                        durability: 'permanent'
                    }, { source, importance: 8 });
                }
                if (MAJOR_RELATION_RE.test(text)) {
                    const inferredPair = entities.length >= 2
                        ? entities
                        : ((/(두\s*사람|둘은|서로|the two|both of them)/i.test(text) && knownNames.length === 2) ? knownNames : [subject, ...entities]);
                    const pair = uniqueStrings(inferredPair, 2);
                    add('relationshipMilestones', {
                        ...shared,
                        text,
                        pair,
                        axis: inferRelationAxis(text),
                        direction: inferDirection(text),
                        importance: /(결혼|약혼|이별|절교|배신|married|engaged|breakup|betrayed)/i.test(text) ? 10 : 8,
                        durability: IRREVERSIBLE_RE.test(text) ? 'permanent' : 'long'
                    }, { source, importance: 8 });
                }
                if (STATE_CHANGE_RE.test(text)) {
                    add('stateChanges', {
                        ...shared,
                        text,
                        entity: subject || entities[0] || '',
                        domain: inferStateDomain(text),
                        slot: inferStateSlot(text),
                        after: text,
                        importance: IRREVERSIBLE_RE.test(text) ? 9 : 7,
                        durability: IRREVERSIBLE_RE.test(text) ? 'permanent' : 'long'
                    }, { source, importance: 7 });
                }
                if (OPEN_LOOP_RE.test(text) && !LOOP_RESOLVED_RE.test(text)) {
                    add('openLoops', {
                        ...shared,
                        text,
                        type: /(수수께끼|의문|단서|비밀|mystery|clue|secret|find out|figure out)/i.test(text) ? 'mystery' : 'goal',
                        status: 'open',
                        resolutionCriteria: [clip(`Resolve or explicitly close: ${text}`, 140)],
                        importance: 7,
                        durability: 'long'
                    }, { source, importance: 7 });
                } else if (LOOP_RESOLVED_RE.test(text)) {
                    add('openLoops', {
                        ...shared,
                        text,
                        type: 'resolution',
                        status: 'resolved',
                        resolution: text,
                        importance: 6,
                        durability: 'long'
                    }, { source, importance: 6 });
                }
                if (CALLBACK_RE.test(text) && /(주었|건넸|건네|받았|간직|남겼|새겼|기억|약속|중요|상징|gave|handed|received|kept|left|engraved|remember|promise|important|symbol)/i.test(text)) {
                    add('callbacks', {
                        ...shared,
                        text,
                        label: clip(text, 100),
                        importance: 7,
                        durability: 'long'
                    }, { source, importance: 7 });
                }
            }
            const hasSignals = CATEGORY_ORDER.some(category => category !== 'episodes' && result[category].length > 0);
            if (hasSignals) {
                const payloadScene = options.scene && typeof options.scene === 'object' ? options.scene : {};
                const episodeText = clip(dedupeTextArray(durableSentences).slice(0, 3).join(' / '), 420);
                if (episodeText) {
                    result.episodes = normalizeCategoryList('episodes', [{
                        text: episodeText,
                        summary: episodeText,
                        location: payloadScene.location || options.location || '',
                        time: payloadScene.time || options.time || '',
                        entities: knownNames.filter(name => episodeText.toLowerCase().includes(name.toLowerCase())).slice(0, 8),
                        importance: Math.max(6, ...CATEGORY_ORDER.filter(category => category !== 'episodes').flatMap(category => result[category].map(item => Number(item.importance || 0)))),
                        durability: 'long',
                        status: 'active',
                        source: 'heuristic:episode'
                    }], { turn, entityRefs: knownNames, source: 'heuristic:episode' });
                }
            }
            const normalized = normalizeTurnMemory(result, { turn, entityRefs: knownNames, source: 'heuristic' });
            normalized.tags = dedupeTextArray([
                ...normalized.tags,
                normalized.stableFacts.length ? 'canon_fact' : '',
                normalized.preferences.length ? 'preference' : '',
                normalized.commitments.length ? 'commitment' : '',
                normalized.openLoops.length ? 'open_loop' : '',
                normalized.relationshipMilestones.length ? 'relationship_milestone' : '',
                normalized.stateChanges.length ? 'state_change' : '',
                normalized.callbacks.length ? 'callback' : ''
            ].filter(Boolean)).slice(0, 16);
            return normalized;
        };
        const hasSignals = (turnMemory = null) => {
            const normalized = normalizeTurnMemory(turnMemory || {});
            return CATEGORY_ORDER.some(category => normalized[category].length > 0);
        };
        const resolveImportance = (turnMemory = null, fallback = 5) => {
            const normalized = normalizeTurnMemory(turnMemory || {}, { importance: fallback });
            if (!hasSignals(normalized)) return clampImportance(fallback, 5);
            return clampImportance(normalized.importance, fallback);
        };
        const getRetentionPolicy = (turnMemory = null, importance = 5, config = {}) => {
            const normalized = normalizeTurnMemory(turnMemory || {}, { importance });
            const defaultTtl = importance >= Math.max(9, Number(config.threshold || 6) + 2) ? -1 : (importance >= Number(config.threshold || 6) ? 60 : 30);
            if (!hasSignals(normalized)) return { ttl: defaultTtl, protected: false, durability: 'short', reasons: [] };
            const longTtl = Math.max(120, Number(config.rpLongTermLongTtl || 720) || 720);
            const mediumTtl = Math.max(60, Number(config.rpLongTermMediumTtl || 240) || 240);
            let ttl = defaultTtl;
            if (normalized.protected || normalized.durability === 'permanent') ttl = -1;
            else if (normalized.durability === 'long') ttl = longTtl;
            else if (normalized.durability === 'medium') ttl = mediumTtl;
            else ttl = Math.max(defaultTtl, 80);
            return {
                ttl,
                protected: normalized.protected === true || ttl === -1,
                durability: normalized.durability,
                reasons: normalized.retentionReasons || [],
                importance: resolveImportance(normalized, importance)
            };
        };
        const attachToPayload = (payload = null, userText = '', aiText = '', options = {}) => {
            if (!payload || typeof payload !== 'object') return payload;
            const entityRefs = uniqueStrings([
                ...(Array.isArray(options.entityRefs) ? options.entityRefs : []),
                ...(Array.isArray(payload?.participants?.canonicalEntities) ? payload.participants.canonicalEntities : []),
                ...(Array.isArray(payload?.mentionedEntityNames) ? payload.mentionedEntityNames : [])
            ], 24);
            const heuristic = extractHeuristic(userText, aiText, {
                ...options,
                turn: options.turn || payload.turn || payload.source?.turn || 0,
                entityRefs,
                scene: payload.scene || options.scene || {}
            });
            const merged = mergeTurnMemory(payload.rpLongTerm || null, heuristic, {
                turn: options.turn || payload.turn || payload.source?.turn || 0,
                entityRefs,
                source: 'turn_capture'
            });
            const next = { ...payload, rpLongTerm: merged };
            next.importance = Math.max(Number(payload.importance || 0), resolveImportance(merged, Number(payload.importance || 5)));
            next.tags = dedupeTextArray([...(Array.isArray(payload.tags) ? payload.tags : []), ...(merged.tags || [])]).slice(0, 18);
            return next;
        };
        const flattenForSearch = (turnMemory = null) => {
            const normalized = normalizeTurnMemory(turnMemory || {});
            const parts = [
                ...(normalized.tags || []),
                ...(normalized.retentionReasons || [])
            ];
            for (const category of CATEGORY_ORDER) {
                for (const item of normalized[category] || []) {
                    parts.push(category, item.text, item.subject, item.owner, item.target, item.slot, item.value, item.kind, item.topic, item.type, item.axis, item.direction, item.domain, item.before, item.after, item.label, item.location, item.time, item.status);
                    parts.push(...(item.entities || []), ...(item.pair || []), ...(item.knownBy || []), ...(item.resolutionCriteria || []), ...(item.consequences || []));
                }
            }
            return dedupeTextArray(parts.map(value => String(value || '').trim()).filter(Boolean)).join('\n');
        };
        const formatTurnForDisplay = (turnMemory = null, maxChars = 240) => {
            const normalized = normalizeTurnMemory(turnMemory || {});
            const lines = [];
            const add = (label, items, limit = 1) => {
                const texts = (Array.isArray(items) ? items : []).map(item => item?.text || item?.summary).filter(Boolean).slice(0, limit);
                if (texts.length) lines.push(`${label}: ${texts.join(' / ')}`);
            };
            add('Canon', normalized.stableFacts, 1);
            add('Promise', normalized.commitments.filter(item => ACTIVE_STATUS.has(normalizeStatus(item.status))), 1);
            add('Open', normalized.openLoops.filter(item => ACTIVE_STATUS.has(normalizeStatus(item.status))), 1);
            add('Relation', normalized.relationshipMilestones, 1);
            add('State', normalized.stateChanges, 1);
            add('Callback', normalized.callbacks, 1);
            return clip(lines.join(' | '), maxChars);
        };
        const emptyState = () => ({
            schema: SCHEMA,
            version: VERSION,
            revision: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            migratedFromLegacy: false,
            migrationTurnFloor: 0,
            sourceMemoryKeys: [],
            stableFacts: [],
            preferences: [],
            commitments: [],
            openLoops: [],
            relationshipMilestones: [],
            stateChanges: [],
            callbacks: [],
            episodes: []
        });
        const normalizeState = (raw = null) => {
            const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
            const state = {
                ...emptyState(),
                ...value,
                schema: SCHEMA,
                version: VERSION,
                revision: Math.max(0, Number(value.revision || 0) || 0),
                createdAt: Number(value.createdAt || Date.now()) || Date.now(),
                updatedAt: Number(value.updatedAt || Date.now()) || Date.now(),
                migratedFromLegacy: value.migratedFromLegacy === true,
                migrationTurnFloor: Math.max(0, Number(value.migrationTurnFloor || 0) || 0),
                sourceMemoryKeys: dedupeTextArray((Array.isArray(value.sourceMemoryKeys) ? value.sourceMemoryKeys : [])
                    .map(item => String(item || '').trim()).filter(Boolean)).slice(-1600)
            };
            for (const category of CATEGORY_ORDER) state[category] = normalizeCategoryList(category, value[category] || [], { source: 'aggregate', maxItems: CATEGORY_LIMITS[category] || 120 });
            return state;
        };
        const findStateEntryIndex = (lore = []) => (Array.isArray(lore) ? lore : []).findIndex(entry => String(entry?.comment || '').trim() === COMMENT || String(entry?.key || '').trim() === KEY);
        const parseStateEntry = (entry = null) => {
            if (!entry?.content) return null;
            try {
                const parsed = JSON.parse(String(entry.content || ''));
                return parsed && typeof parsed === 'object' ? normalizeState(parsed) : null;
            } catch (_) { return null; }
        };
        const migrateLegacyMemories = (lore = [], state = null, options = {}) => {
            let next = normalizeState(state || {});
            const maxEntries = Math.max(220, Math.min(4000, Number(options.maxEntries || 1200) || 1200));
            const entries = (Array.isArray(lore) ? lore : [])
                .filter(entry => String(entry?.comment || '') === 'lmai_memory')
                .slice(-maxEntries);
            const seenKeys = new Set((next.sourceMemoryKeys || []).map(value => String(value || '').trim()).filter(Boolean));
            let highestTurn = next.migrationTurnFloor || 0;
            for (const entry of entries) {
                const memoryKey = String(entry?.key || '').trim() || `memory_hash:${TokenizerEngine.simpleHash(String(entry?.content || ''))}`;
                if (options.force !== true && seenKeys.has(memoryKey)) continue;
                let payload = null;
                try { payload = CompactMemoryCodec.parsePayloadFromEntry(entry) || null; } catch (_) { payload = null; }
                if (!payload) continue;
                const entryMeta = parseLibraMetaObject(entry.content, {});
                const hybridRow = payload?.hybridRow && typeof payload.hybridRow === 'object' ? payload.hybridRow : {};
                if (
                    entryMeta.rollbackDeleted === true
                    || entryMeta.hiddenFromPrompt === true
                    || entryMeta.rollbackTombstone
                    || hybridRow.hiddenFromPrompt === true
                    || hybridRow.stale === true
                    || String(hybridRow.rollbackState || '').toLowerCase() === 'candidate_deleted'
                ) continue;
                seenKeys.add(memoryKey);
                const turn = Math.max(0, Number(payload.turn || payload.source?.turn || entryMeta.t || 0) || 0);
                highestTurn = Math.max(highestTurn, turn);
                let derived = payload.rpLongTerm ? normalizeTurnMemory(payload.rpLongTerm, { turn, source: 'legacy_migration' }) : null;
                if (!derived || !hasSignals(derived)) {
                    const openThreads = Array.isArray(payload?.continuity?.openThreads) ? payload.continuity.openThreads : [];
                    const relationSignals = [
                        ...(Array.isArray(payload?.continuity?.relationSignals) ? payload.continuity.relationSignals : []),
                        ...(Array.isArray(payload?.relationDeltas) ? payload.relationDeltas.map(item => ({ ...item, text: item?.text || item?.delta || item?.trigger })) : [])
                    ];
                    // Legacy ledger facts are event-centric. Reclassify their text through
                    // the RP continuity extractor instead of promoting every high-scored fact to
                    // permanent canon; otherwise one-off actions become immutable character facts.
                    const legacyEntityRefs = dedupeTextArray([
                        ...(Array.isArray(payload?.participants?.canonicalEntities) ? payload.participants.canonicalEntities : []),
                        ...(Array.isArray(payload?.mentionedEntityNames) ? payload.mentionedEntityNames : []),
                        ...(Array.isArray(payload?.facts) ? payload.facts.flatMap(item => Array.isArray(item?.entities) ? item.entities : []) : [])
                    ].map(item => String(item || '').trim()).filter(Boolean)).slice(0, 16);
                    const highFactTexts = (Array.isArray(payload?.facts) ? payload.facts : [])
                        .filter(item => Number(item?.importance || 0) >= 0.75 && item?.type !== 'user_turn')
                        .map(item => String(item?.text || '').trim())
                        .filter(Boolean)
                        .slice(0, 8);
                    const legacyEvidenceText = dedupeTextArray([
                        ...highFactTexts,
                        Number(payload.importance || 0) >= 7 ? String(payload.summary || '').trim() : ''
                    ].filter(Boolean)).join('\n');
                    const legacyHeuristic = legacyEvidenceText
                        ? extractHeuristic('', legacyEvidenceText, {
                            turn,
                            entityRefs: legacyEntityRefs,
                            source: 'legacy_migration'
                        })
                        : normalizeTurnMemory({ turn, importance: Number(payload.importance || 5) }, {
                            turn,
                            entityRefs: legacyEntityRefs,
                            source: 'legacy_migration'
                        });
                    const explicitLegacySignals = normalizeTurnMemory({
                        turn,
                        importance: Number(payload.importance || 5),
                        openLoops: openThreads.map(item => ({ ...item, status: item?.status || 'open', source: 'legacy_open_thread' })),
                        relationshipMilestones: relationSignals.map(item => ({ ...item, text: item?.text || item?.delta || '', source: 'legacy_relation_signal' })),
                        episodes: Number(payload.importance || 0) >= 8 && payload.summary ? [{
                            text: payload.summary,
                            summary: payload.summary,
                            entities: legacyEntityRefs,
                            importance: payload.importance,
                            durability: 'long',
                            confidence: 0.62,
                            source: 'legacy_high_importance_episode'
                        }] : []
                    }, { turn, entityRefs: legacyEntityRefs, source: 'legacy_migration' });
                    derived = mergeTurnMemory(legacyHeuristic, explicitLegacySignals, {
                        turn,
                        entityRefs: legacyEntityRefs,
                        source: 'legacy_migration'
                    });
                }
                if (hasSignals(derived)) {
                    next = mergeIntoState(next, derived, { turn, source: 'legacy_migration', bumpRevision: false });
                }
            }
            next.migratedFromLegacy = true;
            next.migrationTurnFloor = highestTurn;
            next.sourceMemoryKeys = Array.from(seenKeys).slice(-1600);
            return normalizeState(next);
        };
        const loadState = (lore = [], options = {}) => {
            const index = findStateEntryIndex(lore);
            const parsed = index >= 0 ? parseStateEntry(lore[index]) : null;
            let state = parsed || emptyState();
            if (options.migrate !== false && (!parsed || state.migratedFromLegacy !== true)) state = migrateLegacyMemories(lore, state);
            return normalizeState(state);
        };
        const saveState = (lore = [], state = null) => {
            if (!Array.isArray(lore)) return { changed: false, reason: 'invalid_lore', state: normalizeState(state) };
            const normalized = normalizeState(state || {});
            normalized.updatedAt = Date.now();
            const entry = {
                key: KEY,
                comment: COMMENT,
                content: JSON.stringify(normalized),
                mode: 'constant',
                insertorder: 12,
                alwaysActive: false
            };
            const index = findStateEntryIndex(lore);
            const previous = index >= 0 ? String(lore[index]?.content || '') : '';
            const changed = previous !== entry.content;
            if (index >= 0) lore[index] = { ...lore[index], ...entry };
            else lore.push(entry);
            return { changed, state: normalized, entry };
        };
        const stateItemRank = (item = null) => {
            if (!item) return -Infinity;
            const active = ACTIVE_STATUS.has(normalizeStatus(item.status)) ? 1200 : 0;
            const permanent = DURABILITY_RANK[item.durability] === 3 ? 900 : (DURABILITY_RANK[item.durability] === 2 ? 320 : 0);
            const visibilityPenalty = item.visibility === 'secret' ? -10 : 0;
            return active + permanent + (Number(item.importance || 0) * 40) + (Number(item.confidence || 0) * 30) + (Number(item.reinforcement || 1) * 4) + Math.min(600, Number(item.lastTurn || 0)) + visibilityPenalty;
        };
        const pruneStateCategory = (category = '', items = []) => {
            const limit = CATEGORY_LIMITS[category] || 120;
            return [...(Array.isArray(items) ? items : [])]
                .sort((a, b) => stateItemRank(b) - stateItemRank(a) || Number(b.lastTurn || 0) - Number(a.lastTurn || 0))
                .slice(0, limit)
                .sort((a, b) => Number(a.firstTurn || 0) - Number(b.firstTurn || 0));
        };
        function mergeIntoState(state = null, turnMemory = null, options = {}) {
            const next = normalizeState(state || {});
            const normalized = normalizeTurnMemory(turnMemory || {}, { turn: options.turn || turnMemory?.turn || 0, source: options.source || turnMemory?.source || 'turn' });
            for (const category of CATEGORY_ORDER) {
                const bucket = [...(next[category] || [])];
                for (const incoming of normalized[category] || []) {
                    let idx = bucket.findIndex(existing => isMatchingItem(category, existing, incoming));
                    if (idx < 0) idx = findStatusResolutionMatchIndex(category, bucket, incoming);
                    if (idx >= 0) bucket[idx] = mergeItems(category, bucket[idx], incoming);
                    else bucket.push(incoming);
                }
                next[category] = pruneStateCategory(category, bucket);
            }
            if (options.bumpRevision !== false && hasSignals(normalized)) next.revision = Math.max(0, Number(next.revision || 0)) + 1;
            next.updatedAt = Date.now();
            return next;
        }
        const upsertFromTurn = (lore = [], turnMemory = null, options = {}) => {
            if (!Array.isArray(lore) || !turnMemory) return { changed: false, reason: 'invalid_input' };
            const normalized = normalizeTurnMemory(turnMemory, { turn: options.turn || turnMemory.turn || 0, entityRefs: options.entityRefs || [], source: options.source || 'turn_commit' });
            if (!hasSignals(normalized)) return { changed: false, reason: 'no_durable_signals', turnMemory: normalized };
            const current = loadState(lore, { migrate: options.migrate !== false });
            const next = mergeIntoState(current, normalized, { turn: options.turn || normalized.turn, source: options.source || 'turn_commit' });
            const sourceMemoryKey = String(options.sourceMemoryKey || '').trim();
            if (sourceMemoryKey) next.sourceMemoryKeys = dedupeTextArray([...(next.sourceMemoryKeys || []), sourceMemoryKey]).slice(-1600);
            const saved = saveState(lore, next);
            return { ...saved, turnMemory: normalized };
        };
        const backfillFromMemories = (lore = [], options = {}) => {
            if (!Array.isArray(lore)) return { changed: false, reason: 'invalid_lore', addedMemoryKeys: 0 };
            const existingIndex = findStateEntryIndex(lore);
            const current = loadState(lore, { migrate: false });
            const beforeKeys = new Set((current.sourceMemoryKeys || []).map(value => String(value || '').trim()).filter(Boolean));
            const beforeDigest = JSON.stringify(CATEGORY_ORDER.map(category => current[category] || []));
            const next = migrateLegacyMemories(lore, current, { maxEntries: options.maxEntries || 1200, force: options.force === true });
            const afterKeys = new Set((next.sourceMemoryKeys || []).map(value => String(value || '').trim()).filter(Boolean));
            const addedMemoryKeys = Array.from(afterKeys).filter(key => !beforeKeys.has(key)).length;
            const afterDigest = JSON.stringify(CATEGORY_ORDER.map(category => next[category] || []));
            const contentChanged = beforeDigest !== afterDigest;
            const hasAggregateSignals = CATEGORY_ORDER.some(category => Array.isArray(next[category]) && next[category].length > 0);
            if (!addedMemoryKeys && !contentChanged) return { changed: false, reason: 'up_to_date', addedMemoryKeys: 0, state: current };
            if (!hasAggregateSignals && existingIndex < 0) return { changed: false, reason: 'no_durable_signals', addedMemoryKeys, state: next };
            if (contentChanged) next.revision = Math.max(0, Number(next.revision || 0)) + 1;
            const saved = saveState(lore, next);
            return { ...saved, addedMemoryKeys, contentChanged };
        };
        const rewriteMemoryEntry = (entry = null, payload = null, meta = null) => ({
            ...entry,
            content: `[META:${JSON.stringify(meta || {})}]\n${CompactMemoryCodec.serialize(payload)}\n`
        });
        const enrichCommittedTurn = (lore = [], turn = 0, enrichment = null, options = {}) => {
            if (!Array.isArray(lore)) return { changed: false, reason: 'invalid_lore', changedEntries: [] };
            const targetTurn = Math.max(0, Number(turn || 0) || 0);
            const normalizedIncoming = normalizeTurnMemory(enrichment || {}, {
                turn: targetTurn,
                entityRefs: options.entityRefs || [],
                source: options.source || 'maintenance_llm'
            });
            let targetIndex = -1;
            let targetPayload = null;
            for (let i = lore.length - 1; i >= 0; i--) {
                const entry = lore[i];
                if (String(entry?.comment || '') !== 'lmai_memory') continue;
                let payload = null;
                try { payload = CompactMemoryCodec.parsePayloadFromEntry(entry) || null; } catch (_) { payload = null; }
                if (!payload || String(payload.arcKey || '') === 'world_rule_snapshot') continue;
                const entryTurn = Math.max(0, Number(payload.turn || payload.source?.turn || parseLibraMetaObject(entry.content, {}).t || 0) || 0);
                if (targetTurn > 0 && entryTurn !== targetTurn) continue;
                targetIndex = i;
                targetPayload = payload;
                break;
            }
            if (targetIndex < 0 || !targetPayload) return { changed: false, reason: 'turn_memory_not_found', changedEntries: [] };
            const heuristic = extractHeuristic(options.userText || '', options.aiText || '', {
                turn: targetTurn,
                entityRefs: options.entityRefs || targetPayload?.participants?.canonicalEntities || [],
                scene: targetPayload.scene || {}
            });
            const merged = mergeTurnMemory(targetPayload.rpLongTerm || heuristic, normalizedIncoming, {
                turn: targetTurn,
                entityRefs: options.entityRefs || [],
                source: options.source || 'maintenance_llm'
            });
            const nextPayload = {
                ...targetPayload,
                rpLongTerm: merged,
                importance: Math.max(Number(targetPayload.importance || 0), resolveImportance(merged, Number(targetPayload.importance || 5))),
                tags: dedupeTextArray([...(Array.isArray(targetPayload.tags) ? targetPayload.tags : []), ...(merged.tags || [])]).slice(0, 18)
            };
            const meta = parseLibraMetaObject(lore[targetIndex]?.content || '', {});
            const retention = getRetentionPolicy(merged, nextPayload.importance, options.config || (typeof MemoryEngine !== 'undefined' ? MemoryEngine.CONFIG : {}));
            meta.imp = Math.max(Number(meta.imp || 0), nextPayload.importance);
            meta.ttl = retention.ttl;
            meta.rpRetention = { schema: TURN_SCHEMA, protected: retention.protected, durability: retention.durability, reasons: retention.reasons };
            meta.summary = nextPayload.summary || meta.summary || '';
            try { meta.recallHints = StrengthenedJaccardCore.buildRecallHints(CompactMemoryCodec.buildSearchTextFromPayload(nextPayload), { maxTokens: 12, maxNumbers: 4, maxQuotes: 2 }); } catch (_) {}
            const rewritten = rewriteMemoryEntry(lore[targetIndex], nextPayload, meta);
            const changed = String(rewritten.content || '') !== String(lore[targetIndex]?.content || '');
            if (changed) lore[targetIndex] = rewritten;
            const aggregate = upsertFromTurn(lore, merged, {
                turn: targetTurn,
                entityRefs: options.entityRefs || [],
                source: options.source || 'maintenance_llm',
                sourceMemoryKey: String(lore[targetIndex]?.key || '').trim() || `memory_hash:${TokenizerEngine.simpleHash(String(lore[targetIndex]?.content || ''))}`
            });
            return { changed: changed || aggregate.changed, changedEntries: changed ? [rewritten] : [], aggregate, turnMemory: merged, entry: rewritten };
        };
        const pruneRollbackTurns = (lore = [], turns = [], options = {}) => {
            if (!Array.isArray(lore)) return { changed: false, reason: 'invalid_lore', removed: 0, reverted: 0 };
            const deletedTurns = new Set((Array.isArray(turns) ? turns : [turns])
                .map(value => Math.max(0, Number(value || 0) || 0))
                .filter(Boolean));
            if (!deletedTurns.size) return { changed: false, reason: 'no_turns', removed: 0, reverted: 0 };
            if (findStateEntryIndex(lore) < 0) return { changed: false, reason: 'state_missing', removed: 0, reverted: 0 };
            const state = loadState(lore, { migrate: false });
            let changed = false;
            let removed = 0;
            let reverted = 0;
            let prunedEvidence = 0;
            const touchedCategories = {};
            for (const category of CATEGORY_ORDER) {
                const nextBucket = [];
                let categoryTouched = 0;
                for (const original of (state[category] || [])) {
                    let item = { ...original };
                    const originalSourceTurns = dedupeTextArray((Array.isArray(item.sourceTurns) ? item.sourceTurns : [])
                        .map(String)).map(Number).filter(value => Number.isFinite(value) && value > 0);
                    const originalVersions = mergeItemVersions(item.versions || []);
                    const firstTurn = Math.max(0, Number(item.firstTurn || 0) || 0);
                    const lastTurn = Math.max(0, Number(item.lastTurn || 0) || 0);
                    const evidenceTurns = Array.from(new Set([
                        ...originalSourceTurns,
                        ...originalVersions.map(version => Number(version.turn || 0)),
                        firstTurn,
                        lastTurn
                    ].filter(Boolean)));
                    const survivingTurns = evidenceTurns.filter(turn => !deletedTurns.has(turn));
                    if (evidenceTurns.length > 0 && survivingTurns.length === 0) {
                        removed += 1;
                        changed = true;
                        categoryTouched += 1;
                        continue;
                    }

                    const remainingVersions = originalVersions.filter(version => !deletedTurns.has(Number(version.turn || 0)));
                    const removedVersionCount = originalVersions.length - remainingVersions.length;
                    if (removedVersionCount > 0) {
                        prunedEvidence += removedVersionCount;
                        changed = true;
                        categoryTouched += 1;
                    }
                    const currentVersionTurn = lastTurn;
                    if (deletedTurns.has(currentVersionTurn) && remainingVersions.length > 0) {
                        const latestVersion = remainingVersions[remainingVersions.length - 1];
                        item = applyItemVersion(item, latestVersion);
                        reverted += 1;
                        changed = true;
                        categoryTouched += 1;
                    }

                    const remainingSourceTurns = originalSourceTurns.filter(turn => !deletedTurns.has(turn));
                    if (remainingSourceTurns.length !== originalSourceTurns.length) {
                        prunedEvidence += originalSourceTurns.length - remainingSourceTurns.length;
                        changed = true;
                        categoryTouched += 1;
                    }
                    const canonicalTurns = Array.from(new Set([
                        ...remainingSourceTurns,
                        ...remainingVersions.map(version => Number(version.turn || 0)),
                        ...survivingTurns
                    ].filter(Boolean))).sort((a, b) => a - b);
                    if (canonicalTurns.length > 0) {
                        item.firstTurn = canonicalTurns[0];
                        item.lastTurn = canonicalTurns[canonicalTurns.length - 1];
                        item.sourceTurns = canonicalTurns.slice(-12);
                        item.reinforcement = Math.max(1, Math.min(Number(item.reinforcement || 1), canonicalTurns.length));
                    } else {
                        item.sourceTurns = [];
                    }
                    if (remainingVersions.length > 0) item.versions = remainingVersions;
                    else delete item.versions;
                    nextBucket.push(item);
                }
                state[category] = pruneStateCategory(category, nextBucket);
                if (categoryTouched > 0) touchedCategories[category] = categoryTouched;
            }
            if (!changed) return { changed: false, reason: 'no_matching_evidence', removed: 0, reverted: 0, prunedEvidence: 0, state };
            state.revision = Math.max(0, Number(state.revision || 0)) + 1;
            state.rollbackAudit = Array.isArray(state.rollbackAudit) ? state.rollbackAudit : [];
            state.rollbackAudit.push({
                ts: Date.now(),
                reason: clip(options.reason || 'rollback-delete-candidate', 120),
                turns: Array.from(deletedTurns).sort((a, b) => a - b).slice(0, 80),
                removed,
                reverted,
                prunedEvidence,
                touchedCategories
            });
            state.rollbackAudit = state.rollbackAudit.slice(-16);
            const saved = saveState(lore, state);
            return { ...saved, changed: true, removed, reverted, prunedEvidence, touchedCategories };
        };
        const entryRetentionRank = (entry = null) => {
            let payload = null;
            try { payload = CompactMemoryCodec.parsePayloadFromEntry(entry) || null; } catch (_) { payload = null; }
            const rp = payload?.rpLongTerm;
            if (!rp || !hasSignals(rp)) return 0;
            const normalized = normalizeTurnMemory(rp);
            if (normalized.protected || normalized.durability === 'permanent') return 3;
            if (normalized.commitments.some(item => ACTIVE_STATUS.has(normalizeStatus(item.status))) || normalized.openLoops.some(item => ACTIVE_STATUS.has(normalizeStatus(item.status)))) return 3;
            if (normalized.durability === 'long') return 2;
            return 1;
        };
        const isEntryProtected = (entry = null) => entryRetentionRank(entry) >= 3;
        const itemVisibleForMainPrompt = (item = null, focusNames = []) => {
            if (!item) return false;
            if (item.visibility === 'secret') return false;
            if (item.visibility !== 'pov') return true;
            const allowed = new Set(['user', 'main_request', ...uniqueStrings(focusNames, 16)].map(normalizeText));
            return (item.knownBy || []).some(name => allowed.has(normalizeText(name)));
        };
        const queryScoreItem = (item = null, query = '', focusNames = [], currentTurn = 0) => {
            if (!item) return -Infinity;
            const q = normalizeText(query);
            const qTokens = new Set(tokenize(q));
            const text = normalizeText([item.text, item.subject, item.owner, item.target, item.slot, item.kind, item.axis, item.domain, ...(item.entities || []), ...(item.pair || [])].filter(Boolean).join(' '));
            const tTokens = new Set(tokenize(text));
            let overlap = 0;
            for (const token of qTokens) if (tTokens.has(token)) overlap += 1;
            const focusHits = uniqueStrings(focusNames, 16).filter(name => text.includes(normalizeText(name))).length;
            const active = ACTIVE_STATUS.has(normalizeStatus(item.status)) ? 28 : 0;
            const permanent = item.durability === 'permanent' ? 12 : (item.durability === 'long' ? 6 : 0);
            const recency = currentTurn > 0 && Number(item.lastTurn || 0) > 0 ? Math.max(0, 8 - Math.max(0, currentTurn - Number(item.lastTurn || 0)) / 12) : 0;
            return (overlap * 4.5) + (focusHits * 8) + active + permanent + (Number(item.importance || 0) * 1.6) + (Number(item.confidence || 0) * 3) + recency;
        };
        const formatForPrompt = (lore = [], options = {}) => {
            if (!Array.isArray(lore)) return '';
            const state = loadState(lore, { migrate: true });
            const query = String(options.query || '').trim();
            const focusNames = uniqueStrings(options.focusNames || [], 16);
            const maxChars = Math.max(700, Math.min(8000, Number(options.maxChars || 2600) || 2600));
            const currentTurn = Math.max(0, Number(options.currentTurn || (typeof MemoryEngine !== 'undefined' ? MemoryEngine.getCurrentTurn?.() : 0) || 0) || 0);
            const categoryLabels = {
                stableFacts: 'Stable Canon Facts / 고정 사실',
                preferences: 'Preferences & Boundaries / 취향·경계',
                commitments: 'Active Commitments / 약속',
                openLoops: 'Open Threads / 미해결 과제',
                relationshipMilestones: 'Relationship Milestones / 관계 이정표',
                stateChanges: 'Durable State Changes / 지속 상태 변화',
                callbacks: 'Callback Anchors / 회수할 상징',
                episodes: 'Key Episodes / 핵심 에피소드'
            };
            const perCategoryLimits = { stableFacts: 4, preferences: 3, commitments: 4, openLoops: 4, relationshipMilestones: 4, stateChanges: 3, callbacks: 3, episodes: 2 };
            const lines = [
                '[RP Long-Term Continuity / RP 장기 연속성]',
                'Use these consolidated continuity records as durable reference data. The latest explicit user turn and manual lorebook corrections override them.',
                'Do not reveal hidden or POV-restricted facts merely because they exist. Preserve unresolved promises, goals, relationship consequences, and stable preferences until explicitly changed or resolved.'
            ];
            for (const category of CATEGORY_ORDER) {
                const selected = (state[category] || [])
                    .filter(item => itemVisibleForMainPrompt(item, focusNames))
                    .filter(item => {
                        if (category === 'commitments' || category === 'openLoops') return !CLOSED_STATUS.has(normalizeStatus(item.status)) || queryScoreItem(item, query, focusNames, currentTurn) >= 20;
                        return true;
                    })
                    .map(item => ({ item, score: queryScoreItem(item, query, focusNames, currentTurn) }))
                    .sort((a, b) => b.score - a.score || Number(b.item.lastTurn || 0) - Number(a.item.lastTurn || 0))
                    .slice(0, perCategoryLimits[category] || 3)
                    .map(({ item }) => item);
                if (!selected.length) continue;
                lines.push(`\n[${categoryLabels[category]}]`);
                for (const item of selected) {
                    const refs = uniqueStrings(item.pair?.length ? item.pair : item.entities, 4);
                    const status = (category === 'commitments' || category === 'openLoops') ? ` status=${normalizeStatus(item.status)}` : '';
                    const turnLabel = Number(item.lastTurn || 0) > 0 ? ` turn=${Number(item.lastTurn)}` : '';
                    const refLabel = refs.length ? ` (${refs.join(' ↔ ')})` : '';
                    lines.push(`- ${clip(item.text || item.summary || '', 360)}${refLabel}${status}${turnLabel}`);
                }
            }
            if (lines.length <= 3) return '';
            let text = lines.join('\n');
            try {
                if (typeof SecretKnowledgeCore !== 'undefined' && SecretKnowledgeCore?.redactForViewer) {
                    text = SecretKnowledgeCore.redactForViewer(text, 'main_request');
                }
            } catch (_) {}
            return truncateForLLM(text, maxChars, '\n...[RP LONG-TERM CONTINUITY TRUNCATED]...\n');
        };
        const renameEntityReferences = (lore = [], oldName = '', newName = '') => {
            if (!Array.isArray(lore)) return { changed: false };
            const oldKey = normalizeText(oldName);
            const replacement = normalizeEntity(newName);
            if (!oldKey || !replacement) return { changed: false };
            const state = loadState(lore, { migrate: false });
            let changed = false;
            const replace = (value = '') => normalizeText(value) === oldKey ? replacement : String(value || '').trim();
            for (const category of CATEGORY_ORDER) {
                state[category] = (state[category] || []).map(item => {
                    const next = { ...item };
                    const scalarKeys = ['subject', 'owner', 'target', 'entity'];
                    for (const key of scalarKeys) {
                        if (typeof next[key] === 'string') {
                            const value = replace(next[key]);
                            if (value !== next[key]) changed = true;
                            next[key] = value;
                        }
                    }
                    for (const key of ['entities', 'pair', 'knownBy', 'unknownTo']) {
                        if (!Array.isArray(next[key])) continue;
                        const values = uniqueStrings(next[key].map(replace), key === 'pair' ? 2 : 12);
                        if (JSON.stringify(values) !== JSON.stringify(next[key])) changed = true;
                        next[key] = values;
                    }
                    return next;
                });
            }
            if (!changed) return { changed: false, state };
            state.revision = Number(state.revision || 0) + 1;
            return { ...saveState(lore, state), changed: true };
        };
        return Object.freeze({
            COMMENT,
            KEY,
            SCHEMA,
            TURN_SCHEMA,
            normalizeTurnMemory,
            mergeTurnMemory,
            extractHeuristic,
            attachToPayload,
            flattenForSearch,
            formatTurnForDisplay,
            hasSignals,
            resolveImportance,
            getRetentionPolicy,
            loadState,
            saveState,
            upsertFromTurn,
            backfillFromMemories,
            enrichCommittedTurn,
            pruneRollbackTurns,
            entryRetentionRank,
            isEntryProtected,
            formatForPrompt,
            renameEntityReferences
        });
    })();

    const AnalysisMemoryHintBridge = (() => {
        const MAX_HINTS_DEFAULT = 5;
        const parseMeta = (entry = null) => {
            const raw = String(entry?.content || entry || '');
            return parseLibraMetaObject(raw, { t: 0, imp: 5 });
        };
        const tokenize = (value = '') => {
            const raw = String(value || '').normalize('NFKC').toLowerCase();
            const tokens = raw.match(/[가-힣A-Za-z0-9]{2,}/g) || [];
            const blocked = new Set(['사용자','응답','대화','장면','현재','기억','메모리','정보','요약','후보','분석','데이터','관계','세계관','내러티브','그리고','하지만','그러나','그녀','그는','그때','정말','아무']);
            return new Set(tokens.filter(token => token.length >= 2 && !blocked.has(token)).slice(0, 160));
        };
        const setOverlapScore = (a, b) => {
            if (!a || !b || a.size === 0 || b.size === 0) return 0;
            let count = 0;
            for (const token of a) if (b.has(token)) count += 1;
            return count;
        };
        const getEntityNamesFromRuntime = () => {
            const names = [];
            const push = (value) => { const text = String(value || '').trim(); if (text) names.push(text); };
            try {
                if (typeof EntityManager !== 'undefined' && EntityManager?.getEntityCache) {
                    Array.from(EntityManager.getEntityCache().values()).forEach(entity => {
                        push(entity?.name);
                        if (Array.isArray(entity?.aliases)) entity.aliases.forEach(push);
                    });
                }
            } catch (_) {}
            return dedupeTextArray(names).slice(0, 80);
        };
        const normalizeEntries = (lorebook = []) => {
            try {
                return (typeof LibraLoreConsolidator !== 'undefined' && LibraLoreConsolidator?.unpack)
                    ? LibraLoreConsolidator.unpack(lorebook)
                    : (Array.isArray(lorebook) ? lorebook : []);
            } catch (_) { return Array.isArray(lorebook) ? lorebook : []; }
        };
        const build = (lorebook = [], query = '', options = {}) => {
            const limit = Math.max(0, Math.min(12, Number(options.limit || MAX_HINTS_DEFAULT) || MAX_HINTS_DEFAULT));
            if (!limit) return [];
            const source = normalizeEntries(lorebook).filter(entry => String(entry?.comment || '') === 'lmai_memory');
            if (!source.length) return [];
            const queryText = String(query || '').trim();
            const queryTokens = tokenize(queryText);
            const runtimeEntityNames = getEntityNamesFromRuntime();
            const queryLower = queryText.toLowerCase();
            const currentTurn = (() => { try { return Number(MemoryEngine?.getCurrentTurn?.() || MemoryState?.currentTurn || 0); } catch (_) { return 0; } })();
            return source.map((entry) => {
                const meta = parseMeta(entry);
                const payload = CompactMemoryCodec.parsePayloadFromEntry(entry);
                const searchText = CompactMemoryCodec.buildSearchTextFromEntry(entry);
                const displayText = CompactMemoryCodec.buildDisplayTextFromEntry(entry, Number(options.maxChars || 240) || 240);
                const overlap = setOverlapScore(queryTokens, tokenize(searchText));
                const isLedger = CompactMemoryCodec.isLedgerPayload?.(payload);
                const memoryEntityRefs = isLedger
                    ? (Array.isArray(payload?.participants?.canonicalEntities) ? payload.participants.canonicalEntities : []).map(v => String(v || '').trim()).filter(Boolean)
                    : (payload && Array.isArray(payload.mentionedEntityNames) ? payload.mentionedEntityNames.map(v => String(v || '').trim()).filter(Boolean) : []);
                const entityOverlap = runtimeEntityNames.filter(name => {
                    const lower = String(name || '').toLowerCase();
                    return lower && (queryLower.includes(lower) || String(searchText || '').toLowerCase().includes(lower));
                }).length;
                const tagOverlap = payload && Array.isArray(payload.tags)
                    ? payload.tags.filter(tag => queryLower.includes(String(tag || '').toLowerCase())).length
                    : 0;
                const turn = Number(payload?.turn || meta.turn || meta.t || meta.finalizedTurn || meta.turnAnchorTurn || 0);
                const recency = currentTurn && turn ? Math.max(0, 1 - Math.min(1, Math.max(0, currentTurn - turn) / 80)) : 0;
                const importance = Math.max(1, Math.min(10, Number(payload?.importance || meta.imp || 5) || 5));
                const score = (overlap * 1.2) + (entityOverlap * 2.5) + (tagOverlap * 2.0) + (importance * 0.25) + (recency * 1.0);
                return {
                    turn,
                    arcKey: String(payload?.arcKey || meta.arcKey || '').trim(),
                    entityRefs: memoryEntityRefs.slice(0, 8),
                    text: displayText,
                    score: Number(score.toFixed(3))
                };
            })
                .filter(item => item.text && (item.score > 0 || source.length <= limit))
                .sort((a, b) => (b.score - a.score) || (Number(b.turn || 0) - Number(a.turn || 0)))
                .slice(0, limit);
        };
        const format = (hints = [], options = {}) => {
            const list = (Array.isArray(hints) ? hints : []).filter(item => item && String(item.text || '').trim());
            if (!list.length) return '';
            const title = String(options.title || 'Long-Term Compact Memory Hints').trim();
            const policy = String(options.policy || 'Lower-priority compact memory hints. Use only for stable identity, aliases, relationship continuity, recurring motives, and persistent world constraints. Never override the current user turn, current assistant response, hard world rules, or manual corrections. Do not infer volatile current location, current mood, health, or consent from old memory unless the current turn confirms it.').trim();
            return [
                `[${title}]`,
                policy,
                ...list.map((hint) => {
                    const bits = [];
                    if (hint.turn) bits.push(`T${hint.turn}`);
                    if (hint.arcKey) bits.push(`arc=${hint.arcKey}`);
                    if (Array.isArray(hint.entityRefs) && hint.entityRefs.length) bits.push(`entities=${hint.entityRefs.slice(0, 5).join('/')}`);
                    return `- ${bits.length ? `[${bits.join(', ')}] ` : ''}${String(hint.text || '').trim()}`;
                })
            ].join('\n');
        };
        return Object.freeze({ build, format });
    })();



    const CharacterLoreCueIndex = (() => {
        const COMMENT = 'lmai_character_lore_cues';
        const SCHEMA = 'libra.character_lore_cues.v1';
        const VERSION = 1;
        const MAX_CUES = 160;
        const MAX_CHUNK_CHARS = 720;
        const MAX_TEXT_CHARS = 1100;
        const MAX_SEARCH_RESULTS = 16;
        const VECTOR_CACHE_PREFIX = 'charLoreCue';
        const stringify = (value) => {
            if (value == null) return '';
            if (typeof value === 'string') return value.trim();
            if (Array.isArray(value)) return value.map(item => stringify(item)).filter(Boolean).join('\n');
            if (typeof value === 'object') {
                try { return JSON.stringify(value, null, 2); } catch (_) { return String(value || '').trim(); }
            }
            return String(value || '').trim();
        };
        const sanitize = (value = '') => String(value || '')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/\[LBDATA START\][\s\S]*?\[LBDATA END\]/gi, ' ')
            .replace(/<GigaTrans>[\s\S]*?<\/GigaTrans>/gi, ' ')
            .replace(/<GT-CTRL\s*\/?>/gi, ' ')
            .replace(/<GT-SEP\s*\/?>/gi, ' ')
            .replace(/<lb-[^>]*>[\s\S]*?<\/lb-[^>]+>/gi, ' ')
            .replace(/<lb-[^>]*\/?>/gi, ' ')
            .replace(/<[^>]{1,80}>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const clip = (value = '', max = MAX_TEXT_CHARS) => {
            const text = sanitize(value);
            const limit = Math.max(80, Number(max || MAX_TEXT_CHARS) || MAX_TEXT_CHARS);
            return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
        };
        const hash = (value = '') => {
            try { return String(TokenizerEngine.simpleHash(String(value || ''))); } catch (_) {
                let h = 0; const text = String(value || '');
                for (let i = 0; i < text.length; i++) { h = ((h << 5) - h) + text.charCodeAt(i); h |= 0; }
                return String(h);
            }
        };
        const normalizeId = (value = '') => String(value || '')
            .normalize('NFKC')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9가-힣_.:-]+/g, '_')
            .slice(0, 96);
        const tokenize = (value = '') => {
            const raw = String(value || '').normalize('NFKC').toLowerCase();
            const tokens = raw.match(/[가-힣A-Za-z0-9]{2,}/g) || [];
            const blocked = new Set([
                'character','description','personality','scenario','lorebook','entry','section','사용자','응답','대화','장면','현재','기억','정보','세계관','관계','성격','외모','설정','그리고','하지만','그러나','the','and','for','with','this','that','from','into','your','name','roleplay','setting'
            ]);
            return tokens.filter(token => token.length >= 2 && !blocked.has(token)).slice(0, 220);
        };
        const tokenSet = (value = '') => new Set(tokenize(value));
        const overlapScore = (a, b) => {
            if (!a || !b || a.size === 0 || b.size === 0) return 0;
            let count = 0;
            for (const token of a) if (b.has(token)) count += 1;
            return count;
        };
        const classifyBuckets = (label = '', text = '') => {
            const raw = `${label}\n${text}`;
            const out = new Set();
            if (/(외모|성격|말투|나이|성별|남성|여성|남자|여자|학년|직업|배경|appearance|personality|speech|age|sex|gender|occupation|background|profile|identity|alias|persona|캐릭터|인물)/i.test(raw)) out.add('entity');
            if (/(관계|relationship|relation|친구|연인|가족|라이벌|동료|friend|lover|family|sibling|rival|partner|crush)/i.test(raw)) out.add('relation');
            if (/(세계관|시대|장소|학교|도시|국가|마법|레벨|상태창|초자연|기술|장르|조직|법칙|규칙|world|era|location|genre|magic|level|system|technology|organization|rule|academy|school|modern)/i.test(raw)) out.add('world');
            if (/(서사|사건|목표|갈등|떡밥|비밀|전개|arc|plot|story|narrative|goal|conflict|foreshadow|event|tension|motive)/i.test(raw)) out.add('narrative');
            if (/(문체|출력|형식|style|format|output|markdown|response|write|writing|대사체|톤|tone)/i.test(raw)) out.add('style');
            if (!out.size) out.add('entity');
            return Array.from(out);
        };
        const extractEntityRefs = (text = '', known = []) => {
            const raw = String(text || '');
            const refs = [];
            const push = (value) => { const v = String(value || '').trim(); if (v && raw.includes(v)) refs.push(v); };
            (Array.isArray(known) ? known : []).forEach(item => {
                if (typeof item === 'string') push(item);
                else if (item && typeof item === 'object') push(item.name || item.ref || item.id || item.label);
            });
            try {
                if (typeof EntityManager !== 'undefined' && EntityManager?.getEntityCache) {
                    Array.from(EntityManager.getEntityCache().values()).forEach(entity => {
                        push(entity?.name);
                        if (Array.isArray(entity?.aliases)) entity.aliases.forEach(push);
                    });
                }
            } catch (_) {}
            const explicit = raw.match(/[가-힣]{2,5}(?:\([A-Za-z][A-Za-z\s.'-]{1,40}\))?/g) || [];
            const blocked = new Set(['사용자','응답','대화','장면','관계','세계관','내러티브','스토리','학교','교복','소녀','소년','사람','현재','최근','장기','정보','설정','그녀','그는','그리고','그러나','하지만','자신','서로']);
            explicit.forEach(item => {
                const v = String(item || '').trim();
                if (!v || blocked.has(v)) return;
                if (refs.length > 0 && !refs.some(name => v.includes(name) || name.includes(v))) return;
                refs.push(v);
            });
            return dedupeTextArray(refs).slice(0, 12);
        };
        const extractTags = (text = '') => {
            const raw = String(text || '');
            const rules = [
                ['세계관', /세계관|world|setting/i], ['관계', /관계|relationship|relation|friend|lover|가족|친구|연인/],
                ['외모', /외모|appearance|hair|eyes|키|눈|머리/], ['성격', /성격|personality|trait|temper|성향/],
                ['성별', /성별|남성|여성|male|female|sex|gender/], ['직업', /직업|occupation|student|학생|직원|staff/],
                ['말투', /말투|speech|voice|tone|말버릇/], ['장르', /장르|genre/],
                ['규칙', /규칙|rule|forbidden|금지|법칙|system|level|magic/], ['서사', /서사|narrative|arc|plot|conflict|갈등|목표|떡밥/]
            ];
            return rules.filter(([, pattern]) => pattern.test(raw)).map(([tag]) => tag).slice(0, 10);
        };
        const splitChunks = (text = '', maxChars = MAX_CHUNK_CHARS) => {
            const clean = sanitize(text);
            if (!clean) return [];
            const paras = clean.split(/\n{2,}|(?<=다\.|요\.|죠\.|함\.|음\.)\s+/).map(p => p.trim()).filter(Boolean);
            const chunks = [];
            let buf = '';
            for (const para of paras.length ? paras : [clean]) {
                if ((buf + ' ' + para).trim().length > maxChars && buf) {
                    chunks.push(buf.trim());
                    buf = para;
                } else {
                    buf = `${buf} ${para}`.trim();
                }
                while (buf.length > maxChars * 1.4) {
                    chunks.push(buf.slice(0, maxChars).trim());
                    buf = buf.slice(maxChars).trim();
                }
            }
            if (buf) chunks.push(buf.trim());
            return chunks.slice(0, 8);
        };
        const collectNonLibraLoreEntries = (targetChar = null, targetChat = null) => {
            const unpack = (value) => {
                try {
                    if (Array.isArray(value)) return (typeof LibraLoreConsolidator !== 'undefined' && LibraLoreConsolidator?.unpack) ? LibraLoreConsolidator.unpack(value) : value;
                    if (value && typeof value === 'object') {
                        if (Array.isArray(value.entries)) return unpack(value.entries);
                        if (Array.isArray(value.lorebook)) return unpack(value.lorebook);
                        if (Array.isArray(value.lore)) return unpack(value.lore);
                        if (Array.isArray(value.globalLore)) return unpack(value.globalLore);
                    }
                } catch (error) {
                    recordSuppressedRuntimeError('rollback.collect_non_libra_lore_entries', error, {
                        stage: 'rollback-baseline-lore-collect'
                    });
                }
                return [];
            };
            const all = [
                ...unpack(targetChar?.lorebook), ...unpack(targetChar?.lore), ...unpack(targetChar?.characterLore), ...unpack(targetChar?.rawCharacterLore), ...unpack(targetChar?.globalLore),
                ...unpack(targetChar?.data), ...unpack(targetChar?.data?.lorebook), ...unpack(targetChar?.data?.lore), ...unpack(targetChar?.data?.globalLore),
                ...unpack(targetChat?.localLore), ...unpack(targetChat?.lorebook), ...unpack(targetChat?.lore)
            ];
            const seen = new Set();
            return all.filter(entry => {
                if (!entry || typeof entry !== 'object') return false;
                if (String(entry.comment || '').startsWith('lmai_')) return false;
                const sig = `${entry.comment || ''}::${entry.key || ''}::${hash(entry.content || '')}`;
                if (seen.has(sig)) return false;
                seen.add(sig);
                return true;
            }).slice(0, 120);
        };
        const collectSources = (targetChar = null, targetChat = null) => {
            const sources = [];
            const push = (sourceType, sourceId, label, value, priority = 5) => {
                const text = sanitize(stringify(value));
                if (!text) return;
                sources.push({ sourceType, sourceId: String(sourceId || label || sourceType), label: String(label || sourceType), text, priority });
            };
            if (targetChar && typeof targetChar === 'object') {
                push('character_card', 'name', 'Character Name', targetChar.name || targetChar.displayName, 10);
                push('character_card', 'description', 'Character Description', targetChar.description || targetChar.desc || targetChar.detail || targetChar.details, 9);
                push('character_card', 'personality', 'Character Personality', targetChar.personality || targetChar.persona || targetChar.traits, 8);
                push('character_card', 'scenario', 'Scenario', targetChar.scenario || targetChar.situation || targetChar.context, 5);
                push('character_card', 'first_message', 'First Message', targetChar.firstMessage || targetChar.first_message || targetChar.greeting, 4);
                push('character_card', 'creator_notes', 'Creator Notes', targetChar.creatorNotes || targetChar.creator_notes || targetChar.note || targetChar.notes, 4);
                push('character_card', 'default_variables', 'Default Variables', targetChar.defaultVariables, 4);
            }
            collectNonLibraLoreEntries(targetChar, targetChat).forEach((entry, index) => {
                const label = [entry?.key, entry?.secondkey, entry?.comment].map(v => String(v || '').trim()).filter(Boolean).join(' / ') || `Lorebook Entry ${index + 1}`;
                const text = [label, stringify(entry?.content || '')].filter(Boolean).join('\n');
                push('character_lorebook', entry?.id || entry?.key || entry?.comment || `entry_${index + 1}`, `Character Lorebook: ${label}`, text, 6);
            });
            return sources;
        };
        const buildPayload = (targetChar = null, targetChat = null, options = {}) => {
            const known = options.entityRefs || options.knownEntityNames || [];
            const cues = [];
            const seen = new Set();
            collectSources(targetChar, targetChat).forEach((source) => {
                splitChunks(source.text, options.chunkChars || MAX_CHUNK_CHARS).forEach((chunk, index) => {
                    const text = clip(chunk, MAX_TEXT_CHARS);
                    if (!text) return;
                    const sourceHash = hash(`${source.sourceType}\n${source.sourceId}\n${text}`);
                    if (seen.has(sourceHash)) return;
                    seen.add(sourceHash);
                    const buckets = classifyBuckets(source.label, text);
                    const cue = {
                        id: `cue_${hash(`${source.sourceType}:${source.sourceId}:${index}:${sourceHash}`)}`,
                        sourceType: source.sourceType,
                        sourceId: String(source.sourceId || '').trim(),
                        sourceLabel: source.label,
                        chunkIndex: index,
                        buckets,
                        entityRefs: extractEntityRefs(text, known),
                        tags: extractTags(`${source.label}\n${text}`),
                        text,
                        sourceHash,
                        priority: Number(source.priority || 5),
                        updatedAt: Date.now()
                    };
                    cues.push(cue);
                });
            });
            const sorted = cues
                .sort((a, b) => (b.priority - a.priority) || String(a.sourceLabel || '').localeCompare(String(b.sourceLabel || '')))
                .slice(0, Math.max(20, Math.min(MAX_CUES, Number(options.maxCues || MAX_CUES) || MAX_CUES)));
            const sourceHash = hash(sorted.map(cue => `${cue.sourceHash}:${cue.buckets.join(',')}`).join('|'));
            return {
                schema: SCHEMA,
                version: VERSION,
                sourceHash,
                cueCount: sorted.length,
                vectorPolicy: {
                    storage: 'runtime_cache_only',
                    persistedVectors: false,
                    fallback: 'sparse_entity_tag_bucket_search'
                },
                updatedAt: Date.now(),
                cues: sorted
            };
        };
        const buildLoreEntry = (targetChar = null, targetChat = null, options = {}) => {
            const payload = buildPayload(targetChar, targetChat, options);
            if (!payload.cues.length) return { entry: null, payload, changed: false };
            const entry = {
                key: `lmai_character_lore_cues::${payload.sourceHash}`,
                comment: COMMENT,
                content: JSON.stringify(payload),
                mode: 'normal',
                insertorder: 2,
                alwaysActive: false
            };
            return { entry, payload, changed: true };
        };
        const parsePayload = (entryOrContent = null) => {
            try {
                const content = typeof entryOrContent === 'string' ? entryOrContent : entryOrContent?.content;
                const parsed = JSON.parse(String(content || '').trim());
                if (parsed && parsed.schema === SCHEMA && Array.isArray(parsed.cues)) return parsed;
            } catch (_) {}
            return null;
        };
        const findPayloadInLore = (lore = []) => {
            const list = Array.isArray(lore) ? lore : [];
            for (const entry of list) {
                if (String(entry?.comment || '') !== COMMENT) continue;
                const payload = parsePayload(entry);
                if (payload) return payload;
            }
            return null;
        };
        const getPayload = (targetChar = null, targetChat = null, options = {}) => {
            try {
                const localLore = Array.isArray(targetChat?.localLore)
                    ? ((typeof LibraLoreConsolidator !== 'undefined' && LibraLoreConsolidator?.unpack) ? LibraLoreConsolidator.unpack(targetChat.localLore) : targetChat.localLore)
                    : [];
                const existing = findPayloadInLore(localLore);
                if (existing && !options.forceRebuild) return existing;
            } catch (_) {}
            return buildPayload(targetChar, targetChat, options);
        };
        const ensureLocalLoreEntry = (targetChar = null, targetChat = null, options = {}) => {
            if (!targetChat || typeof targetChat !== 'object') return { changed: false, reason: 'missing_chat', cueCount: 0 };
            const currentLore = Array.isArray(targetChat.localLore) ? targetChat.localLore : [];
            const unpacked = (typeof LibraLoreConsolidator !== 'undefined' && LibraLoreConsolidator?.unpack) ? LibraLoreConsolidator.unpack(currentLore) : currentLore.slice();
            const built = buildLoreEntry(targetChar, { ...targetChat, localLore: unpacked.filter(e => String(e?.comment || '') !== COMMENT) }, options);
            const without = unpacked.filter(entry => String(entry?.comment || '') !== COMMENT);
            const existing = unpacked.find(entry => String(entry?.comment || '') === COMMENT);
            const existingHash = parsePayload(existing)?.sourceHash || '';
            const nextHash = built.payload?.sourceHash || '';
            if (!built.entry) {
                if (existing) {
                    targetChat.localLore = without;
                    return { changed: true, reason: 'removed_empty_index', cueCount: 0 };
                }
                return { changed: false, reason: 'empty_index', cueCount: 0 };
            }
            const changed = !existing || existingHash !== nextHash || String(existing?.content || '') !== String(built.entry.content || '');
            if (changed) targetChat.localLore = [...without, built.entry];
            return { changed, reason: changed ? 'updated' : 'unchanged', cueCount: built.payload.cueCount, sourceHash: built.payload.sourceHash };
        };
        const getVectorCache = () => {
            if (!MemoryState.characterLoreEmbeddingCache) MemoryState.characterLoreEmbeddingCache = new Map();
            return MemoryState.characterLoreEmbeddingCache;
        };
        const vectorKey = (cue) => `${VECTOR_CACHE_PREFIX}:${cue?.sourceHash || cue?.id || ''}`;
        const queryVectorKey = (query = '') => `${VECTOR_CACHE_PREFIX}:query:${hash(String(query || '').slice(0, 4000))}`;
        const refreshEmbeddingCache = async (targetChar = null, targetChat = null, options = {}) => {
            const payload = getPayload(targetChar, targetChat, { forceRebuild: true, ...options });
            const cache = getVectorCache();
            const engine = (() => { try { return MemoryEngine?.EmbeddingEngine || null; } catch (_) { return null; } })();
            if (!engine?.getEmbedding) return { ok: false, reason: 'embedding_engine_unavailable', cueCount: payload.cueCount || 0, embedded: 0, cached: 0 };
            let embedded = 0;
            let cached = 0;
            const limit = Math.max(1, Math.min(80, Number(options.limit || payload.cues.length || 0) || payload.cues.length || 0));
            for (const cue of payload.cues.slice(0, limit)) {
                const key = vectorKey(cue);
                const existing = cache.get(key);
                if (existing?.sourceHash === cue.sourceHash && Array.isArray(existing.vector)) { cached += 1; continue; }
                const vector = await engine.getEmbedding(cue.text);
                if (Array.isArray(vector) && vector.length) {
                    cache.set(key, { sourceHash: cue.sourceHash, vector, cueId: cue.id, updatedAt: Date.now() });
                    embedded += 1;
                }
            }
            const scope = String(MemoryState?._activeScopeKey || MemoryState?._activeChatId || 'global');
            MemoryState.characterLoreIndexStatusByScope?.set?.(scope, { ok: true, cueCount: payload.cueCount || 0, embedded, cached, updatedAt: Date.now(), sourceHash: payload.sourceHash || '' });
            return { ok: true, cueCount: payload.cueCount || 0, embedded, cached, sourceHash: payload.sourceHash || '' };
        };
        const cueSparseScore = (cue, queryTokens, queryLower = '', buckets = []) => {
            const text = `${cue.sourceLabel || ''}\n${cue.text || ''}\n${(cue.tags || []).join(' ')}\n${(cue.entityRefs || []).join(' ')}`;
            let score = Number(cue.priority || 5) * 0.25 + overlapScore(queryTokens, tokenSet(text)) * 1.35;
            const requestedBuckets = new Set((Array.isArray(buckets) ? buckets : []).map(v => String(v || '').toLowerCase()).filter(Boolean));
            const cueBuckets = new Set((Array.isArray(cue.buckets) ? cue.buckets : []).map(v => String(v || '').toLowerCase()));
            if (requestedBuckets.size) {
                let hit = false;
                for (const b of requestedBuckets) if (cueBuckets.has(b)) hit = true;
                score += hit ? 4.0 : -2.0;
            }
            (cue.entityRefs || []).forEach(ref => { if (queryLower.includes(String(ref || '').toLowerCase())) score += 3.5; });
            (cue.tags || []).forEach(tag => { if (queryLower.includes(String(tag || '').toLowerCase())) score += 1.8; });
            return score;
        };
        const search = async (targetChar = null, targetChat = null, query = '', options = {}) => {
            const payload = getPayload(targetChar, targetChat, options);
            const limit = Math.max(0, Math.min(MAX_SEARCH_RESULTS, Number(options.limit || 8) || 8));
            if (!limit || !payload?.cues?.length) return { count: 0, items: [], sourceHash: payload?.sourceHash || '', vectorUsed: false };
            const queryText = String(query || '').trim();
            const queryTokens = tokenSet(queryText);
            const queryLower = queryText.toLowerCase();
            const buckets = Array.isArray(options.buckets) ? options.buckets : [];
            const cache = getVectorCache();
            const engine = (() => { try { return MemoryEngine?.EmbeddingEngine || null; } catch (_) { return null; } })();
            let queryVector = null;
            let vectorUsed = false;
            if (options.allowQueryEmbedding === true && engine?.getEmbedding && queryText) {
                const qKey = queryVectorKey(queryText);
                const cached = cache.get(qKey);
                if (Array.isArray(cached?.vector)) queryVector = cached.vector;
                else {
                    queryVector = await engine.getEmbedding(queryText);
                    if (Array.isArray(queryVector) && queryVector.length) cache.set(qKey, { vector: queryVector, updatedAt: Date.now() });
                }
            }
            const scored = payload.cues.map((cue) => {
                let score = cueSparseScore(cue, queryTokens, queryLower, buckets);
                let vectorScore = 0;
                if (queryVector && engine?.cosineSimilarity) {
                    const cached = cache.get(vectorKey(cue));
                    if (Array.isArray(cached?.vector) && cached.vector.length === queryVector.length) {
                        vectorScore = Math.max(0, engine.cosineSimilarity(queryVector, cached.vector));
                        score += vectorScore * 7.0;
                        vectorUsed = true;
                    }
                }
                return { ...cue, score: Number(score.toFixed(3)), vectorScore: Number(vectorScore.toFixed(3)) };
            })
                .filter(cue => cue.score > 0)
                .sort((a, b) => (b.score - a.score) || (b.vectorScore - a.vectorScore) || String(a.sourceLabel || '').localeCompare(String(b.sourceLabel || '')))
                .slice(0, limit);
            return { count: scored.length, items: scored, sourceHash: payload.sourceHash || '', vectorUsed };
        };
        const format = (items = [], options = {}) => {
            const list = (Array.isArray(items) ? items : []).filter(item => item && String(item.text || '').trim());
            if (!list.length) return '';
            const title = String(options.title || 'Retrieved Character/Lorebook Cues').trim();
            const policy = String(options.policy || 'Lower-priority retrieved cues from character description/lorebook cue index. Use only when they clarify stable facts. Current user/assistant turn, manual corrections, and stored LIBRA data outrank these cues.').trim();
            const lines = [`[${title}]`, policy];
            list.forEach(item => {
                const bits = [];
                if (Array.isArray(item.buckets) && item.buckets.length) bits.push(`bucket=${item.buckets.join('/')}`);
                if (Array.isArray(item.entityRefs) && item.entityRefs.length) bits.push(`entities=${item.entityRefs.slice(0, 5).join('/')}`);
                if (Number.isFinite(Number(item.vectorScore)) && Number(item.vectorScore) > 0) bits.push(`v=${Number(item.vectorScore).toFixed(2)}`);
                lines.push(`- [${item.sourceLabel || item.sourceType || 'cue'}${bits.length ? '; ' + bits.join(', ') : ''}] ${clip(item.text, Number(options.itemChars || 520) || 520)}`);
            });
            return truncateForLLM(lines.join('\n'), Math.max(800, Number(options.maxChars || 3200) || 3200), '\n...[TRUNCATED CHARACTER LORE CUES]...\n');
        };
        const getStatus = (targetChar = null, targetChat = null) => {
            const payload = getPayload(targetChar, targetChat, {});
            const cache = getVectorCache();
            const embedded = (payload.cues || []).filter(cue => Array.isArray(cache.get(vectorKey(cue))?.vector)).length;
            return { ok: true, cueCount: payload.cueCount || 0, embedded, sourceHash: payload.sourceHash || '', persistedVectors: false, comment: COMMENT };
        };
        return Object.freeze({ COMMENT, SCHEMA, buildPayload, buildLoreEntry, ensureLocalLoreEntry, parsePayload, findPayloadInLore, search, format, refreshEmbeddingCache, getStatus });
    })();

    const CharacterEntitySourceHintBridge = (() => {
        const DEFAULT_LIMIT = 10;
        const build = async (targetChar = null, targetChat = null, query = '', options = {}) => {
            const limit = Math.max(0, Math.min(20, Number(options.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT));
            const maxChars = Math.max(800, Math.min(8000, Number(options.maxChars || 3200) || 3200));
            if (!limit) return { count: 0, block: '', items: [], vectorUsed: false };
            const buckets = Array.isArray(options.buckets) && options.buckets.length
                ? options.buckets
                : ['entity', 'relation', 'identity', 'narrative'];
            const result = await CharacterLoreCueIndex.search(targetChar, targetChat, query, {
                limit,
                buckets,
                allowQueryEmbedding: options.allowQueryEmbedding === true,
                forceRebuild: options.forceRebuild === true
            });
            const block = CharacterLoreCueIndex.format(result.items, {
                title: 'Character Card / Lorebook Entity Cues',
                maxChars,
                itemChars: 560,
                policy: 'Lower-priority stable entity/reference cues retrieved from the character card and non-LIBRA character lorebook cue index. Use only for explicitly written biological sex, appearance, personality, speech style, background, alias, occupation, stable relationship facts, and long-term identity. Do not treat style/output instructions as entity facts. Do not overwrite the current turn with stale lorebook hints. Current user/assistant turn and manually corrected LIBRA data outrank this block.'
            });
            return { count: result.count, block, items: result.items, vectorUsed: result.vectorUsed, sourceHash: result.sourceHash };
        };
        return Object.freeze({ build });
    })();

    const EntityAnalysisHintBridge = (() => {
        const buildRpLongTermCueBlock = (targetLore = [], query = '', options = {}) => {
            try {
                if (typeof RPContinuityCore === 'undefined' || !RPContinuityCore?.formatForPrompt) return '';
                if (typeof MemoryEngine !== 'undefined' && MemoryEngine.CONFIG?.rpLongTermMemoryEnabled === false) return '';
                const queryText = String(query || '').trim();
                const focusNames = typeof extractEntityRefs === 'function'
                    ? extractEntityRefs(queryText, { includeGeneric: false }).slice(0, 12)
                    : [];
                const maxChars = Math.max(700, Math.min(2400, Number(options.maxChars || 1400) || 1400));
                const block = RPContinuityCore.formatForPrompt(Array.isArray(targetLore) ? targetLore : [], {
                    query: queryText,
                    focusNames,
                    maxChars,
                    currentTurn: options.currentTurn || (typeof MemoryEngine !== 'undefined' ? MemoryEngine.getCurrentTurn?.() : 0) || 0
                });
                if (!String(block || '').trim()) return '';
                return [
                    '[RP-LTM Candidate Entity Cues / RP 장기기억 엔티티 후보 단서]',
                    'Lower-priority durable continuity cues. Use them only to resolve aliases, stable identity, and relationship context for names that directly appear in the current transcript. Never create a new entity from this block alone.',
                    block
                ].join('\n');
            } catch (_) {
                return '';
            }
        };
        return Object.freeze({ buildRpLongTermCueBlock });
    })();

    const LibraLoreKeys = {
        entityFromName: (name) => `lmai_entity::${TokenizerEngine.simpleHash(String(name || '').trim().toLowerCase())}`,
        relationFromNames: (nameA, nameB) => {
            const a = String(nameA || '').trim().toLowerCase();
            const b = String(nameB || '').trim().toLowerCase();
            const parts = [a, b].sort();
            return `lmai_relation::${TokenizerEngine.simpleHash(parts.join('::'))}`;
        },
        narrative: () => 'lmai_narrative::core',
        charStates: () => 'lmai_char_states::core',
        worldStates: () => 'lmai_world_states::core',
        secretKnowledge: () => 'lmai_secret_knowledge::core',
        entityKnowledgeVault: () => 'lmai_entity_knowledge_vault::core',
        timeEngine: () => 'lmai_time_engine::core',
        rpLongTerm: () => 'lmai_rp_longterm::core'
    };

    const parseLooseJson = (text) => {
        if (!text || typeof text !== 'string') return null;
        const cleaned = Utils.stripLLMThinkingTags(text).trim();
        try {
            return JSON.parse(cleaned);
        } catch {}
        const codeBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (codeBlock) {
            try {
                const inner = codeBlock[1].trim().match(/\{[\s\S]*\}|\[[\s\S]*\]/);
                if (inner) return JSON.parse(inner[0]);
            } catch {}
        }
        try {
            const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
            return match ? JSON.parse(match[0]) : null;
        } catch {
            return null;
        }
    };
