import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CHECK_DELAY_MS = Number(process.env.CHECK_DELAY_MS || 1400);
const MAX_AMOUNT = Math.min(Number(process.env.MAX_AMOUNT || 50), 100);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 10000);

if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN in Railway variables.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName('check')
    .setDescription('Generate and check possible TikTok usernames')
    .addIntegerOption(option =>
      option
        .setName('length')
        .setDescription('Username length')
        .setRequired(true)
        .addChoices(
          { name: '2 letters/chars', value: 2 },
          { name: '3 letters/chars', value: 3 },
          { name: '4 letters/chars', value: 4 }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription(`How many usernames to test. Max ${MAX_AMOUNT}`)
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(MAX_AMOUNT)
    )
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Generation type')
        .setRequired(false)
        .addChoices(
          { name: 'letters only', value: 'letters' },
          { name: 'letters + numbers', value: 'letters_numbers' },
          { name: 'letters + numbers + underscore', value: 'mixed' }
        )
    ),

  new SlashCommandBuilder()
    .setName('checklist')
    .setDescription('Check a custom list of usernames')
    .addStringOption(option =>
      option
        .setName('usernames')
        .setDescription('Example: zooz, z0oz, z_oo, abcd')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('zhelp')
    .setDescription('Show bot usage help')
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    if (CLIENT_ID && GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log('Slash commands registered for guild.');
    } else if (CLIENT_ID) {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('Slash commands registered globally. Global commands can take time to appear.');
    } else {
      console.log('CLIENT_ID not set. Slash commands were not registered.');
    }
  } catch (error) {
    console.error('Command registration failed:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'zhelp') {
      await interaction.reply({ embeds: [helpEmbed()] });
      return;
    }

    if (interaction.commandName === 'check') {
      const length = interaction.options.getInteger('length', true);
      const amount = interaction.options.getInteger('amount') || 20;
      const type = interaction.options.getString('type') || 'letters_numbers';

      await interaction.deferReply();

      const usernames = generateUniqueUsernames(length, Math.min(amount, MAX_AMOUNT), type);
      const results = await checkMany(usernames);
      await interaction.editReply({ embeds: [resultsEmbed(`Generated check: ${length} chars`, results)] });
      return;
    }

    if (interaction.commandName === 'checklist') {
      const raw = interaction.options.getString('usernames', true);
      const usernames = normalizeList(raw).slice(0, MAX_AMOUNT);

      if (!usernames.length) {
        await interaction.reply('No valid usernames found. Example: `zooz, z0oz, z_oo, abcd`');
        return;
      }

      await interaction.deferReply();
      const results = await checkMany(usernames);
      await interaction.editReply({ embeds: [resultsEmbed('Custom list check', results)] });
      return;
    }
  } catch (error) {
    console.error(error);
    const message = 'صار خطأ أثناء الفحص. شوف Railway logs.';
    if (interaction.deferred || interaction.replied) await interaction.editReply(message);
    else await interaction.reply({ content: message, ephemeral: true });
  }
});

function normalizeList(text) {
  return [...new Set(
    text
      .split(/[\s,،]+/g)
      .map(x => x.replace(/^@/, '').trim().toLowerCase())
      .filter(isValidUsername)
  )];
}

function isValidUsername(username) {
  if (!username || username.length < 2 || username.length > 24) return false;
  if (!/^[a-z0-9._]+$/.test(username)) return false;
  if (username.startsWith('.') || username.endsWith('.')) return false;
  if (username.includes('..')) return false;
  return true;
}

function generateUniqueUsernames(length, amount, type) {
  const sets = {
    letters: 'abcdefghijklmnopqrstuvwxyz',
    letters_numbers: 'abcdefghijklmnopqrstuvwxyz0123456789',
    mixed: 'abcdefghijklmnopqrstuvwxyz0123456789_'
  };

  const chars = sets[type] || sets.letters_numbers;
  const results = new Set();
  const maxAttempts = amount * 100;
  let attempts = 0;

  while (results.size < amount && attempts < maxAttempts) {
    attempts++;
    let username = '';
    for (let i = 0; i < length; i++) {
      username += chars[Math.floor(Math.random() * chars.length)];
    }
    if (isValidUsername(username)) results.add(username);
  }

  return [...results];
}

async function checkMany(usernames) {
  const results = [];

  for (const username of usernames) {
    const result = await checkTikTokUsername(username);
    results.push(result);
    await sleep(CHECK_DELAY_MS);
  }

  return results;
}

async function checkTikTokUsername(username) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9'
      }
    });

    clearTimeout(timeout);

    if (response.status === 404) {
      return { username, status: 'available', note: 'page not found' };
    }

    if (response.status >= 200 && response.status < 400) {
      const html = await response.text().catch(() => '');
      const notFound = /Couldn't find this account|couldn.t find this account|user not found|statusCode":10202/i.test(html);
      if (notFound) return { username, status: 'available', note: 'not found page' };
      return { username, status: 'taken', note: `HTTP ${response.status}` };
    }

    if ([403, 429].includes(response.status)) {
      return { username, status: 'unknown', note: `blocked/rate limited HTTP ${response.status}` };
    }

    return { username, status: 'unknown', note: `HTTP ${response.status}` };
  } catch (error) {
    clearTimeout(timeout);
    return { username, status: 'unknown', note: error.name === 'AbortError' ? 'timeout' : 'request failed' };
  }
}

function resultsEmbed(title, results) {
  const available = results.filter(x => x.status === 'available').map(formatUser);
  const taken = results.filter(x => x.status === 'taken').map(formatUser);
  const unknown = results.filter(x => x.status === 'unknown').map(x => `@${x.username} — ${x.note}`);

  return new EmbedBuilder()
    .setTitle(`Zooz Username Checker — ${title}`)
    .setDescription('TikTok does not provide a public official availability endpoint, so unknown results can happen because of rate limits or blocking.')
    .addFields(
      { name: `✅ Available (${available.length})`, value: block(available), inline: false },
      { name: `❌ Taken (${taken.length})`, value: block(taken), inline: false },
      { name: `⚠️ Unknown (${unknown.length})`, value: block(unknown), inline: false }
    )
    .setFooter({ text: `Delay: ${CHECK_DELAY_MS}ms | Max per command: ${MAX_AMOUNT}` })
    .setTimestamp();
}

function helpEmbed() {
  return new EmbedBuilder()
    .setTitle('Zooz Bot Commands')
    .setDescription('بوت فحص يوزرات تيك توك للديسكورد.')
    .addFields(
      { name: '/check', value: 'Generate random usernames and check them. Example: `/check length:4 amount:20 type:letters_numbers`' },
      { name: '/checklist', value: 'Check your own list. Example: `/checklist usernames:zooz, z0oz, z_oo`' },
      { name: 'Railway variables', value: '`DISCORD_TOKEN`, `CLIENT_ID`, optional `GUILD_ID`, optional `CHECK_DELAY_MS`, optional `MAX_AMOUNT`' }
    );
}

function formatUser(result) {
  return `@${result.username}`;
}

function block(items) {
  if (!items.length) return 'None';
  const text = items.slice(0, 25).join('\n');
  return text.length > 1024 ? text.slice(0, 1010) + '\n...' : text;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

client.login(TOKEN);
