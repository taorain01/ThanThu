/**
 * ?boostroom / ?br / ?myroom
 * Tạo voice channel riêng cho Server Booster
 */

const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../database/db');

const BOOSTER_ROLE_ID = '740457614470545408';

async function execute(message, args) {
    // Kiểm tra role Server Booster
    const isBooster = message.member.roles.cache.has(BOOSTER_ROLE_ID);
    if (!isBooster) {
        return message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#EF4444')
                .setDescription('❌ Chỉ **Server Booster** mới được sử dụng lệnh này!')
            ]
        });
    }

    const guildId = message.guild.id;
    const userId = message.author.id;

    // Kiểm tra đã có room chưa
    const existingRoom = db.getBoosterRoom(userId);
    if (existingRoom) {
        const channel = message.guild.channels.cache.get(existingRoom.channel_id);
        if (channel) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#3B82F6')
                    .setTitle('🎙️ Bạn đã có Boost Room!')
                    .setDescription(`Room của bạn: <#${existingRoom.channel_id}>\n\nDùng \`?delboostroom\` để xoá room cũ.`)
                ]
            });
        }
        // Channel không còn tồn tại → xoá data cũ
        db.deleteBoosterRoom(userId);
    }

    // Kiểm tra category đã được set chưa
    const categoryId = db.getBoostCategoryId(guildId);
    if (!categoryId) {
        return message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#EF4444')
                .setDescription('❌ Admin chưa set category cho Boost Room!\nDùng `?setboostcategory <ID>` để set.')
            ]
        });
    }

    const category = message.guild.channels.cache.get(categoryId);
    if (!category) {
        return message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#EF4444')
                .setDescription('❌ Category không tồn tại! Hãy yêu cầu Admin set lại.')
            ]
        });
    }

    // Tên room
    const roomName = args.length > 0
        ? args.join(' ').substring(0, 30)
        : `[VIP] ${message.member.displayName}`;

    try {
        // Tạo voice channel ẩn
        const voiceChannel = await message.guild.channels.create({
            name: roomName,
            type: ChannelType.GuildVoice,
            parent: categoryId,
            permissionOverwrites: [
                {
                    id: message.guild.id, // @everyone
                    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                },
                {
                    id: userId, // Booster owner
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.MuteMembers,
                        PermissionFlagsBits.MoveMembers
                    ]
                }
            ]
        });

        // Lưu vào database
        db.createBoosterRoom(userId, voiceChannel.id, guildId, roomName);

        const embed = new EmbedBuilder()
            .setColor('#22C55E')
            .setTitle('🎙️ Boost Room đã được tạo!')
            .setDescription(
                `**Room:** <#${voiceChannel.id}>\n` +
                `**Chế độ:** 👻 Ẩn (chỉ bạn thấy)\n\n` +
                `📌 Vào room để mở **Bảng Điều Khiển** quản lý room.\n` +
                `🗑️ Dùng \`?delboostroom\` để xoá room.`
            )
            .setFooter({ text: 'Server Booster Exclusive' })
            .setTimestamp();

        return message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('[boostroom] Error creating voice channel:', error);
        return message.reply('❌ Không thể tạo voice channel! Kiểm tra quyền của bot.');
    }
}

module.exports = { execute };
