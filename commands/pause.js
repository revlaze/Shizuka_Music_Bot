const { EmbedBuilder } = require("discord.js");
const { getLang } = require("../utils/lang");
const { getPlayer, getCurrentTrack, userCanManageByDj } = require("../utils/music");
const { updateStoredControllerMessage } = require("../utils/musicPanel");

module.exports = {
  name: "pause",
  description: "Поставить трек на паузу.",
  permissions: "0x0000000000000800",
  options: [],
  voiceChannel: true,
  run: async (client, interaction) => {
    const lang = await getLang(client, interaction.guildId);
    try {
      const player = getPlayer(client, interaction.guildId);
      if (!player || !getCurrentTrack(player)) {
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

      if (player.paused) {
        const embed = new EmbedBuilder()
          .setDescription("Трек уже на паузе.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      await player.pause().catch(() => null);
      await updateStoredControllerMessage(client, player, getCurrentTrack(player)).catch(() => null);

      const embed = new EmbedBuilder()
        .setDescription("Пауза включена.")
        .setColor(client.config.embedColor);
      await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
