import { COOKIE_NAME } from "@shared/const";
import { getActivationReadiness } from "@shared/activationPolicy";
import { activationPolicy } from "@shared/activationPolicy";
import { cdrBootstrapPreflight } from "./foundation/cdrBootstrapPreflight";
import { getDefaultAuthReadiness } from "./foundation/supabaseAuth";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  foundation: router({
    activationReadiness: publicProcedure.query(() => getActivationReadiness()),
    integrationReadiness: publicProcedure.query(() => ({
      auth: getDefaultAuthReadiness(),
      billing: "sandbox_not_configured",
      upload: activationPolicy.customerIntake.enabled ? "not_implemented" : "fail_closed",
    })),
    cdrBootstrapPreflight: publicProcedure.query(() => cdrBootstrapPreflight),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
