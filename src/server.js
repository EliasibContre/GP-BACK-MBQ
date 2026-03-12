// src/server.js
import "dotenv/config";
import app from "./app.js";
import { env } from "./config/env.js";

const port = Number(env.PORT || 3001);

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
}).on("error", (error) => {
  console.error("Error al iniciar el servidor:", error);
});