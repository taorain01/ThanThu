/**
 * ?addrole - Add sub-role with icon (Bang Chủ only)
 * Usage: 
 *   ?addrole <code> <name> + attach icon       → Guild members only
 *   ?addrole all <code> <name> + attach icon   → All server members
 */

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../../../database/db');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Config
const ROLE_MAPPINGS_KEY = 'sub_role_mappings';
const ROLE_ICONS_DIR = path.join(__dirname, '../../../assets/images/role_icons');
const DISPLAY_ROLE_NAME = '✦'; // Tên role hiển thị (star symbol)
const OLD_DISPLAY_ROLE_NAMES = [' ', '.', '']; // Các tên cũ để migration
const EMOJI_SERVER_ID = '1239836342456942643'; // Server để upload emoji

if (!fs.existsSync(ROLE_ICONS_DIR)) {
    fs.mkdirSync(ROLE_ICONS_DIR, { recursive: true });
}

// === Export functions for other modules ===

function getRoleMappings() {
    const data = db.getConfig(ROLE_MAPPINGS_KEY);
    if (data) {
        try { return JSON.parse(data); } catch (e) { return {}; }
    }
    return {};
}

function saveRoleMappings(mappings) {
    db.setConfig(ROLE_MAPPINGS_KEY, JSON.stringify(mappings));
}

function getSubRoleName(code) {
    const mappings = getRoleMappings();
    const entry = mappings[code];
    if (!entry) return null;
    return typeof entry === 'string' ? entry : entry.name;
}

function getSubRoleIcon(code) {
    const mappings = getRoleMappings();
    const entry = mappings[code];
    if (!entry || typeof entry === 'string') return null;
    return entry.icon;
}

function getSubRoleEmojiId(code) {
    const mappings = getRoleMappings();
    const entry = mappings[code];
    if (!entry || typeof entry === 'string') return null;
    return entry.emojiId || null;
}

function isForAll(code) {
    const mappings = getRoleMappings();
    const entry = mappings[code];
    if (!entry || typeof entry === 'string') return false;
    return entry.forAll === true;
}

// Download image
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

// Resize to 256x256
async function resizeToSquare(inputPath, outputPath, size = 256) {
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const image = await loadImage(inputPath);
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const minSide = Math.min(image.width, image.height);
    const sx = (image.width - minSide) / 2;
    const sy = (image.height - minSide) / 2;
    ctx.drawImage(image, sx, sy, minSide, minSide, 0, 0, size, size);

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
}

function hasRole(member, roleName) {
    return member.roles.cache.some(role => role.name === roleName);
}

const OWNER_ID = '395151484179841024';

