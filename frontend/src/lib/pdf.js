import { jsPDF } from "jspdf";

// 5-tier score colours (RGB) — must match ScoreGauge colorFor
export const TIER = (s) =>
  s >= 80 ? [21, 128, 61] :   // strong green
  s >= 70 ? [34, 197, 94] :   // light green
  s >= 60 ? [234, 179, 8] :   // light yellow
  s >= 50 ? [217, 119, 6] :   // amber
            [220, 38, 38];    // red

const tierLabel = (s) =>
  s >= 80 ? "Strong" : s >= 70 ? "Good" : s >= 60 ? "Fair" : s >= 50 ? "Needs work" : "Poor";

const BLUE = [0, 47, 167];
const GRAY = [113, 113, 122];
const DARK = [24, 24, 27];

function makeDoc(reportKind, titleLine, subLine) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const CW = W - M * 2;
  let y = M;

  const setColor = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const ensure = (need) => { if (y + need > H - M) { doc.addPage(); y = M; } };
  const gapY = (n = 8) => { y += n; };

  const text = (str, { size = 10, color = DARK, bold = false, gap = 4, indent = 0 } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    setColor(color);
    const lines = doc.splitTextToSize(String(str ?? ""), CW - indent);
    lines.forEach((ln) => {
      ensure(size + gap);
      doc.text(ln, M + indent, y);
      y += size + gap;
    });
  };

  const sectionTitle = (str) => {
    gapY(10); ensure(28);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); setColor(DARK);
    doc.text(str, M, y); y += 6;
    doc.setDrawColor(BLUE[0], BLUE[1], BLUE[2]); doc.setLineWidth(1.5);
    doc.line(M, y, M + 44, y); doc.setLineWidth(0.2); y += 16;
  };

  const bigScore = (score, label) => {
    ensure(46);
    doc.setFont("helvetica", "bold"); doc.setFontSize(38); setColor(TIER(score));
    doc.text(String(Math.round(score)), M, y + 30);
    const nw = doc.getTextWidth(String(Math.round(score)));
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); setColor(GRAY);
    doc.text(label, M + nw + 14, y + 18);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); setColor(TIER(score));
    doc.text(tierLabel(score), M + nw + 14, y + 33);
    y += 46;
  };

  // dark header band
  doc.setFillColor(9, 9, 15); doc.rect(0, 0, W, 54, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(255, 255, 255);
  doc.text("Citetail", M, 34);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(180, 180, 190);
  doc.text(reportKind, W - M, 34, { align: "right" });
  y = 74;

  text(titleLine, { size: 18, bold: true });
  if (subLine) text(subLine, { size: 9, color: GRAY });
  gapY(2);

  return { doc, text, sectionTitle, bigScore, gapY, ensure, TIER, BLUE, GRAY, DARK,
    save: (name) => doc.save(name) };
}

