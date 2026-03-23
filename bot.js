const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { LavalinkManager } = require("lavalink-client");
const config = require("./config.js");
const db = require("./postgresqlDB");
const fs = require("fs");
const path = require("path");
const { stopControllerAutoUpdate } = require("./utils/musicPanel");

const ALL_INTENTS = [...new Set(
  Object.values(GatewayIntentBits).filter((value) => typeof value === "number"),
)];

const client = new Client({
  partials: [Partials.Channel, Partials.GuildMember, Partials.User, Partials.Message, Partials.Reaction],
  intents: ALL_INTENTS,
});

client.config = config;
client.language = config.language || "ru";
client.errorLog = config.errorLog;
client.commands = [];
client.commandMap = new Map();

const lavalinkNodes = (config.lavalink?.nodes || []).map((node, index) => ({
  id: node.id || `node-${index + 1}`,
  host: node.host,
  port: node.port,
  authorization: node.password,
  secure: Boolean(node.secure),
  retryAmount: node.retryAmount ?? 5,
  retryDelay: node.retryDelay ?? 5000,
}));

if (!lavalinkNodes.length) {
  console.warn("Не настроены узлы Lavalink в config.lavalink.nodes.");
}

client.player = new LavalinkManager({
  nodes: lavalinkNodes,
  autoSkip: true,
  client: {
    id: process.env.CLIENT_ID || "0",
    username: "music-bot",
  },
  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  },
  queueOptions: {
    maxPreviousTracks: 25,
  },
});

client.on("raw", (packet) => {
  try {
    client.player.sendRawData(packet);
  } catch {
    // Менеджер мог ещё не инициализироваться.
  }
});

const playerTrackStart = require("./events/player/playSong");
const playerTrackError = require("./events/player/error");
const playerQueueEnd = require("./events/player/finish");

client.player.on("trackStart", (player, track, payload) => {
  playerTrackStart(client, player, track, payload);
});

client.player.on("trackError", (player, track, payload) => {
  playerTrackError(client, player, track, payload);
});

client.player.on("trackStuck", (player, track, payload) => {
  playerTrackError(client, player, track, payload);
});

client.player.on("queueEnd", (player, track, payload) => {
  playerQueueEnd(client, player, track, payload);
});

client.player.on("playerDestroy", (player) => {
  stopControllerAutoUpdate(client, player?.guildId);
});

client.player.on("error", (node, error) => {
  console.error(`[Lavalink:${node?.id || "неизвестно"}]`, error?.message || error);
});

function loadEventHandlers() {
  const eventsDir = path.join(__dirname, "events");
  const files = fs.readdirSync(eventsDir).filter((file) => file.endsWith(".js"));
  for (const file of files) {
    const event = require(path.join(eventsDir, file));
    const eventName = path.basename(file, ".js");
    client.on(eventName, event.bind(null, client));
  }
}

function loadCommands() {
  const commandsDir = path.join(__dirname, config.commandsDir || "./commands");
  const files = fs.readdirSync(commandsDir).filter((file) => file.endsWith(".js"));

  for (const file of files) {
    const command = require(path.join(commandsDir, file));
    if (!command?.name) continue;

    client.commands.push({
      name: command.name,
      description: command.description || "Описание не указано.",
      options: command.options || [],
      dm_permission: false,
    });
    client.commandMap.set(command.name, command);
  }
}

async function initDatabase() {
  const hasPgConfig =
    Boolean(config.postgresqlURL) ||
    Boolean(process.env.POSTGRES_URL) ||
    Boolean(process.env.POSTGRESQL_URL) ||
    Boolean(process.env.DATABASE_URL);

  if (!hasPgConfig) {
    console.warn("Не указан адрес PostgreSQL. Задайте config.postgresqlURL или DATABASE_URL.");
    return;
  }

  try {
    await db.connect();
    console.log("PostgreSQL подключена.");
  } catch (error) {
    console.error("Ошибка подключения PostgreSQL:", error);
  }
}

const express = require("express");
const app = express();
app.get("/", (_request, response) => response.sendStatus(200));
app.listen(process?.env?.PORT || 3000);

loadEventHandlers();
loadCommands();

(async () => {
  await initDatabase();

  if (!config.TOKEN && !process.env.TOKEN) {
    console.error("Отсутствует токен бота в config.TOKEN или process.env.TOKEN.");
    return;
  }

  client.login(config.TOKEN || process.env.TOKEN).catch((error) => {
    console.error("Ошибка входа в Discord:", error);
  });
})();
