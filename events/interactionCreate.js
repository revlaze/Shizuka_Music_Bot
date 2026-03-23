const { EmbedBuilder, MessageFlags, UserSelectMenuBuilder } = require("discord.js");
const config = require("../config");
const { getLang } = require("../utils/lang");
const {
  ensureVoice,
  getPlayer,
  getCurrentTrack,
  formatDuration,
  mapTrack,
  getDjUsers,
  addDjUser,
  removeDjUser,
  hasDjRestriction,
  userCanManageByDj,
  popPreviousTrack,
  shouldStopOnSkip,
  getSkipCooldownMs,
  setSkipCooldown,
} = require("../utils/music");
const { runSkipVote, formatTrackLabel } = require("../utils/skipVote");
const { buildCard } = require("../utils/ui");
const {
  buildControllerPayload,
  createQueueSessionFromPlayer,
  getQueueSession,
  deleteQueueSession,
  renderQueueSession,
  buildQueuePageModal,
  cycleLoopMode,
  formatRepeatMode,
  stopControllerAutoUpdate,
  updateStoredControllerMessage,
} = require("../utils/musicPanel");

function withSafeMentions(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (payload.allowedMentions) return payload;
  return {
    ...payload,
    allowedMentions: { parse: [] },
  };
}

function normalizeEphemeralPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (!Object.prototype.hasOwnProperty.call(payload, "ephemeral")) return payload;

  const normalized = { ...payload };
  const isEphemeral = Boolean(normalized.ephemeral);
  delete normalized.ephemeral;

  if (isEphemeral) {
    const ephemeralFlag = Number(MessageFlags?.Ephemeral || 64);
    if (typeof normalized.flags === "bigint") {
      normalized.flags |= BigInt(ephemeralFlag);
    } else if (typeof normalized.flags === "number") {
      normalized.flags |= ephemeralFlag;
    } else {
      normalized.flags = ephemeralFlag;
    }
  }

  return normalized;
}
async function safeReply(interaction, payload) {
  const normalizedPayload = normalizeEphemeralPayload(payload);
  const safePayload = withSafeMentions(normalizedPayload);
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(safePayload).catch(() => null);
  }
  return interaction.reply(safePayload).catch(() => null);
}

function parseQueueButton(customId) {
  const match = /^music_queue_(prev|next|jump|close):([a-z0-9]+)$/i.exec(customId || "");
  if (!match) return null;
  return { action: match[1], token: match[2] };
}

function parseQueueModal(customId) {
  const match = /^music_queue_modal:([a-z0-9]+)$/i.exec(customId || "");
  if (!match) return null;
  return { token: match[1] };
}

function parseDjSettingsId(customId) {
  const match = /^music_dj_settings:([0-9]+)$/i.exec(customId || "");
  if (!match) return null;
  return { ownerId: match[1] };
}

function getDjDeniedEmbed(client) {
  return new EmbedBuilder()
    .setColor(client.config.errorColor)
    .setDescription("Вы не являетесь DJ в этом голосовом канале.");
}

function getSkipSuccessEmbed(client, userId, track) {
  return new EmbedBuilder()
    .setColor(client.config.embedColor)
    .setDescription(`<@${userId}> пропустил(-а) трек ${formatTrackLabel(track)}`);
}

async function skipOrStop(client, interaction, player, track) {
  if (!player) return;

  const forceDestroy = async () => {
    if (typeof player.destroy === "function") {
      await player.destroy("stopped", true).catch(() => null);
    }
  };

  if (shouldStopOnSkip(player)) {
    stopControllerAutoUpdate(client, player.guildId);
    const stoppedTrack = track || player?.get?.("lastTrack") || null;
    await updateStoredControllerMessage(client, player, stoppedTrack, {
      stopped: true,
    }).catch(() => null);

    if (interaction?.message) {
      const stoppedPayload = buildControllerPayload(client, player, stoppedTrack, { stopped: true });
      if (stoppedPayload) {
        await interaction.message.edit(withSafeMentions(stoppedPayload)).catch(() => null);
      } else {
        await interaction.message.edit({ components: [], allowedMentions: { parse: [] } }).catch(() => null);
      }
    }

    await forceDestroy();
    return;
  }

  let queuedTracksCount = 0;
  if (Array.isArray(player?.queue?.tracks)) {
    queuedTracksCount = player.queue.tracks.length;
  } else {
    const size = Number(player?.queue?.size);
    queuedTracksCount = Number.isFinite(size)
      ? Math.max(0, size - (player?.queue?.current ? 1 : 0))
      : 0;
  }
  if (typeof player.skip === "function") {
    await player.skip().catch(async () => {
      await forceDestroy();
    });
    return;
  }

  await forceDestroy();
}