async function execute(message, args) {
    const isOwner = message.author.id === OWNER_ID;
    if (!isOwner && !hasRole(message.member, 'Bang Chủ')) {
        return message.channel.send('❌ Chỉ **Bang Chủ** mới được sử dụng lệnh này!');
    }

    // Show list if no args
    if (args.length === 0) {
        const mappings = getRoleMappings();
        const codes = Object.keys(mappings);

        if (codes.length === 0) {
            return message.channel.send('📋 Chưa có role phụ nào. Dùng `?addrole <mã> <tên>` + icon để thêm.');
        }

        const lines = codes.map(code => {
            const entry = mappings[code];
            const name = typeof entry === 'string' ? entry : entry.name;
            const hasIcon = entry.icon ? '🖼️' : '⬜';
            const forAllBadge = entry.forAll ? '🌐' : '👥';
            return `${hasIcon}${forAllBadge} \`${code}\` → **${name}**`;
        });

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('📋 DANH SÁCH ROLE PHỤ')
            .setDescription(lines.join('\n'))
            .setFooter({ text: `${codes.length} role • 🖼️ = có icon • 🌐 = all server • 👥 = guild only` });

        return message.channel.send({ embeds: [embed] });
    }

    // === Parse flag "all" ===
    let forAll = false;
    let argIndex = 0;

    if (args[0].toLowerCase() === 'all') {
        forAll = true;
        argIndex = 1;
    }

    if (args.length < argIndex + 2) {
        return message.channel.send('❌ Cách dùng:\n• `?addrole <mã> <tên>` + đính kèm icon\n• `?addrole all <mã> <tên>` + icon (cho tất cả server)');
    }

    const code = args[argIndex].toLowerCase();
    const roleName = args.slice(argIndex + 1).join(' ');
    const mappings = getRoleMappings();

    // Reserved codes
    if (['bc', 'pbc', 'mem', 'kc', 'all'].includes(code)) {
        return message.channel.send(`❌ Mã \`${code}\` là mã hệ thống!`);
    }

    // Handle icon attachment
    const attachment = message.attachments.first();
    let iconPath = null;
    let emojiId = null;

    if (attachment) {
        const contentType = attachment.contentType || '';
        if (!contentType.startsWith('image/')) {
            return message.channel.send('❌ File phải là ảnh!');
        }

        const tempPath = path.join(ROLE_ICONS_DIR, `${code}_temp${path.extname(attachment.name)}`);
        iconPath = path.join(ROLE_ICONS_DIR, `SubRole_${roleName.replace(/\s+/g, '')}.png`);

        try {
            await downloadImage(attachment.url, tempPath);
            await resizeToSquare(tempPath, iconPath, 256);
            fs.unlinkSync(tempPath);
        } catch (e) {
            try { fs.unlinkSync(tempPath); } catch (_) { }
            return message.channel.send('❌ Không thể xử lý icon!');
        }

        // Upload emoji to emoji server
        try {
            const emojiServer = message.client.guilds.cache.get(EMOJI_SERVER_ID);
            if (emojiServer) {
                const iconBuffer = fs.readFileSync(iconPath);
                const emojiName = `sr_${code}`.substring(0, 32).replace(/[^a-zA-Z0-9_]/g, '');

                // Check if emoji already exists, delete it first
                const existingEmoji = emojiServer.emojis.cache.find(e => e.name === emojiName);
                if (existingEmoji) {
                    await existingEmoji.delete('Updating role icon');
                }

                const newEmoji = await emojiServer.emojis.create({
                    attachment: iconBuffer,
                    name: emojiName,
                    reason: `Role icon cho ${roleName}`
                });
                emojiId = newEmoji.id;
                console.log(`[addrole] Uploaded emoji ${emojiName} (${emojiId}) to emoji server`);
            } else {
                console.warn('[addrole] Emoji server not found!');
            }
        } catch (e) {
            console.error('[addrole] Error uploading emoji:', e.message);
        }
    }

    // Save to database with forAll flag and emojiId
    const isUpdate = !!mappings[code];
    const oldEntry = mappings[code];
    mappings[code] = {
        name: roleName,
        icon: iconPath,
        forAll: forAll,
        emojiId: emojiId || (oldEntry?.emojiId || null) // Keep old emojiId if not updating icon
    };
    saveRoleMappings(mappings);

    // Create or update Discord role
    let discordRole = message.guild.roles.cache.find(r => r.name === roleName);
    let roleCreated = false;
    let iconSet = false;

    // Nice color palette for random selection
    const colors = [
        0x9B59B6, // Purple
        0xE91E63, // Pink
        0x3498DB, // Blue
        0x1ABC9C, // Teal
        0x2ECC71, // Green
        0xF1C40F, // Yellow
        0xE67E22, // Orange
        0xE74C3C, // Red
        0x00BCD4, // Cyan
        0x8E44AD, // Deep Purple
        0x27AE60, // Emerald
        0xF39C12, // Gold
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    if (!discordRole) {
        try {
            discordRole = await message.guild.roles.create({
                name: roleName,
                color: randomColor,
                reason: `Tạo bởi ${message.author.username} qua ?addrole`
            });
            roleCreated = true;
        } catch (e) {
            console.error('[addrole] Error creating role:', e.message);
        }
    }

    // Set role icon (requires server boost level 2)
    if (discordRole && iconPath && fs.existsSync(iconPath)) {
        try {
            const iconBuffer = fs.readFileSync(iconPath);
            await discordRole.setIcon(iconBuffer);
            iconSet = true;
        } catch (e) {
            console.error('[addrole] Error setting icon:', e.message);
        }
    }

    // === CREATE DISPLAY ROLE "." ===
    let displayRole = null;
    let displayRoleCreated = false;
    let displayIconSet = false;

    if (discordRole) {
        try {
            // Tạo display role với tên "." 
            displayRole = await message.guild.roles.create({
                name: DISPLAY_ROLE_NAME,
                color: discordRole.color, // Copy màu từ role gốc
                reason: `Display role cho ${roleName} - tạo bởi ${message.author.username}`
            });
            displayRoleCreated = true;

            // Set icon cho display role (copy từ role gốc)
            if (iconPath && fs.existsSync(iconPath)) {
                try {
                    const iconBuffer = fs.readFileSync(iconPath);
                    await displayRole.setIcon(iconBuffer);
                    displayIconSet = true;
                } catch (e) {
                    console.error('[addrole] Error setting display role icon:', e.message);
                }
            }

            // Di chuyển display role lên cao nhất có thể (dưới bot role)
            try {
                const botMember = message.guild.members.me;
                const botHighestRole = botMember.roles.highest;
                // Đặt display role ngay dưới bot role
                const targetPosition = botHighestRole.position - 1;
                if (targetPosition > 0) {
                    await displayRole.setPosition(targetPosition);
                }
            } catch (e) {
                console.error('[addrole] Error moving display role:', e.message);
            }

            // Lưu vào DB
            db.setDisplayRole(message.guild.id, code, displayRole.id, discordRole.id);

        } catch (e) {
            console.error('[addrole] Error creating display role:', e.message);
        }
    }

    // Build result embed
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(isUpdate ? '✏️ Đã cập nhật Role!' : '✅ Đã thêm Role mới!')
        .setDescription(
            `**Mã:** \`${code}\`\n` +
            `**Tên:** ${roleName}\n` +
            `**Cho:** ${forAll ? '🌐 Tất cả server' : '👥 Guild members'}\n` +
            `**Icon:** ${iconPath ? '✅ Đã lưu' : '❌ Không có'}\n` +
            `**Discord role:** ${roleCreated ? '✅ Đã tạo' : (discordRole ? '✅ Đã tồn tại' : '❌ Lỗi')}\n` +
            `**Role icon:** ${iconSet ? '✅ Đã set' : '⚠️ Chưa set (cần Boost Lv2)'}\n` +
            `**Display role (.):** ${displayRoleCreated ? '✅ Đã tạo' : '❌ Lỗi'} ${displayIconSet ? '+ icon' : ''}`
        )
        .setFooter({ text: `Bởi ${message.author.username}` })
        .setTimestamp();

    if (iconPath && fs.existsSync(iconPath)) {
        const iconAttachment = new AttachmentBuilder(iconPath, { name: 'icon.png' });
        embed.setThumbnail('attachment://icon.png');
        return message.channel.send({ embeds: [embed], files: [iconAttachment] });
    }

    await message.channel.send({ embeds: [embed] });
}

module.exports = {
    execute,
    getRoleMappings,
    saveRoleMappings,
    getSubRoleName,
    getSubRoleIcon,
    getSubRoleEmojiId,
    isForAll,
    resizeToSquare,
    ROLE_ICONS_DIR,
    DISPLAY_ROLE_NAME,
    OLD_DISPLAY_ROLE_NAMES,
    EMOJI_SERVER_ID
};
