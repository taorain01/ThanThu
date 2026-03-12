/**
 * ?gonah - Tin nhắn đặc biệt ❤️
 */

const { EmbedBuilder } = require('discord.js');

async function execute(message, args) {

    const embed = new EmbedBuilder()
        .setColor('#FF69B4')
        .setTitle('💕')
        .setDescription('# Rain yêu em ❤️')
        .setTimestamp();

    // Xóa tin nhắn gốc
    try {
        await message.delete();
    } catch (e) { }

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };


