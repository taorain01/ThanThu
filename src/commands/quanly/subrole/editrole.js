/**
 * ?editrole - Edit sub-role name or icon
 * Usage:
 *   ?editrole <mã> ten <tên mới>
 *   ?editrole <mã> icon + attach image
 */

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getRoleMappings, saveRoleMappings, resizeToSquare, ROLE_ICONS_DIR, EMOJI_SERVER_ID } = require('./addrole');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function hasRole(member, roleName) {
    return member.roles.cache.some(role => role.name === roleName);
}

function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(filepath);
        protocol.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(true); });
            } else {
                file.close();
                fs.unlink(filepath, () => { });
                reject(new Error(`Failed: ${response.statusCode}`));
            }
        }).on('error', (err) => {
            file.close();
            fs.unlink(filepath, () => { });
            reject(err);
        });
    });
}

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    const isOwner = message.author.id === OWNER_ID;
    if (!isOwner && !hasRole(message.member, 'Bang Chủ')) {
        return message.channel.send('❌ Chỉ **Bang Chủ** mới được sử dụng lệnh này!');
    }

    if (args.length < 2) {
        return message.channel.send(
            '❌ Cách dùng:\n' +
            '• `?editrole <mã> ten <tên mới>`\n' +
            '• `?editrole <mã> icon` + đính kèm ảnh'
        );
    }

    const code = args[0].toLowerCase();
    const mappings = getRoleMappings();

    if (!mappings[code]) {
        return message.channel.send(`❌ Không tìm thấy mã \`${code}\`!`);
    }

    const entry = mappings[code];
    const currentName = typeof entry === 'string' ? entry : entry.name;
    const currentIcon = typeof entry === 'object' ? entry.icon : null;
    const currentEmojiId = typeof entry === 'object' ? entry.emojiId : null;
    const currentForAll = typeof entry === 'object' ? entry.forAll : false;

    let newName = currentName;
    let newIcon = currentIcon;
    let newEmojiId = currentEmojiId;
    let changedName = false;
    let changedIcon = false;

    const argsJoined = args.slice(1).join(' ');

    // Check "ten" keyword
    const tenMatch = argsJoined.match(/ten\s+(.+?)(?:\s+icon|$)/i);
    if (tenMatch) {
        newName = tenMatch[1].trim();
        changedName = true;
    }

    // Check "icon" keyword
    if (argsJoined.toLowerCase().includes('icon')) {
        const attachment = message.attachments.first();
        if (!attachment) {
            return message.channel.send('❌ Thiếu ảnh đính kèm!');
        }

        const contentType = attachment.contentType || '';
        if (!contentType.startsWith('image/')) {
            return message.channel.send('❌ File phải là ảnh!');
        }

        const tempPath = path.join(ROLE_ICONS_DIR, `${code}_temp${path.extname(attachment.name)}`);
        newIcon = path.join(ROLE_ICONS_DIR, `SubRole_${newName.replace(/\s+/g, '')}.png`);

        try {
            await downloadImage(attachment.url, tempPath);
            await resizeToSquare(tempPath, newIcon, 256);
            fs.unlinkSync(tempPath);
            changedIcon = true;
        } catch (e) {
            try { fs.unlinkSync(tempPath); } catch (_) { }
            return message.channel.send('❌ Không thể xử lý icon!');
        }

        // Upload emoji to emoji server
        try {
            const emojiServer = message.client.guilds.cache.get(EMOJI_SERVER_ID);
            if (emojiServer) {
                const iconBuffer = fs.readFileSync(newIcon);
                const emojiName = `sr_${code}`.substring(0, 32).replace(/[^a-zA-Z0-9_]/g, '');

                // Check if emoji already exists, delete it first
                const existingEmoji = emojiServer.emojis.cache.find(e => e.name === emojiName);
                if (existingEmoji) {
                    await existingEmoji.delete('Updating role icon');
                }

                const newEmoji = await emojiServer.emojis.create({
                    attachment: iconBuffer,
                    name: emojiName,
                    reason: `Role icon cho ${newName}`
                });
                newEmojiId = newEmoji.id;
                console.log(`[editrole] Uploaded emoji ${emojiName} (${newEmojiId}) to emoji server`);
            } else {
                console.warn('[editrole] Emoji server not found!');
            }
        } catch (e) {
            console.error('[editrole] Error uploading emoji:', e.message);
        }
    }

    if (!changedName && !changedIcon) {
        return message.channel.send('❌ Không nhận được thay đổi!');
    }

    // Save with preserved fields
    mappings[code] = {
        name: newName,
        icon: newIcon,
        emojiId: newEmojiId,
        forAll: currentForAll
    };
    saveRoleMappings(mappings);

    // Update Discord role name
    if (changedName && currentName !== newName) {
        const oldRole = message.guild.roles.cache.find(r => r.name === currentName);
        if (oldRole) {
            try { await oldRole.setName(newName); } catch (e) { }
        }
    }

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✏️ Đã cập nhật Role!')
        .setDescription(
            `**Mã:** \`${code}\`\n` +
            (changedName ? `**Tên:** ${currentName} → **${newName}**\n` : `**Tên:** ${newName}\n`) +
            (changedIcon ? `**Icon:** ✅ Đã cập nhật\n` : '') +
            (changedIcon && newEmojiId ? `**Emoji:** ✅ Đã upload` : '')
        )
        .setFooter({ text: `Bởi ${message.author.username}` })
        .setTimestamp();

    if (newIcon && fs.existsSync(newIcon)) {
        const iconAttachment = new AttachmentBuilder(newIcon, { name: 'icon.png' });
        embed.setThumbnail('attachment://icon.png');
        return message.channel.send({ embeds: [embed], files: [iconAttachment] });
    }

    await message.channel.send({ embeds: [embed] });
}

module.exports = { execute };

