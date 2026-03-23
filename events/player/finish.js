const { EmbedBuilder } = require("discord.js");
const {
  buildControllerPayload,
  stopControllerAutoUpdate,
} = require("../../utils/musicPanel");

async function deleteOldControllerMessage(client, player) {
  const guild = client.guilds.cache.get(player.guildId);
  if (!guild) return;

  const oldMessageId = player?.get?.("controllerMessageId");
  const oldChannelId = player?.get?.("controllerChannelId") || player.textChannelId;
  if (!oldMessageId || !oldChannelId) return;

  const oldChannel = guild.channels.cache.get(oldChannelId);
  if (!oldChannel || !oldChannel.messages?.fetch) return;

  const oldMessage = await oldChannel.messages.fetch(oldMessageId).catch(() => null);
  if (oldMessage) {
    await oldMessage.delete().catch(() => null);
  }
}

module.exports = async (client, player, track) => {
  const guild = client.guilds.cache.get(player.guildId);
  if (!guild) return;

  const textChannel = guild.channels.cache.get(player.textChannelId);
  if (!textChannel) return;

  stopControllerAutoUpdate(client, player.guildId);

  const lastTrack = track || player?.get?.("lastTrack") || null;
  await deleteOldControllerMessage(client, player);

  const stoppedPayload = buildControllerPayload(client, player, lastTrack, { stopped: true });
  if (stoppedPayload) {
    const message = await textChannel
      .send({
        ...stoppedPayload,
        allowedMentions: { parse: [] },
      })
      .catch(() => null);

    if (message?.id && player?.set) {
      player.set("controllerMessageId", message.id);
      player.set("controllerChannelId", textChannel.id);
    }
    return;
  }

  const embed = new EmbedBuilder()
    .setDescription("Очередь пуста. Добавьте другой трек.")
    .setColor(client.config.embedColor);

  await textChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
};
