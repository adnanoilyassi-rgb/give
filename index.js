require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  SlashCommandBuilder,
  Routes,
  REST,
  EmbedBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');

const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const OWNER_ID = '1109618275211542659';
const CLIENT_ID = '1433287399714066494';
const GUILD_ID = '816775570519621673';
const VOICE_CHANNEL_ID = '1423114544636493904';

const INVITE_DATA_FILE = path.join(__dirname, 'inviteData.json');
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 60 * 1000; // 5 hours

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Invite tracker
const inviteUses = new Map();   // guildId => Map(inviteCode, uses)
const inviteCounts = new Map(); // guildId => Map(userId, count)

// Anti-spam
const userMessageTracker = new Map();
const userSpamStrikes = new Map();

const SPAM_MESSAGE_COUNT = 3;
const SPAM_INTERVAL_MS = 2000; // 2 seconds
const TIMEOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SPAM_STRIKES_BEFORE_BAN = 10;

function loadInviteData() {
  try {
    const raw = fs.readFileSync(INVITE_DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    for (const [guildId, userCounts] of Object.entries(data)) {
      inviteCounts.set(guildId, new Map(Object.entries(userCounts).map(([k, v]) => [k, v])));
    }
    console.log('📂 Invite data loaded from inviteData.json');
  } catch {
    console.log('📂 No existing invite data found, starting fresh.');
  }
}

function saveInviteData() {
  try {
    const data = {};
    for (const [guildId, userMap] of inviteCounts.entries()) {
      data[guildId] = Object.fromEntries(userMap);
    }
    fs.writeFileSync(INVITE_DATA_FILE, JSON.stringify(data, null, 2));
    console.log('💾 Invite data saved to inviteData.json');
  } catch (error) {
    console.error('❌ Failed to save invite data:', error.message);
  }
}

loadInviteData();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all bot commands'),

  new SlashCommandBuilder()
    .setName('a')
    .setDescription('Call Parasite system'),

  new SlashCommandBuilder()
    .setName('parasite')
    .setDescription('Parasite system greeting'),

  new SlashCommandBuilder()
    .setName('testwelcome')
    .setDescription('Test the welcome DM'),

  new SlashCommandBuilder()
    .setName('sendwelcomeall')
    .setDescription('Send welcome DM to all members'),

  new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Show invite count')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to check')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('inviteleaderboard')
    .setDescription('Show top inviters'),

  new SlashCommandBuilder()
    .setName('parasite-join')
    .setDescription('Make Parasite join the main voice channel again'),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear messages from the current channel')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Number of messages to delete (1-100)')
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered.');
  } catch (error) {
    console.error('❌ Slash command registration error:', error);
  }
})();

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();

    invites.forEach(invite => {
      map.set(invite.code, invite.uses || 0);
    });

    inviteUses.set(guild.id, map);

    if (!inviteCounts.has(guild.id)) {
      inviteCounts.set(guild.id, new Map());
    }

    console.log(`📦 Cached invites for ${guild.name}`);
  } catch (error) {
    console.error(`❌ Failed to cache invites for ${guild.name}:`, error.message);
  }
}

