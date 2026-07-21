/*
 * Google Apps Script reminder backend for the Kendu Telegram bot.
 *
 * Setup:
 * 1. Create a Google Sheet.
 * 2. Extensions -> Apps Script.
 * 3. Paste this file into Code.gs.
 * 4. Project Settings -> Script properties:
 *    - TELEGRAM_BOT_TOKEN: your Telegram bot token
 *    - REMINDER_SECRET: a long random shared secret
 * 5. Run setupReminders() once and approve permissions.
 * 6. Deploy -> New deployment -> Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 7. Copy the Web app URL into Vercel as GOOGLE_REMINDER_WEBAPP_URL.
 * 8. Copy REMINDER_SECRET into Vercel as GOOGLE_REMINDER_SECRET.
 */

const SHEET_NAME = 'Reminders'
const SETTINGS_SHEET_NAME = 'Settings'
const REMINDERS_ENABLED_KEY = 'remindersEnabled'
const HEADERS = [
  'id',
  'chatId',
  'chatTitle',
  'message',
  'dueAt',
  'dueAtIso',
  'status',
  'createdAt',
  'createdBy',
  'sentAt',
  'attempts',
  'lastError',
]

function setupReminders() {
  getReminderSheet()
  getSettingsSheet()
  if (getSetting(REMINDERS_ENABLED_KEY) === '') setSetting(REMINDERS_ENABLED_KEY, 'true')

  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'sendDueReminders')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger))

  ScriptApp.newTrigger('sendDueReminders')
    .timeBased()
    .everyMinutes(1)
    .create()
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}')
    assertSecret(data.secret)

    if (data.action === 'schedule') return json(scheduleReminder(data.reminder))
    if (data.action === 'list') return json(listReminders(data.chatId))
    if (data.action === 'cancel') return json(cancelReminder(data.chatId, data.id))
    if (data.action === 'getEnabled') return json({ ok: true, enabled: remindersEnabled() })
    if (data.action === 'setEnabled') return json(setRemindersEnabled(data.enabled))

    return json({ ok: false, error: 'Unknown action' })
  } catch (err) {
    return json({ ok: false, error: err.message })
  }
}

function scheduleReminder(reminder) {
  if (!reminder || !reminder.id || !reminder.chatId || !reminder.message || !reminder.dueAt) {
    throw new Error('Invalid reminder')
  }

  const sheet = getReminderSheet()
  const dueAt = Number(reminder.dueAt)
  const createdAt = Number(reminder.createdAt || Date.now())

  sheet.appendRow([
    reminder.id,
    String(reminder.chatId),
    reminder.chatTitle || '',
    reminder.message,
    dueAt,
    new Date(dueAt).toISOString(),
    'PENDING',
    createdAt,
    reminder.createdBy || '',
    '',
    0,
    '',
  ])

  return { ok: true, id: reminder.id }
}

function listReminders(chatId) {
  const sheet = getReminderSheet()
  const rows = getRows(sheet)
  const targetChatId = String(chatId)

  const reminders = rows
    .filter(row => String(row.chatId) === targetChatId && row.status === 'PENDING')
    .sort((a, b) => Number(a.dueAt) - Number(b.dueAt))
    .slice(0, 10)
    .map(row => ({
      id: row.id,
      dueAt: Number(row.dueAt),
      preview: stripHTML(row.message).slice(0, 160),
    }))

  return { ok: true, reminders }
}

function cancelReminder(chatId, id) {
  const sheet = getReminderSheet()
  const values = sheet.getDataRange().getValues()
  const idx = headerIndex(values[0])
  const targetChatId = String(chatId)
  const targetId = String(id).toUpperCase()

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idx.chatId]) === targetChatId &&
        String(values[r][idx.id]).toUpperCase() === targetId &&
        values[r][idx.status] === 'PENDING') {
      sheet.getRange(r + 1, idx.status + 1).setValue('CANCELED')
      return { ok: true, cancelled: true }
    }
  }

  return { ok: true, cancelled: false }
}

