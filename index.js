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
const CHECK_DELAY_MS = Number(process.env.CHECK_DELAY_MS || 2200);
const MAX_AMOUNT = Math.min(Number(process.env.MAX_AMOUNT || 30), 60);
const MAX_FIND_CHECKS = Math.min(Number(process.env.MAX_FIND_CHECKS || 80), 120);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);

if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN in Railway variables.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('find')
    .setDescription('Search until it finds available usernames or reaches the scan limit')
    .addIntegerOption(option => option.setName('length').setDescription('Username length').setRequired(true).addChoices(
      { name: '2 chars', value: 2 },
      { name: '3 chars', value: 3 },
      { name: '4 chars', value: 4 }
    ))
    .addIntegerOption(option => option.setName('wanted').setDescription('How many available usernames you want').setRequired(false).setMinValue(1).setMaxValue(10))
    .addIntegerOption(option => option.setName('max_checks').setDescription(`How many usernames to scan. Max ${MAX_FIND_CHECKS}`).setRequired(false).setMinValue(5).setMaxValue(MAX_FIND_CHECKS))
    .addStringOption(option => option.setName('type').setDescription('Generation type').setRequired(false).addChoices(
      { name: 'rare mixed patterns', value: 'rare' },
      { name: 'letters only', value: 'letters' },
      { name: 'letters + numbers', value: 'letters_numbers' },
      { name: 'letters + numbers + underscore', value: 'mixed' }
    )),

  new SlashCommandBuilder()
    .setName('check')
    .setDescription('Generate and check possible short usernames')
    .addIntegerOption(option => option.setName('length').setDescription('Username length').setRequired(true).addChoices(
      { name: '2 chars', value: 2 },
      { name: '3 chars', value: 3 },
      { name: '4 chars', value: 4 }
    ))
    .addIntegerOption(option => option.setName('amount').setDescription(`How many usernames to test. Max ${MAX_AMOUNT}`).setRequired(false).setMinValue(1).setMaxValue(MAX_AMOUNT))
    .addStringOption(option => option.setName('type').setDescription('Generation type').setRequired(false).addChoices(
      { name: 'rare mixed patterns', value: 'rare' },
      { name: 'letters only', value: 'letters' },
      { name: 'letters + numbers', value: 'letters_numbers' },
      { name: 'letters + numbers + underscore', value: 'mixed' }
    )),

  new SlashCommandBuilder()
    .setName('checklist')
    .setDescription('Check a custom list of usernames')
    .addStringOption(option => option.setName('usernames').setDescription('Example: zooz, z0oz, z_oo, abcd').setRequired(true)),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Check one username with detailed result')
    .addStringOption(option => option.setName('username').setDescription('Example: zooz').setRequired(true)),

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

    if (interaction.commandName === 'verify') {
      const username = cleanUsername(interaction.options.getString('username', true));
      if (!isValidUsername(username)) {
        await interaction.reply({ content: 'Username غير صالح. استخدم حروف/أرقام/نقطة/underscore فقط.', ephemeral: true });
        return;
      }
      await interaction.deferReply();
      const result = await checkUsernameStrict(username);
      await interaction.editReply({ embeds: [singleResultEmbed(result)] });
      return;
    }

    if (interaction.commandName === 'find') {
      const length = interaction.options.getInteger('length', true);
      const wanted = interaction.options.getInteger('wanted') || 3;
      const maxChecks = Math.min(interaction.options.getInteger('max_checks') || 40, MAX_FIND_CHECKS);
      const type = interaction.options.getString('type') || 'rare';

      await interaction.deferReply();
      const result = await findAvailableUsernames({ length, wanted, maxChecks, type });
      await interaction.editReply({ embeds: [findEmbed(result)] });
      return;
    }

    if (interaction.commandName === 'check') {
      const length = interaction.options.getInteger('length', true);
      const amount = interaction.options.getInteger('amount') || 15;
      const type = interaction.options.getString('type') || 'rare';

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
  return [...new Set(text.split(/[\s,،]+/g).map(cleanUsername).filter(isValidUsername))];
}

function cleanUsername(value) {
  return String(value || '').replace(/^@/, '').trim().toLowerCase();
}

function isValidUsername(username) {
  if (!username || username.length < 2 || username.length > 24) return false;
  if (!/^[a-z0-9._]+$/.test(username)) return false;
  if (username.startsWith('.') || username.endsWith('.')) return false;
  if (username.includes('..')) return false;
  return true;
}

function generateUniqueUsernames(length, amount, type, existing = new Set()) {
  const results = new Set();
  const maxAttempts = amount * 300;
  let attempts = 0;

  while (results.size < amount && attempts < maxAttempts) {
    attempts++;
    const username = makeCandidate(length, type);
    if (isValidUsername(username) && !existing.has(username)) results.add(username);
  }

  return [...results];
}