async function joinParasiteVoice() {
  try {
    const channel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      console.log('❌ Voice channel not found or not a voice channel.');
      return false;
    }

    const oldConnection = getVoiceConnection(channel.guild.id);
    if (oldConnection) {
      try {
        oldConnection.destroy();
      } catch {}
    }

    joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfMute: true,
      selfDeaf: true
    });

    console.log(`🎧 Joined voice channel: ${channel.name}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to join voice channel:', error);
    return false;
  }
}

client.once('clientReady', async () => {
  try {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log('✅ Anti-spam version loaded');

    for (const guild of client.guilds.cache.values()) {
      await cacheGuildInvites(guild);
    }

    await joinParasiteVoice();

    client.user.setPresence({
      status: 'dnd',
      activities: [{
        name: 'Parasite Server',
        type: ActivityType.Watching
      }]
    });

    setInterval(() => {
      saveInviteData();
      console.log('⏰ Auto-save triggered (5h interval)');
    }, AUTO_SAVE_INTERVAL_MS);
    console.log('⏰ Auto-save scheduled every 5 hours');
  } catch (error) {
    console.error('Startup error:', error);
  }
});

client.on('inviteCreate', async invite => {
  const guildMap = inviteUses.get(invite.guild.id) || new Map();
  guildMap.set(invite.code, invite.uses || 0);
  inviteUses.set(invite.guild.id, guildMap);
});

client.on('inviteDelete', async invite => {
  const guildMap = inviteUses.get(invite.guild.id);
  if (guildMap) {
    guildMap.delete(invite.code);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setColor(0x111111)
      .setTitle('🌙 Parasite System Commands')
      .setDescription('Here are the available commands:')
      .addFields(
        { name: '🆘 /help', value: 'Show all commands', inline: false },
        { name: '👁️ /a', value: 'Check if the Parasite system is active', inline: false },
        { name: '🦠 /parasite', value: 'Parasite system greeting message', inline: false },
        { name: '📩 /testwelcome', value: 'Test the welcome DM message (owners-only)', inline: false },
        { name: '📨 /sendwelcomeall', value: 'Send welcome DM to all members (owners-only)', inline: false },
        { name: '📨 /invites', value: 'Check how many people a user invited', inline: false },
        { name: '🏆 /inviteleaderboard', value: 'Show top inviters in the server', inline: false },
        { name: '🎧 /parasite-join', value: 'Make Parasite join the main voice channel again', inline: false },
        { name: '🧹 /clear', value: 'Delete messages from the current channel', inline: false }
      )
      .setFooter({ text: 'Parasite System • Made by ILYAS' })
      .setTimestamp();

    await interaction.reply({ embeds: [helpEmbed] });
    return;
  }

  if (interaction.commandName === 'a') {
    await interaction.reply({
      content: '👁️ **Hello Parasites**\nThe Parasite system is active and watching the server.\n\n— System created by **ILYAS**'
    });
    return;
  }

  if (interaction.commandName === 'parasite') {
    await interaction.reply({
      content: '🌙 **Parasite Core Online**\nSilent system active 24/7.\nMonitoring the server from the shadows.\n\n⚙️ Created by **ILYAS**'
    });
    return;
  }

  if (interaction.commandName === 'testwelcome') {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '❌ You are not allowed to use this command.',
        flags: 64
      });
    }

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x111111)
      .setTitle('🌙 Welcome to Parasite')
      .setDescription(
`Hey ${interaction.user},

ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ 🪱ᴘᴀʀᴀꜱɪᴛᴇ ꜱᴇʀᴠᴇʀ🪱.

ᴛʜɪꜱ ᴄᴏᴍᴍᴜɴɪᴛʏ ɪꜱ ᴘᴀᴄᴋᴇᴅ ᴡɪᴛʜ ᴀᴍᴀᴢɪɴɢ ᴘᴇᴏᴘʟᴇ, ᴅᴀɪʟʏ ᴀᴄᴛɪᴠɪᴛɪᴇꜱ, ᴀɴᴅ ᴇxᴄʟᴜꜱɪᴠᴇ ᴘᴇʀᴋꜱ.

ʙᴇ ꜱᴜʀᴇ ᴛᴏ ᴄʜᴇᴄᴋ ᴏᴜᴛ ᴛʜᴇ ʀᴜʟᴇꜱ, ɪɴᴛʀᴏᴅᴜᴄᴇ ʏᴏᴜʀꜱᴇʟꜰ, ᴀɴᴅ ᴊᴜᴍᴘ ɪɴᴛᴏ ᴛʜᴇ ꜰᴜɴ.

ɪꜰ ʏᴏᴜ ɴᴇᴇᴅ ʜᴇʟᴘ, ᴊᴜꜱᴛ ᴀꜱᴋ — ꜱᴛᴀꜰꜰ ᴀɴᴅ ᴍᴇᴍʙᴇʀꜱ ᴀʀᴇ ʜᴀᴘᴘʏ ᴛᴏ ᴀꜱꜱɪꜱᴛ!
https://discord.gg/wrpXTavP`
      )
      .setImage('https://i.pinimg.com/originals/20/d8/53/20d85388790f12878e4c2d4c77012b5e.gif')
      .setFooter({ text: 'ᴍᴀᴅᴇ ʙʏ • `ɪʟʏᴀꜱ` •' })
      .setTimestamp();

    try {
      await interaction.user.send({ embeds: [welcomeEmbed] });

      await interaction.reply({
        content: '📩 Welcome DM sent!',
        flags: 64
      });
    } catch (error) {
      await interaction.reply({
        content: '❌ Could not send DM. Check your privacy settings.',
        flags: 64
      });
    }
    return;
  }

  if (interaction.commandName === 'sendwelcomeall') {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '❌ You are not allowed to use this command.',
        flags: 64
      });
    }

    await interaction.reply({
      content: '📨 Sending welcome message to all members...',
      flags: 64
    });

    try {
      const members = await interaction.guild.members.fetch();

      let sent = 0;
      let failed = 0;
      let skippedBots = 0;

      for (const member of members.values()) {
        if (member.user.bot) {
          skippedBots++;
          continue;
        }

        const welcomeEmbed = new EmbedBuilder()
          .setColor(0x111111)
          .setTitle('🌙 Welcome to Parasite')
          .setDescription(
`Hey ${member},

ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ 🪱ᴘᴀʀᴀꜱɪᴛᴇ ꜱᴇʀᴠᴇʀ🪱.

ᴇɴᴊᴏʏ ᴛʜᴇ ᴄᴏᴍᴍᴜɴɪᴛʏ ᴀɴᴅ ʜᴀᴠᴇ ꜰᴜɴ.

https://discord.gg/wrpXTavP

— ᴍᴀᴅᴇ ʙʏ • ɪʟʏᴀꜱ •`
          )
          .setImage('https://i.pinimg.com/originals/20/d8/53/20d85388790f12878e4c2d4c77012b5e.gif')
          .setTimestamp();

        try {
          await member.send({ embeds: [welcomeEmbed] });
          sent++;
        } catch {
          failed++;
        }

        await sleep(700);
      }

      await interaction.followUp({
        content: `✅ Sent: ${sent} members\n❌ Failed: ${failed} members\n🤖 Skipped bots: ${skippedBots}`,
        flags: 64
      });
    } catch (error) {
      console.error('sendwelcomeall error:', error);
      await interaction.followUp({
        content: '❌ Error while sending welcome messages.',
        flags: 64
      });
    }
    return;
  }

  if (interaction.commandName === 'invites') {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildCounts = inviteCounts.get(interaction.guild.id) || new Map();
    const count = guildCounts.get(targetUser.id) || 0;

    await interaction.reply({
      content: `📨 **${targetUser.username}** has **${count}** invites.`
    });
    return;
  }

  if (interaction.commandName === 'inviteleaderboard') {
    const guildCounts = inviteCounts.get(interaction.guild.id) || new Map();

    const sorted = [...guildCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (sorted.length === 0) {
      await interaction.reply('📭 No invite data yet.');
      return;
    }

    let text = '🏆 **Invite Leaderboard**\n\n';

    for (let i = 0; i < sorted.length; i++) {
      const [userId, count] = sorted[i];
      const user = await client.users.fetch(userId).catch(() => null);
      text += `**${i + 1}.** ${user ? user.username : 'Unknown User'} — **${count}** invites\n`;
    }

    await interaction.reply({ content: text });
    return;
  }

  if (interaction.commandName === 'parasite-join') {
    await interaction.reply({
      content: '🎧 Parasite is trying to join the voice channel...',
      flags: 64
    });

    const joined = await joinParasiteVoice();

    await interaction.followUp({
      content: joined
        ? '✅ Parasite joined the voice channel again.'
        : '❌ Could not join the voice channel.',
      flags: 64
    });
    return;
  }

  if (interaction.commandName === 'clear') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({
        content: '❌ You need Manage Messages permission.',
        flags: 64
      });
    }

    const amount = interaction.options.getInteger('amount');

    if (amount < 1 || amount > 100) {
      return interaction.reply({
        content: '❌ Choose a number between 1 and 100.',
        flags: 64
      });
    }

    try {
      await interaction.channel.bulkDelete(amount, true);

      await interaction.reply({
        content: `🧹 Deleted ${amount} messages.`,
        flags: 64
      });
    } catch (error) {
      console.error('clear command error:', error);
      await interaction.reply({
        content: '❌ Failed to delete messages. Messages older than 14 days cannot be bulk deleted.',
        flags: 64
      });
    }
    return;
  }
});

