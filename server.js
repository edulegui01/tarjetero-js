require("dotenv").config();

const crypto = require("crypto");
const dgram = require("dgram");
const express = require("express");
const multer = require("multer");
const path = require("path");
const { parseEvent, isStale } = require("./eventParser");
const { DebounceGuard } = require("./debounce");
const { HikvisionClient } = require("./hikvisionClient");
const { TsmContasClient } = require("./tsmContasClient");
const paramsStore = require("./paramsStore");
const carouselStore = require("./carouselStore");
const { logError, formatLocalTimestamp } = require("./logger");
const { renderAdminPage } = require("./adminView");

const IMAGE_EXT_BY_MIMETYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const carouselUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, Boolean(IMAGE_EXT_BY_MIMETYPE[file.mimetype]));
  },
});

// Secretos y datos de conexión: fijos al arrancar, viven en .env, nunca se
// exponen ni se editan desde /admin.
const envConfig = {
  port: parseInt(process.env.PORT || "8091", 10),
  webhookPath: process.env.WEBHOOK_PATH || "/webhook/nfc",
  hikvisionIp: process.env.HIKVISION_IP || "192.0.0.64",
  hikvisionPort: parseInt(process.env.HIKVISION_PORT || "80", 10),
  hikvisionUser: process.env.HIKVISION_USER || "admin",
  hikvisionPassword: process.env.HIKVISION_PASSWORD || "",
  // IP de este servidor tal como la tiene que ver la placa para mandarle los
  // eventos. Si no se fija a mano, se autodetecta preguntándole al SO por
  // qué IP local saldría un paquete hacia la placa (ver ipRoutedTo) -- sirve
  // para casi todos los casos aunque haya VPNs o adaptadores virtuales de
  // por medio. Dejar en blanco salvo que esa autodetección falle.
  serverIp: process.env.SERVER_IP || "",
  tsmApiHost: process.env.TSM_API_HOST || "",
  tsmApiPort: parseInt(process.env.TSM_API_PORT || "80", 10),
  tsmUsuario: process.env.TSM_USUARIO || "",
  tsmSenha: process.env.TSM_SENHA || "",
  adminUser: process.env.ADMIN_USER || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
};

// Parámetros operativos: editables en caliente desde /admin (ver paramsStore.js).
function getParams() {
  return paramsStore.getAll();
}

const hikvisionClient = new HikvisionClient({
  ip: envConfig.hikvisionIp,
  port: envConfig.hikvisionPort,
  username: envConfig.hikvisionUser,
  password: envConfig.hikvisionPassword,
});

const tsmContasClient = new TsmContasClient({
  host: envConfig.tsmApiHost,
  port: envConfig.tsmApiPort,
  usuario: envConfig.tsmUsuario,
  senha: envConfig.tsmSenha,
});

const debounceGuard = new DebounceGuard();

// Con qué IP local saldría un paquete dirigido a `host` según la tabla de
// ruteo del sistema operativo. No manda nada: un socket UDP "conectado" solo
// hace que el SO resuelva la ruta y asigne IP local, sin tráfico de red real.
// Evita tener que adivinar entre las interfaces de red -- en una máquina con
// Wi-Fi, VPNs y adaptadores virtuales (WSL, etc.) elegir "la primera IPv4 no
// interna" a menudo da una interfaz que no es la que realmente llega a la
// placa.
function ipRoutedTo(host) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", () => {
      socket.close();
      resolve(null);
    });
    socket.connect(80, host, () => {
      const address = socket.address().address;
      socket.close();
      resolve(address);
    });
  });
}

// Elige con qué IP se anuncia este servidor ante la placa. Si SERVER_IP está
// fijada a mano en .env, se usa esa sin más. Si no, se autodetecta con
// ipRoutedTo (ver arriba).
async function detectServerIp(hikvisionIp) {
  if (envConfig.serverIp) return envConfig.serverIp;
  return ipRoutedTo(hikvisionIp);
}

// Registra este servidor como httpHost en la placa (ver README, "Registrar
// el webhook en la placa"). Antes era un paso manual con curl/Postman; se
// repite automáticamente en cada arranque para no depender de que alguien
// se acuerde de hacerlo tras reinstalar, cambiar de IP, o un reset de la
// placa. Reintenta unas veces por si la placa/red todavía no está lista
// (arranque simultáneo de ambas), pero nunca bloquea ni tira abajo el
// servidor -- si falla, el resto sigue funcionando y queda logueado.
async function registerWebhookOnBoard() {
  const serverIp = await detectServerIp(envConfig.hikvisionIp);
  if (!serverIp) {
    logError(
      "No se pudo determinar la IP de este servidor para registrar el webhook en la placa (fijala a mano con SERVER_IP en .env)",
      new Error("sin interfaces IPv4 no internas"),
    );
    return;
  }

  const attempts = 5;
  const delayMs = 5000;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const previous = await hikvisionClient
        .getWebhookRegistration()
        .catch(() => null);
      if (previous && !previous.includes(`<ipAddress>${serverIp}</ipAddress>`)) {
        console.warn(
          "El slot de webhook de la placa apunta a otra cosa antes de registrarnos -- si hay otro sistema usándolo, coordinar antes de asumir que está roto (ver README).",
        );
      }

      await hikvisionClient.registerWebhook({
        serverIp,
        serverPort: envConfig.port,
        webhookPath: envConfig.webhookPath,
      });
      console.log(
        `Webhook registrado en la placa ${envConfig.hikvisionIp}: http://${serverIp}:${envConfig.port}${envConfig.webhookPath}`,
      );
      return;
    } catch (err) {
      logError(
        `Intento ${attempt}/${attempts} de registrar el webhook en la placa falló`,
        err,
      );
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  console.warn(
    "No se pudo registrar el webhook en la placa tras varios intentos -- registralo a mano (ver README) o reiniciá el servidor cuando la placa esté disponible.",
  );
}

