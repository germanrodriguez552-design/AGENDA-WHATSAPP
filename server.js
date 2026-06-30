app.get("/api/activities", async (req, res) => {
  await db.read();
  res.json(db.data.activities);
});

// ----- Scheduler: revisa cada minuto si hay recordatorios que enviar -----
cron.schedule("* * * * *", async () => {
  await db.read();
  const ahora = new Date();

  for (const act of db.data.activities) {
    if (act.notified || act.done) continue;

    const fechaHora = new Date(`${act.date}T${act.time}:00`);
    const minutosFaltantes = (fechaHora - ahora) / 60000;

    if (
      minutosFaltantes <= act.alertMinutesBefore &&
      minutosFaltantes > act.alertMinutesBefore - 1
    ) {
      try {
        await twilioClient.messages.create({
          from: TWILIO_WHATSAPP_FROM,
          to: act.telefono,
          body: `🔔 Recordatorio: "${act.title}" empieza en ${act.alertMinutesBefore} minutos (${act.time}).`,
        });
        act.notified = true;
        await db.write();
        console.log(`Recordatorio enviado: ${act.title}`);
      } catch (err) {
        console.error("Error enviando recordatorio:", err.message);
      }
    }
  }
});

app.get("/", (req, res) => {
  res.send("✅ Servidor Agenda Personal corriendo correctamente con Groq (Llama 3 - Gratis)");
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

