# STARPIN WORD LAB — HOLISTIC HANDOVER TO CLAUDE
**19 October 2026 | Standalone briefing | Read alongside the latest Word Lab game/source supplied by the user**

## 0. What I need from you, Claude

You already know the wider **Starpin / Geosonify** project. Assume you have **no prior knowledge of this word-game add-on** and do not assume you helped develop it. This document is the context you need. The user will provide the latest runnable game; inspect its real code, data, and version before proposing changes. **Do not treat a former recommendation as a decision, and do not edit the live Starpin repository.**

**Your initial assignment is a candid, independent architectural and gameplay review, not another round of ad hoc lexical patches.** After reading this document and inspecting the game, summarise your understanding; identify disagreements, oversights, or important opportunities; propose a sustainable and *automatically testable* route forward; and ask a small number of genuinely consequential questions. You are expected to challenge the existing approach, not merely agree with it. Do not ask the user to adjudicate hundreds of English sentences. Don't write or replace the game until the user asks you to implement a specific plan.

### Status labels used below
- **Established goal / user decision:** expressed by the user or settled in the current prototype.
- **Current implementation (v1.1):** what the latest version available to ChatGPT actually did; verify against the newer file, if any, which the user supplies.
- **Proposed / unresolved:** a recommendation to discuss, not settled product policy.
- **Observed test result:** measured in an actual test, with stated limitations.

## 1. What the game is and why it exists

**Word Lab** (also referred to in experiments as *Word Garden* or *Starpin BIP39 sentence game*) is a language-construction side game tied to collecting real-world Starpins and cornerstones. The wider Starpin app already maps geographic/astronomical locations into word-addresses; Word Lab puts the resulting vocabulary to use. The words come from the **official, fixed 2,048-word English BIP39 list**, not an arbitrary English dictionary. The lexicon maintains the official zero-based indices and word identities; do not relabel or substitute its entries.

Collecting locations gradually yields an eccentric, non-curated inventory. The player tries to arrange those actual words into grammatically defensible English utterances, augmented by unlockable little *grammar helpers*. There is a spatial/collecting motivation, an inventory-allocation puzzle, creative wordplay, and potentially peer/class/team competitions. It should be joyful, surprising, tactile, occasionally educational, and highly replayable: the user gets a genuine kick from trying to form a sentence using the **fewest possible grammatical filler words** and as many collected words as possible.

**The game's creative core is pushing English to its structural limits.** Unlikely objects can act, feel, talk, or be described in surreal ways. The more surprising a syntactically valid reading is, the better; semantic absurdity is emphatically **not** evidence of bad grammar. It is not a naturalness, literary-quality, plausibility, topic, sentiment, or fact-checking game. Familiar schoolbook sentences are welcome, too, especially from young beginners.

The user recently noticed a special pleasure in **extreme noun compounding**: *prison patient parrot ketchup*, *bitter banana menu output*, *steel soldier script output*, etc. This builds increasingly surreal concepts while consuming collected nouns rather than helper words. Do not treat productive noun stacking as pointless padding merely because the semantic relationships are opaque. At the same time, the rules and score must be consistent and resistant to actual exploits.

The user is an audiology academic interested in language, but is **not** signing up to be a volunteer grammar annotator. Their spontaneously found edge cases came from fewer than 200 collected words—under 10% of BIP39. Extrapolating to the whole vocabulary shows why soliciting user corrections one sentence at a time cannot scale.

## 2. Real playing pieces and ownership rules

**Current implemented rules:**

- **Blue collected tile:** one unique tile per BIP39 *word type* collected. Repeat geographic finds of the same BIP39 word do not create additional blue copies. A particular collected blue word can be assigned to only **one** committed sentence at a time; reallocating it means editing or dismantling a saved sentence. In a sentence, its ownership/source must be explicit.
- **Gold grammar helper:** unlocked by gameplay/progression, then reusable without limit. A helper can appear in multiple sentences; gold tiles supply syntax but **do not earn collected-word points**.
- **Overlap is intentional:** the same spelling may be both a unique collected **blue** tile and an unlimited **gold** helper, e.g. *can*. These are **different tile identities** with different scarcity/points. An older October 16 draft recommended making helpers disjoint from BIP39: **that was superseded by the working prototype, not an agreed rule**. Never silently abolish overlap.
- **Purple provisional/ghost tile:** hypothetically uncollected or borrowed from a different committed sentence to test syntax and preview score. Ghosts cannot be committed until collected or properly freed. The drafting sandbox is reversible and non-destructive; it cannot silently duplicate, consume, or relocate committed blue tiles.
- Each saved sentence retains the ordered **word and provenance of every tile**, not merely a plain text string; preserve this in storage/export/import.
- Unlocking gold words and collecting blue words are separate from committing a sentence. **Punctuation/capitalisation** should be handled sensibly by the interface rather than consuming scarce collectible tiles. The current parser's internal punctuation support is narrower than full prose.

