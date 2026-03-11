import { Hono } from "hono";

export const paymentsRouter = new Hono();

// Create a payment session (Stripe or YooKassa)
paymentsRouter.post("/", async (c) => {
  // TODO: detect provider by region, create payment session
  return c.json({ sessionUrl: "placeholder" });
});

// Stripe webhook
paymentsRouter.post("/webhook/stripe", async (c) => {
  // TODO: handle Stripe webhook
  return c.json({ received: true });
});

// YooKassa webhook
paymentsRouter.post("/webhook/yookassa", async (c) => {
  // TODO: handle YooKassa webhook
  return c.json({ received: true });
});
