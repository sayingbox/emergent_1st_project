/**
 * Puter.js citation attribution for engines the backend can't cover.
 *
 * Backend (Emergent LLM key) handles: Gemini with `googleSearch` grounding.
 *
 * Puter.js (browser, user-pays) handles here:
 *   - ChatGPT   → `openai/gpt-4o-search-preview`  (OpenAI real web-search model)
 *   - Claude    → `claude-3-5-sonnet` via puter    (browser can call Anthropic's
 *                                                    web_search server tool)
 *   - Perplexity → `perplexity/sonar-pro`          (built-in web search + citations)
 *   - Grok       → `x-ai/grok-4-1-fast`            (Live Search built-in)
 *
 * We regex-extract every URL from each engine's live answer and match those
 * against the source list to tag "chatgpt" / "claude" / "perplexity" / "grok".
 *
 * Cost: 0 developer credit. First use prompts a free Puter sign-in. If the
 * user skips sign-in we do NOT show fake engine tags — chips are simply
 * omitted for engines whose call didn't succeed.
 */

function rootDomain(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = h.split(".");
    return parts.length >= 2 ? parts.slice(-2).join(".") : h;
  } catch {
    return "";
  }
}

function extractUrls(text) {
  if (!text || typeof text !== "string") return [];
  const re = /https?:\/\/[^\s<>"'\)\]\}]+/g;
  const out = new Set();
  const m = text.match(re) || [];
  for (let u of m) {
    // Trim trailing punctuation the regex may greedily include
    while (u.length && /[.,;:!?)\]}>"']/.test(u.slice(-1))) u = u.slice(0, -1);
    if (u.startsWith("http")) out.add(u);
  }
  return Array.from(out);
}

async function askPuterGrounded(model, query, brand) {
  try {
    if (typeof window === "undefined" || !window.puter?.ai?.chat) return null;
    const prompt =
      `Search the web and answer: which are the top third-party sources for "${query}"` +
      (brand && brand !== query ? ` — especially where the brand "${brand}" is mentioned` : "") +
      `. List 10-20 REAL source URLs you consulted, one URL per line. Include every URL you used.`;
    const resp = await window.puter.ai.chat(prompt, { model });
    // Puter's response shape varies; unify.
    let text = "";
    if (typeof resp === "string") text = resp;
    else if (resp?.message?.content?.[0]?.text) text = resp.message.content[0].text;
    else if (resp?.text) text = resp.text;
    else text = String(resp || "");
    // Also include Perplexity-style citations if exposed
    const citations = resp?.citations || resp?.message?.citations || [];
    let urls = extractUrls(text);
    for (const c of citations) {
      const u = typeof c === "string" ? c : c?.url;
      if (u) urls.push(u);
    }
    // De-dup preserving order
    const seen = new Set();
    return urls.filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });
  } catch (e) {
    console.warn("puter grounded search skipped:", e?.message || e);
    return null;
  }
}

function matchByExactOrHost(cited, sourceUrls) {
  if (!cited || !sourceUrls?.length) return new Set();
  const exact = new Set(cited);
  const citedHosts = new Set(cited.map(rootDomain).filter(Boolean));
  const out = new Set();
  for (const u of sourceUrls) {
    if (exact.has(u)) { out.add(u); continue; }
    const rd = rootDomain(u);
    if (rd && citedHosts.has(rd)) out.add(u);
  }
  return out;
}

/**
 * Fetches Perplexity + Grok REAL grounded citations concurrently via Puter.js
 * and merges them into the sources array (adds "perplexity" / "grok" to each
 * source's engines array where matched by exact URL or root-domain).
 *
 * Returns the (possibly-enriched) sources array. Never throws.
 */
export async function enrichWithPuterEngines({ query, brand, sources }) {
  if (!Array.isArray(sources) || sources.length === 0) return sources;
  const sourceUrls = sources.map((s) => s?.url).filter(Boolean);
  if (sourceUrls.length === 0) return sources;

  const q = (query || brand || "").trim();
  if (!q) return sources;

  const [chatgptCited, claudeCited, pplxCited, grokCited] = await Promise.all([
    askPuterGrounded("openai/gpt-4o-search-preview", q, brand || ""),
    askPuterGrounded("claude-3-5-sonnet", q, brand || ""),
    askPuterGrounded("perplexity/sonar-pro", q, brand || ""),
    askPuterGrounded("x-ai/grok-4-1-fast", q, brand || ""),
  ]);

  // If ALL calls returned null (user skipped sign-in or offline), don't touch engines.
  if (chatgptCited === null && claudeCited === null && pplxCited === null && grokCited === null) return sources;

  const chatgptUrls = matchByExactOrHost(chatgptCited, sourceUrls);
  const claudeUrls = matchByExactOrHost(claudeCited, sourceUrls);
  const pplxUrls = matchByExactOrHost(pplxCited, sourceUrls);
  const grokUrls = matchByExactOrHost(grokCited, sourceUrls);

  return sources.map((s) => {
    const set = new Set(Array.isArray(s.engines) ? s.engines : []);
    if (chatgptUrls.has(s.url)) set.add("chatgpt");
    if (claudeUrls.has(s.url)) set.add("claude");
    if (pplxUrls.has(s.url)) set.add("perplexity");
    if (grokUrls.has(s.url)) set.add("grok");
    return { ...s, engines: Array.from(set) };
  });
}

/** True once Puter.js is available in the window. */
export function puterAvailable() {
  return typeof window !== "undefined" && !!window.puter?.ai?.chat;
}
