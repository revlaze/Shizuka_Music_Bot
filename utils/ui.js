const {
  ActionRowBuilder,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require("discord.js");

function toColorNumber(color) {
  if (typeof color === "number") return color;
  if (!color) return 0x2b2d31;
  const normalized = String(color).replace(/^#/, "");
  const value = Number.parseInt(normalized, 16);
  return Number.isFinite(value) ? value : 0x2b2d31;
}

function supportsV2() {
  return Boolean(ContainerBuilder && TextDisplayBuilder && MessageFlags?.IsComponentsV2);
}

function splitRows(components = []) {
  const rows = [];
  for (let i = 0; i < components.length; i += 5) {
    rows.push(components.slice(i, i + 5));
  }
  return rows;
}

function normalizeSections(lines = [], sections = []) {
  const normalizedSections = Array.isArray(sections)
    ? sections
      .map((section) => {
        if (Array.isArray(section)) {
          const safe = section.filter(Boolean);
          return safe.length ? safe : null;
        }
        if (section) return [section];
        return null;
      })
      .filter(Boolean)
    : [];

  if (normalizedSections.length) return normalizedSections;

  const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  return safeLines.length ? [safeLines] : [];
}

function buildCard({
  title,
  lines = [],
  sections = [],
  buttons = [],
  color,
  footer,
  includeV2 = true,
}) {
  const contentSections = normalizeSections(lines, sections);
  const rows = splitRows(buttons);

  if (includeV2 && supportsV2()) {
    const container = new ContainerBuilder().setAccentColor(toColorNumber(color));

    if (title) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`));
    }

    if (contentSections.length) {
      contentSections.forEach((section, index) => {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(section.join("\n")),
        );

        if (index < contentSections.length - 1) {
          container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        }
      });
    }

    if (footer) {
      container
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(true),
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
    }

    for (const rowButtons of rows) {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(rowButtons));
    }

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  const embed = new EmbedBuilder().setColor(toColorNumber(color));
  if (title) embed.setTitle(title);
  if (contentSections.length) {
    embed.setDescription(contentSections.map((section) => section.join("\n")).join("\n\n"));
  }
  if (footer) embed.setFooter({ text: footer });

  return {
    embeds: [embed],
    components: rows.map((rowButtons) => new ActionRowBuilder().addComponents(rowButtons)),
  };
}

module.exports = {
  supportsV2,
  buildCard,
  toColorNumber,
};