The most recent *v1.1 session file* contained **167 unique blue words** (from a user-reported 55 Starpins and 17 cornerstones), eight unlocked gold helpers (`the`, `is`, `in`, `and`, `a`, `can`, `for`, `on`), and **three committed sentences**:

1. `Abandon barely fun festival salad and shiver because clean library jeans know robust news for the runway security man.`
2. `A cheap angry badge and a shallow silly chat can boil nice level stairs and the vocal timber table in the million citizen parade.`
3. `The vivid autumn blossom and the famous canvas cat bag crumble and observe the original midnight primary core on the inner coast.`

Those three currently scored **418 + 165 + 216 = 799** under the *experimental v1.1 scoring model*, which is not a validated gold standard. **Subsequently, the user said they had unlocked `has` from the helpers.** That change is newer than the eight-helper v1.1 snapshot. Expect the user's supplied game/session to be the authority for its actual available words and unlocks. Do not overwrite their data with the older embedded session.

The game must eventually integrate reliably with Starpin's real collection/progression data, but **v1.1 was a standalone offline prototype** with simulated/imported finds; it does not read live GPS or Starpin collection logs. Progression details such as precise cornerstones-to-unlocks thresholds, lucky word unlocks, and whether sentences are shared publicly remain **open design questions**, not fully implemented rules.

## 3. Player experience and interface

**What exists or has been requested:**

- A warm, inviting, tactile **Starpin-consistent** game aesthetic: earthy moss/lichen greens, golden/yellow tiles, a little whimsy and animation where useful—not a generic analytics dashboard or chatbot. It should work on a phone and desktop.
- Word trays with search, parts-of-speech filters, contextual suggestions/Smart Picks, tap insertion and reorder controls, and manageable navigation through 100+ available words.
- Obvious differentiation of blue, gold and purple, plus clear visual signalling of which words are committed elsewhere.
- A non-destructive **sandbox** for drafting/rearranging sentences; save proposed changes, commit atomically when legal, or cancel everything without changing existing scores/allocations.
- **Live grammar feedback and a syntax explorer**: partial or complete constituency trees, bracket notation or an expandable explanation. An *Explain why* interaction should teach rather than bully; if the engine fails to analyse creative English, don't claim it is necessarily ungrammatical.
- A compact **Grow your sentence** coach: explain useful constructions, based on a player's real inventory and actual parser results. Hints should be verified when feasible, not merely generic claims that a modification will improve points.
- Simple tap/click definitions for specialist terms such as *adverbial*, *noun phrase*, *predicate*, *ellipsis* and *coordination*. Educational accessibility without making it feel like homework.
- Export/import and reliable persistence. Browser `localStorage` was used in v1.1, but native iOS Safari offline file persistence and touch have **not** been conclusively verified. Do not assume Chrome mobile emulation covers iPhone behaviour.

This is primarily a collection/creation game, with potential comparisons amongst classmates/friends/peer cohorts. The user explicitly says **age-normalised points are unnecessary** when those groups are naturally comparable.

## 4. Grammar philosophy — do not compromise this

1. **Syntactically defensible English is the target; semantic plausibility is not.** *The angry jeans know robust salad* may be weird but structurally legal.
2. **Rare but documented senses must be considered**, not automatically discarded in favour of the commonest reading. English BIP39 words are unusually polyfunctional. Lexical readings have constraints—e.g. category, countability, verb arguments, inflection, position; don't turn a dictionary's obscure adjective tag into an unrestricted adjective everywhere.
3. **Productive noun–noun compounds are welcome**, with flexible left nesting/attachment and creatively opaque relations. Don't insist each compound phrase be dictionary-attested or semantically interpretable by software. A compound's head noun and number/countability still matter.
4. **Fragments and contextual ellipsis can be valid utterances** and should be named and, where applicable, credited. Example: `The vivid autumn blossom and the famous canvas cat bag.` is a perfectly usable noun-phrase utterance (caption/answer), not necessarily a failed declarative. `The garden fence can.` can be a perfectly good answer to “What can keep the dog in?”—a modal-VP ellipsis with antecedent. The game must distinguish such utterance kinds from full finite clauses, rather than calling everything a sentence of the same type.
5. **No short arbitrary length ceiling.** A former 28-tile limit was removed; v1.1 supports 256 words as a *safety guard* with a separate resource-exhaustion diagnostic and passed an artificial 199-word coordination stress test. There are also hidden structural ceilings (see §8).
6. **Multiple parses are natural and often central to the creativity.** The lexer/parser must try legitimate noun/adjective/verb/modal readings and allow a genuinely justified parse, even when a common reading fails. Do **not** add blanket “no `can can`”, “no two adjacent helpers”, “no repeated noun” or other surface n-gram prohibitions.
7. **A successful parser return does not prove the intended, or indeed any convincingly justified, grammatical analysis.** Inspect the structure and ensure it faithfully assigns every word to a defensible role; avoid `unknown`-token catchalls or opaque lists gaining points.
8. **A parse failure also does not prove bad English.** There is no known exhaustive authoritative grammar of all productive English. Avoid absolute grammaticality pronouncements unsupported by a specific conflict.
9. No automatic point inflation from arbitrary concatenation, quoted word dumps, accidental nominal fallbacks, repeated helper-only loops or pathological left-recursion. This constraint needs **structural** safeguards, not semantic censorship.

