import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { roomsRouter } from "./routes/rooms.js";
import { summaryRouter } from "./routes/summary.js";
import { paymentsRouter } from "./routes/payments.js";
import { webhookRouter } from "./routes/webhook.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://salimovsf.github.io",
      "https://zvoon.me",
      "https://www.zvoon.me",
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/rooms", roomsRouter);
app.route("/summary", summaryRouter);
app.route("/payments", paymentsRouter);
app.route("/webhook", webhookRouter);

const port = Number(process.env.PORT) || 3500;

serve({ fetch: app.fetch, port }, () => {
  console.log(`Zvoon API running on http://localhost:${port}`);
});

export default app;