function getHumanMembersCount(interaction, player) {
  const channel =
    interaction?.guild?.channels?.cache?.get(player?.voiceChannelId) ||
    interaction?.member?.voice?.channel ||
    null;

  if (!channel?.members) return 1;
  return channel.members.filter((member) => !member.user.bot).size;
}

function buildDjSettingsPayload(client, player, ownerId, note) {
  const djUsers = getDjUsers(player);
  const djLine = djUsers.length
    ? djUsers.map((id) => `<@${id}>`).join(", ")
    : "Не назначены";

  const select = new UserSelectMenuBuilder()
    .setCustomId(`music_dj_settings:${ownerId}`)
    .setPlaceholder("Участники...")
    .setMinValues(1)
    .setMaxValues(1);

  return buildCard({
    title: "Настройка диджея",
    sections: [[
      "Выберите участника из голосового канала, чтобы добавить или убрать его из списка DJ.",
      `Текущие DJ: ${djLine}`,
      note || "",
    ].filter(Boolean)],
    buttons: [select],
    color: client.config.embedColor,
    includeV2: true,
  });
}

async function handleDjSettingsSelect(client, interaction, lang) {
  const parsed = parseDjSettingsId(interaction.customId);
  if (!parsed) return false;

  if (parsed.ownerId !== interaction.user.id) {
    await safeReply(interaction, {
      content: "Эта панель DJ открыта другим пользователем.",
      flags: 64,
    });
    return true;
  }

  if (!(await ensureVoice(interaction, client))) return true;

  const player = getPlayer(client, interaction.guildId);
  const current = getCurrentTrack(player);
  if (!player || !current) {
    const embed = new EmbedBuilder()
      .setColor(client.config.errorColor)
      .setDescription("Сейчас ничего не играет.");
    await safeReply(interaction, { embeds: [embed], flags: 64 });
    return true;
  }

  if (!userCanManageByDj(player, interaction.user.id)) {
    await safeReply(interaction, { embeds: [getDjDeniedEmbed(client)], flags: 64 });
    return true;
  }

  const selectedId = interaction.values?.[0];
  if (!selectedId) {
    await safeReply(interaction, {
      content: "Не удалось определить выбранного участника.",
      flags: 64,
    });
    return true;
  }

  const member =
    interaction.guild.members.cache.get(selectedId) ||
    await interaction.guild.members.fetch(selectedId).catch(() => null);

  if (!member) {
    await safeReply(interaction, {
      content: "Участник не найден.",
      flags: 64,
    });
    return true;
  }

  if (member.user.bot) {
    await safeReply(interaction, {
      content: "Бота нельзя назначить DJ.",
      flags: 64,
    });
    return true;
  }

  const voiceChannel = interaction.guild.channels.cache.get(player.voiceChannelId);
  if (!voiceChannel || !voiceChannel.members?.has(member.id)) {
    await safeReply(interaction, {
      content: "Участник должен находиться в вашем голосовом канале.",
      flags: 64,
    });
    return true;
  }

  const currentDj = getDjUsers(player);
  let note;
  if (currentDj.includes(member.id)) {
    removeDjUser(player, member.id);
    note = `${member} удален из списка DJ.`;
  } else {
    addDjUser(player, member.id);
    note = `${member} добавлен в список DJ.`;
  }

  const payload = buildDjSettingsPayload(client, player, parsed.ownerId, note);
  await interaction.update(withSafeMentions(payload)).catch(async () => {
    await safeReply(interaction, { ...payload, flags: 64 });
  });

  return true;
}

async function updateControllerMessage(client, interaction, player) {
  const payload = buildControllerPayload(client, player, getCurrentTrack(player));
  if (!payload) return;

  if (interaction?.message) {
    await interaction.message.edit(withSafeMentions(payload)).catch(() => null);
    return;
  }

  await updateStoredControllerMessage(client, player, getCurrentTrack(player)).catch(() => null);
}