## 5. Player examples that MUST inform the parser

These are *meaningful regression probes*, not a blanket instruction that every possible extension is accepted. Include exact expected **roles/interpretations**, not just `true/false` labels.

**A. Productive noun compounding and mass-quantified heads**

`Prevent prison patient parrot ketchup in all bitter banana menu output.`

Intended: imperative *prevent* + direct-object NP headed by mass noun *ketchup*, preceded by nominal modifiers *prison patient parrot*; a PP `in` + NP headed by *output*, modified by *all*, adjective *bitter*, and nominal modifiers *banana menu*. Semantically wildly unconventional, syntactically defensible. **v1.1 rejected** this; ERG 2025 parsed it with a compound analysis. The user now wants noun stacking positively rewarded rather than treated identically to gratuitous adjective lists.

**B. Causal `for` and zero-article `staff on stage`**

`Fix the fossil figure in the favorite filter and forget the grid gadget in the garage, for staff on stage sign steel soldier script output.`

Intended: two coordinated imperatives followed by an explanatory finite clause. Here *for* is a **coordinating conjunction meaning “because”**, not merely the preposition `for`. *Staff* is a permissible bare collective/plural NP; *on stage* is a bare idiomatic locative PP; *steel soldier script output* is a productive compound-headed NP. The user deliberately **does not mean “the staff”**. The older parser treats `for` primarily as a preposition and rejects key intended variants; its diagnostic often blames a later word such as *soldier* instead of the actual unsupported construction. Distinguish the coordinated explanatory *for* construction from subordinating *because*; punctuation is orthographic, not an extra collectible tile.

**C. Less common adjective sense and compound `joke journey`**

`The unknown civil void has just blame and the bitter October symbol can oppose the joke journey.`

Intended: coordinated finite clauses. In `just blame`, **just** is an adjective meaning *fair/deserved* rather than the familiar temporal/degree adverb; **blame** can be a mass noun. `October symbol` and `joke journey` are productive noun compounds, with the latter meaning a journey undertaken as a joke. `Has blame` is stylistically unusual; this is a deliberate test of creative grammar versus typical collocation. The user has unlocked `has` as a helper after the v1.1 export. ERG's first returned reading of this whole sentence did **not** conclusively demonstrate the intended adjectival reading of *just*: parse presence alone is weak evidence.

**D. The cat-shaped trashcan: canonical ambiguity test**

Imagine a rubbish/trash **can shaped like a cat**, capable of running. `cat can` is a noun compound: *cat* = nominal modifier, *can* = noun head. **All four of these are grammatical under that reading**:

- `The cat can can run.` = [the [cat can]] [can run].
- `Can the cat can run?` = [Can] [the [cat can]] [run]?
- `The cat can may run.` = [the [cat can]] [may run].
- `The cat can must run.` = [the [cat can]] [must run].

Crucial distinction: **linguistic grammaticality versus playable inventory**. A test sentence with *may* is not automatically constructible using the player's current collected/unlocked tiles. Words like `can` might have both blue and gold tile provenance; the parser must not conflate role with source. The previous AI mistakenly called some of these ungrammatical and wrongly labelled two as negative test items. Corrected in automated triage. ERG's first parse of `The cat can can run.` bizarrely collapsed both adjacent instances into a single modal semantic span, **not** the desired noun-plus-modal analysis. That is not satisfactory parse-witness evidence. Do not “fix” the game by forbidding repeated auxiliaries by spelling.

**E. More unusual but supported utterances**

