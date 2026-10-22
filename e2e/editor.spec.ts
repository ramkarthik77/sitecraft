import { expect, test, type Page } from "@playwright/test";

const EDITOR = process.env.E2E_EDITOR_TOKEN ?? "e2e-editor";
const AGENT = process.env.E2E_AGENT_TOKEN ?? "e2e-agent";

async function apiCall(page: Page, token: string, method: string, path: string, data?: unknown) {
  const res = await page.request.fetch(`/api${path}`, { method, headers: { authorization: `Bearer ${token}` }, data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

const canvas = (page: Page) => page.frameLocator("iframe[title='Page canvas']");
const saved = (page: Page) => expect(page.locator(".save-state")).toHaveText("Saved");

test.describe.configure({ mode: "serial" });

// The editor and published sites run under a strict Content-Security-Policy; anything it blocks is a bug.
let cspViolations: string[] = [];
test.beforeEach(({ page }) => {
  cspViolations = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (load|execute|apply|frame|connect)/i.test(m.text())) cspViolations.push(m.text());
  });
});
test.afterEach(() => expect(cspViolations, cspViolations.join("\n")).toEqual([]));

let siteId = "";

test("sign in and create a site", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.fill("#token", "wrong");
  await page.click("form.login button.primary");
  await expect(page.locator(".err")).toContainText("wasn't accepted");
  await page.fill("#token", EDITOR);
  await page.click("form.login button.primary");
  await expect(page.getByRole("heading", { name: "Sites", exact: true })).toBeVisible();

  await page.getByLabel("Site name").fill("Northstar Coffee");
  await page.getByLabel("Template").selectOption("saas");
  await page.getByRole("button", { name: "Create site" }).click();
  await expect(page).toHaveURL(/\/sites\//);
  siteId = page.url().split("/sites/")[1]!.split("?")[0]!;
  await expect(canvas(page).locator("h1")).toContainText("Build beautiful sites");
});

test("edit text on the canvas, insert a section and style for phones", async ({ page }) => {
  await page.goto(`/sites/${siteId}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await page.reload({ waitUntil: "domcontentloaded" });

  // Inline text editing by double-click.
  const h1 = canvas(page).locator("h1");
  await h1.dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Coffee worth waking up for");
  await page.keyboard.press("Enter");
  await expect(h1).toHaveText("Coffee worth waking up for");
  await saved(page);

  // Insert a section from the panel.
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.locator(".block-card", { hasText: "contact form" }).click();
  await expect(canvas(page).getByText("Get in touch")).toBeVisible();
  await saved(page);

  // Undo and redo the insert.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(canvas(page).getByText("Get in touch")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(canvas(page).getByText("Get in touch")).toBeVisible();

  // Phone-only override from the inspector.
  await page.getByRole("button", { name: "Phone" }).click();
  await h1.click();
  await page.getByLabel("Size", { exact: true }).fill("36px");
  await saved(page);
  const head = await apiCall(page, EDITOR, "GET", `/sites/${siteId}/branches/main`);
  const json = JSON.stringify(head.document);
  expect(json).toContain("Coffee worth waking up for");
  expect(json).toContain('"mobile":{"fontSize":"36px"}');
});

test("Claude's edits on a branch appear live, then a person merges and publishes", async ({ page }) => {
  await page.goto(`/sites/${siteId}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);

  // Claude Code (agent token) starts a branch, as it would over MCP.
  await apiCall(page, AGENT, "POST", `/sites/${siteId}/branches`, { name: "agent/menu" });
  await page.goto(`/sites/${siteId}?branch=agent%2Fmenu`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("h1")).toHaveText("Coffee worth waking up for");

  const doc = (await apiCall(page, AGENT, "GET", `/sites/${siteId}/branches/agent%2Fmenu`)).document;
  await apiCall(page, AGENT, "POST", `/sites/${siteId}/branches/agent%2Fmenu/ops`, {
    ops: [
      { op: "add_block", parentId: doc.pages[0].root.id, index: 2, block: "features", content: { headline: "Today's menu", items: [{ title: "Flat white", body: "Double ristretto, silky milk." }] } },
      { op: "set_theme", colors: { primary: "#7c2d12" } },
    ],
    message: "Add menu section and roast-brown theme",
  });

  // The open editor picks it up without a reload.
  await expect(page.locator(".toast.agent")).toContainText("Add menu section");
  await expect(canvas(page).getByText("Today's menu")).toBeVisible();

  // Claude's work is marked on the canvas, in the layers and in the activity bar.
  await expect(canvas(page).locator(".sc-tag-agent")).toHaveText("Claude");
  await expect(page.locator(".layer.agent").first()).toContainText("Claude");
  await expect(page.locator(".agent-bar")).toContainText("Add menu section and roast-brown theme");
  await expect(page.getByRole("button", { name: "Review changes" })).toContainText(/\d/);

  // Review and merge.
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.locator(".diff-line.add").first()).toBeVisible();
  await expect(page.locator(".callout").first()).toContainText("made 1 change");
  await page.getByRole("button", { name: "Merge into main" }).click();
  await expect(page.locator(".toast").first()).toContainText("Merged agent/menu");
  await expect(page.getByRole("combobox", { name: "Branch" })).toHaveValue("main");
  await expect(canvas(page).getByText("Today's menu")).toBeVisible();

  // Publish and check the live site.
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.locator(".toast").first()).toContainText("Published to");
  const site = await apiCall(page, EDITOR, "GET", `/sites/${siteId}`);
  await page.goto(site.liveUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("Coffee worth waking up for");
  await expect(page.getByText("Today's menu")).toBeVisible();

  // Phone layout on the live site uses the override.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.locator("h1")).toHaveCSS("font-size", "36px");
  await page.setViewportSize({ width: 1440, height: 900 });

  // Submit the contact form on the live site.
  await page.getByLabel("Name").fill("Grace");
  await page.getByLabel("Email").fill("grace@example.com");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thanks! We'll be in touch.")).toBeVisible();
  const subs = await apiCall(page, EDITOR, "GET", `/sites/${siteId}/forms`);
  expect(subs[0].data).toMatchObject({ name: "Grace", email: "grace@example.com" });
});

