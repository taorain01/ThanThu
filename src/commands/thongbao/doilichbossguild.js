const { updateBossSchedule, removeBossSchedule, bossSchedule } = require('../../utils/bossState');

module.exports = {
    name: 'doilichbossguild',
    aliases: ['doilich', 'editbossschedule'],
    description: 'Chỉnh sửa lịch Boss Guild',

    async execute(message, args, client) {
        // Kiểm tra quyền (chỉ admin hoặc quản lý)
        if (!message.member.permissions.has('Administrator') &&
            !message.member.roles.cache.some(r => r.name === 'Quản Lý')) {
            return message.reply('❌ Bạn cần quyền Admin hoặc role Quản Lý!');
        }

        // Parse arguments: ?doilichbossguild <giờ>h <thứ>
        // Ví dụ: ?doilichbossguild 19h cn, ?doilichbossguild 20h t5
        if (args.length < 2) {
            return message.reply(
                '❌ **Cách dùng:** `?doilichbossguild <giờ>h <thứ>`\n' +
                '**Ví dụ:**\n' +
                '• `?doilichbossguild 19h cn` - Đổi Chủ nhật thành 19:00\n' +
                '• `?doilichbossguild 20h t5` - Thêm/đổi Thứ 5 thành 20:00\n' +
                '• `?doilichbossguild xoa t5` - Xóa Thứ 5 khỏi lịch\n\n' +
                '**Thứ hợp lệ:** cn, t2, t3, t4, t5, t6, t7'
            );
        }

        const dayMap = {
            'cn': 0, 'chunhat': 0,
            't2': 1, 'thu2': 1,
            't3': 2, 'thu3': 2,
            't4': 3, 'thu4': 3,
            't5': 4, 'thu5': 4,
            't6': 5, 'thu6': 5,
            't7': 6, 'thu7': 6
        };

        const dayNames = {
            0: 'Chủ nhật', 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7'
        };

        const hourArg = args[0].toLowerCase();
        const dayArg = args[1].toLowerCase();

        // Kiểm tra thứ
        if (!dayMap.hasOwnProperty(dayArg)) {
            return message.reply('❌ Thứ không hợp lệ! Dùng: cn, t2, t3, t4, t5, t6, t7');
        }

        const dayOfWeek = dayMap[dayArg];

        // Xử lý xóa
        if (hourArg === 'xoa' || hourArg === 'xóa' || hourArg === 'delete') {
            const removed = removeBossSchedule(dayOfWeek);
            if (removed) {
                return message.reply(`✅ Đã xóa **${dayNames[dayOfWeek]}** khỏi lịch Boss Guild!`);
            } else {
                return message.reply(`⚠️ **${dayNames[dayOfWeek]}** không có trong lịch!`);
            }
        }

        // Parse giờ
        const hourMatch = hourArg.match(/^(\d{1,2})h?$/);
        if (!hourMatch) {
            return message.reply('❌ Giờ không hợp lệ! Ví dụ: 19h, 20h');
        }

        const hour = parseInt(hourMatch[1]);
        if (hour < 0 || hour > 23) {
            return message.reply('❌ Giờ phải từ 0 đến 23!');
        }

        // Cập nhật lịch
        const result = updateBossSchedule(dayOfWeek, hour, 0);

        if (result.updated) {
            await message.reply(`✅ Đã đổi **${dayNames[dayOfWeek]}** thành **${hour}:00**`);
        } else {
            await message.reply(`✅ Đã thêm **${dayNames[dayOfWeek]}** lúc **${hour}:00** vào lịch!`);
        }

        // Hiển thị lịch hiện tại
        const currentSchedule = bossSchedule
            .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
            .map(s => `• ${s.name}: ${s.hour}:${s.minute.toString().padStart(2, '0')}`)
            .join('\n');

        await message.channel.send(`📅 **Lịch Boss Guild hiện tại:**\n\`\`\`\n${currentSchedule}\n\`\`\``);
    }
};