// El reloj de la placa no está en NTP (su servidor NTP de fábrica apunta a
// una IP que no existe en esta red, y la placa no tiene DNS habilitado), así
// que deriva sola. Importa porque `isStale` compara el dateTime que escribe
// la placa contra el reloj de este servidor: con la placa atrasada más de
// `maxEventAgeSeconds`, las lecturas legítimas se descartan por "viejas" y
// el tótem deja de reaccionar. En vez de depender de un NTP externo, este
// servidor le pone la hora a la placa -- misma idea que el autoregistro del
// webhook: no depender de que alguien se acuerde de hacerlo a mano.
const CLOCK_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Desfase tolerado antes de corregir. No vale la pena escribirle a la placa
// por una diferencia de un segundo, que es además el error de medición (su
// localTime no trae milisegundos).
const MAX_CLOCK_DRIFT_SECONDS = 2;

async function syncBoardClock() {
  try {
    const { localTime, timeZone } = await hikvisionClient.getTime();
    const boardTimeMs = Date.parse(localTime);
    if (Number.isNaN(boardTimeMs)) {
      logError(
        "No se pudo interpretar la hora de la placa",
        new Error(`localTime=${localTime}`),
      );
      return;
    }

    const driftSeconds = (Date.now() - boardTimeMs) / 1000;
    if (Math.abs(driftSeconds) <= MAX_CLOCK_DRIFT_SECONDS) {
      console.log(
        `Reloj de la placa en hora (desfase ${driftSeconds.toFixed(1)}s), no se toca`,
      );
      return;
    }

    await hikvisionClient.setTime(new Date(), timeZone);
    console.log(
      `Reloj de la placa corregido: estaba ${driftSeconds > 0 ? "atrasado" : "adelantado"} ${Math.abs(driftSeconds).toFixed(1)}s (era ${localTime})`,
    );
  } catch (err) {
    // Un fallo acá no puede tirar abajo el servidor: como mucho la placa
    // sigue con la hora que tenía y se reintenta en el próximo ciclo.
    logError("No se pudo sincronizar el reloj de la placa", err);
  }
}

let currentState = { status: "waiting" };
let revertTimer = null;
const sseClients = new Set();

