// Centralized session storage.
// Single source of truth for reading/writing analysis sessions so that the
// REST API, CLI, and Telegram bot all share the same persisted state.

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// storage/sessions.json lives at the project root (../storage from /core)
const STORAGE_DIR = path.join(__dirname, '../storage')
const STORAGE_PATH = path.join(STORAGE_DIR, 'sessions.json')

export function getStoragePath() {
  return STORAGE_PATH
}

// Read all sessions. Returns [] when the file does not exist yet or is invalid.
export async function readSessions() {
  try {
    const data = await fs.readFile(STORAGE_PATH, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    return []
  }
}

// Persist the full sessions array, creating the storage directory if needed.
export async function writeSessions(sessions) {
  await fs.mkdir(STORAGE_DIR, { recursive: true })
  await fs.writeFile(STORAGE_PATH, JSON.stringify(sessions, null, 2), 'utf-8')
}

// Fetch a single session by id (or null).
export async function getSession(id) {
  const sessions = await readSessions()
  return sessions.find(s => s.id === id) || null
}

// Append a new session.
export async function addSession(session) {
  const sessions = await readSessions()
  sessions.push(session)
  await writeSessions(sessions)
  return session
}

// Merge a partial update into an existing session. Returns the updated
// session, or null when the id is not found.
export async function updateSession(id, patch) {
  const sessions = await readSessions()
  const index = sessions.findIndex(s => s.id === id)
  if (index === -1) return null

  sessions[index] = {
    ...sessions[index],
    ...patch,
    lastModified: new Date().toISOString()
  }
  await writeSessions(sessions)
  return sessions[index]
}

// Generate a unique analysis id.
export function generateId() {
  return `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}
