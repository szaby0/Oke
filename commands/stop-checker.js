const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop-checker')
        .setDescription('⏹️ Stop the current checker and save results'),
    
    async execute(interaction, client) {
        if (!client.activeChecks.has(interaction.guildId)) {
            return await interaction.reply({ content: '❌ No active checker in this server.', ephemeral: true });
        }

        client.activeChecks.set(interaction.guildId, false);
        
        const embed = new EmbedBuilder()
            .setTitle('⏹️ Stopping...')
            .setDescription('The checker will stop after the current email and send the results.')
            .setColor(0xff4444);
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
