require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express'); // Express beimportálása

// --- Express Szerver beállítása a Render.com-hoz ---
const app = express();
const port = process.env.PORT || 3000; // A Render automatikusan ad portot

app.get('/', (req, res) => {
    res.send('A bot sikeresen fut!'); // Egyszerű válasz a health checkre
});

app.listen(port, () => {
    console.log(`✅ Web szerver aktív a ${port}-es porton!`);
});
// --------------------------------------------------

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] 
});

client.commands = new Collection();

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} online!`);
    
    // Figyelem: A parancsfájloknak a "commands" mappában kell lenniük!
    const commandsPath = path.join(__dirname, 'commands');
    
    // Ellenőrizzük, hogy létezik-e a mappa, hogy ne dőljön össze a bot
    if (!fs.existsSync(commandsPath)) {
        console.error('❌ Hiba: A "commands" mappa nem található!');
        return;
    }

    const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
    
    for (const file of files) {
        try {
            const command = require(path.join(commandsPath, file));
            if (command.data?.name) {
                client.commands.set(command.data.name, command);
            }
        } catch (e) {
            console.error(`Error loading ${file}:`, e);
        }
    }
    console.log(`✅ ${client.commands.size} parancs betöltve!`);
    
    const guildId = process.env.GUILD_ID;
    const commands = Array.from(client.commands.values()).map(c => c.data);
    
    if (guildId) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            await guild.commands.set(commands);
            console.log(`🏠 Guild (szerver) parancsok frissítve!`);
            return;
        }
    }
    
    await client.application.commands.set(commands);
    console.log('🌍 Globális parancsok frissítve!');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    
    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Hiba történt a parancs futtatása közben!', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
