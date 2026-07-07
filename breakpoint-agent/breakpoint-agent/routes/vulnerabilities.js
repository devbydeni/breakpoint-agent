import express from 'express'
import { getSession } from '../core/sessionStore.js'

const router = express.Router()

// GET /api/vulnerabilities/:analysisId - Get enriched vulnerabilities
router.get('/:analysisId', async (req, res, next) => {
  try {
    const { analysisId } = req.params
    const session = await getSession(analysisId)

    if (!session) {
      return res.status(404).json({
        success: false,
        error: { message: 'Analysis not found' }
      })
    }

    res.json({
      success: true,
      data: {
        vulnerabilities: session.vulnerabilities,
        vulnerabilitySummary: session.vulnerabilitySummary
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
