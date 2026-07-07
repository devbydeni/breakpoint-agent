// BreakPoint Agent — Telegram bot.
//
// A dependency-free long-polling bot (uses the global fetch in Node 18+).
// It runs the same in-process analysis pipeline as the CLI and REST API via
// the shared core engine, so results are identical across every channel.
//
// Setup:
//   1. Create a bot with @BotFather and copy the token.
//   2. Put TELEGRAM_BOT_TOKEN=<token> in your .env (GEMINI_API_KEY optional).
//   3. Run: npm run bot
//
// Commands: /start /help /analyze /example /sessions /result /chat /cancel

import dotenv from 'dotenv'
import { runAnalysis } from '../core/analysisEngine.js'
import { readSessions, getSession } from '../core/sessionStore.js'
import { generateChatResponse } from '../ai/chatHandler.js'
import { isAIAvailable } from '../ai/geminiClient.js'
import { INPUT_FIELDS, EXAMPLE_INPUTS, validateInputs, coerceValue } from '../core/inputSchema.js'
import { renderAnalysis, renderSessionList } from '../core/presenter.js'

dotenv.config()

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const API_BASE = `https://api.telegram.org/bot${TOKEN}`
const TELEGRAM_MAX = 4000 // stay under Telegram's 4096-char message limit

// Per-chat conversation state for the guided /analyze flow.
// chatId -> { step, raw, lastAnalysisId }
const state = new Map()

function getState(chatId) {
  if (!state.has(chatId)) state.set(chatId, { step: -1, raw: {}, lastAnalysisId: null })
  return state.get(chatId)
}

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------
async function tg(method, params) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  return res.json()
}

// Send a message, splitting long text into multiple chunks.
async function send(chatId, text) {
  for (let i = 0; i < text.length; i += TELEGRAM_MAX) {
    await tg('sendMessage', { chat_id: chatId, text: text.slice(i, i + TELEGRAM_MAX) })
  }
}

// ---------------------------------------------------------------------------
// Message content
// ---------------------------------------------------------------------------
const HELP = `BreakPoint Agent — stress-test your business model.

Commands:
/analyze  — guided walkthrough to enter your assumptions
/example  — run a ready-made SaaS example
/sessions — list your recent analyses
/result   — show your most recent analysis (or /result <id>)
/chat <question> — ask about your latest analysis${isAIAvailable() ? '' : ' (needs GEMINI_API_KEY)'}
/cancel   — stop the current walkthrough
/help     — show this message

Tip: during /analyze, send "skip" to accept the default for optional fields.`

function fieldPrompt(field) {
  const req = field.required ? ' (required)' : ' (optional — send "skip" to use default'
    + (field.default !== undefined ? ` ${JSON.stringify(field.default)}` : '') + ')'
  return `${field.label}${req}\n${field.hint}`
}

// ---------------------------------------------------------------------------
// Analyze flow
// ---------------------------------------------------------------------------
async function startAnalyze(chatId) {
  const s = getState(chatId)
  s.step = 0
  s.raw = {}
  await send(chatId, 'Let\'s stress-test your business model. Answer each question. Send /cancel anytime.')
  await send(chatId, `Question 1/${INPUT_FIELDS.length}\n\n${fieldPrompt(INPUT_FIELDS[0])}`)
}

async function handleAnalyzeAnswer(chatId, text) {
  const s = getState(chatId)
  const field = INPUT_FIELDS[s.step]
  const answer = text.trim()

  const skipping = answer.toLowerCase() === 'skip'

  if (skipping && field.required) {
    await send(chatId, `${field.label} is required — please provide a value.\n\n${fieldPrompt(field)}`)
    return
  }

  if (!skipping) {
    // Validate this single field
    const coerced = coerceValue(field, answer)
    if (coerced === undefined) {
      await send(chatId, `That doesn't look like a valid ${field.type}. Try again.\n\n${fieldPrompt(field)}`)
      return
    }
    if (field.type === 'enum' && !field.options.includes(coerced)) {
      await send(chatId, `Please choose one of: ${field.options.join(', ')}\n\n${fieldPrompt(field)}`)
      return
    }
    s.raw[field.key] = answer
  }

  s.step++

  if (s.step < INPUT_FIELDS.length) {
    await send(chatId, `Question ${s.step + 1}/${INPUT_FIELDS.length}\n\n${fieldPrompt(INPUT_FIELDS[s.step])}`)
    return
  }

  // All fields collected — validate and run.
  const { valid, errors, inputs } = validateInputs(s.raw)
  s.step = -1
  if (!valid) {
    await send(chatId, 'Some inputs were invalid:\n' + errors.map(e => '- ' + e).join('\n') + '\n\nSend /analyze to try again.')
    return
  }

  await runAndReply(chatId, inputs)
}

