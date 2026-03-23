const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");

const SOURCE_PREFIX = {
  soundcloud: "scsearch:",
  spotify: "spsearch:",
  youtube: "ytsearch:",
  youtubemusic: "ytmsearch:",
  yandexmusic: "ymsearch:",
};
const SEARCH_SOURCE_ORDER = ["soundcloud", "spotify", "youtube", "youtubemusic", "yandexmusic"];

const URL_REGEX = /^https?:\/\//i;
const DJ_USERS_KEY = "djUsers";
const TRACK_HISTORY_KEY = "trackHistory";
const TRACK_HISTORY_LIMIT = 100;
const SKIP_COOLDOWN_KEY = "skipCooldownUntil";

function normalizeSource(source) {
  if (!source) return "soundcloud";
  const lower = String(source).toLowerCase().replace(/[\s_-]+/g, "");
  if (lower === "sp" || lower === "spotify" || lower === "spsearch") return "spotify";
  if (lower === "ytm" || lower === "ytmsearch" || lower === "youtubemusic" || lower === "youtube_music") {
    return "youtubemusic";
  }
  if (lower === "yt" || lower === "youtube" || lower === "ytsearch") return "youtube";
  if (lower === "ym" || lower === "yandexmusic" || lower === "yandex" || lower === "ymsearch") {
    return "yandexmusic";
  }
  if (lower === "sc" || lower === "soundcloud") return "soundcloud";
  return "soundcloud";
}

function getDefaultSource(client) {
  return normalizeSource(client?.config?.musicSources?.default || "soundcloud");
}

function formatSourceName(source) {
  if (!source) return "Неизвестно";
  const lower = String(source).toLowerCase().replace(/[\s_-]+/g, "");

  if (lower === "youtube" || lower === "yt" || lower === "ytsearch") return "YouTube";
  if (lower === "ytmsearch" || lower === "ytm" || lower === "youtubemusic") {
    return "YouTube Music";
  }
  if (lower === "soundcloud" || lower === "sc" || lower === "scsearch") return "SoundCloud";
  if (lower === "spotify" || lower === "sp" || lower === "spsearch") return "Spotify";
  if (lower === "yandexmusic" || lower === "ym" || lower === "ymsearch") return "Yandex Music";

  return source;
}

function isSourceEnabled(client, source) {
  const enabled = client?.config?.musicSources?.enabled;
  if (!Array.isArray(enabled) || enabled.length === 0) return true;
  const normalizedEnabled = enabled.map((item) => normalizeSource(item));
  const normalizedSource = normalizeSource(source);

  if (normalizedSource === "youtubemusic") {
    return normalizedEnabled.includes("youtubemusic") || normalizedEnabled.includes("youtube");
  }
  if (normalizedSource === "youtube") {
    return normalizedEnabled.includes("youtube") || normalizedEnabled.includes("youtubemusic");
  }
  return normalizedEnabled.includes(normalizedSource);
}

function resolveSearchQuery(client, query, source) {
  if (!query || URL_REGEX.test(query)) return query;
  const requested = normalizeSource(source || getDefaultSource(client));
  const preferred = isSourceEnabled(client, requested)
    ? requested
    : getDefaultSource(client);
  return `${SOURCE_PREFIX[preferred] || SOURCE_PREFIX.soundcloud}${query}`;
}

function getEnabledSources(client) {
  const enabled = client?.config?.musicSources?.enabled;
  if (!Array.isArray(enabled) || enabled.length === 0) {
    return [...SEARCH_SOURCE_ORDER];
  }

  const normalized = [...new Set(enabled.map((item) => normalizeSource(item)))];
  if (normalized.includes("youtube") && !normalized.includes("youtubemusic")) {
    normalized.push("youtubemusic");
  }
  if (normalized.includes("youtubemusic") && !normalized.includes("youtube")) {
    normalized.push("youtube");
  }
  const filtered = SEARCH_SOURCE_ORDER.filter((item) => normalized.includes(item));
  return filtered.length ? filtered : [...SEARCH_SOURCE_ORDER];
}

function trackUniqKey(track) {
  const info = track?.info || {};
  if (info.identifier) return `id:${String(info.identifier).toLowerCase()}`;
  if (info.uri) return `uri:${String(info.uri).toLowerCase()}`;
  return `meta:${String(info.title || "").toLowerCase()}|${String(info.author || "").toLowerCase()}|${Number(info.duration || 0)}`;
}

