require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

// 🚀 RENDER.COM WEB SERVER
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({ 
        status: '✅ Bot online!', 
        commands: Array.from(client?.commands?.keys() || []).join(', '),
        uptime: process.uptime()
    });
});

app.listen(port, () => console.log(`🌐 Web: http://localhost:${port}`));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] 
});

client.commands = new Collection();
client.activeChecks = new Map();

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} LIVE!`);
    
    const commandsPath = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsPath)) {
        fs.mkdirSync(commandsPath, { recursive: true });
        console.log('📁 commands/ mappa létrehozva');
    }

    const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
    console.log(`📦 ${files.length} command betöltése...`);
    
    for (const file of files) {
        try {
            const command = require(path.join(commandsPath, file));
            if (command.data?.name) {
                client.commands.set(command.data.name, command);
                console.log(`✅ ${command.data.name}`);
            }
        } catch (e) {
            console.error(`❌ ${file}:`, e.message);
        }
    }
    console.log(`✅ ${client.commands.size} commands ready!`);
    
    // SYNC
    const guildId = process.env.GUILD_ID;
    const commands = Array.from(client.commands.values()).map(c => c.data.toJSON());
    
    try {
        if (guildId) {
            const guild = await client.guilds.fetch(guildId);
            await guild.commands.set(commands);
            console.log(`🏠 Guild ${guild.name} synced!`);
        } else {
            await client.application.commands.set(commands);
            console.log('🌍 Global synced!');
        }
    } catch (syncErr) {
        console.error('Sync error:', syncErr.message);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = client.commands.get(interaction.commandName);
    if (!command) {
        return interaction.reply({ content: '❌ Command not found!', ephemeral: true });
    }
    
    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error('EXEC ERROR:', error);
        const reply = { content: '❌ Command error!', ephemeral: true };
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(reply);
        } else if (!interaction.replied) {
            await interaction.followUp(reply);
        }
    }
});

process.on('unhandledRejection', error => console.error('UNHANDLED:', error));
client.login(process.env.DISCORD_TOKEN);
