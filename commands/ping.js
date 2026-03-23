const http = require("http");
const https = require("https");
const { EmbedBuilder } = require("discord.js");
const db = require("../postgresqlDB");
const { buildCard } = require("../utils/ui");

const LATENCY_EMOJI_GOOD = "<:6300pingconnection:1252999962141397052>";
const LATENCY_EMOJI_MID = "<:3566pingconnection2:1252999959872274523>";
const LATENCY_EMOJI_BAD = "<:1000pingconnection3:1252999954671210516>";
const TITLE_EMOJI = "<:pingpong:1340383418038489088>";
const CLUSTER_EMOJI = "<:claster:1346926953298661500>";

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function toMs(start, end) {
  return Math.max(0, Math.round(end - start));
}

function getLatencyEmoji(ms) {
  if (!Number.isFinite(ms)) return LATENCY_EMOJI_BAD;
  if (ms < 150) return LATENCY_EMOJI_GOOD;
  if (ms < 200) return LATENCY_EMOJI_MID;
  return LATENCY_EMOJI_BAD;
}

function formatLatency(ms) {
  if (!Number.isFinite(ms)) return "Недоступна";
  return `${Math.round(ms)} мс`;
}

function normalizeLatencyMs(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric === 0) return 0;

  // Иногда библиотека может вернуть секунды (0.123) вместо миллисекунд.
  if (numeric > 0 && numeric < 1) return Math.round(numeric * 1000);

  // Иногда приходит значение в микросекундах.
  if (numeric > 100_000 && numeric < 10_000_000) return Math.round(numeric / 1000);

  return Math.round(numeric);
}

function getShardName(client, shardId) {
  const names = client?.config?.shardNames || client?.config?.shard_names;
  if (Array.isArray(names) && names[shardId]) return String(names[shardId]);
  if (names && typeof names === "object" && names[shardId]) return String(names[shardId]);
  return `Шард ${Number(shardId) + 1}`;
}

async function getDiscordApiLatency() {
  const url = "https://discord.com/api/v10/gateway";
  const start = nowMs();

  if (typeof fetch === "function") {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      await fetch(url, { method: "GET", signal: controller.signal });
      clearTimeout(timer);
      return toMs(start, nowMs());
    } catch {
      return null;
    }
  }

  return new Promise((resolve) => {
    const request = https.get(url, (response) => {
      response.resume();
      response.on("end", () => resolve(toMs(start, nowMs())));
    });

    request.on("error", () => resolve(null));
    request.setTimeout(7000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

async function getDatabaseLatency() {
  if (!db?.pool) return null;
  const start = nowMs();
  try {
    await db.pool.query("SELECT 1");
    return toMs(start, nowMs());
  } catch {
    return null;
  }
}

function getMapLikeValues(value) {
  if (!value) return [];
  if (value instanceof Map) return [...value.values()];
  if (value instanceof Set) return [...value.values()];
  if (Array.isArray(value)) return value;
  if (typeof value?.values === "function") {
    try {
      return [...value.values()];
    } catch {
      // Ничего не делаем, пробуем другие варианты.
    }
  }
  if (value?.cache) return getMapLikeValues(value.cache);
  if (value?.nodes) return getMapLikeValues(value.nodes);
  if (typeof value === "object") return Object.values(value);
  return [];
}

function normalizeProbeAddress(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      host: "",
      port: null,
      secure: null,
      basePath: "",
    };
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    const parsedPort = Number(parsed.port);
    const pathname = String(parsed.pathname || "").trim();
    const basePath = pathname && pathname !== "/"
      ? `/${pathname.replace(/^\/+|\/+$/g, "")}`
      : "";

    return {
      host: String(parsed.hostname || "").trim(),
      port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : null,
      secure: parsed.protocol === "https:" || parsed.protocol === "wss:",
      basePath,
    };
  } catch {
    return {
      host: raw.replace(/^https?:\/\//i, "").replace(/\/+.*$/, "").trim(),
      port: null,
      secure: null,
      basePath: "",
    };
  }
}

function hasBoolean(value) {
  return typeof value === "boolean";
}

function buildProbeConfig({
  hostValue,
  portValue,
  secureValue,
  passwordValue,
  basePathValue,
}) {
  const parsed = normalizeProbeAddress(hostValue);
  const host = String(parsed.host || "").trim();
  const explicitPort = Number(portValue);
  const port = Number.isFinite(explicitPort) && explicitPort > 0
    ? explicitPort
    : parsed.port;

  let secure;
  if (hasBoolean(secureValue)) secure = secureValue;
  else secure = parsed.secure;
  if (!hasBoolean(secure)) secure = false;

  const password = String(passwordValue || "").trim();
  const pathRaw = String(basePathValue || "").trim();
  const basePath = pathRaw
    ? `/${pathRaw.replace(/^\/+|\/+$/g, "")}`
    : parsed.basePath;

  if (!host || !Number.isFinite(port) || port <= 0) return null;

  return {
    host,
    port,
    secure,
    password: password || null,
    basePath: basePath || "",
  };
}

function resolveProbeFromRuntimeNode(node) {
  return buildProbeConfig({
    hostValue:
      node?.host ||
      node?.options?.host ||
      node?.rest?.address ||
      node?.rest?.url ||
      node?.url ||
      "",
    portValue:
      node?.port ??
      node?.options?.port ??
      node?.rest?.port ??
      null,
    secureValue:
      hasBoolean(node?.secure) ? node.secure
        : hasBoolean(node?.options?.secure) ? node.options.secure
          : hasBoolean(node?.rest?.secure) ? node.rest.secure
            : undefined,
    passwordValue:
      node?.authorization ||
      node?.password ||
      node?.options?.authorization ||
      node?.options?.password ||
      node?.headers?.Authorization ||
      "",
    basePathValue:
      node?.path ||
      node?.options?.path ||
      node?.rest?.path ||
      "",
  });
}

function resolveProbeFromConfigNode(node) {
  return buildProbeConfig({
    hostValue: node?.host || "",
    portValue: node?.port,
    secureValue: hasBoolean(node?.secure) ? node.secure : undefined,
    passwordValue: node?.password || "",
    basePathValue: node?.path || "",
  });
}

function buildProbePath(basePath, endpoint) {
  const normalizedBase = String(basePath || "").trim().replace(/\/+$/g, "");
  const normalizedEndpoint = `/${String(endpoint || "").replace(/^\/+/g, "")}`;
  return normalizedBase ? `${normalizedBase}${normalizedEndpoint}` : normalizedEndpoint;
}

function isProbeUsable(probe) {
  return Boolean(probe?.host) && Number.isFinite(Number(probe?.port));
}

async function probeEndpointLatency(probe, endpoint, timeoutMs = 6000) {
  if (!isProbeUsable(probe)) return null;

  const client = probe.secure ? https : http;
  const start = nowMs();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const request = client.request(
      {
        hostname: probe.host,
        port: probe.port,
        path: buildProbePath(probe.basePath, endpoint),
        method: "GET",
        headers: {
          ...(probe.password ? { Authorization: probe.password } : {}),
          "User-Agent": "Akery-Ping/1.0",
        },
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        finish(toMs(start, nowMs()));
      },
    );

    request.on("error", () => finish(null));
    request.on("timeout", () => {
      request.destroy();
      finish(null);
    });
    request.end();
  });
}

