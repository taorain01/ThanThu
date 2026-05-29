const ALLOWED_GUILD_ID = '450633680000385036';

function isAllowedGuildId(guildId) {
  return guildId === ALLOWED_GUILD_ID;
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
  isAllowedGuildId,
  getEventGuildId,
  leaveUnauthorizedGuilds
};
