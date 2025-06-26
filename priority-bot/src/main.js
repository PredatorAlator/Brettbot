const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  WebhookClient,
  PermissionsBitField,
} = require("discord.js");
const fs = require("fs");
const cron = require("node-cron");
const { SlashCommandBuilder } = require("@discordjs/builders");
const path = require("path");

const config = require("./config");

const {
  clientId,
  guildId,
  token,
  webhookUrl,
  allowedRoles,
  roles,
} = config;

const dataFilePath = path.join(__dirname, "data.json");

let data = {};
if (fs.existsSync(dataFilePath)) {
  data = JSON.parse(fs.readFileSync(dataFilePath));
}

function saveData() {
  fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
}

// Dauer in ms parsen z.B. 1d, 12h, 30m
function parseDuration(duration) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error("Ungültiges Format");
  return parseInt(match[1]) * units[match[2]];
}

// Discord Timestamp Format <t:unixzeit:F>
function formatTimestampDiscord(ms) {
  return `<t:${Math.floor(ms / 1000)}:F>`;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL'], // Für DMs
});

const webhookClient = new WebhookClient({ url: webhookUrl });

const commands = [
  new SlashCommandBuilder()
    .setName("addelite")
    .setDescription("Fügt einem User die Elite-Mitgliedschaft hinzu")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("time").setDescription("Dauer (z.B. 1d, 12h, 30m)").setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("removeelite")
    .setDescription("Entfernt die Elite-Mitgliedschaft von einem User")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User").setRequired(true)
    )
    .toJSON(),
];