// ---------------------------------------------------------------------------
// Run analysis + reply
// ---------------------------------------------------------------------------
async function runAndReply(chatId, inputs) {
  await send(chatId, `Running analysis${isAIAvailable() ? ' with AI narratives' : ' (deterministic mode)'}... this may take a few seconds.`)
  try {
    const session = await runAnalysis({
      inputs,
      persist: true,
      enrichNarratives: isAIAvailable() ? 'sync' : 'none'
    })
    getState(chatId).lastAnalysisId = session.id
    await send(chatId, renderAnalysis(session))
    await send(chatId, `Saved as ${session.id}\nAsk a follow-up with:  /chat your question here`)
  } catch (error) {
    await send(chatId, 'Analysis failed: ' + (error?.message || 'unknown error'))
  }
}

async function handleChat(chatId, question) {
  if (!isAIAvailable()) {
    await send(chatId, 'Chat requires GEMINI_API_KEY to be configured on the server running the bot.')
    return
  }
  const s = getState(chatId)
  if (!s.lastAnalysisId) {
    await send(chatId, 'No analysis yet. Run /analyze or /example first.')
    return
  }
  if (!question) {
    await send(chatId, 'Usage: /chat <your question>')
    return
  }
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' })
  const sessions = await readSessions()
  const result = await generateChatResponse(question, s.lastAnalysisId, sessions)
  await send(chatId, result.success ? result.data : ('Error: ' + (result.error?.userMessage || result.error?.message || 'unable to respond')))
}

async function handleResult(chatId, id) {
  const s = getState(chatId)
  const targetId = id || s.lastAnalysisId
  if (!targetId) {
    await send(chatId, 'No analysis to show. Run /analyze or /example first.')
    return
  }
  const session = await getSession(targetId)
  if (!session) {
    await send(chatId, `Analysis not found: ${targetId}`)
    return
  }
  await send(chatId, renderAnalysis(session))
}

async function handleSessions(chatId) {
  const sessions = await readSessions()
  await send(chatId, renderSessionList(sessions))
}

// ---------------------------------------------------------------------------
// Update router
// ---------------------------------------------------------------------------
async function handleUpdate(update) {
  const msg = update.message
  if (!msg || !msg.text) return
  const chatId = msg.chat.id
  const text = msg.text.trim()

  // Slash commands
  if (text.startsWith('/')) {
    const [rawCmd, ...rest] = text.split(/\s+/)
    const cmd = rawCmd.split('@')[0].toLowerCase() // strip @botname
    const arg = rest.join(' ')

    switch (cmd) {
      case '/start':
      case '/help': await send(chatId, HELP); return
      case '/analyze': await startAnalyze(chatId); return
      case '/example': getState(chatId).step = -1; await runAndReply(chatId, EXAMPLE_INPUTS); return
      case '/sessions': await handleSessions(chatId); return
      case '/result': await handleResult(chatId, arg || null); return
      case '/chat': await handleChat(chatId, arg); return
      case '/cancel':
        getState(chatId).step = -1
        await send(chatId, 'Cancelled. Send /analyze to start over.')
        return
      default:
        await send(chatId, 'Unknown command. Send /help for options.')
        return
    }
  }

  // Non-command text: continue an active /analyze flow, else nudge.
  const s = getState(chatId)
  if (s.step >= 0 && s.step < INPUT_FIELDS.length) {
    await handleAnalyzeAnswer(chatId, text)
  } else {
    await send(chatId, 'Send /help to see what I can do, or /analyze to begin.')
  }
}

// ---------------------------------------------------------------------------
// Long-polling loop
// ---------------------------------------------------------------------------
async function poll() {
  let offset = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await tg('getUpdates', { offset, timeout: 30 })
      if (res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          offset = update.update_id + 1
          handleUpdate(update).catch(err => console.error('Update handler error:', err))
        }
      }
    } catch (error) {
      console.error('Polling error:', error.message)
      await new Promise(r => setTimeout(r, 3000)) // back off then retry
    }
  }
}

async function main() {
  if (!TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is not set. Add it to your .env file (get one from @BotFather).')
    process.exit(1)
  }

  const me = await tg('getMe', {})
  if (!me.ok) {
    console.error('Failed to authenticate with Telegram. Check TELEGRAM_BOT_TOKEN.')
    process.exit(1)
  }

  console.log(`✓ BreakPoint Telegram bot running as @${me.result.username}`)
  console.log(`✓ AI features: ${isAIAvailable() ? 'enabled' : 'disabled (deterministic mode)'}`)
  console.log('✓ Listening for messages (Ctrl+C to stop)')

  await poll()
}

main()
