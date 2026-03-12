/**
 * Script xóa tất cả slash commands (global + guild) để fix duplicate
 * Chạy 1 lần: node clean-commands.js
 */

require('dotenv/config');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const clientId = process.env.clientId;
const guildId = process.env.guildId;
const token = process.env.token;

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('🧹 Đang xóa tất cả slash commands...');

        // Xóa Guild commands
        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
            console.log(`✅ Đã xóa tất cả Guild commands (${guildId})`);
        }

        // Xóa Global commands
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
        console.log('✅ Đã xóa tất cả Global commands');

        console.log('\n🔄 Giờ restart bot để đăng ký lại commands!');
    } catch (error) {
        console.error('❌ Lỗi:', error);
    }
})();
