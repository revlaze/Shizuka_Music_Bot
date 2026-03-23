const { EmbedBuilder, MessageFlags } = require("discord.js");
const { getLang } = require("../utils/lang");
const {
  getPlayer,
  getCurrentTrack,
  hasDjRestriction,
  userCanManageByDj,
  shouldStopOnSkip,
  getSkipCooldownMs,
  setSkipCooldown,
} = require("../utils/music");
const { runSkipVote, formatTrackLabel } = require("../utils/skipVote");
const {
  updateStoredControllerMessage,
  stopControllerAutoUpdate,
} = require("../utils/musicPanel");

function buildSkippedEmbed(client, userId, track) {
  return new EmbedBuilder()
    .setColor(client.config.embedColor)
    .setDescription(`<@${userId}> пропустил(-а) трек ${formatTrackLabel(track)}`);
}

async function replyPublic(interaction, embed) {
  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (interaction.replied || interaction.deferred) {
    await interaction.editReply(payload).catch(() => null);
    return;
  }
  await interaction.reply(payload).catch(() => null);
}

async function skipOrStop(client, player, track) {
  if (!player) return;

  const forceDestroy = async () => {
    if (typeof player.destroy === "function") {
      await player.destroy("stopped", true).catch(() => null);
    }
  };

  if (shouldStopOnSkip(player)) {
    stopControllerAutoUpdate(client, player.guildId);
    const stoppedTrack = track || player?.get?.("lastTrack") || null;
    await updateStoredControllerMessage(client, player, stoppedTrack, { stopped: true }).catch(() => null);
    await forceDestroy();
    return;
  }

  let queuedTracksCount = 0;
  if (Array.isArray(player?.queue?.tracks)) {
    queuedTracksCount = player.queue.tracks.length;
  } else {
    const size = Number(player?.queue?.size);
    queuedTracksCount = Number.isFinite(size)
      ? Math.max(0, size - (player?.queue?.current ? 1 : 0))
      : 0;
  }
  if (typeof player.skip === "function") {
    await player.skip().catch(async () => {
      await forceDestroy();
    });
    return;
  }

  await forceDestroy();
}

function getHumanMembersCount(interaction, player) {
  const channel =
    interaction?.guild?.channels?.cache?.get(player?.voiceChannelId) ||
    interaction?.member?.voice?.channel ||
    null;

  if (!channel?.members) return 1;
  return channel.members.filter((member) => !member.user.bot).size;
}

module.exports = {
  name: "skip",
  description: "Пропустить текущий трек.",
  permissions: "0x0000000000000800",
  options: [],
  voiceChannel: true,
  run: async (client, interaction) => {
    const lang = await getLang(client, interaction.guildId);

    try {
      const player = getPlayer(client, interaction.guildId);
      const current = getCurrentTrack(player);

      if (!player || !current) {
        const embed = new EmbedBuilder()
          .setColor(client.config.errorColor)
          .setDescription("Сейчас ничего не играет.");
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      if (!userCanManageByDj(player, interaction.user.id)) {
        const embed = new EmbedBuilder()
          .setColor(client.config.errorColor)
          .setDescription("Вы не являетесь DJ в этом голосовом канале.");
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      const remainingMs = getSkipCooldownMs(player);
      if (remainingMs > 0) {
        const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
        const embed = new EmbedBuilder()
          .setColor(client.config.errorColor)
          .setDescription(`Подождите **${seconds} сек.** перед следующим пропуском.`);
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        }).catch(() => null);
        return;
      }

      const expectedVote = !hasDjRestriction(player) && getHumanMembersCount(interaction, player) >= 2;
      setSkipCooldown(player, expectedVote ? 32_000 : 2_000);

      if (!hasDjRestriction(player)) {
        const vote = await runSkipVote(client, interaction, player, current, {
          useInteractionReply: true,
          skippedByUserId: interaction.user.id,
          proposedByUserId: interaction.user.id,
        });
        if (!vote.passed) {
          setSkipCooldown(player, 1_000);
          return;
        }

        await skipOrStop(client, player, current);
        setSkipCooldown(player, 1_200);
        if (!vote.voteMessage) {
          const embed = buildSkippedEmbed(client, interaction.user.id, current);
          await replyPublic(interaction, embed);
        }
        return;
      }

      await skipOrStop(client, player, current);
      setSkipCooldown(player, 1_200);
      const embed = buildSkippedEmbed(client, interaction.user.id, current);
      await replyPublic(interaction, embed);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
