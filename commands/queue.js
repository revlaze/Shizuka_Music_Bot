const { EmbedBuilder } = require("discord.js");
const { getPlayer } = require("../utils/music");
const { createQueueSessionFromPlayer, renderQueueSession } = require("../utils/musicPanel");

module.exports = {
  name: "queue",
  description: "Показать текущую очередь.",
  permissions: "0x0000000000000800",
  options: [],
  run: async (client, interaction) => {
    try {
      const player = getPlayer(client, interaction.guildId);
      const session = createQueueSessionFromPlayer(
        client,
        interaction.guildId,
        interaction.user.id,
        player,
      );

      if (!player || !session) {
        const embed = new EmbedBuilder()
          .setDescription("Сейчас ничего не играет.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      await interaction
        .reply({ ...renderQueueSession(client, session), flags: 64, allowedMentions: { parse: [] } })
        .catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, {});
    }
  },
};