client.on('guildMemberAdd', async member => {
  try {
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x111111)
      .setTitle('🌙 Welcome to Parasite')
      .setDescription(
`Hey ${member},

ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ 🪱ᴘᴀʀᴀꜱɪᴛᴇ ꜱᴇʀᴠᴇʀ🪱.

ᴇɴᴊᴏʏ ᴛʜᴇ ᴄᴏᴍᴍᴜɴɪᴛʏ ᴀɴᴅ ʜᴀᴠᴇ ꜰᴜɴ.

https://discord.gg/wrpXTavP

— ᴍᴀᴅᴇ ʙʏ • ɪʟʏᴀꜱ •`
      )
      .setImage('https://i.pinimg.com/originals/20/d8/53/20d85388790f12878e4c2d4c77012b5e.gif')
      .setTimestamp();

    try {
      await member.send({ embeds: [welcomeEmbed] });
      console.log(`📩 Welcome DM sent to ${member.user.tag}`);
    } catch (error) {
      console.log(`⚠️ Could not DM ${member.user.tag}`);
    }

    const oldInvites = inviteUses.get(member.guild.id) || new Map();
    const newInvites = await member.guild.invites.fetch();

    let usedInvite = null;

    newInvites.forEach(invite => {
      const oldUses = oldInvites.get(invite.code) || 0;
      const newUses = invite.uses || 0;

      if (newUses > oldUses) {
        usedInvite = invite;
      }
    });

    const updatedMap = new Map();
    newInvites.forEach(invite => {
      updatedMap.set(invite.code, invite.uses || 0);
    });
    inviteUses.set(member.guild.id, updatedMap);

    if (!usedInvite || !usedInvite.inviter) {
      console.log(`⚠️ Could not detect inviter for ${member.user.tag}`);
      return;
    }

    const guildCounts = inviteCounts.get(member.guild.id) || new Map();
    const inviterId = usedInvite.inviter.id;
    const currentCount = guildCounts.get(inviterId) || 0;
    const newCount = currentCount + 1;

    guildCounts.set(inviterId, newCount);
    inviteCounts.set(member.guild.id, guildCounts);

    saveInviteData();
    console.log(`🎉 ${usedInvite.inviter.tag} invited ${member.user.tag} | Total invites: ${newCount}`);
  } catch (error) {
    console.error('guildMemberAdd error:', error);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    if (oldState.id === client.user.id && oldState.channelId && !newState.channelId) {
      console.log('⚠️ Parasite was disconnected from voice.');
    }
  } catch (error) {
    console.error('voiceStateUpdate error:', error);
  }
});

