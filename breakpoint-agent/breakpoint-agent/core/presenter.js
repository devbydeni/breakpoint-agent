// Shared presentation helpers for rendering analysis sessions as human-readable
// text. Used by the CLI (plain text) and the Telegram bot (lightly styled).

function money(n) {
  if (n === undefined || n === null || isNaN(n)) return '$0'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function breakEvenText(month) {
  return month ? `Month ${month}` : 'Never (within 24 months)'
}

const HEALTH_LABEL = {
  healthy: 'Healthy',
  borderline: 'Borderline',
  failing: 'Failing'
}

// Render a full analysis session as plain text. `bold` wraps section titles so
// callers can inject Markdown (Telegram) or leave them plain (CLI).
export function renderAnalysis(session, { bold = (s) => s } = {}) {
  const base = session.scenarios?.find(s => s.isBase) || session.scenarios?.[0]
  const lines = []

  lines.push(bold('BreakPoint Analysis'))
  lines.push(`ID: ${session.id}`)
  lines.push(`Business type: ${session.inputs?.businessType || 'n/a'}`)
  lines.push('')

  lines.push(bold('Base Case'))
  if (base) {
    lines.push(`- Break-even: ${breakEvenText(base.breakEven)}`)
    lines.push(`- LTV:CAC: ${base.ltvCac}`)
    lines.push(`- Net margin: ${base.netMargin}%`)
    lines.push(`- MRR (month 24): ${money(base.mrr)}`)
    lines.push(`- 12-month revenue: ${money(base.revenue12mo)}`)
    lines.push(`- Health: ${HEALTH_LABEL[base.health] || base.health}`)
  }
  lines.push('')

  const summary = session.vulnerabilitySummary
  if (summary) {
    lines.push(bold('Vulnerability Summary'))
    lines.push(`- High-impact assumptions: ${summary.highImpactCount}`)
    lines.push(`- Flagged (high impact + low confidence): ${summary.flaggedCount}`)
    lines.push(`- Top risk: ${summary.topRisk || 'n/a'}`)
    lines.push('')
  }

  const vulns = (session.vulnerabilities || []).slice(0, 5)
  if (vulns.length) {
    lines.push(bold('Top Vulnerabilities'))
    vulns.forEach((v, i) => {
      const flag = v.flag ? ' [FLAGGED]' : ''
      lines.push(`${i + 1}. ${v.assumption} — ${v.impact} impact${flag}`)
      lines.push(`   ${v.consequence}`)
      if (v.suggestedAction) lines.push(`   Action: ${v.suggestedAction}`)
    })
    lines.push('')
  }

  if (session.executiveSummary) {
    lines.push(bold('Executive Summary'))
    lines.push(session.executiveSummary)
  }

  return lines.join('\n')
}

// Render scenario comparison table (base + stress + optimistic).
export function renderScenarios(session) {
  const rows = (session.scenarios || []).map(s => {
    const be = s.breakEven ? String(s.breakEven).padStart(2) : '--'
    return `  ${(s.name || s.id).padEnd(24)} ${String(s.badge || s.type).padEnd(11)} break-even: ${be}  ${s.ltvCac || ''}`
  })
  return ['Scenarios:', ...rows].join('\n')
}

// Render a compact list of saved sessions.
export function renderSessionList(sessions, { bold = (s) => s } = {}) {
  if (!sessions.length) return 'No saved analyses yet.'

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.lastModified) - new Date(a.lastModified)
  )

  const lines = [bold(`Saved analyses (${sorted.length})`)]
  for (const s of sorted) {
    const base = s.scenarios?.find(sc => sc.isBase)
    const be = base ? breakEvenText(base.breakEven) : 'n/a'
    lines.push(`- ${s.id}`)
    lines.push(`    ${s.inputs?.businessType || 'untitled'} · break-even ${be} · ${new Date(s.lastModified).toLocaleString()}`)
  }
  return lines.join('\n')
}
