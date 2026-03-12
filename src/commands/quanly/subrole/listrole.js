/**
 * ?dsrole / ?listrole - List all sub-roles
 */

const { EmbedBuilder } = require('discord.js');
const { getRoleMappings } = require('./addrole');

async function execute(message, args) {
    const mappings = getRoleMappings();
    const codes = Object.keys(mappings);

    if (codes.length === 0) {
        return message.channel.send('❌ Chưa có role phụ nào!\nDùng `?addrole <mã> <tên>` + icon để thêm.');
    }

    const lines = codes.map(code => {
        const entry = mappings[code];
        const name = typeof entry === 'string' ? entry : entry.name;
        const emojiId = typeof entry === 'object' ? entry.emojiId : null;

        // Show actual emoji if available, otherwise show indicator
        let iconDisplay;
        if (emojiId) {
            iconDisplay = `<:sr_${code}:${emojiId}>`;
        } else if (typeof entry === 'object' && entry.icon) {
            iconDisplay = '🖼️';
        } else {
            iconDisplay = '⬜';
        }

        return `${iconDisplay} \`${code}\` → **${name}**`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📋 DANH SÁCH ROLE PHỤ')
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${codes.length} role` })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };

