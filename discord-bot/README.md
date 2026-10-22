# Voice Coach bot (example)

A Discord bot that sits in your voice channel and gives you private feedback while you talk.

- It listens only to the person who ran `/coach join`.
- It **never records or saves audio**. It keeps pitch numbers in memory until you leave.
- It sends feedback by DM:
  - Pitch drifting into the masculine range.
  - Strain: pitch above your comfort ceiling, frequent voice breaks, or a voice that sounds rougher than at the start.
  - Water reminders.
- When you leave, it DMs you a summary.
- It runs on your own computer. Audio goes from Discord to your computer and nowhere else.

> Discord doesn't officially support bots receiving voice audio. It works today, but a Discord update could break it until the libraries catch up.
> Let people in your calls know a bot is in the channel. It announces itself when it joins.

## Commands

| Command | What it does |
| --- | --- |
| `/coach join` | Joins your current voice channel and starts coaching you |
| `/coach leave` | Stops and DMs you the summary |
| `/coach status` | Shows your numbers so far (only you can see it) |
| `/coach settings` | Sets target, range boundaries, comfort ceiling and water reminder interval |

## Setup (about 10 minutes)

1. **Install Node.js 22.12 or newer** from nodejs.org.
2. **Create the bot**
   1. Go to https://discord.com/developers/applications and choose **New Application**.
   2. Under **General Information**, copy the **Application ID**.
   3. Under **Bot**, choose **Reset Token** and copy the token. Keep it secret.
3. **Invite it to your server.** Under **OAuth2 → URL Generator**:
   1. Tick the `bot` and `applications.commands` scopes.
   2. Tick the bot permissions **View Channels**, **Send Messages** and **Connect**.
   3. Open the generated link and pick your server.
4. **Configure.** In this folder, copy `.env.example` to `.env` and paste in the token and Application ID.
5. **Install and run**
   ```bash
   npm install
   npm run selftest
   npm start
   ```
   `npm run selftest` checks the pitch analysis without Discord. `npm start` should print "Voice coach is online".
6. **Try it.** Join a voice channel, type `/coach join`, and talk.
   - To get the DMs, allow direct messages from server members: Server name → Privacy Settings.
   - If DMs are off, the bot mentions you in the channel instead.

## Troubleshooting

- **`npm install` fails on a voice package:** run `npm install @discordjs/voice@latest @snazzah/davey@latest`. Discord's voice encryption changes now and then.
- **The bot joins but never reacts:** make sure you're not muted in Discord, and check the console for errors.
- **The commands don't show up:** restart the bot. Commands are registered for each server when it starts.

Settings are saved in `data/settings.json` on your computer. Delete that file to reset them.
