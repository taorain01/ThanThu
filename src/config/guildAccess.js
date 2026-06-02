const ALLOWED_GUILD_IDS = [
  '450633680000385036',
  '1239836342456942643'
];
const ALLOWED_GUILD_ID = ALLOWED_GUILD_IDS[0];
const ALLOWED_GUILD_ID_SET = new Set(ALLOWED_GUILD_IDS);

function isAllowedGuildId(guildId) {
  return ALLOWED_GUILD_ID_SET.has(String(guildId || ''));
}

function getObjectGuildId(value) {
  if (!value || typeof value !== 'object') return null;

  return value.guildId
    || value.guild?.id
    || value.message?.guildId
    || value.message?.guild?.id
    || value.channel?.guildId
    || value.channel?.guild?.id
    || value.member?.guild?.id
    || null;
}

function getEventGuildId(args = []) {
  for (const arg of args) {
    const guildId = getObjectGuildId(arg);
    if (guildId) return guildId;
  }

  return null;
}

async function leaveUnauthorizedGuilds(client) {
  const unauthorizedGuilds = client.guilds.cache.filter((guild) => !isAllowedGuildId(guild.id));

  for (const [, guild] of unauthorizedGuilds) {
    try {
      if (guild.commands?.set) {
        await guild.commands.set([]);
      }
    } catch (error) {
      console.error(`[GuildAccess] Khong xoa duoc slash commands o guild ${guild.id}:`, error.message);
    }

    try {
      await guild.leave();
      console.log(`[GuildAccess] Bot da roi guild khong duoc phep: ${guild.name} (${guild.id})`);
    } catch (error) {
      console.error(`[GuildAccess] Khong roi duoc guild ${guild.id}:`, error.message);
    }
  }
}

module.exports = {
  ALLOWED_GUILD_ID,
  ALLOWED_GUILD_IDS,
  isAllowedGuildId,
  getEventGuildId,
  leaveUnauthorizedGuilds
};
