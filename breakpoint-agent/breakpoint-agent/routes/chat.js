import express from 'express'
import { readSessions } from '../core/sessionStore.js'
import { generateChatResponse, generateStreamingChatResponse } from '../ai/chatHandler.js'

const router = express.Router()

// POST /api/chat - Send chat message with analysis context
router.post('/', async (req, res, next) => {
  try {
    const { message, analysisId, streaming = false } = req.body

    if (!message || !analysisId) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Missing required fields: message, analysisId'
        }
      })
    }

    // Load sessions from the shared store
    const sessions = await readSessions()

    if (streaming) {
      // Streaming response for typewriter effect
      const result = await generateStreamingChatResponse(message, analysisId, sessions)

      if (!result.success) {
        return res.json({
          success: false,
          data: null,
          error: result.error
        })
      }

      // Set up Server-Sent Events
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      try {
        for await (const chunk of result.stream) {
          const text = chunk.text()
          res.write(`data: ${JSON.stringify({ text })}\n\n`)
        }
        res.write('data: [DONE]\n\n')
        res.end()
      } catch (streamError) {
        res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`)
        res.end()
      }
    } else {
      // Non-streaming response
      const result = await generateChatResponse(message, analysisId, sessions)

      res.json({
        success: result.success,
        data: result.success ? { message: result.data } : null,
        error: result.error
      })
    }
  } catch (error) {
    next(error)
  }
})

export default router
