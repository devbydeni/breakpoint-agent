#!/usr/bin/env node
// BreakPoint Agent — command line interface.
//
// Runs the analysis pipeline in-process (no server required). AI features
// (executive summary, vulnerability narratives, chat) activate automatically
// when GEMINI_API_KEY is set; otherwise the CLI falls back to deterministic
// output so it always works offline.

import fs from 'fs/promises'
import readline from 'readline'
import dotenv from 'dotenv'

import { runAnalysis } from '../core/analysisEngine.js'
import { readSessions, getSession } from '../core/sessionStore.js'
import { generateChatResponse } from '../ai/chatHandler.js'
import { isAIAvailable, testConnection } from '../ai/geminiClient.js'
import { INPUT_FIELDS, EXAMPLE_INPUTS, validateInputs } from '../core/inputSchema.js'
import { renderAnalysis, renderScenarios, renderSessionList } from '../core/presenter.js'

dotenv.config()

// ---------------------------------------------------------------------------
// Tiny argument parser: positionals + --flags (--k v, --k=v) + boolean flags.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const positionals = []
  const flags = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const body = arg.slice(2)
      if (body.includes('=')) {
        const [k, ...rest] = body.split('=')
        flags[k] = rest.join('=')
      } else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--') && !next.startsWith('-')) {
          flags[body] = next
          i++
        } else {
          flags[body] = true
        }
      }
    } else if (arg === '-i') {
      flags.interactive = true
    } else {
      positionals.push(arg)
    }
  }
  return { positionals, flags }
}

// Gracefully ignore EPIPE (e.g. when output is piped to `head` and closed early).
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0) })

function out(text) { process.stdout.write(text + '\n') }
function errOut(text) { process.stderr.write(text + '\n') }

// Build inputs from --flag values matching schema keys.
function inputsFromFlags(flags) {
  const raw = {}
  for (const field of INPUT_FIELDS) {
    if (flags[field.key] !== undefined) raw[field.key] = flags[field.key]
  }
  return raw
}

// Interactive prompt for each field via readline.
async function promptInputs() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q) => new Promise(resolve => rl.question(q, resolve))
  const raw = {}

  out('\nEnter your business model assumptions (press Enter to accept defaults):\n')
  for (const field of INPUT_FIELDS) {
    const def = field.default !== undefined ? ` [${field.default}]` : ''
    const req = field.required ? ' *' : ''
    const answer = await ask(`  ${field.label}${req}${def}\n    (${field.hint}): `)
    if (answer.trim() !== '') raw[field.key] = answer.trim()
  }
  rl.close()
  return raw
}

