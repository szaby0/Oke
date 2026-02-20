require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Express a Render.com-hoz
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, () => console.log(`✅ Web server on port ${port}`));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] 
});

client.commands = new Collection();
client.activeChecks = new Map(); // Itt tároljuk a futó folyamatokat

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} online!`);
    
    const commandsPath = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath);

    const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
        try {
            const command = require(path.join(commandsPath, file));
            if (command.data?.name) client.commands.set(command.data.name, command);
        } catch (e) {
            console.error(`Error loading ${file}:`, e);
        }
    }
    
    const guildId = process.env.GUILD_ID;
    const commands = Array.from(client.commands.values()).map(c => c.data);
    
    if (guildId) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) await guild.commands.set(commands);
    } else {
        await client.application.commands.set(commands);
    }
    console.log('🌍 Commands synced!');
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
            await interaction.reply({ content: '❌ Error!', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