function makeCandidate(length, type) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const nums = '0123456789';

  if (type === 'letters') return randomFrom(letters, length);
  if (type === 'letters_numbers') return randomFrom(letters + nums, length);
  if (type === 'mixed') return randomFrom(letters + nums + '_', length);

  // rare mode: patterns that are more likely to be free than pure letters.
  if (length === 2) return randomFrom(letters + nums, 2);
  if (length === 3) {
    const patterns = [
      () => `${pick(letters)}_${pick(nums)}`,
      () => `${pick(nums)}_${pick(letters)}`,
      () => `${pick(letters)}${pick(nums)}_`,
      () => `${pick(nums)}${pick(letters)}${pick(nums)}`
    ];
    return pick(patterns)();
  }
  if (length === 4) {
    const patterns = [
      () => `${pick(letters)}_${pick(nums)}${pick(letters)}`,
      () => `${pick(letters)}${pick(nums)}_${pick(nums)}`,
      () => `${pick(nums)}_${pick(letters)}${pick(nums)}`,
      () => `${pick(letters)}${pick(nums)}${pick(letters)}${pick(nums)}`,
      () => `${pick(nums)}${pick(letters)}${pick(nums)}${pick(letters)}`,
      () => `${pick(letters)}_${pick(letters)}${pick(nums)}`
    ];
    return pick(patterns)();
  }

  return randomFrom(letters + nums + '_', length);
}

function pick(charsOrArray) {
  return charsOrArray[Math.floor(Math.random() * charsOrArray.length)];
}

function randomFrom(chars, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += pick(chars);
  return out;
}

async function checkMany(usernames) {
  const results = [];
  for (const username of usernames) {
    const result = await checkUsernameStrict(username);
    results.push(result);
    await sleep(CHECK_DELAY_MS);
  }
  return results;
}

async function findAvailableUsernames({ length, wanted, maxChecks, type }) {
  const seen = new Set();
  const available = [];
  const taken = [];
  const unknown = [];

  while (seen.size < maxChecks && available.length < wanted) {
    const batch = generateUniqueUsernames(length, 1, type, seen);
    if (!batch.length) break;

    const username = batch[0];
    seen.add(username);

    const result = await checkUsernameStrict(username);
    if (result.status === 'available') available.push(result);
    else if (result.status === 'taken') taken.push(result);
    else unknown.push(result);

    if (seen.size < maxChecks && available.length < wanted) await sleep(CHECK_DELAY_MS);
  }

  return { length, wanted, maxChecks, checked: seen.size, type, available, taken, unknown };
}

async function checkUsernameStrict(username) {
  const apiResult = await checkByDetailEndpoint(username);
  if (apiResult.status === 'taken') return apiResult;
  if (apiResult.status === 'available') return apiResult;

  const pageResult = await checkByProfilePage(username);
  if (pageResult.status === 'taken') return pageResult;
  if (pageResult.status === 'available') return pageResult;

  return { username, status: 'unknown', note: `${apiResult.note}; ${pageResult.note}` };
}

async function checkByDetailEndpoint(username) {
  const url = `https://www.tiktok.com/api/user/detail/?uniqueId=${encodeURIComponent(username)}`;

  try {
    const response = await fetchWithTimeout(url, { headers: defaultHeaders() });
    const text = await response.text().catch(() => '');
    const data = safeJson(text);

    if (!data) return { username, status: 'unknown', note: `detail invalid JSON HTTP ${response.status}` };

    const uniqueId = String(data?.userInfo?.user?.uniqueId || '').toLowerCase();
    const statusCode = data?.statusCode;
    const statusMsg = String(data?.statusMsg || '').toLowerCase();

    if (uniqueId === username.toLowerCase()) return { username, status: 'taken', note: 'detail endpoint exact match' };
    if (statusCode === 10202 || statusMsg.includes('user doesn')) return { username, status: 'available', note: 'detail endpoint not found' };
    if (response.status === 403 || response.status === 429) return { username, status: 'unknown', note: `detail blocked HTTP ${response.status}` };

    return { username, status: 'unknown', note: `detail unclear HTTP ${response.status}` };
  } catch (error) {
    return { username, status: 'unknown', note: error.name === 'AbortError' ? 'detail timeout' : 'detail failed' };
  }
}

