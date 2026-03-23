const {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const { getLang } = require("../utils/lang");
const {
  ensureVoicePermissions,
  getOrCreatePlayer,
  searchAcrossSources,
  mapTrack,
  formatSourceName,
} = require("../utils/music");
const { buildCard } = require("../utils/ui");

module.exports = {
  name: "search",
  description: "Найти треки и выбрать нужный.",
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
        { name: "Все источники (по умолчанию)", value: "all" },
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
      const query =
        interaction.options.getString("запрос") ||
        interaction.options.getString("name");
      const source =
        interaction.options.getString("источник") ||
        interaction.options.getString("source") ||
        "all";

      if (!query) {
        const embed = new EmbedBuilder()
          .setDescription("Введите поисковый запрос.")
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
      const result = await searchAcrossSources(player, client, query, {
        id: interaction.user.id,
        tag: interaction.user.tag,
        name: requesterName,
      }, source);
      const tracks = (result?.tracks || []).slice(0, 10);

      if (!tracks.length) {
        const embed = new EmbedBuilder()
          .setDescription("Ничего не найдено.")
          .setColor(client.config.errorColor);
        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      const menuOptions = tracks.map((track, index) => {
        const mapped = mapTrack(track);
        return {
          label: `${index + 1}. ${mapped.name}`.slice(0, 100),
          value: String(index),
          description: `${mapped.formattedDuration} - ${mapped.source}`.slice(0, 100),
        };
      });

      const select = new StringSelectMenuBuilder()
        .setCustomId(`search_pick:${interaction.id}`)
        .setPlaceholder("Выберите трек")
        .addOptions(menuOptions);

      const payload = buildCard({
        title: "Результаты поиска",
        sections: [
          tracks.map((track, index) => {
            const mapped = mapTrack(track);
            return `\`${index + 1}.\` ${mapped.name} - \`${mapped.formattedDuration}\` - ${mapped.source}`;
          }),
        ],
        color: client.config.embedColor,
        buttons: [select],
        footer: source === "all"
          ? `Источники: ${(result?.sources || []).join(", ") || "не определены"}`
          : `Источник: ${formatSourceName(source)}`,
        includeV2: true,
      });

      if (!payload.components || !payload.flags) {
        const row = new ActionRowBuilder().addComponents(select);
        await interaction.editReply({
          embeds: payload.embeds,
          components: [row],
          allowedMentions: { parse: [] },
        });
      } else {
        await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
      }

      const message = await interaction.fetchReply().catch(() => null);
      if (!message) return;

      const collector = message.createMessageComponentCollector({
        time: 60_000,
        filter: (i) => i.user.id === interaction.user.id && i.customId === `search_pick:${interaction.id}`,
      });

      collector.on("collect", async (menuInteraction) => {
        const selectedIndex = Number(menuInteraction.values?.[0]);
        const selectedTrack = tracks[selectedIndex];
        if (!selectedTrack) {
          await menuInteraction.deferUpdate().catch(() => null);
          return;
        }

        const trackWithRequester = {
          ...selectedTrack,
          requester: { id: interaction.user.id, tag: interaction.user.tag, name: requesterName },
          userData: {
            ...(selectedTrack.userData || {}),
            requesterId: interaction.user.id,
            requesterTag: interaction.user.tag,
            requesterName,
          },
        };

        const wasIdle = !player.playing && !player.paused && !player.queue.current;
        player.queue.add(trackWithRequester);
        if (wasIdle) await player.play().catch(() => null);

        const song = mapTrack(trackWithRequester);
        const confirm = buildCard({
          title: "Добавлено в очередь",
          sections: [[`**${song.name}**`, `Длительность: \`${song.formattedDuration}\``]],
          color: client.config.embedColor,
          includeV2: true,
        });

        await menuInteraction.update({ ...confirm, allowedMentions: { parse: [] } }).catch(async () => {
          const embed = new EmbedBuilder()
            .setColor(client.config.embedColor)
            .setDescription(`Добавлено в очередь: **${song.name}** \`${song.formattedDuration}\``);
          await menuInteraction.update({ embeds: [embed], components: [], allowedMentions: { parse: [] } }).catch(() => null);
        });
        collector.stop("selected");
      });

      collector.on("end", async (_collected, reason) => {
        if (reason === "selected") return;
        const expired = buildCard({
          title: "Время выбора истекло",
          sections: [["Время поиска истекло."]],
          color: client.config.embedColor,
          includeV2: true,
        });
        await interaction.editReply({ ...expired, allowedMentions: { parse: [] } }).catch(async () => {
          const embed = new EmbedBuilder()
            .setColor(client.config.embedColor)
            .setDescription("Время поиска истекло.");
          await interaction.editReply({ embeds: [embed], components: [], allowedMentions: { parse: [] } }).catch(() => null);
        });
      });
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, lang);
    }
  },
};
