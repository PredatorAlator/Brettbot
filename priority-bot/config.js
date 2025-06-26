require('dotenv').config();
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const stateFilePath = path.join(dataDir, 'state.json');

let commandsLocked = false;

if (fs.existsSync(stateFilePath)) {
    const state = JSON.parse(fs.readFileSync(stateFilePath));
    commandsLocked = state.commandsLocked || false;
} else {
    fs.writeFileSync(stateFilePath, JSON.stringify({ commandsLocked }));
}

const config = {
    token: process.env.TOKEN, // dont touch !!!
    guildId: process.env.GUILD_ID, // dont touch !!!
    clientId: process.env.CLIENT_ID, // dont touch !!!
    webhookUrl: process.env.WEBHOOK_URL, // dont touch !!!

    commandsLocked, // dynamischer Wert

    // Hier die erlaubten Rollen-IDs eintragen, die Befehle nutzen dürfen
    allowedRoles: [
        '1284878277399548016', // Owner Rolle
        '1340284399580872795'  // Mod Rolle
    ],

    // Rollen, die im /givepriority Befehl zur Auswahl stehen sollen
    roles: [
        {
            name: 'Elite',
            value: '1284273923118207057'  // nur diese Rolle soll auswählbar sein
        }
    ]
};

module.exports = config;
