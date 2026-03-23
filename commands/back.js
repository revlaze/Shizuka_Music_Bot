const { EmbedBuilder } = require("discord.js");
const { getLang } = require("../utils/lang");
const { getPlayer, getCurrentTrack, mapTrack, popPreviousTrack } = require("../utils/music");

module.exports = {
  name: "back",
  description: "Вернуться к предыдущему треку.",
  permissions: "0x0000000000000800",
  options: [],
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

      const previousTrack = popPreviousTrack(player, current);
      if (!previousTrack) {
        const embed = new EmbedBuilder()
          .setDescription("Предыдущего трека нет.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      player.queue.add(previousTrack, 0);
      await player.skip().catch(() => null);

      const song = mapTrack(previousTrack);
      const embed = new EmbedBuilder()
        .setDescription(`Возврат к предыдущему треку: **${song?.name || "трек"}**`)
        .setColor(client.config.embedColor);
      await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