function sendDueReminders() {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(25000)) return

  try {
    const token = getRequiredProperty('TELEGRAM_BOT_TOKEN')
    const sheet = getReminderSheet()
    const values = sheet.getDataRange().getValues()
    if (values.length < 2) return

    const idx = headerIndex(values[0])
    const now = Date.now()

    for (let r = 1; r < values.length; r++) {
      const row = values[r]
      if (row[idx.status] !== 'PENDING') continue
      if (Number(row[idx.dueAt]) > now) continue

      const rowNumber = r + 1
      const attempts = Number(row[idx.attempts] || 0) + 1
      sheet.getRange(rowNumber, idx.attempts + 1).setValue(attempts)

      try {
        sendTelegramMessage(token, row[idx.chatId], row[idx.message])
        sheet.getRange(rowNumber, idx.status + 1).setValue('SENT')
        sheet.getRange(rowNumber, idx.sentAt + 1).setValue(new Date().toISOString())
        sheet.getRange(rowNumber, idx.lastError + 1).setValue('')
      } catch (err) {
        sheet.getRange(rowNumber, idx.lastError + 1).setValue(err.message)
        if (attempts >= 3) sheet.getRange(rowNumber, idx.status + 1).setValue('FAILED')
      }
    }
  } finally {
    lock.releaseLock()
  }
}

function sendTelegramMessage(token, chatId, message) {
  const res = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })

  const code = res.getResponseCode()
  const body = res.getContentText()
  if (code < 200 || code >= 300) throw new Error(`Telegram ${code}: ${body}`)

  const jsonBody = JSON.parse(body)
  if (!jsonBody.ok) throw new Error(jsonBody.description || 'Telegram send failed')
}

function getReminderSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  let sheet = ss.getSheetByName(SHEET_NAME)
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME)

  const existing = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0]
  const missingHeaders = HEADERS.some((header, i) => existing[i] !== header)
  if (missingHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    sheet.setFrozenRows(1)
  }

  return sheet
}

function getSettingsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME)
  if (!sheet) sheet = ss.insertSheet(SETTINGS_SHEET_NAME)

  const headers = sheet.getRange(1, 1, 1, 2).getValues()[0]
  if (headers[0] !== 'key' || headers[1] !== 'value') {
    sheet.getRange(1, 1, 1, 2).setValues([['key', 'value']])
    sheet.setFrozenRows(1)
  }

  return sheet
}

function remindersEnabled() {
  const value = getSetting(REMINDERS_ENABLED_KEY)
  return !/^(false|0|off|disabled)$/i.test(String(value || 'true').trim())
}

function setRemindersEnabled(enabled) {
  const normalized = Boolean(enabled)
  setSetting(REMINDERS_ENABLED_KEY, normalized ? 'true' : 'false')
  return { ok: true, enabled: normalized }
}

function getSetting(key) {
  const sheet = getSettingsSheet()
  const values = sheet.getDataRange().getValues()
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]) === key) return String(values[r][1] ?? '')
  }
  return ''
}

function setSetting(key, value) {
  const sheet = getSettingsSheet()
  const values = sheet.getDataRange().getValues()
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]) === key) {
      sheet.getRange(r + 1, 2).setValue(value)
      return
    }
  }
  sheet.appendRow([key, value])
}

function getRows(sheet) {
  const values = sheet.getDataRange().getValues()
  if (values.length < 2) return []
  const headers = values[0]
  return values.slice(1).map(row => {
    const item = {}
    headers.forEach((header, i) => item[header] = row[i])
    return item
  })
}

function headerIndex(headers) {
  const idx = {}
  headers.forEach((header, i) => idx[header] = i)
  return idx
}

function assertSecret(secret) {
  if (!secret || secret !== getRequiredProperty('REMINDER_SECRET')) {
    throw new Error('Unauthorized')
  }
}

function getRequiredProperty(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key)
  if (!value) throw new Error(`Missing script property: ${key}`)
  return value
}

function stripHTML(value) {
  return String(value || '').replace(/<[^>]*>/g, '')
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON)
}