- `The garden fence can.` — context-sensitive modal ellipsis.
- `The vivid autumn blossom and the famous canvas cat bag.` — coordinated NP fragment/caption.
- `A cheap angry badge and a shallow silly chat can boil nice level stairs and the vocal timber table in the million citizen parade in the vivid autumn blossom.` — long compositional noun/PP stacking; note **chat** has both count and mass readings.
- `Clump the document and forget the half human hybrid fossil.` — an imperative with a *half-human* type compound modifier; one report suggested automatic hyphenation where appropriate. ERG found no reading; that is **not** proof of ungrammaticality.
- `Crumble the favorite document in fun and ensure the core dose can predict midnight security and taste vivid unknown ketchup.` — *in fun* idiom; coordination/subordination/creative mass nouns.
- `Clean the favorite festival because angry jeans just know robust inner salad.`
- `Just joke and blame half human hybrid cat stairs.`
- `Taste vocal stairs today and guess famous angry autumn jeans.`

**F. Lexical restrictions discovered during audit**

- `chat` supports count and mass (`a shallow silly chat`; `shallow silly chat`). `salad` can also be count/mass.
- `symbol` can be a noun or noun adjunct (as in *symbol table*), not an automatically unrestricted adjective. Be cautious about noun-as-adjective inflation.
- `toward` is mainly a preposition; archaic adjective/adverb usages should not be freely productive without usage/context conditions.
- Some earlier generated tests used bad article choice (`a eight`) or metalinguistic frames (`say dog`, `say hard`); do not promote those artificial results into grammatical facts.

## 6. Scoring: what matters to the player

**User decisions:**

- Every *accepted, eligible utterance using collected blue tiles* should be worth **more than zero**, even a very simple child's sentence or a legitimate fragment/ellipsis. Gold-only word assemblies cannot earn collection points.
- Complexity and grammatical diversity should earn **significantly nonlinear rewards**, so an intricate, skilfully composed utterance is worth much more than a trivial one.
- **Portfolio score = the sum of all saved, valid scored sentences**, with scarce blue word ownership forcing trade-offs. Not the top single sentence, top three, mean or mean with a floor. The whole portfolio should be worth improving.
- Helpers are unlimited, support the grammar and have **zero blue-word points**; do not penalise their very existence just to make sentences look harder.
- Avoid rewarding infinite adjective stacking, merely repeated conjunctions, or meaningless helper loops. Syntactic feature diversity, embedding, coordination and inventive structures should matter.
- **Newer preference, superseding v1.1:** *long noun compounds* are themselves an enjoyable feat and should receive **consistent, positive, probably modest increasing rewards**, unlike simple adjective padding. The user likes maximizing collected nouns while minimizing helpers. A possible independent longest-compound achievement was floated, but not agreed.
- Scores and explanations should be reproducible, understandable, and stable across plausible alternative parses; do not simply select the mathematically highest-scoring garbage derivation.
- Comparisons are mostly same-age peer cohorts; no age-adjusted score requirement.

**What v1.1 ACTUALLY does, not necessarily what should survive:** `source/starpin_score.js` version `1.1.0-nonlinear-complexity` uses collected-word marginal weights `8,8,8,8,8,8,3,3,3,3,1,1,1,1` (zero beyond the array), construction-family bonuses once *per sentence*, diversity bonus, a nonlinear complexity multiplier, and reduced phrase factors (0.43 fragment, 0.62 ellipsis). It suppresses collected-word points for both adjective **and noun** modifiers beyond the first, with a small second-modifier bonus. `noun_compound` is assigned **zero** construction bonus. This architecture was partly motivated by anti-farming, but **the user subsequently explicitly rejected treating noun stacking as just filler**. A scoring redesign is needed, not merely a change to a constant.

A much older proposal suggested construction bonuses once per *portfolio*, but that is **not what v1.1 implements**, and the user has not ratified the collection-wide mechanism. Likewise no final score weights, point cap, helper progression or score-churn policy have been empirically validated. Keep experimental figures labelled experimental.

**Two crucial anti-exploit constraints:**

- Reward grammatical *constituents and relationships* grounded in collected tiles, not raw length or number of gold helpers. Count noun-compound modifiers in a transparent way with some taper/structural context; don't blindly multiply points for thousands of concatenated nouns.
- Preserve the word-allocation puzzle: a blue tile cannot be scored twice across different committed sentences. An alternative valid parse should not permit duplication or made-up lexical senses.

## 7. Three grammar outcomes and the still-open gameplay choice

The latest discussion proposed an honest **three-state technical model**:

1. **Recognised / supported:** a defensible complete parse witness exists. A legal sentence may be committed, its blue tiles reserved, and full deterministic score credited.
2. **Unresolved / not yet recognised:** the software cannot justify a full parse, but hasn't proved the utterance ungrammatical. Show partial constituents and candid limits, allow the player to preserve a draft/proposed sentence rather than losing work.
3. **Specific grammatical conflict:** a particular genuine syntactic/feature contradiction has been established across relevant readings (e.g. failed agreement without an alternative reading). Show useful diagnosis and how to revise; no points for the malformed construction.