async function handleQueueButtons(client, interaction) {
  const parsed = parseQueueButton(interaction.customId);
  if (!parsed) return false;

  const session = getQueueSession(client, parsed.token);
  if (!session) {
    await safeReply(interaction, {
      content: "Панель очереди устарела. Откройте очередь заново.",
      flags: 64,
    });
    return true;
  }

  if (session.userId !== interaction.user.id) {
    await safeReply(interaction, {
      content: "Эта панель очереди открыта другим пользователем.",
      flags: 64,
    });
    return true;
  }

  const maxPage = Math.max(0, Math.ceil(session.tracks.length / 10) - 1);

  if (parsed.action === "jump") {
    await interaction.showModal(buildQueuePageModal(parsed.token)).catch(() => null);
    return true;
  }

  if (parsed.action === "close") {
    deleteQueueSession(client, parsed.token);
    await interaction.update({ components: [], allowedMentions: { parse: [] } }).catch(() => null);
    return true;
  }

  if (parsed.action === "prev" && session.page > 0) session.page -= 1;
  if (parsed.action === "next" && session.page < maxPage) session.page += 1;

  await interaction.update(withSafeMentions(renderQueueSession(client, session))).catch(() => null);
  return true;
}

async function handleQueueModal(client, interaction) {
  const parsed = parseQueueModal(interaction.customId);
  if (!parsed) return false;

  const session = getQueueSession(client, parsed.token);
  if (!session) {
    await safeReply(interaction, {
      content: "Панель очереди устарела. Откройте очередь заново.",
      flags: 64,
    });
    return true;
  }

  if (session.userId !== interaction.user.id) {
    await safeReply(interaction, {
      content: "Эта панель очереди открыта другим пользователем.",
      flags: 64,
    });
    return true;
  }

  const raw = interaction.fields.getTextInputValue("page") || "";
  const maxPage = Math.max(1, Math.ceil(session.tracks.length / 10));
  const pageNumber = Number.parseInt(raw.trim(), 10);

  if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > maxPage) {
    await safeReply(interaction, {
      content: `Страница не существует. Укажите число от 1 до ${maxPage}.`,
      flags: 64,
    });
    return true;
  }

  session.page = pageNumber - 1;
  const payload = withSafeMentions(renderQueueSession(client, session));

  try {
    await interaction.update(payload);
  } catch {
    if (!interaction.replied && !interaction.deferred) {
      await safeReply(interaction, {
        content: `Открыта страница ${pageNumber}.`,
        flags: 64,
      });
    }
    if (interaction.message) {
      await interaction.message.edit(payload).catch(() => null);
    }
  }

  return true;
}

