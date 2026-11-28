import { expect, test } from "@playwright/test";
import { installApiMocks, storedChangeset } from "./support/api-mocks";
import { openNavigation } from "./support/navigation";

test("settings and shell render the saved palette, and Auto follows the system", async ({ page }) => {
  await installApiMocks(page);
  let theme = "light";
  await page.route("**/api/v1/users/me/preferences", route => {
    if (route.request().method() === "PATCH") theme = route.request().postDataJSON().theme;
    return route.fulfill({ json: { theme, language: "en-US", timezone: "UTC" } });
  });
  const body = page.locator("body");
  const sidebar = page.locator(".settings-sidebar");
  const light = "rgb(255, 255, 255)";
  const dark = "rgb(13, 17, 23)";
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/settings/account");
  await expect(body).toHaveCSS("background-color", light);
  await expect(sidebar).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByRole("link", { name: "Appearance" }).click();
  await page.locator('[name=theme][value=auto]').check();
  await expect(body).toHaveCSS("background-color", dark);
  await expect(sidebar).toHaveCSS("background-color", "rgb(13, 17, 23)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(body).toHaveCSS("background-color", light);
  await page.locator('[name=theme][value=dark]').check();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(body).toHaveCSS("background-color", light);
  await page.getByRole("link", { name: "Appearance" }).click();
  await page.locator('[name=theme][value=dark]').check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => theme).toBe("dark");
  await page.reload();
  await expect(body).toHaveCSS("background-color", dark);
  await expect(page.locator('[name=theme][value=dark]')).toBeChecked();
  await page.locator('[name=theme][value=light]').check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => theme).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  // A shell route can be interactive before its account request resolves.
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/me", async route => { await pending; await route.fallback(); });
  await page.goto("/projects");
  await page.getByRole("button", { name: "Search or jump to" }).click();
  const search = page.getByRole("combobox", { name: "Search or jump to" });
  await search.fill("changes");
  release();
  await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(246, 248, 250)");
  await expect(search).toHaveValue("changes");
  await page.keyboard.press("Escape");
  await page.locator(".user-menu-trigger").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(body).toHaveCSS("background-color", dark);
});

