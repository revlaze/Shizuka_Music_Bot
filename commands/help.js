const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");

function getCommandModules(client) {
  if (client?.commandMap instanceof Map) {
    return [...client.commandMap.values()];
  }
  if (Array.isArray(client?.commands)) {
    return [...client.commands];
  }
  return [];
}

function normalizeCommandName(raw) {
  return String(raw || "").trim().replace(/^\/+/, "").toLowerCase();
}

function formatOptionType(type) {
  const byValue = {
    [ApplicationCommandOptionType.String]: "текст",
    [ApplicationCommandOptionType.Integer]: "число",
    [ApplicationCommandOptionType.Boolean]: "да/нет",
    [ApplicationCommandOptionType.User]: "участник",
    [ApplicationCommandOptionType.Channel]: "канал",
    [ApplicationCommandOptionType.Role]: "роль",
    [ApplicationCommandOptionType.Number]: "число",
    [ApplicationCommandOptionType.Attachment]: "файл",
  };
  return byValue[type] || "параметр";
}

module.exports = {
  name: "help",
  description: "Список доступных команд.",
  permissions: "0x0000000000000800",
  options: [
    {
      name: "command",
      description: "Показать подробную информацию по конкретной команде.",
      type: ApplicationCommandOptionType.String,
      required: false,
    },
  ],
  showHelp: false,
  run: async (client, interaction) => {
    try {
      const commandModules = getCommandModules(client);
      const commandName = normalizeCommandName(
        interaction.options.getString("command") ||
          interaction.options.getString("команда") ||
          interaction.options.getString("info"),
      );

      if (commandName) {
        const command = commandModules.find((item) => normalizeCommandName(item?.name) === commandName);
        if (!command) {
          await interaction.reply({
            content: "Команда не найдена.",
            flags: 64,
            allowedMentions: { parse: [] },
          }).catch(() => null);
          return;
        }

        const optionsText = Array.isArray(command.options) && command.options.length
          ? command.options.map((opt) => {
            const required = opt.required ? "обязательный" : "необязательный";
            const type = formatOptionType(opt.type);
            return `• \`${opt.name}\` (${type}, ${required}) — ${opt.description || "без описания"}`;
          }).join("\n")
          : "Опций нет";

        const embed = new EmbedBuilder()
          .setTitle(`Информация о команде: /${command.name}`)
          .setDescription(
            `**Описание:** ${command.description || "без описания"}\n\n**Опции:**\n${optionsText}`,
          )
          .setColor(client.config.embedColor)
          .setTimestamp();

        await interaction.reply({
          embeds: [embed],
          flags: 64,
          allowedMentions: { parse: [] },
        }).catch(() => null);
        return;
      }

      const commands = commandModules
        .filter((cmd) => cmd?.name)
        .filter((cmd) => cmd.showHelp !== false)
        .map((cmd) => `\`/${cmd.name}\` — ${cmd.description || "без описания"}`)
        .sort((a, b) => a.localeCompare(b, "ru"));

      const embed = new EmbedBuilder()
        .setColor(client.config.embedColor)
        .setTitle("Список доступных команд")
        .setThumbnail(client.user.displayAvatarURL())
        .setDescription(commands.join("\n") || "Команд пока нет.")
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    } catch (e) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, e, {});
    }
  },
};