async function handleControlButtons(client, interaction, lang) {
  const id = interaction.customId;
  const aliases = {
    pauseTrack: "music_pause_toggle",
    resumeTrack: "music_pause_toggle",
    skipTrack: "music_skip",
    stopTrack: "music_stop",
    timesTrack: "music_time",
  };

  const action = aliases[id] || id;
  const allowed = [
    "music_pause",
    "music_resume",
    "music_pause_toggle",
    "music_skip",
    "music_stop",
    "music_time",
    "music_queue",
    "music_restart",
    "music_vol_up",
    "music_vol_down",
    "music_shuffle",
    "music_loop",
    "music_settings",
  ];

  if (!allowed.includes(action)) return;
  if (!(await ensureVoice(interaction, client))) return;

  const player = getPlayer(client, interaction.guildId);
  const current = getCurrentTrack(player);
  if (!player || !current) {
    const embed = new EmbedBuilder()
      .setColor(client.config.errorColor)
      .setDescription("Сейчас ничего не играет.");
    await safeReply(interaction, { embeds: [embed], flags: 64 });
    return;
  }

  const djOnlyActions = new Set([
    "music_pause",
    "music_resume",
    "music_pause_toggle",
    "music_skip",
    "music_stop",
    "music_loop",
    "music_shuffle",
    "music_settings",
  ]);

  if (djOnlyActions.has(action) && !userCanManageByDj(player, interaction.user.id)) {
    await safeReply(interaction, { embeds: [getDjDeniedEmbed(client)], flags: 64 });
    return;
  }

  if (action === "music_queue") {
    const session = createQueueSessionFromPlayer(
      client,
      interaction.guildId,
      interaction.user.id,
      player,
    );
    if (!session) {
      const embed = new EmbedBuilder()
        .setColor(client.config.errorColor)
        .setDescription("Очередь пуста.");
      await safeReply(interaction, { embeds: [embed], flags: 64 });
      return;
    }
    await safeReply(interaction, { ...renderQueueSession(client, session), flags: 64 });
    return;
  }

  if (action === "music_settings") {
    const payload = buildDjSettingsPayload(client, player, interaction.user.id);
    await safeReply(interaction, { ...payload, flags: 64 });
    return;
  }

  if (action === "music_pause" || action === "music_resume" || action === "music_pause_toggle") {
    if (action === "music_pause" && player.paused) {
      const embed = new EmbedBuilder()
        .setColor(client.config.errorColor)
        .setDescription("Трек уже на паузе.");
      await safeReply(interaction, { embeds: [embed], flags: 64 });
      return;
    }
    if (action === "music_resume" && !player.paused) {
      const embed = new EmbedBuilder()
        .setColor(client.config.errorColor)
        .setDescription("Сейчас нет паузы.");
      await safeReply(interaction, { embeds: [embed], flags: 64 });
      return;
    }

    if (player.paused) {
      await player.resume().catch(() => null);
      const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setDescription("Воспроизведение продолжено.");
      await safeReply(interaction, { embeds: [embed], flags: 64 });
    } else {
      await player.pause().catch(() => null);
      const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setDescription("Пауза включена.");
      await safeReply(interaction, { embeds: [embed], flags: 64 });
    }

    await updateControllerMessage(client, interaction, player);
    return;
  }

  if (action === "music_skip") {
    if (interaction.isButton() && !interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => null);
    }

    const remainingMs = getSkipCooldownMs(player);
    if (remainingMs > 0) {
      const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
      const embed = new EmbedBuilder()
        .setColor(client.config.errorColor)
        .setDescription(`Подождите **${seconds} сек.** перед следующим пропуском.`);
      await safeReply(interaction, { embeds: [embed], flags: 64 });
      return;
    }

    const expectedVote = !hasDjRestriction(player) && getHumanMembersCount(interaction, player) >= 2;
    setSkipCooldown(player, expectedVote ? 32_000 : 2_000);

    if (!hasDjRestriction(player)) {
      const vote = await runSkipVote(client, interaction, player, current, {
        skippedByUserId: interaction.user.id,
        proposedByUserId: interaction.user.id,
      });
      if (!vote.passed) {
        setSkipCooldown(player, 1_000);
        return;
      }

      await skipOrStop(client, interaction, player, current);
      setSkipCooldown(player, 1_200);
      if (!vote.voteMessage) {
        const embed = getSkipSuccessEmbed(client, interaction.user.id, current);
        await safeReply(interaction, { embeds: [embed] });
      }
      return;
    }

    await skipOrStop(client, interaction, player, current);
    setSkipCooldown(player, 1_200);
    const embed = getSkipSuccessEmbed(client, interaction.user.id, current);
    await safeReply(interaction, { embeds: [embed] });
    return;
  }

  if (action === "music_stop") {
    const stoppedTrack = current || player?.get?.("lastTrack") || null;
    await updateStoredControllerMessage(client, player, stoppedTrack, {
      stopped: true,
    }).catch(() => null);

    await player.destroy("stopped", true).catch(() => null);
    stopControllerAutoUpdate(client, interaction.guildId);

    const embed = new EmbedBuilder()
      .setColor(client.config.embedColor)
      .setDescription("Воспроизведение остановлено.");
    await safeReply(interaction, { embeds: [embed], flags: 64 });

    if (interaction.message) {
      const stoppedPayload = buildControllerPayload(client, player, stoppedTrack, { stopped: true });
      if (stoppedPayload) {
        await interaction.message.edit(withSafeMentions(stoppedPayload)).catch(() => null);
      } else {
        await interaction.message.edit({ components: [], allowedMentions: { parse: [] } }).catch(() => null);
      }
    }
    return;
  }

  if (action === "music_time") {
    const position = player.position || 0;
    const duration = current.info?.duration || 0;
    const percent = duration ? Math.min(100, Math.round((position / duration) * 100)) : 0;
    const embed = new EmbedBuilder()
      .setColor(client.config.embedColor)
      .setTitle("Время воспроизведения")
      .setDescription(`**${formatDuration(position)} / ${formatDuration(duration)} (${percent}%)**`);

    await safeReply(interaction, { embeds: [embed], flags: 64 });
    return;
  }

  if (action === "music_restart") {
    const previousTrack = popPreviousTrack(player, current);
    if (previousTrack) {
      player.queue.add(previousTrack, 0);
      await player.skip().catch(() => null);
      const song = mapTrack(previousTrack);
      const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setDescription(`Возврат к предыдущему треку: **${song?.name || "трек"}**`);
      await safeReply(interaction, { embeds: [embed], flags: 64 });
    } else {
      await player.seek(0).catch(() => null);
      const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setDescription("Трек перемотан в начало.");
      await safeReply(interaction, { embeds: [embed], flags: 64 });
    }
    await updateControllerMessage(client, interaction, player);
    return;
  }

  if (action === "music_vol_up" || action === "music_vol_down") {
    const maxVol = Number(client.config?.opt?.maxVol || 200);
    const now = Number(player.volume || 0);
    const next = action === "music_vol_up"
      ? Math.min(maxVol, now + 10)
      : Math.max(0, now - 10);

    await player.setVolume(next).catch(() => null);
    const embed = new EmbedBuilder()
      .setColor(client.config.embedColor)
      .setDescription(`Громкость: **${next}%**`);
    await safeReply(interaction, { embeds: [embed], flags: 64 });
    await updateControllerMessage(client, interaction, player);
    return;
  }

  if (action === "music_shuffle") {
    const queueLength = Array.isArray(player.queue?.tracks) ? player.queue.tracks.length : 0;
    if (queueLength < 2) {
      const embed = new EmbedBuilder()
        .setColor(client.config.errorColor)
        .setDescription("Недостаточно треков в очереди для перемешивания.");
      await safeReply(interaction, { embeds: [embed], flags: 64 });
      return;
    }

    player.queue.shuffle();
    const embed = new EmbedBuilder()
      .setColor(client.config.embedColor)
      .setDescription("Очередь перемешана.");
    await safeReply(interaction, { embeds: [embed], flags: 64 });
    await updateControllerMessage(client, interaction, player);
    return;
  }

  if (action === "music_loop") {
    const mode = await cycleLoopMode(player);
    const embed = new EmbedBuilder()
      .setColor(client.config.embedColor)
      .setDescription(`Режим цикла: **${formatRepeatMode(mode)}**`);
    await safeReply(interaction, { embeds: [embed], flags: 64 });
    await updateControllerMessage(client, interaction, player);
  }
}

