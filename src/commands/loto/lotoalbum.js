/**
 * ?lotoalbum / ?lta - Xem album lá Loto
 * 
 * ?lta           → Gửi embed gallery hiện tất cả tên lá có sẵn
 * ?lta <tên>     → Gửi ảnh lá đó dạng attachment (full size)
 */

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'loto');

// Danh sách lá loto (tên hiển thị → tên file + aliases)
const CARDS = [
    { name: 'Cam 1', file: 'cam_1.jpg', aliases: ['cam 1', 'cam1', 'c1'] },
    { name: 'Cam 2', file: 'cam_2.jpg', aliases: ['cam 2', 'cam2', 'c2'] },
    { name: 'Đỏ 1', file: 'do_1.jpg', aliases: ['do 1', 'do1', 'd1'] },
    { name: 'Đỏ 2', file: 'do_2.jpg', aliases: ['do 2', 'do2', 'd2'] },
    { name: 'Hồng 1', file: 'hong_1.jpg', aliases: ['hong 1', 'hong1', 'h1'] },
    { name: 'Hồng 2', file: 'hong_2.jpg', aliases: ['hong 2', 'hong2', 'h2'] },
    { name: 'Nước biển 1', file: 'nuoc_bien_1.jpg', aliases: ['nuoc bien 1', 'nuocbien 1', 'nuocbien1', 'nb 1', 'nb1', 'nb 1'] },
    { name: 'Nước biển 2', file: 'nuoc_bien_2.jpg', aliases: ['nuoc bien 2', 'nuocbien 2', 'nuocbien2', 'nb 2', 'nb2', 'nb 2'] },
    { name: 'Tím 1', file: 'tim_1.jpg', aliases: ['tim 1', 'tim1', 't1'] },
    { name: 'Tím 2', file: 'tim_2.jpg', aliases: ['tim 2', 'tim2', 't2'] },
    { name: 'Vàng 1', file: 'vang_1.jpg', aliases: ['vang 1', 'vang1', 'v1'] },
    { name: 'Vàng 2', file: 'vang_2.jpg', aliases: ['vang 2', 'vang2', 'v2'] },
    { name: 'Xanh chuối 1', file: 'xanh_chuoi_1.jpg', aliases: ['xanh chuoi 1', 'xanhchuoi 1', 'xanhchuoi1', 'xc 1', 'xc1', 'xc 1'] },
    { name: 'Xanh chuối 2', file: 'xanh_chuoi_2.jpg', aliases: ['xanh chuoi 2', 'xanhchuoi 2', 'xanhchuoi2', 'xc 2', 'xc2', 'xc 2'] },
    { name: 'Xanh lá 1', file: 'xanh_la_1.jpg', aliases: ['xanh la 1', 'xanhla 1', 'xanhla1', 'xl 1', 'xl1', 'xl 1'] },
    { name: 'Xanh lá 2', file: 'xanh_la_2.jpg', aliases: ['xanh la 2', 'xanhla 2', 'xanhla2', 'xl 2', 'xl2', 'xl 2'] },
];

/**
 * Normalize tên input để match (bỏ dấu, lowercase, bỏ khoảng trắng dư)
 */
function normalize(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Bỏ dấu
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .replace(/\s+/g, ' ') // Gom khoảng trắng
        .trim();
}

async function execute(message, args) {
    // Không có args → hiện gallery
    if (args.length === 0) {
        const cardsByColor = {};
        CARDS.forEach(c => {
            const color = c.name.replace(/ \d+$/, '');
            if (!cardsByColor[color]) cardsByColor[color] = [];
            cardsByColor[color].push(c.name);
        });

        const lines = Object.entries(cardsByColor).map(([color, names]) => {
            return `🎴 **${color}**: ${names.join(', ')}`;
        });

        const embed = new EmbedBuilder()
            .setColor('#FF6B35')
            .setTitle('🎴 Album Lá Loto')
            .setDescription([
                'Danh sách tất cả lá Loto có sẵn:',
                '',
                ...lines,
                '',
                '💡 Gõ `?lta <tên lá>` để xem ảnh full',
                '📝 Ví dụ: `?lta cam 1`, `?lta c1`, `?lta nb2`'
            ].join('\n'))
            .setFooter({ text: `${CARDS.length} lá • ?lta <tên> để xem chi tiết` })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // Có args → tìm và gửi ảnh
    const query = args.join(' ');
    const normalizedQuery = normalize(query);
    const queryNoSpace = normalizedQuery.replace(/\s/g, '');

    // Tìm kiếm thông qua name hoặc aliases
    const card = CARDS.find(c => {
        // Check tên chính
        if (normalize(c.name) === normalizedQuery) return true;
        // Check các aliases
        if (c.aliases.some(a => normalize(a) === normalizedQuery)) return true;
        // Check không dấu không cách (ví dụ cam1, c1, nb1, xc2)
        if (c.aliases.some(a => normalize(a).replace(/\s/g, '') === queryNoSpace)) return true;
        return false;
    });

    if (!card) {
        const suggestions = CARDS.filter(c =>
            normalize(c.name).includes(normalizedQuery) ||
            c.aliases.some(a => normalize(a).includes(normalizedQuery))
        ).slice(0, 5);

        let reply = `❌ Không tìm thấy lá **"${query}"**!`;
        if (suggestions.length > 0) {
            reply += `\n💡 Gợi ý: ${suggestions.map(s => `\`${s.name}\``).join(', ')}`;
        }
        return message.reply(reply);
    }

    const filePath = path.join(ASSETS_DIR, card.file);

    if (!fs.existsSync(filePath)) {
        return message.reply(`❌ Không tìm thấy file ảnh cho lá **${card.name}**!`);
    }

    // Gửi ảnh dạng attachment (full size, không embed)
    const attachment = new AttachmentBuilder(filePath, { name: card.file });
    return message.channel.send({
        content: `🎴 **${card.name}**`,
        files: [attachment]
    });
}

module.exports = { execute };
