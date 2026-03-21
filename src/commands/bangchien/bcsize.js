/**
 * ?bcsize - Thay đổi số người của các Team BC
 * Ví dụ: ?bcsize cong1 11 cong2 10 thu 5 rung 4
 * Thứ tự bất kỳ: ?bcsize rung 4 cong1 11 thu 5 cong2 10
 */

const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'bcsize',
    aliases: ['teamsize', 'bcsoluong'],
    description: 'Thay đổi số người của các Team BC',

    async execute(message, args, client) {
        const db = require('../../database/db');

        // Kiểm tra quyền (Quản Lý only)
        const quanLyRole = message.guild.roles.cache.find(r => r.name === 'Quản Lý');
        const isQuanLy = quanLyRole && message.member.roles.cache.has(quanLyRole.id);

        if (!isQuanLy) {
            return message.reply('❌ Chỉ Quản Lý mới được thay đổi số lượng team!');
        }

        // Get current sizes from DB
        const currentCong1 = db.getTeamSize('attack1') || 10;
        const currentCong2 = db.getTeamSize('attack2') || 10;
        const currentThu = db.getTeamSize('defense') ?? 5;
        const currentRung = db.getTeamSize('forest') ?? 5;
        const currentTotal = currentCong1 + currentCong2 + currentThu + currentRung;

        // No args = show current
        if (args.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('📊 Số lượng Team hiện tại')
                .addFields(
                    { name: '⚔️ Công 1', value: `**${currentCong1}** người`, inline: true },
                    { name: '🗡️ Công 2', value: `**${currentCong2}** người`, inline: true },
                    { name: '📝 Tổng', value: `${currentTotal} người`, inline: true },
                    { name: '🛡️ Thủ', value: `**${currentThu}** người`, inline: true },
                    { name: '🌲 Rừng', value: `**${currentRung}** người`, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true }
                )
                .setFooter({ text: '💡 VD: ?bcsize cong1 11 cong2 10 thu 5 rung 4' });
            return message.reply({ embeds: [embed] });
        }

        // Parse args: ?bcsize cong1 11 cong2 10 thu 5 rung 4
        let newCong1 = currentCong1;
        let newCong2 = currentCong2;
        let newThu = currentThu;
        let newRung = currentRung;

        for (let i = 0; i < args.length - 1; i++) {
            const key = args[i].toLowerCase();
            const value = parseInt(args[i + 1]);

            if (isNaN(value) || value < 1 || value > 20) {
                continue;
            }

            if (key === 'cong1' || key === 'công1' || key === 'attack1' || key === 'c1' || key === '1') {
                newCong1 = value;
                i++;
            } else if (key === 'cong2' || key === 'công2' || key === 'attack2' || key === 'c2' || key === '2') {
                newCong2 = value;
                i++;
            } else if (key === 'thu' || key === 'thủ' || key === 'defense') {
                newThu = value;
                i++;
            } else if (key === 'rung' || key === 'rừng' || key === 'forest') {
                newRung = value;
                i++;
            }
        }

        // Validate total (max 30 người - còn lại vào danh sách chờ)
        const newTotal = newCong1 + newCong2 + newThu + newRung;
        if (newTotal > 30) {
            return message.reply(`❌ Tổng số không được vượt quá 30! Công1(${newCong1}) + Công2(${newCong2}) + Thủ(${newThu}) + Rừng(${newRung}) = ${newTotal}`);
        }

        // Save to DB
        db.setTeamSize('attack1', newCong1);
        db.setTeamSize('attack2', newCong2);
        db.setTeamSize('defense', newThu);
        db.setTeamSize('forest', newRung);

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('✅ Đã cập nhật số lượng Team!')
            .addFields(
                { name: '⚔️ Công 1', value: `${currentCong1} → **${newCong1}**`, inline: true },
                { name: '🗡️ Công 2', value: `${currentCong2} → **${newCong2}**`, inline: true },
                { name: '📝 Tổng', value: `${newTotal} người`, inline: true },
                { name: '🛡️ Thủ', value: `${currentThu} → **${newThu}**`, inline: true },
                { name: '🌲 Rừng', value: `${currentRung} → **${newRung}**`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true }
            )
            .setFooter({ text: 'Đã lưu vào DB • Áp dụng cho BC mới' });

        await message.reply({ embeds: [embed] });
        console.log(`[bcsize] ${message.author.username}: Công1=${newCong1}, Công2=${newCong2}, Thủ=${newThu}, Rừng=${newRung}`);
    }
};
