const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");
const fs = require("fs");

module.exports = (client) => {
  client.handleCommands = async () => {
    const commandFolders = fs.readdirSync(`./src/commands`);

    for (const folder of commandFolders) {
      const commandFiles = fs
        .readdirSync(`./src/commands/${folder}`)
        .filter((file) => file.endsWith(".js"));
      const { commands, commandArray } = client;
      for (const file of commandFiles) {
        const command = require(`../../commands/${folder}/${file}`);

        if (!command.data) {
          continue; // Bỏ qua prefix commands (không có data)
        } else {
          commands.set(command.data.name, command);
          if (command.data.toJSON) {
            commandArray.push(command.data.toJSON());
          }
        }
      }
    }

    const clientId = process.env.clientId;
    const guildId = process.env.guildId;
    const rest = new REST({ version: "10" }).setToken(process.env.token);

    try {
      console.log(`Bắt đầu đăng ký ${client.commandArray.length} lệnh slash...`);

      // Đăng ký Guild commands (hiển thị ngay lập tức)
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
          body: client.commandArray,
        });
        console.log(`Đăng ký lệnh slash cho guild ${guildId} thành công!`);
      }

      // KHÔNG đăng ký Global commands để tránh duplicate
      // Nếu muốn dùng global, xóa guild commands trước:
      // await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });

    } catch (error) {
      console.error("Lỗi khi đăng ký lệnh:", error);
    }
  };
};

