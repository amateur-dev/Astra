const fs = require('fs');
const path = require('path');
const { userDataPath } = require('./paths');
const dbManager = require('./db-manager');

class MemoryManager {
  constructor() {
    this.memoryPath = path.join(userDataPath, 'memory.json');
    this.migrateFromJson();
  }

  migrateFromJson() {
    try {
      if (fs.existsSync(this.memoryPath)) {
        console.log('Migrating memory.json to SQLite...');
        const data = fs.readFileSync(this.memoryPath, 'utf8');
        const json = JSON.parse(data);
        
        if (json.vocabulary) {
          for (const [original, corrected] of Object.entries(json.vocabulary)) {
            dbManager.addCorrection(original, corrected);
          }
        }
        
        if (json.recentTranscripts) {
          for (const entry of json.recentTranscripts) {
            dbManager.insertTranscript(entry.text, entry.text);
          }
        }
        
        // Backup and delete old file
        fs.renameSync(this.memoryPath, this.memoryPath + '.bak');
        console.log('Migration complete.');
      }
    } catch (err) {
      console.error('Failed to migrate memory from JSON:', err);
    }
  }

  addCorrection(original, corrected) {
    if (!original || !corrected || original === corrected) return;
    
    // Only treat as vocabulary if it's short (likely a specific name or jargon)
    if (original.split(' ').length <= 3) {
      dbManager.addCorrection(original, corrected);
    }
    
    // Log the full correction as a transcript entry for contextual learning
    dbManager.insertTranscript(original, corrected);
  }

  getMemoryContext() {
    let context = "USER'S PERSONAL VOCABULARY & PREFERENCES:\n";
    const vocabulary = dbManager.getVocabulary();
    
    if (vocabulary.length > 0) {
      const vocabLines = vocabulary
        .slice(0, 20) // Limit to top 20 most frequent corrections
        .map(v => `- "${v.original}" should usually be "${v.corrected}"`)
        .join('\n');
      context += vocabLines + '\n';
    } else {
      context += "- No specific vocabulary learned yet.\n";
    }

    const summaries = dbManager.getRecentSummaries(3);
    if (summaries.length > 0) {
      context += "\nUSER KNOWLEDGE PROFILE (learned from past history):\n";
      summaries.forEach(s => {
        context += s.content + "\n";
      });
    }

    return context;
  }

  async compactMemory(ollamaHandler) {
    console.log('Checking for memory compaction (OpenClaw style)...');
    
    // Safety check: ensure database is initialized before proceeding
    if (!dbManager.db) {
      console.warn('Memory compaction skipped: Database not initialized.');
      return;
    }

    const oldTranscripts = dbManager.getOldTranscripts(7); // Older than 7 days
    
    if (oldTranscripts.length < 5) {
      console.log('Not enough old transcripts to summarize.');
      return;
    }

    console.log(`Summarizing ${oldTranscripts.length} old transcripts...`);
    
    const textToSummarize = oldTranscripts
      .map(t => `- [${t.timestamp}] ${t.polished_text}`)
      .join('\n');

    const prompt = `You are a memory compaction agent.
Analyze the following list of voice-transcribed notes from the user's past week.
Extract key recurring topics, specific project names, jargon, or stylistic preferences.
Create a concise summary (max 3-5 sentences) that helps a future AI understand the user's context.

TRANSCRIPTS:
${textToSummarize}

Return ONLY the summary.`;

    try {
      const result = await ollamaHandler(prompt);
      if (result && result.ok) {
        const startDate = oldTranscripts[oldTranscripts.length - 1].timestamp;
        const endDate = oldTranscripts[0].timestamp;
        dbManager.insertSummary(result.text, startDate, endDate);
        const deleted = dbManager.deleteOldTranscripts(7);
        console.log(`Memory compacted. Summarized into new knowledge profile. Deleted ${deleted} raw entries.`);
      }
    } catch (err) {
      console.error('Compaction failed:', err);
    }
  }

  getSemanticContext(embedding) {
    if (!embedding) return "";
    
    const similar = dbManager.getSimilarTranscripts(embedding, 3);
    if (similar.length === 0) return "";

    let context = "\nRELEVANT PAST CONTEXT (for style and terminology):\n";
    similar.forEach(t => {
      context += `- User previously said: "${t.raw_text}" -> AI corrected to: "${t.polished_text}"\n`;
    });
    
    return context;
  }

  logTranscript(text, polishedText = null, embedding = null) {
    if (!text) return;
    dbManager.insertTranscript(text, polishedText || text, embedding);
  }
}

module.exports = new MemoryManager();