**These categories are a design proposal, not yet implemented or approved as policy.** The previous AI proposed allowing unresolved sentences to be *saved with reserved words* and a **visible provisional potential score**, but withholding those potential points from a competitive leaderboard until verified. It warned that allowing unresolved sentences to earn immediate competitive points invites free-form nonsense farming. It also warned that *withholding* points from the most imaginative legitimate sentences **punishes the user for the parser's incompleteness**. This trade-off is **unresolved**. The user is asking for robust grammar technology specifically so “unresolved” doesn't become commonplace.

Do not confuse **purple ghost tiles** (unowned/borrowed inventory; existing mechanic) with **provisional grammar** (uncertain syntactic analysis; proposed mechanic). These are orthogonal and should have different UI states.

Possible directions for Claude to challenge: parse-based points for already verified structures without confirming the whole sentence? (Risk: farming valid fragments embedded in junk.) Offline/online arbitration? deferred scoring and retroactive confirmation? competition mode versus creative sandbox? explicit rewards for justified rare senses? Whatever you propose, analyse both player delight and adversarial exploits rather than giving an abstract correctness lecture.

## 8. Current implementation and known limitations (v1.1 baseline)

The file ChatGPT has is `Starpin_Word_Lab_v1.1_Starpin.html` (one offline HTML, approximately 1.4 MB), with source/test ZIP `Starpin_Word_Lab_v1.1_Source_and_QA.zip`. **Your attached latest build may be newer; inspect it and establish the real baseline first.**

In that source ZIP:

- `source/starpin_grammar.js`: self-contained JS deterministic bounded parser; exposed `createEngine(lexicon)` and `engine.parse(input, opts)` with `valid`, `reason`, `parse`, `features`, `diagnostic` (summary/detail/hint and partial fragments). Built-in helper roles, noun/mass/verb frames and utterance patterns.
- `source/starpin_score.js`: experimental scoring logic, version as above.
- `source/word_lab_interface.js`: UI, state, session and sandbox handling.
- `source/embedded_lexicon.js`, `data/lexicon.json`: complete BIP39 lexicon and source-backed readings.
- `data/user_session.json`: original 167-word/eight-helper/three-sentence snapshot.
- `source/rebuild_offline.py`: regenerates single HTML from source components; inspect before any rebuild.
- `tests/v1_1_regressions.js`: 29/29 tests passed at release. Other legacy suites (750 checks total across five suites) yield 726/750, with 24 mismatches, mostly stale prior judgements about fragments but also potential overacceptance.
- `docs/QA_REPORT.md`: test detail; native iOS not directly tested.

Known hard-coded limits in parser source include `MAX_SENTENCE_TOKENS = 256`, `MAX_NP_MODIFIERS = 9`, maximum parse results per stage, and computational step budgets. Separate automated noun-modifier experiments found a **six-modifier sequence accepted but eight rejected** in a short sentence; this is a *hidden artificial constraint* contrary to the player goal. The 256-word guard may be sensible temporarily but must not be mislabeled as “bad English.”

The parser often points diagnostics at the **wrong word** when a preferred partial/backtracking parse fails. It may accept malformed clauses under misleading **nominal-fragment** interpretations. Example: test strings with unlicensed subject-verb agreement may be reinterpreted as opaque noun phrases. It also sometimes accepts mixed imperative/declarative coordination but labels the whole construction as an imperative. **A boolean `valid` is not enough:** verify intended phrase boundaries and syntactic relations, especially if score depends on them.

The parser's grammar for causal `for`, zero-determiner stage adjuncts, unusually long compounds, rare adjectival uses and deeply coordinated clauses is known to be incomplete. It does not yet independently validate arbitrary English. The scorer is based on the selected parse; a false parse can cause unfair scores.

Session persistence is JSON and browser local state; **do not discard any real session** on rebuild. Be especially careful about the user's newly unlocked `has`, which was not in the shipped v1.1 JSON snapshot.

## 9. Linguistic evidence work already done — DON'T send the user through it again

The team initially built a full BIP39 lexical descriptor set with readings, noun countability, number, verb transitivity/argument frames, adjectives and adverbs. It then ran independent resource audits using **Open English WordNet 2025, VerbNet 3.4, and Simple English Wiktionary**. The v1.1 metadata documents source matches of 2,027, 919 and 2,038 BIP39 entries respectively (coverage counts are source matches, **not** validation that all proposed grammatical frames are correct).

There were approximately **189 source-backed corrections across 188 words**, but many rare readings remain uncertain or restricted. A user-facing review tool presented about **225 distinct review options**; a later export contained **459 variant-level judgements**. Do **not** call these “459 manual reviews”: that previously exaggerated the user burden. Nor should generated grammatical templates with invalid article choices or metalinguistic quotation be treated as genuine negative lexical evidence.

