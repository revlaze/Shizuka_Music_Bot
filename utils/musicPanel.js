const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
} = require("discord.js");
const {
  formatDuration,
  formatSourceName,
  getQueueTracks,
  getRepeatModeNumber,
  mapTrack,
  setRepeatModeNumber,
  canGoBack,
} = require("./music");
const { buildCard, toColorNumber } = require("./ui");

const QUEUE_SESSION_TTL = 5 * 60 * 1000;
const CONTROLLER_UPDATE_INTERVAL_MS = 5000;
const PROGRESS_LINK = "https://discord.gg/53RzfWT36V";

const DEFAULT_EMOJIS = {
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
  queuePrevEmoji: "<:backarrow:1431629988313956373>",
  queueNextEmoji: "<:rightarrow:1431630112234668032>",
};

function getEmojiConfig(client) {
  return {
    ...DEFAULT_EMOJIS,
    ...(client?.config?.emojis || {}),
  };
}

function resolveButtonEmoji(rawEmoji, fallback) {
  const value = String(rawEmoji || fallback || "").trim();
  const match = /^<(a?):([a-zA-Z0-9_]+):(\d+)>$/.exec(value);
  if (match) {
    return {
      animated: Boolean(match[1]),
      name: match[2],
      id: match[3],
    };
  }
  return value || fallback || "▶️";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function supportsControllerV2() {
  const hasSectionApi =
    typeof SectionBuilder?.prototype?.setThumbnailAccessory === "function" &&
    typeof ContainerBuilder?.prototype?.addSectionComponents === "function";

  return Boolean(
    ContainerBuilder &&
      SectionBuilder &&
      ThumbnailBuilder &&
      SeparatorBuilder &&
      TextDisplayBuilder &&
      MessageFlags?.IsComponentsV2 &&
      hasSectionApi,
  );
}

function splitButtonRows(buttons = []) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(buttons.slice(i, i + 5));
  }
  return rows;
}

function formatRepeatMode(mode) {
  if (mode === 2) return "Очередь";
  if (mode === 1) return "Трек";
  return "Выкл";
}

function buildProgressBar(currentMs, totalMs, length = 10) {
  const safeTotal = Math.max(1, Number(totalMs || 0));
  const safeCurrent = clamp(Number(currentMs || 0), 0, safeTotal);
  const filledLength = clamp(Math.round((safeCurrent / safeTotal) * length), 0, length);

  const filled = `[▰](${PROGRESS_LINK})`.repeat(filledLength);
  const empty = `[▱](${PROGRESS_LINK})`.repeat(Math.max(0, length - filledLength));

  return `${filled}${empty}`;
}

