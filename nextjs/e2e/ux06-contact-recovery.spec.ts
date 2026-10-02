import { expect, test, type Page } from "@playwright/test";

/*
  UX06 contact recovery. Any /api/contact requests in these tests are intercepted with
  synthetic responses; no inquiry reaches a live service.
*/
test("closed pricing CTAs stay on the evaluation/contact path when status is unavailable (mocked status API)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "UX06 keyboard and recovery behavior is measured at 390px");
  await page.route("**/api/status/v2", route => route.abort());
  await page.goto("/pricing");

  const developer = page.getByRole("link", { name: "Request Developer access", exact: true });
  const team = page.getByRole("link", { name: "Talk to us about Team", exact: true });
  const enterprise = page.getByRole("link", { name: "Scope an Enterprise pilot", exact: true }).first();
  const evaluation = page.getByRole("link", { name: "Explore a Compiled World", exact: true });

  await expect(developer).toHaveAttribute("href", "/contact?plan=Developer");
  await expect(team).toHaveAttribute("href", "/contact?plan=Team");
  await expect(enterprise).toHaveAttribute("href", "/contact?plan=Enterprise");
  await expect(evaluation).toHaveAttribute("href", "/explore");

  await developer.click();
  await expect(page).toHaveURL(/\/contact\?plan=Developer$/);
  await expect(page.locator("[data-plan-intent]")).toHaveText("Inquiry about the Developer plan");
  await expect(page.locator('input[name="plan"]')).toHaveValue("Developer");
});

test("native contact validation focuses Name and sends no request", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "UX06 keyboard and recovery behavior is measured at 390px");
  let requests = 0;
  await page.route("**/api/contact", async route => {
    requests++;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.goto("/contact");
  await page.getByRole("button", { name: "Send inquiry" }).click();

  await expect(page.locator('input[name="name"]')).toBeFocused();
  expect(requests).toBe(0);
});

test("a mocked 503 keeps answers and returns keyboard focus to the retry button", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "UX06 keyboard and recovery behavior is measured at 390px");
  let requests = 0;
  await page.route("**/api/contact", async route => {
    requests++;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "private stack trace SECRET-DB-DETAILS" }),
    });
  });
  await page.goto("/contact?plan=Developer");
  await page.locator('input[name="name"]').fill("Avery Chen");
  await page.locator('input[name="email"]').fill("avery@example.com");
  await page.locator('textarea[name="message"]').fill("We need a source-linked knowledge review for a small team.");

  const submit = page.getByRole("button", { name: "Send inquiry" });
  await submit.focus();
  await page.keyboard.press("Enter");

  const error = page.locator('form [aria-live="polite"] [data-state="error"]');
  await expect(error).toContainText("Your answers are still in the form.");
  await expect(error).not.toContainText("SECRET-DB-DETAILS");
  await expect(error.getByRole("link")).toHaveAttribute("href", "mailto:hello@tavonel.com");
  await expect(submit).toBeFocused();
  await expect(submit).toHaveAttribute("aria-describedby", await error.getAttribute("id") ?? "");
  await expect(page.locator('input[name="name"]')).toHaveValue("Avery Chen");
  await expect(page.locator('input[name="email"]')).toHaveValue("avery@example.com");
  await expect(page.locator('textarea[name="message"]')).toHaveValue("We need a source-linked knowledge review for a small team.");
  expect(requests).toBe(1);

  await submit.click();
  await expect.poll(() => requests).toBe(2);
  await expect(submit).toBeFocused();
});

test("a mocked network abort keeps answers and never exposes browser fetch text", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "UX06 keyboard and recovery behavior is measured at 390px");
  await page.route("**/api/contact", route => route.abort());
  await page.goto("/contact");
  await page.locator('input[name="name"]').fill("Avery Chen");
  await page.locator('input[name="email"]').fill("avery@example.com");
  await page.locator('textarea[name="message"]').fill("We need a source-linked knowledge review for a small team.");

  const submit = page.getByRole("button", { name: "Send inquiry" });
  await submit.focus();
  await page.keyboard.press("Enter");

  const error = page.locator('form [aria-live="polite"] [data-state="error"]');
  await expect(error).toContainText("Your answers are still in the form.");
  await expect(error).not.toContainText("Failed to fetch");
  await expect(error.getByRole("link")).toHaveAttribute("href", "mailto:hello@tavonel.com");
  await expect(submit).toBeFocused();
  await expect(page.locator('input[name="name"]')).toHaveValue("Avery Chen");
  await expect(page.locator('input[name="email"]')).toHaveValue("avery@example.com");
  await expect(page.locator('textarea[name="message"]')).toHaveValue("We need a source-linked knowledge review for a small team.");
});