async function searchAcrossSources(player, client, query, requester, preferredSource = "all", options = {}) {
  if (!query) return { tracks: [], sources: [] };

  if (URL_REGEX.test(query)) {
    const direct = await search(player, client, query, getDefaultSource(client), requester).catch(() => null);
    return {
      tracks: direct?.tracks || [],
      sources: direct?.tracks?.length ? [formatSourceName(direct?.tracks?.[0]?.info?.sourceName || getDefaultSource(client))] : [],
    };
  }

  const requested = String(preferredSource || "all").toLowerCase();
  const forceAllSources = Boolean(options?.forceAllSources);
  const maxTracks = Math.max(1, Number(options?.maxTracks) || 40);
  const maxPerSourceRaw = Number(options?.maxPerSource);
  const enabled = getEnabledSources(client);

  let sourcesToTry = [];
  if (requested === "all" || requested === "все") {
    sourcesToTry = forceAllSources ? [...SEARCH_SOURCE_ORDER] : enabled;
  } else {
    const normalizedRequested = normalizeSource(requested);
    sourcesToTry = [normalizedRequested];
  }

  if (!sourcesToTry.length) {
    sourcesToTry = [...SEARCH_SOURCE_ORDER];
  }

  const maxPerSource = Number.isFinite(maxPerSourceRaw) && maxPerSourceRaw > 0
    ? Math.floor(maxPerSourceRaw)
    : Math.max(4, Math.ceil(maxTracks / Math.max(1, sourcesToTry.length)));

  const seen = new Set();
  const combinedTracks = [];
  const matchedSources = [];

  for (const source of sourcesToTry) {
    if (!forceAllSources && !isSourceEnabled(client, source)) continue;

    const result = await search(player, client, query, source, requester).catch(() => null);
    const tracks = result?.tracks || [];
    if (!tracks.length) continue;

    matchedSources.push(formatSourceName(source));
    let addedFromSource = 0;

    for (const track of tracks) {
      const key = trackUniqKey(track);
      if (seen.has(key)) continue;
      seen.add(key);
      combinedTracks.push(track);
      addedFromSource += 1;
      if (addedFromSource >= maxPerSource) break;
      if (combinedTracks.length >= maxTracks) break;
    }

    if (combinedTracks.length >= maxTracks) break;
  }

  return {
    tracks: combinedTracks,
    sources: [...new Set(matchedSources)],
  };
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return "00:00";

  const totalSeconds = Math.floor(value / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (!hours) return `${mm}:${ss}`;
  return `${String(hours).padStart(2, "0")}:${mm}:${ss}`;
}

function normalizeUserIds(input) {
  if (!input) return [];

  const raw = Array.isArray(input)
    ? input
    : input instanceof Set
      ? [...input]
      : [input];

  const seen = new Set();
  const result = [];

  for (const value of raw) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function getDjUsers(player) {
  const raw = player?.get?.(DJ_USERS_KEY);
  return normalizeUserIds(raw);
}

function setDjUsers(player, userIds) {
  const normalized = normalizeUserIds(userIds);
  if (player?.set) {
    player.set(DJ_USERS_KEY, normalized);
  }
  return normalized;
}

function addDjUser(player, userId) {
  const current = getDjUsers(player);
  const normalized = String(userId || "").trim();
  if (!normalized) return current;
  if (!current.includes(normalized)) {
    current.push(normalized);
  }
  return setDjUsers(player, current);
}

function removeDjUser(player, userId) {
  const normalized = String(userId || "").trim();
  const filtered = getDjUsers(player).filter((id) => id !== normalized);
  return setDjUsers(player, filtered);
}

function hasDjRestriction(player) {
  return getDjUsers(player).length > 0;
}

function userCanManageByDj(player, userId) {
  const djUsers = getDjUsers(player);
  if (!djUsers.length) return true;
  const normalized = String(userId || "").trim();
  return Boolean(normalized && djUsers.includes(normalized));
}

function getTrackUniqueKey(track) {
  if (!track || typeof track !== "object") return "";
  const info = track.info && typeof track.info === "object" ? track.info : {};

  const identifier = String(info.identifier || track.identifier || "").trim();
  if (identifier) return `id:${identifier}`;

  const uri = String(info.uri || track.uri || "").trim();
  if (uri) return `uri:${uri}`;

  const title = String(info.title || track.title || "").trim().toLowerCase();
  const author = String(info.author || track.author || "").trim().toLowerCase();
  const duration = Number(info.duration || track.duration || 0);
  return `meta:${title}|${author}|${duration}`;
}

function getTrackHistory(player) {
  const raw = player?.get?.(TRACK_HISTORY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === "object");
}

function setTrackHistory(player, history) {
  const safe = Array.isArray(history)
    ? history.filter((item) => item && typeof item === "object").slice(-TRACK_HISTORY_LIMIT)
    : [];
  if (player?.set) {
    player.set(TRACK_HISTORY_KEY, safe);
  }
  return safe;
}

function pushTrackHistory(player, track) {
  if (!track || typeof track !== "object") return getTrackHistory(player);

  const history = getTrackHistory(player);
  const nextKey = getTrackUniqueKey(track);
  const last = history[history.length - 1];
  const lastKey = getTrackUniqueKey(last);

  if (!nextKey || nextKey !== lastKey) {
    history.push(track);
  }

  return setTrackHistory(player, history);
}

function popPreviousTrack(player, currentTrack) {
  const history = getTrackHistory(player);
  const currentKey = getTrackUniqueKey(currentTrack);

  while (history.length) {
    const candidate = history.pop();
    const candidateKey = getTrackUniqueKey(candidate);
    if (!candidateKey) continue;
    if (candidateKey === currentKey) continue;
    setTrackHistory(player, history);
    return candidate;
  }

  setTrackHistory(player, history);
  return null;
}

function canGoBack(player, currentTrack) {
  const history = getTrackHistory(player);
  const currentKey = getTrackUniqueKey(currentTrack);
  return history.some((track) => {
    const key = getTrackUniqueKey(track);
    return Boolean(key) && key !== currentKey;
  });
}

function parseTimeToMs(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.trim().split(":").map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length > 3) return null;

  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + part;
  }
  return seconds * 1000;
}

