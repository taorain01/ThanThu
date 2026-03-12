/**
 * ?ban - Redirect đến ?sell (deprecated)
 * Lệnh này đã được gộp vào ?sell
 */

async function execute(message, args) {
    const sellCommand = require('./sell');

    // Nếu có arg (ID), redirect đến sell
    if (args.length > 0) {
        return sellCommand.execute(message, args);
    }

    // Không có arg → mở shop bán
    const { executeSell } = require('./shop');
    return executeSell(message, args);
}

module.exports = { execute };


