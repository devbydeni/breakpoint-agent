// Reusable analysis engine.
//
// This module contains the full BreakPoint analysis pipeline decoupled from
// HTTP. The REST controller, the CLI, and the Telegram bot all call
// runAnalysis() so every access channel produces identical results.
//
//   inputs -> scenarios -> 24-month projections -> break-even/metrics
//          -> vulnerability ranking -> AI executive summary
//          -> (optional) AI vulnerability narratives

import { generateScenarios } from '../services/scenarioEngine.js'
import { calculateAllProjections, getProjectionSummary } from '../services/projectionCalculator.js'
import { calculateBreakEven, getFinancialHealth } from '../services/breakEvenCalculator.js'
import { calculateLTV, calculateLTVtoCACRatio } from '../utils/formulas.js'
import { rankVulnerabilities, getVulnerabilitySummary } from '../services/vulnerabilityRanker.js'
import { generateExecutiveSummary, generateFallbackSummary } from '../ai/summaryGenerator.js'
import { generateAllVulnerabilityNarratives, enrichVulnerabilities } from '../ai/vulnerabilityNarrator.js'
import { isAIAvailable } from '../ai/geminiClient.js'
import { addSession, updateSession, generateId } from './sessionStore.js'

// Build the per-scenario financial results (projections + metrics + health).
function buildScenarioResults(inputs, confidence) {
  const scenarios = generateScenarios(inputs)
  const scenariosWithProjections = calculateAllProjections(scenarios)

  const results = scenariosWithProjections.map(scenario => {
    const breakEven = calculateBreakEven(scenario.monthlyData, inputs.currentRunway)
    const summary = getProjectionSummary(scenario.monthlyData)
    const ltv = calculateLTV(scenario.inputs.pricing, scenario.inputs.monthlyChurn)
    const ltvCac = calculateLTVtoCACRatio(ltv, scenario.inputs.cac)
    const health = getFinancialHealth(breakEven, ltvCac, summary.netMargin)

    return {
      ...scenario,
      breakEven,
      ltvCac: ltvCac.toFixed(1) + ':1',
      health,
      ...summary
    }
  })

  const baseScenario = results.find(s => s.isBase)
  const vulnerabilities = rankVulnerabilities(
    baseScenario,
    baseScenario.breakEven,
    inputs,
    confidence
  )
  const vulnerabilitySummary = getVulnerabilitySummary(vulnerabilities)

  return { results, baseScenario, vulnerabilities, vulnerabilitySummary }
}

// Produce the executive summary, falling back to a deterministic summary when
// the AI layer is unavailable (missing key, rate limit, network error).
async function buildExecutiveSummary(inputs, results, vulnerabilities) {
  // No API key configured — skip the AI call and use the deterministic summary.
  if (!isAIAvailable()) {
    try {
      return generateFallbackSummary({ scenarios: results, vulnerabilities })
    } catch {
      return 'Analysis complete. Review your scenarios below.'
    }
  }
  try {
    const summaryResult = await generateExecutiveSummary({ inputs, scenarios: results, vulnerabilities })
    return summaryResult.success
      ? summaryResult.data
      : generateFallbackSummary({ scenarios: results, vulnerabilities })
  } catch (err) {
    console.error('Summary generation failed:', err)
    try {
      return generateFallbackSummary({ scenarios: results, vulnerabilities })
    } catch {
      return 'Analysis complete. Review your scenarios below.'
    }
  }
}

/**
 * Run the full analysis pipeline.
 *
 * @param {object}  options
 * @param {object}  options.inputs      Business model inputs (must include businessType).
 * @param {object}  [options.confidence] Map of assumptionKey -> 'high'|'mid'|'low'.
 * @param {boolean} [options.persist=true] Save the session to the shared store.
 * @param {'async'|'sync'|'none'} [options.enrichNarratives='async']
 *        How to generate AI vulnerability narratives:
 *          - 'async': fire-and-forget, update the stored session later (API default)
 *          - 'sync' : await narratives and include them in the returned session (CLI/bot)
 *          - 'none' : skip AI narratives entirely
 * @returns {Promise<object>} The completed analysis session.
 */
export async function runAnalysis({ inputs, confidence = {}, persist = true, enrichNarratives = 'async' } = {}) {
  if (!inputs || !inputs.businessType) {
    const error = new Error('Invalid input data: "inputs.businessType" is required')
    error.status = 400
    error.code = 'INVALID_INPUT'
    throw error
  }

  const { results, baseScenario, vulnerabilities: rankedVulns, vulnerabilitySummary } =
    buildScenarioResults(inputs, confidence)

  const executiveSummary = await buildExecutiveSummary(inputs, results, rankedVulns)

  let vulnerabilities = rankedVulns

  // Skip AI narratives entirely when no key is configured.
  const canEnrich = enrichNarratives !== 'none' && isAIAvailable()

  // Optionally enrich the top vulnerabilities with AI narratives synchronously.
  if (canEnrich && enrichNarratives === 'sync') {
    try {
      const narratives = await generateAllVulnerabilityNarratives(
        rankedVulns,
        inputs,
        baseScenario.breakEven
      )
      vulnerabilities = enrichVulnerabilities(rankedVulns, narratives)
    } catch (err) {
      console.error('Vulnerability narrative generation failed:', err)
    }
  }

  const analysisId = generateId()
  const session = {
    id: analysisId,
    inputs,
    confidence,
    scenarios: results,
    vulnerabilities,
    vulnerabilitySummary,
    executiveSummary,
    status: 'completed',
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString()
  }

  if (persist) {
    await addSession(session)
  }

  // Fire-and-forget enrichment: generate narratives in the background and patch
  // the stored session when done. Preserves the original REST API behaviour.
  if (canEnrich && enrichNarratives === 'async' && persist) {
    generateAllVulnerabilityNarratives(rankedVulns, inputs, baseScenario.breakEven)
      .then(narratives => {
        const enriched = enrichVulnerabilities(rankedVulns, narratives)
        return updateSession(analysisId, { vulnerabilities: enriched })
      })
      .catch(err => console.error('Vulnerability narrative generation failed:', err))
  }

  return session
}
