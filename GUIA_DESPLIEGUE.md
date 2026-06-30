# Guía de despliegue — Agenda Personal con WhatsApp

Sigue estos pasos en orden. No necesitas experiencia previa.

## 1. Twilio (ya hecho si seguiste el chat)
- Cuenta creada en twilio.com
- Sandbox de WhatsApp activado (le mandaste "join xxxx-xxxx" al número de Twilio desde tu WhatsApp)
- Tienes a mano: **Account SID** y **Auth Token** (están en el Dashboard principal de Twilio)

## 2. Obtener tu API key de Claude (Anthropic)
1. Ve a console.anthropic.com y crea una cuenta.
2. Ve a "API Keys" → "Create Key".
3. Copia esa clave (empieza con `sk-ant-...`). La necesitarás en el paso 4.

## 3. Subir el código a GitHub
1. Crea una cuenta en github.com si no tienes.
2. Crea un repositorio nuevo, por ejemplo "agenda-whatsapp".
3. Sube la carpeta `backend` completa (server.js, package.json, .env.example).
   - Más fácil: en GitHub, usa el botón "Add file → Upload files" y arrastra los archivos.

## 4. Desplegar en Render.com (gratis)
1. Ve a render.com → "New +" → "Web Service".
2. Conecta tu cuenta de GitHub y selecciona el repositorio que subiste.
3. Configuración:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Plan:** Free
4. En la sección "Environment Variables", agrega estas 4 (copiándolas de tu .env):
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_WHATSAPP_FROM` (ej: `whatsapp:+14155238886`)
   - `ANTHROPIC_API_KEY`
5. Haz clic en "Create Web Service" y espera a que despliegue (2-3 minutos).
6. Cuando termine, Render te da una URL pública, algo como:
   `https://agenda-whatsapp.onrender.com`

## 5. Conectar Twilio con tu servidor (el paso clave)
1. Vuelve al panel de Twilio → "Messaging" → "Try it out" → "WhatsApp Sandbox Settings".
2. En el campo **"WHEN A MESSAGE COMES IN"**, pega tu URL de Render seguida de `/whatsapp/webhook`:
   `https://agenda-whatsapp.onrender.com/whatsapp/webhook`
3. Método: `HTTP POST`.
4. Guarda los cambios.

## 6. ¡Probar!
Desde tu WhatsApp (el mismo que conectaste al sandbox), escribe:
> "Mañana 3pm llamar al doctor"

Deberías recibir una respuesta confirmando que se agregó. Luego, 15 minutos antes de la hora (o lo que configures), te llegará el recordatorio automático.

Para preguntar tu agenda, escribe:
> "¿Qué tengo hoy?"

## Notas importantes
- El **sandbox de Twilio es gratis pero solo te escribe a ti** (el número que se unió). Para que cualquier persona pueda usar tu agenda, más adelante necesitas solicitar un número de WhatsApp Business oficial (proceso de aprobación de Meta, tarda unos días).
- La base de datos usada aquí (`lowdb`, un archivo `db.json`) es solo para empezar rápido. En Render (plan gratis), el almacenamiento se reinicia si el servicio se "duerme" por inactividad. Para producción real, te recomiendo migrar a una base de datos como **Supabase** (gratis, PostgreSQL) — puedo ayudarte con ese cambio cuando quieras.
- El plan gratuito de Render "duerme" el servidor tras 15 min sin uso, así que el primer mensaje después de inactividad puede tardar unos segundos extra en responder.
