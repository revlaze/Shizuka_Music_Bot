const { EmbedBuilder } = require("discord.js");

const FALLBACK_MAIN_CHANNEL_ID = "1441466723365552158";
const FALLBACK_NOTIFY_CHANNEL_ID = "1441466725404246037";

function resolveChannelId(client, key, fallback) {
  const value = client?.config?.guildLogs?.[key] || fallback;
  if (!value) return null;
  return String(value).trim() || null;
}

async function getTotalGuilds(client) {
  if (client?.shard) {
    try {
      const sizes = await client.shard.fetchClientValues("guilds.cache.size");
      if (Array.isArray(sizes)) {
        return sizes.reduce((acc, size) => acc + Number(size || 0), 0);
      }
    } catch {
      // Используем локальное значение ниже.
    }
  }
  return client.guilds.cache.size;
}

async function getOwnerInfo(guild) {
  let owner = guild.ownerId ? guild.members?.cache?.get(guild.ownerId)?.user : null;
  if (!owner) {
    try {
      const fetchedOwner = await guild.fetchOwner();
      owner = fetchedOwner?.user || null;
    } catch {
      // Оставим fallback ниже.
    }
  }

  return {
    ownerName: owner ? `${owner.tag || owner.username}` : "Неизвестно",
    ownerId: owner?.id || guild.ownerId || "Неизвестно",
  };
}

async function getMemberStats(guild) {
  try {
    if (guild.members?.fetch) {
      await guild.members.fetch();
    }
  } catch {
    // Если не удалось получить участников, используем кеш.
  }

  const members = guild.members?.cache;
  if (!members?.size) {
    return {
      humans: Number(guild.memberCount || 0),
      bots: "Неизвестно",
    };
  }

  let humans = 0;
  let bots = 0;
  for (const member of members.values()) {
    if (member.user?.bot) bots += 1;
    else humans += 1;
  }

  return { humans, bots };
}


module.exports = async (client, guild) => {
  if (!guild || guild.unavailable || !client.guilds.cache.has(guild.id)) return;

  const mainChannelId = resolveChannelId(client, "mainChannelId", FALLBACK_MAIN_CHANNEL_ID);
  const notifyChannelId = resolveChannelId(client, "notifyChannelId", FALLBACK_NOTIFY_CHANNEL_ID);

  const [totalGuilds, ownerInfo, memberStats] = await Promise.all([
    getTotalGuilds(client),
    getOwnerInfo(guild),
    getMemberStats(guild),
  ]);

  const mainEmbed = new EmbedBuilder()
    .setTitle("Новый сервер")
    .setDescription(
      `>>> **Название: \`${guild.name}\`\n` +
      `ID: \`${guild.id}\`\n` +
      `Количество участников: \`${memberStats.humans}\`\n` +
      `Количество ботов: \`${memberStats.bots}\`\n` +
      `Владелец: \`${ownerInfo.ownerName}\`\n` +
      `ID владельца: \`${ownerInfo.ownerId}\`**`,
    )
    .setColor(client.config.embedColor)
    .setFooter({ text: `У бота теперь ${totalGuilds} серверов` });

  const iconUrl = guild.iconURL({ size: 512, extension: "png" });
  if (iconUrl) {
    mainEmbed.setThumbnail(iconUrl);
  }

  const notifyEmbed = new EmbedBuilder()
    .setDescription(`**${client.user}** была добавлена на сервер \`${guild.name}\`!`)
    .setColor(client.config.embedColor);

  const mainChannel = mainChannelId ? client.channels.cache.get(mainChannelId) : null;
  const notifyChannel = notifyChannelId ? client.channels.cache.get(notifyChannelId) : null;

  if (mainChannel?.send) {
    await mainChannel.send({
      embeds: [mainEmbed],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  if (notifyChannel?.send) {
    await notifyChannel.send({
      embeds: [notifyEmbed],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }
};