The user has explicitly rejected a strategy where they manually vet hundreds of test sentences, and prefers automated evidence triangulation, reputable grammars/corpora and targeted checks. Lexicon-rights/attribution for redistribution require checking. Don't equate an OED historical usage with an unrestricted contemporary productive construction; also do not exclude documented unusual senses just for being uncommon.

There is **no single definitive English grammaticality oracle**; dictionary part-of-speech labels alone cannot model syntax. Available independent references include:

- **English Resource Grammar (ERG) 2025** / DELPH-IN, using the **ACE** parser and optionally **PyDelphin** to inspect structured syntax/semantic representations. Broad coverage, independent and linguistically mature, but not infallible.
- **The Cambridge Grammar of the English Language** (Huddleston/Pullum) for descriptive grammar and edge constructions; authoritative reference text, not a ready-to-run parser.
- **CGELBank** for structural analyses; **BLiMP** for published minimal pairs; **CoLA** for broader acceptability judgments. Be aware that semantic-selection tests can wrongly penalise Starpin's deliberate surrealism, and some benchmark negatives admit alternate readings.
- **Grammatical Framework / Resource Grammar Library** as a potentially browser-relevant alternative, but its coverage of Starpin's edge cases was **not benchmarked**. Do not claim GF has been proved superior or equivalent.

## 10. A REAL independent ERG/BLiMP experiment was run on 19 October 2026

The user ran a prepared Google Colab notebook with **ERG 2025 + ACE 0.9.34**, returned the output ZIP, and the results were analysed. This is not imaginary proof-of-concept: **490 inputs were attempted**, 423 parsed, 67 returned “0 readings.” A reporting bug initially called those 67 `engine_error`; they were ordinary no-parses, not executable crashes.

### Curated Starpin bake-off

On **66 original clearly labelled examples common to both engines** (before the later cat-can label corrections):

| Baseline result | Word Lab v1.1 | ERG parse-exists |
|---|---:|---:|
| Positive examples accepted | 36/39 | 39/39 |
| Original negative examples rejected | 24/27 | 11/27 |

**Important:** the original *negative* labels included two **mistaken cat-can negatives**, later corrected (`CASE-077` and `CASE-078`), and two other negative cases (`CASE-072` and `CASE-085`) were quarantined as possibly context-dependent. Hence the original 66-case table is **historical, not a corrected accuracy estimate**. Do not repeat its negative-score comparison as a current truth without recomputing the denominators/labels.

ERG parsed `Prevent prison patient parrot ketchup in all bitter banana menu output.` and `Staff on stage can sign the script.` where Word Lab failed, and had a recognisable ellipsis analysis for `The garden fence can.`. It failed to analyse some long but defensible combinations (`Clump the document ...`, the long *cheap angry badge* sentence), so an absent ERG parse also cannot veto a Word Lab sentence.

Some ERG apparent successes are **not satisfactory witnesses**. For `The cat can can run`, ERG's first MRS merged two `can` spellings into one modal span. For `Can the cat can run?` the first result used a generic `unknown` fallback. For `The the cat can run`, ERG likewise merged two determiners. It accepted `A angry cat can run` without the expected `a/an` phonological agreement. In the *just blame* example, its first parse did not demonstrate adjectival *just*. This is why *first MRS preview + parse exists* is nowhere near sufficient.

### BLiMP minimal pairs

We sampled **201 published BLiMP grammatical/ungrammatical pairs** (402 sentences, three pairs from each of 67 paradigms):

| ERG response for a pair | Pairs |
|---|---:|
| Both versions parsed | 152 |
| Only published grammatical version parsed | 45 |
| Neither parsed | 2 |
| Only published ungrammatical version parsed | 2 |

These are **parse-existence categories**, **not official BLiMP accuracy** (BLiMP evaluates language-model probability preferences). Don't claim 152 definitive ERG errors. They are valuable for triage by phenomenon, e.g. agreement, ellipsis, NPI licensing, filler-gap dependencies and extraction islands; not all published “bad” examples are categorically disallowed under all readings.

One telling real false-acceptance target is **`Who can Amy conceal many waitresses without questioning?`** The BLiMP contrast concerns extraction from an adjunct island. In the returned ERG MRS, *who* is bound as the missing object of *questioning* inside the `without` adjunct. That **specific** interpretation violates a well-established structural constraint. This is better evidence than saying “it sounds strange.” A strong validator needs constituent boundaries, argument structure, filler-gap dependencies and specific structural violations.

