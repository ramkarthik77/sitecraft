import { expect, test, type Page } from "@playwright/test";

// A single, coherent, recordable scenario for onboarding: no production data,
// no external real claims, no shared DB, and no hard-coded live credentials.
const ADMIN = process.env.E2E_ADMIN_TOKEN ?? "e2e-admin";
const EDITOR = process.env.E2E_EDITOR_TOKEN ?? "e2e-editor";
const BRANCH = "demo-content";

async function api(page: Page, token: string, method: string, path: string, data?: unknown) {
  const res = await page.request.fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    data,
  });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function asPerson(page: Page, token: string, path: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), token);
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

async function signReview(page: Page, token: string, person: string, reviewId: string, discipline: string) {
  await asPerson(page, token, `/reviews/${reviewId}`);
  await expect(page.getByRole("heading", { name: /Demo training content/ })).toContainText("Waiting for review");
  await page.getByRole("button", { name: "Approve and sign" }).click();
  const dlg = page.getByRole("dialog", { name: "Approve and sign" });
  await expect(dlg).toContainText(`Approved in ${discipline} review`);
  await dlg.getByLabel("Your full name").fill(person);
  await dlg.getByLabel("Sign-in token").fill(token);
  await dlg.getByRole("checkbox").check();
  await dlg.getByRole("button", { name: "Sign" }).click();
  await expect(page.locator(".signoff li.done").filter({ hasText: person })).toHaveCount(1);
}

test("Sitecraft guided demo: edit, request three-discipline MLR review, change, approve, merge and publish", async ({ page }) => {
  test.setTimeout(240_000);

  // Create a disposable site and real reviewer identities in the test server.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const site = await api(page, ADMIN, "POST", "/sites", { name: "Calvexa training demo (fictional)", template: "saas" });
  const siteId: string = site.id;
  await api(page, EDITOR, "PUT", `/sites/${siteId}/profile`, {
    therapyArea: "Immunology", market: "US", audience: "hcp", jobCode: "US-CAL-DEMO-0001",
  });
  await api(page, ADMIN, "PUT", `/sites/${siteId}/policy`, {
    reviewDisciplines: ["medical", "legal", "regulatory"],
  });
  const reviewers: { name: string; discipline: string; token: string }[] = [];
  for (const [name, discipline] of [
    ["Dr. Elena Ruiz", "medical"],
    ["Daniel Okafor", "legal"],
    ["Priya Nair", "regulatory"],
  ]) {
    const created = await api(page, ADMIN, "POST", "/tokens", {
      name, role: "editor", disciplines: [discipline],
    });
    reviewers.push({ name, discipline, token: created.token });
  }

  await api(page, EDITOR, "POST", `/sites/${siteId}/branches`, { name: BRANCH });
  const doc = (await api(page, EDITOR, "GET", `/sites/${siteId}/branches/${BRANCH}`)).document;
  await api(page, EDITOR, "POST", `/sites/${siteId}/branches/${BRANCH}/ops`, {
    ops: [{
      op: "add_block", parentId: doc.pages[0].root.id, block: "text-section",
      content: {
        headline: "Training copy draft",
        body: "Fictional placeholder for a medical/legal/regulatory authoring walkthrough. Not a clinical claim.",
      },
    }],
    message: "Create fictional training copy on an isolated branch",
  });

  // The author edits the new section in the actual canvas, not only via API.
  await asPerson(page, EDITOR, `/sites/${siteId}?branch=${BRANCH}`);
  const canvas = page.frameLocator("iframe[title='Page canvas']");
  const initial = canvas.getByRole("heading", { name: "Training copy draft" });
  await expect(initial).toBeVisible();
  await initial.dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Demo study overview for reviewers");
  await page.keyboard.press("Enter");
  await expect(canvas.getByRole("heading", { name: "Demo study overview for reviewers" })).toBeVisible();
  await expect(page.locator(".save-state")).toHaveText("Saved");

  // The author submits from the Branches screen.
  await page.goto(`/sites/${siteId}/branches`, { waitUntil: "domcontentloaded" });
  await page.locator(".wq-row", { hasText: BRANCH }).getByRole("button", { name: "Request review" }).click();
  const request = page.getByRole("dialog", { name: "Request MLR review" });
  await request.getByPlaceholder("e.g. Updated efficacy claims").fill("Demo training content");
  await request.getByRole("button", { name: "Send for review" }).click();
  await expect(page.locator(".toast").first()).toContainText("Sent for review");

  const openReviews = await api(page, EDITOR, "GET", `/sites/${siteId}/reviews`);
  const review = openReviews.find((r: { branch: string }) => r.branch === BRANCH);
  expect(review, "A review for the demo branch should exist").toBeTruthy();
  const reviewId: string = review.id;

  // Medical signs the first version; Legal rejects it.
  await signReview(page, reviewers[0]!.token, reviewers[0]!.name, reviewId, "medical");
  await asPerson(page, reviewers[1]!.token, `/reviews/${reviewId}`);
  await page.getByRole("button", { name: "Ask for changes" }).click();
  await page.getByRole("dialog", { name: "Ask for changes" }).getByRole("textbox").fill("Add the balanced context paragraph.");
  await page.getByRole("button", { name: "Send back" }).click();
  await expect(page.getByRole("heading", { name: /Demo training content/ })).toContainText("Changes requested");

  // An actual new version invalidates previous signatures.
  await asPerson(page, EDITOR, `/sites/${siteId}?branch=${BRANCH}`);
  const current = canvas.getByRole("heading", { name: "Demo study overview for reviewers" });
  await current.dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Demo study overview with balanced context");
  await page.keyboard.press("Enter");
  await expect(canvas.getByRole("heading", { name: "Demo study overview with balanced context" })).toBeVisible();
  await expect(page.locator(".save-state")).toHaveText("Saved");

  await page.goto(`/reviews/${reviewId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Send for review again" }).click();
  await expect(page.getByRole("heading", { name: /Demo training content/ })).toContainText("Waiting for review");

  // All THREE independent disciplines must sign the latest branch version.
  for (const reviewer of reviewers) {
    await signReview(page, reviewer.token, reviewer.name, reviewId, reviewer.discipline);
  }

  await asPerson(page, EDITOR, `/reviews/${reviewId}`);
  await expect(page.getByRole("heading", { name: /Demo training content/ })).toContainText("Approved");
  await page.getByRole("button", { name: "Merge into main" }).click();
  await expect(page.locator(".toast").first()).toContainText(`Merged ${BRANCH} into main`);

  // Merge isn't live: publisher explicitly publishes main.
  await page.goto(`/sites/${siteId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.locator(".toast").first()).toContainText("Published to");
  const published = await api(page, EDITOR, "GET", `/sites/${siteId}`);
  const live = await page.request.get(published.liveUrl);
  expect(live.ok()).toBeTruthy();
  expect(await live.text()).toContain("Demo study overview with balanced context");
});
