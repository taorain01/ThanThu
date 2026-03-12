const fs = require("fs");
const path = require("path");

module.exports = (client) => {
  client.handleEvents = async () => {
    const eventsPath = path.join(__dirname, "../../events");
    if (!fs.existsSync(eventsPath)) {
      console.error(`Đường dẫn không tồn tại: ${eventsPath}`);
      return;
    }

    const eventFolders = fs.readdirSync(eventsPath);
    for (const folder of eventFolders) {
      const folderPath = path.join(eventsPath, folder);
      const eventFiles = fs
        .readdirSync(folderPath)
        .filter((file) => file.endsWith(".js"));

      for (const file of eventFiles) {
        const event = require(path.join(folderPath, file));

        if (event.name) {
          console.log(`Đang tải sự kiện: ${event.name} từ tệp ${file}`);

          if (event.once) {
            client.once(event.name, (...args) =>
              event.execute(...args, client)
            );
          } else {
            client.on(event.name, (...args) => event.execute(...args, client));
          }
        } else {
          console.warn(`Tệp sự kiện ${file} không có thuộc tính 'name'.`);
        }
      }
    }
  };
};

// const fs = require('fs')
// module.exports = client => {
//   client.handleEvents = async () => {
//     const eventFolders = fs.readdirSync(`./src/events`)
//     for (const folder of eventFolders) {
//       const eventFiles = fs
//         .readdirSync(`./src/events/${folder}`)
//         .filter(file => file.endsWith('.js'))

//       switch (folder) {
//         case 'client':
//           for (const file of eventFiles) {
//             const event = require(`../../events/${folder}/${file}`)
//             if (event.once)
//               client.once(event.name, (...args) =>
//                 event.execute(...args, client)
//               )
//             else
//               client.on(event.name, (...args) => event.execute(...args, client))
//           }
//           break

//         default:
//           break
//       }
//     }
//   }

// }