function broadcastState() {
  const payload = `data: ${JSON.stringify(currentState)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

function setState(status, extra = {}) {
  if (revertTimer) {
    clearTimeout(revertTimer);
    revertTimer = null;
  }
  currentState = { status, ...extra };
  broadcastState();

  if (status !== "waiting") {
    const { messageDurationSeconds } = getParams();
    revertTimer = setTimeout(() => {
      currentState = { status: "waiting" };
      broadcastState();
    }, messageDurationSeconds * 1000);
  }
}

async function onCardRead(cardCode) {
  const params = getParams();
  console.log(
    `[${formatLocalTimestamp(new Date())}] Lectura de tarjeta: cardCode=${cardCode} -> consultando TSM`,
  );

  let consumoAbierto = true;
  try {
    consumoAbierto = await tsmContasClient.isCartaoConsumoAberto(cardCode, {
      codigoEmpresa: params.tsmCodigoEmpresa,
    });
  } catch (err) {
    // Falló la consulta (red caída, respuesta inesperada, etc.): por
    // seguridad se deniega el acceso en vez de dejar pasar sin verificar.
    logError(`Error consultando tarjeta en TSM para cardCode=${cardCode}`, err);
    try {
      await hikvisionClient.openDoor(params.puertaTarjetaDenegada);
    } catch (doorErr) {
      logError(
        `Error abriendo puerta denegada tras fallo de consulta TSM (cardCode=${cardCode})`,
        doorErr,
      );
    }
    setState("connectionError", {
      message: params.connectionErrorMessage,
      cardCode,
    });
    return;
  }

  try {
    if (consumoAbierto) {
      console.log(
        `cardCode=${cardCode}: tarjeta con consumo abierto -> puerta ${params.puertaTarjetaDenegada}`,
      );
      await hikvisionClient.openDoor(params.puertaTarjetaDenegada);
      setState("failure", { message: params.failureMessage, cardCode });
    } else {
      console.log(
        `cardCode=${cardCode}: cuenta al día -> puertas ${params.puertaMolinete} y ${params.puertaTarjetaHabilitada}`,
      );
      // Orden a propósito: el molinete se abre primero. Si el segundo pulso
      // (tragar la tarjeta) falla, la persona igual puede salir -- la
      // tarjeta queda atascada a mitad de camino en el lector en vez de
      // perderse en la caja con el molinete todavía trabado.
      await hikvisionClient.openDoor(params.puertaMolinete);
      await hikvisionClient.openDoor(params.puertaTarjetaHabilitada);
      setState("success", { message: params.successMessage, cardCode });
    }
  } catch (err) {
    logError(`Error abriendo puerta para cardCode=${cardCode}`, err);
    setState("connectionError", {
      message: params.connectionErrorMessage,
      cardCode,
    });
  }
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const sepIndex = decoded.indexOf(":");
    const user = sepIndex >= 0 ? decoded.slice(0, sepIndex) : decoded;
    const pass = sepIndex >= 0 ? decoded.slice(sepIndex + 1) : "";

    if (
      envConfig.adminUser &&
      envConfig.adminPassword &&
      timingSafeEqualStr(user, envConfig.adminUser) &&
      timingSafeEqualStr(pass, envConfig.adminPassword)
    ) {
      return next();
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Tarjetero Admin"');
  res.status(401).send("Autenticación requerida");
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/admin", requireAdminAuth, (req, res) => {
  res.send(
    renderAdminPage(getParams(), { carouselImages: carouselStore.listImages() }),
  );
});

app.post(
  "/admin/save",
  requireAdminAuth,
  carouselUpload.fields(
    carouselStore.SLOTS.map((slot) => ({
      name: `carouselImage${slot}`,
      maxCount: 1,
    })),
  ),
  (req, res) => {
    try {
      for (const slot of carouselStore.SLOTS) {
        const file = req.files?.[`carouselImage${slot}`]?.[0];
        if (file) {
          carouselStore.saveImage(
            slot,
            file.buffer,
            IMAGE_EXT_BY_MIMETYPE[file.mimetype],
          );
        } else if (req.body[`removeCarouselImage${slot}`] === "on") {
          carouselStore.deleteImage(slot);
        }
      }

      const updated = paramsStore.save(req.body);
      res.send(
        renderAdminPage(updated, {
          saved: true,
          carouselImages: carouselStore.listImages(),
        }),
      );
    } catch (err) {
      res.status(400).send(
        renderAdminPage(getParams(), {
          error: err.message,
          carouselImages: carouselStore.listImages(),
        }),
      );
    }
  },
);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && req.path === "/admin/save") {
    res.status(400).send(
      renderAdminPage(getParams(), {
        error: `Error subiendo imagen: ${err.message}`,
        carouselImages: carouselStore.listImages(),
      }),
    );
    return;
  }
  next(err);
});

app.get("/carousel-images", (req, res) => {
  res.json({
    images: carouselStore.listImages().map((img) => img.url),
    intervalSeconds: getParams().carouselSecondsPerImage,
  });
});

app.post(envConfig.webhookPath, express.text({ type: "*/*" }), (req, res) => {
  res.status(200).send("OK");

  console.log(`Webhook body crudo: ${req.body}`);

  const event = parseEvent(req.body || "");
  if (!event) return;
  console.log(`Evento parseado: ${JSON.stringify(event)}`);
  if (event.eventType && event.eventType !== "AccessControllerEvent") return;

  const params = getParams();

  if (isStale(event.dateTime, params.maxEventAgeSeconds)) {
    console.log(`Evento descartado por antiguo (dateTime=${event.dateTime})`);
    return;
  }
  if (!event.cardCode) return;
  if (!debounceGuard.shouldProcess(event.cardCode, params.debounceSeconds)) {
    console.log(`cardCode=${event.cardCode} descartado por debounce`);
    return;
  }

  onCardRead(event.cardCode);
});

app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify(currentState)}\n\n`);
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

app.listen(envConfig.port, "0.0.0.0", () => {
  console.log(
    `Tarjetero webhook server escuchando en 0.0.0.0:${envConfig.port}`,
  );
  console.log(`Webhook: POST ${envConfig.webhookPath}`);
  console.log(`Web app: http://localhost:${envConfig.port}/`);
  console.log(`Admin: http://localhost:${envConfig.port}/admin`);
  console.log(
    `API TSM: http://${envConfig.tsmApiHost}:${envConfig.tsmApiPort} (usuario=${envConfig.tsmUsuario})`,
  );
  if (!envConfig.adminUser || !envConfig.adminPassword) {
    console.warn(
      "ADMIN_USER/ADMIN_PASSWORD no configurados: /admin va a rechazar todas las requests.",
    );
  }
  registerWebhookOnBoard();
  syncBoardClock();
  setInterval(syncBoardClock, CLOCK_SYNC_INTERVAL_MS);
});