test("the account language is saved through Appearance and applied across the workspace", async ({ page }) => {
  await installApiMocks(page);
  let language = "en-US";
  await page.route("**/api/v1/users/me/preferences", route => {
    if (route.request().method() === "PATCH") language = route.request().postDataJSON().language;
    return route.fulfill({ json: { theme: "auto", language, timezone: "UTC" } });
  });
  await page.goto("/orgs/demo/repositories");
  const header = page.getByRole("banner");
  await expect(header.getByTitle("Switch language")).toHaveCount(0);
  await openNavigation(page);
  const drawer = page.getByRole("dialog", { name: "Global navigation" });
  await expect(drawer.getByTitle("Switch language")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await header.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("dialog", { name: "User menu" }).getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Appearance", exact: true }).click();
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "简体中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(language).toBe("en-US");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => language).toBe("zh-CN");

  await page.evaluate(() => localStorage.removeItem("agentforge-language"));
  await page.goto("/orgs/demo/repositories");
  await expect(header.getByRole("link", { name: "全部仓库" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("Compare and PR Files use both Diff palettes and keyboard focus follows the theme", async ({ page }) => {
  await installApiMocks(page);
  await page.route("**/api/v1/users/me/preferences", route =>
    route.fulfill({ json: { theme: "auto", language: "en-US", timezone: "UTC" } }),
  );
  const comparison = {
    repository: "easyhaloo/agentforge",
    base_sha: "b".repeat(40),
    head_sha: "a".repeat(40),
    patch: [
      "diff --git a/example.ts b/example.ts", "--- a/example.ts", "+++ b/example.ts", "@@ -1 +1 @@",
      "-const before = 1;", `+const after = "${"x".repeat(240)}";`, "",
    ].join("\n"),
    commits: [],
    commits_truncated: false,
  };
  const pull = storedChangeset("CS-THEME", "Theme regression");
  await page.route("**/repositories/easyhaloo/agentforge/compare?**", route => route.fulfill({ json: comparison }));
  await page.route("**/changesets/CS-THEME/comparison", route => route.fulfill({ json: comparison }));
  await page.route("**/changesets/CS-THEME", route => route.fulfill({ json: {
    ...pull,
    changeset: {
      ...pull.changeset,
      pull_request: { base_branch: "main", source_branch: "release", draft: true, comments: [] },
      revisions: [{ id: "rev-1", commit_sha: comparison.head_sha }],
    },
  } }));

  const palettes = [
    {
      theme: "light", surface: "255, 255, 255", header: "246, 248, 250", hunk: "221, 244, 255",
      hunkText: "5, 80, 174", add: "218, 251, 225", addGutter: "172, 238, 187", addText: "17, 99, 41",
      del: "255, 235, 233", delGutter: "255, 215, 213", lineNumber: "89, 99, 110", primary: "9, 105, 218",
    },
    {
      theme: "dark", surface: "13, 17, 23", header: "21, 27, 35", hunk: "28, 45, 65",
      hunkText: "165, 214, 255", add: "13, 58, 46", addGutter: "23, 71, 55", addText: "63, 185, 80",
      del: "61, 37, 47", delGutter: "74, 46, 57", lineNumber: "240, 246, 252", primary: "68, 147, 248",
    },
  ] as const;
  const diff = page.locator(".repository-diff");
  const description = page.getByRole("textbox", { name: "Description" });
  for (const screen of ["new", "CS-THEME/files"]) {
    await page.goto(`/orgs/demo/repositories/easyhaloo/agentforge/pulls/${screen}`);
    await expect(diff.locator('[data-highlight-engine="shiki"]')).toBeVisible();
    if (screen === "new") {
      await page.getByRole("textbox", { name: "Title" }).press("Tab");
      await expect(description).toBeFocused();
    } else {
      const line = page.getByRole("button", { name: /example\.ts · New line 1/ });
      const summary = diff.locator("summary");
      const details = diff.locator("details");
      const composer = page.getByRole("textbox", { name: "Write a comment" });
      await line.press("Enter");
      await expect(composer).toBeFocused();
      await composer.fill("Draft");
      await summary.click({ force: true });
      await expect(details).toHaveAttribute("open", "");
      for (const key of ["Enter", "Space"]) {
        await summary.press(key);
        await expect(details).toHaveAttribute("open", "");
      }
      await expect(composer).toBeVisible();
      await expect(composer).toHaveValue("Draft");
      await composer.press("Escape");
      await expect(line).toBeFocused();
    }

    for (const palette of palettes) {
      await page.emulateMedia({ colorScheme: palette.theme });
      const add = diff.locator(".repository-diff__line--add");
      const remove = diff.locator(".repository-diff__line--remove");
      const gutter = remove.locator(":scope > span").first();
      await expect(diff).toHaveCSS("background-color", `rgb(${palette.surface})`);
      await expect(diff.locator(".repository-diff__file :is(h4, summary)")).toHaveCSS("background-color", `rgb(${palette.header})`);
      await expect(diff.locator(".repository-diff__hunk")).toHaveCSS("background-color", `rgb(${palette.hunk})`);
      await expect(diff.locator(".repository-diff__hunk")).toHaveCSS("color", `rgb(${palette.hunkText})`);
      await expect(add).toHaveCSS("background-color", `rgb(${palette.add})`);
      await expect(add.locator(":scope > span").last()).toHaveCSS("background-color", `rgb(${palette.addGutter})`);
      await expect(add).toHaveCSS("color", `rgb(${palette.addText})`);
      const syntax = add.locator(".repository-code__shiki-token");
      expect(await syntax.evaluateAll(tokens => new Set(tokens.map(token => getComputedStyle(token).color)).size)).toBeGreaterThan(1);
      await expect(remove).toHaveCSS("background-color", `rgb(${palette.del})`);
      await expect(gutter).toHaveCSS("background-color", `rgb(${palette.delGutter})`);
      await expect(gutter).toHaveCSS("color", `rgb(${palette.lineNumber})`);
      if (screen !== "new") {
        for (const width of [1280, 760, 390, 320]) {
          await page.setViewportSize({ width, height: 800 });
          const split = page.getByRole("button", { name: "Split" });
          if (width > 760) {
            await split.press("Enter");
            await expect(diff).toHaveClass(/repository-diff--split/);
          } else {
            await expect(split).toBeDisabled();
            await expect(diff).toHaveClass(/repository-diff--unified/);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
      }
      if (screen === "new") {
        await expect(description).toHaveCSS("border-top-color", `rgb(${palette.primary})`);
        const ring = await description.evaluate((el, primary) => {
          const probe = document.createElement("span");
          probe.style.boxShadow = `0 0 0 2px color-mix(in srgb, rgb(${primary}) 28%, transparent)`;
          el.after(probe);
          const shadow = getComputedStyle(probe).boxShadow;
          probe.remove();
          return shadow;
        }, palette.primary);
        await expect(description).toHaveCSS("box-shadow", ring);
      }
    }
  }
});

test("the off switch thumb stays distinct in both themes", async ({ page }) => {
  await installApiMocks(page);
  await page.route("**/api/v1/users/me/preferences", route =>
    route.fulfill({ json: { theme: "auto", language: "en-US", timezone: "UTC" } }),
  );
  await page.goto("/orgs/demo/repositories/new");
  const readme = page.getByRole("switch", { name: /Add a README/ });
  await expect(readme).not.toBeChecked();
  const thumb = readme.locator("..").locator(".af-switch__track > span");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(thumb).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(thumb).toHaveCSS("border-top-color", "rgb(89, 99, 110)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(thumb).toHaveCSS("background-color", "rgb(21, 27, 35)");
  await expect(thumb).toHaveCSS("border-top-color", "rgb(145, 152, 161)");
  await readme.press("Space");
  await expect(readme).toBeChecked();
  await expect(thumb).toHaveCSS("background-color", "rgb(13, 17, 23)");
  const track = thumb.locator("..");
  await expect(track).toHaveCSS("outline-color", "rgb(68, 147, 248)");

  await page.goto("/orgs/demo/repositories/new?mode=register");
  const visibility = page.getByRole("combobox", { name: /Visibility/ });
  await visibility.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option").and(page.locator(":focus"))).toHaveCSS("outline-color", "rgb(68, 147, 248)");
});


test("Changeset routes and the legacy repository fit narrow screens in both themes", async ({ page }) => {
  await installApiMocks(page);
  await page.route("**/api/v1/users/me/preferences", route =>
    route.fulfill({ json: { theme: "auto", language: "en-US", timezone: "UTC" } }),
  );
  await page.route(/\/repositories\/demo\/agentforge\/tree(?:\?|$)/, route => route.fulfill({ json: {
    repository: "demo/agentforge", commit_sha: "a".repeat(40), path: "", items: [],
  } }));
  const surfaces = [
    ["changesets", ".changesets-page"],
    ...["", "/revisions", "/evaluation", "/review", "/merge"].map(suffix => [`changesets/CS-E2E-01${suffix}`, ".changeset-detail"]),
    ["repositories/agentforge", ".repository-detail-page .repo-file-layout"],
  ];
  for (const [path, selector] of surfaces) {
    await page.goto(`/orgs/demo/${path}`);
    await expect(page.locator(selector)).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      for (const width of [760, 390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} ${colorScheme} ${width}px`).toBeLessThanOrEqual(width);
      }
    }
  }
});
