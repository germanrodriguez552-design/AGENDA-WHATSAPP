// server.js
// Backend de la Agenda Personal con WhatsApp (Twilio + Claude)
// ---------------------------------------------------------------

import express from "express";
import twilio from "twilio";
import Anthropic from "@anthropic-ai/sdk";
import cron from "node-cron";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ----- Configuración -----
const PORT = process.env.PORT || 3000;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // ej: "whatsapp:+14155238886"
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ----- Base de datos simple (archivo JSON) -----
const dbFile = path.join(__dirname, "db.json");
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { activities: [] });
await db.read();
db.data ||= { activities: [] };

// ----- App Express -----
const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio manda form-urlencoded
app.use(express.json());

// ----- Util: interpretar mensaje con Claude -----
async function interpretarMensaje(texto, telefono) {
  const ahora = new Date();
  const fechaHoy = ahora.toISOString().split("T")[0];

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: `Eres un asistente que convierte mensajes en español sobre actividades/recordatorios
en un objeto JSON. La fecha de hoy es ${fechaHoy}. Responde SOLO con JSON, sin texto adicional,
sin backticks. Formato exacto:
{"title": "string corto", "date": "YYYY-MM-DD", "time": "HH:MM" (24h), "alert_minutes_before": number}
Si el usuario no especifica fecha, asume hoy. Si no especifica minutos de aviso, usa 15.
Si el mensaje no es una actividad/recordatorio sino una pregunta tipo "¿qué tengo hoy?",
responde: {"intent": "consultar", "scope": "hoy|semana|manana"}.
Si es una actividad nueva, incluye "intent": "crear" en el JSON también.`,
    messages: [{ role: "user", content: texto }],
  });

  const raw = msg.content[0].text.trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { intent: "error" };
  }
}

// ----- Webhook: Twilio llama aquí cada vez que el usuario escribe -----
app.post("/whatsapp/webhook", async (req, res) => {
  const textoUsuario = req.body.Body;
  const telefono = req.body.From; // ej: "whatsapp:+5049xxxxxxx"

  let respuesta = "No entendí ese mensaje, intenta de nuevo 🙏";

  try {
    const interpretado = await interpretarMensaje(textoUsuario, telefono);

    if (interpretado.intent === "crear") {
      const nueva = {
        id: Date.now().toString(),
        telefono,
        title: interpretado.title,
        date: interpretado.date,
        time: interpretado.time,
        alertMinutesBefore: interpretado.alert_minutes_before || 15,
        done: false,
        notified: false,
      };
      db.data.activities.push(nueva);
      await db.write();

      respuesta = `✅ Agregado: "${nueva.title}"\n📅 ${nueva.date} ⏰ ${nueva.time}\nTe aviso ${nueva.alertMinutesBefore} min antes.`;
    } else if (interpretado.intent === "consultar") {
      const hoy = new Date().toISOString().split("T")[0];
      const propias = db.data.activities.filter((a) => a.telefono === telefono && a.date === hoy);
      if (propias.length === 0) {
        respuesta = "No tienes actividades programadas para hoy 🎉";
      } else {
        respuesta =
          "📋 Tu agenda de hoy:\n" +
          propias.map((a) => `⏰ ${a.time} - ${a.title}`).join("\n");
      }
    } else {
      respuesta =
        'No logré entender tu mensaje. Prueba algo como: "Mañana 3pm llamar al doctor" o "¿Qué tengo hoy?"';
    }
  } catch (err) {
    console.error(err);
    respuesta = "Hubo un error procesando tu mensaje. Intenta de nuevo.";
  }

  // Responder usando TwiML
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(respuesta);
  res.type("text/xml").send(twiml.toString());
});

// ----- Endpoint simple para ver actividades desde el frontend web -----
app.get("/api/activities", async (req, res) => {
  await db.read();
  res.json(db.data.activities);
});

// ----- Scheduler: revisa cada minuto si hay que enviar recordatorios -----
cron.schedule("* * * * *", async () => {
  await db.read();
  const ahora = new Date();

  for (const act of db.data.activities) {
    if (act.notified || act.done) continue;

    const fechaHora = new Date(`${act.date}T${act.time}:00`);
    const minutosFaltantes = (fechaHora - ahora) / 60000;

    if (minutosFaltantes <= act.alertMinutesBefore && minutosFaltantes > act.alertMinutesBefore - 1) {
      try {
        await twilioClient.messages.create({
          from: TWILIO_WHATSAPP_FROM,
          to: act.telefono,
          body: `🔔 Recordatorio: "${act.title}" empieza en ${act.alertMinutesBefore} minutos (${act.time}).`,
        });
        act.notified = true;
        await db.write();
        console.log(`Recordatorio enviado para: ${act.title}`);
      } catch (err) {
        console.error("Error enviando recordatorio:", err.message);
      }
    }
  }
});

app.get("/", (req, res) => {
  res.send("Servidor de Agenda Personal corriendo correctamente ✅");
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
