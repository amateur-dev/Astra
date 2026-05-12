const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { userDataPath } = require('./paths');

class DBManager {
  constructor() {
    this.dbPath = path.join(userDataPath, 'memory.db');
    this.db = null;
    this.init();
  }

  init() {
    try {
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      // Create Tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transcripts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          raw_text TEXT,
          polished_text TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          embedding BLOB
        );

        CREATE TABLE IF NOT EXISTS vocabulary (
          original TEXT PRIMARY KEY,
          corrected TEXT,
          frequency INTEGER DEFAULT 1,
          last_used DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT
        );

        CREATE TABLE IF NOT EXISTS summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT,
          start_date DATETIME,
          end_date DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log('Database initialized at:', this.dbPath);
    } catch (err) {
      console.error('Failed to initialize database:', err);
    }
  }

  // --- Archiving Operations ---

  getOldTranscripts(days = 7) {
    try {
      const stmt = this.db.prepare("SELECT * FROM transcripts WHERE timestamp < datetime('now', ?)");
      return stmt.all(`-${days} days`);
    } catch (err) {
      console.error('Failed to fetch old transcripts:', err);
      return [];
    }
  }

  deleteOldTranscripts(days = 7) {
    try {
      const stmt = this.db.prepare("DELETE FROM transcripts WHERE timestamp < datetime('now', ?)");
      const info = stmt.run(`-${days} days`);
      return info.changes;
    } catch (err) {
      console.error('Failed to delete old transcripts:', err);
      return 0;
    }
  }

  insertSummary(content, startDate, endDate) {
    try {
      const stmt = this.db.prepare('INSERT INTO summaries (content, start_date, end_date) VALUES (?, ?, ?)');
      stmt.run(content, startDate, endDate);
    } catch (err) {
      console.error('Failed to insert summary:', err);
    }
  }

  getRecentSummaries(limit = 5) {
    try {
      return this.db.prepare('SELECT content FROM summaries ORDER BY created_at DESC LIMIT ?').all(limit);
    } catch (err) {
      console.error('Failed to fetch summaries:', err);
      return [];
    }
  }

  // --- Transcript Operations ---
  
  insertTranscript(rawText, polishedText, embedding = null) {
    try {
      const stmt = this.db.prepare('INSERT INTO transcripts (raw_text, polished_text, embedding) VALUES (?, ?, ?)');
      const info = stmt.run(rawText, polishedText, embedding);
      return info.lastInsertRowid;
    } catch (err) {
      console.error('Failed to insert transcript:', err);
      return null;
    }
  }

  getRecentTranscripts(limit = 10) {
    try {
      return this.db.prepare('SELECT * FROM transcripts ORDER BY timestamp DESC LIMIT ?').all(limit);
    } catch (err) {
      console.error('Failed to fetch recent transcripts:', err);
      return [];
    }
  }

  // --- Vocabulary Operations ---

  addCorrection(original, corrected) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO vocabulary (original, corrected, frequency, last_used) 
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(original) DO UPDATE SET 
          corrected = excluded.corrected,
          frequency = vocabulary.frequency + 1,
          last_used = CURRENT_TIMESTAMP
      `);
      stmt.run(original.toLowerCase(), corrected);
    } catch (err) {
      console.error('Failed to add correction:', err);
    }
  }

  getVocabulary() {
    try {
      return this.db.prepare('SELECT original, corrected FROM vocabulary ORDER BY frequency DESC').all();
    } catch (err) {
      console.error('Failed to fetch vocabulary:', err);
      return [];
    }
  }

  // --- Search Operations ---

  searchTranscripts(query, limit = 5) {
    // Simple keyword search for now
    try {
      const stmt = this.db.prepare('SELECT * FROM transcripts WHERE raw_text LIKE ? OR polished_text LIKE ? ORDER BY timestamp DESC LIMIT ?');
      return stmt.all(`%${query}%`, `%${query}%`, limit);
    } catch (err) {
      console.error('Failed to search transcripts:', err);
      return [];
    }
  }

  // --- Semantic Search ---

  getSimilarTranscripts(embedding, limit = 3) {
    try {
      if (!embedding) return [];

      // Fetch all transcripts with embeddings
      const allTranscripts = this.db.prepare('SELECT id, raw_text, polished_text, embedding FROM transcripts WHERE embedding IS NOT NULL').all();
      
      const targetVector = new Float32Array(embedding.buffer, embedding.byteOffset, embedding.byteLength / 4);
      
      const scored = allTranscripts.map(t => {
        const sourceVector = new Float32Array(t.embedding.buffer, t.embedding.byteOffset, t.embedding.byteLength / 4);
        return {
          ...t,
          score: this.cosineSimilarity(targetVector, sourceVector)
        };
      });

      // Sort by score descending and return top matches
      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .filter(t => t.score > 0.7); // Only return high-confidence matches
    } catch (err) {
      console.error('Failed semantic search:', err);
      return [];
    }
  }

  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = new DBManager();