The sample ERG image file was around **279 MiB uncompressed** and ran using a native Linux executable; it is **not** currently a phone-ready offline JS engine. Median ACE time for the 88 Starpin inputs was around 111 ms on the cloud runtime (not a phone benchmark). Do not assume a server dependency is acceptable or that a WebAssembly build exists; investigate actual feasibility first.

### Automated triage already performed

An additional reproducible **Automated Grammar Triage v2** corrected the two cat-can gold labels, quarantined two other uncertain negatives, grouped the BLiMP problems by phenomenon, and created **intended-parse regression targets** rather than broad string bans. A separate stress pass generated **2,727 probes**; among findings were hidden noun-compound limits and 148 of 1,138 enabled verbs failing one simple modal template. The latter are **not** 148 confirmed lexical errors—some verbs legitimately require complements or different frames.

The latest triage does **not** prove a corrected parser: it reanalysed the existing results; it did not rerun ACE or modify the game.

## 11. Proposed robust grammar-engine strategy (for your independent review)

The previous proposal is **hybrid, reference-driven and testable**, but you should challenge it:

1. Keep Word Lab **browser-first and offline-compatible** if at all possible; an offline mobile game is a strong product value. Do not simply copy 279 MiB of ERG into the app.
2. Treat **ERG as a development/reference parser**, not a drop-in truth machine; consult other well-specified grammar resources for counterexamples or structural annotations where helpful.
3. Evaluate **parse witnesses**, not `parse_found`. Every surface tile should align one-to-one with a documented lexical sense/role (with explicit treatment for compounds, contraction, punctuation and genuine multiword constructions). Disallow normalization that silently swallows duplicated words or a generic `unknown` that provides no grammatical justification.
4. Inspect **n-best full structured parses/derivations** rather than only the first truncated MRS preview, where computationally feasible. Separate a grammatically valid alternate reading from a misleading parse. Do not require matching a player's intended *meaning* if another independent defensible reading exists, but the displayed explanation and score must describe the reading it actually supports.
5. Separate recognition of productive syntactic families (noun compounds, coordination, zero-article stage PPs, mass quantifiers, causal `for`, ellipsis, clause nesting) from lexicon-specific exceptions. Address families rather than adding one hardcoded example at a time.
6. Apply **true structural and feature constraints** (agreement, case, countability, verb complementation, modal roles, article sound/onset, island restrictions, etc.) over parses—not simplistic adjacent-word prohibitions. Feature constraints themselves must not erase legitimate context, dialect variation or productive compounding.
7. Maintain multiple **independent** automated evaluation streams: source-backed positive constructions with intended labelled trees; strict negative contrasts with alternate readings controlled or flagged; original human-authored Starpin examples; generated morphology/compound/coordination stress families; held-out independently sourced grammatical constructions; runtime and memory on desktop and real phones. Fix train/test leakage and stale copied code.
8. Apply *phenomenon-level* policy to BLiMP/CoLA. For instance, exclude semantic selectional oddity as a categorical negative, but still test agreement and adjunct islands. Show performance by construction, not only one flattering global percentage.
9. Avoid making the human player a grammatical adjudicator or relying on LLM yes/no judgements as independent proof. LLMs may help **generate hypotheses** or source leads during development, but their confident judgments have already been wrong here.
10. If the engine truly cannot decide, it must **abstain honestly** and show a useful partial analysis. Track the abstention rate as an engineering metric. Don't make this state the dominant game experience.

Importantly, a full English grammar with independently certified accept/reject outcomes may not be achievable; frame your recommendation in terms of achievable coverage, error severity, benchmarks, and transparent uncertainty—not a promise of 100% linguistic correctness.

## 12. What not to repeat

- **No manual user labelling programme.** Around 225 review options already proved too onerous and do not generalise across 2,048 BIP39 words and unbounded constructions.
- **No “ERG parses it, therefore grammatical”**, and **no “ERG rejects it, therefore ungrammatical.”**
- **No “can can is illegal.”** All four cat-can examples have valid noun-plus-modal readings.
- **No semantic naturalness filter**, ban on bizarre compounds, or veto because a noun is inanimate.
- **No unrestricted dictionary POS promotion** (e.g. *symbol* as general adjective, obscure *toward* as unrestricted adverb).
- **No hidden arbitrary 28-word/9-noun penalties** described as grammatical impossibility.
- **No automatic acceptance and scoring of opaque quotes, junk word lists or malformed clauses reinterpreted as gratuitous nominal fragments**, without a defensible constituent explanation.
- **No silent breakage of user's blue/gold provenance, sandbox arrangements, session data or helper unlocks.**
- **No hardcoded limit on grammar creativity based only on our 167-word snapshot.** The official domain is all 2,048 BIP39 words.
- **No live Starpin changes** unless specifically approved.

## 13. Concrete first response I want from you, Claude

