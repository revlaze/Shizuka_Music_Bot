const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { getLang } = require("../utils/lang");
const { getPlayer, getCurrentTrack } = require("../utils/music");
const maxVol = require("../config.js").opt.maxVol;

module.exports = {
  name: "volume",
  description: "Изменить громкость проигрывания.",
  permissions: "0x0000000000000800",
  options: [
    {
      name: "volume",
      description: `Громкость от 1 до ${maxVol}.`,
      type: ApplicationCommandOptionType.Integer,
      required: true,
      min_value: 1,
      max_value: maxVol,
    },
  ],
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

      const volume = interaction.options.getInteger("volume");
      if (!volume || volume < 1 || volume > maxVol) {
        const embed = new EmbedBuilder()
          .setColor(client.config.errorColor)
          .setDescription(`Неверная громкость. Укажите число от 1 до ${maxVol}.`);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      if (player.volume === volume) {
        const embed = new EmbedBuilder()
          .setColor(client.config.errorColor)
          .setDescription("Такая громкость уже установлена.");
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      await player.setVolume(volume).catch(() => null);
      const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setDescription(`Громкость изменена: **${volume}**/**${maxVol}**`);
      await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