async function probeLavalinkNodeLatency(probe, timeoutMs = 6000) {
  if (!isProbeUsable(probe)) return null;

  const endpoints = ["version", "v4/info", "v4/stats", "v3/stats"];
  const attempts = endpoints.map((endpoint) => probeEndpointLatency(probe, endpoint, timeoutMs).then((ms) => {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("latency_unavailable");
    }
    return Math.round(ms);
  }));

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

function resolveNodeLatency(node) {
  const candidates = [
    node?.latency,
    node?.ping,
    node?.wsPing,
    node?.ws?.ping,
    node?.socket?.ping,
    node?.stats?.latency,
    node?.stats?.ping,
    node?.rest?.latency,
    node?.session?.latency,
    node?.session?.stats?.latency,
  ];

  for (const candidate of candidates) {
    const value = normalizeLatencyMs(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }

  return null;
}

function resolveNodeName(node, index) {
  const candidates = [
    node?.id,
    node?.name,
    node?.identifier,
    node?.options?.id,
    node?.options?.identifier,
    node?._identifier,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }

  return `Node ${index + 1}`;
}

async function collectNodeInfos(client) {
  const containers = [
    client?.player?.nodeManager?.nodes,
    client?.player?.nodeManager?.cache,
    client?.player?.nodes,
  ];

  const collected = [];
  for (const container of containers) {
    collected.push(...getMapLikeValues(container));
  }
  const configNodes = Array.isArray(client?.config?.lavalink?.nodes)
    ? client.config.lavalink.nodes
    : [];

  const byName = new Map();

  for (let i = 0; i < collected.length; i += 1) {
    const node = collected[i];
    const name = resolveNodeName(node, i);
    if (!name || byName.has(name)) continue;

    byName.set(name, {
      name,
      latency: resolveNodeLatency(node),
      probe: resolveProbeFromRuntimeNode(node),
    });
  }

  for (let i = 0; i < configNodes.length; i += 1) {
    const node = configNodes[i];
    const name = String(node?.id || `Node ${i + 1}`);
    const existing = byName.get(name);
    const probe = resolveProbeFromConfigNode(node);

    if (!existing) {
      byName.set(name, {
        name,
        latency: null,
        probe,
      });
      continue;
    }

    if (!existing.probe && probe) {
      existing.probe = probe;
    } else if (!isProbeUsable(existing.probe) && isProbeUsable(probe)) {
      existing.probe = probe;
    }
  }

  const nodes = [...byName.values()];
  if (!nodes.length) return [];

  await Promise.all(nodes.map(async (node) => {
    if (Number.isFinite(node.latency) && node.latency >= 0) return;
    if (!node.probe) return;
    node.latency = await probeLavalinkNodeLatency(node.probe);
  }));

  return nodes.map((node) => ({
    name: node.name,
    latency: Number.isFinite(node.latency) && node.latency >= 0 ? Math.round(node.latency) : null,
  }));
}

async function collectShardInfos(client) {
  if (client?.shard?.broadcastEval) {
    const raw = await client.shard.broadcastEval((c) => ({
      id: c?.shard?.ids?.[0] ?? 0,
      latency: Number(c?.ws?.ping ?? 0),
      guilds: c?.guilds?.cache?.size ?? 0,
    })).catch(() => null);

    if (Array.isArray(raw) && raw.length) {
      return raw
        .map((item) => ({
          id: Number(item?.id ?? 0),
          latency: Number(item?.latency ?? 0),
          guilds: Number(item?.guilds ?? 0),
        }))
        .sort((a, b) => a.id - b.id);
    }
  }

  return [{
    id: 0,
    latency: Number(client?.ws?.ping ?? 0),
    guilds: Number(client?.guilds?.cache?.size ?? 0),
  }];
}

module.exports = {
  name: "ping",
  description: "Пинг бота",
  permissions: "0x0000000000000800",
  options: [],
  run: async (client, interaction) => {
    try {
      await interaction.deferReply().catch(() => null);

      const dbLatency = await getDatabaseLatency();
      const apiLatency = await getDiscordApiLatency();
      const botLatency = Number(client?.ws?.ping ?? 0);

      const dbEmoji = getLatencyEmoji(dbLatency);
      const apiEmoji = getLatencyEmoji(apiLatency);
      const botEmoji = getLatencyEmoji(botLatency);

      const nodeInfos = await collectNodeInfos(client);
      const nodesDescription = nodeInfos.length
        ? nodeInfos.map((node) => {
          const emoji = getLatencyEmoji(node.latency);
          return `**${emoji} ${node.name}: \`${formatLatency(node.latency)}\`**`;
        }).join("\n")
        : "**Нет подключенных нод**";

      const shardInfos = await collectShardInfos(client);
      const totalShards = shardInfos.length || 1;
      const currentShardId = interaction.guild?.shardId ?? 0;
      const currentShardNumber = currentShardId + 1;
      const currentShardName = getShardName(client, currentShardId);

      const shardLines = shardInfos.map((shard) => {
        const emoji = getLatencyEmoji(shard.latency);
        const line = `${emoji} ${getShardName(client, shard.id)} ${shard.id + 1}/${totalShards} (ID ${shard.id}): ` +
          `\`${formatLatency(shard.latency)}\` - Серверов: \`${shard.guilds}\``;
        return shard.id === currentShardId ? `**${line}**` : `**${line}**`;
      }).join("\n");

      const payload = buildCard({
        title: `**${TITLE_EMOJI} | Пинг бота**`,
        sections: [
          [
            `>>> **${botEmoji} Средняя задержка бота: \`${formatLatency(botLatency)}\`**\n` +
            `**${apiEmoji} Задержка до Discord API: \`${formatLatency(apiLatency)}\`**\n` +
            `**${dbEmoji} Средняя задержка до базы данных: \`${formatLatency(dbLatency)}\`**`,
          ],
          [
            `### **${CLUSTER_EMOJI} | Пинг музыкальных нод**`,
            `>>> ${nodesDescription}`,
          ],
          [
            `### **${CLUSTER_EMOJI} | Информация по осколкам**`,
            `>>> ${shardLines}`,
          ],
        ],
        footer: `Сервер расположен на осколке: ${currentShardName} (${currentShardNumber}/${totalShards}) (ID: ${currentShardId})`,
        color: client.config.embedColor,
        includeV2: true,
      });

      await interaction.editReply({ ...payload, allowedMentions: { parse: [] } }).catch(async () => {
        const embed = new EmbedBuilder()
          .setColor(client.config.embedColor)
          .setTitle("Пинг бота")
          .setDescription(
            `>>> **${botEmoji} Бот: \`${formatLatency(botLatency)}\`**\n` +
            `**${apiEmoji} Discord API: \`${formatLatency(apiLatency)}\`**\n` +
            `**${dbEmoji} База данных: \`${formatLatency(dbLatency)}\`**\n\n` +
            `**Ноды:**\n>>> ${nodesDescription}\n\n` +
            `**Шарды:**\n>>> ${shardLines}`,
          );
        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
      });
    } catch (error) {
      const errorNotifer = require("../functions.js");
      errorNotifer(client, interaction, error, {});
    }
  },
};
