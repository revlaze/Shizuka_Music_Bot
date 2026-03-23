const { EmbedBuilder } = require("discord.js");
const { getPlayer, getCurrentTrack, getDjUsers, setDjUsers } = require("../utils/music");
const { getLang } = require("../utils/lang");
const { stopControllerAutoUpdate, updateStoredControllerMessage } = require("../utils/musicPanel");

module.exports = async (client, oldState, newState) => {
  const player = getPlayer(client, oldState.guild.id);
  if (!player) return;

  const lang = await getLang(client, oldState.guild.id);

  const leaveOnEmpty = client.config?.opt?.voiceConfig?.leaveOnEmpty;
  if (leaveOnEmpty?.status) {
    const botChannel = oldState.guild.channels.cache.get(player.voiceChannelId);
    if (botChannel && oldState.channelId === botChannel.id) {
      const nonBotMembers = botChannel.members.filter((member) => !member.user.bot);
      if (nonBotMembers.size === 0) {
        const cooldown = Number(leaveOnEmpty.cooldown || 60_000);
        setTimeout(async () => {
          const latestChannel = oldState.guild.channels.cache.get(player.voiceChannelId);
          if (!latestChannel) return;
          const humans = latestChannel.members.filter((member) => !member.user.bot);
          if (humans.size !== 0) return;

          const activePlayer = getPlayer(client, oldState.guild.id);
          if (!activePlayer) return;

          const stoppedTrack = getCurrentTrack(activePlayer) || activePlayer?.get?.("lastTrack") || null;
          const textChannel = oldState.guild.channels.cache.get(activePlayer.textChannelId);
          if (textChannel) {
            await textChannel.send({
              content: "Вышел из голосового канала, потому что он пуст.",
              allowedMentions: { parse: [] },
            }).catch(() => null);
          }
          await updateStoredControllerMessage(client, activePlayer, stoppedTrack, {
            stopped: true,
          }).catch(() => null);
          await activePlayer.destroy("voice-empty", true).catch(() => null);
          stopControllerAutoUpdate(client, oldState.guild.id);
        }, cooldown);
      }
    }
  }

  if (oldState.id !== client.user.id) {
    const playerChannelId = player.voiceChannelId;
    if (oldState.channelId === playerChannelId && newState.channelId !== playerChannelId) {
      const djUsers = getDjUsers(player);
      if (djUsers.includes(oldState.id)) {
        setDjUsers(player, djUsers.filter((id) => id !== oldState.id));
      }
    }
  }

  if (newState.id !== client.user.id) return;

  const textChannel = oldState.guild.channels.cache.get(player.textChannelId);
  if (!textChannel) return;

  if (!oldState.serverMute && newState.serverMute) {
    if (getCurrentTrack(player) && !player.paused) {
      await player.pause().catch(() => null);
      const embed = new EmbedBuilder()
        .setDescription("Меня заглушили на сервере, воспроизведение поставлено на паузу.")
        .setColor(client.config.embedColor);
      await textChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }
  }

  if (oldState.serverMute && !newState.serverMute) {
    if (player.paused) {
      await player.resume().catch(() => null);
    }
  }
};
