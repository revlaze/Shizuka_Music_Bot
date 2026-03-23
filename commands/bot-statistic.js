const config = require("../config.js");
const db = require("../postgresqlDB");
const os = require("os");

function countActivePlayers(manager) {
  if (!manager) return 0;
  const players = manager.players;

  if (players instanceof Map) {
    return [...players.values()].filter((player) => player?.voiceChannelId).length;
  }
  if (Array.isArray(players)) {
    return players.filter((player) => player?.voiceChannelId).length;
  }
  return 0;
}

module.exports = {
  name: "about",
  description: "Информация о боте",
  options: [],
  permissions: "0x0000000000000800",
  run: async (client, interaction) => {
    let lang = await db?.musicbot?.findOne({ guildID: interaction.guild.id }).catch(() => null);
    lang = lang?.language || client.language;
    lang = require(`../languages/${lang}.js`);

    try {
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
      let totalGuilds;
      let totalMembers;
      let totalChannels;
      let shardSize;
      let voiceConnections;

      if (config.shardManager.shardStatus === true) {
        const results = await Promise.all([
          client.shard.fetchClientValues("guilds.cache.size"),
          client.shard.broadcastEval((c) => c.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)),
          client.shard.broadcastEval((c) => c.guilds.cache.reduce((acc, guild) => acc + guild.channels.cache.size, 0)),
          client.shard.broadcastEval((c) => {
            const manager = c.player;
            if (!manager) return 0;
            const players = manager.players;
            if (players instanceof Map) {
              return [...players.values()].filter((player) => player?.voiceChannelId).length;
            }
            if (Array.isArray(players)) {
              return players.filter((player) => player?.voiceChannelId).length;
            }
            return 0;
          }),
        ]);

        totalGuilds = results[0].reduce((acc, count) => acc + count, 0);
        totalMembers = results[1].reduce((acc, count) => acc + count, 0);
        totalChannels = results[2].reduce((acc, count) => acc + count, 0);
        shardSize = client.shard.count;
        voiceConnections = results[3].reduce((acc, count) => acc + count, 0);
      } else {
        totalGuilds = client.guilds.cache.size;
        totalMembers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        totalChannels = client.guilds.cache.reduce((acc, guild) => acc + guild.channels.cache.size, 0);
        shardSize = 1;
        voiceConnections = countActivePlayers(client.player);
      }

      const getCpuLoad = () => {
        const cpuCount = os.cpus().length;
        const load = os.loadavg()[0] / cpuCount;
        return `${load.toFixed(2)} %`;
      };

      const start = Date.now();
      await interaction.deferReply().catch(() => null);

      const embed = new EmbedBuilder()
        .setTitle("Статистика")
        .setDescription(`**Бот запущен: <t:${Math.floor(Number(Date.now() - client.uptime) / 1000)}:R>**`)
        .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 1024 }))
        .addFields({ name: "Пользователей:", value: `\`\`\`js\n${totalMembers || 0}\`\`\``, inline: true })
        .addFields({ name: "Серверов:", value: `\`\`\`js\n${totalGuilds || 0}\`\`\``, inline: true })
        .addFields({ name: "Каналов:", value: `\`\`\`js\n${totalChannels || 0}\`\`\``, inline: true })
        .addFields({ name: "Активно голосовых:", value: `\`\`\`js\n${voiceConnections}\`\`\``, inline: true })
        .addFields({ name: "API задержка:", value: `\`\`\`js\n${client.ws.ping} ms\`\`\``, inline: true })
        .addFields({ name: "Задержка ответа:", value: `\`\`\`js\n${Date.now() - start} ms\`\`\``, inline: true })
        .addFields({
          name: "ОЗУ:",
          value: `\`\`\`js\n${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB\`\`\``,
          inline: true,
        })
        .addFields({ name: "Шардов:", value: `\`\`\`js\n${shardSize || 0}\`\`\``, inline: true })
        .addFields({ name: "Библиотека:", value: "```js\nDiscord.js```", inline: true })
        .addFields({ name: "Версия бота:", value: "```js\n2026.3.0```", inline: true })
        .addFields({ name: "Платформа:", value: `\`\`\`js\n${process.platform}\`\`\``, inline: true })
        .addFields({ name: "CPU:", value: `\`\`\`js\n${getCpuLoad()}\`\`\``, inline: true })
        .addFields({ name: "Разработчик:", value: "```js\n@revlaze```", inline: true })
        .setColor(client.config.embedColor)
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Сервер поддержки")
          .setURL("https://discord.gg/53RzfWT36V")
          .setStyle(ButtonStyle.Link),
        new ButtonBuilder()
          .setLabel("Пригласить бота")
          .setURL("https://discord.com/oauth2/authorize?client_id=1139676843763581099")
          .setStyle(ButtonStyle.Link),
      );

      await interaction.editReply({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
