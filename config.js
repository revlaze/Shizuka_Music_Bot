function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enable", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseCsv(value, fallback = []) {
  if (!value || typeof value !== "string") return [...fallback];
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : [...fallback];
}

const ownerIDs = parseCsv(process.env.OWNER_IDS || process.env.OWNER_ID || "", []);

module.exports = {
  TOKEN: process.env.TOKEN || "",
  ownerID: ownerIDs,
  botInvite: process.env.BOT_INVITE || "",
  supportServer: process.env.SUPPORT_SERVER || "",
  postgresqlURL:
    process.env.DATABASE_URL ||
    process.env.POSTGRESQL_URL ||
    process.env.POSTGRES_URL ||
    "",
  status: process.env.BOT_STATUS || "/help | /play",
  commandsDir: "./commands",
  language: process.env.BOT_LANGUAGE || "ru",
  embedColor: process.env.EMBED_COLOR || "#0077ff",
  errorColor: process.env.ERROR_COLOR || "#ff0000",
  errorLog: process.env.ERROR_LOG_CHANNEL_ID || "",
  guildLogs: {
    mainChannelId: process.env.GUILD_LOGS_MAIN_CHANNEL_ID || "",
    notifyChannelId: process.env.GUILD_LOGS_NOTIFY_CHANNEL_ID || "",
  },

  emojis: {
    playEmoji: "<:play:1431629155245621379>",
    stopEmoji: "<:stop:1431629258777952347>",
    pauseEmoji: "<:pause:1431629198337900646>",
    skipEmoji: "<:next:1431629380677013595>",
    shuffleEmoji: "<:shuffle:1431629423639265442>",
    loopEmoji: "<:repeat:1431629659665338388>",
    onLoopMode: "<:repeatonce:1431629723443662868>",
    backEmoji: "<:back:1431629313442189433>",
    volumepEmoji: "<:sound:1431629814674096158>",
    volumemEmoji: "<:lowsound:1431629882265436231>",
    playlistEmoji: "<:clipboard:1431629934509428849>",
    bassboostEmoji: "B",
    settingsEmoji: "<:settings:1340383459234938900>",
    muteEmoji: "<:mute:1431629771502256300>",
    spotifySourceEmoji: "<:sp:1399514197540339814>",
    soundcloudSourceEmoji: "<:sc:1399511618865594388>",
    youtubeSourceEmoji: "<:yt:1399842014933291108>",
    yandexSourceEmoji: "<:ym:1399841705003319426>",
  },

  lavalink: {
    nodes: [
      {
        id: process.env.LAVALINK_NODE_ID || "main",
        host: process.env.LAVALINK_HOST || "127.0.0.1",
        port: parseNumber(process.env.LAVALINK_PORT, 2333),
        password: process.env.LAVALINK_PASSWORD || "youshallnotpass",
        secure: parseBoolean(process.env.LAVALINK_SECURE, false),
        retryAmount: parseNumber(process.env.LAVALINK_RETRY_AMOUNT, 5),
        retryDelay: parseNumber(process.env.LAVALINK_RETRY_DELAY, 5000),
      },
    ],
  },

  musicSources: {
    default: process.env.MUSIC_DEFAULT_SOURCE || "soundcloud",
    enabled: parseCsv(process.env.MUSIC_ENABLED_SOURCES || "", ["soundcloud", "spotify", "youtube"]),
  },

  monitoring: {
    status: parseBoolean(process.env.MONITORING_STATUS, false),
    url: process.env.MONITORING_URL || "",
  },

  voteManager: {
    status: parseBoolean(process.env.TOPGG_STATUS, false),
    api_key: process.env.TOPGG_API_KEY || "",
    vote_commands: ["back", "clear", "filter", "loop", "pause", "play", "queue", "resume", "search", "skip", "stop", "volume"],
    vote_url: process.env.TOPGG_VOTE_URL || "",
  },

  shardManager: {
    shardStatus: parseBoolean(process.env.SHARD_STATUS, false),
  },

  opt: {
    voiceConfig: {
      leaveOnFinish: parseBoolean(process.env.LEAVE_ON_FINISH, true),
      leaveOnStop: parseBoolean(process.env.LEAVE_ON_STOP, true),
      leaveOnEmpty: {
        status: parseBoolean(process.env.LEAVE_ON_EMPTY, true),
        cooldown: parseNumber(process.env.LEAVE_ON_EMPTY_COOLDOWN, 60000),
      },
    },
    maxVol: parseNumber(process.env.MAX_VOLUME, 150),
  },
};