async function loadInputsFromFile(path) {
  const data = await fs.readFile(path, 'utf-8')
  const parsed = JSON.parse(data)
  // Accept either the raw inputs object or a { inputs, confidence } envelope.
  if (parsed.inputs) return { raw: parsed.inputs, confidence: parsed.confidence || {} }
  return { raw: parsed, confidence: {} }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdAnalyze(flags) {
  let raw = {}
  let confidence = {}

  if (flags.file) {
    const loaded = await loadInputsFromFile(flags.file)
    raw = loaded.raw
    confidence = loaded.confidence
  } else if (flags.interactive) {
    raw = await promptInputs()
  } else {
    raw = inputsFromFlags(flags)
  }

  const { valid, errors, inputs } = validateInputs(raw)
  if (!valid) {
    errOut('Input validation failed:')
    errors.forEach(e => errOut('  - ' + e))
    errOut('\nTip: pass --file <input.json>, use -i for interactive mode, or provide --<field> flags.')
    errOut('Run "breakpoint help" to see all fields.')
    process.exitCode = 1
    return
  }

  const useAI = flags['no-ai'] ? false : isAIAvailable()
  if (!flags.json) {
    out(`Running analysis${useAI ? ' (with AI narratives)' : ' (deterministic — no GEMINI_API_KEY set)'}...`)
  }

  const session = await runAnalysis({
    inputs,
    confidence,
    persist: true,
    enrichNarratives: useAI ? 'sync' : 'none'
  })

  if (flags.json) {
    out(JSON.stringify(session, null, 2))
  } else {
    out('')
    out(renderAnalysis(session))
    out('')
    out(renderScenarios(session))
    out('')
    out(`Saved as ${session.id}. Ask follow-ups with:  breakpoint chat ${session.id} "your question"`)
  }
}

async function cmdExample(flags) {
  const useAI = flags['no-ai'] ? false : isAIAvailable()
  if (!flags.json) out('Running example SaaS analysis...')

  const session = await runAnalysis({
    inputs: EXAMPLE_INPUTS,
    persist: true,
    enrichNarratives: useAI ? 'sync' : 'none'
  })

  if (flags.json) {
    out(JSON.stringify(session, null, 2))
  } else {
    out('')
    out(renderAnalysis(session))
    out('')
    out(renderScenarios(session))
  }
}

async function cmdSessions(flags) {
  const sessions = await readSessions()
  if (flags.json) {
    out(JSON.stringify(sessions.map(s => ({ id: s.id, businessType: s.inputs?.businessType, lastModified: s.lastModified })), null, 2))
  } else {
    out(renderSessionList(sessions))
  }
}

async function cmdShow(positionals, flags) {
  const id = positionals[0]
  if (!id) { errOut('Usage: breakpoint show <analysisId>'); process.exitCode = 1; return }

  const session = await getSession(id)
  if (!session) { errOut(`Analysis not found: ${id}`); process.exitCode = 1; return }

  if (flags.json) {
    out(JSON.stringify(session, null, 2))
  } else {
    out(renderAnalysis(session))
    if (flags.scenarios) { out(''); out(renderScenarios(session)) }
  }
}

async function cmdChat(positionals) {
  const id = positionals[0]
  const message = positionals.slice(1).join(' ')

  if (!id || !message) {
    errOut('Usage: breakpoint chat <analysisId> "<your question>"')
    process.exitCode = 1
    return
  }
  if (!isAIAvailable()) {
    errOut('Chat requires GEMINI_API_KEY to be set in your environment / .env file.')
    process.exitCode = 1
    return
  }

  const sessions = await readSessions()
  const result = await generateChatResponse(message, id, sessions)

  if (result.success) {
    out(result.data)
  } else {
    errOut('Error: ' + (result.error?.userMessage || result.error?.message || 'Unable to generate response'))
    process.exitCode = 1
  }
}

async function cmdHealth(flags) {
  const status = {
    cli: 'ok',
    aiConfigured: isAIAvailable(),
    node: process.version
  }
  if (flags.test && isAIAvailable()) {
    if (!flags.json) out('Testing Gemini connection...')
    status.aiConnection = (await testConnection()) ? 'ok' : 'failed'
  }
  if (flags.json) {
    out(JSON.stringify(status, null, 2))
  } else {
    out('BreakPoint CLI health')
    out(`- CLI: ${status.cli}`)
    out(`- Node: ${status.node}`)
    out(`- Gemini API key: ${status.aiConfigured ? 'configured' : 'not set (deterministic mode)'}`)
    if (status.aiConnection) out(`- Gemini connection: ${status.aiConnection}`)
  }
}

function cmdHelp() {
  out(`BreakPoint Agent CLI

Usage: breakpoint <command> [options]

Commands:
  analyze              Run a full analysis. Provide inputs one of three ways:
                         --file <input.json>     Load inputs from a JSON file
                         -i, --interactive       Answer guided prompts
                         --<field> <value>       Pass fields as flags
  example              Run a ready-made SaaS example analysis
  sessions             List saved analyses
  show <id>            Show a saved analysis (add --scenarios for the table)
  chat <id> "<q>"      Ask a follow-up question about an analysis (needs AI key)
  health [--test]      Show CLI/AI status (--test pings Gemini)
  help                 Show this help

Global options:
  --json               Output raw JSON instead of formatted text
  --no-ai              Skip AI narratives even if a key is configured

Input fields (* = required):`)
  for (const f of INPUT_FIELDS) {
    const req = f.required ? '*' : ' '
    out(`  ${req} --${f.key.padEnd(22)} ${f.hint}`)
  }
  out(`
Examples:
  breakpoint example
  breakpoint analyze --businessType saas --pricing 49 --monthlyChurn 5 \\
      --cac 200 --fixedCosts 15000 --monthlyNewCustomers 50
  breakpoint analyze --file my-model.json --json
  breakpoint sessions
  breakpoint chat analysis-123 "What's my biggest risk?"
`)
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2))
  const command = positionals.shift() || 'help'

  try {
    switch (command) {
      case 'analyze': await cmdAnalyze(flags); break
      case 'example': await cmdExample(flags); break
      case 'sessions': await cmdSessions(flags); break
      case 'show': await cmdShow(positionals, flags); break
      case 'chat': await cmdChat(positionals); break
      case 'health': await cmdHealth(flags); break
      case 'help':
      case '--help':
      case '-h': cmdHelp(); break
      default:
        errOut(`Unknown command: ${command}`)
        cmdHelp()
        process.exitCode = 1
    }
  } catch (error) {
    errOut('Error: ' + (error?.message || error))
    process.exitCode = 1
  }
}

main()
