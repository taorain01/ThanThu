const sharp = require('sharp');
sharp('c:/ALABASTA/ThanThu/anh/map guiildwar co icon.png')
  .metadata()
  .then(m => console.log(`Map: ${m.width}x${m.height}`));
