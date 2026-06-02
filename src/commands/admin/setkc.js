/**
 * ?setkc @user - Grant/sync "Kỳ Cựu" role (Owner only)
 * Only user ID 395151484179841024 can use this
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const memberRosterSync = require('../../utils/memberRosterSync');
const { ensureTrackedMemberFromDiscord } = require('../../utils/discordPositionSync');

const OWNER_ID = '395151484179841024';

function findRole(guild, roleName) {
    const normalize = (value = '') => String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const target = normalize(roleName);
    return guild.roles.cache.find((role) => normalize(role.name) === target) || null;
}

async function execute(message) {
    if (message.author.id !== OWNER_ID) {
        return message.channel.send('❌ Chỉ **Chủ sở hữu** mới có thể sử dụng lệnh này!');
    }

    const mentionedUser = message.mentions.members.first();
    if (!mentionedUser) {
        return message.channel.send('❌ Cách dùng: `?setkc @user` - Cấp hoặc sync role Kỳ Cựu');
    }

    const kcRole = findRole(message.guild, 'Kỳ Cựu');
    if (!kcRole) {
        return message.channel.send('❌ Role **Kỳ Cựu** không tồn tại trên server!');
    }

    try {
        const alreadyHasKc = mentionedUser.roles.cache.has(kcRole.id);
        if (!alreadyHasKc) {
            await mentionedUser.roles.add(kcRole);
        }

        let userData = db.getUserByDiscordId(mentionedUser.id);
        if (!userData || userData.left_at) {
            userData = await ensureTrackedMemberFromDiscord(mentionedUser, 'kc', message.guild.id);
        } else {
            db.updateUserPosition(mentionedUser.id, 'kc');
            userData = db.getUserByDiscordId(mentionedUser.id);
            try {
                await memberRosterSync.syncUserRecord(userData, message.guild.id, message.guild);
            } catch (syncError) {
                console.error('[setkc] Sync existing KC user failed:', syncError.message);
            }
        }

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(alreadyHasKc ? '🔄 Đã sync Kỳ Cựu!' : '🏆 Đã cấp Kỳ Cựu!')
            .setDescription(
                `${alreadyHasKc ? '✅ Đã đồng bộ user Kỳ Cựu cho' : '✅ Đã cấp role **Kỳ Cựu** cho'} ${mentionedUser}\n\n` +
                `${mentionedUser.displayName} có thể dùng \`?setrole <mã>\` để chọn role phụ.`
            )
            .setFooter({ text: `Thực hiện bởi ${message.author.username}` })
            .setTimestamp();

        return message.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('[setkc] Error:', error.message);
        return message.channel.send(`❌ Lỗi: ${error.message}`);
    }
}

module.exports = { execute };
