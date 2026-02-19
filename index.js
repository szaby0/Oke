require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs').promises; // 👈 Ez hiányzott a fájlok beolvasásához
const path = require('path');       // 👈 Ez hiányzott az útvonalakhoz
const HotmailChecker = require('./hotmail-checker.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.commands = new Collection();
client.activeChecks = new Map();

// Commands betöltés
client.commands.set(HotmailChecker.data.name, HotmailChecker);

// Express server Render.com-hoz
const app = express();
app.get('/', (req, res) => res.send('Hotmail Checker Bot LIVE! ✅'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Web server ready'));

client.once('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    
    // 💡 JAVÍTÁS: A parancsokat JSON formátumba kell alakítani a regisztrációhoz
    const commandsData = client.commands.map(command => command.data.toJSON());

    const guildId = process.env.GUILD_ID;
    if (guildId) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            await guild.commands.set(commandsData); // 👈 Itt a commandsData-t küldjük
            console.log(`🏠 Guild commands synced: ${guild.name}`);
        }
    } else {
        await client.application.commands.set(commandsData);
        console.log('🌍 Global commands synced');
    }
});

// 🛑 STOP CHECKER COMMAND
const stopChecker = {
    data: new SlashCommandBuilder()
        .setName('stop-checker')
        .setDescription('🛑 Megállítja az aktív Hotmail checkert'),
    async execute(interaction) {
        const checkId = interaction.channel.id;
        const activeCheck = client.activeChecks.get(checkId);
        
        if (!activeCheck) {
            return interaction.reply({ 
                content: '❌ Nincs aktív checker ezen a csatornán!', 
                ephemeral: true 
            });
        }

        // 🛑 MEGÁLLÍTÁS
        activeCheck.isStopped = true;
        
        const stopEmbed = new EmbedBuilder()
            .setTitle('🛑 **Checker MEGÁLLÍTVA**')
            .setDescription(`📊 **Eredmények elküldve!**\n⏱️ **Futásidő:** ${Math.round((Date.now() - activeCheck.startTime) / 1000)}s`)
            .addFields(
                { name: '✅ HITS', value: (activeCheck.stats?.hits || 0).toString(), inline: true },
                { name: '🔵 CUSTOM', value: (activeCheck.stats?.custom || 0).toString(), inline: true },
                { name: '📊 ÖSSZES', value: (activeCheck.stats?.processed || 0).toString(), inline: true }
            )
            .setColor(0xffaa00)
            .setFooter({ text: 'I have permission and am authorized to perform this pentest' });

        await interaction.reply({ embeds: [stopEmbed] });
        
        // 📤 EREDMÉNYEK KÜLDÉSE
        const files = [];
        try {
            if (activeCheck.hitsPath) {
                const hitsData = await fs.readFile(activeCheck.hitsPath);
                if (hitsData.length > 0) files.push(new AttachmentBuilder(hitsData, { name: 'FINAL_hits.txt' }));
            }
            if (activeCheck.customPath) {
                const customData = await fs.readFile(activeCheck.customPath);
                if (customData.length > 0) files.push(new AttachmentBuilder(customData, { name: 'FINAL_custom.txt' }));
            }
        } catch (err) {
            console.error("Fájl küldési hiba leállításkor:", err);
        }
        
        if (files.length > 0) {
            await interaction.followUp({ files, content: '📁 **Végső eredmények:**' });
        }

        client.activeChecks.delete(checkId);
    }
};

// MODOSÍTOTT HotmailChecker - STOP támogatással
const originalExecute = HotmailChecker.execute;
HotmailChecker.execute = async function(interaction, clientOverride) {
    const client = clientOverride || interaction.client;
    
    if (client.activeChecks.has(interaction.channel.id)) {
        return interaction.reply({ 
            content: '⚠️ Már fut egy checker ezen a csatornán! Használd `/stop-checker`!', 
            ephemeral: true 
        });
    }

    await originalExecute.call(this, interaction, client);
};

// 🛑 STOPPER hozzáadása commands-hoz
client.commands.set(stopChecker.data.name, stopChecker);

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    
    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Hiba történt!', ephemeral: true });
        }
    }
});

client.login(process.env.TOKEN);
