/**
 * ?random command - Generate random number
 * Usage: ?random <min> <max>
 * Example: ?random 1 100
 */

/**
 * Execute random command
 */
async function execute(message, args) {
    // Check if both min and max are provided
    if (args.length < 2) {
        return message.reply('❌ Vui lòng nhập đầy đủ: `?random <min> <max>`\nVí dụ: `?random 1 100`');
    }

    const min = parseInt(args[0]);
    const max = parseInt(args[1]);

    // Validate inputs
    if (isNaN(min) || isNaN(max)) {
        return message.reply('❌ Vui lòng nhập số hợp lệ!\nVí dụ: `?random 1 100`');
    }

    if (min >= max) {
        return message.reply('❌ Số min phải nhỏ hơn số max!\nVí dụ: `?random 1 100`');
    }

    // Generate random number between min and max (inclusive)
    const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;

    // Send the result
    await message.reply(`🎲 **Số ngẫu nhiên từ ${min} đến ${max}:** ${randomNumber}`);
}

module.exports = { execute };


