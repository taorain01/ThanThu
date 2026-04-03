const fs = require('fs');

function fixMojibake(fileOut) {
    const fileIn = './src/events/client/ready.js';
    const utf8Str = fs.readFileSync(fileIn, 'utf8');
    try {
        const buf = Buffer.from(utf8Str, 'latin1');
        const fixedStr = buf.toString('utf8');
        
        fs.writeFileSync(fileOut, fixedStr, 'utf8');
        
        // Output some lines to verify
        const lines = fixedStr.split(/\r?\n/).slice(200, 220);
        console.log("Preview of fixed lines:");
        lines.forEach(l => console.dir(l));
        
    } catch(e) {
        console.error(e);
    }
}

fixMojibake('./src/events/client/ready_fixed.js');
