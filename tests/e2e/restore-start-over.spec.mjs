import { expect, request, test } from "@playwright/test";
import JSZip from "jszip";

const baseURL = (process.env.POCKETFLARE_E2E_BASE_URL || "").replace(/\/+$/, "");
const adminEmail = process.env.POCKETFLARE_ADMIN_EMAIL || "";
const adminPassword = process.env.POCKETFLARE_ADMIN_PASSWORD || "";

test.skip(!baseURL, "POCKETFLARE_E2E_BASE_URL is required");
test.skip(!adminEmail || !adminPassword, "POCKETFLARE_ADMIN_EMAIL and POCKETFLARE_ADMIN_PASSWORD are required");

test("restore Start Over preserves resume state when cancel is unsafe", async ({ page }) => {
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { "Content-Type": "application/json" },
  });

  let token = "";
  let sessionId = "";
  let restoreToken = "";

  try {
    const auth = await api.post("/api/collections/_superusers/auth-with-password", {
      data: { identity: adminEmail, password: adminPassword },
    });
    expect(auth.ok(), await auth.text()).toBeTruthy();
    token = (await auth.json()).token;
    expect(token).toBeTruthy();

    await page.goto(`${baseURL}/_/#/login`);
    await page.locator("#login_identity").fill(adminEmail);
    await page.locator("#login_pass").fill(adminPassword);
    await page.getByRole("button", { name: /login/i }).click();
    await expect(page).toHaveURL(/#\/collections/);

    // Exercise the extension routes and the lazy SQLite WASM bundle before a restore starts.
    await page.goto(`${baseURL}/_/#/settings/storage`);
    await expect(page.getByText("Pocketflare stores uploaded files in Cloudflare R2.")).toBeVisible();
    await page.goto(`${baseURL}/_/#/settings/backups`);
    const emptyZip = await new JSZip().generateAsync({ type: "nodebuffer" });
    await page.locator('input[type="file"]').setInputFiles({ name: "empty.zip", mimeType: "application/zip", buffer: emptyZip });
    await expect(page.getByText(/Backup zip does not contain data.db/)).toBeVisible();
    await page.goto(`${baseURL}/_/#/collections`);

    const start = await api.post("/api/pocketflare/restore/start", {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    });
    expect(start.ok(), await start.text()).toBeTruthy();
    const startBody = await start.json();
    sessionId = startBody.sessionId;
    restoreToken = startBody.fileUploadToken;
    expect(sessionId).toBeTruthy();
    expect(restoreToken).toBeTruthy();

    const database = await api.post("/api/pocketflare/restore/database", {
      headers: { "X-Pocketflare-Restore-Token": restoreToken },
      data: {
        sessionId,
        db: "app",
        statements: [{ sql: "SELECT 1", params: [] }],
      },
    });
    expect(database.ok(), await database.text()).toBeTruthy();

    const session = await api.get("/api/pocketflare/restore/session", {
      headers: { "X-Pocketflare-Restore-Token": restoreToken },
    });
    expect(session.ok(), await session.text()).toBeTruthy();
    const sessionBody = await session.json();
    expect(sessionBody.dbProgress?.batchesDone).toBeGreaterThan(0);

    await page.goto(`${baseURL}/_/#/settings/backups`);
    await expect(page.locator('[data-test="restore-active-session"]')).toBeVisible();
    await page.evaluate(
      ({ sessionId, restoreToken }) => {
        sessionStorage.setItem("pocketflareRestoreToken", restoreToken);
        sessionStorage.setItem("pocketflareRestoreSessionId", sessionId);
      },
      { sessionId, restoreToken },
    );

    await page.locator('[data-test="restore-start-over"]').click();

    await expect(page.locator('[data-test="restore-cancel-error"]')).toBeVisible();
    await expect(page.locator('[data-test="restore-active-session"]')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("pocketflareRestoreToken")))
      .toBe(restoreToken);
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("pocketflareRestoreSessionId")))
      .toBe(sessionId);

    const stillActive = await api.get("/api/pocketflare/restore/session", {
      headers: { "X-Pocketflare-Restore-Token": restoreToken },
    });
    expect(stillActive.ok(), await stillActive.text()).toBeTruthy();
  } finally {
    if (sessionId && restoreToken) {
      await api.post("/api/pocketflare/restore/finalize", {
        headers: { "X-Pocketflare-Restore-Token": restoreToken },
        data: { sessionId },
      }).catch(() => {});
    }
    await api.dispose();
  }
});
