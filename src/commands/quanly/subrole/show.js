/**
 * ?show - Đổi display icon hiển thị
 * Usage: ?show <mã>
 * 
 * Cho phép user đổi icon hiển thị cạnh tên sang role khác mà họ có
 */

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../../database/db');
const { getRoleMappings, getSubRoleName, DISPLAY_ROLE_NAME } = require('./addrole');
const { removeAllDisplayRoles, assignDisplayRole } = require('./setrole');

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    try {
        const code = args[0]?.toLowerCase();

        if (!code) {
            // Hiển thị SELECT MENU với các role user có
            const mappings = getRoleMappings();
            const userRoles = message.member.roles.cache;

            const availableRoles = Object.entries(mappings).filter(([c, entry]) => {
                const roleName = typeof entry === 'string' ? entry : entry.name;
                return userRoles.some(r => r.name === roleName);
            });

            if (availableRoles.length === 0) {
                return message.channel.send('❌ Bạn chưa có role phụ nào! Liên hệ Bang Chủ để được cấp role.');
            }

            // Lấy current display
            const currentDisplay = db.getUserDisplay(message.author.id);

            // Tạo select menu options
            const options = availableRoles.map(([c, e]) => {
                const name = typeof e === 'string' ? e : e.name;
                const emojiId = typeof e === 'object' ? e.emojiId : null;
                const isCurrent = currentDisplay === c;

                const option = {
                    label: name,
                    description: isCurrent ? '⭐ Đang hiển thị' : `Mã: ${c}`,
                    value: c,
                    default: isCurrent
                };

                // Add emoji if available
                if (emojiId) {
                    option.emoji = { id: emojiId };
                }

                return option;
            });

            // Thêm option ẩn role
            options.push({
                label: 'Ẩn role',
                description: 'Ẩn role hiển thị trên profile',
                value: 'hide_icon',
                emoji: '🔕'
            });

            const selectMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`show_role_select_${message.author.id}`)
                        .setPlaceholder('Chọn icon để hiển thị...')
                        .addOptions(options)
                );

            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('🎨 Chọn Icon Hiển Thị')
                .setDescription('Chọn từ menu bên dưới để đổi icon cạnh tên của bạn.\n\n⭐ = đang hiển thị')
                .setFooter({ text: message.author.username })
                .setTimestamp();

            return message.channel.send({ embeds: [embed], components: [selectMenu] });
        }

        // Check code tồn tại
        const mappingEntry = getRoleMappings()[code];
        if (!mappingEntry) {
            return message.channel.send(`❌ Mã \`${code}\` không tồn tại!`);
        }

        const roleName = typeof mappingEntry === 'string' ? mappingEntry : mappingEntry.name;

        // Check user có role gốc không
        const sourceRole = message.guild.roles.cache.find(r => r.name === roleName);
        if (!sourceRole || !message.member.roles.cache.has(sourceRole.id)) {
            return message.channel.send(`❌ Bạn chưa có role **${roleName}**! Không thể hiển thị icon này.`);
        }

        // Auto sync vào DB nếu chưa có
        const userData = db.getUserByDiscordId(message.author.id);
        if (userData) {
            // Check xem user đã có sub_role trong DB chưa
            const currentSubRole = db.getUserSubRole(message.author.id);
            if (!currentSubRole) {
                db.setUserSubRole(message.author.id, code);
            }
        }

        // Gán display role
        const displayAssigned = await assignDisplayRole(message.member, message.guild.id, code);

        if (displayAssigned) {
            // Invalidate member card cache
            try {
                const cardCache = require('../../utils/memberCardCache');
                cardCache.invalidateUser(message.author.id);
            } catch (e) { }

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Đã đổi icon hiển thị!')
                .setDescription(
                    `**Icon:** ${roleName}\n` +
                    `**Mã:** \`${code}\`\n\n` +
                    `Icon sẽ hiển thị cạnh tên của bạn.\n` +
                    `Dùng \`?hideicon\` để ẩn.`
                )
                .setFooter({ text: message.author.username })
                .setTimestamp();

            return message.channel.send({ embeds: [embed] });
        } else {
            // Display role không tồn tại - có thể bị xóa
            return message.channel.send(`⚠️ Không tìm thấy display role cho \`${code}\`. Liên hệ Bang Chủ để tạo lại.`);
        }

    } catch (error) {
        console.error('[show] Error:', error);
        return message.channel.send('❌ Đã xảy ra lỗi!');
    }
}

module.exports = { execute };
