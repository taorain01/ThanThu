/**
 * ?chon command - Random choice from options
 * Usage: ?chon <option1>, <option2>, <option3>, ...
 * Example: ?chon Lua Mi, Ca Voi, Con Gau, Cai Cho
 */

/**
 * Execute chon command
 */
async function execute(message, args) {
    // Check if options are provided
    if (args.length === 0) {
        return message.reply('❌ Vui lòng nhập các lựa chọn!\n**Cách dùng:** `?chon <tùy chọn 1>, <tùy chọn 2>, ...`\n**Ví dụ:** `?chon Lua Mi, Ca Voi, Con Gau, Cai Cho`');
    }

    // Join all args and split by comma
    const fullText = args.join(' ');
    const options = fullText.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);

    // Check if we have at least 2 options
    if (options.length < 2) {
        return message.reply('❌ Vui lòng nhập ít nhất 2 lựa chọn (phân cách bằng dấu phẩy)!\n**Ví dụ:** `?chon Lua Mi, Ca Voi, Con Gau, Cai Cho`');
    }

    // Random select one option
    const randomIndex = Math.floor(Math.random() * options.length);
    const selectedOption = options[randomIndex];

    // Send the result
    await message.reply(`🎯 **Bot đã chọn:** ${selectedOption}`);
}

module.exports = { execute };


