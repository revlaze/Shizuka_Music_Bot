const {
  buildControllerPayload,
  startControllerAutoUpdate,
} = require("../../utils/musicPanel");
const { pushTrackHistory } = require("../../utils/music");

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

  if (player?.set) {
    const previousTrack = player?.get?.("lastTrack") || null;
    if (previousTrack) {
      pushTrackHistory(player, previousTrack);
    }

    player.set("lastTrack", track || null);
    player.set("controllerChannelId", textChannel.id);
  }

  await deleteOldControllerMessage(client, player);

  const payload = buildControllerPayload(client, player, track);
  if (!payload) return;

  const message = await textChannel
    .send({
      ...payload,
      allowedMentions: { parse: [] },
    })
    .catch(() => null);

  if (message?.id && player?.set) {
    player.set("controllerMessageId", message.id);
    player.set("controllerChannelId", textChannel.id);
  }

  startControllerAutoUpdate(client, player);
};
