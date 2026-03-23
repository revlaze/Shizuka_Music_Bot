const { EmbedBuilder } = require("discord.js");
const { getLang } = require("../utils/lang");
const { getPlayer, getCurrentTrack, userCanManageByDj } = require("../utils/music");

module.exports = {
  name: "shuffle",
  description: "Перемешать очередь.",
  options: [],
  permissions: "0x0000000000000800",
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

      player.queue.shuffle();
      const embed = new EmbedBuilder()
        .setDescription("Очередь перемешана.")
        .setColor(client.config.embedColor);
      await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
