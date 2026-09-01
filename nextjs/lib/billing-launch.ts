type Environment = Readonly<Record<string, string | undefined>>;

export function isBillingLaunchApproved(env: Environment = process.env) {
  if (env.PADDLE_SANDBOX === "true") return true;
  return env.TAVONEL_BILLING_LAUNCH_APPROVED === "true";
}
