const { ActivityType } = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");

module.exports = async (client) => {
  const token = client.config.TOKEN || process.env.TOKEN;
  if (!token) return;

  try {
    await client.player.init({
      id: client.user.id,
      username: client.user.username,
    });
  } catch (error) {
    try {
      await client.player.init(client.user.id);
    } catch (fallbackError) {
      console.error("Ошибка инициализации Lavalink:", fallbackError || error);
    }
  }

  try {
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: client.commands,
    });
    console.log("Слэш-команды зарегистрированы.");
  } catch (error) {
    console.error("Ошибка регистрации слэш-команд:", error);
  }

  console.log(`${client.user.username} подключен.`);

  setInterval(() => {
    client.user.setPresence({
      activities: [{ name: client.config.status || "/help | /play", type: ActivityType.Listening }],
      status: "idle",
    });
  }, 10_000);

  if (client.config.voteManager?.status && client.config.voteManager?.api_key) {
    try {
      const { AutoPoster } = require("topgg-autoposter");
      AutoPoster(client.config.voteManager.api_key, client);
    } catch (error) {
      console.error("Ошибка запуска Top.gg автопостера:", error);
    }
  }
};
