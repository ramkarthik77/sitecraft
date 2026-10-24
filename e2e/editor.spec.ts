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
  // Home greets a newcomer with what to do first.
  await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
  await expect(page.getByText("Create your first site")).toBeVisible();

  await page.getByRole("button", { name: "New site" }).first().click();
  await page.getByLabel("Site name").fill("Northstar Coffee");
  await page.getByRole("radio", { name: /Product site/ }).check();
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
  const tm = page.getByRole("dialog", { name: "History" });
  await expect(tm.locator(".tm-item").first()).toContainText("Merge branch agent/menu");
  await expect(tm.locator(".tm-item").first()).toContainText(/Live now|Merged/);
  // Look at the very first version, then put the whole site back to it.
  await tm.locator(".tm-pick", { hasText: "Create site" }).click();
  await expect(tm.frameLocator(".tm-frame iframe").locator("h1")).toContainText("Build beautiful sites");
  await tm.getByRole("button", { name: "Restore the whole site…" }).click();
  await tm.getByRole("button", { name: "Restore everything" }).click();
  await expect(page.locator(".toast").first()).toContainText("Restored the whole site");
  await page.keyboard.press("Escape");
  await expect(tm).toHaveCount(0);
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
  await page.getByRole("button", { name: "Page", exact: true }).click();
  await page.getByRole("option", { name: /^Home/ }).click();
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

test("scroll story: insert a story, set a scroll effect, and the pinned visual follows the steps", async ({ page }) => {
  await page.goto(`/sites/${siteId}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.getByRole("tab", { name: "Insert" }).click();
  await page.locator(".block-card .name", { hasText: /^story$/ }).click();
  await saved(page);
  // On the canvas every visual is shown so each can be edited.
  await expect(canvas(page).locator(".sc-story-edit")).toBeVisible();
  await expect(canvas(page).getByText("Let Claude build it").first()).toBeVisible();

  await canvas(page).locator("h2", { hasText: "How it works" }).click();
  await page.getByLabel("Scroll effect").selectOption("reveal");
  await page.getByRole("group", { name: "Scroll range" }).getByRole("button", { name: "In and out" }).click();
  await saved(page);

  await page.locator(".sc-story-edit").first().waitFor({ state: "detached" }).catch(() => {});
  const { url } = await apiCall(page, EDITOR, "GET", `/sites/${siteId}/branches/main/preview-url`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator("h2", { hasText: "How it works" })).toHaveAttribute("data-sc-scrub", "both");
  const story = page.locator("[data-sc-story]");
  await expect(story).toHaveClass(/sc-live/);
  const steps = story.locator(".sc-story-steps > *");
  const frames = story.locator(".sc-story-sticky > * > *");
  for (const i of [0, 1, 2]) {
    await steps.nth(i).evaluate((e) => e.scrollIntoView({ block: "center" }));
    await expect(steps.nth(i)).toHaveClass(/sc-on/);
    await expect(frames.nth(i)).toHaveClass(/sc-on/);
    await expect(frames.nth(i)).toBeInViewport();
    // Once the cross-fade settles only this step's visual shows, and its words are at full strength.
    await expect(frames.nth(i)).toHaveCSS("opacity", "1");
    await expect(steps.nth(i)).toHaveCSS("opacity", "1");
    for (const j of [0, 1, 2].filter((j) => j !== i)) await expect(frames.nth(j)).toHaveCSS("opacity", "0");
  }
  await page.screenshot({ path: "test-results/story-preview.png" });
});


test("finding your way: home, a site's overview, a page, and switching pages", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await apiCall(page, EDITOR, "POST", `/sites/${siteId}/branches/main/ops`, {
    ops: [
      { op: "add_page", path: "/about", title: "About us", blocks: ["navbar", "text-section", "footer"] },
      { op: "add_page", path: "/about/team", title: "Our team", blocks: ["navbar", "text-section", "footer"] },
    ],
    message: "About pages",
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  // Home: the site is under Recent sites; its name opens the overview.
  await expect(page.getByRole("heading", { name: "Recent sites" })).toBeVisible();
  await page.locator(".site-card .meta a", { hasText: "Northstar Coffee" }).click();
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/overview$`));
  await expect(page.getByRole("heading", { name: /Northstar Coffee/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /\/s\/northstar-coffee/ })).toBeVisible();
  await expect(page.locator(".page-row", { hasText: "Our team" })).toBeVisible();
  await expect(page.locator(".page-row", { hasText: "Page for each Blog item" })).toBeVisible();

  // Edit on a page opens the editor on that page, and the address keeps it.
  await page.locator(".page-row", { hasText: "Our team" }).getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/page=/);
  await expect(page.getByRole("button", { name: "Page", exact: true })).toContainText("Our team");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Page", exact: true })).toContainText("Our team");

  // The page switcher finds pages by name and opens them with Enter.
  await page.getByRole("button", { name: "Page", exact: true }).click();
  await page.getByLabel("Find a page").fill("about us");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Page", exact: true })).toContainText("About us");

  // The breadcrumb leads back to the overview, and the logo to Home.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Northstar Coffee" }).click();
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/overview$`));
  await page.getByRole("link", { name: "Home" }).first().click();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
});


test("time machine: compare, restore one page, bring back a section, name a version", async ({ page }) => {
  const doc = (await apiCall(page, EDITOR, "GET", `/sites/${siteId}/branches/main`)).document;
  const about = doc.pages.find((p: { path: string }) => p.path === "/about");
  const heading = about.root.children[1].children[0].children[0];
  await page.goto(`/sites/${siteId}?page=${about.id}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await page.reload({ waitUntil: "domcontentloaded" });
  // Name the current version with the keyboard.
  await saved(page);
  await page.keyboard.press("ControlOrMeta+Shift+S");
  await page.getByLabel("Version name").fill("Before the about rewrite");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.locator(".toast").first()).toContainText("Before the about rewrite");

  // Change the about heading, then delete it.
  await apiCall(page, EDITOR, "POST", `/sites/${siteId}/branches/main/ops`, { ops: [{ op: "update_node", nodeId: heading.id, props: { text: "Rewritten about" } }], message: "Rewrite about" });
  await apiCall(page, EDITOR, "POST", `/sites/${siteId}/branches/main/ops`, { ops: [{ op: "remove_node", nodeId: heading.id }], message: "Remove the about heading" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(canvas(page).getByText("Rewritten about")).toHaveCount(0);

  await page.getByRole("button", { name: "History" }).click();
  const tm = page.getByRole("dialog", { name: "History" });
  // "This page" shows only versions that changed About; "Named" shows the checkpoint.
  await tm.getByRole("button", { name: "This page" }).click();
  // Both edits came within a minute, so they read as one session; expand it to see each save.
  await expect(tm.locator(".tm-item").first()).toContainText("2 saves");
  await tm.getByRole("button", { name: "Show the saves in this session" }).first().click();
  await expect(tm.locator(".tm-save").first()).toContainText("Remove the about heading");
  await expect(tm.locator(".tm-hint")).toContainText(/same as the site today|current version/);
  await tm.getByRole("button", { name: "Named" }).click();
  await tm.locator(".tm-pick", { hasText: "Before the about rewrite" }).click();
  const stage = tm.frameLocator(".tm-frame iframe");
  await expect(stage.locator(`[data-node-id="${heading.id}"]`)).toBeVisible();
  await expect(tm.locator(".tm-legend")).toContainText("no longer there");

  // Bring just that heading back.
  await stage.locator(`[data-node-id="${heading.id}"]`).click();
  await tm.getByRole("button", { name: "Bring this section into today's version" }).click();
  await expect(page.locator(".toast").first()).toContainText("Brought that section back");
  await page.keyboard.press("Escape");
  await expect(canvas(page).locator(`[data-node-id="${heading.id}"]`)).toBeVisible();
  const now = (await apiCall(page, EDITOR, "GET", `/sites/${siteId}/branches/main/versions`))[0];
  expect(now).toMatchObject({ kind: "restore" });
});