test("restore an earlier version from history", async ({ page }) => {
  await page.goto(`/sites/${siteId}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "History" }).click();
  const rows = page.locator(".drawer table").first().locator("tbody tr");
  await expect(rows.first()).toContainText("Merge branch agent/menu");
  await rows.last().getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".toast").first()).toContainText("Restored version");
  await page.keyboard.press("Escape");
  await expect(canvas(page).locator("h1")).toContainText("Build beautiful sites");
});

test("CMS: make a blog, write a post, list it on the home page and publish", async ({ page }) => {
  await page.goto(`/sites/${siteId}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await page.reload({ waitUntil: "domcontentloaded" });

  // A collection from the Blog preset, with its list and item pages.
  await page.getByRole("tab", { name: "CMS" }).click();
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page.getByRole("heading", { name: "Blog", exact: true })).toBeVisible();
  await expect(page.locator(".cms-table tbody tr")).toHaveCount(2);

  // A new post: starts as a draft whose slug follows the title.
  await page.getByRole("button", { name: "New item" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Seasonal menu");
  await page.getByRole("textbox", { name: "Body" }).fill("## New this week\n\nA **pumpkin** latte.");
  await expect(page.locator("#item-slug")).toHaveValue("seasonal-menu");
  await page.getByText("Draft (left out when you publish)").click();
  await saved(page);

  // Its page renders from the template, with the post's fields.
  await page.getByRole("button", { name: "View on its page" }).click();
  await expect(canvas(page).locator("h1")).toHaveText("Seasonal menu");
  await expect(canvas(page).locator(".sc-rich strong")).toHaveText("pumpkin");
  await canvas(page).locator("h1").click();
  await expect(page.getByLabel("Text", { exact: true })).toHaveValue("title");

  // A list of posts on the home page.
  await page.getByRole("combobox", { name: "Page", exact: true }).selectOption({ label: "Home" });
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.locator(".block-card", { hasText: "Blog list" }).click();
  await expect(canvas(page).getByText("Seasonal menu")).toBeVisible();
  await saved(page);

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.locator(".toast").first()).toContainText("Published to");
  const site = await apiCall(page, EDITOR, "GET", `/sites/${siteId}`);
  await page.goto(site.liveUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /Seasonal menu/ }).click();
  await expect(page).toHaveURL(/\/blog\/seasonal-menu$/);
  await expect(page.locator("h1")).toHaveText("Seasonal menu");
  await expect(page).toHaveTitle("Seasonal menu");
  await expect(page.locator("h2", { hasText: "New this week" })).toBeVisible();
});

test("motion: set an entrance and hover in the inspector, then watch it play", async ({ page }) => {
  await page.goto(`/sites/${siteId}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await page.reload({ waitUntil: "domcontentloaded" });

  const h1 = canvas(page).locator("h1");
  await h1.click();
  await page.getByLabel("Animation", { exact: true }).selectOption("blur-in");
  await page.getByRole("group", { name: "Easing" }).getByRole("button", { name: "Spring" }).click();
  await page.getByLabel("Hover effect").selectOption("lift");
  await saved(page);
  // The canvas plays the entrance on demand and shows hover effects while editing.
  await page.getByRole("button", { name: "Play the entrance on the canvas" }).click();
  await expect(h1).toHaveClass(/sc-h-lift/);
  await page.screenshot({ path: "test-results/motion-inspector.png" });

  const { url } = await apiCall(page, EDITOR, "GET", `/sites/${siteId}/branches/main/preview-url`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const live = page.locator("h1");
  await expect(live).toHaveClass(/sc-in/);
  // Once played, the effect classes go so hover and layout behave normally.
  await expect(live).not.toHaveClass(/sc-anim/, { timeout: 3000 });
  await expect(live).toHaveCSS("opacity", "1");
  await live.hover();
  await expect.poll(async () => live.evaluate((e) => getComputedStyle(e).transform)).not.toBe("none");

  // Visitors who ask for less motion see everything at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveCSS("opacity", "1");
});
