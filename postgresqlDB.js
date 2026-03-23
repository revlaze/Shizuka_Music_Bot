const { Pool } = require("pg");
const config = require("./config");

const connectionString =
  config.postgresqlURL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRESQL_URL ||
  process.env.DATABASE_URL ||
  "";

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
    })
  : null;

let initialized = false;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function matchesObject(item, matcher) {
  if (!matcher || typeof matcher !== "object") return item === matcher;
  if (!item || typeof item !== "object") return false;
  return Object.entries(matcher).every(([key, value]) => item[key] === value);
}

function applyUpdateObject(baseDoc, update) {
  if (!update || typeof update !== "object") return baseDoc;

  const next = { ...baseDoc };

  if (update.$set && typeof update.$set === "object") {
    for (const [key, value] of Object.entries(update.$set)) {
      next[key] = value;
    }
  }

  if (update.$push && typeof update.$push === "object") {
    for (const [key, value] of Object.entries(update.$push)) {
      const list = asArray(next[key]);
      list.push(value);
      next[key] = list;
    }
  }

  if (update.$pull && typeof update.$pull === "object") {
    for (const [key, value] of Object.entries(update.$pull)) {
      const list = asArray(next[key]);
      next[key] = list.filter((item) => !matchesObject(item, value));
    }
  }

  const hasOperators = Object.keys(update).some((key) => key.startsWith("$"));
  if (!hasOperators) {
    for (const [key, value] of Object.entries(update)) {
      next[key] = value;
    }
  }

  return next;
}

function mapMusicbotRow(row) {
  if (!row) return null;
  return {
    guildID: row.guild_id,
    role: row.role || null,
    language: row.language || null,
    channels: asArray(row.channels),
  };
}

async function connect() {
  if (!pool) return false;
  if (initialized) return true;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS musicbot (
      guild_id TEXT PRIMARY KEY,
      role TEXT,
      language TEXT,
      channels JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);

  initialized = true;
  return true;
}

async function findMusicbot(filter = {}) {
  if (!pool) return null;
  const guildID = filter.guildID;
  if (!guildID) return null;

  const result = await pool.query(
    "SELECT guild_id, role, language, channels FROM musicbot WHERE guild_id = $1 LIMIT 1",
    [guildID],
  );
  return mapMusicbotRow(result.rows[0]);
}

async function updateMusicbot(filter = {}, update = {}, options = {}) {
  if (!pool) return { acknowledged: false };
  const guildID = filter.guildID;
  if (!guildID) return { acknowledged: false };

  const existing = await findMusicbot({ guildID });
  if (!existing && !options.upsert) {
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
  }

  const baseDoc = existing || {
    guildID,
    role: null,
    language: null,
    channels: [],
  };
  const nextDoc = applyUpdateObject(baseDoc, update);

  await pool.query(
    `
      INSERT INTO musicbot (guild_id, role, language, channels)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (guild_id)
      DO UPDATE SET
        role = EXCLUDED.role,
        language = EXCLUDED.language,
        channels = EXCLUDED.channels
    `,
    [guildID, nextDoc.role || null, nextDoc.language || null, JSON.stringify(asArray(nextDoc.channels))],
  );

  return { acknowledged: true, matchedCount: existing ? 1 : 0, modifiedCount: 1 };
}

module.exports = {
  pool,
  connect,
  musicbot: {
    findOne: findMusicbot,
    updateOne: updateMusicbot,
  },
};
