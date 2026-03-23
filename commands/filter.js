const {
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const { getLang } = require("../utils/lang");
const { getPlayer, getCurrentTrack } = require("../utils/music");
const { buildCard } = require("../utils/ui");

const FILTERS = [
  {
    id: "nightcore",
    label: "Найткор",
    stateKeys: ["nightcore", "nightCore"],
    setMethod: "setNightcore",
    toggleMethod: "toggleNightcore",
  },
  {
    id: "vaporwave",
    label: "Вейпорвейв",
    stateKeys: ["vaporwave", "vaporWave"],
    setMethod: "setVaporwave",
    toggleMethod: "toggleVaporwave",
  },
  {
    id: "karaoke",
    label: "Караоке",
    stateKeys: ["karaoke"],
    setMethod: "setKaraoke",
    toggleMethod: "toggleKaraoke",
  },
  {
    id: "tremolo",
    label: "Тремоло",
    stateKeys: ["tremolo"],
    setMethod: "setTremolo",
    toggleMethod: "toggleTremolo",
  },
  {
    id: "rotation",
    label: "Вращение",
    stateKeys: ["rotation"],
    setMethod: "setRotation",
    toggleMethod: "toggleRotation",
  },
  {
    id: "lowpass",
    label: "Низкие частоты",
    stateKeys: ["lowPass", "lowpass"],
    setMethod: "setLowPass",
    toggleMethod: "toggleLowPass",
  },
];

const FILTER_BY_ID = new Map(FILTERS.map((filter) => [filter.id, filter]));

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    return ["on", "true", "enabled", "1", "вкл", "включить"].includes(normalized);
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "enabled")) {
      return normalizeBoolean(value.enabled);
    }
    if (Object.prototype.hasOwnProperty.call(value, "isEnabled")) {
      return normalizeBoolean(value.isEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return normalizeBoolean(value.value);
    }
  }
  return false;
}

function normalizeStateMap(rawState) {
  if (!rawState) return {};
  if (rawState instanceof Map) {
    return Object.fromEntries(rawState.entries());
  }
  if (typeof rawState === "object") {
    return rawState;
  }
  return {};
}

function resolveFilterState(stateMap, filterId) {
  const filter = FILTER_BY_ID.get(filterId);
  if (!filter) return { known: false, enabled: false };

  for (const key of filter.stateKeys) {
    if (Object.prototype.hasOwnProperty.call(stateMap, key)) {
      return { known: true, enabled: normalizeBoolean(stateMap[key]) };
    }
  }

  return { known: false, enabled: false };
}

function saveFilterStateCache(player, nextState) {
  if (!player?.set) return;
  const prevState = normalizeStateMap(player?.get?.("filterStateCache"));
  player.set("filterStateCache", {
    ...prevState,
    ...nextState,
  });
}

function getAllFilterStates(manager, player) {
  const rawState = manager?.checkFiltersState?.();
  const stateMap = normalizeStateMap(rawState);
  const cachedState = normalizeStateMap(player?.get?.("filterStateCache"));
  const result = {};

  for (const filter of FILTERS) {
    const resolved = resolveFilterState(stateMap, filter.id);
    if (resolved.known) {
      result[filter.id] = resolved.enabled;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(cachedState, filter.id)) {
      result[filter.id] = normalizeBoolean(cachedState[filter.id]);
      continue;
    }
    result[filter.id] = false;
  }

  return result;
}

async function applyFilter(manager, filterId, player) {
  const filter = FILTER_BY_ID.get(filterId);
  if (!filter || !manager) return false;

  const states = getAllFilterStates(manager, player);
  const current = Boolean(states[filterId]);
  const next = !current;

  const setter = manager[filter.setMethod];
  if (typeof setter === "function") {
    await setter.call(manager, next);
    saveFilterStateCache(player, { [filterId]: next });
    return true;
  }

  const toggler = manager[filter.toggleMethod];
  if (typeof toggler === "function") {
    await toggler.call(manager);
    saveFilterStateCache(player, { [filterId]: next });
    return true;
  }

  return false;
}

async function resetAllFilters(manager, player) {
  if (!manager) return;

  if (typeof manager.resetFilters === "function") {
    await manager.resetFilters();
    const allOff = {};
    for (const filter of FILTERS) {
      allOff[filter.id] = false;
    }
    saveFilterStateCache(player, allOff);
    return;
  }

  for (const filter of FILTERS) {
    const setter = manager[filter.setMethod];
    if (typeof setter === "function") {
      await setter.call(manager, false);
      continue;
    }
    const toggler = manager[filter.toggleMethod];
    if (typeof toggler === "function") {
      const states = getAllFilterStates(manager, player);
      if (states[filter.id]) {
        await toggler.call(manager);
      }
    }
  }

  const allOff = {};
  for (const filter of FILTERS) {
    allOff[filter.id] = false;
  }
  saveFilterStateCache(player, allOff);
}