function trackRequesterId(track) {
  if (!track) return null;
  if (track.requester?.id) return track.requester.id;
  if (typeof track.requester === "string") return track.requester;
  if (track.userData?.requesterId) return track.userData.requesterId;
  return null;
}

function trackRequesterName(track) {
  if (!track) return null;
  if (typeof track.requester?.name === "string" && track.requester.name.trim()) {
    return track.requester.name.trim();
  }
  if (typeof track.requester?.globalName === "string" && track.requester.globalName.trim()) {
    return track.requester.globalName.trim();
  }
  if (typeof track.requester?.username === "string" && track.requester.username.trim()) {
    return track.requester.username.trim();
  }
  if (typeof track.requester?.tag === "string" && track.requester.tag.trim()) {
    return track.requester.tag.trim();
  }
  if (typeof track.userData?.requesterName === "string" && track.userData.requesterName.trim()) {
    return track.userData.requesterName.trim();
  }
  if (typeof track.userData?.requesterTag === "string" && track.userData.requesterTag.trim()) {
    return track.userData.requesterTag.trim();
  }
  return null;
}

function formatUserMention(userId, fallback = "Неизвестно") {
  if (userId === null || userId === undefined) return fallback;
  const normalized = String(userId).trim();
  if (!normalized) return fallback;
  return `<@${normalized}>`;
}

function trackRequesterMention(track) {
  const requesterId = trackRequesterId(track);
  if (requesterId) {
    return formatUserMention(requesterId);
  }
  return trackRequesterName(track) || "Неизвестно";
}

function mapTrack(track) {
  if (!track) return null;
  return {
    name: track.info?.title || "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e",
    url: track.info?.uri || null,
    duration: track.info?.duration || 0,
    formattedDuration: formatDuration(track.info?.duration || 0),
    source: formatSourceName(track.info?.sourceName),
    uploader: { name: track.info?.author || "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e" },
    user: {
      id: trackRequesterId(track),
      name: trackRequesterName(track),
      mention: trackRequesterMention(track),
    },
    raw: track,
  };
}

function getPlayer(client, guildId) {
  if (!client?.player || !guildId) return null;
  return client.player.getPlayer(guildId) || null;
}

function getCurrentTrack(player) {
  return player?.queue?.current || null;
}

function getQueueTracks(player) {
  if (!player?.queue) return [];
  const tracks = [];
  if (player.queue.current) tracks.push(player.queue.current);
  if (Array.isArray(player.queue.tracks)) tracks.push(...player.queue.tracks);
  return tracks;
}

function getRepeatModeNumber(player) {
  const mode = player?.repeatMode ?? player?.loop ?? "off";
  if (mode === 1 || mode === "track") return 1;
  if (mode === 2 || mode === "queue") return 2;

  if (typeof mode === "string") {
    const normalized = mode.toLowerCase();
    if (normalized === "track") return 1;
    if (normalized === "queue") return 2;
  }

  return 0;
}

async function setRepeatModeNumber(player, mode) {
  if (!player) return;
  const normalized = mode === 1 ? "track" : mode === 2 ? "queue" : "off";
  const numeric = mode === 1 ? 1 : mode === 2 ? 2 : 0;

  try {
    await player.setRepeatMode(normalized);
  } catch {
    await player.setRepeatMode(numeric).catch(() => null);
  }
}

