const { EmbedBuilder } = require("discord.js");

function getVoiceChannelForPlayer(interaction, player) {
  const guild = interaction.guild;
  if (!guild || !player?.voiceChannelId) return null;
  return guild.channels.cache.get(player.voiceChannelId) || null;
}

function getTrackTitle(track) {
  return track?.info?.title || track?.title || "текущий трек";
}

function getTrackUrl(track) {
  return track?.info?.uri || track?.uri || null;
}

function formatTrackLabel(track) {
  const title = getTrackTitle(track);
  const url = getTrackUrl(track);
  if (url) return `[${title}](${url})`;
  return `**${title}**`;
}

function buildVoteEmbed({
  color,
  title,
  trackLabel = null,
  proposedByUserId = null,
  current,
  needed,
  timedOut = false,
  passed = false,
  passedDescription = null,
}) {
  const embed = new EmbedBuilder().setColor(color);

  if (timedOut) {
    embed.setDescription("Время голосования истекло. Трек не пропущен.");
    return embed;
  }

  if (passed) {
    embed.setDescription(
      passedDescription || `Голосование завершено. Трек **${title}** будет пропущен.`,
    );
    return embed;
  }

  const header = proposedByUserId
    ? `<@${proposedByUserId}> предложил(-а) пропустить трек ${trackLabel || `**${title}**`}.`
    : `Нужно голосование для пропуска трека **${title}**.`;

  embed.setDescription(`${header}\nНажмите ⏩, чтобы проголосовать. **${current} из ${needed}**`);
  return embed;
}

async function sendVoteMessage(interaction, payload, useInteractionReply) {
  if (!useInteractionReply) {
    return interaction.channel.send({
      ...payload,
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({
      ...payload,
      fetchReply: true,
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  await interaction.reply({
    ...payload,
    fetchReply: true,
    allowedMentions: { parse: [] },
  }).catch(() => null);

  return interaction.fetchReply().catch(() => null);
}

async function runSkipVote(client, interaction, player, track, options = {}) {
  const useInteractionReply = Boolean(options.useInteractionReply);
  const skippedByUserId = options.skippedByUserId || null;
  const proposedByUserId = options.proposedByUserId || skippedByUserId || null;
  const customPassedDescription = options.passedDescription || null;

  const voiceChannel = getVoiceChannelForPlayer(interaction, player);
  if (!voiceChannel) {
    return { passed: true, reason: "no_voice_channel" };
  }

  const humanMembers = voiceChannel.members.filter((member) => !member.user.bot);
  if (humanMembers.size < 2) {
    return { passed: true, reason: "not_enough_users_for_vote" };
  }

  const neededVotes = Math.floor(humanMembers.size / 2) + 1;
  const voters = new Set();
  const title = getTrackTitle(track);
  const trackLabel = formatTrackLabel(track);

  const voteMessage = await sendVoteMessage(
    interaction,
    {
      embeds: [buildVoteEmbed({
        color: client.config.embedColor,
        title,
        trackLabel,
        proposedByUserId,
        current: 0,
        needed: neededVotes,
      })],
    },
    useInteractionReply,
  );

  if (!voteMessage) {
    return { passed: false, reason: "cannot_send_vote_message" };
  }

  await voteMessage.react("⏩").catch(() => null);

  const filter = (reaction, user) => {
    if (user.bot) return false;
    if (reaction.message.id !== voteMessage.id) return false;
    if (reaction.emoji.name !== "⏩") return false;
    return voiceChannel.members.has(user.id);
  };

  const passed = await new Promise((resolve) => {
    const collector = voteMessage.createReactionCollector({
      filter,
      time: 30_000,
    });

    collector.on("collect", async (_reaction, user) => {
      if (voters.has(user.id)) return;

      voters.add(user.id);
      await voteMessage
        .edit({
          embeds: [
            buildVoteEmbed({
              color: client.config.embedColor,
              title,
              trackLabel,
              proposedByUserId,
              current: voters.size,
              needed: neededVotes,
            }),
          ],
          allowedMentions: { parse: [] },
        })
        .catch(() => null);

      if (voters.size >= neededVotes) {
        collector.stop("passed");
      }
    });

    collector.on("end", async (_collected, reason) => {
      if (reason === "passed") {
        const passedDescription = customPassedDescription || (
          skippedByUserId
            ? `<@${skippedByUserId}> пропустил(-а) трек ${formatTrackLabel(track)}`
            : `Голосование завершено. Трек **${title}** будет пропущен.`
        );

        await voteMessage
          .edit({
            embeds: [
              buildVoteEmbed({
                color: client.config.embedColor,
                title,
                trackLabel,
                proposedByUserId,
                current: voters.size,
                needed: neededVotes,
                passed: true,
                passedDescription,
              }),
            ],
            allowedMentions: { parse: [] },
          })
          .catch(() => null);
        resolve(true);
        return;
      }

      await voteMessage
        .edit({
          embeds: [
              buildVoteEmbed({
                color: client.config.embedColor,
                title,
                trackLabel,
                proposedByUserId,
                current: voters.size,
                needed: neededVotes,
                timedOut: true,
            }),
          ],
          allowedMentions: { parse: [] },
        })
        .catch(() => null);
      resolve(false);
    });
  });

  return {
    passed,
    votes: voters.size,
    neededVotes,
    voteMessage,
  };
}

module.exports = {
  runSkipVote,
  formatTrackLabel,
};
