// Voice coach bot: joins your voice channel, analyses only your voice, and DMs you gentle feedback.
// It never records or stores audio; only numbers are kept, in memory, until you leave.
import "dotenv/config";
import fs from "node:fs";
import {
  Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder, MessageFlags
} from "discord.js";
import { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus, entersState } from "@discordjs/voice";
import prism from "prism-media";
import { VoiceTracker, noteName } from "./pitch.js";

const { DISCORD_TOKEN, CLIENT_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID. Copy .env.example to .env and fill them in (see README.md).");
  process.exit(1);
}

// Per-user settings, saved to a local file on this computer
const DATA_DIR = new URL("../data/", import.meta.url);
const SETTINGS_FILE = new URL("settings.json", DATA_DIR);
const DEFAULTS = { target: 190, lowCut: 145, highCut: 175, ceiling: 240, waterMin: 15 };
let saved = {};
try { saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { /* first run */ }
const settingsFor = id => ({ ...DEFAULTS, ...(saved[id] || {}) });
function saveSettings(id, patch) {
  saved[id] = { ...settingsFor(id), ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(saved, null, 2));
}

const command = new SlashCommandBuilder()
  .setName("coach").setDescription("Voice feminization coach")
  .addSubcommand(s => s.setName("join").setDescription("Join your voice channel and coach only you"))
  .addSubcommand(s => s.setName("leave").setDescription("Stop coaching and get your session summary"))
  .addSubcommand(s => s.setName("status").setDescription("See your numbers so far (only you can see this)"))
  .addSubcommand(s => s.setName("settings").setDescription("Set your target pitch, ranges and reminders")
    .addIntegerOption(o => o.setName("target").setDescription("Target pitch in Hz").setMinValue(100).setMaxValue(350))
    .addIntegerOption(o => o.setName("androgynous_from").setDescription("Androgynous range starts at (Hz)").setMinValue(80).setMaxValue(300))
    .addIntegerOption(o => o.setName("feminine_from").setDescription("Feminine range starts at (Hz)").setMinValue(90).setMaxValue(350))
    .addIntegerOption(o => o.setName("ceiling").setDescription("Warn when pitch stays above this (Hz)").setMinValue(150).setMaxValue(500))
    .addIntegerOption(o => o.setName("water_minutes").setDescription("Water reminder every N minutes of talking (0 = off)").setMinValue(0).setMaxValue(120)));

const sessions = new Map();   // guildId -> active coaching session
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const rest = new REST().setToken(DISCORD_TOKEN);

// Guild commands appear instantly (global ones can take up to an hour)
const register = guildId => rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: [command.toJSON()] })
  .catch(e => console.warn(`Couldn't register /coach in server ${guildId}: ${e.message}`));

client.once(Events.ClientReady, async c => {
  for (const g of c.guilds.cache.values()) await register(g.id);
  console.log(`Voice coach is online as ${c.user.tag} in ${c.guilds.cache.size} server(s).`);
});
client.on(Events.GuildCreate, g => register(g.id));

// DM the user; if their DMs are closed, mention them in the channel where they started
async function notify(s, message) {
  try { await s.user.send(message); }
  catch {
    const m = typeof message === "string" ? { content: `<@${s.userId}> ${message}` } : { content: `<@${s.userId}>`, ...message };
    await s.textChannel?.send(m).catch(() => {});
  }
}

function summaryEmbed(s, title) {
  const x = s.tracker.summary(), st = s.tracker.s;
  const e = new EmbedBuilder().setColor(0xC2417A).setTitle(title)
    .setFooter({ text: `Target ${st.target} Hz (${noteName(st.target)}) · numbers only, no audio was recorded` });
  if (!x) return e.setDescription("I didn't hear enough of your voice to measure yet.");
  return e.addFields(
    { name: "Average", value: `${x.avg} Hz (${x.note})`, inline: true },
    { name: "Usual range", value: `${x.p10}–${x.p90} Hz`, inline: true },
    { name: "Feminine range", value: `${x.fem}% of the time`, inline: true },
    { name: "Talking time", value: `${x.voicedMin} min of ${x.minutes} min`, inline: true },
    { name: "Clarity", value: `${x.clarityStart} → ${x.clarityEnd}`, inline: true },
    { name: "Voice breaks", value: `${x.breaksPerMin}/min`, inline: true },
    { name: "Next time", value: tipFor(x, st) }
  );
}
function tipFor(x, st) {
  if (x.clarityEnd < x.clarityStart - 12) return "Your voice got rougher as you went. Drink water before calls and take short breaks.";
  if (x.breaksPerMin >= 2) return "Lots of voice breaks. Warm up with lip trills and ease the pitch down a little.";
  if (x.avg < st.lowCut) return `Start calls by humming on ${noteName(st.target)} and speaking your first words from there.`;
  if (x.p10 < st.lowCut) return "Your pitch dipped at times, often at sentence endings or when laughing. Keep air flowing to the last word.";
  return "Nice work. Keep it relaxed and let resonance do the work.";
}