function getQueuedTracksCount(player) {
  if (!player?.queue) return 0;

  if (Array.isArray(player.queue.tracks)) {
    return player.queue.tracks.length;
  }

  const queueSize = Number(player.queue.size);
  if (Number.isFinite(queueSize)) {
    // В некоторых реализациях size включает текущий трек.
    return Math.max(0, queueSize - (player.queue.current ? 1 : 0));
  }

  return 0;
}

function shouldStopOnSkip(player) {
  if (!player) return false;
  const hasNextTrack = getQueuedTracksCount(player) > 0;
  if (hasNextTrack) return false;

  const repeatMode = getRepeatModeNumber(player);
  return repeatMode === 0;
}

function getSkipCooldownMs(player) {
  const fromGet = Number(player?.get?.(SKIP_COOLDOWN_KEY) || 0);
  const fromData = Number(player?.data?.[SKIP_COOLDOWN_KEY] || 0);
  const fromField = Number(player?.[SKIP_COOLDOWN_KEY] || 0);
  const lockUntil = Math.max(
    Number.isFinite(fromGet) ? fromGet : 0,
    Number.isFinite(fromData) ? fromData : 0,
    Number.isFinite(fromField) ? fromField : 0,
  );

  const remaining = lockUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function setSkipCooldown(player, cooldownMs = 1500) {
  if (!player) return 0;

  const ms = Math.max(0, Number(cooldownMs) || 0);
  const lockUntil = Date.now() + ms;

  if (player?.set) {
    try {
      player.set(SKIP_COOLDOWN_KEY, lockUntil);
    } catch {
      // Игнорируем, пробуем альтернативные способы.
    }
    try {
      player.set({ [SKIP_COOLDOWN_KEY]: lockUntil });
    } catch {
      // Не во всех реализациях поддерживается set(object).
    }
  }

  if (player.data && typeof player.data === "object") {
    player.data[SKIP_COOLDOWN_KEY] = lockUntil;
  }

  try {
    player[SKIP_COOLDOWN_KEY] = lockUntil;
  } catch {
    // Игнорируем read-only поля.
  }

  return lockUntil;
}

async function ensureVoice(interaction, client) {
  if (!interaction?.member?.voice?.channelId) {
    const embed = new EmbedBuilder()
      .setDescription("Сначала зайдите в голосовой канал.")
      .setColor(client.config.errorColor);
    await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
    return false;
  }

  const player = getPlayer(client, interaction.guildId);
  if (player?.voiceChannelId && player.voiceChannelId !== interaction.member.voice.channelId) {
    const embed = new EmbedBuilder()
      .setDescription("Вы должны быть в моем голосовом канале.")
      .setColor(client.config.errorColor);
    await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
    return false;
  }

  return true;
}

async function ensureVoicePermissions(interaction, client) {
  const channel = interaction?.member?.voice?.channel;
  if (!channel) return false;

  const permissions = channel.permissionsFor(client.user);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) return false;
  if (!permissions?.has(PermissionFlagsBits.Connect)) return false;
  if (!permissions?.has(PermissionFlagsBits.Speak)) return false;
  return true;
}

async function getOrCreatePlayer(client, interaction) {
  let player = getPlayer(client, interaction.guildId);
  if (!player) {
    player = await client.player.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: interaction.member.voice.channelId,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      selfMute: false,
      volume: 100,
    });
  } else {
    if (player.voiceChannelId !== interaction.member.voice.channelId) {
      await player.changeVoiceState({ voiceChannelId: interaction.member.voice.channelId });
    }
    if (player.textChannelId !== interaction.channelId) {
      await player.set({ textChannelId: interaction.channelId });
    }
  }

  if (!player.connected) {
    await player.connect();
  }

  return player;
}

async function search(player, client, query, source, requester) {
  const resolvedQuery = resolveSearchQuery(client, query, source);
  return player.search(resolvedQuery, requester || null);
}

module.exports = {
  formatDuration,
  parseTimeToMs,
  mapTrack,
  getPlayer,
  getCurrentTrack,
  getQueueTracks,
  getRepeatModeNumber,
  setRepeatModeNumber,
  shouldStopOnSkip,
  getSkipCooldownMs,
  setSkipCooldown,
  ensureVoice,
  ensureVoicePermissions,
  getOrCreatePlayer,
  search,
  searchAcrossSources,
  getDjUsers,
  setDjUsers,
  addDjUser,
  removeDjUser,
  hasDjRestriction,
  userCanManageByDj,
  pushTrackHistory,
  popPreviousTrack,
  canGoBack,
  formatSourceName,
};
