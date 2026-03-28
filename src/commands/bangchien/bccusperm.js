/**
 * ?bccusperm - Quản lý danh sách người được phép dùng ?bccus
 * 
 * Cách dùng:
 *   ?bccusperm add @user    → Thêm người vào whitelist
 *   ?bccusperm remove @user → Xóa người khỏi whitelist
 *   ?bccusperm list         → Xem danh sách whitelist
 *   ?bccusperm              → Xem hướng dẫn
 * 
 * Aliases: ?bccusp
 * Quyền: Quản Lý hoặc Owner
 */

const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'bccusperm',
    aliases: ['bccusp'],
    description: 'Quản lý người được phép dùng ?bccus. Dùng: ?bccusperm add/remove/list',

    async execute(message, args, client) {
        const db = require('../../database/db');

        // Kiểm tra quyền: chỉ Quản Lý hoặc Owner
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);
        const OWNER_ID = '395151484179841024';
        const isOwner = message.author.id === OWNER_ID;

        if (!isQuanLy && !isOwner) {
            return message.reply({
                content: '❌ Chỉ **Quản Lý** mới được quản lý quyền BC Tự Do!',
                allowedMentions: { repliedUser: false }
            });
        }

        const subCommand = args[0]?.toLowerCase();

        // ═══════════════════════════════════════════════════════════════════
        // Không có sub-command → Hiện hướng dẫn
        // ═══════════════════════════════════════════════════════════════════
        if (!subCommand || !['add', 'remove', 'xoa', 'list', 'ds'].includes(subCommand)) {
            const whitelist = this.getWhitelist(db);
            const embed = new EmbedBuilder()
                .setColor(0xFF6B35)
                .setTitle('🎯 QUẢN LÝ QUYỀN BC TỰ DO')
                .setDescription(
                    '**Cách dùng:**\n' +
                    '`?bccusperm add @user` — Thêm người\n' +
                    '`?bccusperm remove @user` — Xóa người\n' +
                    '`?bccusperm list` — Xem danh sách\n\n' +
                    `📋 Hiện có **${whitelist.length}** người trong whitelist.`
                )
                .setFooter({ text: 'Người trong whitelist được phép mở ?bccus và quản lý qua ?lbcc' });

            return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        }

        // ═══════════════════════════════════════════════════════════════════
        // ADD: Thêm người vào whitelist
        // ═══════════════════════════════════════════════════════════════════
        if (subCommand === 'add') {
            const mention = message.mentions.users.first();
            if (!mention) {
                return message.reply('❌ Vui lòng mention người cần thêm! Ví dụ: `?bccusperm add @user`');
            }

            const whitelist = this.getWhitelist(db);

            // Kiểm tra đã có chưa
            if (whitelist.some(entry => entry.id === mention.id)) {
                return message.reply({
                    content: `⚠️ **${mention.username}** đã có trong whitelist rồi!`,
                    allowedMentions: { repliedUser: false }
                });
            }

            // Thêm vào whitelist
            whitelist.push({
                id: mention.id,
                username: mention.username,
                addedBy: message.author.id,
                addedAt: new Date().toISOString()
            });

            this.saveWhitelist(db, whitelist);

            const embed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('✅ ĐÃ THÊM VÀO WHITELIST')
                .setDescription(
                    `**${mention.username}** (<@${mention.id}>) giờ được phép:\n` +
                    '• Mở phiên BC Tự Do (`?bccus`)\n' +
                    '• Quản lý session BC Tự Do (`?lbcc`)'
                )
                .setFooter({ text: `Thêm bởi ${message.author.username}` })
                .setTimestamp();

            return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        }

        // ═══════════════════════════════════════════════════════════════════
        // REMOVE: Xóa người khỏi whitelist
        // ═══════════════════════════════════════════════════════════════════
        if (subCommand === 'remove' || subCommand === 'xoa') {
            const mention = message.mentions.users.first();
            if (!mention) {
                return message.reply('❌ Vui lòng mention người cần xóa! Ví dụ: `?bccusperm remove @user`');
            }

            const whitelist = this.getWhitelist(db);
            const index = whitelist.findIndex(entry => entry.id === mention.id);

            if (index === -1) {
                return message.reply({
                    content: `⚠️ **${mention.username}** không có trong whitelist!`,
                    allowedMentions: { repliedUser: false }
                });
            }

            whitelist.splice(index, 1);
            this.saveWhitelist(db, whitelist);

            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('❌ ĐÃ XÓA KHỎI WHITELIST')
                .setDescription(`**${mention.username}** (<@${mention.id}>) không còn quyền dùng BC Tự Do.`)
                .setFooter({ text: `Xóa bởi ${message.author.username}` })
                .setTimestamp();

            return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        }

        // ═══════════════════════════════════════════════════════════════════
        // LIST: Xem danh sách whitelist
        // ═══════════════════════════════════════════════════════════════════
        if (subCommand === 'list' || subCommand === 'ds') {
            const whitelist = this.getWhitelist(db);

            if (whitelist.length === 0) {
                return message.reply('📭 Chưa có ai trong whitelist BC Tự Do!');
            }

            const lines = whitelist.map((entry, i) => {
                return `${i + 1}. <@${entry.id}> (${entry.username})`;
            });

            const embed = new EmbedBuilder()
                .setColor(0xFF6B35)
                .setTitle('🎯 WHITELIST BC TỰ DO')
                .setDescription(lines.join('\n'))
                .setFooter({ text: `${whitelist.length} người • Dùng ?bccusperm add/remove để chỉnh sửa` })
                .setTimestamp();

            return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        }
    },

    // ═══════════════════════════════════════════════════════════════════
    // Helper: Đọc/Ghi whitelist từ config table
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Lấy whitelist từ DB
     * @param {Object} db - Database module
     * @returns {Array} Mảng { id, username, addedBy, addedAt }
     */
    getWhitelist(db) {
        const raw = db.getConfig('bccus_whitelist');
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch (e) {
            return [];
        }
    },

    /**
     * Lưu whitelist vào DB
     * @param {Object} db - Database module
     * @param {Array} whitelist - Mảng whitelist
     */
    saveWhitelist(db, whitelist) {
        db.setConfig('bccus_whitelist', JSON.stringify(whitelist));
    },

    /**
     * Kiểm tra user có trong whitelist không
     * @param {Object} db - Database module
     * @param {string} userId - Discord user ID
     * @returns {boolean}
     */
    isWhitelisted(db, userId) {
        const whitelist = this.getWhitelist(db);
        return whitelist.some(entry => entry.id === userId);
    }
};
