const { EmbedBuilder } = require("discord.js");
const { getLang } = require("../utils/lang");
const { getPlayer, getCurrentTrack } = require("../utils/music");
const { stopControllerAutoUpdate, updateStoredControllerMessage } = require("../utils/musicPanel");

module.exports = {
  name: "clear",
  description: "Очистить очередь и остановить текущий трек.",
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

      player.queue.tracks.length = 0;
      const stoppedTrack = getCurrentTrack(player) || player?.get?.("lastTrack") || null;
      await updateStoredControllerMessage(client, player, stoppedTrack, {
        stopped: true,
      }).catch(() => null);

      if (typeof player.stopPlaying === "function") {
        await player.stopPlaying().catch(() => null);
      } else {
        await player.destroy("cleared", true).catch(() => null);
      }
      stopControllerAutoUpdate(client, interaction.guildId);

      const embed = new EmbedBuilder()
        .setDescription("Очередь очищена.")
        .setColor(client.config.embedColor);
      await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
