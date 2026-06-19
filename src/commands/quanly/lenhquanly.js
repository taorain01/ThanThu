const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'lenhquanly',
    aliases: ['qlcmd', 'admincmd', 'hiddencommands'],
    description: 'Hien thi cac lenh quan ly va admin',

    async execute(message) {
        const member = message.member;
        const allowedRoles = ['Quan Ly', 'Bang Chu', 'Pho Bang Chu', 'Ky Cuong'];
        const allowedRoleNames = ['Quản Lý', 'Bang Chủ', 'Phó Bang Chủ', 'Kỳ Cương'];
        const hasPermission = member.roles.cache.some(role =>
            allowedRoles.includes(role.name) || allowedRoleNames.includes(role.name)
        );

        if (!hasPermission) {
            return message.reply({
                content: 'Ban khong co quyen xem lenh nay!',
                allowedMentions: { repliedUser: false }
            });
        }

        const embed = this.createEmbed();
        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    },

    createEmbed() {
        const prefix = process.env.PREFIX || '?';

        return new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle('Lenh Quan Ly & Admin')
            .setDescription('Danh sach cac lenh quan ly thanh vien, thong bao va tien ich')
            .addFields(
                {
                    name: 'Quan Ly Thanh Vien',
                    value: [
                        `\`${prefix}addmem @user <vi tri> <uid> <ten> [Xnt]\` - Them thanh vien`,
                        `\`${prefix}addid <uid> <ten> [Xnt]\` - Them ID cho duyet`,
                        `\`${prefix}xoamem @user\` - Xoa thanh vien khoi DB`,
                        `\`${prefix}roiguild @user\` - Danh dau roi guild`,
                        `\`${prefix}setkc <ten moi>\` - Doi ten Ky Cuong`,
                        `\`${prefix}xoabc\` - Xoa Bang Chu`,
                        `\`${prefix}xoapbc\` - Xoa Pho Bang Chu`,
                        `\`${prefix}rsrejoin @user\` - Reset so lan rejoin`,
                        `\`${prefix}locmem\` - Loc nguoi khong trong DB`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Danh Sach',
                    value: [
                        `\`${prefix}listmem\` - DS thanh vien hoat dong`,
                        `\`${prefix}listid\` - DS ID cho duyet`,
                        `\`${prefix}listallmem\` - DS tat ca, ke ca da roi`,
                        `\`${prefix}mem @user\` - Xem thong tin chi tiet`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Pick Role',
                    value: [
                        `\`${prefix}pickrole @user <dps|healer|tanker>\` - Set role cho nguoi khac`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Bang Chien',
                    value: [
                        `\`${prefix}lenhbc\` - Xem tat ca lenh BC`,
                        `\`${prefix}bc\` - Tao thong bao BC`,
                        `\`${prefix}bcql\` - Panel quan ly`,
                        `\`${prefix}chotbc\` - Them role @bc`,
                        `\`${prefix}bcdoi\` \`${prefix}bcadd\` \`${prefix}bcchihuy\` \`${prefix}bcleader\``,
                        `\`${prefix}bcend\` - Ket thuc BC`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Thong Bao',
                    value: [
                        '`/thongbaoguild` - Thong bao su kien guild',
                        '`/thongbao` - Dat thong bao dinh ky',
                        '`/listthongbao` - Xem danh sach thong bao',
                        '`/huythongbao` - Huy thong bao',
                        `\`${prefix}bossguild\` - Dang ky boss guild`,
                        `\`${prefix}lichboss\` - Xem lich boss`,
                        `\`${prefix}nhacnho\` - Dang ky nhac nho event`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Kenh',
                    value: [
                        `\`${prefix}muteall\` - Chan/mo tat ca lenh trong kenh`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Tien Ich',
                    value: [
                        `\`${prefix}addhelp\` - Huong dan them thanh vien`,
                        `\`${prefix}random <min> <max>\` - Random so`,
                        `\`${prefix}chon <a, b, c>\` - Chon random`
                    ].join('\n'),
                    inline: false
                }
            )
            .setTimestamp()
            .setFooter({ text: 'Minigame va economy commands da duoc go bo' });
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        const parts = customId.split('_');
        const authorId = parts[2];

        if (interaction.user.id !== authorId) {
            return interaction.reply({
                content: 'Chi nguoi dung lenh moi duoc cap nhat danh sach nay!',
                ephemeral: true
            });
        }

        await interaction.update({ embeds: [this.createEmbed()], components: [] });
    }
};