/*
  Status-specific recovery in both locales, asserted as the exact text a visitor reads.

  403 (origin refused) and 415 (not a JSON request) refuse the request itself, so the copy says
  a retry will not help and offers the bare address alone. 413 is the whole request body, so the
  copy names both things a visitor can trim before sending again.
*/
const FORMS = {
  en: {
    path: "/contact",
    submit: "Send inquiry",
    name: "Avery Chen",
    email: "avery@example.com",
    company: "Example Labs",
    message: "We need a source-linked knowledge review for a small team.",
    shorter: "A source-linked review for a small team.",
    refused: "Your inquiry cannot be sent from this page, so sending it again will not help. Your answers are still in the form. Email us instead at hello@tavonel.com",
    tooLarge: "Your inquiry is larger than this form can send. Shorten the message or remove some optional answers, then send it again.",
  },
  ko: {
    path: "/ko/contact",
    submit: "문의 보내기",
    name: "김하늘",
    email: "haneul@example.com",
    company: "예시 연구소",
    message: "소규모 팀을 위한 출처 연결 지식 검토가 필요합니다.",
    shorter: "소규모 팀의 출처 연결 지식 검토가 필요합니다.",
    refused: "이 화면에서는 문의를 보낼 수 없어 다시 보내도 해결되지 않습니다. 입력한 내용은 양식에 그대로 남아 있습니다. 대신 다음 주소로 메일을 보내 주세요: hello@tavonel.com",
    tooLarge: "문의 전체 크기가 이 양식으로 보낼 수 있는 한도를 넘었습니다. 문의 내용을 줄여 쓰거나 선택 항목의 답변 일부를 지운 뒤 다시 보내 주세요.",
  },
} as const;

type ContactPage = (typeof FORMS)[keyof typeof FORMS];

const REFUSALS = [
  { status: 403, serverError: "This request origin is not allowed." },
  { status: 415, serverError: "Only JSON requests are accepted." },
] as const;

for (const { status, serverError } of REFUSALS) {
  for (const locale of ["en", "ko"] as const) {
    test(`a mocked ${status} at ${FORMS[locale].path} keeps answers and offers only the fixed address, not a retry`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "390", "UX06 keyboard and recovery behavior is measured at 390px");
      const form = FORMS[locale];
      let requests = 0;
      await page.route("**/api/contact", async route => {
        requests++;
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: serverError }) });
      });
      await page.goto(form.path);
      await fillAnswers(page, form);

      const submit = page.getByRole("button", { name: form.submit, exact: true });
      await submit.focus();
      await page.keyboard.press("Enter");

      const error = page.locator('form [aria-live="polite"] [data-state="error"]');
      await expect(error).toHaveText(form.refused);
      await expect(error).not.toContainText(serverError);
      // One link, to the bare address: no answer is carried into the mailto URI.
      await expect(error.getByRole("link")).toHaveCount(1);
      await expect(error.getByRole("link")).toHaveAttribute("href", "mailto:hello@tavonel.com");
      await expect(submit).toBeFocused();
      await expect(submit).toHaveAttribute("aria-describedby", await error.getAttribute("id") ?? "");
      await expectAnswersKept(page, form);
      expect(requests).toBe(1);
    });
  }
}

for (const locale of ["en", "ko"] as const) {
  test(`a mocked 413 at ${FORMS[locale].path} names the whole inquiry as too large and sends the trimmed one again`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "390", "UX06 keyboard and recovery behavior is measured at 390px");
    const form = FORMS[locale];
    const bodies: string[] = [];
    await page.route("**/api/contact", async route => {
      bodies.push(route.request().postData() ?? "");
      await route.fulfill({ status: 413, contentType: "application/json", body: JSON.stringify({ error: "The request is too large." }) });
    });
    await page.goto(form.path);
    await fillAnswers(page, form);

    const submit = page.getByRole("button", { name: form.submit, exact: true });
    await submit.focus();
    await page.keyboard.press("Enter");

    const error = page.locator('form [aria-live="polite"] [data-state="error"]');
    await expect(error).toHaveText(form.tooLarge);
    await expect(error.getByRole("link")).toHaveCount(0);
    await expect(submit).toBeFocused();
    await expect(submit).toHaveAttribute("aria-describedby", await error.getAttribute("id") ?? "");
    await expectAnswersKept(page, form);
    expect(bodies).toHaveLength(1);

    // The reduction the copy asks for -- an optional answer removed, the message shortened --
    // and then the retry, which carries the smaller inquiry.
    await page.locator('input[name="company"]').fill("");
    await page.locator('textarea[name="message"]').fill(form.shorter);
    await submit.click();
    await expect.poll(() => bodies.length).toBe(2);
    const [first = "", trimmed = ""] = bodies;
    expect(trimmed.length).toBeLessThan(first.length);
    await expect(submit).toBeFocused();
  });
}

async function fillAnswers(page: Page, form: ContactPage) {
  await page.locator('input[name="name"]').fill(form.name);
  await page.locator('input[name="email"]').fill(form.email);
  await page.locator('input[name="company"]').fill(form.company);
  await page.locator('textarea[name="message"]').fill(form.message);
}

async function expectAnswersKept(page: Page, form: ContactPage) {
  await expect(page.locator('input[name="name"]')).toHaveValue(form.name);
  await expect(page.locator('input[name="email"]')).toHaveValue(form.email);
  await expect(page.locator('input[name="company"]')).toHaveValue(form.company);
  await expect(page.locator('textarea[name="message"]')).toHaveValue(form.message);
}
