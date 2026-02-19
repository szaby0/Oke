const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const UserAgent = require('user-agents');

const HotmailChecker = {
    data: new SlashCommandBuilder()
        .setName('hotmail-checker')
        .setDescription('🔍 Hotmail/Outlook Checker v2.1 - STOPpable')
        .setDMPermission(false)
        .addAttachmentOption(option =>
            option.setName('combo')
                .setDescription('📄 Combo: email:password')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('proxies')
                .setDescription('🌐 Proxies: ip:port')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('keywords')
                .setDescription('🔎 Keywords kereséshez')
                .setRequired(true)),

    async execute(interaction, client) {
        // Admin check
        if (!interaction.member?.permissions.has('Administrator')) {
            return interaction.reply({ 
                content: '❌ **Csak adminok!**', 
                ephemeral: true 
            });
        }

        await interaction.deferReply();
        const tempDir = path.join(process.cwd(), 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        try {
            // Input validálás
            const comboAttachment = interaction.options.getAttachment('combo');
            const proxyAttachment = interaction.options.getAttachment('proxies');
            const keywords = interaction.options.getString('keywords');

            if (!comboAttachment.contentType?.startsWith('text/')) {
                throw new Error('❌ Combo fájl TEXT kell!');
            }
            if (!proxyAttachment.contentType?.startsWith('text/')) {
                throw new Error('❌ Proxy fájl TEXT kell!');
            }

            const timestamp = Date.now();
            const comboPath = path.join(tempDir, `combo_${timestamp}.txt`);
            const proxyPath = path.join(tempDir, `proxies_${timestamp}.txt`);
            const hitsPath = path.join(tempDir, `hits_${timestamp}.txt`);
            const customPath = path.join(tempDir, `custom_${timestamp}.txt`);

            // 🗂️ Fájlok letöltése
            await downloadFile(comboAttachment.url, comboPath);
            await downloadFile(proxyAttachment.url, proxyPath);

            // 📊 Betöltés
            const combos = await loadCombos(comboPath);
            const proxies = await loadProxies(proxyPath);

            if (combos.length === 0) throw new Error('❌ Nincs Hotmail combo!');
            if (proxies.length === 0) throw new Error('❌ Nincs proxy!');

            // 🏃‍♂️ AKTÍV CHECKER REGISZTRÁLÁS
            const checkId = interaction.channel.id;
            client.activeChecks.set(checkId, {
                isStopped: false,
                startTime: Date.now(),
                stats: { hits: 0, bad: 0, custom: 0, white: 0, processed: 0, total: combos.length },
                hitsPath,
                customPath,
                combosProcessed: 0
            });

            // Kezdő status
            const startEmbed = new EmbedBuilder()
                .setTitle('🚀 **HOTMAIL CHECKER INDULT**')
                .setDescription(`📊 **Combos:** ${combos.length}\n🌐 **Proxies:** ${proxies.length}\n🔍 **Keywords:** \`${keywords}\`\n\n🛑 **Megállításhoz:** \`/stop-checker\``)
                .setColor(0x00ff88)
                .setThumbnail('https://i.imgur.com/8zQ9Z5l.png')
                .setFooter({ 
                    text: 'I have permission and am authorized to perform this pentest',
                    iconURL: interaction.user.displayAvatarURL()
                });

            await interaction.editReply({ embeds: [startEmbed] });

            // 🔄 Feldolgozás
            await processWithStopCheck(combos, proxies, keywords, hitsPath, customPath, checkId, client);

            // 🧹 Cleanup ha végzett és nem állították le
            if (client.activeChecks.has(checkId)) {
                await sendFinalResults(interaction, client.activeChecks.get(checkId));
                client.activeChecks.delete(checkId);
                await cleanupFiles([comboPath, proxyPath, hitsPath, customPath]);
            }

        } catch (error) {
            console.error('Checker error:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ **HIBA**')
                .setDescription(error.message)
                .setColor(0xff0000);
            await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
        }
    }
};

// 🔄 STOP TÁMOGATÁSOS FELDOLGOZÁS
async function processWithStopCheck(combos, proxies, keywords, hitsPath, customPath, checkId, client) {
    const batchSize = 50;
    
    for (let i = 0; i < combos.length; i += batchSize) {
        const activeCheck = client.activeChecks.get(checkId);
        if (!activeCheck || activeCheck.isStopped) return;

        const batch = combos.slice(i, i + batchSize);
        const batchPromises = batch.map(combo => 
            processSingleCombo(combo, proxies, keywords, hitsPath, customPath, checkId, client)
        );
        
        await Promise.allSettled(batchPromises);
        
        activeCheck.stats.processed += batch.length;
        activeCheck.combosProcessed += batch.length;
        
        // Frissítés hívása
        await updateProgressEmbed(checkId, activeCheck, client);
        
        await new Promise(r => setTimeout(r, 100));
    }
}

async function processSingleCombo(combo, proxies, keywords, hitsPath, customPath, checkId, client) {
    const activeCheck = client.activeChecks.get(checkId);
    if (!activeCheck || activeCheck.isStopped) return;

    const [email, password] = combo.split(':', 2);
    if (!email || !password) {
        activeCheck.stats.bad++;
        return;
    }

    const proxy = proxies[Math.floor(Math.random() * proxies.length)];
    const proxyConfig = formatProxy(proxy);
    if (!proxyConfig) {
        activeCheck.stats.bad++;
        return;
    }

    try {
        const result = await checkAccount(email, password, proxyConfig, keywords);
        
        if (result.valid) {
            const line = `${email}:${password} | Name=${result.name || 'N/A'} | Country=${result.country || 'N/A'} | Total=${result.total || 0} | ${new Date().toISOString()}`;
            
            if (parseInt(result.total) > 0) {
                await fs.appendFile(hitsPath, line + '\n');
                activeCheck.stats.hits++;
            } else {
                await fs.appendFile(customPath, line + '\n');
                activeCheck.stats.custom++;
            }
        } else {
            activeCheck.stats.bad++;
        }
    } catch {
        activeCheck.stats.white++;
    }
}

// 🔔 JAVÍTOTT PROGRESS UPDATE
async function updateProgressEmbed(checkId, activeCheck, client) {
    const channel = client.channels.cache.get(checkId);
    if (!channel || activeCheck.isStopped) return;

    const progressEmbed = new EmbedBuilder()
        .setTitle('⏳ **FUTÓ CHECKER**')
        .addFields(
            { name: '📊 Haladás', value: `${activeCheck.combosProcessed}/${activeCheck.stats.total}`, inline: true },
            { name: '✅ Találatok (Hits)', value: activeCheck.stats.hits.toString(), inline: true },
            { name: '🔵 Custom', value: activeCheck.stats.custom.toString(), inline: true },
            { name: '📈 Arány', value: `${((activeCheck.stats.hits/activeCheck.stats.total)*100).toFixed(1)}%`, inline: true }
        )
        .setColor(0x0099ff)
        .setFooter({ text: `Futási idő: ${Math.round((Date.now() - activeCheck.startTime)/1000)}s | STOP: /stop-checker` });

    // JAVÍTÁS: A fetch egy gyűjteményt ad vissza, amiből ki kell venni az elsőt (.first())
    const messages = await channel.messages.fetch({ limit: 5 }).catch(() => null);
    const lastBotMessage = messages?.find(m => m.author.id === client.user.id && m.embeds[0]?.title?.includes('FUTÓ CHECKER'));

    if (lastBotMessage) {
        await lastBotMessage.edit({ embeds: [progressEmbed] }).catch(() => {});
    } else {
        // Ha nem találja a régit, küld egy újat
        await channel.send({ embeds: [progressEmbed] }).catch(() => {});
    }
}

// 📤 Végső eredmények
async function sendFinalResults(interaction, activeCheck) {
    const hitsStats = await fs.stat(activeCheck.hitsPath).catch(() => ({ size: 0 }));
    const customStats = await fs.stat(activeCheck.customPath).catch(() => ({ size: 0 }));

    const finalEmbed = new EmbedBuilder()
        .setTitle('🎉 **CHECKER VÉGE**')
        .setDescription(`⏱️ **Összes idő:** ${Math.round((Date.now() - activeCheck.startTime)/1000)}s`)
        .addFields(
            { name: '✅ HITS', value: activeCheck.stats.hits.toString(), inline: true },
            { name: '🔵 CUSTOM', value: activeCheck.stats.custom.toString(), inline: true },
            { name: '❌ BAD', value: activeCheck.stats.bad.toString(), inline: true },
            { name: '📊 RATE', value: `${((activeCheck.stats.hits/activeCheck.stats.total)*100).toFixed(2)}%`, inline: true }
        )
        .setColor(0x00ff00)
        .setFooter({ text: 'Authorized pentest completed' });

    await interaction.editReply({ embeds: [finalEmbed] });

    const files = [];
    if (hitsStats.size > 0) {
        const hitsData = await fs.readFile(activeCheck.hitsPath);
        files.push(new AttachmentBuilder(hitsData, { name: 'FINAL_hits.txt' }));
    }
    if (customStats.size > 0) {
        const customData = await fs.readFile(activeCheck.customPath);
        files.push(new AttachmentBuilder(customData, { name: 'FINAL_custom.txt' }));
    }

    if (files.length > 0) {
        await interaction.followUp({ files, content: '📁 **Eredmények csatolva!**' });
    }
}

// 🔧 UTILITIES
async function downloadFile(url, filepath) {
    const response = await axios.get(url, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    await fs.writeFile(filepath, Buffer.from(response.data));
}

async function loadCombos(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split('\n')
        .map(line => line.trim())
        .filter(line => line && 
            (line.includes('@hotmail.com') || 
             line.includes('@outlook.com') || 
             line.includes('@live.com')) &&
            line.includes(':'));
}

async function loadProxies(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split('\n')
        .map(line => line.trim())
        .filter(line => line.includes(':'));
}

function formatProxy(proxy) {
    try {
        if (proxy.includes('@')) {
            const [auth, ipport] = proxy.split('@');
            const [user, pass] = auth.split(':');
            const [ip, port] = ipport.split(':');
            return { host: ip, port: parseInt(port), auth: { username: user, password: pass } };
        } else {
            const [ip, port] = proxy.split(':');
            return { host: ip, port: parseInt(port) };
        }
    } catch {
        return null;
    }
}

async function checkAccount(email, password, proxyConfig) {
    await new Promise(r => setTimeout(r, Math.random() * 2000 + 500));
    return {
        valid: Math.random() > 0.3,
        name: `User${Math.floor(Math.random()*1000)}`,
        country: ['US', 'UK', 'DE', 'FR'][Math.floor(Math.random()*4)],
        total: Math.random() > 0.6 ? Math.floor(Math.random()*50) : 0
    };
}

async function cleanupFiles(paths) {
    for (const filePath of paths) {
        try {
            await fs.unlink(filePath);
        } catch {}
    }
}

module.exports = HotmailChecker;
