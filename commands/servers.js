const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const config = require("../config.js");

function toGuildInfo(guild) {
  if (!guild) return null;
  return {
    name: guild.name,
    id: guild.id,
    memberCount: guild.memberCount,
    channels: guild.channels?.cache?.size ?? guild.channels ?? 0,
    roles: guild.roles?.cache?.size ?? guild.roles ?? 0,
    emojis: guild.emojis?.cache?.size ?? guild.emojis ?? 0,
    premiumSubscriptionCount: guild.premiumSubscriptionCount ?? 0,
    premiumTier: guild.premiumTier ?? 0,
    vanityURLCode: guild.vanityURLCode ?? null,
    iconURL: typeof guild.iconURL === "function"
      ? guild.iconURL({ size: 512, extension: "png" })
      : guild.iconURL,
  };
}

async function getGuildFromShards(client, guildId) {
  const results = await client.shard.broadcastEval(
    (c, { targetGuildId }) => {
      const guild = c.guilds.cache.get(targetGuildId);
      if (!guild) return null;

      return {
        name: guild.name,
        id: guild.id,
        memberCount: guild.memberCount,
        channels: guild.channels.cache.size,
        roles: guild.roles.cache.size,
        emojis: guild.emojis.cache.size,
        premiumSubscriptionCount: guild.premiumSubscriptionCount ?? 0,
        premiumTier: guild.premiumTier ?? 0,
        vanityURLCode: guild.vanityURLCode ?? null,
        iconURL: guild.iconURL({ size: 512, extension: "png" }),
      };
    },
    { context: { targetGuildId: guildId } },
  );

  return results.find(Boolean) || null;
}

async function getGuildsFromShards(client) {
  const result = await client.shard.broadcastEval((c) =>
    c.guilds.cache.map((g) => ({
      name: g.name,
      id: g.id,
      memberCount: g.memberCount,
    })),
  );

  return result.flat();
}

function buildGuildEmbed(client, guildInfo) {
  return new EmbedBuilder()
    .setTitle(`Информация о сервере: ${guildInfo.name}`)
    .setDescription(
      [
        `> **ID:** \`${guildInfo.id}\``,
        `> **Участников:** \`${guildInfo.memberCount}\``,
        `> **Каналов:** \`${guildInfo.channels}\``,
        `> **Ролей:** \`${guildInfo.roles}\``,
        `> **Эмодзи:** \`${guildInfo.emojis}\``,
        `> **Бустов:** \`${guildInfo.premiumSubscriptionCount}\``,
        `> **Уровень бустов:** \`${guildInfo.premiumTier}\``,
      ].join("\n"),
    )
    .setColor(client.config.embedColor)
    .setThumbnail(guildInfo.iconURL || null)
    .addFields([
      {
        name: "Инвайт",
        value: guildInfo.vanityURLCode
          ? `https://discord.gg/${guildInfo.vanityURLCode}`
          : "Инвайт не найден.",
      },
    ])
    .setTimestamp();
}

function isOwner(client, userId) {
  const owners = client?.config?.ownerID;
  if (Array.isArray(owners)) return owners.includes(userId);
  if (typeof owners === "string") return owners === userId;
  return false;
}

module.exports = {
  name: "servers",
  description: "Команда владельца бота.",
  options: [
    {
      name: "server",
      description: "ID сервера, о котором нужно получить информацию.",
      type: 3,
      required: false,
    },
  ],
  permissions: "0x0000000000000800",
  run: async (client, interaction) => {
    if (!isOwner(client, interaction?.user?.id)) {
      return interaction.reply({
        content: "Команда доступна только владельцу бота.",
        flags: 64,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }

    const serverId = interaction.options.getString("server");

    if (serverId) {
      let guildInfo = null;

      if (config.shardManager?.shardStatus === true) {
        guildInfo = await getGuildFromShards(client, serverId);
      } else {
        const guild = client.guilds.cache.get(serverId);
        guildInfo = toGuildInfo(guild);
      }

      if (!guildInfo) {
        return interaction.reply({
          content: "Меня нет на этом сервере.",
          flags: 64,
          allowedMentions: { parse: [] },
        }).catch(() => {});
      }

      const embed = buildGuildEmbed(client, guildInfo);
      return interaction.reply({
        embeds: [embed],
        flags: 64,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }

    let guilds = [];
    if (config.shardManager?.shardStatus === true) {
      guilds = await getGuildsFromShards(client);
    } else {
      guilds = client.guilds.cache.map((g) => ({
        name: g.name,
        id: g.id,
        memberCount: g.memberCount,
      }));
    }

    guilds = guilds.sort((a, b) => b.memberCount - a.memberCount);

    let page = 0;
    const maxPage = Math.max(0, Math.ceil(guilds.length / 10) - 1);
    const getPageText = () =>
      guilds
        .slice(page * 10, page * 10 + 10)
        .map((g) => `> **${g.name}** \`(${g.id})\` - \`${g.memberCount}\` участников`)
        .join("\n") || "Серверы не найдены.";

    const embed = new EmbedBuilder()
      .setTitle(`Серверы (${guilds.length})`)
      .setDescription(getPageText())
      .setColor(client.config.embedColor)
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("servers_prev")
        .setLabel("Назад")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId("servers_next")
        .setLabel("Вперед")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === maxPage),
    );

    const msg = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
      allowedMentions: { parse: [] },
    }).catch(() => null);
    if (!msg) return;

    const filter = (i) => i.user.id === interaction.user.id;
    const collector = msg.createMessageComponentCollector({ filter, time: 600_000 });

    collector.on("collect", async (i) => {
      if (i.customId === "servers_prev") page -= 1;
      else if (i.customId === "servers_next") page += 1;

      page = Math.max(0, Math.min(maxPage, page));

      embed.setDescription(getPageText());
      row.components[0].setDisabled(page === 0);
      row.components[1].setDisabled(page === maxPage);

      await i.update({
        embeds: [embed],
        components: [row],
        allowedMentions: { parse: [] },
      }).catch(() => {});
    });

    collector.on("end", async () => {
      row.components[0].setDisabled(true);
      row.components[1].setDisabled(true);
      await msg.edit({
        embeds: [embed],
        components: [row],
        allowedMentions: { parse: [] },
      }).catch(() => {});
    });
  },
};