function buildFilterPayload(client, manager, prefix, options = {}) {
  const states = getAllFilterStates(manager, options.player);
  const title = options.title || "Фильтры Lavalink";
  const rows = FILTERS.map((filter) => {
    const status = states[filter.id] ? "ВКЛ" : "ВЫКЛ";
    return `\`${filter.label}\`: **${status}**`;
  });

  const buttons = options.interactive
    ? [
      ...FILTERS.map((filter) =>
        new ButtonBuilder()
          .setCustomId(`${prefix}:${filter.id}`)
          .setStyle(states[filter.id] ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setLabel(filter.label),
      ),
      new ButtonBuilder()
        .setCustomId(`${prefix}:clear`)
        .setStyle(ButtonStyle.Danger)
        .setLabel("Сброс"),
    ]
    : [];

  return buildCard({
    title,
    sections: [rows],
    buttons,
    color: client.config.embedColor,
    includeV2: true,
    footer: options.footer || null,
  });
}

module.exports = {
  name: "filter",
  description: "Открыть панель аудио-фильтров Lavalink.",
  permissions: "0x0000000000000800",
  options: [],
  voiceChannel: true,
  run: async (client, interaction) => {
    const lang = await getLang(client, interaction.guildId);

    try {
      const player = getPlayer(client, interaction.guildId);
      if (!player || !getCurrentTrack(player)) {
        const embed = new EmbedBuilder()
          .setDescription(lang.msg5 || "Сейчас ничего не играет.")
          .setColor(client.config.errorColor);
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      const manager = player.filterManager;
      if (!manager || typeof manager.checkFiltersState !== "function") {
        const embed = new EmbedBuilder()
          .setColor(client.config.errorColor)
          .setDescription("Фильтры не поддерживаются вашей конфигурацией Lavalink.");
        await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } }).catch(() => null);
        return;
      }

      const prefix = `filter:${interaction.id}`;
      const payload = buildFilterPayload(client, manager, prefix, {
        title: "Фильтры Lavalink",
        interactive: true,
        footer: "Панель активна 2 минуты.",
        player,
      });

      await interaction.reply({
        ...payload,
        fetchReply: true,
        allowedMentions: { parse: [] },
      }).catch(() => null);

      const message = await interaction.fetchReply().catch(() => null);
      if (!message) return;

      const collector = message.createMessageComponentCollector({
        time: 120_000,
        filter: (button) =>
          button.user.id === interaction.user.id &&
          button.customId.startsWith(prefix),
      });

      collector.on("collect", async (button) => {
        const action = button.customId.replace(`${prefix}:`, "");

        if (action === "clear") {
          await resetAllFilters(manager, player).catch(() => null);
          const updatedPayload = buildFilterPayload(client, manager, prefix, {
            title: "Фильтры сброшены",
            interactive: true,
            footer: "Панель активна 2 минуты.",
            player,
          });
          await button.update({ ...updatedPayload, allowedMentions: { parse: [] } }).catch(() => null);
          return;
        }

        const filterMeta = FILTER_BY_ID.get(action);
        if (!filterMeta) {
          await button.deferUpdate().catch(() => null);
          return;
        }

        await applyFilter(manager, action, player).catch(() => null);
        const states = getAllFilterStates(manager, player);
        const status = states[action] ? "ВКЛ" : "ВЫКЛ";

        const updatedPayload = buildFilterPayload(client, manager, prefix, {
          title: `Фильтр переключен: ${filterMeta.label} (${status})`,
          interactive: true,
          footer: "Панель активна 2 минуты.",
          player,
        });
        await button.update({ ...updatedPayload, allowedMentions: { parse: [] } }).catch(() => null);
      });

      collector.on("end", async () => {
        const finalPayload = buildFilterPayload(client, manager, prefix, {
          title: "Фильтры Lavalink",
          interactive: false,
          footer: "Панель закрыта.",
          player,
        });
        await interaction.editReply({ ...finalPayload, allowedMentions: { parse: [] } }).catch(() => null);
      });
    } catch (e) {
      const errorNotifier = require("../functions.js");
      errorNotifier(client, interaction, e, lang);
    }
  },
};