**First inspect the actual attached latest build**, not just this text. Locate the parser, scorer, lexicon, helper/provenance rules, persistence and tests, and determine whether it is the same v1.1 baseline or newer. Flag any mismatch (especially `has` unlocked, noun-modifier scoring or causal `for`). Then respond with:

1. **Concise restatement of the game experience and non-negotiable rules**, clearly separating current implementation from desired end-state.
2. **Critical technical assessment of the current engine:** worst sources of false rejection/false acceptance; whether its parsing architecture should be repaired, replaced or supplemented; options for an offline phone-compatible implementation; realistic CPU/memory/packaging implications. Evaluate alternative grammars empirically rather than assuming ERG, GF or an LLM is a magic solution.
3. **Evidence-backed test strategy that doesn't require the user to judge individual sentences:** how to generate positive intended parses and hard negative contrasts, assess independent structures, flag alternate valid readings, and keep a meaningful holdout set. Include proposal for test harness, outputs, CI gates, and a *small* prioritized experimental plan.
4. **Gameplay assessment:** how to reward collected words, productive noun compounds, structural diversity, intricate long sentences, and children's simple utterances; how to prevent adjective/helper/fragment farming; and how to make parsing uncertainty workable in live competitive play without punishing creativity.
5. **Prioritised roadmap**, preferably a first small, measurable technical experiment followed by bounded implementation phases. Spell out acceptance criteria before proposing code changes.
6. **Questions back to the user** only where a real product decision is required; preferably 3–6 concise, consequential questions, not a survey of linguistic edge cases. Say what you recommend as the default for each, so the user can disagree without doing design work from scratch.

### Specific design questions worth confronting

- **Competition versus creativity:** should unresolved but apparently clever utterances reserve scarce blue tiles and accrue provisional noncompetitive points, or remain drafts until a warranted parse exists? If competitions are central, what verification/freeze/version policy prevents leaderboard instability?
- **Noun stacking:** what exactly counts as a scored noun-compound boundary, and what gently tapering scheme rewards extraordinary compounds without making endless noun strings the dominant strategy? Should there be separate compound-length achievements?
- **Alternative parses:** when several defensible parses exist, how do we select one for *explanation* and calculate a fair stable score without encouraging obscure score-maximising parses? When would asking the player to select **one of two genuinely different grammatical readings** be a delightful optional activity rather than compulsory annotation?
- **Helper scope:** when a word is gold and blue simultaneously (`can`), is the gold tile unrestricted across all genuine lexical senses, or restricted to its unlocked grammatical-helper role? This affects the scarce-blue puzzle and potential exploits. Clarify the actual code and recommend a policy.
- **Morphology:** BIP39 is overwhelmingly made of base forms; are visibly earned suffix helpers (`-s`, `-ed`, `-ing`) desirable, or is the scarcity of inflected forms part of the challenge? This was discussed but not decided.
- **Progression and geography:** how exactly are grammar helpers unlocked through cornerstones or other milestones, how fast should the first few become available, and should players choose their unlocks? An earlier simulation recommended `the → can → and` early, but the actual unlock set is user-specific and not fixed as final design.
- **Data integrity and offline portability:** how will the latest standalone game link to Starpin collection data without duplicating a GPS or account system, safely persist on iPhones, and preserve player creations through grammar/scoring-version upgrades?
- **Public sharing and competition security:** are sentences private by default, shareable, or leaderboard-submitted? Browser-only scores are mutable and cannot be trusted for serious competitive leaderboards without server-side verification.

Do not try to settle all of these unilaterally. Identify the *few* decisions that truly block a rigorous first experiment, and ask those first. I want help making a **fun, credible, scalable** creative language game, not an endlessly patched grammar checker.

## 14. Supporting research artefacts (optional, not assumed attached)

Ask for whichever actually matters. The user's newest game file takes precedence over archived work. Titles from the previous development session:

- `Starpin_Word_Lab_v1.1_Source_and_QA.zip` — v1.1 grammar/scorer/UI, canonical 2,048-word lexicon, tests/QA, historical session.
- `Starpin_ERG_Bakeoff_Analysed_2026-10-19.zip` — real Colab ERG 2025/ACE outputs, per-case comparison and analyses.
- `Starpin_Automated_Grammar_Triage_v2_2026-10-19.zip` — corrected cat-can labels, BLiMP categorisation and intended-role regressions.
- `Starpin_BIP39_Independent_Grammar_Evidence_v1.zip` — WordNet/VerbNet/Wiktionary evidence work.
- `Starpin_Helper_Progression_Research_v0.3.zip` and `Starpin_Sentence_Scoring_RedTeam_v0.4.zip` — earlier *experimental*, not final, design/scoring studies.

**End of handover.**
