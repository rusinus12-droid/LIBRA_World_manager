# LIBRA World Manager Source Layout

This directory is the current source-of-truth split for the RisuAI plugin bundle.

- `parts/*.js` files are ordered source fragments, not standalone modules.
- `build-manifest.json` defines the concat order and output path.
- The current split was regenerated from the GLM canonical bundle and keeps the previous feature-area boundaries.
- The old mismatched split source is isolated under `../isolated_src/20260624_151823.legacy-src-before-glm-canonical`.
- The temporary one-file mirror is isolated under `../isolated_src/20260624_152718.single-canonical-src-before-resplit`.

Run:

```bash
npm run build
npm run check
```

## Build Outputs

- `dist/LIBRA World Manager.js`: readable deployment bundle.
- `dist/LIBRA World Manager.min.js`: minified deployment bundle.

## Editing Rules

- Edit files under `src/parts`, then run `npm run build`.
- Keep the order in `build-manifest.json` unless deliberately changing initialization dependencies.
- These files share one top-level async IIFE scope after concatenation. A symbol declared in an earlier part can be used by later parts, but not the reverse.

## Legacy GUI Notes

The entity/person GUI was reduced to the fields that the unified canonicalPacket analysis reliably fills:
`name`, `role`, `appearance`, `personality`, `background`, `current state`, `speech cues`, `psychology`, and `open threads`.

Memory and narrative are intentionally separated:

- Memory is a chronological recall ledger of short, durable events/facts/open threads. It should not be a transcript, dialogue anthology, or full scene dump.
- Narrative is the structural story map: storylines, arcs, conflicts, current context, and unresolved dramatic flow. It should not duplicate every memory row.
- Turn records and HME indexes carry source anchoring/search support. They may refer to original turns, but user-facing memory should stay concise.
- Cold-start narrative hydration now reconciles every baseline turnLog entry into a primary storyline so storyline coverage reaches the actual imported turn count.

Entity background means stable identity/backstory such as origin, occupation, affiliation, and past context. It is not appearance, personality, current location, relation state, or narrative role. Current location was removed from the entity GUI because it belongs to scene/world state rather than stable entity DB fields.

The relation GUI was also reduced to the fields that are normally populated by canonicalPacket cold start: relation type, relation summary, recent changes, unresolved issues, and optional manual closeness/trust. Older relation detail controls are no longer rendered by default.

World canon is separated from transient world state:

- Persistent world canon lives in the active world node rules: classification/summary metadata, technology, metaphysics, systems, places/facilities, organizations, social/cultural rules, species, physics, phenomena, and custom rules.
- Current time, current location, current scene, active events, and offscreen threads belong to `WorldStateTracker`, not persistent world rules.
- Legacy custom rules are auto-classified into places, organizations, social rules, phenomena, or remaining custom rules when rendered in the GUI.

Older GUI revisions exposed a larger detailed-canonical editor. Those controls are intentionally no longer rendered in the current GUI, but older stored entity records may still contain their data for compatibility:

```text
Person detail controls formerly exposed in the GUI:
- biological sex, age, occupation, affiliation, aliases, honorifics
- sexual orientation / sexual preferences
- default speech tone, honorific style, relation-specific speech settings
- values, fears, vulnerabilities, boundaries, work style, social style
- pressure speech markers, intimacy shift, catchphrases
- current location, current scene time, emotional state, physical state, cognitive focus, immediate goal, active problems
- unresolved needs, commitments, next action hints
- POV knowledge: known to self, unknown to self, known to others, visible targets, private experiences, privacy
- episode ledger, evidence, quality/confidence/salience/importance/pressure/staleness/review flags

Relation detail controls formerly exposed in the GUI:
- public/private relationship layers, boundary state
- tension/risk/ambiguity/pressure numeric controls
- A→B and B→A dynamics
- shared location, workplace, private threads, shared-context notes
- relation event ledger, evidence, quality/confidence/salience/importance/pressure controls
```

## Parts

| File | Responsibility |
| --- | --- |
| `parts/00-plugin-shell-and-args.js` | Plugin shell and RisuAI arg declarations |
| `parts/01-core-runtime-compat-state-debug.js` | Core errors, Risu compatibility, MemoryState, diagnostics, toast, lore consolidation |
| `parts/02-concurrency-dashboard-utilities.js` | RWLock, task queues, Flex runtime, activity dashboard |
| `parts/03-global-utils-codec-cues.js` | Global utilities, compact memory codec, character/source cue indexes |
| `parts/04-cold-start-transition.js` | Cold start analysis and transition manager |
| `parts/05-rollback-turn-commit.js` | Sync rollback, snapshots, rollback journal, turn ledger, pending commits |
| `parts/06-api-providers-llm.js` | LRU cache, API providers, Flex policy, LLM provider facade |
| `parts/07-token-recall-embedding-emotion.js` | Tokenizer/hash, sparse recall, Korean text, embeddings, emotion engine |
| `parts/08-world-entity-secret-time.js` | World templates, world graph, entities, POV secrets, time engine |
| `parts/09-trackers-section-state.js` | Narrative tracker, maintenance optimizer, section/character/world state trackers |
| `parts/10-memory-engine-hme.js` | MemoryEngine facade/core and Hybrid Memory Engine internals |
| `parts/11-translation-reflection-cbs.js` | Internal data translation, source reflection, CBS engine |
| `parts/12-processors-world-entity.js` | Complex world detection, entity extraction/aware processing, world adjustment |
| `parts/13-risu-triggers-streaming.js` | RisuAI before/after request hooks, streaming compatibility, unload cleanup |
| `parts/14-main-initialization.js` | Config loading and main initialization |
| `parts/15-gui-and-exports.js` | GUI, dashboard controls, public globals, IIFE close |
