const { EmbedBuilder } = require("discord.js");
const { getLang } = require("../utils/lang");
const { getPlayer, getCurrentTrack, userCanManageByDj } = require("../utils/music");
const { stopControllerAutoUpdate, updateStoredControllerMessage } = require("../utils/musicPanel");

module.exports = {
  name: "stop",
  description: "Остановить проигрывание и очистить очередь.",
  permissions: "0x0000000000000800",
  options: [],
  voiceChannel: true,
  run: async (client, interaction) => {
    const lang = await getLang(client, interaction.guildId);

    try {
      const player = getPlayer(client, interaction.guildId);
      if (!player || !getCurrentTrack(player)) {
        const embed = new EmbedBuilder()
          .setColor(client.config.errorColor)
          .setDescription("Сейчас ничего не играет.");
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

      const stoppedTrack = getCurrentTrack(player) || player?.get?.("lastTrack") || null;
      await updateStoredControllerMessage(client, player, stoppedTrack, {
        stopped: true,
      }).catch(() => null);

      await player.destroy("stopped", true).catch(() => null);
      stopControllerAutoUpdate(client, interaction.guildId);

      const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setDescription("Воспроизведение остановлено.");
      await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