function normalizeSourceKey(rawSource) {
  return String(rawSource || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function getSourceMeta(rawTrack, client) {
  const emojis = getEmojiConfig(client);
  const rawSource =
    rawTrack?.info?.sourceName ||
    rawTrack?.info?.source_name ||
    rawTrack?.sourceName ||
    rawTrack?.source ||
    "";

  const key = normalizeSourceKey(rawSource);

  if (key === "spotify" || key === "spsearch" || key === "sp") {
    return { icon: emojis.spotifySourceEmoji, name: "Spotify" };
  }
  if (key === "soundcloud" || key === "scsearch" || key === "sc") {
    return { icon: emojis.soundcloudSourceEmoji, name: "SoundCloud" };
  }
  if (key === "ytmsearch" || key === "youtubemusic" || key === "youtubemusicsearch") {
    return { icon: emojis.youtubeSourceEmoji, name: "YouTube Music" };
  }
  if (key === "youtube" || key === "ytsearch" || key === "yt") {
    return { icon: emojis.youtubeSourceEmoji, name: "YouTube" };
  }
  if (key === "yandexmusic" || key === "ymsearch" || key === "ym") {
    return { icon: emojis.yandexSourceEmoji, name: "Yandex Music" };
  }

  return {
    icon: "🎵",
    name: formatSourceName(rawSource || "Неизвестно"),
  };
}

function pickTrackCover(rawTrack) {
  if (!rawTrack) return null;

  const info = rawTrack.info && typeof rawTrack.info === "object" ? rawTrack.info : {};
  const pluginInfo = info.pluginInfo && typeof info.pluginInfo === "object" ? info.pluginInfo : {};

  const candidates = [
    rawTrack.thumbnail,
    rawTrack.artworkUrl,
    rawTrack.artworkURL,
    rawTrack.artwork_url,
    rawTrack.image,
    info.thumbnail,
    info.artworkUrl,
    info.artworkURL,
    info.artwork_url,
    info.albumArtUrl,
    info.image,
    pluginInfo.thumbnail,
    pluginInfo.artworkUrl,
    pluginInfo.artworkURL,
    pluginInfo.artwork_url,
    pluginInfo.albumArtUrl,
    pluginInfo.image,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveNodeName(client, player) {
  const candidates = [
    player?.node?.id,
    player?.node?.name,
    player?.node?.identifier,
    player?.node?.options?.id,
    player?.node?.options?.identifier,
    player?.nodeId,
    player?.data?.node?.id,
    player?.connection?.node?.id,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }

  const manager = client?.player;
  let managerNodes = [];
  if (manager?.nodes instanceof Map) {
    managerNodes = [...manager.nodes.values()];
  } else if (Array.isArray(manager?.nodes)) {
    managerNodes = manager.nodes;
  }

  if (managerNodes.length) {
    const first = managerNodes[0];
    const fallback = [first?.id, first?.name, first?.identifier, first?.options?.id];
    for (const candidate of fallback) {
      if (candidate === null || candidate === undefined) continue;
      const value = String(candidate).trim();
      if (value) return value;
    }
  }

  const configuredNode = client?.config?.lavalink?.nodes?.[0]?.id;
  if (typeof configuredNode === "string" && configuredNode.trim()) {
    return configuredNode.trim();
  }

  return "Неизвестно";
}

function buildControllerButtons(player, client, maxVolume = 200) {
  const emojis = getEmojiConfig(client);
  const paused = Boolean(player?.paused);
  const volume = Number(player?.volume || 0);
  const repeatMode = getRepeatModeNumber(player);
  const currentTrack = player?.queue?.current || player?.get?.("lastTrack") || null;
  const backAvailable = canGoBack(player, currentTrack);

  return [
    new ButtonBuilder()
      .setCustomId("music_queue")
      .setEmoji(resolveButtonEmoji(emojis.playlistEmoji, "📋"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_restart")
      .setEmoji(resolveButtonEmoji(emojis.backEmoji, "⏮️"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!backAvailable),
    new ButtonBuilder()
      .setCustomId("music_pause_toggle")
      .setEmoji(resolveButtonEmoji(paused ? emojis.playEmoji : emojis.pauseEmoji, paused ? "▶️" : "⏸️"))
      .setStyle(paused ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_skip")
      .setEmoji(resolveButtonEmoji(emojis.skipEmoji, "⏭️"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_vol_up")
      .setEmoji(resolveButtonEmoji(emojis.volumepEmoji, "🔊"))
      .setStyle(volume >= maxVolume ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(volume >= maxVolume),

    new ButtonBuilder()
      .setCustomId("music_settings")
      .setEmoji(resolveButtonEmoji(emojis.settingsEmoji, "⚙️"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_shuffle")
      .setEmoji(resolveButtonEmoji(emojis.shuffleEmoji, "🔀"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_stop")
      .setEmoji(resolveButtonEmoji(emojis.stopEmoji, "⏹️"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_loop")
      .setEmoji(resolveButtonEmoji(repeatMode === 1 ? emojis.onLoopMode : emojis.loopEmoji, repeatMode === 1 ? "🔂" : "🔁"))
      .setStyle(repeatMode === 0 ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("music_vol_down")
      .setEmoji(resolveButtonEmoji(emojis.volumemEmoji, "🔉"))
      .setStyle(volume <= 0 ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(volume <= 0),
  ];
}

function buildControllerPayload(client, player, rawTrack, options = {}) {
  const trackData = rawTrack || player?.queue?.current || player?.get?.("lastTrack") || null;
  const track = mapTrack(trackData);
  if (!player || !track) return null;

  const currentMs = options.stopped
    ? 0
    : clamp(Number(player.position || 0), 0, Number(track.duration || 0) || Number.MAX_SAFE_INTEGER);
  const totalMs = Math.max(0, Number(track.duration || 0));
  const remainingMs = Math.max(0, totalMs - currentMs);
  const progress = `${formatDuration(currentMs)} / ${formatDuration(totalMs)}`;
  const bar = buildProgressBar(currentMs, totalMs || 1, 10);

  const status = options.stopped
    ? "Вечеринка окончена"
    : player.paused
      ? "На паузе"
      : "Сейчас играет";

  const source = getSourceMeta(track.raw || trackData, client);
  const requester =
    track.user?.mention ||
    (track.user?.id ? `<@${track.user.id}>` : track.user?.name || "Неизвестно");
  const volume = Number(player.volume || 0);
  const emojis = getEmojiConfig(client);
  const volumeIcon = volume <= 0 ? (emojis.muteEmoji || emojis.volumemEmoji) : emojis.volumepEmoji;
  const nodeName = resolveNodeName(client, player);
  const coverUrl = pickTrackCover(track.raw || trackData);
  const maxVol = Number(client?.config?.opt?.maxVol || 200);
  const buttons = options.stopped ? [] : buildControllerButtons(player, client, maxVol);

  if (supportsControllerV2()) {
    const container = new ContainerBuilder().setAccentColor(toColorNumber(client.config.embedColor));

    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${source.icon} ${source.name} - ${status}`),
      new TextDisplayBuilder().setContent(track.url ? `## [${track.name}](${track.url})` : `## ${track.name}`),
      new TextDisplayBuilder().setContent(`${track.uploader?.name || "Неизвестно"}`),
    );

    if (coverUrl) {
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(coverUrl));
    }

    container
      .addSectionComponents(section)
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`\`${progress}\` ${bar} \`${formatDuration(remainingMs)}\``))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${volumeIcon} **${volume}%** - Запросил ${requester}`),
        new TextDisplayBuilder().setContent(`-# Музыкальный сервер **${nodeName}**`),
      );

    if (buttons.length) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
      for (const rowButtons of splitButtonRows(buttons)) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(rowButtons));
      }
    }

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  return buildCard({
    sections: [
      [
        `-# ${source.icon} ${source.name} - ${status}`,
        track.url ? `## [${track.name}](${track.url})` : `## ${track.name}`,
        `${track.uploader?.name || "Неизвестно"}`,
      ],
      [`\`${progress}\` ${bar} \`${formatDuration(remainingMs)}\``],
      [
        `-# ${volumeIcon} **${volume}%** - Запросил ${requester}`,
        `-# Музыкальный сервер **${nodeName}**`,
      ],
    ],
    color: client.config.embedColor,
    buttons,
    includeV2: true,
  });
}

function ensureControllerUpdateStore(client) {
  if (!client.controllerUpdateTimers) {
    client.controllerUpdateTimers = new Map();
  }
  return client.controllerUpdateTimers;
}

function stopControllerAutoUpdate(client, guildId) {
  if (!client || !guildId) return;
  const store = ensureControllerUpdateStore(client);
  const timer = store.get(guildId);
  if (timer) {
    clearInterval(timer);
    store.delete(guildId);
  }
}

async function updateStoredControllerMessage(client, player, track, options = {}) {
  if (!client || !player) return false;

  const guild = client.guilds.cache.get(player.guildId);
  if (!guild) return false;

  const channelId = player?.get?.("controllerChannelId") || player.textChannelId;
  const messageId = player?.get?.("controllerMessageId");
  if (!channelId || !messageId) return false;

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.messages?.fetch) return false;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;

  const payload = buildControllerPayload(client, player, track || null, options);
  if (!payload) {
    if (options?.stopped) {
      await message.edit({ components: [], allowedMentions: { parse: [] } }).catch(() => null);
      return true;
    }
    return false;
  }

  await message.edit({ ...payload, allowedMentions: { parse: [] } }).catch(() => null);
  return true;
}

async function clearStoredControllerComponents(client, player) {
  if (!client || !player) return false;

  const guild = client.guilds.cache.get(player.guildId);
  if (!guild) return false;

  const channelId = player?.get?.("controllerChannelId") || player.textChannelId;
  const messageId = player?.get?.("controllerMessageId");
  if (!channelId || !messageId) return false;

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.messages?.fetch) return false;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;

  const cleared = await message
    .edit({ components: [], allowedMentions: { parse: [] } })
    .then(() => true)
    .catch(() => false);

  if (cleared) return true;

  const fallbackTrack = player?.queue?.current || player?.get?.("lastTrack") || null;
  const stoppedPayload = buildControllerPayload(client, player, fallbackTrack, { stopped: true });
  if (!stoppedPayload) return false;

  return message
    .edit({ ...stoppedPayload, allowedMentions: { parse: [] } })
    .then(() => true)
    .catch(() => false);
}

function startControllerAutoUpdate(client, player) {
  if (!client || !player?.guildId) return;

  stopControllerAutoUpdate(client, player.guildId);

  const store = ensureControllerUpdateStore(client);
  let editing = false;

  const tick = async () => {
    if (editing) return;
    editing = true;

    try {
      const activePlayer = client?.player?.getPlayer?.(player.guildId);
      if (!activePlayer) {
        stopControllerAutoUpdate(client, player.guildId);
        return;
      }

      const current = activePlayer?.queue?.current || null;
      if (!current) return;

      await updateStoredControllerMessage(client, activePlayer, current).catch(() => null);
    } finally {
      editing = false;
    }
  };

  const timer = setInterval(() => {
    tick().catch(() => null);
  }, CONTROLLER_UPDATE_INTERVAL_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  store.set(player.guildId, timer);
  tick().catch(() => null);
}

function ensureQueueStore(client) {
  if (!client.queueSessions) {
    client.queueSessions = new Map();
  }
  return client.queueSessions;
}

function cleanupQueueSessions(client) {
  const store = ensureQueueStore(client);
  const now = Date.now();
  for (const [token, session] of store.entries()) {
    if (session.expiresAt <= now) {
      store.delete(token);
    }
  }
}

function createQueueSession(client, { guildId, userId, tracks }) {
  cleanupQueueSessions(client);
  const store = ensureQueueStore(client);
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  store.set(token, {
    token,
    guildId,
    userId,
    tracks,
    page: 0,
    expiresAt: Date.now() + QUEUE_SESSION_TTL,
  });

  return token;
}

function getQueueSession(client, token) {
  const store = ensureQueueStore(client);
  const session = store.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    store.delete(token);
    return null;
  }
  return session;
}

function deleteQueueSession(client, token) {
  const store = ensureQueueStore(client);
  store.delete(token);
}

function createQueueButtons(token, page, maxPage, client) {
  if (maxPage <= 0) return [];

  const emojis = getEmojiConfig(client);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`music_queue_prev:${token}`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(resolveButtonEmoji(emojis.queuePrevEmoji, "⬅️"))
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`music_queue_jump:${token}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Перейти к странице"),
      new ButtonBuilder()
        .setCustomId(`music_queue_next:${token}`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(resolveButtonEmoji(emojis.queueNextEmoji, "➡️"))
        .setDisabled(page >= maxPage),
      new ButtonBuilder()
        .setCustomId(`music_queue_close:${token}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel("Закрыть"),
    ),
  ];
}

function renderQueueSession(client, session) {
  const tracks = Array.isArray(session?.tracks) ? session.tracks : [];
  const pageSize = 10;
  const maxPage = Math.max(0, Math.ceil(tracks.length / pageSize) - 1);
  const page = clamp(Number(session?.page || 0), 0, maxPage);
  session.page = page;

  const start = page * pageSize;
  const visible = tracks.slice(start, start + pageSize);
  const totalDurationMs = tracks.reduce((sum, track) => sum + Number(track.duration || 0), 0);

  const header = `${tracks.length} трек(ов), примерное время \`${formatDuration(totalDurationMs)}\``;

  const description = visible
    .map((track, index) => {
      const absolute = start + index + 1;
      const isCurrentTrack = absolute === 1;
      const requester =
        track.user?.mention ||
        (track.user?.id ? `<@${track.user.id}>` : track.user?.name || "Неизвестно");
      const numberedTitle = track.url
        ? `${absolute}. [${track.name}](${track.url})`
        : `${absolute}. ${track.name}`;
      const line = `${numberedTitle} \`${track.formattedDuration}\`${isCurrentTrack ? " <:music:1431629113885593600> **Сейчас играет**" : ""}`;
      return `${isCurrentTrack ? "### " : ""}${line}\nЗапросил: ${requester}`;
    })
    .join("\n\n");

  const embed = new EmbedBuilder()
    .setColor(client.config.embedColor)
    .setTitle("Очередь сервера")
    .setDescription(`${header}\n\n${description || "Очередь пуста."}`)
    .setFooter({ text: `Страница ${page + 1}/${maxPage + 1}` });

  return {
    embeds: [embed],
    components: createQueueButtons(session.token, page, maxPage, client),
  };
}

function buildQueuePageModal(token) {
  const input = new TextInputBuilder()
    .setCustomId("page")
    .setLabel("Страница")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Укажите номер страницы")
    .setRequired(true)
    .setMaxLength(3);

  return new ModalBuilder()
    .setCustomId(`music_queue_modal:${token}`)
    .setTitle("Перейти к странице")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function createQueueSessionFromPlayer(client, guildId, userId, player) {
  const tracks = getQueueTracks(player).map(mapTrack).filter(Boolean);
  if (!tracks.length) return null;
  const token = createQueueSession(client, { guildId, userId, tracks });
  return getQueueSession(client, token);
}

async function cycleLoopMode(player) {
  const current = getRepeatModeNumber(player);
  const next = current === 0 ? 2 : current === 2 ? 1 : 0;
  await setRepeatModeNumber(player, next);
  return next;
}

module.exports = {
  buildControllerPayload,
  updateStoredControllerMessage,
  startControllerAutoUpdate,
  stopControllerAutoUpdate,
  createQueueSessionFromPlayer,
  getQueueSession,
  deleteQueueSession,
  renderQueueSession,
  buildQueuePageModal,
  cycleLoopMode,
  formatRepeatMode,
  resolveNodeName,
  clearStoredControllerComponents,
};