client.on('messageCreate', async message => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    if (message.author.id === OWNER_ID) return;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

    const userKey = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();

    if (!userMessageTracker.has(userKey)) {
      userMessageTracker.set(userKey, []);
    }

    const timestamps = userMessageTracker.get(userKey) || [];
    const recent = timestamps.filter(ts => now - ts <= SPAM_INTERVAL_MS);
    recent.push(now);
    userMessageTracker.set(userKey, recent);

    console.log(`[SPAM CHECK] ${message.author.tag} -> ${recent.length} messages in 2s`);

    if (recent.length >= SPAM_MESSAGE_COUNT) {
      userMessageTracker.set(userKey, []);

      const strikes = (userSpamStrikes.get(userKey) || 0) + 1;
      userSpamStrikes.set(userKey, strikes);

      try {
        await message.delete().catch(() => null);
      } catch {}

      if (member.isCommunicationDisabled()) {
        console.log(`⏳ ${message.author.tag} already timed out`);
        return;
      }

      if (strikes >= MAX_SPAM_STRIKES_BEFORE_BAN) {
        try {
          await member.ban({ reason: 'Spam detected repeatedly (10 strikes).' });
          console.log(`🔨 Banned ${message.author.tag} for spam (${strikes} strikes)`);
          await message.channel.send(`🔨 ${message.author} was banned for repeated spam.`).catch(() => null);
        } catch (error) {
          console.error(`❌ Failed to ban ${message.author.tag}:`, error);
        }
        return;
      }

      try {
        await member.timeout(TIMEOUT_DURATION_MS, 'Spam detected: 3 messages in 2 seconds.');
        console.log(`⏳ Timed out ${message.author.tag} for 5 minutes (${strikes}/10 strikes)`);
        await message.channel.send(`⏳ ${message.author} has been timed out for 5 minutes for spam. (${strikes}/10 strikes)`).catch(() => null);
      } catch (error) {
        console.error(`❌ Failed to timeout ${message.author.tag}:`, error);
      }
    }
  } catch (error) {
    console.error('Anti-spam error:', error);
  }
});

client.on('error', error => {
  console.error('Client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down — saving invite data...');
  saveInviteData();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Terminating — saving invite data...');
  saveInviteData();
  client.destroy();
  process.exit(0);
});

client.login(TOKEN);