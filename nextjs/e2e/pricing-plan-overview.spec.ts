import { expect, test } from "@playwright/test";

const ROUTES = ["/pricing", "/ko/pricing"] as const;

function overview(page: import("@playwright/test").Page, route: typeof ROUTES[number]) {
  return page.getByRole("navigation", { name: route === "/ko/pricing" ? "요금제 비교 및 상세 보기" : "Compare plans and jump to details", exact: true });
}

test("phone plan overview matches every detailed plan and jumps by keyboard without a purchase", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) > 700, "Phone comparison navigation.");
  for (const route of ROUTES) {
    await page.goto(route);
    const nav = overview(page, route);
    await expect(nav).toBeVisible();
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(4);
    for (let index = 0; index < 4; index++) {
      const link = links.nth(index);
      const target = page.locator(`#pricing-plan-${index}`);
      await expect(link).toHaveAttribute("href", `#pricing-plan-${index}`);
      const title = await target.getByRole("heading").innerText();
      const price = await target.locator(route === "/pricing" ? ".price" : 'p').first().innerText();
      await expect(link).toContainText(title);
      const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
      expect(normalize(await link.innerText())).toContain(normalize(price));
      if (route === "/pricing") await expect(link).toContainText(await target.locator(".price-period").innerText());
      await link.scrollIntoViewIfNeeded();
      const bounds = await link.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate(element => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit === element || (hit !== null && element.contains(hit));
      })).toBe(true);
      await link.focus();
      await expect(link).toBeFocused();
      await expect(link).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(url => url.pathname === route && url.hash === `#pricing-plan-${index}`);
      await expect(target).toBeFocused();
      await expect(target).toHaveCSS("outline-style", "solid");
      await expect.poll(async () => {
        return target.getByRole("heading").evaluate(heading => {
          const box = heading.getBoundingClientRect();
          const header = document.querySelector<HTMLElement>("header.nav");
          if (!header) throw new Error("Missing public header");
          return box.top >= Math.max(0, header.getBoundingClientRect().bottom) - 1 && box.bottom <= innerHeight;
        });
      }, { message: "the selected plan heading clears the public header" }).toBe(true);
    }
    await links.nth(1).click();
    await expect(page).toHaveURL(url => url.pathname === route && url.hash === "#pricing-plan-1");
    await expect(page.locator("#pricing-plan-1")).toBeFocused();
  }
});

test("all plan prices fit in the compact phone comparison before detailed plan content", async ({ browser }) => {
  test.skip(test.info().project.name !== "1440", "Run the explicit width matrix once.");
  const profiles = [320, 360, 390, 768, 1440].map(width => ({ width, height: 844, deviceScaleFactor: 1 }));
  // Existing audit convention: 1280 physical pixels at 200% = 640 CSS pixels at DPR 2.
  profiles.push({ width: 640, height: 450, deviceScaleFactor: 2 });
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.deviceScaleFactor });
    const checked = await context.newPage();
    try {
      for (const route of ROUTES) {
        await checked.goto(route);
        if (route === "/pricing") {
          const consent = checked.getByRole("region", { name: "Optional analytics", exact: true });
          await expect(consent).toBeVisible();
          await consent.getByRole("button", { name: "No thanks", exact: true }).click();
          await expect(consent).toBeHidden();
        }
        const nav = overview(checked, route);
        if (profile.width > 700) {
          await expect(nav).toBeHidden();
        } else {
          await expect(nav).toBeVisible();
          await nav.scrollIntoViewIfNeeded();
          const layout = await nav.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            const firstPlan = document.querySelector<HTMLElement>("#pricing-plan-0")!.getBoundingClientRect();
            const links = [...element.querySelectorAll("a")].map(link => {
              const box = link.getBoundingClientRect();
              const style = getComputedStyle(link);
              const range = document.createRange(); range.selectNodeContents(link);
              const text = range.getBoundingClientRect();
              return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, textLeft: text.left, textRight: text.right, textBottom: text.bottom, clipped: link.scrollHeight > link.clientHeight + 1, color: style.color };
            });
            return { top: bounds.top, bottom: bounds.bottom, height: bounds.height, firstPlanTop: firstPlan.top, viewportWidth: innerWidth, viewportHeight: innerHeight, links };
          });
          expect(layout.links).toHaveLength(4);
          expect(layout.height, "all four plan prices form a compact comparison").toBeLessThanOrEqual(280);
          expect(layout.bottom).toBeLessThanOrEqual(layout.firstPlanTop);
          for (const link of layout.links) {
            expect(link.width).toBeGreaterThanOrEqual(44);
            expect(link.height).toBeGreaterThanOrEqual(44);
            expect(link.left).toBeGreaterThanOrEqual(-1);
            expect(link.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
            expect(link.clipped).toBe(false);
            expect(link.textLeft).toBeGreaterThanOrEqual(link.left - 1);
            expect(link.textRight).toBeLessThanOrEqual(link.right + 1);
            expect(link.textBottom).toBeLessThanOrEqual(link.bottom + 1);
            expect(link.color).toBe("rgb(23, 28, 32)");
          }
          // Scroll to the start of the plan overview: all four choices fit in that phone viewport.
          await nav.evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
          const comparison = await nav.evaluate(element => {
            const box = element.getBoundingClientRect();
            const header = document.querySelector<HTMLElement>("header.nav");
            if (!header) throw new Error("Missing public header");
            return { top: box.top, bottom: box.bottom, headerBottom: header.getBoundingClientRect().bottom, viewportHeight: innerHeight };
          });
          expect(comparison.bottom).toBeLessThanOrEqual(comparison.viewportHeight);
          expect(comparison.top).toBeGreaterThanOrEqual(Math.max(0, comparison.headerBottom) - 1);

        }
        expect(await checked.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        if (profile.deviceScaleFactor === 1 && [390, 1440].includes(profile.width)) {
          const captureName = `pricing-overview-${route === "/pricing" ? "en" : "ko"}-${profile.width}`;
          const capturePath = test.info().outputPath(captureName + ".png");
          await checked.screenshot({ path: capturePath, animations: "disabled" });
          await test.info().attach(captureName, { path: capturePath, contentType: "image/png" });
        }
      }
    } finally {
      await context.close();
    }
  }
});
