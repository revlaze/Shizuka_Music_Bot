module.exports = async (client, player, track, payload) => {
  const guild = client.guilds.cache.get(player?.guildId);
  if (!guild) return;

  const textChannel = guild.channels.cache.get(player.textChannelId);
  if (!textChannel) return;

  const message =
    payload?.exception?.message ||
    payload?.message ||
    "Произошла ошибка воспроизведения.";

  await textChannel
    .send({
      content: `Ошибка воспроизведения: ${String(message).slice(0, 1800)}`,
    })
    .catch(() => null);
};

