const { EmbedBuilder } = require('discord.js');

/**
 * ?rteam command - Random 10 players into 2 teams
 */
async function execute(message, args) {
    if (args.length !== 10) {
        return message.reply('❌ Vui lòng nhập đúng 10 người (tag hoặc ghi tên cách nhau bằng khoảng trắng)!\nVí dụ: `?rteam Rain @Tobi Hello Cac Xeu @GDji BZxf KDo @ksjadkj @fksldjf`');
    }

    // Shuffle array function (Fisher-Yates)
    function shuffle(array) {
        let currentIndex = array.length, randomIndex;
        while (currentIndex !== 0) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
        }
        return array;
    }

    const shuffledPlayers = shuffle([...args]);

    const team1 = shuffledPlayers.slice(0, 5);
    const team2 = shuffledPlayers.slice(5, 10);

    const embed = new EmbedBuilder()
        .setColor(0x00FFFF) // Cyan color
        .setTitle('🎲 KẾT QUẢ RANDOM CHIA ĐỘI')
        .setDescription('Đã chia 10 người thành 2 đội ngẫu nhiên hoàn toàn!')
        .addFields(
            {
                name: '⚔️ ĐỘI 1',
                value: team1.map((p, i) => `**${i + 1}.** ${p}`).join('\n'),
                inline: true
            },
            {
                name: '🛡️ ĐỘI 2',
                value: team2.map((p, i) => `**${i + 1}.** ${p}`).join('\n'),
                inline: true
            }
        )
        .setTimestamp()
        .setFooter({ text: `Yêu cầu bởi ${message.author.username}`, iconURL: message.author.displayAvatarURL() });

    return message.channel.send({ embeds: [embed] });
}

module.exports = { execute };