module.exports = async (client, interaction) => {
  if (!interaction.inGuild()) {
    if (interaction.isRepliable()) {
      await safeReply(interaction, {
        content: "Используйте эту команду только на сервере.",
        flags: 64,
      });
    }
    return;
  }

  const lang = await getLang(client, interaction.guildId);

  try {
    if (interaction.isUserSelectMenu()) {
      if (await handleDjSettingsSelect(client, interaction, lang)) return;
      return;
    }

    if (interaction.isButton()) {
      if (await handleQueueButtons(client, interaction)) return;
      await handleControlButtons(client, interaction, lang);
      return;
    }

    if (interaction.isModalSubmit()) {
      if (await handleQueueModal(client, interaction)) return;
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commandMap.get(interaction.commandName);
    if (!command) return;

    if (command.permissions) {
      const requiredPermission =
        typeof command.permissions === "string" && command.permissions.startsWith("0x")
          ? BigInt(command.permissions)
          : command.permissions;

      if (!interaction.member.permissions.has(requiredPermission)) {
        const embed = new EmbedBuilder()
          .setDescription(`Недостаточно прав: **${command.permissions || "не указано"}**`)
          .setColor(client.config.errorColor);
        await safeReply(interaction, { embeds: [embed], flags: 64 });
        return;
      }
    }

    if (command.voiceChannel) {
      const canUse = await ensureVoice(interaction, client);
      if (!canUse) return;
    }

    if (config.voteManager?.status && config.voteManager?.api_key) {
      if (config.voteManager.vote_commands?.includes(interaction.commandName)) {
        try {
          const topSdk = require("@top-gg/sdk");
          const topApi = new topSdk.Api(config.voteManager.api_key, client);
          const voted = await topApi.hasVoted(interaction.user.id);
          if (!voted) {
            const embed = new EmbedBuilder()
              .setTitle(`Голосование за ${client.user.username}`)
              .setColor(client.config.embedColor)
              .setDescription(
                `${config.voteManager.vote_commands.map((item) => `\`${item}\``).join(", ")} - ` +
                `Проголосуйте, чтобы разблокировать команды.\n> ${config.voteManager.vote_url}`,
              );
            await safeReply(interaction, { embeds: [embed], flags: 64 });
            return;
          }
        } catch {
          // Ошибки API top.gg не блокируют выполнение команды.
        }
      }
    }

    await command.run(client, interaction);
  } catch (e) {
    const errorNotifier = require("../functions.js");
    errorNotifier(client, interaction, e, lang);
  }
};


