import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { apiKeyAuth, apiKeyEnabled } from './middleware/apiKeyAuth.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Service metadata used by the discovery endpoints
const API_INFO = {
  name: 'BreakPoint Agent API',
  description: 'AI-powered business model stress-testing engine',
  version: '1.0.0',
  authRequired: apiKeyEnabled(),
  endpoints: [
    { method: 'GET', path: '/api/health', description: 'Health check (always public)' },
    { method: 'POST', path: '/api/analyze', description: 'Run full analysis on business model inputs' },
    { method: 'GET', path: '/api/analyze/:id', description: 'Fetch a completed analysis by id' },
    { method: 'POST', path: '/api/chat', description: 'Contextual Q&A about results (supports streaming)' },
    { method: 'POST', path: '/api/ai/input-assist', description: 'AI suggestions for an input field' },
    { method: 'GET', path: '/api/vulnerabilities/:analysisId', description: 'Enriched vulnerability list for an analysis' },
    { method: 'GET', path: '/api/sessions', description: 'List saved analysis sessions' },
    { method: 'GET', path: '/api/sessions/compare?ids=id1,id2', description: 'Compare two sessions' }
  ]
}

// Discovery endpoints (public) — describe the API to clients/CLIs.
app.get('/', (req, res) => res.json({ success: true, data: API_INFO }))
app.get('/api', (req, res) => res.json({ success: true, data: API_INFO }))

// Health check endpoint (always public — used by monitors and the CLI)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    authRequired: apiKeyEnabled()
  })
})

// Optional API-key auth. No-op unless API_KEY is configured. Applied to all
// /api routes declared after this point (health above stays public).
app.use('/api', apiKeyAuth)

// API routes
import analysisRoutes from './routes/analysis.js'
import sessionsRoutes from './routes/sessions.js'
import aiRoutes from './routes/ai.js'
import vulnerabilitiesRoutes from './routes/vulnerabilities.js'
import chatRoutes from './routes/chat.js'

app.use('/api/analyze', analysisRoutes)
app.use('/api/sessions', sessionsRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/vulnerabilities', vulnerabilitiesRoutes)
app.use('/api/chat', chatRoutes)

// Error handling
app.use(notFoundHandler)
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`✓ BreakPoint server running on port ${PORT}`)
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`✓ API key auth: ${apiKeyEnabled() ? 'enabled' : 'disabled (open)'}`)
  console.log(`✓ Health check: http://localhost:${PORT}/api/health`)
})

export default app
