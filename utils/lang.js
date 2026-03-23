const db = require("../postgresqlDB");

async function getLangCode(client, guildId) {
  if (!guildId) return client.language || "ru";
  try {
    const data = await db.musicbot.findOne({ guildID: guildId });
    return data?.language || client.language || "ru";
  } catch {
    return client.language || "ru";
  }
}

async function getLang(client, guildId) {
  const code = await getLangCode(client, guildId);
  try {
    return require(`../languages/${code}.js`);
  } catch {
    return require("../languages/ru.js");
  }
}

module.exports = {
  getLangCode,
  getLang,
};