test("quick find: jump to a site, a page or an action from anywhere", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const cp = page.getByRole("dialog", { name: "Quick find" });
  await cp.getByLabel("Find a site, page or action").fill("northstar");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/overview$`));

  await page.goto(`/sites/${siteId}`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("body")).toBeVisible();
  await expect(page.getByRole("button", { name: "Page", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await cp.getByLabel("Find a site, page or action").fill("our team");
  await expect(cp.getByRole("option").first()).toContainText("Our team");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Page", exact: true })).toContainText("Our team");
  await page.keyboard.press("ControlOrMeta+k");
  await cp.getByLabel("Find a site, page or action").fill("history");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "History" })).toBeVisible();
  await page.keyboard.press("Escape");
  // The site switcher next to the breadcrumb lists sites.
  await page.getByRole("button", { name: "Switch site" }).click();
  await expect(cp.getByRole("option", { name: /Northstar Coffee/ })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("moving pages: drag under another page, keep old addresses working", async ({ page }) => {
  await apiCall(page, EDITOR, "POST", `/sites/${siteId}/branches/main/ops`, { ops: [{ op: "add_page", path: "/careers", title: "Careers", blocks: ["text-section"] }], message: "Add careers" });
  await page.goto(`/sites/${siteId}?tab=pages`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".list-row", { hasText: "Careers" }).dragTo(page.locator(".list-row", { hasText: "About us" }));
  await expect(page.locator(".toast").first()).toContainText("Moved Careers to /about/careers");
  await expect(page.locator(".list-row", { hasText: "Careers" })).toContainText("/about/careers");
  await saved(page);

  // The same with the Parent picker: back to the top level.
  await page.locator(".list-row", { hasText: "Careers" }).click();
  await page.getByLabel("Parent page").selectOption("/");
  await expect(page.locator(".list-row", { hasText: "Careers" })).toContainText("/careers");
  await saved(page);

  // Redirects are listed in Site settings, and previews send old addresses on.
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".redirect-row", { hasText: "/about/careers" })).toBeVisible();
  await page.keyboard.press("Escape");
  const { url } = await apiCall(page, EDITOR, "GET", `/sites/${siteId}/branches/main/preview-url`);
  await page.goto(url + "about/careers", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/careers$/);
});

test("calendar, activity and who has access", async ({ page }) => {
  await page.goto("/calendar", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("sitecraft.token", t), EDITOR);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.locator(".cal-day.today .cal-chip").first()).toContainText("Northstar Coffee");
  await expect(page.locator(".cal-side")).toContainText("Published");
  await page.getByLabel("Time zone").selectOption("Asia/Tokyo");

  await page.goto(`/sites/${siteId}/overview`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.locator(".act-row").first()).toBeVisible();
  await page.getByRole("group", { name: "Kind of activity" }).getByRole("button", { name: "Publishing" }).click();
  await expect(page.locator(".act-row", { hasText: "published version" }).first()).toBeVisible();
  await expect(page.locator(".access-list li", { hasText: "e2e-editor" }).or(page.locator(".access-list li").first())).toBeVisible();

  // The live site as it was a moment ago opens history on that version.
  const at = new Date(Date.now() + 60_000);
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("See the live site as it was on").fill(local);
  await page.locator(".ov-warp").getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("dialog", { name: "History" })).toBeVisible();
  await expect(page.locator(".tm-detail")).toContainText(/Live now|Published/);
});
