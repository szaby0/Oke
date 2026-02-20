const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop-checker')
        .setDescription('⏹️ Stop'),
    
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('⏹️ Leállítva')
            .setDescription('Minden checker leállítva')
            .setColor(0xff4444);
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