function listen(s) {
  if (s.stream) return;
  const opus = s.connection.receiver.subscribe(s.userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 } });
  const pcm = opus.pipe(new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 }));
  s.stream = opus;
  pcm.on("data", buf => s.tracker.pushPcm16(buf));
  pcm.on("error", e => console.warn("Audio decode problem:", e.message));
  const done = () => { if (s.stream === opus) { s.stream = null; s.tracker.silence(); } };
  opus.once("end", done);
  opus.once("close", done);
}

async function endSession(guildId, why) {
  const s = sessions.get(guildId);
  if (!s) return;
  sessions.delete(guildId);
  clearInterval(s.timer);
  try { s.connection.destroy(); } catch { /* already gone */ }
  await notify(s, { embeds: [summaryEmbed(s, `Voice session summary${why ? ` (${why})` : ""}`)] });
}

client.on(Events.InteractionCreate, async i => {
  if (!i.isChatInputCommand() || i.commandName !== "coach") return;
  const sub = i.options.getSubcommand();
  const s = sessions.get(i.guildId);

  if (sub === "join") {
    const vc = i.member?.voice?.channel;
    if (!vc) return i.reply({ content: "Join a voice channel first, then run `/coach join`.", flags: MessageFlags.Ephemeral });
    if (s) return i.reply({ content: `I'm already coaching <@${s.userId}> in this server. They can use \`/coach leave\` first.`, flags: MessageFlags.Ephemeral });
    await i.deferReply();
    const connection = joinVoiceChannel({ channelId: vc.id, guildId: i.guildId, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
    try { await entersState(connection, VoiceConnectionStatus.Ready, 20000); }
    catch {
      connection.destroy();
      return i.editReply("I couldn't connect to that voice channel. Check that I have the Connect permission there.");
    }
    const session = {
      userId: i.user.id, user: i.user, connection, textChannel: i.channel,
      tracker: new VoiceTracker(settingsFor(i.user.id)), stream: null
    };
    sessions.set(i.guildId, session);
    connection.receiver.speaking.on("start", id => { if (id === session.userId) listen(session); });
    connection.on(VoiceConnectionStatus.Disconnected, () => endSession(i.guildId, "disconnected"));
    session.timer = setInterval(() => { for (const msg of session.tracker.alerts()) notify(session, msg); }, 5000);
    const st = session.tracker.s;
    await i.editReply(`🎙️ Voice coach is listening to **${i.user.displayName}** only in **${vc.name}**. ` +
      `No audio is recorded or saved; I only keep pitch numbers until you leave. ` +
      `Target ${st.target} Hz (${noteName(st.target)}). Feedback comes by DM. Use \`/coach leave\` to stop.`);
    return;
  }

  if (sub === "leave") {
    if (!s || s.userId !== i.user.id) return i.reply({ content: "I'm not coaching you in this server right now.", flags: MessageFlags.Ephemeral });
    await i.reply({ content: "Stopping. Your summary is on its way by DM.", flags: MessageFlags.Ephemeral });
    return endSession(i.guildId);
  }

  if (sub === "status") {
    if (!s || s.userId !== i.user.id) return i.reply({ content: "No active session. Start one with `/coach join`.", flags: MessageFlags.Ephemeral });
    return i.reply({ embeds: [summaryEmbed(s, "So far this session")], flags: MessageFlags.Ephemeral });
  }

  if (sub === "settings") {
    const patch = {};
    const map = { target: "target", androgynous_from: "lowCut", feminine_from: "highCut", ceiling: "ceiling", water_minutes: "waterMin" };
    for (const [opt, key] of Object.entries(map)) { const v = i.options.getInteger(opt); if (v != null) patch[key] = v; }
    const next = { ...settingsFor(i.user.id), ...patch };
    if (next.highCut <= next.lowCut) return i.reply({ content: "The feminine range has to start above the androgynous range.", flags: MessageFlags.Ephemeral });
    saveSettings(i.user.id, patch);
    if (s && s.userId === i.user.id) s.tracker.setSettings(patch);
    return i.reply({
      content: `Saved. Target **${next.target} Hz** (${noteName(next.target)}), masculine under ${next.lowCut} Hz, feminine from ${next.highCut} Hz, ` +
        `warning above ${next.ceiling} Hz, water every ${next.waterMin || "—"} min${next.waterMin ? "" : " (off)"}.`,
      flags: MessageFlags.Ephemeral
    });
  }
});

// If you leave or switch voice channels, end the session and send the summary
client.on(Events.VoiceStateUpdate, (before, after) => {
  const s = sessions.get(after.guild.id);
  if (s && after.id === s.userId && after.channelId !== s.connection.joinConfig.channelId) endSession(after.guild.id, "you left the channel");
});

process.on("SIGINT", async () => {
  for (const id of [...sessions.keys()]) await endSession(id, "bot shutting down");
  client.destroy(); process.exit(0);
});

client.login(DISCORD_TOKEN);