client.once("ready", async () => {
  console.log(`Logged in als ${client.user.tag}`);

  // Commands registrieren
  const { REST } = require("@discordjs/rest");
  const { Routes } = require("discord-api-types/v10");
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

  // Cronjob: jede Minute Ablauf prüfen
  cron.schedule("* * * * *", checkExpiredRoles);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const memberRoles = interaction.member.roles.cache.map((r) => r.id);
  if (!memberRoles.some((id) => allowedRoles.includes(id))) {
    return interaction.reply({ content: "Keine Berechtigung.", ephemeral: true });
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return interaction.reply({ content: "Server nicht gefunden.", ephemeral: true });

  if (interaction.commandName === "addelite") {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser("user");
    const durationStr = interaction.options.getString("time");

    let ms;
    try {
      ms = parseDuration(durationStr);
    } catch {
      return interaction.followUp({ content: "Ungültiges Zeitformat. Beispiel: 1d, 12h, 30m", ephemeral: true });
    }

    const member = await guild.members.fetch(user.id);
    const roleObj = guild.roles.cache.get(roles.find((r) => r.name.toLowerCase() === "elite")?.value);
    if (!roleObj) return interaction.followUp({ content: "Elite-Rolle nicht gefunden.", ephemeral: true });

    if (data[user.id]) {
      return interaction.followUp({ content: "Der User hat bereits eine Mitgliedschaft.", ephemeral: true });
    }

    try {
      await member.roles.add(roleObj);
    } catch {
      return interaction.followUp({ content: "Fehler beim Rollen hinzufügen.", ephemeral: true });
    }

    const expireDate = Date.now() + ms;
    data[user.id] = {
      roleId: roleObj.id,
      expireDate: new Date(expireDate).toISOString(),
    };
    saveData();

    // DM senden beim Hinzufügen
    const dmEmbed = new EmbedBuilder()
      .setColor("#e5aa74")
      .setDescription(
        `## <:Elite:1381322975260836003> | <@${user.id}> du bist nun **${roleObj.name}** Mitglied!\nㅤ\n` +
          `### - <a:Star:1340735768485691442> | Deine Vorteile sind jetzt freigeschaltet!\n` +
          `### - <a:calendar:1284497045524185088> | Die Rolle ist für ${formatTimestampDiscord(expireDate)} aktiv!\n` +
          `### - <a:smartphone:1383580606427955241> | Du wirst **automatisch benachrichtigt**, sobald deine **Mitgliedschaft** abläuft.\nㅤ\n` +
          `> **Danke für deine Unterstützung!** <a:Heart:1342996079544762418>\n` +
          `– **Vaelun** <:Vaelun:1381321540729180170>`
      );

    member.send({ embeds: [dmEmbed] }).catch(() => {
      console.log(`Konnte DM an ${user.tag} nicht senden.`);
    });

    webhookClient.send({
      username: "Mitgliedschafts-Log",
      avatarURL: client.user.displayAvatarURL(),
      embeds: [
        new EmbedBuilder()
          .setTitle("Mitgliedschaft hinzugefügt")
          .setColor("#e5aa74")
          .setDescription(
            `${roleObj.name} wurde <@${user.id}> für ${durationStr} zugewiesen von <@${interaction.user.id}>.`
          ),
      ],
    });

    return interaction.followUp({ content: `Mitgliedschaft wurde hinzugefügt.`, ephemeral: true });
  }

  if (interaction.commandName === "removeelite") {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser("user");
    const member = await guild.members.fetch(user.id);
    if (!data[user.id]) {
      return interaction.followUp({ content: "Der User hat keine Mitgliedschaft.", ephemeral: true });
    }

    const roleId = data[user.id].roleId;
    const roleObj = guild.roles.cache.get(roleId);
    if (!roleObj) {
      delete data[user.id];
      saveData();
      return interaction.followUp({ content: "Rolle existiert nicht mehr.", ephemeral: true });
    }

    try {
      await member.roles.remove(roleObj);
    } catch {
      return interaction.followUp({ content: "Fehler beim Rollen entfernen.", ephemeral: true });
    }

    // DM senden beim Entfernen
    const expireDate = new Date(data[user.id].expireDate).getTime();

    const dmEmbed = new EmbedBuilder()
      .setColor("#e5aa74")
      .setDescription(
        `## <:Elite:1381322975260836003> | <@${user.id}> deine ${roleObj.name} Mitgliedschaft ist abgelaufen.\nㅤ\n` +
          `### - <a:Lock:1340737256570490891> | Deine Vorteile wurden deaktiviert.\n` +
          `### - <a:calendar:1284497045524185088> | Um sie erneut freizuschalten, wiederhole den Kaufprozess.\nㅤ\n` +
          `> **Wir würden uns freuen, dich bald wieder als Elite Mitglied zu begrüßen!** <a:Heart:1342996079544762418>\n` +
          `– **Vaelun** <:Vaelun:1381321540729180170>`
      );

    member.send({ embeds: [dmEmbed] }).catch(() => {
      console.log(`Konnte DM an ${user.tag} nicht senden.`);
    });

    delete data[user.id];
    saveData();

    webhookClient.send({
      username: "Mitgliedschafts-Log",
      avatarURL: client.user.displayAvatarURL(),
      embeds: [
        new EmbedBuilder()
          .setTitle("Mitgliedschaft entfernt")
          .setColor("#e5aa74")
          .setDescription(
            `${roleObj.name} wurde von <@${user.id}> entfernt durch <@${interaction.user.id}>.`
          ),
      ],
    });

    return interaction.followUp({ content: "Mitgliedschaft wurde entfernt.", ephemeral: true });
  }
});

async function checkExpiredRoles() {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const now = Date.now();

  for (const userId of Object.keys(data)) {
    const entry = data[userId];
    if (!entry.expireDate) continue;
    if (new Date(entry.expireDate).getTime() <= now) {
      try {
        const member = await guild.members.fetch(userId);
        const role = guild.roles.cache.get(entry.roleId);
        if (role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role);

          // DM senden
          const dmEmbed = new EmbedBuilder()
            .setColor("#e5aa74")
            .setDescription(
              `## <:Elite:1381322975260836003> | <@${userId}> deine ${role.name} Mitgliedschaft ist abgelaufen.\nㅤ\n` +
                `### - <a:Lock:1340737256570490891> | Deine Vorteile wurden deaktiviert.\n` +
                `### - <a:calendar:1284497045524185088> | Um sie erneut freizuschalten, wiederhole den Kaufprozess.\nㅤ\n` +
                `> **Wir würden uns freuen, dich bald wieder als Elite Mitglied zu begrüßen!** <a:Heart:1342996079544762418>\n` +
                `– **Vaelun** <:Vaelun:1381321540729180170>`
            );

          await member.send({ embeds: [dmEmbed] }).catch(() => {
            console.log(`Konnte DM an ${member.user.tag} nicht senden.`);
          });

          delete data[userId];
          saveData();

          webhookClient.send({
            username: "Mitgliedschafts-Log",
            avatarURL: client.user.displayAvatarURL(),
            embeds: [
              new EmbedBuilder()
                .setTitle("Mitgliedschaft abgelaufen")
                .setColor("#e5aa74")
                .setDescription(`${role.name} Mitgliedschaft von <@${userId}> wurde automatisch entfernt.`),
            ],
          });
        }
      } catch (err) {
        console.log(`Fehler bei Prüfung Mitgliedschaft von ${userId}:`, err);
      }
    }
  }
}

client.login(token);
