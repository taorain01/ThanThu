const { Events } = require('discord.js');
const { isAllowedGuildId } = require('../../config/guildAccess');

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    if (isAllowedGuildId(guild.id)) return;

    try {
      if (guild.commands?.set) {
        await guild.commands.set([]);
      }
    } catch (error) {
      console.error(`[GuildAccess] Khong xoa duoc slash commands o guild moi ${guild.id}:`, error.message);
    }

    try {
      await guild.leave();
      console.log(`[GuildAccess] Bot da roi guild moi khong duoc phep: ${guild.name} (${guild.id})`);
    } catch (error) {
      console.error(`[GuildAccess] Khong roi duoc guild moi ${guild.id}:`, error.message);
    }
  }
};
