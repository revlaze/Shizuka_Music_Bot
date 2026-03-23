const { EmbedBuilder } = require("discord.js");
const { getLang } = require("../utils/lang");
const {
  getPlayer,
  getCurrentTrack,
  getRepeatModeNumber,
  setRepeatModeNumber,
  userCanManageByDj,
} = require("../utils/music");

module.exports = {
  name: "loop",
  description: "Переключить повтор: выкл -> трек -> очередь -> выкл.",
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

      const mode = getRepeatModeNumber(player);
      const nextMode = mode === 0 ? 1 : mode === 1 ? 2 : 0;
      await setRepeatModeNumber(player, nextMode);

      const label = nextMode === 2 ? "Очередь" : nextMode === 1 ? "Трек" : "Выкл";

      const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setDescription(`Режим повтора: **${label}**`);
      await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
