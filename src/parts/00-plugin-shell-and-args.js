//@name libra_world_manager
//@display-name LIBRA World Manager V5.3.1
//@author rusinus12@gmail.com
//@api 3.0
//@version 5.3.1
// Hybrid patch: V4.2 turn-anchor core + rollback snapshots; V3.5.1 lorebook data model retained.
// RE provider/Jaccard patch: RE Companion provider compatibility + strengthened sparse Jaccard recall.
// Storage patch: pluginStorage stores common settings plus the latest two-turn debug trace; runtime/chat data stays in visible lorebook entries.
// Recording patch: narrative turnLog/manual memories carry V4.2 turn-anchor metadata; debug export stores only the latest two turns in visible lorebook.
// Recall quality patch: evidence-aware sparse recall, sentence-window memory excerpts, and recent-turn recall audit remain inside existing lorebook layers.
// Prompt injection patch: LIBRA now injects only data/reference context; current-user raw echo, story/planner orchestration injection is removed.
// Runtime UI cleanup patch: retired live-status UI shim and all live-status update calls are removed.
// Cold start alignment patch: conservative extraction, visible-source records, scoped analysis settings, and hard failure propagation.
// Source reflection patch: character card/lorebook, persona binding, Hypa V3, and selected module lorebooks are reflected into visible LIBRA data without direct source injection.
// Flex tier patch: optional provider service-tier routing is applied to latency-tolerant background LLM work; realtime injection paths remain standard by default.
// Provider streaming patch: RE-compatible llm_stream / aux_llm_stream settings now aggregate upstream streaming responses while preserving LIBRA non-live output flow.
// Module source selector patch: data-source reflection module lorebooks are selected through a visible V4.2-style module toggle list.
// Vertex JSON patch: Vertex provider settings can import service-account JSON into provider key/URL fields without storing hidden copies.
// Compact memory patch: lmai_memory uses summary-only compact JSON; legacy raw memory is dual-read and migrated; rollback snapshots inherit compact/delta snapshots.
// Patch A follow-up: exact-anchor recall backfill and long-rollback fast path keep long chats responsive without replacing existing data.
// Adaptive semantic recall patch: paraphrase-aware semantic bridge raises embedding influence only when entity/scene evidence supports it.
// Recall Scoring V2 patch: RE Companion/HAYAKU-style relevance gate, direct-evidence scoring, generic-anchor penalty, and domain-mismatch guard.
// Hybrid Memory Engine: read-path typed rows + write-path metadata + rollback-aware row tombstones; legacy generation remains intact.
// HME scope index patch: write-time scoped recall index persists compact row signals and hydrates runtime caches before full lore rebuild.
// Time engine patch: V4.2 narrative clock parser + canonical time state projection.
// POV secrecy patch: V4.2-style SecretKnowledge + Entity POV boundary guards prevent undisclosed fact leakage.
// Prompt Injection Coverage patch: V4.2 data-only injection now backfills active entity/relation/memory/world/narrative sections from user input and recent live chat so stored data is not silently skipped.
// Hidden advanced defaults patch: advanced recall/projection/HME features stay out of GUI but default to an operational profile.
// GUI restore patch: V5.2.2 GUI behavior restored; intrusive runtime sanitizer removed because it broke the legacy GUI event path.
// Stability hardening patch: serialized turn-anchor commits, deferred locked GC, bounded embedding cache, stable early-chat scope keys, hardened GUI sanitation, and provider stream finish parsing.
// LLM NER-style extraction patch: entity discovery is delegated to the configured LLM with span-first JSON extraction; local regex/mention fallbacks no longer promote entities.
// RP long-term memory patch: durable canon facts, preferences/boundaries, commitments, unresolved threads, relationship milestones, state changes, and callback anchors are consolidated into a rollback-safe visible lore ledger.
// RisuAI structure hotfix: plugin metadata remains at file start; JSON contracts are shape-checked; rollback cleanup no longer skips normal beforeRequest injection.
//@arg max_limit int Maximum memory entries
//@arg threshold string Memory importance threshold
//@arg sim_threshold string Similarity threshold percentage
//@arg cold_start_scope_preset string Cold-start scope preset
//@arg cold_start_history_limit int Cold-start history limit
//@arg debug string Enable recent-turn debug capture/export: true/false
//@arg secret_knowledge_enabled string Enable secret knowledge guard: true/false
//@arg entity_knowledge_vault_enabled string Enable per-entity POV knowledge guard: true/false
//@arg rp_long_term_memory_enabled string Enable RP long-term continuity ledger: true/false
//@arg rp_long_term_llm_enrichment string Enrich RP long-term memory in the existing maintenance LLM pass: true/false
//@arg rp_long_term_injection_max_chars int Maximum RP long-term continuity injection characters
//@arg rp_long_term_long_ttl int Turn TTL for durable long-term RP memories
//@arg rp_long_term_medium_ttl int Turn TTL for medium-term RP memories
//@arg activity_dashboard string Realtime activity overlay: off|compact|full
//@arg background_maintenance_delay_ms int Delay background maintenance after afterRequest in ms
//@arg libra_injection_mode string LIBRA injection mode: direct|hybrid|lorebook_projection
//@arg libra_projection_always_active string Enable LIBRA projection lorebook entries: true|false
//@arg libra_projection_max_chars int Maximum characters per LIBRA projection lorebook entry
//@arg libra_projection_recall_bundle string LIBRA recall bundle projection: off|projection_only|hybrid|always
//@arg cbs_enabled string Enable CBS compatibility: true/false
//@arg manual_ooc_pause string Fully pause LIBRA and bypass all request-time work: true/false
//@arg entity_blocklist string Comma/newline separated blocked entity names
//@arg bypass_aux_requests string Skip LIBRA for auxiliary/plugin requests (memory/emotion/translate and explicit helper prompts): true/false
//@arg response_streaming_compat_enabled string Commit LIBRA data after RisuAI response streaming: true/false
//@arg use_lorebook_rag string Enable lorebook RAG: true/false
//@arg emotion_enabled string Enable emotion tracking: true/false
//@arg illustration_module_compat_enabled string Enable illustration compatibility: true/false
//@arg nsfw_enabled string Enable mature creative-writing guidance: true/false
//@arg gc_batch_size int GC batch size
//@arg memory_preset string Memory preset
//@arg world_adjustment_mode string World adjustment mode
//@arg section_world_inference_enabled string Enable section world inference: true/false
//@arg injection_budget_preset string LIBRA prompt injection budget preset: compact|balanced|large|max|custom
//@arg injection_budget_max_tokens int LIBRA prompt injection custom max tokens
//@arg injection_budget_tokens int LIBRA prompt injection token budget (legacy alias)
//@arg flex_routing_mode string Flex routing mode: off|background|all
//@arg flex_timeout_ms int Flex request timeout ms for latency-tolerant background calls
//@arg flex_fallback_to_standard string Retry once without Flex on throttling/timeout: true|false
//@arg vertex_flex_mode string Vertex Flex mode: provisioned_then_flex|flex_only
//@arg custom_service_tier_passthrough string Allow service_tier passthrough for custom OpenAI-compatible provider: true|false
//@arg backend_hosting_mode string Hosting bridge mode: off|auto|hosted
//@arg backend_hosting_url string Hosting bridge backend URL
//@arg backend_hosting_token string Hosting bridge backend token
//@arg llm_provider string Main LLM provider
//@arg llm_url string Main LLM base URL
//@arg llm_key string Main LLM API key
//@arg llm_model string Main LLM model
//@arg llm_temp string Main LLM temperature
//@arg llm_timeout int Main LLM timeout ms
//@arg llm_timeout_ms int RE-compatible main LLM timeout alias
//@arg llm_reasoning_preset string Main LLM reasoning preset: auto|gpt|gemini|claude|deepseek|kimi|glm|custom
//@arg llm_reasoning_effort string Main LLM reasoning effort
//@arg llm_reasoning_budget_tokens int Main LLM reasoning budget tokens
//@arg llm_max_completion_tokens int Main LLM max completion tokens
//@arg llm_glm_thinking_type string Main LLM GLM thinking type
//@arg llm_glm_thinking string RE-compatible main LLM GLM thinking alias
//@arg llm_stream string RE-compatible main LLM stream flag: true/false
//@arg llm_service_tier string Main LLM service tier: off|auto|default|flex|priority|scale
//@arg aux_llm_enabled string Enable auxiliary LLM: true/false
//@arg aux_llm_provider string Auxiliary LLM provider
//@arg aux_llm_url string Auxiliary LLM base URL
//@arg aux_llm_key string Auxiliary LLM API key
//@arg aux_llm_model string Auxiliary LLM model
//@arg aux_llm_temp string Auxiliary LLM temperature
//@arg aux_llm_timeout int Auxiliary LLM timeout ms
//@arg aux_llm_timeout_ms int RE-compatible auxiliary LLM timeout alias
//@arg aux_llm_reasoning_preset string Auxiliary LLM reasoning preset: auto|gpt|gemini|claude|deepseek|kimi|glm|custom
//@arg aux_llm_reasoning_effort string Auxiliary LLM reasoning effort
//@arg aux_llm_reasoning_budget_tokens int Auxiliary LLM reasoning budget tokens
//@arg aux_llm_max_completion_tokens int Auxiliary LLM max completion tokens
//@arg aux_llm_glm_thinking_type string Auxiliary LLM GLM thinking type
//@arg aux_llm_glm_thinking string RE-compatible auxiliary LLM GLM thinking alias
//@arg aux_llm_stream string RE-compatible auxiliary LLM stream flag: true/false
//@arg aux_llm_service_tier string Auxiliary LLM service tier: off|auto|default|flex|priority|scale
//@arg embed_provider string Embedding provider
//@arg embed_url string Embedding base URL
//@arg embed_key string Embedding API key
//@arg embed_model string Embedding model
//@arg embed_timeout int Embedding timeout ms
//@arg embedding_enabled string Enable RE-compatible embedding provider: true/false
//@arg embedding_provider string RE-compatible embedding provider alias
//@arg embedding_url string RE-compatible embedding base URL alias
//@arg embedding_key string RE-compatible embedding API key alias
//@arg embedding_model string RE-compatible embedding model alias
//@arg embedding_timeout_ms int RE-compatible embedding timeout alias
//@arg scoring_profile string RE strengthened Jaccard profile: balanced|lexical|strict|semantic|salience|recency|entity_focus|custom
//@arg scoring_word_weight string RE strengthened Jaccard word weight
//@arg scoring_char_weight string RE strengthened Jaccard character ngram weight
//@arg scoring_concept_weight string RE strengthened Jaccard concept weight
//@arg scoring_lexical_coverage_weight string RE strengthened Jaccard lexical coverage weight
//@arg scoring_focus_weight string RE strengthened Jaccard focus-name weight
//@arg recall_evidence_gate string Recall evidence gate: off|soft|strict
//@arg recall_anchor_bonus string Maximum anchor bonus used by evidence-aware recall scoring
//@arg recall_sentence_window string Use best sentence-window excerpts in Related Memories: true|false
//@arg recall_sentence_window_chars int Maximum characters per memory sentence-window excerpt
//@arg recall_scoring_text_max_chars int Maximum characters per memory used for first-pass recall scoring
//@arg recall_scoring_v2 string Enable Recall Scoring V2 final gate/ranking: true|false
//@arg recall_domain_guard string Block unrelated external-domain recall queries: true|false
//@arg hybrid_memory_engine string Enable World Manager Hybrid Memory Engine skeleton: true|false
//@arg hybrid_read_path string Enable hybrid typed-row read-path bucket shortlist: true|false
//@arg hybrid_read_path_max_rows int Max typed rows sent to heavy recall scoring
//@arg hybrid_write_path string Persist Hybrid Memory Engine typed row metadata on new memories: true|false
//@arg hybrid_duplicate_fast string Use Hybrid Memory Engine duplicate fast scoring: true|false
//@arg hybrid_duplicate_max_heavy int Max expensive duplicate similarity checks
//@arg hybrid_rollback_rows string Enable rollback-aware Hybrid Memory Engine row tombstones: true|false
//@arg hybrid_scope_index string Persist compact HME scope index and use it for read-path preselection: true|false
//@arg hme_associative_graph string HME associative graph recall: off|light|balanced|deep
//@arg hme_graph_max_seeds int Max HME graph seed rows
//@arg hme_graph_max_candidates int Max HME graph-expanded candidate rows
//@arg hme_graph_max_nodes int Hard cap for HME graph nodes
//@arg hme_graph_max_edges int Hard cap for HME graph edges
//@arg hme_graph_max_hops int Max HME graph traversal hops
//@arg hme_graph_bonus_cap string Max HME graph bonus added to Recall Scoring V2
//@arg hme_graph_debug string HME graph recall debug: off|compact|full
//@arg character_source_reflection_enabled string Reflect character description/lorebook into LIBRA data: true|false
//@arg persona_binding_sync_enabled string Sync RisuAI persona binding into LIBRA user identity: true|false
//@arg hypa_v3_auto_reflect_enabled string Auto-reflect chat Hypa V3 modal data into LIBRA data: true|false
//@arg module_lorebook_reflection_enabled string Reflect selected module lorebooks into LIBRA data: true|false
//@arg module_lorebook_selected_ids string Selected module IDs/names/namespaces for lorebook reflection
//@arg weight_mode string Weight mode
//@arg w_sim string Custom similarity weight
//@arg w_imp string Custom importance weight
//@arg w_rec string Custom recency weight

(async () => {
