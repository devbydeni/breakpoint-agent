import { runAnalysis } from '../core/analysisEngine.js'
import { readSessions, getSession, updateSession } from '../core/sessionStore.js'

export async function createAnalysis(req, res, next) {
  try {
    const { inputs, confidence } = req.body

    if (!inputs || !inputs.businessType) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid input data' }
      })
    }

    // Run the shared pipeline. Narratives are generated in the background
    // (async) so the response stays fast, matching the original behaviour.
    const session = await runAnalysis({
      inputs,
      confidence,
      persist: true,
      enrichNarratives: 'async'
    })

    res.json({
      success: true,
      data: {
        analysisId: session.id,
        status: 'completed',
        scenarioCount: session.scenarios.length
      }
    })
  } catch (error) {
    next(error)
  }
}

export async function getAnalysis(req, res, next) {
  try {
    const { id } = req.params
    const session = await getSession(id)

    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: 'Analysis not found' }
      })
    }

    res.json({
      success: true,
      data: session
    })
  } catch (error) {
    next(error)
  }
}

export async function listSessions(req, res, next) {
  try {
    const sessions = await readSessions()

    const sessionList = sessions.map(s => {
      const baseScenario = s.scenarios?.find(sc => sc.isBase)
      const topVuln = s.vulnerabilities?.[0]
      return {
        id: s.id,
        businessName: s.inputs?.businessType || 'Untitled',
        businessType: s.inputs?.businessType,
        lastModified: s.lastModified,
        createdAt: s.createdAt,
        status: s.status,
        breakEven: baseScenario?.breakEven,
        ltvCac: baseScenario?.ltvCac,
        highestRisk: topVuln?.assumption,
        sparkLineData: baseScenario?.monthlyData?.slice(0, 12).map(d => ({ revenue: d.revenue })) || []
      }
    })

    // Sort by last modified (newest first)
    sessionList.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))

    res.json({
      success: true,
      data: sessionList
    })
  } catch (error) {
    next(error)
  }
}

export async function saveSession(req, res, next) {
  try {
    const { id } = req.params
    const { results, businessName } = req.body

    const existing = await getSession(id)
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { message: 'Session not found' }
      })
    }

    const updated = await updateSession(id, {
      results,
      businessName: businessName || existing.businessName,
      status: 'completed'
    })

    res.json({
      success: true,
      data: updated
    })
  } catch (error) {
    next(error)
  }
}

export async function compareSessions(req, res, next) {
  try {
    const { ids } = req.query

    if (!ids) {
      return res.status(400).json({
        success: false,
        error: { message: 'Session IDs required' }
      })
    }

    const sessionIds = ids.split(',')
    if (sessionIds.length !== 2) {
      return res.status(400).json({
        success: false,
        error: { message: 'Exactly 2 session IDs required for comparison' }
      })
    }

    const sessions = await readSessions()
    const comparison = sessionIds.map(id => sessions.find(s => s.id === id)).filter(Boolean)

    if (comparison.length !== 2) {
      return res.status(404).json({
        success: false,
        error: { message: 'One or both sessions not found' }
      })
    }

    res.json({
      success: true,
      data: {
        sessionA: comparison[0],
        sessionB: comparison[1]
      }
    })
  } catch (error) {
    next(error)
  }
}