async function checkByProfilePage(username) {
  const url = `https://www.tiktok.com/@${encodeURIComponent(username)}?lang=en`;

  try {
    const response = await fetchWithTimeout(url, { redirect: 'follow', headers: defaultHeaders() });
    const html = await response.text().catch(() => '');
    const lower = html.toLowerCase();
    const escaped = escapeRegExp(username.toLowerCase());

    const exactUniqueId = new RegExp(`"uniqueId"\\s*:\\s*"${escaped}"`, 'i').test(html);
    const exactCanonical = lower.includes(`/@${username.toLowerCase()}`);
    const notFoundCode = /"statusCode"\s*:\s*10202/i.test(html);
    const notFoundText = /couldn.?t find this account|account not found|user not found/i.test(html);
    const botBlocked = /captcha|verify to continue|access denied|login-title/i.test(lower) && html.length < 30000;

    if (exactUniqueId || exactCanonical) return { username, status: 'taken', note: 'profile page exact match' };
    if (response.status === 404 || notFoundCode || notFoundText) return { username, status: 'available', note: 'profile page not found' };
    if (response.status === 403 || response.status === 429 || botBlocked) return { username, status: 'unknown', note: `profile blocked/limited HTTP ${response.status}` };

    return { username, status: 'unknown', note: `profile unclear HTTP ${response.status}` };
  } catch (error) {
    return { username, status: 'unknown', note: error.name === 'AbortError' ? 'profile timeout' : 'profile failed' };
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function defaultHeaders() {
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    'accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache'
  };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function resultsEmbed(title, results) {
  const available = results.filter(x => x.status === 'available').map(formatUserWithNote);
  const taken = results.filter(x => x.status === 'taken').map(formatUserWithNote);
  const unknown = results.filter(x => x.status === 'unknown').map(formatUserWithNote);

  return new EmbedBuilder()
    .setTitle(`Zooz Username Checker — ${title}`)
    .setDescription('Strict mode: Available only appears when there is a clear not-found signal. Blocked or unclear results become Unknown.')
    .addFields(
      { name: `✅ Available (${available.length})`, value: block(available), inline: false },
      { name: `❌ Taken (${taken.length})`, value: block(taken), inline: false },
      { name: `⚠️ Unknown (${unknown.length})`, value: block(unknown), inline: false }
    )
    .setFooter({ text: `Delay: ${CHECK_DELAY_MS}ms | Max per command: ${MAX_AMOUNT}` })
    .setTimestamp();
}

function findEmbed(result) {
  const available = result.available.map(formatUserWithNote);
  const unknownSample = result.unknown.slice(0, 8).map(formatUserWithNote);

  return new EmbedBuilder()
    .setTitle('Zooz Finder — Available Results')
    .setDescription(`Checked ${result.checked}/${result.maxChecks}. Wanted ${result.wanted}. Length ${result.length}. Type ${result.type}.`)
    .addFields(
      { name: `✅ Found Available (${result.available.length})`, value: block(available), inline: false },
      { name: 'Scan summary', value: `❌ Taken: ${result.taken.length}\n⚠️ Unknown: ${result.unknown.length}`, inline: false },
      { name: 'Unknown sample', value: block(unknownSample), inline: false }
    )
    .setFooter({ text: 'Tip: 2 and 3 char usernames are almost always taken or reserved. Try length 4 rare mode.' })
    .setTimestamp();
}

function singleResultEmbed(result) {
  const icon = result.status === 'taken' ? '❌' : result.status === 'available' ? '✅' : '⚠️';
  return new EmbedBuilder()
    .setTitle(`${icon} @${result.username}`)
    .addFields(
      { name: 'Result', value: result.status.toUpperCase(), inline: true },
      { name: 'Reason', value: result.note || 'No note', inline: false }
    )
    .setTimestamp();
}

function helpEmbed() {
  return new EmbedBuilder()
    .setTitle('Zooz Bot Commands')
    .setDescription('بوت فحص يوزرات. استخدم /find إذا هدفك يطلع المتاح فقط بدل ما يعرض لك كل taken.')
    .addFields(
      { name: '/find', value: 'Search until available names are found. Example: `/find length:4 wanted:3 max_checks:60 type:rare`' },
      { name: '/verify', value: 'Check one username with detailed result. Example: `/verify username:zooz`' },
      { name: '/check', value: 'Generate random usernames and show all statuses. Example: `/check length:4 amount:15 type:rare`' },
      { name: '/checklist', value: 'Check your own list. Example: `/checklist usernames:zooz, z0oz, z_oo`' },
      { name: 'Railway variables', value: '`DISCORD_TOKEN`, `CLIENT_ID`, optional `GUILD_ID`, optional `CHECK_DELAY_MS`, optional `MAX_AMOUNT`, optional `MAX_FIND_CHECKS`' }
    );
}

function formatUserWithNote(result) {
  return `@${result.username} — ${result.note}`;
}

function block(items) {
  if (!items.length) return 'None';
  const text = items.slice(0, 20).join('\n');
  return text.length > 1024 ? text.slice(0, 1010) + '\n...' : text;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

client.login(TOKEN);
