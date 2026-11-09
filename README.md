# 🛡️ AirProtect

Bot anti-raid / anti-nuke / anti-spam hecho a medida para un solo server (`1566683072953323611`). Si lo meten en otro server, se sale solo.

## Qué hace

**Anti-spam**
- 15 mensajes en 10 s → silencio de **60 s** (oportunidad 1/3), otra vez 60 s (2/3), otra vez 60 s (3/3).
- A la 4ª vez → **5 minutos**. Las oportunidades se reinician tras 1 hora sin spam.
- Borra los mensajes del spam, avisa por DM y lo registra en el canal de logs.
- Menciones masivas (5+ en un mensaje) cuentan como spam.
- Borra invitaciones de otros servers (`ANTI_INVITE=false` para apagarlo).
- Webhooks que spamean (8 mensajes en 5 s) se eliminan.

**Honeypot (canal trampa)**
- El bot crea `🚫・no-escribir` (o usa `HONEYPOT_CHANNEL_ID`). Quien escriba ahí → mensaje borrado + **silencio de 5 min** + log. Atrapa bots de spam y selfbots.

**Anti-nuke** (lee el registro de auditoría en tiempo real)
- **Bot añadido por alguien sin whitelist → expulsado al instante** y el que lo añadió es castigado.
- **Bot sin whitelist que borre/cree/banee/expulse cualquier cosa → le quita permisos y lo banea a la primera.**
- Humanos sin whitelist que se pasen del límite (2 canales borrados, 2 roles borrados, 3 baneos, 4 kicks... en 15 s) → se les quitan los roles y se aíslan 28 días (o ban con `NUKE_HUMAN_PUNISHMENT=ban`).
- **Restaura** canales borrados (con permisos y categoría) y roles borrados (con permisos y **devolviéndoselos a los miembros**). Los roles **Boy** y **Girl** guardan su lista de miembros en disco.
- Revierte: permisos peligrosos dados a un rol, roles con permisos peligrosos dados a alguien, cambio de nombre del server, baneos hechos por el nuker, canales/roles spameados.
- Borra webhooks creados por gente sin whitelist; los prunes masivos se castigan al instante.

**Anti-raid**
- 8 entradas en 10 s → **modo raid** 10 min: se expulsan cuentas con menos de 7 días.
- `MIN_ACCOUNT_AGE_DAYS` para exigir edad mínima siempre.

**Tickets**
- Panel con botón 🎫 en el canal de tickets (se envía solo al arrancar si no existe).
- Crea `username-01`, `username-02`... en la categoría de tickets (número más bajo libre). 1 ticket abierto por persona.
- Mensaje automático mencionando al usuario + @Manager, @own y @Soporte, con botones **Atender** y **Close**.
- Solo el staff puede cerrar: sale un formulario (solo tú lo ves) para el motivo; luego "se elimina en 5 segundos" y llega al canal de logs: Ticket, Creator, Closed By, Reason + transcript `.txt`.

**Bienvenida**
- `@usuario **Bienvenid@ a 0km** :hola:` + imagen con su banner de fondo, su foto al centro y su DisplayName en blanco.

**Boosts**
- Cuando alguien boostea: `@usuario acaba de boostear el server 💎` + tarjeta Nitro (aro brillante rosa/morado, destellos, banner, nombre y "N boosts • Nivel X") en el canal de boosts.

**Warns** (staff: own, Manager, Soporte)
- `/warn @user mensaje` → DM al usuario con el motivo, aviso en el canal y log. 3 warns = aislado 1 h, 5 warns = aislado 1 día.
- `/warns @user` para ver su historial, `/clearwarns @user` para borrarlo. Se reconstruyen desde los logs si Render reinicia.

**Charla `!mg`**
- `!mg como andas we` → el bot responde (reply) con personalidad de compa. Usa modelos gratis de OpenRouter (los detecta solo y cambia de modelo si uno falla). Recuerda la plática reciente del canal. Cooldown de 5 s por usuario.
- Variables: `OPENROUTER_API_KEY` (obligatoria), `MG_CHANNEL_ID` (opcional), `MG_MODEL` (opcional).

**Logs del servidor** (canal privado del staff)
- Entradas (edad de cuenta + qué invitación usó y de quién) y salidas (desde cuándo estaba + sus roles).
- Roles dados/quitados, roles creados/editados/borrados (nombre, color, icono, emoji, permisos), canales y permisos de canal, emojis, stickers, invitaciones, webhooks, hilos, cambios del server.
- Expulsiones, baneos, aislamientos, apodos, avatares, nombres de usuario, boosts.
- Mensajes borrados (y quién los borró si fue un mod), editados (antes/después), borrados en masa (.txt).
- Voz: entró, salió, cambió de canal, transmitió, movidos/desconectados por mods.
- Siempre dice **quién** hizo cada cosa.

**`!vc time`**
- `!vc time` (o `!vc time @user`) → embed con cuánto tiempo llevas en vc + el canal + una nota troll según el tiempo. Se borra a los 13 s.

**`/mj mensaje`** (roles altos)
- El bot dice el mensaje en el canal sin mostrar quién lo mandó. El comando es oculto (nadie ve que lo usaste). Sin @everyone/@here. Queda registrado en los logs de AirProtect.

**Contador en vivo**
- En el canal de stats el bot mantiene un mensaje (sin embed) con: @Boy 0km -> N, @Girl 0km -> N, Miembros Total y Online. Se edita cada 5 s si algo cambió.

**Comandos** (solo dueño + whitelist): `/whitelist add|remove|list`, `/lockdown`, `/unlock`, `/raidmode on|off`, `/strikes`, `/resetstrikes`, `/status`.

## Configurar el bot en Discord

1. [Developer Portal](https://discord.com/developers/applications) → tu app → **Bot**:
   - Activa **SERVER MEMBERS INTENT** y **MESSAGE CONTENT INTENT**.
   - Reset Token y cópialo.
2. Invítalo con permiso de **Administrador**:
   `https://discord.com/oauth2/authorize?client_id=TU_CLIENT_ID&permissions=8&scope=bot%20applications.commands`
3. **Muy importante:** en Ajustes del server → Roles, arrastra el rol de AirProtect **arriba del todo**. Un bot solo puede frenar a quien esté por debajo de él.
4. Roles de confianza ya configurados: **own**, **Manager** y **Bots** (nadie con esos roles es castigado). Si alguien sin confianza intenta dar uno de esos roles, se le quita al instante.
5. Haz `/whitelist add` a los bots y staff de confianza (MEE6, tus mods, etc.). Todo lo que no esté en whitelist es tratado como sospechoso.

## Deploy en Render

1. Sube este repo a GitHub.
2. Render → **New → Web Service** → elige el repo.
   - Build: `npm install` · Start: `npm start` · Plan: Free
3. Environment → añade `DISCORD_TOKEN` y `OWNER_IDS` (tu ID).
4. Copia la URL que te da Render (`https://airprotect-xxxx.onrender.com`).

## UptimeRobot (para que no se duerma)

1. [uptimerobot.com](https://uptimerobot.com) → **Add New Monitor** → tipo **HTTP(s)**.
2. URL: la de Render. Intervalo: **5 minutos**.

> Render free borra el disco en cada redeploy: los strikes y la whitelist hecha con `/whitelist` se pierden. Pon tu staff fijo en `WHITELIST_IDS` para que siempre esté.

## Local

```bash
npm install
cp .env.example .env   # pon tu token
npm start
```
