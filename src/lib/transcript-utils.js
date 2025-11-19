// Utility functions for transcript cleaning and timestamp extraction.
// Pure helpers so they can be unit-tested separately from the Electron main
// process.
function cleanTranscript (text) {
  try {
    if (!text || typeof text !== 'string') return text
    // First, remove timestamp patterns like [00:00:00.000 --> 00:00:07.000] from the text
    // This handles both inline timestamps and standalone timestamp lines
    let cleaned = text.replace(/\[\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\s*-->\s*\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\]/g, '')
    // Also remove standalone timestamp patterns without brackets
    cleaned = cleaned.replace(/\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\s*-->\s*\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?/g, '')
    
    // Split into lines and clean each line
    const rawLines = cleaned.split(/\r?\n/)
    const lines = []
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i].trim()
      if (!line) continue
      // Remove common bullet markers
      line = line.replace(/^\s*[-*•]\s+/, '')
      // If this line starts the caveat about changes, stop processing further lines
      if (/^I made the following changes/i.test(line) || /^I made some changes/i.test(line)) break
      lines.push(line)
    }

    if (lines.length === 0) return ''
    // Join into a single paragraph and normalize whitespace
    let paragraph = lines.join(' ').replace(/\s+/g, ' ').trim()
    // Strip common leading labels that models sometimes add, e.g. "Here is the cleaned transcript:"
    paragraph = paragraph.replace(/^(?:here\s+is(?:\s+the)?|here'?s(?:\s+the)?|cleaned\s+transcript)[:\-\s]*/i, '')
    return paragraph
  } catch (err) {
    // On error, conservatively return the original text
    return text
  }
}

function extractTimestampFromText (text) {
  if (!text || typeof text !== 'string') return null
  // Check for common time patterns first
  const timeRegexes = [
    /\b\d{1,2}[:.]\d{2}\s*(?:AM|PM|am|pm)?\b/, // 7:30, 07:30 AM
    /\b\d{1,2}\s*(?:AM|PM|am|pm)\b/, // 7 AM
  ]
  for (const re of timeRegexes) {
    const m = text.match(re)
    if (m) return m[0]
  }

  // Ordinal dates like 11th, 2nd
  const ordinal = text.match(/\b\d{1,2}(?:st|nd|rd|th)\b/)
  if (ordinal) return ordinal[0]

  // Month + day like "November 11" or "Nov 11th"
  const month = text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?\b/i)
  if (month) return month[0]

  // Fallback: any 4-digit year
  const year = text.match(/\b\d{4}\b/)
  if (year) return year[0]

  return null
}

module.exports = { cleanTranscript, extractTimestampFromText }
