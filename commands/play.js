const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { getLang } = require("../utils/lang");
const {
  ensureVoicePermissions,
  getOrCreatePlayer,
  search,
  mapTrack,
} = require("../utils/music");
const { buildCard } = require("../utils/ui");

module.exports = {
  name: "play",
  description: "Запустить музыку по ссылке или названию.",
  permissions: "0x0000000000000800",
  options: [
    {
      name: "запрос",
      description: "Введите название трека или URL.",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: "источник",
      description: "В каких недрах интернета будем искать трек?",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "SoundCloud", value: "soundcloud" },
        { name: "Spotify", value: "spotify" },
        { name: "YouTube", value: "youtube" },
        { name: "YouTube Music", value: "ytmsearch" },
      ],
    },
  ],
  voiceChannel: true,
  run: async (client, interaction) => {
    const lang = await getLang(client, interaction.guildId);

    try {
      const requesterName = interaction.user.globalName || interaction.user.username;
      const requesterMention = `<@${interaction.user.id}>`;
      const query =
        interaction.options.getString("запрос") ||
        interaction.options.getString("name");
      const source =
        interaction.options.getString("источник") ||
        interaction.options.getString("source") ||
        "soundcloud";

      if (!query) {
        const embed = new EmbedBuilder()
          .setDescription("Введите название трека.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      const canJoin = await ensureVoicePermissions(interaction, client);
      if (!canJoin) {
        const embed = new EmbedBuilder()
          .setDescription("Я не могу подключиться или говорить в вашем голосовом канале.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      await interaction.deferReply().catch(() => null);

      const player = await getOrCreatePlayer(client, interaction);
      const result = await search(player, client, query, source, {
        id: interaction.user.id,
        tag: interaction.user.tag,
        name: requesterName,
      });

      if (!result || !result.tracks || !result.tracks.length) {
        const embed = new EmbedBuilder()
          .setDescription("Ничего не найдено.")
          .setColor(client.config.errorColor);
        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      const requester = { id: interaction.user.id, tag: interaction.user.tag, name: requesterName };
      const tracks = result.tracks.map((track) => ({
        ...track,
        requester,
        userData: {
          ...(track.userData || {}),
          requesterId: interaction.user.id,
          requesterTag: interaction.user.tag,
          requesterName,
        },
      }));

      const wasIdle = !player.playing && !player.paused && !player.queue.current;
      const isPlaylist = String(result.loadType || "").toLowerCase().includes("playlist");

      if (isPlaylist) {
        player.queue.add(tracks);
      } else {
        player.queue.add(tracks[0]);
      }

      if (wasIdle) {
        await player.play().catch(() => null);
      }

      if (isPlaylist) {
        const playlistName = (result.playlist && result.playlist.name) || "Плейлист";
        const playlistUrl = result.playlist && result.playlist.url;
        const payload = buildCard({
          sections: [
            [`${requesterMention} добавляет плейлист:`],
            [
              playlistUrl ? `## [${playlistName}](${playlistUrl})` : `## ${playlistName}`,
              `Содержит ${tracks.length} треков`,
            ],
          ],
          color: client.config.embedColor,
          includeV2: true,
        });
        await interaction.editReply({ ...payload, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      const song = mapTrack(tracks[0]);
      const payload = buildCard({
        sections: [
          [`${requesterMention} добавляет трек:`],
          [
            song.url ? `## [${song.name}](${song.url})` : `## ${song.name}`,
            `${song.uploader?.name || "Неизвестно"} - \`${song.formattedDuration}\``,
          ],
        ],
        color: client.config.embedColor,
        includeV2: true,
      });

      await interaction.editReply({ ...payload, allowedMentions: { parse: [] } }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
