type PaddleEvent = { name: string; data?: unknown };
type PaddleCheckoutOptions = {
  items: Array<{ priceId: string; quantity: number }>;
  customer?: { email: string };
  customData: Record<string, string>;
  settings: { displayMode: "overlay"; theme: "light" | "dark"; locale: string };
};
type PaddleBrowser = {
  Environment: { set(environment: "sandbox"): void };
  Initialize(options: { token: string; eventCallback?: (event: PaddleEvent) => void }): void;
  Checkout: { open(options: PaddleCheckoutOptions): void };
};

declare global {
  interface Window { Paddle?: PaddleBrowser }
}

let initialized: Promise<PaddleBrowser> | null = null;
let initializedToken: string | null = null;

export function initializePaddleBrowser({
  token,
  environment,
  eventCallback,
}: {
  token: string;
  environment: "sandbox" | "production";
  eventCallback?: (event: PaddleEvent) => void;
}) {
  if (initialized) {
    if (initializedToken !== token) return Promise.reject(new Error("paddle_token_changed"));
    return initialized;
  }
  initializedToken = token;
  initialized = new Promise<PaddleBrowser>((resolve, reject) => {
    const ready = () => {
      if (!window.Paddle) return reject(new Error("paddle_script_missing"));
      if (environment === "sandbox") window.Paddle.Environment.set("sandbox");
      window.Paddle.Initialize({ token, eventCallback });
      resolve(window.Paddle);
    };
    if (window.Paddle) return ready();
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error("paddle_script_load_failed"));
    document.head.append(script);
  });
  return initialized;
}