export function exportContentReport(a) {
  const date = a.created_at ? new Date(a.created_at).toLocaleString() : "";
  const b = makeDoc("Content Optimization Report", a.title || "Untitled", `${a.source_url || "Pasted content"}  ·  ${date}`);
  const { text, sectionTitle, bigScore, gapY } = b;

  b.bigScore(a.overall_score || 0, "GEO / AEO SCORE");
  text(`${a.word_count || 0} words  ·  ${(a.dimensions || []).length} dimensions  ·  ${(a.recommendations || []).length} recommendations`, { size: 9, color: b.GRAY });

  if (a.summary_answer) {
    sectionTitle("Suggested Direct Answer");
    text(a.summary_answer, { size: 11, bold: true });
  }

  if ((a.dimensions || []).length) {
    sectionTitle("Dimension Scores");
    a.dimensions.forEach((d) => {
      text(`${d.label} — ${d.score}/100 (${tierLabel(d.score)})`, { bold: true, size: 11, color: TIER(d.score) });
      if (d.summary) text(d.summary, { size: 9, color: b.GRAY });
      (d.sub_checks || []).forEach((s) =>
        text(`${s.passed ? "PASS" : "FAIL"}  ${s.label}: ${s.detail}`, { size: 8, indent: 10, color: s.passed ? [21, 128, 61] : [220, 38, 38] })
      );
      gapY(6);
    });
  }

  if ((a.recommendations || []).length) {
    sectionTitle("Recommendations");
    a.recommendations.forEach((r) => {
      const pc = r.priority === "high" ? [220, 38, 38] : r.priority === "medium" ? [217, 119, 6] : b.GRAY;
      text(`[${String(r.priority || "").toUpperCase()}] ${r.dimension || ""}`, { bold: true, size: 9, color: pc });
      text(r.fix, { size: 9 });
      gapY(4);
    });
  }

  if ((a.detected_schema_types || []).length) {
    sectionTitle("Detected Schema Types");
    text(a.detected_schema_types.join(", "), { size: 9 });
  }

  if ((a.question_gaps || []).length) {
    sectionTitle("Question Gaps");
    a.question_gaps.forEach((g) => {
      text(`${g.covered ? "COVERED" : "GAP"}  ${g.question}`, { bold: true, size: 9, color: g.covered ? [21, 128, 61] : [220, 38, 38] });
      if (g.why) text(g.why, { size: 8, color: b.GRAY, indent: 10 });
    });
  }

  b.save(`citetail-content-${(a.title || "report").slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
}

export function exportDomainReport(r) {
  const date = r.created_at ? new Date(r.created_at).toLocaleString() : "";
  const b = makeDoc("Domain AI-Search Report", r.domain || r.brand || "Domain", `${r.brand || ""}  ·  ${date}`);
  const { text, sectionTitle, gapY } = b;

  b.bigScore(r.ai_readiness_score || 0, "AI READINESS SCORE");
  if (r.brand_summary) text(r.brand_summary, { size: 10 });
  text(r.known_by_ai ? "Recognized by AI engines" : "Low AI recognition", { size: 9, color: r.known_by_ai ? [21, 128, 61] : [217, 119, 6], bold: true });
  if (r.data_source) text(r.data_source, { size: 7.5, color: b.GRAY });

  const m = r.metrics || {};
  sectionTitle("SEO & Authority Metrics");
  const metricLine = (label, val, colored) => {
    const num = typeof val === "number";
    text(`${label}: ${val ?? "—"}${num ? "/100" : ""}`, { size: 9, bold: true, color: colored && num ? TIER(val) : b.DARK });
  };
  metricLine("Domain Authority", m.domain_authority, true);
  metricLine("Page Authority", m.page_authority, true);
  metricLine("Trust Score", m.trust_score, true);
  metricLine("Backlinks", m.estimated_backlinks);
  metricLine("Referring Domains", m.referring_domains);
  metricLine("Est. Monthly Traffic", m.estimated_monthly_traffic);
  if ((r.engines_checked || []).length) { gapY(4); text(`Engines checked: ${r.engines_checked.join(", ")}`, { size: 8, color: b.GRAY }); }

  if ((r.categories || []).length) {
    sectionTitle("Category Breakdown");
    r.categories.forEach((c) => {
      text(`${c.label} — ${c.score}/100`, { bold: true, size: 10, color: TIER(c.score) });
      if (c.note) text(c.note, { size: 8, color: b.GRAY, indent: 10 });
    });
  }

  if ((r.discovered_services || []).length) {
    sectionTitle("Discovered Business & Services");
    if ((r.crawled_pages || []).length) text(`Crawled: ${r.crawled_pages.join("  ·  ")}`, { size: 7.5, color: b.GRAY });
    gapY(2);
    r.discovered_services.forEach((s) => {
      text(`• ${s.name || s}`, { bold: true, size: 10 });
      if (s.evidence) text(`"${s.evidence}"`, { size: 8, color: b.GRAY, indent: 12 });
    });
  }

  if ((r.top_topics || []).length) {
    sectionTitle("Top Relevant Topics");
    r.top_topics.forEach((t) => {
      const topic = typeof t === "object" ? t.topic : t;
      const auth = typeof t === "object" ? t.authority : 0;
      const rel = typeof t === "object" ? t.relevance : 0;
      text(`${topic}   (authority ${auth} · relevance ${rel})`, { size: 9, color: TIER(auth) });
    });
  }

  if ((r.ai_search_rankings || []).length) {
    sectionTitle("AI Search Ranking by Topic");
    r.ai_search_rankings.forEach((a) => {
      text(`${a.ranks ? "RANKS" : "NOT RANKING"}  ${a.topic}  ${a.ranks ? `[${a.position}]` : ""}`, { bold: true, size: 9, color: a.ranks ? [21, 128, 61] : b.GRAY });
      if (a.ranks && (a.engines || []).length) text(`Engines: ${a.engines.join(", ")}`, { size: 8, color: b.GRAY, indent: 10 });
      if (a.note) text(a.note, { size: 8, color: b.GRAY, indent: 10 });
    });
  }

  if ((r.citation_sources || []).length) {
    sectionTitle(`Verified AI Citation Sources (${r.citation_sources.length})`);
    r.citation_sources.forEach((c, i) => {
      text(`${i + 1}. ${c.source}  ${c.authority != null ? `(authority ${c.authority})` : ""}  [${c.type || "reference"}] LIVE`, { bold: true, size: 9 });
      if (c.url) text(c.url, { size: 8, color: BLUE, indent: 12 });
      if (c.why) text(c.why, { size: 8, color: b.GRAY, indent: 12 });
    });
  }

  if ((r.ranking_prompts || []).length) {
    sectionTitle(`Ranking Prompts (${r.ranking_prompts.length})`);
    r.ranking_prompts.forEach((p) => {
      text(`• ${p.prompt}`, { size: 9, bold: true });
      text(`topic: ${p.topic || "—"} · ${p.position || ""} · ${p.intent || ""}`, { size: 7.5, color: b.GRAY, indent: 12 });
    });
  }

  if ((r.quick_wins || []).length) {
    sectionTitle("Quick Wins");
    r.quick_wins.forEach((q) => {
      const pc = q.priority === "high" ? [220, 38, 38] : q.priority === "medium" ? [217, 119, 6] : b.GRAY;
      text(`[${String(q.priority || "").toUpperCase()}] ${q.action}`, { size: 9, color: pc });
    });
  }

  if ((r.competitors || []).length) {
    sectionTitle("Competitors for the Same AI Answers");
    r.competitors.forEach((c) => {
      const dom = typeof c === "object" ? c.domain : c;
      const topic = typeof c === "object" ? c.topic : "";
      const note = typeof c === "object" ? c.note : "";
      text(`• ${dom}${topic ? `  (${topic})` : ""}`, { size: 9, bold: true });
      if (note) text(note, { size: 8, color: b.GRAY, indent: 12 });
    });
  }

  b.save(`citetail-domain-${(r.domain || "report").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
}
