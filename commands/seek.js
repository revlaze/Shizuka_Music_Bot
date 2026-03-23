const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { getLang } = require("../utils/lang");
const {
  getPlayer,
  getCurrentTrack,
  parseTimeToMs,
  formatDuration,
  userCanManageByDj,
} = require("../utils/music");

module.exports = {
  name: "seek",
  description: "Перемотать трек на указанное время.",
  permissions: "0x0000000000000800",
  options: [
    {
      name: "position",
      description: "Формат: 1:30 или 00:10:45",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
  voiceChannel: true,
  run: async (client, interaction) => {
    const lang = await getLang(client, interaction.guildId);
    try {
      const player = getPlayer(client, interaction.guildId);
      const current = getCurrentTrack(player);

      if (!player || !current) {
        const embed = new EmbedBuilder()
          .setDescription("Сейчас ничего не играет.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      if (!userCanManageByDj(player, interaction.user.id)) {
        const embed = new EmbedBuilder()
          .setDescription("Вы не являетесь DJ в этом голосовом канале.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      const input = interaction.options.getString("position");
      const position = parseTimeToMs(input);

      if (!position || position < 0) {
        const embed = new EmbedBuilder()
          .setDescription("Неверный формат времени.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      const duration = current.info?.duration || 0;
      if (duration && position > duration) {
        const embed = new EmbedBuilder()
          .setDescription("Неверный формат времени.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      await player.seek(position).catch(() => null);
      const embed = new EmbedBuilder()
        .setDescription(`Перемотано на ${formatDuration(position)}.`)
        .setColor(client.config.embedColor);
      await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
