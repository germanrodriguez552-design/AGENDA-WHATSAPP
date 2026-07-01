// server.js
// Backend de la Agenda Personal con WhatsApp (Twilio + Groq/Llama - GRATIS)
// ---------------------------------------------------------------

import express from "express";
import twilio from "twilio";
import Groq from "groq-sdk";
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
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
const groq = new Groq({ apiKey: GROQ_API_KEY });

// ----- Base de datos simple (archivo JSON) -----
const dbFile = path.join(__dirname, "db.json");
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { activities: [] });
await db.read();
db.data ||= { activities: [] };

// ----- App Express -----
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ----- Util: interpretar mensaje con Groq (Llama 3 - GRATIS) -----
async function interpretarMensaje(texto) {
  // Calcular fecha y hora actual en zona horaria de Honduras (CST = UTC-6)
  const ahora = new Date();
  const offsetHonduras = -6 * 60; // UTC-6 en minutos
  const localTime = new Date(ahora.getTime() + (offsetHonduras - ahora.getTimezoneOffset()) * 60000);
  const fechaHoy = localTime.toISOString().split("T")[0];
  const horaActual = localTime.toTimeString().slice(0, 5);

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    max_tokens: 300,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Eres un asistente que convierte mensajes en español sobre actividades o recordatorios en un objeto JSON.
La fecha de hoy es ${fechaHoy} y la hora actual es ${horaActual} (zona horaria Honduras, UTC-6).
Responde SOLO con JSON puro, sin texto adicional, sin backticks, sin explicaciones.
Si el mensaje es una actividad o recordatorio nuevo, responde con este formato exacto:
{"intent":"crear","title":"texto corto descriptivo","date":"YYYY-MM-DD","time":"HH:MM","alert_minutes_before":15}
Reglas importantes:
- Si dice "hoy", usa ${fechaHoy}
- Si dice "mañana", usa la fecha de mañana
- Convierte horas como "3pm"->15:00, "11am"->11:00, "10:05"->10:05
- Si dice "en X minutos", calcula la hora exacta sumando al tiempo actual
Si el mensaje es una consulta tipo "qué tengo hoy" o "mi agenda", responde:
{"intent":"consultar","scope":"hoy"}
Si no entiendes el mensaje, responde:
{"intent":"desconocido"}`,
      },
      {
        role: "user",
        content: texto,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "";
  const clean = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error("Error parseando JSON de Groq:", raw);
    return { intent: "error" };
  }
}

// ----- Webhook: Twilio llama aquí cada vez que el usuario escribe -----
app.post("/whatsapp/webhook", async (req, res) => {
  const textoUsuario = req.body.Body;
  const telefono = req.body.From;

  let respuesta = 'No entendí ese mensaje. Prueba: "Mañana 3pm llamar al doctor" o "¿Qué tengo hoy?"';

  try {
    const interpretado = await interpretarMensaje(textoUsuario);
    console.log("Interpretado:", JSON.stringify(interpretado));

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

      respuesta = `✅ Listo! Agregué: "${nueva.title}"\n📅 Fecha: ${nueva.date}\n⏰ Hora: ${nueva.time}\n🔔 Te aviso ${nueva.alertMinutesBefore} min antes.`;

    } else if (interpretado.intent === "consultar") {
      // Fecha de hoy en Honduras
      const ahora = new Date();
      const offsetHonduras = -6 * 60;
      const localTime = new Date(ahora.getTime() + (offsetHonduras - ahora.getTimezoneOffset()) * 60000);
      const hoy = localTime.toISOString().split("T")[0];

      const propias = db.data.activities.filter(
        (a) => a.telefono === telefono && a.date === hoy
      );
      if (propias.length === 0) {
        respuesta = "No tienes actividades programadas para hoy 🎉";
      } else {
        respuesta =
          "📋 Tu agenda de hoy:\n" +
          propias.map((a) => `⏰ ${a.time} — ${a.title}${a.done ? " ✅" : ""}`).join("\n");
      }
    } else if (interpretado.intent === "desconocido") {
      respuesta = 'No logré entender. Prueba: "Hoy 3pm llamar al doctor" o "¿Qué tengo hoy?"';
    }
  } catch (err) {
    console.error("Error en webhook:", err);
    respuesta = "Hubo un error. Intenta de nuevo en un momento.";
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(respuesta);
  res.type("text/xml").send(twiml.toString());
});

// ----- Endpoint para ver actividades desde el frontend web -----
app.get("/api/activities", async (req, res) => {
  await db.read();
  res.json(db.data.activities);
});

// ----- Scheduler: revisa cada minuto si hay recordatorios que enviar -----
// Usa zona horaria de Honduras (UTC-6)
cron.schedule("* * * * *", async () => {
  try {
    await db.read();

    // Hora actual en Honduras
    const ahora = new Date();
    const offsetHonduras = -6 * 60;
    const localTime = new Date(ahora.getTime() + (offsetHonduras - ahora.getTimezoneOffset()) * 60000);
    const fechaHoy = localTime.toISOString().split("T")[0];
    const horaActualMinutos = localTime.getHours() * 60 + localTime.getMinutes();

    console.log(`[Scheduler] Revisando recordatorios. Hora Honduras: ${localTime.toTimeString().slice(0,5)} (${horaActualMinutos} min)`);

    for (const act of db.data.activities) {
      if (act.notified || act.done) continue;
      if (act.date !== fechaHoy) continue; // Solo actividades de hoy

      const [h, m] = act.time.split(":").map(Number);
      const actMinutos = h * 60 + m;
      const minutosFaltantes = actMinutos - horaActualMinutos;

      console.log(`[Scheduler] "${act.title}" a las ${act.time} (${actMinutos} min) — faltan ${minutosFaltantes} min — alerta en ${act.alertMinutesBefore} min`);

      // Enviar aviso si faltan entre alertMinutesBefore y alertMinutesBefore-2 minutos
      // (ventana de 2 minutos para no perder el momento exacto)
      if (minutosFaltantes <= act.alertMinutesBefore && minutosFaltantes >= act.alertMinutesBefore - 2) {
        try {
          await twilioClient.messages.create({
            from: TWILIO_WHATSAPP_FROM,
            to: act.telefono,
            body: `🔔 Recordatorio: "${act.title}" empieza en ${minutosFaltantes} minutos (${act.time}).`,
          });
          act.notified = true;
          await db.write();
          console.log(`✅ Recordatorio enviado: ${act.title}`);
        } catch (err) {
          console.error("Error enviando recordatorio:", err.message);
        }
      }
    }
  } catch (err) {
    console.error("Error en scheduler:", err);
  }
}, {
  timezone: "America/Tegucigalpa"
});

app.get("/", (req, res) => {
  res.send("✅ Servidor Agenda Personal corriendo con Groq + zona horaria Honduras");
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
